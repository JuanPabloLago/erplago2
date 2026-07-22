'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TESORERIA HELPER — ERP LAGO
 *
 * Capa unica de entrada para registrar movimientos de tesoreria.
 *
 * RESPONSABILIDAD UNICA: dado un pago (cobro o egreso) con su forma de pago,
 * decide si mueve caja, valida el turno, y delega a caja.helper.
 *
 * Lo usan: pagos.helper (ventas), pagos-proveedores.helper (compras),
 * recibos.helper (cobranzas), cobranza.helper (liquidacion).
 *
 * REGLA: Si metodosdepago.mueve_caja=true, se inserta en movimientos_caja.
 * REGLA: Si requiere turno y no hay turno abierto en el deposito → throw.
 * REGLA: id_empresa, id_usuario siempre obligatorios.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const cajaHelper = require('./caja.helper');
const stockHelper = require('./stock.helper');
const config = require('./config.helper');
const logger = require('./logger');

/**
 * Resuelve datos del puente formas_pago → metodosdepago.
 */
async function resolverMetodoCajaDesdeFormaPago(client, id_empresa, id_forma_pago) {
    const res = await client.query(
        `SELECT fp.id_metodo_pago_caja, mp.tipo_cuenta, mp.mueve_caja, mp.nombre AS metodo_nombre
           FROM formas_pago fp
           LEFT JOIN metodosdepago mp ON mp.id_metodo_pago = fp.id_metodo_pago_caja
          WHERE fp.id_forma_pago = $1 AND fp.id_empresa = $2`,
        [id_forma_pago, id_empresa]
    );
    if (res.rows.length === 0) {
        throw Object.assign(
            new Error(`forma_pago id=${id_forma_pago} no existe en empresa ${id_empresa}`),
            { statusCode: 400, code: 'FORMA_PAGO_INEXISTENTE' }
        );
    }
    const row = res.rows[0];
    if (!row.id_metodo_pago_caja) {
        throw Object.assign(
            new Error(`forma_pago id=${id_forma_pago} no tiene puente con metodosdepago. Configurar en formas_pago.id_metodo_pago_caja.`),
            { statusCode: 500, code: 'FORMA_PAGO_SIN_PUENTE' }
        );
    }
    return row;
}

/**
 * Lee fila de metodosdepago.
 */
async function obtenerMetodoPago(client, id_empresa, id_metodo_pago) {
    const res = await client.query(
        `SELECT id_metodo_pago, nombre, tipo_cuenta, mueve_caja, requiere_arqueo_manual, activo
           FROM metodosdepago
          WHERE id_metodo_pago = $1 AND id_empresa = $2`,
        [id_metodo_pago, id_empresa]
    );
    if (res.rows.length === 0) {
        throw Object.assign(
            new Error(`metodosdepago id=${id_metodo_pago} no existe en empresa ${id_empresa}`),
            { statusCode: 400, code: 'METODO_PAGO_INEXISTENTE' }
        );
    }
    return res.rows[0];
}

/**
 * Reemplaza {var} por valores en un template.
 */
