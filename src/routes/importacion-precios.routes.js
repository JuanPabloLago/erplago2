'use strict';

const router = require('express').Router();
const { verificarToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/importacion-precios.controller');

router.get('/form-data',          verificarToken, ctrl.getFormData);
router.post('/inspeccionar',      verificarToken, ctrl.uploadMiddleware, ctrl.inspeccionar);
router.post('/upload',            verificarToken, ctrl.uploadMiddleware, ctrl.uploadPreview);
router.post('/guardar-descuento', verificarToken, ctrl.guardarDescuento);
router.post('/aplicar',           verificarToken, ctrl.aplicar);
router.post('/recalcular-lista',  verificarToken, ctrl.recalcularLista);
router.post('/recalcular-todas',  verificarToken, ctrl.recalcularTodas);
router.get('/historial',          verificarToken, ctrl.historial);
router.get('/historial/:id',      verificarToken, ctrl.historialDetalle);

module.exports = router;
