/**
 * MÓDULO REUTILIZABLE: Gestión de Pagos
 * Sistema de 1 clic = pago total | 2 clics = pago parcial
 */

class GestionPagos {
    constructor(config = {}) {
        this.pagosRegistrados = [];
        this.clickTimer = null;
        this.formaParcialActual = null;
        
        // Callbacks
        this.onPagoAgregado = config.onPagoAgregado || (() => {});
        this.onPagoEliminado = config.onPagoEliminado || (() => {});
        this.onActualizar = config.onActualizar || (() => {});
        
        // Configuración
        this.mostrarResumen = config.mostrarResumen !== false;
        this.permitirSaldoPendiente = config.permitirSaldoPendiente !== false;
        
        // Nombres de formas
        this.nombresForma = {
            'efectivo': '💵 Efectivo',
            'debito': '💳 Débito',
            'credito': '💳 Crédito',
            'transferencia': '🏦 Transferencia',
            'mercadopago': '💰 Mercado Pago',
            'mercadopago_qr': '📱 MP QR',
            'cheque': '📝 Cheque'
        };
        
        // IDs de formas de pago (según tu BD)
        this.idsForma = {
            'efectivo': 1,
            'credito': 2,
            'debito': 3,
            'transferencia': 4,
            'mercadopago': 5,
            'cheque': 6
        };
    }
    
    /**
     * Maneja el clic simple en un botón de forma de pago
     */
    manejarClic(forma, totalAPagar) {
        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
            return;
        }
        
        this.clickTimer = setTimeout(() => {
            this.clickTimer = null;
            this.pagarTotal(forma, totalAPagar);
        }, 250);
    }
    
    /**
     * Maneja el doble clic en un botón de forma de pago
     */
    manejarDobleClic(forma, totalAPagar) {
        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }
        this.iniciarPagoParcial(forma, totalAPagar);
    }
    
    /**
     * Paga todo el saldo restante con una forma de pago
     */
    pagarTotal(forma, totalAPagar) {
        const totalPagado = this.obtenerTotalPagado();
        const saldoRestante = totalAPagar - totalPagado;
        
        if (saldoRestante <= 0.01) {
            alert('El pago ya está completo');
            return;
        }
        
        this.agregarPago({
            forma: forma,
            id_forma_pago: this.idsForma[forma],
            monto: saldoRestante,
            es_completo: this.pagosRegistrados.length === 0
        });
    }
    
    /**
     * Inicia el modo de pago parcial
     */
    iniciarPagoParcial(forma, totalAPagar) {
        const totalPagado = this.obtenerTotalPagado();
        const saldoRestante = totalAPagar - totalPagado;
        
        if (saldoRestante <= 0.01) {
            alert('El pago ya está completo');
            return;
        }
        
        this.formaParcialActual = forma;
        this.onActualizar({
            tipo: 'iniciar_parcial',
            forma: forma,
            saldoRestante: saldoRestante
        });
    }
    
    /**
     * Confirma un pago parcial
     */
    confirmarPagoParcial(monto, totalAPagar) {
        const montoNum = parseFloat(monto);
        
        if (!montoNum || montoNum <= 0) {
            alert('Ingresa un monto válido');
            return false;
        }
        
        const totalPagado = this.obtenerTotalPagado();
        const saldoRestante = totalAPagar - totalPagado;
        
        if (montoNum > saldoRestante + 0.01) {
            alert(`El monto no puede ser mayor al saldo restante ($${saldoRestante.toFixed(2)})`);
            return false;
        }
        
        this.agregarPago({
            forma: this.formaParcialActual,
            id_forma_pago: this.idsForma[this.formaParcialActual],
            monto: montoNum,
            es_completo: false
        });
        
        this.formaParcialActual = null;
        this.onActualizar({ tipo: 'cancelar_parcial' });
        return true;
    }
    
    /**
     * Cancela el modo de pago parcial
     */
    cancelarPagoParcial() {
        this.formaParcialActual = null;
        this.onActualizar({ tipo: 'cancelar_parcial' });
    }
    
    /**
     * Agrega un pago a la lista
     */
    agregarPago(pago) {
        this.pagosRegistrados.push(pago);
        this.onPagoAgregado(pago);
        this.onActualizar({ tipo: 'pago_agregado', pagos: this.pagosRegistrados });
    }
    
    /**
     * Elimina un pago de la lista
     */
    eliminarPago(index) {
        const pago = this.pagosRegistrados[index];
        this.pagosRegistrados.splice(index, 1);
        this.onPagoEliminado(pago);
        this.onActualizar({ tipo: 'pago_eliminado', pagos: this.pagosRegistrados });
    }
    
    /**
     * Obtiene el total pagado hasta el momento
     */
    obtenerTotalPagado() {
        return this.pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    }
    
    /**
     * Obtiene todos los pagos registrados
     */
    obtenerPagos() {
        return this.pagosRegistrados;
    }
    
    /**
     * Limpia todos los pagos
     */
    limpiar() {
        this.pagosRegistrados = [];
        this.formaParcialActual = null;
        if (this.clickTimer) {
            clearTimeout(this.clickTimer);
            this.clickTimer = null;
        }
        this.onActualizar({ tipo: 'limpiar' });
    }
    
    /**
     * Renderiza la lista de pagos en HTML
     */
    renderizarPagos() {
        if (this.pagosRegistrados.length === 0) {
            return '<p class="text-muted">No hay formas de pago agregadas</p>';
        }
        
        return this.pagosRegistrados.map((pago, index) => `
            <div class="pago-item mb-2 p-2 border-start border-4 border-primary bg-light">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${this.nombresForma[pago.forma]}</strong>
                        ${pago.es_completo ? '<span class="badge bg-success ms-1">Total</span>' : '<span class="badge bg-info ms-1">Parcial</span>'}
                        <br>
                        <span class="text-success fw-bold">$${pago.monto.toFixed(2)}</span>
                    </div>
                    <button class="btn btn-sm btn-danger" onclick="gestionPagos.eliminarPago(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }
}

// Exportar para uso global
window.GestionPagos = GestionPagos;
