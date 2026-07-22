#!/bin/bash
# ============================================================
# DEPLOY FIX CC v2 - Helper robusto + Trigger automático
# ERP LAGO - 2026-02-16
# ============================================================
set -e
source ~/.nvm/nvm.sh

FIX_DIR="/root/mi_erp/scripts/fix-cc-files"
ERP_DIR="/root/mi_erp"

echo "============================================"
echo " ERP LAGO - Fix CC v2 (Helper + Trigger)"
echo "============================================"

# 1. Backup helper actual
echo "[1/5] Backup..."
cp "$ERP_DIR/src/utils/cc-clientes.helper.js" "$ERP_DIR/src/utils/cc-clientes.helper.js.bak.$(date +%H%M%S)"
cp "$ERP_DIR/src/controllers/cobranzas.controller.js" "$ERP_DIR/src/controllers/cobranzas.controller.js.bak.$(date +%H%M%S)"
echo "  ✅ Backups creados"

# 2. Copiar helper v2
echo "[2/5] Actualizando helper CC v2..."
cp "$FIX_DIR/cc-clientes.helper.js" "$ERP_DIR/src/utils/cc-clientes.helper.js"
echo "  ✅ cc-clientes.helper.js v2 (obtenerSaldo, recalcularSaldo, registrar, eliminar, anular)"

# 3. Copiar controller actualizado
echo "[3/5] Actualizando controller cobranzas..."
cp "$FIX_DIR/cobranzas.controller.js" "$ERP_DIR/src/controllers/cobranzas.controller.js"
echo "  ✅ cobranzas.controller.js (saldo con window function)"

# 4. Validar sintaxis
echo "[4/5] Validando sintaxis..."
node --check "$ERP_DIR/src/utils/cc-clientes.helper.js" && echo "  ✅ helper OK" || { echo "  ❌ ERROR helper"; exit 1; }
node --check "$ERP_DIR/src/controllers/cobranzas.controller.js" && echo "  ✅ controller OK" || { echo "  ❌ ERROR controller"; exit 1; }

# 5. Trigger + recalculación + restart
echo "[5/5] Creando trigger y recalculando..."
PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f "$FIX_DIR/fix-cc-trigger.sql"

pm2 restart erplago
sleep 2
pm2 status erplago

echo ""
echo "============================================"
echo " ✅ CC v2 DESPLEGADO"
echo "============================================"
echo ""
echo "AHORA FUNCIONA:"
echo "  - Saldo se calcula siempre con SUM(debe)-SUM(haber)"
echo "  - Trigger sincroniza clientes.saldo_actual automáticamente"
echo "  - Si borrás un movimiento, el saldo se ajusta solo"
echo "  - Helper tiene: anularMovimiento() y eliminarMovimiento()"
echo "  - Endpoint muestra saldo corrido calculado al vuelo"
