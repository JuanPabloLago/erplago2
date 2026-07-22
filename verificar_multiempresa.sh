#!/bin/bash
# ============================================================================
# VERIFICACIÓN MULTI-EMPRESA - ERP LAGO
# Ejecutar desde /root/mi_erp
# Genera reporte con cada problema EXACTO y su ubicación
# ============================================================================

OUTPUT="/root/mi_erp/scripts_mantenimiento/resultados/VERIFICACION_MULTIEMPRESA_$(date +%Y%m%d_%H%M).md"
mkdir -p "$(dirname "$OUTPUT")"

{
echo "# VERIFICACIÓN MULTI-EMPRESA - ERP LAGO"
echo "## $(date '+%Y-%m-%d %H:%M')"
echo ""

# ============================================================================
echo "---"
echo "## 1. INSERTs SIN id_empresa EN HELPERS"
echo ""
echo '```'
total_warn=0
for helper in src/utils/*.helper.js; do
    nombre=$(basename "$helper")
    # Buscar INSERTs y verificar si la siguiente línea o la misma incluye id_empresa
    while IFS= read -r line; do
        lineno=$(echo "$line" | cut -d: -f1)
        # Buscar las siguientes 5 líneas para ver si id_empresa aparece
        tiene=$(sed -n "${lineno},$((lineno+5))p" "$helper" | grep -c "id_empresa")
        if [ "$tiene" -eq 0 ]; then
            echo "[WARN] $nombre:$lineno - INSERT sin id_empresa"
            sed -n "${lineno},$((lineno+3))p" "$helper" | sed 's/^/  /'
            echo ""
            total_warn=$((total_warn+1))
        fi
    done < <(grep -n "INSERT INTO" "$helper" 2>/dev/null)
done
echo '```'
echo ""
echo "**Total INSERTs sin id_empresa en helpers: $total_warn**"
echo ""

# ============================================================================
echo "---"
echo "## 2. INSERTs SIN id_empresa EN CONTROLLERS"
echo ""
echo '```'
total_ctrl=0
for ctrl in src/controllers/*.controller.js; do
    nombre=$(basename "$ctrl")
    while IFS= read -r line; do
        lineno=$(echo "$line" | cut -d: -f1)
        tiene=$(sed -n "${lineno},$((lineno+5))p" "$ctrl" | grep -c "id_empresa")
        if [ "$tiene" -eq 0 ]; then
            echo "[WARN] $nombre:$lineno - INSERT sin id_empresa"
            sed -n "${lineno},$((lineno+2))p" "$ctrl" | sed 's/^/  /'
            echo ""
            total_ctrl=$((total_ctrl+1))
        fi
    done < <(grep -n "INSERT INTO" "$ctrl" 2>/dev/null)
done
echo '```'
echo ""
echo "**Total INSERTs sin id_empresa en controllers: $total_ctrl**"
echo ""

# ============================================================================
echo "---"
echo "## 3. SELECTs SIN FILTRO id_empresa (tablas críticas)"
echo ""

tablas="cotizaciones formas_pago listasdeprecios metodosdepago pagos producto_proveedor rol_modulos"
for tabla in $tablas; do
    echo "### Tabla: $tabla"
    echo '```'
    resultados=$(grep -rn "FROM ${tabla}" src/ 2>/dev/null | grep -v "node_modules" | grep -v ".bak" | grep -v "backup")
    total_tabla=$(echo "$resultados" | grep -c ".")
    sin_filtro=$(echo "$resultados" | grep -v "id_empresa" | grep -c ".")
    
    echo "Total queries: $total_tabla | Sin filtro id_empresa: $sin_filtro"
    echo ""
    if [ "$sin_filtro" -gt 0 ]; then
        echo "$resultados" | grep -v "id_empresa"
    else
        echo "(todas filtran correctamente)"
    fi
    echo '```'
    echo ""
done

# ============================================================================
echo "---"
echo "## 4. MIDDLEWARE soloAdmin - ¿incluye verificarToken?"
echo ""
echo '```'
echo "=== Definición de soloAdmin ==="
grep -n "soloAdmin\|solo_admin\|verificarAdmin" src/middleware/*.js src/routes/usuarios.routes.js 2>/dev/null | head -30
echo ""
echo "=== ¿soloAdmin importa verificarToken? ==="
head -20 src/routes/usuarios.routes.js 2>/dev/null
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 5. CACHE DE html-access.middleware.js"
echo ""
echo '```'
grep -n "cache\|Cache\|Map\|new Map\|id_empresa\|rol" src/middleware/html-access.middleware.js 2>/dev/null | head -20
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 6. FUNCIONES DE modulos.helper.js - FIRMAS ACTUALES"
echo ""
echo '```'
grep -n "^const\|^async\|^function\|module.exports\|= async\|guardarModulosRol\|clonarPermisosRol\|obtenerMatrizPermisos\|obtenerGrupos" src/utils/modulos.helper.js 2>/dev/null | head -30
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 7. VERIFICAR INSERTs ESPECÍFICOS EN HELPERS CRÍTICOS"
echo ""

echo "### pedidos.helper.js - crearPedido()"
echo '```'
grep -A10 "crearPedido\|INSERT INTO pedidos" src/utils/pedidos.helper.js 2>/dev/null | head -20
echo '```'
echo ""

echo "### pedidos.helper.js - crearItems()"
echo '```'
grep -A10 "crearItems\|INSERT INTO pedidoitems" src/utils/pedidos.helper.js 2>/dev/null | head -20
echo '```'
echo ""

echo "### despachos.helper.js - crearRemito()"
echo '```'
grep -A10 "crearRemito\|INSERT INTO remitos" src/utils/despachos.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### despachos.helper.js - crearRemitoItem()"
echo '```'
grep -A10 "crearRemitoItem\|INSERT INTO remito_items" src/utils/despachos.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### recibos.helper.js - crearRecibo()"
echo '```'
grep -A10 "crearRecibo\|INSERT INTO recibos" src/utils/recibos.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### presupuestos.helper.js - crearPresupuesto()"
echo '```'
grep -A10 "crearPresupuesto\|INSERT INTO presupuestos" src/utils/presupuestos.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### confirmaciones.helper.js - INSERT INTO recibos"
echo '```'
grep -A10 "INSERT INTO recibos" src/utils/confirmaciones.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### crud.helper.js - insertarConjuntoItems()"
echo '```'
grep -A10 "insertarConjuntoItems\|INSERT INTO conjunto_items" src/utils/crud.helper.js 2>/dev/null | head -15
echo '```'
echo ""

echo "### recargos.helper.js - INSERT INTO ajustes_forma_pago"
echo '```'
grep -A10 "INSERT INTO ajustes_forma_pago" src/utils/recargos.helper.js 2>/dev/null | head -15
echo '```'
echo ""

# ============================================================================
echo "---"
echo "## 8. RESUMEN"
echo ""
echo "| Categoría | Problemas |"
echo "|-----------|-----------|"
echo "| INSERTs sin id_empresa (helpers) | $total_warn |"
echo "| INSERTs sin id_empresa (controllers) | $total_ctrl |"
echo "| Tablas con SELECTs sin filtro | ver sección 3 |"
echo ""
echo "**Próximo paso:** Pegar este archivo en Claude para recibir los scripts de corrección exactos."

} > "$OUTPUT"

echo ""
echo "============================================"
echo "  VERIFICACIÓN COMPLETADA"
echo "  Resultado en: $OUTPUT"
echo "============================================"
echo ""
echo "Ejecuta: cat $OUTPUT"
