# Rediseño módulo Notas de Crédito/Débito

**Fechas**: 2026-05-24 (nocturna ~7 hs) + 2026-05-25 (mañana ~2 hs)
**Participantes**: Juan Pablo (dueño + dev único) · Claude (CPO + Arquitecto Senior)
**Estado**: ✅ Implementado y operativo en producción

---

## 1. Casos disparadores (2 emisiones reales en producción)

### Caso A — María Itati Borda (NC #00006-00000019)
- Presupuesto **1890** (num 00001683) sobre pedido **8154**, cliente CF id=328
- 100 huecos + 1 hierro + 2 cementos = $75.100; entregado parcial (73 huecos + el resto), pagó $60.710
- Rechazó los 27 huecos restantes
- **Síntoma original**: NC sobre presupuesto rebotaba con `400 REMITOS_ACTIVOS`
- **Resultado**: NC por $15.120, pedido cerrado en estado 6, sin devolución (cliente pagó solo por lo entregado)

### Caso B — Bernalla Macarena (NC #00006-00000021)
- Pedido **4052** (num 3477), cliente id=5949
- 1 SIP16 + 10 HIERRO H42 = $39.999,98; cliente pagó al adelante en efectivo (18/04)
- Entregado solo el SIP16; los 10 hierros nunca salieron
- **Síntoma original**: pedido sin presupuesto ni factura asociada (creado por flujo legacy directo) → módulo NC no lo encontraba en ningún origen
- **Resultado**: NC por $34.999,98, pedido cerrado en estado 6, **egreso de $34.999,98 en caja registrado vía caja.helper** (turno 43, método Efectivo)

---

## 2. Diagnóstico arquitectónico

Fallas estructurales del módulo NC original:

1. Check grueso "REMITOS_ACTIVOS" bloqueaba toda NC si existía cualquier remito del pedido
2. Sin concepto de "disponible por item" (`cantidad - cantidad_entregada - cantidad_creditada`)
3. No vinculaba items NC con `id_pedido_item` → pérdida total de trazabilidad bidireccional
4. Solo aceptaba origen `factura | presupuesto | manual` → los pedidos legacy sin documento asociado quedaban huérfanos
5. Sin mecanismo de devolución integrada cuando había sobrepago real
6. Check constraint BD `notas_origen_check` excluía `'pedido'` como valor válido
7. Coherencia entre origen↔id no validada en BD (podía haber NC con origen=factura e id_factura_origen=NULL)

---

## 3. Doctrina establecida

1. NC sobre origen presupuesto/pedido opera **solo sobre cantidad pendiente** (`disponible = cantidad - cantidad_entregada - cantidad_creditada`)
2. NC **NO toca stock** — despachos.helper maneja stock, NC marca contablemente
3. Si hay sobrepago real tras NC, se ofrece **devolución vía caja.helper** con forma de pago elegida por el operador
4. La devolución es **opcional** — operador puede tildar "No registrar" cuando el cliente pagó solo lo entregado
5. Sin tipos de motivo: una sola semántica de NC
6. **Pedido es la entidad raíz**: cualquier pedido con items disponibles puede ser origen de NC, tenga o no presupuesto/factura asociada
7. **Single write point respetado**: el controller de notas NO escribe directo a `movimientos_caja`; resuelve el turno con `cajaHelper.requerirTurnoAbierto` y delega la escritura a `cajaHelper.registrarMovimiento`

---

## 4. Cambios en BD

```sql
ALTER TABLE nota_items
  ADD COLUMN id_pedido_item integer
    REFERENCES pedidoitems(id_item) ON DELETE SET NULL;
CREATE INDEX idx_nota_items_pedido_item ON nota_items(id_pedido_item);

-- Constraint extendido (incluye 'pedido')
ALTER TABLE notas_credito_debito DROP CONSTRAINT notas_origen_check;
ALTER TABLE notas_credito_debito ADD CONSTRAINT notas_origen_check
  CHECK (origen::text = ANY (ARRAY['factura','presupuesto','manual','pedido']::text[]));

-- NUEVO: coherencia origen↔id correspondiente (defensa en profundidad)
ALTER TABLE notas_credito_debito ADD CONSTRAINT notas_origen_coherencia
  CHECK (
       origen = 'manual'
    OR (origen = 'factura'     AND id_factura_origen     IS NOT NULL)
    OR (origen = 'presupuesto' AND id_presupuesto_origen IS NOT NULL)
    OR (origen = 'pedido'      AND id_pedido             IS NOT NULL)
  );
```

**6 claves nuevas** en `configuraciones_empresa` namespace `notas.*` (detalle en MAPEO_VENDIBILIDAD.md).

**Resincronización de secuencia_notas**: residuo del incidente AFIP de mayo 2026 había dejado números duplicados. Fix transaccional + helper defensivo.

