/**
 * ════════════════════════════════════════════════════════════════════════════════
 * FRONTEND: Gestión de Despachos v5
 * ERP LAGO - Document-Driven Delivery System
 * ════════════════════════════════════════════════════════════════════════════════
 */

// ════════════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ════════════════════════════════════════════════════════════════════════════════

let filtroPedidoPeriodo = 'todo';

const Estado = {
    viajeActual: null,
    pedidosDisponibles: [],
    depositos: [],
    depositoSeleccionado: null,
    carga: [], // Items agregados al viaje
    viajes: []
};

const API_BASE = (window.CONFIG?.API_BASE_URL || '/api') + '/despachos';

// ════════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ════════════════════════════════════════════════════════════════════════════════

function getToken() {
    return localStorage.getItem('authToken') || null;
}

async function fetchAPI(endpoint, options = {}) {
    const token = getToken();
    
    const config = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        ...options
    };

    if (options.body && typeof options.body === 'object') {
        config.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, config);
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error en la petición');
    }
    
    return response.json();
}

function mostrarLoading(show = true) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

function mostrarToast(mensaje, tipo = 'success') {
    // Crear toast dinámico
    const toastContainer = document.getElementById('toastContainer') || crearToastContainer();
    
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-white bg-${tipo} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${mensaje}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    toastContainer.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 3000 });
    toast.show();
    
    toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

function crearToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '11000';
    document.body.appendChild(container);
    return container;
}

function formatMoney(amount) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount || 0);
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-AR');
}

function formatTime(timeStr) {
    if (!timeStr) return '-';
    return timeStr.substring(0, 5);
}

/**
 * Escapa HTML para prevenir XSS.
 * Usar SIEMPRE al inyectar datos de usuario en innerHTML.
 */
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Debounce: retrasa la ejecución hasta que paren de llamar.
 */
function debounce(fn, ms = 300) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

// ════════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ════════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    // Verificar autenticación
    if (!verificarAutenticacion()) {
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }

    // Configurar fecha por defecto del nuevo viaje.
    // La fecha del input es SOLO comodidad visual; NO es la fuente de verdad.
    // Si el usuario no la toca, el viaje se fecha en el server (DEFAULT CURRENT_DATE),
    // inmune a pantallas que quedaron abiertas de un dia para el otro.
    (function initFechaViaje() {
        const inp = document.getElementById('viajeNuevoFecha');
        if (!inp) return;
        const pintarHoy = () => {
            const d = new Date();
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            inp.value = `${yyyy}-${mm}-${dd}`;   // fecha LOCAL, nunca toISOString (UTC)
        };
        pintarHoy();
        inp.dataset.touched = '';                // el usuario todavia no la eligio
        inp.addEventListener('change', () => { inp.dataset.touched = '1'; });
        // Si la pantalla revive otro dia y el usuario no toco la fecha, repintamos hoy.
        const refrescarSiVirgen = () => { if (inp.dataset.touched !== '1' && !document.hidden) pintarHoy(); };
        document.addEventListener('visibilitychange', refrescarSiVirgen);
        window.addEventListener('focus', refrescarSiVirgen);
    })();
    

    // Cargar datos iniciales en paralelo
    await Promise.all([
        cargarDepositos(),
        cargarPedidosDisponibles(),
        cargarViajes()
    ]);

    // Event listeners
    configurarEventListeners();
    // Búsqueda global y vistas
    initBusquedaGlobal();
    initToggleVistas();
    initFiltrosViajes();

    // Vista lista por defecto
    setTimeout(() => {
        document.getElementById('btnVistaLista')?.classList.add('active');
        document.getElementById('btnVistaCards')?.classList.remove('active');
        document.getElementById('columnSelector').style.display = 'block';
        renderizarVistaLista();
    }, 100);
});

