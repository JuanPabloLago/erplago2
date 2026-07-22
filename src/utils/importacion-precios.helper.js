/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IMPORTACIÓN LISTAS PROVEEDOR HELPER — ERP LAGO
 * Centraliza: parseo Excel, matcheo por codigo_proveedor, aplicación masiva,
 *             actualización de costo_vigente, recálculo listas SOBRE_COSTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * FLUJO:
 *   1. parsearListaProveedor() → lee Excel, detecta columnas
 *   2. matchearProductos()     → vincula codigo_proveedor → id_producto
 *   3. aplicarImportacion()    → transacción: actualiza costos + tracking
 *   4. recalcularListasDesdeCosto() → recalcula listas tipo SOBRE_COSTO
 *
 * TABLAS:
 *   - producto_proveedor                (UPDATE precio_compra, descuento)
 *   - inventario                        (UPDATE costo_vigente)
 *   - importacion_listas_proveedor      (INSERT tracking cabecera)
 *   - importacion_listas_proveedor_detalle (INSERT tracking detalle)
 *   - precios                           (UPDATE por recálculo)
 *   - proveedores                       (READ descuento_general)
 *   - listasdeprecios                   (READ config listas)
 *
 * CONSUMIDORES:
 *   - (futuro) importacion-precios.controller.js
 */

'use strict';

const XLSX = require('xlsx');
const preciosHelper = require('./precios.helper');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// PARSEO EXCEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee un Excel de lista de proveedor y normaliza las columnas.
 * Detecta automáticamente las columnas por nombre de header.
 * @param {Buffer} buffer - archivo Excel
 * @returns {{ filas: Array<{codigo, descripcion, precio, descuento}>, columnas_detectadas: Object }}
 */
async function parsearListaProveedor(buffer, opciones = {}) {
    // opciones: { hoja, fila_inicio, mapeo_manual: {codigo, descripcion, precio, descuento} }
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = opciones.hoja || workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo no tiene hojas');
    if (!workbook.Sheets[sheetName]) throw new Error(`La hoja "${sheetName}" no existe en el archivo`);

    const opcionesSheet = { defval: '' };
    if (opciones.fila_inicio && opciones.fila_inicio > 1) {
        opcionesSheet.range = opciones.fila_inicio - 1;
    }
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], opcionesSheet);
    if (!data || !data.length) throw new Error('El archivo está vacío o no tiene datos');

    const headers = Object.keys(data[0]);
    let mapeo;

    if (opciones.mapeo_manual) {
        // Mapeo manual del modal: usar tal cual, validar que existan los headers
        mapeo = {
            codigo: opciones.mapeo_manual.codigo || null,
            descripcion: opciones.mapeo_manual.descripcion || null,
            precio: opciones.mapeo_manual.precio || null,
            descuento: opciones.mapeo_manual.descuento || null
        };
        for (const [campo, header] of Object.entries(mapeo)) {
            if (header && !headers.includes(header)) {
                throw new Error(`La columna "${header}" mapeada a "${campo}" no existe en el archivo`);
            }
        }
    } else {
        // Auto-detección por regex (comportamiento original)
        mapeo = {
            codigo: headers.find(h => /^(codigo|cod|code|sku|art|articulo)/i.test(h.trim())),
            descripcion: headers.find(h => /^(desc|nombre|product|detalle|articulo)/i.test(h.trim())),
            precio: headers.find(h => /^(precio|price|p\.?\s*lista|importe|valor)/i.test(h.trim())),
            descuento: headers.find(h => /^(desc[\.\s]*%|descuento|dto|bonif|discount)/i.test(h.trim()))
        };
    }

    if (!mapeo.codigo) throw new Error('No se detectó columna de código. Headers disponibles: ' + headers.join(', '));
    if (!mapeo.precio) throw new Error('No se detectó columna de precio. Headers disponibles: ' + headers.join(', '));

    const filas = [];
    for (const row of data) {
        const codigo = String(row[mapeo.codigo] || '').trim();
        if (!codigo) continue;

        const precio = parseFloat(row[mapeo.precio]);
        if (isNaN(precio) || precio <= 0) continue;

        filas.push({
            codigo,
            descripcion: mapeo.descripcion ? String(row[mapeo.descripcion] || '').trim() : '',
            precio,
            descuento: mapeo.descuento ? parseFloat(row[mapeo.descuento]) || 0 : null
        });
    }

    logger.info(`[importacion-precios] Parseadas ${filas.length} filas válidas de ${data.length} totales`);

    return {
        filas,
        columnas_detectadas: {
            codigo: mapeo.codigo,
            descripcion: mapeo.descripcion || '(no detectada)',
            precio: mapeo.precio,
            descuento: mapeo.descuento || '(no detectada - usará descuento general)'
        },
        total_filas_archivo: data.length
    };
}

