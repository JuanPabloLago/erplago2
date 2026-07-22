#!/bin/bash
# ============================================================================
# DIAGNÓSTICO VPS - ERP LAGO
# Ejecutar cuando el sistema esté lento con usuarios conectados
# Uso: bash diagnostico_vps.sh
# ============================================================================

ROJO='\033[0;31m'
VERDE='\033[0;32m'
AMARILLO='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPORTE="/tmp/diagnostico_lago_$(date +%Y%m%d_%H%M%S).txt"

header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
}

alerta() {
    if [ "$2" == "CRITICO" ]; then
        echo -e "  ${ROJO}⛔ $1${NC}"
    elif [ "$2" == "WARN" ]; then
        echo -e "  ${AMARILLO}⚠️  $1${NC}"
    else
        echo -e "  ${VERDE}✅ $1${NC}"
    fi
}

# Duplicar salida a archivo
exec > >(tee -a "$REPORTE") 2>&1

echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║     DIAGNÓSTICO VPS - ERP LAGO               ║"
echo "  ║     $(date '+%Y-%m-%d %H:%M:%S')                      ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${NC}"

# ============================================================================
# 1. INFO DEL SISTEMA
# ============================================================================
header "1. INFORMACIÓN DEL SISTEMA"

echo -e "  Hostname:    $(hostname)"
echo -e "  Kernel:      $(uname -r)"
echo -e "  Uptime:      $(uptime -p)"
echo -e "  CPU cores:   $(nproc)"
echo -e "  CPU modelo:  $(grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)"

# ============================================================================
# 2. CPU
# ============================================================================
header "2. USO DE CPU"

LOAD_1=$(cat /proc/loadavg | awk '{print $1}')
LOAD_5=$(cat /proc/loadavg | awk '{print $2}')
LOAD_15=$(cat /proc/loadavg | awk '{print $3}')
CORES=$(nproc)

echo -e "  Load average: ${BOLD}$LOAD_1${NC} (1m)  $LOAD_5 (5m)  $LOAD_15 (15m)"
echo -e "  Núcleos CPU:  $CORES"

# Evaluar load vs cores
LOAD_INT=$(echo "$LOAD_1" | awk '{printf "%d", $1}')
if (( $(echo "$LOAD_1 > $CORES * 2" | bc -l 2>/dev/null || echo 0) )); then
    alerta "LOAD AVERAGE MUY ALTO ($LOAD_1 con $CORES núcleos) — CPU saturado" "CRITICO"
elif (( $(echo "$LOAD_1 > $CORES" | bc -l 2>/dev/null || echo 0) )); then
    alerta "LOAD AVERAGE ALTO ($LOAD_1 con $CORES núcleos) — Procesos en cola" "WARN"
else
    alerta "CPU dentro de parámetros normales" "OK"
fi

echo ""
echo -e "  ${BOLD}Top 5 procesos por CPU:${NC}"
ps aux --sort=-%cpu | head -6 | awk 'NR==1{printf "  %-10s %5s %5s  %s\n", "USER", "%CPU", "%MEM", "COMMAND"} NR>1{printf "  %-10s %5s %5s  %s\n", $1, $3, $4, $11}'

# ============================================================================
# 3. MEMORIA RAM
# ============================================================================
header "3. MEMORIA RAM"

MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_USED=$(free -m | awk '/Mem:/{print $3}')
MEM_AVAIL=$(free -m | awk '/Mem:/{print $7}')
MEM_PCT=$(( MEM_USED * 100 / MEM_TOTAL ))
SWAP_TOTAL=$(free -m | awk '/Swap:/{print $2}')
SWAP_USED=$(free -m | awk '/Swap:/{print $3}')

echo -e "  RAM Total:      ${BOLD}${MEM_TOTAL} MB${NC}"
echo -e "  RAM Usada:      ${BOLD}${MEM_USED} MB${NC} ($MEM_PCT%)"
echo -e "  RAM Disponible: ${BOLD}${MEM_AVAIL} MB${NC}"
echo -e "  Swap Total:     $SWAP_TOTAL MB"
echo -e "  Swap Usada:     $SWAP_USED MB"

# Barra visual
BAR_LEN=40
FILLED=$(( MEM_PCT * BAR_LEN / 100 ))
EMPTY=$(( BAR_LEN - FILLED ))
BAR=$(printf "%${FILLED}s" | tr ' ' '█')$(printf "%${EMPTY}s" | tr ' ' '░')
if [ $MEM_PCT -gt 85 ]; then
    echo -e "  [${ROJO}${BAR}${NC}] $MEM_PCT%"
elif [ $MEM_PCT -gt 70 ]; then
    echo -e "  [${AMARILLO}${BAR}${NC}] $MEM_PCT%"
else
    echo -e "  [${VERDE}${BAR}${NC}] $MEM_PCT%"
