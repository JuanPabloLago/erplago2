const express = require('express');
const router = express.Router();
const { verificarToken, verificarAdmin } = require('../middleware/auth.middleware');
const depositosController = require('../controllers/depositos.controller');

// Listar (cualquier usuario autenticado)
router.get('/', verificarToken, depositosController.listar);
router.get('/:id', verificarToken, depositosController.obtener);

// CRUD (solo admin)
router.post('/', verificarToken, verificarAdmin, depositosController.crear);
router.put('/:id', verificarToken, verificarAdmin, depositosController.editar);
router.delete('/:id', verificarToken, verificarAdmin, depositosController.eliminar);
router.put('/:id/principal', verificarToken, verificarAdmin, depositosController.marcarPrincipal);

module.exports = router;
