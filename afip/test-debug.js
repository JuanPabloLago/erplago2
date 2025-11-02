const Afip = require('@afipsdk/afip.js');
const path = require('path');
const fs = require('fs');

async function testDebug() {
    try {
        console.log('==========================================');
        console.log('🔍 DEBUG DETALLADO DE AFIP');
        console.log('==========================================\n');
        
        const certPath = path.join(__dirname, 'certificados/lago.crt');
        const keyPath = path.join(__dirname, 'certificados/lago_private.key');
        
        console.log('📁 Rutas:');
        console.log('Cert:', certPath);
        console.log('Key:', keyPath);
        console.log('Cert existe:', fs.existsSync(certPath));
        console.log('Key existe:', fs.existsSync(keyPath));
        
        console.log('\n📄 Contenido del certificado (primeras líneas):');
        const certContent = fs.readFileSync(certPath, 'utf8');
        console.log(certContent.substring(0, 100) + '...');
        
        console.log('\n🔧 Configuración AFIP SDK:');
        const config = {
            CUIT: 20296284921,
            production: false,
            cert: certPath,
            key: keyPath,
            ta_folder: path.join(__dirname, 'tokens'),
            res_folder: path.join(__dirname, 'tokens')
        };
        console.log(JSON.stringify(config, null, 2));
        
        // Crear carpetas para tokens
        if (!fs.existsSync(config.ta_folder)) {
            fs.mkdirSync(config.ta_folder, { recursive: true });
            console.log('✅ Carpeta tokens creada');
        }
        
        console.log('\n🔐 Inicializando SDK...');
        const afip = new Afip(config);
        
        console.log('✅ SDK inicializado');
        console.log('\n🌐 Solicitando Token de Acceso...');
        console.log('Servicio: wsfe');
        console.log('Ambiente: TESTING (homologación)');
        
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('\n✅ TOKEN OBTENIDO!');
        console.log('Token:', ta.token.substring(0, 50) + '...');
        console.log('Sign:', ta.sign.substring(0, 50) + '...');
        console.log('Expira:', new Date(ta.expiration * 1000));
        
        console.log('\n==========================================');
        console.log('✅ CONEXIÓN EXITOSA CON AFIP!');
        console.log('==========================================');
        
    } catch (error) {
        console.error('\n==========================================');
        console.error('❌ ERROR DETALLADO');
        console.error('==========================================');
        console.error('Tipo:', error.constructor.name);
        console.error('Mensaje:', error.message);
        
        if (error.response) {
            console.error('\n📡 Respuesta HTTP:');
            console.error('Status:', error.response.status);
            console.error('StatusText:', error.response.statusText);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        }
        
        if (error.request) {
            console.error('\n📤 Request config:');
            console.error('URL:', error.config?.url);
            console.error('Method:', error.config?.method);
        }
        
        console.error('\n📚 Stack completo:');
        console.error(error.stack);
    }
}

testDebug();
