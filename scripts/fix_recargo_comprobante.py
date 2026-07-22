# FIX 1: print.controller.js - agregar ajustes + subtotal real
ARCHIVO1 = '/root/mi_erp/src/controllers/print.controller.js'
with open(ARCHIVO1, 'r') as f:
    c = f.read()

# Agregar query de ajustes despues de query de pagos
BUSCAR_Q = "    const totalPagado = pagosResult.rows.reduce"
REEMPLAZO_Q = """    const ajustesResult = await pool.query(
        'SELECT tipo, porcentaje_aplicado, monto_base, monto_ajuste, descripcion FROM ajustes_forma_pago WHERE id_pedido = $1 AND anulado = false',
        [idPedido]
    );

    const totalPagado = pagosResult.rows.reduce"""

if BUSCAR_Q in c:
    c = c.replace(BUSCAR_Q, REEMPLAZO_Q, 1)
    print('OK 1a: Query ajustes agregada')
else:
    print('ERROR 1a')

# Corregir subtotal: usar items_total, no total_final
# Y agregar ajustes al return
BUSCAR_T = "        totales: { subtotal: totalFinal.toFixed(2), iva: null, total: totalFinal.toFixed(2) },"
ITEMS_SUM = """        items_total: pedido.subtotal_sin_iva ? Math.round(parseFloat(pedido.subtotal_sin_iva) * 1.21) : totalFinal,
        ajustes: ajustesResult.rows,
        totales: (() => {
            const itemsTotal = pedido.subtotal_sin_iva ? Math.round(parseFloat(pedido.subtotal_sin_iva) * 1.21) : totalFinal;
            return { subtotal: itemsTotal.toFixed(2), iva: null, total: totalFinal.toFixed(2) };
        })(),"""

if BUSCAR_T in c:
    c = c.replace(BUSCAR_T, ITEMS_SUM, 1)
    print('OK 1b: Subtotal = items_total, ajustes agregados')
else:
    print('ERROR 1b')

with open(ARCHIVO1, 'w') as f:
    f.write(c)

# FIX 2: comprobante_venta.hbs - mostrar recargo entre subtotal y total
ARCHIVO2 = '/root/mi_erp/templates/comprobantes/comprobante_venta.hbs'
with open(ARCHIVO2, 'r') as f:
    t = f.read()

BUSCAR_HBS = """            {{#if pedido.descuento_monto}}
            <div class="total-row">
                <span>Descuento:</span>
                <span>-${{formatNumber pedido.descuento_monto}}</span>
            </div>
            {{/if}}"""

REEMPLAZO_HBS = """            {{#if pedido.descuento_monto}}
            <div class="total-row">
                <span>Descuento:</span>
                <span>-${{formatNumber pedido.descuento_monto}}</span>
            </div>
            {{/if}}
            {{#each ajustes}}
            <div class="total-row" style="color: {{#if (eq this.tipo 'recargo')}}#c0392b{{else}}#27ae60{{/if}};">
                <span>{{this.descripcion}}</span>
                <span>{{#if (eq this.tipo 'recargo')}}+{{/if}}${{formatNumber this.monto_ajuste}}</span>
            </div>
            {{/each}}"""

if BUSCAR_HBS in t:
    t = t.replace(BUSCAR_HBS, REEMPLAZO_HBS, 1)
    print('OK 2: Template con linea de recargo')
else:
    print('ERROR 2')

with open(ARCHIVO2, 'w') as f:
    f.write(t)

print('=== LISTO ===')
