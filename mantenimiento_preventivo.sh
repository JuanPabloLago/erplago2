#!/bash/bin
# ERP LAGO - Mantenimiento v40.0
# Autor: Architect v4.0

set -e

echo "--- [1/3] INICIANDO BACKUP PREVENTIVO ---"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/root/mi_erp/backups/pre_mantenimiento_$TIMESTAMP"
mkdir -p "$BACKUP_DIR"

# 1. Backup de Base de Datos
export PGPASSWORD='Huu3697debian@'
pg_dump -h localhost -U juanpablo -d erplago > "$BACKUP_DIR/db_dump.sql"
echo "✅ Backup de base de datos completado en $BACKUP_DIR"

# 2. Backup de código fuente crítico (src y frontend)
tar -czf "$BACKUP_DIR/codigo_fuente.tar.gz" /root/mi_erp/src /root/mi_erp/frontend/js
echo "✅ Backup de código fuente completado."

echo "--- [2/3] AUDITORÍA DE INTEGRIDAD ---"
# Verificación de sintaxis Node.js en controladores críticos
source ~/.nvm/nvm.sh
find /root/mi_erp/src -name "*.js" -exec node --check {} \;
echo "✅ Sintaxis de archivos JS validada."

# Verificación de conexión a BD y conteo de warnings multi-empresa
warnings_count=$(psql -h localhost -U juanpablo -d erplago -t -c "
SELECT count(*) FROM (
    SELECT 'precios' as tabla FROM precios WHERE id_empresa IS NULL
    UNION ALL
    SELECT 'producto_proveedor' FROM producto_proveedor WHERE id_empresa IS NULL
) as checks;")

echo "📊 Diagnóstico multi-empresa: $warnings_count registros sin id_empresa."

echo "--- [3/3] ESTADO DE SERVICIOS ---"
# Comando corregido para evitar el cierre de la sesión
pm2 status erplago
echo "--- PROCESO FINALIZADO ---"