---

## 5. Cambios backend

### `src/utils/notas.helper.js`
- `calcularDisponiblePorItem(client, id_empresa, id_pedido)` — items con disponible calculado
- `obtenerTotalPagadoPedido(client, id_empresa, id_pedido)`
- `evaluarCierrePedido(client, id_empresa, id_pedido)` — cierra pedido si todos los items quedan con disponible=0
- `obtenerDatosComprobante` con rama `tipo === 'pedido'` (calcada de presupuesto contra pedidos/pedidoitems/productos con `COALESCE(NULLIF(prod.descripcion,''), prod.nombre, '')`)
- `listarPedidosConDisponibleCliente(id_empresa, id_cliente, limit)` — para el listador del frontend
- `crearNotaConItems` modificado: INSERT en `nota_items` incluye `id_pedido_item`, acepta `id_pedido` como parámetro
- Whitelists extendidos a `'pedido'` (3 lugares)
- **Fix defensivo de `obtenerProximoNumero`**: `GREATEST(secuencia+1, max_real+1)` + `ON CONFLICT DO UPDATE` → blindaje contra secuencias desincronizadas

### `src/controllers/notas.controller.js`
- Whitelist extendido en `obtenerComprobanteOrigen` y en el origen al crear
- `obtenerComprobanteOrigen` enriquece la respuesta cuando `datos.id_pedido` existe
- Nueva rama en la resolución de `id_pedido_origen`:
```js
  else if (origenFinal === 'pedido') {
      id_pedido_origen = parseInt(req.body.id_pedido);
  }
```
- Antes de `cajaHelper.registrarMovimiento`: **resolver `id_turno` con `cajaHelper.requerirTurnoAbierto(client, id_empresa, { id_deposito })`** y pasarlo al helper. El controller NO consulta directo `turnos_caja`.
- Tras crear NC: `evaluarCierrePedido` automático
- Nuevo endpoint `listarPedidosCreditoDisponible`

### `src/routes/notas.routes.js`
- Nueva: `GET /api/notas/pedidos-credito-disponible?id_cliente=X`

### `src/controllers/pedidos.controller.js`
- `historialProductoCliente` extendido con `todos_estados=true` para UNION ventas + NCs/NDs

---

## 6. Cambios frontend

### `frontend/notas.html`
- Botón **"Pedido"** entre Presupuesto y Manual (4 botones de origen)
- Cache-bust con `?v=timestamp` como patrón estable

### `frontend/js/notas.js`
- `nota`: `id_pedido_vinculado`, `total_pagado_pedido`, `total_exigible_actual`, `forma_devolucion`, `metodosPagoCache`
- `cargarComprobanteOrigen` filtra items con `disponible <= 0`, pre-carga cantidad = disponible
- `renderItems`: data-attrs para navegación grid, P.Unit readonly cuando hay `id_pedido_item`, columna Original con `Disp:X`, botón historial al lado del tacho
- `actualizarSubtotalFila` + `navegarGrid`: comportamiento data-grid (↑/↓/Enter/←/→) sin que el browser cambie valores nativamente
- `cambiarCant` respeta tope = disponible
- `verHistorialProductoCliente`: modal con 11 columnas + footer resumen, `todos_estados=true`
- `cargarMetodosPago` con fallback entre endpoints y parseo flexible
- **`calcularTotalesNC` con redondeo `_r2` que devuelve `{totalNC, nuevoExigible, sobrepago}`** correctos
- **`actualizarBloqueDevolucion`**: render con `Pagado · Total NC · Nuevo exigible`, `maximumFractionDigits:2`, carga async de métodos si `metodosPagoCache` está vacío al renderizar
- **`recalcularTotales` con redondeo + `maximumFractionDigits:2`** en todos los toLocaleString
- `selOrigen`, `cargarComprobantesCliente`, `cargarComprobanteOrigen`, `guardarNota`: soporte completo `'pedido'`
- `irANueva` siempre resetea (sin condicional)
- `detectarQueryParams` reordenado (irANueva primero, después selTipo/selOrigen)

---

## 7. Bug fixes encontrados durante la sesión

