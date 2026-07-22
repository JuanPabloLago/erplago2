const pool = require('../config/database');
const productosHelper = require('../utils/productos.helper');
const crudHelper = require('../utils/crud.helper');

exports.obtenerPorProducto = async (req, res) => {
    try { const { rows } = await pool.query('SELECT v.*, p.nombre as producto_maestro, p.sku as sku_maestro FROM producto_variantes v JOIN productos p ON v.id_producto = p.id_producto WHERE v.id_producto = $1 AND v.activo = TRUE ORDER BY v.nombre_variante', [parseInt(req.params.id, 10)]); res.json(rows); }
    catch (error) { res.status(500).json({ error: 'Error al obtener variantes' }); }
};

exports.obtenerPorId = async (req, res) => {
    try { const { rows } = await pool.query('SELECT v.*, p.nombre as producto_maestro FROM producto_variantes v JOIN productos p ON v.id_producto = p.id_producto WHERE v.id_variante = $1 AND v.activo = TRUE', [parseInt(req.params.id, 10)]); if (rows.length === 0) return res.status(404).json({ error: 'Variante no encontrada' }); res.json(rows[0]); }
    catch (error) { res.status(500).json({ error: 'Error al obtener variante' }); }
};

exports.crear = async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    const { nombre_variante, sku, precio, stock, stock_minimo, atributos } = req.body;
    if (!nombre_variante || !sku) return res.status(400).json({ error: 'Nombre y SKU son requeridos' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const prodCheck = await client.query('SELECT id_producto, tiene_variantes FROM productos WHERE id_producto = $1', [id_producto]);
        if (prodCheck.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado' }); }
        if (!prodCheck.rows[0].tiene_variantes) await productosHelper.setTieneVariantes(client, { id_producto });
        const variante = await crudHelper.crearVariante(client, { id_producto, nombre_variante, sku, precio, stock, stock_minimo, atributos });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Variante creada exitosamente', variante });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(409).json({ error: 'El SKU ya existe' });
        res.status(500).json({ error: 'Error al crear variante' });
    } finally { client.release(); }
};

exports.actualizar = async (req, res) => {
    const id_variante = parseInt(req.params.id, 10);
    const { nombre_variante, sku, precio, stock, stock_minimo, atributos } = req.body;
    if (!nombre_variante || !sku) return res.status(400).json({ error: 'Nombre y SKU son requeridos' });
    try {
        const variante = await crudHelper.actualizarVariante(pool, { id_variante, nombre_variante, sku, precio, stock, stock_minimo, atributos });
        if (!variante) return res.status(404).json({ error: 'Variante no encontrada' });
        res.json({ message: 'Variante actualizada exitosamente', variante });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'El SKU ya existe' });
        res.status(500).json({ error: 'Error al actualizar variante' });
    }
};

exports.eliminar = async (req, res) => {
    try {
        const result = await crudHelper.desactivarVariante(pool, { id_variante: parseInt(req.params.id, 10) });
        if (!result) return res.status(404).json({ error: 'Variante no encontrada' });
        res.json({ message: 'Variante eliminada exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar variante' }); }
};

exports.buscar = async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json({ results: [] });
    try { const { rows } = await pool.query('SELECT v.*, p.nombre as producto_maestro FROM producto_variantes v JOIN productos p ON v.id_producto = p.id_producto WHERE v.activo = TRUE AND (v.sku ILIKE $1 OR v.nombre_variante ILIKE $1 OR p.nombre ILIKE $1) ORDER BY v.nombre_variante LIMIT 20', [`%${q.trim()}%`]); res.json({ results: rows }); }
    catch (error) { res.status(500).json({ error: 'Error al buscar variantes' }); }
};
