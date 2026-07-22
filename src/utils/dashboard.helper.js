/**
 * dashboard.helper.js - ERP LAGO
 * 
 * Helper centralizado para el Dashboard.
 * Todas las queries de KPIs, alertas y gráficos.
 * 
 * TABLAS QUE TOCA (solo lectura):
 *   pedidos, pedidoitems, turnos_caja, movimientos_caja, cajas,
 *   recibos, inventario, productos, cuentacorrienteclientes, clientes,
 *   confirmaciones_pago
 * 
 * CONSUMIDORES: reportes.controller.js
 */

const pool = require('../config/db');

// ============================================================================
// CONSTANTES
// ============================================================================

const ESTADOS_VENTA = [2, 3, 4, 5, 6]; // Confirmado → Entregado
const ESTADOS_PENDIENTES_DESPACHO = [1, 2, 4]; // Pendiente, Confirmado, En Preparación
const ESTADOS_SIN_FACTURAR = [2, 4, 5, 6]; // Confirmado+ pero NO facturado (3)

// ============================================================================
// KPIs PRINCIPALES
// ============================================================================

/**
 * Ventas del día: monto, cantidad, ticket promedio
 */
async function obtenerVentasHoy(id_empresa) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(SUM(COALESCE(total_final, total)), 0) AS monto,
            COUNT(*)::int AS cantidad,
            CASE WHEN COUNT(*) > 0 
                 THEN ROUND(COALESCE(SUM(COALESCE(total_final, total)), 0) / COUNT(*), 2)
                 ELSE 0 END AS ticket_promedio
        FROM pedidos
        WHERE id_empresa = $1
          AND id_estado = ANY($2)
          AND fecha_creacion::date = CURRENT_DATE
    `, [id_empresa, ESTADOS_VENTA]);
    return rows[0];
}

/**
 * Ventas del mes: monto, cantidad
 */
async function obtenerVentasMes(id_empresa) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(SUM(COALESCE(total_final, total)), 0) AS monto,
            COUNT(*)::int AS cantidad
        FROM pedidos
        WHERE id_empresa = $1
          AND id_estado = ANY($2)
          AND DATE_TRUNC('month', fecha_creacion) = DATE_TRUNC('month', CURRENT_DATE)
    `, [id_empresa, ESTADOS_VENTA]);
    return rows[0];
}

/**
 * Estado de caja: turno abierto, saldo calculado
 */
async function obtenerEstadoCaja(id_empresa) {
    // Buscar turno abierto
    const { rows: turnoRows } = await pool.query(`
        SELECT tc.id_turno, tc.id_caja, c.nombre AS nombre_caja,
               tc.fecha_apertura, tc.monto_inicial_ars
        FROM turnos_caja tc
        JOIN cajas c ON c.id_caja = tc.id_caja AND c.id_empresa = tc.id_empresa
        WHERE tc.id_empresa = $1 AND tc.estado = 'abierto'
        ORDER BY tc.fecha_apertura DESC
        LIMIT 1
    `, [id_empresa]);

    if (turnoRows.length === 0) {
        return { abierta: false, id_turno: null, nombre_caja: null, saldo_ars: 0 };
    }

    const turno = turnoRows[0];

    // Calcular saldo del turno
    const { rows: saldoRows } = await pool.query(`
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND id_moneda = 1 THEN monto ELSE 0 END), 0) AS ingresos,
            COALESCE(SUM(CASE WHEN tipo = 'egreso'  AND id_moneda = 1 THEN monto ELSE 0 END), 0) AS egresos
        FROM movimientos_caja
        WHERE id_turno = $1 AND id_empresa = $2
    `, [turno.id_turno, id_empresa]);

    const saldo = parseFloat(turno.monto_inicial_ars)
        + parseFloat(saldoRows[0].ingresos)
        - parseFloat(saldoRows[0].egresos);

    return {
        abierta: true,
        id_turno: turno.id_turno,
        nombre_caja: turno.nombre_caja,
        fecha_apertura: turno.fecha_apertura,
        saldo_ars: saldo
    };
}

/**
 * Cobranzas del día: total cobrado, cantidad recibos
 */
async function obtenerCobranzasHoy(id_empresa) {
    const { rows } = await pool.query(`
        SELECT
            COALESCE(SUM(total_recibo), 0) AS monto,
            COUNT(*)::int AS cantidad
        FROM recibos
        WHERE id_empresa = $1
          AND tipo = 'cobro'
          AND fecha_recibo::date = CURRENT_DATE
    `, [id_empresa]);
    return rows[0];
}

