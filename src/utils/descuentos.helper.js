'use strict';
/**
 * @scope enterprise
 * @description Cadena de descuentos sucesivos con signo.
 *              Positivo Di = descuento, negativo Di = recargo.
 *              Single write point. Reusable desde compras, ventas, presupuestos.
 *              Espejo en frontend: frontend/js/compras.js (calcularDescuentoEquivalente).
 */

const RANGO_MIN_DEFAULT = -99;
const RANGO_MAX_DEFAULT = 99;

/**
 * Aplica cadena multiplicativa: equivalente = 1 - ∏(1 - Di/100).
 * @param {number[]} arr  Lista de Di. Ignora NaN y === 0.
 * @param {{min?:number, max?:number}} opts
 * @returns {number} equivalente neto en %, con signo. Redondeado a 2 decimales.
 */
function aplicarCadena(arr, opts = {}) {
    const min = Number.isFinite(opts.min) ? opts.min : RANGO_MIN_DEFAULT;
    const max = Number.isFinite(opts.max) ? opts.max : RANGO_MAX_DEFAULT;
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    let factor = 1;
    for (const raw of arr) {
        const d = parseFloat(raw);
        if (!Number.isFinite(d) || d === 0) continue;
        if (d < min || d > max) {
            throw new Error(`descuentos.helper.aplicarCadena: Di fuera de rango [${min}, ${max}]: ${d}`);
        }
        factor *= (1 - d / 100);
    }
    return +((1 - factor) * 100).toFixed(2);
}

function normalizarCadena(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
        .map(v => parseFloat(v))
        .filter(v => Number.isFinite(v) && v !== 0);
}

function etiquetarEquivalente(equivalente) {
    const eq = parseFloat(equivalente) || 0;
    if (eq > 0) return { tipo: 'descuento', porcentaje: eq, label: `Descuento equivalente: ${eq.toFixed(2)}%` };
    if (eq < 0) return { tipo: 'recargo', porcentaje: Math.abs(eq), label: `Recargo equivalente: ${Math.abs(eq).toFixed(2)}%` };
    return { tipo: 'neutro', porcentaje: 0, label: 'Sin ajuste neto' };
}

module.exports = { aplicarCadena, normalizarCadena, etiquetarEquivalente };
