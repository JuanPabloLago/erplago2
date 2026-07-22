'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * pedidos-edicion.helper.js — Edición post-venta de pedidos
 * ═══════════════════════════════════════════════════════════════════════
 *
 * REGLAS DE NEGOCIO:
 *   1. Solo admin puede editar
 *   2. No editable si facturado o con pagos confirmados
 *   3. Solo se edita CANTIDAD (no precio)
 *   4. Stock se ajusta automáticamente (retiro)
 *   5. Si sobra plata → preguntar al usuario → CC a favor
 *   6. Si falta plata → deuda automática
 *   7. Caja se ajusta si hubo efectivo
 *   8. Recargos se recalculan
 *   9. Todo queda en borrador_items_log
 *
 * Consumidores:
 *   - pedidos.controller.js (editarItem, eliminarItemPedido, anularPedido)
 * ═══════════════════════════════════════════════════════════════════════
 */

const pedidosHelper = require('./pedidos.helper');
const stockHelper = require('./stock.helper');
const ccClientesHelper = require('./cc-clientes.helper');
const cajaHelper = require('./caja.helper');
const recargosHelper = require('./recargos.helper');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════
// VALIDACIONES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Verifica que un pedido sea editable. Lanza error si no.
 * @returns {Object} { pedido, pagos_resumen }
 */
async function verificarEditable(client, id_pedido, id_empresa) {
    const check = await client.query(`
        SELECT p.id_pedido, p.id_estado, p.id_cliente, p.tipo_entrega,
               p.total_final, p.id_forma_pago_principal,
               c.razon_social AS cliente_nombre,
               (SELECT COUNT(*) FROM facturas f
                WHERE f.id_pedido = p.id_pedido AND f.estado != 'anulada') AS tiene_factura,
               (SELECT COUNT(*) FROM presupuestos pr
                WHERE pr.id_pedido = p.id_pedido AND pr.estado NOT IN ('rechazado', 'anulado')) AS tiene_presupuesto,
               (SELECT COUNT(*) FROM remitos r
                WHERE r.id_pedido = p.id_pedido AND r.estado NOT IN ('anulado', 'cancelado', 'no_entregado')) AS tiene_remito_activo,
               (SELECT COALESCE(SUM(cp.monto), 0) FROM confirmaciones_pago cp
                WHERE cp.id_pedido = p.id_pedido AND cp.estado = 'confirmado') AS total_confirmado,
               (SELECT COALESCE(SUM(pg.monto), 0) FROM pagos pg
                WHERE pg.id_pedido = p.id_pedido AND pg.id_pago_estado = 2) AS total_pagado
        FROM pedidos p
        LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
        WHERE p.id_pedido = $1 AND p.id_empresa = $2
    `, [id_pedido, id_empresa]);

    if (check.rows.length === 0) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
    }

    const pedido = check.rows[0];

    if (parseInt(pedido.tiene_factura) > 0) {
        throw Object.assign(new Error('No se puede modificar un pedido facturado'), { statusCode: 400 });
    }

    if (parseInt(pedido.tiene_presupuesto || 0) > 0) {
        throw Object.assign(new Error('No se puede modificar un pedido presupuestado. Anule el presupuesto primero.'), { statusCode: 400 });
    }

    if (parseInt(pedido.tiene_remito_activo || 0) > 0) {
        throw Object.assign(new Error('No se puede modificar un pedido con remito activo. Cancele el remito primero.'), { statusCode: 400 });
    }

    // Pagos confirmados NO bloquean edición — sobrepago va a CC


    return {
        pedido,
        total_anterior: parseFloat(pedido.total_final),
        total_pagado: parseFloat(pedido.total_pagado),
        id_cliente: pedido.id_cliente,
        cliente_nombre: pedido.cliente_nombre,
        es_retiro: pedido.tipo_entrega === 'retiro'
    };
}

// ═══════════════════════════════════════════════════════════════════════
// AJUSTAR STOCK (si es retiro)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ajusta stock por cambio de cantidad en un pedido tipo retiro.
 * @param {number} diferencia_cantidad - positivo = devolver, negativo = descontar más
 */
