DO $$
DECLARE r RECORD; applied INTEGER := 0;
BEGIN
    RAISE NOTICE '=== NOT NULL constraints (excluyendo vistas) ===';
    FOR r IN 
        SELECT c.table_name, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
        WHERE c.column_name = 'id_empresa' AND c.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND c.is_nullable = 'YES'
        ORDER BY c.table_name
    LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id_empresa SET NOT NULL', r.table_name);
            RAISE NOTICE '  ✅ %', r.table_name;
            applied := applied + 1;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '  ❌ %: %', r.table_name, SQLERRM;
        END;
    END LOOP;
    IF applied = 0 THEN RAISE NOTICE '  ✅ Todas ya tenían NOT NULL'; END IF;
    RAISE NOTICE '=== % tablas actualizadas ===', applied;
END $$;