function aplicarTemplate(tpl, vars) {
    return Object.entries(vars).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{${k}\\}`, 'g'), v == null ? '' : String(v)),
        tpl
    );
}

/**
 * REGISTRA UN MOVIMIENTO DE TESORERIA.
 *
 * @param {object} client                pg client (transaccion abierta)
 * @param {object} params
 * @param {number} params.id_empresa     OBLIGATORIO
 * @param {number} params.id_usuario     OBLIGATORIO (para resolver deposito y turno)
 * @param {string} params.tipo           'ingreso' | 'egreso'
 * @param {number} params.monto          > 0
 * @param {number} [params.id_metodo_pago]  id de metodosdepago (preferido si lo tenes)
 * @param {number} [params.id_forma_pago]   id de formas_pago (alternativo, se resuelve al puente)
 * @param {number} [params.id_moneda]    default 1 (ARS)
 * @param {string} params.concepto       texto descriptivo
 * @param {number} [params.id_recibo]    opcional
 * @param {number} [params.cotizacion_usada] default 1
 *
 * @returns {Promise<object>}
 *   - Si el metodo NO mueve caja: { registrado: false, motivo, metodo_nombre }
 *   - Si SI mueve: { registrado: true, id_movimiento, id_turno, id_metodo_pago, tipo_cuenta, metodo_nombre }
 */
async function registrarMovimientoTesoreria(client, params) {
    const {
        id_empresa, id_usuario, tipo, monto,
        id_metodo_pago: id_metodo_pago_directo,
        id_forma_pago,
        id_moneda = 1,
        concepto,
        id_recibo = null,
        cotizacion_usada = 1
    } = params;

    if (!id_empresa)            throw new Error('tesoreria.helper: id_empresa obligatorio');
    if (!id_usuario)            throw new Error('tesoreria.helper: id_usuario obligatorio');
    if (!tipo)                  throw new Error('tesoreria.helper: tipo obligatorio (ingreso|egreso)');
    if (!['ingreso','egreso'].includes(tipo)) throw new Error(`tesoreria.helper: tipo invalido "${tipo}"`);
    if (!monto || parseFloat(monto) <= 0)   throw new Error('tesoreria.helper: monto debe ser > 0');
    if (!concepto)              throw new Error('tesoreria.helper: concepto obligatorio');

    // 1) Resolver id_metodo_pago (acepta directo o vía formas_pago)
    let id_metodo_pago = id_metodo_pago_directo;
    if (!id_metodo_pago && id_forma_pago) {
        const puente = await resolverMetodoCajaDesdeFormaPago(client, id_empresa, id_forma_pago);
        id_metodo_pago = puente.id_metodo_pago_caja;
    }
    if (!id_metodo_pago) {
        throw new Error('tesoreria.helper: id_metodo_pago o id_forma_pago obligatorio');
    }
    const metodoInfo = await obtenerMetodoPago(client, id_empresa, id_metodo_pago);

    // 2) Si el metodo NO mueve caja → no se registra (ej: cuenta corriente)
    if (!metodoInfo.mueve_caja) {
        logger.info(`tesoreria.helper: metodo "${metodoInfo.nombre}" no mueve caja, skip`);
        return {
            registrado: false,
            motivo: 'metodo_no_mueve_caja',
            metodo_nombre: metodoInfo.nombre,
            tipo_cuenta: metodoInfo.tipo_cuenta
        };
    }

    // 3) Resolver deposito del usuario
    //    stockHelper.obtenerDepositoUsuario espera { id_empresa, id_usuario, id_deposito? }
    const id_deposito = await stockHelper.obtenerDepositoUsuario(client, {
        id_empresa,
        id_usuario
    });

    // 4) Exigir turno abierto en el deposito (multi-sucursal correcto)
    const turno = await cajaHelper.requerirTurnoAbierto(client, id_empresa, { id_deposito });

    // 5) Insertar via caja.helper (single source of truth)
    const movimiento = await cajaHelper.registrarMovimiento(client, {
        id_empresa,
        id_turno: turno.id_turno,
        id_usuario,
        tipo,
        monto: parseFloat(monto),
        id_moneda,
        id_metodo_pago,
        concepto,
        id_recibo,
        cotizacion_usada
    });

    return {
        registrado: true,
        id_movimiento: movimiento.id_movimiento,
        id_turno: turno.id_turno,
        id_metodo_pago,
        tipo_cuenta: metodoInfo.tipo_cuenta,
        metodo_nombre: metodoInfo.nombre
    };
}

/**
 * Atajo para egresos a proveedor: arma el concepto desde template y delega.
 */
async function registrarEgresoProveedor(client, params) {
    const { id_empresa, id_usuario, id_forma_pago, monto, razon_social, numero_pago, id_pago_proveedor } = params;

    const tpl = await config.get(client, id_empresa,
        'tesoreria.concepto_egreso_proveedor_template',
        'Pago a {razon_social} - #{numero_pago}'
    );
    const concepto = aplicarTemplate(tpl, {
        razon_social: razon_social || '',
        numero_pago: numero_pago || '',
        id_pago_proveedor: id_pago_proveedor || ''
    });

    return registrarMovimientoTesoreria(client, {
        id_empresa,
        id_usuario,
        tipo: 'egreso',
        monto,
        id_forma_pago,
        concepto
    });
}

module.exports = {
    registrarMovimientoTesoreria,
    registrarEgresoProveedor,
    resolverMetodoCajaDesdeFormaPago,
    obtenerMetodoPago
};
