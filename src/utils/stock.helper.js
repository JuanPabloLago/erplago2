'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * stock.helper.js — Helper centralizado para operaciones de STOCK
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * FUENTE DE VERDAD: inventario_deposito
 * CACHE AUTOMÁTICO: inventario (via trigger sync_inventario_cache)
 * 
 * REGLA: Toda operación que modifique stock pasa por acá.
 *        UPDATE inventario_deposito + INSERT movimientos_stock son ATÓMICOS.
 *        No existe UPDATE sin movimiento → trazabilidad 100%.
 * 
 * NOTA: Este helper NUNCA toca tabla `inventario` directamente.
 *       El trigger `trigger_sync_inventario` actualiza inventario
 *       automáticamente cuando cambia inventario_deposito.
 * 
 * Consumidores:
 *   - pedidos.controller.js          (VENTA - descuento stock)
 *   - borrador.controller.js         (VENTA - descuento stock via POS)
 *   - compras.controller.js          (COMPRA - ingreso stock recepción)
 *   - compras.controller.js    (COMPRA + ANULACION comprobantes)
 *   - inventario.controller.js       (AJUSTE_MANUAL)
 *   - productos.controller.js        (INICIAL + AJUSTE)
 *   - despachos.controller.js        (DESPACHO/ENTREGA/DEVOLUCION)
 * 
 * Creado: 2026-02-20
 * ═══════════════════════════════════════════════════════════════════════
 */

// ─── TIPOS DE MOVIMIENTO VÁLIDOS ────────────────────────────────────
const TIPOS_MOVIMIENTO = {
    VENTA: 'VENTA',
    COMPRA: 'COMPRA',
    DEVOLUCION_COMPRA: 'DEVOLUCION_COMPRA',
    ANULACION: 'ANULACION',
    AJUSTE_MANUAL: 'AJUSTE_MANUAL',
    AJUSTE_RAPIDO: 'AJUSTE_RAPIDO',
    AJUSTE_INVENTARIO: 'AJUSTE_INVENTARIO',
    ANULACION_AJUSTE: 'ANULACION_AJUSTE',
    INICIAL: 'INICIAL',
    DESPACHO: 'DESPACHO',
    ENTREGA: 'ENTREGA',
    ENTREGA_PARCIAL: 'ENTREGA_PARCIAL',
    DEVOLUCION: 'DEVOLUCION',
    TRANSFERENCIA_SALIDA: 'TRANSFERENCIA_SALIDA',
    TRANSFERENCIA_ENTRADA: 'TRANSFERENCIA_ENTRADA',
    DEVOLUCION_CLIENTE: 'DEVOLUCION_CLIENTE',
    EGRESO_NOTA_DEBITO: 'EGRESO_NOTA_DEBITO'
};

// Set para validacion O(1)
const _TIPOS_VALIDOS = new Set(Object.values(TIPOS_MOVIMIENTO));


/**
 * ═══════════════════════════════════════════════════════════════════════
 * moverStock — Función principal. ÚNICO punto de UPDATE stock.
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Opera sobre inventario_deposito + registra en movimientos_stock.
 * El trigger sync_inventario_cache actualiza inventario automáticamente.
 * 
 * @param {Object} client - Cliente de transacción PostgreSQL (OBLIGATORIO)
 * @param {Object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_deposito       - Depósito donde se mueve el stock
 * @param {number} params.id_producto
 * @param {number} params.cantidad          - Positiva=ingreso, negativa=egreso
 * @param {string} params.tipo_movimiento   - Uno de TIPOS_MOVIMIENTO
 * @param {number} params.id_usuario
 * @param {string} [params.documento_referencia]
 * @param {string} [params.observaciones]
 * @param {boolean} [params.crear_si_no_existe=true] - UPSERT en inventario_deposito
 * @param {boolean} [params.afecta_comprometido=false]
 * @param {number}  [params.delta_comprometido=0]
 * @param {number}  [params.id_remito]
 * @param {number}  [params.id_pedido]
 * @param {number}  [params.id_comprobante_compra] - FK comprobante de compra (Fase 0 trazabilidad)
 * @param {number}  [params.id_ajuste]              - FK ajuste de inventario formal (Fase 0 trazabilidad)
 * @param {string}  [params.id_transferencia_grupo] - String agrupador (TRF-N) para transferencias (Fase 0)
 * @returns {Object} { id_movimiento, stock_anterior, stock_nuevo, diferencia }
 */
