# Libro Mayor de Proveedores — sesion 2026-06-11
## Fase 0 — Bug NC + migracion
- compras.helper asentaba TODO en DEBE ignorando afecta_cuenta<0. Fix: branch por signo (alta y anulacion).
- cc-proveedores.helper: nueva anularNotaCredito (DEBE, contra-asiento de NC).
- Migracion: 2 NC + 1 contra-asiento invertidos (prov 17), cadena de saldos recalculada, agregado reconciliado. Verificacion dura pre-COMMIT.
## Fase 1 — Backend
- cc-proveedores.helper: obtenerLibro (saldo anterior arrastrado, paginacion via config, totales, joins doc origen) + registrarNotaInformativa.
- pagos-proveedores.helper: ultimo INSERT directo a CC eliminado -> delega al canonico (single write point).
- Endpoints: GET /pagos-proveedores/cuenta-corriente/:id/libro y /libro/export (CSV ; BOM coma-decimal con saldo anterior y totales).
- Deprecado de hecho: cc-proveedores.helper.eliminarMovimiento sin callers (no borrar movimientos de CC; anulacion = contra-asiento).
## Fase 2 — Frontend
- cc-proveedores.html regenerada: libro debe/haber/saldo, fila saldo anterior, fila totales, badge conciliacion (agregado vs suma), chips, paginacion, CSV, print, fechas default HOY local con nav -1/Hoy/+1.
- Modal pago in-place: a cuenta o imputado (facturas pendientes pre-cargadas, montos editables), formas dinamicas; cheques derivan al form completo con proveedor precargado.
- Modal documento origen: comprobante (anular con motivo) / pago (orden de pago + anular con motivo). Anulacion logica con contra-asiento.
- Endpoint viejo GET /cuenta-corriente/:id queda vigente (sin consumidores nuevos); candidato a deprecar.
## Claves configuraciones_empresa
- cc_prov.libro.items_por_pagina = 50 (filas por pagina del libro).
