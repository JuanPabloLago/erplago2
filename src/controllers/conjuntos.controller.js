/**
 * CONJUNTOS CONTROLLER — Fix multi-empresa + id_empresa en todos los helpers
 */
const pool = require('../config/database');
const crudHelper = require('../utils/crud.helper');

exports.listar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    try {
        const { rows } = await pool.query(`
            SELECT c.*,
                   json_agg(
                       json_build_object(
                           'id_producto', p.id_producto,
                           'nombre', p.nombre,
                           'sku', p.sku,
                           'cantidad', ci.cantidad
                       ) ORDER BY p.nombre
                   ) FILTER (WHERE p.id_producto IS NOT NULL) as productos
            FROM conjuntos c
            LEFT JOIN conjunto_items ci ON c.id_conjunto = ci.id_conjunto AND ci.id_empresa = c.id_empresa
            LEFT JOIN productos p ON ci.id_producto = p.id_producto
            WHERE c.activo = TRUE AND c.id_empresa = $1
            GROUP BY c.id_conjunto
            ORDER BY c.nombre
        `, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('Error listar conjuntos:', error);
        res.status(500).json({ error: 'Error al obtener conjuntos' });
    }
};

exports.obtenerPorId = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_conjunto = parseInt(req.params.id, 10);
    try {
        const conjuntoRes = await pool.query(
            'SELECT * FROM conjuntos WHERE id_conjunto = $1 AND activo = TRUE AND id_empresa = $2',
            [id_conjunto, id_empresa]
        );
        if (conjuntoRes.rows.length === 0) return res.status(404).json({ error: 'Conjunto no encontrado' });

        const itemsRes = await pool.query(`
            SELECT ci.id_conjunto_item, ci.id_producto, ci.cantidad, p.nombre, p.sku, p.descripcion
            FROM conjunto_items ci
            JOIN productos p ON ci.id_producto = p.id_producto
            WHERE ci.id_conjunto = $1 AND ci.id_empresa = $2
            ORDER BY p.nombre
        `, [id_conjunto, id_empresa]);

        res.json({ ...conjuntoRes.rows[0], productos: itemsRes.rows });
    } catch (error) {
        console.error('Error obtener conjunto:', error);
        res.status(500).json({ error: 'Error al obtener conjunto' });
    }
};

exports.crear = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const { nombre, descripcion, precio_conjunto, descuento_porcentaje, productos } = req.body;

    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    if (!productos || productos.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un producto' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const conjunto = await crudHelper.crearConjunto(client, {
            id_empresa, nombre, descripcion, precio_conjunto, descuento_porcentaje
        });
        await crudHelper.insertarConjuntoItems(client, {
            id_empresa, id_conjunto: conjunto.id_conjunto, productos
        });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Conjunto creado exitosamente', conjunto });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error crear conjunto:', error);
        res.status(500).json({ error: 'Error al crear conjunto' });
    } finally {
        client.release();
    }
};

exports.actualizar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_conjunto = parseInt(req.params.id, 10);
    const { nombre, descripcion, precio_conjunto, descuento_porcentaje, productos, web_visible, web_slug, web_label, web_orden } = req.body;

    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const conjunto = await crudHelper.actualizarConjunto(client, {
            id_empresa, id_conjunto, nombre, descripcion, precio_conjunto, descuento_porcentaje,
            web_visible, web_slug, web_label, web_orden
        });
        if (!conjunto) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Conjunto no encontrado' });
        }
        if (productos && Array.isArray(productos)) {
            await crudHelper.reemplazarConjuntoItems(client, {
                id_empresa, id_conjunto, productos
            });
        }
        await client.query('COMMIT');
        res.json({ message: 'Conjunto actualizado exitosamente', conjunto });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizar conjunto:', error);
        res.status(500).json({ error: 'Error al actualizar conjunto' });
    } finally {
        client.release();
    }
};

exports.eliminar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_conjunto = parseInt(req.params.id, 10);
    try {
        const result = await crudHelper.desactivarConjunto(pool, { id_empresa, id_conjunto });
        if (!result) return res.status(404).json({ error: 'Conjunto no encontrado' });
        res.json({ message: 'Conjunto eliminado exitosamente' });
    } catch (error) {
        console.error('Error eliminar conjunto:', error);
        res.status(500).json({ error: 'Error al eliminar conjunto' });
    }
};
