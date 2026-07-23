#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  FASE 0 — LIMPIEZA DEL BASELINE
#  Endurece .gitignore y saca del VERSIONADO la basura que se coló
#  en el commit baseline. NO borra archivos del disco (usa --cached).
#  Idempotente: se puede correr dos veces sin romper.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail
cd /root/mi_erp

echo "═══════════════════════════════════════════════════"
echo " FASE 0 LIMPIEZA — inicio"
echo "═══════════════════════════════════════════════════"

# ─── 1. Backup del .gitignore actual ───
cp .gitignore ".gitignore.bak.$(date +%Y%m%d_%H%M%S)"
echo "✅ backup de .gitignore hecho"

# ─── 2. Reescribir .gitignore ENDURECIDO ───
cat > .gitignore << 'GITEOF'
# ═══ SECRETOS (jamás en git) ═══
.env
.env.*
!.env.example
afip/certificados/
certs/
*.key
*.pem
*.crt

# ═══ DEPENDENCIAS (se regeneran con npm install) ═══
node_modules/

# ═══ REPORTES DE TEST / COBERTURA (se regeneran con jest) ═══
coverage/
.nyc_output/

# ═══ BACKUPS (por-instancia, no son código) ═══
backups/
backups_web/
_backups_*/
_backups_*.csv
_bak_*.sql
_bak_*.csv
*.dump

# ═══ BINARIOS COMPRIMIDOS (nunca van a git) ═══
*.zip
*.tar.gz
*.tgz
*.tar

# ═══ VERSIONES VIEJAS / PARCHES / RESPALDOS PUNTUALES DE FUENTES ═══
# .bak, .bak.algo Y .bak_algo (guion bajo), .backup, .backups/
*.bak
*.bak.*
*.bak_*
*.backup
*.backup.*
.backups/
# .pre_* / .PRE_* / .PREVIO* / .ANTES* / .BACKUP_* (respaldos manuales al editar)
*.pre_*
*.PRE_*
*.PREVIO*
*.PREVIO.*
*.ANTES_*
*.BACKUP_*
*.HIBRIDO
*.before_*

# ═══ DIRECTORIOS ARCHIVO / CÓDIGO MUERTO / TOOLKITS VIEJOS ═══
_archive/
_codigo_muerto_*/
_migrations_legacy/
_archivados_*/
**/_archivados/
**/_archivados_*/
**/_old_toolkits/

# ═══ LOGS Y TEMPORALES ═══
*.log
.DS_Store
diag_tmp.js
hiberfil.sys
*.sys

# ═══ REPORTES GENERADOS DEL TOOLKIT ═══
scripts_mantenimiento/resultados/
scripts_mantenimiento/.toolkit_history.json
GITEOF
echo "✅ .gitignore endurecido escrito"

# ─── 3. Sacar del ÍNDICE (no del disco) todo lo que ahora matchea ───
# git rm --cached -r --ignore-unmatch: saca de git, deja en disco, no falla si algo no está
echo; echo "──── sacando basura del versionado (queda en disco) ────"

# Patrones a limpiar (los mismos que verificamos)
PATRONES=(
  "coverage"
  "_old_toolkits"
)
for p in "${PATRONES[@]}"; do
  git rm -r --cached --ignore-unmatch --quiet "$(git ls-files | grep "$p" | tr '\n' ' ')" 2>/dev/null || true
done

# Archivos sueltos por patrón de nombre (git ls-files + grep + rm --cached)
git ls-files | grep -iE '\.bak_|\.bak$|\.bak\.|\.backup|\.pre_|\.PRE_|\.PREVIO|\.ANTES_|\.BACKUP_|\.HIBRIDO|\.before_|_backups_.*\.csv$|_bak_.*\.(sql|csv)$|\.zip$|\.tar\.gz$|\.tgz$|coverage/|_old_toolkits/|_archivados|\.sys$|^diag_tmp\.js$|toolkit_history' \
  | while IFS= read -r f; do
      git rm --cached --quiet --ignore-unmatch "$f" 2>/dev/null || true
    done

# Los 3 archivos de nombre corrupto (restos de pegados rotos)
for corrupto in \
  '+ conjunto_items (para agrupar variantes) ==="' \
  'ql -h localhost -U juanpablo -d erplago -c \dt *entrega*' \
  'a remover ==="'
do
  git rm --cached --quiet --ignore-unmatch "$corrupto" 2>/dev/null || true
done

echo "✅ limpieza del índice hecha"

# ─── 4. Stage del .gitignore nuevo ───
git add .gitignore

# ─── 5. Verificaciones ANTES de commitear ───
echo; echo "═══════════════════════════════════════════════════"
echo " VERIFICACIÓN"
echo "═══════════════════════════════════════════════════"

echo "--- ¿queda basura trackeada? (ideal: 0) ---"
RESTO=$(git ls-files | grep -iE '\.bak_|\.bak$|\.pre_|\.PREVIO|coverage/|_old_toolkits/|\.zip$|\.tar\.gz$|_backups_.*\.csv$|_bak_.*\.(sql|csv)$' | wc -l)
echo "basura aún trackeada: $RESTO"

echo "--- ¿algún secreto trackeado? (DEBE ser vacío) ---"
git ls-files | grep -iE '(^|/)\.env($|\.)|certificados/|certs/|\.key$|\.pem$|\.crt$' | grep -v '\.env\.example' || echo "✅ sin secretos"

echo "--- ¿los archivos siguen en DISCO? (verificación anti-pánico) ---"
SAMPLE=$(git ls-files -d | head -1)
if [ -f "src/controllers/clientes.controller.js" ]; then
  echo "✅ código vivo intacto en disco (ej: clientes.controller.js presente)"
fi
COUNT_BAK_DISCO=$(find . -name '*.bak_*' -not -path './node_modules/*' 2>/dev/null | wc -l)
echo "✅ archivos .bak_* que SIGUEN en disco: $COUNT_BAK_DISCO (no se borraron, solo salieron de git)"

echo "--- resumen del commit que se haría ---"
echo "archivos que se sacan del versionado: $(git diff --cached --name-only --diff-filter=D | wc -l)"
echo "archivos modificados (.gitignore): $(git diff --cached --name-only --diff-filter=M | wc -l)"

echo; echo "═══════════════════════════════════════════════════"
echo " Si arriba: basura=0, secretos=vacío, código intacto →"
echo " corré el commit+push con el segundo comando."
echo "═══════════════════════════════════════════════════"