1. **Secuencia desincronizada** `notas_credito_debito_id_empresa_punto_venta_numero_nota_tip_key`: residuo del incidente AFIP mayo 2026 → resincronizado + helper blindado
2. **Subtotal de fila no actualizado**: `cambiarCant` solo recalculaba panel derecho → agregado `actualizarSubtotalFila` granular
3. **`<input type=number>` interceptaba ↑/↓**: `preventDefault` siempre en flechas verticales
4. **Redondeo a 3 decimales** (`$730,003`, `$2.624,133`, `$34.999,976`): `Math.round(n*100)/100` + `maximumFractionDigits:2`
5. **Cálculo de `nuevoExigible` erróneo**: hacía `total_exigible - sobrepago` cuando debía ser `total_exigible - totalNC` — refactor a `calcularTotalesNC()`
6. **Cache del browser servía JS viejo**: adoptado `?v=timestamp` en `<script src>` como patrón
7. **`irANueva` no reseteaba tras guardar previa**: `if (!nota.tipo)` removido
8. **`pi.descripcion` no existe**: usar `COALESCE(NULLIF(prod.descripcion,''), prod.nombre, prod.sku, '#id')`
9. **Constraint `notas_origen_check` excluía 'pedido'**: ampliado + agregado `notas_origen_coherencia`
10. **`id_pedido` no llegaba al INSERT en producción**: controller resolvía `id_pedido_origen` solo desde factura/presupuesto, faltaba la rama `'pedido'` que toma `req.body.id_pedido`
11. **Falta `id_turno` en `registrarMovimiento`**: el controller no resolvía el turno antes de pasar al helper de caja → fix con `cajaHelper.requerirTurnoAbierto(client, id_empresa, { id_deposito })` que ya existía exportado

---

## 8. Resultados en producción

| NC | Cliente | Pedido | Total | Estado pedido post | Devolución caja |
|---|---|---|---|---|---|
| #00006-00000019 | María Itati | 8154 | $15.120 | 6 (Entregado) | $0 (no corresponde) |
| #00006-00000020 | Bernalla | 4052 | $34.999,98 | — | — *(NC anulada: era curl test)* |
| #00006-00000021 | Bernalla | 4052 | $34.999,98 | 6 (Entregado) | $34.999,98 efectivo (turno 43) |

---

## 9. Deudas de diseño detectadas

1. **Exigible vs entregado**: cálculo actual `exigible = total_pedido - total_NC` asume pago contra total. En la práctica del corralón con entregas parciales, el cliente paga contra lo entregado en cada viaje. Refactor: `exigible = SUM(entregado × precio_congelado)` con flag de comportamiento en `configuraciones_empresa`.
2. **Presupuestos legacy que no persisten**: el intento de presupuestar el pedido 4052 desde alguna pantalla no llegó a BD — origen indeterminado, queda para diagnóstico futuro.
3. **`productos.descripcion` vs `productos.nombre`**: campos duplicados con poblamiento inconsistente. Falta helper centralizado `obtenerDescripcionProducto(id_producto)`.
4. **`usuario_configuracion` UNIQUE**: sigue siendo `UNIQUE(id_usuario)` cuando debe ser `UNIQUE(id_empresa, id_usuario)` — bloqueante para alta de empresa 2.
5. **`/api/configuraciones` devuelve 404**: cosmético no bloqueante.
6. **`remitos.pago_confirmado` desincronizado en pedidos legacy**: pedidos como el 4052 tenían pagos en estado 2 pero remitos con `pago_confirmado = false`. Pendiente: script que use `remito-pago-sync.helper` para reprocesar masa de remitos legacy.
7. **NUNCA usar curl para tests en producción**: la NC #41 quedó anulada como aprendizaje. Para validación de backend, usar entorno staging o flag `dry_run=true`.
8. **Validación de motivo mínimo**: el caso B se emitió con motivo "rkrkkrltklrkt". Pendiente: regex de motivo mínimo significativo configurado por empresa.
9. **Mensaje de error "Turno de caja no encontrado"**: el operador no sabe qué hacer. Mejorar UX devolviendo código `TURNO_NO_ABIERTO` con CTA "Abrí tu turno antes de emitir NC con devolución".
10. **Patrones cross-módulo a replicar**: Historial Producto-Cliente, modal de detalle reutilizable, bloque "Documentos relacionados" bidireccional.

---

## 10. Invariantes nuevos (no se negocian)

- `nota_items.id_pedido_item` poblado siempre que origen ∈ {presupuesto, pedido, factura} y el item esté matcheado por id_producto
- `cantidad_creditada` por item se **calcula on-the-fly** (`SUM(nota_items.cantidad) WHERE nota.estado='activa' AND tipo_nota='credito'`)
- Tras toda NC: `evaluarCierrePedido` decide si cerrar pedido en estado 6 o 10
- `obtenerProximoNumero` siempre verifica `MAX(numero_nota)` real antes de devolver
- `notas_origen_check` permite `{factura, presupuesto, manual, pedido}` y `notas_origen_coherencia` exige el id correspondiente
- Cache-bust con `?v=timestamp` después de cada modificación al JS
- **Single write point a caja**: cualquier movimiento contable derivado de NC pasa por `cajaHelper.registrarMovimiento` con `id_turno` resuelto vía `cajaHelper.requerirTurnoAbierto`
- En `irANueva` el reset es incondicional

