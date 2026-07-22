'use strict';

/**
 * entregas.routes.js — Productos entregados (SOLO LECTURA)
 * Auth interna: todas las rutas exigen token (patrón del proyecto).
 */

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/entregas.controller');

router.use(verificarToken);

router.get('/', ctrl.listar);
router.get('/opciones', ctrl.opciones);
router.get('/export', ctrl.exportar);
router.get('/filtro-ultimo', ctrl.obtenerFiltroUltimo);
router.put('/filtro-ultimo', ctrl.guardarFiltroUltimo);

module.exports = router;
