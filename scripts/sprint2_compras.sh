#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# SPRINT 2 — ORQUESTADOR DE PAGOS PROVEEDORES
# ERP LAGO — 2026-03-26
#
# CAMBIOS:
#   pagos-proveedores.helper.js:
#     + registrarPagoProveedorCompleto() — orquestador transaccional
#     + anularPagoProveedorCompleto()    — orquestador de anulación
#   pagos-proveedores.controller.js:
#     ~ registrarPago → thin layer (delega al orquestador)
#     ~ anularPago    → thin layer (delega al orquestador)
#
# EJECUTAR: bash sprint2_compras.sh
# ═══════════════════════════════════════════════════════════════════════
set -e

ERP="/root/mi_erp"
BACKUP_DIR="$ERP/backups/pre_sprint2_compras_$(date +%Y%m%d_%H%M%S)"

echo "═══════════════════════════════════════════════════════════════"
echo "FASE 0: BACKUP"
echo "═══════════════════════════════════════════════════════════════"
mkdir -p "$BACKUP_DIR"
cp "$ERP/src/utils/pagos-proveedores.helper.js" "$BACKUP_DIR/"
cp "$ERP/src/controllers/pagos-proveedores.controller.js" "$BACKUP_DIR/"
echo "✅ Backup en: $BACKUP_DIR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 1: AGREGAR ORQUESTADORES AL HELPER"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'EOPY'
filepath = '/root/mi_erp/src/utils/pagos-proveedores.helper.js'
with open(filepath, 'r') as f:
    content = f.read()

original = content

# ═══════════════════════════════════════════════════════════════
# Inyectar los dos orquestadores ANTES del module.exports
# ═══════════════════════════════════════════════════════════════

ORQUESTADORES = '''
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
    if (!formas_pago || formas_pago.length === 0) throw _error('Debe especificar al menos una forma de pago', 400);

    const totalFormasPago = formas_pago.reduce((sum, fp) => sum + parseFloat(fp.monto || 0), 0);
    if (totalFormasPago <= 0) throw _error('El monto total debe ser mayor a 0', 400);

    if (!es_pago_a_cuenta && facturas_a_pagar && facturas_a_pagar.length > 0) {
        const totalFacturas = facturas_a_pagar.reduce((sum, f) => sum + parseFloat(f.monto_a_pagar || 0), 0);
        if (Math.abs(totalFormasPago - totalFacturas) > 0.01) {
            throw _error(
                'Total formas de pago ($' + totalFormasPago.toFixed(2) +
                ') no coincide con total a imputar ($' + totalFacturas.toFixed(2) + ')', 400
            );
        }
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
                'FROM cheques_terceros ct LEFT JOIN bancos b ON b.id_banco = ct.id_banco WHERE ct.id_cheque = $1',
                [fp.id_cheque_tercero]
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
                await actualizarEstadoComprobante(client, {
                    id_comprobante: cuentaRes.rows[0].id_comprobante,
                    estado: nuevoEstado
                });
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
        total: totalFormasPago
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
            await actualizarEstadoComprobante(client, {
                id_comprobante: cuentaRes.rows[0].id_comprobante,
                estado: 'pendiente'
            });
        }
    }
    await eliminarImputaciones(client, { id_pago: id_pago });

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

'''

# Buscar el bloque module.exports e inyectar antes
export_marker = 'module.exports = {'

if export_marker in content:
    # Verificar que no se haya inyectado ya
    if 'registrarPagoProveedorCompleto' in content:
        print("⚠️  Orquestadores ya existen en el archivo — saltando inyección")
    else:
        content = content.replace(export_marker, ORQUESTADORES + '\n' + export_marker)
        print("✅ Orquestadores inyectados antes de module.exports")
else:
    print("❌ No se encontró module.exports — verificar manualmente")

# Actualizar exports para incluir los orquestadores
old_exports = '''module.exports = {
    crearPago, anularPago,
    insertarPagoItem,
    crearChequePropio, anularChequesPropios,
    endosarChequeTercero, devolverChequesTerceros,
    crearImputacion, eliminarImputaciones,
    registrarPagoEnCC, anularPagoEnCC,
    // Re-export de compras.helper para uso en controller
    crearMovimientoCuenta: comprasHelper.crearMovimientoCuenta,
    revertirSaldoCuenta: comprasHelper.revertirSaldoCuenta,
    actualizarEstadoComprobante: comprasHelper.actualizarEstadoComprobante
};'''

new_exports = '''module.exports = {
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
};'''

if old_exports in content:
    content = content.replace(old_exports, new_exports)
    print("✅ module.exports actualizado con orquestadores")
