/**
 * reportes.controller.js - ERP LAGO
 * 
 * Controller para Dashboard y Reportes.
 * Dashboard → dashboard.helper.js
 * Reportes  → reportes.helper.js
 */

const dashboardHelper = require('../utils/dashboard.helper');
const reportesHelper = require('../utils/reportes.helper');

const reportesController = {

    // ========================================================================
    // DASHBOARD
    // ========================================================================

    async dashboard(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const data = await dashboardHelper.obtenerDashboardCompleto(id_empresa);
            res.json(data);
        } catch (error) {
            console.error('Error en dashboard:', error);
            res.status(500).json({ error: 'Error al cargar dashboard' });
        }
    },

    async stockBajo(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const limite = parseInt(req.query.limite) || 100;
            const resultado = await dashboardHelper.obtenerStockCritico(id_empresa, limite);
            res.json(resultado);
        } catch (error) {
            console.error('Error en stockBajo:', error);
            res.status(500).json({ error: 'Error al obtener stock bajo' });
        }
    },

    // ========================================================================
    // FILTROS (combos para el frontend)
    // ========================================================================

    async filtros(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const data = await reportesHelper.obtenerFiltros(id_empresa);
            res.json(data);
        } catch (error) {
            console.error('Error en filtros:', error);
            res.status(500).json({ error: 'Error al cargar filtros' });
        }
    },

    // ========================================================================
    // REPORTES
    // ========================================================================

    async ventasPeriodo(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { desde, hasta, vendedor, forma_pago } = req.query;
            if (!desde || !hasta) return res.status(400).json({ error: 'Falta desde/hasta' });

            const data = await reportesHelper.ventasPorPeriodo(id_empresa, {
                desde, hasta,
                id_vendedor: vendedor || null,
                id_forma_pago: forma_pago || null
            });
            res.json(data);
        } catch (error) {
            console.error('Error en ventasPeriodo:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    },

    async rankingProductos(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { desde, hasta, limite, orden } = req.query;
            if (!desde || !hasta) return res.status(400).json({ error: 'Falta desde/hasta' });

            const data = await reportesHelper.rankingProductos(id_empresa, {
                desde, hasta,
                limite: limite || 50,
                orden: orden || 'cantidad'
            });
            res.json(data);
        } catch (error) {
            console.error('Error en rankingProductos:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    },

    async ventasCategoria(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { desde, hasta } = req.query;
            if (!desde || !hasta) return res.status(400).json({ error: 'Falta desde/hasta' });

            const data = await reportesHelper.ventasPorCategoria(id_empresa, { desde, hasta });
            res.json(data);
        } catch (error) {
            console.error('Error en ventasCategoria:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    },

    async ventasVendedor(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { desde, hasta } = req.query;
            if (!desde || !hasta) return res.status(400).json({ error: 'Falta desde/hasta' });

            const data = await reportesHelper.ventasPorVendedor(id_empresa, { desde, hasta });
            res.json(data);
        } catch (error) {
            console.error('Error en ventasVendedor:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    },

    async ventasFormaPago(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { desde, hasta } = req.query;
            if (!desde || !hasta) return res.status(400).json({ error: 'Falta desde/hasta' });

            const data = await reportesHelper.ventasPorFormaPago(id_empresa, { desde, hasta });
            res.json(data);
        } catch (error) {
            console.error('Error en ventasFormaPago:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    },

    async stockValorizado(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { categoria, subcategoria, con_stock } = req.query;

            const data = await reportesHelper.stockValorizado(id_empresa, {
                id_categoria: categoria || null,
                id_subcategoria: subcategoria || null, // Bloque 7.3a
                solo_con_stock: con_stock !== 'false'
            });
            res.json(data);
        } catch (error) {
            console.error('Error en stockValorizado:', error);
            res.status(500).json({ error: 'Error al generar reporte' });
        }
    }
};

module.exports = reportesController;
