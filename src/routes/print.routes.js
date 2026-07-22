const express = require('express');
const router = express.Router();
const printController = require('../controllers/print.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// Jobs de impresión
router.post('/jobs', printController.crearJob);
router.get('/jobs', printController.listarJobs);
router.get('/jobs/:id', printController.obtenerJob);

// Impresoras
router.get('/impresoras', printController.listarImpresoras);

// Comprobantes (vista previa)
router.get('/comprobante/:id/datos', printController.getDatosComprobante);
router.get('/comprobante/:id/html', printController.renderizarHTML);

module.exports = router;
