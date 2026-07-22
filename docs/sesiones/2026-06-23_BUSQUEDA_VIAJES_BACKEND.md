# Búsqueda de viajes: del frontend al backend
## 2026-06-23

## Síntoma reportado
Pedido 11951 (nro 9784, FRANCO DELFINO) no aparecía al buscar "franco delfino"
en gestión-despachos con período "Todo". Solo aparecía poniendo la fecha exacta (16/06).

## Diagnóstico
Dos problemas independientes detectados, se resolvió el primero (B):

**B (resuelto) — Búsqueda filtraba en memoria sobre datos paginados.**
- `listarViajes` traía LIMIT 50 sin parámetro de texto.
- El frontend (`filtrarViajesBusqueda`) filtraba el texto sobre `Estado.viajes`
  (la página ya cargada), no sobre la BD.
- "Todo" → desde/hasta vacíos → backend devolvía los 50 viajes más nuevos.
- Con 100 viajes desde el 16/06, el viaje 1394 quedaba fuera de los 50 → la
  búsqueda en memoria no lo encontraba.

**A (pendiente) — El pedido entregado no actualiza su estado.**
- 11951 entregado de hecho (remito 1767 entregado, viaje 1394 liquidado,
  ENTREGA_TOTAL en bitácora) pero `id_estado=1` (Pendiente) y `estado_entrega=NULL`.
- ~1.530 pedidos en la misma situación. La entrega escribe remito+viaje pero
  no promueve el estado del pedido. PENDIENTE de diseñar.

## Solución B
- **Backend** `listarViajes`: nuevo parámetro `q`. Filtra vía `AND EXISTS`
  sobre los remitos del viaje (cliente / numero_completo / id_pedido) con ILIKE,
  en SQL sobre todo el rango de fechas. El LIMIT queda DESPUÉS del filtro →
  cuenta sobre el resultado, no sobre el universo.
- **Frontend** `filtrarViajesBusqueda`: deja de filtrar en memoria; llama a
  `cargarViajes()` con debounce 300ms. `cargarViajes` agrega `q` a la URL.
- Decisión: con texto, RESPETA el período elegido (no busca en todo por defecto).
- Límites parametrizados en configuraciones_empresa (ver MAPEO).

## Archivos tocados
- src/controllers/despachos.controller.js (listarViajes)
- frontend/js/gestion-despachos.js (filtrarViajesBusqueda, cargarViajes)

## Claves nuevas en configuraciones_empresa
- despachos.viajes_limit_busqueda = 100
- despachos.viajes_limit_listado = 200

## Pendiente (Problema A)
Diseñar promoción de estado_entrega en la transacción de entrega + backfill de
los ~1.530 pedidos entregados con estado desactualizado. Requiere decidir
vocabulario (pendiente/parcial/entregado) y qué hacer con el 'completo' que
escriben las notas de crédito.
