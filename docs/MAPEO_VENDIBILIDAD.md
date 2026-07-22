# MAPEO DE VENDIBILIDAD — ERP LAGO

Inventario vivo de claves de configuración bajo `configuraciones_empresa`.
Estados: ✅ implementado / ⚠️ parcial / ❌ pendiente / 🔥 bloqueante.
Una clave que no aparece en este archivo se considera **no vendible**.

## Namespace afip.* (integración fiscal AFIP)

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `afip.cert_path` | string | (migrado de afip_cert_path) | ⚠️ duplicada con vieja | Path al .crt |
| `afip.key_path` | string | (migrado de afip_key_path) | ⚠️ duplicada con vieja | Path al .key |
| `afip.cuit` | string | (migrado de afip_cuit) | ⚠️ duplicada con vieja | CUIT emisor |
| `afip.env` | string | (migrado de afip_env) | ⚠️ duplicada con vieja | homo / prod |
| `afip.offline` | bool | (migrado de afip_offline) | ⚠️ duplicada con vieja | si true no llama AFIP |
| `afip.punto_venta_default` | int | (migrado) | ⚠️ duplicada con vieja | PV por defecto |
| `afip.tope_cf_efectivo` | numeric | (migrado) | ⚠️ duplicada con vieja | Tope CF efectivo (RG) |
| `afip.tope_cf_otros` | numeric | (migrado) | ⚠️ duplicada con vieja | Tope CF otros medios |
| `afip.guardar_xml_completo` | bool | false | ✅ | Persistir request/response XML en afip_solicitudes |
| `afip.timeout_ms` | int | 30000 | ✅ | Timeout WSAA/WSFEv1 |
| `afip.precheck_ultimo_autorizado` | bool | false | ✅ | FECompUltimoAutorizado antes de cada solicitarCAE |
| `afip.idempotency_window_min` | int | 30 | ✅ | Minutos validez idempotency-key |
| `afip.tolerancia_drift_dias` | int | 1 | ✅ | Días máx pedido.fecha vs factura.fecha_emision |

## Namespace auditoria.afip.*

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `auditoria.afip.archivo_dir` | string | /root/mi_erp/scripts_mantenimiento/resultados/ | ✅ | Directorio xlsx descargados |
| `auditoria.afip.solicitudes_retencion_dias` | int | 730 | ✅ | Retención de afip_solicitudes (mín legal AR 2 años) |
| `auditoria.afip.alerta_drift_email` | string | (vacío) | ✅ | Email opcional para alertas del cron de reconciliación |

**Pendiente F2-F4 (no en este pase):**
- Eliminar las claves afip_* planas viejas una vez refactorizado el código que las usa.
- Instrumentar afip.service.solicitarCAE para escribir en afip_solicitudes.
- Agregar UNIQUE constraint multi-empresa en notas_credito_debito.

## Namespace auditoria.* (auditoría de operaciones)

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `auditoria.usuario_sistema` | int (id_usuario) | 1 | ✅ | id_usuario sentinel para registros sin operador (jobs/cron/system) |
| `auditoria.id_usuario_obligatorio` | bool | true | ✅ | Si true, controllers exigen id_usuario en INSERT facturas/pagos/notas |
| `auditoria.log_impresiones.activo` | bool | true | ✅ | Habilita registro en log_impresiones (existente pre-F2) |
| `auditoria.log_impresiones.retencion_dias` | int | 365 | ✅ | Retención del log_impresiones (existente pre-F2) |

## Cambios de schema F2 (2026-05-10)

- `facturas.id_usuario` agregado (FK usuarios, nullable, registros legacy quedan NULL).
- `pagos.id_usuario` agregado (FK usuarios, nullable, registros legacy quedan NULL).
- `notas_credito_debito.idempotency_key` agregada (VARCHAR(64), nullable).
- UNIQUE parcial `uq_notas_idempotency(id_empresa, idempotency_key) WHERE idempotency_key IS NOT NULL` — bloquea reintentos del mismo click sin afectar legacy.
- Backfill `id_usuario` desde `pedidos.id_usuario`: 1260 facturas + 5651 pagos. Residual sin pedido: 5 facturas + 3 pagos en NULL.

## F3-EXT — Auditoria AFIP completa (2026-05-10)

Helper canonico nuevo: `src/utils/afip-auditoria.helper.js` con 3 funciones puras: `consultarPorIdempotencyKey`, `preGrabarSolicitud`, `registrarResultado`. Single write-point para `afip_solicitudes`. Usa `pool` directo (NO recibe client) — las escrituras NO quedan atrapadas en transacciones del controller que puedan hacer ROLLBACK.

Flujo en `notas.controller.crear` cuando origen='factura' y tieneCaeReal:

1. Pre-check 1 (F3 minimo): si NC ya existe con esta idempotency_key en `notas_credito_debito` → devolver la NC. AFIP no se invoca.
2. Pre-check 2 (F3-EXT): si solicitud existe en `afip_solicitudes`:
   - resultado='A' y cae populado → REUSAR CAE huerfano (no llamar AFIP).
   - resultado='R' o NULL u 'O' → HTTP 409 AFIP_SOLICITUD_PREVIA (usuario debe regenerar key con Nueva).
3. preGrabarSolicitud antes de afipService.solicitarCAE.
4. registrarResultado('A' o 'R') despues de la llamada AFIP, en transaccion separada.

Casos cubiertos:
- Click 1 OK + click 2 con misma key (confusion): pre-check 1 devuelve la NC. ✓
- AFIP autoriza, helper falla, ROLLBACK, reintento: pre-check 2 reusa CAE. ✓ (cierra el caso 05/05)
- AFIP rechaza legitimamente, reintento misma key: 409, usuario regenera key con boton "Nueva". ✓