/**
 * Inspecciona un Excel sin parsear/validar. Devuelve hojas, headers y preview
 * de las primeras 5 filas. Alimenta el modal de mapeo manual del frontend.
 * @param {Buffer} buffer
 * @returns {{ hojas: string[], inspeccion: Object<string, {headers, preview}> }}
 */
function inspeccionarExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const hojas = workbook.SheetNames;
    if (!hojas.length) throw new Error('El archivo no tiene hojas');

    const inspeccion = {};
    for (const nombreHoja of hojas) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[nombreHoja], { defval: '', header: 1 });
        // header:1 devuelve arrays — primera fila = headers, resto = datos
        const headers = (data[0] || []).map(h => String(h || '').trim()).filter(Boolean);
        const preview = data.slice(1, 6); // primeras 5 filas de datos
        inspeccion[nombreHoja] = { headers, preview, total_filas: Math.max(0, data.length - 1) };
    }

    return { hojas, inspeccion };
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHEO POR CÓDIGO PROVEEDOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Vincula códigos del Excel con productos internos via producto_proveedor.
 * @returns {{ matcheadas: Array, no_encontradas: Array }}
 */
async function matchearProductos(client, { id_empresa, id_proveedor, filas }) {
    // Traer todos los codigo_proveedor de este proveedor de una sola vez
    const { rows: vinculos } = await client.query(`
        SELECT pp.id_producto, pp.codigo_proveedor, pp.precio_compra, 
               pp.descuento_porcentaje, pp.precio_neto, pp.es_proveedor_preferido,
               p.nombre, p.sku
        FROM producto_proveedor pp
        JOIN productos p ON p.id_producto = pp.id_producto
        WHERE pp.id_empresa = $1 AND pp.id_proveedor = $2 AND pp.activo = true
    `, [id_empresa, id_proveedor]);

    // Mapa: codigo_proveedor (normalizado) → datos
    const mapaCodigos = new Map();
    for (const v of vinculos) {
        const codNorm = String(v.codigo_proveedor || '').trim().toUpperCase();
        if (codNorm) mapaCodigos.set(codNorm, v);
    }

    // Obtener descuento general del proveedor
    const { rows: [prov] } = await client.query(
        'SELECT descuento_general FROM proveedores WHERE id_proveedor = $1',
        [id_proveedor]
    );
    const descuentoGeneral = parseFloat(prov?.descuento_general) || 0;

    const matcheadas = [];
    const no_encontradas = [];

    for (const fila of filas) {
        const codNorm = fila.codigo.toUpperCase();
        const vinculo = mapaCodigos.get(codNorm);

        // Descuento: si la fila trae uno propio lo usa, sino el general
        const descuentoFinal = fila.descuento !== null ? fila.descuento : descuentoGeneral;
        const precioNetoNuevo = Math.round(fila.precio * (1 - descuentoFinal / 100) * 10000) / 10000;

        if (vinculo) {
            const cambio = Math.abs(vinculo.precio_compra - fila.precio) > 0.01 ||
                           Math.abs(vinculo.descuento_porcentaje - descuentoFinal) > 0.01;

            matcheadas.push({
                ...fila,
                descuento: descuentoFinal,
                precio_neto_nuevo: precioNetoNuevo,
                id_producto: vinculo.id_producto,
                sku: vinculo.sku,
                nombre_producto: vinculo.nombre,
                precio_compra_anterior: parseFloat(vinculo.precio_compra),
                descuento_anterior: parseFloat(vinculo.descuento_porcentaje),
                precio_neto_anterior: parseFloat(vinculo.precio_neto),
                es_proveedor_preferido: vinculo.es_proveedor_preferido,
                hay_cambio: cambio,
                variacion_pct: vinculo.precio_neto > 0
                    ? Math.round((precioNetoNuevo - vinculo.precio_neto) / vinculo.precio_neto * 10000) / 100
                    : null
            });
        } else {
            no_encontradas.push({
                ...fila,
                descuento: descuentoFinal,
                precio_neto_nuevo: precioNetoNuevo
            });
        }
    }

    return { matcheadas, no_encontradas, descuento_general_usado: descuentoGeneral };
}

