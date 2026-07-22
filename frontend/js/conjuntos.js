/**
 * conjuntos.js — Gestión de Conjuntos / Kits
 * ERP LAGO - Paleta verde, búsqueda server-side, shortcuts
 */
'use strict';

const API_URL = window.CONFIG?.API_BASE_URL || '/api';
const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
});

let conjuntos = [];
let productosSeleccionados = [];
let modalConjunto = null;
let toastEl = null;
let debounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
    modalConjunto = new bootstrap.Modal(document.getElementById('modalConjunto'));
    toastEl = new bootstrap.Toast(document.getElementById('toastMsg'), { delay: 3000 });

    document.getElementById('btnNuevo').addEventListener('click', abrirModalNuevo);
    document.getElementById('btnRefrescar').addEventListener('click', cargarConjuntos);
    document.getElementById('btnGuardar').addEventListener('click', guardarConjunto);

    document.getElementById('buscarProducto').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const q = e.target.value.trim();
        if (q.length < 2) {
            document.getElementById('resultadosProductos').style.display = 'none';
            return;
        }
        debounceTimer = setTimeout(() => buscarProductos(q), 300);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5') { e.preventDefault(); cargarConjuntos(); }
        if (e.key === 'Insert') { e.preventDefault(); abrirModalNuevo(); }
        if (e.key === 'Escape') {
            e.preventDefault();
            const modal = document.getElementById('modalConjunto');
            if (modal.classList.contains('show')) modalConjunto.hide();
        }
        if (e.key === 'F2') {
            e.preventDefault();
            const modal = document.getElementById('modalConjunto');
            if (modal.classList.contains('show')) guardarConjunto();
        }
    });

    cargarConjuntos();
});

async function cargarConjuntos() {
    const container = document.getElementById('listaConjuntos');
    try {
        const resp = await fetch(`${API_URL}/conjuntos`, { headers: authHeaders() });
        if (!resp.ok) throw new Error('Error HTTP ' + resp.status);
        conjuntos = await resp.json();
        renderConjuntos();
        actualizarStats();
    } catch (err) {
        console.error('Error cargando conjuntos:', err);
        container.innerHTML = '<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-1"></i> Error al cargar conjuntos</div>';
    }
}

