const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidos.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// GET - Datos para POS
router.get('/historial-producto-cliente', verificarToken, pedidosController.historialProductoCliente);
router.get('/pendientes-cobro', verificarToken, pedidosController.obtenerPendientesCobro);
router.get('/data', verificarToken, pedidosController.obtenerDatos);

// GET - Pedidos suspendidos
router.get('/suspendidos', verificarToken, pedidosController.obtenerSuspendidos);
// POST - Suspender pedido (crear suspendido)
router.post('/suspender', verificarToken, pedidosController.suspenderPedido);

// GET - Detalle completo con documentos relacionados
router.get('/:id/detalle', verificarToken, pedidosController.obtenerDetalle);

// GET - Historial de modificaciones
router.get('/:id/historial', verificarToken, pedidosController.obtenerHistorial);

// POST - Registrar sobrepago como saldo a favor en CC
router.post('/:id/registrar-sobrepago', verificarToken, pedidosController.registrarSobrepago);

// PUT - Editar item de pedido
router.put('/:id/items/:id_item', verificarToken, pedidosController.editarItem);
  router.put('/:id/campos', verificarToken, pedidosController.actualizarCamposPedido);

// DELETE - Eliminar item de pedido
router.delete('/:id/items/:id_item', verificarToken, pedidosController.eliminarItemPedido);

// PUT - Anular pedido
router.put('/:id/anular', verificarToken, pedidosController.anularPedido);

// GET - Obtener por ID
router.get('/:id', verificarToken, pedidosController.obtenerPorId);

// POST - Recuperar suspendido
router.post('/:id/recuperar', verificarToken, pedidosController.recuperarSuspendido);

// GET - Listar todos
router.get('/', verificarToken, pedidosController.listar);

// POST - Crear retiro inmediato (F2 en POS)
router.post('/crear/inmediato', verificarToken, pedidosController.crearRetiroInmediato);

// POST - Guardar para entregar (Ctrl+S en POS)
router.post('/guardar/entregar', verificarToken, pedidosController.guardarParaEntregar);

router.get('/:id/evaluar-anulacion', verificarToken, pedidosController.evaluarAnulacion);
router.post('/:id/anular-cascada',   verificarToken, pedidosController.anularCascada);

module.exports = router;
