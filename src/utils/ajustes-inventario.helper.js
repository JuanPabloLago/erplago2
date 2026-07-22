'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * ajustes-inventario.helper.js — Helper centralizado para AJUSTES DE INVENTARIO
 * ═══════════════════════════════════════════════════════════════════════
 *
 * TABLAS QUE GESTIONA:
 *   - ajustes_inventario        (cabecera del ajuste)
 *   - ajuste_inventario_items   (items/productos del ajuste)
 *
 * DEPENDENCIAS:
 *   - stock.helper.js → moverStock() para aplicar cambios (trazabilidad 100%)
 *
 * REGLA CLAVE:
 *   Este helper es el ÚNICO punto de escritura para ambas tablas.
 *   Ningún controller debe hacer INSERT/UPDATE/DELETE directo.
 *   La aplicación de stock SIEMPRE pasa por stock.helper.moverStock()
 *   para garantizar registro en movimientos_stock + sync de inventario.
 *
 * COLUMNAS GENERATED (NO escribibles):
 *   - ajustes_inventario.numero_completo    → 'AI-' || lpad(numero_ajuste, 8, '0')
 *   - ajuste_inventario_items.diferencia    → stock_real - stock_sistema
 *
 * Consumidores:
 *   - ajustes-inventario.controller.js
 *
 * Creado: 2026-02-24
 * ═══════════════════════════════════════════════════════════════════════
 */

const stockHelper = require('./stock.helper');

// ─── CONSTANTES ─────────────────────────────────────────────────────

const AJUSTE_ESTADOS = {
    BORRADOR: 'borrador',
    APLICADO: 'aplicado',
    ANULADO: 'anulado'
};

const AJUSTE_TIPOS = {
    INVENTARIO_FISICO: 'INVENTARIO_FISICO',
    PARCIAL: 'PARCIAL',
    IMPORTACION_EXCEL: 'IMPORTACION_EXCEL'
};


// ═══════════════════════════════════════════════════════════════════════
// CABECERA DEL AJUSTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Crear un ajuste en estado borrador.
 * Usa la función PG obtener_proximo_numero_ajuste() para número atómico.
 *
 * @param {Object} client - Transacción PG
 * @param {Object} datos
 * @param {number} datos.id_empresa
 * @param {number} datos.id_usuario
 * @param {number} datos.id_deposito       - Depósito sobre el que se hace el conteo
 * @param {string} [datos.tipo_ajuste='INVENTARIO_FISICO']
 * @param {string} [datos.motivo]
 * @param {string} [datos.observaciones]
 * @param {Object} [datos.filtros_aplicados]
 * @returns {Object} Ajuste creado con todos sus campos
 */
async function crearAjuste(client, datos) {
    const {
        id_empresa,
        id_usuario,
        id_deposito,
        tipo_ajuste = AJUSTE_TIPOS.INVENTARIO_FISICO,
        motivo = null,
        observaciones = null,
        filtros_aplicados = null
    } = datos;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);
    if (!id_deposito) throw _error('id_deposito es obligatorio. Seleccione un depósito para el ajuste.', 400);

    // Verificar que el depósito pertenece a la empresa
    const depCheck = await client.query(
        'SELECT id_deposito FROM depositos WHERE id_deposito = $1 AND id_empresa = $2 AND activo = true',
        [id_deposito, id_empresa]
    );
    if (depCheck.rows.length === 0) {
        throw _error('Depósito no encontrado o no pertenece a la empresa', 404);
    }

    // Número atómico
    const numResult = await client.query(
        'SELECT obtener_proximo_numero_ajuste($1) as numero',
        [id_empresa]
    );
    const numero_ajuste = numResult.rows[0].numero;

    const result = await client.query(`
        INSERT INTO ajustes_inventario (
            id_empresa, id_usuario, id_deposito, numero_ajuste, tipo_ajuste,
            motivo, observaciones, filtros_aplicados, estado
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
    `, [
        id_empresa, id_usuario, id_deposito, numero_ajuste, tipo_ajuste,
        motivo, observaciones,
        filtros_aplicados ? JSON.stringify(filtros_aplicados) : null,
        AJUSTE_ESTADOS.BORRADOR
    ]);

    return result.rows[0];
}


