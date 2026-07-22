DO $$
DECLARE r RECORD; cnt INTEGER; total_nulls INTEGER := 0;
BEGIN
    RAISE NOTICE '=== PASO 1: DIAGNOSTICO ===';
    FOR r IN SELECT table_name FROM information_schema.columns WHERE column_name = 'id_empresa' AND table_schema = 'public' ORDER BY table_name LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE id_empresa IS NULL', r.table_name) INTO cnt;
        IF cnt > 0 THEN RAISE NOTICE '  ❌ %: % NULLs', r.table_name, cnt; total_nulls := total_nulls + cnt; END IF;
    END LOOP;
    IF total_nulls = 0 THEN RAISE NOTICE '  ✅ Sin NULLs'; ELSE RAISE NOTICE '  ⚠️ TOTAL: %', total_nulls; END IF;

    RAISE NOTICE '=== PASO 2: FIX NULLs → empresa 1 ===';
    FOR r IN SELECT table_name FROM information_schema.columns WHERE column_name = 'id_empresa' AND table_schema = 'public' ORDER BY table_name LOOP
        EXECUTE format('UPDATE %I SET id_empresa = 1 WHERE id_empresa IS NULL', r.table_name);
        GET DIAGNOSTICS cnt = ROW_COUNT;
        IF cnt > 0 THEN RAISE NOTICE '  FIXED %: %', r.table_name, cnt; END IF;
    END LOOP;

    RAISE NOTICE '=== PASO 3: NOT NULL constraints ===';
    FOR r IN SELECT table_name, is_nullable FROM information_schema.columns WHERE column_name = 'id_empresa' AND table_schema = 'public' ORDER BY table_name LOOP
        IF r.is_nullable = 'YES' THEN
            BEGIN
                EXECUTE format('ALTER TABLE %I ALTER COLUMN id_empresa SET NOT NULL', r.table_name);
                RAISE NOTICE '  ✅ NOT NULL: %', r.table_name;
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE '  ❌ ERROR %: %', r.table_name, SQLERRM;
            END;
        END IF;
    END LOOP;

    RAISE NOTICE '=== PASO 4: VERIFICACIÓN ===';
    cnt := 0;
    FOR r IN SELECT table_name FROM information_schema.columns WHERE column_name = 'id_empresa' AND table_schema = 'public' AND is_nullable = 'YES' ORDER BY table_name LOOP
        RAISE NOTICE '  ⚠️ PENDIENTE: %', r.table_name; cnt := cnt + 1;
    END LOOP;
    IF cnt = 0 THEN RAISE NOTICE '  ✅ TODAS las tablas con NOT NULL — red de seguridad activa'; END IF;
END $$;
