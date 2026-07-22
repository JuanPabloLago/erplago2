const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const adminHelper = require('../utils/admin.helper');
const modulosHelper = require('../utils/modulos.helper');
const seguridadDisp = require('../utils/seguridad-dispositivos.helper');
const { firmarJWT } = require('../utils/auth.helper');

const hashData = (data) => crypto.createHash('sha256').update(data).digest('hex');

exports.login = async (req, res) => {
    const { username, password, fingerprint } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    try {
        const { rows } = await pool.query(
            'SELECT id_usuario, id_empresa, id_deposito, nombre, username, password_hash, rol, estado FROM usuarios WHERE username = $1',
            [username]
        );
        if (rows.length === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

        const user = rows[0];
        if (user.estado !== 'activo') return res.status(401).json({ error: 'Usuario inactivo' });

        const passwordValida = await bcrypt.compare(password, user.password_hash);
        if (!passwordValida) return res.status(401).json({ error: 'Credenciales inválidas' });

        const configResult = await pool.query(
            "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'requiere_validacion_dispositivo'",
            [user.id_empresa]
        );
        const requiereValidacion = configResult.rows[0]?.valor === 'true';
        const esAdmin = user.rol === 'admin' || user.rol === 'administrador';

        // ─── Admin: TRAZA sin bloquear (anti-lockout intacto) ───
        // Si la empresa activó terminal.registrar_dispositivo_admin, el dispositivo del admin
        // se auto-registra al loguear (no crea intento, no bloquea). Configurable para vendibilidad.
        if (requiereValidacion && fingerprint && esAdmin) {
            try {
                const cfgAdmin = await pool.query(
                    "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'terminal.registrar_dispositivo_admin'",
                    [user.id_empresa]
                );
                const registrarAdmin = cfgAdmin.rows[0]?.valor === 'true';
                if (registrarAdmin) {
                    const fpHash = hashData(fingerprint);
                    const ipH = hashData(req.ip || req.connection.remoteAddress || 'unknown');
                    const fpDatos = req.body.fingerprintDatos || {};
                    const r = await adminHelper.upsertDispositivoAdmin(pool, {
                        id_empresa: user.id_empresa, id_usuario: user.id_usuario, fingerprint_hash: fpHash,
                        nombre_dispositivo: fpDatos.navegador ? (fpDatos.navegador + ' (admin)') : 'Dispositivo admin',
                        navegador: fpDatos.navegador, sistema_operativo: fpDatos.sistema, ip_hash: ipH
                    });
                    // Solo logueamos cuando el dispositivo es NUEVO (evita ruido en cada login)
                    if (r && r.fue_insert) {
                        await adminHelper.registrarLog(pool, {
                            id_empresa: user.id_empresa, id_usuario: user.id_usuario,
                            accion: 'DISPOSITIVO_ADMIN_AUTOREGISTRADO',
                            detalle: 'Dispositivo de admin auto-registrado en login (no bloqueante)',
                            ip_origen: req.ip || (req.connection && req.connection.remoteAddress) || null
                        });
                    }
                }
            } catch (eAdmin) {
                // Trazar nunca debe impedir el login del admin (anti-lockout absoluto)
                console.error('Auto-registro dispositivo admin falló (no bloqueante):', eAdmin.message);
            }
        }

        if (requiereValidacion && fingerprint && !esAdmin) {
            const fingerprintHash = hashData(fingerprint);
            const ipHash = hashData(req.ip || req.connection.remoteAddress || 'unknown');

            const dispResult = await pool.query(
                'SELECT id_dispositivo, activo FROM dispositivos_autorizados WHERE id_empresa = $1 AND id_usuario = $2 AND fingerprint_hash = $3',
                [user.id_empresa, user.id_usuario, fingerprintHash]
            );

            if (dispResult.rows.length === 0) {
                await adminHelper.registrarIntentoDispositivo(pool, {
                    id_empresa: user.id_empresa, id_usuario: user.id_usuario,
                    fingerprint_hash: fingerprintHash, fingerprint_datos: req.body.fingerprintDatos || {}, ip_hash: ipHash
                });
                return res.status(403).json({ error: 'Dispositivo no autorizado', codigo: 'DISPOSITIVO_NO_AUTORIZADO', mensaje: 'Este dispositivo no está autorizado. Contacte al administrador.' });
            }

            const dispositivo = dispResult.rows[0];
            if (!dispositivo.activo) return res.status(403).json({ error: 'Dispositivo desactivado', codigo: 'DISPOSITIVO_DESACTIVADO', mensaje: 'Este dispositivo ha sido desactivado. Contacte al administrador.' });

            await adminHelper.actualizarAccesoDispositivo(pool, { id_dispositivo: dispositivo.id_dispositivo, ip_hash: ipHash });
        }

        await adminHelper.actualizarUltimoLogin(pool, { id_usuario: user.id_usuario });

        const token = firmarJWT({
            id_usuario: user.id_usuario, id_empresa: user.id_empresa, id_deposito: user.id_deposito || null,
            username: user.username, rol: user.rol, nombre: user.nombre
        }, { expiresIn: '24h' });

        // Setear cookie httpOnly con el JWT (para control de acceso HTML server-side)
        res.cookie('erp_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: false,      // HTTP detrás de WireGuard
            maxAge: 24 * 60 * 60 * 1000, // 24 horas (igual que JWT)
            path: '/'
        });
        res.json({ message: 'Login exitoso', token, usuario: { username: user.username, rol: user.rol, id_empresa: user.id_empresa, nombre: user.nombre } });
    } catch (error) {
        console.error('Error login:', error.message);
        res.status(500).json({ error: 'Error al iniciar sesión' });
    }
};

