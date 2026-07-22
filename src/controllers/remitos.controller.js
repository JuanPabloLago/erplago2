'use strict';

const { generarBusquedaMultiPalabra } = require('../utils/busqueda.helper');
const pool = require('../config/database');
const logger = require('../utils/logger');

// ─── LISTAR ─────────────────────────────────────────────────────

async function listar(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const {
            estado, id_cliente, id_pedido, id_viaje,
            fecha_desde, fecha_hasta, busqueda,
            limit, offset, orden
        } = req.query;

        let where = 'r.id_empresa = $1';
        const params = [id_empresa];
        let idx = 2;

        if (estado) { where += ` AND r.estado = $${idx++}`; params.push(estado); }
        if (id_cliente) { where += ` AND r.id_cliente = $${idx++}`; params.push(parseInt(id_cliente)); }
        if (id_pedido) { where += ` AND r.id_pedido = $${idx++}`; params.push(parseInt(id_pedido)); }
        if (id_viaje) { where += ` AND r.id_viaje = $${idx++}`; params.push(parseInt(id_viaje)); }
        if (fecha_desde) { where += ` AND r.fecha_emision >= $${idx++}`; params.push(fecha_desde); }
        if (fecha_hasta) { where += ` AND r.fecha_emision <= $${idx++}::date + interval '1 day'`; params.push(fecha_hasta); }
        if (busqueda) {
            const busq = generarBusquedaMultiPalabra(busqueda, [
                "r.numero_completo", "c.razon_social", "r.observaciones",
                "r.direccion_entrega", "r.chofer", "r.patente"
            ], idx);
            if (busq) {
                where += " AND " + busq.clausula;
                params.push(...busq.params);
                idx = busq.nextIdx;
            }
        }

        const countResult = await pool.query(
            `SELECT COUNT(*) as total
             FROM remitos r
             LEFT JOIN clientes c ON r.id_cliente = c.id_cliente AND c.id_empresa = $1
             WHERE ${where}`,
            params
        );

        const lim = Math.min(parseInt(limit) || 50, 200);
        const off = parseInt(offset) || 0;
        const orderBy = orden === 'asc' ? 'ASC' : 'DESC';

        const dataResult = await pool.query(
            `SELECT r.id_remito, r.numero_completo, r.fecha_emision, r.estado,
                    r.subtotal, r.iva, r.total, r.observaciones,
                    r.id_pedido, r.id_viaje, r.id_deposito,
                    r.direccion_entrega, r.transportista, r.chofer, r.patente,
                    r.pago_confirmado, r.veces_impreso,
                    (SELECT COUNT(*) FROM remito_items ri WHERE ri.id_remito = r.id_remito AND ri.id_empresa = $1) as total_items,
                    c.razon_social as cliente_nombre, c.cuit_cuil as cliente_cuit,
                    c.telefono as cliente_telefono, c.domicilio as cliente_domicilio,
                    p.id_pedido::text as pedido_numero,
                    d.nombre as deposito_nombre,
                    u.nombre as usuario_nombre
             FROM remitos r
             LEFT JOIN clientes c ON r.id_cliente = c.id_cliente AND c.id_empresa = $1
             LEFT JOIN pedidos p ON r.id_pedido = p.id_pedido AND p.id_empresa = $1
             LEFT JOIN depositos d ON r.id_deposito = d.id_deposito AND d.id_empresa = $1
             LEFT JOIN usuarios u ON r.id_usuario = u.id_usuario AND u.id_empresa = $1
             WHERE ${where}
             ORDER BY r.fecha_emision ${orderBy}, r.id_remito ${orderBy}
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, lim, off]
        );

        res.json({
            data: dataResult.rows,
            total: parseInt(countResult.rows[0].total),
            limit: lim,
            offset: off
        });

    } catch (error) {
        logger.error('Error listando remitos:', error);
        res.status(500).json({ error: 'Error al listar remitos', detalle: error.message });
    }
}

// ─── FORM DATA ──────────────────────────────────────────────────

async function formData(req, res) {
    try {
        const { id_empresa } = req.usuario;

        const estadosResult = await pool.query(
            `SELECT DISTINCT estado FROM remitos WHERE id_empresa = $1 ORDER BY estado`,
            [id_empresa]
        );

        const depositosResult = await pool.query(
            `SELECT id_deposito, nombre FROM depositos
             WHERE id_empresa = $1 AND activo = true ORDER BY nombre`,
            [id_empresa]
        );

        const statsResult = await pool.query(
            `SELECT
                COUNT(*) as total_remitos,
                COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes,
                COUNT(*) FILTER (WHERE estado = 'despachado') as despachados,
                COUNT(*) FILTER (WHERE estado = 'entregado') as entregados,
                COUNT(*) FILTER (WHERE estado = 'anulado') as anulados
             FROM remitos WHERE id_empresa = $1`,
            [id_empresa]
        );

        res.json({
            estados: estadosResult.rows.map(r => r.estado),
            depositos: depositosResult.rows,
            estadisticas: statsResult.rows[0]
        });

    } catch (error) {
        logger.error('Error obteniendo form-data remitos:', error);
        res.status(500).json({ error: 'Error al obtener datos', detalle: error.message });
    }
}

// ─── OBTENER POR ID ─────────────────────────────────────────────

async function obtenerPorId(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id } = req.params;

        const remitoResult = await pool.query(
            `SELECT r.*,
                    c.razon_social as cliente_nombre, c.cuit_cuil as cliente_cuit,
                    c.domicilio as cliente_domicilio, c.telefono as cliente_telefono,
                    c.email as cliente_email,
                    p.id_pedido::text as pedido_numero,
                    d.nombre as deposito_nombre, d.direccion as deposito_direccion,
                    u.nombre as usuario_nombre
             FROM remitos r
             LEFT JOIN clientes c ON r.id_cliente = c.id_cliente AND c.id_empresa = $1
             LEFT JOIN pedidos p ON r.id_pedido = p.id_pedido AND p.id_empresa = $1
             LEFT JOIN depositos d ON r.id_deposito = d.id_deposito AND d.id_empresa = $1
             LEFT JOIN usuarios u ON r.id_usuario = u.id_usuario AND u.id_empresa = $1
             WHERE r.id_remito = $2 AND r.id_empresa = $1`,
            [id_empresa, parseInt(id)]
        );

        if (remitoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Remito no encontrado' });
        }

        const remito = remitoResult.rows[0];

        const itemsResult = await pool.query(
            `SELECT ri.*,
                    pr.nombre as producto_nombre, pr.sku as producto_codigo,
                    pr.unidad_medida,
                    dep.nombre as deposito_origen_nombre
             FROM remito_items ri
             LEFT JOIN productos pr ON ri.id_producto = pr.id_producto
             LEFT JOIN depositos dep ON ri.id_deposito_origen = dep.id_deposito AND dep.id_empresa = $1
             WHERE ri.id_remito = $2 AND ri.id_empresa = $1
             ORDER BY ri.id_item`,
            [id_empresa, parseInt(id)]
        );
        remito.items = itemsResult.rows;

        res.json(remito);

    } catch (error) {
        logger.error('Error obteniendo remito:', error);
        res.status(500).json({ error: 'Error al obtener remito', detalle: error.message });
    }
}

// ─── EXPORTAR ───────────────────────────────────────────────────

async function exportar(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { estado, id_cliente, fecha_desde, fecha_hasta } = req.query;

        let where = 'r.id_empresa = $1';
        const params = [id_empresa];
        let idx = 2;

        if (estado) { where += ` AND r.estado = $${idx++}`; params.push(estado); }
        if (id_cliente) { where += ` AND r.id_cliente = $${idx++}`; params.push(parseInt(id_cliente)); }
        if (fecha_desde) { where += ` AND r.fecha_emision >= $${idx++}`; params.push(fecha_desde); }
        if (fecha_hasta) { where += ` AND r.fecha_emision <= $${idx++}::date + interval '1 day'`; params.push(fecha_hasta); }

        const result = await pool.query(
            `SELECT r.numero_completo as "Remito",
                    to_char(r.fecha_emision, 'DD/MM/YYYY') as "Fecha",
                    c.razon_social as "Cliente", r.estado as "Estado",
                    r.total as "Total",
                    d.nombre as "Deposito",
                    r.chofer as "Chofer", r.patente as "Patente",
                    r.observaciones as "Observaciones"
             FROM remitos r
             LEFT JOIN clientes c ON r.id_cliente = c.id_cliente AND c.id_empresa = $1
             LEFT JOIN depositos d ON r.id_deposito = d.id_deposito AND d.id_empresa = $1
             WHERE ${where}
             ORDER BY r.fecha_emision DESC, r.id_remito DESC
             LIMIT 5000`,
            params
        );

        res.json({ data: result.rows, total: result.rows.length });

    } catch (error) {
        logger.error('Error exportando remitos:', error);
        res.status(500).json({ error: 'Error al exportar', detalle: error.message });
    }
}

module.exports = {
    listar,
    formData,
    obtenerPorId,
    exportar
};
