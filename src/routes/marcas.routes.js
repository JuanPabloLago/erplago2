const express = require('express');
const router = express.Router();
const marcasController = require('../controllers/marcas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/:id', verificarToken, marcasController.obtenerPorId);
router.get('/', verificarToken, marcasController.listar);
router.post('/', verificarToken, marcasController.crear);
router.put('/:id', verificarToken, marcasController.actualizar);
router.delete('/:id', verificarToken, marcasController.eliminar);

module.exports = router;
