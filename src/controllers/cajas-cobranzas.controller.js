/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CAJAS Y COBRANZAS CONTROLLER — ERP LAGO
 * REESCRITO: Unifica en caja.helper.js (eliminado cajas.helper.js)
 *
 * FIXES: leaks multi-empresa, movimientos sin tx, cerrarCaja transfer logic,
 *        id_empresa duplicado, helpers duplicados
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const logger = require('../utils/logger');
const pool = require('../config/database');
const cajaHelper = require('../utils/caja.helper');
const facturacionHelper = require('../utils/facturacion.helper');
const recibosHelper = require('../utils/recibos.helper');

// ═══════════════════════════════════════════════════════════════
// CAJAS — Lectura
// ═══════════════════════════════════════════════════════════════

exports.listarCajas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(
            `SELECT * FROM cajas WHERE id_empresa = $1 AND activo = TRUE ORDER BY es_principal DESC, nombre`,
            [id_empresa]
        );
        res.json(rows);
    } catch (error) {
        logger.error('Error listarCajas:', error.message);
        res.status(500).json({ error: 'Error al obtener cajas' });
    }
};

exports.obtenerCajas = exports.listarCajas;

exports.obtenerTurnoActual = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_caja = parseInt(req.params.id_caja, 10);
    try {
        const { rows } = await pool.query(`
            SELECT t.*, c.nombre as nombre_caja, u.username as usuario_apertura
            FROM turnos_caja t
            JOIN cajas c ON t.id_caja = c.id_caja
            JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario
            WHERE t.id_caja = $1 AND c.id_empresa = $2 AND t.estado = 'abierto'
            ORDER BY t.fecha_apertura DESC LIMIT 1
        `, [id_caja, id_empresa]);

        if (rows.length === 0) return res.json({ turno_abierto: false });

        const turno = rows[0];
        const totales = await cajaHelper.calcularTotalesTorales(pool, turno.id_turno, id_empresa);
        const monto_inicial_ars = parseFloat(turno.monto_inicial_ars) || 0;
        const monto_inicial_usd = parseFloat(turno.monto_inicial_usd) || 0;
        const ingresos_ars = parseFloat(totales.ingresos_ars) || 0;
        const egresos_ars = parseFloat(totales.egresos_ars) || 0;
        const ingresos_usd = parseFloat(totales.ingresos_usd) || 0;
        const egresos_usd = parseFloat(totales.egresos_usd) || 0;

        res.json({
            turno_abierto: true,
            turno: {
                ...turno,
                ingresos_efectivo_ars: ingresos_ars, egresos_efectivo_ars: egresos_ars,
                ingresos_efectivo_usd: ingresos_usd, egresos_efectivo_usd: egresos_usd,
                efectivo_actual_ars: monto_inicial_ars + ingresos_ars - egresos_ars,
                efectivo_actual_usd: monto_inicial_usd + ingresos_usd - egresos_usd,
                total_movimientos: parseInt(totales.total_movimientos) || 0
            }
        });
    } catch (error) {
        logger.error('Error obtenerTurnoActual:', error.message);
        res.status(500).json({ error: 'Error al obtener turno actual' });
    }
};

exports.obtenerEstado = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(`
            SELECT tc.id_turno, tc.id_caja, tc.estado, tc.fecha_apertura,
                   tc.monto_inicial_ars, tc.monto_inicial_usd,
                   c.nombre as nombre_caja
            FROM turnos_caja tc
            JOIN cajas c ON tc.id_caja = c.id_caja
            WHERE tc.estado = 'abierto' AND c.id_empresa = $1
            ORDER BY tc.fecha_apertura DESC LIMIT 1
        `, [id_empresa]);

        if (rows.length === 0) return res.json({ abierta: false, turno: null });

        const turno = rows[0];
        const t = await cajaHelper.calcularTotalesTorales(pool, turno.id_turno, id_empresa);
        const efectivo_ars = parseFloat(turno.monto_inicial_ars || 0) + parseFloat(t.ingresos_ars) - parseFloat(t.egresos_ars);
        const efectivo_usd = parseFloat(turno.monto_inicial_usd || 0) + parseFloat(t.ingresos_usd) - parseFloat(t.egresos_usd);

        res.json({
            abierta: true,
            turno: {
                ...turno,
                efectivo_actual_ars: efectivo_ars, efectivo_actual_usd: efectivo_usd,
                ingresos_efectivo_ars: parseFloat(t.ingresos_ars),
                egresos_efectivo_ars: parseFloat(t.egresos_ars),
                ingresos_efectivo_usd: parseFloat(t.ingresos_usd),
                egresos_efectivo_usd: parseFloat(t.egresos_usd)
            },
            nombre_caja: turno.nombre_caja
        });
    } catch (error) {
        logger.error('Error obtenerEstado:', error.message);
        res.status(500).json({ error: 'Error al obtener estado de caja' });
    }
};

