// =======================================================================
//                    SERVICIO AFIP DIRECTO CON SOAP
//              Sin intermediarios - Conexión directa a AFIP
// =======================================================================

const soap = require('soap');
const fs = require('fs');
const { SignedXml } = require('xml-crypto');
const forge = require('node-forge');
const path = require('path');

class AfipServiceDirecto {
    constructor(config) {
        this.config = config;
        this.wsaa_wsdl = config.produccion 
            ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms?wsdl'
            : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms?wsdl';
        
        this.wsfe_wsdl = config.produccion
            ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL'
            : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL';
        
        this.ta = null; // Token y Sign
    }

    // Obtener Token de Acceso (TA) desde WSAA
    async obtenerTA() {
        console.log('🔐 Obteniendo Token de Acceso (TA)...');
        
        try {
            // Crear Ticket de Requerimiento de Acceso (TRA)
            const tra = this.crearTRA('wsfe');
            
            // Firmar el TRA
            const traFirmado = this.firmarTRA(tra);
            
            // Enviar a WSAA
            const client = await soap.createClientAsync(this.wsaa_wsdl);
            const result = await client.loginCmsAsync({ in0: traFirmado });
            
            // Parsear respuesta
            const loginCmsReturn = result[0].loginCmsReturn;
            
            // Extraer token y sign
            const token = loginCmsReturn.match(/<token>(.*?)<\/token>/)[1];
            const sign = loginCmsReturn.match(/<sign>(.*?)<\/sign>/)[1];
            
            this.ta = { token, sign };
            
            console.log('✅ Token obtenido exitosamente');
            return this.ta;
            
        } catch (error) {
            console.error('❌ Error obteniendo TA:', error.message);
            throw error;
        }
    }

    // Crear Ticket de Requerimiento de Acceso (TRA)
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

    // Firmar TRA con certificado y clave privada
    firmarTRA(tra) {
        const cert = fs.readFileSync(this.config.certPath, 'utf8');
        const key = fs.readFileSync(this.config.keyPath, 'utf8');
        
        // Convertir PEM a DER (base64)
        const traBase64 = Buffer.from(tra, 'utf8').toString('base64');
        
        // Crear PKCS7
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

    // Consultar estado del servidor WSFE
    async consultarEstadoServidor() {
        if (!this.ta) await this.obtenerTA();
        
        const client = await soap.createClientAsync(this.wsfe_wsdl);
        const result = await client.FEDummyAsync();
        
        return result[0];
    }

    // Obtener último comprobante autorizado
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
}

module.exports = AfipServiceDirecto;
