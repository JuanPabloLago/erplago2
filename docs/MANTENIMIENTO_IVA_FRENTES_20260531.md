# MANTENIMIENTO — Corrección integral de IVA / productos exentos (0%)

**Fecha:** 2026-05-31
**Sistema:** ERP LAGO (Node/Express + PostgreSQL `erplago`, multiempresa). PM2 `erplago`, puerto 3000.
**Estado:** Frentes 1, 2 y 3-núcleo COMPLETOS y en producción. Frente 4 → contador. Barrido de higiene pendiente.

---

## 0. GUÍA DE LECTURA PARA CLAUDE (próxima sesión)

- El trabajo de esta sesión corrigió cómo el ERP trata el **IVA 0% (exento)** en tres capas: datos, alta de productos y el detalle de IVA que se envía a AFIP.
- **El bug central NO era el mapeo de alícuotas** (ese estaba bien). Era el operador `|| 21` en JavaScript: `0 || 21 === 21`, que convertía un IVA 0% legítimo en 21%. Distinción clave: los `COALESCE(a.porcentaje, 21)` en SQL NO tienen ese bug (`COALESCE(0,21)=0`); solo los `|| 21` en JS son peligrosos con exentos.
- Antes de tocar cualquier `|| 21` restante: correr el gate de regresión (sección 5) y confirmar que solo cambian los exentos.
- Doctrina vigente: todo cálculo de IVA pasa por `src/utils/iva.helper.js`. Cualquier `*1.21`, `/1.21`, `|| 21` fuera de ahí es bug.

---

## 1. DIAGNÓSTICO (causa raíz)

**Síntoma:** 9 productos quedaron cargados en alícuota 0% (id_alicuota=1) por error de carga; 14 ítems ya se habían vendido a 0%.

**Por qué quedaron a 0%:** el `<select id="idAlicuotaIva">` del frontend (`frontend/js/productos.js`) se llenaba con `llenarSelect(...)` sin placeholder, dejando seleccionada la PRIMERA opción = 0%. Si el usuario no tocaba el select, el front mandaba `id_alicuota_iva = 1` explícito, que pisaba el default 21% de la BD.

**El bug fiscal:** en `afip.service.js` → `agruparIVAPorAlicuota`, la línea resolvía el porcentaje con `parseFloat(item.porcentaje_iva || item.iva_aplicado || 21)`. Para un exento (0), `0 || 0 || 21 = 21` → se agrupaba como 21% en el detalle enviado a AFIP.

**Lo que NO era el problema (importante):** la función `alicuotaAFIP` (mapeo porcentaje→código AFIP) YA tenía la entrada `0: 3` correcta. El mapeo nunca recibía el 0 porque el `|| 21` lo pisaba antes. NO se tocó el mapeo.

**Backend ya estaba bien:** `crearProductoCompleto` (productos.helper.js) resuelve la alícuota vía `ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa)` cuando el caller no la pasa (lee config `productos.alicuota_iva_defecto`=3). La columna `productos.id_alicuota_iva` es NOT NULL con default 3. La grieta era SOLO el frontend.

---

## 2. FRENTE 1 — Corrección de datos  [COMPLETO]

- `UPDATE productos SET id_alicuota_iva=3 WHERE id_producto IN (12135,12031,12097,12096,12030,12136,11872,12039,12037) AND id_alicuota_iva=1;`
- Resultado: `productos_iva_0 = 0`. Todos a 21%.
- Backup: `/root/mi_erp/_backups_iva_datos_20260530_092442.csv`
- Nota: `prod_prueva` (id 11872) es producto de testing; quedó a 21%. Evaluar borrar/desactivar (verificar FKs antes de borrar).

---

## 3. FRENTE 2 — Causa raíz (alta de productos)  [COMPLETO]

Archivo: `frontend/js/productos.js` (NO `src/`; es estático, no requiere PM2 restart, sí Ctrl-F5).

