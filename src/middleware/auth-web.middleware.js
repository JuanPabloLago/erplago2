/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH-WEB MIDDLEWARE — ERP LAGO
 * Autenticacion de CLIENTES web (separado del middleware de staff)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - Lee JWT desde cookie configurable (web.cookie_name) o header Authorization.
 * - El secret y la cookie name salen de configuraciones_empresa (web.*).
 * - id_empresa se resuelve de configuraciones_empresa.web.id_empresa
 *   (la web es de UNA empresa por dominio).
 *
 * Exporta TRES middlewares:
 *
 *   verificarClienteWeb         -> obligatorio. 401 si no hay token valido.
 *   clienteWebOpcional          -> si hay token lo carga en req.cliente_web,
 *                                  si no, sigue como anonimo (catalogo publico).
 *   inyectarSessionAnonima      -> garantiza una cookie lago_web_session
 *                                  para identificar el carrito anonimo.
 *
 * En cualquier caso pone en req:
 *   req.id_empresa_web         (number)  siempre
 *   req.cliente_web            (object|null) si esta logueado
 *   req.session_token_anonimo  (string|null) si tiene cookie de sesion
 */

const pool      = require('../config/database');
const cfg       = require('../utils/config.helper');
const authWeb   = require('../utils/auth-web.helper');
const crypto    = require('crypto');

// ─────────────────────────────────────────────────────────────────────────
// Resolucion de id_empresa (cacheada por config.helper.js)
// ─────────────────────────────────────────────────────────────────────────

async function _resolverIdEmpresa(client) {
    // La config web.id_empresa es el "bootstrap": se lee desde empresa=1 porque
    // en esta etapa todavia no sabemos a que empresa pertenece el request.
    // Futuro multi-empresa web: resolver por Host via tabla empresa_dominios.
    const id = await cfg.get(client, 1, 'web.id_empresa', 1);
    return parseInt(id, 10) || 1;
}

// ─────────────────────────────────────────────────────────────────────────
// Extraccion de token JWT
// ─────────────────────────────────────────────────────────────────────────

async function _extraerToken(req, id_empresa) {
    const cookieName = await cfg.get(pool, id_empresa, 'web.cookie_name', 'lago_web_token');

    // 1. Cookie httpOnly
    if (req.cookies && req.cookies[cookieName]) {
        return req.cookies[cookieName];
    }
    // 2. Header Authorization
    const h = req.headers['authorization'];
    if (h && h.startsWith('Bearer ')) {
        return h.substring(7);
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: obligatorio
// ─────────────────────────────────────────────────────────────────────────

async function verificarClienteWeb(req, res, next) {
    try {
        const id_empresa = await _resolverIdEmpresa(pool);
        req.id_empresa_web = id_empresa;

        const token = await _extraerToken(req, id_empresa);
        if (!token) {
            return res.status(401).json({ error: 'No autenticado' });
        }

        const payload = await authWeb.verificarJWT(pool, id_empresa, token);
        if (!payload || payload.tipo !== 'cliente_web') {
            return res.status(401).json({ error: 'Token invalido' });
        }

        // Recargamos el cliente para verificar que sigue activo/aprobado
        const cliente = await authWeb.obtenerClientePorId(pool, id_empresa, payload.id_cliente);
        if (!cliente || !cliente.web_activo || !cliente.web_aprobado) {
            return res.status(401).json({ error: 'Cuenta inhabilitada' });
        }

        req.cliente_web = cliente;
        next();
    } catch (err) {
        console.error('verificarClienteWeb:', err);
        return res.status(500).json({ error: 'Error de autenticacion' });
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: opcional (catalogo publico)
// ─────────────────────────────────────────────────────────────────────────

async function clienteWebOpcional(req, res, next) {
    try {
        const id_empresa = await _resolverIdEmpresa(pool);
        req.id_empresa_web = id_empresa;
        req.cliente_web = null;

        const token = await _extraerToken(req, id_empresa);
        if (!token) return next();

        const payload = await authWeb.verificarJWT(pool, id_empresa, token);
        if (!payload || payload.tipo !== 'cliente_web') return next();

        const cliente = await authWeb.obtenerClientePorId(pool, id_empresa, payload.id_cliente);
        if (cliente && cliente.web_activo && cliente.web_aprobado) {
            req.cliente_web = cliente;
        }
        next();
    } catch (err) {
        console.error('clienteWebOpcional:', err);
        next(); // no bloquea, sigue como anonimo
    }
}

// ─────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: inyecta cookie de sesion anonima para el carrito
// ─────────────────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'lago_web_session';

async function inyectarSessionAnonima(req, res, next) {
    try {
        let token = req.cookies && req.cookies[SESSION_COOKIE];
        if (!token) {
            token = crypto.randomBytes(32).toString('hex');
            const dias = await cfg.get(pool, req.id_empresa_web || 1, 'web.carrito_dias_expiracion', 30);
            const secure = await cfg.get(pool, req.id_empresa_web || 1, 'web.cookie_secure', true);
            res.cookie(SESSION_COOKIE, token, {
                httpOnly: true,
                secure:   !!secure,
                sameSite: 'lax',
                maxAge:   parseInt(dias, 10) * 24 * 60 * 60 * 1000,
                path:     '/'
            });
        }
        req.session_token_anonimo = token;
        next();
    } catch (err) {
        console.error('inyectarSessionAnonima:', err);
        next();
    }
}

module.exports = {
    verificarClienteWeb,
    clienteWebOpcional,
    inyectarSessionAnonima,
    SESSION_COOKIE
};
