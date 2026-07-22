const express = require('express');
const router = express.Router();
const controller = require('../controllers/inventario.controller');
const importController = require('../controllers/inventario-import.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// ============================================================================
// IMPORTACIÓN / EXPORTACIÓN EXCEL
// ============================================================================

// Listar depósitos disponibles (helper para el combo del frontend)
router.get('/import/depositos', importController.listarDepositos);

// Descargar plantilla Excel con stock actual del depósito
router.get('/import/plantilla', importController.exportarPlantilla);

// Preview: upload Excel + matcheo + diff (no modifica nada)
router.post('/import/preview', importController.uploadMiddleware, importController.previewImportacion);

// Ejecutar: crea comprobante ajuste_inventario + opcionalmente aplica
router.post('/import/ejecutar', importController.ejecutarImportacion);

// ============================================================================
// CONSULTAS DE INVENTARIO
// ============================================================================

// Inventario completo
router.get('/depositos', controller.listarDepositos);
router.get('/completo', controller.obtenerCompleto);

// Alertas
router.get('/alertas/bajo-minimo', controller.alertasBajoMinimo);
router.get('/alertas/sin-stock', controller.alertasSinStock);

// Por producto
// Endpoint enriquecido (modulo OC, 2026-05-17) -- antes de /:id_producto para evitar interceptacion
router.get('/completo-extendido', controller.obtenerCompletoExtendido);

// Imprimir listado (modulo OC + Lote B, 2026-05-17) -- antes de /:id_producto para evitar interceptacion
router.get('/listado/html', controller.obtenerListadoHTML);

router.get('/:id_producto', controller.obtenerPorProducto);
router.get('/:id_producto/depositos', controller.obtenerStockMultiDeposito);
router.get('/:id_producto/movimientos', controller.obtenerMovimientos);

// Ajuste simple (sin comprobante formal)
router.put('/ajuste', controller.ajustarStock);

router.post('/transferir', controller.transferirStock);

// Min/Max + Reposicion (modulo OC, 2026-05-17)
router.put('/:id_producto/min-max',     controller.actualizarMinMax);
router.post('/reposicion/calcular',     controller.previewReposicion);
router.post('/reposicion/generar',      controller.generarOCs);
module.exports = router;
