#!/usr/bin/env python3
"""
════════════════════════════════════════════════════════════════════════════════
PATCHER CC v3 - ERP LAGO
Aplica cambios quirúrgicos en 5 controllers para usar registrarVentaConPago()
════════════════════════════════════════════════════════════════════════════════
"""
import sys
import os

ERP_DIR = "/root/mi_erp"

def patch_file(filepath, patches):
    """Aplica una lista de patches {old, new} a un archivo."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    for i, patch in enumerate(patches):
        old = patch['old']
        new = patch['new']
        desc = patch.get('desc', f'patch #{i+1}')

        if old not in content:
            print(f"  ⚠️  {desc}: NO ENCONTRADO, verificar manualmente")
            print(f"      Buscando: {old[:80]}...")
            continue

        count = content.count(old)
        if count > 1:
            print(f"  ⚠️  {desc}: ENCONTRADO {count} VECES, aplicando solo la primera")

        content = content.replace(old, new, 1)
        print(f"  ✅ {desc}")

    if content != original:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False


def patch_borrador():
    """PATCH 1: borrador.controller.js - confirmarBorrador()"""
    filepath = f"{ERP_DIR}/src/controllers/borrador.controller.js"
    print(f"\n[1/5] Patcheando {filepath}")

    patches = [{
        'desc': 'CC: Reemplazar lógica método 6 por registrarVentaConPago',
        'old': """                // CUENTA CORRIENTE (6) -> Registrar deuda del cliente
                else if (metodo === 6) {
                    await ccClientesHelper.registrarMovimiento(client, {
                        id_empresa, id_cliente: clienteFinal, monto: montoPago, tipo: 'debe',
                        concepto: 'Venta Pedido #' + id_pedido, id_pago
                    });
                }""",
        'new': """                // CUENTA CORRIENTE: DEBE + HABER automático según método de pago
                await ccClientesHelper.registrarVentaConPago(client, {
                    id_empresa, id_cliente: clienteFinal, id_pedido, id_pago,
                    monto: montoPago, id_metodo_pago: metodo
                });"""
    }]

    return patch_file(filepath, patches)


def patch_pedidos():
    """PATCH 2-3: pedidos.controller.js - crearRetiroInmediato() y guardarParaEntregar()"""
    filepath = f"{ERP_DIR}/src/controllers/pedidos.controller.js"
    print(f"\n[2/5] Patcheando {filepath} (crearRetiroInmediato)")

    patches = [
        {
            'desc': 'crearRetiroInmediato: CC DEBE+HABER',
            'old': """                // CUENTA CORRIENTE (6) → Registrar deuda del cliente
                if (metodo === 6) {
                    await ccClientesHelper.registrarMovimiento(client, {
                        id_empresa, id_cliente, monto: montoPago, tipo: 'debe',
                        concepto: 'Venta Pedido #' + id_pedido, id_pago
                    });
                }
                // EFECTIVO, TRANSFER, TARJETAS, MP (1-5) → Registrar en movimientos_caja via helper
                else if (id_turno && metodo >= 1 && metodo <= 5) {""",
            'new': """                // CUENTA CORRIENTE: DEBE + HABER automático según método de pago
                await ccClientesHelper.registrarVentaConPago(client, {
                    id_empresa, id_cliente, id_pedido, id_pago,
                    monto: montoPago, id_metodo_pago: metodo
                });
                // EFECTIVO, TRANSFER, TARJETAS, MP (1-5) → Registrar en movimientos_caja via helper
                if (id_turno && metodo >= 1 && metodo <= 5) {"""
        }
    ]

    r1 = patch_file(filepath, patches)

    print(f"\n[3/5] Patcheando {filepath} (guardarParaEntregar)")

    patches2 = [
        {
            'desc': 'guardarParaEntregar: CC DEBE+HABER',
            'old': """                // CUENTA CORRIENTE (6) → Registrar deuda del cliente via helper
                if (metodo === 6) {
                    await ccClientesHelper.registrarMovimiento(client, {
                        id_empresa, id_cliente, monto: montoPago, tipo: 'debe',
                        concepto: 'Pedido #' + id_pedido + ' - A entregar', id_pago
                    });
                }
                // EFECTIVO, TRANSFER, TARJETAS, MP (1-5) → Registrar en movimientos_caja via helper
                else if (id_turno && metodo >= 1 && metodo <= 5) {""",
            'new': """                // CUENTA CORRIENTE: DEBE + HABER automático según método de pago
                await ccClientesHelper.registrarVentaConPago(client, {
                    id_empresa, id_cliente, id_pedido, id_pago,
                    monto: montoPago, id_metodo_pago: metodo,
                    concepto_prefijo: 'Pedido - A entregar'
                });
                // EFECTIVO, TRANSFER, TARJETAS, MP (1-5) → Registrar en movimientos_caja via helper
                if (id_turno && metodo >= 1 && metodo <= 5) {"""
        }
    ]

    r2 = patch_file(filepath, patches2)
    return r1 or r2


def patch_pagos_v1():
    """PATCH 4: pagos-confirmacion.controller.js"""
    filepath = f"{ERP_DIR}/src/controllers/pagos-confirmacion.controller.js"
    print(f"\n[4/5] Patcheando {filepath}")

    patches = [{
        'desc': 'pagos-confirmacion v1: CC DEBE+HABER',
        'old': """        // 3. CUENTA CORRIENTE (6) → Registrar deuda del cliente
        if (id_metodo_pago === 6) {
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa, id_cliente, monto: montoPago, tipo: 'debe',
                concepto: 'Confirmación Pago Pedido #' + id_pedido, id_pago
            });
        }""",
        'new': """        // 3. CUENTA CORRIENTE: DEBE + HABER automático según método de pago
        await ccClientesHelper.registrarVentaConPago(client, {
            id_empresa, id_cliente, id_pedido, id_pago,
            monto: montoPago, id_metodo_pago: id_metodo_pago,
            concepto_prefijo: 'Confirmación Pago Pedido'
        });"""
    }]

    return patch_file(filepath, patches)


def patch_pagos_v2():
    """PATCH 5: pagos-confirmacion.controller.v2.js"""
    filepath = f"{ERP_DIR}/src/controllers/pagos-confirmacion.controller.v2.js"
    print(f"\n[5/5] Patcheando {filepath}")

    patches = [{
        'desc': 'pagos-confirmacion v2: CC DEBE+HABER',
        'old': """        // 4. CUENTA CORRIENTE (6) → Registrar deuda del cliente
        if (idMetodoPago === 6) {
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa, id_cliente, monto: montoNumerico, tipo: 'debe',
                concepto: `Fiado Pedido #${id_pedido}`, id_pago
            });
        }""",
        'new': """        // 4. CUENTA CORRIENTE: DEBE + HABER automático según método de pago
        await ccClientesHelper.registrarVentaConPago(client, {
            id_empresa, id_cliente, id_pedido, id_pago,
            monto: montoNumerico, id_metodo_pago: idMetodoPago,
            concepto_prefijo: 'Cobro Pedido'
        });"""
    }]

    return patch_file(filepath, patches)


def main():
    print("════════════════════════════════════════════════")
    print(" ERP LAGO - Patcher CC v3")
    print(" Registrar DEBE+HABER en todos los controllers")
    print("════════════════════════════════════════════════")

    results = []
    results.append(('borrador', patch_borrador()))
    results.append(('pedidos', patch_pedidos()))
    results.append(('pagos-confirmacion v1', patch_pagos_v1()))
    results.append(('pagos-confirmacion v2', patch_pagos_v2()))

    print("\n════════════════════════════════════════════════")
    print(" RESULTADO:")
    for name, ok in results:
        status = "✅ PATCHEADO" if ok else "⚠️  SIN CAMBIOS"
        print(f"  {status} - {name}")
    print("════════════════════════════════════════════════")

    # Validar sintaxis
    print("\nValidando sintaxis...")
    controllers = [
        'borrador.controller.js',
        'pedidos.controller.js',
        'pagos-confirmacion.controller.js',
        'pagos-confirmacion.controller.v2.js'
    ]
    all_ok = True
    for c in controllers:
        path = f"{ERP_DIR}/src/controllers/{c}"
        ret = os.system(f'node --check "{path}" 2>/dev/null')
        if ret == 0:
            print(f"  ✅ {c}")
        else:
            print(f"  ❌ {c} - ERROR DE SINTAXIS")
            all_ok = False

    if not all_ok:
        print("\n⚠️  HAY ERRORES DE SINTAXIS. Revisar antes de reiniciar.")
        sys.exit(1)

    return 0


if __name__ == '__main__':
    sys.exit(main())
