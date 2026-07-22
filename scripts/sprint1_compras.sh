#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# SPRINT 1 — FIXES CRÍTICOS MÓDULO COMPRAS/PROVEEDORES
# ERP LAGO — 2026-03-26
#
# CAMBIOS:
#   SQL: Fix FK zombie, agregar configs, columna activo, columna id_comprobante
#   JS:  Fix id_empresa en helper + controller, fix cuit_cuil, fix queries sin empresa
#
# EJECUTAR: bash /tmp/sprint1_compras.sh
# ═══════════════════════════════════════════════════════════════════════
set -e

export PGPASSWORD='Huu3697debian@'
DB="-h localhost -U juanpablo -d erplago"
ERP="/root/mi_erp"
BACKUP_DIR="/root/mi_erp/backups/pre_sprint1_compras_$(date +%Y%m%d_%H%M%S)"

echo "═══════════════════════════════════════════════════════════════"
echo "FASE 0: BACKUP"
echo "═══════════════════════════════════════════════════════════════"
mkdir -p "$BACKUP_DIR"
cp "$ERP/src/utils/pagos-proveedores.helper.js" "$BACKUP_DIR/"
cp "$ERP/src/utils/compras.helper.js" "$BACKUP_DIR/"
cp "$ERP/src/controllers/pagos-proveedores.controller.js" "$BACKUP_DIR/"
pg_dump $DB -Fc -f "$BACKUP_DIR/erplago_pre_sprint1.dump" 2>/dev/null
echo "✅ Backup en: $BACKUP_DIR"
ls -la "$BACKUP_DIR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 1: MIGRACIÓN SQL"
echo "═══════════════════════════════════════════════════════════════"

psql $DB << 'EOSQL'
-- ═══════════════════════════════════════════════════════════════
-- SPRINT 1 — MIGRACIÓN BD
-- ═══════════════════════════════════════════════════════════════
BEGIN;

-- 1.1 Fix FK zombie: pagosaproveedores → ordenes_compra (tabla activa)
ALTER TABLE pagosaproveedores
  DROP CONSTRAINT IF EXISTS pagosaproveedores_id_orden_compra_fkey;

ALTER TABLE pagosaproveedores
  ADD CONSTRAINT pagosaproveedores_id_orden_compra_fkey
  FOREIGN KEY (id_orden_compra) REFERENCES ordenes_compra(id_orden) ON DELETE SET NULL;

-- 1.2 Agregar columna activo a comprobante_compra_tipos
ALTER TABLE comprobante_compra_tipos
  ADD COLUMN IF NOT EXISTS activo boolean DEFAULT true;

-- 1.3 Agregar vínculo comprobante → pago directo
ALTER TABLE pagosaproveedores
  ADD COLUMN IF NOT EXISTS id_comprobante integer;

-- Solo agregar FK si la columna se creó (no falla si ya existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pagosaproveedores_id_comprobante_fkey'
  ) THEN
    ALTER TABLE pagosaproveedores
      ADD CONSTRAINT pagosaproveedores_id_comprobante_fkey
      FOREIGN KEY (id_comprobante) REFERENCES comprobantes_compra(id_comprobante) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pagosprov_comprobante
  ON pagosaproveedores(id_comprobante) WHERE id_comprobante IS NOT NULL;

-- 1.4 Configuraciones del módulo compras
INSERT INTO configuracion_sistema (clave, valor, descripcion, id_empresa)
VALUES
  ('compras_afecta_stock_default', 'true', 'Los comprobantes de compra afectan stock por defecto', 1),
  ('compras_actualizar_precios_default', 'true', 'Actualizar precios proveedor al cargar comprobante', 1),
  ('compras_pago_obligatorio', 'false', 'Requiere registrar forma de pago al confirmar comprobante', 1),
  ('compras_deposito_default', '1', 'Depósito por defecto para recepción de mercadería', 1)
ON CONFLICT (clave, id_empresa) DO NOTHING;

COMMIT;

