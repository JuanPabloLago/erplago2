#!/usr/bin/env python3
"""
PATCH: Cobro en Despachos — ERP LAGO
2026-03-19

Archivos modificados (6):
  1. pagos.helper.js         → +origen en destructuring e INSERT
  2. pedidos.helper.js       → +COBRO_DESPACHO en LOG_PEDIDO_ACCIONES
  3. despachos.helper.js     → +registrarCobroRemito() nueva función
  4. despachos.controller.js → +cobrarRemito() nuevo handler
  5. despachos.routes.js     → +POST /remito/:id/cobrar
  6. gestion-despachos.js    → botón cobrar + modal + fetch
  7. gestion-despachos.html  → modal HTML

Ejecutar: python3 patch_cobro_despachos.py
"""

import os, sys, shutil
from datetime import datetime

BACKUP_DIR = "/root/mi_erp/backups/pre_cobro_despachos_" + datetime.now().strftime('%Y%m%d_%H%M%S')

FILES = {
    'pagos_helper':     '/root/mi_erp/src/utils/pagos.helper.js',
    'pedidos_helper':   '/root/mi_erp/src/utils/pedidos.helper.js',
    'despachos_helper': '/root/mi_erp/src/utils/despachos.helper.js',
    'despachos_ctrl':   '/root/mi_erp/src/controllers/despachos.controller.js',
    'despachos_routes': '/root/mi_erp/src/routes/despachos.routes.js',
    'despachos_js':     '/root/mi_erp/frontend/js/gestion-despachos.js',
    'despachos_html':   '/root/mi_erp/frontend/gestion-despachos.html',
}

def backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    for k, p in FILES.items():
        if os.path.exists(p):
            shutil.copy2(p, os.path.join(BACKUP_DIR, os.path.basename(p)))
    print("  Backup en: " + BACKUP_DIR)

def r(code, old, new, label):
    if old not in code:
        print("  [SKIP] " + label)
        return code, False
    code = code.replace(old, new, 1)
    print("  [OK] " + label)
    return code, True


# ═══════════════════════════════════════════════════════════════
# 1. PAGOS HELPER: agregar origen al destructuring e INSERT
# ═══════════════════════════════════════════════════════════════
def patch_pagos_helper():
    p = FILES['pagos_helper']
    c = open(p).read()
    n = 0

    # 1a. Agregar origen al destructuring
    c, ok = r(c,
        "        // ── FLAGS DE CONTROL ──\n        registrar_en_caja = true,\n        registrar_en_cc = true,",
        "        // ── FLAGS DE CONTROL ──\n        registrar_en_caja = true,\n        registrar_en_cc = true,\n\n        // ── TRAZABILIDAD ──\n        origen = 'pos',",
        "pagos.helper: +origen en destructuring"
    )
    if ok: n += 1

    # 1b. Agregar origen al INSERT
    c, ok = r(c,
        "            id_terminal, cuotas, coeficiente, monto_original, comision_estimada\n        ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)\n        RETURNING id_pago, id_pago_estado, fecha_pago, recargo_porcentaje",
        "            id_terminal, cuotas, coeficiente, monto_original, comision_estimada, origen\n        ) VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)\n        RETURNING id_pago, id_pago_estado, fecha_pago, recargo_porcentaje",
        "pagos.helper: +origen en INSERT columns"
    )
    if ok: n += 1

    # 1c. Agregar origen al array de valores
    c, ok = r(c,
        "        comision_estimada || 0\n    ]);",
        "        comision_estimada || 0,\n        origen\n    ]);",
        "pagos.helper: +origen en VALUES array"
    )
    if ok: n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> pagos.helper.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 2. PEDIDOS HELPER: agregar COBRO_DESPACHO a LOG_PEDIDO_ACCIONES
