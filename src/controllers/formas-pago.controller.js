const pool = require('../config/database');

exports.listar = async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        const query = `SELECT * FROM formas_pago WHERE id_empresa = $1 AND activo = TRUE ORDER BY nombre`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener formas de pago:', error.message);
        res.status(500).json({ error: 'Error al obtener formas de pago' });
    }
};

/**
 * GET /api/formas-pago/activos
 * Devuelve solo metodos activos con clave_frontend (los que el cajero usa).
 * NO expone config_integracion (puede tener credenciales).
 *
 * Frontend lo usa para:
 *  - Mapear data-forma del HTML a id_metodo_pago de la BD
 *  - Pintar colores/iconos de los botones consistentes con BD
 *  - (Futuro) renderizar los botones dinamicamente desde esta lista
 */
exports.obtenerActivos = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const { rows } = await pool.query(
            `SELECT id_metodo_pago, nombre, clave_frontend, icono, color_clase,
                    orden, shortcut_tecla, requiere_terminal, requiere_cuotas,
                    tipo_integracion
             FROM metodosdepago
             WHERE id_empresa = $1 AND activo = true AND clave_frontend IS NOT NULL
             ORDER BY orden, id_metodo_pago`,
            [id_empresa]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error obtenerActivos formas-pago:', error);
        res.status(500).json({ error: 'Error al obtener metodos de pago activos' });
    }
};
