/**
 * PRESUPUESTOS ROUTES - ERP LAGO
 */

const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const presupuestosController = require('../controllers/presupuestos.controller');

router.get('/proximo-numero', verificarToken, presupuestosController.proximoNumero);
router.get('/', verificarToken, presupuestosController.listar);
router.get('/:id', verificarToken, presupuestosController.obtenerPorId);
router.post('/', verificarToken, presupuestosController.crear);
router.post('/desde-pedido/:id_pedido', verificarToken, presupuestosController.crearDesdePedido);
router.post('/masivo', verificarToken, presupuestosController.crearMasivo);
router.put('/:id/estado', verificarToken, presupuestosController.cambiarEstado);
router.delete('/:id', verificarToken, presupuestosController.anular);

module.exports = router;
