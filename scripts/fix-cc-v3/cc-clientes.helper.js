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
async function obtenerNombreMetodo(client, id_metodo_pago) {
    if (_cacheMetodos[id_metodo_pago]) return _cacheMetodos[id_metodo_pago];

    const { rows } = await client.query(
        'SELECT nombre FROM metodosdepago WHERE id_metodo_pago = $1',
        [id_metodo_pago]
    );

    const nombre = rows[0]?.nombre || _fallbackNombreMetodo(id_metodo_pago);
    _cacheMetodos[id_metodo_pago] = nombre;
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
    if (!id_cliente) return true; // Sin cliente = CF implícito

    const { rows } = await client.query(`
        SELECT ci.nombre as condicion
        FROM clientes c
        LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
        WHERE c.id_cliente = $1 AND c.id_empresa = $2
    `, [id_cliente, id_empresa]);

    if (rows.length === 0) return true;

    const condicion = (rows[0].condicion || '').toLowerCase();
    return condicion.includes('consumidor final');
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

    // 1. Obtener saldo anterior (calculado)
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
        concepto_prefijo = 'Venta Pedido'
    } = params;

    const montoPago = parseFloat(monto);
    if (!montoPago || montoPago <= 0) return null;
    if (!id_cliente) return null;

    // Excluir Consumidor Final
    const esCF = await esConsumidorFinal(client, id_empresa, id_cliente);
    if (esCF) return null;

    // 1. DEBE siempre → el cliente tiene una deuda por la compra
    const movDebe = await registrarMovimiento(client, {
        id_empresa, id_cliente, monto: montoPago, tipo: 'debe',
        concepto: `${concepto_prefijo} #${id_pedido}`, id_pago
    });

    // 2. Si NO es fiado (método != 6) → HABER inmediato (pago al contado)
    let movHaber = null;
    if (id_metodo_pago !== 6) {
        const nombreMetodo = await obtenerNombreMetodo(client, id_metodo_pago);
        movHaber = await registrarMovimiento(client, {
            id_empresa, id_cliente, monto: montoPago, tipo: 'haber',
            concepto: `Pago Pedido #${id_pedido} - ${nombreMetodo}`, id_pago
        });
    }

    return { debe: movDebe, haber: movHaber };
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
module.exports = {
    obtenerSaldo,
    recalcularSaldo,
    registrarMovimiento,
    registrarVentaConPago,
    eliminarMovimiento,
    anularMovimiento,
    esConsumidorFinal,
    obtenerNombreMetodo
};
