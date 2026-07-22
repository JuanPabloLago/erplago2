/**
 * modulo-access.middleware.js - Middleware de Control de Acceso a Módulos
 * Ubicación: /root/mi_erp/src/middleware/modulo-access.middleware.js
 *
 * v2: esRutaSoporte ahora es async (lee de BD)
 */

const modulosHelper = require('../utils/modulos.helper');

const METODOS_ESCRITURA = ['POST', 'PUT', 'PATCH', 'DELETE'];

async function verificarAccesoModulo(req, res, next) {
    try {
        // Si no hay usuario autenticado, dejar que el auth middleware lo maneje después
        if (!req.usuario) {
            return next();
        }

        const { rol, id_empresa } = req.usuario;
        const rutaCompleta = req.baseUrl + req.path;
        console.log("🔍 ACCESO:", rutaCompleta, "rol:", rol, "empresa:", id_empresa);

        // Verificar acceso (internamente consulta rutas_soporte desde BD)
        const { permitido, solo_lectura } = await modulosHelper.verificarAccesoRuta(id_empresa, rol, rutaCompleta);

        if (!permitido) {
            return res.status(403).json({
                error: 'Sin acceso a este módulo',
                codigo: 'MODULO_NO_PERMITIDO'
            });
        }

        // Si es solo lectura y el método es de escritura → bloquear
        if (solo_lectura && METODOS_ESCRITURA.includes(req.method)) {
            return res.status(403).json({
                error: 'Acceso de solo lectura en este módulo',
                codigo: 'MODULO_SOLO_LECTURA'
            });
        }

        req.moduloAcceso = { solo_lectura };
        next();
    } catch (error) {
        console.error('❌ Error en middleware de acceso a módulos:', error.message);
        // Fail-open para no romper el sistema
        next();
    }
}

module.exports = { verificarAccesoModulo };
