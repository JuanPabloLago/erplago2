#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
PARCHE: productos.js (frontend) — BUG 1, 2
═══════════════════════════════════════════════════════════════════
BUG 1: guardarProducto() no envía url_imagen ni publicado_web → se pierden al editar
BUG 2: abrirModalNuevo() no limpia precioCompraNeto → dato fantasma
"""
import sys, shutil, os
from datetime import datetime

ARCHIVO = '/root/mi_erp/frontend/js/productos.js'

PARCHES = [
    # ───────────────────────────────────────────────────────────────
    # PREP: Agregar productoEditando al Estado global
    # Para preservar datos que el formulario no gestiona (url_imagen, etc.)
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'PREP — Agregar productoEditando a Estado',
        'buscar': "    searchResultIndex: -1\n};",
        'reemplazar': "    searchResultIndex: -1,\n    productoEditando: null\n};",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 1a: Almacenar producto cargado al editar
    # editarProducto() guarda la referencia para que guardarProducto
    # pueda leer url_imagen y publicado_web
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 1a — Almacenar producto en editarProducto',
        'buscar': "        const producto = await response.json();\n\n        document.getElementById('idProducto').value = producto.id_producto;",
        'reemplazar': "        const producto = await response.json();\n        Estado.productoEditando = producto;\n\n        document.getElementById('idProducto').value = producto.id_producto;",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 1b: Enviar url_imagen y publicado_web al guardar
    # Estos campos no están en el formulario pero deben preservarse
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 1b — Preservar url_imagen y publicado_web en guardarProducto',
        'buscar': "        precios: []\n    };\n\n    if (!id_producto) {",
        'reemplazar': "        precios: []\n    };\n\n    // Preservar datos que el formulario no gestiona\n    if (id_producto && Estado.productoEditando) {\n        datos.url_imagen = Estado.productoEditando.url_imagen || null;\n        datos.publicado_web = Estado.productoEditando.publicado_web || false;\n    }\n\n    if (!id_producto) {",
    },

    # ───────────────────────────────────────────────────────────────
    # BUG 2: Limpiar precio compra y estado al abrir modal nuevo
    # Si el usuario editó un producto antes, los campos de precio
    # de compra pueden conservar valores del producto anterior
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'BUG 2 — Limpiar precioCompra y productoEditando en abrirModalNuevo',
        'buscar': "    document.getElementById('codigoProveedor').value = '';\n    // Generar campos duales de precios (NETO / CON IVA)\n    generarCamposPrecios();",
        'reemplazar': "    document.getElementById('codigoProveedor').value = '';\n    // Limpiar precio compra y estado de edición\n    Estado.productoEditando = null;\n    const _pcNeto = document.getElementById('precioCompraNeto');\n    const _pcIva = document.getElementById('precioCompraIva');\n    if (_pcNeto) _pcNeto.value = '';\n    if (_pcIva) _pcIva.value = '';\n    // Generar campos duales de precios (NETO / CON IVA)\n    generarCamposPrecios();",
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
        print(f'\n═══ {aplicados}/{len(PARCHES)} parches aplicados a productos.js ═══')
    else:
        print('\n═══ Sin cambios — todos los parches ya estaban aplicados ═══')

if __name__ == '__main__':
    main()
