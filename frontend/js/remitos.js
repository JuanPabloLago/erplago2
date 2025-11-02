// =======================================================================
//                    REMITOS.JS - ERP LAGO
// =======================================================================

const API_URL = 'http://72.60.148.18:3000/api';
let productos = [];
let clientes = [];
let remitos = [];
let itemCount = 0;

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacion();
    cargarClientes();
    cargarProductos();
    cargarRemitos();
});

async function cargarClientes() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/clientes`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        if (response.ok) {
            clientes = await response.json();
            const select = document.getElementById('id_cliente');
            select.innerHTML = '<option value="">Seleccionar cliente...</option>';
            clientes.forEach(c => {
                select.innerHTML += `<option value="${c.id_cliente}">${c.razon_social}</option>`;
            });
        }
    } catch (error) {
        console.error('Error al cargar clientes:', error);
    }
}

async function cargarProductos() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/productos`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        if (response.ok) {
            productos = await response.json();
        }
    } catch (error) {
        console.error('Error al cargar productos:', error);
    }
}

async function cargarRemitos() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/remitos`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        if (response.ok) {
            remitos = await response.json();
            mostrarRemitos(remitos);
        }
    } catch (error) {
        console.error('Error al cargar remitos:', error);
        document.getElementById('tablaRemitos').innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar remitos</td></tr>';
    }
}

function mostrarRemitos(lista) {
    const tbody = document.getElementById('tablaRemitos');
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay remitos</td></tr>';
        return;
    }
    tbody.innerHTML = lista.map(r => {
        const fechaEmision = new Date(r.fecha_emision).toLocaleDateString('es-AR');
        const fechaEntrega = r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleDateString('es-AR') : '-';
        const estadoBadge = getEstadoBadge(r.estado);
        return `
            <tr>
                <td><strong>${r.numero_completo}</strong></td>
                <td>${fechaEmision}</td>
                <td>${r.cliente || 'Sin cliente'}</td>
                <td>${fechaEntrega}</td>
                <td>${r.transportista || '-'}</td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-info btn-action" onclick="verDetalle(${r.id_remito})" title="Ver detalle"><i class="bi bi-eye"></i></button>
                    <button class="btn btn-sm btn-danger btn-action" onclick="descargarPDF(${r.id_remito})" title="Descargar PDF"><i class="bi bi-file-pdf"></i></button>
                    ${r.estado === 'pendiente' ? `<button class="btn btn-sm btn-success btn-action" onclick="marcarEntregado(${r.id_remito})" title="Marcar entregado"><i class="bi bi-check-circle"></i></button>` : ''}
                </td>
            </tr>`;
    }).join('');
}

function getEstadoBadge(estado) {
    const badges = {'pendiente': '<span class="badge bg-warning badge-estado">Pendiente</span>', 'entregado': '<span class="badge bg-success badge-estado">Entregado</span>', 'anulado': '<span class="badge bg-danger badge-estado">Anulado</span>'};
    return badges[estado] || '<span class="badge bg-secondary badge-estado">Desconocido</span>';
}

function mostrarFormulario() {
    document.getElementById('formRemito').reset();
    document.getElementById('itemsRemito').innerHTML = '';
    itemCount = 0;
    agregarItem();
    agregarItem();
    const modal = new bootstrap.Modal(document.getElementById('modalRemito'));
    modal.show();
}

function agregarItem() {
    itemCount++;
    const tbody = document.getElementById('itemsRemito');
    const selectProductos = `<select class="form-select form-select-sm producto-select" onchange="seleccionarProducto(this, ${itemCount})"><option value="">Seleccionar producto...</option>${productos.map(p => `<option value="${p.id_producto}">${p.nombre}</option>`).join('')}</select>`;
    const row = `<tr id="item-${itemCount}"><td>${selectProductos}<input type="text" class="form-control form-control-sm mt-1 descripcion-input" placeholder="Descripción del producto" data-item="${itemCount}"></td><td><input type="number" class="form-control form-control-sm cantidad-input" value="1" min="0.01" step="0.01" data-item="${itemCount}"></td><td><button type="button" class="btn btn-sm btn-danger" onclick="eliminarItem(${itemCount})"><i class="bi bi-trash"></i></button></td></tr>`;
    tbody.insertAdjacentHTML('beforeend', row);
}

function seleccionarProducto(select, itemId) {
    const option = select.options[select.selectedIndex];
    if (option.value) {
        const row = document.getElementById(`item-${itemId}`);
        row.querySelector('.descripcion-input').value = option.text;
    }
}

function eliminarItem(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    if (row) row.remove();
}

async function guardarRemito() {
    const id_cliente = document.getElementById('id_cliente').value;
    const fecha_entrega = document.getElementById('fecha_entrega').value;
    const direccion_entrega = document.getElementById('direccion_entrega').value;
    const transportista = document.getElementById('transportista').value;
    const observaciones = document.getElementById('observaciones').value;
    if (!id_cliente) {alert('Debe seleccionar un cliente'); return;}
    const items = [];
    document.querySelectorAll('#itemsRemito tr').forEach(row => {
        const productoSelect = row.querySelector('.producto-select');
        const id_producto = productoSelect?.value;
        const descripcion = row.querySelector('.descripcion-input')?.value;
        const cantidad = parseFloat(row.querySelector('.cantidad-input')?.value) || 0;
        if (id_producto && cantidad > 0 && descripcion) {
            items.push({id_producto: parseInt(id_producto), descripcion, cantidad});
        }
    });
    if (items.length === 0) {alert('Debe agregar al menos un item'); return;}
    const data = {id_cliente: parseInt(id_cliente), fecha_entrega: fecha_entrega || null, direccion_entrega, transportista, observaciones, items};
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/remitos`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
            body: JSON.stringify(data)
        });
        if (response.ok) {
            alert('Remito creado exitosamente');
            bootstrap.Modal.getInstance(document.getElementById('modalRemito')).hide();
            cargarRemitos();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar remito');
    }
}

