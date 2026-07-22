/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PEDIDOS-WEB CONTROLLER — ERP LAGO
 * Endpoints de pedidos web (cliente y admin)
 * ═══════════════════════════════════════════════════════════════════════════
 * Toda la logica vive en pedido-web.helper.js. Este controller solo:
 *   - Abre/cierra transacciones
 *   - Mapea HTTP <-> helper
 *   - Diferencia rutas de cliente (req.cliente_web) vs admin (req.usuario)
 *
 * RUTAS CLIENTE (auth: verificarClienteWeb):
 *   POST   /api/web/checkout                       -> convierte carrito en pedido
 *   GET    /api/web/mis-pedidos                    -> lista
 *   GET    /api/web/mis-pedidos/:id                -> detalle
 *   PUT    /api/web/mis-pedidos/:id/items/:id_item -> modificar item
 *   DELETE /api/web/mis-pedidos/:id/items/:id_item -> eliminar item
 *   POST   /api/web/mis-pedidos/:id/cancelar       -> cancelar
 *
 * RUTAS ADMIN (auth: verificarToken staff):
 *   GET    /api/admin/pedidos-web/pendientes
 *   POST   /api/admin/pedidos-web/:id/aprobar
 *   POST   /api/admin/pedidos-web/:id/rechazar
 *   PUT    /api/admin/pedidos-web/:id/items/:id_item
 */

const pool      = require('../config/database');
const carrito   = require('../utils/carrito-web.helper');
const pedidoWeb = require('../utils/pedido-web.helper');

// ═════════════════════════════════════════════════════════════════════════
// CLIENTE
// ═════════════════════════════════════════════════════════════════════════

