/**
 * modulos-admin.controller.js - Endpoints de Gestión de Módulos por Rol
 * Ubicación: /root/mi_erp/src/controllers/modulos-admin.controller.js
 *
 * MULTI-EMPRESA: Todas las operaciones filtran por req.usuario.id_empresa.
 *
 * Endpoints:
 *   GET  /api/admin/modulos              → Lista todos los módulos (catálogo)
 *   GET  /api/admin/modulos/matriz       → Matriz completa roles x módulos
 *   GET  /api/admin/modulos/rol/:rol     → Módulos de un rol específico
 *   PUT  /api/admin/modulos/rol/:rol     → Guardar asignación de un rol
 *   POST /api/admin/modulos/rol/:rol/clonar → Clonar desde otro rol
 */

const modulosHelper = require('../utils/modulos.helper');
const adminHelper = require('../utils/admin.helper');

module.exports = {

    /**
     * GET /api/admin/modulos
     * Lista todos los módulos del catálogo (compartido, sin empresa)
     */
    async listarModulos(req, res) {
        try {
            const modulos = await modulosHelper.obtenerTodosLosModulos();
            res.json(modulos);
        } catch (error) {
            console.error('❌ Error al listar módulos:', error.message);
            res.status(500).json({ error: 'Error al listar módulos' });
        }
    },

    /**
     * GET /api/admin/modulos/matriz
     * Retorna la matriz completa: todos los roles con todos los módulos de esta empresa
     */
    async obtenerMatriz(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const matriz = await modulosHelper.obtenerMatrizPermisos(id_empresa);
            res.json(matriz);
        } catch (error) {
            console.error('❌ Error al obtener matriz:', error.message);
            res.status(500).json({ error: 'Error al obtener matriz de permisos' });
        }
    },

    /**
     * GET /api/admin/modulos/rol/:rol
     * Módulos de un rol específico en esta empresa
     */
    async obtenerModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { id_empresa } = req.usuario;
            const modulos = await modulosHelper.obtenerModulosDeRol(id_empresa, rol);
            res.json(modulos);
        } catch (error) {
            console.error('❌ Error al obtener módulos del rol:', error.message);
            res.status(500).json({ error: 'Error al obtener módulos del rol' });
        }
    },

    /**
     * PUT /api/admin/modulos/rol/:rol
     * Guardar asignación completa de módulos para un rol en esta empresa
     * Body: { modulos: [{ id_modulo, puede_ver, solo_lectura }] }
     */
    async guardarModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { modulos } = req.body;
            const { id_usuario, id_empresa } = req.usuario;

            if (!modulos || !Array.isArray(modulos)) {
                return res.status(400).json({ error: 'Se requiere array de módulos' });
            }

            const resultado = await modulosHelper.guardarModulosRol(id_empresa, rol, modulos, id_usuario, req.ip);

            res.json({
                message: `Módulos actualizados para rol "${rol}"`,
                modulos_asignados: resultado.modulos_asignados
            });

        } catch (error) {
            console.error('❌ Error al guardar módulos del rol:', error.message);
            res.status(500).json({ error: 'Error al guardar módulos del rol' });
        }
    },

    /**
     * POST /api/admin/modulos/rol/:rol/clonar
     * Clonar módulos de otro rol dentro de esta empresa
     * Body: { rol_origen: 'admin' }
     */
    async clonarModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { rol_origen } = req.body;
            const { id_usuario, id_empresa } = req.usuario;

            if (!rol_origen) {
                return res.status(400).json({ error: 'Se requiere rol_origen' });
            }

            if (rol === rol_origen) {
                return res.status(400).json({ error: 'No se puede clonar un rol a sí mismo' });
            }

            const resultado = await modulosHelper.clonarPermisosRol(id_empresa, rol_origen, rol, id_usuario, req.ip);

            res.json({
                message: `Módulos clonados de "${rol_origen}" a "${rol}"`,
                modulos_clonados: resultado.modulos_clonados
            });

        } catch (error) {
            console.error('❌ Error al clonar módulos:', error.message);
            res.status(500).json({ error: 'Error al clonar módulos' });
        }
    }
};
