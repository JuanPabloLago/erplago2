/**
 * iva.helper.js — Fuente única de verdad para cálculos de IVA en ERP LAGO.
 *
 * REGLAS CONTRACTUALES (no negociables):
 *
 * 1. precios.precio guarda SIEMPRE el NETO sin IVA. Sin excepciones.
 *    El final con IVA se calcula al consultar usando productos.id_alicuota_iva.
 *
 * 2. El IVA es POR PRODUCTO. Nunca se asume un valor por defecto en cálculos.
 *    Si un producto existente no tiene alícuota → es un error de datos, se rechaza.
 *
 * 3. El único default legítimo es para CREAR productos nuevos sin alícuota
 *    especificada (ver obtenerAlicuotaDefectoParaCreacion). Nunca para calcular.
 *
 * 4. El redondeo argentino es configurable por empresa vía configuraciones_empresa.
 *    Default: precios.redondeo_modo = 'ESCALA_AR' (escala original de listas-precios).
 *
 * Toda fórmula de IVA en el sistema debe pasar por este helper. Cualquier
 * literal `* 1.21`, `/ 1.21`, `|| 21` fuera de este archivo es un bug.
 *
 * @module iva.helper
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PURAS — sin DB, testables, deterministas
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Convierte neto a final aplicando una alícuota IVA.
 * @param {number} neto
 * @param {number} ivaPorcentaje  ej: 21, 10.5, 27, 0
 * @returns {number}
 */
function netoAFinal(neto, ivaPorcentaje) {
    if (neto == null || isNaN(neto)) throw new Error('iva.netoAFinal: neto inválido');
    if (ivaPorcentaje == null || isNaN(ivaPorcentaje)) throw new Error('iva.netoAFinal: ivaPorcentaje inválido');
    return neto * (1 + ivaPorcentaje / 100);
}

/**
 * Convierte final (con IVA) a neto sin IVA.
 */
function finalANeto(final, ivaPorcentaje) {
    if (final == null || isNaN(final)) throw new Error('iva.finalANeto: final inválido');
    if (ivaPorcentaje == null || isNaN(ivaPorcentaje)) throw new Error('iva.finalANeto: ivaPorcentaje inválido');
    return final / (1 + ivaPorcentaje / 100);
}

/**
 * Calcula el monto de IVA de una base neta dada.
 */
function calcularMontoIva(neto, ivaPorcentaje) {
    return netoAFinal(neto, ivaPorcentaje) - neto;
}

/**
 * Margen porcentual entre costo y neto. Devuelve null si no es calculable.
 */
function calcularMargenPct(costo, neto) {
    if (!costo || costo <= 0) return null;
    return (neto - costo) / costo * 100;
}

/**
 * Aplica un margen porcentual a un costo. Devuelve el neto resultante.
 */
function aplicarMargenACosto(costo, margenPct) {
    return costo * (1 + margenPct / 100);
}

// ═══════════════════════════════════════════════════════════════════════════
// REDONDEO ARGENTINO — replica EXACTA de listas-precios.helper.js:15
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Escala de redondeo argentino tradicional.
 * Aplica al monto FINAL (con IVA) porque es lo que el cliente paga.
 *
 * Esta es la implementación de referencia. Si el contrato cambia,
 * cambia acá y nada más.
 */
