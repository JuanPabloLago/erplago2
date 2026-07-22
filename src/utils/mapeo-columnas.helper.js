/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MAPEO-COLUMNAS HELPER — ERP LAGO
 * Mapeo manual de columnas Excel → campos ERP para importación.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RESPONSABILIDAD ÚNICA: traducir un Excel con headers arbitrarios a un Excel
 * con headers estándar ERP que parsearYValidar() pueda procesar.
 *
 * - NO escribe en BD.
 * - NO depende de Express.
 * - NO valida productos (eso es trabajo de productos-import.helper).
 * - Funciones puras (excepto inspeccionarExcel que lee buffer).
 *
 * @module mapeo-columnas.helper
 */

'use strict';

const XLSX = require('xlsx');

const MAX_SAMPLES = 3; // Cantidad de valores de muestra por columna

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS PUROS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convierte índice numérico (1-based) a letra Excel: 1→A, 27→AA, etc.
 */
function letraColumna(n) {
    let s = '';
    while (n > 0) {
        n--;
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26);
    }
    return s;
}

/**
 * Normaliza string para comparación: lowercase, sin tildes, sin espacios ni
 * caracteres especiales. "Cód. Artículo" → "codarticulo".
 */
function normalizar(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Distancia de Levenshtein entre dos strings (iterativa, O(n*m)).
 */
function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = [];
    for (let i = 0; i <= b.length; i++) m[i] = [i];
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            m[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
                ? m[i - 1][j - 1]
                : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
        }
    }
    return m[b.length][a.length];
}

/**
 * Similitud 0..1 entre dos strings (después de normalizar).
 * 1.0 = idénticos, 0.0 = totalmente distintos.
 */
