/**
 * busqueda.helper.js - Búsqueda multi-palabra estilo Google
 * Ubicación: /root/mi_erp/src/utils/busqueda.helper.js
 *
 * "ros gis" → cada palabra debe matchear en al menos un campo (AND)
 */
'use strict';

function generarBusquedaMultiPalabra(busqueda, campos, startIdx) {
    if (!busqueda || !busqueda.trim()) return null;

    const palabras = busqueda.trim().split(/\s+/).filter(p => p.length >= 1);
    if (palabras.length === 0) return null;

    const clausulas = [];
    const params = [];
    let idx = startIdx;

    for (const palabra of palabras) {
        const condicionesCampos = campos.map(campo => `${campo} ILIKE $${idx}`);
        clausulas.push(`(${condicionesCampos.join(' OR ')})`);
        params.push(`%${palabra}%`);
        idx++;
    }

    return {
        clausula: clausulas.join(' AND '),
        params,
        nextIdx: idx
    };
}

module.exports = { generarBusquedaMultiPalabra };