exports.obtenerPerfil = async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id_usuario, id_empresa, id_deposito, nombre, username, rol FROM usuarios WHERE id_usuario = $1',
            [req.usuario.id_usuario]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const usuario = rows[0];

        // Módulos permitidos para el rol (desde BD)
        const modulos = await modulosHelper.obtenerModulosRol(usuario.id_empresa, usuario.rol);

        // Grupos del menú (desde BD)
        const grupos = await modulosHelper.obtenerGrupos();

        // Favicon desde config empresa
        const faviconResult = await pool.query(
            "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'favicon_url'",
            [usuario.id_empresa]
        );
        const favicon_url = faviconResult.rows.length > 0 ? faviconResult.rows[0].valor : '/favicon.svg';

        res.json({
            ...usuario,
            favicon_url,
            modulos: modulos.map(m => ({
                codigo: m.codigo,
                nombre: m.nombre,
                icono: m.icono,
                url_frontend: m.url_frontend,
                grupo: m.grupo,
                orden: m.orden,
                solo_lectura: m.solo_lectura,
                requiere_turno: m.requiere_turno
            })),
            grupos
        });
    } catch (error) {
        console.error('Error perfil:', error.message);
        res.status(500).json({ error: 'Error al obtener perfil' });
    }
};

exports.obtenerConfiguracionUsuario = async (req, res) => {
    const { id_usuario, id_empresa, rol } = req.usuario;
    try {
        const configResult = await pool.query('SELECT id_lista_precio_predeterminada FROM usuario_configuracion WHERE id_empresa = $1 AND id_usuario = $2', [id_empresa, id_usuario]);
        let config;
        if (configResult.rows.length === 0) {
            await adminHelper.upsertConfigUsuario(pool, { id_empresa, id_usuario, id_lista_precio: 1 });
            config = { id_lista_precio_predeterminada: 1 };
        } else {
            config = configResult.rows[0];
        }

        const permisosResult = await pool.query('SELECT clave, valor FROM configuracion_empresa_extendida WHERE id_empresa = $1 AND rol = $2', [id_empresa, rol]);
        const permisosMap = {};
        permisosResult.rows.forEach(p => { permisosMap[p.clave] = p.valor === 'true' || p.valor === true; });

        const esAdmin = rol === 'admin' || rol === 'administrador';
        const permisos = {
            puede_cambiar_lista_precios: permisosMap.puede_cambiar_lista_precios ?? esAdmin,
            puede_vender_sin_stock: permisosMap.puede_vender_sin_stock ?? esAdmin
        };

        const empresaConfigResult = await pool.query("SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'permitir_stock_negativo'", [id_empresa]);
        const permitirVentaSinStock = empresaConfigResult.rows[0]?.valor === 'true';

        const precioConfigResult = await pool.query("SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'permitir_cambiar_precio_venta'", [id_empresa]);
        const permitirCambiarPrecio = precioConfigResult.rows[0]?.valor === 'true';

        res.json({ id_lista_precio: config.id_lista_precio_predeterminada || 1, permitir_venta_sin_stock: permitirVentaSinStock, permitir_cambiar_precio: permitirCambiarPrecio, rol, permisos });
    } catch (error) {
        console.error('Error obtenerConfiguracionUsuario:', error);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
};

exports.guardarConfiguracionUsuario = async (req, res) => {
    const { id_usuario, id_empresa, rol } = req.usuario;
    const { id_lista_precio, permitir_venta_sin_stock, permitir_cambiar_precio } = req.body;
    try {
        const esAdmin = rol === 'admin' || rol === 'administrador';

        if (id_lista_precio !== undefined) {
            await adminHelper.upsertConfigUsuario(pool, { id_empresa, id_usuario, id_lista_precio });
        }
        if (permitir_venta_sin_stock !== undefined && esAdmin) {
            await adminHelper.upsertConfigEmpresa(pool, { id_empresa, clave: 'permitir_stock_negativo', valor: permitir_venta_sin_stock ? 'true' : 'false' });
        }
        if (permitir_cambiar_precio !== undefined && esAdmin) {
            await adminHelper.upsertConfigEmpresa(pool, { id_empresa, clave: 'permitir_cambiar_precio_venta', valor: permitir_cambiar_precio ? 'true' : 'false' });
        }

        res.json({ success: true, message: 'Configuración guardada' });
    } catch (error) {
        console.error('Error guardarConfiguracionUsuario:', error);
        res.status(500).json({ error: 'Error al guardar configuración' });
    }
};

// ============ GESTIÓN DE DISPOSITIVOS ============

exports.obtenerDispositivos = async (req, res) => {
    const { id_empresa, rol } = req.usuario;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    try {
        const { rows } = await pool.query(`
            SELECT d.id_dispositivo, d.id_usuario, u.username, u.nombre as nombre_usuario, d.nombre_dispositivo, d.navegador, d.sistema_operativo, d.fecha_registro, d.ultimo_acceso, d.activo, a.nombre as autorizado_por_nombre, d.fecha_autorizacion, d.notas
            FROM dispositivos_autorizados d JOIN usuarios u ON d.id_usuario = u.id_usuario LEFT JOIN usuarios a ON d.autorizado_por = a.id_usuario
            WHERE d.id_empresa = $1 ORDER BY d.ultimo_acceso DESC`, [id_empresa]);
        res.json(rows);
    } catch (error) { console.error('Error obtenerDispositivos:', error); res.status(500).json({ error: 'Error al obtener dispositivos' }); }
};


exports.obtenerCoberturaDispositivos = async (req, res) => {
    const { id_empresa, rol } = req.usuario;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    try {
        const cobertura = await seguridadDisp.obtenerCobertura(pool, id_empresa);
        res.json(cobertura);
    } catch (error) {
        console.error('Error obtenerCoberturaDispositivos:', error);
        res.status(500).json({ error: 'Error al obtener cobertura de dispositivos' });
    }
};

exports.obtenerIntentosPendientes = async (req, res) => {
    const { id_empresa, rol } = req.usuario;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    try {
        const { rows } = await pool.query(`
            SELECT i.id_intento, i.id_usuario, u.username, u.nombre as nombre_usuario, i.fingerprint_datos, i.fecha_intento, i.estado
            FROM intentos_dispositivo_nuevo i JOIN usuarios u ON i.id_usuario = u.id_usuario
            WHERE i.id_empresa = $1 AND i.estado = 'pendiente' ORDER BY i.fecha_intento DESC`, [id_empresa]);
        res.json(rows);
    } catch (error) { console.error('Error obtenerIntentosPendientes:', error); res.status(500).json({ error: 'Error al obtener intentos' }); }
};

exports.autorizarDispositivo = async (req, res) => {
    const { id_empresa, id_usuario: adminId, rol } = req.usuario;
    const { id_intento, nombre_dispositivo, notas } = req.body;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });

    const ipOrigen = req.ip || (req.connection && req.connection.remoteAddress) || null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const intentoResult = await client.query(
            'SELECT * FROM intentos_dispositivo_nuevo WHERE id_intento = $1 AND id_empresa = $2 AND estado = $3 FOR UPDATE',
            [id_intento, id_empresa, 'pendiente']
        );
        if (intentoResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Intento no encontrado o ya procesado' });
        }
        const intento = intentoResult.rows[0];
        const fingerprintDatos = intento.fingerprint_datos || {};

        // Política OCP: límite de dispositivos por rol (configuraciones_empresa)
        const veredicto = await seguridadDisp.validarLimiteRol(client, {
            id_empresa, id_usuario: intento.id_usuario, rol
        });
        if (!veredicto.permitido) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: veredicto.mensaje, codigo: 'LIMITE_DISPOSITIVOS_ROL' });
        }

        await adminHelper.autorizarDispositivo(client, {
            id_empresa, id_usuario: intento.id_usuario, fingerprint_hash: intento.fingerprint_hash,
            nombre_dispositivo: nombre_dispositivo || fingerprintDatos.navegador || 'Dispositivo',
            navegador: fingerprintDatos.navegador, sistema_operativo: fingerprintDatos.sistema,
            ip_hash: intento.ip_hash, autorizado_por: adminId, notas
        });
        await adminHelper.procesarIntento(client, { id_intento, estado: 'autorizado', procesado_por: adminId });

        await adminHelper.registrarLog(client, {
            id_empresa, id_usuario: adminId, accion: 'DISPOSITIVO_AUTORIZADO',
            detalle: 'Autorizó dispositivo para usuario ' + intento.id_usuario + ' (intento ' + id_intento + ', fingerprint ' + String(intento.fingerprint_hash).slice(0, 12) + '…)',
            ip_origen: ipOrigen
        });

        await client.query('COMMIT');
        res.json({ success: true, message: 'Dispositivo autorizado' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error autorizarDispositivo:', error);
        res.status(500).json({ error: 'Error al autorizar dispositivo' });
    } finally {
        client.release();
    }
};