Pendientes F3-EXT (fases futuras):
- Frontend: detectar codigo AFIP_SOLICITUD_PREVIA y ofrecer "regenerar key automaticamente" con confirmacion.
- Aplicar mismo patron a `facturas.controller` (POST /api/facturas).
- Aplicar mismo patron a `recargos.helper` (INSERT directo en recargos).
- Cron diario reconciliacion: comparar afip_solicitudes vs notas_credito_debito + facturas para detectar drift historico.
- Eliminar 8 claves `afip_*` planas viejas y refactor de callers.

Limitacion conocida (caso edge no cubierto):
- Si el proceso muere ENTRE solicitarCAE y registrarResultado (kill -9, OOM, panic): queda fila con resultado=NULL. Reintento devuelve 409. Usuario debe verificar en portal AFIP si comprobante (pv, tipo, num) fue emitido. Para cubrir 100% requiere implementar consultarCAE (FECompConsultar) automatico que pregunte a AFIP si el comprobante existe y, si si, popule afip_solicitudes con su CAE para que el reintento lo reuse. Pendiente.

## F4.B — Reconciliacion Mantovana (2026-05-10)

Columna nueva: `notas_credito_debito.numero_afip BIGINT NULL` con UNIQUE parcial `uq_notas_numero_afip(id_empresa, codigo_tipo, punto_venta, numero_afip) WHERE numero_afip IS NOT NULL`. Source of truth para reportes IVA Ventas y reconciliacion con AFIP.

Reconciliacion ejecutada:
- 6 NCs huerfanas Mantovana 05/05/2026 registradas en BD (id_nota 25-30) con `numero_nota` local 13-18 y `numero_afip` real 7-12.
- id_nota=17 actualizada con `numero_afip=13` (drift de 1 confirmado).
- Camino II elegido: registro fiscal puro, sin movimiento de CC/factura/stock (las huerfanas no tuvieron efecto comercial real, solo fiscal).

Pendientes F4 (turnos futuros):
- **F4.B.2** Refactor `notas.helper.crearNotaConItems` y `notas.controller.crear` para grabar `numero_afip` desde el `proximoNum` de AFIP en futuras emisiones. Mientras esto no este, el drift seguira creciendo con cada NC sin CAE intermedia.
- **F4.B.3** Cargar archivo AFIP marzo a `stg_afip_emitidos_multi` para backfillear `numero_afip` de id_nota=11,12,13 (David Hernan y otras de marzo).
- **F4.B.4** Refactor reportes/impresion para preferir `numero_afip` sobre `numero_nota` cuando este disponible (PDF, panel UI, exports al contador).
- **F4.B.5** Aplicar mismo patron `numero_afip` a `facturas` y revisar drift en facturacion (probable que el mismo problema arquitectonico afecte facturas tambien).
- **F4.C** Emitir 6 ND compensatorias contra las 6 NCs huerfanas Mantovana.

Decision arquitectonica registrada: NO se renumera `numero_nota` historico de NCs viejas (Camino Y desde la decision del 10/05). `numero_afip` queda como source of truth para auditoria fiscal; `numero_nota` queda para compatibilidad con PDFs ya impresos. Reemision de PDFs historicos pendiente con contador.

## F4.C — Emision NDs compensatorias (2026-05-10)

Camino III ejecutado: script `/root/mi_erp/scripts_mantenimiento/emitir_nd_compensatorias_mantovana.js` (271 lineas, idempotente, usa `afip-auditoria.helper`).

Resultado:
- 6 NDs B PV6 emitidas en AFIP env=prod, autorizadas con CAE.
- 6 NCs huerfanas Mantovana anuladas en BD (estado='anulada').
- Tabla `afip_solicitudes` poblada por primera vez: 6 filas resultado='A', todas con duracion_ms registrada.
- Validacion funcional de F3-EXT en produccion: ✓ (pre-grabacion, registrar resultado, idempotency_key end-to-end).

Bug detectado y corregido durante F4.C:
- Columna `afip_solicitudes.cae_obtenido` renombrada a `afip_solicitudes.cae` para alinear naming con `notas_credito_debito.cae` y `facturas.cae`. Era inconsistencia introducida en F1 que el helper afip-auditoria no detecto hasta el primer uso real.

Estado fiscal Mantovana post-F4:
- 1 NC valida (id_nota=17, numero_afip=13, cae 86184268133392, $320480.22) - cancela factura origen 1181.
- 6 NCs anuladas (id_nota 25-30, numero_afip 7-12) + 6 NDs compensatorias (id_nota 31-36, numero_afip 1-6) = saldo fiscal neto cero.
- Drift fiscal AFIP↔BD para Mantovana: 0.

Pendientes F4 que SIGUEN ABIERTOS (no urgentes):
- **F4.B.2** Refactor `notas.helper.crearNotaConItems` y `notas.controller.crear` para grabar `numero_afip` desde el `proximoNum` AFIP en futuras emisiones (sin esto, drift sigue creciendo con cada NC sin CAE).
- **F4.B.3** Cargar archivo AFIP marzo a `stg_afip_emitidos_multi` para backfillear `numero_afip` de id_nota=11,12,13.
- **F4.B.4** Refactor reportes/impresion para preferir `numero_afip` sobre `numero_nota` (PDF, panel UI, exports).
- **F4.B.5** Aplicar mismo patron a `facturas` y revisar drift (probable mismo problema que en notas).
- **F3-EXT++** Implementar `consultarCAE` (FECompConsultar) automatico para cubrir el caso edge de proceso muerto entre solicitarCAE y registrarResultado.
- **Reemision PDFs historicos**: id_nota=17 tiene numero_nota=12 pero el PDF que entregaste a Mantovana decia 12. AFIP tiene esa NC con numero=13. Reemision de PDFs historicos pendiente con el contador.

