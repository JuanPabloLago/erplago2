'use strict';
// ============================================================
// TESORERIA.JS - ERP LAGO
// Módulo de Tesorería con búsqueda Google-style y filtros avanzados
// ============================================================

const API_URL = (window.CONFIG && window.CONFIG.API_BASE_URL) || '/api';
const token = localStorage.getItem('authToken');
if (!token) console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

// Estado global
let turnoActual = null;
let clienteSeleccionado = null;
let pagosAgregados = [];
let formaPagoActual = null;
let formasPagoDisponibles = [];
let recargosFormaPago = {}; // Mapa: id_forma_pago → { porcentaje, descripcion, genera_nota_debito }
let tarjetas = [];
let bancos = [];
let monedas = [];
let cotizaciones = {};
let movimientosData = [];
let historialData = [];
let searchResultIndex = -1;

const iconosFormaPago = {
    'EFECTIVO': 'bi-cash-stack', 'TARJETA_CREDITO': 'bi-credit-card', 'TARJETA_DEBITO': 'bi-credit-card-2-front',
    'TRANSFERENCIA': 'bi-bank', 'MERCADOPAGO': 'bi-phone', 'CHEQUE': 'bi-file-earmark-text', 'CHEQUE_TERCERO': 'bi-files'
};

let modalAbrirCaja, modalDetallePago, modalMovimiento;

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    modalAbrirCaja = new bootstrap.Modal(document.getElementById('modalAbrirCaja'));
    modalDetallePago = new bootstrap.Modal(document.getElementById('modalDetallePago'));
    modalMovimiento = new bootstrap.Modal(document.getElementById('modalMovimiento'));
    configurarTabs(); configurarBusquedaClientes(); configurarFiltrosFecha(); configurarAtajosTeclado();
    await cargarCatalogos(); await cargarEstadoCaja();
    const hoy = new Date().toISOString().slice(0, 10);
    document.getElementById('movFechaDesde').value = hoy; document.getElementById('movFechaHasta').value = hoy;
    document.getElementById('histFechaDesde').value = hoy; document.getElementById('histFechaHasta').value = hoy;
    aplicarPresetCierres('mes');
    document.getElementById('montoACobrar').addEventListener('input', calcularResumen);
});

