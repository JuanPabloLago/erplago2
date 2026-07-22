'use strict';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * pagos.helper.js — Helper centralizado para operaciones de PAGOS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ÚNICA puerta de entrada para INSERT/UPDATE en tabla `pagos`.
 * Centraliza: validación, registro en caja, cuenta corriente y recargos.
 *
 * SCOPE — Propiedad y escrituras a tablas
 * ─────────────────────────────────────────────────────────────────────
 * @canonical pagos
 *
 * @writes pagos                      (INSERT registrarPago,
 *                                     UPDATE id_pago_estado al anular,
 *                                     UPDATE estado en flujos varios)
 *
 * @writes-foreign pedidos.es_fiado   (registrarFiado: setea es_fiado=true.
 *                                     canónico=pedidos.helper. Coordinado:
 *                                     pago tipo 'fiado' marca el pedido.
 *                                     Flujo opuesto: despachos.helper setea
 *                                     es_fiado=false al cobrar en viaje)
 *
 * NOTA: Tabla `pagos` tiene id_empresa desde migración multi-empresa v2.
 *
 * Consumidores:
 *   - borrador.controller.js        (venta-rápida POS)
 *   - pedidos.controller.js          (retiro inmediato + guardar para entregar)
 *   - pagos-confirmacion.controller.v2.js  (confirmación con código único)
 *   - despachos.controller.js        (cobro en calle)
 *   - ventas-consulta.controller.js  (registro de pago desde consulta)
 *   - recibos.controller.js          (futuro)
 *
 * Depende de:
 *   - caja.helper.js       → registrarMovimiento (ingreso/egreso en caja)
 *   - cc-clientes.helper.js → registrarVentaConPago, registrarMovimiento
 *   - recargos.helper.js    → obtenerRecargo (lee recargo_porcentaje)
 *
 * Creado: 2026-02-19
 * Actualizado: 2026-02-28 — Multi-empresa v2 (id_empresa en pagos)
 * ═══════════════════════════════════════════════════════════════════════
 */

const cajaHelper = require('./caja.helper');
const ccClientesHelper = require('./cc-clientes.helper');
const remitoPagoSyncHelper = require('./remito-pago-sync.helper');
const recargosHelper = require('./recargos.helper');
const pedidosHelper = require('./pedidos.helper');

// ─── CONSTANTES (mirror de tabla pagoestados) ───────────────────────
const PAGO_ESTADOS = {
    PENDIENTE: 1,
    APROBADO: 2,
    RECHAZADO: 3,
    REEMBOLSADO: 4
};

// Métodos 1-5 = pago real (impactan caja)
// Método 6 = Cuenta Corriente (fiado, NO es pago real)
const METODOS_PAGO_REAL = [1, 2, 3, 4, 5];
const METODO_CUENTA_CORRIENTE = 6;