## familia.*

| Clave | Tipo | Default LAGO | Estado | Descripción |
|---|---|---|---|---|
| `familia.padre_requiere_categoria` | bool | `true` | ✅ | Rechaza crear/actualizar padre con `id_categoria=NULL` (trigger BD lo impone) |
| `familia.heredar_categoria_de_hijo` | bool | `true` | ✅ | Si auto-importer crea padre sin cat, hereda del primer hijo |
| `familia.padre_excluido_venta_rapida` | bool | `true` | ⚠️ | Flag declarado, exclusión aún no implementada en búsqueda POS (TODO) |
| `familia.padre_sku_sufijo` | string | `-PADRE` | ⚠️ | Declarado, pero `productos-import.helper.js:622` aún hardcodea el sufijo (TODO) |

**Invariantes asociadas (verificadas 2026-05-11):**
- **P1**: padres son agrupadores puros, no vendibles.
- **P4 estricto**: padre.id_categoria === hijos.id_categoria. Validado por trigger BD `trg_validar_familia_categoria`.
- **P7**: catálogo compartido completo, sin flag por empresa.

**TODO post-fix (próximas sesiones):**
- Implementar exclusión de padres en búsqueda POS (`familia.padre_excluido_venta_rapida`).
- Parametrizar sufijo `-PADRE` leyendo de config (`familia.padre_sku_sufijo`).
- Encapsular `inicializarInventario` dentro de `crearProductoPadre` (defensa en profundidad para callers futuros — hoy lo hace solo el controller del importer).
- Validación en aplicación en `actualizarProducto`: rechazar `id_categoria=NULL` si tiene hijos activos (hoy lo cubre el trigger BD).
- Bloque 5 del Módulo Familia: modal manual en `productos.html` (autocomplete + mini-modal). Cuando se implemente, asegurarse que llame a `crearProductoPadre` con `id_categoria` no nula.


## web.familia.* / web.carrito.* / web.imagen.galeria_*
_Agregado: 2026-05-12 | Sesión: rediseño familia con galería_

| Namespace.Clave | Tipo | Default | Descripción | Estado |
|---|---|---|---|---|
| web.familia.imagen_padre_px | int | 180 | Tamaño slot imagen padre desktop | ✅ |
| web.familia.imagen_padre_px_mobile | int | 120 | Tamaño slot imagen padre mobile | ✅ |
| web.familia.subcategoria_como_agrupador | bool | true | Subcategorías hoja como header sutil | ✅ |
| web.familia.mostrar_descripcion_hijo | bool | true | Columna descripción en datagrid | ✅ |
| web.imagen.galeria_max | int | 8 | Tope imágenes en lightbox | ✅ |
| web.imagen.thumb_px | int | 64 | Tamaño miniaturas lightbox | ✅ |
| web.carrito.boton_plus_uno_visible | bool | true | Mostrar botón +1 al lado del input | ✅ |
| web.carrito.persistencia_input_modo | string | blur | Cuándo persiste el input | ✅ |
| web.carrito.indicador_guardado_ms | int | 1500 | Duración "✓ guardado" | ✅ |
| web.carrito.permitir_anonimo | bool | true | Input bidireccional para anónimos | ✅ |

### Deprecación pendiente
- `web.catalogo.imagen_slot_px` y `web.catalogo.imagen_slot_px_mobile`: del modelo viejo (slot por subcategoría). Se reemplazan por `web.familia.imagen_padre_px*`. Eliminar después de validar en producción.

## Namespace productos.import.* / productos.export.* (importación/exportación de productos)

_Agregado: 2026-05-12 | Sesión: feature subcategoría + import dinámico_

Feature de importación/exportación de productos con dos slots de clasificación (categoría + subcategoría, independientes entre sí) e imagen URL. Helper canónico nuevo: `src/utils/categorias.helper.js`. Cero parches, todo pasa por helper, todo trazado en `bitacora_catalogo`.

| Clave | Tipo | Default LAGO | Estado | Descripción |
|---|---|---|---|---|
| `productos.import.auto_crear_categorias` | bool | `false` | ✅ | Si `true`, el import crea categorías nuevas (siempre como raíz) cuando matchea por nombre normalizado y no existe. Si `false`, filas con categoría desconocida quedan sin asignar y aparecen en el preview |
| `productos.import.col_excel_categoria` | string | `categoria` | ✅ | Nombre de la columna del Excel que mapea a `productos.id_categoria` |
| `productos.import.col_excel_subcategoria` | string | `subcategoria` | ✅ | Nombre de la columna del Excel que mapea a `productos.id_subcategoria` (slot independiente, no anidado bajo `categoria`) |
| `productos.import.col_excel_imagen` | string | `url_imagen` | ✅ | Nombre de la columna del Excel con la URL de imagen del producto |
| `productos.import.validar_url_imagen` | bool | `true` | ✅ | Valida formato/accesibilidad de la URL antes de persistir como string en `productos.url_imagen` |
| `productos.export.incluir_subcategoria` | bool | `true` | ✅ | Incluye columna `subcategoria` en el Excel exportado |
| `productos.export.incluir_imagen_url` | bool | `true` | ✅ | Incluye columna `url_imagen` en el Excel exportado |