async function verDetalle(id) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/remitos/${id}`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        if (response.ok) {
            const remito = await response.json();
            mostrarDetalleModal(remito);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar detalle');
    }
}

function mostrarDetalleModal(r) {
    const fechaEmision = new Date(r.fecha_emision).toLocaleDateString('es-AR');
    const fechaEntrega = r.fecha_entrega ? new Date(r.fecha_entrega).toLocaleDateString('es-AR') : 'No especificada';
    const itemsHTML = r.items.map(item => `<tr><td>${item.descripcion || item.producto}</td><td>${item.cantidad}</td></tr>`).join('');
    const modalHTML = `<div class="modal fade" id="modalDetalle" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header bg-info text-white"><h5 class="modal-title">Remito ${r.numero_completo}</h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="row mb-3"><div class="col-md-6"><strong>Cliente:</strong> ${r.cliente || 'Sin cliente'}</div><div class="col-md-6"><strong>Estado:</strong> ${getEstadoBadge(r.estado)}</div><div class="col-md-6"><strong>Fecha Emisión:</strong> ${fechaEmision}</div><div class="col-md-6"><strong>Fecha Entrega:</strong> ${fechaEntrega}</div>${r.direccion_entrega ? `<div class="col-md-12"><strong>Dirección:</strong> ${r.direccion_entrega}</div>` : ''}${r.transportista ? `<div class="col-md-12"><strong>Transportista:</strong> ${r.transportista}</div>` : ''}</div><table class="table table-sm"><thead><tr><th>Descripción</th><th>Cantidad</th></tr></thead><tbody>${itemsHTML}</tbody></table>${r.observaciones ? `<p class="mt-3"><strong>Observaciones:</strong> ${r.observaciones}</p>` : ''}</div><div class="modal-footer"><button class="btn btn-danger" onclick="descargarPDF(${r.id_remito})"><i class="bi bi-file-pdf"></i> Descargar PDF</button><button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button></div></div></div></div>`;
    const oldModal = document.getElementById('modalDetalle');
    if (oldModal) oldModal.remove();
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = new bootstrap.Modal(document.getElementById('modalDetalle'));
    modal.show();
}

async function descargarPDF(id) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/remitos/${id}/pdf`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `remito_${id}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
        } else {
            alert('Error al generar PDF');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al descargar PDF');
    }
}

async function marcarEntregado(id) {
    if (!confirm('¿Marcar este remito como entregado?')) return;
    alert('Funcionalidad pendiente: actualizar estado del remito');
}

document.getElementById('filtroCliente')?.addEventListener('input', filtrarRemitos);
document.getElementById('filtroEstado')?.addEventListener('change', filtrarRemitos);

function filtrarRemitos() {
    const filtroCliente = document.getElementById('filtroCliente')?.value.toLowerCase() || '';
    const filtroEstado = document.getElementById('filtroEstado')?.value || '';
    const filtrados = remitos.filter(r => {
        const matchCliente = !filtroCliente || (r.cliente && r.cliente.toLowerCase().includes(filtroCliente));
        const matchEstado = !filtroEstado || r.estado === filtroEstado;
        return matchCliente && matchEstado;
    });
    mostrarRemitos(filtrados);
}