// ═══════════════════════════════════════════════════════════════
// ABRIR / CERRAR CAJA
// ═══════════════════════════════════════════════════════════════

exports.abrirCaja = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_caja, monto_inicial_ars, monto_inicial_usd } = req.body;
    if (!id_caja) return res.status(400).json({ error: 'ID de caja requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const turno = await cajaHelper.abrirTurno(client, {
            id_empresa, id_caja, id_usuario, monto_inicial_ars, monto_inicial_usd
        });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Caja abierta exitosamente', turno });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al abrir caja:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al abrir caja' });
    } finally { client.release(); }
};

exports.cerrarCaja = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_turno, arqueo_efectivo_ars, arqueo_efectivo_usd, observaciones, transferir_a_principal, arqueo_detalle } = req.body;
    if (!id_turno) return res.status(400).json({ error: 'ID de turno requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Totales reales desde movimientos_caja (fuente de verdad)
        const t = await cajaHelper.calcularTotalesTorales(client, id_turno, id_empresa);

        const turnoRes = await client.query(
            `SELECT monto_inicial_ars, monto_inicial_usd FROM turnos_caja WHERE id_turno = $1 AND id_empresa = $2`,
            [id_turno, id_empresa]
        );
        if (turnoRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Turno no encontrado' }); }

        const td = turnoRes.rows[0];
        const esperado_ars = parseFloat(td.monto_inicial_ars || 0) + parseFloat(t.ingresos_ars) - parseFloat(t.egresos_ars);
        const esperado_usd = parseFloat(td.monto_inicial_usd || 0) + parseFloat(t.ingresos_usd) - parseFloat(t.egresos_usd);
        const arqueo_ars = parseFloat(arqueo_efectivo_ars) || 0;
        const arqueo_usd = parseFloat(arqueo_efectivo_usd) || 0;

        const turno = await cajaHelper.cerrarTurno(client, {
            id_empresa, id_turno, id_usuario,
            ingresos_ars: t.ingresos_ars, egresos_ars: t.egresos_ars,
            ingresos_usd: t.ingresos_usd, egresos_usd: t.egresos_usd,
            arqueo_ars, arqueo_usd, observaciones, arqueo_detalle
        });

        // Transferir monto ESPERADO (sistema), no contado (cajero)
        let transferencia = null;
        if (transferir_a_principal) {
            transferencia = await cajaHelper.transferirACajaPrincipal(client, {
                id_empresa, id_turno, id_usuario,
                monto_ars: esperado_ars, monto_usd: esperado_usd
            });
        }

        await client.query('COMMIT');
        logger.success(`Caja cerrada: turno=${id_turno}, dif_ARS=${turno.diferencia_ars}${transferencia ? ', → ' + transferencia.caja_destino : ''}`);

        res.json({
            message: 'Caja cerrada exitosamente', turno, transferencia,
            resumen: { esperado_ars, esperado_usd, arqueo_ars, arqueo_usd,
                       diferencia_ars: parseFloat(turno.diferencia_ars),
                       diferencia_usd: parseFloat(turno.diferencia_usd) }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al cerrar caja:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al cerrar caja' });
    } finally { client.release(); }
};

// ═══════════════════════════════════════════════════════════════
// MOVIMIENTOS MANUALES — con transacción + helper unificado
// ═══════════════════════════════════════════════════════════════

exports.crearMovimiento = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_turno, tipo, monto, concepto, id_moneda } = req.body;
    if (!id_turno || !tipo || !monto || !concepto) return res.status(400).json({ error: 'Faltan datos requeridos' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const mov = await cajaHelper.registrarMovimiento(client, {
            id_empresa, id_turno, id_usuario,
            tipo, id_moneda: id_moneda || 1, monto, concepto
        });
        await client.query('COMMIT');
        logger.success(`Movimiento manual ${tipo}: $${monto} - ${concepto}`);
        res.status(201).json(mov);
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al crear movimiento:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al registrar movimiento' });
    } finally { client.release(); }
};

exports.listarMovimientos = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_turno } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT mc.*, u.nombre as usuario_nombre,
                   m.simbolo as moneda_simbolo, mp.nombre as metodo_pago_nombre
            FROM movimientos_caja mc
            LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
            LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
            LEFT JOIN metodosdepago mp ON mc.id_metodo_pago = mp.id_metodo_pago
            WHERE mc.id_turno = $1 AND mc.id_empresa = $2
            ORDER BY mc.fecha_movimiento DESC
        `, [id_turno, id_empresa]);
        res.json(rows);
    } catch (error) {
        logger.error('Error listarMovimientos:', error.message);
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
};

// ═══════════════════════════════════════════════════════════════
// COBRANZAS
// ═══════════════════════════════════════════════════════════════

exports.obtenerPendientes = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { solo_hoy, id_cliente } = req.query;
    try {
        let query = `
            SELECT f.id_factura, f.numero_completo, f.fecha_emision,
                   f.fecha_vencimiento, f.total,
                   COALESCE(f.monto_pagado, 0) as monto_pagado,
                   (f.total - COALESCE(f.monto_pagado, 0)) as saldo_pendiente,
                   c.id_cliente, c.razon_social, c.telefono, c.email
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_empresa = $1 AND f.estado IN ('emitida', 'parcial')
              AND (f.total - COALESCE(f.monto_pagado, 0)) > 0.01`;
        const params = [id_empresa]; let pi = 2;
        if (solo_hoy === 'true') query += ` AND f.fecha_vencimiento = CURRENT_DATE`;
        if (id_cliente) { query += ` AND f.id_cliente = $${pi}`; params.push(parseInt(id_cliente)); pi++; }
        query += ` ORDER BY f.fecha_vencimiento ASC, f.fecha_emision ASC`;
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error obtenerPendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
};

exports.aplicarPago = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_recibo, aplicaciones } = req.body;
    if (!id_recibo || !aplicaciones || aplicaciones.length === 0) return res.status(400).json({ error: 'Recibo y aplicaciones requeridos' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const reciboRes = await client.query('SELECT total_recibo, id_cliente FROM recibos WHERE id_recibo = $1 AND id_empresa = $2', [id_recibo, id_empresa]);
        if (reciboRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recibo no encontrado' }); }
        const total_recibo = parseFloat(reciboRes.rows[0].total_recibo);
        let total_aplicado = 0;

        for (const ap of aplicaciones) {
            const monto = parseFloat(ap.monto_aplicado);
            if (monto <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Montos deben ser > 0' }); }
            const fRes = await client.query('SELECT total, COALESCE(monto_pagado,0) as pagado FROM facturas WHERE id_factura=$1 AND id_empresa=$2', [ap.id_factura, id_empresa]);
            if (fRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Factura ${ap.id_factura} no encontrada` }); }
            const saldo = parseFloat(fRes.rows[0].total) - parseFloat(fRes.rows[0].pagado);
            if (monto > saldo + 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Monto ${monto} supera saldo ${saldo.toFixed(2)}` }); }
            await recibosHelper.aplicarAFactura(client, { id_recibo, id_factura: ap.id_factura, monto_aplicado: monto });
            await facturacionHelper.actualizarMontoPagado(client, { id_factura: ap.id_factura, id_empresa, monto });
            total_aplicado += monto;
        }
        if (total_aplicado > total_recibo + 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Total aplicado supera recibo` }); }
        await client.query('COMMIT');
        res.json({ message: 'Pago aplicado exitosamente', total_aplicado, facturas_aplicadas: aplicaciones.length });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error aplicar pago:', error.message);
        res.status(500).json({ error: 'Error al aplicar pago' });
    } finally { client.release(); }
};