# ═══════════════════════════════════════════════════════════════
def patch_pedidos_helper():
    p = FILES['pedidos_helper']
    c = open(p).read()
    n = 0

    c, ok = r(c,
        "    SUSPENDIDO: 'SUSPENDIDO'\n};",
        "    SUSPENDIDO: 'SUSPENDIDO',\n    COBRO_DESPACHO: 'COBRO_DESPACHO'\n};",
        "pedidos.helper: +COBRO_DESPACHO"
    )
    if ok: n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> pedidos.helper.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 3. DESPACHOS HELPER: agregar registrarCobroRemito()
# ═══════════════════════════════════════════════════════════════
def patch_despachos_helper():
    p = FILES['despachos_helper']
    c = open(p).read()
    n = 0

    # 3a. Agregar requires al inicio
    anchor = "const logger = require('./logger');"
    new_requires = """const logger = require('./logger');
const pagosHelper = require('./pagos.helper');
const recibosHelper = require('./recibos.helper');
const pedidosHelper = require('./pedidos.helper');
const cajaHelper = require('./caja.helper');"""

    if "pagosHelper" not in c:
        c, ok = r(c, anchor, new_requires, "despachos.helper: +requires helpers")
        if ok: n += 1

    # 3b. Agregar función registrarCobroRemito antes del module.exports
    new_function = '''

// ═══════════════════════════════════════════════════════════════
// COBRO EN DESPACHOS
// ═══════════════════════════════════════════════════════════════

/**
 * Mapeo metodosdepago → formas_pago (via query, no hardcodeado)
 */
async function resolverFormaPago(client, id_empresa, id_metodo_pago) {
    const metodo = await client.query(
        'SELECT nombre FROM metodosdepago WHERE id_metodo_pago = $1 AND id_empresa = $2',
        [id_metodo_pago, id_empresa]
    );
    if (metodo.rows.length === 0) return 1; // fallback

    const nombre = metodo.rows[0].nombre.toLowerCase();
    let codigoForma = 'EFECTIVO';
    if (nombre.includes('mercado'))       codigoForma = 'MERCADOPAGO';
    else if (nombre.includes('transfer')) codigoForma = 'TRANSFERENCIA';
    else if (nombre.includes('créd') || nombre.includes('cred')) codigoForma = 'TARJETA_CREDITO';
    else if (nombre.includes('déb') || nombre.includes('deb'))  codigoForma = 'TARJETA_DEBITO';

    const fp = await client.query(
        'SELECT id_forma_pago FROM formas_pago WHERE id_empresa = $1 AND codigo = $2 AND activo = true LIMIT 1',
        [id_empresa, codigoForma]
    );
    if (fp.rows.length > 0) return fp.rows[0].id_forma_pago;

    // Fallback: primera forma de pago activa
    const fallback = await client.query(
        'SELECT id_forma_pago FROM formas_pago WHERE id_empresa = $1 AND activo = true ORDER BY id_forma_pago LIMIT 1',
        [id_empresa]
    );
    return fallback.rows.length > 0 ? fallback.rows[0].id_forma_pago : 1;
}

/**
 * Siguiente número de recibo para la empresa.
 */
async function proximoNumeroRecibo(client, id_empresa) {
    const res = await client.query(
        'SELECT COALESCE(MAX(numero_recibo), 0) + 1 AS proximo FROM recibos WHERE id_empresa = $1',
        [id_empresa]
    );
    return res.rows[0].proximo;
}

/**
 * registrarCobroRemito — ÚNICO punto de cobro desde despachos.
 * Orquesta: pagos + recibos + recibo_items + pedidos_log
 *
 * @param {object} client - pg client (dentro de transacción)
 * @param {object} params
 * @returns {{ id_pago, id_recibo, numero_recibo, saldo_restante }}
 */
async function registrarCobroRemito(client, params) {
    const {
        id_empresa, id_remito, id_metodo_pago, monto,
        id_usuario, id_turno, referencia
    } = params;

    // ═══ 1. VALIDAR REMITO ═══
    const remitoCheck = await client.query(
        `SELECT r.id_remito, r.id_pedido, r.id_cliente, r.numero_completo,
                c.razon_social as cliente_nombre
         FROM remitos r
         LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
         WHERE r.id_remito = $1 AND r.id_empresa = $2`,
        [id_remito, id_empresa]
    );
    if (remitoCheck.rows.length === 0) {
        const err = new Error('Remito no encontrado'); err.statusCode = 404; throw err;
    }
    const remito = remitoCheck.rows[0];

    if (!remito.id_pedido) {
        const err = new Error('Remito sin pedido asociado'); err.statusCode = 400; throw err;
    }

    // ═══ 2. CONSULTAR SALDO ═══
    const saldoCheck = await client.query(
        'SELECT pedido_total, total_pagado, saldo FROM v_saldo_pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [remito.id_pedido, id_empresa]
    );
    if (saldoCheck.rows.length === 0) {
        const err = new Error('No se pudo obtener saldo del pedido'); err.statusCode = 400; throw err;
    }
    const { saldo } = saldoCheck.rows[0];
    const montoNum = parseFloat(monto);

    if (parseFloat(saldo) < 1) {
        const err = new Error('El pedido ya está pagado'); err.statusCode = 400; throw err;
    }
    if (montoNum > parseFloat(saldo) + 0.01) {
        const err = new Error('El monto ($' + montoNum.toFixed(2) + ') excede el saldo ($' + parseFloat(saldo).toFixed(2) + ')');
        err.statusCode = 400; throw err;
    }

    // ═══ 3. REGISTRAR PAGO ═══
    const pago = await pagosHelper.registrarPago(client, {
        id_empresa,
        id_pedido: remito.id_pedido,
        id_metodo_pago,
        monto: montoNum,
        id_usuario,
        id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
        id_turno,
        id_transaccion_externa: referencia || null,
        observaciones: 'Cobro en despacho - Remito ' + remito.numero_completo,
        concepto_prefijo: 'Cobro despacho',
        origen: 'despachos'
    });

    // ═══ 4. CREAR RECIBO ═══
    const numeroRecibo = await proximoNumeroRecibo(client, id_empresa);
    const recibo = await recibosHelper.crearRecibo(client, {
        id_empresa,
        id_cliente: remito.id_cliente,
        id_usuario,
        id_turno,
        numero_recibo: numeroRecibo,
        total_recibo: montoNum,
        id_moneda_recibo: 1,
        concepto: 'Cobro despacho - Remito ' + remito.numero_completo + ' - ' + (remito.cliente_nombre || ''),
        observaciones: referencia ? 'Ref: ' + referencia : null
    });

    // ═══ 5. RECIBO ITEM ═══
    const idFormaPago = await resolverFormaPago(client, id_empresa, id_metodo_pago);
    await recibosHelper.insertarReciboItem(client, {
        id_empresa,
        id_recibo: recibo.id_recibo,
        id_forma_pago: idFormaPago,
        id_moneda: 1,
        monto_original: montoNum,
        cotizacion_usada: 1,
        monto_convertido: montoNum,
        numero_referencia: referencia || null
    });

    // ═══ 6. LOG AUDITORÍA ═══
    await pedidosHelper.registrarLogPedido(client, {
        id_pedido: remito.id_pedido,
        id_empresa,
        id_usuario,
        accion: pedidosHelper.LOG_PEDIDO_ACCIONES.COBRO_DESPACHO,
        detalle_despues: {
            id_pago: pago.id_pago,
            id_recibo: recibo.id_recibo,
            id_remito,
            id_metodo_pago,
            monto: montoNum,
            numero_recibo: numeroRecibo
        }
    });

    // ═══ 7. SALDO RESTANTE ═══
    const saldoPost = await client.query(
        'SELECT saldo FROM v_saldo_pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [remito.id_pedido, id_empresa]
    );
    const saldoRestante = saldoPost.rows.length > 0 ? parseFloat(saldoPost.rows[0].saldo) : 0;

    logger.info('[despachos.helper] Cobro registrado: Remito ' + remito.numero_completo +
        ' $' + montoNum.toFixed(2) + ' saldo restante: $' + saldoRestante.toFixed(2));

    return {
        id_pago: pago.id_pago,
        id_recibo: recibo.id_recibo,
        numero_recibo: 'R-' + String(numeroRecibo).padStart(8, '0'),
        saldo_restante: saldoRestante
    };
}

'''

    exports_anchor = "module.exports = {"
    if "registrarCobroRemito" not in c:
        c = c.replace(exports_anchor, new_function + exports_anchor)
        print("  [OK] despachos.helper: +registrarCobroRemito()")
        n += 1

        # 3c. Agregar a exports
        c, ok = r(c,
            "    registrarEntregaItem\n};",
            "    registrarEntregaItem,\n\n    // Cobros\n    registrarCobroRemito\n};",
            "despachos.helper: +export registrarCobroRemito"
        )
        if ok: n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> despachos.helper.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 4. DESPACHOS CONTROLLER: agregar cobrarRemito()
