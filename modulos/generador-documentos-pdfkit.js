const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');

class GeneradorDocumentosPDFKit {
    constructor(config = {}) {
        this.nombreEmpresa = config.nombreEmpresa || 'Mi Empresa';
        this.emailConfig = config.email || null;
    }

    async generarPDFRecibo(datosRecibo) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const chunks = [];

                doc.on('data', chunk => chunks.push(chunk));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                // HEADER
                doc.fontSize(20).fillColor('#4472C4').text(datosRecibo.nombreEmpresa || 'ERP LAGO', { align: 'center' });
                doc.fontSize(10).fillColor('#666')
                   .text(datosRecibo.cuitEmpresa || 'CUIT: -', { align: 'center' })
                   .text(datosRecibo.direccionEmpresa || '', { align: 'center' });
                doc.moveDown();

                doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#4472C4');
                doc.moveDown();

                doc.fontSize(18).fillColor('#000').text('RECIBO N° ' + (datosRecibo.numeroRecibo || ''), { align: 'center' });
                doc.moveDown();

                // INFO
                doc.fontSize(11).fillColor('#000');
                const infoY = doc.y;
                doc.text('Fecha: ' + (datosRecibo.fecha || '-'), 50, infoY);
                doc.text('Hora: ' + (datosRecibo.hora || '-'), 350, infoY);
                doc.moveDown();
                doc.text('Cliente: ' + (datosRecibo.cliente || '-'), 50);
                doc.text('CUIT: ' + (datosRecibo.clienteCuit || 'N/A'), 350, doc.y - 15);
                doc.moveDown(2);

                // DETALLE DE PEDIDOS
                if (datosRecibo.pedidos && datosRecibo.pedidos.length > 0) {
                    doc.fontSize(12).fillColor('#4472C4').text('Detalle de Pedidos:', 50);
                    doc.moveDown(0.5);

                    const tableTop = doc.y;
                    const col1 = 50, col2 = 150, col3 = 250, col4 = 350, col5 = 470;

                    // Header
                    doc.fontSize(10).fillColor('#fff');
                    doc.rect(col1, tableTop, 500, 20).fill('#4472C4');
                    doc.text('Pedido', col1 + 5, tableTop + 5, { width: 90 });
                    doc.text('Fecha', col2 + 5, tableTop + 5, { width: 90 });
                    doc.text('Total', col3 + 5, tableTop + 5, { width: 90 });
                    doc.text('Pagado', col4 + 5, tableTop + 5, { width: 110 });
                    doc.text('Aplicado', col5 + 5, tableTop + 5, { width: 70 });

                    // Filas
                    let y = tableTop + 25;
                    doc.fontSize(9);
                    datosRecibo.pedidos.forEach((pedido, i) => {
                        if (i % 2 === 0) {
                            doc.rect(col1, y - 3, 500, 18).fillAndStroke('#f8f9fa');
                        }
                        doc.fillColor('#000');
                        doc.text('#' + pedido.id_pedido, col1 + 5, y, { width: 90 });
                        doc.text(pedido.fecha || '-', col2 + 5, y, { width: 90 });
                        doc.text('$' + pedido.total, col3 + 5, y, { width: 90 });
                        doc.text(pedido.pagado || '-', col4 + 5, y, { width: 110 });
                        doc.text('$' + pedido.aplicado, col5 + 5, y, { width: 70 });
                        y += 20;
                    });

                    doc.y = y + 10;
                }

                doc.moveDown();

                // FORMAS DE PAGO
                doc.fontSize(12).fillColor('#4472C4').text('Formas de Pago:', 50);
                doc.moveDown(0.5);

                if (datosRecibo.formasPago && datosRecibo.formasPago.length > 0) {
                    doc.fontSize(11).fillColor('#000');
                    datosRecibo.formasPago.forEach(fp => {
                        doc.text('  • ' + fp.forma, 70);
                        doc.text('$' + fp.monto, 500, doc.y - 15, { align: 'right' });
                    });
                }

                doc.moveDown(2);

                // TOTAL
                const totalY = doc.y;
                doc.rect(50, totalY, 500, 40).fillAndStroke('#28a745', '#28a745');
                doc.fontSize(16).fillColor('#fff').text('TOTAL COBRADO:', 60, totalY + 12);
                doc.fontSize(20).text(datosRecibo.totalCobrado || '$0.00', 400, totalY + 10, { width: 140, align: 'right' });

                doc.y = totalY + 45;
                doc.moveDown(2);

                // QR CODE
                if (datosRecibo.qrCode) {
                    try {
                        const qrBuffer = Buffer.from(datosRecibo.qrCode.split(',')[1], 'base64');
                        doc.image(qrBuffer, 250, doc.y, { width: 100 });
                        doc.moveDown(7);
                    } catch (e) {
                        // Si falla el QR, continuar sin él
                    }
                }

                // FOOTER
                doc.fontSize(9).fillColor('#666');
                doc.text('Documento generado electronicamente - ' + (datosRecibo.nombreEmpresa || 'ERP LAGO'), { align: 'center' });
                doc.text(datosRecibo.fechaGeneracion || '', { align: 'center' });

                doc.end();

            } catch (error) {
                reject(error);
            }
        });
    }

    async generarQR(texto) {
        return await QRCode.toDataURL(texto);
    }

    async generarExcel(datos, opciones = {}) {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(opciones.nombreHoja || 'Datos');

        if (opciones.columnas) {
            worksheet.columns = opciones.columnas;
        }

        if (Array.isArray(datos)) {
            datos.forEach(fila => worksheet.addRow(fila));
        }

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

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

    generarLinkWhatsApp(numero, mensaje) {
        const numeroLimpio = numero.replace(/\D/g, '');
        const mensajeCodificado = encodeURIComponent(mensaje);
        return `https://wa.me/${numeroLimpio}?text=${mensajeCodificado}`;
    }
}

module.exports = GeneradorDocumentosPDFKit;