exports.obtenerHistorialCobranzas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, id_cliente, limite, offset } = req.query;
    try {
        let query = `
            SELECT r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo,
                   c.razon_social as cliente, u.username as cobrador,
                   COUNT(rf.id_relacion) as facturas_aplicadas,
                   COALESCE(SUM(rf.monto_aplicado), 0) as monto_aplicado
            FROM recibos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            LEFT JOIN recibo_facturas rf ON r.id_recibo = rf.id_recibo
            WHERE r.id_empresa = $1`;
        const params = [id_empresa]; let pi = 2;
        if (fecha_desde) { query += ` AND DATE(r.fecha_recibo) >= $${pi}`; params.push(fecha_desde); pi++; }
        if (fecha_hasta) { query += ` AND DATE(r.fecha_recibo) <= $${pi}`; params.push(fecha_hasta); pi++; }
        if (id_cliente) { query += ` AND r.id_cliente = $${pi}`; params.push(parseInt(id_cliente)); pi++; }
        query += ` GROUP BY r.id_recibo, c.razon_social, u.username ORDER BY r.fecha_recibo DESC LIMIT $${pi} OFFSET $${pi+1}`;
        params.push(parseInt(limite) || 100, parseInt(offset) || 0);
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error historial cobranzas:', error.message);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
};

