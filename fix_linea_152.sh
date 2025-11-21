#!/bin/bash
# Fix línea 152 - Eliminar ruta incompleta de clientes/buscar

echo "🔧 Corrigiendo server.js - Eliminando ruta incompleta línea 152"

# Backup adicional
cp server.js server.js.before_fix_152

# Eliminar líneas 150-153 (comentarios + declaración incompleta)
sed -i '150,153d' server.js

# Ahora las líneas se movieron, necesitamos recalcular
# Eliminar el código huérfano (era líneas 215-241, ahora son 211-237)
sed -i '211,237d' server.js

echo "✅ Correcciones aplicadas"
echo ""
echo "Verificando resultado:"
echo "===================="

# Verificar que quedó bien
echo "Línea 150-160 (debería empezar con el endpoint público):"
sed -n '150,160p' server.js | head -5

echo ""
echo "¿La ruta '/api/clientes/buscar' sigue duplicada?"
grep -c "'/api/clientes/buscar'" server.js

echo ""
echo "✅ Si muestra '1', está perfecto (solo quedó la buena en línea ~1960)"
