const pool = require('./src/config/database');
const afipService = require('./src/services/afip.service');

(async () => {
    try {
        console.log('1. Cargando config...');
        await afipService.cargarConfiguracion(pool, 1);
        console.log('   Config:', JSON.stringify({
            env: afipService.config.env,
            cuit: afipService.config.cuit,
            offline: afipService.config.modoOffline
        }));

        console.log('2. Consultando último comprobante Fac B (tipo 6) PV 6...');
        const ultimoB = await afipService.ultimoComprobante(6, 6);
        console.log('   Último Fac B en AFIP:', ultimoB);

        console.log('3. Consultando último comprobante Fac A (tipo 1) PV 6...');
        const ultimoA = await afipService.ultimoComprobante(6, 1);
        console.log('   Último Fac A en AFIP:', ultimoA);

        console.log('\n=== RESULTADO ===');
        console.log('AFIP espera Fac B nro:', ultimoB + 1);
        console.log('AFIP espera Fac A nro:', ultimoA + 1);
        console.log('Tu secuencia BD Fac B:', 111, '(próximo: 112)');
        console.log('Tu secuencia BD Fac A:', 1, '(próximo: 2)');

    } catch (err) {
        console.error('ERROR:', err.message);
    }
    process.exit(0);
})();
