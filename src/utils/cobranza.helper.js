/**
 * ════════════════════════════════════════════════════════════════════════════════
 * COBRANZA HELPER — ERP LAGO
 * ────────────────────────────────────────────────────────────────────────────────
 * Orchestrator de cobro/fiado. Compone helpers existentes en transaccion atomica.
 * NO sustituye pagos.helper / cc-clientes.helper / caja.helper — los compone.
 *
 * Reglas de negocio aplicadas:
 *   R2: cliente id_consumidor_final (config) NO puede fiar (bloquea venta-rapida).
 *   R5: pedido con cliente con nombre + sin pago = fiado automatico = va a CC.
 *   R7: nada hardcoded — todo configurable desde configuraciones_empresa.
 *
 * Configuracion leida (todas con defaults):
 *   clientes.id_consumidor_final  (default 9)
 *   cc.cliente_cf_prohibe_fiado   (default true)
 *   cc.tolerancia_redondeo        (default 1.00)
 *
 * ENTRADA PUBLICA:
 *   - liquidarPedidoNuevo(client, params) — desde borrador.controller.confirmarBorrador
 *
 * Errores con codigo de negocio (caller los traduce a HTTP):
 *   CF_NO_PUEDE_FIAR        — 400, cliente CF intento fiar
 *   SUMA_INCONSISTENTE      — 400, pagos+fiado != total +/- tolerancia
 *   PEDIDO_NO_ENCONTRADO    — 404, id_pedido no existe en empresa
 *   CAJA_CERRADA            — 400, requiere turno abierto pero no hay
 * ════════════════════════════════════════════════════════════════════════════════
 */

const cfg = require('./config.helper');
const pagosHelper = require('./pagos.helper');
const cajaHelper = require('./caja.helper');
const stockHelper = require('./stock.helper');
const terminalesHelper = require('./terminales.helper');
const pedidosHelper = require('./pedidos.helper');
const logger = require('./logger');

function _bizError(message, code, statusCode) {
    const e = new Error(message);
    e.code = code;
    e.statusCode = statusCode;
    return e;
}

/**
 * Valida que (deuda_actual + monto_a_fiar) no exceda el limite de credito del cliente.
 * Se ejecuta SIEMPRE que un movimiento vaya a generar fiado (CC), independiente de
 * que el frontend lo declare o no. Es la barrera anti-sobrelimite.
 *
 * Reglas:
 *   - Si cliente.limite_credito > 0 => usa ese limite.
 *   - Si cliente.limite_credito = 0 => usa cc.limite_credito_default (config).
 *   - Si limite efectivo = 0 => SIN limite, no valida (caso default).
 *
 * Throws LIMITE_CREDITO_EXCEDIDO con detalle (limite, deuda_actual, monto_a_fiar, deuda_total).
 *
 * @param {object} client
 * @param {object} params { id_empresa, id_cliente, monto_a_fiar }
 */
async function _validarLimiteCC(client, params) {
    const { id_empresa, id_cliente, monto_a_fiar } = params;
    const monto = parseFloat(monto_a_fiar) || 0;
    if (!id_cliente || monto <= 0) return;

    const ccClientesHelper = require('./cc-clientes.helper');
    const saldoData = await ccClientesHelper.obtenerSaldo(client, id_empresa, id_cliente);
    const deudaActual = parseFloat((saldoData && saldoData.saldo) || 0);

    const limRes = await client.query(
        'SELECT COALESCE(limite_credito, 0) AS limite FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
        [id_cliente, id_empresa]
    );
    const limiteCliente = parseFloat(limRes.rows[0]?.limite || 0);

    const limiteDefaultStr = await cfg.get(client, id_empresa, 'cc.limite_credito_default', '0');
    const limiteDefault = parseFloat(limiteDefaultStr) || 0;

    const limiteEfectivo = limiteCliente > 0 ? limiteCliente : limiteDefault;
    if (limiteEfectivo <= 0) return;

    const deudaTotal = deudaActual + monto;
    if (deudaTotal > limiteEfectivo) {
        const e = _bizError(
            `Excede limite de credito. Limite=$${limiteEfectivo.toFixed(2)}, ` +
            `deuda actual=$${deudaActual.toFixed(2)}, monto a fiar=$${monto.toFixed(2)}, ` +
            `deuda total=$${deudaTotal.toFixed(2)}`,
            'LIMITE_CREDITO_EXCEDIDO', 400
        );
        e.detalle = {
            limite: limiteEfectivo, deuda_actual: deudaActual,
            monto_a_fiar: monto, deuda_total: deudaTotal
        };
        throw e;
    }
}

/**
 * Liquida un pedido nuevo desde venta-rapida (borrador.controller.confirmarBorrador).
 * Decide internamente: pago, fiado, mixto, o bloqueo CF.
 *
 * @param {object} client - pg client dentro de transaccion abierta
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_pedido
 * @param {number} params.id_cliente
 * @param {number} params.id_usuario
 * @param {Array}  [params.pagos]          - [{id_metodo_pago, monto, id_forma_pago, id_plan, monto_original, ...}]
 * @param {boolean} [params.fiadoFlag]     - true si el frontend marco fiado
 * @param {number} [params.montoFiadoBody] - monto a fiar (parcial o total)
 * @returns {Promise<{liquidacion, id_turno, pagos_creados, fiado_creado, total_pedido, total_liquidado}>}
 */
