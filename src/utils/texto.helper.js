/**
 * texto.helper.js — Normalización y orden natural de texto (LÓGICA PURA)
 * Sin I/O. La función SQL natural_sort_key(text) es ESPEJO de naturalSortKey().
 */
const PAD_DIGITOS = 10;

function normalizarEspacios(str) {
    if (str == null) return '';
    return String(str).replace(/\s+/g, ' ').trim();
}

function limpiarSufijosBasura(str, sufijos = ['///', '//', '**']) {
    if (str == null) return '';
    let r = String(str);
    let cambio = true;
    while (cambio) {
        cambio = false;
        for (const suf of sufijos) {
            const esc = suf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp('\\s*' + esc + '\\s*$');
            if (rx.test(r)) { r = r.replace(rx, ''); cambio = true; }
        }
    }
    return r.trim();
}

function separarMarcaPegada(str) {
    if (str == null) return '';
    return String(str).replace(/\/(\S)/g, ' / $1').replace(/\s+\/\s+/g, ' / ');
}

function normalizarNumeroTrasPunto(str) {
    if (str == null) return '';
    return String(str).replace(/([A-Za-zº°])\.(\d)/g, '$1. $2');
}

function normalizarNombreProducto(str) {
    if (str == null) return '';
    let r = String(str);
    r = limpiarSufijosBasura(r);
    r = separarMarcaPegada(r);
    r = normalizarNumeroTrasPunto(r);
    r = normalizarEspacios(r);
    return r;
}

function naturalSortKey(str) {
    if (str == null) return '';
    return String(str).toLowerCase().replace(/\d+/g, function(m) {
        return m.padStart(PAD_DIGITOS, '0');
    });
}

function compararNatural(a, b) {
    const ka = naturalSortKey(a), kb = naturalSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
}

module.exports = {
    normalizarEspacios,
    limpiarSufijosBasura,
    separarMarcaPegada,
    normalizarNumeroTrasPunto,
    normalizarNombreProducto,
    naturalSortKey,
    compararNatural,
    PAD_DIGITOS
};
