// =======================================================================
//                    SERVICIO AFIP INTEGRADO AL ERP
//              Conexión directa a AFIP - Sin intermediarios
// =======================================================================

const soap = require('soap');
const fs = require('fs');
const forge = require('node-forge');

class AfipService {
    constructor() {
        this.config = null;
        this.ta = null;
        this.initialized = false;
    }

    async initialize(config = null) {
        try {
            this.config = config || require('./config.js');
            
            this.wsaa_wsdl = this.config.produccion 
                ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl'
                : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl';
            
            this.wsfe_wsdl = this.config.produccion
                ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL'
                : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL';

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

    async obtenerTA() {
        try {
            const tra = this.crearTRA('wsfe');
            const traFirmado = this.firmarTRA(tra);
            
            const client = await soap.createClientAsync(this.wsaa_wsdl);
            const result = await client.loginCmsAsync({ in0: traFirmado });
            
            const loginCmsReturn = result[0].loginCmsReturn;
            const token = loginCmsReturn.match(/<token>(.*?)<\/token>/)[1];
            const sign = loginCmsReturn.match(/<sign>(.*?)<\/sign>/)[1];
            
            this.ta = { token, sign };
            return this.ta;
        } catch (error) {
            console.error('❌ Error obteniendo TA:', error.message);
            throw error;
        }
    }

    crearTRA(servicio) {
        const now = new Date();
        const generationTime = now.toISOString();
        const expirationTime = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
        const uniqueId = Math.floor(now.getTime() / 1000);

        return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
    <header>
        <uniqueId>${uniqueId}</uniqueId>
        <generationTime>${generationTime}</generationTime>
        <expirationTime>${expirationTime}</expirationTime>
    </header>
    <service>${servicio}</service>
</loginTicketRequest>`;
    }

    firmarTRA(tra) {
        const cert = fs.readFileSync(this.config.certPath, 'utf8');
        const key = fs.readFileSync(this.config.keyPath, 'utf8');
        
        const p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(tra, 'utf8');
        
        const pki = forge.pki;
        const privateKey = pki.privateKeyFromPem(key);
        const certificate = pki.certificateFromPem(cert);
        
        p7.addCertificate(certificate);
        p7.addSigner({
            key: privateKey,
            certificate: certificate,
            digestAlgorithm: forge.pki.oids.sha256,
            authenticatedAttributes: [{
                type: forge.pki.oids.contentType,
                value: forge.pki.oids.data
            }, {
                type: forge.pki.oids.messageDigest
            }, {
                type: forge.pki.oids.signingTime,
                value: new Date()
            }]
        });
        
        p7.sign();
        
        const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
        return Buffer.from(der, 'binary').toString('base64');
    }

    async obtenerUltimoComprobante(ptoVta, cbteTipo) {
        if (!this.ta) await this.obtenerTA();
        
        const client = await soap.createClientAsync(this.wsfe_wsdl);
        
        const params = {
            Auth: {
                Token: this.ta.token,
                Sign: this.ta.sign,
                Cuit: this.config.cuit
            },
            PtoVta: ptoVta,
            CbteTipo: cbteTipo
        };
        
        const result = await client.FECompUltimoAutorizadoAsync(params);
        return result[0].FECompUltimoAutorizadoResult.CbteNro;
    }

    async consultarEstadoServidor() {
        if (!this.ta) await this.obtenerTA();
        
        const client = await soap.createClientAsync(this.wsfe_wsdl);
        const result = await client.FEDummyAsync();
        
        return result[0].FEDummyResult;
    }

    async generarFactura(facturaData) {
        if (!this.ta) await this.obtenerTA();
        
        const client = await soap.createClientAsync(this.wsfe_wsdl);
        
        const feDetReq = {
            Concepto: facturaData.Concepto || 1,
            DocTipo: facturaData.DocTipo,
            DocNro: facturaData.DocNro,
            CbteDesde: facturaData.CbteDesde,
            CbteHasta: facturaData.CbteHasta,
            CbteFch: facturaData.CbteFch,
            ImpTotal: facturaData.ImpTotal,
            ImpTotConc: facturaData.ImpTotConc || 0,
            ImpNeto: facturaData.ImpNeto,
            ImpOpEx: facturaData.ImpOpEx || 0,
            ImpIVA: facturaData.ImpIVA,
            ImpTrib: facturaData.ImpTrib || 0,
            MonId: facturaData.MonId || 'PES',
            MonCotiz: facturaData.MonCotiz || 1
        };

        if (facturaData.Iva) {
            feDetReq.Iva = { AlicIva: facturaData.Iva };
        }

        const params = {
            Auth: {
                Token: this.ta.token,
                Sign: this.ta.sign,
                Cuit: this.config.cuit
            },
            FeCAEReq: {
                FeCabReq: {
                    CantReg: 1,
                    PtoVta: facturaData.PtoVta,
                    CbteTipo: facturaData.CbteTipo
                },
                FeDetReq: { FECAEDetRequest: feDetReq }
            }
        };

        const result = await client.FECAESolicitarAsync(params);
        return result[0].FECAESolicitarResult;
    }
}

module.exports = new AfipService();
