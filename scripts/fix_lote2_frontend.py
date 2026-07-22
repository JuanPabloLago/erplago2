#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════
ERP LAGO — LOTE 2: Fixes frontend venta-rapida-script.js
═══════════════════════════════════════════════════════════════
Fixes:
  B1a — vistaPrevia: IVA hardcodeado *1.21 → usa iva_porcentaje del item
  B1b — renderizarProductosMasVendidos: *1.21 → usa alícuota real
  B1c — calcularTotal label: "21%" fijo → dinámico "IVA Incluido/Discriminado"
  B2  — agregarProductoDirecto: enviar id_lista_precio al backend

Uso:
  python3 fix_lote2_frontend.py --dry-run    # Ver cambios sin aplicar
  python3 fix_lote2_frontend.py              # Aplicar cambios
═══════════════════════════════════════════════════════════════
"""
import sys, os, shutil, datetime

DRY_RUN = '--dry-run' in sys.argv
TARGET = '/root/mi_erp/frontend/js/venta-rapida-script.js'
BACKUP_DIR = '/root/mi_erp/backups/pre_fix_venta_rapida_lote2_{}'.format(
    datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
)

def main():
    if not os.path.exists(TARGET):
        print(f'ERROR: {TARGET} no existe')
        sys.exit(1)

    with open(TARGET, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    fixes_applied = []

    # ═══════════════════════════════════════════════════════════
    # B1a — vistaPrevia: *1.21 → usa iva_porcentaje del item
    # ═══════════════════════════════════════════════════════════
    old_b1a = "var precioConIva = Math.round(item.precio_unitario * 1.21);"
    new_b1a = "var precioConIva = Math.round(item.precio_unitario * (1 + (item.iva_porcentaje || 21) / 100));"

    if old_b1a in content:
        content = content.replace(old_b1a, new_b1a, 1)
        fixes_applied.append('B1a: vistaPrevia usa iva_porcentaje per-item')
    else:
        print('WARN: B1a — patrón vistaPrevia no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B1b — renderizarProductosMasVendidos: *1.21 → usa alícuota
    # Contexto: title="...$ (parseFloat(p.precio || 0) * 1.21).toFixed(2)"
    # ═══════════════════════════════════════════════════════════
    old_b1b = "(parseFloat(p.precio || 0) * 1.21).toFixed(2)"
    new_b1b = "(parseFloat(p.precio || 0) * (1 + (parseFloat(p.iva_porcentaje || p.alicuota_iva) || 21) / 100)).toFixed(2)"

    if old_b1b in content:
        content = content.replace(old_b1b, new_b1b, 1)
        fixes_applied.append('B1b: botones más vendidos usan alícuota real')
    else:
        print('WARN: B1b — patrón masVendidos no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B1c — calcularTotal label: "21%" fijo → "IVA" sin porcentaje
    # (El cálculo interno YA respeta iva_porcentaje por item,
    #  solo el label muestra "21%" fijo — engañoso si hay mix)
    # ═══════════════════════════════════════════════════════════
    old_b1c = "if (labelIVA) labelIVA.textContent = esRI ? 'IVA (21%) Discriminado:' : 'IVA (21%) Incluido:';"
    new_b1c = "if (labelIVA) labelIVA.textContent = esRI ? 'IVA Discriminado:' : 'IVA Incluido:';"

    if old_b1c in content:
        content = content.replace(old_b1c, new_b1c, 1)
        fixes_applied.append('B1c: Label IVA sin porcentaje fijo (multi-alícuota)')
    else:
        print('WARN: B1c — patrón label IVA no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # B2 — agregarProductoDirecto: enviar id_lista_precio al backend
    # ═══════════════════════════════════════════════════════════
    old_b2 = "body: JSON.stringify({ id_producto: producto.id_producto, cantidad: 1, precio_unitario: precio })"
    new_b2 = "body: JSON.stringify({ id_producto: producto.id_producto, cantidad: 1, precio_unitario: precio, id_lista_precio: listaSeleccionada })"

    if old_b2 in content:
        content = content.replace(old_b2, new_b2, 1)
        fixes_applied.append('B2: agregarProductoDirecto envía id_lista_precio')
    else:
        print('WARN: B2 — patrón agregarProductoDirecto no encontrado (ya aplicado?)')

    # ═══════════════════════════════════════════════════════════
    # RESULTADO
    # ═══════════════════════════════════════════════════════════
    if not fixes_applied:
        print('\n⚠️  Ningún fix aplicado.')
        sys.exit(1)

    print(f'\n{"═" * 60}')
    print(f'LOTE 2 — FRONTEND: {len(fixes_applied)} fixes')
    print(f'{"═" * 60}')
    for f in fixes_applied:
        print(f'  ✅ {f}')

    if DRY_RUN:
        print(f'\n🔍 DRY RUN — No se escribió nada.')
        print(f'   Ejecutar sin --dry-run para aplicar.')
    else:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        shutil.copy2(TARGET, os.path.join(BACKUP_DIR, 'venta-rapida-script.js'))
        print(f'\n📦 Backup en: {BACKUP_DIR}/')

        with open(TARGET, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'✅ Archivo escrito: {TARGET}')
        print(f'\n⚡ No requiere restart de PM2 (es JS del browser). Refrescar con Ctrl+F5.')

if __name__ == '__main__':
    main()
