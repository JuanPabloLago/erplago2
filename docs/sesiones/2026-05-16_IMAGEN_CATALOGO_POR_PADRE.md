# Sesion 2026-05-16 — Imagen por padre en catalogo B2B

## Problema diagnosticado

El catalogo B2B (vista-conjunto, `lago.ar/?conjunto=corralon`) mostraba **una sola imagen** al costado del bloque categoria, en lugar de una imagen por familia/producto. Causa raiz:

- `conjuntos-web.helper._enriquecerCategoria` calculaba `imagen_url` a nivel **categoria**.
- `vista-conjunto.js _renderCatCard` renderizaba `<div class="vc-cat-card-img">` al costado de cada categoria.

Regla de negocio confirmada: **categoria/subcategoria/conjunto NO tienen imagen propia**. La imagen vive en el producto (padre o simple). El padre puede heredar de un hijo si no tiene foto propia.

## Cambios

### Backend (`src/utils/conjuntos-web.helper.js`)
- `_enriquecerCategoria`: removida la logica de imagen. Solo calcula `count_productos` y `display_label`.
- `cat.imagen_url` ahora se setea explicitamente a `null` (retrocompat con consumidores).
- Eliminados 3 hardcodes `|| 'bidireccional'`. Centralizados en constantes `HERENCIA_FAMILIA_DEFAULT`, `IMAGEN_NIVEL_DEFAULT`, `IMAGEN_FALLBACK_ORDEN_DEFAULT`.
- `_cargarConfigVisual` ahora expone `imagen_nivel` y `imagen_fallback_orden` al frontend.

### Frontend (`/var/www/lago-app/js/vista-conjunto.js`)
- `_renderCatCard`: removido slot imagen al costado.
- `_renderFamGroup`: ahora grid 2-col (contenido | imagen), cada familia muestra su propia imagen.
- `_renderSimpleWrapper` (nuevo): grid 2-col para simples.
- `_renderImgSlot` ahora opera sobre producto (padre/simple), no sobre categoria.

### CSS (`/var/www/lago-app/css/vista-conjunto.css`)
- `.vc-cat-card`: dejo de ser grid de 2 cols. Es container simple.
- `.vc-fam-group`: grid 2-col (`1fr | var(--vc-img-slot)`).
- `.vc-simple-wrapper`: nuevo, grid 2-col.
- Mobile: stack vertical, imagen como banner arriba de cada producto.

### BD (`configuraciones_empresa`)
2 claves nuevas insertadas (id_empresa=1):
- `web.catalogo.imagen_nivel` = `padre_y_simple`
- `web.catalogo.imagen_fallback_orden_hijos` = `sort_key_asc`

## Cascada de resolucion de imagen (sin cambios al modelo)

Para cada padre del catalogo:
1. Su propia `producto_imagenes` principal (sincronizada con `productos.url_imagen` via trigger `trg_sync_producto_url_imagen`).
2. Fallback al primer hijo con foto (orden por `sort_key ASC` del SELECT).
3. Placeholder segun `web.imagen.placeholder_modo`.

## Test post-deploy

```bash
curl -s http://localhost:3000/api/web/conjuntos/tab/corralon/productos \
  | python3 -c "import sys, json; d = json.load(sys.stdin); print(d['items'][0])"
# Esperado: imagen_url=null para categoria, items[].imagen_url poblado en padres
```

## Deuda residual (NO bloqueante)

- `web.catalogo.imagen_nivel` soporta `padre_y_simple` (default). Hook para `padre_simple_y_hijo` queda en backlog (no implementado en JS).
- `web.catalogo.imagen_fallback_orden_hijos` se respeta implicitamente por el orden `sort_key ASC` del SELECT. Valores alternativos (`id_producto_asc`, `nombre_asc`) quedan en backlog.
