const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');

async function testApiCorrecta() {
    console.log('='.repeat(60));
    console.log('✅ TEST CON API CORRECTA DE @afipsdk/afip.js');
    console.log('='.repeat(60));
    console.log('CUIT:', config.cuit);
    console.log('Ambiente:', config.produccion ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN');
    console.log('PV:', config.puntoVenta);
    console.log('');

    try {
        console.log('1️⃣ Inicializando SDK...');
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion,
            ta_folder: './afip/tokens/'
        });
        console.log('✅ SDK inicializado\n');

        console.log('2️⃣ Consultando estado del servidor...');
        const serverStatus = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Estado del servidor:');
        console.log('   AppServer:', serverStatus.AppServer);
        console.log('   DbServer:', serverStatus.DbServer);
        console.log('   AuthServer:', serverStatus.AuthServer);
        console.log('');

        console.log('3️⃣ Consultando puntos de venta disponibles...');
        const puntosVenta = await afip.ElectronicBilling.getSalesPoints();
        console.log('✅ Puntos de venta:', puntosVenta);
        console.log('');

        console.log('4️⃣ Consultando último comprobante del PV', config.puntoVenta, '...');
        // Tipo de comprobante 1 = Factura A
        const ultimoComp = await afip.ElectronicBilling.getLastVoucher(config.puntoVenta, 1);
        console.log('✅ Último comprobante tipo Factura A:', ultimoComp);
        console.log('');

        console.log('5️⃣ Consultando tipos de comprobantes disponibles...');
        const tiposComp = await afip.ElectronicBilling.getVoucherTypes();
        console.log('✅ Tipos disponibles:', tiposComp.length, 'tipos');
        console.log('   Algunos ejemplos:', tiposComp.slice(0, 5));
        console.log('');

        console.log('='.repeat(60));
        console.log('🎉 ¡TODAS LAS CONSULTAS EXITOSAS!');
        console.log('='.repeat(60));

    } catch (error) {
        console.log('');
        console.log('❌ ERROR:', error.message);
        console.error('\n📋 Stack completo:');
        console.error(error.stack);
        
        if (error.response) {
            console.log('\n📡 Respuesta HTTP:');
            console.log('   Status:', error.response.status);
            console.log('   StatusText:', error.response.statusText);
            console.log('   Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

testApiCorrecta();
