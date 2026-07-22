#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
PARCHE: productos.helper.js — BUG 4, 5, 7
═══════════════════════════════════════════════════════════════════
BUG 4: actualizarProducto() pisa url_imagen con null
BUG 5: inicializarInventario() sin ON CONFLICT
BUG 7: actualizarProductoCompleto() borra conjuntos de TODAS las empresas
"""
import sys, shutil, os
from datetime import datetime

ARCHIVO = '/root/mi_erp/src/utils/productos.helper.js'

# ═══════════════════════════════════════════════════════════════════
# PARCHES (old_text → new_text)
# ═══════════════════════════════════════════════════════════════════
PARCHES = [
    # ───────────────────────────────────────────────────────────────
    # BUG 4: url_imagen se sobreescribe con null al editar producto
    # Fix: COALESCE para preservar valor existente si llega null
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 4 — COALESCE url_imagen en actualizarProducto',
        'buscar': '            url_imagen = $9,\n            cod_proveedor = $10\n        WHERE id_producto = $11 AND activo = TRUE',
        'reemplazar': '            url_imagen = COALESCE($9, url_imagen),\n            cod_proveedor = COALESCE($10, cod_proveedor)\n        WHERE id_producto = $11 AND activo = TRUE',
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 5: INSERT inventario sin ON CONFLICT → falla en re-creación
    # Fix: ON CONFLICT (id_empresa, id_producto) DO NOTHING
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 5 — ON CONFLICT en inicializarInventario',
        'buscar': "        INSERT INTO inventario (id_empresa, id_producto, stock_real, stock_minimo, stock_maximo, publicado_web)\n        VALUES ($1, $2, 0, $3, $4, $5)\n    `, [id_empresa, id_producto, stock_minimo, stock_maximo, publicado_web]);",
        'reemplazar': "        INSERT INTO inventario (id_empresa, id_producto, stock_real, stock_minimo, stock_maximo, publicado_web)\n        VALUES ($1, $2, 0, $3, $4, $5)\n        ON CONFLICT (id_empresa, id_producto) DO NOTHING\n    `, [id_empresa, id_producto, stock_minimo, stock_maximo, publicado_web]);",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 7: DELETE conjunto_items sin filtro id_empresa
    # Fix: Agregar AND id_empresa = $2
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 7 — filtro id_empresa en DELETE conjunto_items',
        'buscar': "        await client.query('DELETE FROM conjunto_items WHERE id_producto = $1', [id_producto]);",
        'reemplazar': "        await client.query('DELETE FROM conjunto_items WHERE id_producto = $1 AND id_empresa = $2', [id_producto, id_empresa]);",
    },
]

# ═══════════════════════════════════════════════════════════════════
# EJECUCIÓN
# ═══════════════════════════════════════════════════════════════════
def main():
    if not os.path.exists(ARCHIVO):
        print(f'❌ No se encontró {ARCHIVO}')
        sys.exit(1)

    # Backup
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
                print(f'⚠️  {p["nombre"]}: {ocurrencias} ocurrencias encontradas, esperaba 1. SALTANDO.')
                continue
            contenido = contenido.replace(p['buscar'], p['reemplazar'], 1)
            aplicados += 1
            print(f'✅ {p["nombre"]}')
        else:
            print(f'⚠️  {p["nombre"]}: texto no encontrado (¿ya aplicado?)')

    if contenido != original:
        with open(ARCHIVO, 'w') as f:
            f.write(contenido)
        print(f'\n═══ {aplicados}/{len(PARCHES)} parches aplicados a productos.helper.js ═══')
    else:
        print('\n═══ Sin cambios — todos los parches ya estaban aplicados ═══')

if __name__ == '__main__':
    main()
