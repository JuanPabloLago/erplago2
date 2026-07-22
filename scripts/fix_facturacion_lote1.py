#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 1 — ERP LAGO
Fecha: 2026-03-26
Fixes: C1, C4, C6, I4, I5
═══════════════════════════════════════════════════════════════
USO:
  python3 fix_facturacion_lote1.py          # Modo dry-run (solo muestra)
  python3 fix_facturacion_lote1.py --apply   # Aplica los cambios
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
ROOT = '/root/mi_erp'

fixes_applied = []
fixes_failed = []

def backup_file(filepath):
    """Crea backup del archivo antes de modificar"""
    if DRY_RUN:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    rel = os.path.relpath(filepath, ROOT)
    dest = os.path.join(BACKUP_DIR, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(filepath, dest)

def apply_fix(filepath, old_str, new_str, fix_id, description):
    """Aplica un reemplazo exacto en un archivo"""
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
# C1: crear() sin verificarNoFacturado → facturas AFIP duplicadas
# Archivo: facturas.controller.js
# Ubicación: después de resolver PV, ANTES de sync AFIP
# ═══════════════════════════════════════════════════════════════

C1_FILE = f'{ROOT}/src/controllers/facturas.controller.js'

C1_OLD = """\
        // --- Sync secuencia con AFIP antes de obtener número ---
        await afipService.cargarConfiguracion(pool, id_empresa);"""

C1_NEW = """\
        // --- Verificar que el pedido no tenga factura activa (C1 fix) ---
        if (id_pedido) {
            await facturacionHelper.verificarNoFacturado(client, {
                id_pedido,
                id_empresa
            });
        }

        // --- Sync secuencia con AFIP antes de obtener número ---
        await afipService.cargarConfiguracion(pool, id_empresa);"""

apply_fix(C1_FILE, C1_OLD, C1_NEW, 'C1',
    'crear() — Agregar verificarNoFacturado antes de solicitar CAE a AFIP')


# ═══════════════════════════════════════════════════════════════
# C4: documento-actions.js IP hardcodeada
# Archivo: frontend/js/documento-actions.js
# ═══════════════════════════════════════════════════════════════

C4_FILE = f'{ROOT}/frontend/js/documento-actions.js'

C4_OLD = """    const API_URL = 'http://72.60.148.18:3000/api';"""

C4_NEW = """    const API_URL = window.CONFIG?.API_BASE_URL || '/api';"""

apply_fix(C4_FILE, C4_OLD, C4_NEW, 'C4',
    'documento-actions.js — Reemplazar IP hardcodeada por window.CONFIG')


# ═══════════════════════════════════════════════════════════════
# C6: print-worker.js incluye pagos anulados en comprobante
# Archivo: src/services/print-worker.js
# ═══════════════════════════════════════════════════════════════

C6_FILE = f'{ROOT}/src/services/print-worker.js'

C6_OLD = """\
    const pagosResult = await pool.query(`
        SELECT 
            pa.monto,
            mp.nombre as metodo
        FROM pagos pa
        JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago
        WHERE pa.id_pedido = $1
    `, [idPedido]);"""

C6_NEW = """\
    // C6 fix: excluir pagos anulados (id_estado=3)
    const pagosResult = await pool.query(`
        SELECT 
            pa.monto,
            mp.nombre as metodo
        FROM pagos pa
        JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago
        WHERE pa.id_pedido = $1
          AND pa.id_estado != 3
    `, [idPedido]);"""

apply_fix(C6_FILE, C6_OLD, C6_NEW, 'C6',
    'print-worker.js — Excluir pagos anulados del comprobante impreso')


# ═══════════════════════════════════════════════════════════════
# I4: mostrarToast argumentos invertidos en facturas.js
# Archivo: frontend/js/facturas.js
# Hay 3 llamadas con (mensaje, tipo) que deben ser (tipo, mensaje)
# ═══════════════════════════════════════════════════════════════

I4_FILE = f'{ROOT}/frontend/js/facturas.js'

# Fix I4a: línea ~932
I4a_OLD = """        mostrarToast(exitosos + ' pago(s) confirmado(s) correctamente', 'success');"""
I4a_NEW = """        mostrarToast('success', exitosos + ' pago(s) confirmado(s) correctamente');"""

apply_fix(I4_FILE, I4a_OLD, I4a_NEW, 'I4a',
    'facturas.js — Corregir orden argumentos mostrarToast (confirmar éxito)')

# Fix I4b: línea ~934
I4b_OLD = """        mostrarToast(exitosos + ' confirmado(s), ' + errores.length + ' con error', 'warning');"""
I4b_NEW = """        mostrarToast('warning', exitosos + ' confirmado(s), ' + errores.length + ' con error');"""

apply_fix(I4_FILE, I4b_OLD, I4b_NEW, 'I4b',
    'facturas.js — Corregir orden argumentos mostrarToast (confirmar warning)')

# Fix I4c: línea ~937
I4c_OLD = """        mostrarToast('Error al confirmar: ' + (errores[0] ? errores[0].error : 'desconocido'), 'danger');"""
I4c_NEW = """        mostrarToast('danger', 'Error al confirmar: ' + (errores[0] ? errores[0].error : 'desconocido'));"""

apply_fix(I4_FILE, I4c_OLD, I4c_NEW, 'I4c',
    'facturas.js — Corregir orden argumentos mostrarToast (confirmar error)')


# ═══════════════════════════════════════════════════════════════
# I5: Badge "parcial" faltante en renderBadgeEstadoFactura
# Archivo: frontend/js/facturas.js
# ═══════════════════════════════════════════════════════════════

I5_OLD = """\
    const map = {
        'emitida': 'success', 'anulada': 'danger', 'pagada': 'primary'
    };"""

I5_NEW = """\
    const map = {
        'emitida': 'success', 'anulada': 'danger', 'pagada': 'primary', 'parcial': 'info'
    };"""

apply_fix(I4_FILE, I5_OLD, I5_NEW, 'I5',
    'facturas.js — Agregar estado "parcial" al mapa de badges del historial')


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
