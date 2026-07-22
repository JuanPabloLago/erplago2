const express = require('express');
const router = express.Router();
const condicionesivaController = require('../controllers/condicionesiva.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.get('/', verificarToken, condicionesivaController.listar);

module.exports = router;
