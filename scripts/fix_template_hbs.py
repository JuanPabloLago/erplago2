ARCHIVO = '/root/mi_erp/templates/comprobantes/comprobante_venta.hbs'
with open(ARCHIVO, 'r') as f:
    c = f.read()

BUSCAR = """        {{#each pagos}}
        <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #ddd;">
            <span>{{this.metodo}}</span>
            <span>${{formatNumber this.monto}}</span>
        </div>
        {{/each}}"""

REEMPLAZO = """        {{#each pagos}}
        <div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #ddd;">
            <span>{{this.metodo}}</span>
            <span>${{formatNumber this.monto}}</span>
        </div>
        {{#if this.monto_original}}
        <div style="font-size: 10px; color: #888; text-align: right; padding: 2px 0;">
            Base: ${{formatNumber this.monto_original}}
        </div>
        {{/if}}
        {{/each}}"""

if BUSCAR in c:
    c = c.replace(BUSCAR, REEMPLAZO, 1)
    print('OK: Template con cuotas + base')
else:
    print('ERROR: No encontre bloque pagos')

with open(ARCHIVO, 'w') as f:
    f.write(c)
