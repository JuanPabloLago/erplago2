/**
 * COBRANZAS ROUTES - ERP LAGO
 * Rutas de cuenta corriente de clientes
 *
 * ACTUALIZADO: 2026-02-16
 * - GET /cuenta-corriente/:id_cliente          → Resumen (facturas/recibos)
 * - GET /cuenta-corriente/:id_cliente/movimientos → Libro CC (tabla cuentacorrienteclientes)
 */

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/cobranzas.controller');

// Resumen CC (calculado desde facturas/recibos)
router.get('/cuenta-corriente/:id_cliente', verificarToken, controller.getCuentaCorriente);

// Libro de movimientos CC (desde tabla cuentacorrienteclientes)
router.get('/cuenta-corriente/:id_cliente/movimientos', verificarToken, controller.getMovimientosCC);

module.exports = router;
