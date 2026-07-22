/**
 * COBRANZAS ROUTES - ERP LAGO
 * Cuenta corriente de clientes
 *
 * GET /cuenta-corriente/:id_cliente              → Resumen
 * GET /cuenta-corriente/:id_cliente/movimientos   → Libro CC con filtros
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/cobranzas.controller');

router.get('/cuenta-corriente/:id_cliente', verificarToken, controller.getCuentaCorriente);
router.get('/cuenta-corriente/:id_cliente/movimientos', verificarToken, controller.getMovimientosCC);

module.exports = router;
