#!/bin/bash
set -e
SRC="/root/mi_erp/scripts_mantenimiento/toolkit_v39.sh"
DST="/root/mi_erp/scripts_mantenimiento/toolkit_v40.sh"

echo "=== Upgrade Toolkit v39 → v40 ==="
cp "$SRC" "$DST"

# 1. Versión
sed -i 's/VERSION="39.0"/VERSION="40.0"/' "$DST"
sed -i 's/Toolkit IA v39.0/Toolkit IA v40.0/g' "$DST"
sed -i 's/toolkit_v39.sh/toolkit_v40.sh/g' "$DST"
echo "  ✅ Versión"

# 2. Encontrar inicio/fin de verificar_auditoria_multiempresa
FUNC_START=$(grep -n "^verificar_auditoria_multiempresa()" "$DST" | head -1 | cut -d: -f1)
FUNC_END=$(awk -v s="$FUNC_START" 'NR>s && /^# ===/{print NR; exit}' "$DST")
FUNC_END=$((FUNC_END - 1))

echo "  Reemplazando líneas ${FUNC_START}-${FUNC_END}"

# 3. Extraer partes antes y después
head -n $((FUNC_START - 1)) "$DST" > /tmp/tk_part1.sh
tail -n +$((FUNC_END + 1)) "$DST" > /tmp/tk_part3.sh

# 4. Escribir nueva función
cat > /tmp/tk_part2.sh << 'FUNCEOF'
# =======================================================================================
# [v40] HELPER: Verificación context-aware de SQL multi-línea
# =======================================================================================

_check_sql_context() {
    local archivo="$1" linea="$2" patron="$3" context_lines="${4:-12}"
    local end_line=$((linea + context_lines))
    sed -n "${linea},${end_line}p" "$archivo" 2>/dev/null | grep -q "$patron"
}

_TABLAS_ENTERPRISE_CACHE=""
_get_tablas_enterprise() {
    if [ -n "$_TABLAS_ENTERPRISE_CACHE" ]; then echo "$_TABLAS_ENTERPRISE_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_ENTERPRISE_CACHE=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='id_empresa'
            INTERSECT
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" 2>/dev/null || true)
    fi
    echo "$_TABLAS_ENTERPRISE_CACHE"
}

_TABLAS_COMPARTIDAS_CACHE=""
_get_tablas_compartidas() {
    if [ -n "$_TABLAS_COMPARTIDAS_CACHE" ]; then echo "$_TABLAS_COMPARTIDAS_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_COMPARTIDAS_CACHE=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT t.table_name FROM information_schema.tables t
            WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='id_empresa')
            ORDER BY 1" 2>/dev/null || true)
    fi
    echo "$_TABLAS_COMPARTIDAS_CACHE"
}

# =======================================================================================
# [v40] VERIFICACION INTEGRIDAD MULTI-EMPRESA (context-aware, auto-detect)
# =======================================================================================

