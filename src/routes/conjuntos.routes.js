const express = require('express');
const router = express.Router();
const conjuntosController = require('../controllers/conjuntos.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/:id', verificarToken, conjuntosController.obtenerPorId);
router.get('/', verificarToken, conjuntosController.listar);
router.post('/', verificarToken, conjuntosController.crear);
router.put('/:id', verificarToken, conjuntosController.actualizar);
router.delete('/:id', verificarToken, conjuntosController.eliminar);

module.exports = router;
