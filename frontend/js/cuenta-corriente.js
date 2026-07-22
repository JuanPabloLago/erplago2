/* ═══════════════════════════════════════════════════════════════════
 * cuenta-corriente.js — Hub CC Clientes (F4c 2026-07-03)
 * Libro mayor + cobro in-place + documento origen + resumen + aging.
 * Auth: Bearer localStorage (patrón cc-proveedores). API via window.CONFIG.
 * ═══════════════════════════════════════════════════════════════════ */
const API_URL = window.CONFIG?.API_BASE_URL || '/api';
const TOKEN_KEY = 'erp_token';
function getHeaders() { return { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' }; }

let clienteActual = null, libroData = null, agingData = null;
let formasPago = [], wpPlantilla = '', pagina = 1;
let itemsPagoCobro = [], formaSeleccionada = null;

/* ── Utilidades ── */
const fmt = n => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fch = d => new Date(d).toLocaleDateString('es-AR');
const hoyLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const limpio = v => { const s = String(v ?? '').trim(); return (!s || s === '0' || s === '-') ? null : s; }; // saneo datos basura
function toast(msg, tipo = 'success') {
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-' + tipo + ' border-0';
    el.innerHTML = '<div class="d-flex"><div class="toast-body">' + msg + '</div><button class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    document.getElementById('toastContainer').appendChild(el);
    new bootstrap.Toast(el, { delay: 4000 }).show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
}

/* ── Búsqueda de cliente (multi-campo, teclado ↑↓/Enter) ── */
let debounceTimer = null, resultados = [], idxSel = -1;
const inputBuscar = document.getElementById('buscarCliente');
const dropdown = document.getElementById('dropdownClientes');

inputBuscar.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = inputBuscar.value.trim();
    if (q.length < 2) { dropdown.classList.add('d-none'); return; }
    debounceTimer = setTimeout(() => buscarClientes(q), 280);
});
inputBuscar.addEventListener('keydown', e => {
    if (dropdown.classList.contains('d-none')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); idxSel = Math.min(idxSel + 1, resultados.length - 1); pintarDropdown(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idxSel = Math.max(idxSel - 1, 0); pintarDropdown(); }
    else if (e.key === 'Enter' && idxSel >= 0) { e.preventDefault(); seleccionarCliente(resultados[idxSel]); }
    else if (e.key === 'Escape') { dropdown.classList.add('d-none'); }
});

async function buscarClientes(q) {
    try {
        const res = await fetch(API_URL + '/clientes/buscar?q=' + encodeURIComponent(q), { headers: getHeaders() });
        const data = await res.json();
        // Shape defensivo: array directo, {clientes}, {resultados} o {rows}
        resultados = Array.isArray(data) ? data : (data.clientes || data.resultados || data.rows || []);
        idxSel = resultados.length ? 0 : -1;
        pintarDropdown();
    } catch (e) { console.error(e); }
}
function pintarDropdown() {
    if (!resultados.length) { dropdown.innerHTML = '<div class="list-group-item text-muted">Sin resultados</div>'; dropdown.classList.remove('d-none'); return; }
    dropdown.innerHTML = resultados.map((c, i) =>
        '<div class="list-group-item resultado-cliente ' + (i === idxSel ? 'active' : '') + '" data-i="' + i + '">' +
        '<strong>' + (c.razon_social || c.nombre || '#' + c.id_cliente) + '</strong>' +
        (limpio(c.cuit_cuil) ? ' <span class="small">· ' + c.cuit_cuil + '</span>' : '') +
        (c.saldo_actual !== undefined ? '<span class="float-end small ' + (parseFloat(c.saldo_actual) > 0 ? 'text-danger' : 'text-success') + '">' + fmt(c.saldo_actual) + '</span>' : '') +
        '</div>').join('');
    dropdown.classList.remove('d-none');
    dropdown.querySelectorAll('.resultado-cliente').forEach(el =>
        el.addEventListener('mousedown', () => seleccionarCliente(resultados[parseInt(el.dataset.i)])));
}

