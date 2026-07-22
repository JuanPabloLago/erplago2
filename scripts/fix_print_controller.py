ARCHIVO = '/root/mi_erp/src/controllers/print.controller.js'
with open(ARCHIVO, 'r') as f:
    c = f.read()

c = c.replace(
    "SELECT pa.monto, mp.nombre as metodo\n        FROM pagos pa JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago\n        WHERE pa.id_pedido = $1",
    "SELECT pa.monto, mp.nombre as metodo,\n               pa.cuotas, pa.monto_original, pa.coeficiente\n        FROM pagos pa JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago\n        WHERE pa.id_pedido = $1"
)
print('OK 1: Query pagos con cuotas')

c = c.replace(
    "        pagos: pagosResult.rows,\n        pagado: totalPagado >= totalFinal - 0.01,",
    """        pagos: pagosResult.rows.map(function(p) {
            var cuotas = parseInt(p.cuotas) || 0;
            var montoOrig = parseFloat(p.monto_original || 0);
            var monto = parseFloat(p.monto);
            var detalle = p.metodo;
            if (cuotas > 1) {
                var valCuota = Math.round(monto / cuotas * 100) / 100;
                detalle += ' - ' + cuotas + ' cuotas x $' + valCuota.toFixed(2);
            }
            return { metodo: detalle, monto: p.monto, monto_original: montoOrig > 0 && Math.abs(montoOrig - monto) > 0.01 ? montoOrig : null };
        }),
        totales: { subtotal: totalFinal.toFixed(2), iva: null, total: totalFinal.toFixed(2) },
        es_responsable_inscripto: false,
        pagado: totalPagado >= totalFinal - 0.01,"""
)
print('OK 2: Pagos con cuotas + totales')

with open(ARCHIVO, 'w') as f:
    f.write(c)
print('LISTO')
