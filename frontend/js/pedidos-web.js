/* ═══════════════════════════════════════════════════════════════════════════
   PEDIDOS-WEB.JS — Frontend del modulo de gestion de pedidos web (admin)
   ═══════════════════════════════════════════════════════════════════════════
   - Tabs: pendientes, carritos abandonados, clientes web
   - Drawer lateral para detalle/edicion
   - Acciones: aprobar, rechazar, modificar items
   - Atajos: F2 (aprobar), F3 (buscar), R (rechazar), Esc (cerrar)
   - Usa window.CONFIG.API_BASE_URL y cookie httpOnly erp_token (auto)
═══════════════════════════════════════════════════════════════════════════ */

const PW_API = window.CONFIG?.API_BASE_URL || '/api';
const PW_ADMIN = PW_API + '/admin/pedidos-web';

let estado = {
    tab: 'pendientes',
    pendientes: [],
    abandonados: [],
    clientes: [],
    pedidoSeleccionado: null,
    indiceFila: -1
};

// ─────────────────────────────────────────────────────────────────────────
// FETCH WRAPPER
// ─────────────────────────────────────────────────────────────────────────

async function api(method, url, body) {
    const opt = {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) opt.body = JSON.stringify(body);
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
}

// ─────────────────────────────────────────────────────────────────────────
// FORMATO
// ─────────────────────────────────────────────────────────────────────────

const fmt$ = n => '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = s => {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
};
const horasDesde = s => {
    if (!s) return 0;
    return Math.floor((Date.now() - new Date(s).getTime()) / 3600000);
};
const fmtHoras = h => {
    if (h < 1) return 'recien';
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
};

// ─────────────────────────────────────────────────────────────────────────
// CARGA DE METRICAS
// ─────────────────────────────────────────────────────────────────────────

