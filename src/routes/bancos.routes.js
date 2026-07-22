const express = require('express');
const router = express.Router();
const bancosController = require('../controllers/bancos.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, bancosController.listar);

module.exports = router;
