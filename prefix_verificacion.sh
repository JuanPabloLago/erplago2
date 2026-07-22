#!/bin/bash
# ============================================================================
# PRE-FIX: Verificar estado de tablas antes de corregir
# Ejecutar desde /root/mi_erp
# ============================================================================

OUTPUT="/root/mi_erp/scripts_mantenimiento/resultados/PREFIX_ESTADO_$(date +%Y%m%d_%H%M).md"
mkdir -p "$(dirname "$OUTPUT")"

PGCMD="PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -A"

{
echo "# PRE-FIX: Estado de tablas para corrección multi-empresa"
echo "## $(date '+%Y-%m-%d %H:%M')"
echo ""

# ============================================================================
echo "---"
echo "## 1. TABLAS DE ITEMS — ¿Tienen columna id_empresa?"
echo ""
echo '```'
eval $PGCMD << 'EOSQL'
SELECT 
    t.table_name,
    CASE WHEN c.column_name IS NOT NULL THEN 'SI' ELSE '** NO **' END as tiene_id_empresa
FROM (VALUES 
    ('ajuste_inventario_items'),
    ('orden_compra_items'),
    ('recepcion_items'),
    ('comprobante_compra_items'),
    ('remito_items'),
    ('pago_proveedor_items'),
    ('imputacion_pagos_proveedor'),
    ('borrador_items_log'),
    ('presupuesto_items'),
    ('recibo_facturas'),
    ('conjunto_items'),
    ('usuarios_logs'),
    ('permisos_usuario'),
    ('usuario_configuracion'),
    ('conjuntos'),
    ('cotizaciones'),
    ('producto_proveedor'),
    ('rol_modulos')
) AS t(table_name)
LEFT JOIN information_schema.columns c 
    ON c.table_name = t.table_name 
    AND c.column_name = 'id_empresa'
    AND c.table_schema = 'public'
ORDER BY tiene_id_empresa DESC, t.table_name;
EOSQL
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 2. CONSTRAINTS ON CONFLICT que podrían necesitar cambio"
echo ""
echo '```'
eval $PGCMD << 'EOSQL'
SELECT 
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name IN (
    'ajuste_inventario_items',
    'conjunto_items',
    'producto_proveedor',
    'rol_modulos',
    'permisos_usuario',
    'usuario_configuracion',
    'cotizaciones'
)
AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
ORDER BY tc.table_name, tc.constraint_type;
EOSQL
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 3. verificarRol — ¿Llama a verificarToken internamente?"
echo ""
echo '```'
echo "=== auth.middleware.js: función verificarRol ==="
sed -n '/verificarRol/,/^}/p' src/middleware/auth.middleware.js 2>/dev/null
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 4. usuarios.routes.js — ¿Tiene router.use(verificarToken) global?"
echo ""
echo '```'
head -25 src/routes/usuarios.routes.js 2>/dev/null
echo ""
echo "=== ¿Hay router.use antes de las rutas? ==="
grep -n "router.use" src/routes/usuarios.routes.js 2>/dev/null || echo "(ningún router.use encontrado)"
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 5. html-access.middleware.js — Query y cache completos"
echo ""
echo '```'
echo "=== Función cargarCacheModulos completa ==="
sed -n '/async function cargarCacheModulos/,/^}/p' src/middleware/html-access.middleware.js 2>/dev/null
echo ""
echo "=== Función invalidarCacheHTML ==="
sed -n '/function invalidarCacheHTML/,/^}/p' src/middleware/html-access.middleware.js 2>/dev/null
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 6. modulos.helper.js — Funciones COMPLETAS a modificar"
echo ""

echo "### guardarModulosRol (completa)"
echo '```javascript'
sed -n '/async function guardarModulosRol/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

echo "### clonarPermisosRol (completa)"
echo '```javascript'
sed -n '/async function clonarPermisosRol/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

echo "### obtenerMatrizPermisos (completa)"
echo '```javascript'
sed -n '/async function obtenerMatrizPermisos/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

echo "### obtenerModulosRol (completa)"
echo '```javascript'
sed -n '/async function obtenerModulosRol/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

echo "### obtenerModulosDeRol (completa)"
echo '```javascript'
sed -n '/async function obtenerModulosDeRol/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

echo "### Cache functions"
echo '```javascript'
sed -n '/function obtenerDesdeCache/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo ""
sed -n '/function guardarEnCache/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo ""
sed -n '/function invalidarCacheRol/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo ""
sed -n '/function invalidarTodoElCache/,/^}/p' src/utils/modulos.helper.js 2>/dev/null
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 7. modulos-admin.controller.js — Consumidor principal"
echo ""
echo '```javascript'
cat src/controllers/modulos-admin.controller.js 2>/dev/null
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 8. admin.helper.js — Funciones a modificar"
echo ""
echo "### registrarLog"
echo '```javascript'
sed -n '/async function registrarLog\|function registrarLog/,/^}/p' src/utils/admin.helper.js 2>/dev/null
echo '```'
echo ""
echo "### togglePermiso"
echo '```javascript'
sed -n '/async function togglePermiso\|function togglePermiso/,/^}/p' src/utils/admin.helper.js 2>/dev/null
echo '```'
echo ""
echo "### upsertConfigUsuario"
echo '```javascript'
sed -n '/async function upsertConfigUsuario\|function upsertConfigUsuario/,/^}/p' src/utils/admin.helper.js 2>/dev/null
echo '```'
echo ""

echo "---"
echo "## 9. compras.helper.js línea 241 — producto_proveedor ON CONFLICT"
echo ""
echo '```javascript'
sed -n '235,260p' src/utils/compras.helper.js 2>/dev/null
echo '```'

echo ""
echo "---"
echo "**Pegar este resultado en Claude para recibir los scripts de corrección exactos.**"

} > "$OUTPUT"

echo ""
echo "============================================"
echo "  PRE-FIX COMPLETADO"
echo "  Resultado en: $OUTPUT"
echo "============================================"
echo ""
cat "$OUTPUT" | wc -l
echo " líneas generadas"
echo ""
echo "Ejecuta: cat $OUTPUT"
