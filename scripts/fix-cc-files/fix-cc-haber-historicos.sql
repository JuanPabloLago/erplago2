-- ============================================================
-- MIGRACIÓN HABER HISTÓRICOS - ERP LAGO
-- Inserta movimientos HABER faltantes en cuentacorrienteclientes
-- para recibos que se crearon ANTES del fix del helper CC.
--
-- ⚠️ EJECUTAR SOLO después de revisar el diagnóstico del fix-cc-tesoreria.sql
-- ⚠️ HACER BACKUP ANTES:
--   pg_dump -h localhost -U juanpablo erplago -t cuentacorrienteclientes > /root/backups/cc_pre_migracion.sql
--
-- EJECUTAR CON:
-- PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f /root/mi_erp/scripts/fix-cc-haber-historicos.sql
-- ============================================================

BEGIN;

-- Paso 1: Insertar HABER faltantes (recibos con id_cliente que no tienen mov CC)
-- Solo para recibos con total > 0, empresa 1, que no tienen HABER correspondiente
INSERT INTO cuentacorrienteclientes (id_empresa, id_cliente, id_pago, concepto, debe, haber, saldo, fecha)
SELECT
    r.id_empresa,
    r.id_cliente,
    r.id_recibo,
    'Recibo ' || COALESCE(r.numero_completo, r.id_recibo::text) || ' - Migración histórica',
    0,
    r.total_recibo,
    0,  -- saldo temporal, se recalcula abajo
    r.fecha_recibo
FROM recibos r
WHERE r.id_cliente IS NOT NULL
  AND r.total_recibo > 0
  AND r.id_empresa = 1
  AND NOT EXISTS (
      SELECT 1 FROM cuentacorrienteclientes cc
      WHERE cc.id_cliente = r.id_cliente
        AND cc.id_empresa = r.id_empresa
        AND cc.haber = r.total_recibo
        AND cc.id_pago = r.id_recibo
  );

-- Paso 2: Recalcular TODOS los saldos corridos por cliente
-- Esto asegura consistencia completa
DO $$
DECLARE
    v_cliente RECORD;
    v_mov RECORD;
    v_saldo_corrido NUMERIC(14,2);
BEGIN
    -- Para cada cliente que tiene movimientos
    FOR v_cliente IN
        SELECT DISTINCT id_cliente, id_empresa
        FROM cuentacorrienteclientes
        ORDER BY id_cliente
    LOOP
        v_saldo_corrido := 0;

        -- Recorrer movimientos en orden cronológico
        FOR v_mov IN
            SELECT id_movimiento_cc_cliente, debe, haber
            FROM cuentacorrienteclientes
            WHERE id_cliente = v_cliente.id_cliente
              AND id_empresa = v_cliente.id_empresa
            ORDER BY fecha ASC, id_movimiento_cc_cliente ASC
        LOOP
            v_saldo_corrido := v_saldo_corrido + COALESCE(v_mov.debe, 0) - COALESCE(v_mov.haber, 0);

            UPDATE cuentacorrienteclientes
            SET saldo = v_saldo_corrido
            WHERE id_movimiento_cc_cliente = v_mov.id_movimiento_cc_cliente;
        END LOOP;

        -- Sincronizar clientes.saldo_actual
        UPDATE clientes
        SET saldo_actual = v_saldo_corrido
        WHERE id_cliente = v_cliente.id_cliente
          AND id_empresa = v_cliente.id_empresa;

        RAISE NOTICE 'Cliente % - saldo recalculado: %', v_cliente.id_cliente, v_saldo_corrido;
    END LOOP;
END $$;

-- Verificación final
SELECT
    cc.id_cliente,
    c.razon_social,
    COUNT(*) as movimientos,
    SUM(cc.debe) as total_debe,
    SUM(cc.haber) as total_haber,
    (SELECT saldo FROM cuentacorrienteclientes
     WHERE id_cliente = cc.id_cliente
     ORDER BY fecha DESC, id_movimiento_cc_cliente DESC
     LIMIT 1) as saldo_final
FROM cuentacorrienteclientes cc
JOIN clientes c ON cc.id_cliente = c.id_cliente
GROUP BY cc.id_cliente, c.razon_social
ORDER BY cc.id_cliente;

COMMIT;