exports.rechazarIntento = async (req, res) => {
    const { id_empresa, id_usuario: adminId, rol } = req.usuario;
    const { id_intento } = req.body;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    const ipOrigen = req.ip || (req.connection && req.connection.remoteAddress) || null;
    try {
        const result = await adminHelper.procesarIntento(pool, { id_intento, estado: 'rechazado', procesado_por: adminId });
        if (!result) return res.status(404).json({ error: 'Intento no encontrado o ya procesado' });
        try {
            await adminHelper.registrarLog(pool, {
                id_empresa, id_usuario: adminId, accion: 'INTENTO_RECHAZADO',
                detalle: 'Rechazó intento de dispositivo ' + id_intento + (result.id_usuario ? ' (usuario ' + result.id_usuario + ')' : ''),
                ip_origen: ipOrigen
            });
        } catch (logErr) { console.error('Log INTENTO_RECHAZADO falló (no bloqueante):', logErr.message); }
        res.json({ success: true, message: 'Intento rechazado' });
    } catch (error) { console.error('Error rechazarIntento:', error); res.status(500).json({ error: 'Error al rechazar intento' }); }
};

exports.desactivarDispositivo = async (req, res) => {
    const { id_empresa, id_usuario: adminId, rol } = req.usuario;
    const { id_dispositivo } = req.params;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    const ipOrigen = req.ip || (req.connection && req.connection.remoteAddress) || null;
    try {
        const count = await adminHelper.toggleDispositivo(pool, { id_dispositivo, id_empresa, activo: false });
        if (count === 0) return res.status(404).json({ error: 'Dispositivo no encontrado' });
        try {
            await adminHelper.registrarLog(pool, {
                id_empresa, id_usuario: adminId, accion: 'DISPOSITIVO_DESACTIVADO',
                detalle: 'Desactivó dispositivo ' + id_dispositivo,
                ip_origen: ipOrigen
            });
        } catch (logErr) { console.error('Log DISPOSITIVO_DESACTIVADO falló (no bloqueante):', logErr.message); }
        res.json({ success: true, message: 'Dispositivo desactivado' });
    } catch (error) { console.error('Error desactivarDispositivo:', error); res.status(500).json({ error: 'Error al desactivar dispositivo' }); }
};

