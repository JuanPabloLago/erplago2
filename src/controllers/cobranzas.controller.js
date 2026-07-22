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
const cobranzaHelper = require('../utils/cobranza.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const cfgHelper = require('../utils/config.helper');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const RESUMEN_CC_TPL = path.join(__dirname, '..', '..', 'templates', 'comprobantes', 'resumen_cc.hbs');

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
            WHERE id_cliente = $1 AND id_empresa = $2 AND tipo = 'cobro'
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


/** GET .../libro — libro mayor con saldo anterior, origen y paginado por config */
async function getLibro(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const { desde, hasta, pagina, busqueda, id_forma_pago } = req.query;
        const data = await ccClientesHelper.obtenerLibro(pool, {
            id_empresa, id_cliente: parseInt(id_cliente, 10),
            desde, hasta, pagina, busqueda, id_forma_pago
        });
        res.json(data);
    } catch (e) {
        logger.error('getLibro: ' + e.message);
        res.status(e.statusCode || 500).json({ error: e.message });
    }
}

/** GET .../libro/export — CSV locale AR (; BOM coma decimal), respeta filtros */
async function exportarLibroCSV(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const { desde, hasta, busqueda, id_forma_pago } = req.query;
        const data = await ccClientesHelper.obtenerLibro(pool, {
            id_empresa, id_cliente: parseInt(id_cliente, 10),
            desde, hasta, busqueda, id_forma_pago,
            pagina: 1, items_por_pagina: 100000
        });
        const fmt = n => Number(n || 0).toFixed(2).replace('.', ',');
        const fch = d => new Date(d).toLocaleDateString('es-AR');
        const q = s => '"' + String(s || '').replace(/"/g, '""') + '"';
        const filas = ['Fecha;Concepto;Debe;Haber;Saldo'];
        if (desde) filas.push(`;${q('Saldo anterior al ' + desde)};;;${fmt(data.saldo_anterior)}`);
        // El libro viene DESC; el CSV se lee cronologico
        [...data.movimientos].reverse().forEach(m =>
            filas.push(`${fch(m.fecha)};${q(m.concepto)};${fmt(m.debe)};${fmt(m.haber)};${fmt(m.saldo)}`));
        filas.push(`;TOTALES;${fmt(data.totales.debe)};${fmt(data.totales.haber)};${fmt(data.saldo_actual)}`);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition',
            `attachment; filename="CC_libro_${id_cliente}_${new Date().toLocaleDateString('es-AR').replace(/\//g, '-')}.csv"`);
        res.send('\uFEFF' + filas.join('\r\n'));
    } catch (e) {
        logger.error('exportarLibroCSV: ' + e.message);
        res.status(e.statusCode || 500).json({ error: e.message });
    }
}

/** POST .../cobrar — cobro con imputacion via cobranza.helper (transaccion unica) */
async function registrarCobro(req, res) {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_cliente } = req.params;
        const { items_pago, imputaciones, modo, concepto, observaciones } = req.body;
        await client.query('BEGIN');
        const r = await cobranzaHelper.registrarCobranza(client, {
            id_empresa, id_cliente: parseInt(id_cliente, 10), id_usuario,
            items_pago, imputaciones, modo, concepto, observaciones
        });
        await client.query('COMMIT');
        res.status(201).json(Object.assign({ success: true }, r));
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('registrarCobro: ' + e.message);
        res.status(e.statusCode || 500).json({ error: e.message, code: e.code || null });
    } finally { client.release(); }
}


/** GET .../resumen/html — resumen imprimible para el cliente.
 *  Reusa obtenerLibro (single source: pantalla, CSV y resumen dicen lo mismo).
 *  Formatos AR calculados aca; la plantilla es tonta (sin registerHelper global). */
async function getResumenHTML(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const { desde, hasta } = req.query;

        const cliRes = await pool.query(
            `SELECT razon_social, cuit_cuil, domicilio FROM clientes
             WHERE id_cliente = $1 AND id_empresa = $2`, [id_cliente, id_empresa]);
        if (!cliRes.rows.length) return res.status(404).send('Cliente no encontrado');

        const data = await ccClientesHelper.obtenerLibro(pool, {
            id_empresa, id_cliente: parseInt(id_cliente, 10),
            desde, hasta, pagina: 1, items_por_pagina: 100000
        });

        const empresa = await cfgHelper.getPrefix(pool, id_empresa, 'empresa.');
        const mostrarLogo = String(await cfgHelper.get(pool, id_empresa, 'cc.resumen.mostrar_logo', 'true')) !== 'false';
        const logoUrl = (empresa['empresa.logo_url'] || empresa.logo_url || '').trim();

        const money = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fch = d => new Date(d).toLocaleDateString('es-AR');
        const emp = {};
        Object.keys(empresa).forEach(k => { emp[k.replace('empresa.', '')] = empresa[k]; });

        const movs = [...data.movimientos].reverse().map(m => ({
            fecha_fmt: fch(m.fecha), concepto: m.concepto,
            debe_fmt: parseFloat(m.debe) > 0 ? money(m.debe) : '',
            haber_fmt: parseFloat(m.haber) > 0 ? money(m.haber) : '',
            saldo_fmt: money(m.saldo)
        }));

        const tpl = Handlebars.compile(fs.readFileSync(RESUMEN_CC_TPL, 'utf-8'));
        const ahora = new Date();
        res.send(tpl({
            empresa: emp,
            logo_url: (mostrarLogo && logoUrl) ? logoUrl : null,
            cliente: cliRes.rows[0],
            movimientos: movs,
            mostrar_saldo_anterior: !!desde,
            desde_fmt: desde ? fch(desde + 'T12:00:00') : '',
            saldo_anterior_fmt: money(data.saldo_anterior),
            total_debe_fmt: money(data.totales.debe),
            total_haber_fmt: money(data.totales.haber),
            saldo_actual_fmt: money(data.saldo_actual),
            saldo_a_favor: data.saldo_actual < 0,
            rango: (desde || hasta) ? `${desde ? 'desde ' + fch(desde + 'T12:00:00') : ''}${hasta ? ' hasta ' + fch(hasta + 'T12:00:00') : ''}`.trim() : 'historial completo',
            fecha_emision: ahora.toLocaleDateString('es-AR'),
            hora_emision: ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        }));
    } catch (e) {
        logger.error('getResumenHTML: ' + e.message);
        res.status(e.statusCode || 500).send('Error generando resumen: ' + e.message);
    }
}


