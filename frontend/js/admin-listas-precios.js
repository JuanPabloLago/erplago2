'use strict';

const API_LP = `${window.CONFIG?.API_BASE_URL || ''}/listas-precios`;
const headers = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
});

// =====================================================
// ESTADO
// =====================================================
let listas = [];
let listaSeleccionada = null;
let preciosPagina = { precios: [], total: 0 };
let paginaActual = 0;
const LIMIT = 50;

// =====================================================
// INICIALIZACIÓN
// =====================================================
document.addEventListener('DOMContentLoaded', async () => {
    await cargarEstadisticas();
    await cargarListas();
    initShortcuts();
    initEventos();
});

function initEventos() {
    // Búsqueda de precios con debounce
    const inputBusqueda = document.getElementById('busquedaPrecios');
    if (inputBusqueda) {
        let timer;
        inputBusqueda.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => cargarPrecios(), 300);
        });
    }

    // Checkbox mostrar inactivas
    const chkInactivas = document.getElementById('chkInactivas');
    if (chkInactivas) {
        chkInactivas.addEventListener('change', () => cargarListas());
    }
}

function initShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); refrescarTodo(); }
        if (e.key === 'Insert') { e.preventDefault(); abrirModalCrear(); }
        if (e.key === 'Escape') { cerrarModales(); }
        if (e.key === 'F2') { e.preventDefault(); guardarListaActiva(); }
    });
}

// =====================================================
// ESTADÍSTICAS
// =====================================================
async function cargarEstadisticas() {
    try {
        const resp = await fetch(`${API_LP}/estadisticas`, { headers: headers() });
        const stats = await resp.json();
        setText('statListasActivas', stats.listas_activas || 0);
        setText('statListasInactivas', stats.listas_inactivas || 0);
        setText('statProductosConPrecio', formatNum(stats.productos_con_precio || 0));
        setText('statClientesConLista', stats.clientes_con_lista || 0);
    } catch (e) {
        console.error('Error stats:', e);
    }
}

// =====================================================
// LISTAS - CRUD
// =====================================================
async function cargarListas() {
    try {
        const incluir = document.getElementById('chkInactivas')?.checked ? 'true' : 'false';
        const resp = await fetch(`${API_LP}?incluir_inactivas=${incluir}`, { headers: headers() });
        listas = await resp.json();
        renderTablaListas();
    } catch (e) {
        console.error('Error cargar listas:', e);
        mostrarToast('Error al cargar listas', 'error');
    }
}

function renderTablaListas() {
    const tbody = document.getElementById('tbodyListas');
    if (!tbody) return;
    if (!listas.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No hay listas de precios</td></tr>';
        return;
    }
    tbody.innerHTML = listas.map(l => `
        <tr class="${!l.activa ? 'table-secondary' : ''} ${listaSeleccionada?.id_lista_precio === l.id_lista_precio ? 'table-active' : ''}"
            style="cursor:pointer" onclick="seleccionarLista(${l.id_lista_precio})">
            <td><strong>${esc(l.nombre)}</strong></td>
            <td>${l.porcentaje_sobre_base !== null ? `${l.porcentaje_sobre_base > 0 ? '+' : ''}${l.porcentaje_sobre_base}%` : '<span class="badge bg-success">BASE</span>'}</td>
            <td>${l.lista_base_nombre || '—'}</td>
            <td class="text-end">${formatNum(l.cant_productos)}</td>
            <td class="text-end">${l.cant_clientes}</td>
            <td>${l.redondeo_activo ? '<span class="text-success">Sí</span>' : '<span class="text-muted">No</span>'}</td>
            <td>${l.activa ? '<span class="badge bg-success">Activa</span>' : '<span class="badge bg-secondary">Inactiva</span>'}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); abrirModalEditar(${l.id_lista_precio})" title="Editar">
                    <i class="bi bi-pencil"></i>
                </button>
                ${l.activa
                    ? `<button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); toggleEstado(${l.id_lista_precio}, false)" title="Desactivar">
                        <i class="bi bi-x-circle"></i>
                       </button>`
                    : `<button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); toggleEstado(${l.id_lista_precio}, true)" title="Activar">
                        <i class="bi bi-check-circle"></i>
                       </button>`
                }
            </td>
        </tr>
    `).join('');
}

