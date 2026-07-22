#!/usr/bin/env python3
"""
Re-mapea el CSV de propuesta de subcategorías hacia el agrupamiento TEMÁTICO (opción B).

Toma el último CSV propuesta_corralon_*.csv del directorio, reemplaza la columna
'decision_subcategoria' usando el mapeo temático, y escribe un nuevo CSV.

NO toca BD. Solo procesa el CSV.

Uso:
  python3 99_remapear_temas.py
  python3 99_remapear_temas.py --csv-input /ruta/csv-especifico.csv
"""
import argparse
import csv
import glob
import os
import sys
from datetime import datetime

# ════════════════════════════════════════════════════════════════════
# MAPEO TEMÁTICO — opción B
# Editá este dict si querés cambiar las agrupaciones.
# Clave: la subcategoría sugerida automática (palabra raíz pluralizada)
# Valor: la subcategoría temática final (la que va al CSV decision_subcategoria)
# ════════════════════════════════════════════════════════════════════

MAPEO_TEMATICO = {
    # ÁRIDOS
    'ARENAS':                'ÁRIDOS',
    'PIEDRAS':               'ÁRIDOS',
    'CASCOTES':              'ÁRIDOS',
    'GRANZA-CASCOTES':       'ÁRIDOS',

    # AGLOMERANTES
    'CEMENTOS':              'AGLOMERANTES',
    'CALES':                 'AGLOMERANTES',
    'MEZCLAS':               'AGLOMERANTES',
    'YESOS':                 'AGLOMERANTES',

    # HIERROS Y MALLAS
    'HIERROS':               'HIERROS Y MALLAS',
    'MALLAS':                'HIERROS Y MALLAS',
    'ALAMBRES':              'HIERROS Y MALLAS',
    'COLUMNAS':              'HIERROS Y MALLAS',

    # VIGUETAS — sola por volumen (26 productos)
    'VIGUETAS':              'VIGUETAS',

    # LADRILLOS Y BLOQUES
    'LADRILLOS':             'LADRILLOS Y BLOQUES',
    'HUECOS':                'LADRILLOS Y BLOQUES',

    # IMPERMEABILIZACIÓN — fusiona MEMBES, HIDROFES, CERECITAS, RUBEROIDES
    'MEMBRANAS':             'IMPERMEABILIZACIÓN',
    'MEMBES':                'IMPERMEABILIZACIÓN',
    'HIDROFUGOS':            'IMPERMEABILIZACIÓN',
    'HIDROFES':              'IMPERMEABILIZACIÓN',
    'CERECITAS':             'IMPERMEABILIZACIÓN',
    'RUBEROIDES':            'IMPERMEABILIZACIÓN',
    'AISLANTES':             'IMPERMEABILIZACIÓN',

    # SANITARIOS
    'LAVATORIOS':            'SANITARIOS',
    'BIDETES':               'SANITARIOS',
    'INODOROS':              'SANITARIOS',
    'DEPOSITOS':             'SANITARIOS',

    # CAÑOS
    'CANOS':                 'CAÑOS Y CONEXIONES',

    # TERMOTANQUES — propio rubro
    'TERMOTANQUES':          'TERMOTANQUES',

    # ABERTURAS
    'PUERTAS':               'PUERTAS Y ABERTURAS',
    'VENTILUZ-AIREADORESES': 'PUERTAS Y ABERTURAS',

    # PINTURAS Y ADITIVOS
    'PINTURAS':              'PINTURAS Y ADITIVOS',
    'ADITIVOS':              'PINTURAS Y ADITIVOS',
    'ACELERANTES':           'PINTURAS Y ADITIVOS',
    'PASTINAS':              'PINTURAS Y ADITIVOS',
    'PLASTICORES':           'PINTURAS Y ADITIVOS',

    # HERRAMIENTAS
    'CARRETILLAS':           'HERRAMIENTAS',
    'HORMIGONERAS':          'HERRAMIENTAS',

    # FERRETERÍA — fijaciones
    'CLAVOS':                'FERRETERÍA',

    # EMBALAJE
    'PALLETSES':             'EMBALAJE',
}


def encontrar_ultimo_csv():
    """Devuelve el path del CSV propuesta_corralon más reciente."""
    pattern = '/root/mi_erp/scripts/migracion_corralon/propuesta_corralon_*.csv'
    files = glob.glob(pattern)
    # Excluir archivos ya re-mapeados
    files = [f for f in files if '_temas_' not in f]
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--csv-input', help='CSV de entrada (default: el último propuesta_corralon_*.csv)')
    args = p.parse_args()

    csv_in = args.csv_input or encontrar_ultimo_csv()
    if not csv_in or not os.path.exists(csv_in):
        print(f"ERROR: no encontré CSV de entrada. Usá --csv-input /ruta/csv")
        sys.exit(1)

    print(f"CSV entrada: {csv_in}")

    rows = []
    sin_mapeo = []
    nuevos_grupos = {}
    with open(csv_in, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        fieldnames = reader.fieldnames
        for r in reader:
            sugerencia = r.get('subcategoria_sugerida', '').strip()
            if sugerencia in MAPEO_TEMATICO:
                r['decision_subcategoria'] = MAPEO_TEMATICO[sugerencia]
            elif sugerencia:
                # Sugerencia que no tiene mapeo: dejo la original y aviso
                sin_mapeo.append((r['id_producto'], r['nombre'], sugerencia))
            # Acumular
            destino = r['decision_subcategoria']
            nuevos_grupos[destino] = nuevos_grupos.get(destino, 0) + 1
            rows.append(r)

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    csv_out = csv_in.replace('.csv', f'_temas_{ts}.csv')
    if '_temas_' not in csv_out:
        csv_out = csv_in.rsplit('.', 1)[0] + f'_temas_{ts}.csv'

    with open(csv_out, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, delimiter=';')
        w.writeheader()
        w.writerows(rows)

    print(f"\nCSV generado: {csv_out}\n")
    print("Distribución después del re-mapeo:")
    for grupo, count in sorted(nuevos_grupos.items(), key=lambda x: -x[1]):
        nombre = grupo if grupo else '(sin asignar)'
        print(f"  {nombre:<25} {count:>4} productos")

    if sin_mapeo:
        print(f"\nProductos sin mapeo automático ({len(sin_mapeo)}):")
        for id_p, nombre, sug in sin_mapeo[:20]:
            print(f"  id={id_p} sug='{sug}' nombre='{nombre[:60]}'")
        if len(sin_mapeo) > 20:
            print(f"  ... y {len(sin_mapeo) - 20} más")
        print("\nPodés editar a mano la columna decision_subcategoria del CSV final.")

    print(f"\nPróximo: avisame y aplicamos el CSV con Bloque 2 (crear subcategorías + reasignar productos)")


if __name__ == '__main__':
    main()
