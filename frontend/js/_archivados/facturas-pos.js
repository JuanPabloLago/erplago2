/**
 * FACTURAS-POS.JS - ERP LAGO
 * Tab de Factura Manual (POS) - Extraído de facturas.html
 *
 * CAMBIOS vs versión inline anterior:
 *   - IVA por producto real (no hardcodeado 21%)
 *   - Autocomplete para clientes (no carga 5869 en select)
 *   - Separado en archivo propio para mantenibilidad
 */

// === POS Variables ===
let posProductos = [];
let posClientes = [];
let posItems = [];
let posClienteActual = null;
let posTiposComprobante = [];
let posFacturaId = null;
let posInicializado = false;
let posClienteSearchTimeout = null;

function inicializarPOS() {
    if (posInicializado) return;
    posInicializado = true;
    posCargarTipos();
    posCargarProductos();
    posConfigurarEventos();
}

// ========================================
// CLIENTES - Autocomplete (en vez de cargar todos)
// ========================================
async function posCargarClientes(busqueda = '') {
    try {
        const params = new URLSearchParams();
        if (busqueda) params.append('q', busqueda);
        params.append('limit', '20');

        const res = await fetch(`${API_URL}/clientes/buscar?${params}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        if (!res.ok) {
            // Fallback: si /buscar no existe, usar endpoint base
            const resFallback = await fetch(`${API_URL}/clientes?q=${encodeURIComponent(busqueda)}&limit=20`, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
            if (!resFallback.ok) throw new Error('Error');
            const fbData = await resFallback.json(); posClientes = fbData.results || fbData.clientes || (Array.isArray(fbData) ? fbData : []);
        } else {
            const data = await res.json();
            posClientes = data.results || data.clientes || (Array.isArray(data) ? data : []);
        }

        posRenderClienteOptions();
    } catch (e) {
        // Último fallback: cargar todos (comportamiento original)
        try {
            const res = await fetch(`${API_URL}/clientes`, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            });
            if (res.ok) {
                const allData = await res.json(); posClientes = allData.results || allData.clientes || (Array.isArray(allData) ? allData : []);
                posRenderClienteOptions();
            }
        } catch (e2) { /* silenciar */ }
    }
}

function posRenderClienteOptions() {
    const datalist = document.getElementById('posClienteDatalist');
    const select = document.getElementById('posClienteSelect');

    if (datalist) {
        // Modo datalist (autocomplete)
        datalist.innerHTML = posClientes.map(c =>
            `<option value="${c.razon_social}" data-id="${c.id_cliente}" data-cliente='${JSON.stringify(c).replace(/'/g, "&#39;")}'>`
        ).join('');
    } else if (select) {
        // Fallback: modo select tradicional
        const currentVal = select.value;
        select.innerHTML = '<option value="">Seleccione cliente...</option>';
        posClientes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id_cliente;
            opt.textContent = c.razon_social;
            opt.dataset.cliente = JSON.stringify(c);
            select.appendChild(opt);
        });
        if (currentVal) select.value = currentVal;
    }
}

