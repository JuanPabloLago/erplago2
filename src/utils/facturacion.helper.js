/**
 * FACTURACION HELPER - ERP LAGO
 * ==============================
 * Punto ÚNICO de escritura para: facturas, factura_items, secuencia_facturas
 *
 * CONSUMIDORES ESPERADOS:
 *   - facturas.controller.js         (crear, facturarMasivo, anular)
 *   - ventas-consulta.controller.js  (facturarDesdePedido)
 *   - cajas-cobranzas.controller.js  (aplicarPago -> actualizarMontoPagado)
 *   - recibos.controller.js          (crear/anular -> actualizarMontoPagado)
 *
 * REGLAS:
 *   - Todas las funciones reciben `client` (transacción del caller)
 *   - id_empresa es OBLIGATORIO en toda operación
 *   - Secuencia es atómica (ON CONFLICT con lock implícito)
 *   - Nunca se escribe en estas tablas fuera de este helper
 *
 * SCOPE — Propiedad y escrituras a tablas
 * ─────────────────────────────────────────────────────────────────────
 * @canonical facturas
 * @canonical factura_items
 * @canonical secuencia_facturas
 *
 * @writes facturas                   (INSERT al crear, UPDATE estado/monto)
 * @writes factura_items              (INSERT por item)
 * @writes secuencia_facturas         (INSERT/UPDATE secuencia atómica)
 *
 * @writes-foreign pedidos.id_estado  (marcar 'Facturado' al facturar pedido.
 *                                     canónico=pedidos.helper. Coordinado:
 *                                     facturar un pedido cierra su ciclo de
 *                                     vida en pedidos. Flujo opuesto:
 *                                     notas.helper revierte estado al anular)
 *
 * @module facturacion.helper
 * @version 1.0.0
 * @date 2026-02-21
 */

const logger = require('./logger');

// ============================================================
// CONSTANTES
// ============================================================

const FACTURA_ESTADOS = {
    EMITIDA: 'emitida',
    PAGADA: 'pagada',
    ANULADA: 'anulada',
    PARCIAL: 'parcial'
};

const FACTURA_TIPOS = {
    A: 1,
    B: 2,
    C: 3
};

// DEPRECADO (F1 fix): punto_venta ahora es obligatorio en las funciones criticas.
// Se resuelve via _resolverPV() en el controller o configuraciones_empresa.afip_punto_venta_default
// Se mantiene solo por backward-compat si algun consumidor externo lo referencia.
const PUNTO_VENTA_DEFAULT = 6;

// Tolerancia para comparaciones monetarias
const TOLERANCIA_MONTO = 0.01;

// ============================================================
// VALIDACIONES INTERNAS
// ============================================================

/**
 * Valida que los parámetros obligatorios existan
 * @private
 */
