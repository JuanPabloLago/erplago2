-- ════════════════════════════════════════════════════════════════════
-- TRIGGER AUTO-SYNC SALDO CC → clientes.saldo_actual
-- ERP LAGO - 2026-02-16
--
-- Cada INSERT/DELETE/UPDATE en cuentacorrienteclientes sincroniza
-- automáticamente clientes.saldo_actual con SUM(debe)-SUM(haber)
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Función trigger ──
CREATE OR REPLACE FUNCTION fn_sync_saldo_cc_cliente()
RETURNS trigger AS $$
DECLARE
    v_id_cliente INTEGER;
    v_id_empresa INTEGER;
    v_saldo NUMERIC(14,2);
BEGIN
    -- Determinar cliente afectado
    IF TG_OP = 'DELETE' THEN
        v_id_cliente := OLD.id_cliente;
        v_id_empresa := OLD.id_empresa;
    ELSE
        v_id_cliente := NEW.id_cliente;
        v_id_empresa := NEW.id_empresa;
    END IF;

    -- Calcular saldo real
    SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0)
    INTO v_saldo
    FROM cuentacorrienteclientes
    WHERE id_cliente = v_id_cliente AND id_empresa = v_id_empresa;

    -- Sincronizar
    UPDATE clientes
    SET saldo_actual = COALESCE(v_saldo, 0)
    WHERE id_cliente = v_id_cliente AND id_empresa = v_id_empresa;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Crear trigger (drop primero por si existe) ──
DROP TRIGGER IF EXISTS trg_sync_saldo_cc_cliente ON cuentacorrienteclientes;

CREATE TRIGGER trg_sync_saldo_cc_cliente
AFTER INSERT OR UPDATE OR DELETE ON cuentacorrienteclientes
FOR EACH ROW
EXECUTE FUNCTION fn_sync_saldo_cc_cliente();

-- ── 3. Recalcular saldos corridos de todos los clientes existentes ──
DO $$
DECLARE
    v_rec RECORD;
    v_saldo NUMERIC(14,2);
BEGIN
    FOR v_rec IN
        SELECT DISTINCT id_cliente, id_empresa
        FROM cuentacorrienteclientes
    LOOP
        -- Recalcular saldo corrido con window function
        WITH saldos AS (
            SELECT
                id_movimiento_cc_cliente,
                SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                    OVER (ORDER BY fecha ASC, id_movimiento_cc_cliente ASC) as sc
            FROM cuentacorrienteclientes
            WHERE id_cliente = v_rec.id_cliente AND id_empresa = v_rec.id_empresa
        )
        UPDATE cuentacorrienteclientes cc
        SET saldo = s.sc
        FROM saldos s
        WHERE cc.id_movimiento_cc_cliente = s.id_movimiento_cc_cliente;

        -- Calcular saldo final
        SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0)
        INTO v_saldo
        FROM cuentacorrienteclientes
        WHERE id_cliente = v_rec.id_cliente AND id_empresa = v_rec.id_empresa;

        -- Sincronizar cliente
        UPDATE clientes SET saldo_actual = COALESCE(v_saldo, 0)
        WHERE id_cliente = v_rec.id_cliente AND id_empresa = v_rec.id_empresa;

        RAISE NOTICE 'Cliente % empresa %: saldo = %', v_rec.id_cliente, v_rec.id_empresa, v_saldo;
    END LOOP;
END $$;

-- ── 4. DROP vista rota (no usa tabla CC, confunde) ──
DROP VIEW IF EXISTS v_clientes_cuenta_corriente;

-- ── 5. Verificación ──
SELECT c.id_cliente, c.razon_social, c.saldo_actual,
       (SELECT COUNT(*) FROM cuentacorrienteclientes
        WHERE id_cliente = c.id_cliente) as movs_cc
FROM clientes c
WHERE c.saldo_actual != 0 OR EXISTS (
    SELECT 1 FROM cuentacorrienteclientes WHERE id_cliente = c.id_cliente
)
ORDER BY c.id_cliente;

COMMIT;
