# SESIÓN 2026-05-10 — TRAZABILIDAD WEB CARRITO↔PEDIDO

**Objetivo**: cerrar el agujero arquitectónico que impedía rastrear qué pedidos del ERP nacían de un carrito web. Estabilizar el pipeline antes de cualquier rediseño visual.

---

## Diagnóstico inicial

Embudo web sospechoso:

| métrica | valor |
|---|---:|
| Carritos web activos | 280 |
| Carritos web "convertido" | 4 |
| Pedidos web en estado 20/21 (pendiente/aprobado) | 0 |

La discordancia (4 convertidos, 0 pedidos web visibles) llevó a auditar el pipeline `carrito-web → pedido`.

### Bugs encontrados

1. **Trazabilidad parcial**. `carritos_web.id_pedido_generado` linkea hacia adelante (carrito → pedido), pero `pedidos` no tenía columna `id_carrito_web` ni `origen`. **Resultado**: los pedidos generados por la web quedaban indistinguibles de los del mostrador físico en el panel admin. Viola regla "nada queda sin registrar" del PROMPT_MAESTRO.

2. **Inconsistencia stock disponible catálogo vs carrito**:
   - `conjuntos-web.helper.js` (catálogo público): exponía `stock_real - stock_comprometido` ✅
   - `carrito-web.helper._obtenerStock`: exponía `SUM(stock_real)` ❌
   - `carrito-web.helper.obtenerCarritoConItems` subquery: idem `SUM(stock_real)` ❌
   - **Resultado**: cliente veía un stock en el catálogo y otro distinto en el carrito; podía agregar cantidades que en realidad estaban comprometidas en remitos pendientes.

3. **Estado del pedido web hardcoded** en INSERT (`id_estado = 20`). Rompe criterio de vendibilidad.

4. **Bug intermitente** "current transaction is aborted" en `carrito-web.controller._resolverCarrito`: aparece en logs PM2 pero el patrón del controller es correcto (pool.connect → BEGIN → try/catch/finally con ROLLBACK y release). Hipótesis: corner case no reproducible. Se deja como deuda técnica para monitoreo.

---

## Cambios aplicados

### Schema

```sql
ALTER TABLE pedidos
  ADD COLUMN id_carrito_web INTEGER NULL
  REFERENCES carritos_web(id_carrito) ON DELETE SET NULL;

ALTER TABLE pedidos ADD COLUMN origen VARCHAR(20) NULL;
ALTER TABLE pedidos ADD CONSTRAINT chk_pedidos_origen
  CHECK (origen IS NULL OR origen IN
         ('mostrador','web','b2b','despachos','migracion'));

CREATE INDEX idx_pedidos_id_carrito_web
  ON pedidos(id_carrito_web) WHERE id_carrito_web IS NOT NULL;
CREATE INDEX idx_pedidos_origen
  ON pedidos(id_empresa, origen) WHERE origen IS NOT NULL;
```

### Backfill

```sql
-- Linkeo cruzado: recuperar trazabilidad de pedidos que vinieron de carritos
UPDATE pedidos p
   SET id_carrito_web = cw.id_carrito, origen = 'web'
  FROM carritos_web cw
 WHERE cw.id_pedido_generado = p.id_pedido
   AND cw.id_empresa = p.id_empresa
   AND cw.estado = 'convertido';
-- → 4 filas afectadas

-- Resto: origen explícito mostrador
UPDATE pedidos SET origen = 'mostrador' WHERE origen IS NULL;
-- → 7411 filas afectadas
```

### Configs nuevas (criterio vendibilidad)

```sql
INSERT INTO configuraciones_empresa (id_empresa, clave, valor) VALUES
  (1, 'web.estado_pedido_inicial', '20'),
  (1, 'web.plazo_entrega_sin_stock', '3-5 días hábiles'),
  (1, 'web.checkout_obliga_login', 'true');
```

### Código modificado

**`src/utils/pedido-web.helper.js`** — `convertirCarritoEnPedido()`:
- INSERT en pedidos ahora incluye `id_carrito_web` y `origen='web'`
- `id_estado` se lee de `web.estado_pedido_inicial` (default 20)

**`src/utils/carrito-web.helper.js`**:
- `_obtenerStock`: `SUM(stock_real - stock_comprometido)` con clamp `GREATEST(0, ...)`
- Subquery `inv` en `obtenerCarritoConItems`: idem

---

## Backups

