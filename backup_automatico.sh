#!/bin/bash
set -e

# Configuración
BACKUP_DIR="/root/mi_erp/backups"
MAX_BACKUPS=15
DB_USER="juanpablo"
DB_NAME="erplago"
DB_PASSWORD="Huu3697debian@"  # Cámbiala después por seguridad
TIMESTAMP=$(date +%Y%m%d_%H%M)
BACKUP_FILE="$BACKUP_DIR/backup_erplago_$TIMESTAMP.dump"

# Crear directorio si no existe
mkdir -p $BACKUP_DIR

# Hacer backup de la base de datos
echo "$(date): Iniciando backup..." >> $BACKUP_DIR/backup.log
export PGPASSWORD="$DB_PASSWORD"
pg_dump -U $DB_USER -h localhost -d $DB_NAME -F c -b -f "$BACKUP_FILE" 2>&1 | tee -a $BACKUP_DIR/backup.log
unset PGPASSWORD

# Comprimir el backup
gzip "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# Calcular tamaño
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "$(date): Backup completado - $BACKUP_SIZE" >> $BACKUP_DIR/backup.log

# Eliminar backups antiguos (mantener solo los últimos 15)
cd $BACKUP_DIR
ls -t backup_erplago_*.dump.gz | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f
echo "$(date): Limpieza completada. Backups actuales: $(ls -1 backup_erplago_*.dump.gz 2>/dev/null | wc -l)" >> $BACKUP_DIR/backup.log

# Mantener solo las últimas 100 líneas del log
tail -n 100 $BACKUP_DIR/backup.log > $BACKUP_DIR/backup.log.tmp
mv $BACKUP_DIR/backup.log.tmp $BACKUP_DIR/backup.log
