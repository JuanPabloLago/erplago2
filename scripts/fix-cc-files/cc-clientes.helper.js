'use strict';
/**
 * CC-CLIENTES HELPER v2 - ERP LAGO
 * Funciones centralizadas para cuenta corriente de clientes.
 *
 * DISEÑO v2 (2026-02-16):
 * - El saldo REAL se calcula siempre como SUM(debe) - SUM(haber)
 * - El campo 'saldo' en la tabla es solo CACHE (informativo)
 * - clientes.saldo_actual se sincroniza automáticamente
 * - Si se borra/anula un movimiento, recalcularSaldo() arregla todo
 *
 * REGLA: Todo INSERT/DELETE a cuentacorrienteclientes DEBE pasar por acá.
 */
const logger = require('./logger');

/**
 * Calcula el saldo REAL del cliente sumando todos los movimientos.
 * NO depende del campo 'saldo' almacenado (que puede estar desactualizado).
 *
 * @param {object} client - pg client o pool
 * @param {number} id_empresa
 * @param {number} id_cliente
 * @returns {number} saldo real calculado
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
 * Llamar después de DELETE, anulación o cualquier modificación.
 *
 * @param {object} client - pg client (dentro de transacción)
 * @param {number} id_empresa
 * @param {number} id_cliente
 * @returns {number} saldo final recalculado
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

    // 2. Obtener saldo final (último movimiento o 0 si no hay)
    const saldoFinal = await obtenerSaldo(client, id_empresa, id_cliente);

    // 3. Sincronizar clientes.saldo_actual
    await client.query(`
        UPDATE clientes SET saldo_actual = $1
        WHERE id_cliente = $2 AND id_empresa = $3
    `, [saldoFinal, id_cliente, id_empresa]);

    logger.info(`CC Recalculado - Cliente #${id_cliente}: saldo = $${saldoFinal}`);
    return saldoFinal;
}

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
 * @param {number|null} params.id_pago - referencia a pagos/recibos (opcional)
 * @param {number|null} params.id_factura - referencia a facturas (opcional)
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
        id_factura = null
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

    const montoNum = parseFloat(monto);

    // 1. Obtener saldo anterior (calculado, no del campo)
    const saldoAnterior = await obtenerSaldo(client, id_empresa, id_cliente);

    // 2. Calcular nuevo saldo
    const debe = tipo === 'debe' ? montoNum : 0;
    const haber = tipo === 'haber' ? montoNum : 0;
    const nuevoSaldo = saldoAnterior + debe - haber;

    // 3. Insertar movimiento
    const res = await client.query(`
        INSERT INTO cuentacorrienteclientes
        (id_empresa, id_cliente, id_pago, id_factura, concepto, debe, haber, saldo)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `, [id_empresa, id_cliente, id_pago, id_factura, concepto, debe, haber, nuevoSaldo]);

    // 4. Sincronizar clientes.saldo_actual
    await client.query(`
        UPDATE clientes SET saldo_actual = $1
        WHERE id_cliente = $2 AND id_empresa = $3
    `, [nuevoSaldo, id_cliente, id_empresa]);

    logger.success(`CC Cliente #${id_cliente}: ${tipo} $${montoNum} | $${saldoAnterior} → $${nuevoSaldo} | ${concepto}`);
    return res.rows[0];
}

/**
 * Elimina un movimiento de CC y recalcula todo automáticamente.
 * Usar para anulaciones o correcciones.
 *
 * @param {object} client - pg client dentro de transacción
 * @param {number} id_movimiento_cc_cliente
 * @returns {number} nuevo saldo después de eliminar
 */
async function eliminarMovimiento(client, id_movimiento_cc_cliente) {
    // 1. Obtener datos del movimiento antes de borrar
    const mov = await client.query(`
        SELECT id_cliente, id_empresa, debe, haber, concepto
        FROM cuentacorrienteclientes
        WHERE id_movimiento_cc_cliente = $1
    `, [id_movimiento_cc_cliente]);

    if (mov.rows.length === 0) {
        throw new Error(`cc-clientes.helper: movimiento ${id_movimiento_cc_cliente} no encontrado`);
    }

    const { id_cliente, id_empresa, concepto } = mov.rows[0];

    // 2. Eliminar movimiento
    await client.query(`
        DELETE FROM cuentacorrienteclientes
        WHERE id_movimiento_cc_cliente = $1
    `, [id_movimiento_cc_cliente]);

    // 3. Recalcular todo
    const nuevoSaldo = await recalcularSaldo(client, id_empresa, id_cliente);

    logger.warn(`CC Eliminado mov #${id_movimiento_cc_cliente} (${concepto}) → saldo recalculado: $${nuevoSaldo}`);
    return nuevoSaldo;
}

/**
 * Anula un movimiento (no lo borra, registra contra-asiento).
 * Más seguro que eliminar porque mantiene auditoría.
 *
 * @param {object} client - pg client dentro de transacción
 * @param {number} id_movimiento_cc_cliente
 * @param {string} motivo
 * @returns {object} movimiento de anulación creado
 */
async function anularMovimiento(client, id_movimiento_cc_cliente, motivo = 'Anulación') {
    // 1. Obtener movimiento original
    const mov = await client.query(`
        SELECT * FROM cuentacorrienteclientes
        WHERE id_movimiento_cc_cliente = $1
    `, [id_movimiento_cc_cliente]);

    if (mov.rows.length === 0) {
        throw new Error(`cc-clientes.helper: movimiento ${id_movimiento_cc_cliente} no encontrado`);
    }

    const orig = mov.rows[0];
    const debeOrig = parseFloat(orig.debe) || 0;
    const haberOrig = parseFloat(orig.haber) || 0;

    // 2. Crear contra-asiento (invierte debe/haber)
    const contraAsiento = await registrarMovimiento(client, {
        id_empresa: orig.id_empresa,
        id_cliente: orig.id_cliente,
        monto: debeOrig > 0 ? debeOrig : haberOrig,
        tipo: debeOrig > 0 ? 'haber' : 'debe',
        concepto: `[ANULACIÓN] ${motivo} - Ref: ${orig.concepto}`,
        id_pago: orig.id_pago,
        id_factura: orig.id_factura
    });

    logger.warn(`CC Anulado mov #${id_movimiento_cc_cliente} con contra-asiento #${contraAsiento.id_movimiento_cc_cliente}`);
    return contraAsiento;
}

module.exports = {
    obtenerSaldo,
    recalcularSaldo,
    registrarMovimiento,
    eliminarMovimiento,
    anularMovimiento
};