/**
 * Pedidos pendientes: despacho y facturación
 */
async function obtenerPedidosPendientes(id_empresa) {
    // Pendientes de despacho (confirmados pero no enviados/entregados)
    const { rows: despRows } = await pool.query(`
        SELECT COUNT(*)::int AS cantidad,
               COALESCE(SUM(COALESCE(total_final, total)), 0) AS monto
        FROM pedidos
        WHERE id_empresa = $1
          AND id_estado = ANY($2)
          AND estado_entrega = 'pendiente'
    `, [id_empresa, ESTADOS_PENDIENTES_DESPACHO]);

    // Pendientes de facturar (confirmados+ pero NO facturado)
    const { rows: facRows } = await pool.query(`
        SELECT COUNT(*)::int AS cantidad
        FROM pedidos
        WHERE id_empresa = $1
          AND id_estado = ANY($2)
    `, [id_empresa, ESTADOS_SIN_FACTURAR]);

    return {
        despacho: despRows[0],
        facturacion: { cantidad: facRows[0].cantidad }
    };
}

// ============================================================================
// ALERTAS Y LISTAS
// ============================================================================

/**
 * Stock crítico: productos bajo mínimo o sin stock
 */
async function obtenerStockCritico(id_empresa, limite = 10) {
    const { rows } = await pool.query(`
        SELECT
            p.id_producto, p.sku, p.nombre, p.unidad_medida,
            i.stock_real, i.stock_minimo,
            CASE
                WHEN i.stock_real <= 0 THEN 'SIN_STOCK'
                ELSE 'BAJO_MINIMO'
            END AS nivel
        FROM inventario i
        JOIN productos p ON p.id_producto = i.id_producto
        WHERE i.id_empresa = $1
          AND i.stock_real <= i.stock_minimo
          AND i.stock_minimo > 0
          AND p.activo = true
        ORDER BY i.stock_real ASC, p.nombre ASC
        LIMIT $2
    `, [id_empresa, limite]);

    // Contar totales (sin limite)
    const { rows: countRows } = await pool.query(`
        SELECT
            COUNT(*)::int AS total,
            SUM(CASE WHEN i.stock_real <= 0 THEN 1 ELSE 0 END)::int AS sin_stock,
            SUM(CASE WHEN i.stock_real > 0 AND i.stock_real <= i.stock_minimo THEN 1 ELSE 0 END)::int AS bajo_minimo
        FROM inventario i
        JOIN productos p ON p.id_producto = i.id_producto
        WHERE i.id_empresa = $1
          AND i.stock_real <= i.stock_minimo
          AND i.stock_minimo > 0
          AND p.activo = true
    `, [id_empresa]);

    return {
        items: rows,
        totales: countRows[0]
    };
}

/**
 * Top productos vendidos (últimos N días)
 */
async function obtenerTopProductos(id_empresa, dias = 7, limite = 8) {
    // L3.1.fix: agregamos JOIN con alicuotasiva para que el frontend pueda
    // calcular el precio C/IVA correcto sin hardcodear *1.21. Tambien sumamos
    // el precio_lista_default desde la lista de precios configurada para la
    // empresa (config 'venta_rapida.lista_precio_default'), asi los botones
    // muestran el precio real del producto.
    const { rows } = await pool.query(`
        WITH cfg AS (
            SELECT COALESCE((
                SELECT valor::int FROM configuraciones_empresa
                WHERE id_empresa = $1 AND clave = 'venta_rapida.lista_precio_default'
            ), 1) AS lista_default
        )
        SELECT
            p.id_producto, p.nombre, p.sku,
            COUNT(DISTINCT pi.id_pedido) AS veces_vendido,
            SUM(pi.cantidad)::numeric AS cantidad_vendida,
            SUM(pi.total_linea)::numeric AS total_vendido,
            ROUND(SUM(pi.total_linea) / NULLIF(COUNT(DISTINCT pi.id_pedido), 0), 2) AS ticket_promedio,
            COALESCE(a.porcentaje, 0)::numeric AS iva_porcentaje,
            COALESCE(pr.precio, 0)::numeric AS precio
        FROM pedidoitems pi
        JOIN pedidos ped ON ped.id_pedido = pi.id_pedido AND ped.id_empresa = pi.id_empresa
        JOIN productos p ON p.id_producto = pi.id_producto
        LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
        CROSS JOIN cfg
        LEFT JOIN precios pr
               ON pr.id_producto = p.id_producto
              AND pr.id_empresa  = $1
              AND pr.id_lista_precio = cfg.lista_default
        WHERE ped.id_empresa = $1
          AND ped.id_estado = ANY($2)
          AND ped.fecha_creacion >= CURRENT_DATE - ($3 * INTERVAL '1 day')
        GROUP BY p.id_producto, p.nombre, p.sku, a.porcentaje, pr.precio
        ORDER BY veces_vendido DESC, cantidad_vendida DESC
        LIMIT $4
    `, [id_empresa, ESTADOS_VENTA, dias, limite]);
    return rows;
}

