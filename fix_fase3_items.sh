#!/bin/bash
# ============================================================================
# FIX FASE 3: INSERTs EN TABLAS DE ITEMS — Multi-empresa
# Ejecutar desde /root/mi_erp
#
# Corrige INSERTs que faltan id_empresa en:
#   - compras.helper.js (4 INSERTs + 1 ON CONFLICT CRÍTICO)
#   - ajustes-inventario.helper.js (3 INSERTs)
#   - despachos.helper.js (1 INSERT remito_items)
#   - pagos-proveedores.helper.js (2 INSERTs)
#   - pedidos.helper.js (1 INSERT borrador_items_log)
#   - presupuestos.helper.js (1 INSERT presupuesto_items)
#   - recibos.helper.js (1 INSERT recibo_facturas)
#   - crud.helper.js (4 INSERTs conjuntos + cotizaciones)
#   - productos.helper.js (2 INSERTs conjunto_items)
#
# Total: 19 correcciones
# ============================================================================

set -e
cd /root/mi_erp

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/pre_fix_multiempresa_fase3_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "============================================"
echo " FASE 3: INSERTs EN TABLAS DE ITEMS"
echo "============================================"
echo ""

# BACKUP de todos los archivos
ARCHIVOS=(
    "src/utils/compras.helper.js"
    "src/utils/ajustes-inventario.helper.js"
    "src/utils/despachos.helper.js"
    "src/utils/pagos-proveedores.helper.js"
    "src/utils/pedidos.helper.js"
    "src/utils/presupuestos.helper.js"
    "src/utils/recibos.helper.js"
    "src/utils/crud.helper.js"
    "src/utils/productos.helper.js"
)

for f in "${ARCHIVOS[@]}"; do
    cp "$f" "$BACKUP_DIR/"
done
echo "  ✓ Backup de ${#ARCHIVOS[@]} archivos en $BACKUP_DIR"
echo ""

# ============================================================================
# Todas las correcciones en un solo script Python
# ============================================================================
python3 << 'PYEOF'
import re
import sys

total_fixes = 0
total_warns = 0

def fix_file(filepath, replacements):
    """Aplica una lista de (old, new, description) a un archivo."""
    global total_fixes, total_warns
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    print(f"\n── {filepath} ──")
    
    for old, new, desc in replacements:
        if old in content:
            content = content.replace(old, new, 1)
            total_fixes += 1
            print(f"  ✓ {desc}")
        else:
            total_warns += 1
            print(f"  ⚠ {desc} — NO ENCONTRADO")
    
    with open(filepath, 'w') as f:
        f.write(content)

# ═══════════════════════════════════════════════════════════════
# 1. compras.helper.js — 4 INSERTs
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/compras.helper.js', [
    # 1a. orden_compra_items (línea ~36)
    (
        "INSERT INTO orden_compra_items (id_orden, id_producto, cantidad_pedida,\n                  precio_unitario, iva_porcentaje, subtotal, iva_monto, total)\n              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        "INSERT INTO orden_compra_items (id_empresa, id_orden, id_producto, cantidad_pedida,\n                  precio_unitario, iva_porcentaje, subtotal, iva_monto, total)\n              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        "orden_compra_items: agregar id_empresa"
    ),
    # 1b. recepcion_items (línea ~97)
    (
        "INSERT INTO recepcion_items (id_recepcion, id_orden_item, id_producto, cantidad_recibida)\n              VALUES ($1,$2,$3,$4)",
        "INSERT INTO recepcion_items (id_empresa, id_recepcion, id_orden_item, id_producto, cantidad_recibida)\n              VALUES ($1,$2,$3,$4,$5)",
        "recepcion_items: agregar id_empresa"
    ),
    # 1c. comprobante_compra_items (línea ~160) — solo el INSERT, params se ajustan abajo
    (
        "INSERT INTO comprobante_compra_items (\n                  id_comprobante, id_producto, descripcion,\n                  cantidad, cantidad_stock, precio_unitario,\n                  descuento_porcentaje, descuento_monto, descuentos_compuestos,",
        "INSERT INTO comprobante_compra_items (\n                  id_empresa, id_comprobante, id_producto, descripcion,\n                  cantidad, cantidad_stock, precio_unitario,\n                  descuento_porcentaje, descuento_monto, descuentos_compuestos,",
        "comprobante_compra_items: agregar id_empresa"
    ),
    # 1d. producto_proveedor ON CONFLICT CRÍTICO (línea ~241)
    (
        '''INSERT INTO producto_proveedor (id_producto, id_proveedor, precio_compra, descuento_porcentaje, precio_neto, ultima_compra)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (id_producto, id_proveedor) DO UPDATE SET
            precio_compra = $3, descuento_porcentaje = $4, precio_neto = $5,
            ultima_compra = NOW(), fecha_modificacion = NOW()
    `, [id_producto, id_proveedor, precio_compra, descuento_porcentaje || 0, precio_neto]);''',
        '''INSERT INTO producto_proveedor (id_empresa, id_producto, id_proveedor, precio_compra, descuento_porcentaje, precio_neto, ultima_compra)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (id_empresa, id_producto, id_proveedor) DO UPDATE SET
            precio_compra = $4, descuento_porcentaje = $5, precio_neto = $6,
            ultima_compra = NOW(), fecha_modificacion = NOW()
    `, [id_empresa, id_producto, id_proveedor, precio_compra, descuento_porcentaje || 0, precio_neto]);''',
        "producto_proveedor: ON CONFLICT (id_empresa, id_producto, id_proveedor) — CRÍTICO"
    ),
])

