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

async function testContingencia() {
    console.log('🧪 Test de contingencia AFIP\n');
    
    try {
        await afipService.initialize(afipConfig);
        
        // Obtener último número
        const ultimoNum = await afipService.obtenerUltimoComprobante(6, 1);
        console.log(`Último comprobante: ${ultimoNum}`);
        
        // Datos de factura de prueba
        const facturaData = {
            CbteTipo: 1, // Factura A
            PtoVta: 6,
            CbteDesde: ultimoNum + 1,
            CbteHasta: ultimoNum + 1,
            CbteFch: parseInt(new Date().toISOString().split('T')[0].replace(/-/g, '')),
            DocTipo: 80, // CUIT
            DocNro: 20111111112,
            ImpTotal: 121.00,
            ImpTotConc: 0,
            ImpNeto: 100.00,
            ImpOpEx: 0,
            ImpIVA: 21.00,
            ImpTrib: 0,
            MonId: 'PES',
            MonCotiz: 1,
            Iva: [{
                Id: 5, // 21%
                BaseImp: 100.00,
                Importe: 21.00
            }]
        };
        
        console.log('\n📝 Generando factura de prueba...');
        const resultado = await EstrategiaContingencia.generarFacturaConContingencia(
            pool, 
            facturaData, 
            afipService
        );
        
        console.log('\n📊 Resultado:');
        console.log(JSON.stringify(resultado, null, 2));
        
        if (resultado.success) {
            console.log(`\n✅ Factura autorizada con CAE: ${resultado.cae}`);
        } else if (resultado.pendiente) {
            console.log('\n⚠️ Comprobante guardado - Pendiente de CAE');
            console.log('Se reintentará automáticamente');
        } else {
            console.error('\n❌ Error en facturación');
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

testContingencia();
