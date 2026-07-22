/**
 * @file ordenes-compra.routes.js
 * @description Rutas del modulo Ordenes de Compra.
 *              Auth via cookie/middleware global (montado en src/routes/index.js).
 */

'use strict';

const express = require('express');
const { verificarToken } = require('../middleware/auth.middleware');
const router = express.Router();
router.use(verificarToken);
const controller = require('../controllers/ordenes-compra.controller');

// GET — lecturas
router.get('/form-data',                controller.formData);
router.get('/export/excel',             controller.exportExcel);
router.get('/por-producto/:id_producto', controller.porProducto);
router.get('/:id/datos',                controller.datosImprimir);
router.get('/:id/html',                 controller.html);
router.get('/:id',                      controller.obtener);
router.get('/',                         controller.listar);

// POST/PUT — escrituras
router.post('/',                        controller.crear);
router.post('/:id/emitir',              controller.emitir);
router.post('/:id/recibir',             controller.recibir);
router.post('/:id/anular',              controller.anular);

module.exports = router;
