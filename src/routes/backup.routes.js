const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backup.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.post('/crear', verificarToken, backupController.crear);
router.get('/listar', verificarToken, backupController.listar);
router.get('/verificar/:nombre', verificarToken, backupController.verificar);
router.post('/restaurar/:nombre', verificarToken, backupController.restaurar);
router.delete('/:nombre', verificarToken, backupController.eliminar);
router.post('/sincronizar-drive', verificarToken, backupController.sincronizarDrive);

module.exports = router;
