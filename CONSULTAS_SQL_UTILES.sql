-- ============================================================
-- CONSULTAS SQL ÚTILES - PLANIFICADOR DE ENTREGAS
-- ============================================================

-- 1. VER TODAS LAS ENTREGAS PROGRAMADAS
-- ============================================================
SELECT 
    ep.id_planificacion,
    ep.fecha_programada,
    ep.hora_inicio,
    p.id_pedido,
    c.razon_social as cliente,
    p.total as monto,
    ep.prioridad,
    ep.zona_entrega,
    ep.estado
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.id_empresa = 1
ORDER BY ep.fecha_programada, ep.hora_inicio;


-- 2. ENTREGAS DE HOY
-- ============================================================
SELECT 
    ep.*,
    p.id_pedido,
    c.razon_social as cliente,
    p.total
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.fecha_programada = CURRENT_DATE
    AND ep.estado != 'entregada'
    AND ep.id_empresa = 1
ORDER BY ep.hora_inicio;


-- 3. ENTREGAS ATRASADAS (NO REALIZADAS)
-- ============================================================
SELECT 
    ep.id_planificacion,
    ep.fecha_programada,
    p.id_pedido,
    c.razon_social as cliente,
    p.total,
    ep.prioridad,
    CURRENT_DATE - ep.fecha_programada as dias_atrasado
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.fecha_programada < CURRENT_DATE
    AND ep.estado NOT IN ('entregada', 'cancelada')
    AND ep.id_empresa = 1
ORDER BY ep.fecha_programada;


-- 4. PEDIDOS SIN PROGRAMAR
-- ============================================================
SELECT 
    p.id_pedido,
    p.fecha_creacion,
    c.razon_social as cliente,
    p.total,
    p.estado_entrega,
    COUNT(pi.id_item) as cantidad_items
FROM pedidos p
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
LEFT JOIN pedidoitems pi ON p.id_pedido = pi.id_pedido
LEFT JOIN entregas_planificadas ep ON p.id_pedido = ep.id_pedido 
    AND ep.estado NOT IN ('cancelada', 'entregada')
WHERE p.id_empresa = 1
    AND (p.estado_entrega IS NULL OR p.estado_entrega != 'completo')
    AND ep.id_planificacion IS NULL
GROUP BY p.id_pedido, c.razon_social
ORDER BY p.fecha_creacion DESC;


-- 5. RESUMEN POR DÍA (PRÓXIMA SEMANA)
-- ============================================================
SELECT 
    ep.fecha_programada,
    COUNT(*) as total_entregas,
    SUM(p.total) as monto_total,
    COUNT(CASE WHEN ep.prioridad >= 4 THEN 1 END) as entregas_urgentes
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
WHERE ep.fecha_programada BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    AND ep.estado NOT IN ('cancelada', 'entregada')
    AND ep.id_empresa = 1
GROUP BY ep.fecha_programada
ORDER BY ep.fecha_programada;


-- 6. ENTREGAS POR ZONA
-- ============================================================
SELECT 
    ep.zona_entrega,
    COUNT(*) as cantidad,
    SUM(p.total) as monto_total
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
WHERE ep.fecha_programada >= CURRENT_DATE
    AND ep.estado != 'entregada'
    AND ep.id_empresa = 1
    AND ep.zona_entrega IS NOT NULL
GROUP BY ep.zona_entrega
ORDER BY cantidad DESC;


-- 7. ESTADÍSTICAS MENSUALES
-- ============================================================
SELECT 
    DATE_TRUNC('month', ep.fecha_programada) as mes,
    COUNT(*) as entregas_programadas,
    COUNT(CASE WHEN ep.estado = 'entregada' THEN 1 END) as entregas_completadas,
    COUNT(CASE WHEN ep.estado = 'cancelada' THEN 1 END) as entregas_canceladas,
    ROUND(
        COUNT(CASE WHEN ep.estado = 'entregada' THEN 1 END)::numeric / 
        COUNT(*)::numeric * 100, 2
    ) as porcentaje_completadas
