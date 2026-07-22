/**
 * reportes.helper.js - ERP LAGO
 * 
 * Helper centralizado para módulo Reportes.
 * Queries de análisis con filtros dinámicos.
 * 
 * TABLAS (solo lectura):
 *   pedidos, pedidoitems, productos, categorias, usuarios,
 *   formas_pago, inventario, comprobantes_compra, comprobante_compra_items,
 *   cuentacorrienteclientes, clientes
 * 
 * CONSUMIDORES: reportes.controller.js
 */

const pool = require('../config/db');

const ESTADOS_VENTA = [2, 3, 4, 5, 6];

// ============================================================================
// 1. VENTAS POR PERÍODO
// ============================================================================

async function ventasPorPeriodo(id_empresa, { desde, hasta, id_vendedor, id_forma_pago }) {
    let params = [id_empresa, ESTADOS_VENTA, desde, hasta];
    let filtros = '';
    let idx = 5;

    if (id_vendedor) {
        filtros += ` AND p.id_usuario = $${idx}`;
        params.push(parseInt(id_vendedor));
        idx++;
    }
    if (id_forma_pago) {
        filtros += ` AND p.id_forma_pago_principal = $${idx}`;
        params.push(parseInt(id_forma_pago));
        idx++;
    }

    const { rows } = await pool.query(`
        SELECT
            p.fecha_creacion::date AS fecha,
            COUNT(*)::int AS cantidad_pedidos,
            COALESCE(SUM(COALESCE(p.total_final, p.total)), 0) AS monto_total,
            COALESCE(SUM(p.subtotal_sin_iva), 0) AS subtotal,
            COALESCE(SUM(p.total_iva), 0) AS iva,
            COALESCE(SUM(p.descuento_monto), 0) AS descuentos
        FROM pedidos p
        WHERE p.id_empresa = $1
          AND p.id_estado = ANY($2)
          AND p.fecha_creacion::date >= $3
          AND p.fecha_creacion::date <= $4
          ${filtros}
        GROUP BY p.fecha_creacion::date
        ORDER BY p.fecha_creacion::date DESC
    `, params);

    // Totales
    const totales = rows.reduce((acc, r) => ({
        cantidad_pedidos: acc.cantidad_pedidos + r.cantidad_pedidos,
        monto_total: acc.monto_total + parseFloat(r.monto_total),
        subtotal: acc.subtotal + parseFloat(r.subtotal),
        iva: acc.iva + parseFloat(r.iva),
        descuentos: acc.descuentos + parseFloat(r.descuentos)
    }), { cantidad_pedidos: 0, monto_total: 0, subtotal: 0, iva: 0, descuentos: 0 });

    return { filas: rows, totales };
}

// ============================================================================
// 2. RANKING PRODUCTOS
// ============================================================================

async function rankingProductos(id_empresa, { desde, hasta, limite = 50, orden = 'cantidad' }) {
    const orderCol = orden === 'monto' ? 'total_vendido' : 'cantidad_vendida';

    const { rows } = await pool.query(`
        SELECT
            pr.id_producto, pr.sku, pr.nombre, pr.unidad_medida,
            c.nombre AS categoria,
            SUM(pi.cantidad)::numeric AS cantidad_vendida,
            SUM(pi.total_linea)::numeric AS total_vendido,
            COUNT(DISTINCT ped.id_pedido)::int AS en_pedidos
        FROM pedidoitems pi
        JOIN pedidos ped ON ped.id_pedido = pi.id_pedido AND ped.id_empresa = pi.id_empresa
        JOIN productos pr ON pr.id_producto = pi.id_producto
        LEFT JOIN categorias c ON c.id_categoria = pr.id_categoria
        WHERE ped.id_empresa = $1
          AND ped.id_estado = ANY($2)
          AND ped.fecha_creacion::date >= $3
          AND ped.fecha_creacion::date <= $4
        GROUP BY pr.id_producto, pr.sku, pr.nombre, pr.unidad_medida, c.nombre
        ORDER BY ${orderCol} DESC
        LIMIT $5
    `, [id_empresa, ESTADOS_VENTA, desde, hasta, parseInt(limite)]);

    return rows;
}

// ============================================================================
// 3. VENTAS POR CATEGORÍA
// ============================================================================

