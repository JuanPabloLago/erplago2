#!/bin/bash
# ============================================================
# DEPLOY FIX TESORERÍA / CC - ERP LAGO
# Fecha: 2026-02-16
# ============================================================
# EJECUTAR COMO: bash /root/mi_erp/scripts/deploy-fix-cc.sh
# ============================================================

set -e
source ~/.nvm/nvm.sh

FECHA=$(date +%Y%m%d_%H%M%S)
ERP_DIR="/root/mi_erp"
BACKUP_DIR="/root/backups/fix_cc_${FECHA}"
FIX_DIR="/root/mi_erp/scripts/fix-cc-files"

echo "============================================"
echo " ERP LAGO - Fix Tesorería / CC"
echo " ${FECHA}"
echo "============================================"

# ============================================================
# PASO 1: BACKUP
# ============================================================
echo ""
echo "[1/6] Creando backup..."
mkdir -p "$BACKUP_DIR"

cp "$ERP_DIR/src/controllers/cobranzas.controller.js" "$BACKUP_DIR/" 2>/dev/null || echo "  (cobranzas.controller.js no existía)"
cp "$ERP_DIR/src/routes/cobranzas.routes.js" "$BACKUP_DIR/" 2>/dev/null || echo "  (cobranzas.routes.js no existía)"
cp "$ERP_DIR/frontend/cuenta-corriente.html" "$BACKUP_DIR/"
cp "$ERP_DIR/frontend/js/tesoreria.js" "$BACKUP_DIR/"

# Backup tabla CC
PGPASSWORD='Huu3697debian@' pg_dump -h localhost -U juanpablo erplago \
    -t cuentacorrienteclientes -t clientes --data-only \
    > "$BACKUP_DIR/cc_data_backup.sql" 2>/dev/null

echo "  ✅ Backup en: $BACKUP_DIR"

# ============================================================
# PASO 2: COPIAR ARCHIVOS BACKEND
# ============================================================
echo ""
echo "[2/6] Copiando archivos backend..."

cp "$FIX_DIR/cobranzas.controller.js" "$ERP_DIR/src/controllers/cobranzas.controller.js"
echo "  ✅ cobranzas.controller.js (con getMovimientosCC)"

cp "$FIX_DIR/cobranzas.routes.js" "$ERP_DIR/src/routes/cobranzas.routes.js"
echo "  ✅ cobranzas.routes.js (con ruta movimientos)"

# ============================================================
# PASO 3: COPIAR FRONTEND
# ============================================================
echo ""
echo "[3/6] Copiando frontend..."

cp "$FIX_DIR/cuenta-corriente.html" "$ERP_DIR/frontend/cuenta-corriente.html"
echo "  ✅ cuenta-corriente.html (reescrito completo)"

# ============================================================
# PASO 4: PATCH tesoreria.js - Agregar link a CC
# ============================================================
echo ""
echo "[4/6] Patcheando tesoreria.js (link a CC)..."

# Verificar que no se haya aplicado ya
if grep -q "linkVerCC" "$ERP_DIR/frontend/js/tesoreria.js"; then
    echo "  ⚠️ Patch ya aplicado, saltando"
else
    # Agregar función después de la línea que setea clienteSaldo
    # Buscamos: saldoEl.className = saldo > 0 ? 'monto' : 'monto sin-deuda';
    # Agregamos después: link a CC
    python3 -c "
import re
with open('$ERP_DIR/frontend/js/tesoreria.js', 'r') as f:
    content = f.read()

# Buscar la línea que setea className del saldo
old = \"saldoEl.className = saldo > 0 ? 'monto' : 'monto sin-deuda';\"
new_code = old + '''
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
        linkVerCC.href = \\'cuenta-corriente.html?id_cliente=\\' + cliente.id_cliente;'''

if old in content:
    content = content.replace(old, new_code, 1)
    with open('$ERP_DIR/frontend/js/tesoreria.js', 'w') as f:
        f.write(content)
    print('  ✅ Link a CC agregado en tesoreria.js')
else:
    print('  ⚠️ No se encontró el punto de inserción, verificar manualmente')
"
fi

# ============================================================
# PASO 5: VALIDAR SINTAXIS
# ============================================================
echo ""
echo "[5/6] Validando sintaxis..."

node --check "$ERP_DIR/src/controllers/cobranzas.controller.js" && echo "  ✅ cobranzas.controller.js OK" || echo "  ❌ ERROR cobranzas.controller.js"
node --check "$ERP_DIR/src/routes/cobranzas.routes.js" && echo "  ✅ cobranzas.routes.js OK" || echo "  ❌ ERROR cobranzas.routes.js"
node --check "$ERP_DIR/frontend/js/tesoreria.js" && echo "  ✅ tesoreria.js OK" || echo "  ❌ ERROR tesoreria.js"

# ============================================================
# PASO 6: MIGRACIÓN BD + RESTART
# ============================================================
echo ""
echo "[6/6] Ejecutando migración BD..."

PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f "$FIX_DIR/fix-cc-tesoreria.sql"
echo "  ✅ Vista rota dropeada + pedidos test limpiados"

echo ""
echo "Reiniciando PM2..."
pm2 restart erplago
sleep 2
pm2 status erplago

echo ""
echo "============================================"
echo " ✅ DEPLOY COMPLETADO"
echo "============================================"
echo ""
echo "VERIFICAR:"
echo "  1. Abrir cuenta-corriente.html → buscar un cliente → ver movimientos"
echo "  2. En tesorería, seleccionar cliente → verificar link 'Ver CC'"
echo "  3. Revisar pm2 logs: pm2 logs erplago --lines 30"
echo ""
echo "PENDIENTE (ejecutar manualmente si hay HABER faltantes):"
echo "  PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f $FIX_DIR/fix-cc-haber-historicos.sql"
echo ""
echo "ROLLBACK si algo falla:"
echo "  cp $BACKUP_DIR/* los-archivos-originales"
echo "  PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago < $BACKUP_DIR/cc_data_backup.sql"
echo "  pm2 restart erplago"
