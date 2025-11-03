// =======================================================================
//                    MÓDULO DE SERVICIO AFIP
//              Integración con Facturación Electrónica AFIP
// =======================================================================

const Afip = require('@afipsdk/afip.js');
const fs = require('fs');
const path = require('path');

class AfipService {
    constructor() {
        this.afip = null;
        this.config = null;
        this.initialized = false;
    }

    /**
     * Inicializar el servicio AFIP con la configuración
     */
    async initialize(config = null) {
        try {
            // Cargar configuración
            if (config) {
                this.config = config;
            } else {
                this.config = require('./config.js');
            }

            // Verificar que existan los certificados
            if (!fs.existsSync(this.config.certPath)) {
                throw new Error(`Certificado no encontrado: ${this.config.certPath}`);
            }
            if (!fs.existsSync(this.config.keyPath)) {
                throw new Error(`Clave privada no encontrada: ${this.config.keyPath}`);
            }

            // Inicializar cliente AFIP
            this.afip = new Afip({
                CUIT: this.config.cuit,
                cert: this.config.certPath,
                key: this.config.keyPath,
                production: this.config.produccion
            });

            this.initialized = true;
            console.log('✅ Servicio AFIP inicializado correctamente');
            console.log(`   CUIT: ${this.config.cuit}`);
            console.log(`   Ambiente: ${this.config.produccion ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN'}`);
            console.log(`   Punto de Venta: ${this.config.puntoVenta}`);

            return true;
        } catch (error) {
            console.error('❌ Error al inicializar servicio AFIP:', error.message);
            throw error;
        }
    }

    /**
     * Verificar que el servicio esté inicializado
     */
    checkInitialized() {
        if (!this.initialized || !this.afip) {
            throw new Error('Servicio AFIP no inicializado. Llame a initialize() primero.');
        }
    }

    /**
     * Obtener el último número de comprobante autorizado en AFIP
     * @param {number} puntoVenta - Punto de venta
     * @param {number} tipoComprobante - Código AFIP del tipo de comprobante
     * @returns {Promise<number>} - Último número de comprobante
     */
    async obtenerUltimoComprobante(puntoVenta, tipoComprobante) {
        try {
            this.checkInitialized();

            const ultimoComprobante = await this.afip.ElectronicBilling.getLastVoucher(
                puntoVenta,
                tipoComprobante
            );

            console.log(`📋 Último comprobante autorizado - PV: ${puntoVenta}, Tipo: ${tipoComprobante}, Nro: ${ultimoComprobante}`);
            
            return parseInt(ultimoComprobante);
        } catch (error) {
            console.error('❌ Error al obtener último comprobante:', error.message);
            throw new Error(`Error al consultar AFIP: ${error.message}`);
        }
    }

    /**
     * Generar una factura electrónica y obtener CAE
     * @param {Object} facturaData - Datos de la factura
     * @returns {Promise<Object>} - Resultado con CAE y fecha de vencimiento
     */
    async generarFactura(facturaData) {
        try {
            this.checkInitialized();

            const {
                puntoVenta,
                tipoComprobante,
                numeroComprobante,
                fechaEmision,
                clienteCuit,
                clienteTipoDocumento = 80, // 80 = CUIT, 96 = DNI
                clienteDocumento,
                clienteTipoPersona, // IVA Responsable Inscripto, Monotributista, etc.
                netoGravado,
                montoIVA,
                montoTotal,
                items = [],
                observaciones = ''
            } = facturaData;

            // Validaciones
            if (!puntoVenta || !tipoComprobante || !numeroComprobante) {
                throw new Error('Faltan datos obligatorios: puntoVenta, tipoComprobante, numeroComprobante');
            }

            if (!clienteDocumento) {
                throw new Error('Falta el documento del cliente');
            }

            // Construir el objeto de factura según el formato de AFIP
            const factura = {
                CantReg: 1, // Cantidad de comprobantes a registrar
                PtoVta: puntoVenta,
                CbteTipo: tipoComprobante,
                Concepto: 1, // 1=Productos, 2=Servicios, 3=Productos y Servicios
                DocTipo: clienteTipoDocumento,
                DocNro: clienteDocumento.toString().replace(/-/g, ''),
                CbteDesde: numeroComprobante,
                CbteHasta: numeroComprobante,
                CbteFch: fechaEmision ? this.formatearFecha(fechaEmision) : this.formatearFecha(new Date()),
                ImpTotal: parseFloat(montoTotal).toFixed(2),
                ImpTotConc: 0, // Importe neto no gravado
                ImpNeto: parseFloat(netoGravado).toFixed(2),
                ImpOpEx: 0, // Importe exento
                ImpIVA: parseFloat(montoIVA).toFixed(2),
                ImpTrib: 0, // Otros tributos
                MonId: 'PES', // Moneda (PES = Pesos argentinos)
                MonCotiz: 1, // Cotización de la moneda
            };

            // Agregar IVA (solo si hay monto de IVA)
            if (montoIVA > 0) {
                factura.Iva = [
                    {
                        Id: 5, // 5 = 21%, 4 = 10.5%
                        BaseImp: parseFloat(netoGravado).toFixed(2),
                        Importe: parseFloat(montoIVA).toFixed(2)
                    }
                ];
            }

            console.log('📤 Enviando factura a AFIP:', JSON.stringify(factura, null, 2));

            // Crear el comprobante en AFIP
            const resultado = await this.afip.ElectronicBilling.createVoucher(factura);

            console.log('✅ Respuesta de AFIP:', JSON.stringify(resultado, null, 2));

            // Extraer CAE y fecha de vencimiento
            const cae = resultado.CAE;
            const fechaVencimientoCae = this.parsearFechaAfip(resultado.CAEFchVto);

            if (!cae) {
                throw new Error('AFIP no devolvió CAE. Verifique los datos enviados.');
            }

            return {
                success: true,
                cae: cae,
                fechaVencimientoCae: fechaVencimientoCae,
                numeroComprobante: numeroComprobante,
                resultado: resultado
            };

        } catch (error) {
            console.error('❌ Error al generar factura en AFIP:', error);
            
            // Intentar extraer mensaje de error de AFIP
            let mensajeError = error.message;
            if (error.response && error.response.data) {
                mensajeError = JSON.stringify(error.response.data);
            }

            return {
                success: false,
                error: mensajeError,
                detalles: error
            };
        }
    }