- Línea 259: `llenarSelect('idAlicuotaIva', ..., 'nombre', 'Seleccionar IVA')` → el alta arranca SIN IVA elegido (placeholder).
- Línea 1126 (editarProducto): quitado `|| 3` → precarga el IVA real del producto.
- Línea 1196 (guardarProducto, payload): `value || 3` → `value || null` (si no elige, el backend resuelve el default de config).
- Línea ~1170 (guardarProducto, inicio): bloqueo agregado: `const _ivaSel = document.getElementById('idAlicuotaIva').value; if (!_ivaSel) { alert('Falta elegir el IVA del producto.'); return; }`
- Backups: `productos.js.bak.fix_iva_20260531_194306`, `productos.js.bak.bloqueo_iva_20260531_200723`
- Validado: `node --check` OK.

Defensa en 3 capas resultante: front (placeholder + bloqueo) → backend (resuelve null vía ivaHelper) → BD (NOT NULL default 21).

Pendiente menor opcional: `generarCamposPrecios` (productos.js ~1289) tiene `|| 3` y `: 21` de PREVIEW visual (no persiste, no fiscal) — barrer con el Grupo C.

---

## 4. FRENTE 3 — Camino fiscal a AFIP  [NÚCLEO COMPLETO]

Gate de regresión (SQL, ver sección 5): de 4134 líneas de factura_items + 25 de nota_items, SOLO 2 líneas cambian (los exentos de facturas 1666 y 1724, código AFIP 5→3). Todo el 21% queda idéntico. Verde.

Cambios aplicados:
- `src/services/afip.service.js`, `agruparIVAPorAlicuota` (~línea 428):
  - ANTES: `const pct = parseFloat(item.porcentaje_iva || item.iva_aplicado || 21);`
  - AHORA: `const _pctRaw = item.porcentaje_iva ?? item.iva_aplicado;` + throw si null/NaN + `const pct = parseFloat(_pctRaw);` → respeta el 0.
- `src/controllers/ventas-consulta.controller.js` (líneas 225 y 235): quitado `|| 21` (`porcentaje_iva: item.iva_aplicado`).
- Backups: `afip.service.js.bak.iva_20260531_204655`, `ventas-consulta.controller.js.bak.iva_20260531_204655`
- `node --check` OK en ambos. PM2 restart aplicado (servidor online, DB OK).
- NO se tocó `alicuotaAFIP` (ya tenía 0→3).

---

## 5. PENDIENTE

### 5.1 Frente 4 — Facturas B con IVA sub-declarado  [ACCIÓN: CONTADOR] ⚠️

Dos facturas B emitidas con un ítem exento que debía ser 21% → IVA débito declarado de menos a AFIP:
- Factura 1724 (`0006-00001720`, pedido 9474, producto 12135 amoladora, 160000): IVA omitido ≈ **27.768,60**.
- Factura 1666 (`0006-00001664`, pedido 8476, producto 12037 trampa, 2000): IVA omitido ≈ **347,11**.
- Total ≈ **28.116** de débito fiscal sub-declarado.

El total cobrado al cliente fue correcto (factura B, IVA incluido); lo que quedó corto es el desglose neto/IVA del comprobante y del libro IVA ventas. CAE inmutable. **NO se corrige por código ni BD** (sería falsear un comprobante). Decisión del contador: NC + refacturación, o ajuste en DDJJ.

### 5.2 Barrido de los `|| 21` restantes — Grupo A (higiene, SIN urgencia)

El gate confirmó que hoy NINGUNO emite mal (todo lo no-exento es 21%). Sacar por doctrina. Revisar cada uno con su contexto antes de tocar (algunos alimentan persistencia de factura_items/nota_items, otros el array AFIP):
- `src/controllers/facturas.controller.js`: 285, 612, 848
- `src/controllers/notas.controller.js`: 130
- `src/utils/notas.helper.js`: 264, 293, 412, 468
- `src/utils/facturacion.helper.js`: 382, 472

Patrón del fix: `|| 21` (JS) → `??` respetando 0, o quitar fallback. Los `COALESCE(a.porcentaje, 21)` en SQL NO se tocan por el 0 (no tienen el bug), aunque conviene unificarlos por doctrina.

