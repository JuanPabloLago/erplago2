const AfipServices = require('afip-services');
const config = require('./config.js');
const fs = require('fs');

async function testAfipServices() {
    console.log('='.repeat(60));
    console.log('🧪 TEST con afip-services');
    console.log('='.repeat(60));

    try {
        // Leer certificados
        const cert = fs.readFileSync(config.certPath, 'utf8');
        const key = fs.readFileSync(config.keyPath, 'utf8');

        const afip = new AfipServices({
            cuit: config.cuit,
            cert: cert,
            key: key,
            production: config.produccion
        });

        console.log('✅ SDK inicializado');
        
        console.log('\n🔍 Consultando servicios disponibles...');
        console.log('Métodos disponibles:', Object.keys(afip));

    } catch (error) {
        console.log('\n❌ Error:', error.message);
        console.log('Stack:', error.stack);
    }
}

testAfipServices();
