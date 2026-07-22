'use strict';
// =============================================================================
//   NOTAS.JS v3.0 — ERP LAGO
//   Pestañas + Formulario estilo venta-rápida
//   Backend: notas.helper.js + notas.controller.js (SIN CAMBIOS)
//   Atajos: F2=guardar, F3=cliente, F5=refresh, Ins=nueva, Esc=cerrar
// =============================================================================

const API_BASE = window.CONFIG?.API_BASE_URL || '';

// ─── Idempotencia (F3, 2026-05-10) ───────────────────────────────────────────
function generarIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// ─── Estado ──────────────────────────────────────────────────────────────────
let paginaActual = 0;
const LIMIT = 50;
let buscadorFiltro = null;
let buscadorForm = null;

const nota = {
    tipo: '', origen: '', id_cliente: null, cliente_nombre: '',
    letra: '', punto_venta: null,
    id_factura_origen: null, id_presupuesto_origen: null,
    requiere_afip: false, items: [], nextItemId: 0,
    idempotency_key: null,
    id_pedido_vinculado: null,
    total_pagado_pedido: 0,
    total_exigible_actual: 0,
    forma_devolucion: null,
};
let metodosPagoCache = [];

let resultadosBusqueda = [];
let indiceSel = -1;
let timerBusqueda = null;

// ─── Auth ────────────────────────────────────────────────────────────────────
function authHeaders(json = false) {
    const h = { Authorization: `Bearer ${localStorage.getItem('authToken')}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

// =============================================================================
//   INIT
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacion?.();

    buscadorFiltro = new BuscadorClientes({
        container: '#buscadorClienteFiltro',
        placeholder: 'F3 · Filtrar por cliente...',
        showSaldo: true,
        onSelect: () => { paginaActual = 0; cargarNotas(); },
        onClear: () => { paginaActual = 0; cargarNotas(); },
    });

    document.getElementById('filtroTipo')?.addEventListener('change', () => { paginaActual = 0; cargarNotas(); });
    let tBusq;
    const ft = document.getElementById('filtroTexto');
    if (ft) {
        ft.addEventListener('input', () => { clearTimeout(tBusq); tBusq = setTimeout(() => { paginaActual = 0; cargarNotas(); }, 400); });
        ft.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); paginaActual = 0; cargarNotas(); } });
    }

    registrarAtajos();
    cargarNotas();
    detectarQueryParams();
});

// =============================================================================
//   ATAJOS DE TECLADO
// =============================================================================
function registrarAtajos() {
    document.addEventListener('keydown', e => {
        if (e.key === 'F2') { e.preventDefault(); if (tabActiva() === 'nueva') guardarNota(); }
        if (e.key === 'F3') { e.preventDefault(); if (tabActiva() === 'nueva') buscadorForm?.focus?.(); else buscadorFiltro?.focus?.(); }
        if (e.key === 'F5') { e.preventDefault(); if (tabActiva() === 'listado') cargarNotas(); }
        if (e.key === 'Insert') { e.preventDefault(); irANueva(); }
        if (e.key === 'Escape') {
            const det = document.getElementById('modalDetalle');
            if (det?.classList.contains('show')) bootstrap.Modal.getInstance(det)?.hide();
            else if (tabActiva() === 'nueva') irAListado();
        }
    });
}

// =============================================================================
//   PESTAÑAS
// =============================================================================
function tabActiva() {
    return document.getElementById('panelNueva')?.style.display !== 'none' ? 'nueva' : 'listado';
}

function irANueva() {
    document.getElementById('tabBtnListado')?.classList.remove('active');
    document.getElementById('tabBtnNueva')?.classList.add('active');
    document.getElementById('panelListado').style.display = 'none';
    document.getElementById('panelNueva').style.display = '';
    resetFormulario();                          // siempre arrancar limpio
    nota.idempotency_key = generarIdempotencyKey();
    setTimeout(() => document.getElementById('inputBuscarProducto')?.focus(), 100);
}

function irAListado() {
    document.getElementById('tabBtnNueva')?.classList.remove('active');
    document.getElementById('tabBtnListado')?.classList.add('active');
    document.getElementById('panelNueva').style.display = 'none';
    document.getElementById('panelListado').style.display = '';
    cargarNotas();
}

// =============================================================================
//   QUERY PARAMS — Viene de ver-factura / ver-presupuesto
// =============================================================================
function detectarQueryParams() {
    const p = new URLSearchParams(window.location.search);
    const tipo = p.get('tipo'), origen = p.get('origen'), id = p.get('id');
    if (tipo && origen && id) {
        irANueva();                             // primero panel + reset
        selTipo(tipo);                          // ahora sí setear tipo/origen
        selOrigen(origen);
        setTimeout(() => cargarComprobanteOrigen(parseInt(id)), 300);
        window.history.replaceState({}, '', window.location.pathname);
    }
}

// =============================================================================
//   LISTADO
// =============================================================================
async function cargarNotas() {
    const tbody = document.getElementById('tablaNotas');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-3"><div class="spinner-border spinner-border-sm text-success"></div></td></tr>';
    try {
        const p = new URLSearchParams({ limit: LIMIT, offset: paginaActual * LIMIT });
        const tipo = document.getElementById('filtroTipo')?.value;
        const busqueda = document.getElementById('filtroTexto')?.value;
        const idCli = buscadorFiltro?.getClienteId();
        if (tipo) p.append('tipo', tipo);
        if (busqueda) p.append('busqueda', busqueda);
        if (idCli) p.append('id_cliente', idCli);
        const res = await fetch(`${API_BASE}/notas?${p}`, { headers: authHeaders() });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        const result = await res.json();
        renderNotas(result.data || []);
        renderMetricas(result.data || []);
        renderPaginacion(result.total || 0);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-3">${err.message}</td></tr>`;
    }
}

