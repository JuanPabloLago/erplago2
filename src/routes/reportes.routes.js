const express = require('express');
const router = express.Router();
const reportesController = require('../controllers/reportes.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// Dashboard
router.get('/dashboard', reportesController.dashboard);
router.get('/stock-bajo', reportesController.stockBajo);

// Filtros (combos)
router.get('/filtros', reportesController.filtros);

// Reportes
router.get('/ventas-periodo', reportesController.ventasPeriodo);
router.get('/ranking-productos', reportesController.rankingProductos);
router.get('/ventas-categoria', reportesController.ventasCategoria);
router.get('/ventas-vendedor', reportesController.ventasVendedor);
router.get('/ventas-forma-pago', reportesController.ventasFormaPago);
router.get('/stock-valorizado', reportesController.stockValorizado);

module.exports = router;
