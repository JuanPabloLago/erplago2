/**
 * ═══════════════════════════════════════════════════════════════════════
 * HISTORIAL-MOVIMIENTOS.JS — ERP LAGO
 * Consulta de productos vendidos/comprados con filtros avanzados
 *
 * Features:
 *   - Lazy search para productos y clientes/proveedores (debounce 300ms)
 *   - Atajos: F5=buscar, Esc=limpiar, Enter en campo=buscar
 *   - Paginación, exportación Excel, tabs ventas/compras
 *   - Diseño LAGO: paleta verde, clases .lago-*
 * ═══════════════════════════════════════════════════════════════════════
 */

const API_URL = window.CONFIG?.API_BASE_URL || '/api';
const TOKEN = localStorage.getItem('authToken');

// Estado
let tabActual = 'ventas';
let datosActuales = [];
let paginaActual = 0;
const LIMITE = 100;
let productoTimeout = null;
let entidadTimeout = null;
let entidadesCache = [];

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    if (!TOKEN) return;

    // Fechas por defecto: último mes
    const hoy = new Date();
    const hace30 = new Date(hoy - 30 * 24 * 60 * 60 * 1000);
    document.getElementById('fechaHasta').value = hoy.toISOString().split('T')[0];
    document.getElementById('fechaDesde').value = hace30.toISOString().split('T')[0];

    await verificarPermisos();
    setupProductoAutocomplete();
    setupEntidadAutocomplete();
    setupAtajos();

    // Enter en búsqueda
    document.getElementById('txtBuscar').addEventListener('keypress', e => {
        if (e.key === 'Enter') buscar();
    });
});

// ════════════════════════════════════════
// ATAJOS DE TECLADO
// ════════════════════════════════════════
function setupAtajos() {
    document.addEventListener('keydown', e => {
        // No interceptar si hay modal abierto o está en input
        const enInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName);

        if (e.key === 'F5' && !e.ctrlKey) {
            e.preventDefault();
            buscar();
        }
        if (e.key === 'Escape') {
            limpiarFiltros();
        }
    });
}

