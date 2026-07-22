/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAGOS PROVEEDORES HELPER — ERP LAGO — FASE 7
 * Centralización de escrituras a:
 *   pagosaproveedores, pago_proveedor_items, cheques_propios, cheques_terceros,
 *   imputacion_pagos_proveedor, cuentas_por_pagar (pagos), comprobantes_compra (estado)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONSUMIDORES: pagos-proveedores.controller.js
 * DEPENDENCIA: compras.helper.js (revertirSaldoCuenta, actualizarEstadoComprobante)
 */

const comprasHelper = require('./compras.helper');
const ccProveedores = require('./cc-proveedores.helper');
const tesoreriaHelper = require('./tesoreria.helper');

// Aliases locales para funciones re-exportadas de compras.helper
var crearMovimientoCuenta = comprasHelper.crearMovimientoCuenta;
var revertirSaldoCuenta = comprasHelper.revertirSaldoCuenta;
var actualizarEstadoComprobante = comprasHelper.actualizarEstadoComprobante;

// ═══════════════════════════════════════════════════════════════
// PAGOS — Cabecera
// ═══════════════════════════════════════════════════════════════

async function crearPago(client, datos) {
    const {
        id_empresa, id_proveedor, id_usuario, id_metodo_pago,
        monto, referencia_pago, observaciones, numero_pago, es_pago_a_cuenta
    } = datos;

    const result = await client.query(`
        INSERT INTO pagosaproveedores (
            id_empresa, id_proveedor, id_usuario, id_metodo_pago,
            fecha_pago, monto, referencia_pago, observaciones,
            numero_pago, es_pago_a_cuenta, total_pagado, estado
        ) VALUES ($1,$2,$3,$4, NOW(), $5,$6,$7,$8,$9,$5,'aplicado')
        RETURNING id_pago_proveedor
    `, [id_empresa, id_proveedor, id_usuario, id_metodo_pago,
        monto, referencia_pago, observaciones || null, numero_pago, es_pago_a_cuenta || false]);
    return result.rows[0];
}

async function anularPago(client, datos) {
    const { id_pago, motivo } = datos;
    await client.query(`
        UPDATE pagosaproveedores
        SET estado = 'anulado',
            observaciones = COALESCE(observaciones, '') || E'\n[ANULADO: ' || $1 || ']'
        WHERE id_pago_proveedor = $2
    `, [motivo || 'Sin motivo', id_pago]);
}

// ═══════════════════════════════════════════════════════════════
// PAGOS — Items (formas de pago)
// ═══════════════════════════════════════════════════════════════

