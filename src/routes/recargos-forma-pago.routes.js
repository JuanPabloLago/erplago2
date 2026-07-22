const express = require('express');
const router = express.Router();
const controller = require('../controllers/recargos-forma-pago.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// ============================================================================
// CONFIGURACIÓN de recargos/descuentos por forma de pago
// ============================================================================

// Listar todos (con LEFT JOIN a formas_pago) - para panel de configuración
router.get('/', controller.listar);

// Solo activos con porcentaje != 0 - para frontend tesorería
router.get('/activos', controller.obtenerActivos);

// Guardar masivo (UPSERT) - desde panel de configuración
router.put('/bulk', controller.guardarMasivo);

// Actualizar individual
router.put('/:id', controller.actualizar);

// ============================================================================
// REPORTES
// ============================================================================

// Reporte de ajustes aplicados (tabla ajustes_forma_pago)
router.get('/reporte-ajustes', controller.reporteAjustes);

module.exports = router;
