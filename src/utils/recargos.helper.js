'use strict';
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * RECARGOS/DESCUENTOS POR FORMA DE PAGO - HELPER CENTRALIZADO
 * ERP LAGO - Febrero 2026
 *
 * Orquesta el flujo completo de recargos (+) y descuentos (-) por forma de pago.
 *
 * Actualizado: 2026-02-28 — Multi-empresa v2 (id_empresa en metodosdepago, formas_pago)
 * ════════════════════════════════════════════════════════════════════════════════
 */
const logger = require('./logger');
const ccHelper = require('./cc-clientes.helper');

// ════════════════════════════════════════════════════════════════════════════════
// CACHE (key incluye id_empresa para aislamiento multi-empresa)
// ════════════════════════════════════════════════════════════════════════════════
const _cacheFormasPago = {};        // key: `${id_empresa}_${id_forma_pago}`
const _cacheMetodoAFormaPago = {};  // key: `${id_empresa}_${id_metodo_pago}`

/**
 * Resuelve id_metodo_pago (tabla metodosdepago) a id_forma_pago (tabla formas_pago).
 * Usa match por nombre dentro de la misma empresa.
 */
async function resolverFormaPago(client, id_empresa, id_metodo_pago) {
    if (!id_metodo_pago || !id_empresa) return null;

    const cacheKey = `${id_empresa}_${id_metodo_pago}`;
    if (_cacheMetodoAFormaPago[cacheKey] !== undefined) {
        return _cacheMetodoAFormaPago[cacheKey];
    }

    const { rows } = await client.query(`
        SELECT fp.id_forma_pago
        FROM metodosdepago m
        JOIN formas_pago fp ON LOWER(TRIM(m.nombre)) = LOWER(TRIM(fp.nombre))
            AND fp.id_empresa = m.id_empresa
        WHERE m.id_metodo_pago = $1 AND m.id_empresa = $2
    `, [id_metodo_pago, id_empresa]);

    const resultado = rows[0]?.id_forma_pago || null;
    _cacheMetodoAFormaPago[cacheKey] = resultado;

    if (!resultado) {
        logger.warn(`[RECARGO] No se encontró forma_pago para metodo_pago #${id_metodo_pago} empresa #${id_empresa}`);
    }

    return resultado;
}

async function obtenerNombreFormaPago(client, id_empresa, id_forma_pago) {
    const cacheKey = `${id_empresa}_${id_forma_pago}`;
    if (_cacheFormasPago[cacheKey]) return _cacheFormasPago[cacheKey];

    const { rows } = await client.query(
        'SELECT nombre FROM formas_pago WHERE id_forma_pago = $1 AND id_empresa = $2',
        [id_forma_pago, id_empresa]
    );
    const nombre = rows[0]?.nombre || `Forma #${id_forma_pago}`;
    _cacheFormasPago[cacheKey] = nombre;
    return nombre;
}

// ════════════════════════════════════════════════════════════════════════════════
// OBTENER CONFIGURACIÓN DE RECARGO/DESCUENTO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Busca si hay recargo/descuento configurado para una forma de pago.
 */
async function obtenerRecargo(client, id_empresa, id_forma_pago) {
    const { rows } = await client.query(`
        SELECT porcentaje, descripcion, genera_nota_debito
        FROM recargos_forma_pago
        WHERE id_empresa = $1
          AND id_forma_pago = $2
          AND activo = TRUE
          AND porcentaje != 0
    `, [id_empresa, id_forma_pago]);

    return rows[0] || null;
}

/**
 * Obtiene TODOS los recargos/descuentos activos de una empresa.
 */
async function obtenerRecargosEmpresa(client, id_empresa) {
    const { rows } = await client.query(`
        SELECT r.*, fp.nombre AS nombre_forma_pago, fp.codigo
        FROM recargos_forma_pago r
        JOIN formas_pago fp ON fp.id_forma_pago = r.id_forma_pago AND fp.id_empresa = r.id_empresa
        WHERE r.id_empresa = $1 AND r.activo = TRUE AND r.porcentaje != 0
        ORDER BY fp.nombre
    `, [id_empresa]);
    return rows;
}

// ════════════════════════════════════════════════════════════════════════════════
// CÁLCULO
// ════════════════════════════════════════════════════════════════════════════════

function calcularMontoAjuste(monto_base, porcentaje) {
    return Math.round(monto_base * (porcentaje / 100) * 100) / 100;
}

// ════════════════════════════════════════════════════════════════════════════════
// GENERAR NOTA DE DÉBITO (solo para recargos positivos)
// ════════════════════════════════════════════════════════════════════════════════

async function _obtenerProximoNumeroND(client, id_empresa, punto_venta = 1) {
    const { rows } = await client.query(`
        SELECT COALESCE(MAX(numero_nota), 0) + 1 AS proximo
        FROM notas_credito_debito
        WHERE id_empresa = $1
          AND punto_venta = $2
          AND tipo_nota = 'debito'
    `, [id_empresa, punto_venta]);
    return rows[0].proximo;
}

async function _determinarCodigoTipo(client, id_empresa, id_cliente) {
    if (!id_cliente) return 'B';

    const { rows } = await client.query(`
        SELECT ci.nombre AS condicion
        FROM clientes c
        LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
        WHERE c.id_cliente = $1 AND c.id_empresa = $2
    `, [id_cliente, id_empresa]);

    if (rows.length === 0) return 'B';

    const condicion = (rows[0].condicion || '').toLowerCase();
    if (condicion.includes('responsable inscripto') || condicion.includes('responsable inscrito')) {
        return 'A';
    }
    return 'B';
}

