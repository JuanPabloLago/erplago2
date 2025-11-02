const { Afip } = require('afip'); // Corrección: Importar con destructuring
const path = require('path');

async function testAfip() {
    console.log('==========================================');
    console.log('🔧 PRUEBA CON LIBRERÍA "afip" (Importación Corregida)');
    console.log('==========================================\n');

    try {
        const certPath = path.join(__dirname, 'certificados/lago.crt');
        const keyPath = path.join(__dirname, 'certificados/lago_private.key');

        console.log('📄 Cargando Certificado:', certPath);
        console.log('🔑 Cargando Clave:', keyPath);

        // Ahora 'Afip' debería ser el constructor correcto
        const afip = new Afip({
            CUIT: 20296284921,
            cert: certPath,
            key: keyPath,
            production: true
        });

        console.log('✅ Librería inicializada para CUIT 20296284921 en PRODUCCIÓN.');
        console.log('\n🔐 Solicitando TA para wsfe (forzando uno nuevo)...');

        // Forzar la creación de un nuevo TA (el 'true' es importante)
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

testAfip();
