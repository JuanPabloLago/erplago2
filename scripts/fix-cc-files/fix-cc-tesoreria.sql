-- ============================================================
-- MIGRACIÓN TESORERÍA / CC - ERP LAGO
-- Fecha: 2026-02-16
-- ============================================================
-- EJECUTAR CON:
-- PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f /root/mi_erp/scripts/fix-cc-tesoreria.sql
-- ============================================================

BEGIN;

-- ============================================================
-- FIX 5: DROP vista rota v_clientes_cuenta_corriente
-- No la usa nadie, calcula desde facturas/recibos (no desde tabla CC)
-- ============================================================
DROP VIEW IF EXISTS v_clientes_cuenta_corriente;

-- Nota: Conservamos estas 3 vistas que SÍ son útiles:
--   v_clientes_fiscal       → tipo_factura_default (A/B) - la usan facturación
--   v_clientes_saldo_real   → saldo desde facturas pendientes
--   v_clientes_saldos       → saldo CC + pedidos + pagos (la más completa)

-- ============================================================
-- FIX 6: Limpiar pedidos de prueba inflados
-- Pedido #265: Entregado, $104M, cliente 4
-- Pedido #267: Pendiente, $9.9M, cliente 4
-- Los marcamos como Cancelados (estado 7) para no perder historial
-- ============================================================
UPDATE pedidos SET id_estado = 7
WHERE id_pedido IN (265, 267)
  AND total > 1000000;

-- Limpiar movimientos CC generados por estos pedidos
-- (identificables por monto descomunal)
DELETE FROM cuentacorrienteclientes
WHERE id_cliente = 4
  AND debe > 1000000;

-- Recalcular saldo del cliente 4 si quedaron movimientos
-- (toma el último movimiento válido)
DO $$
DECLARE
    v_saldo NUMERIC(14,2) := 0;
BEGIN
    SELECT saldo INTO v_saldo
    FROM cuentacorrienteclientes
    WHERE id_cliente = 4
    ORDER BY fecha DESC, id_movimiento_cc_cliente DESC
    LIMIT 1;

    IF v_saldo IS NULL THEN v_saldo := 0; END IF;

    UPDATE clientes SET saldo_actual = v_saldo WHERE id_cliente = 4;
    RAISE NOTICE 'Cliente 4: saldo recalculado a %', v_saldo;
END $$;

-- ============================================================
-- FIX 1: DIAGNÓSTICO - HABER faltantes en CC
-- Recibos que tienen id_cliente pero NO tienen movimiento HABER en CC
-- ============================================================
-- Este SELECT muestra los recibos huérfanos (sin HABER en CC):
SELECT
    r.id_recibo,
    r.numero_completo,
    r.fecha_recibo,
    r.id_cliente,
    c.razon_social,
    r.total_recibo,
    CASE WHEN cc.id_movimiento_cc_cliente IS NOT NULL THEN 'SI' ELSE 'NO' END as tiene_mov_cc
FROM recibos r
JOIN clientes c ON r.id_cliente = c.id_cliente
LEFT JOIN cuentacorrienteclientes cc ON (
    cc.id_cliente = r.id_cliente
    AND cc.haber > 0
    AND cc.concepto LIKE '%Recibo%' || r.numero_completo || '%'
)
WHERE r.id_cliente IS NOT NULL
  AND r.total_recibo > 0
  AND r.id_empresa = 1
ORDER BY r.fecha_recibo ASC;

COMMIT;

-- ============================================================
-- NOTA PARA HABER HISTÓRICOS:
-- Si el diagnóstico muestra recibos sin movimiento CC,
-- ejecutar el script de migración de HABER por separado
-- (requiere recalcular saldos corridos en orden cronológico).
-- Ver: fix-cc-haber-historicos.sql
-- ============================================================
