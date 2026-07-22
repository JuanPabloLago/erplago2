#!/bin/bash
# Crea todos los archivos de Fase 0 directo en el servidor

echo "=== Creando db-guard.helper.js ==="
cat > /root/mi_erp/src/utils/db-guard.helper.js << 'EOF'
/**
 * db-guard.helper.js
 * Capa de guardia para operaciones multi-empresa.
 */
'use strict';

function requireIdEmpresa(id_empresa, contexto) {
    if (id_empresa === null || id_empresa === undefined) {
        throw new Error(`[DB-GUARD] id_empresa es requerido en: ${contexto}. Recibido: ${id_empresa}`);
    }
    const parsed = parseInt(id_empresa, 10);
    if (isNaN(parsed) || parsed <= 0) {
        throw new Error(`[DB-GUARD] id_empresa inválido en: ${contexto}. Recibido: ${id_empresa} (parsed: ${parsed})`);
    }
    return parsed;
}

function requireParams(params, required, contexto) {
    const missing = [];
    for (const key of required) {
        if (params[key] === undefined || params[key] === null) {
            missing.push(key);
        }
    }
    if (missing.length > 0) {
        throw new Error(`[DB-GUARD] Parámetros faltantes en ${contexto}: ${missing.join(', ')}`);
    }
}

function requireClient(client, contexto) {
    if (!client || typeof client.query !== 'function') {
        throw new Error(`[DB-GUARD] client de BD inválido en: ${contexto}`);
    }
}

function guardEntry(client, datos, requiredFields, contexto) {
    requireClient(client, contexto);
    const id_empresa = requireIdEmpresa(datos.id_empresa, contexto);
    if (requiredFields && requiredFields.length > 0) {
        requireParams(datos, requiredFields, contexto);
    }
    return id_empresa;
}

module.exports = { requireIdEmpresa, requireParams, requireClient, guardEntry };
EOF

echo "✅ db-guard.helper.js creado"

echo "=== Creando extract_inserts.sh ==="
cat > /root/mi_erp/scripts/extract_inserts.sh << 'EOF2'
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
EOF2

echo "✅ extract_inserts.sh creado"
echo ""
echo "=== Fase 0 lista ==="
echo "Ahora ejecutar:"
echo "  1. Backup: source ~/.nvm/nvm.sh && pg_dump -h localhost -U juanpablo erplago > /root/backups/pre_fase0_\$(date +%Y%m%d_%H%M%S).sql"
echo "  2. Extraer: bash /root/mi_erp/scripts/extract_inserts.sh > /tmp/inserts_context.txt"
echo "  3. Pasame inserts_context.txt para hacer los fixes"
