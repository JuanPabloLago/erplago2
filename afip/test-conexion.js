const Afip = require('@afipsdk/afip.js');
const config = require('./config');

async function testConexion() {
    try {
        console.log('==========================================');
        console.log('🔄 PRUEBA DE CONEXIÓN AFIP');
        console.log('==========================================');
        console.log('CUIT:', config.cuit);
        console.log('Ambiente:', config.produccion ? 'PRODUCCIÓN' : 'TESTING');
        console.log('Punto de venta:', config.puntoVenta);
        
        const afip = new Afip({
            CUIT: config.cuit,
            production: config.produccion,
            cert: config.certPath,
            key: config.keyPath
        });
        
        console.log('\n🔐 Obteniendo token de acceso...');
        const auth = await afip.GetServiceTA('wsfe', true);
        
        if (auth) {
            console.log('✅ Token obtenido exitosamente!');
            console.log('Token válido hasta:', new Date(auth.expiration * 1000));
        }
        
        console.log('\n📊 Consultando último comprobante autorizado...');
        const ultimoB = await afip.ElectronicBilling.GetLastVoucher(config.puntoVenta, 6); // Tipo 6 = Factura B
        console.log('✅ Último comprobante Factura B - PV', config.puntoVenta, ':', ultimoB);
        
        const ultimoA = await afip.ElectronicBilling.GetLastVoucher(config.puntoVenta, 1); // Tipo 1 = Factura A
        console.log('✅ Último comprobante Factura A - PV', config.puntoVenta, ':', ultimoA);
        
        console.log('\n==========================================');
        console.log('✅ CONEXIÓN EXITOSA CON AFIP!');
        console.log('==========================================');
        
    } catch (error) {
        console.error('\n==========================================');
        console.error('❌ ERROR EN LA CONEXIÓN');
        console.error('==========================================');
        console.error('Mensaje:', error.message);
        if (error.response) {
            console.error('Respuesta AFIP:', error.response.data);
        }
        console.error('\n Stack:', error.stack);
    }
}

testConexion();