/**
 * ═══════════════════════════════════════════════════════════════════════
 * registrarPago — Función principal. ÚNICO punto de INSERT en `pagos`.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function registrarPago(client, params) {
    const {
        // ── OBLIGATORIOS ──
        id_empresa,
        id_pedido,
        id_metodo_pago,
        monto,
        id_usuario,

        // ── OPCIONALES ──
        id_pago_estado = PAGO_ESTADOS.PENDIENTE,
        id_transaccion_externa = null,
        observaciones = null,
        id_turno = null,
        id_cliente = null,
        id_forma_pago = null,
        concepto_prefijo = null,

        // ── TERMINAL / CUOTAS (opcional) ──
        id_terminal = null,
        cuotas = 1,
        coeficiente = 1.0000,
        monto_original = null,
        comision_estimada = 0,

        // ── FLAGS DE CONTROL ──
        registrar_en_caja = true,
        registrar_en_cc = true,
        omitir_ajuste_fp = false,

        // ── TRAZABILIDAD ──
        origen = 'pos',
    } = params;

    // ═══ 1. VALIDAR OBLIGATORIOS ═══
    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_pedido && origen !== 'cobranza_cc') throw _error('id_pedido es obligatorio', 400);
    if (!id_metodo_pago) throw _error('id_metodo_pago es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    const montoNumerico = parseFloat(monto);
    // SIGNO SOBERANO (2026-07-06): monto negativo = devolucion de dinero al
    // cliente por este metodo (egreso). Solo el cero es invalido.
    if (isNaN(montoNumerico) || montoNumerico === 0) {
        throw _error(`Monto inválido: ${monto} (monto cero invalido)`, 400);
    }

    // ═══ 1b. GUARD: Fiado no es pago — usar registrarFiado() ═══
    if (id_metodo_pago === METODO_CUENTA_CORRIENTE) {
        throw _error('Método CC (fiado) no se registra como pago. Usar registrarFiado()', 400);
    }

    // ═══ 2. VALIDAR PERTENENCIA PEDIDO → EMPRESA ═══
    // [cobranza_cc] Pago a cuenta puede no tener pedido.
    // Defensa espejo del CHECK chk_pagos_pedido_o_cobranza en BD.
    let clienteEfectivo = id_cliente;
    if (id_pedido) {
        const pedidoCheck = await client.query(
            'SELECT id_pedido, id_cliente, id_empresa FROM pedidos WHERE id_pedido = $1',
            [id_pedido]
        );
        if (pedidoCheck.rows.length === 0) {
            throw _error(`Pedido #${id_pedido} no existe`, 404);
        }
        const pedido = pedidoCheck.rows[0];
        if (pedido.id_empresa !== id_empresa) {
            throw _error(`Pedido #${id_pedido} no pertenece a empresa ${id_empresa}`, 403);
        }
        clienteEfectivo = id_cliente || pedido.id_cliente;
    } else if (!clienteEfectivo) {
        throw _error('Pago sin pedido (cobranza_cc) requiere id_cliente explicito', 400);
    }

    // ═══ 3. OBTENER RECARGO DEL MÉTODO (informativo) ═══
    let recargoPorcentaje = 0;
    try {
        const recargoInfo = await recargosHelper.obtenerRecargo(client, id_empresa, id_metodo_pago);
        if (recargoInfo && recargoInfo.porcentaje) {
            recargoPorcentaje = parseFloat(recargoInfo.porcentaje);
        }
    } catch (_e) {
        // Sin recargo configurado → 0
    }

    // ═══ 4. INSERT INTO PAGOS (con id_empresa) ═══
    // monto_original: si no viene, usar monto (sin interés = con interés)
    const montoOriginalFinal = monto_original !== null ? parseFloat(monto_original) : montoNumerico;

    const pagoResult = await client.query(`
        INSERT INTO pagos (
            id_pedido, id_metodo_pago, id_pago_estado,
            fecha_pago, monto, id_transaccion_externa,
            observaciones, recargo_porcentaje, id_empresa,
            id_terminal, cuotas, coeficiente, monto_original, comision_estimada, origen
        ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id_pago, id_pago_estado, fecha_pago, recargo_porcentaje
    `, [
        id_pedido,
        id_metodo_pago,
        id_pago_estado,
        montoNumerico,
        id_transaccion_externa,
        observaciones,
        recargoPorcentaje,
        id_empresa,
        id_terminal,
        cuotas || 1,
        coeficiente || 1.0000,
        montoOriginalFinal,
        comision_estimada || 0,
        origen
    ]);

    const pago = pagoResult.rows[0];

    // ═══ 5. REGISTRAR EN CAJA (si aplica) ═══
    if (registrar_en_caja && id_turno && METODOS_PAGO_REAL.includes(id_metodo_pago)) {
        // SIGNO SOBERANO (2026-07-06): pago negativo = devolucion de dinero.
        // A caja viaja como EGRESO con monto ABSOLUTO: el signo lo expresa
        // el tipo, nunca el numero (contadores de turno y arqueo sanos).
        const esDevolucionDinero = montoNumerico < 0;
        const conceptoCaja = concepto_prefijo
            ? `${concepto_prefijo} Pedido #${id_pedido}`
            : (esDevolucionDinero
                ? `Devolución Pedido #${id_pedido}`
                : `Venta Pedido #${id_pedido}`);

        await cajaHelper.registrarMovimiento(client, {
            id_empresa,
            id_turno,
            id_usuario,
            tipo: esDevolucionDinero ? 'egreso' : 'ingreso',
            id_moneda: 1,
            monto: Math.abs(montoNumerico),
            concepto: conceptoCaja,
            id_metodo_pago
        });
    }

    // ═══ 6. REGISTRAR EN CUENTA CORRIENTE (si aplica) ═══
    if (registrar_en_cc && clienteEfectivo) {
        await ccClientesHelper.registrarVentaConPago(client, {
            id_empresa,
            id_cliente: clienteEfectivo,
            id_pedido,
            id_pago: pago.id_pago,
            monto: montoNumerico,
            id_metodo_pago,
            id_usuario,
            id_forma_pago: id_forma_pago || null,
            concepto_prefijo: concepto_prefijo || null
        });
    }

    // ═══ 6.5 F1.5: APLICAR RECARGO POR FORMA DE PAGO (orquestador único) ═══
    // Resuelve id_forma_pago si no vino, consulta config, aplica el ajuste al pedido
    // (actualiza items + subtotal + iva + total_final + ND + mov CC en una sola llamada).
    // F4: si el caller indica omitir_ajuste_fp=true (caso cobranza.helper desde
    // borrador.controller), saltear porque el ajuste ya se aplico antes.
    if (id_pedido && clienteEfectivo && !omitir_ajuste_fp) {
        let id_fp_resuelto = id_forma_pago;
        if (!id_fp_resuelto && id_metodo_pago) {
            try {
                id_fp_resuelto = await recargosHelper.resolverFormaPago(client, id_empresa, id_metodo_pago);
            } catch (_e) { id_fp_resuelto = null; }
        }
        if (id_fp_resuelto) {
            const cfg = await recargosHelper.obtenerRecargo(client, id_empresa, id_fp_resuelto);
            if (cfg && parseFloat(cfg.porcentaje) !== 0) {
                const nombreFP = await recargosHelper.obtenerNombreFormaPago(client, id_empresa, id_fp_resuelto);
                try {
                    await pedidosHelper.aplicarAjusteFormaPago(client, {
                        id_pedido, id_empresa,
                        id_forma_pago: id_fp_resuelto,
                        id_cliente: clienteEfectivo,
                        id_usuario,
                        porcentaje: parseFloat(cfg.porcentaje),
                        nombre_forma_pago: nombreFP,
                        id_pago: pago.id_pago,
                        es_contado: id_metodo_pago !== 6
                    });
                } catch (err) {
                    logger.error('[F1.5] Error aplicando ajuste FP en registrarPago pedido #' + id_pedido + ': ' + err.message);
                    throw err;
                }
            }
        }
    }

    // ═══ 6.7 SINCRONIZAR REMITOS (3C.2 — 2026-04-19) ═══
    // Si el pedido quedó saldado tras este pago, marcar todos sus remitos
    // activos como pago_confirmado=true. Idempotente (no pisa los ya marcados).
    // Skip si origen==='despachos': ese camino ya marca el remito específico.
    if (id_pedido && origen !== 'despachos') {
        try {
            await remitoPagoSyncHelper.sincronizarRemitosPorPago(client, {
                id_empresa, id_pedido, id_metodo_pago
            });
        } catch (err) {
            // Nunca romper un pago por error en el sync de remitos.
            logger.error('[pagos.helper] Sync remitos fallo pedido #' + id_pedido + ': ' + err.message);
        }
    }

    // ═══ 7. RETURN RESULTADO ═══
    return {
        id_pago: pago.id_pago,
        id_pago_estado: pago.id_pago_estado,
        fecha_pago: pago.fecha_pago,
        recargo_porcentaje: pago.recargo_porcentaje,
        monto: montoNumerico,
        monto_original: montoOriginalFinal,
        cuotas: cuotas || 1,
        coeficiente: coeficiente || 1.0000,
        id_terminal,
        id_cliente: clienteEfectivo
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * registrarFiado — Marca pedido como fiado y registra DEBE en CC.
 * NO inserta en tabla pagos. El fiado no es un pago.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function registrarFiado(client, params) {
    const { id_empresa, id_pedido, id_cliente, id_usuario, monto } = params;

    if (!id_empresa || !id_pedido) throw _error('registrarFiado: id_empresa e id_pedido obligatorios', 400);
    const montoNum = parseFloat(monto);
    if (isNaN(montoNum) || montoNum <= 0) throw _error('registrarFiado: monto inválido', 400);

    // 1. Marcar pedido como fiado
    await client.query(
        'UPDATE pedidos SET es_fiado = true WHERE id_pedido = $1 AND id_empresa = $2',
        [id_pedido, id_empresa]
    );

    // 2. Registrar DEBE en CC (si no es Consumidor Final)
    // L4.1 (B8): defensa en profundidad. Si llega CF aca, es un bug del caller
    // (deberia haber sido bloqueado en cobranza.helper). Rechazamos explicito.
    if (id_cliente) {
        const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, id_cliente);
        if (esCF) {
            const e = _error('Consumidor Final no puede tener fiado. Llamada invalida a registrarFiado.', 400);
            e.code = 'FIADO_CF_PROHIBIDO';
            throw e;
        }
        // Cliente nominal: registrar movimiento de DEBE (regla negocio)
        if (!esCF) {
            const rNro = await client.query(
                'SELECT nro_pedido FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2',
                [id_pedido, id_empresa]
            );
            const nroDisplay = rNro.rows[0]?.nro_pedido || id_pedido;
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa,
                id_cliente,
                id_pedido,
                monto: montoNum,
                tipo: 'debe',
                concepto: 'Venta fiada Pedido #' + nroDisplay
            });
        }
    }

    return { fiado: true, monto: montoNum, id_pedido };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * confirmarPago — Cambia estado de Pendiente → Aprobado.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function confirmarPago(client, params) {
    const {
        id_pago,
        id_empresa,
        id_usuario,
        id_turno = null,
        observaciones = null
    } = params;

    if (!id_pago) throw _error('id_pago es obligatorio', 400);
    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    // Verificar pago + pertenencia a empresa (ahora directo en pagos)
    const pagoActual = await obtenerPago(client, id_pago, id_empresa);

    if (pagoActual.id_pago_estado === PAGO_ESTADOS.APROBADO) {
        return { id_pago, ya_aprobado: true, message: 'El pago ya estaba aprobado' };
    }

    if (pagoActual.id_pago_estado !== PAGO_ESTADOS.PENDIENTE) {
        throw _error(`Pago #${id_pago} no se puede confirmar (estado: ${pagoActual.estado_nombre})`, 400);
    }

    // Actualizar estado
    const obsActualizada = observaciones
        ? `${pagoActual.observaciones || ''} | Confirmado: ${observaciones}`.replace(/^\s*\|\s*/, '')
        : pagoActual.observaciones;

    await client.query(`
        UPDATE pagos SET id_pago_estado = $1, observaciones = $2
        WHERE id_pago = $3 AND id_empresa = $4
    `, [PAGO_ESTADOS.APROBADO, obsActualizada, id_pago, id_empresa]);

    // Registrar en caja ahora (para pagos diferidos)
    let registradoEnCaja = false;
    if (id_turno && METODOS_PAGO_REAL.includes(pagoActual.id_metodo_pago)) {
        await cajaHelper.registrarMovimiento(client, {
            id_empresa,
            id_turno,
            id_usuario,
            tipo: 'ingreso',
            id_moneda: 1,
            monto: parseFloat(pagoActual.monto),
            concepto: `Confirmación Pago #${id_pago} - Pedido #${pagoActual.id_pedido}`,
            id_metodo_pago: pagoActual.id_metodo_pago
        });
        registradoEnCaja = true;
    }

    return {
        id_pago,
        id_pago_estado: PAGO_ESTADOS.APROBADO,
        registrado_en_caja: registradoEnCaja
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * anularPago — Cambia estado a Reembolsado y reversa efectos.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function anularPago(client, params) {
    const {
        id_pago,
        id_empresa,
        id_usuario,
        id_turno = null,
        motivo = 'Anulación de pago'
    } = params;

    if (!id_pago) throw _error('id_pago es obligatorio', 400);
    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    const pago = await obtenerPago(client, id_pago, id_empresa);

    if (pago.id_pago_estado === PAGO_ESTADOS.RECHAZADO ||
        pago.id_pago_estado === PAGO_ESTADOS.REEMBOLSADO) {
        throw _error(`Pago #${id_pago} ya está ${pago.estado_nombre}`, 400);
    }

    const montoRevertido = parseFloat(pago.monto);

    // 1. CAMBIAR ESTADO
    await client.query(`
        UPDATE pagos
        SET id_pago_estado = $1,
            observaciones = COALESCE(observaciones, '') || $2
        WHERE id_pago = $3 AND id_empresa = $4
    `, [
        PAGO_ESTADOS.REEMBOLSADO,
        ` | ANULADO: ${motivo} (usuario: ${id_usuario})`,
        id_pago,
        id_empresa
    ]);

    // 2. REVERSA EN CAJA (egreso)
    if (id_turno && METODOS_PAGO_REAL.includes(pago.id_metodo_pago)) {
        await cajaHelper.registrarMovimiento(client, {
            id_empresa,
            id_turno,
            id_usuario,
            tipo: 'egreso',
            id_moneda: 1,
            monto: montoRevertido,
            concepto: `ANULACIÓN Pago #${id_pago} - Pedido #${pago.id_pedido} - ${motivo}`,
            id_metodo_pago: pago.id_metodo_pago
        });
    }

    // 3. REVERSA EN CC (DEBE para compensar HABER original)
    if (pago.id_cliente) {
        await ccClientesHelper.registrarMovimiento(client, {
            id_empresa,
            id_cliente: pago.id_cliente,
            monto: montoRevertido,
            tipo: 'debe',
            concepto: `ANULACIÓN Pago #${id_pago} - ${motivo}`,
            id_pago
        });
    }

    // 4. ANULAR AJUSTES DE FORMA DE PAGO (ND/NC)
    try {
        await recargosHelper.anularAjustesPorPedido(client, {
            id_empresa,
            id_pedido: pago.id_pedido,
            id_usuario,
            motivo: `Anulación pago #${id_pago}`
        });
    } catch (_e) {
        // Sin ajustes para anular → no es error
    }

    return {
        id_pago,
        id_pago_estado: PAGO_ESTADOS.REEMBOLSADO,
        monto_revertido: montoRevertido
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * obtenerPago — Obtiene pago con validación directa por id_empresa.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function obtenerPago(client, id_pago, id_empresa) {
    const result = await client.query(`
        SELECT p.id_pago, p.id_pedido, p.id_metodo_pago, p.id_pago_estado,
               p.fecha_pago, p.monto, p.id_transaccion_externa, p.observaciones,
               p.recargo_porcentaje, p.id_empresa,
               p.id_terminal, p.cuotas, p.coeficiente, p.monto_original, p.comision_estimada,
               ped.id_cliente,
               pe.nombre AS estado_nombre,
               mp.nombre AS metodo_nombre
        FROM pagos p
        JOIN pedidos ped ON ped.id_pedido = p.id_pedido
        JOIN pagoestados pe ON pe.id_pago_estado = p.id_pago_estado
        JOIN metodosdepago mp ON mp.id_metodo_pago = p.id_metodo_pago
        WHERE p.id_pago = $1 AND p.id_empresa = $2
    `, [id_pago, id_empresa]);

    if (result.rows.length === 0) {
        throw _error(`Pago #${id_pago} no existe o no pertenece a esta empresa`, 404);
    }

    return result.rows[0];
}




/**
 * ═══════════════════════════════════════════════════════════════════════
 * corregirMetodoPago — Corrige el método de pago post-venta.
 * ═══════════════════════════════════════════════════════════════════════
 * - Cambia id_metodo_pago en pagos
 * - Ajusta caja: egreso del método viejo + ingreso del nuevo
 * - Anula recargos viejos, aplica nuevos si corresponde
 * - Registra auditoría en observaciones
 * - Bloquea cambio desde/hacia CC (eso se hace con NC/ND)
 * - Bloquea si el pedido ya está facturado
 */
async function corregirMetodoPago(client, params) {
    const {
        id_empresa, id_pago, nuevo_id_metodo_pago,
        id_usuario, id_turno = null, motivo = ''
    } = params;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_pago) throw _error('id_pago es obligatorio', 400);
    if (!nuevo_id_metodo_pago) throw _error('nuevo_id_metodo_pago es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    // 1. Obtener pago actual con validación
    const pagoActual = await obtenerPago(client, id_pago, id_empresa);

    // 2. Validaciones
    if (pagoActual.id_metodo_pago === nuevo_id_metodo_pago) {
        throw _error('El método de pago ya es el seleccionado', 400);
    }
    if (pagoActual.id_metodo_pago === METODO_CUENTA_CORRIENTE || nuevo_id_metodo_pago === METODO_CUENTA_CORRIENTE) {
        throw _error('No se puede corregir desde/hacia Cuenta Corriente. Usá Notas de Crédito/Débito.', 400);
    }
    if (pagoActual.id_pago_estado === PAGO_ESTADOS.REEMBOLSADO || pagoActual.id_pago_estado === PAGO_ESTADOS.RECHAZADO) {
        throw _error(`No se puede corregir un pago ${pagoActual.estado_nombre}`, 400);
    }

    // 3. Verificar que no esté facturado
    const facturaCheck = await client.query(
        "SELECT id_factura FROM facturas WHERE id_pedido = $1 AND id_empresa = $2 AND estado != 'anulada'",
        [pagoActual.id_pedido, id_empresa]
    );
    if (facturaCheck.rows.length > 0) {
        throw _error('No se puede corregir: el pedido ya está facturado', 400);
    }

    const viejo_id_metodo = pagoActual.id_metodo_pago;
    const monto = parseFloat(pagoActual.monto);

    // 4. Obtener nombres de métodos
    const metodosResult = await client.query(
        'SELECT id_metodo_pago, nombre FROM metodosdepago WHERE id_metodo_pago = ANY($1)',
        [[viejo_id_metodo, nuevo_id_metodo_pago]]
    );
    const metodos = new Map(metodosResult.rows.map(r => [r.id_metodo_pago, r.nombre]));
    const nombreViejo = metodos.get(viejo_id_metodo) || 'Desconocido';
    const nombreNuevo = metodos.get(nuevo_id_metodo_pago) || 'Desconocido';

    // 5. Obtener recargo del nuevo método
    let nuevoRecargo = 0;
    try {
        await client.query('SAVEPOINT sp_recargo_check');
        const recargoInfo = await recargosHelper.obtenerRecargo(client, id_empresa, nuevo_id_metodo_pago);
        if (recargoInfo && recargoInfo.porcentaje) {
            nuevoRecargo = parseFloat(recargoInfo.porcentaje);
        }
    } catch (_e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_recargo_check');
    }

    // 6. UPDATE en pagos
    const fechaHora = new Date().toLocaleString('es-AR');
    const obsTexto = ` | CORRECCIÓN FP: ${nombreViejo} → ${nombreNuevo}${motivo ? ' (' + motivo + ')' : ''} — usuario:${id_usuario} ${fechaHora}`;

    await client.query(`
        UPDATE pagos SET
            id_metodo_pago = $1,
            recargo_porcentaje = $2,
            observaciones = COALESCE(observaciones, '') || $3
        WHERE id_pago = $4 AND id_empresa = $5
    `, [nuevo_id_metodo_pago, nuevoRecargo, obsTexto, id_pago, id_empresa]);

    // 7. Ajustar CAJA (si hay turno abierto)
    if (id_turno) {
        const viejoEsReal = METODOS_PAGO_REAL.includes(viejo_id_metodo);
        const nuevoEsReal = METODOS_PAGO_REAL.includes(nuevo_id_metodo_pago);

        // Reversar ingreso del método viejo
        if (viejoEsReal) {
            await cajaHelper.registrarMovimiento(client, {
                id_empresa, id_turno, id_usuario,
                tipo: 'egreso', id_moneda: 1, monto,
                concepto: `CORRECCIÓN FP: reversa ${nombreViejo} | Pago #${id_pago} Ped #${pagoActual.id_pedido}`,
                id_metodo_pago: viejo_id_metodo
            });
        }

        // Registrar ingreso del método nuevo
        if (nuevoEsReal) {
            await cajaHelper.registrarMovimiento(client, {
                id_empresa, id_turno, id_usuario,
                tipo: 'ingreso', id_moneda: 1, monto,
                concepto: `CORRECCIÓN FP: ${nombreViejo} → ${nombreNuevo} | Pago #${id_pago} Ped #${pagoActual.id_pedido}`,
                id_metodo_pago: nuevo_id_metodo_pago
            });
        }
    }

    // 8. Anular recargos viejos (con SAVEPOINT para proteger transacción)
    try {
        await client.query('SAVEPOINT sp_anular_recargos');
        await recargosHelper.anularAjustesPorPedido(client, {
            id_empresa, id_pedido: pagoActual.id_pedido,
            id_usuario, motivo: `Corrección FP pago #${id_pago}: ${nombreViejo} → ${nombreNuevo}`
        });
    } catch (_e) {
        await client.query('ROLLBACK TO SAVEPOINT sp_anular_recargos');
    }

    // 9. Aplicar recargo nuevo si corresponde
    if (nuevoRecargo !== 0) {
        try {
            await client.query('SAVEPOINT sp_aplicar_recargo');
            // F1.5: redirigido al orquestador único
            const cfgND = await recargosHelper.obtenerRecargo(client, id_empresa, nuevo_id_metodo_pago);
            const nombreFPND = await recargosHelper.obtenerNombreFormaPago(client, id_empresa, nuevo_id_metodo_pago);
            await pedidosHelper.aplicarAjusteFormaPago(client, {
                id_pedido: pagoActual.id_pedido,
                id_empresa,
                id_forma_pago: nuevo_id_metodo_pago,
                id_cliente: pagoActual.id_cliente,
                id_usuario,
                porcentaje: cfgND ? parseFloat(cfgND.porcentaje) : 0,
                nombre_forma_pago: nombreFPND,
                id_pago
            });
        } catch (_e) {
            await client.query('ROLLBACK TO SAVEPOINT sp_aplicar_recargo');
        }
    }

    return {
        id_pago,
        id_pedido: pagoActual.id_pedido,
        metodo_anterior: nombreViejo,
        metodo_nuevo: nombreNuevo,
        monto,
        recargo_nuevo: nuevoRecargo
    };
}

// ─── UTILIDAD INTERNA ───────────────────────────────────────────────
function _error(mensaje, statusCode) {
    const err = new Error(mensaje);
    err.statusCode = statusCode;
    return err;
}


// ─── EXPORTS ────────────────────────────────────────────────────────
module.exports = {
    registrarPago,
    registrarFiado,
    confirmarPago,
    anularPago,
    corregirMetodoPago,
    obtenerPago,
    PAGO_ESTADOS,
    METODOS_PAGO_REAL,
    METODO_CUENTA_CORRIENTE
};
