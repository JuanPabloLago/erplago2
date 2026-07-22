#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DEPLOY FIX BUG 1 + BUG 3 — ERP LAGO Venta Rapida
#
# USO:      bash deploy_fix_venta_rapida.sh
# ROLLBACK: bash deploy_fix_venta_rapida.sh rollback
# ═══════════════════════════════════════════════════════════════

HTML="/root/mi_erp/frontend/venta-rapida.html"
JS="/root/mi_erp/frontend/js/venta-rapida-script.js"
BAK_HTML="${HTML}.bak.pre_fix"
BAK_JS="${JS}.bak.pre_fix"

# ─── ROLLBACK ───
if [ "$1" = "rollback" ]; then
    echo ""
    echo "=== ROLLBACK ==="
    if [ -f "$BAK_HTML" ]; then cp "$BAK_HTML" "$HTML"; echo "[OK] HTML restaurado"
    else echo "[!!] No hay backup de HTML"; fi
    if [ -f "$BAK_JS" ]; then cp "$BAK_JS" "$JS"; echo "[OK] JS restaurado"
    else echo "[!!] No hay backup de JS"; fi
    echo "Listo. Ctrl+Shift+R en el navegador."
    exit 0
fi

echo ""
echo "======================================="
echo " FIX VENTA RAPIDA — Bug 1 + Bug 3"
echo "======================================="
echo ""

if [ ! -f "$HTML" ]; then echo "[!!] No existe: $HTML"; exit 1; fi
if [ ! -f "$JS" ]; then echo "[!!] No existe: $JS"; exit 1; fi

echo "1. Backup..."
cp "$HTML" "$BAK_HTML"
cp "$JS" "$BAK_JS"
echo "   [OK] $BAK_HTML"
echo "   [OK] $BAK_JS"
echo ""

# ─── BUG 1: BUSQUEDA OVERLAY ───
echo "2. Bug 1 (busqueda overlay)..."
python3 - "$HTML" << 'PYEOF'
import sys
PATH = sys.argv[1]
with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()
original = content; errores = []

CSS_NUEVO = """
        /* === FIX BUG1: Sugerencias como overlay (no empuja layout) === */
        .col-lg-12 { position: relative; }
        #sugerenciasProductos {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: 1000;
            max-height: 55vh;
            overflow-y: auto;
            margin: 0 !important;
            padding: 0 12px;
            background: transparent;
        }
        #sugerenciasProductos .list-group {
            box-shadow: 0 8px 24px rgba(0,0,0,0.15);
            border: 1px solid rgba(0,0,0,0.1);
        }
    </style>
</head>"""

if '    </style>\n</head>' in content:
    content = content.replace('    </style>\n</head>', CSS_NUEVO)
    print("   [OK] CSS overlay")
else: errores.append("No encontre </style></head>")

viejo = '                </div>\n            </div>\n        <!-- SUGERENCIAS DE BÚSQUEDA -->\n        <div id="sugerenciasProductos" class="mt-2 mb-3"></div>'
nuevo = '                </div>\n            <!-- SUGERENCIAS (overlay, no empuja layout) -->\n            <div id="sugerenciasProductos"></div>\n            </div>'
if viejo in content:
    content = content.replace(viejo, nuevo)
    print("   [OK] Sugerencias movido a overlay")
else: errores.append("No encontre patron sugerencias")

if errores:
    for e in errores: print("   [!!] " + e)
    sys.exit(1)
if content == original: print("   [--] Ya parcheado"); sys.exit(0)
if '</html>' not in content: print("   [!!] HTML ROTO"); sys.exit(1)
with open(PATH, 'w', encoding='utf-8') as f: f.write(content)
print("   [OK] HTML guardado")
PYEOF

if [ $? -ne 0 ]; then
    echo "[!!] FALLO Bug 1 — restaurando..."
    cp "$BAK_HTML" "$HTML"
    exit 1
fi
echo ""

# ─── BUG 3: RESET POST-VENTA ───
echo "3. Bug 3 (reset post-venta)..."
python3 - "$JS" << 'PYEOF'
import sys
PATH = sys.argv[1]
with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()
original = content; errores = []

