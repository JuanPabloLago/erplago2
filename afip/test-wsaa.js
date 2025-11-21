const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');

async function testWSAA() {
    console.log('='.repeat(60));
    console.log('🔐 TEST WSAA - Web Service de Autenticación y Autorización');
    console.log('='.repeat(60));

    try {
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion,
            ta_folder: './afip/tokens/'
        });

        console.log('✅ Instancia creada');
        console.log('\n📋 Explorando métodos del SDK:');
        console.log('Métodos en afip:', Object.keys(afip));
        
        // Intentar acceder al AdminClient que maneja la autenticación
        if (afip.AdminClient) {
            console.log('\n📋 AdminClient encontrado');
            console.log('Métodos:', Object.getOwnPropertyNames(Object.getPrototypeOf(afip.AdminClient)));
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testWSAA();
