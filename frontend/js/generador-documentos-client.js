/**
 * MÓDULO REUTILIZABLE FRONTEND: Generador de Documentos
 * Uso: import desde cualquier HTML
 */

class GeneradorDocumentosClient {
    constructor(apiUrl, token) {
        this.apiUrl = apiUrl;
        this.token = token;
    }

    /**
     * Muestra modal con opciones de compartir
     */
    mostrarModalCompartir(tipo, id, opciones = {}) {
        const modalId = 'modalCompartirDocumento';
        
        // Crear modal si no existe
        if (!document.getElementById(modalId)) {
            this._crearModal();
        }

        // Configurar modal
        document.getElementById('tituloModalCompartir').textContent = 
            opciones.titulo || `Compartir ${tipo}`;
        
        // Guardar datos en el modal
        const modal = document.getElementById(modalId);
        modal.dataset.tipo = tipo;
        modal.dataset.id = id;
        modal.dataset.endpoint = opciones.endpoint || tipo.toLowerCase() + 's';

        // Mostrar modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
    }

    /**
     * Crea el modal HTML
     */
    _crearModal() {
        const modalHTML = `
            <div class="modal fade" id="modalCompartirDocumento" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header bg-primary text-white">
                            <h5 class="modal-title" id="tituloModalCompartir">Compartir Documento</h5>
                            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="d-grid gap-2">
                                <button class="btn btn-danger btn-lg" onclick="generadorDocs.descargarPDF()">
                                    <i class="bi bi-file-pdf"></i> Descargar PDF
                                </button>
                                
                                <button class="btn btn-success btn-lg" onclick="generadorDocs.compartirWhatsApp()">
                                    <i class="bi bi-whatsapp"></i> Enviar por WhatsApp
                                </button>
                                
                                <button class="btn btn-info btn-lg" onclick="generadorDocs.mostrarFormEmail()">
                                    <i class="bi bi-envelope"></i> Enviar por Email
                                </button>
                                
                                <button class="btn btn-warning btn-lg" onclick="generadorDocs.imprimirDirecto()">
                                    <i class="bi bi-printer"></i> Imprimir
                                </button>
                            </div>

                            <!-- Formulario de email (oculto por defecto) -->
                            <div id="formEmail" style="display: none;" class="mt-3">
                                <hr>
                                <h6>Enviar por Email</h6>
                                <div class="mb-2">
                                    <label class="form-label">Email destino:</label>
                                    <input type="email" class="form-control" id="emailDestino" placeholder="cliente@email.com">
                                </div>
                                <button class="btn btn-primary w-100" onclick="generadorDocs.enviarEmail()">
                                    <i class="bi bi-send"></i> Enviar
                                </button>
                            </div>

                            <!-- Área de estado -->
                            <div id="estadoCompartir" class="mt-3"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
     * Descarga el PDF
     */
    async descargarPDF() {
        const modal = document.getElementById('modalCompartirDocumento');
        const tipo = modal.dataset.tipo;
        const id = modal.dataset.id;
        const endpoint = modal.dataset.endpoint;

        try {
            this._mostrarEstado('Generando PDF...', 'info');

            const response = await fetch(`${this.apiUrl}/${endpoint}/${id}/pdf`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) throw new Error('Error al generar PDF');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${tipo}_${id}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this._mostrarEstado('✅ PDF descargado correctamente', 'success');

        } catch (error) {
            console.error('Error:', error);
            this._mostrarEstado('❌ Error al descargar PDF', 'danger');
        }
    }

    /**
     * Comparte por WhatsApp
     */
    async compartirWhatsApp() {
        const modal = document.getElementById('modalCompartirDocumento');
        const tipo = modal.dataset.tipo;
        const id = modal.dataset.id;
        const endpoint = modal.dataset.endpoint;

        try {
            this._mostrarEstado('Generando link...', 'info');

            const response = await fetch(`${this.apiUrl}/${endpoint}/${id}/whatsapp`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) throw new Error('Error al generar link');

            const data = await response.json();
            window.open(data.link, '_blank');

            this._mostrarEstado('✅ WhatsApp abierto', 'success');

        } catch (error) {
            console.error('Error:', error);
            this._mostrarEstado('❌ Error al abrir WhatsApp', 'danger');
        }
    }

    /**
     * Muestra formulario de email
     */
    mostrarFormEmail() {
        document.getElementById('formEmail').style.display = 'block';
        document.getElementById('emailDestino').focus();
    }

    /**
     * Envía el documento por email
     */
    async enviarEmail() {
        const modal = document.getElementById('modalCompartirDocumento');
        const endpoint = modal.dataset.endpoint;
        const id = modal.dataset.id;
        const email = document.getElementById('emailDestino').value;

        if (!email) {
            this._mostrarEstado('❌ Ingrese un email válido', 'danger');
            return;
        }

        try {
            this._mostrarEstado('Enviando email...', 'info');

            const response = await fetch(`${this.apiUrl}/${endpoint}/${id}/email`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email_destino: email })
            });

            if (!response.ok) throw new Error('Error al enviar email');

            this._mostrarEstado('✅ Email enviado correctamente', 'success');
            document.getElementById('emailDestino').value = '';

        } catch (error) {
            console.error('Error:', error);
            this._mostrarEstado('❌ Error al enviar email', 'danger');
        }
    }

    /**
     * Imprime directamente
     */
    async imprimirDirecto() {
        const modal = document.getElementById('modalCompartirDocumento');
        const endpoint = modal.dataset.endpoint;
        const id = modal.dataset.id;

        try {
            this._mostrarEstado('Preparando impresión...', 'info');

            const response = await fetch(`${this.apiUrl}/${endpoint}/${id}/pdf`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` }
            });

            if (!response.ok) throw new Error('Error al generar PDF');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            
            // Abrir en nueva ventana para imprimir
            const printWindow = window.open(url, '_blank');
            printWindow.addEventListener('load', () => {
                printWindow.print();
            });

            this._mostrarEstado('✅ Ventana de impresión abierta', 'success');

        } catch (error) {
            console.error('Error:', error);
            this._mostrarEstado('❌ Error al imprimir', 'danger');
        }
    }

    /**
     * Exporta a Excel (para listas)
     */
    async exportarExcel(endpoint, filtros = {}) {
        try {
            const response = await fetch(`${this.apiUrl}/${endpoint}/exportar-excel`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(filtros)
            });

            if (!response.ok) throw new Error('Error al exportar');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `export_${Date.now()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            return true;

        } catch (error) {
            console.error('Error:', error);
            alert('Error al exportar a Excel');
            return false;
        }
    }

    /**
     * Muestra estado en el modal
     */
    _mostrarEstado(mensaje, tipo) {
        const div = document.getElementById('estadoCompartir');
        div.innerHTML = `<div class="alert alert-${tipo}">${mensaje}</div>`;
        
        if (tipo === 'success') {
            setTimeout(() => {
                div.innerHTML = '';
            }, 3000);
        }
    }
}

// Exportar para uso global
window.GeneradorDocumentosClient = GeneradorDocumentosClient;
