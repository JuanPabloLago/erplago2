const Afip = require('afip-sdk');
const config = require('./config.js');

async function testAfipSDK() {
    console.log('='.repeat(60));
    console.log('🧪 TEST con afip-sdk (Parámetros corregidos)');
    console.log('='.repeat(60));

    try {
        // El SDK requiere CUIT en mayúsculas
        const afip = new Afip({
            CUIT: config.cuit,
            production: config.produccion,
            cert: config.certPath,
            key: config.keyPath,
            ta_folder: './afip/tokens/'
        });

        console.log('✅ SDK inicializado');
        console.log('   CUIT:', config.cuit);
        console.log('   Ambiente:', config.produccion ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN');
        
        console.log('\n1️⃣ Consultando estado del servidor...');
        const serverStatus = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Estado:', serverStatus);
        
        console.log('\n2️⃣ Consultando puntos de venta...');
        const puntosVenta = await afip.ElectronicBilling.getSalesPoints();
        console.log('✅ Puntos de venta:', puntosVenta);
        
        console.log('\n3️⃣ Consultando último comprobante PV', config.puntoVenta, '...');
        const ultimoComp = await afip.ElectronicBilling.getLastVoucher(config.puntoVenta, 1);
        console.log('✅ Último comprobante:', ultimoComp);
        
        console.log('\n🎉 ¡TODO FUNCIONA PERFECTAMENTE!');

    } catch (error) {
        console.log('\n❌ Error:', error.message);
        if (error.stack) console.log('Stack:', error.stack);
    }
}

testAfipSDK();
