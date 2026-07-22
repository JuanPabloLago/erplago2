'use strict';
/**
 * afip-auditoria.helper.js — Single write-point para afip_solicitudes
 *
 * @canonical afip_solicitudes
 * @writes afip_solicitudes (INSERT pre-llamada AFIP, UPDATE post-resultado)
 *
 * USO TIPICO desde un controller que invoca AFIP:
 *
 *   const pre = await afipAud.consultarPorIdempotencyKey(id_empresa, idempotency_key);
 *   if (pre && pre.resultado === 'A' && pre.cae) {
 *       // CAE huerfano detectado: reusar sin re-llamar AFIP
 *       return { cae: pre.cae, cae_vencimiento: pre.cae_vencimiento, ... };
 *   }
 *   if (pre) { return res.status(409).json({ ... }); } // pendiente/rechazado, abortar
 *
 *   const sol = await afipAud.preGrabarSolicitud({ id_empresa, idempotency_key, ... });
 *   const t0 = Date.now();
 *   try {
 *       const r = await afipService.solicitarCAE(payload);
 *       await afipAud.registrarResultado({
 *           id_solicitud: sol.id_solicitud,
 *           resultado: 'A', cae: r.cae, cae_vencimiento: r.cae_vencimiento,
 *           numero_obtenido: payload.numero_factura,
 *           duracion_ms: Date.now() - t0,
 *       });
 *   } catch (e) {
 *       await afipAud.registrarResultado({
 *           id_solicitud: sol.id_solicitud, resultado: 'R',
 *           duracion_ms: Date.now() - t0, error_app: e.message,
 *       });
 *       throw e;
 *   }
 *
 * INVARIANTE: usa pool directo (NO recibe client). Las escrituras a
 * afip_solicitudes son EN TRANSACCIONES PROPIAS para que no las afecte
 * un ROLLBACK del flujo principal del controller.
 */

const pool = require('../config/db');
const logger = require('./logger');

const TIPOS_OPERACION = ['solicitarCAE', 'consultarCbte', 'ultimoCbte', 'consultarPadron'];
const RESULTADOS = ['A', 'R', 'O']; // Aprobado, Rechazado, Observado

// ─── consultarPorIdempotencyKey ─────────────────────────────────────────────

/**
 * Consulta si ya existe una solicitud con esta key.
 * Devuelve la fila completa o null.
 */
async function consultarPorIdempotencyKey(id_empresa, idempotency_key) {
    if (!id_empresa) throw new Error('consultarPorIdempotencyKey: id_empresa requerido');
    if (!idempotency_key) return null;

    const r = await pool.query(
        `SELECT id_solicitud, id_empresa, idempotency_key, fecha_solicitud,
                tipo_operacion, cbte_tipo, punto_venta,
                numero_solicitado, numero_obtenido,
                cae, cae_vencimiento, importe_total,
                afip_observaciones, afip_errores,
                resultado, duracion_ms, error_app,
                id_factura, id_nota, id_pedido, id_usuario, ip_origen
           FROM afip_solicitudes
          WHERE id_empresa = $1 AND idempotency_key = $2`,
        [id_empresa, idempotency_key]
    );
    return r.rows[0] || null;
}

// ─── preGrabarSolicitud ─────────────────────────────────────────────────────

/**
 * Pre-graba una solicitud AFIP en estado pendiente (resultado=NULL).
 * Devuelve { id_solicitud } para usar en registrarResultado posterior.
 *
 * Si ya existe una con misma (id_empresa, idempotency_key), TIRA error.
 * El caller debe consultarPorIdempotencyKey ANTES y manejar el caso.
 */
async function preGrabarSolicitud({
    id_empresa, idempotency_key, tipo_operacion,
    cbte_tipo, punto_venta, numero_solicitado,
    importe_total,
    id_factura, id_nota, id_pedido, id_usuario, ip_origen,
    request_xml,
}) {
    if (!id_empresa) throw new Error('preGrabarSolicitud: id_empresa requerido');
    if (!idempotency_key) throw new Error('preGrabarSolicitud: idempotency_key requerido');
    if (!tipo_operacion) throw new Error('preGrabarSolicitud: tipo_operacion requerido');
    if (!TIPOS_OPERACION.includes(tipo_operacion)) {
        throw new Error(`preGrabarSolicitud: tipo_operacion invalido: ${tipo_operacion}`);
    }

    const ins = await pool.query(
        `INSERT INTO afip_solicitudes (
            id_empresa, idempotency_key, tipo_operacion,
            cbte_tipo, punto_venta, numero_solicitado,
            importe_total,
            id_factura, id_nota, id_pedido, id_usuario, ip_origen,
            request_xml, resultado
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL)
         RETURNING id_solicitud, fecha_solicitud`,
        [
            id_empresa, idempotency_key, tipo_operacion,
            cbte_tipo || null, punto_venta || null, numero_solicitado || null,
            importe_total != null ? importe_total : null,
            id_factura || null, id_nota || null, id_pedido || null,
            id_usuario || null, ip_origen || null,
            request_xml || null,
        ]
    );

    const row = ins.rows[0];
    logger.info(
        `[afip-auditoria] preGrabar id=${row.id_solicitud} ` +
        `key=${idempotency_key} op=${tipo_operacion} ` +
        `pv=${punto_venta} tipo=${cbte_tipo} num=${numero_solicitado}`
    );
    return { id_solicitud: row.id_solicitud, fecha_solicitud: row.fecha_solicitud };
}

// ─── registrarResultado ─────────────────────────────────────────────────────

/**
 * Actualiza el resultado de una solicitud previamente pre-grabada.
 * Llamar DESPUES de invocar AFIP, con el resultado real.
 *
 * Idempotente: si se llama dos veces con el mismo id_solicitud, sobreescribe.
 */
async function registrarResultado({
    id_solicitud,
    resultado,
    cae, cae_vencimiento, numero_obtenido,
    afip_observaciones, afip_errores,
    response_xml, duracion_ms, error_app,
}) {
    if (!id_solicitud) throw new Error('registrarResultado: id_solicitud requerido');
    if (resultado != null && !RESULTADOS.includes(resultado)) {
        throw new Error(`registrarResultado: resultado invalido: ${resultado}`);
    }

    await pool.query(
        `UPDATE afip_solicitudes SET
            resultado          = $2,
            cae                = $3,
            cae_vencimiento    = $4,
            numero_obtenido    = $5,
            afip_observaciones = $6,
            afip_errores       = $7,
            response_xml       = $8,
            duracion_ms        = $9,
            error_app          = $10
          WHERE id_solicitud   = $1`,
        [
            id_solicitud,
            resultado || null,
            cae || null,
            cae_vencimiento || null,
            numero_obtenido || null,
            afip_observaciones ? JSON.stringify(afip_observaciones) : null,
            afip_errores       ? JSON.stringify(afip_errores)       : null,
            response_xml || null,
            duracion_ms != null ? Math.round(duracion_ms) : null,
            error_app || null,
        ]
    );

    logger.info(
        `[afip-auditoria] registrarResultado id=${id_solicitud} ` +
        `resultado=${resultado || 'NULL'} cae=${cae || '(sin cae)'} ` +
        `dur=${duracion_ms || '?'}ms`
    );
}

// ─── EXPORTS ────────────────────────────────────────────────────────────────

module.exports = {
    consultarPorIdempotencyKey,
    preGrabarSolicitud,
    registrarResultado,
    TIPOS_OPERACION,
    RESULTADOS,
};