/**
 * Obtener un ajuste validando propiedad de empresa.
 */
async function obtenerAjuste(client, id_ajuste, id_empresa) {
    const result = await client.query(`
        SELECT ai.*,
            u.nombre as usuario_nombre,
            ua.nombre as usuario_anulacion_nombre,
            d.nombre as deposito_nombre
        FROM ajustes_inventario ai
        LEFT JOIN usuarios u ON ai.id_usuario = u.id_usuario
        LEFT JOIN usuarios ua ON ai.id_usuario_anulacion = ua.id_usuario
        LEFT JOIN depositos d ON ai.id_deposito = d.id_deposito
        WHERE ai.id_ajuste = $1 AND ai.id_empresa = $2
    `, [id_ajuste, id_empresa]);

    if (result.rows.length === 0) return null;
    return result.rows[0];
}


/**
 * Eliminar ajuste (solo borradores). CASCADE elimina items automáticamente.
 */
async function eliminarAjuste(client, id_ajuste, id_empresa) {
    const result = await client.query(`
        DELETE FROM ajustes_inventario
        WHERE id_ajuste = $1 AND id_empresa = $2 AND estado = $3
        RETURNING numero_completo
    `, [id_ajuste, id_empresa, AJUSTE_ESTADOS.BORRADOR]);

    if (result.rows.length === 0) {
        throw _error('No se puede eliminar. El ajuste no existe o no está en borrador.', 400);
    }

    return result.rows[0];
}


/**
 * Actualizar totales de la cabecera (total_items, total_entradas, total_salidas).
 * Se llama después de modificar items.
 */
async function recalcularTotales(client, id_ajuste, id_empresa) {
    const result = await client.query(`
        UPDATE ajustes_inventario SET
            total_items = sub.total_items,
            total_entradas = sub.total_entradas,
            total_salidas = sub.total_salidas
        FROM (
            SELECT
                COUNT(*) as total_items,
                COALESCE(SUM(CASE WHEN diferencia > 0 THEN diferencia ELSE 0 END), 0) as total_entradas,
                COALESCE(SUM(CASE WHEN diferencia < 0 THEN ABS(diferencia) ELSE 0 END), 0) as total_salidas
            FROM ajuste_inventario_items
            WHERE id_ajuste = $1 AND id_empresa = $2
        ) sub
        WHERE ajustes_inventario.id_ajuste = $1 AND ajustes_inventario.id_empresa = $2
        RETURNING ajustes_inventario.total_items, ajustes_inventario.total_entradas, ajustes_inventario.total_salidas
    `, [id_ajuste, id_empresa]);

    return result.rows[0] || { total_items: 0, total_entradas: 0, total_salidas: 0 };
}


// ═══════════════════════════════════════════════════════════════════════
// ITEMS DEL AJUSTE
// ═══════════════════════════════════════════════════════════════════════

/**
 * Agregar un item (upsert por id_ajuste + id_producto).
 * Lee stock_sistema del depósito del ajuste en tiempo real.
 *
 * @param {Object} client
 * @param {Object} datos
 * @param {number} datos.id_ajuste
 * @param {number} datos.id_empresa     - Para leer stock del depósito correcto
 * @param {number} datos.id_deposito    - Depósito del ajuste
 * @param {number} datos.id_producto
 * @param {number} datos.stock_real     - El conteo físico
 * @param {string} [datos.observaciones]
 * @returns {Object} Item creado/actualizado
 */
