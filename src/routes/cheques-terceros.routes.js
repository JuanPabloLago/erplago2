const express = require('express');
const router = express.Router();
const controller = require('../controllers/cheques-terceros.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, controller.listar);
router.get('/alertas', verificarToken, controller.alertas);
router.post('/', verificarToken, controller.crear);
router.put('/:id/estado', verificarToken, controller.cambiarEstado);

module.exports = router;
