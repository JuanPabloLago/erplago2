#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
ERP LAGO — LOTE 0: Seed de configuraciones nuevas
═══════════════════════════════════════════════════════════════
Agrega claves de configuración necesarias para los fixes.
Solo INSERT ON CONFLICT DO NOTHING (no pisa valores existentes).

Uso:
  python3 fix_lote0_configs.py --dry-run
  python3 fix_lote0_configs.py
═══════════════════════════════════════════════════════════════
"""
import sys, subprocess

DRY_RUN = '--dry-run' in sys.argv

SQL = """
-- B2: Lista de precios default para venta rápida
INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
VALUES (1, 'venta_rapida.lista_precio_default', '1', 'Lista de precios por defecto en venta rápida (id_lista_precio)')
ON CONFLICT (id_empresa, clave) DO NOTHING;

-- B3: Límite de crédito CC por defecto (futuro)
INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
VALUES (1, 'cc.limite_credito_default', '0', 'Límite de crédito CC por defecto. 0 = sin límite')
ON CONFLICT (id_empresa, clave) DO NOTHING;

-- W3: Intervalo heartbeat configurable
INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
VALUES (1, 'sistema.heartbeat_intervalo_ms', '60000', 'Intervalo del heartbeat de conexión en milisegundos')
ON CONFLICT (id_empresa, clave) DO NOTHING;

-- W1: TTL de cache de configs
INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
VALUES (1, 'sistema.cache_ttl_config_ms', '300000', 'TTL del cache de configuraciones en milisegundos (5 min default)')
ON CONFLICT (id_empresa, clave) DO NOTHING;

SELECT clave, valor, descripcion FROM configuraciones_empresa
WHERE id_empresa = 1 AND clave LIKE 'venta_rapida.%'
   OR (id_empresa = 1 AND clave LIKE 'cc.%')
   OR (id_empresa = 1 AND clave LIKE 'sistema.%')
ORDER BY clave;
"""

def main():
    print('═' * 60)
    print('LOTE 0 — SEED CONFIGURACIONES')
    print('═' * 60)

    if DRY_RUN:
        print('\n🔍 DRY RUN — SQL a ejecutar:\n')
        print(SQL)
        print('\nEjecutar sin --dry-run para aplicar.')
    else:
        cmd = [
            'psql', '-h', 'localhost', '-U', 'juanpablo', '-d', 'erplago',
            '-c', SQL
        ]
        env = dict(__import__('os').environ, PGPASSWORD='Huu3697debian@')
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        print(result.stdout)
        if result.returncode != 0:
            print('ERROR:', result.stderr)
            sys.exit(1)
        print('✅ Configuraciones insertadas')

if __name__ == '__main__':
    main()
