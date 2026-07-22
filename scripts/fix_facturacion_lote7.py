#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 7 — Column error + QR en ver-factura
Fecha: 2026-03-28
═══════════════════════════════════════════════════════════════

PROBLEMAS:
  1. facturarDesdePedido usa p.descuento_porcentaje (NO EXISTE)
     → columna real es p.descuento_general
  2. ver-factura.html no tiene QR AFIP en la impresión
  3. facturarDesdePedido no pasa descuento_fp ni precio_unitario_final

CAMBIOS:
  R1: ventas-consulta.controller.js — fix column name
  R2: ventas-consulta.controller.js — descuentos FP + items mejorados
  R3: ver-factura.html — agregar CDN qrcode
  R4: ver-factura.html — agregar QR + condición IVA empresa en render

USO:
  python3 fix_facturacion_lote7.py          # Dry-run
  python3 fix_facturacion_lote7.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote7_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
ROOT = '/root/mi_erp'

fixes_applied = []
fixes_failed = []

def backup_file(filepath):
    if DRY_RUN:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    rel = os.path.relpath(filepath, ROOT)
    dest = os.path.join(BACKUP_DIR, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(filepath, dest)

def apply_fix(filepath, old_str, new_str, fix_id, description):
    if not os.path.exists(filepath):
        fixes_failed.append(f"[{fix_id}] ARCHIVO NO ENCONTRADO: {filepath}")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    count = content.count(old_str)
    if count == 0:
        fixes_failed.append(f"[{fix_id}] CADENA NO ENCONTRADA en {os.path.basename(filepath)}")
        return False
    if count > 1:
        fixes_failed.append(f"[{fix_id}] CADENA AMBIGUA ({count} coincidencias) en {os.path.basename(filepath)}")
        return False

    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {os.path.basename(filepath)}")
        print(f"    Coincidencias: {count}")
        print()
        fixes_applied.append(fix_id)
        return True

    backup_file(filepath)
    new_content = content.replace(old_str, new_str, 1)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}")
    return True


# ═══════════════════════════════════════════════════════════════
# R1: Fix columna inexistente p.descuento_porcentaje
# ═══════════════════════════════════════════════════════════════

VC_FILE = f'{ROOT}/src/controllers/ventas-consulta.controller.js'

R1_OLD = """SELECT p.*, c.id_cliente, c.razon_social, c.cuit_cuil, c.id_condicion_iva, p.descuento_porcentaje as descuento_general FROM pedidos p LEFT JOIN clientes c ON p.id_cliente = c.id_cliente WHERE p.id_pedido = $1 AND p.id_empresa = $2"""

R1_NEW = """SELECT p.*, c.id_cliente, c.razon_social, c.cuit_cuil, c.id_condicion_iva FROM pedidos p LEFT JOIN clientes c ON p.id_cliente = c.id_cliente WHERE p.id_pedido = $1 AND p.id_empresa = $2"""

apply_fix(VC_FILE, R1_OLD, R1_NEW, 'R1',
    'ventas-consulta — fix p.descuento_porcentaje (no existe) → p.descuento_general ya viene de p.*')


# ═══════════════════════════════════════════════════════════════
# R2: Agregar descuentos FP + items con precio_unitario_final
# ═══════════════════════════════════════════════════════════════

R2_OLD = """            items: items.map(item => ({ id_producto: item.id_producto, cantidad: item.cantidad, descripcion: item.descripcion_congelada || item.producto_nombre, precio_unitario: item.precio_unitario_congelado, porcentaje_iva: item.iva_aplicado || 21 }))
        }, { calcularTotales: false, totalesExternos: { subtotal, total_iva: totalIva, total } });"""

R2_NEW = """            descuento_fp_porcentaje: parseFloat(pedido.descuento_fp_porcentaje || 0),
            descuento_fp_monto: parseFloat(pedido.descuento_fp_monto || 0),
            id_forma_pago_principal: pedido.id_forma_pago_principal,
            items: items.map(item => ({ id_producto: item.id_producto, cantidad: item.cantidad, descripcion: item.descripcion_congelada || item.producto_nombre, precio_unitario: item.precio_unitario_final || item.precio_unitario_congelado, porcentaje_iva: item.iva_aplicado || 21, precio_lista: item.precio_unitario_congelado, descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0) }))
        }, { calcularTotales: false, totalesExternos: { subtotal, total_iva: totalIva, total } });"""

apply_fix(VC_FILE, R2_OLD, R2_NEW, 'R2',
    'facturarDesdePedido — agregar descuento_fp + precio_unitario_final + precio_lista')


# ═══════════════════════════════════════════════════════════════
# R3: ver-factura.html — agregar CDN qrcode
# ═══════════════════════════════════════════════════════════════

VF_FILE = f'{ROOT}/frontend/ver-factura.html'

R3_OLD = """    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>"""

R3_NEW = """    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <script>"""

apply_fix(VF_FILE, R3_OLD, R3_NEW, 'R3',
    'ver-factura.html — agregar CDN qrcode')


# ═══════════════════════════════════════════════════════════════
# R4: ver-factura.html — QR AFIP + condicion IVA en AFIP box
# Reemplazar el afip-box actual por uno con QR generado localmente
# ═══════════════════════════════════════════════════════════════

