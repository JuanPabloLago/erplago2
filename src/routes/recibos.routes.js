/**
 * RECIBOS ROUTES - ERP LAGO
 * Rutas para gestión de recibos de cobro
 */

const express = require('express');
const router = express.Router();
const recibosController = require('../controllers/recibos.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// ============================================================
// CRUD DE RECIBOS
// ============================================================

// Crear recibo
router.post('/', verificarToken, recibosController.crear);

// Listar recibos (con filtros)
router.get('/', verificarToken, recibosController.listar);

// Resumen de cobranzas (para dashboard)
router.get('/resumen', verificarToken, recibosController.resumenCobranzas);

// Obtener recibo por ID
router.get('/:id', verificarToken, recibosController.obtenerPorId);

// Recibos de un cliente específico
router.get('/cliente/:id_cliente', verificarToken, recibosController.recibosCliente);

// Anular recibo
router.delete('/:id', verificarToken, recibosController.anular);

module.exports = router;
