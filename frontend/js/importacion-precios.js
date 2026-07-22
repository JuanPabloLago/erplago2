/**
 * importacion-precios.js — Frontend importador de listas de proveedor
 * Flujo: Seleccionar proveedor + Excel → Preview → Aplicar
 */
'use strict';

const API_BASE = window.CONFIG?.API_BASE_URL || '/api';
let Estado = {
    proveedores: [],
    listas: [],
    previewData: null,
    filtroActual: 'todos'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
    await cargarFormData();
    await cargarHistorialReciente();
    document.getElementById('selProveedor').addEventListener('change', onProveedorChange);
    document.getElementById('inputArchivo').addEventListener('change', onArchivoChange);
}

async function fetchAPI(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...(options.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!(options.body instanceof FormData) && options.body) {
        headers['Content-Type'] = 'application/json';
    }
    const resp = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Error de servidor' }));
        throw new Error(err.error || `Error ${resp.status}`);
    }
    return resp.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 1: Seleccionar
// ═══════════════════════════════════════════════════════════════════════════

async function cargarFormData() {
    try {
        const data = await fetchAPI('/importacion-precios/form-data');
        Estado.proveedores = data.proveedores || [];
        Estado.listas = data.listas || [];
        const sel = document.getElementById('selProveedor');
        Estado.proveedores.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id_proveedor;
            opt.textContent = `${p.razon_social} (${p.productos_vinculados} productos)`;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('Error cargando form-data:', err);
    }
}

function onProveedorChange() {
    const id = parseInt(this.value);
    const prov = Estado.proveedores.find(p => p.id_proveedor === id);
    document.getElementById('descuentoGeneral').value = prov ? prov.descuento_general : 0;
    document.getElementById('prodsVinculados').value = prov ? prov.productos_vinculados : '—';
    document.getElementById('inputArchivo').disabled = !id;
    document.getElementById('btnSubir').disabled = true;
    document.getElementById('inputArchivo').value = '';
}

async function guardarDescuento() {
    const id_proveedor = document.getElementById('selProveedor').value;
    if (!id_proveedor) return;
    const descuento = parseFloat(document.getElementById('descuentoGeneral').value) || 0;
    try {
        await fetchAPI('/importacion-precios/guardar-descuento', {
            method: 'POST',
            body: JSON.stringify({ id_proveedor: parseInt(id_proveedor), descuento_general: descuento })
        });
        // Actualizar en estado local
        const prov = Estado.proveedores.find(p => p.id_proveedor === parseInt(id_proveedor));
        if (prov) prov.descuento_general = descuento;
    } catch (err) {
        console.error('Error guardando descuento:', err);
    }
}

function onArchivoChange() {
    document.getElementById('btnSubir').disabled = !this.files.length;
}