async function insertarPagoItem(client, datos) {
    const {
        id_empresa, id_pago, id_forma_pago, id_moneda, monto,
        id_banco, numero_referencia, fecha_acreditacion,
        id_cheque_propio, id_cheque_tercero, observaciones
    } = datos;

    if (!id_empresa) throw new Error('pagos-proveedores.helper.insertarPagoItem: id_empresa obligatorio');

    await client.query(`
        INSERT INTO pago_proveedor_items (
            id_empresa, id_pago, id_forma_pago, id_moneda, monto,
            id_banco, numero_referencia, fecha_acreditacion,
            id_cheque_propio, id_cheque_tercero, observaciones
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [id_empresa, id_pago, id_forma_pago, id_moneda || 1, monto,
        id_banco || null, numero_referencia || null, fecha_acreditacion || null,
        id_cheque_propio || null, id_cheque_tercero || null, observaciones || null]);
}

// ═══════════════════════════════════════════════════════════════
// CHEQUES PROPIOS
// ═══════════════════════════════════════════════════════════════

async function crearChequePropio(client, datos) {
    const {
        id_empresa, id_banco, numero_cheque, fecha_vencimiento,
        monto, beneficiario, id_proveedor, id_pago
    } = datos;

    const result = await client.query(`
        INSERT INTO cheques_propios (
            id_empresa, id_banco, numero_cheque, fecha_emision,
            fecha_vencimiento, monto, beneficiario, id_proveedor, id_pago, estado
        ) VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,'entregado')
        RETURNING id_cheque
    `, [id_empresa, id_banco, numero_cheque, fecha_vencimiento, monto, beneficiario, id_proveedor, id_pago]);
    return result.rows[0];
}

async function anularChequesPropios(client, datos) {
    const { id_empresa, id_pago } = datos;
    if (!id_empresa) throw new Error('pagos-proveedores.helper.anularChequesPropios: id_empresa obligatorio');
    await client.query(`UPDATE cheques_propios SET estado = 'anulado' WHERE id_pago = $1 AND id_empresa = $2`, [id_pago, id_empresa]);
}

// ═══════════════════════════════════════════════════════════════
// CHEQUES TERCEROS
// ═══════════════════════════════════════════════════════════════

async function endosarChequeTercero(client, datos) {
    const { id_cheque, id_proveedor, id_pago } = datos;
    await client.query(`
        UPDATE cheques_terceros
        SET estado = 'endosado', id_proveedor = $1, id_pago = $2, fecha_endoso = CURRENT_DATE
        WHERE id_cheque = $3
    `, [id_proveedor, id_pago, id_cheque]);
}

async function devolverChequesTerceros(client, datos) {
    const { id_pago } = datos;
    await client.query(`
        UPDATE cheques_terceros
        SET estado = 'en_cartera', id_proveedor = NULL, id_pago = NULL, fecha_endoso = NULL
        WHERE id_pago = $1
    `, [id_pago]);
}

// ═══════════════════════════════════════════════════════════════
// IMPUTACIONES
// ═══════════════════════════════════════════════════════════════

async function crearImputacion(client, datos) {
    const { id_empresa, id_pago, id_cuenta, monto_imputado } = datos;
    if (!id_empresa) throw new Error('pagos-proveedores.helper.crearImputacion: id_empresa obligatorio');
    await client.query(
        `INSERT INTO imputacion_pagos_proveedor (id_empresa, id_pago, id_cuenta, monto_imputado) VALUES ($1,$2,$3,$4)`,
        [id_empresa, id_pago, id_cuenta, monto_imputado]
    );
}

async function eliminarImputaciones(client, datos) {
    const { id_pago } = datos;
    await client.query(`DELETE FROM imputacion_pagos_proveedor WHERE id_pago = $1`, [id_pago]);
}

// ═══════════════════════════════════════════════════════════════
// Re-exportamos funciones de compras.helper que se usan acá
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// CC PROVEEDORES — Registro automático de pago
// ═══════════════════════════════════════════════════════════════

/**
 * Registra pago en CC proveedor (HABER).
 * Incluye info de cheques para trazabilidad y recordatorio.
 * @param {object} client
 * @param {object} datos
 * @param {number} datos.id_empresa
 * @param {number} datos.id_proveedor
 * @param {number} datos.id_pago_proveedor
 * @param {number} datos.numero_pago
 * @param {number} datos.monto
 * @param {string} datos.metodo_pago_nombre
 * @param {object[]} [datos.cheques] - Info de cheques usados en el pago
 */
async function registrarPagoEnCC(client, datos) {
    return ccProveedores.registrarPago(client, datos);
}

/**
 * Contra-asiento al anular un pago (DEBE).
 */
async function anularPagoEnCC(client, datos) {
    return ccProveedores.anularPago(client, datos);
}


// ═══════════════════════════════════════════════════════════════
// ★ ORQUESTADOR: REGISTRAR PAGO COMPLETO
// ═══════════════════════════════════════════════════════════════

/**
 * Registra un pago completo a proveedor con todos sus efectos colaterales.
 * Controller solo debe hacer BEGIN → llamar esto → COMMIT/ROLLBACK.
 *
 * Puede llamarse desde:
 *   a) compras.html al confirmar comprobante (con id_comprobante)
 *   b) pagos-proveedores.html para pagar facturas pendientes
 *
 * @param {pg.Client} client - dentro de transacción
 * @param {Object} datos
 * @param {number} datos.id_empresa
 * @param {number} datos.id_proveedor
 * @param {number} datos.id_usuario
 * @param {Array}  datos.formas_pago - [{id_forma_pago, monto, tipo, id_moneda?, id_banco?, referencia?, cheque_data?, id_cheque_tercero?}]
 * @param {Array}  [datos.facturas_a_pagar] - [{id_cuenta, monto_a_pagar}]
 * @param {number} [datos.id_comprobante] - vínculo directo (desde compras.html)
 * @param {boolean} [datos.es_pago_a_cuenta]
 * @param {string}  [datos.observaciones]
 * @returns {Object} { id_pago, numero_pago, referencia_pago, total }
 */
async function registrarPagoProveedorCompleto(client, datos) {
    const {
        id_empresa, id_proveedor, id_usuario,
        formas_pago, facturas_a_pagar,
        es_pago_a_cuenta, observaciones,
        id_comprobante
    } = datos;

    // ── 1. Validaciones ──
    if (!id_empresa) throw _error('id_empresa obligatorio', 400);
    if (!id_proveedor) throw _error('id_proveedor obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario obligatorio', 400);
    var creditos_a_aplicar = datos.creditos_a_aplicar || [];
    if ((!formas_pago || formas_pago.length === 0) && creditos_a_aplicar.length === 0) {
        throw _error('Debe especificar al menos una forma de pago o créditos a aplicar', 400);
    }

    const totalFormasPago = (formas_pago || []).reduce((sum, fp) => sum + parseFloat(fp.monto || 0), 0);
    var totalCreditosAplicar = creditos_a_aplicar.reduce(function(s, c) { return s + parseFloat(c.monto || 0); }, 0);
    if (totalFormasPago <= 0 && totalCreditosAplicar <= 0) {
        throw _error('El monto total (formas + créditos) debe ser mayor a 0', 400);
    }

    if (!es_pago_a_cuenta && facturas_a_pagar && facturas_a_pagar.length > 0) {
        const totalFacturas = facturas_a_pagar.reduce((sum, f) => sum + parseFloat(f.monto_a_pagar || 0), 0);
        var totalCubrir = totalFormasPago + totalCreditosAplicar;
        if (Math.abs(totalCubrir - totalFacturas) > 0.01) {
            throw _error(
                'Total a cubrir ($' + totalCubrir.toFixed(2) + ' = formas $' + totalFormasPago.toFixed(2) +
                ' + créditos $' + totalCreditosAplicar.toFixed(2) +
                ') no coincide con total a imputar ($' + totalFacturas.toFixed(2) + ')', 400
            );
        }
    }

    // ── 1.5. Modo PURO: solo créditos, sin pago nuevo ──
    if ((!formas_pago || formas_pago.length === 0) && creditos_a_aplicar.length > 0) {
        var aplicacionesPuras = [];
        // Distribuir créditos sobre facturas FIFO
        var saldosFacturaPuro = (facturas_a_pagar || []).map(function(f) {
            return { id_cuenta: f.id_cuenta, restante: parseFloat(f.monto_a_pagar) };
        });
        for (var iCp = 0; iCp < creditos_a_aplicar.length; iCp++) {
            var credP = creditos_a_aplicar[iCp];
            var montoCredP = parseFloat(credP.monto);
            if (!montoCredP || montoCredP <= 0) continue;
            // Resolver id_pago_origen
            var rOrigP = await client.query(
                'SELECT id_pago_origen FROM v_creditos_proveedor_disponibles WHERE id_cuenta_credito=$1 AND id_empresa=$2',
                [credP.id_cuenta_credito, id_empresa]
            );
            var idPagoOrigP = rOrigP.rows[0] ? rOrigP.rows[0].id_pago_origen : null;

            if (credP.id_cuenta_deuda) {
                // Aplicación explícita 1:1
                var rPuro = await aplicarCreditoSobreCuenta(client, {
                    id_empresa: id_empresa,
                    id_cuenta_credito: credP.id_cuenta_credito,
                    id_cuenta_deuda: credP.id_cuenta_deuda,
                    monto: montoCredP,
                    id_pago_origen: idPagoOrigP,
                    id_usuario: id_usuario,
                    ip_origen: datos.ip_origen,
                    motivo: datos.motivo_credito || 'Aplicación de saldo a favor'
                });
                aplicacionesPuras.push(rPuro);
            } else {
                // FIFO sobre facturas
                for (var iFp = 0; iFp < saldosFacturaPuro.length && montoCredP > 0.001; iFp++) {
                    var sfP = saldosFacturaPuro[iFp];
                    if (sfP.restante <= 0.001) continue;
                    var aplicarP = Math.min(montoCredP, sfP.restante);
                    var rPuro2 = await aplicarCreditoSobreCuenta(client, {
                        id_empresa: id_empresa,
                        id_cuenta_credito: credP.id_cuenta_credito,
                        id_cuenta_deuda: sfP.id_cuenta,
                        monto: aplicarP,
                        id_pago_origen: idPagoOrigP,
                        id_usuario: id_usuario,
                        ip_origen: datos.ip_origen,
                        motivo: datos.motivo_credito || 'Aplicación de saldo a favor'
                    });
                    aplicacionesPuras.push(rPuro2);
                    sfP.restante -= aplicarP;
                    montoCredP -= aplicarP;
                }
            }
        }
        return {
            id_pago: null,
            numero_pago: null,
            referencia_pago: null,
            total: 0,
            aplicaciones_credito: aplicacionesPuras,
            modo: 'aplicacion_pura'
        };
    }

    // ── 2. Número de pago (secuencia) ──
    const { rows: seqRows } = await client.query("SELECT nextval('seq_numero_pago_proveedor') as numero");
    const numeroPago = seqRows[0].numero;
    const referenciaPago = 'PAGO-' + String(numeroPago).padStart(8, '0');

    // ── 3. Cabecera del pago ──
    const pago = await crearPago(client, {
        id_empresa, id_proveedor, id_usuario,
        id_metodo_pago: formas_pago[0].id_forma_pago,
        monto: totalFormasPago,
        referencia_pago: referenciaPago,
        observaciones: observaciones,
        numero_pago: numeroPago,
        es_pago_a_cuenta: es_pago_a_cuenta || false
    });
    const id_pago = pago.id_pago_proveedor;

    // ── 4. Vincular a comprobante (si viene de compras.html) ──
    if (id_comprobante) {
        await client.query(
            'UPDATE pagosaproveedores SET id_comprobante = $1 WHERE id_pago_proveedor = $2',
            [id_comprobante, id_pago]
        );
    }

    // ── 5. Formas de pago + cheques ──
    var chequesInfo = [];
    for (var i = 0; i < formas_pago.length; i++) {
        var fp = formas_pago[i];
        var idChequePropio = null, idChequeTercero = null;

        // Cheque propio
        if (fp.tipo === 'cheque_propio' && fp.cheque_data) {
            var cheque = await crearChequePropio(client, {
                id_empresa,
                id_banco: fp.cheque_data.id_banco,
                numero_cheque: fp.cheque_data.numero_cheque,
                fecha_vencimiento: fp.cheque_data.fecha_vencimiento,
                monto: fp.monto,
                beneficiario: fp.cheque_data.beneficiario,
                id_proveedor: id_proveedor,
                id_pago: id_pago
            });
            idChequePropio = cheque.id_cheque;
            chequesInfo.push({
                tipo: 'propio', numero: fp.cheque_data.numero_cheque,
                banco: fp.cheque_data.banco_nombre || '',
                fecha_vencimiento: fp.cheque_data.fecha_vencimiento,
                monto: fp.monto
            });
        }

        // Cheque tercero (endoso)
        if (fp.tipo === 'cheque_tercero' && fp.id_cheque_tercero) {
            await endosarChequeTercero(client, {
                id_cheque: fp.id_cheque_tercero,
                id_proveedor: id_proveedor,
                id_pago: id_pago
            });
            idChequeTercero = fp.id_cheque_tercero;
            var chRes = await client.query(
                'SELECT numero_cheque, COALESCE(b.nombre, ct.banco_nombre) as banco, fecha_vencimiento ' +
                'FROM cheques_terceros ct LEFT JOIN bancos b ON b.id_banco = ct.id_banco WHERE ct.id_cheque = $1 AND ct.id_empresa = $2',
                [fp.id_cheque_tercero, id_empresa]
            );
            if (chRes.rows[0]) {
                chequesInfo.push({
                    tipo: 'tercero', numero: chRes.rows[0].numero_cheque,
                    banco: chRes.rows[0].banco || '',
                    fecha_vencimiento: chRes.rows[0].fecha_vencimiento,
                    monto: fp.monto
                });
            }
        }

        // Item de pago
        await insertarPagoItem(client, {
            id_empresa: id_empresa,
            id_pago: id_pago,
            id_forma_pago: fp.id_forma_pago,
            id_moneda: fp.id_moneda,
            monto: fp.monto,
            id_banco: fp.id_banco,
            numero_referencia: fp.referencia,
            fecha_acreditacion: fp.fecha_acreditacion,
            id_cheque_propio: idChequePropio,
            id_cheque_tercero: idChequeTercero,
            observaciones: fp.observaciones
        });

        // ── 5.5. Asentar movimiento de tesoreria (si el metodo mueve caja) ──
        // Una linea por item: cada forma de pago genera su propio asiento
        // independiente, lo que permite arqueo correcto por metodo.
        // Si metodosdepago.mueve_caja=false (ej: cuenta corriente) → skip.
        var rProvNombre = await client.query(
            'SELECT razon_social FROM proveedores WHERE id_proveedor = $1 AND id_empresa = $2',
            [id_proveedor, id_empresa]
        );
        var razonSocialProv = (rProvNombre.rows[0] && rProvNombre.rows[0].razon_social) || ('Proveedor #' + id_proveedor);

        await tesoreriaHelper.registrarEgresoProveedor(client, {
            id_empresa: id_empresa,
            id_usuario: id_usuario,
            id_forma_pago: fp.id_forma_pago,
            monto: fp.monto,
            razon_social: razonSocialProv,
            numero_pago: numeroPago,
            id_pago_proveedor: id_pago
        });
    }

    // ── 6. Imputar a facturas ──
    if (!es_pago_a_cuenta && facturas_a_pagar && facturas_a_pagar.length > 0) {
        for (var j = 0; j < facturas_a_pagar.length; j++) {
            var factura = facturas_a_pagar[j];
            await crearImputacion(client, {
                id_empresa: id_empresa,
                id_pago: id_pago,
                id_cuenta: factura.id_cuenta,
                monto_imputado: factura.monto_a_pagar
            });

            // Verificar saldo y actualizar estado comprobante
            var cuentaRes = await client.query(
                'SELECT cpp.saldo, cpp.id_comprobante FROM cuentas_por_pagar cpp ' +
                'WHERE cpp.id_cuenta = $1 AND cpp.id_empresa = $2',
                [factura.id_cuenta, id_empresa]
            );
            if (cuentaRes.rows[0] && cuentaRes.rows[0].id_comprobante) {
                var nuevoEstado = cuentaRes.rows[0].saldo <= 0 ? 'pagado' : 'pagado_parcial';
                await comprasHelper.actualizarEstadoComprobante(client, {
                    id_comprobante: cuentaRes.rows[0].id_comprobante,
                    estado: nuevoEstado
                });
            }
        }
    }

    // ── 6.5. Aplicar créditos de saldo a favor (mixto con formas_pago) ──
    var aplicacionesCredito = [];
    if (creditos_a_aplicar.length > 0 && facturas_a_pagar && facturas_a_pagar.length > 0) {
        // Las facturas ya fueron imputadas con el monto_a_pagar (que incluye lo que cubren los créditos).
        // El trigger las decrementó. Ahora hay que ADICIONALMENTE aplicar los créditos sobre esas mismas facturas,
        // lo cual decrementaría DE MÁS. Modelo correcto: el frontend manda monto_a_pagar = porción cubierta por formas_pago,
        // y aparte creditos_a_aplicar para la porción cubierta por créditos.
        //
        // Por lo tanto, las facturas en facturas_a_pagar ya fueron tratadas por su porción formas_pago.
        // Acá distribuimos los créditos sobre las facturas (FIFO) por la porción restante.
        var saldosFactura = facturas_a_pagar.map(function(f) {
            // Saldo actual de la cuenta después de la imputación anterior
            return { id_cuenta: f.id_cuenta, restante: null };
        });
        // Hidratar saldos restantes
        for (var iH = 0; iH < saldosFactura.length; iH++) {
            var rH = await client.query('SELECT saldo FROM cuentas_por_pagar WHERE id_cuenta=$1', [saldosFactura[iH].id_cuenta]);
            saldosFactura[iH].restante = parseFloat((rH.rows[0] && rH.rows[0].saldo) || 0);
        }
        for (var iC = 0; iC < creditos_a_aplicar.length; iC++) {
            var cred = creditos_a_aplicar[iC];
            var montoCred = parseFloat(cred.monto);
            if (!montoCred || montoCred <= 0) continue;
            var rOrig = await client.query(
                'SELECT id_pago_origen FROM v_creditos_proveedor_disponibles WHERE id_cuenta_credito=$1 AND id_empresa=$2',
                [cred.id_cuenta_credito, id_empresa]
            );
            var idPagoOrig = rOrig.rows[0] ? rOrig.rows[0].id_pago_origen : null;

            if (cred.id_cuenta_deuda) {
                var r65 = await aplicarCreditoSobreCuenta(client, {
                    id_empresa: id_empresa,
                    id_cuenta_credito: cred.id_cuenta_credito,
                    id_cuenta_deuda: cred.id_cuenta_deuda,
                    monto: montoCred,
                    id_pago_origen: idPagoOrig,
                    id_usuario: id_usuario,
                    ip_origen: datos.ip_origen,
                    motivo: datos.motivo_credito || ('Aplicado en pago #' + numeroPago)
                });
                aplicacionesCredito.push(r65);
            } else {
                for (var iF = 0; iF < saldosFactura.length && montoCred > 0.001; iF++) {
                    var sf = saldosFactura[iF];
                    if (sf.restante <= 0.001) continue;
                    var aplicar = Math.min(montoCred, sf.restante);
                    var r65b = await aplicarCreditoSobreCuenta(client, {
                        id_empresa: id_empresa,
                        id_cuenta_credito: cred.id_cuenta_credito,
                        id_cuenta_deuda: sf.id_cuenta,
                        monto: aplicar,
                        id_pago_origen: idPagoOrig,
                        id_usuario: id_usuario,
                        ip_origen: datos.ip_origen,
                        motivo: datos.motivo_credito || ('Aplicado en pago #' + numeroPago)
                    });
                    aplicacionesCredito.push(r65b);
                    sf.restante -= aplicar;
                    montoCred -= aplicar;
                }
            }
        }
    }

    // ── 7. Pago a cuenta (CxP negativo) ──
    if (es_pago_a_cuenta) {
        await crearMovimientoCuenta(client, {
            id_empresa: id_empresa,
            id_proveedor: id_proveedor,
            tipo_movimiento: 'pago',
            monto: -totalFormasPago,
            saldo: -totalFormasPago,
            referencia: referenciaPago + ' (A cuenta)',
            observaciones: observaciones
        });
    }

    // ── 8. Registrar en CC proveedores (HABER) ──
    var fpNombreRes = await client.query(
        'SELECT nombre FROM formas_pago WHERE id_forma_pago = $1 AND id_empresa = $2',
        [formas_pago[0].id_forma_pago, id_empresa]
    );
    var metodoPagoNombre = formas_pago.length > 1
        ? (fpNombreRes.rows[0]?.nombre || 'Pago') + ' (+' + (formas_pago.length - 1) + ' más)'
        : fpNombreRes.rows[0]?.nombre || 'Pago';

    await registrarPagoEnCC(client, {
        id_empresa: id_empresa,
        id_proveedor: id_proveedor,
        id_pago_proveedor: id_pago,
        numero_pago: numeroPago,
        monto: totalFormasPago,
        metodo_pago_nombre: metodoPagoNombre,
        cheques: chequesInfo
    });

    return {
        id_pago: id_pago,
        numero_pago: numeroPago,
        referencia_pago: referenciaPago,
        total: totalFormasPago,
        aplicaciones_credito: aplicacionesCredito,
        modo: aplicacionesCredito.length > 0 ? 'mixto' : 'pago_simple'
    };
}


// ═══════════════════════════════════════════════════════════════
// ★ ORQUESTADOR: ANULAR PAGO COMPLETO
// ═══════════════════════════════════════════════════════════════

/**
 * Anula un pago y revierte todos sus efectos colaterales.
 * Controller solo debe hacer BEGIN → llamar esto → COMMIT/ROLLBACK.
 *
 * @param {pg.Client} client - dentro de transacción
 * @param {Object} datos
 * @param {number} datos.id_pago
 * @param {number} datos.id_empresa
 * @param {string} [datos.motivo]
 * @returns {Object} { id_pago, estado: 'anulado' }
 */
async function anularPagoProveedorCompleto(client, datos) {
    var id_pago = datos.id_pago;
    var id_empresa = datos.id_empresa;
    var motivo = datos.motivo;

    if (!id_pago) throw _error('id_pago obligatorio', 400);
    if (!id_empresa) throw _error('id_empresa obligatorio', 400);

    // ── 1. Obtener y validar pago ──
    var pagoRes = await client.query(
        'SELECT * FROM pagosaproveedores WHERE id_pago_proveedor = $1 AND id_empresa = $2',
        [id_pago, id_empresa]
    );
    if (pagoRes.rows.length === 0) throw _error('Pago no encontrado', 404);
    if (pagoRes.rows[0].estado === 'anulado') throw _error('El pago ya está anulado', 400);
    var pago = pagoRes.rows[0];

    // ── 1.5. Revertir aplicaciones de saldo a favor que usaron este pago como origen ──
    var rAppRev = await client.query(
        "SELECT * FROM aplicaciones_saldo_favor WHERE id_pago_origen=$1 AND id_empresa=$2 AND estado='activa' ORDER BY id_aplicacion DESC",
        [id_pago, id_empresa]
    );
    for (var iAR = 0; iAR < rAppRev.rows.length; iAR++) {
        var appRev = rAppRev.rows[iAR];
        var montoAR = parseFloat(appRev.monto_aplicado);
        // Borrar imputación creada en su momento (antes de que el bucle de imputaciones la procese de nuevo)
        await client.query(
            'DELETE FROM imputacion_pagos_proveedor WHERE id_pago=$1 AND id_cuenta=$2 AND monto_imputado=$3 AND id_empresa=$4',
            [appRev.id_pago_origen, appRev.id_cuenta_deuda, montoAR, id_empresa]
        );
        // Revertir saldo crédito (volver a más negativo)
        await client.query('UPDATE cuentas_por_pagar SET saldo = saldo - $1 WHERE id_cuenta = $2', [montoAR, appRev.id_cuenta_credito]);
        // Revertir saldo deuda (volver a más positivo)
        await client.query('UPDATE cuentas_por_pagar SET saldo = saldo + $1 WHERE id_cuenta = $2', [montoAR, appRev.id_cuenta_deuda]);
        // Volver estado del comprobante a pendiente si corresponde
        var rDeudaA = await client.query('SELECT saldo, id_comprobante FROM cuentas_por_pagar WHERE id_cuenta=$1', [appRev.id_cuenta_deuda]);
        if (rDeudaA.rows[0] && rDeudaA.rows[0].id_comprobante) {
            var saldoAP = parseFloat(rDeudaA.rows[0].saldo);
            var nuevoEstadoA = saldoAP > 0.01 ? 'pendiente' : 'pagado';
            await comprasHelper.actualizarEstadoComprobante(client, {
                id_comprobante: rDeudaA.rows[0].id_comprobante,
                estado: nuevoEstadoA
            });
        }
        // Marcar la aplicación como revertida
        await client.query(
            "UPDATE aplicaciones_saldo_favor SET estado='revertida', revertida_at=NOW(), revertida_por=$1, motivo_reversion=$2 WHERE id_aplicacion=$3",
            [datos.id_usuario || null, 'Anulación de pago origen #' + pago.numero_pago, appRev.id_aplicacion]
        );
    }

    // ── 2. Revertir imputaciones ──
    var imputRes = await client.query(
        'SELECT * FROM imputacion_pagos_proveedor WHERE id_pago = $1 AND id_empresa = $2',
        [id_pago, id_empresa]
    );
    for (var k = 0; k < imputRes.rows.length; k++) {
        var imp = imputRes.rows[k];
        await revertirSaldoCuenta(client, { id_cuenta: imp.id_cuenta, monto: imp.monto_imputado });
        var cuentaRes = await client.query(
            'SELECT id_comprobante FROM cuentas_por_pagar WHERE id_cuenta = $1 AND id_empresa = $2',
            [imp.id_cuenta, id_empresa]
        );
        if (cuentaRes.rows[0] && cuentaRes.rows[0].id_comprobante) {
            await comprasHelper.actualizarEstadoComprobante(client, {
                id_comprobante: cuentaRes.rows[0].id_comprobante,
                estado: 'pendiente'
            });
        }
    }
    await eliminarImputaciones(client, { id_pago: id_pago });

    // ── 2.5. Contra-asiento de tesoreria (revertir movimientos de caja) ──
    // Lee cada item del pago y por cada forma con metodo.mueve_caja=true
    // inserta un movimiento INVERSO (ingreso) en el turno actual del usuario.
    // Si el metodo no movio caja en el alta → no se registra contra-asiento (skip).
    var itemsRes = await client.query(
        'SELECT id_forma_pago, monto FROM pago_proveedor_items WHERE id_pago = $1 AND id_empresa = $2',
        [id_pago, id_empresa]
    );
    if (itemsRes.rows.length > 0) {
        var rProvNombreAnul = await client.query(
            'SELECT razon_social FROM proveedores WHERE id_proveedor = $1 AND id_empresa = $2',
            [pago.id_proveedor, id_empresa]
        );
        var razonSocialAnul = (rProvNombreAnul.rows[0] && rProvNombreAnul.rows[0].razon_social) || ('Proveedor #' + pago.id_proveedor);

        for (var ii = 0; ii < itemsRes.rows.length; ii++) {
            var item = itemsRes.rows[ii];
            await tesoreriaHelper.registrarMovimientoTesoreria(client, {
                id_empresa: id_empresa,
                id_usuario: datos.id_usuario,
                tipo: 'ingreso',
                monto: parseFloat(item.monto),
                id_forma_pago: item.id_forma_pago,
                concepto: 'Anulacion pago #' + pago.numero_pago + ' - ' + razonSocialAnul + ' (' + (motivo || 'sin motivo') + ')'
            });
        }
    }

    // ── 3. Revertir cheques ──
    await anularChequesPropios(client, { id_empresa: id_empresa, id_pago: id_pago });
    await devolverChequesTerceros(client, { id_pago: id_pago });

    // ── 4. Anular pago (estado + observación) ──
    await anularPago(client, { id_pago: id_pago, motivo: motivo });

    // ── 5. CC proveedores: contra-asiento (DEBE) ──
    await anularPagoEnCC(client, {
        id_empresa: id_empresa,
        id_proveedor: pago.id_proveedor,
        id_pago_proveedor: parseInt(id_pago),
        numero_pago: pago.numero_pago,
        monto: parseFloat(pago.monto),
        motivo: motivo || 'Anulación'
    });

    // ── 5.5. CASCADA_CUENTA_A_CUENTA: anular la cuenta_por_pagar del pago a cuenta ──
    // Si el pago era a cuenta, su crearMovimientoCuenta dejó una fila negativa en cuentas_por_pagar
    // (tipo='pago', id_comprobante=NULL, saldo=-monto). Hay que cerrar esa fila al anular,
    // sino queda como "crédito fantasma" disponible para imputar.
    if (pago.es_pago_a_cuenta) {
        var referenciaPago = 'PAGO-' + String(pago.numero_pago).padStart(8, '0') + ' (A cuenta)';
        var resCascada = await client.query(
            "UPDATE cuentas_por_pagar " +
            "SET saldo = 0, " +
            "    observaciones = COALESCE(observaciones, '') || E'\n[ANULADO: pago #' || $1 || ' anulado el ' || NOW()::date || ']' " +
            "WHERE id_empresa = $2 AND id_proveedor = $3 " +
            "  AND tipo_movimiento = 'pago' " +
            "  AND id_comprobante IS NULL " +
            "  AND referencia = $4 " +
            "RETURNING id_cuenta, saldo",
            [pago.numero_pago, id_empresa, pago.id_proveedor, referenciaPago]
        );
        if (resCascada.rowCount === 0) {
            console.warn('[anularPagoProveedorCompleto] No se encontró cuenta_por_pagar a cuenta para pago #' + pago.numero_pago + ' (' + referenciaPago + ')');
        }
    }

    return { id_pago: id_pago, estado: 'anulado' };
}


// ═══════════════════════════════════════════════════════════════
// UTILIDAD INTERNA
// ═══════════════════════════════════════════════════════════════

function _error(mensaje, statusCode) {
    var err = new Error(mensaje);
    err.statusCode = statusCode;
    return err;
}




// ═══════════════════════════════════════════════════════════════
// IMPUTACIÓN POSTERIOR — Aplicar saldo a favor sobre cuentas pendientes
// ═══════════════════════════════════════════════════════════════

async function obtenerCreditosDisponibles(pool, datos) {
    var id_proveedor = datos.id_proveedor;
    var id_empresa = datos.id_empresa;
    if (!id_empresa)   throw _error('obtenerCreditosDisponibles: id_empresa obligatorio', 400);
    if (!id_proveedor) throw _error('obtenerCreditosDisponibles: id_proveedor obligatorio', 400);

    var r = await pool.query(
        "SELECT id_cuenta_credito, id_proveedor, razon_social, cuit, tipo_movimiento, " +
        "       monto_original, saldo_actual, saldo_disponible, fecha_movimiento, " +
        "       referencia, observaciones, id_pago_origen, numero_pago, fecha_pago " +
        "FROM v_creditos_proveedor_disponibles " +
        "WHERE id_proveedor = $1 AND id_empresa = $2 " +
        "ORDER BY fecha_movimiento ASC",
        [id_proveedor, id_empresa]
    );
    return r.rows;
}

/**
 * Aplica un crédito sobre una cuenta deudora. ATÓMICA INTERNA — caller en transacción.
 */
async function aplicarCreditoSobreCuenta(client, datos) {
    var id_empresa        = datos.id_empresa;
    var id_cuenta_credito = datos.id_cuenta_credito;
    var id_cuenta_deuda   = datos.id_cuenta_deuda;
    var monto             = parseFloat(datos.monto);
    var id_pago_origen    = datos.id_pago_origen || null;
    var id_usuario        = datos.id_usuario;
    var ip_origen         = datos.ip_origen || null;
    var motivo            = datos.motivo || null;

    if (!id_empresa)         throw _error('aplicarCreditoSobreCuenta: id_empresa obligatorio', 400);
    if (!id_cuenta_credito)  throw _error('aplicarCreditoSobreCuenta: id_cuenta_credito obligatorio', 400);
    if (!id_cuenta_deuda)    throw _error('aplicarCreditoSobreCuenta: id_cuenta_deuda obligatorio', 400);
    if (!id_usuario)         throw _error('aplicarCreditoSobreCuenta: id_usuario obligatorio', 400);
    if (!monto || monto <= 0) throw _error('aplicarCreditoSobreCuenta: monto debe ser > 0', 400);
    if (id_cuenta_credito === id_cuenta_deuda) throw _error('Crédito y deuda no pueden ser la misma cuenta', 400);

    // 1) Lock + validar crédito
    var rc = await client.query(
        'SELECT id_proveedor, saldo, tipo_movimiento, referencia FROM cuentas_por_pagar WHERE id_cuenta=$1 AND id_empresa=$2 FOR UPDATE',
        [id_cuenta_credito, id_empresa]
    );
    if (!rc.rows[0]) throw _error('Crédito no encontrado', 404);
    var saldoCredito = parseFloat(rc.rows[0].saldo);
    if (saldoCredito >= 0) throw _error('La cuenta ' + id_cuenta_credito + ' no tiene saldo a favor (saldo=' + saldoCredito + ')', 400);
    var disponibleCredito = Math.abs(saldoCredito);
    if (monto > disponibleCredito + 0.01) throw _error('Monto ' + monto + ' excede saldo disponible ' + disponibleCredito + ' del crédito', 400);

    // 2) Lock + validar deuda
    var rd = await client.query(
        'SELECT id_proveedor, saldo, id_comprobante FROM cuentas_por_pagar WHERE id_cuenta=$1 AND id_empresa=$2 FOR UPDATE',
        [id_cuenta_deuda, id_empresa]
    );
    if (!rd.rows[0]) throw _error('Cuenta deuda no encontrada', 404);
    var saldoDeuda = parseFloat(rd.rows[0].saldo);
    if (saldoDeuda <= 0) throw _error('La cuenta ' + id_cuenta_deuda + ' no tiene saldo deudor (saldo=' + saldoDeuda + ')', 400);
    if (monto > saldoDeuda + 0.01) throw _error('Monto ' + monto + ' excede saldo deudor ' + saldoDeuda, 400);

    // 3) Mismo proveedor
    if (rc.rows[0].id_proveedor !== rd.rows[0].id_proveedor) {
        throw _error('Crédito y deuda deben pertenecer al mismo proveedor', 400);
    }

    // 4) Crear imputación (trigger decrementa saldo de la deuda)
    //    El id_pago apunta al pago a cuenta original — si lo conocemos. Si no, se hace
    //    update manual de la deuda (caso de notas de crédito sin pago vinculado).
    if (id_pago_origen) {
        await client.query(
            'INSERT INTO imputacion_pagos_proveedor (id_empresa, id_pago, id_cuenta, monto_imputado) VALUES ($1,$2,$3,$4)',
            [id_empresa, id_pago_origen, id_cuenta_deuda, monto]
        );
    } else {
        await client.query('UPDATE cuentas_por_pagar SET saldo = saldo - $1 WHERE id_cuenta = $2', [monto, id_cuenta_deuda]);
    }

    // 5) Reducir saldo del crédito (sumar → acercar a 0)
    await client.query('UPDATE cuentas_por_pagar SET saldo = saldo + $1 WHERE id_cuenta = $2', [monto, id_cuenta_credito]);

    // 6) Actualizar estado del comprobante si quedó saldado
    var rPost = await client.query('SELECT saldo, id_comprobante FROM cuentas_por_pagar WHERE id_cuenta=$1', [id_cuenta_deuda]);
    var saldoDeudaPost = parseFloat(rPost.rows[0].saldo);
    var idCompr = rPost.rows[0].id_comprobante;
    if (idCompr) {
        var nuevoEstado = saldoDeudaPost <= 0.01 ? 'pagado' : 'pagado_parcial';
        await comprasHelper.actualizarEstadoComprobante(client, {
            id_comprobante: idCompr,
            estado: nuevoEstado
        });
    }

    // 7) Trazabilidad en aplicaciones_saldo_favor
    var rApp = await client.query(
        'INSERT INTO aplicaciones_saldo_favor ' +
        '(id_empresa, id_cuenta_credito, id_cuenta_deuda, id_pago_origen, monto_aplicado, id_usuario, ip_origen, motivo) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_aplicacion',
        [id_empresa, id_cuenta_credito, id_cuenta_deuda, id_pago_origen, monto, id_usuario, ip_origen, motivo]
    );

    // 8) Movimiento informativo en CC proveedores (debe=0, haber=0) — no afecta saldo, deja huella en extracto
    var rConfigCC = await client.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave='cc_prov.imputacion.registrar_en_cc'",
        [id_empresa]
    );
    var registrarEnCC = rConfigCC.rows[0] && (rConfigCC.rows[0].valor === 'true' || rConfigCC.rows[0].valor === true);
    if (registrarEnCC) {
        // Identificar números de comprobante para el concepto
        var rNums = await client.query(
            'SELECT cc.numero_completo AS comprobante_deuda, ' +
            '       (SELECT cc2.numero_completo FROM comprobantes_compra cc2 ' +
            '         JOIN cuentas_por_pagar cpp2 ON cpp2.id_comprobante = cc2.id_comprobante ' +
            '         WHERE cpp2.id_cuenta = $2) AS comprobante_credito ' +
            'FROM comprobantes_compra cc WHERE cc.id_comprobante = (SELECT id_comprobante FROM cuentas_por_pagar WHERE id_cuenta=$1)',
            [id_cuenta_deuda, id_cuenta_credito]
        );
        var nombreDeuda  = (rNums.rows[0] && rNums.rows[0].comprobante_deuda)  || ('Cuenta #' + id_cuenta_deuda);
        var nombreCredit = (rNums.rows[0] && rNums.rows[0].comprobante_credito) ||
                           (rc.rows[0].referencia || ('Cuenta #' + id_cuenta_credito));
        var concepto = 'Imputación: ' + nombreCredit + ' → ' + nombreDeuda + ' por ' + monto.toFixed(2);

        await ccProveedores.registrarNotaInformativa(client, {
            id_empresa: id_empresa,
            id_proveedor: rc.rows[0].id_proveedor,
            concepto: concepto,
            id_comprobante_compra: idCompr,
            id_pago_proveedor: id_pago_origen
        });
    }

    return {
        id_aplicacion: rApp.rows[0].id_aplicacion,
        id_cuenta_credito: id_cuenta_credito,
        id_cuenta_deuda: id_cuenta_deuda,
        monto: monto,
        saldo_credito_post: saldoCredito + monto,
        saldo_deuda_post: saldoDeudaPost
    };
}

/**
 * Aplica saldo a favor en modo PURO (sin pago nuevo).
 * Recibe array de aplicaciones explícitas crédito → deuda.
 */
async function aplicarSaldoAFavor(pool, datos) {
    var id_empresa   = datos.id_empresa;
    var id_proveedor = datos.id_proveedor;
    var aplicaciones = datos.aplicaciones;
    var id_usuario   = datos.id_usuario;
    var ip_origen    = datos.ip_origen;
    var motivo       = datos.motivo;

    if (!id_empresa)   throw _error('aplicarSaldoAFavor: id_empresa obligatorio', 400);
    if (!id_proveedor) throw _error('aplicarSaldoAFavor: id_proveedor obligatorio', 400);
    if (!id_usuario)   throw _error('aplicarSaldoAFavor: id_usuario obligatorio', 400);
    if (!aplicaciones || !Array.isArray(aplicaciones) || aplicaciones.length === 0) {
        throw _error('aplicarSaldoAFavor: aplicaciones requerido (array no vacío)', 400);
    }

    var client = await pool.connect();
    try {
        await client.query('BEGIN');
        var resultados = [];
        for (var i = 0; i < aplicaciones.length; i++) {
            var app = aplicaciones[i];
            // Resolver id_pago_origen del crédito si no vino
            var idPagoOrigen = app.id_pago_origen || null;
            if (!idPagoOrigen) {
                var rP = await client.query(
                    'SELECT id_pago_origen FROM v_creditos_proveedor_disponibles WHERE id_cuenta_credito=$1 AND id_empresa=$2',
                    [app.id_cuenta_credito, id_empresa]
                );
                idPagoOrigen = rP.rows[0] ? rP.rows[0].id_pago_origen : null;
            }
            var r = await aplicarCreditoSobreCuenta(client, {
                id_empresa: id_empresa,
                id_cuenta_credito: app.id_cuenta_credito,
                id_cuenta_deuda:   app.id_cuenta_deuda,
                monto:             parseFloat(app.monto),
                id_pago_origen:    idPagoOrigen,
                id_usuario:        id_usuario,
                ip_origen:         ip_origen,
                motivo:            motivo
            });
            resultados.push(r);
        }
        await client.query('COMMIT');
        return { aplicaciones: resultados };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Revierte una aplicación de saldo a favor previa.
 */
async function revertirAplicacionSaldoFavor(pool, datos) {
    var id_aplicacion = datos.id_aplicacion;
    var id_empresa    = datos.id_empresa;
    var id_usuario    = datos.id_usuario;
    var ip_origen     = datos.ip_origen;
    var motivo        = datos.motivo;

    if (!id_aplicacion) throw _error('revertirAplicacionSaldoFavor: id_aplicacion obligatorio', 400);
    if (!id_empresa)    throw _error('revertirAplicacionSaldoFavor: id_empresa obligatorio', 400);
    if (!id_usuario)    throw _error('revertirAplicacionSaldoFavor: id_usuario obligatorio', 400);

    var client = await pool.connect();
    try {
        await client.query('BEGIN');
        var r = await client.query(
            'SELECT * FROM aplicaciones_saldo_favor WHERE id_aplicacion=$1 AND id_empresa=$2 FOR UPDATE',
            [id_aplicacion, id_empresa]
        );
        if (!r.rows[0]) throw _error('Aplicación no encontrada', 404);
        if (r.rows[0].estado === 'revertida') throw _error('Aplicación ya revertida', 400);
        var app = r.rows[0];
        var monto = parseFloat(app.monto_aplicado);

        // 1) Revertir saldo crédito (volver a más negativo)
        await client.query('UPDATE cuentas_por_pagar SET saldo = saldo - $1 WHERE id_cuenta = $2', [monto, app.id_cuenta_credito]);

        // 2) Revertir saldo deuda (volver a más positivo)
        await client.query('UPDATE cuentas_por_pagar SET saldo = saldo + $1 WHERE id_cuenta = $2', [monto, app.id_cuenta_deuda]);

        // 3) Borrar imputación creada (si la había)
        if (app.id_pago_origen) {
            await client.query(
                'DELETE FROM imputacion_pagos_proveedor WHERE id_pago=$1 AND id_cuenta=$2 AND monto_imputado=$3 AND id_empresa=$4',
                [app.id_pago_origen, app.id_cuenta_deuda, monto, id_empresa]
            );
        }

        // 4) Volver estado del comprobante a pendiente si corresponde
        var rDeuda = await client.query('SELECT saldo, id_comprobante FROM cuentas_por_pagar WHERE id_cuenta=$1', [app.id_cuenta_deuda]);
        if (rDeuda.rows[0] && rDeuda.rows[0].id_comprobante) {
            var saldoPost = parseFloat(rDeuda.rows[0].saldo);
            var nuevoEstado = saldoPost > 0.01 ? 'pendiente' : 'pagado';
            await comprasHelper.actualizarEstadoComprobante(client, {
                id_comprobante: rDeuda.rows[0].id_comprobante,
                estado: nuevoEstado
            });
        }

        // 5) Marcar aplicación como revertida
        await client.query(
            "UPDATE aplicaciones_saldo_favor SET estado='revertida', revertida_at=NOW(), revertida_por=$1, motivo_reversion=$2 WHERE id_aplicacion=$3",
            [id_usuario, motivo || 'Sin motivo', id_aplicacion]
        );

        await client.query('COMMIT');
        return { id_aplicacion: id_aplicacion, estado: 'revertida' };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}



module.exports = {
    // ★ Imputación posterior (saldo a favor)
    obtenerCreditosDisponibles,
    aplicarCreditoSobreCuenta,
    aplicarSaldoAFavor,
    revertirAplicacionSaldoFavor,

    // ★ Orquestadores (Sprint 2 — controller solo llama estos)
    registrarPagoProveedorCompleto,
    anularPagoProveedorCompleto,

    // Operaciones atómicas (uso interno del orquestador)
    crearPago, anularPago,
    insertarPagoItem,
    crearChequePropio, anularChequesPropios,
    endosarChequeTercero, devolverChequesTerceros,
    crearImputacion, eliminarImputaciones,
    registrarPagoEnCC, anularPagoEnCC,

    // Re-export de compras.helper
    crearMovimientoCuenta: comprasHelper.crearMovimientoCuenta,
    revertirSaldoCuenta: comprasHelper.revertirSaldoCuenta,
    actualizarEstadoComprobante: comprasHelper.actualizarEstadoComprobante
};
