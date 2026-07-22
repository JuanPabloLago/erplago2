#!/bin/bash
# ============================================================================
# BACKUP AUTOMÁTICO ERP LAGO + Google Drive
# ============================================================================
# Instalar en cron:
#   crontab -e
#   0 3 * * * /root/mi_erp/scripts/backup-cron.sh >> /var/log/erplago-backup.log 2>&1
#
# También se puede correr manual:
#   bash /root/mi_erp/scripts/backup-cron.sh
#   bash /root/mi_erp/scripts/backup-cron.sh --verify-last
#   bash /root/mi_erp/scripts/backup-cron.sh --cleanup
# ============================================================================

set -euo pipefail

# ── Configuración ──
DB_NAME="erplago"
DB_USER="juanpablo"
DB_PASS="Huu3697debian@"
DB_HOST="localhost"
BACKUP_DIR="/root/backups"
RCLONE_REMOTE="erplago-backup:ERP-LAGO-BACKUPS"
MAX_LOCAL=10
MAX_DRIVE=30
LOG_FILE="/var/log/erplago-backup.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Verificar último backup ──
if [ "${1:-}" = "--verify-last" ]; then
    LAST=$(ls -1d "$BACKUP_DIR"/erplago_* 2>/dev/null | sort | tail -1)
    if [ -z "$LAST" ]; then
        log "ERROR: No hay backups"
        exit 1
    fi
    DUMP="$LAST/erplago.dump"
    log "Verificando: $(basename "$LAST")"
    if [ -f "$DUMP" ]; then
        TABLAS=$(PGPASSWORD="$DB_PASS" pg_restore -l "$DUMP" 2>/dev/null | grep "TABLE DATA" | wc -l)
        log "  dump: OK ($TABLAS tablas)"
    else
        log "  dump: NO EXISTE"
    fi
    TAR="$LAST/codigo.tar.gz"
    if [ -f "$TAR" ] && tar tzf "$TAR" > /dev/null 2>&1; then
        log "  código: OK"
    else
        log "  código: FALTA o CORRUPTO"
    fi
    # Drive
    NOMBRE=$(basename "$LAST")
    DRIVE_FILES=$(rclone ls "$RCLONE_REMOTE/$NOMBRE/" 2>/dev/null | wc -l)
    if [ "$DRIVE_FILES" -gt 0 ]; then
        log "  Drive: OK ($DRIVE_FILES archivos)"
    else
        log "  Drive: NO ENCONTRADO"
    fi
    exit 0
fi

# ── Limpieza ──
if [ "${1:-}" = "--cleanup" ]; then
    log "=== LIMPIEZA ==="
    # Local: mantener últimos MAX_LOCAL
    LOCAL_COUNT=$(ls -1d "$BACKUP_DIR"/erplago_* 2>/dev/null | wc -l)
    if [ "$LOCAL_COUNT" -gt "$MAX_LOCAL" ]; then
        BORRAR=$((LOCAL_COUNT - MAX_LOCAL))
        ls -1d "$BACKUP_DIR"/erplago_* | sort | head -n "$BORRAR" | while read dir; do
            log "  Eliminando local: $(basename "$dir")"
            rm -rf "$dir"
        done
    fi
    log "  Local: $(ls -1d "$BACKUP_DIR"/erplago_* 2>/dev/null | wc -l) backups"

    # pre_restore: borrar mayores a 7 días
    find "$BACKUP_DIR" -maxdepth 1 -name "pre_restore_*" -mtime +7 -exec rm -rf {} \; 2>/dev/null
    log "  pre_restore limpiados (>7 días)"

    # Drive: mantener últimos MAX_DRIVE
    DRIVE_DIRS=$(rclone lsd "$RCLONE_REMOTE/" 2>/dev/null | awk '{print $NF}' | grep '^erplago_' | sort)
    DRIVE_COUNT=$(echo "$DRIVE_DIRS" | grep -c . || true)
    if [ "$DRIVE_COUNT" -gt "$MAX_DRIVE" ]; then
        BORRAR=$((DRIVE_COUNT - MAX_DRIVE))
        echo "$DRIVE_DIRS" | head -n "$BORRAR" | while read dir; do
            log "  Eliminando Drive: $dir"
            rclone purge "$RCLONE_REMOTE/$dir/" 2>/dev/null || true
        done
    fi
    log "  Drive: $(rclone lsd "$RCLONE_REMOTE/" 2>/dev/null | grep 'erplago_' | wc -l) backups"
    exit 0
