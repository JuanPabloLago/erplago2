// =======================================================================
//                    PANEL DE CONFIGURACIÓN CON PERMISOS
// =======================================================================

/**
 * Configuración de la API
 */
const CONFIG = {
    API_URL: window.location.hostname === 'localhost' 
        ? 'http://localhost:3000/api' 
        : 'http://72.60.148.18:3000/api'
};

/**
 * Obtiene el token de autenticación del localStorage
 * @returns {string|null} Token de autenticación
 */
function getAuthToken() {
    return localStorage.getItem('authToken');
}

/**
 * Obtiene los headers para las peticiones autenticadas
 * @returns {object} Headers con autorización
 */
function getAuthHeaders() {
    return {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Carga la configuración del usuario desde el servidor
 * @returns {Promise<object|null>} Configuración y listas de precios
 */
async function cargarConfiguracion() {
    try {
        const [listasRes, configRes] = await Promise.all([
            fetch(`${CONFIG.API_URL}/listas-precios`, {
                headers: getAuthHeaders()
            }),
            fetch(`${CONFIG.API_URL}/configuracion-usuario`, {
                headers: getAuthHeaders()
            })
        ]);
        
        if (!listasRes.ok || !configRes.ok) {
            throw new Error('Error al cargar configuración del servidor');
        }
        
        const listas = await listasRes.json();
        const config = await configRes.json();
        
        return { listas, config };
    } catch (error) {
        console.error('❌ Error al cargar configuración:', error);
        mostrarNotificacion('Error al cargar configuración', 'error');
        return null;
    }
}

/**
 * Guarda la configuración del usuario en el servidor
 * @param {number} id_lista_precio - ID de la lista de precios seleccionada
 * @param {boolean} permitir_venta_sin_stock - Permitir ventas sin stock
 * @returns {Promise<object|null>} Resultado de la operación
 */
async function guardarConfiguracion(id_lista_precio, permitir_venta_sin_stock) {
    try {
        const response = await fetch(`${CONFIG.API_URL}/configuracion-usuario`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                id_lista_precio,
                permitir_venta_sin_stock
            })
        });
        
        if (!response.ok) {
            throw new Error('Error al guardar configuración');
        }
        
        return await response.json();
    } catch (error) {
        console.error('❌ Error al guardar configuración:', error);
        return null;
    }
}

/**
 * Muestra una notificación al usuario
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - Tipo de notificación (success, error, warning, info)
 */
function mostrarNotificacion(mensaje, tipo = 'info') {
    // Si existe Toastify o similar, usarlo
    if (typeof Toastify !== 'undefined') {
        Toastify({
            text: mensaje,
            duration: 3000,
            gravity: 'top',
            position: 'right',
            backgroundColor: tipo === 'success' ? '#10b981' : 
                           tipo === 'error' ? '#ef4444' : 
                           tipo === 'warning' ? '#f59e0b' : '#3b82f6'
        }).showToast();
    } else {
        // Fallback a alert
        alert(mensaje);
    }
}

/**
 * Muestra el panel de configuración modal
 */