viejo = """// Limpia estado local sin tocar BD (el borrador ya fue confirmado o descartado)
function limpiarVentaLocal() {
    itemsVentaArray = [];
    pagosRegistrados = [];
    borradorId = null;
    productoRecienAgregado = false;
    // Resetear UI completa
    mostrarItemsVenta();
    calcularTotal();
    actualizarVisualizacionPagos();
    actualizarEstadoBloqueo();
    // Resetear cliente a Consumidor Final
    obtenerConsumidorFinal();
    // Limpiar observaciones y descuento
    const obsEl = document.getElementById('observaciones');
    if (obsEl) obsEl.value = '';
    const dtoEl = document.getElementById('descuentoGeneralPorcentaje');
    if (dtoEl) dtoEl.value = '0';
    // Focus al scanner
    const scanEl = document.getElementById('codigoBarrasInput');
    if (scanEl) setTimeout(() => scanEl.focus(), 300);
    document.querySelectorAll('.forma-pago-btn[data-forma]').forEach(btn => { btn.classList.remove('btn-success'); const forma = btn.getAttribute('data-forma'); const claseOriginal = {efectivo:'btn-outline-success',debito:'btn-outline-primary',credito:'btn-outline-warning',transferencia:'btn-outline-info',mercadopago:'btn-outline-secondary',mercadopago_qr:'btn-outline-secondary'}[forma] || 'btn-outline-secondary'; btn.classList.add(claseOriginal); });
    const descuentoPercEl = document.getElementById('descuentoGeneralPorcentaje'); const descuentoMontoEl = document.getElementById('descuentoGeneralMonto'); const observacionesEl = document.getElementById('observaciones'); const btnRetiraEl = document.getElementById('btnRetira');
    if (descuentoPercEl) descuentoPercEl.value = 0; if (descuentoMontoEl) descuentoMontoEl.value = 0; if (observacionesEl) observacionesEl.value = ''; if (btnRetiraEl) btnRetiraEl.checked = true;
    mostrarItemsVenta(); calcularTotal(); obtenerConsumidorFinal();
    const listaPagosEl = document.getElementById('listaPagosRegistrados'); if (listaPagosEl) listaPagosEl.innerHTML = '';
    const resumenEl = document.getElementById('resumenPagos'); if (resumenEl) resumenEl.style.display = 'none';
    const codigoEl = document.getElementById('codigoProducto'); if (codigoEl) codigoEl.focus();
}"""

nuevo = """// Limpia estado local sin tocar BD (el borrador ya fue confirmado o descartado)
function limpiarVentaLocal() {
    // 1. Reset estado en memoria
    itemsVentaArray = [];
    pagosRegistrados = [];
    borradorId = null;
    productoRecienAgregado = false;
    resultadosProductosFiltrados = [];
    indiceSeleccionado = -1;
    tipoEntrega = 'retiro';
    formaPagoActual = null;

    // 2. Reset UI tabla y totales (UNA sola vez)
    mostrarItemsVenta();
    calcularTotal();

    // 3. Reset pagos visual
    actualizarVisualizacionPagos();
    actualizarEstadoBloqueo();
    var listaPagosEl = document.getElementById('listaPagosRegistrados');
    if (listaPagosEl) listaPagosEl.innerHTML = '';
    var resumenEl = document.getElementById('resumenPagos');
    if (resumenEl) resumenEl.style.display = 'none';

    // 4. Reset botones forma de pago
    document.querySelectorAll('.forma-pago-btn[data-forma]').forEach(function(btn) {
        btn.classList.remove('btn-success');
        var forma = btn.getAttribute('data-forma');
        var claseOriginal = {efectivo:'btn-outline-success',debito:'btn-outline-primary',credito:'btn-outline-warning',transferencia:'btn-outline-info',mercadopago:'btn-outline-secondary',mercadopago_qr:'btn-outline-secondary'}[forma] || 'btn-outline-secondary';
        btn.classList.add(claseOriginal);
    });

    // 5. Ocultar input pago parcial si estaba visible
    var inputParcialEl = document.getElementById('inputPagoParcial');
    if (inputParcialEl) inputParcialEl.style.display = 'none';

    // 6. Reset descuentos
    var descuentoPercEl = document.getElementById('descuentoGeneralPorcentaje');
    var descuentoMontoEl = document.getElementById('descuentoGeneralMonto');
    if (descuentoPercEl) descuentoPercEl.value = 0;
    if (descuentoMontoEl) descuentoMontoEl.value = 0;

    // 7. Reset observaciones
    var obsEl = document.getElementById('observaciones');
    if (obsEl) obsEl.value = '';

    // 8. Reset tipo entrega
    var btnRetiraEl = document.getElementById('btnRetira');
    if (btnRetiraEl) btnRetiraEl.checked = true;

    // 9. Limpiar sugerencias de busqueda
    var sugerenciasEl = document.getElementById('sugerenciasProductos');
    if (sugerenciasEl) sugerenciasEl.innerHTML = '';

    // 10. Limpiar campo de busqueda
    var codigoEl = document.getElementById('codigoProducto');
    if (codigoEl) codigoEl.value = '';

    // 11. Reset cliente a Consumidor Final (UNA sola llamada)
    obtenerConsumidorFinal();

    // 12. Focus al escaner (ID CORRECTO: codigoProducto)
    if (codigoEl) setTimeout(function() { codigoEl.focus(); }, 200);
}"""

