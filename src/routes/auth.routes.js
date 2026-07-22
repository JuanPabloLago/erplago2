const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Rutas públicas
router.post('/login', authController.login);

// Rutas protegidas
router.get('/perfil', verificarToken, authController.obtenerPerfil);
router.get('/configuracion', verificarToken, authController.obtenerConfiguracionUsuario);
router.post('/configuracion', verificarToken, authController.guardarConfiguracionUsuario);

// Rutas de gestión de dispositivos (solo admin)
router.get('/dispositivos', verificarToken, authController.obtenerDispositivos);
router.get('/dispositivos/pendientes', verificarToken, authController.obtenerIntentosPendientes);
router.get('/dispositivos/cobertura', verificarToken, authController.obtenerCoberturaDispositivos);
router.post('/dispositivos/autorizar', verificarToken, authController.autorizarDispositivo);
router.post('/dispositivos/rechazar', verificarToken, authController.rechazarIntento);
router.put('/dispositivos/:id_dispositivo/desactivar', verificarToken, authController.desactivarDispositivo);
router.put('/dispositivos/:id_dispositivo/reactivar', verificarToken, authController.reactivarDispositivo);
router.delete('/dispositivos/:id_dispositivo', verificarToken, authController.eliminarDispositivo);

// Logout (limpia cookie httpOnly)
router.post('/auth/logout', authController.logout);

module.exports = router;
