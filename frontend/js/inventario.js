/**
 * ============================================================================
 * INVENTARIO - ERP LAGO (Lote B Rewrite, 2026-05-17)
 * ============================================================================
 * Reemplaza el JS inline del inventario.html viejo. Preserva todas las
 * funcionalidades existentes (corrección stock, transferencia, importación
 * Excel, historial ajustes, movimientos, stock por depósitos) y agrega las
 * features del Lote B:
 *   - Mín/Máx editables inline (PUT /api/inventario/:id/min-max)
 *   - Stock disponible y OCs activas en tabla
 *   - Filtro Proveedor + toggle Solo bajo mínimo
 *   - Selección múltiple + Generar OCs
 *   - Modal OCs activas por producto
 * ============================================================================
 */
(function () {
'use strict';

document.addEventListener('DOMContentLoaded', () => {

// ============================================================================
// CONFIG
// ============================================================================
const token = localStorage.getItem('authToken');
if (!token) { window.location.href = '/login.html'; return; }

const BASE = window.CONFIG?.API_BASE_URL || '/api';
const API_INV = BASE + '/inventario';
const API_AJ  = BASE + '/ajustes-inventario';
const API_OC  = BASE + '/ordenes-compra';
const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

// ============================================================================
// ESTADO
// ============================================================================
const Estado = {
    inventario: [],
    inventarioFiltrado: [],
    seleccionados: new Set(),
    modoCorreccion: false,
    ajusteActual: null,
    itemsModificados: {},
    paginaActual: 1,
    itemsPorPagina: 100,
    depositos: [],
    depositoSeleccionado: null,
    proveedoresCache: [],
    filtros: {
        busqueda: '', marca: '', categoria: '', subcategoria: '',
        proveedor: '', stock: '', soloBajoMinimo: false
    },
    minMaxPending: new Map()
};

// ============================================================================
// DOM
// ============================================================================
const el = {
    buscador:            document.getElementById('buscador'),
    filtroDeposito:      document.getElementById('filtroDeposito'),
    filtroMarca:         document.getElementById('filtroMarca'),
    filtroCategoria:     document.getElementById('filtroCategoria'),
    filtroSubcategoria:  document.getElementById('filtroSubcategoria'),
    filtroProveedor:     document.getElementById('filtroProveedor'),
    filtroStock:         document.getElementById('filtroStock'),
    chkSoloBajoMin:      document.getElementById('chkSoloBajoMin'),
    toggleSoloBajoMin:   document.getElementById('toggleSoloBajoMin'),
    btnLimpiarFiltros:   document.getElementById('btnLimpiarFiltros'),
    tablaBody:           document.getElementById('tablaInvBody'),
    contadorProductos:   document.getElementById('contadorProductos'),
    chkSeleccionarTodos: document.getElementById('chkSeleccionarTodos'),
    paginacion:          document.getElementById('paginacion'),
    selPorPagina:        document.getElementById('selPorPagina'),
    navBtnGenerarOC:     document.getElementById('navBtnGenerarOC'),
    navBtnTransferir:    document.getElementById('navBtnTransferir'),
    navBtnImportarExcel: document.getElementById('navBtnImportarExcel'),
    navBtnExportarExcel: document.getElementById('navBtnExportarExcel'),
    navBtnImprimir:      document.getElementById('navBtnImprimir'),
    navBtnHistorial:     document.getElementById('navBtnHistorial'),
    panelCorreccion:     document.getElementById('panelCorreccion'),
    btnHabilitarCorrec:  document.getElementById('btnHabilitarCorreccion'),
    btnCancelarCorrec:   document.getElementById('btnCancelarCorreccion'),
    btnLlenarCero:       document.getElementById('btnLlenarCero'),
    btnCopiarSistema:    document.getElementById('btnCopiarSistema'),
    btnAplicarAjuste:    document.getElementById('btnAplicarAjuste'),
    infoAjuste:          document.getElementById('infoAjuste'),
    inputMotivoAjuste:   document.getElementById('inputMotivoAjuste'),
    resumenDiferencias:  document.getElementById('resumenDiferencias'),
    statItems:           document.getElementById('statItems'),
    statConCambios:      document.getElementById('statConCambios'),
    statEntradas:        document.getElementById('statEntradas'),
    statSalidas:         document.getElementById('statSalidas'),
    bulkBar:             document.getElementById('bulkBar'),
    bulkCount:           document.getElementById('bulkCount'),
    bulkConProveedor:    document.getElementById('bulkConProveedor'),
    bulkSinProveedor:    document.getElementById('bulkSinProveedor'),
    btnDeseleccionar:    document.getElementById('btnDeseleccionar'),
    btnGenerarOCsBulk:   document.getElementById('btnGenerarOCsBulk')
};

// ============================================================================
// UTILS
// ============================================================================
function num(v) { return v == null ? 0 : (typeof v === 'number' ? v : parseFloat(v) || 0); }
function fmtNum(v, decs = 2) {
    const n = num(v);
    if (Number.isInteger(n)) return n.toLocaleString('es-AR');
    return n.toLocaleString('es-AR', { minimumFractionDigits: decs, maximumFractionDigits: decs });
}
function fmtNumPlain(v) {
    const n = num(v);
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
}
function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escHtml(s); }
function debounce(fn, wait) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}
function formatearFecha(f) {
    if (!f) return '-';
    try { return new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return f; }
}
function mostrarError(msg) {
    el.tablaBody.innerHTML = '<tr><td colspan="11" class="empty-state"><i class="bi bi-exclamation-triangle text-danger"></i><br>' + escHtml(msg) + '</td></tr>';
}
function mostrarLoading() {
    el.tablaBody.innerHTML = '<tr><td colspan="11" class="empty-state"><div class="lago-spinner"></div> Cargando inventario...</td></tr>';
}

// ============================================================================
// INIT + CARGAS
// ============================================================================
async function init() {
    try {
        await cargarDepositos();
        await Promise.all([cargarFiltrosCatalogos(), cargarProveedores()]);
        await cargarInventario();
        configurarEventos();
    } catch (e) {
        console.error('[inventario] init:', e);
        mostrarError('Error al inicializar: ' + e.message);
    }
}

async function cargarDepositos() {
    const r = await fetch(API_INV + '/depositos', { headers });
    if (!r.ok) throw new Error('No se pudo cargar depósitos');
    Estado.depositos = await r.json();
    const totalProds = Estado.depositos.reduce((s, d) => s + parseInt(d.productos_con_stock || 0), 0);
    el.filtroDeposito.innerHTML = '<option value="todos">📦 Todos los depósitos (' + totalProds + ' prods)</option>' +
        Estado.depositos.map(d =>
            `<option value="${d.id_deposito}" ${d.es_principal ? 'selected' : ''}>${d.es_principal ? '🏠' : '📍'} ${escHtml(d.nombre)} (${d.productos_con_stock} prods)</option>`
        ).join('');
    Estado.depositoSeleccionado = el.filtroDeposito.value;
}

async function cargarFiltrosCatalogos() {
    const [marcasR, categR] = await Promise.all([
        fetch(BASE + '/marcas', { headers }).then(r => r.ok ? r.json() : []),
        fetch(BASE + '/categorias', { headers }).then(r => r.ok ? r.json() : [])
    ]);
    el.filtroMarca.innerHTML = '<option value="">Todas</option>' +
        marcasR.map(m => `<option value="${m.id_marca}">${escHtml(m.nombre)}</option>`).join('');
    el.filtroCategoria.innerHTML = '<option value="">Todas</option>' +
        categR.map(c => `<option value="${c.id_categoria}">${escHtml(c.nombre)}</option>`).join('');
    el.filtroSubcategoria.innerHTML = '<option value="">Todas</option>' +
        categR.map(c => `<option value="${c.id_categoria}">${escHtml(c.nombre)}</option>`).join('');
}

async function cargarProveedores() {
    try {
        const r = await fetch(BASE + '/proveedores', { headers });
        if (!r.ok) { console.warn('[inventario] proveedores no disponible'); return; }
        const data = await r.json();
        const provs = Array.isArray(data) ? data : (data.proveedores || data.data || []);
        Estado.proveedoresCache = provs.filter(p => p.activo !== false);
        el.filtroProveedor.innerHTML = '<option value="">Todos</option>' +
            Estado.proveedoresCache.map(p =>
                `<option value="${p.id_proveedor}">${escHtml(p.razon_social || p.nombre || ('#' + p.id_proveedor))}</option>`
            ).join('');
    } catch (e) { console.warn('[inventario] cargarProveedores:', e.message); }
}

async function cargarInventario() {
    try {
        mostrarLoading();
        let datos;
        if (Estado.depositoSeleccionado === 'todos') {
            const promises = Estado.depositos.map(d =>
                fetch(`${API_INV}/completo-extendido?id_deposito=${d.id_deposito}`, { headers })
                    .then(r => r.ok ? r.json() : { data: [] })
            );
            const todos = await Promise.all(promises);
            const merged = {};
            todos.forEach((resp, idx) => {
                const dep = Estado.depositos[idx];
                const items = resp.data || resp;
                items.forEach(item => {
                    if (!merged[item.id_producto]) {
                        merged[item.id_producto] = { ...item,
                            stock_real: 0, stock_comprometido: 0, stock_disponible: 0,
                            stock_minimo: 0, stock_maximo: 0,
                            depositos_detalle: []
                        };
                    }
                    const m = merged[item.id_producto];
                    m.stock_real         += num(item.stock_real);
                    m.stock_comprometido += num(item.stock_comprometido);
                    m.stock_disponible   += num(item.stock_disponible);
                    m.stock_minimo       += num(item.stock_minimo);
                    m.stock_maximo       += num(item.stock_maximo);
                    if (num(item.stock_real) !== 0) {
                        m.depositos_detalle.push({ nombre: dep.nombre, codigo: dep.codigo, stock: num(item.stock_real) });
                    }
                    if (num(item.ocs_activas_count) > num(m.ocs_activas_count)) {
                        m.ocs_activas_count = item.ocs_activas_count;
                    }
                });
            });
            datos = Object.values(merged);
        } else {
            const r = await fetch(`${API_INV}/completo-extendido?id_deposito=${Estado.depositoSeleccionado || ''}`, { headers });
            if (!r.ok) throw new Error('Error al cargar inventario');
            const resp = await r.json();
            datos = resp.data || resp;
        }
        Estado.inventario = datos;
        aplicarFiltros();
    } catch (e) {
        console.error('[inventario] cargarInventario:', e);
        mostrarError('No se pudo cargar el inventario: ' + e.message);
    }
}

// ============================================================================
// FILTROS Y RENDER
// ============================================================================
function aplicarFiltros() {
    let r = Estado.inventario.slice();
    const f = Estado.filtros;

    if (f.busqueda) {
        const terms = f.busqueda.toLowerCase().split(' ').filter(t => t);
        r = r.filter(it => {
            const txt = (it.sku + ' ' + it.nombre + ' ' + (it.marca_nombre || '')).toLowerCase();
            return terms.every(t => txt.includes(t));
        });
    }
    if (f.marca)        r = r.filter(it => it.id_marca == f.marca);
    if (f.categoria)    r = r.filter(it => it.id_categoria == f.categoria);
    if (f.subcategoria) r = r.filter(it => it.id_subcategoria == f.subcategoria);
    if (f.proveedor)    r = r.filter(it => it.id_proveedor_preferido == f.proveedor);

    if (f.soloBajoMinimo) {
        r = r.filter(it => num(it.stock_real) < num(it.stock_minimo) && num(it.stock_minimo) > 0);
    } else if (f.stock === 'sin_stock') {
        r = r.filter(it => num(it.stock_real) <= 0);
    } else if (f.stock === 'bajo_minimo') {
        r = r.filter(it => num(it.stock_real) > 0 && num(it.stock_real) <= num(it.stock_minimo));
    } else if (f.stock === 'con_stock') {
        r = r.filter(it => num(it.stock_real) > 0);
    }

    Estado.inventarioFiltrado = r;
    Estado.paginaActual = 1;
    el.contadorProductos.textContent = r.length.toLocaleString('es-AR');
    renderizarTabla();
    renderizarPaginacion();
    actualizarBulkBar();
}

function limpiarFiltros() {
    Estado.filtros = { busqueda: '', marca: '', categoria: '', subcategoria: '', proveedor: '', stock: '', soloBajoMinimo: false };
    el.buscador.value = '';
    el.filtroMarca.value = '';
    el.filtroCategoria.value = '';
    el.filtroSubcategoria.value = '';
    el.filtroProveedor.value = '';
    el.filtroStock.value = '';
    el.chkSoloBajoMin.checked = false;
    el.toggleSoloBajoMin.classList.remove('active');
    aplicarFiltros();
}

function renderizarTabla() {
    const inicio = (Estado.paginaActual - 1) * Estado.itemsPorPagina;
    const items = Estado.inventarioFiltrado.slice(inicio, inicio + Estado.itemsPorPagina);

    if (items.length === 0) {
        el.tablaBody.innerHTML = '<tr><td colspan="11" class="empty-state"><i class="bi bi-inbox"></i><br>No se encontraron productos</td></tr>';
        return;
    }

    const esTodos = Estado.depositoSeleccionado === 'todos';
    const modoCorrec = Estado.modoCorreccion;

    el.tablaBody.innerHTML = items.map(it => {
        const stockReal = num(it.stock_real);
        const stockDisp = num(it.stock_disponible);
        const stockMin  = num(it.stock_minimo);
        const stockMax  = num(it.stock_maximo);

        let rowCls = '';
        if (stockReal <= 0) rowCls = 'row-sin-stock';
        else if (stockReal <= stockMin && stockMin > 0) rowCls = 'row-bajo-min';
        if (Estado.seleccionados.has(it.id_producto)) rowCls += ' row-selected';

        const itemMod = Estado.itemsModificados[it.id_producto];
        const stockRealCorrec = itemMod ? itemMod.stock_real : stockReal;
        const diferencia = itemMod ? (stockRealCorrec - stockReal) : 0;
        let diffBadge = '<span class="text-muted">-</span>';
        if (diferencia > 0) diffBadge = `<span class="badge-diff pos">+${diferencia}</span>`;
        else if (diferencia < 0) diffBadge = `<span class="badge-diff neg">${diferencia}</span>`;

        const ocCount = num(it.ocs_activas_count);
        const ocBadgeHtml = ocCount > 0
            ? `<a class="oc-badge" data-action="ver-ocs" data-id="${it.id_producto}" data-nombre="${escAttr(it.nombre)}" data-sku="${escAttr(it.sku)}" title="Ver ${ocCount} OC(s) activa(s)"><i class="bi bi-cart3"></i>${ocCount}</a>`
            : `<span class="oc-badge zero" title="Sin OCs activas">0</span>`;

        const minMaxDisabled = esTodos ? 'disabled title="Seleccione un depósito específico para editar"' : '';

        const depDetalle = it.depositos_detalle && it.depositos_detalle.length
            ? '<br><small style="color:#999;font-size:.7rem">' + it.depositos_detalle.map(d => escHtml(d.codigo) + ': ' + fmtNum(d.stock)).join(' | ') + '</small>'
            : '';

        return `
        <tr data-id="${it.id_producto}" class="${rowCls}">
            <td class="text-center">
                <input type="checkbox" class="row-checkbox" data-id="${it.id_producto}" ${Estado.seleccionados.has(it.id_producto) ? 'checked' : ''}>
            </td>
            <td><code style="font-size:.8rem">${escHtml(it.sku)}</code></td>
            <td>${escHtml(it.nombre)}${depDetalle}</td>
            <td><small style="color:#777">${escHtml(it.marca_nombre || '-')}</small></td>
            <td class="text-center"><input type="number" class="cell-input min-max-input" data-field="stock_minimo" data-id="${it.id_producto}" value="${fmtNumPlain(stockMin)}" min="0" step="0.01" ${minMaxDisabled}></td>
            <td class="text-center"><input type="number" class="cell-input min-max-input" data-field="stock_maximo" data-id="${it.id_producto}" value="${fmtNumPlain(stockMax)}" min="0" step="0.01" ${minMaxDisabled}></td>
            <td class="text-center"><strong>${fmtNum(stockReal)}</strong></td>
            <td class="text-center" title="Real ${fmtNum(stockReal)} − Comprometido ${fmtNum(it.stock_comprometido)}">${fmtNum(stockDisp)}</td>
            <td class="text-center">${ocBadgeHtml}</td>
            <td class="text-center col-stock-real" ${modoCorrec ? '' : 'style="display:none"'}>
                <input type="number" class="input-stock-real stock-real-input ${itemMod ? 'modificado' : ''}" value="${stockRealCorrec}" min="0" step="0.01" data-id="${it.id_producto}" data-original="${stockReal}">
            </td>
            <td class="text-center col-diferencia" ${modoCorrec ? '' : 'style="display:none"'}>${diffBadge}</td>
            <td class="text-center col-acciones" ${modoCorrec ? 'style="display:none"' : ''}>
                <button class="btn-row" data-action="ver-historial" data-id="${it.id_producto}" data-nombre="${escAttr(it.nombre)}" data-sku="${escAttr(it.sku)}" title="Historial"><i class="bi bi-arrow-down-up"></i></button>
                <button class="btn-row" data-action="ver-depositos" data-id="${it.id_producto}" data-nombre="${escAttr(it.nombre)}" data-sku="${escAttr(it.sku)}" title="Stock por depósito"><i class="bi bi-building"></i></button>
                <button class="btn-row" data-action="ajuste-individual" data-id="${it.id_producto}" data-nombre="${escAttr(it.nombre)}" data-sku="${escAttr(it.sku)}" data-stock="${stockReal}" title="Ajuste manual"><i class="bi bi-pencil"></i></button>
            </td>
        </tr>`;
    }).join('');

    if (modoCorrec) actualizarEstadisticasCorrec();
    actualizarChkTodos();
}

function renderizarPaginacion() {
    const total = Estado.inventarioFiltrado.length;
    const totalPaginas = Math.ceil(total / Estado.itemsPorPagina);
    if (totalPaginas <= 1) { el.paginacion.innerHTML = ''; return; }
    const actual = Estado.paginaActual;
    let html = `<span class="info" style="color:var(--text-muted);margin-right:8px;font-size:.78rem">Página ${actual} de ${totalPaginas}</span>`;
    html += `<button class="pag-btn" data-pag="${actual - 1}" ${actual === 1 ? 'disabled' : ''}><i class="bi bi-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPaginas; i++) {
        if (i === 1 || i === totalPaginas || (i >= actual - 2 && i <= actual + 2)) {
            html += `<button class="pag-btn ${i === actual ? 'active' : ''}" data-pag="${i}">${i}</button>`;
        } else if (i === actual - 3 || i === actual + 3) {
            html += '<span class="sep">…</span>';
        }
    }
    html += `<button class="pag-btn" data-pag="${actual + 1}" ${actual === totalPaginas ? 'disabled' : ''}><i class="bi bi-chevron-right"></i></button>`;
    el.paginacion.innerHTML = html;
}

function cambiarPagina(n) {
    const total = Math.ceil(Estado.inventarioFiltrado.length / Estado.itemsPorPagina);
    if (n < 1 || n > total) return;
    Estado.paginaActual = n;
    renderizarTabla();
    renderizarPaginacion();
}

// ============================================================================
// MIN/MAX EDITABLE INLINE
// ============================================================================
function onChangeMinMax(input) {
    const id = parseInt(input.dataset.id, 10);
    const field = input.dataset.field;
    const val = parseFloat(input.value);

    if (input.value === '' || isNaN(val) || val < 0) {
        input.classList.remove('saved'); input.classList.add('error');
        return;
    }
    if (Estado.depositoSeleccionado === 'todos' || !Estado.depositoSeleccionado) {
        input.classList.add('error');
        setTimeout(() => input.classList.remove('error'), 1500);
        return;
    }

    const prod = Estado.inventario.find(p => p.id_producto === id);
    if (!prod) return;
    const minActual = field === 'stock_minimo' ? val : num(prod.stock_minimo);
    const maxActual = field === 'stock_maximo' ? val : num(prod.stock_maximo);
    if (maxActual > 0 && minActual > maxActual) {
        input.classList.add('error');
        return;
    }

    const key = id + ':' + field;
    if (Estado.minMaxPending.has(key)) clearTimeout(Estado.minMaxPending.get(key));

    input.classList.remove('error', 'saved');
    input.classList.add('saving');

    const timer = setTimeout(async () => {
        try {
            const body = { id_deposito: parseInt(Estado.depositoSeleccionado, 10) };
            body[field] = val;
            const r = await fetch(`${API_INV}/${id}/min-max`, { method: 'PUT', headers, body: JSON.stringify(body) });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || 'Error al guardar');
            }
            const data = await r.json();
            prod.stock_minimo = data.stock_minimo_nuevo;
            prod.stock_maximo = data.stock_maximo_nuevo;
            input.classList.remove('saving');
            input.classList.add('saved');
            setTimeout(() => input.classList.remove('saved'), 1200);
            Estado.minMaxPending.delete(key);
        } catch (e) {
            console.error('[min-max]', e);
            input.classList.remove('saving');
            input.classList.add('error');
            input.title = e.message;
        }
    }, 800);
    Estado.minMaxPending.set(key, timer);
}

// ============================================================================
// STOCK REAL (modo corrección)
// ============================================================================
function onChangeStockReal(input) {
    const id = parseInt(input.dataset.id, 10);
    const valor = parseFloat(input.value) || 0;
    const original = parseFloat(input.dataset.original);
    if (Estado.itemsModificados[id]) Estado.itemsModificados[id].stock_real = valor;
    input.classList.toggle('modificado', valor !== original);
    const row = input.closest('tr');
    const diff = valor - original;
    const diffCell = row.querySelector('.col-diferencia');
    if (diff > 0) diffCell.innerHTML = `<span class="badge-diff pos">+${diff}</span>`;
    else if (diff < 0) diffCell.innerHTML = `<span class="badge-diff neg">${diff}</span>`;
    else diffCell.innerHTML = '<span class="text-muted">-</span>';
    actualizarEstadisticasCorrec();
}

// ============================================================================
// SELECCIÓN MÚLTIPLE
// ============================================================================
function toggleSeleccion(id, checked) {
    if (checked) Estado.seleccionados.add(id);
    else Estado.seleccionados.delete(id);
    const row = el.tablaBody.querySelector(`tr[data-id="${id}"]`);
    if (row) row.classList.toggle('row-selected', checked);
    actualizarBulkBar();
    actualizarChkTodos();
}

function seleccionarTodosVisibles(checked) {
    const inicio = (Estado.paginaActual - 1) * Estado.itemsPorPagina;
    const visibles = Estado.inventarioFiltrado.slice(inicio, inicio + Estado.itemsPorPagina);
    visibles.forEach(it => {
        if (checked) Estado.seleccionados.add(it.id_producto);
        else Estado.seleccionados.delete(it.id_producto);
    });
    renderizarTabla();
    actualizarBulkBar();
}

function deseleccionarTodos() {
    Estado.seleccionados.clear();
    renderizarTabla();
    actualizarBulkBar();
}

function actualizarBulkBar() {
    const count = Estado.seleccionados.size;
    if (count === 0) { el.bulkBar.classList.remove('visible'); return; }
    el.bulkBar.classList.add('visible');
    el.bulkCount.textContent = count;
    const seleccionados = Estado.inventario.filter(p => Estado.seleccionados.has(p.id_producto));
    const conProv = seleccionados.filter(p => p.id_proveedor_preferido).length;
    el.bulkConProveedor.textContent = conProv;
    el.bulkSinProveedor.textContent = count - conProv;
}

function actualizarChkTodos() {
    const inicio = (Estado.paginaActual - 1) * Estado.itemsPorPagina;
    const visibles = Estado.inventarioFiltrado.slice(inicio, inicio + Estado.itemsPorPagina);
    if (visibles.length === 0) {
        el.chkSeleccionarTodos.checked = false;
        el.chkSeleccionarTodos.indeterminate = false;
        return;
    }
    const sel = visibles.filter(it => Estado.seleccionados.has(it.id_producto)).length;
    el.chkSeleccionarTodos.checked = sel === visibles.length;
    el.chkSeleccionarTodos.indeterminate = sel > 0 && sel < visibles.length;
}

// ============================================================================
// GENERAR OCs
// ============================================================================
let genOcItems = [];
let genOcOrigenLabel = ''; // texto que se muestra en el modal segun el origen

function hayFiltrosActivos() {
    const f = Estado.filtros;
    return !!(f.busqueda || f.marca || f.categoria || f.subcategoria || f.proveedor || f.stock || f.soloBajoMinimo);
}

async function abrirGenerarOCs(origen) {
    if (Estado.depositoSeleccionado === 'todos' || !Estado.depositoSeleccionado) {
        alert('Seleccione un depósito específico para generar OCs');
        return;
    }
    const body = { id_deposito: parseInt(Estado.depositoSeleccionado, 10) };
    if (origen === 'seleccionados') {
        if (Estado.seleccionados.size === 0) { alert('No hay productos seleccionados'); return; }
        body.ids_productos = Array.from(Estado.seleccionados);
        genOcOrigenLabel = `${Estado.seleccionados.size} productos seleccionados`;
    } else if (origen === 'filtrados') {
        if (Estado.inventarioFiltrado.length === 0) { alert('No hay productos en el filtro actual'); return; }
        body.ids_productos = Estado.inventarioFiltrado.map(p => p.id_producto);
        genOcOrigenLabel = `${Estado.inventarioFiltrado.length} productos del filtro actual`;
    } else {
        body.filtros_aplicados = { soloBajoMinimo: true };
        genOcOrigenLabel = 'todos los productos bajo mínimo';
    }

    const tbody = document.getElementById('genOcTablaBody');
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:20px"><div class="lago-spinner"></div> Calculando previa...</td></tr>';
    document.getElementById('genOcSummary').innerHTML = '';
    document.getElementById('btnConfirmarGenerarOCs').disabled = true;
    new bootstrap.Modal(document.getElementById('modalGenerarOCs')).show();

    try {
        const r = await fetch(`${API_INV}/reposicion/calcular`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Error al calcular reposición');
        }
        const data = await r.json();
        genOcItems = (data.productos || []).map(p => ({
            id_producto: p.id_producto,
            sku: p.sku,
            nombre: p.nombre,
            stock_disponible: num(p.stock_disponible),
            stock_minimo: num(p.stock_minimo),
            stock_maximo: num(p.stock_maximo),
            cantidad: num(p.cantidad_sugerida),
            id_proveedor: p.id_proveedor_sugerido,
            proveedor_nombre: p.proveedor_sugerido_razon_social,
            precio_neto: p.precio_neto_sugerido,
            excluido: false
        }));

        const sel = document.getElementById('selProvUnico');
        sel.innerHTML = '<option value="">Seleccione...</option>' +
            Estado.proveedoresCache.map(p => `<option value="${p.id_proveedor}">${escHtml(p.razon_social || p.nombre)}</option>`).join('');

        renderGenOcTabla();
    } catch (e) {
        console.error('[generar-ocs]', e);
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger" style="padding:20px">' + escHtml(e.message) + '</td></tr>';
    }
}

function renderGenOcTabla() {
    const tbody = document.getElementById('genOcTablaBody');
    const incluirSinProv = document.getElementById('genIncluirSinProv').checked;
    const modoUnico = document.querySelector('input[name="genOcModo"]:checked').value === 'unico';
    const idProvUnico = modoUnico ? document.getElementById('selProvUnico').value : null;

    const ordenados = genOcItems.slice().sort((a, b) => {
        if (a.id_proveedor && !b.id_proveedor) return -1;
        if (!a.id_proveedor && b.id_proveedor) return 1;
        return (a.proveedor_nombre || '').localeCompare(b.proveedor_nombre || '');
    });

    if (ordenados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:20px;color:#999">No hay productos para reponer</td></tr>';
        actualizarGenOcSummary();
        return;
    }

    tbody.innerHTML = ordenados.map(it => {
        const idxReal = genOcItems.indexOf(it);
        const sinProv = !it.id_proveedor;
        const excluido = it.excluido || (sinProv && !incluirSinProv && !modoUnico);
        let provNombre, provIdEfectivo;
        if (modoUnico && idProvUnico) {
            const p = Estado.proveedoresCache.find(x => x.id_proveedor == idProvUnico);
            provNombre = p ? escHtml(p.razon_social || p.nombre) : '(modo único)';
            provIdEfectivo = parseInt(idProvUnico, 10);
        } else if (sinProv) {
            provNombre = '<span class="sin-prov">sin proveedor</span>';
            provIdEfectivo = null;
        } else {
            provNombre = escHtml(it.proveedor_nombre);
            provIdEfectivo = it.id_proveedor;
        }
        return `
        <tr data-idx="${idxReal}" class="${excluido ? 'excluido' : ''}">
            <td><code>${escHtml(it.sku)}</code></td>
            <td>${escHtml(it.nombre)}</td>
            <td style="text-align:center">${fmtNum(it.stock_disponible)}</td>
            <td style="text-align:center">${fmtNum(it.stock_minimo)}</td>
            <td style="text-align:center">${fmtNum(it.stock_maximo)}</td>
            <td style="text-align:center"><input type="number" class="gen-cant" data-idx="${idxReal}" value="${it.cantidad}" min="0.01" step="0.01" ${excluido ? 'disabled' : ''}></td>
            <td>${provNombre}</td>
            <td style="text-align:right">${it.precio_neto != null ? '$' + fmtNum(it.precio_neto, 4) : '-'}</td>
            <td style="text-align:center"><button class="btn-quitar" data-idx="${idxReal}" title="Quitar de la lista"><i class="bi bi-x-lg"></i></button></td>
        </tr>`;
    }).join('');

    // Listeners
    tbody.querySelectorAll('.gen-cant').forEach(inp => {
        inp.addEventListener('change', () => {
            const idx = parseInt(inp.dataset.idx, 10);
            const val = parseFloat(inp.value);
            if (!isNaN(val) && val > 0) genOcItems[idx].cantidad = val;
            actualizarGenOcSummary();
        });
    });
    tbody.querySelectorAll('.btn-quitar').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx, 10);
            genOcItems[idx].excluido = true;
            renderGenOcTabla();
        });
    });

    actualizarGenOcSummary();
}

function actualizarGenOcSummary() {
    const incluirSinProv = document.getElementById('genIncluirSinProv').checked;
    const modoUnico = document.querySelector('input[name="genOcModo"]:checked').value === 'unico';
    const idProvUnico = modoUnico ? document.getElementById('selProvUnico').value : null;

    const efectivos = genOcItems.filter(it => {
        if (it.excluido) return false;
        if (!it.id_proveedor && !incluirSinProv && !modoUnico) return false;
        return true;
    });

    const agrup = {};
    efectivos.forEach(it => {
        const pid = modoUnico && idProvUnico ? idProvUnico : (it.id_proveedor || 'SIN');
        const pname = modoUnico && idProvUnico
            ? (Estado.proveedoresCache.find(p => p.id_proveedor == idProvUnico)?.razon_social || '(único)')
            : (it.proveedor_nombre || 'sin proveedor');
        if (!agrup[pid]) agrup[pid] = { nombre: pname, count: 0 };
        agrup[pid].count++;
    });
    const ocsCount = Object.keys(agrup).length;
    const itemsCount = efectivos.length;

    const summary = document.getElementById('genOcSummary');
    const btnConf = document.getElementById('btnConfirmarGenerarOCs');
    const btnConfTxt = document.getElementById('btnConfirmarGenerarOCsTxt');

    // Prefijo con el origen del lote (filtrados / seleccionados / bajo minimo)
    const origenHtml = genOcOrigenLabel ? `<div style="margin-bottom:6px;color:var(--text-muted);font-size:.78rem"><i class="bi bi-funnel"></i> Origen: <strong>${escHtml(genOcOrigenLabel)}</strong></div>` : '';

    if (itemsCount === 0) {
        summary.innerHTML = origenHtml + '<em>No hay productos para generar OCs.</em>';
        btnConf.disabled = true;
        btnConfTxt.textContent = 'Generar OC(s)';
        return;
    }
    if (modoUnico && !idProvUnico) {
        summary.innerHTML = origenHtml + '<em style="color:var(--danger)">Seleccione un proveedor único para continuar.</em>';
        btnConf.disabled = true;
        btnConfTxt.textContent = 'Generar OC(s)';
        return;
    }

    const chips = Object.values(agrup).map(a => `<span class="prov-chip">${escHtml(a.nombre)} (${a.count})</span>`).join('');
    summary.innerHTML = origenHtml + `Se generarán <strong>${ocsCount}</strong> orden(es) con <strong>${itemsCount}</strong> ítems totales.<div class="resumen-prov">${chips}</div>`;
    btnConf.disabled = false;
    btnConfTxt.textContent = `Generar ${ocsCount} OC(s)`;
}

async function confirmarGenerarOCs() {
    const incluirSinProv = document.getElementById('genIncluirSinProv').checked;
    const modoUnico = document.querySelector('input[name="genOcModo"]:checked').value === 'unico';
    const idProvUnico = modoUnico ? parseInt(document.getElementById('selProvUnico').value, 10) : null;

    const items = genOcItems
        .filter(it => !it.excluido)
        .filter(it => it.id_proveedor || incluirSinProv || modoUnico)
        .map(it => ({
            id_producto: it.id_producto,
            cantidad: it.cantidad,
            id_proveedor: modoUnico ? idProvUnico : it.id_proveedor,
            precio_estimado: it.precio_neto
        }))
        .filter(x => x.id_proveedor);

    if (items.length === 0) { alert('No hay items con proveedor para generar OCs'); return; }

    const btn = document.getElementById('btnConfirmarGenerarOCs');
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<span class="lago-spinner" style="border-color:rgba(255,255,255,.3);border-top-color:#fff"></span> Generando...';

    try {
        const body = {
            id_deposito: parseInt(Estado.depositoSeleccionado, 10),
            items,
            separar_por_proveedor: !modoUnico,
            id_proveedor_unico: modoUnico ? idProvUnico : null,
            observaciones: 'Generado desde Inventario'
        };
        const r = await fetch(`${API_INV}/reposicion/generar`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Error al generar OCs');
        }
        const data = await r.json();
        const ocsCreadas = data.ocs_creadas || data;
        alert('✓ ' + (Array.isArray(ocsCreadas) ? ocsCreadas.length : 1) + ' OC(s) generada(s) en estado borrador.\n\n' +
              (Array.isArray(ocsCreadas) ? ocsCreadas.map(o => '  • ' + (o.numero_completo || o.id_orden_compra)).join('\n') : ''));
        bootstrap.Modal.getInstance(document.getElementById('modalGenerarOCs')).hide();
        Estado.seleccionados.clear();
        await cargarInventario();
    } catch (e) {
        console.error('[confirmarGenerarOCs]', e);
        alert('Error al generar OCs: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = old;
    }
}

// ============================================================================
// OCs ACTIVAS POR PRODUCTO
// ============================================================================
async function verOCsActivas(id_producto, nombre, sku) {
    document.getElementById('ocaProductoNombre').textContent = nombre;
    document.getElementById('ocaProductoSKU').textContent = 'SKU: ' + sku;
    document.getElementById('ocaContenido').innerHTML = '<p class="text-center"><span class="lago-spinner"></span> Cargando...</p>';
    new bootstrap.Modal(document.getElementById('modalOCsActivas')).show();
    try {
        const r = await fetch(`${API_OC}/por-producto/${id_producto}`, { headers });
        if (!r.ok) throw new Error('Error al cargar OCs');
        const data = await r.json();
        const ocs = Array.isArray(data) ? data : (data.ocs || data);
        if (!ocs || ocs.length === 0) {
            document.getElementById('ocaContenido').innerHTML = '<p class="text-center text-muted py-3">Sin OCs activas para este producto</p>';
            return;
        }
        document.getElementById('ocaContenido').innerHTML = `
            <table class="oca-tabla">
                <thead><tr><th>Número</th><th>Fecha emisión</th><th>Proveedor</th><th class="text-end">Cant.</th><th class="text-end">Recibida</th><th class="text-end">Pend.</th><th>Estado</th></tr></thead>
                <tbody>${ocs.map(o => `
                    <tr>
                        <td><strong>${escHtml(o.numero_completo || ('#' + o.id_orden_compra))}</strong></td>
                        <td>${o.fecha_emision ? formatearFecha(o.fecha_emision) : '<em style="color:#999">borrador</em>'}</td>
                        <td>${escHtml(o.proveedor || o.proveedor_razon_social || '-')}</td>
                        <td class="text-end">${fmtNum(o.cantidad)}</td>
                        <td class="text-end">${fmtNum(o.cantidad_recibida)}</td>
                        <td class="text-end"><strong>${fmtNum(o.cantidad_pendiente != null ? o.cantidad_pendiente : (num(o.cantidad) - num(o.cantidad_recibida)))}</strong></td>
                        <td><span class="oca-estado-badge ${o.estado}">${escHtml(o.estado)}</span></td>
                    </tr>`).join('')}
                </tbody>
            </table>
            <p class="text-muted small mt-3"><i class="bi bi-info-circle"></i> Las OCs son documentos internos. No afectan stock hasta recibir la factura.</p>
        `;
    } catch (e) {
        console.error('[verOCsActivas]', e);
        document.getElementById('ocaContenido').innerHTML = '<p class="text-center text-danger">' + escHtml(e.message) + '</p>';
    }
}

// ============================================================================
// MODO CORRECCIÓN
// ============================================================================
async function habilitarModoCorrec() {
    if (Estado.inventarioFiltrado.length === 0) { alert('No hay productos para corregir'); return; }
    if (Estado.depositoSeleccionado === 'todos') { alert('Seleccione un depósito específico'); return; }
    if (Estado.inventarioFiltrado.length > 500) {
        if (!confirm(`Hay ${Estado.inventarioFiltrado.length} productos. ¿Continuar?`)) return;
    }
    try {
        const r = await fetch(API_AJ, {
            method: 'POST', headers,
            body: JSON.stringify({ tipo_ajuste: 'INVENTARIO_FISICO', motivo: '', filtros_aplicados: Estado.filtros })
        });
        if (!r.ok) throw new Error('Error al crear ajuste');
        const data = await r.json();
        Estado.ajusteActual = data.ajuste.id_ajuste;
        Estado.modoCorreccion = true;
        Estado.itemsModificados = {};
        Estado.inventarioFiltrado.forEach(item => {
            Estado.itemsModificados[item.id_producto] = { stock_real: num(item.stock_real), stock_sistema: num(item.stock_real) };
        });
        el.panelCorreccion.style.display = 'block';
        el.panelCorreccion.classList.add('activo');
        el.btnHabilitarCorrec.style.display = 'none';
        el.resumenDiferencias.classList.add('visible');
        el.infoAjuste.textContent = `Ajuste ${data.ajuste.numero_completo} • ${Estado.inventarioFiltrado.length} productos`;
        renderizarTabla();
    } catch (e) {
        alert('Error al iniciar corrección: ' + e.message);
    }
}

async function cancelarModoCorrec() {
    if (!confirm('¿Cancelar corrección? Se perderán los cambios no aplicados.')) return;
    if (Estado.ajusteActual) {
        try { await fetch(`${API_AJ}/${Estado.ajusteActual}`, { method: 'DELETE', headers }); } catch (e) {}
    }
    Estado.modoCorreccion = false;
    Estado.ajusteActual = null;
    Estado.itemsModificados = {};
    el.panelCorreccion.style.display = 'none';
    el.panelCorreccion.classList.remove('activo');
    el.btnHabilitarCorrec.style.display = '';
    el.resumenDiferencias.classList.remove('visible');
    renderizarTabla();
}

function llenarConCero() {
    if (!confirm('¿Llenar todos los visibles con stock 0?')) return;
    Object.keys(Estado.itemsModificados).forEach(id => { Estado.itemsModificados[id].stock_real = 0; });
    renderizarTabla();
}

function copiarSistema() {
    Object.keys(Estado.itemsModificados).forEach(id => {
        Estado.itemsModificados[id].stock_real = Estado.itemsModificados[id].stock_sistema;
    });
    renderizarTabla();
}

function actualizarEstadisticasCorrec() {
    let totalItems = Object.keys(Estado.itemsModificados).length;
    let conCambios = 0, entradas = 0, salidas = 0;
    Object.values(Estado.itemsModificados).forEach(item => {
        const diff = item.stock_real - item.stock_sistema;
        if (diff !== 0) {
            conCambios++;
            if (diff > 0) entradas += diff;
            else salidas += Math.abs(diff);
        }
    });
    el.statItems.textContent = totalItems;
    el.statConCambios.textContent = conCambios;
    el.statEntradas.textContent = entradas;
    el.statSalidas.textContent = salidas;
    el.btnAplicarAjuste.disabled = conCambios === 0;
}

async function aplicarAjuste() {
    const motivo = el.inputMotivoAjuste.value.trim();
    if (!motivo) { alert('Ingrese un motivo'); el.inputMotivoAjuste.focus(); return; }
    const items = [];
    Object.entries(Estado.itemsModificados).forEach(([id, it]) => {
        if (it.stock_real !== it.stock_sistema) items.push({ id_producto: parseInt(id, 10), stock_real: it.stock_real });
    });
    if (items.length === 0) { alert('No hay cambios'); return; }
    if (!confirm(`¿Aplicar ajuste de ${items.length} productos?`)) return;
    el.btnAplicarAjuste.disabled = true;
    const txt = el.btnAplicarAjuste.innerHTML;
    el.btnAplicarAjuste.innerHTML = '<span class="lago-spinner" style="border-color:rgba(255,255,255,.3);border-top-color:#fff"></span> Aplicando...';
    try {
        if (Estado.ajusteActual) {
            try { await fetch(`${API_AJ}/${Estado.ajusteActual}`, { method: 'DELETE', headers }); } catch (_) {}
            Estado.ajusteActual = null;
        }
        const r = await fetch(`${API_AJ}/con-items`, {
            method: 'POST', headers,
            body: JSON.stringify({ tipo_ajuste: 'INVENTARIO_FISICO', motivo, filtros_aplicados: Estado.filtros, items })
        });
        if (!r.ok) { const err = await r.json(); throw new Error(err.error || 'Error'); }
        const data = await r.json();
        const rap = await fetch(`${API_AJ}/${data.ajuste.id_ajuste}/aplicar`, { method: 'POST', headers });
        if (!rap.ok) { const err = await rap.json(); throw new Error(err.error || 'Error al aplicar'); }
        const res = await rap.json();
        alert(`✓ ${res.message}\nComprobante: ${res.numero_completo}`);
        Estado.modoCorreccion = false;
        Estado.itemsModificados = {};
        el.panelCorreccion.style.display = 'none';
        el.panelCorreccion.classList.remove('activo');
        el.btnHabilitarCorrec.style.display = '';
        el.resumenDiferencias.classList.remove('visible');
        await cargarInventario();
        mostrarDetalleAjuste(data.ajuste.id_ajuste);
    } catch (e) {
        alert('Error: ' + e.message);
    } finally {
        el.btnAplicarAjuste.disabled = false;
        el.btnAplicarAjuste.innerHTML = txt;
    }
}

// ============================================================================
// AJUSTE INDIVIDUAL
// ============================================================================
let productoAjusteInd = null;

function abrirAjusteIndividual(id, nombre, sku, stock) {
    productoAjusteInd = { id_producto: id, nombre, sku, stock_actual: stock };
    document.getElementById('modalProductoNombre').textContent = nombre;
    document.getElementById('modalProductoSKU').textContent = 'SKU: ' + sku;
    document.getElementById('modalStockActual').value = stock;
    document.getElementById('modalStockNuevo').value = stock;
    document.getElementById('modalMotivo').value = '';
    new bootstrap.Modal(document.getElementById('modalAjusteIndividual')).show();
    setTimeout(() => {
        document.getElementById('modalStockNuevo').focus();
        document.getElementById('modalStockNuevo').select();
    }, 300);
}

async function guardarAjusteIndividual() {
    const stockNuevo = parseInt(document.getElementById('modalStockNuevo').value, 10);
    const motivo = document.getElementById('modalMotivo').value.trim() || 'Ajuste manual';
    if (isNaN(stockNuevo) || stockNuevo < 0) { alert('Valor inválido'); return; }
    if (stockNuevo === productoAjusteInd.stock_actual) { alert('Sin cambios'); return; }
    try {
        const r = await fetch(`${API_AJ}/con-items`, {
            method: 'POST', headers,
            body: JSON.stringify({ tipo_ajuste: 'AJUSTE_MANUAL', motivo, items: [{ id_producto: productoAjusteInd.id_producto, stock_real: stockNuevo }] })
        });
        if (!r.ok) throw new Error('Error al crear');
        const data = await r.json();
        const rap = await fetch(`${API_AJ}/${data.ajuste.id_ajuste}/aplicar`, { method: 'POST', headers });
        if (!rap.ok) throw new Error('Error al aplicar');
        bootstrap.Modal.getInstance(document.getElementById('modalAjusteIndividual')).hide();
        await cargarInventario();
        alert('Stock actualizado');
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ============================================================================
// HISTORIAL AJUSTES
// ============================================================================
async function mostrarHistorialAjustes() {
    new bootstrap.Modal(document.getElementById('modalHistorialAjustes')).show();
    const cont = document.getElementById('listaAjustes');
    cont.innerHTML = '<p class="text-center"><span class="lago-spinner"></span> Cargando...</p>';
    try {
        const r = await fetch(`${API_AJ}?limite=50`, { headers });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (data.ajustes.length === 0) {
            cont.innerHTML = '<p class="text-center text-muted">No hay ajustes</p>';
            return;
        }
        cont.innerHTML = data.ajustes.map(aj => `
            <div class="ajuste-item ${aj.estado}">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${escHtml(aj.numero_completo)}</strong>
                        <span class="badge bg-${aj.estado === 'aplicado' ? 'success' : aj.estado === 'anulado' ? 'danger' : 'warning'} ms-2">${aj.estado}</span>
                    </div>
                    <small class="text-muted">${formatearFecha(aj.fecha_ajuste)}</small>
                </div>
                <div class="mt-1"><small class="text-muted">
                    ${escHtml(aj.tipo_ajuste)} • ${aj.cantidad_items || 0} items
                    ${aj.total_entradas > 0 ? ` • <span class="text-success">+${aj.total_entradas}</span>` : ''}
                    ${aj.total_salidas > 0 ? ` • <span class="text-danger">-${aj.total_salidas}</span>` : ''}
                </small></div>
                ${aj.motivo ? `<div class="mt-1"><small>${escHtml(aj.motivo)}</small></div>` : ''}
                <div class="mt-2">
                    <button class="btn btn-sm btn-outline-primary btn-ver-detalle-aj" data-id="${aj.id_ajuste}"><i class="bi bi-eye"></i> Ver detalle</button>
                </div>
            </div>`).join('');
    } catch (e) {
        cont.innerHTML = '<p class="text-center text-danger">Error al cargar</p>';
    }
}

async function mostrarDetalleAjuste(id_ajuste) {
    new bootstrap.Modal(document.getElementById('modalDetalleAjuste')).show();
    const cont = document.getElementById('contenidoDetalleAjuste');
    cont.innerHTML = '<p class="text-center"><span class="lago-spinner"></span> Cargando...</p>';
    try {
        const r = await fetch(`${API_AJ}/${id_ajuste}`, { headers });
        if (!r.ok) throw new Error();
        const aj = await r.json();
        document.getElementById('tituloDetalleAjuste').textContent = aj.numero_completo;
        const btnAnular = document.getElementById('btnAnularAjuste');
        btnAnular.style.display = aj.estado === 'aplicado' ? '' : 'none';
        btnAnular.onclick = () => anularAjuste(aj.id_ajuste, aj.numero_completo);
        cont.innerHTML = `
            <div class="row mb-3">
                <div class="col-md-6">
                    <p><strong>Comprobante:</strong> ${escHtml(aj.numero_completo)}</p>
                    <p><strong>Tipo:</strong> ${escHtml(aj.tipo_ajuste)}</p>
                    <p><strong>Estado:</strong> <span class="badge bg-${aj.estado === 'aplicado' ? 'success' : aj.estado === 'anulado' ? 'danger' : 'warning'}">${aj.estado}</span></p>
                </div>
                <div class="col-md-6">
                    <p><strong>Fecha:</strong> ${formatearFecha(aj.fecha_ajuste)}</p>
                    <p><strong>Usuario:</strong> ${escHtml(aj.usuario_nombre || '-')}</p>
                    <p><strong>Motivo:</strong> ${escHtml(aj.motivo || '-')}</p>
                </div>
            </div>
            ${aj.estado === 'aplicado' ? `
            <div class="row mb-3">
                <div class="col-md-4 text-center"><div class="p-2 bg-light rounded"><div class="h4 mb-0">${aj.total_items || aj.items?.length || 0}</div><small>Productos</small></div></div>
                <div class="col-md-4 text-center"><div class="p-2 bg-success bg-opacity-10 rounded"><div class="h4 mb-0 text-success">+${aj.total_entradas || 0}</div><small>Entradas</small></div></div>
                <div class="col-md-4 text-center"><div class="p-2 bg-danger bg-opacity-10 rounded"><div class="h4 mb-0 text-danger">-${aj.total_salidas || 0}</div><small>Salidas</small></div></div>
            </div>` : ''}
            <h6>Detalle de productos</h6>
            <div class="table-responsive"><table class="table table-sm table-striped">
                <thead class="table-dark"><tr><th>SKU</th><th>Producto</th><th class="text-center">Sistema</th><th class="text-center">Real</th><th class="text-center">Diferencia</th></tr></thead>
                <tbody>
                    ${aj.items?.map(i => `
                        <tr class="${i.diferencia > 0 ? 'table-success' : i.diferencia < 0 ? 'table-danger' : ''}">
                            <td><code>${escHtml(i.sku)}</code></td>
                            <td>${escHtml(i.producto_nombre)}</td>
                            <td class="text-center">${fmtNum(i.stock_sistema)}</td>
                            <td class="text-center">${fmtNum(i.stock_real)}</td>
                            <td class="text-center">${i.diferencia > 0 ? `<span class="text-success">+${i.diferencia}</span>` : i.diferencia < 0 ? `<span class="text-danger">${i.diferencia}</span>` : '-'}</td>
                        </tr>`).join('') || '<tr><td colspan="5" class="text-center">Sin items</td></tr>'}
                </tbody>
            </table></div>
            ${aj.estado === 'anulado' ? `
            <div class="alert alert-danger mt-3">
                <strong>Ajuste anulado</strong><br>
                Motivo: ${escHtml(aj.motivo_anulacion || 'No especificado')}<br>
                Por: ${escHtml(aj.usuario_anulacion_nombre || '-')} el ${formatearFecha(aj.fecha_anulacion)}
            </div>` : ''}
        `;
    } catch (e) {
        cont.innerHTML = '<p class="text-center text-danger">Error al cargar</p>';
    }
}

async function anularAjuste(id_ajuste, numero) {
    const motivo = prompt(`¿Por qué anular el ajuste ${numero}?`);
    if (!motivo) return;
    try {
        const r = await fetch(`${API_AJ}/${id_ajuste}/anular`, { method: 'POST', headers, body: JSON.stringify({ motivo }) });
        if (!r.ok) { const err = await r.json(); throw new Error(err.error || 'Error'); }
        alert('Ajuste anulado');
        bootstrap.Modal.getInstance(document.getElementById('modalDetalleAjuste')).hide();
        await cargarInventario();
    } catch (e) { alert('Error: ' + e.message); }
}

// ============================================================================
// STOCK POR DEPÓSITO
// ============================================================================
async function mostrarStockDepositos(id, nombre, sku) {
    document.getElementById('mdProductoNombre').textContent = nombre;
    document.getElementById('mdProductoSKU').textContent = 'SKU: ' + sku;
    document.getElementById('mdContenido').innerHTML = '<p class="text-center"><span class="lago-spinner"></span> Cargando...</p>';
    new bootstrap.Modal(document.getElementById('modalStockDepositos')).show();
    try {
        const r = await fetch(`${API_INV}/${id}/depositos`, { headers });
        if (!r.ok) throw new Error();
        const data = await r.json();
        let html = '<table class="table table-sm table-striped"><thead class="table-dark"><tr><th>Depósito</th><th class="text-center">Stock</th></tr></thead><tbody>';
        data.depositos.forEach(d => {
            const cls = d.stock_real > 0 ? 'table-success' : '';
            html += `<tr class="${cls}"><td>${d.es_principal ? '🏠 ' : '📍 '}${escHtml(d.deposito_nombre)}</td><td class="text-center"><strong>${fmtNum(d.stock_real)}</strong></td></tr>`;
        });
        html += `</tbody><tfoot><tr class="table-primary"><td><strong>TOTAL</strong></td><td class="text-center"><strong>${fmtNum(data.stock_total)}</strong></td></tr></tfoot></table>`;
        document.getElementById('mdContenido').innerHTML = html;
    } catch (e) {
        document.getElementById('mdContenido').innerHTML = '<p class="text-danger">Error al cargar</p>';
    }
}

// ============================================================================
// TRANSFERENCIA
// ============================================================================
let trfItems = [];

function abrirTransferencia() {
    if (Estado.depositos.length < 2) { alert('Se necesitan al menos 2 depósitos'); return; }
    trfItems = [];
    const opts = Estado.depositos.map(d => `<option value="${d.id_deposito}">${escHtml(d.nombre)}</option>`).join('');
    document.getElementById('trfOrigen').innerHTML = opts;
    document.getElementById('trfDestino').innerHTML = opts;
    document.getElementById('trfOrigen').value = Estado.depositos[0].id_deposito;
    document.getElementById('trfDestino').value = Estado.depositos[1].id_deposito;
    document.getElementById('trfMotivo').value = '';
    document.getElementById('trfBuscador').value = '';
    document.getElementById('trfResultadosBusqueda').style.display = 'none';
    renderTrfItems();
    new bootstrap.Modal(document.getElementById('modalTransferencia')).show();
}

function buscarProductoTrf() {
    const term = document.getElementById('trfBuscador').value.trim().toLowerCase();
    const cont = document.getElementById('trfResultadosBusqueda');
    if (term.length < 2) { cont.style.display = 'none'; return; }
    const res = Estado.inventario.filter(p => {
        const txt = (p.sku + ' ' + p.nombre).toLowerCase();
        return term.split(' ').every(t => txt.includes(t));
    }).slice(0, 10);
    if (res.length === 0) {
        cont.innerHTML = '<div class="list-group-item text-muted">Sin resultados</div>';
        cont.style.display = ''; return;
    }
    cont.innerHTML = res.map(p => `
        <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between" data-id="${p.id_producto}" data-sku="${escAttr(p.sku)}" data-nombre="${escAttr(p.nombre)}" data-stock="${num(p.stock_real)}">
            <span><code>${escHtml(p.sku)}</code> ${escHtml(p.nombre)}</span>
            <span class="badge bg-secondary">Stock: ${fmtNum(p.stock_real)}</span>
        </button>`).join('');
    cont.style.display = '';
    cont.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id, 10);
            if (trfItems.find(i => i.id_producto === id)) { alert('Ya agregado'); return; }
            trfItems.push({ id_producto: id, sku: btn.dataset.sku, nombre: btn.dataset.nombre, stock_origen: parseFloat(btn.dataset.stock), cantidad: 1 });
            renderTrfItems();
            document.getElementById('trfBuscador').value = '';
            cont.style.display = 'none';
        });
    });
}

function renderTrfItems() {
    const body = document.getElementById('trfItemsBody');
    const btn = document.getElementById('btnEjecutarTransferencia');
    if (trfItems.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Agregue productos</td></tr>';
        btn.disabled = true;
        return;
    }
    body.innerHTML = trfItems.map((it, idx) => `
        <tr>
            <td><code>${escHtml(it.sku)}</code></td>
            <td>${escHtml(it.nombre)}</td>
            <td class="text-center">${fmtNum(it.stock_origen)}</td>
            <td class="text-center"><input type="number" class="form-control form-control-sm text-center trf-cantidad" value="${it.cantidad}" min="1" max="${it.stock_origen}" data-idx="${idx}" style="width:80px;margin:0 auto"></td>
            <td><button class="btn btn-sm btn-outline-danger trf-quitar" data-idx="${idx}"><i class="bi bi-trash"></i></button></td>
        </tr>`).join('');
    btn.disabled = false;
    body.querySelectorAll('.trf-cantidad').forEach(inp => {
        inp.addEventListener('change', () => { trfItems[parseInt(inp.dataset.idx, 10)].cantidad = parseFloat(inp.value) || 1; });
    });
    body.querySelectorAll('.trf-quitar').forEach(b => {
        b.addEventListener('click', () => { trfItems.splice(parseInt(b.dataset.idx, 10), 1); renderTrfItems(); });
    });
}

async function ejecutarTransferencia() {
    const origen = parseInt(document.getElementById('trfOrigen').value, 10);
    const destino = parseInt(document.getElementById('trfDestino').value, 10);
    if (origen === destino) { alert('Origen y destino deben ser distintos'); return; }
    if (trfItems.length === 0) { alert('Agregue al menos un producto'); return; }
    if (trfItems.some(i => i.cantidad > i.stock_origen)) { alert('Hay cantidades > stock origen'); return; }
    if (!confirm(`¿Ejecutar transferencia de ${trfItems.length} producto(s)?`)) return;
    const btn = document.getElementById('btnEjecutarTransferencia');
    btn.disabled = true;
    btn.innerHTML = '<span class="lago-spinner"></span> Transfiriendo...';
    try {
        const r = await fetch(`${API_INV}/transferir`, {
            method: 'POST', headers,
            body: JSON.stringify({
                id_deposito_origen: origen,
                id_deposito_destino: destino,
                items: trfItems.map(i => ({ id_producto: i.id_producto, cantidad: i.cantidad })),
                motivo: document.getElementById('trfMotivo').value.trim()
            })
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Error');
        alert('Transferencia exitosa: ' + data.message);
        bootstrap.Modal.getInstance(document.getElementById('modalTransferencia')).hide();
        await cargarDepositos();
        await cargarInventario();
    } catch (e) { alert('Error: ' + e.message); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-arrow-left-right"></i> Ejecutar Transferencia';
    }
}

// ============================================================================
// MOVIMIENTOS (delega a HistorialProducto)
// ============================================================================
async function abrirMovimientos(id, nombre, sku) {
    if (window.HistorialProducto && typeof window.HistorialProducto.abrir === 'function') {
        await window.HistorialProducto.abrir(id, sku, nombre);
    } else {
        alert('Modal historial no disponible. Recargue la página.');
    }
}

// ============================================================================
// EXPORTAR EXCEL (xlsx con SheetJS, respeta filtros)
// ============================================================================
function exportarExcel() {
    if (!window.XLSX) { alert('La librería de Excel aún no cargó. Esperá unos segundos y reintentá.'); return; }
    const data = Estado.inventarioFiltrado;
    if (data.length === 0) { alert('No hay productos para exportar'); return; }

    const dep = Estado.depositos.find(d => d.id_deposito == Estado.depositoSeleccionado);
    const depNombre = Estado.depositoSeleccionado === 'todos' ? 'Todos los depósitos' : (dep ? dep.nombre : '');

    // Construir filas (encabezado + data)
    const rows = data.map(it => ({
        'SKU':                    it.sku || '',
        'Producto':               it.nombre || '',
        'Marca':                  it.marca_nombre || '',
        'Mínimo':                 num(it.stock_minimo),
        'Máximo':                 num(it.stock_maximo),
        'Sistema':                num(it.stock_real),
        'Comprometido':           num(it.stock_comprometido),
        'Disponible':             num(it.stock_disponible),
        'OCs activas':            num(it.ocs_activas_count),
        'Proveedor preferido':    it.proveedor_preferido_nombre || '',
        'Depósito':               depNombre
    }));

    // Generar workbook
    const ws = XLSX.utils.json_to_sheet(rows);
    // Ajustar anchos
    ws['!cols'] = [
        { wch: 14 }, { wch: 50 }, { wch: 18 },
        { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 6 },
        { wch: 28 }, { wch: 22 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');

    const fecha = new Date().toISOString().slice(0, 10);
    const filtroTag = hayFiltrosActivos() ? '_filtrado' : '';
    const filename = `inventario_${fecha}${filtroTag}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// ============================================================================
// IMPRIMIR LISTADO — patrón ERP (server-side Handlebars + window.print auto)
// ============================================================================
function imprimirListado() {
    if (Estado.inventarioFiltrado.length === 0) { alert('No hay productos para imprimir'); return; }

    // Construir query string respetando los filtros aplicados.
    // Si hay selección o filtros, mandamos ids_productos (lo más preciso).
    // Si no, mandamos los filtros como están y el server reproduce el mismo subset.
    const params = new URLSearchParams();
    if (Estado.depositoSeleccionado && Estado.depositoSeleccionado !== 'todos') {
        params.set('id_deposito', Estado.depositoSeleccionado);
    } else if (Estado.depositoSeleccionado === 'todos') {
        params.set('id_deposito', 'todos');
    }

    // Si hay productos seleccionados explícitos, mandar solo esos ids
    if (Estado.seleccionados.size > 0) {
        params.set('ids_productos', Array.from(Estado.seleccionados).join(','));
    } else {
        // Sino, mandar filtros + ids del subset visible (asegura mismo resultado)
        const f = Estado.filtros;
        if (f.busqueda)        params.set('busqueda', f.busqueda);
        if (f.marca)           params.set('id_marca', f.marca);
        if (f.categoria)       params.set('id_categoria', f.categoria);
        if (f.subcategoria)    params.set('id_subcategoria', f.subcategoria);
        if (f.proveedor)       params.set('id_proveedor', f.proveedor);
        if (f.stock)           params.set('stock', f.stock);
        if (f.soloBajoMinimo)  params.set('soloBajoMinimo', '1');

        // Labels para que aparezcan lindos en el header del print
        if (f.marca) {
            const sel = el.filtroMarca.options[el.filtroMarca.selectedIndex];
            if (sel) params.set('marca_nombre', sel.textContent);
        }
        if (f.categoria) {
            const sel = el.filtroCategoria.options[el.filtroCategoria.selectedIndex];
            if (sel) params.set('categoria_nombre', sel.textContent);
        }
        if (f.proveedor) {
            const sel = el.filtroProveedor.options[el.filtroProveedor.selectedIndex];
            if (sel) params.set('proveedor_nombre', sel.textContent);
        }
    }

    const url = `${API_INV}/listado/html?` + params.toString();
    const w = window.open(url, '_blank');
    if (!w) {
        alert('El navegador bloqueó la ventana de impresión. Habilitá popups para este sitio.');
        return;
    }
}

// ============================================================================
// EVENTOS
// ============================================================================
function configurarEventos() {
    // Filtros
    el.buscador.addEventListener('input', debounce(() => { Estado.filtros.busqueda = el.buscador.value; aplicarFiltros(); }, 300));
    el.filtroMarca.addEventListener('change', () => { Estado.filtros.marca = el.filtroMarca.value; aplicarFiltros(); });
    el.filtroCategoria.addEventListener('change', () => { Estado.filtros.categoria = el.filtroCategoria.value; aplicarFiltros(); });
    el.filtroSubcategoria.addEventListener('change', () => { Estado.filtros.subcategoria = el.filtroSubcategoria.value; aplicarFiltros(); });
    el.filtroProveedor.addEventListener('change', () => { Estado.filtros.proveedor = el.filtroProveedor.value; aplicarFiltros(); });
    el.filtroStock.addEventListener('change', () => { Estado.filtros.stock = el.filtroStock.value; aplicarFiltros(); });
    el.chkSoloBajoMin.addEventListener('change', () => {
        Estado.filtros.soloBajoMinimo = el.chkSoloBajoMin.checked;
        el.toggleSoloBajoMin.classList.toggle('active', el.chkSoloBajoMin.checked);
        aplicarFiltros();
    });
    el.filtroDeposito.addEventListener('change', () => {
        Estado.depositoSeleccionado = el.filtroDeposito.value;
        const esTodos = Estado.depositoSeleccionado === 'todos';
        el.btnHabilitarCorrec.disabled = esTodos;
        el.btnHabilitarCorrec.title = esTodos ? 'Seleccione un depósito específico' : '';
        Estado.seleccionados.clear();
        cargarInventario();
    });
    el.btnLimpiarFiltros.addEventListener('click', limpiarFiltros);

    // Paginación
    el.paginacion.addEventListener('click', e => {
        const btn = e.target.closest('.pag-btn');
        if (btn && !btn.disabled) cambiarPagina(parseInt(btn.dataset.pag, 10));
    });
    el.selPorPagina.addEventListener('change', () => {
        Estado.itemsPorPagina = parseInt(el.selPorPagina.value, 10);
        Estado.paginaActual = 1;
        renderizarTabla();
        renderizarPaginacion();
    });

    // Selección
    el.chkSeleccionarTodos.addEventListener('change', () => seleccionarTodosVisibles(el.chkSeleccionarTodos.checked));
    el.btnDeseleccionar.addEventListener('click', deseleccionarTodos);
    el.btnGenerarOCsBulk.addEventListener('click', () => abrirGenerarOCs('seleccionados'));

    // Navbar
    el.navBtnGenerarOC.addEventListener('click', () => {
        // 1. Si hay productos seleccionados con checkbox → solo esos
        if (Estado.seleccionados.size > 0) {
            abrirGenerarOCs('seleccionados');
            return;
        }
        // 2. Si hay filtros activos (busqueda, marca, etc) → solo lo visible
        if (hayFiltrosActivos()) {
            const count = Estado.inventarioFiltrado.length;
            if (count === 0) { alert('No hay productos en el filtro actual'); return; }
            if (count > 200) {
                if (!confirm(`Generar OCs para ${count} productos del filtro actual?`)) return;
            }
            abrirGenerarOCs('filtrados');
            return;
        }
        // 3. Sin selección ni filtros → todos los bajo mínimo (puede ser MUCHO)
        if (!confirm('Sin filtros ni selección.\n\n¿Generar OCs para TODOS los productos bajo mínimo? (puede ser >8000)')) return;
        abrirGenerarOCs('bajo_minimo');
    });
    el.navBtnTransferir.addEventListener('click', abrirTransferencia);
    el.navBtnImportarExcel.addEventListener('click', () => {
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalImportExcel'));
        modal.show();
        if (window.InventarioImport && window.InventarioImport.onModalOpen) window.InventarioImport.onModalOpen();
    });
    el.navBtnExportarExcel.addEventListener('click', exportarExcel);
    el.navBtnImprimir.addEventListener('click', imprimirListado);
    el.navBtnHistorial.addEventListener('click', mostrarHistorialAjustes);

    // Corrección
    el.btnHabilitarCorrec.addEventListener('click', habilitarModoCorrec);
    el.btnCancelarCorrec.addEventListener('click', cancelarModoCorrec);
    el.btnLlenarCero.addEventListener('click', llenarConCero);
    el.btnCopiarSistema.addEventListener('click', copiarSistema);
    el.btnAplicarAjuste.addEventListener('click', aplicarAjuste);

    // Ajuste individual
    document.getElementById('btnGuardarAjusteIndividual').addEventListener('click', guardarAjusteIndividual);
    document.getElementById('btnImprimirAjuste').addEventListener('click', () => window.print());

    // Bloquear scroll-wheel changes en inputs numericos (bug nativo del browser
    // que cambia el valor al scrollear sobre un input numerico enfocado)
    el.tablaBody.addEventListener('wheel', e => {
        const inp = e.target;
        if (inp instanceof HTMLInputElement && inp.type === 'number' && document.activeElement === inp) {
            inp.blur(); // sacar foco; deja que el scroll de la pagina funcione normal
        }
    }, { passive: true });

    // Tabla: click delegation
    el.tablaBody.addEventListener('click', e => {
        const chk = e.target.closest('.row-checkbox');
        if (chk && chk !== el.chkSeleccionarTodos) {
            toggleSeleccion(parseInt(chk.dataset.id, 10), chk.checked);
            return;
        }
        const ocBadge = e.target.closest('[data-action="ver-ocs"]');
        if (ocBadge) {
            verOCsActivas(parseInt(ocBadge.dataset.id, 10), ocBadge.dataset.nombre, ocBadge.dataset.sku);
            return;
        }
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);
        const nombre = btn.dataset.nombre, sku = btn.dataset.sku;
        if (action === 'ver-historial')      abrirMovimientos(id, nombre, sku);
        else if (action === 'ver-depositos') mostrarStockDepositos(id, nombre, sku);
        else if (action === 'ajuste-individual') abrirAjusteIndividual(id, nombre, sku, parseFloat(btn.dataset.stock));
    });

    // Tabla: input delegation
    el.tablaBody.addEventListener('input', e => {
        if (e.target.classList.contains('min-max-input')) onChangeMinMax(e.target);
        else if (e.target.classList.contains('stock-real-input')) onChangeStockReal(e.target);
    });

    // ────────────────────────────────────────────────────────────────────
    // Navegación tipo grilla en TODOS los inputs editables de la tabla.
    // Flechas ↑↓←→ navegan entre celdas. NO cambian el valor.
    // Enter/Tab también navegan (Enter baja, Shift+Enter sube,
    // Tab derecha, Shift+Tab izquierda).
    // ────────────────────────────────────────────────────────────────────
    el.tablaBody.addEventListener('keydown', e => {
        const inp = e.target;
        if (!(inp instanceof HTMLInputElement)) return;
        if (inp.type !== 'number') return;
        if (!inp.classList.contains('min-max-input') && !inp.classList.contains('stock-real-input')) return;

        const key = e.key;
        // Solo reaccionamos a las teclas de navegación
        if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Tab'].includes(key)) return;

        // Para flechas ↑↓ Chrome cambia el valor de un <input type=number>.
        // Las cancelamos siempre. Enter/Tab los cancelamos cuando hagamos navegación.
        if (key === 'ArrowUp' || key === 'ArrowDown') e.preventDefault();

        // Construir matriz de inputs editables en orden visual:
        //   por cada fila, primero min-max-input (min, max) y luego stock-real-input
        const rows = Array.from(el.tablaBody.querySelectorAll('tr[data-id]'));
        const grid = rows.map(tr => Array.from(tr.querySelectorAll('input.min-max-input, input.stock-real-input')));

        // Localizar celda actual
        let r = -1, c = -1;
        for (let i = 0; i < grid.length; i++) {
            const j = grid[i].indexOf(inp);
            if (j !== -1) { r = i; c = j; break; }
        }
        if (r === -1) return;

        const shift = e.shiftKey;
        let nr = r, nc = c;
        if (key === 'ArrowUp')                     nr = r - 1;
        else if (key === 'ArrowDown' || key === 'Enter') nr = r + (shift && key === 'Enter' ? -1 : 1);
        else if (key === 'ArrowLeft')              nc = c - 1;
        else if (key === 'ArrowRight')             nc = c + 1;
        else if (key === 'Tab')                    nc = c + (shift ? -1 : 1);

        // Wrap horizontal: si pasa el limite, va a la fila vecina
        if (nc < 0)                       { nr--; nc = grid[nr]?.length - 1 ?? 0; }
        else if (nc >= (grid[r]?.length || 0)) { nr++; nc = 0; }
        if (nr < 0 || nr >= grid.length)  return; // fuera de la grilla
        if (!grid[nr] || !grid[nr][nc])   return;

        e.preventDefault();
        const dest = grid[nr][nc];
        dest.focus();
        if (typeof dest.select === 'function') dest.select();
    });

    // Historial: ver detalle
    document.getElementById('listaAjustes').addEventListener('click', e => {
        const btn = e.target.closest('.btn-ver-detalle-aj');
        if (btn) mostrarDetalleAjuste(parseInt(btn.dataset.id, 10));
    });

    // Transferencia
    document.getElementById('btnEjecutarTransferencia').addEventListener('click', ejecutarTransferencia);
    document.getElementById('trfBuscador').addEventListener('input', debounce(buscarProductoTrf, 300));

    // Modal Generar OCs
    document.getElementById('modoSeparar').addEventListener('change', () => {
        document.getElementById('selProvUnico').disabled = true;
        renderGenOcTabla();
    });
    document.getElementById('modoUnico').addEventListener('change', () => {
        document.getElementById('selProvUnico').disabled = false;
        renderGenOcTabla();
    });
    document.getElementById('selProvUnico').addEventListener('change', renderGenOcTabla);
    document.getElementById('genIncluirSinProv').addEventListener('change', renderGenOcTabla);
    document.getElementById('btnConfirmarGenerarOCs').addEventListener('click', confirmarGenerarOCs);
}

// ============================================================================
// API PÚBLICA (para módulos externos)
// ============================================================================
window.recargarInventario = cargarInventario;
window.mostrarDetalleAjuste = mostrarDetalleAjuste;
window.cambiarPagina = cambiarPagina;

// ============================================================================
// INICIAR
// ============================================================================
init();

}); // DOMContentLoaded
})(); // IIFE