/* ── Selección: SIEMPRE GET /clientes/:id (fuente autoritativa) ── */
async function seleccionarCliente(c) {
    dropdown.classList.add('d-none');
    try {
        const res = await fetch(API_URL + '/clientes/' + c.id_cliente, { headers: getHeaders() });
        if (!res.ok) throw new Error('No se pudo cargar el cliente');
        const data = await res.json();
        clienteActual = data.cliente || data;
        inputBuscar.value = clienteActual.razon_social || '';
        pagina = 1;
        limpiarFiltros(false);
        document.getElementById('sinCliente').classList.add('d-none');
        document.getElementById('panelCliente').classList.remove('d-none');
        pintarCliente();
        await Promise.all([cargarLibro(), cargarAging()]);
    } catch (e) { toast(e.message, 'danger'); }
}

function pintarCliente() {
    const c = clienteActual;
    document.getElementById('clienteNombre').textContent = c.razon_social || '';
    const datos = [limpio(c.cuit_cuil) && ('CUIT ' + c.cuit_cuil), limpio(c.domicilio), limpio(c.telefono) && ('📞 ' + c.telefono)]
        .filter(Boolean).join(' · ');
    document.getElementById('clienteDatos').textContent = datos || 'Sin datos de contacto cargados';
    // WhatsApp: deshabilitado si el teléfono es basura
    const tel = (limpio(c.telefono) || '').replace(/\D/g, '');
    const btnWp = document.getElementById('btnWhatsApp');
    btnWp.disabled = tel.length < 8;
    btnWp.title = tel.length < 8 ? 'Cliente sin teléfono válido cargado' : 'Enviar resumen por WhatsApp';
    // Límite de crédito
    const lim = parseFloat(c.limite_credito) || 0;
    const wrap = document.getElementById('barraLimiteWrap');
    if (lim > 0) {
        wrap.classList.remove('d-none');
        const uso = Math.max(0, parseFloat(c.saldo_actual) || 0);
        const pct = Math.min(100, Math.round(uso / lim * 100));
        document.getElementById('limiteTexto').textContent = fmt(uso) + ' / ' + fmt(lim) + ' (' + pct + '%)';
        const barra = document.getElementById('barraLimite');
        barra.style.width = pct + '%';
        barra.className = 'progress-bar ' + (pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-success');
    } else wrap.classList.add('d-none');
}

/* ── Libro ── */
function filtrosActivos() {
    const f = {};
    const d = document.getElementById('filtroDesde').value, h = document.getElementById('filtroHasta').value;
    const b = document.getElementById('filtroBusqueda').value.trim(), fp = document.getElementById('filtroFormaPago').value;
    if (d) f.desde = d; if (h) f.hasta = h; if (b) f.busqueda = b; if (fp) f.id_forma_pago = fp;
    return f;
}
async function cargarLibro() {
    if (!clienteActual) return;
    const f = filtrosActivos();
    const qs = new URLSearchParams(Object.assign({ pagina }, f)).toString();
    const res = await fetch(API_URL + '/cobranzas/cuenta-corriente/' + clienteActual.id_cliente + '/libro?' + qs, { headers: getHeaders() });
    if (!res.ok) { toast('Error cargando el libro', 'danger'); return; }
    libroData = await res.json();
    pintarLibro(f);
    pintarChips(f);
    pintarSaldoYConciliacion();
}
function origenBadge(m) {
    if (m.id_recibo) {
        const esDev = parseFloat(m.debe) > 0; // recibo que DEBITA = devolución
        return esDev
            ? '<span class="badge bg-danger-subtle text-danger-emphasis"><i class="bi bi-arrow-return-left"></i> Devolución ' + (m.recibo_numero || '#' + m.id_recibo) + '</span>'
            : '<span class="badge bg-success-subtle text-success-emphasis">Recibo ' + (m.recibo_numero || '#' + m.id_recibo) + '</span>';
    }
    if (m.id_nota) return '<span class="badge bg-info-subtle text-info-emphasis">' + (m.tipo_nota === 'credito' ? 'NC' : 'ND') + ' ' + (m.nota_numero || '') + '</span>';
    if (m.id_factura) return '<span class="badge bg-primary-subtle text-primary-emphasis">Fact. ' + (m.factura_numero || '') + '</span>';
    if (m.id_pedido) return '<span class="badge bg-secondary-subtle text-secondary-emphasis">Pedido #' + (m.nro_pedido || m.id_pedido) + '</span>';
    return '';
}
function pintarLibro(f) {
    const tb = document.getElementById('cuerpoLibro');
    const movs = libroData.movimientos || [];
    let html = '';
    if (f.desde) html += '<tr class="fila-saldo-anterior"><td></td><td colspan="2">Saldo anterior al ' + fch(f.desde + 'T12:00:00') + '</td><td class="col-num"></td><td class="col-num"></td><td class="col-num">' + fmt(libroData.saldo_anterior) + '</td></tr>';
    if (!movs.length) {
        const desc = Object.entries(f).map(([k, v]) => k + '=' + v).join(' · ');
        html += '<tr><td colspan="6" class="text-center text-muted py-4">Sin movimientos' + (desc ? ' con estos filtros: ' + desc : '') + '</td></tr>';
    } else {
        html += movs.map((m, i) =>
            '<tr class="fila-doc" data-i="' + i + '">' +
            '<td>' + fch(m.fecha) + '</td>' +
            '<td>' + m.concepto + '</td>' +
            '<td>' + origenBadge(m) + '</td>' +
            '<td class="col-num text-danger">' + (parseFloat(m.debe) > 0 ? fmt(m.debe) : '') + '</td>' +
            '<td class="col-num text-success">' + (parseFloat(m.haber) > 0 ? fmt(m.haber) : '') + '</td>' +
            '<td class="col-num">' + fmt(m.saldo) + '</td></tr>');
        html += '<tr class="fila-totales"><td></td><td colspan="2">TOTALES del período</td>' +
            '<td class="col-num">' + fmt(libroData.totales.debe) + '</td>' +
            '<td class="col-num">' + fmt(libroData.totales.haber) + '</td>' +
            '<td class="col-num">' + fmt(libroData.saldo_actual) + '</td></tr>';
    }
    tb.innerHTML = html;
    tb.querySelectorAll('.fila-doc').forEach(el => el.addEventListener('click', () => abrirDoc(parseInt(el.dataset.i))));
    const total = libroData.total_filas, pp = libroData.items_por_pagina;
    const maxPag = Math.max(1, Math.ceil(total / pp));
    document.getElementById('infoPaginacion').textContent = total + ' movimientos — página ' + pagina + ' de ' + maxPag;
    document.getElementById('pagPrev').disabled = pagina <= 1;
    document.getElementById('pagNext').disabled = pagina >= maxPag;
}
function pintarChips(f) {
    const labels = { desde: 'Desde', hasta: 'Hasta', busqueda: 'Buscar', id_forma_pago: 'Forma de pago' };
    document.getElementById('chipsFiltros').innerHTML = Object.entries(f).map(([k, v]) =>
        '<span class="chip">' + labels[k] + ': ' + v + ' <span class="x" data-k="' + k + '">×</span></span>').join('');
    document.querySelectorAll('#chipsFiltros .x').forEach(el => el.addEventListener('click', () => {
        const k = el.dataset.k;
        if (k === 'desde') document.getElementById('filtroDesde').value = '';
        if (k === 'hasta') document.getElementById('filtroHasta').value = '';
        if (k === 'busqueda') document.getElementById('filtroBusqueda').value = '';
        if (k === 'id_forma_pago') document.getElementById('filtroFormaPago').value = '';
        pagina = 1; cargarLibro();
    }));
}
function pintarSaldoYConciliacion() {
    const s = libroData.saldo_actual;
    const el = document.getElementById('saldoActual');
    el.textContent = fmt(s);
    el.className = 'saldo-grande ' + (s > 0.01 ? 'saldo-positivo' : s < -0.01 ? 'saldo-favor' : 'saldo-cero');
    // Badge conciliación: agregado del cliente vs suma del libro
    const agregado = parseFloat(clienteActual.saldo_actual) || 0;
    const badge = document.getElementById('badgeConciliacion');
    if (Math.abs(agregado - s) > 0.01) {
        badge.textContent = '⚠ Desincronizado: ficha ' + fmt(agregado) + ' vs libro ' + fmt(s);
        badge.className = 'badge bg-danger';
        badge.classList.remove('d-none');
    } else badge.classList.add('d-none');
}

/* ── Aging ── */
async function cargarAging() {
    const res = await fetch(API_URL + '/cobranzas/cuenta-corriente/' + clienteActual.id_cliente + '/aging', { headers: getHeaders() });
    if (!res.ok) return;
    agingData = await res.json();
    const tramos = [
        { k: 'd0_30', lbl: '0-30 días', cls: 'aging-ok' },
        { k: 'd30_60', lbl: '30-60', cls: 'aging-warn' },
        { k: 'd60_90', lbl: '60-90', cls: 'aging-warn' },
        { k: 'd90_mas', lbl: '+90 días', cls: 'aging-bad' }
    ];
    document.getElementById('agingChips').innerHTML = tramos.map(t => {
        const v = parseFloat(agingData[t.k]) || 0;
        return '<div class="aging-chip ' + (v > 0 ? t.cls : 'bg-light') + '"><div class="lbl">' + t.lbl + '</div><div class="val">' + fmt(v) + '</div></div>';
    }).join('');
}

/* ── Filtros / rangos ── */
document.getElementById('btnFiltrar').addEventListener('click', () => { pagina = 1; cargarLibro(); });
document.getElementById('filtroBusqueda').addEventListener('keydown', e => { if (e.key === 'Enter') { pagina = 1; cargarLibro(); } });
document.querySelectorAll('[data-rango]').forEach(btn => btn.addEventListener('click', () => {
    const hoy = hoyLocal(); const d = new Date();
    if (btn.dataset.rango === 'hoy') { setFechas(hoy, hoy); }
    else if (btn.dataset.rango === 'semana') { const x = new Date(d); x.setDate(d.getDate() - 7); setFechas(fmtDateInput(x), hoy); }
    else if (btn.dataset.rango === 'mes') { const x = new Date(d.getFullYear(), d.getMonth(), 1); setFechas(fmtDateInput(x), hoy); }
    else { setFechas('', ''); }
    pagina = 1; cargarLibro();
}));
const fmtDateInput = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function setFechas(d, h) { document.getElementById('filtroDesde').value = d; document.getElementById('filtroHasta').value = h; }
function limpiarFiltros(recargar = true) {
    setFechas('', '');
    document.getElementById('filtroBusqueda').value = '';
    document.getElementById('filtroFormaPago').value = '';
    pagina = 1;
    if (recargar) cargarLibro();
}
document.getElementById('btnLimpiarFiltros').addEventListener('click', () => limpiarFiltros());
document.getElementById('btnLimpiar').addEventListener('click', () => {
    clienteActual = null; inputBuscar.value = '';
    document.getElementById('panelCliente').classList.add('d-none');
    document.getElementById('sinCliente').classList.remove('d-none');
    inputBuscar.focus();
});
document.getElementById('pagPrev').addEventListener('click', () => { if (pagina > 1) { pagina--; cargarLibro(); } });
document.getElementById('pagNext').addEventListener('click', () => { pagina++; cargarLibro(); });

/* ── Modal documento origen (mismo gesto que cc-proveedores) ── */
async function abrirDoc(idx) {
    const m = libroData.movimientos[idx];
    const titulo = document.getElementById('docTitulo'), cuerpo = document.getElementById('docBody'), acciones = document.getElementById('docAcciones');
    acciones.innerHTML = '<button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>';
    let html = '<table class="table table-sm"><tbody>' +
        '<tr><th style="width:160px">Fecha</th><td>' + new Date(m.fecha).toLocaleString('es-AR') + '</td></tr>' +
        '<tr><th>Concepto</th><td>' + m.concepto + '</td></tr>' +
        '<tr><th>Debe / Haber</th><td>' + fmt(m.debe) + ' / ' + fmt(m.haber) + '</td></tr>' +
        '<tr><th>Saldo al asiento</th><td>' + fmt(m.saldo) + '</td></tr>';
    titulo.textContent = 'Movimiento de cuenta corriente';
    if (m.id_pedido) {
        titulo.textContent = 'Pedido #' + (m.nro_pedido || m.id_pedido);
        acciones.innerHTML += '<a class="btn btn-outline-primary" target="_blank" href="/ver-pedido.html?id=' + m.id_pedido + '"><i class="bi bi-box-arrow-up-right"></i> Ver pedido completo</a>';
    }
    if (m.id_factura) {
        titulo.textContent = 'Factura ' + (m.factura_numero || '#' + m.id_factura);
        html += '<tr><th>Estado</th><td><span class="badge bg-' + (m.factura_estado === 'anulada' ? 'secondary' : 'info') + '">' + (m.factura_estado || '-') + '</span></td></tr>';
        acciones.innerHTML += '<a class="btn btn-outline-primary" target="_blank" href="/ver-factura.html?id=' + m.id_factura + '"><i class="bi bi-box-arrow-up-right"></i> Ver factura</a>';
    }
    if (m.id_nota) titulo.textContent = (m.tipo_nota === 'credito' ? 'Nota de Crédito ' : 'Nota de Débito ') + (m.nota_numero || '');
    if (m.id_recibo) titulo.textContent = 'Recibo ' + (m.recibo_numero || '#' + m.id_recibo);
    html += '</tbody></table><div class="small text-muted">Todo asiento queda con vínculo a su documento origen. Las correcciones se hacen por contra-asiento, nunca por borrado.</div>';
    cuerpo.innerHTML = html;
    new bootstrap.Modal(document.getElementById('modalDoc')).show();
}

/* ── Modal COBRO ── */
async function abrirCobro() {
    if (!clienteActual) return;
    if (!formasPago.length) {
        const r = await fetch(API_URL + '/cobranzas/form-data-cobro', { headers: getHeaders() });
        const d = await r.json();
        formasPago = d.formas_pago || []; wpPlantilla = d.whatsapp_plantilla || '';
    }
    itemsPagoCobro = []; formaSeleccionada = null;
    document.getElementById('cobroClienteNombre').textContent = clienteActual.razon_social;
    document.getElementById('cobroMonto').value = '';
    document.getElementById('cobroReferencia').value = '';
    document.getElementById('cobroConcepto').value = '';
    document.getElementById('chkACuenta').checked = false;
    const _chkDev = document.getElementById('chkDevolucion');
    if (_chkDev) { _chkDev.checked = false; aplicarModoDevolucion(false); }
    document.getElementById('wrapImputaciones').classList.remove('d-none');
    document.getElementById('cobroError').classList.add('d-none');
    pintarFormas(); pintarItemsPago();
    // Pendientes precargados (FIFO por antigüedad — solo estados que computan deuda)
    const rp = await fetch(API_URL + '/pedidos/pendientes-cobro?id_cliente=' + clienteActual.id_cliente, { headers: getHeaders() });
    const pend = rp.ok ? await rp.json() : [];
    document.getElementById('tablaPendientes').innerHTML = pend.length ? pend.map(p =>
        '<tr><td><input type="checkbox" class="form-check-input chk-pend" checked data-id="' + p.id_pedido + '"></td>' +
        '<td>#' + (p.nro_pedido || p.id_pedido) + '</td><td>' + fch(p.fecha_creacion) + '</td>' +
        '<td class="col-num">' + fmt(p.saldo_pendiente) + '</td>' +
        '<td><input type="number" class="form-control form-control-sm text-end imp-monto" step="0.01" min="0" max="' + p.saldo_pendiente + '" value="' + Number(p.saldo_pendiente).toFixed(2) + '" data-id="' + p.id_pedido + '"></td></tr>'
    ).join('') : '<tr><td colspan="5" class="text-muted">Sin pedidos pendientes — el cobro entra "a cuenta".</td></tr>';
    actualizarResumenCobro();
    document.querySelectorAll('.imp-monto, .chk-pend').forEach(el => el.addEventListener('input', actualizarResumenCobro));
    new bootstrap.Modal(document.getElementById('modalCobro')).show();
    setTimeout(() => document.getElementById('cobroMonto').focus(), 400);
}
function pintarFormas() {
    document.getElementById('formasPago').innerHTML = formasPago.map(f =>
        '<button type="button" class="btn fp-btn ' + (f.color_clase || 'btn-outline-secondary') + (formaSeleccionada === f.id_forma_pago ? ' activo' : '') + '" data-id="' + f.id_forma_pago + '">' +
        (f.icono ? '<i class="' + (f.icono.startsWith('bi') ? 'bi ' : 'fa ') + f.icono + '"></i><br>' : '') + f.nombre + '</button>').join('');
    document.querySelectorAll('.fp-btn').forEach(b => b.addEventListener('click', () => {
        formaSeleccionada = parseInt(b.dataset.id);
        const f = formasPago.find(x => x.id_forma_pago === formaSeleccionada);
        document.getElementById('wrapReferencia').classList.toggle('d-none', !f?.requiere_referencia);
        pintarFormas();
        document.getElementById('cobroMonto').focus();
    }));
}
document.getElementById('btnAgregarPago').addEventListener('click', agregarItemPago);
document.getElementById('cobroMonto').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); agregarItemPago(); } });
function agregarItemPago() {
    const monto = parseFloat(document.getElementById('cobroMonto').value);
    const err = document.getElementById('cobroError');
    if (!formaSeleccionada) { err.textContent = 'Elegí una forma de pago.'; err.classList.remove('d-none'); return; }
    if (!monto || monto <= 0) { err.textContent = 'Ingresá un monto mayor a 0.'; err.classList.remove('d-none'); return; }
    err.classList.add('d-none');
    const f = formasPago.find(x => x.id_forma_pago === formaSeleccionada);
    itemsPagoCobro.push({ id_forma_pago: formaSeleccionada, monto, nombre: f.nombre, referencia: document.getElementById('cobroReferencia').value.trim() || null });
    document.getElementById('cobroMonto').value = ''; document.getElementById('cobroReferencia').value = '';
    pintarItemsPago(); actualizarResumenCobro();
}
function pintarItemsPago() {
    document.getElementById('itemsPago').innerHTML = itemsPagoCobro.map((it, i) =>
        '<li class="list-group-item d-flex justify-content-between align-items-center py-1">' +
        '<span>' + it.nombre + (it.referencia ? ' <span class="small text-muted">(' + it.referencia + ')</span>' : '') + '</span>' +
        '<span>' + fmt(it.monto) + ' <i class="bi bi-x-circle text-danger ms-2" style="cursor:pointer" data-i="' + i + '"></i></span></li>').join('');
    document.querySelectorAll('#itemsPago i').forEach(el => el.addEventListener('click', () => {
        itemsPagoCobro.splice(parseInt(el.dataset.i), 1); pintarItemsPago(); actualizarResumenCobro();
    }));
    document.getElementById('cobroTotal').textContent = fmt(itemsPagoCobro.reduce((s, i) => s + i.monto, 0));
}
document.getElementById('chkACuenta').addEventListener('change', e => {
    document.getElementById('wrapImputaciones').classList.toggle('d-none', e.target.checked);
    actualizarResumenCobro();
});
function imputacionesActuales() {
    if (document.getElementById('chkACuenta').checked) return [];
    const out = [];
    document.querySelectorAll('.chk-pend:checked').forEach(chk => {
        const id = chk.dataset.id;
        const inp = document.querySelector('.imp-monto[data-id="' + id + '"]');
        const m = parseFloat(inp?.value);
        if (m > 0) out.push({ id_pedido: parseInt(id), monto: m });
    });
    return out;
}
function actualizarResumenCobro() {
    const total = itemsPagoCobro.reduce((s, i) => s + i.monto, 0);
    const imput = imputacionesActuales().reduce((s, i) => s + i.monto, 0);
    const aCuenta = Math.max(0, total - imput);
    document.getElementById('cobroResumen').innerHTML =
        'Cobrando <strong>' + fmt(total) + '</strong> — imputa ' + fmt(Math.min(imput, total)) +
        (aCuenta > 0.01 ? ' · a cuenta ' + fmt(aCuenta) : '') +
        (imput > total + 0.01 ? ' <span class="text-danger">⚠ imputado supera lo cobrado</span>' : '');
}
function aplicarModoDevolucion(on) {
    document.getElementById('wrapImputaciones').classList.toggle('d-none', on || document.getElementById('chkACuenta').checked);
    document.getElementById('chkACuenta').disabled = on;
    const btn = document.getElementById('btnConfirmarCobro');
    btn.className = on ? 'btn btn-danger' : 'btn btn-success';
    btn.innerHTML = on
        ? '<i class="bi bi-arrow-return-left"></i> Confirmar DEVOLUCIÓN <kbd class="ms-1">F2</kbd>'
        : '<i class="bi bi-check-circle"></i> Confirmar cobro <kbd class="ms-1">F2</kbd>';
    const conc = document.getElementById('cobroConcepto');
    conc.placeholder = on ? 'MOTIVO de la devolución (obligatorio, mín. 5 caracteres)' : 'Concepto (opcional, ej: Pago semanal)';
    conc.classList.toggle('border-danger', on);
    document.querySelector('#modalCobro .modal-title').innerHTML = on
        ? '<i class="bi bi-arrow-return-left text-danger"></i> Devolver dinero — <span id="cobroClienteNombre">' + (clienteActual?.razon_social || '') + '</span>'
        : '<i class="bi bi-cash-coin"></i> Registrar cobro — <span id="cobroClienteNombre">' + (clienteActual?.razon_social || '') + '</span>';
}
document.getElementById('chkDevolucion')?.addEventListener('change', e => aplicarModoDevolucion(e.target.checked));

