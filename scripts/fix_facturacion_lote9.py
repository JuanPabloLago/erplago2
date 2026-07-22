#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 9 — Ingresos Brutos + IVA Contenido Fac B
Fecha: 2026-03-28
═══════════════════════════════════════════════════════════════

R0: ALTER TABLE empresas ADD ingresos_brutos + UPDATE LAGO con CUIT
R1: configuraciones.html — campo Ingresos Brutos en form empresa
R2: config-empresa-afip.js — cargar + guardar ingresos_brutos
R3: configuraciones.controller.js — incluir ingresos_brutos en UPDATE
R4: facturas.controller.js obtenerPorId — traer empresa_ingresos_brutos
R5: factura-print.js — Nro IIBB en header + "IVA Contenido" en Fac B

USO:
  python3 fix_facturacion_lote9.py          # Dry-run
  python3 fix_facturacion_lote9.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys, os, shutil, subprocess
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote9_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
ROOT = '/root/mi_erp'

fixes_applied = []
fixes_failed = []

def backup_file(filepath):
    if DRY_RUN: return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    rel = os.path.relpath(filepath, ROOT)
    dest = os.path.join(BACKUP_DIR, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(filepath, dest)

def apply_fix(filepath, old_str, new_str, fix_id, description):
    if not os.path.exists(filepath):
        fixes_failed.append(f"[{fix_id}] ARCHIVO NO ENCONTRADO: {filepath}"); return False
    with open(filepath, 'r', encoding='utf-8') as f: content = f.read()
    count = content.count(old_str)
    if count == 0:
        fixes_failed.append(f"[{fix_id}] CADENA NO ENCONTRADA en {os.path.basename(filepath)}"); return False
    if count > 1:
        fixes_failed.append(f"[{fix_id}] CADENA AMBIGUA ({count}) en {os.path.basename(filepath)}"); return False
    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {os.path.basename(filepath)}"); print()
        fixes_applied.append(fix_id); return True
    backup_file(filepath)
    with open(filepath, 'w', encoding='utf-8') as f: f.write(content.replace(old_str, new_str, 1))
    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}"); return True

