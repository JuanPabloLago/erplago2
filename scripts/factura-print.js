/**
 * FACTURA-PRINT.JS — Módulo compartido de impresión AFIP
 * ════════════════════════════════════════════════════════
 * Usado por: facturas.html, ver-factura.html
 * 
 * Genera HTML AFIP-compliant con:
 *   - Formato RG 4291/2018 (encabezado, letra, código)
 *   - QR local via QRCode.toDataURL (sin dependencia externa)
 *   - Condición IVA empresa dinámica desde BD
 *   - Discriminación IVA condicional (A discrimina, B incluye)
 * 
 * API: FacturaPrint.imprimir(idFactura)
 *      FacturaPrint.imprimirLote([ids])
 */

const FacturaPrint = (function() {
    'use strict';

    function _apiUrl() { return window.CONFIG?.API_BASE_URL || '/api'; }
    function _token() { return localStorage.getItem(window.CONFIG?.TOKEN_KEY || 'authToken'); }
    function _fm(v) { return parseFloat(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function _fd(v) {
        if (!v) return '-';
        const d = new Date(v);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    /**
     * Genera QR como data URI (local, sin servicio externo)
     */
    async function _generarQR(url) {
        if (typeof QRCode === 'undefined') return '';
        try {
            return await QRCode.toDataURL(url, { width: 120, margin: 1 });
        } catch (e) {
            console.error('Error generando QR:', e);
            return '';
        }
    }

    /**
     * Genera HTML completo de factura AFIP-compliant
     */
    function _generarHTML(f, letra, qrDataUri) {
        const esA = letra === 'A';
        const itemsHTML = (f.items || []).map(i => `
            <tr>
                <td style="border:1px solid #ccc;padding:4px;">${i.descripcion || i.producto_nombre || ''}</td>
                <td style="border:1px solid #ccc;padding:4px;text-align:center;">${i.cantidad}</td>
                <td style="border:1px solid #ccc;padding:4px;text-align:right;">$${_fm(i.precio_unitario)}</td>
                ${esA ? `
                    <td style="border:1px solid #ccc;padding:4px;text-align:center;">${i.porcentaje_iva}%</td>
                    <td style="border:1px solid #ccc;padding:4px;text-align:right;">$${_fm(i.subtotal)}</td>
                    <td style="border:1px solid #ccc;padding:4px;text-align:right;">$${_fm(i.iva_calculado)}</td>
                ` : ''}
                <td style="border:1px solid #ccc;padding:4px;text-align:right;">$${_fm(i.total)}</td>
            </tr>
        `).join('');

        const condicionIvaEmpresa = f.empresa_condicion_iva || 'Responsable Inscripto';

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Factura ${letra} ${f.numero_completo}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #333; margin: 0; padding: 15px; }
        .header { display: flex; justify-content: space-between; border: 2px solid #000; margin-bottom: 10px; }
        .header-left, .header-right { width: 45%; padding: 10px; }
        .header-center { width: 10%; text-align: center; position: relative; }
        .letra-tipo {
            background: #fff; border: 2px solid #000; font-size: 28px; font-weight: bold;
            width: 45px; height: 45px; line-height: 45px; text-align: center;
            margin: 0 auto; position: relative; top: -15px;
        }
        .letra-codigo { font-size: 9px; text-align: center; margin-top: -10px; }
        .empresa-nombre { font-size: 16px; font-weight: bold; margin-bottom: 5px; }
        .factura-numero { font-size: 14px; font-weight: bold; }
        .factura-tipo { font-size: 12px; }
        .seccion { border: 1px solid #ccc; padding: 8px; margin-bottom: 8px; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th { background: #f0f0f0; border: 1px solid #ccc; padding: 5px; font-size: 10px; text-align: center; }
        .totales { text-align: right; margin-top: 10px; }
        .total-final { font-size: 18px; font-weight: bold; border-top: 2px solid #000; padding-top: 5px; }
        .footer-cae { border-top: 2px solid #000; padding-top: 8px; margin-top: 15px; display: flex; justify-content: space-between; }
        .qr-container { text-align: center; }
        .qr-container img { width: 120px; height: 120px; }
        .no-print { display: none; }
        @media print { .no-print { display: none; } }
    </style>
</head>
<body>
    <!-- ENCABEZADO -->
    <div class="header">
        <div class="header-left">
            <div class="empresa-nombre">${f.empresa_nombre || 'LAGO'}</div>
            <div>CUIT: ${f.empresa_cuit || '-'}</div>
            <div>${f.empresa_direccion || ''}</div>
            <div>Condición frente al IVA: ${condicionIvaEmpresa}</div>
            ${f.empresa_inicio_actividades ? `<div>Inicio Act.: ${_fd(f.empresa_inicio_actividades)}</div>` : ''}
        </div>
        <div class="header-center">
            <div class="letra-tipo">${letra}</div>
            <div class="letra-codigo">Cód. ${esA ? '01' : '06'}</div>
        </div>
        <div class="header-right" style="text-align:right;">
            <div class="factura-tipo">FACTURA</div>
            <div class="factura-numero">${f.numero_completo}</div>
            <div>Fecha: ${_fd(f.fecha_emision)}</div>
            <div>${f.forma_pago_tipo === 'cuenta_corriente' ? 'Vto Pago: ' + _fd(f.fecha_vencimiento) : 'Condición de Venta: Contado'}</div>
        </div>
    </div>

    <!-- DATOS CLIENTE -->
    <div class="seccion">
        <div><strong>Señor(es):</strong> ${f.cliente || '-'}</div>
        <div><strong>CUIT:</strong> ${f.cuit_cuil || '-'} &nbsp;&nbsp; <strong>Cond. IVA:</strong> ${f.condicion_iva_cliente || '-'}</div>
        <div><strong>Domicilio:</strong> ${f.domicilio || '-'}</div>
    </div>

    <!-- ITEMS -->
    <table>
        <thead>
            <tr>
                <th style="text-align:left;">Descripción</th>
                <th>Cant.</th>
                <th>Precio Unit.</th>
                ${esA ? '<th>IVA %</th><th>Subtotal</th><th>IVA</th>' : ''}
                <th>Importe</th>
            </tr>
        </thead>
        <tbody>
            ${itemsHTML}
        </tbody>
    </table>

    <!-- TOTALES -->
    <div class="totales">
        ${esA ? `
            <div>Subtotal: $${_fm(f.subtotal)}</div>
            <div>IVA 21%: $${_fm(f.total_iva)}</div>
        ` : `
            <div style="font-size:9px;color:#666;">* IVA incluido en los importes</div>
        `}
        <div class="total-final">TOTAL: $${_fm(f.total)}</div>
    </div>

    <!-- CAE + QR -->
    <div class="footer-cae">
        <div>
            <div><strong>CAE:</strong> ${f.cae || '-'}</div>
            <div><strong>Vto CAE:</strong> ${_fd(f.cae_vencimiento)}</div>
        </div>
        <div class="qr-container">
            ${qrDataUri
                ? '<img src="' + qrDataUri + '" alt="QR AFIP">'
                : '<div style="width:120px;height:120px;border:1px solid #ccc;text-align:center;font-size:8px;color:#999;padding-top:50px;">QR no disponible</div>'
            }
            <div style="font-size:8px;">Comprobante autorizado por AFIP</div>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Imprime una factura por ID — obtiene datos, genera QR, abre ventana
     */
    async function imprimir(idFactura) {
        try {
            const response = await fetch(`${_apiUrl()}/facturas/${idFactura}`, {
                headers: { 'Authorization': `Bearer ${_token()}` }
            });
            if (!response.ok) throw new Error('Factura no encontrada');
            const factura = await response.json();

            const esFacturaA = factura.id_tipo_factura === 1
                || (factura.tipo_factura || '').toUpperCase().includes('A');
            const letraTipo = esFacturaA ? 'A' : 'B';

            // QR AFIP (RG 4291/2018)
            const qrData = JSON.stringify({
                ver: 1,
                fecha: factura.fecha_emision?.split('T')[0] || '',
                cuit: (factura.empresa_cuit || '').replace(/[-\s]/g, ''),
                ptoVta: factura.punto_venta,
                tipoCmp: esFacturaA ? 1 : 6,
                nroCmp: factura.numero_factura,
                importe: parseFloat(factura.total),
                moneda: 'PES',
                ctz: 1,
                tipoDocRec: factura.cuit_cuil?.length >= 11 ? 80 : 96,
                nroDocRec: parseInt((factura.cuit_cuil || '0').replace(/[^0-9]/g, '')),
                tipoCodAut: 'E',
                codAut: parseInt(factura.cae || '0')
            });
            const qrBase64 = btoa(qrData);
            const qrAfipUrl = `https://www.afip.gob.ar/fe/qr/?p=${qrBase64}`;

            // Generar QR localmente
            const qrDataUri = await _generarQR(qrAfipUrl);

            // Abrir ventana de impresión
            const printWindow = window.open('', '_blank', 'width=800,height=1100');
            printWindow.document.write(_generarHTML(factura, letraTipo, qrDataUri));
            printWindow.document.close();
            printWindow.onload = function() {
                printWindow.print();
            };

        } catch (error) {
            alert('Error al imprimir factura: ' + error.message);
        }
    }

    /**
     * Imprime múltiples facturas secuencialmente
     */
    async function imprimirLote(ids) {
        for (const id of ids) {
            await imprimir(id);
            await new Promise(r => setTimeout(r, 500));
        }
    }

    return { imprimir, imprimirLote };
})();

// Global para onclick directo
window.FacturaPrint = FacturaPrint;