async function liquidarPedidoNuevo(client, params) {
    const {
        id_empresa, id_pedido, id_cliente, id_usuario,
        pagos = [], fiadoFlag = false, montoFiadoBody = 0
    } = params;

    if (!id_empresa || !id_pedido || !id_cliente) {
        throw new Error('cobranza.liquidarPedidoNuevo: id_empresa, id_pedido, id_cliente obligatorios');
    }

    // ─── 1. Total real del pedido (post-ajuste FP si lo hubo) ───
    const totRes = await client.query(
        'SELECT COALESCE(total_final, total) AS total FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [id_pedido, id_empresa]
    );
    if (totRes.rows.length === 0) {
        throw _bizError('Pedido no encontrado', 'PEDIDO_NO_ENCONTRADO', 404);
    }
    const total_pedido = parseFloat(totRes.rows[0].total) || 0;

    // ─── 1.5 Short-circuit: SOLO total exactamente 0 y sin pagos ───
    // Caso legitimo: descuento 100%, productos a $0. Nada que cobrar.
    // SIGNO SOBERANO (2026-07-06): total NEGATIVO ya NO es no-op — es una
    // devolucion neta y la plata DEBE egresar registrada. Fluye a la via
    // algebraica: o el caller manda el pago negativo, o se aborta.
    if (total_pedido === 0 && pagos.length === 0) {
        logger.info(
            `[cobranza.liquidar] Pedido #${id_pedido} con total=0 y sin pagos. ` +
            `No-op legitimo. Cliente=${id_cliente}.`
        );
        return {
            liquidacion: 'sin_movimiento', id_turno: null, pagos_creados: 0,
            fiado_creado: false, total_pedido, total_liquidado: 0
        };
    }
    // Devolucion neta sin egreso declarado: error explicito ANTES del guard
    // generico, con mensaje que el cajero entienda (anti-error humano).
    if (total_pedido < 0 && pagos.length === 0) {
        throw _bizError(
            `Este pedido devuelve $${Math.abs(total_pedido).toFixed(2)} al cliente. ` +
            `Registra la devolucion del dinero (metodo por el que salio el pago) antes de confirmar.`,
            'DEVOLUCION_SIN_EGRESO', 400
        );
    }

    // ─── 2. Validar formato: metodo=6 (CC) NO es pago, va por flag fiado ───
    // L4.1 (B7): defensa. Frontend nuevo no manda metodo=6, pero protegemos
    // contra caller viejo o malicioso. La CC se DEDUCE del saldo, no se cobra.
    const tienePagoCC = pagos.some(p => (p.id_metodo_pago || 1) === 6);
    if (tienePagoCC) {
        throw _bizError(
            'Metodo de pago invalido: la cuenta corriente no es una forma de cobro. ' +
            'El saldo no cubierto se registra como fiado automaticamente.',
            'METODO_CC_NO_VALIDO', 400
        );
    }

    // ─── 2.5 Pre-loop: aplicar recargo cuotas e inflar total_final ───
    // F1.6: ANTES de validar sobrepago, aplicar el recargo de cuotas al
    // total del pedido. Sin esto, total_pedido queda en $40 y el pago de
    // $53.48 dispara falso "Sobrepago". Esto debe correr antes del paso 3.
    // NO registra el pago todavia (eso lo hace paso 9). Solo infla total_final
    // y deja pago.monto inflado en memoria para que paso 3 sume bien.
    let total_pedido_inflado = total_pedido;
    for (const pago of pagos) {
        if (!pago.id_plan) continue;
        const montoBase = pago.monto_original ? parseFloat(pago.monto_original) : parseFloat(pago.monto);
        const calc = await terminalesHelper.calcularInteres(client, pago.id_plan, id_empresa, montoBase);
        const interes = Math.round((calc.monto_final - calc.monto_original) * 100) / 100;
        if (interes > 0) {
            await pedidosHelper.registrarInteresCuotas(client, {
                id_empresa, id_pedido, id_cliente, id_usuario, interes, calculo: calc
            });
            total_pedido_inflado = Math.round((total_pedido_inflado + interes) * 100) / 100;
            pago.monto = calc.monto_final;
            pago._cuotas_aplicadas = { calc };
        }
    }

    // ─── 3. Sumar pagos reales y deducir fiado del SALDO ───
    // L4.1: el fiado deja de venir como flag/monto del frontend. Se deduce
    // del saldo (total_pedido - sumaPagosReales). El flag fiadoFlag queda
    // como info pero no es autoritativo.
    const sumaPagosReales = pagos.reduce((s, p) => s + (parseFloat(p.monto) || 0), 0);
    const tol = parseFloat(await cfg.get(client, id_empresa, 'cc.tolerancia_redondeo', 1.00));

    let fiadoMonto = Math.round((total_pedido_inflado - sumaPagosReales) * 100) / 100;
    if (Math.abs(fiadoMonto) <= tol) fiadoMonto = 0;

    // Sobrepago: pagos > total_inflado + tolerancia
    if (fiadoMonto < -tol) {
        throw _bizError(
            `Sobrepago: pagos=$${sumaPagosReales.toFixed(2)} > total=$${total_pedido_inflado.toFixed(2)} ` +
            `(diferencia $${Math.abs(fiadoMonto).toFixed(2)} excede tolerancia $${tol.toFixed(2)})`,
            'SUMA_INCONSISTENTE', 400
        );
    }
    fiadoMonto = Math.max(0, fiadoMonto);

    // Si el frontend mando flag/monto explicito, log si discrepa (BD wins)
    if (fiadoFlag && Math.abs((parseFloat(montoFiadoBody) || 0) - fiadoMonto) > tol) {
        logger.warn(
            `[cobranza.liquidar] Flag fiado mando $${montoFiadoBody}, ` +
            `deducido del saldo=$${fiadoMonto.toFixed(2)}. Usando deducido.`
        );
    }

    const totalLiquidado = sumaPagosReales + fiadoMonto;

    // ─── 4. Detectar CF generico ───
    const idCF = parseInt(await cfg.get(client, id_empresa, 'clientes.id_consumidor_final', 9));
    const cfProhibe = await cfg.get(client, id_empresa, 'cc.cliente_cf_prohibe_fiado', true);
    const esCFgenerico = (id_cliente === idCF) && (cfProhibe === true);

    // ─── 5. Bloquear CF con fiado (mensajes especificos: total vs parcial) ───
    if (fiadoMonto > 0 && esCFgenerico) {
        if (sumaPagosReales > 0) {
            throw _bizError(
                `Consumidor Final generico no puede dejar saldo en CC. ` +
                `Saldo pendiente $${fiadoMonto.toFixed(2)}. Cobrar el total $${total_pedido.toFixed(2)}.`,
                'CF_NO_PUEDE_PARCIAL', 400
            );
        } else {
            throw _bizError(
                'Consumidor Final generico no puede fiar. Seleccione una forma de pago.',
                'CF_NO_PUEDE_FIAR', 400
            );
        }
    }

    // ─── 6. Caso "todo fiado" (no hay pagos reales, todo va a CC) ───
    if (sumaPagosReales === 0 && fiadoMonto > 0) {
        await _validarLimiteCC(client, {
            id_empresa, id_cliente, monto_a_fiar: fiadoMonto
        });
        await pagosHelper.registrarFiado(client, {
            id_empresa, id_pedido, id_cliente, id_usuario, monto: fiadoMonto
        });
        logger.info(
            `[cobranza.liquidar] Pedido #${id_pedido} -> fiado total $${fiadoMonto.toFixed(2)} ` +
            `(cliente ${id_cliente})`
        );
        return {
            liquidacion: 'fiada', id_turno: null, pagos_creados: 0,
            fiado_creado: true, total_pedido, total_liquidado: fiadoMonto
        };
    }

    // ─── 7. Turno de caja si hay pagos efvo/MP/transfer/credito/debito ───
    let id_turno = null;
    const necesitaCaja = pagos.some(p => {
        const m = p.id_metodo_pago || 1;
        return m >= 1 && m <= 5;
    });
    if (necesitaCaja) {
        // L2 (D5): resolver el deposito del usuario operador para que en
        // multi-sucursal cada vendedor cobre en LA caja de SU deposito.
        // Si el JWT/usuario no tiene id_deposito, stockHelper hace fallback
        // al principal de la empresa (comportamiento historico).
        const id_deposito_usr = await stockHelper.obtenerDepositoUsuario(
            client, { id_empresa, id_usuario }
        );
        const turno = await cajaHelper.requerirTurnoAbierto(
            client, id_empresa, { id_deposito: id_deposito_usr }
        );
        id_turno = turno.id_turno;
    }

    // ─── 8. Fiado parcial primero ───
    if (fiadoMonto > 0) {
        // F2: validar limite CC antes de fiar (D4 - SIEMPRE)
        await _validarLimiteCC(client, {
            id_empresa, id_cliente, monto_a_fiar: fiadoMonto
        });
        await pagosHelper.registrarFiado(client, {
            id_empresa, id_pedido, id_cliente, id_usuario, monto: fiadoMonto
        });
    }

    // ─── 9. Pagos reales (efvo/MP/transfer/cred/deb), con cuotas si aplica ───
    let pagosCreados = 0;
    for (const pago of pagos) {
        const metodo = pago.id_metodo_pago || 1;
        let montoPago = parseFloat(pago.monto) || 0;
        // SIGNO SOBERANO DEL PAGO (2026-07-06): negativo = devolucion de dinero
        // al cliente por el MISMO metodo. Se registra, jamas se descarta en silencio.
        if (metodo === 6) {
            if (montoPago < 0) {
                throw _bizError(
                    'Devolucion a cuenta corriente no va como pago negativo: ' +
                    'corresponde HABER en CC (usar circuito de CC/NC).',
                    'DEVOLUCION_CC_NO_SOPORTADA', 400
                );
            }
            continue;               // fiado ya registrado en paso 8
        }
        if (montoPago === 0) continue;

        let datosCuotas = {};
        if (pago.id_plan && pago._cuotas_aplicadas) {
            // F1.6: el recargo ya se aplico en paso 2.5 (pre-loop). Aca solo
            // armamos datosCuotas para el INSERT en pagos. NO re-aplicar.
            const calc = pago._cuotas_aplicadas.calc;
            montoPago = calc.monto_final;
            datosCuotas = {
                id_terminal: calc.id_terminal, cuotas: calc.cuotas,
                coeficiente: calc.coeficiente, monto_original: calc.monto_original,
                comision_estimada: calc.comision_estimada
            };
        }
        await pagosHelper.registrarPago(client, Object.assign({
            id_empresa, id_pedido, id_metodo_pago: metodo,
            monto: montoPago, id_usuario,
            id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
            id_turno, id_cliente,
            id_forma_pago: pago.id_forma_pago || null,
            // F4: el ajuste FP ya lo aplico borrador.controller antes
            // de llamar a este helper. NO re-aplicar (idempotente, pero costoso).
            omitir_ajuste_fp: true
        }, datosCuotas));
        pagosCreados++;
    }

    // ─── 10. Resultado final ───
    let liquidacion = 'pagada';
    if (fiadoMonto > 0 && pagosCreados > 0) liquidacion = 'mixta';
    else if (fiadoMonto > 0)                liquidacion = 'fiada';

    logger.info(
        `[cobranza.liquidar] Pedido #${id_pedido} -> ${liquidacion} ` +
        `(pagos:${pagosCreados}, fiado:$${fiadoMonto.toFixed(2)}, total:$${total_pedido.toFixed(2)}, cliente:${id_cliente})`
    );

    return {
        liquidacion, id_turno, pagos_creados: pagosCreados,
        fiado_creado: fiadoMonto > 0, total_pedido, total_liquidado: totalLiquidado
    };
}


