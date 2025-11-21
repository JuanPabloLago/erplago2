const Afip = require('@afipsdk/afip.js');

async function testSinCerts() {
    console.log('='.repeat(60));
    console.log('🧪 TEST SIN CERTIFICADOS (Modo AfipSDK Cloud)');
    console.log('='.repeat(60));

    try {
        // Exactamente como el ejemplo oficial
        const afip = new Afip({ 
            CUIT: 20296284921,
            production: true
        });

        console.log('✅ SDK inicializado sin certificados');
        console.log('   Modo:', afip.options.production ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN');
        
        console.log('\n🔍 Consultando puntos de venta...');
        const puntosVenta = await afip.ElectronicBilling.getSalesPoints();
        console.log('✅ Puntos de venta:', puntosVenta);

    } catch (error) {
        console.log('\n❌ ERROR:', error.message);
        if (error.status) console.log('   Status:', error.status);
        if (error.data) console.log('   Data:', error.data);
    }
}

testSinCerts();
