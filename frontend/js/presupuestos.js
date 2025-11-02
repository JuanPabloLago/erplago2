// =======================================================================
//                    PRESUPUESTOS.JS - ERP LAGO
// =======================================================================

const API_URL = 'http://72.60.148.18:3000/api';
let productos = [];
let clientes = [];
let presupuestos = [];
let itemCount = 0;

// =======================================================================
//                          INICIALIZACIÓN
// =======================================================================

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacion();
    cargarClientes();
    cargarProductos();
    cargarPresupuestos();
});

// =======================================================================
//                          CARGAR DATOS
// =======================================================================

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

async function cargarPresupuestos() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/presupuestos`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        
        if (response.ok) {
            presupuestos = await response.json();
            mostrarPresupuestos(presupuestos);
        }
    } catch (error) {
        console.error('Error al cargar presupuestos:', error);
        document.getElementById('tablaPresupuestos').innerHTML = 
            '<tr><td colspan="7" class="text-center text-danger">Error al cargar presupuestos</td></tr>';
    }
}

// =======================================================================
//                          MOSTRAR PRESUPUESTOS
// =======================================================================

function mostrarPresupuestos(lista) {
    const tbody = document.getElementById('tablaPresupuestos');
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay presupuestos</td></tr>';
        return;
    }
    
    tbody.innerHTML = lista.map(p => {
        const fecha = new Date(p.fecha_emision).toLocaleDateString('es-AR');
        const vencimiento = p.fecha_vencimiento ? new Date(p.fecha_vencimiento).toLocaleDateString('es-AR') : '-';
        const estadoBadge = getEstadoBadge(p.estado);
        
        return `
            <tr>
                <td><strong>${p.numero_completo}</strong></td>
                <td>${fecha}</td>
                <td>${p.cliente || 'Sin cliente'}</td>
                <td>${vencimiento}</td>
                <td><strong>$${parseFloat(p.total).toFixed(2)}</strong></td>
                <td>${estadoBadge}</td>
                <td>
                    <button class="btn btn-sm btn-info btn-action" onclick="verDetalle(${p.id_presupuesto})" title="Ver detalle">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-danger btn-action" onclick="descargarPDF(${p.id_presupuesto})" title="Descargar PDF">
                        <i class="bi bi-file-pdf"></i>
                    </button>
                    <button class="btn btn-sm btn-success btn-action" onclick="cambiarEstado(${p.id_presupuesto}, 'aprobado')" title="Aprobar">
                        <i class="bi bi-check-circle"></i>
                    </button>
                    <button class="btn btn-sm btn-warning btn-action" onclick="cambiarEstado(${p.id_presupuesto}, 'rechazado')" title="Rechazar">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getEstadoBadge(estado) {
    const badges = {
        'pendiente': '<span class="badge bg-warning badge-estado">Pendiente</span>',
        'aprobado': '<span class="badge bg-success badge-estado">Aprobado</span>',
        'rechazado': '<span class="badge bg-danger badge-estado">Rechazado</span>',
        'facturado': '<span class="badge bg-primary badge-estado">Facturado</span>',
        'vencido': '<span class="badge bg-secondary badge-estado">Vencido</span>'
    };
    return badges[estado] || '<span class="badge bg-secondary badge-estado">Desconocido</span>';
}

// =======================================================================
//                          FORMULARIO
// =======================================================================

function mostrarFormulario() {
    document.getElementById('formPresupuesto').reset();
    document.getElementById('itemsPresupuesto').innerHTML = '';
    itemCount = 0;
    agregarItem();
    agregarItem();
    const modal = new bootstrap.Modal(document.getElementById('modalPresupuesto'));
    modal.show();
}

function agregarItem() {
    itemCount++;
    const tbody = document.getElementById('itemsPresupuesto');
    
    const selectProductos = `
        <select class="form-select form-select-sm producto-select" onchange="seleccionarProducto(this, ${itemCount})">
            <option value="">Escribir descripción...</option>
            ${productos.map(p => `<option value="${p.id_producto}" data-precio="${p.precio}">${p.nombre} - $${p.precio}</option>`).join('')}
        </select>
    `;
    
    const row = `
        <tr id="item-${itemCount}">
            <td>
                ${selectProductos}
                <input type="text" class="form-control form-control-sm mt-1 descripcion-input" 
                       placeholder="Descripción del item" data-item="${itemCount}">
            </td>
            <td><input type="number" class="form-control form-control-sm cantidad-input" value="1" min="0.01" step="0.01" 
                       onchange="calcularItem(${itemCount})" data-item="${itemCount}"></td>
            <td><input type="number" class="form-control form-control-sm precio-input" value="0" min="0" step="0.01" 
                       onchange="calcularItem(${itemCount})" data-item="${itemCount}"></td>
            <td><input type="number" class="form-control form-control-sm descuento-input" value="0" min="0" max="100" step="0.01" 
                       onchange="calcularItem(${itemCount})" data-item="${itemCount}"></td>
            <td><input type="number" class="form-control form-control-sm iva-input" value="21" min="0" max="100" step="0.01" 
                       onchange="calcularItem(${itemCount})" data-item="${itemCount}"></td>
            <td><input type="text" class="form-control form-control-sm total-input" readonly value="$0.00" data-item="${itemCount}"></td>
            <td><button type="button" class="btn btn-sm btn-danger" onclick="eliminarItem(${itemCount})">
                    <i class="bi bi-trash"></i>
                </button></td>
        </tr>
    `;
    
    tbody.insertAdjacentHTML('beforeend', row);
}

