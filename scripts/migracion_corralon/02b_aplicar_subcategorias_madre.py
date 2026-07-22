#!/usr/bin/env python3
"""
02b_aplicar_subcategorias_madre.py — Opción 2 del rediseño catálogo.

Aplica el CSV temático a BD pero SOLO mueve los productos que están en
la categoría madre (id=18 'CORRALON'). Los productos que ya viven en
categorías específicas (ABERTURAS, MEMBRANA, HIDROFUGO, PINTURERIA, PVC,
CARRETILLAS Y HORMIGONERAS, etc.) NO SE TOCAN, se respeta su
clasificación existente para no romper listados/reportes.

Resultado en lago.ar/?conjunto=corralon:
- Cards nuevos para los 87 huérfanos: ÁRIDOS, AGLOMERANTES, HIERROS Y
  MALLAS, VIGUETAS, LADRILLOS Y BLOQUES, SANITARIOS, etc.
- Cards existentes para los 86 que estaban en cats específicas: ABERTURAS,
  MEMBRANA, HIDROFUGO, PINTURERIA, PVC, CARRETILLAS Y HORMIGONERAS, etc.

DRY-RUN por defecto. --apply para escribir.

Uso:
  python3 02b_aplicar_subcategorias_madre.py                     # dry-run
  python3 02b_aplicar_subcategorias_madre.py --apply             # aplica
  python3 02b_aplicar_subcategorias_madre.py --id-madre 18       # default
"""
import argparse
import csv
import glob
import json
import os
import sys
from collections import Counter
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: pip install psycopg2-binary --break-system-packages")
    sys.exit(1)

DB = {
    'host': 'localhost',
    'user': 'juanpablo',
    'password': os.environ.get('PGPASSWORD', 'Huu3697debian@'),
    'database': 'erplago',
}
DIR = '/root/mi_erp/scripts/migracion_corralon'
ID_MADRE_DEFAULT = 18  # CORRALON


