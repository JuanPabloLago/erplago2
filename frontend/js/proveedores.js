/**
 * PROVEEDORES v13.0 - Frontend JS
 * ERP LAGO
 * 
 * Características:
 * - Búsqueda vectorial en tiempo real
 * - Integración AFIP Padrón A5
 * - Acciones masivas
 * - Exportación Excel
 * - Navegación por teclado completa
 */

// ============================================================================
// VARIABLES GLOBALES
// ============================================================================

let proveedores = [];
let formData = { condiciones_iva: [], provincias: [] };
let proveedoresSeleccionados = new Set();
let debounceTimer = null;
let proveedorIdEliminar = null;

// Instancias Bootstrap
let modalProveedor, modalConfirmarEliminar, toast;

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Verificar autenticación
    if (!localStorage.getItem('authToken')) {
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }

    // Inicializar modales y toast
    modalProveedor = new bootstrap.Modal(document.getElementById('modalProveedor'));
    modalConfirmarEliminar = new bootstrap.Modal(document.getElementById('modalConfirmarEliminar'));
    toast = new bootstrap.Toast(document.getElementById('toastNotificacion'));

    // Cargar datos iniciales
    cargarFormData();
    buscarProveedores();

    // Event listeners
    configurarEventListeners();
    configurarTeclado();
});

// ============================================================================
// CARGA DE DATOS
// ============================================================================

