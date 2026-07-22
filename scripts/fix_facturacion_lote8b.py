#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 8b — Módulo compartido factura-print.js
Fecha: 2026-03-28
═══════════════════════════════════════════════════════════════

APPROACH CORRECTO:
  1. Copiar factura-print.js a frontend/js/
  2. CDN qrcode → local en ambos HTML
  3. Agregar <script factura-print.js> en ambos HTML
  4. facturas.js: imprimirFactura → delega a FacturaPrint.imprimir
     (elimina generarHTMLFacturaAFIP duplicada)
  5. ver-factura.html: botón Imprimir → FacturaPrint.imprimir(id)

USO:
  python3 fix_facturacion_lote8b.py          # Dry-run
  python3 fix_facturacion_lote8b.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote8b_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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
        print()
        fixes_applied.append(fix_id)
        return True

    backup_file(filepath)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content.replace(old_str, new_str, 1))

    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}")
    return True


def replace_between(filepath, start_marker, end_marker, new_text, fix_id, description):
    if not os.path.exists(filepath):
        fixes_failed.append(f"[{fix_id}] ARCHIVO NO ENCONTRADO: {filepath}")
        return False
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    start_idx = content.find(start_marker)
    if start_idx == -1:
        fixes_failed.append(f"[{fix_id}] START NO ENCONTRADO")
        return False
    end_idx = content.find(end_marker, start_idx + len(start_marker))
    if end_idx == -1:
        fixes_failed.append(f"[{fix_id}] END NO ENCONTRADO")
        return False
    lines = content[start_idx:end_idx].count('\n')
    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {os.path.basename(filepath)} (~{lines} líneas reemplazadas)")
        print()
        fixes_applied.append(fix_id)
        return True
    backup_file(filepath)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content[:start_idx] + new_text + "\n\n" + content[end_idx:])
    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description} (~{lines} líneas)")
    return True


def copy_file(src, dest, fix_id, description):
    if not os.path.exists(src):
        fixes_failed.append(f"[{fix_id}] ORIGEN NO ENCONTRADO: {src}")
        return False
    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    {src} → {dest}")
        print()
        fixes_applied.append(fix_id)
        return True
    shutil.copy2(src, dest)
    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}")
    return True


FH_FILE = f'{ROOT}/frontend/facturas.html'
VF_FILE = f'{ROOT}/frontend/ver-factura.html'
FJ_FILE = f'{ROOT}/frontend/js/facturas.js'


# ═══════════════════════════════════════════════════════════════
# R0: Copiar factura-print.js al frontend
# ═══════════════════════════════════════════════════════════════

copy_file(
    f'{ROOT}/scripts/factura-print.js',
    f'{ROOT}/frontend/js/factura-print.js',
    'R0', 'Copiar factura-print.js a frontend/js/')


# ═══════════════════════════════════════════════════════════════
# R1: facturas.html — CDN → local + agregar factura-print.js
# ═══════════════════════════════════════════════════════════════

R1_OLD = """    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <script src="js/facturas.js"></script>"""

R1_NEW = """    <script src="js/qrcode.min.js"></script>
    <script src="js/factura-print.js"></script>
    <script src="js/facturas.js"></script>"""

apply_fix(FH_FILE, R1_OLD, R1_NEW, 'R1',
    'facturas.html — CDN→local + agregar factura-print.js')


# ═══════════════════════════════════════════════════════════════
# R2: ver-factura.html — CDN → local + agregar factura-print.js
# ═══════════════════════════════════════════════════════════════

R2_OLD = """    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
    <script>"""

R2_NEW = """    <script src="js/qrcode.min.js"></script>
    <script src="js/factura-print.js"></script>
    <script>"""

apply_fix(VF_FILE, R2_OLD, R2_NEW, 'R2',
    'ver-factura.html — CDN→local + agregar factura-print.js')


# ═══════════════════════════════════════════════════════════════
# R3: facturas.js — Reemplazar imprimirFactura + generarHTMLFacturaAFIP
#     por delegación a FacturaPrint (módulo compartido)
# ═══════════════════════════════════════════════════════════════

START = "async function imprimirFactura(idFactura) {"
END = "// ========================================\n// FILTROS"

NEW_CODE = """// ════════════════════════════════════════════════════
// IMPRESIÓN — Delegada a factura-print.js (módulo compartido)
// Una sola implementación AFIP-compliant con QR local
// ════════════════════════════════════════════════════
async function imprimirFactura(idFactura) {
    await FacturaPrint.imprimir(idFactura);
}

async function imprimirLoteFacturas(ids) {
    await FacturaPrint.imprimirLote(ids);
}

"""

replace_between(FJ_FILE, START, END, NEW_CODE, 'R3',
    'facturas.js — delegar a FacturaPrint + eliminar generarHTMLFacturaAFIP')


# ═══════════════════════════════════════════════════════════════
# R4: ver-factura.html — Botón Imprimir usa FacturaPrint
# ═══════════════════════════════════════════════════════════════

R4_OLD = """<button class="btn btn-outline-light btn-sm me-2" onclick="window.print()"><i class="bi bi-printer"></i> Imprimir</button>"""

R4_NEW = """<button class="btn btn-outline-light btn-sm me-2" onclick="imprimirFacturaAFIP()"><i class="bi bi-printer"></i> Imprimir AFIP</button>
                <button class="btn btn-outline-light btn-sm me-2" onclick="window.print()"><i class="bi bi-printer"></i> Vista</button>"""

apply_fix(VF_FILE, R4_OLD, R4_NEW, 'R4',
    'ver-factura.html — Navbar: botón "Imprimir AFIP" + "Vista"')


# ═══════════════════════════════════════════════════════════════
# R5: ver-factura.html — Barra acciones también usa FacturaPrint
# ═══════════════════════════════════════════════════════════════

R5_OLD = """<button class="btn btn-outline-info btn-sm me-2" onclick="window.print()">
                    <i class="bi bi-printer"></i> Imprimir
                </button>"""

R5_NEW = """<button class="btn btn-outline-info btn-sm me-2" onclick="imprimirFacturaAFIP()">
                    <i class="bi bi-printer"></i> Imprimir AFIP
                </button>
                <button class="btn btn-outline-secondary btn-sm me-2" onclick="window.print()">
                    <i class="bi bi-eye"></i> Vista
                </button>"""

apply_fix(VF_FILE, R5_OLD, R5_NEW, 'R5',
    'ver-factura.html — Barra acciones: "Imprimir AFIP" + "Vista"')


# ═══════════════════════════════════════════════════════════════
# R6: ver-factura.html — Agregar función imprimirFacturaAFIP()
# ═══════════════════════════════════════════════════════════════

R6_OLD = """    async function anularFactura() {"""

R6_NEW = """    async function imprimirFacturaAFIP() {
        const id = new URLSearchParams(window.location.search).get('id');
        if (id) await FacturaPrint.imprimir(parseInt(id));
    }

    async function anularFactura() {"""

apply_fix(VF_FILE, R6_OLD, R6_NEW, 'R6',
    'ver-factura.html — agregar función imprimirFacturaAFIP()')


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
