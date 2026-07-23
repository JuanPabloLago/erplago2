#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  FASE 1 — PASO 1
#  1. Crea schema_version en LAGO (+ fila BASELINE + migración ya aplicada)
#  2. Genera instalador/schema_base.sql  (pg_dump --schema-only)
#  3. Genera reporte de configuraciones_empresa para escribir semilla.sql
#
#  NO destructivo. NO toca datos de negocio. Idempotente.
#  Rollback: DROP TABLE schema_version;  rm -rf instalador/
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail
cd /root/mi_erp

# ─── Password: NUNCA hardcodeada. Se lee de .env (gitignoreado) o se pide. ───
if [ -z "${PGPASSWORD:-}" ] && [ -f .env ]; then
    PGPASSWORD=$(grep -E '^[[:space:]]*(DB_PASSWORD|PGPASSWORD|POSTGRES_PASSWORD|DB_PASS)=' .env \
                 | head -1 | cut -d= -f2- | sed 's/^[\"'"'"']//; s/[\"'"'"']$//')
fi
if [ -z "${PGPASSWORD:-}" ]; then
    read -rsp "Password de PostgreSQL (usuario juanpablo): " PGPASSWORD
    echo
fi
if [ -z "${PGPASSWORD:-}" ]; then
    echo "🔥 sin password no puedo conectar. Abortado."
    exit 1
fi
export PGPASSWORD

PSQL="psql -h localhost -U juanpablo -d erplago -v ON_ERROR_STOP=1"
OUTDIR="/root/mi_erp/instalador"
REPDIR="/root/mi_erp/instalador/_reportes"

echo "═══════════════════════════════════════════════════"
echo " FASE 1 · PASO 1"
echo "═══════════════════════════════════════════════════"

mkdir -p "$OUTDIR" "$REPDIR"

# ───────────────────────────────────────────────────────────────────
#  1. schema_version
# ───────────────────────────────────────────────────────────────────
echo
echo "──── 1. Creando tabla schema_version ────"

COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "desconocido")
echo "commit actual: $COMMIT"

# checksum de la única migración que ya está aplicada en LAGO
MIG_FILE="migraciones/20260721_cantidad_negativa_compras.sql"
if [ -f "$MIG_FILE" ]; then
    MIG_SHA=$(sha256sum "$MIG_FILE" | cut -d' ' -f1)
    echo "checksum de $MIG_FILE: ${MIG_SHA:0:16}..."
else
    MIG_SHA=""
    echo "⚠️  no se encontró $MIG_FILE"
fi

$PSQL << SQLEOF
BEGIN;

CREATE TABLE IF NOT EXISTS schema_version (
    id               SERIAL       PRIMARY KEY,
    tipo             VARCHAR(20)  NOT NULL DEFAULT 'migracion',
    archivo          VARCHAR(255) NOT NULL,
    checksum_sha256  CHAR(64),
    version_git      VARCHAR(40),
    aplicada_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    aplicada_por     VARCHAR(100) NOT NULL DEFAULT CURRENT_USER,
    duracion_ms      INTEGER,
    notas            TEXT,
    CONSTRAINT uq_schema_version_archivo UNIQUE (archivo),
    CONSTRAINT chk_schema_version_tipo CHECK (tipo IN ('baseline','migracion'))
);

COMMENT ON TABLE  schema_version IS 'Registro de migraciones aplicadas. Infra de BD: SIN id_empresa. Una fila por migracion, mas una fila baseline.';
COMMENT ON COLUMN schema_version.checksum_sha256 IS 'SHA-256 del archivo al momento de aplicarse. Si cambia, la migracion fue editada despues de aplicada = error.';
COMMENT ON COLUMN schema_version.tipo IS 'baseline = punto de partida, no es un archivo aplicable. migracion = archivo de migraciones/.';

