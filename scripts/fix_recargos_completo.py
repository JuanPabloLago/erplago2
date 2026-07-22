#!/usr/bin/env python3
"""
FIX COMPLETO: Recargos cuotas — Frontend + Comprobante
ERP LAGO — 2026-03-15

Problemas:
  A) Frontend no muestra recargo cuotas al cajero
  B) Comprobante: Subtotal $0, sin detalle cuotas
  C) Pago se registra con monto base, no final

Solución:
  1) confirmarCuota: infla visual + registra pago con monto FINAL
  2) Backend: si pago trae monto_original, usa ese como base (no recalcula)
  3) Comprobante: subtotal explícito + cuotas en pagos
"""
import re, sys

ERRORES = []

# ═══════════════════════════════════════════════════════════════
# FIX 1: FRONTEND — confirmarCuota muestra recargo y registra con monto final
# ═══════════════════════════════════════════════════════════════
ARCHIVO_VR = '/root/mi_erp/frontend/js/venta-rapida-script.js'
with open(ARCHIVO_VR, 'r') as f:
    vr = f.read()

# Buscar confirmarCuota con regex (más robusto que string exacto)
patron_cuota = r'function confirmarCuota\(idPlan, cuotas, coeficiente, montoFinal, montoOriginal, nombrePlan\) \{[^}]+\}'
match = re.search(patron_cuota, vr)
if not match:
    ERRORES.append('No encontre confirmarCuota en venta-rapida-script.js')
else:
    nueva_cuota = """function confirmarCuota(idPlan, cuotas, coeficiente, montoFinal, montoOriginal, nombrePlan) {
    // Mostrar recargo visual para el cajero
    var recargoPct = (coeficiente - 1) * 100;
    var recargoEl = document.getElementById('recargoCuotasPorcentaje');
    if (recargoEl) recargoEl.value = recargoPct.toFixed(4);
    calcularTotal();
    // Registrar pago con monto FINAL (lo que cobra el posnet)
    // Backend recibe monto_original para saber la base
    registrarPago('credito', montoFinal, {
        id_plan: idPlan,
        id_terminal: _terminalSeleccionadaId,
        cuotas: cuotas,
        coeficiente: coeficiente,
        nombre_plan: nombrePlan,
        monto_original: _terminalModalSaldo
    });
    actualizarVisualizacionPagos();
    actualizarEstadoBloqueo();
    cerrarModalTerminal();
    if (obtenerTotalPagado() >= obtenerTotalVenta()) mostrarToast('Pago completo', 'success');
}"""
    vr = vr[:match.start()] + nueva_cuota + vr[match.end():]
    print('OK 1: confirmarCuota reescrita — infla visual + pago con monto final')

with open(ARCHIVO_VR, 'w') as f:
    f.write(vr)

# ═══════════════════════════════════════════════════════════════
# FIX 2: BACKEND — si pago trae monto_original, NO recalcular
# ═══════════════════════════════════════════════════════════════
ARCHIVO_BC = '/root/mi_erp/src/controllers/borrador.controller.js'
with open(ARCHIVO_BC, 'r') as f:
    bc = f.read()

# Reemplazar el bloque de cuotas en el loop de pagos
BUSCAR_BC = """                // \u2500\u2500 CUOTAS via terminal: calcular inter\u00e9s real desde BD \u2500\u2500
                if (pago.id_plan) {
                    const calculo = await terminalesHelper.calcularInteres(
                        client, pago.id_plan, id_empresa, montoPago
                    );
                    const interes = Math.round((calculo.monto_final - calculo.monto_original) * 100) / 100;"""

REEMPLAZO_BC = """                // \u2500\u2500 CUOTAS via terminal \u2500\u2500
                if (pago.id_plan) {
                    // Si frontend ya envio monto_original, usar eso como base
                    const montoBase = pago.monto_original ? parseFloat(pago.monto_original) : montoPago;
                    const calculo = await terminalesHelper.calcularInteres(
                        client, pago.id_plan, id_empresa, montoBase
                    );
                    const interes = Math.round((calculo.monto_final - calculo.monto_original) * 100) / 100;
                    // montoPago = lo que cobra el posnet
                    montoPago = calculo.monto_final;"""

if BUSCAR_BC not in bc:
    ERRORES.append('No encontre bloque cuotas en borrador.controller.js')
else:
    bc = bc.replace(BUSCAR_BC, REEMPLAZO_BC, 1)
    print('OK 2: Backend usa monto_original como base si viene del frontend')

with open(ARCHIVO_BC, 'w') as f:
    f.write(bc)

# ═══════════════════════════════════════════════════════════════
# FIX 3: COMPROBANTE — subtotal explicito + cuotas en pagos
# ═══════════════════════════════════════════════════════════════
ARCHIVO_CV = '/root/mi_erp/src/controllers/comprobante-venta.controller.js'
with open(ARCHIVO_CV, 'r') as f:
    cv = f.read()

# Verificar que reemplazos explicitos existen
if "html.split('{{totales.subtotal}}').join" not in cv:
    ERRORES.append('Reemplazos explicitos de totales no encontrados en comprobante')
else:
    print('OK 3a: Reemplazos explicitos de totales ya existen')

# Verificar que pagos tiene cuotas
if 'cuotas > 1' in cv:
    print('OK 3b: Pagos con cuotas ya parcheado')
else:
    ERRORES.append('Pagos sin detalle de cuotas')

if ERRORES:
    print('\n=== ERRORES ===')
    for e in ERRORES:
        print(f'  - {e}')
    print('\nAlgunos fixes aplicaron, otros no. Revisar manualmente.')
else:
    print('\n=== TODOS LOS FIXES APLICADOS ===')