function renderNotas(notas) {
    const tbody = document.getElementById('tablaNotas');
    if (!notas.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="bi bi-inbox" style="font-size:20px"></i><br><small>Sin notas</small></td></tr>';
        return;
    }
    tbody.innerHTML = notas.map(n => {
        const esNC = n.tipo_nota === 'credito';
        const fecha = n.fecha_emision ? new Date(n.fecha_emision).toLocaleDateString('es-AR') : '-';
        const origenTxt = n.factura_origen_numero || n.presupuesto_origen_numero || 'Manual';
        const origenPfx = n.id_factura_origen ? 'F:' : n.id_presupuesto_origen ? 'P:' : '';
        const motivo = (n.motivo || '').length > 35 ? n.motivo.substring(0, 35) + '…' : (n.motivo || '-');
        const total = parseFloat(n.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
        const cae = n.cae ? ' <span class="badge bg-success" style="font-size:9px">CAE</span>' : '';
        const est = n.estado === 'anulada' ? '<span class="badge bg-danger">ANULADA</span>' : '<span class="badge bg-success">ACTIVA</span>';
        return `<tr ondblclick="verDetalle(${n.id_nota})" style="cursor:pointer;border-left:3px solid ${esNC ? '#28a745' : '#ffc107'}">
            <td><span class="badge ${esNC ? 'bg-success' : 'bg-warning text-dark'}" style="font-size:10px">${esNC ? 'NC' : 'ND'}</span></td>
            <td style="font-family:monospace;font-size:12px"><strong>${n.numero_completo || '-'}</strong>${cae}</td>
            <td>${fecha}</td>
            <td>${n.cliente_nombre || '-'}</td>
            <td style="font-family:monospace;font-size:11px;color:#666">${origenPfx}${origenTxt}</td>
            <td title="${n.motivo || ''}">${motivo}</td>
            <td style="text-align:right;font-family:monospace;font-weight:700">$${total}</td>
            <td class="text-center">${est}</td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="event.stopPropagation();verDetalle(${n.id_nota})"><i class="bi bi-eye"></i></button>
                ${n.estado !== 'anulada' ? `<button class="btn btn-sm btn-outline-danger py-0 px-1" onclick="event.stopPropagation();confirmarAnular(${n.id_nota},'${(n.numero_completo || '').replace(/'/g, "\\'")}',${!!n.cae})"><i class="bi bi-x-circle"></i></button>` : ''}
            </td></tr>`;
    }).join('');
}

function renderMetricas(notas) {
    const nc = notas.filter(n => n.tipo_nota === 'credito');
    const nd = notas.filter(n => n.tipo_nota === 'debito');
    const sumNC = nc.reduce((s, n) => s + parseFloat(n.total || 0), 0);
    const sumND = nd.reduce((s, n) => s + parseFloat(n.total || 0), 0);
    const s = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    s('mNC', nc.length); s('mNCSub', '$' + sumNC.toLocaleString('es-AR', { minimumFractionDigits: 0 }));
    s('mND', nd.length); s('mNDSub', '$' + sumND.toLocaleString('es-AR', { minimumFractionDigits: 0 }));
    s('mTot', notas.length); s('mTotSub', '$' + (sumNC + sumND).toLocaleString('es-AR', { minimumFractionDigits: 0 }));
    s('mCae', notas.filter(n => n.cae && n.estado !== 'anulada').length);
}

function renderPaginacion(total) {
    const c = document.getElementById('paginacion');
    if (!c) return;
    if (total <= LIMIT) { c.innerHTML = ''; return; }
    const tp = Math.ceil(total / LIMIT);
    c.innerHTML = `<div class="d-flex justify-content-between align-items-center mt-1"><small class="text-muted">${paginaActual * LIMIT + 1}–${Math.min((paginaActual + 1) * LIMIT, total)} de ${total}</small><div>
        ${paginaActual > 0 ? `<button class="btn btn-sm btn-outline-success me-1" onclick="paginaActual--;cargarNotas()">◀</button>` : ''}
        ${paginaActual < tp - 1 ? `<button class="btn btn-sm btn-outline-success" onclick="paginaActual++;cargarNotas()">▶</button>` : ''}
    </div></div>`;
}

// =============================================================================
//   FORMULARIO — Reset / Tipo / Origen
// =============================================================================
function resetFormulario() {
    Object.assign(nota, { tipo: '', origen: '', id_cliente: null, cliente_nombre: '', letra: '', punto_venta: null, id_factura_origen: null, id_presupuesto_origen: null, requiere_afip: false, items: [], nextItemId: 0, devuelve_stock: true, idempotency_key: generarIdempotencyKey(), id_pedido_vinculado: null, total_pagado_pedido: 0, total_exigible_actual: 0, forma_devolucion: null });
    document.getElementById('bloqueDevolucion')?.remove();
    document.getElementById('secDevuelveStock').style.display = 'none';
    document.getElementById('badgeDeposito').style.display = 'none';
    document.querySelectorAll('.btn-tipo').forEach(b => { b.className = 'btn btn-sm btn-outline-secondary btn-tipo'; });
    document.querySelectorAll('.btn-origen').forEach(b => { b.className = 'btn btn-sm btn-outline-secondary btn-origen'; b.disabled = true; });
    document.getElementById('secComprobante').style.display = 'none';
    document.getElementById('comprobanteInfo').innerHTML = '';
    document.getElementById('comprobantesLista').innerHTML = '';
    document.getElementById('itemsBody').innerHTML = sinItemsHTML();
    document.getElementById('inputMotivo').value = '';
    document.getElementById('inputObs').value = '';
    document.getElementById('inputPV').value = '1';
    document.getElementById('badgeAfip').style.display = 'none';
    document.getElementById('inputBuscarProducto').value = '';
    document.getElementById('sugerenciasNota').innerHTML = '';
    recalcularTotales();
    setTimeout(() => {
        buscadorForm?.destroy?.();
        buscadorForm = new BuscadorClientes({
            container: '#buscadorClienteForm', placeholder: 'F3 · Buscar cliente...', showSaldo: true,
            onSelect: (cli) => { nota.id_cliente = cli.id_cliente; nota.cliente_nombre = cli.razon_social; if (nota.origen && nota.origen !== 'manual') cargarComprobantesCliente(cli.id_cliente); },
            onClear: () => { nota.id_cliente = null; nota.cliente_nombre = ''; document.getElementById('comprobantesLista').innerHTML = ''; },
        });
    }, 100);
    cargarPVDefault();
}

function selTipo(tipo) {
    nota.tipo = tipo;
    document.querySelectorAll('.btn-tipo').forEach(b => {
        b.className = 'btn btn-sm btn-tipo ' + (b.dataset.tipo === tipo ? (tipo === 'credito' ? 'btn-success active' : 'btn-warning active') : 'btn-outline-secondary');
    });
    document.querySelectorAll('.btn-origen').forEach(b => b.disabled = false);
    const t = document.getElementById('tituloForm');
    if (t) t.textContent = tipo === 'credito' ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO';
}

function selOrigen(origen) {
    nota.origen = origen;
    nota.id_factura_origen = null;
    nota.id_presupuesto_origen = null;
    nota.requiere_afip = (origen === 'factura');
    document.querySelectorAll('.btn-origen').forEach(b => {
        b.className = 'btn btn-sm btn-origen ' + (b.dataset.origen === origen ? 'btn-primary active' : 'btn-outline-secondary');
    });
    const sec = document.getElementById('secComprobante');
    const lbl = document.getElementById('lblComprobante');
    if (origen === 'factura' || origen === 'presupuesto' || origen === 'pedido') {
        sec.style.display = '';
        lbl.textContent = origen === 'factura' ? 'Factura de origen'
                        : origen === 'presupuesto' ? 'Presupuesto de origen'
                        : 'Pedido de origen';
        if (nota.id_cliente) cargarComprobantesCliente(nota.id_cliente);
    } else {
        sec.style.display = 'none';
    }
    const badge = document.getElementById('badgeAfip');
    badge.style.display = '';
    if (origen === 'factura') {
        badge.className = 'alert alert-success py-1 px-2 mb-0 small';
        badge.innerHTML = '<i class="bi bi-patch-check-fill"></i> <strong>AFIP</strong> — Se solicitará CAE al confirmar';
    } else {
        badge.className = 'alert alert-secondary py-1 px-2 mb-0 small';
        badge.innerHTML = '<i class="bi bi-file-text"></i> Documento interno — sin AFIP';
    }
    nota.items = []; nota.nextItemId = 0;
    document.getElementById('itemsBody').innerHTML = sinItemsHTML();
    recalcularTotales();

    // Checkbox devuelve stock
    const secStock = document.getElementById('secDevuelveStock');
    const chk = document.getElementById('chkDevuelveStock');
    const lblStock = document.getElementById('lblDevuelveStock');
    if (nota.tipo === 'credito') {
        secStock.style.display = 'flex';
        chk.checked = true;
        nota.devuelve_stock = true;
        lblStock.textContent = 'Devuelve stock al depósito';
    } else if (nota.tipo === 'debito') {
        secStock.style.display = 'flex';
        chk.checked = false;
        nota.devuelve_stock = false;
        lblStock.textContent = 'Descuenta stock del depósito';
    } else {
        secStock.style.display = 'none';
    }
    chk.onchange = () => { nota.devuelve_stock = chk.checked; };
}

// =============================================================================
//   COMPROBANTES DE ORIGEN
// =============================================================================
async function cargarComprobantesCliente(id_cliente) {
    const lista = document.getElementById('comprobantesLista');
    if (!lista || nota.origen === 'manual') return;
    lista.innerHTML = '<div class="text-center text-muted small p-2"><span class="spinner-border spinner-border-sm"></span></div>';
    try {
        const tipo = nota.origen;
        let ep;
        if (tipo === 'factura')          ep = `${API_BASE}/facturas?id_cliente=${id_cliente}&limit=20`;
        else if (tipo === 'pedido')      ep = `${API_BASE}/notas/pedidos-credito-disponible?id_cliente=${id_cliente}`;
        else                              ep = `${API_BASE}/presupuestos?id_cliente=${id_cliente}&limit=20`;

        const res = await fetch(ep, { headers: authHeaders() });
        const data = await res.json();
        let rows = data.data || data || [];

        // Filtro especial para facturas: excluir las que ya tienen NC activa
        if (tipo === 'factura' && rows.length) {
            try {
                const ncRes = await fetch(`${API_BASE}/notas?tipo=credito&id_cliente=${id_cliente}&limit=200`, { headers: authHeaders() });
                const ncData = await ncRes.json();
                const facConNC = new Set((ncData.data || []).filter(n => n.id_factura_origen && n.estado === 'activa').map(n => parseInt(n.id_factura_origen)));
                rows = rows.filter(r => !facConNC.has(parseInt(r.id_factura)));
            } catch (e) { }
        }

        if (!rows.length) {
            const txt = tipo === 'factura' ? 'facturas' : tipo === 'pedido' ? 'pedidos con disponible' : 'presupuestos';
            lista.innerHTML = `<div class="text-center text-muted small p-2">Sin ${txt}</div>`;
            return;
        }

        lista.innerHTML = rows.map(r => {
            const id = r.id_factura || r.id_presupuesto || r.id_pedido;
            const num = r.numero_completo || (r.nro_pedido ? `#${r.nro_pedido}` : '-');
            const total = parseFloat(r.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
            const fecha = r.fecha_emision ? new Date(r.fecha_emision).toLocaleDateString('es-AR') : '';
            const cae = r.cae ? ' <span class="badge bg-success" style="font-size:8px">CAE</span>' : '';
            const extra = (tipo === 'pedido' && r.unidades_disponibles)
                ? `<br><small style="color:#28a745;font-size:10px">${r.estado || ''} · ${r.unidades_disponibles} u. pendientes (${r.items_con_disponible} item${r.items_con_disponible>1?'s':''})</small>`
                : '';
            return `<a href="#" class="list-group-item list-group-item-action py-1 px-2" onclick="event.preventDefault();cargarComprobanteOrigen(${id})" style="font-size:12px">
                <div class="d-flex justify-content-between"><div><strong style="font-family:monospace">${num}</strong>${cae} <span class="text-muted" style="font-size:10px">${fecha}</span>${extra}</div><span style="font-family:monospace;font-weight:700;color:#28a745">$${total}</span></div></a>`;
        }).join('');
    } catch (e) { lista.innerHTML = '<div class="text-danger small p-2">Error</div>'; }
}

