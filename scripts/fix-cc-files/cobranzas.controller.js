/**
 * COBRANZAS CONTROLLER - ERP LAGO
 * Cuenta corriente de clientes: resumen y movimientos
 *
 * ACTUALIZADO: 2026-02-16
 * - getCuentaCorriente: resumen desde facturas/recibos (ya existía)
 * - getMovimientosCC: NUEVO - libro CC desde tabla cuentacorrienteclientes
 */

const pool = require('../config/database');
const logger = require('../utils/logger');

// ============================================================
// RESUMEN CUENTA CORRIENTE (desde facturas/recibos)
// ============================================================
exports.getCuentaCorriente = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_cliente } = req.params;

    try {
        // Total DEBE (facturas emitidas)
        const debeRes = await pool.query(`
            SELECT COALESCE(SUM(total), 0) as total_facturado
            FROM facturas
            WHERE id_cliente = $1 AND id_empresa = $2
              AND estado IN ('emitida', 'parcial', 'pagada')
        `, [id_cliente, id_empresa]);

        // Total HABER (todos los recibos - cobros reales)
        const haberRes = await pool.query(`
            SELECT COALESCE(SUM(total_recibo), 0) as total_cobrado
            FROM recibos
            WHERE id_cliente = $1 AND id_empresa = $2
              AND total_recibo > 0
        `, [id_cliente, id_empresa]);

        const totalFacturado = parseFloat(debeRes.rows[0].total_facturado) || 0;
        const totalCobrado = parseFloat(haberRes.rows[0].total_cobrado) || 0;
        const saldoPendiente = totalFacturado - totalCobrado;

        // Facturas pendientes con detalle
        const facturasRes = await pool.query(`
            SELECT f.id_factura, f.numero_completo, f.fecha_emision, f.fecha_vencimiento,
                   f.total, COALESCE(f.monto_pagado, 0) as pagado,
                   (f.total - COALESCE(f.monto_pagado, 0)) as saldo, f.estado
            FROM facturas f
            WHERE f.id_cliente = $1 AND f.id_empresa = $2
              AND f.estado IN ('emitida', 'parcial')
              AND (f.total - COALESCE(f.monto_pagado, 0)) > 0.01
            ORDER BY f.fecha_emision ASC
        `, [id_cliente, id_empresa]);

        // Saldo a favor
        const saldoAFavor = totalCobrado > totalFacturado ? totalCobrado - totalFacturado : 0;

        // Pagos a cuenta
        const aCuentaRes = await pool.query(`
            SELECT COALESCE(SUM(r.total_recibo), 0) - COALESCE(SUM(rf.total_aplicado), 0) as a_cuenta
            FROM recibos r
            LEFT JOIN (
                SELECT id_recibo, SUM(monto_aplicado) as total_aplicado
                FROM recibo_facturas
                GROUP BY id_recibo
            ) rf ON r.id_recibo = rf.id_recibo
            WHERE r.id_cliente = $1 AND r.id_empresa = $2
        `, [id_cliente, id_empresa]);

        const pagosACuenta = parseFloat(aCuentaRes.rows[0].a_cuenta) || 0;

        res.json({
            resumen: {
                total_facturado: totalFacturado,
                total_cobrado: totalCobrado,
                saldo_pendiente: saldoPendiente > 0 ? saldoPendiente : 0,
                saldo_a_favor: saldoAFavor,
                pagos_a_cuenta: pagosACuenta
            },
            facturas: facturasRes.rows
        });
    } catch (error) {
        logger.error('Error cuenta corriente:', error.message);
        res.status(500).json({ error: 'Error al obtener cuenta corriente' });
    }
};

// ============================================================
// MOVIMIENTOS CC - Libro de cuenta corriente (tabla cuentacorrienteclientes)
// Saldo corrido calculado con window function
// ============================================================
exports.getMovimientosCC = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_cliente } = req.params;
    const { fecha_desde, fecha_hasta, limite = 200, offset = 0 } = req.query;

    try {
        // Saldo corrido calculado al vuelo con window function
        // NO depende del campo 'saldo' almacenado (puede estar desactualizado)
        let query = `
            SELECT
                cc.id_movimiento_cc_cliente,
                cc.fecha,
                cc.concepto,
                cc.debe,
                cc.haber,
                SUM(COALESCE(cc.debe, 0) - COALESCE(cc.haber, 0))
                    OVER (ORDER BY cc.fecha ASC, cc.id_movimiento_cc_cliente ASC) as saldo,
                cc.id_factura,
                cc.id_pago,
                f.numero_completo as factura_numero,
                r.numero_completo as recibo_numero
            FROM cuentacorrienteclientes cc
            LEFT JOIN facturas f ON cc.id_factura = f.id_factura
            LEFT JOIN recibos r ON cc.id_pago = r.id_recibo
            WHERE cc.id_cliente = $1 AND cc.id_empresa = $2
        `;
        const params = [parseInt(id_cliente, 10), id_empresa];
        let idx = 3;

        if (fecha_desde) {
            query += ` AND DATE(cc.fecha) >= $${idx}`;
            params.push(fecha_desde);
            idx++;
        }
        if (fecha_hasta) {
            query += ` AND DATE(cc.fecha) <= $${idx}`;
            params.push(fecha_hasta);
            idx++;
        }

        // Wrap para ordenar DESC después del cálculo de window
        query = `SELECT * FROM (${query}) sub ORDER BY fecha DESC, id_movimiento_cc_cliente DESC`;
        query += ` LIMIT $${idx} OFFSET $${idx + 1}`;
        params.push(parseInt(limite, 10), parseInt(offset, 10));

        const { rows } = await pool.query(query, params);

        // Total de registros (para paginación)
        let countQuery = `
            SELECT COUNT(*) as total
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        `;
        const countParams = [parseInt(id_cliente, 10), id_empresa];
        let countIdx = 3;

        if (fecha_desde) {
            countQuery += ` AND DATE(fecha) >= $${countIdx}`;
            countParams.push(fecha_desde);
            countIdx++;
        }
        if (fecha_hasta) {
            countQuery += ` AND DATE(fecha) <= $${countIdx}`;
            countParams.push(fecha_hasta);
            countIdx++;
        }

        const countRes = await pool.query(countQuery, countParams);

        // Saldo actual (calculado, no del campo)
        const saldoRes = await pool.query(`
            SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        `, [parseInt(id_cliente, 10), id_empresa]);

        const saldoActual = parseFloat(saldoRes.rows[0].saldo) || 0;

        res.json({
            movimientos: rows,
            saldo_actual: saldoActual,
            total: parseInt(countRes.rows[0].total),
            limite: parseInt(limite, 10),
            offset: parseInt(offset, 10)
        });
    } catch (error) {
        logger.error('Error movimientos CC:', error.message);
        res.status(500).json({ error: 'Error al obtener movimientos de cuenta corriente' });
    }
};