exports.reactivarDispositivo = async (req, res) => {
    const { id_empresa, id_usuario: adminId, rol } = req.usuario;
    const { id_dispositivo } = req.params;
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    const ipOrigen = req.ip || (req.connection && req.connection.remoteAddress) || null;
    try {
        const count = await adminHelper.toggleDispositivo(pool, { id_dispositivo, id_empresa, activo: true });
        if (count === 0) return res.status(404).json({ error: 'Dispositivo no encontrado' });
        try {
            await adminHelper.registrarLog(pool, {
                id_empresa, id_usuario: adminId, accion: 'DISPOSITIVO_REACTIVADO',
                detalle: 'Reactivó dispositivo ' + id_dispositivo,
                ip_origen: ipOrigen
            });
        } catch (logErr) { console.error('Log DISPOSITIVO_REACTIVADO falló (no bloqueante):', logErr.message); }
        res.json({ success: true, message: 'Dispositivo reactivado' });
    } catch (error) { console.error('Error reactivarDispositivo:', error); res.status(500).json({ error: 'Error al reactivar dispositivo' }); }
};

exports.eliminarDispositivo = async (req, res) => {
    const { id_empresa, id_usuario: adminId, rol } = req.usuario;
    const { id_dispositivo } = req.params;
    const motivo = (req.body && typeof req.body.motivo === 'string') ? req.body.motivo.trim() : '';
    if (rol !== 'admin' && rol !== 'administrador') return res.status(403).json({ error: 'No autorizado' });
    if (!motivo) return res.status(400).json({ error: 'El motivo de la baja es obligatorio', codigo: 'MOTIVO_REQUERIDO' });
    const ipOrigen = req.ip || (req.connection && req.connection.remoteAddress) || null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const count = await adminHelper.darDeBajaDispositivo(client, { id_dispositivo, id_empresa, baja_por: adminId, motivo });
        if (count === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Dispositivo no encontrado o ya dado de baja' });
        }
        await adminHelper.registrarLog(client, {
            id_empresa, id_usuario: adminId, accion: 'DISPOSITIVO_BAJA',
            detalle: 'Dio de baja dispositivo ' + id_dispositivo + '. Motivo: ' + motivo,
            ip_origen: ipOrigen
        });
        await client.query('COMMIT');
        res.json({ success: true, message: 'Dispositivo dado de baja' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error eliminarDispositivo (baja):', error);
        res.status(500).json({ error: 'Error al dar de baja el dispositivo' });
    } finally {
        client.release();
    }
};


// ═══════════════════════════════════════════════════════════════════════════
// LOGOUT - Limpia la cookie httpOnly
// ═══════════════════════════════════════════════════════════════════════════
exports.logout = async (req, res) => {
    try {
        res.clearCookie('erp_token', { path: '/' });
        res.json({ message: 'Sesión cerrada' });
    } catch (error) {
        console.error('Error logout:', error.message);
        res.status(500).json({ error: 'Error al cerrar sesión' });
    }
};