// ============================================================
// CARGA DE DATOS
// ============================================================
async function cargarEstadoCaja() {
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/estado`, { headers });
        if (!res.ok) throw new Error('Error');
        const data = await res.json();
        turnoActual = data.turno;
        actualizarUIEstadoCaja();
    } catch (e) { console.error(e); mostrarNotificacion('Error al cargar estado de caja', 'danger'); }
}

function actualizarUIEstadoCaja() {
    const indicador = document.getElementById('estadoIndicador');
    const texto = document.getElementById('estadoTexto');
    const btnAbrir = document.getElementById('btnAbrirCaja');
    if (turnoActual) {
        indicador.className = 'estado-indicador abierta'; texto.textContent = 'Caja abierta'; btnAbrir.style.display = 'none';
        document.getElementById('headerEfectivoARS').textContent = formatMoney(turnoActual.efectivo_actual_ars || 0);
        document.getElementById('headerEfectivoUSD').textContent = 'US$' + (turnoActual.efectivo_actual_usd || 0).toFixed(2);
        actualizarDatosArqueo();
    } else {
        indicador.className = 'estado-indicador cerrada'; texto.textContent = 'Caja cerrada'; btnAbrir.style.display = 'flex';
        document.getElementById('headerEfectivoARS').textContent = '$0'; document.getElementById('headerEfectivoUSD').textContent = 'US$0';
    }
    calcularResumen();
}

async function cargarCatalogos() {
    try {
        const [fpRes, tarjetasRes, bancosRes, monedasRes] = await Promise.all([
            fetch(`${API_URL}/formas-pago`, { headers }), fetch(`${API_URL}/tarjetas`, { headers }),
            fetch(`${API_URL}/bancos`, { headers }), fetch(`${API_URL}/monedas`, { headers })
        ]);
        formasPagoDisponibles = await fpRes.json(); tarjetas = await tarjetasRes.json();
        bancos = await bancosRes.json(); monedas = await monedasRes.json();
        monedas.forEach(m => { cotizaciones[m.id_moneda] = parseFloat(m.cotizacion || 1); });
        renderizarFormasPago();
        // Cargar recargos/descuentos por forma de pago desde BD
        try {
            const recRes = await fetch(`${API_URL}/recargos-forma-pago/activos`, { headers });
            const recData = await recRes.json();
            recargosFormaPago = {};
            if (recData.success && recData.data) {
                recData.data.forEach(r => { recargosFormaPago[r.id_forma_pago] = r; });
            }
            console.log('[RECARGOS] Cargados:', Object.keys(recargosFormaPago).length, 'activos');
        } catch (e) { console.warn('[RECARGOS] Error cargando recargos:', e); }
    } catch (e) { console.error(e); }
}

// ============================================================
// BÚSQUEDA DE CLIENTES (GOOGLE-STYLE)
// ============================================================
function configurarBusquedaClientes() {
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', debounce(async (e) => {
        const query = e.target.value.trim();
        searchClear.classList.toggle('visible', query.length > 0);
        if (query.length < 2) { searchResults.classList.remove('visible'); return; }
        await buscarClientes(query);
    }, 300));
    searchInput.addEventListener('keydown', navegarResultados);
    searchInput.addEventListener('focus', () => { if (searchInput.value.length >= 2) searchResults.classList.add('visible'); });
    searchClear.addEventListener('click', () => {
        searchInput.value = ''; searchClear.classList.remove('visible'); searchResults.classList.remove('visible'); searchInput.focus();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.search-container')) searchResults.classList.remove('visible'); });
}

async function buscarClientes(query) {
    const searchResults = document.getElementById('searchResults');
    try {
        const response = await fetch(`${API_URL}/clientes/buscar-cobranzas?q=${encodeURIComponent(query)}`, { headers });
        if (!response.ok) return;
        const clientes = await response.json();
        if (clientes.length === 0) {
            searchResults.innerHTML = `<div class="search-result-item" style="cursor:default;"><i class="bi bi-search text-muted" style="font-size:1.5rem;"></i><span class="text-muted">No se encontraron clientes</span></div>`;
        } else {
            searchResults.innerHTML = clientes.slice(0, 10).map((c, index) => `
                <div class="search-result-item" data-id="${c.id_cliente}" data-index="${index}" onclick="seleccionarClienteBusqueda(${c.id_cliente})">
                    <div class="search-result-icon">${(c.razon_social || '?').charAt(0).toUpperCase()}</div>
                    <div class="search-result-info">
                        <div class="search-result-name">${c.razon_social}${c.nombre_fantasia ? ` <small style="color:#888;">(${c.nombre_fantasia})</small>` : ''}</div>
                        <div class="search-result-meta"><span style="color:#1a5f7a;font-weight:500;">#${c.id_cliente}</span>${c.cuit_cuil ? ` · <i class="bi bi-credit-card"></i> ${c.cuit_cuil}` : ''}${c.telefono ? ` · <i class="bi bi-telephone"></i> ${c.telefono}` : ''}</div>
                        <div class="search-result-meta" style="font-size:0.75rem;">${c.domicilio ? `<i class="bi bi-geo-alt"></i> ${c.domicilio}` : ''}${c.localidad ? `, ${c.localidad}` : ''}${c.facturas_pendientes > 0 ? ` · <span style="color:#ef4444;">${c.facturas_pendientes} fact. pend.</span>` : ''}</div>
                    </div>
                    ${c.saldo_pendiente > 0 ? `<div class="search-result-saldo">$${formatNumber(c.saldo_pendiente)}</div>` : `<div class="search-result-saldo sin-deuda"><i class="bi bi-check-circle"></i> Sin deuda</div>`}
                </div>
            `).join('');
        }
        searchResults.classList.add('visible'); searchResultIndex = -1;
    } catch (error) { console.error('Error en búsqueda:', error); }
}

function navegarResultados(e) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults.classList.contains('visible')) return;
    const items = searchResults.querySelectorAll('.search-result-item[data-id]');
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); searchResultIndex = Math.min(searchResultIndex + 1, items.length - 1); actualizarResultadoActivo(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchResultIndex = Math.max(searchResultIndex - 1, 0); actualizarResultadoActivo(items); }
    else if (e.key === 'Enter') { e.preventDefault(); if (searchResultIndex >= 0) seleccionarClienteBusqueda(parseInt(items[searchResultIndex].dataset.id)); }
    else if (e.key === 'Escape') { searchResults.classList.remove('visible'); }
}

function actualizarResultadoActivo(items) {
    items.forEach((item, i) => { item.classList.toggle('active', i === searchResultIndex); if (i === searchResultIndex) item.scrollIntoView({ block: 'nearest' }); });
}

async function seleccionarClienteBusqueda(id_cliente) {
    document.getElementById('searchResults').classList.remove('visible');
    document.getElementById('searchInput').value = ''; document.getElementById('searchClear').classList.remove('visible');
    try {
        const response = await fetch(`${API_URL}/clientes/${id_cliente}`, { headers });
        if (!response.ok) throw new Error('Error');
        const cliente = await response.json();
        clienteSeleccionado = cliente;
        document.getElementById('clientePanel').classList.add('visible');
        document.getElementById('sinClienteCard').style.display = 'none';
        document.getElementById('sinCliente').checked = false;
        document.getElementById('clienteAvatar').textContent = (cliente.razon_social || '?').charAt(0).toUpperCase();
        document.getElementById('clienteNombre').textContent = cliente.razon_social;
        document.getElementById('clienteCuit').textContent = cliente.cuit_cuil || '-';
        document.getElementById('clienteTelefono').textContent = cliente.telefono || '-';
        document.getElementById('clienteDomicilio').textContent = cliente.domicilio || '-';
        const saldo = parseFloat(cliente.saldo_cuenta_corriente || 0);
        const saldoEl = document.getElementById('clienteSaldo');
        saldoEl.textContent = formatMoney(saldo); saldoEl.className = saldo > 0 ? 'monto' : 'monto sin-deuda';
        // Link a Cuenta Corriente
        let linkVerCC = document.getElementById('linkVerCC');
        if (!linkVerCC) {
            linkVerCC = document.createElement('a');
            linkVerCC.id = 'linkVerCC';
            linkVerCC.className = 'btn btn-sm btn-outline-info mt-1 d-block text-center';
            linkVerCC.innerHTML = '<i class="bi bi-journal-text"></i> Ver CC';
            linkVerCC.target = '_blank';
            saldoEl.parentElement.appendChild(linkVerCC);
        }
        linkVerCC.href = 'cuenta-corriente.html?id_cliente=' + cliente.id_cliente;
    } catch (error) { console.error(error); mostrarNotificacion('Error al cargar cliente', 'danger'); }
}

function deseleccionarCliente() {
    clienteSeleccionado = null;
    document.getElementById('clientePanel').classList.remove('visible');
    document.getElementById('sinClienteCard').style.display = 'block';
    document.getElementById('searchInput').focus();
}

function toggleSinCliente() {
    if (document.getElementById('sinCliente').checked) { clienteSeleccionado = null; document.getElementById('clientePanel').classList.remove('visible'); }
}

// ============================================================
// FILTROS DE FECHA
// ============================================================
function configurarFiltrosFecha() {
    document.querySelectorAll('#movPresets .fecha-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#movPresets .fecha-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); aplicarPresetFecha(btn.dataset.preset, 'mov'); cargarMovimientosCaja();
        });
    });
    document.querySelectorAll('#histPresets .fecha-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#histPresets .fecha-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active'); aplicarPresetFecha(btn.dataset.preset, 'hist'); cargarHistorialRecibos();
        });
    });
    ['movFechaDesde', 'movFechaHasta'].forEach(id => { document.getElementById(id).addEventListener('change', () => { document.querySelectorAll('#movPresets .fecha-preset').forEach(b => b.classList.remove('active')); }); });
    ['histFechaDesde', 'histFechaHasta'].forEach(id => { document.getElementById(id).addEventListener('change', () => { document.querySelectorAll('#histPresets .fecha-preset').forEach(b => b.classList.remove('active')); }); });
}

function aplicarPresetFecha(preset, prefix) {
    const hoy = new Date(); let desde, hasta;
    switch(preset) {
        case 'hoy': desde = hasta = hoy.toISOString().slice(0, 10); break;
        case 'ayer': const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1); desde = hasta = ayer.toISOString().slice(0, 10); break;
        case 'semana': const inicioSemana = new Date(hoy); inicioSemana.setDate(hoy.getDate() - hoy.getDay()); desde = inicioSemana.toISOString().slice(0, 10); hasta = hoy.toISOString().slice(0, 10); break;
        case 'mes': desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10); hasta = hoy.toISOString().slice(0, 10); break;
    }
    document.getElementById(`${prefix}FechaDesde`).value = desde; document.getElementById(`${prefix}FechaHasta`).value = hasta;
}

// ============================================================
// TABS
// ============================================================
function configurarTabs() {
    document.querySelectorAll('#navTabs .nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault(); const tabId = e.currentTarget.dataset.tab;
            document.querySelectorAll('#navTabs .nav-link').forEach(l => l.classList.remove('active'));
            e.currentTarget.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
            document.getElementById(`tab-${tabId}`).style.display = 'block';
            if (tabId === 'movimientos') cargarMovimientosCaja();
            if (tabId === 'historial') cargarHistorialRecibos();
            if (tabId === 'arqueo') cargarDatosArqueo();
            if (tabId === 'cierres') { aplicarPresetCierres('mes'); }
        });
    });
}

// ============================================================
// FORMAS DE PAGO
// ============================================================
function renderizarFormasPago() {
    document.getElementById('formasPagoGrid').innerHTML = formasPagoDisponibles.filter(fp => fp.activo !== false).map(fp => `<div class="forma-pago-btn" data-codigo="${fp.codigo}" onclick="seleccionarFormaPago(${fp.id_forma_pago}, '${fp.codigo}', '${fp.tipo || ''}')"><i class="bi ${iconosFormaPago[fp.codigo] || 'bi-wallet2'}"></i><span>${fp.nombre}</span></div>`).join('');
}

function seleccionarFormaPago(id_forma_pago, codigo, tipo) {
    formaPagoActual = { id_forma_pago, codigo, tipo };
    document.querySelectorAll('.forma-pago-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.codigo === codigo));
    const montoBase = parseFloat(document.getElementById('montoACobrar').value) || 0;
    const totalPagos = pagosAgregados.reduce((sum, p) => sum + p.monto, 0);
    const montoRestante = Math.max(0, montoBase - totalPagos);
    if (montoRestante > 0) { prepararModalPago(montoRestante); modalDetallePago.show(); return; }
    if (montoRestante > 0) { prepararModalPago(montoRestante); modalDetallePago.show(); }
}

function prepararModalPago(monto) {
    const fp = formaPagoActual;
    document.getElementById('modalDetalleTitulo').textContent = fp.codigo.replace(/_/g, ' ');
    document.getElementById('detalleMontoInput').value = monto.toFixed(2);
    document.getElementById('detalleReferenciaInput').value = '';
    document.getElementById('detalleRecargoInfo').innerHTML = '';
    const esTarjeta = fp.codigo.includes('TARJETA');
    const necesitaBanco = ['TRANSFERENCIA', 'CHEQUE'].includes(fp.codigo);
    const necesitaRef = necesitaBanco || esTarjeta || fp.codigo === 'MERCADOPAGO';
    document.getElementById('detalleTarjetaGroup').style.display = esTarjeta ? 'block' : 'none';
    document.getElementById('detalleCuotasGroup').style.display = fp.codigo === 'TARJETA_CREDITO' ? 'block' : 'none';
    document.getElementById('detalleBancoGroup').style.display = necesitaBanco ? 'block' : 'none';
    document.getElementById('detalleReferenciaGroup').style.display = necesitaRef ? 'block' : 'none';
    if (esTarjeta) {
        const tipoT = fp.codigo === 'TARJETA_CREDITO' ? 'credito' : 'debito';
        document.getElementById('detalleTarjetaInput').innerHTML = tarjetas.filter(t => t.tipo === tipoT && t.activo).map(t => `<option value="${t.id_tarjeta}" data-i1="${t.interes_1_cuota}" data-i3="${t.interes_3_cuotas}" data-i6="${t.interes_6_cuotas}" data-i12="${t.interes_12_cuotas}">${t.nombre}</option>`).join('');
        document.getElementById('detalleTarjetaInput').onchange = calcularRecargoTarjeta;
        document.getElementById('detalleCuotasInput').onchange = calcularRecargoTarjeta;
    }
    if (necesitaBanco) document.getElementById('detalleBancoInput').innerHTML = '<option value="">Seleccionar...</option>' + bancos.map(b => `<option value="${b.id_banco}">${b.nombre}</option>`).join('');
    // Info dinámica de recargo/descuento desde BD
    const cfgFP = recargosFormaPago[fp.id_forma_pago];
    if (cfgFP && parseFloat(cfgFP.porcentaje) !== 0) {
        const pct = parseFloat(cfgFP.porcentaje);
        const desc = cfgFP.descripcion || fp.nombre || fp.codigo;
        if (pct > 0) {
            document.getElementById('detalleRecargoInfo').innerHTML = `<div class="alert alert-info py-2"><i class="bi bi-arrow-up-circle"></i> ${desc}: <strong>+${pct}%</strong> de recargo</div>`;
        } else {
            document.getElementById('detalleRecargoInfo').innerHTML = `<div class="alert alert-success py-2"><i class="bi bi-arrow-down-circle"></i> ${desc}: <strong>${pct}%</strong> de descuento</div>`;
        }
    }
}

function calcularRecargoTarjeta() {
    const sel = document.getElementById('detalleTarjetaInput');
    const cuotas = parseInt(document.getElementById('detalleCuotasInput').value) || 1;
    if (!sel.value) return;
    const opt = sel.options[sel.selectedIndex];
    let interes = cuotas === 1 ? parseFloat(opt.dataset.i1) : cuotas === 3 ? parseFloat(opt.dataset.i3) : cuotas === 6 ? parseFloat(opt.dataset.i6) : parseFloat(opt.dataset.i12);
    document.getElementById('detalleRecargoInfo').innerHTML = interes > 0 ? `<div class="alert alert-warning py-2">${cuotas} cuotas: <strong>${interes}%</strong> de recargo</div>` : '';
}

function agregarPagoDetalle() {
    const monto = parseFloat(document.getElementById('detalleMontoInput').value) || 0;
    if (monto <= 0) { mostrarNotificacion('Monto inválido', 'warning'); return; }
    const fp = formaPagoActual;
    const pago = { id_forma_pago: fp.id_forma_pago, codigo: fp.codigo, tipo: fp.tipo, monto, id_moneda: parseInt(document.getElementById('detalleMonedaInput').value) || 1, descripcion: fp.codigo.replace(/_/g, ' ') };
    if (fp.codigo.includes('TARJETA')) {
        const sel = document.getElementById('detalleTarjetaInput');
        if (sel.value) { pago.id_tarjeta = parseInt(sel.value); const t = tarjetas.find(x => x.id_tarjeta == pago.id_tarjeta); if (t) pago.descripcion = t.nombre; }
        if (fp.codigo === 'TARJETA_CREDITO') { pago.cuotas = parseInt(document.getElementById('detalleCuotasInput').value) || 1; pago.descripcion += ` (${pago.cuotas}c)`; const opt = sel.options[sel.selectedIndex]; pago.interes = pago.cuotas === 1 ? parseFloat(opt?.dataset.i1) : pago.cuotas === 3 ? parseFloat(opt?.dataset.i3) : pago.cuotas === 6 ? parseFloat(opt?.dataset.i6) : parseFloat(opt?.dataset.i12); }
        pago.numero_referencia = document.getElementById('detalleReferenciaInput').value;
    }
    if (['TRANSFERENCIA', 'CHEQUE'].includes(fp.codigo)) { const bsel = document.getElementById('detalleBancoInput'); if (bsel.value) pago.id_banco = parseInt(bsel.value); pago.numero_referencia = document.getElementById('detalleReferenciaInput').value; }
    if (fp.codigo === 'MERCADOPAGO') pago.numero_referencia = document.getElementById('detalleReferenciaInput').value;
    agregarPago(pago); modalDetallePago.hide();
}

function agregarPago(pago) { pagosAgregados.push(pago); renderizarPagos(); calcularResumen(); document.getElementById('sinFormasPago').style.display = 'none'; }
function eliminarPago(i) { pagosAgregados.splice(i, 1); renderizarPagos(); calcularResumen(); if (pagosAgregados.length === 0) document.getElementById('sinFormasPago').style.display = 'block'; }

function renderizarPagos() {
    const container = document.getElementById('pagosAgregados');
    const lista = document.getElementById('listaPagos');
    if (pagosAgregados.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    lista.innerHTML = pagosAgregados.map((p, i) => `<div class="pago-item"><div class="info"><i class="bi ${iconosFormaPago[p.codigo] || 'bi-wallet2'}"></i><span>${p.descripcion}</span></div><div class="monto">${formatMoney(p.monto)}</div><button class="btn-remove" onclick="eliminarPago(${i})"><i class="bi bi-x-lg"></i></button></div>`).join('');
}

function calcularResumen() {
    const montoBase = parseFloat(document.getElementById('montoACobrar').value) || 0;
    let totalIngresado = 0, totalRecargos = 0;
    pagosAgregados.forEach(p => { let m = p.monto; if (p.id_moneda !== 1 && cotizaciones[p.id_moneda]) m *= cotizaciones[p.id_moneda]; let r = p.interes ? m * (p.interes / 100) : (recargosFormaPago[p.id_forma_pago] && parseFloat(recargosFormaPago[p.id_forma_pago].porcentaje) > 0) ? m * (parseFloat(recargosFormaPago[p.id_forma_pago].porcentaje) / 100) : 0; totalRecargos += r; totalIngresado += m + r; });
    const totalFinal = montoBase + totalRecargos, diferencia = totalIngresado - totalFinal;
    document.getElementById('displayTotalCobrar').textContent = formatMoney(totalFinal);
    document.getElementById('displaySubtotal').textContent = formatMoney(montoBase);
    document.getElementById('displayRecargos').textContent = formatMoney(totalRecargos);
    document.getElementById('displayIngresado').textContent = formatMoney(totalIngresado);
    const dif = document.getElementById('displayDiferencia');
    dif.textContent = formatMoney(Math.abs(diferencia));
    if (Math.abs(diferencia) < 0.01 && totalIngresado > 0) { dif.className = 'text-success'; document.getElementById('btnCobrar').disabled = !turnoActual; }
    else { dif.className = diferencia < 0 ? 'text-danger' : 'text-warning'; document.getElementById('btnCobrar').disabled = true; }
}

// ============================================================
// PROCESAR COBRO
// ============================================================
async function procesarCobro() {
    if (!turnoActual) { mostrarNotificacion('Abrí la caja primero', 'warning'); return; }
    const montoTotal = parseFloat(document.getElementById('montoACobrar').value);
    const concepto = document.getElementById('conceptoCobro').value;
    const sinCliente = document.getElementById('sinCliente').checked;
    if (!montoTotal || montoTotal <= 0 || pagosAgregados.length === 0) { mostrarNotificacion('Completá el monto y la forma de pago', 'warning'); return; }
    const items = pagosAgregados.map(p => ({ id_forma_pago: p.id_forma_pago, id_moneda: p.id_moneda || 1, monto: p.monto, id_tarjeta: p.id_tarjeta || null, cuotas: p.cuotas || 1, interes_aplicado: p.interes || 0, id_banco: p.id_banco || null, referencia: p.numero_referencia || null }));
    try {
        const res = await fetch(`${API_URL}/recibos`, { method: 'POST', headers, body: JSON.stringify({ id_turno: turnoActual.id_turno, id_cliente: sinCliente ? null : (clienteSeleccionado?.id_cliente || null), total_recibo: montoTotal, id_moneda_recibo: 1, concepto: concepto || null, pagos: items, es_a_cuenta: sinCliente || !clienteSeleccionado }) });
        const data = await res.json();
        if (res.ok) { mostrarNotificacion(`✅ Recibo ${data.numero_completo || ''} generado`, 'success'); limpiarFormularioCobro(); await cargarEstadoCaja(); }
        else mostrarNotificacion('❌ ' + (data.error || 'Error al procesar'), 'danger');
    } catch (e) { console.error(e); mostrarNotificacion('Error de conexión', 'danger'); }
}

function limpiarFormularioCobro() {
    document.getElementById('montoACobrar').value = ''; document.getElementById('conceptoCobro').value = ''; document.getElementById('sinCliente').checked = false;
    clienteSeleccionado = null; pagosAgregados = [];
    document.getElementById('clientePanel').classList.remove('visible'); document.getElementById('sinClienteCard').style.display = 'block';
    document.getElementById('searchInput').value = ''; document.getElementById('sinFormasPago').style.display = 'block';
    document.getElementById('pagosAgregados').style.display = 'none';
    document.querySelectorAll('.forma-pago-btn').forEach(btn => btn.classList.remove('selected'));
    calcularResumen();
}

// ============================================================
// CAJA: ABRIR / CERRAR
// ============================================================
async function abrirModalAbrirCaja() {
    document.getElementById('montoInicialARS').value = '0';
    document.getElementById('montoInicialUSD').value = '0';
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas`, { headers });
        const cajas = await res.json();
        const sel = document.getElementById('selectCajaAbrir');
        sel.innerHTML = cajas.map(c => `<option value="${c.id_caja}"${c.es_principal ? ' selected' : ''}>${c.nombre}${c.es_principal ? ' (Principal)' : ''}</option>`).join('');
    } catch (e) { console.error('Error cargando cajas:', e); }
    modalAbrirCaja.show();
}

