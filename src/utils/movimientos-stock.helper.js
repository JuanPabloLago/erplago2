'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * movimientos-stock.helper.js — Helper centralizado para CONSULTA de movimientos
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TABLAS QUE LEE (solo SELECT, nunca escribe):
 *   - movimientos_stock_deposito  (fuente principal — tiene deposito)
 *   - movimientos_stock           (fallback para movimientos sin deposito)
 *
 * NOTA: La escritura de movimientos la hace stock.helper.moverStock()
 *       Este helper es SOLO para consulta/reportes/historial.
 *
 * Consumidores:
 *   - movimientos-stock.controller.js
 *
 * Creado: 2026-03-27
 * ═══════════════════════════════════════════════════════════════════════
 */

const excelHelper = require('./excel.helper');

/**
 * Consultar movimientos de stock con filtros avanzados.
 *
 * @param {Object} client - Pool o client PG
 * @param {Object} filtros
 * @param {number} filtros.id_empresa        - OBLIGATORIO
 * @param {number} [filtros.id_deposito]
 * @param {number} [filtros.id_producto]
 * @param {string} [filtros.tipo_movimiento]
 * @param {number} [filtros.id_usuario]
 * @param {string} [filtros.fecha_desde]     - ISO date
 * @param {string} [filtros.fecha_hasta]     - ISO date
 * @param {string} [filtros.documento_ref]   - busqueda parcial
 * @param {string} [filtros.q]              - busqueda libre (producto, observaciones, doc)
 * @param {number} [filtros.limit=50]
 * @param {number} [filtros.offset=0]
 * @returns {Object} { data, total, totales }
 */
async function consultar(client, filtros) {
    const {
        id_empresa,
        id_deposito,
        id_producto,
        tipo_movimiento,
        id_usuario,
        fecha_desde,
        fecha_hasta,
        documento_ref,
        q,
        limit = 50,
        offset = 0
    } = filtros;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);

    const condiciones = ['msd.id_empresa = $1'];
    const params = [id_empresa];
    let idx = 2;

    if (id_deposito) {
        condiciones.push(`msd.id_deposito = $${idx++}`);
        params.push(parseInt(id_deposito));
    }
    if (id_producto) {
        condiciones.push(`msd.id_producto = $${idx++}`);
        params.push(parseInt(id_producto));
    }
    if (tipo_movimiento && tipo_movimiento !== 'todos') {
        condiciones.push(`msd.tipo_movimiento = $${idx++}`);
        params.push(tipo_movimiento);
    }
    if (id_usuario) {
        condiciones.push(`msd.id_usuario = $${idx++}`);
        params.push(parseInt(id_usuario));
    }
    if (fecha_desde) {
        condiciones.push(`msd.created_at >= $${idx++}`);
        params.push(fecha_desde);
    }
    if (fecha_hasta) {
        condiciones.push(`msd.created_at <= ($${idx++}::date + interval '1 day')`);
        params.push(fecha_hasta);
    }
    if (documento_ref) {
        condiciones.push(`ms.documento_referencia ILIKE $${idx++}`);
        params.push('%' + documento_ref + '%');
    }
    if (q) {
        condiciones.push(`(
            p.nombre ILIKE $${idx} OR p.sku ILIKE $${idx}
            OR msd.observaciones ILIKE $${idx}
            OR ms.documento_referencia ILIKE $${idx}
        )`);
        params.push('%' + q + '%');
        idx++;
    }

    const where = condiciones.join(' AND ');

    // Query principal
    const dataParams = [...params, parseInt(limit), parseInt(offset)];
    const dataQuery = `
        SELECT
            msd.id_movimiento,
            msd.created_at as fecha,
            msd.tipo_movimiento,
            msd.cantidad,
            msd.stock_anterior,
            msd.stock_posterior,
            msd.comprometido_anterior,
            msd.comprometido_posterior,
            msd.observaciones,
            msd.id_producto,
            p.sku,
            p.nombre as producto_nombre,
            msd.id_deposito,
            d.nombre as deposito_nombre,
            d.codigo as deposito_codigo,
            msd.id_usuario,
            u.nombre as usuario_nombre,
            msd.id_remito,
            msd.id_pedido,
            ms.documento_referencia
        FROM movimientos_stock_deposito msd
        JOIN productos p ON msd.id_producto = p.id_producto
        JOIN depositos d ON msd.id_deposito = d.id_deposito
        LEFT JOIN usuarios u ON msd.id_usuario = u.id_usuario
        LEFT JOIN LATERAL (
            SELECT ms2.documento_referencia
            FROM movimientos_stock ms2
            WHERE ms2.id_empresa = msd.id_empresa
              AND ms2.id_producto = msd.id_producto
              AND ms2.tipo_movimiento = msd.tipo_movimiento
              AND ms2.fecha_movimiento::date = msd.created_at::date
              AND ms2.diferencia = msd.cantidad
            LIMIT 1
        ) ms ON true
        WHERE ${where}
        ORDER BY msd.created_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
    `;

    const { rows: data } = await client.query(dataQuery, dataParams);

    // Count total
    const countQuery = `
        SELECT COUNT(*) as total
        FROM movimientos_stock_deposito msd
        JOIN productos p ON msd.id_producto = p.id_producto
        WHERE ${where}
    `;
    const countResult = await client.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Totales agregados
    const totalesQuery = `
        SELECT
            COALESCE(SUM(CASE WHEN msd.cantidad > 0 THEN msd.cantidad ELSE 0 END), 0) as total_entradas,
            COALESCE(SUM(CASE WHEN msd.cantidad < 0 THEN ABS(msd.cantidad) ELSE 0 END), 0) as total_salidas,
            COUNT(DISTINCT msd.id_producto) as productos_afectados
        FROM movimientos_stock_deposito msd
        JOIN productos p ON msd.id_producto = p.id_producto
        WHERE ${where}
    `;
    const totalesResult = await client.query(totalesQuery, params);

    return {
        data,
        total,
        totales: {
            entradas: parseFloat(totalesResult.rows[0].total_entradas),
            salidas: parseFloat(totalesResult.rows[0].total_salidas),
            productos_afectados: parseInt(totalesResult.rows[0].productos_afectados)
        }
    };
}