function redondearAR(monto) {
    if (!monto || monto <= 0) return 0;
    const m = Math.round(monto);
    if (m < 100)   return Math.round(m / 5) * 5;
    if (m < 500)   return Math.round(m / 10) * 10;
    if (m < 1000)  return Math.round(m / 50) * 50;
    if (m < 5000)  return Math.round(m / 100) * 100;
    return Math.round(m / 500) * 500;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES COMPUESTAS — costo+margen → neto a guardar (con redondeo final)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Calcula el neto a persistir en precios.precio aplicando margen sobre costo
 * y respetando el redondeo argentino sobre el FINAL con IVA.
 *
 * @param {Object} args
 * @param {number} args.costo
 * @param {number} args.margenPct
 * @param {number} args.ivaPorcentaje
 * @param {boolean} [args.aplicarRedondeo=true]
 * @returns {number} neto a guardar
 */
function calcularNetoDesdeMarcado({ costo, margenPct, ivaPorcentaje, aplicarRedondeo = true }) {
    const netoBruto = aplicarMargenACosto(costo, margenPct);
    if (!aplicarRedondeo) return Math.round(netoBruto * 10000) / 10000;
    const finalBruto = netoAFinal(netoBruto, ivaPorcentaje);
    const finalRedondeado = redondearAR(finalBruto);
    return Math.round(finalANeto(finalRedondeado, ivaPorcentaje) * 10000) / 10000;
}

/**
 * Aplica un factor de ajuste (ej: aumento del 10% = 1.10) al neto y respeta
 * el redondeo argentino sobre el final.
 */
function ajustarNetoPorFactor({ netoActual, factor, ivaPorcentaje, aplicarRedondeo = true }) {
    const netoNuevo = netoActual * factor;
    if (!aplicarRedondeo) return Math.round(netoNuevo * 10000) / 10000;
    const finalBruto = netoAFinal(netoNuevo, ivaPorcentaje);
    const finalRedondeado = redondearAR(finalBruto);
    return Math.round(finalANeto(finalRedondeado, ivaPorcentaje) * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESOLUTORES DB — el único lugar donde tocamos la base
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Devuelve la alícuota IVA de un producto existente.
 * EXPLOTA si el producto no tiene alícuota o si está inactiva.
 * No hay fallback. Si falla, es un error de datos que hay que arreglar.
 */
async function obtenerIvaProducto(client, id_producto) {
    if (!id_producto) throw new Error('iva.obtenerIvaProducto: id_producto obligatorio');
    const { rows } = await client.query(`
        SELECT p.id_alicuota_iva, a.porcentaje, a.codigo_afip, a.nombre, a.activo
          FROM productos p
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE p.id_producto = $1
    `, [id_producto]);

    if (!rows[0]) throw new Error(`iva.obtenerIvaProducto: producto ${id_producto} no existe`);
    if (rows[0].id_alicuota_iva == null)
        throw new Error(`iva.obtenerIvaProducto: producto ${id_producto} sin alícuota IVA asignada`);
    if (!rows[0].activo)
        throw new Error(`iva.obtenerIvaProducto: producto ${id_producto} usa alícuota inactiva id=${rows[0].id_alicuota_iva}`);

    return {
        id_alicuota: rows[0].id_alicuota_iva,
        porcentaje: parseFloat(rows[0].porcentaje),
        codigo_afip: rows[0].codigo_afip,
        nombre: rows[0].nombre
    };
}

/**
 * Devuelve la alícuota por defecto para CREAR un producto nuevo
 * cuando el origen (Excel, formulario) no especificó una.
 *
 * Lee de configuraciones_empresa.productos.alicuota_iva_defecto.
 * EXPLOTA si la config no existe o apunta a una alícuota inactiva.
 *
 * NO se debe usar para calcular IVA de operaciones — solo para alta de productos.
 */
async function obtenerAlicuotaDefectoParaCreacion(client, id_empresa) {
    if (!id_empresa) throw new Error('iva.obtenerAlicuotaDefectoParaCreacion: id_empresa obligatorio');

    const cfg = await client.query(`
        SELECT valor FROM configuraciones_empresa
         WHERE id_empresa = $1 AND clave = 'productos.alicuota_iva_defecto'
    `, [id_empresa]);

    if (!cfg.rows[0]) {
        throw new Error('iva.obtenerAlicuotaDefectoParaCreacion: config productos.alicuota_iva_defecto no definida en configuraciones_empresa');
    }

    const idDef = parseInt(cfg.rows[0].valor);
    const al = await client.query(`
        SELECT id_alicuota, porcentaje, codigo_afip, nombre
          FROM alicuotasiva
         WHERE id_alicuota = $1 AND activo = true
    `, [idDef]);

    if (!al.rows[0]) {
        throw new Error(`iva.obtenerAlicuotaDefectoParaCreacion: alícuota id=${idDef} no existe o está inactiva`);
    }

    return {
        id_alicuota: al.rows[0].id_alicuota,
        porcentaje: parseFloat(al.rows[0].porcentaje),
        codigo_afip: al.rows[0].codigo_afip,
        nombre: al.rows[0].nombre
    };
}

/**
 * Resolutor por LOTE: dado un array de id_producto, devuelve un Map
 * { id_producto → { porcentaje, id_alicuota, ... } }.
 * Para evitar N+1 queries en operaciones masivas (importación, ajuste masivo, print).
 */
async function obtenerIvaProductosBatch(client, ids_producto) {
    if (!Array.isArray(ids_producto) || ids_producto.length === 0) return new Map();
    const { rows } = await client.query(`
        SELECT p.id_producto, p.id_alicuota_iva, a.porcentaje, a.codigo_afip, a.nombre, a.activo
          FROM productos p
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE p.id_producto = ANY($1::int[])
    `, [ids_producto]);

    const map = new Map();
    for (const r of rows) {
        if (r.id_alicuota_iva == null || !r.activo) {
            // En batch no explotamos, marcamos como inválido para que el caller decida.
            map.set(r.id_producto, { error: `producto ${r.id_producto} sin alícuota válida`, id_alicuota: null });
            continue;
        }
        map.set(r.id_producto, {
            id_alicuota: r.id_alicuota_iva,
            porcentaje: parseFloat(r.porcentaje),
            codigo_afip: r.codigo_afip,
            nombre: r.nombre
        });
    }
    return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
    // Puras
    netoAFinal,
    finalANeto,
    calcularMontoIva,
    calcularMargenPct,
    aplicarMargenACosto,
    redondearAR,
    // Compuestas
    calcularNetoDesdeMarcado,
    ajustarNetoPorFactor,
    // DB
    obtenerIvaProducto,
    obtenerAlicuotaDefectoParaCreacion,
    obtenerIvaProductosBatch
};
