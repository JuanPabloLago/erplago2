#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
ERP LAGO — LOTE 1: Fixes backend borrador.controller.js
═══════════════════════════════════════════════════════════════
Fixes:
  B4  — FOR UPDATE en 3 SELECTs críticos (race condition)
  B5  — Filtrar producto activo en agregarItem
  B9  — Validar permitir_cambiar_precio en agregarItem
  B2  — Recibir id_lista_precio del frontend en agregarItem
  B11 — Atomic sincronizarPagos (check+update en 1 query)

Uso:
  python3 fix_lote1_backend.py --dry-run    # Ver cambios sin aplicar
  python3 fix_lote1_backend.py              # Aplicar cambios
═══════════════════════════════════════════════════════════════
"""
import sys, os, shutil, datetime

DRY_RUN = '--dry-run' in sys.argv
TARGET = '/root/mi_erp/src/controllers/borrador.controller.js'
BACKUP_DIR = '/root/mi_erp/backups/pre_fix_venta_rapida_lote1_{}'.format(
    datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
)

def main():
    if not os.path.exists(TARGET):
        print(f'ERROR: {TARGET} no existe')
        sys.exit(1)

    with open(TARGET, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    fixes_applied = []

    # ═══════════════════════════════════════════════════════════
    # B4a — FOR UPDATE en confirmarBorrador (SELECT *)
    # ═══════════════════════════════════════════════════════════
    old_b4a = '''SELECT * FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Verificar que tenga items'''

    new_b4a = '''SELECT * FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
            FOR UPDATE
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Verificar que tenga items'''

    if old_b4a in content:
        content = content.replace(old_b4a, new_b4a, 1)
        fixes_applied.append('B4a: FOR UPDATE en confirmarBorrador')
    else:
        print('WARN: B4a — patrón confirmarBorrador no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B4b — FOR UPDATE en suspenderBorrador (SELECT id_pedido, id_cliente)
    # ═══════════════════════════════════════════════════════════
    old_b4b = '''SELECT id_pedido, id_cliente FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Verificar que tenga items
        const itemsCount = await client.query(
            'SELECT COUNT(*) as total FROM pedidoitems WHERE id_pedido = $1', [id_pedido]'''

    new_b4b = '''SELECT id_pedido, id_cliente FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
            FOR UPDATE
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Verificar que tenga items
        const itemsCount = await client.query(
            'SELECT COUNT(*) as total FROM pedidoitems WHERE id_pedido = $1', [id_pedido]'''

    if old_b4b in content:
        content = content.replace(old_b4b, new_b4b, 1)
        fixes_applied.append('B4b: FOR UPDATE en suspenderBorrador')
    else:
        print('WARN: B4b — patrón suspenderBorrador no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B4c — FOR UPDATE en descartarBorrador
    # ═══════════════════════════════════════════════════════════
    old_b4c = '''        // Verificar borrador
        const pedidoCheck = await client.query(`
            SELECT id_pedido FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Cambiar a estado Descartado via helper'''

    new_b4c = '''        // Verificar borrador
        const pedidoCheck = await client.query(`
            SELECT id_pedido FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
            FOR UPDATE
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        // Cambiar a estado Descartado via helper'''

    if old_b4c in content:
        content = content.replace(old_b4c, new_b4c, 1)
        fixes_applied.append('B4c: FOR UPDATE en descartarBorrador')
    else:
        print('WARN: B4c — patrón descartarBorrador no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B5 — Filtrar producto activo + B2 — id_lista_precio dinámico
    # ═══════════════════════════════════════════════════════════
    old_b5b2 = '''        const { id_producto, cantidad = 1, precio_unitario = null } = req.body;

        // Verificar que el pedido es borrador del usuario
        const pedidoCheck = await client.query(`
            SELECT id_pedido FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado o no pertenece al usuario' });
        }

        // Obtener datos del producto
        const prodRes = await client.query(`
            SELECT p.id_producto, p.nombre, p.sku,
                   COALESCE(a.porcentaje, 21) as alicuota_iva,
                   COALESCE(inv.stock_real, 0) as stock_actual,
                   COALESCE(pr.precio, 0) as precio_lista
            FROM productos p
            LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
            LEFT JOIN inventario inv ON p.id_producto = inv.id_producto AND inv.id_empresa = $2
            LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_empresa = $2 AND pr.id_lista_precio = 1
            WHERE p.id_producto = $1
        `, [id_producto, id_empresa]);'''

    new_b5b2 = '''        const { id_producto, cantidad = 1, precio_unitario = null, id_lista_precio = null } = req.body;

        // Verificar que el pedido es borrador del usuario
        const pedidoCheck = await client.query(`
            SELECT id_pedido FROM pedidos
            WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4
        `, [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]);

        if (pedidoCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Borrador no encontrado o no pertenece al usuario' });
        }

        // B2 FIX: Lista de precios dinámica (frontend envía o se usa config/default)
        const listaDefault = parseInt(await getConfig(
            (q, p) => client.query(q, p), id_empresa, 'venta_rapida.lista_precio_default', '1'
        ));
        const listaEfectiva = id_lista_precio ? parseInt(id_lista_precio) : listaDefault;

        // Obtener datos del producto (B5 FIX: solo activos)
        const prodRes = await client.query(`
            SELECT p.id_producto, p.nombre, p.sku,
                   COALESCE(a.porcentaje, 21) as alicuota_iva,
                   COALESCE(inv.stock_real, 0) as stock_actual,
                   COALESCE(pr.precio, 0) as precio_lista
            FROM productos p
            LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
            LEFT JOIN inventario inv ON p.id_producto = inv.id_producto AND inv.id_empresa = $2
            LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_empresa = $2 AND pr.id_lista_precio = $3
            WHERE p.id_producto = $1 AND p.activo = TRUE
        `, [id_producto, id_empresa, listaEfectiva]);'''

    if old_b5b2 in content:
        content = content.replace(old_b5b2, new_b5b2, 1)
        fixes_applied.append('B5: Filtro activo=TRUE en producto')
        fixes_applied.append('B2: id_lista_precio dinámico (frontend + config)')
    else:
        print('WARN: B5/B2 — patrón agregarItem no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B9 — Validar permitir_cambiar_precio en agregarItem
    # ═══════════════════════════════════════════════════════════
    old_b9 = '''        const permitirCambiarPrecio = await getConfig(
            (q, p) => client.query(q, p), id_empresa, 'permitir_cambiar_precio_venta', 'false'
        ) === 'true';

        const precioFinal = (precio_unitario !== null && parseFloat(precio_unitario) > 0)
            ? parseFloat(precio_unitario)
            : parseFloat(producto.precio_lista) || 0;'''

    new_b9 = '''        const permitirCambiarPrecio = await getConfig(
            (q, p) => client.query(q, p), id_empresa, 'permitir_cambiar_precio_venta', 'false'
        ) === 'true';

        // B9 FIX: Si no tiene permiso, ignorar precio custom del frontend
        let precioFinal;
        if (precio_unitario !== null && parseFloat(precio_unitario) > 0) {
            const precioSolicitado = parseFloat(precio_unitario);
            const precioDeLista = parseFloat(producto.precio_lista) || 0;
            if (!permitirCambiarPrecio && Math.abs(precioSolicitado - precioDeLista) > 0.01) {
                // Sin permiso y precio distinto al de lista → usar lista
                precioFinal = precioDeLista;
            } else {
                precioFinal = precioSolicitado;
            }
        } else {
            precioFinal = parseFloat(producto.precio_lista) || 0;
        }'''

    if old_b9 in content:
        content = content.replace(old_b9, new_b9, 1)
        fixes_applied.append('B9: Validar permitir_cambiar_precio en agregarItem')
    else:
        print('WARN: B9 — patrón precio en agregarItem no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B11 — sincronizarPagos atómico (check+update en 1 query)
    # ═══════════════════════════════════════════════════════════
    old_b11 = '''        const check = await pool.query(
            'SELECT id_pedido FROM pedidos WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4',
            [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        await pool.query(
            'UPDATE pedidos SET pagos_provisorios = $1 WHERE id_pedido = $2 AND id_empresa = $3',
            [JSON.stringify(pagos), id_pedido, id_empresa]
        );

        res.json({ ok: true, pagos_guardados: pagos.length });'''

    new_b11 = '''        // B11 FIX: Check + update atómico en 1 query (sin race condition)
        const result = await pool.query(
            `UPDATE pedidos SET pagos_provisorios = $1
             WHERE id_pedido = $2 AND id_usuario = $3 AND id_empresa = $4 AND id_estado = $5
             RETURNING id_pedido`,
            [JSON.stringify(pagos), id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Borrador no encontrado' });
        }

        res.json({ ok: true, pagos_guardados: pagos.length });'''

    if old_b11 in content:
        content = content.replace(old_b11, new_b11, 1)
        fixes_applied.append('B11: sincronizarPagos atómico (1 query)')
    else:
        print('WARN: B11 — patrón sincronizarPagos no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # RESULTADO
    # ═══════════════════════════════════════════════════════════
    if not fixes_applied:
        print('\n⚠️  Ningún fix aplicado. Todos los patrones ya fueron modificados o no coinciden.')
        sys.exit(1)

    print(f'\n{"═" * 60}')
    print(f'LOTE 1 — BACKEND: {len(fixes_applied)} fixes')
    print(f'{"═" * 60}')
    for f in fixes_applied:
        print(f'  ✅ {f}')

    if DRY_RUN:
        print(f'\n🔍 DRY RUN — No se escribió nada.')
        print(f'   Ejecutar sin --dry-run para aplicar.')
    else:
        # Backup
        os.makedirs(BACKUP_DIR, exist_ok=True)
        shutil.copy2(TARGET, os.path.join(BACKUP_DIR, 'borrador.controller.js'))
        print(f'\n📦 Backup en: {BACKUP_DIR}/')

        # Escribir
        with open(TARGET, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'✅ Archivo escrito: {TARGET}')
        print(f'\n⚡ Ejecutar: source ~/.nvm/nvm.sh && node --check {TARGET} && pm2 restart erplago')

if __name__ == '__main__':
    main()
