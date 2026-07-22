const pool = require('../config/database');
const crudHelper = require('../utils/crud.helper');

exports.listar = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT c.*, cp.nombre as categoria_padre FROM categorias c LEFT JOIN categorias cp ON c.id_categoria_padre = cp.id_categoria WHERE c.activo = TRUE ORDER BY COALESCE(c.id_categoria_padre, 0), c.orden, c.nombre');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener categorías' }); }
};

exports.obtenerPrincipales = async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM categorias WHERE id_categoria_padre IS NULL AND activo = TRUE ORDER BY orden, nombre'); res.json(rows); }
    catch (error) { res.status(500).json({ error: 'Error al obtener categorías principales' }); }
};

exports.obtenerSubcategorias = async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM categorias WHERE id_categoria_padre = $1 AND activo = TRUE ORDER BY orden, nombre', [parseInt(req.params.id, 10)]); res.json(rows); }
    catch (error) { res.status(500).json({ error: 'Error al obtener subcategorías' }); }
};

exports.obtenerArbol = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM categorias WHERE activo = TRUE ORDER BY COALESCE(id_categoria_padre, 0), orden, nombre');
        const categorias = rows.filter(c => c.id_categoria_padre === null);
        categorias.forEach(cat => { cat.subcategorias = rows.filter(c => c.id_categoria_padre === cat.id_categoria); });
        res.json(categorias);
    } catch (error) { res.status(500).json({ error: 'Error al obtener árbol de categorías' }); }
};

exports.crear = async (req, res) => {
    const { nombre, descripcion, id_categoria_padre, orden } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    try {
        const categoria = await crudHelper.crearCategoria(pool, { nombre, descripcion, id_categoria_padre, orden });
        res.status(201).json({ message: 'Categoría creada exitosamente', categoria });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
        res.status(500).json({ error: 'Error al crear categoría' });
    }
};

exports.actualizar = async (req, res) => {
    const id_categoria = parseInt(req.params.id, 10);
    const { nombre, descripcion, id_categoria_padre, orden } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    if (id_categoria_padre === id_categoria) return res.status(400).json({ error: 'Una categoría no puede ser su propio padre' });
    try {
        const categoria = await crudHelper.actualizarCategoria(pool, { id_categoria, nombre, descripcion, id_categoria_padre, orden });
        if (!categoria) return res.status(404).json({ error: 'Categoría no encontrada' });
        res.json({ message: 'Categoría actualizada exitosamente', categoria });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
};

exports.eliminar = async (req, res) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    const reasignar_a = req.query.reasignar_a ? parseInt(req.query.reasignar_a, 10) : null;
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalido' });

    await client.query('BEGIN');

    const cat = await client.query('SELECT id_categoria FROM categorias WHERE id_categoria = $1 AND activo = true', [id]);
    if (cat.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Categoria no encontrada' });
    }

    const subs = await client.query('SELECT COUNT(*)::int AS cant FROM categorias WHERE id_categoria_padre = $1 AND activo = true', [id]);
    if (subs.rows[0].cant > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'La categoria tiene ' + subs.rows[0].cant + ' subcategoria(s). Eliminalas primero.' });
    }

    if (reasignar_a !== null) {
      if (reasignar_a === id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No se puede reasignar a la misma categoria' });
      }
      const dest = await client.query('SELECT 1 FROM categorias WHERE id_categoria = $1 AND activo = true', [reasignar_a]);
      if (dest.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Categoria destino no existe' });
      }
      await client.query('UPDATE productos SET id_categoria = $1 WHERE id_categoria = $2', [reasignar_a, id]);
    } else {
      await client.query('UPDATE productos SET id_categoria = NULL WHERE id_categoria = $1', [id]);
    }

    await client.query('UPDATE categorias SET activo = false WHERE id_categoria = $1', [id]);

    await client.query('COMMIT');
    res.json({ eliminado: true, reasignados_a: reasignar_a });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('categorias.eliminar:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.productosCount = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invalido' });
    const r = await pool.query(
      'SELECT COUNT(*)::int AS cant FROM productos WHERE id_categoria = $1 AND activo = true',
      [id]
    );
    res.json({ cant: r.rows[0].cant });
  } catch (err) {
    console.error('categorias.productosCount:', err);
    res.status(500).json({ error: err.message });
  }
};
