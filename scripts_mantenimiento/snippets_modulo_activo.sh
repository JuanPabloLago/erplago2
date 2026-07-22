#!/bin/bash
# =====================================================================
# snippets_modulo_activo.sh  v2
#
# CHANGELOG v2:
#   - Nueva seccion 4b: caracteres invisibles del bloque de filtros HTML
#     (usa cat -An para mostrar tabs como ^I, fin de linea como $, etc).
#     Util para detectar lineas en blanco invisibles, espacios trailing,
#     y diferencias de encoding que rompen los assert count==1 de los
#     patches.
#   - Fix seccion 16: filtra archivos .bak* del listado de consumers
#     (antes los listaba como si fueran consumers reales).
#
# Vuelca a un solo archivo markdown TODOS los snippets relevantes de un
# modulo del ERP. Pensado para arrancar una sesion IA pegando UN solo
# archivo en vez de pedir greps manualmente.
#
# Uso:   ./snippets_modulo_activo.sh <nombre_modulo>
# Read-only: solo lee filesystem + BD. NO modifica nada.
# =====================================================================

set -u
set -o pipefail

MODULO="${1:-}"
if [ -z "${MODULO}" ]; then
    cat <<EOF
Uso: $0 <nombre_modulo>

Modulos disponibles (heuristica por nombre de archivos):
EOF
    ls /root/mi_erp/frontend/*.html 2>/dev/null | xargs -n1 basename | sed 's/\.html$//' | sort -u
    exit 1
fi

ROOT="/root/mi_erp"
TS="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${ROOT}/scripts_mantenimiento/resultados"
OUT="${OUT_DIR}/SNIPPETS_${MODULO}_${TS}.md"
mkdir -p "${OUT_DIR}"

HTML="${ROOT}/frontend/${MODULO}.html"
JS="${ROOT}/frontend/js/${MODULO}.js"
CTRL="${ROOT}/src/controllers/${MODULO}.controller.js"
HLP="${ROOT}/src/utils/${MODULO}.helper.js"
ROUTES="${ROOT}/src/routes/${MODULO}.routes.js"

export PGPASSWORD='Huu3697debian@'
PSQL="psql -h localhost -U juanpablo -d erplago"

section() {
    echo "" >> "${OUT}"
    echo "## ${1}" >> "${OUT}"
    echo "" >> "${OUT}"
}
codeblock_open()  { echo '```'"${1:-}" >> "${OUT}"; }
codeblock_close() { echo '```'         >> "${OUT}"; }

cat > "${OUT}" <<EOF
# SNIPPETS modulo: \`${MODULO}\`

Generado: $(date -Iseconds)
Script:   snippets_modulo_activo.sh v2
Para:     arrancar sesion IA con contexto completo del modulo

---
EOF

# 1. Archivos del modulo
section "1. Archivos del modulo"
codeblock_open
for f in "${HTML}" "${JS}" "${CTRL}" "${HLP}" "${ROUTES}"; do
    if [ -f "${f}" ]; then
        wc -l "${f}" >> "${OUT}"
    else
        echo "(no existe) ${f}" >> "${OUT}"
    fi
done
codeblock_close

# 2-4: HTML
if [ -f "${HTML}" ]; then
    section "2. HTML: filtros (selects con id=\"filtro*\")"
    codeblock_open html
    grep -nE 'id="filtro[A-Za-z]+"' "${HTML}" >> "${OUT}" 2>/dev/null \
        || echo "(sin filtros con esa convencion)" >> "${OUT}"
    codeblock_close

    section "3. HTML: todos los IDs (primeros 80)"
    codeblock_open
    grep -nE 'id="[a-zA-Z][a-zA-Z0-9_-]*"' "${HTML}" | head -80 >> "${OUT}"
    codeblock_close

    section "4. HTML: estructura de modales"
    codeblock_open html
    grep -nE 'class="modal|modal fade|modal-dialog|modal-content"|<\!-- modal' "${HTML}" | head -30 >> "${OUT}"
    codeblock_close

    # ─────────────────────────────────────────────────────────────────
    # 4b NUEVA: caracteres invisibles del bloque de filtros (cat -An)
    # Detecta la primera linea con id="filtro*" y muestra 5 lineas antes
    # + 35 despues con cat -An. Esto expone:
    #   - tabs (^I)
    #   - fin de linea ($) -> permite ver lineas en blanco intermedias
    #   - caracteres no-ASCII (M-CM--a = "i", M-CM--3 = "o", etc)
    # Vital para construir anchors confiables para patches.
    # ─────────────────────────────────────────────────────────────────
    section "4b. HTML: caracteres invisibles del bloque de filtros (cat -An)"
    codeblock_open
    FIRST_FILTRO_LINE=$(grep -n 'id="filtro' "${HTML}" 2>/dev/null | head -1 | cut -d: -f1)
    if [ -n "${FIRST_FILTRO_LINE}" ]; then
        START=$((FIRST_FILTRO_LINE > 5 ? FIRST_FILTRO_LINE - 5 : 1))
        END=$((FIRST_FILTRO_LINE + 35))
        echo "# Mostrando lineas ${START}-${END} (filtro detectado en linea ${FIRST_FILTRO_LINE})" >> "${OUT}"
        echo "# Convenciones cat -An:" >> "${OUT}"
        echo "#   '\$' al final de linea = newline (si hay 2 \$ seguidos, hay linea en blanco)" >> "${OUT}"
        echo "#   '^I' = tab" >> "${OUT}"
        echo "#   'M-CM--a' = caracter UTF-8 multibyte (ej. 'i' con tilde)" >> "${OUT}"
        echo "" >> "${OUT}"
        sed -n "${START},${END}p" "${HTML}" | cat -An >> "${OUT}"
    else
        echo "(no se detectaron filtros con id=\"filtro*\")" >> "${OUT}"
    fi
    codeblock_close
fi

# 5-7: JS
if [ -f "${JS}" ]; then
    section "5. JS: funciones (por convencion del proyecto)"
    codeblock_open
    grep -nE 'function (cargar|render|guardar|editar|abrir|aplicar|construir|llenar|filtrar|buscar|inicializar|init|crear|eliminar|anular|confirmar|exportar|importar)|^async function ' "${JS}" | head -80 >> "${OUT}"
    codeblock_close

    section "6. JS: primeras 60 lineas (Estado + constantes)"
    codeblock_open js
    sed -n '1,60p' "${JS}" >> "${OUT}"
    codeblock_close

    section "7. JS: fetches al backend"
    codeblock_open
    grep -nE "fetchAPI|fetch\(|axios\." "${JS}" | head -40 >> "${OUT}"
    codeblock_close
fi

# 8: Routes
if [ -f "${ROUTES}" ]; then
    section "8. Routes: endpoints del modulo"
    codeblock_open js
    grep -nE "router\.(get|post|put|delete|patch)" "${ROUTES}" >> "${OUT}"
    codeblock_close
fi

# 9-12: Controller
if [ -f "${CTRL}" ]; then
    section "9. Controller: requires del top"
    codeblock_open js
    grep -nE "require\(" "${CTRL}" | head -15 >> "${OUT}"
    codeblock_close

    section "10. Controller: async handlers (firmas)"
    codeblock_open js
    grep -nE "(async [a-zA-Z]+\(req, res\)|async function [a-zA-Z]+\(req, res\)|[a-zA-Z]+:\s*async\s*\(req, res\))" "${CTRL}" | head -30 >> "${OUT}"
    codeblock_close

    section "11. Controller: uso de id_empresa (primeras 20)"
    codeblock_open
    grep -nE "id_empresa" "${CTRL}" | head -20 >> "${OUT}"
    codeblock_close

    section "12. Controller: lecturas de config (cfg.get / configHelper.get)"
    codeblock_open
    grep -nE "(cfg|configHelper)\.get\(" "${CTRL}" | head -15 >> "${OUT}" \
        || echo "(no lee config)" >> "${OUT}"
    codeblock_close
fi

# 13-16: Helper
if [ -f "${HLP}" ]; then
    section "13. Helper: module.exports / exports"
    codeblock_open js
    grep -nE "(module\.exports|^exports\.)" "${HLP}" | head -10 >> "${OUT}"
    codeblock_close

    section "14. Helper: funciones (signatures)"
    codeblock_open
    grep -nE "^(async function|function|exports\.[a-zA-Z]+ = async|exports\.[a-zA-Z]+ =)" "${HLP}" | head -30 >> "${OUT}"
    codeblock_close

    section "15. Helper: throws (defensas del boundary)"
    codeblock_open
    grep -nE "throw new Error" "${HLP}" >> "${OUT}" \
        || echo "(sin throws - boundary sin defensas)" >> "${OUT}"
    codeblock_close

    # ─────────────────────────────────────────────────────────────────
    # 16 FIX v2: filtrar archivos .bak* del listado de consumers
    # ─────────────────────────────────────────────────────────────────
    section "16. Consumers del helper (excluye .bak)"
    codeblock_open
    grep -rln "require.*${MODULO}\.helper" "${ROOT}/src" 2>/dev/null \
        | grep -v "${HLP}" \
        | grep -v '\.bak' \
        >> "${OUT}" \
        || echo "(sin consumers - helper huerfano)" >> "${OUT}"
    codeblock_close
fi

# 17-21: BD
section "17. BD: schema de la tabla \`${MODULO}\` (si existe)"
codeblock_open sql
${PSQL} -c "\d ${MODULO}" 2>/dev/null >> "${OUT}" \
    || echo "(tabla '${MODULO}' no existe - el modulo puede ser frontend-only)" >> "${OUT}"
codeblock_close

section "18. BD: COUNT(*) y dispersion por empresa"
codeblock_open sql
${PSQL} -c "SELECT COUNT(*) AS total FROM ${MODULO};" 2>/dev/null >> "${OUT}" \
    || echo "(no se pudo contar)" >> "${OUT}"
${PSQL} -c "SELECT id_empresa, COUNT(*) FROM ${MODULO} GROUP BY id_empresa ORDER BY id_empresa;" 2>/dev/null >> "${OUT}" \
    || echo "(la tabla no tiene id_empresa o no existe)" >> "${OUT}"
codeblock_close

section "19. BD: indices UNIQUE de la tabla"
codeblock_open sql
${PSQL} -tA -c "SELECT indexname, indexdef FROM pg_indexes WHERE tablename='${MODULO}' AND indexdef LIKE '%UNIQUE%';" 2>/dev/null >> "${OUT}" \
    || echo "(sin indices UNIQUE)" >> "${OUT}"
codeblock_close

section "20. BD: triggers en la tabla"
codeblock_open sql
${PSQL} -c "SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = '${MODULO}'::regclass AND NOT tgisinternal;" 2>/dev/null >> "${OUT}" \
    || echo "(sin triggers)" >> "${OUT}"
codeblock_close

section "21. BD: CHECK constraints de la tabla"
codeblock_open sql
${PSQL} -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='${MODULO}'::regclass AND contype='c';" 2>/dev/null >> "${OUT}" \
    || echo "(sin CHECK)" >> "${OUT}"
codeblock_close

# 22: Configs
section "22. Configs en namespace \`${MODULO}.*\` (configuraciones_empresa)"
codeblock_open
${PSQL} -c "SELECT id_empresa, clave, valor FROM configuraciones_empresa WHERE clave LIKE '${MODULO}.%' ORDER BY id_empresa, clave;" >> "${OUT}"
codeblock_close

# 23: Sesiones
section "23. Sesiones documentadas (docs/sesiones/) que mencionan el modulo"
codeblock_open
if [ -d "${ROOT}/docs/sesiones" ]; then
    grep -lri "${MODULO}" "${ROOT}/docs/sesiones" 2>/dev/null \
        | xargs -I {} ls -la {} 2>/dev/null \
        | awk '{print $9, "("$5" bytes, "$6" "$7" "$8")"}' \
        | head -10 >> "${OUT}"
fi
echo "" >> "${OUT}"
echo "(si esta vacio: ninguna sesion documentada lo menciona)" >> "${OUT}"
codeblock_close

# 24: Bugs latentes
section "24. Posibles bugs latentes en codigo del modulo"
codeblock_open
{
    echo "--- IVA hardcoded (||21 / COALESCE(_,21)): ---"
    grep -nE "(\\|\\|\\s*21|COALESCE\\([^,]+,\\s*21)" "${CTRL}" "${HLP}" 2>/dev/null | head -5
    echo ""
    echo "--- TODOs / FIXMEs / BUGs: ---"
    grep -nE "TODO|FIXME|BUG|XXX|HACK" "${CTRL}" "${HLP}" "${JS}" "${HTML}" 2>/dev/null | head -10
    echo ""
    echo "--- Magic numbers en JS (>=50): ---"
    grep -nE "(limite|limit|pageSize|perPage|maxItems)\s*[:=]\s*[0-9]{2,}" "${JS}" 2>/dev/null | head -5
} >> "${OUT}"
codeblock_close

# Footer
echo "" >> "${OUT}"
echo "---" >> "${OUT}"
echo "Tamano: $(wc -l < ${OUT}) lineas - v2 con seccion 4b (cat -An) + fix 16 (.bak)" >> "${OUT}"

echo ""
echo "==================================================="
echo "OK: snippets generados (v2)"
echo "==================================================="
echo "Archivo:  ${OUT}"
echo "Tamano:   $(wc -l < ${OUT}) lineas, $(du -h ${OUT} | cut -f1)"
echo ""
echo "Cambios v2:"
echo "  + Seccion 4b: caracteres invisibles del bloque de filtros (cat -An)"
echo "  + Fix 16: archivos .bak excluidos del listado de consumers"
echo "==================================================="
