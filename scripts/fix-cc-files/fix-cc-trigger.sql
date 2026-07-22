-- ============================================================
-- TRIGGER AUTO-SYNC CC → clientes.saldo_actual
-- ERP LAGO - 2026-02-16
-- ============================================================
-- Cada vez que se inserta, borra o modifica un movimiento en CC,
-- el saldo del cliente se recalcula automáticamente con SUM.
-- Nunca más saldos desincronizados.
-- ============================================================
-- EJECUTAR: PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f /root/mi_erp/scripts/fix-cc-trigger.sql
-- ============================================================

BEGIN;

-- 1. Función del trigger
CREATE OR REPLACE FUNCTION fn_sync_saldo_cc_cliente()
RETURNS TRIGGER AS $$
DECLARE
    v_id_cliente INTEGER;
    v_id_empresa INTEGER;
    v_saldo NUMERIC(14,2);
BEGIN
    -- Determinar qué cliente actualizar
    IF TG_OP = 'DELETE' THEN
        v_id_cliente := OLD.id_cliente;
        v_id_empresa := OLD.id_empresa;
    ELSE
        v_id_cliente := NEW.id_cliente;
        v_id_empresa := NEW.id_empresa;
    END IF;

    -- Recalcular saldo como SUM (fuente de verdad)
    SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0)
    INTO v_saldo
    FROM cuentacorrienteclientes
    WHERE id_cliente = v_id_cliente AND id_empresa = v_id_empresa;

    -- Sincronizar clientes.saldo_actual
    UPDATE clientes
    SET saldo_actual = COALESCE(v_saldo, 0)
    WHERE id_cliente = v_id_cliente AND id_empresa = v_id_empresa;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Crear trigger (reemplaza si ya existe)
DROP TRIGGER IF EXISTS trg_sync_saldo_cc ON cuentacorrienteclientes;

CREATE TRIGGER trg_sync_saldo_cc
AFTER INSERT OR UPDATE OR DELETE ON cuentacorrienteclientes
FOR EACH ROW
EXECUTE FUNCTION fn_sync_saldo_cc_cliente();

-- 3. Recalcular saldos corridos de los movimientos existentes
DO $$
DECLARE
    v_rec RECORD;
BEGIN
    FOR v_rec IN
        SELECT DISTINCT id_cliente, id_empresa FROM cuentacorrienteclientes
    LOOP
        -- Recalcular campo saldo (cache) con window function
        WITH saldos AS (
            SELECT
                id_movimiento_cc_cliente,
                SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                    OVER (ORDER BY fecha ASC, id_movimiento_cc_cliente ASC) as saldo_corrido
            FROM cuentacorrienteclientes
            WHERE id_cliente = v_rec.id_cliente AND id_empresa = v_rec.id_empresa
        )
        UPDATE cuentacorrienteclientes cc
        SET saldo = s.saldo_corrido
        FROM saldos s
        WHERE cc.id_movimiento_cc_cliente = s.id_movimiento_cc_cliente;

        RAISE NOTICE 'Cliente % recalculado', v_rec.id_cliente;
    END LOOP;
END $$;

-- 4. Verificar
SELECT c.id_cliente, c.razon_social, c.saldo_actual,
       COALESCE(SUM(cc.debe), 0) as total_debe,
       COALESCE(SUM(cc.haber), 0) as total_haber,
       COALESCE(SUM(cc.debe), 0) - COALESCE(SUM(cc.haber), 0) as saldo_calculado,
       CASE WHEN c.saldo_actual = COALESCE(SUM(cc.debe), 0) - COALESCE(SUM(cc.haber), 0)
            THEN '✅ OK' ELSE '❌ DESYNC' END as estado
FROM clientes c
LEFT JOIN cuentacorrienteclientes cc ON c.id_cliente = cc.id_cliente AND c.id_empresa = cc.id_empresa
WHERE EXISTS (SELECT 1 FROM cuentacorrienteclientes WHERE id_cliente = c.id_cliente)
GROUP BY c.id_cliente, c.razon_social, c.saldo_actual
ORDER BY c.id_cliente;

COMMIT;
