// =======================================================================
//                    NOTAS.JS - ERP LAGO
// =======================================================================

const API_URL = 'http://72.60.148.18:3000/api';
let productos = [];
let clientes = [];
let facturas = [];
let notas = [];
let itemCount = 0;
let tipoNotaActual = '';

// =======================================================================
//                          INICIALIZACIÓN
// =======================================================================

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacion();
    cargarClientes();
    cargarProductos();
    cargarFacturas();
    cargarNotas();
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

async function cargarFacturas() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/facturas`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        
        if (response.ok) {
            facturas = await response.json();
            const select = document.getElementById('id_factura_origen');
            select.innerHTML = '<option value="">Sin factura origen</option>';
            facturas.forEach(f => {
                if (!f.anulada) {
                    select.innerHTML += `<option value="${f.id_factura}">${f.numero_completo} - ${f.cliente} - $${f.total}</option>`;
                }
            });
        }
    } catch (error) {
        console.error('Error al cargar facturas:', error);
    }
}

async function cargarNotas() {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/notas`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        
        if (response.ok) {
            notas = await response.json();
            mostrarNotas(notas);
        }
    } catch (error) {
        console.error('Error al cargar notas:', error);
        document.getElementById('tablaNotas').innerHTML = 
            '<tr><td colspan="8" class="text-center text-danger">Error al cargar notas</td></tr>';
    }
}

// =======================================================================
//                          MOSTRAR NOTAS
// =======================================================================

