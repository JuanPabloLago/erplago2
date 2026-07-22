const express = require('express');
const router = express.Router();
const monedasController = require('../controllers/monedas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, monedasController.listar);

module.exports = router;