async function moverStock(client, params) {
    const {
        id_empresa,
        id_deposito,
        id_producto,
        cantidad,
        tipo_movimiento,
        id_usuario,
        documento_referencia = null,
        observaciones = null,
        crear_si_no_existe = true,
        afecta_comprometido = false,
        delta_comprometido = 0,
        id_remito = null,
        id_pedido = null,
        id_comprobante_compra = null,
        id_ajuste = null,
        id_transferencia_grupo = null
    } = params;

    // ═══ VALIDACIONES ═══
    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_deposito) throw _error('id_deposito es obligatorio. El usuario no tiene depósito asignado.', 400);
    if (!id_producto) throw _error('id_producto es obligatorio', 400);
    if (!tipo_movimiento) throw _error('tipo_movimiento es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);
    if (!_TIPOS_VALIDOS.has(tipo_movimiento)) {
        throw _error('tipo_movimiento invalido: "' + tipo_movimiento + '". Validos: ' + [..._TIPOS_VALIDOS].join(', '), 400);
    }

    const cantidadNum = parseFloat(cantidad);
    if (isNaN(cantidadNum)) {
        throw _error(`Cantidad inválida: ${cantidad}`, 400);
    }

    // === 1. ASEGURAR EXISTENCIA (UPSERT ATOMICO) ===
    if (crear_si_no_existe) {
        await client.query(
            `INSERT INTO inventario_deposito
             (id_empresa, id_deposito, id_producto, stock_real, stock_comprometido, stock_minimo, stock_maximo)
             VALUES ($1, $2, $3, 0, 0, 0, 0)
             ON CONFLICT ON CONSTRAINT uq_inventario_deposito_empresa DO NOTHING`,
            [id_empresa, id_deposito, id_producto]
        );
    }
    // === 2. UPDATE ATOMICO CON RETURNING (sin race condition) ===
    // stock_real = stock_real + cantidad en una sola operacion
    // El trigger sync_inventario_cache actualiza tabla inventario automaticamente
    const deltaComprometido = afecta_comprometido ? parseFloat(delta_comprometido) : 0;
    // CLAMP stock_comprometido a 0: nunca permitir valor negativo (invariante logica)
    // GREATEST garantiza que si el delta lo dejaria negativo, queda en 0.
    const updateResult = await client.query(`
        UPDATE inventario_deposito
        SET stock_real = stock_real + $1,
            stock_comprometido = GREATEST(stock_comprometido + $2, 0),
            updated_at = NOW()
        WHERE id_empresa = $3 AND id_deposito = $4 AND id_producto = $5
        RETURNING
            stock_real - ($1) as stock_anterior,
            stock_real as stock_nuevo,
            (stock_comprometido - LEAST($2, stock_comprometido + $2)) as comprometido_anterior,
            stock_comprometido as comprometido_nuevo,
            CASE WHEN $2 < 0 AND stock_comprometido - LEAST($2, stock_comprometido + $2) + $2 < 0 THEN true ELSE false END as clamp_aplicado
    `, [cantidadNum, deltaComprometido, id_empresa, id_deposito, id_producto]);

    // Log warning si se aplico clamp (descompromiso que hubiera dejado negativo)
    if (updateResult.rows.length > 0 && updateResult.rows[0].clamp_aplicado) {
        console.warn(`[stock.helper] CLAMP: intento de dejar stock_comprometido negativo en producto ${id_producto} deposito ${id_deposito}. Delta=${deltaComprometido}. Origen: ${tipo_movimiento}${id_remito ? ' remito=' + id_remito : ''}`);
    }
    if (updateResult.rows.length === 0) {
        throw _error(`Producto #${id_producto} no existe en deposito #${id_deposito}`, 404);
    }
    const { stock_anterior: stockAnteriorRaw, stock_nuevo: stockNuevoRaw,
            comprometido_anterior: comprometidoAnteriorRaw, comprometido_nuevo: comprometidoNuevoRaw
    } = updateResult.rows[0];
    const stockAnterior = parseFloat(stockAnteriorRaw);
    const stockNuevo = parseFloat(stockNuevoRaw);
    const comprometidoAnterior = parseFloat(comprometidoAnteriorRaw);
    const comprometidoNuevo = parseFloat(comprometidoNuevoRaw);


    // ═══ 3. INSERT MOVIMIENTO (SIEMPRE - trazabilidad 100%) ═══
    // Registrar en movimientos_stock (general, para reportes y auditoría)
    const movResult = await client.query(`
        INSERT INTO movimientos_stock (
            id_producto, id_empresa, id_usuario, tipo_movimiento,
            cantidad_anterior, cantidad_nueva, diferencia,
            observaciones, documento_referencia, fecha_movimiento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id_movimiento
    `, [
        id_producto, id_empresa, id_usuario, tipo_movimiento,
        stockAnterior, stockNuevo, cantidadNum,
        observaciones, documento_referencia
    ]);

    // Registrar en movimientos_stock_deposito SIEMPRE que haya depósito (trazabilidad 100%)
    if (id_deposito) {
        await client.query(`
            INSERT INTO movimientos_stock_deposito (
                id_empresa, id_deposito, id_producto, tipo_movimiento,
                cantidad, stock_anterior, stock_posterior,
                comprometido_anterior, comprometido_posterior,
                id_remito, id_pedido, id_usuario, observaciones,
                id_comprobante_compra, id_ajuste, id_transferencia_grupo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `, [
            id_empresa, id_deposito, id_producto, tipo_movimiento,
            cantidadNum, stockAnterior, stockNuevo,
            comprometidoAnterior, comprometidoNuevo,
            id_remito, id_pedido, id_usuario, observaciones,
            id_comprobante_compra, id_ajuste, id_transferencia_grupo
        ]);
    }

    return {
        id_movimiento: movResult.rows[0].id_movimiento,
        stock_anterior: stockAnterior,
        stock_nuevo: stockNuevo,
        diferencia: cantidadNum,
        comprometido_anterior: comprometidoAnterior,
        comprometido_nuevo: comprometidoNuevo
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * verificarStock — Consulta stock actual de un producto en un depósito.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function verificarStock(client, id_empresa, id_deposito, id_producto) {
    const result = await client.query(
        `SELECT stock_real, stock_comprometido, stock_minimo, stock_maximo
         FROM inventario_deposito
         WHERE id_empresa = $1 AND id_deposito = $2 AND id_producto = $3`,
        [id_empresa, id_deposito, id_producto]
    );

    if (result.rows.length === 0) {
        return { stock_real: 0, stock_comprometido: 0, stock_minimo: 0, stock_maximo: 0, existe: false };
    }

    const row = result.rows[0];
    return {
        stock_real: parseFloat(row.stock_real),
        stock_comprometido: parseFloat(row.stock_comprometido),
        stock_minimo: parseFloat(row.stock_minimo),
        stock_maximo: parseFloat(row.stock_maximo),
        existe: true
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * verificarStockGeneral — Stock total sumando todos los depósitos.
 * Lee de inventario (cache) para performance.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function verificarStockGeneral(client, id_empresa, id_producto) {
    const result = await client.query(
        'SELECT stock_real, stock_minimo, stock_maximo FROM inventario WHERE id_empresa = $1 AND id_producto = $2',
        [id_empresa, id_producto]
    );

    if (result.rows.length === 0) {
        return { stock_real: 0, stock_minimo: 0, stock_maximo: 0, existe: false };
    }

    return {
        stock_real: parseFloat(result.rows[0].stock_real),
        stock_minimo: parseFloat(result.rows[0].stock_minimo),
        stock_maximo: parseFloat(result.rows[0].stock_maximo),
        existe: true
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * ajustarStockAbsoluto — Setea stock a un valor absoluto.
 * Caso: "ahora hay 50 en este depósito"
 * ═══════════════════════════════════════════════════════════════════════
 */
async function ajustarStockAbsoluto(client, params) {
    const {
        id_empresa,
        id_deposito,
        id_producto,
        stock_nuevo,
        id_usuario,
        observaciones = null,
        documento_referencia = 'AJUSTE-RAPIDO'
    } = params;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_deposito) throw _error('id_deposito es obligatorio', 400);
    if (!id_producto) throw _error('id_producto es obligatorio', 400);
    if (stock_nuevo === undefined || stock_nuevo === null) throw _error('stock_nuevo es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    const nuevoNum = parseFloat(stock_nuevo);
    if (isNaN(nuevoNum) || nuevoNum < 0) {
        throw _error(`stock_nuevo inválido: ${stock_nuevo}`, 400);
    }

    const actual = await verificarStock(client, id_empresa, id_deposito, id_producto);
    const diferencia = nuevoNum - actual.stock_real;

    if (diferencia === 0) {
        return { stock_anterior: actual.stock_real, stock_nuevo: nuevoNum, diferencia: 0, id_movimiento: null };
    }

    return await moverStock(client, {
        id_empresa, id_deposito, id_producto,
        cantidad: diferencia,
        tipo_movimiento: TIPOS_MOVIMIENTO.AJUSTE_MANUAL,
        id_usuario,
        observaciones: observaciones || 'Ajuste manual desde inventario',
        documento_referencia
    });
}


/**
 * _expandirBOM — Resuelve la receta de un producto a lineas de stock.
 * Con receta activa → componentes escalados. Sin receta → el producto mismo.
 */
async function _expandirBOM(client, id_empresa, id_producto, cantidad) {
    const cantidadNum = Math.abs(parseFloat(cantidad));
    const bom = await obtenerBOM(client, id_empresa, id_producto);
    if (!bom) return [{ id_producto: id_producto, cantidad: cantidadNum, etiqueta: '' }];
    return bom.map(c => {
        const cant = cantidadNum * parseFloat(c.cantidad);
        return {
            id_producto: c.id_producto_componente,
            cantidad: cant,
            etiqueta: ' [BOM: ' + cantidadNum + 'x prod#' + id_producto + ' → ' + cant + ' de comp#' + c.id_producto_componente + ']'
        };
    });
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * FUNCIONES ESPECÍFICAS DE DESPACHO (shortcuts a moverStock)
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * despacharDeDeposito — Viaje sale con mercadería.
 * stock_real↓ comprometido↑
 */
async function despacharDeDeposito(client, params) {
    const { id_empresa, id_deposito, id_producto, cantidad, id_remito, id_usuario, observaciones } = params;
    const lineas = await _expandirBOM(client, id_empresa, id_producto, cantidad);
    let ultimo = null;
    for (const l of lineas) {
        ultimo = await moverStock(client, {
            id_empresa, id_deposito, id_producto: l.id_producto,
            cantidad: -l.cantidad,
            tipo_movimiento: TIPOS_MOVIMIENTO.DESPACHO,
            id_usuario, id_remito,
            observaciones: ((observaciones || '') + l.etiqueta) || null,
            afecta_comprometido: true,
            delta_comprometido: l.cantidad,
            crear_si_no_existe: false
        });
    }
    return ultimo;
}

/**
 * confirmarEntregaDeposito — Chofer entregó. comprometido↓
 */
async function confirmarEntregaDeposito(client, params) {
    const { id_empresa, id_deposito, id_producto, cantidad, id_remito, id_usuario, observaciones } = params;
    const lineas = await _expandirBOM(client, id_empresa, id_producto, cantidad);
    let ultimo = null;
    for (const l of lineas) {
        ultimo = await moverStock(client, {
            id_empresa, id_deposito, id_producto: l.id_producto,
            cantidad: 0,
            tipo_movimiento: TIPOS_MOVIMIENTO.ENTREGA,
            id_usuario, id_remito,
            observaciones: ((observaciones || 'Entrega confirmada') + l.etiqueta),
            afecta_comprometido: true,
            delta_comprometido: -l.cantidad,
            crear_si_no_existe: false
        });
    }
    return ultimo;
}

/**
 * devolverADeposito — Chofer devuelve mercadería.
 * stock_real↑ comprometido↓
 */
async function devolverADeposito(client, params) {
    const { id_empresa, id_deposito, id_producto, cantidad, id_remito, id_usuario, observaciones } = params;
    const lineas = await _expandirBOM(client, id_empresa, id_producto, cantidad);
    let ultimo = null;
    for (const l of lineas) {
        ultimo = await moverStock(client, {
            id_empresa, id_deposito, id_producto: l.id_producto,
            cantidad: l.cantidad,
            tipo_movimiento: TIPOS_MOVIMIENTO.DEVOLUCION,
            id_usuario, id_remito,
            observaciones: ((observaciones || 'Devolucion en entrega') + l.etiqueta),
            afecta_comprometido: true,
            delta_comprometido: -l.cantidad,
            crear_si_no_existe: false
        });
    }
    return ultimo;
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * obtenerDepositoUsuario — Obtiene el id_deposito del usuario.
 * Fallback al depósito principal de la empresa si no tiene asignado.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function obtenerDepositoUsuario(client, reqUsuario) {
    // 1. Del JWT
    if (reqUsuario.id_deposito) return reqUsuario.id_deposito;

    // 2. De la BD (por si el JWT es viejo)
    const userResult = await client.query(
        'SELECT id_deposito FROM usuarios WHERE id_usuario = $1',
        [reqUsuario.id_usuario]
    );
    if (userResult.rows.length > 0 && userResult.rows[0].id_deposito) {
        return userResult.rows[0].id_deposito;
    }

    // 3. Fallback: depósito principal de la empresa
    const depResult = await client.query(
        'SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true AND activo = true LIMIT 1',
        [reqUsuario.id_empresa]
    );
    if (depResult.rows.length > 0) {
        return depResult.rows[0].id_deposito;
    }

    throw _error('No hay depósito configurado. Asigná un depósito al usuario desde Configuraciones.', 400);
}


// ─── UTILIDAD INTERNA ───────────────────────────────────────────────
function _error(mensaje, statusCode) {
    const err = new Error(mensaje);
    err.statusCode = statusCode;
    return err;
}


// ─── EXPORTS ────────────────────────────────────────────────────────
/**
 * Verifica stock disponible para multiples items. Considera stock comprometido
 * por OTROS borradores activos del mismo producto en la empresa.
 *
 * Casos de uso:
 *   - confirmarBorrador: verificar antes de pasar borrador a confirmado/pendiente
 *   - agregarItem: verificar al sumar producto al borrador
 *   - modificarItem: verificar al cambiar cantidad
 *
 * Retorna [] si todos los items tienen stock suficiente.
 * Retorna array de productos sin stock con detalle (id, nombre, cantidad solicitada,
 * stock actual, comprometido por otros, disponible).
 *
 * NOTA: usa la tabla 'inventario' (cache agregada). El controller decide si
 * leer desde 'inventario_deposito' (multi-deposito) o 'inventario' (agregado),
 * pero hoy todos los flujos de venta-rapida usan agregado.
 *
 * @param {object} client                 - pg client (puede estar en transaccion)
 * @param {object} params
 * @param {number} params.id_empresa      - obligatorio
 * @param {number} [params.id_pedido]     - si viene, lee items de pedidoitems del pedido
 * @param {Array}  [params.items]         - alternativo: items literales [{id_producto, cantidad}]
 * @param {number} [params.excluir_borrador] - id_pedido a excluir del calculo de comprometido (el propio borrador)
 * @returns {Promise<Array>} array de productos sin stock o []
 */
async function verificarStockMultiple(client, params) {
    const pedidosHelper = require('./pedidos.helper');
    const { id_empresa, id_pedido, items, excluir_borrador } = params;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_pedido && !items) throw _error('Debe pasar id_pedido o items', 400);

    const idExcluir = excluir_borrador || id_pedido || 0;
    const estadoBorrador = pedidosHelper.PEDIDO_ESTADOS.BORRADOR;

    // Caso 1: items vienen del pedido (lookup desde BD)
    if (id_pedido) {
        const { rows } = await client.query(
            "SELECT pi.id_producto, pr.nombre, pi.cantidad, " +
            "       COALESCE(inv.stock_real, 0) AS stock_actual, " +
            "       COALESCE((SELECT SUM(pi2.cantidad) FROM pedidoitems pi2 " +
            "                   JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido " +
            "                  WHERE pi2.id_producto = pi.id_producto " +
            "                    AND p2.id_empresa = $2 " +
            "                    AND p2.id_estado = $3 " +
            "                    AND p2.id_pedido != $1), 0) AS comprometido_otros, " +
            "       (COALESCE(inv.stock_real, 0) - COALESCE((SELECT SUM(pi2.cantidad) " +
            "         FROM pedidoitems pi2 JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido " +
            "        WHERE pi2.id_producto = pi.id_producto AND p2.id_empresa = $2 " +
            "          AND p2.id_estado = $3 AND p2.id_pedido != $1), 0)) AS disponible " +
            "  FROM pedidoitems pi " +
            "  JOIN productos pr ON pi.id_producto = pr.id_producto " +
            "  LEFT JOIN inventario inv ON pi.id_producto = inv.id_producto AND inv.id_empresa = $2 " +
            " WHERE pi.id_pedido = $1 " +
            "   AND pi.cantidad > (COALESCE(inv.stock_real, 0) - COALESCE((SELECT SUM(pi2.cantidad) " +
            "         FROM pedidoitems pi2 JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido " +
            "        WHERE pi2.id_producto = pi.id_producto AND p2.id_empresa = $2 " +
            "          AND p2.id_estado = $3 AND p2.id_pedido != $1), 0))",
            [id_pedido, id_empresa, estadoBorrador]
        );
        return rows;
    }

    // Caso 2: items literales (lista pasada)
    const sinStock = [];
    for (const it of items) {
        const idProd = it.id_producto;
        const cantSolicitada = parseFloat(it.cantidad) || 0;
        if (cantSolicitada <= 0 || !idProd) continue;

        const { rows } = await client.query(
            "SELECT pr.nombre, COALESCE(inv.stock_real, 0) AS stock_actual, " +
            "       COALESCE((SELECT SUM(pi2.cantidad) FROM pedidoitems pi2 " +
            "                   JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido " +
            "                  WHERE pi2.id_producto = $1 " +
            "                    AND p2.id_empresa = $2 " +
            "                    AND p2.id_estado = $3 " +
            "                    AND p2.id_pedido != $4), 0) AS comprometido_otros " +
            "  FROM productos pr " +
            "  LEFT JOIN inventario inv ON pr.id_producto = inv.id_producto AND inv.id_empresa = $2 " +
            " WHERE pr.id_producto = $1",
            [idProd, id_empresa, estadoBorrador, idExcluir]
        );
        if (rows.length === 0) continue;
        const r = rows[0];
        const stockActual = parseFloat(r.stock_actual) || 0;
        const comprometidoOtros = parseFloat(r.comprometido_otros) || 0;
        const disponible = stockActual - comprometidoOtros;
        if (cantSolicitada > disponible) {
            sinStock.push({
                id_producto: idProd,
                nombre: r.nombre,
                cantidad: cantSolicitada,
                stock_actual: stockActual,
                comprometido_otros: comprometidoOtros,
                disponible
            });
        }
    }
    return sinStock;
}


// =============================================================================
// MIN/MAX por deposito  (agregado para modulo Ordenes de Compra, 2026-05-17)
// =============================================================================
/**
 * Actualiza stock_minimo y/o stock_maximo en inventario_deposito.
 * El trigger sync_inventario_cache propaga al cache `inventario` segun config.
 */
async function actualizarMinMax(client, id_empresa, id_deposito, id_producto, params) {
    if (id_empresa === undefined || id_empresa === null) {
        throw new Error('stock.helper.actualizarMinMax: id_empresa obligatorio');
    }
    if (!id_deposito)  throw new Error('stock.helper.actualizarMinMax: id_deposito obligatorio');
    if (!id_producto)  throw new Error('stock.helper.actualizarMinMax: id_producto obligatorio');
    const { stock_minimo, stock_maximo, id_usuario } = params || {};
    if (!id_usuario)   throw new Error('stock.helper.actualizarMinMax: id_usuario obligatorio');

    const min = (stock_minimo === null || stock_minimo === undefined) ? null : Number(stock_minimo);
    const max = (stock_maximo === null || stock_maximo === undefined) ? null : Number(stock_maximo);

    if (min !== null && min < 0) throw new Error('stock.helper.actualizarMinMax: stock_minimo no puede ser negativo');
    if (max !== null && max < 0) throw new Error('stock.helper.actualizarMinMax: stock_maximo no puede ser negativo');
    if (min !== null && max !== null && max < min) {
        throw new Error('stock.helper.actualizarMinMax: stock_maximo debe ser >= stock_minimo');
    }
    if (min === null && max === null) {
        throw new Error('stock.helper.actualizarMinMax: debe especificar al menos uno de stock_minimo/stock_maximo');
    }

    const upsert = await client.query(`
        INSERT INTO inventario_deposito (id_empresa, id_deposito, id_producto, stock_real, stock_comprometido, stock_minimo, stock_maximo)
        VALUES ($1, $2, $3, 0, 0, COALESCE($4, 0), COALESCE($5, 0))
        ON CONFLICT (id_empresa, id_deposito, id_producto) DO UPDATE
        SET stock_minimo = COALESCE($4, inventario_deposito.stock_minimo),
            stock_maximo = COALESCE($5, inventario_deposito.stock_maximo),
            updated_at = NOW()
        RETURNING stock_minimo, stock_maximo
    `, [id_empresa, id_deposito, id_producto, min, max]);

    return {
        id_deposito, id_producto,
        stock_minimo_nuevo: Number(upsert.rows[0].stock_minimo),
        stock_maximo_nuevo: Number(upsert.rows[0].stock_maximo)
    };
}


module.exports = {
    actualizarMinMax,
    moverStock,
    verificarStock,
    verificarStockGeneral,
    verificarStockMultiple,
    ajustarStockAbsoluto,
    despacharDeDeposito,
    confirmarEntregaDeposito,
    devolverADeposito,
    obtenerDepositoUsuario,
    obtenerBOM,
    descontarVenta,
    TIPOS_MOVIMIENTO
};


/**
 * ═══════════════════════════════════════════════════════════════════════
 * obtenerBOM — Busca componentes BOM de un producto.
 * Si tiene componentes activos, devuelve el array.
 * Si no tiene, devuelve null (producto simple, descuento directo).
 * Cachea en memoria por request para evitar N+1 queries.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function obtenerBOM(client, id_empresa, id_producto) {
    const { rows } = await client.query(
        `SELECT id_producto_componente, cantidad
         FROM producto_componentes
         WHERE id_empresa = $1 AND id_producto = $2 AND activo = true`,
        [id_empresa, id_producto]
    );
    return rows.length > 0 ? rows : null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * descontarVenta — Descuenta stock por venta, resolviendo BOM.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Si el producto tiene BOM → descompone y descuenta cada componente.
 * Si no tiene BOM → descuenta directo (comportamiento actual).
 *
 * @param {Object} client - Cliente transacción PG
 * @param {Object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_deposito
 * @param {number} params.id_producto       - Producto vendido
 * @param {number} params.cantidad           - Cantidad vendida (positiva)
 * @param {number} params.id_usuario
 * @param {string} [params.documento_referencia]
 * @param {string} [params.observaciones]
 * @param {number} [params.id_pedido]
 * @param {string} [params.tipo_movimiento]  - Default: VENTA (permite ANULACION para edición)
 * @returns {Array} Array de movimientos generados
 */
async function descontarVenta(client, params) {
    const {
        id_empresa, id_deposito, id_producto, cantidad,
        id_usuario, documento_referencia, observaciones,
        id_pedido, tipo_movimiento
    } = params;

    const cantidadRaw = parseFloat(cantidad);
    const cantidadNum = Math.abs(cantidadRaw);
    // SIGNO SOBERANO DEL ITEM (2026-07-06):
    // cantidad NEGATIVA del item = mercaderia que INGRESA (devolucion/cambio mostrador)
    // => tipo default DEVOLUCION_CLIENTE. Con tipo_movimiento explicito se respeta el caller (LSP).
    const tipo = tipo_movimiento ||
        (cantidadRaw < 0 ? TIPOS_MOVIMIENTO.DEVOLUCION_CLIENTE : TIPOS_MOVIMIENTO.VENTA);
    // Tipos que INGRESAN stock en este flujo (declarados una vez)
    const tiposIngreso = new Set([TIPOS_MOVIMIENTO.ANULACION, TIPOS_MOVIMIENTO.DEVOLUCION_CLIENTE]);
    const signo = tiposIngreso.has(tipo) ? 1 : -1;

    const bom = await obtenerBOM(client, id_empresa, id_producto);
    const movimientos = [];

    if (bom) {
        // ═══ PRODUCTO CON BOM → descomponer ═══
        for (const comp of bom) {
            const cantidadComponente = cantidadNum * parseFloat(comp.cantidad);
            const mov = await moverStock(client, {
                id_empresa, id_deposito,
                id_producto: comp.id_producto_componente,
                cantidad: signo * cantidadComponente,
                tipo_movimiento: tipo,
                id_usuario,
                documento_referencia,
                observaciones: (observaciones || '') + ` [BOM: ${cantidadNum}x prod#${id_producto} → ${cantidadComponente} de comp#${comp.id_producto_componente}]`,
                id_pedido
            });
            movimientos.push(mov);
        }
    } else {
        // ═══ PRODUCTO SIMPLE → descuento directo ═══
        const mov = await moverStock(client, {
            id_empresa, id_deposito,
            id_producto,
            cantidad: signo * cantidadNum,
            tipo_movimiento: tipo,
            id_usuario,
            documento_referencia,
            observaciones,
            id_pedido
        });
        movimientos.push(mov);
    }

    return movimientos;
}
