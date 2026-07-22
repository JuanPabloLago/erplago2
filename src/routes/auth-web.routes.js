/**
 * AUTH-WEB ROUTES — ERP LAGO
 * Rutas publicas de autenticacion de clientes web
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/auth-web.controller');
const {
    verificarClienteWeb,
    clienteWebOpcional,
    inyectarSessionAnonima
} = require('../middleware/auth-web.middleware');

// Todas las rutas web inyectan cookie de sesion anonima (para carrito)
router.use(inyectarSessionAnonima);

// Publicas (necesitan saber id_empresa_web -> usar opcional para resolverla)
router.post('/registro',           clienteWebOpcional, ctrl.registro);
router.post('/login',              clienteWebOpcional, ctrl.login);
router.post('/logout',             clienteWebOpcional, ctrl.logout);
router.post('/recupero',           clienteWebOpcional, ctrl.solicitarRecupero);
router.post('/reset/:token',       clienteWebOpcional, ctrl.resetPassword);

// Protegidas
router.get ('/me',                 verificarClienteWeb, ctrl.me);
router.post('/cambiar-password',   verificarClienteWeb, ctrl.cambiarPassword);

module.exports = router;
