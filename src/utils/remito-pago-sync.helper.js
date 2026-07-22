'use strict';
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * REMITO-PAGO-SYNC HELPER — ERP LAGO
 *
 * Responsable ÚNICO de sincronizar remitos.pago_confirmado con el saldo
 * del pedido padre, después de cada pago registrado en pagos.helper.
 *
 * REGLA:
 *   - Un remito se marca pago_confirmado=true cuando el saldo del pedido
 *     padre queda <= TOLERANCIA_CENTAVOS post-pago.
 *   - Si el pedido tiene múltiples remitos, se marcan TODOS los activos
 *     (despachado/entregado/parcial) que aún no estén confirmados.
 *   - No toca remitos anulados, no_entregados, ni ya confirmados (idempotente).
 *   - Si queda saldo > tolerancia (pago parcial real), no marca ninguno.
 *
 * SCOPE: Enterprise (requiere id_empresa).
 *
 * CONSUMIDOR: pagos.helper.registrarPago() — punto único de enganche.
 * ════════════════════════════════════════════════════════════════════════════════
 */
const logger = require('./logger');
const ccClientesHelper = require('./cc-clientes.helper');

const TOLERANCIA_CENTAVOS = 1.00;  // saldo final post-pago <= $1 se considera pagado
const ESTADOS_REMITO_MARCABLE = ['despachado', 'entregado', 'parcial'];

/**
 * Sincroniza remitos.pago_confirmado según saldo post-pago del pedido.
 *
 * @param {object} client - pg client dentro de transacción
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_pedido
 * @param {number} params.id_metodo_pago - para derivar el nombre a guardar
 * @returns {Promise<{marcados: number, saldo_restante: number, skipped_reason?: string}>}
 */
async function sincronizarRemitosPorPago(client, { id_empresa, id_pedido, id_metodo_pago }) {
    if (!id_empresa || !id_pedido) {
        logger.warn('[remito-pago-sync] Parametros incompletos, skip');
        return { marcados: 0, saldo_restante: null, skipped_reason: 'params_incompletos' };
    }

    // 1. Consultar saldo post-pago
    const saldoQ = await client.query(
        'SELECT saldo FROM v_saldo_pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [id_pedido, id_empresa]
    );

    if (saldoQ.rows.length === 0) {
        // Pedido sin vista de saldo: probablemente anulado o sin remito. Nada que hacer.
        return { marcados: 0, saldo_restante: null, skipped_reason: 'pedido_sin_saldo_en_vista' };
    }

    const saldo = parseFloat(saldoQ.rows[0].saldo);

    // 2. Si queda saldo > tolerancia, pago parcial real → no marcar
    if (saldo > TOLERANCIA_CENTAVOS) {
        return { marcados: 0, saldo_restante: saldo, skipped_reason: 'pago_parcial' };
    }

    // 3. Derivar nombre del método de pago para guardar en remito
    let nombreMetodo = null;
    try {
        nombreMetodo = await ccClientesHelper.obtenerNombreMetodo(client, id_metodo_pago, id_empresa);
    } catch (_e) {
        nombreMetodo = 'Desconocido';
    }

    // 4. UPDATE idempotente: solo toca remitos activos NO confirmados
    const result = await client.query(`
        UPDATE remitos
           SET pago_confirmado = true,
               fecha_pago      = NOW(),
               metodo_pago     = $1
         WHERE id_pedido       = $2
           AND id_empresa      = $3
           AND estado          = ANY($4::text[])
           AND pago_confirmado = false
        RETURNING id_remito
    `, [nombreMetodo, id_pedido, id_empresa, ESTADOS_REMITO_MARCABLE]);

    const marcados = result.rowCount;

    if (marcados > 0) {
        logger.info(`[remito-pago-sync] Pedido #${id_pedido}: ${marcados} remito(s) marcado(s) como cobrado (saldo=$${saldo.toFixed(2)})`);
    }

    return { marcados, saldo_restante: saldo };
}

module.exports = {
    sincronizarRemitosPorPago,
    TOLERANCIA_CENTAVOS,
    ESTADOS_REMITO_MARCABLE
};