-- Fila BASELINE: todo lo que ya esta horneado en el schema de LAGO
INSERT INTO schema_version (tipo, archivo, version_git, notas)
VALUES ('baseline', 'BASELINE', '${COMMIT}',
        'Linea base LAGO. Todo el schema anterior a esta fecha ya esta aplicado. Las migraciones posteriores se cuentan desde aca.')
ON CONFLICT (archivo) DO NOTHING;

COMMIT;
SQLEOF

if [ $? -ne 0 ]; then
    echo "🔥 falló la creación de schema_version. Nada se aplicó (transacción revertida)."
    exit 1
fi
echo "✅ schema_version creada"

# Registrar la migración que YA está aplicada en LAGO (constraint cantidad <> 0)
if [ -n "$MIG_SHA" ]; then
    $PSQL -q << SQLEOF
INSERT INTO schema_version (tipo, archivo, checksum_sha256, version_git, notas)
VALUES ('migracion', '20260721_cantidad_negativa_compras.sql', '${MIG_SHA}', '${COMMIT}',
        'Ya estaba aplicada en LAGO antes de existir el versionado. Registrada retroactivamente para que el migrador NO la vuelva a correr.')
ON CONFLICT (archivo) DO NOTHING;
SQLEOF
    echo "✅ migración pre-existente registrada como aplicada"
fi

echo
echo "──── contenido de schema_version ────"
$PSQL -P pager=off -c "SELECT id, tipo, archivo, LEFT(COALESCE(checksum_sha256,'-'),12) AS sha, version_git, aplicada_en::date FROM schema_version ORDER BY id"

# ───────────────────────────────────────────────────────────────────
#  2. schema_base.sql
# ───────────────────────────────────────────────────────────────────
echo
echo "──── 2. Detectando tablas de backup a excluir ────"

