'use strict';
const express = require('express');
const { verificarToken } = require('../middleware/auth.middleware');
const router = express.Router();
router.use(verificarToken);
const ctrl = require('../controllers/imagenes-producto.controller');

// Auth global se aplica en el mount point por index.js.
// El chequeo de admin para mutaciones lo hace el propio controller.

router.get('/:id_producto/imagenes',                            ctrl.listar);
router.post('/:id_producto/imagenes',                           ctrl.agregar);
router.put('/:id_producto/imagenes/:id_imagen',                 ctrl.actualizar);
router.delete('/:id_producto/imagenes/:id_imagen',              ctrl.eliminar);
router.post('/:id_producto/imagenes/reordenar',                 ctrl.reordenar);
router.put('/:id_producto/imagenes/:id_imagen/principal',       ctrl.marcarPrincipal);

module.exports = router;
