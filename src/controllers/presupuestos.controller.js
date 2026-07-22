/**
 * PRESUPUESTOS CONTROLLER - ERP LAGO
 * MIGRADO FASE 4: Todas las escrituras via presupuestos.helper.js
 */

const pool = require('../config/database');
const logger = require('../utils/logger');
const presupuestosHelper = require('../utils/presupuestos.helper');

/**
 * GET /api/presupuestos/proximo-numero
 */
exports.proximoNumero = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(
            `SELECT COALESCE(
                (SELECT ultimo_numero + 1 FROM secuencia_presupuestos WHERE id_empresa = $1), 1
             ) as proximo_numero`,
            [id_empresa]
        );
        res.json({ proximo_numero: parseInt(rows[0].proximo_numero) });
    } catch (error) {
        logger.error('Error en proximoNumero presupuesto:', error.message);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/presupuestos
 */
exports.crear = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.usuario.id_usuario, 10);
    const {
        id_cliente, fecha_vencimiento, condiciones_pago,
        observaciones, items, id_pedido, id_moneda, cotizacion
    } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir al menos un item' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // >>> HELPER — número atómico <<<
        const numero = await presupuestosHelper.proximoNumeroAtomico(client, id_empresa);

        // Calcular totales
        let subtotal = 0, iva = 0;
        const itemsCalculados = items.map(item => {
            const sub = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
            const descPct = parseFloat(item.descuento_porcentaje || 0);
            const subNeto = sub * (1 - descPct / 100);
            const ivaPct = parseFloat(item.iva_porcentaje || 21);
            const ivaMonto = subNeto * (ivaPct / 100);
            subtotal += subNeto;
            iva += ivaMonto;
            return {
                id_producto: item.id_producto, descripcion: item.descripcion,
                cantidad: item.cantidad, precio_unitario: item.precio_unitario,
                iva_porcentaje: ivaPct, descuento_porcentaje: descPct,
                subtotal: subNeto, iva_monto: ivaMonto, total: subNeto + ivaMonto
            };
        });
        const total = subtotal + iva;

        // >>> HELPER — crear cabecera <<<
        const presupuesto = await presupuestosHelper.crearPresupuesto(client, {
            id_empresa, id_cliente, id_usuario, numero_presupuesto: numero,
            fecha_vencimiento, condiciones_pago, observaciones,
            subtotal, iva, total, id_pedido, id_moneda, cotizacion
        });

        // >>> HELPER — insertar items <<<
        await presupuestosHelper.insertarItems(client, {
            id_presupuesto: presupuesto.id_presupuesto, items: itemsCalculados
        });

        await client.query('COMMIT');
        res.status(201).json({
            success: true,
            id_presupuesto: presupuesto.id_presupuesto,
            numero_completo: presupuesto.numero_completo, total
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al crear presupuesto:', error.message);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};

/**
 * POST /api/presupuestos/desde-pedido/:id_pedido
 */
exports.crearDesdePedido = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.usuario.id_usuario, 10);
    const id_pedido = parseInt(req.params.id_pedido, 10);
    const { observaciones = '' } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // >>> HELPER — crear completo desde pedido <<<
        const resultado = await presupuestosHelper.crearDesdePedido(client, {
            id_empresa, id_usuario, id_pedido, observaciones
        });
        await client.query('COMMIT');
        res.json({ success: true, ...resultado });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al crear presupuesto desde pedido:', error.message);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};

/**
 * POST /api/presupuestos/masivo
 */
exports.crearMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.usuario.id_usuario, 10);
    const { pedido_ids, observaciones = '' } = req.body;

    if (!pedido_ids || !Array.isArray(pedido_ids) || pedido_ids.length === 0) {
        return res.status(400).json({ error: 'Debe seleccionar al menos un pedido' });
    }

    const client = await pool.connect();
    const resultados = [];
    let exitosos = 0, fallidos = 0;

    try {
        await client.query('BEGIN');
        for (const id_pedido of pedido_ids) {
            const sp = `sp_pres_${id_pedido}`;
            try {
                await client.query(`SAVEPOINT ${sp}`);
                // >>> HELPER <<<
                const resultado = await presupuestosHelper.crearDesdePedido(client, {
                    id_empresa, id_usuario, id_pedido: parseInt(id_pedido), observaciones
                });
                await client.query(`RELEASE SAVEPOINT ${sp}`);
                resultados.push({ id_pedido, ok: true, ...resultado });
                exitosos++;
            } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                resultados.push({ id_pedido, ok: false, error: err.message });
                fallidos++;
            }
        }
        exitosos > 0 ? await client.query('COMMIT') : await client.query('ROLLBACK');
        res.json({ success: exitosos > 0, message: `${exitosos} presupuestos generados, ${fallidos} errores`, exitosos, fallidos, resultados });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en crearMasivo presupuestos:', error.message);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};

