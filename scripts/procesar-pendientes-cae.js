#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const afipService = require('../afip/afip-service.js');
const EstrategiaContingencia = require('../afip/estrategia-contingencia.js');
const afipConfig = require('../afip/config.js');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

async function main() {
    try {
        console.log('='.repeat(60));
        console.log('🔄 PROCESO DE REINTENTOS CAE - ' + new Date().toLocaleString());
        console.log('='.repeat(60));
        
        await afipService.initialize(afipConfig);
        const resultado = await EstrategiaContingencia.procesarComprobantesPendientes(pool, afipService);
        
        console.log('='.repeat(60));
        console.log('✅ Proceso completado');
        console.log('='.repeat(60));
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error en proceso:', error.message);
        await pool.end();
        process.exit(1);
    }
}

main();
