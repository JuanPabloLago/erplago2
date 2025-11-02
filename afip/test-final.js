const Afip = require('@afipsdk/afip.js');
const path = require('path');

const certPath = path.join(__dirname, 'certificados/lago.crt');
const keyPath = path.join(__dirname, 'certificados/lago_private.key');

async function testProduccion() {
    console.log('==========================================');
    console.log('🔥 PRUEBA EN PRODUCCIÓN REAL');
    console.log('==========================================\n');
    
    try {
        const afip = new Afip({
            CUIT: 20296284921,
            production: true, // PRODUCCIÓN
            cert: certPath,
            key: keyPath,
            ta_folder: path.join(__dirname, 'tokens')
        });
        
        console.log('🔐 Obteniendo token...');
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('✅ TOKEN OBTENIDO!');
        console.log('Expira:', new Date(ta.expiration * 1000));
        
        console.log('\n📊 Consultando último comprobante...');
        const ultimo = await afip.ElectronicBilling.GetLastVoucher(4, 6);
        console.log('✅ Último Factura B PV 4:', ultimo);
        
        console.log('\n==========================================');
        console.log('✅✅✅ AFIP EN PRODUCCIÓN FUNCIONANDO! ✅✅✅');
        console.log('==========================================');
        
        return true;
        
    } catch (error) {
        console.error('❌ Error en producción:', error.message);
        return false;
    }
}

async function testTesting() {
    console.log('\n==========================================');
    console.log('🧪 PRUEBA EN TESTING/HOMOLOGACIÓN');
    console.log('==========================================\n');
    
    try {
        const afip = new Afip({
            CUIT: 20296284921,
            production: false, // TESTING
            cert: certPath,
            key: keyPath,
            ta_folder: path.join(__dirname, 'tokens')
        });
        
        console.log('🔐 Obteniendo token...');
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('✅ TOKEN OBTENIDO!');
        console.log('Expira:', new Date(ta.expiration * 1000));
        
        console.log('\n==========================================');
        console.log('✅✅✅ AFIP EN TESTING FUNCIONANDO! ✅✅✅');
        console.log('==========================================');
        
        return true;
        
    } catch (error) {
        console.error('❌ Error en testing:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
        return false;
    }
}

async function main() {
    console.log('🚀 INICIANDO PRUEBAS DE CONEXIÓN AFIP\n');
    
    const prodOk = await testProduccion();
    const testOk = await testTesting();
    
    console.log('\n==========================================');
    console.log('📊 RESUMEN');
    console.log('==========================================');
    console.log('Producción:', prodOk ? '✅ OK' : '❌ FALLA');
    console.log('Testing:', testOk ? '✅ OK' : '❌ FALLA');
    
    if (prodOk) {
        console.log('\n⚠️  El certificado funciona en PRODUCCIÓN');
        console.log('Podés empezar a facturar en producción YA!');
    }
    
    if (!testOk) {
        console.log('\n💡 Para usar testing, necesitás habilitar el');
        console.log('certificado en el ambiente de homologación de AFIP');
    }
}

main();
