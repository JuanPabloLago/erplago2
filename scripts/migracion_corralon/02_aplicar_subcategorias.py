#!/usr/bin/env python3
"""
02_aplicar_subcategorias.py — Aplica el CSV temático a la BD.

Crea las subcategorías nuevas como hijas de la categoría madre actual del conjunto,
y reasigna los productos cambiando su id_categoria al hijo correspondiente.

Por defecto es DRY-RUN (no toca BD). Para aplicar de verdad: --apply

Todo en una transacción única. Si algo falla, ROLLBACK automático.
Genera log JSON con estado anterior para rollback manual posterior.

Uso:
  python3 02_aplicar_subcategorias.py                        # dry-run del último CSV _temas_*.csv
  python3 02_aplicar_subcategorias.py --csv /path/csv        # CSV específico
  python3 02_aplicar_subcategorias.py --apply                # APLICA cambios
  python3 02_aplicar_subcategorias.py --apply --rename CORRALÓN   # también renombra la madre
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
    print("ERROR: falta psycopg2. Instalalo con: pip install psycopg2-binary --break-system-packages")
    sys.exit(1)

DB = {
    'host': 'localhost',
    'user': 'juanpablo',
    'password': os.environ.get('PGPASSWORD', 'Huu3697debian@'),
    'database': 'erplago',
}

DIR = '/root/mi_erp/scripts/migracion_corralon'


def encontrar_csv():
    files = glob.glob(f'{DIR}/propuesta_corralon_*_temas_*.csv')
    return max(files, key=os.path.getmtime) if files else None


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--csv', help='CSV de entrada (default: último _temas_*.csv)')
    p.add_argument('--apply', action='store_true', help='Aplicar cambios. Sin esto es dry-run.')
    p.add_argument('--rename', help='Renombrar la categoría madre a este nombre')
    args = p.parse_args()

    csv_in = args.csv or encontrar_csv()
    if not csv_in or not os.path.exists(csv_in):
        print("ERROR: no encontré CSV temático. Corré primero 99_remapear_temas.py")
        sys.exit(1)

    print(f"CSV     : {csv_in}")
    print(f"Modo    : {'APPLY (escribe en BD)' if args.apply else 'DRY-RUN (solo imprime el plan)'}")
    if args.rename:
        print(f"Rename  : madre se renombrará a '{args.rename}'")
    print()

    # Leer CSV
    rows = []
    with open(csv_in, 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter=';'):
            rows.append(r)
    print(f"Productos en CSV: {len(rows)}")

    # Validar: todos los productos tienen decisión
    sin_decision = [r for r in rows if not r.get('decision_subcategoria', '').strip()]
    if sin_decision:
        print(f"\nERROR: {len(sin_decision)} productos sin decision_subcategoria:")
        for r in sin_decision[:10]:
            print(f"  id={r['id_producto']} sku={r['sku']} nombre='{r['nombre'][:50]}'")
        sys.exit(1)

    # Identificar la categoría madre (la más común en id_categoria_actual)
    cats_actuales = Counter(r['id_categoria_actual'] for r in rows if r['id_categoria_actual'])
    if not cats_actuales:
        print("ERROR: ningún producto tiene id_categoria_actual definido")
        sys.exit(1)

    id_madre = int(cats_actuales.most_common(1)[0][0])
    count_madre = cats_actuales.most_common(1)[0][1]

    if count_madre < len(rows):
        print(f"\nAVISO: {count_madre}/{len(rows)} productos comparten la madre id={id_madre}.")
        print("Productos en otras categorías (igual se moverán a las nuevas subcategorías):")
        for cid, cnt in cats_actuales.most_common():
            if int(cid) != id_madre:
                print(f"  cat id={cid}: {cnt} productos")

    conn = psycopg2.connect(**DB)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Verificar madre
    cur.execute(
        "SELECT id_categoria, nombre, id_categoria_padre FROM categorias WHERE id_categoria=%s",
        (id_madre,)
    )
    madre = cur.fetchone()
    if not madre:
        print(f"ERROR: la categoría madre id={id_madre} no existe en BD")
        sys.exit(1)
    print(f"\nCategoría madre actual: id={madre['id_categoria']} nombre='{madre['nombre']}'")

    # Listar subcategorías requeridas + conteo
    counter_sub = Counter(r['decision_subcategoria'].strip() for r in rows)
    requeridas = sorted(counter_sub.keys())
    print(f"\nSubcategorías requeridas ({len(requeridas)}):")
    for s in requeridas:
        print(f"  {s:<28} {counter_sub[s]:>4} productos")

    # Cuáles ya existen como hijas de la madre
    cur.execute(
        "SELECT id_categoria, nombre FROM categorias WHERE id_categoria_padre=%s",
        (id_madre,)
    )
    existentes = {r['nombre']: r['id_categoria'] for r in cur.fetchall()}

    a_crear = [s for s in requeridas if s not in existentes]
    ya_existen = [s for s in requeridas if s in existentes]

    print(f"\nSubcategorías ya existentes en BD: {len(ya_existen)}")
    for s in ya_existen:
        print(f"  ✓ {s} (id={existentes[s]})")
    print(f"Subcategorías a CREAR: {len(a_crear)}")
    for s in a_crear:
        print(f"  + {s}")

    # Productos a reasignar (los que cambian de categoría)
    a_mover = 0
    sin_cambio = 0
    for r in rows:
        sub = r['decision_subcategoria'].strip()
        cat_old = int(r['id_categoria_actual']) if r['id_categoria_actual'] else None
        # Resolver el id destino (puede ser uno existente o uno a crear)
        if cat_old is not None and sub in existentes and cat_old == existentes[sub]:
            sin_cambio += 1
        else:
            a_mover += 1

    print(f"\nProductos a reasignar (cambio de categoría): {a_mover}")
    print(f"Productos sin cambio (ya en su destino):     {sin_cambio}")

    if not args.apply:
        print("\n[DRY-RUN] Nada se aplicó.")
        print("Para ejecutar: python3 02_aplicar_subcategorias.py --apply")
        if not args.rename:
            print("Para renombrar madre también: agregá --rename 'CORRALÓN'")
        return

    # ════════════ APPLY ════════════
    print("\n>>> APLICANDO CAMBIOS A BD <<<")
    log = {
        'timestamp': datetime.now().isoformat(),
        'csv_origen': csv_in,
        'id_madre': id_madre,
        'nombre_madre_anterior': madre['nombre'],
        'rename_madre': args.rename,
        'subcategorias_creadas': [],
        'productos_modificados': [],
    }

    try:
        # 1. Crear subcategorías nuevas
        for nombre_sub in a_crear:
            cur.execute(
                "INSERT INTO categorias (nombre, id_categoria_padre, sort_key) "
                "VALUES (%s, %s, %s) RETURNING id_categoria",
                (nombre_sub, id_madre, nombre_sub)
            )
            new_id = cur.fetchone()['id_categoria']
            existentes[nombre_sub] = new_id
            log['subcategorias_creadas'].append({'id': new_id, 'nombre': nombre_sub})
            print(f"  + creada subcategoría '{nombre_sub}' → id={new_id}")

        # 2. Reasignar productos
        movidos = 0
        for r in rows:
            sub = r['decision_subcategoria'].strip()
            id_producto = int(r['id_producto'])
            cat_old = int(r['id_categoria_actual']) if r['id_categoria_actual'] else None
            new_cat_id = existentes[sub]

            if cat_old == new_cat_id:
                continue  # ya está donde debe

            cur.execute(
                "UPDATE productos SET id_categoria=%s WHERE id_producto=%s",
                (new_cat_id, id_producto)
            )
            if cur.rowcount == 1:
                log['productos_modificados'].append({
                    'id_producto': id_producto,
                    'sku': r['sku'],
                    'id_cat_old': cat_old,
                    'id_cat_new': new_cat_id,
                    'sub_destino': sub,
                })
                movidos += 1

        print(f"  ✓ {movidos} productos reasignados")

        # 3. Renombrar madre (opcional)
        if args.rename:
            cur.execute(
                "UPDATE categorias SET nombre=%s WHERE id_categoria=%s",
                (args.rename, id_madre)
            )
            print(f"  ✓ madre renombrada: '{madre['nombre']}' → '{args.rename}'")

        # COMMIT
        conn.commit()

        # Log JSON
        log_file = f'{DIR}/log_aplicacion_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(log, f, indent=2, ensure_ascii=False)

        print(f"\n✓ COMMIT exitoso")
        print(f"✓ Log de cambios: {log_file}")
        print(f"\nPróximo: refrescá lago.ar/?conjunto=corralon")
        print("Vas a ver el catálogo dividido en 14 grupos en lugar del bloque único.")
        print("La imagen lateral del card todavía no se va a aplicar — eso requiere Bloque 3 (helper) y Bloque 4 (frontend).")

    except Exception as e:
        conn.rollback()
        print(f"\n✗ ERROR durante apply: {e}")
        print("ROLLBACK ejecutado. BD sin cambios.")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    main()