# ═══════════════════════════════════════════════════════════════
def patch_despachos_controller():
    p = FILES['despachos_ctrl']
    c = open(p).read()
    n = 0

    # Necesito ver si ya importa cajaHelper
    if "cajaHelper" not in c:
        c, ok = r(c,
            "const despachosHelper = require('../utils/despachos.helper');",
            "const despachosHelper = require('../utils/despachos.helper');\nconst cajaHelper = require('../utils/caja.helper');",
            "despachos.ctrl: +require cajaHelper"
        )
        if ok: n += 1

    new_handler = '''
    // ═══════════════════════════════════════════════════════════
    // COBRAR REMITO
    // ═══════════════════════════════════════════════════════════
    async cobrarRemito(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_remito = parseInt(req.params.id, 10);
        const { id_metodo_pago, monto, referencia } = req.body;

        if (!id_metodo_pago || !monto) {
            return res.status(400).json({ error: 'id_metodo_pago y monto son obligatorios' });
        }
        if (parseFloat(monto) <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Turno obligatorio
            const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
            if (!turno) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Debe abrir la caja antes de registrar cobros',
                    code: 'CAJA_CERRADA'
                });
            }

            const resultado = await despachosHelper.registrarCobroRemito(client, {
                id_empresa,
                id_remito,
                id_metodo_pago: parseInt(id_metodo_pago, 10),
                monto: parseFloat(monto),
                id_usuario,
                id_turno: turno.id_turno,
                referencia: referencia || null
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Cobro registrado - Recibo ' + resultado.numero_recibo,
                ...resultado
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en cobrarRemito:', error);
            res.status(error.statusCode || 500).json({
                error: error.message || 'Error al registrar cobro'
            });
        } finally {
            client.release();
        }
    },

'''

    if "cobrarRemito" not in c:
        # Insertar antes de busquedaGlobal o antes del cierre
        c, ok = r(c,
            "    async busquedaGlobal",
            new_handler + "    async busquedaGlobal",
            "despachos.ctrl: +cobrarRemito handler"
        )
        if ok: n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> despachos.controller.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 5. DESPACHOS ROUTES: agregar POST /remito/:id/cobrar
