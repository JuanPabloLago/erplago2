// =============================================================================
// proveedores-identidad.helper.js - Candado de identidad en alta de proveedores
// SRP: decide si un alta es segura (CUIT verosimil + sin homonimos activos).
// NO escribe BD. Config: proveedores.identidad.* (defaults seguros si falta).
// Regla changas: CUIT placeholder (vacio, corto, todo un mismo digito) NO exige
// checksum; un CUIT con pinta de real (11 digitos variados) que falla el digito
// verificador es la firma tipica de OCR basura => bloquea.
// =============================================================================
const cuitLookup = require('./cuit-lookup.helper');

function _soloDigitos(s) { return String(s || '').replace(/\D/g, ''); }

async function evaluarAltaProveedor(client, { id_empresa, razon_social, cuit }) {
    if (!id_empresa) throw new Error('proveedores-identidad: id_empresa obligatorio');
    if (!razon_social || !String(razon_social).trim()) {
        return { ok: false, motivo: 'RAZON_SOCIAL_VACIA', similares: [] };
    }
    let umbral = 0.45, validarCuitCfg = true;
    try {
        const cfg = require('./config.helper');
        const conf = await cfg.getPrefix(client, id_empresa, 'proveedores.identidad.');
        const u = parseFloat(conf['umbral_similitud'] ?? conf['proveedores.identidad.umbral_similitud']);
        if (!isNaN(u) && u > 0 && u < 1) umbral = u;
        const v = conf['validar_cuit'] ?? conf['proveedores.identidad.validar_cuit'];
        if (v !== undefined) validarCuitCfg = String(v) !== 'false';
    } catch (e) { /* defaults seguros */ }

    const dig = _soloDigitos(cuit);
    const pareceReal = dig.length === 11 && !/^(\d)\1{10}$/.test(dig);
    if (validarCuitCfg && pareceReal && !cuitLookup.validarCuit(dig)) {
        return {
            ok: false, motivo: 'CUIT_INVALIDO', similares: [],
            detalle: 'CUIT ' + cuit + ' no pasa el digito verificador (posible error de OCR o tipeo)'
        };
    }

    const { rows } = await client.query(`
        SELECT id_proveedor, razon_social, cuit,
               similarity(razon_social, $2) AS similitud
        FROM proveedores
        WHERE id_empresa = $1 AND activo = true
          AND similarity(razon_social, $2) >= $3
        ORDER BY similitud DESC LIMIT 3
    `, [id_empresa, String(razon_social).trim().toUpperCase(), umbral]);

    if (rows.length > 0) return { ok: false, motivo: 'SIMILAR_EXISTENTE', similares: rows };
    return { ok: true };
}

module.exports = { evaluarAltaProveedor };
