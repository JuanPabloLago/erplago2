#!/bin/bash
# Validador de invariante fiscal F1.5 (Ley 23.349 art.10)
# Verifica:
#   F1.5: subtotal_sin_iva + total_iva = total_final para todos los pedidos
#   F1.6: productos.id_alicuota_iva nunca NULL (defensa contra inserts crudos)
#   F1.7: pedidoitems.iva_aplicado nunca NULL (contrato de print/facturación)
#
# Uso:
#   ./validar_invariante_iva.sh           -> exit 0 si OK, exit 1 si hay drift
#   ./validar_invariante_iva.sh --verbose -> muestra detalle de los drifts
set -euo pipefail

ENV_FILE="/root/mi_erp/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "[ERROR] No existe $ENV_FILE" >&2
    exit 2
fi
set -a; source "$ENV_FILE"; set +a

: "${DB_HOST:?DB_HOST no definido}"
: "${DB_USER:?DB_USER no definido}"
: "${DB_PASSWORD:?DB_PASSWORD no definido}"
: "${DB_DATABASE:?DB_DATABASE no definido}"
: "${DB_PORT:=5432}"

VERBOSE=0
[ "${1:-}" = "--verbose" ] && VERBOSE=1
TS=$(date '+%Y-%m-%d %H:%M:%S')

run_psql() {
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" -tAc "$1" 2>&1
}

# ─── F1.5: invariante de pedidos ─────────────────────────────────
Q_F15="SELECT COUNT(*) FROM pedidos WHERE ABS((subtotal_sin_iva + total_iva) - total_final) > 0.01 AND subtotal_sin_iva IS NOT NULL;"
DRIFT_F15=$(run_psql "$Q_F15") || { echo "[$TS] [ERROR] psql F1.5 fallo: $DRIFT_F15" >&2; exit 2; }

# ─── F1.6: productos sin alícuota ────────────────────────────────
Q_F16="SELECT COUNT(*) FROM productos WHERE id_alicuota_iva IS NULL;"
DRIFT_F16=$(run_psql "$Q_F16") || { echo "[$TS] [ERROR] psql F1.6 fallo: $DRIFT_F16" >&2; exit 2; }

# ─── F1.7: pedidoitems sin iva_aplicado ──────────────────────────
Q_F17="SELECT COUNT(*) FROM pedidoitems WHERE iva_aplicado IS NULL;"
DRIFT_F17=$(run_psql "$Q_F17") || { echo "[$TS] [ERROR] psql F1.7 fallo: $DRIFT_F17" >&2; exit 2; }

# ─── Resultado consolidado ───────────────────────────────────────
TOTAL_DRIFT=$((DRIFT_F15 + DRIFT_F16 + DRIFT_F17))

if [ "$TOTAL_DRIFT" = "0" ]; then
    echo "[$TS] [OK] invariantes fiscales cumplidos (F1.5=0 F1.6=0 F1.7=0)"
    exit 0
fi

echo "[$TS] [FAIL] invariantes fiscales rotos: F1.5=$DRIFT_F15 F1.6=$DRIFT_F16 F1.7=$DRIFT_F17" >&2

if [ "$VERBOSE" = "1" ]; then
    if [ "$DRIFT_F15" != "0" ]; then
        echo "--- F1.5 pedidos con drift ---" >&2
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" \
          -c "SELECT id_pedido, subtotal_sin_iva, total_iva, total_final, ROUND((subtotal_sin_iva + total_iva - total_final)::numeric, 2) AS drift FROM pedidos WHERE ABS((subtotal_sin_iva + total_iva) - total_final) > 0.01 AND subtotal_sin_iva IS NOT NULL ORDER BY id_pedido DESC LIMIT 50;" >&2
    fi
    if [ "$DRIFT_F16" != "0" ]; then
        echo "--- F1.6 productos sin alícuota ---" >&2
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" \
          -c "SELECT id_producto, sku, nombre, fecha_creacion FROM productos WHERE id_alicuota_iva IS NULL ORDER BY fecha_creacion DESC LIMIT 50;" >&2
    fi
    if [ "$DRIFT_F17" != "0" ]; then
        echo "--- F1.7 pedidoitems sin iva_aplicado ---" >&2
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" \
          -c "SELECT id_pedido, id_item, id_producto FROM pedidoitems WHERE iva_aplicado IS NULL LIMIT 50;" >&2
    fi
fi

exit 1
