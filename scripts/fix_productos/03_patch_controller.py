#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
PARCHE: productos.controller.js — BUG 3, 6
═══════════════════════════════════════════════════════════════════
BUG 3: ajustePrecioMasivo no pasa id_empresa al helper → UPDATE 0 filas
BUG 6: obtenerPorId filtra activo=TRUE → no se puede ver/editar desactivados
"""
import sys, shutil, os
from datetime import datetime

ARCHIVO = '/root/mi_erp/src/controllers/productos.controller.js'

PARCHES = [
    # ───────────────────────────────────────────────────────────────
    # BUG 3a: actualizarPrecio sin id_empresa (ajuste masivo venta)
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 3a — id_empresa en actualizarPrecio (venta)',
        'buscar': "await productosHelper.actualizarPrecio(client, { id_producto, id_lista_precio: id_lista, precio: precioNuevo });",
        'reemplazar': "await productosHelper.actualizarPrecio(client, { id_empresa, id_producto, id_lista_precio: id_lista, precio: precioNuevo });",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 3b: actualizarPrecioCompra sin id_empresa (ajuste masivo compra)
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 3b — id_empresa en actualizarPrecioCompra (compra)',
        'buscar': "await productosHelper.actualizarPrecioCompra(client, { id_producto, id_proveedor: row.id_proveedor, precio_compra: precioNuevo });",
        'reemplazar': "await productosHelper.actualizarPrecioCompra(client, { id_empresa, id_producto, id_proveedor: row.id_proveedor, precio_compra: precioNuevo });",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 6: obtenerPorId filtra activo=TRUE → imposible ver/editar desactivados
    # Fix: quitar filtro. El listado ya tiene su propio filtro de activo.
    #      Diseño REST correcto: GET por ID devuelve el recurso siempre.
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 6 — Quitar filtro activo en obtenerPorId',
        'buscar': "                WHERE p.id_producto = $2 AND p.activo = TRUE",
        'reemplazar': "                WHERE p.id_producto = $2",
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
        print(f'\n═══ {aplicados}/{len(PARCHES)} parches aplicados a productos.controller.js ═══')
    else:
        print('\n═══ Sin cambios — todos los parches ya estaban aplicados ═══')

if __name__ == '__main__':
    main()
