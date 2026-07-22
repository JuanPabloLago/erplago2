const express = require('express');
const router = express.Router();
const controller = require('../controllers/ajustes-inventario.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// ============================================================================
// CRUD de Ajustes
// ============================================================================

// Listar ajustes (con filtros)
router.get('/', controller.listar);

// Obtener ajuste por ID (con items)
router.get('/:id', controller.obtenerPorId);

// Preview de cambios antes de aplicar
router.get('/:id/preview', controller.preview);

// Crear ajuste vacío (borrador)
router.post('/', controller.crear);

// Crear ajuste con items en una sola operación
router.post('/con-items', controller.crearConItems);

// Eliminar ajuste en borrador
router.delete('/:id', controller.eliminar);

// ============================================================================
// Gestión de Items
// ============================================================================

// Agregar/actualizar item individual
router.post('/:id/items', controller.agregarItem);

// Eliminar item
router.delete('/:id/items/:id_item', controller.eliminarItem);

// Cargar items masivamente desde filtros
router.post('/:id/cargar-masivo', controller.cargarItemsMasivo);

// Actualizar múltiples items a la vez
router.put('/:id/items', controller.actualizarItemsMasivo);

// Llenar todos con 0 o copiar del sistema
router.post('/:id/llenar', controller.llenarItems);

// ============================================================================
// Acciones del Comprobante
// ============================================================================

// Aplicar ajuste (ejecutar cambios en inventario)
router.post('/:id/aplicar', controller.aplicar);

// Anular ajuste (revertir cambios)
router.post('/:id/anular', controller.anular);

module.exports = router;
