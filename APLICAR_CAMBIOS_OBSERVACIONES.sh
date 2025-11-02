#!/bin/bash

# ============================================================
# Script para aplicar cambios de observaciones en server.js
# ============================================================

echo "🔧 Aplicando cambios para trasladar observaciones del pedido al remito..."

# Verificar que existe server.js
if [ ! -f "server.js" ]; then
    echo "❌ ERROR: No se encuentra server.js en el directorio actual"
    echo "Por favor ejecuta este script desde la carpeta raíz de tu proyecto"
    exit 1
fi

# Hacer backup
echo "📦 Creando backup de server.js..."
cp server.js server.js.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Backup creado"

# Aplicar cambios
echo ""
echo "🔨 Aplicando modificaciones..."

# 1. Agregar observaciones al query del pedido en entregar-todo
sed -i "s/SELECT id_cliente, punto_venta /SELECT id_cliente, punto_venta, observaciones /g" server.js

# 2. Usar observaciones del pedido al crear remito
sed -i "s/observaciones || 'Entrega completa del pedido',/observaciones || pedido.observaciones || 'Entrega completa del pedido',/g" server.js

# 3. Agregar observaciones a los queries de pedidos en entregas parciales
sed -i "s/p\.domicilio_entrega,/p.domicilio_entrega,\n                p.observaciones as observaciones_pedido,/g" server.js

echo "✅ Cambios aplicados exitosamente"
echo ""
echo "📝 Resumen de cambios:"
echo "  1. Query de pedido ahora incluye observaciones"
echo "  2. Observaciones se trasladan automáticamente al remito"
echo "  3. Observaciones disponibles en queries de entregas"
echo ""
echo "🔄 Ahora reinicia el servidor:"
echo "   pm2 restart server"
echo ""
echo "📂 Backup guardado como: server.js.backup.*"