def run_sql(sql, fix_id, description):
    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    SQL: {sql[:80]}..."); print()
        fixes_applied.append(fix_id); return True
    try:
        result = subprocess.run(
            ['psql', '-h', 'localhost', '-U', 'juanpablo', '-d', 'erplago', '-c', sql],
            env={**os.environ, 'PGPASSWORD': 'Huu3697debian@'},
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            fixes_failed.append(f"[{fix_id}] SQL ERROR: {result.stderr.strip()}"); return False
        fixes_applied.append(fix_id)
        print(f"  ✅ [{fix_id}] {description}")
        print(f"    → {result.stdout.strip()}"); return True
    except Exception as e:
        fixes_failed.append(f"[{fix_id}] EXCEPCION: {e}"); return False


# ═══════════════════════════════════════════════════════════════
# R0: ALTER TABLE + UPDATE LAGO
# ═══════════════════════════════════════════════════════════════

run_sql(
    "ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ingresos_brutos VARCHAR(30);",
    'R0a', 'ALTER TABLE empresas ADD ingresos_brutos')

run_sql(
    "UPDATE empresas SET ingresos_brutos = REPLACE(cuit, '-', '') WHERE ingresos_brutos IS NULL;",
    'R0b', 'Pre-cargar IIBB = CUIT sin guiones para empresas existentes')


# ═══════════════════════════════════════════════════════════════
# R1: configuraciones.html — campo IIBB después de email
# ═══════════════════════════════════════════════════════════════

CONF_HTML = f'{ROOT}/frontend/configuraciones.html'

R1_OLD = """                    <div class="col-md-6">
                        <label class="form-label fw-bold">Email</label>
                        <input type="email" class="form-control" id="emp_email" placeholder="admin@lago.com.ar">
                    </div>
                </div>"""

R1_NEW = """                    <div class="col-md-6">
                        <label class="form-label fw-bold">Email</label>
                        <input type="email" class="form-control" id="emp_email" placeholder="admin@lago.com.ar">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label fw-bold">Nro. Ingresos Brutos</label>
                        <input type="text" class="form-control" id="emp_ingresos_brutos" placeholder="Ej: 20296284921 (obligatorio en facturas)">
                    </div>
                </div>"""

apply_fix(CONF_HTML, R1_OLD, R1_NEW, 'R1',
    'configuraciones.html — campo Ingresos Brutos en form empresa')


# ═══════════════════════════════════════════════════════════════
# R2a: config-empresa-afip.js — cargar ingresos_brutos
# ═══════════════════════════════════════════════════════════════

CONF_JS = f'{ROOT}/frontend/js/config-empresa-afip.js'

R2a_OLD = """            document.getElementById('emp_email').value = e.email || '';
            document.getElementById('emp_fecha_inicio').value = e.fecha_inicio_actividades || '';"""

R2a_NEW = """            document.getElementById('emp_email').value = e.email || '';
            document.getElementById('emp_ingresos_brutos').value = e.ingresos_brutos || '';
            document.getElementById('emp_fecha_inicio').value = e.fecha_inicio_actividades || '';"""

apply_fix(CONF_JS, R2a_OLD, R2a_NEW, 'R2a',
    'config-empresa-afip.js — cargar ingresos_brutos en form')


# ═══════════════════════════════════════════════════════════════
# R2b: config-empresa-afip.js — guardar ingresos_brutos
# ═══════════════════════════════════════════════════════════════

R2b_OLD = """                email: document.getElementById('emp_email').value.trim(),
                id_condicion_iva: parseInt(document.getElementById('emp_condicion_iva').value),"""

R2b_NEW = """                email: document.getElementById('emp_email').value.trim(),
                ingresos_brutos: document.getElementById('emp_ingresos_brutos').value.trim(),
                id_condicion_iva: parseInt(document.getElementById('emp_condicion_iva').value),"""

apply_fix(CONF_JS, R2b_OLD, R2b_NEW, 'R2b',
    'config-empresa-afip.js — guardar ingresos_brutos')


# ═══════════════════════════════════════════════════════════════
# R3: configuraciones.controller.js — incluir ingresos_brutos en UPDATE
# ═══════════════════════════════════════════════════════════════

CONF_CTRL = f'{ROOT}/src/controllers/configuraciones.controller.js'

R3a_OLD = """const { razon_social, nombre_fantasia, cuit, domicilio_fiscal, id_condicion_iva, fecha_inicio_actividades, telefono, email } = req.body;"""

R3a_NEW = """const { razon_social, nombre_fantasia, cuit, domicilio_fiscal, id_condicion_iva, fecha_inicio_actividades, telefono, email, ingresos_brutos } = req.body;"""

apply_fix(CONF_CTRL, R3a_OLD, R3a_NEW, 'R3a',
    'configuraciones.controller.js — destructuring con ingresos_brutos')

R3b_OLD = """            UPDATE empresas SET razon_social=$1, nombre_fantasia=$2, cuit=$3, domicilio_fiscal=$4,
                id_condicion_iva=$5, fecha_inicio_actividades=$6, telefono=$7, email=$8
            WHERE id_empresa=$9 RETURNING *
        `, [razon_social, nombre_fantasia||null, cuit, domicilio_fiscal, id_condicion_iva||1, fecha_inicio_actividades||null, telefono||null, email||null, id_empresa]);"""

R3b_NEW = """            UPDATE empresas SET razon_social=$1, nombre_fantasia=$2, cuit=$3, domicilio_fiscal=$4,
                id_condicion_iva=$5, fecha_inicio_actividades=$6, telefono=$7, email=$8,
                ingresos_brutos=$9
            WHERE id_empresa=$10 RETURNING *
        `, [razon_social, nombre_fantasia||null, cuit, domicilio_fiscal, id_condicion_iva||1, fecha_inicio_actividades||null, telefono||null, email||null, ingresos_brutos||null, id_empresa]);"""

apply_fix(CONF_CTRL, R3b_OLD, R3b_NEW, 'R3b',
    'configuraciones.controller.js — UPDATE con ingresos_brutos')


# ═══════════════════════════════════════════════════════════════
# R4: facturas.controller.js obtenerPorId — traer empresa_ingresos_brutos
# ═══════════════════════════════════════════════════════════════

FACT_CTRL = f'{ROOT}/src/controllers/facturas.controller.js'

R4_OLD = """                   e.fecha_inicio_actividades as empresa_inicio_actividades,
                   cie.nombre as empresa_condicion_iva,"""

R4_NEW = """                   e.fecha_inicio_actividades as empresa_inicio_actividades,
                   cie.nombre as empresa_condicion_iva,
                   e.ingresos_brutos as empresa_ingresos_brutos,"""

apply_fix(FACT_CTRL, R4_OLD, R4_NEW, 'R4',
    'facturas.controller.js — traer empresa_ingresos_brutos en obtenerPorId')


# ═══════════════════════════════════════════════════════════════
# R5: factura-print.js — Nro IIBB + IVA Contenido en Fac B
# ═══════════════════════════════════════════════════════════════

PRINT_JS = f'{ROOT}/frontend/js/factura-print.js'

# R5a: Agregar línea IIBB después de Condición IVA
R5a_OLD = """            <div>Condición frente al IVA: ${condicionIvaEmpresa}</div>"""

R5a_NEW = """            <div>Condición frente al IVA: ${condicionIvaEmpresa}</div>
            <div>IIBB Nro: ${f.empresa_ingresos_brutos || f.empresa_cuit || '-'}</div>"""

apply_fix(PRINT_JS, R5a_OLD, R5a_NEW, 'R5a',
    'factura-print.js — Nro Ingresos Brutos en header emisor')

# R5b: IVA Contenido en Factura B (RG 5614/2024)
R5b_OLD = """            <div style="font-size:9px;color:#666;">* IVA incluido en los importes</div>"""

R5b_NEW = """            <div style="font-size:9px;color:#666;">* IVA incluido en los importes</div>
            <div style="font-size:9px;color:#333;margin-top:2px;">IVA Contenido: $\${_fm(f.total_iva || 0)} — Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</div>"""

apply_fix(PRINT_JS, R5b_OLD, R5b_NEW, 'R5b',
    'factura-print.js — IVA Contenido en Factura B (RG 5614/2024)')


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
    print('     1. Configuraciones → Datos Empresa → campo IIBB visible')
    print('     2. Guardar → verificar que se persiste')
    print('     3. Imprimir factura → IIBB aparece + IVA Contenido en Fac B')
    print()
