const path = require('path');

module.exports = {
    cuit: 20296284921,
    razonSocial: 'LAGO JUAN PABLO',
    
    // CAMBIAR A PUNTO DE VENTA 0006
    puntoVenta: 6,  // ANTES: 4, AHORA: 6
    puntoVentaAlt: 4,
    
    certPath: path.join(__dirname, 'certificados/lago.crt'),
    keyPath: path.join(__dirname, 'certificados/lago_private.key'),
    
    produccion: true, // PRODUCCIÓN
    
    wsfe: {
        wsdl: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx?WSDL',
    },
    
    debug: true
};
