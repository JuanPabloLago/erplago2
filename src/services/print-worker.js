// ═══════════════════════════════════════════════════════════════════════════════
// PRINT WORKER - Sistema de Impresión Centralizado
// Escucha PostgreSQL NOTIFY y procesa jobs de impresión/PDF/WhatsApp
// ═══════════════════════════════════════════════════════════════════════════════

const { Client } = require('pg');
const pool = require('../config/database');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════════
const TEMPLATES_PATH = path.join(__dirname, '../../templates/comprobantes');
const OUTPUT_PATH = path.join(__dirname, '../../uploads/comprobantes');
const CHANNEL = 'new_print_job';

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS DE HANDLEBARS
// ═══════════════════════════════════════════════════════════════════════════════
Handlebars.registerHelper('formatNumber', (num) => {
    return parseFloat(num || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});

Handlebars.registerHelper('formatDate', (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
});

Handlebars.registerHelper('padLeft', (num, length) => {
    return String(num).padStart(length, '0');
});

Handlebars.registerHelper('now', () => {
    return new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
});

Handlebars.registerHelper('eq', (a, b) => a === b);

// ═══════════════════════════════════════════════════════════════════════════════
// FUNCIONES DE DATOS
// ═══════════════════════════════════════════════════════════════════════════════
async function obtenerDatosComprobante(idPedido, idEmpresa) {
    // Pedido + Cliente (C5 fix: filtro multi-empresa)
    const pedidoResult = await pool.query(`
        SELECT 
            p.*,
            c.razon_social as cliente_razon_social,
            c.cuit_cuil as cliente_cuit,
            c.domicilio as cliente_domicilio,
            c.telefono as cliente_telefono,
            c.email as cliente_email,
            e.nombre as estado_nombre
        FROM pedidos p
        JOIN clientes c ON c.id_cliente = p.id_cliente
        JOIN pedidoestados e ON e.id_estado = p.id_estado
        WHERE p.id_pedido = $1 AND p.id_empresa = $2
    `, [idPedido, idEmpresa]);

    if (pedidoResult.rows.length === 0) {
        throw new Error(`Pedido ${idPedido} no encontrado`);
    }

    const pedido = pedidoResult.rows[0];

    // Items del pedido
    // C5 fix: filtro multi-empresa
    const itemsResult = await pool.query(`
        SELECT 
            pi.*,
            pr.sku,
            pr.nombre as producto_nombre
        FROM pedidoitems pi
        JOIN productos pr ON pr.id_producto = pi.id_producto
        WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
        ORDER BY pi.id_item
    `, [idPedido, idEmpresa]);

    // Empresa
    const empresaResult = await pool.query(`
        SELECT * FROM empresas WHERE id_empresa = $1
    `, [pedido.id_empresa]);

    // Pagos
    // C5+C6 fix: filtro multi-empresa + excluir pagos anulados
    const pagosResult = await pool.query(`
        SELECT 
            pa.monto,
            mp.nombre as metodo
        FROM pagos pa
        JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago
        WHERE pa.id_pedido = $1
          AND pa.id_empresa = $2
          AND pa.id_estado != 3
    `, [idPedido, idEmpresa]);

    const totalPagado = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
    const totalFinal = parseFloat(pedido.total_final || pedido.total || 0);

    return {
        pedido: {
            ...pedido,
            subtotal_sin_iva: pedido.subtotal_sin_iva || (totalFinal / 1.21),
            total_iva: pedido.total_iva || (totalFinal - totalFinal / 1.21),
            total_final: totalFinal
        },
        cliente: {
            razon_social: pedido.cliente_razon_social,
            cuit_cuil: pedido.cliente_cuit || '-',
            domicilio: pedido.cliente_domicilio || '-',
            telefono: pedido.cliente_telefono,
            email: pedido.cliente_email
        },
        empresa: empresaResult.rows[0] || {},
        items: itemsResult.rows.map(item => ({
            ...item,
            sku: item.sku || 'S/C',
            descripcion_congelada: item.descripcion_congelada || item.producto_nombre
        })),
        pagos: pagosResult.rows,
        pagado: totalPagado >= totalFinal - 0.01
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERADOR DE PDF
// ═══════════════════════════════════════════════════════════════════════════════
async function generarPDF(html, outputPath) {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        await page.pdf({
            path: outputPath,
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            printBackground: true
        });

        console.log(`✅ PDF generado: ${outputPath}`);
        return outputPath;
    } finally {
        await browser.close();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTRATEGIAS DE OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════
async function procesarPDF(job, html) {
    // Asegurar directorio de salida
    await fs.mkdir(OUTPUT_PATH, { recursive: true });
    
    const fileName = `${job.document_type}_${job.document_id}_${Date.now()}.pdf`;
    const filePath = path.join(OUTPUT_PATH, fileName);
    
    await generarPDF(html, filePath);
    return filePath;
}

async function procesarImpresion(job, html, printerName) {
    // Primero generar PDF temporal
    const tempPath = `/tmp/print_${job.id_job}_${Date.now()}.pdf`;
    await generarPDF(html, tempPath);
    
    // Imprimir con lp (CUPS)
    try {
        const cmd = `lp -d "${printerName}" "${tempPath}"`;
        const { stdout, stderr } = await execAsync(cmd);
        console.log(`✅ Enviado a impresora ${printerName}:`, stdout);
        
        // Limpiar archivo temporal después de 10 segundos
        setTimeout(async () => {
            try { await fs.unlink(tempPath); } catch (e) {}
        }, 10000);
        
        return { printed: true, printer: printerName };
    } catch (error) {
        throw new Error(`Error imprimiendo: ${error.message}`);
    }
}

async function procesarWhatsApp(job, pdfPath) {
    // TODO: Implementar con baileys o whatsapp-web.js
    // Por ahora solo retornamos el path del PDF
    console.log(`📱 WhatsApp pendiente de implementar para: ${job.whatsapp_number}`);
    return { whatsapp: 'pending', number: job.whatsapp_number, pdfPath };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROCESADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
async function procesarJob(jobId) {
    const client = await pool.connect();
    
    try {
        // Obtener job
        const jobResult = await client.query(
            'SELECT * FROM print_jobs WHERE id_job = $1 AND status = $2',
            [jobId, 'PENDING']
        );

        if (jobResult.rows.length === 0) {
            console.log(`Job ${jobId} no encontrado o ya procesado`);
            return;
        }

        const job = jobResult.rows[0];
        console.log(`🔄 Procesando job #${job.id_job}: ${job.document_type} - ${job.type}`);

        // Marcar como procesando
        await client.query(
            'UPDATE print_jobs SET status = $1, updated_at = NOW() WHERE id_job = $2',
            ['PROCESSING', jobId]
        );

        // Cargar plantilla
        const templatePath = path.join(TEMPLATES_PATH, `${job.document_type}.hbs`);
        const templateContent = await fs.readFile(templatePath, 'utf8');
        const template = Handlebars.compile(templateContent);

        // Obtener datos según tipo de documento
        let data;
        if (job.document_type === 'comprobante_venta') {
            data = await obtenerDatosComprobante(job.document_id, job.id_empresa);
        } else {
            throw new Error(`Tipo de documento no soportado: ${job.document_type}`);
        }

        // Renderizar HTML
        const html = template(data);

        // Procesar según tipo de output
        let result;
        let outputPath = null;

        switch (job.type) {
            case 'PDF':
                outputPath = await procesarPDF(job, html);
                result = { success: true, path: outputPath };
                break;

            case 'PRINT':
                // Obtener impresora
                const printerResult = await client.query(
                    'SELECT system_name_cups FROM printers_config WHERE id_printer = $1',
                    [job.printer_id]
                );
                const printerName = printerResult.rows[0]?.system_name_cups || 'default';
                result = await procesarImpresion(job, html, printerName);
                break;

            case 'WHATSAPP':
                outputPath = await procesarPDF(job, html);
                result = await procesarWhatsApp(job, outputPath);
                break;

            default:
                throw new Error(`Tipo de output no soportado: ${job.type}`);
        }

        // Marcar como completado
        await client.query(`
            UPDATE print_jobs 
            SET status = 'COMPLETED', 
                output_path = $1,
                processed_at = NOW(),
                updated_at = NOW()
            WHERE id_job = $2
        `, [outputPath, jobId]);

        console.log(`✅ Job #${jobId} completado:`, result);
        return result;

    } catch (error) {
        console.error(`❌ Error en job #${jobId}:`, error.message);
        
        // Marcar como error
        await client.query(`
            UPDATE print_jobs 
            SET status = 'ERROR', 
                error_message = $1,
                updated_at = NOW()
            WHERE id_job = $2
        `, [error.message, jobId]);
        
        throw error;
    } finally {
        client.release();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LISTENER DE POSTGRESQL
// ═══════════════════════════════════════════════════════════════════════════════
async function startWorker() {
    console.log('🖨️  Print Worker iniciando...');
    
    // Asegurar directorio de salida existe
    await fs.mkdir(OUTPUT_PATH, { recursive: true });

    // Cliente dedicado para LISTEN
    const listenClient = new Client({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'juanpablo',
        password: process.env.DB_PASSWORD || 'Huu3697debian@',
        database: process.env.DB_NAME || 'erplago'
    });

    await listenClient.connect();
    console.log('✅ Conectado a PostgreSQL');

    // Escuchar canal
    await listenClient.query(`LISTEN ${CHANNEL}`);
    console.log(`👂 Escuchando canal: ${CHANNEL}`);

    // Handler de notificaciones
    listenClient.on('notification', async (msg) => {
        console.log(`📬 Notificación recibida: ${msg.payload}`);
        const jobId = parseInt(msg.payload);
        
        if (!isNaN(jobId)) {
            try {
                await procesarJob(jobId);
            } catch (error) {
                console.error('Error procesando job:', error);
            }
        }
    });

    // Procesar jobs pendientes al iniciar
    console.log('🔍 Buscando jobs pendientes...');
    const pendingJobs = await pool.query(
        "SELECT id_job FROM print_jobs WHERE status = 'PENDING' ORDER BY created_at"
    );
    
    for (const row of pendingJobs.rows) {
        try {
            await procesarJob(row.id_job);
        } catch (error) {
            console.error(`Error procesando job pendiente ${row.id_job}:`, error);
        }
    }

    console.log('🖨️  Print Worker listo y esperando jobs...');
}

// Manejar errores y señales
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('SIGTERM', () => {
    console.log('Cerrando Print Worker...');
    process.exit(0);
});

// Iniciar si se ejecuta directamente
if (require.main === module) {
    startWorker().catch(console.error);
}

module.exports = { startWorker, procesarJob, obtenerDatosComprobante, generarPDF };
