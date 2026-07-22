/**
 * MIS-PEDIDOS ROUTES — ERP LAGO
 * Rutas del cliente web para sus propios pedidos
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/pedidos-web.controller');
const {
    verificarClienteWeb,
    inyectarSessionAnonima
} = require('../middleware/auth-web.middleware');

router.use(inyectarSessionAnonima);
router.use(verificarClienteWeb);

router.get   ('/',                              ctrl.misPedidos);
router.get   ('/:id',                           ctrl.detallePedidoCliente);
router.put   ('/:id/items/:id_item',            ctrl.modificarItemCliente);
router.delete('/:id/items/:id_item',            ctrl.eliminarItemCliente);
router.post  ('/:id/cancelar',                  ctrl.cancelarPedidoCliente);

module.exports = router;