def encontrar_csv():
    files = glob.glob(f'{DIR}/propuesta_corralon_*_temas_*.csv')
    return max(files, key=os.path.getmtime) if files else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--csv', help='CSV de entrada (default: último _temas_*.csv)')
    p.add_argument('--apply', action='store_true', help='Aplicar. Sin esto es dry-run.')
    p.add_argument('--id-madre', type=int, default=ID_MADRE_DEFAULT,
                   help=f'ID de la categoría madre (default {ID_MADRE_DEFAULT}=CORRALON)')
    args = p.parse_args()

    csv_in = args.csv or encontrar_csv()
    if not csv_in or not os.path.exists(csv_in):
        print("ERROR: no encontré CSV temático. Corré 99_remapear_temas.py primero.")
        sys.exit(1)

    print(f"CSV       : {csv_in}")
    print(f"id_madre  : {args.id_madre}")
    print(f"Modo      : {'APPLY (escribe en BD)' if args.apply else 'DRY-RUN (solo plan)'}")
    print()

    # Leer CSV
    rows_all = []
    with open(csv_in, 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter=';'):
            rows_all.append(r)
    print(f"Productos totales en CSV: {len(rows_all)}")

    # OPCIÓN 2: separar los que están en la madre vs los demás
    rows_a_mover = []
    rows_no_tocar = []
    for r in rows_all:
        cat_actual = r.get('id_categoria_actual', '').strip()
        if cat_actual and int(cat_actual) == args.id_madre:
            rows_a_mover.append(r)
        else:
            rows_no_tocar.append(r)

    print(f"  ↳ en madre id={args.id_madre} (a mover):  {len(rows_a_mover)}")
    print(f"  ↳ en otras categorías (NO se tocan): {len(rows_no_tocar)}")

    if not rows_a_mover:
        print("\nNo hay productos a mover. Saliendo.")
        sys.exit(0)

    # Mostrar las "otras categorías" para que el usuario las vea
    if rows_no_tocar:
        cats_no_tocar = Counter(int(r['id_categoria_actual']) for r in rows_no_tocar
                                if r.get('id_categoria_actual'))
        print(f"\nCategorías NO tocadas (siguen como están):")
        for cid, cnt in cats_no_tocar.most_common():
            print(f"  cat id={cid}: {cnt} productos")

    # Validar decisiones de los que sí se mueven
    sin_decision = [r for r in rows_a_mover if not r.get('decision_subcategoria', '').strip()]
    if sin_decision:
        print(f"\nERROR: {len(sin_decision)} productos a mover sin decision_subcategoria")
        for r in sin_decision[:10]:
            print(f"  id={r['id_producto']} sku={r['sku']}")
        sys.exit(1)

    conn = psycopg2.connect(**DB)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    cur.execute("SELECT id_categoria, nombre FROM categorias WHERE id_categoria=%s",
                (args.id_madre,))
    madre = cur.fetchone()
    if not madre:
        print(f"ERROR: la madre id={args.id_madre} no existe")
        sys.exit(1)
    print(f"\nCategoría madre: id={madre['id_categoria']} '{madre['nombre']}'")

    # Subcategorías necesarias (solo de los a mover)
    counter_sub = Counter(r['decision_subcategoria'].strip() for r in rows_a_mover)
    requeridas = sorted(counter_sub.keys())
    print(f"\nSubcategorías necesarias para los {len(rows_a_mover)} a mover ({len(requeridas)}):")
    for s in requeridas:
        print(f"  {s:<28} {counter_sub[s]:>4} productos")

    # Existentes vs a crear
    cur.execute("SELECT id_categoria, nombre FROM categorias WHERE id_categoria_padre=%s",
                (args.id_madre,))
    existentes = {r['nombre']: r['id_categoria'] for r in cur.fetchall()}

    a_crear = [s for s in requeridas if s not in existentes]
    ya_existen = [s for s in requeridas if s in existentes]
    print(f"\nYa existentes como hijas de '{madre['nombre']}': {len(ya_existen)}")
    for s in ya_existen:
        print(f"  ✓ {s} (id={existentes[s]})")
    print(f"A CREAR: {len(a_crear)}")
    for s in a_crear:
        print(f"  + {s}")

    if not args.apply:
        print("\n[DRY-RUN] Nada se escribió.")
        print("Para aplicar: python3 02b_aplicar_subcategorias_madre.py --apply")
        return

    # ════════════ APPLY ════════════
    print("\n>>> APLICANDO <<<")
    log = {
        'timestamp': datetime.now().isoformat(),
        'csv_origen': csv_in,
        'id_madre': args.id_madre,
        'nombre_madre': madre['nombre'],
        'opcion': '2 — solo mueve productos en la madre',
        'productos_no_tocados': len(rows_no_tocar),
        'subcategorias_creadas': [],
        'productos_modificados': [],
    }

    try:
        # 1. Crear subcategorías hijas
        for nombre_sub in a_crear:
            cur.execute(
                "INSERT INTO categorias (nombre, id_categoria_padre, sort_key) "
                "VALUES (%s, %s, %s) RETURNING id_categoria",
                (nombre_sub, args.id_madre, nombre_sub)
            )
            new_id = cur.fetchone()['id_categoria']
            existentes[nombre_sub] = new_id
            log['subcategorias_creadas'].append({'id': new_id, 'nombre': nombre_sub})
            print(f"  + creada '{nombre_sub}' → id={new_id}")

        # 2. Mover productos
        movidos = 0
        for r in rows_a_mover:
            sub = r['decision_subcategoria'].strip()
            id_producto = int(r['id_producto'])
            new_cat_id = existentes[sub]
            cur.execute("UPDATE productos SET id_categoria=%s WHERE id_producto=%s",
                        (new_cat_id, id_producto))
            if cur.rowcount == 1:
                log['productos_modificados'].append({
                    'id_producto': id_producto,
                    'sku': r['sku'],
                    'id_cat_old': args.id_madre,
                    'id_cat_new': new_cat_id,
                    'sub_destino': sub,
                })
                movidos += 1
        print(f"  ✓ {movidos} productos reasignados")

        conn.commit()

        log_file = f'{DIR}/log_aplicacion_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(log, f, indent=2, ensure_ascii=False)

        print(f"\n✓ COMMIT exitoso")
        print(f"✓ Log: {log_file}")
        print(f"\n>>> Refrescá lago.ar/?conjunto=corralon")
        print("    Vas a ver más cards que antes (productos huérfanos ahora separados)")
        print("    + las categorías existentes que ya estaban (ABERTURAS, MEMBRANA, etc.)")
        print("    El layout visual completo (slot de imagen, placeholder iniciales) viene")
        print("    en Bloque 3 (helper) y Bloque 4 (frontend).")

    except Exception as e:
        conn.rollback()
        print(f"\n✗ ERROR: {e}")
        print("ROLLBACK ejecutado, BD sin cambios.")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    main()
