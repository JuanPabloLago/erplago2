#!/bin/bash
set -e
FILE="/root/mi_erp/src/utils/cc-clientes.helper.js"

echo "=== Fix obtenerNombreMetodo ==="

# Fix 1: Agregar id_empresa a la firma
sed -i 's|async function obtenerNombreMetodo(client, id_metodo_pago)|async function obtenerNombreMetodo(client, id_metodo_pago, id_empresa)|' "$FILE"

# Fix 2: Cache key correcta (lectura)
sed -i 's|if (_cacheMetodos\[id_metodo_pago, id_empresa\]) return _cacheMetodos\[id_metodo_pago\];|const _ck = `${id_empresa}_${id_metodo_pago}`; if (_cacheMetodos[_ck]) return _cacheMetodos[_ck];|' "$FILE"

# Fix 3: Cache key correcta (escritura)
sed -i 's|_cacheMetodos\[id_metodo_pago, id_empresa\] = nombre;|_cacheMetodos[_ck] = nombre;|' "$FILE"

# Fix 4: Llamador - pasar id_empresa
sed -i 's|await obtenerNombreMetodo(client, id_metodo_pago);|await obtenerNombreMetodo(client, id_metodo_pago, id_empresa);|' "$FILE"

echo "=== VERIFICACIÓN ==="
grep -n "obtenerNombreMetodo" "$FILE"
grep -n "_ck\|_cacheMetodos" "$FILE" | head -5
echo ""
echo "✅ Fix aplicado. Reiniciar: source ~/.nvm/nvm.sh && pm2 restart erplago"