async function abrirCaja() {
    const monto_inicial_ars = parseFloat(document.getElementById('montoInicialARS').value) || 0;
    const monto_inicial_usd = parseFloat(document.getElementById('montoInicialUSD').value) || 0;
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/abrir`, { method: 'POST', headers, body: JSON.stringify({ id_caja: parseInt(document.getElementById('selectCajaAbrir').value), monto_inicial_ars, monto_inicial_usd }) });
        if (res.ok) { modalAbrirCaja.hide(); mostrarNotificacion('✅ Caja abierta correctamente', 'success'); await cargarEstadoCaja(); }
        else { const data = await res.json(); mostrarNotificacion(data.error || 'Error al abrir caja', 'danger'); }
    } catch (e) { mostrarNotificacion('Error de conexión', 'danger'); }
}

// ============================================================
// MOVIMIENTOS DE CAJA
// ============================================================
async function cargarMovimientosCaja() {
    if (!turnoActual) { document.getElementById('tablaMovimientosCaja').innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5">Abrí la caja para ver movimientos</td></tr>'; return; }
    const tbody = document.getElementById('tablaMovimientosCaja');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Cargando...</td></tr>';
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/movimientos/${turnoActual.id_turno}`, { headers });
        movimientosData = await res.json();
        let filtrados = [...movimientosData];
        const tipo = document.getElementById('movTipo').value;
        const moneda = document.getElementById('movMoneda').value;
        if (tipo) filtrados = filtrados.filter(m => m.tipo === tipo);
        if (moneda) filtrados = filtrados.filter(m => m.id_moneda == moneda);
        if (filtrados.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5"><i class="bi bi-inbox"></i> Sin movimientos</td></tr>'; }
        else { tbody.innerHTML = filtrados.map(m => `<tr data-id="${m.id_movimiento}"><td class="checkbox-col"><input type="checkbox" class="mov-check" value="${m.id_movimiento}" onchange="actualizarSeleccionMov()"></td><td>${new Date(m.fecha_movimiento).toLocaleTimeString('es-AR', {hour: '2-digit', minute: '2-digit'})}</td><td><span class="badge-lago ${m.tipo === 'ingreso' ? 'success' : 'danger'}">${m.tipo.toUpperCase()}</span></td><td>${m.concepto || '-'}</td><td class="text-end fw-bold ${m.tipo === 'ingreso' ? 'text-success' : 'text-danger'}">${m.moneda_simbolo || '$'}${parseFloat(m.monto).toFixed(2)}</td><td>${m.usuario_nombre || '-'}</td><td><button class="btn btn-sm btn-outline-secondary" onclick="verDetalleMovimiento(${m.id_movimiento})" title="Ver detalle"><i class="bi bi-eye"></i></button></td></tr>`).join(''); }
        let totalIngresos = 0, totalEgresos = 0;
        filtrados.forEach(m => { if (m.tipo === 'ingreso') totalIngresos += parseFloat(m.monto); else totalEgresos += parseFloat(m.monto); });
        document.getElementById('movTotalIngresos').textContent = formatMoney(totalIngresos);
        document.getElementById('movTotalEgresos').textContent = formatMoney(totalEgresos);
        document.getElementById('movBalance').textContent = formatMoney(totalIngresos - totalEgresos);
        document.getElementById('movBalance').className = totalIngresos - totalEgresos >= 0 ? 'valor text-success' : 'valor text-danger';
    } catch (e) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar</td></tr>'; console.error(e); }
}