elif 'registrarPagoProveedorCompleto' not in content.split('module.exports')[1] if 'module.exports' in content else True:
    print("⚠️  Exports no coincide exactamente — intentando inyectar en exports existente")
    # Fallback: buscar module.exports = { y agregar las líneas
    if 'module.exports = {' in content and 'registrarPagoProveedorCompleto' not in content:
        content = content.replace(
            'module.exports = {',
            'module.exports = {\n    // ★ Orquestadores\n    registrarPagoProveedorCompleto,\n    anularPagoProveedorCompleto,\n'
        )
        print("✅ Orquestadores agregados a exports (fallback)")

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print("✅ Archivo guardado: " + filepath)
    print("   Líneas: " + str(len(content.split('\n'))))
else:
    print("⚠️  Sin cambios")
EOPY

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 2: REFACTORIZAR CONTROLLER (thin layer)"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'EOPY'
filepath = '/root/mi_erp/src/controllers/pagos-proveedores.controller.js'
with open(filepath, 'r') as f:
    content = f.read()

original = content
fixes = 0

# ═══════════════════════════════════════════════════════════════
# FIX A: Reemplazar registrarPago completo → thin layer
# ═══════════════════════════════════════════════════════════════

# Buscar desde "exports.registrarPago = async" hasta el cierre del try/catch/finally
# El patrón es todo el bloque entre las líneas 56-179