# ═══════════════════════════════════════════════════════════════
def patch_despachos_routes():
    p = FILES['despachos_routes']
    c = open(p).read()
    n = 0

    c, ok = r(c,
        "router.get('/remito/:id/imprimir', despachosController.imprimirRemito);",
        "router.get('/remito/:id/imprimir', despachosController.imprimirRemito);\nrouter.post('/remito/:id/cobrar', despachosController.cobrarRemito);",
        "despachos.routes: +POST /remito/:id/cobrar"
    )
    if ok: n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> despachos.routes.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 6. FRONTEND JS: botón cobrar + modal + lógica
# ═══════════════════════════════════════════════════════════════
def patch_frontend_js():
    p = FILES['despachos_js']
    c = open(p).read()
    n = 0

    # 6a. Agregar botón $Cobrar al lado del botón impresora en cada remito badge
    old_badge = ("        return '<span class=\"viaje-remito-badge\">' +\n"
                 "            '<a href=\"#\" onclick=\"event.preventDefault();event.stopPropagation();imprimirRemito(' + r.id_remito + ')\" title=\"Imprimir remito\" style=\"color:#1976d2;text-decoration:none;margin-right:4px;\"><i class=\"bi bi-printer\"></i></a>' +\n"
                 "            escapeHTML(r.numero_completo)")

    new_badge = ("        const saldoCobrar = parseFloat(r.saldo || 0);\n"
                 "        const btnCobrar = saldoCobrar > 1 ? ' <a href=\"#\" onclick=\"event.preventDefault();event.stopPropagation();abrirModalCobro(' + r.id_remito + ',' + r.id_pedido + ',\\'' + escapeHTML(r.numero_completo) + '\\',' + saldoCobrar.toFixed(2) + ',\\'' + escapeHTML(r.cliente || '') + '\\')\" title=\"Cobrar $' + formatMoney(saldoCobrar) + '\" style=\"color:#c62828;text-decoration:none;margin-right:4px;font-weight:bold;\"><i class=\"bi bi-cash-coin\"></i></a>' : '';\n"
                 "        return '<span class=\"viaje-remito-badge\">' +\n"
                 "            '<a href=\"#\" onclick=\"event.preventDefault();event.stopPropagation();imprimirRemito(' + r.id_remito + ')\" title=\"Imprimir remito\" style=\"color:#1976d2;text-decoration:none;margin-right:4px;\"><i class=\"bi bi-printer\"></i></a>' +\n"
                 "            btnCobrar +\n"
                 "            escapeHTML(r.numero_completo)")

    c, ok = r(c, old_badge, new_badge, "frontend: +botón cobrar en badge remito")
    if ok: n += 1

    # 6b. Agregar funciones de cobro al final del archivo
    cobro_js = '''

// ═══════════════════════════════════════════════════════════════
// COBRO EN DESPACHOS
// ═══════════════════════════════════════════════════════════════

let cobroActual = null;

function abrirModalCobro(idRemito, idPedido, nroRemito, saldo, cliente) {
    cobroActual = { idRemito, idPedido, nroRemito, saldo, cliente };

    const modal = document.getElementById('modalCobro');
    if (!modal) { mostrarToast('Modal de cobro no encontrado', 'danger'); return; }

    document.getElementById('cobroRemitoInfo').textContent = nroRemito + ' - ' + cliente;
    document.getElementById('cobroPedidoInfo').textContent = 'Pedido #' + idPedido;
    document.getElementById('cobroSaldoInfo').textContent = '$' + formatMoney(saldo);
    document.getElementById('cobroMonto').value = saldo;
    document.getElementById('cobroReferencia').value = '';

    // Reset botones forma de pago
    document.querySelectorAll('.cobro-metodo-btn').forEach(function(btn) {
        btn.classList.remove('active');
    });
    // Seleccionar efectivo por defecto
    const btnEfectivo = document.querySelector('.cobro-metodo-btn[data-metodo="1"]');
    if (btnEfectivo) btnEfectivo.classList.add('active');
    cobroActual.idMetodoPago = 1;

    document.getElementById('btnConfirmarCobro').disabled = false;
    new bootstrap.Modal(modal).show();
}

function seleccionarMetodoCobro(btn, idMetodo) {
    document.querySelectorAll('.cobro-metodo-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    cobroActual.idMetodoPago = idMetodo;
}

async function confirmarCobro() {
    if (!cobroActual) return;

    const monto = parseFloat(document.getElementById('cobroMonto').value);
    const referencia = document.getElementById('cobroReferencia').value.trim();
    const idMetodoPago = cobroActual.idMetodoPago;

    if (!monto || monto <= 0) { mostrarToast('Ingrese un monto válido', 'warning'); return; }
    if (monto > cobroActual.saldo + 0.01) { mostrarToast('El monto excede el saldo', 'warning'); return; }
    if (!idMetodoPago) { mostrarToast('Seleccione forma de pago', 'warning'); return; }

    document.getElementById('btnConfirmarCobro').disabled = true;

    try {
        const response = await fetchAPI('/remito/' + cobroActual.idRemito + '/cobrar', {
            method: 'POST',
            body: JSON.stringify({
                id_metodo_pago: idMetodoPago,
                monto: monto,
                referencia: referencia || null
            })
        });

        bootstrap.Modal.getInstance(document.getElementById('modalCobro')).hide();
        mostrarToast('Cobro registrado - ' + response.numero_recibo + ' | Saldo: $' + formatMoney(response.saldo_restante), 'success');

        // Refresh viajes
        cargarViajes();

    } catch (error) {
        document.getElementById('btnConfirmarCobro').disabled = false;
        if (error.message && error.message.includes('caja')) {
            mostrarToast('Debe abrir la caja antes de cobrar', 'danger');
        } else {
            mostrarToast('Error: ' + (error.message || error), 'danger');
        }
    }
}
'''

    if "abrirModalCobro" not in c:
        c = c + cobro_js
        print("  [OK] frontend: +funciones de cobro")
        n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> gestion-despachos.js: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# 7. FRONTEND HTML: modal de cobro