async function cargarComprobanteOrigen(id) {
    const info = document.getElementById('comprobanteInfo');
    info.innerHTML = '<small class="text-muted"><span class="spinner-border spinner-border-sm"></span></small>';
    try {
        const tipo = nota.origen;
        const res = await fetch(`${API_BASE}/notas/comprobante-origen/${tipo}/${id}`, { headers: authHeaders() });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error');
        const datos = await res.json();
        nota.letra = datos.letra;
        nota.punto_venta = datos.punto_venta;
        nota.requiere_afip = datos.requiere_afip;
        if (tipo === 'factura')         nota.id_factura_origen = id;
        else if (tipo === 'presupuesto')  nota.id_presupuesto_origen = id;
        // else (tipo === 'pedido'): la vinculación se hace por nota.id_pedido_vinculado (ya seteado abajo desde el JSON)
        if (datos.cliente?.id_cliente) { nota.id_cliente = datos.cliente.id_cliente; nota.cliente_nombre = datos.cliente.razon_social; buscadorForm?.setCliente?.(datos.cliente); }
        if (datos.punto_venta) document.getElementById('inputPV').value = datos.punto_venta;
        const badge = document.getElementById('badgeAfip');
        if (datos.requiere_afip) {
            badge.className = datos.tiene_cae_real ? 'alert alert-success py-1 px-2 mb-0 small' : 'alert alert-warning py-1 px-2 mb-0 small';
            badge.innerHTML = datos.tiene_cae_real ? '<i class="bi bi-patch-check-fill"></i> <strong>AFIP</strong> — Requiere CAE' : '<i class="bi bi-exclamation-triangle"></i> Factura sin CAE real';
            badge.style.display = '';
        }
        nota.items = []; nota.nextItemId = 0;
        nota.id_pedido_vinculado   = datos.id_pedido_vinculado || datos.id_pedido || null;
        nota.total_pagado_pedido   = parseFloat(datos.total_pagado_pedido || 0);
        nota.total_exigible_actual = parseFloat(datos.total_exigible_actual || datos.totales?.total || 0);
        const itemsRaw = datos.items || [];
        const itemsACargar = nota.id_pedido_vinculado
            ? itemsRaw.filter(it => Number(it.disponible || 0) > 0)
            : itemsRaw;
        if (nota.id_pedido_vinculado && itemsACargar.length === 0) {
            toast('Sin items pendientes para creditear (todo entregado o ya crediteado)', 'warning', 4000);
        }
        itemsACargar.forEach(item => {
            nota.nextItemId++;
            const disp = Number(item.disponible !== undefined ? item.disponible : item.cantidad);
            nota.items.push({
                id_item: nota.nextItemId,
                id_producto: item.id_producto || null,
                id_pedido_item: item.id_pedido_item || null,
                descripcion: item.descripcion || item.producto_nombre || '',
                cantidad: disp,
                cant_original: Number(item.cantidad_pedida !== undefined ? item.cantidad_pedida : item.cantidad),
                cantidad_entregada: Number(item.cantidad_entregada || 0),
                cantidad_creditada: Number(item.cantidad_creditada || 0),
                disponible: disp,
                precio_unitario: item.precio_unitario,
                iva_porcentaje: item.iva_porcentaje || 21
            });
        });
        cargarMetodosPago();
        renderItems();
        info.innerHTML = `<div class="alert alert-info py-1 px-2 mb-0 small"><strong style="font-family:monospace">${datos.numero_comprobante || ''}</strong> · Letra ${datos.letra} · $${parseFloat(datos.totales?.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })} ${datos.requiere_afip && datos.tiene_cae_real ? '· <span class="text-success">✓ AFIP</span>' : ''}</div>`;
        document.getElementById('inputBuscarProducto')?.focus();
    } catch (err) { info.innerHTML = `<small class="text-danger">${err.message}</small>`; }
}