function mostrarPanelConfiguracion() {
    const html = `
        <div class="modal fade" id="modalConfiguracion" tabindex="-1" aria-labelledby="modalConfiguracionLabel" aria-hidden="true">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title" id="modalConfiguracionLabel">
                            <i class="bi bi-gear"></i> Configuración de Venta
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Cerrar"></button>
                    </div>
                    <div class="modal-body">
                        <!-- Información del rol -->
                        <div class="mb-3">
                            <label class="form-label fw-bold">
                                <i class="bi bi-person-badge"></i> Rol
                            </label>
                            <div class="input-group">
                                <span class="input-group-text"><i class="bi bi-shield-check"></i></span>
                                <input type="text" class="form-control" id="spanRol" value="" readonly>
                            </div>
                        </div>
                        
                        <!-- Lista de precios -->
                        <div class="mb-3" id="divListaPrecio">
                            <label class="form-label fw-bold" for="selectListaPrecio">
                                <i class="bi bi-tags"></i> Lista de Precios Predeterminada
                            </label>
                            <select class="form-select" id="selectListaPrecio" aria-describedby="helpListaPrecio">
                                <option value="">Cargando...</option>
                            </select>
                            <div id="helpListaPrecio" class="form-text">
                                Esta lista se usará por defecto en todas las ventas
                            </div>
                        </div>
                        
                        <!-- Venta sin stock -->
                        <div class="mb-3" id="divVentaSinStock">
                            <div class="form-check form-switch">
                                <input class="form-check-input" type="checkbox" id="checkVentaSinStock" role="switch" aria-describedby="helpVentaSinStock">
                                <label class="form-check-label fw-bold" for="checkVentaSinStock">
                                    <i class="bi bi-box-seam"></i> Permitir venta sin stock
                                </label>
                            </div>
                            <div id="helpVentaSinStock" class="form-text">
                                Si está activo, podrás vender aunque no haya stock disponible
                            </div>
                        </div>
                        
                        <!-- Nota informativa -->
                        <div class="alert alert-info d-flex align-items-center" role="alert">
                            <i class="bi bi-info-circle me-2 fs-4"></i>
                            <div>
                                <strong>Nota:</strong> Estos cambios se aplicarán solo para tu usuario.
                            </div>
                        </div>
                        
                        <!-- Alerta de permisos limitados -->
                        <div id="alertaPermisos" class="alert alert-warning d-flex align-items-center" role="alert" style="display: none;">
                            <i class="bi bi-shield-exclamation me-2 fs-4"></i>
                            <div>
                                <strong>Permisos limitados:</strong> No tienes permiso para modificar algunas opciones.
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="bi bi-x-circle"></i> Cancelar
                        </button>
                        <button type="button" class="btn btn-primary" id="btnGuardarConfig" onclick="guardarConfigModal()">
                            <i class="bi bi-check-circle"></i> Guardar Cambios
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insertar modal si no existe
    if (!document.getElementById('modalConfiguracion')) {
        document.body.insertAdjacentHTML('beforeend', html);
    }
    
    // Cargar datos del servidor
    cargarConfiguracion().then(data => {
        if (!data) {
            mostrarNotificacion('Error al cargar la configuración', 'error');
            return;
        }
        
        const { listas, config } = data;
        const permisos = config.permisos || {};
        
        // Mostrar rol
        document.getElementById('spanRol').value = config.rol || 'Usuario';
        
        // Configurar lista de precios
        configurarListaPrecios(listas, config, permisos);
        
        // Configurar venta sin stock
        configurarVentaSinStock(config, permisos);
        
        // Mostrar alerta si hay permisos limitados
        mostrarAlertaPermisos(permisos);
        
        // Deshabilitar botón guardar si no tiene ningún permiso
        const btnGuardar = document.getElementById('btnGuardarConfig');
        if (!permisos.puede_cambiar_lista_precios && !permisos.puede_vender_sin_stock) {
            btnGuardar.disabled = true;
            btnGuardar.title = 'No tienes permisos para modificar la configuración';
        }
    });
    
    // Mostrar modal
    const modalElement = document.getElementById('modalConfiguracion');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
}

/**
 * Configura el select de lista de precios según permisos
 * @param {Array} listas - Lista de precios disponibles
 * @param {object} config - Configuración actual del usuario
 * @param {object} permisos - Permisos del usuario
 */
function configurarListaPrecios(listas, config, permisos) {
    const divListaPrecio = document.getElementById('divListaPrecio');
    const selectListaPrecio = document.getElementById('selectListaPrecio');
    
    // Limpiar mensajes anteriores
    const oldWarning = divListaPrecio.querySelector('.text-danger');
    if (oldWarning) oldWarning.remove();
    
    if (permisos.puede_cambiar_lista_precios) {
        // Usuario puede cambiar la lista
        selectListaPrecio.innerHTML = listas.map(l => 
            `<option value="${l.id_lista_precio}" ${l.id_lista_precio === config.id_lista_precio ? 'selected' : ''}>
                ${l.nombre} - ${l.descripcion || ''}
            </option>`
        ).join('');
        selectListaPrecio.disabled = false;
    } else {
        // Usuario NO puede cambiar la lista
        const listaActual = listas.find(l => l.id_lista_precio === config.id_lista_precio);
        selectListaPrecio.innerHTML = `
            <option value="${config.id_lista_precio}">
                ${listaActual ? listaActual.nombre : 'Lista actual'}
            </option>
        `;
        selectListaPrecio.disabled = true;
        
        // Agregar mensaje de advertencia
        divListaPrecio.insertAdjacentHTML('beforeend', 
            '<small class="text-danger d-block mt-1"><i class="bi bi-exclamation-triangle"></i> No tienes permiso para cambiar la lista de precios</small>'
        );
    }
}

/**
 * Configura el checkbox de venta sin stock según permisos
 * @param {object} config - Configuración actual del usuario
 * @param {object} permisos - Permisos del usuario
 */
function configurarVentaSinStock(config, permisos) {
    const divVentaSinStock = document.getElementById('divVentaSinStock');
    const checkVentaSinStock = document.getElementById('checkVentaSinStock');
    
    // Limpiar mensajes anteriores
    const oldWarning = divVentaSinStock.querySelector('.text-danger');
    if (oldWarning) oldWarning.remove();
    
    // Establecer valor actual
    checkVentaSinStock.checked = config.permitir_venta_sin_stock || false;
    
    if (!permisos.puede_vender_sin_stock) {
        // Usuario NO puede modificar esta opción
        checkVentaSinStock.disabled = true;
        
        // Agregar mensaje de advertencia
        divVentaSinStock.insertAdjacentHTML('beforeend', 
            '<small class="text-danger d-block mt-1"><i class="bi bi-exclamation-triangle"></i> No tienes permiso para modificar esta opción</small>'
        );
    } else {
        checkVentaSinStock.disabled = false;
    }
}

/**
 * Muestra alerta si el usuario tiene permisos limitados
 * @param {object} permisos - Permisos del usuario
 */
function mostrarAlertaPermisos(permisos) {
    const alertaPermisos = document.getElementById('alertaPermisos');
    
    if (!permisos.puede_cambiar_lista_precios || !permisos.puede_vender_sin_stock) {
        alertaPermisos.style.display = 'block';
    } else {
        alertaPermisos.style.display = 'none';
    }
}

/**
 * Guarda la configuración desde el modal
 */
async function guardarConfigModal() {
    const btnGuardar = document.getElementById('btnGuardarConfig');
    const btnCancelar = document.querySelector('#modalConfiguracion [data-bs-dismiss="modal"]');
    
    // Deshabilitar botones mientras se guarda
    btnGuardar.disabled = true;
    btnCancelar.disabled = true;
    
    const textoOriginal = btnGuardar.innerHTML;
    btnGuardar.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Guardando...';
    
    try {
        const id_lista_precio = parseInt(document.getElementById('selectListaPrecio').value);
        const permitir_venta_sin_stock = document.getElementById('checkVentaSinStock').checked;
        
        const result = await guardarConfiguracion(id_lista_precio, permitir_venta_sin_stock);
        
        if (result && result.success) {
            mostrarNotificacion('✅ Configuración guardada correctamente', 'success');
            
            // Cerrar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalConfiguracion'));
            modal.hide();
            
            // Recargar configuración global
            await cargarConfigRapida();
            
            // Opcional: recargar página si es necesario
            // location.reload();
        } else {
            throw new Error(result?.error || 'Error desconocido');
        }
    } catch (error) {
        console.error('Error al guardar:', error);
        mostrarNotificacion('❌ Error al guardar configuración', 'error');
    } finally {
        // Rehabilitar botones
        btnGuardar.disabled = false;
        btnCancelar.disabled = false;
        btnGuardar.innerHTML = textoOriginal;
    }
}

// =======================================================================
//                    GESTIÓN DE CONFIGURACIÓN GLOBAL
// =======================================================================

/**
 * Configuración del usuario cargada en memoria
 */
window.configUsuario = null;

/**
 * Carga la configuración rápida en memoria
 * @returns {Promise<object|null>} Configuración del usuario
 */
async function cargarConfigRapida() {
    try {
        const data = await cargarConfiguracion();
        if (data && data.config) {
            window.configUsuario = data.config;
            console.log('✅ Configuración de usuario cargada:', data.config);
            
            // Emitir evento personalizado para que otros componentes sepan que la config está lista
            window.dispatchEvent(new CustomEvent('configCargada', { 
                detail: data.config 
            }));
            
            return data.config;
        }
        return null;
    } catch (error) {
        console.error('❌ Error al cargar configuración rápida:', error);
        return null;
    }
}

/**
 * Obtiene la configuración actual del usuario
 * @returns {object|null} Configuración del usuario
 */
function obtenerConfigUsuario() {
    return window.configUsuario;
}

/**
 * Verifica si el usuario tiene un permiso específico
 * @param {string} permiso - Nombre del permiso a verificar
 * @returns {boolean} True si tiene el permiso
 */
function tienePermiso(permiso) {
    const config = obtenerConfigUsuario();
    if (!config || !config.permisos) return false;
    return config.permisos[permiso] === true;
}

// =======================================================================
//                    INICIALIZACIÓN
// =======================================================================

// Cargar configuración al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
    console.log('🔧 Inicializando panel de configuración...');
    cargarConfigRapida();
});

// Verificar token periódicamente
setInterval(() => {
    const token = getAuthToken();
    if (!token && window.location.pathname !== '/login.html') {
        console.warn('⚠️ No hay token de autenticación');
        window.location.href = 'login.html';
    }
}, 30000); // Cada 30 segundos

// Exponer funciones globalmente para usar desde HTML
window.mostrarPanelConfiguracion = mostrarPanelConfiguracion;
window.guardarConfigModal = guardarConfigModal;
window.obtenerConfigUsuario = obtenerConfigUsuario;
window.tienePermiso = tienePermiso;