// ═══════════════════════════════════════════════════════════════
// HISTORIAL DE TURNOS
// ═══════════════════════════════════════════════════════════════

exports.obtenerHistorialTurnos = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, estado, id_caja, limit, offset } = req.query;
    try {
        const resultado = await cajaHelper.obtenerHistorialTurnos(pool, {
            id_empresa, fecha_desde, fecha_hasta, estado,
            id_caja, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0
        });
        res.json(resultado);
    } catch (error) {
        logger.error('Error historial turnos:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener historial' });
    }
};

exports.obtenerDetalleTurno = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_turno = parseInt(req.params.id_turno, 10);
    try {
        const detalle = await cajaHelper.obtenerDetalleTurno(pool, { id_turno, id_empresa });
        res.json(detalle);
    } catch (error) {
        logger.error('Error detalle turno:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener detalle' });
    }
};

// ═══════════════════════════════════════════════════════════════
// DESGLOSE TURNO POR FORMA DE PAGO
// ═══════════════════════════════════════════════════════════════

const cajaHelperDesglose = require('../utils/caja.helper');

exports.obtenerDesgloseTurno = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_turno = parseInt(req.params.id_turno, 10);
    const pool = require('../config/database');
    const logger = require('../utils/logger');
    try {
        const desglose = await cajaHelperDesglose.calcularDesgloseFormasPago(pool, id_turno, id_empresa);
        const turnoRes = await pool.query(
            'SELECT monto_inicial_ars, monto_inicial_usd FROM turnos_caja WHERE id_turno = $1 AND id_empresa = $2',
            [id_turno, id_empresa]
        );
        const mi_ars = parseFloat(turnoRes.rows[0]?.monto_inicial_ars || 0);
        const mi_usd = parseFloat(turnoRes.rows[0]?.monto_inicial_usd || 0);

        // H13: identificacion por tipo_cuenta='caja_fisica' (no por id hardcodeado).
        // Permite multiples cajas fisicas en el futuro y desacopla del id especifico.
        const efArs = desglose.find(d => d.tipo_cuenta === 'caja_fisica' && d.id_moneda === 1);
        if (efArs) { efArs.monto_inicial = mi_ars; efArs.esperado = mi_ars + efArs.neto; }
        else if (mi_ars > 0) {
            desglose.unshift({ id_metodo_pago: 1, nombre: 'Efectivo', tipo_cuenta: 'caja_fisica',
                requiere_arqueo_manual: true, id_moneda: 1,
                moneda_simbolo: '$', ingresos: 0, egresos: 0, neto: 0, monto_inicial: mi_ars, esperado: mi_ars });
        }
        const efUsd = desglose.find(d => d.tipo_cuenta === 'caja_fisica' && d.id_moneda === 2);
        if (efUsd) { efUsd.monto_inicial = mi_usd; efUsd.esperado = mi_usd + efUsd.neto; }
        else if (mi_usd > 0) {
            desglose.unshift({ id_metodo_pago: 1, nombre: 'Efectivo USD', tipo_cuenta: 'caja_fisica',
                requiere_arqueo_manual: true, id_moneda: 2,
                moneda_simbolo: 'US$', ingresos: 0, egresos: 0, neto: 0, monto_inicial: mi_usd, esperado: mi_usd });
        }
        desglose.forEach(d => { if (d.esperado === undefined) d.esperado = d.neto; });

        res.json({ desglose, monto_inicial_ars: mi_ars, monto_inicial_usd: mi_usd });
    } catch (error) {
        logger.error('Error desglose turno:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener desglose' });
    }
};