fi

if [ $MEM_PCT -gt 85 ]; then
    alerta "RAM CRÍTICA ($MEM_PCT%) — Sistema swapeando, todo se pone lento" "CRITICO"
elif [ $MEM_PCT -gt 70 ]; then
    alerta "RAM ALTA ($MEM_PCT%) — Margen reducido" "WARN"
else
    alerta "RAM dentro de parámetros normales" "OK"
fi

if [ $SWAP_USED -gt 100 ]; then
    alerta "SWAP en uso ($SWAP_USED MB) — Indica falta de RAM, degrada rendimiento" "CRITICO"
elif [ $SWAP_USED -gt 0 ]; then
    alerta "Algo de SWAP en uso ($SWAP_USED MB)" "WARN"
fi

echo ""
echo -e "  ${BOLD}Top 5 procesos por RAM:${NC}"
ps aux --sort=-%mem | head -6 | awk 'NR==1{printf "  %-10s %5s %6s  %s\n", "USER", "%MEM", "RSS_MB", "COMMAND"} NR>1{printf "  %-10s %5s %6.0f  %s\n", $1, $4, $6/1024, $11}'

# ============================================================================
# 4. DISCO
# ============================================================================
header "4. DISCO"

DISK_PCT=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
DISK_USED=$(df -h / | awk 'NR==2{print $3}')
DISK_TOTAL=$(df -h / | awk 'NR==2{print $2}')
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')

echo -e "  Disco usado: ${BOLD}$DISK_USED${NC} de $DISK_TOTAL (disponible: $DISK_AVAIL)"

if [ $DISK_PCT -gt 90 ]; then
    alerta "DISCO CASI LLENO ($DISK_PCT%)" "CRITICO"
elif [ $DISK_PCT -gt 75 ]; then
    alerta "Disco al $DISK_PCT% — Monitorear" "WARN"
else
    alerta "Disco OK ($DISK_PCT%)" "OK"
fi

# Inode check
INODE_PCT=$(df -i / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$INODE_PCT" -gt 80 ] 2>/dev/null; then
    alerta "Inodos al $INODE_PCT% — Puede causar errores de escritura" "WARN"
fi

# Tamaño de directorios relevantes
echo ""
echo -e "  ${BOLD}Directorios grandes:${NC}"
du -sh /root/mi_erp 2>/dev/null | awk '{printf "  ERP LAGO:       %s\n", $1}'
du -sh /root/backups 2>/dev/null | awk '{printf "  Backups:        %s\n", $1}'
du -sh /var/lib/postgresql 2>/dev/null | awk '{printf "  PostgreSQL data: %s\n", $1}'
du -sh /var/log 2>/dev/null | awk '{printf "  Logs:           %s\n", $1}'
du -sh /tmp 2>/dev/null | awk '{printf "  /tmp:           %s\n", $1}'

# ============================================================================
# 5. POSTGRESQL
# ============================================================================
header "5. POSTGRESQL"

if systemctl is-active --quiet postgresql; then
    alerta "PostgreSQL ACTIVO" "OK"
    
    PG_VERSION=$(psql --version 2>/dev/null | awk '{print $3}')
    echo -e "  Versión: $PG_VERSION"
    
    # Conexiones activas
    PG_CONNS=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" 2>/dev/null | xargs)
    PG_TOTAL=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null | xargs)
    PG_MAX=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SHOW max_connections;" 2>/dev/null | xargs)
    PG_SHARED=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SHOW shared_buffers;" 2>/dev/null | xargs)
    PG_WORK=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SHOW work_mem;" 2>/dev/null | xargs)
    PG_EFFECTIVE=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SHOW effective_cache_size;" 2>/dev/null | xargs)
    
    echo -e "  Conexiones activas:  ${BOLD}$PG_CONNS${NC}"
    echo -e "  Conexiones totales:  $PG_TOTAL / $PG_MAX"
    echo -e "  shared_buffers:      $PG_SHARED"
    echo -e "  work_mem:            $PG_WORK"
    echo -e "  effective_cache_size: $PG_EFFECTIVE"
    
    # Queries lentas activas
    echo ""
    echo -e "  ${BOLD}Queries activas ahora:${NC}"
    PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -c "
        SELECT pid, 
               now() - pg_stat_activity.query_start AS duration,
               state,
               LEFT(query, 80) as query
        FROM pg_stat_activity 
        WHERE state != 'idle' 
          AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY duration DESC
        LIMIT 5;
    " 2>/dev/null || echo "  (No se pudo conectar)"
    
    # Tamaño de la base
    DB_SIZE=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SELECT pg_size_pretty(pg_database_size('erplago'));" 2>/dev/null | xargs)
    echo -e "  Tamaño DB erplago: ${BOLD}$DB_SIZE${NC}"
    
    # Tablas más grandes
    echo ""
    echo -e "  ${BOLD}Top 5 tablas más grandes:${NC}"
    PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -c "
        SELECT relname AS tabla, 
               pg_size_pretty(pg_total_relation_size(relid)) AS tamaño,
               n_live_tup AS filas
        FROM pg_stat_user_tables 
        ORDER BY pg_total_relation_size(relid) DESC 
        LIMIT 5;
    " 2>/dev/null
    
    # Queries lentas acumuladas (si pg_stat_statements está activo)
    PG_STATS=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SELECT 1 FROM pg_extension WHERE extname='pg_stat_statements';" 2>/dev/null | xargs)
    if [ "$PG_STATS" == "1" ]; then
        echo ""
        echo -e "  ${BOLD}Top 5 queries más lentas (acumulado):${NC}"
        PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -c "
            SELECT calls,
                   round(mean_exec_time::numeric, 2) as avg_ms,
                   round(total_exec_time::numeric, 2) as total_ms,
                   LEFT(query, 80) as query
            FROM pg_stat_statements 
            ORDER BY mean_exec_time DESC 
            LIMIT 5;
        " 2>/dev/null
    else
        alerta "pg_stat_statements NO instalado — Recomendado para detectar queries lentas" "WARN"
    fi
    
