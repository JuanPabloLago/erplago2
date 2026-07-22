#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 2 — C2 + C3 (Totales con descuentos)
Fecha: 2026-03-26
═══════════════════════════════════════════════════════════════

C2: crear() calcula totales sin descuentos y usa columna inexistente
    → Usar totales reales del pedido (fuente de verdad)

C3: crear() y masivo() no pasan campos de descuento a factura_items
    → Incluir descuento_porcentaje, precio_lista, campos pedido-level

CAMBIOS EN: facturas.controller.js (4 reemplazos)
  R1: crear() — Reemplazar items query + cálculo manual por pedido real
  R2: crear() — Simplificar agruparIVAPorAlicuota (items directo)
  R3: crear() — crearFacturaConItems con descuentos
  R4: masivo() — crearFacturaConItems con descuentos

USO:
  python3 fix_facturacion_lote2.py          # Dry-run
  python3 fix_facturacion_lote2.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote2_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
ROOT = '/root/mi_erp'

fixes_applied = []
fixes_failed = []

def backup_file(filepath):
    if DRY_RUN:
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    rel = os.path.relpath(filepath, ROOT)
    dest = os.path.join(BACKUP_DIR, rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copy2(filepath, dest)

def apply_fix(filepath, old_str, new_str, fix_id, description):
    if not os.path.exists(filepath):
        fixes_failed.append(f"[{fix_id}] ARCHIVO NO ENCONTRADO: {filepath}")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    count = content.count(old_str)
    if count == 0:
        fixes_failed.append(f"[{fix_id}] CADENA NO ENCONTRADA en {os.path.basename(filepath)}")
        return False
    if count > 1:
        fixes_failed.append(f"[{fix_id}] CADENA AMBIGUA ({count} coincidencias) en {os.path.basename(filepath)}")
        return False

    if DRY_RUN:
        print(f"  ✓ [{fix_id}] {description}")
        print(f"    Archivo: {os.path.basename(filepath)}")
        print(f"    Coincidencias: {count}")
        print()
        fixes_applied.append(fix_id)
        return True

    backup_file(filepath)
    new_content = content.replace(old_str, new_str, 1)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

    fixes_applied.append(fix_id)
    print(f"  ✅ [{fix_id}] {description}")
    return True


FILE = f'{ROOT}/src/controllers/facturas.controller.js'


# ═══════════════════════════════════════════════════════════════
# R1: crear() — Reemplazar items query + cálculo manual
# PROBLEMA: usa pi.subtotal_linea (NO EXISTE), calcula sin descuentos
# FIX: leer pedido para totales reales, usar pi.* para items
# ═══════════════════════════════════════════════════════════════

R1_OLD = """\
        // --- Items ---
        let facturaItems = [];

        if (id_pedido) {
            const itemsRes = await client.query(`
                SELECT pi.id_producto, p.nombre as descripcion, pi.cantidad,
                       pi.precio_unitario_congelado as precio_unitario,
                       pi.iva_aplicado as porcentaje_iva,
                       pi.monto_iva, pi.subtotal_linea as subtotal,
                       pi.total_linea as total
                FROM pedidoitems pi
                JOIN productos p ON pi.id_producto = p.id_producto
                WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
            `, [id_pedido, id_empresa]);
            facturaItems = itemsRes.rows;
        } else {
            facturaItems = items || [];
        }

        if (facturaItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay items para facturar' });
        }

        // --- Calcular totales con redondeo por línea (consistente con helper) ---
        let subtotal = 0;
        let total_iva = 0;

        facturaItems.forEach(item => {
            const precio = parseFloat(item.precio_unitario);
            const cantidad = parseFloat(item.cantidad);
            const pctIva = parseFloat(item.porcentaje_iva || 21);
            const subtotal_linea = Math.round(precio * cantidad * 100) / 100;
            const iva_linea = Math.round(subtotal_linea * pctIva / 100 * 100) / 100;
            subtotal += subtotal_linea;
            total_iva += iva_linea;
        });

        subtotal = Math.round(subtotal * 100) / 100;
        total_iva = Math.round(total_iva * 100) / 100;
        const total = Math.round((subtotal + total_iva) * 100) / 100;"""

R1_NEW = """\
        // --- Obtener pedido con totales reales (C2 fix: fuente de verdad) ---
        const pedidoRes = await client.query(`
            SELECT id_pedido, subtotal_sin_iva, total_iva, total_final,
                   descuento_general, descuento_monto, subtotal_con_descuento,
                   descuento_fp_porcentaje, descuento_fp_monto,
                   id_forma_pago_principal
            FROM pedidos
            WHERE id_pedido = $1 AND id_empresa = $2
        `, [id_pedido, id_empresa]);

        if (pedidoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        const pedidoData = pedidoRes.rows[0];

        // --- Items con todos los campos (C3 fix: columna subtotal_linea no existe) ---
        const itemsRes = await client.query(`
            SELECT pi.*, p.nombre AS producto_nombre, p.sku
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
            ORDER BY pi.id_item
        `, [id_pedido, id_empresa]);
        const facturaItems = itemsRes.rows;

        if (facturaItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay items para facturar' });
        }

        // Totales desde el pedido (ya incluyen descuentos — no recalcular)
        const subtotal = parseFloat(pedidoData.subtotal_sin_iva || 0);
        const total_iva = parseFloat(pedidoData.total_iva || 0);
        const total = parseFloat(pedidoData.total_final || 0);"""

apply_fix(FILE, R1_OLD, R1_NEW, 'R1',
    'crear() — Reemplazar items query roto + cálculo sin descuentos por totales del pedido')


# ═══════════════════════════════════════════════════════════════
# R2: crear() — Simplificar agruparIVAPorAlicuota
# PROBLEMA: recalcula subtotal/iva_calculado sin descuentos
# FIX: pasar items directo (la función ya maneja los campos nativos)
# ═══════════════════════════════════════════════════════════════

R2_OLD = """\
            const ivaDetalle = afipService.agruparIVAPorAlicuota(
                facturaItems.map(item => ({
                    porcentaje_iva: item.porcentaje_iva || 21,
                    subtotal: parseFloat(item.precio_unitario) * parseFloat(item.cantidad),
                    iva_calculado: parseFloat(item.precio_unitario) * parseFloat(item.cantidad) * (parseFloat(item.porcentaje_iva || 21) / 100)
                }))
            );"""

R2_NEW = """\
            // C2 fix: pasar items directo — agruparIVAPorAlicuota ya maneja
            // iva_aplicado, total_linea, monto_iva, precio_unitario_congelado
            const ivaDetalle = afipService.agruparIVAPorAlicuota(facturaItems);"""

apply_fix(FILE, R2_OLD, R2_NEW, 'R2',
    'crear() — agruparIVAPorAlicuota con items directos (campos nativos)')


# ═══════════════════════════════════════════════════════════════
# R3: crear() — crearFacturaConItems con descuentos
# PROBLEMA: no pasa descuentos del pedido ni de items
# FIX: incluir campos de descuento pedido-level e item-level
# ═══════════════════════════════════════════════════════════════

R3_OLD = """\
        // --- Crear factura + items via helper (totales ya calculados arriba) ---
        const factura = await facturacionHelper.crearFacturaConItems(client, {
            id_empresa,
            id_pedido: id_pedido || null,
            id_cliente,
            id_tipo_factura,
            punto_venta,
            numero_factura,
            cae,
            cae_vencimiento: caeVto,
            observaciones: observaciones || null,
            id_deposito: pvData.id_deposito,
            items: facturaItems.map(item => ({
                id_producto: item.id_producto,
                cantidad: item.cantidad,
                descripcion: item.descripcion || item.producto_nombre || '',
                precio_unitario: item.precio_unitario,
                porcentaje_iva: item.porcentaje_iva || 21
            }))
        }, {
            calcularTotales: false,
            totalesExternos: { subtotal, total_iva, total }
        });"""

R3_NEW = """\
        // --- Crear factura + items via helper (C2+C3 fix: descuentos + totales pedido) ---
        const factura = await facturacionHelper.crearFacturaConItems(client, {
            id_empresa,
            id_pedido,
            id_cliente,
            id_tipo_factura,
            punto_venta,
            numero_factura,
            cae,
            cae_vencimiento: caeVto,
            observaciones: observaciones || null,
            id_deposito: pvData.id_deposito,
            descuento_porcentaje: parseFloat(pedidoData.descuento_general || 0),
            descuento_monto: parseFloat(pedidoData.descuento_monto || 0),
            descuento_fp_porcentaje: parseFloat(pedidoData.descuento_fp_porcentaje || 0),
            descuento_fp_monto: parseFloat(pedidoData.descuento_fp_monto || 0),
            id_forma_pago_principal: pedidoData.id_forma_pago_principal,
            items: facturaItems.map(item => ({
                id_producto: item.id_producto,
                cantidad: item.cantidad,
                descripcion: item.descripcion_congelada || item.producto_nombre || '',
                precio_unitario: item.precio_unitario_final || item.precio_unitario_congelado,
                porcentaje_iva: item.iva_aplicado || 21,
                precio_lista: item.precio_unitario_congelado,
                descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0)
            }))
        }, {
            calcularTotales: false,
            totalesExternos: { subtotal, total_iva, total }
        });"""

apply_fix(FILE, R3_OLD, R3_NEW, 'R3',
    'crear() — crearFacturaConItems con descuentos pedido-level e item-level')


# ═══════════════════════════════════════════════════════════════
# R4: masivo() — crearFacturaConItems con descuentos
# PROBLEMA: no pasa descuentos del pedido ni de items
# FIX: incluir campos de descuento (misma lógica que R3)
# ═══════════════════════════════════════════════════════════════

R4_OLD = """\
                // Crear factura + items via helper (totales externos del pedido)
                const factura = await facturacionHelper.crearFacturaConItems(client, {
                    id_empresa,
                    id_pedido,
                    id_cliente: pedido.id_cliente,
                    id_tipo_factura,
                    punto_venta,
                    numero_factura,
                    cae,
                    cae_vencimiento: caeVto,
                    id_deposito: pvData.id_deposito,
                    items: itemsRes.rows.map(item => ({
                        id_producto: item.id_producto,
                        cantidad: item.cantidad,
                        descripcion: item.descripcion_congelada || item.producto_nombre,
                        precio_unitario: item.precio_unitario_congelado || 0,
                        porcentaje_iva: item.iva_aplicado || 21
                    }))
                }, {
                    calcularTotales: false,
                    totalesExternos: { subtotal, total_iva: totalIva, total }
                });"""

R4_NEW = """\
                // Crear factura + items via helper (C3 fix: descuentos + totales pedido)
                const factura = await facturacionHelper.crearFacturaConItems(client, {
                    id_empresa,
                    id_pedido,
                    id_cliente: pedido.id_cliente,
                    id_tipo_factura,
                    punto_venta,
                    numero_factura,
                    cae,
                    cae_vencimiento: caeVto,
                    id_deposito: pvData.id_deposito,
                    descuento_porcentaje: parseFloat(pedido.descuento_general || 0),
                    descuento_monto: parseFloat(pedido.descuento_monto || 0),
                    descuento_fp_porcentaje: parseFloat(pedido.descuento_fp_porcentaje || 0),
                    descuento_fp_monto: parseFloat(pedido.descuento_fp_monto || 0),
                    id_forma_pago_principal: pedido.id_forma_pago_principal,
                    items: itemsRes.rows.map(item => ({
                        id_producto: item.id_producto,
                        cantidad: item.cantidad,
                        descripcion: item.descripcion_congelada || item.producto_nombre,
                        precio_unitario: item.precio_unitario_final || item.precio_unitario_congelado || 0,
                        porcentaje_iva: item.iva_aplicado || 21,
                        precio_lista: item.precio_unitario_congelado,
                        descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0)
                    }))
                }, {
                    calcularTotales: false,
                    totalesExternos: { subtotal, total_iva: totalIva, total }
                });"""

apply_fix(FILE, R4_OLD, R4_NEW, 'R4',
    'masivo() — crearFacturaConItems con descuentos pedido-level e item-level')


# ═══════════════════════════════════════════════════════════════
# RESUMEN
# ═══════════════════════════════════════════════════════════════

print()
print('═' * 60)
if DRY_RUN:
    print('  MODO DRY-RUN — No se aplicó ningún cambio')
    print('  Ejecutar con --apply para aplicar')
else:
    print(f'  BACKUP: {BACKUP_DIR}')
print('═' * 60)
print(f'  ✅ Fixes verificados: {len(fixes_applied)}/{len(fixes_applied) + len(fixes_failed)}')
if fixes_applied:
    print(f'     Aplicados: {", ".join(fixes_applied)}')
if fixes_failed:
    print(f'  ❌ Fallaron: {len(fixes_failed)}')
    for f in fixes_failed:
        print(f'     {f}')
print('═' * 60)

if not DRY_RUN and fixes_applied:
    print()
    print('  ⚡ Reiniciar servidor:')
    print('     source ~/.nvm/nvm.sh && pm2 restart erplago')
    print()
    print('  🧪 Verificar con curl:')
    print('     # Test crear individual (con pedido de prueba):')
    print('     curl -s http://localhost:3000/api/facturas/mi-punto-venta \\')
    print('       -H "Authorization: Bearer $(cat /tmp/token)" | jq .')
    print()
