const { Pool } = require('pg');
const afipService = require('./afip-service.js');
const EstrategiaContingencia = require('./estrategia-contingencia.js');
const afipConfig = require('./config.js');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function test() {
    console.log('🧪 Test con PV 6 corregido\n');
    
    try {
        await afipService.initialize(afipConfig);
        
        const ultimoB = await afipService.obtenerUltimoComprobante(6, 6);
        console.log(`Último número Factura B en PV 6: ${ultimoB}`);
        
        const facturaData = {
            CbteTipo: 6,
            PtoVta: 6,
            CbteDesde: ultimoB + 1,
            CbteHasta: ultimoB + 1,
            CbteFch: parseInt(new Date().toISOString().split('T')[0].replace(/-/g, '')),
            DocTipo: 96,
            DocNro: 12345678,
            ImpTotal: 121.00,
            ImpTotConc: 0,
            ImpNeto: 100.00,
            ImpOpEx: 0,
            ImpIVA: 21.00,
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            Concepto: 1,
            Iva: [{
                Id: 5,
                BaseImp: 100.00,
                Importe: 21.00
            }]
        };
        
        console.log('\n📝 Generando Factura B en PV 6...');
        const resultado = await EstrategiaContingencia.generarFacturaConContingencia(
            pool, 
            facturaData, 
            afipService
        );
        
        console.log('\n📊 Resultado:');
        console.log(JSON.stringify(resultado, null, 2));
        
        if (resultado.success) {
            console.log(`\n🎉 ¡FACTURA AUTORIZADA CON PV 6!`);
            console.log(`   CAE: ${resultado.cae}`);
            console.log(`   Vencimiento: ${resultado.vencimiento}`);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

test();
