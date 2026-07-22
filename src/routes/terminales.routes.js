'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/terminales.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// ═══════════════════════════════════════════════════════════════════════
// TERMINALES.ROUTES.JS — Rutas API para terminales + cuotas
// ERP LAGO — 2026-03-14
// Base: /api/terminales
// ═══════════════════════════════════════════════════════════════════════

// Auth global
router.use(verificarToken);

// --- Terminales ---
router.get('/',             controller.listarTerminales);       // Admin: todas (activas + inactivas)
router.get('/activas',      controller.obtenerActivas);         // Venta-rápida: filtradas por depósito
router.get('/form-data',    controller.formData);               // Selects: bancos + depósitos
router.get('/:id',          controller.obtenerTerminal);
router.post('/',            controller.crearTerminal);
router.put('/:id',          controller.actualizarTerminal);
router.put('/:id/desactivar', controller.desactivarTerminal);

// --- Planes de cuotas (por terminal) ---
router.get('/:id_terminal/planes',          controller.obtenerPlanes);
router.post('/:id_terminal/planes',         controller.crearPlan);
router.put('/:id_terminal/planes/masivo',   controller.actualizarPlanesMasivo);
router.put('/planes/:id_plan',              controller.actualizarPlan);
router.put('/planes/:id_plan/desactivar',   controller.desactivarPlan);

// --- Preview cuotas (para modal frontend) ---
router.get('/:id_terminal/preview/:monto',  controller.previewCuotas);

module.exports = router;