function actualizarSeleccionMov() { const checks = document.querySelectorAll('.mov-check:checked'); document.getElementById('movSeleccionados').textContent = checks.length; document.getElementById('movAccionesBar').classList.toggle('visible', checks.length > 0); }
function toggleTodosMov() { const checkAll = document.getElementById('movCheckAll').checked; document.querySelectorAll('.mov-check').forEach(c => c.checked = checkAll); actualizarSeleccionMov(); }
function deseleccionarTodosMov() { document.getElementById('movCheckAll').checked = false; document.querySelectorAll('.mov-check').forEach(c => c.checked = false); actualizarSeleccionMov(); }
function imprimirMovSeleccionados() { const ids = Array.from(document.querySelectorAll('.mov-check:checked')).map(c => c.value); if (ids.length === 0) return; mostrarNotificacion(`Imprimiendo ${ids.length} movimientos...`, 'info'); }

function agregarMovimientoManual(tipo) {
    if (!turnoActual) { mostrarNotificacion('Abrí la caja primero', 'warning'); return; }
    document.getElementById('movimientoTipo').value = tipo;
    document.getElementById('modalMovimientoTitulo').innerHTML = tipo === 'ingreso' ? '<i class="bi bi-plus-circle text-success me-2"></i>Registrar Ingreso' : '<i class="bi bi-dash-circle text-danger me-2"></i>Registrar Egreso';
    document.getElementById('movimientoMonto').value = ''; document.getElementById('movimientoConcepto').value = '';
    modalMovimiento.show();
}

