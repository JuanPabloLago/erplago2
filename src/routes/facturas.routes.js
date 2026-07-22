const express = require('express');
const router = express.Router();
const facturasController = require('../controllers/facturas.controller');
const ventasController = require('../controllers/ventas-consulta.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Rutas específicas ANTES de /:id
router.get('/mi-punto-venta', verificarToken, facturasController.miPuntoVenta);
router.get('/tipos', verificarToken, facturasController.obtenerTipos);
router.get('/proximo-numero/:punto_venta/:id_tipo_factura', verificarToken, facturasController.obtenerProximoNumero);
router.get('/pedidos-facturables', verificarToken, ventasController.consultarVentas);

// CRUD
router.get('/', verificarToken, facturasController.listar);
router.post('/', verificarToken, facturasController.crear);
router.post('/masivo', verificarToken, facturasController.facturarMasivo);
router.post('/confirmar-rapido', verificarToken, ventasController.confirmarRapido);
  router.post('/desde-pedido/:id_pedido', verificarToken, ventasController.facturarDesdePedido);

router.get('/metodos-pago', verificarToken, ventasController.obtenerMetodosPago);
router.post('/registrar-pago', verificarToken, ventasController.registrarPago);
router.put('/corregir-metodo-pago', verificarToken, ventasController.corregirMetodoPago);
// Rutas con :id AL FINAL
router.get('/:id', verificarToken, facturasController.obtenerPorId);
router.delete('/:id', verificarToken, facturasController.anular);

module.exports = router;