/**
 * Exportar movimientos a buffer Excel.
 */
async function exportarExcel(client, filtros) {
    // Sin paginacion para export
    const resultado = await consultar(client, { ...filtros, limit: 50000, offset: 0 });

    const buffer = await excelHelper.exportar({
        sheetName: 'Movimientos Stock',
        columns: [
            { header: 'Fecha', key: 'fecha', width: 18 },
            { header: 'Tipo', key: 'tipo_movimiento', width: 22 },
            { header: 'SKU', key: 'sku', width: 15 },
            { header: 'Producto', key: 'producto_nombre', width: 40 },
            { header: 'Deposito', key: 'deposito_nombre', width: 20 },
            { header: 'Cantidad', key: 'cantidad', width: 12 },
            { header: 'Stock Ant.', key: 'stock_anterior', width: 12 },
            { header: 'Stock Post.', key: 'stock_posterior', width: 12 },
            { header: 'Documento', key: 'documento_referencia', width: 20 },
            { header: 'Usuario', key: 'usuario_nombre', width: 18 },
            { header: 'Observaciones', key: 'observaciones', width: 35 }
        ],
        rows: resultado.data.map(r => ({
            fecha: r.fecha ? new Date(r.fecha).toLocaleString('es-AR') : '',
            tipo_movimiento: r.tipo_movimiento,
            sku: r.sku,
            producto_nombre: r.producto_nombre,
            deposito_nombre: r.deposito_nombre,
            cantidad: parseFloat(r.cantidad),
            stock_anterior: r.stock_anterior != null ? parseFloat(r.stock_anterior) : '',
            stock_posterior: r.stock_posterior != null ? parseFloat(r.stock_posterior) : '',
            documento_referencia: r.documento_referencia || '',
            usuario_nombre: r.usuario_nombre || '',
            observaciones: r.observaciones || ''
        }))
    });

    return { buffer, total: resultado.total };
}


/**
 * Obtener tipos de movimiento distintos (para filtro frontend).
 */
async function obtenerTipos(client, id_empresa) {
    const { rows } = await client.query(`
        SELECT DISTINCT tipo_movimiento, COUNT(*) as qty
        FROM movimientos_stock_deposito
        WHERE id_empresa = $1
        GROUP BY tipo_movimiento
        ORDER BY qty DESC
    `, [id_empresa]);
    return rows;
}


// ─── UTILIDAD ───────────────────────────────────────────────────
function _error(msg, code) {
    const e = new Error(msg);
    e.statusCode = code;
    return e;
}


module.exports = {
    consultar,
    exportarExcel,
    obtenerTipos
};
