# Libro Mayor CC Clientes — hub unificado + motor de cobranza
**Fecha:** 2026-07-03 | **Módulos:** cobranzas, cc-clientes, cobranza.helper, pagos.helper, pedidos-edicion, toolkit

## Qué se hizo
- **Toolkit v69 FIX-13**: recursión infinita en alias de grupos (venta-rapida, cc-clientes) → lista de visitados.
- **F0 BD**: DROP `recibos_numero_recibo_key` (UNIQUE global, bloqueaba empresa 2); 6 claves config nuevas + catálogo.
- **F1**: `cobranza.helper.registrarCobranza` — transacción única: recibo + recibo_items (formas_pago) + recibo_pedidos (tabla nueva) + pagos origen `cobranza_cc` (cierra Flujo C: recibos nunca asentaban en libro maestro) + recibopagos + HABER CC con id_recibo + caja. Efectivo detectado por `tipo_cuenta='caja_fisica'`, nunca por id. Cotización estricta (error COTIZACION_NO_DISPONIBLE, sin fallback 1:1). `pagos.id_pedido` nullable solo para origen cobranza_cc (CHECK espejo BD+código). `recibos.id_turno` nullable (regla en helper por config).
- **F2**: `cc-clientes.obtenerLibro` (saldo corrido histórico + saldo anterior + joins origen + búsqueda multi-doc + filtro FP por JOIN real); endpoints /libro, /libro/export (CSV AR), /cobrar; `cuentacorrienteclientes.id_recibo` (FK + en registrarMovimiento).
- **F3**: resumen imprimible `templates/comprobantes/resumen_cc.hbs` + /resumen/html (reusa obtenerLibro — pantalla, CSV y resumen siempre dicen lo mismo). Clave `empresa.logo_url`.
- **F4a**: /form-data-cobro (formas_pago con estética del método equivalente — NO /formas-pago/activos que es el otro catálogo) + /aging.
- **DEUDA FANTASMA**: 68 pedidos Cancelados/Anulados con DEBE en CC sin compensar (~$8.3M). Causa: `anularPedidoCompleto` revierte pagos pero jamás el fiado (el código legacy que lo hacía se eliminó).
  - **F4a.1**: `pedidoestados.computa_deuda` (La BD Manda) — aging, FIFO, imputación manual (PEDIDO_NO_COBRABLE) y pendientes-cobro filtran por columna, no por ids. `v_saldo_pedidos` intacta (despachos la usa sin filtro de estado, correcto).
  - **F4a.2**: 54 contra-asientos de regularización. ⚠ **SOBRE-COMPENSÓ**: (a) pedidos "Anulado por NC" ya tenían HABER vía id_nota (no id_pedido) → dobles (~$628K, 3 pedidos); (b) pedido 1636 con HABER $544K sin DEBE linkeado. LA PIEDRA quedó -419.099,84. **Corrección manual a cargo de JP.** Backup: `_backup_cc_pre_regularizacion_20260703`. Regla aprendida: asiento de NC debe linkear id_nota Y id_pedido.
  - **F4a.3**: paso 4.5 en anularPedidoCompleto — reversa automática del DEBE neto real en CC (auto-ajustada, no-op si no hay neto). ⚠ Prueba real pendiente: fiado $100 → anular → verificar reversa.
- **F4b/F4c**: `cuenta-corriente.html` + `js/cuenta-corriente.js` regenerados como hub: libro + cobro in-place (pendientes FIFO editables / a cuenta, errores de negocio traducidos) + modal doc origen + aging + límite crédito + badge conciliación + WhatsApp (plantilla config, saneo tel basura) + resumen + CSV + F2/F3/F4/F8/ESC + deep-link ?id_cliente. v4 en .bak.f4b_*, endpoints v4 intactos.

## Claves nuevas en configuraciones_empresa
cc.libro.items_por_pagina (50) · cc.cobro.permitir_parcial (true) · cc.cobro.exigir_turno (true) · cc.cobro.imputacion_sugerida (antiguedad) · cc.resumen.mostrar_logo (true) · cc.resumen.whatsapp_plantilla · configuraciones.ui.dias_badge_nuevo (30) · empresa.logo_url ('')

## Pendientes
1. **Corrección manual regularización** (JP): dobles de Anulado por NC + huérfano 1636.
2. **Prueba real F4a.3** y prueba de cobro end-to-end por la pantalla nueva.
3. **F5 convergencia**: tesorería (`recibos.controller.crear`) y despachos (`/remito/:id/cobrar`) → delegar en registrarCobranza (single write point real).
4. **Badge NUEVO + color por namespace** en configuraciones.html (diseñado, catálogo listo).
5. Bugs laterales: `obtenerCotizacion` sin id_empresa en recibos.controller (recibo USD $100 a regularizar); asimetría caja en anulación (turno sin depósito, D5); clientes duplicados (DANIEL 931/992, CORRALON C.G 134/19); deep-link tesorería→CC pasando ?id_cliente; guardián de equivalencias pedido↔factura↔presupuesto; alias toolkit cc-clientes → "cobranzas cuenta-corriente".