/** GET /api/presupuestos */
exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, estado, q, busqueda, id_cliente, limit = 100, offset = 0 } = req.query;
    try {
        let query = `
            SELECT p.id_presupuesto, p.numero_completo, p.fecha_emision,
                   p.fecha_vencimiento, p.subtotal, p.iva, p.total,
                   p.estado, p.observaciones, p.id_pedido,
                   p.id_cliente,
                   c.razon_social AS cliente, c.cuit_cuil, u.nombre AS usuario
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_empresa = $1`;
        const params = [id_empresa]; let idx = 2;
        if (fecha_desde) { query += ` AND p.fecha_emision::date >= $${idx}`; params.push(fecha_desde); idx++; }
        if (fecha_hasta) { query += ` AND p.fecha_emision::date <= $${idx}`; params.push(fecha_hasta); idx++; }
        if (estado) { query += ` AND p.estado = $${idx}`; params.push(estado); idx++; }
        const busq = q || busqueda;
        if (busq) {
            // Buscar cada palabra por separado (multi-palabra)
            const palabras = busq.toLowerCase().trim().split(/\s+/).filter(Boolean);
            for (const pal of palabras) {
                query += ` AND (LOWER(c.razon_social) LIKE $${idx} OR LOWER(p.numero_completo) LIKE $${idx} OR LOWER(COALESCE(c.nombre_fantasia,'')) LIKE $${idx})`;
                params.push(`%${pal}%`);
                idx++;
            }
        }
        if (id_cliente) { query += ` AND p.id_cliente = $${idx}`; params.push(parseInt(id_cliente)); idx++; }
        query += ` ORDER BY p.fecha_emision DESC LIMIT $${idx} OFFSET $${idx + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error al listar presupuestos:', error.message);
        res.status(500).json({ error: error.message });
    }
};

/** GET /api/presupuestos/:id */
exports.obtenerPorId = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);
    try {
        const presRes = await pool.query(`
            SELECT p.*, c.razon_social AS cliente, c.cuit_cuil, c.domicilio,
                   ci.nombre AS condicion_iva, u.nombre AS usuario,
                   e.razon_social AS empresa_nombre, e.cuit AS empresa_cuit,
                   e.domicilio_fiscal AS empresa_direccion
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            LEFT JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_presupuesto = $1 AND p.id_empresa = $2
        `, [id_presupuesto, id_empresa]);
        if (presRes.rows.length === 0) return res.status(404).json({ error: 'Presupuesto no encontrado' });
        const itemsRes = await pool.query(`
            SELECT pi.*, pr.nombre AS producto_nombre, pr.sku
            FROM presupuesto_items pi LEFT JOIN productos pr ON pi.id_producto = pr.id_producto
            WHERE pi.id_presupuesto = $1 ORDER BY pi.id_item`, [id_presupuesto]);
        res.json({ ...presRes.rows[0], items: itemsRes.rows });
    } catch (error) {
        logger.error('Error al obtener presupuesto:', error.message);
        res.status(500).json({ error: error.message });
    }
};

/** PUT /api/presupuestos/:id/estado */
exports.cambiarEstado = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);
    const { estado } = req.body;
    try {
        // >>> HELPER <<<
        const result = await presupuestosHelper.cambiarEstado(pool, { id_presupuesto, id_empresa, estado });
        res.json({ success: true, numero_completo: result.numero_completo, estado });
    } catch (error) {
        logger.error('Error al cambiar estado presupuesto:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};

/** DELETE /api/presupuestos/:id */
exports.anular = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);
    try {
        // >>> HELPER <<<
        const result = await presupuestosHelper.cambiarEstado(pool, { id_presupuesto, id_empresa, estado: 'rechazado' });
        res.json({ success: true, numero_completo: result.numero_completo });
    } catch (error) {
        logger.error('Error al anular presupuesto:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};
