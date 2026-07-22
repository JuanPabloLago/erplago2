const pool = require('../config/database');

exports.listar = async (req, res) => {
    try {
        const query = `SELECT * FROM monedas WHERE activo = TRUE ORDER BY codigo`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener monedas:', error.message);
        res.status(500).json({ error: 'Error al obtener monedas' });
    }
};
