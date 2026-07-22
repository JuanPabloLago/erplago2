/**
 * CARRITO-WEB ROUTES — ERP LAGO
 * Rutas del carrito (anonimo o logueado) + checkout
 */
const express = require('express');
const router  = express.Router();
const carritoCtrl = require('../controllers/carrito-web.controller');
const pedidosCtrl = require('../controllers/pedidos-web.controller');
const {
    verificarClienteWeb,
    clienteWebOpcional,
    inyectarSessionAnonima
} = require('../middleware/auth-web.middleware');

// El carrito funciona logueado o anonimo
router.use(inyectarSessionAnonima);
router.use(clienteWebOpcional);

router.get   ('/carrito',                  carritoCtrl.obtener);
router.post  ('/carrito/items',            carritoCtrl.agregarItem);
router.put   ('/carrito/items/:id_item',   carritoCtrl.modificarItem);
router.delete('/carrito/items/:id_item',   carritoCtrl.eliminarItem);
router.delete('/carrito',                  carritoCtrl.vaciar);

// Checkout: requiere login obligatorio
router.post  ('/checkout',                 verificarClienteWeb, pedidosCtrl.checkout);

module.exports = router;