-- Verificar
SELECT '✅ FK pagosaproveedores:' as check, conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c
WHERE c.conrelid = (SELECT oid FROM pg_class WHERE relname = 'pagosaproveedores')
  AND conname LIKE '%orden_compra%';

SELECT '✅ Columna activo:' as check, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'comprobante_compra_tipos' AND column_name = 'activo';

SELECT '✅ Columna id_comprobante:' as check, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'pagosaproveedores' AND column_name = 'id_comprobante';

SELECT '✅ Configs compras:' as check, clave, valor
FROM configuracion_sistema
WHERE clave LIKE 'compras_%' ORDER BY clave;
EOSQL

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 2: FIX pagos-proveedores.helper.js (BUG id_empresa)"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'EOPY'
import re

filepath = '/root/mi_erp/src/utils/pagos-proveedores.helper.js'
with open(filepath, 'r') as f:
    content = f.read()

original = content

# ── FIX 1: insertarPagoItem — agregar id_empresa al destructuring ──
old_destructure = """    const {
        id_pago, id_forma_pago, id_moneda, monto,
        id_banco, numero_referencia, fecha_acreditacion,
        id_cheque_propio, id_cheque_tercero, observaciones
    } = datos;"""

new_destructure = """    const {
        id_empresa, id_pago, id_forma_pago, id_moneda, monto,
        id_banco, numero_referencia, fecha_acreditacion,
        id_cheque_propio, id_cheque_tercero, observaciones
    } = datos;

    if (!id_empresa) throw new Error('pagos-proveedores.helper.insertarPagoItem: id_empresa obligatorio');"""

if old_destructure in content:
    content = content.replace(old_destructure, new_destructure)
    print("✅ FIX 1: id_empresa agregado a insertarPagoItem destructuring")
else:
    print("⚠️  FIX 1: Patrón no encontrado en insertarPagoItem — verificar manualmente")

# ── FIX 2: crearImputacion — agregar validación id_empresa ──
old_imputacion = """async function crearImputacion(client, datos) {
    const { id_empresa, id_pago, id_cuenta, monto_imputado } = datos;
    await client.query("""

new_imputacion = """async function crearImputacion(client, datos) {
    const { id_empresa, id_pago, id_cuenta, monto_imputado } = datos;
    if (!id_empresa) throw new Error('pagos-proveedores.helper.crearImputacion: id_empresa obligatorio');
    await client.query("""

if old_imputacion in content:
    content = content.replace(old_imputacion, new_imputacion)
    print("✅ FIX 2: Validación id_empresa agregada a crearImputacion")
else:
    print("⚠️  FIX 2: Patrón no encontrado en crearImputacion — verificar manualmente")

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"✅ Archivo guardado: {filepath}")
else:
    print("⚠️  No se hicieron cambios al archivo")
EOPY

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 3: FIX pagos-proveedores.controller.js (llamadas + queries)"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'EOPY'
filepath = '/root/mi_erp/src/controllers/pagos-proveedores.controller.js'
with open(filepath, 'r') as f:
    content = f.read()

original = content
fixes = 0

# ── FIX 3: insertarPagoItem call — agregar id_empresa ──
old_call = """await pagosHelper.insertarPagoItem(client, {
                id_pago, id_forma_pago: fp.id_forma_pago, id_moneda: fp.id_moneda, monto: fp.monto,
                id_banco: fp.id_banco, numero_referencia: fp.referencia, fecha_acreditacion: fp.fecha_acreditacion,
                id_cheque_propio: idChequePropio, id_cheque_tercero: idChequeTercero, observaciones: fp.observaciones
            });"""

new_call = """await pagosHelper.insertarPagoItem(client, {
                id_empresa, id_pago, id_forma_pago: fp.id_forma_pago, id_moneda: fp.id_moneda, monto: fp.monto,
                id_banco: fp.id_banco, numero_referencia: fp.referencia, fecha_acreditacion: fp.fecha_acreditacion,
                id_cheque_propio: idChequePropio, id_cheque_tercero: idChequeTercero, observaciones: fp.observaciones
            });"""

