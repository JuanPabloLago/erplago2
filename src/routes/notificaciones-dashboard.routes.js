const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/notificaciones-dashboard.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

router.get ('/',           ctrl.listar);
router.post('/leer-todo',  ctrl.leerTodo);
router.post('/:id/leida',  ctrl.marcarLeida);

module.exports = router;
