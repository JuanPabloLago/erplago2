const pool = require('../config/database');
const movHelper = require('../utils/movimientos-stock.helper');
const excelHelper = require('../utils/excel.helper');

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MOVIMIENTOS STOCK CONTROLLER - ERP LAGO
 * ═══════════════════════════════════════════════════════════════════════
 * Historial de movimientos de stock con filtros avanzados.
 * Toda logica delegada a movimientos-stock.helper.js
 * Creado: 2026-03-27
 * ═══════════════════════════════════════════════════════════════════════
 */

const movimientosStockController = {

    /**
     * GET /api/movimientos-stock
     * Consultar movimientos con filtros y paginacion.
     */
    async consultar(req, res) {
        const { id_empresa } = req.usuario;
        const {
            id_deposito, id_producto, tipo_movimiento, id_usuario,
            fecha_desde, fecha_hasta, documento_ref, q,
            limit = 50, offset = 0
        } = req.query;

        try {
            const resultado = await movHelper.consultar(pool, {
                id_empresa, id_deposito, id_producto,
                tipo_movimiento, id_usuario,
                fecha_desde, fecha_hasta, documento_ref, q,
                limit: parseInt(limit), offset: parseInt(offset)
            });

            res.json({
                success: true,
                ...resultado
            });
        } catch (error) {
            console.error('Error al consultar movimientos:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al consultar movimientos' });
        }
    },

    /**
     * GET /api/movimientos-stock/exportar
     * Exportar movimientos a Excel.
     */
    async exportar(req, res) {
        const { id_empresa } = req.usuario;
        const {
            id_deposito, id_producto, tipo_movimiento, id_usuario,
            fecha_desde, fecha_hasta, documento_ref, q
        } = req.query;

        try {
            const { buffer, total } = await movHelper.exportarExcel(pool, {
                id_empresa, id_deposito, id_producto,
                tipo_movimiento, id_usuario,
                fecha_desde, fecha_hasta, documento_ref, q
            });

            const filename = `movimientos_stock_${new Date().toISOString().slice(0, 10)}.xlsx`;
            excelHelper.enviar(res, buffer, filename);
        } catch (error) {
            console.error('Error al exportar movimientos:', error.message);
            res.status(500).json({ error: 'Error al exportar movimientos' });
        }
    },

    /**
     * GET /api/movimientos-stock/tipos
     * Tipos de movimiento disponibles (para select del frontend).
     */
    async tipos(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const tipos = await movHelper.obtenerTipos(pool, id_empresa);
            res.json(tipos);
        } catch (error) {
            console.error('Error al obtener tipos:', error.message);
            res.status(500).json({ error: 'Error al obtener tipos de movimiento' });
        }
    },

    /**
     * GET /api/movimientos-stock/form-data
     * Datos para filtros del frontend (depositos, usuarios, tipos).
     */
    async formData(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const [depositos, tipos, usuarios] = await Promise.all([
                pool.query(
                    'SELECT id_deposito, nombre, codigo FROM depositos WHERE id_empresa = $1 AND activo = true ORDER BY es_principal DESC, nombre',
                    [id_empresa]
                ),
                movHelper.obtenerTipos(pool, id_empresa),
                pool.query(
                    'SELECT id_usuario, nombre FROM usuarios WHERE id_empresa = $1 AND estado = $2 ORDER BY nombre',
                    [id_empresa, 'activo']
                )
            ]);

            res.json({
                depositos: depositos.rows,
                tipos,
                usuarios: usuarios.rows
            });
        } catch (error) {
            console.error('Error al cargar form-data:', error.message);
            res.status(500).json({ error: 'Error al cargar datos del formulario' });
        }
    }
};

module.exports = movimientosStockController;