async function ajustarStockPorEdicion(client, params) {
    const {
        id_empresa, id_producto, diferencia_cantidad,
        id_usuario, id_pedido, id_deposito, accion
    } = params;

    if (Math.abs(diferencia_cantidad) < 0.001) return null;

    // diferencia_cantidad > 0 → se redujo la qty → devolver stock
    // diferencia_cantidad < 0 → se aumentó la qty → descontar stock
    const cantidad = diferencia_cantidad; // positivo=ingreso, negativo=egreso

    const tipo = cantidad > 0 ? stockHelper.TIPOS_MOVIMIENTO.ANULACION : stockHelper.TIPOS_MOVIMIENTO.VENTA;

    const movs = await stockHelper.descontarVenta(client, {
        id_empresa,
        id_deposito,
        id_producto,
        cantidad: Math.abs(cantidad),
        tipo_movimiento: tipo,
        id_usuario,
        documento_referencia: `Edición Pedido #${id_pedido}`,
        observaciones: `${accion} - Ajuste por modificación post-venta`,
        id_pedido
    });
    return movs[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════
// CALCULAR SOBREPAGO
// ═══════════════════════════════════════════════════════════════════════

function calcularSobrepago(total_pagado, nuevo_total) {
    const diferencia = total_pagado - nuevo_total;
    if (diferencia > 0.01) {
        return { hay_sobrepago: true, monto_sobrepago: Math.round(diferencia * 100) / 100 };
    }
    return { hay_sobrepago: false, monto_sobrepago: 0 };
}

// ═══════════════════════════════════════════════════════════════════════
// REGISTRAR SOBREPAGO EN CC (llamado por el usuario tras confirmar)
// ═══════════════════════════════════════════════════════════════════════

async function registrarSobrepagoCC(client, params) {
    const {
        id_empresa, id_cliente, id_pedido, monto, id_usuario
    } = params;

    // 1. Registrar HABER en CC (saldo a favor)
    const movCC = await ccClientesHelper.registrarMovimiento(client, {
        id_empresa,
        id_cliente,
        monto,
        tipo: 'haber',
        concepto: `Saldo a favor por modif. Pedido #${id_pedido}`
    });

    logger.info(`[EDICION] CC: Saldo a favor $${monto} para cliente #${id_cliente} por edición pedido #${id_pedido}`);

    // 2. Ajustar caja si hay turno abierto (egreso por devolución)
    const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
    let movCaja = null;
    if (turno) {
        movCaja = await cajaHelper.registrarMovimiento(client, {
            id_empresa,
            id_turno: turno.id_turno,
            id_usuario,
            tipo: 'egreso',
            monto,
            concepto: `Devolución por modif. Pedido #${id_pedido} - Saldo a favor cliente`,
            id_metodo_pago: 1 // Efectivo como default
        });
        logger.info(`[EDICION] Caja: Egreso $${monto} por sobrepago pedido #${id_pedido}`);
    }

    return { movimiento_cc: movCC, movimiento_caja: movCaja };
}

// ═══════════════════════════════════════════════════════════════════════
// EDITAR ITEM (CANTIDAD SOLAMENTE)
// ═══════════════════════════════════════════════════════════════════════

async function editarItem(client, params) {
    const {
        id_pedido, id_item, id_empresa, id_usuario,
        nueva_cantidad
    } = params;

    // 1. Verificar editable
    const ctx = await verificarEditable(client, id_pedido, id_empresa);

    // 2. Obtener item actual
    const itemRes = await client.query(`
        SELECT pi.*, p.nombre AS producto_nombre
        FROM pedidoitems pi
        JOIN productos p ON pi.id_producto = p.id_producto
        WHERE pi.id_item = $1 AND pi.id_pedido = $2 AND pi.id_empresa = $3
    `, [id_item, id_pedido, id_empresa]);

    if (itemRes.rows.length === 0) {
        throw Object.assign(new Error('Item no encontrado'), { statusCode: 404 });
    }

    const item = itemRes.rows[0];
    const cantidad_anterior = parseFloat(item.cantidad);
    const diferencia = cantidad_anterior - nueva_cantidad;

    if (nueva_cantidad <= 0) {
        throw Object.assign(new Error('La cantidad debe ser mayor a 0'), { statusCode: 400 });
    }

    // 3. Si es retiro → ajustar stock
    if (ctx.es_retiro && Math.abs(diferencia) > 0.001) {
        const id_deposito = await stockHelper.obtenerDepositoUsuario(client, { id_empresa, id_usuario });
        await ajustarStockPorEdicion(client, {
            id_empresa,
            id_producto: item.id_producto,
            diferencia_cantidad: diferencia,
            id_usuario,
            id_pedido,
            id_deposito,
            accion: diferencia > 0 ? 'Reducción cantidad' : 'Aumento cantidad'
        });
    }

    // 4. Actualizar item
    await pedidosHelper.actualizarItem(client, {
        id_item,
        id_empresa,
        id_pedido,
        cantidad: nueva_cantidad
    });

    // 5. Recalcular totales
    await pedidosHelper.recalcularTotales(client, id_pedido, id_empresa);

    // 6. Obtener nuevo total
    const nuevoTotalRes = await client.query(
        'SELECT total_final FROM pedidos WHERE id_pedido = $1', [id_pedido]
    );
    const nuevo_total = parseFloat(nuevoTotalRes.rows[0].total_final);

    // 7. Log de auditoría
    await pedidosHelper.registrarLogItem(client, {
        id_pedido, id_item, id_producto: item.id_producto,
        accion: 'EDIT_POST_VENTA', id_empresa,
        cantidad: nueva_cantidad,
        precio_unitario: parseFloat(item.precio_unitario_congelado),
        cantidad_anterior,
        precio_anterior: parseFloat(item.precio_unitario_congelado),
        id_usuario,
        motivo: `Cantidad: ${cantidad_anterior} → ${nueva_cantidad}`
    });

    // 8. Calcular si hay sobrepago
    const sobrepago = calcularSobrepago(ctx.total_pagado, nuevo_total);

    logger.info(`[EDICION] Item #${id_item} pedido #${id_pedido}: qty ${cantidad_anterior} → ${nueva_cantidad} | Total: $${ctx.total_anterior} → $${nuevo_total}`);

    return {
        success: true,
        message: 'Item actualizado',
        item_editado: {
            id_item,
            producto: item.producto_nombre,
            cantidad_anterior,
            cantidad_nueva: nueva_cantidad,
            diferencia_stock: diferencia
        },
        totales: {
            total_anterior: ctx.total_anterior,
            total_final: nuevo_total,
            total_pagado: ctx.total_pagado
        },
        sobrepago: sobrepago.hay_sobrepago ? {
            monto: sobrepago.monto_sobrepago,
            id_cliente: ctx.id_cliente,
            cliente_nombre: ctx.cliente_nombre,
            requiere_confirmacion: true
        } : null
    };
}

// ═══════════════════════════════════════════════════════════════════════
// ELIMINAR ITEM
// ═══════════════════════════════════════════════════════════════════════

async function eliminarItemPedido(client, params) {
    const {
        id_pedido, id_item, id_empresa, id_usuario
    } = params;

    // 1. Verificar editable
    const ctx = await verificarEditable(client, id_pedido, id_empresa);

    // 2. Verificar que no sea el último item
    const countRes = await client.query(
        'SELECT COUNT(*) AS cnt FROM pedidoitems WHERE id_pedido = $1 AND id_empresa = $2', [id_pedido, id_empresa]
    );
    if (parseInt(countRes.rows[0].cnt) <= 1) {
        throw Object.assign(new Error('No se puede eliminar el único item. Use Anular pedido.'), { statusCode: 400 });
    }

    // 3. Obtener item antes de borrar
    const itemRes = await client.query(`
        SELECT pi.*, p.nombre AS producto_nombre
        FROM pedidoitems pi
        JOIN productos p ON pi.id_producto = p.id_producto
        WHERE pi.id_item = $1 AND pi.id_pedido = $2 AND pi.id_empresa = $3
    `, [id_item, id_pedido, id_empresa]);

    if (itemRes.rows.length === 0) {
        throw Object.assign(new Error('Item no encontrado'), { statusCode: 404 });
    }

    const item = itemRes.rows[0];
    const cantidad_eliminada = parseFloat(item.cantidad);

    // 4. Si es retiro → devolver stock
    if (ctx.es_retiro) {
        const id_deposito = await stockHelper.obtenerDepositoUsuario(client, { id_empresa, id_usuario });
        await ajustarStockPorEdicion(client, {
            id_empresa,
            id_producto: item.id_producto,
            diferencia_cantidad: cantidad_eliminada, // positivo = devolver
            id_usuario,
            id_pedido,
            id_deposito,
            accion: 'Eliminación item'
        });
    }

    // 5. Eliminar item
    await pedidosHelper.eliminarItem(client, {
        id_item, id_empresa, id_pedido
    });

    // 6. Recalcular totales
    await pedidosHelper.recalcularTotales(client, id_pedido, id_empresa);

    // 7. Obtener nuevo total
    const nuevoTotalRes = await client.query(
        'SELECT total_final FROM pedidos WHERE id_pedido = $1', [id_pedido]
    );
    const nuevo_total = parseFloat(nuevoTotalRes.rows[0].total_final);

    // 8. Log
    await pedidosHelper.registrarLogItem(client, {
        id_pedido, id_item, id_producto: item.id_producto,
        accion: 'DELETE_POST_VENTA', id_empresa,
        cantidad: 0,
        precio_unitario: parseFloat(item.precio_unitario_congelado),
        cantidad_anterior: cantidad_eliminada,
        precio_anterior: parseFloat(item.precio_unitario_congelado),
        id_usuario,
        motivo: `Eliminado: ${item.producto_nombre} x${cantidad_eliminada}`
    });

    // 9. Sobrepago
    const sobrepago = calcularSobrepago(ctx.total_pagado, nuevo_total);

    logger.info(`[EDICION] Item eliminado #${id_item} pedido #${id_pedido}: ${item.producto_nombre} x${cantidad_eliminada} | Total: $${ctx.total_anterior} → $${nuevo_total}`);

    return {
        success: true,
        message: 'Item eliminado',
        item_eliminado: {
            id_item,
            producto: item.producto_nombre,
            cantidad: cantidad_eliminada
        },
        totales: {
            total_anterior: ctx.total_anterior,
            total_final: nuevo_total,
            total_pagado: ctx.total_pagado
        },
        sobrepago: sobrepago.hay_sobrepago ? {
            monto: sobrepago.monto_sobrepago,
            id_cliente: ctx.id_cliente,
            cliente_nombre: ctx.cliente_nombre,
            requiere_confirmacion: true
        } : null
    };
}

// ═══════════════════════════════════════════════════════════════════════
// ANULAR PEDIDO COMPLETO
// ═══════════════════════════════════════════════════════════════════════

async function anularPedidoCompleto(client, params) {
    const {
        id_pedido, id_empresa, id_usuario
    } = params;

    // 1. Verificar editable
    const ctx = await verificarEditable(client, id_pedido, id_empresa);

    // 2. Obtener items
    const itemsRes = await client.query(`
        SELECT pi.*, p.nombre AS producto_nombre
        FROM pedidoitems pi
        JOIN productos p ON pi.id_producto = p.id_producto
        WHERE pi.id_pedido = $1
    `, [id_pedido]);

    // 3. REVERSA BD-MANDA (2026-07-06): el stock a revertir se calcula desde
    // los movimientos REALES del pedido, no desde ctx.es_retiro ni items.
    // Neto por producto/deposito de todos los tipos ligados al pedido:
    // si neto != 0, se inserta el contramovimiento exacto. Idempotente.
    // Cubre: retiros, mixtos (VENTA + DEVOLUCION_CLIENTE), cambios de
    // tipo_entrega post-confirmacion, y anulaciones parciales previas.
    const netosStock = await client.query(`
        SELECT id_producto, id_deposito, SUM(cantidad) AS neto
        FROM movimientos_stock_deposito
        WHERE id_pedido = $1 AND id_empresa = $2
        GROUP BY id_producto, id_deposito
        HAVING ABS(SUM(cantidad)) > 0.001
    `, [id_pedido, id_empresa]);
    let stockRevertido = 0;
    for (const n of netosStock.rows) {
        await stockHelper.moverStock(client, {
            id_empresa,
            id_deposito: n.id_deposito,
            id_producto: n.id_producto,
            cantidad: -parseFloat(n.neto),
            tipo_movimiento: stockHelper.TIPOS_MOVIMIENTO.ANULACION,
            id_usuario,
            documento_referencia: `Anulación Pedido #${id_pedido}`,
            observaciones: `Reversa BD-manda: neto registrado ${n.neto} → contramovimiento`,
            id_pedido
        });
        stockRevertido++;
    }

    // 4. Pagos → todo a CC como saldo a favor
    const pagosRes = await client.query(`
        SELECT pg.id_pago, pg.monto, pg.id_metodo_pago, mp.nombre AS metodo_nombre
        FROM pagos pg
        JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago
        WHERE pg.id_pedido = $1
    `, [id_pedido]);

    const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, ctx.id_cliente);
    let totalDevueltoCC = 0;
    let movimientosCaja = [];

    // SIGNO SOBERANO + FIN DOBLE CREDITO (2026-07-06):
    // - pago > 0: la plata vuelve por UNA via segun config (caja O cc), nunca ambas.
    // - pago < 0 (devolucion previa): reversa = el cliente devuelve el dinero
    //   → INGRESO de caja. Jamas se descarta en silencio.
    const modoDevolucion = await require('./config.helper').get(
        client, id_empresa, 'anulacion.devolucion_dinero_modo', 'caja');
    for (const pago of pagosRes.rows) {
        const montoPago = parseFloat(pago.monto);
        if (!montoPago || isNaN(montoPago)) continue;

        if (modoDevolucion === 'cc' && !esCF && montoPago > 0) {
            // Via CC: saldo a favor, caja intacta
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa,
                id_cliente: ctx.id_cliente,
                id_pedido,
                monto: montoPago,
                tipo: 'haber',
                concepto: `Anulación Pedido #${id_pedido} - Devolución ${pago.metodo_nombre}`,
                id_pago: pago.id_pago
            });
            totalDevueltoCC += montoPago;
        } else {
            // Via caja (default): mismo metodo, signo soberano
            const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
            if (!turno) {
                throw Object.assign(
                    new Error('Anulación con devolución de dinero requiere turno de caja abierto'),
                    { statusCode: 400, code: 'CAJA_CERRADA' });
            }
            const movCaja = await cajaHelper.registrarMovimiento(client, {
                id_empresa,
                id_turno: turno.id_turno,
                id_usuario,
                tipo: montoPago > 0 ? 'egreso' : 'ingreso',
                monto: Math.abs(montoPago),
                concepto: montoPago > 0
                    ? `Anulación Pedido #${id_pedido} - Devolución ${pago.metodo_nombre}`
                    : `Anulación Pedido #${id_pedido} - Reversa devolución ${pago.metodo_nombre}`,
                id_metodo_pago: pago.id_metodo_pago
            });
            movimientosCaja.push(movCaja);
        }
    }

    // 4.5 FIADO -> reversa del DEBE neto en CC (F4a.3 2026-07-03)
    // El monto NO sale de total_final ni de es_fiado: sale del DEBE neto real
    // asentado en CC para este pedido. Auto-ajustado: si hubo cobros parciales
    // imputados, compensa solo el remanente; si no hay DEBE neto, no-op.
    // Cierra el agujero que genero $8.3M de deuda fantasma (65+ pedidos).
    let fiadoRevertido = 0;
    if (!esCF && ctx.id_cliente) {
        const fiadoRes = await client.query(`
            SELECT COALESCE(SUM(debe),0) - COALESCE(SUM(haber),0) AS neto
            FROM cuentacorrienteclientes
            WHERE id_empresa = $1 AND id_pedido = $2
        `, [id_empresa, id_pedido]);
        const netoFiado = Math.round((parseFloat(fiadoRes.rows[0].neto) || 0) * 100) / 100;
        if (netoFiado > 0.01) {
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa,
                id_cliente: ctx.id_cliente,
                id_pedido,
                monto: netoFiado,
                tipo: 'haber',
                concepto: `Anulación Pedido #${id_pedido} — reversa de fiado`
            });
            fiadoRevertido = netoFiado;
            logger.info(`[EDICION] Anulación #${id_pedido}: fiado revertido en CC $${netoFiado.toFixed(2)}`);
        }
    }

    // 5. Anular recargos si los tiene
    try {
        await recargosHelper.anularAjustesPorPedido(client, { id_empresa, id_pedido, motivo: `Anulación pedido #${id_pedido}` });
    } catch (err) {
        logger.error(`[EDICION] Error anulando recargos pedido #${id_pedido}: ${err.message}`);
        // No fallar la anulación por esto
    }

    // 6. Cambiar estado a Cancelado (7)
    await pedidosHelper.cambiarEstado(client, {
        id_pedido,
        id_empresa,
        nuevo_estado: pedidosHelper.PEDIDO_ESTADOS.CANCELADO
    });

    // 7. Log de auditoría para cada item
    for (const item of itemsRes.rows) {
        await pedidosHelper.registrarLogItem(client, {
            id_pedido,
            id_item: item.id_item,
            id_producto: item.id_producto,
            accion: 'ANULACION_PEDIDO',
            id_empresa,
            cantidad: 0,
            precio_unitario: parseFloat(item.precio_unitario_congelado),
            cantidad_anterior: parseFloat(item.cantidad),
            precio_anterior: parseFloat(item.precio_unitario_congelado),
            id_usuario,
            motivo: `Pedido anulado completamente`
        });
    }

    logger.info(`[EDICION] Pedido #${id_pedido} ANULADO | Stock devuelto: ${ctx.es_retiro ? 'SI' : 'NO'} | CC devuelto: $${totalDevueltoCC} | Egresos caja: ${movimientosCaja.length}`);

    return {
        success: true,
        message: 'Pedido anulado correctamente',
        resumen: {
            items_devueltos: itemsRes.rows.length,
            stock_devuelto: ctx.es_retiro,
            total_devuelto_cc: totalDevueltoCC,
            egresos_caja: movimientosCaja.length,
            es_consumidor_final: esCF
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════
// OBTENER HISTORIAL DE MODIFICACIONES
// ═══════════════════════════════════════════════════════════════════════

async function obtenerHistorialModificaciones(queryFn, id_pedido, id_empresa) {
    const res = await queryFn(`
        SELECT bil.*, u.nombre AS usuario_nombre,
               ua.nombre AS autorizo_nombre,
               p.nombre AS producto_nombre
        FROM borrador_items_log bil
        LEFT JOIN usuarios u ON bil.id_usuario = u.id_usuario
        LEFT JOIN usuarios ua ON bil.id_usuario_autorizo = ua.id_usuario
        LEFT JOIN productos p ON bil.id_producto = p.id_producto
        WHERE bil.id_pedido = $1 AND bil.id_empresa = $2
        ORDER BY bil.created_at DESC
    `, [id_pedido, id_empresa]);
    return res.rows;
}

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
    verificarEditable,
    editarItem,
    eliminarItemPedido,
    anularPedidoCompleto,
    registrarSobrepagoCC,
    obtenerHistorialModificaciones,
    calcularSobrepago
};
