/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CARRITO-WEB CONTROLLER — ERP LAGO
 * Endpoints del carrito web (anonimo o logueado)
 * ═══════════════════════════════════════════════════════════════════════════
 * Toda la logica vive en carrito-web.helper.js. Este controller solo:
 *   - Resuelve si el carrito es del cliente logueado o anonimo (cookie session)
 *   - Abre/cierra transacciones
 *   - Mapea HTTP <-> helper
 *
 * Rutas:
 *   GET    /api/web/carrito
 *   POST   /api/web/carrito/items
 *   PUT    /api/web/carrito/items/:id_item
 *   DELETE /api/web/carrito/items/:id_item
 *   DELETE /api/web/carrito           (vaciar)
 */

const pool    = require('../config/database');
const carrito = require('../utils/carrito-web.helper');

function _ip(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.connection?.remoteAddress
        || req.ip
        || null;
}

/**
 * Resuelve el carrito activo del request:
 *  - Si esta logueado: el del cliente
 *  - Si no: el de la session anonima (cookie lago_web_session)
 * Crea uno si no existe.
 */
async function _resolverCarrito(client, req) {
    const id_empresa = req.id_empresa_web;
    const id_cliente = req.cliente_web ? req.cliente_web.id_cliente : null;
    const session_token = req.session_token_anonimo || null;

    return await carrito.obtenerOCrearCarrito(client, {
        id_empresa,
        id_cliente,
        session_token,
        ip_origen:  _ip(req),
        user_agent: req.headers['user-agent'] || null
    });
}

// ─────────────────────────────────────────────────────────────────────────
// GET /carrito
// ─────────────────────────────────────────────────────────────────────────

exports.obtener = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cab = await _resolverCarrito(client, req);
        const full = await carrito.obtenerCarritoConItems(client, req.id_empresa_web, cab.id_carrito);
        await client.query('COMMIT');
        return res.json(full);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('carrito.obtener:', err);
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /carrito/items
// body: { id_producto, cantidad }
// ─────────────────────────────────────────────────────────────────────────

exports.agregarItem = async (req, res) => {
    const { id_producto, cantidad } = req.body || {};
    if (!id_producto || !cantidad) {
        return res.status(400).json({ error: 'id_producto y cantidad requeridos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cab = await _resolverCarrito(client, req);
        await carrito.agregarItem(client, req.id_empresa_web, cab.id_carrito, id_producto, cantidad);
        const full = await carrito.obtenerCarritoConItems(client, req.id_empresa_web, cab.id_carrito);
        await client.query('COMMIT');
        return res.json(full);
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// PUT /carrito/items/:id_item
// body: { cantidad }
// ─────────────────────────────────────────────────────────────────────────

exports.modificarItem = async (req, res) => {
    const { id_item } = req.params;
    const { cantidad } = req.body || {};
    if (cantidad === undefined) {
        return res.status(400).json({ error: 'cantidad requerida' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cab = await _resolverCarrito(client, req);
        await carrito.modificarItem(client, req.id_empresa_web, cab.id_carrito, parseInt(id_item, 10), cantidad);
        const full = await carrito.obtenerCarritoConItems(client, req.id_empresa_web, cab.id_carrito);
        await client.query('COMMIT');
        return res.json(full);
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// DELETE /carrito/items/:id_item
// ─────────────────────────────────────────────────────────────────────────

exports.eliminarItem = async (req, res) => {
    const { id_item } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cab = await _resolverCarrito(client, req);
        await carrito.eliminarItem(client, req.id_empresa_web, cab.id_carrito, parseInt(id_item, 10));
        const full = await carrito.obtenerCarritoConItems(client, req.id_empresa_web, cab.id_carrito);
        await client.query('COMMIT');
        return res.json(full);
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// DELETE /carrito  (vaciar)
// ─────────────────────────────────────────────────────────────────────────

exports.vaciar = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cab = await _resolverCarrito(client, req);
        await carrito.vaciarCarrito(client, req.id_empresa_web, cab.id_carrito);
        const full = await carrito.obtenerCarritoConItems(client, req.id_empresa_web, cab.id_carrito);
        await client.query('COMMIT');
        return res.json(full);
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};
