// ============================================================
// PLANIFICADOR DE ENTREGAS - JavaScript
// ============================================================

const API_URL = 'http://72.60.148.18:3000/api';
const TOKEN = localStorage.getItem('authToken');
let calendar;
let pedidosSinProgramar = [];
let entregasProgramadas = [];

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (!TOKEN) {
        window.location.href = 'login.html';
        return;
    }
    
    inicializarCalendario();
    cargarPedidosSinProgramar();
    cargarEntregasProgramadas();
    actualizarEstadisticas();
});

// ============================================================
// INICIALIZAR CALENDARIO
// ============================================================
function inicializarCalendario() {
    const calendarEl = document.getElementById('calendario');
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        locale: 'es',
        initialView: 'dayGridMonth',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay'
        },
        buttonText: {
            today: 'Hoy',
            month: 'Mes',
            week: 'Semana',
            day: 'Día'
        },
        height: 'auto',
        editable: true, // Permite drag & drop
        droppable: true, // Permite soltar elementos externos
        eventDurationEditable: true,
        eventStartEditable: true,
        
        // Cuando se suelta un pedido en el calendario
        drop: function(info) {
            const pedidoId = info.draggedEl.dataset.pedidoId;
            const pedido = pedidosSinProgramar.find(p => p.id_pedido == pedidoId);
            
            if (pedido) {
                programarEntrega(pedido, info.date);
            }
        },
        
        // Cuando se mueve un evento en el calendario
        eventDrop: function(info) {
            actualizarFechaEntrega(info.event, info.event.start);
        },
        
        // Click en un evento
        eventClick: function(info) {
            mostrarDetalleEntrega(info.event);
        },
        
        // Click en un día
        dateClick: function(info) {
            verEntregasDelDia(info.dateStr);
        },
        
        // Personalizar renderizado de eventos
        eventContent: function(arg) {
            return {
                html: `
                    <div class="fc-event-main-frame">
                        <div class="fc-event-time">${arg.timeText}</div>
                        <div class="fc-event-title-container">
                            <div class="fc-event-title fc-sticky">
                                <i class="bi bi-truck"></i> ${arg.event.title}
                                <br><small>${arg.event.extendedProps.cliente || ''}</small>
                            </div>
                        </div>
                    </div>
                `
            };
        }
    });
    
    calendar.render();
}

