/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCTOS-EXPORT HELPER — ERP LAGO
 * Generador único de Excels de productos (read-only, multi-perfil, multi-modo)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RESPONSABILIDAD ÚNICA: dado un filtro y opciones, devuelve un buffer Excel
 * con productos, precios, stock, proveedor y variantes.
 *
 * REGLAS CONTRACTUALES:
 *   1. precios.precio en BD es SIEMPRE NETO. La conversión a FINAL_CON_IVA
 *      se hace acá producto-por-producto usando la alícuota REAL del producto.
 *      Cero hardcode (nada de `|| 21`).
 *   2. NO escribe en BD. Read-only puro.
 *   3. NO depende de Express (no toca req/res). Devuelve buffer.
 *   4. La conversión IVA pasa SIEMPRE por iva.helper. Si un producto no tiene
 *      alícuota válida, esa fila se exporta con precio NETO y un warning.
 *
 * COLUMNAS DE LECTURA INFORMATIVA (jamás se reimportan):
 *   - Costo_Vigente_(info)   — viene de inventario.costo_vigente
 *   - Stock_Real_(info)      — viene de inventario.stock_real
 *   - Precio_Neto_Prov_(info) — viene de producto_proveedor.precio_neto (calculado por trigger)
 *
 * MARCADOR DE MODO PRECIO:
 *   La hoja "Instrucciones" incluye una celda __META_MODO_PRECIO__ con valor
 *   NETO o FINAL_CON_IVA. El parser de import lo lee para auto-configurar.
 *
 * @module productos-export.helper
 */

'use strict';

const XLSX = require('xlsx');
const ivaHelper = require('./iva.helper');
const configHelper = require('./config.helper');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const PERFILES = Object.freeze({
    RAPIDO:   'RAPIDO',
    BASICO:   'BASICO',
    COMPLETO: 'COMPLETO'
});

const MODOS_PRECIO = Object.freeze({
    NETO:           'NETO',
    FINAL_CON_IVA:  'FINAL_CON_IVA'
});

