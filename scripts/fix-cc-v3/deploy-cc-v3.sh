#!/bin/bash
# ════════════════════════════════════════════════════════════════════════════════
# DEPLOY CC v3 COMPLETO - ERP LAGO
# 2026-02-16
#
# QUÉ HACE:
# 1. Backup de todo lo que toca
# 2. Instala helper CC v3 (registrarVentaConPago, esConsumidorFinal, etc.)
# 3. Patchea 5 controllers para DEBE+HABER automático
# 4. Actualiza cobranzas controller + routes (endpoint con filtros)
# 5. Reemplaza cuenta-corriente.html (frontend completo)
# 6. Ejecuta SQL: trigger auto-sync + recalculación + drop vista rota
# 7. Reinicia PM2
#
# EJECUTAR: bash /root/mi_erp/scripts/deploy-cc-v3.sh
# ════════════════════════════════════════════════════════════════════════════════

set -e
source ~/.nvm/nvm.sh

FECHA=$(date +%Y%m%d_%H%M%S)
ERP_DIR="/root/mi_erp"
FIX_DIR="/root/mi_erp/scripts/fix-cc-v3"
BACKUP_DIR="/root/backups/cc_v3_${FECHA}"

echo "════════════════════════════════════════════════"
echo " ERP LAGO - Deploy CC v3 Completo"
echo " ${FECHA}"
echo "════════════════════════════════════════════════"

# ── Verificar que existan los archivos ──
echo ""
echo "[0/7] Verificando archivos..."
REQUIRED_FILES=(
    "$FIX_DIR/cc-clientes.helper.js"
    "$FIX_DIR/patch-controllers-cc.py"
    "$FIX_DIR/cobranzas.controller.js"
    "$FIX_DIR/cobranzas.routes.js"
    "$FIX_DIR/cuenta-corriente.html"
    "$FIX_DIR/fix-cc-trigger.sql"
)
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        echo "  ❌ FALTA: $f"
        echo "  Copiar todos los archivos a $FIX_DIR antes de ejecutar"
        exit 1
    fi
done
echo "  ✅ Todos los archivos presentes"

# ════════════════════════════════════════════════════════════════════
# PASO 1: BACKUP
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[1/7] Creando backup en $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"

# Helper
cp "$ERP_DIR/src/utils/cc-clientes.helper.js" "$BACKUP_DIR/" 2>/dev/null || echo "  (helper no existía)"

# Controllers que se patchean
for ctrl in borrador.controller.js pedidos.controller.js pagos-confirmacion.controller.js pagos-confirmacion.controller.v2.js cobranzas.controller.js; do
    cp "$ERP_DIR/src/controllers/$ctrl" "$BACKUP_DIR/" 2>/dev/null || echo "  ($ctrl no existía)"
done

# Routes
cp "$ERP_DIR/src/routes/cobranzas.routes.js" "$BACKUP_DIR/" 2>/dev/null || echo "  (cobranzas.routes no existía)"

# Frontend
cp "$ERP_DIR/frontend/cuenta-corriente.html" "$BACKUP_DIR/"

# BD
PGPASSWORD='Huu3697debian@' pg_dump -h localhost -U juanpablo erplago \
    -t cuentacorrienteclientes --data-only \
    > "$BACKUP_DIR/cc_data_backup.sql" 2>/dev/null

echo "  ✅ Backup completo"

# ════════════════════════════════════════════════════════════════════
# PASO 2: HELPER CC v3
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[2/7] Instalando helper CC v3..."
cp "$FIX_DIR/cc-clientes.helper.js" "$ERP_DIR/src/utils/cc-clientes.helper.js"
node --check "$ERP_DIR/src/utils/cc-clientes.helper.js" && echo "  ✅ cc-clientes.helper.js v3" || { echo "  ❌ ERROR sintaxis helper"; exit 1; }

# ════════════════════════════════════════════════════════════════════
# PASO 3: PATCHEAR 5 CONTROLLERS
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[3/7] Patcheando controllers..."
python3 "$FIX_DIR/patch-controllers-cc.py"

# ════════════════════════════════════════════════════════════════════
# PASO 4: COBRANZAS CONTROLLER + ROUTES
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[4/7] Actualizando cobranzas controller + routes..."
cp "$FIX_DIR/cobranzas.controller.js" "$ERP_DIR/src/controllers/cobranzas.controller.js"
cp "$FIX_DIR/cobranzas.routes.js" "$ERP_DIR/src/routes/cobranzas.routes.js"
node --check "$ERP_DIR/src/controllers/cobranzas.controller.js" && echo "  ✅ cobranzas.controller.js" || { echo "  ❌ ERROR"; exit 1; }
node --check "$ERP_DIR/src/routes/cobranzas.routes.js" && echo "  ✅ cobranzas.routes.js" || { echo "  ❌ ERROR"; exit 1; }

