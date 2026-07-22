const express = require('express');
const router = express.Router();
const categoriasController = require('../controllers/categorias.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/arbol', verificarToken, categoriasController.obtenerArbol);
router.get('/principales', verificarToken, categoriasController.obtenerPrincipales);
router.get('/:id/subcategorias', verificarToken, categoriasController.obtenerSubcategorias);
router.get('/:id/productos-count', verificarToken, categoriasController.productosCount);
router.get('/', verificarToken, categoriasController.listar);
router.post('/', verificarToken, categoriasController.crear);
router.put('/:id', verificarToken, categoriasController.actualizar);
router.delete('/:id', verificarToken, categoriasController.eliminar);

module.exports = router;