// POST /checkout
exports.checkout = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });

    const id_empresa = req.id_empresa_web;
    const id_cliente = req.cliente_web.id_cliente;
    const session_token = req.session_token_anonimo || null;
    const { tipo_entrega, domicilio_entrega, observaciones } = req.body || {};

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Resolvemos el carrito del cliente (puede ser su carrito propio o el anonimo si recien se logueo)
        const cab = await carrito.obtenerOCrearCarrito(client, {
            id_empresa, id_cliente, session_token
        });

        const pedido = await pedidoWeb.convertirCarritoEnPedido(client, {
            id_empresa,
            id_cliente,
            id_carrito: cab.id_carrito,
            tipo_entrega,
            domicilio_entrega,
            observaciones
        });

        await client.query('COMMIT');
        return res.status(201).json({
            ok: true,
            mensaje: 'Pedido recibido. Sera revisado por nuestro equipo.',
            pedido
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('checkout:', err);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /mis-pedidos
exports.misPedidos = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const limit  = Math.min(parseInt(req.query.limit, 10)  || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const client = await pool.connect();
    try {
        const pedidos = await pedidoWeb.listarPedidosCliente(
            client, req.id_empresa_web, req.cliente_web.id_cliente, { limit, offset }
        );
        return res.json({ pedidos });
    } catch (err) {
        console.error('misPedidos:', err);
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /mis-pedidos/:id
exports.detallePedidoCliente = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const id_pedido = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        const ped = await pedidoWeb.obtenerPedidoCliente(
            client, req.id_empresa_web, req.cliente_web.id_cliente, id_pedido
        );
        if (!ped) return res.status(404).json({ error: 'Pedido no encontrado' });
        return res.json(ped);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// PUT /mis-pedidos/:id/items/:id_item
exports.modificarItemCliente = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const id_pedido = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });
    const id_item   = parseInt(req.params.id_item, 10);
    if (isNaN(id_item)) return res.status(400).json({ error: "ID invalido" });
    const { cantidad } = req.body || {};
    if (cantidad === undefined) return res.status(400).json({ error: 'cantidad requerida' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const totales = await pedidoWeb.modificarItemPedidoCliente(
            client, req.id_empresa_web, req.cliente_web.id_cliente, id_pedido, id_item, cantidad
        );
        await client.query('COMMIT');
        return res.json({ ok: true, totales });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// DELETE /mis-pedidos/:id/items/:id_item
exports.eliminarItemCliente = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const id_pedido = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });
    const id_item   = parseInt(req.params.id_item, 10);
    if (isNaN(id_item)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const totales = await pedidoWeb.eliminarItemPedidoCliente(
            client, req.id_empresa_web, req.cliente_web.id_cliente, id_pedido, id_item
        );
        await client.query('COMMIT');
        return res.json({ ok: true, totales });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// POST /mis-pedidos/:id/cancelar
exports.cancelarPedidoCliente = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const id_pedido = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await pedidoWeb.cancelarPedidoCliente(
            client, req.id_empresa_web, req.cliente_web.id_cliente, id_pedido
        );
        await client.query('COMMIT');
        return res.json({ ok: true, ...r });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ═════════════════════════════════════════════════════════════════════════
// ADMIN (req.usuario = staff)
// ═════════════════════════════════════════════════════════════════════════

// GET /admin/pedidos-web/pendientes
exports.adminListarPendientes = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const limit  = Math.min(parseInt(req.query.limit, 10)  || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const filtro = req.query.filtro || 'pendientes';

    const client = await pool.connect();
    try {
        const result = await pedidoWeb.listarPendientesAdmin(client, id_empresa, { limit, offset, filtro });
        return res.json(result);
    } catch (err) {
        console.error('adminListarPendientes:', err);
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /admin/pedidos-web/:id  (reutiliza obtenerPedidoCliente sin filtro de cliente)
exports.adminDetalle = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_pedido  = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        // Obtenemos cabecera + items sin filtrar por cliente
        const cab = await client.query(`
            SELECT p.id_pedido, p.nro_pedido, p.id_cliente, p.id_estado, pe.nombre AS estado_nombre,
                   p.fecha_creacion, p.total_final, p.subtotal_sin_iva, p.total_iva,
                   p.tipo_entrega, p.domicilio_entrega, p.observaciones,
                   c.razon_social, c.usuario_web, c.telefono, c.email
              FROM pedidos p
              JOIN pedidoestados pe ON pe.id_estado = p.id_estado
              JOIN clientes c       ON c.id_cliente = p.id_cliente
             WHERE p.id_empresa = $1 AND p.id_pedido = $2
             LIMIT 1
        `, [id_empresa, id_pedido]);
        if (!cab.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });

        const items = await client.query(`
            SELECT pi.id_item, pi.id_producto, pi.descripcion_congelada,
                   pi.cantidad, pi.precio_unitario_final, pi.iva_aplicado,
                   pi.monto_iva, pi.total_linea,
                   p.url_imagen, p.sku
              FROM pedidoitems pi
              JOIN productos p ON p.id_producto = pi.id_producto
             WHERE pi.id_pedido = $1
             ORDER BY pi.id_item ASC
        `, [id_pedido]);

        return res.json({ ...cab.rows[0], items: items.rows });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// POST /admin/pedidos-web/:id/aprobar
exports.adminAprobar = async (req, res) => {
    const id_empresa  = req.usuario.id_empresa;
    const id_usuario  = req.usuario.id_usuario;
    const id_pedido   = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await pedidoWeb.aprobarPedidoWeb(client, id_empresa, id_pedido, id_usuario);
        await client.query('COMMIT');
        return res.json({ ok: true, ...r });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// POST /admin/pedidos-web/:id/rechazar
exports.adminRechazar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_usuario = req.usuario.id_usuario;
    const id_pedido  = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });
    const { motivo } = req.body || {};

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await pedidoWeb.rechazarPedidoWeb(client, id_empresa, id_pedido, motivo, id_usuario);
        await client.query('COMMIT');
        return res.json({ ok: true, ...r });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// PUT /admin/pedidos-web/:id/items/:id_item
exports.adminModificarItem = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_pedido  = parseInt(req.params.id, 10);
    if (isNaN(id_pedido)) return res.status(400).json({ error: "ID invalido" });
    const id_item    = parseInt(req.params.id_item, 10);
    if (isNaN(id_item)) return res.status(400).json({ error: "ID invalido" });
    const { cantidad } = req.body || {};
    if (cantidad === undefined) return res.status(400).json({ error: 'cantidad requerida' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const totales = await pedidoWeb.modificarItemAdmin(client, id_empresa, id_pedido, id_item, cantidad);
        await client.query('COMMIT');
        return res.json({ ok: true, totales });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /admin/carritos-abandonados
exports.adminCarritosAbandonados = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const client = await pool.connect();
    try {
        const r = await client.query(`
            SELECT * FROM v_carritos_abandonados
             WHERE id_empresa = $1
             ORDER BY fecha_modificacion DESC
             LIMIT 200
        `, [id_empresa]);
        return res.json({ carritos: r.rows });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// GET /admin/clientes-web
exports.adminClientesWeb = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const client = await pool.connect();
    try {
        const r = await client.query(`
            SELECT id_cliente, razon_social, usuario_web, email, telefono,
                   web_activo, web_aprobado, web_origen, fecha_alta_web, ultimo_login_web
              FROM clientes
             WHERE id_empresa = $1 AND usuario_web IS NOT NULL
             ORDER BY fecha_alta_web DESC NULLS LAST
             LIMIT 500
        `, [id_empresa]);
        return res.json({ clientes: r.rows });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// PUT /admin/clientes-web/:id/aprobar
exports.adminAprobarCliente = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_cliente = parseInt(req.params.id, 10);
    if (isNaN(id_cliente)) return res.status(400).json({ error: "ID invalido" });
    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE clientes SET web_aprobado = true, web_activo = true
             WHERE id_empresa = $1 AND id_cliente = $2
        `, [id_empresa, id_cliente]);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// PUT /admin/clientes-web/:id/desactivar
exports.adminDesactivarCliente = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_cliente = parseInt(req.params.id, 10);
    if (isNaN(id_cliente)) return res.status(400).json({ error: "ID invalido" });
    const client = await pool.connect();
    try {
        await client.query(`
            UPDATE clientes SET web_activo = false
             WHERE id_empresa = $1 AND id_cliente = $2
        `, [id_empresa, id_cliente]);
        return res.json({ ok: true });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};