function _validarRequeridos(params, campos) {
    const faltantes = campos.filter(c => params[c] === undefined || params[c] === null);
    if (faltantes.length > 0) {
        const error = new Error(`facturacion.helper: Faltan campos obligatorios: ${faltantes.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }
}

/**
 * Valida que los items tengan la estructura correcta
 * @private
 */
function _validarItems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        const error = new Error('facturacion.helper: Se requiere al menos un item');
        error.statusCode = 400;
        throw error;
    }

    items.forEach((item, idx) => {
        if (!item.id_producto) {
            const error = new Error(`facturacion.helper: Item ${idx + 1} sin id_producto`);
            error.statusCode = 400;
            throw error;
        }
        if (!item.cantidad || parseFloat(item.cantidad) <= 0) {
            const esDevolucion = parseFloat(item.cantidad) < 0;
            const error = new Error(esDevolucion
                ? `facturacion.helper: Item ${idx + 1} es una devolución (cantidad negativa). El pedido no es facturable por AFIP: emití PRESUPUESTO, o facturá solo los ítems de venta y generá NC por la devolución.`
                : `facturacion.helper: Item ${idx + 1} cantidad inválida`);
            error.statusCode = 400;
            throw error;
        }
        if (item.precio_unitario === undefined || item.precio_unitario === null) {
            const error = new Error(`facturacion.helper: Item ${idx + 1} sin precio_unitario`);
            error.statusCode = 400;
            throw error;
        }
    });
}

/**
 * Redondeo monetario consistente (2 decimales)
 * @private
 */
function _round2(val) {
    return Math.round(parseFloat(val || 0) * 100) / 100;
}

// ============================================================
// SECUENCIA ATÓMICA
// ============================================================

/**
 * Obtiene el próximo número de factura de forma atómica.
 * Usa INSERT ON CONFLICT para garantizar atomicidad sin race conditions.
 * Opcionalmente sincroniza con AFIP (para facturación masiva).
 * 
 * @param {object} client - Conexión con transacción activa
 * @param {object} params
 * @param {number} params.id_empresa - OBLIGATORIO
 * @param {number} params.punto_venta - Default PUNTO_VENTA_DEFAULT
 * @param {number} params.id_tipo_factura - OBLIGATORIO
 * @param {number} [params.ultimo_afip=0] - Último nro en AFIP (para sync, 0 si no aplica)
 * @returns {Promise<number>} Próximo número de factura
 */
async function obtenerProximoNumero(client, params) {
    _validarRequeridos(params, ['id_empresa', 'punto_venta', 'id_tipo_factura']);

    const {
        id_empresa,
        punto_venta,
        id_tipo_factura,
        ultimo_afip = 0
    } = params;

    // Patrón unificado: INSERT ON CONFLICT con GREATEST para sync AFIP
    // - Si no existe la fila: inserta con MAX(1, ultimo_afip + 1)
    // - Si existe: incrementa, pero nunca por debajo de ultimo_afip + 1
    // - El ON CONFLICT tiene lock implícito en PostgreSQL (row-level lock)
    const query = `
        INSERT INTO secuencia_facturas (id_empresa, punto_venta, id_tipo_factura, ultimo_numero)
        VALUES ($1, $2, $3, GREATEST(1, $4 + 1))
        ON CONFLICT (id_empresa, punto_venta, id_tipo_factura)
        DO UPDATE SET ultimo_numero = GREATEST(
            secuencia_facturas.ultimo_numero + 1,
            $4 + 1
        )
        RETURNING ultimo_numero
    `;

    const result = await client.query(query, [
        id_empresa, punto_venta, id_tipo_factura, ultimo_afip
    ]);

    const numero = result.rows[0].ultimo_numero;

    logger.info(`facturacion.helper: Secuencia empresa=${id_empresa} pv=${punto_venta} tipo=${id_tipo_factura} -> nro=${numero}`);

    return numero;
}

/**
 * Consulta el próximo número SIN incrementar (para preview en UI).
 * 
 * @param {object} client - Pool o client
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.punto_venta
 * @param {number} params.id_tipo_factura
 * @returns {Promise<number>} Próximo número estimado
 */
async function consultarProximoNumero(client, params) {
    _validarRequeridos(params, ['id_empresa', 'punto_venta', 'id_tipo_factura']);

    const {
        id_empresa,
        punto_venta,
        id_tipo_factura
    } = params;

    const query = `
        SELECT COALESCE(
            (SELECT ultimo_numero FROM secuencia_facturas
             WHERE id_empresa = $1 AND punto_venta = $2 AND id_tipo_factura = $3),
            (SELECT COALESCE(MAX(numero_factura), 0) FROM facturas
             WHERE id_empresa = $1 AND punto_venta = $2 AND id_tipo_factura = $3)
        ) + 1 AS proximo_numero
    `;

    const result = await client.query(query, [id_empresa, punto_venta, id_tipo_factura]);
    return parseInt(result.rows[0].proximo_numero);
}

// ============================================================
// RESOLUCIÓN DE PUNTO DE VENTA POR SUCURSAL
// ============================================================

/**
 * Resuelve el punto de venta AFIP a partir del depósito del usuario.
 * Si el depósito no tiene punto_venta_afip, lanza error.
 * También devuelve id_deposito para trazabilidad en facturas.
 * 
 * @param {object} client - Pool o client
 * @param {object} params
 * @param {number} params.id_deposito - Depósito del usuario (de req.usuario.id_deposito o JWT)
 * @param {number} [params.punto_venta_override] - Si se pasa, usa este en vez del del depósito
 * @returns {Promise<{punto_venta: number, id_deposito: number, nombre_deposito: string}>}
 */
async function resolverPuntoVenta(client, params) {
    // F3/I2 fix: id_empresa OBLIGATORIO para aislamiento multi-empresa
    _validarRequeridos(params, ['id_deposito', 'id_empresa']);

    const { id_deposito, id_empresa, punto_venta_override = null } = params;

    // Si el caller fuerza un punto de venta (ej: facturación masiva legacy), usarlo
    if (punto_venta_override) {
        return {
            punto_venta: punto_venta_override,
            id_deposito,
            nombre_deposito: null
        };
    }

    const result = await client.query(
        'SELECT id_deposito, nombre, punto_venta_afip FROM depositos WHERE id_deposito = $1 AND activo = true AND id_empresa = $2',
        [id_deposito, id_empresa]
    );

    if (result.rows.length === 0) {
        const error = new Error(`Depósito ${id_deposito} no encontrado o inactivo`);
        error.statusCode = 404;
        throw error;
    }

    const deposito = result.rows[0];

    if (!deposito.punto_venta_afip) {
        const error = new Error(
            `El depósito "${deposito.nombre}" no tiene punto de venta AFIP asignado. ` +
            `Configurarlo en Admin > Depósitos.`
        );
        error.statusCode = 400;
        throw error;
    }

    return {
        punto_venta: deposito.punto_venta_afip,
        id_deposito: deposito.id_deposito,
        nombre_deposito: deposito.nombre
    };
}

// ============================================================
// VERIFICACIONES
// ============================================================

/**
 * Verifica que un pedido no tenga factura activa (no anulada).
 * 
 * @param {object} client - Conexión con transacción activa
 * @param {object} params
 * @param {number} params.id_pedido
 * @param {number} params.id_empresa - OBLIGATORIO para aislamiento multi-empresa
 * @returns {Promise<void>} Lanza error si ya está facturado
 */
async function verificarNoFacturado(client, params) {
    _validarRequeridos(params, ['id_pedido', 'id_empresa']);

    const result = await client.query(`
        SELECT f.id_factura, f.numero_completo
        FROM facturas f
        WHERE f.id_pedido = $1
          AND f.id_empresa = $2
          AND f.estado != $3
        LIMIT 1
    `, [params.id_pedido, params.id_empresa, FACTURA_ESTADOS.ANULADA]);

    if (result.rows.length > 0) {
        const error = new Error(
            `El pedido ${params.id_pedido} ya tiene factura activa: ${result.rows[0].numero_completo}`
        );
        error.statusCode = 409; // Conflict
        throw error;
    }
}

// ============================================================
// CREAR FACTURA CON ITEMS (OPERACIÓN PRINCIPAL)
// ============================================================

/**
 * Crea una factura completa con sus items en una sola operación.
 * El caller es responsable de: BEGIN/COMMIT, obtener CAE de AFIP, 
 * y obtener el numero_factura via obtenerProximoNumero().
 * 
 * @param {object} client - Conexión con transacción activa
 * @param {object} params
 * @param {number} params.id_empresa - OBLIGATORIO
 * @param {number} params.id_cliente - OBLIGATORIO
 * @param {number} params.id_tipo_factura - OBLIGATORIO
 * @param {number} params.numero_factura - OBLIGATORIO (de obtenerProximoNumero)
 * @param {number} [params.punto_venta=6]
 * @param {number} [params.id_pedido=null]
 * @param {string} [params.cae=null]
 * @param {Date}   [params.cae_vencimiento=null]
 * @param {string} [params.observaciones=null]
 * @param {number} [params.id_moneda=null]
 * @param {number} [params.cotizacion=null]
 * @param {number} [params.descuento_porcentaje=0]
 * @param {number} [params.descuento_monto=0]
 * @param {number} [params.subtotal_sin_descuento=null]
 * @param {number} [params.descuento_fp_porcentaje=0]
 * @param {number} [params.descuento_fp_monto=0]
 * @param {number} [params.id_forma_pago_principal=null]
 * @param {number} [params.id_deposito=null] - Depósito/sucursal desde donde se emite (trazabilidad)
 * @param {Array}  params.items - OBLIGATORIO, array de items
 * @param {number} params.items[].id_producto
 * @param {number} params.items[].cantidad
 * @param {string} params.items[].descripcion
 * @param {number} params.items[].precio_unitario
 * @param {number} [params.items[].porcentaje_iva=21]
 * @param {number} [params.items[].precio_lista=null]
 * @param {number} [params.items[].descuento_porcentaje=0]
 * @param {number} [params.items[].descuento_monto=0]
 * @param {number} [params.items[].subtotal_sin_descuento=null]
 * @param {object} [options]
 * @param {boolean} [options.calcularTotales=true] - Calcula subtotal/iva/total desde items
 * @param {object} [options.totalesExternos] - Si calcularTotales=false, usar estos
 * 
 * @returns {Promise<object>} { id_factura, numero_completo, cae, cae_vencimiento, total, items_insertados }
 */
async function crearFacturaConItems(client, params, options = {}) {
    _validarRequeridos(params, ['id_empresa', 'id_cliente', 'id_tipo_factura', 'numero_factura', 'punto_venta', 'items']);
    _validarItems(params.items);

    const {
        id_empresa,
        id_cliente,
        id_tipo_factura,
        numero_factura,
        punto_venta,
        id_pedido = null,
        cae = null,
        cae_vencimiento = null,
        observaciones = null,
        id_moneda = null,
        cotizacion = null,
        descuento_porcentaje = 0,
        descuento_monto = 0,
        subtotal_sin_descuento = null,
        descuento_fp_porcentaje = 0,
        descuento_fp_monto = 0,
        id_forma_pago_principal = null,
        id_deposito = null,
        items
    } = params;

    const { calcularTotales = true, totalesExternos = null } = options;

    // --- Calcular totales desde items o usar externos ---
    let subtotal, total_iva, total;

    if (calcularTotales) {
        subtotal = 0;
        total_iva = 0;

        items.forEach(item => {
            const precio = parseFloat(item.precio_unitario);
            const cantidad = parseFloat(item.cantidad);
            const pctIva = parseFloat(item.porcentaje_iva || 21);
            const descItem = parseFloat(item.descuento_monto || 0);

            const subtotal_linea = _round2(precio * cantidad - descItem);
            const iva_linea = _round2(subtotal_linea * pctIva / 100);

            subtotal += subtotal_linea;
            total_iva += iva_linea;
        });

        subtotal = _round2(subtotal);
        total_iva = _round2(total_iva);
        total = _round2(subtotal + total_iva - parseFloat(descuento_monto || 0));
    } else if (totalesExternos) {
        subtotal = _round2(totalesExternos.subtotal);
        total_iva = _round2(totalesExternos.total_iva);
        total = _round2(totalesExternos.total);
    } else {
        const error = new Error('facturacion.helper: calcularTotales=false requiere totalesExternos');
        error.statusCode = 400;
        throw error;
    }

    // --- INSERT factura ---
    const facturaQuery = `
        INSERT INTO facturas (
            id_empresa, id_pedido, id_cliente, id_tipo_factura,
            punto_venta, numero_factura,
            fecha_emision, fecha_vencimiento,
            subtotal, total_iva, total,
            estado, cae, cae_vencimiento, observaciones,
            id_moneda, cotizacion,
            descuento_porcentaje, descuento_monto, subtotal_sin_descuento,
            descuento_fp_porcentaje, descuento_fp_monto,
            id_forma_pago_principal,
            id_deposito,
            fecha_creacion
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6,
            CURRENT_DATE, CURRENT_DATE + interval '30 days',
            $7, $8, $9,
            $10, $11, $12, $13,
            $14, $15,
            $16, $17, $18,
            $19, $20,
            $21,
            $22,
            NOW()
        )
        RETURNING id_factura, numero_completo, cae, cae_vencimiento, total
    `;

    const facturaResult = await client.query(facturaQuery, [
        id_empresa,                                     // $1
        id_pedido,                                      // $2
        id_cliente,                                     // $3
        id_tipo_factura,                                // $4
        punto_venta,                                    // $5
        numero_factura,                                 // $6
        subtotal,                                       // $7
        total_iva,                                      // $8
        total,                                          // $9
        FACTURA_ESTADOS.EMITIDA,                        // $10
        cae,                                            // $11
        cae_vencimiento,                                // $12
        observaciones,                                  // $13
        id_moneda,                                      // $14
        cotizacion,                                     // $15
        _round2(descuento_porcentaje),                  // $16
        _round2(descuento_monto),                       // $17
        subtotal_sin_descuento !== null 
            ? _round2(subtotal_sin_descuento) 
            : _round2(subtotal + parseFloat(descuento_monto || 0)),  // $18
        _round2(descuento_fp_porcentaje),               // $19
        _round2(descuento_fp_monto),                    // $20
        id_forma_pago_principal,                        // $21
        id_deposito                                     // $22
    ]);

    const factura = facturaResult.rows[0];
    const id_factura = factura.id_factura;

    // --- INSERT items ---
    let items_insertados = 0;

    for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const precio = parseFloat(item.precio_unitario);
        const cantidad = parseFloat(item.cantidad);
        const pctIva = parseFloat(item.porcentaje_iva || 21);
        const descItemMonto = parseFloat(item.descuento_monto || 0);

        const subtotal_linea = _round2(precio * cantidad - descItemMonto);
        const iva_linea = _round2(subtotal_linea * pctIva / 100);
        const total_linea = _round2(subtotal_linea + iva_linea);

        await client.query(`
            INSERT INTO factura_items (
                id_factura, id_empresa, id_producto, cantidad, descripcion,
                precio_unitario, porcentaje_iva, subtotal, iva_calculado, total,
                numero_linea,
                precio_lista, descuento_porcentaje, descuento_monto, subtotal_sin_descuento
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        `, [
            id_factura,                                             // $1
            id_empresa,                                             // $2
            item.id_producto,                                       // $3
            cantidad,                                               // $4
            item.descripcion || '',                                 // $5
            _round2(precio),                                        // $6
            pctIva,                                                 // $7
            subtotal_linea,                                         // $8
            iva_linea,                                              // $9
            total_linea,                                            // $10
            idx + 1,                                                // $11
            item.precio_lista !== undefined ? _round2(item.precio_lista) : null,  // $12
            _round2(item.descuento_porcentaje || 0),                // $13
            _round2(descItemMonto),                                 // $14
            item.subtotal_sin_descuento !== undefined 
                ? _round2(item.subtotal_sin_descuento) 
                : null                                              // $15
        ]);

        items_insertados++;
    }

    logger.info(
        `facturacion.helper: Factura creada id=${id_factura} nro=${factura.numero_completo} ` +
        `empresa=${id_empresa} items=${items_insertados} total=${total} cae=${cae || 'N/A'}`
    );

    return {
        id_factura,
        numero_completo: factura.numero_completo,
        cae: factura.cae,
        cae_vencimiento: factura.cae_vencimiento,
        total: parseFloat(factura.total),
        items_insertados
    };
}

// ============================================================
// ANULAR FACTURA
// ============================================================

/**
 * Anula una factura (cambia estado a 'anulada').
 * NO genera Nota de Crédito en AFIP — eso es responsabilidad del caller.
 * 
 * @param {object} client - Pool o client
 * @param {object} params
 * @param {number} params.id_factura - OBLIGATORIO
 * @param {number} params.id_empresa - OBLIGATORIO
 * @returns {Promise<object>} { id_factura, numero_completo, cae, requiere_nc }
 */
async function anularFactura(client, params) {
    _validarRequeridos(params, ['id_factura', 'id_empresa']);

    const { id_factura, id_empresa } = params;

    // Obtener datos actuales
    const facturaRes = await client.query(`
        SELECT id_factura, numero_completo, cae, estado, id_pedido, monto_pagado, total
        FROM facturas
        WHERE id_factura = $1 AND id_empresa = $2
    `, [id_factura, id_empresa]);

    if (facturaRes.rows.length === 0) {
        const error = new Error('Factura no encontrada');
        error.statusCode = 404;
        throw error;
    }

    const factura = facturaRes.rows[0];

    if (factura.estado === FACTURA_ESTADOS.ANULADA) {
        const error = new Error('La factura ya está anulada');
        error.statusCode = 400;
        throw error;
    }

    // Anular
    await client.query(`
        UPDATE facturas
        SET estado = $1
        WHERE id_factura = $2 AND id_empresa = $3
    `, [FACTURA_ESTADOS.ANULADA, id_factura, id_empresa]);

    const requiere_nc = factura.cae && !factura.cae.startsWith('OFFLINE');

    if (requiere_nc) {
        logger.warn(
            `facturacion.helper: Factura ${factura.numero_completo} anulada con CAE real ${factura.cae}. ` +
            `Se requiere Nota de Crédito en AFIP.`
        );
    }

    logger.info(`facturacion.helper: Factura anulada id=${id_factura} nro=${factura.numero_completo}`);

    return {
        id_factura,
        numero_completo: factura.numero_completo,
        cae: factura.cae,
        id_pedido: factura.id_pedido,
        requiere_nc
    };
}

// ============================================================
// ACTUALIZAR MONTO PAGADO
// ============================================================

/**
 * Actualiza el monto pagado de una factura y cambia el estado si corresponde.
 * Operación atómica: incrementa monto_pagado y evalúa si queda pagada/parcial.
 * 
 * Usada por: cajas-cobranzas (aplicarPago) y recibos (crear/anular)
 * 
 * @param {object} client - Conexión con transacción activa
 * @param {object} params
 * @param {number} params.id_factura - OBLIGATORIO
 * @param {number} params.id_empresa - OBLIGATORIO
 * @param {number} params.monto - Monto a sumar (positivo) o restar (negativo para anulaciones)
 * @returns {Promise<object>} { id_factura, monto_pagado_nuevo, estado_nuevo, saldo_pendiente }
 */
async function actualizarMontoPagado(client, params) {
    _validarRequeridos(params, ['id_factura', 'id_empresa', 'monto']);

    const { id_factura, id_empresa, monto } = params;
    const montoNumerico = parseFloat(monto);

    // Actualizar monto y obtener nuevo estado en una sola operación
    const result = await client.query(`
        UPDATE facturas
        SET monto_pagado = GREATEST(0, COALESCE(monto_pagado, 0) + $1),
            estado = CASE
                WHEN estado = $5 THEN $5
                WHEN GREATEST(0, COALESCE(monto_pagado, 0) + $1) >= total - $4 THEN $2
                WHEN GREATEST(0, COALESCE(monto_pagado, 0) + $1) > $4 THEN $3
                ELSE $6
            END
        WHERE id_factura = $7 AND id_empresa = $8
        RETURNING id_factura, monto_pagado, estado, total,
                  (total - COALESCE(monto_pagado, 0)) AS saldo_pendiente
    `, [
        montoNumerico,                      // $1 monto a sumar
        FACTURA_ESTADOS.PAGADA,             // $2
        FACTURA_ESTADOS.PARCIAL,            // $3
        TOLERANCIA_MONTO,                   // $4
        FACTURA_ESTADOS.ANULADA,            // $5 no cambiar si anulada
        FACTURA_ESTADOS.EMITIDA,            // $6 volver a emitida si queda en 0
        id_factura,                         // $7
        id_empresa                          // $8
    ]);

    if (result.rows.length === 0) {
        const error = new Error(`Factura ${id_factura} no encontrada en empresa ${id_empresa}`);
        error.statusCode = 404;
        throw error;
    }

    const row = result.rows[0];

    logger.info(
        `facturacion.helper: Pago aplicado factura=${id_factura} ` +
        `monto=${montoNumerico} pagado_total=${row.monto_pagado} ` +
        `estado=${row.estado} saldo=${row.saldo_pendiente}`
    );

    return {
        id_factura: row.id_factura,
        monto_pagado_nuevo: parseFloat(row.monto_pagado),
        estado_nuevo: row.estado,
        saldo_pendiente: parseFloat(row.saldo_pendiente)
    };
}

// ============================================================
// MARCAR PEDIDO COMO FACTURADO
// ============================================================

/**
 * Actualiza el estado del pedido a 'Facturado'.
 * Usa lookup por nombre para no depender de IDs hardcodeados.
 * 
 * @param {object} client - Conexión con transacción activa
 * @param {object} params
 * @param {number} params.id_pedido - OBLIGATORIO
 * @param {number} params.id_empresa - OBLIGATORIO (para validación multi-empresa)
 * @returns {Promise<void>}
 */
async function marcarPedidoFacturado(client, params) {
    _validarRequeridos(params, ['id_pedido', 'id_empresa']);

    const { id_pedido, id_empresa } = params;

    // F2 fix: resolver estado por nombre — no hardcodear IDs
    const estadoRes = await client.query(
        "SELECT id_estado FROM pedidoestados WHERE nombre = 'Facturado' LIMIT 1"
    );
    if (estadoRes.rows.length === 0) {
        const error = new Error('facturacion.helper: Estado "Facturado" no encontrado en pedidoestados');
        error.statusCode = 500;
        throw error;
    }
    const ESTADO_FACTURADO = estadoRes.rows[0].id_estado;

    const result = await client.query(`
        UPDATE pedidos
        SET id_estado = $1
        WHERE id_pedido = $2 AND id_empresa = $3
        RETURNING id_pedido
    `, [ESTADO_FACTURADO, id_pedido, id_empresa]);

    if (result.rows.length === 0) {
        logger.warn(`facturacion.helper: Pedido ${id_pedido} no encontrado en empresa ${id_empresa} al marcar facturado`);
    }
}

// ============================================================
// OBTENER FACTURA (para consultas que necesitan datos)
// ============================================================

/**
 * Obtiene una factura por ID con datos completos.
 * 
 * @param {object} client - Pool o client
 * @param {object} params
 * @param {number} params.id_factura
 * @param {number} params.id_empresa
 * @param {boolean} [params.incluirItems=false]
 * @returns {Promise<object|null>} Factura con datos o null
 */
async function obtenerFactura(client, params) {
    _validarRequeridos(params, ['id_factura', 'id_empresa']);

    const { id_factura, id_empresa, incluirItems = false } = params;

    const facturaRes = await client.query(`
        SELECT f.*,
               c.razon_social AS cliente, c.cuit_cuil, c.domicilio, c.email,
               ci.nombre AS condicion_iva_cliente,
               ft.codigo AS tipo_factura, ft.nombre AS tipo_factura_nombre, ft.discrimina_iva,
               e.razon_social AS empresa_nombre, e.cuit AS empresa_cuit,
               e.domicilio_fiscal AS empresa_direccion,
               e.fecha_inicio_actividades AS empresa_inicio_actividades
        FROM facturas f
        JOIN clientes c ON f.id_cliente = c.id_cliente
        LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
        JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
        JOIN empresas e ON f.id_empresa = e.id_empresa
        WHERE f.id_factura = $1 AND f.id_empresa = $2
    `, [id_factura, id_empresa]);

    if (facturaRes.rows.length === 0) {
        return null;
    }

    const factura = facturaRes.rows[0];

    if (incluirItems) {
        const itemsRes = await client.query(`
            SELECT fi.*, p.nombre AS producto_nombre, p.sku
            FROM factura_items fi
            JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1 AND fi.id_empresa = $2
            ORDER BY fi.numero_linea
        `, [id_factura, id_empresa]);

        factura.items = itemsRes.rows;
    }

    return factura;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // Constantes
    FACTURA_ESTADOS,
    FACTURA_TIPOS,
    PUNTO_VENTA_DEFAULT,

    // Secuencia
    obtenerProximoNumero,
    consultarProximoNumero,

    // Resolución sucursal
    resolverPuntoVenta,

    // Verificaciones
    verificarNoFacturado,

    // CRUD
    crearFacturaConItems,
    anularFactura,
    actualizarMontoPagado,
    marcarPedidoFacturado,
    obtenerFactura
};
