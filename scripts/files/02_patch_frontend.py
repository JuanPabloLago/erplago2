#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
PARCHE: venta-rapida.js (frontend) — BUG VR-1b, VR-3, VR-5, VR-6
═══════════════════════════════════════════════════════════════════
VR-1b: sincronizarPagosABD puede disparar con borradorId=null dentro del setTimeout
VR-3:  cargarBorradorActivo hace GET /borrador/:id que no existe → 404 siempre
VR-5:  calcularTotal() y mostrarItemsVenta() hardcodean IVA 21%
VR-6:  cambiarPrecio() divide por 1.21 hardcodeado
"""
import sys, shutil, os
from datetime import datetime

ARCHIVO = '/root/mi_erp/frontend/js/venta-rapida.js'

PARCHES = [
    # ───────────────────────────────────────────────────────────────
    # VR-1b: Doble-check borradorId dentro del setTimeout
    # El borradorId puede hacerse null entre el check externo y la
    # ejecución del callback (race condition por async)
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-1b — Doble-check borradorId en sincronizarPagosABD',
        'buscar': """_syncPagosTimer = setTimeout(async () => {
        try {
            await fetch(API_URL + '/borrador/' + borradorId + '/pagos',""",
        'reemplazar': """_syncPagosTimer = setTimeout(async () => {
        if (!borradorId) return;
        try {
            await fetch(API_URL + '/borrador/' + borradorId + '/pagos',""",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-3: El GET /borrador/:id no existe como ruta → siempre 404
    # Fix: Eliminar el pre-check que rompe el flujo
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-3 — Eliminar pre-check con ruta inexistente',
        'buscar': """if (borradorId) {
        try {
            var checkResp = await fetch(API_URL + '/borrador/' + borradorId, { headers: authHeaders() });
            if (checkResp.status === 404) { borradorId = null; itemsVentaArray = []; mostrarItemsVenta(); calcularTotal(); }
        } catch(e) { borradorId = null; }
    }""",
        'reemplazar': """// VR-3 FIX: Pre-check eliminado (GET /borrador/:id no existe como ruta)
    // La validación real la hace GET /borrador (obtenerBorradorActivo)""",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-5a + VR-5b: Mapear iva_porcentaje desde la BD
    # Agrega iva_porcentaje al mapeo de items en sincronizarDesdeRespuesta
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-5a — Mapear iva_porcentaje en sincronizarDesdeRespuesta',
        'buscar': """descuento_monto: 0,
        stock_actual: parseFloat(item.stock_actual) || 0
    }));""",
        'reemplazar': """descuento_monto: 0,
        stock_actual: parseFloat(item.stock_actual) || 0,
        iva_porcentaje: parseFloat(item.iva_aplicado) || 21
    }));""",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-5b: Mapear iva_porcentaje en cargarBorradorActivo
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-5b — Mapear iva_porcentaje en cargarBorradorActivo',
        'buscar': """descuento_monto: 0,
                stock_actual: parseFloat(item.stock_actual) || 0
            }));""",
        'reemplazar': """descuento_monto: 0,
                stock_actual: parseFloat(item.stock_actual) || 0,
                iva_porcentaje: parseFloat(item.iva_aplicado) || 21
            }));""",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-5c: calcularTotal() usa IVA per-item en lugar de flat 21%
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-5c — IVA per-item en calcularTotal',
        'buscar': "const iva = subtotal_post_dto * 0.21; const total_sin_recargo = Math.round(subtotal_post_dto + iva);",
        'reemplazar': "var _ivaTotal = 0; if (subtotal_con_dto_items > 0) { itemsVentaArray.forEach(function(it) { var sb = it.cantidad * it.precio_unitario; var d = 0; if (it.descuento_porcentaje > 0) d = sb * (it.descuento_porcentaje / 100); else if (it.descuento_monto > 0) d = it.descuento_monto * it.cantidad; _ivaTotal += (sb - d) * ((it.iva_porcentaje || 21) / 100); }); _ivaTotal = _ivaTotal * (subtotal_post_dto / subtotal_con_dto_items); } const iva = _ivaTotal; const total_sin_recargo = Math.round(subtotal_post_dto + iva);",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-5d: mostrarItemsVenta() usa IVA per-item para display
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-5d — IVA per-item en mostrarItemsVenta',
        'buscar': "const precioMostrar = esRI ? item.precio_unitario : Math.round(item.precio_unitario * 1.21);",
        'reemplazar': "var _ivaFactor = 1 + (item.iva_porcentaje || 21) / 100; const precioMostrar = esRI ? item.precio_unitario : Math.round(item.precio_unitario * _ivaFactor);",
    },

    {
        'nombre': 'VR-5e — IVA per-item en subtotal mostrarItemsVenta',
        'buscar': "const subtotalMostrar = esRI ? subtotal_neto : Math.round(subtotal_neto * 1.21);",
        'reemplazar': "const subtotalMostrar = esRI ? subtotal_neto : Math.round(subtotal_neto * _ivaFactor);",
    },

    # ───────────────────────────────────────────────────────────────
    # VR-6: cambiarPrecio divide por 1.21 hardcodeado
    # Fix: Usar IVA del item
    # ───────────────────────────────────────────────────────────────
    {
        'nombre': 'VR-6 — IVA per-item en cambiarPrecio',
        'buscar': "var precioNeto = esRI ? nuevoPrecio : nuevoPrecio / 1.21;",
        'reemplazar': "var _ivaPctItem = (itemsVentaArray[index]?.iva_porcentaje || 21); var precioNeto = esRI ? nuevoPrecio : nuevoPrecio / (1 + _ivaPctItem / 100);",
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
                print(f'⚠️  {p["nombre"]}: {ocurrencias} ocurrencias, esperaba 1. SALTANDO.')
                continue
            contenido = contenido.replace(p['buscar'], p['reemplazar'], 1)
            aplicados += 1
            print(f'✅ {p["nombre"]}')
        else:
            print(f'⚠️  {p["nombre"]}: texto no encontrado (¿ya aplicado?)')

    if contenido != original:
        with open(ARCHIVO, 'w') as f:
            f.write(contenido)
        print(f'\n═══ {aplicados}/{len(PARCHES)} parches aplicados a venta-rapida.js ═══')
    else:
        print('\n═══ Sin cambios ═══')

if __name__ == '__main__':
    main()
