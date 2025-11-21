const Afip = require('@afipsdk/afip.js');
const config = require('./config.js');

async function testCompleto() {
    console.log('='.repeat(60));
    console.log('🔐 TEST COMPLETO AFIP - Con obtención de Token');
    console.log('='.repeat(60));
    console.log('CUIT:', config.cuit);
    console.log('Ambiente:', config.produccion ? 'PRODUCCIÓN' : 'HOMOLOGACIÓN');
    console.log('PV:', config.puntoVenta);
    console.log('');

    try {
        console.log('1️⃣ Creando instancia AFIP...');
        const afip = new Afip({
            CUIT: config.cuit,
            cert: config.certPath,
            key: config.keyPath,
            production: config.produccion,
            ta_folder: './afip/tokens/'
        });
        console.log('✅ Instancia creada\n');

        console.log('2️⃣ Obteniendo Token de Acceso (TA)...');
        // Forzar obtención de nuevo TA
        const ta = await afip.ElectronicBilling.getAuthTicket(true);
        console.log('✅ Token obtenido');
        console.log('   Expira:', new Date(ta.header.expirationTime * 1000).toLocaleString());
        console.log('');

        console.log('3️⃣ Consultando estado del servidor WSFE...');
        const status = await afip.ElectronicBilling.getServerStatus();
        console.log('✅ Estado servidor:');
        console.log('   AppServer:', status.AppServer);
        console.log('   DbServer:', status.DbServer);
        console.log('   AuthServer:', status.AuthServer);
        console.log('');

        console.log('4️⃣ Consultando último comprobante PV', config.puntoVenta, '...');
        const ultimo = await afip.ElectronicBilling.getLastVoucher(config.puntoVenta, 1);
        console.log('✅ Último comprobante tipo Factura A:', ultimo);
        console.log('');

        console.log('5️⃣ Consultando puntos de venta...');
        const puntosVenta = await afip.ElectronicBilling.getSalesPoints();
        console.log('✅ Puntos de venta disponibles:', puntosVenta);
        console.log('');

        console.log('='.repeat(60));
        console.log('🎉 ¡TODAS LAS PRUEBAS EXITOSAS!');
        console.log('='.repeat(60));

    } catch (error) {
        console.log('');
        console.log('❌ ERROR:', error.message);
        console.error('Stack:', error.stack);
        if (error.response) {
            console.log('Status HTTP:', error.response.status);
            console.log('Headers:', error.response.headers);
            console.log('Data:', error.response.data);
        }
    }
}

testCompleto();
