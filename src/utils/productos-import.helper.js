/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCTOS-IMPORT HELPER — ERP LAGO
 * Parser y validador de Excels de productos para importacion masiva.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RESPONSABILIDAD: leer un buffer Excel, validar contra la BD, devolver
 * estructura normalizada lista para que el controller la persista.
 *
 * NO escribe en BD. NO depende de Express.
 *
 * REGLAS CONTRACTUALES:
 *   1. precios.precio se guarda SIEMPRE NETO. Si el Excel trae con IVA,
 *      este helper convierte usando la alicuota REAL del producto via iva.helper.
 *   2. POLITICA COLUMNA-PRESENTE: si una columna no esta en el header del
 *      Excel, el campo no se toca. Si esta pero la celda esta vacia, tampoco.
 *      Para PRODUCTOS NUEVOS los campos obligatorios siguen siendo: SKU,
 *      Nombre, y Precio de la lista principal.
 *   3. Los campos retornados para productos EXISTENTES son del tipo:
 *        { presente: true, valor: X }   → actualizar con X
 *        { presente: false }            → no tocar
 *      El controller usa este flag para construir el UPDATE dinamico.
 *   4. Sufijos _s_IVA / _c_IVA en columnas de precio. [bloque 6d]
 *   5. Auto-deteccion del marcador __META_MODO_PRECIO__. [bloque 6c]
 *
 * @module productos-import.helper
 */

'use strict';

const XLSX = require('xlsx');
const ivaHelper = require('./iva.helper');
const cfg = require('./config.helper');
const preciosHelper = require('./precios.helper');
const logger = require('./logger');

const UNIDADES_VALIDAS = ['unidades', 'kg', 'litros', 'metros', 'm2', 'm3'];

// Columnas marcadas como (info) que se exportan pero JAMAS se reimportan
const COLUMNAS_READONLY = new Set([
    'Costo_Vigente_(info)',
    'Stock_Real_(info)',
    'Precio_Neto_Prov_(info)',
    'Precio_Compra_(info)'
]);

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS PUROS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Slug IDENTICO al de productos-export.helper.js.
 * Debe mantenerse sincronizado para que export→import cierren el ciclo.
 */
function slug(s) {
    return String(s || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
}

function limpiarNombreArchivo(filename) {
    if (!filename) return null;
    return filename.replace(/\.(xlsx|xls|csv)$/i, '').trim().substring(0, 100);
}

/**
 * Convierte un valor del Excel a NETO usando la alicuota real del producto.
 * Si precios_incluyen_iva=true, divide por (1+iva/100) via iva.helper.
 * Cero hardcode.
 */
function convertirPrecioANeto(valor, porcentajeIva, preciosIncluyenIva) {
    if (valor === null || valor === undefined || valor === '') return null;
    const precio = parseFloat(valor);
    if (isNaN(precio) || precio < 0) return null;

    if (preciosIncluyenIva && porcentajeIva > 0) {
        const neto = ivaHelper.finalANeto(precio, porcentajeIva);
        return Math.round(neto * 100) / 100;
    }
    return Math.round(precio * 100) / 100;
}

/**
 * Lee un valor de celda y determina si "esta presente" segun la politica:
 *   - Columna ausente del header     → presente=false
 *   - Columna presente, celda vacia  → presente=false  (regla A confirmada)
 *   - Columna presente, celda con valor → presente=true, valor=X
 *
 * @param {Object} fila — objeto de la fila de Excel
 * @param {Set<string>} columnasPresentes — Set con todos los headers del Excel
 * @param {string} nombreCol
 * @returns {{presente: boolean, valor?: any}}
 */
/**
 * Normaliza un valor para parseFloat: convierte coma decimal a punto,
 * maneja formatos argentinos (1.234,56 -> 1234.56).
 */
function normalizarNumero(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'number') return v;
    const s = String(v).trim();
    if (s === '') return '';
    if (s.includes('.') && s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) {
        return s.replace(/\./g, '').replace(',', '.');
    }
    if (s.includes(',') && !s.includes('.')) {
        return s.replace(',', '.');
    }
    return s;
}

function leerCelda(fila, columnasPresentes, nombreCol) {
    if (!columnasPresentes.has(nombreCol)) return { presente: false };
    const v = fila[nombreCol];
    if (v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')) {
        return { presente: false };
    }
    return { presente: true, valor: v };
}

/**
 * Helper: extrae un string trim de una celda, o null si no esta presente.
 */
function leerString(fila, columnasPresentes, nombreCol) {
    const c = leerCelda(fila, columnasPresentes, nombreCol);
    if (!c.presente) return { presente: false };
    const s = String(c.valor).trim();
    return s === '' ? { presente: false } : { presente: true, valor: s };
}

/**
 * Helper: extrae un numero de una celda, o no-presente si invalido o vacio.
 */
