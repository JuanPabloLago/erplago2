const Afip = require('@afipsdk/afip.js');
const path = require('path');

async function probarAhora() {
    console.log('==========================================');
    console.log('🔥 PRUEBA FINAL - CERTIFICADO NUEVO');
    console.log('==========================================');
    console.log('Hora:', new Date().toLocaleString('es-AR'));
    console.log('CUIT: 20296284921');
    console.log('Certificado: LAGO_ERP_PRODUCCION');
    console.log('Punto de Venta: 6');
    console.log('==========================================\n');
    
    try {
        const afip = new Afip({
            CUIT: 20296284921,
            production: true,
            cert: path.join(__dirname, 'certificados/lago.crt'),
            key: path.join(__dirname, 'certificados/lago_private.key'),
            ta_folder: path.join(__dirname, 'tokens')
        });
        
        console.log('🔐 Solicitando Token de Acceso a AFIP...');
        const ta = await afip.GetServiceTA('wsfe', true);
        
        console.log('\n✅✅✅ ¡TOKEN OBTENIDO! ✅✅✅');
        console.log('Token válido hasta:', new Date(ta.expiration * 1000).toLocaleString('es-AR'));
        
        console.log('\n📊 Consultando últimos comprobantes...');
        
        try {
            const ultimoB = await afip.ElectronicBilling.GetLastVoucher(6, 6);
            console.log('✅ Último Factura B (PV 6):', ultimoB);
        } catch (e) {
            console.log('⚠️  Factura B:', e.message);
        }
        
        try {
            const ultimoA = await afip.ElectronicBilling.GetLastVoucher(6, 1);
            console.log('✅ Último Factura A (PV 6):', ultimoA);
        } catch (e) {
            console.log('⚠️  Factura A:', e.message);
        }
        
        console.log('\n==========================================');
        console.log('🎉🎉🎉 AFIP FUNCIONANDO CORRECTAMENTE! 🎉🎉🎉');
        console.log('==========================================');
        
    } catch (error) {
        console.error('\n==========================================');
        console.error('❌ ERROR');
        console.error('==========================================');
        console.error('Mensaje:', error.message);
        console.error('Código HTTP:', error.response?.status);
        
        if (error.response?.status === 401) {
            console.error('\n💡 Error 401 = Certificado aún no autorizado en AFIP');
            console.error('   Recomendación: Esperar 30 minutos más o usar certificado válido anterior');
        }
        
        if (error.response?.status === 400) {
            console.error('\n💡 Error 400 = Problema de formato o configuración');
        }
    }
}

probarAhora();
