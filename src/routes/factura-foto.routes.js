const router = require('express').Router();
const { verificarToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/factura-foto.controller');

router.post('/analizar', verificarToken, ctrl.analizar);

module.exports = router;
