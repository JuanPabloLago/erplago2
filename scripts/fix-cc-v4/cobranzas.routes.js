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

module.exports = router;
