/**
 * ════════════════════════════════════════════════════════════════════════════════
 * COBRANZAS CONTROLLER v4 - ERP LAGO
 * Cuenta corriente de clientes - Endpoints
 *
 * v4 (2026-02-16):
 * - Cards con nombres de negocio (Deuda Actual, Total Compras, Total Pagado)
 * - Exportación Excel (.xlsx) con ExcelJS
 * - getResumenCC devuelve también datos de contacto del cliente
 * - getMovimientosCC: saldo corrido con window function, filtros completos
 *
 * Endpoints:
 * GET /api/cobranzas/cuenta-corriente/:id_cliente              → Resumen
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/movimientos   → Libro CC
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/exportar      → Excel (.xlsx)
 * ════════════════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');
const logger = require('../utils/logger');

/**
 * GET /api/cobranzas/cuenta-corriente/:id_cliente
 * Resumen de CC: saldo, total compras, total pagado, facturado AFIP
 */
async function getCuentaCorriente(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;

        // Datos del cliente
        const clienteRes = await pool.query(`
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil, c.domicilio,
                   c.telefono, c.email, c.saldo_actual, c.limite_credito,
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

        // Total facturado AFIP (facturas emitidas no anuladas)
        const factRes = await pool.query(`
            SELECT COALESCE(SUM(total), 0) as total_facturado,
                   COUNT(*) as cantidad_facturas
            FROM facturas
            WHERE id_cliente = $1 AND id_empresa = $2 AND estado != 'anulada'
        `, [id_cliente, id_empresa]);

        // Total cobrado via recibos
        const recRes = await pool.query(`
            SELECT COALESCE(SUM(total_recibo), 0) as total_cobrado,
                   COUNT(*) as cantidad_recibos
            FROM recibos
            WHERE id_cliente = $1 AND id_empresa = $2
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
            cantidad_recibos: parseInt(rec.cantidad_recibos) || 0
        });

    } catch (error) {
        logger.error('Error en getCuentaCorriente:', error);
        res.status(500).json({ error: 'Error al obtener cuenta corriente' });
    }
}

/**
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/movimientos
 * Libro de movimientos CC con saldo corrido calculado al vuelo.
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

        if (tipo === 'debe') {
            conditions.push('cc.debe > 0');
        } else if (tipo === 'haber') {
            conditions.push('cc.haber > 0');
        }

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

        if (busqueda) {
            conditions.push(`cc.concepto ILIKE $${paramIdx}`);
            params.push(`%${busqueda}%`);
            paramIdx++;
        }

        if (metodo_pago) {
            conditions.push(`cc.concepto ILIKE $${paramIdx}`);
            params.push(`%${metodo_pago}%`);
            paramIdx++;
        }

        const whereClause = conditions.join(' AND ');

        // ── Contar total ──
        const countRes = await pool.query(
            `SELECT COUNT(*) as total FROM cuentacorrienteclientes cc WHERE ${whereClause}`,
            params
        );
        const total = parseInt(countRes.rows[0].total);

        // ── Query principal con saldo corrido ──
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

        // ── Saldo actual ──
        const saldoRes = await pool.query(`
            SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
            FROM cuentacorrienteclientes
            WHERE id_cliente = $1 AND id_empresa = $2
        `, [id_cliente, id_empresa]);

        // ── Resumen filtrado ──
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
            filtros_aplicados: { tipo, fecha_desde, fecha_hasta, busqueda, metodo_pago },
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

/**
 * GET /api/cobranzas/cuenta-corriente/:id_cliente/exportar
 * Exporta movimientos CC a Excel (.xlsx)
 * Query params: mismos filtros que getMovimientosCC
 */
