'use strict';

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/listas-precios.controller');

// Stats
router.get('/estadisticas',              verificarToken, ctrl.estadisticas);

// Listas activas (para selects en otros módulos)
router.get('/activas',                   verificarToken, ctrl.listarActivas);

// CRUD Listas
router.get('/',                          verificarToken, ctrl.listar);
router.get('/:id',                       verificarToken, ctrl.obtenerPorId);
router.post('/',                         verificarToken, ctrl.crear);
router.put('/:id',                       verificarToken, ctrl.actualizar);
router.put('/:id/desactivar',            verificarToken, ctrl.desactivar);
router.put('/:id/activar',              verificarToken, ctrl.activar);

// Precios de una lista
router.get('/:id/precios',              verificarToken, ctrl.obtenerPrecios);
router.put('/:id/precios',              verificarToken, ctrl.actualizarPrecio);
router.put('/:id/precios/masivo',        verificarToken, ctrl.actualizarPreciosMasivo);

// Recálculo y redondeo
router.post('/:id/recalcular',          verificarToken, ctrl.recalcular);
router.post('/:id/redondear',           verificarToken, ctrl.redondear);
router.post('/:id/ajustar-porcentaje',  verificarToken, ctrl.ajustarPorcentaje);
router.get('/:id/preview-redondeo',     verificarToken, ctrl.previsualizarRedondeo);

// Clientes asignados
router.get('/:id/clientes',             verificarToken, ctrl.obtenerClientes);
router.post('/:id/clientes/asignar',    verificarToken, ctrl.asignarClientes);
router.post('/clientes/desasignar',     verificarToken, ctrl.desasignarClientes);

module.exports = router;
