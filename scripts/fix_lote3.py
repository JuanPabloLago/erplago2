#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
ERP LAGO — LOTE 3: Fixes B3 + B6 + B10
═══════════════════════════════════════════════════════════════
B3  — CC: validar límite de crédito antes de aceptar pago CC
B6  — Stock: considerar borradores de OTROS vendedores
B10 — XSS: escapear HTML en vistaPrevia()

Archivos tocados:
  - borrador.controller.js (B3, B6)
  - venta-rapida-script.js (B10)

Uso:
  python3 fix_lote3.py --dry-run
  python3 fix_lote3.py
═══════════════════════════════════════════════════════════════
"""
import sys, os, shutil, datetime

DRY_RUN = '--dry-run' in sys.argv
BACKEND = '/root/mi_erp/src/controllers/borrador.controller.js'
FRONTEND = '/root/mi_erp/frontend/js/venta-rapida-script.js'
BACKUP_DIR = '/root/mi_erp/backups/pre_fix_venta_rapida_lote3_{}'.format(
    datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
)

def main():
    for f in [BACKEND, FRONTEND]:
        if not os.path.exists(f):
            print(f'ERROR: {f} no existe')
            sys.exit(1)

    with open(BACKEND, 'r', encoding='utf-8') as f:
        backend = f.read()
    with open(FRONTEND, 'r', encoding='utf-8') as f:
        frontend = f.read()

    fixes = []

    # ═══════════════════════════════════════════════════════════
    # B3 — Validar límite CC en confirmarBorrador
    # Insertar DESPUÉS del import de terminalesHelper y ANTES de obtenerBorradorActivo
    # Agrego ccClientesHelper al require (si no está) + función de validación
    # ═══════════════════════════════════════════════════════════

    # Primero: agregar import de ccClientesHelper si no está
    if "require('../utils/cc-clientes.helper')" not in backend:
        old_import = "const terminalesHelper = require('../utils/terminales.helper');"
        new_import = """const terminalesHelper = require('../utils/terminales.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');"""
        if old_import in backend:
            backend = backend.replace(old_import, new_import, 1)
            fixes.append('B3-import: Agregado ccClientesHelper')
        else:
            print('WARN: B3-import — terminalesHelper require no encontrado')
    else:
        fixes.append('B3-import: ccClientesHelper ya importado (skip)')

    # Segundo: Inyectar validación CC DENTRO de confirmarBorrador,
    # justo ANTES de "// ═══ AJUSTE POR FORMA DE PAGO"
    # cuando se detecta pago CC en el array de pagos
    old_b3_anchor = """        // ═══════════════════════════════════════════════════════════
        // AJUSTE POR FORMA DE PAGO
        // ═══════════════════════════════════════════════════════════"""

    new_b3_block = """        // ═══════════════════════════════════════════════════════════
        // B3 FIX: VALIDAR LÍMITE CC ANTES DE PROCESAR PAGOS
        // ═══════════════════════════════════════════════════════════
        const tieneCC = pagos.some(p => {
            const mapeo = {cuenta_corriente: 6};
            return (p.id_metodo_pago || mapeo[p.forma]) === 6;
        });
        if (tieneCC && clienteFinal) {
            const saldoActual = await ccClientesHelper.obtenerSaldo(client, id_empresa, clienteFinal);
            const montoCC = pagos
                .filter(p => (p.id_metodo_pago || 0) === 6)
                .reduce((sum, p) => sum + (parseFloat(p.monto) || 0), 0);

            const limiteRes = await client.query(
                'SELECT COALESCE(limite_credito, 0) as limite FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
                [clienteFinal, id_empresa]
            );
            const limiteCredito = parseFloat(limiteRes.rows[0]?.limite || 0);
            const limiteConfig = parseFloat(await getConfig(
                (q, p) => client.query(q, p), id_empresa, 'cc.limite_credito_default', '0'
            ));
            const limiteEfectivo = limiteCredito > 0 ? limiteCredito : limiteConfig;

            if (limiteEfectivo > 0) {
                const deudaActual = parseFloat(saldoActual?.saldo || 0);
                const deudaTotal = deudaActual + montoCC;
                if (deudaTotal > limiteEfectivo) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Excede límite de crédito',
                        limite: limiteEfectivo,
                        deuda_actual: deudaActual,
                        monto_cc: montoCC,
                        deuda_total: deudaTotal
                    });
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // AJUSTE POR FORMA DE PAGO
        // ═══════════════════════════════════════════════════════════"""

    if old_b3_anchor in backend:
        backend = backend.replace(old_b3_anchor, new_b3_block, 1)
        fixes.append('B3: Validación límite CC en confirmarBorrador')
    else:
        print('WARN: B3 — anchor AJUSTE POR FORMA DE PAGO no encontrado')

    # ═══════════════════════════════════════════════════════════
    # B6 — Stock cruzado: considerar borradores de otros vendedores
    # Reemplazar validación de stock en agregarItem
    # ═══════════════════════════════════════════════════════════

    old_b6 = """        if (!permitirSinStock) {
            const yaEnBorrador = await client.query(`
                SELECT COALESCE(SUM(cantidad), 0) as cant_borrador
                FROM pedidoitems WHERE id_pedido = $1 AND id_producto = $2
            `, [id_pedido, id_producto]);

            const cantidadTotal = parseFloat(yaEnBorrador.rows[0].cant_borrador) + parseFloat(cantidad);
            if (cantidadTotal > parseFloat(producto.stock_actual)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Stock insuficiente',
                    stock_actual: parseFloat(producto.stock_actual),
                    cantidad_en_borrador: parseFloat(yaEnBorrador.rows[0].cant_borrador),
                    cantidad_solicitada: parseFloat(cantidad)
                });
            }
        }"""

    new_b6 = """        if (!permitirSinStock) {
            // B6 FIX: Considerar stock comprometido en TODOS los borradores activos
            const comprometido = await client.query(`
                SELECT COALESCE(SUM(pi.cantidad), 0) as cant_comprometida
                FROM pedidoitems pi
                JOIN pedidos p ON pi.id_pedido = p.id_pedido
                WHERE pi.id_producto = $1
                  AND p.id_empresa = $2
                  AND p.id_estado = $3
            `, [id_producto, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

            const cantidadComprometida = parseFloat(comprometido.rows[0].cant_comprometida);
            const cantidadTotal = cantidadComprometida + parseFloat(cantidad);
            if (cantidadTotal > parseFloat(producto.stock_actual)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Stock insuficiente',
                    stock_actual: parseFloat(producto.stock_actual),
                    comprometido_en_borradores: cantidadComprometida,
                    cantidad_solicitada: parseFloat(cantidad)
                });
            }
        }"""

    if old_b6 in backend:
        backend = backend.replace(old_b6, new_b6, 1)
        fixes.append('B6: Stock cruzado — considera TODOS los borradores activos')
    else:
        print('WARN: B6 — patrón stock en agregarItem no encontrado')

    # También B6 en revalidación de confirmarBorrador
    old_b6_confirm = """            const stockCheck = await client.query(`
                SELECT pi.id_producto, pr.nombre, pi.cantidad,
                       COALESCE(inv.stock_real, 0) as stock_actual
                FROM pedidoitems pi
                JOIN productos pr ON pi.id_producto = pr.id_producto
                LEFT JOIN inventario inv ON pi.id_producto = inv.id_producto AND inv.id_empresa = $2
                WHERE pi.id_pedido = $1 AND pi.cantidad > COALESCE(inv.stock_real, 0)
            `, [id_pedido, id_empresa]);"""

    new_b6_confirm = """            // B6 FIX: Revalidación con stock cruzado de otros borradores
            const stockCheck = await client.query(`
                SELECT pi.id_producto, pr.nombre, pi.cantidad,
                       COALESCE(inv.stock_real, 0) as stock_actual,
                       COALESCE((
                           SELECT SUM(pi2.cantidad) FROM pedidoitems pi2
                           JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido
                           WHERE pi2.id_producto = pi.id_producto
                             AND p2.id_empresa = $2
                             AND p2.id_estado = ${pedidosHelper.PEDIDO_ESTADOS.BORRADOR}
                             AND p2.id_pedido != $1
                       ), 0) as comprometido_otros
                FROM pedidoitems pi
                JOIN productos pr ON pi.id_producto = pr.id_producto
                LEFT JOIN inventario inv ON pi.id_producto = inv.id_producto AND inv.id_empresa = $2
                WHERE pi.id_pedido = $1
                  AND pi.cantidad > (COALESCE(inv.stock_real, 0) - COALESCE((
                       SELECT SUM(pi2.cantidad) FROM pedidoitems pi2
                       JOIN pedidos p2 ON pi2.id_pedido = p2.id_pedido
                       WHERE pi2.id_producto = pi.id_producto
                         AND p2.id_empresa = $2
                         AND p2.id_estado = ${pedidosHelper.PEDIDO_ESTADOS.BORRADOR}
                         AND p2.id_pedido != $1
                  ), 0))
            `, [id_pedido, id_empresa]);"""

    if old_b6_confirm in backend:
        backend = backend.replace(old_b6_confirm, new_b6_confirm, 1)
        fixes.append('B6b: Stock cruzado en revalidación de confirmarBorrador')
    else:
        print('WARN: B6b — patrón stockCheck en confirmarBorrador no encontrado')

    # ═══════════════════════════════════════════════════════════
    # B10 — XSS: escapear HTML en vistaPrevia
    # Inyectar función escapeHtml y usarla
    # ═══════════════════════════════════════════════════════════

    # Agregar función escapeHtml después de normalizarTexto
    old_b10_anchor = "function normalizarTexto(texto) { return (texto || \"\").normalize(\"NFD\").replace(/[\\u0300-\\u036f]/g, \"\").toUpperCase(); }"

    new_b10_anchor = """function normalizarTexto(texto) { return (texto || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toUpperCase(); }
function escapeHtml(text) { var d = document.createElement('div'); d.textContent = text || ''; return d.innerHTML; }"""

    if old_b10_anchor in frontend:
        frontend = frontend.replace(old_b10_anchor, new_b10_anchor, 1)
        fixes.append('B10a: Función escapeHtml agregada')
    else:
        print('WARN: B10a — anchor normalizarTexto no encontrado')

    # Reemplazar usos inseguros en vistaPrevia
    # clienteNombre sin escapear
    old_b10_cliente = "'<span>' + clienteNombre + '</span>'"
    new_b10_cliente = "'<span>' + escapeHtml(clienteNombre) + '</span>'"
    if old_b10_cliente in frontend:
        frontend = frontend.replace(old_b10_cliente, new_b10_cliente)
        fixes.append('B10b: escapeHtml en clienteNombre vistaPrevia')

    # item.nombre sin escapear
    old_b10_item = "'<td>' + item.nombre + '</td>'"
    new_b10_item = "'<td>' + escapeHtml(item.nombre) + '</td>'"
    if old_b10_item in frontend:
        frontend = frontend.replace(old_b10_item, new_b10_item)
        fixes.append('B10c: escapeHtml en item.nombre vistaPrevia')

    # item.sku sin escapear
    old_b10_sku = "'<td>' + (item.sku || '') + '</td>'"
    new_b10_sku = "'<td>' + escapeHtml(item.sku || '') + '</td>'"
    if old_b10_sku in frontend:
        frontend = frontend.replace(old_b10_sku, new_b10_sku)
        fixes.append('B10d: escapeHtml en item.sku vistaPrevia')

    # clienteDir sin escapear
    old_b10_dir = "'<span>' + clienteDir + '</span>'"
    new_b10_dir = "'<span>' + escapeHtml(clienteDir) + '</span>'"
    if old_b10_dir in frontend:
        frontend = frontend.replace(old_b10_dir, new_b10_dir)
        fixes.append('B10e: escapeHtml en clienteDir vistaPrevia')

    # ═══════════════════════════════════════════════════════════
    # RESULTADO
    # ═══════════════════════════════════════════════════════════
    if not fixes:
        print('\n⚠️  Ningún fix aplicado.')
        sys.exit(1)

    print(f'\n{"═" * 60}')
    print(f'LOTE 3 — B3+B6+B10: {len(fixes)} fixes')
    print(f'{"═" * 60}')
    for f in fixes:
        print(f'  ✅ {f}')

    if DRY_RUN:
        print(f'\n🔍 DRY RUN — No se escribió nada.')
        print(f'   Ejecutar sin --dry-run para aplicar.')
    else:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        shutil.copy2(BACKEND, os.path.join(BACKUP_DIR, 'borrador.controller.js'))
        shutil.copy2(FRONTEND, os.path.join(BACKUP_DIR, 'venta-rapida-script.js'))
        print(f'\n📦 Backup en: {BACKUP_DIR}/')

        with open(BACKEND, 'w', encoding='utf-8') as f:
            f.write(backend)
        print(f'✅ Backend escrito: {BACKEND}')

        with open(FRONTEND, 'w', encoding='utf-8') as f:
            f.write(frontend)
        print(f'✅ Frontend escrito: {FRONTEND}')

        print(f'\n⚡ Ejecutar:')
        print(f'   source ~/.nvm/nvm.sh && node --check {BACKEND} && echo "✅ SINTAXIS OK"')
        print(f'   pm2 restart erplago && pm2 logs erplago --lines 10')

if __name__ == '__main__':
    main()
