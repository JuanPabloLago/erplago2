#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 5 — Buscar por número de factura
Fecha: 2026-03-26
═══════════════════════════════════════════════════════════════

PROBLEMA: El buscador del tab masivo solo busca por cliente, CUIT,
          id_pedido y total. No busca por número de factura ni nro_pedido.

FIX: Agregar f.numero_completo, f.numero_factura y p.nro_pedido
     al filtro de búsqueda.

CAMBIOS EN: ventas-consulta.controller.js (1 reemplazo)

USO:
  python3 fix_facturacion_lote5.py          # Dry-run
  python3 fix_facturacion_lote5.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote5_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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


FILE = f'{ROOT}/src/controllers/ventas-consulta.controller.js'

# ═══════════════════════════════════════════════════════════════
# R1: Agregar numero_factura y nro_pedido al filtro de búsqueda
# ═══════════════════════════════════════════════════════════════

R1_OLD = """if (q) { query += ` AND (LOWER(c.razon_social) LIKE $${paramIndex} OR LOWER(c.cuit_cuil) LIKE $${paramIndex} OR CAST(p.id_pedido AS TEXT) LIKE $${paramIndex} OR CAST(p.total_final AS TEXT) LIKE $${paramIndex})`; params.push(`%${q.toLowerCase()}%`); paramIndex++; }"""

R1_NEW = """if (q) { query += ` AND (LOWER(c.razon_social) LIKE $${paramIndex} OR LOWER(c.cuit_cuil) LIKE $${paramIndex} OR CAST(p.id_pedido AS TEXT) LIKE $${paramIndex} OR CAST(p.nro_pedido AS TEXT) LIKE $${paramIndex} OR CAST(p.total_final AS TEXT) LIKE $${paramIndex} OR LOWER(COALESCE(f.numero_completo,'')) LIKE $${paramIndex} OR CAST(COALESCE(f.numero_factura,0) AS TEXT) LIKE $${paramIndex})`; params.push(`%${q.toLowerCase()}%`); paramIndex++; }"""

apply_fix(FILE, R1_OLD, R1_NEW, 'R1',
    'Agregar f.numero_completo, f.numero_factura y p.nro_pedido al buscador')


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
    print('  🧪 Probar: buscar "279" o "0006-00000279" en tab masivo')
    print()
