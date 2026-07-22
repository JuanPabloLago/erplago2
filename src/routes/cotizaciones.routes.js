const express = require('express');
const router = express.Router();
const controller = require('../controllers/cotizaciones.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, controller.listar);
router.get('/:id_moneda', verificarToken, controller.obtener);
router.put('/:id_moneda', verificarToken, controller.actualizar);
router.get('/usd/vigente', verificarToken, controller.vigenteUSD);
router.post('/sincronizar-blue', verificarToken, controller.sincronizarBlue);

module.exports = router;