function seleccionarProducto(select, itemId) {
    const option = select.options[select.selectedIndex];
    if (option.value) {
        const precio = option.dataset.precio;
        const row = document.getElementById(`item-${itemId}`);
        row.querySelector('.precio-input').value = precio;
        row.querySelector('.descripcion-input').value = option.text;
        calcularItem(itemId);
    }
}

function calcularItem(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    if (!row) return;
    
    const cantidad = parseFloat(row.querySelector('.cantidad-input').value) || 0;
    const precio = parseFloat(row.querySelector('.precio-input').value) || 0;
    const descuento = parseFloat(row.querySelector('.descuento-input').value) || 0;
    const iva = parseFloat(row.querySelector('.iva-input').value) || 0;
    
    let subtotal = cantidad * precio;
    
    if (descuento > 0) {
        subtotal = subtotal * (1 - descuento / 100);
    }
    
    const ivaAmount = subtotal * (iva / 100);
    const total = subtotal + ivaAmount;
    
    row.querySelector('.total-input').value = `$${total.toFixed(2)}`;
    
    calcularTotales();
}

function calcularTotales() {
    let subtotalTotal = 0;
    let ivaTotal = 0;
    
    document.querySelectorAll('#itemsPresupuesto tr').forEach(row => {
        const cantidad = parseFloat(row.querySelector('.cantidad-input')?.value) || 0;
        const precio = parseFloat(row.querySelector('.precio-input')?.value) || 0;
        const descuento = parseFloat(row.querySelector('.descuento-input')?.value) || 0;
        const iva = parseFloat(row.querySelector('.iva-input')?.value) || 0;
        
        let subtotal = cantidad * precio;
        if (descuento > 0) {
            subtotal = subtotal * (1 - descuento / 100);
        }
        
        const ivaAmount = subtotal * (iva / 100);
        
        subtotalTotal += subtotal;
        ivaTotal += ivaAmount;
    });
    
    const total = subtotalTotal + ivaTotal;
    
    document.getElementById('subtotalPresupuesto').textContent = `$${subtotalTotal.toFixed(2)}`;
    document.getElementById('ivaPresupuesto').textContent = `$${ivaTotal.toFixed(2)}`;
    document.getElementById('totalPresupuesto').textContent = `$${total.toFixed(2)}`;
}

function eliminarItem(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    if (row) {
        row.remove();
        calcularTotales();
    }
}

// =======================================================================
//                          GUARDAR PRESUPUESTO
// =======================================================================

async function guardarPresupuesto() {
    const id_cliente = document.getElementById('id_cliente').value;
    const fecha_vencimiento = document.getElementById('fecha_vencimiento').value;
    const condiciones_pago = document.getElementById('condiciones_pago').value;
    const observaciones = document.getElementById('observaciones').value;
    
    const items = [];
    document.querySelectorAll('#itemsPresupuesto tr').forEach(row => {
        const productoSelect = row.querySelector('.producto-select');
        const id_producto = productoSelect?.value || null;
        const descripcion = row.querySelector('.descripcion-input')?.value;
        const cantidad = parseFloat(row.querySelector('.cantidad-input')?.value) || 0;
        const precio = parseFloat(row.querySelector('.precio-input')?.value) || 0;
        const descuento = parseFloat(row.querySelector('.descuento-input')?.value) || 0;
        const iva = parseFloat(row.querySelector('.iva-input')?.value) || 21;
        
        if (cantidad > 0 && precio > 0 && descripcion) {
            items.push({
                id_producto: id_producto || null,
                descripcion,
                cantidad,
                precio_unitario: precio,
                descuento_porcentaje: descuento,
                iva_porcentaje: iva
            });
        }
    });
    
    if (items.length === 0) {
        alert('Debe agregar al menos un item');
        return;
    }
    
    const data = {
        id_cliente: id_cliente || null,
        fecha_vencimiento: fecha_vencimiento || null,
        condiciones_pago,
        observaciones,
        items
    };
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/presupuestos`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            alert('Presupuesto creado exitosamente');
            bootstrap.Modal.getInstance(document.getElementById('modalPresupuesto')).hide();
            cargarPresupuestos();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar presupuesto');
    }
}

// =======================================================================
//                          ACCIONES
// =======================================================================

async function verDetalle(id) {
    try {
        const token = localS