/**
 * ═══════════════════════════════════════════════════════════════════════
 * registrarCobranza — Cobro de deuda CC desde libro mayor / tesorería.
 * Transacción caller-managed (mismo contrato que liquidarPedidoNuevo).
 *
 * Asiento completo (nada sin registrar):
 *   recibo + recibo_items → recibo_pedidos (imputación) → pagos
 *   (origen cobranza_cc, con id_pedido; a-cuenta sin pedido) →
 *   recibopagos (vínculo) → HABER único en CC → movimientos_caja (efectivo).
 *
 * Config: cc.cobro.exigir_turno / cc.cobro.permitir_parcial /
 *         cc.cobro.imputacion_sugerida. Efectivo SIEMPRE exige turno
 *         (detectado por tipo_cuenta='caja_fisica', nunca por id).
 *
 * Errores de negocio: CAJA_CERRADA, MONTO_INVALIDO, CLIENTE_NO_ENCONTRADO,
 *   CF_SIN_CC, FORMA_PAGO_INEXISTENTE, FORMA_SIN_METODO_EQUIVALENTE,
 *   COTIZACION_NO_DISPONIBLE, PEDIDO_NO_ENCONTRADO, IMPUTACION_EXCEDE_SALDO,
 *   IMPUTACION_PARCIAL_PROHIBIDA, SUMA_INCONSISTENTE.
 * ═══════════════════════════════════════════════════════════════════════
 */
