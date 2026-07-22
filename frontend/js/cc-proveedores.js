/* Libro Mayor de Proveedores — hub CC + pago in-place + documento origen.
   Consume: GET  /pagos-proveedores/cuenta-corriente/:id/libro
            GET  /pagos-proveedores/cuenta-corriente/:id/libro/export
            GET  /pagos-proveedores/form-data | /facturas-pendientes/:id
            POST /pagos-proveedores            (registrarPago)
            POST /pagos-proveedores/:id/anular
            GET  /compras/:id | POST /compras/:id/anular
            GET  /compras/print/orden-pago/:id */
const API_URL = window.CONFIG?.API_BASE_URL || '/api';
const TOKEN_KEY = window.CONFIG?.TOKEN_KEY || 'authToken';
function getHeaders() { return { 'Authorization': 'Bearer ' + (localStorage.getItem(TOKEN_KEY) || ''), 'Content-Type': 'application/json' }; }
function logout() { localStorage.removeItem(TOKEN_KEY); window.location.href = '/login.html'; }

function asArray(x) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object') { for (const k of Object.keys(x)) { if (Array.isArray(x[k])) return x[k]; } }
    return [];
}
let proveedorActual = null, libroData = null, paginaActual = 1, proveedoresCache = [];
let mpFormData = null, mpFacturasPend = [];

const fmt = n => '$ ' + (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoyLocal = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function toast(msg, tipo) {
    const el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-' + (tipo || 'success') + ' border-0 show';
    el.innerHTML = '<div class="d-flex"><div class="toast-body">' + msg + '</div><button class="btn-close btn-close-white me-2 m-auto" onclick="this.closest(\'.toast\').remove()"></button></div>';
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), 5000);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('filtroDesde').value = hoyLocal();
    document.getElementById('filtroHasta').value = hoyLocal();
    document.addEventListener('keydown', e => {
        if (e.key === 'F3') { e.preventDefault(); document.getElementById('inputBuscarProveedor').focus(); }
        if (e.key === 'F2' && document.getElementById('modalPago').classList.contains('show')) { e.preventDefault(); confirmarPago(); }
        if (e.key === 'Escape') document.getElementById('listaProveedores').style.display = 'none';
    });
    const input = document.getElementById('inputBuscarProveedor');
    let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => buscarProveedores(input.value), 300); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && proveedoresCache.length) { e.preventDefault(); seleccionarProveedor(proveedoresCache[0]); } });
    document.addEventListener('click', e => { const l = document.getElementById('listaProveedores'); if (!l.contains(e.target) && e.target !== input) l.style.display = 'none'; });
    const params = new URLSearchParams(window.location.search);
    if (params.get('id_proveedor')) cargarProveedorDirecto(parseInt(params.get('id_proveedor')));
});

async function buscarProveedores(termino) {
    const lista = document.getElementById('listaProveedores');
    if (!termino || termino.trim().length < 2) { lista.style.display = 'none'; return; }
    try {
        const res = await fetch(API_URL + '/proveedores/buscar?q=' + encodeURIComponent(termino), { headers: getHeaders() });
        const data = await res.json();
        proveedoresCache = asArray(data);
        lista.innerHTML = proveedoresCache.map((p, i) =>
            '<button type="button" class="list-group-item list-group-item-action" onclick="seleccionarProveedor(proveedoresCache[' + i + '])">' +
            '<b>' + p.razon_social + '</b> <span class="text-muted small">' + (p.cuit || '') + '</span></button>').join('');
        lista.style.display = proveedoresCache.length ? 'block' : 'none';
    } catch (e) { console.error(e); }
}
async function cargarProveedorDirecto(id) {
    try {
        const res = await fetch(API_URL + '/proveedores/' + id, { headers: getHeaders() });
        const data = await res.json();
        let prov = data.data || data;
        if (Array.isArray(prov)) prov = prov[0];
        if (prov && prov.id_proveedor) seleccionarProveedor(prov);
    } catch (e) { console.error(e); }
}
function seleccionarProveedor(p) {
    proveedorActual = p;
    document.getElementById('listaProveedores').style.display = 'none';
    document.getElementById('inputBuscarProveedor').value = p.razon_social;
    document.getElementById('provNombre').textContent = p.razon_social;
    document.getElementById('provCuit').textContent = (p.cuit ? 'CUIT ' + p.cuit : '') + (p.nombre_fantasia ? ' · ' + p.nombre_fantasia : '');
    document.getElementById('panelProveedor').style.display = '';
    cargarLibro(1);
}
function limpiarFiltros() {
    document.getElementById('filtroDesde').value = hoyLocal();
    document.getElementById('filtroHasta').value = hoyLocal();
    document.getElementById('chkAnulados').checked = false;
    if (proveedorActual) cargarLibro(1);
}
function moverDias(n) {
    ['filtroDesde', 'filtroHasta'].forEach(id => {
        const el = document.getElementById(id);
        if (!el.value) return;
        const [y, m, d] = el.value.split('-').map(Number);
        const dt = new Date(y, m - 1, d + n);
        el.value = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
    });
    if (proveedorActual) cargarLibro(1);
}
function irHoy() { limpiarFiltros(); }

