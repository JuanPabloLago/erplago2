const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const pool = require('../config/database');

// GET /api/tarjetas - Listar tarjetas
router.get('/', verificarToken, async (req, res) => {
    try {
        const id_empresa = req.usuario.id_empresa;
        
        const result = await pool.query(`
            SELECT id_tarjeta, nombre, tipo, 
                   COALESCE(interes_1_cuota, 0) as interes_1_cuota,
                   COALESCE(interes_3_cuotas, 0) as interes_3_cuotas,
                   COALESCE(interes_6_cuotas, 0) as interes_6_cuotas,
                   COALESCE(interes_12_cuotas, 0) as interes_12_cuotas,
                   activo
            FROM tarjetas 
            WHERE id_empresa = $1 AND activo = true
            ORDER BY nombre
        `, [id_empresa]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error al listar tarjetas:', error);
        res.status(500).json({ error: 'Error al obtener tarjetas' });
    }
});

module.exports = router;