async function agregarItem(client, datos) {
    const { id_ajuste, id_empresa, id_deposito, id_producto, stock_real, observaciones = null } = datos;

    // Verificar que el producto existe y está activo
    const prodCheck = await client.query(
        'SELECT id_producto FROM productos WHERE id_producto = $1 AND activo = true',
        [id_producto]
    );
    if (prodCheck.rows.length === 0) {
        throw _error(`Producto #${id_producto} no encontrado o inactivo`, 404);
    }

    // Obtener stock actual del depósito específico
    const stockResult = await client.query(`
        SELECT COALESCE(id2.stock_real, 0) as stock_sistema
        FROM productos p
        LEFT JOIN inventario_deposito id2
            ON p.id_producto = id2.id_producto
            AND id2.id_empresa = $1
            AND id2.id_deposito = $2
        WHERE p.id_producto = $3
    `, [id_empresa, id_deposito, id_producto]);

    const stock_sistema = parseFloat(stockResult.rows[0]?.stock_sistema || 0);

    // Upsert: INSERT o UPDATE si ya existe para este ajuste+producto
    const result = await client.query(`
        INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real, observaciones)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id_ajuste, id_producto)
        DO UPDATE SET stock_real = EXCLUDED.stock_real, stock_sistema = EXCLUDED.stock_sistema, observaciones = EXCLUDED.observaciones
        RETURNING *
    `, [id_empresa, id_ajuste, id_producto, stock_sistema, stock_real, observaciones]);

    return result.rows[0];
}


/**
 * Agregar items masivamente. Para carga desde filtros o importación Excel.
 * Usa ON CONFLICT DO NOTHING para no pisar items ya cargados.
 *
 * @param {Object} client
 * @param {number} id_ajuste
 * @param {Array} items - [{id_producto, stock_real, observaciones?}]
 * @param {number} id_empresa
 * @param {number} id_deposito
 * @returns {number} Cantidad de items insertados
 */
async function agregarItemsMasivo(client, id_ajuste, items, id_empresa, id_deposito) {
    let insertados = 0;

    for (const item of items) {
        // Obtener stock actual del depósito
        const stockResult = await client.query(`
            SELECT COALESCE(id2.stock_real, 0) as stock_sistema
            FROM inventario_deposito id2
            WHERE id2.id_empresa = $1 AND id2.id_deposito = $2 AND id2.id_producto = $3
        `, [id_empresa, id_deposito, item.id_producto]);

        const stock_sistema = parseFloat(stockResult.rows[0]?.stock_sistema || 0);

        const result = await client.query(`
            INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real, observaciones)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id_ajuste, id_producto) DO NOTHING
        `, [id_empresa, id_ajuste, item.id_producto, stock_sistema, item.stock_real, item.observaciones || null]);

        if (result.rowCount > 0) insertados++;
    }

    return insertados;
}


/**
 * Actualizar stock_real de un item específico.
 */
async function actualizarItem(client, id_item, id_ajuste, stock_real, id_empresa) {
    const result = await client.query(`
        UPDATE ajuste_inventario_items
        SET stock_real = $1
        WHERE id_item = $2 AND id_ajuste = $3 AND id_empresa = $4
        RETURNING *
    `, [stock_real, id_item, id_ajuste, id_empresa]);

    if (result.rows.length === 0) {
        throw _error('Item no encontrado', 404);
    }

    return result.rows[0];
}


/**
 * Actualizar stock_real de múltiples items.
 * @param {Array} items - [{id_item, stock_real}]
 * @returns {number} Cantidad actualizados
 */
async function actualizarItemsMasivo(client, id_ajuste, items, id_empresa) {
    let actualizados = 0;

    for (const item of items) {
        const result = await client.query(`
            UPDATE ajuste_inventario_items
            SET stock_real = $1
            WHERE id_item = $2 AND id_ajuste = $3 AND id_empresa = $4
        `, [item.stock_real, item.id_item, id_ajuste, id_empresa]);

        if (result.rowCount > 0) actualizados++;
    }

    return actualizados;
}


/**
 * Eliminar un item del ajuste.
 */
async function eliminarItem(client, id_item, id_ajuste) {
    const result = await client.query(
        'DELETE FROM ajuste_inventario_items WHERE id_item = $1 AND id_ajuste = $2 AND id_empresa = (SELECT id_empresa FROM ajustes_inventario WHERE id_ajuste = $2) RETURNING *',
        [id_item, id_ajuste]
    );

    if (result.rows.length === 0) {
        throw _error('Item no encontrado', 404);
    }

    return result.rows[0];
}


