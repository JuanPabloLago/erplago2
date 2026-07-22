/**
 * CONTROLLER PROVEEDORES — MIGRADO FASE 8d via crud.helper.js
 */
const pool = require('../config/database');
const cuitLookup = require('../utils/cuit-lookup.helper');
const crudHelper = require('../utils/crud.helper');

exports.buscarDatosCUIT = async (req, res) => {
    const { cuit } = req.params;
    try {
        if (!cuitLookup.validarCuit(cuit)) return res.status(400).json({ error: 'CUIT inválido', mensaje: 'El CUIT ingresado no tiene un formato válido' });
        const datos = await cuitLookup.consultarPadron(cuit);
        const id_empresa = parseInt(req.usuario.id_empresa, 10);
        const { rows: existente } = await pool.query('SELECT id_proveedor, razon_social FROM proveedores WHERE id_empresa = $1 AND cuit = $2 AND activo = TRUE', [id_empresa, cuitLookup.formatearCuit(cuit)]);
        res.json({ success: true, datos: { cuit: cuitLookup.formatearCuit(cuit), razon_social: datos.razon_social, nombre_fantasia: datos.nombre_fantasia, tipo_persona: datos.tipo_persona, id_condicion_iva: datos.id_condicion_iva, condicion_iva_descripcion: datos.condicion_iva_descripcion, domicilio: datos.domicilio, localidad: datos.localidad, provincia: datos.provincia, codigo_postal: datos.codigo_postal, estado_cuit: datos.estado_cuit }, existe_en_sistema: existente.length > 0, proveedor_existente: existente[0] || null });
    } catch (error) { res.status(500).json({ error: 'Error al consultar AFIP', mensaje: error.message }); }
};

