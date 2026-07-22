const express = require('express');
const router = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/configuraciones.controller');

router.use(verificarToken);

router.get('/venta-rapida', controller.obtenerVentaRapida);
router.get('/empresa', controller.obtenerEmpresa);
router.put('/empresa', controller.actualizarEmpresa);
router.get('/afip', controller.obtenerAFIP);
router.put('/afip', controller.actualizarAFIP);
router.post('/afip/test', controller.testAFIP);
router.get('/todas', controller.obtenerTodas);
  router.put('/todas', controller.actualizarConfigPersonalizada);

module.exports = router;
