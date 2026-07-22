# Cadena de descuentos con signo (descuento + recargo)

**Fecha:** 2026-05-05
**Tag:** cadena_neg

## Problema
Modal "Descuentos en cadena" en Compras solo aceptaba positivos.
Caso real: proveedor da 29% de descuento + 21% de recargo financiero por plazo de pago.
Equivalente correcto: 1 - (1-0,29)*(1-(-0,21)) = 14,09% de descuento neto.
Antes se mostraba 29% (ignoraba el recargo).

## Causa raiz
1. frontend/compras.html: input min="0" bloqueaba negativos en HTML5.
2. frontend/js/compras.js:
   - calcularDescuentoEquivalente: if (d < 0) d = 0 (clamp explicito).
   - leerInputsCadena: if (!isNaN(v) && v > 0) (filtraba negativos).
   - formatearCadenaTooltip: filter(d => d > 0).
   - abrirModalDescuentosCadena: prev[i-1] > 0 al precargar.

## Diseno
- Helper backend nuevo: src/utils/descuentos.helper.js
  Funciones: aplicarCadena, normalizarCadena, etiquetarEquivalente.
  Single write point. Reusable desde compras, ventas, presupuestos.
- Configs en BD: compras.descuento_cadena_min (-99), compras.descuento_cadena_max (99).
- Frontend: rangos via window.CONFIG, fallback -99/99.
  Etiqueta dinamica: "Descuento equivalente" (verde) / "Recargo equivalente" (naranja).
- BD: sin migracion. comprobante_compra_items.descuentos_compuestos jsonb ya guardaba el array.
- Helper compras (insertarComprobanteItems): sin cambios.
  La formula _pu * (1 - _dtoPct/100) ya soporta _dtoPct < 0 (recargo).

## Casos validados (self-test backend)
- [29, -21]   => 14.09% descuento OK
- [10, 10]    => 19% descuento OK
- [10, -30]   => -17% (recargo equivalente 17%) OK
- [10, 5, 3]  => 17.07% descuento OK
- []          => 0 OK
- [0, 0]      => 0 OK

## Out of scope
- recargos_forma_pago (recargo por metodo de pago, dominio distinto).
- Ventas / presupuestos (helper queda listo para reusar).
- Trigger -1 en celda: sigue abriendo modal (no rompe; recargo de 1% se ingresa desde modal).

## Rollback
cp frontend/compras.html.bak.cadena_neg_20260505_124957 frontend/compras.html
cp frontend/js/compras.js.bak.cadena_neg_20260505_124957 frontend/js/compras.js
rm src/utils/descuentos.helper.js
psql -c "DELETE FROM configuraciones_empresa WHERE clave LIKE 'compras.descuento_cadena_%';"
pm2 restart erplago
