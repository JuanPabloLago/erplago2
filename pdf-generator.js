const PDFDocument = require('pdfkit');

// =======================================================================
//                    CONFIGURACIÓN Y CONSTANTES
// =======================================================================

const COLORS = {
    primary: '#2563eb',     // Azul principal
    secondary: '#64748b',   // Gris secundario
    dark: '#1e293b',        // Texto oscuro
    light: '#f1f5f9',       // Fondo claro
    success: '#10b981',     // Verde
    warning: '#f59e0b',     // Amarillo
    danger: '#ef4444'       // Rojo
};

const FONTS = {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold'
};

// =======================================================================
//                    FUNCIONES UTILITARIAS
// =======================================================================

/**
 * Formatea un número como moneda argentina
 * @param {number} amount - Monto a formatear
 * @returns {string} Monto formateado (ej: $1,234.56)
 */
function formatCurrency(amount) {
    if (!amount || isNaN(amount)) return '$0.00';
    return `$${parseFloat(amount).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
}

/**
 * Formatea una fecha en formato DD/MM/YYYY
 * @param {Date|string} date - Fecha a formatear
 * @returns {string} Fecha formateada
 */
function formatDate(date) {
    if (!date) return '';
    const dt = new Date(date);
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = dt.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Formatea CUIT/CUIL con guiones (XX-XXXXXXXX-X)
 * @param {string} cuit - CUIT a formatear
 * @returns {string} CUIT formateado
 */
function formatCUIT(cuit) {
    if (!cuit) return '';
    const cleanCuit = String(cuit).replace(/\D/g, '');
    if (cleanCuit.length === 11) {
        return `${cleanCuit.slice(0, 2)}-${cleanCuit.slice(2, 10)}-${cleanCuit.slice(10)}`;
    }
    return cuit;
}

// =======================================================================
//                    COMPONENTES DE PDF
// =======================================================================

/**
 * Agrega el encabezado al documento PDF
 * @param {PDFDocument} doc - Documento PDF
 * @param {object} empresa - Datos de la empresa
 * @param {string} tipoDocumento - Tipo de documento (FACTURA A, REMITO, etc.)
 * @param {string} numeroCompleto - Número completo del documento
 */
function addHeader(doc, empresa, tipoDocumento, numeroCompleto) {
    // Fondo del encabezado
    doc.rect(0, 0, 612, 120).fill(COLORS.primary);
    
    // Datos de la empresa (izquierda)
    doc.fillColor('white')
       .fontSize(24)
       .font(FONTS.bold)
       .text(empresa.razon_social || 'EMPRESA S.A.', 50, 30);
    
    doc.fontSize(10)
       .font(FONTS.regular)
       .text(empresa.direccion || 'Dirección no especificada', 50, 60)
       .text(`CUIT: ${formatCUIT(empresa.cuit)}`, 50, 75);
    
    if (empresa.telefono) {
        doc.text(`Tel: ${empresa.telefono}`, 50, 90);
    }
    
    // Tipo de documento (derecha)
    doc.fontSize(28)
       .font(FONTS.bold)
       .text(tipoDocumento, 450, 35);
    
    doc.fontSize(12)
       .font(FONTS.regular)
       .text(numeroCompleto, 420, 75, { align: 'right', width: 150 });
    
    // Restablecer color
    doc.fillColor(COLORS.dark);
}

/**
 * Agrega el pie de página al documento
 * @param {PDFDocument} doc - Documento PDF
 * @param {number} pageNumber - Número de página actual
 */
function addFooter(doc, pageNumber) {
    doc.fontSize(8)
       .fillColor(COLORS.secondary)
       .text('Documento válido como comprobante', 50, 750, { 
           align: 'center', 
           width: 512 
       })
       .text(`Página ${pageNumber}`, 50, 765, { 
           align: 'center', 
           width: 512 
       });
}

/**
 * Agrega la información del cliente al documento
 * @param {PDFDocument} doc - Documento PDF
 * @param {object} cliente - Datos del cliente
 * @param {number} startY - Posición Y inicial
 * @returns {number} Nueva posición Y después de agregar la info
 */
function addClientInfo(doc, cliente, startY) {
    let currentY = startY;
    
    // Título
    doc.fontSize(10)
       .font(FONTS.bold)
       .fillColor(COLORS.dark)
       .text('CLIENTE:', 50, currentY);
    
    // Razón social
    doc.font(FONTS.regular)
       .text(cliente.razon_social || 'Consumidor Final', 150, currentY);
    
    currentY += 15;
    
    // CUIT (si existe)
    if (cliente.cuit_cuil) {
        doc.text('CUIT:', 50, currentY)
           .text(formatCUIT(cliente.cuit_cuil), 150, currentY);
        currentY += 15;
    }
    
    // Condición IVA (si existe)
    if (cliente.condicion_iva) {
        doc.text('Condición IVA:', 50, currentY)
           .text(cliente.condicion_iva, 150, currentY);
        currentY += 15;
    }
    
    // Dirección (si existe)
    if (cliente.direccion) {
        doc.text('Dirección:', 50, currentY)
           .text(cliente.direccion, 150, currentY, { width: 400 });
        currentY += 15;
    }
    
    return currentY + 15; // Espacio adicional
}

/**
 * Agrega la tabla de items al documento
 * @param {PDFDocument} doc - Documento PDF
 * @param {Array} items - Array de items
 * @param {number} startY - Posición Y inicial
 * @param {boolean} mostrarPrecios - Si debe mostrar precios (true para facturas, false para remitos)
 * @returns {number} Nueva posición Y después de la tabla
 */
function addItemsTable(doc, items, startY, mostrarPrecios = true) {
    const tableTop = startY;
    const col1 = 50;   // Descripción
    const col2 = 280;  // Cantidad
    const col3 = 360;  // Precio Unitario
    const col4 = 420;  // IVA
    const col5 = 490;  // Total
    
    // Encabezado de la tabla
    doc.rect(col1, tableTop, 512, 25).fill(COLORS.light);
    
    doc.fontSize(9)
       .font(FONTS.bold)
       .fillColor(COLORS.dark);
    
    if (mostrarPrecios) {
        doc.text('Descripción', col1 + 5, tableTop + 8)
           .text('Cant.', col2 + 5, tableTop + 8)
           .text('P.Unit.', col3 + 5, tableTop + 8)
           .text('IVA', col4 + 5, tableTop + 8)
           .text('Total', col5 + 5, tableTop + 8);
    } else {
        // Para remitos (sin precios)
        doc.text('Descripción', col1 + 5, tableTop + 8)
           .text('Cantidad', col2 + 5, tableTop + 8);
    }
    
    // Línea separadora
    doc.moveTo(col1, tableTop + 25)
       .lineTo(562, tableTop + 25)
       .stroke(COLORS.secondary);
    
    let currentY = tableTop + 35;
    doc.font(FONTS.regular).fontSize(9);
    
    // Renderizar items
    items.forEach((item, index) => {
        // Fondo alternado
        if (index % 2 === 0) {
            doc.rect(col1, currentY - 5, 512, 20).fill('#fafafa');
        }
        
        doc.fillColor(COLORS.dark);
        
        // Descripción
        doc.text(
            item.descripcion || item.producto_nombre || item.producto || '', 
            col1 + 5, 
            currentY, 
            { width: 220 }
        );
        
        // Cantidad
        doc.text(parseFloat(item.cantidad).toFixed(2), col2 + 5, currentY);
        
        if (mostrarPrecios) {
            // Precio unitario
            doc.text(formatCurrency(item.precio_unitario), col3 + 5, currentY);
            
            // IVA
            const ivaPercent = parseFloat(item.porcentaje_iva || item.iva_porcentaje || 21);
            doc.text(`${ivaPercent.toFixed(0)}%`, col4 + 5, currentY);
            
            // Total
            const totalLinea = item.total || item.subtotal || 
                             (parseFloat(item.precio_unitario) * parseFloat(item.cantidad));
            doc.text(formatCurrency(totalLinea), col5 + 5, currentY);
        }
        
        currentY += 25;
        
        // Nueva página si es necesario
        if (currentY > 650) {
            doc.addPage();
            currentY = 100;
        }
    });
    
    return currentY + 10;
}

/**
 * Agrega el resumen de totales
 * @param {PDFDocument} doc - Documento PDF
 * @param {number} subtotal - Subtotal
 * @param {number} iva - Total IVA
 * @param {number} total - Total final
 * @param {number} startY - Posición Y inicial
 * @returns {number} Nueva posición Y
 */
function addTotals(doc, subtotal, iva, total, startY) {
    const col1 = 420;
    const col2 = 500;
    
    doc.fontSize(10)
       .font(FONTS.regular)
       .fillColor(COLORS.dark);
    
    // Subtotal
    doc.text('Subtotal:', col1, startY)
       .text(formatCurrency(subtotal), col2, startY, { align: 'right', width: 60 });
    
    // IVA
    doc.text('IVA:', col1, startY + 20)
       .text(formatCurrency(iva), col2, startY + 20, { align: 'right', width: 60 });
    
    // Total (destacado)
    doc.rect(col1 - 10, startY + 40, 152, 30).fill(COLORS.primary);
    
    doc.fontSize(12)
       .font(FONTS.bold)
       .fillColor('white')
       .text('TOTAL:', col1, startY + 50)
       .text(formatCurrency(total), col2, startY + 50, { align: 'right', width: 60 });
    
    doc.fillColor(COLORS.dark);
    
    return startY + 80;
}

// =======================================================================
//                    GENERADORES DE DOCUMENTOS
// =======================================================================

/**
 * Genera un PDF de factura
 * @param {object} datosFactura - Datos de la factura
 * @param {function} callback - Callback(error, buffer)
 */
function generarFacturaPDF(datosFactura, callback) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => callback(null, Buffer.concat(buffers)));
    doc.on('error', (err) => callback(err));
    
    try {
        // Datos de la empresa
        const empresa = {
            razon_social: datosFactura.empresa_nombre || datosFactura.empresa || 'EMPRESA S.A.',
            cuit: datosFactura.empresa_cuit || datosFactura.cuit_empresa || '',
            direccion: datosFactura.empresa_direccion || datosFactura.direccion_empresa || '',
            telefono: datosFactura.empresa_telefono || datosFactura.telefono_empresa || ''
        };
        
        // Encabezado
        const tipoFactura = datosFactura.tipo_factura || datosFactura.tipo_codigo || 'A';
        addHeader(
            doc, 
            empresa, 
            `FACTURA ${tipoFactura}`, 
            datosFactura.numero_completo || '00001-00000001'
        );
        
        // Fecha de emisión
        doc.fontSize(10)
           .font(FONTS.regular)
           .text(`Fecha: ${formatDate(datosFactura.fecha_emision)}`, 50, 140);
        
        if (datosFactura.fecha_vencimiento) {
            doc.text(`Vencimiento: ${formatDate(datosFactura.fecha_vencimiento)}`, 300, 140);
        }
        
        // Información del cliente
        const cliente = {
            razon_social: datosFactura.cliente || 'Consumidor Final',
            cuit_cuil: datosFactura.cuit_cuil || '',
            condicion_iva: datosFactura.condicion_iva_cliente || '',
            direccion: datosFactura.domicilio || datosFactura.direccion || ''
        };
        
        let currentY = addClientInfo(doc, cliente, 170);
        
        // Tabla de items
        currentY = addItemsTable(doc, datosFactura.items || [], currentY + 20, true);
        
        // Totales
        currentY = addTotals(
            doc, 
            datosFactura.subtotal || 0, 
            datosFactura.total_iva || datosFactura.iva || 0, 
            datosFactura.total || 0, 
            currentY + 10
        );
        
        // CAE (si existe)
        if (datosFactura.cae) {
            doc.fontSize(9)
               .font(FONTS.bold)
               .text('CAE:', 50, currentY + 10);
            doc.font(FONTS.regular)
               .text(datosFactura.cae, 100, currentY + 10);
            
            if (datosFactura.vencimiento_cae) {
                doc.text(`Vto. CAE: ${formatDate(datosFactura.vencimiento_cae)}`, 300, currentY + 10);
            }
            currentY += 25;
        }
        
        // Observaciones (si existen)
        if (datosFactura.observaciones) {
            doc.fontSize(9)
               .font(FONTS.bold)
               .fillColor(COLORS.dark)
               .text('Observaciones:', 50, currentY + 10);
            
            doc.font(FONTS.regular)
               .fillColor(COLORS.secondary)
               .text(datosFactura.observaciones, 50, currentY + 25, { width: 500 });
        }
        
        // Pie de página
        addFooter(doc, 1);
        
        doc.end();
        
    } catch (error) {
        callback(error);
    }
}

/**
 * Genera un PDF de nota de crédito/débito
 * @param {object} datosNota - Datos de la nota
 * @param {function} callback - Callback(error, buffer)
 */
function generarNotaPDF(datosNota, callback) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => callback(null, Buffer.concat(buffers)));
    doc.on('error', (err) => callback(err));
    
    try {
        const empresa = {
            razon_social: datosNota.empresa || 'EMPRESA S.A.',
            cuit: datosNota.cuit_empresa || '',
            direccion: datosNota.direccion_empresa || '',
            telefono: datosNota.telefono_empresa || ''
        };
        
        const tipoNota = datosNota.tipo_nota === 'credito' ? 'NOTA DE CRÉDITO' : 'NOTA DE DÉBITO';
        addHeader(doc, empresa, tipoNota, datosNota.numero_completo || '00001-00000001');
        
        doc.fontSize(10)
           .font(FONTS.regular)
           .text(`Fecha: ${formatDate(datosNota.fecha_emision)}`, 50, 140);
        
        if (datosNota.factura_origen) {
            doc.text(`Factura Origen: ${datosNota.factura_origen}`, 50, 155);
        }
        
        const cliente = {
            razon_social: datosNota.cliente || 'Consumidor Final',
            cuit_cuil: datosNota.cuit_cuil || '',
            direccion: datosNota.direccion || ''
        };
        
        let currentY = addClientInfo(doc, cliente, 180);
        
        // Motivo de la nota
        if (datosNota.motivo) {
            doc.fontSize(10)
               .font(FONTS.bold)
               .fillColor(COLORS.dark)
               .text('MOTIVO:', 50, currentY);
            
            doc.font(FONTS.regular)
               .fontSize(9)
               .text(datosNota.motivo, 50, currentY + 15, { width: 500 });
            
            currentY += 50;
        }
        
        currentY = addItemsTable(doc, datosNota.items || [], currentY + 20, true);
        currentY = addTotals(
            doc, 
            datosNota.subtotal || 0, 
            datosNota.iva || 0, 
            datosNota.total || 0, 
            currentY + 10
        );
        
        if (datosNota.observaciones) {
            doc.fontSize(9)
               .fillColor(COLORS.secondary)
               .text('Observaciones:', 50, currentY + 10)
               .text(datosNota.observaciones, 50, currentY + 25, { width: 500 });
        }
        
        addFooter(doc, 1);
        doc.end();
        
    } catch (error) {
        callback(error);
    }
}

/**
 * Genera un PDF de remito
 * @param {object} datosRemito - Datos del remito
 * @param {function} callback - Callback(error, buffer)
 */
function generarRemitoPDF(datosRemito, callback) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => callback(null, Buffer.concat(buffers)));
    doc.on('error', (err) => callback(err));
    
    try {
        const empresa = {
            razon_social: datosRemito.empresa || 'EMPRESA S.A.',
            cuit: datosRemito.cuit_empresa || '',
            direccion: datosRemito.direccion_empresa || '',
            telefono: datosRemito.telefono_empresa || ''
        };
        
        addHeader(doc, empresa, 'REMITO', datosRemito.numero_completo || '00001-00000001');
        
        doc.fontSize(10)
           .font(FONTS.regular)
           .text(`Fecha: ${formatDate(datosRemito.fecha_emision)}`, 50, 140);
        
        if (datosRemito.fecha_entrega) {
            doc.text(`Fecha Entrega: ${formatDate(datosRemito.fecha_entrega)}`, 300, 140);
        }
        
        const cliente = {
            razon_social: datosRemito.cliente || 'Cliente',
            direccion: datosRemito.direccion_entrega || datosRemito.direccion_cliente || ''
        };
        
        let currentY = addClientInfo(doc, cliente, 180);
        
        // Información de transporte
        if (datosRemito.transportista) {
            doc.font(FONTS.bold)
               .text('Transportista:', 50, currentY);
            doc.font(FONTS.regular)
               .text(datosRemito.transportista, 150, currentY);
            currentY += 25;
        }
        
        // Tabla de items (sin precios)
        const tableTop = currentY + 20;
        const col1 = 50;
        const col2 = 400;
        
        doc.rect(col1, tableTop, 512, 25).fill(COLORS.light);
        
        doc.fontSize(9)
           .font(FONTS.bold)
           .fillColor(COLORS.dark)
           .text('Descripción', col1 + 5, tableTop + 8)
           .text('Cantidad', col2 + 5, tableTop + 8);
        
        doc.moveTo(col1, tableTop + 25)
           .lineTo(562, tableTop + 25)
           .stroke(COLORS.secondary);
        
        let itemY = tableTop + 35;
        doc.font(FONTS.regular).fontSize(9);
        
        (datosRemito.items || []).forEach((item, index) => {
            if (index % 2 === 0) {
                doc.rect(col1, itemY - 5, 512, 20).fill('#fafafa');
            }
            
            doc.fillColor(COLORS.dark)
               .text(item.descripcion || item.producto || '', col1 + 5, itemY, { width: 340 })
               .text(parseFloat(item.cantidad).toFixed(2), col2 + 5, itemY);
            
            itemY += 25;
        });
        
        if (datosRemito.observaciones) {
            doc.fontSize(9)
               .fillColor(COLORS.secondary)
               .text('Observaciones:', 50, itemY + 20)
               .text(datosRemito.observaciones, 50, itemY + 35, { width: 500 });
        }
        
        addFooter(doc, 1);
        doc.end();
        
    } catch (error) {
        callback(error);
    }
}

/**
 * Genera un PDF de presupuesto
 * @param {object} datosPresupuesto - Datos del presupuesto
 * @param {function} callback - Callback(error, buffer)
 */
function generarPresupuestoPDF(datosPresupuesto, callback) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];
    
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => callback(null, Buffer.concat(buffers)));
    doc.on('error', (err) => callback(err));
    
    try {
        const empresa = {
            razon_social: datosPresupuesto.empresa || 'EMPRESA S.A.',
            cuit: datosPresupuesto.cuit_empresa || '',
            direccion: datosPresupuesto.direccion_empresa || '',
            telefono: datosPresupuesto.telefono_empresa || ''
        };
        
        addHeader(doc, empresa, 'PRESUPUESTO', datosPresupuesto.numero_completo || '00000001');
        
        doc.fontSize(10)
           .font(FONTS.regular)
           .text(`Fecha: ${formatDate(datosPresupuesto.fecha_emision)}`, 50, 140);
        
        if (datosPresupuesto.fecha_vencimiento) {
            doc.text(`Válido hasta: ${formatDate(datosPresupuesto.fecha_vencimiento)}`, 300, 140);
        }
        
        const cliente = {
            razon_social: datosPresupuesto.cliente || 'Cliente',
            cuit_cuil: datosPresupuesto.cuit_cuil || '',
            direccion: datosPresupuesto.direccion || ''
        };
        
        let currentY = addClientInfo(doc, cliente, 180);
        
        currentY = addItemsTable(doc, datosPresupuesto.items || [], currentY + 20, true);
        currentY = addTotals(
            doc, 
            datosPresupuesto.subtotal || 0, 
            datosPresupuesto.iva || 0, 
            datosPresupuesto.total || 0, 
            currentY + 10
        );
        
        // Condiciones de pago
        if (datosPresupuesto.condiciones_pago) {
            doc.fontSize(9)
               .font(FONTS.bold)
               .fillColor(COLORS.dark)
               .text('Condiciones de Pago:', 50, currentY + 10);
            
            doc.font(FONTS.regular)
               .fillColor(COLORS.secondary)
               .text(datosPresupuesto.condiciones_pago, 50, currentY + 25, { width: 500 });
        }
        
        addFooter(doc, 1);
        doc.end();
        
    } catch (error) {
        callback(error);
    }
}

// =======================================================================
//                    EXPORTACIONES
// =======================================================================

module.exports = {
    generarFacturaPDF,
    generarNotaPDF,
    generarRemitoPDF,
    generarPresupuestoPDF,
    // Exportar también las funciones utilitarias por si se necesitan
    formatCurrency,
    formatDate,
    formatCUIT
};
