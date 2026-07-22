# Paquetes / Receta (BOM) — sesion 2026-06-12
## Causa del stock mal
El motor BOM (descontarVenta + producto_componentes, abril) estaba enchufado en venta/notas/edicion,
pero el descuento FISICO de los aridos lo hace el DESPACHO, y los shortcuts de despacho iban a moverStock sin BOM.
Resultado: A12/ABA acumulaban stock propio negativo en vez de descontar del componente.
## Cambios
- stock.helper: _expandirBOM + despacharDeDeposito/confirmarEntregaDeposito/devolverADeposito resuelven receta
  (mismos componentes en despacho, entrega y devolucion -> simetria fisico/comprometido).
- compras.helper.insertarComprobanteItems: producto con receta activa NO se compra directo (rechazo 400 con SKU).
- producto_componentes: + updated_at / updated_by (trazabilidad de cambios de receta).
- productos.helper: obtenerComponentes / guardarComponentes (set declarativo, valida: sin auto-referencia,
  sin BOM anidado, cantidad > 0, sin repetidos; desactiva con updated_by, upsert con ON CONFLICT).
- Endpoints: GET/PUT /productos/:id/componentes. ABM en ficha de producto (details "Paquete / Receta").
- Recetas cargadas: A12=0.5A | ABA=1A+1BA | CP12=0.5CP | CPBA=1CP+1BA | PP12=0.5PP | ppba=1PP+1BA. A3 stock propio.
## Decisiones de negocio (Juan Pablo)
- Unidad base de arena: METRO (no tonelada; convierte mentalmente al comprar).
- Bolson vacio = producto BA (862), componente compartido de los 3 bolsones.
- Stock historico negativo: lo corrige JP por frontend (ajuste inventario); no se reescribe historia.
## Claves configuraciones_empresa
Ninguna: la receta es dato por producto (producto_componentes), no configuracion de empresa.
