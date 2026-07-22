'use strict';

const express         = require('express');
const router          = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const notasController = require('../controllers/notas.controller');
const notasPrintController = require('../controllers/notas-print.controller');

router.use(verificarToken);

// Orden importa: rutas específicas ANTES de /:id
router.get('/proximo-numero/:pv/:tipo',        notasController.proximoNumero);
router.get('/comprobante-origen/:tipo/:id',    notasController.obtenerComprobanteOrigen);
router.get('/pedidos-credito-disponible',      notasController.listarPedidosCreditoDisponible);
router.get('/',                                notasController.listar);
// Impresión de notas C/D (HTML server-side render)
router.get('/:id/html',  notasPrintController.renderizarHTML);
router.get('/:id/datos', notasPrintController.getDatos);
router.get('/:id',                             notasController.obtenerPorId);
router.post('/',                               notasController.crear);
router.delete('/:id',                          notasController.anular);

module.exports = router;