else
    alerta "PostgreSQL NO ESTÁ CORRIENDO" "CRITICO"
fi

# ============================================================================
# 6. NODE.JS / PM2
# ============================================================================
header "6. NODE.JS / PM2"

source ~/.nvm/nvm.sh 2>/dev/null

if command -v pm2 &> /dev/null; then
    echo -e "  Node.js: $(node --version 2>/dev/null)"
    echo ""
    echo -e "  ${BOLD}Procesos PM2:${NC}"
    pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    procs = json.load(sys.stdin)
    for p in procs:
        name = p.get('name', '?')
        status = p.get('pm2_env', {}).get('status', '?')
        cpu = p.get('monit', {}).get('cpu', 0)
        mem_bytes = p.get('monit', {}).get('memory', 0)
        mem_mb = mem_bytes / 1024 / 1024
        restarts = p.get('pm2_env', {}).get('restart_time', 0)
        uptime_ms = p.get('pm2_env', {}).get('pm_uptime', 0)
        
        import time
        uptime_s = (time.time() * 1000 - uptime_ms) / 1000 if uptime_ms else 0
        hours = int(uptime_s // 3600)
        mins = int((uptime_s % 3600) // 60)
        
        status_icon = '🟢' if status == 'online' else '🔴'
        print(f'  {status_icon} {name:<20} CPU: {cpu}%  RAM: {mem_mb:.0f} MB  Restarts: {restarts}  Uptime: {hours}h{mins}m')
        
        if restarts > 10:
            print(f'    ⚠️  MUCHOS RESTARTS ({restarts}) — Posible memory leak o crashes')
        if mem_mb > 500:
            print(f'    ⚠️  CONSUMO DE RAM ALTO ({mem_mb:.0f} MB)')
except:
    print('  (Error parseando PM2)')
" 2>/dev/null || pm2 list 2>/dev/null
    
    # Event loop lag (si hay endpoint de health)
    echo ""
    PM2_INSTANCES=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
    echo -e "  Instancias PM2 totales: $PM2_INSTANCES"
    
    if [ "$PM2_INSTANCES" -gt 1 ] 2>/dev/null; then
        alerta "Múltiples instancias PM2 con 1 CPU puede causar contención" "WARN"
    fi
else
    alerta "PM2 no encontrado" "CRITICO"
fi

# ============================================================================
# 7. PUPPETEER / CHROMIUM
# ============================================================================
header "7. PUPPETEER / CHROMIUM"

CHROME_PROCS=$(ps aux | grep -E "(chromium|chrome|headless)" | grep -v grep | wc -l)
CHROME_MEM=$(ps aux | grep -E "(chromium|chrome|headless)" | grep -v grep | awk '{sum+=$6} END {printf "%.0f", sum/1024}')

echo -e "  Procesos Chromium activos: ${BOLD}$CHROME_PROCS${NC}"
echo -e "  RAM total Chromium:        ${BOLD}${CHROME_MEM:-0} MB${NC}"

if [ "$CHROME_PROCS" -gt 5 ]; then
    alerta "DEMASIADOS PROCESOS CHROMIUM ($CHROME_PROCS) — Posible fuga de instancias" "CRITICO"
elif [ "$CHROME_PROCS" -gt 2 ]; then
    alerta "Varios procesos Chromium activos ($CHROME_PROCS)" "WARN"
elif [ "$CHROME_PROCS" -gt 0 ]; then
    alerta "Chromium activo ($CHROME_PROCS procesos)" "OK"
else
    echo -e "  (Ningún proceso Chromium corriendo ahora)"
fi

# Verificar print_jobs pendientes
PRINT_PENDING=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -c "SELECT count(*) FROM print_jobs WHERE estado = 'pendiente';" 2>/dev/null | xargs)
if [ -n "$PRINT_PENDING" ] && [ "$PRINT_PENDING" -gt 0 ]; then
    alerta "Hay $PRINT_PENDING trabajos de impresión pendientes" "WARN"
fi

# ============================================================================
# 8. WIREGUARD VPN
# ============================================================================
header "8. WIREGUARD VPN"

if command -v wg &> /dev/null; then
    WG_PEERS=$(wg show all peers 2>/dev/null | wc -l)
    WG_ACTIVE=$(wg show all latest-handshakes 2>/dev/null | awk '{if ($2 > 0 && (systime() - $2) < 180) count++} END {print count+0}')
    
    echo -e "  Peers configurados:  $WG_PEERS"
    echo -e "  Peers activos (3m):  ${BOLD}$WG_ACTIVE${NC}"
    
    echo ""
    echo -e "  ${BOLD}Detalle de peers:${NC}"
    wg show all 2>/dev/null | while IFS= read -r line; do
        echo "  $line"
    done
    
    alerta "WireGuard activo" "OK"
else
    alerta "WireGuard no instalado" "WARN"
fi

# ============================================================================
# 9. CONEXIONES DE RED
# ============================================================================
header "9. CONEXIONES DE RED"

CONNS_ESTABLISHED=$(ss -tn state established | wc -l)
CONNS_TIMEWAIT=$(ss -tn state time-wait | wc -l)
CONNS_3000=$(ss -tn state established | grep ':3000' | wc -l)

echo -e "  Conexiones establecidas: $CONNS_ESTABLISHED"
echo -e "  Conexiones TIME_WAIT:    $CONNS_TIMEWAIT"
echo -e "  Conexiones al puerto 3000 (ERP): ${BOLD}$CONNS_3000${NC}"

if [ $CONNS_TIMEWAIT -gt 100 ]; then
    alerta "Muchas conexiones TIME_WAIT ($CONNS_TIMEWAIT)" "WARN"
fi

# ============================================================================
# 10. RESUMEN Y RECOMENDACIONES
# ============================================================================
header "10. RESUMEN Y RECOMENDACIONES"

echo ""
PROBLEMAS=0

# CPU check
if (( $(echo "$LOAD_1 > $CORES" | bc -l 2>/dev/null || echo 0) )); then
    echo -e "  ${ROJO}⛔ CPU SATURADO${NC} — Load $LOAD_1 con $CORES núcleo(s)"
    echo -e "     → Upgrade a KVM 2 (2 CPUs) o reducir procesos concurrentes"
    PROBLEMAS=$((PROBLEMAS+1))
fi

# RAM check
if [ $MEM_PCT -gt 80 ]; then
    echo -e "  ${ROJO}⛔ RAM CRÍTICA${NC} — $MEM_PCT% usada ($MEM_USED/$MEM_TOTAL MB)"
    echo -e "     → Upgrade RAM o optimizar shared_buffers de PostgreSQL"
    PROBLEMAS=$((PROBLEMAS+1))
fi

# Swap check
if [ $SWAP_USED -gt 100 ]; then
    echo -e "  ${ROJO}⛔ USANDO SWAP${NC} — $SWAP_USED MB en swap = LENTITUD"
    echo -e "     → Sistema sin RAM suficiente, todo se degrada"
    PROBLEMAS=$((PROBLEMAS+1))
fi

# Chromium check
if [ "$CHROME_PROCS" -gt 3 ]; then
    echo -e "  ${AMARILLO}⚠️  PROCESOS CHROMIUM${NC} — $CHROME_PROCS activos consumiendo ${CHROME_MEM}MB"
    echo -e "     → Limitar concurrencia de Puppeteer, cerrar instancias huérfanas"
    PROBLEMAS=$((PROBLEMAS+1))
fi

# Disco check
if [ $DISK_PCT -gt 80 ]; then
    echo -e "  ${AMARILLO}⚠️  DISCO${NC} — $DISK_PCT% usado"
    echo -e "     → Limpiar backups viejos y logs"
    PROBLEMAS=$((PROBLEMAS+1))
fi

if [ $PROBLEMAS -eq 0 ]; then
    echo -e "  ${VERDE}✅ No se detectaron problemas críticos en este momento.${NC}"
    echo -e "  Si el sistema está lento ahora, volvé a correr el script en el"
    echo -e "  momento exacto de la lentitud para capturar el estado."
fi

echo ""
echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"
echo -e "  Reporte guardado en: ${BOLD}$REPORTE${NC}"
echo -e "  Compartilo para análisis: cat $REPORTE"
echo -e "${CYAN}────────────────────────────────────────────────────────────${NC}"
echo ""
