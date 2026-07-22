'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/historial-producto.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// GET /api/historial-producto/:id_producto
router.get('/:id_producto', controller.obtener);

module.exports = router;
