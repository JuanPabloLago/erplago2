/**
 * RECIBOS CONTROLLER - ERP LAGO
 * MIGRADO FASE 8a: Escrituras via recibos.helper.js + helpers existentes
 *
 * Helpers utilizados:
 *   recibos.helper.js — recibos, recibo_items, recibo_facturas, movimientos_caja
 *   facturacion.helper.js — actualizar monto_pagado en facturas
 *   caja.helper.js — registrar movimientos de caja (efectivo)
 *   cc-clientes.helper.js — registrar movimientos CC cliente
 */

const pool = require('../config/database');
const logger = require('../utils/logger');
const cajaHelper = require('../utils/caja.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const facturacionHelper = require('../utils/facturacion.helper');
const recibosHelper = require('../utils/recibos.helper');

// Helper: Obtener cotización actual de una moneda
async function obtenerCotizacion(client, id_moneda, id_empresa) {
    if (id_moneda === 1) return 1;
    const { rows } = await client.query(
        `SELECT cotizacion_compra FROM cotizaciones WHERE id_empresa = $1 AND id_moneda = $2
         ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC LIMIT 1`,
        [id_empresa, id_moneda]
    );
    return rows.length > 0 ? parseFloat(rows[0].cotizacion_compra) : 1;
}

// ============================================================
// CREAR RECIBO CON APLICACIÓN AUTOMÁTICA FIFO
// ============================================================
exports.crear = async (req, res) => {
    if (!req.usuario || !req.usuario.id_empresa || !req.usuario.id_usuario) {
        logger.error('❌ Error: req.usuario no definido correctamente');
        return res.status(401).json({ error: 'Usuario no autenticado correctamente' });
    }

    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.usuario.id_usuario, 10);

    if (isNaN(id_empresa) || id_empresa <= 0) {
        return res.status(400).json({ error: 'ID de empresa inválido' });
    }

    const { id_cliente, total_recibo, concepto, observaciones, pagos, id_turno, id_moneda_recibo, es_a_cuenta } = req.body;

    if (!id_cliente || !total_recibo || !pagos || pagos.length === 0) {
        return res.status(400).json({ error: 'Cliente, total y pagos son requeridos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Siguiente número
        const siguiente = await recibosHelper.proximoNumeroRecibo(client, id_empresa);
        const numero_recibo = siguiente;

        // Turno
        let turno_id = id_turno;
        if (!turno_id) {
            const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
            turno_id = turno ? turno.id_turno : null;
        }
        const tieneEfectivo = pagos && pagos.some(p => p.id_forma_pago === 1 || parseInt(p.id_forma_pago, 10) === 1 || p.codigo === 'EFECTIVO');
        if (tieneEfectivo && !turno_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay caja abierta. Abrí la caja antes de cobrar en efectivo.' });
        }

        // >>> HELPER — Crear recibo <<<
        const recibo = await recibosHelper.crearRecibo(client, {
            id_empresa, id_cliente, id_usuario, id_turno: turno_id,
            numero_recibo, total_recibo, id_moneda_recibo, concepto: 'Procesando...', observaciones
        });

        // >>> HELPER — Items de pago <<<
        let totalConvertidoARS = 0;
        for (const pago of pagos) {
            const idMoneda = parseInt(pago.id_moneda, 10) || 1;
            const cotizacion = idMoneda !== 1 ? await obtenerCotizacion(client, idMoneda) : 1;
            const montoOriginal = parseFloat(pago.monto) || 0;
            const montoConvertido = montoOriginal * cotizacion;
            totalConvertidoARS += montoConvertido;

            await recibosHelper.insertarReciboItem(client, {
                id_empresa, id_recibo: recibo.id_recibo,
                id_forma_pago: pago.id_forma_pago, id_moneda: idMoneda,
                monto_original: montoOriginal, cotizacion_usada: cotizacion, monto_convertido: montoConvertido,
                id_tarjeta: pago.id_tarjeta, cuotas: pago.cuotas,
                interes_aplicado: pago.interes_aplicado, monto_interes: pago.monto_interes,
                monto_con_interes: pago.monto_con_interes || montoOriginal,
                id_banco: pago.id_banco, numero_referencia: pago.referencia,
                fecha_acreditacion: pago.fecha_acreditacion, observaciones: pago.observaciones
            });
        }

        // Movimientos de caja (solo efectivo) — via caja.helper existente
        for (const pago of pagos) {
            const esEfectivo = pago.id_forma_pago === 1 || parseInt(pago.id_forma_pago, 10) === 1 || pago.codigo === 'EFECTIVO';
            if (esEfectivo && turno_id) {
                const idMoneda = parseInt(pago.id_moneda, 10) || 1;
                const cotizacion = idMoneda !== 1 ? await obtenerCotizacion(client, idMoneda) : 1;
                await cajaHelper.registrarMovimiento(client, {
                    id_empresa, id_turno: turno_id, id_usuario, tipo: 'ingreso',
                    id_moneda: idMoneda, monto: parseFloat(pago.monto) || 0,
                    concepto: `Recibo #${recibo.numero_completo || numero_recibo}`,
                    id_metodo_pago: parseInt(pago.id_forma_pago, 10), id_recibo: recibo.id_recibo,
                    cotizacion_usada: cotizacion
                });
            }
        }

        // APLICACIÓN AUTOMÁTICA FIFO
        let montoRestante = parseFloat(total_recibo);
        const facturasActualizadas = [];
        let conceptoFinal = '';

        if (es_a_cuenta !== true) {
            const facturasRes = await client.query(`
                SELECT id_factura, numero_completo, total, COALESCE(monto_pagado, 0) as monto_pagado,
                       (total - COALESCE(monto_pagado, 0)) as saldo_pendiente
                FROM facturas WHERE id_cliente = $1 AND id_empresa = $2
                  AND estado IN ('emitida', 'parcial') AND (total - COALESCE(monto_pagado, 0)) > 0.01
                ORDER BY fecha_emision ASC, id_factura ASC
            `, [id_cliente, id_empresa]);

            for (const factura of facturasRes.rows) {
                if (montoRestante <= 0.01) break;
                const saldoPendiente = parseFloat(factura.saldo_pendiente);
                const montoAplicar = Math.min(montoRestante, saldoPendiente);

                if (montoAplicar > 0.01) {
                    // >>> HELPER — Aplicar a factura <<<
                    await recibosHelper.aplicarAFactura(client, {
                        id_recibo: recibo.id_recibo, id_factura: factura.id_factura, monto_aplicado: montoAplicar
                    });
                    // Via facturacion.helper existente
                    const resultadoPago = await facturacionHelper.actualizarMontoPagado(client, {
                        id_factura: factura.id_factura, id_empresa, monto: montoAplicar
                    });
                    facturasActualizadas.push({
                        id_factura: factura.id_factura, numero_completo: factura.numero_completo,
                        monto_aplicado: montoAplicar, saldo_anterior: saldoPendiente,
                        saldo_nuevo: parseFloat(resultadoPago.saldo_pendiente), estado: resultadoPago.estado_nuevo
                    });
                    montoRestante -= montoAplicar;
                }
            }

            if (facturasActualizadas.length > 0) {
                const nums = facturasActualizadas.map(f => f.numero_completo).slice(0, 3).join(', ');
                conceptoFinal = `Aplicado a: ${nums}${facturasActualizadas.length > 3 ? '...' : ''}`;
            } else { conceptoFinal = 'Cobro a cuenta (sin facturas pendientes)'; }
        } else { conceptoFinal = concepto || 'Cobro a cuenta'; }

        const saldoAFavor = montoRestante > 0.01 ? montoRestante : 0;

        // >>> HELPER — Actualizar concepto <<<
        await recibosHelper.actualizarRecibo(client, { id_empresa, id_recibo: recibo.id_recibo, concepto: conceptoFinal, total_recibo: totalConvertidoARS });

        // CC cliente — via cc-clientes.helper existente
        if (id_cliente) {
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa, id_cliente: parseInt(id_cliente, 10), monto: totalConvertidoARS,
                tipo: 'haber', concepto: `Recibo ${recibo.numero_completo} - ${conceptoFinal}`
            });
        }

        await client.query('COMMIT');
        logger.success(`✅ Recibo ${recibo.numero_completo} - $${total_recibo}`);
        if (facturasActualizadas.length > 0) { logger.info(`   Aplicado a ${facturasActualizadas.length} factura(s)`); facturasActualizadas.forEach(f => logger.info(`   - ${f.numero_completo}: $${f.monto_aplicado} → ${f.estado}`)); }
        if (saldoAFavor > 0) logger.info(`   Saldo a favor: $${saldoAFavor.toFixed(2)}`);

        res.status(201).json({
            success: true,
            message: facturasActualizadas.length > 0 ? `Cobro aplicado a ${facturasActualizadas.length} factura(s)` : 'Cobro a cuenta registrado',
            id_recibo: recibo.id_recibo, numero_completo: recibo.numero_completo, total_recibo: recibo.total_recibo,
            facturas_actualizadas: facturasActualizadas, saldo_a_favor: saldoAFavor,
            es_a_cuenta: es_a_cuenta === true || facturasActualizadas.length === 0
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('❌ Error al crear recibo:', error.message, error.stack);
        res.status(500).json({ error: 'Error al crear recibo: ' + error.message });
    } finally { client.release(); }
};

// ============================================================
// OBTENER / LISTAR (solo lectura — sin cambios)
// ============================================================

exports.obtenerPorId = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { id } = req.params;
    try {
        const reciboRes = await pool.query(`SELECT r.*, c.razon_social as cliente_nombre, c.cuit_cuil as cliente_cuit, u.nombre as usuario_nombre FROM recibos r LEFT JOIN clientes c ON r.id_cliente = c.id_cliente LEFT JOIN usuarios u ON r.id_usuario = u.id_usuario WHERE r.id_recibo = $1 AND r.id_empresa = $2`, [id, id_empresa]);
        if (reciboRes.rows.length === 0) return res.status(404).json({ error: 'Recibo no encontrado' });
        const recibo = reciboRes.rows[0];
        const itemsRes = await pool.query(`SELECT ri.*, fp.nombre as forma_pago_nombre, t.nombre as tarjeta_nombre, m.codigo as moneda_codigo, m.simbolo as moneda_simbolo FROM recibo_items ri LEFT JOIN formas_pago fp ON ri.id_forma_pago = fp.id_forma_pago LEFT JOIN tarjetas t ON ri.id_tarjeta = t.id_tarjeta LEFT JOIN monedas m ON ri.id_moneda = m.id_moneda WHERE ri.id_recibo = $1`, [id]);
        recibo.items = itemsRes.rows;
        const facturasRes = await pool.query(`SELECT rf.*, f.numero_completo, f.total, f.monto_pagado FROM recibo_facturas rf JOIN facturas f ON rf.id_factura = f.id_factura WHERE rf.id_recibo = $1`, [id]);
        recibo.facturas_aplicadas = facturasRes.rows;
        res.json(recibo);
    } catch (error) { res.status(500).json({ error: 'Error al obtener recibo' }); }
};

exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_cliente, fecha_desde, fecha_hasta, limite = 50, offset = 0 } = req.query;
    try {
        let query = `SELECT r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo, r.concepto, c.razon_social as cliente, u.nombre as cobrador, (SELECT COUNT(*) FROM recibo_facturas rf WHERE rf.id_recibo = r.id_recibo) as facturas_aplicadas FROM recibos r LEFT JOIN clientes c ON r.id_cliente = c.id_cliente LEFT JOIN usuarios u ON r.id_usuario = u.id_usuario WHERE r.id_empresa = $1`;
        const params = [id_empresa]; let idx = 2;
        if (id_cliente) { query += ` AND r.id_cliente = $${idx}`; params.push(parseInt(id_cliente, 10)); idx++; }
        if (fecha_desde) { query += ` AND DATE(r.fecha_recibo) >= $${idx}`; params.push(fecha_desde); idx++; }
        if (fecha_hasta) { query += ` AND DATE(r.fecha_recibo) <= $${idx}`; params.push(fecha_hasta); idx++; }
        query += ` ORDER BY r.fecha_recibo DESC LIMIT $${idx} OFFSET $${idx + 1}`;
        params.push(parseInt(limite, 10), parseInt(offset, 10));
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error al listar recibos' }); }
};