// ═══════════════════════════════════════════════════════════════════════════
// APLICAR IMPORTACIÓN (TRANSACCIONAL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica la importación confirmada. Debe llamarse dentro de una transacción.
 * @param {Client} client - cliente PG dentro de transacción
 * @returns {{ id_importacion, actualizados, sin_cambio, no_encontrados }}
 */
async function aplicarImportacion(client, { 
    id_empresa, id_proveedor, id_usuario, 
    matcheadas, no_encontradas, 
    descuento_general_usado, archivo_nombre, observaciones 
}) {
    let actualizados = 0;
    let sin_cambio = 0;

    // 1. Crear cabecera tracking
    const { rows: [cab] } = await client.query(`
        INSERT INTO importacion_listas_proveedor 
        (id_empresa, id_proveedor, archivo_nombre, descuento_aplicado, id_usuario, observaciones)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id_importacion
    `, [id_empresa, id_proveedor, archivo_nombre, descuento_general_usado, id_usuario, observaciones || null]);
    const id_importacion = cab.id_importacion;

    // 2. Procesar matcheadas
    for (const m of matcheadas) {
        if (m.hay_cambio) {
            // Actualizar producto_proveedor (trigger BD recalcula precio_neto)
            await client.query(`
                UPDATE producto_proveedor 
                SET precio_compra = $1, descuento_porcentaje = $2
                WHERE id_empresa = $3 AND id_producto = $4 AND id_proveedor = $5
            `, [m.precio, m.descuento, id_empresa, m.id_producto, id_proveedor]);

            // Actualizar costo_vigente si es proveedor preferido
            if (m.es_proveedor_preferido) {
                await client.query(`
                    UPDATE inventario SET costo_vigente = $1
                    WHERE id_empresa = $2 AND id_producto = $3
                `, [m.precio_neto_nuevo, id_empresa, m.id_producto]);
            }

            actualizados++;
        } else {
            sin_cambio++;
        }

        // Detalle tracking (siempre, cambio o no)
        await client.query(`
            INSERT INTO importacion_listas_proveedor_detalle
            (id_importacion, codigo_proveedor, descripcion_proveedor,
             precio_lista_anterior, precio_lista_nuevo, 
             descuento_anterior, descuento_nuevo,
             precio_neto_anterior, precio_neto_nuevo,
             id_producto, estado, id_empresa)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [
            id_importacion, m.codigo, m.descripcion,
            m.precio_compra_anterior, m.precio,
            m.descuento_anterior, m.descuento,
            m.precio_neto_anterior, m.precio_neto_nuevo,
            m.id_producto, m.hay_cambio ? 'ACTUALIZADO' : 'SIN_CAMBIO', id_empresa
        ]);
    }

    // 3. Registrar no encontradas
    for (const ne of no_encontradas) {
        await client.query(`
            INSERT INTO importacion_listas_proveedor_detalle
            (id_importacion, codigo_proveedor, descripcion_proveedor,
             precio_lista_nuevo, descuento_nuevo, precio_neto_nuevo,
             estado, id_empresa)
            VALUES ($1,$2,$3,$4,$5,$6,'NO_ENCONTRADO',$7)
        `, [id_importacion, ne.codigo, ne.descripcion, ne.precio, ne.descuento, ne.precio_neto_nuevo, id_empresa]);
    }

    // 4. Actualizar contadores cabecera
    await client.query(`
        UPDATE importacion_listas_proveedor 
        SET productos_actualizados = $1, productos_sin_cambio = $2, productos_no_encontrados = $3
        WHERE id_importacion = $4
    `, [actualizados, sin_cambio, no_encontradas.length, id_importacion]);

    logger.info(`[importacion-precios] Importación #${id_importacion}: ${actualizados} actualizados, ${sin_cambio} sin cambio, ${no_encontradas.length} no encontrados`);

    return { 
        id_importacion, 
        actualizados, 
        sin_cambio, 
        no_encontrados: no_encontradas.length 
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// RECÁLCULO LISTAS DESDE COSTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recalcula UNA lista tipo SOBRE_COSTO.
 * precio = costo_vigente × (1 + margen/100) → redondeo argentino sobre precio+IVA → back-calc neto
 */
async function recalcularDesdeCosto(client, { id_lista_precio, id_empresa, ids_productos }) {
    const { rows: [lista] } = await client.query(
        'SELECT * FROM listasdeprecios WHERE id_lista_precio = $1 AND id_empresa = $2',
        [id_lista_precio, id_empresa]
    );
    if (!lista) throw new Error('Lista no encontrada');
    if (lista.tipo_calculo !== 'SOBRE_COSTO') throw new Error('Esta lista no es tipo SOBRE_COSTO');

    const margenLista = lista.margen_sobre_costo !== null ? parseFloat(lista.margen_sobre_costo) : null;
    // Redondeo lo resuelve escribirPrecio segun la lista (redondea_con_iva).

    // Si se pasan ids_productos, solo recalcular esos. Si no, todos (para uso manual desde admin).
    const filtroProductos = ids_productos && ids_productos.length > 0
        ? 'AND inv.id_producto = ANY($3)'
        : '';
    const params = [id_lista_precio, id_empresa];
    if (ids_productos && ids_productos.length > 0) params.push(ids_productos);

    const { rows: productos } = await client.query(`
        SELECT inv.id_producto, inv.costo_vigente,
               COALESCE(a.porcentaje, 21) as iva_pct,
               pr.margen_individual
        FROM inventario inv
        JOIN productos p ON p.id_producto = inv.id_producto AND p.activo = true
        LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
        LEFT JOIN precios pr ON pr.id_producto = inv.id_producto 
            AND pr.id_lista_precio = $1 AND pr.id_empresa = $2
        WHERE inv.id_empresa = $2 AND inv.costo_vigente > 0 ${filtroProductos}
    `, params);

    let procesados = 0;
    let sinMargen = 0;
    const omitidos = [];

    for (const prod of productos) {
        const margen = prod.margen_individual !== null ? parseFloat(prod.margen_individual) : margenLista;
        if (margen === null) { sinMargen++; continue; }

        const netoVenta = parseFloat(prod.costo_vigente) * (1 + margen / 100);
        try {
            await preciosHelper.escribirPrecio({
                id_empresa, id_producto: prod.id_producto, id_lista: id_lista_precio,
                precio_input: netoVenta, modo_input: 'NETO', contexto: 'recalcularDesdeCosto', client
            });
            await client.query(
                `UPDATE precios SET margen_individual = $1 WHERE id_producto = $2 AND id_lista_precio = $3 AND id_empresa = $4`,
                [margen, prod.id_producto, id_lista_precio, id_empresa]
            );
            procesados++;
        } catch (e) {
            omitidos.push({ id_producto: prod.id_producto, motivo: e.message });
        }
    }

    logger.info(`[importacion-precios] Lista ${lista.nombre} recalculada: ${procesados} procesados, ${sinMargen} sin margen, ${omitidos.length} omitidos`);

    return { procesados, sin_margen: sinMargen, omitidos, total: productos.length, margen_lista: margenLista };
}

/**
 * Recalcula TODAS las listas SOBRE_COSTO de una empresa.
 * Útil post-importación de lista de proveedor.
 */
async function recalcularTodasDesdeCosto(client, { id_empresa, ids_productos }) {
    const { rows: listas } = await client.query(`
        SELECT id_lista_precio, nombre, margen_sobre_costo
        FROM listasdeprecios 
        WHERE id_empresa = $1 AND tipo_calculo = 'SOBRE_COSTO' 
          AND margen_sobre_costo IS NOT NULL AND activa = true
        ORDER BY orden
    `, [id_empresa]);

    const resultados = [];
    for (const lista of listas) {
        const res = await recalcularDesdeCosto(client, { 
            id_lista_precio: lista.id_lista_precio, 
            id_empresa,
            ids_productos
        });
        resultados.push({ ...res, nombre: lista.nombre, id_lista_precio: lista.id_lista_precio });
    }

    return resultados;
}

/**
 * Actualiza costo_vigente de un producto individual.
 * Se llama desde compras.helper al registrar comprobante de compra.
 */
async function actualizarCostoVigente(client, { id_empresa, id_producto }) {
    // Tomar precio_neto del proveedor preferido (o el menor si no hay preferido)
    const { rows } = await client.query(`
        SELECT precio_neto FROM producto_proveedor
        WHERE id_empresa = $1 AND id_producto = $2 AND activo = true
        ORDER BY es_proveedor_preferido DESC, precio_neto ASC
        LIMIT 1
    `, [id_empresa, id_producto]);

    if (rows.length > 0 && rows[0].precio_neto > 0) {
        await client.query(
            'UPDATE inventario SET costo_vigente = $1 WHERE id_empresa = $2 AND id_producto = $3',
            [rows[0].precio_neto, id_empresa, id_producto]
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// INSPECCIÓN DE ARCHIVO (para modal de mapeo)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee el Excel y devuelve metadatos para que el frontend muestre el modal:
 *   - Lista de hojas disponibles
 *   - Headers de la hoja elegida (con fila_inicio aplicada)
 *   - Preview: primeras 5 filas como muestra
 *   - Auto-detección sugerida (mismo regex que parsearListaProveedor)
 * NO matchea contra BD. NO valida obligatorios. Solo lee.
 */
async function inspeccionarArchivo(buffer, opciones = {}) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) throw new Error('El archivo no tiene hojas');

    const hojas = workbook.SheetNames;
    const hojaElegida = opciones.hoja || hojas[0];
    if (!workbook.Sheets[hojaElegida]) {
        throw new Error(`Hoja "${hojaElegida}" no existe. Disponibles: ${hojas.join(', ')}`);
    }

    const filaInicio = parseInt(opciones.fila_inicio) || 1;
    const sheetOpts = { defval: '' };
    if (filaInicio > 1) sheetOpts.range = filaInicio - 1;

    const data = XLSX.utils.sheet_to_json(workbook.Sheets[hojaElegida], sheetOpts);
    const headers = data.length > 0 ? Object.keys(data[0]) : [];

    // Auto-detección sugerida (no obliga, solo sugiere al modal)
    const sugerencia = {
        codigo: headers.find(h => /^(codigo|cod|code|sku|art|articulo)/i.test(h.trim())) || null,
        descripcion: headers.find(h => /^(desc|nombre|product|detalle|articulo)/i.test(h.trim())) || null,
        precio: headers.find(h => /^(precio|price|p\.?\s*lista|importe|valor)/i.test(h.trim())) || null,
        descuento: headers.find(h => /^(desc[\.\s]*%|descuento|dto|bonif|discount)/i.test(h.trim())) || null
    };

    return {
        hojas,
        hoja_actual: hojaElegida,
        fila_inicio: filaInicio,
        headers,
        sugerencia,
        preview: data.slice(0, 5),
        total_filas: data.length
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Inspección (modal mapeo)
    inspeccionarArchivo,
    // Parseo
    parsearListaProveedor,
    inspeccionarExcel,
    // Matcheo
    matchearProductos,
    // Aplicación
    aplicarImportacion,
    // Recálculo
    recalcularDesdeCosto,
    recalcularTodasDesdeCosto,
    // Costo
    actualizarCostoVigente
};
