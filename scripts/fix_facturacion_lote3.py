#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 3 — C5 (Multi-empresa print-worker)
Fecha: 2026-03-26
═══════════════════════════════════════════════════════════════

C5: print-worker.js queries sin filtro id_empresa
    La tabla print_jobs YA tiene id_empresa (NOT NULL + FK + índice).
    El INSERT en print.controller.js YA lo graba.
    Solo falta que obtenerDatosComprobante() lo use.

CAMBIOS EN: src/services/print-worker.js (4 reemplazos)
  R1: Firma función + query pedidos → agregar idEmpresa + filtro
  R2: Query items → agregar filtro id_empresa
  R3: Query pagos → agregar filtro id_empresa
  R4: Call site → pasar job.id_empresa

USO:
  python3 fix_facturacion_lote3.py          # Dry-run
  python3 fix_facturacion_lote3.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote3_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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


FILE = f'{ROOT}/src/services/print-worker.js'


# ═══════════════════════════════════════════════════════════════
# R1: Firma + query pedidos — agregar idEmpresa + filtro
# ═══════════════════════════════════════════════════════════════

R1_OLD = """\
async function obtenerDatosComprobante(idPedido) {
    // Pedido + Cliente
    const pedidoResult = await pool.query(`
        SELECT 
            p.*,
            c.razon_social as cliente_razon_social,
            c.cuit_cuil as cliente_cuit,
            c.domicilio as cliente_domicilio,
            c.telefono as cliente_telefono,
            c.email as cliente_email,
            e.nombre as estado_nombre
        FROM pedidos p
        JOIN clientes c ON c.id_cliente = p.id_cliente
        JOIN pedidoestados e ON e.id_estado = p.id_estado
        WHERE p.id_pedido = $1
    `, [idPedido]);"""

R1_NEW = """\
async function obtenerDatosComprobante(idPedido, idEmpresa) {
    // Pedido + Cliente (C5 fix: filtro multi-empresa)
    const pedidoResult = await pool.query(`
        SELECT 
            p.*,
            c.razon_social as cliente_razon_social,
            c.cuit_cuil as cliente_cuit,
            c.domicilio as cliente_domicilio,
            c.telefono as cliente_telefono,
            c.email as cliente_email,
            e.nombre as estado_nombre
        FROM pedidos p
        JOIN clientes c ON c.id_cliente = p.id_cliente
        JOIN pedidoestados e ON e.id_estado = p.id_estado
        WHERE p.id_pedido = $1 AND p.id_empresa = $2
    `, [idPedido, idEmpresa]);"""

apply_fix(FILE, R1_OLD, R1_NEW, 'R1',
    'Firma obtenerDatosComprobante + query pedidos con id_empresa')


# ═══════════════════════════════════════════════════════════════
# R2: Query items — agregar filtro id_empresa
# ═══════════════════════════════════════════════════════════════

R2_OLD = """\
    const itemsResult = await pool.query(`
        SELECT 
            pi.*,
            pr.sku,
            pr.nombre as producto_nombre
        FROM pedidoitems pi
        JOIN productos pr ON pr.id_producto = pi.id_producto
        WHERE pi.id_pedido = $1
        ORDER BY pi.id_item
    `, [idPedido]);"""

R2_NEW = """\
    // C5 fix: filtro multi-empresa
    const itemsResult = await pool.query(`
        SELECT 
            pi.*,
            pr.sku,
            pr.nombre as producto_nombre
        FROM pedidoitems pi
        JOIN productos pr ON pr.id_producto = pi.id_producto
        WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
        ORDER BY pi.id_item
    `, [idPedido, idEmpresa]);"""

apply_fix(FILE, R2_OLD, R2_NEW, 'R2',
    'Query items con filtro id_empresa')


# ═══════════════════════════════════════════════════════════════
# R3: Query pagos — agregar filtro id_empresa
# NOTA: ya tiene C6 fix (AND pa.id_estado != 3)
# ═══════════════════════════════════════════════════════════════

R3_OLD = """\
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

R3_NEW = """\
    // C5+C6 fix: filtro multi-empresa + excluir pagos anulados
    const pagosResult = await pool.query(`
        SELECT 
            pa.monto,
            mp.nombre as metodo
        FROM pagos pa
        JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago
        WHERE pa.id_pedido = $1
          AND pa.id_empresa = $2
          AND pa.id_estado != 3
    `, [idPedido, idEmpresa]);"""

apply_fix(FILE, R3_OLD, R3_NEW, 'R3',
    'Query pagos con filtro id_empresa (preserva C6)')


# ═══════════════════════════════════════════════════════════════
# R4: Call site — pasar job.id_empresa
# ═══════════════════════════════════════════════════════════════

R4_OLD = """\
        if (job.document_type === 'comprobante_venta') {
            data = await obtenerDatosComprobante(job.document_id);
        } else {"""

R4_NEW = """\
        if (job.document_type === 'comprobante_venta') {
            data = await obtenerDatosComprobante(job.document_id, job.id_empresa);
        } else {"""

apply_fix(FILE, R4_OLD, R4_NEW, 'R4',
    'Call site — pasar job.id_empresa a obtenerDatosComprobante')


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