if viejo in content:
    content = content.replace(viejo, nuevo)
    print("   [OK] limpiarVentaLocal() reescrita")
else:
    errores.append("No encontre limpiarVentaLocal()")

click_outside = """
// === FIX BUG3: Click fuera cierra sugerencias ===
document.addEventListener('click', function(e) {
    var sugerenciasEl = document.getElementById('sugerenciasProductos');
    var codigoEl = document.getElementById('codigoProducto');
    if (!sugerenciasEl || !sugerenciasEl.innerHTML) return;
    if (e.target === codigoEl) return;
    if (sugerenciasEl.contains(e.target)) return;
    sugerenciasEl.innerHTML = '';
    resultadosProductosFiltrados = [];
    indiceSeleccionado = -1;
});

"""
marcador = "console.log('\u2705 Venta R\u00e1pida v6.0"
if marcador in content:
    content = content.replace(marcador, click_outside + marcador)
    print("   [OK] Click-outside handler")
else: errores.append("No encontre console.log final")

if errores:
    for e in errores: print("   [!!] " + e)
    sys.exit(1)
if content == original: print("   [--] Ya parcheado"); sys.exit(0)
if 'function limpiarVentaLocal()' not in content: print("   [!!] JS ROTO"); sys.exit(1)
with open(PATH, 'w', encoding='utf-8') as f: f.write(content)
print("   [OK] JS guardado")
PYEOF

if [ $? -ne 0 ]; then
    echo "[!!] FALLO Bug 3 — restaurando TODO..."
    cp "$BAK_HTML" "$HTML"
    cp "$BAK_JS" "$JS"
    exit 1
fi
echo ""

# ─── VERIFICACION ───
echo "4. Verificando..."
PASS=0; FAIL=0

if grep -q 'FIX BUG1' "$HTML"; then echo "   [OK] Bug1: CSS overlay"; ((PASS++)); else echo "   [!!] Bug1: CSS falta"; ((FAIL++)); fi
if grep -q 'codigoBarrasInput' "$JS"; then echo "   [!!] Bug3: ID roto sigue"; ((FAIL++)); else echo "   [OK] Bug3: ID corregido"; ((PASS++)); fi
if grep -q 'inputPagoParcial.*none' "$JS"; then echo "   [OK] Bug3: parcial oculto"; ((PASS++)); else echo "   [!!] Bug3: parcial no oculta"; ((FAIL++)); fi
if grep -q 'FIX BUG3' "$JS"; then echo "   [OK] Bug3: click-outside"; ((PASS++)); else echo "   [!!] Bug3: click-outside falta"; ((FAIL++)); fi

echo ""
if [ $FAIL -eq 0 ]; then
    echo "======================================="
    echo " DEPLOY OK ($PASS/4 checks passed)"
    echo "======================================="
    echo ""
    echo " Probar: Ctrl+Shift+R en el navegador"
    echo ""
    echo " Si algo falla:"
    echo "   bash deploy_fix_venta_rapida.sh rollback"
else
    echo "======================================="
    echo " DEPLOY CON WARNINGS ($FAIL fails)"
    echo "======================================="
    echo " Revisar los [!!] de arriba"
    echo " Rollback: bash deploy_fix_venta_rapida.sh rollback"
fi
echo ""