old_registrar = '''exports.registrarPago = async (req, res) => {
    const { id_empresa, id_usuario } = req.usuario;
    const { id_proveedor, facturas_a_pagar, formas_pago, es_pago_a_cuenta, observaciones } = req.body;

    if (!id_proveedor) return res.status(400).json({ error: 'Falta el proveedor' });
    if (!formas_pago || formas_pago.length === 0) return res.status(400).json({ error: 'Debe especificar al menos una forma de pago' });

    const totalFormasPago = formas_pago.reduce((sum, fp) => sum + parseFloat(fp.monto || 0), 0);

    if (!es_pago_a_cuenta) {
        if (!facturas_a_pagar || facturas_a_pagar.length === 0) return res.status(400).json({ error: 'Debe seleccionar facturas a pagar o marcar como pago a cuenta' });
        const totalFacturas = facturas_a_pagar.reduce((sum, f) => sum + parseFloat(f.monto_a_pagar || 0), 0);
        if (Math.abs(totalFormasPago - totalFacturas) > 0.01) return res.status(400).json({ error: `El total de formas de pago ($${totalFormasPago.toFixed(2)}) no coincide con el total a imputar ($${totalFacturas.toFixed(2)})` });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Número de pago
        const { rows: seqRows } = await client.query("SELECT nextval('seq_numero_pago_proveedor') as numero");
        const numeroPago = seqRows[0].numero;
        const referenciaPago = `PAGO-${String(numeroPago).padStart(8, '0')}`;

        // 2. >>> HELPER — Cabecera <<<
        const pago = await pagosHelper.crearPago(client, {
            id_empresa, id_proveedor, id_usuario, id_metodo_pago: formas_pago[0].id_forma_pago,
            monto: totalFormasPago, referencia_pago: referenciaPago,
            observaciones, numero_pago: numeroPago, es_pago_a_cuenta
        });
        const id_pago = pago.id_pago_proveedor;

        // 3. Formas de pago
        for (const fp of formas_pago) {
            let idChequePropio = null, idChequeTercero = null;

            // >>> HELPER — Cheque propio <<<
            if (fp.tipo === 'cheque_propio' && fp.cheque_data) {
                const cheque = await pagosHelper.crearChequePropio(client, {
                    id_empresa, id_banco: fp.cheque_data.id_banco, numero_cheque: fp.cheque_data.numero_cheque,
                    fecha_vencimiento: fp.cheque_data.fecha_vencimiento, monto: fp.monto,
                    beneficiario: fp.cheque_data.beneficiario, id_proveedor, id_pago
                });
                idChequePropio = cheque.id_cheque;
            }

            // >>> HELPER — Cheque tercero endoso <<<
            if (fp.tipo === 'cheque_tercero' && fp.id_cheque_tercero) {
                await pagosHelper.endosarChequeTercero(client, { id_cheque: fp.id_cheque_tercero, id_proveedor, id_pago });
                idChequeTercero = fp.id_cheque_tercero;
            }

            // >>> HELPER — Item de pago <<<
            await pagosHelper.insertarPagoItem(client, {
                id_empresa, id_pago, id_forma_pago: fp.id_forma_pago, id_moneda: fp.id_moneda, monto: fp.monto,
                id_banco: fp.id_banco, numero_referencia: fp.referencia, fecha_acreditacion: fp.fecha_acreditacion,
                id_cheque_propio: idChequePropio, id_cheque_tercero: idChequeTercero, observaciones: fp.observaciones
            });
        }

        // 4. Imputar a facturas
        if (!es_pago_a_cuenta && facturas_a_pagar) {
            for (const factura of facturas_a_pagar) {
                // >>> HELPER — Imputación <<<
                await pagosHelper.crearImputacion(client, { id_empresa, id_pago, id_cuenta: factura.id_cuenta, monto_imputado: factura.monto_a_pagar });

                // Verificar saldo y actualizar estado comprobante
                const { rows: cuentaRows } = await client.query(`SELECT cpp.saldo, cpp.id_comprobante FROM cuentas_por_pagar cpp WHERE cpp.id_cuenta = $1 AND cpp.id_empresa = $2`, [factura.id_cuenta, id_empresa]);
                if (cuentaRows[0] && cuentaRows[0].id_comprobante) {
                    const nuevoEstado = cuentaRows[0].saldo <= 0 ? 'pagado' : 'pagado_parcial';
                    await pagosHelper.actualizarEstadoComprobante(client, { id_comprobante: cuentaRows[0].id_comprobante, estado: nuevoEstado });
                }
            }
        }

        // 5. Pago a cuenta
        if (es_pago_a_cuenta) {
            await pagosHelper.crearMovimientoCuenta(client, {
                id_empresa, id_proveedor, tipo_movimiento: 'pago',
                monto: -totalFormasPago, saldo: -totalFormasPago,
                referencia: `${referenciaPago} (A cuenta)`, observaciones
            });
        }

        
        // ═══ CC PROVEEDORES: registrar HABER ═══
        const chequesInfo = [];
        for (const fp of formas_pago) {
            if (fp.tipo === 'cheque_propio' && fp.cheque_data) {
                chequesInfo.push({
                    tipo: 'propio', numero: fp.cheque_data.numero_cheque,
                    banco: fp.cheque_data.banco_nombre || '', fecha_vencimiento: fp.cheque_data.fecha_vencimiento,
                    monto: fp.monto
                });
            }
            if (fp.tipo === 'cheque_tercero' && fp.id_cheque_tercero) {
                const chRes = await client.query('SELECT numero_cheque, COALESCE(b.nombre, ct.banco_nombre) as banco, fecha_vencimiento FROM cheques_terceros ct LEFT JOIN bancos b ON b.id_banco = ct.id_banco WHERE ct.id_cheque = $1', [fp.id_cheque_tercero]);
                if (chRes.rows[0]) {
                    chequesInfo.push({
                        tipo: 'tercero', numero: chRes.rows[0].numero_cheque,
                        banco: chRes.rows[0].banco || '', fecha_vencimiento: chRes.rows[0].fecha_vencimiento,
                        monto: fp.monto
                    });
                }
            }
        }
        const fpRes = await client.query('SELECT nombre FROM formas_pago WHERE id_forma_pago = $1 AND id_empresa = $2', [formas_pago[0].id_forma_pago, id_empresa]);
        const metodoPagoNombre = formas_pago.length > 1
            ? (fpRes.rows[0]?.nombre || 'Pago') + ' (+' + (formas_pago.length - 1) + ' más)'
            : fpRes.rows[0]?.nombre || 'Pago';
        await pagosHelper.registrarPagoEnCC(client, {
            id_empresa, id_proveedor, id_pago_proveedor: id_pago,
            numero_pago: numeroPago, monto: totalFormasPago,
            metodo_pago_nombre: metodoPagoNombre,
            cheques: chequesInfo
        });

await client.query('COMMIT');
        res.json({ success: true, message: 'Pago registrado correctamente', data: { id_pago, numero_pago: referenciaPago, total: totalFormasPago } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en registrarPago:', error.message);
        res.status(500).json({ error: 'Error al registrar pago: ' + error.message });
    } finally { client.release(); }
};'''

