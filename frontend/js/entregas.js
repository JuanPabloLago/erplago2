'use strict';

/**
 * entregas.js — Listado de productos entregados (SOLO LECTURA)
 * Patrón: remitos.js. BS5 sin jQuery. Keyboard-first.
 *
 * Comportamiento de fecha (decidido con timezone verificado):
 *   "Hoy" se calcula en el NAVEGADOR (fecha local del usuario), no en el server.
 *   Se manda como desde/hasta explícitos (YYYY-MM-DD). El backend filtra sobre
 *   timestamptz con (hasta < dia+1), así un remito de hoy 08:35 entra en "hoy".
 *
 * Memoria: recuerda SOLO la vista (detalle/agregado) vía /filtro-ultimo.
 *   Los textos y selects NO se recuerdan; el rango arranca en HOY. Esto evita
 *   que reaparezcan filtros viejos sin que el usuario lo note.
 */

document.addEventListener('DOMContentLoaded', async () => {
    const API = (window.CONFIG?.API_BASE_URL || '/api') + '/entregas';
    const token = localStorage.getItem('authToken');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const el = (id) => document.getElementById(id);
    const head = el('tablaEntregasHead');
    const body = el('tablaEntregasBody');
    const stats = el('statsContainer');
    const info = el('infoResultados');
    const chips = el('chipsFiltros');
    const rangoLabel = el('rangoLabel');
    const fDesde = el('filtroDesde'), fHasta = el('filtroHasta'), fEstado = el('filtroEstado');
    const fDeposito = el('filtroDeposito'), fChofer = el('filtroChofer');
    const fProducto = el('filtroProducto'), fCliente = el('filtroCliente');
    const btnBuscar = el('btnBuscar'), btnLimpiar = el('btnLimpiar'), btnExportar = el('btnExportar');
    const btnDiaAnterior = el('btnDiaAnterior'), btnDiaSiguiente = el('btnDiaSiguiente'), btnHoy = el('btnHoy');

    let guardarTimer = null;

    const modoActual = () => document.querySelector('input[name="modoVista"]:checked')?.value || 'detalle';

    // ─── FECHAS (todo en hora LOCAL del navegador) ───
    // Devuelve 'YYYY-MM-DD' de una fecha local sin pasar por UTC (evita corrimiento).
    function aISO(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    }
    const hoyISO = () => aISO(new Date());
    function sumarDiasISO(iso, n) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(y, m - 1, d);   // fecha local, sin zona
        dt.setDate(dt.getDate() + n);
        return aISO(dt);
    }

    // ─── UTILES ───
    const fmtNum = (n) => (n == null ? '0,00'
        : Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-AR') : '-';
    const esc = (s) => (s == null ? '' : String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));

    async function fetchAPI(endpoint, opts = {}) {
        const res = await fetch(`${API}${endpoint}`, { headers, ...opts });
        if (!res.ok) {
            let msg = 'Error en la petición';
            try { msg = (await res.json()).error || msg; } catch (_) {}
            throw new Error(msg);
        }
        return res.json();
    }

    // ─── FILTROS ───
    function leerFiltros() {
        return {
            modo: modoActual(),
            desde: fDesde.value || '',
            hasta: fHasta.value || '',
            estado: fEstado.value || '',
            id_deposito: fDeposito.value || '',
            chofer: fChofer.value || '',
            q_producto: fProducto.value.trim() || '',
            q_cliente: fCliente.value.trim() || '',
        };
    }

    function toQuery(f) {
        const p = new URLSearchParams();
        Object.entries(f).forEach(([k, v]) => { if (v !== '' && v != null) p.append(k, v); });
        return p.toString();
    }

    // ─── MEMORIA: solo la VISTA (detalle/agregado) ───
    async function guardarVistaDebounced() {
        clearTimeout(guardarTimer);
        guardarTimer = setTimeout(async () => {
            try {
                await fetchAPI('/filtro-ultimo', {
                    method: 'PUT',
                    body: JSON.stringify({ modo: modoActual() }),
                });
            } catch (_) { /* best-effort */ }
        }, 600);
    }

    // ─── CHIPS de filtros activos ───
    function etiquetaEstado(v) { return v; }
    function etiquetaSelect(selectEl, v) {
        const opt = Array.from(selectEl.options).find(o => o.value === v);
        return opt ? opt.textContent : v;
    }
    function renderChips() {
        const items = [];
        if (fDesde.value || fHasta.value) {
            const d = fDesde.value ? new Date(fDesde.value + 'T00:00').toLocaleDateString('es-AR') : '…';
            const h = fHasta.value ? new Date(fHasta.value + 'T00:00').toLocaleDateString('es-AR') : '…';
            const txt = (fDesde.value === fHasta.value) ? d : `${d} → ${h}`;
            items.push({ k: 'fecha', label: `Fecha: ${txt}` });
        }
        if (fEstado.value) items.push({ k: 'estado', label: `Estado: ${etiquetaEstado(fEstado.value)}` });
        if (fDeposito.value) items.push({ k: 'deposito', label: `Depósito: ${etiquetaSelect(fDeposito, fDeposito.value)}` });
        if (fChofer.value) items.push({ k: 'chofer', label: `Chofer: ${etiquetaSelect(fChofer, fChofer.value)}` });
        if (fProducto.value.trim()) items.push({ k: 'producto', label: `Producto: ${fProducto.value.trim()}` });
        if (fCliente.value.trim()) items.push({ k: 'cliente', label: `Cliente: ${fCliente.value.trim()}` });

        if (!items.length) { chips.innerHTML = ''; return; }
        chips.innerHTML = items.map(it => `
            <span class="badge bg-secondary d-inline-flex align-items-center gap-1">
                ${esc(it.label)}
                <i class="bi bi-x-circle cursor-pointer chip-x" data-k="${it.k}" role="button" title="Quitar"></i>
            </span>`).join('');
    }

    function quitarFiltro(k) {
        switch (k) {
            case 'fecha': fDesde.value = ''; fHasta.value = ''; break;
            case 'estado': fEstado.value = ''; break;
            case 'deposito': fDeposito.value = ''; break;
            case 'chofer': fChofer.value = ''; break;
            case 'producto': fProducto.value = ''; break;
            case 'cliente': fCliente.value = ''; break;
        }
        actualizarRangoLabel();
        cargar();
    }

    // Texto que describe los filtros activos (para el "sin resultados")
    function descripcionFiltros() {
        const partes = [];
        if (fDesde.value || fHasta.value) {
            const d = fDesde.value || '…', h = fHasta.value || '…';
            partes.push(fDesde.value === fHasta.value ? `Fecha ${d}` : `Fecha ${d}→${h}`);
        }
        if (fEstado.value) partes.push(`Estado=${fEstado.value}`);
        if (fDeposito.value) partes.push(`Depósito=${etiquetaSelect(fDeposito, fDeposito.value)}`);
        if (fChofer.value) partes.push(`Chofer=${etiquetaSelect(fChofer, fChofer.value)}`);
        if (fProducto.value.trim()) partes.push(`Producto=${fProducto.value.trim()}`);
        if (fCliente.value.trim()) partes.push(`Cliente=${fCliente.value.trim()}`);
        return partes.join(' · ');
    }

    function actualizarRangoLabel() {
        if (!rangoLabel) return;
        if (fDesde.value && fHasta.value && fDesde.value === fHasta.value) {
            const d = new Date(fDesde.value + 'T00:00');
            const esHoy = fDesde.value === hoyISO();
            rangoLabel.textContent = esHoy ? `Hoy (${d.toLocaleDateString('es-AR')})` : d.toLocaleDateString('es-AR');
        } else if (fDesde.value || fHasta.value) {
            rangoLabel.textContent = `${fDesde.value || '…'} → ${fHasta.value || '…'}`;
        } else {
            rangoLabel.textContent = 'Sin filtro de fecha';
        }
    }

    // ─── RENDER ───
    function renderHead(modo) {
        head.innerHTML = (modo === 'agregado')
            ? `<tr><th>Producto</th><th class="text-end">Cant. entregada</th>
                 <th class="text-end">Subtotal</th><th class="text-center">Remitos</th>
                 <th>Primera</th><th>Última</th></tr>`
            : `<tr><th>Fecha</th><th>Remito</th><th>Cliente</th><th>Producto</th>
                 <th class="text-end">Cantidad</th><th class="text-end">Subtotal</th>
                 <th>Estado</th><th>Chofer</th></tr>`;
    }

    function renderFilas(modo, filas) {
        if (!filas.length) {
            const cols = (modo === 'agregado') ? 6 : 8;
            const desc = descripcionFiltros();
            const detalle = desc
                ? `Sin resultados con estos filtros:<br><span class="small">${esc(desc)}</span>`
                : 'Sin resultados';
            body.innerHTML = `<tr><td colspan="${cols}" class="text-center text-muted py-4">${detalle}</td></tr>`;
            return;
        }
        if (modo === 'agregado') {
            body.innerHTML = filas.map(r => `
                <tr>
                    <td>${esc(r.descripcion)}</td>
                    <td class="text-end">${fmtNum(r.cantidad_total)}</td>
                    <td class="text-end">$${fmtNum(r.subtotal_total)}</td>
                    <td class="text-center">${r.remitos_distintos}</td>
                    <td>${fmtFecha(r.primera_entrega)}</td>
                    <td>${fmtFecha(r.ultima_entrega)}</td>
                </tr>`).join('');
        } else {
            const badge = (e) => {
                const map = { entregado: 'success', parcial: 'warning text-dark', no_entregado: 'danger', despachado: 'info' };
                return `<span class="badge bg-${map[e] || 'secondary'}">${esc(e)}</span>`;
            };
            body.innerHTML = filas.map(r => `
                <tr>
                    <td>${fmtFecha(r.fecha)}</td>
                    <td><button type="button" class="btn btn-link btn-sm p-0 btn-ver-remito" data-id="${r.id_remito}" title="Ver remito sin salir">${esc(r.remito_numero)}</button></td>
                    <td>${esc(r.cliente) || '<span class="text-muted">-</span>'}</td>
                    <td>${esc(r.descripcion)}</td>
                    <td class="text-end">${fmtNum(r.cantidad_neta)}</td>
                    <td class="text-end">$${fmtNum(r.subtotal)}</td>
                    <td>${badge(r.estado_remito)}</td>
                    <td>${esc(r.chofer) || '<span class="text-muted">-</span>'}</td>
                </tr>`).join('');
        }
    }

    function renderStats(t) {
        stats.innerHTML = `
            <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2">
                <div class="small text-muted">Cantidad entregada</div>
                <div class="h5 mb-0">${fmtNum(t.cantidad_total)}</div></div></div></div>
            <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2">
                <div class="small text-muted">Subtotal</div>
                <div class="h5 mb-0">$${fmtNum(t.subtotal_total)}</div></div></div></div>
            <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2">
                <div class="small text-muted">Productos distintos</div>
                <div class="h5 mb-0">${t.productos_distintos}</div></div></div></div>
            <div class="col-6 col-md-3"><div class="card stat-card"><div class="card-body py-2">
                <div class="small text-muted">Remitos</div>
                <div class="h5 mb-0">${t.remitos_distintos}</div></div></div></div>`;
    }

    // ─── CARGA ───
    async function cargar() {
        const modo = modoActual();
        renderHead(modo);
        renderChips();
        actualizarRangoLabel();
        body.innerHTML = `<tr><td colspan="8" class="text-center py-4">
            <div class="spinner-border spinner-border-sm"></div> Cargando...</td></tr>`;
        try {
            const f = leerFiltros();
            const data = await fetchAPI('/?' + toQuery(f));
            renderFilas(data.modo, data.filas);
            renderStats(data.totales);
            info.textContent = `${data.meta.count} ${data.modo === 'agregado' ? 'productos' : 'líneas'}`;
        } catch (e) {
            body.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">${esc(e.message)}</td></tr>`;
        }
    }

    // ─── Setear rango y navegación por día ───
    function setRango(desdeISO, hastaISO) {
        fDesde.value = desdeISO;
        fHasta.value = hastaISO;
        actualizarRangoLabel();
    }
    function irHoy() { const h = hoyISO(); setRango(h, h); cargar(); }
    function moverDia(n) {
        // Mueve ambos extremos n días. Si no hay fecha, parte de hoy.
        const base = fDesde.value || hoyISO();
        const baseH = fHasta.value || base;
        setRango(sumarDiasISO(base, n), sumarDiasISO(baseH, n));
        cargar();
    }

    function limpiar() {
        // Limpiar = volver al estado inicial: HOY + sin textos/selects.
        fEstado.value = ''; fDeposito.value = ''; fChofer.value = '';
        fProducto.value = ''; fCliente.value = '';
        irHoy();
    }

    function exportar() {
        const f = leerFiltros();
        const url = `${API}/export?` + toQuery(f) + `&_t=${token}`;
        window.open(url, '_blank');
    }

    // ─── verRemito: modal in-place (reusa GET /api/remitos/:id) ───
    async function verRemito(idRemito) {
        const cont = document.getElementById('modalRemitoContenido');
        const apiRemitos = (window.CONFIG?.API_BASE_URL || '/api') + '/remitos';
        cont.innerHTML = `<div class="text-center py-4">
            <div class="spinner-border spinner-border-sm"></div> Cargando remito...</div>`;
        const modal = new bootstrap.Modal(document.getElementById('modalRemito'));
        modal.show();
        try {
            const res = await fetch(`${apiRemitos}/${idRemito}`, { headers });
            if (!res.ok) throw new Error('No se pudo cargar el remito');
            const r = await res.json();
            const fecha = r.fecha_emision ? new Date(r.fecha_emision).toLocaleDateString('es-AR') : '-';
            const badgeMap = { entregado: 'success', parcial: 'warning text-dark',
                no_entregado: 'danger', despachado: 'info', anulado: 'danger' };
            const badge = badgeMap[r.estado] || 'secondary';
            const items = r.items || [];
            cont.innerHTML = `
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h5 class="mb-0">${esc(r.numero_completo || '')}</h5>
                    <span class="badge bg-${badge} fs-6">${esc(r.estado)}</span>
                </div>
                <div class="row mb-3">
                    <div class="col-md-6"><div class="card"><div class="card-body p-2">
                        <small class="text-muted">Cliente</small>
                        <div class="fw-bold">${esc(r.cliente_nombre || 'Sin cliente')}</div>
                        ${r.cliente_cuit ? `<div class="small text-muted">CUIT: ${esc(r.cliente_cuit)}</div>` : ''}
                        ${r.cliente_domicilio ? `<div class="small">${esc(r.cliente_domicilio)}</div>` : ''}
                        ${r.cliente_telefono ? `<div class="small">${esc(r.cliente_telefono)}</div>` : ''}
                    </div></div></div>
                    <div class="col-md-6"><div class="card"><div class="card-body p-2">
                        <small class="text-muted">Datos del remito</small>
                        <div>Fecha: <strong>${fecha}</strong></div>
                        ${r.pedido_numero ? `<div>Pedido: <strong>${esc(r.pedido_numero)}</strong></div>` : ''}
                        ${r.deposito_nombre ? `<div>Depósito: ${esc(r.deposito_nombre)}</div>` : ''}
                        ${r.usuario_nombre ? `<div>Usuario: ${esc(r.usuario_nombre)}</div>` : ''}
                    </div></div></div>
                </div>
                ${r.observaciones ? `<div class="alert alert-light mb-3"><small class="text-muted">Observaciones:</small> ${esc(r.observaciones)}</div>` : ''}
                <h6>Items (${items.length})</h6>
                <div class="table-responsive">
                    <table class="table table-sm table-striped mb-0">
                        <thead><tr>
                            <th>Código</th><th>Producto</th>
                            <th class="text-center">Cantidad</th>
                            <th class="text-center">Entregada</th>
                            <th>Depósito</th>
                        </tr></thead>
                        <tbody>
                            ${items.map(it => `
                                <tr>
                                    <td class="small">${esc(it.producto_codigo || '-')}</td>
                                    <td>${esc(it.producto_nombre || it.descripcion || 'Sin nombre')}</td>
                                    <td class="text-center fw-bold">${it.cantidad ?? 0}</td>
                                    <td class="text-center">${it.cantidad_entregada ?? 0}</td>
                                    <td class="small">${esc(it.deposito_origen_nombre || '-')}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`;
        } catch (err) {
            cont.innerHTML = `<div class="alert alert-danger mb-0">${esc(err.message)}</div>`;
        }
    }

    // ─── EVENTOS ───
    btnBuscar.addEventListener('click', () => cargar());
    btnLimpiar.addEventListener('click', limpiar);
    btnExportar.addEventListener('click', exportar);
    if (btnDiaAnterior) btnDiaAnterior.addEventListener('click', () => moverDia(-1));
    if (btnDiaSiguiente) btnDiaSiguiente.addEventListener('click', () => moverDia(1));
    if (btnHoy) btnHoy.addEventListener('click', irHoy);

    document.querySelectorAll('input[name="modoVista"]').forEach(r =>
        r.addEventListener('change', () => { guardarVistaDebounced(); cargar(); }));
    [fProducto, fCliente].forEach(inp =>
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') cargar(); }));
    [fDesde, fHasta, fEstado, fDeposito, fChofer].forEach(inp =>
        inp.addEventListener('change', () => cargar()));

    // Delegation: quitar chip
    chips.addEventListener('click', (e) => {
        const x = e.target.closest('.chip-x');
        if (x) quitarFiltro(x.dataset.k);
    });

    // Delegation: ver remito en modal
    body.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-ver-remito');
        if (btn) { e.preventDefault(); verRemito(btn.dataset.id); }
    });

    // Keyboard-first: F5 refrescar, F8 exportar
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); cargar(); }
        if (e.key === 'F8') { e.preventDefault(); exportar(); }
    });

    // ─── INIT ───
    async function init() {
        // Opciones de selects
        try {
            const op = await fetchAPI('/opciones');
            fEstado.insertAdjacentHTML('beforeend',
                op.estados.map(s => `<option value="${s}">${s}</option>`).join(''));
            fDeposito.insertAdjacentHTML('beforeend',
                op.depositos.map(d => `<option value="${d.id_deposito}">${esc(d.nombre)}</option>`).join(''));
            fChofer.insertAdjacentHTML('beforeend',
                op.choferes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join(''));
        } catch (e) {
            console.warn('No se pudieron cargar opciones de filtro:', e.message);
        }

        // Memoria: SOLO la vista (detalle/agregado). Nada de textos/selects.
        try {
            const { filtro } = await fetchAPI('/filtro-ultimo');
            if (filtro && filtro.modo === 'agregado') el('modoAgregado').checked = true;
        } catch (_) { /* sin preferencia previa */ }

        // Rango por defecto: HOY (calculado en el navegador, hora local).
        irHoy();
    }

    init();
});
