#!/bin/bash
set -e
UTILS="/root/mi_erp/src/utils"
ERRORS=0
BKDIR="/root/backups/pre_fix_id_empresa_$(date +%Y%m%d_%H%M%S)"

echo "=== FASE 1: Fix id_empresa en destructuring ==="
echo "[0/6] Backup..." && mkdir -p "$BKDIR"
cp "$UTILS/compras.helper.js" "$UTILS/recibos.helper.js" "$UTILS/pagos-proveedores.helper.js" "$UTILS/despachos.helper.js" "$BKDIR/"
echo "  Backup en: $BKDIR"

# Fix 1: compras → insertarOrdenItems
echo "[1/6] compras → insertarOrdenItems"
sed -i 's/const { id_orden, items } = datos;/const { id_empresa, id_orden, items } = datos;/' "$UTILS/compras.helper.js"

# Fix 2: compras → insertarRecepcionItems
echo "[2/6] compras → insertarRecepcionItems"
sed -i 's/const { id_recepcion, items } = datos;/const { id_empresa, id_recepcion, items } = datos;/' "$UTILS/compras.helper.js"

# Fix 3: compras → insertarComprobanteItems
echo "[3/6] compras → insertarComprobanteItems"
sed -i 's/const { id_comprobante, items } = datos;/const { id_empresa, id_comprobante, items } = datos;/' "$UTILS/compras.helper.js"

# Fix 4: recibos → aplicarAFactura
echo "[4/6] recibos → aplicarAFactura"
sed -i 's/const { id_recibo, id_factura, monto_aplicado } = datos;/const { id_empresa, id_recibo, id_factura, monto_aplicado } = datos;/' "$UTILS/recibos.helper.js"

# Fix 5a: pagos-proveedores → crearImputacion (destructuring)
echo "[5/6] pagos-proveedores → crearImputacion"
sed -i 's/const { id_pago, id_cuenta, monto_imputado } = datos;/const { id_empresa, id_pago, id_cuenta, monto_imputado } = datos;/' "$UTILS/pagos-proveedores.helper.js"

# Fix 5b: pagos-proveedores → crearImputacion (params array)
sed -i 's/\[id_pago, id_cuenta, monto_imputado\]/[id_empresa, id_pago, id_cuenta, monto_imputado]/' "$UTILS/pagos-proveedores.helper.js"

# Fix 6: despachos → crearRemitoItem
echo "[6/6] despachos → crearRemitoItem"
sed -i 's/id_remito, id_producto, id_pedido_item,/id_empresa, id_remito, id_producto, id_pedido_item,/' "$UTILS/despachos.helper.js"

echo ""
echo "=== VERIFICACIÓN ==="
grep -n "id_empresa, id_orden, items" "$UTILS/compras.helper.js" | head -1
grep -n "id_empresa, id_recepcion, items" "$UTILS/compras.helper.js" | head -1
grep -n "id_empresa, id_comprobante, items" "$UTILS/compras.helper.js" | head -1
grep -n "id_empresa, id_recibo, id_factura" "$UTILS/recibos.helper.js" | head -1
grep -n "id_empresa, id_pago, id_cuenta" "$UTILS/pagos-proveedores.helper.js" | head -1
grep -n "\[id_empresa, id_pago, id_cuenta" "$UTILS/pagos-proveedores.helper.js" | head -1
grep -n "id_empresa, id_remito, id_producto, id_pedido_item" "$UTILS/despachos.helper.js" | head -1
echo ""
echo "✅ 6 fixes aplicados. Reiniciar: source ~/.nvm/nvm.sh && pm2 restart erplago"