# Detección DINÁMICA (no hardcodeada): cualquier tabla con pinta de backup
BACKUP_TABLES=$($PSQL -Atc "
SELECT tablename FROM pg_tables
WHERE schemaname='public'
  AND (tablename LIKE '\_bak%' OR tablename LIKE '\_backup%'
    OR tablename LIKE '%\_bak\_%' OR tablename LIKE '%\_backup\_%'
    OR tablename LIKE '%\_bak' OR tablename LIKE '%\_backup')
ORDER BY tablename")

echo "$BACKUP_TABLES" | sed 's/^/  ✗ /'
COUNT_BK=$(echo "$BACKUP_TABLES" | grep -c . || true)
echo "  total a excluir: $COUNT_BK"
echo
echo "  ⚠️  REVISÁ esa lista. Si alguna es una tabla VIVA, avisá antes de seguir."

# Armar los -T de pg_dump
EXCLUDES=""
while IFS= read -r t; do
    [ -n "$t" ] && EXCLUDES="$EXCLUDES -T $t"
done <<< "$BACKUP_TABLES"

echo
echo "──── 2b. Generando schema_base.sql ────"

pg_dump -h localhost -U juanpablo -d erplago \
    --schema-only \
    --no-owner \
    --no-privileges \
    --no-comments \
    $EXCLUDES \
    -f "$OUTDIR/schema_base.sql"

if [ $? -ne 0 ]; then
    echo "🔥 pg_dump falló"
    exit 1
fi

echo "✅ generado: $OUTDIR/schema_base.sql"
echo "   tamaño: $(du -h "$OUTDIR/schema_base.sql" | cut -f1)"
echo "   líneas: $(wc -l < "$OUTDIR/schema_base.sql")"

echo
echo "──── 2c. Verificación del dump ────"
echo "CREATE TABLE en el dump: $(grep -c '^CREATE TABLE' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE FUNCTION:         $(grep -c '^CREATE FUNCTION' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE TRIGGER:          $(grep -c '^CREATE TRIGGER' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE INDEX:            $(grep -c '^CREATE INDEX\|^CREATE UNIQUE INDEX' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE VIEW:             $(grep -c '^CREATE VIEW' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE EXTENSION:        $(grep -c 'CREATE EXTENSION' "$OUTDIR/schema_base.sql" || true)"
echo "CREATE SEQUENCE:         $(grep -c '^CREATE SEQUENCE' "$OUTDIR/schema_base.sql" || true)"

echo
echo "extensiones incluidas (deben estar pg_trgm y las que uses):"
grep 'CREATE EXTENSION' "$OUTDIR/schema_base.sql" | sed 's/^/  /' || echo "  ⚠️  ninguna"

echo
echo "¿schema_version quedó en el dump? (DEBE decir SI)"
grep -q 'CREATE TABLE public.schema_version' "$OUTDIR/schema_base.sql" && echo "  ✅ SI" || echo "  🔥 NO — el dump se generó antes de crear la tabla"

echo
echo "¿quedó alguna tabla de backup adentro? (DEBE ser 0)"
FUGA=$(grep -c '^CREATE TABLE public\._bak\|^CREATE TABLE public\._backup\|_bak_20' "$OUTDIR/schema_base.sql" || true)
echo "  tablas backup en el dump: $FUGA"

echo
echo "¿quedó OWNER hardcodeado? (DEBE ser 0)"
echo "  OWNER TO: $(grep -c 'OWNER TO' "$OUTDIR/schema_base.sql" || true)"

# ───────────────────────────────────────────────────────────────────
#  3. Reporte de configuraciones_empresa
# ───────────────────────────────────────────────────────────────────
echo
echo "──── 3. Reporte de configuraciones_empresa ────"

# Volcado completo a archivo (para revisar con calma)
$PSQL -P pager=off -Atc "
SELECT clave || ' = ' || COALESCE(valor,'(null)')
FROM configuraciones_empresa WHERE id_empresa=1 ORDER BY clave" \
    > "$REPDIR/configuraciones_todas.txt"

TOTAL_CFG=$(wc -l < "$REPDIR/configuraciones_todas.txt")
echo "total de claves: $TOTAL_CFG  →  $REPDIR/configuraciones_todas.txt"

# Claves con valores que huelen a LAGO
echo
echo "CLAVES CON VALOR ESPECÍFICO DE LAGO (van al instalador, NO a semilla):"
$PSQL -P pager=off -Atc "
SELECT clave || '  =  ' || LEFT(valor, 55)
FROM configuraciones_empresa
WHERE id_empresa=1 AND valor IS NOT NULL AND valor <> ''
  AND (valor ILIKE '%lago%' OR valor ILIKE '%glew%' OR valor ILIKE '%20296284921%'
    OR valor ILIKE '%20-29628492-1%' OR valor ILIKE '%roger%' OR valor ILIKE '%6303-5258%'
    OR valor ILIKE '%juanpablo%' OR valor ILIKE '%/root/mi_erp%' OR valor ILIKE '%ferreter%')
ORDER BY clave" | tee "$REPDIR/configuraciones_identidad.txt" | sed 's/^/  ⚠️  /'

CUANTAS=$(wc -l < "$REPDIR/configuraciones_identidad.txt")
echo
echo "  → $CUANTAS claves de identidad detectadas"

# Distribución por namespace
echo
echo "CLAVES POR NAMESPACE:"
$PSQL -P pager=off -Atc "
SELECT split_part(clave,'.',1) || ': ' || COUNT(*)
FROM configuraciones_empresa WHERE id_empresa=1
GROUP BY 1 ORDER BY COUNT(*) DESC" | sed 's/^/  /'

# ───────────────────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════"
echo " LISTO. Generado:"
echo "   $OUTDIR/schema_base.sql"
echo "   $REPDIR/configuraciones_todas.txt"
echo "   $REPDIR/configuraciones_identidad.txt"
echo
echo " QUÉ REVISAR:"
echo "   1. La lista de tablas excluidas (arriba): ¿alguna es viva?"
echo "   2. schema_version en el dump: debe decir SI"
echo "   3. tablas backup en el dump: debe ser 0"
echo "   4. Las claves de identidad marcadas con ⚠️"
echo "═══════════════════════════════════════════════════"
