# Fix Módulo Productos — 7 Bugs + 2 Config Keys
## ERP LAGO — 2026-03-25

---

## Resumen de bugs encontrados

| # | Severidad | Archivo | Descripción |
|---|-----------|---------|-------------|
| 1 | CRÍTICO | productos.js (frontend) | `guardarProducto()` no envía `url_imagen` ni `publicado_web` → se pierden al editar |
| 2 | MEDIO | productos.js (frontend) | `abrirModalNuevo()` no limpia `precioCompraNeto` → dato fantasma del producto anterior |
| 3 | CRÍTICO | productos.controller.js | `ajustePrecioMasivo()` no pasa `id_empresa` al helper → `UPDATE 0 filas` silencioso |
| 4 | CRÍTICO | productos.helper.js | `actualizarProducto()` pisa `url_imagen` y `cod_proveedor` con null (sin COALESCE) |
| 5 | MEDIO | productos.helper.js | `inicializarInventario()` sin `ON CONFLICT` → falla si el registro ya existe |
| 6 | BAJO | productos.controller.js | `obtenerPorId()` filtra `activo = TRUE` → imposible ver/editar productos desactivados |
| 7 | CRÍTICO | productos.helper.js | `DELETE FROM conjunto_items` sin `AND id_empresa` → borra conjuntos de TODAS las empresas |

---

## Detalle técnico por bug

### BUG 1 + 4 (combinados) — url_imagen destruida al editar

**Flujo del error:**
1. Frontend `editarProducto()` carga el producto con su `url_imagen`
2. Frontend `guardarProducto()` arma `datos` sin incluir `url_imagen` (no hay input para eso)
3. Controller `actualizar()` pasa `url_imagen: undefined` al helper
4. Helper `actualizarProducto()` hace `url_imagen = $9` (sin COALESCE)
5. El parámetro `url_imagen || null` convierte undefined → null
6. PostgreSQL ejecuta `UPDATE productos SET url_imagen = NULL`

**Fix (2 partes):**
- **Frontend**: almacenar producto cargado en `Estado.productoEditando`, y en `guardarProducto()` leer `url_imagen` y `publicado_web` de ahí
- **Helper**: agregar `COALESCE($9, url_imagen)` como red de seguridad

### BUG 3 — Ajuste masivo de precios silenciosamente roto

**Flujo del error:**
```javascript
// Línea 394 del controller
await productosHelper.actualizarPrecio(client, { 
    id_producto, id_lista_precio: id_lista, precio: precioNuevo 
    // ← FALTA id_empresa
});
```
El helper hace `WHERE id_empresa = $2` pero recibe `undefined` como id_empresa.
PostgreSQL ejecuta `WHERE id_empresa = NULL` → 0 filas afectadas.
El controller responde "Precios ajustados: X productos" porque cuenta los loops, no los UPDATEs.

**Fix:** agregar `id_empresa` al objeto que se pasa al helper.

### BUG 7 — Borrado cross-empresa de conjuntos

**Flujo del error:**
```javascript
// En actualizarProductoCompleto()
await client.query('DELETE FROM conjunto_items WHERE id_producto = $1', [id_producto]);
// ← Borra TODAS las empresas para ese producto
```

La tabla `conjunto_items` tiene `id_empresa NOT NULL` y UNIQUE `(id_conjunto, id_producto)`.
Al editar un producto, se borran los conjuntos de TODAS las empresas.

**Fix:** `WHERE id_producto = $1 AND id_empresa = $2`

---

## Archivos del paquete

```
fix_productos/
├── deploy.sh              ← Script maestro (backup + migrar + parchear + restart + verificar)
├── 01_migracion.sql       ← Nuevas config keys + reparar inventarios huérfanos
├── 02_patch_helper.py     ← Parches BUG 4, 5, 7
├── 03_patch_controller.py ← Parches BUG 3, 6
├── 04_patch_frontend.py   ← Parches BUG 1, 2
└── README.md              ← Este archivo
```

---

## Instrucciones de deploy

```bash
# 1. Subir carpeta al servidor (desde tu PC)
scp -r fix_productos/ root@TU_VPS:/root/mi_erp/

# 2. En el servidor
cd /root/mi_erp
bash fix_productos/deploy.sh
```

---

## Config keys nuevas

| Clave | Valor default | Descripción |
|-------|---------------|-------------|
| `productos.alicuota_iva_defecto` | `3` | ID de alícuota IVA por defecto para productos nuevos |
| `productos.limite_resultados_busqueda` | `15` | Máximo de resultados en búsqueda inteligente |

Administrables desde Configuraciones > Empresa sin tocar código.

---

## Problemas de diseño pendientes (no resueltos en este fix)

| # | Descripción | Impacto | Propuesta |
|---|-------------|---------|-----------|
| D1 | Frontend soporta 1 solo proveedor | Se pierde historial al cambiar | Rediseñar UI con lista de proveedores |
| D2 | Sin validar pertenencia empresa | Empresa A podría editar producto sin inventario propio | Agregar check en controller |
| D3 | Columna legacy `marca` varchar(100) | Duplica `id_marca` FK, confunde | Migrar datos y eliminar columna |
| D4 | `busqueda_vector` usa columna legacy `marca` | Si se elimina `marca`, el GENERATED falla | Actualizar expresión del GENERATED |

Estos requieren diseño más profundo y se abordan en un sprint separado.

---

## Bug bonus: borrador.controller.js

En los logs se detectó:
```
❌ Error en sincronizarPagos: invalid input syntax for type integer: "NaN"
    at borrador.controller.js:880
```

Un parámetro llega como `NaN` a PostgreSQL. Requiere investigación separada del módulo venta-rápida.
