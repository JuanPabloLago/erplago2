const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');
const fs = require('fs');

async function test() {
    console.log('='.repeat(50));
    console.log('🔬 TEST SUPER DETALLADO');
    console.log('='.repeat(50));
    
    // Verificar archivos
    console.log('\n1. Verificando archivos:');
    console.log('Cert existe:', fs.existsSync(config.certPath));
    console.log('Key existe:', fs.existsSync(config.keyPath));
    
    // Leer contenido
    const cert = fs.readFileSync(config.certPath, 'utf8');
    const key = fs.readFileSync(config.keyPath, 'utf8');
    
    console.log('Cert empieza con:', cert.substring(0, 30));
    console.log('Key empieza con:', key.substring(0, 30));
    
    console.log('\n2. Configuración:');
    console.log('CUIT:', config.cuit);
    console.log('Producción:', config.produccion);
    console.log('Punto venta:', config.puntoVenta);
    
    try {
        console.log('\n3. Creando instancia...');
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion
        });
        
        console.log('✅ Instancia creada');
        
        console.log('\n4. Intentando obtener TA...');
        const result = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Respuesta:', result);
        
    } catch (error) {
        console.log('\n❌ ERROR COMPLETO:');
        console.log('Mensaje:', error.message);
        console.log('Code:', error.code);
        
        if (error.response) {
            console.log('\nRespuesta HTTP:');
            console.log('Status:', error.response.status);
            console.log('StatusText:', error.response.statusText);
            console.log('Headers:', JSON.stringify(error.response.headers, null, 2));
            console.log('Data:', error.response.data);
        }
        
        console.log('\nStack completo:', error.stack);
    }
}

test();