async function guardarMovimientoManual() {
    const tipo = document.getElementById('movimientoTipo').value;
    const monto = parseFloat(document.getElementById('movimientoMonto').value);
    const concepto = document.getElementById('movimientoConcepto').value.trim();
    const id_moneda = parseInt(document.getElementById('movimientoMoneda').value);
    if (!monto || monto <= 0 || !concepto) { mostrarNotificacion('Completá todos los campos', 'warning'); return; }
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/movimientos`, { method: 'POST', headers, body: JSON.stringify({ id_turno: turnoActual.id_turno, tipo, monto, concepto, id_moneda }) });
        if (res.ok) { modalMovimiento.hide(); mostrarNotificacion('✅ Movimiento registrado', 'success'); await cargarMovimientosCaja(); await cargarEstadoCaja(); }
        else { const d = await res.json(); mostrarNotificacion(d.error || 'Error', 'danger'); }
    } catch (e) { mostrarNotificacion('Error de conexión', 'danger'); }
}

function exportarMovimientos() {
    if (movimientosData.length === 0) { mostrarNotificacion('No hay movimientos para exportar', 'warning'); return; }
    const data = movimientosData.map(m => ({ 'Fecha': new Date(m.fecha_movimiento).toLocaleString('es-AR'), 'Tipo': m.tipo.toUpperCase(), 'Concepto': m.concepto, 'Monto': parseFloat(m.monto), 'Moneda': m.moneda_simbolo || 'ARS', 'Usuario': m.usuario_nombre }));
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    XLSX.writeFile(wb, `movimientos_caja_${new Date().toISOString().slice(0,10)}.xlsx`);
    mostrarNotificacion('✅ Excel descargado', 'success');
}

function verDetalleMovimiento(id) {
    const mov = movimientosData.find(m => m.id_movimiento == id || m.id_movimiento_caja == id);
    if (!mov) { mostrarNotificacion('Movimiento no encontrado', 'warning'); return; }
    const modal = new bootstrap.Modal(document.getElementById('modalDetalleGenerico'));
    document.getElementById('modalDetalleGenericoTitulo').innerHTML = '<i class="bi bi-arrow-left-right me-2"></i>Detalle de Movimiento';
    document.getElementById('btnImprimirDetalle').style.display = 'none';
    const esIng = mov.tipo === 'ingreso';
    document.getElementById('modalDetalleGenericoBody').innerHTML = `<div class="row">
        <div class="col-md-6">
            <p><span class="badge-lago ${esIng ? 'success' : 'danger'}">${mov.tipo.toUpperCase()}</span></p>
            <p><i class="bi bi-calendar3"></i> <strong>${new Date(mov.fecha_movimiento).toLocaleString('es-AR')}</strong></p>
            <p><i class="bi bi-person"></i> ${mov.usuario_nombre || '-'}</p>
            <p><i class="bi bi-chat-dots"></i> ${mov.concepto || '-'}</p>
            ${mov.metodo_pago_nombre ? '<p><i class="bi bi-wallet2"></i> ' + mov.metodo_pago_nombre + '</p>' : ''}
        </div>
        <div class="col-md-6 text-end">
            <div class="fs-1 fw-bold ${esIng ? 'text-success' : 'text-danger'}">${mov.moneda_simbolo || '$'}${parseFloat(mov.monto).toLocaleString('es-AR', {minimumFractionDigits:2})}</div>
            <div class="text-muted mt-2">${mov.moneda_codigo || 'ARS'}</div>
        </div></div>`;
    modal.show();
}

// ============================================================
// HISTORIAL DE RECIBOS
// ============================================================
async function cargarHistorialRecibos() {
    const tbody = document.getElementById('tablaHistorial');
    const fecha_desde = document.getElementById('histFechaDesde').value;
    const fecha_hasta = document.getElementById('histFechaHasta').value;
    if (!fecha_desde || !fecha_hasta) { tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5">Seleccioná un rango de fechas</td></tr>'; return; }
    tbody.innerHTML = '<tr><td colspan="9" class="text-center">Cargando...</td></tr>';
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cobranzas/historial?fecha_desde=${fecha_desde}&fecha_hasta=${fecha_hasta}`, { headers });
        historialData = await res.json();
        document.getElementById('histCantidad').textContent = `${historialData.length} recibos`;
        if (historialData.length === 0) { tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5"><i class="bi bi-inbox"></i> Sin recibos en este período</td></tr>'; document.getElementById('histTotalCobrado').textContent = '$0'; document.getElementById('histTotalAplicado').textContent = '$0'; }
        else {
            tbody.innerHTML = historialData.map(r => `<tr data-id="${r.id_recibo}"><td class="checkbox-col"><input type="checkbox" class="hist-check" value="${r.id_recibo}" onchange="actualizarSeleccionRecibos()"></td><td><strong>${r.numero_completo || r.id_recibo}</strong></td><td>${formatDate(r.fecha_recibo)}</td><td>${r.cliente || '<span class="text-muted">Sin cliente</span>'}</td><td class="text-end fw-bold">${formatMoney(r.total_recibo)}</td><td>${r.facturas_aplicadas > 0 ? `<span class="badge-lago info">${r.facturas_aplicadas} fact.</span>` : '<span class="text-muted">-</span>'}</td><td>${r.cobrador || '-'}</td><td><span class="badge-lago success">Vigente</span></td><td><button class="btn btn-sm btn-outline-primary me-1" onclick="imprimirRecibo(${r.id_recibo})" title="Imprimir"><i class="bi bi-printer"></i></button><button class="btn btn-sm btn-outline-secondary" onclick="verDetalleRecibo(${r.id_recibo})" title="Ver detalle"><i class="bi bi-eye"></i></button></td></tr>`).join('');
            const totalCobrado = historialData.reduce((sum, r) => sum + parseFloat(r.total_recibo || 0), 0);
            const totalAplicado = historialData.reduce((sum, r) => sum + parseFloat(r.monto_aplicado || 0), 0);
            document.getElementById('histTotalCobrado').textContent = formatMoney(totalCobrado);
            document.getElementById('histTotalAplicado').textContent = formatMoney(totalAplicado);
        }
    } catch (e) { tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Error al cargar</td></tr>'; console.error(e); }
}