async function cargarLibro(pagina) {
    if (!proveedorActual) return;
    paginaActual = Math.max(1, pagina || 1);
    const desde = document.getElementById('filtroDesde').value, hasta = document.getElementById('filtroHasta').value;
    const qs = new URLSearchParams({ pagina: paginaActual });
    if (desde) qs.set('desde', desde); if (hasta) qs.set('hasta', hasta);
    if (document.getElementById('chkAnulados').checked) qs.set('incluir_anulados', 'true');
    try {
        const res = await fetch(API_URL + '/pagos-proveedores/cuenta-corriente/' + proveedorActual.id_proveedor + '/libro?' + qs, { headers: getHeaders() });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Error al cargar libro'); }
        libroData = await res.json();
        renderLibro(desde, hasta);
    } catch (e) { toast(e.message, 'danger'); }
}

function renderLibro(desde, hasta) {
    const d = libroData, cuerpo = document.getElementById('cuerpoLibro');
    const saldoEl = document.getElementById('provSaldo');
    saldoEl.textContent = fmt(d.saldo_actual);
    saldoEl.className = 'saldo-grande ' + (d.saldo_actual > 0.01 ? 'saldo-positivo' : (d.saldo_actual < -0.01 ? 'saldo-favor' : 'saldo-cero'));
    const agregado = parseFloat(proveedorActual.saldo_actual);
    document.getElementById('badgeConciliacion').style.display =
        (!isNaN(agregado) && Math.abs(agregado - d.saldo_actual) > 0.01) ? '' : 'none';

    const chips = [];
    if (desde) chips.push({ l: 'Desde: ' + desde, id: 'filtroDesde' });
    if (hasta) chips.push({ l: 'Hasta: ' + hasta, id: 'filtroHasta' });
    if (document.getElementById('chkAnulados').checked) chips.push({ l: 'Mostrando anulados', id: 'chkAnulados' });
    document.getElementById('chipsFiltros').innerHTML = chips.map(c =>
        '<span class="chip">' + c.l + ' <span class="x" onclick="quitarFiltro(\'' + c.id + '\')">&times;</span></span>').join('');

    if (!d.movimientos.length) {
        document.getElementById('tablaLibro').style.display = 'none';
        document.getElementById('paginacion').style.display = 'none';
        const sr = document.getElementById('sinResultados');
        sr.style.display = '';
        sr.textContent = 'Sin movimientos con estos filtros: ' + chips.map(c => c.l).join(' · ') +
            (desde ? ' — Saldo anterior arrastrado: ' + fmt(d.saldo_anterior) : '');
        return;
    }
    document.getElementById('sinResultados').style.display = 'none';
    document.getElementById('tablaLibro').style.display = '';

    let html = '';
    if (desde) html += '<tr class="fila-saldo-anterior"><td colspan="5">Saldo anterior al ' + desde + '</td><td class="col-num">' + fmt(d.saldo_anterior) + '</td></tr>';
    for (let i = 0; i < d.movimientos.length; i++) {
        const m = d.movimientos[i];
        const anulado = m.comprobante_estado === 'anulado' || m.pago_estado === 'anulado';
        const esInfo = parseFloat(m.debe) === 0 && parseFloat(m.haber) === 0;
        const tipo = m.comprobante_tipo || (m.id_pago_proveedor ? 'PAGO' : '');
        const clases = ['fila-doc', anulado ? 'fila-anulada' : '', esInfo ? 'fila-info' : ''].join(' ');
        html += '<tr class="' + clases + '" onclick="abrirDoc(' + i + ')">' +
            '<td>' + new Date(m.fecha).toLocaleDateString('es-AR') + '</td>' +
            '<td><span class="concepto-txt">' + m.concepto + '</span>' + (anulado ? ' <span class="badge bg-secondary">Anulado</span>' : '') + '</td>' +
            '<td>' + (tipo ? '<span class="badge bg-light text-dark border">' + tipo + '</span>' : '') + '</td>' +
            '<td class="col-num">' + (parseFloat(m.debe) ? fmt(m.debe) : '') + '</td>' +
            '<td class="col-num">' + (parseFloat(m.haber) ? fmt(m.haber) : '') + '</td>' +
            '<td class="col-num">' + fmt(m.saldo) + '</td></tr>';
    }
    html += '<tr class="fila-totales"><td colspan="3">Totales del período (' + d.total_movimientos + ' mov.)</td>' +
        '<td class="col-num">' + fmt(d.total_debe) + '</td><td class="col-num">' + fmt(d.total_haber) + '</td>' +
        '<td class="col-num">' + fmt(d.saldo_actual) + '</td></tr>';
    cuerpo.innerHTML = html;

    const totalPags = Math.max(1, Math.ceil(d.total_movimientos / d.items_por_pagina));
    document.getElementById('paginacion').style.display = totalPags > 1 ? '' : 'none';
    document.getElementById('lblPagina').textContent = 'Página ' + d.pagina + ' de ' + totalPags;
    document.getElementById('btnPagPrev').disabled = d.pagina <= 1;
    document.getElementById('btnPagNext').disabled = d.pagina >= totalPags;
}
function quitarFiltro(id) { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = false; else el.value = ''; cargarLibro(1); }

