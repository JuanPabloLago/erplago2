'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * historial-producto.helper.js — Linea de tiempo de movimientos de un producto
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Devuelve TODOS los movimientos de stock de un producto enriquecidos con la
 * contraparte comercial (cliente/proveedor), precios (ARS/USD/cotizacion),
 * descuentos y links al documento origen.
 *
 * Usa los FKs de Fase 0 (id_comprobante_compra, id_ajuste, id_transferencia_grupo)
 * mas los FKs preexistentes (id_pedido, id_remito) para JOIN limpio sin heuristicas.
 *
 * Solo lectura — nunca escribe.
 *
 * Consumidores:
 *   - historial-producto.controller.js
 *
 * Creado: 2026-05-04 (Fase 1 trazabilidad)
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Obtener la linea de tiempo de movimientos de stock de un producto.
 *
 * @param {Object} client - Pool o client PG (.query disponible)
 * @param {Object} params
 * @param {number} params.id_empresa            - OBLIGATORIO
 * @param {number} params.id_producto           - OBLIGATORIO
 * @param {string} [params.fecha_desde]         - ISO date YYYY-MM-DD
 * @param {string} [params.fecha_hasta]         - ISO date YYYY-MM-DD
 * @param {Array<string>} [params.tipos]        - Filtrar por tipos especificos
 * @param {number} [params.id_deposito]         - Filtrar por un deposito
 * @param {number} [params.limit=100]           - Max 500
 * @param {number} [params.offset=0]
 * @returns {Object} { movimientos, resumen, pagination }
 */
async function obtenerLineaTiempo(client, params) {
    const {
        id_empresa,
        id_producto,
        fecha_desde = null,
        fecha_hasta = null,
        tipos = null,
        id_deposito = null,
        limit = 100,
        offset = 0
    } = params;

    if (!id_empresa)  throw _error('id_empresa es obligatorio', 400);
    if (!id_producto) throw _error('id_producto es obligatorio', 400);

    const lim = Math.min(parseInt(limit) || 100, 500);
    const off = parseInt(offset) || 0;

    // ─── Construir WHERE dinamico ───
    const conds = ['msd.id_empresa = $1', 'msd.id_producto = $2'];
    const args  = [id_empresa, id_producto];
    let i = 3;

    if (fecha_desde) {
        conds.push(`msd.created_at >= $${i++}`);
        args.push(fecha_desde);
    }
    if (fecha_hasta) {
        conds.push(`msd.created_at < ($${i++}::date + interval '1 day')`);
        args.push(fecha_hasta);
    }
    if (tipos && Array.isArray(tipos) && tipos.length > 0) {
        conds.push(`msd.tipo_movimiento = ANY($${i++})`);
        args.push(tipos);
    }
    if (id_deposito) {
        conds.push(`msd.id_deposito = $${i++}`);
        args.push(parseInt(id_deposito));
    }

    const where = conds.join(' AND ');

    // ─── QUERY DE DATOS ───
    const dataParams = [...args, lim, off];
    const dataQuery = `
        SELECT
            msd.id_movimiento,
            msd.created_at AS fecha,
            msd.tipo_movimiento,
            msd.cantidad,
            msd.stock_anterior,
            msd.stock_posterior,
            msd.observaciones,

            CASE WHEN msd.cantidad > 0 THEN msd.cantidad ELSE 0 END         AS entrada,
            CASE WHEN msd.cantidad < 0 THEN ABS(msd.cantidad) ELSE 0 END    AS salida,

            -- DEPOSITO
            d.id_deposito  AS dep_id,
            d.codigo       AS dep_codigo,
            d.nombre       AS dep_nombre,

            -- USUARIO
            u.id_usuario   AS usr_id,
            u.username     AS usr_username,
            u.nombre       AS usr_nombre,

            -- PEDIDO (VENTA / ENTREGA / ANULACION / DEVOLUCION_CLIENTE)
            p.id_pedido,
            p.nro_pedido,
            p.total                    AS pedido_total,
            p.total_moneda_extranjera  AS pedido_total_usd,
            p.id_cliente,
            cli.razon_social   AS cliente_razon_social,
            cli.cuit_cuil      AS cliente_cuit,
            pi.precio_unitario_final   AS pedido_precio_unitario,
            pi.porcentaje_descuento    AS pedido_descuento_pct,
            pi.total_linea             AS pedido_total_linea,

            -- REMITO (DESPACHO)
            r.id_remito,

            -- COMPRA (COMPRA / DEVOLUCION_COMPRA / ANULACION via FK Fase 0)
            cc.id_comprobante  AS comp_id,
            cc.numero_comprobante AS comp_numero,
            cc.fecha_emision   AS comp_fecha,
            cc.id_proveedor,
            prov.razon_social  AS proveedor_razon_social,
            prov.cuit          AS proveedor_cuit,
            cci.precio_unitario        AS comp_precio_unitario,
            cci.descuento_porcentaje   AS comp_descuento_pct,
            cci.total                  AS comp_total,
            cci.cotizacion_usada       AS comp_cotizacion,
            cci.precio_unitario_usd    AS comp_precio_usd,
            cci.total_usd              AS comp_total_usd,

            -- AJUSTE (AJUSTE_INVENTARIO / AJUSTE_RAPIDO / AJUSTE_MANUAL / ANULACION_AJUSTE)
            aj.id_ajuste,
            aj.numero_completo  AS ajuste_numero,
            aj.tipo_ajuste,
            aj.motivo           AS ajuste_motivo,

            -- TRANSFERENCIA
            msd.id_transferencia_grupo

        FROM movimientos_stock_deposito msd
        LEFT JOIN depositos d         ON d.id_deposito = msd.id_deposito
        LEFT JOIN usuarios  u         ON u.id_usuario  = msd.id_usuario
        LEFT JOIN pedidos   p         ON p.id_pedido   = msd.id_pedido
        LEFT JOIN clientes  cli       ON cli.id_cliente = p.id_cliente
        LEFT JOIN LATERAL (
            SELECT pi2.precio_unitario_final, pi2.porcentaje_descuento, pi2.total_linea
            FROM pedidoitems pi2
            WHERE pi2.id_pedido = msd.id_pedido
              AND pi2.id_producto = msd.id_producto
              AND pi2.id_empresa = msd.id_empresa
            LIMIT 1
        ) pi ON true
        LEFT JOIN remitos             r ON r.id_remito = msd.id_remito
        LEFT JOIN comprobantes_compra cc ON cc.id_comprobante = msd.id_comprobante_compra
        LEFT JOIN proveedores         prov ON prov.id_proveedor = cc.id_proveedor
        LEFT JOIN LATERAL (
            SELECT cci2.precio_unitario, cci2.descuento_porcentaje, cci2.total,
                   cci2.cotizacion_usada, cci2.precio_unitario_usd, cci2.total_usd
            FROM comprobante_compra_items cci2
            WHERE cci2.id_comprobante = msd.id_comprobante_compra
              AND cci2.id_producto = msd.id_producto
              AND cci2.id_empresa = msd.id_empresa
            LIMIT 1
        ) cci ON true
        LEFT JOIN ajustes_inventario aj ON aj.id_ajuste = msd.id_ajuste

        WHERE ${where}
        ORDER BY msd.created_at DESC, msd.id_movimiento DESC
        LIMIT $${i++} OFFSET $${i++}
    `;

    const { rows } = await client.query(dataQuery, dataParams);

    // ─── RESUMEN AGREGADO (sin LIMIT/OFFSET) ───
    const totalQuery = `
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN msd.cantidad > 0 THEN msd.cantidad ELSE 0 END), 0)        AS entradas_total,
            COALESCE(SUM(CASE WHEN msd.cantidad < 0 THEN ABS(msd.cantidad) ELSE 0 END), 0)   AS salidas_total
        FROM movimientos_stock_deposito msd
        WHERE ${where}
    `;
    const totRes = await client.query(totalQuery, args);
    const tot = totRes.rows[0];

    return {
        movimientos: rows.map(_mapearFila),
        resumen: {
            cantidad_movimientos: parseInt(tot.total),
            entradas_total: parseFloat(tot.entradas_total),
            salidas_total: parseFloat(tot.salidas_total),
            neto: parseFloat(tot.entradas_total) - parseFloat(tot.salidas_total)
        },
        pagination: {
            total:  parseInt(tot.total),
            limit:  lim,
            offset: off
        }
    };
}