// =============================================================================
//   BÚSQUEDA DE PRODUCTOS (estilo venta-rápida: escribí → dropdown → Enter)
// =============================================================================
function onInputProducto(e) {
    const q = e.target.value.trim();
    clearTimeout(timerBusqueda);
    if (q.length < 2) { cerrarSugerencias(); return; }
    timerBusqueda = setTimeout(() => buscarProductos(q), 250);
}

function onKeydownProducto(e) {
    const sug = document.getElementById('sugerenciasNota');
    const hayResultados = sug && sug.querySelector('.list-group');
    if (!hayResultados) {
        if (e.key === 'Enter') { e.preventDefault(); const q = e.target.value.trim(); if (q.length >= 2) buscarExacto(q); }
        return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); indiceSel = Math.min(indiceSel + 1, resultadosBusqueda.length - 1); highlightSug(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); indiceSel = Math.max(indiceSel - 1, 0); highlightSug(); }
    else if (e.key === 'Enter') {
        e.preventDefault();
        if (indiceSel >= 0 && indiceSel < resultadosBusqueda.length) seleccionarProducto(resultadosBusqueda[indiceSel]);
        else if (resultadosBusqueda.length === 1) seleccionarProducto(resultadosBusqueda[0]);
    }
    else if (e.key === 'Escape') cerrarSugerencias();
}