async function _obtenerCotizacionCobranza(client, id_empresa, id_moneda) {
    const idMon = parseInt(id_moneda, 10) || 1;
    if (idMon === 1) return 1;
    const { rows } = await client.query(
        `SELECT cotizacion_compra FROM cotizaciones
         WHERE id_empresa = $1 AND id_moneda = $2
         ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC LIMIT 1`,
        [id_empresa, idMon]
    );
    const cot = rows.length ? parseFloat(rows[0].cotizacion_compra) : NaN;
    if (!cot || isNaN(cot) || cot <= 0) {
        throw _bizError(
            `Sin cotización vigente para moneda ${idMon}. Cargarla antes de cobrar (no se usa fallback silencioso).`,
            'COTIZACION_NO_DISPONIBLE', 400
        );
    }
    return cot;
}

async function _resolverFormasCobro(client, id_empresa, items) {
    const ids = [...new Set(items.map(i => parseInt(i.id_forma_pago, 10)))];
    const { rows } = await client.query(
        `SELECT fp.id_forma_pago, fp.nombre, fp.id_metodo_pago_caja, mp.tipo_cuenta
         FROM formas_pago fp
         LEFT JOIN metodosdepago mp ON mp.id_metodo_pago = fp.id_metodo_pago_caja
         WHERE fp.id_empresa = $1 AND fp.id_forma_pago = ANY($2)`,
        [id_empresa, ids]
    );
    const map = {};
    rows.forEach(r => { map[r.id_forma_pago] = r; });
    for (const id of ids) {
        if (!map[id]) throw _bizError(`Forma de pago ${id} inexistente en empresa`, 'FORMA_PAGO_INEXISTENTE', 400);
        if (!map[id].id_metodo_pago_caja) throw _bizError(
            `Forma "${map[id].nombre}" sin método de caja equivalente (formas_pago.id_metodo_pago_caja). Configurarlo antes de cobrar.`,
            'FORMA_SIN_METODO_EQUIVALENTE', 400
        );
    }
    return map;
}