async function cargarMetricas() {
    try {
        const total = estado.pendientes.reduce((a, p) => a + Number(p.total_final || 0), 0);
        document.getElementById('m_pendientes').textContent = estado.pendientes.length;
        document.getElementById('m_abandonados').textContent = estado.abandonados.length;
        document.getElementById('m_clientes').textContent    = estado.clientes.length;
        document.getElementById('m_total').textContent       = fmt$(total);
        document.getElementById('badge_pendientes').textContent  = estado.pendientes.length;
        document.getElementById('badge_abandonados').textContent = estado.abandonados.length;
        document.getElementById('badge_clientes').textContent    = estado.clientes.length;
    } catch (e) { console.error(e); }
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: PENDIENTES
// ─────────────────────────────────────────────────────────────────────────

async function cargarPendientes() {
    const tbody = document.getElementById('tbody_pendientes');
    const selectFiltro = document.getElementById('filtroEstadoPedidosWeb');
    const filtro = selectFiltro ? selectFiltro.value : 'pendientes';
    tbody.innerHTML = '<tr><td colspan="8" class="empty"><div class="spinner-border spinner-mini"></div> Cargando...</td></tr>';
    try {
        const r = await api('GET', PW_ADMIN + '/pendientes?filtro=' + encodeURIComponent(filtro));
        estado.pendientes  = r.pedidos || [];
        estado.umbralHoras = r.umbral_horas_alerta || 24;
        renderPendientes();
        cargarMetricas();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty text-danger">Error: ${e.message}</td></tr>`;
    }
}

function renderPendientes() {
    const tbody = document.getElementById('tbody_pendientes');
    const filtroTxt = (document.getElementById('filtroPendientes').value || '').toLowerCase();
    const umbral = Number(estado.umbralHoras) || 24;
    const lista = estado.pendientes.filter(p => {
        if (!filtroTxt) return true;
        return (p.razon_social || '').toLowerCase().includes(filtroTxt)
            || String(p.nro_pedido || '').includes(filtroTxt)
            || (p.telefono || '').includes(filtroTxt)
            || (p.usuario_web || '').toLowerCase().includes(filtroTxt);
    });

    const cnt = document.getElementById('contadorPendientes');
    if (cnt) {
        const urgentes = lista.filter(p => (Number(p.horas_espera) || 0) >= umbral).length;
        cnt.textContent = lista.length + ' pedido' + (lista.length !== 1 ? 's' : '')
            + (urgentes > 0 ? ' · ' + urgentes + ' urgente' + (urgentes !== 1 ? 's' : '') : '');
    }

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty"><i class="bi bi-inbox"></i> Sin resultados</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map((p, i) => {
        const horas = Number(p.horas_espera) || 0;
        const esUrgente = horas >= umbral;
        const badge = esUrgente
            ? `<span class="badge bg-danger ms-1" title="Sin atender hace ${Math.floor(horas)}h">⏰ +${Math.floor(horas)}h</span>`
            : '';
        const estadoBadge = p.estado_nombre
            ? `<span class="badge bg-secondary ms-1" style="font-size:0.65rem">${escapeHtml(p.estado_nombre)}</span>`
            : '';
        const carritoRef = p.id_carrito_web
            ? `<span class="text-muted" style="font-size:0.72rem">· Carrito #${p.id_carrito_web}</span>`
            : '';
        return `
        <tr data-idx="${i}" data-id="${p.id_pedido}" onclick="seleccionarFila(${i}, ${p.id_pedido})" class="${esUrgente ? 'table-warning' : ''}">
            <td>
                <strong>#${p.nro_pedido}</strong> ${badge}
                <div>${estadoBadge}</div>
            </td>
            <td>
                <div class="fw-semibold">${escapeHtml(p.razon_social || '—')}</div>
                <div class="text-muted small">${escapeHtml(p.usuario_web || '')} ${carritoRef}</div>
            </td>
            <td class="small">
                ${p.telefono ? '<i class="bi bi-telephone"></i> ' + escapeHtml(p.telefono) + '<br>' : ''}
                ${p.email ? '<i class="bi bi-envelope"></i> ' + escapeHtml(p.email) : ''}
            </td>
            <td class="text-end">${p.cant_items}</td>
            <td class="text-end fw-bold">${fmt$(p.total_final)}</td>
            <td class="small">${escapeHtml(p.tipo_entrega || '—')}</td>
            <td class="horas-espera ${esUrgente ? 'urgente' : ''}">${fmtHoras(horas)}</td>
            <td class="text-center" onclick="event.stopPropagation()">
                <button class="btn btn-sm btn-success" title="Aprobar (F2)" onclick="aprobarPedido(${p.id_pedido})">
                    <i class="bi bi-check-lg"></i>
                </button>
                <button class="btn btn-sm btn-outline-primary" title="Ver detalle" onclick="abrirDetalle(${p.id_pedido})">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" title="Rechazar" onclick="rechazarPedido(${p.id_pedido})">
                    <i class="bi bi-x-lg"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: ABANDONADOS
// ─────────────────────────────────────────────────────────────────────────

async function cargarAbandonados() {
    const tbody = document.getElementById('tbody_abandonados');
    tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="spinner-border spinner-mini"></div> Cargando...</td></tr>';
    try {
        const r = await api('GET', PW_ADMIN + '/extra/carritos-abandonados');
        estado.abandonados = r.carritos || [];
        renderAbandonados();
        cargarMetricas();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty text-danger">Error: ${e.message}</td></tr>`;
    }
}

