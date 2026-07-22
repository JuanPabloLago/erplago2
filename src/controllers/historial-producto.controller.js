'use strict';

/**
 * historial-producto.controller.js — endpoint linea de tiempo
 *
 * GET /api/historial-producto/:id_producto
 *   ?desde=YYYY-MM-DD &hasta=YYYY-MM-DD &tipos=A,B,C &id_deposito=N &limit=N &offset=N
 *
 * Toda logica delegada a historial-producto.helper.js
 * Creado: 2026-05-04 (Fase 1 trazabilidad)
 */

const pool = require('../config/database');
const helper = require('../utils/historial-producto.helper');

const historialProductoController = {

    /**
     * GET /api/historial-producto/:id_producto
     */
    async obtener(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id_producto = parseInt(req.params.id_producto);

            if (!id_producto || isNaN(id_producto)) {
                return res.status(400).json({ error: 'id_producto invalido' });
            }

            const {
                desde = null,
                hasta = null,
                tipos = null,
                id_deposito = null,
                limit = 100,
                offset = 0
            } = req.query;

            // tipos puede venir como CSV "VENTA,COMPRA" o como array
            let tiposArr = null;
            if (tipos) {
                tiposArr = Array.isArray(tipos)
                    ? tipos
                    : String(tipos).split(',').map(s => s.trim()).filter(Boolean);
                if (tiposArr.length === 0) tiposArr = null;
            }

            const resultado = await helper.obtenerLineaTiempo(pool, {
                id_empresa,
                id_producto,
                fecha_desde: desde,
                fecha_hasta: hasta,
                tipos: tiposArr,
                id_deposito: id_deposito ? parseInt(id_deposito) : null,
                limit: parseInt(limit),
                offset: parseInt(offset)
            });

            res.json(resultado);
        } catch (err) {
            console.error('[historial-producto.controller] error:', err.message);
            res.status(err.statusCode || 500).json({
                error: err.message || 'Error al obtener historial del producto'
            });
        }
    }
};

module.exports = historialProductoController;
