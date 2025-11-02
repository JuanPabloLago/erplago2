const Afip = require('@afipsdk/afip.js');
const path = require('path');
const fs = require('fs');

async function testDebug() {
    try {
        console.log('==========================================');
        console.log('🔍 PRUEBA CON AMBIENTE DE PRODUCCIÓN');
        console.log('==========================================\n');
        
        const certPath = path.join(__dirname, 'certificados/lago.crt');
        const keyPath = path.join(__dirname, 'certificados/lago_private.key');
        
        // INTENTAR CON PRODUCCIÓN
        const config = {
            CUIT: 20296284921,
            production: true, // CAMBIAR A PRODUCCIÓN
            cert: certPath,
            key: keyPath,
            ta_folder: path.join(__dirname, 'tokens'),
            res_folder: path.join(__dirname, 'tokens')
        };
        
        console.log('⚠️  PROBANDO EN AMBIENTE DE PRODUCCIÓN');
        console.log('Configuración:', JSON.stringify(config, null, 2));
        
        const afip = new Afip(config);
        
        console.log('\n🌐 Solicitando Token de Acceso (PRODUCCIÓN)...');
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('\n✅ TOKEN OBTENIDO EN PRODUCCIÓN!');
        console.log('Token:', ta.token.substring(0, 50) + '...');
        console.log('Expira:', new Date(ta.expiration * 1000));
        
        console.log('\n📊 Consultando último comprobante...');
        const ultimo = await afip.ElectronicBilling.GetLastVoucher(4, 6);
        console.log('Último comprobante:', ultimo);
        
        console.log('\n==========================================');
        console.log('✅ CONEXIÓN EXITOSA EN PRODUCCIÓN!');
        console.log('==========================================');
        
    } catch (error) {
        console.error('\n==========================================');
        console.error('❌ ERROR EN PRODUCCIÓN');
        console.error('==========================================');
        console.error('Mensaje:', error.message);
        console.error('Código:', error.code);
        
        // Intentar extraer más info
        if (error.response) {
            console.error('\nRespuesta HTTP:');
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
            console.error('Data:', error.response.data);
        }
        
        // Si falla en producción, probamos testing
        console.log('\n==========================================');
        console.log('🔄 INTENTANDO CON TESTING...');
        console.log('==========================================');
        
        try {
            const configTest = {
                CUIT: 20296284921,
                production: false,
                cert: certPath,
                key: keyPath,
                ta_folder: path.join(__dirname, 'tokens'),
                res_folder: path.join(__dirname, 'tokens')
            };
            
            const afipTest = new Afip(configTest);
            const taTest = await afipTest.GetServiceTA('wsfe', true);
            
            console.log('✅ TOKEN OBTENIDO EN TESTING!');
            console.log('Expira:', new Date(taTest.expiration * 1000));
            
        } catch (testError) {
            console.error('❌ TAMBIÉN FALLÓ EN TESTING');
            console.error('Mensaje:', testError.message);
        }
    }
}

testDebug();
