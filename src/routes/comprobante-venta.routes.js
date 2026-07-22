const express = require('express');
const router = express.Router();
const comprobanteController = require('../controllers/comprobante-venta.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// GET - Obtener datos del comprobante (JSON)
router.get('/:id/datos', verificarToken, comprobanteController.obtenerDatosComprobante);

// GET - Generar HTML del comprobante
router.get('/:id/html', verificarToken, comprobanteController.generarHTML);

module.exports = router;