async function cargarFormData() {
    try {
        const response = await fetch('/api/proveedores/form-data', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        if (!response.ok) throw new Error('Error al cargar datos del formulario');
        
        formData = await response.json();
        
        // Poblar select de Condición IVA en filtros
        const filtroIVA = document.getElementById('filtroCondicionIVA');
        filtroIVA.innerHTML = '<option value="todos">Todas las condiciones IVA</option>';
        formData.condiciones_iva.forEach(c => {
            filtroIVA.innerHTML += `<option value="${c.id_condicion_iva}">${escapeHtml(c.nombre)}</option>`;
        });

        // Poblar select de Provincia en filtros
        const filtroProv = document.getElementById('filtroProvincia');
        filtroProv.innerHTML = '<option value="todos">Todas las provincias</option>';
        formData.provincias.forEach(p => {
            if (p) filtroProv.innerHTML += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
        });

        // Poblar select de Condición IVA en modal
        const selectIVA = document.getElementById('condicionIVA');
        selectIVA.innerHTML = '<option value="">Seleccione...</option>';
        formData.condiciones_iva.forEach(c => {
            selectIVA.innerHTML += `<option value="${c.id_condicion_iva}">${escapeHtml(c.nombre)}</option>`;
        });

    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', 'No se pudieron cargar los datos del formulario', 'danger');
    }
}

async function buscarProveedores() {
    const loading = document.getElementById('loadingProveedores');
    const sinResultados = document.getElementById('sinResultados');
    const tbody = document.getElementById('tbodyProveedores');
    
    loading.classList.remove('d-none');
    sinResultados.classList.add('d-none');
    tbody.innerHTML = '';

    try {
        const params = new URLSearchParams({
            q: document.getElementById('buscadorGlobal').value,
            condicion_iva: document.getElementById('filtroCondicionIVA').value,
            provincia: document.getElementById('filtroProvincia').value,
            activo: document.getElementById('filtroActivo').value,
            limit: 200
        });

        const response = await fetch(`/api/proveedores/buscar?${params}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        if (!response.ok) throw new Error('Error al buscar proveedores');

        const data = await response.json();
        proveedores = data.proveedores || [];
        
        // Actualizar contador
        document.getElementById('totalProveedores').textContent = data.total || proveedores.length;
        
        // Renderizar tabla
        renderizarTabla();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', 'Error al buscar proveedores', 'danger');
    } finally {
        loading.classList.add('d-none');
    }
}

// ============================================================================
// RENDERIZADO DE TABLA
// ============================================================================

function renderizarTabla() {
    const tbody = document.getElementById('tbodyProveedores');
    const sinResultados = document.getElementById('sinResultados');
    
    if (proveedores.length === 0) {
        tbody.innerHTML = '';
        sinResultados.classList.remove('d-none');
        return;
    }
    
    sinResultados.classList.add('d-none');
    
    tbody.innerHTML = proveedores.map(p => `
        <tr data-id="${p.id_proveedor}" class="${proveedoresSeleccionados.has(p.id_proveedor) ? 'selected' : ''}">
            <td onclick="event.stopPropagation()">
                <input type="checkbox" class="form-check-input check-proveedor" 
                       value="${p.id_proveedor}" 
                       ${proveedoresSeleccionados.has(p.id_proveedor) ? 'checked' : ''}>
            </td>
            <td>
                <div class="fw-bold">${escapeHtml(p.razon_social)}</div>
                ${p.nombre_fantasia ? `<small class="text-muted">${escapeHtml(p.nombre_fantasia)}</small>` : ''}
            </td>
            <td><code>${escapeHtml(p.cuit || '-')}</code></td>
            <td>${getBadgeIVA(p.condicion_iva)}</td>
            <td>
                ${escapeHtml(p.localidad || '')}
                ${p.provincia ? `<small class="text-muted d-block">${escapeHtml(p.provincia)}</small>` : ''}
            </td>
            <td>${escapeHtml(p.telefono || '-')}</td>
            <td>${p.email ? `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : '-'}</td>
            <td>${escapeHtml(p.contacto || '-')}</td>
            <td onclick="event.stopPropagation()">
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-primary" onclick="editarProveedor(${p.id_proveedor})" title="Editar">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-outline-danger" onclick="confirmarEliminar(${p.id_proveedor}, '${escapeHtml(p.razon_social)}')" title="Eliminar">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    // Event listeners para checkboxes
    document.querySelectorAll('.check-proveedor').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const id = parseInt(e.target.value);
            if (e.target.checked) {
                proveedoresSeleccionados.add(id);
                e.target.closest('tr').classList.add('selected');
            } else {
                proveedoresSeleccionados.delete(id);
                e.target.closest('tr').classList.remove('selected');
            }
            actualizarBarraAcciones();
        });
    });

    // Click en fila para editar
    document.querySelectorAll('#tbodyProveedores tr').forEach(tr => {
        tr.addEventListener('dblclick', () => {
            const id = parseInt(tr.dataset.id);
            editarProveedor(id);
        });
    });
}

function getBadgeIVA(condicion) {
    if (!condicion) return '<span class="badge bg-secondary badge-iva">Sin datos</span>';
    
    const mapeo = {
        'Responsable Inscripto': 'primary',
        'Monotributo': 'info',
        'Exento': 'warning',
        'Consumidor Final': 'secondary'
    };
    
    const color = mapeo[condicion] || 'secondary';
    return `<span class="badge bg-${color} badge-iva">${escapeHtml(condicion)}</span>`;
}

// ============================================================================
// CONSULTA AFIP
// ============================================================================

async function buscarEnAFIP() {
    const cuitInput = document.getElementById('cuit');
    const btnAFIP = document.getElementById('btnBuscarAFIP');
    const spinner = btnAFIP.querySelector('.loading-spinner');
    const feedback = document.getElementById('cuitFeedback');
    
    const cuit = cuitInput.value.replace(/\D/g, '');
    
    if (cuit.length !== 11) {
        feedback.innerHTML = '<span class="text-danger">El CUIT debe tener 11 dígitos</span>';
        cuitInput.focus();
        return;
    }
    
    // Mostrar loading
    btnAFIP.disabled = true;
    spinner.classList.add('active');
    feedback.innerHTML = '<span class="text-info">Consultando AFIP...</span>';
    
    try {
        const response = await fetch(`/api/proveedores/buscar-datos-cuit/${cuit}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.mensaje || data.error || 'Error al consultar AFIP');
        }
        
        if (data.existe_en_sistema) {
            feedback.innerHTML = `<span class="text-warning">
                <i class="bi bi-exclamation-triangle"></i> 
                Este CUIT ya existe: ${escapeHtml(data.proveedor_existente.razon_social)}
            </span>`;
        } else {
            feedback.innerHTML = `<span class="text-success">
                <i class="bi bi-check-circle"></i> 
                Datos obtenidos de AFIP - Estado: ${escapeHtml(data.datos.estado_cuit || 'Activo')}
            </span>`;
        }
        
        // Poblar formulario con datos de AFIP
        const datos = data.datos;
        document.getElementById('cuit').value = datos.cuit || '';
        document.getElementById('razonSocial').value = datos.razon_social || '';
        document.getElementById('nombreFantasia').value = datos.nombre_fantasia || '';
        document.getElementById('direccion').value = datos.direccion || '';
        document.getElementById('localidad').value = datos.localidad || '';
        document.getElementById('provincia').value = datos.provincia || '';
        document.getElementById('codigoPostal').value = datos.codigo_postal || '';
        
        if (datos.id_condicion_iva) {
            document.getElementById('condicionIVA').value = datos.id_condicion_iva;
        }
        
        // Focus en el siguiente campo vacío
        document.getElementById('telefono').focus();
        
    } catch (error) {
        console.error('Error AFIP:', error);
        feedback.innerHTML = `<span class="text-danger">
            <i class="bi bi-x-circle"></i> ${escapeHtml(error.message)}
        </span>`;
    } finally {
        btnAFIP.disabled = false;
        spinner.classList.remove('active');
    }
}

// ============================================================================
// CRUD PROVEEDORES
// ============================================================================

function nuevoProveedor() {
    document.getElementById('formProveedor').reset();
    document.getElementById('proveedorId').value = '';
    document.getElementById('modalProveedorTitulo').innerHTML = '<i class="bi bi-truck"></i> Nuevo Proveedor';
    document.getElementById('cuitFeedback').innerHTML = '';
    modalProveedor.show();
    
    setTimeout(() => document.getElementById('cuit').focus(), 300);
}

async function editarProveedor(id) {
    try {
        const response = await fetch(`/api/proveedores/${id}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        if (!response.ok) throw new Error('Error al obtener proveedor');
        
        const proveedor = await response.json();
        
        // Poblar formulario
        document.getElementById('proveedorId').value = proveedor.id_proveedor;
        document.getElementById('cuit').value = proveedor.cuit || '';
        document.getElementById('condicionIVA').value = proveedor.id_condicion_iva || '';
        document.getElementById('razonSocial').value = proveedor.razon_social || '';
        document.getElementById('nombreFantasia').value = proveedor.nombre_fantasia || '';
        document.getElementById('direccion').value = proveedor.direccion || '';
        document.getElementById('localidad').value = proveedor.localidad || '';
        document.getElementById('provincia').value = proveedor.provincia || '';
        document.getElementById('codigoPostal').value = proveedor.codigo_postal || '';
        document.getElementById('telefono').value = proveedor.telefono || '';
        document.getElementById('email').value = proveedor.email || '';
        document.getElementById('contacto').value = proveedor.contacto || '';
        document.getElementById('notas').value = proveedor.notas || '';
        
        document.getElementById('modalProveedorTitulo').innerHTML = '<i class="bi bi-pencil"></i> Editar Proveedor';
        document.getElementById('cuitFeedback').innerHTML = '';
        
        modalProveedor.show();
        setTimeout(() => document.getElementById('razonSocial').focus(), 300);
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', 'No se pudo cargar el proveedor', 'danger');
    }
}

async function guardarProveedor() {
    const form = document.getElementById('formProveedor');
    
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    const id = document.getElementById('proveedorId').value;
    const data = {
        cuit: document.getElementById('cuit').value || null,
        id_condicion_iva: parseInt(document.getElementById('condicionIVA').value),
        razon_social: document.getElementById('razonSocial').value,
        nombre_fantasia: document.getElementById('nombreFantasia').value || null,
        direccion: document.getElementById('direccion').value || null,
        localidad: document.getElementById('localidad').value || null,
        provincia: document.getElementById('provincia').value || null,
        codigo_postal: document.getElementById('codigoPostal').value || null,
        telefono: document.getElementById('telefono').value || null,
        email: document.getElementById('email').value || null,
        contacto: document.getElementById('contacto').value || null,
        notas: document.getElementById('notas').value || null
    };
    
    try {
        const url = id ? `/api/proveedores/${id}` : '/api/proveedores';
        const method = id ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Error al guardar proveedor');
        }
        
        modalProveedor.hide();
        mostrarToast('Éxito', result.message || 'Proveedor guardado correctamente', 'success');
        buscarProveedores();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', error.message, 'danger');
    }
}

function confirmarEliminar(id, nombre) {
    proveedorIdEliminar = id;
    document.getElementById('nombreProveedorEliminar').textContent = nombre;
    modalConfirmarEliminar.show();
}

async function eliminarProveedor() {
    if (!proveedorIdEliminar) return;
    
    try {
        const response = await fetch(`/api/proveedores/${proveedorIdEliminar}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Error al eliminar proveedor');
        }
        
        modalConfirmarEliminar.hide();
        mostrarToast('Éxito', 'Proveedor desactivado correctamente', 'success');
        buscarProveedores();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', error.message, 'danger');
    } finally {
        proveedorIdEliminar = null;
    }
}

// ============================================================================
// ACCIONES MASIVAS
// ============================================================================

function actualizarBarraAcciones() {
    const barra = document.getElementById('barraAcciones');
    const cantidad = document.getElementById('cantidadSeleccionados');
    const checkAll = document.getElementById('checkAll');
    
    cantidad.textContent = proveedoresSeleccionados.size;
    
    if (proveedoresSeleccionados.size > 0) {
        barra.classList.add('visible');
    } else {
        barra.classList.remove('visible');
    }
    
    // Actualizar checkbox "seleccionar todos"
    checkAll.checked = proveedores.length > 0 && proveedoresSeleccionados.size === proveedores.length;
    checkAll.indeterminate = proveedoresSeleccionados.size > 0 && proveedoresSeleccionados.size < proveedores.length;
}

function seleccionarTodos(checked) {
    proveedoresSeleccionados.clear();
    
    if (checked) {
        proveedores.forEach(p => proveedoresSeleccionados.add(p.id_proveedor));
    }
    
    document.querySelectorAll('.check-proveedor').forEach(checkbox => {
        checkbox.checked = checked;
        checkbox.closest('tr').classList.toggle('selected', checked);
    });
    
    actualizarBarraAcciones();
}

async function cambiarEstadoMasivo(activo) {
    if (proveedoresSeleccionados.size === 0) return;
    
    const accion = activo ? 'activar' : 'desactivar';
    if (!confirm(`¿Está seguro de ${accion} ${proveedoresSeleccionados.size} proveedor(es)?`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/proveedores/masivo/cambiar-estado', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({
                ids: Array.from(proveedoresSeleccionados),
                activo
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Error al cambiar estado');
        }
        
        proveedoresSeleccionados.clear();
        actualizarBarraAcciones();
        mostrarToast('Éxito', result.message, 'success');
        buscarProveedores();
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', error.message, 'danger');
    }
}

// ============================================================================
// EXPORTACIÓN
// ============================================================================

async function exportarExcel(ids = null) {
    try {
        const idsExportar = ids || (proveedoresSeleccionados.size > 0 ? Array.from(proveedoresSeleccionados) : null);
        
        const response = await fetch('/api/proveedores/exportar/excel', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ ids: idsExportar })
        });
        
        if (!response.ok) throw new Error('Error al exportar');
        
        const result = await response.json();
        
        if (!result.data || result.data.length === 0) {
            mostrarToast('Aviso', 'No hay datos para exportar', 'warning');
            return;
        }
        
        // Crear CSV
        const headers = ['Razón Social', 'Nombre Fantasía', 'CUIT', 'Condición IVA', 'Dirección', 'Localidad', 'Provincia', 'CP', 'Teléfono', 'Email', 'Contacto', 'Estado', 'Fecha Alta'];
        const rows = result.data.map(p => [
            p.razon_social || '',
            p.nombre_fantasia || '',
            p.cuit || '',
            p.condicion_iva || '',
            p.direccion || '',
            p.localidad || '',
            p.provincia || '',
            p.codigo_postal || '',
            p.telefono || '',
            p.email || '',
            p.contacto || '',
            p.estado || '',
            p.fecha_alta ? new Date(p.fecha_alta).toLocaleDateString() : ''
        ]);
        
        // Generar CSV con BOM UTF-8
        const csvContent = '\ufeff' + [headers, ...rows]
            .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        
        // Descargar
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `proveedores_${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        
        mostrarToast('Éxito', `${result.data.length} proveedores exportados`, 'success');
        
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error', 'Error al exportar proveedores', 'danger');
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function configurarEventListeners() {
    // Botón nuevo proveedor
    document.getElementById('btnNuevoProveedor').addEventListener('click', nuevoProveedor);
    
    // Guardar proveedor
    document.getElementById('btnGuardarProveedor').addEventListener('click', guardarProveedor);
    
    // Confirmar eliminar
    document.getElementById('btnConfirmarEliminar').addEventListener('click', eliminarProveedor);
    
    // Buscar en AFIP
    document.getElementById('btnBuscarAFIP').addEventListener('click', buscarEnAFIP);
    
    // Buscador con debounce
    document.getElementById('buscadorGlobal').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => buscarProveedores(), 300);
    });
    
    // Limpiar búsqueda
    document.getElementById('btnLimpiarBusqueda').addEventListener('click', () => {
        document.getElementById('buscadorGlobal').value = '';
        buscarProveedores();
    });
    
    // Filtros
    document.getElementById('filtroCondicionIVA').addEventListener('change', buscarProveedores);
    document.getElementById('filtroProvincia').addEventListener('change', buscarProveedores);
    document.getElementById('filtroActivo').addEventListener('change', buscarProveedores);
    
    // Checkbox seleccionar todos
    document.getElementById('checkAll').addEventListener('change', (e) => {
        seleccionarTodos(e.target.checked);
    });
    
    // Acciones masivas
    document.getElementById('btnActivarMasivo').addEventListener('click', () => cambiarEstadoMasivo(true));
    document.getElementById('btnDesactivarMasivo').addEventListener('click', () => cambiarEstadoMasivo(false));
    document.getElementById('btnExportarSeleccion').addEventListener('click', () => exportarExcel());
    
    // Exportar todos
    document.getElementById('btnExportar').addEventListener('click', () => exportarExcel(null));
    
    // Formatear CUIT mientras escribe
    document.getElementById('cuit').addEventListener('input', (e) => {
        e.target.value = formatearCUIT(e.target.value);
    });
}

function configurarTeclado() {
    // Teclas globales
    document.addEventListener('keydown', (e) => {
        // Esc para limpiar búsqueda o cerrar modal
        if (e.key === 'Escape') {
            const modalesAbiertos = document.querySelector('.modal.show');
            if (!modalesAbiertos) {
                document.getElementById('buscadorGlobal').value = '';
                buscarProveedores();
            }
        }
        
        // Enter en buscador
        if (e.key === 'Enter' && e.target.id === 'buscadorGlobal') {
            e.preventDefault();
            buscarProveedores();
        }
    });
    
    // Navegación por teclado en el formulario
    document.getElementById('formProveedor').addEventListener('keydown', (e) => {
        // F2 para guardar
        if (e.key === 'F2') {
            e.preventDefault();
            guardarProveedor();
            return;
        }
        
        // Enter para siguiente campo
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const nextId = e.target.dataset.next;
            if (nextId) {
                const nextElement = document.getElementById(nextId);
                if (nextElement) {
                    if (nextElement.tagName === 'BUTTON') {
                        nextElement.click();
                    } else {
                        nextElement.focus();
                    }
                }
            }
        }
    });
}

// ============================================================================
// UTILIDADES
// ============================================================================

function formatearCUIT(valor) {
    // Remover todo lo que no sea número
    const numeros = valor.replace(/\D/g, '');
    
    // Formatear XX-XXXXXXXX-X
    if (numeros.length <= 2) {
        return numeros;
    } else if (numeros.length <= 10) {
        return `${numeros.slice(0, 2)}-${numeros.slice(2)}`;
    } else {
        return `${numeros.slice(0, 2)}-${numeros.slice(2, 10)}-${numeros.slice(10, 11)}`;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function mostrarToast(titulo, mensaje, tipo = 'info') {
    const toastEl = document.getElementById('toastNotificacion');
    const toastTitulo = document.getElementById('toastTitulo');
    const toastMensaje = document.getElementById('toastMensaje');
    
    // Limpiar clases anteriores
    toastEl.classList.remove('bg-success', 'bg-danger', 'bg-warning', 'bg-info', 'text-white');
    
    // Aplicar clase según tipo
    if (tipo === 'success') {
        toastEl.classList.add('bg-success', 'text-white');
    } else if (tipo === 'danger') {
        toastEl.classList.add('bg-danger', 'text-white');
    } else if (tipo === 'warning') {
        toastEl.classList.add('bg-warning');
    }
    
    toastTitulo.textContent = titulo;
    toastMensaje.textContent = mensaje;
    toast.show();
}
