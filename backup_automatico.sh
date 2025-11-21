#!/bin/bash
set -e

# ========================================================================
# BACKUP AUTOMÁTICO COMPLETO - ERP LAGO
# Base de datos + Archivos del sistema
# ========================================================================

BACKUP_DIR="/root/mi_erp/backups"
DB_BACKUP_DIR="$BACKUP_DIR/database"
FILES_BACKUP_DIR="$BACKUP_DIR/files"
MAX_BACKUPS=3
DB_USER="juanpablo"
DB_NAME="erplago"
DB_PASSWORD="Huu3697debian@"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
APP_DIR="/root/mi_erp"

mkdir -p "$DB_BACKUP_DIR"
mkdir -p "$FILES_BACKUP_DIR"

echo "==========================================" | tee -a $BACKUP_DIR/backup.log
echo "$(date): Iniciando backup completo..." | tee -a $BACKUP_DIR/backup.log
echo "==========================================" | tee -a $BACKUP_DIR/backup.log

# 1. BACKUP DE BASE DE DATOS
DB_BACKUP_FILE="$DB_BACKUP_DIR/backup_erplago_$TIMESTAMP.dump"
echo "$(date): Haciendo backup de BD..." | tee -a $BACKUP_DIR/backup.log

export PGPASSWORD="$DB_PASSWORD"
pg_dump -U $DB_USER -h localhost -d $DB_NAME -F c -b -f "$DB_BACKUP_FILE" 2>&1 | tee -a $BACKUP_DIR/backup.log
unset PGPASSWORD

gzip "$DB_BACKUP_FILE"
DB_BACKUP_FILE="${DB_BACKUP_FILE}.gz"
DB_SIZE=$(du -h "$DB_BACKUP_FILE" | cut -f1)
echo "$(date): BD completado - $DB_SIZE" | tee -a $BACKUP_DIR/backup.log

# 2. BACKUP DE ARCHIVOS
FILES_BACKUP_FILE="$FILES_BACKUP_DIR/mi_erp_files_$TIMESTAMP.tar.gz"
echo "$(date): Haciendo backup de archivos..." | tee -a $BACKUP_DIR/backup.log

tar -czf "$FILES_BACKUP_FILE" \
    --exclude="$APP_DIR/node_modules" \
    --exclude="$APP_DIR/backups" \
    --exclude="$APP_DIR/*.log" \
    --exclude="$APP_DIR/.git" \
    -C "$(dirname $APP_DIR)" \
    "$(basename $APP_DIR)" 2>&1 | tee -a $BACKUP_DIR/backup.log

FILES_SIZE=$(du -h "$FILES_BACKUP_FILE" | cut -f1)
echo "$(date): Archivos completado - $FILES_SIZE" | tee -a $BACKUP_DIR/backup.log

# 3. BACKUP DEL .ENV
if [ -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env" "$FILES_BACKUP_DIR/.env_$TIMESTAMP"
    chmod 600 "$FILES_BACKUP_DIR/.env_$TIMESTAMP"
    echo "$(date): .env respaldado" | tee -a $BACKUP_DIR/backup.log
fi

# 4. LIMPIEZA
echo "$(date): Limpiando backups antiguos..." | tee -a $BACKUP_DIR/backup.log

cd "$DB_BACKUP_DIR"
ls -t backup_erplago_*.dump.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f
BD_COUNT=$(ls -1 backup_erplago_*.dump.gz 2>/dev/null | wc -l)

cd "$FILES_BACKUP_DIR"
ls -t mi_erp_files_*.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f
FILES_COUNT=$(ls -1 mi_erp_files_*.tar.gz 2>/dev/null | wc -l)

ls -t .env_* 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f

TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "==========================================" | tee -a $BACKUP_DIR/backup.log
echo "$(date): RESUMEN" | tee -a $BACKUP_DIR/backup.log
echo "BD: $DB_SIZE | Archivos: $FILES_SIZE" | tee -a $BACKUP_DIR/backup.log
echo "Total: $TOTAL_SIZE | Backups: BD=$BD_COUNT, Files=$FILES_COUNT" | tee -a $BACKUP_DIR/backup.log
echo "==========================================" | tee -a $BACKUP_DIR/backup.log

tail -n 200 "$BACKUP_DIR/backup.log" > "$BACKUP_DIR/backup.log.tmp"
mv "$BACKUP_DIR/backup.log.tmp" "$BACKUP_DIR/backup.log"
