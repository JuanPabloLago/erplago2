# F1 — Redirect de redondeo de listas a escribirPrecio (2026-05-29)
Problema: 670 ingresado se guardaba 650. Causa: recalcularDesdeCosto/recalcularDesdeLista/
aplicarRedondeo/ajustarPorcentaje escribian directo con redondearPrecioAR (escala 5/10/50/100/500),
salteando escribirPrecio (que redondea al peso y deriva neto desde bruto).
Fix: las 4 funciones delegan en preciosHelper.escribirPrecio (modo NETO). margen_individual aparte.
Flag canonico de redondeo: listasdeprecios.redondea_con_iva (true=entero). redondeo_activo: a retirar.
Deuda abierta (limpieza): eliminar redondearPrecioAR/redondearAR (verificar usos en iva.helper);
borrar claves venta.* y ventas.precio.* (verificar Fase 1 abril); conectar redondea_con_iva al CRUD + leyendas.
Rollback: restaurar .bak.f1_* y precios_pre_f1_*.sql.

## F1b — Listas a MANUAL (precio de venta soberano)
Frontend (guardarLista) y backend (crearLista/actualizarLista) imponian SOBRE_COSTO.
Fix: default backend + hardcode frontend -> MANUAL; UPDATE 7 listas -> MANUAL.
Efecto: recalcularDesdeCosto/Todas ya no tocan estas listas. El precio cargado manda.
Deuda vendibilidad: falta selector de tipo (MANUAL/SOBRE_COSTO) en el modal; recalcularDesdeCosto inalcanzable desde UI.
Rollback: .bak.manual_* + UPDATE tipo_calculo='SOBRE_COSTO'.
