/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH HELPER — ERP LAGO (staff)
 * Primitivas JWT para autenticacion de staff (empleados internos).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alcance: solo staff (usuarios del ERP). Clientes web usan auth-web.helper.js
 * con secret y ciclo de vida totalmente separados.
 *
 * Principio: helper PURO, sin dependencias de Express. Recibe primitivas
 * (strings, objects), devuelve primitivas. Los middlewares orquestan req/res.
 *
 * Fuente UNICA del secret: process.env.JWT_SECRET (cargado desde .env).
 *   - Si falta en runtime → throw fatal (NO arrancar con fallback hardcoded).
 *   - Si tiene menos de 32 chars → throw fatal (token debil).
 *   - Eliminados los fallbacks 'tu_clave_secreta_aqui' y 'tu_secreto_jwt'.
 *
 * Consumidores (post sub-sprint 2A):
 *   - src/middleware/auth.middleware.js        (verificarToken de staff)
 *   - src/middleware/html-access.middleware.js (gate de HTML por cookie)
 *   - src/controllers/auth.controller.js       (login: firma tokens)
 */

const jwt = require('jsonwebtoken');

const MIN_SECRET_LENGTH = 32;
const COOKIE_NAME_STAFF = 'erp_token';

/**
 * Devuelve el JWT secret del sistema (staff).
 * Lee process.env.JWT_SECRET en cada llamada (no cachea) para permitir
 * rotacion con reinicio limpio de PM2.
 *
 * @throws Error si JWT_SECRET no existe o es demasiado corto
 * @returns {string}
 */
function obtenerJWTSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error(
            'JWT_SECRET no definido en entorno. Configurar en .env antes de arrancar.'
        );
    }
    if (secret.length < MIN_SECRET_LENGTH) {
        throw new Error(
            `JWT_SECRET demasiado corto (${secret.length} chars). Minimo ${MIN_SECRET_LENGTH}.`
        );
    }
    return secret;
}

/**
 * Verifica un JWT y devuelve el payload decodificado.
 *
 * @param   {string} token
 * @returns {object} payload (id_usuario, id_empresa, rol, ...)
 * @throws  jwt.JsonWebTokenError | jwt.TokenExpiredError | Error
 */
function verificarJWT(token) {
    if (!token || typeof token !== 'string') {
        const err = new Error('Token vacio o no es string');
        err.name = 'JsonWebTokenError';
        throw err;
    }
    return jwt.verify(token, obtenerJWTSecret());
}

/**
 * Firma un JWT con el secret del sistema.
 *
 * @param   {object} payload    claims del token
 * @param   {object} [options]  opciones de jsonwebtoken (expiresIn, etc.)
 * @returns {string} token firmado
 */
function firmarJWT(payload, options = {}) {
    if (!payload || typeof payload !== 'object') {
        throw new Error('Payload debe ser un objeto');
    }
    return jwt.sign(payload, obtenerJWTSecret(), options);
}

/**
 * Extrae el token JWT de una request Express, probando 3 fuentes en orden:
 *   1. Header Authorization: Bearer <token>
 *   2. Query param ?token=<token>
 *   3. Cookie erp_token
 *
 * @param   {import('express').Request} req
 * @returns {string|null}
 */
function extraerToken(req) {
    // 1. Header Authorization
    const bearerHeader = req.headers && req.headers['authorization'];
    if (bearerHeader) {
        const parts = bearerHeader.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
            return parts[1];
        }
    }
    // 2. Query param
    if (req.query && req.query.token) {
        return req.query.token;
    }
    // 3. Cookie httpOnly
    if (req.cookies && req.cookies[COOKIE_NAME_STAFF]) {
        return req.cookies[COOKIE_NAME_STAFF];
    }
    return null;
}

module.exports = {
    obtenerJWTSecret,
    verificarJWT,
    firmarJWT,
    extraerToken,
    // Exportada para uso en middleware de cookies httpOnly
    COOKIE_NAME_STAFF
};
