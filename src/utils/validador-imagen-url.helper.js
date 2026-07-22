/**
 * VALIDADOR-IMAGEN-URL HELPER
 *
 * Valida una URL de imagen contra:
 *  1. configuraciones_empresa['web.imagen.url_validacion_regex']
 *  2. configuraciones_empresa['web.imagen.hosts_permitidos'] (JSON array)
 *
 * Reglas:
 *  - URL vacia/null/'' → ok (= quitar imagen del producto)
 *  - URL no string → fail
 *  - URL no parseable como URL → fail
 *  - Si la regex existe y NO matchea → fail
 *  - Si hay whitelist y el host NO esta → fail
 *  - Si la empresa NO tiene configs cargadas → ok con warning (vendibilidad)
 *
 * Match de host: exacto o sufijo con punto separador
 *  - whitelist ['ibb.co'] permite 'ibb.co' y 'i.ibb.co'
 *  - NO permite 'evilibb.co'
 */
'use strict';

let logger;
try {
    logger = require('./logger');
} catch (e) {
    logger = { info: console.log, warn: console.warn, error: console.error };
}

const CLAVE_REGEX = 'web.imagen.url_validacion_regex';
const CLAVE_HOSTS = 'web.imagen.hosts_permitidos';

/**
 * Lee las dos configs relevantes de configuraciones_empresa.
 * @returns {Promise<{regex:string|null, hosts:string[]|null}>}
 */
async function _leerConfigs(client, id_empresa) {
    const { rows } = await client.query(`
        SELECT clave, valor
          FROM configuraciones_empresa
         WHERE id_empresa = $1
           AND clave IN ($2, $3)
    `, [id_empresa, CLAVE_REGEX, CLAVE_HOSTS]);

    const map = {};
    for (const r of rows) map[r.clave] = r.valor;

    let hosts = null;
    const raw = map[CLAVE_HOSTS];
    if (raw) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) hosts = parsed.map(h => String(h).toLowerCase());
        } catch (e) {
            logger.warn(`[validador-imagen-url] ${CLAVE_HOSTS} no es JSON array valido: ${e.message}`);
        }
    }

    return {
        regex: map[CLAVE_REGEX] || null,
        hosts: hosts,
    };
}

/**
 * Valida URL de imagen.
 *
 * @param {pg.Pool|pg.PoolClient} client
 * @param {Object} datos
 * @param {number} datos.id_empresa OBLIGATORIO
 * @param {string|null} datos.url
 * @returns {Promise<{ok:boolean, vacio?:boolean, motivo?:string}>}
 */
async function validar(client, { id_empresa, url }) {
    if (!id_empresa) {
        return { ok: false, motivo: 'id_empresa requerido' };
    }

    // Vacio = quitar imagen, no validamos
    if (url == null || url === '') {
        return { ok: true, vacio: true };
    }

    if (typeof url !== 'string') {
        return { ok: false, motivo: 'URL debe ser string' };
    }

    const urlTrim = url.trim();
    if (urlTrim === '') {
        return { ok: true, vacio: true };
    }

    // Leer configs
    const config = await _leerConfigs(client, id_empresa);

    // Si NO hay configs cargadas (empresa recien instalada) → permitir con warning
    if (!config.regex && !config.hosts) {
        logger.warn(`[validador-imagen-url] empresa ${id_empresa} sin configs de imagen — permitiendo URL sin validar`);
        return { ok: true, sinConfigs: true };
    }

    // 1. Validar regex
    if (config.regex) {
        let re;
        try {
            re = new RegExp(config.regex);
        } catch (e) {
            logger.warn(`[validador-imagen-url] ${CLAVE_REGEX} invalida: ${e.message}`);
            re = null;
        }
        if (re && !re.test(urlTrim)) {
            return {
                ok: false,
                motivo: 'Formato de URL no permitido. Debe ser HTTPS con extension .jpg/.jpeg/.png/.webp/.gif'
            };
        }
    }

    // 2. Validar host contra whitelist
    if (config.hosts && config.hosts.length > 0) {
        let host;
        try {
            host = new URL(urlTrim).host.toLowerCase();
        } catch (e) {
            return { ok: false, motivo: 'URL invalida (no parseable)' };
        }

        const permitido = config.hosts.some(h => host === h || host.endsWith('.' + h));
        if (!permitido) {
            return {
                ok: false,
                motivo: `Host "${host}" no esta en la lista de hosts permitidos. Permitidos: ${config.hosts.join(', ')}`
            };
        }
    }

    return { ok: true };
}

module.exports = {
    validar,
};
