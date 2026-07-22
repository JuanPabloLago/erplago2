/**
 * ROUTES CLIENTES v13.1 - FIXED
 */
const express = require('express');
const router = express.Router();
const clientesController = require('../controllers/clientes.controller');
const clientesImport = require('../controllers/clientes-import.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// ESPECIALES
router.get('/form-data', clientesController.getFormData);
router.get('/buscar', clientesController.buscar);
router.get('/buscar-cobranzas', clientesController.buscarCobranzas);
router.get('/buscar-datos-cuit/:cuit', clientesController.buscarDatosCUIT);
router.get('/buscar-datos-dni/:dni', clientesController.buscarDatosDNI);
router.get('/ids-filtrados', clientesController.obtenerIdsFiltrados);

// MASIVAS
router.post('/masivo/cambiar-estado', clientesController.cambiarEstadoMasivo);
router.post('/masivo/asignar-lista', clientesController.asignarListaMasivo);
router.post('/masivo/asignar-descuento', clientesController.asignarDescuentoMasivo);

// IMPORT/EXPORT EXCEL
router.get('/import/plantilla', clientesImport.descargarPlantilla);
router.post('/import/preview', clientesImport.uploadMiddleware, clientesImport.previewImportacion);
router.post('/import/ejecutar', clientesImport.ejecutarImportacion);
router.post('/exportar/excel', clientesController.exportarExcel);
router.post('/exportar/excel-file', clientesImport.exportarExcelFile);

// CRUD (rutas con :id al final)
router.get('/:id', clientesController.obtenerPorId);
router.get('/', clientesController.listar);
router.post('/', clientesController.crear);
router.put('/:id', clientesController.actualizar);
router.delete('/:id', clientesController.eliminar);

module.exports = router;