async function seleccionarLista(id) {
    listaSeleccionada = listas.find(l => l.id_lista_precio === id) || null;
    renderTablaListas();
    const panelPrecios = document.getElementById('panelPrecios');
    if (panelPrecios) panelPrecios.style.display = listaSeleccionada ? 'block' : 'none';
    document.getElementById('nombreListaSeleccionada').textContent = listaSeleccionada?.nombre || '';
    if (listaSeleccionada) {
        paginaActual = 0;
        await cargarPrecios();
        await cargarClientesLista();
    }
}

function abrirModalCrear() {
    document.getElementById('modalListaTitulo').textContent = 'Nueva Lista de Precios';
    document.getElementById('formLista').reset();
    document.getElementById('formListaId').value = '';
    cargarSelectListasBase();
    new bootstrap.Modal(document.getElementById('modalLista')).show();
    setTimeout(() => document.getElementById('inputNombreLista').focus(), 300);
}

async function abrirModalEditar(id) {
    try {
        const resp = await fetch(`${API_LP}/${id}`, { headers: headers() });
        const lista = await resp.json();
        document.getElementById('modalListaTitulo').textContent = 'Editar Lista de Precios';
        document.getElementById('formListaId').value = lista.id_lista_precio;
        document.getElementById('inputNombreLista').value = lista.nombre;
        document.getElementById('inputDescripcion').value = lista.descripcion || '';
        document.getElementById('inputPorcentaje').value = lista.porcentaje_sobre_base || '';
        document.getElementById('chkRedondeo').checked = lista.redondeo_activo;
        document.getElementById('inputOrden').value = lista.orden || '';
        document.getElementById('inputMargenCosto').value = lista.margen_sobre_costo || '';
        await cargarSelectListasBase(lista.id_lista_precio);
        document.getElementById('selectListaBase').value = lista.id_lista_base || '';
        new bootstrap.Modal(document.getElementById('modalLista')).show();
    } catch (e) {
        mostrarToast('Error al cargar lista', 'error');
    }
}

function cargarSelectListasBase(excluirId) {
    const sel = document.getElementById('selectListaBase');
    sel.innerHTML = '<option value="">— Sin lista base (es lista principal) —</option>';
    listas.filter(l => l.activa && l.id_lista_precio !== excluirId).forEach(l => {
        sel.innerHTML += `<option value="${l.id_lista_precio}">${esc(l.nombre)}</option>`;
    });
}