R4_OLD = """        // ══════════ AFIP INFO ══════════
        if (f.cae) {
            html += `<div class="afip-box mb-3">
                <div class="row align-items-center">
                    <div class="col-auto"><i class="bi bi-shield-check" style="font-size:1.8rem;color:#856404;"></i></div>
                    <div class="col">
                        <strong>AFIP - Autorización Electrónica</strong><br>
                        <span class="dato-label">CAE:</span> <span class="fw-bold">${esc(f.cae)}</span>
                        ${f.cae_vencimiento ? ` &nbsp;|&nbsp; <span class="dato-label">Vto. CAE:</span> <span class="fw-bold">${fd(f.cae_vencimiento)}</span>` : ''}
                    </div>
                </div>
            </div>`;
        }"""

R4_NEW = """        // ══════════ AFIP INFO + QR (Lote 7 fix) ══════════
        if (f.cae) {
            // Generar QR AFIP según RG 4291/2018
            const esA = f.id_tipo_factura === 1 || (f.tipo_factura || '').toUpperCase().includes('A');
            const qrPayload = JSON.stringify({
                ver: 1,
                fecha: f.fecha_emision?.split('T')[0] || '',
                cuit: (f.empresa_cuit || '').replace(/[-\\s]/g, ''),
                ptoVta: f.punto_venta,
                tipoCmp: esA ? 1 : 6,
                nroCmp: f.numero_factura,
                importe: parseFloat(f.total),
                moneda: 'PES',
                ctz: 1,
                tipoDocRec: f.cuit_cuil?.length >= 11 ? 80 : 96,
                nroDocRec: parseInt((f.cuit_cuil || '0').replace(/[^0-9]/g, '')),
                tipoCodAut: 'E',
                codAut: parseInt(f.cae || '0')
            });
            const qrAfipUrl = 'https://www.afip.gob.ar/fe/qr/?p=' + btoa(qrPayload);

            html += `<div class="afip-box mb-3">
                <div class="row align-items-center">
                    <div class="col-auto"><i class="bi bi-shield-check" style="font-size:1.8rem;color:#856404;"></i></div>
                    <div class="col">
                        <strong>AFIP - Autorización Electrónica</strong><br>
                        <span class="dato-label">CAE:</span> <span class="fw-bold">${esc(f.cae)}</span>
                        ${f.cae_vencimiento ? ` &nbsp;|&nbsp; <span class="dato-label">Vto. CAE:</span> <span class="fw-bold">${fd(f.cae_vencimiento)}</span>` : ''}
                        ${f.empresa_condicion_iva ? `<br><span class="dato-label">Condición IVA Emisor:</span> <span class="fw-bold">${esc(f.empresa_condicion_iva)}</span>` : ''}
                    </div>
                    <div class="col-auto" id="qrContainer" style="min-width:130px;text-align:center;">
                        <div class="text-muted" style="font-size:0.7rem;">Generando QR...</div>
                    </div>
                </div>
            </div>`;

            // Generar QR async después del render
            setTimeout(async () => {
                const container = document.getElementById('qrContainer');
                if (container && typeof QRCode !== 'undefined') {
                    try {
                        const dataUri = await QRCode.toDataURL(qrAfipUrl, { width: 120, margin: 1 });
                        container.innerHTML = '<img src="' + dataUri + '" alt="QR AFIP" style="width:120px;height:120px;"><div style="font-size:0.65rem;color:#856404;margin-top:2px;">Escanear para verificar</div>';
                    } catch(e) {
                        container.innerHTML = '<div style="font-size:0.7rem;color:#999;">QR no disponible</div>';
                    }
                }
            }, 100);
        }"""

apply_fix(VF_FILE, R4_OLD, R4_NEW, 'R4',
    'ver-factura.html — QR AFIP local + condición IVA empresa dinámica')


# ═══════════════════════════════════════════════════════════════
# RESUMEN
# ═══════════════════════════════════════════════════════════════

print()
print('═' * 60)
if DRY_RUN:
    print('  MODO DRY-RUN — No se aplicó ningún cambio')
    print('  Ejecutar con --apply para aplicar')
else:
    print(f'  BACKUP: {BACKUP_DIR}')
print('═' * 60)
print(f'  ✅ Fixes verificados: {len(fixes_applied)}/{len(fixes_applied) + len(fixes_failed)}')
if fixes_applied:
    print(f'     Aplicados: {", ".join(fixes_applied)}')
if fixes_failed:
    print(f'  ❌ Fallaron: {len(fixes_failed)}')
    for f in fixes_failed:
        print(f'     {f}')
print('═' * 60)

if not DRY_RUN and fixes_applied:
    print()
    print('  ⚡ Reiniciar servidor:')
    print('     source ~/.nvm/nvm.sh && pm2 restart erplago')
    print()
    print('  🧪 Probar:')
    print('     1. Facturar pedido individual (botón ✅) → ya no explota')
    print('     2. ver-factura.html → QR visible + scaneable + condición IVA')
    print('     3. Ctrl+P desde ver-factura → QR se imprime')
    print()
