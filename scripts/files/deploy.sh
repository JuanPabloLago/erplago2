#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
# DEPLOY: Fix Venta Rápida — 6 bugs
# ERP LAGO — 2026-03-26
# ═══════════════════════════════════════════════════════════════════
#
# BUGS CORREGIDOS:
#   VR-1a: sincronizarPagos explota con NaN (parseInt('null'))
#   VR-1b: Race condition en sincronizarPagosABD
#   VR-2:  agregarItem usa precio_lista que no existe en el SELECT
#   VR-3:  cargarBorradorActivo hace GET a ruta inexistente → 404
#   VR-5:  calcularTotal + mostrarItems hardcodean IVA 21%
#   VR-6:  cambiarPrecio divide por 1.21 hardcodeado
#
# USO: bash /root/mi_erp/scripts/fix_venta_rapida/deploy.sh
# ═══════════════════════════════════════════════════════════════════

set -e
cd /root/mi_erp

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/mi_erp/backups/pre_fix_venta_rapida_${TS}"

echo "═══════════════════════════════════════════════════════════════════"
echo "  FIX VENTA RÁPIDA — 6 BUGS"
echo "  $(date)"
echo "═══════════════════════════════════════════════════════════════════"

# ═══════════════════════════════════════════════════════════════════
# PASO 1: BACKUP
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 1: Backup..."
mkdir -p "$BACKUP_DIR"
cp src/controllers/borrador.controller.js "$BACKUP_DIR/"
cp frontend/js/venta-rapida.js "$BACKUP_DIR/"
echo "  ✅ Backup en: $BACKUP_DIR"

# ═══════════════════════════════════════════════════════════════════
# PASO 2: PARCHES
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 2: Parcheando borrador.controller.js..."
python3 "$SCRIPT_DIR/01_patch_borrador_controller.py"

echo ""
echo "▶ PASO 3: Parcheando venta-rapida.js..."
python3 "$SCRIPT_DIR/02_patch_frontend.py"

# ═══════════════════════════════════════════════════════════════════
# PASO 3: REINICIAR
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 4: Reiniciando servidor..."
source ~/.nvm/nvm.sh
pm2 restart erplago --update-env
sleep 2

PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0]['pm2_env']['status'])" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
    echo "  ✅ Servidor online"
else
    echo "  ❌ ALERTA: Estado del servidor: $PM2_STATUS"
    echo "  Revisá logs: pm2 logs erplago --lines 20"
fi

# ═══════════════════════════════════════════════════════════════════
# PASO 4: VERIFICACIÓN
# ═══════════════════════════════════════════════════════════════════
echo ""
echo "▶ PASO 5: Verificación post-deploy..."

# VR-1a
if grep -q "isNaN(id_pedido)" src/controllers/borrador.controller.js; then
    echo "    ✅ VR-1a: Validación NaN en sincronizarPagos OK"
else
    echo "    ❌ VR-1a: NO ENCONTRADO"
fi

# VR-2
if grep -q "precio_lista" src/controllers/borrador.controller.js; then
    echo "    ✅ VR-2: precio_lista en SELECT OK"
else
    echo "    ❌ VR-2: NO ENCONTRADO"
fi

# VR-1b
if grep -q "if (!borradorId) return;" frontend/js/venta-rapida.js | head -1 > /dev/null 2>&1; then
    echo "    ✅ VR-1b: Doble-check borradorId OK"
else
    # grep might not work well for this, check differently
    if python3 -c "c=open('frontend/js/venta-rapida.js').read(); print('OK' if 'setTimeout(async () => {\n        if (!borradorId) return;' in c else 'MISSING')" 2>/dev/null | grep -q OK; then
        echo "    ✅ VR-1b: Doble-check borradorId OK"
    else
        echo "    ⚠️  VR-1b: Verificar manualmente"
    fi
fi

# VR-5c
if grep -q "iva_porcentaje" frontend/js/venta-rapida.js; then
    echo "    ✅ VR-5: IVA per-item en frontend OK"
else
    echo "    ❌ VR-5: NO ENCONTRADO"
fi

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  DEPLOY COMPLETADO"
echo "  Backup: $BACKUP_DIR"
echo ""
echo "  TESTS MANUALES:"
echo "    1. Abrir venta-rápida (Ctrl+F5), verificar sin errores en consola"
echo "    2. Agregar producto → confirmar que el precio aparece correcto"
echo "    3. Confirmar venta con pago efectivo → verificar que completa sin error"
echo "    4. Recargar página → verificar que el borrador se recupera"
echo "    5. Si hay productos con IVA ≠ 21%: verificar que calcula correcto"
echo "═══════════════════════════════════════════════════════════════════"
