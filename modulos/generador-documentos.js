/**
 * MÓDULO REUTILIZABLE: Generador de Documentos
 * Genera PDFs, Excel, envía por email/WhatsApp
 */

const puppeteer = require('puppeteer');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const fs = require('fs').promises;
const path = require('path');

class GeneradorDocumentos {
    constructor(config = {}) {
        this.nombreEmpresa = config.nombreEmpresa || 'Mi Empresa';
        this.emailConfig = config.email || null;
        this.whatsappNumero = config.whatsapp || null;
        this.logoPath = config.logoPath || null;
    }

    /**
     * Genera un PDF a partir de HTML
     */
    async generarPDF(html, opciones = {}) {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0' });

            const pdfBuffer = await page.pdf({
                format: opciones.formato || 'A4',
                margin: opciones.margin || {
                    top: '20mm',
                    right: '15mm',
                    bottom: '20mm',
                    left: '15mm'
                },
                printBackground: true,
                displayHeaderFooter: opciones.displayHeaderFooter || false,
                headerTemplate: opciones.headerTemplate || '',
                footerTemplate: opciones.footerTemplate || ''
            });

            return pdfBuffer;
        } finally {
            await browser.close();
        }
    }

    /**
     * Genera un código QR
     */
    async generarQR(texto) {
        return await QRCode.toDataURL(texto);
    }

    /**
     * Genera un archivo Excel
     */
    async generarExcel(datos, opciones = {}) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(opciones.nombreHoja || 'Datos');

        // Configurar columnas
        if (opciones.columnas) {
            worksheet.columns = opciones.columnas;
        }

        // Agregar filas
        if (Array.isArray(datos)) {
            datos.forEach(fila => worksheet.addRow(fila));
        }

        // Estilos para el header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

        // Autoajustar columnas
        worksheet.columns.forEach(column => {
            let maxLength = 0;
            column.eachCell({ includeEmpty: true }, cell => {
                const length = cell.value ? cell.value.toString().length : 10;
                if (length > maxLength) maxLength = length;
            });
            column.width = Math.min(maxLength + 2, 50);
        });

        return await workbook.xlsx.writeBuffer();
    }

    /**
     * Envía un email con adjunto
     */
    async enviarEmail(destinatario, asunto, contenidoHTML, adjuntos = []) {
        if (!this.emailConfig) {
            throw new Error('Configuración de email no disponible');
        }

        const transporter = nodemailer.createTransport(this.emailConfig);

        const mailOptions = {
            from: this.emailConfig.auth.user,
            to: destinatario,
            subject: asunto,
            html: contenidoHTML,
            attachments: adjuntos
        };

        return await transporter.sendMail(mailOptions);
    }

    /**
     * Genera un link de WhatsApp con mensaje pre-formateado
     */
    generarLinkWhatsApp(numero, mensaje, adjuntarArchivo = false) {
        const numeroLimpio = numero.replace(/\D/g, '');
        const mensajeCodificado = encodeURIComponent(mensaje);
        
        if (adjuntarArchivo) {
            return `https://wa.me/${numeroLimpio}?text=${mensajeCodificado}%0A%0A_Archivo adjunto en el siguiente mensaje_`;
        }
        
        return `https://wa.me/${numeroLimpio}?text=${mensajeCodificado}`;
    }

    /**
     * Carga un template HTML
     */
    async cargarTemplate(nombreTemplate, datos) {
        const templatePath = path.join(__dirname, '../templates', `${nombreTemplate}.html`);
        let html = await fs.readFile(templatePath, 'utf-8');

        // Reemplazar variables {{variable}} con datos
        Object.keys(datos).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            html = html.replace(regex, datos[key]);
        });

        return html;
    }

    /**
     * Genera HTML desde un objeto de datos (sin template)
     */
    generarHTMLSimple(titulo, datos) {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { font-family: Arial, sans-serif; margin: 20px; }
                    h1 { color: #333; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
                    th { background-color: #4472C4; color: white; }
                    .totales { font-weight: bold; font-size: 1.2em; margin-top: 20px; }
                </style>
            </head>
            <body>
                <h1>${titulo}</h1>
                ${this._generarTablaHTML(datos)}
            </body>
            </html>
        `;
    }

    _generarTablaHTML(datos) {
        if (!Array.isArray(datos) || datos.length === 0) return '';

        const columnas = Object.keys(datos[0]);
        
        let html = '<table><thead><tr>';
        columnas.forEach(col => {
            html += `<th>${col}</th>`;
        });
        html += '</tr></thead><tbody>';

        datos.forEach(fila => {
            html += '<tr>';
            columnas.forEach(col => {
                html += `<td>${fila[col]}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
    }
}

module.exports = GeneradorDocumentos;
