const pool = require('../config/database');
const crudHelper = require('../utils/crud.helper');

exports.listar = async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM marcas WHERE activo = TRUE ORDER BY nombre'); res.json(rows); }
    catch (error) { res.status(500).json({ error: 'Error al obtener marcas' }); }
};

exports.obtenerPorId = async (req, res) => {
    try { const { rows } = await pool.query('SELECT * FROM marcas WHERE id_marca = $1 AND activo = TRUE', [parseInt(req.params.id, 10)]); if (rows.length === 0) return res.status(404).json({ error: 'Marca no encontrada' }); res.json(rows[0]); }
    catch (error) { res.status(500).json({ error: 'Error al obtener marca' }); }
};

exports.crear = async (req, res) => {
    const { nombre, descripcion, pais_origen, sitio_web, logo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    try {
        const marca = await crudHelper.crearMarca(pool, { nombre, descripcion, pais_origen, sitio_web, logo });
        res.status(201).json({ message: 'Marca creada exitosamente', marca });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
        res.status(500).json({ error: 'Error al crear marca' });
    }
};

exports.actualizar = async (req, res) => {
    const id_marca = parseInt(req.params.id, 10);
    const { nombre, descripcion, pais_origen, sitio_web, logo } = req.body;
    if (!nombre) return res.status(400).json({ error: 'El nombre es requerido' });
    try {
        const marca = await crudHelper.actualizarMarca(pool, { id_marca, nombre, descripcion, pais_origen, sitio_web, logo });
        if (!marca) return res.status(404).json({ error: 'Marca no encontrada' });
        res.json({ message: 'Marca actualizada exitosamente', marca });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
        res.status(500).json({ error: 'Error al actualizar marca' });
    }
};

exports.eliminar = async (req, res) => {
    const id_marca = parseInt(req.params.id, 10);
    try {
        const checkProd = await pool.query('SELECT COUNT(*) as total FROM productos WHERE id_marca = $1 AND activo = TRUE', [id_marca]);
        if (parseInt(checkProd.rows[0].total) > 0) return res.status(400).json({ error: 'No se puede eliminar una marca que tiene productos asignados' });
        const result = await crudHelper.desactivarMarca(pool, { id_marca });
        if (!result) return res.status(404).json({ error: 'Marca no encontrada' });
        res.json({ message: 'Marca eliminada exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar marca' }); }
};