FROM entregas_planificadas ep
WHERE ep.id_empresa = 1
GROUP BY DATE_TRUNC('month', ep.fecha_programada)
ORDER BY mes DESC;


-- 8. ENTREGAS POR PRIORIDAD
-- ============================================================
SELECT 
    ep.prioridad,
    CASE ep.prioridad
        WHEN 1 THEN 'Baja'
        WHEN 2 THEN 'Normal'
        WHEN 3 THEN 'Media'
        WHEN 4 THEN 'Alta'
        WHEN 5 THEN 'Urgente'
    END as descripcion,
    COUNT(*) as cantidad,
    COUNT(CASE WHEN ep.estado = 'entregada' THEN 1 END) as completadas
FROM entregas_planificadas ep
WHERE ep.id_empresa = 1
    AND ep.fecha_programada >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY ep.prioridad
ORDER BY ep.prioridad;


-- 9. PEDIDOS CON MÚLTIPLES PROGRAMACIONES (REPROGRAMADOS)
-- ============================================================
SELECT 
    ep.id_pedido,
    c.razon_social as cliente,
    COUNT(*) as veces_programado,
    MIN(ep.fecha_programada) as primera_fecha,
    MAX(ep.fecha_programada) as ultima_fecha
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.id_empresa = 1
GROUP BY ep.id_pedido, c.razon_social
HAVING COUNT(*) > 1
ORDER BY veces_programado DESC;


-- 10. ENTREGAS COMPLETADAS EN LOS ÚLTIMOS 7 DÍAS
-- ============================================================
SELECT 
    ep.fecha_programada,
    p.id_pedido,
    c.razon_social as cliente,
    p.total,
    ep.zona_entrega,
    ep.updated_at as fecha_completada
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.estado = 'entregada'
    AND ep.updated_at >= CURRENT_DATE - INTERVAL '7 days'
    AND ep.id_empresa = 1
ORDER BY ep.updated_at DESC;


-- ============================================================
-- CONSULTAS DE MANTENIMIENTO
-- ============================================================

-- ELIMINAR PROGRAMACIONES ANTIGUAS (más de 6 meses)
-- ============================================================
-- CUIDADO: Ejecutar solo si estás seguro
/*
DELETE FROM entregas_planificadas
WHERE fecha_programada < CURRENT_DATE - INTERVAL '6 months'
    AND estado IN ('entregada', 'cancelada');
*/

-- MARCAR COMO CANCELADAS LAS MUY ATRASADAS
-- ============================================================
/*
UPDATE entregas_planificadas
SET estado = 'cancelada',
    observaciones = COALESCE(observaciones || ' | ', '') || 'Cancelada automáticamente por antigüedad'
WHERE fecha_programada < CURRENT_DATE - INTERVAL '30 days'
    AND estado NOT IN ('entregada', 'cancelada');
*/

-- REPROGRAMAR ENTREGAS ATRASADAS A HOY
-- ============================================================
/*
UPDATE entregas_planificadas
SET fecha_programada = CURRENT_DATE
WHERE fecha_programada < CURRENT_DATE
    AND estado = 'planificada';
*/


-- ============================================================
-- CONSULTAS DE ANÁLISIS AVANZADO
-- ============================================================

-- 11. RENDIMIENTO DE ENTREGAS (PUNTUALIDAD)
-- ============================================================
SELECT 
    CASE 
        WHEN r.fecha_emision::date = ep.fecha_programada THEN 'A tiempo'
        WHEN r.fecha_emision::date > ep.fecha_programada THEN 'Retrasado'
        WHEN r.fecha_emision::date < ep.fecha_programada THEN 'Anticipado'
    END as puntualidad,
    COUNT(*) as cantidad,
    ROUND(AVG(r.fecha_emision::date - ep.fecha_programada), 2) as dias_diferencia_promedio
FROM entregas_planificadas ep
JOIN remitos r ON ep.id_pedido = r.id_pedido
WHERE ep.estado = 'entregada'
    AND r.fecha_emision >= CURRENT_DATE - INTERVAL '30 days'
    AND ep.id_empresa = 1