async function exportarCSV() {
    if (!proveedorActual) return;
    const desde = document.getElementById('filtroDesde').value, hasta = document.getElementById('filtroHasta').value;
    const qs = new URLSearchParams(); if (desde) qs.set('desde', desde); if (hasta) qs.set('hasta', hasta);
    if (document.getElementById('chkAnulados').checked) qs.set('incluir_anulados', 'true');
    try {
        const res = await fetch(API_URL + '/pagos-proveedores/cuenta-corriente/' + proveedorActual.id_proveedor + '/libro/export?' + qs, { headers: getHeaders() });
        if (!res.ok) throw new Error('Error al exportar');
        const blob = await res.blob(), a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'libro_' + proveedorActual.razon_social.replace(/\W+/g, '_') + '.csv';
        a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast(e.message, 'danger'); }
}

/* ══════════ MODAL PAGO ══════════ */
async function abrirModalPago() {
    if (!proveedorActual) return;
    document.getElementById('mpProveedor').textContent = proveedorActual.razon_social;
    document.getElementById('mpError').style.display = 'none';
    document.getElementById('mpObservaciones').value = '';
    document.getElementById('mpLinkFormCompleto').href = '/pagos-proveedores.html?id_proveedor=' + proveedorActual.id_proveedor;
    try {
        if (!mpFormData) {
            const r = await fetch(API_URL + '/pagos-proveedores/form-data', { headers: getHeaders() });
            mpFormData = (await r.json()).data;
        }
        const rf = await fetch(API_URL + '/pagos-proveedores/facturas-pendientes/' + proveedorActual.id_proveedor, { headers: getHeaders() });
        mpFacturasPend = (await rf.json()).data || [];
    } catch (e) { toast('Error cargando datos del pago', 'danger'); return; }
    document.getElementById('mpFacturas').innerHTML = mpFacturasPend.length ? mpFacturasPend.map((f, i) =>
        '<tr><td><input type="checkbox" class="form-check-input mp-chk" data-i="' + i + '" onchange="mpRecalcular()"></td>' +
        '<td>' + f.numero_completo + ' <span class="badge bg-light text-dark border">' + f.tipo_codigo + '</span>' +
        (f.estado_vencimiento === 'vencida' ? ' <span class="badge bg-danger">Vencida</span>' : '') + '</td>' +
        '<td>' + (f.fecha_vencimiento ? new Date(f.fecha_vencimiento).toLocaleDateString('es-AR') : '-') + '</td>' +
        '<td class="col-num">' + fmt(f.saldo) + '</td>' +
        '<td><input type="number" step="0.01" min="0" max="' + f.saldo + '" class="form-control form-control-sm mp-monto" data-i="' + i + '" value="' + parseFloat(f.saldo).toFixed(2) + '" oninput="mpRecalcular()"></td></tr>'
    ).join('') : '<tr><td colspan="5" class="text-muted">Sin comprobantes pendientes — usá "Pago a cuenta".</td></tr>';
    document.getElementById('mpFormas').innerHTML = '';
    mpAgregarForma();
    document.getElementById('mpModoImputar').checked = mpFacturasPend.length > 0;
    document.getElementById('mpModoCuenta').checked = mpFacturasPend.length === 0;
    mpToggleModo(); mpRecalcular();
    new bootstrap.Modal(document.getElementById('modalPago')).show();
}
function mpToggleModo() {
    document.getElementById('mpSeccionFacturas').style.display = document.getElementById('mpModoCuenta').checked ? 'none' : '';
    mpRecalcular();
}
function mpAgregarForma() {
    const div = document.createElement('div');
    div.className = 'row g-2 mb-1 mp-forma';
    div.innerHTML =
        '<div class="col-6"><select class="form-select form-select-sm mp-fp" onchange="mpRecalcular()">' +
        (mpFormData.formasPago || []).map(fp => '<option value="' + fp.id_forma_pago + '">' + fp.nombre + '</option>').join('') +
        '</select></div>' +
        '<div class="col-4"><input type="number" step="0.01" min="0" class="form-control form-control-sm mp-fp-monto" placeholder="Monto" oninput="mpRecalcular()"></div>' +
        '<div class="col-2"><button class="btn btn-sm btn-outline-danger" onclick="this.closest(\'.mp-forma\').remove(); mpRecalcular()"><i class="bi bi-trash"></i></button></div>';
    document.getElementById('mpFormas').appendChild(div);
}
function mpFormasSeleccionadas() {
    return Array.from(document.querySelectorAll('.mp-forma')).map(row => ({
        id_forma_pago: parseInt(row.querySelector('.mp-fp').value),
        nombre: row.querySelector('.mp-fp option:checked').textContent,
        monto: parseFloat(row.querySelector('.mp-fp-monto').value) || 0
    })).filter(f => f.monto > 0);
}
function mpFacturasSeleccionadas() {
    return Array.from(document.querySelectorAll('.mp-chk:checked')).map(chk => {
        const i = parseInt(chk.dataset.i);
        const monto = parseFloat(document.querySelector('.mp-monto[data-i="' + i + '"]').value) || 0;
        return { id_cuenta: mpFacturasPend[i].id_cuenta, monto_a_pagar: monto };
    }).filter(f => f.monto_a_pagar > 0);
}
function mpRecalcular() {
    const formas = mpFormasSeleccionadas();
    const tieneCheque = formas.some(f => /cheque/i.test(f.nombre));
    document.getElementById('mpAvisoCheque').style.display = tieneCheque ? '' : 'none';
    document.getElementById('btnConfirmarPago').disabled = tieneCheque;
    const totImputar = document.getElementById('mpModoCuenta').checked ? 0 :
        mpFacturasSeleccionadas().reduce((s, f) => s + f.monto_a_pagar, 0);
    document.getElementById('mpTotalImputar').textContent = fmt(totImputar);
    document.getElementById('mpTotalFormas').textContent = fmt(formas.reduce((s, f) => s + f.monto, 0));
}
async function confirmarPago() {
    const err = document.getElementById('mpError'); err.style.display = 'none';
    const esACuenta = document.getElementById('mpModoCuenta').checked;
    const formas = mpFormasSeleccionadas().map(f => ({ id_forma_pago: f.id_forma_pago, monto: f.monto }));
    const facturas = esACuenta ? [] : mpFacturasSeleccionadas();
    if (!formas.length) { err.textContent = 'Cargá al menos una forma de pago con monto.'; err.style.display = ''; return; }
    if (!esACuenta && !facturas.length) { err.textContent = 'Tildá al menos un comprobante o cambiá a "Pago a cuenta".'; err.style.display = ''; return; }
    const btn = document.getElementById('btnConfirmarPago');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';
    try {
        const res = await fetch(API_URL + '/pagos-proveedores', {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({
                id_proveedor: proveedorActual.id_proveedor,
                es_pago_a_cuenta: esACuenta,
                facturas_a_pagar: facturas,
                formas_pago: formas,
                observaciones: document.getElementById('mpObservaciones').value || null
            })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Error al registrar el pago');
        bootstrap.Modal.getInstance(document.getElementById('modalPago')).hide();
        toast('Pago ' + ((result.data && result.data.numero_pago) || '') + ' registrado correctamente');
        cargarProveedorDirecto(proveedorActual.id_proveedor);
    } catch (e) { err.textContent = e.message; err.style.display = ''; }
    finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-circle"></i> Confirmar pago (F2)'; }
}

/* ══════════ MODAL DOCUMENTO ORIGEN ══════════ */
async function abrirDoc(idx) {
    const m = libroData.movimientos[idx];
    const titulo = document.getElementById('docTitulo'), cuerpo = document.getElementById('docCuerpo'), acciones = document.getElementById('docAcciones');
    acciones.innerHTML = '<button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>';
    let html = '<table class="table table-sm"><tbody>' +
        '<tr><th style="width:160px">Fecha</th><td>' + new Date(m.fecha).toLocaleString('es-AR') + '</td></tr>' +
        '<tr><th>Concepto</th><td>' + m.concepto + '</td></tr>' +
        '<tr><th>Debe / Haber</th><td>' + fmt(m.debe) + ' / ' + fmt(m.haber) + '</td></tr>' +
        '<tr><th>Saldo al asiento</th><td>' + fmt(m.saldo) + '</td></tr>';
    if (m.id_comprobante_compra) {
        titulo.textContent = 'Comprobante ' + (m.comprobante_numero || '#' + m.id_comprobante_compra);
        html += '<tr><th>Tipo</th><td>' + (m.comprobante_tipo || '-') + '</td></tr>' +
                '<tr><th>Estado</th><td><span class="badge bg-' + (m.comprobante_estado === 'anulado' ? 'secondary' : 'info') + '">' + (m.comprobante_estado || '-') + '</span></td></tr>';
        if (m.comprobante_estado !== 'anulado' && !m.id_pago_proveedor) {
            acciones.innerHTML += '<button class="btn btn-outline-danger" onclick="anularDoc(\'comprobante\',' + m.id_comprobante_compra + ')"><i class="bi bi-x-circle"></i> Anular comprobante</button>';
        }
    }
    if (m.id_pago_proveedor) {
        titulo.textContent = 'Pago #' + (m.pago_numero || m.id_pago_proveedor);
        html += '<tr><th>Estado del pago</th><td><span class="badge bg-' + (m.pago_estado === 'anulado' ? 'secondary' : 'success') + '">' + (m.pago_estado || '-') + '</span></td></tr>' +
                '<tr><th>Modalidad</th><td>' + (m.es_pago_a_cuenta ? 'A cuenta' : 'Imputado') + '</td></tr>';
        acciones.innerHTML += '<button class="btn btn-outline-primary" onclick="imprimirOrdenPago(' + m.id_pago_proveedor + ')"><i class="bi bi-printer"></i> Orden de pago</button>';
        if (m.pago_estado !== 'anulado') {
            acciones.innerHTML += '<button class="btn btn-outline-danger" onclick="anularDoc(\'pago\',' + m.id_pago_proveedor + ')"><i class="bi bi-x-circle"></i> Anular pago</button>';
        }
    }
    html += '</tbody></table><div class="small text-muted">La anulación es lógica: queda registrada con contra-asiento, usuario, fecha y motivo.</div>';
    cuerpo.innerHTML = html;
    new bootstrap.Modal(document.getElementById('modalDoc')).show();
}
async function anularDoc(tipo, id) {
    const motivo = prompt('Motivo de la anulación (obligatorio):');
    if (!motivo || !motivo.trim()) { toast('La anulación requiere motivo', 'warning'); return; }
    const url = tipo === 'pago' ? API_URL + '/pagos-proveedores/' + id + '/anular' : API_URL + '/compras/' + id + '/anular';
    try {
        const res = await fetch(url, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ motivo: motivo.trim() }) });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'No se pudo anular');
        bootstrap.Modal.getInstance(document.getElementById('modalDoc')).hide();
        toast((tipo === 'pago' ? 'Pago' : 'Comprobante') + ' anulado. Contra-asiento registrado.');
        cargarProveedorDirecto(proveedorActual.id_proveedor);
    } catch (e) { toast(e.message, 'danger'); }
}
async function imprimirOrdenPago(idPago) {
    try {
        const res = await fetch(API_URL + '/compras/print/orden-pago/' + idPago, { headers: getHeaders() });
        if (!res.ok) throw new Error('No se pudo generar la orden de pago');
        const html = await res.text();
        const w = window.open('', '_blank'); w.document.write(html); w.document.close();
    } catch (e) { toast(e.message, 'danger'); }
}
