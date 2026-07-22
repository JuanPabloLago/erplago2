const express = require('express');
const router = express.Router();
const controller = require('../controllers/movimientos-stock.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// Datos para filtros del frontend
router.get('/form-data', controller.formData);

// Tipos de movimiento disponibles
router.get('/tipos', controller.tipos);

// Exportar a Excel
router.get('/exportar', controller.exportar);

// Consultar movimientos (con filtros y paginacion)
router.get('/', controller.consultar);

module.exports = router;
