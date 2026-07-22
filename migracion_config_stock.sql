-- ════════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Configuraciones de Stock y Entregas
-- ERP LAGO - Ejecutar con: psql -U juanpablo -d erplago -f migracion_config_stock.sql
-- ════════════════════════════════════════════════════════════════════════════════

-- Insertar configuraciones por defecto para TODAS las empresas existentes

DO $$
DECLARE
    empresa_record RECORD;
BEGIN
    RAISE NOTICE 'Iniciando migración de configuraciones...';
    
    FOR empresa_record IN SELECT id_empresa, razon_social FROM empresas WHERE activo = TRUE
    LOOP
        RAISE NOTICE 'Procesando empresa: % (ID: %)', empresa_record.razon_social, empresa_record.id_empresa;
        
        -- ═══ CONFIGURACIONES DE STOCK ═══
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'stock.permitir_negativo', 'true', 
                'Permite entregas aunque no haya stock suficiente (mercadería puede llegar antes que la factura)')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'stock.avisar_insuficiente', 'true', 
                'Muestra advertencia cuando el stock es insuficiente al entregar')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'stock.bloquear_venta_sin_stock', 'false', 
                'Bloquea la venta de productos sin stock disponible')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        -- ═══ CONFIGURACIONES DE ENTREGAS ═══
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'entregas.requiere_pago_completo', 'false', 
                'Requiere pago completo antes de permitir la entrega')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'entregas.generar_remito_automatico', 'true', 
                'Genera remito automáticamente al registrar una entrega')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'entregas.formato_remito', 'R-{pv}-{num}', 
                'Formato del número de remito (pv=punto venta, num=número)')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        -- ═══ CONFIGURACIONES DE PAGOS ═══
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'pagos.requiere_clave_confirmacion', 'true', 
                'Requiere clave del usuario para confirmar pagos')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
        VALUES (empresa_record.id_empresa, 'pagos.limite_sin_autorizacion', '50000', 
                'Monto máximo en pesos para entregar con deuda sin autorización de supervisor')
        ON CONFLICT (id_empresa, clave) DO NOTHING;
        
    END LOOP;
    
    RAISE NOTICE 'Migración completada exitosamente';
END $$;

-- Verificar configuraciones insertadas
SELECT 
    e.razon_social as empresa,
    c.clave,
    c.valor,
    c.descripcion
FROM configuraciones_empresa c
JOIN empresas e ON c.id_empresa = e.id_empresa
WHERE c.clave LIKE 'stock.%' OR c.clave LIKE 'entregas.%' OR c.clave LIKE 'pagos.%'
ORDER BY e.id_empresa, c.clave;

-- ════════════════════════════════════════════════════════════════════════════════
-- VERIFICAR que numero_completo existe en remitos (si no, agregarlo)
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    -- Verificar si la columna existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'remitos' AND column_name = 'numero_completo'
    ) THEN
        ALTER TABLE remitos ADD COLUMN numero_completo VARCHAR(50);
        RAISE NOTICE 'Columna numero_completo agregada a remitos';
    ELSE
        RAISE NOTICE 'Columna numero_completo ya existe en remitos';
    END IF;
    
    -- Actualizar remitos existentes que no tengan numero_completo
    UPDATE remitos 
    SET numero_completo = 'R-' || LPAD(punto_venta::TEXT, 4, '0') || '-' || LPAD(numero_remito::TEXT, 8, '0')
    WHERE numero_completo IS NULL;
    
    RAISE NOTICE 'Números completos de remitos actualizados';
END $$;

-- Crear índice si no existe
CREATE INDEX IF NOT EXISTS idx_remitos_numero_completo ON remitos(numero_completo);

-- ════════════════════════════════════════════════════════════════════════════════
-- VERIFICAR que exista columna id_turno en recibos (para vincular con caja)
-- ════════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'recibos' AND column_name = 'id_turno'
    ) THEN
        ALTER TABLE recibos ADD COLUMN id_turno INTEGER DEFAULT 0;
        RAISE NOTICE 'Columna id_turno agregada a recibos';
    ELSE
        RAISE NOTICE 'Columna id_turno ya existe en recibos';
    END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- RESUMEN FINAL
-- ════════════════════════════════════════════════════════════════════════════════

SELECT 
    'Configuraciones insertadas' as concepto,
    COUNT(*) as cantidad
FROM configuraciones_empresa 
WHERE clave LIKE 'stock.%' OR clave LIKE 'entregas.%' OR clave LIKE 'pagos.%'
UNION ALL
SELECT 
    'Remitos con numero_completo' as concepto,
    COUNT(*) as cantidad
FROM remitos 
WHERE numero_completo IS NOT NULL;
