/**
 * HISTORIAL MOVIMIENTOS ROUTES
 * ERP LAGO
 */
const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/historial-movimientos.controller');

router.use(verificarToken);

router.get('/ventas', controller.consultarVentas);
router.get('/compras', controller.consultarCompras);
router.get('/clientes', controller.listarClientes);
router.get('/proveedores', controller.listarProveedores);
router.get('/productos', controller.buscarProductos);
router.get('/usuario', controller.infoUsuario);
router.get('/exportar', controller.exportarExcel);

module.exports = router;