/**
 * Llenar stock_real de todos los items según acción.
 * @param {string} accion - 'cero' | 'copiar_sistema'
 */
async function llenarItems(client, id_ajuste, id_empresa, accion) {
    let query;
    if (accion === 'cero') {
        query = 'UPDATE ajuste_inventario_items SET stock_real = 0 WHERE id_ajuste = $1 AND id_empresa = $2';
    } else if (accion === 'copiar_sistema') {
        query = 'UPDATE ajuste_inventario_items SET stock_real = stock_sistema WHERE id_ajuste = $1 AND id_empresa = $2';
    } else {
        throw _error('Acción debe ser "cero" o "copiar_sistema"', 400);
    }

    const result = await client.query(query, [id_ajuste, id_empresa]);
    return result.rowCount;
}


/**
 * Cargar items desde productos filtrados del depósito.
 * Lee stock de inventario_deposito (no de inventario general).
 */
async function cargarDesdeProductosFiltrados(client, datos) {
    const {
        id_ajuste, id_empresa, id_deposito,
        id_marca, id_categoria, id_proveedor, id_conjunto,
        stock_real_default = null  // null = copiar del sistema
    } = datos;

    const condiciones = ['p.activo = TRUE'];
    const params = [id_empresa, id_deposito];
    let paramIndex = 3;

    if (id_marca) {
        condiciones.push(`p.id_marca = $${paramIndex++}`);
        params.push(parseInt(id_marca));
    }
    if (id_categoria) {
        condiciones.push(`p.id_categoria = $${paramIndex++}`);
        params.push(parseInt(id_categoria));
    }
    if (id_proveedor) {
        condiciones.push(`EXISTS (SELECT 1 FROM producto_proveedor pp WHERE pp.id_producto = p.id_producto AND pp.id_proveedor = $${paramIndex++} AND pp.id_empresa = $1 AND pp.activo = TRUE)`);
        params.push(parseInt(id_proveedor));
    }
    if (id_conjunto) {
        condiciones.push(`EXISTS (SELECT 1 FROM conjunto_items ci WHERE ci.id_producto = p.id_producto AND ci.id_conjunto = $${paramIndex++})`);
        params.push(parseInt(id_conjunto));
    }

    // Leer stock del DEPÓSITO específico
    const productosResult = await client.query(`
        SELECT p.id_producto, COALESCE(id2.stock_real, 0) as stock_sistema
        FROM productos p
        LEFT JOIN inventario_deposito id2
            ON p.id_producto = id2.id_producto
            AND id2.id_empresa = $1
            AND id2.id_deposito = $2
        WHERE ${condiciones.join(' AND ')}
    `, params);

    let insertados = 0;
    for (const prod of productosResult.rows) {
        const stockReal = stock_real_default !== null ? stock_real_default : prod.stock_sistema;

        const result = await client.query(`
            INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (id_ajuste, id_producto) DO NOTHING
        `, [id_empresa, id_ajuste, prod.id_producto, prod.stock_sistema, stockReal]);

        if (result.rowCount > 0) insertados++;
    }

    return insertados;
}


/**
 * Obtener items con datos de producto para preview/listado.
 */
async function obtenerItems(client, id_ajuste, id_empresa) {
    const result = await client.query(`
        SELECT
            aii.*,
            p.sku,
            p.nombre as producto_nombre,
            m.nombre as marca_nombre
        FROM ajuste_inventario_items aii
        JOIN productos p ON aii.id_producto = p.id_producto
        LEFT JOIN marcas m ON p.id_marca = m.id_marca
        WHERE aii.id_ajuste = $1 AND aii.id_empresa = $2
        ORDER BY p.nombre
    `, [id_ajuste, id_empresa]);

    return result.rows;
}


/**
 * Obtener resumen para preview antes de aplicar.
 */
