/**
 * ROUTES PROVEEDORES MODERNIZADO v13.0
 * ERP LAGO
 */

const express = require('express');
const router = express.Router();
const proveedoresController = require('../controllers/proveedores.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// ============================================================================
// RUTAS ESPECIALES (deben ir ANTES de las rutas con parámetros)
// ============================================================================

// Datos para formulario (combos)
router.get('/form-data', proveedoresController.getFormData);

// Búsqueda avanzada con filtros
router.get('/buscar', proveedoresController.buscarAvanzado);

// Consulta AFIP por CUIT
router.get('/buscar-datos-cuit/:cuit', proveedoresController.buscarDatosCUIT);

// IDs filtrados para selección masiva
router.get('/ids-filtrados', proveedoresController.obtenerIdsFiltrados);

// ============================================================================
// ACCIONES MASIVAS
// ============================================================================

router.post('/masivo/cambiar-estado', proveedoresController.cambiarEstadoMasivo);

// ============================================================================
// EXPORTACIÓN
// ============================================================================

router.post('/exportar/excel', proveedoresController.exportarExcel);

// ============================================================================
// CRUD BÁSICO
// ============================================================================

router.get('/:id', proveedoresController.obtenerPorId);
router.get('/', proveedoresController.listar);
router.post('/', proveedoresController.crear);
router.put('/:id', proveedoresController.actualizar);
router.delete('/:id', proveedoresController.eliminar);

module.exports = router;
