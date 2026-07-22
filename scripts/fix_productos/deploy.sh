#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# DEPLOY: Fix módulo Productos — 7 bugs
# ERP LAGO — 2026-03-25
# ═══════════════════════════════════════════════════════════════════
#
# BUGS CORREGIDOS:
#   1. Frontend no envía url_imagen → se pierde al editar
#   2. abrirModalNuevo no limpia precioCompraNeto
#   3. ajustePrecioMasivo no pasa id_empresa → UPDATE 0 filas (¡precios NO cambian!)
#   4. actualizarProducto pisa url_imagen/cod_proveedor con null
#   5. inicializarInventario sin ON CONFLICT → falla en re-creación
#   6. obtenerPorId filtra activo=TRUE → no se puede ver/editar desactivados
#   7. DELETE conjunto_items sin id_empresa → borra conjuntos de TODAS las empresas
#
# USO: bash /root/mi_erp/fix_productos/deploy.sh
# ═══════════════════════════════════════════════════════════════════

set -e
cd /root/mi_erp

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/mi_erp/backups/pre_fix_productos_${TS}"
DB_PASS='Huu3697debian@'
DB_USER='juanpablo'
DB_NAME='erplago'

echo "═══════════════════════════════════════════════════════════════════"
echo "  FIX MÓDULO PRODUCTOS — 7 BUGS"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════
# PASO 1: BACKUP
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 1: Backup..."
mkdir -p "$BACKUP_DIR"

# Archivos que se van a modificar
cp src/utils/productos.helper.js "$BACKUP_DIR/"
cp src/controllers/productos.controller.js "$BACKUP_DIR/"
cp frontend/js/productos.js "$BACKUP_DIR/"

# Dump de tablas afectadas
PGPASSWORD="$DB_PASS" pg_dump -h localhost -U "$DB_USER" -d "$DB_NAME" \
  -t configuraciones_empresa -t conjunto_items -t inventario \
  --data-only -f "$BACKUP_DIR/tablas_afectadas.sql" 2>/dev/null

echo "  ✅ Backup en: $BACKUP_DIR"
ls -la "$BACKUP_DIR"

# ═══════════════════════════════════════════════════════════════════
# PASO 2: MIGRACIÓN SQL
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 2: Migración SQL..."
PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d "$DB_NAME" \
  -f "$SCRIPT_DIR/01_migracion.sql" 2>&1 | grep -E "INSERT|NOTICE|ERROR"
echo "  ✅ Migración SQL completada"

# ═══════════════════════════════════════════════════════════════════
# PASO 3: PARCHES BACKEND
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 3: Parcheando helper..."
python3 "$SCRIPT_DIR/02_patch_helper.py"

echo ""
echo "▶ PASO 4: Parcheando controller..."
python3 "$SCRIPT_DIR/03_patch_controller.py"

# ═══════════════════════════════════════════════════════════════════
# PASO 4: PARCHE FRONTEND
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 5: Parcheando frontend..."
python3 "$SCRIPT_DIR/04_patch_frontend.py"

# ═══════════════════════════════════════════════════════════════════
# PASO 5: REINICIAR
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 6: Reiniciando servidor..."
source ~/.nvm/nvm.sh
pm2 restart erplago --update-env
sleep 2

# Verificar que arrancó
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'])" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
    echo "  ✅ Servidor online"
else
    echo "  ❌ ALERTA: Estado del servidor: $PM2_STATUS"
    echo "  Revisá logs: pm2 logs erplago --lines 20"
fi

# ═══════════════════════════════════════════════════════════════════
# PASO 6: VERIFICACIÓN
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 7: Verificación post-deploy..."

# Verificar que los parches se aplicaron
echo ""
echo "  Verificando parches en código:"

# BUG 4: COALESCE url_imagen
if grep -q "COALESCE(\$9, url_imagen)" src/utils/productos.helper.js; then
    echo "    ✅ BUG 4: COALESCE url_imagen OK"
else
    echo "    ❌ BUG 4: COALESCE url_imagen NO ENCONTRADO"
fi

# BUG 5: ON CONFLICT inventario
if grep -q "ON CONFLICT (id_empresa, id_producto) DO NOTHING" src/utils/productos.helper.js; then
    echo "    ✅ BUG 5: ON CONFLICT inventario OK"
else
    echo "    ❌ BUG 5: ON CONFLICT inventario NO ENCONTRADO"
fi

# BUG 7: id_empresa en DELETE conjunto_items
if grep -q "AND id_empresa = \$2', \[id_producto, id_empresa\]" src/utils/productos.helper.js; then
    echo "    ✅ BUG 7: id_empresa en DELETE conjuntos OK"
else
    echo "    ❌ BUG 7: id_empresa en DELETE conjuntos NO ENCONTRADO"
fi

# BUG 3: id_empresa en ajusteMasivo
if grep -q "id_empresa, id_producto, id_lista_precio" src/controllers/productos.controller.js; then
    echo "    ✅ BUG 3: id_empresa en ajusteMasivo OK"
else
    echo "    ❌ BUG 3: id_empresa en ajusteMasivo NO ENCONTRADO"
fi

# BUG 6: sin activo=TRUE en obtenerPorId
if grep -q "WHERE p.id_producto = \$2 AND p.activo = TRUE" src/controllers/productos.controller.js; then
    echo "    ❌ BUG 6: filtro activo=TRUE todavía presente"
else
    echo "    ✅ BUG 6: filtro activo removido OK"
fi

# BUG 1: productoEditando en frontend
if grep -q "Estado.productoEditando" frontend/js/productos.js; then
    echo "    ✅ BUG 1: productoEditando en frontend OK"
else
    echo "    ❌ BUG 1: productoEditando NO ENCONTRADO"
fi

# Configs nuevas
echo ""
echo "  Verificando configs:"
PGPASSWORD="$DB_PASS" psql -h localhost -U "$DB_USER" -d "$DB_NAME" -t -c \
  "SELECT '    ✅ ' || clave || ' = ' || valor FROM configuraciones_empresa WHERE clave LIKE 'productos.%' AND id_empresa = 1;"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  DEPLOY COMPLETADO"
echo "  Backup: $BACKUP_DIR"
echo ""
echo "  TESTS MANUALES RECOMENDADOS:"
echo "    1. Editar un producto → verificar que la imagen NO se pierde"
echo "    2. Ajuste masivo de precios → verificar que los precios SÍ cambian"
echo "    3. Editar producto con conjuntos → verificar que no se borran de otra empresa"
echo "    4. Crear producto nuevo → verificar que funciona sin errores"
echo "    5. Ver producto desactivado por ID → debe ser visible"
echo "═══════════════════════════════════════════════════════════════════"