function actualizarSeleccionRecibos() { const checks = document.querySelectorAll('.hist-check:checked'); document.getElementById('histSeleccionados').textContent = checks.length; document.getElementById('histAccionesBar').classList.toggle('visible', checks.length > 0); }
function toggleTodosRecibos() { const checkAll = document.getElementById('histCheckAll').checked; document.querySelectorAll('.hist-check').forEach(c => c.checked = checkAll); actualizarSeleccionRecibos(); }
function deseleccionarTodosRecibos() { document.getElementById('histCheckAll').checked = false; document.querySelectorAll('.hist-check').forEach(c => c.checked = false); actualizarSeleccionRecibos(); }
function imprimirRecibosSeleccionados() { const ids = Array.from(document.querySelectorAll('.hist-check:checked')).map(c => c.value); if (ids.length === 0) return; mostrarNotificacion(`Imprimiendo ${ids.length} recibos...`, 'info'); ids.forEach(id => imprimirRecibo(id)); }
async function anularRecibosSeleccionados() {
    const ids = Array.from(document.querySelectorAll('.hist-check:checked')).map(c => c.value);
    if (ids.length === 0) return;
    if (!confirm(`¿Estás seguro de anular ${ids.length} recibo(s)? Esta acción revierte los pagos aplicados.`)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
        try {
            const res = await fetch(`${API_URL}/recibos/${id}`, { method: 'DELETE', headers });
            if (res.ok) ok++; else { const d = await res.json().catch(() => ({})); console.error('Anular recibo ' + id + ':', d.error || res.status); fail++; }
        } catch (e) { fail++; }
    }
    if (ok > 0) mostrarNotificacion(`✅ ${ok} recibo(s) anulado(s)`, 'success');
    if (fail > 0) mostrarNotificacion(`❌ ${fail} recibo(s) no se pudieron anular`, 'danger');
    deseleccionarTodosRecibos();
    await cargarHistorialRecibos();
    await cargarEstadoCaja();
}
function exportarHistorial() {
    if (historialData.length === 0) { mostrarNotificacion('No hay recibos para exportar', 'warning'); return; }
    const data = historialData.map(r => ({ 'Recibo': r.numero_completo || r.id_recibo, 'Fecha': formatDate(r.fecha_recibo), 'Cliente': r.cliente || 'Sin cliente', 'Total': parseFloat(r.total_recibo), 'Facturas Aplicadas': r.facturas_aplicadas, 'Monto Aplicado': parseFloat(r.monto_aplicado || 0), 'Cobrador': r.cobrador }));
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Recibos');
    XLSX.writeFile(wb, `historial_recibos_${new Date().toISOString().slice(0,10)}.xlsx`);
    mostrarNotificacion('✅ Excel descargado', 'success');
}
function imprimirRecibo(id) { window.open(`${API_URL}/print/recibo/${id}`, '_blank'); }
async function verDetalleRecibo(id) {
    const modal = new bootstrap.Modal(document.getElementById('modalDetalleGenerico'));
    const body = document.getElementById('modalDetalleGenericoBody');
    document.getElementById('modalDetalleGenericoTitulo').innerHTML = '<i class="bi bi-receipt me-2"></i>Detalle de Recibo';
    document.getElementById('btnImprimirDetalle').style.display = 'inline-block';
    document.getElementById('btnImprimirDetalle').onclick = () => imprimirRecibo(id);
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
    modal.show();
    try {
        const res = await fetch(`${API_URL}/recibos/${id}`, { headers });
        if (!res.ok) throw new Error('Error');
        const data = await res.json();
        const r = data.recibo || data;
        const items = data.items || data.pagos || [];
        const facturas = data.facturas_aplicadas || data.facturas || [];
        let h = `<div class="row mb-3"><div class="col-md-7">
            <h5>${r.numero_completo || 'Recibo #' + r.id_recibo}</h5>
            <p class="mb-1"><i class="bi bi-calendar3"></i> ${formatFechaHora(r.fecha_recibo)}</p>
            <p class="mb-1"><i class="bi bi-person"></i> ${r.razon_social || r.cliente || 'Sin cliente'}</p>
            ${r.concepto ? '<p class="mb-1"><i class="bi bi-chat-dots"></i> ' + r.concepto + '</p>' : ''}
        </div><div class="col-md-5 text-end">
            <div class="fs-2 fw-bold text-success">${formatMoney(r.total_recibo)}</div>
            <small class="text-muted">Total cobrado</small>
        </div></div>`;
        if (items.length > 0) {
            h += '<hr><h6><i class="bi bi-wallet2 me-1"></i>Formas de pago</h6><table class="tabla-lago"><thead><tr><th>Forma</th><th>Moneda</th><th class="text-end">Monto</th><th>Referencia</th></tr></thead><tbody>';
            h += items.map(i => '<tr><td>' + (i.nombre_forma_pago || i.forma_pago || '-') + '</td><td>' + (i.simbolo_moneda || 'ARS') + '</td><td class="text-end fw-bold">' + formatMoney(i.monto_original || i.monto_convertido || i.monto || 0) + '</td><td>' + (i.numero_referencia || '-') + '</td></tr>').join('');
            h += '</tbody></table>';
        }
        if (facturas.length > 0) {
            h += '<hr><h6><i class="bi bi-file-earmark-text me-1"></i>Facturas aplicadas</h6><table class="tabla-lago"><thead><tr><th>Factura</th><th class="text-end">Monto aplicado</th></tr></thead><tbody>';
            h += facturas.map(f => '<tr><td>' + (f.numero_completo || '#' + f.id_factura) + '</td><td class="text-end fw-bold">' + formatMoney(f.monto_aplicado) + '</td></tr>').join('');
            h += '</tbody></table>';
        }
        if (!items.length && !facturas.length) h += '<p class="text-muted text-center py-3">Sin detalles adicionales</p>';
        body.innerHTML = h;
    } catch (e) { console.error(e); body.innerHTML = '<div class="text-center text-danger py-4"><i class="bi bi-exclamation-triangle fs-1"></i><p>Error al cargar detalle</p></div>'; }
}

// ============================================================
// ARQUEO Y CIERRE — Desglose por forma de pago
// ============================================================
let desgloseData = [];
function actualizarDatosArqueo() { cargarDatosArqueo(); }

function cargarDatosArqueo() {
    if (!turnoActual) {
        document.getElementById('arqueoContenido').innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-lock fs-1 d-block mb-2"></i>Abrí la caja para realizar el arqueo</div>';
        document.getElementById('arqueoCierreCard').style.display = 'none';
        return;
    }
    document.getElementById('arqueoTurnoInfo').textContent = `Turno #${turnoActual.id_turno}`;
    cargarDesgloseArqueo();
    verificarMultiplesCajas();
}

