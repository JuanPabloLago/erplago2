-- ═══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Fix módulo Productos — 7 bugs + mejoras de diseño
-- Fecha: 2026-03-25
-- Ejecutar DESPUÉS del backup
-- ═══════════════════════════════════════════════════════════════════

-- 1. Nuevas claves de configuración por empresa
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
SELECT id_empresa, 'productos.alicuota_iva_defecto', '3', 
       'ID de alícuota IVA por defecto para productos nuevos (referencia tabla alicuotasiva)'
FROM empresas
ON CONFLICT (id_empresa, clave) DO NOTHING;

INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
SELECT id_empresa, 'productos.limite_resultados_busqueda', '15', 
       'Cantidad máxima de resultados en búsqueda inteligente de productos'
FROM empresas
ON CONFLICT (id_empresa, clave) DO NOTHING;

-- 2. Verificar integridad: productos con inventario faltante
-- ═══════════════════════════════════════════════════════════════════
-- Insertar registros de inventario faltantes (BUG 5 preventivo)
INSERT INTO inventario (id_empresa, id_producto, stock_real, stock_minimo, stock_maximo, publicado_web)
SELECT e.id_empresa, p.id_producto, 0, 0, 0, false
FROM productos p
CROSS JOIN empresas e
WHERE p.activo = true
AND NOT EXISTS (
    SELECT 1 FROM inventario i 
    WHERE i.id_empresa = e.id_empresa AND i.id_producto = p.id_producto
)
ON CONFLICT (id_empresa, id_producto) DO NOTHING;

-- 3. Verificar integridad: inventario_deposito faltantes
-- ═══════════════════════════════════════════════════════════════════
INSERT INTO inventario_deposito (id_empresa, id_deposito, id_producto, stock_real, stock_comprometido)
SELECT d.id_empresa, d.id_deposito, p.id_producto, 0, 0
FROM productos p
CROSS JOIN depositos d
WHERE d.es_principal = true AND p.activo = true
AND NOT EXISTS (
    SELECT 1 FROM inventario_deposito id2
    WHERE id2.id_deposito = d.id_deposito AND id2.id_producto = p.id_producto
)
ON CONFLICT (id_deposito, id_producto) DO NOTHING;

-- 4. Reporte de diagnóstico (no modifica datos)
-- ═══════════════════════════════════════════════════════════════════
DO $$
DECLARE
    v_inv_faltantes INTEGER;
    v_img_nulas INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_inv_faltantes
    FROM productos p
    CROSS JOIN empresas e
    WHERE p.activo = true
    AND NOT EXISTS (SELECT 1 FROM inventario i WHERE i.id_empresa = e.id_empresa AND i.id_producto = p.id_producto);
    
    SELECT COUNT(*) INTO v_img_nulas
    FROM productos WHERE activo = true AND url_imagen IS NOT NULL;
    
    RAISE NOTICE '══════════════════════════════════════════';
    RAISE NOTICE 'DIAGNÓSTICO POST-MIGRACIÓN:';
    RAISE NOTICE '  Inventarios faltantes restantes: %', v_inv_faltantes;
    RAISE NOTICE '  Productos con imagen: %', v_img_nulas;
    RAISE NOTICE '══════════════════════════════════════════';
END $$;
