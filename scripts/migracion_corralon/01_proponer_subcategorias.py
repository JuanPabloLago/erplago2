#!/usr/bin/env python3
"""
Genera CSV de propuesta de subcategorías para los productos de un conjunto web.
NO MUTA NADA en BD. Solo lee y escribe el CSV de salida.

Uso:
  python3 01_proponer_subcategorias.py --conjunto-slug corralon
  python3 01_proponer_subcategorias.py --conjunto-slug corralon --id-empresa 1

Output:
  propuesta_<slug>_<timestamp>.csv  (separador ;)

La columna 'decision_subcategoria' viene pre-rellenada con la sugerencia automática
(palabra raíz del nombre + plural). Vos editás solo lo que no te guste.
"""
import argparse
import csv
import os
import sys
import unicodedata
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: falta psycopg2.")
    print("Instalalo con: pip install psycopg2-binary --break-system-packages")
    sys.exit(1)

DB = {
    'host': 'localhost',
    'user': 'juanpablo',
    'password': os.environ.get('PGPASSWORD', 'Huu3697debian@'),
    'database': 'erplago',
}


def normalizar(s):
    """Quita tildes y pasa a mayúsculas."""
    if not s:
        return ''
    s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('ASCII')
    return s.upper().strip()


def pluralizar(palabra):
    """Pluraliza simple en español: vocal final -> +S, consonante -> +ES."""
    if not palabra:
        return ''
    return palabra + 'S' if palabra[-1] in 'AEIOU' else palabra + 'ES'


def detectar_palabra_raiz(nombre):
    """Devuelve la primera palabra significativa del nombre (>=3 chars, no número)."""
    if not nombre:
        return ''
    tokens = nombre.replace('/', ' ').replace('.', ' ').replace(',', ' ').split()
    for t in tokens:
        n = normalizar(t)
        if len(n) >= 3 and not n.isdigit() and not all(c in '0123456789XKG' for c in n):
            return n
    return ''


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--conjunto-slug', required=True, help='Slug del conjunto (ej: corralon)')
    p.add_argument('--id-empresa', type=int, default=1)
    args = p.parse_args()

    conn = psycopg2.connect(**DB)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute("""
        SELECT id_conjunto, web_label
        FROM conjuntos
        WHERE id_empresa = %s AND web_slug = %s AND activo = true
    """, (args.id_empresa, args.conjunto_slug))
    conj = cur.fetchone()
    if not conj:
        print(f"ERROR: conjunto '{args.conjunto_slug}' no existe en empresa {args.id_empresa}")
        sys.exit(1)
    print(f"Conjunto: {conj['web_label']} (id={conj['id_conjunto']})")

    cur.execute("""
        SELECT
            p.id_producto, p.sku, p.nombre, p.id_producto_padre,
            p.id_categoria, c.nombre AS cat_nombre,
            m.nombre AS marca,
            pp.nombre AS padre_nombre
        FROM conjunto_items ci
        JOIN productos p          ON p.id_producto = ci.id_producto
        LEFT JOIN categorias c    ON c.id_categoria = p.id_categoria
        LEFT JOIN marcas m        ON m.id_marca = p.id_marca
        LEFT JOIN productos pp    ON pp.id_producto = p.id_producto_padre
        WHERE ci.id_conjunto = %s
          AND ci.id_empresa = %s
          AND p.activo = true
        ORDER BY COALESCE(p.id_producto_padre, p.id_producto), p.nombre
    """, (conj['id_conjunto'], args.id_empresa))

    productos = cur.fetchall()
    print(f"Productos en conjunto: {len(productos)}")
    if not productos:
        print("Sin productos. Saliendo.")
        sys.exit(0)

    rows = []
    grupos = {}
    for p_row in productos:
        if p_row['padre_nombre']:
            base = detectar_palabra_raiz(p_row['padre_nombre']) or detectar_palabra_raiz(p_row['nombre'])
        else:
            base = detectar_palabra_raiz(p_row['nombre'])
        sugerencia = pluralizar(base) if base else ''

        rows.append({
            'id_producto': p_row['id_producto'],
            'sku': p_row['sku'] or '',
            'nombre': p_row['nombre'] or '',
            'marca': p_row['marca'] or '',
            'id_padre': p_row['id_producto_padre'] or '',
            'padre_nombre': p_row['padre_nombre'] or '',
            'id_categoria_actual': p_row['id_categoria'] or '',
            'cat_actual': p_row['cat_nombre'] or '',
            'palabra_raiz_detectada': base,
            'subcategoria_sugerida': sugerencia,
            'decision_subcategoria': sugerencia,
        })
        grupos[sugerencia] = grupos.get(sugerencia, 0) + 1

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    out_dir = '/root/mi_erp/scripts/migracion_corralon'
    out = f'{out_dir}/propuesta_{args.conjunto_slug}_{ts}.csv'
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=';')
        w.writeheader()
        w.writerows(rows)

    print(f"\nCSV generado: {out}")
    print(f"\nResumen sugerencias automáticas:")
    for sug, count in sorted(grupos.items(), key=lambda x: -x[1]):
        nombre = sug if sug else '(sin sugerencia)'
        print(f"  {nombre:<25} {count:>4} productos")

    print("\nPróximos pasos:")
    print("  1. Bajá el CSV con WinSCP / pscp")
    print("  2. Editá la columna 'decision_subcategoria' (separador ;)")
    print("  3. Guardá el CSV con el mismo separador")
    print("  4. Subilo de vuelta y avisame para Bloque 2 (aplicación)")

    cur.close()
    conn.close()


if __name__ == '__main__':
    main()