async function subirArchivo() {
    const id_proveedor = document.getElementById('selProveedor').value;
    const archivo = document.getElementById('inputArchivo').files[0];
    if (!id_proveedor || !archivo) return;

    const loading = document.getElementById('loadingUpload');
    const btn = document.getElementById('btnSubir');
    loading.classList.add('visible');
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('archivo', archivo);
        formData.append('id_proveedor', id_proveedor);

        const data = await fetchAPI('/importacion-precios/upload', { method: 'POST', body: formData });
        Estado.previewData = data;
        mostrarPreview(data);
        irPaso(2);
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        loading.classList.remove('visible');
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2: Preview
// ═══════════════════════════════════════════════════════════════════════════

function mostrarPreview(data) {
    document.getElementById('previewArchivo').textContent = data.archivo;

    // Metrics
    const mc = document.getElementById('metricsPreview');
    mc.innerHTML = `
        <div class="metric success"><div class="value">${data.resumen.con_cambio}</div><div class="label">Con cambio</div></div>
        <div class="metric"><div class="value">${data.resumen.sin_cambio}</div><div class="label">Sin cambio</div></div>
        <div class="metric ${data.resumen.no_encontradas > 0 ? 'danger' : ''}"><div class="value">${data.resumen.no_encontradas}</div><div class="label">No encontrados</div></div>
        <div class="metric"><div class="value">${data.filas_validas}</div><div class="label">Filas Excel</div></div>
        <div class="metric"><div class="value">${data.descuento_general_usado}%</div><div class="label">Dto. general</div></div>
    `;

    renderTablaPreview(data, 'todos');
}

function filtrarPreview(filtro) {
    Estado.filtroActual = filtro;
    if (Estado.previewData) renderTablaPreview(Estado.previewData, filtro);
}

function renderTablaPreview(data, filtro) {
    const tbody = document.getElementById('tbodyPreview');
    let filas = [];

    // Matcheadas
    for (const m of data.matcheadas) {
        if (filtro === 'cambio' && !m.hay_cambio) continue;
        if (filtro === 'no_encontrado') continue;
        filas.push(`<tr class="${m.hay_cambio ? 'row-cambio' : 'row-sin-cambio'}">
            <td>${esc(m.codigo)}</td>
            <td>${esc(m.sku || '')}</td>
            <td>${esc(m.nombre_producto || m.descripcion)}</td>
            <td style="text-align:right">${fmt(m.precio_compra_anterior)}</td>
            <td style="text-align:right;font-weight:600">${fmt(m.precio)}</td>
            <td style="text-align:right">${m.descuento}%</td>
            <td style="text-align:right">${fmt(m.precio_neto_anterior)}</td>
            <td style="text-align:right;font-weight:600">${fmt(m.precio_neto_nuevo)}</td>
            <td style="text-align:right">${formatVariacion(m.variacion_pct)}</td>
            <td>${m.hay_cambio ? '<span class="badge-cambio">Cambio</span>' : '<span class="badge-sin-cambio">Sin cambio</span>'}</td>
        </tr>`);
    }

    // No encontradas
    if (filtro === 'todos' || filtro === 'no_encontrado') {
        for (const ne of data.no_encontradas) {
            filas.push(`<tr class="row-no-encontrado">
                <td>${esc(ne.codigo)}</td>
                <td>—</td>
                <td>${esc(ne.descripcion)}</td>
                <td style="text-align:right">—</td>
                <td style="text-align:right">${fmt(ne.precio)}</td>
                <td style="text-align:right">${ne.descuento}%</td>
                <td style="text-align:right">—</td>
                <td style="text-align:right">${fmt(ne.precio_neto_nuevo)}</td>
                <td style="text-align:right">—</td>
                <td><span class="badge-no-encontrado">No encontrado</span></td>
            </tr>`);
        }
    }

    tbody.innerHTML = filas.join('');
}

function formatVariacion(v) {
    if (v === null || v === undefined) return '—';
    const cls = v > 0 ? 'variacion-pos' : v < 0 ? 'variacion-neg' : '';
    const signo = v > 0 ? '+' : '';
    return `<span class="${cls}">${signo}${v.toFixed(1)}%</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 3: Aplicar
// ═══════════════════════════════════════════════════════════════════════════

async function aplicarImportacion() {
    if (!Estado.previewData) return;
    if (!confirm('¿Confirmar importación? Se actualizarán los costos de los productos con cambio.')) return;

    const loading = document.getElementById('loadingAplicar');
    const btn = document.getElementById('btnAplicar');
    loading.classList.add('visible');
    btn.disabled = true;

    try {
        const data = await fetchAPI('/importacion-precios/aplicar', {
            method: 'POST',
            body: JSON.stringify({
                id_proveedor: parseInt(document.getElementById('selProveedor').value),
                matcheadas: Estado.previewData.matcheadas,
                no_encontradas: Estado.previewData.no_encontradas,
                descuento_general_usado: Estado.previewData.descuento_general_usado,
                archivo_nombre: Estado.previewData.archivo,
                recalcular_listas: document.getElementById('chkRecalcular').checked
            })
        });

        mostrarResultado(data);
        irPaso(3);
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        loading.classList.remove('visible');
        btn.disabled = false;
    }
}

function mostrarResultado(data) {
    const c = document.getElementById('resultadoContainer');
    let html = `<div class="resultado-box ok">
        <h3><i class="bi bi-check-circle"></i> Importación completada</h3>
        <p><strong>${data.importacion.actualizados}</strong> productos actualizados</p>
        <p>${data.importacion.sin_cambio} sin cambio · ${data.importacion.no_encontrados} no encontrados</p>
        <p style="font-size:.75rem;color:var(--text-muted)">Importación #${data.importacion.id_importacion}</p>
    </div>`;

    if (data.recalculo && data.recalculo.length > 0) {
        html += `<div class="lago-card" style="margin-top:10px">
            <div class="lago-card-header"><i class="bi bi-calculator"></i> Listas recalculadas</div>
            <div class="lago-card-body">`;
        for (const r of data.recalculo) {
            html += `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0;font-size:.82rem">
                <span><strong>${esc(r.nombre)}</strong> (margen ${r.margen}%)</span>
                <span>${r.actualizados} actualizados, ${r.insertados} nuevos</span>
            </div>`;
        }
        html += '</div></div>';
    }

    c.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORIAL
// ═══════════════════════════════════════════════════════════════════════════

async function cargarHistorialReciente() {
    try {
        const data = await fetchAPI('/importacion-precios/historial');
        if (!data.length) return;
        const card = document.getElementById('cardHistorial');
        card.style.display = 'block';
        const container = document.getElementById('historialContainer');
        container.innerHTML = data.slice(0, 5).map(h => `
            <div class="historial-item">
                <div>
                    <strong>${esc(h.proveedor)}</strong>
                    <span style="color:var(--text-muted);margin-left:8px">${esc(h.archivo_nombre || 'Sin archivo')}</span>
                </div>
                <div style="display:flex;gap:12px;align-items:center">
                    <span class="badge-cambio">${h.productos_actualizados} actualiz.</span>
                    ${h.productos_no_encontrados > 0 ? `<span class="badge-no-encontrado">${h.productos_no_encontrados} no enc.</span>` : ''}
                    <span style="color:var(--text-muted);font-size:.72rem">${new Date(h.fecha).toLocaleDateString('es-AR')}</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error cargando historial:', err);
    }
}

function mostrarHistorial() {
    document.getElementById('cardHistorial').style.display = 'block';
    irPaso(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// NAVEGACIÓN + UTILS
// ═══════════════════════════════════════════════════════════════════════════

function irPaso(n) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById(`step-${n}`).classList.add('active');
    document.querySelectorAll('.step-pill').forEach((p, i) => {
        p.classList.remove('active', 'done');
        if (i + 1 === n) p.classList.add('active');
        else if (i + 1 < n) p.classList.add('done');
    });
    if (n === 1) {
        Estado.previewData = null;
        document.getElementById('inputArchivo').value = '';
    }
}

function fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return parseFloat(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}
