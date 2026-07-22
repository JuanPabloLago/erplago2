/**
 * ════════════════════════════════════════════════════════════════════════════════
 * COBRANZAS CONTROLLER v3 - ERP LAGO
 * Cuenta corriente de clientes - Endpoints
 *
 * v3 (2026-02-16):
 * - getMovimientosCC con filtros: tipo, fecha, método pago, búsqueda
 * - Saldo corrido calculado al vuelo con window function
 * - Saldo actual calculado con SUM (no depende de campo almacenado)
 * - getResumenCC: datos de cabecera (total facturado, cobrado, pagos a cuenta)
 *
 * Endpoints:
 * GET /api/cobranzas/cuenta-corriente/:id_cliente              → Resumen
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/movimientos   → Libro CC
 * ════════════════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');
const logger = require('../utils/logger');

/**
 * GET /api/cobranzas/cuenta-corriente/:id_cliente
 * Resumen de CC: total facturado, cobrado, pagos a cuenta, saldo
 */
async function getCuentaCorriente(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;

        // Datos del cliente
        const clienteRes = await pool.query(`
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil, c.domicilio,
                   c.telefono, c.email, c.saldo_actual,
                   ci.nombre as condicion_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
        `, [id_cliente, id_empresa]);

        if (clienteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        // Saldo real calculado desde tabla CC (fuente de verdad)
        const saldoRes = await pool.query(`
            SELECT
                COALESCE(SUM(debe), 0) as total_debe,
                COALESCE(SUM(haber), 0) as total_haber,
                COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        `, [id_cliente, id_empresa]);

        // Total facturado (facturas emitidas)
        const factRes = await pool.query(`
            SELECT COALESCE(SUM(total), 0) as total_facturado,
                   COUNT(*) as cantidad_facturas
            FROM facturas
            WHERE id_cliente = $1 AND id_empresa = $2 AND estado != 'anulada'
        `, [id_cliente, id_empresa]);

        // Total cobrado (recibos)
        const recRes = await pool.query(`
            SELECT COALESCE(SUM(total_recibo), 0) as total_cobrado,
                   COUNT(*) as cantidad_recibos
            FROM recibos
            WHERE id_cliente = $1 AND id_empresa = $2
        `, [id_cliente, id_empresa]);

        // Pagos a cuenta (haber sin debe correspondiente - simplificado)
        const pagosCuentaRes = await pool.query(`
            SELECT COALESCE(SUM(haber), 0) as pagos_a_cuenta
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
            AND concepto ILIKE '%a cuenta%'
        `, [id_cliente, id_empresa]);

        const saldo = saldoRes.rows[0];
        const fact = factRes.rows[0];
        const rec = recRes.rows[0];

        res.json({
            cliente: clienteRes.rows[0],
            saldo_cc: parseFloat(saldo.saldo) || 0,
            total_debe: parseFloat(saldo.total_debe) || 0,
            total_haber: parseFloat(saldo.total_haber) || 0,
            total_facturado: parseFloat(fact.total_facturado) || 0,
            cantidad_facturas: parseInt(fact.cantidad_facturas) || 0,
            total_cobrado: parseFloat(rec.total_cobrado) || 0,
            cantidad_recibos: parseInt(rec.cantidad_recibos) || 0,
            pagos_a_cuenta: parseFloat(pagosCuentaRes.rows[0].pagos_a_cuenta) || 0
        });

    } catch (error) {
        logger.error('Error en getCuentaCorriente:', error);
        res.status(500).json({ error: 'Error al obtener cuenta corriente' });
    }
}

/**
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/movimientos
 *
 * Libro de movimientos CC con saldo corrido calculado al vuelo.
 *
 * Query params:
 * - tipo: 'debe' | 'haber' | 'todos' (default: 'todos')
 * - fecha_desde: ISO date (ej: '2026-01-01')
 * - fecha_hasta: ISO date
 * - busqueda: texto libre (busca en concepto)
 * - metodo_pago: filtra por nombre de método en concepto (ej: 'Efectivo')
 * - limite: paginación (default: 200)
 * - offset: paginación (default: 0)
 * - orden: 'asc' | 'desc' (default: 'desc')
 */