new_registrar = '''exports.registrarPago = async (req, res) => {
    const { id_empresa, id_usuario } = req.usuario;
    const { id_proveedor, facturas_a_pagar, formas_pago, es_pago_a_cuenta, observaciones, id_comprobante } = req.body;

    // Validación DTO mínima (lógica de negocio → helper)
    if (!id_proveedor) return res.status(400).json({ error: 'Falta el proveedor' });
    if (!formas_pago || formas_pago.length === 0) return res.status(400).json({ error: 'Debe especificar al menos una forma de pago' });
    if (!es_pago_a_cuenta && (!facturas_a_pagar || facturas_a_pagar.length === 0)) {
        return res.status(400).json({ error: 'Debe seleccionar facturas a pagar o marcar como pago a cuenta' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ★ ORQUESTADOR — toda la lógica está en el helper
        const resultado = await pagosHelper.registrarPagoProveedorCompleto(client, {
            id_empresa, id_proveedor, id_usuario,
            formas_pago, facturas_a_pagar,
            es_pago_a_cuenta, observaciones, id_comprobante
        });

        await client.query('COMMIT');
        res.json({
            success: true,
            message: 'Pago registrado correctamente',
            data: resultado
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en registrarPago:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al registrar pago' });
    } finally { client.release(); }
};'''

if old_registrar in content:
    content = content.replace(old_registrar, new_registrar)
    fixes += 1
    print("✅ FIX A: registrarPago refactorizado a thin layer (~120 líneas → ~25)")
else:
    print("⚠️  FIX A: Patrón registrarPago no encontrado exacto — verificar manualmente")
    # Intentar detectar si ya fue refactorizado
    if 'registrarPagoProveedorCompleto' in content:
        print("   → Ya parece refactorizado (orquestador detectado en controller)")

# ═══════════════════════════════════════════════════════════════
# FIX B: Reemplazar anularPago completo → thin layer
# ═══════════════════════════════════════════════════════════════

old_anular = '''exports.anularPago = async (req, res) => {
    const { id_empresa, id_usuario } = req.usuario;
    const { id } = req.params; const { motivo } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: pagoRows } = await client.query(`SELECT * FROM pagosaproveedores WHERE id_pago_proveedor = $1 AND id_empresa = $2`, [id, id_empresa]);
        if (pagoRows.length === 0) throw new Error('Pago no encontrado');
        if (pagoRows[0].estado === 'anulado') throw new Error('El pago ya está anulado');

        // Revertir imputaciones
        const { rows: imputaciones } = await client.query(`SELECT * FROM imputacion_pagos_proveedor WHERE id_pago = $1 AND id_empresa = $2`, [id, id_empresa]);
        for (const imp of imputaciones) {
            // >>> HELPER <<<
            await pagosHelper.revertirSaldoCuenta(client, { id_cuenta: imp.id_cuenta, monto: imp.monto_imputado });
            const { rows: cuentaRows } = await client.query(`SELECT id_comprobante FROM cuentas_por_pagar WHERE id_cuenta = $1 AND id_empresa = $2`, [imp.id_cuenta, id_empresa]);
            if (cuentaRows[0]?.id_comprobante) {
                await pagosHelper.actualizarEstadoComprobante(client, { id_comprobante: cuentaRows[0].id_comprobante, estado: 'pendiente' });
            }
        }
        await pagosHelper.eliminarImputaciones(client, { id_pago: id });

        // >>> HELPER — Cheques <<<
        await pagosHelper.anularChequesPropios(client, { id_empresa, id_pago: id });
        await pagosHelper.devolverChequesTerceros(client, { id_pago: id });

        // >>> HELPER — Anular pago <<<
        await pagosHelper.anularPago(client, { id_pago: id, motivo });

        
        // ═══ CC PROVEEDORES: contra-asiento anulación ═══
        await pagosHelper.anularPagoEnCC(client, {
            id_empresa, id_proveedor: pagoRows[0].id_proveedor,
            id_pago_proveedor: parseInt(id),
            numero_pago: pagoRows[0].numero_pago,
            monto: parseFloat(pagoRows[0].monto),
            motivo: motivo || 'Anulación'
        });

await client.query('COMMIT');
        res.json({ success: true, message: 'Pago anulado correctamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en anularPago:', error.message);
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
};'''

new_anular = '''exports.anularPago = async (req, res) => {
    const { id_empresa } = req.usuario;
    const { id } = req.params;
    const { motivo } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ★ ORQUESTADOR — toda la lógica está en el helper
        const resultado = await pagosHelper.anularPagoProveedorCompleto(client, {
            id_pago: parseInt(id),
            id_empresa,
            motivo
        });

        await client.query('COMMIT');
        res.json({ success: true, message: 'Pago anulado correctamente', data: resultado });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en anularPago:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally { client.release(); }
};'''

if old_anular in content:
    content = content.replace(old_anular, new_anular)
    fixes += 1
    print("✅ FIX B: anularPago refactorizado a thin layer (~45 líneas → ~18)")
