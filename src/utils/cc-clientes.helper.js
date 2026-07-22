'use strict';
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CC-CLIENTES HELPER v3 - ERP LAGO
 * Funciones centralizadas para cuenta corriente de clientes.
 *
 * v3 (2026-02-16):
 * - registrarVentaConPago(): DEBE + HABER automático en una sola llamada
 * - esConsumidorFinal(): excluye CF de la CC automáticamente
 * - obtenerNombreMetodo(): resuelve nombre del método de pago desde BD
 * - Concepto de recibo incluye forma de pago
 *
 * v2 (2026-02-16):
 * - Saldo REAL = SUM(debe) - SUM(haber) siempre calculado
 * - Campo 'saldo' en tabla = cache informativo
 * - clientes.saldo_actual sincronizado automáticamente
 * - eliminarMovimiento() + anularMovimiento()
 *
 * REGLA: Todo INSERT/DELETE a cuentacorrienteclientes DEBE pasar por acá.
 * ════════════════════════════════════════════════════════════════════════════════
 */
const logger = require('./logger');
const recargosHelper = require('./recargos.helper');
const cfg = require('./config.helper');

// ════════════════════════════════════════════════════════════════════════════════
// CACHE interno de métodos de pago (evita queries repetidas)
// ════════════════════════════════════════════════════════════════════════════════
const _cacheMetodos = {};

/**
 * Obtiene el nombre del método de pago desde BD (con cache).
 * @param {object} client - pg client o pool
 * @param {number} id_metodo_pago
 * @returns {string} nombre del método
 */
async function obtenerNombreMetodo(client, id_metodo_pago, id_empresa) {
    const _ck = `${id_empresa}_${id_metodo_pago}`; if (_cacheMetodos[_ck]) return _cacheMetodos[_ck];

    const { rows } = await client.query(
        'SELECT nombre FROM metodosdepago WHERE id_metodo_pago = $1 AND id_empresa = $2',
        [id_metodo_pago, id_empresa]
    );

    const nombre = rows[0]?.nombre || _fallbackNombreMetodo(id_metodo_pago);
    _cacheMetodos[_ck] = nombre;
    return nombre;
}

function _fallbackNombreMetodo(id) {
    const map = { 1: 'Efectivo', 2: 'MercadoPago', 3: 'Transferencia', 4: 'Crédito', 5: 'Débito', 6: 'Cuenta Corriente' };
    return map[id] || `Método #${id}`;
}

// ════════════════════════════════════════════════════════════════════════════════
// DETECCIÓN DE CONSUMIDOR FINAL
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Determina si un cliente es "Consumidor Final" y por lo tanto NO debe
 * tener movimientos en cuenta corriente.
 *
 * Criterios: condición IVA = 'Consumidor Final' (case insensitive)
 *
 * @param {object} client - pg client o pool
 * @param {number} id_empresa
 * @param {number} id_cliente
 * @returns {boolean} true si es CF
 */
async function esConsumidorFinal(client, id_empresa, id_cliente) {
    if (!id_cliente) return true;
    // Chequea por ID del cliente generico (config), NO por condicion IVA.
    const { rows } = await client.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'clientes.id_consumidor_final'",
        [id_empresa]
    );
    const idCF = parseInt(rows[0]?.valor) || 9;
    return id_cliente === idCF;
}

// ════════════════════════════════════════════════════════════════════════════════
// SALDO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Calcula el saldo REAL del cliente sumando todos los movimientos.
 * NO depende del campo 'saldo' almacenado.
 */
async function obtenerSaldo(client, id_empresa, id_cliente) {
    const res = await client.query(`
        SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
        FROM cuentacorrienteclientes
        WHERE id_cliente = $1 AND id_empresa = $2
    `, [id_cliente, id_empresa]);
    return parseFloat(res.rows[0].saldo) || 0;
}

/**
 * Recalcula el saldo corrido de TODOS los movimientos de un cliente
 * y sincroniza clientes.saldo_actual.
 */
