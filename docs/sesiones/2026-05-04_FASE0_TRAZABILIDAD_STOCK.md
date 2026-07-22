# FASE 0 - Trazabilidad de Stock

**Fecha**: 2026-05-04 | **Empresa**: 1 (LAGO) | **Estado**: CERRADA

## Schema (Bloque A)
ALTER TABLE movimientos_stock_deposito agrego:
- id_comprobante_compra INTEGER FK -> comprobantes_compra
- id_ajuste INTEGER FK -> ajustes_inventario
- id_transferencia_grupo VARCHAR(40) (string, sin tabla)
+ 3 indices parciales + 2 FKs ON DELETE RESTRICT.

## Helper (Bloque B)
stock.helper.moverStock() acepta 3 params opcionales nuevos.

## Callers (Bloque C)
- compras.helper.js:199, 411 -> id_comprobante_compra
- ajustes-inventario.helper.js:548, 663 -> id_ajuste
- inventario.controller.js:267-268 -> id_transferencia_grupo

## Backfill (Bloque E, estrategia A)
- AJUSTES: 4210/4210 = 100% (matcheo via ajuste_inventario_items.id_movimiento)
- COMPRAS: 236/345 = 68.4% (matcheo por producto+cantidad+fecha_emision)
- TRANSFERENCIAS: 0 historicas

## Funcion de auditoria
SELECT * FROM verificar_trazabilidad_movimientos(1);

## Estado final por tipo
| Tipo | Total | Trazado | Huerfano | % |
|---|---|---|---|---|
| AJUSTE_INVENTARIO | 4210 | 4210 | 0 | 0% |
| DESPACHO | 2375 | 2375 | 0 | 0% |
| ENTREGA | 2286 | 2286 | 0 | 0% |
| DEVOLUCION | 109 | 109 | 0 | 0% |
| ANULACION | 143 | 129 | 14 | 9.79% |
| COMPRA | 345 | 236 | 109 | 31.59% |
| VENTA | 8369 | 5440 | 2929 | 35% |
| AJUSTE_MANUAL | 6 | 0 | 6 | 100% |
| DEVOLUCION_CLIENTE | 2 | 1 | 1 | 50% |

## Deuda heredada (Fase 4 futura)
- 2929 VENTAS sin id_pedido
- 14 ANULACIONES, 109 COMPRAS, 6 AJUSTE_MANUAL, 1 DEVOLUCION_CLIENTE sin FK
Movs pre-refactor sin datos para backfill.

## Backups
- /root/backups/fase0_trazabilidad/20260504_211354/  (Bloque A)
- /root/backups/fase0_trazabilidad/20260504_211807/  (Bloque B .bak)
- /root/backups/fase0_trazabilidad/20260504_215859/  (Bloque C .bak)
- /root/backups/fase0_trazabilidad/20260504_220629_pre_backfill/  (Bloque E)

## Decision: FK INTEGER vs numero_comprobante VARCHAR
Se eligio INTEGER FK por:
- Integridad referencial via ON DELETE RESTRICT
- Performance en JOIN
- Inmutabilidad del PK (numero_comprobante puede cambiar)
- Coherencia con resto del schema (id_pedido, id_remito, id_cliente, id_producto)
El numero visible se obtiene del JOIN cuando se muestra en pantalla.

## Proximos pasos
- Fase 1: helper historial-producto.helper.js con JOINs limpios
- Fase 2: endpoint /api/historial-producto/:id_producto
- Fase 3: modal reutilizable + botones en inventario.html y compras.html
