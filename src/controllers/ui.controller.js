/**
 * ui.controller.js
 * Controller delgado. Toda la lógica vive en navegacion.helper.js.
 */
const navegacionHelper = require('../utils/navegacion.helper');

async function getNavegacion(req, res) {
    try {
        if (!req.usuario) {
            return res.status(401).json({ success: false, error: 'No autenticado' });
        }
        const { id_empresa, rol, nombre, id_usuario, id_deposito } = req.usuario;
        const paginaActual = req.query.pagina || null;

        const arbol = await navegacionHelper.obtenerArbolNavegacion({
            id_empresa, rol, paginaActual, id_usuario, nombre, id_deposito
        });

        res.json({ success: true, data: arbol });
    } catch (err) {
        console.error('[ui.controller.getNavegacion]', err);
        res.status(500).json({ success: false, error: err.message });
    }
}

module.exports = { getNavegacion };
