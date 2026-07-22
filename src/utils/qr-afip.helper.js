'use strict';
/**
 * QR-AFIP HELPER — Generación de QR para comprobantes electrónicos
 * Basado en RG 4291/18 AFIP — formato oficial.
 *
 * SCOPE — Stateless, sin acceso a BD, sin escrituras.
 * Reutilizable para notas, facturas, recibos.
 *
 * @module qr-afip.helper
 * @version 1.0.0
 */

const QRCode = require('qrcode');

const TIPO_DOC_RECEPTOR = {
    CUIT: 80,
    CUIL: 86,
    CDI: 87,
    LE: 89,
    LC: 90,
    CI_EXTRANJERA: 91,
    EN_TRAMITE: 92,
    ACTA_NACIMIENTO: 93,
    PASAPORTE: 94,
    CI_BS_AS_RNP: 95,
    DNI: 96,
    SIN_IDENTIFICAR: 99
};

const TIPO_COD_AUT = { CAE: 'E', CAEA: 'A' };

/**
 * Detecta tipo de documento receptor según el formato del CUIT/CUIL.
 * Si tiene 11 dígitos válidos → CUIT. Si no → SIN_IDENTIFICAR.
 */
function detectarTipoDocReceptor(cuitCuil) {
    if (!cuitCuil) return TIPO_DOC_RECEPTOR.SIN_IDENTIFICAR;
    const limpio = String(cuitCuil).replace(/\D/g, '');
    return (limpio.length === 11) ? TIPO_DOC_RECEPTOR.CUIT : TIPO_DOC_RECEPTOR.SIN_IDENTIFICAR;
}

/**
 * Construye la URL oficial del QR AFIP.
 * @param {Object} p
 * @param {string|number} p.cuitEmisor - CUIT del emisor
 * @param {string} p.fechaEmision - 'YYYY-MM-DD'
 * @param {number} p.ptoVta
 * @param {number} p.codigoTipo - código AFIP del comprobante (8=NC B, 6=Fac B, etc.)
 * @param {number} p.nroCmp - número del comprobante
 * @param {number} p.importe - total
 * @param {string} p.cae
 * @param {number} [p.tipoDocReceptor] - default SIN_IDENTIFICAR si no se pasa
 * @param {string|number} [p.nroDocReceptor]
 * @param {string} [p.tipoCodAut] - 'E' (CAE) o 'A' (CAEA), default 'E'
 * @returns {string} URL completa del QR AFIP
 */
function construirURL(p) {
    if (!p.cuitEmisor)   throw new Error('qr-afip.helper: cuitEmisor obligatorio');
    if (!p.fechaEmision) throw new Error('qr-afip.helper: fechaEmision obligatoria');
    if (!p.cae)          throw new Error('qr-afip.helper: cae obligatorio');

    const payload = {
        ver: 1,
        fecha: p.fechaEmision,
        cuit: parseInt(String(p.cuitEmisor).replace(/\D/g, ''), 10),
        ptoVta: parseInt(p.ptoVta, 10),
        tipoCmp: parseInt(p.codigoTipo, 10),
        nroCmp: parseInt(p.nroCmp, 10),
        importe: parseFloat(p.importe),
        moneda: 'PES',
        ctz: 1,
        tipoDocRec: parseInt(p.tipoDocReceptor || TIPO_DOC_RECEPTOR.SIN_IDENTIFICAR, 10),
        nroDocRec: parseInt(String(p.nroDocReceptor || '0').replace(/\D/g, ''), 10) || 0,
        tipoCodAut: p.tipoCodAut || TIPO_COD_AUT.CAE,
        codAut: parseInt(p.cae, 10)
    };

    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    return 'https://www.afip.gob.ar/fe/qr/?p=' + b64;
}

/**
 * Genera el QR AFIP como Data URI (base64) listo para meter en <img src=...>
 */
async function generarQRDataURI(payload) {
    const url = construirURL(payload);
    return await QRCode.toDataURL(url, { margin: 1, width: 200 });
}

module.exports = {
    construirURL,
    generarQRDataURI,
    detectarTipoDocReceptor,
    TIPO_DOC_RECEPTOR,
    TIPO_COD_AUT
};
