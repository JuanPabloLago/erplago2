const AfipSDK = require('afip-sdk');
const config = require('./config.js');

async function testAfipSDK() {
    console.log('='.repeat(60));
    console.log('🧪 TEST con afip-sdk (SDK alternativo)');
    console.log('='.repeat(60));

    try {
        const afip = new AfipSDK({
            cuit: config.cuit,
            production: config.produccion,
            certPath: config.certPath,
            privateKeyPath: config.keyPath
        });

        console.log('✅ SDK inicializado');
        console.log('   CUIT:', config.cuit);
        console.log('   Ambiente:', config.produccion ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN');
        
        console.log('\n🔍 Probando conexión...');
        // Intentar obtener tipos de comprobantes
        const tipos = await afip.wsfe.tiposDeComprobantes();
        console.log('✅ Tipos de comprobantes obtenidos:', tipos.length);
        
        console.log('\n🎉 ¡SDK funcionando correctamente!');

    } catch (error) {
        console.log('\n❌ Error:', error.message);
        console.log('Stack:', error.stack);
    }
}

testAfipSDK();