// Sufijos de columnas según modo (se renderizan en headers de listas de precio)
const SUFIJO_PRECIO = Object.freeze({
    [MODOS_PRECIO.NETO]:          's_IVA',
    [MODOS_PRECIO.FINAL_CON_IVA]: 'c_IVA'
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════════════════════════════════════

function slug(s) {
    return String(s || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function sanitizeFilename(s) {
    return String(s || 'export').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
}

/**
 * Convierte un neto a precio mostrado según modoPrecio.
 * Si modo=NETO devuelve el neto tal cual.
 * Si modo=FINAL_CON_IVA aplica la alícuota REAL del producto.
 * Si la alícuota no es válida, devuelve neto y agrega warning.
 *
 * @param {number|null} neto
 * @param {number|null} ivaPct — alícuota real del producto
 * @param {string} modoPrecio
 * @param {Array} warnings — array donde se acumulan warnings
 * @param {string} ctx — contexto para el warning (sku, lista)
 */
function convertirPrecio(neto, ivaPct, modoPrecio, warnings, ctx) {
    if (neto === null || neto === undefined || neto === '') return '';
    const n = parseFloat(neto);
    if (isNaN(n)) return '';

    if (modoPrecio === MODOS_PRECIO.NETO) {
        return Math.round(n * 100) / 100;
    }

    if (modoPrecio === MODOS_PRECIO.FINAL_CON_IVA) {
        if (ivaPct === null || ivaPct === undefined || isNaN(parseFloat(ivaPct))) {
            warnings.push(`${ctx}: sin alícuota IVA válida, exportado como NETO`);
            return Math.round(n * 100) / 100;
        }
        const final = ivaHelper.netoAFinal(n, parseFloat(ivaPct));
        return Math.round(final * 100) / 100;
    }

    throw new Error(`productos-export.helper.convertirPrecio: modoPrecio inválido "${modoPrecio}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DEL WHERE SEGÚN FILTRO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} filtro - { tipo: 'todos'|'ids'|'archivo_origen', valor }
 * @returns {Object} { whereSQL, params } — params NO incluye id_empresa (es $1)
 */
function buildWhereClause(filtro) {
    const tipo = filtro?.tipo || 'todos';

    if (tipo === 'todos') {
        return { whereSQL: 'p.activo = true', extraParams: [] };
    }
    if (tipo === 'ids') {
        if (!Array.isArray(filtro.valor) || filtro.valor.length === 0) {
            throw new Error('productos-export.helper: filtro tipo=ids requiere array no vacío');
        }
        return { whereSQL: 'p.activo = true AND p.id_producto = ANY($2::int[])', extraParams: [filtro.valor] };
    }
    if (tipo === 'archivo_origen') {
        if (!filtro.valor) throw new Error('productos-export.helper: filtro tipo=archivo_origen requiere valor');
        return { whereSQL: 'p.activo = true AND p.archivo_origen = $2', extraParams: [filtro.valor] };
    }
    throw new Error(`productos-export.helper: filtro.tipo desconocido "${tipo}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERY PRINCIPAL — devuelve todos los datos crudos del producto
// ═══════════════════════════════════════════════════════════════════════════

async function fetchProductos(client, { id_empresa, filtro }) {
    const { whereSQL, extraParams } = buildWhereClause(filtro);

    const sql = `
        SELECT
            p.id_producto,
            p.sku,
            p.nombre,
            p.descripcion,
            p.unidad_medida,
            p.tiene_variantes,
            p.archivo_origen,
            p.id_producto_padre,
            p.visible_web,
            p.url_imagen,
            p.cod_proveedor,
            p.variante_atributos,
            p.id_alicuota_iva,
            (SELECT pp2.sku FROM productos pp2 WHERE pp2.id_producto = p.id_producto_padre) AS sku_padre,
            c.nombre AS categoria,
            cs.nombre AS subcategoria,
            m.nombre AS marca,
            i.stock_minimo,
            i.stock_maximo,
            i.stock_real,
            i.costo_vigente,
            a.porcentaje AS alicuota_iva_pct,
            a.id_alicuota AS alicuota_iva_id,
            (SELECT string_agg(codigo_barras, '|' ORDER BY codigo_barras)
                FROM productocodigosbarras pcb
                WHERE pcb.id_producto = p.id_producto) AS codigos_barras,
            (SELECT json_object_agg(pr.id_lista_precio, pr.precio)
                FROM precios pr WHERE pr.id_empresa = $1 AND pr.id_producto = p.id_producto) AS precios,
            (SELECT json_object_agg(pr.id_lista_precio, pr.margen_individual)
                FROM precios pr
                WHERE pr.id_empresa = $1 AND pr.id_producto = p.id_producto AND pr.margen_individual IS NOT NULL) AS margenes,
            (SELECT json_build_object(
                    'razon_social', prov.razon_social,
                    'codigo_proveedor', pp.codigo_proveedor,
                    'precio_compra', pp.precio_compra,
                    'descuento_porcentaje', pp.descuento_porcentaje,
                    'precio_neto', pp.precio_neto,
                    'es_proveedor_preferido', pp.es_proveedor_preferido)
                FROM producto_proveedor pp
                JOIN proveedores prov ON pp.id_proveedor = prov.id_proveedor
                WHERE pp.id_producto = p.id_producto AND pp.id_empresa = $1 AND pp.activo = true
                ORDER BY pp.es_proveedor_preferido DESC NULLS LAST
                LIMIT 1) AS proveedor_info,
            (SELECT json_agg(json_build_object(
                    'sku', pv.sku,
                    'nombre_variante', pv.nombre_variante,
                    'precio', pv.precio,
                    'stock_minimo', pv.stock_minimo,
                    'atributos', pv.atributos) ORDER BY pv.sku)
                FROM producto_variantes pv
                WHERE pv.id_producto = p.id_producto AND pv.activo = true) AS variantes
        FROM productos p
        LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
        LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
        LEFT JOIN categorias cs ON p.id_subcategoria = cs.id_categoria
        LEFT JOIN marcas m ON p.id_marca = m.id_marca
        LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
        WHERE ${whereSQL}
        ORDER BY p.sku
    `;

    const params = [id_empresa, ...extraParams];
    const { rows } = await client.query(sql, params);
    return rows;
}

async function fetchListas(client, id_empresa) {
    const { rows } = await client.query(
        `SELECT id_lista_precio, nombre
           FROM listasdeprecios
          WHERE id_empresa = $1 AND activa = true
          ORDER BY orden, id_lista_precio`,
        [id_empresa]
    );
    return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DE HEADERS SEGÚN PERFIL + MODO PRECIO
// ═══════════════════════════════════════════════════════════════════════════

function buildHeaders({ perfil, modoPrecio, listas, exportOpts = {} }) {
    const sufijo = SUFIJO_PRECIO[modoPrecio];
    const colsPrecios = listas.flatMap(l => [
        `Precio_${slug(l.nombre)}_${sufijo}`,
        `Margen_${slug(l.nombre)}`
    ]);

    // Slots dinamicos segun configuraciones_empresa (productos.export.*)
    const incluirSubcategoria = exportOpts.incluirSubcategoria !== false;
    const incluirImagenUrl    = exportOpts.incluirImagenUrl    !== false;
    const colSubcategoria = incluirSubcategoria ? ['Subcategoria'] : [];
    const colImagenUrl    = incluirImagenUrl    ? ['URL_Imagen']   : [];

    if (perfil === PERFILES.RAPIDO) {
        return [
            'SKU',
            ...colsPrecios,
            'Costo_Vigente_(info)',
            'Precio_Compra'
        ];
    }

    if (perfil === PERFILES.BASICO) {
        return [
            'SKU_Padre', 'SKU', 'Nombre', 'Presentacion', 'Descripcion',
            'Categoria', ...colSubcategoria, 'Marca', 'Unidad', 'Alicuota_IVA', 'Codigos_Barras',
            ...colsPrecios,
            'Costo_Vigente_(info)',
            'Proveedor', 'Codigo_Proveedor', 'Precio_Compra', 'Descuento_Proveedor_%',
            'Stock_Minimo', 'Stock_Maximo',
            ...colImagenUrl,  // Bloque P2: URL_Imagen tambien en BASICO si productos.export.incluir_imagen_url=true
            'Archivo_Origen'
        ];
    }

    if (perfil === PERFILES.COMPLETO) {
        return [
            'SKU_Padre', 'SKU', 'Nombre', 'Presentacion', 'Descripcion',
            'Categoria', ...colSubcategoria, 'Marca', 'Unidad', 'Alicuota_IVA', 'Codigos_Barras',
            ...colsPrecios,
            'Costo_Vigente_(info)',
            'Proveedor', 'Codigo_Proveedor', 'Precio_Compra', 'Descuento_Proveedor_%',
            'Precio_Neto_Prov_(info)', 'Es_Proveedor_Preferido',
            'Stock_Minimo', 'Stock_Maximo', 'Stock_Real_(info)',
            'Visible_Web', // Bloque 7.7: removida columna fantasma Publicado_Web (no existia en BD - generaba desalineacion en COMPLETO)
            ...colImagenUrl, 'Cod_Proveedor_Legacy', 'Variante_Atributos_JSON',
            'Archivo_Origen'
        ];
    }

    throw new Error(`productos-export.helper.buildHeaders: perfil inválido "${perfil}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ARMADO DE FILAS
// ═══════════════════════════════════════════════════════════════════════════

function buildFilaProducto({ prod, perfil, modoPrecio, listas, warnings, exportOpts = {} }) {
    const ctx = `SKU ${prod.sku}`;
    const ivaPct = prod.alicuota_iva_pct;

    // Slots dinamicos segun config (mismo flag que en buildHeaders)
    const incluirSubcategoria = exportOpts.incluirSubcategoria !== false;
    const incluirImagenUrl    = exportOpts.incluirImagenUrl    !== false;
    const valSubcategoria = incluirSubcategoria ? [prod.subcategoria || ''] : [];

    // Celdas de precios y margenes (compartidas por todos los perfiles)
    const celdasPrecios = listas.flatMap(l => {
        const neto = prod.precios?.[l.id_lista_precio];
        const margen = prod.margenes?.[l.id_lista_precio];
        return [
            convertirPrecio(neto, ivaPct, modoPrecio, warnings, `${ctx} lista=${l.nombre}`),
            margen ?? ''
        ];
    });

    // Precio_Compra: viene del proveedor, está sin IVA en BD pero lo respetamos como NETO siempre
    // (no es lo que ve el cliente, es lo que pagamos al proveedor — modo NETO siempre)
    const precioCompra = prod.proveedor_info?.precio_compra
        ? Math.round(parseFloat(prod.proveedor_info.precio_compra) * 100) / 100
        : '';

    if (perfil === PERFILES.RAPIDO) {
        return [
            prod.sku,
            ...celdasPrecios,
            prod.costo_vigente || '',
            precioCompra
        ];
    }

    // Comunes a BASICO y COMPLETO
    const comunes = [
        prod.sku_padre || '',
        prod.sku,
        prod.nombre,
        '', // Presentacion (solo se usa en filas de variante)
        prod.descripcion || '',
        prod.categoria || '',
        ...valSubcategoria,
        prod.marca || '',
        prod.unidad_medida || 'unidades',
        prod.alicuota_iva_pct ?? '',
        prod.codigos_barras || '',
        ...celdasPrecios,
        prod.costo_vigente || '',
        prod.proveedor_info?.razon_social || '',
        prod.proveedor_info?.codigo_proveedor || '',
        precioCompra,
        prod.proveedor_info?.descuento_porcentaje ?? ''
    ];

    if (perfil === PERFILES.BASICO) {
        // Bloque P2: URL_Imagen tambien se renderiza en BASICO (mismo patron que COMPLETO)
        const valImagenUrl = incluirImagenUrl ? [prod.url_imagen || ''] : [];
        return [
            ...comunes,
            prod.stock_minimo ?? '',
            prod.stock_maximo ?? '',
            ...valImagenUrl,
            prod.archivo_origen || ''
        ];
    }

    if (perfil === PERFILES.COMPLETO) {
        const valImagenUrl = incluirImagenUrl ? [prod.url_imagen || ''] : [];
        return [
            ...comunes,
            prod.proveedor_info?.precio_neto ?? '',
            prod.proveedor_info?.es_proveedor_preferido ? 'true' : 'false',
            prod.stock_minimo ?? '',
            prod.stock_maximo ?? '',
            prod.stock_real ?? '',
            prod.visible_web ? 'true' : 'false',
            ...valImagenUrl,
            prod.cod_proveedor || '',
            prod.variante_atributos ? JSON.stringify(prod.variante_atributos) : '',
            prod.archivo_origen || ''
        ];
    }

    throw new Error(`productos-export.helper.buildFilaProducto: perfil inválido "${perfil}"`);
}

function buildFilaVariante({ prodPadre, variante, perfil, modoPrecio, listas, warnings, exportOpts = {} }) {
    const ctx = `SKU variante ${variante.sku}`;
    const ivaPct = prodPadre.alicuota_iva_pct;

    // Slots dinamicos (variantes NO tienen subcategoria propia, va vacio si el slot existe)
    const incluirSubcategoria = exportOpts.incluirSubcategoria !== false;
    const incluirImagenUrl    = exportOpts.incluirImagenUrl    !== false;
    const slotSubcategoria = incluirSubcategoria ? [''] : [];

    // En variantes, solo la primera lista de precios tiene el precio
    const celdasPrecios = listas.flatMap((l, idx) => {
        if (idx === 0) {
            return [
                convertirPrecio(variante.precio, ivaPct, modoPrecio, warnings, ctx),
                ''
            ];
        }
        return ['', ''];
    });

    if (perfil === PERFILES.RAPIDO) {
        return [variante.sku, ...celdasPrecios, '', ''];
    }

    const comunes = [
        prodPadre.sku, // SKU_Padre
        variante.sku,
        '', // Nombre (vacío en variante, va en Presentacion)
        variante.nombre_variante || '',
        '', '', // descripcion, categoria
        ...slotSubcategoria, // subcategoria (vacio si el flag esta on)
        '', '', '', '', // marca, unidad, iva, cb
        ...celdasPrecios,
        '', // costo
        '', '', '', '' // proveedor (4 cols)
    ];

    if (perfil === PERFILES.BASICO) {
        // Bloque P2: slot vacio para URL_Imagen en variante (las variantes heredan la imagen del padre)
        const slotImagenUrl = incluirImagenUrl ? [''] : [];
        return [...comunes, variante.stock_minimo ?? '', '', ...slotImagenUrl, prodPadre.archivo_origen || ''];
    }

    if (perfil === PERFILES.COMPLETO) {
        const slotImagenUrl = incluirImagenUrl ? [''] : [];
        return [
            ...comunes,
            '', '', // precio_neto_prov, es_pref
            variante.stock_minimo ?? '', '', '', // stock min/max/real
            '', // visible_web
            ...slotImagenUrl, // url_imagen (vacio si el flag esta on)
            '', // cod_prov_legacy
            variante.atributos ? JSON.stringify(variante.atributos) : '',
            prodPadre.archivo_origen || ''
        ];
    }

    return [];
}

// ═══════════════════════════════════════════════════════════════════════════
// HOJA DE INSTRUCCIONES (con marcador de modo precio)
// ═══════════════════════════════════════════════════════════════════════════

function buildHojaInstrucciones({ perfil, modoPrecio, totalProductos, filtroDesc, warnings }) {
    const lineas = [
        ['ARCHIVO REIMPORTABLE — ERP LAGO'],
        [''],
        ['__META_MODO_PRECIO__', modoPrecio],
        ['__META_PERFIL__', perfil],
        [''],
        [`Productos exportados: ${totalProductos}`],
        [`Filtro: ${filtroDesc}`],
        [''],
        ['REGLAS DE IMPORTACION:'],
        ['1. Si una columna NO existe en el header, ese campo no se modifica.'],
        ['2. Si una columna existe pero la celda esta vacia, ese campo no se modifica.'],
        ['3. Si una columna existe y tiene valor, se actualiza.'],
        [''],
        ['MODO DE PRECIO:'],
        modoPrecio === MODOS_PRECIO.FINAL_CON_IVA
            ? ['Las columnas Precio_*_c_IVA estan con IVA INCLUIDO. Editalas tal como las ve el cliente.']
            : ['Las columnas Precio_*_s_IVA estan SIN IVA (netos). Lo que se guarda en BD.'],
        [''],
        ['COLUMNAS INFORMATIVAS (solo lectura, NO se reimportan):'],
        ['- Costo_Vigente_(info): viene de inventario, lo actualiza el modulo de compras'],
        ['- Stock_Real_(info):    viene de movimientos de stock'],
        ['- Precio_Neto_Prov_(info): calculado por trigger desde precio_compra y descuento'],
    ];

    if (warnings && warnings.length > 0) {
        lineas.push(['']);
        lineas.push(['ADVERTENCIAS:']);
        warnings.slice(0, 50).forEach(w => lineas.push([w]));
        if (warnings.length > 50) lineas.push([`...y ${warnings.length - 50} mas`]);
    }

    return lineas;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {Client} client - cliente PG (puede ser pool directamente)
 * @param {Object} opts
 * @param {number} opts.id_empresa
 * @param {Object} opts.filtro - { tipo: 'todos'|'ids'|'archivo_origen', valor }
 * @param {string} opts.modoPrecio - NETO | FINAL_CON_IVA
 * @param {string} opts.perfil - RAPIDO | BASICO | COMPLETO
 * @param {boolean} [opts.incluir_variantes=true]
 * @returns {Promise<{ buffer, filename, total_filas, warnings }>}
 */
async function generarExcelProductos(client, opts) {
    const {
        id_empresa,
        filtro = { tipo: 'todos' },
        modoPrecio = MODOS_PRECIO.FINAL_CON_IVA,
        perfil = PERFILES.BASICO,
        incluir_variantes = true,
        filtro_desc = ''
    } = opts;

    if (!id_empresa) throw new Error('productos-export.helper: id_empresa obligatorio');
    if (!Object.values(MODOS_PRECIO).includes(modoPrecio)) {
        throw new Error(`productos-export.helper: modoPrecio inválido "${modoPrecio}"`);
    }
    if (!Object.values(PERFILES).includes(perfil)) {
        throw new Error(`productos-export.helper: perfil inválido "${perfil}"`);
    }

    const warnings = [];

    // 0. Opciones desde configuraciones_empresa (productos.export.*)
    const exportOpts = {
        incluirSubcategoria: await configHelper.get(client, id_empresa, 'productos.export.incluir_subcategoria', true),
        incluirImagenUrl:    await configHelper.get(client, id_empresa, 'productos.export.incluir_imagen_url',   true)
    };

    // 1. Datos
    const [listas, productos] = await Promise.all([
        fetchListas(client, id_empresa),
        fetchProductos(client, { id_empresa, filtro })
    ]);

    if (productos.length === 0) {
        const err = new Error('No se encontraron productos para los filtros indicados');
        err.statusCode = 404;
        throw err;
    }

    // 2. Headers
    const headers = buildHeaders({ perfil, modoPrecio, listas, exportOpts });
    const datos = [headers];

    // 3. Filas
    for (const prod of productos) {
        datos.push(buildFilaProducto({ prod, perfil, modoPrecio, listas, warnings, exportOpts }));

        if (incluir_variantes && prod.tiene_variantes && prod.variantes) {
            for (const v of prod.variantes) {
                datos.push(buildFilaVariante({ prodPadre: prod, variante: v, perfil, modoPrecio, listas, warnings, exportOpts }));
            }
        }
    }

    // 4. Workbook
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = headers.map(h => ({ wch: Math.max(String(h).length + 2, 14) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');

    // Hoja Instrucciones (con marcador __META_MODO_PRECIO__)
    const filtroDesc = filtro_desc || `tipo=${filtro.tipo}`;
    const wsInst = XLSX.utils.aoa_to_sheet(
        buildHojaInstrucciones({ perfil, modoPrecio, totalProductos: productos.length, filtroDesc, warnings })
    );
    wsInst['!cols'] = [{ wch: 30 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsInst, 'Instrucciones');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 5. Filename
    const fecha = new Date().toISOString().slice(0, 10);
    const sufijoFiltro = filtro.tipo === 'archivo_origen' ? `_${sanitizeFilename(filtro.valor)}` : '';
    const filename = `Productos_${perfil}_${modoPrecio}${sufijoFiltro}_${fecha}.xlsx`;

    logger.info(`[productos-export.helper] perfil=${perfil} modo=${modoPrecio} filtro=${filtro.tipo} productos=${productos.length} warnings=${warnings.length}`);

    return {
        buffer,
        filename,
        total_filas: datos.length - 1,
        total_productos: productos.length,
        warnings
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    generarExcelProductos,
    PERFILES,
    MODOS_PRECIO
};