if old_call in content:
    content = content.replace(old_call, new_call)
    fixes += 1
    print("✅ FIX 3: id_empresa agregado a llamada insertarPagoItem")
else:
    print("⚠️  FIX 3: Patrón insertarPagoItem no encontrado")

# ── FIX 4: crearImputacion call — agregar id_empresa ──
old_imput = """await pagosHelper.crearImputacion(client, { id_pago, id_cuenta: factura.id_cuenta, monto_imputado: factura.monto_a_pagar });"""
new_imput = """await pagosHelper.crearImputacion(client, { id_empresa, id_pago, id_cuenta: factura.id_cuenta, monto_imputado: factura.monto_a_pagar });"""

if old_imput in content:
    content = content.replace(old_imput, new_imput)
    fixes += 1
    print("✅ FIX 4: id_empresa agregado a llamada crearImputacion")
else:
    print("⚠️  FIX 4: Patrón crearImputacion no encontrado")

# ── FIX 5: Query CxP en registrarPago — agregar filtro id_empresa ──
old_cxp_q = """const { rows: cuentaRows } = await client.query(`SELECT cpp.saldo, cpp.id_comprobante FROM cuentas_por_pagar cpp WHERE cpp.id_cuenta = $1`, [factura.id_cuenta]);"""
new_cxp_q = """const { rows: cuentaRows } = await client.query(`SELECT cpp.saldo, cpp.id_comprobante FROM cuentas_por_pagar cpp WHERE cpp.id_cuenta = $1 AND cpp.id_empresa = $2`, [factura.id_cuenta, id_empresa]);"""

if old_cxp_q in content:
    content = content.replace(old_cxp_q, new_cxp_q)
    fixes += 1
    print("✅ FIX 5: id_empresa agregado a query CxP en registrarPago")
else:
    print("⚠️  FIX 5: Patrón query CxP registrarPago no encontrado")

# ── FIX 6: Query imputaciones en anularPago — agregar filtro id_empresa ──
old_imput_q = """const { rows: imputaciones } = await client.query(`SELECT * FROM imputacion_pagos_proveedor WHERE id_pago = $1`, [id]);"""
new_imput_q = """const { rows: imputaciones } = await client.query(`SELECT * FROM imputacion_pagos_proveedor WHERE id_pago = $1 AND id_empresa = $2`, [id, id_empresa]);"""

if old_imput_q in content:
    content = content.replace(old_imput_q, new_imput_q)
    fixes += 1
    print("✅ FIX 6: id_empresa agregado a query imputaciones en anularPago")
else:
    print("⚠️  FIX 6: Patrón query imputaciones anularPago no encontrado")

# ── FIX 7: Query CxP en anularPago — agregar filtro id_empresa ──
old_cxp_anul = """const { rows: cuentaRows } = await client.query(`SELECT id_comprobante FROM cuentas_por_pagar WHERE id_cuenta = $1`, [imp.id_cuenta]);"""
new_cxp_anul = """const { rows: cuentaRows } = await client.query(`SELECT id_comprobante FROM cuentas_por_pagar WHERE id_cuenta = $1 AND id_empresa = $2`, [imp.id_cuenta, id_empresa]);"""

if old_cxp_anul in content:
    content = content.replace(old_cxp_anul, new_cxp_anul)
    fixes += 1
    print("✅ FIX 7: id_empresa agregado a query CxP en anularPago")
else:
    print("⚠️  FIX 7: Patrón query CxP anularPago no encontrado")

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"✅ {fixes} fixes aplicados a: {filepath}")
else:
    print("⚠️  No se hicieron cambios al archivo")
EOPY

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 4: FIX compras.helper.js (cuit_cuil → cuit)"
echo "═══════════════════════════════════════════════════════════════"

python3 << 'EOPY'
filepath = '/root/mi_erp/src/utils/compras.helper.js'
with open(filepath, 'r') as f:
    content = f.read()