// ========================================
// TIPOS DE COMPROBANTE
// ========================================
async function posCargarTipos() {
    try {
        const res = await fetch(`${API_URL}/facturas/tipos`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (res.ok) posTiposComprobante = await res.json();
        else posTiposComprobante = [
            { id_tipo_factura: 1, codigo: 'A', nombre: 'Factura A' },
            { id_tipo_factura: 2, codigo: 'B', nombre: 'Factura B' },
            { id_tipo_factura: 3, codigo: 'C', nombre: 'Factura C' }
        ];
    } catch (e) { /* usar defaults */ }
}

// ========================================
// PRODUCTOS
// ========================================
async function posCargarProductos(busqueda = '') {
    try {
        let url = busqueda
            ? `${API_URL}/productos/buscar?q=${encodeURIComponent(busqueda)}`
            : `${API_URL}/productos/listar`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (!res.ok) throw new Error('Error');
        const data = await res.json();
        posProductos = (data.results || data.productos || data || []).filter(p => (p.stock_real || 0) > 0);
        posRenderProductos();
    } catch (e) {
        document.getElementById('posProductosGrid').innerHTML =
            '<div class="text-center text-danger p-3" style="grid-column:1/-1;">Error al cargar</div>';
    }
}

function posRenderProductos() {
    const grid = document.getElementById('posProductosGrid');
    if (posProductos.length === 0) {
        grid.innerHTML = '<div class="text-center text-muted p-3" style="grid-column:1/-1;">Sin productos</div>';
        return;
    }
    grid.innerHTML = posProductos.slice(0, 80).map(p => {
        const precio = parseFloat(p.precio || p.precio_lista || 0);
        const ivaPct = parseFloat(p.iva_porcentaje || p.alicuota_iva || 21);
        // Badge de IVA si no es 21%
        const ivaBadge = ivaPct !== 21
            ? `<span class="badge bg-info" style="font-size:0.6rem;">IVA ${ivaPct}%</span>`
            : '';
        return `<button class="producto-btn-pos" onclick="posAgregarProducto(${p.id_producto})">
            <div class="fw-bold small">${p.nombre}</div>
            <small class="text-success fw-bold">$${precio.toFixed(0)}</small>
            ${ivaBadge}
        </button>`;
    }).join('');
}

// ========================================
// ITEMS DEL CARRITO
// ========================================
function posAgregarProducto(id) {
    const prod = posProductos.find(p => p.id_producto === id);
    if (!prod) return;
    const existente = posItems.find(i => i.id_producto === id);
    if (existente) {
        existente.cantidad++;
    } else {
        posItems.push({
            id_producto: id,
            descripcion: prod.nombre,
            cantidad: 1,
            precio_unitario: parseFloat(prod.precio || prod.precio_lista || 0),
            // IVA real del producto, no hardcodeado
            porcentaje_iva: parseFloat(prod.iva_porcentaje || prod.alicuota_iva || 21)
        });
    }
    posRenderItems();
    posCalcTotales();
    posCheckBtn();
}

function posEliminarItem(id) {
    posItems = posItems.filter(i => i.id_producto !== id);
    posRenderItems();
    posCalcTotales();
    posCheckBtn();
}

function posRenderItems() {
    const lista = document.getElementById('posItemsLista');
    if (posItems.length === 0) {
        lista.innerHTML = '<div class="text-center text-muted small py-3">Agregue productos</div>';
        document.getElementById('posItemCount').textContent = '0';
        return;
    }
    lista.innerHTML = posItems.map(item => {
        const total = item.cantidad * item.precio_unitario;
        const ivaInfo = item.porcentaje_iva !== 21
            ? `<span class="badge bg-info ms-1" style="font-size:0.6rem;">IVA ${item.porcentaje_iva}%</span>`
            : '';
        return `<div class="d-flex justify-content-between align-items-center border-bottom py-1">
            <div class="flex-grow-1">
                <strong class="small">${item.descripcion}</strong>${ivaInfo}
                <div class="small text-muted">
                    <input type="number" value="${item.cantidad}" min="1" step="any" style="width:60px"
                           class="form-control form-control-sm d-inline"
                           onchange="posCambiarCant(${item.id_producto}, this.value)">
                    x $${item.precio_unitario.toFixed(2)}
                </div>
            </div>
            <div class="text-end">
                <strong class="small">$${total.toFixed(2)}</strong>
                <button class="btn btn-sm btn-link text-danger p-0 ms-1"
                        onclick="posEliminarItem(${item.id_producto})"><i class="bi bi-x"></i></button>
            </div>
        </div>`;
    }).join('');
    document.getElementById('posItemCount').textContent = posItems.length;
}

function posCambiarCant(id, val) {
    const item = posItems.find(i => i.id_producto === id);
    if (item) { item.cantidad = Math.max(1, parseFloat(val) || 1); }
    posRenderItems();
    posCalcTotales();
}

// ========================================
// CÁLCULO DE TOTALES - IVA real por item
// ========================================
function posCalcTotales() {
    let subtotal = 0;
    let ivaTotal = 0;

    posItems.forEach(item => {
        const neto = item.cantidad * item.precio_unitario;
        const iva = neto * (item.porcentaje_iva / 100);
        subtotal += neto;
        ivaTotal += iva;
    });

    const total = subtotal + ivaTotal;

    document.getElementById('posSubtotal').textContent = '$' + subtotal.toFixed(2);
    document.getElementById('posIva').textContent = '$' + ivaTotal.toFixed(2);
    document.getElementById('posTotal').textContent = '$' + total.toFixed(2);
}

function posCheckBtn() {
    const btn = document.getElementById('posBtnGenerar');
    const clienteInput = document.getElementById('posClienteInput') || document.getElementById('posClienteSelect');
    const tieneCliente = posClienteActual !== null;
    btn.disabled = !(tieneCliente && posItems.length > 0);
}

// ========================================
// GENERAR FACTURA MANUAL
// ========================================
async function posGenerarFactura() {
    const tieneCliente = posClienteActual !== null;
    if (!tieneCliente || posItems.length === 0) return;

    const tipoId = posClienteActual?.id_condicion_iva === 1 ? 1 : 2;

    mostrarLoading(true, 'Generando factura...', 'Solicitando CAE a AFIP...');

    try {
        const res = await fetch(`${API_URL}/facturas`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_cliente: parseInt(posClienteActual.id_cliente),
                id_tipo_factura: tipoId,
                items: posItems
            })
        });
        const data = await res.json();
        mostrarLoading(false);

        if (res.ok) {
            posFacturaId = data.id_factura;
            document.getElementById('posFacturaNumero').textContent = data.numero_completo;
            document.getElementById('posFacturaCae').textContent = data.cae || 'Pendiente';
            document.getElementById('posBtnGenerar').style.display = 'none';
            document.getElementById('posResultado').style.display = 'block';
        } else {
            if (data.afip_error) {
                posModalErrorAFIP(data.error);
            } else {
                alert('Error: ' + (data.error || 'Error desconocido'));
            }
        }
    } catch (e) {
        mostrarLoading(false);
        alert('Error: ' + e.message);
    }
}

