/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BORRADOR HELPER — ERP LAGO
 * Resolucion y politica de borradores de venta rapida.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLA: Toda lectura/resolucion de "cual es el borrador activo de este usuario"
 *        pasa por aca. El controller queda thin-layer.
 *
 * NO hace:
 *   - INSERT/UPDATE/DELETE en pedidoitems   -> usa pedidos.helper.crearItems / etc.
 *   - Recalculo de totales                  -> usa pedidos.helper.recalcularTotales
 *   - Cambios de estado arbitrarios         -> usa pedidos.helper.cambiarEstado
 *
 * CONSUMIDORES esperados:
 *   - borrador.controller.js   (todas las funciones)
 *
 * Fecha: 2026-04-21 | Fase 2
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');
const pedidosHelper = require('./pedidos.helper');

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────

const POLITICAS_AL_ABRIR = Object.freeze({
    SUSPENDER_HUERFANOS_PROPIOS: 'SUSPENDER_HUERFANOS_PROPIOS',
    DESCARTAR: 'DESCARTAR',
    MANTENER: 'MANTENER'
});

const DEFAULTS = Object.freeze({
    TTL_HORAS: 24,
    POLITICA_AL_ABRIR: POLITICAS_AL_ABRIR.SUSPENDER_HUERFANOS_PROPIOS
});

// ─────────────────────────────────────────────────────────────────────────
// CONFIG READER
// ─────────────────────────────────────────────────────────────────────────

