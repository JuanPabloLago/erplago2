const AfipWS = require('afip-ws');
const path = require('path');
const fs = require('fs');

async function testAlternativo() {
    try {
        console.log('==========================================');
        console.log('🔧 PRUEBA CON LIBRERÍA ALTERNATIVA');
        console.log('==========================================\n');
        
        const certPath = path.join(__dirname, 'certificados/lago.crt');
        const keyPath = path.join(__dirname, 'certificados/lago_private.key');
        
        // Leer certificados
        const cert = fs.readFileSync(certPath, 'utf8');
        const key = fs.readFileSync(keyPath, 'utf8');
        
        console.log('📄 Certificado cargado, tamaño:', cert.length);
        console.log('🔑 Clave cargada, tamaño:', key.length);
        
        // Configuración
        const config = {
            cuit: 20296284921,
            cert: cert,
            key: key,
            production: true
        };
        
        console.log('\n🚀 Inicializando AFIP WS...');
        const afip = new AfipWS(config);
        
        console.log('✅ Librería inicializada');
        console.log('\n🔐 Solicitando TA...');
        
        const ta = await afip.getTA('wsfe');
        
        console.log('✅✅✅ TOKEN OBTENIDO CON LIBRERÍA ALTERNATIVA!');
        console.log('Token:', ta.token.substring(0, 50) + '...');
        console.log('Expira:', new Date(ta.expirationTime));
        
        return true;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
        return false;
    }
}

testAlternativo();
