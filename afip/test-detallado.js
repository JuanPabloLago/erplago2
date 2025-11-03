const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');

async function testDetallado() {
    console.log('='.repeat(50));
    console.log('🔍 TEST DETALLADO AFIP');
    console.log('='.repeat(50));
    console.log('CUIT:', config.cuit);
    console.log('Cert:', config.certPath);
    console.log('Key:', config.keyPath);
    console.log('Producción:', config.produccion);
    console.log('');
    
    try {
        console.log('1️⃣ Creando instancia AFIP...');
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion
        });
        console.log('✅ Instancia creada\n');
        
        console.log('2️⃣ Solicitando estado del servidor...');
        const status = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Estado:', status);
        console.log('');
        
        console.log('3️⃣ Consultando último comprobante PV 6...');
        const ultimo = await afip.ElectronicBilling.getLastVoucher(6, 1);
        console.log('✅ Último número:', ultimo);
        
        console.log('');
        console.log('🎉 ¡TODO FUNCIONA!');
        
    } catch (error) {
        console.log('');
        console.log('❌ ERROR:', error.message);
        if (error.response) {
            console.log('Status HTTP:', error.response.status);
            console.log('Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testDetallado();