// ============================================================
// CARGAR PEDIDOS SIN PROGRAMAR
// ============================================================
async function cargarPedidosSinProgramar() {
    try {
        mostrarCargando(true);
        
        const response = await fetch(`${API_URL}/pedidos/sin-programar`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        if (!response.ok) throw new Error('Error al cargar pedidos');
        
        pedidosSinProgramar = await response.json();
        renderizarPedidos();
        actualizarEstadisticas();
        
    } catch (error) {
        console.error('Error:', error);
        Swal.fire('Error', 'No se pudieron cargar los pedidos', 'error');
    } finally {
        mostrarCargando(false);
    }
}

// ============================================================
// RENDERIZAR PEDIDOS EN SIDEBAR
// ============================================================
function renderizarPedidos() {
    const container = document.getElementById('listaPedidos');
    
    if (pedidosSinProgramar.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-check-circle"></i>
                <p class="mt-2">¡Todos los pedidos están programados!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = pedidosSinProgramar.map(pedido => `
        <div class="pedido-card draggable-pedido prioridad-2" 
             data-pedido-id="${pedido.id_pedido}"
             data-cliente="${pedido.cliente}"
             data-total="${pedido.total}">
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div>
                    <strong>#${pedido.id_pedido}</strong>
                    <span class="badge bg-warning text-dark ms-1">
                        ${pedido.items_pendientes} items
                    </span>
                </div>
                <i class="bi bi-grip-vertical text-muted"></i>
            </div>
            <div class="mb-1">
                <i class="bi bi-person"></i>
                <small>${pedido.cliente || 'Cliente'}</small>
            </div>
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">
                    <i class="bi bi-calendar"></i>
                    ${new Date(pedido.fecha_creacion).toLocaleDateString()}
                </small>
                <strong class="text-success">$${parseFloat(pedido.total).toFixed(2)}</strong>
            </div>
            ${pedido.domicilio_entrega ? `
                <div class="mt-1">
                    <small class="text-muted">
                        <i class="bi bi-geo-alt"></i> ${pedido.domicilio_entrega}
                    </small>
                </div>
            ` : ''}
        </div>
    `).join('');
    
    // Hacer los pedidos arrastrables
    inicializarDraggable();
}

// ============================================================
// INICIALIZAR DRAG & DROP
// ============================================================
function inicializarDraggable() {
    const draggableElements = document.querySelectorAll('.draggable-pedido');
    
    draggableElements.forEach(element => {
        element.addEventListener('dragstart', function(e) {
            e.dataTransfer.setData('text/plain', this.dataset.pedidoId);
            this.style.opacity = '0.5';
        });
        
        element.addEventListener('dragend', function() {
            this.style.opacity = '1';
        });
        
        // Hacer el elemento draggable
        element.draggable = true;
    });
}

// ============================================================
// CARGAR ENTREGAS PROGRAMADAS
// ============================================================
async function cargarEntregasProgramadas() {
    try {
        const hoy = new Date();
        const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 2, 0);
        
        const response = await fetch(
            `${API_URL}/entregas-planificadas?fecha_desde=${formatDate(primerDiaMes)}&fecha_hasta=${formatDate(ultimoDiaMes)}`,
            { headers: { 'Authorization': `Bearer ${TOKEN}` } }
        );
        
        if (!response.ok) throw new Error('Error al cargar entregas');
        
        entregasProgramadas = await response.json();
        renderizarEventosEnCalendario();
        actualizarEstadisticas();
        
    } catch (error) {
        console.error('Error:', error);
    }
}

// ============================================================
// RENDERIZAR EVENTOS EN CALENDARIO
// ============================================================
function renderizarEventosEnCalendario() {
    // Limpiar eventos existentes
    calendar.removeAllEvents();
    
    // Agregar eventos
    const eventos = entregasProgramadas.map(entrega => {
        const color = getColorPorPrioridad(entrega.prioridad);
        
        return {
            id: entrega.id_planificacion,
            title: `Pedido #${entrega.id_pedido}`,
            start: `${entrega.fecha_programada}T${entrega.hora_inicio || '09:00:00'}`,
            end: entrega.hora_fin ? `${entrega.fecha_programada}T${entrega.hora_fin}` : null,
            backgroundColor: color,
            borderColor: color,
            extendedProps: {
                id_pedido: entrega.id_pedido,
                cliente: entrega.cliente,
                monto: entrega.monto_pedido,
                prioridad: entrega.prioridad,
                zona: entrega.zona_entrega,
                observaciones: entrega.observaciones,
                estado: entrega.estado_actual,
                telefono: entrega.telefono_cliente,
                direccion: entrega.domicilio_entrega || entrega.direccion_cliente
            }
        };
    });
    
    calendar.addEventSource(eventos);
}

// ============================================================
// PROGRAMAR ENTREGA
// ============================================================
async function programarEntrega(pedido, fecha) {
    const { value: formValues } = await Swal.fire({
        title: `Programar entrega - Pedido #${pedido.id_pedido}`,
        html: `
            <div class="text-start">
                <div class="mb-3">
                    <label class="form-label">Cliente</label>
                    <input type="text" class="form-control" value="${pedido.cliente}" disabled>
                </div>
                <div class="mb-3">
                    <label class="form-label">Fecha</label>
                    <input type="date" id="fecha" class="form-control" value="${formatDate(fecha)}">
                </div>
                <div class="row">
                    <div class="col-6">
                        <label class="form-label">Hora inicio</label>
                        <input type="time" id="hora_inicio" class="form-control" value="09:00">
                    </div>
                    <div class="col-6">
                        <label class="form-label">Hora fin</label>
                        <input type="time" id="hora_fin" class="form-control" value="18:00">
                    </div>
                </div>
                <div class="mb-3 mt-3">
                    <label class="form-label">Prioridad</label>
                    <select id="prioridad" class="form-select">
                        <option value="1">1 - Baja</option>
                        <option value="2" selected>2 - Normal</option>
                        <option value="3">3 - Media</option>
                        <option value="4">4 - Alta</option>
                        <option value="5">5 - Urgente</option>
                    </select>
                </div>
                <div class="mb-3">
                    <label class="form-label">Zona de entrega</label>
                    <input type="text" id="zona" class="form-control" placeholder="Ej: Zona Norte">
                </div>
                <div class="mb-3">
                    <label class="form-label">Observaciones</label>
                    <textarea id="observaciones" class="form-control" rows="2"></textarea>
                </div>
            </div>
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Programar',
        cancelButtonText: 'Cancelar',
        preConfirm: () => {
            return {
                fecha: document.getElementById('fecha').value,
                hora_inicio: document.getElementById('hora_inicio').value,
                hora_fin: document.getElementById('hora_fin').value,
                prioridad: document.getElementById('prioridad').value,
                zona: document.getElementById('zona').value,
                observaciones: document.getElementById('observaciones').value
            };
        }
    });
    
    if (formValues) {
        try {
            mostrarCargando(true);
            
            const response = await fetch(`${API_URL}/entregas-planificadas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                },
                body: JSON.stringify({
                    id_pedido: pedido.id_pedido,
                    fecha_programada: formValues.fecha,
                    hora_inicio: formValues.hora_inicio,
                    hora_fin: formValues.hora_fin,
                    prioridad: parseInt(formValues.prioridad),
                    zona_entrega: formValues.zona,
                    observaciones: formValues.observaciones
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error);
            }
            
            Swal.fire('¡Programado!', 'Entrega programada exitosamente', 'success');
            
            // Recargar datos
            await cargarPedidosSinProgramar();
            await cargarEntregasProgramadas();
            
        } catch (error) {
            console.error('Error:', error);
            Swal.fire('Error', error.message, 'error');
        } finally {
            mostrarCargando(false);
        }
    }
}

