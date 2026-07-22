/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HELPER — ERP LAGO
 * Lectura/escritura centralizada de configuraciones_empresa
 * ═══════════════════════════════════════════════════════════════════════════
 * - Cache en memoria con TTL configurable (default 60s)
 * - Casteo automatico de tipos (boolean, integer, float, json, string)
 * - Defaults explicitos (sin fallbacks silenciosos)
 * - Soporta lectura por prefijo (ej: 'web.*')
 * - Invalidacion manual al escribir
 *
 * USO:
 *   const cfg = require('../utils/config.helper');
 *   const v = await cfg.get(client, id_empresa, 'web.login_obligatorio', false);
 *   const todas = await cfg.getPrefix(client, id_empresa, 'web.');
 *   await cfg.set(client, id_empresa, 'web.pedido_minimo', 5000);
 */

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
const cachePrefix = new Map();

function _cacheKey(id_empresa, clave) {
    return id_empresa + ':' + clave;
}

function _castear(valor, tipoSugerido) {
    if (valor === null || valor === undefined) return null;
    if (tipoSugerido === 'string') return String(valor);
    const s = String(valor).trim();

    if (s === 'true') return true;
    if (s === 'false') return false;

    if (/^-?\d+$/.test(s))      return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);

    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try { return JSON.parse(s); } catch (e) { /* sigue como string */ }
    }
    return s;
}

async function get(client, id_empresa, clave, defaultValue = null) {
    if (!id_empresa) throw new Error('config.get: id_empresa requerido');
    if (!clave)      throw new Error('config.get: clave requerida');

    const ck = _cacheKey(id_empresa, clave);
    const hit = cache.get(ck);
    if (hit && hit.exp > Date.now()) return hit.valor;

    const r = await client.query(
        'SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2 LIMIT 1',
        [id_empresa, clave]
    );
    const valor = r.rows.length ? _castear(r.rows[0].valor) : defaultValue;
    cache.set(ck, { valor, exp: Date.now() + CACHE_TTL_MS });
    return valor;
}

async function getPrefix(client, id_empresa, prefijo) {
    if (!id_empresa) throw new Error('config.getPrefix: id_empresa requerido');
    if (!prefijo)    throw new Error('config.getPrefix: prefijo requerido');

    const ck = _cacheKey(id_empresa, '__prefix__' + prefijo);
    const hit = cachePrefix.get(ck);
    if (hit && hit.exp > Date.now()) return hit.mapa;

    const r = await client.query(
        'SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave LIKE $2',
        [id_empresa, prefijo + '%']
    );
    const mapa = {};
    for (const row of r.rows) {
        const k = row.clave.substring(prefijo.length);
        mapa[k] = _castear(row.valor);
    }
    cachePrefix.set(ck, { mapa, exp: Date.now() + CACHE_TTL_MS });
    return mapa;
}

async function set(client, id_empresa, clave, valor) {
    if (!id_empresa) throw new Error('config.set: id_empresa requerido');
    if (!clave)      throw new Error('config.set: clave requerida');

    const valorStr = (valor === null || valor === undefined)
        ? null
        : (typeof valor === 'object' ? JSON.stringify(valor) : String(valor));

    await client.query(
        `INSERT INTO configuraciones_empresa (id_empresa, clave, valor)
         VALUES ($1, $2, $3)
         ON CONFLICT (id_empresa, clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [id_empresa, clave, valorStr]
    );
    invalidate(id_empresa, clave);
}

function invalidate(id_empresa, clave = null) {
    if (clave) cache.delete(_cacheKey(id_empresa, clave));
    for (const k of cachePrefix.keys()) {
        if (k.startsWith(id_empresa + ':__prefix__')) cachePrefix.delete(k);
    }
}

function invalidateAll() {
    cache.clear();
    cachePrefix.clear();
}

module.exports = { get, getPrefix, set, invalidate, invalidateAll };
