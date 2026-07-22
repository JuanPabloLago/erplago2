/**
 * USUARIOS CONTROLLER - ERP LAGO
 * MIGRADO FASE 8d: Escrituras via admin.helper.js
 */
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const adminHelper = require('../utils/admin.helper');

const usuariosController = {

    async listar(req, res) {
        const { id_empresa, rol } = req.usuario;
        try {
            let query = `SELECT u.id_usuario, u.username, u.nombre, u.email, u.rol, u.estado, u.ultimo_login, u.fecha_creacion, u.id_empresa, u.id_deposito, e.razon_social as empresa_nombre, d.nombre as deposito_nombre FROM usuarios u LEFT JOIN empresas e ON u.id_empresa = e.id_empresa LEFT JOIN depositos d ON u.id_deposito = d.id_deposito`;
            const params = [];
            if (rol !== 'admin') { query += ` WHERE u.id_empresa = $1`; params.push(id_empresa); }
            query += ` ORDER BY u.username`;
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (error) { console.error('❌ Error al listar usuarios:', error.message); res.status(500).json({ error: 'Error al listar usuarios' }); }
    },

    async obtenerPorId(req, res) {
        const { id } = req.params; const { id_empresa, rol } = req.usuario;
        try {
            let query = `SELECT u.id_usuario, u.username, u.nombre, u.email, u.rol, u.estado, u.ultimo_login, u.fecha_creacion, u.id_empresa, u.id_deposito, e.razon_social as empresa_nombre, d.nombre as deposito_nombre FROM usuarios u LEFT JOIN empresas e ON u.id_empresa = e.id_empresa LEFT JOIN depositos d ON u.id_deposito = d.id_deposito WHERE u.id_usuario = $1`;
            const params = [id];
            if (rol !== 'admin') { query += ` AND u.id_empresa = $2`; params.push(id_empresa); }
            const { rows } = await pool.query(query, params);
            if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
            res.json(rows[0]);
        } catch (error) { console.error('❌ Error al obtener usuario:', error.message); res.status(500).json({ error: 'Error al obtener usuario' }); }
    },

    async crear(req, res) {
        const { id_empresa: adminEmpresa, rol: adminRol, id_usuario: adminId } = req.usuario;
        const { username, email, password, nombre, rol, id_empresa } = req.body;
        if (!username || !password || !rol) return res.status(400).json({ error: 'Username, password y rol son requeridos' });

        let empresaUsuario = adminRol !== 'admin' ? adminEmpresa : id_empresa;

        try {
            const existeUsername = await pool.query('SELECT id_usuario FROM usuarios WHERE username = $1', [username]);
            if (existeUsername.rows.length > 0) return res.status(400).json({ error: 'El username ya existe' });
            if (email) {
                const existeEmail = await pool.query('SELECT id_usuario FROM usuarios WHERE email = $1', [email]);
                if (existeEmail.rows.length > 0) return res.status(400).json({ error: 'El email ya está registrado' });
            }

            const password_hash = await bcrypt.hash(password, 10);
            let depositoUsuario = req.body.id_deposito || null;
            if (!depositoUsuario && empresaUsuario) {
                const depPrincipal = await pool.query('SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true LIMIT 1', [empresaUsuario]);
                if (depPrincipal.rows.length > 0) depositoUsuario = depPrincipal.rows[0].id_deposito;
            }

            // >>> HELPER <<<
            const usuario = await adminHelper.crearUsuario(pool, { username, email, password_hash, nombre, rol, id_empresa: empresaUsuario, id_deposito: depositoUsuario });
            await adminHelper.registrarLog(pool, { id_empresa: req.usuario.id_empresa, id_usuario: adminId, accion: 'CREAR_USUARIO', detalle: `Creó usuario: ${username} (rol: ${rol})`, ip_origen: req.ip });

            res.status(201).json({ message: 'Usuario creado exitosamente', usuario });
        } catch (error) { console.error('❌ Error al crear usuario:', error.message); res.status(500).json({ error: 'Error al crear usuario' }); }
    },

    async actualizar(req, res) {
        const { id } = req.params;
        const { id_empresa: adminEmpresa, rol: adminRol, id_usuario: adminId } = req.usuario;
        const { username, email, nombre, rol, estado, id_empresa, id_deposito } = req.body;
        try {
            let queryCheck = 'SELECT * FROM usuarios WHERE id_usuario = $1'; const paramsCheck = [id];
            if (adminRol !== 'admin') { queryCheck += ' AND id_empresa = $2'; paramsCheck.push(adminEmpresa); }
            const usuarioExiste = await pool.query(queryCheck, paramsCheck);
            if (usuarioExiste.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
            const usuarioAnterior = usuarioExiste.rows[0];

            if (username && username !== usuarioAnterior.username) {
                const existe = await pool.query('SELECT id_usuario FROM usuarios WHERE username = $1 AND id_usuario != $2', [username, id]);
                if (existe.rows.length > 0) return res.status(400).json({ error: 'El username ya existe' });
            }
            if (email && email !== usuarioAnterior.email) {
                const existe = await pool.query('SELECT id_usuario FROM usuarios WHERE email = $1 AND id_usuario != $2', [email, id]);
                if (existe.rows.length > 0) return res.status(400).json({ error: 'El email ya está registrado' });
            }

            let empresaFinal = usuarioAnterior.id_empresa;
            if (adminRol === 'admin' && id_empresa) empresaFinal = id_empresa;
            const depositoFinal = id_deposito !== undefined ? (id_deposito || null) : usuarioAnterior.id_deposito;

            // >>> HELPER <<<
            const usuario = await adminHelper.actualizarUsuario(pool, { id_usuario: parseInt(id), username, email, nombre, rol, estado, id_empresa: empresaFinal, id_deposito: depositoFinal });

            const cambios = [];
            if (username !== usuarioAnterior.username) cambios.push(`username: ${usuarioAnterior.username} → ${username}`);
            if (rol !== usuarioAnterior.rol) cambios.push(`rol: ${usuarioAnterior.rol} → ${rol}`);
            if (estado !== usuarioAnterior.estado) cambios.push(`estado: ${usuarioAnterior.estado} → ${estado}`);
            if (String(depositoFinal) !== String(usuarioAnterior.id_deposito)) cambios.push(`deposito: ${usuarioAnterior.id_deposito} → ${depositoFinal}`);
            await adminHelper.registrarLog(pool, { id_empresa: req.usuario.id_empresa, id_usuario: adminId, accion: 'EDITAR_USUARIO', detalle: `Editó usuario ${usuarioAnterior.username}: ${cambios.join(', ') || 'sin cambios significativos'}`, ip_origen: req.ip });

            res.json({ message: 'Usuario actualizado exitosamente', usuario });
        } catch (error) { console.error('❌ Error al actualizar usuario:', error.message); res.status(500).json({ error: 'Error al actualizar usuario' }); }
    },

    async desactivar(req, res) {
        const { id } = req.params;
        const { id_empresa: adminEmpresa, rol: adminRol, id_usuario: adminId } = req.usuario;
        try {
            let queryCheck = 'SELECT * FROM usuarios WHERE id_usuario = $1'; const paramsCheck = [id];
            if (adminRol !== 'admin') { queryCheck += ' AND id_empresa = $2'; paramsCheck.push(adminEmpresa); }
            const usuario = await pool.query(queryCheck, paramsCheck);
            if (usuario.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
            if (parseInt(id) === adminId) return res.status(400).json({ error: 'No podés desactivar tu propio usuario' });

            // >>> HELPER <<<
            await adminHelper.desactivarUsuario(pool, { id_usuario: parseInt(id) });
            await adminHelper.registrarLog(pool, { id_empresa: req.usuario.id_empresa, id_usuario: adminId, accion: 'DESACTIVAR_USUARIO', detalle: `Desactivó usuario: ${usuario.rows[0].username}`, ip_origen: req.ip });

            res.json({ message: 'Usuario desactivado exitosamente' });
        } catch (error) { console.error('❌ Error al desactivar usuario:', error.message); res.status(500).json({ error: 'Error al desactivar usuario' }); }
    },

    async resetPassword(req, res) {
        const { id } = req.params;
        const { id_empresa: adminEmpresa, rol: adminRol, id_usuario: adminId } = req.usuario;
        const { nueva_password } = req.body;
        if (!nueva_password || nueva_password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
        try {
            let queryCheck = 'SELECT * FROM usuarios WHERE id_usuario = $1'; const paramsCheck = [id];
            if (adminRol !== 'admin') { queryCheck += ' AND id_empresa = $2'; paramsCheck.push(adminEmpresa); }
            const usuario = await pool.query(queryCheck, paramsCheck);
            if (usuario.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

            const password_hash = await bcrypt.hash(nueva_password, 10);

            // >>> HELPER <<<
            await adminHelper.resetPassword(pool, { id_usuario: parseInt(id), password_hash });
            await adminHelper.registrarLog(pool, { id_empresa: req.usuario.id_empresa, id_usuario: adminId, accion: 'RESET_PASSWORD', detalle: `Reseteó contraseña de: ${usuario.rows[0].username}`, ip_origen: req.ip });

            res.json({ message: 'Contraseña actualizada exitosamente' });
        } catch (error) { console.error('❌ Error al resetear password:', error.message); res.status(500).json({ error: 'Error al resetear contraseña' }); }
    },

    async listarRoles(req, res) {
        try { const { rows } = await pool.query('SELECT DISTINCT rol FROM (SELECT rol FROM usuarios WHERE id_empresa = $1 UNION SELECT rol FROM rol_modulos WHERE id_empresa = $1) t ORDER BY rol', [req.usuario.id_empresa]); res.json(rows.map(r => r.rol)); }
        catch (error) { res.status(500).json({ error: 'Error al listar roles' }); }
    },

    async listarPermisosPorRol(req, res) {
        const { rol } = req.params;
        try { const { rows } = await pool.query('SELECT id_permiso, rol, permiso, descripcion, activo FROM permisos_usuario WHERE rol = $1 AND id_empresa = $2 ORDER BY permiso', [rol, req.usuario.id_empresa]); res.json(rows); }
        catch (error) { res.status(500).json({ error: 'Error al listar permisos' }); }
    },

    async togglePermiso(req, res) {
        const { rol, permiso } = req.params; const { activo } = req.body; const { id_usuario: adminId } = req.usuario;
        try {
            // >>> HELPER <<<
            await adminHelper.togglePermiso(pool, { id_empresa: req.usuario.id_empresa, rol, permiso, activo });
            await adminHelper.registrarLog(pool, { id_empresa: req.usuario.id_empresa, id_usuario: adminId, accion: 'CAMBIAR_PERMISO', detalle: `${activo ? 'Activó' : 'Desactivó'} permiso "${permiso}" para rol "${rol}"`, ip_origen: req.ip });
            res.json({ message: `Permiso ${activo ? 'activado' : 'desactivado'} para ${rol}` });
        } catch (error) { res.status(500).json({ error: 'Error al actualizar permiso' }); }
    },

    async logsUsuario(req, res) {
        const { id } = req.params; const { limite = 50 } = req.query;
        try {
            const { rows } = await pool.query(`SELECT l.id_log, l.accion, l.detalle, l.ip_origen, l.dispositivo, l.fecha_evento, u.username FROM usuarios_logs l LEFT JOIN usuarios u ON l.id_usuario = u.id_usuario WHERE l.id_usuario = $1 ORDER BY l.fecha_evento DESC LIMIT $2`, [id, parseInt(limite)]);
            res.json(rows);
        } catch (error) { res.status(500).json({ error: 'Error al obtener logs' }); }
    },

    async logsGenerales(req, res) {
        const { id_empresa, rol } = req.usuario; const { limite = 100, accion } = req.query;
        try {
            let query = `SELECT l.id_log, l.accion, l.detalle, l.ip_origen, l.dispositivo, l.fecha_evento, u.username, u.id_empresa FROM usuarios_logs l LEFT JOIN usuarios u ON l.id_usuario = u.id_usuario`;
            const params = []; const conditions = [];
            if (rol !== 'admin') { conditions.push(`u.id_empresa = $${params.length + 1}`); params.push(id_empresa); }
            if (accion) { conditions.push(`l.accion = $${params.length + 1}`); params.push(accion); }
            if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
            query += ` ORDER BY l.fecha_evento DESC LIMIT $${params.length + 1}`; params.push(parseInt(limite));
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (error) { res.status(500).json({ error: 'Error al obtener logs' }); }
    },

    async listarEmpresas(req, res) {
        const { rol, id_empresa } = req.usuario;
        try {
            let query = 'SELECT id_empresa, razon_social, nombre_fantasia, cuit, activa FROM empresas';
            const params = [];
            if (rol !== 'admin') { query += ' WHERE id_empresa = $1'; params.push(id_empresa); } else { query += ' WHERE activa = TRUE'; }
            query += ' ORDER BY razon_social';
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (error) { res.status(500).json({ error: 'Error al listar empresas' }); }
    },

    async formData(req, res) {
        const { rol, id_empresa } = req.usuario;
        try {
            const rolesResult = await pool.query('SELECT DISTINCT rol FROM (SELECT rol FROM usuarios WHERE id_empresa = $1 UNION SELECT rol FROM rol_modulos WHERE id_empresa = $1) t ORDER BY rol', [id_empresa]);
            let empresasQuery = 'SELECT id_empresa, razon_social, nombre_fantasia FROM empresas WHERE activa = TRUE'; const empresasParams = [];
            if (rol !== 'admin') { empresasQuery = 'SELECT id_empresa, razon_social, nombre_fantasia FROM empresas WHERE id_empresa = $1'; empresasParams.push(id_empresa); }
            const empresasResult = await pool.query(empresasQuery, empresasParams);
            const permisosResult = await pool.query('SELECT DISTINCT permiso FROM permisos_usuario WHERE id_empresa = $1 ORDER BY permiso', [id_empresa]);
            res.json({ roles: rolesResult.rows.map(r => r.rol), empresas: empresasResult.rows, permisos: permisosResult.rows.map(p => p.permiso), estados: ['activo', 'inactivo', 'suspendido'] });
        } catch (error) { res.status(500).json({ error: 'Error al obtener datos del formulario' }); }
    }
};

module.exports = usuariosController;
