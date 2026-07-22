#!/bin/bash
set -e
SRC="/root/mi_erp/src"
BKDIR="/root/backups/pre_fix_selects_$(date +%Y%m%d_%H%M%S)"

echo "=== FASE 3: Fix SELECTs sin id_empresa ==="
mkdir -p "$BKDIR"
cp "$SRC/controllers/usuarios.controller.js" "$BKDIR/"
cp "$SRC/controllers/recargos-forma-pago.controller.js" "$BKDIR/"
cp "$SRC/utils/ajustes-inventario.helper.js" "$BKDIR/"
cp "$SRC/utils/cc-clientes.helper.js" "$BKDIR/"
echo "  Backup en: $BKDIR"

# Fix 1: usuarios.controller → permisos_usuario sin id_empresa
echo "[1/4] usuarios.controller → permisos_usuario"
sed -i "s|FROM permisos_usuario WHERE rol = \$1 ORDER BY permiso', \[rol\]|FROM permisos_usuario WHERE rol = \$1 AND id_empresa = \$2 ORDER BY permiso', [rol, req.usuario.id_empresa]|" "$SRC/controllers/usuarios.controller.js"

# Fix 2: recargos-forma-pago.controller → formas_pago sin WHERE
echo "[2/4] recargos-forma-pago.controller → formas_pago"
sed -i 's|ON r.id_forma_pago = fp.id_forma_pago|ON r.id_forma_pago = fp.id_forma_pago\n                      AND fp.id_empresa = r.id_empresa|;s|AND r.id_empresa = \$1|AND r.id_empresa = $1\n                  WHERE fp.id_empresa = $1|' "$SRC/controllers/recargos-forma-pago.controller.js"

# Fix 3: ajustes-inventario.helper → producto_proveedor sin id_empresa
echo "[3/4] ajustes-inventario.helper → producto_proveedor"
sed -i "s|AND pp.id_proveedor = \$\${paramIndex++} AND pp.activo = TRUE|AND pp.id_proveedor = \$\${paramIndex++} AND pp.id_empresa = \$1 AND pp.activo = TRUE|" "$SRC/utils/ajustes-inventario.helper.js"

# Fix 4: cc-clientes.helper → metodosdepago sin id_empresa
echo "[4/4] cc-clientes.helper → metodosdepago"
sed -i "s|'SELECT nombre FROM metodosdepago WHERE id_metodo_pago = \$1'|'SELECT nombre FROM metodosdepago WHERE id_metodo_pago = \$1 AND id_empresa = \$2'|" "$SRC/utils/cc-clientes.helper.js"
# También necesita el param id_empresa - verificar firma de la función
sed -i "s|\[id_metodo_pago\]|\[id_metodo_pago, id_empresa\]|" "$SRC/utils/cc-clientes.helper.js"

echo ""
echo "=== VERIFICACIÓN ==="
grep -n "id_empresa" "$SRC/controllers/usuarios.controller.js" | grep permisos | head -1
grep -n "fp.id_empresa" "$SRC/controllers/recargos-forma-pago.controller.js" | head -2
grep -n "pp.id_empresa = \$1" "$SRC/utils/ajustes-inventario.helper.js" | tail -1
grep -n "id_empresa = \$2" "$SRC/utils/cc-clientes.helper.js" | head -1
echo ""
echo "✅ 4 fixes aplicados. Reiniciar: source ~/.nvm/nvm.sh && pm2 restart erplago"
