# SIGNO SOBERANO — Devoluciones de mostrador (2026-07-06)

## Convención de negocio (regla de Juan Pablo)
En un pedido: cantidad POSITIVA = venta (egresa stock, ingresa dinero).
Cantidad NEGATIVA = devolución/cambio (ingresa stock, egresa dinero por el
MISMO método por el que entró). Negativos NO facturan (AFIP) — presupuestan,
o factura de positivos + NC.

## Bug raíz
La convención existía en el uso pero el sistema nunca la implementó:
CINCO filtros silenciosos descartaban la pata que no entendían, sin error.

## Los 5 filtros eliminados
1. stock.helper.descontarVenta — Math.abs() destruía el signo: 172 movimientos
   registrados como VENTA (restaban) cuando debían sumar. Fix: negativo sin
   tipo explícito → DEVOLUCION_CLIENTE (+). Callers con tipo explícito intactos.
2. cobranza.helper paso 1.5 — `total <= 0` era no-op: confirmaba sin liquidar.
   Fix: no-op SOLO total===0 sin pagos; total<0 sin pagos → DEVOLUCION_SIN_EGRESO.
3. cobranza.helper paso 9 — `montoPago <= 0 → continue` descartaba el pago.
   Fix: negativo fluye; método 6 negativo → DEVOLUCION_CC_NO_SOPORTADA.
4. pagos.helper.registrarPago — guard `<= 0` rechazaba firmados. Fix: solo 0
   inválido. Traducción a caja: negativo → tipo 'egreso', monto ABS,
   concepto "Devolución Pedido #X" (contadores de turno sanos).
5. cc-clientes.registrarVentaConPago — `<= 0 → return null`. Fix: asiento
   espejo (HABER devolución mercadería + DEBE dinero devuelto, neto 0).
Front (venta-rapida-script.js): _pagarTotalYGuardar y manejarClicPago ignoraban
saldo<0. Fix: confirm explícito "EGRESAN $X / INGRESA al depósito: ..." antes
de registrar. Crédito/débito excluidos (reversa terminal pendiente).
Controller: whitelist codigosNegocio + DEVOLUCION_SIN_EGRESO,
DEVOLUCION_CC_NO_SOPORTADA, METODO_CC_NO_VALIDO, CF_NO_PUEDE_PARCIAL.

## Verificado en producción
14500: pago -660.04 / stock DEVOLUCION_CLIENTE +11 / caja egreso 660.04.
14499 (venta normal intercalada): flujo positivo sin regresión.

## Archivos tocados (backups .bak.signo_* / .bak.noop_* / .bak.wl_* / .bak.devol_*)
src/utils/stock.helper.js, cobranza.helper.js, pagos.helper.js,
cc-clientes.helper.js, controllers/borrador.controller.js,
frontend/js/venta-rapida-script.js. Backup BD: erplago_pre_signo_stock_20260706_093821.sql

## Claves nuevas en configuraciones_empresa: NINGUNA
Justificación: el signo del ítem es un invariante de integridad (una devolución
JAMÁS debe descontar stock ni evaporar plata, en ninguna empresa/rubro).
PENDIENTE de parametrizar (hoy el código no lee config): ventas.items_negativos_habilitados
y ventas.confirmar_items_negativos — declarar recién cuando el código las lea,
no antes (no se documentan claves fantasma).

## Cola (en orden)
1. ANULACIÓN BD-MANDA (URGENTE): anularPedidoCompleto revierte por items con
   if(cant>0) y manda pagos a saldo a favor sin mirar signo → revertiría MAL
   los pedidos mixtos de esta camada. Rediseño: stock desde
   movimientos_stock_deposito reales, plata desde pagos firmados.
2. Fuga cancelarPedidoCliente (pedido-web.helper:429): UPDATE directo estado 7
   sin orquestador ni bitácora. También limpiarAbandonadosEmpresa sin log.
3. Regularización histórica: 172 movs invertidos (~682 u. corrección doble),
   4 cancelados sin reponer (11948/10340/3641/3151, 349.5 u.), 14495 y 14497
   (mercadería ingresada, plata jamás egresada: 120.01 + 300.02).
4. Hardcodeos METODOS_PAGO_REAL=[1..5] y necesitaCaja(m>=1&&m<=5) → lookup
   metodosdepago.mueve_caja (cheques 7-9 hoy no registran caja). Esperando OK.
5. Devolución por tarjeta (reversa terminal). 6. Modal Facturar off con
   negativos en facturas.html. 7. DESPACHO sin id_pedido en movimientos
   (trazabilidad remito→pedido). 8. Guard "Facturar" sobre pedidos Descartados.