/**
 * Mapea una fila del SELECT a la estructura anidada que consume el frontend.
 * @private
 */
function _mapearFila(r) {
    const tipo = r.tipo_movimiento;

    let contraparte = null;
    let documento   = null;
    let precios     = null;

    // ─── VENTA / ENTREGA / ANULACION / DEVOLUCION_CLIENTE / EGRESO_NOTA_DEBITO ───
    const tiposPedido = ['VENTA','ENTREGA','ENTREGA_PARCIAL','ANULACION','DEVOLUCION_CLIENTE','EGRESO_NOTA_DEBITO'];
    if (r.id_pedido && tiposPedido.indexOf(tipo) !== -1) {
        if (r.id_cliente) {
            contraparte = {
                tipo: 'cliente',
                id: r.id_cliente,
                nombre: r.cliente_razon_social,
                cuit: r.cliente_cuit
            };
        }
        documento = {
            tipo: 'pedido',
            id: r.id_pedido,
            numero: r.nro_pedido ? ('PED-' + r.nro_pedido) : ('#' + r.id_pedido),
            url: '/ver-pedido.html?id=' + r.id_pedido
        };
        if (r.pedido_precio_unitario != null) {
            const totalArs = parseFloat(r.pedido_total || 0);
            const totalUsd = parseFloat(r.pedido_total_usd || 0);
            const cotiz = (totalUsd > 0 && totalArs > 0) ? (totalArs / totalUsd) : null;
            const pu    = parseFloat(r.pedido_precio_unitario);
            const tl    = parseFloat(r.pedido_total_linea || 0);
            precios = {
                unitario_ars: pu,
                unitario_usd: cotiz ? +(pu / cotiz).toFixed(4) : null,
                cotizacion: cotiz ? +cotiz.toFixed(4) : null,
                descuento_pct: parseFloat(r.pedido_descuento_pct || 0),
                total_ars: tl,
                total_usd: cotiz ? +(tl / cotiz).toFixed(2) : null
            };
        }
    }
    // ─── DESPACHO via id_remito ───
    else if (tipo === 'DESPACHO' && r.id_remito) {
        documento = {
            tipo: 'remito',
            id: r.id_remito,
            numero: 'REM-' + r.id_remito,
            url: '/remitos.html?id=' + r.id_remito
        };
    }
    // ─── DEVOLUCION (devolucion de remito) ───
    else if (tipo === 'DEVOLUCION' && r.id_remito) {
        documento = {
            tipo: 'remito',
            id: r.id_remito,
            numero: 'REM-' + r.id_remito,
            url: '/remitos.html?id=' + r.id_remito
        };
    }
    // ─── COMPRA / DEVOLUCION_COMPRA via id_comprobante_compra (Fase 0) ───
    else if ((tipo === 'COMPRA' || tipo === 'DEVOLUCION_COMPRA') && r.comp_id) {
        if (r.id_proveedor) {
            contraparte = {
                tipo: 'proveedor',
                id: r.id_proveedor,
                nombre: r.proveedor_razon_social,
                cuit: r.proveedor_cuit
            };
        }
        documento = {
            tipo: 'comprobante_compra',
            id: r.comp_id,
            numero: r.comp_numero || ('#' + r.comp_id),
            url: '/ver-comprobante-compra.html?id=' + r.comp_id
        };
        if (r.comp_precio_unitario != null) {
            const pu  = parseFloat(r.comp_precio_unitario);
            const cot = r.comp_cotizacion != null ? parseFloat(r.comp_cotizacion) : null;
            const tot = parseFloat(r.comp_total || 0);
            precios = {
                unitario_ars: pu,
                unitario_usd: r.comp_precio_usd != null ? parseFloat(r.comp_precio_usd) : (cot ? +(pu / cot).toFixed(4) : null),
                cotizacion: cot,
                descuento_pct: parseFloat(r.comp_descuento_pct || 0),
                total_ars: tot,
                total_usd: r.comp_total_usd != null ? parseFloat(r.comp_total_usd) : (cot ? +(tot / cot).toFixed(2) : null)
            };
        }
    }
    // ─── AJUSTES (AJUSTE_INVENTARIO/RAPIDO/MANUAL/ANULACION_AJUSTE) via id_ajuste (Fase 0) ───
    else if (r.id_ajuste && (tipo.indexOf('AJUSTE') === 0 || tipo === 'ANULACION_AJUSTE' || tipo === 'INICIAL')) {
        contraparte = {
            tipo: 'ajuste',
            id: r.id_ajuste,
            nombre: r.ajuste_numero,
            detalle: r.ajuste_motivo || r.tipo_ajuste || 'Ajuste'
        };
        documento = {
            tipo: 'ajuste',
            id: r.id_ajuste,
            numero: r.ajuste_numero,
            url: '/ajustes-inventario.html?id=' + r.id_ajuste
        };
    }
    // ─── TRANSFERENCIA via id_transferencia_grupo (Fase 0) ───
    else if ((tipo === 'TRANSFERENCIA_SALIDA' || tipo === 'TRANSFERENCIA_ENTRADA') && r.id_transferencia_grupo) {
        contraparte = {
            tipo: 'transferencia',
            id: null,
            nombre: r.id_transferencia_grupo,
            detalle: tipo === 'TRANSFERENCIA_SALIDA' ? 'Salida' : 'Entrada'
        };
        documento = {
            tipo: 'transferencia',
            id: null,
            numero: r.id_transferencia_grupo,
            url: null
        };
    }
    // ─── Movimiento huerfano (no FK) — devolver lo que sepamos ───
    else {
        documento = {
            tipo: 'sin_documento',
            id: null,
            numero: r.observaciones ? r.observaciones.substring(0, 40) : '(sin documento)',
            url: null
        };
    }

    return {
        id: r.id_movimiento,
        fecha: r.fecha,
        tipo: tipo,
        cantidad: parseFloat(r.cantidad),
        entrada: parseFloat(r.entrada),
        salida: parseFloat(r.salida),
        stock_anterior: r.stock_anterior !== null ? parseFloat(r.stock_anterior) : null,
        stock_posterior: r.stock_posterior !== null ? parseFloat(r.stock_posterior) : null,
        observaciones: r.observaciones,
        deposito: r.dep_id ? {
            id: r.dep_id,
            codigo: r.dep_codigo,
            nombre: r.dep_nombre
        } : null,
        usuario: r.usr_id ? {
            id: r.usr_id,
            username: r.usr_username,
            nombre: r.usr_nombre
        } : null,
        contraparte: contraparte,
        precios: precios,
        documento: documento
    };
}


function _error(msg, code) {
    const e = new Error(msg);
    e.statusCode = code || 500;
    return e;
}


module.exports = {
    obtenerLineaTiempo
};
