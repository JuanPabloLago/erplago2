const logger = require('../utils/logger');
/**
 * CONTROLLER CLIENTES — MIGRADO FASE 8d via crud.helper.js
 */
const pool = require('../config/database');
const cuitLookup = require('../utils/cuit-lookup.helper');
const crudHelper = require('../utils/crud.helper');

// ============================================================================
// CONSULTA AFIP
// ============================================================================
exports.buscarDatosDNI = async (req, res) => {
    const { dni } = req.params;
    try {
        const datos = await cuitLookup.resolverDesdeDNI(dni);
        const id_empresa = parseInt(req.usuario.id_empresa, 10);
        const { rows: existente } = await pool.query('SELECT id_cliente, razon_social FROM clientes WHERE id_empresa = $1 AND cuit_cuil = $2 AND activo = TRUE', [id_empresa, datos.cuit]);
        res.json({ success: true, datos: {
            cuit_cuil: datos.cuit, razon_social: datos.razon_social, nombre_fantasia: datos.nombre_fantasia,
            tipo_persona: datos.tipo_persona, id_condicion_iva: datos.id_condicion_iva,
            condicion_iva_descripcion: datos.condicion_iva_descripcion, domicilio: datos.domicilio,
            localidad: datos.localidad, provincia: datos.provincia, codigo_postal: datos.codigo_postal,
            estado_cuit: datos.estado_cuit, sin_inscripciones: datos.sin_inscripciones || false
        }, existe_en_sistema: existente.length > 0, cliente_existente: existente[0] || null });
    } catch (error) { console.error('❌ Error al consultar DNI:', error.message); res.status(500).json({ error: 'Error al consultar DNI', mensaje: error.message }); }
};

exports.buscarDatosCUIT = async (req, res) => {
    const { cuit } = req.params;
    try {
        if (!cuitLookup.validarCuit(cuit)) return res.status(400).json({ error: 'CUIT inválido', mensaje: 'El CUIT ingresado no tiene un formato válido' });
        const datos = await cuitLookup.consultarPadron(cuit);
        const id_empresa = parseInt(req.usuario.id_empresa, 10);
        const { rows: existente } = await pool.query('SELECT id_cliente, razon_social FROM clientes WHERE id_empresa = $1 AND cuit_cuil = $2 AND activo = TRUE', [id_empresa, cuitLookup.formatearCuit(cuit)]);
        res.json({ success: true, datos: { cuit_cuil: cuitLookup.formatearCuit(cuit), razon_social: datos.razon_social, nombre_fantasia: datos.nombre_fantasia, tipo_persona: datos.tipo_persona, id_condicion_iva: datos.id_condicion_iva, condicion_iva_descripcion: datos.condicion_iva_descripcion, domicilio: datos.domicilio, localidad: datos.localidad, provincia: datos.provincia, codigo_postal: datos.codigo_postal, estado_cuit: datos.estado_cuit, sin_inscripciones: datos.sin_inscripciones || false }, existe_en_sistema: existente.length > 0, cliente_existente: existente[0] || null });
    } catch (error) { console.error('❌ Error al consultar AFIP:', error.message); res.status(500).json({ error: 'Error al consultar AFIP', mensaje: error.message }); }
};