function configurarEventListeners() {
    // Búsqueda de pedidos
    // Búsqueda con debounce (300ms) + Enter inmediato
    const debouncedBuscarPedidos = debounce(() => cargarPedidosDisponibles(), 300);
    document.getElementById('buscarPedido').addEventListener('keyup', (e) => {
        if (e.key === 'Enter') cargarPedidosDisponibles();
        else if (e.target.value.length >= 3 || e.target.value.length === 0) debouncedBuscarPedidos();
    });

    // Cambio de depósito
    document.getElementById('depositoSeleccionado').addEventListener('change', (e) => {
        Estado.depositoSeleccionado = e.target.value;
    });

    // Crear viaje
    document.getElementById('btnCrearViaje').addEventListener('click', crearViaje);

    // Despachar
    document.getElementById('btnDespachar').addEventListener('click', despacharViaje);

    // Tab de viajes
    document.getElementById('viajes-tab').addEventListener('shown.bs.tab', cargarViajes);

    // Keyboard shortcuts LAGO
    document.addEventListener('keydown', (e) => {
        // No interceptar si estamos en un input/textarea
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
            if (e.key === 'Escape') document.activeElement.blur();
            return;
        }
        switch (e.key) {
            case 'F3':
                e.preventDefault();
                document.getElementById('busquedaGlobal')?.focus();
                break;
            case 'F5':
                e.preventDefault();
                cargarPedidosDisponibles();
                cargarViajes();
                mostrarToast('Datos actualizados', 'info');
                break;
            case 'Escape':
                // Cerrar modales abiertos
                document.querySelectorAll('.modal.show').forEach(m => {
                    bootstrap.Modal.getInstance(m)?.hide();
                });
                document.getElementById('searchResultsDropdown')?.classList.remove('visible');
                break;
            case 'Insert':
                e.preventDefault();
                if (!Estado.viajeActual) crearViaje();
                break;
        }
    });

    // Liquidación - calcular diferencia
    ['liquidarCombustible', 'liquidarOtros'].forEach(id => {
        document.getElementById(id).addEventListener('input', calcularGastosLiquidacion);
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// DEPÓSITOS
// ════════════════════════════════════════════════════════════════════════════════

async function cargarDepositos() {
    try {
        Estado.depositos = await fetchAPI('/depositos');
        
        const select = document.getElementById('depositoSeleccionado');
        select.innerHTML = Estado.depositos.map(d => 
            `<option value="${d.id_deposito}" ${d.es_principal ? 'selected' : ''}>${d.nombre}</option>`
        ).join('');
        
        Estado.depositoSeleccionado = select.value;
    } catch (error) {
        console.error('Error cargando depósitos:', error);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// PEDIDOS DISPONIBLES
// ════════════════════════════════════════════════════════════════════════════════

async function cargarPedidosDisponibles() {
    const container = document.getElementById('pedidosContainerCards');
    const busqueda = document.getElementById('buscarPedido').value;
    
    try {
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div> Cargando...</div>';
        
        let params = '?';
        if (busqueda) params += 'busqueda=' + encodeURIComponent(busqueda) + '&';
        
        // Filtro período
        if (filtroPedidoPeriodo !== 'todo') {
            var hoy = new Date();
            var desde;
            if (filtroPedidoPeriodo === 'hoy') {
                desde = hoy.toISOString().split('T')[0];
            } else if (filtroPedidoPeriodo === 'semana') {
                var inicioSemana = new Date(hoy);
                inicioSemana.setDate(hoy.getDate() - hoy.getDay());
                desde = inicioSemana.toISOString().split('T')[0];
            } else if (filtroPedidoPeriodo === 'mes') {
                desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
            } else if (filtroPedidoPeriodo === 'anio') {
                desde = new Date(hoy.getFullYear(), 0, 1).toISOString().split('T')[0];
            } else if (filtroPedidoPeriodo === 'rango') {
                desde = document.getElementById('pedidoFechaDesde')?.value || '';
                var hasta = document.getElementById('pedidoFechaHasta')?.value || '';
                if (hasta) params += 'fecha_hasta=' + hasta + '&';
            }
            if (desde) params += 'fecha_desde=' + desde + '&';
        }
        params = params.replace(/&$/, '');
        if (params === '?') params = '';
        Estado.pedidosDisponibles = await fetchAPI(`/pedidos-disponibles${params}`);
        
        document.getElementById('contadorPedidos').textContent = Estado.pedidosDisponibles.length;
    // También actualizar vista lista si está activa
    if (typeof VistaEstado !== 'undefined' && VistaEstado.vistaActual === 'lista') {
        renderizarVistaLista();
    }

        
        if (Estado.pedidosDisponibles.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="bi bi-inbox" style="font-size: 3rem;"></i>
                    <p class="mt-2">No hay pedidos con mercadería disponible</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = Estado.pedidosDisponibles.map(p => crearCardPedido(p)).join('');
        
        // Mostrar botón crear viaje si no hay viaje activo
        actualizarUIViaje();
        
    } catch (error) {
        console.error('Error cargando pedidos:', error);
        container.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
    }
}

function crearCardPedido(pedido) {
    const estadoCredito = pedido.estado_credito || 'ok';
    const items = pedido.items || [];
    
    // Badge de estado
    let badgeEstado = '';
    if (estadoCredito === 'moroso') {
        badgeEstado = '<span class="badge-estado badge-moroso">🔴 MOROSO</span>';
    } else if (estadoCredito === 'excede_credito') {
        badgeEstado = '<span class="badge-estado badge-excede">⚠️ EXCEDE CRÉDITO</span>';
    } else {
        badgeEstado = '<span class="badge-estado badge-ok">✅ OK</span>';
    }
    
    // Items del pedido
    const itemsHTML = items.slice(0, 3).map(item => {
        const transitoInfo = item.en_transito > 0 ? 
            `<span class="text-primary small">(${item.en_transito} en viaje)</span>` : '';
        return `
            <div class="item-linea">
                <span>${item.disponible} ${escapeHTML(item.producto)}</span>
                ${transitoInfo}
            </div>
        `;
    }).join('');
    
    const masItems = items.length > 3 ? `<div class="text-muted small">+${items.length - 3} más...</div>` : '';
    
    // Info de tránsito
    const tieneEnTransito = items.some(i => i.en_transito > 0);
    const transitoAlerta = tieneEnTransito ? `
        <div class="info-transito">
            <i class="bi bi-truck"></i> Tiene items en viaje
        </div>
    ` : '';
    
    return `
        <div class="pedido-card ${estadoCredito}" data-pedido-id="${pedido.id_pedido}" onclick="seleccionarPedido(${pedido.id_pedido})">
            <div class="pedido-header">
                <span class="pedido-numero">#${pedido.nro_pedido || pedido.id_pedido}</span>
                ${badgeEstado}
            </div>
            <div class="pedido-cliente">${escapeHTML(pedido.cliente)}</div>
            <div class="pedido-direccion">
                <i class="bi bi-geo-alt"></i> ${escapeHTML(pedido.domicilio_entrega || pedido.domicilio_cliente || 'Sin dirección')}
            </div>
            <div class="pedido-items">
                ${itemsHTML}
                ${masItems}
            </div>
            ${transitoAlerta}
            <div class="pedido-total">${formatMoney(pedido.total)}</div>
            <div class="d-flex gap-2 mt-2">
                <button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); verRemitosDePedido(${pedido.id_pedido})" title="Ver remitos"><i class="bi bi-receipt"></i> Remitos</button>
                <button class="btn btn-sm btn-outline-info" onclick="event.stopPropagation(); abrirTrazabilidad('pedido', ${pedido.id_pedido})" title="Trazabilidad"><i class="bi bi-diagram-3"></i></button>
                <button class="btn btn-sm btn-outline-primary flex-grow-1" onclick="event.stopPropagation(); verDetallePedido(${pedido.id_pedido})">
                    <i class="bi bi-eye"></i> Ver Detalle
                </button>
                <button class="btn btn-sm btn-primary flex-grow-1" onclick="event.stopPropagation(); agregarPedidoAlViaje(${pedido.id_pedido})">
                    <i class="bi bi-plus"></i> Agregar
                </button>
            </div>
        </div>
    `;
}

function seleccionarPedido(idPedido) {
    const card = document.querySelector(`[data-pedido-id="${idPedido}"]`);
    if (card) {
        card.classList.toggle('seleccionado');
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// DETALLE DE PEDIDO
// ════════════════════════════════════════════════════════════════════════════════

async function verDetallePedido(idPedido) {
    try {
        mostrarLoading(true);
        const pedido = await fetchAPI(`/pedido/${idPedido}`);
        
        document.getElementById('modalPedidoNumero').textContent = idPedido;
        
        let html = `
            <div class="mb-3">
                <strong>${pedido.cliente}</strong><br>
                <small class="text-muted">
                    <i class="bi bi-geo-alt"></i> ${pedido.domicilio_entrega || pedido.domicilio_cliente || 'Sin dirección'}
                    ${pedido.telefono ? `<br><i class="bi bi-telephone"></i> ${pedido.telefono}` : ''}
                </small>
            </div>
            <hr>
        `;
        
        // Agrupar items por producto
        for (const item of pedido.items) {
            html += `
                <div class="mb-4">
                    <h6>${item.producto} - Original: <strong>${item.cantidad_original}</strong></h6>
            `;
            
            // Sección ENTREGADO
            if (item.entregado > 0) {
                html += `
                    <div class="detalle-seccion">
                        <div class="detalle-seccion-header">
                            <span class="badge bg-success">✅ ENTREGADO: ${item.entregado}</span>
                        </div>
                `;
                if (item.detalle_entregado) {
                    item.detalle_entregado.forEach(d => {
                        html += `
                            <div class="detalle-item">
                                <span class="detalle-cant">${d.cantidad}</span>
                                <span class="detalle-producto">${item.producto}</span>
                                <span class="detalle-remito">${d.numero_remito} (${formatDate(d.fecha)})</span>
                            </div>
                        `;
                    });
                }
                html += `</div>`;
            }
            
            // Sección EN TRÁNSITO
            if (item.en_transito > 0) {
                html += `
                    <div class="detalle-seccion">
                        <div class="detalle-seccion-header">
                            <span class="badge bg-primary">🚚 EN TRÁNSITO: ${item.en_transito}</span>
                        </div>
                `;
                if (item.detalle_transito) {
                    item.detalle_transito.forEach(d => {
                        html += `
                            <div class="detalle-item">
                                <span class="detalle-cant">${d.cantidad}</span>
                                <span class="detalle-producto">${item.producto}</span>
                                <span class="detalle-remito">${d.numero_remito} - Viaje #${d.id_viaje}</span>
                            </div>
                        `;
                    });
                }
                html += `</div>`;
            }
            
            // Sección DISPONIBLE
            if (item.disponible > 0) {
                html += `
                    <div class="detalle-seccion">
                        <div class="detalle-seccion-header">
                            <span class="badge bg-secondary">📦 DISPONIBLE: ${item.disponible}</span>
                        </div>
                        <div class="text-muted small ps-4">Puede cargarse en un nuevo viaje</div>
                    </div>
                `;
            }
            
            // Barra de progreso
            const porcentaje = Math.round((item.entregado / item.cantidad_original) * 100);
            const porcentajeTransito = Math.round((item.en_transito / item.cantidad_original) * 100);
            html += `
                <div class="progress progress-entrega">
                    <div class="progress-bar bg-success" style="width: ${porcentaje}%" title="Entregado"></div>
                    <div class="progress-bar bg-primary" style="width: ${porcentajeTransito}%" title="En tránsito"></div>
                </div>
                <small class="text-muted">${porcentaje}% entregado</small>
            `;
            
            html += `</div>`;
        }
        
        document.getElementById('modalPedidoBody').innerHTML = html;
        
        // Configurar botón agregar
        document.getElementById('btnAgregarTodoAlViaje').onclick = () => {
            agregarPedidoAlViaje(idPedido);
            bootstrap.Modal.getInstance(document.getElementById('modalDetallePedido')).hide();
        };
        
        new bootstrap.Modal(document.getElementById('modalDetallePedido')).show();
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// VIAJE - CREAR Y GESTIONAR
// ════════════════════════════════════════════════════════════════════════════════

async function crearViaje() {
    try {
        mostrarLoading(true);
        
        const viaje = await fetchAPI('/viajes', {
            method: 'POST',
            body: {
                // Solo enviamos fecha si el usuario la ELIGIO explicitamente (backdate
                // deliberado). Si no la toco -> null y el server estampa el dia real con
                // DEFAULT CURRENT_DATE. Mata los viajes fechados "ayer" por pantalla vieja.
                fecha: (() => {
                    const inp = document.getElementById('viajeNuevoFecha');
                    return (inp && inp.dataset.touched === '1' && inp.value) ? inp.value : null;
                })(),
                chofer: document.getElementById('viajeNuevoChofer').value || null,
                vehiculo: document.getElementById('viajeNuevoVehiculo').value || null
            }
        });
        
        Estado.viajeActual = viaje;
        Estado.carga = [];
        
        actualizarUIViaje();
        mostrarToast('Viaje creado correctamente', 'success');
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

function actualizarUIViaje() {
    const btnCrear = document.getElementById('btnCrearViaje');
    const infoViaje = document.getElementById('viajeActualInfo');
    
    if (Estado.viajeActual) {
        btnCrear.style.display = 'none';
        infoViaje.style.display = 'block';
        document.getElementById('viajeActualId').textContent = Estado.viajeActual.id_viaje;
    } else {
        btnCrear.style.display = 'block';
        infoViaje.style.display = 'none';
    }
    
    actualizarCargaUI();
}

async function cancelarViaje() {
    if (!Estado.viajeActual) return;
    if (!confirm('¿Cancelar el viaje en preparación? Se eliminarán los remitos creados.')) return;
    try {
        mostrarLoading(true);
        await fetchAPI(`/viaje/${Estado.viajeActual.id_viaje}`, { method: 'DELETE' });
        Estado.viajeActual = null;
        Estado.carga = [];
        actualizarUIViaje();
        mostrarToast('Viaje cancelado', 'success');
        cargarPedidosDisponibles();
    } catch (error) {
        mostrarToast(error.message || 'Error al cancelar viaje', 'danger');
    } finally {
        mostrarLoading(false);
    }
}

async function cancelarViajesVacios() {
    if (!confirm('¿Eliminar todos los viajes vacíos (sin remitos)?')) return;
    try {
        mostrarLoading(true);
        const result = await fetchAPI('/viajes-vacios', { method: 'DELETE' });
        mostrarToast(result.message, 'success');
        cargarViajes();
    } catch (error) {
        mostrarToast(error.message || 'Error al eliminar viajes vacíos', 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// CARGA DEL VIAJE
// ════════════════════════════════════════════════════════════════════════════════

async function agregarPedidoAlViaje(idPedido) {
    // Si no hay viaje, crear uno primero
    if (!Estado.viajeActual) {
        await crearViaje();
    }
    
    const pedido = Estado.pedidosDisponibles.find(p => p.id_pedido === idPedido);
    if (!pedido) {
        mostrarToast('Pedido no encontrado', 'danger');
        return;
    }
    
    // Verificar que no esté ya en la carga
    if (Estado.carga.some(c => c.id_pedido === idPedido)) {
        mostrarToast('Este pedido ya está en la carga', 'warning');
        return;
    }
    
    try {
        mostrarLoading(true);
        
        // Preparar items para enviar
        const items = pedido.items.filter(i => i.disponible > 0).map(i => ({
            id_item: i.id_item,
            cantidad: i.disponible,
            id_deposito: Estado.depositoSeleccionado
        }));
        
        const resultado = await fetchAPI(`/viaje/${Estado.viajeActual.id_viaje}/agregar`, {
            method: 'POST',
            body: {
                id_pedido: idPedido,
                items: items
            }
        });
        
        // Actualizar estado local
        Estado.viajeActual = resultado;
        Estado.carga.push({
            id_pedido: idPedido,
            cliente: pedido.cliente,
            direccion: pedido.domicilio_entrega || pedido.domicilio_cliente,
            telefono: pedido.telefono,
            items: pedido.items.filter(i => i.disponible > 0).map(i => ({
                ...i,
                cantidad: i.disponible
            })),
            total: pedido.items.reduce((sum, i) => sum + (i.disponible * i.precio_unitario), 0)
        });
        
        actualizarCargaUI();
        mostrarToast('Pedido agregado al viaje', 'success');
        
        // Marcar como seleccionado
        const card = document.querySelector(`[data-pedido-id="${idPedido}"]`);
        if (card) card.classList.add('seleccionado');
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

function actualizarCargaUI() {
    const container = document.getElementById('cargaItems');
    const placeholder = document.getElementById('cargaPlaceholder');
    const resumen = document.getElementById('cargaResumen');
    const btnDespachar = document.getElementById('btnDespachar');
    const btnVistaPrevia = document.getElementById('btnVistaPrevia');
    
    if (Estado.carga.length === 0) {
        container.innerHTML = '';
        placeholder.style.display = 'block';
        resumen.style.display = 'none';
        btnDespachar.disabled = true;
        btnVistaPrevia.disabled = true;
        document.getElementById('contadorParadas').textContent = '0 paradas';
        return;
    }
    
    placeholder.style.display = 'none';
    resumen.style.display = 'block';
    btnDespachar.disabled = false;
    btnVistaPrevia.disabled = false;
    document.getElementById('contadorParadas').textContent = `${Estado.carga.length} paradas`;
    
    // Renderizar items de carga
    container.innerHTML = Estado.carga.map((c, index) => `
        <div class="carga-item" draggable="true" data-index="${index}">
            <div class="d-flex align-items-center gap-2 mb-2">
                <i class="bi bi-grip-vertical text-muted" style="cursor: grab;"></i>
                <span class="carga-orden">${index + 1}</span>
                <div class="flex-grow-1">
                    <div class="carga-cliente">${escapeHTML(c.cliente)}</div>
                    <div class="carga-direccion"><i class="bi bi-geo-alt"></i> ${escapeHTML(c.direccion) || 'Sin dirección'}</div>
                </div>
                ${c.telefono ? `<span class="badge bg-success">${escapeHTML(c.telefono)}</span>` : ''}
                <button class="btn btn-sm btn-outline-danger" onclick="quitarDelViaje(${c.id_pedido})">
                    <i class="bi bi-x"></i>
                </button>
            </div>
            <div class="carga-items-list">
                ${c.items.map(item => `
                    <div class="carga-item-linea" style="display:flex;align-items:center;gap:4px;">
                        <span class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(item.producto)}">${escapeHTML(item.producto)}</span>
                        <input type="number" class="form-control form-control-sm" style="width:65px;"
                               value="${item.cantidad}"
                               max="${item.disponible}"
                               min="0"
                               data-id-item="${item.id_item}"
                               onchange="actualizarCantidadItem(${c.id_pedido}, ${item.id_item}, this.value)">
                        <span class="small text-muted">/${item.disponible}</span>
                        <button class="btn btn-sm btn-outline-danger p-0" style="width:22px;height:22px;line-height:1;font-size:11px;"
                                onclick="eliminarItemCarga(${c.id_pedido}, ${item.id_item})" title="Quitar item">&times;</button>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');
    
    // Calcular totales
    let totalItems = 0;
    let totalMonto = 0;
    Estado.carga.forEach(c => {
        c.items.forEach(i => {
            totalItems += i.cantidad;
            totalMonto += i.cantidad * i.precio_unitario * (1 + (i.iva_porcentaje || 21) / 100);
        });
    });
    
    document.getElementById('resumenItems').textContent = totalItems;
    document.getElementById('resumenTotal').textContent = formatMoney(totalMonto);
}

async function quitarDelViaje(idPedido) {
    if (!Estado.viajeActual) return;

    // Buscar el remito asociado a este pedido
    const remito = Estado.viajeActual.remitos?.find(r => r.id_pedido === idPedido);

    try {
        if (remito) {
            const respQuitar = await fetchAPI('/viaje/' + Estado.viajeActual.id_viaje + '/remito/' + remito.id_remito, { method: 'DELETE' });
            Estado.viajeActual.remitos = Estado.viajeActual.remitos.filter(r => r.id_pedido !== idPedido);
        }

        Estado.carga = Estado.carga.filter(c => c.id_pedido !== idPedido);
        actualizarCargaUI();

        // Fase 2 (decision UX 1B): si el viaje quedo sin remitos, pedir al backend
        // que lo elimine automaticamente. El backend respeta config
        // 'despachos.quitar_remito.auto_eliminar_viaje_si_vacio'.
        if (Estado.viajeActual && (!Estado.viajeActual.remitos || Estado.viajeActual.remitos.length === 0)) {
            try {
                const autoResp = await fetchAPI('/viaje/' + Estado.viajeActual.id_viaje + '/auto-eliminar-si-vacio', { method: 'POST' });
                if (autoResp && autoResp.eliminado) {
                    const idEliminado = Estado.viajeActual.id_viaje;
                    Estado.viajeActual = null;
                    Estado.carga = [];
                    actualizarUIViaje();
                    mostrarToast('Viaje #' + idEliminado + ' eliminado automaticamente (quedo vacio)', 'info');
                    if (typeof cargarPedidosDisponibles === 'function') cargarPedidosDisponibles();
                }
            } catch (e) {
                console.warn('[despachos] auto-eliminar-si-vacio fallo (no bloqueante):', e && e.message);
            }
        }

        const card = document.querySelector('[data-pedido-id="' + idPedido + '"]');
        if (card) card.classList.remove('seleccionado');

        mostrarToast('Pedido quitado del viaje', 'info');
        await cargarPedidosDisponibles();
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    }
}

function actualizarCantidadItem(idPedido, idItem, nuevaCantidad) {
    const carga = Estado.carga.find(c => c.id_pedido === idPedido);
    if (carga) {
        const item = carga.items.find(i => i.id_item === idItem);
        if (item) {
            const cant = parseInt(nuevaCantidad) || 0;
            if (cant < 1) {
                mostrarToast('La cantidad debe ser al menos 1', 'warning');
                return;
            }
            item.cantidad = cant;
            actualizarCargaUI();
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// DESPACHAR
// ════════════════════════════════════════════════════════════════════════════════

async function despacharViaje() {
    if (!Estado.viajeActual || Estado.carga.length === 0) {
        mostrarToast('No hay items para despachar', 'warning');
        return;
    }
    if (!confirm(`¿Despachar viaje #${Estado.viajeActual.id_viaje} con ${Estado.carga.length} paradas?`)) return;
    try {
        mostrarLoading(true);
        // Preparar items con cantidades editadas
        // Incluir todos los items: los actuales con su cantidad, y los eliminados con 0
        const itemsActualizados = [];
        Estado.carga.forEach(c => {
            c.items.forEach(item => {
                itemsActualizados.push({
                    id_pedido: c.id_pedido,
                    id_item: item.id_item,
                    cantidad: item.cantidad
                });
            });
            // Items eliminados: enviar con cantidad 0 para que el backend los borre
            if (c._itemsEliminados) {
                c._itemsEliminados.forEach(idItem => {
                    itemsActualizados.push({
                        id_pedido: c.id_pedido,
                        id_item: idItem,
                        cantidad: 0
                    });
                });
            }
        });
        const resultado = await fetchAPI(`/viaje/${Estado.viajeActual.id_viaje}/despachar`, {
            method: 'POST',
            body: {
                hora_salida: new Date().toTimeString().slice(0, 5),
                items: itemsActualizados
            }
        });
        mostrarToast('Viaje despachado correctamente', 'success');
        
        // Imprimir TODOS los remitos del viaje en 1 solo PDF
        if (resultado.viaje && resultado.viaje.id_viaje) {
            imprimirViaje(resultado.viaje.id_viaje);
            // Mostrar modal post-despacho con botones individuales
            mostrarModalPostDespacho(resultado.viaje);
        }
        // Limpiar estado
        Estado.viajeActual = null;
        Estado.carga = [];
        actualizarUIViaje();
        await cargarPedidosDisponibles();
        document.getElementById('viajes-tab').click();
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}
// Buscador en memoria sobre viajes cargados
let _debounceBusqViajes = null;
function filtrarViajesBusqueda(termino) {
    FiltroViajes.busqueda = (termino || '').trim();
    // Busqueda en BACKEND (no en memoria): el filtro corre en SQL sobre todo
    // el rango de fechas, y el limite cuenta sobre el resultado ya filtrado.
    if (_debounceBusqViajes) clearTimeout(_debounceBusqViajes);
    _debounceBusqViajes = setTimeout(() => { cargarViajes(); }, 300);
}

function renderViajesFiltrados() {
    const container = document.getElementById('viajesContainer');
    if (!container) return;
    const q = (FiltroViajes.busqueda || '').toLowerCase();

    let viajesFiltrados = Estado.viajes || [];
    if (q) {
        viajesFiltrados = viajesFiltrados.map(v => {
            const remitosFiltrados = (v.remitos || []).filter(r => {
                const campos = [
                    r.numero_completo || '',
                    r.cliente || '',
                    r.telefono || '',
                    String(r.id_pedido || ''),
                    String(r.id_remito || '')
                ].join(' ').toLowerCase();
                return campos.includes(q);
            });
            if (String(v.id_viaje).includes(q) || (v.chofer || '').toLowerCase().includes(q)) {
                return v;
            }
            if (remitosFiltrados.length === 0) return null;
            return { ...v, remitos: remitosFiltrados };
        }).filter(v => v !== null);
    }

    if (viajesFiltrados.length === 0) {
        container.innerHTML = q
            ? '<div class="text-center text-muted py-4"><i class="bi bi-search" style="font-size:2rem;"></i><p class="mt-2">Sin resultados para "' + escapeHTML(q) + '"</p></div>'
            : '<div class="text-center text-muted py-5"><i class="bi bi-calendar-x" style="font-size:3rem;"></i><p class="mt-2">No hay viajes para este período</p></div>';
        return;
    }
    container.innerHTML = viajesFiltrados.map(v => crearCardViaje(v)).join('');
}

async function cargarViajes() {
    const container = document.getElementById('viajesContainer');
    const { desde, hasta } = calcularRangoFechas();
    
    try {
        container.innerHTML = '<div class="text-center py-4"><div class="spinner-border spinner-border-sm"></div> Cargando...</div>';
        
        let params = '?';
        if (desde) params += `fecha_desde=${desde}&`;
        if (hasta) params += `fecha_hasta=${hasta}&`;
        if (FiltroViajes.estado) params += `estado=${FiltroViajes.estado}&`;
        if (FiltroViajes.busqueda && FiltroViajes.busqueda.length >= 2) {
            params += `q=${encodeURIComponent(FiltroViajes.busqueda)}&`;
        }
        
        Estado.viajes = await fetchAPI(`/viajes${params}`);
        
        // Actualizar badge de viajes en ruta
        const enRuta = Estado.viajes.filter(v => v.estado === 'en_ruta').length;
        const badge = document.getElementById('badgeViajesEnRuta');
        if (badge) badge.textContent = enRuta;
        
        // Actualizar resumen
        actualizarResumenViajes(Estado.viajes.length);
        
        if (Estado.viajes.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="bi bi-calendar-x" style="font-size: 3rem;"></i>
                    <p class="mt-2">No hay viajes para este período</p>
                </div>
            `;
            return;
        }
        renderViajesFiltrados();
    } catch (error) {
        console.error('Error cargando viajes:', error);
        container.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
    }
}

function crearCardViaje(viaje) {
    const remitos = viaje.remitos || [];
    
    // Badge de estado
    const estadoBadges = {
        'preparando': '<span class="badge bg-warning text-dark">PREPARANDO</span>',
        'en_ruta': '<span class="badge bg-primary">EN RUTA</span>',
        'finalizado': '<span class="badge bg-success">FINALIZADO</span>',
        'liquidado': '<span class="badge bg-secondary">LIQUIDADO</span>'
    };
    
    // Botones según estado
    let botones = '';
    if (viaje.estado === 'preparando') {
        botones = `
            <button class="btn btn-primary btn-sm" onclick="continuarPreparando(${viaje.id_viaje})">
                <i class="bi bi-pencil"></i> Continuar
            </button>
        `;
    } else if (viaje.estado === 'en_ruta') {
        const menuRemitos = remitos.map(r =>
            '<li><a class="dropdown-item" href="#" onclick="event.preventDefault();imprimirRemito(' + r.id_remito + ')">' +
            '<i class="bi bi-receipt"></i> ' + escapeHTML(r.numero_completo) + ' - ' + escapeHTML(r.cliente) + '</a></li>'
        ).join('');
        botones = `
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-primary" onclick="imprimirViaje(${viaje.id_viaje})">
                    <i class="bi bi-printer"></i> Imprimir todo
                </button>
                <button class="btn btn-outline-primary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown"></button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><h6 class="dropdown-header">Remitos individuales</h6></li>
                    ${menuRemitos}
                </ul>
            </div>
            <button class="btn btn-success btn-sm" onclick="abrirRegistrarRegreso(${viaje.id_viaje})">
                <i class="bi bi-clipboard-check"></i> Registrar Regreso
            </button>
        `;
    } else if (viaje.estado === 'finalizado') {
        const menuRemitosFin = remitos.map(r =>
            '<li><a class="dropdown-item" href="#" onclick="event.preventDefault();imprimirRemito(' + r.id_remito + ')">' +
            '<i class="bi bi-receipt"></i> ' + escapeHTML(r.numero_completo) + ' - ' + escapeHTML(r.cliente) + '</a></li>'
        ).join('');
        botones = `
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-primary" onclick="imprimirViaje(${viaje.id_viaje})">
                    <i class="bi bi-printer"></i> Reimprimir
                </button>
                <button class="btn btn-outline-primary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown"></button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><h6 class="dropdown-header">Remitos individuales</h6></li>
                    ${menuRemitosFin}
                </ul>
            </div>
            <button class="btn btn-warning btn-sm" onclick="abrirLiquidar(${viaje.id_viaje})">
                <i class="bi bi-cash-stack"></i> Liquidar
            </button>
            <button class="btn btn-outline-secondary btn-sm" onclick="verDetalleViaje(${viaje.id_viaje})">
                <i class="bi bi-eye"></i> Ver
            </button>
        `;
    } else {
        const menuRemitosOtro = remitos.map(r =>
            '<li><a class="dropdown-item" href="#" onclick="event.preventDefault();imprimirRemito(' + r.id_remito + ')">' +
            '<i class="bi bi-receipt"></i> ' + escapeHTML(r.numero_completo) + ' - ' + escapeHTML(r.cliente) + '</a></li>'
        ).join('');
        botones = `
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-primary" onclick="imprimirViaje(${viaje.id_viaje})">
                    <i class="bi bi-printer"></i> Reimprimir
                </button>
                <button class="btn btn-outline-primary dropdown-toggle dropdown-toggle-split" data-bs-toggle="dropdown"></button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><h6 class="dropdown-header">Remitos individuales</h6></li>
                    ${menuRemitosOtro}
                </ul>
            </div>
            <button class="btn btn-outline-secondary btn-sm" onclick="verDetalleViaje(${viaje.id_viaje})">
                <i class="bi bi-eye"></i> Ver Detalle
            </button>
        `;
    }
    
    // Remitos — data grid con columnas definidas
    const fmtFechaRemito = (f) => {
        if (!f) return '-';
        const d = new Date(f);
        if (isNaN(d.getTime())) return '-';
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const hh = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return dd + '/' + mm + ' ' + hh + ':' + mi;
    };

    const filasRemitos = remitos.map(r => {
        const saldo = parseFloat(r.saldo || 0);
        const estaCobrado = saldo <= 1;
        const estadoHTML = estaCobrado
            ? '<span class="badge bg-success-subtle text-success border border-success-subtle"><i class="bi bi-check-circle-fill"></i> PAGADO</span>'
            : '<span class="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold">COBRAR ' + formatMoney(saldo) + '</span>';

        const iconoEstado = r.estado === 'entregado' ? '<span title="Entregado" style="font-size:14px;">✅</span>'
            : r.estado === 'parcial' ? '<span title="Parcial" style="font-size:14px;">⚠️</span>'
            : r.estado === 'no_entregado' ? '<span title="No entregado" style="font-size:14px;">❌</span>'
            : '';

        const btnImprimir = '<a href="#" onclick="event.preventDefault();event.stopPropagation();imprimirRemito(' + r.id_remito + ')" class="text-primary text-decoration-none me-2" title="Imprimir remito"><i class="bi bi-printer"></i></a>';
        const btnEditarObs = '<a href="#" onclick="event.preventDefault();event.stopPropagation();abrirModalEditarObs(' + r.id_remito + ')" class="text-success text-decoration-none me-2" title="Editar observaciones"><i class="bi bi-pencil-square"></i></a>';
        const btnCobrar = !estaCobrado
            ? '<a href="#" onclick="event.preventDefault();event.stopPropagation();abrirModalCobro(' + r.id_remito + ',' + r.id_pedido + ',\'' + escapeHTML(r.numero_completo) + '\',' + saldo.toFixed(2) + ',\'' + escapeHTML(r.cliente || '') + '\')" class="text-danger text-decoration-none fw-bold" title="Cobrar $' + formatMoney(saldo) + '"><i class="bi bi-cash-coin"></i></a>'
            : '';

        return '<tr class="despacho-remito-row">' +
            '<td class="text-center" style="width:90px;">' + btnImprimir + btnEditarObs + btnCobrar + '</td>' +
            '<td class="fw-semibold" style="width:140px;">' + escapeHTML(r.numero_completo) + '</td>' +
            '<td class="text-center text-muted small" style="width:100px;">' + fmtFechaRemito(r.fecha_emision) + '</td>' +
            '<td class="text-center" style="width:80px;"><span class="text-muted">#</span>' + r.id_pedido + '</td>' +
            '<td class="text-truncate" style="max-width:280px;" title="' + escapeHTML(r.cliente || '') + '">' + escapeHTML(r.cliente || '-') + '</td>' +
            '<td class="text-end" style="width:110px;">' + formatMoney(r.total) + '</td>' +
            '<td class="text-end" style="width:180px;">' + estadoHTML + '</td>' +
            '<td class="text-center" style="width:30px;">' + iconoEstado + '</td>' +
        '</tr>';
    }).join('');

    const tablaRemitos = remitos.length === 0
        ? '<div class="text-muted text-center py-3">Sin remitos</div>'
        : '<div class="table-responsive">' +
          '<table class="table table-sm table-hover mb-0 despacho-grid">' +
            '<thead class="table-light">' +
              '<tr>' +
                '<th class="text-center" style="width:70px;">Acciones</th>' +
                '<th style="width:140px;">Remito</th>' +
                '<th class="text-center" style="width:100px;">Fecha</th>' +
                '<th class="text-center" style="width:80px;">Pedido</th>' +
                '<th>Cliente</th>' +
                '<th class="text-end" style="width:110px;">Total</th>' +
                '<th class="text-end" style="width:180px;">Estado pago</th>' +
                '<th class="text-center" style="width:30px;"></th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' + filasRemitos + '</tbody>' +
          '</table>' +
          '</div>';

    return `
        <div class="viaje-card mb-3">
            <div class="viaje-header ${viaje.estado}">
                <div>
                    <strong><i class="bi bi-truck"></i> VIAJE #${viaje.id_viaje}</strong>
                    ${estadoBadges[viaje.estado] || ''}
                    ${viaje.chofer ? `<small class="text-muted ms-2">Chofer: ${escapeHTML(viaje.chofer)}</small>` : ''}
                </div>
                <div class="text-end">
                    ${viaje.hora_salida ? `<div class="small">Salió: <strong>${formatTime(viaje.hora_salida)}</strong></div>` : ''}
                    ${viaje.hora_regreso ? `<div class="small">Volvió: <strong>${formatTime(viaje.hora_regreso)}</strong></div>` : ''}
                </div>
            </div>
            <div class="viaje-body p-0">
                ${tablaRemitos}
            </div>
            <div class="viaje-footer d-flex justify-content-between align-items-center px-3 py-2 bg-light border-top">
                <div class="small text-muted">
                    <i class="bi bi-geo-alt"></i> ${remitos.length} paradas
                    &nbsp;|&nbsp;
                    Total: <strong class="text-dark">${formatMoney(viaje.total_viaje)}</strong>
                    ${viaje.efectivo_recaudado > 0 ? ' &nbsp;|&nbsp; Efectivo: <strong class="text-success">' + formatMoney(viaje.efectivo_recaudado) + '</strong>' : ''}
                </div>
                <div class="d-flex gap-2">
                    ${botones}
                </div>
            </div>
        </div>
    `;
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRAR REGRESO
// ════════════════════════════════════════════════════════════════════════════════

async function abrirRegistrarRegreso(idViaje) {
    try {
        mostrarLoading(true);
        const viaje = await fetchAPI(`/viaje/${idViaje}`);
        
        document.getElementById('modalRegresoViajeId').textContent = idViaje;
        
        let html = `
            <div class="mb-3">
                <label class="form-label">Hora de Regreso</label>
                <input type="time" class="form-control" id="regresoHora" value="${new Date().toTimeString().slice(0, 5)}">
            </div>
            <hr>
        `;
        
        // Crear formulario para cada remito
        viaje.remitos.forEach((remito, idx) => {
            const items = remito.items || [];
            
            html += `
                <div class="registro-remito" data-remito-id="${remito.id_remito}">
                    <div class="registro-header">
                        <div>
                            <strong>${escapeHTML(remito.numero_completo)}</strong> | ${escapeHTML(remito.cliente)}
                            ${parseFloat(remito.saldo_pendiente || 0) > 1 ? ' | <span style="color:#c62828;font-weight:bold">COBRAR ' + formatMoney(remito.saldo_pendiente) + '</span>' : ' | <span style="color:#2e7d32;font-weight:bold">PAGADO ✓</span>'}
                        </div>
                        <span class="badge bg-secondary" id="badgeEstado${remito.id_remito}">PENDIENTE</span>
                    </div>
                    <div class="registro-body">
                        <table class="table table-sm mb-3">
                            <thead class="table-light">
                                <tr>
                                    <th>Producto</th>
                                    <th class="text-center" style="width: 80px;">Despachó</th>
                                    <th class="text-center" style="width: 100px;">Entregó</th>
                                    <th class="text-center" style="width: 80px;">Volvió</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${items.map(item => `
                                    <tr data-item-id="${item.id_item}">
                                        <td>${escapeHTML(item.producto)}</td>
                                        <td class="text-center">${item.cantidad}</td>
                                        <td class="text-center">
                                            <input type="number" inputmode="decimal" step="any" class="form-control form-control-sm text-center entrega-input" 
                                                   value="${item.cantidad}" 
                                                   max="${item.cantidad}"
                                                   min="0"
                                                   data-cantidad-original="${item.cantidad}"
                                                   onfocus="this.select()" oninput="actualizarDevolucion(this)">
                                        </td>
                                        <td class="text-center text-danger devolucion-cell">0</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        
                        <div class="row">
                            <div class="col-md-6">
                                <div class="estado-radio">
                                    <div class="form-check">
                                        <input class="form-check-input" type="radio" name="estado${remito.id_remito}" 
                                               id="entregado${remito.id_remito}" value="entregado" checked
                                               onchange="actualizarEstadoRemito(${remito.id_remito}, 'entregado')">
                                        <label class="form-check-label" for="entregado${remito.id_remito}">✅ Entregado</label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="radio" name="estado${remito.id_remito}" 
                                               id="parcial${remito.id_remito}" value="parcial"
                                               onchange="actualizarEstadoRemito(${remito.id_remito}, 'parcial')">
                                        <label class="form-check-label" for="parcial${remito.id_remito}">⚠️ Parcial</label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="radio" name="estado${remito.id_remito}" 
                                               id="no_entregado${remito.id_remito}" value="no_entregado"
                                               onchange="actualizarEstadoRemito(${remito.id_remito}, 'no_entregado')">
                                        <label class="form-check-label" for="no_entregado${remito.id_remito}">❌ No entregado</label>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="mb-2">
                                    <input type="text" class="form-control form-control-sm motivo-input" 
                                           placeholder="Motivo devolución (si aplica)">
                                </div>
                                <div class="mb-1">
                                    <small class="text-muted fw-bold">Forma de pago:</small>
                                    <div class="d-flex flex-wrap gap-1 mt-1">
                                        <button type="button" class="btn btn-sm btn-outline-success fp-regreso-btn" data-metodo="1" onclick="seleccionarFPRegreso(this)"><i class="bi bi-cash-stack"></i> Efect.</button>
                                        <button type="button" class="btn btn-sm btn-outline-info fp-regreso-btn" data-metodo="2" onclick="seleccionarFPRegreso(this)"><i class="bi bi-phone"></i> MP</button>
                                        <button type="button" class="btn btn-sm btn-outline-primary fp-regreso-btn" data-metodo="3" onclick="seleccionarFPRegreso(this)"><i class="bi bi-bank"></i> Transf.</button>
                                        <button type="button" class="btn btn-sm btn-outline-warning fp-regreso-btn" data-metodo="4" onclick="seleccionarFPRegreso(this)"><i class="bi bi-credit-card"></i> Créd.</button>
                                        <button type="button" class="btn btn-sm btn-outline-warning fp-regreso-btn" data-metodo="5" onclick="seleccionarFPRegreso(this)"><i class="bi bi-credit-card-2-front"></i> Déb.</button>
                                    </div>
                                    <input type="hidden" class="fp-metodo-input" value="">
                                </div>
                                <div class="input-group input-group-sm">
                                    <span class="input-group-text">💵 Cobró $</span>
                                    <input type="number" class="form-control efectivo-input" value="0" 
                                           onchange="calcularEfectivoTotal()">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        document.getElementById('modalRegresoBody').innerHTML = html;
        
        // Configurar botón confirmar
        document.getElementById('btnConfirmarRegreso').onclick = () => confirmarRegreso(idViaje);
        
        calcularEfectivoTotal();
        
        new bootstrap.Modal(document.getElementById('modalRegistrarRegreso')).show();
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

function actualizarDevolucion(input) {
    const row = input.closest('tr');
    const cantidadOriginal = parseFloat(input.dataset.cantidadOriginal) || 0;
    let cantidadEntregada = parseFloat(input.value);
    if (isNaN(cantidadEntregada)) cantidadEntregada = 0;
    // Clamp al rango logico [0, despachado]: no se entrega mas de lo que salio ni negativo.
    if (cantidadEntregada > cantidadOriginal) { cantidadEntregada = cantidadOriginal; input.value = cantidadOriginal; }
    else if (cantidadEntregada < 0) { cantidadEntregada = 0; input.value = 0; }
    const devolucion = cantidadOriginal - cantidadEntregada;
    
    row.querySelector('.devolucion-cell').textContent = devolucion > 0 ? devolucion : 0;
    
    // Actualizar estado automáticamente
    const remito = input.closest('.registro-remito');
    const remitoId = remito.dataset.remitoId;
    
    // Verificar si hay devoluciones
    const inputs = remito.querySelectorAll('.entrega-input');
    let todoEntregado = true;
    let nadaEntregado = true;
    
    inputs.forEach(inp => {
        const orig = parseFloat(inp.dataset.cantidadOriginal) || 0;
        const entr = parseFloat(inp.value) || 0;
        if (entr < orig) todoEntregado = false;
        if (entr > 0) nadaEntregado = false;
    });
    
    if (todoEntregado) {
        document.getElementById(`entregado${remitoId}`).checked = true;
        actualizarEstadoRemito(remitoId, 'entregado');
    } else if (nadaEntregado) {
        document.getElementById(`no_entregado${remitoId}`).checked = true;
        actualizarEstadoRemito(remitoId, 'no_entregado');
    } else {
        document.getElementById(`parcial${remitoId}`).checked = true;
        actualizarEstadoRemito(remitoId, 'parcial');
    }
}

function actualizarEstadoRemito(remitoId, estado) {
    const badge = document.getElementById(`badgeEstado${remitoId}`);
    const estados = {
        'entregado': { class: 'bg-success', text: '✅ ENTREGADO' },
        'parcial': { class: 'bg-warning text-dark', text: '⚠️ PARCIAL' },
        'no_entregado': { class: 'bg-danger', text: '❌ NO ENTREGADO' }
    };
    
    badge.className = `badge ${estados[estado].class}`;
    badge.textContent = estados[estado].text;
    
    // Si es no_entregado, poner todos los inputs en 0
if (estado === 'no_entregado') {
        const remito = document.querySelector(`[data-remito-id="${remitoId}"]`);
        remito.querySelectorAll('.entrega-input').forEach(inp => {
            inp.value = 0;
            const row = inp.closest('tr');
            const orig = parseFloat(inp.dataset.cantidadOriginal) || 0;
            row.querySelector('.devolucion-cell').textContent = orig;
        });
    }
}

function calcularEfectivoTotal() {
    const inputs = document.querySelectorAll('.efectivo-input');
    let total = 0;
    inputs.forEach(inp => total += parseFloat(inp.value) || 0);
    document.getElementById('modalRegresoEfectivo').textContent = total.toLocaleString('es-AR');
}

function seleccionarFPRegreso(btn) {
    const container = btn.closest('.registro-remito');
    container.querySelectorAll('.fp-regreso-btn').forEach(b => b.classList.remove('active', 'btn-success', 'btn-info', 'btn-primary', 'btn-warning'));
    btn.classList.add('active');
    container.querySelector('.fp-metodo-input').value = btn.dataset.metodo;
}

async function confirmarRegreso(idViaje) {
    try {
        mostrarLoading(true);
        
        // Recolectar datos de cada remito
        const remitosData = [];
        document.querySelectorAll('.registro-remito').forEach(remitoEl => {
            const remitoId = remitoEl.dataset.remitoId;
            const estado = document.querySelector(`input[name="estado${remitoId}"]:checked`).value;
            const efectivo = parseFloat(remitoEl.querySelector('.efectivo-input').value) || 0;
            const motivo = remitoEl.querySelector('.motivo-input').value;
            
            const items = [];
            remitoEl.querySelectorAll('tr[data-item-id]').forEach(row => {
                items.push({
                    id_item: parseInt(row.dataset.itemId),
                    cantidad_entregada: parseFloat(row.querySelector('.entrega-input').value) || 0,
                    motivo_devolucion: motivo
                });
            });
            
            remitosData.push({
                id_remito: parseInt(remitoId),
                estado,
                efectivo_cobrado: efectivo,
                items
            });
        });
        
        await fetchAPI(`/viaje/${idViaje}/registrar-regreso`, {
            method: 'POST',
            body: {
                hora_regreso: document.getElementById('regresoHora').value,
                remitos: remitosData
            }
        });
        
        bootstrap.Modal.getInstance(document.getElementById('modalRegistrarRegreso')).hide();
        mostrarToast('Regreso registrado correctamente', 'success');
        await cargarViajes();
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// LIQUIDAR CAJA
// ════════════════════════════════════════════════════════════════════════════════

async function abrirLiquidar(idViaje) {
    const viaje = Estado.viajes.find(v => v.id_viaje === idViaje);
    if (!viaje) return;

    document.getElementById('modalLiquidarViajeId').textContent = idViaje;
    document.getElementById('liquidarCombustible').value = 0;
    document.getElementById('liquidarOtros').value = 0;
    document.getElementById('liquidarDescripcion').value = '';
    calcularGastosLiquidacion();

    document.getElementById('btnConfirmarLiquidacion').onclick = () => confirmarLiquidacion(idViaje);

    new bootstrap.Modal(document.getElementById('modalLiquidar')).show();
}

function calcularGastosLiquidacion() {
    const combustible = parseFloat(document.getElementById('liquidarCombustible').value) || 0;
    const otros = parseFloat(document.getElementById('liquidarOtros').value) || 0;
    document.getElementById('liquidarTotalGastos').textContent = formatMoney(combustible + otros);
}

async function confirmarLiquidacion(idViaje) {
    try {
        mostrarLoading(true);
        
        await fetchAPI(`/viaje/${idViaje}/liquidar`, {
            method: 'POST',
            body: {
                gastos_combustible: parseFloat(document.getElementById('liquidarCombustible').value) || 0,
                gastos_otros: parseFloat(document.getElementById('liquidarOtros').value) || 0,
                gastos_descripcion: document.getElementById('liquidarDescripcion').value
            }
        });
        
        bootstrap.Modal.getInstance(document.getElementById('modalLiquidar')).hide();
        mostrarToast('Viaje liquidado correctamente', 'success');
        await cargarViajes();
        
    } catch (error) {
        mostrarToast('Error: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ════════════════════════════════════════════════════════════════════════════════

async function verDetalleViaje(idViaje) {
    // TODO: Implementar modal de detalle
    mostrarToast('Ver detalle viaje #' + idViaje, 'info');
}

async function continuarPreparando(idViaje) {
    try {
        mostrarLoading(true);
        // Cargar viaje completo con remitos
        const viaje = await fetchAPI(`/viaje/${idViaje}`);
        Estado.viajeActual = viaje;
        
        // Convertir remitos a formato de carga
        Estado.carga = [];
        if (viaje.remitos && viaje.remitos.length > 0) {
            for (const remito of viaje.remitos) {
                const cargaItem = {
                    id_pedido: remito.id_pedido,
                    id_remito: remito.id_remito,
                    cliente: remito.cliente,
                    direccion: remito.domicilio || remito.direccion_entrega,
                    items: remito.items ? remito.items.map(i => ({
                        id_item: i.id_pedido_item || i.id_item,
                        id_producto: i.id_producto,
                        descripcion: i.descripcion,
                        cantidad: parseFloat(i.cantidad),
                        disponible: parseFloat(i.cantidad),
                        precio_unitario: parseFloat(i.precio_unitario || 0)
                    })) : []
                };
                Estado.carga.push(cargaItem);
            }
        }
        
        // Cambiar a tab armar
        document.getElementById('armar-tab').click();
        actualizarUIViaje();
        actualizarCargaUI();
        mostrarToast(`Viaje #${idViaje} cargado con ${Estado.carga.length} parada(s)`, 'info');
    } catch (error) {
        mostrarToast('Error al cargar viaje: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// IMPRESIÓN DE REMITOS
// ════════════════════════════════════════════════════════════════════════════════

let plantillaConfig = null;

async function cargarConfigPlantilla() {
    if (!plantillaConfig) {
        plantillaConfig = await fetchAPI('/plantilla/config');
    }
    return plantillaConfig;
}

// [ELIMINADO] formatearNumero y formatearFecha — solo se usaban en generarHTMLRemito (eliminado)

async function imprimirRemito(idRemito) {
    try {
        mostrarLoading(true);
        const token = localStorage.getItem("authToken");
        const url = (window.CONFIG?.API_BASE_URL || "/api") + "/despachos/remito/" + idRemito + "/html?token=" + token;
        window.open(url, "_blank");
    } catch (error) {
        console.error("Error al imprimir:", error);
        mostrarToast("Error al imprimir: " + error.message, "danger");
    } finally {
        mostrarLoading(false);
    }
}

// [ELIMINADO] generarHTMLRemito — 356 líneas removidas
// La impresión de remitos se hace 100% server-side via remito-pdf.controller.js
// Endpoint: GET /api/despachos/remito/:id/html

// Función para imprimir todos los remitos de un viaje
async function imprimirRemitosViaje(idViaje) {
    try {
        mostrarLoading(true);
        
        // Obtener viaje con sus remitos
        const viaje = await fetchAPI(`/viaje/${idViaje}`);
        
        if (!viaje.remitos || viaje.remitos.length === 0) {
            mostrarToast('El viaje no tiene remitos para imprimir', 'warning');
            return;
        }
        
        // Imprimir cada remito
        for (const remito of viaje.remitos) {
            await imprimirRemito(remito.id_remito);
        }
        
    } catch (error) {
        console.error('Error al imprimir remitos:', error);
        mostrarToast('Error al imprimir: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// FILTROS MODERNOS DE VIAJES
// ════════════════════════════════════════════════════════════════════════════════

const FiltroViajes = {
    periodo: 'hoy',
    estado: '',
    fechaDesde: null,
    fechaHasta: null,
    busqueda: ''
};

function initFiltrosViajes() {
    // Listeners para botones de período
    document.querySelectorAll('.filtro-periodo').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filtro-periodo').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            FiltroViajes.periodo = this.dataset.periodo;
            cerrarRangoPersonalizado();
            cargarViajes();
        });
    });
    
    // Listeners para botones de estado
    document.querySelectorAll('.filtro-estado').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.filtro-estado').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            FiltroViajes.estado = this.dataset.estado;
            cargarViajes();
        });
    });
    
    // Botón rango personalizado
    document.getElementById('btnRangoPersonalizado')?.addEventListener('click', toggleRangoPersonalizado);
    
    // Inicializar fechas del rango
    const hoy = new Date().toISOString().split('T')[0];
    const fechaDesde = document.getElementById('filtroFechaDesde');
    const fechaHasta = document.getElementById('filtroFechaHasta');
    if (fechaDesde) fechaDesde.value = hoy;
    if (fechaHasta) fechaHasta.value = hoy;
}

function toggleRangoPersonalizado() {
    const rangoDiv = document.getElementById('rangoPersonalizado');
    rangoDiv?.classList.toggle('d-none');
}

function cerrarRangoPersonalizado() {
    const rangoDiv = document.getElementById('rangoPersonalizado');
    rangoDiv?.classList.add('d-none');
}

function aplicarRangoPersonalizado() {
    const desde = document.getElementById('filtroFechaDesde')?.value;
    const hasta = document.getElementById('filtroFechaHasta')?.value;
    
    if (!desde || !hasta) {
        mostrarToast('Seleccioná ambas fechas', 'warning');
        return;
    }
    
    if (desde > hasta) {
        mostrarToast('La fecha desde no puede ser mayor a hasta', 'warning');
        return;
    }
    
    FiltroViajes.fechaDesde = desde;
    FiltroViajes.fechaHasta = hasta;
    FiltroViajes.periodo = 'personalizado';
    
    // Desactivar botones de período
    document.querySelectorAll('.filtro-periodo').forEach(b => b.classList.remove('active'));
    
    cargarViajes();
}

function calcularRangoFechas() {
    const hoy = new Date();
    let desde, hasta;
    
    // Helper: formato YYYY-MM-DD en hora LOCAL (no UTC) para evitar off-by-one
    const fmtDateLocal = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        return y + '-' + m + '-' + dd;
    };
    switch (FiltroViajes.periodo) {
        case 'hoy':
            desde = hasta = fmtDateLocal(hoy);
            break;
        case 'semana':
            // Lunes de esta semana (getDay: 0=Dom, 1=Lun, ..., 6=Sab)
            const inicioSemana = new Date(hoy);
            const diaSemana = hoy.getDay();
            const diffLunes = diaSemana === 0 ? -6 : (1 - diaSemana);
            inicioSemana.setDate(hoy.getDate() + diffLunes);
            desde = fmtDateLocal(inicioSemana);
            hasta = fmtDateLocal(hoy);
            break;
        case 'mes':
            desde = fmtDateLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
            hasta = fmtDateLocal(hoy);
            break;
        case 'todo':
            desde = '';
            hasta = '';
            break;
        case 'personalizado':
            desde = FiltroViajes.fechaDesde;
            hasta = FiltroViajes.fechaHasta;
            break;
        default:
            desde = hasta = fmtDateLocal(hoy);
    }
    
    return { desde, hasta };
}

function actualizarResumenViajes(total) {
    const resumen = document.getElementById('resumenViajes');
    if (!resumen) return;
    
    const { desde, hasta } = calcularRangoFechas();
    let texto = '';
    
    switch (FiltroViajes.periodo) {
        case 'hoy':
            texto = `<i class="bi bi-calendar-check"></i> Hoy: ${total} viaje(s)`;
            break;
        case 'semana':
            texto = `<i class="bi bi-calendar-week"></i> Esta semana: ${total} viaje(s)`;
            break;
        case 'mes':
            texto = `<i class="bi bi-calendar-month"></i> Este mes: ${total} viaje(s)`;
            break;
        case 'todo':
            texto = `<i class="bi bi-calendar"></i> Todos: ${total} viaje(s)`;
            break;
        case 'personalizado':
            texto = `<i class="bi bi-calendar-range"></i> ${desde} a ${hasta}: ${total} viaje(s)`;
            break;
    }
    
    if (FiltroViajes.estado) {
        texto += ` (${FiltroViajes.estado})`;
    }
    
    resumen.innerHTML = texto;
}

// ════════════════════════════════════════════════════════════════════════════════
// BÚSQUEDA GLOBAL Y TOGGLE DE VISTAS
// Agregar al final de gestion-despachos.js
// ════════════════════════════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────────────────────────────
// ESTADO DE BÚSQUEDA Y VISTAS
// ────────────────────────────────────────────────────────────────────────────────

const VistaEstado = {
    vistaActual: 'lista', // 'cards' o 'lista'
    columnas: {
        telefono: false,
        fecha: false,
        items: true,
        observaciones: false
    },
    ordenActual: { campo: 'id_pedido', direccion: 'desc' }
};

// ────────────────────────────────────────────────────────────────────────────────
// BÚSQUEDA GLOBAL
// ────────────────────────────────────────────────────────────────────────────────

function initBusquedaGlobal() {
    const input = document.getElementById('busquedaGlobal');
    const dropdown = document.getElementById('searchResultsDropdown');
    const btnLimpiar = document.getElementById('btnLimpiarBusqueda');
    
    if (!input) return;
    
    let timeoutId = null;
    
    // Búsqueda mientras escribe (debounce 300ms)
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Mostrar/ocultar botón limpiar
        btnLimpiar.classList.toggle('visible', query.length > 0);
        
        // Cancelar búsqueda anterior
        if (timeoutId) clearTimeout(timeoutId);
        
        if (query.length < 2) {
            dropdown.classList.remove('visible');
            return;
        }
        
        // Esperar 300ms antes de buscar
        timeoutId = setTimeout(() => {
            buscarGlobal(query);
        }, 300);
    });
    
    // Enter para aplicar filtro a la lista
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            aplicarFiltroBusqueda(input.value.trim());
            dropdown.classList.remove('visible');
        }
        if (e.key === 'Escape') {
            dropdown.classList.remove('visible');
            input.blur();
        }
    });
    
    // Limpiar búsqueda
    btnLimpiar.addEventListener('click', () => {
        input.value = '';
        btnLimpiar.classList.remove('visible');
        dropdown.classList.remove('visible');
        aplicarFiltroBusqueda('');
    });
    
    // Cerrar dropdown al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-global-container')) {
            dropdown.classList.remove('visible');
        }
    });
}

async function buscarGlobal(query) {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (!query || query.length < 2) { dropdown.classList.remove('visible'); return; }

    try {
        const response = await fetchAPI('/busqueda-global?q=' + encodeURIComponent(query));
        const { pedidos, remitos } = response;
        let html = '';

        if (pedidos && pedidos.length > 0) {
            html += '<div class="search-section-header"><i class="bi bi-file-text"></i> PEDIDOS <span class="badge bg-secondary ms-2">' + pedidos.length + '</span></div>';
            html += pedidos.map(function(p) {
                const estadoColor = getColorEstadoPedido(p.id_estado);
                const tieneRemitos = p.cantidad_remitos > 0;
                return '<div class="search-result-item" onclick="verRemitosDePedido(' + p.id_pedido + ')">' +
                    '<div class="search-result-icon pedido"><i class="bi bi-file-text"></i></div>' +
                    '<div class="search-result-content">' +
                        '<div class="search-result-title">Pedido #' + p.id_pedido +
                            ' <span class="badge-estado-mini" style="background:' + estadoColor + '22;color:' + estadoColor + ';">' + (p.estado || 'Sin estado') + '</span>' +
                            (tieneRemitos ? '<span class="badge-remitos-count">' + p.cantidad_remitos + ' remito' + (p.cantidad_remitos > 1 ? 's' : '') + '</span>' : '') +
                        '</div>' +
                        '<div class="search-result-subtitle"><i class="bi bi-person-fill"></i> ' + escapeHTML(p.cliente) + ' \u00b7 <i class="bi bi-calendar"></i> ' + formatDate(p.fecha_creacion) + ' \u00b7 ' + formatMoney(p.total) + '</div>' +
                    '</div>' +
                    '<div class="search-result-actions">' +
                        '<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); verRemitosDePedido(' + p.id_pedido + ')" title="Ver remitos"><i class="bi bi-receipt"></i></button>' +
                        '<button class="btn btn-sm btn-outline-info" onclick="event.stopPropagation(); abrirTrazabilidad(\'pedido\', ' + p.id_pedido + ')" title="Trazabilidad"><i class="bi bi-diagram-3"></i></button>' +
                    '</div></div>';
            }).join('');
        }

        if (remitos && remitos.length > 0) {
            html += '<div class="search-section-header"><i class="bi bi-receipt"></i> REMITOS <span class="badge bg-secondary ms-2">' + remitos.length + '</span></div>';
            html += remitos.map(function(r) {
                const estadoInfo = getInfoEstadoRemito(r.estado);
                const vecesImpreso = r.veces_impreso || 0;
                let badgeImpresion = '';
                if (vecesImpreso > 1) badgeImpresion = '<span class="badge-reimpreso">\ud83d\udd04 ' + vecesImpreso + 'x</span>';
                else if (vecesImpreso === 1) badgeImpresion = '<span class="badge-impreso-ok">\u2713</span>';

                return '<div class="search-result-item" onclick="imprimirRemitoConConfirmacion(' + r.id_remito + ', ' + vecesImpreso + ')">' +
                    '<div class="search-result-icon remito"><i class="bi bi-receipt"></i></div>' +
                    '<div class="search-result-content">' +
                        '<div class="search-result-title">R-' + r.numero_completo +
                            ' <span class="badge-estado-mini" style="background:' + estadoInfo.color + '22;color:' + estadoInfo.color + ';">' + estadoInfo.icono + ' ' + estadoInfo.texto + '</span>' +
                            badgeImpresion +
                        '</div>' +
                        '<div class="search-result-subtitle"><i class="bi bi-person-fill"></i> ' + escapeHTML(r.cliente) + ' \u00b7 <i class="bi bi-geo-alt-fill"></i> ' + escapeHTML(r.direccion_entrega || 'Sin dir.') + ' \u00b7 ' + formatMoney(r.total) +
                            (r.id_pedido ? ' <span class="text-muted">(Ped #' + r.id_pedido + ')</span>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="search-result-actions">' +
                        '<button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); imprimirRemitoConConfirmacion(' + r.id_remito + ', ' + vecesImpreso + ')" title="' + (vecesImpreso > 0 ? 'Reimprimir' : 'Imprimir') + '"><i class="bi bi-printer"></i>' + (vecesImpreso > 0 ? ' \ud83d\udd04' : '') + '</button>' +
                        (r.id_pedido ? '<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); verRemitosDePedido(' + r.id_pedido + ')" title="Ver pedido"><i class="bi bi-file-text"></i></button>' : '') +
                        (r.telefono ? '<a class="btn btn-sm btn-outline-success" href="tel:' + r.telefono + '" onclick="event.stopPropagation()" title="Llamar"><i class="bi bi-telephone"></i></a>' : '') +
                    '</div></div>';
            }).join('');
        }

        if (!html) {
            html = '<div class="search-no-results"><i class="bi bi-search text-muted" style="font-size: 2rem;"></i>' +
                '<p class="mb-0 mt-2">No se encontraron resultados para "<strong>' + escapeHTML(query) + '</strong>"</p></div>';
        }

        dropdown.innerHTML = html;
        dropdown.classList.add('visible');
    } catch (error) {
        console.error('Error en busqueda global:', error);
        dropdown.innerHTML = '<div class="search-no-results text-danger"><i class="bi bi-exclamation-triangle"></i>' +
            '<p class="mb-0 mt-2">Error: ' + escapeHTML(error.message) + '</p></div>';
        dropdown.classList.add('visible');
    }
}

function crearResultadoBusqueda(pedido, query) {
    const estadoCredito = pedido.estado_credito || 'ok';
    const direccion = pedido.domicilio_entrega || pedido.domicilio_cliente || 'Sin dirección';
    
    // Determinar qué matcheó para el icono
    let iconClass = 'pedido';
    let iconSymbol = 'bi-file-text';
    
    if ((pedido.cliente || '').toLowerCase().includes(query.toLowerCase())) {
        iconClass = 'cliente';
        iconSymbol = 'bi-person';
    } else if (direccion.toLowerCase().includes(query.toLowerCase())) {
        iconClass = 'direccion';
        iconSymbol = 'bi-geo-alt';
    }
    
    // Badge de estado
    let estadoBadge = '';
    if (estadoCredito === 'moroso') {
        estadoBadge = '<span class="badge bg-danger badge-mini">MOROSO</span>';
    } else if (estadoCredito === 'excede_credito') {
        estadoBadge = '<span class="badge bg-warning badge-mini">EXCEDE</span>';
    }
    
    return `
        <div class="search-result-item" onclick="seleccionarDesdeResultado(${pedido.id_pedido})">
            <div class="search-result-icon ${iconClass}">
                <i class="bi ${iconSymbol}"></i>
            </div>
            <div class="search-result-content">
                <div class="search-result-title">
                    #${pedido.id_pedido} - ${escapeHTML(pedido.cliente)} ${estadoBadge}
                </div>
                <div class="search-result-subtitle">
                    <i class="bi bi-geo-alt-fill"></i> ${escapeHTML(direccion)} · ${formatMoney(pedido.total)}
                </div>
            </div>
            <div class="search-result-actions">
                <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); verDetallePedido(${pedido.id_pedido})" title="Ver detalle">
                    <i class="bi bi-eye"></i>
                </button>
                <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); agregarPedidoAlViaje(${pedido.id_pedido})" title="Agregar al viaje">
                    <i class="bi bi-plus"></i>
                </button>
                ${pedido.telefono ? `
                <a class="btn btn-sm btn-outline-success" href="tel:${pedido.telefono}" onclick="event.stopPropagation()" title="Llamar">
                    <i class="bi bi-telephone"></i>
                </a>
                ` : ''}
            </div>
        </div>
    `;
}

function seleccionarDesdeResultado(idPedido) {
    document.getElementById('searchResultsDropdown').classList.remove('visible');
    seleccionarPedido(idPedido);
    
    // Scroll hasta el pedido en la lista
    const card = document.querySelector(`[data-pedido-id="${idPedido}"]`);
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function aplicarFiltroBusqueda(query) {
    // Actualizar el campo de búsqueda antiguo también (mantener compatibilidad)
    const buscarPedido = document.getElementById('buscarPedido');
    if (buscarPedido) {
        buscarPedido.value = query;
    }
    
    // Recargar pedidos con filtro
    cargarPedidosDisponibles();
}

// ────────────────────────────────────────────────────────────────────────────────
// TOGGLE DE VISTAS
// ────────────────────────────────────────────────────────────────────────────────

function initToggleVistas() {
    const btnCards = document.getElementById('btnVistaCards');
    const btnLista = document.getElementById('btnVistaLista');
    const columnSelector = document.getElementById('columnSelector');
    
    if (!btnCards || !btnLista) return;
    
    btnCards.addEventListener('click', () => cambiarVista('cards'));
    btnLista.addEventListener('click', () => cambiarVista('lista'));
    
    // Selector de columnas
    initSelectorColumnas();
}

function cambiarVista(vista) {
    VistaEstado.vistaActual = vista;
    
    const btnCards = document.getElementById('btnVistaCards');
    const btnLista = document.getElementById('btnVistaLista');
    const containerCards = document.getElementById('pedidosContainerCards');
    const containerLista = document.getElementById('pedidosContainerLista');
    const columnSelector = document.getElementById('columnSelector');
    
    // Actualizar botones
    btnCards.classList.toggle('active', vista === 'cards');
    btnLista.classList.toggle('active', vista === 'lista');
    
    // Mostrar/ocultar contenedores
    if (vista === 'cards') {
        containerCards.classList.remove('hidden');
        containerLista.classList.remove('visible');
        columnSelector.style.display = 'none';
    } else {
        containerCards.classList.add('hidden');
        containerLista.classList.add('visible');
        columnSelector.style.display = 'block';
        renderizarVistaLista();
    }
}

// ────────────────────────────────────────────────────────────────────────────────
// SELECTOR DE COLUMNAS
// ────────────────────────────────────────────────────────────────────────────────

function initSelectorColumnas() {
    const btn = document.getElementById('btnColumnSelector');
    const dropdown = document.getElementById('columnSelectorDropdown');
    
    if (!btn || !dropdown) return;
    
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('visible');
    });
    
    // Cerrar al hacer click fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.column-selector')) {
            dropdown.classList.remove('visible');
        }
    });
    
    // Checkboxes de columnas
    dropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        // Cargar estado inicial
        const col = checkbox.dataset.col;
        checkbox.checked = VistaEstado.columnas[col];
        
        checkbox.addEventListener('change', (e) => {
            const col = e.target.dataset.col;
            VistaEstado.columnas[col] = e.target.checked;
            actualizarColumnasVisibles();
        });
    });
    
    actualizarColumnasVisibles();
}

function actualizarColumnasVisibles() {
    const tabla = document.getElementById('tablaPedidos');
    if (!tabla) return;
    
    Object.keys(VistaEstado.columnas).forEach(col => {
        tabla.classList.toggle(`show-${col}`, VistaEstado.columnas[col]);
    });
}

// ────────────────────────────────────────────────────────────────────────────────
// VISTA LISTA (TABLA)
// ────────────────────────────────────────────────────────────────────────────────

function renderizarVistaLista() {
    const tbody = document.getElementById('tablaPedidosBody');
    if (!tbody) return;
    
    const pedidos = Estado.pedidosDisponibles;
    
    if (pedidos.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center text-muted py-4">
                    No hay pedidos disponibles
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = pedidos.map(p => crearFilaPedido(p)).join('');
    
    // Configurar ordenamiento
    setupSorting();
}

// ════════════════════════════════════════════════════════════════
// SORTING DE TABLA
// ════════════════════════════════════════════════════════════════

var _sortCol = null;
var _sortDir = 'asc';


function filtrarPedidosPeriodo(btn) {
    document.querySelectorAll('.filtro-pedido-periodo').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    filtroPedidoPeriodo = btn.dataset.periodo;
    cargarPedidosDisponibles();
}
window.filtrarPedidosPeriodo = filtrarPedidosPeriodo;
function filtrarPedidosRango() {
    var desde = document.getElementById('pedidoFechaDesde')?.value;
    var hasta = document.getElementById('pedidoFechaHasta')?.value;
    if (!desde && !hasta) return;
    document.querySelectorAll('.filtro-pedido-periodo').forEach(function(b) { b.classList.remove('active'); });
    filtroPedidoPeriodo = 'rango';
    cargarPedidosDisponibles();
}
window.filtrarPedidosRango = filtrarPedidosRango;


function setupSorting() {
    var tabla = document.getElementById('tablaPedidos');
    if (!tabla) return;
    var ths = tabla.querySelectorAll('thead th');
    ths.forEach(function(th, colIndex) {
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.onclick = function() { ordenarColumna(colIndex, th); };
    });
}

function ordenarColumna(colIndex, thEl) {
    if (_sortCol === colIndex) {
        _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        _sortCol = colIndex;
        _sortDir = 'asc';
    }

    // Mapeo de columna a campo
    var campos = ['id_pedido', 'fecha_creacion', 'cliente', 'domicilio_entrega', 'telefono', 'items_count', 'observaciones', 'estado_credito', 'total', ''];
    var campo = campos[colIndex];
    if (!campo || colIndex >= 9) return; // acciones no ordena

    // Ordenar pedidos
    Estado.pedidosDisponibles.sort(function(a, b) {
        var va, vb;
        if (campo === 'id_pedido') { va = a.id_pedido; vb = b.id_pedido; }
        else if (campo === 'fecha_creacion') { va = new Date(a.fecha_creacion || 0).getTime(); vb = new Date(b.fecha_creacion || 0).getTime(); }
        else if (campo === 'cliente') { va = (a.cliente || '').toLowerCase(); vb = (b.cliente || '').toLowerCase(); }
        else if (campo === 'domicilio_entrega') { va = (a.domicilio_entrega || a.domicilio_cliente || '').toLowerCase(); vb = (b.domicilio_entrega || b.domicilio_cliente || '').toLowerCase(); }
        else if (campo === 'telefono') { va = a.telefono || ''; vb = b.telefono || ''; }
        else if (campo === 'items_count') { va = (a.items || []).length; vb = (b.items || []).length; }
        else if (campo === 'observaciones') { va = (a.observaciones || a.observaciones_pedido || '').toLowerCase(); vb = (b.observaciones || b.observaciones_pedido || '').toLowerCase(); }
        else if (campo === 'estado_credito') { va = a.estado_credito || 'ok'; vb = b.estado_credito || 'ok'; }
        else if (campo === 'total') { va = parseFloat(a.total || 0); vb = parseFloat(b.total || 0); }
        else { va = ''; vb = ''; }

        var res;
        if (typeof va === 'number') res = va - vb;
        else res = String(va).localeCompare(String(vb));
        return _sortDir === 'asc' ? res : -res;
    });

    // Actualizar headers visuales
    var tabla = document.getElementById('tablaPedidos');
    tabla.querySelectorAll('thead th').forEach(function(t) {
        t.classList.remove('sorted', 'sort-asc', 'sort-desc');
        var old = t.querySelector('.arrow');
        if (old) old.remove();
    });
    thEl.classList.add('sorted', 'sort-' + _sortDir);
    var arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = _sortDir === 'asc' ? ' ▲' : ' ▼';
    thEl.appendChild(arrow);

    renderizarVistaLista();
}

// Sorting por observaciones (ordena por si tiene o no, y luego por texto)
function agregarSortObs() {
    var tabla = document.getElementById('tablaPedidos');
    if (!tabla) return;
    var tbody = tabla.querySelector('tbody');
    if (!tbody) return;

    // Recoger filas principales (no obs-row)
    var filas = Array.from(tbody.querySelectorAll('tr:not(.obs-row)'));
    // Ya están ordenadas por renderizarVistaLista, no hace falta más
}



function crearFilaPedido(pedido) {
    var ec = pedido.estado_credito || 'ok';
    var dir = pedido.domicilio_entrega || pedido.domicilio_cliente || '-';
    var items = pedido.items || [];
    var enViaje = items.some(function(i){ return i.en_transito > 0; });
    var tel = pedido.telefono || '';
    var obs = pedido.observaciones || pedido.observaciones_pedido || '';
    var badge = '';
    if (ec === 'moroso') badge = '<span class="badge bg-danger" style="font-size:9px;padding:1px 4px">MOR</span>';
    else if (ec === 'excede_credito') badge = '<span class="badge bg-warning text-dark" style="font-size:9px;padding:1px 4px">EXC</span>';
    else badge = '<span class="badge bg-success" style="font-size:9px;padding:1px 4px">OK</span>';
    var itemsTip = items.map(function(i){ return i.disponible + ' ' + i.producto; }).join('\n');
    var html = '<tr class="' + (enViaje ? 'en-viaje' : '') + '" data-pedido-id="' + pedido.id_pedido + '">' +
        '<td class="col-pedido">' + pedido.id_pedido + '</td>' +
        '<td class="col-fecha text-muted small" style="white-space:nowrap;">' + (function(){
            if (!pedido.fecha_creacion) return '-';
            var d = new Date(pedido.fecha_creacion);
            if (isNaN(d.getTime())) return '-';
            return String(d.getDate()).padStart(2,'0') + '/' +
                   String(d.getMonth()+1).padStart(2,'0') + ' ' +
                   String(d.getHours()).padStart(2,'0') + ':' +
                   String(d.getMinutes()).padStart(2,'0');
        })() + '</td>' +
        '<td style="max-width:130px;overflow:hidden;text-overflow:ellipsis" title="' + escapeHTML(pedido.cliente||'') + '">' + escapeHTML(pedido.cliente || '-') + '</td>' +
        '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis" title="' + escapeHTML(dir) + '">' + escapeHTML(dir) + '</td>' +
        '<td>' + (tel ? '<a href="tel:' + tel + '" onclick="event.stopPropagation()">' + tel + '</a>' : '-') + '</td>' +
        '<td class="col-items-count" title="' + itemsTip.replace(/"/g,'&quot;') + '">' + items.length + (enViaje ? '<i class="bi bi-truck text-primary" style="font-size:8px;margin-left:1px"></i>' : '') + '</td>' +
        '<td style="max-width:30px;text-align:center;cursor:pointer;font-size:11px" onclick="event.stopPropagation();abrirModalEditarObsPedido(' + pedido.id_pedido + ')" title="' + (obs ? 'Editar observacion: ' + escapeHTML(obs) : 'Agregar observacion') + '">' + (obs ? '<span style="color:#0d6efd">💬</span>' : '<i class="bi bi-pencil-square text-muted"></i>') + '</td>' +
        '<td class="col-estado">' + badge + '</td>' +
        '<td class="col-total">' + formatMoney(pedido.total) + '</td>' +
        '<td class="col-acciones">' +
            '<button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation();verRemitosDePedido(' + pedido.id_pedido + ')" title="Remitos"><i class="bi bi-receipt"></i></button> ' +
            '<button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation();abrirModalEditarObsPedido(' + pedido.id_pedido + ')" title="Editar observacion"><i class="bi bi-chat-square-text"></i></button> ' +
            '<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation();verDetallePedido(' + pedido.id_pedido + ')" title="Detalle"><i class="bi bi-eye"></i></button> ' +
            '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();agregarPedidoAlViaje(' + pedido.id_pedido + ')" title="Agregar al viaje"><i class="bi bi-plus"></i> Cargar</button>' +
        '</td></tr>';
    if (obs) {
        html += '<tr class="obs-row" data-pedido-id="' + pedido.id_pedido + '" style="cursor:pointer" onclick="abrirModalEditarObsPedido(' + pedido.id_pedido + ')" title="Click para editar">' +
            '<td colspan="10" style="padding:0 5px 3px 55px;border-bottom:1px solid #e8e8e8;font-size:10px;color:#666;white-space:normal;line-height:1.2;">' +
            '<i class="bi bi-chat-left-text" style="font-size:8px;color:#aaa;margin-right:3px;"></i>' + escapeHTML(obs) +
            '</td></tr>';
    }
    return html;
}

function truncarTexto(texto, maxLength) {
    if (!texto) return '-';
    return texto.length > maxLength ? texto.substring(0, maxLength) + '...' : texto;
}

// ────────────────────────────────────────────────────────────────────────────────
// ORDENAMIENTO DE TABLA
// ────────────────────────────────────────────────────────────────────────────────

// [ELIMINADO] initOrdenamientoTabla y ordenarPedidos — código muerto

// [LIMPIADO] Bloques TODO/IMPORTANTE obsoletos — ya integrados en DOMContentLoaded

// ════════════════════════════════════════════════════════════════════════════════
// BÚSQUEDA DE REMITOS - Agregado automáticamente
// ════════════════════════════════════════════════════════════════════════════════

async function buscarRemitosAPI(query) {
    try {
        const response = await fetchAPI('/buscar-remitos?q=' + encodeURIComponent(query));
        return response;
    } catch (error) {
        console.error('Error buscando remitos:', error);
        return [];
    }
}


function crearResultadoRemito(remito, query) {
    const estado = remito.estado || 'pendiente';
    const direccion = remito.direccion_entrega || 'Sin dirección';
    const vecesImpreso = remito.veces_impreso || 0;
    
    // Badge de reimpresión
    let badgeReimpresion = '';
    if (vecesImpreso > 1) {
        badgeReimpresion = '<span class="badge-reimpresion">🔄 ' + vecesImpreso + 'x</span>';
    } else if (vecesImpreso === 1) {
        badgeReimpresion = '<span class="badge-reimpresion">✓ Impreso</span>';
    }
    
    // Badge de estado
    const estadoTexto = {
        'pendiente': 'Pendiente',
        'despachado': 'En camino',
        'entregado': 'Entregado',
        'no_entregado': 'No entregado',
        'anulado': 'Anulado'
    };
    const estadoBadge = '<span class="badge-estado-remito ' + estado + '">' + (estadoTexto[estado] || estado) + '</span>';
    
    let accionesTel = '';
    if (remito.telefono) {
        accionesTel = '<a class="btn btn-sm btn-outline-success" href="tel:' + remito.telefono + '" onclick="event.stopPropagation()" title="Llamar"><i class="bi bi-telephone"></i></a>';
    }
    
    let accionesPedido = '';
    if (remito.id_pedido) {
        accionesPedido = '<button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); verDetallePedido(' + remito.id_pedido + ')" title="Ver pedido"><i class="bi bi-file-text"></i></button>';
    }
    
    return '<div class="search-result-item" onclick="imprimirRemitoConConfirmacion(' + remito.id_remito + ', ' + vecesImpreso + ')">' +
        '<div class="search-result-icon remito"><i class="bi bi-receipt"></i></div>' +
        '<div class="search-result-content">' +
            '<div class="search-result-title">R-' + remito.numero_completo + ' ' + estadoBadge + ' ' + badgeReimpresion + '</div>' +
            '<div class="search-result-subtitle"><i class="bi bi-person-fill"></i> ' + escapeHTML(remito.cliente) + ' · <i class="bi bi-geo-alt-fill"></i> ' + escapeHTML(direccion) + ' · ' + formatMoney(remito.total) + '</div>' +
        '</div>' +
        '<div class="search-result-actions">' +
            '<button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); imprimirRemitoConConfirmacion(' + remito.id_remito + ', ' + vecesImpreso + ')" title="' + (vecesImpreso > 0 ? 'Reimprimir' : 'Imprimir') + '"><i class="bi bi-printer"></i>' + (vecesImpreso > 0 ? ' 🔄' : '') + '</button>' +
            accionesPedido +
            accionesTel +
        '</div>' +
    '</div>';
}

async function imprimirRemitoConConfirmacion(idRemito, vecesImpreso) {
    document.getElementById('searchResultsDropdown').classList.remove('visible');
    if (vecesImpreso > 0) {
        if (!confirm('\u26a0\ufe0f Este remito ya fue impreso ' + vecesImpreso + ' vez(es).\n\n\u00bfContinuar con reimpresi\u00f3n?')) return;
    }
    await imprimirRemito(idRemito);
}



// ════════════════════════════════════════════════════════════════════════════════
// BÚSQUEDA DE REMITOS
// ════════════════════════════════════════════════════════════════════════════════



// [ELIMINADO] imprimirRemitoDirecto — duplicado de imprimirRemitoConConfirmacion

// ════════════════════════════════════════════════════════════════════════════════
// PANEL DE TRAZABILIDAD
// ════════════════════════════════════════════════════════════════════════════════

async function abrirTrazabilidad(tipo, id) {
    try {
        mostrarLoading(true);
        const data = await fetchAPI(`/trazabilidad/${tipo}/${id}`);
        
        if (!data || !data.pedido) {
            mostrarToast('No se encontró información de trazabilidad', 'warning');
            return;
        }

        renderizarTrazabilidad(data);
        new bootstrap.Modal(document.getElementById('modalTrazabilidad')).show();

    } catch (error) {
        console.error('Error al obtener trazabilidad:', error);
        mostrarToast('Error al cargar trazabilidad: ' + error.message, 'danger');
    } finally {
        mostrarLoading(false);
    }
}

function renderizarTrazabilidad(data) {
    const { pedido, cliente, remitos, facturas, pagos, timeline, resumen_pagos, cuenta_corriente } = data;

    // Header del modal
    document.getElementById('trazabilidadTitulo').innerHTML = `
        Pedido #${pedido.id_pedido} - ${escapeHTML(cliente.razon_social)}
    `;

    // ═══════════════════════════════════════════════════════════════════
    // SECCIÓN: CUENTA CORRIENTE
    // ═══════════════════════════════════════════════════════════════════
    const porcentajeUso = cuenta_corriente.porcentaje_uso || 0;
    const colorBarra = porcentajeUso > 90 ? '#c62828' : porcentajeUso > 70 ? '#f57c00' : '#2e7d32';
    
    document.getElementById('trazabilidadCC').innerHTML = `
        <div class="cc-header">
            <span><i class="bi bi-wallet2"></i> CUENTA CORRIENTE</span>
            <span class="cc-cliente">${escapeHTML(cliente.razon_social)}</span>
        </div>
        <div class="cc-body">
            <div class="cc-row">
                <span>Saldo actual:</span>
                <strong class="${cuenta_corriente.saldo_actual > 0 ? 'text-danger' : 'text-success'}">
                    ${formatMoney(cuenta_corriente.saldo_actual)} ${cuenta_corriente.saldo_actual > 0 ? '(DEBE)' : ''}
                </strong>
            </div>
            <div class="cc-row">
                <span>Límite de crédito:</span>
                <strong>${formatMoney(cuenta_corriente.limite_credito)}</strong>
            </div>
            <div class="cc-row">
                <span>Crédito disponible:</span>
                <strong class="${cuenta_corriente.credito_disponible < 0 ? 'text-danger' : ''}">${formatMoney(cuenta_corriente.credito_disponible)}</strong>
            </div>
            <div class="cc-barra-container">
                <div class="cc-barra" style="width: ${Math.min(porcentajeUso, 100)}%; background: ${colorBarra};"></div>
            </div>
            <div class="cc-porcentaje">${porcentajeUso}% utilizado</div>
        </div>
    `;

    // ═══════════════════════════════════════════════════════════════════
    // SECCIÓN: ÁRBOL DE DOCUMENTOS
    // ═══════════════════════════════════════════════════════════════════
    let arbolHTML = `
        <div class="doc-tree">
            <div class="doc-node doc-pedido">
                <div class="doc-icon"><i class="bi bi-file-text"></i></div>
                <div class="doc-info">
                    <div class="doc-titulo">Pedido #${pedido.id_pedido}</div>
                    <div class="doc-subtitulo">${formatDate(pedido.fecha_creacion)} · ${formatMoney(pedido.total_final || pedido.total)}</div>
                    <span class="doc-badge estado-${pedido.id_estado}">${pedido.estado}</span>
                </div>
            </div>
            <div class="doc-children">
    `;

    // Remitos
    if (remitos && remitos.length > 0) {
        remitos.forEach(r => {
            const estadoIcono = r.estado === 'entregado' ? '✅' : 
                               r.estado === 'despachado' ? '🚚' : 
                               r.estado === 'parcial' ? '⚠️' : 
                               r.estado === 'no_entregado' ? '❌' : '📦';
            
            arbolHTML += `
                <div class="doc-branch">
                    <div class="doc-node doc-remito" onclick="imprimirRemito(${r.id_remito})">
                        <div class="doc-icon"><i class="bi bi-receipt"></i></div>
                        <div class="doc-info">
                            <div class="doc-titulo">${estadoIcono} Remito ${r.numero_completo}</div>
                            <div class="doc-subtitulo">
                                ${formatDate(r.fecha_emision)} · ${formatMoney(r.total)}
                                ${r.viaje_info ? `<br><small>Viaje #${r.viaje_info.id_viaje} - ${r.viaje_info.chofer || 'Sin chofer'}</small>` : ''}
                            </div>
                            <span class="doc-badge remito-${r.estado}">${r.estado}</span>
                            ${r.veces_impreso > 0 ? `<span class="doc-badge impreso">🖨️ ${r.veces_impreso}x</span>` : ''}
                        </div>
                        <div class="doc-actions">
                            <button class="btn btn-sm btn-outline-secondary" onclick="event.stopPropagation(); imprimirRemito(${r.id_remito})" title="Imprimir">
                                <i class="bi bi-printer"></i>
                            </button>
                        </div>
                    </div>
            `;

            // Factura asociada al remito
            if (r.factura) {
                arbolHTML += `
                    <div class="doc-children">
                        <div class="doc-branch">
                            <div class="doc-node doc-factura">
                                <div class="doc-icon"><i class="bi bi-file-earmark-text"></i></div>
                                <div class="doc-info">
                                    <div class="doc-titulo">🧾 Factura ${r.factura.numero_completo}</div>
                                    <div class="doc-subtitulo">${formatDate(r.factura.fecha_emision)} · ${formatMoney(r.factura.total)}</div>
                                    <span class="doc-badge factura">${r.factura.tipo || 'Factura'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            arbolHTML += `</div>`;
        });
    } else {
        arbolHTML += `<div class="text-muted small p-2"><i class="bi bi-info-circle"></i> Sin remitos generados</div>`;
    }

    // Pagos
    if (pagos && pagos.length > 0) {
        arbolHTML += `<div class="doc-separator"></div>`;
        pagos.forEach(p => {
            const estadoPago = p.estado === 'Aprobado' ? '✅' : p.estado === 'Pendiente' ? '⏳' : '❌';
            arbolHTML += `
                <div class="doc-branch">
                    <div class="doc-node doc-pago">
                        <div class="doc-icon"><i class="bi bi-cash-coin"></i></div>
                        <div class="doc-info">
                            <div class="doc-titulo">${estadoPago} Pago ${p.metodo}</div>
                            <div class="doc-subtitulo">${formatDate(p.fecha_pago)} · ${formatMoney(p.monto)}</div>
                            <span class="doc-badge pago-${p.estado?.toLowerCase()}">${p.estado}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    arbolHTML += `
            </div>
        </div>
    `;

    // Resumen de pagos
    const porcentajePagado = resumen_pagos.total_pedido > 0 
        ? Math.round((resumen_pagos.total_pagado / resumen_pagos.total_pedido) * 100) 
        : 0;

    arbolHTML += `
        <div class="resumen-pagos">
            <div class="resumen-row">
                <span>Total pedido:</span>
                <strong>${formatMoney(resumen_pagos.total_pedido)}</strong>
            </div>
            <div class="resumen-row">
                <span>Total pagado:</span>
                <strong class="text-success">${formatMoney(resumen_pagos.total_pagado)}</strong>
            </div>
            <div class="resumen-row ${resumen_pagos.saldo_pendiente > 1 ? 'text-danger' : 'text-success'}">
                <span>Saldo pendiente:</span>
                <strong>${formatMoney(resumen_pagos.saldo_pendiente)}</strong>
            </div>
            <div class="progress-pagos">
                <div class="progress-bar-pagos" style="width: ${porcentajePagado}%"></div>
            </div>
            <small class="text-muted">${porcentajePagado}% pagado</small>
        </div>
    `;

    document.getElementById('trazabilidadDocumentos').innerHTML = arbolHTML;

    // ═══════════════════════════════════════════════════════════════════
    // SECCIÓN: TIMELINE
    // ═══════════════════════════════════════════════════════════════════
    let timelineHTML = '<div class="timeline-container">';
    
    if (timeline && timeline.length > 0) {
        timeline.forEach((evento, idx) => {
            const iconos = {
                'pedido_creado': { icon: 'bi-file-plus', color: '#1a4d8f' },
                'remito_generado': { icon: 'bi-receipt', color: '#7b1fa2' },
                'viaje_despachado': { icon: 'bi-truck', color: '#0288d1' },
                'entrega_completa': { icon: 'bi-check-circle-fill', color: '#2e7d32' },
                'entrega_parcial': { icon: 'bi-exclamation-circle', color: '#f57c00' },
                'entrega_fallida': { icon: 'bi-x-circle', color: '#c62828' },
                'pago_registrado': { icon: 'bi-cash-coin', color: '#388e3c' },
                'factura_emitida': { icon: 'bi-file-earmark-text', color: '#5d4037' }
            };

            const config = iconos[evento.tipo] || { icon: 'bi-circle', color: '#666' };
            const esUltimo = idx === timeline.length - 1;

            timelineHTML += `
                <div class="timeline-item ${esUltimo ? 'ultimo' : ''}">
                    <div class="timeline-marker" style="background: ${config.color};">
                        <i class="bi ${config.icon}"></i>
                    </div>
                    <div class="timeline-content">
                        <div class="timeline-fecha">${formatDateTime(evento.fecha)}</div>
                        <div class="timeline-descripcion">${evento.descripcion}</div>
                        ${evento.usuario ? `<div class="timeline-usuario"><i class="bi bi-person"></i> ${evento.usuario}</div>` : ''}
                    </div>
                </div>
            `;
        });
    } else {
        timelineHTML += '<div class="text-muted text-center py-3"><i class="bi bi-clock-history"></i> Sin eventos registrados</div>';
    }

    timelineHTML += '</div>';
    document.getElementById('trazabilidadTimeline').innerHTML = timelineHTML;

    // Info del cliente
    document.getElementById('trazabilidadClienteInfo').innerHTML = `
        <div class="cliente-info-mini">
            <div><i class="bi bi-person"></i> ${cliente.razon_social}</div>
            <div><i class="bi bi-card-text"></i> ${cliente.cuit_cuil || 'Sin CUIT'}</div>
            ${cliente.telefono ? `<div><a href="tel:${cliente.telefono}"><i class="bi bi-telephone"></i> ${cliente.telefono}</a></div>` : ''}
            ${cliente.email ? `<div><a href="mailto:${cliente.email}"><i class="bi bi-envelope"></i> ${cliente.email}</a></div>` : ''}
        </div>
    `;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-AR') + ' ' + date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}



// ════════════════════════════════════════════════════════════════
// IMPRESIÓN DE VIAJE COMPLETO (1 PDF con todos los remitos)
// ════════════════════════════════════════════════════════════════

function imprimirViaje(idViaje) {
    var token = localStorage.getItem('authToken');
    var url = (window.CONFIG?.API_BASE_URL || '/api') + '/despachos/viaje/' + idViaje + '/html?token=' + token;
    window.open(url, '_blank');
}

function mostrarModalPostDespacho(viaje) {
    var remitos = viaje.remitos || [];
    if (remitos.length === 0) return;

    var html = '<div style="padding:15px">' +
        '<div style="background:#e8f5e9;border-radius:8px;padding:12px;margin-bottom:15px;text-align:center">' +
        '<i class="bi bi-check-circle-fill text-success" style="font-size:24px"></i><br>' +
        '<strong>Viaje #' + viaje.id_viaje + ' despachado</strong><br>' +
        '<small class="text-muted">' + remitos.length + ' remito' + (remitos.length > 1 ? 's' : '') + ' generados</small>' +
        '</div>' +
        '<div style="margin-bottom:10px"><strong>PDF completo:</strong></div>' +
        '<button class="btn btn-primary w-100 mb-3" onclick="imprimirViaje(' + viaje.id_viaje + ')">' +
        '<i class="bi bi-printer"></i> Imprimir todo el viaje (' + remitos.length + ' remitos)</button>' +
        '<div style="margin-bottom:10px"><strong>Remitos individuales:</strong></div>';

    remitos.forEach(function(r) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee">' +
            '<div><strong>' + (r.numero_completo || 'R-' + r.id_remito) + '</strong> · ' + (r.cliente || 'Ped #' + r.id_pedido) + ' · ' + (r.total ? '$' + Number(r.total).toLocaleString() : '') + '</div>' +
            '<button class="btn btn-sm btn-outline-secondary" onclick="imprimirRemito(' + r.id_remito + ')">' +
            '<i class="bi bi-printer"></i></button></div>';
    });

    html += '</div>';

    // Crear modal dinámico
    var modalId = 'modalPostDespacho';
    var existing = document.getElementById(modalId);
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal fade';
    modal.tabIndex = -1;
    modal.innerHTML = '<div class="modal-dialog"><div class="modal-content">' +
        '<div class="modal-header" style="background:#1a5f7a;color:#fff">' +
        '<h5 class="modal-title"><i class="bi bi-truck"></i> Viaje Despachado</h5>' +
        '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body">' + html + '</div>' +
        '<div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button></div>' +
        '</div></div>';

    document.body.appendChild(modal);
    new bootstrap.Modal(modal).show();

    modal.addEventListener('hidden.bs.modal', function() { modal.remove(); });
}

// Agregar botón de trazabilidad a las cards de pedido
function agregarBotonTrazabilidad() {
    // Esta función se puede llamar para agregar el botón a las cards existentes
}

// Modificar crearResultadoRemito para incluir botón de trazabilidad
const _crearResultadoRemitoOriginal = typeof crearResultadoRemito === 'function' ? crearResultadoRemito : null;
if (_crearResultadoRemitoOriginal) {
    // Ya está definida, la extendemos en el HTML
}


// ════════════════════════════════════════════════════════════════════════════════
// PARCHE: Búsqueda Global + Ver Remitos de Pedido
// ════════════════════════════════════════════════════════════════════════════════
/**
 * Color por estado de pedido.
 */
function getColorEstadoPedido(idEstado) {
    const colores = {
        0: '#9e9e9e',   // Sin estado
        1: '#ff9800',   // Pendiente
        2: '#2196f3',   // En proceso
        3: '#9c27b0',   // Preparado
        4: '#00bcd4',   // Despachado
        5: '#03a9f4',   // En camino
        6: '#4caf50',   // Entregado
        7: '#f44336',   // Anulado
        8: '#607d8b',   // Cerrado
        99: '#795548'   // Recuperado
    };
    return colores[idEstado] || '#666';
}
/**
 * Info visual por estado de remito.
 */
function getInfoEstadoRemito(estado) {
    const estados = {
        pendiente:    { texto: 'Pendiente',     icono: '📦', color: '#ff9800' },
        borrador:     { texto: 'Borrador',      icono: '📝', color: '#9e9e9e' },
        despachado:   { texto: 'En camino',     icono: '🚚', color: '#2196f3' },
        entregado:    { texto: 'Entregado',     icono: '✅', color: '#4caf50' },
        parcial:      { texto: 'Parcial',       icono: '⚠️', color: '#ff9800' },
        no_entregado: { texto: 'No entregado',  icono: '❌', color: '#f44336' },
        anulado:      { texto: 'Anulado',       icono: '🚫', color: '#9e9e9e' }
    };
    return estados[estado] || { texto: estado || 'Desconocido', icono: '❓', color: '#666' };
}
/**
 * Abre modal con remitos de un pedido.
 */
async function verRemitosDePedido(idPedido) {
    const dropdown = document.getElementById('searchResultsDropdown');
    if (dropdown) dropdown.classList.remove('visible');

    try {
        mostrarLoading(true);
        const data = await fetchAPI('/pedido/' + idPedido + '/remitos');
        renderizarModalRemitos(data);
        new bootstrap.Modal(document.getElementById('modalRemitosPedido')).show();
    } catch (error) {
        console.error('Error:', error);
        mostrarToast('Error: ' + escapeHTML(error.message), 'danger');
    } finally {
        mostrarLoading(false);
    }
}
/**
 * Renderiza el modal de remitos de un pedido.
 * Des-minificada + escapeHTML en datos de usuario.
 */
function renderizarModalRemitos(data) {
    const { pedido, remitos, resumen_entregas, total_remitos } = data;

    // Título del modal
    document.getElementById('modalRemitosPedidoTitulo').innerHTML =
        'Pedido #' + pedido.id_pedido + ' - ' + escapeHTML(pedido.cliente);

    // Info del pedido
    document.getElementById('remitosPedidoInfo').innerHTML = `
        <div class="pedido-info-card">
            <div class="row">
                <div class="col-md-6">
                    <div class="info-item"><i class="bi bi-person"></i> ${escapeHTML(pedido.cliente)}</div>
                    <div class="info-item"><i class="bi bi-geo-alt"></i> ${escapeHTML(pedido.domicilio_entrega || pedido.domicilio_cliente || 'Sin dirección')}</div>
                    ${pedido.telefono ? `<div class="info-item"><a href="tel:${escapeHTML(pedido.telefono)}"><i class="bi bi-telephone"></i> ${escapeHTML(pedido.telefono)}</a></div>` : ''}
                </div>
                <div class="col-md-6 text-md-end">
                    <div class="info-item"><i class="bi bi-calendar"></i> ${formatDate(pedido.fecha_creacion)}</div>
                    <div class="info-item"><span class="badge bg-secondary">${escapeHTML(pedido.estado)}</span></div>
                    <div class="info-item fw-bold text-primary">Total: ${formatMoney(pedido.total)}</div>
                </div>
            </div>
        </div>
    `;

    // Lista de remitos
    let remitosHTML = '';

    if (remitos && remitos.length > 0) {
        remitosHTML = '<div class="remitos-contador mb-3"><span class="badge bg-primary">' +
            total_remitos + '</span> remito' + (total_remitos > 1 ? 's' : '') +
            ' asociado' + (total_remitos > 1 ? 's' : '') + '</div><div class="remitos-lista">';

        remitos.forEach(function(r) {
            const estadoInfo = getInfoEstadoRemito(r.estado);
            const vecesImpreso = r.veces_impreso || 0;

            remitosHTML += `
                <div class="remito-card" onclick="imprimirRemitoConConfirmacion(${r.id_remito}, ${vecesImpreso})">
                    <div class="remito-header">
                        <div class="remito-numero"><i class="bi bi-receipt"></i> R-${escapeHTML(r.numero_completo)}</div>
                        <div class="remito-badges">
                            <span class="badge-estado" style="background:${estadoInfo.color}22;color:${estadoInfo.color};">
                                ${estadoInfo.icono} ${estadoInfo.texto}
                            </span>
                            ${vecesImpreso > 0 ? '<span class="badge-impreso">🖨️ ' + vecesImpreso + 'x</span>' : ''}
                        </div>
                    </div>
                    <div class="remito-body">
                        <div class="remito-info">
                            <div><i class="bi bi-calendar3"></i> ${formatDate(r.fecha_emision)}</div>
                            <div><i class="bi bi-geo-alt"></i> ${escapeHTML(r.direccion_entrega || 'Sin dirección')}</div>
                            <div class="fw-bold">${formatMoney(r.total)}</div>
                        </div>
                        ${r.id_viaje ? `
                            <div class="remito-viaje">
                                <i class="bi bi-truck"></i> Viaje #${r.id_viaje}
                                ${r.chofer ? ' · ' + escapeHTML(r.chofer) : ''}
                                ${r.patente ? ' · ' + escapeHTML(r.patente) : ''}
                            </div>
                        ` : ''}
                        ${r.items && r.items.length > 0 ? `
                            <div class="remito-items-preview">
                                ${r.items.slice(0, 3).map(function(i) {
                                    return '<div class="item-mini"><span class="cant">' + i.cantidad +
                                        '</span><span class="desc">' + escapeHTML(i.descripcion) + '</span></div>';
                                }).join('')}
                                ${r.items.length > 3 ? '<div class="text-muted small">+' + (r.items.length - 3) + ' más...</div>' : ''}
                            </div>
                        ` : ''}
                    </div>
                    <div class="remito-actions">
                        <button class="btn btn-sm btn-outline-secondary"
                                onclick="event.stopPropagation();imprimirRemitoConConfirmacion(${r.id_remito}, ${vecesImpreso})">
                            <i class="bi bi-printer"></i> ${vecesImpreso > 0 ? 'Reimprimir' : 'Imprimir'}
                        </button>
                    </div>
                </div>
            `;
        });

        remitosHTML += '</div>';
    } else {
        remitosHTML = `
            <div class="text-center py-5 text-muted">
                <i class="bi bi-inbox" style="font-size:3rem;"></i>
                <p class="mt-2 mb-0">Sin remitos generados</p>
            </div>
        `;
    }

    document.getElementById('remitosPedidoLista').innerHTML = remitosHTML;

    // Resumen de entregas
    let resumenHTML = '';
    if (resumen_entregas && resumen_entregas.length > 0) {
        resumenHTML = `
            <div class="resumen-entregas mt-3">
                <h6 class="mb-2"><i class="bi bi-bar-chart"></i> Resumen de entregas</h6>
                <table class="table table-sm table-bordered mb-0">
                    <thead class="table-light">
                        <tr>
                            <th>Producto</th>
                            <th class="text-center">Original</th>
                            <th class="text-center text-success">Entregado</th>
                            <th class="text-center text-primary">En tránsito</th>
                            <th class="text-center text-warning">Pendiente</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${resumen_entregas.map(function(item) {
                            return '<tr>' +
                                '<td>' + escapeHTML(item.producto) + '</td>' +
                                '<td class="text-center">' + item.cantidad_original + '</td>' +
                                '<td class="text-center text-success">' + item.entregado + '</td>' +
                                '<td class="text-center text-primary">' + item.en_transito + '</td>' +
                                '<td class="text-center text-warning">' + (item.cantidad_original - item.entregado - item.en_transito) + '</td>' +
                                '</tr>';
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    document.getElementById('remitosPedidoResumen').innerHTML = resumenHTML;
}

// [ELIMINADO] crearCardPedidoConRemitos — 0 callers, código muerto duplicado de crearCardPedido
// [LIMPIADO] reasignación a crearCardPedidoConRemitos eliminada — crearCardPedido es la única versión
if(!document.getElementById('estilos-remitos-pedido')){var estilos=document.createElement('style');estilos.id='estilos-remitos-pedido';estilos.textContent='.search-section-header{padding:10px 15px;background:#f8f9fa;border-bottom:1px solid #e0e0e0;font-size:11px;font-weight:700;color:#666;text-transform:uppercase}.search-result-item{display:flex;align-items:center;padding:12px 15px;cursor:pointer;border-bottom:1px solid #f0f0f0}.search-result-item:hover{background:#f5f5f5}.search-result-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-right:12px}.search-result-icon.pedido{background:#e3f2fd;color:#1565c0}.search-result-icon.remito{background:#fce4ec;color:#c2185b}.search-result-content{flex:1}.search-result-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.search-result-subtitle{font-size:12px;color:#666;margin-top:2px}.search-result-actions{display:flex;gap:4px}.badge-estado-mini{font-size:10px;padding:2px 8px;border-radius:10px}.badge-remitos-count{font-size:10px;padding:2px 8px;border-radius:10px;background:#e8f5e9;color:#2e7d32}.badge-reimpreso{font-size:10px;padding:2px 6px;border-radius:8px;background:#ffebee;color:#c62828}.badge-impreso-ok{font-size:10px;color:#4caf50}.search-no-results{padding:40px 20px;text-align:center}.pedido-info-card{background:#f8f9fa;border-radius:8px;padding:15px;margin-bottom:20px;border:1px solid #e0e0e0}.pedido-info-card .info-item{margin-bottom:5px;font-size:13px}.pedido-info-card .info-item a{color:#1565c0}.remitos-lista{display:flex;flex-direction:column;gap:12px}.remito-card{border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;background:#fff}.remito-card:hover{border-color:#1a4d8f;box-shadow:0 2px 8px rgba(26,77,143,.15)}.remito-header{display:flex;justify-content:space-between;padding:10px 15px;background:#f8f9fa;border-bottom:1px solid #e0e0e0}.remito-numero{font-weight:700;color:#1a4d8f}.remito-badges{display:flex;gap:8px}.remito-badges .badge-estado{font-size:11px;padding:3px 10px;border-radius:12px}.remito-badges .badge-impreso{font-size:11px;padding:3px 8px;border-radius:8px;background:#fff3e0;color:#e65100}.remito-body{padding:12px 15px}.remito-info{display:flex;gap:15px;flex-wrap:wrap;font-size:13px;color:#555}.remito-viaje{margin-top:8px;padding-top:8px;border-top:1px dashed #e0e0e0;font-size:12px;color:#666}.remito-items-preview{margin-top:10px;padding-top:10px;border-top:1px dashed #e0e0e0}.remito-items-preview .item-mini{display:flex;gap:8px;font-size:12px;padding:2px 0}.remito-items-preview .item-mini .cant{font-weight:600;color:#1a4d8f;min-width:30px}.remito-actions{padding:10px 15px;background:#fafafa;border-top:1px solid #e0e0e0;display:flex;justify-content:flex-end}.resumen-entregas{background:#f8f9fa;border-radius:8px;padding:15px;border:1px solid #e0e0e0}.resumen-entregas h6{color:#1a4d8f;font-size:13px}';document.head.appendChild(estilos)}
console.log('✅ Parche Búsqueda Global + Ver Remitos cargado');

function eliminarItemCarga(idPedido, idItem) {
    const carga = Estado.carga.find(c => c.id_pedido === idPedido);
    if (!carga) return;
    // Registrar item eliminado para enviar cantidad 0 al despachar
    if (!carga._itemsEliminados) carga._itemsEliminados = [];
    carga._itemsEliminados.push(idItem);
    carga.items = carga.items.filter(i => i.id_item !== idItem);
    if (carga.items.length === 0) {
        quitarDelViaje(idPedido);
        return;
    }
    actualizarCargaUI();
}

// Fix: posicionar dropdowns de viaje correctamente con position:fixed
document.addEventListener('shown.bs.dropdown', function(e) {
    const menu = e.target.nextElementSibling || e.target.parentElement.querySelector('.dropdown-menu');
    const btn = e.target;
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + 2) + 'px';
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - rect.right) + 'px';
});


// ═══════════════════════════════════════════════════════════════
// COBRO EN DESPACHOS
// ═══════════════════════════════════════════════════════════════

let cobroActual = null;

function abrirModalCobro(idRemito, idPedido, nroRemito, saldo, cliente) {
    cobroActual = { idRemito: idRemito, idPedido: idPedido, nroRemito: nroRemito, saldo: saldo, cliente: cliente, idMetodoPago: 1 };
    var modal = document.getElementById('modalCobro');
    document.getElementById('cobroRemitoInfo').textContent = nroRemito + ' - ' + cliente;
    document.getElementById('cobroPedidoInfo').textContent = 'Pedido #' + idPedido;
    document.getElementById('cobroSaldoInfo').textContent = '$' + formatMoney(saldo);
    document.getElementById('cobroMonto').value = saldo;
    document.getElementById('cobroReferencia').value = '';
    document.querySelectorAll('.cobro-metodo-btn').forEach(function(btn) { btn.classList.remove('active'); });
    var btnEf = document.querySelector('.cobro-metodo-btn[data-metodo="1"]');
    if (btnEf) btnEf.classList.add('active');
    document.getElementById('btnConfirmarCobro').disabled = false;
    new bootstrap.Modal(modal).show();
}

function seleccionarMetodoCobro(btn, idMetodo) {
    document.querySelectorAll('.cobro-metodo-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    cobroActual.idMetodoPago = idMetodo;
}

async function confirmarCobro() {
    var monto = parseFloat(document.getElementById('cobroMonto').value);
    var referencia = document.getElementById('cobroReferencia').value.trim();
    var idMetodoPago = cobroActual.idMetodoPago;
    if (monto > cobroActual.saldo + 0.01) { mostrarToast('El monto excede el saldo', 'warning'); return; }
    document.getElementById('btnConfirmarCobro').disabled = true;
    try {
        var response = await fetchAPI('/remito/' + cobroActual.idRemito + '/cobrar', {
            method: 'POST',
            body: { id_metodo_pago: idMetodoPago, monto: monto, referencia: referencia || null }
        });
        bootstrap.Modal.getInstance(document.getElementById('modalCobro')).hide();
        mostrarToast('Cobro registrado - ' + response.numero_recibo + ' | Saldo: $' + formatMoney(response.saldo_restante), 'success');
        cargarViajes();
    } catch (error) {
        document.getElementById('btnConfirmarCobro').disabled = false;
        var msg = error.message || String(error);
        if (msg.indexOf('caja') > -1) { mostrarToast('Debe abrir la caja antes de cobrar', 'danger'); }
        else { mostrarToast('Error: ' + msg, 'danger'); }
    }
}


// ===================================================================
// EDICION DE OBSERVACIONES DE REMITO (Fase 5 - 2026-05-04)
// ===================================================================

async function abrirModalEditarObs(idRemito) {
    try {
        const r = (window.viajesCache || []).flatMap(v => v.remitos || []).find(x => x.id_remito === idRemito);

        const obsActual = r?.observaciones || '';
        const numeroRemito = r?.numero_completo || ('#' + idRemito);
        const editadoPor = r?.observaciones_editado_por_username || null;
        const editadoEn = r?.observaciones_editado_en || null;

        document.getElementById('modalEditarObsNumero').textContent = numeroRemito;
        document.getElementById('modalEditarObsTextarea').value = obsActual;
        document.getElementById('modalEditarObsIdRemito').value = idRemito;

        const auditoria = document.getElementById('modalEditarObsAuditoria');
        if (editadoPor && editadoEn) {
            const fecha = new Date(editadoEn).toLocaleString('es-AR', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
            auditoria.innerHTML = '<i class="bi bi-clock-history"></i> Ultima edicion: <strong>' + escapeHTML(editadoPor) + '</strong> &middot; ' + fecha;
            auditoria.classList.remove('d-none');
        } else {
            auditoria.innerHTML = '';
            auditoria.classList.add('d-none');
        }

        const modal = new bootstrap.Modal(document.getElementById('modalEditarObs'));
        modal.show();
        setTimeout(() => document.getElementById('modalEditarObsTextarea').focus(), 250);
    } catch (error) {
        console.error('Error al abrir modal editar obs:', error);
        mostrarToast('Error al abrir el editor: ' + error.message, 'danger');
    }
}

async function guardarObsRemito() {
    const idRemito = parseInt(document.getElementById('modalEditarObsIdRemito').value, 10);
    const nuevaObs = document.getElementById('modalEditarObsTextarea').value;
    const btnGuardar = document.getElementById('modalEditarObsBtnGuardar');

    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';

    try {
        const token = getToken();
        const baseApi = (window.CONFIG?.API_BASE_URL || '/api');

        const resp = await fetch(baseApi + '/despachos/remito/' + idRemito + '/observaciones', {
            method: 'PATCH',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ observaciones: nuevaObs })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || ('HTTP ' + resp.status));
        }

        bootstrap.Modal.getInstance(document.getElementById('modalEditarObs')).hide();
        mostrarToast('Observaciones actualizadas', 'success');

        if (typeof cargarViajes === 'function') {
            await cargarViajes();
        }
    } catch (error) {
        console.error('Error al guardar obs:', error);
        mostrarToast('Error al guardar: ' + error.message, 'danger');
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = '<i class="bi bi-check-lg"></i> Guardar';
    }
}


// ===================================================================
// EDICION DE OBSERVACIONES DE PEDIDO (Fase 7 - 2026-05-04)
// Edita pedidos.observaciones via PUT /api/pedidos/:id/campos
// ===================================================================

async function abrirModalEditarObsPedido(idPedido) {
    try {
        const token = getToken();
        const baseApi = (window.CONFIG?.API_BASE_URL || '/api');

        // Buscar pedido en cache local (Estado.pedidosDisponibles es la variable real)
        let pedido = (typeof Estado !== 'undefined' && Estado.pedidosDisponibles)
            ? Estado.pedidosDisponibles.find(p => p.id_pedido === idPedido)
            : null;

        // Si no esta en cache, fetch a /pedidos/:id/detalle (ruta que SI existe)
        if (!pedido) {
            try {
                const resp = await fetch(baseApi + '/pedidos/' + idPedido + '/detalle', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    pedido = data.pedido || data;
                }
            } catch(e) { /* fallback silencioso, abrimos modal con textarea vacio */ }
        }

        const obsActual = pedido?.observaciones || '';
        const numeroPedido = pedido?.id_pedido || idPedido;
        const cliente = pedido?.cliente || pedido?.razon_social || '';

        // Buscar ultima edicion en historial
        let auditoriaTxt = '';
        try {
            const respHist = await fetch(baseApi + '/pedidos/' + idPedido + '/historial', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (respHist.ok) {
                const hist = await respHist.json();
                const ultEdit = (hist.movimientos || hist || []).find(h => h.accion === 'OBSERVACIONES_EDITADAS');
                if (ultEdit) {
                    const f = new Date(ultEdit.fecha).toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit'
                    });
                    auditoriaTxt = '<i class="bi bi-clock-history"></i> Ultima edicion: <strong>' + escapeHTML(ultEdit.usuario || '?') + '</strong> &middot; ' + f;
                }
            }
        } catch(e) { /* historial es informativo, no bloquea */ }

        document.getElementById('modalEditarObsPedidoNumero').textContent = '#' + numeroPedido + (cliente ? ' - ' + cliente : '');
        document.getElementById('modalEditarObsPedidoTextarea').value = obsActual;
        document.getElementById('modalEditarObsPedidoIdPedido').value = idPedido;

        const audDiv = document.getElementById('modalEditarObsPedidoAuditoria');
        if (auditoriaTxt) {
            audDiv.innerHTML = auditoriaTxt;
            audDiv.classList.remove('d-none');
        } else {
            audDiv.innerHTML = '';
            audDiv.classList.add('d-none');
        }

        const modal = new bootstrap.Modal(document.getElementById('modalEditarObsPedido'));
        modal.show();
        setTimeout(() => document.getElementById('modalEditarObsPedidoTextarea').focus(), 250);
    } catch (error) {
        console.error('Error al abrir modal obs pedido:', error);
        mostrarToast('Error al abrir editor: ' + error.message, 'danger');
    }
}

async function guardarObsPedido() {
    const idPedido = parseInt(document.getElementById('modalEditarObsPedidoIdPedido').value, 10);
    const nuevaObs = document.getElementById('modalEditarObsPedidoTextarea').value;
    const btn = document.getElementById('modalEditarObsPedidoBtnGuardar');

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Guardando...';

    try {
        const token = getToken();
        const baseApi = (window.CONFIG?.API_BASE_URL || '/api');

        const resp = await fetch(baseApi + '/pedidos/' + idPedido + '/campos', {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ campos: { observaciones: nuevaObs } })
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || ('HTTP ' + resp.status));
        }

        bootstrap.Modal.getInstance(document.getElementById('modalEditarObsPedido')).hide();
        mostrarToast('Observacion del pedido actualizada', 'success');

        if (typeof cargarPedidosDisponibles === 'function') {
            await cargarPedidosDisponibles();
        }
    } catch (error) {
        console.error('Error al guardar obs pedido:', error);
        mostrarToast('Error al guardar: ' + error.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> Guardar';
    }
}
