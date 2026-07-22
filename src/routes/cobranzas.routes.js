const express = require('express');
const router = express.Router();
const controller = require('../controllers/cobranzas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// Resumen CC de un cliente
router.get('/cuenta-corriente/:id_cliente', controller.getCuentaCorriente);

// Libro de movimientos CC con filtros
router.get('/cuenta-corriente/:id_cliente/movimientos', controller.getMovimientosCC);

// Exportar movimientos a Excel (.xlsx)
router.get('/cuenta-corriente/:id_cliente/exportar', controller.exportarMovimientosExcel);

// Libro mayor (F2 2026-07-03)
router.get('/cuenta-corriente/:id_cliente/libro', controller.getLibro);
router.get('/cuenta-corriente/:id_cliente/libro/export', controller.exportarLibroCSV);
router.post('/cuenta-corriente/:id_cliente/cobrar', controller.registrarCobro);
router.get('/cuenta-corriente/:id_cliente/resumen/html', controller.getResumenHTML);
router.get('/form-data-cobro', controller.getFormDataCobro);
router.get('/cuenta-corriente/:id_cliente/aging', controller.getAging);
router.post('/cuenta-corriente/:id_cliente/devolver', controller.registrarDevolucionCtrl);
module.exports = router;
