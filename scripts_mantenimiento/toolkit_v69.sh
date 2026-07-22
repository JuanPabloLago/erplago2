#!/bin/bash
# =======================================================================================
# ERP LAGO - TOOLKIT IA v68.0
# =======================================================================================
# Propósito: generar contexto operativo y de arquitectura para sesiones de IA y
#            ejecutar verificaciones de salud sobre el ERP.
#
# Outputs principales (en scripts_mantenimiento/resultados/):
#   - INFORME_COMPLETO_*.md   (todo en uno: contexto, arquitectura, salud, prompt)
#   - PROMPT_MAESTRO.md       (contexto para sesion IA)
#   - SALUD_ARQUITECTONICA.md (chequeos vivos)
#   - SEGURIDAD_*.md, INTEGRIDAD_REFERENCIAL.md, MULTIEMPRESA_*.md, etc.
#
# Uso:
#   ./toolkit_v68.sh            -> menu interactivo
#   ./toolkit_v68.sh <comando>  -> CLI directa (informe, salud, prompt, ...)
#   ./toolkit_v68.sh help       -> lista completa de comandos
#   ./toolkit_v68.sh changelog  -> historico de versiones
#
# Convenciones de diseno:
#   - Single write point por dominio (helpers en /root/mi_erp/src/utils/)
#   - Multi-empresa estricto (id_empresa en queries y UNIQUE constraints)
#   - "BD manda": frontend solo muestra, no recalcula
#   - Vendibilidad: cero hardcoding, todo bajo namespace en configuraciones_empresa
#
# Para el historico de cambios del toolkit, ejecutar:  ./toolkit_v68.sh changelog
# =======================================================================================

# Encoding
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Pipefail solo para comandos críticos, no global
set -u

# =======================================================================================
# CONFIGURACION
# =======================================================================================

encontrar_raiz() {
    local dir="${1:-$(pwd)}"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/package.json" ] || [ -f "$dir/server.js" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    [ -d "/root/mi_erp" ] && echo "/root/mi_erp" && return 0
    return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT=$(encontrar_raiz "$SCRIPT_DIR" 2>/dev/null || echo "/root/mi_erp")
OUTPUT_DIR="${PROJECT_ROOT}/scripts_mantenimiento/resultados"
HISTORY_FILE="${PROJECT_ROOT}/scripts_mantenimiento/.toolkit_history.json"
VERSION="69.0"

mkdir -p "$OUTPUT_DIR"

# =======================================================================================
# CREDENCIALES
# =======================================================================================

cargar_credenciales() {
    local env_file=""
    for f in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.local" "$SCRIPT_DIR/.env"; do
        [ -f "$f" ] && env_file="$f" && break
    done

    if [ -n "$env_file" ]; then
        while IFS= read -r line; do
            [[ "$line" =~ ^#.*$ ]] && continue
            [[ -z "$line" ]] && continue
            export "$line" 2>/dev/null || true
        done < "$env_file"
    fi

    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-erplago}"
    DB_USER="${DB_USER:-juanpablo}"

    if [ -z "${DB_PASSWORD:-}" ] && [ -z "${PGPASSWORD:-}" ]; then
        DB_PASSWORD="Huu3697debian@"
    else
        DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"
    fi

    export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
    export PGPASSWORD="$DB_PASSWORD"
}

# =======================================================================================
# COLORES Y UTILIDADES
# =======================================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

ERRORES_CRITICOS=0
ADVERTENCIAS=0
SUGERENCIAS=0

header() {
    clear
    echo -e "${MAGENTA}"
    echo "   ==========================================================================="
    echo "   |     ERP LAGO - TOOLKIT IA v${VERSION}                                       |"
    echo "   |   v69.0: helper canonico unico + fix conteo multiempresa + detector auth     |"
    echo "   ==========================================================================="
    echo -e "${NC}"
    echo -e "  Proyecto: ${CYAN}$PROJECT_ROOT${NC}"
    echo -e "  Salida:   ${CYAN}$OUTPUT_DIR${NC}"
    # mostrar path real del script: ayuda a debuggear si conviven varias versiones
    if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
        echo -e "  Script:   ${CYAN}${BASH_SOURCE[0]}${NC}"
    fi
    echo ""
}

# =======================================================================================
# VERIFICACIONES
# =======================================================================================

verificar_proyecto() {
    if [ ! -f "$PROJECT_ROOT/package.json" ] && [ ! -f "$PROJECT_ROOT/server.js" ]; then
        echo -e "${RED}[ERROR] No se encontro proyecto Node.js en $PROJECT_ROOT${NC}"
        exit 1
    fi
}

verificar_bd() {
    command -v psql &>/dev/null || return 1
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null || return 1
    return 0
}

# =======================================================================================
# HELPERS DE INFRAESTRUCTURA — eliminan duplicacion de patrones inline
# =======================================================================================

## Ejecuta SQL y retorna resultado. Reemplaza ~80 llamadas inline con psql + credenciales.
## Uso: resultado=$(_run_sql "SELECT COUNT(*) FROM tabla")
##      _run_sql_full "SELECT * FROM tabla"  # con headers (para archivos)
_run_sql() {
    # timeout 10s: si una query queda bloqueada (lock, query lenta),
    # el toolkit no se cuelga. Devuelve "" como antes.
    local timeout_sec="${TOOLKIT_SQL_TIMEOUT:-10}"
    if command -v timeout >/dev/null 2>&1; then
        timeout "$timeout_sec" psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo ""
    else
        psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo ""
    fi
}
_run_sql_full() {
    psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -c "$1" 2>/dev/null || true
}

## Detecta version de una herramienta. Elimina patron repetitivo de 6 bloques if/else.
## Uso: version=$(_check_tool_version "node" "--version")
_check_tool_version() {
    local cmd="$1" flag="${2:---version}"
    if command -v "$cmd" &>/dev/null; then
        $cmd $flag 2>&1 | head -1 || echo "no detectado"
    else
        echo "no instalado"
    fi
}

## Verifica que una tabla exista en la BD.
## Uso: if _table_exists "pagos"; then ...
_table_exists() {
    local tabla="$1"
    local existe=""
    existe=$(_run_sql "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$tabla'")
    [ "$existe" = "1" ]
}

## Cuenta registros de una tabla. Retorna 0 si no existe.
## Uso: count=$(_table_count "pagos")
_table_count() {
    local tabla="$1"
    _table_exists "$tabla" && _run_sql "SELECT COUNT(*) FROM $tabla" || echo "0"
}

## Verifica dato semilla: tabla existe + COUNT >= minimo esperado.
## Retorna linea formateada [OK]/[FAIL] + incrementa errores si falla.
## Uso: _check_semilla "factura_tipos" 3 "tipos" "necesita A, B, C minimo"
_check_semilla() {
    local tabla="$1" minimo="$2" label="$3" msg_fail="${4:-}"
    local count=""
    count=$(_table_count "$tabla")
    if [ "${count:-0}" -ge "$minimo" ]; then
        echo "- [OK] ${tabla}: ${count} ${label}"
    else
        echo "- [FAIL] ${tabla}: solo ${count} (${msg_fail})"
        errores=$((errores + 1))
    fi
}

## [v65] Wrapper para funciones que aceptan $1=destino.
## Antes el wrapper escribia header siempre. Si la funcion tambien escribia
## header, salia DOBLE. Ahora: el wrapper SIEMPRE escribe header. Las
## funciones llamadas NO deben escribir header propio cuando reciben $1.
## (extraer_extras y verificar_flujo_caja se corrigieron en consecuencia).
_ejecutar_y_guardar() {
    local nombre="$1"
    local funcion="$2"
    shift 2
    local TS_LOCAL; TS_LOCAL=$(date '+%Y%m%d_%H%M')
    local OUT="${OUTPUT_DIR}/${nombre}_${TS_LOCAL}.md"
    {
        echo "# ${nombre}"
        echo "## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}"
        echo ""
    } > "$OUT"
    "$funcion" "$OUT" "$@"
    # Dedup robusto: si las primeras 2 lineas no-vacias empiezan
    # con "# " y la SEGUNDA tiene mas contenido (es el header verdadero
    # de la funcion), eliminar la primera (la generica del wrapper).
    if [ -f "$OUT" ]; then
        awk '
            BEGIN { skip_first_h1 = 0; first_h1_line = 0; second_h1_line = 0; line_num = 0 }
            { line_num++; lines[line_num] = $0 }
            /^# / && first_h1_line == 0 { first_h1_line = line_num; first_h1 = $0; next }
            /^# / && first_h1_line > 0 && second_h1_line == 0 {
                second_h1_line = line_num
                if (length($0) > length(first_h1)) { skip_first_h1 = 1 }
            }
            END {
                for (i = 1; i <= line_num; i++) {
                    if (skip_first_h1 && i == first_h1_line) continue
                    if (skip_first_h1 && i == first_h1_line + 1 && lines[i] ~ /^## Generado:/) continue
                    if (skip_first_h1 && i == first_h1_line + 2 && lines[i] == "") continue
                    print lines[i]
                }
            }
        ' "$OUT" > "${OUT}.dedup" && mv "${OUT}.dedup" "$OUT"
    fi
    echo ""
    echo -e "${GREEN}[OK] Archivo: ${OUT}${NC}"
    echo ""
    echo -e "${CYAN}--- Resumen rapido ---${NC}"
    grep -E "^### |^- \[(OK|WARN|FAIL|INFO|SKIP)\]|^\*\*Resultado|^Total" "$OUT" 2>/dev/null | head -30 || true
}

## [v65] Wrapper para funciones que solo imprimen a stdout (no aceptan $1=destino).
## v65: filtra ANSI escape codes y secuencias de control de terminal (clear, etc.)
## El bug previo: listar_modulos llama header() que hace 'clear' -> los escape
## codes se capturaban literales en el .md como [H[2J[3J[0;35m...
_ejecutar_capturando_stdout() {
    local nombre="$1"
    local funcion="$2"
    shift 2
    local TS_LOCAL; TS_LOCAL=$(date '+%Y%m%d_%H%M')
    local OUT="${OUTPUT_DIR}/${nombre}_${TS_LOCAL}.md"
    {
        echo "# ${nombre}"
        echo "## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}"
        echo ""
        # Probado en sandbox: el archivo NO contiene byte ESC (0x1B)
        # porque se pierde en algun pipe. Llegan las secuencias como TEXTO
        # LITERAL: "[H[2J[3J[0;35m...". Hay que limpiar AMBOS:
        #   - Texto literal "[H", "[2J", "[3J", "[Nm", "[N;Nm"
        #   - ESC real (por si en el futuro llega bien)
        "$funcion" "$@" 2>&1 | sed -E '
            s/\[H\[2J\[3J//g
            s/\[H\[2J//g
            s/\[2J//g
            s/\[3J//g
            s/\[H//g
            s/\[[0-9]+(;[0-9]+)*m//g
            s/'"$(printf '\033')"'\[[0-9;]*[a-zA-Z]//g
            s/'"$(printf '\033')"'\][^'"$(printf '\007')"']*'"$(printf '\007')"'//g
        '
    } > "$OUT"
    echo ""
    echo -e "${GREEN}[OK] Archivo: ${OUT}${NC}"
}


verificar_git() {
    [ -d "$PROJECT_ROOT/.git" ] && command -v git &>/dev/null
}

# =======================================================================================
# EXPLORAR PROYECTO
# =======================================================================================

explorar_proyecto() {
    FRONTEND_DIR=""
    for d in frontend public client views www; do
        [ -d "$PROJECT_ROOT/$d" ] && FRONTEND_DIR="$PROJECT_ROOT/$d" && break
    done

    JS_DIR=""
    for d in "$FRONTEND_DIR/js" "$FRONTEND_DIR/scripts" "$PROJECT_ROOT/public/js"; do
        [ -d "$d" ] && JS_DIR="$d" && break
    done

    CONTROLLERS_DIR=""
    for d in src/controllers controllers app/controllers; do
        [ -d "$PROJECT_ROOT/$d" ] && CONTROLLERS_DIR="$PROJECT_ROOT/$d" && break
    done

    ROUTES_DIR=""
    for d in src/routes routes app/routes; do
        [ -d "$PROJECT_ROOT/$d" ] && ROUTES_DIR="$PROJECT_ROOT/$d" && break
    done

    # Deteccion explicita de utils/helpers
    UTILS_DIR=""
    for d in src/utils src/helpers utils helpers; do
        [ -d "$PROJECT_ROOT/$d" ] && UTILS_DIR="$PROJECT_ROOT/$d" && break
    done

    # Deteccion de middlewares
    MIDDLEWARE_DIR=""
    for d in src/middleware src/middlewares middleware middlewares; do
        [ -d "$PROJECT_ROOT/$d" ] && MIDDLEWARE_DIR="$PROJECT_ROOT/$d" && break
    done

    export FRONTEND_DIR JS_DIR CONTROLLERS_DIR ROUTES_DIR UTILS_DIR MIDDLEWARE_DIR
}

# =======================================================================================
# DETECCION AUTOMATICA DE HELPERS CENTRALIZADOS
# =======================================================================================

detectar_helpers_existentes() {
    local destino="${1:-}"
    local helpers_dir="$PROJECT_ROOT/src/utils"
    if [ ! -d "$helpers_dir" ]; then
        local m="(directorio src/utils no encontrado)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local helper_files=""
    helper_files=$(find "$helpers_dir" -name "*.helper.js" -type f 2>/dev/null | sort)
    if [ -z "$helper_files" ]; then
        local m="(ningun *.helper.js encontrado)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local _out=""
    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        local hlines; hlines=$(wc -l < "$hfile" 2>/dev/null || echo "?")
        _out+="### $hname ($hlines lineas)"$'\n'
        _out+="Funciones:"$'\n'
        local funcs=""
        funcs=$(grep -E "^(module\.)?exports\." "$hfile" 2>/dev/null | sed 's/^.*exports\.//; s/ =.*//' | sort -u || true)
        if [ -z "$funcs" ]; then
            funcs=$(sed -n '/module\.exports\s*=\s*{/,/}/p' "$hfile" 2>/dev/null \
                | sed 's|//.*||; s|/\*.*\*/||' \
                | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*' \
                | grep -vE '^(module|exports|require|const|let|var|async|function|return|true|false|null|undefined)$' \
                | awk 'length >= 4' \
                || true)
        fi
        if [ -n "$funcs" ]; then
            while IFS= read -r fn; do [ -n "$fn" ] && _out+="  - $fn()"$'\n'; done <<< "$funcs"
        else _out+="  (sin exports detectados)"$'\n'; fi
        local helper_require_name; helper_require_name=$(basename "$hfile" .js)
        # [v60-FIX] Buscar consumidores tanto en controllers como en otros helpers.
        # Los falsos negativos se daban con tesoreria.helper.js (consumido por
        # pagos-proveedores.helper FASE 5.5) y remito-pago-sync.helper.js
        # (consumido por pagos.helper.registrarPago). Eran helper->helper.
        local consumidores_ctrl consumidores_help
        consumidores_ctrl=$(grep -rl "$helper_require_name" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sort -u || true)
        consumidores_help=$(grep -rl "$helper_require_name" "$PROJECT_ROOT/src/utils" --include="*.helper.js" 2>/dev/null \
            | grep -v "/${hname}\$" | sort -u || true)
        _out+="Consumidores:"$'\n'
        if [ -n "$consumidores_ctrl" ]; then
            while IFS= read -r cons; do [ -n "$cons" ] && _out+="  - $(basename "$cons")"$'\n'; done <<< "$consumidores_ctrl"
        fi
        if [ -n "$consumidores_help" ]; then
            while IFS= read -r cons; do [ -n "$cons" ] && _out+="  - $(basename "$cons") [helper]"$'\n'; done <<< "$consumidores_help"
        fi
        if [ -z "$consumidores_ctrl" ] && [ -z "$consumidores_help" ]; then
            _out+="  (sin consumidores detectados — posible helper huerfano)"$'\n'
        fi
        _out+=""$'\n'
    done <<< "$helper_files"
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# Funcion auxiliar: elegir helper canonico por nombre con scoring
# robusto. Algoritmo:
#   1. match exacto normalizado (sin -/_) -> score 10000
#   2. tabla CONTIENE helper o helper CONTIENE tabla -> score = len_helper * 10
#   3. prefix_len (chars iniciales en comun normalizado) -> score base
#   4. bonus: por cada palabra >=5 chars del helper que aparece en tabla -> +5*len
# Resultado: stdout = path completo del helper ganador (vacio si ninguno)
_elegir_helper_canonico() {
    local tabla="$1"; shift
    local candidatos="$@"   # lista separada por espacios o newlines de paths a *.helper.js

    local tabla_norm; tabla_norm=$(echo "$tabla" | tr -d '_-' | tr 'A-Z' 'a-z')
    local best_helper=""
    local best_score=0

    while IFS= read -r hp; do
        [ -z "$hp" ] && continue
        local bn; bn=$(basename "$hp" .helper.js)
        local bn_norm; bn_norm=$(echo "$bn" | tr -d '_-' | tr 'A-Z' 'a-z')
        local score=0

        if [ "$bn_norm" = "$tabla_norm" ]; then
            score=10000
        elif [ -n "$bn_norm" ] && { [[ "$tabla_norm" == *"$bn_norm"* ]] || [[ "$bn_norm" == *"$tabla_norm"* ]]; }; then
            score=$(( ${#bn_norm} * 10 ))
        else
            # prefix_len
            local pl=0 i=0
            while [ "$i" -lt "${#tabla_norm}" ] && [ "$i" -lt "${#bn_norm}" ]; do
                if [ "${tabla_norm:$i:1}" = "${bn_norm:$i:1}" ]; then
                    i=$((i+1))
                else
                    break
                fi
            done
            pl=$i
            score=$pl
            # bonus por palabras del basename original (con separadores)
            local IFS_OLD="$IFS"
            IFS='-_'
            local word
            for word in $bn; do
                if [ "${#word}" -ge 5 ] && [[ "$tabla_norm" == *"$(echo "$word" | tr 'A-Z' 'a-z')"* ]]; then
                    score=$((score + ${#word} * 5))
                fi
            done
            IFS="$IFS_OLD"
        fi

        if [ "$score" -ge 4 ] && [ "$score" -gt "$best_score" ]; then
            best_score=$score
            best_helper="$hp"
        fi
    done <<< "$(echo "$candidatos" | tr ' ' '\n')"

    echo "$best_helper"
}

# =======================================================================================
# [v69] Fuente UNICA del helper "dueno de escrituras" de una tabla.
# Antes §10 y MIGRACION lo calculaban con grep|head -1 incluyendo FROM, asi que
# elegian cualquier LECTOR como dueno (empresas->notas-print, clientes->carrito-web,
# pedidos->pagos.helper). §8 ya lo hacia bien; esta funcion generaliza ese criterio:
#   (1) solo helpers que ESCRIBEN (INSERT/UPDATE/DELETE, nunca FROM)
#   (2) entre ellos, scorer por nombre (_elegir_helper_canonico)
#   (3) si el scorer no decide, el de mas writes
# =======================================================================================
_helper_canonico_de_tabla() {
    local tabla="$1"
    if [ -z "${UTILS_DIR:-}" ] || [ ! -d "$UTILS_DIR" ]; then echo ""; return 0; fi
    local escritores
    escritores=$(grep -rlE "INSERT INTO ${tabla}\b|UPDATE ${tabla}\b|DELETE FROM ${tabla}\b" \
        "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | sort -u)
    if [ -z "$escritores" ]; then echo ""; return 0; fi
    local canon
    canon=$(_elegir_helper_canonico "$tabla" "$escritores")
    if [ -z "$canon" ]; then
        canon=$(while IFS= read -r hp; do
            [ -z "$hp" ] && continue
            local cnt; cnt=$(grep -cE "INSERT INTO ${tabla}\b|UPDATE ${tabla}\b|DELETE FROM ${tabla}\b" "$hp" 2>/dev/null); [ -z "$cnt" ] && cnt=0
            echo "$cnt $hp"
        done <<< "$escritores" | sort -rn | head -1 | awk '{print $2}')
    fi
    echo "$canon"
}

calcular_progreso_migracion() {
    # [v60-FIX] La logica anterior comparaba 'directo' contra 'archivos_distintos'
    # pero AMBOS provenian del mismo grep (controllers que tienen INSERT/UPDATE
    # directo a la tabla). Por construccion siempre eran iguales -> todo SIN MIGRAR.
    # Logica nueva: contar (a) controllers con SQL directo a la tabla y (b)
    # controllers que hacen require() del helper de esa tabla. Si los que la
    # escriben directo bajaron a 0 y hay consumidores via require -> MIGRADO.
    local destino="${1:-}"
    if [ ! -d "$CONTROLLERS_DIR" ]; then
        local m="(sin directorio de controllers)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local tablas_dispersas=""
    tablas_dispersas=$(grep -roh "INSERT INTO [a-z_]*\|UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
        | sed 's/INSERT INTO //; s/UPDATE //; s/ SET//' | sort | uniq -c | sort -rn | awk '$1 >= 3 {print $2}' || true)
    if [ -z "$tablas_dispersas" ]; then
        local m="(ninguna tabla con 3+ writes dispersos en controllers)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local _out=""
    _out+="| Tabla | Writes directos | Helper | Controllers via require | Estado |"$'\n'
    _out+="|-------|----------------|--------|--------------------------|--------|"$'\n'
    while IFS= read -r tabla; do
        [ -z "$tabla" ] && continue
        local total_inserts archivos_directos
        total_inserts=$(grep -rc "INSERT INTO ${tabla}\|UPDATE ${tabla} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
            | awk -F: '{s+=$2} END{print s+0}')
        archivos_directos=$(grep -rl "INSERT INTO ${tabla}\|UPDATE ${tabla} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l)
        archivos_directos=$(echo "$archivos_directos" | tr -d '[:space:]')
        [ "${archivos_directos:-0}" -lt 2 ] && continue
        local helper_name="-" estado="" archivos_via_helper=0
        if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
            local found_helper=""
            found_helper=$(_helper_canonico_de_tabla "$tabla")
            if [ -n "$found_helper" ]; then
                helper_name=$(basename "$found_helper")
                local helper_module; helper_module=$(basename "$found_helper" .js)
                # Cuantos controllers HACEN require() del helper
                archivos_via_helper=$(grep -rl "require.*${helper_module}\|from.*['\"].*${helper_module}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l)
                archivos_via_helper=$(echo "$archivos_via_helper" | tr -d '[:space:]')
                if [ "${archivos_via_helper:-0}" -gt 0 ] && [ "${archivos_directos:-0}" -gt 0 ]; then
                    estado="PARCIAL"
                elif [ "${archivos_via_helper:-0}" -gt 0 ] && [ "${archivos_directos:-0}" -eq 0 ]; then
                    estado="MIGRADO"
                else
                    estado="SIN MIGRAR"
                fi
            else estado="SIN HELPER"; fi
        else estado="SIN HELPER"; fi
        _out+="| $tabla | $total_inserts en $archivos_directos archivos | $helper_name | $archivos_via_helper | $estado |"$'\n'
    done <<< "$tablas_dispersas"
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# DETECCION ESTADO MULTI-EMPRESA (escanea BD + código)
# =======================================================================================

detectar_estado_multiempresa() {
    local destino="${1:-}"
    local _out=""

    if ! verificar_bd; then
        _out+="(BD no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # --- 1. Contar tablas con/sin id_empresa (v59: BASE TABLE + excluir _backup_*) ---
    # Fix v59: antes reportaba "Total 118 | Con 114 | Compartidas 4" pero la lista de abajo
    # enumeraba 25. Desacople porque con_empresa incluía vistas y el total solo BASE TABLE.
    local total_tablas con_empresa sin_empresa total_backups
    total_tablas=$(_run_sql \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE '\_backup\_%' AND table_name NOT LIKE '\_bak\_%' AND table_name NOT LIKE 'stg\_%'")
    con_empresa=$(_run_sql \
        "SELECT COUNT(DISTINCT c.table_name) FROM information_schema.columns c JOIN information_schema.tables t ON c.table_schema=t.table_schema AND c.table_name=t.table_name WHERE c.table_schema='public' AND c.column_name='id_empresa' AND t.table_type='BASE TABLE' AND t.table_name NOT LIKE '\_backup\_%'
        AND t.table_name NOT LIKE '\_bak\_%'
        AND t.table_name NOT LIKE 'stg\_%'")
    total_backups=$(_run_sql \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name LIKE '\_backup\_%'")
    sin_empresa=$((total_tablas - con_empresa))

    _out+="**Tablas vivas:** ${total_tablas} (Con id_empresa: ${con_empresa} | Compartidas: ${sin_empresa} | Backups ignorados: ${total_backups})"$'\n'$'\n'

    # --- 2. Tablas compartidas (sin id_empresa, excluyendo backups) ---
    _out+="**Compartidas (catalogo global):**"$'\n'
    local compartidas=""
    compartidas=$(_run_sql "
        SELECT string_agg(t.table_name, ', ' ORDER BY t.table_name)
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT LIKE '\_backup\_%'
        AND t.table_name NOT LIKE '\_bak\_%'
        AND t.table_name NOT LIKE 'stg\_%'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'id_empresa'
        )
    ")
    _out+="${compartidas}"$'\n'$'\n'

    # --- 3. Constraints clave ---
    _out+="**Constraints multi-empresa:**"$'\n'
    local precios_pk=""
    precios_pk=$(_run_sql "
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum)
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'precios'::regclass AND i.indisprimary")
    _out+="- precios PK: (${precios_pk})"$'\n'

    local pp_unique=""
    pp_unique=$(_run_sql "
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum)
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'producto_proveedor'::regclass AND i.indisunique AND NOT i.indisprimary
        LIMIT 1")
    _out+="- producto_proveedor UNIQUE: (${pp_unique})"$'\n'

    # --- 4. Función inicializar_empresa ---
    local func_existe=""
    func_existe=$(_run_sql "SELECT 1 FROM pg_proc WHERE proname='inicializar_empresa'")
    if [ "$func_existe" = "1" ]; then
        _out+="- inicializar_empresa(): EXISTE en BD"$'\n'
    else
        _out+="- inicializar_empresa(): NO EXISTE"$'\n'
    fi
    _out+=$'\n'

    # --- 5. Empresas activas ---
    _out+="**Empresas activas:**"$'\n'
    local empresas_info=""
    empresas_info=$(_run_sql \
        "SELECT 'ID ' || id_empresa || ': ' || COALESCE(nombre_fantasia, razon_social) FROM empresas WHERE activa = true ORDER BY id_empresa")
    _out+="${empresas_info}"$'\n'$'\n'

    # --- 6. SELECTs sin filtro id_empresa en tablas criticas ---
    _out+="**Queries sin filtro id_empresa (riesgo aislamiento):**"$'\n'
    if [ -d "${CONTROLLERS_DIR:-}" ]; then
        local tablas_empresa=""
        tablas_empresa=$(_run_sql "
            SELECT DISTINCT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='id_empresa'
            AND table_name IN ('pagos','precios','listasdeprecios','metodosdepago','formas_pago',
                'cotizaciones','rol_modulos','producto_proveedor','configuracion_sistema')
        ")
        local hay_problemas=0
        if [ -n "$tablas_empresa" ]; then
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                local selects_sin=0
                # Buscar FROM tabla sin id_empresa en la misma linea (excluir comentarios)
                selects_sin=$(grep -rn "FROM ${tbl}\b" "${CONTROLLERS_DIR}" "${UTILS_DIR:-/dev/null}" --include="*.js" 2>/dev/null \
                    | grep -v "node_modules" | grep -v "id_empresa" | grep -v "^\s*//" | wc -l || echo "0")
                if [ "$selects_sin" -gt 0 ]; then
                    _out+="- [WARN] ${tbl}: ${selects_sin} queries sin filtro id_empresa"$'\n'
                    hay_problemas=1
                    # Mostrar archivo:linea + snippet de las primeras 3 queries
                    local muestras
                    muestras=$(grep -rn "FROM ${tbl}\b" "${CONTROLLERS_DIR}" "${UTILS_DIR:-/dev/null}" --include="*.js" 2>/dev/null \
                        | grep -v "node_modules" | grep -v "id_empresa" | grep -v ":\s*//" | head -3 || true)
                    if [ -n "$muestras" ]; then
                        while IFS= read -r linea; do
                            [ -z "$linea" ] && continue
                            local fname; fname=$(echo "$linea" | cut -d: -f1 | xargs basename 2>/dev/null)
                            local lnum; lnum=$(echo "$linea" | cut -d: -f2)
                            local snippet; snippet=$(echo "$linea" | cut -d: -f3- | head -c 100 | tr -s '[:space:]' ' ')
                            _out+="    - ${fname}:${lnum} → ${snippet}"$'\n'
                        done <<< "$muestras"
                    fi
                fi
            done <<< "$tablas_empresa"
        fi
        [ "$hay_problemas" -eq 0 ] && _out+="- [OK] Todas las tablas criticas filtran por id_empresa"$'\n'
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# VERIFICACION INTEGRIDAD AUDITORIA MULTI-EMPRESA (2026-03-01)
# =======================================================================================
# Verifica que los 55+ fixes de la auditoría multi-empresa sigan intactos.
# Chequea: INSERTs sin id_empresa, SELECTs sin filtro, cache keys, firmas helpers,
# ON CONFLICT con constraints correctos, retornos de verificarAcceso*.
# =======================================================================================

# =======================================================================================
# HELPER: Verificación context-aware de SQL multi-línea
# =======================================================================================

_check_sql_context() {
    local archivo="$1" linea="$2" patron="$3" context_lines="${4:-12}"
    local end_line=$((linea + context_lines))
    sed -n "${linea},${end_line}p" "$archivo" 2>/dev/null | grep -q "$patron"
}

_TABLAS_ENTERPRISE_CACHE=""
_get_tablas_enterprise() {
    # Filtra _backup_* — no son tablas vivas.
    if [ -n "$_TABLAS_ENTERPRISE_CACHE" ]; then echo "$_TABLAS_ENTERPRISE_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_ENTERPRISE_CACHE=$(_run_sql "
            SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='id_empresa'
              AND table_name NOT LIKE '\_backup\_%'
            INTERSECT
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_type='BASE TABLE'
              AND table_name NOT LIKE '\_backup\_%' ORDER BY 1")
    fi
    echo "$_TABLAS_ENTERPRISE_CACHE"
}

_TABLAS_COMPARTIDAS_CACHE=""
_get_tablas_compartidas() {
    if [ -n "$_TABLAS_COMPARTIDAS_CACHE" ]; then echo "$_TABLAS_COMPARTIDAS_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_COMPARTIDAS_CACHE=$(_run_sql "
            SELECT t.table_name FROM information_schema.tables t
            WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='id_empresa')
            ORDER BY 1")
    fi
    echo "$_TABLAS_COMPARTIDAS_CACHE"
}

# =======================================================================================
# VERIFICACION INTEGRIDAD MULTI-EMPRESA (context-aware, auto-detect)
# =======================================================================================

verificar_auditoria_multiempresa() {
    # =====================================================================
    # ARCHIVOS BY-DESIGN EXCLUIDOS DEL CHECK 1 (INSERTs/UPDATEs sin id_empresa)
    # =====================================================================
    # Los siguientes helpers escriben SIN id_empresa por diseno arquitectonico
    # documentado. NO son bugs. El Check 1 los flagea pero deben tratarse como
    # SKIP. Para que cualquier sesion futura entienda la razon:
    #
    #   afip-auditoria.helper.js
    #     -> usa pool propio (no la TX del caller) para que la escritura de
    #        auditoria a afip_solicitudes sobreviva a ROLLBACKs.
    #        Razon: incidente May 2026 con 7 NC de AFIP autorizadas pero solo
    #        1 persistida en DB. La auditoria DEBE quedar registrada aunque
    #        el resto de la transaccion falle.
    #     -> id_empresa se obtiene desde la sesion/cookie en cada llamada,
    #        NO se requiere en la firma del helper.
    #
    # Si el Check 1 reporta este archivo como FAIL, IGNORAR (es by-design).
    # =====================================================================
    local CHECK1_EXCLUDE_RE='afip-auditoria\.helper\.js'

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

    # Guard: si no hay BD disponible, NO podemos distinguir tablas compartidas
    # de enterprise. Sin esa lista, los Check 1 y 2 generan falsos positivos
    # masivos (ejemplo real: marcar productos como vulnerable cuando es compartida).
    # Mejor SKIP completo que reportar basura.
    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible — no puedo determinar tablas compartidas vs enterprise"$'\n'
        _out+="- Los checks 1 y 2 requieren BD UP para distinguir falsos positivos."$'\n'
        _out+="- Verificá: PGPASSWORD='...' psql -h localhost -U juanpablo -d erplago -c 'SELECT 1'"$'\n'
        _out+="**Estado: ⏭️  SKIP — BD no disponible**"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # ═══ CHECK 1: INSERTs/UPDATEs sin id_empresa (CONTEXT-AWARE) ═══
    _out+="**Check 1: INSERTs/UPDATEs en helpers (context-aware, ±40 líneas)**"$'\n'
    local tablas_compartidas=""
    tablas_compartidas=$(_get_tablas_compartidas 2>/dev/null || true)
    local real_fails=0 total_inserts=0 fails_detail=""

    while IFS=: read -r file linenum rest; do
        [ -z "$file" ] && continue
        total_inserts=$((total_inserts + 1))
        local tabla_name=""
        tabla_name=$(sed -n "${linenum}p" "$file" 2>/dev/null | grep -oP 'INSERT INTO \K[a-z_]+|UPDATE \K[a-z_]+' || true)
        [ -z "$tabla_name" ] && continue
        # Skip compartidas
        echo "$tablas_compartidas" | grep -q "^${tabla_name}$" 2>/dev/null && continue
        # Skip comentarios JSDoc
        sed -n "${linenum}p" "$file" 2>/dev/null | grep -qP '^\s*\*' && continue
        # Context-aware: buscar id_empresa en bloque SQL (30 líneas para cubrir UPDATEs largos)
        if ! _check_sql_context "$file" "$linenum" "id_empresa" 40; then
            real_fails=$((real_fails + 1))
            fails_detail+="  $(basename "$file"):${linenum}: INSERT/UPDATE INTO ${tabla_name}"$'\n'
        fi
    done < <(grep -rn "INSERT INTO [a-z_]\|UPDATE [a-z_].* SET" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v ".bak" | grep -v "^\s*//" || true)

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
            # [v60 FIX] Bloque +/-40 (era +/-25). Razon: destructure de id_empresa
            # esta al inicio de la funcion, queries pueden estar 30-40 lineas adentro.
            local start_line=$((linenum - 40)); [ "$start_line" -lt 1 ] && start_line=1
            local end_line=$((linenum + 40))
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

    # ═══ CHECK 5: Firmas helpers (v59 — stateless-aware, v68 — whitelist documentada) ═══
    # v58 generaba 67 FPs sobre helpers puros (iva, texto, cuit-lookup, excel, etc).
    # Nueva lógica: helper que no toca NINGUNA tabla enterprise via SQL es stateless.
    # Convención documentada: `@scope stateless|pure|shared-catalog` en JSDoc del helper
    # para SKIP explícito. Funciones privadas/puras usan prefijo `_` o `@pure` JSDoc.
    # [v68 FIX-13] Whitelist de helpers stateless-by-design que escriben con `pool`
    # propio para sobrevivir a ROLLBACKs del caller (no tienen client/id_empresa
    # en firma por diseno, no es bug).
    local STATELESS_DOCUMENTADOS="afip-auditoria.helper.js"
    _out+="**Check 5: Firmas helpers (stateless-aware)**"$'\n'
    local helpers_checked=0 helpers_ok=0 helpers_skip=0
    # Excluir tablas de config del set enterprise.
    local ent_alt=""
    ent_alt=$(echo "$tablas_enterprise" | grep -v "^$" \
        | grep -vE '^(configuraciones_empresa|configuracion_empresa_extendida|configuracion_sistema)$' \
        | tr '\n' '|' | sed 's/|$//')
    [ -z "$ent_alt" ] && ent_alt="pedidos|pagos|clientes|facturas|recibos|inventario"
    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        # [v68 FIX-13] (0) SKIP whitelist documentada (escriben con pool propio)
        if [[ " $STATELESS_DOCUMENTADOS " == *" $hname "* ]]; then
            _out+="- [SKIP] ${hname} → stateless por diseno documentado (pool propio)"$'\n'
            helpers_skip=$((helpers_skip+1)); continue
        fi
        # (1) SKIP si marcador @scope stateless/pure/shared-catalog
        if head -40 "$hfile" 2>/dev/null | grep -qE '@scope[[:space:]]+(stateless|pure|shared-catalog)'; then
            _out+="- [SKIP] ${hname} → marcador @scope stateless/pure"$'\n'
            helpers_skip=$((helpers_skip+1)); continue
        fi
        # (2) SKIP si helper no ejecuta SQL sobre tablas enterprise
        if ! grep -qE "(INSERT INTO|UPDATE|FROM|JOIN|DELETE FROM) (${ent_alt})\b" "$hfile" 2>/dev/null; then
            _out+="- [SKIP] ${hname} → no toca tablas enterprise (stateless)"$'\n'
            helpers_skip=$((helpers_skip+1)); continue
        fi
        # (3) Helper enterprise: verificar firmas función por función
        local funcs_exported; funcs_exported=$(grep -oP '(?<=exports\.)\w+' "$hfile" 2>/dev/null | sort -u || true)
        if [ -z "$funcs_exported" ]; then
            funcs_exported=$(sed -n '/module\.exports/,/}/p' "$hfile" 2>/dev/null | grep -oP '[a-zA-Z_]\w+' | grep -vP '^(module|exports|require|const|let|var)$' | sort -u || true)
        fi
        [ -z "$funcs_exported" ] && continue
        local missing=0
        while IFS= read -r fn; do
            [ -z "$fn" ] && continue
            # Skip UPPERCASE-only (constantes)
            if echo "$fn" | grep -qP '^[A-Z_]+$'; then continue; fi
            # Skip prefijo _ (privadas por convención)
            if echo "$fn" | grep -qP '^_'; then continue; fi
            # Skip funciones puras por patrón idiomatic de nombre.
            case "$fn" in
                calcular*|normalizar*|redondear*|formatear*|limpiar*|convertir*|separar*|comparar*|parsear*|leer*|inspeccionar*|determinar*|ajustar*|validar*|verificar*|hashear*|encriptar*|desencriptar*|slug*|detectar*) continue ;;
                netoAFinal|finalANeto|aplicarMargenACosto|tipoDisplay|configs|esRutaSoporte|generarTokenHex|invalidateAll|invalidarTodoElCache|parse|de|si) continue ;;
            esac
            # Skip si JSDoc arriba tiene @pure o @stateless
            local fline; fline=$(grep -n "async.*${fn}\b\|function.*${fn}\b\|const ${fn}" "$hfile" 2>/dev/null | head -1 | cut -d: -f1 || true)
            if [ -n "$fline" ] && [ "$fline" -gt 5 ]; then
                local start=$((fline - 5))
                if sed -n "${start},${fline}p" "$hfile" 2>/dev/null | grep -qE '@(pure|stateless)'; then
                    continue
                fi
            fi
            if echo "$fn" | grep -qP '^(require|compras|comprasHelper|si|de)$'; then continue; fi
            local fdef; fdef=$(grep -A5 "async.*${fn}\b\|function.*${fn}\b\|const ${fn}" "$hfile" 2>/dev/null | head -6 || true)
            if [ -n "$fdef" ] && ! echo "$fdef" | grep -q "id_empresa\|datos\|params\|options\|client\|pool\|req"; then
                _out+="- [WARN] ${hname} → ${fn}() sin id_empresa/datos en firma"$'\n'
                missing=1; warnings=$((warnings+1))
            fi
        done <<< "$funcs_exported"
        helpers_checked=$((helpers_checked+1))
        [ "$missing" -eq 0 ] && helpers_ok=$((helpers_ok+1))
    done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)
    _out+="- Enterprise verificados: ${helpers_checked} | OK: ${helpers_ok} | Stateless saltados: ${helpers_skip}"$'\n'$'\n'

    # ═══ CHECK 6: NOT NULL en BD ═══
    _out+="**Check 6: NOT NULL constraint en id_empresa (BD)**"$'\n'
    if verificar_bd 2>/dev/null; then
        # [v60 FIX] Excluir tablas _backup_* (no son operativas - son respaldos historicos).
        local nc; nc=$(_run_sql "
            SELECT COUNT(*) FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name=t.table_name AND c.table_schema=t.table_schema
            WHERE c.column_name='id_empresa' AND c.table_schema='public'
            AND t.table_type='BASE TABLE' AND c.is_nullable='YES'
            AND c.table_name NOT LIKE '\_backup\_%' AND table_name NOT LIKE '\_bak\_%' AND table_name NOT LIKE 'stg\_%'")
        if [ "${nc:-0}" = "0" ]; then
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

# =======================================================================================
# DETECCION DE FEATURES ESPECIALES (columnas custom, endpoints, filtros)
# =======================================================================================

# =======================================================================================
# VERIFICACION DATOS SEMILLA (registros obligatorios en BD)
# =======================================================================================

verificar_datos_semilla() {
    local destino="${1:-}"
    local _out=""
    local errores=0

    _out+="### VERIFICACION DATOS SEMILLA"$'\n'
    _out+="Registros que DEBEN existir para que el sistema funcione."$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # 1. Cliente Consumidor Final (por config ID, no por nombre)
    local cf_id=""
    cf_id=$(_run_sql "SELECT valor FROM configuraciones_empresa WHERE id_empresa=1 AND clave='clientes.id_consumidor_final'")
    if [ -n "$cf_id" ]; then
        local cf_exists=""
        cf_exists=$(_run_sql "SELECT razon_social FROM clientes WHERE id_cliente=$cf_id AND id_empresa=1")
        if [ -n "$cf_exists" ]; then
            _out+="- [OK] Config clientes.id_consumidor_final=$cf_id ($cf_exists)"$'\n'
        else
            _out+="- [FAIL] Config clientes.id_consumidor_final=$cf_id pero cliente NO existe"$'\n'
            errores=$((errores + 1))
        fi
    else
        _out+="- [FAIL] Config clientes.id_consumidor_final NO configurada"$'\n'
        errores=$((errores + 1))
    fi

    # 2. pedidoestados (caso especial: necesita estado 99=Recuperado)
    local pe_count="" pe_99=""
    pe_count=$(_table_count "pedidoestados")
    pe_99=$(_run_sql "SELECT COUNT(*) FROM pedidoestados WHERE id_estado = 99")
    if [ "${pe_count:-0}" -gt 3 ] && [ "${pe_99:-0}" -gt 0 ]; then
        _out+="- [OK] pedidoestados: $pe_count estados (incl. 99=Recuperado)"$'\n'
    else
        _out+="- [WARN] pedidoestados: $pe_count estados, 99=Recuperado: $pe_99"$'\n'
        [ "${pe_count:-0}" -lt 3 ] && errores=$((errores + 1))
    fi

    # 3-5. Checks estandar con _check_semilla (tabla, minimo, label, msg_fail)
    _out+="$(_check_semilla "factura_tipos" 3 "tipos" "necesita A, B, C minimo")"$'\n'
    _out+="$(_check_semilla "condicionesiva" 4 "condiciones" "necesita RI, Monotributo, Exento, CF minimo")"$'\n'
    _out+="$(_check_semilla "alicuotasiva" 3 "alicuotas" "necesita 21%, 10.5%, 0% minimo")"$'\n'

    # 6. monedas (warn, no fail)
    local mon_count=""
    mon_count=$(_table_count "monedas")
    if [ "${mon_count:-0}" -ge 2 ]; then
        _out+="- [OK] monedas: $mon_count (ARS + USD)"$'\n'
    else
        _out+="- [WARN] monedas: solo $mon_count"$'\n'
    fi

    # 7. Config AFIP
    local afip_count=""
    afip_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'afip_%'")
    if [ "${afip_count:-0}" -ge 5 ]; then
        _out+="- [OK] Config AFIP: $afip_count claves"$'\n'
    else
        _out+="- [WARN] Config AFIP: solo $afip_count claves (esperado 7)"$'\n'
    fi

    # 8. Config keys de productos (v44)
    local prod_cfg=""
    prod_cfg=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'productos.%'")
    if [ "${prod_cfg:-0}" -ge 2 ]; then
        _out+="- [OK] Config productos: $prod_cfg claves"$'\n'
    else
        _out+="- [WARN] Config productos: $prod_cfg claves (esperado 2: alicuota_iva_defecto, limite_resultados_busqueda)"$'\n'
    fi

    # 9. Config keys personalizadas (v44)
    local custom_cfg=""
    custom_cfg=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'cotizacion.%' OR clave LIKE 'entregas.%' OR clave LIKE 'stock.%' OR clave LIKE 'pagos.%'")
    if [ "${custom_cfg:-0}" -ge 3 ]; then
        _out+="- [OK] Config personalizadas: $custom_cfg claves (cotizacion/entregas/stock/pagos)"$'\n'
    else
        _out+="- [WARN] Config personalizadas: $custom_cfg claves"$'\n'
    fi

    _out+=$'\n'
    # 10. es_fiado column exists (v46)
    local has_esfiado=""
    has_esfiado=$(_run_sql "SELECT 1 FROM information_schema.columns WHERE table_name='pedidos' AND column_name='es_fiado'")
    if [ "$has_esfiado" = "1" ]; then
        _out+="- [OK] pedidos.es_fiado existe"$'\n'
    else
        _out+="- [FAIL] pedidos.es_fiado NO existe (rediseño fiado pendiente)"$'\n'
        ((errores++))
    fi

    # 11. No pagos CC aprobados (v46)
    local cc_aprobados=""
    cc_aprobados=$(_run_sql "SELECT COUNT(*) FROM pagos WHERE id_metodo_pago=6 AND id_pago_estado=2")
    if [ "${cc_aprobados:-0}" -eq 0 ]; then
        _out+="- [OK] 0 pagos CC aprobados (fiado migrado)"$'\n'
    else
        _out+="- [WARN] $cc_aprobados pagos CC aun aprobados (migrar a es_fiado)"$'\n'
    fi

    # 12. Secuencias stock (v45)
    local seq_ar=""
    seq_ar=$(_run_sql "SELECT 1 FROM information_schema.sequences WHERE sequence_name='seq_ajuste_rapido'")
    if [ "$seq_ar" = "1" ]; then
        _out+="- [OK] Secuencia seq_ajuste_rapido existe"$'\n'
    else
        _out+="- [WARN] Secuencia seq_ajuste_rapido NO existe"$'\n'
    fi

    local seq_trf=""
    seq_trf=$(_run_sql "SELECT 1 FROM information_schema.sequences WHERE sequence_name='seq_transferencias'")
    if [ "$seq_trf" = "1" ]; then
        _out+="- [OK] Secuencia seq_transferencias existe"$'\n'
    else
        _out+="- [WARN] Secuencia seq_transferencias NO existe"$'\n'
    fi

    # 11. Triggers stock (v45)
    local trg_count=""
    trg_count=$(_run_sql "SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid WHERE c.relname='inventario_deposito' AND NOT t.tgisinternal")
    if [ "${trg_count:-0}" -ge 2 ]; then
        _out+="- [OK] Triggers inventario_deposito: $trg_count (sync_cache + alertas)"$'\n'
    else
        _out+="- [WARN] Triggers inventario_deposito: $trg_count (esperado 2)"$'\n'
    fi

    # 12. Funcion reconciliacion (v45)
    local recon=""
    recon=$(_run_sql "SELECT 1 FROM pg_proc WHERE proname='verificar_reconciliacion_stock'")
    if [ "$recon" = "1" ]; then
        _out+="- [OK] Funcion verificar_reconciliacion_stock() existe"$'\n'
    else
        _out+="- [WARN] Funcion verificar_reconciliacion_stock() NO existe"$'\n'
    fi

    _out+="**Resultado datos semilla:** ${errores} errores"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# VERIFICAR CONSTRAINTS vs TRIGGERS — Detecta desacoples
# =======================================================================================
verificar_constraints_triggers() {
    local destino="${1:-}"
    local _out=""
    local errores=0 warnings=0

    _out+="### VERIFICACION CONSTRAINTS vs TRIGGERS"$'\n'
    _out+="Detecta CHECK constraints cuyos valores no coinciden con lo que insertan los triggers."$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # 1. Obtener CHECK constraints con listas de valores (ARRAY o IN)
    local checks=""
    checks=$(_run_sql "
        SELECT conname, relname, pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class r ON c.conrelid = r.oid
        JOIN pg_namespace n ON r.relnamespace = n.oid
        WHERE c.contype = 'c' AND n.nspname = 'public'
        AND pg_get_constraintdef(c.oid) LIKE '%ANY%ARRAY%'
        ORDER BY relname, conname
    ")

    if [ -z "$checks" ]; then
        _out+="- [OK] No hay CHECK constraints con listas de valores"$'\n'
    else
        while IFS='|' read -r conname relname condef; do
            [ -z "$conname" ] && continue
            conname=$(echo "$conname" | xargs)
            relname=$(echo "$relname" | xargs)

            # Extraer columna del CHECK
            local col=""
            col=$(echo "$condef" | grep -oP '\(\(([a-z_]+)' | head -1 | sed 's/((//')

            if [ -z "$col" ]; then
                _out+="- [INFO] $relname.$conname: no pude extraer columna"$'\n'
                continue
            fi

            # Buscar triggers que insertan en esta tabla
            local trigger_vals=""
            trigger_vals=$(_run_sql "
                SELECT DISTINCT p.prosrc
                FROM pg_trigger t
                JOIN pg_proc p ON t.tgfoid = p.oid
                WHERE t.tgrelid = (SELECT oid FROM pg_class WHERE relname = '$relname')
                AND NOT t.tgisinternal
            ")

            if [ -z "$trigger_vals" ]; then
                _out+="- [OK] $relname.$conname: sin triggers que inserten"$'\n'
                continue
            fi

            # Extraer valores del CHECK constraint
            local check_vals=""
            check_vals=$(echo "$condef" | grep -oP "'[^']+'" | tr -d "'" | sort | tr '\n' ', ' | sed 's/,$//')

            # Extraer valores que los triggers usan para esa columna
            # [v56 FIX] Filtrar pg_notify/raise/format antes de extraer literales.
            # El primer arg de pg_notify(channel, payload) es nombre de canal LISTEN/NOTIFY,
            # no un valor de columna. Sin este filtro, triggers como
            # PERFORM pg_notify('new_print_job', NEW.id::text) generaban falso positivo
            # en print_jobs.print_jobs_status_check y print_jobs_type_check.
            local trigger_clean
            trigger_clean=$(echo "$trigger_vals" \
                | sed -E "s/pg_notify[[:space:]]*\\([^)]*\\)//g" \
                | sed -E "s/raise[[:space:]]+(notice|warning|exception|info|log|debug)[[:space:]]+'[^']*'//gI" \
                | sed -E "s/format[[:space:]]*\\([^)]*\\)//g")
            local trigger_insert_vals=""
            trigger_insert_vals=$(echo "$trigger_clean" | grep -oP "'[^']+'" | tr -d "'" | sort -u | tr '\n' ', ' | sed 's/,$//')

            # Comparar: buscar valores de trigger que no están en el CHECK
            local missing=""
            IFS=',' read -ra TVALS <<< "$trigger_insert_vals"
            for tv in "${TVALS[@]}"; do
                tv=$(echo "$tv" | xargs)
                [ -z "$tv" ] && continue
                if ! echo ",$check_vals," | grep -q ",$tv,"; then
                    missing+="$tv, "
                fi
            done

            if [ -n "$missing" ]; then
                missing=$(echo "$missing" | sed 's/, $//')
                _out+="- [FAIL] $relname.$conname ($col): trigger usa [$missing] pero CHECK no lo permite"$'\n'
                _out+="  CHECK permite: [$check_vals]"$'\n'
                _out+="  Trigger inserta: [$trigger_insert_vals]"$'\n'
                errores=$((errores + 1))
            else
                _out+="- [OK] $relname.$conname ($col): trigger y CHECK alineados"$'\n'
            fi
        done <<< "$checks"
    fi

    _out+=$'\n'
    # Check especifico: usuario_configuracion UNIQUE debe ser multi-empresa
    _out+="#### Check unique multi-empresa: usuario_configuracion"$'\n'
    local idx_def
    idx_def=$(_run_sql "
        SELECT pg_get_indexdef(i.indexrelid)
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indrelid
        WHERE c.relname='usuario_configuracion' AND i.indisunique=true
        LIMIT 5
    ")
    if [ -z "$idx_def" ]; then
        _out+="- [INFO] tabla usuario_configuracion sin unique index detectable (o no existe)"$'\n'
    else
        local tiene_emp=0
        while IFS= read -r line; do
            [ -z "$line" ] && continue
            if echo "$line" | grep -q "id_empresa"; then tiene_emp=1; fi
        done <<< "$idx_def"
        if [ "$tiene_emp" = "1" ]; then
            _out+="- [OK] usuario_configuracion: unique incluye id_empresa"$'\n'
        else
            _out+="- [WARN] BUG LATENTE conocido: usuario_configuracion UNIQUE(id_usuario) deberia ser UNIQUE(id_empresa, id_usuario)"$'\n'
            warnings=$((warnings + 1))
        fi
    fi
    _out+=$'\n'
    _out+="**Resultado constraints/triggers:** $errores errores, $warnings warnings"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# VERIFICAR SISTEMA IMPRESION (patron real verificado)
# =======================================================================================
# El ERP usa UN SOLO patron de impresion: HTML server-side desde plantilla .hbs,
# devuelto al browser cliente, que dispara window.print() via <script> al final.
# NO usa Puppeteer (descartado por RAM + bloqueo del ERP — ver leccion aprendida).
#
# Esta funcion verifica el patron real, no asume cola fiscal.
# Solo se invoca desde menu (opcion 13) o CLI (`impresion`).
verificar_sistema_impresion() {
    local destino="${1:-}"
    local _out=""

    _out+="### SISTEMA DE IMPRESION (patron real)"$'\n'
    _out+=$'\n'
    _out+="**Patron unico:** controller renderiza .hbs server-side -> devuelve HTML"$'\n'
    _out+="-> el browser cliente dispara window.print() via <script>window.onload=...</script>"$'\n'
    _out+="al final del template. Cero RAM en servidor, cero bloqueo."$'\n'
    _out+=$'\n'
    _out+="**NO usa Puppeteer.** Descartado por RAM + bloqueo del ERP cuando un job"$'\n'
    _out+="quedaba a medias. NO proponer cola Puppeteer/CUPS para nada nuevo."$'\n'
    _out+=$'\n'

    # ---- 1. PLANTILLAS EN DISCO ----
    _out+="#### Plantillas Handlebars en disco"$'\n'
    if [ -d "$PROJECT_ROOT/templates/comprobantes" ]; then
        local hbs_files
        hbs_files=$(find "$PROJECT_ROOT/templates/comprobantes" -maxdepth 2 -name "*.hbs" 2>/dev/null | grep -v "\.bak" | sort)
        if [ -n "$hbs_files" ]; then
            while IFS= read -r f; do
                [ -z "$f" ] && continue
                local sz; sz=$(wc -c < "$f" 2>/dev/null)
                local has_print="-"
                grep -q "window\.print" "$f" 2>/dev/null && has_print="auto-print OK"
                _out+="- [OK] $(basename "$f") (${sz} bytes, ${has_print})"$'\n'
            done <<< "$hbs_files"
        else
            _out+="- [WARN] templates/comprobantes/ existe pero esta vacia"$'\n'
        fi
    else
        _out+="- [FAIL] templates/comprobantes/ NO existe"$'\n'
    fi

    _out+=$'\n'
    _out+="#### Plantillas legacy (config/plantillas/)"$'\n'
    if [ -d "$PROJECT_ROOT/config/plantillas" ]; then
        local html_files
        html_files=$(find "$PROJECT_ROOT/config/plantillas" -maxdepth 1 \( -name "*.html" -o -name "*.json" \) 2>/dev/null | grep -v "\.bak" | sort)
        if [ -n "$html_files" ]; then
            while IFS= read -r f; do
                [ -z "$f" ] && continue
                local sz; sz=$(wc -c < "$f" 2>/dev/null)
                _out+="- [OK] $(basename "$f") (${sz} bytes)"$'\n'
            done <<< "$html_files"
        fi
    fi
    _out+=$'\n'

    # ---- 2. RUTAS DE PRINT ----
    _out+="#### Rutas en print.routes.js"$'\n'
    if [ -f "$PROJECT_ROOT/src/routes/print.routes.js" ]; then
        local rutas
        rutas=$(grep -E "router\.(get|post|put|delete)" "$PROJECT_ROOT/src/routes/print.routes.js" 2>/dev/null)
        if [ -n "$rutas" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                local clean
                clean=$(echo "$line" | sed -E 's/^[[:space:]]+//')
                _out+="    $clean"$'\n'
            done <<< "$rutas"
        fi
    else
        _out+="- [FAIL] src/routes/print.routes.js NO existe"$'\n'
    fi
    _out+=$'\n'

    # ---- 3. ARCHIVOS FRONTEND QUE DISPARAN IMPRESION ----
    _out+="#### Archivos frontend que disparan impresion (window.open + /print/)"$'\n'
    if [ -d "$PROJECT_ROOT/frontend/js" ]; then
        local hits
        hits=$(grep -rn "window\.open.*\/print\/" "$PROJECT_ROOT/frontend/js" --include="*.js" 2>/dev/null | grep -v "\.bak" | head -20)
        if [ -n "$hits" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                local file_part url_part
                file_part=$(echo "$line" | cut -d: -f1 | xargs basename)
                local lineno; lineno=$(echo "$line" | cut -d: -f2)
                _out+="- $file_part:$lineno"$'\n'
            done <<< "$hits"
        else
            _out+="- [WARN] No se encontraron archivos JS con window.open(/print/...)"$'\n'
        fi
    fi
    _out+=$'\n'

    # ---- 4. HANDLERS EN print.controller.js ----
    _out+="#### Handlers en print.controller.js"$'\n'
    if [ -f "$PROJECT_ROOT/src/controllers/print.controller.js" ]; then
        local handlers
        handlers=$(grep -nE "(async )?(function )?[a-zA-Z]+[[:space:]]*[:=]?[[:space:]]*(async )?\([^)]*\)[[:space:]]*=>|exports\.[a-zA-Z]+|^[[:space:]]*async [a-zA-Z]+\(" "$PROJECT_ROOT/src/controllers/print.controller.js" 2>/dev/null | head -15)
        # Mas simple: solo grep de exports
        local exports
        exports=$(grep -nE "module\.exports|exports\.[a-zA-Z]+" "$PROJECT_ROOT/src/controllers/print.controller.js" 2>/dev/null | head -10)
        if [ -n "$exports" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                _out+="    $line"$'\n'
            done <<< "$exports"
        fi
    else
        _out+="- [FAIL] src/controllers/print.controller.js NO existe"$'\n'
    fi
    _out+=$'\n'

    # ---- 5. TABLAS HISTORICAS (print_jobs / printers_config / log_impresiones) ----
    _out+="#### Tablas historicas (NO son el patron actual)"$'\n'
    _out+="*Estas tablas existen en BD pero el patron vigente NO las usa.*"$'\n'
    _out+="*Si tienen actividad reciente, son zombis o restos de un intento previo.*"$'\n'
    if verificar_bd 2>/dev/null; then
        for tbl in print_jobs printers_config log_impresiones; do
            if _table_exists "$tbl"; then
                local cnt; cnt=$(_table_count "$tbl")
                _out+="- $tbl: ${cnt:-0} registros"$'\n'
                if [ "$tbl" = "print_jobs" ] && [ "${cnt:-0}" -gt 0 ] 2>/dev/null; then
                    local zombi
                    zombi=$(_run_sql "SELECT COUNT(*) FROM print_jobs WHERE status IN ('PENDING','PROCESSING')")
                    if [ "${zombi:-0}" -gt 0 ] 2>/dev/null; then
                        _out+="    [INFO] ${zombi} jobs en PENDING/PROCESSING — zombis (no hay worker corriendo)"$'\n'
                    fi
                fi
            else
                _out+="- $tbl: no existe"$'\n'
            fi
        done
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=$'\n'

    _out+="**Resultado:** Mapeo del patron real. Para agregar un imprimible nuevo,"$'\n'
    _out+="ver receta de 4 pasos en PROMPT_MAESTRO.md seccion 'IMPRESION — RECETA REAL DEL ERP'."$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# VERIFICAR LAGO.AR (sitio servido desde VPS, modelo nuevo post-migracion)
# =======================================================================================
# El modelo viejo (FTP a Hostinger + cron + catalogo.json) fue desmantelado.
# Estado actual:
#   - DNS de lago.ar/www.lago.ar/app.lago.ar apuntan al VPS (72.60.148.18)
#   - nginx en VPS sirve estatico /var/www/lago-app + proxy /api/web/* al puerto 3000
#   - app.lago.ar y www.lago.ar redirigen 301 a lago.ar (canonical)
#   - Hostinger queda solo para correo, NO sirve mas la web
#   - 4 routes Node servidas: catalogo-web, carrito-web, auth-web, pedidos-web-admin
#   - Configs en BD: prefijo web.* (no mas catalogo_web.* ni lago_deploy.*)
#   - Tabla lago_deploy_log eliminada
verificar_lago_ar() {
    local destino="${1:-}"
    local _out=""

    _out+="### LAGO.AR — TIENDA WEB (servida desde VPS)"$'\n'$'\n'
    _out+="**Modelo:** nginx en VPS sirve estatico + proxy a Node /api/web/*."$'\n'
    _out+="**NO usa:** FTP a Hostinger, cron de deploy, catalogo.json estatico."$'\n'
    _out+="**Hostinger:** solo correo, NO web."$'\n'$'\n'

    # ---- 1. ROUTES NODE (controllers web) ----
    _out+="#### Routes Node servidas a lago.ar"$'\n'
    local web_routes="auth-web catalogo-web carrito-web pedidos-web-admin"
    for r in $web_routes; do
        if [ -f "$PROJECT_ROOT/src/routes/${r}.routes.js" ]; then
            local rcount; rcount=$(grep -cE "router\.(get|post|put|delete)" "$PROJECT_ROOT/src/routes/${r}.routes.js" 2>/dev/null); rcount=${rcount:-0}
            _out+="- [OK] ${r}.routes.js ($rcount rutas)"$'\n'
        else
            _out+="- [FAIL] ${r}.routes.js NO existe"$'\n'
        fi
    done
    _out+=$'\n'

    # ---- 2. CONTROLLERS / HELPERS ----
    _out+="#### Controllers/helpers web"$'\n'
    for f in \
        "src/controllers/auth-web.controller.js" \
        "src/controllers/catalogo-web.controller.js" \
        "src/controllers/carrito-web.controller.js" \
        "src/controllers/pedidos-web.controller.js" \
        "src/utils/auth-web.helper.js" \
        "src/utils/carrito-web.helper.js" \
        "src/utils/conjuntos-web.helper.js" \
        "src/utils/pedido-web.helper.js"; do
        if [ -f "$PROJECT_ROOT/$f" ]; then
            local lns; lns=$(wc -l < "$PROJECT_ROOT/$f" 2>/dev/null)
            _out+="- [OK] $f (${lns}L)"$'\n'
        fi
    done
    _out+=$'\n'

    # ---- 3. NGINX (config + sitio enabled) ----
    _out+="#### nginx (estado del sitio)"$'\n'
    if [ -f /etc/nginx/sites-enabled/lago.ar ]; then
        _out+="- [OK] /etc/nginx/sites-enabled/lago.ar existe"$'\n'
        # Verificar que tenga server_name lago.ar
        if grep -q "server_name lago.ar" /etc/nginx/sites-enabled/lago.ar 2>/dev/null; then
            _out+="- [OK] server_name lago.ar configurado"$'\n'
        fi
        # Verificar redirect 301 de www y app
        if grep -q "return 301 https://lago.ar" /etc/nginx/sites-enabled/lago.ar 2>/dev/null; then
            _out+="- [OK] redirect 301 www/app -> lago.ar (canonical)"$'\n'
        else
            _out+="- [WARN] sin redirect 301 a canonical lago.ar"$'\n'
        fi
        # Verificar proxy_pass a Node
        if grep -q "proxy_pass http://127.0.0.1:3000" /etc/nginx/sites-enabled/lago.ar 2>/dev/null; then
            _out+="- [OK] proxy_pass al backend Node :3000"$'\n'
        else
            _out+="- [WARN] no detectado proxy_pass al backend"$'\n'
        fi
        # Verificar location /api/web/
        if grep -q "location /api/web/" /etc/nginx/sites-enabled/lago.ar 2>/dev/null; then
            _out+="- [OK] location /api/web/ definida"$'\n'
        else
            _out+="- [WARN] sin location /api/web/ — backend web inaccesible"$'\n'
        fi
        # Verificar bloqueo /api/ generico (privacidad: solo /api/web/* publico)
        if grep -A1 "location /api/" /etc/nginx/sites-enabled/lago.ar 2>/dev/null | grep -q "return 404"; then
            _out+="- [OK] /api/* generico bloqueado (return 404) — solo /api/web/* publico"$'\n'
        else
            _out+="- [INFO] verificar manualmente que /api/* generico no este expuesto"$'\n'
        fi
        # Verificar root estatico
        local root_dir; root_dir=$(grep -oE "root /[^;]+" /etc/nginx/sites-enabled/lago.ar 2>/dev/null | head -1 | awk '{print $2}')
        if [ -n "$root_dir" ] && [ -d "$root_dir" ]; then
            local files_count; files_count=$(find "$root_dir" -maxdepth 2 -type f 2>/dev/null | wc -l)
            _out+="- [OK] root estatico: $root_dir ($files_count archivos)"$'\n'
        elif [ -n "$root_dir" ]; then
            _out+="- [FAIL] root configurado ($root_dir) pero NO existe en disco"$'\n'
        fi
    else
        _out+="- [FAIL] /etc/nginx/sites-enabled/lago.ar NO existe"$'\n'
    fi
    if command -v nginx >/dev/null 2>&1; then
        if nginx -t >/dev/null 2>&1; then
            _out+="- [OK] nginx -t syntax OK"$'\n'
        else
            _out+="- [WARN] nginx -t reporta errores (correr 'sudo nginx -t' para ver)"$'\n'
        fi
    fi
    _out+=$'\n'

    # ---- 4. SSL (Let's Encrypt) ----
    _out+="#### SSL (Let's Encrypt)"$'\n'
    if command -v certbot >/dev/null 2>&1; then
        local cert_info; cert_info=$(certbot certificates 2>/dev/null | grep -A4 "Certificate Name:" | grep -E "(Domains:|Expiry Date:)" | head -4)
        if [ -n "$cert_info" ]; then
            while IFS= read -r line; do
                _out+="- $line"$'\n'
            done <<< "$cert_info"
        else
            _out+="- [WARN] certbot instalado pero sin certificados detectados"$'\n'
        fi
    else
        _out+="- [SKIP] certbot no instalado (no se puede verificar SSL desde este script)"$'\n'
    fi
    _out+=$'\n'

    # ---- 5. CONFIGS BD (prefijo web.*) ----
    if verificar_bd 2>/dev/null; then
        _out+="#### Configs BD (web.* en configuraciones_empresa, id_empresa=1)"$'\n'
        local web_count; web_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE id_empresa=1 AND clave LIKE 'web.%'")
        _out+="- web.* total: ${web_count:-0} claves"$'\n'

        # Claves criticas que DEBEN existir
        local claves_criticas=(
            "web.id_empresa"
            "web.id_lista_precio_publica"
            "web.jwt_secret"
            "web.cookie_name"
            "web.cookie_secure"
            "web.login_obligatorio"
            "web.precio_visible_sin_login"
            "web.permitir_auto_registro"
        )
        local faltantes=0
        for clave in "${claves_criticas[@]}"; do
            local existe; existe=$(_run_sql "SELECT 1 FROM configuraciones_empresa WHERE id_empresa=1 AND clave='$clave'")
            if [ -z "$existe" ]; then
                _out+="- [FAIL] FALTA clave: $clave"$'\n'
                faltantes=$((faltantes + 1))
            fi
        done
        [ "$faltantes" -eq 0 ] && _out+="- [OK] Todas las claves criticas presentes"$'\n'

        # Detectar configs LEGACY (deberian estar borradas)
        local legacy; legacy=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE id_empresa=1 AND (clave LIKE 'lago_deploy.%' OR clave LIKE 'catalogo_web.%')")
        if [ "${legacy:-0}" -gt 0 ]; then
            _out+="- [WARN] ${legacy} configs legacy (lago_deploy.* / catalogo_web.*) — del modelo FTP viejo, considerar borrar"$'\n'
        else
            _out+="- [OK] Sin configs legacy del modelo FTP viejo"$'\n'
        fi
        _out+=$'\n'

        # ---- 6. ESTADO DE LA TIENDA (carritos, pedidos web, intentos login) ----
        _out+="#### Estado operativo de la tienda"$'\n'
        if _table_exists "carritos_web"; then
            local cw_total cw_activos
            cw_total=$(_table_count "carritos_web")
            cw_activos=$(_run_sql "SELECT COUNT(*) FROM carritos_web WHERE estado IN ('activo','en_checkout')")
            _out+="- carritos_web: ${cw_total:-0} total, ${cw_activos:-0} activos/en checkout"$'\n'
        fi
        if _table_exists "web_login_intentos"; then
            local wli; wli=$(_run_sql "SELECT COUNT(*) FROM web_login_intentos WHERE created_at > now() - interval '24 hours'")
            _out+="- web_login_intentos (24h): ${wli:-0}"$'\n'
        fi
        # Pedidos web (estados 20=pendiente_aprobacion, 21=aprobado_web)
        local pw_pendientes pw_aprobados
        pw_pendientes=$(_run_sql "SELECT COUNT(*) FROM pedidos WHERE id_estado=20")
        pw_aprobados=$(_run_sql "SELECT COUNT(*) FROM pedidos WHERE id_estado=21")
        _out+="- Pedidos web pendientes (estado 20): ${pw_pendientes:-0}"$'\n'
        _out+="- Pedidos web aprobados (estado 21): ${pw_aprobados:-0}"$'\n'
        _out+=$'\n'

        # ---- 7. AUDITORIA: artefactos del modelo viejo que deberian estar limpios ----
        _out+="#### Limpieza del modelo viejo (FTP/Hostinger)"$'\n'
        local artefactos_viejos=0
        for art in \
            "src/utils/lago-deploy.helper.js" \
            "src/controllers/lago-deploy.controller.js" \
            "src/routes/lago-deploy.routes.js" \
            "scripts/generar-catalogo-web.js" \
            "scripts/lago-cron-deploy.js" \
            "publico" \
            "catalogo-web"; do
            if [ -e "$PROJECT_ROOT/$art" ]; then
                _out+="- [WARN] Artefacto viejo aun presente: $art"$'\n'
                artefactos_viejos=$((artefactos_viejos + 1))
            fi
        done
        if _table_exists "lago_deploy_log" 2>/dev/null; then
            _out+="- [WARN] Tabla lago_deploy_log aun existe en BD"$'\n'
            artefactos_viejos=$((artefactos_viejos + 1))
        fi
        # Solo flagear crons del MODELO VIEJO concreto (nombres especificos), no menciones de "lago".
        # erplago-backup.log y similares son legitimos. Tampoco contar lineas comentadas (#).
        # [v60-FIX] grep -c con || echo 0 producia "0\n0" -> '[: integer expression expected'
        local cron_lago
        cron_lago=$(crontab -l 2>/dev/null \
            | grep -vE '^[[:space:]]*#' \
            | grep -cE '(lago-cron-deploy|generar-catalogo-web|ftp.*lago\.ar|lftp.*publico/)' \
            | tr -d '[:space:]')
        cron_lago="${cron_lago:-0}"
        if [ "$cron_lago" -gt 0 ] 2>/dev/null; then
            _out+="- [WARN] Crontab aun tiene ${cron_lago} entrada(s) del modelo FTP viejo activas"$'\n'
            artefactos_viejos=$((artefactos_viejos + 1))
        fi
        # Tambien chequear lineas comentadas del modelo viejo (zombies)
        # [v60-FIX] mismo problema que cron_lago
        local cron_comentado
        cron_comentado=$(crontab -l 2>/dev/null \
            | grep -E '^[[:space:]]*#' \
            | grep -cE '(lago-cron-deploy|generar-catalogo-web|lago-deploy)' \
            | tr -d '[:space:]')
        cron_comentado="${cron_comentado:-0}"
        if [ "$cron_comentado" -gt 0 ] 2>/dev/null; then
            _out+="- [INFO] Crontab tiene ${cron_comentado} linea(s) comentada(s) zombie del modelo viejo (limpiar manualmente)"$'\n'
        fi
        if [ "$artefactos_viejos" -eq 0 ]; then
            _out+="- [OK] Migracion limpia: cero artefactos del modelo viejo"$'\n'
        fi
    else
        _out+="- [SKIP] BD no disponible para verificar configs"$'\n'
    fi
    _out+=$'\n'

    _out+="**Frontend:** /var/www/lago-app/ (estatico, vanilla JS)"$'\n'
    _out+="**Backend:** Node :3000, expuesto via nginx solo en /api/web/*"$'\n'
    _out+="**Auth:** JWT cookie httpOnly, helper auth-web.helper.js"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# INTEGRIDAD REFERENCIAL — Foreign keys, triggers, unique idx, sequences, views
# =======================================================================================
verificar_integridad_referencial() {
    local FILE="${1:-}"
    local STANDALONE=0
    if [ -z "$FILE" ]; then
        FILE="$OUTPUT_DIR/INTEGRIDAD_REFERENCIAL.md"
        STANDALONE=1
        > "$FILE"
        echo "# INTEGRIDAD REFERENCIAL - ERP LAGO" >> "$FILE"
        echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$FILE"
        echo "" >> "$FILE"
    fi

    if ! verificar_bd; then
        echo "- [SKIP] BD no disponible" >> "$FILE"
        [ "$STANDALONE" -eq 1 ] && echo -e "${RED}BD no disponible${NC}"
        return
    fi

    # ============================================================
    # 1. FOREIGN KEYS
    # ============================================================
    echo "## 1. Foreign Keys" >> "$FILE"
    echo "" >> "$FILE"

    local fk_total fk_cascade fk_restrict fk_setnull fk_noaction fk_setdefault
    fk_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f'" 2>/dev/null || echo 0)
    fk_cascade=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='c'" 2>/dev/null || echo 0)
    fk_restrict=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='r'" 2>/dev/null || echo 0)
    fk_setnull=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='n'" 2>/dev/null || echo 0)
    fk_noaction=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='a'" 2>/dev/null || echo 0)
    fk_setdefault=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='d'" 2>/dev/null || echo 0)

    echo "**Total: ${fk_total} FKs**" >> "$FILE"
    echo "" >> "$FILE"
    echo "| ON DELETE | Cantidad |" >> "$FILE"
    echo "|---|---|" >> "$FILE"
    echo "| CASCADE | ${fk_cascade} |" >> "$FILE"
    echo "| RESTRICT | ${fk_restrict} |" >> "$FILE"
    echo "| SET NULL | ${fk_setnull} |" >> "$FILE"
    echo "| NO ACTION (default) | ${fk_noaction} |" >> "$FILE"
    echo "| SET DEFAULT | ${fk_setdefault} |" >> "$FILE"
    echo "" >> "$FILE"

    # Solo FKs con propagación (CASCADE/RESTRICT/SET NULL/SET DEFAULT) — son las que
    # cambian el comportamiento del DELETE. Las NO ACTION (mayoría, default) quedan fuera.
    # Para listado completo: psql -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE contype='f'"
    echo "### FKs con propagación (CASCADE/RESTRICT/SET NULL/SET DEFAULT)" >> "$FILE"
    echo "*Las NO ACTION (${fk_noaction} FKs) quedan fuera del listado por ruido.*" >> "$FILE"
    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT
            t.relname || '.' || a.attname || ' -> ' ||
            ft.relname || '.' || fa.attname || ' [' ||
            CASE c.confdeltype
                WHEN 'c' THEN 'CASCADE'
                WHEN 'r' THEN 'RESTRICT'
                WHEN 'n' THEN 'SET NULL'
                WHEN 'd' THEN 'SET DEFAULT'
            END || ']'
        FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_class ft ON ft.oid=c.confrelid
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        JOIN pg_attribute fa ON fa.attrelid=c.confrelid AND fa.attnum=c.confkey[1]
        WHERE c.contype='f'
          AND c.confdeltype IN ('c','r','n','d')
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY c.confdeltype, t.relname, a.attname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 2. TRIGGERS
    # ============================================================
    echo "## 2. Triggers activos" >> "$FILE"
    echo "" >> "$FILE"

    local trg_total
    trg_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal" 2>/dev/null || echo 0)
    echo "**Total: ${trg_total} triggers (excluye internos)**" >> "$FILE"
    echo "" >> "$FILE"

    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT
            c.relname || '.' || t.tgname || ' [' ||
            CASE WHEN (t.tgtype & 2) > 0 THEN 'BEFORE' ELSE 'AFTER' END || ' ' ||
            CASE
                WHEN (t.tgtype & 4) > 0 THEN 'INSERT'
                WHEN (t.tgtype & 8) > 0 THEN 'DELETE'
                WHEN (t.tgtype & 16) > 0 THEN 'UPDATE'
                ELSE '?'
            END || '] -> ' || p.proname || '()'
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE NOT t.tgisinternal
          AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY c.relname, t.tgname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 3. UNIQUE INDEXES (excluye PKs)
    # ============================================================
    echo "## 3. Unique constraints e indices unicos (excluye PKs)" >> "$FILE"
    echo "" >> "$FILE"

    local uniq_total
    uniq_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_index x
        JOIN pg_class c ON c.oid=x.indrelid
        WHERE x.indisunique AND NOT x.indisprimary
          AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
    " 2>/dev/null || echo 0)
    echo "**Total: ${uniq_total} unique indexes**" >> "$FILE"
    echo "" >> "$FILE"

    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT pg_get_indexdef(x.indexrelid)
        FROM pg_index x
        JOIN pg_class i ON i.oid=x.indexrelid
        JOIN pg_class t ON t.oid=x.indrelid
        WHERE x.indisunique AND NOT x.indisprimary
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY t.relname, i.relname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 4. SECUENCIAS + deteccion de desincronizacion
    # ============================================================
    echo "## 4. Secuencias" >> "$FILE"
    echo "" >> "$FILE"

    local seq_total
    seq_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_sequences WHERE schemaname='public'" 2>/dev/null || echo 0)
    echo "**Total: ${seq_total} secuencias**" >> "$FILE"
    echo "" >> "$FILE"

    echo "### Listado (last_value)" >> "$FILE"
    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT sequencename || ': ' || COALESCE(last_value::text, 'NULL')
        FROM pg_sequences
        WHERE schemaname='public'
        ORDER BY sequencename;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    echo "### Desincronizacion (MAX columna duena > last_value)" >> "$FILE"
    echo '```' >> "$FILE"
    local desync_out
    desync_out=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" <<'SQLDESYNC' 2>&1
DO $$
DECLARE
    rec RECORD;
    max_val BIGINT;
    seq_val BIGINT;
BEGIN
    FOR rec IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
        FROM pg_class s
        JOIN pg_depend d ON d.objid=s.oid AND d.deptype='a'
        JOIN pg_class t ON t.oid=d.refobjid
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
        WHERE s.relkind='S'
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
    LOOP
        BEGIN
            EXECUTE format('SELECT MAX(%I) FROM %I', rec.col, rec.tbl) INTO max_val;
            EXECUTE format('SELECT last_value FROM %I', rec.seq) INTO seq_val;
            IF max_val IS NOT NULL AND max_val > seq_val THEN
                RAISE NOTICE '%.%: max=% seq=% (DESYNC, riesgo duplicate key)',
                    rec.tbl, rec.col, max_val, seq_val;
            END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END $$;
SQLDESYNC
)
    local desync_lines
    desync_lines=$(echo "$desync_out" | grep "NOTICE" | sed 's/^NOTICE:  /- [DESYNC] /' || true)
    if [ -n "$desync_lines" ]; then
        echo "$desync_lines" >> "$FILE"
    else
        echo "- [OK] Todas las secuencias en sync con su columna duena" >> "$FILE"
    fi
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 5. VIEWS Y MATERIALIZED VIEWS
    # ============================================================
    echo "## 5. Views y Materialized Views" >> "$FILE"
    echo "" >> "$FILE"

    local view_total matview_total
    view_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_views WHERE schemaname='public'" 2>/dev/null || echo 0)
    matview_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_matviews WHERE schemaname='public'" 2>/dev/null || echo 0)

    echo "**Views: ${view_total} | Materialized views: ${matview_total}**" >> "$FILE"
    echo "" >> "$FILE"

    if [ "$view_total" -gt 0 ]; then
        echo "### Views" >> "$FILE"
        echo '```' >> "$FILE"
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname" \
            2>/dev/null >> "$FILE"
        echo '```' >> "$FILE"
        echo "" >> "$FILE"
    fi

    if [ "$matview_total" -gt 0 ]; then
        echo "### Materialized Views" >> "$FILE"
        echo '```' >> "$FILE"
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname" \
            2>/dev/null >> "$FILE"
        echo '```' >> "$FILE"
        echo "" >> "$FILE"
    fi

    if [ "$STANDALONE" -eq 1 ]; then
        echo -e "${GREEN}[OK] Integridad referencial: $FILE${NC}"
    fi
}

detectar_features_especiales() {
    local destino="${1:-}"
    local _out=""

    # --- 1. Columnas custom en tablas principales ---
    _out+="### Columnas custom en tablas principales"$'\n'$'\n'
    if verificar_bd; then
        # Detectar columnas que no son PK, FK, timestamps ni campos standard
        local custom_cols=""
        custom_cols=$(_run_sql "
            SELECT t.table_name || '.' || c.column_name || ' (' || c.data_type || 
                   COALESCE(' ' || c.character_maximum_length::text, '') || ')'
            FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name = t.table_name
            WHERE c.table_schema = 'public' 
            AND t.table_type = 'BASE TABLE'
            AND c.column_name NOT IN (
                'id','activo','fecha_creacion','fecha_modificacion','created_at','updated_at',
                'nombre','descripcion','observaciones','notas'
            )
            AND c.column_name LIKE '%origen%' 
            OR c.column_name LIKE '%custom%'
            OR c.column_name LIKE '%extra%'
            OR (c.table_name = 'productos' AND c.column_name NOT IN (
                'id_producto','sku','nombre','descripcion','id_categoria','unidad_medida',
                'marca','cod_proveedor','fecha_creacion','fecha_modificacion','activo',
                'url_imagen','id_marca','tiene_variantes','id_alicuota_iva','busqueda_vector','visible_web'
            ))
            ORDER BY t.table_name, c.ordinal_position;
        ")
        if [ -n "$custom_cols" ]; then
            while IFS= read -r col; do
                [ -n "$col" ] && _out+="- $col"$'\n'
            done <<< "$custom_cols"
        else
            _out+="(ninguna detectada)"$'\n'
        fi
    else
        _out+="(BD no disponible)"$'\n'
    fi
    _out+=""$'\n'

    # --- 2. Endpoints por modulo (rutas reales) ---
    _out+="### Endpoints por modulo"$'\n'$'\n'
    if [ -n "${ROUTES_DIR:-}" ] && [ -d "$ROUTES_DIR" ]; then
        while IFS= read -r route_file; do
            [ -z "$route_file" ] && continue
            local rname; rname=$(basename "$route_file" .routes.js)
            local endpoints=""
            endpoints=$(grep -oE "router\.(get|post|put|delete)\(['\"][^'\"]*['\"]" "$route_file" 2>/dev/null \
                | sed "s/router\.\(get\|post\|put\|delete\)(['\"]//; s/['\"]$//" | sort -u || true)
            if [ -n "$endpoints" ]; then
                local ep_count; ep_count=$(echo "$endpoints" | wc -l)
                _out+="**${rname}** (${ep_count} rutas):"$'\n'
                while IFS= read -r ep; do
                    [ -n "$ep" ] && _out+="  - $ep"$'\n'
                done <<< "$endpoints"
                _out+=""$'\n'
            fi
        done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)
    fi

    # --- 3. Filtros frontend por pagina ---
    _out+="### Filtros frontend (selects en HTML)"$'\n'$'\n'
    if [ -n "${FRONTEND_DIR:-}" ] && [ -d "$FRONTEND_DIR" ]; then
        while IFS= read -r html_file; do
            [ -z "$html_file" ] && continue
            local hname; hname=$(basename "$html_file" .html)
            local filtros=""
            filtros=$(grep -oE 'id="filtro[A-Za-z]*"' "$html_file" 2>/dev/null | sed 's/id="//; s/"//' | sort -u || true)
            if [ -n "$filtros" ]; then
                _out+="**${hname}.html**: "
                local flist=""
                while IFS= read -r f; do [ -n "$f" ] && flist+="$f, "; done <<< "$filtros"
                _out+="${flist%, }"$'\n'
            fi
        done < <(find "$FRONTEND_DIR" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)
    fi
    _out+=""$'\n'

    # --- 4. Valores archivo_origen (si existe) ---
    if verificar_bd; then
        local tiene_ao=""
        tiene_ao=$(_run_sql \
            "SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='archivo_origen'")
        if [ "$tiene_ao" = "1" ]; then
            _out+="### Archivos origen registrados (productos.archivo_origen)"$'\n'$'\n'
            local archivos=""
            archivos=$(_run_sql \
                "SELECT archivo_origen || ' (' || COUNT(*) || ' productos)' FROM productos WHERE archivo_origen IS NOT NULL AND activo = true GROUP BY archivo_origen ORDER BY archivo_origen")
            if [ -n "$archivos" ]; then
                while IFS= read -r a; do [ -n "$a" ] && _out+="- $a"$'\n'; done <<< "$archivos"
            else
                _out+="(ninguno registrado)"$'\n'
            fi
            _out+=""$'\n'
        fi
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# AUDITORIA DE SEGURIDAD Y CONTROL DE ACCESO
# =======================================================================================

##
# @function detectar_doble_api
# @description Detecta el patron ${API_BASE}/api/ en JS del frontend.
#   config.js define API_BASE_URL = 'http://host:port/api' (ya incluye /api).
#   Si alguien escribe ${API_BASE}/api/auth/perfil genera /api/api/auth/perfil → 404.
#   Leccion: sesion 2026-02-24, 2+ horas perdidas en loop infinito por este patron.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_doble_api() {
    local destino="${1:-}"
    local _out=""
    _out+="### Deteccion de doble /api en frontend JS"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local encontrados=0
    while IFS= read -r linea; do
        [ -z "$linea" ] && continue
        _out+="- [BUG] $linea"$'\n'
        encontrados=$((encontrados + 1))
    done < <(grep -rn 'API_BASE.*\/api\/' "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" || true)

    if [ "$encontrados" -eq 0 ]; then
        _out+="[OK] Ningun caso de doble /api detectado"$'\n'
    else
        _out+=""$'\n'"**ALERTA:** $encontrados casos de doble /api. API_BASE_URL ya incluye /api."$'\n'
        _out+="Correcto: \${API_BASE}/auth/perfil"$'\n'
        _out+="Incorrecto: \${API_BASE}/api/auth/perfil"$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_redirects_login
# @description Lista TODOS los archivos JS del frontend que redirigen a login.html.
#   Estado ideal: solo auth.js y login.html deberian redirigir a login.
#   El resto deberia delegar al server-side (html-access.middleware.js).
#   Leccion: sesion 2026-02-24, 10+ archivos con redirect independiente.
# @since v36.0
# @returns {void} Imprime listado a stdout o agrega a archivo
##
detectar_redirects_login() {
    local destino="${1:-}"
    local _out=""
    _out+="### Puntos de redirect a login.html en frontend JS"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local archivos_con_redirect=""
    archivos_con_redirect=$(grep -rl "login\.html" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" | grep -v "node_modules" || true)
    local total=0
    local redundantes=0

    if [ -n "$archivos_con_redirect" ]; then
        while IFS= read -r archivo; do
            [ -z "$archivo" ] && continue
            local nombre; nombre=$(basename "$archivo")
            local count; count=$(grep -c "login\.html" "$archivo" 2>/dev/null) || count=0
            total=$((total + 1))
            case "$nombre" in
                auth.js|login.js)
                    _out+="- [OK] $nombre ($count refs) - esperado"$'\n'
                    ;;
                *)
                    _out+="- [WARN] $nombre ($count refs) - redundante con server-side"$'\n'
                    redundantes=$((redundantes + 1))
                    ;;
            esac
        done <<< "$archivos_con_redirect"
    fi

    _out+=""$'\n'
    if [ "$redundantes" -gt 0 ]; then
        _out+="**$redundantes archivos con redirect redundante.** Server-side (html-access.middleware) ya protege HTML."$'\n'
        _out+="Ideal: eliminar redirects client-side excepto auth.js"$'\n'
    else
        _out+="[OK] Solo archivos esperados redirigen a login"$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_403_como_401
# @description Busca archivos JS que tratan HTTP 403 como 401.
#   403 = "sin permiso" (vendedor accede a reportes), 401 = "no autenticado".
#   Si un JS redirige a login en 403, el usuario pierde la sesion innecesariamente.
#   Leccion: sesion 2026-02-24, config.js redirigía en 401 Y 403.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_403_como_401() {
    local destino="${1:-}"
    local _out=""
    _out+="### Deteccion de 403 tratado como 401"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local encontrados=0
    while IFS= read -r linea; do
        [ -z "$linea" ] && continue
        _out+="- [BUG] $linea"$'\n'
        encontrados=$((encontrados + 1))
    done < <(grep -rn "403.*login\|status.*===.*403.*redirect\|403.*window\.location" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" || true)

    if [ "$encontrados" -eq 0 ]; then
        _out+="[OK] Ningun JS trata 403 como 401"$'\n'
    else
        _out+=""$'\n'"**ALERTA:** $encontrados casos. 403=sin permiso, 401=no autenticado."$'\n'
        _out+="Solo 401 debe redirigir a login. 403 debe mostrar 'Sin permiso'."$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function verificar_orden_middlewares
# @description Verifica que en server.js el middleware de control de HTML
#   (htmlAccessMiddleware) este registrado ANTES de express.static.
#   express.static sirve archivos sin pasar por middlewares de ruta.
#   Si htmlAccessMiddleware va despues, los HTML se sirven sin proteccion.
#   Leccion: sesion 2026-02-24, diseño inicial equivocado por esto.
# @since v36.0
# @returns {void} Imprime resultado a stdout o agrega a archivo
##
verificar_orden_middlewares() {
    local destino="${1:-}"
    local _out=""
    _out+="### Orden de middlewares en server.js"$'\n'$'\n'

    local server_file="$PROJECT_ROOT/server.js"
    if [ ! -f "$server_file" ]; then
        _out+="(server.js no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    # Buscar linea de htmlAccessMiddleware
    local linea_html_access=""
    linea_html_access=$(grep -n "htmlAccessMiddleware\|html-access" "$server_file" 2>/dev/null | grep -v "require\|//" | head -1 | cut -d: -f1 || true)

    # Buscar linea de express.static
    local linea_static=""
    linea_static=$(grep -n "express\.static" "$server_file" 2>/dev/null | grep -v "//" | head -1 | cut -d: -f1 || true)

    if [ -z "$linea_html_access" ]; then
        _out+="[WARN] htmlAccessMiddleware NO encontrado en server.js"$'\n'
        _out+="Los HTML se sirven sin control de acceso server-side"$'\n'
    elif [ -z "$linea_static" ]; then
        _out+="[WARN] express.static NO encontrado en server.js"$'\n'
    elif [ "$linea_html_access" -lt "$linea_static" ]; then
        _out+="[OK] htmlAccessMiddleware (linea $linea_html_access) ANTES de express.static (linea $linea_static)"$'\n'
    else
        _out+="[BUG] express.static (linea $linea_static) esta ANTES de htmlAccessMiddleware (linea $linea_html_access)"$'\n'
        _out+="Los HTML se sirven SIN control de acceso. Invertir el orden en server.js."$'\n'
    fi

    # Verificar cookie-parser
    local tiene_cookie_parser=""
    tiene_cookie_parser=$(grep -c "cookie-parser" "$PROJECT_ROOT/package.json" 2>/dev/null) || tiene_cookie_parser=0
    if [ "$tiene_cookie_parser" -gt 0 ]; then
        _out+="[OK] cookie-parser instalado en package.json"$'\n'
    else
        _out+="[WARN] cookie-parser NO encontrado en package.json (requerido para auth por cookie)"$'\n'
    fi

    # Verificar anti-cache para HTML
    local tiene_anticache=""
    tiene_anticache=$(grep -c "no-cache\|no-store\|must-revalidate" "$server_file" 2>/dev/null) || tiene_anticache=0
    if [ "$tiene_anticache" -gt 0 ]; then
        _out+="[OK] Anti-cache configurado en server.js"$'\n'
    else
        _out+="[WARN] Sin anti-cache para HTML. Browser puede servir HTML viejo del cache."$'\n'
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_transacciones
# @description Detecta operaciones criticas (INSERT a tablas financieras/stock)
#   que NO estan envueltas en transacciones BEGIN/COMMIT.
#   Tablas financieras: movimientos_caja, cuentacorrienteclientes, recibos, pagos, etc.
#   Un INSERT sin transaccion a estas tablas es riesgo de inconsistencia.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_transacciones() {
    local destino="${1:-}"
    local _out=""
    _out+="### Transacciones en operaciones criticas"$'\n'$'\n'

    if [ ! -d "$CONTROLLERS_DIR" ]; then
        _out+="(sin directorio de controllers)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local TABLAS_FINANCIERAS="movimientos_caja turnos_caja recibos recibo_items cuentacorrienteclientes cuentacorrienteproveedores pagosaproveedores facturas factura_items inventario movimientos_stock confirmaciones_pago"

    for tabla in $TABLAS_FINANCIERAS; do
        local archivos_insert=""
        archivos_insert=$(grep -rl "INSERT INTO ${tabla}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
        [ -z "$archivos_insert" ] && continue

        while IFS= read -r archivo; do
            [ -z "$archivo" ] && continue
            local nombre; nombre=$(basename "$archivo")
            local tiene_begin=""
            tiene_begin=$(grep -c "BEGIN\|client\.query.*BEGIN\|pool\.query.*BEGIN" "$archivo" 2>/dev/null) || tiene_begin=0
            if [ "$tiene_begin" -eq 0 ]; then
                _out+="- [WARN] $nombre: INSERT INTO $tabla SIN transaccion"$'\n'
            else
                _out+="- [OK] $nombre: INSERT INTO $tabla con transaccion"$'\n'
            fi
        done <<< "$archivos_insert"
    done

    # Tambien verificar helpers (caller-aware: si recibe client, TX la maneja el controller)
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        for tabla in $TABLAS_FINANCIERAS; do
            local helper_insert=""
            helper_insert=$(grep -rl "INSERT INTO ${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null || true)
            [ -z "$helper_insert" ] && continue
            while IFS= read -r archivo; do
                [ -z "$archivo" ] && continue
                local nombre; nombre=$(basename "$archivo")
                local tiene_begin=""
                tiene_begin=$(grep -c "BEGIN\|client\.query.*BEGIN" "$archivo" 2>/dev/null) || tiene_begin=0
                if [ "$tiene_begin" -gt 0 ]; then
                    _out+="- [OK] $nombre (helper): INSERT INTO $tabla con transaccion"$'\n'
                else
                    # Caller-aware: helper recibe client => TX en controller
                    local uses_client=""
                    uses_client=$(grep -c "async function.*client," "$archivo" 2>/dev/null) || uses_client=0
                    if [ "$uses_client" -gt 0 ]; then
                        local helper_base caller_has_begin=0
                        helper_base=$(basename "$archivo" .js | sed "s/\.helper//")
                        local callers=""
                        callers=$(grep -rl "require.*${helper_base}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
                        if [ -n "$callers" ]; then
                            while IFS= read -r caller; do
                                [ -z "$caller" ] && continue
                                local cb=""
                                cb=$(grep -c "BEGIN" "$caller" 2>/dev/null) || cb=0
                                if [ "$cb" -gt 0 ]; then caller_has_begin=1; break; fi
                            done <<< "$callers"
                        fi
                        if [ "$caller_has_begin" -eq 1 ]; then
                            _out+="- [OK] $nombre (helper): INSERT INTO $tabla con transaccion (caller-managed)"$'\n'
                        else
                            _out+="- [WARN] $nombre (helper): INSERT INTO $tabla SIN transaccion"$'\n'
                        fi
                    else
                        _out+="- [WARN] $nombre (helper): INSERT INTO $tabla SIN transaccion"$'\n'
                    fi
                fi
            done <<< "$helper_insert"
        done
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_endpoints_huerfanos
# @description Detecta:
#   1. Funciones exportadas en controllers que ninguna ruta referencia
#   2. Funciones referenciadas en routes que no existen en el controller
#   Esto detecta codigo muerto y rutas rotas.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_endpoints_huerfanos() {
    local destino="${1:-}"
    local _out=""
    _out+="### Endpoints huerfanos"$'\n'$'\n'

    if [ ! -d "$CONTROLLERS_DIR" ] || [ ! -d "$ROUTES_DIR" ]; then
        _out+="(sin directorio de controllers o routes)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local huerfanos_total=0

    while IFS= read -r route_file; do
        [ -z "$route_file" ] && continue
        local rname; rname=$(basename "$route_file" .routes.js)

        # Buscar el controller correspondiente
        local ctrl_file=""
        ctrl_file=$(find "$CONTROLLERS_DIR" -name "${rname}.controller.js" 2>/dev/null | head -1 || true)
        [ -z "$ctrl_file" ] && continue

        # Extraer aliases reales del routes file (const X = require('./xx.controller'))
        # Esto incluye: controllers, ctrl, authWebController, clientesImport, carritoCtrl, etc.
        local ctrl_aliases=""
        ctrl_aliases=$(grep -oE "(const|let|var)[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*=[[:space:]]*require\(['\"][^'\"]*\.?controller[^'\"]*['\"]\)" "$route_file" 2>/dev/null \
            | grep -oE "(const|let|var)[[:space:]]+[a-zA-Z_][a-zA-Z0-9_]*" \
            | awk '{print $2}' | sort -u || true)
        # Buscar $alias.funcion por cada alias detectado
        local funcs_en_rutas=""
        if [ -n "$ctrl_aliases" ]; then
            while IFS= read -r alias; do
                [ -z "$alias" ] && continue
                local matches
                matches=$(grep -oE "\b${alias}\.[a-zA-Z_][a-zA-Z0-9_]*" "$route_file" 2>/dev/null | sed "s/${alias}\.//" || true)
                [ -n "$matches" ] && funcs_en_rutas+="${matches}"$'\n'
            done <<< "$ctrl_aliases"
            funcs_en_rutas=$(echo "$funcs_en_rutas" | sort -u | grep -v '^$' || true)
        fi
        # Fallback: si no encontramos aliases (routes sin require estándar), volver al heurístico viejo
        if [ -z "$funcs_en_rutas" ]; then
            funcs_en_rutas=$(grep -oE "[a-zA-Z]*[Cc]ontroller\.[a-zA-Z_][a-zA-Z0-9_]*" "$route_file" 2>/dev/null \
                | sed 's/.*\.//' | sort -u || true)
        fi

        # Extraer funciones exportadas en controller
        local funcs_en_ctrl=""
        funcs_en_ctrl=$(grep -oE "exports\.[a-zA-Z_][a-zA-Z0-9_]*" "$ctrl_file" 2>/dev/null \
            | sed 's/exports\.//' | sort -u || true)

        # Funciones en controller pero no en rutas
        if [ -n "$funcs_en_ctrl" ]; then
            while IFS= read -r fn; do
                [ -z "$fn" ] && continue
                if [ -n "$funcs_en_rutas" ] && echo "$funcs_en_rutas" | grep -qw "$fn"; then
                    : # OK, esta referenciada
                else
                    _out+="- [WARN] ${rname}: exports.$fn() sin ruta asignada"$'\n'
                    huerfanos_total=$((huerfanos_total + 1))
                fi
            done <<< "$funcs_en_ctrl"
        fi
    done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)

    if [ "$huerfanos_total" -eq 0 ]; then
        _out+="[OK] Todos los exports tienen ruta asignada"$'\n'
    else
        _out+=""$'\n'"**$huerfanos_total funciones exportadas sin ruta.** Posible codigo muerto."$'\n'
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function auditar_seguridad
# @description Auditoria completa de seguridad y control de acceso.
#   Ejecuta todas las verificaciones de seguridad y genera reporte.
#   Incluye: orden middlewares, doble /api, redirects login, 403 como 401,
#   cookie-parser, auth por cookie, roles, modulos, tablas de seguridad.
# @since v36.0
# @returns {void} Genera archivo SEGURIDAD_YYYYMMDD_HHMM.md en OUTPUT_DIR
##
auditar_seguridad() {
    local SEC_FILE="$OUTPUT_DIR/SEGURIDAD_$(date +%Y%m%d_%H%M).md"

    header
    echo "Auditando seguridad y control de acceso..."
    echo ""

    explorar_proyecto

    cat > "$SEC_FILE" << EOF
# AUDITORIA DE SEGURIDAD Y CONTROL DE ACCESO
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

EOF

    # === 1. Middlewares ===
    echo "## 1. MIDDLEWARES DE SEGURIDAD" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    verificar_orden_middlewares "$SEC_FILE"

    # Listar middlewares existentes
    echo "### Middlewares detectados" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if [ -n "${MIDDLEWARE_DIR:-}" ] && [ -d "$MIDDLEWARE_DIR" ]; then
        while IFS= read -r mw; do
            [ -z "$mw" ] && continue
            local mname; mname=$(basename "$mw")
            local mlines; mlines=$(wc -l < "$mw" 2>/dev/null || echo "?")
            echo "$mname ($mlines lineas)" >> "$SEC_FILE"
        done < <(find "$MIDDLEWARE_DIR" -name "*.js" -type f 2>/dev/null | sort)
    else
        echo "(directorio middleware no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 2. Auth middleware: busca token en header/query/cookie ===
    echo "## 2. AUTH MIDDLEWARE - FUENTES DE TOKEN" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local auth_mw="$PROJECT_ROOT/src/middleware/auth.middleware.js"
    if [ -f "$auth_mw" ]; then
        # [v69-b4b] El middleware delega la extraccion del token a un helper
        # (const {extraerToken} = require('../utils/auth.helper')). Si grepeamos
        # solo el middleware da falso "NO busca token". Resolvemos los require a
        # ../utils y ./ e inspeccionamos middleware + helpers JUNTOS.
        local SCAN_FILES="$auth_mw"
        local _reqrel _reqfile
        while IFS= read -r _reqrel; do
            [ -z "$_reqrel" ] && continue
            # require('../utils/auth.helper') | require('./x') -> ruta a archivo .js
            _reqfile=$(echo "$_reqrel" | sed -E "s#.*require\(['\"]##; s#['\"]\).*##")
            case "$_reqfile" in
                ../utils/*) _reqfile="$PROJECT_ROOT/src/${_reqfile#../}";;
                ./*)        _reqfile="$PROJECT_ROOT/src/middleware/${_reqfile#./}";;
                *)          continue;;
            esac
            [ "${_reqfile%.js}" = "$_reqfile" ] && _reqfile="${_reqfile}.js"
            [ -f "$_reqfile" ] && SCAN_FILES="$SCAN_FILES $_reqfile"
        done < <(grep -oE "require\(['\"](\.\./utils/|\./)[a-zA-Z0-9_.-]+['\"]\)" "$auth_mw" 2>/dev/null)

        local busca_header=0 busca_query=0 busca_cookie=0
        busca_header=$(grep -hcE "authorization|Authorization|Bearer" $SCAN_FILES 2>/dev/null | awk '{s+=$1} END{print s+0}')
        busca_query=$(grep -hcE "req\.query\.token|query\.token|req\.query\[" $SCAN_FILES 2>/dev/null | awk '{s+=$1} END{print s+0}')
        busca_cookie=$(grep -hcE "req\.cookies|cookies\?\.|\.cookies|erp_token" $SCAN_FILES 2>/dev/null | awk '{s+=$1} END{print s+0}')

        local _via=""
        [ "$(echo "$SCAN_FILES" | wc -w)" -gt 1 ] && _via=" (via helper)"
        [ "$busca_header" -gt 0 ] && echo "[OK] Busca token en header Authorization$_via" >> "$SEC_FILE" || echo "[WARN] NO busca token en header" >> "$SEC_FILE"
        [ "$busca_query" -gt 0 ] && echo "[OK] Busca token en query string$_via" >> "$SEC_FILE" || echo "[INFO] No busca token en query" >> "$SEC_FILE"
        [ "$busca_cookie" -gt 0 ] && echo "[OK] Busca token en cookie (erp_token)$_via" >> "$SEC_FILE" || echo "[WARN] NO busca token en cookie" >> "$SEC_FILE"
    else
        echo "(auth.middleware.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 3. Login setea cookie / Logout limpia ===
    echo "## 3. COOKIE JWT (SETEO Y LIMPIEZA)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local auth_ctrl="$PROJECT_ROOT/src/controllers/auth.controller.js"
    if [ -f "$auth_ctrl" ]; then
        local setea_cookie="" limpia_cookie=""
        setea_cookie=$(grep -c "res\.cookie" "$auth_ctrl" 2>/dev/null) || setea_cookie=0
        limpia_cookie=$(grep -c "clearCookie" "$auth_ctrl" 2>/dev/null) || limpia_cookie=0
        [ "$setea_cookie" -gt 0 ] && echo "[OK] Login setea cookie ($setea_cookie llamadas)" >> "$SEC_FILE" || echo "[WARN] Login NO setea cookie" >> "$SEC_FILE"
        [ "$limpia_cookie" -gt 0 ] && echo "[OK] Logout limpia cookie ($limpia_cookie llamadas)" >> "$SEC_FILE" || echo "[WARN] Logout NO limpia cookie" >> "$SEC_FILE"
        # Verificar httpOnly
        local http_only=""
        http_only=$(grep -c "httpOnly" "$auth_ctrl" 2>/dev/null) || http_only=0
        [ "$http_only" -gt 0 ] && echo "[OK] Cookie con httpOnly" >> "$SEC_FILE" || echo "[WARN] Cookie SIN httpOnly (vulnerable a XSS)" >> "$SEC_FILE"
    else
        echo "(auth.controller.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 4. Doble /api ===
    echo "## 4. DOBLE /api EN FRONTEND" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_doble_api "$SEC_FILE"

    # === 5. Redirects a login ===
    echo "## 5. REDIRECTS A LOGIN (DISPERSOS)" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_redirects_login "$SEC_FILE"

    # === 6. 403 como 401 ===
    echo "## 6. 403 TRATADO COMO 401" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_403_como_401 "$SEC_FILE"

    # === 7. Tablas de seguridad ===
    echo "## 7. TABLAS DE SEGURIDAD EN BD" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        for tabla in modulos rol_modulos modulo_rutas_api modulo_grupos rutas_soporte dispositivos_autorizados intentos_dispositivo_nuevo usuarios_logs permisos_usuario; do
            if _table_exists "$tabla"; then
                local count=""
                count=$(_table_count "$tabla")
                echo "OK $tabla ($count registros)" >> "$SEC_FILE"
            else
                echo "-- $tabla (no existe)" >> "$SEC_FILE"
            fi
        done
    else
        echo "(BD no disponible)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 8. Roles y modulos ===
    echo "## 8. ROLES Y ACCESO A MODULOS" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        if _table_exists "rol_modulos"; then
            _run_sql_full \
                "SELECT rm.rol, COUNT(*) as modulos, SUM(CASE WHEN rm.solo_lectura THEN 1 ELSE 0 END) as solo_lectura FROM rol_modulos rm WHERE rm.puede_ver = true GROUP BY rm.rol ORDER BY COUNT(*) DESC" >> "$SEC_FILE"
        else
            echo "(tabla rol_modulos no existe)" >> "$SEC_FILE"
        fi
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 9. Paginas publicas vs protegidas ===
    echo "## 9. CATEGORIAS DE PAGINAS HTML" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    echo "### Paginas publicas (sin auth)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local html_mw="$PROJECT_ROOT/src/middleware/html-access.middleware.js"
    if [ -f "$html_mw" ]; then
        grep -oE "'[a-z_-]*\.html'" "$html_mw" 2>/dev/null | sed "s/'//g" | sort >> "$SEC_FILE" || echo "(no se pudieron extraer)" >> "$SEC_FILE"
    else
        echo "(html-access.middleware.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    echo "### Paginas como modulo (cookie + rol_modulos)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        if _table_exists "modulos"; then
            _run_sql \
                "SELECT url_frontend || ' (' || nombre || ')' FROM modulos WHERE activo = true ORDER BY nombre" >> "$SEC_FILE"
        fi
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 10. Transacciones ===
    echo "## 10. TRANSACCIONES EN OPERACIONES CRITICAS" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_transacciones "$SEC_FILE"

    # === 11. Endpoints huerfanos ===
    echo "## 11. ENDPOINTS HUERFANOS" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_endpoints_huerfanos "$SEC_FILE"

    echo "---" >> "$SEC_FILE"
    echo "*Generado por Toolkit v${VERSION}*" >> "$SEC_FILE"

    echo -e "${GREEN}[OK] Auditoria de seguridad generada: $SEC_FILE${NC}"
}

# =======================================================================================
# EXTRACCION DE VERSIONES RUNTIME (JDK + Node.js)
# =======================================================================================

extraer_versiones_runtime() {
    # Usa _check_tool_version en vez de 6 bloques if/else repetitivos
    [ -f "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null

    echo "Node.js: $(_check_tool_version node --version)"
    echo "npm: $(_check_tool_version npm --version)"
    echo "Java: $(_check_tool_version java -version)"
    echo "javac: $(_check_tool_version javac -version)"
    echo "PM2: $(_check_tool_version pm2 --version)"
    echo "PostgreSQL client: $(_check_tool_version psql --version)"
}

# =======================================================================================
# MAPEO INTELIGENTE DE MODULOS - FIXED
# =======================================================================================

detectar_endpoints_usados() {
    local js_file="$1"
    [ ! -f "$js_file" ] && { echo ""; return 0; }
    local resultado=""
    resultado=$(grep -oE "/api/[a-zA-Z0-9_/-]+" "$js_file" 2>/dev/null | sed 's|/api/||; s|/[0-9]*$||; s|/$||' || true)
    local resultado2=""
    resultado2=$(grep -oE "(/|')[a-z][-a-z]*(/[a-z][-a-z]*)?" "$js_file" 2>/dev/null \
        | grep -E "^(/|')[a-z]" | sed "s|^['/]||" \
        | grep -vE "^(js/|css/|api/|http|function|return|true|false|null|undefined|window|document)" || true)
    if [ -n "$resultado" ]; then
        echo "$resultado" | sort -u | head -8 | tr '\n' ',' | sed 's/,$//'
    else
        echo ""
    fi
    return 0
}

detectar_tablas_relacionadas() {
    local modulo="$1"
    local tablas_encontradas=""
    
    case "$modulo" in
        tesoreria)
            tablas_encontradas="turnos_caja,movimientos_caja,recibos,recibo_items,cotizaciones,cajas"
            ;;
        venta-rapida|venta_rapida|pos)
            tablas_encontradas="pedidos,pedidoitems,pedidoestados,clientes,productos,inventario,configuraciones_empresa"
            ;;
        configuraciones)
            tablas_encontradas="configuracion_sistema,configuraciones_empresa,configuracion_empresa_extendida,usuario_configuracion,empresas"
            ;;
        gestion-despachos|despachos)
            tablas_encontradas="viajes,remitos,remitoitems,remito_items,pedidos,entregas_planificadas"
            ;;
        cobranzas|cobros)
            tablas_encontradas="recibos,recibo_items,recibopagos,turnos_caja,movimientos_caja,clientes,cuentacorrienteclientes,ajustes_forma_pago"
            ;;
        cuenta-corriente|cc)
            tablas_encontradas="cuentacorrienteclientes,clientes,facturas,recibos,pagos,ajustes_forma_pago,notas_credito_debito"
            ;;
        pagos-proveedores)
            tablas_encontradas="pagosaproveedores,pago_proveedor_items,proveedores,cuentacorrienteproveedores,cheques_terceros,cheques_propios"
            ;;
        compras-nueva|compras)
            tablas_encontradas="comprobantes_compra,comprobante_compra_items,proveedores,ordenes_compra,recepciones"
            ;;
        admin-usuarios|usuarios)
            tablas_encontradas="usuarios,permisos_usuario,usuarios_logs,empresas"
            ;;
        clientes)
            tablas_encontradas="clientes,cuentacorrienteclientes,facturas,recibos,pedidos"
            ;;
        productos)
            tablas_encontradas="productos,inventario,precios,listaprecioproductos,categorias,marcas"
            ;;
        proveedores)
            tablas_encontradas="proveedores,cuentacorrienteproveedores,comprobantes_compra,pagosaproveedores"
            ;;
        facturas)
            tablas_encontradas="facturas,facturaitems,factura_items,clientes,secuencia_facturas,comprobantes_afip"
            ;;
        pedidos)
            tablas_encontradas="pedidos,pedidoitems,pedidoestados,clientes,pagos,confirmaciones_pago"
            ;;
        inventario)
            tablas_encontradas="inventario,inventario_deposito,movimientos_stock,movimientos_stock_deposito,productos,depositos,ajustes_inventario,ajuste_inventario_items"
            ;;
        presupuestos)
            tablas_encontradas="presupuestos,presupuesto_items,secuencia_presupuestos,clientes"
            ;;
        notas)
            tablas_encontradas="notas_credito_debito,nota_items,facturas,clientes"
            ;;
        remitos)
            tablas_encontradas="remitos,remito_items,pedidos,clientes"
            ;;
        libro-iva)
            tablas_encontradas="facturas,notas_credito_debito,alicuotasiva"
            ;;
        conjuntos)
            tablas_encontradas="conjuntos,conjunto_items,productos"
            ;;
        historial-movimientos)
            tablas_encontradas="pedidos,pedidoitems,comprobantes_compra,comprobante_compra_items,clientes,proveedores,productos"
            ;;
        comprobantes-internos)
            tablas_encontradas="comprobantes_internos,comprobante_interno_items"
            ;;
        dashboard|reportes)
            tablas_encontradas="pedidos,facturas,productos,inventario,clientes"
            ;;
        marcas)
            tablas_encontradas="marcas,productos"
            ;;
        categorias)
            tablas_encontradas="categorias,productos"
            ;;
        caja)
            tablas_encontradas="turnos_caja,movimientos_caja,cajas"
            ;;
        admin-dispositivos)
            tablas_encontradas="dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios"
            ;;
        admin-listas-precios)
            tablas_encontradas="listasdeprecios,listaprecioproductos,productos"
            ;;
        variantes)
            tablas_encontradas="producto_variantes,productos"
            ;;
        # Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso)
            tablas_encontradas="modulos,rol_modulos,modulo_rutas_api,modulo_grupos,rutas_soporte,dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios,usuarios_logs"
            ;;
        auth|autenticacion)
            tablas_encontradas="usuarios,dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios_logs"
            ;;
        modulos)
            tablas_encontradas="modulos,rol_modulos,modulo_rutas_api,modulo_grupos,rutas_soporte"
            ;;
        *)
            local base_name
            base_name=$(echo "$modulo" | tr '-' '_')
            if verificar_bd; then
                tablas_encontradas=$(_run_sql "
                    SELECT string_agg(table_name, ',')
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_type = 'BASE TABLE'
                    AND (table_name LIKE '%${base_name}%' OR table_name LIKE '%${base_name}s%')
                ")
            fi
            ;;
    esac
    
    echo "$tablas_encontradas"
}

detectar_controllers_relacionados() {
    local modulo="$1"
    local js_file="${2:-}"
    local controllers_encontrados=""
    
    case "$modulo" in
        tesoreria)
            controllers_encontrados="cajas-cobranzas.controller.js,recibos.controller.js,cotizaciones.controller.js"
            ;;
        venta-rapida|pos)
            controllers_encontrados="pedidos.controller.js,borrador.controller.js,pagos-confirmacion.controller.js"
            ;;
        configuraciones)
            controllers_encontrados="usuarios.controller.js,auth.controller.js"
            ;;
        admin-usuarios)
            controllers_encontrados="usuarios.controller.js,auth.controller.js"
            ;;
        cobranzas|cobros)
            controllers_encontrados="cajas-cobranzas.controller.js,recibos.controller.js,cobranzas.controller.js"
            ;;
        cuenta-corriente|cc)
            controllers_encontrados="clientes.controller.js,recibos.controller.js,facturas.controller.js"
            ;;
        gestion-despachos)
            controllers_encontrados="despachos.controller.js"
            ;;
        pagos-proveedores)
            controllers_encontrados="pagos-proveedores.controller.js"
            ;;
        historial-movimientos)
            controllers_encontrados="historial-movimientos.controller.js"
            ;;
        comprobantes-internos)
            controllers_encontrados="comprobantes-internos.controller.js"
            ;;
        dashboard|reportes)
            controllers_encontrados="reportes.controller.js"
            ;;
        caja)
            controllers_encontrados="cajas-cobranzas.controller.js"
            ;;
        admin-dispositivos)
            controllers_encontrados="usuarios.controller.js"
            ;;
        admin-listas-precios)
            controllers_encontrados="listas-precios.controller.js"
            ;;
        marcas)
            controllers_encontrados="marcas.controller.js"
            ;;
        categorias)
            controllers_encontrados="categorias.controller.js"
            ;;
        variantes)
            controllers_encontrados="variantes.controller.js"
            ;;
        libro-iva)
            controllers_encontrados="facturas.controller.js"
            ;;
        notas)
            controllers_encontrados="notas.controller.js"
            ;;
        remitos)
            controllers_encontrados="remitos.controller.js"
            ;;
        inventario)
            controllers_encontrados="inventario.controller.js,ajustes-inventario.controller.js"
            ;;
        presupuestos)
            controllers_encontrados="presupuestos.controller.js"
            ;;
        productos)
            controllers_encontrados="productos.controller.js"
            ;;
        # Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso|auth|autenticacion)
            controllers_encontrados="auth.controller.js,usuarios.controller.js"
            ;;
        modulos)
            controllers_encontrados="auth.controller.js"
            ;;
    esac
    
    if [ -n "$controllers_encontrados" ]; then
        local result=""
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers_encontrados"
        for ctrl_name in "${CTRL_ARRAY[@]}"; do
            local ctrl_path="$CONTROLLERS_DIR/$ctrl_name"
            if [ -f "$ctrl_path" ]; then
                [ -n "$result" ] && result+=","
                result+="$ctrl_path"
            fi
        done
        if [ -n "$result" ]; then
            echo "$result"
            return 0
        fi
    fi
    
    local ctrl_directo=""
    ctrl_directo=$(find "$CONTROLLERS_DIR" -name "*${modulo}*.controller.js" 2>/dev/null | head -1 || true)
    if [ -n "$ctrl_directo" ]; then
        echo "$ctrl_directo"
        return 0
    fi
    
    local modulo_sin_guion
    modulo_sin_guion=$(echo "$modulo" | tr '-' '_')
    ctrl_directo=$(find "$CONTROLLERS_DIR" -name "*${modulo_sin_guion}*.controller.js" 2>/dev/null | head -1 || true)
    if [ -n "$ctrl_directo" ]; then
        echo "$ctrl_directo"
        return 0
    fi
    
    echo ""
    return 0
}

detectar_routes_relacionadas() {
    local modulo="$1"
    local routes_encontradas=""
    
    case "$modulo" in
        tesoreria)
            routes_encontradas="cajas-cobranzas.routes.js,recibos.routes.js,cotizaciones.routes.js"
            ;;
        venta-rapida|pos)
            routes_encontradas="pedidos.routes.js,borrador.routes.js,pagos-confirmacion.routes.js"
            ;;
        configuraciones|admin-usuarios)
            routes_encontradas="usuarios.routes.js,auth.routes.js"
            ;;
        cobranzas|cobros)
            routes_encontradas="cajas-cobranzas.routes.js,recibos.routes.js,cobranzas.routes.js"
            ;;
        cuenta-corriente|cc)
            routes_encontradas="clientes.routes.js,recibos.routes.js,facturas.routes.js"
            ;;
        gestion-despachos)
            routes_encontradas="despachos.routes.js"
            ;;
        pagos-proveedores)
            routes_encontradas="pagos-proveedores.routes.js"
            ;;
        historial-movimientos)
            routes_encontradas="historial-movimientos.routes.js"
            ;;
        comprobantes-internos)
            routes_encontradas="comprobantes-internos.routes.js"
            ;;
        dashboard|reportes)
            routes_encontradas="reportes.routes.js"
            ;;
        caja)
            routes_encontradas="cajas-cobranzas.routes.js"
            ;;
        admin-dispositivos)
            routes_encontradas="usuarios.routes.js"
            ;;
        admin-listas-precios)
            routes_encontradas="listas-precios.routes.js"
            ;;
        marcas)
            routes_encontradas="marcas.routes.js"
            ;;
        categorias)
            routes_encontradas="categorias.routes.js"
            ;;
        variantes)
            routes_encontradas="variantes.routes.js"
            ;;
        libro-iva)
            routes_encontradas="facturas.routes.js"
            ;;
        notas)
            routes_encontradas="notas.routes.js"
            ;;
        remitos)
            routes_encontradas="remitos.routes.js"
            ;;
        inventario)
            routes_encontradas="inventario.routes.js,ajustes-inventario.routes.js"
            ;;
        presupuestos)
            routes_encontradas="presupuestos.routes.js"
            ;;
        productos)
            routes_encontradas="productos.routes.js"
            ;;
        # Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso|auth|autenticacion)
            routes_encontradas="auth.routes.js,usuarios.routes.js"
            ;;
        modulos)
            routes_encontradas="auth.routes.js"
            ;;
    esac
    
    if [ -n "$routes_encontradas" ]; then
        local result=""
        IFS=',' read -ra ROUTE_ARRAY <<< "$routes_encontradas"
        for route_name in "${ROUTE_ARRAY[@]}"; do
            local route_path="$ROUTES_DIR/$route_name"
            if [ -f "$route_path" ]; then
                [ -n "$result" ] && result+=","
                result+="$route_path"
            fi
        done
        if [ -n "$result" ]; then
            echo "$result"
            return 0
        fi
    fi
    
    local route_directo=""
    route_directo=$(find "$ROUTES_DIR" -name "*${modulo}*.routes.js" 2>/dev/null | head -1 || true)
    echo "$route_directo"
    return 0
}

# =======================================================================================
# SELECTOR INTELIGENTE DE TABLAS
# =======================================================================================

menu_seleccionar_tabla() {
    TABLA_SELECCIONADA=""

    local TABLAS_CRITICAS=(
        "movimientos_caja"
        "turnos_caja"
        "pedidos"
        "pedidoitems"
        "recibos"
        "recibo_items"
        "facturas"
        "factura_items"
        "pagos"
        "cuentacorrienteclientes"
        "cuentacorrienteproveedores"
        "inventario"
        "movimientos_stock"
        "confirmaciones_pago"
        "comprobantes_compra"
        "usuarios"
        "clientes"
        "proveedores"
        "productos"
        "cotizaciones"
        "modulos"
        "rol_modulos"
        "modulo_rutas_api"
    )

    echo ""
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  TABLAS CRITICAS (las mas usadas/conflictivas)${NC}"
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo ""

    local i=1
    for tabla in "${TABLAS_CRITICAS[@]}"; do
        local existe=""
        local count=""
        if verificar_bd; then
            existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla' AND table_schema='public'" 2>/dev/null || true)
            if [ "$existe" = "1" ]; then
                count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                    "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
                local writers=""
                writers=$(grep -rl "INSERT INTO ${tabla}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | wc -l || echo "0")
                local tag=""
                [ "$writers" -gt 2 ] && tag=" ${RED}[${writers} writers!]${NC}"
                printf "  ${GREEN}%2d${NC}. %-30s ${CYAN}(%s reg)${NC}%b\n" "$i" "$tabla" "$count" "$tag"
            else
                printf "  ${RED}%2d${NC}. %-30s ${RED}(no existe)${NC}\n" "$i" "$tabla"
            fi
        else
            printf "  ${GREEN}%2d${NC}. %s\n" "$i" "$tabla"
        fi
        i=$((i + 1))
    done

    echo ""
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo -e "  ${CYAN} B${NC}. Buscar tabla por texto parcial"
    echo -e "  ${CYAN} T${NC}. Ver TODAS las tablas de la BD"
    echo -e "  ${CYAN} M${NC}. Escribir nombre manualmente"
    echo -e "  ${CYAN} 0${NC}. Volver al menu"
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo ""
    read -p "  Opcion: " sel_opcion

    case "$sel_opcion" in
        [0])
            return 1
            ;;
        [bB])
            echo ""
            read -p "  Texto a buscar (ej: caja, pago, stock): " texto_busca
            if [ -z "$texto_busca" ]; then
                echo -e "${RED}  Sin texto de busqueda${NC}"
                return 1
            fi
            echo ""
            echo -e "  ${YELLOW}Tablas que coinciden con '$texto_busca':${NC}"
            echo ""

            local resultados=()
            local j=1
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                local cnt=""
                cnt=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                    "SELECT COUNT(*) FROM $tbl" 2>/dev/null || echo "?")
                printf "  ${GREEN}%2d${NC}. %-35s ${CYAN}(%s reg)${NC}\n" "$j" "$tbl" "$cnt"
                resultados+=("$tbl")
                j=$((j + 1))
            done < <(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                AND table_name LIKE '%${texto_busca}%'
                ORDER BY table_name;
            " 2>/dev/null || true)

            if [ ${#resultados[@]} -eq 0 ]; then
                echo -e "  ${RED}Sin resultados para '$texto_busca'${NC}"
                return 1
            fi

            echo ""
            read -p "  Numero de tabla: " sel_num
            if [[ "$sel_num" =~ ^[0-9]+$ ]] && [ "$sel_num" -ge 1 ] && [ "$sel_num" -le ${#resultados[@]} ]; then
                TABLA_SELECCIONADA="${resultados[$((sel_num - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
        [tT])
            echo ""
            echo -e "  ${YELLOW}Todas las tablas de la BD:${NC}"
            echo ""

            local todas=()
            local k=1
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                printf "  ${GREEN}%3d${NC}. %s\n" "$k" "$tbl"
                todas+=("$tbl")
                k=$((k + 1))
                if (( (k - 1) % 20 == 0 )); then
                    echo ""
                    read -p "  [Enter para mas, o numero para elegir]: " pag_input
                    if [[ "$pag_input" =~ ^[0-9]+$ ]] && [ "$pag_input" -ge 1 ] && [ "$pag_input" -le ${#todas[@]} ]; then
                        TABLA_SELECCIONADA="${todas[$((pag_input - 1))]}"
                        return 0
                    fi
                fi
            done < <(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            " 2>/dev/null || true)

            echo ""
            read -p "  Numero de tabla: " sel_num
            if [[ "$sel_num" =~ ^[0-9]+$ ]] && [ "$sel_num" -ge 1 ] && [ "$sel_num" -le ${#todas[@]} ]; then
                TABLA_SELECCIONADA="${todas[$((sel_num - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
        [mM])
            echo ""
            read -p "  Nombre exacto de la tabla: " nombre_manual
            if [ -z "$nombre_manual" ]; then
                return 1
            fi
            TABLA_SELECCIONADA="$nombre_manual"
            ;;
        *)
            if [[ "$sel_opcion" =~ ^[0-9]+$ ]] && [ "$sel_opcion" -ge 1 ] && [ "$sel_opcion" -le ${#TABLAS_CRITICAS[@]} ]; then
                TABLA_SELECCIONADA="${TABLAS_CRITICAS[$((sel_opcion - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
    esac

    if [ -n "$TABLA_SELECCIONADA" ]; then
        echo ""
        echo -e "  ${GREEN}Tabla seleccionada: ${BOLD}$TABLA_SELECCIONADA${NC}"
        return 0
    fi
    return 1
}

# =======================================================================================
# RASTREO DE USO DE TABLAS
# =======================================================================================

rastrear_uso_tabla() {
    local tabla="$1"

    if [ -z "$tabla" ]; then
        echo -e "${RED}[ERROR] Especifica una tabla. Ej: ./$(basename "${BASH_SOURCE[0]:-toolkit_v68.sh}") rastrear movimientos_caja${NC}"
        return 1
    fi

    explorar_proyecto

    local TRACE_FILE="$OUTPUT_DIR/RASTREO_${tabla}_$(date +%Y%m%d_%H%M).md"

    header
    echo "Rastreando uso de tabla: $tabla"
    echo ""

    cat > "$TRACE_FILE" << EOF
# RASTREO DE TABLA: $tabla
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

EOF

    echo "## 1. INSERT INTO $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local inserts_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        inserts_found=$((inserts_found + 1))
    done < <(grep -rn "INSERT INTO ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $inserts_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 2. UPDATE $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local updates_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        updates_found=$((updates_found + 1))
    done < <(grep -rn "UPDATE ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $updates_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 3. DELETE FROM $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local deletes_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        deletes_found=$((deletes_found + 1))
    done < <(grep -rn "DELETE FROM ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $deletes_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 4. SELECT FROM $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local selects_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        selects_found=$((selects_found + 1))
    done < <(grep -rn "FROM ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null | grep -iv "INSERT\|UPDATE\|DELETE" || true)
    [ $selects_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 5. CONTROLLERS QUE TOCAN $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local archivos_unicos=""
    archivos_unicos=$(grep -rl "${tabla}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sort -u || true)
    if [ -n "$archivos_unicos" ]; then
        while IFS= read -r archivo; do
            local nombre_ctrl
            nombre_ctrl=$(basename "$archivo")
            local ops=""
            grep -q "INSERT INTO ${tabla}" "$archivo" 2>/dev/null && ops+="INSERT "
            grep -q "UPDATE ${tabla}" "$archivo" 2>/dev/null && ops+="UPDATE "
            grep -q "DELETE FROM ${tabla}" "$archivo" 2>/dev/null && ops+="DELETE "
            grep -qi "FROM ${tabla}" "$archivo" 2>/dev/null && ops+="SELECT "
            echo "$nombre_ctrl: $ops" >> "$TRACE_FILE"
        done <<< "$archivos_unicos"
    else
        echo "(ningun controller referencia esta tabla)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 6. HELPERS/UTILS QUE TOCAN $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local helpers_encontrados=""
    for dir_helper in "$PROJECT_ROOT/src/helpers" "$PROJECT_ROOT/src/utils" "$PROJECT_ROOT/src/services"; do
        if [ -d "$dir_helper" ]; then
            local found_helpers=""
            found_helpers=$(grep -rl "${tabla}" "$dir_helper" --include="*.js" 2>/dev/null || true)
            if [ -n "$found_helpers" ]; then
                while IFS= read -r h; do
                    echo "$(basename "$h")" >> "$TRACE_FILE"
                    helpers_encontrados="si"
                done <<< "$found_helpers"
            fi
        fi
    done
    [ -z "$helpers_encontrados" ] && echo "(ningun helper referencia esta tabla)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 7. FRONTEND JS QUE REFERENCIA $tabla (indirecto via endpoints)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if [ -n "$JS_DIR" ] && [ -d "$JS_DIR" ]; then
        if [ -n "$archivos_unicos" ]; then
            while IFS= read -r ctrl_file; do
                local ctrl_base
                ctrl_base=$(basename "$ctrl_file" .controller.js)
                local frontend_refs=""
                frontend_refs=$(grep -rl "/api/${ctrl_base}" "$JS_DIR" --include="*.js" 2>/dev/null || true)
                if [ -n "$frontend_refs" ]; then
                    while IFS= read -r fe_file; do
                        echo "$(basename "$fe_file") -> /api/${ctrl_base} -> $(basename "$ctrl_file")" >> "$TRACE_FILE"
                    done <<< "$frontend_refs"
                fi
            done <<< "$archivos_unicos"
        fi
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 8. VALIDACION id_empresa EN OPERACIONES" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if [ -n "$archivos_unicos" ]; then
        while IFS= read -r archivo; do
            local nombre_ctrl
            nombre_ctrl=$(basename "$archivo")
            local total_ops con_empresa
            total_ops=$(grep -c "INSERT INTO ${tabla}\|UPDATE ${tabla}\|DELETE FROM ${tabla}" "$archivo" 2>/dev/null || true)
            total_ops=${total_ops:-0}
            con_empresa=$(grep "INSERT INTO ${tabla}\|UPDATE ${tabla}\|DELETE FROM ${tabla}" "$archivo" 2>/dev/null | grep -c "id_empresa" || true)
            con_empresa=${con_empresa:-0}
            if [ "$total_ops" -gt 0 ]; then
                if [ "$con_empresa" -eq "$total_ops" ]; then
                    echo "[OK] $nombre_ctrl: $con_empresa/$total_ops con id_empresa" >> "$TRACE_FILE"
                else
                    echo "[WARN] $nombre_ctrl: $con_empresa/$total_ops con id_empresa" >> "$TRACE_FILE"
                fi
            fi
        done <<< "$archivos_unicos"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 9. COLUMNAS GENERATED ALWAYS (si existen)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if verificar_bd; then
        local gen_cols=""
        gen_cols=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT column_name || ' (' || data_type || ') - GENERATED ' || generation_expression
            FROM information_schema.columns
            WHERE table_name = '${tabla}'
            AND is_generated = 'ALWAYS'
            ORDER BY ordinal_position;
        " 2>/dev/null || true)
        if [ -n "$gen_cols" ]; then
            echo "$gen_cols" >> "$TRACE_FILE"
            echo "" >> "$TRACE_FILE"
            echo "ATENCION: Estas columnas NO se pueden escribir via INSERT/UPDATE." >> "$TRACE_FILE"
            echo "Intentar escribirlas genera: 'cannot insert a non-DEFAULT value into column'" >> "$TRACE_FILE"
        else
            echo "(ninguna columna GENERATED detectada)" >> "$TRACE_FILE"
        fi
    else
        echo "(no se pudo conectar a BD)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 10. ESTADO DE MIGRACION A HELPER" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"

    # Helper canonico = (a) si hay un helper con nombre tabla.helper.js
    # o tabla_singular.helper.js, ese gana. Sino (b) el helper con MAS writes
    # (INSERT+UPDATE+DELETE) a la tabla. Sino (c) alfabetico como fallback.
    local helpers_que_escriben="" helper_canonico="" canonico_por_nombre=""
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        # Lista de helpers que ESCRIBEN (INSERT/UPDATE/DELETE) a la tabla, con count
        helpers_que_escriben=$(grep -rl "INSERT INTO ${tabla}\b\|UPDATE ${tabla}\b\|DELETE FROM ${tabla}\b" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | sort -u || true)

        # [v67-G2 v2] Usar scoring helper con normalizacion + bonus por palabras.
        # Probado: tabla "pagosaproveedores" gana "pagos-proveedores.helper.js"
        # sobre "pagos.helper.js" (score 85 vs 50).
        canonico_por_nombre=$(_elegir_helper_canonico "$tabla" "$helpers_que_escriben")

        if [ -n "$canonico_por_nombre" ]; then
            helper_canonico="$canonico_por_nombre"
        elif [ -n "$helpers_que_escriben" ]; then
            # (b) helper con mas writes
            helper_canonico=$(while IFS= read -r hp; do
                [ -z "$hp" ] && continue
                local cnt
                cnt=$(grep -cE "INSERT INTO ${tabla}\b|UPDATE ${tabla}\b|DELETE FROM ${tabla}\b" "$hp" 2>/dev/null)
                echo "$cnt $hp"
            done <<< "$helpers_que_escriben" | sort -rn | head -1 | awk '{print $2}')
        fi

        # Fallback (c): si no escribe nadie, buscar helper que solo lea
        if [ -z "$helper_canonico" ]; then
            helper_canonico=$(grep -rl "FROM ${tabla}\b" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
        fi
    fi

    if [ -n "$helper_canonico" ]; then
        echo "Helper canonico: $(basename "$helper_canonico")" >> "$TRACE_FILE"

        # Otros helpers que tambien escriben (fragmentacion)
        local otros_helpers=""
        if [ -n "$helpers_que_escriben" ]; then
            otros_helpers=$(echo "$helpers_que_escriben" | grep -v "^${helper_canonico}\$" | xargs -n1 basename 2>/dev/null | sort -u)
        fi
        if [ -n "$otros_helpers" ]; then
            echo "Otros helpers que ESCRIBEN a esta tabla:" >> "$TRACE_FILE"
            while IFS= read -r oh; do [ -n "$oh" ] && echo "  - $oh (deberia delegar a $(basename "$helper_canonico"))" >> "$TRACE_FILE"; done <<< "$otros_helpers"
        fi

        local ctrl_directos=0
        ctrl_directos=$(grep -rl "INSERT INTO ${tabla}\b\|UPDATE ${tabla}\b\|DELETE FROM ${tabla}\b" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l)
        echo "Controllers con INSERT/UPDATE directo: $ctrl_directos" >> "$TRACE_FILE"
        if [ "$ctrl_directos" -eq 0 ] && [ -z "$otros_helpers" ]; then
            echo "Estado: MIGRADO LIMPIO - 100% pasa por $(basename "$helper_canonico")" >> "$TRACE_FILE"
        elif [ "$ctrl_directos" -eq 0 ] && [ -n "$otros_helpers" ]; then
            echo "Estado: FRAGMENTADO - varios helpers escriben (ver lista arriba)" >> "$TRACE_FILE"
        else
            echo "Estado: PARCIAL - $ctrl_directos controllers escriben directo:" >> "$TRACE_FILE"
            grep -rl "INSERT INTO ${tabla}\b\|UPDATE ${tabla}\b\|DELETE FROM ${tabla}\b" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | while IFS= read -r f; do echo "  - $(basename "$f")" >> "$TRACE_FILE"; done
        fi
    else
        [ "$inserts_found" -gt 2 ] && echo "Estado: SIN HELPER - $inserts_found INSERTs dispersos, candidato a centralizar" >> "$TRACE_FILE" || echo "Estado: Sin helper (pocos puntos de escritura)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "---" >> "$TRACE_FILE"
    echo "## RESUMEN" >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"
    echo "| Operacion | Ocurrencias |" >> "$TRACE_FILE"
    echo "|-----------|-------------|" >> "$TRACE_FILE"
    echo "| INSERT    | $inserts_found |" >> "$TRACE_FILE"
    echo "| UPDATE    | $updates_found |" >> "$TRACE_FILE"
    echo "| DELETE    | $deletes_found |" >> "$TRACE_FILE"
    echo "| SELECT    | $selects_found |" >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"
    local total_ops=$((inserts_found + updates_found + deletes_found))
    # Antes el ALERTA salia siempre que total_ops>3, sin distinguir
    # si los writes estaban en UN helper (centralizado) o en N helpers
    # (fragmentado). Ahora solo alerta cuando hay writes en controllers o
    # cuando hay 2+ helpers escribiendo.
    local n_helpers_escriben=0
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        n_helpers_escriben=$(grep -rl "INSERT INTO ${tabla}\b\|UPDATE ${tabla}\b\|DELETE FROM ${tabla}\b" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | wc -l)
    fi
    local n_ctrl_escriben=0
    if [ -d "${CONTROLLERS_DIR:-}" ]; then
        n_ctrl_escriben=$(grep -rl "INSERT INTO ${tabla}\b\|UPDATE ${tabla}\b\|DELETE FROM ${tabla}\b" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l)
    fi
    if [ "$n_ctrl_escriben" -gt 0 ]; then
        echo "**ALERTA:** $n_ctrl_escriben controller(s) escriben directo. Migrar a helper." >> "$TRACE_FILE"
    elif [ "$n_helpers_escriben" -gt 1 ]; then
        echo "**ALERTA:** $n_helpers_escriben helpers escriben a esta tabla (fragmentacion). Decidir helper canonico." >> "$TRACE_FILE"
    fi
    echo "" >> "$TRACE_FILE"

    echo -e "${GREEN}[OK] Rastreo generado: $TRACE_FILE${NC}"
    echo ""
    echo -e "  INSERTs: $inserts_found | UPDATEs: $updates_found | DELETEs: $deletes_found | SELECTs: $selects_found"
}

# =======================================================================================
# DETECTAR COLUMNAS GENERATED ALWAYS EN BD
# =======================================================================================

detectar_columnas_generated() {
    if ! verificar_bd; then
        echo "(no se pudo conectar a BD)"
        return 1
    fi

    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT table_name, column_name, data_type, generation_expression
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND is_generated = 'ALWAYS'
        ORDER BY table_name, ordinal_position;
    " 2>/dev/null || echo "(error consultando columnas GENERATED)"
}

# =======================================================================================
# EXTRAER EXPORTS DE CONTROLLER
# =======================================================================================

extraer_exports() {
    local archivo="$1"
    [ ! -f "$archivo" ] && return 0

    local p1=""
    p1=$(grep -E "^exports\." "$archivo" 2>/dev/null | sed 's/exports\.//g; s/ =.*//g' || true)
    if [ -n "$p1" ]; then
        echo "$p1" | sed 's/^/  - /'
        return 0
    fi

    local p2=""
    p2=$(sed -n '/module\.exports\s*=\s*{/,/}/p' "$archivo" 2>/dev/null \
        | sed 's|//.*||; s|/\*.*\*/||' \
        | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*' \
        | grep -vE '^(module|exports|require|const|let|var|async|function|return|true|false|null|undefined)$' \
        | awk 'length >= 4' \
        || true)
    if [ -n "$p2" ]; then
        echo "$p2" | sed 's/^/  - /'
        return 0
    fi

    echo "  (sin exports detectados)"
}

# =======================================================================================
# AUDITAR MODULO MEJORADO - FIXED
# =======================================================================================

# [v68 FIX-12] Map de aliases que son grupos de modulos web
_resolver_alias_modulo() {
    local alias="$1"
    case "$alias" in
        lago.ar|lago|tiendaweb|tienda-web)
            echo "catalogo-web auth-web carrito-web pedidos-web" ;;
        venta-rapida|pos|mostrador)
            echo "venta-rapida borrador" ;;
        cc-clientes|cuentacorriente)
            echo "cc-clientes cobranzas" ;;
        *)
            echo "$alias" ;;
    esac
}

auditar_modulo() {
    local modulo="$1"
    local _visitados="${2:-}"   # [v69 FIX-13] aliases ya expandidos (anti-recursion)
    
    if [ -z "$modulo" ]; then
        echo -e "${RED}[ERROR] Especifica un nombre de modulo${NC}"
        echo "Ejemplo: ./$(basename "${BASH_SOURCE[0]:-toolkit_v68.sh}") auditar clientes"
        return 1
    fi

    # [v68 FIX-12] Si modulo es alias de un grupo (ej. "lago.ar"), auditar
    # cada miembro y devolver el ultimo status.
    local _grupo
    _grupo=$(_resolver_alias_modulo "$modulo")
    # [v69 FIX-13] Solo expandir si este alias NO fue expandido antes en la cadena.
    # Evita recursion infinita cuando un grupo se contiene a si mismo
    # (venta-rapida -> "venta-rapida borrador") o ante ciclos entre grupos.
    if [ "$_grupo" != "$modulo" ] && [[ " ${_visitados} " != *" ${modulo} "* ]]; then
        echo -e "${YELLOW}[INFO] '${modulo}' es alias de un grupo: ${_grupo}${NC}"
        local _miembro _rc=0
        for _miembro in $_grupo; do
            echo -e "${CYAN}  Auditando submodulo: ${_miembro}${NC}"
            auditar_modulo "$_miembro" "${_visitados} ${modulo}" || _rc=$?
        done
        return $_rc
    fi
    
    local AUDIT_FILE="$OUTPUT_DIR/AUDITORIA_${modulo}_$(date +%Y%m%d_%H%M).md"
    
    header
    echo "Auditando modulo: $modulo (con mapeo inteligente)"
    echo ""
    
    explorar_proyecto
    
    local total_componentes=5
    local encontrados=0
    local errores=0
    
    cat > "$AUDIT_FILE" << EOF
# AUDITORIA MODULO: $modulo
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Version Toolkit: v${VERSION}

---

EOF

    # === FRONTEND ===
    echo "## 1. ARCHIVOS DEL FRONTEND" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    local html_file=""
    html_file=$(find "$FRONTEND_DIR" -maxdepth 1 -name "*${modulo}*.html" 2>/dev/null | head -1 || true)
    if [ -n "$html_file" ] && [ -f "$html_file" ]; then
        echo "OK HTML: $html_file" >> "$AUDIT_FILE"
        encontrados=$((encontrados + 1))
    else
        echo "FALTA HTML: No encontrado (*${modulo}*.html)" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    
    local js_file=""
    for pattern in "${modulo}.js" "${modulo}-script.js"; do
        local found=""
        found=$(find "$JS_DIR" -name "$pattern" 2>/dev/null | head -1 || true)
        if [ -n "$found" ]; then
            js_file="$found"
            break
        fi
    done
    
    if [ -n "$js_file" ] && [ -f "$js_file" ]; then
        local lineas=""
        lineas=$(wc -l < "$js_file" 2>/dev/null || echo "?")
        echo "OK JS Frontend: $js_file ($lineas lineas)" >> "$AUDIT_FILE"
        encontrados=$((encontrados + 1))
        
        local endpoints=""
        endpoints=$(detectar_endpoints_usados "$js_file")
        if [ -n "$endpoints" ]; then
            echo "   Endpoints usados: $endpoints" >> "$AUDIT_FILE"
        fi
    else
        if [ -n "$html_file" ] && [ -f "$html_file" ]; then
            local from_html=""
            from_html=$(grep -oE 'src="js/[^"]+\.js"' "$html_file" 2>/dev/null \
                | sed 's/src="js\///; s/"//' \
                | grep -vE "^(config|config-panel|common|utils|CONFIG|modal|connection-indicator|auth)\." \
                | tail -1 || true)
            if [ -n "$from_html" ] && [ -f "$JS_DIR/$from_html" ]; then
                js_file="$JS_DIR/$from_html"
                local lineas=""
                lineas=$(wc -l < "$js_file" 2>/dev/null || echo "?")
                echo "OK JS Frontend: $js_file ($lineas lineas) [detectado desde HTML]" >> "$AUDIT_FILE"
                encontrados=$((encontrados + 1))
                local endpoints=""
                endpoints=$(detectar_endpoints_usados "$js_file")
                if [ -n "$endpoints" ]; then
                    echo "   Endpoints usados: $endpoints" >> "$AUDIT_FILE"
                fi
            else
                echo "FALTA JS Frontend: No encontrado (ni por nombre ni en HTML)" >> "$AUDIT_FILE"
                errores=$((errores + 1))
            fi
        else
            echo "FALTA JS Frontend: No encontrado" >> "$AUDIT_FILE"
            errores=$((errores + 1))
        fi
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === BACKEND ===
    echo "## 2. ARCHIVOS DEL BACKEND" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    local controllers=""
    controllers=$(detectar_controllers_relacionados "$modulo" "$js_file")
    if [ -n "$controllers" ]; then
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            if [ -f "$ctrl" ]; then
                echo "OK Controller: $ctrl" >> "$AUDIT_FILE"
            fi
        done
        encontrados=$((encontrados + 1))
    else
        echo "FALTA Controller: No encontrado" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    
    local routes=""
    routes=$(detectar_routes_relacionadas "$modulo")
    if [ -n "$routes" ]; then
        IFS=',' read -ra ROUTE_ARRAY <<< "$routes"
        for route in "${ROUTE_ARRAY[@]}"; do
            if [ -f "$route" ]; then
                echo "OK Routes: $route" >> "$AUDIT_FILE"
            fi
        done
        encontrados=$((encontrados + 1))
    else
        echo "FALTA Routes: No encontrado" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === TABLAS BD ===
    echo "## 3. TABLAS EN BASE DE DATOS" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    if verificar_bd; then
        local tablas=""
        tablas=$(detectar_tablas_relacionadas "$modulo")
        local tabla_encontrada=0
        
        if [ -n "$tablas" ]; then
            IFS=',' read -ra TABLA_ARRAY <<< "$tablas"
            for tabla in "${TABLA_ARRAY[@]}"; do
                [ -z "$tabla" ] && continue
                if _table_exists "$tabla"; then
                    local count=""
                    count=$(_table_count "$tabla")
                    local tiene_empresa=""
                    tiene_empresa=$(_run_sql "SELECT 1 FROM information_schema.columns WHERE table_name='$tabla' AND column_name='id_empresa'")
                    local scope="COMPARTIDA"
                    [ "$tiene_empresa" = "1" ] && scope="POR EMPRESA"
                    echo "OK $tabla ($count registros) [$scope]" >> "$AUDIT_FILE"
                    tabla_encontrada=1
                fi
            done
        fi
        
        if [ $tabla_encontrada -eq 1 ]; then
            encontrados=$((encontrados + 1))
        else
            echo "FALTA tablas relacionadas" >> "$AUDIT_FILE"
            errores=$((errores + 1))
        fi
    else
        echo "WARN: No se pudo conectar a la BD" >> "$AUDIT_FILE"
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === FUNCIONES EXPORTADAS ===
    if [ -n "$controllers" ]; then
        echo "## 4. FUNCIONES EXPORTADAS" >> "$AUDIT_FILE"
        echo '```' >> "$AUDIT_FILE"
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            if [ -f "$ctrl" ]; then
                echo "// $(basename "$ctrl")" >> "$AUDIT_FILE"
                extraer_exports "$ctrl" >> "$AUDIT_FILE"
                echo "" >> "$AUDIT_FILE"
            fi
        done
        echo '```' >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
    fi

    # === HELPERS CENTRALIZADOS UTILIZADOS ===
    echo "## 5. HELPERS CENTRALIZADOS UTILIZADOS" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    local helpers_usados=0
    if [ -n "$controllers" ] && [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            [ ! -f "$ctrl" ] && continue
            local requires=""
            requires=$(grep -oE "require\(['\"].*helper['\"]" "$ctrl" 2>/dev/null | sed "s/require(['\"]//;s/['\"]$//" || true)
            if [ -n "$requires" ]; then
                while IFS= read -r req; do
                    echo "$(basename "$ctrl") -> $(basename "$req" 2>/dev/null)" >> "$AUDIT_FILE"
                    helpers_usados=$((helpers_usados + 1))
                done <<< "$requires"
            fi
        done
    fi
    [ "$helpers_usados" -eq 0 ] && echo "(ningun controller de este modulo importa helpers)" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === [v36] VERIFICACION DE AUTH EN HTML ===
    echo "## 6. VERIFICACION AUTH" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    if [ -n "$html_file" ] && [ -f "$html_file" ]; then
        local carga_auth=""
        carga_auth=$(grep -c "auth\.js" "$html_file" 2>/dev/null) || carga_auth=0
        [ "$carga_auth" -gt 0 ] && echo "[OK] HTML carga auth.js" >> "$AUDIT_FILE" || echo "[WARN] HTML NO carga auth.js" >> "$AUDIT_FILE"
    fi
    if [ -n "$js_file" ] && [ -f "$js_file" ]; then
        local tiene_token_check=""
        tiene_token_check=$(grep -c "localStorage.*token\|getItem.*token" "$js_file" 2>/dev/null) || tiene_token_check=0
        [ "$tiene_token_check" -gt 0 ] && echo "[INFO] JS tiene verificacion de token propia (redundante con server-side)" >> "$AUDIT_FILE" || echo "[OK] JS no verifica token (delega a server-side)" >> "$AUDIT_FILE"
        local tiene_doble_api=""
        tiene_doble_api=$(grep -c 'API_BASE.*\/api\/' "$js_file" 2>/dev/null) || tiene_doble_api=0
        [ "$tiene_doble_api" -gt 0 ] && echo "[BUG] JS tiene doble /api ($tiene_doble_api ocurrencias)" >> "$AUDIT_FILE" || echo "[OK] Sin doble /api" >> "$AUDIT_FILE"
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === RESULTADO FINAL ===
    echo "---" >> "$AUDIT_FILE"
    echo "## RESULTADO DE AUDITORIA" >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"
    
    local porcentaje=$((encontrados * 100 / total_componentes))
    
    if [ $errores -eq 0 ]; then
        echo "### COMPLETA ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "Todos los componentes del modulo fueron encontrados." >> "$AUDIT_FILE"
        echo -e "${GREEN}[OK] Auditoria COMPLETA${NC}"
    elif [ $encontrados -ge 3 ]; then
        echo "### PARCIAL ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "| Metrica | Valor |" >> "$AUDIT_FILE"
        echo "|---------|-------|" >> "$AUDIT_FILE"
        echo "| Componentes encontrados | $encontrados / $total_componentes |" >> "$AUDIT_FILE"
        echo "| Componentes faltantes | $errores |" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "**Nota:** Este modulo puede usar nombres diferentes en backend." >> "$AUDIT_FILE"
        echo -e "${YELLOW}[OK] Auditoria PARCIAL ($encontrados/$total_componentes)${NC}"
    else
        echo "### INCOMPLETA ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "El modulo parece estar incompleto o usa arquitectura no estandar." >> "$AUDIT_FILE"
        echo -e "${RED}[WARN] Auditoria INCOMPLETA ($encontrados/$total_componentes)${NC}"
    fi
    
    echo ""
    echo -e "Archivo generado: ${CYAN}$AUDIT_FILE${NC}"
}

# =======================================================================================
# DOCUMENTAR ARQUITECTURA DE NEGOCIO
# =======================================================================================

documentar_arquitectura_negocio() {
    local ARCH_FILE="$OUTPUT_DIR/ARQUITECTURA_NEGOCIO.md"
    
    header
    echo "Generando documentacion de Arquitectura de Negocio..."
    echo ""
    
    cat > "$ARCH_FILE" << EOF
# ARQUITECTURA DE NEGOCIO - ERP LAGO
## Generado automaticamente por Toolkit v${VERSION}

---

## 1. MODELO MULTI-EMPRESA

EOF
    
    echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    if verificar_bd; then
        local num_empresas=""
        num_empresas=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(*) FROM empresas" 2>/dev/null || echo "0")
        echo "**Empresas registradas:** $num_empresas" >> "$ARCH_FILE"
        echo "" >> "$ARCH_FILE"
    fi

    echo "### Tablas COMPARTIDAS (sin id_empresa - catalogo global)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT t.table_name 
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c 
            WHERE c.table_name = t.table_name 
            AND c.column_name = 'id_empresa'
        )
        ORDER BY t.table_name;
    " 2>/dev/null >> "$ARCH_FILE" || echo "(error consultando BD)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "### Tablas POR EMPRESA (aisladas por id_empresa)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT DISTINCT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'id_empresa' 
        AND table_schema = 'public'
        ORDER BY table_name;
    " 2>/dev/null >> "$ARCH_FILE" || echo "(error consultando BD)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 2. JERARQUIA: Empresa -> Sucursal -> Deposito" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    echo "-- EMPRESAS" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 'Empresas: ' || COUNT(*) FROM empresas" 2>/dev/null >> "$ARCH_FILE" || true
    
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 1 FROM information_schema.tables WHERE table_name='sucursales'" 2>/dev/null | grep -q 1; then
        echo "" >> "$ARCH_FILE"
        echo "-- SUCURSALES (estructura)" >> "$ARCH_FILE"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sucursales' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    fi
    
    echo "" >> "$ARCH_FILE"
    echo "-- DEPOSITOS (estructura)" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='depositos' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 3. SEGURIDAD (WireGuard + Fingerprinting + Control Acceso)" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo "### Tablas de control de acceso:" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    for tabla in dispositivos_autorizados intentos_dispositivo_nuevo usuarios_logs modulos rol_modulos modulo_rutas_api modulo_grupos rutas_soporte; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        if [ "$existe" = "1" ]; then
            local count=""
            count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
            echo "OK $tabla ($count registros)" >> "$ARCH_FILE"
        fi
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Flujo de autorizacion:
1. Usuario intenta acceder desde nuevo dispositivo
2. Sistema registra en `intentos_dispositivo_nuevo`
3. Admin aprueba/rechaza desde panel
4. Si aprobado -> se agrega a `dispositivos_autorizados`
5. VPN WireGuard solo permite IPs autorizadas

### Control de acceso a modulos (v36):
1. Browser pide `*.html` → `html-access.middleware.js` intercepta
2. Lee cookie `erp_token` (httpOnly, JWT) → valida token
3. Sin cookie → redirect `/login.html`
4. Token valido → consulta `rol_modulos` (cache 5min)
5. Admin → acceso total (anti-lockout)
6. Otro rol → verifica si tiene acceso al modulo
7. Paginas publicas: `login.html`, `ver-pedido-publico.html`, `index.html`
8. Menu dinamico: `auth.js v3.0` auto-inyecta offcanvas con modulos del rol

---

## 4. SISTEMA DE IMPRESION (Productor-Consumidor)

EOF

    echo '```' >> "$ARCH_FILE"
    for tabla in print_jobs printers_config log_impresiones; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        [ "$existe" = "1" ] && echo "OK $tabla" >> "$ARCH_FILE"
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Patron real (post-descarte Puppeteer)
El ERP NO usa Puppeteer/CUPS/cola de jobs (descartado por OOM + bloqueo de event loop).
El patron unico vigente es HTML server-side + window.print() del cliente:

1. Frontend dispara `window.open('/api/print/<tipo>/:id/html?token=...')`
2. Backend (print.controller) consulta BD, renderiza plantilla `.hbs`, devuelve HTML
3. HTML incluye `<script>window.onload = () => window.print();</script>` al final
4. El browser del cliente abre el dialogo de impresion (cero estado en servidor)

### Tablas historicas (NO son el patron actual)
Si `print_jobs`, `printers_config` o `log_impresiones` tienen filas, son restos.
El patron actual NO las usa. NO proponer reactivar Puppeteer/CUPS bajo ningun motivo.

### Plantillas disponibles:
EOF

    echo '```' >> "$ARCH_FILE"
    if [ -d "$PROJECT_ROOT/config/plantillas" ]; then
        ls -1 "$PROJECT_ROOT/config/plantillas/" 2>/dev/null >> "$ARCH_FILE" || echo "(vacio)"
    elif [ -d "$PROJECT_ROOT/templates/comprobantes" ]; then
        ls -1 "$PROJECT_ROOT/templates/comprobantes/" 2>/dev/null >> "$ARCH_FILE" || echo "(vacio)"
    else
        echo "(directorio de plantillas no encontrado)" >> "$ARCH_FILE"
    fi
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 5. MULTIMONEDA Y COTIZACIONES" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    echo "-- MONEDAS DISPONIBLES" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT * FROM monedas ORDER BY id_moneda" 2>/dev/null >> "$ARCH_FILE" || true
    echo "" >> "$ARCH_FILE"
    echo "-- ULTIMA COTIZACION USD" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT * FROM cotizaciones WHERE id_moneda = 2 ORDER BY fecha_cotizacion DESC LIMIT 1" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 6. NOTAS DE CREDITO Y DEBITO" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    local existe_notas=""
    existe_notas=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 1 FROM information_schema.tables WHERE table_name='notas_credito_debito'" 2>/dev/null || true)
    if [ "$existe_notas" = "1" ]; then
        echo "-- Tabla UNICA para NC y ND (diferenciadas por campo 'tipo')" >> "$ARCH_FILE"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='notas_credito_debito' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    fi
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
---

## 7. IMAGENES DE PRODUCTOS

- **Almacenamiento:** Servidor externo de imagenes (hosting estatico)
- **Campo en BD:** `productos.url_imagen` (VARCHAR 255)
- **Formato:** URL completa/enlace directo
- **Procesamiento:** No se procesan localmente, solo se guarda el enlace

---

## 8. CONFIGURACIONES DEL SISTEMA

EOF

    echo '```' >> "$ARCH_FILE"
    for tabla in configuracion_sistema configuraciones_empresa configuracion_empresa_extendida usuario_configuracion; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        if [ "$existe" = "1" ]; then
            local count=""
            count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
            echo "OK $tabla ($count registros)" >> "$ARCH_FILE"
        fi
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Jerarquia de configuraciones:
1. `configuracion_sistema` -> Parametros globales del ERP
2. `configuraciones_empresa` -> Config especifica por empresa
3. `configuracion_empresa_extendida` -> Extensiones por empresa
4. `usuario_configuracion` -> Preferencias individuales de usuario

EOF

    # §9 METODOS DE PAGO
    echo "---" >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo "## 9. METODOS DE PAGO" >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    local existe_mp=""
    existe_mp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='metodosdepago'" 2>/dev/null || true)
    [ "$existe_mp" = "1" ] && psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT * FROM metodosdepago ORDER BY id_metodo_pago" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo "### Recargos/Descuentos por forma de pago:" >> "$ARCH_FILE"; echo '```sql' >> "$ARCH_FILE"
    local existe_rfp=""
    existe_rfp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='recargos_forma_pago'" 2>/dev/null || true)
    if [ "$existe_rfp" = "1" ]; then
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT rfp.*, mp.nombre as metodo FROM recargos_forma_pago rfp LEFT JOIN metodosdepago mp ON rfp.id_metodo_pago=mp.id_metodo_pago WHERE rfp.activo=true ORDER BY rfp.id_metodo_pago" 2>/dev/null >> "$ARCH_FILE" || true
    else echo "(tabla recargos_forma_pago no existe)" >> "$ARCH_FILE"; fi
    echo '```' >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"

    # §10 HELPERS y §11 PROGRESO MIGRACION removidos de arquitectura.
    # Estaban duplicados en PROMPT_MAESTRO. La doc de arquitectura se queda con
    # los conceptos estructurales (multi-empresa, jerarquia, seguridad, impresion,
    # multimoneda, NC/ND, imagenes, configs, metodos de pago) — el inventario
    # operativo de helpers vive en PROMPT_MAESTRO.

    echo "---" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo "*Generado por ERP LAGO Toolkit v${VERSION}*" >> "$ARCH_FILE"

    echo -e "${GREEN}[OK] Arquitectura de negocio documentada: $ARCH_FILE${NC}"
}

# =======================================================================================
# MEMORIA HISTORICA
# =======================================================================================

inicializar_historia() {
    if [ ! -f "$HISTORY_FILE" ]; then
        cat > "$HISTORY_FILE" << 'EOF'
{
    "version": "24.1",
    "created": "",
    "snapshots": []
}
EOF
        local fecha
        fecha=$(date -Iseconds)
        sed -i "s/\"created\": \"\"/\"created\": \"$fecha\"/" "$HISTORY_FILE"
    fi
}

guardar_snapshot() {
    inicializar_historia
    
    local fecha tablas_count vistas_count html_count ctrl_count routes_count js_count git_commit
    fecha=$(date -Iseconds)
    tablas_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>/dev/null || echo "0")
    vistas_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public';" 2>/dev/null || echo "0")
    html_count=$(find "$PROJECT_ROOT/frontend" -maxdepth 1 -name "*.html" 2>/dev/null | wc -l)
    ctrl_count=$(find "$PROJECT_ROOT/src/controllers" -name "*.js" 2>/dev/null | wc -l)
    routes_count=$(find "$PROJECT_ROOT/src/routes" -name "*.js" 2>/dev/null | wc -l)
    js_count=$(find "$PROJECT_ROOT/frontend/js" -name "*.js" 2>/dev/null | wc -l)
    
    git_commit=""
    if verificar_git; then
        git_commit=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "")
    fi

    local snapshot
    snapshot=$(cat << EOF
{
    "fecha": "$fecha",
    "git_commit": "$git_commit",
    "metricas": {
        "tablas_bd": $tablas_count,
        "vistas_bd": $vistas_count,
        "html_frontend": $html_count,
        "js_frontend": $js_count,
        "controllers": $ctrl_count,
        "routes": $routes_count
    },
    "errores_criticos": $ERRORES_CRITICOS,
    "advertencias": $ADVERTENCIAS,
    "sugerencias": $SUGERENCIAS
}
EOF
)

    if command -v jq &>/dev/null; then
        local temp_file
        temp_file=$(mktemp)
        jq ".snapshots += [$snapshot]" "$HISTORY_FILE" > "$temp_file" && mv "$temp_file" "$HISTORY_FILE"
    else
        echo "$snapshot" >> "${HISTORY_FILE%.json}_snapshots.log"
    fi
}

mostrar_tendencia() {
    if [ ! -f "$HISTORY_FILE" ]; then
        echo "(Sin historial previo)"
        return
    fi

    if command -v jq &>/dev/null; then
        local total_snapshots
        total_snapshots=$(jq '.snapshots | length' "$HISTORY_FILE" 2>/dev/null || echo "0")
        if [ "$total_snapshots" -gt 1 ]; then
            echo "Snapshots guardados: $total_snapshots"
            echo ""
            echo "Ultimos 5 snapshots:"
            jq -r '.snapshots | .[-5:] | .[] | "  \(.fecha) | Tablas: \(.metricas.tablas_bd) | Controllers: \(.metricas.controllers) | Errores: \(.errores_criticos)"' "$HISTORY_FILE" 2>/dev/null
        else
            echo "Solo 1 snapshot guardado."
        fi
    else
        echo "(Instala jq para ver tendencias)"
    fi
}

# =======================================================================================
# INFORME DE SALUD ARQUITECTONICA
# =======================================================================================

generar_informe_salud() {
    ARCHIVO="$OUTPUT_DIR/SALUD_ARQUITECTONICA.md"
    
    echo "Generando informe de salud..."
    > "$ARCHIVO"
    
    echo "# SALUD ARQUITECTONICA" >> "$ARCHIVO"
    echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    
    # §1 Archivos grandes removido (telemetria, no arquitectura). Disponible via CLI.
    
    # §2 Console.log removido (telemetria). §5 Logger ya cubre el dato relevante.
    
    # §3 Rutas auth
    echo "## 1. Autenticacion en rutas" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    # [v69] Detector consciente de: guard interno (verificarToken), guard web
    # (verificarClienteWeb), guard en el MOUNT de index.js, y rutas PUBLICAS por
    # diseno. Antes solo veia verificarToken en el archivo -> falso "sin token" en
    # auth-web/catalogo/carrito (publicas) y mis-pedidos (usa verificarClienteWeb).
    local PUBLICAS_OK=" health auth-web catalogo-web carrito-web "
    # Modulos cuyo guard esta en el mount de index.js: router.use('/x', verificarToken, xRoutes)
    local INDEX_RT="$ROUTES_DIR/index.js"
    local MOUNT_GUARDED=" "
    if [ -f "$INDEX_RT" ]; then
        local _vg _modg
        while IFS= read -r _vg; do
            [ -z "$_vg" ] && continue
            _modg=$(grep -oE "${_vg}[[:space:]]*=[[:space:]]*require\(['\"]\./[a-zA-Z0-9_-]+\.routes" "$INDEX_RT" 2>/dev/null \
                    | grep -oE "[a-zA-Z0-9_-]+\.routes" | sed -E "s#\.routes##" | head -1)
            [ -n "$_modg" ] && MOUNT_GUARDED="${MOUNT_GUARDED}${_modg} "
        done < <(grep -oE "router\.use\([^,]+,[[:space:]]*verificarToken[[:space:]]*,[[:space:]]*[a-zA-Z0-9_]+Routes" "$INDEX_RT" 2>/dev/null \
                 | grep -oE "[a-zA-Z0-9_]+Routes")
    fi
    for F in "$ROUTES_DIR"/*.routes.js; do
        [ -f "$F" ] || continue
        NOMBRE=$(basename "$F")
        local MOD="${NOMBRE%.routes.js}"
        if grep -q "router\.use(verificarToken)" "$F" 2>/dev/null; then
            echo "- [OK] $NOMBRE (auth global interna)" >> "$ARCHIVO"
        elif grep -q "router\.use(verificarClienteWeb)" "$F" 2>/dev/null; then
            echo "- [OK] $NOMBRE (auth global web)" >> "$ARCHIVO"
        elif echo "$MOUNT_GUARDED" | grep -q " ${MOD} "; then
            echo "- [OK] $NOMBRE (auth en mount index.js)" >> "$ARCHIVO"
        elif echo "$PUBLICAS_OK" | grep -q " ${MOD} " || grep -qE "inyectarSessionAnonima|clienteWebOpcional" "$F" 2>/dev/null; then
            echo "- [OK] $NOMBRE (publico por diseño)" >> "$ARCHIVO"
        else
            local SIN_AUTH
            SIN_AUTH=$(grep -E "router\.(get|post|put|delete|patch)" "$F" 2>/dev/null | grep -vE "verificarToken|verificarClienteWeb" | wc -l)
            SIN_AUTH=$(echo "$SIN_AUTH" | tr -d '[:space:]')
            if [ "${SIN_AUTH:-0}" -gt 0 ]; then
                echo "- [WARN] $NOMBRE: $SIN_AUTH rutas sin auth (revisar)" >> "$ARCHIVO"
            else
                echo "- [OK] $NOMBRE (auth individual)" >> "$ARCHIVO"
            fi
        fi
    done
    echo "" >> "$ARCHIVO"
    
    # §4 Codigo muerto removido (lint, no arquitectura).

    # §5 Logger removido (estado binario, ya documentado en arquitectura).

    # §2 eliminada — duplicaba Check 1 de auditoria-me (§8) con peor análisis.
    # El Check 1 de §8 ya hace la misma verificación context-aware (±40 líneas) pero con
    # skip de comentarios JSDoc y tablas compartidas. Ver SALUD §8 / Integridad multiempresa.
    echo "## 2. Writes sin id_empresa" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    echo "*Análisis consolidado en §8 (Integridad auditoria multi-empresa / Check 1).*" >> "$ARCHIVO"
    echo "*Context-aware ±40 líneas, skip comentarios + tablas compartidas.*" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # §7 Modelo usuario-empresa-deposito
    echo "## 3. Modelo Usuario-Empresa-Deposito" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    USERS_TOTAL=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios" 2>/dev/null || echo "0")
    USERS_EMP=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios WHERE id_empresa IS NOT NULL" 2>/dev/null || echo "0")
    USERS_DEP=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios WHERE id_deposito IS NOT NULL" 2>/dev/null || echo "0")
    echo "- Usuarios con id_empresa: $USERS_EMP/$USERS_TOTAL" >> "$ARCHIVO"
    echo "- Usuarios con id_deposito: $USERS_DEP/$USERS_TOTAL" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # §8 Columnas GENERATED
    # §16 Constraints vs Triggers (v44)
    echo "## 4. CHECK constraints vs triggers" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_constraints_triggers "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    echo "## 5. Columnas GENERATED ALWAYS (NO escribibles)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if verificar_bd; then
        local gen_count=""
        gen_count=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema='public' AND is_generated='ALWAYS';
        " 2>/dev/null || echo "0")
        echo "Total columnas GENERATED: $gen_count" >> "$ARCHIVO"
        if [ "$gen_count" -gt 0 ]; then
            psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT '- ' || table_name || '.' || column_name || ' (' || data_type || ')'
                FROM information_schema.columns
                WHERE table_schema='public' AND is_generated='ALWAYS'
                ORDER BY table_name;
            " 2>/dev/null >> "$ARCHIVO" || true
        fi
    fi
    echo "" >> "$ARCHIVO"

    # §9 Tablas multiples puntos escritura
    echo "## 6. Tablas con multiples puntos de escritura (riesgo de inconsistencia)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if [ -d "$PROJECT_ROOT/src/controllers" ]; then
        local tablas_insertadas="" _hubo7=0
        tablas_insertadas=$(grep -roh "INSERT INTO [a-z_]*" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sed 's/INSERT INTO //' | sort | uniq -c | sort -rn || true)
        if [ -n "$tablas_insertadas" ]; then
            while IFS= read -r linea; do
                local count_ins tabla_ins
                count_ins=$(echo "$linea" | awk '{print $1}')
                tabla_ins=$(echo "$linea" | awk '{print $2}')
                if [ "$count_ins" -gt 2 ]; then
                    local archivos_distintos=""
                    archivos_distintos=$(grep -rl "INSERT INTO ${tabla_ins}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | wc -l || echo "0")
                    if [ "$archivos_distintos" -gt 1 ]; then
                        echo "- [WARN] $tabla_ins: $count_ins INSERTs en $archivos_distintos archivos distintos" >> "$ARCHIVO"
                        _hubo7=1
                    fi
                fi
            done <<< "$tablas_insertadas"
        fi
        # [v69-b4] Si no hubo INSERTs dispersos en CONTROLLERS, NO dejar la seccion
        # muda (parece chequeo roto). En este ERP las escrituras viven en HELPERS,
        # asi que vacio = lo esperado. El analisis real de helpers que pisan helpers
        # esta en EXTRA §8 (HELPERS QUE PISAN OTROS HELPERS).
        if [ "$_hubo7" -eq 0 ]; then
            echo "- [OK] sin tablas con INSERT disperso en controllers (esperado: las escrituras se centralizan en helpers)." >> "$ARCHIVO"
            echo "- Para escritura dispersa entre HELPERS, ver EXTRA §8 (HELPERS QUE PISAN OTROS HELPERS)." >> "$ARCHIVO"
        fi
    fi
    echo "" >> "$ARCHIVO"

    # §10 Progreso de migracion DUPLICADO removido. Ya esta en PROMPT_MAESTRO.

    # §11-§15: Solo scores compactos. Detalle completo en PROMPT_MAESTRO y SEGURIDAD
    echo "## 7. Resumen rapido (detalle en PROMPT_MAESTRO y SEGURIDAD)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # Score Features
    local feat_count=0
    if [ -n "${ROUTES_DIR:-}" ] && [ -d "$ROUTES_DIR" ]; then
        feat_count=$(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | wc -l || echo "0")
    fi
    echo "- Modulos con rutas: $feat_count" >> "$ARCHIVO"

    # Score Seguridad
    local sec_ok=0 sec_warn=0
    if [ -n "${JS_DIR:-}" ] && [ -d "$JS_DIR" ]; then
        sec_warn=$(grep -rl "login\.html" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak\|auth\.js\|login\.js" | wc -l || echo "0")
    fi
    local doble_api=0
    if [ -n "${JS_DIR:-}" ] && [ -d "$JS_DIR" ]; then
        doble_api=$(grep -rn 'API_BASE.*\/api\/' "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" | wc -l || echo "0")
    fi
    echo "- Seguridad: ${sec_warn} redirects redundantes, ${doble_api} doble /api (ver SEGURIDAD para detalle)" >> "$ARCHIVO"

    # Score Transacciones (caller-aware: helpers reciben client ya transaccionado)
    local tx_ok=0 tx_warn=0
    local TABLAS_FIN_CHECK="movimientos_caja turnos_caja recibos recibo_items cuentacorrienteclientes cuentacorrienteproveedores pagosaproveedores facturas factura_items inventario movimientos_stock confirmaciones_pago"
    for tbl_chk in $TABLAS_FIN_CHECK; do
        local archivos_chk=""
        archivos_chk=$(grep -rl "INSERT INTO ${tbl_chk}" "$CONTROLLERS_DIR" ${UTILS_DIR:+"$UTILS_DIR"} --include="*.js" 2>/dev/null || true)
        [ -z "$archivos_chk" ] && continue
        while IFS= read -r arch_chk; do
            [ -z "$arch_chk" ] && continue
            local tb=""
            tb=$(grep -c "BEGIN\|client\.query.*BEGIN\|pool\.query.*BEGIN" "$arch_chk" 2>/dev/null) || tb=0
            if [ "$tb" -gt 0 ]; then
                tx_ok=$((tx_ok + 1))
            else
                # Caller-aware: si el helper recibe client (no pool), la TX la maneja el controller
                local uses_client=""
                uses_client=$(grep -c "async function.*client," "$arch_chk" 2>/dev/null) || uses_client=0
                if [ "$uses_client" -gt 0 ]; then
                    # Verificar que algun controller caller tenga BEGIN
                    local helper_name caller_has_begin=0
                    helper_name=$(basename "$arch_chk" .js | sed 's/\.helper//')
                    local callers=""
                    callers=$(grep -rl "require.*${helper_name}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
                    if [ -n "$callers" ]; then
                        while IFS= read -r caller; do
                            [ -z "$caller" ] && continue
                            local cb=""
                            cb=$(grep -c "BEGIN" "$caller" 2>/dev/null) || cb=0
                            if [ "$cb" -gt 0 ]; then caller_has_begin=1; break; fi
                        done <<< "$callers"
                    fi
                    if [ "$caller_has_begin" -eq 1 ]; then tx_ok=$((tx_ok + 1)); else tx_warn=$((tx_warn + 1)); fi
                else
                    tx_warn=$((tx_warn + 1))
                fi
            fi
        done <<< "$archivos_chk"
    done
    echo "- Transacciones: ${tx_ok} OK, ${tx_warn} sin BEGIN/COMMIT (ver SEGURIDAD §10)" >> "$ARCHIVO"

    # Score Endpoints huerfanos
    local huerfanos_cnt=0
    if [ -d "$CONTROLLERS_DIR" ] && [ -d "$ROUTES_DIR" ]; then
        while IFS= read -r rf; do
            [ -z "$rf" ] && continue
            local rn; rn=$(basename "$rf" .routes.js)
            local cf=""
            cf=$(find "$CONTROLLERS_DIR" -name "${rn}.controller.js" 2>/dev/null | head -1 || true)
            [ -z "$cf" ] && continue
            local fr=""
            fr=$(grep -oE "[a-zA-Z]*[Cc]ontroller\.[a-zA-Z_][a-zA-Z0-9_]*" "$rf" 2>/dev/null | sed 's/.*\.//' | sort -u || true)
            local fc=""
            fc=$(grep -oE "exports\.[a-zA-Z_][a-zA-Z0-9_]*" "$cf" 2>/dev/null | sed 's/exports\.//' | sort -u || true)
            if [ -n "$fc" ]; then
                while IFS= read -r fn; do
                    [ -z "$fn" ] && continue
                    if [ -n "$fr" ] && echo "$fr" | grep -qw "$fn"; then :; else huerfanos_cnt=$((huerfanos_cnt + 1)); fi
                done <<< "$fc"
            fi
        done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)
    fi
    if [ "$huerfanos_cnt" -eq 0 ]; then
        echo "- Endpoints huerfanos: [OK] ninguno" >> "$ARCHIVO"
    else
        echo "- Endpoints huerfanos: ${huerfanos_cnt} sin ruta (ver SEGURIDAD §11)" >> "$ARCHIVO"
    fi

    # Score Multi-empresa
    if verificar_bd; then
        local me_total me_con me_sin
        me_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo "0")
        me_con=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(DISTINCT table_name) FROM information_schema.columns WHERE table_schema='public' AND column_name='id_empresa'" 2>/dev/null || echo "0")
        me_sin=$((me_total - me_con))
        local queries_sin=0
        if [ -d "${CONTROLLERS_DIR:-}" ]; then
            for tbl_me in cotizaciones formas_pago listasdeprecios metodosdepago pagos producto_proveedor rol_modulos; do
                local qs=0
                qs=$(grep -rn "FROM ${tbl_me}\b" "${CONTROLLERS_DIR}" "${UTILS_DIR:-/dev/null}" --include="*.js" 2>/dev/null \
                    | grep -v "node_modules" | grep -v "id_empresa" | grep -v "^\s*//" | wc -l || echo "0")
                queries_sin=$((queries_sin + qs))
            done
        fi
        echo "- Multi-empresa: ${me_con}/${me_total} tablas con id_empresa, ${queries_sin} queries sin filtro (ver PROMPT §9.6)" >> "$ARCHIVO"
    fi
    echo "" >> "$ARCHIVO"

    # §12: Integridad auditoría multi-empresa
    echo "## 8. Integridad auditoria multi-empresa (2026-03-01)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_auditoria_multiempresa "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # §13: Datos semilla
    echo "## 9. Datos semilla obligatorios" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_datos_semilla "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # §14: UPDATEs directos en controllers (bypass de helper)
    echo "## 10. UPDATEs directos en controllers (bypass helper)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if [ -d "$CONTROLLERS_DIR" ] && [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        local updates_directos=0
        while IFS= read -r update_line; do
            [ -z "$update_line" ] && continue
            local ut_tabla=""
            ut_tabla=$(echo "$update_line" | grep -oP 'UPDATE \K[a-z_]+' || true)
            [ -z "$ut_tabla" ] && continue
            # Verificar si la tabla tiene helper DUEÑO (hace SQL sobre la tabla)
            # Antes: grep -rwl matcheaba menciones en comentarios/logs → asociaciones falsas.
            local ut_helper=""
            ut_helper=$(_helper_canonico_de_tabla "$ut_tabla")
            if [ -n "$ut_helper" ]; then
                local ut_file=""
                ut_file=$(echo "$update_line" | cut -d: -f1)
                echo "- [WARN] $(basename "$ut_file"): UPDATE ${ut_tabla} directo (helper: $(basename "$ut_helper"))" >> "$ARCHIVO"
                updates_directos=$((updates_directos + 1))
            fi
        done < <(grep -rn "UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | grep -v ".bak" | grep -v "^\s*//" || true)
        if [ "$updates_directos" -eq 0 ]; then
            echo "- [OK] Ningun UPDATE directo en controllers con helper existente" >> "$ARCHIVO"
        else
            echo "- Total: ${updates_directos} UPDATEs directos que deberian usar helper" >> "$ARCHIVO"
        fi
    fi
    echo "" >> "$ARCHIVO"

    echo "Salud generada: $ARCHIVO"
}

# =======================================================================================
# GENERAR CONTEXTO COMPLETO PARA IA
# =======================================================================================

generar_contexto_ia() {
    local CONTEXT_FILE="$OUTPUT_DIR/CONTEXTO_IA_$(date +%Y%m%d_%H%M).md"
    
    header
    echo "Generando contexto completo para IA..."
    echo ""
    
    explorar_proyecto
    
    cat > "$CONTEXT_FILE" << EOF
# CONTEXTO ERP LAGO - $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

## VERSIONES RUNTIME
EOF

    echo '```' >> "$CONTEXT_FILE"
    extraer_versiones_runtime >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"

    echo "## ESTRUCTURA DEL PROYECTO"

    echo '```' >> "$CONTEXT_FILE"
    tree -L 1 -d -I 'node_modules|.git|coverage|jsOLD.bak|backups' "$PROJECT_ROOT" --noreport 2>/dev/null >> "$CONTEXT_FILE" || ls -1d "$PROJECT_ROOT"/*/ 2>/dev/null >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    echo "## TABLAS DE BASE DE DATOS" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if verificar_bd; then
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema='public' AND table_type='BASE TABLE'
            ORDER BY table_name;
        " 2>/dev/null >> "$CONTEXT_FILE"
    fi
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    # Solo nombre + cantidad de exports. Detalle de endpoints en RUTAS API.
    echo "## CONTROLADORES (resumen)" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    for ctrl in "$CONTROLLERS_DIR"/*.controller.js; do
        [ -f "$ctrl" ] || continue
        local nombre nexp _nexp_tmp
        nombre=$(basename "$ctrl")
        # [v69-b3c] Conteo EXACTO via node. El numero se escribe a un archivo
        # temporal y se amordaza console.log/error ANTES del require: si el
        # controller imprime al cargarse (ej. config/database "Conexion exitosa"),
        # NO contamina el numero. process.exit(0) corta conexiones BD colgadas.
        # Fallback "?" si el require falla. timeout 8s de red.
        _nexp_tmp=$(mktemp 2>/dev/null || echo "/tmp/_nexp_$$")
        timeout 8 node -e '
            const path = require("path"), fs = require("fs");
            const out = process.argv[2];
            console.log = function(){}; console.error = function(){}; console.warn = function(){};
            let n = "?";
            try {
                const m = require(path.resolve(process.argv[1]));
                if (m && (typeof m === "object" || typeof m === "function")) {
                    n = 0; for (const k of Object.keys(m)) { if (typeof m[k] === "function") n++; }
                }
            } catch (e) { n = "?"; }
            try { fs.writeFileSync(out, String(n)); } catch (e) {}
            process.exit(0);
        ' "$ctrl" "$_nexp_tmp" >/dev/null 2>&1
        nexp=$(cat "$_nexp_tmp" 2>/dev/null | tr -d '[:space:]')
        rm -f "$_nexp_tmp" 2>/dev/null
        [ -z "$nexp" ] && nexp="?"
        echo "$nombre ($nexp exports)" >> "$CONTEXT_FILE"
    done
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"

    # HELPERS CENTRALIZADOS removido de contexto. Detalle completo en PROMPT_MAESTRO.md

    # Middlewares
    echo "## MIDDLEWARES" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if [ -n "${MIDDLEWARE_DIR:-}" ] && [ -d "$MIDDLEWARE_DIR" ]; then
        for mw in "$MIDDLEWARE_DIR"/*.js; do
            [ -f "$mw" ] || continue
            local nombre; nombre=$(basename "$mw")
            local lineas; lineas=$(wc -l < "$mw" 2>/dev/null || echo "?")
            echo "$nombre ($lineas lineas)" >> "$CONTEXT_FILE"
        done
    fi
    # Middlewares globales en server.js
    if [ -f "$PROJECT_ROOT/server.js" ]; then
        local global_mw=""
        global_mw=$(grep -oE "app\.use\(.*require\(['\"][^'\"]+['\"]\)" "$PROJECT_ROOT/server.js" 2>/dev/null \
            | sed "s/app\.use(.*require(['\"]//; s/['\"])//" | sort -u || true)
        if [ -n "$global_mw" ]; then
            echo "--- server.js globals ---" >> "$CONTEXT_FILE"
            while IFS= read -r gmw; do
                [ -n "$gmw" ] && echo "app.use($gmw)" >> "$CONTEXT_FILE"
            done <<< "$global_mw"
        fi
        # Detectar app.use(express.json/static/etc)
        local express_mw=""
        express_mw=$(grep -oE "app\.use\((express|compression|cors|helmet|cookieParser)" "$PROJECT_ROOT/server.js" 2>/dev/null | sed 's/app\.use(//' | sort -u || true)
        if [ -n "$express_mw" ]; then
            while IFS= read -r emw; do
                [ -n "$emw" ] && echo "app.use($emw)" >> "$CONTEXT_FILE"
            done <<< "$express_mw"
        fi
    fi
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    # RUTAS API — solo resumen por archivo. Detalle en PARTE 6 / Endpoints por módulo.
    echo "## RUTAS API (resumen por archivo — detalle en PROMPT_MAESTRO §ENDPOINTS)" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    for route in "$ROUTES_DIR"/*.routes.js; do
        [ -f "$route" ] || continue
        local nombre rcount
        nombre=$(basename "$route")
        rcount=$(grep -cE "router\.(get|post|put|delete|patch)" "$route" 2>/dev/null); rcount=${rcount:-0}
        # [v69-b4] "declaraciones" (lineas router.METHOD), NO "rutas/endpoints".
        # FEATURES cuenta paths UNICOS -> puede diferir. Etiquetas distintas para
        # que los dos numeros no parezcan contradictorios.
        echo "$nombre: $rcount declaraciones router.METHOD" >> "$CONTEXT_FILE"
    done
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    # PAGINAS FRONTEND removido de contexto. Detalle en MAPEO FRONTEND->BACKEND del PROMPT_MAESTRO.

    # Removido: COLUMNAS GENERATED (ya en PROMPT_MAESTRO)
    # Removido: FEATURES ESPECIALES (ya en PROMPT_MAESTRO)
    # Removido: SEGURIDAD resumen (ya en archivo SEGURIDAD)

    echo "## PUNTOS DE ESCRITURA EN TABLAS CRITICAS" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if [ -d "$CONTROLLERS_DIR" ]; then
        local tablas_criticas_auto=""
        tablas_criticas_auto=$(grep -roh "INSERT INTO [a-z_]*" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
            | sed 's/INSERT INTO //' | sort | uniq -c | sort -rn | awk '$1 >= 2 {print $2}' || true)
        if [ -n "$tablas_criticas_auto" ]; then
            while IFS= read -r tabla_critica; do
                [ -z "$tabla_critica" ] && continue
                local ctrl_count=""
                ctrl_count=$(grep -rl "INSERT INTO ${tabla_critica}\|UPDATE ${tabla_critica}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
                local helper_count=""
                helper_count=$(grep -rl "INSERT INTO ${tabla_critica}\|UPDATE ${tabla_critica}" "$PROJECT_ROOT/src/utils" "$PROJECT_ROOT/src/services" --include="*.js" 2>/dev/null | wc -l || echo "0")
                echo "$tabla_critica: ${ctrl_count} controllers, ${helper_count} helpers" >> "$CONTEXT_FILE"
            done <<< "$tablas_criticas_auto"
        fi
    fi
    echo '```' >> "$CONTEXT_FILE"

    echo "" >> "$CONTEXT_FILE"
    
    echo -e "${GREEN}[OK] Contexto generado: $CONTEXT_FILE${NC}"
}

# =======================================================================================
# LISTAR MODULOS
# =======================================================================================

listar_modulos() {
    header
    explorar_proyecto

    echo "Modulos disponibles:"
    echo ""

    # Si stdout no es TTY (ej. redirige a archivo), suprimir codigos ANSI
    # para evitar que el .md tenga "\u001b+JS\u001b" como literal.
    local C_JS C_CTRL C_ROUTES C_RESET
    if [ -t 1 ]; then
        C_JS="${GREEN}"; C_CTRL="${BLUE}"; C_ROUTES="${CYAN}"; C_RESET="${NC}"
    else
        C_JS=""; C_CTRL=""; C_ROUTES=""; C_RESET=""
    fi

    while IFS= read -r html_file; do
        [ -z "$html_file" ] && continue
        local nombre status
        nombre=$(basename "$html_file" .html)
        status=""

        [ -f "$JS_DIR/${nombre}.js" ] && status+="${C_JS}+JS${C_RESET} "
        [ -f "$JS_DIR/${nombre}-script.js" ] && status+="${C_JS}+JS${C_RESET} "

        local mod_first
        mod_first=$(echo "$nombre" | cut -d'-' -f1)
        ls "$CONTROLLERS_DIR"/*${mod_first}*.controller.js &>/dev/null 2>&1 && status+="${C_CTRL}+Ctrl${C_RESET} "
        ls "$ROUTES_DIR"/*${mod_first}*.routes.js &>/dev/null 2>&1 && status+="${C_ROUTES}+Routes${C_RESET} "

        echo -e "  $nombre $status"
    done < <(find "${FRONTEND_DIR:-$PROJECT_ROOT}" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)

    echo ""
}

# =======================================================================================
# PROMPT MAESTRO
# =======================================================================================


# =======================================================================================
# SCHEMA DUMP DE TABLAS CRITICAS
# =======================================================================================
# Para diseñar un modulo nuevo, el LLM necesita ver tipos+NOT NULL+default de las tablas
# que va a tocar. El prompt v58 solo listaba nombres. Esta funcion dumpea \d formateado
# de las TOP-N tablas mas tocadas (las que aparecen en menu opcion 3 "Rastrear tabla").
generar_schema_critico() {
    local destino="${1:-}"
    local _out=""
    _out+="*Generado dinamicamente. Para tabla fuera de esta lista: \\d <tabla> en psql.*"$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="(BD no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # Top 15 tablas mas grandes (proxy razonable de "criticas")
    local tablas_top=""
    tablas_top=$(_run_sql "
        SELECT t.table_name
        FROM information_schema.tables t
        JOIN pg_class c ON c.relname = t.table_name
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND t.table_name NOT LIKE '\\_backup\\_%'
        ORDER BY c.reltuples DESC
        LIMIT 15;
    ")

    if [ -z "$tablas_top" ]; then
        _out+="(sin tablas detectadas)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    while IFS= read -r tbl; do
        [ -z "$tbl" ] && continue
        local schema=""
        schema=$(_run_sql "
            SELECT
                column_name || ' ' ||
                data_type ||
                CASE WHEN character_maximum_length IS NOT NULL
                     THEN '(' || character_maximum_length || ')'
                     ELSE '' END ||
                CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END ||
                CASE WHEN column_default IS NOT NULL
                     THEN ' DEFAULT ' || REPLACE(column_default, E'\n', ' ')
                     ELSE '' END
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '$tbl'
            ORDER BY ordinal_position;
        ")
        local count_rows=""
        count_rows=$(_run_sql "SELECT COUNT(*) FROM $tbl" 2>/dev/null || echo "?")
        _out+="#### $tbl  ($count_rows registros)"$'\n'
        _out+='```'$'\n'
        _out+="$schema"$'\n'
        _out+='```'$'\n'$'\n'
    done <<< "$tablas_top"

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# FIRMAS DE HELPERS EXPORTADOS
# =======================================================================================
# Para decidir si reusar un helper existente, el dev necesita ver su firma sin abrir el
# archivo. Esta funcion extrae la signatura de cada export.
generar_firmas_helpers() {
    local destino="${1:-}"
    local _out=""
    _out+="*Firmas extraidas dinamicamente de src/utils/*.helper.js — para reusar antes de crear nuevo.*"$'\n'$'\n'

    if [ -z "${UTILS_DIR:-}" ] || [ ! -d "${UTILS_DIR:-}" ]; then
        _out+="(directorio utils no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        # Detectar @scope si lo tiene
        local scope=""
        scope=$(head -40 "$hfile" 2>/dev/null | grep -oP '@scope[[:space:]]+\K(stateless|pure|shared-catalog|enterprise)' | head -1)
        [ -z "$scope" ] && scope="?"
        _out+="#### $hname [@scope: $scope]"$'\n'
        _out+='```js'$'\n'
        # Extraer firmas: busca patron exports.X = (async)? function|async (...) => ...
        # o module.exports.X = ...
        local firmas=""
        firmas=$(grep -nE "^(exports\.|module\.exports\.)" "$hfile" 2>/dev/null | head -25 | while IFS=: read -r ln rest; do
            # Tomar la firma completa: linea actual + posibles continuaciones hasta ')'
            local fline; fline=$(sed -n "${ln}p" "$hfile" 2>/dev/null)
            # Limpiar y truncar a 110 chars
            echo "${fline}" | sed 's/[[:space:]]*$//' | cut -c1-110
        done)
        if [ -n "$firmas" ]; then
            _out+="$firmas"$'\n'
        else
            _out+="(sin firmas exports.X — usa module.exports = { } o similar)"$'\n'
        fi
        _out+='```'$'\n'$'\n'
    done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# DUMP DE CONFIG KEYS (configuraciones_empresa)
# =======================================================================================
# Antes el prompt decia "Config AFIP: 8 claves" sin decir cuales ni que valor tienen.
# Esta funcion dumpea clave -> valor de id_empresa=1, ocultando passwords/tokens.
generar_config_dump() {
    local destino="${1:-}"
    local _out=""
    _out+="*Dump de configuraciones_empresa WHERE id_empresa=1. Passwords/tokens ofuscados.*"$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="(BD no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # Agrupar por prefijo (todo antes del primer '.' o '_')
    local prefijos=""
    prefijos=$(_run_sql "
        SELECT DISTINCT split_part(clave, '.', 1)
        FROM configuraciones_empresa WHERE id_empresa=1
        ORDER BY 1;
    ")

    while IFS= read -r prefix; do
        [ -z "$prefix" ] && continue
        _out+="#### $prefix.*"$'\n'
        _out+='```'$'\n'
        local rows=""
        rows=$(_run_sql "
            SELECT clave || ' = ' ||
                CASE
                    WHEN clave ~* '(password|pass|secret|token|key|cert)' AND length(valor) > 0 THEN '***'
                    WHEN length(valor) > 80 THEN substring(valor, 1, 77) || '...'
                    ELSE valor
                END
            FROM configuraciones_empresa
            WHERE id_empresa=1 AND split_part(clave, '.', 1) = '$prefix'
            ORDER BY clave;
        ")
        _out+="$rows"$'\n'
        _out+='```'$'\n'$'\n'
    done <<< "$prefijos"

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

prompt_maestro() {
    local PROMPT_FILE="$OUTPUT_DIR/PROMPT_MAESTRO.md"

    header
    echo "Generando Prompt Maestro v${VERSION} (dinamico)..."
    echo ""

    explorar_proyecto

    # === Seccion 1: Encabezado y reglas ===
    cat > "$PROMPT_FILE" << 'STATICBLOCK'
# PROMPT MAESTRO - ERP LAGO
## (Generado dinamicamente por Toolkit)

---

## GUIA DE LECTURA PARA CLAUDE (leer ANTES que el resto)

Este prompt es snapshot, no observacion en vivo. Algunas cosas que parecen
errores son falsos positivos. Antes de proponer fixes, revisa:

1. **PM2 / proceso erplago.** Si la seccion EXTRA dice "pm2 no devuelve datos",
   significa que el toolkit corrio en un contexto sin acceso a pm2 (no que
   erplago este caido). NO sugieras reiniciar el ERP basandote en eso.

2. **`productos` SIN `id_empresa` por diseno.** Es catalogo compartido entre
   empresas. Si ves queries sobre `productos` sin filtro `id_empresa`, esta
   bien. Las que cambian por empresa son `inventario`, `precios`,
   `producto_proveedor`, `producto_componentes`. **NUNCA propongas agregar
   `WHERE id_empresa` a queries sobre `productos`.**

3. **Auditoria multi-empresa Check 5.** `afip-auditoria.helper.js` aparece
   como WARN/skip por diseno: usa `pool` directo para que sus escrituras a
   `afip_solicitudes` sobrevivan a ROLLBACKs del caller. NO es bug.

4. **Patron de impresion: HTML server-side + window.print() del cliente.**
   NO Puppeteer, NO CUPS, NO cola de jobs. Si ves `print_jobs` con datos, es
   tabla zombie. NO propongas reactivar Puppeteer por nada (memoria
   institucional: causo OOM y bloqueo del ERP, descartado por el dueno).

5. **Fiado NO es un metodo de pago.** El metodo id=6 "Cuenta Corriente" esta
   `activo=false`. Fiado se modela como `pedidos.es_fiado=true` + DEBE en
   `cuentacorrienteclientes`. Ver memoria del rediseno 2026-03-29.

6. **BD = unica fuente de verdad EN FRONTEND.** El frontend nunca recalcula
   totales, solo los muestra. Si una pantalla muestra un total que no
   coincide con BD, el bug esta en lo que SE PERSISTIO, no en el render.
   (Este punto complementa la regla del contrato — aqui es especifico al render.)

---

## GLOSARIO RAPIDO (vocabulario que se confunde)

| Termino | Que es | Que NO es |
|---|---|---|
| **venta-rapida** | POS de mostrador, modulo principal de carga | Un alias de "pedidos" o "ventas" |
| **borrador** | Estado `-1` en `pedidos`. Persiste en BD entre sesiones | Una tabla aparte. Es estado de pedidos |
| **pedido** | Entidad raiz de toda venta | Lo mismo que factura o presupuesto |
| **factura** | Representacion fiscal del pedido (electronica, AFIP) | El pedido en si |
| **presupuesto** | Representacion comercial del pedido (efectivo, sin CAE) | "Algo no confirmado". Es venta REAL |
| **fiado** | Pedido confirmado sin pago, asentado en CC del cliente | Pago con metodo=6 |
| **CC cliente** | `cuentacorrienteclientes`. Libro mayor del cliente | "Cuenta corriente bancaria" |
| **CC proveedor** | `cuentacorrienteproveedores`. Idem proveedor | Idem |
| **BOM** | Bill of Materials, tabla `producto_componentes`. Receta padre→componentes | Producto compuesto generico |
| **Conjunto** | Tabla `conjuntos` + `conjunto_items`. Agrupacion para web/filtros | Sinonimo de BOM |
| **Familia / Padre** | `productos.id_producto_padre`. Variantes de un mismo producto | Sinonimo de BOM o conjunto |
| **CAE** | Codigo autorizacion AFIP. Una vez emitido, irreversible | Numero interno del comprobante |
| **idempotency_key** | UUID que evita duplicar emisiones AFIP en reintentos | Sinonimo de id_factura |
| **shared / catalogo** | 23 tablas SIN id_empresa por diseno | Falla del schema multi-empresa |

---

## REGLAS CRITICAS DE DESARROLLO

### 1. VERIFICAR ESTRUCTURA BD ANTES DE MODIFICAR
- PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -c "\d nombre_tabla"

### 2. CENTRALIZAR ANTES DE IMPLEMENTAR
- Verificar si ya existe helper en src/utils/ antes de escribir logica
- Si la operacion se repite en 2+ controllers, crear helper primero
- BD es UNICA fuente de verdad. Frontend solo muestra, NUNCA recalcula

### 3. RASTREO OBLIGATORIO
- Antes de tocar tabla critica: ./toolkit_<VERSION>.sh rastrear nombre_tabla
- No asumir que un solo controller es el unico que toca la tabla

### 4. VERIFICAR API_BASE_URL ANTES DE ESCRIBIR URLs
- config.js define API_BASE_URL = 'http://host:port/api' (YA incluye /api)
- CORRECTO: ${API_BASE}/auth/perfil
- INCORRECTO: ${API_BASE}/api/auth/perfil (doble /api → 404)

### 5. BASH: NO USAR node -e CON !
- bash interpreta ! como history expansion
- CORRECTO: cat > /tmp/script.js << 'EOF' ... EOF && node /tmp/script.js

### 6. LEER COMENTARIOS DEL ARCHIVO ANTES DE MODIFICARLO
- Cada helper documenta sus invariantes en /* */ y // al inicio del archivo
- Ejemplo real: productos.helper.js linea 22 dice "productos — COMPARTIDA (sin id_empresa)"
- Si el codigo y los comentarios contradicen tu hipotesis, los comentarios ganan
- Antes de proponer ALTER TABLE o WHERE id_empresa, verificar comentarios primero

### 7. VERIFICAR PREMISA DEL CHECK ANTES DE APLICAR FIX
- Si el toolkit reporta "tabla X sin id_empresa", verificar PRIMERO con \d X
- Los reportes pueden tener falsos positivos por BD no disponible o cache
- NUNCA aplicar fix masivo sin haber validado contra schema real
- Regla de oro: "el reporte sugiere, el schema decide"

### 8. PRODUCTOS ES CATALOGO COMPARTIDO (NO ENTERPRISE)
- La tabla productos NO tiene id_empresa
- Es catalogo global compartido entre empresas (modelo de negocio)
- Lo que cambia por empresa: inventario, precios, producto_proveedor, producto_componentes
- NUNCA agregar WHERE id_empresa a queries sobre productos
- Verificable con: \d productos | grep id_empresa  (debe estar VACIO)

---

## PREFERENCIAS DE NEGOCIO Y UX
*(Reglas de producto definidas por el dueño. NO son reglas tecnicas — son decisiones
de negocio que afectan como se ven y funcionan los modulos. Si modificas un modulo
de venta-rapida, compras o comprobantes, RELEER esta seccion antes.)*

### P1. STOCK SIEMPRE VISIBLE EN VENTA-RAPIDA Y COMPRAS
- Toda grilla de seleccion de productos en **venta-rapida** y **compras** muestra
  una columna `Stock` con el stock_real del **deposito asignado al usuario activo**
  (NO el agregado total — eso va en tooltip).
- Mostrar SIEMPRE el numero literal: 0, 5, 12, -3. Nunca reemplazar por "Sin stock"
  ni por iconos ambiguos. El numero exacto es informacion que el vendedor necesita.
- Color por umbral:
  - Verde: stock_real > stock_minimo
  - Ambar: 0 < stock_real <= stock_minimo
  - Rojo:  stock_real <= 0
- Tooltip al hover: "Total empresa: X (Dep1: Y, Dep2: Z)" — consulta on-demand
  a inventario_deposito.
- El helper de busqueda de productos debe devolver stock_real (del deposito del
  usuario) y stock_minimo SIEMPRE — es responsabilidad del helper, no de cada
  controller.
- Resolucion del deposito del usuario: stockHelper.obtenerDepositoUsuario(id_usuario).
- En compras, el deposito de referencia es el de destino del comprobante. Si el
  usuario carga un comprobante para otro deposito, mostrar el stock de ESE deposito
  (no el suyo).

### P2. IMPRIMIR Y EXPORTAR DISPONIBLE EN TODO COMPROBANTE DE COMPRA
- Toda pantalla que muestra un comprobante de compra (listado o detalle) DEBE
  ofrecer botones de Imprimir y Exportar (PDF + Excel).
- El boton Imprimir usa el camino correcto segun lo que ya esta implementado
  para ese tipo de doc (ver seccion IMPRESION mas abajo).
- Exportar Excel: usa excel.helper.js con compras.helper.js
  obtenerComprobantesParaExport y obtenerItemsParaExport (helpers que YA existen
  — no duplicar logica).
- Esta preferencia es OBLIGATORIA para compras y EXTENSIBLE a otros modulos
  (facturas, recibos, presupuestos, NC/ND).

### P3. "IMPRIMIR LO QUE ESTA EN PANTALLA" UNIVERSAL POR MODULO
- Toda vista de detalle de un comprobante (compra, venta, recibo, NC/ND, presupuesto,
  remito, pago a proveedor, arqueo de caja, reportes) tiene un boton de imprimir
  visible y accesible con shortcut F9.
- "Imprimir lo que esta en pantalla" significa imprimir el COMPROBANTE QUE SE ESTA
  VIENDO usando su tipo + id, NO capturar el DOM. La BD es source of truth, no
  el navegador.
- Cada modulo elige su camino de impresion segun el tipo de doc (ver seccion
  IMPRESION mas abajo). NO forzar todo a Puppeteer (RAM servidor, lento).

---

## LECCIONES APRENDIDAS

| Error | Solucion |
|-------|----------|
| sed corrompe JS con backticks | cat EOF o Python |
| Olvidar \d tabla antes de tocar BD | SIEMPRE verificar estructura primero |
| API_URL hardcodeada | window.CONFIG?.API_BASE_URL |
| catch generico no propaga statusCode | Siempre propagar error.statusCode |
| Asumir un solo controller toca tabla | grep -rn "INSERT INTO tabla" src/ primero |
| Columnas GENERATED en INSERT/UPDATE | Consultar seccion GENERATED, no escribibles |
| movimientos_caja FK a metodosdepago | NO a formas_pago (tablas distintas) |
| req.user en controllers | Es req.usuario (auth.middleware.js) |
| stock en productos.stock | Es inventario.stock_real |
| venta-rapida usa borrador.controller | NO pedidos.controller directo |
| Doble /api en URLs frontend | API_BASE_URL ya incluye /api |
| 403 redirige a login | Solo 401 redirige. 403 = sin permiso, mostrar aviso |
| express.static antes de middleware | htmlAccessMiddleware va ANTES de express.static |
| Browser cachea HTML | Anti-cache headers en server.js para *.html |
| Multiples JS redirigen a login | Server-side ya protege. Eliminar redirects client-side |
| bash node -e con ! falla | Usar cat EOF + node script.js |
| ON CONFLICT sin id_empresa | SIEMPRE verificar constraint real con \d tabla. producto_proveedor necesita (id_empresa, id_producto, id_proveedor) |
| verificarAcceso* retorna boolean | Ahora retorna { permitido: bool, solo_lectura: bool } — actualizar todos los callers |
| Helper sin id_empresa en firma | Post-auditoria: TODOS los helpers de tablas enterprise reciben id_empresa como primer param |
| Cache key sin id_empresa | Siempre ${id_empresa}_${key}. Cache global solo para catalogo compartido |
| ORDER BY sin JOIN en helper | modulos.helper.js: ORDER BY mg.orden requiere JOIN a modulo_grupos |
| Puppeteer para todo PDF | RAM servidor, lento | HTML local + window.print() para docs no fiscales |
| **Puppeteer para CUALQUIER cosa en LAGO** | **(1) ~200MB por job + leak de browser contexts -> OOM cada N horas. (2) Impresion a medias (modal cerrado / error JS / timeout) deja proceso colgado y bloquea event loop de Node -> ERP no responde a NADIE hasta reiniciar PM2.** | **Patron unico vigente: controller renderiza .hbs server-side, devuelve HTML, `<script>window.onload=()=>window.print()</script>` dispara impresion en browser cliente. Ver seccion "IMPRESION — RECETA REAL DEL ERP" del prompt. NO proponer cola Puppeteer/CUPS para nada nuevo, ni siquiera para facturas fiscales.** |
| alert() como vista previa | UX pobre | Ventana imprimible con datos empresa + auto-print |
| Monkey-patching funciones globales | Deuda tecnica | 1 funcion async + endpoint server-side |
| Modal referenciado sin existir HTML | Error silencioso | Verificar IDs HTML<>JS antes de deploy |
| GET /clientes completo en init | 12K registros, lento | Lazy load + endpoint /buscar?q= puntual |
| UPDATE directo en controller | Bypass de helper | SIEMPRE usar helper, incluido para UPDATEs |
| Campos editables sin whitelist | Escritura arbitraria | pedidosHelper.actualizarCampos() con whitelist |
| Python str.replace() en multi-match | Reemplaza la PRIMERA ocurrencia, no la deseada | Usar sed -i con numero de linea exacto para queries repetidas |
| Param opcional id_empresa en helper | Callers que no lo pasan → WHERE id_empresa=NULL → 0 filas | Si id_empresa es obligatorio para aislamiento, NO hacerlo opcional. Si es opcional, no usarlo en WHERE |
| Bloquear edicion por pagos confirmados | Usuario no puede corregir nada post-venta | Solo bloquear si facturado/presupuestado/remitido. Pagos no bloquean — sobrepago va a CC |
| Template HBS usa campo distinto al controller | descripcion vs descripcion_congelada → campo vacio | Verificar campos del template .hbs ANTES de armar el objeto en controller |
| registrarLogPedido no se llamaba | Acciones post-venta sin auditoría | TODA accion sobre pedido confirmado DEBE llamar registrarLogPedido() |
| Historial solo mostraba items | pedidos_log existia pero no se consultaba | obtenerHistorialPedido() hace UNION ALL de pedidos_log + borrador_items_log |
| renderAcciones bloqueaba por estado_pago | Confirmado no dejaba editar | puedeEditar = !facturado && !presupuestado (pagos no bloquean) |
| CHECK constraint vs trigger desacoplados | Trigger inserta 'precio_inicial' pero CHECK solo permite 'inicial' | Verificar que TODOS los valores que insertan triggers esten en el CHECK |
| INNER JOIN en FK nullable oculta registros | getSuspendidos con JOIN clientes excluye los sin cliente | Siempre LEFT JOIN cuando la FK puede ser NULL |
| Helper caller sin id_empresa en objeto | actualizarPrecio({id_producto, precio}) → UPDATE 0 filas silencioso | Grep TODOS los callers de un helper al agregar param obligatorio |
| Frontend no envia campos que no gestiona | guardarProducto() no envia url_imagen → se pisa con null | Preservar campos no-editables leyendo del objeto original antes de enviar |
| Frontend hardcodea IVA 21% | calcularTotal() y cambiarPrecio() usan *1.21 y /1.21 | Mapear iva_aplicado per-item desde BD, usar variable en calculo |
| parseInt('null') = NaN en controller | sincronizarPagos recibe borradorId=null → NaN en SQL | Validar isNaN() antes de queries parametrizadas |
| GET a ruta inexistente reseta estado | cargarBorradorActivo checkea GET /borrador/:id que no existe | Verificar que la ruta existe en routes.js antes de hacer fetch |
| DELETE sin filtro empresa borra cross-empresa | DELETE FROM conjunto_items WHERE id_producto=$1 (sin id_empresa) | TODA operacion DELETE debe filtrar por id_empresa |
| Configs hardcodeadas en frontend | Texto pie cotizacion, limites, etc | configuraciones_empresa + panel Configuraciones Personalizadas |
| precio/1.21 hardcodeado en conversion | cambiarPrecio divide por 1.21 fijo | Leer alicuota real del item: 1 + iva_porcentaje/100 |
| SELECT + UPDATE separados en stock | Race condition: 2 vendedores leen mismo stock | UPDATE atomico: SET stock_real = stock_real + $cant RETURNING |
| INSERT sin ON CONFLICT en concurrencia | Duplicate key cuando 2 requests crean mismo registro | INSERT ON CONFLICT (unique_key) DO NOTHING antes del UPDATE |
| INTEGER para stock en tabla cache | Trunca decimales (0.5 metros, 2.3 kg) | NUMERIC(12,2) en todas las columnas de stock |
| tipo_movimiento sin CHECK constraint | Cualquier string se guarda, sin integridad | CHECK constraint + Set de validacion en JS |
| Frontend crea borrador + otro ajuste | Borrador huerfano queda en BD sin items | DELETE borrador viejo antes de crear nuevo ajuste |
| Fiado modelado como pago method=6 | 30+ parches filtrando !=6 en vistas/queries/frontend | Fiar NO es pagar. pedidos.es_fiado + DEBE en CC. Tabla pagos solo pagos reales |
| registrarVentaConPago bifurcado por method | DEBE+HABER para contado, solo DEBE para fiado | Eliminar bifurcacion. Siempre DEBE+HABER. Fiado va por registrarFiado() separado |
| Cobro despacho crea pago nuevo sin anular CC | Doble pago: CC fantasma + pago real = saldo negativo | registrarCobroRemito: HABER en CC + marcar remito + desmarcar es_fiado |
| esConsumidorFinal por condicion IVA | Cliente real con cond.IVA=CF no registra CC | Chequear por ID config (clientes.id_consumidor_final), no por condicion IVA |
| Frontend fiado via id_metodo_pago:6 | Backend intercepta en loop, semántica incorrecta | Payload {fiado:true, monto_fiado:X}. Botón FIAR separado del selector pagos |
| verificarEditable suma pagos sin filtrar estado | Pagos reembolsados bloquean edición | Filtrar pg.id_pago_estado=2 en subquery total_pagado |
| Doble-pagos por cuotas parecen errores | total_final tiene precio base, pago tiene interés | Diagnosticar con cuotas/coeficiente/monto_original antes de corregir |
| LIKE '%term1 term2%' no matchea multi-palabra | "MEM PRO" no encuentra "MEMB. EN PASTA PRO..." | Separar términos, AND each con busqueda_vector ILIKE '%term%' |
| Columna JSONB nullable es retrocompatible | variante_atributos no rompe import/export/helpers | DEFAULT NULL + COALESCE en UPDATE = 0 impacto en código existente |
| Padre sin precio filtrado por excluirSinPrecio | Producto agrupador no tiene precio propio | Exceptuar padres: OR EXISTS(SELECT 1 FROM productos WHERE id_producto_padre=p.id) |
| Cards repetidas para variantes de un producto | 6 cards iguales confunden al usuario | 1 card padre + selectores color/medida en modal. Patrón e-commerce estándar |
| agregarAlCarrito no encuentra hijos de grupo | Hijos no están en catalogo.productos directo | Buscar en grupo.hijos cuando el ID no está en el array principal |
| parseInt trunca cantidades decimales | parseInt("1.5")=1 en JS → cantidad_remitida=1 en vez de 1.5 | SIEMPRE usar parseFloat() para cantidades. parseInt solo para IDs enteros |
| Math.round fuerza enteros en compras | No se puede comprar 1.5 tn | Eliminar Math.round del input, step="0.01", min="0.01" |
| Producto derivado acumula stock propio | Arena x medio tiene -29 pero nunca se repone | BOM: derivados no tienen stock, descontarVenta() resuelve al padre |
| Anulación no revierte BOM | moverStock(ANULACION) devolvía al producto vendido, no al base | TODOS los puntos de stock por venta deben usar descontarVenta(), incluidas anulaciones |
| Asumir que productos tiene id_empresa | NO la tiene. Es catalogo compartido. Verificar con \d productos antes de tocar |
| Aplicar fix sin leer comentarios del helper | productos.helper.js linea 22 documenta "COMPARTIDA". Leer comentarios siempre antes de modificar |
| Toolkit reporta error sin BD disponible | Cuando _get_tablas_compartidas() retorna vacio, NADA se skipea, todo es falso positivo. Verificar BD UP antes de creer reportes |
| Estado pedido -2 (Descartado) en checks | Excluir junto con 99 (Recuperado) y 10 (Anulado por NC) en analisis de pedidos |
| pedidos.total vs total_final confundidos | pedidos.total = SUM(pedidoitems.total_linea, sin IVA). pedidos.total_final = subtotal+IVA-descuentos+recargos forma pago. Son DOS columnas distintas |

---

## ARQUITECTURA

### MODELO MULTI-EMPRESA
- Empresa -> Deposito (=Sucursal, tiene direccion, punto_venta_afip, responsable)
- Deposito -> Cajas, Usuarios (via usuarios.id_deposito), Inventario
- NO existe tabla sucursales separada. Deposito ES la sucursal

#### Tablas COMPARTIDAS (sin id_empresa — catalogo global, 21 tablas)
- **Catalogo:** productos, categorias, marcas, productocodigosbarras, producto_variantes
- **AFIP:** alicuotasiva, condicionesiva, factura_tipos, comprobante_compra_tipos, tiposdecomprobante
- **Estados:** facturaestados, pedidoestados, pagoestados, orden_estados, ordencompraestados
- **Sistema:** bancos, monedas, modulos, modulo_grupos, modulo_rutas_api, rutas_soporte

#### Tablas AISLADAS (con id_empresa — 35 tablas migradas)
- **Comercial:** pagos, precios, listasdeprecios, listaprecioproductos, historial_precios_ventas, descuentos(x4), producto_proveedor, cotizaciones, formas_pago, metodosdepago, comprobantes_afip, configuracion_sistema
- **Items:** factura_items, comprobante_compra_items, comprobante_interno_items, remito_items, recibo_facturas, recibopagos, pago_proveedor_items, nota_items, presupuesto_items, ajuste_inventario_items, orden_compra_items, recepcion_items, conjunto_items, borrador_items_log, imputacion_pagos_proveedor
- **Permisos:** usuarios_logs, usuario_configuracion, permisos_usuario, filtros_guardados, rol_modulos

#### Constraints CRITICOS modificados
- precios PK: **(id_empresa, id_producto, id_lista_precio)** — NO solo (id_producto, id_lista_precio)
- producto_proveedor UNIQUE: **(id_empresa, id_producto, id_proveedor)** — NO solo (id_producto, id_proveedor)
- Todas las 35 tablas tienen INDEX en id_empresa

#### Funcion BD: inicializar_empresa(id_nueva, id_template)
- Copia datos template: formas_pago, metodosdepago, listasdeprecios, cotizaciones, configuracion_sistema, rol_modulos, permisos_usuario
- Crea secuencias: facturas, presupuestos
- Uso: SELECT inicializar_empresa(2, 1);

#### Firmas de helpers que CAMBIARON (breaking changes ya resueltos)
- resolverFormaPago(client, **id_empresa**, id_metodo_pago) — antes NO tenia id_empresa
- obtenerNombreFormaPago(client, **id_empresa**, id_forma_pago) — antes NO tenia id_empresa
- upsertPrecios: ON CONFLICT ahora requiere (id_empresa, id_producto, id_lista_precio)
- upsertProveedores: ON CONFLICT ahora requiere (id_empresa, id_producto, id_proveedor)
- Cache en recargos.helper usa key ${id_empresa}_${id} para aislamiento

#### Pendientes bajo riesgo (funcionan con 1 empresa)
- ventas-consulta/print/comprobante-venta: JOINs metodosdepago sin filtro empresa (nombres iguales)
- html-access.middleware: cache rol_modulos global (refactorizar cuando haya empresa 2)
- recibos.controller: verificar callers internos pasen id_empresa a obtenerCotizacion()

### SISTEMA DE AUDITORIA — pedidos_log

#### Tabla pedidos_log
- id_log SERIAL PK, id_pedido FK, id_empresa FK, id_usuario FK
- accion VARCHAR(50), detalle_antes JSONB, detalle_despues JSONB, ip_origen, created_at

#### LOG_PEDIDO_ACCIONES (constante en pedidos.helper.js):
CONFIRMADO, PAGO_REGISTRADO, PAGO_CAMBIADO, PAGO_ANULADO, ESTADO_CAMBIADO,
ITEM_EDITADO, ITEM_ELIMINADO, ANULADO, DESCUENTO_APLICADO, CLIENTE_CAMBIADO,
FORMA_PAGO_CAMBIADA, RECUPERADO, SUSPENDIDO

#### Puntos de inserción (6 controllers):
- borrador.controller.js → confirmarBorrador: CONFIRMADO
- pedidos.controller.js → editarItem: ITEM_EDITADO
- pedidos.controller.js → eliminarItemPedido: ITEM_ELIMINADO
- pedidos.controller.js → anularPedido: ANULADO
- pedidos.controller.js → actualizarCamposPedido: TIPO_ENTREGA_CAMBIADO
- ventas-consulta.controller.js → registrarPago: PAGO_REGISTRADO
- ventas-consulta.controller.js → corregirMetodoPago: FORMA_PAGO_CAMBIADA

#### Funciones clave (pedidos.helper.js):
- registrarLogPedido(client, {id_pedido, id_empresa, id_usuario, accion, detalle_antes, detalle_despues, ip_origen})
- obtenerHistorialPedido(client, id_pedido) → UNION ALL pedidos_log + borrador_items_log
- asignarNumeroPedido(client, {id_pedido, id_empresa}) → MAX+1 atómico por empresa

#### Frontend:
- consultarVentas incluye: EXISTS(pedidos_log WHERE accion != CONFIRMADO) AS tiene_modificaciones
- facturas.js: badge ⚠ naranja si tiene_modificaciones, ✕ rojo si anulado
- facturas-acciones.js: renderHistorial() con 20 labels + detalle contextual por acción
- facturas-acciones.js: gestionarPago() — modal fusionado registrar+corregir pago

#### Regla: TODA acción sobre pedido confirmado → registrarLogPedido()

### PERMISOS EDICION POST-VENTA

| Estado | Editar items | Anular |
|--------|-------------|--------|
| Con pagos, sin factura/presup/remito | SI (sobrepago → CC) | SI |
| Facturado | NO | NO |
| Presupuestado (activo) | NO (anular presup primero) | NO |
| Con remito activo | NO (cancelar remito primero) | NO |
| Remito cancelado/anulado | SI | SI |

Implementado en:
- pedidos-edicion.helper.js → verificarEditable(): subconsultas tiene_presupuesto, tiene_remito_activo
- pedidos.controller.js → obtenerDetalle(): puede_editar, puede_anular
- facturas-acciones.js → renderAcciones(): puedeEditar = !facturado && !presupuestado

### NOTA: CONTEXTO HISTORICO MOVIDO A CHANGELOG_HISTORICO.md
Las sesiones fechadas (SESION 2026-XX), fases de auditoria multi-empresa
(FASE 1-4) y backups historicos se extrajeron a:
`/root/mi_erp/scripts_mantenimiento/CHANGELOG_HISTORICO.md`
El prompt maestro queda solo con contexto vigente.

### REGLAS MULTI-EMPRESA PARA DESARROLLO FUTURO
1. TODA query a tabla con id_empresa DEBE filtrar por id_empresa
2. Todo INSERT a tabla con id_empresa DEBE incluir id_empresa
3. Subqueries correlacionadas: usar $1 si el query padre ya tiene id_empresa como $1
4. JOINs entre tablas con id_empresa: agregar AND t1.id_empresa = t2.id_empresa
5. Nuevos helpers: SIEMPRE recibir id_empresa como parametro obligatorio
6. Cache en memoria: usar key con id_empresa para aislamiento
7. Para crear empresa nueva: SELECT inicializar_empresa(N, 1)

### MULTI-EMPRESA — REGLAS Y CHECKLIST

#### CHECKLIST PRE-DEPLOY MULTI-EMPRESA
- [ ] Todas las queries de la tabla filtran por id_empresa
- [ ] El INSERT incluye id_empresa en columnas, VALUES y params (alineados)
- [ ] El ON CONFLICT usa el constraint correcto (verificar con \d)
- [ ] El cache esta aislado por empresa
- [ ] El controller pasa req.usuario.id_empresa al helper
- [ ] El middleware html-access usa ${id_empresa}_${rol} como cache key
- [ ] Ejecutar: ./toolkit_<VERSION>.sh auditoria-me (0 errores, 0 warnings)

### FIADO Y CUENTA CORRIENTE

#### Principio: fiar ≠ pagar
- Tabla `pagos` solo contiene pagos REALES (efectivo, transferencia, tarjeta, MP)
- El fiado se registra en `pedidos.es_fiado = true` + DEBE en `cuentacorrienteclientes`
- `metodosdepago` id=6 (Cuenta Corriente) existe para histórico pero NO se inserta en pagos

#### Flujo FIAR (confirmarBorrador con CC):
1. `pedidos.es_fiado = true` via `pagosHelper.registrarFiado()`
2. CC: DEBE por el total (si no es Consumidor Final)
3. NO INSERT en tabla pagos
4. NO movimiento de caja

#### Flujo COBRAR FIADO (despacho o mostrador):
1. INSERT en pagos (pago REAL) via `pagosHelper.registrarPago()`
2. CC: HABER por el monto cobrado (cancela DEBE)
3. Movimiento de caja (ingreso)
4. `remitos.pago_confirmado = true` (si es despacho)
5. `pedidos.es_fiado = false` (si saldo queda en 0)

#### Flujo VENTA CONTADO (sin cambios):
1. INSERT en pagos (pago real)
2. CC: DEBE + HABER autocancelado via `registrarVentaConPago()` (si no es CF)
3. Movimiento de caja

#### Guards:
- `pagosHelper.registrarPago()` rechaza `id_metodo_pago = 6` con throw
- `registrarFiado()` es el UNICO camino para fiar
- Vistas SQL (`v_saldo_pedidos`, `v_pedidos_saldos`, `v_clientes_saldos`, `v_pagos_detalle`) ya no filtran method<>6

#### Archivos clave:
- `pagos.helper.js` → `registrarFiado()`, `registrarPago()` (con guard)
- `cc-clientes.helper.js` → `registrarVentaConPago()` (siempre DEBE+HABER)
- `despachos.helper.js` → `registrarCobroRemito()` (HABER + mark remito)
- `pagos-confirmacion.controller.js` → `confirmarPago()` (HABER si era fiado)

### STOCK

#### Arquitectura dual (fuente + cache)
- **Fuente de verdad:** inventario_deposito (por deposito, NUMERIC(12,2))
- **Cache agregado:** inventario (SUM todos depositos, sincronizado via trigger)
- **NUNCA usar:** productos.stock (no existe) ni inventario directo para escribir

#### stock.helper.js — UNICO punto de escritura
- moverStock() — UPDATE atomico (stock_real = stock_real + $cantidad), sin race condition
- descontarVenta() — wrapper que resuelve BOM antes de llamar a moverStock()
- obtenerBOM() — consulta producto_componentes para un producto
- ON CONFLICT (id_deposito, id_producto) DO NOTHING para evitar duplicate key
- Registra en movimientos_stock + movimientos_stock_deposito (trazabilidad 100%)
- TIPOS_MOVIMIENTO validados contra Set + CHECK constraint en BD
- Tipos: VENTA, COMPRA, DEVOLUCION_COMPRA, ANULACION, AJUSTE_MANUAL, AJUSTE_RAPIDO,
  AJUSTE_INVENTARIO, ANULACION_AJUSTE, INICIAL, DESPACHO, ENTREGA, ENTREGA_PARCIAL,
  DEVOLUCION, TRANSFERENCIA_SALIDA, TRANSFERENCIA_ENTRADA, DEVOLUCION_CLIENTE, EGRESO_NOTA_DEBITO

#### Triggers automaticos en inventario_deposito
1. sync_inventario_cache → UPSERT en inventario (stock_real + stock_comprometido)
2. gestionar_alertas_stock → INSERT/UPDATE en alertas_stock (SIN_STOCK, BAJO_MINIMO)

#### Secuencias atomicas
- seq_ajuste_rapido → documentos AR-00000001 (ajustes individuales)
- seq_transferencias → documentos TRF-00000001 (transferencias entre depositos)
- obtener_proximo_numero_ajuste() → AI-00000001 (ajustes formales)

#### API movimientos-stock (D4 — nuevo)
- GET /api/movimientos-stock → filtros: deposito, producto, tipo, usuario, fechas, q
- GET /api/movimientos-stock/form-data → depositos + tipos + usuarios para selects
- GET /api/movimientos-stock/exportar → descarga Excel via excel.helper

#### Reconciliacion
- SELECT * FROM verificar_reconciliacion_stock(1) → debe dar 0 filas
- Compara inventario (cache) vs SUM(inventario_deposito) por empresa

#### excel.helper.js — funciones especializadas
- exportarPlantillaStock() → genera plantilla con metadata oculta + headers coloreados
- parsearStockImport() → detecta header SKU, parsea columna G (stock nuevo)

### BOM — BILL OF MATERIALS

#### Tabla producto_componentes
- id_componente_bom SERIAL PK
- id_empresa FK, id_producto FK (el que se VENDE), id_producto_componente FK (el que tiene STOCK)
- cantidad NUMERIC(10,4) — cuánto del componente consume 1 unidad vendida
- activo BOOLEAN, UNIQUE(id_empresa, id_producto, id_producto_componente)

#### Flujo de stock con BOM
- descontarVenta() en stock.helper.js — UNICO punto de descuento por venta
- Si producto tiene BOM → descompone y descuenta cada componente del padre
- Si producto NO tiene BOM → descuento directo (comportamiento original)
- Funciona para VENTA y ANULACION (invierte signo automáticamente)

#### Enganchado en 5 puntos:
1. borrador.controller.js → confirmarBorrador (POS retiro)
2. pedidos.controller.js → crearInmediato (pedido directo)
3. pedidos-edicion.helper.js → ajustarStockPorEdicion (edición post-venta)
4. pedidos-edicion.helper.js → anularPedidoCompleto (anulación)
5. notas.helper.js → aplicarStockNota + revertirStockNota (NC/ND)

#### Ejemplo real (LAGO):
- Arena (66) = producto base, stock en metros
- Arena x medio (73) → BOM: 0.5 de Arena (66)
- Arena en bolsón (145) → BOM: 1.0 de Arena (66)
- Piedra (8456), Cascote (2737) = ídem con sus derivados
- Derivados tienen stock=0 permanente, todo se resuelve al base

#### Reglas:
- Productos con BOM NO acumulan stock propio (siempre 0)
- Compras siempre al producto base (no al derivado)
- Conjuntos (tabla conjuntos) siguen siendo agrupadores/filtros, NO BOM

### SEGURIDAD Y CONTROL DE ACCESO
- **VPN:** WireGuard
- **Auth:** JWT via header Authorization + cookie httpOnly (erp_token)
- **Device:** Fingerprinting + dispositivos_autorizados
- **Middleware:** req.usuario (NO req.user) desde auth.middleware.js
- **Control HTML:** html-access.middleware.js (ANTES de express.static)
  - Lee cookie erp_token → valida JWT → consulta rol_modulos (cache 5min)
  - Sin cookie → redirect /login.html
  - Admin → acceso total (anti-lockout)
- **Control API:** modulo-access.middleware.js (verifica acceso ruta vs rol)
- **Cookie:** erp_token, httpOnly, SameSite=Lax, maxAge=24h
- **Menu dinamico:** auth.js v3.0 offcanvas auto-inyectado
- **Paginas publicas:** login.html, ver-pedido-publico.html, index.html
- **Roles:** admin(25), administrador(23), vendedor(4), despachante(5), cajero(3), pedidos(3)
- **Tablas:** modulos, rol_modulos, modulo_rutas_api, modulo_grupos, rutas_soporte

### IMPRESION — RECETA REAL DEL ERP

> **NO usar Puppeteer.** Se descarto en LAGO por dos motivos concretos del dueno:
> (1) cada job levantaba un Chromium completo (~200 MB) y la RAM no se liberaba
>     bien — leaks de browser contexts terminaban en OOM cada N horas;
> (2) si una impresion quedaba a medias (modal cerrado, error JS, timeout), el
>     proceso quedaba colgado y el ERP dejaba de responder a TODOS los usuarios
>     hasta reiniciar PM2.
> Si una sesion futura sugiere "agreguemos cola Puppeteer/CUPS para esto",
> RECHAZAR. La regla es absoluta.

#### Patron unico (HTML server-side + window.print del browser cliente)

```
[Frontend JS]                           [Backend Node]              [Browser cliente]
window.open(                            print.controller            <html>
  /api/print/comprobante/:id/html  -->  carga datos desde BD  -->     ...datos...
  ?token=XXX                            renderiza .hbs                <script>
)                                       devuelve HTML completo          window.onload =
                                                                         () => window.print();
                                                                       </script>
                                                                     </html>
```

**Por que funciona y no rompe nada:**
- Cero proceso pesado en el servidor — solo renderiza un string de HTML y lo devuelve
- Cero estado en servidor — si el usuario cierra la ventana, no queda nada colgado
- La impresion la hace el BROWSER del cliente, no el servidor
- Si el cliente cancela el dialogo de impresion, el servidor ni se entera
- Funciona con cualquier impresora que el cliente tenga configurada en su SO

#### Imprimibles VIVOS hoy (verificado con grep)

| Que imprime | Quien dispara | Endpoint |
|---|---|---|
| Comprobante de venta (pedido) | `frontend/js/venta-rapida-script.js:1602` | `GET /api/print/comprobante/:id/html?token=` |
| Recibo | `frontend/js/tesoreria.js:546` | `GET /api/print/recibo/:id` |
| Facturas, NC/ND, remitos de venta | (otro patron, sin window.open directo — investigar antes de tocar) | — |

**Codigo del frontend (literal, copiable):**
```js
// venta-rapida-script.js
function imprimirComprobante() {
    window.open(API_URL + '/print/comprobante/' + ultimoPedidoGuardado + '/html?token=' + token, '_blank');
}

// tesoreria.js
function imprimirRecibo(id) {
    window.open(`${API_URL}/print/recibo/${id}`, '_blank');
}
```

#### Componentes en disco

**Plantillas (`templates/comprobantes/`):**
- `comprobante_venta.hbs` — Handlebars, UNICA plantilla .hbs viva hoy

**Plantillas legacy (`config/plantillas/`):**
- `remito.template.html`, `remito.template.compacto.html`, `remito.template.6535.html`
- `ticket-venta.template.html`
- `remito.config.json` — define `plantilla_activa: "compacto"|"normal"|"6535"`

**Backend:**
- `src/routes/print.routes.js` — define las rutas (POST /jobs, GET /jobs, GET /impresoras, GET /comprobante/:id/html, GET /comprobante/:id/datos)
- `src/controllers/print.controller.js` — handlers `crearJob`, `listarJobs`, `obtenerJob`, `listarImpresoras`, `getDatosComprobante`, `renderizarHTML`

#### Imprimibles FALTANTES (lo que NO imprime hoy)

- **Comprobantes de compra** (lo que carga el dueno desde facturas/recibos del proveedor)
- **Recepciones de mercaderia**
- **Ordenes de compra** que se emiten al proveedor
- **Presupuestos**

Cuando se decida agregar alguno, seguir la **receta de abajo**.

#### Receta para agregar un imprimible nuevo (4 pasos, ZERO infraestructura nueva)

**Paso 1 — Plantilla**
Crear `templates/comprobantes/comprobante_compra.hbs` (o el nombre que corresponda)
clonando `comprobante_venta.hbs` como base. Adaptar:
- Header: datos del proveedor en vez del cliente
- Items: leer de la tabla correspondiente (`comprobante_compra_items`, `recepcion_items`, etc.)
- Totales segun el tipo de doc
- **Mantener el `<script>window.onload = () => window.print();</script>` al final** —
  esto es lo que dispara la impresion en el browser del cliente.

**Paso 2 — Handler en print.controller.js**
Agregar dos funciones nuevas (una para datos JSON, otra para HTML renderizado),
clonando `getDatosComprobante` y `renderizarHTML`. Cambiar:
- Las queries SQL a las tablas correctas (`comprobantes_compra` + items)
- El nombre de la plantilla a cargar (`comprobante_compra.hbs`)
- **SIEMPRE filtrar por id_empresa** (regla del proyecto)

**Paso 3 — Rutas en print.routes.js**
Agregar 2 lineas nuevas en el bloque que ya existe:
```js
router.get('/comprobante-compra/:id/datos', printController.getDatosComprobanteCompra);
router.get('/comprobante-compra/:id/html',  printController.renderizarHTMLCompra);
```

**Paso 4 — Frontend**
En el HTML donde aparece el detalle (ej. `ver-comprobante-compra.html`), agregar
boton + funcion JS de 2 lineas:
```js
function imprimirComprobanteCompra(id) {
    window.open(`${API_URL}/print/comprobante-compra/${id}/html?token=${token}`, '_blank');
}
```
Atajo de teclado opcional (F9 es el convencional para "imprimir lo que veo").

#### Que pasa con print_jobs / printers_config / log_impresiones

Estas tablas existen en BD y `print.routes.js` tiene rutas POST/GET `/jobs` que
las tocan. **Son restos historicos.** El patron actual NO las usa — el flujo va
directo controller -> HTML -> browser, sin pasar por cola. Si en algun momento
hubo intencion de tener cola Puppeteer, se descarto. NO escribir nuevos handlers
que las consuman ni proponer reactivarlas.

Si el toolkit reporta que `print_jobs` tiene jobs en estado PENDING/PROCESSING
viejos, son zombis — se pueden archivar/borrar sin riesgo.

---

## FEATURES VIGENTES (snapshot May 2026)

Lo que esta vivo HOY y que sesiones futuras deben tener en cuenta antes de tocar:

### AFIP — idempotencia con `afip_solicitudes` (rediseno post-incidente NC duplicadas)
- Tabla `afip_solicitudes` registra cada solicitud ANTES de llamar a AFIP (idempotency_key UUID)
- `afip-auditoria.helper.js` usa **pool propio**, NO la TX del caller — es by-design para
  que la escritura de auditoria sobreviva a ROLLBACKs (incidente real May 2026: 7 NC autorizadas
  por AFIP pero solo 1 persistida en DB por ROLLBACK + require roto del pool)
- AFIP cert valido hasta 2027-10-21
- Compensatorios: 6 ND emitidos para regularizar el incidente
- Columna canonica: `notas_credito_debito.cae` (NO `cae_obtenido`)

### Notificaciones (F3 + F4.A + F4.B)
- Helper centralizado: `notificaciones.helper.js` + 4 adapters (Gmail SMTP funcional,
  dashboard funcional, WhatsApp/SMS stubs)
- 2 tablas: `notificaciones_log`, `notificaciones_dashboard`
- 17 config keys bajo `notificaciones.*` en `configuraciones_empresa`
- F4.A: `notif-badge.js` auto-injected por `auth.js`, polling 60s/300s, filtra por rol
- F4.B: vista `v_pedidos_web`, 5 filtros server-side, umbral urgencia config-driven
- F4.C (cron horario) -> DIFERIDO, no implementado
- Email fix critico: transporter fresh por send + verify() + close() en finally
- Bug pattern: `cfg.get` retorna string -> normalizar SIEMPRE `val===true || val==='true'`
- Deuda conocida: `pedidos.nro_pedido` falta UNIQUE constraint

### Multi-imagen productos (`producto_imagenes`)
- Tabla `producto_imagenes` (FK a productos, sin id_empresa porque productos es compartido)
- CRUD en `/api/productos/:id/imagenes` (notar: mount path es `/productos`, no `/api/productos` —
  el `/api/` lo agrega el server)
- Hasta 6 imagenes por producto, una marcada como principal
- Trigger P4 (refresh cache) es configurable via `configuraciones_empresa`
- Bug latente del modal `ImagenesProductoModal.abrir(id, nombre)`: queda pendiente el boton
  camara en `productos.html`

### Modulo Familia (productos padre-hijo)
- `productos.id_producto_padre` agrupa variantes bajo un padre
- 4 funciones nuevas en `productos.helper.js` para gestion de Familia
- Excel importer: auto-crea padres desde texto descriptivo via slug
- `conjuntos-web.helper.js` actualizado con `sort_key` y `imagen_url` (catalogo B2B)
- Catalogo B2B: imagen por padre, fallback al primer hijo por `sort_key`
- Categoria/subcategoria/conjuntos NO manejan imagenes
- Bug fix: IVA helper `obtenerAlicuotaDefectoParaCreacion` retorna **objeto** con `.id_alicuota`,
  NO entero — varios callers viejos asumian entero

### Modulo Inventario — minimo/maximo + OC automatica
- Columnas `stock_minimo`, `stock_maximo` editables desde inventario.html
- OC automatica segun stock < minimo (cantidad = maximo - stock_actual)
- Filtros por marca/proveedor/categoria/conjunto/subcategoria
- Doc canonica: `docs/modulos/MODULO_INVENTARIO.md` (verificar existencia)
- Endpoint legacy `/completo` marcado como deuda
- `/completo-extendido` con response ~4.8 MB — performance debt conocida

### F5 — Redondeo de precios con IVA entero (May 2026)
- Reglas: `precios.precio_con_iva` SIEMPRE entero (sin decimales)
- Tabla auditoria: `precios_redondeo_backfill_log` (registra antes/despues por fila)
- Columnas nuevas en `precios`: `precio_con_iva`, `precio_neto_calculado`,
  `modo_redondeo_aplicado`, `fecha_redondeo`
- Triggers F1 validan que `precio_con_iva` sea entero al insert/update
- **Codigo viejo a deprecar**: `preciosHelper.escribirPrecio` (PM2 muestra errores
  "is not a function" post-F5 — hay callers desactualizados)

### Bugs latentes conocidos (no romper en sesiones futuras)
- `usuario_configuracion` UNIQUE(id_usuario) debe pasar a UNIQUE(id_empresa, id_usuario)
  ANTES de habilitar empresa 2 — bloqueante
- `cfg.get` puede retornar string "true"/"false" — normalizar SIEMPRE con
  `val===true || val==='true'`
- CC Proveedores: insercion retroactiva corrompe saldos subsecuentes
  (trigger `fn_sync_saldo_cc_proveedor` solo actualiza el agregado, app calcula running)
- Helpers que pisan single-write-point (ver `EXTRA_*.md` seccion 8): a vigilar

---

### LAGO.AR — TIENDA WEB (modelo VPS actual)

> **NO usa Hostinger ni FTP ni catalogo.json estatico.** El modelo FTP fue desmantelado.
> Hostinger queda SOLO para correo. Cualquier referencia a `lago-deploy.helper.js`,
> `generar-catalogo-web.js`, `catalogo_web.*` configs o tabla `lago_deploy_log` es
> historica — esos artefactos fueron eliminados.

#### Arquitectura
```
Cliente HTTPS -> nginx (VPS 72.60.148.18) -> dos caminos:
  /var/www/lago-app/        (estatico: HTML/CSS/JS vanilla)
  /api/web/*                (proxy a Node :3000, scope publico)
  /api/* (no /web/*)        (return 404, scope privado)
```

#### Backend Node servido a lago.ar (4 routes con scope publico)
- `auth-web.routes.js`     -> `auth-web.controller` + `auth-web.helper`
- `catalogo-web.routes.js` -> `catalogo-web.controller` + `conjuntos-web.helper`
- `carrito-web.routes.js`  -> `carrito-web.controller` + `carrito-web.helper`
- `pedidos-web-admin.routes.js` (admin desde ERP, NO publico)

#### Configs en BD (namespace `web.*` en `configuraciones_empresa`)
Editables desde `configuraciones.html`. Cero hardcoded.

- `web.id_empresa`, `web.id_lista_precio_publica`
- `web.jwt_secret`, `web.cookie_name`, `web.cookie_secure`
- `web.login_obligatorio`, `web.precio_visible_sin_login`, `web.permitir_auto_registro`
- `web.permitir_vender_sin_stock` (B2C model: catalogo publico + login para checkout)
- ... y mas (~58 claves bajo `web.*`)

#### Estados pedidos web
- estado 20: pendiente_aprobacion
- estado 21: aprobado_web

#### Operacion
- nginx: `/etc/nginx/sites-enabled/lago.ar` (server_name lago.ar, redirect 301 de www/app)
- SSL: Let's Encrypt (renovacion automatica via certbot)
- Backend: PM2 process `erplago` puerto :3000
- Sin cron de deploy, sin FTP, sin catalogo.json estatico — todo se renderiza en vivo

#### Auth web
JWT cookie httpOnly + `auth-web.middleware.js`. Distinto del JWT del ERP interno
(`auth.middleware.js` con cookie `erp_token`). Ambos coexisten sin colision.

### CONFIGURACIONES (5 niveles)
1. configuracion_sistema -> Global
2. configuraciones_empresa -> Por empresa (incl. claves AFIP: cuit, env, offline, cert paths, topes CF)
3. configuracion_empresa_extendida -> Extensiones
4. usuario_configuracion -> Por usuario
5. config/plantillas/*.config.json -> Plantillas de impresion (switcheable por tipo doc)

### DATOS SEMILLA (obligatorios — si faltan, modulos se rompen)
- Cliente "Consumidor Final" (venta-rapida obtenerConsumidorFinal)
- pedidoestados: {1..N} incluyendo 99=Recuperado
- factura_tipos: A, B, C
- condicionesiva: 1=Resp.Inscripto, 5=Consumidor Final, etc
- alicuotasiva: 21%, 10.5%, 27%, 0%, Exento
- monedas: 1=ARS, 2=USD
- configuraciones_empresa: claves afip_* (7 claves)

### MIDDLEWARE SERVER.JS (globales)
- compression → GZIP ~70% menos transferencia
- express.json/urlencoded → Body parsing
- html-access.middleware → Control acceso HTML (ANTES de express.static)
- modulo-access.middleware → Control acceso API
- Anti-cache headers para *.html

STATICBLOCK

    # === Seccion 2: Metodos de pago (dinamica desde BD) ===
    echo "" >> "$PROMPT_FILE"
    echo "### METODOS DE PAGO" >> "$PROMPT_FILE"
    echo '```' >> "$PROMPT_FILE"
    if verificar_bd; then
        local existe_mp=""
        existe_mp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='metodosdepago'" 2>/dev/null || true)
        if [ "$existe_mp" = "1" ]; then
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT 'ID ' || id_metodo_pago || ': ' || nombre FROM metodosdepago ORDER BY id_metodo_pago" 2>/dev/null >> "$PROMPT_FILE" || true
        fi
        echo "" >> "$PROMPT_FILE"
        echo "Recargos/Descuentos activos:" >> "$PROMPT_FILE"
        local existe_rfp=""
        existe_rfp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='recargos_forma_pago'" 2>/dev/null || true)
        if [ "$existe_rfp" = "1" ]; then
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT fp.nombre || ': ' || rfp.porcentaje || '%' FROM recargos_forma_pago rfp JOIN formas_pago fp ON rfp.id_forma_pago=fp.id_forma_pago AND rfp.id_empresa=fp.id_empresa WHERE rfp.activo=true AND rfp.porcentaje != 0 ORDER BY fp.nombre" 2>/dev/null >> "$PROMPT_FILE" || true
        fi
    fi
    echo '```' >> "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 3: Helpers ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## HELPERS CENTRALIZADOS" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_helpers_existentes "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 4: Progreso migracion ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## PROGRESO DE MIGRACION" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    calcular_progreso_migracion "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 5: Columnas GENERATED ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## COLUMNAS GENERATED ALWAYS (NO escribibles)" >> "$PROMPT_FILE"
    echo '```' >> "$PROMPT_FILE"
    if verificar_bd; then
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema='public' AND is_generated='ALWAYS' ORDER BY table_name;" 2>/dev/null >> "$PROMPT_FILE" || true
    fi
    echo '```' >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"

    # === Seccion 6: Mapeo frontend-backend ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## MAPEO FRONTEND -> BACKEND (auto-detectado)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "| Frontend HTML | JS Frontend | Endpoints API |" >> "$PROMPT_FILE"
    echo "|---------------|-------------|---------------|" >> "$PROMPT_FILE"
    if [ -n "$FRONTEND_DIR" ] && [ -d "$FRONTEND_DIR" ]; then
        while IFS= read -r html_path; do
            [ -z "$html_path" ] && continue
            local html_name; html_name=$(basename "$html_path" .html)
            case "$html_name" in login|index|test-modal|vista-previa|ver-pedido-publico|diagnostico) continue ;; esac
            local js_name="-"
            [ -f "$JS_DIR/${html_name}.js" ] && js_name="${html_name}.js"
            [ -f "$JS_DIR/${html_name}-script.js" ] && js_name="${html_name}-script.js"
            if [ "$js_name" = "-" ] && [ -f "$html_path" ]; then
                local from_html=""
                from_html=$(grep -oE 'src="js/[^"]+\.js"' "$html_path" 2>/dev/null | sed 's/src="js\///; s/"//' | grep -v "config-panel\|common\|utils\|CONFIG\|modal\|auth" | tail -1 || true)
                [ -n "$from_html" ] && [ -f "$JS_DIR/$from_html" ] && js_name="$from_html"
            fi
            local ctrls="-"
            if [ "$js_name" != "-" ] && [ -f "$JS_DIR/$js_name" ]; then
                local eps=""
                eps=$(detectar_endpoints_usados "$JS_DIR/$js_name")
                [ -n "$eps" ] && ctrls="$eps"
            fi
            echo "| ${html_name}.html | $js_name | $ctrls |" >> "$PROMPT_FILE"
        done < <(find "$FRONTEND_DIR" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)
    fi
    echo "" >> "$PROMPT_FILE"

    # === Seccion 7: Features especiales ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## FEATURES ESPECIALES (auto-detectadas)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_features_especiales "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === [v38] Seccion 8: Seguridad REMOVIDA - detalle completo en SEGURIDAD_*.md ===

    # === [v37] Seccion 9: Estado Multi-Empresa (dinamica) ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## ESTADO MULTI-EMPRESA (auto-detectado)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_estado_multiempresa "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === [v59-C2] Schema dump de tablas criticas ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## SCHEMA DE TABLAS CRITICAS (auto-detectado, top-15)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    generar_schema_critico "$PROMPT_FILE"

    # === [v59-C3] Convencion @scope para helpers ===
    cat >> "$PROMPT_FILE" << 'SCOPEBLOCK'
---

## CONVENCION DE HELPERS — MARCADOR @scope

Todo nuevo helper en `src/utils/*.helper.js` debe declarar su scope en JSDoc al
inicio del archivo. El toolkit (auditoria-me Check 5) lo respeta para decidir si
sus funciones requieren `id_empresa` en la firma.

### Tipos de scope

```js
/**
 * @scope stateless
 * Helper sin estado, no toca BD. Ej: iva.helper.js, texto.helper.js, cuit-lookup.helper.js
 */

/**
 * @scope pure
 * Helper de funciones puras (input -> output, sin side effects). Ej: busqueda.helper.js
 */

/**
 * @scope shared-catalog
 * Helper que opera sobre tablas COMPARTIDAS (productos, marcas, categorias, monedas, etc).
 * NO debe filtrar por id_empresa. Ej: codigos-barra.helper.js
 */

/**
 * @scope enterprise
 * (DEFAULT — no hace falta marcar) Helper que opera sobre tablas con id_empresa.
 * Todas sus funciones publicas DEBEN recibir id_empresa como parametro.
 * Ej: pedidos.helper.js, pagos.helper.js, facturacion.helper.js
 */
```

### Convenciones complementarias para funciones internas

- **Prefijo `_`**: funciones privadas/internas → toolkit las salta.
  Ej: `_calcularSubtotal`, `_normalizarFecha`.
- **JSDoc `@pure` arriba de la firma**: marca funcion individual como pura, aun en helper enterprise.
  Ej: dentro de `pedidos.helper.js`, una funcion `formatearTitulo()` puede llevar `@pure`.
- **Patron idiomatic**: nombres tipo `calcular*`, `normalizar*`, `redondear*`, `formatear*`,
  `validar*`, `parsear*`, `convertir*` se asumen puros. NO marcar con `@pure` redundantemente.

### Que pasa si NO se marca

- Helper sin marcador `@scope` y que toca tablas enterprise → DEFAULT enterprise → Check 5 audita firmas.
- Helper sin marcador `@scope` y que NO toca tablas enterprise → AUTO-DETECT stateless → Check 5 lo salta.
- Funcion sin prefijo `_` ni `@pure` ni patron idiomatic → Check 5 audita su firma.

SCOPEBLOCK

    # === [v59-C4] Firmas de helpers exportados ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## FIRMAS DE HELPERS EXPORTADOS (auto-detectado)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    generar_firmas_helpers "$PROMPT_FILE"

    # === [v59-C5] Dump de config keys ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## CONFIG KEYS DUMP (configuraciones_empresa, id_empresa=1)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    generar_config_dump "$PROMPT_FILE"

    # === [v60] Flujo Caja: jerarquia empresa->usuario->deposito->caja->turno ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## FLUJO CAJA — JERARQUIA EMPRESA->USUARIO->DEPOSITO->CAJA->TURNO" >> "$PROMPT_FILE"
    cat >> "$PROMPT_FILE" << 'CAJABLOCK'

Patron canonico verificable contra los 7 consumers de `caja.helper.js`. Aplica
en VENTAS (venta-rapida, pedidos, despachos), COMPRAS (pagos-proveedores) y
TESORERIA (cobranzas, recibos, arqueo). Ningun modulo escribe en
`movimientos_caja` saltando este flujo.

```
1. id_empresa  = req.usuario.id_empresa  (JWT)
2. id_deposito = stockHelper.obtenerDepositoUsuario(client, {id_empresa, id_usuario})
3. turno       = cajaHelper.requerirTurnoAbierto(client, id_empresa, {id_deposito})
                 -> lanza TURNO_REQUIRED / CAJA_CERRADA si no hay turno abierto
                    en la caja de SU deposito
4. cajaHelper.registrarMovimiento(client, {id_turno, id_metodo_pago, ...})
   -> INSERT movimientos_caja
5. SKIP si metodosdepago.mueve_caja = false  (ej: Cuenta Corriente, no_tesoreria)
6. UPDATE turnos_caja.ingresos/egresos_efectivo_ars  SOLO si tipo_cuenta='caja_fisica'
   (MP, transfer, tarjetas crean fila en movimientos_caja pero NO actualizan
    el contador de efectivo del turno; el arqueo trae cada metodo por separado
    via caja.helper.calcularDesgloseFormasPago)
```

**Reglas duras:**
- Cada vendedor cobra en la caja de SU deposito. Multi-sucursal cerrado en
  Lote L2 de venta-rapida (ID bug B9). Caja global sin filtrar por deposito
  es bug.
- `metodosdepago` (cobros cliente, 6 filas) y `formas_pago` (pagos proveedor,
  8 filas) son tablas DISTINTAS. NO unificar. Puente explicito:
  `formas_pago.id_metodo_pago_caja -> metodosdepago.id_metodo_pago`.
- Pagar a proveedor con cheque -> cheques_propios o cheques_terceros. Endosar
  cheque tercero -> tesoreria.helper marca cheque, no genera movimiento_caja
  (no se mueve plata fisica, se mueve un instrumento).
- `pagos.origen` valido: `pos` (venta-rapida), `despachos` (cobro en viaje),
  `facturacion` (residual, 3 filas). Cualquier otro valor es bug.
- `id_recibo` en movimientos_caja apunta a `recibos.id_recibo` SOLO para
  cobranzas CC. POS no genera recibo, se relaciona via `id_pago`.

**Codigo de error / UX:**
| Codigo | Origen | Frontend |
|--------|--------|----------|
| `TURNO_REQUIRED` | tesoreria.helper | Modal "Abrir caja en deposito X" |
| `CAJA_CERRADA` | caja.helper | Modal con id_deposito |
| `CF_NO_PUEDE_FIAR` | cobranza.helper | Toast 6s |
| `CF_NO_PUEDE_PARCIAL` | cobranza.helper | Toast 6s |
| `LIMITE_CREDITO_EXCEDIDO` | cobranza.helper | Modal con detalle |
| `SUMA_INCONSISTENTE` | cobranza.helper | Toast 5s |
| `METODO_CC_NO_VALIDO` | cobranza.helper | Toast 5s (bug interno) |
| `FIADO_CF_PROHIBIDO` | pagos.helper | Modal defensivo |

CAJABLOCK
    echo "" >> "$PROMPT_FILE"

    # Estado dinamico actual del flujo de caja en BD
    echo "### ESTADO ACTUAL (auto-detectado)" >> "$PROMPT_FILE"
    verificar_flujo_caja "$PROMPT_FILE"

    # === [v68] Modulos documentados en docs/modulos/ + docs/sesiones/ ===
    # docs/modulos/ tiene la doc canonica vigente (un .md por modulo).
    # docs/sesiones/ tiene las bitacoras puntuales (MODULO_*.md, DOCUMENTACION_*.md
    # legacy + nombres con fecha). Ambos se inyectan en el prompt.
    local hay_docs=0
    if [ -d "$PROJECT_ROOT/docs/modulos" ] || [ -d "$PROJECT_ROOT/docs/sesiones" ]; then
        echo "" >> "$PROMPT_FILE"
        echo "---" >> "$PROMPT_FILE"
        echo "" >> "$PROMPT_FILE"
        echo "## DOCUMENTACION DE MODULOS DISPONIBLE" >> "$PROMPT_FILE"
        echo "" >> "$PROMPT_FILE"
        echo "Re-leer estos .md ANTES de tocar el modulo correspondiente:" >> "$PROMPT_FILE"
        echo "" >> "$PROMPT_FILE"

        if [ -d "$PROJECT_ROOT/docs/modulos" ]; then
            local md_canon
            for md_canon in "$PROJECT_ROOT/docs/modulos"/*.md; do
                [ -f "$md_canon" ] || continue
                echo "- \`docs/modulos/$(basename "$md_canon")\` (canonico vigente)" >> "$PROMPT_FILE"
                hay_docs=1
            done
        fi

        if [ -d "$PROJECT_ROOT/docs/sesiones" ]; then
            local md_ses
            for md_ses in "$PROJECT_ROOT/docs/sesiones"/MODULO_*.md "$PROJECT_ROOT/docs/sesiones"/DOCUMENTACION_*.md; do
                [ -f "$md_ses" ] || continue
                echo "- \`docs/sesiones/$(basename "$md_ses")\` (bitacora legacy)" >> "$PROMPT_FILE"
                hay_docs=1
            done
        fi

        if [ "$hay_docs" -eq 0 ]; then
            echo "_Ningun modulo tiene doc canonica todavia. La unica fuente vigente es este prompt + las sesiones puntuales abajo._" >> "$PROMPT_FILE"
        fi
        echo "" >> "$PROMPT_FILE"
    fi

    # === [v56] Secciones 10/11/12 ELIMINADAS del prompt_maestro ===
    # verificar_auditoria_multiempresa, verificar_datos_semilla y verificar_constraints_triggers
    # ya se ejecutan en SALUD_ARQUITECTONICA.md (paso 3 del informe completo). Tenerlos
    # tambien aca causaba que el INFORME_COMPLETO los muestre 2 veces. Son chequeos de
    # salud, no documentacion estatica para el desarrollador. Quedan solo en SALUD.

    # Seccion COMANDOS FRECUENTES removida del prompt (es README, no contexto IA).

    # === [v59-C7] Inyeccion de la ultima sesion documentada ===
    # docs/sesiones/ contiene estado puntual de cada sprint (numeros que cambian, bugs en proceso).
    # NO debe estar en memoria del LLM (caduca rapido). SI debe estar en este prompt cada vez.
    local SESIONES_DIR="$PROJECT_ROOT/docs/sesiones"
    if [ -d "$SESIONES_DIR" ]; then
        local ultima
        ultima=$(ls -t "$SESIONES_DIR"/*.md 2>/dev/null | head -1)
        if [ -n "$ultima" ]; then
            echo "---" >> "$PROMPT_FILE"
            echo "" >> "$PROMPT_FILE"
            echo "## ULTIMA SESION DE TRABAJO (estado puntual, sobreescribe contradicciones del prompt)" >> "$PROMPT_FILE"
            echo "" >> "$PROMPT_FILE"
            echo "*Fuente: \`$ultima\`*" >> "$PROMPT_FILE"
            echo "" >> "$PROMPT_FILE"
            cat "$ultima" >> "$PROMPT_FILE"
            echo "" >> "$PROMPT_FILE"
            local otras
            otras=$(ls -t "$SESIONES_DIR"/*.md 2>/dev/null | tail -n +2 | head -5)
            if [ -n "$otras" ]; then
                echo "### Sesiones anteriores (consultar si hace falta historico)" >> "$PROMPT_FILE"
                while IFS= read -r sf; do
                    [ -z "$sf" ] && continue
                    echo "- \`$(basename "$sf")\`" >> "$PROMPT_FILE"
                done <<< "$otras"
                echo "" >> "$PROMPT_FILE"
            fi
        fi
    fi

    echo "---" >> "$PROMPT_FILE"
    echo "*Generado por Toolkit v${VERSION} - $(date '+%Y-%m-%d %H:%M')*" >> "$PROMPT_FILE"

    # [v68 FIX-05] Substituir placeholder <VERSION> por nombre real del script
    local SCRIPT_NAME
    SCRIPT_NAME="$(basename "${BASH_SOURCE[0]:-toolkit_v${VERSION}.sh}")"
    sed -i "s|toolkit_<VERSION>\.sh|${SCRIPT_NAME}|g" "$PROMPT_FILE"

    echo -e "${GREEN}[OK] Prompt Maestro generado: $PROMPT_FILE${NC}"
}


# =======================================================================================
# FLUJO CAJA — Empresa -> Usuario -> Deposito -> Caja -> Turno -> Movimiento
# =======================================================================================
# Mapea la jerarquia que aparece consistentemente en VENTAS, COMPRAS y TESORERIA.
# Patron canonico (verificable contra los 7 consumers de caja.helper.js):
#   1. id_empresa viene de req.usuario.id_empresa (JWT)
#   2. id_deposito = stockHelper.obtenerDepositoUsuario(client, {id_empresa, id_usuario})
#   3. turno = cajaHelper.requerirTurnoAbierto(client, id_empresa, {id_deposito})
#      -> lanza TURNO_REQUIRED / CAJA_CERRADA si no hay turno abierto en SU deposito
#   4. cajaHelper.registrarMovimiento(client, {...}) inserta en movimientos_caja
#   5. Si metodosdepago.mueve_caja=false (CC, no_tesoreria) -> SKIP
#   6. Solo tipo_cuenta='caja_fisica' actualiza turnos_caja.ingresos/egresos_efectivo_ars
verificar_flujo_caja() {
    local destino="${1:-}"
    local _out=""

    _out+="### FLUJO CAJA — JERARQUIA EMPRESA->USUARIO->DEPOSITO->CAJA->TURNO"$'\n'
    _out+="Patron canonico repetido en ventas, compras, tesoreria, despachos."$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # ---- 1. CONTEO POR NIVEL DE LA JERARQUIA ----
    _out+="#### Conteo por nivel"$'\n'
    local n_emp n_dep n_caja n_user
    # [v65-FIX] detectar dinamicamente columna activa/activo (varia por tabla)
    local col_dep_activo col_caja_activa
    col_dep_activo=$(_run_sql "
        SELECT column_name FROM information_schema.columns
        WHERE table_name='depositos' AND column_name IN ('activo','activa')
        LIMIT 1")
    col_caja_activa=$(_run_sql "
        SELECT column_name FROM information_schema.columns
        WHERE table_name='cajas' AND column_name IN ('activa','activo','habilitada')
        LIMIT 1")
    [ -z "$col_dep_activo" ] && col_dep_activo="activo"
    [ -z "$col_caja_activa" ] && col_caja_activa="activa"

    n_emp=$(_run_sql "SELECT COUNT(*) FROM empresas")
    n_dep=$(_run_sql "SELECT COUNT(*) FROM depositos WHERE ${col_dep_activo}=true")
    n_caja=$(_run_sql "SELECT COUNT(*) FROM cajas WHERE ${col_caja_activa}=true")
    n_user=$(_run_sql "SELECT COUNT(*) FROM usuarios WHERE estado='activo'")
    _out+="- Empresas activas: ${n_emp:-0}"$'\n'
    _out+="- Depositos activos: ${n_dep:-0}"$'\n'
    _out+="- Cajas activas: ${n_caja:-0}"$'\n'
    _out+="- Usuarios activos: ${n_user:-0}"$'\n'$'\n'

    # ---- 2. USUARIO -> DEPOSITO (cada usuario debe tener id_deposito) ----
    _out+="#### Asignacion Usuario -> Deposito"$'\n'
    local sin_dep
    sin_dep=$(_run_sql "SELECT COUNT(*) FROM usuarios WHERE estado='activo' AND id_deposito IS NULL")
    if [ "${sin_dep:-0}" = "0" ]; then
        _out+="- [OK] Todos los usuarios activos tienen id_deposito"$'\n'
    else
        _out+="- [WARN] ${sin_dep} usuario(s) activos sin id_deposito asignado"$'\n'
        local listado
        listado=$(_run_sql "SELECT username FROM usuarios WHERE estado='activo' AND id_deposito IS NULL ORDER BY username")
        if [ -n "$listado" ]; then
            while IFS= read -r u; do [ -n "$u" ] && _out+="    - $u"$'\n'; done <<< "$listado"
        fi
    fi
    _out+=""$'\n'

    # ---- 3. DEPOSITO -> CAJA (cada deposito activo deberia tener al menos 1 caja) ----
    _out+="#### Depositos sin caja activa"$'\n'
    local dep_sin_caja
    dep_sin_caja=$(_run_sql "
        SELECT d.codigo || ' (' || d.nombre || ')'
        FROM depositos d
        WHERE d.${col_dep_activo}=true
        AND NOT EXISTS (SELECT 1 FROM cajas c WHERE c.id_deposito=d.id_deposito AND c.${col_caja_activa}=true)
        ORDER BY d.codigo
    ")
    if [ -z "$dep_sin_caja" ]; then
        _out+="- [OK] Todos los depositos activos tienen al menos una caja activa"$'\n'
    else
        while IFS= read -r d; do [ -n "$d" ] && _out+="- [WARN] $d"$'\n'; done <<< "$dep_sin_caja"
    fi
    _out+=""$'\n'

    # ---- 4. CAJA -> TURNO ABIERTO (estado actual operativo) ----
    _out+="#### Turnos abiertos en este momento"$'\n'
    local turnos_abiertos
    turnos_abiertos=$(_run_sql "
        SELECT
            t.id_turno || ' | ' ||
            COALESCE(c.nombre, 'caja' || c.id_caja) || ' | ' ||
            COALESCE(d.codigo, '?') || ' | ' ||
            COALESCE(u.username, '?') || ' | abierto desde ' ||
            to_char(t.fecha_apertura, 'YYYY-MM-DD HH24:MI')
        FROM turnos_caja t
        JOIN cajas c ON t.id_caja = c.id_caja
        LEFT JOIN depositos d ON c.id_deposito = d.id_deposito
        LEFT JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario
        WHERE t.estado='abierto'
        ORDER BY t.fecha_apertura
    ")
    if [ -z "$turnos_abiertos" ]; then
        _out+="- [INFO] No hay turnos abiertos. Ningun cobro/pago en efectivo se podra registrar."$'\n'
        _out+="  -> en venta-rapida saltara CAJA_CERRADA"$'\n'
        _out+="  -> en pagos-proveedores saltara TURNO_REQUIRED"$'\n'
    else
        _out+="- id_turno | caja | deposito | abierto_por | desde"$'\n'
        while IFS= read -r t; do [ -n "$t" ] && _out+="  - $t"$'\n'; done <<< "$turnos_abiertos"
    fi
    _out+=""$'\n'

    # ---- 5. MOVIMIENTOS HUERFANOS (turnos cerrados con movs sin cuadrar) ----
    _out+="#### Movimientos en caja: distribucion por origen"$'\n'
    local mov_origen
    # [v65-FIX] La query anterior asumia que mc.id_recibo->pagos.id_recibo,
    # pero pagos NO tiene id_recibo (es al reves: mc puede tener id_recibo y/o id_pago).
    # Detectar dinamicamente la FK real entre movimientos_caja y pagos.
    local mc_pagos_col
    mc_pagos_col=$(_run_sql "
        SELECT column_name FROM information_schema.columns
        WHERE table_name='movimientos_caja' AND column_name IN ('id_pago','id_recibo','id_cobranza')
        ORDER BY CASE column_name WHEN 'id_pago' THEN 1 WHEN 'id_recibo' THEN 2 ELSE 3 END
        LIMIT 1")
    if [ -n "$mc_pagos_col" ]; then
        mov_origen=$(_run_sql "
            SELECT COALESCE(p.origen, '(sin origen)') || ': ' || COUNT(*) || ' filas'
            FROM movimientos_caja mc
            LEFT JOIN pagos p ON mc.${mc_pagos_col} = p.id_pago
            GROUP BY p.origen
            ORDER BY COUNT(*) DESC
        ")
    else
        # Fallback: solo conteo total de movimientos_caja, sin distribucion
        mov_origen=$(_run_sql "
            SELECT 'total movimientos_caja: ' || COUNT(*) FROM movimientos_caja
        ")
    fi
    if [ -n "$mov_origen" ]; then
        while IFS= read -r m; do [ -n "$m" ] && _out+="  - $m"$'\n'; done <<< "$mov_origen"
    fi
    _out+=""$'\n'

    # ---- 6. CONSUMERS DE caja.helper.js (verificacion del patron) ----
    _out+="#### Consumers de caja.helper (puntos de escritura en movimientos_caja)"$'\n'
    if [ -d "${CONTROLLERS_DIR:-}" ]; then
        local consumers
        consumers=$(grep -rl "caja\.helper\|cajaHelper" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
            | sort -u | xargs -I{} basename {})
        if [ -n "$consumers" ]; then
            local n
            n=$(echo "$consumers" | wc -l | tr -d '[:space:]')
            _out+="- ${n} controllers usan caja.helper:"$'\n'
            while IFS= read -r c; do [ -n "$c" ] && _out+="  - $c"$'\n'; done <<< "$consumers"
        else
            _out+="- [WARN] Ningun controller usa caja.helper directamente"$'\n'
        fi
    fi
    _out+=""$'\n'

    # ---- 7. metodosdepago: tipo_cuenta + mueve_caja (config core) ----
    _out+="#### Metodos de pago: tipo_cuenta vs mueve_caja"$'\n'
    local mp
    mp=$(_run_sql "
        SELECT id_metodo_pago || ' | ' || nombre || ' | tipo=' || tipo_cuenta || ' | mueve_caja=' || mueve_caja
        FROM metodosdepago
        WHERE activo=true AND id_empresa=1
        ORDER BY id_metodo_pago
    ")
    if [ -n "$mp" ]; then
        while IFS= read -r m; do [ -n "$m" ] && _out+="  - $m"$'\n'; done <<< "$mp"
    fi
    _out+=""$'\n'

    # ---- 8. VALIDACIONES DE ERROR POR HELPER DEL FLUJO ----
    # Investigado en VPS: ningun helper usa throw new Error('UPPERCASE').
    # Todos usan mensajes legibles tipo throw new Error('caja.helper.X: Y obligatorio').
    # Por eso ahora mostramos COUNT de throws por helper (deuda real: 0 throws =
    # boundaries no validados explicitamente).
    _out+="#### Validaciones de error por helper del flujo de caja"$'\n'
    if [ -d "${UTILS_DIR:-}" ]; then
        local helpers_flujo=("caja" "cobranza" "cc-clientes" "cc-proveedores" "pagos" "pagos-proveedores" "tesoreria" "borrador")
        local total_throws=0
        for hf in "${helpers_flujo[@]}"; do
            local p="$UTILS_DIR/${hf}.helper.js"
            if [ ! -f "$p" ]; then
                _out+="  - ${hf}.helper.js: [SKIP] no existe"$'\n'
                continue
            fi
            # [v67.1-FIX] grep -c devuelve 0 + exit 1 cuando no hay matches.
            # El "|| echo 0" anterior generaba "0\n0" multilinea -> aritmetica fallaba.
            local cnt
            cnt=$(grep -cE "throw new Error|throw \{" "$p" 2>/dev/null)
            [ -z "$cnt" ] && cnt=0
            # Sanitizar: a veces grep -c con archivos vacios devuelve string raro
            cnt=$(echo "$cnt" | head -1 | tr -d ' ')
            [ -z "$cnt" ] && cnt=0
            total_throws=$((total_throws + cnt))
            if [ "$cnt" -eq 0 ]; then
                _out+="  - ${hf}.helper.js: **0 throws** ⚠️ sin defensas explicitas en boundaries"$'\n'
            else
                _out+="  - ${hf}.helper.js: $cnt throws"$'\n'
                # [v67.1-FIX] Reemplazar sed regex con escapes problematicos por
                # pipeline simple: grep mensaje quoteado + cut linea + concatenar.
                local samples_lines
                samples_lines=$(grep -nE "throw new Error|throw \{" "$p" 2>/dev/null | head -3)
                if [ -n "$samples_lines" ]; then
                    while IFS= read -r line; do
                        [ -z "$line" ] && continue
                        local lnum; lnum=$(echo "$line" | cut -d: -f1 | tr -d ' ')
                        # Primer string quoted (single o double) de hasta 60 chars
                        local msg; msg=$(echo "$line" | grep -oE "[\"'][^\"']{1,100}[\"']" | head -1 | sed "s/^['\"]//;s/['\"]\$//")
                        if [ -n "$msg" ]; then
                            _out+="      L${lnum}: ${msg}"$'\n'
                        else
                            _out+="      L${lnum}: (mensaje dinamico)"$'\n'
                        fi
                    done <<< "$samples_lines"
                fi
                if [ "$cnt" -gt 3 ]; then
                    _out+="      ... y $((cnt - 3)) mas"$'\n'
                fi
            fi
        done
        _out+="  → Total throws en flujo de caja: ${total_throws}"$'\n'
    fi
    _out+=""$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# EXTRA — Lo que NO entra en el INFORME_COMPLETO
# =======================================================================================
# El informe captura ESTRUCTURA (tablas, controllers, helpers, schema).
# Esto captura ESTADO + DEUDAS + DRIFT (volatil, vivo, accionable):
#   1. Runtime: PM2, BD, disco, backup, error log
#   2. Turnos abiertos AHORA
#   3. Deudas conocidas con monto/cantidad actualizados (huerfanos, IVA hardcoded, stock neg)
#   4. Drift: @scope vs firma real, configs en codigo vs en BD
#   5. Limpieza pendiente: .bak*, dirs legacy, tablas _backup_*
#   6. Sesiones recientes documentadas
#   7. Self-check del toolkit
extraer_extras() {
    local destino="${1:-}"
    # [v68 FIX-14] Timestamp con segundos para evitar colision si se llama 2x
    # en el mismo minuto (era el bug que duplicaba EXTRA_*.md)
    local TS_LOCAL; TS_LOCAL=$(date '+%Y%m%d_%H%M%S')
    local OUT="${OUTPUT_DIR}/EXTRA_${TS_LOCAL}.md"
    local _out=""

    _out+="# EXTRA — RUNTIME + DEUDAS + DRIFT + CLEANUP"$'\n'
    _out+="## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}"$'\n'
    _out+=""$'\n'
    _out+="*Lo que NO esta en el INFORME_COMPLETO. Estado vivo, no estructura.*"$'\n'
    _out+=""$'\n'
    _out+="---"$'\n'$'\n'

    # ============================================================
    # 1. RUNTIME
    # ============================================================
    _out+="## 1. RUNTIME"$'\n'$'\n'

    # 1.1 PM2 status del proceso erplago
    _out+="### 1.1 PM2 — proceso erplago"$'\n'
    if command -v pm2 >/dev/null 2>&1; then
        _out+='```'$'\n'
        local pm2_info
        pm2_info=$(pm2 jlist 2>/dev/null | python3 -c '
import json, sys, datetime
try:
    procs = json.load(sys.stdin)
except Exception:
    sys.exit(0)
now = datetime.datetime.now().timestamp() * 1000
for p in procs:
    if p.get("name") == "erplago":
        ps = p.get("pm2_env", {})
        m = p.get("monit", {})
        up = ps.get("pm_uptime", 0)
        uptime_h = (now - up) / 1000 / 3600 if up else 0
        print(f"status:    {ps.get(\"status\")}")
        print(f"restarts:  {ps.get(\"restart_time\")}")
        print(f"uptime_h:  {uptime_h:.1f}")
        print(f"memory_MB: {m.get(\"memory\", 0) / 1024 / 1024:.1f}")
        print(f"cpu_pct:   {m.get(\"cpu\")}")
        print(f"pid:       {p.get(\"pid\")}")
        break
' 2>/dev/null)
        if [ -z "$pm2_info" ]; then
            _out+="(pm2 no devuelve datos en este contexto — no implica que erplago este caido; verificar manualmente con: pm2 status erplago)"$'\n'
        else
            _out+="${pm2_info}"$'\n'
        fi
        _out+='```'$'\n'$'\n'
    else
        _out+="- pm2 no instalado o no en PATH"$'\n'$'\n'
    fi

    # 1.2 PostgreSQL — estado vivo
    _out+="### 1.2 PostgreSQL — estado vivo"$'\n'
    if verificar_bd 2>/dev/null; then
        local pg_conn pg_locks pg_size pg_long
        pg_conn=$(_run_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='${DB_NAME}'")
        pg_locks=$(_run_sql "SELECT COUNT(*) FROM pg_locks WHERE granted=false")
        pg_size=$(_run_sql "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'))")
        pg_long=$(_run_sql "SELECT COUNT(*) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND state='active' AND now() - query_start > interval '30 seconds'")
        _out+="- conexiones activas: ${pg_conn:-?}"$'\n'
        _out+="- locks no concedidos: ${pg_locks:-?}"$'\n'
        _out+="- tamano BD: ${pg_size:-?}"$'\n'
        _out+="- queries activas > 30s: ${pg_long:-?}"$'\n'
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=""$'\n'

    # 1.3 Disco
    _out+="### 1.3 Disco (raiz)"$'\n'
    _out+='```'$'\n'
    _out+="$(df -h / 2>/dev/null | head -2)"$'\n'
    _out+='```'$'\n'$'\n'

    # 1.4 Ultimo backup
    _out+="### 1.4 Ultimo backup BD"$'\n'
    local latest_dump=""
    for d in /root/backups /root/backups/db /root/backups/erplago; do
        [ -d "$d" ] || continue
        local cand
        cand=$(ls -t "$d"/*.sql.gz "$d"/*.dump "$d"/*.tar.gz "$d"/*.sql 2>/dev/null | head -1)
        if [ -n "$cand" ]; then latest_dump="$cand"; break; fi
    done
    if [ -n "$latest_dump" ]; then
        local dump_size dump_age
        dump_size=$(du -h "$latest_dump" 2>/dev/null | awk '{print $1}')
        dump_age=$(stat -c '%y' "$latest_dump" 2>/dev/null | cut -d. -f1)
        _out+="- archivo: $(basename "$latest_dump")"$'\n'
        _out+="- tamano: ${dump_size}"$'\n'
        _out+="- fecha: ${dump_age}"$'\n'
    else
        _out+="- [WARN] No se encontraron backups en /root/backups/"$'\n'
    fi
    _out+=""$'\n'

    # 1.5 PM2 error log
    _out+="### 1.5 PM2 error log"$'\n'
    local err_log="/root/.pm2/logs/erplago-error.log"
    if [ -f "$err_log" ]; then
        local err_size err_lines
        err_size=$(du -h "$err_log" 2>/dev/null | awk '{print $1}')
        err_lines=$(wc -l < "$err_log" 2>/dev/null | tr -d '[:space:]')
        _out+="- tamano: ${err_size} (${err_lines} lineas)"$'\n'
        # Ultimas 3 lineas que parezcan error real (no stacktrace)
        local last_errs
        last_errs=$(grep -iE "Error|FATAL|throw|EADDRINUSE" "$err_log" 2>/dev/null | tail -3)
        if [ -n "$last_errs" ]; then
            _out+="- ultimos errores destacados:"$'\n'
            while IFS= read -r e; do
                [ -n "$e" ] && _out+="  - $(echo "$e" | head -c 200)"$'\n'
            done <<< "$last_errs"
        fi
    else
        _out+="- log no encontrado"$'\n'
    fi
    _out+=""$'\n'

    # ============================================================
    # 2. TURNOS DE CAJA AHORA
    # ============================================================
    _out+="## 2. TURNOS DE CAJA — estado actual"$'\n'$'\n'
    if verificar_bd 2>/dev/null; then
        local turnos
        turnos=$(_run_sql "
            SELECT t.id_turno || ' | caja=' ||
                COALESCE(c.nombre, c.id_caja::text) || ' | dep=' ||
                COALESCE(d.codigo, '?') || ' | usr=' ||
                COALESCE(u.username, '?') || ' | desde=' ||
                to_char(t.fecha_apertura, 'YYYY-MM-DD HH24:MI')
            FROM turnos_caja t
            JOIN cajas c ON t.id_caja = c.id_caja
            LEFT JOIN depositos d ON c.id_deposito = d.id_deposito
            LEFT JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario
            WHERE t.estado='abierto'
            ORDER BY t.fecha_apertura
        ")
        if [ -z "$turnos" ]; then
            _out+="- [INFO] Ningun turno abierto."$'\n'
            _out+="- POS y pagos en efectivo van a fallar con TURNO_REQUIRED / CAJA_CERRADA"$'\n'
        else
            while IFS= read -r t; do [ -n "$t" ] && _out+="- $t"$'\n'; done <<< "$turnos"
        fi
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=""$'\n'

    # ============================================================
    # 3. DRIFT TECNICO DETECTABLE EN BD/CODIGO
    #    Nota: huerfanos contables (pedidos sin pago, pagos sobre comprobantes
    #    anulados) NO se monitorean aca — se regularizan desde el frontend.
    # ============================================================
    _out+="## 3. DRIFT TECNICO DETECTABLE"$'\n'$'\n'

    if verificar_bd 2>/dev/null; then
        # 3.1 IVA hardcoded en codigo
        _out+="### 3.1 IVA hardcoded \`|| 21\` o \`COALESCE(_, 21)\` en src/"$'\n'
        local iva_count iva_files
        iva_count=$(grep -rEn "\\|\\|[[:space:]]*21([^0-9]|$)|COALESCE\\([^,]+,[[:space:]]*21\\)" \
            "${PROJECT_ROOT}/src" --include="*.js" 2>/dev/null | wc -l | tr -d '[:space:]')
        iva_files=$(grep -rElc "\\|\\|[[:space:]]*21([^0-9]|$)|COALESCE\\([^,]+,[[:space:]]*21\\)" \
            "${PROJECT_ROOT}/src" --include="*.js" 2>/dev/null | grep -v ":0$" | wc -l | tr -d '[:space:]')
        _out+="- ocurrencias: ${iva_count:-0} en ${iva_files:-0} archivos (esperado: 0)"$'\n'
        # [v68 FIX-06] Mostrar top 5 paths para que Claude pueda actuar
        if [ "${iva_count:-0}" -gt 0 ] 2>/dev/null; then
            local iva_top
            iva_top=$(grep -rEn "\\|\\|[[:space:]]*21([^0-9]|$)|COALESCE\\([^,]+,[[:space:]]*21\\)" \
                "${PROJECT_ROOT}/src" --include="*.js" 2>/dev/null | head -5)
            if [ -n "$iva_top" ]; then
                _out+="- top 5 ocurrencias:"$'\n'
                while IFS= read -r line; do
                    [ -z "$line" ] && continue
                    _out+="    \`${line#${PROJECT_ROOT}/}\`"$'\n'
                done <<< "$iva_top"
            fi
        fi
        _out+=""$'\n'

        # 3.4 Remitos anulados con id_viaje pegado en viajes finalizados
        _out+="### 3.2 Remitos anulados con id_viaje pegado (viajes finalizados)"$'\n'
        local rp
        rp=$(_run_sql "
            SELECT COUNT(*) FROM remitos r
            JOIN viajes v ON r.id_viaje = v.id_viaje
            WHERE r.estado = 'anulado' AND v.estado = 'finalizado'
        ")
        _out+="- cantidad: ${rp:-0}"$'\n'
        if [ "${rp:-0}" -gt 0 ] 2>/dev/null; then
            local rp_ids
            rp_ids=$(_run_sql "
                SELECT string_agg(r.id_remito::text, ', ' ORDER BY r.id_remito)
                FROM remitos r
                JOIN viajes v ON r.id_viaje = v.id_viaje
                WHERE r.estado = 'anulado' AND v.estado = 'finalizado'
            ")
            _out+="- ids_remito: ${rp_ids}"$'\n'
        fi
        _out+=""$'\n'

        # 3.5 Stock negativo
        _out+="### 3.3 Stock negativo"$'\n'
        local sn
        sn=$(_run_sql "SELECT COUNT(*) FROM inventario WHERE stock_real < 0")
        _out+="- registros: ${sn:-0}"$'\n'
        if [ "${sn:-0}" -gt 0 ] 2>/dev/null; then
            local sn_top
            # Detectar columna real (descripcion no existe en productos)
            local prod_name_col
            prod_name_col=$(_run_sql "
                SELECT column_name FROM information_schema.columns
                WHERE table_name='productos'
                  AND column_name IN ('nombre','descripcion','denominacion','razon_social')
                ORDER BY CASE column_name
                    WHEN 'nombre' THEN 1
                    WHEN 'denominacion' THEN 2
                    WHEN 'descripcion' THEN 3
                    ELSE 4 END
                LIMIT 1")
            [ -z "$prod_name_col" ] && prod_name_col="id_producto"
            sn_top=$(_run_sql "
                SELECT i.id_producto || ' (' || COALESCE(p.${prod_name_col}::text, '?') || '): ' || i.stock_real
                FROM inventario i
                LEFT JOIN productos p ON i.id_producto = p.id_producto
                WHERE i.stock_real < 0
                ORDER BY i.stock_real ASC
                LIMIT 5
            ")
            while IFS= read -r s; do [ -n "$s" ] && _out+="  - $s"$'\n'; done <<< "$sn_top"
        fi
        _out+=""$'\n'

        # 3.6 Pagos.origen residuales
        _out+="### 3.4 Distribucion pagos.origen"$'\n'
        local pg_origen
        pg_origen=$(_run_sql "
            SELECT COALESCE(origen, '(NULL)') || ': ' || COUNT(*)
            FROM pagos GROUP BY origen ORDER BY COUNT(*) DESC
        ")
        if [ -n "$pg_origen" ]; then
            while IFS= read -r po; do [ -n "$po" ] && _out+="- $po"$'\n'; done <<< "$pg_origen"
        fi
        _out+=""$'\n'
    else
        _out+="- [SKIP] BD no disponible"$'\n'$'\n'
    fi

    # ============================================================
    # 4. DRIFT (codigo vs documentado)
    # ============================================================
    _out+="## 4. DRIFT — codigo vs documentado"$'\n'$'\n'

    if [ -d "${UTILS_DIR:-}" ]; then
        # 4.1 Cobertura @scope
        local total_h scope_h
        total_h=$(find "$UTILS_DIR" -maxdepth 1 -name "*.helper.js" -type f 2>/dev/null | wc -l | tr -d '[:space:]')
        scope_h=$(grep -l "@scope" "$UTILS_DIR"/*.helper.js 2>/dev/null | wc -l | tr -d '[:space:]')
        _out+="### 4.1 Cobertura @scope"$'\n'
        _out+="- helpers con @scope declarado: ${scope_h}/${total_h}"$'\n'
        # [v69] La convencion @scope nunca se adopto (adopcion ~0). Listar 67 helpers
        # "sin marcador" es ruido no accionable: solo se lista si la adopcion es >=50%.
        # El Check 5 (firmas) ya AUTO-DETECTA stateless, asi que el "default=enterprise"
        # no implica trabajo pendiente.
        if [ "${total_h:-0}" -gt 0 ] && [ "${scope_h:-0}" -eq "${total_h}" ]; then
            _out+="- [OK] todos los helpers declaran @scope"$'\n'
        elif [ "${total_h:-0}" -gt 0 ] && [ "${scope_h:-0}" -ge 1 ] && [ "$(( scope_h * 2 ))" -ge "${total_h}" ]; then
            local sin_scope
            sin_scope=$(comm -23 \
                <(find "$UTILS_DIR" -maxdepth 1 -name "*.helper.js" -type f -exec basename {} \; 2>/dev/null | sort) \
                <(grep -l "@scope" "$UTILS_DIR"/*.helper.js 2>/dev/null | xargs -n1 basename 2>/dev/null | sort))
            local n_sin
            n_sin=$(echo "$sin_scope" | grep -c '^.' 2>/dev/null || echo 0)
            n_sin=$(echo "$n_sin" | tr -d '[:space:]')
            _out+="- helpers sin marcador (default=enterprise):"$'\n'
            local cnt=0
            while IFS= read -r h; do
                [ -z "$h" ] && continue
                _out+="  - $h"$'\n'
                cnt=$((cnt + 1))
                [ "$cnt" -ge 10 ] && _out+="  - (...y mas, total ${n_sin})"$'\n' && break
            done <<< "$sin_scope"
        else
            _out+="- convencion @scope opcional / poco adoptada (${scope_h}/${total_h}) -> no se lista el resto (ruido). El Check 5 auto-detecta stateless."$'\n'
        fi
        _out+=""$'\n'

        # 4.2 Helpers que mienten su @scope
        _out+="### 4.2 Helpers que mienten su @scope"$'\n'
        local mentirosos=""
        for h in "$UTILS_DIR"/*.helper.js; do
            [ -f "$h" ] || continue
            local scope_dec
            scope_dec=$(grep -oE "@scope[[:space:]]+[a-z-]+" "$h" 2>/dev/null | head -1 | awk '{print $2}')
            [ -z "$scope_dec" ] && continue
            if [ "$scope_dec" = "stateless" ] || [ "$scope_dec" = "pure" ]; then
                if grep -qE "client\.query|await[[:space:]]+pool|await[[:space:]]+db" "$h" 2>/dev/null; then
                    mentirosos+="  - $(basename "$h"): @scope=${scope_dec} pero hace queries"$'\n'
                fi
            fi
        done
        if [ -n "$mentirosos" ]; then
            _out+="${mentirosos}"
        else
            _out+="- [OK] Ningun helper miente su @scope"$'\n'
        fi
        _out+=""$'\n'
    fi

    # 4.3 Configs en codigo vs en BD
    if verificar_bd 2>/dev/null && [ -d "${PROJECT_ROOT}/src" ]; then
        _out+="### 4.3 Config keys: en codigo vs en BD"$'\n'
        local keys_codigo keys_bd missing
        # [v65-FIX] Antes el grep era laxo: tomaba "cliente", "id_cliente", "compras."
        # como si fueran config keys. Ahora exige formato "namespace.subkey" con punto
        # y al menos 2 letras de cada lado (descarta sufijos sueltos).
        keys_codigo=$(grep -rohE "['\"]([a-z][a-z_]+(\\.[a-z][a-z_]+)+)['\"]" "${PROJECT_ROOT}/src" --include="*.js" 2>/dev/null \
            | grep -E "(tesoreria\\.|cc\\.|despachos\\.|venta_rapida\\.|web\\.|afip\\.|productos\\.|compras\\.|presupuestos\\.|caja\\.|cobranza\\.|borrador\\.|importacion\\.|notas\\.)" \
            | grep -vE "\.(html|js|mjs|cjs|json|css|scss|xlsx|xls|md|png|jpe?g|svg|txt|csv|pdf|ico|map|woff2?|ttf|helper|controller|routes|middleware|service|model|test)['\"]" \
            | sed -E "s/['\"]//g" | sort -u)
        local n_codigo n_bd
        n_codigo=$(echo "$keys_codigo" | grep -c '^.' || echo 0)
        n_bd=$(_run_sql "SELECT COUNT(DISTINCT clave) FROM configuraciones_empresa")
        _out+="- claves config-like en codigo: ${n_codigo}"$'\n'
        _out+="- claves en configuraciones_empresa: ${n_bd}"$'\n'
        # Claves citadas en codigo PERO ausentes en BD (potencial bug)
        if [ -n "$keys_codigo" ]; then
            local keys_bd_list
            keys_bd_list=$(_run_sql "SELECT DISTINCT clave FROM configuraciones_empresa ORDER BY clave")
            local faltantes=""
            local checked=0
            while IFS= read -r k; do
                [ -z "$k" ] && continue
                checked=$((checked + 1))
                [ "$checked" -gt 200 ] && break
                if ! echo "$keys_bd_list" | grep -qx "$k"; then
                    faltantes+="  - $k"$'\n'
                fi
            done <<< "$keys_codigo"
            if [ -n "$faltantes" ]; then
                local n_falt
                n_falt=$(echo "$faltantes" | grep -c '^.' || echo 0)
                _out+="- claves citadas en codigo pero ausentes en BD: ${n_falt}"$'\n'
                _out+="  (las primeras 10):"$'\n'
                _out+="$(echo "$faltantes" | head -10)"
            else
                _out+="- [OK] todas las claves del codigo existen en BD"$'\n'
            fi
        fi
        _out+=""$'\n'
    fi

    # ============================================================
    # 5. LIMPIEZA PENDIENTE
    # ============================================================
    _out+="## 5. LIMPIEZA PENDIENTE"$'\n'$'\n'

    # 5.1 .bak* en src/
    if [ -d "${PROJECT_ROOT}/src" ]; then
        local baks
        baks=$(find "${PROJECT_ROOT}/src" -name "*.bak*" -type f 2>/dev/null | wc -l | tr -d '[:space:]')
        _out+="### 5.1 Archivos .bak* en src/"$'\n'
        _out+="- cantidad: ${baks}"$'\n'
        if [ "${baks:-0}" -gt 0 ] 2>/dev/null; then
            local bak_top
            bak_top=$(find "${PROJECT_ROOT}/src" -name "*.bak*" -type f 2>/dev/null | head -10)
            while IFS= read -r b; do
                [ -z "$b" ] && continue
                _out+="  - ${b#${PROJECT_ROOT}/}"$'\n'
            done <<< "$bak_top"
        fi
        _out+=""$'\n'
    fi

    # 5.2 Directorios legacy
    _out+="### 5.2 Directorios candidatos a archivar"$'\n'
    local legacy_found=0
    for legacy in "_codigo_muerto_20260227" "mi_erpConTesoreria100Funcional" "_archive" "compras_module"; do
        if [ -d "${PROJECT_ROOT}/${legacy}" ]; then
            local sz mtime
            sz=$(du -sh "${PROJECT_ROOT}/${legacy}" 2>/dev/null | awk '{print $1}')
            mtime=$(stat -c '%y' "${PROJECT_ROOT}/${legacy}" 2>/dev/null | cut -d' ' -f1)
            _out+="- ${legacy}: ${sz} (ultima mod: ${mtime})"$'\n'
            legacy_found=1
        fi
    done
    [ "$legacy_found" = "0" ] && _out+="- [OK] Ningun directorio legacy detectado"$'\n'
    _out+=""$'\n'

    # 5.3 Tablas _backup_*
    if verificar_bd 2>/dev/null; then
        _out+="### 5.3 Tablas _backup_* en BD"$'\n'
        local bak_tables_list
        bak_tables_list=$(_run_sql "
            SELECT table_name || ': ' || COALESCE(pg_size_pretty(pg_total_relation_size('public.'||table_name)),'?')
            FROM information_schema.tables
            WHERE table_schema='public' AND table_name LIKE '\\_backup\\_%'
            ORDER BY table_name
        ")
        if [ -z "$bak_tables_list" ]; then
            _out+="- [OK] Ninguna tabla _backup_*"$'\n'
        else
            while IFS= read -r t; do [ -n "$t" ] && _out+="- $t"$'\n'; done <<< "$bak_tables_list"
        fi
        _out+=""$'\n'
    fi

    # 5.4 Crontab activo (sin filtrado de secrets)
    _out+="### 5.4 Crontab activo (lineas no comentadas)"$'\n'
    if command -v crontab >/dev/null 2>&1; then
        local cron_lines
        cron_lines=$(crontab -l 2>/dev/null | grep -vE '^[[:space:]]*#|^[[:space:]]*$' | wc -l | tr -d '[:space:]')
        _out+="- entradas activas: ${cron_lines}"$'\n'
        if [ "${cron_lines:-0}" -gt 0 ] 2>/dev/null; then
            _out+='```'$'\n'
            _out+="$(crontab -l 2>/dev/null | grep -vE '^[[:space:]]*#|^[[:space:]]*$' | sed 's/PASSWORD=[^ ]*/PASSWORD=***/g; s/PGPASSWORD=[^ ]*/PGPASSWORD=***/g')"$'\n'
            _out+='```'$'\n'
        fi
    fi
    _out+=""$'\n'

    # ============================================================
    # 6. SESIONES RECIENTES DOCUMENTADAS
    # ============================================================
    _out+="## 6. ULTIMAS SESIONES DOCUMENTADAS (docs/sesiones/)"$'\n'$'\n'
    if [ -d "${PROJECT_ROOT}/docs/sesiones" ]; then
        local ses_files
        ses_files=$(ls -t "${PROJECT_ROOT}/docs/sesiones"/*.md 2>/dev/null | head -8)
        if [ -n "$ses_files" ]; then
            while IFS= read -r s; do
                [ -z "$s" ] && continue
                local mtime sz lines
                mtime=$(stat -c '%y' "$s" 2>/dev/null | cut -d. -f1)
                sz=$(du -h "$s" 2>/dev/null | awk '{print $1}')
                lines=$(wc -l < "$s" 2>/dev/null | tr -d '[:space:]')
                _out+="- $(basename "$s") (${mtime}, ${sz}, ${lines} lineas)"$'\n'
            done <<< "$ses_files"
        else
            _out+="- (sin .md en docs/sesiones)"$'\n'
        fi
    else
        _out+="- (directorio docs/sesiones no existe)"$'\n'
    fi
    _out+=""$'\n'

    # Modulos documentados — busca tanto docs/modulos/ (vigente) como
    # docs/sesiones/ (legacy) para no perder nada.
    if [ -d "${PROJECT_ROOT}/docs/modulos" ] || [ -d "${PROJECT_ROOT}/docs/sesiones" ]; then
        _out+="### Modulos con doc canonica (re-leer antes de tocar)"$'\n'
        local _hay=0
        if [ -d "${PROJECT_ROOT}/docs/modulos" ]; then
            local md
            for md in "${PROJECT_ROOT}/docs/modulos"/*.md; do
                [ -f "$md" ] || continue
                _out+="- \`docs/modulos/$(basename "$md")\` (canonico)"$'\n'
                _hay=1
            done
        fi
        if [ -d "${PROJECT_ROOT}/docs/sesiones" ]; then
            local md2
            for md2 in "${PROJECT_ROOT}/docs/sesiones"/MODULO_*.md "${PROJECT_ROOT}/docs/sesiones"/DOCUMENTACION_*.md; do
                [ -f "$md2" ] || continue
                _out+="- \`docs/sesiones/$(basename "$md2")\` (legacy)"$'\n'
                _hay=1
            done
        fi
        [ "$_hay" -eq 0 ] && _out+="- _ninguna doc canonica encontrada_"$'\n'
        _out+=""$'\n'
    fi

    # ============================================================
    # 7. SELF-CHECK DEL TOOLKIT
    # ============================================================
    _out+="## 7. SELF-CHECK DEL TOOLKIT"$'\n'$'\n'
    local self_path="${BASH_SOURCE[0]}"
    if [ -f "$self_path" ]; then
        if bash -n "$self_path" 2>/dev/null; then
            _out+="- [OK] bash -n del toolkit pasa"$'\n'
        else
            _out+="- [FAIL] bash -n del toolkit FALLA"$'\n'
        fi
        local sl
        sl=$(wc -l < "$self_path" 2>/dev/null | tr -d '[:space:]')
        _out+="- toolkit: ${sl} lineas"$'\n'
    fi

    # Ultimo informe completo generado
    _out+="- ultimo informe completo: "
    local ultimo
    ultimo=$(ls -t "${OUTPUT_DIR}"/INFORME_COMPLETO_*.md 2>/dev/null | head -1)
    if [ -n "$ultimo" ]; then
        local ult_age
        ult_age=$(stat -c '%y' "$ultimo" 2>/dev/null | cut -d. -f1)
        _out+="$(basename "$ultimo") (${ult_age})"$'\n'
    else
        _out+="(no hay)"$'\n'
    fi
    _out+=""$'\n'


    # ============================================================
    # 8. HELPERS QUE PISAN OTROS HELPERS (deuda tecnica invisible)
    # ============================================================
    # Detecta cuando un helper escribe a una tabla cuyo dueño canonico
    # es OTRO helper. Por ejemplo: tesoreria.helper escribiendo a
    # movimientos_caja cuando caja.helper es el dueño.
    _out+="## 8. HELPERS QUE PISAN OTROS HELPERS"$'\n'$'\n'
    if [ -d "${UTILS_DIR:-}" ] && verificar_bd 2>/dev/null; then
        # Para cada tabla con id_empresa que tenga un helper "matcheable",
        # ver si OTROS helpers tambien le escriben.
        local tablas_principales="movimientos_caja turnos_caja pedidos pagos pagosaproveedores recibos cuentacorrienteclientes cuentacorrienteproveedores remitos viajes facturas comprobantes_compra inventario productos producto_proveedor"
        local hallazgos=0
        for tbl in $tablas_principales; do
            # [v67.2-FIX] Solo considerar helpers que ESCRIBEN a la tabla.
            # Antes pasabamos todos los *.helper.js -> el scorer elegia por
            # similitud lexica (movimientos-stock.helper para movimientos_caja
            # cuando caja.helper es el dueno real). Ahora alineamos con
            # RASTREO §10: filtrar primero, scorear despues.
            local helpers_que_escriben_tbl
            helpers_que_escriben_tbl=$(grep -rlE "INSERT INTO ${tbl}\b|UPDATE ${tbl}\b|DELETE FROM ${tbl}\b" \
                "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | sort -u)

            # Si nadie escribe, no hay deuda que reportar
            [ -z "$helpers_que_escriben_tbl" ] && continue

            # Si solo escribe uno, ese es el canonico y no hay invasores
            local n_escriben
            n_escriben=$(echo "$helpers_que_escriben_tbl" | wc -l)
            [ "$n_escriben" -lt 2 ] && continue

            # Hay 2+ escritores: elegir canonico con el mismo scorer que RASTREO §10
            local hp_canon
            hp_canon=$(_elegir_helper_canonico "$tbl" "$helpers_que_escriben_tbl")

            # Si el scorer no eligio (ningun match >=4), tomar el de mas writes
            if [ -z "$hp_canon" ]; then
                hp_canon=$(while IFS= read -r hp; do
                    [ -z "$hp" ] && continue
                    local cnt
                    cnt=$(grep -cE "INSERT INTO ${tbl}\b|UPDATE ${tbl}\b|DELETE FROM ${tbl}\b" "$hp" 2>/dev/null)
                    [ -z "$cnt" ] && cnt=0
                    echo "$cnt $hp"
                done <<< "$helpers_que_escriben_tbl" | sort -rn | head -1 | awk '{print $2}')
            fi

            [ -z "$hp_canon" ] && continue

            # Invasores = los que escriben pero no son el canonico
            local invasores
            invasores=$(echo "$helpers_que_escriben_tbl" | grep -v "^${hp_canon}\$" | xargs -n1 basename 2>/dev/null | sort -u)

            if [ -n "$invasores" ]; then
                hallazgos=$((hallazgos + 1))
                _out+="- **${tbl}** (canonico: $(basename "$hp_canon"))"$'\n'
                while IFS= read -r inv; do
                    [ -n "$inv" ] && _out+="    - ${inv} pisa la tabla → deberia delegar"$'\n'
                done <<< "$invasores"
            fi
        done
        if [ "$hallazgos" -eq 0 ]; then
            _out+="- [OK] Ningun helper pisa la tabla de otro"$'\n'
        fi
    else
        _out+="- [SKIP] BD no disponible o utils dir no existe"$'\n'
    fi
    _out+=""$'\n'

    _out+="---"$'\n'
    _out+="*Generado por Toolkit v${VERSION} - $(date '+%Y-%m-%d %H:%M')*"$'\n'

    if [ -n "$destino" ]; then
        echo "$_out" >> "$destino"
    else
        echo "$_out" > "$OUT"
        echo -e "${GREEN}[OK] EXTRA generado: $OUT${NC}"
        echo ""
        echo -e "${CYAN}Resumen rapido en pantalla:${NC}"
        echo "$_out" | grep -E "^### |^- \[WARN\]|^- \[FAIL\]|^- cantidad:|^- monto" | head -25
    fi
}


# =======================================================================================
# DETALLE COMPLETO — Todas las opciones CLI en una sola pasada
# =======================================================================================
# Ejecuta TODAS las opciones que normalmente se acceden via CLI directa
# (helpers, migracion, flujo, etc.). Cada una genera su archivo individual
# en OUTPUT_DIR + se concatena todo en DETALLE_COMPLETO_<TS>.md.
#
# Diferencia con INFORME_COMPLETO (opcion 1):
#   - INFORME_COMPLETO arma 6 documentos (CONTEXTO + ARQUITECTURA + SALUD +
#     SEGURIDAD + INTEGRIDAD + PROMPT) en un solo archivo. Pensado para
#     pegarle a un LLM al inicio de sesion.
#   - DETALLE_COMPLETO arma todas las exploraciones puntuales (helpers,
#     migracion, flujo caja, lago.ar, modulos, semilla, constraints,
#     impresion, multi-empresa, features, extra) en un solo archivo.
#     Pensado para tener TODO el detalle accionable a mano sin invocar
#     opcion por opcion.
ejecutar_todo_detalle() {
    local TS_LOCAL; TS_LOCAL=$(date '+%Y%m%d_%H%M')
    local OUT="${OUTPUT_DIR}/DETALLE_COMPLETO_${TS_LOCAL}.md"

    header
    echo -e "${YELLOW}=== DETALLE COMPLETO — todas las opciones CLI ===${NC}"
    echo ""

    cargar_credenciales
    explorar_proyecto

    # Funciones que aceptan $1=destino: las invoco con destino=archivo individual
    # y al final concateno todo en el archivo unificado.
    local cli_funcs=(
        "HELPERS:detectar_helpers_existentes"
        "MIGRACION:calcular_progreso_migracion"
        "FLUJO_CAJA:verificar_flujo_caja"
        "FEATURES:detectar_features_especiales"
        "DATOS_SEMILLA:verificar_datos_semilla"
        "CONSTRAINTS:verificar_constraints_triggers"
        "IMPRESION:verificar_sistema_impresion"
        "LAGO_AR:verificar_lago_ar"
        "MULTIEMPRESA_AUDITORIA:verificar_auditoria_multiempresa"
        "MULTIEMPRESA_ESTADO:detectar_estado_multiempresa"
        "EXTRA:extraer_extras"
    )

    local total=$(( ${#cli_funcs[@]} + 1 ))   # +1 por listar_modulos al final
    local i=0
    declare -a archivos_generados=()

    for entry in "${cli_funcs[@]}"; do
        i=$((i + 1))
        local nombre="${entry%%:*}"
        local fn="${entry##*:}"
        echo -e "  ${CYAN}[${i}/${total}]${NC} ${nombre}..."
        local TS_F; TS_F=$(date '+%Y%m%d_%H%M%S')
        local F="${OUTPUT_DIR}/${nombre}_${TS_F}.md"
        {
            echo "# ${nombre}"
            echo "## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}"
            echo ""
        } > "$F"
        "$fn" "$F" 2>/dev/null || echo "(error en ${fn})" >> "$F"
        # Dedup defensivo: si la funcion escribio su propio header
        # (mas largo que el del wrapper), eliminar el header generico.
        if [ -f "$F" ]; then
            awk '
                BEGIN { skip_first_h1 = 0; first_h1_line = 0; second_h1_line = 0; line_num = 0 }
                { line_num++; lines[line_num] = $0 }
                /^# / && first_h1_line == 0 { first_h1_line = line_num; first_h1 = $0; next }
                /^# / && first_h1_line > 0 && second_h1_line == 0 {
                    second_h1_line = line_num
                    if (length($0) > length(first_h1)) { skip_first_h1 = 1 }
                }
                END {
                    for (j = 1; j <= line_num; j++) {
                        if (skip_first_h1 && j == first_h1_line) continue
                        if (skip_first_h1 && j == first_h1_line + 1 && lines[j] ~ /^## Generado:/) continue
                        if (skip_first_h1 && j == first_h1_line + 2 && lines[j] == "") continue
                        print lines[j]
                    }
                }
            ' "$F" > "${F}.dedup" && mv "${F}.dedup" "$F"
        fi
        archivos_generados+=("$F")
    done

    # listar_modulos no acepta destino — capturamos stdout con filtro ANSI
    i=$((i + 1))
    echo -e "  ${CYAN}[${i}/${total}]${NC} MODULOS..."
    local TS_M; TS_M=$(date '+%Y%m%d_%H%M%S')
    local FM="${OUTPUT_DIR}/MODULOS_${TS_M}.md"
    {
        echo "# MODULOS"
        echo "## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}"
        echo ""
        # Filtro ANSI literal (probado: ESC se pierde antes de llegar)
        listar_modulos 2>&1 | sed -E '
            s/\[H\[2J\[3J//g
            s/\[H\[2J//g
            s/\[2J//g
            s/\[3J//g
            s/\[H//g
            s/\[[0-9]+(;[0-9]+)*m//g
            s/'"$(printf '\033')"'\[[0-9;]*[a-zA-Z]//g
        '
    } > "$FM"
    archivos_generados+=("$FM")

    # Concatenacion final
    cat > "$OUT" << HEAD_EOF
# DETALLE COMPLETO ERP LAGO
## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}

Concatena todas las opciones CLI en un solo archivo. Cada seccion tambien
quedo guardada como archivo individual en \`${OUTPUT_DIR}/\`.

---

HEAD_EOF

    for f in "${archivos_generados[@]}"; do
        if [ -f "$f" ]; then
            echo "" >> "$OUT"
            echo "---" >> "$OUT"
            echo "" >> "$OUT"
            cat "$f" >> "$OUT"
            echo "" >> "$OUT"
        fi
    done

    local LINEAS; LINEAS=$(wc -l < "$OUT" 2>/dev/null | tr -d '[:space:]')
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}[OK] DETALLE COMPLETO generado${NC}"
    echo -e "${GREEN}     Archivo unico: $OUT${NC}"
    echo -e "${GREEN}     Lineas: ${LINEAS}${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${CYAN}Archivos individuales tambien disponibles en:${NC}"
    echo -e "  ${OUTPUT_DIR}/"
    for f in "${archivos_generados[@]}"; do
        [ -f "$f" ] && echo -e "  - $(basename "$f")"
    done
    echo ""
}


# =======================================================================================
# CHANGELOG inline
# =======================================================================================
mostrar_changelog() {
    cat << 'CHGLOG'

================================================================
  TOOLKIT ERP LAGO — Changelog consolidado
================================================================

v65.0 (2026-05)
  ~ BUGFIX (6) detectados al revisar output real de v64:
    - MODULOS_*.md tenia ANSI escape codes crudos por culpa de header() clear
      -> _ejecutar_capturando_stdout ahora filtra escape sequences con sed
    - EXTRA_*.md tenia DOBLE header (wrapper + funcion)
      -> dedup defensivo + funciones aceptan que el wrapper escriba el header
    - FLUJO_CAJA: 'Cajas activas: 0' cuando habia turno abierto
      -> deteccion dinamica de columna activa/activo/habilitada
    - FLUJO_CAJA: 'movimientos por origen' salia vacio
      -> JOIN pagos via id_pago detectado dinamicamente, no asumido
    - FLUJO_CAJA: 'codigos de error' salia vacio
      -> reescrito con grep -oE simple, sin sed con escape de comillas
    - EXTRA 4.3: falsos positivos masivos (cliente, id_cliente, compras.)
      -> regex exige formato 'namespace.subkey' real con punto interno

v64.0 (2026-05)
  ~ BUGFIX self-doc: TOOLKIT_INTERNAL.md se cortaba en seccion 1 porque el
                     heredoc SECTION2 estaba sin quotear y los \`\`\` (tres
                     backticks consecutivos) bash los trataba como command
                     substitution. Fix: heredoc quoted ('SECTION2') + heredoc
                     chico unquoted al final solo para la linea con timestamp.

v63.0 (2026-05)
  + Comando self-doc:   genera TOOLKIT_INTERNAL.md (tabla de funciones,
                        mapeo aliases->archivos, flow ASCII del informe)
  + Comando changelog:  muestra esta lista
  + Comando cleanup-old-versions: archiva toolkit_v*.sh viejos a _old_toolkits/
  + _run_sql con timeout 10s (evita cuelgues por locks/queries lentas)
                        Configurable via env var TOOLKIT_SQL_TIMEOUT
  + Header muestra el path real del script ejecutado (debug multi-version)

v62.0 (2026-05)
  + Opcion 6 "Detalle CLI": ejecuta TODAS las opciones CLI en una pasada,
                            genera archivos individuales + DETALLE_COMPLETO_*.md
  + Wrappers _ejecutar_y_guardar y _ejecutar_capturando_stdout
  + Cada alias CLI genera archivo individual en OUTPUT_DIR
  - Sacado del EXTRA: huerfanos contables (3.1, 3.2). Se regularizan
                      desde el frontend, no desde monitoreo automatico
  ~ EXTRA seccion 3 renombrada a "DRIFT TECNICO DETECTABLE"
                    (IVA hardcoded + remitos pegados + stock neg + pagos.origen)

v61.0 (2026-05)
  + Menu reducido de 19 a 5 opciones visibles (era ruido)
  + Opciones 6-20 viejas accesibles solo via alias texto en CLI
  + Banner: "Solution Architect Mode"

v60.0 (2026-04)
  + Opcion 20 "Flujo caja": jerarquia empresa->usuario->deposito->caja->turno
  + Check usuario_configuracion UNIQUE multi-empresa (BUG LATENTE conocido)
  + prompt_maestro inyecta seccion FLUJO CAJA + lista MODULO_*.md
  ~ Fix bug "[: 0\\n0: integer expression expected" en verificar_lago_ar
  ~ Fix detectar_helpers_existentes: ahora ve consumers helper-to-helper
  ~ Fix calcular_progreso_migracion: distingue MIGRADO/PARCIAL real

v59.0 y anteriores
  Ver historial de versiones documentado en docs/sesiones/ del proyecto

================================================================
CHGLOG
}


# =======================================================================================
# SELF-DOC: documentacion interna auto-generada del toolkit
# =======================================================================================
generar_self_doc() {
    local OUT="${OUTPUT_DIR}/TOOLKIT_INTERNAL.md"
    local self="${BASH_SOURCE[0]}"

    if [ ! -f "$self" ]; then
        echo -e "${RED}[ERROR] No se puede leer el script ($self)${NC}"
        return 1
    fi

    cat > "$OUT" << HEAD_EOF
# TOOLKIT ERP LAGO — Documentacion interna auto-generada
## Toolkit v${VERSION} | Generado: $(date '+%Y-%m-%d %H:%M')
## Script: $self

> Auto-extraido del propio toolkit. NO editar manualmente.
> Para regenerar: \`./$(basename "$self") self-doc\`

---

## 1. FUNCIONES DEFINIDAS (orden de aparicion)

| # | Funcion | Linea | Archivo |
|---|---------|-------|---------|
HEAD_EOF

    local i=0
    while IFS=: read -r linea decl; do
        [ -z "$linea" ] && continue
        local fn; fn=$(echo "$decl" | sed 's/().*//')
        local prev=$((linea - 1))
        local comment=""
        comment=$(sed -n "${prev}p" "$self" | grep -E '^[[:space:]]*##' | sed 's/^[[:space:]]*##[[:space:]]*//' | head -c 80)
        i=$((i + 1))
        # Antes mostraba "Comentario previo" siempre vacio. Ahora
        # mostramos el archivo de origen (util si en el futuro se modulariza).
        echo "| $i | \`$fn()\` | $linea | $(basename "$self") |" >> "$OUT"
    done < <(grep -nE '^[a-z_]+\(\)[[:space:]]*\{' "$self")

    # [v64-FIX] heredoc QUOTED (delimiter entre comillas) -> contenido literal
    # Sin esto, los \`\`\` y los \$VERSION dentro del markdown rompian el cat.
    cat >> "$OUT" << 'SECTION2'

---

## 2. ALIASES CLI -> FUNCION -> ARCHIVO GENERADO

### Menu visual (1-6)

| Opcion | Alias | Funcion | Archivo |
|--------|-------|---------|---------|
| 1 | `completo`, `informe`, `todo` | `informe_completo` | `INFORME_COMPLETO_<TS>.md` |
| 2 | `auditar <mod>` | `auditar_modulo` | `AUDITORIA_<mod>_<TS>.md` |
| 3 | `rastrear <tabla>` | `rastrear_uso_tabla` | `RASTREO_<tabla>_<TS>.md` |
| 4 | `extra`, `runtime`, `drift` | `extraer_extras` | `EXTRA_<TS>.md` |
| 5 | `tendencia`, `historico` | `mostrar_tendencia` | (en pantalla) |
| 6 | `detalle`, `cli-todo` | `ejecutar_todo_detalle` | `DETALLE_COMPLETO_<TS>.md` + individuales |

### CLI directa (no en menu visual)

| Alias | Funcion | Archivo | Wrapper |
|-------|---------|---------|---------|
| `helpers` | `detectar_helpers_existentes` | `HELPERS_<TS>.md` | `_ejecutar_y_guardar` |
| `migracion` | `calcular_progreso_migracion` | `MIGRACION_<TS>.md` | `_ejecutar_y_guardar` |
| `flujo` | `verificar_flujo_caja` | `FLUJO_CAJA_<TS>.md` | `_ejecutar_y_guardar` |
| `features` | `detectar_features_especiales` | `FEATURES_<TS>.md` | `_ejecutar_y_guardar` |
| `semilla` | `verificar_datos_semilla` | `DATOS_SEMILLA_<TS>.md` | `_ejecutar_y_guardar` |
| `constraints` | `verificar_constraints_triggers` | `CONSTRAINTS_<TS>.md` | `_ejecutar_y_guardar` |
| `impresion` | `verificar_sistema_impresion` | `IMPRESION_<TS>.md` | `_ejecutar_y_guardar` |
| `lago` | `verificar_lago_ar` | `LAGO_AR_<TS>.md` | `_ejecutar_y_guardar` |
| `multiempresa` | `verificar_auditoria_multiempresa` | `MULTIEMPRESA_AUDITORIA_<TS>.md` | `_ejecutar_y_guardar` |
| `modulos` | `listar_modulos` | `MODULOS_<TS>.md` | `_ejecutar_capturando_stdout` |
| `seguridad` | `auditar_seguridad` | `SEGURIDAD_<TS>.md` | (genera archivo propio) |
| `integridad` | `verificar_integridad_referencial` | `INTEGRIDAD_REFERENCIAL.md` | (genera archivo propio) |
| `prompt` | `prompt_maestro` | `PROMPT_MAESTRO.md` | (genera archivo propio) |
| `contexto` | `generar_contexto_ia` | `CONTEXTO_IA_<TS>.md` | (genera archivo propio) |
| `arquitectura` | `documentar_arquitectura_negocio` | `ARQUITECTURA_NEGOCIO.md` | (genera archivo propio) |
| `salud` | `generar_informe_salud` | `SALUD_ARQUITECTONICA.md` | (genera archivo propio) |

### Comandos sistema (v63+)

| Alias | Funcion | Archivo |
|-------|---------|---------|
| `self-doc` | `generar_self_doc` | `TOOLKIT_INTERNAL.md` (este archivo) |
| `changelog` | `mostrar_changelog` | (en pantalla) |
| `cleanup-old-versions` | `cleanup_old_toolkit_versions` | (mueve archivos a `_old_toolkits/`) |
| `versiones` | `extraer_versiones_runtime` | (en pantalla) |
| `help`, `-h`, `--help` | `mostrar_ayuda` | (en pantalla) |

---

## 3. FLOW DEL INFORME COMPLETO (opcion 1)

```
informe_completo()
    |
    +-- [1/6] generar_contexto_ia()             -> CONTEXTO_IA_<TS>.md       (PARTE 1)
    +-- [2/6] documentar_arquitectura_negocio() -> ARQUITECTURA_NEGOCIO.md   (PARTE 2)
    +-- [3/6] generar_informe_salud()           -> SALUD_ARQUITECTONICA.md   (PARTE 3)
    +-- [4/6] auditar_seguridad()               -> SEGURIDAD_<TS>.md         (PARTE 4)
    +-- [5/6] verificar_integridad_referencial()-> INTEGRIDAD_REFERENCIAL.md (PARTE 5)
    +-- [6/6] prompt_maestro()                  -> PROMPT_MAESTRO.md         (PARTE 6)
    |
    +-- concatena todo -> INFORME_COMPLETO_<TS>.md
```

## 4. FLOW DEL DETALLE CLI (opcion 6)

```
ejecutar_todo_detalle()
    |
    +-- HELPERS, MIGRACION, FLUJO_CAJA, FEATURES, DATOS_SEMILLA,
    |   CONSTRAINTS, IMPRESION, LAGO_AR, MULTIEMPRESA_AUDITORIA,
    |   MULTIEMPRESA_ESTADO, EXTRA, MODULOS
    |   (cada una genera <NOMBRE>_<TS>.md)
    |
    +-- concatena todos -> DETALLE_COMPLETO_<TS>.md
```

---

## 5. WRAPPERS DE EJECUCION

### `_ejecutar_y_guardar <NOMBRE> <funcion>`
Para funciones que aceptan $1=destino. Crea archivo con header (titulo,
fecha, version), invoca `funcion "$archivo"`, y al terminar muestra al
usuario un resumen de las primeras 30 lineas que matchean
`### / [OK] / [WARN] / [FAIL] / **Resultado`.

### `_ejecutar_capturando_stdout <NOMBRE> <funcion>`
Para funciones que solo imprimen a stdout. Captura stdout y stderr al archivo.

---

## 6. CONVENCIONES INTERNAS

- Funciones con prefijo `_` son privadas. NO se exponen en el menu ni CLI.
- `detectar_*`, `verificar_*`, `generar_*` aceptan $1 opcional como destino.
- Variables de entorno respetadas:
  - `TOOLKIT_SQL_TIMEOUT` (default 10): segundos para queries SQL
  - `PGPASSWORD`: password BD (sino lee de `.env` o default)
  - `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`: conexion BD

---

SECTION2
    # Linea final con timestamp (heredoc unquoted, expande variables)
    cat >> "$OUT" << SECTION3
*Generado por Toolkit v${VERSION} - $(date '+%Y-%m-%d %H:%M')*
SECTION3

    echo -e "${GREEN}[OK] $OUT${NC}"
    echo ""
    echo -e "${CYAN}Resumen:${NC}"
    echo -e "  Funciones documentadas: $(grep -cE '^\| [0-9]+ \|' "$OUT")"
    echo -e "  Lineas: $(wc -l < "$OUT")"
}


# =======================================================================================
# CLEANUP de versiones viejas del toolkit
# =======================================================================================
cleanup_old_toolkit_versions() {
    local script_dir="$SCRIPT_DIR"
    local archive_dir="${script_dir}/_old_toolkits"
    local current_basename
    current_basename=$(basename "${BASH_SOURCE[0]:-toolkit_v${VERSION%%.*}.sh}")

    echo -e "${CYAN}=== CLEANUP TOOLKITS VIEJOS ===${NC}"
    echo -e "  Directorio:   ${script_dir}"
    echo -e "  Archivo activo: ${current_basename}"
    echo -e "  Archivar a:   ${archive_dir}"
    echo ""

    local candidatos=()
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        local b; b=$(basename "$f")
        if [ "$b" != "$current_basename" ]; then
            candidatos+=("$f")
        fi
    done < <(find "$script_dir" -maxdepth 1 -name "toolkit_v[0-9]*.sh" -type f 2>/dev/null | sort)

    if [ "${#candidatos[@]}" -eq 0 ]; then
        echo -e "${GREEN}[OK] No hay versiones viejas para archivar${NC}"
        return 0
    fi

    echo -e "${YELLOW}Voy a mover los siguientes archivos a _old_toolkits/:${NC}"
    for c in "${candidatos[@]}"; do
        echo -e "  - $(basename "$c")"
    done
    echo ""
    read -p "  Confirmar (s/N): " conf
    if [ "$conf" != "s" ] && [ "$conf" != "S" ]; then
        echo -e "${YELLOW}[ABORTADO] No se movio nada${NC}"
        return 1
    fi

    mkdir -p "$archive_dir"
    local moved=0
    for c in "${candidatos[@]}"; do
        if mv "$c" "$archive_dir/" 2>/dev/null; then
            echo -e "${GREEN}[OK] $(basename "$c") -> _old_toolkits/${NC}"
            moved=$((moved + 1))
        else
            echo -e "${RED}[FAIL] No se pudo mover $(basename "$c")${NC}"
        fi
    done
    echo ""
    echo -e "${GREEN}[OK] Movidos $moved archivos${NC}"
}

# =======================================================================================
# INFORME COMPLETO - TODO EN UN SOLO ARCHIVO
# =======================================================================================

informe_completo() {
    local TIMESTAMP
    TIMESTAMP=$(date '+%Y%m%d_%H%M')
    local INFORME="$OUTPUT_DIR/INFORME_COMPLETO_${TIMESTAMP}.md"

    header
    echo -e "  ${GREEN}=== INFORME COMPLETO ===${NC}"
    echo -e "  Genera TODO en un solo archivo:"
    echo -e "  Contexto + Arquitectura + Salud + Seguridad + Integridad + Prompt"
    echo ""

    cargar_credenciales
    explorar_proyecto

    # Paso 1: Versiones (ya incluidas en CONTEXTO_IA, no se genera PARTE separada)
    echo -e "  ${CYAN}[1/6]${NC} Contexto IA (incluye versiones)..."
    generar_contexto_ia

    # Paso 2: Arquitectura de negocio
    echo -e "  ${CYAN}[2/6]${NC} Arquitectura de negocio..."
    documentar_arquitectura_negocio

    # Paso 3: Salud arquitectónica
    echo -e "  ${CYAN}[3/6]${NC} Salud arquitectonica..."
    generar_informe_salud

    # Paso 4: Seguridad
    echo -e "  ${CYAN}[4/6]${NC} Seguridad y control de acceso..."
    auditar_seguridad

    # Paso 5: Integridad referencial (FKs, triggers, indexes, secuencias, views)
    echo -e "  ${CYAN}[5/6]${NC} Integridad referencial..."
    verificar_integridad_referencial

    # Paso 6: Prompt maestro
    echo -e "  ${CYAN}[6/6]${NC} Prompt maestro..."
    prompt_maestro

    # === CONCATENAR TODO EN UN ARCHIVO ===
    echo ""
    echo -e "  ${YELLOW}Unificando resultados...${NC}"

    > "$INFORME"
    cat >> "$INFORME" << HEADER
# INFORME COMPLETO ERP LAGO
## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}

---

HEADER

    # PARTE 1 eliminada: versiones ya están dentro de CONTEXTO_IA

    # Sección 1: Contexto IA (incluye versiones)
    local LATEST_CONTEXTO=""
    LATEST_CONTEXTO=$(ls -t "$OUTPUT_DIR"/CONTEXTO_IA_*.md 2>/dev/null | head -1)
    if [ -n "$LATEST_CONTEXTO" ] && [ -f "$LATEST_CONTEXTO" ]; then
        echo "# PARTE 1: CONTEXTO IA" >> "$INFORME"
        echo "" >> "$INFORME"
        # Incluir todo excepto las primeras 4 lineas (header del archivo)
        tail -n +5 "$LATEST_CONTEXTO" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 2: Arquitectura de negocio
    local LATEST_ARQ="$OUTPUT_DIR/ARQUITECTURA_NEGOCIO.md"
    if [ -f "$LATEST_ARQ" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 2: ARQUITECTURA DE NEGOCIO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +5 "$LATEST_ARQ" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 3: Salud arquitectónica
    local LATEST_SALUD="$OUTPUT_DIR/SALUD_ARQUITECTONICA.md"
    if [ -f "$LATEST_SALUD" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 3: SALUD ARQUITECTONICA" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +3 "$LATEST_SALUD" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 4: Seguridad
    local LATEST_SEC=""
    LATEST_SEC=$(ls -t "$OUTPUT_DIR"/SEGURIDAD_*.md 2>/dev/null | head -1)
    if [ -n "$LATEST_SEC" ] && [ -f "$LATEST_SEC" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 4: SEGURIDAD Y CONTROL DE ACCESO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +5 "$LATEST_SEC" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 5: Integridad referencial
    local LATEST_INTEG="$OUTPUT_DIR/INTEGRIDAD_REFERENCIAL.md"
    if [ -f "$LATEST_INTEG" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 5: INTEGRIDAD REFERENCIAL" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +4 "$LATEST_INTEG" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 6: Prompt maestro (era PARTE 5 hasta v57.1)
    local LATEST_PROMPT="$OUTPUT_DIR/PROMPT_MAESTRO.md"
    if [ -f "$LATEST_PROMPT" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 6: PROMPT MAESTRO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +4 "$LATEST_PROMPT" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    local LINEAS
    LINEAS=$(wc -l < "$INFORME")

    echo ""
    echo -e "  ${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "  ${GREEN}[OK] INFORME COMPLETO generado${NC}"
    echo -e "  ${GREEN}  Archivo: $INFORME${NC}"
    echo -e "  ${GREEN}  Tamaño:  $LINEAS lineas${NC}"
    echo -e "  ${GREEN}════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${CYAN}Tambien se generaron los archivos individuales:${NC}"
    [ -n "$LATEST_CONTEXTO" ] && echo -e "    - $(basename "$LATEST_CONTEXTO")"
    echo -e "    - ARQUITECTURA_NEGOCIO.md"
    echo -e "    - SALUD_ARQUITECTONICA.md"
    [ -n "$LATEST_SEC" ] && echo -e "    - $(basename "$LATEST_SEC")"
    echo -e "    - INTEGRIDAD_REFERENCIAL.md"
    echo -e "    - PROMPT_MAESTRO.md"
    echo ""

    # Resumen rapido en pantalla
    echo -e "  ${YELLOW}═══ RESUMEN RAPIDO ═══${NC}"
    echo ""
    echo -e "  ${CYAN}HELPERS CENTRALIZADOS:${NC}"
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        local hcount=0
        while IFS= read -r hf; do
            [ -z "$hf" ] && continue
            local hn; hn=$(basename "$hf")
            local hlines; hlines=$(wc -l < "$hf" 2>/dev/null || echo "?")
            local consumers; consumers=$(grep -rl "$(basename "$hf" .js)" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
            echo -e "    ${GREEN}✓${NC} $hn (${hlines}L, ${consumers} consumers)"
            hcount=$((hcount + 1))
        done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)
        [ "$hcount" -eq 0 ] && echo -e "    ${RED}(ninguno)${NC}"
    else
        echo -e "    ${RED}(sin directorio utils)${NC}"
    fi
    echo ""
    echo -e "  ${CYAN}MIGRACION - TABLAS CON ESCRITURA DISPERSA:${NC}"
    if [ -d "$CONTROLLERS_DIR" ]; then
        local hay_dispersas=0
        while IFS= read -r linea_disp; do
            [ -z "$linea_disp" ] && continue
            local cnt_d tbl_d
            cnt_d=$(echo "$linea_disp" | awk '{print $1}')
            tbl_d=$(echo "$linea_disp" | awk '{print $2}')
            local arch_d; arch_d=$(grep -rl "INSERT INTO ${tbl_d}\|UPDATE ${tbl_d} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
            [ "$arch_d" -lt 2 ] && continue
            local helper_d=""
            # [v69-b4] Usa la fuente UNICA de canonico (solo escritores, name-matched).
            # Antes este resumen era el 3er lugar con grep|head -1 incluyendo FROM ->
            # daba pedidos->pagos.helper, clientes->carrito-web (lectores random).
            helper_d=$(_helper_canonico_de_tabla "$tbl_d")
            if [ -n "$helper_d" ]; then
                echo -e "    ${GREEN}✓${NC} $tbl_d (${cnt_d} writes, ${arch_d} archivos) → $(basename "$helper_d")"
            else
                echo -e "    ${RED}✗${NC} $tbl_d (${cnt_d} writes, ${arch_d} archivos) → ${RED}SIN HELPER${NC}"
            fi
            hay_dispersas=1
        done < <(grep -roh "INSERT INTO [a-z_]*\|UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | sed 's/INSERT INTO //; s/UPDATE //; s/ SET//' | sort | uniq -c | sort -rn | awk '$1 >= 3' || true)
        [ "$hay_dispersas" -eq 0 ] && echo -e "    ${GREEN}(ninguna tabla con 3+ writes dispersos)${NC}"
    fi
    echo ""
    echo -e "  ${YELLOW}Pega el contenido de INFORME_COMPLETO en Claude para arrancar sesion${NC}"
    echo -e "  ${CYAN}En la sesion: pedile a Claude que lea PRIMERO la GUIA DE LECTURA del PROMPT_MAESTRO${NC}"
    echo ""
}

# =======================================================================================
# MENU INTERACTIVO
# =======================================================================================

# =======================================================================================
# DISPATCHER + MENU GOOGLE-STYLE
# =======================================================================================
# Dispatcher unico: numero, alias o texto libre -> accion. Usado por menu y CLI.
# Cada accion tiene: id numerico, color, label, alias (palabras clave), funcion.
ejecutar_accion() {
    local input="$1"
    local key
    key=$(echo "$input" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')

    case "$key" in
        # ---- Estrella ----
        1|completo|todo|informe) informe_completo ;;

        # ---- Acciones del menu nuevo ----
        2|auditar|modulo|audit)
            cargar_credenciales; explorar_proyecto; echo ""
            read -p "  Modulo a auditar: " m; auditar_modulo "$m" ;;
        3|rastrear|tabla|rastreo|trace)
            cargar_credenciales; explorar_proyecto
            if [ -n "${2:-}" ]; then rastrear_uso_tabla "$2"
            elif menu_seleccionar_tabla; then rastrear_uso_tabla "$TABLA_SELECCIONADA"; fi ;;
        4|extra|runtime|deudas|drift|cleanup)
            cargar_credenciales; explorar_proyecto; extraer_extras ;;
        5|tendencia|trend|historico)
            header; cargar_credenciales; inicializar_historia; mostrar_tendencia ;;
        6|detalle|cli-todo|todo-cli|todocli|detalle-cli)
            ejecutar_todo_detalle ;;

        # ---- CLI directas (no en menu visual) ----
        prompt|maestro)
            cargar_credenciales; explorar_proyecto; prompt_maestro ;;
        contexto|ctx)
            cargar_credenciales; generar_contexto_ia ;;
        arquitectura|arq)
            cargar_credenciales; explorar_proyecto; documentar_arquitectura_negocio ;;
        salud|health)
            cargar_credenciales; explorar_proyecto; generar_informe_salud ;;

        # ---- CLI directa: cada alias genera SU archivo en OUTPUT_DIR ----
        # Funciones que ya generan archivo propio (auditar_seguridad,
        # verificar_integridad_referencial) — invocadas directo, ya devuelven .md.
        seguridad|security|sec)
            cargar_credenciales; explorar_proyecto; auditar_seguridad ;;
        integridad|fks|fk|referencial|integ)
            cargar_credenciales; explorar_proyecto; verificar_integridad_referencial ;;
        # Funciones que aceptan destino — las wrappeamos para garantizar archivo
        multiempresa|multi|me|auditoria-me|auditoriame)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "MULTIEMPRESA_AUDITORIA" verificar_auditoria_multiempresa ;;
        semilla|seed)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "DATOS_SEMILLA" verificar_datos_semilla ;;
        constraints|checks|triggers)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "CONSTRAINTS" verificar_constraints_triggers ;;
        impresion|impresiones|print)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "IMPRESION" verificar_sistema_impresion ;;
        lago|lago.ar|catalogo)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "LAGO_AR" verificar_lago_ar ;;
        helpers|helper)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "HELPERS" detectar_helpers_existentes ;;
        migracion|migrar|migration)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "MIGRACION" calcular_progreso_migracion ;;
        features|columnas|endpoints)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "FEATURES" detectar_features_especiales ;;
        flujo|caja|flujo-caja|flujocaja|jerarquia)
            cargar_credenciales; explorar_proyecto
            _ejecutar_y_guardar "FLUJO_CAJA" verificar_flujo_caja ;;
        # listar_modulos no acepta destino — capturamos stdout
        modulos|listar|list)
            cargar_credenciales; explorar_proyecto
            _ejecutar_capturando_stdout "MODULOS" listar_modulos ;;

        # ---- Sistema ----
        self-doc|selfdoc|doc|self_doc)
            cargar_credenciales; explorar_proyecto; generar_self_doc ;;
        changelog|history|cambios)
            mostrar_changelog ;;
        cleanup-old-versions|cleanup-old|cleanup-toolkits|cleanup)
            cleanup_old_toolkit_versions ;;
        0|q|quit|salir|exit) echo -e "${GREEN}  Hasta luego!${NC}"; exit 0 ;;
        h|help|ayuda|\?) mostrar_ayuda ;;

        # ---- Fuzzy: matching parcial sobre prefijos comunes ----
        *)
            # Intentar match por prefijo
            case "$key" in
                # Menu visual (1-5)
                comp*|todo*|inf*) ejecutar_accion 1 "$2"; return ;;
                audit*) ejecutar_accion 2 "$2"; return ;;
                rastr*|trac*) ejecutar_accion 3 "$2"; return ;;
                extr*|runt*|deud*|drift*|clean*) ejecutar_accion 4 "$2"; return ;;
                tend*|tren*|histo*) ejecutar_accion 5 "$2"; return ;;
                deta*|cli-t*|todo-c*|todocl*) ejecutar_accion 6 "$2"; return ;;
                # CLI directa (alias texto)
                segu*|secu*) ejecutar_accion seguridad "$2"; return ;;
                mult*) ejecutar_accion multiempresa "$2"; return ;;
                semi*|seed*) ejecutar_accion semilla "$2"; return ;;
                cons*|check*|trigg*) ejecutar_accion constraints "$2"; return ;;
                impr*|prin*) ejecutar_accion impresion "$2"; return ;;
                lago*|catalo*) ejecutar_accion lago "$2"; return ;;
                integ*|fk*|referen*) ejecutar_accion integridad "$2"; return ;;
                help*) ejecutar_accion helpers "$2"; return ;;
                migra*) ejecutar_accion migracion "$2"; return ;;
                feat*|colum*|endp*) ejecutar_accion features "$2"; return ;;
                modul*|list*) ejecutar_accion modulos "$2"; return ;;
                fluj*|caja*|jerarq*) ejecutar_accion flujo "$2"; return ;;
                promp*|maest*) ejecutar_accion prompt "$2"; return ;;
                contex*) ejecutar_accion contexto "$2"; return ;;
                arq*|architec*) ejecutar_accion arquitectura "$2"; return ;;
                salu*|heal*) ejecutar_accion salud "$2"; return ;;
            esac
            echo -e "${RED}  No encontre: '$input'${NC}"
            echo -e "  ${CYAN}Tip:${NC} escribi parte del nombre (ej: 'impr', 'rastr', 'semi') o el numero"
            sleep 1
            return 1
            ;;
    esac
    return 0
}

menu_principal() {
    # [v61+] Menu simplificado: 6 opciones reales. El resto siguen accesibles
    # via CLI directa (helpers, migracion, flujo, etc.) — solo se sacan del menu
    # visual para no inflar la pantalla.
    while true; do
        header
        echo -e "  ${CYAN}┌──────────────────────────────────────────────────────────┐${NC}"
        echo -e "  ${CYAN}│${NC}  ${YELLOW}Buscar${NC} (numero, nombre, alias, o tabla)              ${CYAN}│${NC}"
        echo -e "  ${CYAN}└──────────────────────────────────────────────────────────┘${NC}"
        echo ""
        echo -e "  ${GREEN}★  1${NC}  Informe completo  ${MAGENTA}(contexto + arq + salud + seguridad + integridad + prompt)${NC}"
        echo ""
        echo -e "  ${CYAN} 2${NC}  Auditar modulo   ${MAGENTA}<nombre>${NC}"
        echo -e "  ${RED} 3${NC}  Rastrear tabla   ${MAGENTA}<tabla>${NC}"
        echo -e "  ${YELLOW} 4${NC}  EXTRA           ${MAGENTA}runtime + drift tecnico + cleanup${NC}"
        echo -e "  ${BLUE} 5${NC}  Tendencia        ${MAGENTA}historico${NC}"
        echo -e "  ${MAGENTA} 6${NC}  Detalle CLI     ${YELLOW}todas las opciones CLI en un archivo${NC} ${GREEN}*${NC}"
        echo ""
        echo -e "  ${CYAN}Cada opcion individual genera su .md en${NC} ${OUTPUT_DIR}"
        echo -e "  ${CYAN}CLI directa: ${NC}helpers / migracion / flujo / impresion / lago / seguridad / semilla /"
        echo -e "  ${CYAN}             ${NC}constraints / integridad / features / multiempresa / modulos"
        echo ""
        echo -e "  ${CYAN}h${NC} ayuda    ${CYAN}q${NC} salir"
        echo ""
        read -p "  > " opcion
        [ -z "$opcion" ] && continue

        local cmd arg
        cmd=$(echo "$opcion" | awk '{print $1}')
        arg=$(echo "$opcion" | awk '{$1=""; print $0}' | sed 's/^ *//')

        if [ -n "$arg" ]; then
            ejecutar_accion "$cmd" "$arg"
        else
            ejecutar_accion "$cmd"
        fi
        echo ""
        read -p "  [Enter para volver]..." _
    done
}

# =======================================================================================
# AYUDA
# =======================================================================================

mostrar_ayuda() {
    local SCRIPT_NAME
    SCRIPT_NAME="$(basename "${BASH_SOURCE[0]:-toolkit_v68.sh}")"
    cat << HELP
ERP LAGO - Toolkit IA v${VERSION}  (Solution Architect Mode)

Uso: ./${SCRIPT_NAME} [comando]   |   sin args = menu interactivo

----- MENU VISUAL (6 opciones) -----------------------------------
  1  completo  / informe       Genera TODO en un archivo unico (INFORME_COMPLETO_*.md)
  2  auditar   <modulo>        Audita un modulo especifico (AUDITORIA_*.md)
  3  rastrear  [tabla]         Rastreo cruzado de una tabla (RASTREO_*.md)
  4  extra     / runtime       PM2 + BD viva + drift tecnico + cleanup
                               + ultimas sesiones + self-check (EXTRA_*.md)
  5  tendencia                 Historico (snapshots cronologicos)
  6  detalle   / cli-todo      TODAS las opciones CLI en un archivo
                               (DETALLE_COMPLETO_*.md + cada una individual)

  NOTA: cada opcion individual deja su archivo en OUTPUT_DIR.

----- CLI DIRECTA (no aparecen en menu, igual funcionan) ----------
  helpers          Lista helpers + sus consumidores (incluye helper->helper)
  migracion        Tablas dispersas: helper, controllers via require, estado
  flujo            Empresa->Usuario->Deposito->Caja->Turno (estado vivo)
  impresion        Plantillas .hbs + window.print() (patron real)
  lago             Estado de lago.ar (nginx, SSL, configs, cron viejo)
  seguridad        Middlewares, redirects, transacciones, endpoints huerfanos
  semilla          Datos obligatorios para que el sistema arranque
  constraints      CHECK vs triggers + UNIQUE multi-empresa
  integridad       FKs, triggers, indices, secuencias, vistas
  features         Columnas custom, endpoints por modulo, filtros frontend
  modulos          Lista de modulos detectados
  multiempresa     Estado multi-empresa (auditoria 2026-03-01)
  prompt           Solo regenera PROMPT_MAESTRO.md
  contexto         Solo regenera CONTEXTO_IA_*.md
  arquitectura     Solo regenera ARQUITECTURA_NEGOCIO.md
  salud            Solo regenera SALUD_ARQUITECTONICA.md
  versiones        Solo versiones runtime (Node, PM2, PG)
  self-doc         Genera TOOLKIT_INTERNAL.md (auto-doc del toolkit)
  changelog        Muestra changelog inline
  cleanup-old-versions  Archiva toolkit_v*.sh viejos a _old_toolkits/
  help             Esta ayuda

----- EJEMPLOS ----------------------------------------------------
  ./${SCRIPT_NAME}                              # Menu interactivo
  ./${SCRIPT_NAME} completo                     # Informe completo directo
  ./${SCRIPT_NAME} extra                        # Runtime + deudas + drift
  ./${SCRIPT_NAME} rastrear movimientos_caja    # Rastreo de tabla
  ./${SCRIPT_NAME} flujo                        # Jerarquia caja vivo
  ./${SCRIPT_NAME} helpers                      # Lista de helpers
HELP
}

# =======================================================================================
# MAIN
# =======================================================================================

verificar_proyecto

# CLI delega al dispatcher unificado. Misma logica que el menu interactivo.
case "${1:-}" in
    "") menu_principal ;;
    -h|--help|help) mostrar_ayuda ;;
    menu) menu_principal ;;
    versiones) extraer_versiones_runtime ;;
    multiempresa) cargar_credenciales; explorar_proyecto; detectar_estado_multiempresa ;;
    *) ejecutar_accion "$1" "${2:-}" ;;
esac