verificar_auditoria_multiempresa() {
    local destino="${1:-}"
    local _out=""
    local errores=0
    local warnings=0

    _out+="### VERIFICACION INTEGRIDAD MULTI-EMPRESA (v40 context-aware)"$'\n'
    _out+="Fecha: $(date +%Y-%m-%d) | Auto-detect desde BD + análisis multi-línea"$'\n'$'\n'

    if [ -z "${UTILS_DIR:-}" ] || [ ! -d "${UTILS_DIR:-}" ]; then
        _out+="(directorio utils no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # ═══ CHECK 1: INSERTs sin id_empresa (CONTEXT-AWARE) ═══
    _out+="**Check 1: INSERTs en helpers (context-aware, ±12 líneas)**"$'\n'
    local tablas_compartidas=""
    tablas_compartidas=$(_get_tablas_compartidas 2>/dev/null || true)
    local real_fails=0 total_inserts=0 fails_detail=""

    while IFS=: read -r file linenum rest; do
        [ -z "$file" ] && continue
        total_inserts=$((total_inserts + 1))
        local tabla_name=""
        tabla_name=$(sed -n "${linenum}p" "$file" 2>/dev/null | grep -oP 'INSERT INTO \K[a-z_]+' || true)
        [ -z "$tabla_name" ] && continue
        # Skip compartidas
        echo "$tablas_compartidas" | grep -q "^${tabla_name}$" 2>/dev/null && continue
        # Skip comentarios JSDoc
        sed -n "${linenum}p" "$file" 2>/dev/null | grep -qP '^\s*\*' && continue
        # Context-aware: buscar id_empresa en bloque SQL (12 líneas)
        if ! _check_sql_context "$file" "$linenum" "id_empresa" 12; then
            real_fails=$((real_fails + 1))
            fails_detail+="  $(basename "$file"):${linenum}: INSERT INTO ${tabla_name}"$'\n'
        fi
    done < <(grep -rn "INSERT INTO [a-z_]" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v ".bak" | grep -v "^\s*//" || true)

    if [ "$real_fails" -gt 0 ]; then
        _out+="- [FAIL] ${real_fails}/${total_inserts} INSERTs sin id_empresa en bloque:"$'\n'
        _out+="${fails_detail}"
        errores=$((errores + real_fails))
    else
        _out+="- [OK] ${total_inserts} INSERTs verificados — todos tienen id_empresa"$'\n'
    fi
    _out+=$'\n'

    # ═══ CHECK 2: SELECTs sin filtro (CONTEXT-AWARE ±8 líneas) ═══
    _out+="**Check 2: SELECTs sin filtro id_empresa (context-aware, ±8 líneas)**"$'\n'
    local tablas_enterprise=""
    tablas_enterprise=$(_get_tablas_enterprise 2>/dev/null || true)
    if [ -z "$tablas_enterprise" ]; then
        tablas_enterprise="producto_proveedor cotizaciones formas_pago metodosdepago listasdeprecios inventario precios rol_modulos permisos_usuario"
    fi
    local hay_selects_sin=0
    local search_dirs="${CONTROLLERS_DIR:-} ${UTILS_DIR:-}"
    [ -d "${PROJECT_ROOT}/src/middleware" ] && search_dirs="$search_dirs ${PROJECT_ROOT}/src/middleware"

    while IFS= read -r tabla; do
        [ -z "$tabla" ] && continue
        local tabla_fails=0 tabla_details=""
        while IFS=: read -r file linenum rest; do
            [ -z "$file" ] && continue
            echo "$file" | grep -q ".bak" && continue
            local start_line=$((linenum - 8)); [ "$start_line" -lt 1 ] && start_line=1
            local end_line=$((linenum + 8))
            local context; context=$(sed -n "${start_line},${end_line}p" "$file" 2>/dev/null || true)
            if ! echo "$context" | grep -q "id_empresa"; then
                tabla_fails=$((tabla_fails + 1))
                tabla_details+="    $(basename "$file"):${linenum}"$'\n'
            fi
        done < <(grep -rn "FROM ${tabla}\b\|JOIN ${tabla}\b" $search_dirs --include="*.js" 2>/dev/null | grep -v ".bak" || true)
        if [ "$tabla_fails" -gt 0 ]; then
            _out+="- [WARN] ${tabla}: ${tabla_fails} queries sin id_empresa en contexto"$'\n'
            _out+="${tabla_details}"
            warnings=$((warnings + 1))
            hay_selects_sin=1
        fi
    done <<< "$tablas_enterprise"
    [ "$hay_selects_sin" -eq 0 ] && _out+="- [OK] Tablas enterprise filtran por id_empresa en contexto"$'\n'
    _out+=$'\n'

    # ═══ CHECK 3: Cache keys (scope-aware) ═══
    _out+="**Check 3: Cache keys aisladas por empresa (scope-aware)**"$'\n'
    local cache_fails=0
    local cache_exclude="rutas_soporte\|rutas_api_map\|todos_modulos\|grupos\|TTL\|CACHE"
    while IFS=: read -r file linenum rest; do
        [ -z "$file" ] && continue
        echo "$file" | grep -q ".bak" && continue
        local func_start=$((linenum - 30)); [ "$func_start" -lt 1 ] && func_start=1
        local func_context; func_context=$(sed -n "${func_start},${linenum}p" "$file" 2>/dev/null || true)
        if ! echo "$func_context" | grep -q "id_empresa"; then
            _out+="- [WARN] $(basename "$file"):${linenum}: cache sin id_empresa en scope"$'\n'
            cache_fails=$((cache_fails + 1))
            warnings=$((warnings + 1))
        fi
    done < <(grep -rn "cache\.\(set\|get\|has\)" "$UTILS_DIR" "${PROJECT_ROOT}/src/middleware" --include="*.js" 2>/dev/null | grep -v "$cache_exclude" | grep -v ".bak" || true)
    [ "$cache_fails" -eq 0 ] && _out+="- [OK] Cache keys usan id_empresa en scope"$'\n'
    _out+=$'\n'

    # ═══ CHECK 4: ON CONFLICT ═══
    _out+="**Check 4: ON CONFLICT usa constraints correctos**"$'\n'
    local pp_conflict; pp_conflict=$(grep -rn "ON CONFLICT.*id_producto.*id_proveedor" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v id_empresa | grep -v ".bak" || true)
    [ -n "$pp_conflict" ] && { _out+="- [FAIL] producto_proveedor ON CONFLICT sin id_empresa"$'\n'; errores=$((errores+1)); } || _out+="- [OK] producto_proveedor"$'\n'
    local pr_conflict; pr_conflict=$(grep -rn "ON CONFLICT.*id_producto.*id_lista_precio" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v id_empresa | grep -v ".bak" || true)
    [ -n "$pr_conflict" ] && { _out+="- [FAIL] precios ON CONFLICT sin id_empresa"$'\n'; errores=$((errores+1)); } || _out+="- [OK] precios"$'\n'
    _out+=$'\n'

    # ═══ CHECK 5: Firmas (auto-detect todos los helpers) ═══
    _out+="**Check 5: Firmas helpers (auto-detect)**"$'\n'
    local helpers_checked=0 helpers_ok=0
    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        local funcs_exported; funcs_exported=$(grep -oP '(?<=exports\.)\w+' "$hfile" 2>/dev/null || true)
        [ -z "$funcs_exported" ] && continue
        local missing=0
        while IFS= read -r fn; do
            [ -z "$fn" ] && continue
            local fdef; fdef=$(grep -A3 "async.*${fn}\b\|function.*${fn}\b\|const ${fn}" "$hfile" 2>/dev/null | head -4 || true)
            if [ -n "$fdef" ] && ! echo "$fdef" | grep -q "id_empresa\|datos\|params\|options"; then
                _out+="- [WARN] ${hname} → ${fn}() sin id_empresa/datos en firma"$'\n'
                missing=1; warnings=$((warnings+1))
            fi
        done <<< "$funcs_exported"
        helpers_checked=$((helpers_checked+1))
        [ "$missing" -eq 0 ] && helpers_ok=$((helpers_ok+1))
    done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)
    _out+="- Verificados: ${helpers_checked} | OK: ${helpers_ok}"$'\n'$'\n'

    # ═══ CHECK 6: NOT NULL en BD ═══
    _out+="**Check 6: NOT NULL constraint en id_empresa (BD)**"$'\n'
    if verificar_bd 2>/dev/null; then
        local nc; nc=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT COUNT(*) FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name=t.table_name AND c.table_schema=t.table_schema
            WHERE c.column_name='id_empresa' AND c.table_schema='public'
            AND t.table_type='BASE TABLE' AND c.is_nullable='YES'" 2>/dev/null || echo "?")
        if [ "$nc" = "0" ]; then
            _out+="- [OK] Todas las tablas tienen NOT NULL"$'\n'
        else
            _out+="- [FAIL] ${nc} tablas sin NOT NULL"$'\n'
            errores=$((errores + nc))
        fi
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=$'\n'

    # ═══ RESUMEN ═══
    _out+="**Resumen:** ${errores} errores, ${warnings} warnings"$'\n'
    if [ "$errores" -eq 0 ] && [ "$warnings" -eq 0 ]; then
        _out+="**Estado: ✅ INTEGRIDAD VERIFICADA — listo para multi-empresa**"$'\n'
    elif [ "$errores" -eq 0 ]; then
        _out+="**Estado: ⚠️ WARNINGS — revisar, no bloqueantes**"$'\n'
    else
        _out+="**Estado: ❌ ERRORES — corregir antes de empresa 2**"$'\n'
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

FUNCEOF

# 5. Ensamblar
cat /tmp/tk_part1.sh /tmp/tk_part2.sh /tmp/tk_part3.sh > "$DST"
chmod +x "$DST"
rm -f /tmp/tk_part1.sh /tmp/tk_part2.sh /tmp/tk_part3.sh

echo "  ✅ Función reescrita (6 checks, context-aware, auto-detect BD)"
echo ""
echo "=== Probar ==="
echo "  cd /root/mi_erp/scripts_mantenimiento && ./toolkit_v40.sh auditoria-me"
