# Patch a aplicar sobre `docs/MAPEO_VENDIBILIDAD.md`

Pegá esto bajo la sección del namespace `web.*`. Si ya tenés entradas previas para esas claves, sobrescribilas.

---

## namespace `web.*` — actualización 2026-05-10

### Claves nuevas (✅ implementadas)

| Clave | Default LAGO | Tipo | Descripción | Estado |
|---|---|---|---|---|
| `web.estado_pedido_inicial` | `20` | integer | `id_estado` con que nace un pedido web (antes hardcoded en `pedido-web.helper.convertirCarritoEnPedido`) | ✅ |
| `web.plazo_entrega_sin_stock` | `3-5 días hábiles` | string | Mensaje al cliente cuando el producto pedido no tiene stock inmediato disponible | ✅ |
| `web.checkout_obliga_login` | `true` | boolean | Si el checkout requiere registro/login. Confirma modelo híbrido (opción 2) | ✅ |

### Cambios de estado de claves existentes

| Clave | Estado anterior | Estado actual | Notas |
|---|---|---|---|
| `web.iva_default_porcentaje` | ⚠️ existe en BD, código la ignora | ⚠️ idem | Pendiente: migrar `\|\| 21` hardcoded en líneas 66 y 263 de `carrito-web.helper.js`. Parte del problema mayor de 39 ocurrencias totales en codebase. |
| `web.permitir_vender_sin_stock` | ✅ usada por `pedido-web.helper` | ✅ usada por `pedido-web.helper` + `carrito-web.helper._obtenerStock` ahora respeta comprometido | Stock disponible expuesto = `real - comprometido` (consistente con catálogo). |
| `web.solo_productos_con_stock` | ✅ usada por `carrito-web.helper.agregarItem` | ✅ idem | Sin cambios. |

### Schema relacionado modificado

| Tabla | Columna | Cambio |
|---|---|---|
| `pedidos` | `id_carrito_web INTEGER NULL FK→carritos_web(id_carrito)` | Agregada con ON DELETE SET NULL + index parcial. |
| `pedidos` | `origen VARCHAR(20)` | Agregada con CHECK CONSTRAINT enum ('mostrador','web','b2b','despachos','migracion') + index parcial. |

### Claves que el próximo ciclo (gestión + notificaciones web) va a sumar

Declaradas como pendientes (❌) para que estén mapeadas antes de implementación:

| Clave | Default LAGO sugerido | Tipo | Estado |
|---|---|---|---|
| `web.notificacion_admin_email` | (email del dueño) | string | ❌ pendiente |
| `web.notificacion_admin_whatsapp` | (número WhatsApp Business del dueño) | string | ❌ pendiente |
| `web.notificacion_cliente_email` | `true` | boolean | ❌ pendiente |
| `web.notificacion_cliente_whatsapp` | `true` | boolean | ❌ pendiente |
| `web.dias_auto_cancelar_pendiente` | `3` | integer | ❌ pendiente |
| `web.horas_alerta_pedido_sin_atender` | `24` | integer | ❌ pendiente |

---

*Última actualización: 2026-05-10 19:42 (sesión TRAZABILIDAD_WEB)*
