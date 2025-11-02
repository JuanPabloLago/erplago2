const Afip = require('@afipsdk/afip.js');
const config = require('./config');

async function testPV6() {
    try {
        console.log('==========================================');
        console.log('🔥 PRUEBA CON PUNTO DE VENTA 0006');
        console.log('==========================================\n');
        console.log('CUIT:', config.cuit);
        console.log('Punto de Venta:', config.puntoVenta);
        
        const afip = new Afip({
            CUIT: config.cuit,
            production: config.produccion,
            cert: config.certPath,
            key: config.keyPath,
            ta_folder: __dirname + '/tokens'
        });
        
        console.log('\n🔐 Obteniendo token...');
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('✅ TOKEN OBTENIDO!');
        console.log('Expira:', new Date(ta.expiration * 1000));
        
        console.log('\n📊 Consultando último comprobante PV 6...');
        const ultimoB = await afip.ElectronicBilling.GetLastVoucher(6, 6); // PV 6, Factura B
        console.log('✅ Último comprobante Factura B:', ultimoB);
        
        const ultimoA = await afip.ElectronicBilling.GetLastVoucher(6, 1); // PV 6, Factura A
        console.log('✅ Último comprobante Factura A:', ultimoA);
        
        console.log('\n==========================================');
        console.log('✅✅✅ AFIP FUNCIONANDO CON PV 0006! ✅✅✅');
        console.log('==========================================');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
        }
    }
}

testPV6();
