#!/bin/bash
UTILS_DIR="/root/mi_erp/src/utils"
echo "=== CONTEXTO DE INSERTs SIN id_empresa ==="
echo "=== Generado: $(date) ==="

HELPERS=(
    "pedidos.helper.js" "pagos.helper.js" "facturacion.helper.js"
    "cc-clientes.helper.js" "recibos.helper.js" "confirmaciones.helper.js"
    "caja.helper.js" "recargos.helper.js" "stock.helper.js"
    "compras.helper.js" "cc-proveedores.helper.js" "pagos-proveedores.helper.js"
    "despachos.helper.js" "presupuestos.helper.js" "ajustes-inventario.helper.js"
)

for helper in "${HELPERS[@]}"; do
    FILE="$UTILS_DIR/$helper"
    if [ -f "$FILE" ]; then
        echo ""
        echo "================================================================"
        echo "HELPER: $helper ($(wc -l < "$FILE") líneas)"
        echo "================================================================"
        grep -n "INSERT INTO" "$FILE" | while read -r line; do
            LINE_NUM=$(echo "$line" | cut -d: -f1)
            FUNC_LINE=$(head -n "$LINE_NUM" "$FILE" | grep -n "async function\|function\|const.*=.*async" | tail -1)
            echo ""
            echo "--- INSERT en línea $LINE_NUM ---"
            START=$((LINE_NUM - 3))
            END=$((LINE_NUM + 20))
            [ $START -lt 1 ] && START=1
            sed -n "${START},${END}p" "$FILE" | cat -n | sed "s/^/  /"
        done
    fi
done
echo ""
echo "=== FIN ==="