async function registrarCobranza(client, params) {
    const {
        id_empresa, id_cliente, id_usuario,
        items_pago = [], imputaciones = null,
        modo = 'imputar', concepto = null, observaciones = null
    } = params;
    const recibosHelper = require('./recibos.helper');
    const ccClientesHelper = require('./cc-clientes.helper');

    // 1. Obligatorios y montos
    if (!id_empresa || !id_cliente || !id_usuario) {
        throw new Error('cobranza.registrarCobranza: id_empresa, id_cliente, id_usuario obligatorios');
    }
    if (!Array.isArray(items_pago) || items_pago.length === 0) {
        throw _bizError('Debe indicar al menos una forma de pago con monto', 'MONTO_INVALIDO', 400);
    }
    for (const it of items_pago) {
        const m = parseFloat(it.monto);
        if (isNaN(m) || m <= 0) throw _bizError(`Monto inválido (forma ${it.id_forma_pago}): ${it.monto}`, 'MONTO_INVALIDO', 400);
    }

    // 2. Cliente válido y con CC (CF genérico no tiene CC)
    const cliRes = await client.query(
        'SELECT id_cliente FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
        [id_cliente, id_empresa]);
    if (!cliRes.rows.length) throw _bizError('Cliente no encontrado', 'CLIENTE_NO_ENCONTRADO', 404);
    if (await ccClientesHelper.esConsumidorFinal(client, id_empresa, id_cliente)) {
        throw _bizError('Consumidor Final genérico no tiene cuenta corriente para cobrar', 'CF_SIN_CC', 400);
    }

    // 3. Config
    const exigirTurno = String(await cfg.get(client, id_empresa, 'cc.cobro.exigir_turno', 'true')) !== 'false';
    const permitirParcial = String(await cfg.get(client, id_empresa, 'cc.cobro.permitir_parcial', 'true')) !== 'false';
    const ordenSugerido = await cfg.get(client, id_empresa, 'cc.cobro.imputacion_sugerida', 'antiguedad');

    // 4. Formas + cotización estricta (multi-moneda)
    const formas = await _resolverFormasCobro(client, id_empresa, items_pago);
    let totalARS = 0;
    const itemsResueltos = [];
    for (const it of items_pago) {
        const idMon = parseInt(it.id_moneda, 10) || 1;
        const cot = await _obtenerCotizacionCobranza(client, id_empresa, idMon);
        const montoOrig = parseFloat(it.monto);
        const montoARS = Math.round(montoOrig * cot * 100) / 100;
        totalARS += montoARS;
        itemsResueltos.push({
            id_forma_pago: parseInt(it.id_forma_pago, 10), id_moneda: idMon,
            monto: montoOrig, cotizacion: cot, monto_ars: montoARS,
            id_tarjeta: it.id_tarjeta || null, cuotas: it.cuotas || 1,
            id_banco: it.id_banco || null, referencia: it.referencia || null,
            fecha_acreditacion: it.fecha_acreditacion || null,
            observaciones: it.observaciones || null,
            forma: formas[parseInt(it.id_forma_pago, 10)]
        });
    }
    totalARS = Math.round(totalARS * 100) / 100;
    const hayEfectivo = itemsResueltos.some(i => i.forma.tipo_cuenta === 'caja_fisica');

    // 5. Turno: efectivo SIEMPRE lo exige; el resto según config
    let id_turno = null;
    if (hayEfectivo || exigirTurno) {
        const id_deposito_usr = await stockHelper.obtenerDepositoUsuario(client, { id_empresa, id_usuario });
        const turno = await cajaHelper.requerirTurnoAbierto(client, id_empresa, { id_deposito: id_deposito_usr });
        id_turno = turno.id_turno;
    }

    // 6. Recibo + items (dominio formas_pago, multi-moneda auditada)
    const numero_recibo = await recibosHelper.proximoNumeroRecibo(client, id_empresa);
    const recibo = await recibosHelper.crearRecibo(client, {
        id_empresa, id_cliente, id_usuario, id_turno,
        numero_recibo, total_recibo: totalARS, id_moneda_recibo: 1,
        concepto: 'Procesando...', observaciones
    });
    for (const it of itemsResueltos) {
        await recibosHelper.insertarReciboItem(client, {
            id_empresa, id_recibo: recibo.id_recibo,
            id_forma_pago: it.id_forma_pago, id_moneda: it.id_moneda,
            monto_original: it.monto, cotizacion_usada: it.cotizacion,
            monto_convertido: it.monto_ars,
            id_tarjeta: it.id_tarjeta, cuotas: it.cuotas,
            interes_aplicado: 0, monto_interes: 0, monto_con_interes: it.monto,
            id_banco: it.id_banco, numero_referencia: it.referencia,
            fecha_acreditacion: it.fecha_acreditacion, observaciones: it.observaciones
        });
    }

    // 7. Método de atribución en pagos: el de mayor monto ARS
    const metodoPrincipal = itemsResueltos
        .reduce((a, b) => (b.monto_ars > a.monto_ars ? b : a)).forma.id_metodo_pago_caja;

    // 8. Imputaciones: manual > auto (FIFO/monto según config) > a cuenta
    let lista = [];
    if (modo !== 'a_cuenta') {
        if (Array.isArray(imputaciones) && imputaciones.length > 0) {
            lista = imputaciones.map(i => ({
                id_pedido: parseInt(i.id_pedido, 10),
                monto: Math.round(parseFloat(i.monto) * 100) / 100
            }));
        } else {
            const ordenSQL = ordenSugerido === 'monto_desc' ? 'saldo DESC' : 'p.fecha_creacion ASC';
            const pend = await client.query(`
                SELECT p.id_pedido, COALESCE(sp.saldo, 0) AS saldo
                FROM pedidos p
                JOIN pedidoestados pe ON pe.id_estado = p.id_estado
                LEFT JOIN v_saldo_pedidos sp ON sp.id_pedido = p.id_pedido
                WHERE p.id_empresa = $1 AND p.id_cliente = $2
                  AND p.es_fiado = true AND pe.computa_deuda = true
                  AND COALESCE(sp.saldo, 0) > 0.01
                ORDER BY ${ordenSQL}`, [id_empresa, id_cliente]);
            let rest = totalARS;
            for (const r of pend.rows) {
                if (rest <= 0.01) break;
                const ap = Math.round(Math.min(rest, parseFloat(r.saldo)) * 100) / 100;
                lista.push({ id_pedido: r.id_pedido, monto: ap });
                rest = Math.round((rest - ap) * 100) / 100;
            }
        }
    }

    // Validación de cada imputación contra saldo real (BD manda)
    let totalImputado = 0;
    for (const im of lista) {
        if (!im.id_pedido || isNaN(im.monto) || im.monto <= 0) {
            throw _bizError('Imputación inválida (pedido/monto)', 'MONTO_INVALIDO', 400);
        }
        const sRes = await client.query(`
            SELECT COALESCE(sp.saldo, 0) AS saldo, pe.computa_deuda, pe.nombre AS estado
            FROM pedidos p
            JOIN pedidoestados pe ON pe.id_estado = p.id_estado
            LEFT JOIN v_saldo_pedidos sp ON sp.id_pedido = p.id_pedido
            WHERE p.id_pedido = $1 AND p.id_empresa = $2`, [im.id_pedido, id_empresa]);
        if (!sRes.rows.length) throw _bizError(`Pedido #${im.id_pedido} no existe en empresa`, 'PEDIDO_NO_ENCONTRADO', 404);
        if (!sRes.rows[0].computa_deuda) {
            throw _bizError(
                `Pedido #${im.id_pedido} en estado "${sRes.rows[0].estado}" no admite cobros (no computa deuda)`,
                'PEDIDO_NO_COBRABLE', 400);
        }
        const saldo = parseFloat(sRes.rows[0].saldo);
        if (im.monto > saldo + 0.01) {
            throw _bizError(
                `Imputación $${im.monto.toFixed(2)} excede saldo $${saldo.toFixed(2)} del pedido #${im.id_pedido}`,
                'IMPUTACION_EXCEDE_SALDO', 400);
        }
        if (!permitirParcial && im.monto < saldo - 0.01) {
            throw _bizError(
                `Imputación parcial deshabilitada (cc.cobro.permitir_parcial=false). Pedido #${im.id_pedido} saldo $${saldo.toFixed(2)}`,
                'IMPUTACION_PARCIAL_PROHIBIDA', 400);
        }
        totalImputado += im.monto;
    }
    totalImputado = Math.round(totalImputado * 100) / 100;
    if (totalImputado > totalARS + 0.01) {
        throw _bizError(`Imputado $${totalImputado.toFixed(2)} supera lo cobrado $${totalARS.toFixed(2)}`, 'SUMA_INCONSISTENTE', 400);
    }
    const aCuenta = Math.round((totalARS - totalImputado) * 100) / 100;

    // 9. Asientos: recibo_pedidos + pagos (origen cobranza_cc) + recibopagos
    const pagosCreados = [];
    for (const im of lista) {
        await client.query(
            `INSERT INTO recibo_pedidos (id_empresa, id_recibo, id_pedido, monto_imputado)
             VALUES ($1, $2, $3, $4)`,
            [id_empresa, recibo.id_recibo, im.id_pedido, im.monto]);
        const pago = await pagosHelper.registrarPago(client, {
            id_empresa, id_pedido: im.id_pedido, id_metodo_pago: metodoPrincipal,
            monto: im.monto, id_usuario, id_cliente,
            id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
            id_turno, origen: 'cobranza_cc',
            observaciones: `Recibo ${recibo.numero_completo}`,
            registrar_en_caja: false, registrar_en_cc: false, omitir_ajuste_fp: true
        });
        await client.query(
            `INSERT INTO recibopagos (id_recibo, id_pago, id_empresa) VALUES ($1, $2, $3)`,
            [recibo.id_recibo, pago.id_pago, id_empresa]);
        pagosCreados.push(pago.id_pago);
    }
    if (aCuenta > 0.01) {
        const pagoAC = await pagosHelper.registrarPago(client, {
            id_empresa, id_pedido: null, id_metodo_pago: metodoPrincipal,
            monto: aCuenta, id_usuario, id_cliente,
            id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
            id_turno, origen: 'cobranza_cc',
            observaciones: `Recibo ${recibo.numero_completo} — a cuenta`,
            registrar_en_caja: false, registrar_en_cc: false, omitir_ajuste_fp: true
        });
        await client.query(
            `INSERT INTO recibopagos (id_recibo, id_pago, id_empresa) VALUES ($1, $2, $3)`,
            [recibo.id_recibo, pagoAC.id_pago, id_empresa]);
        pagosCreados.push(pagoAC.id_pago);
    }

    // 10. HABER único en CC (single write point vía helper)
    const detalle = lista.length
        ? 'Imputado a pedido(s) ' + lista.map(i => '#' + i.id_pedido).slice(0, 3).join(', ')
          + (lista.length > 3 ? '…' : '')
          + (aCuenta > 0.01 ? ` + $${aCuenta.toFixed(2)} a cuenta` : '')
        : (concepto || 'Cobro a cuenta');
    await ccClientesHelper.registrarMovimiento(client, {
        id_empresa, id_recibo: recibo.id_recibo, id_cliente, monto: totalARS, tipo: 'haber',
        concepto: `Recibo ${recibo.numero_completo} - ${detalle}`
    });

    // 11. Caja: solo formas caja_fisica, moneda original con cotización auditada
    for (const it of itemsResueltos) {
        if (it.forma.tipo_cuenta !== 'caja_fisica' || !id_turno) continue;
        await cajaHelper.registrarMovimiento(client, {
            id_empresa, id_turno, id_usuario, tipo: 'ingreso',
            id_moneda: it.id_moneda, monto: it.monto,
            concepto: `Cobranza Recibo ${recibo.numero_completo}`,
            id_metodo_pago: it.forma.id_metodo_pago_caja,
            id_recibo: recibo.id_recibo, cotizacion_usada: it.cotizacion
        });
    }

    // 12. Concepto final del recibo
    await recibosHelper.actualizarRecibo(client, {
        id_empresa, id_recibo: recibo.id_recibo, concepto: detalle, total_recibo: totalARS
    });

    logger.info(
        `[cobranza.registrarCobranza] Recibo ${recibo.numero_completo} cliente ${id_cliente} ` +
        `total $${totalARS.toFixed(2)} imputado $${totalImputado.toFixed(2)} a_cuenta $${aCuenta.toFixed(2)}`
    );
    return {
        id_recibo: recibo.id_recibo, numero_completo: recibo.numero_completo,
        total_ars: totalARS, imputaciones: lista, a_cuenta: aCuenta,
        pagos_creados: pagosCreados, id_turno
    };
}


