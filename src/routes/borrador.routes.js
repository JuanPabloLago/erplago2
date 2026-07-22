const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const borradorController = require('../controllers/borrador.controller');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// Borrador CRUD
// Abrir sesion venta rapida (aplica politica de borradores huerfanos)
router.post('/abrir-sesion', borradorController.abrirSesionVentaRapida);

router.get('/', borradorController.obtenerBorradorActivo);
router.post('/', borradorController.crearBorrador);
router.delete('/:id', borradorController.descartarBorrador);

// Items del borrador
router.post('/:id/items', borradorController.agregarItem);
router.put('/:id/items/:id_item', borradorController.modificarItem);
router.delete('/:id/items/:id_item', borradorController.eliminarItem);

// Cliente
router.put('/:id/cliente', borradorController.asignarCliente);

// Sincronizar pagos provisorios (FIX I3)
router.put('/:id/pagos', borradorController.sincronizarPagos);

// Confirmar (convierte borrador en pedido real)
router.post('/:id/confirmar', borradorController.confirmarBorrador);
// Suspender borrador (atómico — FIX C1)
router.post('/:id/suspender', borradorController.suspenderBorrador);


// Autorización de supervisor para eliminar items
router.post('/autorizar-eliminacion', borradorController.autorizarEliminacion);

// Limpieza de borradores abandonados (solo admin)
router.post('/limpiar', borradorController.limpiarBorradoresAbandonados);

module.exports = router;
