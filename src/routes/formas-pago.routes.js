const express = require('express');
const router = express.Router();
const formasPagoController = require('../controllers/formas-pago.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, formasPagoController.listar);
router.get('/activos', verificarToken, formasPagoController.obtenerActivos);

module.exports = router;
