// ============================================
// MÓDULO REUTILIZABLE PARA ACCIONES DE DOCUMENTOS (v2.2 - CORREGIDO)
// Ubicación: /frontend/js/documento-actions.js
// Cambios: Arreglado SyntaxError, Detección de sesión WhatsApp, Mejor manejo de teléfono
// ============================================

const DocumentoActions = (function() {
    'use strict';

    // Configuración
    const API_URL = window.CONFIG?.API_BASE_URL || '/api';
    let whatsappWindow = null; // Rastrear ventana de WhatsApp

    /**
     * Obtener token de autenticación
     */
    function getAuthToken() {
        return localStorage.getItem('authToken');
    }

    /**
     * Realizar petición fetch con autenticación
     */
    async function fetchWithAuth(url, options = {}) {
        const headers = {
            'Authorization': `Bearer ${getAuthToken()}`,
            ...options.headers
        };

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error en la petición');
        }

        return response;
    }

    /**
     * Mostrar notificación toast
     */
    function mostrarNotificacion(mensaje, tipo = 'info') {
        // Crear elemento si no existe
        let container = document.getElementById('notificacionesContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notificacionesContainer';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 400px;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        const colores = {
            success: '#28a745',
            error: '#dc3545',
            info: '#0d6efd',
            warning: '#ffc107'
        };

        toast.style.cssText = `
            background: ${colores[tipo] || colores.info};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
            font-size: 14px;
        `;

        toast.textContent = mensaje;
        container.appendChild(toast);

        // Auto-remover después de 5 segundos
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    /**
     * Descargar PDF de un documento
     */
    async function descargarPDF(tipo, id) {
        try {
            mostrarNotificacion('Generando PDF...', 'info');
            const url = `${API_URL}/${tipo}/${id}/pdf`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });

            if (!response.ok) {
                throw new Error('Error al generar PDF');
            }

            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `${tipo}_${id}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(blobUrl);

            mostrarNotificacion('PDF descargado correctamente', 'success');
            return { success: true };
        } catch (error) {
            console.error('Error al descargar PDF:', error);
            mostrarNotificacion('Error al descargar PDF: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Enviar documento por email
     */
    async function enviarEmail(tipo, id, opciones = {}) {
        try {
            mostrarNotificacion('Enviando email...', 'info');
            const url = `${API_URL}/${tipo}/${id}/email`;
            
            const response = await fetchWithAuth(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(opciones)
            });

            const result = await response.json();
            
            if (result.success) {
                mostrarNotificacion('Email enviado a: ' + result.destinatario, 'success');
            }
            
            return result;
        } catch (error) {
            console.error('Error al enviar email:', error);
            mostrarNotificacion('Error al enviar email: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Verificar si hay sesión de WhatsApp abierta
     */
    function verificarSesionWhatsApp() {
        if (whatsappWindow && !whatsappWindow.closed) {
            console.log('✅ Sesión de WhatsApp detectada');
            return true;
        }
        console.log('❌ No hay sesión de WhatsApp abierta');
        return false;
    }

    /**
     * Cerrar sesión anterior de WhatsApp
     */
    function cerrarSesionWhatsAppAnterior() {
        if (whatsappWindow && !whatsappWindow.closed) {
            console.log('🔴 Cerrando sesión anterior de WhatsApp');
            whatsappWindow.close();
        }
        whatsappWindow = null;
    }

    /**
     * Abre WhatsApp de forma inteligente
     */
    function abrirWhatsAppInteligente(link) {
        console.log('🔗 Abriendo link:', link);
        
        // Si ya hay ventana abierta, reutilizar
        if (verificarSesionWhatsApp()) {
            console.log('📱 Reutilizando ventana existente');
            whatsappWindow.location.href = link;
            whatsappWindow.focus();
            return whatsappWindow;
        }
        
        // Si no, abrir nueva
        console.log('📱 Abriendo nueva ventana');
        whatsappWindow = window.open(link, 'WhatsApp_LAGO', 'width=800,height=600,resizable=yes');
        
        if (!whatsappWindow) {
            throw new Error('No se pudo abrir WhatsApp. El navegador puede estar bloqueando ventanas emergentes.');
        }
        
        return whatsappWindow;
    }

    /**
     * Enviar documento por WhatsApp (MEJORADO v2.2)
     */
    async function enviarWhatsApp(tipo, id) {
        try {
            mostrarNotificacion('Preparando WhatsApp...', 'info');
            const url = `${API_URL}/${tipo}/${id}/whatsapp`;
            
            console.log('🔍 Enviando petición WhatsApp a:', url);
            console.log('📱 Estado de sesión actual:', verificarSesionWhatsApp() ? 'Abierta' : 'Cerrada');
            
            const response = await fetchWithAuth(url);
            const result = await response.json();

            console.log('✅ Respuesta del servidor:', result);

            if (!result.success) {
                throw new Error(result.error || 'No se pudo generar el link de WhatsApp');
            }

            // Si requiere teléfono
            if (result.requiere_telefono) {
                console.log('📱 Se requiere teléfono, abriendo modal');
                mostrarModalTelefono(tipo, id, result.pedido);
                return result;
            }

            // Si tiene link de WhatsApp
            if (result.whatsapp_link) {
                mostrarNotificacion('Abriendo WhatsApp...', 'success');
                console.log('🌐 Link WhatsApp generado:', result.whatsapp_link);
                
                // Abrir con reutilización de ventana
                setTimeout(() => {
                    try {
                        abrirWhatsAppInteligente(result.whatsapp_link);
                    } catch (err) {
                        mostrarNotificacion('Error: ' + err.message, 'error');
                    }
                }, 300);
                
                console.log('📱 WhatsApp enviado:', {
                    tipo: tipo,
                    id: id,
                    telefono: result.telefono,
                    timestamp: new Date()
                });
                
                return result;
            } else {
                throw new Error('No se recibió link de WhatsApp válido. Respuesta: ' + JSON.stringify(result));
            }

        } catch (error) {
            console.error('❌ Error completo al enviar WhatsApp:', error);
            console.error('Mensaje:', error.message);
            console.error('Stack:', error.stack);
            mostrarNotificacion('Error: ' + error.message, 'error');
            throw error;
        }
    }

    /**
     * Modal para solicitar teléfono cuando no existe - CORREGIDO
     */
    function mostrarModalTelefono(tipo, id, datosDocumento) {
        console.log('📋 Abriendo modal de teléfono para:', datosDocumento);
        
        // Crear contenedor del modal
        const modalContainer = document.createElement('div');
        modalContainer.id = 'modalTelefonoContainer';
        modalContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;

        // Crear modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            border-radius: 8px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
            max-width: 500px;
            width: 90%;
            padding: 0;
        `;

        modal.innerHTML = `
            <div style="background: #25D366; color: white; padding: 15px; border-radius: 8px 8px 0 0; display: flex; justify-content: space-between; align-items: center;">
                <h5 style="margin: 0; font-size: 18px;">
                    <i class="bi bi-whatsapp"></i> Enviar por WhatsApp
                </h5>
                <button style="background: none; border: none; color: white; font-size: 24px; cursor: pointer; padding: 0;" onclick="document.getElementById('modalTelefonoContainer').remove();">
                    ×
                </button>
            </div>

            <div style="padding: 20px;">
                <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 12px; border-radius: 4px; margin-bottom: 20px; color: #1565c0;">
                    <i class="bi bi-info-circle"></i> 
                    <strong>Cliente sin teléfono registrado</strong>. Ingrese el número de WhatsApp para enviar.
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-weight: bold; margin-bottom: 5px;">Cliente:</label>
                    <p style="margin: 0; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                        ${datosDocumento.cliente || 'No especificado'}
                    </p>
                </div>

                <div style="margin-bottom: 15px;">
                    <label style="display: block; font-weight: bold; margin-bottom: 5px;" for="telefonoWhatsAppInput">
                        Número de WhatsApp *
                    </label>
                    <input 
                        id="telefonoWhatsAppInput"
                        type="tel" 
                        placeholder="Ej: +54 9 11 2345-6789 o 1123456789"
                        style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 16px; box-sizing: border-box;"
                        autocomplete="tel"
                        autofocus
                    />
                    <small style="display: block; margin-top: 5px; color: #666;">
                        Incluya el código de país (+54 para Argentina)
                    </small>
                </div>

                <div id="errorTelefonoModal" style="display: none; background: #ffebee; border-left: 4px solid #f44336; padding: 12px; border-radius: 4px; margin-bottom: 15px; color: #c62828;">
                </div>
            </div>

            <div style="padding: 15px; border-top: 1px solid #eee; display: flex; gap: 10px; justify-content: flex-end;">
                <button onclick="document.getElementById('modalTelefonoContainer').remove();" style="padding: 10px 20px; border: 1px solid #ccc; background: white; border-radius: 4px; cursor: pointer;">
                    Cancelar
                </button>
                <button id="btnEnviarTelefonoModal" style="padding: 10px 20px; background: #25D366; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                    <i class="bi bi-whatsapp"></i> Enviar
                </button>
            </div>
        `;

        modalContainer.appendChild(modal);
        document.body.appendChild(modalContainer);

        // Configurar evento del botón
        const btnEnviar = document.getElementById('btnEnviarTelefonoModal');
        const inputTelefono = document.getElementById('telefonoWhatsAppInput');
        const errorDiv = document.getElementById('errorTelefonoModal');

        btnEnviar.onclick = async function() {
            const telefono = inputTelefono.value.trim();

            if (!telefono) {
                errorDiv.textContent = 'Ingrese un número de teléfono';
                errorDiv.style.display = 'block';
                return;
            }

            try {
                btnEnviar.disabled = true;
                btnEnviar.textContent = '⏳ Abriendo...';
                errorDiv.style.display = 'none';

                // Formatear teléfono
                let telefonoFormato = telefono.replace(/\D/g, '');
                if (!telefonoFormato.startsWith('54') && telefonoFormato.length === 10) {
                    telefonoFormato = '54' + telefonoFormato;
                }

                console.log('📞 Teléfono ingresado:', telefono);
                console.log('📞 Teléfono formateado:', telefonoFormato);

                // Crear mensaje genérico
                const mensaje = `Hola, le enviamos los detalles de su ${tipo === 'pedidos' ? 'pedido' : 'documento'}. Para ver el detalle completo, favor de imprimir o guardar como PDF.`;
                const whatsappLink = `https://wa.me/${telefonoFormato}?text=${encodeURIComponent(mensaje)}`;

                console.log('🌐 Link generado:', whatsappLink);

                // Abrir WhatsApp
                abrirWhatsAppInteligente(whatsappLink);
                
                mostrarNotificacion('WhatsApp abierto correctamente', 'success');
                
                // Cerrar modal después de un tiempo
                setTimeout(() => {
                    modalContainer.remove();
                }, 1000);

            } catch (error) {
                console.error('Error:', error);
                errorDiv.textContent = 'Error: ' + error.message;
                errorDiv.style.display = 'block';
                btnEnviar.disabled = false;
                btnEnviar.textContent = 'Enviar';
            }
        };

        // Permitir Enter para enviar
        inputTelefono.onkeypress = function(e) {
            if (e.key === 'Enter') {
                btnEnviar.click();
            }
        };

        // Cerrar con Escape
        document.onkeydown = function(e) {
            if (e.key === 'Escape') {
                modalContainer.remove();
            }
        };
    }

    /**
     * Mostrar modal de email (Bootstrap)
     */
    function mostrarModalEmail(tipo, id, emailDefault = '') {
        let modal = document.getElementById('modalEnviarEmail');
        
        if (!modal) {
            const modalHTML = `
                <div class="modal fade" id="modalEnviarEmail" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header bg-primary text-white">
                                <h5 class="modal-title">
                                    <i class="bi bi-envelope"></i> Enviar por Email
                                </h5>
                                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="formEnviarEmail">
                                    <div class="mb-3">
                                        <label class="form-label"><strong>Email destino *</strong></label>
                                        <input type="email" class="form-control" id="emailDestino" required>
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Asunto (opcional)</label>
                                        <input type="text" class="form-control" id="emailAsunto">
                                    </div>
                                    <div class="mb-3">
                                        <label class="form-label">Mensaje (opcional)</label>
                                        <textarea class="form-control" id="emailMensaje" rows="4"></textarea>
                                    </div>
                                    <div id="emailError" class="alert alert-danger d-none"></div>
                                    <div id="emailExito" class="alert alert-success d-none"></div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                                <button type="button" class="btn btn-primary" id="btnEnviarEmail">
                                    <i class="bi bi-send"></i> Enviar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            modal = document.getElementById('modalEnviarEmail');
        }

        // Configurar email por defecto
        document.getElementById('emailDestino').value = emailDefault;
        document.getElementById('emailAsunto').value = '';
        document.getElementById('emailMensaje').value = '';
        document.getElementById('emailError').classList.add('d-none');
        document.getElementById('emailExito').classList.add('d-none');

        // Configurar botón de envío
        const btnEnviar = document.getElementById('btnEnviarEmail');
        btnEnviar.onclick = async function() {
            const emailDestino = document.getElementById('emailDestino').value.trim();
            const asunto = document.getElementById('emailAsunto').value.trim();
            const mensaje = document.getElementById('emailMensaje').value.trim();

            if (!emailDestino) {
                mostrarErrorModal('Por favor ingrese un email destino');
                return;
            }

            btnEnviar.disabled = true;
            btnEnviar.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Enviando...';

            try {
                const result = await enviarEmail(tipo, id, {
                    email_destino: emailDestino,
                    asunto: asunto || undefined,
                    mensaje: mensaje || undefined
                });

                mostrarExitoModal('Email enviado correctamente a: ' + result.destinatario);
                
                setTimeout(() => {
                    if (typeof bootstrap !== 'undefined') {
                        bootstrap.Modal.getInstance(modal).hide();
                    }
                }, 2000);

            } catch (error) {
                mostrarErrorModal(error.message || 'Error al enviar email');
            } finally {
                btnEnviar.disabled = false;
                btnEnviar.innerHTML = '<i class="bi bi-send"></i> Enviar';
            }
        };

        // Mostrar modal
        if (typeof bootstrap !== 'undefined') {
            const bsModal = new bootstrap.Modal(modal);
            bsModal.show();
        }
    }

    /**
     * Mostrar error en modal
     */
    function mostrarErrorModal(mensaje) {
        const errorDiv = document.getElementById('emailError');
        if (errorDiv) {
            errorDiv.textContent = mensaje;
            errorDiv.classList.remove('d-none');
            document.getElementById('emailExito').classList.add('d-none');
        }
    }

    /**
     * Mostrar éxito en modal
     */
    function mostrarExitoModal(mensaje) {
        const exitoDiv = document.getElementById('emailExito');
        if (exitoDiv) {
            exitoDiv.textContent = mensaje;
            exitoDiv.classList.remove('d-none');
            document.getElementById('emailError').classList.add('d-none');
        }
    }

    /**
     * Imprimir documento actual
     */
    function imprimirDocumento() {
        console.log('🖨️ Imprimiendo documento');
        window.print();
    }

    /**
     * Ver documento en nueva ventana
     */
    function verDocumento(tipo, id) {
        const url = `/ver-${tipo === 'pedidos' ? 'pedido' : tipo.slice(0, -1)}.html?id=${id}`;
        window.open(url, '_blank');
    }

    // Agregar estilos para animaciones
    if (!document.getElementById('documento-actions-styles')) {
        const style = document.createElement('style');
        style.id = 'documento-actions-styles';
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(400px);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }

            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(400px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Exportar funciones públicas
    return {
        descargarPDF,
        enviarEmail,
        enviarWhatsApp,
        mostrarModalEmail,
        mostrarModalTelefono,
        imprimirDocumento,
        verDocumento,
        mostrarNotificacion,
        verificarSesionWhatsApp,
        cerrarSesionWhatsAppAnterior
    };
})();

// Hacer disponible globalmente
window.DocumentoActions = DocumentoActions;
