const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');
const fs = require('fs');

async function testConDebug() {
    console.log('='.repeat(60));
    console.log('🔍 TEST CON DEBUG DETALLADO');
    console.log('='.repeat(60));
    
    // Verificar que los archivos existen y tienen contenido
    console.log('\n1️⃣ Verificando archivos de certificados...');
    try {
        const certContent = fs.readFileSync(config.certPath, 'utf8');
        const keyContent = fs.readFileSync(config.keyPath, 'utf8');
        
        console.log('✅ Certificado leído:', certContent.length, 'bytes');
        console.log('   Comienza con:', certContent.substring(0, 30));
        console.log('✅ Clave privada leída:', keyContent.length, 'bytes');
        console.log('   Comienza con:', keyContent.substring(0, 30));
    } catch (err) {
        console.error('❌ Error leyendo archivos:', err.message);
        return;
    }

    console.log('\n2️⃣ Creando instancia con debug habilitado...');
    try {
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion,
            ta_folder: './afip/tokens/',
            debug: true
        });
        
        console.log('✅ Instancia creada');
        console.log('   CUIT:', afip.CUIT);
        console.log('   Production:', afip.options.production);
        
        console.log('\n3️⃣ Intentando consulta al servidor...');
        const serverStatus = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Respuesta exitosa:', serverStatus);
        
    } catch (error) {
        console.log('\n❌ ERROR CAPTURADO:');
        console.log('   Mensaje:', error.message);
        console.log('   Código:', error.code);
        
        if (error.response) {
            console.log('\n📡 Detalles de la respuesta HTTP:');
            console.log('   Status:', error.response.status);
            console.log('   StatusText:', error.response.statusText);
            console.log('   URL:', error.response.config?.url || 'N/A');
            console.log('   Method:', error.response.config?.method || 'N/A');
            
            if (error.response.data) {
                console.log('   Data:', JSON.stringify(error.response.data, null, 2));
            }
            
            if (error.response.headers) {
                console.log('   Headers:', error.response.headers);
            }
        }
        
        if (error.config) {
            console.log('\n📤 Request enviado:');
            console.log('   URL:', error.config.url);
            console.log('   Method:', error.config.method);
            console.log('   Headers:', error.config.headers);
        }
        
        console.log('\n📋 Stack trace:');
        console.log(error.stack);
    }
}

testConDebug();