// ════════════════════════════════════════
// PERMISOS
// ════════════════════════════════════════
async function verificarPermisos() {
    try {
        const res = await fetch(`${API_URL}/historial-movimientos/usuario`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const info = await res.json();

        if (info.puedeVerCompras) {
            document.getElementById('tabCompras').style.display = '';
        }

        const userBadge = document.getElementById('userInfo');
        if (userBadge && info.nombre) {
            userBadge.innerHTML = `<i class="bi bi-person-circle me-1"></i> ${info.nombre}`;
        }
    } catch (e) {
        console.error('Error permisos:', e);
    }
}

// ════════════════════════════════════════
// TABS
// ════════════════════════════════════════
function cambiarTab(tab) {
    tabActual = tab;

    // Visual
    document.querySelectorAll('.lago-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.lago-tab[data-tab="${tab}"]`).classList.add('active');

    // Cambiar labels
    const lblEntidad = document.getElementById('lblEntidad');
    const thEntidad = document.getElementById('thEntidad');
    const cboTipo = document.getElementById('cboTipo');

    if (tab === 'ventas') {
        lblEntidad.innerHTML = '<i class="bi bi-person"></i> Cliente';
        thEntidad.textContent = 'Cliente';
        cboTipo.innerHTML = '<option value="todos">Todos</option><option value="PEDIDO">Pedidos</option><option value="FACTURA">Facturas</option>';
    } else {
        lblEntidad.innerHTML = '<i class="bi bi-truck"></i> Proveedor';
        thEntidad.textContent = 'Proveedor';
        cboTipo.innerHTML = '<option value="todos">Todos</option><option value="COMPRA">Compras</option>';
    }

    // Limpiar entidad seleccionada
    limpiarEntidad();
    entidadesCache = [];
    limpiarResultados();
}

// ════════════════════════════════════════
// PRODUCTO AUTOCOMPLETE (lazy search)
// ════════════════════════════════════════
function setupProductoAutocomplete() {
    const input = document.getElementById('txtProducto');
    const suggestions = document.getElementById('productoSuggestions');

    input.addEventListener('input', () => {
        clearTimeout(productoTimeout);
        const q = input.value.trim();
        if (q.length < 2) { suggestions.classList.remove('show'); return; }

        productoTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${API_URL}/historial-movimientos/productos?q=${encodeURIComponent(q)}`, {
                    headers: { 'Authorization': `Bearer ${TOKEN}` }
                });
                const productos = await res.json();
                if (productos.length === 0) { suggestions.classList.remove('show'); return; }

                suggestions.innerHTML = productos.map(p => `
                    <div class="producto-suggestion" data-id="${p.id_producto}" data-nombre="${p.nombre}" data-sku="${p.sku || ''}">
                        <div style="font-weight:500;">${p.nombre}</div>
                        <small style="color:var(--lago-muted);">${p.sku || 'Sin SKU'}</small>
                    </div>
                `).join('');
                suggestions.classList.add('show');

                // Click handlers
                suggestions.querySelectorAll('.producto-suggestion').forEach(el => {
                    el.addEventListener('click', () => {
                        seleccionarProducto(el.dataset.id, el.dataset.nombre, el.dataset.sku);
                    });
                });
            } catch (e) { console.error(e); }
        }, 300);
    });

    input.addEventListener('keypress', e => { if (e.key === 'Enter') buscar(); });

    document.addEventListener('click', e => {
        if (!e.target.closest('.producto-autocomplete')) suggestions.classList.remove('show');
    });
}

function seleccionarProducto(id, nombre, sku) {
    document.getElementById('idProducto').value = id;
    document.getElementById('txtProducto').style.display = 'none';
    document.getElementById('productoSuggestions').classList.remove('show');
    document.getElementById('productoSeleccionado').innerHTML = `
        <span class="selected-tag">
            <span>${nombre} <small>(${sku || 'S/C'})</small></span>
            <button class="btn-clear" onclick="limpiarProducto()" title="Quitar"><i class="bi bi-x-circle"></i></button>
        </span>
    `;
    document.getElementById('productoSeleccionado').style.display = 'block';
}

function limpiarProducto() {
    document.getElementById('idProducto').value = '';
    document.getElementById('txtProducto').value = '';
    document.getElementById('txtProducto').style.display = 'block';
    document.getElementById('productoSeleccionado').style.display = 'none';
}

// ════════════════════════════════════════
// ENTIDAD AUTOCOMPLETE (lazy — reemplaza <select> de 500)
// ════════════════════════════════════════
function setupEntidadAutocomplete() {
    const input = document.getElementById('txtEntidad');
    const suggestions = document.getElementById('entidadSuggestions');

    input.addEventListener('input', () => {
        clearTimeout(entidadTimeout);
        const q = input.value.trim();
        if (q.length < 2) { suggestions.classList.remove('show'); return; }

        entidadTimeout = setTimeout(async () => {
            try {
                const endpoint = tabActual === 'ventas' ? 'clientes' : 'proveedores';
                const res = await fetch(`${API_URL}/historial-movimientos/${endpoint}`, {
                    headers: { 'Authorization': `Bearer ${TOKEN}` }
                });
                const data = await res.json();
                entidadesCache = data;

                // Filtrar localmente
                const filtrados = data.filter(e =>
                    e.razon_social.toLowerCase().includes(q.toLowerCase())
                ).slice(0, 15);

                if (filtrados.length === 0) { suggestions.classList.remove('show'); return; }

                const campoId = tabActual === 'ventas' ? 'id_cliente' : 'id_proveedor';
                suggestions.innerHTML = filtrados.map(e => `
                    <div class="entidad-suggestion" data-id="${e[campoId]}" data-nombre="${e.razon_social}">
                        ${e.razon_social}
                    </div>
                `).join('');
                suggestions.classList.add('show');

                suggestions.querySelectorAll('.entidad-suggestion').forEach(el => {
                    el.addEventListener('click', () => {
                        seleccionarEntidad(el.dataset.id, el.dataset.nombre);
                    });
                });
            } catch (e) { console.error(e); }
        }, 300);
    });

    input.addEventListener('keypress', e => { if (e.key === 'Enter') buscar(); });

    document.addEventListener('click', e => {
        if (!e.target.closest('.entidad-autocomplete')) suggestions.classList.remove('show');
    });
}

function seleccionarEntidad(id, nombre) {
    document.getElementById('idEntidad').value = id;
    document.getElementById('txtEntidad').style.display = 'none';
    document.getElementById('entidadSuggestions').classList.remove('show');
    document.getElementById('entidadSeleccionada').innerHTML = `
        <span class="selected-tag">
            <span>${nombre}</span>
            <button class="btn-clear" onclick="limpiarEntidad()" title="Quitar"><i class="bi bi-x-circle"></i></button>
        </span>
    `;
    document.getElementById('entidadSeleccionada').style.display = 'block';
}

function limpiarEntidad() {
    document.getElementById('idEntidad').value = '';
    document.getElementById('txtEntidad').value = '';
    document.getElementById('txtEntidad').style.display = 'block';
    document.getElementById('entidadSeleccionada').style.display = 'none';
}

// ════════════════════════════════════════
// LIMPIAR
// ════════════════════════════════════════
function limpiarFiltros() {
    document.getElementById('txtBuscar').value = '';
    limpiarProducto();
    limpiarEntidad();
    document.getElementById('cboTipo').value = 'todos';
    limpiarResultados();
}

function limpiarResultados() {
    document.getElementById('tablaBody').innerHTML = `
        <tr><td colspan="12" class="text-center py-5" style="color:var(--lago-muted);">
            <i class="bi bi-search fs-2 d-block mb-2"></i>
            Usá los filtros o presioná <kbd>F5</kbd> para buscar
        </td></tr>`;
    document.getElementById('totalArs').textContent = '$0,00';
    document.getElementById('totalUsd').textContent = 'US$0,00';
    document.getElementById('totalUnidades').textContent = '0';
    document.getElementById('totalRegistros').textContent = '0';
    document.getElementById('paginacion').innerHTML = '';
    document.getElementById('infoResultados').textContent = '';
}

// ════════════════════════════════════════
// BUSCAR
// ════════════════════════════════════════
async function buscar(offset = 0) {
    paginaActual = offset;
    const endpoint = tabActual === 'ventas' ? 'ventas' : 'compras';
    const campoEntidad = tabActual === 'ventas' ? 'id_cliente' : 'id_proveedor';

    const params = new URLSearchParams({
        q: document.getElementById('txtBuscar').value,
        fecha_desde: document.getElementById('fechaDesde').value,
        fecha_hasta: document.getElementById('fechaHasta').value,
        tipo_documento: document.getElementById('cboTipo').value,
        [campoEntidad]: document.getElementById('idEntidad').value,
        id_producto: document.getElementById('idProducto').value,
        limit: LIMITE,
        offset: offset
    });

    document.getElementById('tablaBody').innerHTML = `
        <tr><td colspan="12" class="text-center py-5">
            <div class="spinner-border" style="color:var(--lago-primary);"></div>
            <p class="mt-2 mb-0" style="color:var(--lago-muted);">Buscando...</p>
        </td></tr>`;

    try {
        const res = await fetch(`${API_URL}/historial-movimientos/${endpoint}?${params}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const json = await res.json();

        if (!json.success) throw new Error(json.error);

        datosActuales = json.data;
        renderTabla(json.data);
        renderTotales(json.totales, json.total);
        renderPaginacion(json.total, offset);

        document.getElementById('infoResultados').textContent =
            `Mostrando ${offset + 1}-${Math.min(offset + json.data.length, json.total)} de ${json.total}`;

    } catch (e) {
        console.error(e);
        document.getElementById('tablaBody').innerHTML = `
            <tr><td colspan="12" class="text-center py-4" style="color:var(--lago-danger);">
                <i class="bi bi-exclamation-triangle fs-3"></i>
                <p class="mt-2">${e.message}</p>
            </td></tr>`;
    }
}

// ════════════════════════════════════════
// RENDER TABLA
// ════════════════════════════════════════
function renderTabla(data) {
    const tbody = document.getElementById('tablaBody');
    const campoEntidad = tabActual === 'ventas' ? 'cliente' : 'proveedor';

    if (data.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="12" class="text-center py-5" style="color:var(--lago-muted);">
                <i class="bi bi-inbox fs-2 d-block mb-2"></i> Sin resultados
            </td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(r => {
        const badgeClass = r.tipo_documento === 'PEDIDO' ? 'badge-pedido' :
                           r.tipo_documento === 'FACTURA' ? 'badge-factura' : 'badge-compra';
        const dto = r.dto_item_porcentaje || r.dto_porcentaje || 0;

        return `<tr>
            <td>${formatFecha(r.fecha)}</td>
            <td>
                <span class="badge ${badgeClass}" style="font-size:0.7rem;">${r.tipo_documento}</span>
                <small class="ms-1">${r.numero_documento || ''}</small>
            </td>
            <td>${r[campoEntidad] || '-'}</td>
            <td><code>${r.codigo_producto || '-'}</code></td>
            <td>${r.producto}</td>
            <td class="text-end">${parseFloat(r.cantidad).toFixed(2)}</td>
            <td class="text-end precio-ars">${formatMoney(r.precio_unitario)}</td>
            <td class="text-end precio-usd">${formatMoneyUsd(r.precio_unitario_usd)}</td>
            <td class="text-end">${parseFloat(dto).toFixed(0)}%</td>
            <td class="text-end precio-ars"><strong>${formatMoney(r.total_item)}</strong></td>
            <td class="text-end precio-usd"><strong>${formatMoneyUsd(r.total_dolarizado)}</strong></td>
            <td class="text-center"><span class="badge badge-cotiz">${parseFloat(r.cotizacion || 1).toFixed(0)}</span></td>
        </tr>`;
    }).join('');
}

// ════════════════════════════════════════
// RENDER TOTALES + PAGINACIÓN
// ════════════════════════════════════════
function renderTotales(totales, total) {
    document.getElementById('totalArs').textContent = formatMoney(totales.ars);
    document.getElementById('totalUsd').textContent = formatMoneyUsd(totales.usd);
    document.getElementById('totalUnidades').textContent = parseFloat(totales.unidades).toFixed(2);
    document.getElementById('totalRegistros').textContent = total;
}

function renderPaginacion(total, offset) {
    const paginas = Math.ceil(total / LIMITE);
    const actual = Math.floor(offset / LIMITE);
    const container = document.getElementById('paginacion');

    if (paginas <= 1) { container.innerHTML = ''; return; }

    let html = '<nav><ul class="pagination pagination-sm">';
    if (actual > 0) {
        html += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault();buscar(${(actual - 1) * LIMITE})">«</a></li>`;
    }
    for (let i = Math.max(0, actual - 2); i < Math.min(paginas, actual + 3); i++) {
        html += `<li class="page-item ${i === actual ? 'active' : ''}"><a class="page-link" href="#" onclick="event.preventDefault();buscar(${i * LIMITE})">${i + 1}</a></li>`;
    }
    if (actual < paginas - 1) {
        html += `<li class="page-item"><a class="page-link" href="#" onclick="event.preventDefault();buscar(${(actual + 1) * LIMITE})">»</a></li>`;
    }
    html += '</ul></nav>';
    container.innerHTML = html;
}

// ════════════════════════════════════════
// EXPORT EXCEL
// ════════════════════════════════════════
async function exportarExcel() {
    const campoEntidad = tabActual === 'ventas' ? 'id_cliente' : 'id_proveedor';
    const params = new URLSearchParams({
        q: document.getElementById('txtBuscar').value,
        fecha_desde: document.getElementById('fechaDesde').value,
        fecha_hasta: document.getElementById('fechaHasta').value,
        tipo_documento: document.getElementById('cboTipo').value,
        [campoEntidad]: document.getElementById('idEntidad').value,
        id_producto: document.getElementById('idProducto').value
    });

    try {
        const res = await fetch(`${API_URL}/historial-movimientos/exportar?${params}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);

        const ws = XLSX.utils.json_to_sheet(json.data.map(r => ({
            'Fecha': r.fecha,
            'Tipo': r.tipo_documento,
            'Documento': r.numero_documento,
            'Cliente/Proveedor': r.cliente || r.proveedor,
            'Código': r.codigo_producto,
            'Producto': r.producto,
            'Cantidad': r.cantidad,
            'Precio ARS': r.precio_ars,
            'Precio USD': r.precio_usd,
            'Descuento %': r.descuento,
            'Total ARS': r.total_ars,
            'Total USD': r.total_usd,
            'Cotización': r.cotizacion
        })));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
        XLSX.writeFile(wb, `historial_${tabActual}_${new Date().toISOString().split('T')[0]}.xlsx`);

    } catch (e) {
        alert('Error al exportar: ' + e.message);
    }
}

// ════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════
function formatMoney(val) {
    return '$' + parseFloat(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoneyUsd(val) {
    return 'US$' + parseFloat(val || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatFecha(f) {
    if (!f) return '-';
    return new Date(f).toLocaleDateString('es-AR');
}
