/**
 * db-guard.helper.js
 * Capa de guardia para operaciones multi-empresa.
 */
'use strict';

function requireIdEmpresa(id_empresa, contexto) {
    if (id_empresa === null || id_empresa === undefined) {
        throw new Error(`[DB-GUARD] id_empresa es requerido en: ${contexto}. Recibido: ${id_empresa}`);
    }
    const parsed = parseInt(id_empresa, 10);
    if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`[DB-GUARD] id_empresa inválido en: ${contexto}. Recibido: ${id_empresa} (parsed: ${parsed})`);
    }
    return parsed;
}

function requireParams(params, required, contexto) {
    const missing = [];
    for (const key of required) {
        if (params[key] === undefined || params[key] === null) {
            missing.push(key);
        }
    }
    if (missing.length > 0) {
        throw new Error(`[DB-GUARD] Parámetros faltantes en ${contexto}: ${missing.join(', ')}`);
    }
}

function requireClient(client, contexto) {
    if (!client || typeof client.query !== 'function') {
        throw new Error(`[DB-GUARD] client de BD inválido en: ${contexto}`);
    }
}

function guardEntry(client, datos, requiredFields, contexto) {
    requireClient(client, contexto);
    const id_empresa = requireIdEmpresa(datos.id_empresa, contexto);
    if (requiredFields && requiredFields.length > 0) {
        requireParams(datos, requiredFields, contexto);
    }
    return id_empresa;
}

module.exports = { requireIdEmpresa, requireParams, requireClient, guardEntry };
