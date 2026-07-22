/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH-WEB CONTROLLER — ERP LAGO
 * Endpoints publicos de autenticacion de clientes web
 * ═══════════════════════════════════════════════════════════════════════════
 * Toda la logica vive en auth-web.helper.js. Este controller solo:
 *   - Abre/cierra transacciones
 *   - Mapea HTTP <-> helper
 *   - Setea/limpia cookies
 *   - Devuelve mensajes claros
 *
 * Rutas:
 *   POST /api/web/auth/registro
 *   POST /api/web/auth/login
 *   POST /api/web/auth/logout
 *   GET  /api/web/auth/me
 *   POST /api/web/auth/recupero
 *   POST /api/web/auth/reset/:token
 *   POST /api/web/auth/cambiar-password
 */

const pool    = require('../config/database');
const cfg     = require('../utils/config.helper');
const authWeb = require('../utils/auth-web.helper');
const carrito = require('../utils/carrito-web.helper');

// ─────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function _setCookieToken(res, client, id_empresa, token) {
    const cookieName = await cfg.get(client, id_empresa, 'web.cookie_name', 'lago_web_token');
    const dias       = await cfg.get(client, id_empresa, 'web.jwt_dias_validez', 30);
    const secure     = await cfg.get(client, id_empresa, 'web.cookie_secure', true);
    res.cookie(cookieName, token, {
        httpOnly: true,
        secure:   !!secure,
        sameSite: 'lax',
        maxAge:   parseInt(dias, 10) * 24 * 60 * 60 * 1000,
        path:     '/'
    });
}

async function _clearCookieToken(res, id_empresa) {
    const cookieName = await cfg.get(pool, id_empresa, 'web.cookie_name', 'lago_web_token');
    res.clearCookie(cookieName, { path: '/' });
}

function _ip(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.connection?.remoteAddress
        || req.ip
        || null;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /registro
// ─────────────────────────────────────────────────────────────────────────

exports.registro = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const { usuario_web, password, razon_social, email, telefono,
            cuit_cuil, domicilio, localidad, provincia } = req.body || {};

    if (!usuario_web || !password || !razon_social) {
        return res.status(400).json({ error: 'Usuario, contraseña y nombre son obligatorios' });
    }

    const permitido = await cfg.get(pool, id_empresa, 'web.permitir_auto_registro', true);
    if (!permitido) {
        return res.status(403).json({ error: 'El registro publico esta deshabilitado' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cliente = await authWeb.registrarCliente(client, id_empresa, {
            usuario_web, password, razon_social, email, telefono,
            cuit_cuil, domicilio, localidad, provincia
        });
        await client.query('COMMIT');

        const requiereAprob = await cfg.get(pool, id_empresa, 'web.auto_registro_requiere_aprobacion', true);
        return res.status(201).json({
            ok: true,
            id_cliente: cliente.id_cliente,
            mensaje: requiereAprob
                ? 'Cuenta creada. Esta pendiente de aprobacion del administrador.'
                : 'Cuenta creada. Ya podes ingresar.',
            requiere_aprobacion: requiereAprob
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('registro:', err);
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /login
// ─────────────────────────────────────────────────────────────────────────

exports.login = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const { usuario_web, password } = req.body || {};
    if (!usuario_web || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const ip = _ip(req);
    const ua = req.headers['user-agent'] || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { cliente, token } = await authWeb.autenticar(client, id_empresa, {
            usuario_web, password, ip, user_agent: ua
        });

        // Fusion del carrito anonimo (si tenia) con el del cliente
        const sessionAnon = req.session_token_anonimo || null;
        if (sessionAnon) {
            try {
                await carrito.fusionarAnonimoConCliente(client, id_empresa, sessionAnon, cliente.id_cliente);
            } catch (e) {
                console.warn('Fusion de carrito fallo (no bloqueante):', e.message);
            }
        }

        await client.query('COMMIT');
        await _setCookieToken(res, pool, id_empresa, token);

        return res.json({
            ok: true,
            cliente: {
                id_cliente:  cliente.id_cliente,
                usuario_web: cliente.usuario_web,
                razon_social: cliente.razon_social,
                email:       cliente.email,
                id_lista_precio: cliente.id_lista_precio
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(401).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /logout
// ─────────────────────────────────────────────────────────────────────────

exports.logout = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    await _clearCookieToken(res, id_empresa);
    return res.json({ ok: true });
};

// ─────────────────────────────────────────────────────────────────────────
// GET /me
// ─────────────────────────────────────────────────────────────────────────

exports.me = async (req, res) => {
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const c = req.cliente_web;
    return res.json({
        id_cliente:      c.id_cliente,
        usuario_web:     c.usuario_web,
        razon_social:    c.razon_social,
        email:           c.email,
        telefono:        c.telefono,
        id_lista_precio: c.id_lista_precio,
        domicilio:       c.domicilio,
        localidad:       c.localidad,
        provincia:       c.provincia,
        ultimo_login:    c.ultimo_login_web
    });
};

// ─────────────────────────────────────────────────────────────────────────
// POST /recupero  (solicita reset de password)
// ─────────────────────────────────────────────────────────────────────────

exports.solicitarRecupero = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const { usuario_web } = req.body || {};
    if (!usuario_web) return res.status(400).json({ error: 'Usuario requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await authWeb.generarTokenRecupero(client, id_empresa, usuario_web);
        await client.query('COMMIT');

        // Respuesta indistinguible: no revelamos si el usuario existe.
        // TODO: conectar a email/whatsapp cuando haya servicio de notificaciones.
        // El token queda en BD (clientes.token_recupero) con vencimiento 1h.
        // Por ahora el admin puede consultarlo via SQL si hace falta recuperacion manual.
        // NO loguear en consola por seguridad (los logs pueden filtrarse).
        return res.json({ ok: true, mensaje: 'Si el usuario existe, recibira instrucciones para recuperar su contraseña.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('solicitarRecupero:', err);
        return res.status(500).json({ error: 'Error procesando recupero' });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /reset/:token  (consume el token y setea password nuevo)
// ─────────────────────────────────────────────────────────────────────────

exports.resetPassword = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const { token } = req.params;
    const { password } = req.body || {};
    if (!token || !password) return res.status(400).json({ error: 'Token y contraseña requeridos' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await authWeb.consumirTokenRecupero(client, id_empresa, token, password);
        await client.query('COMMIT');
        return res.json({ ok: true, mensaje: 'Contraseña actualizada' });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// POST /cambiar-password  (logueado)
// ─────────────────────────────────────────────────────────────────────────

exports.cambiarPassword = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    if (!req.cliente_web) return res.status(401).json({ error: 'No autenticado' });
    const { password_actual, password_nuevo } = req.body || {};
    if (!password_actual || !password_nuevo) {
        return res.status(400).json({ error: 'Contraseña actual y nueva requeridas' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await authWeb.cambiarPassword(client, id_empresa, req.cliente_web.id_cliente, password_actual, password_nuevo);
        await client.query('COMMIT');
        return res.json({ ok: true, mensaje: 'Contraseña actualizada' });
    } catch (err) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
};
