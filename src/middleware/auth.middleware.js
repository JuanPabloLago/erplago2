/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH MIDDLEWARE — ERP LAGO (staff)
 * Orquesta req/res para autenticacion de staff. Delega firma/verificacion
 * al helper src/utils/auth.helper.js (fuente unica de JWT).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const { extraerToken, verificarJWT } = require('../utils/auth.helper');

/**
 * Verifica que la request traiga un JWT valido (header, query o cookie).
 * Si OK, puebla req.usuario con el payload decodificado.
 * Si no, responde 401 (sin token) o 403 (invalido/expirado).
 */
const verificarToken = (req, res, next) => {
    const token = extraerToken(req);

    if (!token) {
        return res.status(401).json({ error: 'Token no proporcionado' });
    }

    try {
        req.usuario = verificarJWT(token);
        return next();
    } catch (err) {
        console.error('Token invalido:', err.message);
        return res.status(403).json({ error: 'Token invalido o expirado' });
    }
};

/**
 * Requiere que el usuario autenticado sea admin.
 * Debe usarse DESPUES de verificarToken en la cadena.
 */
const verificarAdmin = (req, res, next) => {
    if (!req.usuario) {
        return res.status(401).json({ error: 'No autenticado' });
    }
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }
    next();
};

/**
 * Factory: genera middleware que exige que el rol este en la lista permitida.
 * Debe usarse DESPUES de verificarToken en la cadena.
 */
const verificarRol = (rolesPermitidos) => {
    return (req, res, next) => {
        if (!req.usuario) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        const { rol } = req.usuario;
        if (!rolesPermitidos.includes(rol)) {
            return res.status(403).json({ error: 'No tenes permisos para acceder a este recurso' });
        }
        next();
    };
};

module.exports = { verificarToken, verificarAdmin, verificarRol };