function similitud(a, b) {
    const na = normalizar(a);
    const nb = normalizar(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return 1 - dist / maxLen;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSPECCIÓN DE EXCEL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee un buffer Excel y devuelve estructura cruda con todas las columnas
 * detectadas (incluso las vacías), samples y meta.
 *
 * @param {Buffer} buffer
 * @returns {Object} { columnas, total_filas, meta, hojas }
 */
function inspeccionarExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const ws = workbook.Sheets[workbook.SheetNames[0]];
    if (!ws) throw new Error('El Excel no tiene hojas');

    // Leer como array of arrays para preservar columnas vacías y headers duplicados
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (aoa.length === 0) throw new Error('El Excel no tiene datos');

    const headers = aoa[0] || [];
    const dataRows = aoa.slice(1);

    const columnas = [];
    const totalCols = Math.max(headers.length, ...dataRows.map(r => r ? r.length : 0));

    for (let i = 0; i < totalCols; i++) {
        const nombreRaw = headers[i];
        const nombre = nombreRaw === null || nombreRaw === undefined
            ? `(sin nombre)`
            : String(nombreRaw).trim();

        const samples = [];
        let celdasConDatos = 0;
        for (const row of dataRows) {
            const v = row && row[i];
            if (v !== null && v !== undefined && v !== '') {
                celdasConDatos++;
                if (samples.length < MAX_SAMPLES) samples.push(v);
            }
        }

        columnas.push({
            indice: i,
            letra: letraColumna(i + 1),
            nombre: nombre,
            sample: samples,
            celdas_con_datos: celdasConDatos,
            esta_vacia: celdasConDatos === 0
        });
    }

    // Meta: leer hoja "Instrucciones" si existe (marcador __META_*__)
    const meta = {};
    const wsInst = workbook.Sheets['Instrucciones'];
    if (wsInst) {
        const filasInst = XLSX.utils.sheet_to_json(wsInst, { header: 1, defval: '' });
        for (const fila of filasInst) {
            if (Array.isArray(fila) && fila.length >= 2) {
                const k = String(fila[0] || '').trim();
                const v = String(fila[1] || '').trim();
                if (k.startsWith('__META_') && k.endsWith('__') && v) {
                    meta[k] = v;
                }
            }
        }
    }

    return {
        columnas,
        total_filas: dataRows.length,
        total_columnas: totalCols,
        meta,
        hojas: workbook.SheetNames
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CAMPOS ERP DISPONIBLES (catálogo dinámico según listas de la empresa)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera el catálogo de campos ERP que se pueden mapear, dado el set de listas
 * de precio activas de la empresa.
 *
 * @param {Array} listas - [{id_lista_precio, nombre}, ...]
 * @returns {Array} [{clave, label, grupo, obligatorio_para_nuevos, admite_modo_precio}]
 */
function getCamposERP(listas) {
    const slug = s => String(s || '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

    const campos = [
        // Identificación
        { clave: 'SKU',              label: 'SKU',              grupo: 'Identificación', obligatorio_para_nuevos: true },
        { clave: 'SKU_Padre',        label: 'SKU Padre (variantes)', grupo: 'Identificación' },
        { clave: 'Presentacion',     label: 'Presentación (variantes)', grupo: 'Identificación' },
        // Datos básicos
        { clave: 'Nombre',           label: 'Nombre',           grupo: 'Datos básicos', obligatorio_para_nuevos: true },
        { clave: 'Descripcion',      label: 'Descripción',      grupo: 'Datos básicos' },
        { clave: 'Categoria',        label: 'Categoría',        grupo: 'Datos básicos' },
        { clave: 'Subcategoria',     label: 'Subcategoría',     grupo: 'Datos básicos' }, // Bloque 7.5: cierre feature 6c
        { clave: 'Marca',            label: 'Marca',            grupo: 'Datos básicos' },
        { clave: 'Unidad',           label: 'Unidad',           grupo: 'Datos básicos' },
        { clave: 'Alicuota_IVA',     label: 'Alícuota IVA (%)', grupo: 'Datos básicos' },
        { clave: 'Codigos_Barras',   label: 'Códigos de barras',grupo: 'Datos básicos' },
        { clave: 'URL_Imagen',       label: 'URL Imagen',       grupo: 'Datos básicos' }, // Bloque 7.5: cierre feature 6c
        // Proveedor
        { clave: 'Proveedor',        label: 'Proveedor',        grupo: 'Proveedor' },
        { clave: 'Codigo_Proveedor', label: 'Código proveedor', grupo: 'Proveedor' },
        { clave: 'Precio_Compra',    label: 'Precio compra',    grupo: 'Proveedor', admite_modo_precio: true },
        { clave: 'Descuento_Proveedor_%', label: 'Descuento proveedor (%)', grupo: 'Proveedor' },
        // Stock
        { clave: 'Stock_Minimo',     label: 'Stock mínimo',     grupo: 'Stock' },
        { clave: 'Stock_Maximo',     label: 'Stock máximo',     grupo: 'Stock' }
    ];

    // Precios y márgenes: 2 campos por cada lista activa
    for (const l of listas) {
        const s = slug(l.nombre);
        campos.push({
            clave: `Precio_${s}`,
            label: `Precio — ${l.nombre}`,
            grupo: 'Precios',
            id_lista_precio: l.id_lista_precio,
            admite_modo_precio: true
        });
        campos.push({
            clave: `Margen_${s}`,
            label: `Margen — ${l.nombre} (%)`,
            grupo: 'Precios',
            id_lista_precio: l.id_lista_precio
        });
    }

    return campos;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-MATCH (sugerencia de mapeo por similitud)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sugiere un mapeo automático { campoERP_clave: letra_excel } basado en
 * similitud entre nombres de columna del Excel y campos ERP.
 *
 * Sólo asigna columnas con similitud >= umbral. Cada columna Excel se asigna
 * a un único campo ERP (el mejor match, mayor similitud gana).
 *
 * @param {Array} columnasExcel - output de inspeccionarExcel().columnas
 * @param {Array} camposERP - output de getCamposERP()
 * @param {Object} opts - { umbral: 0.75 }
 * @returns {Object} { mapeo: {campoERP: letra}, scores: {campoERP: 0..1} }
 */
function sugerirMapeo(columnasExcel, camposERP, opts = {}) {
    const umbral = opts.umbral !== undefined ? opts.umbral : 0.75;

    // Excluir columnas vacías
    const cols = columnasExcel.filter(c => !c.esta_vacia);

    // Calcular matriz de scores: para cada campo ERP, mejor score y letra
    const candidatos = []; // [{campo, letra, score}]
    for (const campo of camposERP) {
        // El export arma el header de precios como clave+_c_IVA/_s_IVA; comparar
        // contra esas variantes da match EXACTO en el round-trip export->import,
        // sin depender del largo del nombre de la lista.
        const objetivos = [campo.clave, campo.label];
        if (campo.grupo === 'Precios' || campo.admite_modo_precio) {
            objetivos.push(campo.clave + '_c_IVA', campo.clave + '_s_IVA');
        }
        let mejor = { letra: null, score: 0 };
        for (const col of cols) {
            let s = 0;
            for (const obj of objetivos) {
                const sim = similitud(col.nombre, obj);
                if (sim > s) s = sim;
            }
            if (s > mejor.score) mejor = { letra: col.letra, score: s };
        }
        if (mejor.score >= umbral) {
            candidatos.push({ campo: campo.clave, letra: mejor.letra, score: mejor.score });
        }
    }

    // Resolver conflictos: si 2 campos ERP eligen la misma columna, gana el de mayor score
    candidatos.sort((a, b) => b.score - a.score);
    const usadas = new Set();
    const mapeo = {};
    const scores = {};
    for (const c of candidatos) {
        if (usadas.has(c.letra)) continue;
        mapeo[c.campo] = c.letra;
        scores[c.campo] = Math.round(c.score * 100) / 100;
        usadas.add(c.letra);
    }

    return { mapeo, scores };
}

// ═══════════════════════════════════════════════════════════════════════════
// APLICAR MAPEO (transforma buffer Excel renombrando headers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica el mapeo al buffer original y devuelve un nuevo buffer Excel con
 * los headers renombrados a los nombres ERP estándar. Las columnas no
 * mapeadas se descartan.
 *
 * Esto permite que parsearYValidar() del helper de import siga funcionando
 * tal cual, sin saber nada del mapeo.
 *
 * @param {Buffer} buffer - Excel original
 * @param {Object} mapeo - { campoERP: letra_excel }  ej { SKU: 'A', Nombre: 'M' }
 * @returns {Buffer} - Nuevo Excel con headers ERP estándar
 */
function aplicarMapeo(buffer, mapeo) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (aoa.length === 0) throw new Error('Excel vacío');

    // Construir reverse: { indice_columna: campoERP }
    const letraAIndice = letra => {
        let idx = 0;
        for (let i = 0; i < letra.length; i++) {
            idx = idx * 26 + (letra.charCodeAt(i) - 64);
        }
        return idx - 1; // 0-based
    };
    const indiceACampo = {};
    for (const [campo, letra] of Object.entries(mapeo)) {
        if (!letra) continue;
        indiceACampo[letraAIndice(letra)] = campo;
    }

    const indices = Object.keys(indiceACampo).map(Number).sort((a, b) => a - b);
    if (indices.length === 0) throw new Error('Mapeo vacío: no hay columnas mapeadas');

    // Construir nuevo aoa: solo las columnas mapeadas, con headers ERP
    const nuevoAoa = [];
    nuevoAoa.push(indices.map(idx => indiceACampo[idx]));
    for (let r = 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        nuevoAoa.push(indices.map(idx => row[idx] !== undefined ? row[idx] : null));
    }

    // Generar nuevo workbook
    const nuevoWb = XLSX.utils.book_new();
    const nuevaWs = XLSX.utils.aoa_to_sheet(nuevoAoa);
    XLSX.utils.book_append_sheet(nuevoWb, nuevaWs, 'Productos');

    // Preservar hoja Instrucciones si existía (para __META_*__)
    if (wb.Sheets['Instrucciones']) {
        XLSX.utils.book_append_sheet(nuevoWb, wb.Sheets['Instrucciones'], 'Instrucciones');
    }

    return XLSX.write(nuevoWb, { type: 'buffer', bookType: 'xlsx' });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    inspeccionarExcel,
    getCamposERP,
    sugerirMapeo,
    aplicarMapeo,
    // Helpers exportados para tests / reuso
    letraColumna,
    normalizar,
    similitud
};
