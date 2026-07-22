/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RECIBOS HELPER — ERP LAGO — FASE 8a
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONSUMIDORES: recibos.controller.js
 * NOTA: facturas, caja y cc-clientes ya usan sus propios helpers
 *
 * SCOPE — Propiedad y escrituras a tablas
 * ─────────────────────────────────────────────────────────────────────────
 * @canonical recibos
 * @canonical recibo_items
 * @canonical recibo_facturas
 * @canonical secuencia_recibos
 *
 * @writes recibos                    (crearRecibo INSERT, actualizar UPDATE)
 * @writes recibo_items               (INSERT por item del recibo)
 * @writes recibo_facturas            (INSERT aplicación, DELETE eliminar)
 * @writes secuencia_recibos          (UPDATE ultimo_numero, INSERT inicial)
 *
 * @writes-foreign movimientos_caja   (eliminarMovimientosCaja: DELETE solo,
 *                                     en anulación de recibo. canónico=
 *                                     caja.helper. Coordinado: anular un
 *                                     recibo borra su movimiento de caja
 *                                     asociado)
 */

// ═══════════════════════════════════════════════════════════════
// RECIBOS — Cabecera
// ═══════════════════════════════════════════════════════════════

async function crearRecibo(client, datos) {
    const {
        id_empresa, id_cliente, id_usuario, id_turno,
        numero_recibo, total_recibo, id_moneda_recibo, concepto, observaciones,
        tipo = 'cobro'
    } = datos;

    const result = await client.query(`
        INSERT INTO recibos (
            id_empresa, id_cliente, id_usuario, id_turno,
            numero_recibo, fecha_recibo,
            total_recibo, id_moneda_recibo, concepto, observaciones, tipo
        ) VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,$9,$10)
        RETURNING *
    `, [id_empresa, parseInt(id_cliente, 10), id_usuario, id_turno,
        numero_recibo, parseFloat(total_recibo), id_moneda_recibo || 1,
        concepto || 'Procesando...', observaciones || null, tipo]);
    return result.rows[0];
}

async function actualizarRecibo(client, datos) {
    const { id_empresa, id_recibo, concepto, total_recibo } = datos;
    if (!id_empresa) throw new Error('recibos.helper.actualizarRecibo: id_empresa obligatorio');
    await client.query(
        `UPDATE recibos SET concepto = $1, total_recibo = $2 WHERE id_recibo = $3 AND id_empresa = $4`,
        [concepto, total_recibo, id_recibo, id_empresa]
    );
}

async function anularRecibo(client, datos) {
    const { id_recibo, motivo } = datos;
    const motivoSanitizado = (motivo || '-').replace(/'/g, "''");
    await client.query(`
        UPDATE recibos
        SET total_recibo = 0,
            observaciones = COALESCE(observaciones,'') || ' [ANULADO: ' || $2 || ']'
        WHERE id_recibo = $1
    `, [id_recibo, motivoSanitizado]);
}

// ═══════════════════════════════════════════════════════════════
// RECIBO ITEMS (formas de pago del recibo)
// ═══════════════════════════════════════════════════════════════

async function insertarReciboItem(client, datos) {
    const {
        id_empresa, id_recibo, id_forma_pago, id_moneda,
        monto_original, cotizacion_usada, monto_convertido,
        id_tarjeta, cuotas, interes_aplicado, monto_interes, monto_con_interes,
        id_banco, numero_referencia, fecha_acreditacion, observaciones
    } = datos;

    await client.query(`
        INSERT INTO recibo_items (
            id_empresa, id_recibo, id_forma_pago, id_moneda,
            monto_original, cotizacion_usada, monto_convertido,
            id_tarjeta, cuotas, interes_aplicado, monto_interes, monto_con_interes,
            id_banco, numero_referencia, fecha_acreditacion, observaciones
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [
        id_empresa, id_recibo, parseInt(id_forma_pago, 10), id_moneda || 1,
        monto_original, cotizacion_usada || 1, monto_convertido,
        id_tarjeta || null, parseInt(cuotas, 10) || 1,
        parseFloat(interes_aplicado) || 0, parseFloat(monto_interes) || 0,
        parseFloat(monto_con_interes) || monto_original,
        id_banco || null, numero_referencia || null, fecha_acreditacion || null, observaciones || null
    ]);
}

// ═══════════════════════════════════════════════════════════════
// RECIBO FACTURAS (aplicaciones FIFO)
// ═══════════════════════════════════════════════════════════════

async function aplicarAFactura(client, datos) {
    const { id_empresa, id_recibo, id_factura, monto_aplicado } = datos;
    await client.query(`
        INSERT INTO recibo_facturas (id_empresa, id_recibo, id_factura, monto_aplicado, fecha_aplicacion)
        VALUES ($1,$2,$3,$4,NOW())
    `, [id_empresa, id_recibo, id_factura, monto_aplicado]);
}

async function eliminarAplicaciones(client, datos) {
    const { id_recibo } = datos;
    await client.query(`DELETE FROM recibo_facturas WHERE id_recibo = $1`, [id_recibo]);
}

// ═══════════════════════════════════════════════════════════════
// MOVIMIENTOS CAJA (solo DELETE para anulación)
// ═══════════════════════════════════════════════════════════════

async function eliminarMovimientosCaja(client, datos) {
    const { id_recibo } = datos;
    await client.query(`DELETE FROM movimientos_caja WHERE id_recibo = $1`, [id_recibo]);
}

// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// SECUENCIA ATÓMICA DE RECIBOS (anti race-condition)
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene el próximo número de recibo de forma atómica.
 * Usa UPDATE ... RETURNING para garantizar unicidad bajo concurrencia.
 * ÚNICO punto de obtención de número de recibo en todo el sistema.
 */
async function proximoNumeroRecibo(client, id_empresa) {
    if (!id_empresa) throw new Error('recibos.helper.proximoNumeroRecibo: id_empresa obligatorio');

    const { rows } = await client.query(
        `UPDATE secuencia_recibos
         SET ultimo_numero = ultimo_numero + 1
         WHERE id_empresa = $1
         RETURNING ultimo_numero`,
        [id_empresa]
    );

    if (rows.length === 0) {
        // Empresa sin registro — crear e iniciar en 1
        const { rows: inserted } = await client.query(
            `INSERT INTO secuencia_recibos (id_empresa, ultimo_numero)
             VALUES ($1, 1)
             ON CONFLICT (id_empresa) DO UPDATE SET ultimo_numero = secuencia_recibos.ultimo_numero + 1
             RETURNING ultimo_numero`,
            [id_empresa]
        );
        return inserted[0].ultimo_numero;
    }

    return rows[0].ultimo_numero;
}

module.exports = {
    proximoNumeroRecibo,
    crearRecibo, actualizarRecibo, anularRecibo,
    insertarReciboItem,
    aplicarAFactura, eliminarAplicaciones,
    eliminarMovimientosCaja
};