### 5.3 Grupos B / C / D (menor prioridad, display/no-AFIP e importación)

- Grupo B (comprobantes c/IVA no-AFIP): `remito-pdf.controller.js:100`, `presupuestos.controller.js:57` + `presupuestos.helper.js:204`, `despachos.controller.js:522`, factor `1.21` en `print-worker.js:108,109`.
- Grupo C (display/web): `catalogo-web.controller.js` (146,150,199,201,236,237,462,463), `carrito-web.helper.js:66,266`, `borrador.controller.js:190`, `listas-precios.controller.js:308` + `listas-precios.helper.js:286`.
- Grupo D (importación masiva): `productos-import.controller.js:236,314` + `productos-import.helper.js:195,215,252`, `productos.controller.js:410,420`, `importacion-precios.helper.js:338`. (El alta por panel ya está blindada; esto es solo el import por Excel.)

### 5.4 Refactor OPCIONAL: mapeo alicuotaAFIP → BD (robustez futura)

`alicuotaAFIP` (afip.service ~407) usa mapeo hardcodeado `{0:3, 2.5:9, 5:8, 10.5:4, 21:5, 27:6}` + `|| 5`. Está correcto HOY. Riesgo a futuro: una alícuota nueva caería al `|| 5` (21%). La columna `alicuotasiva.codigo_afip` ya tiene los valores. Diseño pensado: cargar el mapa en `cargarConfiguracion` (afip.service:453) y dejar un default completo en el `config` de módulo (línea 48); `alicuotaAFIP` lee `config.mapaAlicuotasAFIP` y falla en vez de `|| 5`. NO toca callers (config es variable de módulo). Decisión del dueño, sin urgencia.

### 5.5 Prolijidad

- Basura en raíz de `/root/mi_erp/`: archivos con nombres de comandos mal pegados (`'a remover ==="'`, `'ql -h localhost...'`, etc.). Barrer.
- Acumulación de backups `.bak` de `productos.js`.

---

## 6. REFERENCIA TÉCNICA

**Tabla alicuotasiva** (id | % | codigo_afip):
1 | 0% | 3   ·   6 | 2.5% | 9   ·   5 | 5% | 8   ·   2 | 10.5% | 4   ·   3 | 21% | 5   ·   4 | 27% | 6

**Config:** `productos.alicuota_iva_defecto = 3` (empresa 1).

**Helpers IVA:** `ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa)` (lee config, falla si no está); `ivaHelper.obtenerIvaProductosBatch(client, ids)` (trae porcentaje + codigo_afip por producto, sin N+1).

**Persistencia:** `factura_items.porcentaje_iva` (default 21) y `nota_items.iva_porcentaje` (default 21) guardan el IVA por línea con el que se emitió.

**Protocolo:** `source ~/.nvm/nvm.sh` antes de node/pm2. `node --check` antes de `pm2 restart erplago`. Backup antes de tocar. Patches con Python + `assert count==1` (nunca sed sobre JS). Backups CSV con `COPY (...) TO STDOUT` + redirect (postgres no escribe en /root).

**GATE DE REGRESIÓN (re-correr antes de tocar más `|| 21`):**
SELECT fi.porcentaje_iva, COUNT(*),
  (CASE fi.porcentaje_iva WHEN 0 THEN '5' WHEN 2.5 THEN '9' WHEN 5 THEN '8' WHEN 10.5 THEN '4' WHEN 21 THEN '5' WHEN 27 THEN '6' ELSE '5' END) AS codigo_viejo,
  a.codigo_afip AS codigo_nuevo
FROM factura_items fi LEFT JOIN alicuotasiva a ON a.porcentaje = fi.porcentaje_iva
GROUP BY fi.porcentaje_iva, a.codigo_afip ORDER BY fi.porcentaje_iva;
-- Esperado: 21% IGUAL (5=5), 0% CAMBIA (5->3). Cualquier otro CAMBIA = frenar.