**Cambios de schema asociados (Bloque 1):**
- `productos.id_subcategoria INTEGER NULL` agregada. FK a `categorias(id_categoria)`.
- CHECK `chk_productos_cat_distinta_subcat`: `id_categoria <> id_subcategoria` cuando ambos definidos.
- Índices nuevos: `idx_productos_id_subcategoria` + `idx_productos_id_categoria` (este último faltaba históricamente y se aprovechó para crearlo).

**Limpieza pre-feature (Bloque 0.5):**
- 6 categorías del seed jerárquico desactivadas (ids 3, 6, 8, 9, 10, 11) por duplicación normalizada con sus equivalentes MAYÚSCULAS del import 2026-01-16. Cero productos movidos. Backups en `_bak_categorias_pre_merge_*` y `_bak_productos_cat_pre_merge_*`.

**Arquitectura del helper canónico (Bloques 2-3):**
- Helper nuevo: `src/utils/categorias.helper.js` con 7 funciones: `normalizarNombre`, `buscarRaizPorNombre`, `siguienteOrdenRaiz`, `crearCategoria`, `actualizarCategoria`, `desactivarCategoria`, `obtenerOCrear`.
- `crud.helper.js`: las 3 funciones de categoría son pass-through (delegan al canónico). 10 controllers consumidores no se enteran.
- Bitácora: nuevas acciones `categoria.crear`, `categoria.actualizar`, `categoria.desactivar` en `bitacora.helper.ACCIONES`.

**Bug latente conocido (heredado, no introducido por este feature):**
- `cfg.get` no es type-safe. El caller debe normalizar: `val === true || val === 'true'`.

**TODO post-feature (Bloques 5-8 de la misma sesión, pendientes):**
- Bloque 5: `productos-export.helper.js` — agregar 2 columnas (`subcategoria`, `url_imagen`) condicionales según configs.
- Bloque 6: `productos-import.helper.js` — resolver ambos slots vía `categorias.helper.obtenerOCrear`. Modificar `/import/preview` para devolver conteo de creaciones antes de aplicar.
- Bloque 7: Frontend dinámico — `productos.html`, `productos.js`, `inventario.html`, `reportes.html` (filtros + modal de edición). Reconectar checkbox huérfano `prodIE_auto_categorias` en `configuraciones.html` a la clave canónica.
- Bloque 8: Test end-to-end + cierre.
- Posterior (mini-sesión aparte): UNIQUE INDEX parcial sobre `(LOWER(TRIM(nombre)))` en categorías raíz activas — espera al refactor completo del helper para no romper UI manual.

## productos.invariante_familia_categoria_activo
- **Tabla**: `configuraciones_empresa` (id_empresa, clave, valor)
- **Default**: `false` (desactivado en LAGO desde 2026-05-12)
- **Valores**: `'true'` | `'false'`
- **Efecto**: Si `true`, el trigger `trg_validar_familia_categoria` exige que padre e hijos de un producto compartan `id_categoria`. Si `false` (default), padre e hijos pueden tener categorías distintas (cambio libre).
- **Origen**: Para ferreterías/corralones con productos genéricos y variantes diversas, la restricción es demasiado rígida. Una empresa que quiera enforzarla setea valor=`'true'`.
- **Implementación**: gate de configuración al inicio de la función PG `fn_validar_familia_categoria`.

## web.catalogo.* / web.imagen.* (catalogo B2B)

| Clave | Default LAGO | Tipo | Estado | Descripcion |
|---|---|---|---|---|
| `web.catalogo.imagen_nivel` | `padre_y_simple` | enum | ✅ | En que niveles del catalogo se muestra imagen. Valores: `padre_y_simple`, `padre_simple_y_hijo` (hook futuro). Categoria JAMAS. |
| `web.catalogo.imagen_fallback_orden_hijos` | `sort_key_asc` | enum | ⚠️ | Orden para el "primer hijo con foto" cuando el padre no tiene. Implicito en SELECT actual. Valores alternativos en backlog. |
| `web.imagen.herencia_familia` | `bidireccional` | enum | ✅ | Resolucion imagen padre↔hijo. Valores: `padre_hereda_hijo`, `hijo_hereda_padre`, `bidireccional`, `ninguna`. |

## ventas.precio.* — Redondeo de precios al consumidor (F1, 2026-05-18)

| Clave | Default LAGO | Tipo | Estado | Descripción |
|---|---|---|---|---|
| `ventas.precio.modo_soberano` | `BRUTO_ENTERO` | enum | ✅ | Qué columna es soberana. `BRUTO_ENTERO`: el operador carga precio con IVA entero, neto se deriva. `NETO_DECIMAL` (legacy): neto soberano, bruto calculado. |
| `ventas.precio.redondeo_modo` | `HACIA_ARRIBA` | enum | ✅ | Cómo redondear cuando el sistema calcula precio (aumento %, costo+margen, import). Valores: `HACIA_ARRIBA`, `MAS_CERCANO`, `PSICOLOGICO_990`, `PSICOLOGICO_99`. |
| `ventas.precio.redondeo_unidad` | `1` | int | ✅ | Múltiplo al que redondea el bruto. `1` = entero. `10` = decena. `100` = centena. |
| `ventas.precio.aplica_a_listas_costo` | `false` | bool | ✅ | Si listas con `redondea_con_iva=false` deben respetar la invariante. Default false (costo mantiene decimales para precisión de margen). |

### Claves deprecadas (migrar en F5)
- `venta.direccion_redondeo` → reemplaza `ventas.precio.redondeo_modo`
- `venta.redondeo_con_iva` → reemplaza `ventas.precio.redondeo_unidad`

## cc_prov.imputacion.* — Imputación posterior de pagos a proveedores