# Verificar que la ruta esté registrada en index.js
if grep -q "cobranzas" "$ERP_DIR/src/routes/index.js"; then
    echo "  ✅ Ruta cobranzas ya registrada en index.js"
else
    echo "  ⚠️  ATENCIÓN: Agregar la ruta manualmente en $ERP_DIR/src/routes/index.js:"
    echo "     const cobranzasRoutes = require('./cobranzas.routes');"
    echo "     router.use('/cobranzas', cobranzasRoutes);"
fi

# ════════════════════════════════════════════════════════════════════
# PASO 5: FRONTEND
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[5/7] Actualizando frontend..."
cp "$FIX_DIR/cuenta-corriente.html" "$ERP_DIR/frontend/cuenta-corriente.html"
echo "  ✅ cuenta-corriente.html (filtros completos)"

# ════════════════════════════════════════════════════════════════════
# PASO 6: PATCH tesoreria.js (link Ver CC)
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[6/7] Patcheando tesoreria.js..."
if grep -q "linkVerCC" "$ERP_DIR/frontend/js/tesoreria.js"; then
    echo "  ⚠️  Link ya existe, saltando"
else
    python3 -c "
with open('$ERP_DIR/frontend/js/tesoreria.js', 'r') as f:
    content = f.read()

old = \"saldoEl.className = saldo > 0 ? 'monto' : 'monto sin-deuda';\"
patch = '''
        // Link a Cuenta Corriente
        let linkVerCC = document.getElementById('linkVerCC');
        if (!linkVerCC) {
            linkVerCC = document.createElement('a');
            linkVerCC.id = 'linkVerCC';
            linkVerCC.className = 'btn btn-sm btn-outline-info mt-1 d-block text-center';
            linkVerCC.innerHTML = '<i class=\"bi bi-journal-text\"></i> Ver CC';
            linkVerCC.target = '_blank';
            saldoEl.parentElement.appendChild(linkVerCC);
        }
        linkVerCC.href = 'cuenta-corriente.html?id_cliente=' + cliente.id_cliente;'''

if old in content:
    content = content.replace(old, old + patch, 1)
    with open('$ERP_DIR/frontend/js/tesoreria.js', 'w') as f:
        f.write(content)
    print('  ✅ Link Ver CC agregado')
else:
    print('  ⚠️  No encontré el punto de inserción, verificar manualmente')
"
    node --check "$ERP_DIR/frontend/js/tesoreria.js" && echo "  ✅ tesoreria.js sintaxis OK" || echo "  ❌ ERROR sintaxis tesoreria.js"
fi

# ════════════════════════════════════════════════════════════════════
# PASO 7: SQL TRIGGER + RECALCULACIÓN + RESTART
# ════════════════════════════════════════════════════════════════════
echo ""
echo "[7/7] Ejecutando SQL (trigger + recalculación)..."
PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f "$FIX_DIR/fix-cc-trigger.sql"

echo ""
echo "Reiniciando PM2..."
pm2 restart erplago
sleep 2
pm2 status erplago

# ════════════════════════════════════════════════════════════════════
# RESUMEN
# ════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════"
echo " ✅ DEPLOY CC v3 COMPLETADO"
echo "════════════════════════════════════════════════"
echo ""
echo "QUÉ CAMBIÓ:"
echo "  1. Helper CC v3 → registrarVentaConPago() centraliza DEBE+HABER"
echo "  2. 5 controllers patcheados → toda venta registra en CC"
echo "  3. Endpoint movimientos con filtros (tipo, fecha, método, búsqueda)"
echo "  4. cuenta-corriente.html reescrito completo"
echo "  5. tesoreria.js → botón 'Ver CC'"
echo "  6. Trigger SQL → auto-sync clientes.saldo_actual"
echo ""
echo "VERIFICAR:"
echo "  1. Abrir cuenta-corriente.html → buscar cliente → ver movimientos"
echo "  2. En tesorería, seleccionar cliente → verificar link 'Ver CC'"
echo "  3. Hacer una venta en efectivo → verificar DEBE+HABER en CC"
echo "  4. Hacer una venta fiado → verificar solo DEBE en CC"
echo "  5. pm2 logs erplago --lines 30"
echo ""
echo "ROLLBACK:"
echo "  cp $BACKUP_DIR/* (archivos originales a sus ubicaciones)"
echo "  PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago < $BACKUP_DIR/cc_data_backup.sql"
echo "  pm2 restart erplago"
