const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/pagos-confirmacion.controller');

router.use(verificarToken);

router.post('/confirmar', controller.confirmarPago);
router.get('/verificar/:codigo', controller.verificarCodigo);
router.get('/pendientes-confirmacion', controller.obtenerPendientesConfirmacion);
router.get('/pedido/:id_pedido', controller.obtenerDetallePedido);
router.post('/anular', controller.anularConfirmacion);

module.exports = router;