exports.buscarAvanzado = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { q = '', condicion_iva, provincia, activo = 'true', limit = 100, offset = 0 } = req.query;
    try {
        let whereClause = 'p.id_empresa = $1'; const params = [id_empresa]; let paramIndex = 2;
        if (activo !== 'todos') whereClause += ` AND p.activo = ${activo === 'true'}`;
        if (condicion_iva && condicion_iva !== 'todos') { whereClause += ` AND p.id_condicion_iva = $${paramIndex}`; params.push(parseInt(condicion_iva)); paramIndex++; }
        if (provincia && provincia !== 'todos') { whereClause += ` AND p.provincia = $${paramIndex}`; params.push(provincia); paramIndex++; }
        let orderClause = 'p.razon_social';
        if (q && q.trim()) { const termino = q.trim().toLowerCase(); whereClause += ` AND (p.busqueda_vector @@ plainto_tsquery('spanish', $${paramIndex}) OR p.busqueda_texto ILIKE '%' || $${paramIndex} || '%')`; params.push(termino); orderClause = `GREATEST(ts_rank(p.busqueda_vector, plainto_tsquery('spanish', $${paramIndex})), similarity(p.busqueda_texto, $${paramIndex})) DESC, p.razon_social`; paramIndex++; }
        const query = `SELECT p.id_proveedor, p.razon_social, p.nombre_fantasia, p.cuit, p.domicilio, p.localidad, p.provincia, p.codigo_postal, p.telefono, p.email, p.id_condicion_iva, ci.nombre as condicion_iva, p.contacto_nombre, p.contacto_puesto, p.rubro, p.activo, p.fecha_creacion FROM proveedores p LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva WHERE ${whereClause} ORDER BY ${orderClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));
        const countQuery = `SELECT COUNT(*) as total FROM proveedores p WHERE ${whereClause}`;
        const [dataResult, countResult] = await Promise.all([pool.query(query, params), pool.query(countQuery, params.slice(0, paramIndex - 1))]);
        res.json({ success: true, proveedores: dataResult.rows, total: parseInt(countResult.rows[0].total), limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) { res.status(500).json({ error: 'Error al buscar proveedores' }); }
};

exports.getFormData = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const [condicionesIVA, provincias] = await Promise.all([
            pool.query('SELECT id_condicion_iva, nombre, discrimina_iva FROM condicionesiva ORDER BY nombre'),
            pool.query("SELECT DISTINCT provincia FROM proveedores WHERE id_empresa = $1 AND provincia IS NOT NULL AND provincia != '' ORDER BY provincia", [id_empresa])
        ]);
        res.json({ condiciones_iva: condicionesIVA.rows, provincias: provincias.rows.map(p => p.provincia) });
    } catch (error) { res.status(500).json({ error: 'Error al obtener datos del formulario' }); }
};

exports.obtenerPorId = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_proveedor = parseInt(req.params.id, 10);
    try {
        const { rows } = await pool.query('SELECT p.*, ci.nombre as condicion_iva_desc FROM proveedores p LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva WHERE p.id_proveedor = $1 AND p.id_empresa = $2', [id_proveedor, id_empresa]);
        if (rows.length === 0) return res.status(404).json({ error: 'Proveedor no encontrado' });
        res.json(rows[0]);
    } catch (error) { res.status(500).json({ error: 'Error al obtener proveedor' }); }
};

exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query('SELECT p.*, ci.nombre as condicion_iva FROM proveedores p LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva WHERE p.id_empresa = $1 AND p.activo = TRUE ORDER BY p.razon_social', [id_empresa]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener proveedores' }); }
};

exports.crear = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { razon_social, nombre_fantasia, cuit, id_condicion_iva, domicilio, localidad, provincia, codigo_postal, telefono, email, contacto_nombre, contacto_puesto, rubro } = req.body;
    if (!razon_social || !id_condicion_iva) return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    try {
        // >>> HELPER <<<
        const proveedor = await crudHelper.crearProveedor(pool, { id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva, domicilio, localidad, provincia, codigo_postal, telefono, email, contacto_nombre, contacto_puesto, rubro });
        res.status(201).json({ success: true, message: 'Proveedor creado exitosamente', proveedor });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'El CUIT ya existe para otro proveedor' });
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
};

exports.actualizar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_proveedor = parseInt(req.params.id, 10);
    const { razon_social, nombre_fantasia, cuit, id_condicion_iva, domicilio, localidad, provincia, codigo_postal, telefono, email, contacto_nombre, contacto_puesto, rubro } = req.body;
    if (!razon_social || !id_condicion_iva) return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    try {
        // >>> HELPER <<<
        const proveedor = await crudHelper.actualizarProveedor(pool, { id_proveedor, id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva, domicilio, localidad, provincia, codigo_postal, telefono, email, contacto_nombre, contacto_puesto, rubro });
        if (!proveedor) return res.status(404).json({ error: 'Proveedor no encontrado' });
        res.json({ success: true, message: 'Proveedor actualizado exitosamente', proveedor });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'El CUIT ya existe para otro proveedor' });
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
};

exports.eliminar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_proveedor = parseInt(req.params.id, 10);
    try {
        // Guard: no desactivar proveedor con comprobantes vivos o saldo pendiente
        const { rows: dep } = await pool.query(
            `SELECT
                (SELECT COUNT(*) FROM comprobantes_compra
                  WHERE id_proveedor = $1 AND id_empresa = $2 AND estado <> 'anulado') AS comprobantes_vivos,
                (SELECT COALESCE(SUM(saldo), 0) FROM cuentas_por_pagar
                  WHERE id_proveedor = $1 AND id_empresa = $2) AS saldo_pendiente`,
            [id_proveedor, id_empresa]
        );
        if (dep[0].comprobantes_vivos > 0) {
            return res.status(400).json({
                error: 'No se puede desactivar el proveedor: tiene ' + dep[0].comprobantes_vivos + ' comprobante(s) vivo(s).'
            });
        }
        if (Math.abs(parseFloat(dep[0].saldo_pendiente)) > 0.01) {
            return res.status(400).json({
                error: 'No se puede desactivar el proveedor: tiene saldo pendiente de $' + dep[0].saldo_pendiente
            });
        }
        // >>> HELPER <<<
        const result = await crudHelper.desactivarProveedor(pool, { id_proveedor, id_empresa });
        if (!result) return res.status(404).json({ error: 'Proveedor no encontrado' });
        res.json({ success: true, message: 'Proveedor eliminado exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar proveedor' }); }
};

exports.cambiarEstadoMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids, activo } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Debe seleccionar al menos un proveedor' });
    try {
        // >>> HELPER <<<
        const count = await crudHelper.actualizarProveedoresMasivo(pool, { ids, id_empresa, activo });
        res.json({ success: true, message: `${count} proveedor(es) ${activo ? 'activado(s)' : 'desactivado(s)'} exitosamente`, afectados: count });
    } catch (error) { res.status(500).json({ error: 'Error al cambiar estado de proveedores' }); }
};

exports.exportarExcel = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids } = req.body;
    try {
        let query = `SELECT p.razon_social, p.nombre_fantasia, p.cuit, ci.nombre as condicion_iva, p.domicilio, p.localidad, p.provincia, p.codigo_postal, p.telefono, p.email, p.contacto_nombre, p.contacto_puesto, p.rubro, CASE WHEN p.activo THEN 'Activo' ELSE 'Inactivo' END as estado, p.fecha_creacion FROM proveedores p LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva WHERE p.id_empresa = $1`;
        const params = [id_empresa];
        if (ids && ids.length > 0) { query += ' AND p.id_proveedor = ANY($2)'; params.push(ids); }
        query += ' ORDER BY p.razon_social';
        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) { res.status(500).json({ error: 'Error al exportar proveedores' }); }
};

exports.obtenerIdsFiltrados = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { q, condicion_iva, provincia, activo = 'true' } = req.query;
    try {
        let whereClause = 'id_empresa = $1'; const params = [id_empresa]; let paramIndex = 2;
        if (activo !== 'todos') whereClause += ` AND activo = ${activo === 'true'}`;
        if (condicion_iva && condicion_iva !== 'todos') { whereClause += ` AND id_condicion_iva = $${paramIndex}`; params.push(parseInt(condicion_iva)); paramIndex++; }
        if (provincia && provincia !== 'todos') { whereClause += ` AND provincia = $${paramIndex}`; params.push(provincia); paramIndex++; }
        if (q && q.trim()) { whereClause += ` AND busqueda_texto ILIKE '%' || $${paramIndex} || '%'`; params.push(q.trim().toLowerCase()); }
        const { rows } = await pool.query(`SELECT id_proveedor FROM proveedores WHERE ${whereClause}`, params);
        res.json({ ids: rows.map(r => r.id_proveedor), total: rows.length });
    } catch (error) { res.status(500).json({ error: 'Error al obtener IDs' }); }
};
