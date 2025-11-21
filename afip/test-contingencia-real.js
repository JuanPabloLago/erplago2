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

async function testReal() {
    console.log('🧪 Test con datos reales\n');
    
    try {
        await afipService.initialize(afipConfig);
        
        const ultimoNum = await afipService.obtenerUltimoComprobante(6, 6); // Factura B
        console.log(`Último comprobante Factura B: ${ultimoNum}`);
        
        // FACTURA B - Para consumidor final o monotributista
        const facturaData = {
            CbteTipo: 6, // Factura B
            PtoVta: 6,
            CbteDesde: ultimoNum + 1,
            CbteHasta: ultimoNum + 1,
            CbteFch: parseInt(new Date().toISOString().split('T')[0].replace(/-/g, '')),
            DocTipo: 96, // DNI
            DocNro: 12345678, // DNI de ejemplo
            ImpTotal: 1210.00,
            ImpTotConc: 0,
            ImpNeto: 1000.00,
            ImpOpEx: 0,
            ImpIVA: 210.00,
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            Concepto: 1, // Productos
            Iva: [{
                Id: 5, // 21%
                BaseImp: 1000.00,
                Importe: 210.00
            }]
        };
        
        console.log('\n📝 Generando Factura B...');
        const resultado = await EstrategiaContingencia.generarFacturaConContingencia(
            pool, 
            facturaData, 
            afipService
        );
        
        console.log('\n📊 Resultado:');
        console.log(JSON.stringify(resultado, null, 2));
        
        if (resultado.success) {
            console.log(`\n✅ FACTURA AUTORIZADA!`);
            console.log(`   CAE: ${resultado.cae}`);
            console.log(`   Vencimiento: ${resultado.vencimiento}`);
        } else if (resultado.pendiente) {
            console.log('\n⚠️ Comprobante guardado - Pendiente de CAE');
        } else {
            console.error('\n❌ Rechazado por AFIP');
            console.log('Detalles:', resultado.detalles);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

testReal();