async function exportarMovimientosExcel(req, res) {
    let ExcelJS;
    try {
        ExcelJS = require('exceljs');
    } catch (e) {
        logger.error('ExcelJS no instalado. Ejecutar: npm install exceljs --save');
        return res.status(500).json({ error: 'Módulo exceljs no disponible. Instalar con: npm install exceljs --save' });
    }

    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const { tipo = 'todos', fecha_desde, fecha_hasta, busqueda, metodo_pago } = req.query;

        // Datos del cliente
        const clienteRes = await pool.query(
            `SELECT razon_social, cuit_cuil FROM clientes WHERE id_cliente = $1 AND id_empresa = $2`,
            [id_cliente, id_empresa]
        );
        if (clienteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        const cliente = clienteRes.rows[0];

        // ── WHERE dinámico (misma lógica que getMovimientosCC) ──
        const conditions = ['cc.id_cliente = $1', 'cc.id_empresa = $2'];
        const params = [id_cliente, id_empresa];
        let paramIdx = 3;

        if (tipo === 'debe') { conditions.push('cc.debe > 0'); }
        else if (tipo === 'haber') { conditions.push('cc.haber > 0'); }

        if (fecha_desde) { conditions.push(`cc.fecha >= $${paramIdx}`); params.push(fecha_desde); paramIdx++; }
        if (fecha_hasta) { conditions.push(`cc.fecha <= ($${paramIdx}::date + interval '1 day')`); params.push(fecha_hasta); paramIdx++; }
        if (busqueda) { conditions.push(`cc.concepto ILIKE $${paramIdx}`); params.push(`%${busqueda}%`); paramIdx++; }
        if (metodo_pago) { conditions.push(`cc.concepto ILIKE $${paramIdx}`); params.push(`%${metodo_pago}%`); paramIdx++; }

        const whereClause = conditions.join(' AND ');

        // ── Query con saldo corrido ──
        const movRes = await pool.query(`
            WITH todos_los_movs AS (
                SELECT id_movimiento_cc_cliente,
                    SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                        OVER (ORDER BY fecha ASC, id_movimiento_cc_cliente ASC) as saldo_corrido
                FROM cuentacorrienteclientes
                WHERE id_cliente = $1 AND id_empresa = $2
            )
            SELECT cc.fecha, cc.concepto, COALESCE(cc.debe, 0) as debe,
                   COALESCE(cc.haber, 0) as haber, t.saldo_corrido as saldo
            FROM cuentacorrienteclientes cc
            JOIN todos_los_movs t ON cc.id_movimiento_cc_cliente = t.id_movimiento_cc_cliente
            WHERE ${whereClause}
            ORDER BY cc.fecha ASC, cc.id_movimiento_cc_cliente ASC
        `, params);

        // ── Generar Excel ──
        const wb = new ExcelJS.Workbook();
        wb.creator = 'ERP LAGO';
        wb.created = new Date();

        const ws = wb.addWorksheet('Cuenta Corriente');

        // Encabezado
        ws.mergeCells('A1:E1');
        ws.getCell('A1').value = `Cuenta Corriente - ${cliente.razon_social}`;
        ws.getCell('A1').font = { size: 14, bold: true };

        ws.mergeCells('A2:E2');
        ws.getCell('A2').value = `CUIT: ${cliente.cuit_cuil || 'S/D'} | Exportado: ${new Date().toLocaleDateString('es-AR')}`;
        ws.getCell('A2').font = { size: 10, color: { argb: '666666' } };

        // Fila vacía
        ws.addRow([]);

        // Headers de tabla
        const headerRow = ws.addRow(['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo']);
        headerRow.eachCell(cell => {
            cell.font = { bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0D6EFD' } };
            cell.alignment = { horizontal: 'center' };
        });

        // Datos
        for (const m of movRes.rows) {
            const fecha = new Date(m.fecha);
            const debe = parseFloat(m.debe) || 0;
            const haber = parseFloat(m.haber) || 0;
            const saldo = parseFloat(m.saldo) || 0;

            const row = ws.addRow([fecha, m.concepto, debe, haber, saldo]);
            row.getCell(1).numFmt = 'DD/MM/YYYY HH:mm';
            row.getCell(3).numFmt = '#,##0.00';
            row.getCell(4).numFmt = '#,##0.00';
            row.getCell(5).numFmt = '#,##0.00';

            if (debe > 0) row.getCell(3).font = { color: { argb: 'DC3545' } };
            if (haber > 0) row.getCell(4).font = { color: { argb: '198754' } };
            if (saldo > 0) {
                row.getCell(5).font = { bold: true, color: { argb: 'DC3545' } };
            } else {
                row.getCell(5).font = { bold: true, color: { argb: '198754' } };
            }
        }

        // Fila de totales
        ws.addRow([]);
        const totalRow = ws.addRow([
            '', 'TOTALES',
            movRes.rows.reduce((s, m) => s + (parseFloat(m.debe) || 0), 0),
            movRes.rows.reduce((s, m) => s + (parseFloat(m.haber) || 0), 0),
            movRes.rows.length > 0 ? parseFloat(movRes.rows[movRes.rows.length - 1].saldo) || 0 : 0
        ]);
        totalRow.eachCell(cell => { cell.font = { bold: true }; });
        totalRow.getCell(3).numFmt = '#,##0.00';
        totalRow.getCell(4).numFmt = '#,##0.00';
        totalRow.getCell(5).numFmt = '#,##0.00';

        // Anchos de columna
        ws.getColumn(1).width = 18;
        ws.getColumn(2).width = 50;
        ws.getColumn(3).width = 16;
        ws.getColumn(4).width = 16;
        ws.getColumn(5).width = 18;

        // Enviar
        const nombreArchivo = `CC_${cliente.razon_social.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

        await wb.xlsx.write(res);
        res.end();

    } catch (error) {
        logger.error('Error exportando Excel CC:', error);
        res.status(500).json({ error: 'Error al exportar' });
    }
}

module.exports = {
    getCuentaCorriente,
    getMovimientosCC,
    exportarMovimientosExcel
};
