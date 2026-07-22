'use strict';

/**
 * remitos.routes.js - Rutas para consulta de Remitos
 * 
 * Registrar en src/routes/index.js:
 *   const remitosRoutes = require('./remitos.routes');
 *   router.use('/remitos', remitosRoutes);
 * 
 * NOTA: La creación de remitos se maneja en despachos.routes.js
 */

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const remitosController = require('../controllers/remitos.controller');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// GET /api/remitos/form-data - Datos para filtros (ANTES de /:id)
router.get('/form-data', remitosController.formData);

// GET /api/remitos/exportar - Exportar listado
router.get('/exportar', remitosController.exportar);

// GET /api/remitos - Listar con filtros
router.get('/', remitosController.listar);

// GET /api/remitos/:id - Obtener por ID con items
router.get('/:id', remitosController.obtenerPorId);

module.exports = router;
