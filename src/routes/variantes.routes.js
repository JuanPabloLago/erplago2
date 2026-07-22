const express = require('express');
const router = express.Router();
const variantesController = require('../controllers/variantes.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/buscar', verificarToken, variantesController.buscar);
router.get("/producto/:id", verificarToken, variantesController.obtenerPorProducto);
router.get('/:id', verificarToken, variantesController.obtenerPorId);
router.post('/:id', verificarToken, variantesController.crear);
router.put('/:id', verificarToken, variantesController.actualizar);
router.delete('/:id', verificarToken, variantesController.eliminar);

module.exports = router;
