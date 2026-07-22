# AUDITORIA — Bug duplicación de Notas de Crédito (07/03 → 05/05/2026)

**Generado:** 2026-05-10
**Período auditado:** 02/04/2026 a 09/05/2026 (xlsx AFIP "Mis Comprobantes Emitidos")
**Empresa:** id_empresa=1 (LAGO), CUIT 20-29628492-1
**Severidad:** CRITICA (drift fiscal > 60 días, $335k IVA mal acreditado a 3 clientes)

---

## 1. Resumen ejecutivo

El módulo de emisión de Notas de Crédito generó comprobantes fiscalmente válidos en AFIP que NO quedaron registrados en la BD del ERP, en al menos 3 ocasiones reales (06/03, 07/04, 05/05/2026). El caso del 05/05 a LA MANTOVANA SERVICIOS GENERALES (CUIT 30-69605181-6) generó 7 NCs B PV6 idénticas por $320.480,22 c/u; solo 1 quedó en BD. Las otras 6 son huérfanas: existen en AFIP, no existen en el ERP, irreversibles desde el WS AFIP.

Causa raíz: la transacción de emisión NO es atómica entre AFIP (autorización irreversible) y BD (commit local), no hay idempotency-key, frontend sin defensa contra reintentos, y a las 15:17 del 05/05 había un bug de configuración (require('../config/database') apuntaba a módulo inexistente, fixeado a la madrugada del 06/05 cambiando a '../config/db') que disparaba ROLLBACK consistente después de obtener CAE.

Daño fiscal mínimo: 8 NCs B fantasmas en AFIP, $335.805,52 de IVA acreditado a clientes sin contrapartida real.

## 2. Cronología del incidente Mantovana 05/05/2026

| Hora aprox | Evento | AFIP | BD |
|---|---|---|---|
| 15:14 | Emisión Factura B PV6 #1177 (error: cliente RI corresponde A) | CAE 86184252279561 | id_factura=1181 OK |
| 15:15 | Click "Emitir NC" intento 1 | CAE 86184256089569 (NC #7) | ROLLBACK por bug pool=undefined |
| 15:15 | Click intento 2 | CAE 86184256121471 (#8) | ROLLBACK |
| 15:15 | Click intento 3 | CAE 86184256230726 (#9) | ROLLBACK |
| 15:15 | Click intento 4 | CAE 86184256309493 (#10) | ROLLBACK |
| 15:16 | Click intento 5 | CAE 86184256531231 (#11) | ROLLBACK |
| 15:16 | Click intento 6 | CAE 86184257017818 (#12) | ROLLBACK |
| 15:17:31 | Click intento 7 | CAE 86184268133392 (#13) | id_nota=17 COMMIT OK |
| 15:18 | Emisión Factura A PV6 #15 (correcta) | CAE 86184276823396 | id_factura=1184 OK |

11 minutos entre intento 6 y 7 confirma reintento manual, no retry automático.

## 3. Patrón histórico

| Fecha | Cliente | NCs AFIP | NCs BD | Sobrantes | IVA mal otorgado |
|---|---|---|---|---|---|
| 06/03/2026 | LAGO, DAVID HERNAN (hermano del titular, ventas reales) | 3 sobre id_factura=22 | 3 con CAE | 2 | $2.082,34 |
| 07/04/2026 | Sin receptor (CUIT=0 en AFIP) | 2 NC sin receptor $379.399,98 c/u | 2 sin CAE distinto monto | hasta 2 | hasta $131.705,57 |
| 05/05/2026 | LA MANTOVANA (CUIT 30-69605181-6) | 7 | 1 | 6 | $333.723,18 |

El bug es estructural y crónico, no es regresión reciente.

## 4. Causa raíz (5 fallas alineadas)

### 4.1 Transacción AFIP↔BD no es atómica
Orden en notas.controller.js: ultimoComprobante AFIP → solicitarCAE AFIP (irreversible) → INSERT BD → COMMIT. Cualquier fallo entre paso 2 y 4 deja CAE huérfano.

### 4.2 Bug de configuración activo el 05/05
notas.helper.js línea 36 antes del 06/05: const pool = require('../config/database'). Módulo no existe. Fixeado el 06/05 01:59 cambiando a '../config/db'. Único cambio del helper esa noche según diff.

### 4.3 Cero idempotencia
POST /notas no recibe idempotency-key. notas_credito_debito sin UNIQUE sobre (id_empresa, id_factura_origen) ni sobre token cliente. notas.controller.crear no consulta "ya existe NC con CAE para esta factura origen?" antes de llamar AFIP.

### 4.4 Frontend sin defensa
notas.js: handler del botón Emitir no deshabilita el control mientras POST está en vuelo, no debounce, no genera idempotency-key.

### 4.5 Cero auditoría persistente de llamadas AFIP
afip_solicitudes no existe. comprobantes_afip existe pero abandonada (4 filas totales, ninguna de Mantovana). Logs PM2 rotaron. Sin traza del 05/05 15hs.

## 5. Hallazgos colaterales del schema

- facturas no tiene id_usuario (cero auditoría de quién emitió).
- pagos no tiene id_usuario (idem).
- recargos.helper.js:152 hace INSERT directo a notas_credito_debito saltando el helper canónico (violación SRP, segundo write point).
- 8 claves de configuración AFIP en formato plano afip_xxx con guion bajo (anti-vendibility).

## 6. Plan de corrección (resumen)

1. Tabla afip_solicitudes (CREATE IF NOT EXISTS, single source of truth de llamadas WS AFIP).
2. Idempotency-key cliente-generada + UNIQUE constraint multi-empresa en notas_credito_debito.
3. Pre-check en controller "ya existe NC con CAE para esta id_factura_origen?" antes de llamar AFIP.
4. Frontend disable-while-loading + reuso idempotency-key en reintentos.
5. Eliminar INSERT directo en recargos.helper.js, usar helper canónico.
6. Agregar id_usuario a facturas y pagos.
7. Migrar namespace afip_* (8 claves) a afip.* + 9 claves nuevas.
8. Reconciliación: 8 ND B compensatorias contra los NCs fantasmas.
9. Actualizar docs/MAPEO_VENDIBILIDAD.md.
10. Backup BD pre-DDL + rollback documentado.

## 7. Riesgo fiscal y acciones inmediatas

Riesgo emisor: 8 NCs sobrantes redujeron débito fiscal del libro IVA Ventas en $335k. Si AFIP cruza con clientes que usaron el crédito, la diferencia es imputable como ajuste con intereses y multa.

Riesgo receptores: hermano (David Hernán), Mantovana, y receptores indeterminados de las 2 NCs CF abril podrían tener crédito fiscal mal computado.

Acción correctiva: emitir 8 ND B compensatorias por el mismo monto, motivo "Anulación de NC duplicada por error sistémico, ref CAE original". Restaura débito fiscal del lado del emisor. Antes de la próxima presentación de IVA Ventas mensual.

## 8. Pendiente sin resolver

- Archivo eliminado con CUIT 20-35041631-6. Sin información del usuario. No bloqueante.

---

**Estado:** investigación cerrada. Diseño + ejecución pendientes.