async function cargarDesgloseArqueo() {
    const body = document.getElementById('arqueoContenido');
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/turnos/${turnoActual.id_turno}/desglose`, { headers });
        if (!res.ok) throw new Error('Error');
        const data = await res.json();
        desgloseData = data.desglose || [];
        renderTablaArqueo(desgloseData);
        document.getElementById('arqueoCierreCard').style.display = 'block';
        document.getElementById('btnCerrarCaja').disabled = false;
    } catch (e) {
        console.error(e);
        body.innerHTML = '<div class="text-center py-4 text-danger">Error al cargar desglose</div>';
    }
}

function renderTablaArqueo(desglose) {
    const body = document.getElementById('arqueoContenido');
    if (desglose.length === 0) {
        body.innerHTML = '<div class="text-center py-4 text-muted">Sin movimientos en este turno</div>';
        document.getElementById('arqueoCierreCard').style.display = 'block';
        document.getElementById('btnCerrarCaja').disabled = false;
        calcularTotalesArqueo();
        return;
    }

    const iconos = { 1: 'bi-cash-stack', 2: 'bi-phone', 3: 'bi-bank', 4: 'bi-credit-card', 5: 'bi-credit-card-2-front', 6: 'bi-journal-text' };
    const hints = { 1: 'Contá el efectivo en caja', 2: 'Verificá en la app de MercadoPago', 3: 'Verificá en el homebanking', 4: 'Verificá en el POS / cierre de lote', 5: 'Verificá en el POS / cierre de lote', 6: 'Saldo en cuenta corriente (no requiere conteo)' };

    let html = '<table class="tabla-lago"><thead><tr>';
    html += '<th>Forma de Pago</th><th class="text-end">Ingresos</th><th class="text-end">Egresos</th>';
    html += '<th class="text-end">Esperado</th><th class="text-end" style="width:180px;">Contado</th><th class="text-end">Diferencia</th>';
    html += '</tr></thead><tbody>';

    desglose.forEach((d, i) => {
        const icono = iconos[d.id_metodo_pago] || 'bi-wallet2';
        const hint = hints[d.id_metodo_pago] || '';
        const esperado = d.esperado || d.neto;
        const esCash = d.id_metodo_pago === 1 || d.id_metodo_pago === 0;
        // const esCC = d.id_metodo_pago === 6; // Legacy fiado: ya no hay pagos CC
        const simbolo = d.moneda_simbolo || '$';

        html += '<tr>';
        html += `<td><i class="bi ${icono} me-2" style="color:var(--lago-primary);"></i><strong>${d.nombre}</strong>`;
        if (d.monto_inicial > 0) html += `<br><small class="text-muted">Incluye inicial: ${simbolo}${d.monto_inicial.toLocaleString('es-AR', {minimumFractionDigits:2})}</small>`;
        if (hint) html += `<br><small class="text-muted fst-italic">${hint}</small>`;
        html += '</td>';
        html += `<td class="text-end text-success">${simbolo}${d.ingresos.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>`;
        html += `<td class="text-end text-danger">${simbolo}${d.egresos.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>`;
        html += `<td class="text-end fw-bold">${simbolo}${esperado.toLocaleString('es-AR', {minimumFractionDigits:2})}</td>`;

        if (false) { // Legacy: esCC ya no aplica
            html += `<td class="text-end text-muted">N/A</td>`;
            html += `<td class="text-end text-muted">-</td>`;
        } else {
            html += `<td class="text-end"><input type="number" class="form-control form-control-sm text-end fw-bold arqueo-input" data-idx="${i}" step="0.01" min="0" value="${esperado.toFixed(2)}" oninput="calcularTotalesArqueo()"></td>`;
            html += `<td class="text-end fw-bold arqueo-dif" id="arqueoDif_${i}">$0.00</td>`;
        }
        html += '</tr>';
    });

    html += '</tbody></table>';
    body.innerHTML = html;
    calcularTotalesArqueo();
}

function calcularTotalesArqueo() {
    let totalEsperado = 0, totalContado = 0, totalDiferencia = 0;

    desgloseData.forEach((d, i) => {
        // if (d.id_metodo_pago === 6) return; // Legacy: ya no hay pagos CC
        const esperado = d.esperado || d.neto;
        totalEsperado += esperado;

        const input = document.querySelector(`.arqueo-input[data-idx="${i}"]`);
        const difEl = document.getElementById(`arqueoDif_${i}`);
        if (!input || !difEl) return;

        const contado = parseFloat(input.value) || 0;
        const dif = contado - esperado;
        totalContado += contado;
        totalDiferencia += dif;

        const simbolo = d.moneda_simbolo || '$';
        difEl.textContent = (dif >= 0 ? '+' : '') + simbolo + Math.abs(dif).toLocaleString('es-AR', {minimumFractionDigits:2});
        difEl.className = Math.abs(dif) < 0.01 ? 'text-end fw-bold text-success' : 'text-end fw-bold text-danger';
    });

    const estado = document.getElementById('arqueoEstado');
    const difTotal = document.getElementById('arqueoDifTotal');

    if (Math.abs(totalDiferencia) < 0.01) {
        estado.innerHTML = '<i class="bi bi-check-circle text-success"></i> CUADRA';
        estado.className = 'fs-3 fw-bold text-success';
    } else {
        estado.innerHTML = '<i class="bi bi-exclamation-triangle text-danger"></i> DIFERENCIA';
        estado.className = 'fs-3 fw-bold text-danger';
    }
    difTotal.textContent = (totalDiferencia >= 0 ? '+' : '-') + '$' + Math.abs(totalDiferencia).toLocaleString('es-AR', {minimumFractionDigits:2});
    difTotal.className = Math.abs(totalDiferencia) < 0.01 ? 'fs-4 fw-bold text-success' : 'fs-4 fw-bold text-danger';
}

async function confirmarCierreCaja() {
    if (!turnoActual) return;
    if (!confirm('¿Estás seguro de cerrar la caja?')) return;

    // Armar arqueo_detalle desde inputs
    const detalle = [];
    let arqueo_ars = 0, arqueo_usd = 0;
    desgloseData.forEach((d, i) => {
        if (d.id_metodo_pago === 6) return;
        const input = document.querySelector(`.arqueo-input[data-idx="${i}"]`);
        const contado = parseFloat(input?.value) || 0;
        const esperado = d.esperado || d.neto;
        detalle.push({
            id_metodo_pago: d.id_metodo_pago, nombre: d.nombre,
            id_moneda: d.id_moneda, esperado, contado,
            diferencia: contado - esperado
        });
        // Separar efectivo ARS/USD para campos legacy
        if (d.id_metodo_pago === 1 || d.id_metodo_pago === 0) {
            if (d.id_moneda === 1) arqueo_ars = contado;
            else if (d.id_moneda === 2) arqueo_usd = contado;
        }
    });

    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/cerrar`, {
            method: 'POST', headers,
            body: JSON.stringify({
                id_turno: turnoActual.id_turno,
                arqueo_efectivo_ars: arqueo_ars,
                arqueo_efectivo_usd: arqueo_usd,
                observaciones: document.getElementById('arqueoObservaciones').value,
                transferir_a_principal: document.getElementById('chkTransferirPrincipal')?.checked || false,
                arqueo_detalle: detalle
            })
        });
        if (res.ok) {
            const data = await res.json();
            mostrarNotificacion('✅ Caja cerrada correctamente', 'success');
            await cargarEstadoCaja();
            document.querySelector('[data-tab="cobrar"]').click();
        } else {
            const d = await res.json();
            mostrarNotificacion(d.error || 'Error al cerrar caja', 'danger');
        }
    } catch (e) { mostrarNotificacion('Error de conexión', 'danger'); }
}

// ============================================================
// ATAJOS DE TECLADO
// ============================================================
function configurarAtajosTeclado() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') { e.preventDefault(); if (!document.getElementById('btnCobrar').disabled) procesarCobro(); }
        if (e.key === 'F3') { e.preventDefault(); document.getElementById('searchInput').focus(); }
        if (e.key === 'F4') { e.preventDefault(); limpiarFormularioCobro(); document.getElementById('montoACobrar').focus(); }
        if (e.key === 'Escape') { const searchInput = document.getElementById('searchInput'); const searchResults = document.getElementById('searchResults'); if (document.activeElement === searchInput || searchResults.classList.contains('visible')) { searchInput.value = ''; document.getElementById('searchClear').classList.remove('visible'); searchResults.classList.remove('visible'); } }
    });
}