/** GET .../form-data-cobro — formas_pago activas con estética del método equivalente.
 *  DOMINIO CORRECTO: recibo_items exige formas_pago; /formas-pago/activos devuelve
 *  metodosdepago (otro catálogo) y usarlo cruzaría ids en silencio. */
async function getFormDataCobro(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const fpRes = await pool.query(`
            SELECT fp.id_forma_pago, fp.nombre, fp.codigo, fp.requiere_referencia,
                   mp.tipo_cuenta, mp.icono, mp.color_clase, mp.orden
            FROM formas_pago fp
            JOIN metodosdepago mp ON mp.id_metodo_pago = fp.id_metodo_pago_caja
            WHERE fp.id_empresa = $1 AND fp.activo = true
            ORDER BY mp.orden, fp.id_forma_pago`, [id_empresa]);
        const wpPlantilla = await cfgHelper.get(pool, id_empresa,
            'cc.resumen.whatsapp_plantilla', 'Resumen de cuenta al {fecha}. Saldo: {saldo}.');
        res.json({ formas_pago: fpRes.rows, whatsapp_plantilla: wpPlantilla });
    } catch (e) {
        logger.error('getFormDataCobro: ' + e.message);
        res.status(500).json({ error: e.message });
    }
}

/** GET .../aging — deuda fiada por antigüedad (0-30/30-60/60-90/+90).
 *  Fuente: pedidos fiados con saldo en v_saldo_pedidos (misma base que el modal). */
async function getAging(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.params;
        const r = await pool.query(`
            SELECT
              COALESCE(SUM(saldo) FILTER (WHERE edad <= 30), 0)               AS d0_30,
              COALESCE(SUM(saldo) FILTER (WHERE edad > 30 AND edad <= 60), 0) AS d30_60,
              COALESCE(SUM(saldo) FILTER (WHERE edad > 60 AND edad <= 90), 0) AS d60_90,
              COALESCE(SUM(saldo) FILTER (WHERE edad > 90), 0)                AS d90_mas,
              COUNT(*) AS pedidos_pendientes
            FROM (
              SELECT COALESCE(sp.saldo, 0) AS saldo,
                     EXTRACT(DAY FROM now() - p.fecha_creacion) AS edad
              FROM pedidos p
              JOIN pedidoestados pe ON pe.id_estado = p.id_estado
              LEFT JOIN v_saldo_pedidos sp ON sp.id_pedido = p.id_pedido
              WHERE p.id_empresa = $1 AND p.id_cliente = $2
                AND p.es_fiado = true AND pe.computa_deuda = true
                AND COALESCE(sp.saldo, 0) > 0.01
            ) t`, [id_empresa, id_cliente]);
        res.json(r.rows[0]);
    } catch (e) {
        logger.error('getAging: ' + e.message);
        res.status(500).json({ error: e.message });
    }
}


/** POST .../devolver — devolución de dinero (documento tipo devolucion, monto positivo) */
async function registrarDevolucionCtrl(req, res) {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_cliente } = req.params;
        const { items_pago, motivo } = req.body;
        await client.query('BEGIN');
        const r = await cobranzaHelper.registrarDevolucion(client, {
            id_empresa, id_cliente: parseInt(id_cliente, 10), id_usuario, items_pago, motivo
        });
        await client.query('COMMIT');
        res.status(201).json(Object.assign({ success: true }, r));
    } catch (e) {
        await client.query('ROLLBACK');
        logger.error('registrarDevolucion: ' + e.message);
        res.status(e.statusCode || 500).json({ error: e.message, code: e.code || null });
    } finally { client.release(); }
}

module.exports = {
    getCuentaCorriente,
    getMovimientosCC,
    exportarMovimientosExcel,
    getLibro,
    exportarLibroCSV,
    registrarCobro,
    registrarDevolucionCtrl,
    getResumenHTML,
    getFormDataCobro,
    getAging
};