fi

# ── BACKUP PRINCIPAL ──
TIMESTAMP=$(date '+%Y-%m-%dT%H-%M-%S')
BACKUP_NAME="erplago_${TIMESTAMP}"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

log "=== INICIO BACKUP: $BACKUP_NAME ==="
mkdir -p "$BACKUP_PATH"

# 1) Dump BD
log "1. pg_dump formato custom..."
START=$(date +%s)
PGPASSWORD="$DB_PASS" pg_dump -h "$DB_HOST" -U "$DB_USER" -Fc "$DB_NAME" -f "$BACKUP_PATH/erplago.dump"
ELAPSED=$(($(date +%s) - START))
DUMP_SIZE=$(du -h "$BACKUP_PATH/erplago.dump" | cut -f1)
log "   OK: $DUMP_SIZE ($ELAPSED s)"

# 2) Verificar dump
TABLAS=$(PGPASSWORD="$DB_PASS" pg_restore -l "$BACKUP_PATH/erplago.dump" 2>/dev/null | grep "TABLE DATA" | wc -l)
if [ "$TABLAS" -lt 10 ]; then
    log "ERROR: Dump corrupto ($TABLAS tablas). Abortando."
    rm -rf "$BACKUP_PATH"
    exit 1
fi
log "2. Verificación: OK ($TABLAS tablas)"

# 3) Backup código
log "3. Backup código..."
tar -czf "$BACKUP_PATH/codigo.tar.gz" \
    --exclude='node_modules' --exclude='.git' --exclude='backups' \
    -C /root mi_erp
TAR_SIZE=$(du -h "$BACKUP_PATH/codigo.tar.gz" | cut -f1)
log "   OK: $TAR_SIZE"

# 4) Metadata con conteos
log "4. Generando metadata..."
CONTEOS=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -t -A -c "
    SELECT jsonb_object_agg(relname, n_live_tup)
    FROM pg_stat_user_tables WHERE schemaname = 'public';
")
cat > "$BACKUP_PATH/info.json" << EOF
{
    "version": 3,
    "fecha": "$(date -Iseconds)",
    "usuario": "cron",
    "formato_bd": "custom",
    "tablas": $TABLAS,
    "conteos_tablas": $CONTEOS,
    "archivos": {
        "erplago.dump": "$DUMP_SIZE",
        "codigo.tar.gz": "$TAR_SIZE"
    },
    "verificado": true,
    "drive": null
}
EOF

# 5) Subir a Google Drive
log "5. Subiendo a Google Drive..."
START=$(date +%s)
if rclone copy "$BACKUP_PATH" "$RCLONE_REMOTE/$BACKUP_NAME/" --log-level ERROR 2>&1; then
    ELAPSED=$(($(date +%s) - START))
    DRIVE_FILES=$(rclone ls "$RCLONE_REMOTE/$BACKUP_NAME/" 2>/dev/null | wc -l)
    log "   OK: $DRIVE_FILES archivos subidos ($ELAPSED s)"

    # Actualizar info.json con resultado de Drive
    python3 -c "
import json
with open('$BACKUP_PATH/info.json') as f: d=json.load(f)
d['drive']={'ok':True,'tiempo':'${ELAPSED}s','archivos':$DRIVE_FILES}
with open('$BACKUP_PATH/info.json','w') as f: json.dump(d,f,indent=2)
" 2>/dev/null || true
else
    log "   ERROR: Falló la subida a Drive"
fi

# 6) Rotación local
LOCAL_COUNT=$(ls -1d "$BACKUP_DIR"/erplago_* 2>/dev/null | wc -l)
if [ "$LOCAL_COUNT" -gt "$MAX_LOCAL" ]; then
    BORRAR=$((LOCAL_COUNT - MAX_LOCAL))
    ls -1d "$BACKUP_DIR"/erplago_* | sort | head -n "$BORRAR" | while read dir; do
        log "6. Rotación: eliminando $(basename "$dir")"
        rm -rf "$dir"
    done
fi

TOTAL_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
log "=== FIN BACKUP: $BACKUP_NAME ($TOTAL_SIZE total) ==="
