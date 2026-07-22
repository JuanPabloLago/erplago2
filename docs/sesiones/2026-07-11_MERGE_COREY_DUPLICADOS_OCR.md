# Merge proveedores COREY duplicados por OCR — 2026-07-11

## Causa raiz
factura-foto da de alta proveedores con el CUIT leido por OCR sin validar
digito verificador ni matchear por nombre. 7 fotos de COREY = 7 CUITs basura
distintos = 7 proveedores (el UNIQUE id_empresa+cuit no salta porque cada
CUIT erroneo era "nuevo"). Solo 2 de 7 CUITs basura pasaban el checksum:
el checksum solo no alcanza, hace falta match por nombre ademas.

## Accion ejecutada
- Sobreviviente: id 22 (CUIT 30-68846046-4, valido por checksum, PENDIENTE
  confirmar contra factura papel).
- Migradas 11 tablas FK: comprobantes_compra(6), cuentacorrienteproveedores(2),
  cuentas_por_pagar(1), pagosaproveedores(1), resto sin filas.
- Clones 24,27,28,32,36,48 -> activo=false, CUITs basura permanecen en fila
  (NOT NULL en proveedores.cuit impide liberar; snapshot documenta).
- Trazabilidad: tabla _backup_merge_corey_20260711 (7 registros completos).
- Backup previo: /root/backups/pre_merge_corey_20260710_025702.sql (12 tablas).

## Lecciones de protocolo (incorporadas)
1. Guardas SQL: DO $$ RAISE EXCEPTION, nunca 1/0 en CASE (constant folding
   lo evalua en planning y explota siempre).
2. Entrega de SQL por SSH: base64 -> decode -> MD5 gate contra hash del
   original -> psql -f desde /tmp (postgres no lee /root, permisos 700).
3. Verificar schema COMPLETO antes de escribir: information_schema con
   is_nullable incluido (proveedores.cuit NOT NULL; observaciones no existe).

## Pendientes que abrio esta sesion
- [ ] CUIT real de COREY contra factura papel (UPDATE 1 linea si difiere)
- [ ] EMECO id 23 vs 31: decidir si son el mismo (near-dup, no exact match)
- [ ] Comprobantes 79 y 133 con fecha_emision 2020 (OCR? el 133 es $5.3M)
- [ ] Frente 2: validarCuit + match trigram + config compras.foto.alta_proveedor_auto
- [ ] Frente 3: import productos -> producto_proveedor (8.800 huerfanos) + preview honesto
- [ ] Toggle neto/c-IVA en form compras + select de alicuotas desde BD (hoy hardcoded 21/10.5/27)

---
## ADDENDUM 2026-07-14 — Margenes negativos + convenciones de formato

### Margenes negativos (322 productos): CAUSA IDENTIFICADA, correccion MANUAL
- Causa: costo en unidad del PROVEEDOR (bolsa x50, precio por metro) vs precio
  de venta en unidad LAGO. Ej RE78A: bolsa de 50 a $770,88 neto = $15,42/u,
  venta $49,59/u = margen real +220%, sistema muestra -96%.
- Ratios de empaque detectados: 7,8,9,10,15,16,17,18,21,50...
- Se evaluo modelo factor_conversion en producto_proveedor: DESCARTADO por
  decision del owner (2026-07-14). Correccion manual, criterio: cargar costos
  en Excel ya divididos por empaque (unidad de venta LAGO).
- RIESGO ACEPTADO (decision owner): NO ejecutar "Recalcular lista" sobre
  productos con margen_individual negativo hasta corregirlos — el recalculo
  aplicaria costo*(1-96/100) y desploma precios. Los 82 con ratio 1 son
  ademas candidatos a costo viejo (revisar con lista en mano).

### Convenciones de formato en import (desplegado)
- Margen_listaN acepta multiplicador: 1.40 -> guarda 40 (%). Rango 1.0-5.0,
  fuera de rango = error en preview.
- Descuento_Proveedor_% acepta factor: 0.75 -> guarda 25 (%). Rango (0,1],
  0 = sin descuento, >1 = error en preview.
- Claves config: productos.import.margen_como_multiplicador y
  productos.import.descuento_como_factor (default true en codigo; INSERT en
  configuraciones_empresa PENDIENTE de ver schema).

---
## ADDENDUM 2026-07-15 — Toggle c/IVA + F2a candado de identidad (DESPLEGADOS)

### Toggle neto/c-IVA en compras (Entrega A)
- Checkbox "Mostrar precios c/IVA" en grilla de items. Presentacion pura:
  modelo en memoria y BD siempre NETO. Convierte precarga, chip Ult y lectura
  de tipeo; cambio de alicuota en modo c/IVA fija el mostrado y re-deriva neto.
- Fix colateral: parseFloat(x)||21 impedia seleccionar IVA 0% (ahora isNaN).
- Preferencia de vista en localStorage (compras_modo_precio).
- PENDIENTE Entrega B: select de alicuotas desde BD (hardcode 21/10.5/27) +
  clave compras.form.modo_precio_default.

### F2a — Candado de identidad en alta de proveedores
- Nuevo src/utils/proveedores-identidad.helper.js (evaluarAltaProveedor):
  (1) CUIT verosimil (11 digitos variados) con checksum invalido => BLOQUEA
      (firma de OCR basura). CUIT placeholder/vacio/ceros => pasa (changas).
  (2) similarity() trigram >= umbral contra activos => BLOQUEA con sugerencia
      "Ya existe similar: X (id N, %)". Propone, no adivina.
- Conectado DENTRO de crud.helper.crearProveedor (unico INSERT del sistema,
  callers: alta-rapida compras + ABM proveedores). Bypass consciente:
  omitir_validacion_identidad=true.
- Claves: proveedores.identidad.umbral_similitud (0.45) / validar_cuit (true).
  Ademas saldadas productos.import.margen_como_multiplicador y
  descuento_como_factor (deuda del patch de formatos).
- Con esto, los 4 incidentes de la semana (COREY x7, MAKAO, HORNERO, PP)
  tienen su causa raiz de ALTA cerrada. El MATCH tolerante es F2b (pendiente).

### Cola actualizada
- [ ] F2b: match en cascada (CUIT > exacto activo > sugerencia trigram) en
      imports + cartel agregado en preview (precios_compra_sin_proveedor)
- [ ] Toggle Entrega B (alicuotas desde BD + config default)
- [ ] Menores: EMECO 23/31, facturas 79/133 fecha 2020, CUIT papel COREY,
      BS10 precio $0, leerNumero trunca enteros, variantes sin normalizarNumero