function renderConjuntos() {
    const container = document.getElementById('listaConjuntos');

    if (conjuntos.length === 0) {
        container.innerHTML = '<div class="text-center py-5"><i class="bi bi-collection" style="font-size:48px;color:#ccc;"></i><p class="text-muted mt-2">No hay conjuntos. Presion\u00e1 <kbd>Ins</kbd> para crear uno.</p></div>';
        return;
    }

    container.innerHTML = conjuntos.map(c => {
        const prods = c.productos || [];
        const tagsHTML = prods.map(p =>
            '<span class="producto-tag"><i class="bi bi-box-seam"></i> ' + escapeHTML(p.nombre) + ' <span class="cantidad">\u00d7' + p.cantidad + '</span></span>'
        ).join('');

        const precio = parseFloat(c.precio_conjunto || 0);
        const descuento = parseFloat(c.descuento_porcentaje || 0);
        const precioStr = precio > 0 ? '<strong class="text-success">$' + precio.toLocaleString('es-AR') + '</strong>' : '';
        const descStr = descuento > 0 ? '<span class="descuento-badge ms-1">' + descuento + '% OFF</span>' : '';

        return '<div class="card conjunto-card shadow-sm">' +
            '<div class="card-body py-2 px-3">' +
            '<div class="d-flex justify-content-between align-items-start">' +
            '<div><h6 class="mb-0 fw-bold"><i class="bi bi-collection text-primary me-1"></i>' + escapeHTML(c.nombre) + '</h6>' +
            '<small class="text-muted">' + escapeHTML(c.descripcion || '') + '</small></div>' +
            '<div class="d-flex gap-1">' +
            '<button class="btn btn-outline-primary btn-sm" onclick="editarConjunto(' + c.id_conjunto + ')" title="Editar"><i class="bi bi-pencil"></i></button>' +
            '<button class="btn btn-outline-danger btn-sm" onclick="eliminarConjunto(' + c.id_conjunto + ',\'' + escapeHTML(c.nombre).replace(/'/g, "\\\\'") + '\')" title="Eliminar"><i class="bi bi-trash"></i></button>' +
            '</div></div>' +
            '<div class="d-flex justify-content-between align-items-center mt-2">' +
            '<div>' + precioStr + descStr + '</div>' +
            '<span class="badge bg-secondary">' + prods.length + ' producto' + (prods.length !== 1 ? 's' : '') + '</span>' +
            '</div>' +
            '<div class="mt-2">' + (tagsHTML || '<small class="text-muted">Sin productos</small>') + '</div>' +
            '</div></div>';
    }).join('');
}

function actualizarStats() {
    document.getElementById('totalConjuntos').textContent = conjuntos.length;
    const totalProds = conjuntos.reduce((sum, c) => sum + (c.productos ? c.productos.length : 0), 0);
    document.getElementById('totalProductos').textContent = totalProds;
}

async function buscarProductos(query) {
    const container = document.getElementById('resultadosProductos');
    try {
        const resp = await fetch(API_URL + '/productos/buscar?buscar=' + encodeURIComponent(query) + '&limite=10', {
            headers: authHeaders()
        });
        if (!resp.ok) throw new Error('Error buscando');
        const productos = await resp.json();

        if (productos.length === 0) {
            container.innerHTML = '<div class="text-muted small p-2">Sin resultados</div>';
            container.style.display = 'block';
            return;
        }

        container.innerHTML = productos.map(p => {
            const yaAgregado = productosSeleccionados.some(s => s.id_producto === p.id_producto);
            const onclick = yaAgregado ? '' : 'agregarProducto(' + p.id_producto + ',\'' + escapeHTML(p.nombre).replace(/'/g, "\\\\'") + '\',\'' + escapeHTML(p.sku || '').replace(/'/g, "\\\\'") + '\')';
            return '<div class="resultado-busqueda ' + (yaAgregado ? 'text-muted' : '') + '" onclick="' + onclick + '">' +
                '<strong>' + escapeHTML(p.sku || '') + '</strong> \u2014 ' + escapeHTML(p.nombre) +
                (yaAgregado ? ' <i class="bi bi-check-circle text-success float-end"></i>' : '') +
                '</div>';
        }).join('');
        container.style.display = 'block';
    } catch (err) {
        console.error('Error buscando productos:', err);
    }
}

function agregarProducto(id_producto, nombre, sku) {
    if (productosSeleccionados.some(p => p.id_producto === id_producto)) {
        mostrarToast('Producto ya agregado', 'warning');
        return;
    }
    productosSeleccionados.push({ id_producto: id_producto, nombre: nombre, sku: sku, cantidad: 1 });
    renderProductosSeleccionados();
    document.getElementById('buscarProducto').value = '';
    document.getElementById('resultadosProductos').style.display = 'none';
    document.getElementById('buscarProducto').focus();
}

function renderProductosSeleccionados() {
    const container = document.getElementById('productosSeleccionados');

    if (productosSeleccionados.length === 0) {
        container.innerHTML = '<div class="text-muted small text-center py-3" id="sinProductos"><i class="bi bi-info-circle me-1"></i> Busca y agrega productos al conjunto</div>';
        return;
    }

    container.innerHTML = productosSeleccionados.map(function(p, i) {
        return '<div class="item-seleccionado">' +
            '<span class="nombre"><i class="bi bi-box-seam text-muted me-1"></i><strong>' + escapeHTML(p.sku || '') + '</strong> \u2014 ' + escapeHTML(p.nombre) + '</span>' +
            '<input type="number" class="form-control form-control-sm" value="' + p.cantidad + '" min="1" onchange="cambiarCantidad(' + i + ', this.value)">' +
            '<button class="btn btn-sm btn-outline-danger ms-2" onclick="quitarProducto(' + i + ')"><i class="bi bi-x"></i></button>' +
            '</div>';
    }).join('');
}

function cambiarCantidad(index, val) {
    var n = parseInt(val);
    productosSeleccionados[index].cantidad = n > 0 ? n : 1;
}

function quitarProducto(index) {
    productosSeleccionados.splice(index, 1);
    renderProductosSeleccionados();
}

function abrirModalNuevo() {
    document.getElementById('idConjunto').value = '';
    document.getElementById('nombreConjunto').value = '';
    document.getElementById('descripcionConjunto').value = '';
    document.getElementById('precioConjunto').value = '0';
    document.getElementById('descuentoConjunto').value = '0';
    document.getElementById('webVisible').checked = false;
    document.getElementById('webSlug').value = '';
    document.getElementById('webLabel').value = '';
    document.getElementById('webOrden').value = '0';
    productosSeleccionados = [];
    renderProductosSeleccionados();
    document.getElementById('modalTitulo').innerHTML = '<i class="bi bi-plus-circle me-1"></i> Nuevo Conjunto';
    modalConjunto.show();
    setTimeout(function() { document.getElementById('nombreConjunto').focus(); }, 300);
}

async function editarConjunto(id) {
    try {
        const resp = await fetch(API_URL + '/conjuntos/' + id, { headers: authHeaders() });
        if (!resp.ok) throw new Error('Error');
        const c = await resp.json();

        document.getElementById('idConjunto').value = c.id_conjunto;
        document.getElementById('nombreConjunto').value = c.nombre;
        document.getElementById('descripcionConjunto').value = c.descripcion || '';
        document.getElementById('precioConjunto').value = c.precio_conjunto || 0;
        document.getElementById('descuentoConjunto').value = c.descuento_porcentaje || 0;
        document.getElementById('webVisible').checked = !!c.web_visible;
        document.getElementById('webSlug').value     = c.web_slug  || '';
        document.getElementById('webLabel').value    = c.web_label || '';
        document.getElementById('webOrden').value    = (c.web_orden != null ? c.web_orden : 0);

        productosSeleccionados = (c.productos || []).map(function(p) {
            return { id_producto: p.id_producto, nombre: p.nombre, sku: p.sku || '', cantidad: p.cantidad };
        });
        renderProductosSeleccionados();

        document.getElementById('modalTitulo').innerHTML = '<i class="bi bi-pencil me-1"></i> Editar Conjunto';
        modalConjunto.show();
    } catch (err) {
        console.error('Error cargando conjunto:', err);
        mostrarToast('Error al cargar conjunto', 'danger');
    }
}

async function guardarConjunto() {
    var id = document.getElementById('idConjunto').value;
    var datos = {
        nombre: document.getElementById('nombreConjunto').value.trim(),
        descripcion: document.getElementById('descripcionConjunto').value.trim(),
        precio_conjunto: parseFloat(document.getElementById('precioConjunto').value) || 0,
        descuento_porcentaje: parseFloat(document.getElementById('descuentoConjunto').value) || 0,
        web_visible: document.getElementById('webVisible').checked,
        web_slug:    document.getElementById('webSlug').value.trim().toLowerCase() || null,
        web_label:   document.getElementById('webLabel').value.trim() || null,
        web_orden:   parseInt(document.getElementById('webOrden').value, 10) || 0,
        productos: productosSeleccionados.map(function(p) {
            return { id_producto: p.id_producto, cantidad: p.cantidad };
        })
    };

    if (!datos.nombre) { mostrarToast('El nombre es requerido', 'warning'); return; }
    if (datos.web_visible && !datos.web_slug) {
        mostrarToast('Para publicar en tienda, el slug URL es requerido', 'warning');
        document.getElementById('webSlug').focus();
        return;
    }
    if (datos.web_slug && !/^[a-z0-9-]+$/.test(datos.web_slug)) {
        mostrarToast('Slug invalido: solo minusculas, numeros y guiones', 'warning');
        document.getElementById('webSlug').focus();
        return;
    }
    if (datos.productos.length === 0) { mostrarToast('Agrega al menos un producto', 'warning'); return; }

    try {
        var url = id ? (API_URL + '/conjuntos/' + id) : (API_URL + '/conjuntos');
        var resp = await fetch(url, {
            method: id ? 'PUT' : 'POST',
            headers: authHeaders(),
            body: JSON.stringify(datos)
        });
        var result = await resp.json();

        if (resp.ok) {
            mostrarToast(result.message || 'Guardado correctamente', 'success');
            modalConjunto.hide();
            await cargarConjuntos();
        } else {
            mostrarToast(result.error || 'Error al guardar', 'danger');
        }
    } catch (err) {
        console.error('Error guardando:', err);
        mostrarToast('Error de conexi\u00f3n', 'danger');
    }
}

async function eliminarConjunto(id, nombre) {
    if (!confirm('\u00bfEliminar el conjunto "' + nombre + '"?')) return;
    try {
        var resp = await fetch(API_URL + '/conjuntos/' + id, {
            method: 'DELETE',
            headers: authHeaders()
        });
        var result = await resp.json();
        if (resp.ok) {
            mostrarToast('Conjunto eliminado', 'success');
            await cargarConjuntos();
        } else {
            mostrarToast(result.error || 'Error al eliminar', 'danger');
        }
    } catch (err) {
        console.error('Error eliminando:', err);
        mostrarToast('Error de conexi\u00f3n', 'danger');
    }
}

function escapeHTML(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function mostrarToast(msg, tipo) {
    tipo = tipo || 'success';
    var el = document.getElementById('toastMsg');
    var body = document.getElementById('toastBody');
    el.className = 'toast align-items-center border-0 text-bg-' + tipo;
    body.textContent = msg;
    toastEl.show();
}
