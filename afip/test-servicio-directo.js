const AfipServiceDirecto = require('./afip-service-directo.js');
const config = require('./config.js');

async function test() {
    console.log('='.repeat(60));
    console.log('🚀 TEST SERVICIO AFIP DIRECTO (sin intermediarios)');
    console.log('='.repeat(60));

    try {
        const afip = new AfipServiceDirecto(config);
        
        console.log('\n1️⃣ Obteniendo Token de Acceso...');
        await afip.obtenerTA();
        
        console.log('\n2️⃣ Consultando estado del servidor...');
        const estado = await afip.consultarEstadoServidor();
        console.log('✅ Estado:', estado);
        
        console.log('\n3️⃣ Consultando último comprobante...');
        const ultimo = await afip.obtenerUltimoComprobante(config.puntoVenta, 1);
        console.log('✅ Último comprobante:', ultimo);
        
        console.log('\n🎉 ¡TODO FUNCIONA!');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    }
}

test();