else:
    print("⚠️  FIX B: Patrón anularPago no encontrado exacto — verificar manualmente")
    if 'anularPagoProveedorCompleto' in content:
        print("   → Ya parece refactorizado")

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print("✅ " + str(fixes) + " fix(es) aplicados a: " + filepath)
    print("   Líneas: " + str(len(content.split('\n'))))
else:
    print("⚠️  Sin cambios")
EOPY

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 3: RESTART + VERIFICACIÓN"
echo "═══════════════════════════════════════════════════════════════"

source ~/.nvm/nvm.sh
pm2 restart erplago
sleep 3

echo ""
echo "—— 3.1 PM2 status:"
pm2 ls --no-color | grep erplago

echo ""
echo "—— 3.2 Errores recientes (últimas 10 líneas):"
pm2 logs erplago --err --lines 10 --nostream 2>/dev/null

echo ""
echo "—— 3.3 Verificar orquestadores exportados en helper:"
grep -n "registrarPagoProveedorCompleto\|anularPagoProveedorCompleto" "$ERP/src/utils/pagos-proveedores.helper.js"

echo ""
echo "—— 3.4 Verificar controller usa orquestadores:"
grep -n "registrarPagoProveedorCompleto\|anularPagoProveedorCompleto" "$ERP/src/controllers/pagos-proveedores.controller.js"

echo ""
echo "—— 3.5 Contar líneas (helper debe ser ~400+, controller debe bajar):"
echo "   Helper:     $(wc -l < $ERP/src/utils/pagos-proveedores.helper.js) líneas"
echo "   Controller: $(wc -l < $ERP/src/controllers/pagos-proveedores.controller.js) líneas"

echo ""
echo "—— 3.6 Test con curl — registrar pago de prueba:"
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"juan","password":"jp191082"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -n "$TOKEN" ]; then
    echo "Token ✅"

    # Obtener un proveedor con facturas pendientes
    PROV=$(curl -s "http://localhost:3000/api/pagos-proveedores/proveedores-con-saldo" \
      -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
provs = data.get('data', [])
if provs:
    p = provs[0]
    print(p['id_proveedor'])
else:
    print('')
" 2>/dev/null)

    if [ -n "$PROV" ]; then
        echo "Proveedor con saldo: #$PROV ✅"

        # Obtener facturas pendientes
        FACT=$(curl -s "http://localhost:3000/api/pagos-proveedores/facturas-pendientes/$PROV" \
          -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
facts = data.get('data', [])
if facts:
    f = facts[0]
    print(json.dumps({'id_cuenta': f['id_cuenta'], 'saldo': f['saldo']}))
else:
    print('')
" 2>/dev/null)

        if [ -n "$FACT" ]; then
            echo "Factura pendiente encontrada: $FACT ✅"
            echo ""
            echo "Para testear manualmente, podés registrar un pago desde pagos-proveedores.html"
            echo "o con curl:"
            echo ""
            ID_CUENTA=$(echo "$FACT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id_cuenta'])")
            SALDO=$(echo "$FACT" | python3 -c "import sys,json; print(json.load(sys.stdin)['saldo'])")
            echo "  curl -X POST http://localhost:3000/api/pagos-proveedores \\"
            echo "    -H 'Authorization: Bearer TOKEN' \\"
            echo "    -H 'Content-Type: application/json' \\"
            echo "    -d '{\"id_proveedor\": $PROV, \"formas_pago\": [{\"id_forma_pago\": 1, \"monto\": $SALDO, \"tipo\": \"efectivo\", \"id_moneda\": 1}], \"facturas_a_pagar\": [{\"id_cuenta\": $ID_CUENTA, \"monto_a_pagar\": $SALDO}]}'"
        else
            echo "⚠️  No hay facturas pendientes para testear"
        fi
    else
        echo "⚠️  No hay proveedores con saldo para testear"
    fi
else
    echo "❌ No se pudo obtener token"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "SPRINT 2 COMPLETADO"
echo "═══════════════════════════════════════════════════════════════"
echo "Backup: $BACKUP_DIR"
echo ""
echo "Resumen:"
echo "  Helper:     +registrarPagoProveedorCompleto() +anularPagoProveedorCompleto()"
echo "  Controller: registrarPago y anularPago son ahora thin layers"
echo "  Lógica de negocio: 100% centralizada en helper"
echo ""
echo "Para RESTAURAR:"
echo "  cp $BACKUP_DIR/pagos-proveedores.helper.js $ERP/src/utils/"
echo "  cp $BACKUP_DIR/pagos-proveedores.controller.js $ERP/src/controllers/"
echo "  source ~/.nvm/nvm.sh && pm2 restart erplago"