# ═══════════════════════════════════════════════════════════════
def patch_frontend_html():
    p = FILES['despachos_html']
    c = open(p).read()
    n = 0

    modal_html = '''
    <!-- Modal Cobro Despacho -->
    <div class="modal fade" id="modalCobro" tabindex="-1">
        <div class="modal-dialog modal-sm">
            <div class="modal-content">
                <div class="modal-header bg-success text-white py-2">
                    <h6 class="modal-title"><i class="bi bi-cash-coin"></i> Cobrar Remito</h6>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body py-3">
                    <div class="text-center mb-3">
                        <div class="fw-bold" id="cobroRemitoInfo"></div>
                        <small class="text-muted" id="cobroPedidoInfo"></small>
                        <div class="mt-1">Saldo: <strong class="text-danger" id="cobroSaldoInfo"></strong></div>
                    </div>
                    <div class="mb-3">
                        <label class="form-label small mb-1">Monto</label>
                        <input type="number" class="form-control" id="cobroMonto" step="0.01" min="0">
                    </div>
                    <div class="mb-3">
                        <label class="form-label small mb-1">Forma de pago</label>
                        <div class="d-flex flex-wrap gap-1">
                            <button type="button" class="btn btn-sm btn-outline-success cobro-metodo-btn" data-metodo="1" onclick="seleccionarMetodoCobro(this,1)"><i class="bi bi-cash-stack"></i> Efect.</button>
                            <button type="button" class="btn btn-sm btn-outline-info cobro-metodo-btn" data-metodo="2" onclick="seleccionarMetodoCobro(this,2)"><i class="bi bi-phone"></i> MP</button>
                            <button type="button" class="btn btn-sm btn-outline-primary cobro-metodo-btn" data-metodo="3" onclick="seleccionarMetodoCobro(this,3)"><i class="bi bi-bank"></i> Transf.</button>
                            <button type="button" class="btn btn-sm btn-outline-warning cobro-metodo-btn" data-metodo="4" onclick="seleccionarMetodoCobro(this,4)"><i class="bi bi-credit-card"></i> Créd.</button>
                            <button type="button" class="btn btn-sm btn-outline-warning cobro-metodo-btn" data-metodo="5" onclick="seleccionarMetodoCobro(this,5)"><i class="bi bi-credit-card-2-front"></i> Déb.</button>
                            <button type="button" class="btn btn-sm btn-outline-secondary cobro-metodo-btn" data-metodo="6" onclick="seleccionarMetodoCobro(this,6)"><i class="bi bi-journal-text"></i> CC</button>
                        </div>
                    </div>
                    <div class="mb-2">
                        <label class="form-label small mb-1">Referencia <small class="text-muted">(opcional)</small></label>
                        <input type="text" class="form-control form-control-sm" id="cobroReferencia" placeholder="Nro. operación, comprobante...">
                    </div>
                </div>
                <div class="modal-footer py-2">
                    <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancelar</button>
                    <button type="button" class="btn btn-success btn-sm" id="btnConfirmarCobro" onclick="confirmarCobro()">
                        <i class="bi bi-cash-coin"></i> Cobrar
                    </button>
                </div>
            </div>
        </div>
    </div>
'''

    if "modalCobro" not in c:
        # Insertar antes del cierre </body>
        c = c.replace('</body>', modal_html + '\n</body>')
        print("  [OK] frontend HTML: +modal cobro")
        n += 1

    # CSS para botón activo
    css_cobro = '''
    /* Cobro despachos */
    .cobro-metodo-btn.active {
        color: white !important;
        font-weight: bold;
    }
    .cobro-metodo-btn.active.btn-outline-success { background: #198754; }
    .cobro-metodo-btn.active.btn-outline-info { background: #0dcaf0; color: #000 !important; }
    .cobro-metodo-btn.active.btn-outline-primary { background: #0d6efd; }
    .cobro-metodo-btn.active.btn-outline-warning { background: #ffc107; color: #000 !important; }
    .cobro-metodo-btn.active.btn-outline-secondary { background: #6c757d; }
'''

    if "cobro-metodo-btn" not in c:
        # Insertar antes del último </style>
        last_style_pos = c.rfind('</style>')
        if last_style_pos > -1:
            c = c[:last_style_pos] + css_cobro + c[last_style_pos:]
            print("  [OK] frontend HTML: +CSS cobro")
            n += 1

    if n > 0:
        open(p, 'w').write(c)
    print("  -> gestion-despachos.html: " + str(n) + " cambios")
    return n


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════
def main():
    print("=" * 60)
    print("PATCH: Cobro en Despachos — ERP LAGO")
    print("=" * 60)

    for k, p in FILES.items():
        if not os.path.exists(p):
            print("ERROR: No se encuentra " + p)
            sys.exit(1)
    print("\nArchivos verificados OK")

    print("\nCreando backup...")
    backup()

    print("\n1/7 pagos.helper.js")
    c1 = patch_pagos_helper()

    print("\n2/7 pedidos.helper.js")
    c2 = patch_pedidos_helper()

    print("\n3/7 despachos.helper.js")
    c3 = patch_despachos_helper()

    print("\n4/7 despachos.controller.js")
    c4 = patch_despachos_controller()

    print("\n5/7 despachos.routes.js")
    c5 = patch_despachos_routes()

    print("\n6/7 gestion-despachos.js")
    c6 = patch_frontend_js()

    print("\n7/7 gestion-despachos.html")
    c7 = patch_frontend_html()

    total = c1 + c2 + c3 + c4 + c5 + c6 + c7
    print("\n" + "=" * 60)
    if total > 0:
        print("PATCH COMPLETADO — " + str(total) + " cambios en 7 archivos")
        print("\nProximos pasos:")
        print("  1. source ~/.nvm/nvm.sh && pm2 restart erplago")
        print("  2. pm2 logs erplago --lines 20")
        print("  3. Probar en gestion-despachos.html")
        print("  4. Rollback: " + BACKUP_DIR)
    else:
        print("Sin cambios — patch ya aplicado")
    print("=" * 60)


if __name__ == '__main__':
    main()
