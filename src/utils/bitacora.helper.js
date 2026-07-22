/**
 * BITACORA HELPER — auditoria de catalogo
 *
 * Tabla: bitacora_catalogo
 * Single write point para eventos sobre productos, categorias, marcas, etc.
 *
 * Diseño:
 *  - NO bloquea operacion de negocio: si el INSERT falla, log y return false
 *  - Misma transaccion del caller: pasar `client` (pg.PoolClient) para que
 *    ROLLBACK propague tambien al evento de bitacora
 *  - Acciones namespaced: ENTIDAD.SUBENTIDAD.ACCION
 *  - id_empresa OBLIGATORIO (la tabla lo exige NOT NULL)
 *
 * Uso tipico:
 *   const bitacora = require('./bitacora.helper');
 *   await bitacora.registrar(client, {
 *       id_empresa: req.usuario.id_empresa,
 *       id_usuario: req.usuario.id_usuario,
 *       ip: req.ip,
 *       entidad: bitacora.ENTIDADES.PRODUCTO,
 *       id_entidad: producto.id_producto,
 *       accion: bitacora.ACCIONES.PRODUCTO_PADRE_ASIGNAR,
 *       payload: { id_padre_anterior, id_padre_nuevo },
 *       motivo: 'Reorganizacion catalogo'
 *   });
 */
'use strict';

let logger;
try {
    logger = require('./logger');
} catch (e) {
    logger = { info: console.log, warn: console.warn, error: console.error };
}

// Catalogo de acciones soportadas (evita strings sueltos en callers)
const ACCIONES = Object.freeze({
    PRODUCTO_IMAGEN_ACTUALIZAR: 'producto.imagen.actualizar',
    PRODUCTO_PADRE_ASIGNAR:     'producto.padre.asignar',
    PRODUCTO_PADRE_QUITAR:      'producto.padre.quitar',
    PRODUCTO_PADRE_CREAR:       'producto.padre.crear',
    PRODUCTO_PADRE_REUTILIZAR:  'producto.padre.reutilizar', // Bloque 7.6: idempotencia importer
    CATEGORIA_CREAR:            'categoria.crear',
    CATEGORIA_ACTUALIZAR:       'categoria.actualizar',
    CATEGORIA_DESACTIVAR:       'categoria.desactivar',
});

const ENTIDADES = Object.freeze({
    PRODUCTO:  'producto',
    CATEGORIA: 'categoria',
    MARCA:     'marca',
});

/**
 * Registra un evento en bitacora_catalogo.
 *
 * @param {pg.PoolClient|pg.Pool} client - preferentemente client transaccional
 * @param {Object}  datos
 * @param {number}  datos.id_empresa  OBLIGATORIO
 * @param {number}  [datos.id_usuario=null]
 * @param {string}  [datos.ip=null]
 * @param {string}  datos.entidad     OBLIGATORIO
 * @param {number}  datos.id_entidad  OBLIGATORIO
 * @param {string}  datos.accion      OBLIGATORIO (ver ACCIONES)
 * @param {Object}  [datos.payload={}]
 * @param {string}  [datos.motivo]    se mergea en payload.motivo
 *
 * @returns {Promise<boolean>} true si OK, false si fallo (NO throw)
 */
async function registrar(client, datos) {
    if (!datos || typeof datos !== 'object') {
        logger.warn('[bitacora] datos invalidos (null/undefined)');
        return false;
    }

    const {
        id_empresa,
        id_usuario = null,
        ip = null,
        entidad,
        id_entidad,
        accion,
        payload = {},
        motivo = null
    } = datos;

    // Validaciones silenciosas: warn, no throw
    if (!id_empresa) {
        logger.warn(`[bitacora] FALTA id_empresa para ${entidad || '?'}.${accion || '?'} id=${id_entidad || '?'}`);
        return false;
    }
    if (!entidad || !id_entidad || !accion) {
        logger.warn(`[bitacora] FALTA campo obligatorio: entidad=${entidad} id_entidad=${id_entidad} accion=${accion}`);
        return false;
    }

    // motivo se mergea dentro del payload (no es columna separada)
    const payloadFinal = motivo
        ? Object.assign({}, payload, { motivo })
        : payload;

    try {
        await client.query(`
            INSERT INTO bitacora_catalogo
                (id_empresa, id_usuario, ip, entidad, id_entidad, accion, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            id_empresa,
            id_usuario,
            ip,
            entidad,
            id_entidad,
            accion,
            JSON.stringify(payloadFinal)
        ]);
        return true;
    } catch (err) {
        // NO bloquea operacion de negocio
        logger.error(`[bitacora] ERROR ${accion} id=${id_entidad}: ${err.message}`);
        return false;
    }
}

module.exports = {
    registrar,
    ACCIONES,
    ENTIDADES,
};