async function getMovimientosCC(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const {
            tipo = 'todos',
            fecha_desde,
            fecha_hasta,
            busqueda,
            metodo_pago,
            limite = 200,
            offset = 0,
            orden = 'desc'
        } = req.query;

        // ── Construir WHERE dinámico ──
        const conditions = ['cc.id_cliente = $1', 'cc.id_empresa = $2'];
        const params = [id_cliente, id_empresa];
        let paramIdx = 3;

        // Filtro tipo (debe/haber)
        if (tipo === 'debe') {
            conditions.push('cc.debe > 0');
        } else if (tipo === 'haber') {
            conditions.push('cc.haber > 0');
        }

        // Filtro fecha
        if (fecha_desde) {
            conditions.push(`cc.fecha >= $${paramIdx}`);
            params.push(fecha_desde);
            paramIdx++;
        }
        if (fecha_hasta) {
            conditions.push(`cc.fecha <= ($${paramIdx}::date + interval '1 day')`);
            params.push(fecha_hasta);
            paramIdx++;
        }

        // Filtro búsqueda en concepto
        if (busqueda) {
            conditions.push(`cc.concepto ILIKE $${paramIdx}`);
            params.push(`%${busqueda}%`);
            paramIdx++;
        }

        // Filtro método de pago (busca en concepto: "- Efectivo", "- MercadoPago", etc.)
        if (metodo_pago) {
            conditions.push(`cc.concepto ILIKE $${paramIdx}`);
            params.push(`%${metodo_pago}%`);
            paramIdx++;
        }

        const whereClause = conditions.join(' AND ');

        // ── Contar total (para paginación) ──
        const countRes = await pool.query(
            `SELECT COUNT(*) as total FROM cuentacorrienteclientes cc WHERE ${whereClause}`,
            params
        );
        const total = parseInt(countRes.rows[0].total);

        // ── Query principal con saldo corrido calculado al vuelo ──
        // El saldo corrido SIEMPRE se calcula sobre TODOS los movimientos (sin filtros)
        // para que sea correcto. Los filtros solo aplican al display.
        const orderDir = orden === 'asc' ? 'ASC' : 'DESC';

        const movRes = await pool.query(`
            WITH todos_los_movs AS (
                SELECT
                    id_movimiento_cc_cliente,
                    SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                        OVER (ORDER BY fecha ASC, id_movimiento_cc_cliente ASC) as saldo_corrido
                FROM cuentacorrienteclientes
                WHERE id_cliente = $1 AND id_empresa = $2
            )
            SELECT
                cc.id_movimiento_cc_cliente,
                cc.fecha,
                cc.concepto,
                cc.id_pago,
                cc.id_factura,
                COALESCE(cc.debe, 0) as debe,
                COALESCE(cc.haber, 0) as haber,
                t.saldo_corrido as saldo
            FROM cuentacorrienteclientes cc
            JOIN todos_los_movs t ON cc.id_movimiento_cc_cliente = t.id_movimiento_cc_cliente
            WHERE ${whereClause}
            ORDER BY cc.fecha ${orderDir}, cc.id_movimiento_cc_cliente ${orderDir}
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `, [...params, parseInt(limite), parseInt(offset)]);

        // ── Saldo actual (calculado, no del campo) ──
        const saldoRes = await pool.query(`
            SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        `, [id_cliente, id_empresa]);

        // ── Resumen de totales filtrados ──
        const resumenRes = await pool.query(`
            SELECT
                COALESCE(SUM(cc.debe), 0) as total_debe_filtrado,
                COALESCE(SUM(cc.haber), 0) as total_haber_filtrado
            FROM cuentacorrienteclientes cc
            WHERE ${whereClause}
        `, params);

        res.json({
            movimientos: movRes.rows,
            saldo_actual: parseFloat(saldoRes.rows[0].saldo) || 0,
            total: total,
            limite: parseInt(limite),
            offset: parseInt(offset),
            filtros_aplicados: {
                tipo, fecha_desde, fecha_hasta, busqueda, metodo_pago
            },
            resumen_filtrado: {
                total_debe: parseFloat(resumenRes.rows[0].total_debe_filtrado) || 0,
                total_haber: parseFloat(resumenRes.rows[0].total_haber_filtrado) || 0
            }
        });

    } catch (error) {
        logger.error('Error en getMovimientosCC:', error);
        res.status(500).json({ error: 'Error al obtener movimientos CC' });
    }
}

module.exports = {
    getCuentaCorriente,
    getMovimientosCC
};