/**
 * Top deudores: clientes con mayor saldo en CC
 */
async function obtenerTopDeudores(id_empresa, limite = 5) {
    const { rows } = await pool.query(`
        SELECT
            sub.id_cliente,
            c.razon_social,
            sub.saldo_actual,
            sub.ultima_fecha
        FROM (
            SELECT DISTINCT ON (id_cliente)
                id_cliente, saldo AS saldo_actual, fecha AS ultima_fecha
            FROM cuentacorrienteclientes
            WHERE id_empresa = $1
            ORDER BY id_cliente, fecha DESC, id_movimiento_cc_cliente DESC
        ) sub
        JOIN clientes c ON c.id_cliente = sub.id_cliente
        WHERE sub.saldo_actual > 0
        ORDER BY sub.saldo_actual DESC
        LIMIT $2
    `, [id_empresa, limite]);

    // Total deuda
    const { rows: totalRows } = await pool.query(`
        SELECT COALESCE(SUM(sub.saldo_actual), 0) AS total_deuda
        FROM (
            SELECT DISTINCT ON (id_cliente)
                saldo AS saldo_actual
            FROM cuentacorrienteclientes
            WHERE id_empresa = $1
            ORDER BY id_cliente, fecha DESC, id_movimiento_cc_cliente DESC
        ) sub
        WHERE sub.saldo_actual > 0
    `, [id_empresa]);

    return {
        items: rows,
        total_deuda: totalRows[0].total_deuda
    };
}

/**
 * Ventas por día (últimos N días) para gráfico
 */
async function obtenerVentasPorDia(id_empresa, dias = 7) {
    const { rows } = await pool.query(`
        WITH dias AS (
            SELECT generate_series(
                CURRENT_DATE - ($2 * INTERVAL '1 day'),
                CURRENT_DATE,
                '1 day'::interval
            )::date AS fecha
        )
        SELECT
            d.fecha,
            COALESCE(SUM(COALESCE(p.total_final, p.total)), 0) AS total_ventas,
            COUNT(p.id_pedido)::int AS cantidad_pedidos
        FROM dias d
        LEFT JOIN pedidos p ON p.fecha_creacion::date = d.fecha
            AND p.id_empresa = $1
            AND p.id_estado = ANY($3)
        GROUP BY d.fecha
        ORDER BY d.fecha ASC
    `, [id_empresa, dias, ESTADOS_VENTA]);
    return rows;
}

// ============================================================================
// FUNCIÓN PRINCIPAL - TODO EN PARALELO
// ============================================================================

/**
 * Obtener dashboard completo en una sola llamada.
 * Ejecuta todas las queries en paralelo con Promise.all.
 */
async function obtenerDashboardCompleto(id_empresa) {
    const [
        ventas_hoy,
        ventas_mes,
        caja,
        cobranzas_hoy,
        pendientes,
        stock_critico,
        top_productos,
        deudores,
        ventas_por_dia
    ] = await Promise.all([
        obtenerVentasHoy(id_empresa),
        obtenerVentasMes(id_empresa),
        obtenerEstadoCaja(id_empresa),
        obtenerCobranzasHoy(id_empresa),
        obtenerPedidosPendientes(id_empresa),
        obtenerStockCritico(id_empresa, 10),
        obtenerTopProductos(id_empresa, 7, 8),
        obtenerTopDeudores(id_empresa, 5),
        obtenerVentasPorDia(id_empresa, 7)
    ]);

    return {
        ventas_hoy,
        ventas_mes,
        caja,
        cobranzas_hoy,
        pendientes,
        stock_critico,
        top_productos,
        deudores,
        ventas_por_dia
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // KPIs
    obtenerVentasHoy,
    obtenerVentasMes,
    obtenerEstadoCaja,
    obtenerCobranzasHoy,
    obtenerPedidosPendientes,
    // Listas
    obtenerStockCritico,
    obtenerTopProductos,
    obtenerTopDeudores,
    obtenerVentasPorDia,
    // Todo junto
    obtenerDashboardCompleto,
    // Constantes
    ESTADOS_VENTA,
    ESTADOS_PENDIENTES_DESPACHO
};