Permite aplicar saldo a favor (pagos a cuenta + notas de crédito) sobre comprobantes pendientes desde la misma pantalla `pagos-proveedores.html`.

| Estado | Clave | Tipo | Default LAGO | Descripción |
|--------|-------|------|--------------|-------------|
| ✅ | `cc_prov.imputacion.permitir_parcial` | boolean | `true` | Permite aplicar parte del saldo a favor a una deuda. |
| ✅ | `cc_prov.imputacion.exigir_motivo` | boolean | `false` | Exige motivo escrito al aplicar. |
| ✅ | `cc_prov.imputacion.exigir_motivo_revertir` | boolean | `true` | Exige motivo al revertir una aplicación. |
| ✅ | `cc_prov.imputacion.metodo_sugerido` | string | `vencimiento` | Orden sugerido para distribuir FIFO (`fifo` / `vencimiento` / `manual`). |
| ✅ | `cc_prov.imputacion.bloquear_pago_nuevo_si_hay_saldo_favor` | boolean | `false` | Bloquea cargar pago nuevo mientras haya saldo a favor sin aplicar. |
| ✅ | `cc_prov.imputacion.registrar_en_cc` | boolean | `true` | Registra movimiento informativo (`debe=0, haber=0`) en `cuentacorrienteproveedores` por cada aplicación. |

**Tabla nueva:** `aplicaciones_saldo_favor` (trazabilidad de imputaciones posteriores, con reversibilidad).
**Vista nueva:** `v_creditos_proveedor_disponibles` (créditos con `saldo < 0`, incluye `tipo='pago'` y `tipo='nota_credito'`).
**Endpoints nuevos:**
- `GET  /api/pagos-proveedores/creditos-disponibles/:id_proveedor`
- `POST /api/pagos-proveedores/aplicar-saldo-favor` (modo puro)
- `PUT  /api/pagos-proveedores/aplicaciones-saldo-favor/:id_aplicacion/revertir`
- `POST /api/pagos-proveedores` (existente) — ahora acepta `creditos_a_aplicar` opcional


## 2026-05-21 — Estado productos
- Permiso `editar_estado_productos` (permisos_usuario)
- Config `productos.estado.filtro_default` (configuraciones_empresa)
- Endpoint individual: PATCH /api/productos/:id/estado
- Endpoint masivo: POST /api/productos/activar-masivo
- Trazabilidad: usuarios_logs (accion = CAMBIAR_ESTADO_PRODUCTO | ACTIVAR_PRODUCTOS_MASIVO)

## web.familia.* — Patrón adaptativo de card padre con variantes

| Clave | Default LAGO | Tipo | Estado | Descripción |
|---|---|---|---|---|
| `web.familia.umbral_chips_max` | `8` | int | ✅ | Hasta N hijos: chips. Más: selector buscable. Setear `999` para apagar selector. |
| `web.familia.selector_placeholder` | `Buscá medida...` | string | ✅ | Placeholder del input de búsqueda del selector. |
| `web.familia.url_deep_link_habilitado` | `true` | bool | ✅ | Si `true`, URL `?hijo=SKU` autoselecciona la variante. |

Implementado: 2026-05-22 (Bloque A, Vista A catálogo principal).
Pendiente: Vista B (`?conjunto=corralon` tabla densa B2B) no aborda este patrón aún.

### Adición B-PRE3 (2026-05-22)
| Clave | Default | Tipo | Estado | Descripción |
|---|---|---|---|---|
| `web.familia.selector_mostrar_buscador` | `false` | bool | ✅ | Si `true`, muestra input de búsqueda dentro de la card del selector. Útil con padres de 50+ hijos. |

### Adición orden aleatorio (2026-05-22)
| Clave | Default LAGO | Tipo | Estado | Descripción |
|---|---|---|---|---|
| `web.catalogo.orden_default` | `aleatorio` | string | ✅ | Orden por defecto del catálogo cuando no hay búsqueda. Opciones: aleatorio, nombre-asc, nombre-desc, precio-asc, precio-desc, recientes. |
| `web.catalogo.orden_aleatorio_priorizar_imagen` | `true` | bool | ✅ | Si true, productos con imagen aparecen primero; luego aleatorio dentro de cada grupo. |

---

## Módulo NOTAS DE CRÉDITO/DÉBITO — namespace `notas.*`

| Clave | Tipo | Default | Estado | Descripción |
|---|---|---|---|---|
| `notas.permite_nc_con_remitos_activos` | boolean | `true` | ✅ | Item-por-item por disponible, no bloqueo grueso |
| `notas.cierra_pedido_al_cubrir_saldo` | boolean | `true` | ✅ | Dispara evaluarCierrePedido tras NC |
| `notas.estado_pedido_post_nc_completa` | integer | `6` | ✅ | Estado destino cuando al menos un item se entregó |
| `notas.estado_pedido_post_nc_sin_entrega` | integer | `10` | ✅ | Estado destino cuando ningún item se entregó |
| `notas.devolucion_requiere_forma_pago` | boolean | `true` | ✅ | Sobrepago→bloque devolución exige forma_pago |
| `notas.umbral_diferencia_ignorable` | numeric | `0` | ✅ | Sobrepagos menores no muestran bloque devolución |

### Invariantes de schema
- `nota_items.id_pedido_item REFERENCES pedidoitems(id_item) ON DELETE SET NULL` + idx
- `notas_credito_debito` CHECK `notas_origen_check`: origen IN (factura, presupuesto, manual, pedido)
- `notas_credito_debito` CHECK `notas_origen_coherencia`: origen=X ⇒ id_X_origen NOT NULL