const ERRORES_NEGOCIO = {
    MOTIVO_REQUERIDO: 'La devolución requiere un motivo (mínimo 5 caracteres).',
    DEVOLUCION_EXCEDE_SALDO: 'La devolución supera el saldo a favor del cliente.',
    CAJA_CERRADA: 'No hay caja abierta para tu usuario. Abrí la caja antes de cobrar.',
    IMPUTACION_EXCEDE_SALDO: 'Una imputación supera el saldo del pedido. Revisá los montos.',
    SUMA_INCONSISTENTE: 'Lo imputado supera lo cobrado. Ajustá los montos.',
    PEDIDO_NO_COBRABLE: 'Uno de los pedidos está anulado/cancelado y no admite cobros.',
    COTIZACION_NO_DISPONIBLE: 'Falta cotización vigente para la moneda. Cargala primero.',
    FORMA_SIN_METODO_EQUIVALENTE: 'La forma de pago no tiene método de caja configurado (Configuraciones).',
    CF_SIN_CC: 'Consumidor Final no tiene cuenta corriente.',
    IMPUTACION_PARCIAL_PROHIBIDA: 'La imputación parcial está deshabilitada por configuración.'
};
async function confirmarCobro() {
    const err = document.getElementById('cobroError');
    err.classList.add('d-none');
    if (!itemsPagoCobro.length) { err.textContent = 'Agregá al menos una forma de pago con monto.'; err.classList.remove('d-none'); return; }
    const btn = document.getElementById('btnConfirmarCobro');
    btn.disabled = true;
    try {
        const esDevolucion = document.getElementById('chkDevolucion')?.checked === true;
        const conceptoVal = document.getElementById('cobroConcepto').value.trim();
        if (esDevolucion && conceptoVal.length < 5) {
            err.textContent = ERRORES_NEGOCIO.MOTIVO_REQUERIDO; err.classList.remove('d-none');
            document.getElementById('btnConfirmarCobro').disabled = false; return;
        }
        const body = esDevolucion
            ? { items_pago: itemsPagoCobro.map(i => ({ id_forma_pago: i.id_forma_pago, monto: i.monto, referencia: i.referencia })),
                motivo: conceptoVal }
            : { items_pago: itemsPagoCobro.map(i => ({ id_forma_pago: i.id_forma_pago, monto: i.monto, referencia: i.referencia })),
                imputaciones: imputacionesActuales(),
                modo: document.getElementById('chkACuenta').checked ? 'a_cuenta' : 'imputar',
                concepto: conceptoVal || null };
        const res = await fetch(API_URL + '/cobranzas/cuenta-corriente/' + clienteActual.id_cliente + (esDevolucion ? '/devolver' : '/cobrar'), {
            method: 'POST', headers: getHeaders(), body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) { err.textContent = ERRORES_NEGOCIO[data.code] || data.error || 'Error al registrar el cobro'; err.classList.remove('d-none'); return; }
        bootstrap.Modal.getInstance(document.getElementById('modalCobro')).hide();
        toast(data.tipo === 'devolucion'
            ? 'DEVOLUCIÓN ' + data.numero_completo + ' registrada: ' + fmt(data.total_ars)
            : 'Recibo ' + data.numero_completo + ' registrado: ' + fmt(data.total_ars) +
              (data.a_cuenta > 0.01 ? ' (' + fmt(data.a_cuenta) + ' a cuenta)' : ''),
            data.tipo === 'devolucion' ? 'danger' : 'success');
        // Refrescar TODO desde la BD (el frontend nunca recalcula)
        await seleccionarCliente({ id_cliente: clienteActual.id_cliente });
    } catch (e) { err.textContent = e.message; err.classList.remove('d-none'); }
    finally { btn.disabled = false; }
}
document.getElementById('btnCobrar').addEventListener('click', abrirCobro);
document.getElementById('btnConfirmarCobro').addEventListener('click', confirmarCobro);

/* ── Resumen / CSV / WhatsApp / Print ── */
async function abrirResumen() {
    if (!clienteActual) return;
    const f = filtrosActivos();
    const qs = new URLSearchParams(f).toString();
    const res = await fetch(API_URL + '/cobranzas/cuenta-corriente/' + clienteActual.id_cliente + '/resumen/html' + (qs ? '?' + qs : ''), { headers: getHeaders() });
    if (!res.ok) { toast('Error generando el resumen', 'danger'); return; }
    const html = await res.text();
    const w = window.open('', '_blank');
    w.document.write(html); w.document.close();
}
async function descargarCSV() {
    if (!clienteActual) return;
    const qs = new URLSearchParams(filtrosActivos()).toString();
    const res = await fetch(API_URL + '/cobranzas/cuenta-corriente/' + clienteActual.id_cliente + '/libro/export' + (qs ? '?' + qs : ''), { headers: getHeaders() });
    if (!res.ok) { toast('Error exportando', 'danger'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'CC_' + (clienteActual.razon_social || 'cliente').replace(/[^a-zA-Z0-9]/g, '_') + '.csv';
    a.click(); URL.revokeObjectURL(a.href);
}
function abrirWhatsApp() {
    const tel = (limpio(clienteActual?.telefono) || '').replace(/\D/g, '');
    if (tel.length < 8) return;
    const telAR = tel.startsWith('54') ? tel : '54' + tel;
    const msg = (wpPlantilla || 'Resumen de cuenta al {fecha}. Saldo: {saldo}.')
        .replace('{fecha}', fch(new Date())).replace('{saldo}', fmt(libroData?.saldo_actual || clienteActual.saldo_actual));
    window.open('https://wa.me/' + telAR + '?text=' + encodeURIComponent(msg), '_blank');
}
document.getElementById('btnResumen').addEventListener('click', abrirResumen);
document.getElementById('btnCSV').addEventListener('click', descargarCSV);
document.getElementById('btnWhatsApp').addEventListener('click', abrirWhatsApp);
document.getElementById('btnPrint').addEventListener('click', () => window.print());

/* ── Atajos ── */
document.addEventListener('keydown', e => {
    const modalCobroAbierto = document.getElementById('modalCobro').classList.contains('show');
    if (e.key === 'F2') { e.preventDefault(); modalCobroAbierto ? confirmarCobro() : (clienteActual && abrirCobro()); }
    else if (e.key === 'F3') { e.preventDefault(); inputBuscar.focus(); inputBuscar.select(); }
    else if (e.key === 'F4') { e.preventDefault(); clienteActual && abrirResumen(); }
    else if (e.key === 'F8') { e.preventDefault(); clienteActual && descargarCSV(); }
});

/* ── Deep-link: ?id_cliente=N (desde tesorería u otra pantalla) ── */
(function init() {
    // Precargar formas de pago en background
    fetch(API_URL + '/cobranzas/form-data-cobro', { headers: getHeaders() })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { formasPago = d.formas_pago || []; wpPlantilla = d.whatsapp_plantilla || '';
            document.getElementById('filtroFormaPago').innerHTML = '<option value="">Todas</option>' +
                formasPago.map(f => '<option value="' + f.id_forma_pago + '">' + f.nombre + '</option>').join('');
        }}).catch(() => {});
    const idc = new URLSearchParams(location.search).get('id_cliente');
    if (idc) seleccionarCliente({ id_cliente: parseInt(idc) });
})();
