/**
 * RUTAS: Gestión de Despachos v5
 * ERP LAGO - Document-Driven Delivery System
 */

const express = require('express');
const router = express.Router();
const despachosController = require('../controllers/despachos.controller');
const remitoPdfController = require('../controllers/remito-pdf.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// PEDIDOS DISPONIBLES
router.get('/pedidos-disponibles', despachosController.obtenerPedidosDisponibles);
router.get('/pedido/:id', despachosController.obtenerDetallePedido);

// VIAJES
router.get('/viajes', despachosController.listarViajes);
router.post('/viajes', despachosController.crearViaje);
router.get('/viaje/:id', despachosController.obtenerViaje);
router.put('/viaje/:id', despachosController.actualizarViaje);

// CARGA DEL VIAJE
router.post('/viaje/:id/agregar', despachosController.agregarAlViaje);
router.delete('/viaje/:id/remito/:id_remito', despachosController.quitarDelViaje);

// OPERACIONES DE VIAJE
router.post('/viaje/:id/despachar', despachosController.despacharViaje);
router.post('/viaje/:id/registrar-regreso', despachosController.registrarRegreso);
router.post('/viaje/:id/liquidar', despachosController.liquidarViaje);

// CANCELAR VIAJES
router.delete("/viaje/:id", despachosController.cancelarViaje);
router.post("/viaje/:id/auto-eliminar-si-vacio", despachosController.autoEliminarSiVacio);
router.delete("/viajes-vacios", despachosController.cancelarViajesVacios);

// UTILIDADES
router.get('/depositos', despachosController.obtenerDepositos);
router.get('/stock/:id_producto', despachosController.obtenerStockProducto);
router.post('/remito/:id/cobrar', despachosController.cobrarRemito);
router.patch('/remito/:id/observaciones', despachosController.actualizarObservacionesRemito);
router.get("/plantilla/config", despachosController.obtenerConfigPlantilla);

// BÚSQUEDA DE REMITOS
router.get('/buscar-remitos', despachosController.buscarRemitos);

// Búsqueda histórica y remitos por pedido
router.get("/busqueda-global", despachosController.busquedaGlobal);
router.get("/buscar-pedidos", despachosController.buscarPedidosHistorico);
router.get("/pedido/:id/remitos", despachosController.obtenerRemitosPedido);

// PDF server-side
router.get('/remito/:id/html', remitoPdfController.generarHTML);
router.get('/viaje/:id/html', remitoPdfController.generarHTMLViaje);


router.get('/trazabilidad/:tipo/:id', despachosController.obtenerTrazabilidad);


module.exports = router;