// ============================================================
// ANULAR RECIBO — MIGRADO A HELPER
// ============================================================
exports.anular = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id } = req.params; const { motivo } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const reciboRes = await client.query('SELECT * FROM recibos WHERE id_recibo = $1 AND id_empresa = $2', [id, id_empresa]);
        if (reciboRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recibo no encontrado' }); }

        // Revertir aplicaciones via facturacion.helper
        const aplicaciones = await client.query('SELECT * FROM recibo_facturas WHERE id_recibo = $1', [id]);
        for (const app of aplicaciones.rows) {
            await facturacionHelper.actualizarMontoPagado(client, { id_factura: app.id_factura, id_empresa, monto: -parseFloat(app.monto_aplicado) });
        }

        // >>> HELPER <<<
        await recibosHelper.eliminarAplicaciones(client, { id_recibo: id });
        await recibosHelper.anularRecibo(client, { id_recibo: id, motivo });
        await recibosHelper.eliminarMovimientosCaja(client, { id_recibo: id });

        await client.query('COMMIT');
        logger.warn(`⚠️ Recibo ${id} anulado - Motivo: ${motivo || '-'}`);
        res.json({ success: true, message: 'Recibo anulado correctamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('❌ Error al anular recibo:', error.message);
        res.status(500).json({ error: 'Error al anular recibo' });
    } finally { client.release(); }
};

// ============================================================
// OTROS (solo lectura)
// ============================================================

exports.recibosCliente = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { id_cliente } = req.params;
    try {
        const { rows } = await pool.query(`SELECT r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo, r.concepto, (SELECT COUNT(*) FROM recibo_facturas rf WHERE rf.id_recibo = r.id_recibo) as facturas_aplicadas FROM recibos r WHERE r.id_empresa = $1 AND r.id_cliente = $2 AND r.total_recibo > 0 ORDER BY r.fecha_recibo DESC LIMIT 50`, [id_empresa, parseInt(id_cliente, 10)]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener recibos del cliente' }); }
};

exports.resumenCobranzas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query; const hoy = new Date().toISOString().slice(0, 10);
    try {
        const { rows } = await pool.query(`SELECT COUNT(*) as cantidad, COALESCE(SUM(total_recibo), 0) as total FROM recibos WHERE id_empresa = $1 AND tipo = 'cobro' AND DATE(fecha_recibo) BETWEEN $2 AND $3`, [id_empresa, fecha_desde || hoy, fecha_hasta || hoy]);
        res.json({ totales: rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error al obtener resumen' }); }
};