### Endpoint nuevo
- `GET /api/notas/pedidos-credito-disponible?id_cliente=X`


---

## Namespace branding.* (visual de la empresa) — 2026-05-25 Sesión Navegación

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `branding.logo_url` | string | `/img/logo-lago.svg` | ✅ | Logo del header global |
| `branding.logo_url_oscuro` | string | (vacío) | ⚠️ opcional | Logo alternativo para fondo oscuro |
| `branding.favicon_url` | string | `/img/favicon.ico` | ✅ | Favicon de la pestaña |
| `branding.nombre_corto` | string | `LAGO` | ✅ | Texto del logo si no hay imagen |
| `branding.color_primario` | color | `#1a5f7a` | ✅ | Color de marca (header global) |
| `branding.color_secundario` | color | `#0d3b4f` | ✅ | Color complementario (gradientes) |
| `branding.mostrar_slogan` | bool | `true` | ✅ | Mostrar slogan en navbar |

## Namespace ui.* (preferencias UX) — 2026-05-25 Sesión Navegación

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `ui.tema_base` | enum | `lago_verde` | ✅ | Preset: lago_verde / corporate_blue / neutro |
| `ui.densidad_listado` | enum | `normal` | ✅ | compacta / normal / comoda |
| `ui.estrategia_color_modulo` | enum | `grupo` | ✅ | grupo (8) / individual (34) / ninguna |
| `ui.font_size_base` | int | `16` | ✅ | Tamaño base de fuente en px |
| `ui.navbar.tipo` | enum | `horizontal` | ✅ | horizontal / offcanvas / hibrido |
| `ui.navbar.sticky` | bool | `true` | ✅ | Navbar fija al scroll |
| `ui.navbar.mostrar_breadcrumb` | bool | `true` | ✅ | Breadcrumb en sub-nav |
| `ui.tabs_modulo.tipo` | enum | `subnav` | ✅ | subnav / tabs_internos / ninguno |
| `ui.grupo.<codigo>.color_acento` | color | (ver tabla) | ✅ | Override de `modulo_grupos.color_default` por empresa |
| `ui.modulo.<codigo>.color_acento` | color | (vacío) | ⚠️ activo si `ui.estrategia_color_modulo=individual` | Override por módulo individual |
| `ui.shortcut.guardar` | string | `F2` | ✅ | Tecla de guardado |
| `ui.shortcut.buscar_cliente` | string | `F3` | ✅ | Tecla búsqueda cliente |
| `ui.shortcut.refrescar` | string | `F5` | ✅ | Tecla refresco |
| `ui.shortcut.nuevo` | string | `Insert` | ✅ | Tecla nuevo registro |
| `ui.shortcut.cancelar` | string | `Escape` | ✅ | Tecla cancelar |
| `ui.shortcut.buscar_producto` | string | `Enter` | ✅ | Tecla búsqueda producto |

### Schema asociado a Sesión Navegación

- `modulo_grupos.color_default` (VARCHAR 7) — fallback global del color del grupo si la empresa no tiene override. Catálogo compartido (sin `id_empresa`).
- Endpoint canónico: `GET /api/ui/navegacion` (helper: `src/utils/navegacion.helper.js`, controller: `src/controllers/ui.controller.js`).
- CSS centralizado: `frontend/css/erp-lago-design-system.css` (convive con legacy `erp-lago-styles.css` hasta migración completa).

### Bugs de catálogo corregidos en esta sesión

- `admin-dispositivos.grupo`: `'administracion'` → `'admin'`
- `pedidos_web.codigo` (underscore) → `pedidos-web` (guion)
- `ver-comprobante-compra.activo`: `true` → `false` (página de detalle, no módulo del menú)
- `compras-listado.activo`: `true` → `false` (módulo huérfano)

### Defaults LAGO de acento por grupo

| grupo | hex |
|---|---|
| ventas | `#10b981` |
| despachos | `#8b5cf6` |
| inventario | `#f97316` |
| compras | `#3b82f6` |
| clientes | `#06b6d4` |
| tesoreria | `#f59e0b` |
| reportes | `#64748b` |
| admin | `#dc2626` |

## namespace: masivo.* (operaciones masivas sobre catálogo)

Sesión: 2026-05-25 — productos masivos fix.

| clave | estado | default LAGO | descripción |
|---|---|---|---|
| `masivo.motivo_obligatorio_desde` | ✅ | 50 | umbral a partir del cual el motivo es obligatorio en destructivas |
| `masivo.motivo_minimo_caracteres` | ✅ | 5 | mínimo de caracteres del motivo cuando es obligatorio |
| `masivo.tope_por_operacion` | ✅ | 5000 | tope duro — throw si `ids.length > tope` antes de ejecutar |
| `masivo.bitacora_incluir_ids` | ✅ | true | guardar array completo de ids_afectados en payload jsonb |
| `masivo.bitacora_incluir_valores_previos` | ✅ | true | guardar valores previos para reconstrucción |

## namespace: productos.* (catálogo compartido cross-empresa)

| clave | estado | descripción |
|---|---|---|
| `productos.activo` (columna BD, no config) | ✅ decisión cross-empresa | flag global del catálogo. Decisión consciente del owner. Cuando llegue empresa 2, comparte estado. NO se crea `producto_empresa_estado`. |
| `productos.visible_web` (columna BD, no config) | ✅ decisión cross-empresa | ídem `activo` — flag global del catálogo. |

## namespace: ajuste_masivo.* (preservado, no se toca)