// ============================================================
// ACTUALIZAR FECHA DE ENTREGA (DRAG & DROP)
// ============================================================
async function actualizarFechaEntrega(event, nuevaFecha) {
    try {
        mostrarCargando(true);
        
        const response = await fetch(`${API_URL}/entregas-planificadas/${event.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                fecha_programada: formatDate(nuevaFecha),
                hora_inicio: nuevaFecha.toTimeString().slice(0, 8)
            })
        });
        
        if (!response.ok) throw new Error('Error al actualizar');
        
        Swal.fire({
            icon: 'success',
            title: 'Actualizado',
            text: 'Fecha de entrega actualizada',
            timer: 1500,
            showConfirmButton: false
        });
        
        await cargarEntregasProgramadas();
        
    } catch (error) {
        console.error('Error:', error);
        Swal.fire('Error', 'No se pudo actualizar la fecha', 'error');
        calendar.refetchEvents();
    } finally {
        mostrarCargando(false);
    }
}

// ============================================================
// MOSTRAR DETALLE DE ENTREGA
// ============================================================
function mostrarDetalleEntrega(event) {
    const props = event.extendedProps;
    
    Swal.fire({
        title: `Pedido #${props.id_pedido}`,
        html: `
            <div class="text-start">
                <p><strong>Cliente:</strong> ${props.cliente}</p>
                <p><strong>Teléfono:</strong> ${props.telefono || 'No disponible'}</p>
                <p><strong>Dirección:</strong> ${props.direccion || 'No especificada'}</p>
                <p><strong>Monto:</strong> $${parseFloat(props.monto).toFixed(2)}</p>
                <p><strong>Prioridad:</strong> ${props.prioridad}</p>
                ${props.zona ? `<p><strong>Zona:</strong> ${props.zona}</p>` : ''}
                ${props.observaciones ? `<p><strong>Observaciones:</strong> ${props.observaciones}</p>` : ''}
                <p><strong>Estado:</strong> <span class="badge bg-primary">${props.estado}</span></p>
            </div>
        `,
        showCancelButton: true,
        showDenyButton: true,
        confirmButtonText: '<i class="bi bi-truck"></i> Realizar Entrega',
        denyButtonText: '<i class="bi bi-trash"></i> Eliminar',
        cancelButtonText: 'Cerrar'
    }).then((result) => {
        if (result.isConfirmed) {
            realizarEntrega(props.id_pedido, event.id);
        } else if (result.isDenied) {
            eliminarProgramacion(event.id);
        }
    });
}