original = content

# ── FIX 8: cuit_cuil → cuit ──
occurrences = content.count('p.cuit_cuil')
if occurrences > 0:
    content = content.replace('p.cuit_cuil', 'p.cuit')
    print(f"✅ FIX 8: Reemplazado {occurrences} ocurrencia(s) de p.cuit_cuil → p.cuit")
else:
    print("⚠️  FIX 8: No se encontró p.cuit_cuil — puede que ya esté corregido")

if content != original:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f"✅ Archivo guardado: {filepath}")
else:
    print("⚠️  No se hicieron cambios al archivo")
EOPY

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 5: RESTART PM2"
echo "═══════════════════════════════════════════════════════════════"

source ~/.nvm/nvm.sh
pm2 restart erplago
sleep 2
pm2 logs erplago --lines 5 --nostream

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "FASE 6: VERIFICACIÓN"
echo "═══════════════════════════════════════════════════════════════"

echo ""
echo "—— 6.1 Verificar id_empresa en insertarPagoItem:"
grep -n "id_empresa" "$ERP/src/utils/pagos-proveedores.helper.js" | head -10

echo ""
echo "—— 6.2 Verificar llamadas con id_empresa en controller:"
grep -n "id_empresa" "$ERP/src/controllers/pagos-proveedores.controller.js" | grep -E "insertarPagoItem|crearImputacion|id_cuenta.*id_empresa"

echo ""
echo "—— 6.3 Verificar cuit en compras.helper.js (NO debe decir cuit_cuil):"
grep -n "cuit" "$ERP/src/utils/compras.helper.js" | grep -v "node_modules" | head -10

echo ""
echo "—— 6.4 Verificar FK apunta a ordenes_compra (NO ordenesdecompra):"
psql $DB -c "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conrelid = (SELECT oid FROM pg_class WHERE relname='pagosaproveedores') AND conname LIKE '%orden%';"

echo ""
echo "—— 6.5 Verificar configs cargadas:"
psql $DB -c "SELECT clave, valor FROM configuracion_sistema WHERE clave LIKE 'compras_%';"

echo ""
echo "—— 6.6 Test rápido con curl — form-data pagos proveedores:"
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"juan","password":"jp191082"}' | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

if [ -n "$TOKEN" ]; then
  echo "Token obtenido ✅"
  curl -s http://localhost:3000/api/pagos-proveedores/form-data \
    -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    fp = data['data']['formasPago']
    print(f'✅ Formas de pago: {len(fp)} activas')
    for f in fp:
        print(f'   {f[\"id_forma_pago\"]}: {f[\"nombre\"]} ({f[\"tipo\"]}) activo={f[\"activo\"]}')
else:
    print('❌ Error:', data)
"
else
  echo "❌ No se pudo obtener token"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "SPRINT 1 COMPLETADO"
echo "═══════════════════════════════════════════════════════════════"
echo "Backup: $BACKUP_DIR"
echo ""
echo "Resumen de cambios:"
echo "  SQL: FK corregido, 4 configs, columna activo, columna id_comprobante"
echo "  pagos-proveedores.helper.js: id_empresa en insertarPagoItem + validación crearImputacion"
echo "  pagos-proveedores.controller.js: id_empresa en 5 lugares (2 calls + 3 queries)"
echo "  compras.helper.js: cuit_cuil → cuit"
echo ""
echo "Para RESTAURAR si algo falla:"
echo "  cp $BACKUP_DIR/pagos-proveedores.helper.js $ERP/src/utils/"
echo "  cp $BACKUP_DIR/compras.helper.js $ERP/src/utils/"
echo "  cp $BACKUP_DIR/pagos-proveedores.controller.js $ERP/src/controllers/"
echo "  pg_restore -h localhost -U juanpablo -d erplago -c $BACKUP_DIR/erplago_pre_sprint1.dump"
echo "  source ~/.nvm/nvm.sh && pm2 restart erplago"
