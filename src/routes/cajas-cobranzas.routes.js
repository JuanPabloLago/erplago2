/**
 * CAJAS-COBRANZAS ROUTES — ERP LAGO
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/cajas-cobranzas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// CAJAS
router.get('/cajas', verificarToken, ctrl.listarCajas);
router.get('/cajas/lista', verificarToken, ctrl.obtenerCajas);
router.get('/estado', verificarToken, ctrl.obtenerEstado);
router.get('/cajas/:id_caja/turno-actual', verificarToken, ctrl.obtenerTurnoActual);
router.post('/cajas/abrir', verificarToken, ctrl.abrirCaja);
router.post('/cajas/cerrar', verificarToken, ctrl.cerrarCaja);

// HISTORIAL TURNOS
router.get('/cajas/turnos-historial', verificarToken, ctrl.obtenerHistorialTurnos);
router.get('/cajas/turnos/:id_turno/detalle', verificarToken, ctrl.obtenerDetalleTurno);
router.get('/cajas/turnos/:id_turno/desglose', verificarToken, ctrl.obtenerDesgloseTurno);

// COBRANZAS
router.get('/cobranzas/pendientes', verificarToken, ctrl.obtenerPendientes);
router.post('/cobranzas/aplicar-pago', verificarToken, ctrl.aplicarPago);
router.get('/cobranzas/historial', verificarToken, ctrl.obtenerHistorialCobranzas);

// MOVIMIENTOS
router.post('/movimientos', verificarToken, ctrl.crearMovimiento);
router.get('/movimientos/:id_turno', verificarToken, ctrl.listarMovimientos);

module.exports = router;
