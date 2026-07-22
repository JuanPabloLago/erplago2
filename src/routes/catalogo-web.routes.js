/**
 * CATALOGO-WEB ROUTES — ERP LAGO
 * Rutas publicas del catalogo (productos, categorias, marcas)
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/catalogo-web.controller');
const {
    clienteWebOpcional,
    inyectarSessionAnonima
} = require('../middleware/auth-web.middleware');

// Catalogo siempre opcional: si esta logueado, usa su lista; si no, la publica
router.use(inyectarSessionAnonima);
router.use(clienteWebOpcional);

router.get('/info-empresa',   ctrl.infoEmpresa);
router.get('/productos',      ctrl.listarProductos);
router.get('/productos/:id',  ctrl.detalleProducto);
router.get('/categorias',     ctrl.listarCategorias);
router.get('/marcas',         ctrl.listarMarcas);

// Tabs B2B de conjuntos (vista tipo lista de precios imprimible)
router.get('/conjuntos/tabs',                ctrl.listarTabsConjuntos);
router.get('/conjuntos/tab/:slug/productos', ctrl.productosDeTabConjunto);

module.exports = router;