# Agregar id_empresa al destructuring de actualizarPrecioCompra
fix_file('src/utils/compras.helper.js', [
    (
        "const { id_producto, id_proveedor, precio_compra, descuento_porcentaje, precio_neto } = datos;",
        "const { id_empresa, id_producto, id_proveedor, precio_compra, descuento_porcentaje, precio_neto } = datos;",
        "actualizarPrecioCompra: agregar id_empresa a destructuring"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 2. ajustes-inventario.helper.js — 3 INSERTs
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/ajustes-inventario.helper.js', [
    # 2a. Línea ~226
    (
        "INSERT INTO ajuste_inventario_items (id_ajuste, id_producto, stock_sistema, stock_real, observaciones)\n          VALUES ($1, $2, $3, $4, $5)\n          ON CONFLICT (id_ajuste, id_producto)\n          DO UPDATE SET stock_real = EXCLUDED.stock_real, stock_sistema = EXCLUDED.stock_sistema, observaciones = EXCLUDED.observaciones",
        "INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real, observaciones)\n          VALUES ($1, $2, $3, $4, $5, $6)\n          ON CONFLICT (id_ajuste, id_producto)\n          DO UPDATE SET stock_real = EXCLUDED.stock_real, stock_sistema = EXCLUDED.stock_sistema, observaciones = EXCLUDED.observaciones",
        "ajuste_inventario_items (línea ~226): agregar id_empresa"
    ),
    # 2b. Línea ~262
    (
        "INSERT INTO ajuste_inventario_items (id_ajuste, id_producto, stock_sistema, stock_real, observaciones)\n              VALUES ($1, $2, $3, $4, $5)\n              ON CONFLICT (id_ajuste, id_producto) DO NOTHING",
        "INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real, observaciones)\n              VALUES ($1, $2, $3, $4, $5, $6)\n              ON CONFLICT (id_ajuste, id_producto) DO NOTHING",
        "ajuste_inventario_items (línea ~262): agregar id_empresa"
    ),
    # 2c. Línea ~399
    (
        "INSERT INTO ajuste_inventario_items (id_ajuste, id_producto, stock_sistema, stock_real)\n              VALUES ($1, $2, $3, $4)\n              ON CONFLICT (id_ajuste, id_producto) DO NOTHING",
        "INSERT INTO ajuste_inventario_items (id_empresa, id_ajuste, id_producto, stock_sistema, stock_real)\n              VALUES ($1, $2, $3, $4, $5)\n              ON CONFLICT (id_ajuste, id_producto) DO NOTHING",
        "ajuste_inventario_items (línea ~399): agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 3. despachos.helper.js — 1 INSERT remito_items
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/despachos.helper.js', [
    (
        "INSERT INTO remito_items (\n              id_remito, id_producto, id_pedido_item,\n              descripcion, cantidad, precio_unitario,\n              iva_porcentaje, subtotal, total, id_deposito_origen",
        "INSERT INTO remito_items (\n              id_empresa, id_remito, id_producto, id_pedido_item,\n              descripcion, cantidad, precio_unitario,\n              iva_porcentaje, subtotal, total, id_deposito_origen",
        "remito_items: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 4. pagos-proveedores.helper.js — 2 INSERTs
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/pagos-proveedores.helper.js', [
    # 4a. pago_proveedor_items
    (
        "INSERT INTO pago_proveedor_items (\n              id_pago, id_forma_pago, id_moneda, monto,\n              id_banco, numero_referencia, fecha_acreditacion,\n              id_cheque_propio, id_cheque_tercero, observaciones",
        "INSERT INTO pago_proveedor_items (\n              id_empresa, id_pago, id_forma_pago, id_moneda, monto,\n              id_banco, numero_referencia, fecha_acreditacion,\n              id_cheque_propio, id_cheque_tercero, observaciones",
        "pago_proveedor_items: agregar id_empresa"
    ),
    # 4b. imputacion_pagos_proveedor
    (
        "`INSERT INTO imputacion_pagos_proveedor (id_pago, id_cuenta, monto_imputado) VALUES ($1,$2,$3)`",
        "`INSERT INTO imputacion_pagos_proveedor (id_empresa, id_pago, id_cuenta, monto_imputado) VALUES ($1,$2,$3,$4)`",
        "imputacion_pagos_proveedor: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 5. pedidos.helper.js — 1 INSERT borrador_items_log
# ═══════════════════════════════════════════════════════════════
# Este es trickier porque no tenemos el INSERT exacto, solo el comentario
# Buscar INSERT INTO borrador_items_log y agregar id_empresa
with open('src/utils/pedidos.helper.js', 'r') as f:
    content = f.read()

# Buscar el patrón de INSERT INTO borrador_items_log
pattern = r"(INSERT INTO borrador_items_log\s*\()([^)]+)\)"
match = re.search(pattern, content)
if match:
    cols = match.group(2).strip()
    if 'id_empresa' not in cols:
        new_cols = 'id_empresa, ' + cols
        old_insert = match.group(0)
        new_insert = f"INSERT INTO borrador_items_log ({new_cols})"
        content = content.replace(old_insert, new_insert, 1)
        total_fixes += 1
        print(f"\n── src/utils/pedidos.helper.js ──")
        print(f"  ✓ borrador_items_log: agregar id_empresa a columnas")
    else:
        print(f"\n── src/utils/pedidos.helper.js ──")
        print(f"  ℹ borrador_items_log ya tiene id_empresa")
else:
    total_warns += 1
    print(f"\n── src/utils/pedidos.helper.js ──")
    print(f"  ⚠ borrador_items_log: INSERT no encontrado con regex")

with open('src/utils/pedidos.helper.js', 'w') as f:
    f.write(content)

# ═══════════════════════════════════════════════════════════════
# 6. presupuestos.helper.js — 1 INSERT presupuesto_items
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/presupuestos.helper.js', [
    (
        "INSERT INTO presupuesto_items (\n                  id_presupuesto, id_producto, descripcion, cantidad,\n                  precio_unitario, iva_porcentaje, descuento_porcentaje,\n                  subtotal, iva_monto, total",
        "INSERT INTO presupuesto_items (\n                  id_empresa, id_presupuesto, id_producto, descripcion, cantidad,\n                  precio_unitario, iva_porcentaje, descuento_porcentaje,\n                  subtotal, iva_monto, total",
        "presupuesto_items: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 7. recibos.helper.js — 1 INSERT recibo_facturas
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/recibos.helper.js', [
    (
        "INSERT INTO recibo_facturas (id_recibo, id_factura, monto_aplicado, fecha_aplicacion)\n          VALUES ($1,$2,$3,NOW())",
        "INSERT INTO recibo_facturas (id_empresa, id_recibo, id_factura, monto_aplicado, fecha_aplicacion)\n          VALUES ($1,$2,$3,$4,NOW())",
        "recibo_facturas: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 8. crud.helper.js — conjuntos + conjunto_items + cotizaciones
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/crud.helper.js', [
    # 8a. conjuntos
    (
        "INSERT INTO conjuntos (nombre, descripcion, precio_conjunto, descuento_porcentaje, activo)\n          VALUES ($1,$2,$3,$4,TRUE) RETURNING *\n      `, [nombre, descripcion || null, precio_conjunto || 0, descuento_porcentaje || 0]);",
        "INSERT INTO conjuntos (id_empresa, nombre, descripcion, precio_conjunto, descuento_porcentaje, activo)\n          VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING *\n      `, [id_empresa, nombre, descripcion || null, precio_conjunto || 0, descuento_porcentaje || 0]);",
        "conjuntos: agregar id_empresa"
    ),
    # 8b. conjunto_items (reemplazarConjuntoItems — línea ~179)
    (
        "await client.query('INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3)',\n              [id_conjunto, prod.id_producto, prod.cantidad || 1]);\n      }\n  }\n\n  async function insertarConjuntoItems",
        "await client.query('INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3,$4)',\n              [id_empresa, id_conjunto, prod.id_producto, prod.cantidad || 1]);\n      }\n  }\n\n  async function insertarConjuntoItems",
        "conjunto_items en reemplazarConjuntoItems: agregar id_empresa"
    ),
    # 8c. conjunto_items (insertarConjuntoItems — línea ~187)
    (
        "await client.query('INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3)',\n            [id_conjunto, prod.id_producto, prod.cantidad || 1]);\n    }\n}\n\nmodule.exports",
        "await client.query('INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3,$4)',\n            [id_empresa, id_conjunto, prod.id_producto, prod.cantidad || 1]);\n    }\n}\n\nmodule.exports",
        "conjunto_items en insertarConjuntoItems: agregar id_empresa"
    ),
    # 8d. cotizaciones
    (
        "INSERT INTO cotizaciones (id_moneda, cotizacion_compra, cotizacion_venta, fecha_cotizacion, hora_cotizacion, tipo, fuente)\n              VALUES ($1,$2,$3,CURRENT_DATE,CURRENT_TIME,$4,$5) RETURNING *\n          `, [id_moneda, cotizacion_compra, cotizacion_venta, tipo || 'manual', fuente || 'Manual']);",
        "INSERT INTO cotizaciones (id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, fecha_cotizacion, hora_cotizacion, tipo, fuente)\n              VALUES ($1,$2,$3,$4,CURRENT_DATE,CURRENT_TIME,$5,$6) RETURNING *\n          `, [id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, tipo || 'manual', fuente || 'Manual']);",
        "cotizaciones: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# 9. productos.helper.js — 2 INSERTs conjunto_items
# ═══════════════════════════════════════════════════════════════
fix_file('src/utils/productos.helper.js', [
    # 9a. crearProductoCompleto (línea ~529)
    (
        "INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad)\n                  VALUES ($1, $2, $3)\n                  ON CONFLICT (id_conjunto, id_producto) DO NOTHING\n              `, [conj.id_conjunto, id_producto, conj.cantidad || 1]);",
        "INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad)\n                  VALUES ($1, $2, $3, $4)\n                  ON CONFLICT (id_conjunto, id_producto) DO NOTHING\n              `, [id_empresa, conj.id_conjunto, id_producto, conj.cantidad || 1]);",
        "conjunto_items en crearProductoCompleto: agregar id_empresa"
    ),
    # 9b. actualizarProductoCompleto (línea ~585)
    (
        "INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad)\n                      VALUES ($1, $2, $3)\n                      ON CONFLICT (id_conjunto, id_producto) DO NOTHING\n                  `, [conj.id_conjunto, id_producto, conj.cantidad || 1]);",
        "INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad)\n                      VALUES ($1, $2, $3, $4)\n                      ON CONFLICT (id_conjunto, id_producto) DO NOTHING\n                  `, [id_empresa, conj.id_conjunto, id_producto, conj.cantidad || 1]);",
        "conjunto_items en actualizarProductoCompleto: agregar id_empresa"
    ),
])

# ═══════════════════════════════════════════════════════════════
# RESUMEN
# ═══════════════════════════════════════════════════════════════
print(f"\n{'='*50}")
print(f" RESUMEN: {total_fixes} fixes aplicados, {total_warns} warnings")
print(f"{'='*50}")
PYEOF

echo ""

# ============================================================================
# VALIDACIÓN DE SINTAXIS
# ============================================================================
echo "============================================"
echo " VALIDANDO SINTAXIS..."
echo "============================================"
echo ""

source ~/.nvm/nvm.sh 2>/dev/null || export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

ERRORES=0
for archivo in "${ARCHIVOS[@]}"; do
    if node --check "$archivo" 2>/dev/null; then
        echo "  ✓ $(basename $archivo) — OK"
    else
        echo "  ✗ $(basename $archivo) — ERROR"
        ERRORES=$((ERRORES+1))
    fi
done

echo ""
if [ $ERRORES -gt 0 ]; then
    echo "⚠ HAY $ERRORES ERRORES DE SINTAXIS"
    echo "  Restaurar: for f in $BACKUP_DIR/*.js; do cp \"\$f\" src/utils/; done"
    exit 1
fi

echo "============================================"
echo " FASE 3 COMPLETADA"
echo ""
echo " ⚠ IMPORTANTE: Los parámetros de los INSERTs"
echo " ahora esperan id_empresa como primer valor."
echo " Verificar que los controllers que llaman"
echo " a estas funciones pasen id_empresa en datos."
echo ""
echo " Script de verificación:"
echo '  grep -rn "actualizarPrecioCompra\|insertarOrdenItems\|insertarRecepcionItems" src/controllers/ | head -20'
echo "============================================"