| clave | estado | descripción |
|---|---|---|
| `ajuste_masivo.aplicar_redondeo_ar` | ✅ existente | activa redondeo argentino post-ajuste de precios |
| `ajuste_masivo.guardar_motivo` | ✅ existente | si true, persiste el motivo recibido (sino, autogenera) |
| `ajuste_masivo.estrategia` | ✅ existente | estrategia de ajuste de precios (ej: 2B costo+margen) |


## precios.* (F5-2026-05-26 -- fix redondeo venta-rapida)

- **precios.bruto_unitario_entero** | OK implementado | default `true` (LAGO) | tipo bool
  Si true, el precio_con_iva debe ser entero (sin centavos). Decision de negocio:
  en Argentina los precios son redondos (como Carrefour), centavos no sirven con dolar 1500.
  Para vendibilidad a empresas con productos con centavos, setear false.

### Cambios tecnicos en F5
- venta-rapida-script.js: 3x Math.round(x) a entero eliminados -- respeta total_linea/monto_iva del backend.
- borrador.controller.modificarItem: replica modo BRUTO_ENTERO (igual que agregarItem).
- pedidos.helper.actualizarItem: acepta monto_iva/total_linea precalculados (mismo contrato que crearItems).

### Deuda tecnica apuntada (sprint siguiente)
- BLOQUEANTE FISCAL: facturacion.helper.js:380-390 y :470-477 recalcula subtotal_linea = precio*cantidad
  ignorando pedidoitems.total_linea. Riesgo de divergencia BD vs CAE.
- BLOQUEANTE FISCAL: notas.controller.js:340, 368, 370 mismo patron. Probable causa de las 7 NC
  duplicadas de mayo 2026.
- PARCIAL: pedidos.helper.js::_recalcularItemsDesdeDescuentos recalcula desde precio_unitario_congelado
  cuando se aplica descuento general o ajuste FP. Reintroduce drift en pedidos con recargo de cuotas.
- PENDIENTE: presupuestos.controller.js:54 recalcula igual que notas.
- BLINDADO: carrito-web.helper.js, recargos.helper.js, listas-precios.helper.js usan redondeo a 2 decimales correctamente.

## Namespace `precios.*` — Pricing Engine F6 (Sprint A — 2026-05-27)

| Clave | Estado | Default LAGO | Tipo |
|-------|--------|--------------|------|
| precios.ancla_canonica | ✅ implementado | neto_unit | enum |
| precios.redondeo_modo | ✅ implementado | al_peso | enum |
| precios.redondeo_unidad | ✅ implementado | 1 | numeric |
| precios.bruto_mostrar_entero | ✅ implementado | true | bool |
| precios.engine.activo | ✅ implementado (OFF) | false | bool |
| precios.engine.consumidores_activos | ✅ implementado (vacío) | "" | csv |
| precios.tolerancia_drift_log | ✅ implementado | 0.10 | numeric |

**Infra A.0:** tabla `configuraciones_catalogo` (diccionario maestro de claves), vista `v_precios` (bruto derivado sin hardcodes, respeta listasdeprecios.redondea_con_iva).
**Infra A.1:** `src/utils/pricing-engine.helper.js` (funcion pura calcularLinea), endpoint POST /api/montos/calcular-linea (stateless, lee config precios.* por empresa).
**Eliminado A.0:** vista `v_productos_con_iva` (3 hardcodes), funcion `extraer_iva_de_precio` (2 hardcodes), config `precios.bruto_unitario_entero` (huerfana).
**Pendiente Bloque 2:** ALTER precision NUMERIC(14,4) en pedidoitems.precio_unitario_congelado, pedidoitems.precio_unitario_final, factura_items.precio_unitario, factura_items.precio_lista, nota_items.precio_unitario, presupuesto_items.precio_unitario, remito_items.precio_unitario.
**Pendiente Sprint B:** migracion gradual de consumidores al engine via feature flag (orden: borrador.agregarItem -> pedidos.helper -> facturacion.helper -> notas).

### Actualizacion 2026-05-28: Bloque 2 COMPLETADO
ALTER precision NUMERIC(14,4) aplicado en las 7 columnas de items (pedidoitems x2, factura_items x2, nota_items, presupuesto_items, remito_items). 5 vistas dependientes recreadas (v_detalle_pedido_items, v_pedidos_disponibles, v_pendientes_remitir, vista_historial_precios, v_pedidos_resumen) capturando su definicion exacta de la BD. Drift de precision eliminado para toda venta nueva. Pendiente unico: Sprint B (migracion de consumidores al engine via feature flag).

## Namespace terminal.* (terminales y dispositivos)

| clave | tipo | default LAGO | estado | descripción |
|---|---|---|---|---|
| `terminal.max_dispositivos_por_rol` | string (JSON) | `{}` (sin límite) | ✅ | Máximo de dispositivos activos por rol. JSON `{"<rol>": <int>}`. Vacío/0 = sin tope. Validado en seguridad-dispositivos.helper.validarLimiteRol antes de autorizar. |

### Notas terminal.* (2026-06-01 — módulo Dispositivos)
- Trazabilidad: autorizar/rechazar/desactivar/reactivar/baja registran en `usuarios_logs` (acción + detalle + ip_origen + admin).
- `dispositivos_autorizados` pasó a baja lógica: columnas `estado` ('activo'|'baja'), `fecha_baja`, `baja_por`, `motivo_baja`. Se eliminó el DELETE físico.
- `autorizarDispositivo` y `eliminarDispositivo` (baja) son transaccionales (BEGIN/COMMIT/ROLLBACK).
- PENDIENTE: panel de auditoría (vista v_dispositivos_auditoria + tabs), alerta de dispositivos dormidos (clave `terminal.dispositivo_dormido_dias`), visualización de forcejeo/duplicados de fingerprint.