function renderAbandonados() {
    const tbody = document.getElementById('tbody_abandonados');
    const filtro = (document.getElementById('filtroAbandonados').value || '').toLowerCase();
    const lista = estado.abandonados.filter(c => {
        if (!filtro) return true;
        return (c.razon_social || '').toLowerCase().includes(filtro)
            || (c.usuario_web || '').toLowerCase().includes(filtro);
    });

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty"><i class="bi bi-cart-check"></i> Sin carritos abandonados</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(c => `
        <tr>
            <td>
                <div class="fw-semibold">${escapeHtml(c.razon_social || '—')}</div>
                <div class="text-muted small">${escapeHtml(c.usuario_web || '')}</div>
            </td>
            <td class="small">
                ${c.telefono ? '<i class="bi bi-telephone"></i> ' + escapeHtml(c.telefono) + '<br>' : ''}
                ${c.email ? '<i class="bi bi-envelope"></i> ' + escapeHtml(c.email) : ''}
            </td>
            <td class="text-end">${c.cant_items}</td>
            <td class="text-end fw-bold">${fmt$(c.total_estimado)}</td>
            <td class="small">${fmtFecha(c.fecha_modificacion)}</td>
            <td class="text-center">
                ${c.telefono ? `<a class="btn btn-sm btn-success" target="_blank" 
                    href="https://wa.me/${c.telefono.replace(/[^0-9]/g,'')}?text=${encodeURIComponent('Hola! Dejaste productos en tu carrito de LAGO. Ingresa para finalizarlo.')}"
                    title="Recordar por WhatsApp"><i class="bi bi-whatsapp"></i></a>` : '—'}
            </td>
        </tr>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// TAB: CLIENTES WEB
// ─────────────────────────────────────────────────────────────────────────

async function cargarClientes() {
    const tbody = document.getElementById('tbody_clientes');
    tbody.innerHTML = '<tr><td colspan="9" class="empty"><div class="spinner-border spinner-mini"></div> Cargando...</td></tr>';
    try {
        const r = await api('GET', PW_ADMIN + '/extra/clientes');
        estado.clientes = r.clientes || [];
        renderClientes();
        cargarMetricas();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty text-danger">Error: ${e.message}</td></tr>`;
    }
}

function renderClientes() {
    const tbody = document.getElementById('tbody_clientes');
    const filtro = (document.getElementById('filtroClientes').value || '').toLowerCase();
    const lista = estado.clientes.filter(c => {
        if (!filtro) return true;
        return (c.razon_social || '').toLowerCase().includes(filtro)
            || (c.usuario_web || '').toLowerCase().includes(filtro)
            || (c.email || '').toLowerCase().includes(filtro);
    });

    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty">Sin clientes web registrados</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map(c => {
        const estadoBadge = !c.web_aprobado
            ? '<span class="badge-estado badge-pendiente">Pendiente</span>'
            : (c.web_activo
                ? '<span class="badge-estado badge-aprobado">Activo</span>'
                : '<span class="badge-estado badge-rechazado">Inactivo</span>');
        return `
        <tr>
            <td class="fw-semibold">${escapeHtml(c.razon_social || '—')}</td>
            <td>${escapeHtml(c.usuario_web || '')}</td>
            <td class="small">${escapeHtml(c.email || '—')}</td>
            <td class="small">${escapeHtml(c.telefono || '—')}</td>
            <td><span class="badge bg-light text-dark small">${escapeHtml(c.web_origen || '—')}</span></td>
            <td>${estadoBadge}</td>
            <td class="small">${fmtFecha(c.fecha_alta_web)}</td>
            <td class="small">${fmtFecha(c.ultimo_login_web)}</td>
            <td class="text-center">
                ${!c.web_aprobado ? `<button class="btn btn-sm btn-success" title="Aprobar acceso" onclick="aprobarCliente(${c.id_cliente})"><i class="bi bi-check-lg"></i></button>` : ''}
                ${c.web_activo ? `<button class="btn btn-sm btn-outline-danger" title="Desactivar" onclick="desactivarCliente(${c.id_cliente})"><i class="bi bi-pause"></i></button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────
// DRAWER DETALLE
// ─────────────────────────────────────────────────────────────────────────

async function abrirDetalle(id_pedido) {
    document.getElementById('drawer').classList.add('show');
    document.getElementById('drawerOverlay').classList.add('show');
    document.getElementById('d_titulo').textContent = '#' + id_pedido;
    document.getElementById('drawerBody').innerHTML = '<div class="text-center p-4"><div class="spinner-border"></div></div>';
    estado.pedidoSeleccionado = id_pedido;

    try {
        const p = await api('GET', PW_ADMIN + '/' + id_pedido);
        document.getElementById('d_titulo').textContent = '#' + p.nro_pedido + ' — ' + (p.razon_social || '—');
        renderDrawer(p);
    } catch (e) {
        document.getElementById('drawerBody').innerHTML = `<div class="alert alert-danger">${e.message}</div>`;
    }
}

function renderDrawer(p) {
    const itemsHtml = (p.items || []).map(it => `
        <div class="item-row">
            <div class="nombre" title="${escapeHtml(it.descripcion_congelada)}">
                ${escapeHtml(it.descripcion_congelada)}
            </div>
            <input type="number" min="0" step="0.5" value="${it.cantidad}" 
                   onchange="modificarItemDrawer(${p.id_pedido}, ${it.id_item}, this.value)">
            <div class="text-end small">${fmt$(it.precio_unitario_final)}</div>
            <div class="text-end fw-bold">${fmt$(it.total_linea)}</div>
            <button class="btn btn-sm btn-link text-danger p-0" 
                    onclick="modificarItemDrawer(${p.id_pedido}, ${it.id_item}, 0)" title="Eliminar">
                <i class="bi bi-trash"></i>
            </button>
        </div>
    `).join('');

    document.getElementById('drawerBody').innerHTML = `
        <div class="row g-2 mb-3 small">
            <div class="col-6"><strong>Cliente:</strong> ${escapeHtml(p.razon_social || '—')}</div>
            <div class="col-6"><strong>Usuario:</strong> ${escapeHtml(p.usuario_web || '—')}</div>
            <div class="col-6"><strong>Telefono:</strong> ${escapeHtml(p.telefono || '—')}</div>
            <div class="col-6"><strong>Email:</strong> ${escapeHtml(p.email || '—')}</div>
            <div class="col-6"><strong>Entrega:</strong> ${escapeHtml(p.tipo_entrega || '—')}</div>
            <div class="col-6"><strong>Fecha:</strong> ${fmtFecha(p.fecha_creacion)}</div>
            ${p.domicilio_entrega ? `<div class="col-12"><strong>Domicilio:</strong> ${escapeHtml(p.domicilio_entrega)}</div>` : ''}
            ${p.observaciones ? `<div class="col-12"><strong>Observaciones:</strong> ${escapeHtml(p.observaciones)}</div>` : ''}
        </div>

        <h6 class="text-muted text-uppercase small mb-2">Items</h6>
        <div class="border rounded">
            <div class="item-row fw-bold bg-light text-muted small text-uppercase">
                <div>Producto</div><div class="text-end">Cant</div>
                <div class="text-end">Precio</div><div class="text-end">Total</div><div></div>
            </div>
            ${itemsHtml || '<div class="empty">Sin items</div>'}
        </div>

        <div class="text-end mt-3 mb-3" id="d_totales">
            <div class="small text-muted">Subtotal: ${fmt$(p.subtotal_sin_iva)} + IVA ${fmt$(p.total_iva)}</div>
            <div class="h4 mb-0 text-primary">${fmt$(p.total_final)}</div>
        </div>

        <div class="d-grid gap-2">
            <button class="btn btn-success btn-lg" onclick="aprobarPedido(${p.id_pedido})">
                <i class="bi bi-check-circle"></i> Aprobar Pedido (F2)
            </button>
            <button class="btn btn-outline-danger" onclick="rechazarPedido(${p.id_pedido})">
                <i class="bi bi-x-circle"></i> Rechazar Pedido
            </button>
        </div>
    `;
}

function cerrarDrawer() {
    document.getElementById('drawer').classList.remove('show');
    document.getElementById('drawerOverlay').classList.remove('show');
    estado.pedidoSeleccionado = null;
}

// ─────────────────────────────────────────────────────────────────────────
// ACCIONES
// ─────────────────────────────────────────────────────────────────────────

async function aprobarPedido(id_pedido) {
    if (!confirm('¿Aprobar el pedido #' + id_pedido + '? Pasara a estado Pendiente y el flujo normal de venta podra continuar.')) return;
    try {
        await api('POST', PW_ADMIN + '/' + id_pedido + '/aprobar');
        toast('Pedido aprobado', 'success');
        cerrarDrawer();
        cargarPendientes();
    } catch (e) {
        toast('Error: ' + e.message, 'danger');
    }
}

async function rechazarPedido(id_pedido) {
    const motivo = prompt('Motivo del rechazo:');
    if (motivo === null) return;
    try {
        await api('POST', PW_ADMIN + '/' + id_pedido + '/rechazar', { motivo });
        toast('Pedido rechazado', 'success');
        cerrarDrawer();
        cargarPendientes();
    } catch (e) {
        toast('Error: ' + e.message, 'danger');
    }
}

async function modificarItemDrawer(id_pedido, id_item, cantidad) {
    try {
        await api('PUT', PW_ADMIN + '/' + id_pedido + '/items/' + id_item, { cantidad: Number(cantidad) });
        await abrirDetalle(id_pedido); // recarga
        cargarPendientes();
    } catch (e) {
        toast('Error: ' + e.message, 'danger');
    }
}

async function aprobarCliente(id_cliente) {
    try {
        await api('PUT', PW_ADMIN + '/extra/clientes/' + id_cliente + '/aprobar');
        toast('Cliente aprobado', 'success');
        cargarClientes();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
}

async function desactivarCliente(id_cliente) {
    if (!confirm('Desactivar acceso web del cliente?')) return;
    try {
        await api('PUT', PW_ADMIN + '/extra/clientes/' + id_cliente + '/desactivar');
        toast('Cliente desactivado', 'success');
        cargarClientes();
    } catch (e) { toast('Error: ' + e.message, 'danger'); }
}

// ─────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────

function cambiarTab(tab) {
    estado.tab = tab;
    document.querySelectorAll('#tabsPedidosWeb .nav-link').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.getElementById('tab_pendientes').style.display  = tab === 'pendientes'  ? '' : 'none';
    document.getElementById('tab_abandonados').style.display = tab === 'abandonados' ? '' : 'none';
    document.getElementById('tab_clientes').style.display    = tab === 'clientes'    ? '' : 'none';
    if (tab === 'pendientes')  cargarPendientes();
    if (tab === 'abandonados') cargarAbandonados();
    if (tab === 'clientes')    cargarClientes();
}

// ─────────────────────────────────────────────────────────────────────────
// SELECCION DE FILA + ATAJOS
// ─────────────────────────────────────────────────────────────────────────

function seleccionarFila(idx, id_pedido) {
    estado.indiceFila = idx;
    document.querySelectorAll('#tbody_pendientes tr').forEach(tr => tr.classList.remove('selected'));
    const row = document.querySelector(`#tbody_pendientes tr[data-idx="${idx}"]`);
    if (row) row.classList.add('selected');
    abrirDetalle(id_pedido);
}

function setupAtajos() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (e.key === 'Escape') e.target.blur();
            return;
        }
        if (e.key === 'F2' && estado.pedidoSeleccionado) {
            e.preventDefault();
            aprobarPedido(estado.pedidoSeleccionado);
        }
        if (e.key === 'F3') {
            e.preventDefault();
            const f = document.getElementById('filtro' + estado.tab.charAt(0).toUpperCase() + estado.tab.slice(1));
            if (f) f.focus();
        }
        if (e.key === 'Escape') cerrarDrawer();
        if ((e.key === 'r' || e.key === 'R') && estado.pedidoSeleccionado) {
            rechazarPedido(estado.pedidoSeleccionado);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function toast(msg, tipo = 'info') {
    const div = document.createElement('div');
    div.className = `alert alert-${tipo} position-fixed shadow`;
    div.style.cssText = 'top: 70px; right: 20px; z-index: 9999; min-width: 260px;';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

async function logout() {
    try {
        await fetch(PW_API + '/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {}
    window.location.href = '/login.html';
}

async function cargarUsuario() {
    try {
        const r = await fetch(PW_API + '/auth/perfil', { credentials: 'include' });
        if (r.ok) {
            const u = await r.json();
            document.getElementById('userInfo').textContent = (u.nombre || u.username || '') + ' (' + (u.rol || '') + ')';
        }
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    cargarUsuario();

    document.querySelectorAll('#tabsPedidosWeb .nav-link').forEach(b => {
        b.addEventListener('click', () => cambiarTab(b.dataset.tab));
    });

    document.getElementById('filtroPendientes').addEventListener('input', renderPendientes);
    document.getElementById('filtroAbandonados').addEventListener('input', renderAbandonados);
    document.getElementById('filtroClientes').addEventListener('input', renderClientes);

    setupAtajos();
    cargarPendientes();
    // precarga las otras tabs en segundo plano para llenar metricas
    cargarAbandonados();
    cargarClientes();
});
