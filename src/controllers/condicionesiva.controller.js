const pool = require('../config/database');

exports.listar = async (req, res) => {
    try {
        const query = 'SELECT * FROM condicionesiva ORDER BY nombre';
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener condiciones IVA:', error.message);
        res.status(500).json({ error: 'Error al obtener condiciones IVA' });
    }
};