async function obtenerResumen(client, id_ajuste, id_empresa) {
    const result = await client.query(`
        SELECT
            ai.numero_completo,
            ai.tipo_ajuste,
            ai.motivo,
            ai.estado,
            d.nombre as deposito_nombre,
            COUNT(aii.id_item) as total_items,
            COUNT(CASE WHEN aii.diferencia != 0 THEN 1 END) as items_con_cambios,
            COALESCE(SUM(CASE WHEN aii.diferencia > 0 THEN aii.diferencia ELSE 0 END), 0) as total_entradas,
            COALESCE(SUM(CASE WHEN aii.diferencia < 0 THEN ABS(aii.diferencia) ELSE 0 END), 0) as total_salidas,
            json_agg(json_build_object(
                'id_item', aii.id_item,
                'sku', p.sku,
                'producto', p.nombre,
                'stock_sistema', aii.stock_sistema,
                'stock_real', aii.stock_real,
                'diferencia', aii.diferencia
            ) ORDER BY ABS(aii.diferencia) DESC) FILTER (WHERE aii.diferencia != 0) as items_con_diferencia
        FROM ajustes_inventario ai
        LEFT JOIN depositos d ON ai.id_deposito = d.id_deposito
        LEFT JOIN ajuste_inventario_items aii ON ai.id_ajuste = aii.id_ajuste
        LEFT JOIN productos p ON aii.id_producto = p.id_producto
        WHERE ai.id_ajuste = $1 AND ai.id_empresa = $2
        GROUP BY ai.id_ajuste, d.nombre
    `, [id_ajuste, id_empresa]);

    if (result.rows.length === 0) return null;
    return result.rows[0];
}


// ═══════════════════════════════════════════════════════════════════════
// APLICAR AJUSTE — FUNCIÓN CRÍTICA
// ═══════════════════════════════════════════════════════════════════════
//
// Reemplaza la función PG aplicar_ajuste_inventario() para que
// TODA modificación de stock pase por stock.helper.moverStock().
// Esto garantiza:
//   1. Registro en movimientos_stock (trazabilidad)
//   2. Update atómico de inventario_deposito
//   3. Sync automático a tabla inventario (via trigger)
//   4. Vinculación item → id_movimiento (FK)
//
// ═══════════════════════════════════════════════════════════════════════

/**
 * Aplicar un ajuste de inventario.
 * Cada item con diferencia != 0 genera un movimiento de stock.
 *
 * @param {Object} client - Transacción PG (OBLIGATORIO - todo es atómico)
 * @param {number} id_ajuste
 * @param {number} id_empresa
 * @param {number} id_usuario - Quien aplica
 * @returns {Object} { success, numero_completo, items_ajustados, total_entradas, total_salidas }
 */
