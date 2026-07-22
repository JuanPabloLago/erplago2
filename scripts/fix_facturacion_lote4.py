#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
FIX FACTURACIÓN LOTE 4 — I1 (Anulación transaccional con NC)
Fecha: 2026-03-26
═══════════════════════════════════════════════════════════════

I1: anular() no es transaccional, no genera NC, no revierte pedido
    → Rediseño completo: transacción que genera NC AFIP + CC + anula + revierte

CAMBIOS EN: facturas.controller.js (2 reemplazos)
  R1: Agregar import de notasHelper
  R2: Reescribir exports.anular completo

USO:
  python3 fix_facturacion_lote4.py          # Dry-run
  python3 fix_facturacion_lote4.py --apply   # Aplicar
═══════════════════════════════════════════════════════════════
"""

import sys
import os
import shutil
from datetime import datetime

DRY_RUN = '--apply' not in sys.argv
BACKUP_DIR = f'/root/mi_erp/backups/pre_fix_facturacion_lote4_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
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
# R1: Agregar import de notasHelper
# ═══════════════════════════════════════════════════════════════

R1_OLD = """\
const facturacionHelper = require('../utils/facturacion.helper');
const { generarBusquedaMultiPalabra } = require('../utils/busqueda.helper');"""

R1_NEW = """\
const facturacionHelper = require('../utils/facturacion.helper');
const notasHelper = require('../utils/notas.helper');
const { generarBusquedaMultiPalabra } = require('../utils/busqueda.helper');"""

apply_fix(FILE, R1_OLD, R1_NEW, 'R1',
    'Agregar import de notasHelper')


# ═══════════════════════════════════════════════════════════════
# R2: Reescribir exports.anular completo
# ═══════════════════════════════════════════════════════════════

R2_OLD = """\
// ============================================================
// ANULAR FACTURA — via helper
// ============================================================
exports.anular = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);

    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden anular facturas' });
    }

    try {
        const resultado = await facturacionHelper.anularFactura(pool, {
            id_factura,
            id_empresa
        });

        logger.info(`Factura anulada: ${resultado.numero_completo}`);

        res.json({
            message: 'Factura anulada exitosamente',
            numero_completo: resultado.numero_completo,
            requiere_nc: resultado.requiere_nc
        });
    } catch (error) {
        logger.error('Error al anular factura:', error.message);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Error al anular factura' });
    }
};"""

R2_NEW = """\
// ============================================================
// ANULAR FACTURA — Transaccional: genera NC + CC + revierte pedido (I1 fix)
// ============================================================
// Flujo legal Argentina: factura con CAE no se "anula", se emite NC.
// 1. Genera NC por el total de la factura (con CAE AFIP si aplica)
// 2. Registra NC en CC del cliente (haber = reduce deuda)
// 3. Marca factura como anulada
// 4. Revierte pedido a estado confirmado (2)
// Todo en una transacción — si AFIP falla, no se graba nada.
// ============================================================
exports.anular = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);
    const id_usuario = req.usuario.id_usuario;

    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden anular facturas' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ── 1. Obtener factura con lock ──────────────────────────────
        const facturaRes = await client.query(`
            SELECT f.*, ft.codigo AS letra,
                   c.id_condicion_iva, c.razon_social, c.cuit_cuil
            FROM facturas f
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_factura = $1 AND f.id_empresa = $2
            FOR UPDATE OF f
        `, [id_factura, id_empresa]);

        if (facturaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        const factura = facturaRes.rows[0];

        if (factura.estado === 'anulada') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'La factura ya está anulada' });
        }

        // ── 2. Verificar que no exista NC activa para esta factura ───
        const ncExistente = await client.query(`
            SELECT id_nota, numero_completo
            FROM notas_credito_debito
            WHERE id_factura_origen = $1 AND id_empresa = $2
              AND estado = 'activa' AND tipo_nota = 'credito'
        `, [id_factura, id_empresa]);

        if (ncExistente.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Ya existe NC activa para esta factura: ' + ncExistente.rows[0].numero_completo
            });
        }

        // ── 3. Obtener items de la factura ───────────────────────────
        const itemsRes = await client.query(`
            SELECT fi.*, p.nombre AS producto_nombre
            FROM factura_items fi
            LEFT JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1 AND fi.id_empresa = $2
            ORDER BY fi.numero_linea
        `, [id_factura, id_empresa]);

        if (itemsRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Factura sin items' });
        }

        // ── 4. Solicitar CAE para NC en AFIP (si corresponde) ───────
        const tieneCaeReal = factura.cae && !factura.cae.startsWith('OFFLINE');
        const letra = factura.letra;
        const codigoAfip = notasHelper.determinarCodigoAFIP('credito', letra);
        const tipoFacturaAfip = afipService.tipoFacturaAFIP(factura.id_tipo_factura);

        let ncCae = null;
        let ncCaeVto = null;

        if (tieneCaeReal) {
            await afipService.cargarConfiguracion(pool, id_empresa);

            if (!afipService.config.modoOffline) {
                // Preview del próximo número NC (sin incrementar)
                const previewNumero = await notasHelper.consultarProximoNumero(
                    id_empresa, factura.punto_venta, 'credito'
                );

                // IVA agrupado desde items de la factura
                const ivaDetalle = afipService.agruparIVAPorAlicuota(itemsRes.rows);

                try {
                    const resultadoAFIP = await afipService.solicitarCAE({
                        punto_venta: factura.punto_venta,
                        cbte_tipo_afip: parseInt(codigoAfip),
                        numero_factura: previewNumero,
                        cuit_cliente: factura.cuit_cuil,
                        id_condicion_iva_cliente: factura.id_condicion_iva,
                        neto_gravado: Math.round(parseFloat(factura.subtotal) * 100) / 100,
                        total_iva: Math.round(parseFloat(factura.total_iva) * 100) / 100,
                        total: Math.round(parseFloat(factura.total) * 100) / 100,
                        iva_detalle: ivaDetalle,
                        cbte_asoc: {
                            tipo: tipoFacturaAfip,
                            punto_venta: factura.punto_venta,
                            numero: factura.numero_factura,
                        },
                    });

                    ncCae = resultadoAFIP.cae;
                    const vtoStr = resultadoAFIP.cae_vencimiento;
                    ncCaeVto = new Date(
                        parseInt(vtoStr.substring(0, 4)),
                        parseInt(vtoStr.substring(4, 6)) - 1,
                        parseInt(vtoStr.substring(6, 8))
                    );
                } catch (afipError) {
                    await client.query('ROLLBACK');
                    logger.error('AFIP NC error:', afipError.message);
                    return res.status(503).json({
                        error: 'No se pudo obtener CAE para la Nota de Crédito. AFIP: ' + afipError.message,
                        afip_error: true
                    });
                }
            } else {
                ncCae = 'OFFLINE-NC-' + Date.now();
                ncCaeVto = new Date();
                ncCaeVto.setDate(ncCaeVto.getDate() + 10);
            }
        } else {
            // Factura sin CAE real (offline) → NC offline
            ncCae = 'OFFLINE-NC-' + Date.now();
            ncCaeVto = new Date();
            ncCaeVto.setDate(ncCaeVto.getDate() + 10);
        }

        // ── 5. Crear NC via notas.helper ─────────────────────────────
        const nota = await notasHelper.crearNotaConItems(client, {
            id_empresa,
            tipo_nota: 'credito',
            letra,
            id_cliente: factura.id_cliente,
            id_usuario,
            punto_venta: factura.punto_venta,
            motivo: 'Anulacion Factura ' + factura.numero_completo,
            observaciones: req.body.observaciones || null,
            origen: 'factura',
            id_factura_origen: id_factura,
            cae: ncCae,
            vencimiento_cae: ncCaeVto,
            items: itemsRes.rows.map(item => ({
                id_producto: item.id_producto,
                descripcion: item.descripcion || item.producto_nombre,
                cantidad: parseFloat(item.cantidad),
                precio_unitario: parseFloat(item.precio_unitario),
                iva_porcentaje: parseFloat(item.porcentaje_iva || 21),
            })),
        });

        // ── 6. Registrar NC en cuenta corriente del cliente ──────────
        const nuevoSaldo = await notasHelper.registrarEnCuentaCorriente(
            client, id_empresa, nota
        );

        // ── 7. Marcar factura como anulada ───────────────────────────
        await facturacionHelper.anularFactura(client, {
            id_factura,
            id_empresa
        });

        // ── 8. Revertir pedido a confirmado si estaba facturado ──────
        const ESTADO_FACTURADO = 3;
        const ESTADO_CONFIRMADO = 2;
        let pedidoRevertido = false;

        if (factura.id_pedido) {
            const pedidoUpd = await client.query(`
                UPDATE pedidos SET id_estado = $1
                WHERE id_pedido = $2 AND id_empresa = $3 AND id_estado = $4
                RETURNING id_pedido
            `, [ESTADO_CONFIRMADO, factura.id_pedido, id_empresa, ESTADO_FACTURADO]);
            pedidoRevertido = pedidoUpd.rows.length > 0;
        }

        // ── 9. COMMIT ────────────────────────────────────────────────
        await client.query('COMMIT');

        logger.info(
            'Factura anulada: ' + factura.numero_completo +
            ' | NC generada: ' + nota.numero_completo +
            ' | CAE NC: ' + ncCae +
            ' | Pedido revertido: ' + (pedidoRevertido ? 'si' : 'no') +
            ' | empresa=' + id_empresa
        );

        res.json({
            message: 'Factura anulada correctamente. NC ' + nota.numero_completo + ' generada.',
            factura: {
                numero_completo: factura.numero_completo,
                estado: 'anulada'
            },
            nota_credito: {
                id_nota: nota.id_nota,
                numero_completo: nota.numero_completo,
                cae: ncCae,
                cae_vencimiento: ncCaeVto,
                total: parseFloat(nota.total),
            },
            pedido_revertido: pedidoRevertido,
            saldo_cc: nuevoSaldo,
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al anular factura:', error.message);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Error al anular factura' });
    } finally {
        client.release();
    }
};"""

apply_fix(FILE, R2_OLD, R2_NEW, 'R2',
    'Reescribir anular: transacción completa con NC + AFIP + CC + revertir pedido')


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