async function guardarLista() {
    const id = document.getElementById('formListaId').value;
    const body = {
        nombre: document.getElementById('inputNombreLista').value.trim(),
        descripcion: document.getElementById('inputDescripcion').value.trim(),
        porcentaje_sobre_base: parseFloat(document.getElementById('inputPorcentaje').value) || null,
        id_lista_base: parseInt(document.getElementById('selectListaBase').value) || null,
        redondeo_activo: document.getElementById('chkRedondeo').checked,
        orden: parseInt(document.getElementById('inputOrden').value) || null,
        tipo_calculo: 'MANUAL',
        margen_sobre_costo: parseFloat(document.getElementById('inputMargenCosto').value) || null
    };
    if (!body.nombre) { mostrarToast('El nombre es obligatorio', 'warning'); return; }

    try {
        const url = id ? `${API_LP}/${id}` : API_LP;
        const method = id ? 'PUT' : 'POST';
        const resp = await fetch(url, { method, headers: headers(), body: JSON.stringify(body) });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        bootstrap.Modal.getInstance(document.getElementById('modalLista'))?.hide();
        mostrarToast(id ? 'Lista actualizada' : 'Lista creada', 'success');
        await refrescarTodo();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

function guardarListaActiva() {
    const modal = document.getElementById('modalLista');
    if (modal.classList.contains('show')) guardarLista();
}

async function toggleEstado(id, activar) {
    const lista = listas.find(l => l.id_lista_precio === id);
    const accion = activar ? 'activar' : 'desactivar';
    if (!confirm(`¿${activar ? 'Activar' : 'Desactivar'} "${lista?.nombre}"?`)) return;
    try {
        const resp = await fetch(`${API_LP}/${id}/${accion}`, { method: 'PUT', headers: headers() });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        mostrarToast(data.mensaje, 'success');
        await refrescarTodo();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

// =====================================================
// PRECIOS
// =====================================================
async function cargarPrecios() {
    if (!listaSeleccionada) return;
    const busqueda = document.getElementById('busquedaPrecios')?.value || '';
    try {
        const resp = await fetch(
            `${API_LP}/${listaSeleccionada.id_lista_precio}/precios?busqueda=${encodeURIComponent(busqueda)}&limit=${LIMIT}&offset=${paginaActual * LIMIT}`,
            { headers: headers() }
        );
        preciosPagina = await resp.json();
        renderTablaPrecios();
    } catch (e) {
        console.error('Error cargar precios:', e);
    }
}

function renderTablaPrecios() {
    const tbody = document.getElementById('tbodyPrecios');
    if (!tbody) return;
    if (!preciosPagina.precios.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Sin resultados</td></tr>';
        return;
    }
    tbody.innerHTML = preciosPagina.precios.map(p => {
        const diff = p.precio_base > 0 ? (((p.precio / p.precio_base) - 1) * 100).toFixed(1) : null;
        return `
        <tr>
            <td><code>${esc(p.sku || '')}</code></td>
            <td>${esc(p.nombre)}</td>
            <td class="text-muted">${esc(p.categoria || '')}</td>
            <td class="text-end">${p.precio_base > 0 ? '$' + formatNum(p.precio_base) : '—'}</td>
            <td class="text-end">
                <input type="number" class="form-control form-control-sm text-end d-inline-block"
                    style="width:120px" value="${p.precio}" min="0" step="1"
                    data-id="${p.id_producto}" data-original="${p.precio}"
                    onchange="marcarCambiado(this)">
            </td>
            <td class="text-end">${diff !== null ? `<small class="${parseFloat(diff) < 0 ? 'text-danger' : 'text-success'}">${diff > 0 ? '+' : ''}${diff}%</small>` : ''}</td>
        </tr>`;
    }).join('');

    // Paginación
    const totalPages = Math.ceil(preciosPagina.total / LIMIT);
    document.getElementById('infoPagina').textContent = `Página ${paginaActual + 1} de ${totalPages} (${formatNum(preciosPagina.total)} productos)`;
    document.getElementById('btnPrevPag').disabled = paginaActual === 0;
    document.getElementById('btnNextPag').disabled = paginaActual >= totalPages - 1;
}

function marcarCambiado(input) {
    if (parseFloat(input.value) !== parseFloat(input.dataset.original)) {
        input.classList.add('border-warning');
    } else {
        input.classList.remove('border-warning');
    }
}

async function guardarPreciosCambiados() {
    const inputs = document.querySelectorAll('#tbodyPrecios input.border-warning');
    if (!inputs.length) { mostrarToast('No hay cambios pendientes', 'info'); return; }

    const precios = Array.from(inputs).map(i => ({
        id_producto: parseInt(i.dataset.id),
        precio: parseFloat(i.value)
    }));

    try {
        const resp = await fetch(`${API_LP}/${listaSeleccionada.id_lista_precio}/precios/masivo`, {
            method: 'PUT', headers: headers(), body: JSON.stringify({ precios })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        mostrarToast(`${data.actualizados} precios actualizados`, 'success');
        inputs.forEach(i => { i.dataset.original = i.value; i.classList.remove('border-warning'); });
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

function cambiarPagina(dir) {
    paginaActual += dir;
    if (paginaActual < 0) paginaActual = 0;
    cargarPrecios();
}

// =====================================================
// ACCIONES MASIVAS
// =====================================================
async function ejecutarRecalculo() {
    if (!listaSeleccionada) return;
    if (!listaSeleccionada.id_lista_base) {
        mostrarToast('Esta lista no tiene lista base configurada', 'warning');
        return;
    }
    if (!confirm(`¿Recalcular "${listaSeleccionada.nombre}" desde su lista base (${listaSeleccionada.porcentaje_sobre_base > 0 ? '+' : ''}${listaSeleccionada.porcentaje_sobre_base}%)?`)) return;
    try {
        const resp = await fetch(`${API_LP}/${listaSeleccionada.id_lista_precio}/recalcular`, { method: 'POST', headers: headers() });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        mostrarToast(data.mensaje, 'success');
        await cargarPrecios();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

async function ejecutarRedondeo() {
    if (!listaSeleccionada) return;
    if (!confirm(`¿Aplicar redondeo argentino a TODOS los precios de "${listaSeleccionada.nombre}"?`)) return;
    try {
        const resp = await fetch(`${API_LP}/${listaSeleccionada.id_lista_precio}/redondear`, { method: 'POST', headers: headers() });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        mostrarToast(data.mensaje, 'success');
        await cargarPrecios();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

function abrirModalAjuste() {
    if (!listaSeleccionada) return;
    document.getElementById('inputAjustePct').value = '';
    document.getElementById('chkAjusteRedondeo').checked = true;
    document.getElementById('ajusteNombreLista').textContent = listaSeleccionada.nombre;
    new bootstrap.Modal(document.getElementById('modalAjuste')).show();
    setTimeout(() => document.getElementById('inputAjustePct').focus(), 300);
}

async function ejecutarAjustePorcentaje() {
    const pct = parseFloat(document.getElementById('inputAjustePct').value);
    if (isNaN(pct) || pct === 0) { mostrarToast('Ingrese un porcentaje válido', 'warning'); return; }
    const redondeo = document.getElementById('chkAjusteRedondeo').checked;
    if (!confirm(`¿Ajustar ${pct > 0 ? '+' : ''}${pct}% a "${listaSeleccionada.nombre}"?`)) return;

    try {
        const resp = await fetch(`${API_LP}/${listaSeleccionada.id_lista_precio}/ajustar-porcentaje`, {
            method: 'POST', headers: headers(), body: JSON.stringify({ porcentaje: pct, aplicar_redondeo: redondeo })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        bootstrap.Modal.getInstance(document.getElementById('modalAjuste'))?.hide();
        mostrarToast(data.mensaje, 'success');
        await cargarPrecios();
    } catch (e) {
        mostrarToast(e.message, 'error');
    }
}

// =====================================================
// CLIENTES
// =====================================================
async function cargarClientesLista() {
    if (!listaSeleccionada) return;
    try {
        const resp = await fetch(`${API_LP}/${listaSeleccionada.id_lista_precio}/clientes`, { headers: headers() });
        const clientes = await resp.json();
        const container = document.getElementById('listaClientes');
        if (!container) return;
        if (!clientes.length) {
            container.innerHTML = '<p class="text-muted">Ningún cliente asignado a esta lista</p>';
            return;
        }
        container.innerHTML = `
            <div class="table-responsive" style="max-height:200px; overflow-y:auto">
                <table class="table table-sm table-hover mb-0">
                    <tbody>
                        ${clientes.map(c => `
                            <tr>
                                <td>${esc(c.razon_social)}</td>
                                <td class="text-muted">${esc(c.cuit_cuil || '')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <small class="text-muted">${clientes.length} clientes</small>
        `;
    } catch (e) {
        console.error('Error cargar clientes:', e);
    }
}

// =====================================================
// UTILIDADES
// =====================================================
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function formatNum(n) { return Number(n).toLocaleString('es-AR'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function mostrarToast(msg, tipo = 'info') {
    const container = document.getElementById('toastContainer') || document.body;
    const colors = { success: '#198754', error: '#dc3545', warning: '#ffc107', info: '#0d6efd' };
    const div = document.createElement('div');
    div.className = 'position-fixed bottom-0 end-0 p-3';
    div.style.zIndex = 9999;
    div.innerHTML = `
        <div class="toast show align-items-center text-white border-0" style="background:${colors[tipo] || colors.info}" role="alert">
            <div class="d-flex">
                <div class="toast-body">${esc(msg)}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        </div>
    `;
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
}

function cerrarModales() {
    document.querySelectorAll('.modal.show').forEach(m => bootstrap.Modal.getInstance(m)?.hide());
}

async function refrescarTodo() {
    await cargarEstadisticas();
    await cargarListas();
    if (listaSeleccionada) {
        await cargarPrecios();
        await cargarClientesLista();
    }
    mostrarToast('Datos actualizados', 'success');
}