async function buscarProductos(q) {
    try {
        const res = await fetch(`${API_BASE}/productos/buscar?q=${encodeURIComponent(q)}&limit=10`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        resultadosBusqueda = data.results || data.productos || data.data || [];
        indiceSel = -1;
        renderSugerencias();
    } catch (e) { }
}

async function buscarExacto(codigo) {
    try {
        const res = await fetch(`${API_BASE}/productos/buscar?q=${encodeURIComponent(codigo)}&limit=5`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const resultados = data.results || [];
        const codUp = codigo.toUpperCase();
        const exacto = resultados.find(p => (p.sku || '').toUpperCase() === codUp || (p.codigo_barras || '').toUpperCase() === codUp);
        if (exacto) seleccionarProducto(exacto);
        else if (resultados.length > 0) { resultadosBusqueda = resultados; indiceSel = -1; renderSugerencias(); }
        else toast('Producto no encontrado: ' + codigo, 'warning');
    } catch (e) { }
}

function renderSugerencias() {
    const sug = document.getElementById('sugerenciasNota');
    if (!resultadosBusqueda.length) { sug.innerHTML = ''; return; }
    sug.innerHTML = '<div class="list-group" style="border:1px solid #ccc;border-top:2px solid #28a745;border-radius:0 0 8px 8px;box-shadow:0 6px 20px rgba(0,0,0,0.15)">' +
        resultadosBusqueda.map((p, i) => {
            const precio = parseFloat(p.precio || p.precio_venta || 0).toFixed(2);
            const stock = p.stock_real !== undefined ? p.stock_real : '-';
            return `<a href="#" class="list-group-item list-group-item-action py-1 px-2 producto-sugerencia ${i === indiceSel ? 'active' : ''}" onclick="event.preventDefault();seleccionarProducto(resultadosBusqueda[${i}])" style="font-size:12px;display:flex;justify-content:space-between;align-items:center">
                <div style="flex:1;min-width:0"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre || '-'}</div><div style="font-size:10px;color:#666">${p.sku || ''} ${p.codigo_barras ? '· ' + p.codigo_barras : ''}</div></div>
                <div style="text-align:right;flex-shrink:0"><div style="font-family:monospace;font-weight:700;color:#28a745">$${precio}</div><div style="font-size:10px;color:#666">Stock: ${stock}</div></div></a>`;
        }).join('') + '</div>';
}

function highlightSug() {
    document.querySelectorAll('#sugerenciasNota .producto-sugerencia').forEach((el, i) => el.classList.toggle('active', i === indiceSel));
}

function cerrarSugerencias() {
    document.getElementById('sugerenciasNota').innerHTML = '';
    resultadosBusqueda = []; indiceSel = -1;
}

function seleccionarProducto(prod) {
    nota.nextItemId++;
    nota.items.push({ id_item: nota.nextItemId, id_producto: prod.id_producto, descripcion: prod.nombre || '', cantidad: 1, cant_original: null, precio_unitario: parseFloat(prod.precio || prod.precio_venta || 0), iva_porcentaje: 21 });
    renderItems();
    cerrarSugerencias();
    const inp = document.getElementById('inputBuscarProducto');
    if (inp) { inp.value = ''; inp.focus(); }
    toast('+1 ' + (prod.nombre || '').substring(0, 25), 'success');
}

function toast(msg, tipo = 'success', dur = 1500) {
    if (typeof AtajosGlobales !== 'undefined' && AtajosGlobales.toast) AtajosGlobales.toast(msg, tipo, dur);
}

// =============================================================================
//   ITEMS GRID
// =============================================================================
function sinItemsHTML() {
    return `<tr id="sinItems"><td colspan="8" class="text-center text-muted py-4"><i class="bi bi-inbox" style="font-size:22px"></i><br><small>Escaneá o buscá un producto</small></td></tr>`;
}

function renderItems() {
    const tbody = document.getElementById('itemsBody');
    if (!nota.items.length) { tbody.innerHTML = sinItemsHTML(); recalcularTotales(); return; }
    tbody.innerHTML = nota.items.map((it, idx) => {
        const sub = it.cantidad * it.precio_unitario;
        const iva = sub * (it.iva_porcentaje / 100);
        const total = Math.round((sub + iva) * 100) / 100;
        const origCol = it.cant_original !== null && it.cant_original !== undefined
            ? `<td class="text-center" style="font-size:11px;line-height:1.1"><span style="color:#999">${it.cant_original}</span>${it.disponible !== undefined ? `<br><small style="color:#28a745;font-weight:700">Disp:${it.disponible}</small>` : ''}</td>`
            : `<td class="text-center" style="color:#ccc">—</td>`;
        // Precio readonly si el item viene de un comprobante origen (presupuesto/factura) — viene congelado
        const precioReadonly = !!it.id_pedido_item;
        const precioStyles = precioReadonly
            ? 'width:80px;margin-left:auto;background:#e9ecef;color:#495057;cursor:not-allowed'
            : 'width:80px;margin-left:auto';
        const precioAttrs = precioReadonly ? 'readonly tabindex="-1" title="Precio congelado del comprobante origen"' : '';
        return `<tr data-row-id="${it.id_item}">
            <td style="color:#999">${idx + 1}</td>
            <td><strong>${it.descripcion}</strong><br><small class="text-muted">${it.id_producto ? 'ID:' + it.id_producto : 'Desc.libre'}</small></td>
            <td class="text-center"><input type="number" class="form-control form-control-sm text-center cantidad-input" value="${it.cantidad}" min="0.01" step="0.01" style="width:60px;margin:0 auto;font-weight:700" data-item-id="${it.id_item}" data-field="cantidad" onchange="cambiarCant(${it.id_item},this.value)" onkeydown="navegarGrid(event)"></td>
            ${origCol}
            <td class="text-end"><input type="number" class="form-control form-control-sm text-end" value="${it.precio_unitario}" min="0" step="0.01" style="${precioStyles}" data-item-id="${it.id_item}" data-field="precio" ${precioAttrs} onchange="cambiarPrecio(${it.id_item},this.value)" onkeydown="navegarGrid(event)"></td>
            <td class="text-center" style="font-size:11px">${it.iva_porcentaje}%</td>
            <td class="text-end" data-subtotal-item-id="${it.id_item}" style="font-family:monospace;font-weight:700;color:#28a745">$${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td>
            <td class="text-center" style="white-space:nowrap">${it.id_producto ? `<button class="btn btn-sm btn-outline-info border-0 py-0" onclick="verHistorialProductoCliente(${it.id_producto})" title="Historial del producto al cliente"><i class="bi bi-clock-history"></i></button>` : ''}<button class="btn btn-sm btn-outline-danger border-0 py-0" onclick="eliminarItem(${it.id_item})"><i class="bi bi-trash3"></i></button></td></tr>`;
    }).join('');
    recalcularTotales();
}

function cambiarCant(id, val) {
    const it = nota.items.find(i => i.id_item === id);
    if (!it) return;
    const v = parseFloat(val) || 0;
    const tope = it.id_pedido_item ? it.disponible : it.cant_original;
    if (tope !== null && tope !== undefined && v > tope) {
        toast(`Máximo ${tope}`, 'warning');
        it.cantidad = tope;
        const inp = document.querySelector(`input[data-item-id="${id}"][data-field="cantidad"]`);
        if (inp) inp.value = tope;
        actualizarSubtotalFila(id);
        recalcularTotales();
        return;
    }
    it.cantidad = v;
    actualizarSubtotalFila(id);
    recalcularTotales();
}

function cambiarPrecio(id, val) {
    const it = nota.items.find(i => i.id_item === id);
    if (!it) return;
    it.precio_unitario = parseFloat(val) || 0;
    actualizarSubtotalFila(id);
    recalcularTotales();
}

function actualizarSubtotalFila(id_item) {
    const it = nota.items.find(i => i.id_item === id_item);
    if (!it) return;
    const sub = it.cantidad * it.precio_unitario;
    const iva = sub * (it.iva_porcentaje / 100);
    const total = Math.round((sub + iva) * 100) / 100;
    const cell = document.querySelector(`[data-subtotal-item-id="${id_item}"]`);
    if (cell) cell.textContent = '$' + total.toLocaleString('es-AR', { minimumFractionDigits: 2 });
}

function navegarGrid(event) {
    const inp = event.target;
    const itemId = parseInt(inp.dataset.itemId);
    const field  = inp.dataset.field;
    if (!itemId || !field) return;
    const idx = nota.items.findIndex(i => i.id_item === itemId);

    let nextId = null;
    let nextField = field;
    let prevenir = false;

    if (event.key === 'ArrowDown') {
        // Prevenir SIEMPRE en number inputs (sino el browser incrementa el valor)
        prevenir = true;
        if (idx >= 0 && idx < nota.items.length - 1) nextId = nota.items[idx + 1].id_item;
    } else if (event.key === 'ArrowUp') {
        prevenir = true;
        if (idx > 0) nextId = nota.items[idx - 1].id_item;
    } else if (event.key === 'Enter' && field === 'cantidad') {
        prevenir = true;
        if (idx >= 0 && idx < nota.items.length - 1) nextId = nota.items[idx + 1].id_item;
    } else if (event.key === 'ArrowRight' && field === 'cantidad' && inp.selectionStart === inp.value.length) {
        prevenir = true;
        nextId = itemId; nextField = 'precio';
    } else if (event.key === 'ArrowLeft' && field === 'precio' && inp.selectionStart === 0) {
        prevenir = true;
        nextId = itemId; nextField = 'cantidad';
    } else {
        return;
    }

    if (prevenir) event.preventDefault();
    if (!nextId) return;

    const target = document.querySelector(`input[data-item-id="${nextId}"][data-field="${nextField}"]`);
    if (target && !target.readOnly) { target.focus(); target.select(); }
    else if (target && target.readOnly) {
        const alt = document.querySelector(`input[data-item-id="${nextId}"][data-field="cantidad"]`);
        if (alt) { alt.focus(); alt.select(); }
    }
}
window.actualizarSubtotalFila = actualizarSubtotalFila;
window.navegarGrid = navegarGrid;

function eliminarItem(id) { nota.items = nota.items.filter(i => i.id_item !== id); renderItems(); }

function recalcularTotales() {
    let sub = 0, ivaT = 0;
    nota.items.forEach(it => {
        const s = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0);
        sub  += s;
        ivaT += s * ((Number(it.iva_porcentaje) || 0) / 100);
    });
    sub  = Math.round(sub  * 100) / 100;
    ivaT = Math.round(ivaT * 100) / 100;
    const total = Math.round((sub + ivaT) * 100) / 100;
    const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setT = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    setT('rSubtotal', '$' + fmt(sub));
    setT('rIva',      '$' + fmt(ivaT));
    setT('rTotal',    '$' + fmt(total));
    setT('rItems',    nota.items.length + ' items');
    if (typeof actualizarBloqueDevolucion === 'function') actualizarBloqueDevolucion();
}

// =============================================================================
//   PV Default
// =============================================================================
async function cargarPVDefault() {
    try {
        const res = await fetch(`${API_BASE}/depositos/`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const p = (data.data || data || []).find(d => d.es_principal && d.activo);
        if (p?.punto_venta_afip) { const inp = document.getElementById('inputPV'); if (inp && (!inp.value || inp.value === '1')) inp.value = p.punto_venta_afip; }
    } catch (e) { }
}

// =============================================================================
//   GUARDAR
// =============================================================================
async function guardarNota() {
    if (!nota.tipo) { toast('Seleccioná NC o ND', 'warning'); return; }
    if (!nota.origen) { toast('Seleccioná origen', 'warning'); return; }
    if (!nota.id_cliente) { toast('Seleccioná cliente', 'warning'); buscadorForm?.focus?.(); return; }
    const pv = parseInt(document.getElementById('inputPV')?.value);
    if (!pv) { toast('Punto de venta requerido', 'warning'); return; }
    const motivo = document.getElementById('inputMotivo')?.value?.trim();
    if (!motivo) { toast('Motivo obligatorio', 'warning'); document.getElementById('inputMotivo')?.focus(); return; }
    if (nota.origen === 'factura' && !nota.id_factura_origen) { toast('Seleccioná factura', 'warning'); return; }
    if (nota.origen === 'presupuesto' && !nota.id_presupuesto_origen) { toast('Seleccioná presupuesto', 'warning'); return; }
    if (nota.origen === 'pedido' && !nota.id_pedido_vinculado) { toast('Seleccioná pedido', 'warning'); return; }
    const items = nota.items.filter(it => it.cantidad > 0 && it.descripcion).map(it => ({ id_producto: it.id_producto || null, id_pedido_item: it.id_pedido_item || null, descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: it.precio_unitario, iva_porcentaje: it.iva_porcentaje }));
    if (!items.length) { toast('Agregá al menos un item', 'warning'); return; }

    const lbl = nota.tipo === 'credito' ? 'Crédito' : 'Débito';
    const totalStr = document.getElementById('rTotal')?.textContent || '$0';
    if (!confirm(`¿Confirmar Nota de ${lbl}?\n\nCliente: ${nota.cliente_nombre}\nTotal: ${totalStr}${nota.requiere_afip ? '\n⚡ AFIP: Se solicitará CAE' : ''}`)) return;

    const btn = document.getElementById('btnGuardar');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Procesando...'; }
    try {
        const res = await fetch(`${API_BASE}/notas`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify({
            tipo_nota: nota.tipo, origen: nota.origen, id_cliente: parseInt(nota.id_cliente), punto_venta: pv, motivo,
            observaciones: document.getElementById('inputObs')?.value?.trim() || null, items,
            id_factura_origen: nota.id_factura_origen || null, id_presupuesto_origen: nota.id_presupuesto_origen || null, id_pedido: nota.id_pedido_vinculado || null, letra: nota.letra || null,
            devuelve_stock: nota.devuelve_stock,
            forma_devolucion: nota.forma_devolucion || null,
            idempotency_key: nota.idempotency_key || null,
        }) });
        if (res.ok) {
            const data = await res.json();
            toast(`${lbl} ${data.numero_completo || ''} creada ✓` + (data.cae ? ` · CAE: ${data.cae}` : ''), 'success', 3000);
            irAListado();
        } else {
            const err = await res.json().catch(() => ({}));
            if (err.codigo === 'AFIP_ERROR') { toast(`AFIP: ${err.error || err.detalle}. Reintentar es seguro (idempotente).`, 'danger', 8000); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Reintentar (seguro) <kbd>F2</kbd>'; } return; }
            toast('Error: ' + (err.error || err.detalle || 'desconocido'), 'danger');
        }
    } catch (e) { toast('Error de conexión', 'danger'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle"></i> CONFIRMAR <kbd>F2</kbd>'; } }
}

// =============================================================================
//   HISTORIAL PRODUCTO-CLIENTE
// =============================================================================
async function verHistorialProductoCliente(id_producto) {
    if (!nota.id_cliente) { toast('Seleccioná un cliente primero', 'warning'); return; }
    try {
        const url = `${API_BASE}/pedidos/historial-producto-cliente?id_producto=${id_producto}&id_cliente=${nota.id_cliente}&todos_estados=true`;
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) throw new Error('Error');
        const rows = await res.json();
        const prod = nota.items.find(it => it.id_producto === id_producto);
        const titulo = prod ? prod.descripcion : 'Producto';

        const badgeTipo = (t) => {
            if (t === 'venta') return '<span class="badge bg-primary" style="font-size:10px">Venta</span>';
            if (t === 'nc')    return '<span class="badge bg-success" style="font-size:10px">NC</span>';
            if (t === 'nd')    return '<span class="badge bg-warning text-dark" style="font-size:10px">ND</span>';
            return `<span class="badge bg-secondary" style="font-size:10px">${t || '-'}</span>`;
        };

        document.getElementById('modalHistProd')?.remove();
        document.body.insertAdjacentHTML('beforeend', `
            <div class="modal fade" id="modalHistProd" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content">
                <div class="modal-header bg-info text-white py-2"><h6 class="modal-title"><i class="bi bi-clock-history"></i> ${titulo} — ${nota.cliente_nombre}</h6><button class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
                <div class="modal-body" style="font-size:12px;max-height:65vh;overflow-y:auto">
                    ${rows.length === 0 ? '<p class="text-muted text-center my-3">Sin operaciones previas para este producto al cliente.</p>'
                        : `<table class="table table-sm table-hover mb-0">
                             <thead class="table-light"><tr>
                                <th style="width:55px">Tipo</th>
                                <th>Fecha</th>
                                <th>Documento</th>
                                <th>Detalle</th>
                                <th class="text-center">Cant</th>
                                <th class="text-center">Entreg.</th>
                                <th class="text-end">P.Unit</th>
                                <th class="text-end">Total</th>
                             </tr></thead>
                             <tbody>
                                ${rows.map(r => `<tr>
                                    <td>${badgeTipo(r.tipo)}</td>
                                    <td>${r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : '-'}</td>
                                    <td style="font-family:monospace">${r.tipo === 'venta' ? '#' + (r.numero || '-') : (r.numero || '-')}</td>
                                    <td>${r.detalle || '-'}</td>
                                    <td class="text-center">${r.cantidad !== null && r.cantidad !== undefined ? parseFloat(r.cantidad) : '-'}</td>
                                    <td class="text-center" style="color:#666">${r.cantidad_entregada !== null && r.cantidad_entregada !== undefined ? parseFloat(r.cantidad_entregada) : '—'}</td>
                                    <td class="text-end">$${parseFloat(r.precio_unitario || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</td>
                                    <td class="text-end"><strong>$${parseFloat(r.total || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</strong></td>
                                </tr>`).join('')}
                             </tbody>
                           </table>`}
                </div>
                <div class="modal-footer py-1"><small class="text-muted me-auto">Total operaciones: ${rows.length}</small><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button></div>
            </div></div></div>`);
        new bootstrap.Modal(document.getElementById('modalHistProd')).show();
        document.getElementById('modalHistProd').addEventListener('hidden.bs.modal', function() { this.remove(); });
    } catch (e) { toast('Error cargando historial', 'danger'); }
}
window.verHistorialProductoCliente = verHistorialProductoCliente;

// =============================================================================
//   FORMA DEVOLUCIÓN — bloque condicional cuando hay sobrepago tras la NC
// =============================================================================
async function cargarMetodosPago() {
    if (metodosPagoCache.length > 0) return;
    const endpoints = ['/facturas/metodos-pago', '/formas-pago/activos'];
    for (const ep of endpoints) {
        try {
            const res = await fetch(`${API_BASE}${ep}`, { headers: authHeaders() });
            if (!res.ok) continue;
            const data = await res.json();
            // Buscar lista en distintas claves comunes
            const lista = Array.isArray(data) ? data
                        : (Array.isArray(data.data)            ? data.data
                        :  Array.isArray(data.metodos)         ? data.metodos
                        :  Array.isArray(data.metodos_pago)    ? data.metodos_pago
                        :  Array.isArray(data.metodosdepago)   ? data.metodosdepago
                        :  Array.isArray(data.formas_pago)     ? data.formas_pago
                        :  []);
            // Normalizar a {id_metodo_pago, nombre}
            const norm = lista.map(m => ({
                id_metodo_pago: m.id_metodo_pago || m.id_forma_pago || m.id || null,
                nombre: m.nombre || m.descripcion || m.metodo || 'Sin nombre'
            })).filter(m => m.id_metodo_pago);
            if (norm.length > 0) {
                metodosPagoCache = norm;
                console.log(`[notas] Métodos de pago cargados desde ${ep}: ${norm.length} opciones`);
                return;
            }
        } catch (e) { console.warn(`[notas] Error cargando metodos de pago desde ${ep}:`, e); }
    }
    console.warn('[notas] No se pudieron cargar métodos de pago de ningún endpoint');
}

const _r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function calcularTotalesNC() {
    let totalNC = 0;
    nota.items.forEach(it => {
        const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0);
        const iva = sub * ((Number(it.iva_porcentaje) || 0) / 100);
        totalNC += _r2(sub + iva);
    });
    totalNC = _r2(totalNC);
    const nuevoExigible = _r2(Math.max(0, (Number(nota.total_exigible_actual) || 0) - totalNC));
    const sobrepago     = _r2(Math.max(0, (Number(nota.total_pagado_pedido) || 0) - nuevoExigible));
    return { totalNC, nuevoExigible, sobrepago };
}

function calcularSobrepago() {
    if (nota.tipo !== 'credito') return 0;
    if (!nota.total_pagado_pedido || !nota.total_exigible_actual) return 0;
    return calcularTotalesNC().sobrepago;
}

function _poblarMetodosPagoSelect() {
    const sel = document.getElementById('bdMetodoPago');
    if (!sel || !metodosPagoCache.length) return;
    sel.innerHTML = metodosPagoCache.map(m => `<option value="${m.id_metodo_pago}">${m.nombre}</option>`).join('');
    const efe = metodosPagoCache.find(m => /efectivo/i.test(m.nombre));
    if (efe) sel.value = efe.id_metodo_pago;
    sincronizarDevolucion();
}

function actualizarBloqueDevolucion() {
    if (nota.tipo !== 'credito') return;
    const { totalNC, nuevoExigible, sobrepago } = calcularTotalesNC();
    let bloque = document.getElementById('bloqueDevolucion');

    if (sobrepago <= 0) {
        if (bloque) bloque.style.display = 'none';
        nota.forma_devolucion = null;
        return;
    }

    if (!bloque) {
        const html = `
            <div id="bloqueDevolucion" class="alert alert-warning mt-2 mb-2 p-2" style="font-size:13px">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <strong><i class="bi bi-cash-coin"></i> Devolución al cliente</strong>
                    <span id="bdMonto" style="font-family:monospace;font-weight:700;color:#d63384;font-size:15px"></span>
                </div>
                <div class="d-flex align-items-center gap-2 flex-wrap">
                    <label class="mb-0 small">Forma:</label>
                    <select id="bdMetodoPago" class="form-select form-select-sm" style="width:auto;min-width:140px"></select>
                    <label class="mb-0 small">Monto:</label>
                    <input id="bdMontoInput" type="number" step="0.01" class="form-control form-control-sm" style="width:120px;font-family:monospace;text-align:right">
                    <div class="form-check ms-2">
                        <input class="form-check-input" type="checkbox" id="bdIgnorar">
                        <label class="form-check-label small" for="bdIgnorar">No registrar</label>
                    </div>
                </div>
                <small class="text-muted d-block mt-1">Pagado: $<span id="bdPagado"></span> &nbsp;·&nbsp; Total NC: $<span id="bdTotalNC"></span> &nbsp;·&nbsp; Nuevo exigible: $<span id="bdNuevoExigible"></span></small>
            </div>`;
        const target = document.getElementById('itemsBody')?.closest('table')?.parentElement;
        if (target) target.insertAdjacentHTML('afterend', html);
        bloque = document.getElementById('bloqueDevolucion');
        document.getElementById('bdMetodoPago')?.addEventListener('change', sincronizarDevolucion);
        document.getElementById('bdMontoInput')?.addEventListener('input', sincronizarDevolucion);
        document.getElementById('bdIgnorar')?.addEventListener('change', sincronizarDevolucion);

        if (metodosPagoCache.length > 0) {
            _poblarMetodosPagoSelect();
        } else if (typeof cargarMetodosPago === 'function') {
            cargarMetodosPago().then(_poblarMetodosPagoSelect);
        }
    }

    bloque.style.display = '';
    const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('bdMonto').textContent         = '$' + fmt(sobrepago);
    document.getElementById('bdMontoInput').value          = sobrepago.toFixed(2);
    document.getElementById('bdPagado').textContent        = fmt(Number(nota.total_pagado_pedido) || 0);
    document.getElementById('bdTotalNC').textContent       = fmt(totalNC);
    document.getElementById('bdNuevoExigible').textContent = fmt(nuevoExigible);
    sincronizarDevolucion();
}

function sincronizarDevolucion() {
    const ignorar = document.getElementById('bdIgnorar')?.checked;
    if (ignorar) { nota.forma_devolucion = null; return; }
    const id_metodo_pago = parseInt(document.getElementById('bdMetodoPago')?.value);
    const monto          = parseFloat(document.getElementById('bdMontoInput')?.value);
    if (!id_metodo_pago || isNaN(monto) || monto <= 0) { nota.forma_devolucion = null; return; }
    nota.forma_devolucion = { id_metodo_pago, monto };
}
window.actualizarBloqueDevolucion = actualizarBloqueDevolucion;

// =============================================================================
//   VER DETALLE (modal lectura)
// =============================================================================
async function verDetalle(id) {
    try {
        const res = await fetch(`${API_BASE}/notas/${id}`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Error');
        const n = await res.json();
        const esNC = n.tipo_nota === 'credito';
        const fecha = n.fecha_emision ? new Date(n.fecha_emision).toLocaleDateString('es-AR') : '-';
        const total = parseFloat(n.total || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });
        const items = n.items || [];
        const origenH = n.factura_origen_numero ? `Factura: ${n.factura_origen_numero}` : n.presupuesto_origen_numero ? `Presupuesto: ${n.presupuesto_origen_numero}` : 'Manual';
        const caeH = n.cae ? `<div class="mt-1"><small class="text-success"><i class="bi bi-patch-check-fill"></i> CAE: <strong>${n.cae}</strong> · Vto: ${n.vencimiento_cae || '-'}</small></div>` : '';
        document.getElementById('modalDetalle')?.remove();
        document.body.insertAdjacentHTML('beforeend', `<div class="modal fade" id="modalDetalle" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content">
            <div class="modal-header text-white" style="background:${esNC ? '#28a745' : '#ffc107'}"><h6 class="modal-title">${esNC ? 'NC' : 'ND'} · ${n.numero_completo || ''} ${n.estado === 'anulada' ? '<span class="badge bg-danger ms-2">ANULADA</span>' : ''}</h6><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
            <div class="modal-body"><div class="row mb-2" style="font-size:13px"><div class="col-4"><strong>Cliente:</strong> ${n.cliente_nombre || '-'}</div><div class="col-4"><strong>Fecha:</strong> ${fecha}</div><div class="col-4"><strong>Origen:</strong> ${origenH}</div></div>${caeH}${n.motivo ? `<div class="mb-2"><strong>Motivo:</strong> ${n.motivo}</div>` : ''}
            <table class="table table-sm" style="font-size:12px"><thead class="table-light"><tr><th>Descripción</th><th class="text-center" style="width:8%">Cant</th><th class="text-end" style="width:12%">P.Unit</th><th class="text-center" style="width:8%">IVA</th><th class="text-end" style="width:14%">Total</th></tr></thead><tbody>${items.map(i => `<tr><td>${i.descripcion || i.producto_nombre || '-'}</td><td class="text-center">${i.cantidad}</td><td class="text-end">$${parseFloat(i.precio_unitario || 0).toFixed(2)}</td><td class="text-center">${i.iva_porcentaje || 21}%</td><td class="text-end"><strong>$${parseFloat(i.total || 0).toFixed(2)}</strong></td></tr>`).join('')}</tbody></table>
            <div class="text-end"><h5>Total: <strong style="font-family:monospace">$${total}</strong></h5></div>${n.observaciones ? `<p class="text-muted small"><strong>Obs:</strong> ${n.observaciones}</p>` : ''}</div>
            <div class="modal-footer">${n.estado !== 'anulada' ? `<button class="btn btn-outline-danger btn-sm" onclick="confirmarAnular(${n.id_nota},'${(n.numero_completo || '').replace(/'/g, "\\'")}',${!!n.cae});bootstrap.Modal.getInstance(document.getElementById('modalDetalle'))?.hide()"><i class="bi bi-x-circle"></i> Anular</button>` : ''}<button class="btn btn-primary btn-sm" onclick="imprimirNota(${n.id_nota})"><i class="bi bi-printer"></i> Imprimir</button><button class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>`);
        new bootstrap.Modal(document.getElementById('modalDetalle')).show();
        document.getElementById('modalDetalle').addEventListener('hidden.bs.modal', function () { this.remove(); });
    } catch (e) { toast('Error al cargar', 'danger'); }
}

// =============================================================================
//   ANULAR
// =============================================================================
function confirmarAnular(id, num, tieneCae) {
    if (!confirm(`¿ANULAR ${num}?${tieneCae ? '\n⚠️ Tiene CAE AFIP.' : ''}\nSe revertirán movimientos en CC.`)) return;
    (async () => {
        try {
            const res = await fetch(`${API_BASE}/notas/${id}`, { method: 'DELETE', headers: authHeaders() });
            if (res.ok) { const d = await res.json(); toast('Anulada ✓'); if (d.aviso_afip) setTimeout(() => alert('ℹ️ ' + d.aviso_afip), 500); cargarNotas(); }
            else { const e = await res.json().catch(() => ({})); toast('Error: ' + (e.error || ''), 'danger'); }
        } catch (e) { toast('Error conexión', 'danger'); }
    })();
}

// ─── Impresión de nota ───
function imprimirNota(idNota) {
    if (!idNota) return;
    const url = (window.CONFIG?.API_BASE_URL || '/api') + '/notas/' + idNota + '/html';
    window.open(url, '_blank', 'width=900,height=1100');
}
window.imprimirNota = imprimirNota;
