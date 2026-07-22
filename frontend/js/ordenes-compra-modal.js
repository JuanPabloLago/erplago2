/**
 * ordenes-compra-modal.js — ERP LAGO
 * Modal de CONSULTA de Ordenes de Compra embebido en inventario.html.
 * Solo lectura + reimpresion (PDF) + export Excel (lista y por OC). NO crea ni modifica OCs.
 * Toda la logica vive aca; el HTML solo delega eventos a window.OCConsulta.
 * Reusa endpoints existentes: GET /, /form-data, /:id, /:id/html, /export/excel.
 */
(function () {
'use strict';

var token  = localStorage.getItem('authToken');
var BASE   = (window.CONFIG && window.CONFIG.API_BASE_URL) ? window.CONFIG.API_BASE_URL : '/api';
var API_OC = BASE + '/ordenes-compra';
var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

var PAGE_SIZE = 20;
var st = { q: '', estadoF: '', proveedorF: '', offset: 0, limit: PAGE_SIZE, total: 0, estados: [], proveedores: [], fdCargado: false };
var modalInstance = null;

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }
function fmtMon(n){ return (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtFecha(f){ if (!f) return '—'; var d = new Date(f); if (isNaN(d.getTime())) return '—'; return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }
function debounce(fn, ms){ var t; return function(){ var a = arguments, c = this; clearTimeout(t); t = setTimeout(function(){ fn.apply(c, a); }, ms); }; }

async function cargarFormData(){
    if (st.fdCargado) return;
    try {
        var r = await fetch(API_OC + '/form-data', { headers: headers });
        if (!r.ok) return;
        var d = await r.json();
        st.estados = d.estados || [];
        st.proveedores = d.proveedores || [];
        var selE = $('ocqEstado');
        if (selE) selE.innerHTML = '<option value="">Todos los estados</option>' + st.estados.map(function(e){ return '<option value="' + esc(e) + '">' + esc(e) + '</option>'; }).join('');
        var selP = $('ocqProveedor');
        if (selP) selP.innerHTML = '<option value="">Todos los proveedores</option>' + st.proveedores.map(function(p){ return '<option value="' + p.id_proveedor + '">' + esc(p.razon_social) + '</option>'; }).join('');
        st.fdCargado = true;
    } catch (e) { console.error('OCConsulta.formData:', e); }
}

function queryParams(extra){
    var p = new URLSearchParams();
    if (st.q) p.set('q', st.q);
    if (st.estadoF) p.set('estado', st.estadoF);
    if (st.proveedorF) p.set('id_proveedor', st.proveedorF);
    if (extra) { for (var k in extra) p.set(k, extra[k]); }
    return p;
}

function provNombre(id){ var pv = st.proveedores.filter(function(p){ return String(p.id_proveedor) === String(id); })[0]; return pv ? pv.razon_social : id; }

function filtrosTexto(){
    var parts = [];
    if (st.q) parts.push('Búsqueda="' + st.q + '"');
    if (st.estadoF) parts.push('Estado=' + st.estadoF);
    if (st.proveedorF) parts.push('Proveedor=' + provNombre(st.proveedorF));
    return parts.join(' · ');
}

function renderChips(){
    var c = $('ocqChips'); if (!c) return;
    function chip(txt, key){ return '<span class="ocq-chip">' + esc(txt) + ' <i class="bi bi-x" style="cursor:pointer" onclick="window.OCConsulta.quitarFiltro(\'' + key + '\')"></i></span>'; }
    var chips = [];
    if (st.q) chips.push(chip('Búsqueda: ' + st.q, 'q'));
    if (st.estadoF) chips.push(chip('Estado: ' + st.estadoF, 'estado'));
    if (st.proveedorF) chips.push(chip('Proveedor: ' + provNombre(st.proveedorF), 'proveedor'));
    c.innerHTML = chips.join('');
}

function renderTabla(ordenes){
    var body = $('ocqTbody'); if (!body) return;
    if (!ordenes.length){
        var ft = filtrosTexto();
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">Sin resultados' + (ft ? ' con estos filtros: ' + esc(ft) : '') + '.</td></tr>';
        return;
    }
    body.innerHTML = ordenes.map(function(o){
        var prov = o.proveedor_razon_social ? esc(o.proveedor_razon_social) : '<span style="color:var(--text-muted);font-style:italic">Genérica</span>';
        return '<tr>' +
            '<td><strong>' + esc(o.numero_completo) + '</strong></td>' +
            '<td><span class="oca-estado-badge ' + esc(o.estado) + '">' + esc(o.estado) + '</span></td>' +
            '<td>' + fmtFecha(o.fecha_creacion) + '</td>' +
            '<td>' + prov + '</td>' +
            '<td style="text-align:center">' + (o.items_count != null ? o.items_count : '') + '</td>' +
            '<td style="text-align:right;font-variant-numeric:tabular-nums">$ ' + fmtMon(o.total_estimado) + '</td>' +
            '<td style="text-align:center;white-space:nowrap">' +
              '<button class="btn-row" title="Ver / Imprimir PDF" onclick="window.OCConsulta.pdf(' + o.id_orden_compra + ')"><i class="bi bi-file-earmark-pdf"></i></button> ' +
              '<button class="btn-row" title="Exportar esta OC a Excel" onclick="window.OCConsulta.excelOC(' + o.id_orden_compra + ')"><i class="bi bi-file-earmark-excel"></i></button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function renderPaginacion(){
    var c = $('ocqPaginacion'); if (!c) return;
    var desde = st.total === 0 ? 0 : st.offset + 1;
    var hasta = Math.min(st.offset + st.limit, st.total);
    c.innerHTML =
        '<span style="color:var(--text-muted);font-size:.8rem">' + desde + '–' + hasta + ' de ' + st.total + '</span>' +
        '<button class="pag-btn" ' + (st.offset > 0 ? '' : 'disabled') + ' onclick="window.OCConsulta.prev()"><i class="bi bi-chevron-left"></i></button>' +
        '<button class="pag-btn" ' + (hasta < st.total ? '' : 'disabled') + ' onclick="window.OCConsulta.next()"><i class="bi bi-chevron-right"></i></button>';
}

async function cargar(){
    var body = $('ocqTbody'); if (!body) return;
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#999"><span class="lago-spinner"></span> Cargando órdenes...</td></tr>';
    try {
        var r = await fetch(API_OC + '/?' + queryParams({ limit: st.limit, offset: st.offset }).toString(), { headers: headers });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json();
        st.total = d.total || 0;
        renderTabla(d.ordenes || []);
        renderChips();
        renderPaginacion();
    } catch (e) {
        console.error('OCConsulta.cargar:', e);
        body.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--danger)">Error al cargar: ' + esc(e.message) + '</td></tr>';
    }
}

async function exportarOCaExcel(id){
    if (typeof XLSX === 'undefined') { alert('No se pudo generar el Excel: falta la librería XLSX en la página.'); return; }
    try {
        var r = await fetch(API_OC + '/' + id, { headers: headers });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var oc = await r.json();
        var items = oc.items || [];
        var aoa = [
            ['ORDEN DE COMPRA', oc.numero_completo || ''],
            ['Estado', oc.estado || ''],
            ['Proveedor', oc.proveedor_razon_social || 'Genérica'],
            ['CUIT proveedor', oc.proveedor_cuit || ''],
            ['Depósito destino', oc.deposito_nombre || ''],
            ['Fecha', fmtFecha(oc.fecha_creacion)],
            [],
            ['#', 'SKU', 'Cód. Proveedor', 'Producto', 'Cantidad', 'Precio est.', 'Subtotal est.']
        ];
        items.forEach(function(it, i){
            aoa.push([ i + 1, it.sku || '', it.codigo_proveedor || '', it.nombre || '', Number(it.cantidad) || 0, Number(it.precio_estimado) || 0, Number(it.subtotal_estimado) || 0 ]);
        });
        aoa.push([]);
        aoa.push(['', '', '', '', '', 'Total est.', Number(oc.total_estimado) || 0]);
        if (oc.observaciones) { aoa.push([]); aoa.push(['Observaciones', oc.observaciones]); }

        var ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 6 }, { wch: 16 }, { wch: 16 }, { wch: 48 }, { wch: 12 }, { wch: 14 }, { wch: 16 }];
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'OC');
        XLSX.writeFile(wb, (oc.numero_completo || 'orden_compra') + '.xlsx');
    } catch (e) {
        console.error('OCConsulta.excelOC:', e);
        alert('No se pudo exportar la OC: ' + e.message);
    }
}

window.OCConsulta = {
    abrir: async function(){
        var modalEl = document.getElementById('modalConsultaOCs');
        if (!modalEl){ console.error('modalConsultaOCs no existe en el DOM'); return; }
        if (!modalInstance) modalInstance = new bootstrap.Modal(modalEl);
        await cargarFormData();
        st.offset = 0;
        modalInstance.show();
        cargar();
    },
    buscar: debounce(function(val){ st.q = (val || '').trim(); st.offset = 0; cargar(); }, 350),
    setEstado: function(val){ st.estadoF = val || ''; st.offset = 0; cargar(); },
    setProveedor: function(val){ st.proveedorF = val || ''; st.offset = 0; cargar(); },
    quitarFiltro: function(key){
        if (key === 'q'){ st.q = ''; var i = $('ocqBuscar'); if (i) i.value = ''; }
        else if (key === 'estado'){ st.estadoF = ''; var s = $('ocqEstado'); if (s) s.value = ''; }
        else if (key === 'proveedor'){ st.proveedorF = ''; var p = $('ocqProveedor'); if (p) p.value = ''; }
        st.offset = 0; cargar();
    },
    limpiar: function(){
        st.q = ''; st.estadoF = ''; st.proveedorF = ''; st.offset = 0;
        var i = $('ocqBuscar'); if (i) i.value = '';
        var s = $('ocqEstado'); if (s) s.value = '';
        var p = $('ocqProveedor'); if (p) p.value = '';
        cargar();
    },
    prev: function(){ if (st.offset > 0){ st.offset = Math.max(0, st.offset - st.limit); cargar(); } },
    next: function(){ if (st.offset + st.limit < st.total){ st.offset += st.limit; cargar(); } },
    pdf: function(id){ window.open(API_OC + '/' + id + '/html', '_blank'); },
    excelOC: function(id){ exportarOCaExcel(id); },
    exportarExcel: function(){ window.open(API_OC + '/export/excel?' + queryParams().toString(), '_blank'); }
};

})();