    /**
     * Consultar datos de un contribuyente por CUIT
     * @param {string} cuit - CUIT del contribuyente
     * @returns {Promise<Object>} - Datos del contribuyente
     */
    async consultarContribuyente(cuit) {
        try {
            this.checkInitialized();

            const cuitLimpio = cuit.toString().replace(/-/g, '');
            
            const contribuyente = await this.afip.RegisterScopeFive.getTaxpayerDetails(cuitLimpio);

            console.log('✅ Contribuyente consultado:', contribuyente);

            return {
                success: true,
                datos: contribuyente
            };

        } catch (error) {
            console.error('❌ Error al consultar contribuyente:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Obtener los puntos de venta habilitados
     * @returns {Promise<Array>} - Lista de puntos de venta
     */
    async obtenerPuntosDeVenta() {
        try {
            this.checkInitialized();

            const puntosVenta = await this.afip.ElectronicBilling.getSalesPoints();

            console.log('✅ Puntos de venta obtenidos:', puntosVenta);

            return {
                success: true,
                puntosVenta: puntosVenta
            };

        } catch (error) {
            console.error('❌ Error al obtener puntos de venta:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Obtener información de un comprobante específico
     * @param {number} puntoVenta - Punto de venta
     * @param {number} tipoComprobante - Tipo de comprobante
     * @param {number} numeroComprobante - Número de comprobante
     * @returns {Promise<Object>} - Información del comprobante
     */
    async consultarComprobante(puntoVenta, tipoComprobante, numeroComprobante) {
        try {
            this.checkInitialized();

            const comprobante = await this.afip.ElectronicBilling.getVoucherInfo(
                numeroComprobante,
                puntoVenta,
                tipoComprobante
            );

            console.log('✅ Comprobante consultado:', comprobante);

            return {
                success: true,
                comprobante: comprobante
            };

        } catch (error) {
            console.error('❌ Error al consultar comprobante:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verificar el estado del servidor de AFIP
     * @returns {Promise<Object>} - Estado del servidor
     */
    async verificarEstadoServidor() {
        try {
            this.checkInitialized();

            const estado = await this.afip.ElectronicBilling.getServerStatus();

            console.log('✅ Estado del servidor AFIP:', estado);

            return {
                success: true,
                estado: estado
            };

        } catch (error) {
            console.error('❌ Error al verificar estado del servidor:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ============================================================
    //                    FUNCIONES AUXILIARES
    // ============================================================

    /**
     * Formatear fecha para AFIP (YYYYMMDD)
     * @param {Date|string} fecha - Fecha a formatear
     * @returns {string} - Fecha formateada
     */
    formatearFecha(fecha) {
        const date = fecha instanceof Date ? fecha : new Date(fecha);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
    }

    /**
     * Parsear fecha de AFIP (YYYYMMDD) a formato ISO
     * @param {string} fechaAfip - Fecha en formato AFIP
     * @returns {string} - Fecha en formato ISO (YYYY-MM-DD)
     */
    parsearFechaAfip(fechaAfip) {
        if (!fechaAfip || fechaAfip.length !== 8) {
            return null;
        }
        const year = fechaAfip.substring(0, 4);
        const month = fechaAfip.substring(4, 6);
        const day = fechaAfip.substring(6, 8);
        return `${year}-${month}-${day}`;
    }

    /**
     * Mapear código de condición IVA local a código AFIP
     * @param {number} condicionIvaLocal - ID de condición IVA en tu BD
     * @returns {number} - Código de documento AFIP
     */
    mapearCondicionIVA(condicionIvaLocal) {
        const mapeo = {
            1: 80,  // IVA Responsable Inscripto -> CUIT
            2: 96,  // Monotributista -> DNI
            3: 80,  // IVA Exento -> CUIT
            4: 96,  // Consumidor Final -> DNI
            5: 80   // Responsable No Inscripto -> CUIT
        };
        return mapeo[condicionIvaLocal] || 80;
    }

    /**
     * Obtener el código de alícuota IVA para AFIP
     * @param {number} porcentaje - Porcentaje de IVA (21, 10.5, 27, 5, 2.5, 0)
     * @returns {number} - Código de alícuota AFIP
     */
    obtenerCodigoAlicuotaIVA(porcentaje) {
        const codigos = {
            0: 3,      // No gravado
            2.5: 9,    // 2.5%
            5: 8,      // 5%
            10.5: 4,   // 10.5%
            21: 5,     // 21%
            27: 6      // 27%
        };
        return codigos[porcentaje] || 3;
    }
}

// Exportar una instancia única (Singleton)
const afipService = new AfipService();

module.exports = afipService;
