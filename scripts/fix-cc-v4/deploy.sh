#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
# DEPLOY: Cuenta Corriente v4 - Fix cards, búsqueda, REF, Excel
# ERP LAGO - 2026-02-16
# ══════════════════════════════════════════════════════════════════════

set -e
FECHA=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/backups/cc_v4_${FECHA}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "══════════════════════════════════════════════════════════════════"
echo "DEPLOY Cuenta Corriente v4"
echo "══════════════════════════════════════════════════════════════════"
echo ""

# ── 1. Backup ──
echo "1. Creando backup en ${BACKUP_DIR}..."
mkdir -p "${BACKUP_DIR}"
cp /root/mi_erp/src/controllers/cobranzas.controller.js "${BACKUP_DIR}/"
cp /root/mi_erp/src/routes/cobranzas.routes.js "${BACKUP_DIR}/"
cp /root/mi_erp/frontend/cuenta-corriente.html "${BACKUP_DIR}/"
echo "   ✅ Backup completo"
echo ""

# ── 2. Instalar exceljs si no está ──
echo "2. Verificando exceljs..."
cd /root/mi_erp
source ~/.nvm/nvm.sh
if ! node -e "require('exceljs')" 2>/dev/null; then
    echo "   Instalando exceljs..."
    npm install exceljs --save 2>&1 | tail -3
    echo "   ✅ exceljs instalado"
else
    echo "   ✅ exceljs ya disponible"
fi
echo ""

# ── 3. Copiar archivos ──
echo "3. Copiando archivos..."
cp "${SCRIPT_DIR}/cobranzas.controller.js" /root/mi_erp/src/controllers/cobranzas.controller.js
cp "${SCRIPT_DIR}/cobranzas.routes.js" /root/mi_erp/src/routes/cobranzas.routes.js
cp "${SCRIPT_DIR}/cuenta-corriente.html" /root/mi_erp/frontend/cuenta-corriente.html
echo "   ✅ 3 archivos copiados"
echo ""

# ── 4. Validar sintaxis ──
echo "4. Validando sintaxis..."
node --check /root/mi_erp/src/controllers/cobranzas.controller.js && echo "   ✅ cobranzas.controller.js OK" || { echo "   ❌ Error de sintaxis en controller"; exit 1; }
node --check /root/mi_erp/src/routes/cobranzas.routes.js && echo "   ✅ cobranzas.routes.js OK" || { echo "   ❌ Error de sintaxis en routes"; exit 1; }
echo ""

# ── 5. Verificar que ruta esté registrada en index.js ──
echo "5. Verificando registro en index.js..."
if grep -q "cobranzas" /root/mi_erp/src/routes/index.js; then
    echo "   ✅ Ruta cobranzas ya registrada"
else
    echo "   ⚠️  Ruta cobranzas NO encontrada en index.js"
    echo "   Agregando..."
    # Buscar una línea de require para agregar después
    LAST_REQUIRE=$(grep -n "require(" /root/mi_erp/src/routes/index.js | tail -1 | cut -d: -f1)
    LAST_USE=$(grep -n "router.use(" /root/mi_erp/src/routes/index.js | tail -1 | cut -d: -f1)
    sed -i "${LAST_REQUIRE}a const cobranzasRoutes = require('./cobranzas.routes');" /root/mi_erp/src/routes/index.js
    sed -i "${LAST_USE}a router.use('/cobranzas', cobranzasRoutes);" /root/mi_erp/src/routes/index.js
    echo "   ✅ Ruta agregada"
fi
echo ""

# ── 6. Restart PM2 ──
echo "6. Reiniciando PM2..."
pm2 restart erplago 2>&1 | tail -5
sleep 2
echo ""

# ── 7. Verificar que arrancó ──
echo "7. Verificando..."
pm2 logs erplago --lines 5 --nostream 2>&1
echo ""

echo "══════════════════════════════════════════════════════════════════"
echo "✅ DEPLOY COMPLETADO"
echo ""
echo "Cambios:"
echo "  • Cards: Deuda Actual | Total Compras | Total Pagado | Facturado AFIP"
echo "  • Columna REF eliminada — iconos de compra/pago en concepto"
echo "  • Búsqueda de clientes robusta (cache + manejo de errores)"
echo "  • Exportar ahora descarga .xlsx (Excel real)"
echo "  • Concepto formateado: Recibo #156 en vez de Recibo 00000156"
echo ""
echo "Backup en: ${BACKUP_DIR}"
echo "══════════════════════════════════════════════════════════════════"
