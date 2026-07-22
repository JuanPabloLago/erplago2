/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIRMACIONES HELPER — ERP LAGO — FASE 8c
 * Orquestador del flujo confirmación/anulación de pagos.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONSUMIDORES: pagos-confirmacion.controller.v2.js, ventas-consulta.controller.js
 *
 * SCOPE — Propiedad y escrituras a tablas
 * ─────────────────────────────────────────────────────────────────────────
 * @canonical confirmaciones_pago
 *
 * @writes confirmaciones_pago                  (crearConfirmacion: INSERT;
 *                                               anularConfirmacion: estado='anulado')
 *
 * @writes-foreign recibos                      (crearReciboDesdeConfirmacion: INSERT.
 *                                               canónico=recibos.helper. Coordinado:
 *                                               un pago confirmado genera siempre
 *                                               un recibo asociado)
 *
 * @writes-foreign pagos.id_pago_estado         (anularPagoDeConfirmacion: estado=3.
 *                                               canónico=pagos.helper. Coordinado:
 *                                               anular la confirmación implica
 *                                               anular el pago vinculado)
 * @writes-foreign pagos.observaciones          (anularPagoDeConfirmacion: append motivo.
 *                                               canónico=pagos.helper)
 *
 * @writes-foreign clientes.saldo_favor         (acreditarSaldoFavor: incremento.
 *                                               canónico=clientes flow. Coordinado:
 *                                               cuando un pago anula, el monto vuelve
 *                                               al saldo a favor del cliente)
 */

// ═══════════════════════════════════════════════════════════════
// CONFIRMACIONES DE PAGO
// ═══════════════════════════════════════════════════════════════

async function crearConfirmacion(client, datos) {
    const {
        id_empresa, id_pedido, id_pago, id_remito,
        codigo_unico, metodo_pago, referencia_externa, monto, id_usuario_confirma,
        estado
    } = datos;

    const result = await client.query(`
        INSERT INTO confirmaciones_pago
        (id_empresa, id_pedido, id_pago, id_remito, codigo_unico, metodo_pago,
         referencia_externa, monto, id_usuario_confirma, estado, fecha_confirmacion)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        RETURNING *
    `, [
        id_empresa, id_pedido, id_pago, id_remito || null,
        codigo_unico, metodo_pago, referencia_externa || null,
        monto, id_usuario_confirma, estado || 'confirmado'
    ]);
    return result.rows[0];
}

async function anularConfirmacion(client, datos) {
    const { id_empresa, id_confirmacion } = datos;
    if (!id_empresa) throw new Error('confirmaciones.helper.anularConfirmacion: id_empresa obligatorio');
    const result = await client.query(
        `UPDATE confirmaciones_pago SET estado = 'anulado' WHERE id_confirmacion = $1 AND id_empresa = $2 RETURNING *`,
        [id_confirmacion, id_empresa]
    );
    if (result.rows.length === 0) {
        throw Object.assign(new Error('Confirmación no encontrada'), { statusCode: 404 });
    }
    return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// RECIBOS (creación desde confirmación de pago)
// ═══════════════════════════════════════════════════════════════

async function crearReciboDesdeConfirmacion(client, datos) {
    const {
        id_empresa, id_turno, id_cliente, id_pedido, id_usuario,
        numero_recibo, total_recibo, concepto, observaciones
    } = datos;

    const result = await client.query(`
        INSERT INTO recibos
        (id_empresa, id_turno, id_cliente, id_pedido, id_usuario, numero_recibo,
         total_recibo, concepto, observaciones)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id_recibo, numero_completo
    `, [
        id_empresa, id_turno || 0, id_cliente, id_pedido, id_usuario,
        numero_recibo, total_recibo, concepto, observaciones || null
    ]);
    return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// PAGOS (anulación desde confirmación)
// ═══════════════════════════════════════════════════════════════

async function anularPagoDeConfirmacion(client, datos) {
    const { id_pago, motivo } = datos;
    await client.query(`
        UPDATE pagos
        SET id_pago_estado = 3,
            observaciones = COALESCE(observaciones, '') || ' [ANULADO: ' || $2 || ']'
        WHERE id_pago = $1
    `, [id_pago, motivo || 'Sin motivo']);
}

// ═══════════════════════════════════════════════════════════════
// CLIENTES (saldo a favor)
// ═══════════════════════════════════════════════════════════════

async function acreditarSaldoFavor(client, datos) {
    const { id_empresa, id_cliente, monto } = datos;
    if (!id_empresa) throw new Error('confirmaciones.helper.acreditarSaldoFavor: id_empresa obligatorio');
    await client.query(`
        UPDATE clientes SET saldo_favor = COALESCE(saldo_favor, 0) + $1 WHERE id_cliente = $2 AND id_empresa = $3
    `, [monto, id_cliente, id_empresa]);
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
    crearConfirmacion, anularConfirmacion,
    crearReciboDesdeConfirmacion,
    anularPagoDeConfirmacion,
    acreditarSaldoFavor
};
