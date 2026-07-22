#!/usr/bin/env python3
"""
FIX overlay compacto — reemplaza el CSS del Bug1 por uno mejor
"""
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else '/root/mi_erp/frontend/venta-rapida.html'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

original = content

# Buscar TODO el bloque CSS del Bug1 (desde el comentario hasta el cierre de list-group)
viejo_css = """        /* === FIX BUG1: Sugerencias como overlay (no empuja layout) === */
        .col-lg-12 { position: relative; }
        #sugerenciasProductos {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: 1000;
            max-height: 55vh;
            overflow-y: auto;
            margin: 0 !important;
            padding: 0 12px;
            background: transparent;
        }
        #sugerenciasProductos .list-group {
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            border: 1px solid rgba(0,0,0,0.1);
        }"""

# También intentar la versión con background:white que ya se parcheo
viejo_css_v2 = """        /* === FIX BUG1: Sugerencias como overlay (no empuja layout) === */
        .col-lg-12 { position: relative; }
        #sugerenciasProductos {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: 1000;
            max-height: 55vh;
            overflow-y: auto;
            margin: 0 !important;
            padding: 0 12px;
            background: transparent;
        }
        #sugerenciasProductos .list-group {
            background: white;
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            border: 1px solid rgba(0,0,0,0.1);
        }"""

nuevo_css = """        /* === FIX BUG1: Sugerencias dropdown compacto === */
        .col-lg-12 { position: relative; }
        #sugerenciasProductos {
            position: absolute;
            top: 100%;
            left: 0;
            z-index: 1000;
            width: 520px;
            max-height: 50vh;
            overflow-y: auto;
            overflow-x: hidden;
            margin: 0 !important;
            padding: 0 !important;
            scrollbar-width: thin;
        }
        #sugerenciasProductos::-webkit-scrollbar { width: 4px; }
        #sugerenciasProductos::-webkit-scrollbar-thumb { background: #bbb; border-radius: 2px; }
        #sugerenciasProductos .list-group {
            background: #fff;
            border: 1px solid #ccc;
            border-top: 2px solid #667eea;
            border-radius: 0 0 8px 8px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.18);
        }
        /* Filas compactas — override de estilos inline */
        #sugerenciasProductos .producto-sugerencia {
            padding: 5px 8px !important;
            font-size: 12px !important;
            gap: 6px;
            border-bottom: 1px solid #f0f0f0 !important;
            cursor: pointer;
        }
        #sugerenciasProductos .producto-sugerencia:last-child {
            border-bottom: none !important;
        }
        #sugerenciasProductos .producto-sugerencia:hover {
            background: #eef2ff !important;
        }
        /* Imagen chica o esconder */
        #sugerenciasProductos .producto-sugerencia img {
            width: 28px !important;
            height: 28px !important;
            margin-right: 6px !important;
            border-radius: 4px !important;
        }
        #sugerenciasProductos .producto-sugerencia > div:first-child {
            width: 28px !important;
            height: 28px !important;
            min-width: 28px;
            margin-right: 6px !important;
        }
        /* Texto compacto */
        #sugerenciasProductos .producto-sugerencia div[style*="font-size:13px"] {
            font-size: 12px !important;
        }
        #sugerenciasProductos .producto-sugerencia div[style*="font-size:15px"] {
            font-size: 13px !important;
        }
        #sugerenciasProductos .producto-sugerencia div[style*="font-size:11px"] {
            font-size: 10px !important;
        }
        #sugerenciasProductos .producto-sugerencia .badge {
            font-size: 9px !important;
            padding: 1px 4px !important;
        }"""

found = False
if viejo_css_v2 in content:
    content = content.replace(viejo_css_v2, nuevo_css)
    found = True
    print("[OK] CSS v2 (con background:white) reemplazado")
elif viejo_css in content:
    content = content.replace(viejo_css, nuevo_css)
    found = True
    print("[OK] CSS v1 reemplazado")
else:
    print("[!!] No encontre el CSS de Bug1 para reemplazar")
    # Intentar buscar parcialmente
    if 'FIX BUG1' in content:
        print("     El comentario FIX BUG1 existe pero el contenido cambio")
        print("     Revisar manualmente")
    sys.exit(1)

if content == original:
    print("Sin cambios")
    sys.exit(0)

if '</html>' not in content:
    print("[!!] HTML roto, no se guarda")
    sys.exit(1)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print("\n=== OVERLAY COMPACTO APLICADO ===")
