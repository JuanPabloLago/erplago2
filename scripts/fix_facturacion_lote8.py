#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 8 — Unificar impresión + fix individual + limpiar código muerto
Fecha: 2026-03-28
═══════════════════════════════════════════════════════════════

PROBLEMAS:
  1. facturarDesdePedido requiere id_tipo_factura (frontend manda vacío)
  2. facturarDesdePedido items query sin id_empresa
  3. 3 vías de impresión inconsistentes
  4. generarHTMLFacturaAFIP() queda muerta tras unificar
  5. factura_electronica.hbs nadie la usa

FIX:
  R1+R1b: Auto-determinar tipo factura (RI→A, resto→B)
  R2: Items query con id_empresa
  R3: imprimirFactura → ver-factura.html + eliminar generarHTMLFacturaAFIP
  R4: Borrar factura_electronica.hbs

USO:
  python3 fix_facturacion_lote8.py          # Dry-run
  python3 fix_facturacion_lote8.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote8_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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


def replace_between(filepath, start_marker, end_marker, new_text, fix_id, description):
    """Reemplaza todo desde start_marker hasta justo antes de end_marker"""
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

    old_text = content[start_idx:end_idx]
    lines_removed = old_text.count('\n')

    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {os.path.basename(filepath)}")
        print(f"    Eliminando ~{lines_removed} líneas")
        print()
        fixes_applied.append(fix_id)
        return True

    backup_file(filepath)
    new_content = content[:start_idx] + new_text + "\n\n" + content[end_idx:]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description} (~{lines_removed} líneas eliminadas)")
    return True


def delete_file(filepath, fix_id, description):
    """Mueve archivo a backup y lo elimina"""
    if not os.path.exists(filepath):
        fixes_failed.append(f"[{fix_id}] ARCHIVO NO ENCONTRADO: {filepath}")
        return False

    if DRY_RUN:
        size = os.path.getsize(filepath)
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {filepath} ({size} bytes → backup + eliminar)")
        print()
        fixes_applied.append(fix_id)
        return True

    backup_file(filepath)
    os.remove(filepath)

    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}")
    return True


VC_FILE = f'{ROOT}/src/controllers/ventas-consulta.controller.js'
FJ_FILE = f'{ROOT}/frontend/js/facturas.js'


# ═══════════════════════════════════════════════════════════════
# R1: Auto-determinar id_tipo_factura si no viene en body
# ═══════════════════════════════════════════════════════════════

R1_OLD = """const { id_empresa } = req.usuario; const { id_pedido } = req.params; const { id_tipo_factura, observaciones = '' } = req.body;"""

R1_NEW = """const { id_empresa } = req.usuario; const { id_pedido } = req.params; const { id_tipo_factura: body_tipo_factura, observaciones = '' } = req.body;"""

apply_fix(VC_FILE, R1_OLD, R1_NEW, 'R1',
    'facturarDesdePedido — renombrar id_tipo_factura del body')


# ═══════════════════════════════════════════════════════════════
# R1b: Agregar auto-determinación después de cargar pedido
# ═══════════════════════════════════════════════════════════════

R1b_OLD = """        await facturacionHelper.verificarNoFacturado(client, { id_pedido: parseInt(id_pedido), id_empresa });"""

R1b_NEW = """        // Auto-determinar tipo factura: RI→A, Mono/CF/Exento→B (como masivo)
        const id_tipo_factura = body_tipo_factura || (pedido.id_condicion_iva === 1 ? 1 : 2);

        await facturacionHelper.verificarNoFacturado(client, { id_pedido: parseInt(id_pedido), id_empresa });"""

apply_fix(VC_FILE, R1b_OLD, R1b_NEW, 'R1b',
    'facturarDesdePedido — auto-determinar tipo factura (RI→A, resto→B)')


# ═══════════════════════════════════════════════════════════════
# R2: Items query con id_empresa
# ═══════════════════════════════════════════════════════════════

R2_OLD = """const itemsQuery = await client.query(`SELECT pi.*, pr.nombre AS producto_nombre, pr.sku FROM pedidoitems pi LEFT JOIN productos pr ON pi.id_producto = pr.id_producto WHERE pi.id_pedido = $1`, [id_pedido]);"""

R2_NEW = """const itemsQuery = await client.query(`SELECT pi.*, pr.nombre AS producto_nombre, pr.sku FROM pedidoitems pi LEFT JOIN productos pr ON pi.id_producto = pr.id_producto WHERE pi.id_pedido = $1 AND pi.id_empresa = $2 ORDER BY pi.id_item`, [id_pedido, id_empresa]);"""

apply_fix(VC_FILE, R2_OLD, R2_NEW, 'R2',
    'facturarDesdePedido — items query con id_empresa')


# ═══════════════════════════════════════════════════════════════
# R3: Eliminar imprimirFactura + imprimirLoteFacturas + generarHTMLFacturaAFIP
#     Reemplazar por redirect a ver-factura.html
#     Rango: desde "async function imprimirFactura" hasta "// FILTROS RÁPIDOS"
# ═══════════════════════════════════════════════════════════════

START = "async function imprimirFactura(idFactura) {"
END = "// ========================================\n// FILTROS"

NEW_CODE = """// ════════════════════════════════════════════════════
// IMPRESIÓN UNIFICADA — Todo va a ver-factura.html
// Una sola vía: QR local, condición IVA dinámica, layout AFIP completo
// (Lote 8: eliminado generarHTMLFacturaAFIP — ~170 líneas de código muerto)
// ════════════════════════════════════════════════════
async function imprimirFactura(idFactura) {
    window.open('ver-factura.html?id=' + idFactura, '_blank');
}

async function imprimirLoteFacturas(ids) {
    for (const id of ids) {
        window.open('ver-factura.html?id=' + id, '_blank');
        await new Promise(r => setTimeout(r, 300));
    }
}

"""

replace_between(FJ_FILE, START, END, NEW_CODE, 'R3',
    'facturas.js — unificar impresión + eliminar generarHTMLFacturaAFIP')


# ═══════════════════════════════════════════════════════════════
# R4: Borrar factura_electronica.hbs (nadie la importa)
# ═══════════════════════════════════════════════════════════════

delete_file(f'{ROOT}/templates/comprobantes/factura_electronica.hbs', 'R4',
    'Eliminar factura_electronica.hbs (código muerto, 0 importadores)')


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