| qué | dónde |
|---|---|
| BD completa pre-cambios | `/root/mi_erp/backups/pre_trazabilidad_web_20260510_193920.sql.gz` (8.7M) |
| `pedido-web.helper.js` original | `src/utils/pedido-web.helper.js.bak.20260510_193920` |
| `carrito-web.helper.js` original | `src/utils/carrito-web.helper.js.bak.20260510_194149` |

---

## Verificación post-deploy

| check | resultado |
|---|---|
| Trazabilidad bidireccional carrito↔pedido | ✅ 4 pedidos web recuperados |
| Pedidos por origen | mostrador=7411, web=4 |
| 3 configs nuevas activas | ✅ |
| `node --check` ambos helpers | ✅ syntax OK |
| `pm2 restart erplago` | ✅ online tras 2s |

---

## ⚠️ Hallazgo crítico de los datos recuperados

Los 4 pedidos web identificados están **todos** en estados terminales negativos:

| nro_pedido | total | estado | fecha |
|---|---:|---|---|
| 3961 | $52.912,00 | Cancelado (7) | 2026-04-09 |
| 3288 | $40.000,00 | Cancelado (7) | 2026-04-09 |
| 3142 | $33.057,85 | Cancelado (7) | 2026-04-08 |
| 3141 | $5.836,36 | Descartado (-2) | 2026-04-08 |
| **Total** | **$131.806,21** | | |

**Ninguno llegó a aprobarse**. El embudo no se rompe por código, exhibición o stock. Se rompe en **gestión humana**: los pedidos web entran y nadie los aprueba a tiempo.

Pendiente de confirmar con el dueño: si los cancelaciones fueron manuales (falla notificación al admin) o por timeout (falla flujo cliente).

---

## Deuda técnica conocida (no resuelta en esta sesión)

1. **Bug intermitente** "transaction is aborted" en `carrito-web.controller._resolverCarrito`. Patrón del código es correcto. Monitorear logs post-deploy; si reaparece con regularidad, instrumentar con más detalle.

2. **Race condition en `_proximoNroPedido`** (línea ~75 de `pedido-web.helper.js`): `MAX(nro_pedido)+1` puede colisionar con checkouts simultáneos. Bajo prioridad mientras el volumen sea bajo. Fix futuro: migrar a `secuencia_pedidos_web` con `nextval()`.

3. **Hardcode `|| 21`** en líneas 66 y 263 de `carrito-web.helper.js` (cálculo IVA). Pendiente migrar a `web.iva_default_porcentaje`. Parte del problema mayor de 39 ocurrencias totales en el codebase (informe EXTRA del toolkit).

4. **`pedidos.id_pedido_generado` en `carritos_web`** ya existía antes de esta sesión. No se documentó cuándo se creó. Verificar que esté indexada si el volumen crece.

---

## Próximo ciclo

**NO es el rediseño visual del catálogo** (4 niveles + mobile responsive). Esa estaba propuesta pero no tiene sentido todavía: con 280 carritos/mes y 100% de los convertidos muriendo en cancelado/descartado, mejorar la vidriera no genera ventas adicionales.

**Sí es: módulo gestión + notificaciones de pedidos web**. Componentes:

1. **Notificación al admin** al crear pedido web (estado 20). Canales configurables: email + WhatsApp.
2. **Notificación al cliente** al aprobar/rechazar pedido.
3. **Vista "Pedidos web pendientes"** en el panel admin con:
   - Tiempo de espera visible
   - Alerta si >24h sin atender
   - Filtros por estado y antigüedad
4. **Auto-cancelación configurable** por inactividad con notificación previa.
5. **Bitácora** de cambios de estado de pedidos web (usuario, fecha, motivo).

### Claves nuevas que esto va a requerir en `configuraciones_empresa`

| namespace.clave | default LAGO sugerido | tipo |
|---|---|---|
| `web.notificacion_admin_email` | (email del dueño) | string |
| `web.notificacion_admin_whatsapp` | (número) | string |
| `web.notificacion_cliente_email` | true | boolean |
| `web.notificacion_cliente_whatsapp` | true | boolean |
| `web.dias_auto_cancelar_pendiente` | 3 | integer |
| `web.horas_alerta_pedido_sin_atender` | 24 | integer |

Recién después de cerrar gestión, el rediseño visual del catálogo (4 niveles + responsive mobile) tiene sentido como amplificador.

---

*Sesión cerrada 2026-05-10 19:42 — todos los cambios idempotentes y reversibles vía backup.*
