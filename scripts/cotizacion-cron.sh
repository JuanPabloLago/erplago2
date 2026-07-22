#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# cotizacion-cron.sh — ERP LAGO
# Sincroniza cotización USD blue desde DolarAPI y la guarda en BD.
# Ejecutado desde crontab sistema cada 6h.
# Logs en /var/log/erplago-cotizacion.log
# Respeta config compras.moneda.auto_sincronizar (si false, skip).
# ═══════════════════════════════════════════════════════════════════════════

set -u
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
echo "$LOG_PREFIX === Iniciando sync cotización USD blue ==="

AUTO_SYNC=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -tA -c "
    SELECT valor FROM configuraciones_empresa
    WHERE id_empresa = 1 AND clave = 'compras.moneda.auto_sincronizar'
    LIMIT 1;" 2>/dev/null)

if [ "$AUTO_SYNC" != "true" ]; then
    echo "$LOG_PREFIX auto_sincronizar=${AUTO_SYNC:-null}, skip"
    exit 0
fi

API_URL=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -tA -c "
    SELECT valor FROM configuraciones_empresa
    WHERE id_empresa = 1 AND clave = 'compras.moneda.api_url_blue'
    LIMIT 1;" 2>/dev/null)
[ -z "$API_URL" ] && API_URL="https://dolarapi.com/v1/dolares/blue"

echo "$LOG_PREFIX Llamando a $API_URL"
RESPONSE=$(curl -sS --max-time 10 "$API_URL" 2>&1)
CURL_RC=$?
if [ $CURL_RC -ne 0 ]; then
    echo "$LOG_PREFIX ❌ curl falló (rc=$CURL_RC): $RESPONSE"
    exit 1
fi

# Parseo JSON (jq si está, sino python)
if command -v jq >/dev/null 2>&1; then
    COMPRA=$(echo "$RESPONSE" | jq -r '.compra // empty')
    VENTA=$(echo "$RESPONSE"  | jq -r '.venta  // empty')
else
    COMPRA=$(echo "$RESPONSE" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('compra',''))" 2>/dev/null)
    VENTA=$(echo "$RESPONSE"  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('venta',''))"  2>/dev/null)
fi

if [ -z "$COMPRA" ] || [ -z "$VENTA" ]; then
    echo "$LOG_PREFIX ❌ respuesta inválida: $RESPONSE"
    exit 1
fi
echo "$LOG_PREFIX ✓ API OK: compra=$COMPRA venta=$VENTA"

# UPSERT BD (id_moneda=2 es USD)
RESULT=$(PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -tA -c "
    INSERT INTO cotizaciones
        (id_empresa, id_moneda, cotizacion_compra, cotizacion_venta,
         fecha_cotizacion, hora_cotizacion, tipo, fuente)
    VALUES (1, 2, $COMPRA, $VENTA, CURRENT_DATE, CURRENT_TIME,
            'automatico', 'DolarAPI Blue (cron)')
    ON CONFLICT (id_empresa, id_moneda, fecha_cotizacion, hora_cotizacion)
    DO UPDATE SET
        cotizacion_compra = EXCLUDED.cotizacion_compra,
        cotizacion_venta  = EXCLUDED.cotizacion_venta,
        fuente            = EXCLUDED.fuente
    RETURNING id_cotizacion;" 2>&1)

if [ $? -ne 0 ]; then
    echo "$LOG_PREFIX ❌ INSERT falló: $RESULT"
    exit 1
fi
echo "$LOG_PREFIX ✓ Guardado en BD: id_cotizacion=$RESULT"
echo "$LOG_PREFIX === Fin sync ==="
exit 0
