#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 6 — QR local + Condición IVA empresa dinámica
Fecha: 2026-03-28
═══════════════════════════════════════════════════════════════

PROBLEMAS:
  - QR depende de api.qrserver.com (externo, si cae no hay QR → no cumple RG 4291)
  - "Condición frente al IVA: Responsable Inscripto" hardcodeado en impresión

FIX:
  - Genera QR localmente con librería qrcode (CDN, 4KB)
  - Condición IVA viene de la BD por empresa (configurable)

CAMBIOS:
  R1: facturas.html — agregar CDN qrcode
  R2: facturas.controller.js — agregar empresa_condicion_iva al SELECT
  R3: facturas.controller.js — agregar JOIN condicionesiva para empresa
  R4: facturas.js — imprimirFactura: QR local con QRCode.toDataURL
  R5: facturas.js — generarHTMLFacturaAFIP: firma qrDataUri
  R6: facturas.js — condición IVA dinámica
  R7: facturas.js — img QR desde data URI en vez de servicio externo

USO:
  python3 fix_facturacion_lote6.py          # Dry-run
  python3 fix_facturacion_lote6.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote6_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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
# R1: facturas.html — agregar CDN librería QR antes de facturas.js
# ═══════════════════════════════════════════════════════════════

R1_FILE = f'{ROOT}/frontend/facturas.html'

R1_OLD = """    <script src="js/auth.js"></script>
    <script src="js/facturas.js"></script>"""

R1_NEW = """    <script src="js/auth.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <script src="js/facturas.js"></script>"""

apply_fix(R1_FILE, R1_OLD, R1_NEW, 'R1',
    'facturas.html — agregar CDN qrcode antes de facturas.js')


# ═══════════════════════════════════════════════════════════════
# R2: facturas.controller.js — agregar empresa_condicion_iva al SELECT
# ═══════════════════════════════════════════════════════════════

R2_FILE = f'{ROOT}/src/controllers/facturas.controller.js'

R2_OLD = """                   e.fecha_inicio_actividades as empresa_inicio_actividades,
                   fp.nombre as forma_pago_nombre, fp.tipo as forma_pago_tipo"""

R2_NEW = """                   e.fecha_inicio_actividades as empresa_inicio_actividades,
                   cie.nombre as empresa_condicion_iva,
                   fp.nombre as forma_pago_nombre, fp.tipo as forma_pago_tipo"""

apply_fix(R2_FILE, R2_OLD, R2_NEW, 'R2',
    'facturas.controller.js — agregar empresa_condicion_iva al SELECT de obtenerPorId')


# ═══════════════════════════════════════════════════════════════
# R3: facturas.controller.js — agregar JOIN condicionesiva para empresa
# ═══════════════════════════════════════════════════════════════

R3_OLD = """            JOIN empresas e ON f.id_empresa = e.id_empresa
            LEFT JOIN formas_pago fp ON f.id_forma_pago_principal = fp.id_forma_pago"""

R3_NEW = """            JOIN empresas e ON f.id_empresa = e.id_empresa
            LEFT JOIN condicionesiva cie ON e.id_condicion_iva = cie.id_condicion_iva
            LEFT JOIN formas_pago fp ON f.id_forma_pago_principal = fp.id_forma_pago"""

apply_fix(R2_FILE, R3_OLD, R3_NEW, 'R3',
    'facturas.controller.js — agregar JOIN condicionesiva para empresa')


# ═══════════════════════════════════════════════════════════════
# R4: facturas.js — imprimirFactura: generar QR local + pasar dataUri
# ═══════════════════════════════════════════════════════════════

R4_FILE = f'{ROOT}/frontend/js/facturas.js'

R4_OLD = """\
        const qrBase64 = btoa(qrData);
        const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

        // Generar HTML de impresión
        const printWindow = window.open('', '_blank', 'width=800,height=1100');
        printWindow.document.write(generarHTMLFacturaAFIP(factura, letraTipo, qrUrl));"""

R4_NEW = """\
        const qrBase64 = btoa(qrData);
        const qrAfipUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

        // Generar QR como imagen data URI (local, sin servicio externo)
        let qrDataUri = '';
        if (typeof QRCode !== 'undefined') {
            try {
                qrDataUri = await QRCode.toDataURL(qrAfipUrl, { width: 120, margin: 1 });
            } catch(e) { console.error('Error generando QR:', e); }
        }

        // Generar HTML de impresión
        const printWindow = window.open('', '_blank', 'width=800,height=1100');
        printWindow.document.write(generarHTMLFacturaAFIP(factura, letraTipo, qrDataUri));"""

apply_fix(R4_FILE, R4_OLD, R4_NEW, 'R4',
    'facturas.js — imprimirFactura: QR local con QRCode.toDataURL')


# ═══════════════════════════════════════════════════════════════
# R5: facturas.js — generarHTMLFacturaAFIP: firma con qrDataUri
# ═══════════════════════════════════════════════════════════════

R5_OLD = """function generarHTMLFacturaAFIP(f, letra, qrUrl) {"""

R5_NEW = """function generarHTMLFacturaAFIP(f, letra, qrDataUri) {"""

apply_fix(R4_FILE, R5_OLD, R5_NEW, 'R5',
    'facturas.js — generarHTMLFacturaAFIP: firma qrDataUri')


# ═══════════════════════════════════════════════════════════════
# R6: facturas.js — Condición IVA dinámica desde empresa
# ═══════════════════════════════════════════════════════════════

R6_OLD = """            <div>Condición frente al IVA: Responsable Inscripto</div>"""

R6_NEW = """            <div>Condición frente al IVA: ${f.empresa_condicion_iva || 'Responsable Inscripto'}</div>"""

apply_fix(R4_FILE, R6_OLD, R6_NEW, 'R6',
    'facturas.js — Condición IVA dinámica desde empresa (configurable)')


# ═══════════════════════════════════════════════════════════════
# R7: facturas.js — QR image desde data URI
# ═══════════════════════════════════════════════════════════════

R7_OLD = """            <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(qrUrl)}" alt="QR AFIP">"""

R7_NEW = """            ${qrDataUri ? '<img src="' + qrDataUri + '" alt="QR AFIP" style="width:120px;height:120px;">' : '<div style="width:120px;height:120px;border:1px solid #ccc;text-align:center;font-size:8px;color:#999;padding-top:50px;">QR no disponible</div>'}"""

apply_fix(R4_FILE, R7_OLD, R7_NEW, 'R7',
    'facturas.js — QR desde data URI local (sin api.qrserver.com)')


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
    print('     1. Abrir Facturación → Historial → 🖨️ en cualquier factura')
    print('     2. Verificar que el QR aparece y es scaneable')
    print('     3. La Condición IVA debe decir lo que tiene la empresa en la BD')
    print()
