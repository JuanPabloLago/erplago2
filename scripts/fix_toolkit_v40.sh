#!/bin/bash
TK="/root/mi_erp/scripts_mantenimiento/toolkit_v40.sh"

# Fix 1: Check 5 - detectar module.exports = { } además de exports.X
sed -i "s|local funcs_exported; funcs_exported=\$(grep -oP '(?<=exports\\.)\\\w+' \"\$hfile\" 2>/dev/null || true)|local funcs_exported; funcs_exported=\$(grep -oP '(?<=exports\\.)\\\\w+' \"\$hfile\" 2>/dev/null || true); if [ -z \"\$funcs_exported\" ]; then funcs_exported=\$(grep -A50 'module\\.exports' \"\$hfile\" 2>/dev/null | grep -oP '[a-zA-Z_][a-zA-Z0-9_]+' | grep -v 'module\\|exports\\|require' || true); fi|" "$TK"

# Fix 2: Check 2 - ampliar contexto a ±15 y tolerar JOINs con tablas que filtran
sed -i 's/local start_line=$((linenum - 8)); \[ "$start_line" -lt 1 \] && start_line=1/local start_line=$((linenum - 15)); [ "$start_line" -lt 1 ] \&\& start_line=1/' "$TK"
sed -i 's/local end_line=$((linenum + 8))/local end_line=$((linenum + 15))/' "$TK"

echo "✅ Fixes aplicados. Probar: ./toolkit_v40.sh auditoria-me"