function leerNumero(fila, columnasPresentes, nombreCol, { min = null, max = null, entero = false } = {}) {
    const c = leerCelda(fila, columnasPresentes, nombreCol);
    if (!c.presente) return { presente: false };
    const valorNorm = normalizarNumero(c.valor);
    const n = entero ? parseInt(valorNorm) : parseFloat(valorNorm);
    if (isNaN(n)) return { presente: true, error: `${nombreCol} invalido (no numerico)` };
    if (min !== null && n < min) return { presente: true, error: `${nombreCol} fuera de rango (min ${min})` };
    if (max !== null && n > max) return { presente: true, error: `${nombreCol} fuera de rango (max ${max})` };
    return { presente: true, valor: n };
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECCION DE METADATOS EN HOJA "Instrucciones"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca celdas __META_*__ en la hoja "Instrucciones" del workbook.
 * Estas celdas las escribe productos-export.helper.js en cada export.
 *
 * Formato esperado en la hoja: columna A = clave, columna B = valor.
 * Ej:
 *   __META_MODO_PRECIO__  | FINAL_CON_IVA
 *   __META_PERFIL__       | BASICO
 *
 * @param {Object} workbook
 * @returns {Object} { modo_precio?, perfil? }
 */
function detectarMetaModoPrecio(workbook) {
    const resultado = { modo_precio: null, perfil: null };
    const hojaInst = workbook.Sheets['Instrucciones'];
    if (!hojaInst) return resultado;

    // Convertir a array of arrays para leer facil
    const filas = XLSX.utils.sheet_to_json(hojaInst, { header: 1, defval: '' });
    for (const fila of filas) {
        if (!Array.isArray(fila) || fila.length < 2) continue;
        const clave = String(fila[0] || '').trim();
        const valor = String(fila[1] || '').trim();
        if (clave === '__META_MODO_PRECIO__' && valor) {
            if (valor === 'NETO' || valor === 'FINAL_CON_IVA') {
                resultado.modo_precio = valor;
            }
        } else if (clave === '__META_PERFIL__' && valor) {
            resultado.perfil = valor;
        }
    }
    return resultado;
}

// ═══════════════════════════════════════════════════════════════════════════
// CARGA DE CATALOGOS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Nombre del padre derivado de los hijos (palabras comunes + limpieza medidas)
// Puro, sin I/O. La lista de palabrasMedida viene de configuraciones_empresa.
// ═══════════════════════════════════════════════════════════════════════════
function _capitalizarNombre(s) {
    return String(s || '').split(/\s+/).filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}
function _limpiarMedidasNombre(nombre, palabrasMedida) {
    const setMedida = new Set((palabrasMedida || []).map(p => p.toLowerCase()));
    // saca tambien numero+unidad pegado (500g, 10mm) usando la lista
    const unidadesAlt = (palabrasMedida || []).map(p => p.replace(/\./g,'')).filter(Boolean).join('|');
    const reNumUnidad = unidadesAlt ? new RegExp('^\\d+([.,]\\d+)?(' + unidadesAlt + ')$', 'i') : null;
    return String(nombre || '').split(/\s+/).filter(tok => {
        const t = tok.toLowerCase();
        if (setMedida.has(t)) return false;
        if (/^\d+([.,]\d+)?$/.test(t)) return false;
        if (/^[-x/]+$/.test(t)) return false;
        if (reNumUnidad && reNumUnidad.test(t)) return false;
        return true;
    }).join(' ');
}
function nombrePadreDesdeHijos(nombresHijos, palabrasMedida) {
    const limpios = (nombresHijos || []).map(n => String(n || '').trim()).filter(Boolean);
    if (limpios.length === 0) return null;
    if (limpios.length === 1) {
        const r = _capitalizarNombre(_limpiarMedidasNombre(limpios[0], palabrasMedida));
        return r || _capitalizarNombre(limpios[0]);
    }
    const tokensPorHijo = limpios.map(n => n.split(/\s+/).filter(Boolean));
    const setsLower = tokensPorHijo.map(toks => new Set(toks.map(t => t.toLowerCase())));
    const vistos = new Set();
    const comunes = [];
    for (const tok of tokensPorHijo[0]) {
        const tl = tok.toLowerCase();
        if (vistos.has(tl)) continue;
        if (setsLower.every(set => set.has(tl))) { comunes.push(tok); vistos.add(tl); }
    }
    let resultado = _capitalizarNombre(_limpiarMedidasNombre(comunes.join(' '), palabrasMedida));
    if (!resultado) resultado = _capitalizarNombre(_limpiarMedidasNombre(limpios[0], palabrasMedida));
    return resultado || null;
}
module.exports.nombrePadreDesdeHijos = nombrePadreDesdeHijos;

async function cargarCatalogos(pool, id_empresa) {
    const [listasRes, categoriasRes, marcasRes, proveedoresRes, productosRes, variantesRes, alicuotasRes, largosRes] = await Promise.all([
        pool.query(
            'SELECT id_lista_precio, nombre, redondea_con_iva FROM listasdeprecios WHERE id_empresa = $1 AND activa = true',
            [id_empresa]
        ),
        pool.query('SELECT id_categoria, LOWER(TRIM(nombre)) as nombre FROM categorias WHERE activo = true'),
        pool.query('SELECT id_marca, LOWER(TRIM(nombre)) as nombre FROM marcas WHERE activo = true'),
        pool.query('SELECT id_proveedor, LOWER(TRIM(razon_social)) as razon_social FROM proveedores WHERE activo = true'),
        pool.query(`
            SELECT p.id_producto, LOWER(TRIM(p.sku)) as sku, p.nombre, p.tiene_variantes, p.id_alicuota_iva,
                   p.activo,
                   COALESCE(a.porcentaje, 21) as porcentaje_iva
            FROM productos p
            LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
        `),
        pool.query('SELECT id_variante, id_producto, LOWER(TRIM(sku)) as sku, nombre_variante, activo FROM producto_variantes'),
        pool.query('SELECT id_alicuota, porcentaje FROM alicuotasiva WHERE activo = true'),
        pool.query(`
            SELECT column_name, character_maximum_length AS max_len
            FROM information_schema.columns
            WHERE table_name='productos'
              AND column_name IN ('sku','nombre','unidad_medida','url_imagen')
        `)
    ]);

    return {
        listas: listasRes.rows,
        categoriasMap: new Map(categoriasRes.rows.map(c => [c.nombre, c.id_categoria])),
        marcasMap: new Map(marcasRes.rows.map(m => [m.nombre, m.id_marca])),
        proveedoresMap: new Map(proveedoresRes.rows.map(p => [p.razon_social, p.id_proveedor])),
        productosMap: new Map(productosRes.rows.map(p => [
            p.sku,
            {
                id: p.id_producto,
                nombre: p.nombre,
                tiene_variantes: p.tiene_variantes,
                id_alicuota_iva: p.id_alicuota_iva,
                porcentaje_iva: parseFloat(p.porcentaje_iva) || 21,
                activo: p.activo
            }
        ])),
        variantesMap: new Map(variantesRes.rows.map(v => [
            v.sku,
            { id: v.id_variante, id_producto: v.id_producto, nombre: v.nombre_variante, activo: v.activo }
        ])),
        alicuotasMap: new Map(alicuotasRes.rows.map(a => [parseFloat(a.porcentaje), a.id_alicuota])),
        largosMap: new Map(largosRes.rows.map(r => [r.column_name, r.max_len]))
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSEO + VALIDACION (con politica columna-presente)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @returns {Promise<Object>} estructura validada con flags de presencia
 */
async function parsearYValidar(pool, buffer, id_empresa, opciones = {}) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const datos = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    if (datos.length === 0) {
        const err = new Error('Archivo vacio');
        err.statusCode = 400;
        throw err;
    }

    // ─── Auto-deteccion del marcador __META_MODO_PRECIO__ ───
    // Si el Excel vino de nuestro export, tiene el marcador en hoja "Instrucciones".
    // Ese marcador OVERRIDE las opciones del usuario — es la unica fuente de verdad
    // para que export→import no pierda precision.
    const meta = detectarMetaModoPrecio(workbook);

    let precios_incluyen_iva = opciones.precios_incluyen_iva !== undefined
        ? opciones.precios_incluyen_iva
        : true;
    const porcentaje_iva_default = opciones.porcentaje_iva_default || 21;

    let modo_detectado = null;
    if (meta.modo_precio) {
        // Marcador presente: override
        precios_incluyen_iva = (meta.modo_precio === 'FINAL_CON_IVA');
        modo_detectado = meta.modo_precio;
        logger.info(`[productos-import.helper] Marcador detectado: __META_MODO_PRECIO__=${meta.modo_precio}, precios_incluyen_iva=${precios_incluyen_iva}`);
    }

    // ─── Detectar columnas presentes en el Excel ───
    // (Union de keys de las primeras 5 filas para no fallar si la primera tiene celdas vacias)
    const columnasPresentes = new Set();
    for (let i = 0; i < Math.min(5, datos.length); i++) {
        Object.keys(datos[i]).forEach(k => columnasPresentes.add(k));
    }

    const cat = await cargarCatalogos(pool, id_empresa);
    // ─── Techo de precio_neto_calculado (NUMERIC(14,6) → < 10^8). Configurable. ───
    const PRECIO_NETO_MAXIMO = await cfg.get(pool, id_empresa, 'importacion.precio_neto_maximo', 99999999);
    const _palabrasMedidaCsv = await cfg.get(pool, id_empresa, 'importacion.padre.palabras_medida', 'mm,cm,m,x,u,u.,un,un.,kg,gr,g,lt,l,ml,mt,mts,pulg');
    const PALABRAS_MEDIDA_PADRE = String(_palabrasMedidaCsv).split(',').map(x => x.trim()).filter(Boolean);
    const redondeoPorLista = new Map((cat.listas || []).map(l => [l.id_lista_precio, l.redondea_con_iva]));
    const { listas, categoriasMap, marcasMap, proveedoresMap, productosMap, variantesMap, alicuotasMap, largosMap } = cat;

    // Mapear columnas de precio/margen del Excel a id_lista_precio.
    // Soporta 3 formatos:
    //   Precio_<slug>          (legacy, respeta toggle global/marcador)
    //   Precio_<slug>_s_IVA    (neto explicito — ignora toggle)
    //   Precio_<slug>_c_IVA    (final con IVA — siempre convierte a neto usando alicuota real)
    //
    // Map estructura: { colName → { idLista, modo: 'LEGACY'|'NETO'|'CON_IVA' } }
    const listasColumnas = {};
    const margenesColumnas = {};
    listas.forEach(l => {
        const s = slug(l.nombre);
        listasColumnas[`Precio_${s}`]       = { idLista: l.id_lista_precio, modo: 'LEGACY' };
        listasColumnas[`Precio_${s}_s_IVA`] = { idLista: l.id_lista_precio, modo: 'NETO' };
        listasColumnas[`Precio_${s}_c_IVA`] = { idLista: l.id_lista_precio, modo: 'CON_IVA' };
        margenesColumnas[`Margen_${s}`]     = l.id_lista_precio;
    });

    const errores = [], advertencias = [];
    let preciosCompraSinProveedor = 0;
    const productosValidados = [], variantesValidadas = [];
    const skusEnArchivo = new Set(), padresEnArchivo = new Map();
    const productosExistentes = [], productosNuevos = [], productosInactivos = [];
    const variantesExistentes = [], variantesNuevas = [], variantesInactivas = [];

    // ─── Bloque 6a: recoleccion para feature subcategoria + imagen ───
    // categoriasNoEncontradas: nombre_lower -> { nombre, count }
    //   se llena cuando el Excel trae una categoria que no existe en BD.
    //   El controller (Bloque 6c) las crea via categorias.helper si auto_crear=true.
    const categoriasNoEncontradas = new Map();
    const subcategoriasNoEncontradas = new Map();
    let imagenesConUrl = 0;

    for (let i = 0; i < datos.length; i++) {
        const fila = datos[i];
        const numFila = i + 2;
        const erroresFila = [];
        const advertenciasFila = [];

        const skuPadre = String(fila.SKU_Padre || '').trim().toLowerCase();
        const sku = String(fila.SKU || '').trim();
        const skuLower = sku.toLowerCase();
        const esVariante = skuPadre !== '' && sku !== '' && !productosMap.has(skuLower);

        // Bloque 6: validacion universal — SKU_Padre no puede ser igual al propio SKU
        if (skuPadre !== '' && skuPadre === skuLower) {
            erroresFila.push('SKU_Padre no puede ser igual al SKU del producto');
        }

        if (!sku) {
            erroresFila.push('SKU obligatorio');
        } else if (skusEnArchivo.has(skuLower)) {
            erroresFila.push(`SKU "${sku}" duplicado`);
        } else {
            skusEnArchivo.add(skuLower);
        }

        // ─── SHORT-CIRCUIT: SKU pertenece a producto/variante INACTIVO en BD ───
        // Política: NO tocarlos. La columna sku tiene UNIQUE sobre toda la tabla
        // (no filtra por activo), así que insertar como nuevo rompería; y
        // actualizarlos sería resucitar un alta dada de baja a propósito.
        if (sku && erroresFila.length === 0) {
            if (productosMap.has(skuLower) && productosMap.get(skuLower).activo === false) {
                productosInactivos.push({
                    fila: numFila,
                    sku,
                    nombre_bd: productosMap.get(skuLower).nombre,
                    motivo: 'producto inactivo en BD — ignorado'
                });
                continue;
            }
            if (variantesMap.has(skuLower) && variantesMap.get(skuLower).activo === false) {
                variantesInactivas.push({
                    fila: numFila,
                    sku,
                    nombre_bd: variantesMap.get(skuLower).nombre,
                    motivo: 'variante inactiva en BD — ignorada'
                });
                continue;
            }
        }

        if (esVariante) {
            // ─── FILA DE VARIANTE ───
            // (politica columna-presente NO aplica a variantes en este bloque,
            //  las trato igual que antes — se ven en bloque posterior si hace falta)
            if (!productosMap.has(skuPadre) && !padresEnArchivo.has(skuPadre)) {
                // El padre se auto-creara con SKU = slug(SKU_Padre)+'-PADRE'.
                // Validar largo ANTES del insert para evitar 22001 ciego.
                const maxSku = largosMap.get('sku') || 50;
                const largoEstimado = skuPadre.length + '-PADRE'.length;
                if (largoEstimado > maxSku) {
                    erroresFila.push(`SKU_Padre tiene ${skuPadre.length} caracteres; al auto-crear el padre el codigo (${largoEstimado} con sufijo -PADRE) supera el maximo ${maxSku}. Revisa si pegaste una descripcion en vez del codigo del padre, o deja la columna vacia si no tiene padre`);
                }
                erroresFila.push(`SKU_Padre "${skuPadre}" no existe`);
            }
            const presentacion = String(fila.Presentacion || '').trim();
            const varianteExiste = variantesMap.has(skuLower);
            if (!varianteExiste && !presentacion) erroresFila.push('Presentacion obligatoria');

            let porcentajeIvaVariante = porcentaje_iva_default;
            if (productosMap.has(skuPadre)) porcentajeIvaVariante = productosMap.get(skuPadre).porcentaje_iva;

            const precioCol = Object.keys(listasColumnas)[0];
            let precio = null;
            if (precioCol && fila[precioCol] !== '' && fila[precioCol] !== null && fila[precioCol] !== undefined) {
                const p = parseFloat(fila[precioCol]);
                if (isNaN(p) || p < 0) erroresFila.push('Precio invalido');
                else precio = convertirPrecioANeto(p, porcentajeIvaVariante, precios_incluyen_iva);
            } else if (!varianteExiste) {
                erroresFila.push('Precio obligatorio');
            }

            let stockMinimo = fila.Stock_Minimo !== '' ? parseInt(fila.Stock_Minimo) : null;
            if (stockMinimo !== null && (isNaN(stockMinimo) || stockMinimo < 0)) stockMinimo = null;

            if (erroresFila.length === 0) {
                variantesValidadas.push({
                    fila: numFila, skuPadre, sku, presentacion, precio, stockMinimo,
                    esNueva: !varianteExiste,
                    idVariante: varianteExiste ? variantesMap.get(skuLower).id : null,
                    idProductoPadre: productosMap.has(skuPadre) ? productosMap.get(skuPadre).id : null,
                    porcentajeIva: porcentajeIvaVariante
                });
            }
            (varianteExiste ? variantesExistentes : variantesNuevas).push({
                fila: numFila, sku,
                nombre: varianteExiste ? variantesMap.get(skuLower).nombre : presentacion,
                valido: erroresFila.length === 0,
                errores: erroresFila.length > 0 ? erroresFila : null
            });
        } else {
            // ─── FILA DE PRODUCTO ───
            const productoExiste = productosMap.has(skuLower);

            // Campos con politica columna-presente
            const fNombre = leerString(fila, columnasPresentes, 'Nombre');
            const fDescripcion = leerString(fila, columnasPresentes, 'Descripcion');
            const fCategoria = leerString(fila, columnasPresentes, 'Categoria');
            const fSubcategoria = leerString(fila, columnasPresentes, 'Subcategoria');
            const fUrlImagen = leerString(fila, columnasPresentes, 'URL_Imagen');
            const fMarca = leerString(fila, columnasPresentes, 'Marca');
            const fProveedor = leerString(fila, columnasPresentes, 'Proveedor');
            const fCodigoBarras = leerString(fila, columnasPresentes, 'Codigos_Barras');
            const fCodigoBarrasLegacy = leerString(fila, columnasPresentes, 'Codigo_Barras'); // retro-compat
            const fUnidad = leerString(fila, columnasPresentes, 'Unidad');
            const fCodigoProveedor = leerString(fila, columnasPresentes, 'Codigo_Proveedor');
            const fStockMinimo = leerNumero(fila, columnasPresentes, 'Stock_Minimo', { min: 0, entero: true });
            const fStockMaximo = leerNumero(fila, columnasPresentes, 'Stock_Maximo', { min: 0, entero: true });
            const fDescuentoProveedor = leerNumero(fila, columnasPresentes, 'Descuento_Proveedor_%', { min: 0, max: 100 });
            const fPrecioCompra = leerNumero(fila, columnasPresentes, 'Precio_Compra', { min: 0 });

            // Validar presencia obligatoria SOLO para productos NUEVOS
            if (!productoExiste && !fNombre.presente) {
                erroresFila.push('Nombre obligatorio para producto nuevo');
            }

            // Resolver alicuota
            let porcentajeIvaProducto = porcentaje_iva_default;
            let idAlicuotaIva = alicuotasMap.get(porcentaje_iva_default) || 3;

            if (productoExiste) {
                const prodExistente = productosMap.get(skuLower);
                porcentajeIvaProducto = prodExistente.porcentaje_iva;
                idAlicuotaIva = prodExistente.id_alicuota_iva;
            } else {
                const fAlicuota = leerNumero(fila, columnasPresentes, 'Alicuota_IVA');
                if (fAlicuota.presente && !fAlicuota.error) {
                    if (alicuotasMap.has(fAlicuota.valor)) {
                        porcentajeIvaProducto = fAlicuota.valor;
                        idAlicuotaIva = alicuotasMap.get(fAlicuota.valor);
                    } else {
                        advertenciasFila.push(`Alicuota ${fAlicuota.valor}% no existe, usando ${porcentaje_iva_default}%`);
                    }
                }
            }

            // Resolver IDs de catalogos (solo si la columna esta presente con valor)
            let idCategoria = null;
            if (fCategoria.presente) {
                idCategoria = categoriasMap.get(fCategoria.valor.toLowerCase()) || null;
                if (!idCategoria) {
                    advertenciasFila.push(`Categoria "${fCategoria.valor}" no existe`);
                    const key = fCategoria.valor.toLowerCase();
                    const prev = categoriasNoEncontradas.get(key);
                    categoriasNoEncontradas.set(key, {
                        nombre: prev ? prev.nombre : String(fCategoria.valor).trim(),
                        count: (prev ? prev.count : 0) + 1
                    });
                }
            }
            // Subcategoria: usa el mismo catalogo plano (categorias raiz activas)
            let idSubcategoria = null;
            if (fSubcategoria.presente) {
                idSubcategoria = categoriasMap.get(fSubcategoria.valor.toLowerCase()) || null;
                if (!idSubcategoria) {
                    advertenciasFila.push(`Subcategoria "${fSubcategoria.valor}" no existe`);
                    const key = fSubcategoria.valor.toLowerCase();
                    const prev = subcategoriasNoEncontradas.get(key);
                    subcategoriasNoEncontradas.set(key, {
                        nombre: prev ? prev.nombre : String(fSubcategoria.valor).trim(),
                        count: (prev ? prev.count : 0) + 1
                    });
                }
            }
            // URL_Imagen: solo contamos. La validacion real (regex + hosts) va en el controller (Bloque 6c).
            if (fUrlImagen.presente && fUrlImagen.valor) {
                imagenesConUrl++;
            }
            let idMarca = null;
            if (fMarca.presente) {
                idMarca = marcasMap.get(fMarca.valor.toLowerCase()) || null;
                if (!idMarca) advertenciasFila.push(`Marca "${fMarca.valor}" no existe`);
            }
            let idProveedor = null;
            if (fProveedor.presente) {
                idProveedor = proveedoresMap.get(fProveedor.valor.toLowerCase()) || null;
                if (!idProveedor) advertenciasFila.push(`Proveedor "${fProveedor.valor}" no existe`);
            }
            // Precio_Compra sin proveedor resoluble => el precio NO se va a guardar. Aviso explicito.
            if (fPrecioCompra.presente && !fPrecioCompra.error && !idProveedor) {
                advertenciasFila.push('Precio_Compra ignorado: esta fila no tiene proveedor resuelto');
                preciosCompraSinProveedor++;
            }

            // Validar unidad
            if (fUnidad.presente && !UNIDADES_VALIDAS.includes(fUnidad.valor.toLowerCase())) {
                erroresFila.push(`Unidad "${fUnidad.valor}" invalida`);
            }

            // Acumular errores de los campos numericos
            for (const f of [fStockMinimo, fStockMaximo, fDescuentoProveedor, fPrecioCompra]) {
                if (f.error) erroresFila.push(f.error);
            }

            // ─── PRECIOS Y MARGENES (politica columna-presente + dual s_IVA / c_IVA) ───
            // Regla: para una misma lista, si vienen AMBAS columnas con valor → error.
            // Prioridad si solo viene una: la que este presente.
            // Si viene legacy (sin sufijo) → aplica el toggle global / marcador.
            const precios = {};
            const margenes = {};
            // Acumulador temporal: { idLista: { NETO: val, CON_IVA: val, LEGACY: val } }
            const preciosPorLista = {};

            for (const [colName, spec] of Object.entries(listasColumnas)) {
                if (!columnasPresentes.has(colName)) continue;
                const v = fila[colName];
                if (v === null || v === undefined || v === '') continue;
                const p = parseFloat(normalizarNumero(v));
                if (isNaN(p) || p < 0) {
                    erroresFila.push(`${colName} invalido`);
                    continue;
                }
                if (!preciosPorLista[spec.idLista]) preciosPorLista[spec.idLista] = {};
                preciosPorLista[spec.idLista][spec.modo] = p;
            }

            // Resolver cada lista: elegir 1 valor por lista segun reglas
            for (const [idListaStr, fuentes] of Object.entries(preciosPorLista)) {
                const idLista = parseInt(idListaStr);
                const tieneNeto   = 'NETO' in fuentes;
                const tieneConIva = 'CON_IVA' in fuentes;
                const tieneLegacy = 'LEGACY' in fuentes;

                // Caso error: ambas explicitas en la misma fila
                if (tieneNeto && tieneConIva) {
                    erroresFila.push(`Lista ${idLista}: columnas _s_IVA y _c_IVA presentes simultaneamente, no se puede determinar cual tomar`);
                    continue;
                }

                let netoFinal;
                if (tieneNeto) {
                    // Neto explicito: no aplicar conversion
                    netoFinal = Math.round(fuentes.NETO * 100) / 100;
                } else if (tieneConIva) {
                    // Con IVA explicito: siempre convertir a neto usando alicuota real
                    netoFinal = convertirPrecioANeto(fuentes.CON_IVA, porcentajeIvaProducto, true);
                } else if (tieneLegacy) {
                    // Legacy: respeta el toggle global (o el marcador override)
                    netoFinal = convertirPrecioANeto(fuentes.LEGACY, porcentajeIvaProducto, precios_incluyen_iva);
                }

                if (netoFinal !== null && netoFinal !== undefined) {
                    // ─── Validar techo del neto DERIVADO (lo que realmente se persiste) ───
                    const redCI = redondeoPorLista.get(idLista) === true;
                    const { precio_neto_derivado } = preciosHelper.calcularNetoDerivado(
                        netoFinal, 'NETO', porcentajeIvaProducto, redCI
                    );
                    if (precio_neto_derivado > PRECIO_NETO_MAXIMO) {
                        erroresFila.push(
                            `Lista ${idLista}: precio neto ${precio_neto_derivado.toLocaleString('es-AR')} supera el maximo permitido ${Number(PRECIO_NETO_MAXIMO).toLocaleString('es-AR')} — fila NO importada, corregi el valor`
                        );
                        continue;
                    }
                    precios[idLista] = netoFinal;
                }
            }
            for (const [colName, idLista] of Object.entries(margenesColumnas)) {
                if (!columnasPresentes.has(colName)) continue;
                const v = fila[colName];
                if (v === null || v === undefined || v === '') continue;
                const m = parseFloat(normalizarNumero(v));
                if (!isNaN(m)) margenes[idLista] = m;
            }

            // Validar precio obligatorio SOLO para productos NUEVOS
            if (!productoExiste && !precios[listas[0]?.id_lista_precio]) {
                erroresFila.push('Precio lista principal obligatorio para producto nuevo');
            }

            // Convertir precio_compra a neto (como precios) si esta presente
            let precioCompraNeto = null;
            if (fPrecioCompra.presente && !fPrecioCompra.error) {
                precioCompraNeto = convertirPrecioANeto(fPrecioCompra.valor, porcentajeIvaProducto, precios_incluyen_iva);
            }

            // Codigo barras: aceptar tanto "Codigos_Barras" (nuevo) como "Codigo_Barras" (legacy)
            let codigoBarras = null;
            if (fCodigoBarras.presente) codigoBarras = fCodigoBarras.valor;
            else if (fCodigoBarrasLegacy.presente) codigoBarras = fCodigoBarrasLegacy.valor;

            if (erroresFila.length === 0) {
                // ESTRUCTURA NUEVA: campos con flag de presencia para el controller
                productosValidados.push({
                    fila: numFila,
                    sku,
                    esNuevo: !productoExiste,
                    idProducto: productoExiste ? productosMap.get(skuLower).id : null,
                    idAlicuotaIva,
                    porcentajeIva: porcentajeIvaProducto,
                    // ─── Bloque 6: padre asignable desde Excel ───
                    // skuPadre = lowercase normalizado (clave de mapeo).
                    // nombrePadreCrudo = texto original del Excel (se usa como nombre si hay que auto-crear).
                    skuPadre: skuPadre || null,
                    nombrePadreCrudo: skuPadre ? String(fila.SKU_Padre || '').trim() : null,

                    // Campos con flag de presencia (politica columna-presente)
                    campos: {
                        nombre:              fNombre,
                        descripcion:         fDescripcion,
                        idCategoria:         fCategoria.presente ? { presente: true, valor: idCategoria } : { presente: false },
                        idSubcategoria:      fSubcategoria.presente ? { presente: true, valor: idSubcategoria } : { presente: false },
                        urlImagen:           fUrlImagen,
                        idMarca:             fMarca.presente    ? { presente: true, valor: idMarca }    : { presente: false },
                        unidad:              fUnidad.presente   ? { presente: true, valor: fUnidad.valor.toLowerCase() } : { presente: false },
                        codigoBarras:        codigoBarras !== null ? { presente: true, valor: codigoBarras } : { presente: false },
                        stockMinimo:         fStockMinimo,
                        stockMaximo:         fStockMaximo,
                        idProveedor:         fProveedor.presente ? { presente: true, valor: idProveedor } : { presente: false },
                        codigoProveedor:     fCodigoProveedor,
                        precioCompra:        precioCompraNeto !== null ? { presente: true, valor: precioCompraNeto } : { presente: false },
                        descuentoProveedor:  fDescuentoProveedor,
                    },

                    // Precios y margenes: mapas con SOLO las listas presentes con valor
                    precios,
                    margenes,

                    // ── DEPRECATED (compatibilidad con codigo viejo del controller) ──
                    // El controller actual aun lee estos campos planos. Cuando migremos
                    // el controller en bloque 6e, estos campos se eliminan.
                    nombre: fNombre.presente ? fNombre.valor : null,
                    descripcion: fDescripcion.presente ? fDescripcion.valor : null,
                    idCategoria,
                    idSubcategoria,
                    idMarca,
                    unidad: fUnidad.presente ? fUnidad.valor.toLowerCase() : null,
                    codigoBarras,
                    idProveedor,
                    codigoProveedor: fCodigoProveedor.presente ? fCodigoProveedor.valor : null,
                    precioCompra: precioCompraNeto,
                    descuentoProveedor: fDescuentoProveedor.presente ? fDescuentoProveedor.valor : null,
                    stockMinimo: fStockMinimo.presente ? fStockMinimo.valor : null,
                    stockMaximo: fStockMaximo.presente ? fStockMaximo.valor : null,
                    urlImagen: fUrlImagen.presente ? fUrlImagen.valor : null,
                    // Bloque 6a: nombres pendientes para que el controller los cree si auto_crear=true
                    categoriaNombrePendiente: fCategoria.presente && !idCategoria
                        ? String(fCategoria.valor).trim() : null,
                    subcategoriaNombrePendiente: fSubcategoria.presente && !idSubcategoria
                        ? String(fSubcategoria.valor).trim() : null,
                });
                padresEnArchivo.set(skuLower, { porcentaje_iva: porcentajeIvaProducto });
            }

            (productoExiste ? productosExistentes : productosNuevos).push({
                fila: numFila, sku,
                nombre: productoExiste ? productosMap.get(skuLower).nombre : (fNombre.valor || ''),
                valido: erroresFila.length === 0,
                errores: erroresFila.length > 0 ? erroresFila : null,
                advertencias: advertenciasFila,
                alicuota_usada: porcentajeIvaProducto
            });
        }

        if (erroresFila.length > 0) errores.push({ fila: numFila, sku: sku || '(vacio)', errores: erroresFila });
        if (advertenciasFila.length > 0) advertencias.push({ fila: numFila, sku: sku || '(vacio)', advertencias: advertenciasFila });
    }

    // ─── Bloque 6: detectar SKU_Padre que no existe ni en BD ni en archivo ───
    // Para cada uno, generar SKU slug y agregarlo a padresAutoCrear.
    // Tambien agregarlo a padresEnArchivo para que las validaciones siguientes pasen.
    function _slugifySku(s) {
        return String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 45);
    }
    const padresAutoCrear = [];
    const skusPadreVistos = new Set();
    const todosLosItems = [...productosValidados, ...variantesValidadas];
    const SUFIJO_PADRE = '-PADRE';
    for (const item of todosLosItems) {
        const sp = item.skuPadre;
        if (!sp || skusPadreVistos.has(sp)) continue;

        // ─── SKU final del padre segun convencion (idempotente export→import) ───
        // El SKU del padre sale del SKU_Padre que pone el usuario, NO del nombre.
        //   - termina en -PADRE  → ya es el SKU final (vino de un export), usar tal cual
        //   - no termina en -PADRE → es codigo base nuevo, agregar el sufijo
        const spSlug = _slugifySku(sp);
        if (!spSlug) continue;
        const skuGenerado = spSlug.toUpperCase().endsWith(SUFIJO_PADRE)
            ? spSlug
            : spSlug + SUFIJO_PADRE;
        const skuGeneradoLower = skuGenerado.toLowerCase();

        // ─── Check de existencia por el SKU FINAL (con sufijo), no por el crudo ───
        // Bug previo: buscaba 'sp' crudo (ej 'tba6c') y nunca encontraba 'tba6c-padre',
        // creando padres duplicados. Ahora busca por el SKU real del padre.
        if (productosMap.has(skuGeneradoLower) || padresEnArchivo.has(sp) || skusPadreVistos.has(skuGeneradoLower)) {
            skusPadreVistos.add(sp);
            skusPadreVistos.add(skuGeneradoLower);
            continue;
        }

        // No existe — auto-crear. Nombre derivado de los hijos (palabras comunes).
        const nombresHijos = [...productosValidados, ...variantesValidadas]
            .filter(it => it.skuPadre === sp)
            .map(it => it.nombre || (it.campos && it.campos.nombre && it.campos.nombre.valor) || '')
            .filter(Boolean);
        const nombreDerivado = nombrePadreDesdeHijos(nombresHijos, PALABRAS_MEDIDA_PADRE);
        const nombrePadre = nombreDerivado || item.nombrePadreCrudo || sp;

        padresAutoCrear.push({
            skuPadreReferencia: sp,
            nombrePadre,
            skuGenerado
        });
        padresEnArchivo.set(sp, { porcentaje_iva: porcentaje_iva_default, _autoCreado: true, skuGenerado });
        skusPadreVistos.add(sp);
        skusPadreVistos.add(skuGeneradoLower);
    }

    return {
        datos,
        listas,
        productosValidados,
        variantesValidadas,
        productosMap,
        padresAutoCrear,
        errores,
        advertencias,
        opciones_iva: { precios_incluyen_iva, porcentaje_iva_default },
        modo_detectado,
        meta,
        columnas_presentes: Array.from(columnasPresentes),
        resumen: {
            total_filas: datos.length,
            total_columnas_excel: columnasPresentes.size,
            productos_existentes: productosExistentes,
            productos_nuevos: productosNuevos,
            productos_inactivos: productosInactivos,
            variantes_existentes: variantesExistentes,
            variantes_nuevas: variantesNuevas,
            variantes_inactivas: variantesInactivas,
            nuevos_validos: productosNuevos.filter(p => p.valido).length,
            nuevos_con_errores: productosNuevos.filter(p => !p.valido).length,
            variantes_nuevas_validas: variantesNuevas.filter(v => v.valido).length,
            inactivos_count: productosInactivos.length + variantesInactivas.length,
            total_advertencias: advertencias.length,
            precios_compra_sin_proveedor: preciosCompraSinProveedor,
            // Bloque 6
            padres_a_auto_crear: padresAutoCrear.length,
            productos_a_asignar_padre: productosValidados.filter(p => p.skuPadre).length,
            // ─── Bloque 6a: feature subcategoria + imagen ───
            categorias_a_crear: {
                count: categoriasNoEncontradas.size,
                lista: Array.from(categoriasNoEncontradas.values())
            },
            subcategorias_a_crear: {
                count: subcategoriasNoEncontradas.size,
                lista: Array.from(subcategoriasNoEncontradas.values())
            },
            imagenes: {
                total_con_url: imagenesConUrl
            }
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    parsearYValidar,
    detectarMetaModoPrecio,
    cargarCatalogos,
    slug,
    limpiarNombreArchivo,
    convertirPrecioANeto,
    normalizarNumero,
    leerCelda,
    leerString,
    leerNumero,
    UNIDADES_VALIDAS,
    COLUMNAS_READONLY
};