async function ventasPorCategoria(id_empresa, { desde, hasta }) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(c.nombre, 'Sin categoría') AS categoria,
            c.id_categoria,
            COUNT(DISTINCT ped.id_pedido)::int AS pedidos,
            SUM(pi.cantidad)::numeric AS unidades,
            SUM(pi.total_linea)::numeric AS monto
        FROM pedidoitems pi
        JOIN pedidos ped ON ped.id_pedido = pi.id_pedido AND ped.id_empresa = pi.id_empresa
        JOIN productos pr ON pr.id_producto = pi.id_producto
        LEFT JOIN categorias c ON c.id_categoria = pr.id_categoria
        WHERE ped.id_empresa = $1
          AND ped.id_estado = ANY($2)
          AND ped.fecha_creacion::date >= $3
          AND ped.fecha_creacion::date <= $4
        GROUP BY c.id_categoria, c.nombre
        ORDER BY monto DESC
    `, [id_empresa, ESTADOS_VENTA, desde, hasta]);

    const total_monto = rows.reduce((s, r) => s + parseFloat(r.monto), 0);
    const filas = rows.map(r => ({
        ...r,
        porcentaje: total_monto > 0 ? ((parseFloat(r.monto) / total_monto) * 100).toFixed(1) : 0
    }));

    return { filas, total_monto };
}

// ============================================================================
// 4. VENTAS POR VENDEDOR
// ============================================================================

async function ventasPorVendedor(id_empresa, { desde, hasta }) {
    const { rows } = await pool.query(`
        SELECT
            u.id_usuario, u.nombre AS vendedor,
            COUNT(*)::int AS cantidad_pedidos,
            COALESCE(SUM(COALESCE(p.total_final, p.total)), 0) AS monto_total,
            ROUND(AVG(COALESCE(p.total_final, p.total)), 2) AS ticket_promedio
        FROM pedidos p
        JOIN usuarios u ON u.id_usuario = p.id_usuario
        WHERE p.id_empresa = $1
          AND p.id_estado = ANY($2)
          AND p.fecha_creacion::date >= $3
          AND p.fecha_creacion::date <= $4
        GROUP BY u.id_usuario, u.nombre
        ORDER BY monto_total DESC
    `, [id_empresa, ESTADOS_VENTA, desde, hasta]);

    const total_monto = rows.reduce((s, r) => s + parseFloat(r.monto_total), 0);
    const filas = rows.map(r => ({
        ...r,
        porcentaje: total_monto > 0 ? ((parseFloat(r.monto_total) / total_monto) * 100).toFixed(1) : 0
    }));

    return { filas, total_monto };
}

// ============================================================================
// 5. VENTAS POR FORMA DE PAGO
// ============================================================================

async function ventasPorFormaPago(id_empresa, { desde, hasta }) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(fp.nombre, 'Sin asignar') AS forma_pago,
            fp.id_forma_pago,
            COUNT(*)::int AS cantidad_pedidos,
            COALESCE(SUM(COALESCE(p.total_final, p.total)), 0) AS monto_total
        FROM pedidos p
        LEFT JOIN formas_pago fp ON fp.id_forma_pago = p.id_forma_pago_principal
            AND fp.id_empresa = p.id_empresa
        WHERE p.id_empresa = $1
          AND p.id_estado = ANY($2)
          AND p.fecha_creacion::date >= $3
          AND p.fecha_creacion::date <= $4
        GROUP BY fp.id_forma_pago, fp.nombre
        ORDER BY monto_total DESC
    `, [id_empresa, ESTADOS_VENTA, desde, hasta]);

    const total_monto = rows.reduce((s, r) => s + parseFloat(r.monto_total), 0);
    const filas = rows.map(r => ({
        ...r,
        porcentaje: total_monto > 0 ? ((parseFloat(r.monto_total) / total_monto) * 100).toFixed(1) : 0
    }));

    return { filas, total_monto };
}

// ============================================================================
// 6. STOCK VALORIZADO
// ============================================================================

async function stockValorizado(id_empresa, { id_categoria, id_subcategoria, solo_con_stock = true }) {
    let filtros = '';
    let params = [id_empresa];
    let idx = 2;

    if (solo_con_stock) {
        filtros += ' AND i.stock_real > 0';
    }
    if (id_categoria) {
        filtros += ` AND pr.id_categoria = $${idx}`;
        params.push(parseInt(id_categoria));
        idx++;
    }
    if (id_subcategoria) {
        // Bloque 7.3a: filtro adicional contra el segundo slot independiente del catalogo plano
        filtros += ` AND pr.id_subcategoria = $${idx}`;
        params.push(parseInt(id_subcategoria));
        idx++;
    }

    const { rows } = await pool.query(`
        SELECT
            pr.id_producto, pr.sku, pr.nombre, pr.unidad_medida,
            COALESCE(c.nombre, 'Sin categoría') AS categoria,
            i.stock_real,
            COALESCE(uc.costo_unitario, 0) AS costo_unitario,
            (i.stock_real * COALESCE(uc.costo_unitario, 0)) AS valor_stock
        FROM inventario i
        JOIN productos pr ON pr.id_producto = i.id_producto
        LEFT JOIN categorias c ON c.id_categoria = pr.id_categoria
        LEFT JOIN LATERAL (
            SELECT cci.precio_unitario AS costo_unitario
            FROM comprobante_compra_items cci
            JOIN comprobantes_compra cc ON cc.id_comprobante = cci.id_comprobante
                AND cc.id_empresa = cci.id_empresa
            WHERE cc.id_empresa = i.id_empresa
              AND cci.id_producto = i.id_producto
            ORDER BY cc.fecha_emision DESC, cc.id_comprobante DESC
            LIMIT 1
        ) uc ON true
        WHERE i.id_empresa = $1
          AND pr.activo = true
          ${filtros}
        ORDER BY valor_stock DESC
    `, params);

    const totales = rows.reduce((acc, r) => ({
        items: acc.items + 1,
        unidades: acc.unidades + parseInt(r.stock_real),
        valor_total: acc.valor_total + parseFloat(r.valor_stock)
    }), { items: 0, unidades: 0, valor_total: 0 });

    return { filas: rows, totales };
}

// ============================================================================
// DATOS PARA FILTROS (combos del frontend)
// ============================================================================

async function obtenerFiltros(id_empresa) {
    const [vendedores, formasPago, categorias] = await Promise.all([
        pool.query(`
            SELECT id_usuario, nombre FROM usuarios
            WHERE id_empresa = $1 AND estado = 'activo'
            ORDER BY nombre
        `, [id_empresa]),
        pool.query(`
            SELECT id_forma_pago, nombre FROM formas_pago
            WHERE id_empresa = $1 AND activo = true
            ORDER BY nombre
        `, [id_empresa]),
        pool.query(`
            SELECT id_categoria, nombre FROM categorias
            WHERE activo = true
            ORDER BY nombre
        `)
    ]);

    return {
        vendedores: vendedores.rows,
        formas_pago: formasPago.rows,
        categorias: categorias.rows
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    ventasPorPeriodo,
    rankingProductos,
    ventasPorCategoria,
    ventasPorVendedor,
    ventasPorFormaPago,
    stockValorizado,
    obtenerFiltros,
    ESTADOS_VENTA
};
