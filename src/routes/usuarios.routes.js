/**
 * USUARIOS ROUTES - ERP LAGO
 * Rutas para gestión de usuarios, permisos, logs y MÓDULOS POR ROL
 */

const express = require('express');
const router = express.Router();
const usuariosController = require('../controllers/usuarios.controller');
const modulosAdmin = require('../controllers/modulos-admin.controller');
const { verificarToken, verificarRol } = require('../middleware/auth.middleware');

// Middleware: todas las rutas requieren autenticación
router.use(verificarToken);

// Middleware: solo admin/administrador puede acceder
const soloAdmin = verificarRol(['admin', 'administrador']);

// =========================================================================
// DATOS AUXILIARES
// =========================================================================

// Datos para formularios (roles, empresas, permisos)
router.get('/usuarios/form-data', soloAdmin, usuariosController.formData);

// =========================================================================
// ABM USUARIOS
// =========================================================================

// Listar usuarios
router.get('/usuarios', soloAdmin, usuariosController.listar);

// Obtener usuario por ID
router.get('/usuarios/:id', soloAdmin, usuariosController.obtenerPorId);

// Crear usuario
router.post('/usuarios', soloAdmin, usuariosController.crear);

// Actualizar usuario
router.put('/usuarios/:id', soloAdmin, usuariosController.actualizar);

// Desactivar usuario
router.delete('/usuarios/:id', soloAdmin, usuariosController.desactivar);

// Reset password
router.put('/usuarios/:id/reset-password', soloAdmin, usuariosController.resetPassword);

// Logs de un usuario específico
router.get('/usuarios/:id/logs', soloAdmin, usuariosController.logsUsuario);

// =========================================================================
// ROLES Y PERMISOS
// =========================================================================

// Listar roles disponibles
router.get('/roles', soloAdmin, usuariosController.listarRoles);

// Listar permisos de un rol
router.get('/permisos/:rol', soloAdmin, usuariosController.listarPermisosPorRol);

// Activar/desactivar permiso de un rol
router.put('/permisos/:rol/:permiso', soloAdmin, usuariosController.togglePermiso);

// =========================================================================
// MÓDULOS POR ROL (NUEVO)
// =========================================================================

// Catálogo de módulos
router.get('/modulos', soloAdmin, modulosAdmin.listarModulos);

// Matriz completa roles x módulos
router.get('/modulos/matriz', soloAdmin, modulosAdmin.obtenerMatriz);

// Módulos de un rol específico (con todos para checkbox)
router.get('/modulos/rol/:rol', soloAdmin, modulosAdmin.obtenerModulosRol);

// Guardar asignación de módulos de un rol
router.put('/modulos/rol/:rol', soloAdmin, modulosAdmin.guardarModulosRol);

// Clonar módulos de otro rol
router.post('/modulos/rol/:rol/clonar', soloAdmin, modulosAdmin.clonarModulosRol);

// =========================================================================
// EMPRESAS
// =========================================================================

// Listar empresas
router.get('/empresas', soloAdmin, usuariosController.listarEmpresas);

// =========================================================================
// LOGS GENERALES
// =========================================================================

// Logs generales del sistema
router.get('/logs', soloAdmin, usuariosController.logsGenerales);

module.exports = router;