async function generarNotaDebito(client, params) {
    const {
        id_empresa, id_cliente, id_usuario,
        id_factura = null, id_pago = null, id_pedido = null,
        total, motivo, porcentaje
    } = params;

    const punto_venta = 1;
    const numero = await _obtenerProximoNumeroND(client, id_empresa, punto_venta);
    const codigo_tipo = await _determinarCodigoTipo(client, id_empresa, id_cliente);

    const { rows } = await client.query(`
        INSERT INTO notas_credito_debito
        (id_empresa, id_cliente, id_usuario, id_factura_origen, id_pago, id_pedido,
         tipo_nota, codigo_tipo, numero_nota, punto_venta,
         subtotal, iva, total, motivo, origen, porcentaje_aplicado, estado)
        VALUES ($1, $2, $3, $4, $5, $6,
                'debito', $7, $8, $9,
                $10, 0, $10, $11, 'recargo_metodo_pago', $12, 'activa')
        RETURNING *
    `, [
        id_empresa, id_cliente, id_usuario,
        id_factura, id_pago, id_pedido,
        codigo_tipo, numero, punto_venta,
        total, motivo, porcentaje
    ]);

    const nd = rows[0];
    logger.info(`[RECARGO] ND ${nd.numero_completo} generada - $${total} - ${motivo}`);
    return nd;
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRAR EN TABLA DE AUDITORÍA (ajustes_forma_pago)
// ════════════════════════════════════════════════════════════════════════════════

async function _registrarAjuste(client, params) {
    // F1.5 DEPRECATED: el INSERT a ajustes_forma_pago ahora vive en pedidosHelper.aplicarAjusteFormaPago
    throw new Error('recargos.helper._registrarAjuste está DEPRECADA desde F1.5. Usá pedidosHelper.aplicarAjusteFormaPago.');
}

// ════════════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: PROCESAR AJUSTE POR FORMA DE PAGO
// ════════════════════════════════════════════════════════════════════════════════

async function procesarAjusteFormaPago(client, params) {
    // F1.5 DEPRECATED: esta función fue reemplazada por pedidosHelper.aplicarAjusteFormaPago
    // que es ahora el ÚNICO punto de aplicación de ajustes por forma de pago.
    // Razón: esta función NO actualizaba subtotal_sin_iva ni total_iva del pedido,
    // dejando los totales fiscales inconsistentes (Ley 23.349 art.10).
    // Eliminada definitivamente en F1.5 fase H.
    throw new Error(
        'recargos.helper.procesarAjusteFormaPago está DEPRECADA desde F1.5. ' +
        'Usá pedidosHelper.aplicarAjusteFormaPago en su lugar. ' +
        'Llamada con id_pedido=' + (params && params.id_pedido) + ', id_forma_pago=' + (params && params.id_forma_pago)
    );
}

// ════════════════════════════════════════════════════════════════════════════════
// ANULAR AJUSTE
// ════════════════════════════════════════════════════════════════════════════════

async function anularAjuste(client, id_ajuste, id_empresa, motivo = 'Anulación de pedido') {
    if (!id_empresa) throw new Error('anularAjuste: id_empresa requerido');
    const { rows } = await client.query(
        'SELECT * FROM ajustes_forma_pago WHERE id_ajuste = $1 AND id_empresa = $2',
        [id_ajuste, id_empresa]
    );
    if (rows.length === 0) throw new Error(`Ajuste #${id_ajuste} no encontrado`);

    const ajuste = rows[0];
    if (ajuste.anulado) {
        logger.warn(`[RECARGO] Ajuste #${id_ajuste} ya estaba anulado`);
        return { ya_anulado: true };
    }

    if (ajuste.id_nota) {
        await client.query(`
            UPDATE notas_credito_debito SET estado = 'anulada'
            WHERE id_nota = $1 AND id_empresa = $2
        `, [ajuste.id_nota, ajuste.id_empresa]);
        logger.info(`[RECARGO] ND #${ajuste.id_nota} anulada - ${motivo}`);
    }

    if (ajuste.id_nota) {
        const movs = await client.query(`
            SELECT id_movimiento_cc_cliente FROM cuentacorrienteclientes
            WHERE id_nota = $1
        `, [ajuste.id_nota]);

        for (const mov of movs.rows) {
            await ccHelper.anularMovimiento(
                client,
                mov.id_movimiento_cc_cliente,
                `Anulación recargo - ${motivo}`
            );
        }
    }

    await client.query(`
        UPDATE ajustes_forma_pago SET anulado = TRUE WHERE id_ajuste = $1 AND id_empresa = $2
    `, [id_ajuste, ajuste.id_empresa]);

    logger.info(`[RECARGO] Ajuste #${id_ajuste} anulado - ${motivo}`);
    return { anulado: true, id_ajuste };
}

async function anularAjustesPorPedido(client, params) {
    // Firma objeto destructurable. Compatible con callers que ya pasan objeto.
    const { id_empresa, id_pedido, motivo = 'Anulación de pedido' } = params || {};
    if (!id_empresa) throw new Error('anularAjustesPorPedido: id_empresa requerido');
    if (!id_pedido)  throw new Error('anularAjustesPorPedido: id_pedido requerido');

    const { rows } = await client.query(`
        SELECT id_ajuste FROM ajustes_forma_pago
        WHERE id_pedido = $1 AND id_empresa = $2 AND anulado = FALSE
    `, [id_pedido, id_empresa]);

    const resultados = [];
    for (const row of rows) {
        const res = await anularAjuste(client, row.id_ajuste, id_empresa, motivo);
        resultados.push(res);
    }

    return resultados;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════
module.exports = {
    obtenerRecargo,
    obtenerRecargosEmpresa,
    obtenerNombreFormaPago,
    calcularMontoAjuste,
    procesarAjusteFormaPago,
    generarNotaDebito,
    resolverFormaPago,
    anularAjuste,
    anularAjustesPorPedido
};
