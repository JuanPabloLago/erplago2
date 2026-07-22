-- ═══════════════════════════════════════════════════════════════
-- MIGRACIÓN: permitir cantidad negativa en items de compra
-- Fecha: 2026-07-21
-- Motivo: ajustes por mercadería facturada de más y no entregada
--         (el proveedor descuenta unidades). La línea negativa
--         resta stock (registrado como DEVOLUCION_COMPRA) y baja
--         el total del comprobante y la deuda con el proveedor.
-- Cambio: CHECK (cantidad > 0) -> CHECK (cantidad <> 0)
--         Se mantiene la prohibición del cero (línea sin sentido).
-- ═══════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE comprobante_compra_items
    DROP CONSTRAINT comprobante_compra_items_cantidad_check;

ALTER TABLE comprobante_compra_items
    ADD CONSTRAINT comprobante_compra_items_cantidad_check
    CHECK (cantidad <> 0);

COMMIT;
