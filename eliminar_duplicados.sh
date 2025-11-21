#!/bin/bash
# Eliminar las 6 rutas duplicadas del server.js

echo "🔧 Eliminando rutas duplicadas del server.js"
echo ""

# Backup adicional
cp server.js server.js.before_remove_duplicates
echo "✅ Backup creado: server.js.before_remove_duplicates"
echo ""

# IMPORTANTE: Eliminar de ABAJO hacia ARRIBA para que los números no cambien
echo "Eliminando duplicados..."

# 6. /api/cobranzas/aplicar-pago (líneas 5934-5985)
sed -i '5934,5985d' server.js
echo "✅ 1/6 - Eliminado /api/cobranzas/aplicar-pago (5934-5985)"

# 5. /api/cobranzas/pendientes (líneas 5905-5931)
sed -i '5905,5931d' server.js
echo "✅ 2/6 - Eliminado /api/cobranzas/pendientes (5905-5931)"

# 4. /api/reportes/aging (líneas 5874-5902)
sed -i '5874,5902d' server.js
echo "✅ 3/6 - Eliminado /api/reportes/aging (5874-5902)"

# 3. /api/clientes/:id/facturas-pendientes (líneas 5815-5871)
sed -i '5815,5871d' server.js
echo "✅ 4/6 - Eliminado /api/clientes/:id/facturas-pendientes (5815-5871)"

# 2. /api/clientes/:id/saldo (líneas 5780-5812)
sed -i '5780,5812d' server.js
echo "✅ 5/6 - Eliminado /api/clientes/:id/saldo (5780-5812)"

# 1. /api/clientes/:id/cuenta-corriente (líneas 5717-5777)
sed -i '5717,5777d' server.js
echo "✅ 6/6 - Eliminado /api/clientes/:id/cuenta-corriente (5717-5777)"

echo ""
echo "═══════════════════════════════════════════"
echo "  VERIFICACIÓN POST-ELIMINACIÓN"
echo "═══════════════════════════════════════════"
echo ""

# Calcular líneas eliminadas
LINEAS_ANTES=$(wc -l < server.js.before_remove_duplicates)
LINEAS_AHORA=$(wc -l < server.js)
ELIMINADAS=$((LINEAS_ANTES - LINEAS_AHORA))

echo "📊 Líneas antes: $LINEAS_ANTES"
echo "📊 Líneas ahora: $LINEAS_AHORA"
echo "📊 Líneas eliminadas: $ELIMINADAS (esperadas: ~260)"
echo ""

# Verificar que no queden duplicados
echo "🔍 Verificando que no queden duplicados..."
echo ""

DUPLICADOS=0

for ruta in \
    "'/api/clientes/:id/cuenta-corriente'" \
    "'/api/clientes/:id/saldo'" \
    "'/api/clientes/:id/facturas-pendientes'" \
    "'/api/reportes/aging'" \
    "'/api/cobranzas/pendientes'" \
    "'/api/cobranzas/aplicar-pago'"
do
    COUNT=$(grep -c "$ruta" server.js)
    if [ $COUNT -eq 1 ]; then
        echo "   ✅ $ruta → 1 aparición (correcto)"
    else
        echo "   ❌ $ruta → $COUNT apariciones (ERROR)"
        DUPLICADOS=$((DUPLICADOS + 1))
    fi
done

echo ""
if [ $DUPLICADOS -eq 0 ]; then
    echo "✅ ¡PERFECTO! No quedan duplicados"
    echo ""
    echo "Siguiente paso: Reiniciar el servidor"
    echo "   pm2 restart erplago"
    echo "   pm2 logs erplago --lines 50"
else
    echo "⚠️  ATENCIÓN: Todavía hay duplicados"
    echo "Revisar manualmente"
fi