function mostrarNotas(lista) {
    const tbody = document.getElementById('tablaNotas');
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No hay notas registradas</td></tr>';
        return;
    }
    
    tbody.innerHTML = lista.map(n => {
        const fecha = new Date(n.fecha_emision).toLocaleDateString('es-AR');
        const tipoBadge = n.tipo_nota === 'credito' 
            ? '<span class="badge bg-success badge-tipo">CRÉDITO</span>'
            : '<span class="badge bg-warning badge-tipo">DÉBITO</span>';
        const claseRow = n.tipo_nota === 'credito' ? 'nota-credito' : 'nota-debito';
        
        return `
            <tr class="${claseRow}">
                <td>${tipoBadge}</td>
                <td><strong>${n.numero_completo}</strong></td>
                <td>${fecha}</td>
                <td>${n.cliente || 'Sin cliente'}</td>
                <td>${n.factura_origen || '-'}</td>
                <td>${n.motivo.substring(0, 50)}${n.motivo.length > 50 ? '...' : ''}</td>
                <td><strong>$${parseFloat(n.total).toFixed(2)}</strong></td>
                <td>
                    <button class="btn btn-sm btn-info btn-action" onclick="verDetalle(${n.id_nota})" title="Ver detalle">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn btn-sm btn-danger btn-action" onclick="descargarPDF(${n.id_nota})" title="Descargar PDF">
                        <i class="bi bi-file-pdf"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// =======================================================================
//                          FORMULARIO
// =======================================================================

function mostrarFormulario(tipo) {
    tipoNotaActual = tipo;
    document.getElementById('tipo_nota').value = tipo;
    document.getElementById('formNota').reset();
    document.getElementById('itemsNota').innerHTML = '';
    itemCount = 0;
    
    const modalHeader = document.getElementById('modalHeader');
    const modalTitle = document.getElementById('modalTitle');
    
    if (tipo === 'credito') {
        modalHeader.className = 'modal-header bg-success text-white';
        modalTitle.innerHTML = '<i class="bi bi-file-earmark-minus"></i> Nueva Nota de Crédito';
    } else {
        modalHeader.className = 'modal-header bg-warning text-white';
        modalTitle.innerHTML = '<i class="bi bi-file-earmark-plus"></i> Nueva Nota de Débito';
    }
    
    agregarItem();
    agregarItem();
    
    const modal = new bootstrap.Modal(document.getElementById('modalNota'));
    modal.show();
}

function agregarItem() {
    itemCount++;
    const tbody = document.getElementById('itemsNota');
    
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
    const iva = parseFloat(row.querySelector('.iva-input').value) || 0;
    
    const subtotal = cantidad * precio;
    const ivaAmount = subtotal * (iva / 100);
    const total = subtotal + ivaAmount;
    
    row.querySelector('.total-input').value = `$${total.toFixed(2)}`;
    
    calcularTotales();
}

function calcularTotales() {
    let subtotalTotal = 0;
    let ivaTotal = 0;
    
    document.querySelectorAll('#itemsNota tr').forEach(row => {
        const cantidad = parseFloat(row.querySelector('.cantidad-input')?.value) || 0;
        const precio = parseFloat(row.querySelector('.precio-input')?.value) || 0;
        const iva = parseFloat(row.querySelector('.iva-input')?.value) || 0;
        
        const subtotal = cantidad * precio;
        const ivaAmount = subtotal * (iva / 100);
        
        subtotalTotal += subtotal;
        ivaTotal += ivaAmount;
    });
    
    const total = subtotalTotal + ivaTotal;
    
    document.getElementById('subtotalNota').textContent = `$${subtotalTotal.toFixed(2)}`;
    document.getElementById('ivaNota').textContent = `$${ivaTotal.toFixed(2)}`;
    document.getElementById('totalNota').textContent = `$${total.toFixed(2)}`;
}

function eliminarItem(itemId) {
    const row = document.getElementById(`item-${itemId}`);
    if (row) {
        row.remove();
        calcularTotales();
    }
}

// =======================================================================
//                          GUARDAR NOTA
// =======================================================================

async function guardarNota() {
    const tipo_nota = document.getElementById('tipo_nota').value;
    const id_cliente = document.getElementById('id_cliente').value;
    const id_factura_origen = document.getElementById('id_factura_origen').value;
    const codigo_tipo = document.getElementById('codigo_tipo').value;
    const motivo = document.getElementById('motivo').value;
    const observaciones = document.getElementById('observaciones').value;
    
    if (!codigo_tipo || !motivo) {
        alert('Complete todos los campos obligatorios');
        return;
    }
    
    const items = [];
    document.querySelectorAll('#itemsNota tr').forEach(row => {
        const productoSelect = row.querySelector('.producto-select');
        const id_producto = productoSelect?.value || null;
        const descripcion = row.querySelector('.descripcion-input')?.value;
        const cantidad = parseFloat(row.querySelector('.cantidad-input')?.value) || 0;
        const precio = parseFloat(row.querySelector('.precio-input')?.value) || 0;
        const iva = parseFloat(row.querySelector('.iva-input')?.value) || 21;
        
        if (cantidad > 0 && precio > 0 && descripcion) {
            items.push({
                id_producto: id_producto || null,
                descripcion,
                cantidad,
                precio_unitario: precio,
                iva_porcentaje: iva
            });
        }
    });
    
    if (items.length === 0) {
        alert('Debe agregar al menos un item');
        return;
    }
    
    const data = {
        tipo_nota,
        codigo_tipo,
        id_cliente: id_cliente || null,
        id_factura_origen: id_factura_origen || null,
        motivo,
        observaciones,
        items
    };
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/notas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            const tipoTexto = tipo_nota === 'credito' ? 'Crédito' : 'Débito';
            alert(`Nota de ${tipoTexto} creada exitosamente`);
            bootstrap.Modal.getInstance(document.getElementById('modalNota')).hide();
            cargarNotas();
        } else {
            const error = await response.json();
            alert('Error: ' + error.error);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar nota');
    }
}

// =======================================================================
//                          ACCIONES
// =======================================================================

async function verDetalle(id) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`${API_URL}/notas/${id}`, {
            headers: {'Authorization': `Bearer ${token}`}
        });
        
        if (response.ok) {
            const nota = await response.json();
            mostrarDetalleModal(nota);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar detalle');
    }
}

function mostrarDetalleModal(n) {
    const fecha = new Date(n.fecha_emision).toLocaleDateString('es-AR');
    const tipoTexto = n.tipo_nota === 'credito' ? 'CRÉDITO' : 'DÉBITO';
    const bgColor = n.tipo_nota === 'credito' ? 'bg-success' : 'bg-warning';
    
    const itemsHTML = n.items.map(item => `
        <tr>
            <td>${item.descripcion}</td>
            <td>${item.cantidad}</td>
            <td>$${parseFloat(item.precio_unitario).toFixed(2)}</td>
            <td>${item.iva_porcentaje}%</td>
            <td><strong>$${parseFloat(item.total).toFixed(2)}</strong></td>
        </tr>
    `).join('');
    
    const modalHTML = `
        <div class="modal fade" id="modalDetalle" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header ${bgColor} text-white">
                        <h5 class="modal-title">Nota de ${tipoTexto} ${n.numero_completo}</h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row mb-3">
                            <div class="col-md-6"><strong>Cliente:</strong> ${n.cliente || 'Sin cliente'}</div>
                            <div class="col-md-6"><strong>Fecha:</strong> ${fecha}</div>
                            ${n.factura_origen ? `<div class="col-md-12"><strong>Factura de Referencia:</strong> ${n.factura_origen}</div>` : ''}
                        </div>
