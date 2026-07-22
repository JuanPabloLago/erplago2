#!/usr/bin/env python3
"""
FIX: Despachos — Re-envío de remitos "no_entregado"
ERP LAGO — 2026-03-14

BUG 1: Guard query en agregarAlViaje usa estados inexistentes ('cancelado','completado')
       y no excluye 'no_entregado'. Resultado: 400 Bad Request al intentar re-despachar.

BUG 2: registrarRegreso no decrementa cantidad_remitida cuando items son devueltos.
       Resultado: doble conteo si se re-despacha el mismo pedido.
"""

import os
import shutil
from datetime import datetime

CONTROLLER_PATH = '/root/mi_erp/src/controllers/despachos.controller.js'
BACKUP_DIR = '/root/mi_erp/backups'

def backup():
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = os.path.join(BACKUP_DIR, f'pre_fix_despachos_reenvio_{ts}')
    os.makedirs(backup_path, exist_ok=True)
    shutil.copy2(CONTROLLER_PATH, backup_path)
    print(f'[OK] Backup en {backup_path}')
    return backup_path

def fix1_guard_query(content):
    """Fix guard query en agregarAlViaje — estados incorrectos"""
    
    OLD = """AND r.estado NOT IN ('anulado', 'entregado')
                AND v.id_viaje != $3 AND v.estado NOT IN ('cancelado', 'completado')"""
    
    NEW = """AND r.estado NOT IN ('anulado', 'entregado', 'no_entregado')
                AND v.id_viaje != $3 AND v.estado NOT IN ('finalizado', 'liquidado')"""
    
    if OLD not in content:
        print('[WARN] FIX1: Texto original no encontrado — ya aplicado o código cambió')
        return content, False
    
    count = content.count(OLD)
    if count > 1:
        print(f'[ERROR] FIX1: Texto encontrado {count} veces — abortando para seguridad')
        return content, False
    
    content = content.replace(OLD, NEW)
    print('[OK] FIX1: Guard query corregida — agregado no_entregado + estados correctos')
    return content, True

def fix2_decrement_remitida(content):
    """Fix registrarRegreso — decrementar cantidad_remitida por devoluciones"""
    
    # Buscar el punto exacto: después del bloque confirmarEntregaDeposito en registrarRegreso
    ANCHOR = """if (cantidadEntregada > 0) {
                        await stockHelper.confirmarEntregaDeposito(client, {
                            id_empresa, id_deposito,
                            id_producto: itemRemito.id_producto,
                            cantidad: cantidadEntregada,
                            id_remito: remito.id_remito,
                            id_usuario,
                        });
                    }"""
    
    ADDITION = """

                    // Decrementar cantidad_remitida por items devueltos (fix re-despacho)
                    if (cantidadDevuelta > 0 && itemRemito.id_pedido_item) {
                        await pedidosHelper.actualizarCantidadRemitida(client, {
                            id_item: itemRemito.id_pedido_item,
                            id_empresa,
                            cantidad_remitida: -cantidadDevuelta,
                            delta: true
                        });
                    }"""
    
    if ANCHOR not in content:
        print('[WARN] FIX2: Anchor text no encontrado — verificar manualmente')
        return content, False
    
    # Verificar que no esté ya aplicado
    if 'Decrementar cantidad_remitida por items devueltos' in content:
        print('[WARN] FIX2: Ya aplicado anteriormente')
        return content, False
    
    content = content.replace(ANCHOR, ANCHOR + ADDITION)
    print('[OK] FIX2: Decremento de cantidad_remitida agregado en registrarRegreso')
    return content, True

def main():
    print('=' * 60)
    print('FIX: Despachos — Re-envío remitos no_entregado')
    print('=' * 60)
    
    if not os.path.exists(CONTROLLER_PATH):
        print(f'[ERROR] No existe {CONTROLLER_PATH}')
        return
    
    # Backup
    backup()
    
    # Leer
    with open(CONTROLLER_PATH, 'r') as f:
        content = f.read()
    
    original = content
    applied = []
    
    # Aplicar fixes
    content, ok1 = fix1_guard_query(content)
    if ok1: applied.append('FIX1')
    
    content, ok2 = fix2_decrement_remitida(content)
    if ok2: applied.append('FIX2')
    
    if not applied:
        print('\n[INFO] No se aplicaron cambios')
        return
    
    # Escribir
    with open(CONTROLLER_PATH, 'w') as f:
        f.write(content)
    
    print(f'\n[OK] Aplicados: {", ".join(applied)}')
    print('\nSiguientes pasos:')
    print('  source ~/.nvm/nvm.sh')
    print('  node --check /root/mi_erp/src/controllers/despachos.controller.js')
    print('  pm2 restart erplago')
    print('  # Probar: arrastrar pedido 646 a un viaje nuevo')

if __name__ == '__main__':
    main()
