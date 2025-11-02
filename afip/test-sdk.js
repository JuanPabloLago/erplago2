const { Afip } = require('@afipsdk/afip.js'); // <-- ESTA ES LA LÍNEA CLAVE
const path = require('path');

async function testSDK() {
    console.log('==========================================');
    console.log('🔧 PRUEBA CON SDK OFICIAL "@afipsdk/afip.js"');
    console.log('==========================================\n');

    try {
        const certPath = path.join(__dirname, 'certificados/lago.crt');
        const keyPath = path.join(__dirname, 'certificados/lago_private.key');

        console.log('📄 Cargando Certificado:', certPath);
        console.log('🔑 Cargando Clave:', keyPath);

        const afip = new Afip({
            CUIT: 20296284921,
            cert: certPath,
            key: keyPath,
            production: true
        });

        console.log('✅ SDK inicializado para CUIT 20296284921 en PRODUCCIÓN.');
        console.log('\n🔐 Solicitando TA para wsfe (forzando uno nuevo)...');

        const ta = await afip.ElectronicBilling.getTicket(true); 

        console.log('✅✅✅ ¡TOKEN OBTENIDO CON ÉXITO!');
        console.log('Token:', ta.token.substring(0, 50) + '...');
        console.log('Sign:', ta.sign.substring(0, 50) + '...');
        console.log('Expira:', ta.expirationTime);

        console.log('\n🔍 Probando conexión... (Consultando punto de venta)');
        const ptoVenta = await afip.ElectronicBilling.getSalesPoints();
        
        console.log('✅✅✅ ¡CONEXIÓN EXITOSA!');
        console.log('Puntos de venta encontrados:', ptoVenta);

    } catch (error) {
        console.error('❌❌❌ ERROR EN LA PRUEBA ❌❌❌');
        console.error(error);
    }
}

testSDK();