function posNuevaFactura() {
    posItems = [];
    posFacturaId = null;
    posClienteActual = null;

    const clienteInput = document.getElementById('posClienteInput');
    const clienteSelect = document.getElementById('posClienteSelect');
    if (clienteInput) clienteInput.value = '';
    if (clienteSelect) clienteSelect.value = '';

    document.getElementById('posClienteInfo').style.display = 'none';
    document.getElementById('posTipoComprobante').innerHTML = '<span class="text-muted">Seleccione un cliente</span>';
    document.getElementById('posProxNumero').textContent = '-';
    document.getElementById('posBtnGenerar').style.display = 'block';
    document.getElementById('posBtnGenerar').disabled = true;
    document.getElementById('posResultado').style.display = 'none';
    document.getElementById('posSearchInput').value = '';
    posRenderItems();
    posCalcTotales();
    posCargarProductos();
}

// ========================================
// SELECCIÓN DE CLIENTE (input con datalist)
// ========================================
function posOnClienteInput(valor) {
    clearTimeout(posClienteSearchTimeout);
    posClienteSearchTimeout = setTimeout(() => {
        if (valor.length >= 2) {
            posCargarClientes(valor);
        }
    }, 300);

    // Verificar si coincide con algún cliente cargado
    const match = posClientes.find(c =>
        c.razon_social.toLowerCase() === valor.toLowerCase()
    );
    if (match) {
        posSeleccionarCliente(match);
    } else {
        posClienteActual = null;
        document.getElementById('posClienteInfo').style.display = 'none';
        document.getElementById('posTipoComprobante').innerHTML = '<span class="text-muted">Seleccione un cliente</span>';
        posCheckBtn();
    }
}

function posSeleccionarCliente(cliente) {
    posClienteActual = cliente;
    document.getElementById('posClienteInfo').innerHTML =
        `CUIT: ${cliente.cuit_cuil || '-'} | ${cliente.condicion_iva || cliente.nombre_condicion_iva || '-'}`;
    document.getElementById('posClienteInfo').style.display = 'block';

    const tipo = cliente.id_condicion_iva === 1
        ? posTiposComprobante.find(t => t.codigo === 'A')
        : posTiposComprobante.find(t => t.codigo === 'B');

    if (tipo) {
        document.getElementById('posTipoComprobante').innerHTML =
            `<span class="badge bg-success fs-6">${tipo.nombre}</span>`;
        // Obtener PV dinámico y luego próximo número
        fetch(`${API_URL}/facturas/mi-punto-venta`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        }).then(r => r.json()).then(pvData => {
            const pv = pvData.punto_venta;
            fetch(`${API_URL}/facturas/proximo-numero/${pv}/${tipo.id_tipo_factura}`, {
                headers: { 'Authorization': `Bearer ${TOKEN}` }
            }).then(r => r.json()).then(d => {
                document.getElementById('posProxNumero').textContent =
                    `${String(pv).padStart(4, '0')}-${String(d.proximo_numero).padStart(8, '0')}`;
            });
        });
    }
    posCheckBtn();
}