async function aplicarAjuste(client, id_ajuste, id_empresa, id_usuario) {

    // ─── 1. VALIDAR AJUSTE ──────────────────────────────────────────
    const ajuste = await client.query(
        'SELECT * FROM ajustes_inventario WHERE id_ajuste = $1 AND id_empresa = $2',
        [id_ajuste, id_empresa]
    );

    if (ajuste.rows.length === 0) {
        throw _error('Ajuste no encontrado', 404);
    }

    const aj = ajuste.rows[0];

    if (aj.estado !== AJUSTE_ESTADOS.BORRADOR) {
        throw _error(`No se puede aplicar un ajuste en estado "${aj.estado}"`, 400);
    }

    if (!aj.id_deposito) {
        throw _error('El ajuste no tiene depósito asignado. No se puede aplicar.', 400);
    }

    // ─── 2. OBTENER ITEMS CON DIFERENCIA ────────────────────────────
    const itemsResult = await client.query(`
        SELECT aii.*, p.nombre as producto_nombre, p.sku
        FROM ajuste_inventario_items aii
        JOIN productos p ON aii.id_producto = p.id_producto
        WHERE aii.id_ajuste = $1 AND aii.id_empresa = $2
    `, [id_ajuste, id_empresa]);

    if (itemsResult.rows.length === 0) {
        throw _error('El ajuste no tiene items. Agregue productos antes de aplicar.', 400);
    }

    // ─── 3. APLICAR CADA DIFERENCIA VIA stock.helper ────────────────
    let items_ajustados = 0;
    let total_entradas = 0;
    let total_salidas = 0;

    for (const item of itemsResult.rows) {
        const diferencia = parseFloat(item.diferencia);

        if (diferencia === 0) continue; // Sin cambio, no mover stock

        // Calcular diferencia REAL contra stock actual del depósito
        // (puede haber cambiado desde que se creó el borrador)
        const stockActual = await stockHelper.verificarStock(
            client, id_empresa, aj.id_deposito, item.id_producto
        );

        const stockDeseado = parseFloat(item.stock_real);
        const diferenciaReal = stockDeseado - stockActual.stock_real;

        if (diferenciaReal === 0) continue; // Stock ya coincide

        // Mover stock a través del helper centralizado
        const movimiento = await stockHelper.moverStock(client, {
            id_empresa,
            id_deposito: aj.id_deposito,
            id_producto: item.id_producto,
            cantidad: diferenciaReal,
            tipo_movimiento: 'AJUSTE_INVENTARIO',
            id_usuario,
            documento_referencia: aj.numero_completo,
            observaciones: `Ajuste inventario ${aj.numero_completo} - ${item.sku || ''} ${item.producto_nombre || ''}`,
            id_ajuste: aj.id_ajuste
        });

        // Vincular item con el movimiento generado
        await client.query(
            'UPDATE ajuste_inventario_items SET id_movimiento = $1 WHERE id_item = $2 AND id_empresa = $3',
            [movimiento.id_movimiento, item.id_item, id_empresa]
        );

        items_ajustados++;
        if (diferenciaReal > 0) {
            total_entradas += diferenciaReal;
        } else {
            total_salidas += Math.abs(diferenciaReal);
        }
    }

    // ─── 4. MARCAR AJUSTE COMO APLICADO ─────────────────────────────
    await client.query(`
        UPDATE ajustes_inventario SET
            estado = $1,
            fecha_aplicacion = NOW(),
            total_items = $2,
            total_entradas = $3,
            total_salidas = $4
        WHERE id_ajuste = $5 AND id_empresa = $6
    `, [
        AJUSTE_ESTADOS.APLICADO,
        itemsResult.rows.length,
        total_entradas,
        total_salidas,
        id_ajuste,
        id_empresa
    ]);

    return {
        success: true,
        numero_completo: aj.numero_completo,
        items_ajustados,
        total_items: itemsResult.rows.length,
        total_entradas,
        total_salidas
    };
}


// ═══════════════════════════════════════════════════════════════════════
// ANULAR AJUSTE — FUNCIÓN CRÍTICA
// ═══════════════════════════════════════════════════════════════════════
//
// Revierte un ajuste aplicado creando movimientos inversos.
// Solo ajustes en estado 'aplicado' se pueden anular.
//
// ═══════════════════════════════════════════════════════════════════════

/**
 * Anular un ajuste previamente aplicado.
 * Genera movimientos inversos por cada item que tenía id_movimiento.
 *
 * @param {Object} client - Transacción PG
 * @param {number} id_ajuste
 * @param {number} id_empresa
 * @param {number} id_usuario - Quien anula
 * @param {string} motivo - Motivo de anulación (obligatorio)
 * @returns {Object} { success, numero_completo, items_revertidos }
 */