// ============================================================================
// BÚSQUEDA VECTORIAL
// ============================================================================
exports.buscar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { q = '', condicion_iva, provincia, lista_precio, activo = 'true', limit = 100, offset = 0 } = req.query;
    try {
        const params = [id_empresa];
        let paramIndex = 2;
        let whereClause = 'c.id_empresa = $1';

        if (activo !== 'todos') whereClause += ` AND c.activo = ${activo === 'true'}`;
        if (condicion_iva && condicion_iva !== 'todos') { whereClause += ` AND c.id_condicion_iva = $${paramIndex}`; params.push(parseInt(condicion_iva)); paramIndex++; }
        if (provincia && provincia !== 'todos') { whereClause += ` AND c.provincia = $${paramIndex}`; params.push(provincia); paramIndex++; }
        if (lista_precio && lista_precio !== 'todos') { whereClause += ` AND c.id_lista_precio = $${paramIndex}`; params.push(parseInt(lista_precio)); paramIndex++; }

        // ── Búsqueda fuzzy: palabras parciales, desordenadas ──
        let rankExpr = '1 as rank';
        if (q && q.trim()) {
            const palabras = q.trim().toLowerCase().split(/\s+/).filter(p => p.length >= 1);
            if (palabras.length > 0) {
                // Cada palabra debe matchear en busqueda_texto (parcial, cualquier orden)
                const condiciones = palabras.map(p => {
                    whereClause += ` AND c.busqueda_texto ILIKE '%' || $${paramIndex} || '%'`;
                    params.push(p);
                    paramIndex++;
                    return paramIndex - 1;
                });

                // Ranking: combinación de similarity por cada palabra + ts_rank si matchea
                const simParts = condiciones.map(pi => `similarity(c.busqueda_texto, $${pi})`).join(' + ');
                const tsQuery = palabras.map(p => p.split('').length >= 3 ? `$${condiciones[palabras.indexOf(p)]}:*` : '').filter(Boolean);

                // Rank = promedio de similarities
                rankExpr = `(${simParts}) / ${condiciones.length}.0 as rank`;
            }
        }

        const query = `SELECT c.id_cliente, c.razon_social, c.nombre_fantasia, c.cuit_cuil,
            c.domicilio, c.localidad, c.provincia, c.codigo_postal, c.telefono, c.email,
            c.id_condicion_iva, ci.nombre as condicion_iva,
            c.id_lista_precio, lp.nombre as lista_precio,
            c.limite_credito, c.saldo_actual, c.descuento_predefinido, c.activo, c.fecha_alta,
            ${rankExpr}
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            LEFT JOIN listasdeprecios lp ON c.id_lista_precio = lp.id_lista_precio AND lp.id_empresa = c.id_empresa
            WHERE ${whereClause}
            ORDER BY ${q && q.trim() ? 'rank DESC,' : ''} c.razon_social
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

        params.push(parseInt(limit), parseInt(offset));

        const countParams = params.slice(0, paramIndex - 1);
        const countQuery = `SELECT COUNT(*) as total FROM clientes c WHERE ${whereClause}`;

        const [dataResult, countResult] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, countParams)
        ]);

        res.json({
            success: true,
            clientes: dataResult.rows,
            total: parseInt(countResult.rows[0].total),
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('❌ Error en búsqueda de clientes:', error.message);
        res.status(500).json({ error: 'Error al buscar clientes' });
    }
};

// ============================================================================
// DATOS FORMULARIO
// ============================================================================
exports.getFormData = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const [condicionesIVA, listasPrecios, provincias] = await Promise.all([
            pool.query('SELECT id_condicion_iva, nombre, discrimina_iva FROM condicionesiva ORDER BY nombre'),
            pool.query('SELECT id_lista_precio, nombre FROM listasdeprecios WHERE id_empresa = $1 AND activa = TRUE ORDER BY nombre', [id_empresa]),
            pool.query("SELECT DISTINCT provincia FROM clientes WHERE id_empresa = $1 AND provincia IS NOT NULL AND provincia != '' ORDER BY provincia", [id_empresa])
        ]);
        res.json({ condiciones_iva: condicionesIVA.rows, listas_precios: listasPrecios.rows, provincias: provincias.rows.map(p => p.provincia) });
    } catch (error) { res.status(500).json({ error: 'Error al obtener datos del formulario' }); }
};

// ============================================================================
// CRUD — MIGRADO A HELPER
// ============================================================================
exports.obtenerPorId = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_cliente = parseInt(req.params.id, 10);
    try {
        const { rows } = await pool.query(`SELECT c.*, COALESCE((SELECT ccc.saldo FROM cuentacorrienteclientes ccc WHERE ccc.id_cliente = c.id_cliente AND ccc.id_empresa = c.id_empresa ORDER BY ccc.fecha DESC, ccc.id_movimiento_cc_cliente DESC LIMIT 1), 0) as saldo_cuenta_corriente, COALESCE((SELECT SUM(ccc.debe) FROM cuentacorrienteclientes ccc WHERE ccc.id_cliente = c.id_cliente AND ccc.id_empresa = c.id_empresa), 0) as total_debe, COALESCE((SELECT SUM(ccc.haber) FROM cuentacorrienteclientes ccc WHERE ccc.id_cliente = c.id_cliente AND ccc.id_empresa = c.id_empresa), 0) as total_haber, ci.nombre as condicion_iva_desc, lp.nombre as lista_precio_nombre FROM clientes c LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva LEFT JOIN listasdeprecios lp ON c.id_lista_precio = lp.id_lista_precio AND lp.id_empresa = c.id_empresa WHERE c.id_cliente = $1 AND c.id_empresa = $2`, [id_cliente, id_empresa]);
        if (rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json(rows[0]);
    } catch (error) { res.status(500).json({ error: 'Error al obtener cliente' }); }
};

exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(`SELECT c.*, COALESCE((SELECT SUM(f.total - COALESCE(f.monto_pagado, 0)) FROM facturas f WHERE f.id_cliente = c.id_cliente AND f.id_empresa = c.id_empresa AND f.estado NOT IN ('anulada', 'pagada')), 0) as saldo_pendiente_real, ci.nombre as condicion_iva FROM clientes c LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva WHERE c.id_empresa = $1 AND c.activo = TRUE ORDER BY c.razon_social`, [id_empresa]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error al obtener clientes' }); }
};

exports.crear = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona, domicilio, localidad, provincia, codigo_postal, telefono, email, id_lista_precio, limite_credito, descuento_predefinido, observaciones } = req.body;
    if (!razon_social || !id_condicion_iva) return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    try {
        // >>> HELPER <<<
        const cliente = await crudHelper.crearCliente(pool, { id_empresa, razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona, domicilio, localidad, provincia, codigo_postal, telefono, email, id_lista_precio, limite_credito, descuento_predefinido, observaciones });
        res.status(201).json({ success: true, message: 'Cliente creado exitosamente', cliente });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'El CUIT/CUIL ya existe para otro cliente' });
        res.status(500).json({ error: 'Error al crear cliente' });
    }
};

exports.actualizar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_cliente = parseInt(req.params.id, 10);
    const { razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona, domicilio, localidad, provincia, codigo_postal, telefono, email, id_lista_precio, limite_credito, descuento_predefinido, observaciones } = req.body;
    if (!razon_social || !id_condicion_iva) return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    try {
        // >>> HELPER <<<
        const cliente = await crudHelper.actualizarCliente(pool, { id_cliente, id_empresa, razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona, domicilio, localidad, provincia, codigo_postal, telefono, email, id_lista_precio, limite_credito, descuento_predefinido, observaciones });
        if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json({ success: true, message: 'Cliente actualizado exitosamente', cliente });
    } catch (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'El CUIT/CUIL ya existe para otro cliente' });
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
};

exports.eliminar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const id_cliente = parseInt(req.params.id, 10);
    try {
        const { rows: dep } = await pool.query(`SELECT (SELECT COUNT(*) FROM pedidos WHERE id_cliente = $1 AND id_estado NOT IN (6, 7)) as pedidos_activos`, [id_cliente]);
        if (dep[0].pedidos_activos > 0) return res.status(400).json({ error: 'No se puede eliminar el cliente porque tiene pedidos activos' });
        // >>> HELPER <<<
        const result = await crudHelper.desactivarCliente(pool, { id_cliente, id_empresa });
        if (!result) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.json({ success: true, message: 'Cliente eliminado exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al eliminar cliente' }); }
};

// ============================================================================
// ACCIONES MASIVAS — MIGRADO A HELPER
// ============================================================================
exports.cambiarEstadoMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids, activo } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Debe seleccionar al menos un cliente' });
    try {
        const count = await crudHelper.actualizarClientesMasivo(pool, { ids, id_empresa, campo: 'activo', valor: activo });
        res.json({ success: true, message: `${count} cliente(s) ${activo ? 'activado(s)' : 'desactivado(s)'} exitosamente`, afectados: count });
    } catch (error) { res.status(500).json({ error: 'Error al cambiar estado de clientes' }); }
};

exports.asignarListaMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids, id_lista_precio } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Debe seleccionar al menos un cliente' });
    try {
        const count = await crudHelper.actualizarClientesMasivo(pool, { ids, id_empresa, campo: 'id_lista_precio', valor: id_lista_precio || null });
        res.json({ success: true, message: `Lista de precios asignada a ${count} cliente(s)`, afectados: count });
    } catch (error) { res.status(500).json({ error: 'Error al asignar lista de precios' }); }
};

exports.asignarDescuentoMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids, descuento } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Debe seleccionar al menos un cliente' });
    if (descuento < 0 || descuento > 100) return res.status(400).json({ error: 'El descuento debe estar entre 0 y 100' });
    try {
        const count = await crudHelper.actualizarClientesMasivo(pool, { ids, id_empresa, campo: 'descuento_predefinido', valor: descuento });
        res.json({ success: true, message: `Descuento del ${descuento}% asignado a ${count} cliente(s)`, afectados: count });
    } catch (error) { res.status(500).json({ error: 'Error al asignar descuento' }); }
};

// ============================================================================
// EXPORTACIÓN (solo lectura)
// ============================================================================
exports.exportarExcel = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { ids } = req.body;
    try {
        let query = `SELECT c.razon_social, c.nombre_fantasia, c.cuit_cuil, ci.nombre as condicion_iva, c.domicilio, c.localidad, c.provincia, c.codigo_postal, c.telefono, c.email, lp.nombre as lista_precio, c.limite_credito, c.saldo_actual, c.descuento_predefinido, CASE WHEN c.activo THEN 'Activo' ELSE 'Inactivo' END as estado, c.fecha_alta FROM clientes c LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva LEFT JOIN listasdeprecios lp ON c.id_lista_precio = lp.id_lista_precio AND lp.id_empresa = c.id_empresa WHERE c.id_empresa = $1`;
        const params = [id_empresa];
        if (ids && ids.length > 0) { query += ' AND c.id_cliente = ANY($2)'; params.push(ids); }
        query += ' ORDER BY c.razon_social';
        const { rows } = await pool.query(query, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) { res.status(500).json({ error: 'Error al exportar clientes' }); }
};

exports.obtenerIdsFiltrados = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { q, condicion_iva, provincia, lista_precio, activo = 'true' } = req.query;
    try {
        let whereClause = 'id_empresa = $1'; const params = [id_empresa]; let paramIndex = 2;
        if (activo !== 'todos') whereClause += ` AND activo = ${activo === 'true'}`;
        if (condicion_iva && condicion_iva !== 'todos') { whereClause += ` AND id_condicion_iva = $${paramIndex}`; params.push(parseInt(condicion_iva)); paramIndex++; }
        if (provincia && provincia !== 'todos') { whereClause += ` AND provincia = $${paramIndex}`; params.push(provincia); paramIndex++; }
        if (lista_precio && lista_precio !== 'todos') { whereClause += ` AND id_lista_precio = $${paramIndex}`; params.push(parseInt(lista_precio)); paramIndex++; }
        if (q && q.trim()) { whereClause += ` AND busqueda_texto ILIKE '%' || $${paramIndex} || '%'`; params.push(q.trim().toLowerCase()); }
        const { rows } = await pool.query(`SELECT id_cliente FROM clientes WHERE ${whereClause}`, params);
        res.json({ ids: rows.map(r => r.id_cliente), total: rows.length });
    } catch (error) { res.status(500).json({ error: 'Error al obtener IDs' }); }
};

exports.buscarCobranzas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10); const { q } = req.query;
    if (!q || q.trim().length < 1) return res.json([]);
    try {
        const patron = '%' + q.trim().toLowerCase().replace(/\s+/g, '%') + '%';
        const { rows } = await pool.query(`SELECT c.id_cliente, c.razon_social, c.nombre_fantasia, c.cuit_cuil, c.telefono, c.domicilio, c.localidad, c.provincia, c.email, c.saldo_actual, c.limite_credito, c.descuento_predefinido, COALESCE((SELECT ccc.saldo FROM cuentacorrienteclientes ccc WHERE ccc.id_cliente = c.id_cliente AND ccc.id_empresa = $1 ORDER BY ccc.fecha DESC, ccc.id_movimiento_cc_cliente DESC LIMIT 1), 0)::numeric(12,2) as saldo_pendiente, COALESCE((SELECT COUNT(*) FROM facturas f WHERE f.id_cliente = c.id_cliente AND f.id_empresa = $1 AND f.estado NOT IN ('anulada', 'pagada') AND (f.total - COALESCE(f.monto_pagado, 0)) > 0.01), 0)::int as facturas_pendientes FROM clientes c WHERE c.id_empresa = $1 AND c.activo = true AND (c.id_cliente::text = $2 OR LOWER(COALESCE(c.razon_social,'') || ' ' || COALESCE(c.nombre_fantasia,'') || ' ' || COALESCE(c.cuit_cuil,'') || ' ' || COALESCE(c.telefono,'') || ' ' || COALESCE(c.domicilio,'') || ' ' || COALESCE(c.localidad,'')) LIKE $3) ORDER BY CASE WHEN LOWER(c.razon_social) LIKE $4 THEN 0 ELSE 1 END, c.razon_social LIMIT 15`, [id_empresa, q.trim(), patron, q.trim().toLowerCase() + '%']);
        logger.debug(' Búsqueda: "' + q + '" -> ' + rows.length + ' resultados');
        res.json(rows);
    } catch (error) { res.status(500).json({ error: 'Error en búsqueda' }); }
};