// ========================================
// EVENTOS
// ========================================
function posConfigurarEventos() {
    // Búsqueda de productos
    let prodTimeout;
    document.getElementById('posSearchInput').addEventListener('input', function() {
        clearTimeout(prodTimeout);
        prodTimeout = setTimeout(() => posCargarProductos(this.value), 300);
    });

    // Cliente - input con autocomplete
    const clienteInput = document.getElementById('posClienteInput');
    const clienteSelect = document.getElementById('posClienteSelect');

    if (clienteInput) {
        clienteInput.addEventListener('input', function() {
            posOnClienteInput(this.value);
        });
        // Cargar iniciales al hacer focus
        clienteInput.addEventListener('focus', function() {
            if (posClientes.length === 0) posCargarClientes('');
        });
    } else if (clienteSelect) {
        // Fallback: modo select (comportamiento original)
        posCargarClientes('');
        clienteSelect.addEventListener('change', function() {
            const opt = this.options[this.selectedIndex];
            if (opt.dataset.cliente) {
                posSeleccionarCliente(JSON.parse(opt.dataset.cliente));
            } else {
                posClienteActual = null;
                document.getElementById('posClienteInfo').style.display = 'none';
                document.getElementById('posTipoComprobante').innerHTML = '<span class="text-muted">Seleccione un cliente</span>';
            }
            posCheckBtn();
        });
    }

    // Atajos de teclado
    document.addEventListener('keydown', function(e) {
        if (document.getElementById('tab-manual').classList.contains('active')) {
            if (e.key === 'F2') {
                e.preventDefault();
                document.getElementById('posSearchInput').focus();
            }
            if (e.key === 'F9') {
                e.preventDefault();
                const btn = document.getElementById('posBtnGenerar');
                if (!btn.disabled && btn.style.display !== 'none') posGenerarFactura();
            }
        }
    });
}

// ========================================
// ERROR AFIP - REINTENTAR O SUSPENDER
// ========================================
function posModalErrorAFIP(mensaje) {
    var existing = document.getElementById('posModalAFIP');
    if (existing) existing.remove();

    var div = document.createElement('div');
    div.innerHTML = '<div class="modal fade" id="posModalAFIP" tabindex="-1"><div class="modal-dialog"><div class="modal-content">' +
        '<div class="modal-header bg-warning"><h5 class="modal-title"><i class="bi bi-exclamation-triangle"></i> Error de Conexion AFIP</h5>' +
        '<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body">' +
        '<p class="fw-bold text-danger">' + mensaje + '</p>' +
        '<div class="alert alert-info"><i class="bi bi-info-circle"></i> Los items cargados <strong>no se pierden</strong>. Puede reintentar o guardar como pedido para facturar despues.</div></div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>' +
        '<button type="button" class="btn btn-primary" onclick="posReintentarFactura()"><i class="bi bi-arrow-clockwise"></i> Reintentar</button>' +
        '<button type="button" class="btn btn-warning" onclick="posSuspenderComoPedido()"><i class="bi bi-pause-circle"></i> Guardar como Pedido</button>' +
        '</div></div></div></div>';
    document.body.appendChild(div.firstChild);
    new bootstrap.Modal(document.getElementById('posModalAFIP')).show();
}

function posReintentarFactura() {
    var m = bootstrap.Modal.getInstance(document.getElementById('posModalAFIP'));
    if (m) m.hide();
    posGenerarFactura();
}

async function posSuspenderComoPedido() {
    var m = bootstrap.Modal.getInstance(document.getElementById('posModalAFIP'));
    if (m) m.hide();
    if (!posClienteActual || posItems.length === 0) { alert('No hay items'); return; }
    mostrarLoading(true, 'Guardando pedido...', 'Suspendiendo para facturar despues');
    try {
        var res = await fetch(API_URL + '/pedidos', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id_cliente: parseInt(posClienteActual.id_cliente),
                items: posItems.map(function(i) { return { id_producto: i.id_producto, cantidad: i.cantidad, precio_unitario: i.precio_unitario }; }),
                observaciones: 'Suspendido desde Factura Manual - AFIP no disponible'
            })
        });
        var data = await res.json();
        mostrarLoading(false);
        if (res.ok) {
            alert('Pedido guardado (#' + (data.id_pedido || '') + '). Facturelo desde Facturacion Masiva cuando AFIP responda.');
        } else {
            alert('Error al guardar: ' + (data.error || 'Error'));
        }
    } catch (e) {
        mostrarLoading(false);
        alert('Error: ' + e.message);
    }
}