/**
 * registrarDevolucion — Devolución de dinero al cliente (F-DEV 2026-07-04).
 * NO es recibo negativo: documento tipo='devolucion', montos SIEMPRE positivos,
 * asiento invertido explícito: DEBE en CC (consume saldo a favor) + EGRESO caja.
 * No escribe en pagos (libro maestro de ENTRADAS). NC por mercadería es otro camino.
 * Errores: MOTIVO_REQUERIDO, DEVOLUCION_EXCEDE_SALDO, CAJA_CERRADA, MONTO_INVALIDO,
 *          CLIENTE_NO_ENCONTRADO, CF_SIN_CC, FORMA_SIN_METODO_EQUIVALENTE.
 */
async function registrarDevolucion(client, params) {
    const { id_empresa, id_cliente, id_usuario, items_pago = [], motivo = null } = params;
    const recibosHelper = require('./recibos.helper');
    const ccClientesHelper = require('./cc-clientes.helper');

    if (!id_empresa || !id_cliente || !id_usuario) {
        throw new Error('cobranza.registrarDevolucion: id_empresa, id_cliente, id_usuario obligatorios');
    }
    if (!Array.isArray(items_pago) || !items_pago.length) {
        throw _bizError('Indicar al menos una forma con monto a devolver', 'MONTO_INVALIDO', 400);
    }
    for (const it of items_pago) {
        const m = parseFloat(it.monto);
        if (isNaN(m) || m <= 0) throw _bizError('Monto inválido: montos siempre positivos, la dirección la da el tipo de documento', 'MONTO_INVALIDO', 400);
    }
    const exigeMotivo = String(await cfg.get(client, id_empresa, 'cc.devolucion.exigir_motivo', 'true')) !== 'false';
    if (exigeMotivo && (!motivo || motivo.trim().length < 5)) {
        throw _bizError('La devolución requiere motivo (mín. 5 caracteres)', 'MOTIVO_REQUERIDO', 400);
    }
    const cliRes = await client.query('SELECT id_cliente FROM clientes WHERE id_cliente=$1 AND id_empresa=$2', [id_cliente, id_empresa]);
    if (!cliRes.rows.length) throw _bizError('Cliente no encontrado', 'CLIENTE_NO_ENCONTRADO', 404);
    if (await ccClientesHelper.esConsumidorFinal(client, id_empresa, id_cliente)) {
        throw _bizError('Consumidor Final genérico no tiene CC para devolver', 'CF_SIN_CC', 400);
    }

    const formas = await _resolverFormasCobro(client, id_empresa, items_pago);
    let totalARS = 0;
    const items = items_pago.map(it => {
        const idMon = parseInt(it.id_moneda, 10) || 1;
        return { it, idMon };
    });
    const resueltos = [];
    for (const { it, idMon } of items) {
        const cot = await _obtenerCotizacionCobranza(client, id_empresa, idMon);
        const monto = parseFloat(it.monto);
        const ars = Math.round(monto * cot * 100) / 100;
        totalARS += ars;
        resueltos.push({ id_forma_pago: parseInt(it.id_forma_pago, 10), id_moneda: idMon,
            monto, cotizacion: cot, monto_ars: ars, referencia: it.referencia || null,
            forma: formas[parseInt(it.id_forma_pago, 10)] });
    }
    totalARS = Math.round(totalARS * 100) / 100;

    // Guardia anti-error: solo hasta el saldo a favor (configurable)
    const soloSaldoFavor = String(await cfg.get(client, id_empresa, 'cc.devolucion.solo_saldo_favor', 'true')) !== 'false';
    if (soloSaldoFavor) {
        const s = await ccClientesHelper.obtenerSaldo(client, id_empresa, id_cliente);
        const saldoActual = parseFloat((s && s.saldo) || 0);
        const aFavor = saldoActual < 0 ? -saldoActual : 0;
        if (totalARS > aFavor + 0.01) {
            throw _bizError(
                `Devolución $${totalARS.toFixed(2)} excede el saldo a favor $${aFavor.toFixed(2)} (cc.devolucion.solo_saldo_favor=true)`,
                'DEVOLUCION_EXCEDE_SALDO', 400);
        }
    }

    // Turno: sacar plata SIEMPRE exige turno si hay efectivo; resto según config de cobro
    const hayEfectivo = resueltos.some(r => r.forma.tipo_cuenta === 'caja_fisica');
    const exigirTurno = String(await cfg.get(client, id_empresa, 'cc.cobro.exigir_turno', 'true')) !== 'false';
    let id_turno = null;
    if (hayEfectivo || exigirTurno) {
        const dep = await stockHelper.obtenerDepositoUsuario(client, { id_empresa, id_usuario });
        const turno = await cajaHelper.requerirTurnoAbierto(client, id_empresa, { id_deposito: dep });
        id_turno = turno.id_turno;
    }

    const numero_recibo = await recibosHelper.proximoNumeroRecibo(client, id_empresa);
    const concepto = 'DEVOLUCIÓN — ' + (motivo ? motivo.trim() : 'devolución de saldo a favor');
    const recibo = await recibosHelper.crearRecibo(client, {
        id_empresa, id_cliente, id_usuario, id_turno, numero_recibo,
        total_recibo: totalARS, id_moneda_recibo: 1, concepto, observaciones: null,
        tipo: 'devolucion'
    });
    for (const r of resueltos) {
        await recibosHelper.insertarReciboItem(client, {
            id_empresa, id_recibo: recibo.id_recibo, id_forma_pago: r.id_forma_pago,
            id_moneda: r.id_moneda, monto_original: r.monto, cotizacion_usada: r.cotizacion,
            monto_convertido: r.monto_ars, cuotas: 1, interes_aplicado: 0, monto_interes: 0,
            monto_con_interes: r.monto, numero_referencia: r.referencia
        });
    }
    // DEBE en CC (consume el saldo a favor) linkeado al recibo
    await ccClientesHelper.registrarMovimiento(client, {
        id_empresa, id_cliente, id_recibo: recibo.id_recibo,
        monto: totalARS, tipo: 'debe',
        concepto: `Recibo ${recibo.numero_completo} - ${concepto}`
    });
    // Egreso de caja por lo físico
    for (const r of resueltos) {
        if (r.forma.tipo_cuenta !== 'caja_fisica' || !id_turno) continue;
        await cajaHelper.registrarMovimiento(client, {
            id_empresa, id_turno, id_usuario, tipo: 'egreso',
            id_moneda: r.id_moneda, monto: r.monto,
            concepto: `Devolución Recibo ${recibo.numero_completo}`,
            id_metodo_pago: r.forma.id_metodo_pago_caja,
            id_recibo: recibo.id_recibo, cotizacion_usada: r.cotizacion
        });
    }
    logger.info(`[cobranza.registrarDevolucion] Recibo ${recibo.numero_completo} cliente ${id_cliente} DEVOLUCION $${totalARS.toFixed(2)} motivo="${motivo || ''}"`);
    return { id_recibo: recibo.id_recibo, numero_completo: recibo.numero_completo,
             total_ars: totalARS, tipo: 'devolucion', id_turno };
}

module.exports = {
    liquidarPedidoNuevo,
    registrarCobranza,
    registrarDevolucion
};