// ============================================================
// REALIZAR ENTREGA
// ============================================================
async function realizarEntrega(idPedido, idPlanificacion) {
    const result = await Swal.fire({
        icon: 'question',
        title: '¿Realizar entrega completa?',
        text: 'Se generará un remito con todos los items pendientes',
        showCancelButton: true,
        confirmButtonText: 'Sí, entregar',
        cancelButtonText: 'Cancelar'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        mostrarCargando(true);
        
        // Entregar todo el pedido
        const response = await fetch(`${API_URL}/pedidos/${idPedido}/entregar-todo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({
                observaciones: 'Entrega desde planificador'
            })
        });
        
        if (!response.ok) throw new Error('Error al entregar');
        
        const data = await response.json();
        
        // Actualizar estado de la planificación
        await fetch(`${API_URL}/entregas-planificadas/${idPlanificacion}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TOKEN}`
            },
            body: JSON.stringify({ estado: 'entregada' })
        });
        
        Swal.fire({
            icon: 'success',
            title: '¡Entrega registrada!',
            html: `
                <p>Remito: ${data.remito.numero_completo}</p>
                <p>Items entregados: ${data.items_entregados}</p>
            `
        });
        
        await cargarPedidosSinProgramar();
        await cargarEntregasProgramadas();
        
    } catch (error) {
        console.error('Error:', error);
        Swal.fire('Error', 'No se pudo realizar la entrega', 'error');
    } finally {
        mostrarCargando(false);
    }
}

// ============================================================
// ELIMINAR PROGRAMACIÓN
// ============================================================
async function eliminarProgramacion(idPlanificacion) {
    const result = await Swal.fire({
        icon: 'warning',
        title: '¿Eliminar programación?',
        text: 'El pedido volverá a la lista de pendientes',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#dc3545'
    });
    
    if (!result.isConfirmed) return;
    
    try {
        mostrarCargando(true);
        
        const response = await fetch(`${API_URL}/entregas-planificadas/${idPlanificacion}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        if (!response.ok) throw new Error('Error al eliminar');
        
        Swal.fire('Eliminado', 'Programación eliminada', 'success');
        
        await cargarPedidosSinProgramar();
        await cargarEntregasProgramadas();
        
    } catch (error) {
        console.error('Error:', error);
        Swal.fire('Error', 'No se pudo eliminar', 'error');
    } finally {
        mostrarCargando(false);
    }
}

// ============================================================
// VER ENTREGAS DEL DÍA
// ============================================================
async function verEntregasDelDia(fecha) {
    try {
        mostrarCargando(true);
        
        const response = await fetch(`${API_URL}/entregas-planificadas/dia/${fecha}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        if (!response.ok) throw new Error('Error al cargar');
        
        const entregas = await response.json();
        
        if (entregas.length === 0) {
            Swal.fire('Sin entregas', 'No hay entregas programadas para este día', 'info');
            return;
        }
        
        const html = `
            <div class="text-start">
                <h6>Entregas programadas: ${entregas.length}</h6>
                <div class="list-group">
                    ${entregas.map(e => `
                        <div class="list-group-item">
                            <div class="d-flex justify-content-between">
                                <strong>Pedido #${e.id_pedido}</strong>
                                <span class="badge bg-primary">${e.hora_inicio}</span>
                            </div>
                            <small>${e.cliente}</small>
                            <br>
                            <small class="text-muted">${e.domicilio_entrega || ''}</small>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        Swal.fire({
            title: `Entregas del ${new Date(fecha).toLocaleDateString()}`,
            html: html,
            width: 600,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-printer"></i> Imprimir',
            cancelButtonText: 'Cerrar'
        }).then((result) => {
            if (result.isConfirmed) {
                imprimirEntregasDia(fecha);
            }
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        mostrarCargando(false);
    }
}

// ============================================================
// IMPRIMIR ENTREGAS DEL DÍA
// ============================================================
async function imprimirDia() {
    const { value: fecha } = await Swal.fire({
        title: 'Selecciona el día',
        input: 'date',
        inputValue: formatDate(new Date()),
        showCancelButton: true,
        confirmButtonText: 'Imprimir'
    });
    
    if (fecha) {
        imprimirEntregasDia(fecha);
    }
}

async function imprimirEntregasDia(fecha) {
    // Esta función se conectará con el generador de PDF
    // Por ahora abrimos una vista de impresión simple
    window.open(`${API_URL}/entregas-planificadas/dia/${fecha}/pdf`, '_blank');
}

// ============================================================
// ACTUALIZAR ESTADÍSTICAS
// ============================================================
function actualizarEstadisticas() {
    const hoy = formatDate(new Date());
    const entregasHoy = entregasProgramadas.filter(e => 
        e.fecha_programada === hoy && e.estado_actual !== 'entregada'
    ).length;
    
    document.getElementById('statHoy').textContent = entregasHoy;
    document.getElementById('statPendientes').textContent = pedidosSinProgramar.length;
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================
function formatDate(date) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getColorPorPrioridad(prioridad) {
    const colores = {
        1: '#6c757d', // Gris
        2: '#0dcaf0', // Info
        3: '#ffc107', // Warning
        4: '#fd7e14', // Orange
        5: '#dc3545'  // Danger
    };
    return colores[prioridad] || '#667eea';
}

function mostrarCargando(mostrar) {
    const overlay = document.getElementById('loadingOverlay');
    if (mostrar) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

function irAEntregas() {
    window.location.href = 'entregas.html';
}

function verListaEntregas() {
    window.location.href = 'remitos.html';
}

function cerrarSesion() {
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
}