async function anularAjuste(client, id_ajuste, id_empresa, id_usuario, motivo) {

    if (!motivo) throw _error('Debe indicar el motivo de anulación', 400);

    // ─── 1. VALIDAR AJUSTE ──────────────────────────────────────────
    const ajuste = await client.query(
        'SELECT * FROM ajustes_inventario WHERE id_ajuste = $1 AND id_empresa = $2',
        [id_ajuste, id_empresa]
    );

    if (ajuste.rows.length === 0) {
        throw _error('Ajuste no encontrado', 404);
    }

    const aj = ajuste.rows[0];

    if (aj.estado !== AJUSTE_ESTADOS.APLICADO) {
        throw _error(`Solo se pueden anular ajustes aplicados. Estado actual: "${aj.estado}"`, 400);
    }

    // ─── 2. OBTENER ITEMS QUE FUERON APLICADOS ─────────────────────
    const itemsResult = await client.query(`
        SELECT aii.*, p.nombre as producto_nombre, p.sku,
               ms.diferencia as diferencia_aplicada
        FROM ajuste_inventario_items aii
        JOIN productos p ON aii.id_producto = p.id_producto
        LEFT JOIN movimientos_stock ms ON aii.id_movimiento = ms.id_movimiento
        WHERE aii.id_ajuste = $1 AND aii.id_empresa = $2
    `, [id_ajuste, id_empresa]);

    // ─── 3. REVERTIR CADA MOVIMIENTO ────────────────────────────────
    let items_revertidos = 0;

    for (const item of itemsResult.rows) {
        // Solo revertir items que tienen movimiento registrado
        if (!item.id_movimiento) continue;

        const diferenciaOriginal = parseFloat(item.diferencia_aplicada || item.diferencia);
        if (diferenciaOriginal === 0) continue;

        // Movimiento inverso
        await stockHelper.moverStock(client, {
            id_empresa,
            id_deposito: aj.id_deposito,
            id_producto: item.id_producto,
            cantidad: -diferenciaOriginal,  // Inverso
            tipo_movimiento: 'ANULACION_AJUSTE',
            id_usuario,
            documento_referencia: aj.numero_completo,
            observaciones: `Anulación ajuste ${aj.numero_completo} - ${motivo}`,
            id_ajuste: id_ajuste
        });

        items_revertidos++;
    }

    // ─── 4. MARCAR AJUSTE COMO ANULADO ──────────────────────────────
    await client.query(`
        UPDATE ajustes_inventario SET
            estado = $1,
            fecha_anulacion = NOW(),
            id_usuario_anulacion = $2,
            motivo_anulacion = $3
        WHERE id_ajuste = $4 AND id_empresa = $5
    `, [AJUSTE_ESTADOS.ANULADO, id_usuario, motivo, id_ajuste, id_empresa]);

    return {
        success: true,
        numero_completo: aj.numero_completo,
        items_revertidos
    };
}


// ═══════════════════════════════════════════════════════════════════════
// VALIDACIONES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Validar que un ajuste está en el estado requerido.
 * Lanza error si no lo está.
 */
function validarEstado(ajuste, estadoRequerido) {
    if (ajuste.estado !== estadoRequerido) {
        throw _error(
            `Operación no permitida. El ajuste está en estado "${ajuste.estado}", se requiere "${estadoRequerido}"`,
            400
        );
    }
}

/**
 * Validar que un ajuste pertenece a la empresa.
 */
function validarPropietario(ajuste, id_empresa) {
    if (ajuste.id_empresa !== id_empresa) {
        throw _error('Ajuste no pertenece a esta empresa', 403);
    }
}


// ─── UTILIDAD INTERNA ───────────────────────────────────────────────

function _error(mensaje, statusCode) {
    const err = new Error(mensaje);
    err.statusCode = statusCode;
    return err;
}


// ─── EXPORTS ────────────────────────────────────────────────────────

module.exports = {
    // Constantes
    AJUSTE_ESTADOS,
    AJUSTE_TIPOS,
    // Cabecera
    crearAjuste,
    obtenerAjuste,
    eliminarAjuste,
    recalcularTotales,
    // Items
    agregarItem,
    agregarItemsMasivo,
    actualizarItem,
    actualizarItemsMasivo,
    eliminarItem,
    llenarItems,
    cargarDesdeProductosFiltrados,
    obtenerItems,
    obtenerResumen,
    // Críticas
    aplicarAjuste,
    anularAjuste,
    // Validaciones
    validarEstado,
    validarPropietario
};
