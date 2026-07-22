const Afip = require('@afipsdk/afip.js');
const fs = require('fs');
const path = require('path');

class AfipService {
    constructor() {
        this.afip = null;
        this.config = null;
        this.initialized = false;
    }

    async initialize(config = null) {
        try {
            if (config) { this.config = config; } else { this.config = require('./config.js'); }
            if (!fs.existsSync(this.config.certPath)) throw new Error(`Certificado no encontrado: ${this.config.certPath}`);
            if (!fs.existsSync(this.config.keyPath)) throw new Error(`Clave privada no encontrada: ${this.config.keyPath}`);
            this.afip = new Afip({ CUIT: this.config.cuit, cert: this.config.certPath, key: this.config.keyPath, production: this.config.produccion });
            this.initialized = true;
            console.log('✅ Servicio AFIP inicializado correctamente');
            return true;
        } catch (error) {
            console.error('❌ Error al inicializar servicio AFIP:', error.message);
            throw error;
        }
    }

    checkInitialized() {
        if (!this.initialized || !this.afip) throw new Error('Servicio AFIP no inicializado');
    }

    async obtenerUltimoComprobante(puntoVenta, tipoComprobante) {
        try {
            this.checkInitialized();
            const ultimoComprobante = await this.afip.ElectronicBilling.getLastVoucher(puntoVenta, tipoComprobante);
            return parseInt(ultimoComprobante);
        } catch (error) {
            throw new Error(`Error al consultar AFIP: ${error.message}`);
        }
    }

    async generarFactura(facturaData) {
        try {
            this.checkInitialized();
            const { puntoVenta, tipoComprobante, numeroComprobante, fechaEmision, clienteTipoDocumento = 80, clienteDocumento, netoGravado, montoIVA, montoTotal } = facturaData;
            if (!puntoVenta || !tipoComprobante || !numeroComprobante) throw new Error('Faltan datos obligatorios');
            if (!clienteDocumento) throw new Error('Falta el documento del cliente');
            const factura = { CantReg: 1, PtoVta: puntoVenta, CbteTipo: tipoComprobante, Concepto: 1, DocTipo: clienteTipoDocumento, DocNro: clienteDocumento.toString().replace(/-/g, ''), CbteDesde: numeroComprobante, CbteHasta: numeroComprobante, CbteFch: fechaEmision ? this.formatearFecha(fechaEmision) : this.formatearFecha(new Date()), ImpTotal: parseFloat(montoTotal).toFixed(2), ImpTotConc: 0, ImpNeto: parseFloat(netoGravado).toFixed(2), ImpOpEx: 0, ImpIVA: parseFloat(montoIVA).toFixed(2), ImpTrib: 0, MonId: 'PES', MonCotiz: 1 };
            if (montoIVA > 0) { factura.Iva = [{ Id: 5, BaseImp: parseFloat(netoGravado).toFixed(2), Importe: parseFloat(montoIVA).toFixed(2) }]; }
            const resultado = await this.afip.ElectronicBilling.createVoucher(factura);
            const cae = resultado.CAE;
            const fechaVencimientoCae = this.parsearFechaAfip(resultado.CAEFchVto);
            if (!cae) throw new Error('AFIP no devolvió CAE');
            return { success: true, cae: cae, fechaVencimientoCae: fechaVencimientoCae, numeroComprobante: numeroComprobante, resultado: resultado };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async generarNota(notaData) {
        try {
            this.checkInitialized();
            const { puntoVenta, tipoComprobante, numeroComprobante, fechaEmision, clienteTipoDocumento = 80, clienteDocumento, netoGravado, montoIVA, montoTotal, comprobanteAsociado = null } = notaData;
            if (!puntoVenta || !tipoComprobante || !numeroComprobante) throw new Error('Faltan datos obligatorios');
            if (!clienteDocumento) throw new Error('Falta el documento del cliente');
            if (!comprobanteAsociado) throw new Error('Las notas deben referenciar un comprobante asociado');
            const nota = { CantReg: 1, PtoVta: puntoVenta, CbteTipo: tipoComprobante, Concepto: 1, DocTipo: clienteTipoDocumento, DocNro: clienteDocumento.toString().replace(/-/g, ''), CbteDesde: numeroComprobante, CbteHasta: numeroComprobante, CbteFch: fechaEmision ? this.formatearFecha(fechaEmision) : this.formatearFecha(new Date()), ImpTotal: parseFloat(montoTotal).toFixed(2), ImpTotConc: 0, ImpNeto: parseFloat(netoGravado).toFixed(2), ImpOpEx: 0, ImpIVA: parseFloat(montoIVA).toFixed(2), ImpTrib: 0, MonId: 'PES', MonCotiz: 1 };
            if (montoIVA > 0) { nota.Iva = [{ Id: 5, BaseImp: parseFloat(netoGravado).toFixed(2), Importe: parseFloat(montoIVA).toFixed(2) }]; }
            nota.CbtesAsoc = [{ Tipo: comprobanteAsociado.tipo, PtoVta: comprobanteAsociado.puntoVenta, Nro: comprobanteAsociado.numero, Cuit: comprobanteAsociado.cuit ? comprobanteAsociado.cuit.toString().replace(/-/g, '') : undefined, CbteFch: comprobanteAsociado.fecha ? this.formatearFecha(comprobanteAsociado.fecha) : undefined }];
            const resultado = await this.afip.ElectronicBilling.createVoucher(nota);
            const cae = resultado.CAE;
            const fechaVencimientoCae = this.parsearFechaAfip(resultado.CAEFchVto);
            if (!cae) throw new Error('AFIP no devolvió CAE');
            return { success: true, cae: cae, fechaVencimientoCae: fechaVencimientoCae, numeroComprobante: numeroComprobante, resultado: resultado };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    formatearFecha(fecha) {
        const date = fecha instanceof Date ? fecha : new Date(fecha);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    parsearFechaAfip(fechaAfip) {
        if (!fechaAfip || fechaAfip.length !== 8) return null;
        return `${fechaAfip.substring(0, 4)}-${fechaAfip.substring(4, 6)}-${fechaAfip.substring(6, 8)}`;
    }
}

const afipService = new AfipService();
module.exports = afipService;