### Cobertura de dispositivos (2026-06-01 — vista nueva)
- Endpoint `GET /dispositivos/cobertura` (auth.routes, registrado ANTES de rutas :param para evitar shadowing). Handler `auth.controller.obtenerCoberturaDispositivos` (solo admin).
- Helper `seguridad-dispositivos.helper.obtenerCobertura(client, id_empresa)`: lista todos los usuarios + dispositivos activos + límite del rol, clasifica estado_cobertura.
- Reglas: admin/administrador => EXENTO (anti-lockout, confirmado en login línea ~31). inactivo => INACTIVO. no-admin activo sin dispositivo => SIN_DISPOSITIVO. supera límite del rol => EXCEDE. resto => OK.
- Frontend: 3er tab "Cobertura" en admin-dispositivos.html con tabla coloreada + export CSV (sep ';', BOM UTF-8).
- Reutiliza `terminal.max_dispositivos_por_rol` (no agrega claves nuevas).

### Bugs corregidos en admin-dispositivos.html (2026-06-01, preexistentes)
- `fetchAPI` usaba localStorage (vacío) → migrado a cookie via `credentials:'include'`. Afectaba TODAS las acciones del panel.
- Texto de cards invisible (gris heredado sobre bg-dark) → CSS forzando color legible.

### Pendiente de seguridad detectado (no resuelto)
- 🔥 Login saltea control de dispositivo si el cliente NO envía `fingerprint` (auth.controller: `if (requiereValidacion && fingerprint && !esAdmin)`). Un login sin fingerprint evita el control aunque requiere_validacion_dispositivo=true. Fix propuesto: rechazar si `requiereValidacion && !fingerprint && !esAdmin`.
- ✅ cc_prov.libro.items_por_pagina — filas por página del libro mayor de proveedores (default: 50, tipo: entero)

## despachos (búsqueda de viajes) — 2026-06-23
- ✅ `despachos.viajes_limit_busqueda` — límite de resultados cuando hay texto de búsqueda / default `100` / int
- ✅ `despachos.viajes_limit_listado` — límite del listado sin texto / default `200` / int

## importacion
- ✅ `importacion.precio_neto_maximo` — techo precio_neto_calculado (default LAGO 99999999) — validado en preview de import

- ✅ `importacion.padre.palabras_medida` — palabras de medida a quitar al derivar nombre del padre (default LAGO: mm,cm,x,u,un,kg...)

## cc.* — Libro Mayor CC Clientes (F0 2026-07-03)
- ✅ cc.libro.items_por_pagina — paginado del libro (default 50)
- ✅ cc.cobro.permitir_parcial — imputación parcial (default true)
- ✅ cc.cobro.exigir_turno — turno obligatorio para cobrar (default true)
- ✅ cc.cobro.imputacion_sugerida — orden de precarga (default antiguedad)
- ✅ cc.resumen.mostrar_logo — logo en resumen imprimible (default true)

## configuraciones.* — namespace NUEVO (meta-config del panel)
- ✅ configuraciones.ui.dias_badge_nuevo — badge NUEVO en panel (default 30)
- ✅ empresa.logo_url — logo en documentos imprimibles (default vacío = texto)
- ✅ cc.resumen.whatsapp_plantilla — mensaje pre-armado botón WhatsApp (placeholders {fecha} {saldo})
- ✅ ui.navbar.accesos_rapidos — links rápidos de la barra superior (CSV de códigos de módulo)
- ✅ ui.navbar.mostrar_deshabilitados — módulos sin permiso visibles en gris (true) u ocultos (false)

## ventas.* (sesión 2026-07-06)
- ventas.items_negativos_habilitados — ❌ pendiente (comportamiento hoy fijo: habilitado; parametrizar cuando el código lo lea)
- ventas.confirmar_items_negativos — ❌ pendiente (confirm hoy siempre activo)

## proveedores.identidad.* — Candado de identidad en alta (2026-07-15)
| Clave | Estado | Default LAGO | Tipo | Descripcion |
|---|---|---|---|---|
| proveedores.identidad.umbral_similitud | ✅ implementado | 0.45 | numeric 0-1 | Similitud trigram que bloquea el alta sugiriendo el proveedor existente. Mas alto = mas permisivo con nombres parecidos. |
| proveedores.identidad.validar_cuit | ✅ implementado | true | boolean | Exige digito verificador valido en CUITs verosimiles (11 digitos variados). Placeholders (vacio/ceros) pasan siempre. ⚠ Especifico de Argentina: al vender fuera de AR, migrar a validador seleccionable bajo localizacion.* |

## productos.import.* — Convenciones de formato (2026-07-14)
| Clave | Estado | Default LAGO | Tipo | Descripcion |
|---|---|---|---|---|
| productos.import.margen_como_multiplicador | ✅ implementado | true | boolean | Margen_listaN del Excel como multiplicador (1.40 = +40%). En false: porcentaje directo (40 = 40%). Rango validado 1.0-5.0 en preview. |
| productos.import.descuento_como_factor | ✅ implementado | true | boolean | Descuento_Proveedor_% como factor (0.75 = pagas 75% = 25% desc). En false: porcentaje directo. Rango validado (0,1] en preview. |

## compras.form.* — Pendientes del toggle (Entrega B)
| Clave | Estado | Default LAGO | Tipo | Descripcion |
|---|---|---|---|---|
| compras.form.modo_precio_default | ❌ pendiente | neto | enum neto/con_iva | Estado inicial del toggle "Mostrar precios c/IVA" en el form de compras. Hoy resuelto solo con localStorage. |
