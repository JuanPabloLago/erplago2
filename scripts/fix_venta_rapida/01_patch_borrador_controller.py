#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
PARCHE: borrador.controller.js — BUG VR-1a, VR-2
═══════════════════════════════════════════════════════════════════
VR-1a: sincronizarPagos no valida NaN en id_pedido → PostgreSQL explota
VR-2: agregarItem usa producto.precio_lista que no existe en el SELECT
"""
import sys, shutil, os
from datetime import datetime

ARCHIVO = '/root/mi_erp/src/controllers/borrador.controller.js'

PARCHES = [
    # ───────────────────────────────────────────────────────────────
    # VR-1a: sincronizarPagos → parseInt('null') = NaN → error SQL
    # Fix: Validar id_pedido antes de la query
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-1a — Validar id_pedido en sincronizarPagos',
        'buscar': """const id_pedido = parseInt(req.params.id, 10);
        const { pagos = [] } = req.body;

        const check = await pool.query(""",
        'reemplazar': """const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) {
            return res.status(400).json({ error: 'ID de borrador inválido' });
        }
        const { pagos = [] } = req.body;

        const check = await pool.query(""",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-2: El SELECT no trae precio del producto → fallback a 0
    # Fix: Agregar JOIN con precios y traer precio de la lista del cliente
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-2 — Agregar precio_lista al SELECT de agregarItem',
        'buscar': """COALESCE(inv.stock_real, 0) as stock_actual
            FROM productos p
            LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
            LEFT JOIN inventario inv ON p.id_producto = inv.id_producto AND inv.id_empresa = $2
            WHERE p.id_producto = $1
        `, [id_producto, id_empresa]);""",
        'reemplazar': """COALESCE(inv.stock_real, 0) as stock_actual,
                   COALESCE(pr.precio, 0) as precio_lista
            FROM productos p
            LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
            LEFT JOIN inventario inv ON p.id_producto = inv.id_producto AND inv.id_empresa = $2
            LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_empresa = $2 AND pr.id_lista_precio = 1
            WHERE p.id_producto = $1
        `, [id_producto, id_empresa]);""",
    },
]

def main():
    if not os.path.exists(ARCHIVO):
        print(f'❌ No se encontró {ARCHIVO}')
        sys.exit(1)

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup = f'{ARCHIVO}.bak_{ts}'
    shutil.copy2(ARCHIVO, backup)
    print(f'✅ Backup: {backup}')

    with open(ARCHIVO, 'r') as f:
        contenido = f.read()

    original = contenido
    aplicados = 0

    for p in PARCHES:
        if p['buscar'] in contenido:
            ocurrencias = contenido.count(p['buscar'])
            if ocurrencias != 1:
                print(f'⚠️  {p["nombre"]}: {ocurrencias} ocurrencias, esperaba 1. SALTANDO.')
                continue
            contenido = contenido.replace(p['buscar'], p['reemplazar'], 1)
            aplicados += 1
            print(f'✅ {p["nombre"]}')
        else:
            print(f'⚠️  {p["nombre"]}: texto no encontrado (¿ya aplicado?)')

    if contenido != original:
        with open(ARCHIVO, 'w') as f:
            f.write(contenido)
        print(f'\n═══ {aplicados}/{len(PARCHES)} parches aplicados a borrador.controller.js ═══')
    else:
        print('\n═══ Sin cambios ═══')

if __name__ == '__main__':
    main()