// ============================================================
// UTILIDADES
// ============================================================
function formatMoney(num) { return '$' + (parseFloat(num) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatNumber(num) { return (parseFloat(num) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatDate(dateStr) { if (!dateStr) return '-'; const d = new Date(dateStr); return d.toLocaleDateString('es-AR'); }
function debounce(func, wait) { let timeout; return function(...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); }; }

function mostrarNotificacion(msg, tipo = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) { container = document.createElement('div'); container.id = 'toastContainer'; container.className = 'toast-container position-fixed top-0 end-0 p-3'; container.style.zIndex = '1100'; document.body.appendChild(container); }
    const toast = document.createElement('div'); toast.className = `toast align-items-center text-white bg-${tipo} border-0`;
    toast.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    container.appendChild(toast); new bootstrap.Toast(toast, { delay: 4000 }).show(); toast.addEventListener('hidden.bs.toast', () => toast.remove());
}

function cerrarSesion() { localStorage.removeItem('authToken'); localStorage.removeItem('username'); console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend'); }


// ============================================================
// HISTORIAL DE CIERRES DE CAJA
// ============================================================

function aplicarPresetCierres(preset) {
    const hoy = new Date(); let desde, hasta;
    switch(preset) {
        case 'hoy': desde = hasta = hoy.toISOString().slice(0, 10); break;
        case 'semana': const ini = new Date(hoy); ini.setDate(hoy.getDate() - hoy.getDay()); desde = ini.toISOString().slice(0, 10); hasta = hoy.toISOString().slice(0, 10); break;
        case 'mes': desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10); hasta = hoy.toISOString().slice(0, 10); break;
    }
    document.getElementById('cierresFechaDesde').value = desde;
    document.getElementById('cierresFechaHasta').value = hasta;
    document.querySelectorAll('#cierresPresets .fecha-preset').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    cargarHistorialCierres();
}

async function cargarHistorialCierres() {
    const tbody = document.getElementById('tablaCierres');
    const desde = document.getElementById('cierresFechaDesde').value;
    const hasta = document.getElementById('cierresFechaHasta').value;
    const estado = document.getElementById('cierresEstado').value;
    if (!desde || !hasta) { tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-5">Seleccioná un rango de fechas</td></tr>'; return; }
    tbody.innerHTML = '<tr><td colspan="12" class="text-center">Cargando...</td></tr>';
    try {
        const params = new URLSearchParams({ fecha_desde: desde, fecha_hasta: hasta });
        if (estado) params.append('estado', estado);
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/turnos-historial?${params}`, { headers });
        const data = await res.json();
        const turnos = data.turnos || [];
        document.getElementById('cierresCantidad').textContent = `${turnos.length} turnos`;
        if (turnos.length === 0) {
            tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted py-5"><i class="bi bi-inbox"></i> Sin turnos en este período</td></tr>';
            return;
        }
        tbody.innerHTML = turnos.map(t => {
            const inicial = parseFloat(t.monto_inicial_ars || 0);
            const ingresos = parseFloat(t.ingresos_efectivo_ars || 0);
            const egresos = parseFloat(t.egresos_efectivo_ars || 0);
            const arqueo = parseFloat(t.arqueo_efectivo_ars || 0);
            const dif = parseFloat(t.diferencia_ars || 0);
            const esCerrado = t.estado === 'cerrado';
            const badgeClass = t.estado === 'cerrado' ? 'success' : 'warning';
            const difClass = Math.abs(dif) < 0.01 ? 'text-success' : 'text-danger';
            const transferido = t.transferido_a_caja ? `<br><small class="text-info"><i class="bi bi-arrow-right-circle"></i> → ${t.caja_destino_nombre || 'Caja #' + t.transferido_a_caja}</small>` : '';
            return `<tr>
                <td><strong>${t.id_turno}</strong></td>
                <td>${t.nombre_caja || '-'}</td>
                <td>${formatFechaHora(t.fecha_apertura)}<br><small class="text-muted">${t.username_apertura || ''}</small></td>
                <td>${esCerrado ? formatFechaHora(t.fecha_cierre) + '<br><small class="text-muted">' + (t.username_cierre || '') + '</small>' : '<span class="text-warning">-</span>'}</td>
                <td>${t.usuario_apertura || '-'}</td>
                <td class="text-end">${formatMoney(inicial)}</td>
                <td class="text-end text-success">${formatMoney(ingresos)}</td>
                <td class="text-end text-danger">${formatMoney(egresos)}</td>
                <td class="text-end">${esCerrado ? formatMoney(arqueo) : '-'}</td>
                <td class="text-end fw-bold ${difClass}">${esCerrado ? (dif >= 0 ? '+' : '') + formatMoney(dif) : '-'}${transferido}</td>
                <td><span class="badge-lago ${badgeClass}">${t.estado.toUpperCase()}</span></td>
                <td><button class="btn btn-sm btn-outline-primary" onclick="verDetalleTurno(${t.id_turno})" title="Ver detalle"><i class="bi bi-eye"></i></button></td>
            </tr>`;
        }).join('');
    } catch (e) { console.error(e); tbody.innerHTML = '<tr><td colspan="12" class="text-center text-danger">Error al cargar</td></tr>'; }
}

async function verDetalleTurno(id_turno) {
    const modal = new bootstrap.Modal(document.getElementById('modalDetalleTurno'));
    const body = document.getElementById('modalDetalleTurnoBody');
    body.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
    modal.show();
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/turnos/${id_turno}/detalle`, { headers });
        const data = await res.json();
        const t = data.turno;
        const movs = data.movimientos || [];
        const esCerrado = t.estado === 'cerrado';
        const inicial_ars = parseFloat(t.monto_inicial_ars || 0);
        const ingresos_ars = parseFloat(t.ingresos_efectivo_ars || 0);
        const egresos_ars = parseFloat(t.egresos_efectivo_ars || 0);
        const esperado_ars = inicial_ars + ingresos_ars - egresos_ars;
        const arqueo_ars = parseFloat(t.arqueo_efectivo_ars || 0);
        const dif_ars = parseFloat(t.diferencia_ars || 0);

        let html = `
        <div class="row mb-3">
            <div class="col-md-6">
                <p><strong>Turno #${t.id_turno}</strong> — ${t.nombre_caja}</p>
                <p><i class="bi bi-unlock text-success"></i> Apertura: <strong>${formatFechaHora(t.fecha_apertura)}</strong> por ${t.usuario_apertura}</p>
                ${esCerrado ? `<p><i class="bi bi-lock text-danger"></i> Cierre: <strong>${formatFechaHora(t.fecha_cierre)}</strong> por ${t.usuario_cierre || '-'}</p>` : '<p><span class="badge-lago warning">TURNO ABIERTO</span></p>'}
                ${t.observaciones ? `<p><i class="bi bi-chat-dots"></i> ${t.observaciones}</p>` : ''}
                ${t.transferido_a_caja ? `<p class="text-info"><i class="bi bi-arrow-right-circle"></i> Transferido a <strong>${t.caja_destino_nombre}</strong>: ${formatMoney(parseFloat(t.monto_transferido_ars || 0))} ARS / US$${parseFloat(t.monto_transferido_usd || 0).toFixed(2)} USD</p>` : ''}
            </div>
            <div class="col-md-6">
                <div class="resumen-grid">
                    <div class="resumen-card"><div class="etiqueta">Inicial</div><div class="valor">${formatMoney(inicial_ars)}</div></div>
                    <div class="resumen-card success"><div class="etiqueta">Ingresos</div><div class="valor text-success">${formatMoney(ingresos_ars)}</div></div>
                    <div class="resumen-card danger"><div class="etiqueta">Egresos</div><div class="valor text-danger">${formatMoney(egresos_ars)}</div></div>
                    ${esCerrado ? `<div class="resumen-card"><div class="etiqueta">Esperado</div><div class="valor">${formatMoney(esperado_ars)}</div></div>
                    <div class="resumen-card"><div class="etiqueta">Arqueo</div><div class="valor">${formatMoney(arqueo_ars)}</div></div>
                    <div class="resumen-card ${Math.abs(dif_ars) < 0.01 ? 'success' : 'danger'}"><div class="etiqueta">Diferencia</div><div class="valor ${Math.abs(dif_ars) < 0.01 ? 'text-success' : 'text-danger'}">${(dif_ars >= 0 ? '+' : '') + formatMoney(dif_ars)}</div></div>` : ''}
                </div>
            </div>
        </div>
        <hr>
        <h6><i class="bi bi-list-ul"></i> Movimientos (${movs.length})</h6>`;

        if (movs.length === 0) {
            html += '<p class="text-muted text-center py-3">Sin movimientos registrados</p>';
        } else {
            html += `<div style="max-height:300px;overflow-y:auto;">
            <table class="tabla-lago"><thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th class="text-end">Monto</th><th>Usuario</th></tr></thead><tbody>`;
            html += movs.map(m => `<tr>
                <td>${new Date(m.fecha_movimiento).toLocaleTimeString('es-AR', {hour:'2-digit',minute:'2-digit'})}</td>
                <td><span class="badge-lago ${m.tipo === 'ingreso' ? 'success' : 'danger'}">${m.tipo.toUpperCase()}</span></td>
                <td>${m.concepto || m.metodo_pago_nombre || '-'}</td>
                <td class="text-end fw-bold ${m.tipo === 'ingreso' ? 'text-success' : 'text-danger'}">${m.moneda_simbolo || '$'}${parseFloat(m.monto).toFixed(2)}</td>
                <td>${m.usuario_nombre || '-'}</td>
            </tr>`).join('');
            html += '</tbody></table></div>';
        }

        body.innerHTML = html;
    } catch (e) { console.error(e); body.innerHTML = '<div class="text-center text-danger py-4">Error al cargar detalle</div>'; }
}

function formatFechaHora(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

// Verificar si hay múltiples cajas para mostrar opción de transferir
async function verificarMultiplesCajas() {
    try {
        const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/lista`, { headers });
        const cajas = await res.json();
        const group = document.getElementById('transferirCheckGroup');
        if (group && cajas.length > 1) {
            group.style.display = 'block';
        }
    } catch (e) { /* silenciar */ }
}