async function recalcularSaldo(client, id_empresa, id_cliente) {
    // 1. Recalcular saldo corrido con window function
    await client.query(`
        WITH saldos AS (
            SELECT
                id_movimiento_cc_cliente,
                SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                    OVER (ORDER BY fecha ASC, id_movimiento_cc_cliente ASC) as saldo_corrido
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        )
        UPDATE cuentacorrienteclientes cc
        SET saldo = s.saldo_corrido
        FROM saldos s
        WHERE cc.id_movimiento_cc_cliente = s.id_movimiento_cc_cliente
    `, [id_cliente, id_empresa]);

    // 2. Obtener saldo final
    const saldoFinal = await obtenerSaldo(client, id_empresa, id_cliente);

    // 3. Sincronizar clientes.saldo_actual
    await client.query(`
        UPDATE clientes SET saldo_actual = $1
        WHERE id_cliente = $2 AND id_empresa = $3
    `, [saldoFinal, id_cliente, id_empresa]);

    logger.info(`CC Recalculado - Cliente #${id_cliente}: saldo = $${saldoFinal}`);
    return saldoFinal;
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRAR MOVIMIENTO (bajo nivel)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Registra un movimiento en cuenta corriente del cliente.
 * Calcula el saldo corrido y sincroniza clientes.saldo_actual.
 *
 * @param {object} client - pg client dentro de transacción
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_cliente
 * @param {number} params.monto - siempre positivo
 * @param {string} params.tipo - 'debe' | 'haber'
 * @param {string} params.concepto
 * @param {number|null} params.id_pago
 * @param {number|null} params.id_factura
 * @param {number|null} params.id_nota - Ref a notas_credito_debito (para vincular con ND)
 * @returns {object} movimiento insertado
 */
async function registrarMovimiento(client, params) {
    const {
        id_empresa,
        id_cliente,
        monto,
        tipo,
        concepto,
        id_pago = null,
        id_factura = null,
        id_nota = null,
        id_pedido = null,
        id_recibo = null
    } = params;

    if (!id_empresa || !id_cliente) {
        throw new Error('cc-clientes.helper: id_empresa e id_cliente son obligatorios');
    }
    if (!monto || parseFloat(monto) <= 0) {
        throw new Error('cc-clientes.helper: monto debe ser mayor a 0');
    }
    if (!['debe', 'haber'].includes(tipo)) {
        throw new Error('cc-clientes.helper: tipo debe ser "debe" o "haber"');
    }

    // Guard: no se acepta fecha explícita. La BD la setea con now().
    // Para inserciones con fecha histórica usar scripts_mantenimiento/reconciliar_saldo_cc.sh
    if (params.fecha !== undefined) {
        throw new Error(
            'cc-clientes.helper: NO pasar fecha. La BD asigna now() automáticamente. ' +
            'Para carga histórica usar scripts_mantenimiento/reconciliar_saldo_cc.sh'
        );
    }

    const montoNum = parseFloat(monto);

    // 1. Inferir id_pedido desde id_pago si no vino explicito
    let idPedidoFinal = id_pedido;
    if (!idPedidoFinal && id_pago) {
        const r = await client.query(
            'SELECT id_pedido FROM pagos WHERE id_pago = $1 AND id_empresa = $2',
            [id_pago, id_empresa]
        );
        idPedidoFinal = r.rows[0]?.id_pedido || null;
    }

    // 2. Obtener saldo anterior (calculado)
    const saldoAnterior = await obtenerSaldo(client, id_empresa, id_cliente);

    // 3. Calcular nuevo saldo
    const debe = tipo === 'debe' ? montoNum : 0;
    const haber = tipo === 'haber' ? montoNum : 0;
    const nuevoSaldo = saldoAnterior + debe - haber;

    // 4. Insertar movimiento (con id_pedido si es inferible)
    const res = await client.query(`
        INSERT INTO cuentacorrienteclientes
        (id_empresa, id_cliente, id_pedido, id_pago, id_factura, concepto, debe, haber, saldo, id_nota, id_recibo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
    `, [id_empresa, id_cliente, idPedidoFinal, id_pago, id_factura, concepto, debe, haber, nuevoSaldo, id_nota, id_recibo]);

    // 5. Sincronizar clientes.saldo_actual
    await client.query(`
        UPDATE clientes SET saldo_actual = $1
        WHERE id_cliente = $2 AND id_empresa = $3
    `, [nuevoSaldo, id_cliente, id_empresa]);

    logger.info(`CC Cliente #${id_cliente}: ${tipo} $${montoNum} | $${saldoAnterior} → $${nuevoSaldo} | ${concepto}`);
    return res.rows[0];
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRAR VENTA CON PAGO (alto nivel - lo usan todos los controllers)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Registra una venta en la CC del cliente: DEBE por la venta + HABER si paga al contado.
 * Excluye Consumidor Final automáticamente.
 *
 * LÓGICA:
 * - Método 6 (Fiado/CC) → solo DEBE (queda debiendo)
 * - Métodos 1-5 (Efectivo/MP/Transfer/Tarjeta) → DEBE + HABER (saldo neto = 0)
 *
 * @param {object} client - pg client dentro de transacción
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_cliente
 * @param {number} params.id_pedido
 * @param {number} params.id_pago - del registro en tabla pagos
 * @param {number} params.monto
 * @param {number} params.id_metodo_pago - 1=Efvo, 2=MP, 3=Transfer, 4=Cred, 5=Deb, 6=CC
 * @param {string} [params.concepto_prefijo] - Default: 'Venta Pedido'
 * @returns {object|null} null si es CF, { debe, haber } si registró
 */
async function registrarVentaConPago(client, params) {
    const {
        id_empresa,
        id_cliente,
        id_pedido,
        id_pago,
        monto,
        id_metodo_pago,
        concepto_prefijo = null,
        id_usuario = null,
        id_factura = null,
        id_forma_pago = null
    } = params;

    const montoPago = parseFloat(monto);
    // SIGNO SOBERANO (2026-07-06): negativo = devolucion (asiento espejo).
    if (!montoPago || isNaN(montoPago)) return null;
    const esDevolucionCC = montoPago < 0;
    const montoAbs = Math.abs(montoPago);
    if (!id_cliente) return null;

    // Excluir Consumidor Final
    const esCF = await esConsumidorFinal(client, id_empresa, id_cliente);
    if (esCF) return null;

    // B1 fix: resolver prefijo desde config (cc.concepto_prefijo_default)
    // si el caller no lo paso explicito. ?? cubre null Y undefined.
    const prefijoFinal = concepto_prefijo
        ?? await cfg.get(client, id_empresa, 'cc.concepto_prefijo_default', 'Venta Pedido');

    // B2 fix: usar nro_pedido (visible) en concepto, no id_pedido (interno).
    // Fallback a id_pedido si todavia no se asigno nro (caso borde).
    const rNro = await client.query(
        'SELECT nro_pedido FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [id_pedido, id_empresa]
    );
    const nroDisplay = rNro.rows[0]?.nro_pedido || id_pedido;

    // Asiento segun signo (2026-07-06). Ambos netean cero: documental puro.
    //  Venta:      DEBE compra            + HABER pago
    //  Devolucion: HABER devuelve mercad. + DEBE se lleva dinero
    const nombreMetodo = await obtenerNombreMetodo(client, id_metodo_pago, id_empresa);
    const movDebe = await registrarMovimiento(client, {
        id_empresa, id_cliente, id_pedido, monto: montoAbs, tipo: 'debe',
        concepto: esDevolucionCC
            ? `Devolución dinero Pedido #${nroDisplay} - ${nombreMetodo}`
            : `${prefijoFinal} #${nroDisplay}`,
        id_pago
    });
    const movHaber = await registrarMovimiento(client, {
        id_empresa, id_cliente, id_pedido, monto: montoAbs, tipo: 'haber',
        concepto: esDevolucionCC
            ? `Devolución mercadería Pedido #${nroDisplay}`
            : `Pago Pedido #${nroDisplay} - ${nombreMetodo}`,
        id_pago
    });

    // F1.5: el recargo por forma de pago se aplica con pedidosHelper.aplicarAjusteFormaPago
    // desde el caller (pagos.helper.registrarPago / borrador.controller.confirmarBorrador).
    // registrarVentaConPago ahora SOLO registra movimientos en CC.
    return { debe: movDebe, haber: movHaber, recargo: null };
}

// ════════════════════════════════════════════════════════════════════════════════
// ELIMINAR / ANULAR MOVIMIENTO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Elimina un movimiento de CC y recalcula todo automáticamente.
 */
async function eliminarMovimiento(client, id_movimiento_cc_cliente) {
    const mov = await client.query(`
        SELECT id_cliente, id_empresa, concepto
        FROM cuentacorrienteclientes
        WHERE id_movimiento_cc_cliente = $1
    `, [id_movimiento_cc_cliente]);

    if (mov.rows.length === 0) {
        throw new Error(`cc-clientes.helper: movimiento ${id_movimiento_cc_cliente} no encontrado`);
    }

    const { id_cliente, id_empresa, concepto } = mov.rows[0];

    await client.query(
        'DELETE FROM cuentacorrienteclientes WHERE id_movimiento_cc_cliente = $1',
        [id_movimiento_cc_cliente]
    );

    const nuevoSaldo = await recalcularSaldo(client, id_empresa, id_cliente);

    logger.warn(`CC Eliminado mov #${id_movimiento_cc_cliente} (${concepto}) → saldo: $${nuevoSaldo}`);
    return nuevoSaldo;
}

/**
 * Anula un movimiento con contra-asiento (mantiene auditoría).
 */
async function anularMovimiento(client, id_movimiento_cc_cliente, motivo = 'Anulación') {
    const mov = await client.query(
        'SELECT * FROM cuentacorrienteclientes WHERE id_movimiento_cc_cliente = $1',
        [id_movimiento_cc_cliente]
    );

    if (mov.rows.length === 0) {
        throw new Error(`cc-clientes.helper: movimiento ${id_movimiento_cc_cliente} no encontrado`);
    }

    const orig = mov.rows[0];
    const debeOrig = parseFloat(orig.debe) || 0;
    const haberOrig = parseFloat(orig.haber) || 0;

    const contraAsiento = await registrarMovimiento(client, {
        id_empresa: orig.id_empresa,
        id_cliente: orig.id_cliente,
        monto: debeOrig > 0 ? debeOrig : haberOrig,
        tipo: debeOrig > 0 ? 'haber' : 'debe',
        concepto: `[ANULACIÓN] ${motivo} - Ref: ${orig.concepto}`,
        id_pago: orig.id_pago,
        id_factura: orig.id_factura
    });

    logger.warn(`CC Anulado mov #${id_movimiento_cc_cliente} → contra-asiento #${contraAsiento.id_movimiento_cc_cliente}`);
    return contraAsiento;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * obtenerLibro — Libro mayor del cliente (espejo de cc-proveedores.obtenerLibro).
 * Saldo corrido sobre la historia COMPLETA (el filtro no distorsiona saldos),
 * fila de saldo anterior, joins al documento origen, busqueda multi-campo,
 * filtro por forma de pago via JOIN real (no ILIKE sobre concepto).
 */
async function obtenerLibro(db, params) {
    const {
        id_empresa, id_cliente, desde = null, hasta = null,
        pagina = 1, busqueda = null, id_forma_pago = null,
        items_por_pagina = null
    } = params;
    if (!id_empresa || !id_cliente) {
        throw new Error('cc-clientes.obtenerLibro: id_empresa e id_cliente son obligatorios');
    }
    const cfgH = require('./config.helper');
    const porPagina = parseInt(items_por_pagina
        || await cfgH.get(db, id_empresa, 'cc.libro.items_por_pagina', '50'), 10) || 50;
    const pag = Math.max(1, parseInt(pagina, 10) || 1);
    const off = (pag - 1) * porPagina;

    let saldo_anterior = 0;
    if (desde) {
        const r = await db.query(
            `SELECT COALESCE(SUM(debe),0)-COALESCE(SUM(haber),0) AS s
             FROM cuentacorrienteclientes
             WHERE id_empresa=$1 AND id_cliente=$2 AND fecha < $3::date`,
            [id_empresa, id_cliente, desde]);
        saldo_anterior = parseFloat(r.rows[0].s) || 0;
    }

    const joins = `
        LEFT JOIN pedidos  p ON p.id_pedido  = cc.id_pedido
        LEFT JOIN facturas f ON f.id_factura = cc.id_factura
        LEFT JOIN notas_credito_debito n ON n.id_nota = cc.id_nota
        LEFT JOIN recibos  r ON r.id_recibo  = cc.id_recibo`;
    const conds = ['cc.id_empresa=$1', 'cc.id_cliente=$2'];
    const vals = [id_empresa, id_cliente];
    let i = 3;
    if (desde) { conds.push(`cc.fecha >= $${i}::date`); vals.push(desde); i++; }
    if (hasta) { conds.push(`cc.fecha < ($${i}::date + interval '1 day')`); vals.push(hasta); i++; }
    if (busqueda) {
        conds.push(`(cc.concepto ILIKE $${i} OR p.nro_pedido::text = $${i + 1}
                     OR f.numero_completo ILIKE $${i} OR n.numero_completo ILIKE $${i}
                     OR r.numero_completo ILIKE $${i})`);
        vals.push('%' + busqueda + '%', String(busqueda).replace('#', '').trim());
        i += 2;
    }
    if (id_forma_pago) {
        conds.push(`(EXISTS (SELECT 1 FROM recibo_items ri
                        WHERE ri.id_recibo = cc.id_recibo AND ri.id_forma_pago = $${i})
                 OR EXISTS (SELECT 1 FROM recibopagos rp
                        JOIN recibo_items ri2 ON ri2.id_recibo = rp.id_recibo
                        WHERE rp.id_pago = cc.id_pago AND ri2.id_forma_pago = $${i}))`);
        vals.push(parseInt(id_forma_pago, 10)); i++;
    }
    const where = conds.join(' AND ');

    const totRes = await db.query(
        `SELECT COUNT(*) AS t, COALESCE(SUM(cc.debe),0) AS td, COALESCE(SUM(cc.haber),0) AS th
         FROM cuentacorrienteclientes cc ${joins} WHERE ${where}`, vals);

    const movRes = await db.query(`
        WITH hist AS (
            SELECT id_movimiento_cc_cliente,
                   SUM(COALESCE(debe,0)-COALESCE(haber,0))
                       OVER (ORDER BY fecha, id_movimiento_cc_cliente) AS saldo_corrido
            FROM cuentacorrienteclientes
            WHERE id_empresa=$1 AND id_cliente=$2
        )
        SELECT cc.id_movimiento_cc_cliente, cc.fecha, cc.concepto,
               COALESCE(cc.debe,0) AS debe, COALESCE(cc.haber,0) AS haber,
               h.saldo_corrido AS saldo,
               cc.id_pedido, p.nro_pedido,
               cc.id_factura, f.numero_completo AS factura_numero, f.estado AS factura_estado,
               cc.id_nota, n.numero_completo AS nota_numero, n.tipo_nota,
               cc.id_recibo, r.numero_completo AS recibo_numero, cc.id_pago
        FROM cuentacorrienteclientes cc
        JOIN hist h ON h.id_movimiento_cc_cliente = cc.id_movimiento_cc_cliente
        ${joins}
        WHERE ${where}
        ORDER BY cc.fecha DESC, cc.id_movimiento_cc_cliente DESC
        LIMIT $${i} OFFSET $${i + 1}`, [...vals, porPagina, off]);

    const sRes = await db.query(
        `SELECT COALESCE(SUM(debe),0)-COALESCE(SUM(haber),0) AS s
         FROM cuentacorrienteclientes WHERE id_empresa=$1 AND id_cliente=$2`,
        [id_empresa, id_cliente]);

    return {
        movimientos: movRes.rows,
        saldo_anterior,
        saldo_actual: parseFloat(sRes.rows[0].s) || 0,
        totales: { debe: parseFloat(totRes.rows[0].td) || 0, haber: parseFloat(totRes.rows[0].th) || 0 },
        total_filas: parseInt(totRes.rows[0].t, 10),
        pagina: pag, items_por_pagina: porPagina
    };
}

module.exports = {
    obtenerSaldo,
    recalcularSaldo,
    registrarMovimiento,
    registrarVentaConPago,
    eliminarMovimiento,
    anularMovimiento,
    esConsumidorFinal,
    obtenerNombreMetodo,
    obtenerLibro
};
