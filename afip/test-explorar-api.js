const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');

console.log('🔍 Explorando API de @afipsdk/afip.js');
console.log('='.repeat(60));

try {
    const afip = new Afip({
        CUIT: config.cuit,
        cert: config.certPath,
        key: config.keyPath,
        production: config.produccion,
        ta_folder: './afip/tokens/'
    });

    console.log('\n📦 Propiedades del objeto afip:');
    console.log(Object.keys(afip));

    console.log('\n📦 Métodos de ElectronicBilling:');
    if (afip.ElectronicBilling) {
        console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(afip.ElectronicBilling)));
    }

    console.log('\n📦 Todos los servicios disponibles:');
    for (let key in afip) {
        if (typeof afip[key] === 'object') {
            console.log(`  - ${key}`);
        }
    }

} catch (error) {
    console.error('❌ Error:', error.message);
}