async function _leerConfig(client, id_empresa) {
    const { rows } = await client.query(
        "SELECT clave, valor FROM configuraciones_empresa " +
        " WHERE id_empresa = $1 " +
        "   AND clave IN ('borrador.ttl_horas', 'borrador.al_abrir_venta_rapida')",
        [id_empresa]
    );
    const map = {};
    rows.forEach(function(r) { map[r.clave] = r.valor; });

    let ttl = parseInt(map['borrador.ttl_horas'], 10);
    if (!Number.isFinite(ttl) || ttl < 0) ttl = DEFAULTS.TTL_HORAS;

    let politica = map['borrador.al_abrir_venta_rapida'] || DEFAULTS.POLITICA_AL_ABRIR;
    if (!POLITICAS_AL_ABRIR[politica]) politica = DEFAULTS.POLITICA_AL_ABRIR;

    return { ttl_horas: ttl, politica_al_abrir: politica };
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDACION DE PERTENENCIA
// ─────────────────────────────────────────────────────────────────────────
/**
 * Throw si el pedido no es un borrador activo del usuario+empresa.
 * Usa FOR UPDATE para bloquear concurrencia.
 *
 * @param {Object} client
 * @param {Object} datos { id_pedido, id_empresa, id_usuario }
 * @returns {Object} fila del pedido (lock activo)
 */
async function validarPertenencia(client, datos) {
    const { id_pedido, id_empresa, id_usuario } = datos;
    if (!id_pedido)  throw new Error('borrador.helper.validarPertenencia: id_pedido obligatorio');
    if (!id_empresa) throw new Error('borrador.helper.validarPertenencia: id_empresa obligatorio');
    if (!id_usuario) throw new Error('borrador.helper.validarPertenencia: id_usuario obligatorio');

    const { rows } = await client.query(
        "SELECT id_pedido, id_cliente, id_estado " +
        "  FROM pedidos " +
        " WHERE id_pedido = $1 AND id_usuario = $2 " +
        "   AND id_empresa = $3 AND id_estado = $4 " +
        "   FOR UPDATE",
        [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
    );
    if (rows.length === 0) {
        const err = new Error('Borrador no encontrado o no pertenece al usuario');
        err.code = 'BORRADOR_NO_PERTENECE';
        throw err;
    }
    return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// SUSPENDER HUERFANOS PROPIOS
// ─────────────────────────────────────────────────────────────────────────
/**
 * Aplica la politica al abrir venta rapida:
 *   - SUSPENDER_HUERFANOS_PROPIOS: borradores propios con > TTL pasan a SUSPENDIDO
 *   - DESCARTAR: borradores propios con > TTL pasan a DESCARTADO
 *   - MANTENER: no toca nada
 *
 * Solo afecta borradores DEL MISMO USUARIO (nunca de otro usuario).
 * El borrador "actual" (mas reciente, dentro del TTL) se preserva.
 *
 * @returns {{ afectados: number, ids: number[] }}
 */
async function aplicarPoliticaAlAbrir(client, datos) {
    const { id_empresa, id_usuario } = datos;
    if (!id_empresa) throw new Error('borrador.helper.aplicarPoliticaAlAbrir: id_empresa obligatorio');
    if (!id_usuario) throw new Error('borrador.helper.aplicarPoliticaAlAbrir: id_usuario obligatorio');

    const cfg = await _leerConfig(client, id_empresa);
    if (cfg.politica_al_abrir === POLITICAS_AL_ABRIR.MANTENER) {
        return { afectados: 0, ids: [], politica: cfg.politica_al_abrir };
    }

    const estadoDestino = cfg.politica_al_abrir === POLITICAS_AL_ABRIR.DESCARTAR
        ? pedidosHelper.PEDIDO_ESTADOS.DESCARTADO
        : pedidosHelper.PEDIDO_ESTADOS.SUSPENDIDO;

    // 1. Listar borradores propios vencidos (mas viejos que TTL)
    const { rows: vencidos } = await client.query(
        "SELECT id_pedido FROM pedidos " +
        " WHERE id_empresa = $1 AND id_usuario = $2 " +
        "   AND id_estado = $3 " +
        "   AND fecha_creacion < NOW() - ($4 || ' hours')::INTERVAL " +
        " FOR UPDATE",
        [id_empresa, id_usuario, pedidosHelper.PEDIDO_ESTADOS.BORRADOR, String(cfg.ttl_horas)]
    );

    const ids = [];
    for (const v of vencidos) {
        // Verificar si tiene items: si no tiene, descartar (no vale la pena suspender vacio)
        const { rows: cnt } = await client.query(
            'SELECT COUNT(*) AS n FROM pedidoitems WHERE id_pedido = $1',
            [v.id_pedido]
        );
        const tieneItems = parseInt(cnt[0].n, 10) > 0;
        const estado = tieneItems ? estadoDestino : pedidosHelper.PEDIDO_ESTADOS.DESCARTADO;

        await pedidosHelper.cambiarEstado(client, {
            id_pedido: v.id_pedido,
            id_empresa,
            nuevo_estado: estado,
            campos_extra: tieneItems
                ? { observaciones: '[Auto-suspendido por TTL ' + cfg.ttl_horas + 'h]' }
                : {}
        });
        ids.push(v.id_pedido);
    }

    if (ids.length > 0) {
        logger.info('[borrador.helper] Politica ' + cfg.politica_al_abrir +
                    ' aplicada a ' + ids.length + ' borrador(es) del usuario ' + id_usuario +
                    ' (TTL=' + cfg.ttl_horas + 'h): ' + ids.join(','));
    }
    return { afectados: ids.length, ids: ids, politica: cfg.politica_al_abrir };
}

// ─────────────────────────────────────────────────────────────────────────
// OBTENER BORRADOR ACTIVO (lectura, sin tx propia)
// ─────────────────────────────────────────────────────────────────────────
/**
 * Devuelve el id_pedido del borrador activo del usuario, o null.
 * No crea, no modifica. Solo lee. Mas reciente primero.
 *
 * @param {Function} queryFn  pool.query o client.query
 * @returns {Promise<number|null>}
 */
async function obtenerIdBorradorActivo(queryFn, datos) {
    const { id_empresa, id_usuario } = datos;
    if (!id_empresa) throw new Error('borrador.helper.obtenerIdBorradorActivo: id_empresa obligatorio');
    if (!id_usuario) throw new Error('borrador.helper.obtenerIdBorradorActivo: id_usuario obligatorio');

    const { rows } = await queryFn(
        "SELECT id_pedido FROM pedidos " +
        " WHERE id_usuario = $1 AND id_empresa = $2 AND id_estado = $3 " +
        " ORDER BY fecha_creacion DESC " +
        " LIMIT 1",
        [id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
    );
    return rows.length > 0 ? rows[0].id_pedido : null;
}

// ─────────────────────────────────────────────────────────────────────────
// CREAR BORRADOR (idempotente: si ya existe uno activo, lo retorna)
// ─────────────────────────────────────────────────────────────────────────
/**
 * Garantiza que el usuario tenga UN borrador activo.
 * Si ya tiene uno (estado -1), lo retorna.
 * Si no, crea uno nuevo via pedidos.helper.crearPedido.
 *
 * NO aplica politica al abrir (eso debe llamarse explicitamente desde
 * el endpoint que abre venta rapida para no esconder side-effects).
 *
 * @returns {{ id_pedido, ya_existia: boolean }}
 */
async function obtenerOCrearActivo(client, datos) {
    const {
        id_empresa, id_usuario,
        id_cliente = null, id_moneda = 1, cotizacion = null
    } = datos;

    if (!id_empresa) throw new Error('borrador.helper.obtenerOCrearActivo: id_empresa obligatorio');
    if (!id_usuario) throw new Error('borrador.helper.obtenerOCrearActivo: id_usuario obligatorio');

    // Lock-friendly: SELECT FOR UPDATE evita race en doble-click
    const { rows: existente } = await client.query(
        "SELECT id_pedido FROM pedidos " +
        " WHERE id_usuario = $1 AND id_empresa = $2 AND id_estado = $3 " +
        " ORDER BY fecha_creacion DESC LIMIT 1 " +
        " FOR UPDATE",
        [id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
    );
    if (existente.length > 0) {
        return { id_pedido: existente[0].id_pedido, ya_existia: true };
    }

    const pedido = await pedidosHelper.crearPedido(client, {
        id_empresa,
        id_usuario,
        id_cliente,
        id_estado: pedidosHelper.PEDIDO_ESTADOS.BORRADOR,
        id_moneda,
        cotizacion,
        tipo_entrega: 'retiro'
    });
    return { id_pedido: pedido.id_pedido, ya_existia: false };
}

// ─────────────────────────────────────────────────────────────────────────
// LIMPIEZA BATCH (admin / cron)
// ─────────────────────────────────────────────────────────────────────────
/**
 * Para uso admin/cron: descarta borradores abandonados de TODA la empresa.
 * No respeta politica por usuario; aplica DESCARTADO directo (no suspende).
 * Equivalente al limpiarBorradoresAbandonados anterior.
 *
 * @returns {{ limpiados: number, ids: number[] }}
 */
async function limpiarAbandonadosEmpresa(client, datos) {
    const { id_empresa, horas } = datos;
    if (!id_empresa) throw new Error('borrador.helper.limpiarAbandonadosEmpresa: id_empresa obligatorio');
    const h = parseInt(horas, 10);
    if (!Number.isFinite(h) || h < 0) throw new Error('borrador.helper.limpiarAbandonadosEmpresa: horas invalido');

    const { rows } = await client.query(
        "UPDATE pedidos SET id_estado = $1 " +
        " WHERE id_estado = $2 AND id_empresa = $3 " +
        "   AND fecha_creacion < NOW() - ($4 || ' hours')::INTERVAL " +
        " RETURNING id_pedido",
        [pedidosHelper.PEDIDO_ESTADOS.DESCARTADO, pedidosHelper.PEDIDO_ESTADOS.BORRADOR, id_empresa, String(h)]
    );
    const ids = rows.map(function(r) { return r.id_pedido; });
    if (ids.length > 0) {
        logger.info('[borrador.helper] limpiarAbandonadosEmpresa: ' + ids.length +
                    ' descartado(s) en empresa ' + id_empresa + ' (>' + h + 'h)');
    }
    return { limpiados: ids.length, ids: ids };
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────
module.exports = {
    POLITICAS_AL_ABRIR,
    DEFAULTS,
    validarPertenencia,
    aplicarPoliticaAlAbrir,
    obtenerIdBorradorActivo,
    obtenerOCrearActivo,
    limpiarAbandonadosEmpresa
};