GROUP BY puntualidad;


-- 12. CLIENTES CON MÁS ENTREGAS PROGRAMADAS
-- ============================================================
SELECT 
    c.id_cliente,
    c.razon_social,
    COUNT(ep.id_planificacion) as entregas_programadas,
    SUM(p.total) as monto_total,
    MIN(ep.fecha_programada) as proxima_entrega
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
JOIN clientes c ON p.id_cliente = c.id_cliente
WHERE ep.estado NOT IN ('entregada', 'cancelada')
    AND ep.id_empresa = 1
GROUP BY c.id_cliente, c.razon_social
ORDER BY entregas_programadas DESC
LIMIT 10;


-- 13. HORAS PICO DE ENTREGAS
-- ============================================================
SELECT 
    EXTRACT(HOUR FROM hora_inicio) as hora,
    COUNT(*) as cantidad_entregas
FROM entregas_planificadas
WHERE id_empresa = 1
    AND fecha_programada >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY EXTRACT(HOUR FROM hora_inicio)
ORDER BY hora;


-- 14. ESTADO DE CAPACIDAD DIARIA
-- ============================================================
SELECT 
    fecha_programada,
    COUNT(*) as entregas_programadas,
    CASE 
        WHEN COUNT(*) < 10 THEN 'Capacidad disponible'
        WHEN COUNT(*) BETWEEN 10 AND 20 THEN 'Capacidad media'
        ELSE 'Capacidad completa'
    END as estado_capacidad
FROM entregas_planificadas
WHERE fecha_programada BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
    AND estado NOT IN ('cancelada', 'entregada')
    AND id_empresa = 1
GROUP BY fecha_programada
ORDER BY fecha_programada;


-- 15. EXPORTAR DATOS PARA EXCEL (formato CSV)
-- ============================================================
COPY (
    SELECT 
        ep.fecha_programada as "Fecha",
        ep.hora_inicio as "Hora",
        p.id_pedido as "Pedido",
        c.razon_social as "Cliente",
        c.telefono as "Teléfono",
        COALESCE(p.domicilio_entrega, c.direccion) as "Dirección",
        p.total as "Monto",
        ep.prioridad as "Prioridad",
        ep.zona_entrega as "Zona",
        ep.estado as "Estado"
    FROM entregas_planificadas ep
    JOIN pedidos p ON ep.id_pedido = p.id_pedido
    LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
    WHERE ep.id_empresa = 1
        AND ep.fecha_programada >= CURRENT_DATE
    ORDER BY ep.fecha_programada, ep.hora_inicio
) TO '/tmp/entregas_programadas.csv' WITH CSV HEADER;


-- ============================================================
-- VISTAS ÚTILES (OPCIONAL)
-- ============================================================

-- Vista de entregas pendientes con información completa
CREATE OR REPLACE VIEW v_entregas_pendientes AS
SELECT 
    ep.id_planificacion,
    ep.fecha_programada,
    ep.hora_inicio,
    ep.hora_fin,
    ep.prioridad,
    ep.zona_entrega,
    ep.estado,
    p.id_pedido,
    p.total as monto_pedido,
    c.id_cliente,
    c.razon_social as cliente,
    c.telefono,
    c.direccion,
    COALESCE(p.domicilio_entrega, c.direccion) as direccion_entrega,
    COUNT(pi.id_item) as cantidad_items
FROM entregas_planificadas ep
JOIN pedidos p ON ep.id_pedido = p.id_pedido
LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
LEFT JOIN pedidoitems pi ON p.id_pedido = pi.id_pedido
WHERE ep.estado NOT IN ('entregada', 'cancelada')
GROUP BY ep.id_planificacion, p.id_pedido, c.id_cliente, c.razon_social, 
         c.telefono, c.direccion, p.domicilio_entrega;

-- Usar la vista:
-- SELECT * FROM v_entregas_pendientes WHERE fecha_programada = CURRENT_DATE;


-- ============================================================
-- FIN DE CONSULTAS ÚTILES
-- ============================================================
