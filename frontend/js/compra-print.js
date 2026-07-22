/**
 * COMPRA-PRINT.JS — Modulo de impresion de compras
 * Replica el patron de factura-print.js (IIFE + window.open + window.print)
 *
 * API publica:
 *   ComprasPrint.imprimirInterno(idComprobante)
 *   ComprasPrint.imprimirCopia(idComprobante)
 *   ComprasPrint.imprimirOrdenPago(idPago)
 *   ComprasPrint.imprimirListado(filtros, rows)
 */

const ComprasPrint = (function() {
    'use strict';

    function _apiUrl() { return window.CONFIG?.API_BASE_URL || '/api'; }
    function _token() { return localStorage.getItem(window.CONFIG?.TOKEN_KEY || 'authToken'); }
    function _fm(v) { return parseFloat(v || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function _fd(v) {
        if (!v) return '-';
        const d = new Date(v);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    function _fdt(v) {
        if (!v) return '-';
        const d = new Date(v);
        return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
               d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }

    async function _log(tipo, id, numero) {
        try {
            await fetch(_apiUrl() + '/compras/print/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token() },
                body: JSON.stringify({ tipo_documento: tipo, id_documento: id, numero_documento: numero || null })
            });
        } catch (e) { /* no bloquear impresion */ }
    }

    async function _fetchComprobante(id) {
        const r = await fetch(_apiUrl() + '/compras/' + id, { headers: { 'Authorization': 'Bearer ' + _token() } });
        if (!r.ok) throw new Error('Comprobante no encontrado');
        const j = await r.json();
        return j.data || j;
    }

    async function _fetchOrdenPago(id) {
        const r = await fetch(_apiUrl() + '/compras/print/orden-pago/' + id, { headers: { 'Authorization': 'Bearer ' + _token() } });
        if (!r.ok) throw new Error('Pago no encontrado');
        const j = await r.json();
        return j.data || j;
    }

    async function _fetchConfig() {
        try {
            const r = await fetch(_apiUrl() + '/configuraciones/todas', { headers: { 'Authorization': 'Bearer ' + _token() } });
            if (!r.ok) return {};
            const rows = await r.json();
            const cfg = {};
            rows.forEach(function(x) { if (x.clave.indexOf('compras.print.') === 0) cfg[x.clave.replace('compras.print.', '')] = x.valor; });
            return cfg;
        } catch (e) { return {}; }
    }

    // ═══════════════════════════════════════════════════════════
    // ESTILO COMPARTIDO (compacto, tomado de factura-print.js)
    // ═══════════════════════════════════════════════════════════
    const CSS_COMUN = `
        @page { size: A4; margin: 12mm; }
        body { font-family: Arial, sans-serif; font-size: 11px; color: #333; margin: 0; padding: 10px; }
        .header { display: flex; justify-content: space-between; border: 2px solid #000; margin-bottom: 8px; }
        .header-left, .header-right { width: 48%; padding: 8px; }
        .header-right { text-align: right; }
        .empresa-nombre { font-size: 15px; font-weight: bold; margin-bottom: 3px; }
        .doc-numero { font-size: 13px; font-weight: bold; }
        .doc-tipo { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
        .seccion { border: 1px solid #ccc; padding: 6px 8px; margin-bottom: 6px; font-size: 10.5px; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        th { background: #f0f0f0; border: 1px solid #ccc; padding: 4px; font-size: 10px; text-align: center; }
        td { border: 1px solid #ccc; padding: 3px 4px; font-size: 10.5px; }
        .totales { text-align: right; margin-top: 8px; font-size: 11px; }
        .total-final { font-size: 16px; font-weight: bold; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
        .pie { margin-top: 12px; padding-top: 8px; border-top: 1px solid #aaa; font-size: 9px; color: #666; text-align: center; }
        .badge { display: inline-block; background: #000; color: #fff; padding: 1px 6px; font-size: 9px; font-weight: bold; }
        .two-col { display: flex; gap: 10px; }
        .two-col > div { flex: 1; }
        @media print { .no-print { display: none; } }
    `;

    function _abrirVentana(html) {
        const w = window.open('', '_blank', 'width=800,height=1100');
        w.document.write(html);
        w.document.close();
        w.onload = function() { setTimeout(function() { w.print(); }, 300); };
    }

    // ═══════════════════════════════════════════════════════════
    // 1) COMPROBANTE INTERNO (recibo de carga en sistema)
    // ═══════════════════════════════════════════════════════════
    async function imprimirInterno(idComprobante) {
        try {
            const cfg = await _fetchConfig();
            const c = await _fetchComprobante(idComprobante);
            const items = c.items || [];

            const itemsHTML = items.map(function(i) {
                return '<tr>' +
                    '<td>' + (i.producto_sku || '-') + '</td>' +
                    '<td>' + (i.descripcion || i.producto_nombre || '') + '</td>' +
                    '<td style="text-align:center">' + i.cantidad + '</td>' +
                    '<td style="text-align:right">$' + _fm(i.precio_unitario) + '</td>' +
                    '<td style="text-align:right">' + _fm(i.descuento_porcentaje || 0) + '%</td>' +
                    '<td style="text-align:right">$' + _fm(i.subtotal) + '</td>' +
                    '<td style="text-align:right">$' + _fm(i.iva_monto || 0) + '</td>' +
                    '<td style="text-align:right"><strong>$' + _fm(i.total) + '</strong></td>' +
                '</tr>';
            }).join('');

            const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
                '<title>Compra ' + (c.numero_completo || idComprobante) + '</title>' +
                '<style>' + CSS_COMUN + '</style></head><body>' +
                '<div class="header">' +
                    '<div class="header-left">' +
                        '<div class="empresa-nombre">' + (c.empresa_nombre || 'LAGO') + '</div>' +
                        '<div>CUIT: ' + (c.empresa_cuit || '-') + '</div>' +
                        '<div>' + (c.empresa_direccion || '') + '</div>' +
                    '</div>' +
                    '<div class="header-right">' +
                        '<div class="doc-tipo">Comprobante interno de compra</div>' +
                        '<div class="doc-numero">' + (c.numero_completo || '-') + '</div>' +
                        '<div>Fecha emisión: ' + _fd(c.fecha_emision) + '</div>' +
                        '<div>Fecha carga: ' + _fdt(c.fecha_recepcion) + '</div>' +
                        '<div><span class="badge">' + (c.tipo_codigo || '-') + '</span> ' + (c.tipo_nombre || '') + '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="seccion"><div class="two-col">' +
                    '<div><strong>Proveedor:</strong> ' + (c.proveedor_razon_social || '-') + '<br>' +
                         '<strong>CUIT:</strong> ' + (c.proveedor_cuit || '-') + ' &nbsp; <strong>Cond. IVA:</strong> ' + (c.proveedor_condicion_iva || '-') + '<br>' +
                         '<strong>Domicilio:</strong> ' + (c.proveedor_domicilio || '-') + '</div>' +
                    '<div style="text-align:right"><strong>Cargado por:</strong> ' + (c.usuario_nombre || '-') + '<br>' +
                         (c.fecha_vencimiento ? '<strong>Vto pago:</strong> ' + _fd(c.fecha_vencimiento) : '') + '</div>' +
                '</div></div>' +
                '<table>' +
                    '<thead><tr>' +
                        '<th>SKU</th><th style="text-align:left">Descripción</th>' +
                        '<th>Cant.</th><th>P. Unit.</th><th>Dto%</th>' +
                        '<th>Subtotal</th><th>IVA</th><th>Total</th>' +
                    '</tr></thead>' +
                    '<tbody>' + itemsHTML + '</tbody>' +
                '</table>' +
                '<div class="totales">' +
                    '<div>Subtotal neto: $' + _fm(c.subtotal) + '</div>' +
                    (parseFloat(c.iva_21) > 0 ? '<div>IVA 21%: $' + _fm(c.iva_21) + '</div>' : '') +
                    (parseFloat(c.iva_105) > 0 ? '<div>IVA 10.5%: $' + _fm(c.iva_105) + '</div>' : '') +
                    (parseFloat(c.iva_27) > 0 ? '<div>IVA 27%: $' + _fm(c.iva_27) + '</div>' : '') +
                    (parseFloat(c.percepcion_iva) > 0 ? '<div>Perc. IVA: $' + _fm(c.percepcion_iva) + '</div>' : '') +
                    (parseFloat(c.percepcion_iibb) > 0 ? '<div>Perc. IIBB: $' + _fm(c.percepcion_iibb) + '</div>' : '') +
                    (parseFloat(c.impuestos_internos) > 0 ? '<div>Imp. Internos: $' + _fm(c.impuestos_internos) + '</div>' : '') +
                    '<div class="total-final">TOTAL: $' + _fm(c.total) + '</div>' +
                '</div>' +
                (c.observaciones ? '<div class="seccion" style="margin-top:10px"><strong>Observaciones:</strong> ' + c.observaciones + '</div>' : '') +
                '<div class="pie">' + (cfg.pie_pagina || '') + ' — Impreso: ' + _fdt(new Date()) + '</div>' +
                '</body></html>';

            _abrirVentana(html);
            _log('compra_interno', idComprobante, c.numero_completo);
        } catch (e) { alert('Error: ' + e.message); }
    }

    // ═══════════════════════════════════════════════════════════
    // 2) COPIA DE COMPROBANTE DEL PROVEEDOR (estilo AFIP)
    // ═══════════════════════════════════════════════════════════
    async function imprimirCopia(idComprobante) {
        try {
            const cfg = await _fetchConfig();
            const c = await _fetchComprobante(idComprobante);
            const items = c.items || [];

            // Detectar letra: el tipo_codigo tiene FA/FB/FC o similar
            let letra = '-';
            const cod = (c.tipo_codigo || '').toUpperCase();
            if (cod.indexOf('A') !== -1) letra = 'A';
            else if (cod.indexOf('B') !== -1) letra = 'B';
            else if (cod.indexOf('C') !== -1) letra = 'C';
            const esA = letra === 'A';

            const itemsHTML = items.map(function(i) {
                return '<tr>' +
                    '<td>' + (i.descripcion || i.producto_nombre || '') + '</td>' +
                    '<td style="text-align:center">' + i.cantidad + '</td>' +
                    '<td style="text-align:right">$' + _fm(i.precio_unitario) + '</td>' +
                    (esA ? '<td style="text-align:center">' + _fm(i.iva_porcentaje || 0) + '%</td>' +
                           '<td style="text-align:right">$' + _fm(i.subtotal) + '</td>' +
                           '<td style="text-align:right">$' + _fm(i.iva_monto || 0) + '</td>' : '') +
                    '<td style="text-align:right">$' + _fm(i.total) + '</td>' +
                '</tr>';
            }).join('');

            const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
                '<title>Copia ' + (c.numero_completo || '') + '</title>' +
                '<style>' + CSS_COMUN +
                '.letra { background: #fff; border: 2px solid #000; font-size: 26px; font-weight: bold; width: 42px; height: 42px; line-height: 42px; text-align: center; margin: 0 auto; }' +
                '.marca-copia { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 80px; color: rgba(200,0,0,0.1); font-weight: bold; pointer-events: none; }' +
                '</style></head><body>' +
                '<div class="marca-copia">COPIA</div>' +
                '<div class="header">' +
                    '<div class="header-left">' +
                        '<div class="empresa-nombre">' + (c.proveedor_razon_social || '-') + '</div>' +
                        '<div>CUIT: ' + (c.proveedor_cuit || '-') + '</div>' +
                        '<div>' + (c.proveedor_domicilio || '') + '</div>' +
                        '<div>Cond. IVA: ' + (c.proveedor_condicion_iva || '-') + '</div>' +
                    '</div>' +
                    '<div style="width:10%;text-align:center;padding-top:8px;">' +
                        '<div class="letra">' + letra + '</div>' +
                        '<div style="font-size:8px;margin-top:4px">' + (c.tipo_codigo || '') + '</div>' +
                    '</div>' +
                    '<div class="header-right" style="width:42%">' +
                        '<div class="doc-tipo">' + (c.tipo_nombre || 'COMPROBANTE') + '</div>' +
                        '<div class="doc-numero">' + (c.numero_completo || '-') + '</div>' +
                        '<div>Fecha: ' + _fd(c.fecha_emision) + '</div>' +
                        (c.cae ? '<div>CAE: ' + c.cae + '</div>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="seccion">' +
                    '<strong>Cliente:</strong> ' + (c.empresa_nombre || 'LAGO') +
                    ' &nbsp; <strong>CUIT:</strong> ' + (c.empresa_cuit || '-') +
                '</div>' +
                '<table>' +
                    '<thead><tr>' +
                        '<th style="text-align:left">Descripción</th>' +
                        '<th>Cant.</th><th>P. Unit.</th>' +
                        (esA ? '<th>IVA%</th><th>Subt.</th><th>IVA</th>' : '') +
                        '<th>Importe</th>' +
                    '</tr></thead>' +
                    '<tbody>' + itemsHTML + '</tbody>' +
                '</table>' +
                '<div class="totales">' +
                    (esA ? '<div>Subtotal: $' + _fm(c.subtotal) + '</div>' +
                           (parseFloat(c.iva_21) > 0 ? '<div>IVA 21%: $' + _fm(c.iva_21) + '</div>' : '') +
                           (parseFloat(c.iva_105) > 0 ? '<div>IVA 10.5%: $' + _fm(c.iva_105) + '</div>' : '') +
                           (parseFloat(c.iva_27) > 0 ? '<div>IVA 27%: $' + _fm(c.iva_27) + '</div>' : '') : '') +
                    (parseFloat(c.percepcion_iva) > 0 ? '<div>Perc. IVA: $' + _fm(c.percepcion_iva) + '</div>' : '') +
                    (parseFloat(c.percepcion_iibb) > 0 ? '<div>Perc. IIBB: $' + _fm(c.percepcion_iibb) + '</div>' : '') +
                    '<div class="total-final">TOTAL: $' + _fm(c.total) + '</div>' +
                '</div>' +
                '<div class="pie">Reconstrucción del comprobante recibido — solo uso interno. ' + (cfg.pie_pagina || '') + '</div>' +
                '</body></html>';

            _abrirVentana(html);
            _log('compra_copia', idComprobante, c.numero_completo);
        } catch (e) { alert('Error: ' + e.message); }
    }

    // ═══════════════════════════════════════════════════════════
    // 3) ORDEN DE PAGO A PROVEEDOR
    // ═══════════════════════════════════════════════════════════
    async function imprimirOrdenPago(idPago) {
        try {
            const cfg = await _fetchConfig();
            const p = await _fetchOrdenPago(idPago);
            const items = p.items || [];
            const imputs = p.imputaciones || [];

            const itemsHTML = items.map(function(i) {
                let detalle = i.forma_pago_nombre || '-';
                if (i.numero_cheque) detalle += ' N° ' + i.numero_cheque + (i.fecha_vencimiento_cheque ? ' (vto ' + _fd(i.fecha_vencimiento_cheque) + ')' : '');
                if (i.banco_nombre) detalle += ' - ' + i.banco_nombre;
                if (i.numero_referencia) detalle += ' Ref: ' + i.numero_referencia;
                return '<tr><td>' + detalle + '</td><td style="text-align:right">$' + _fm(i.monto) + '</td></tr>';
            }).join('');

            const impsHTML = imputs.map(function(im) {
                return '<tr>' +
                    '<td>' + (im.numero_completo || ('CxP ' + im.id_imputacion)) + '</td>' +
                    '<td>' + _fd(im.fecha_emision) + '</td>' +
                    '<td style="text-align:right">$' + _fm(im.total_comprobante) + '</td>' +
                    '<td style="text-align:right"><strong>$' + _fm(im.monto_imputado) + '</strong></td>' +
                '</tr>';
            }).join('');

            const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
                '<title>Orden de pago ' + (p.numero_pago || idPago) + '</title>' +
                '<style>' + CSS_COMUN + '</style></head><body>' +
                '<div class="header">' +
                    '<div class="header-left">' +
                        '<div class="empresa-nombre">' + (p.empresa_nombre || 'LAGO') + '</div>' +
                        '<div>CUIT: ' + (p.empresa_cuit || '-') + '</div>' +
                        '<div>' + (p.empresa_direccion || '') + '</div>' +
                    '</div>' +
                    '<div class="header-right">' +
                        '<div class="doc-tipo">Orden de pago</div>' +
                        '<div class="doc-numero">N° ' + (p.numero_pago || idPago) + '</div>' +
                        '<div>Fecha: ' + _fd(p.fecha_pago) + '</div>' +
                        (p.es_pago_a_cuenta ? '<div><span class="badge">A CUENTA</span></div>' : '') +
                    '</div>' +
                '</div>' +
                '<div class="seccion">' +
                    '<strong>Proveedor:</strong> ' + (p.proveedor_razon_social || '-') +
                    ' &nbsp; <strong>CUIT:</strong> ' + (p.proveedor_cuit || '-') +
                    '<br><strong>Domicilio:</strong> ' + (p.proveedor_domicilio || '-') +
                '</div>' +
                '<h4 style="font-size:11px;margin:8px 0 4px">Formas de pago</h4>' +
                '<table><thead><tr><th style="text-align:left">Detalle</th><th>Monto</th></tr></thead>' +
                    '<tbody>' + itemsHTML + '</tbody></table>' +
                (imputs.length > 0 ? '<h4 style="font-size:11px;margin:8px 0 4px">Comprobantes imputados</h4>' +
                    '<table><thead><tr><th style="text-align:left">Comprobante</th><th>Fecha</th><th>Total</th><th>Imputado</th></tr></thead>' +
                    '<tbody>' + impsHTML + '</tbody></table>' : '') +
                '<div class="totales">' +
                    '<div class="total-final">TOTAL PAGADO: $' + _fm(p.monto) + '</div>' +
                '</div>' +
                (p.observaciones ? '<div class="seccion" style="margin-top:10px"><strong>Observaciones:</strong> ' + p.observaciones + '</div>' : '') +
                '<div style="margin-top:40px">' +
                    '<div class="two-col">' +
                        '<div style="text-align:center;border-top:1px solid #000;padding-top:4px;width:40%;margin-left:5%">Firma emisor</div>' +
                        '<div style="text-align:center;border-top:1px solid #000;padding-top:4px;width:40%;margin-right:5%">Firma receptor</div>' +
                    '</div>' +
                '</div>' +
                '<div class="pie">' + (cfg.pie_pagina || '') + ' — Impreso: ' + _fdt(new Date()) + '</div>' +
                '</body></html>';

            _abrirVentana(html);
            _log('orden_pago', idPago, p.numero_pago ? 'OP-' + p.numero_pago : null);
        } catch (e) { alert('Error: ' + e.message); }
    }

    // ═══════════════════════════════════════════════════════════
    // 4) LISTADO DE COMPRAS (toma los rows ya cargados en pantalla)
    // ═══════════════════════════════════════════════════════════
    async function imprimirListado(filtros, rows) {
        try {
            const cfg = await _fetchConfig();
            filtros = filtros || {};
            rows = rows || [];

            let total = 0;
            const rowsHTML = rows.map(function(r) {
                total += parseFloat(r.total || 0);
                return '<tr>' +
                    '<td>' + (r.numero_completo || r.id_comprobante) + '</td>' +
                    '<td>' + _fd(r.fecha_emision) + '</td>' +
                    '<td>' + (r.proveedor_razon_social || r.proveedor || '-') + '</td>' +
                    '<td>' + (r.tipo_nombre || r.tipo || '-') + '</td>' +
                    '<td style="text-align:right">$' + _fm(r.total) + '</td>' +
                    '<td>' + (r.estado || '-') + '</td>' +
                '</tr>';
            }).join('');

            const filtrosTexto = [];
            if (filtros.desde) filtrosTexto.push('desde ' + filtros.desde);
            if (filtros.hasta) filtrosTexto.push('hasta ' + filtros.hasta);
            if (filtros.q) filtrosTexto.push('búsqueda: ' + filtros.q);
            if (filtros.estado) filtrosTexto.push('estado: ' + filtros.estado);

            const html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
                '<title>Listado de compras</title>' +
                '<style>' + CSS_COMUN + '</style></head><body>' +
                '<div class="header">' +
                    '<div class="header-left">' +
                        '<div class="empresa-nombre">LISTADO DE COMPRAS</div>' +
                        '<div>' + (filtrosTexto.join(' · ') || 'Todos los registros') + '</div>' +
                    '</div>' +
                    '<div class="header-right">' +
                        '<div>Registros: <strong>' + rows.length + '</strong></div>' +
                        '<div>Impreso: ' + _fdt(new Date()) + '</div>' +
                    '</div>' +
                '</div>' +
                '<table>' +
                    '<thead><tr>' +
                        '<th style="text-align:left">Comprobante</th><th>Fecha</th>' +
                        '<th style="text-align:left">Proveedor</th><th>Tipo</th>' +
                        '<th>Total</th><th>Estado</th>' +
                    '</tr></thead>' +
                    '<tbody>' + rowsHTML + '</tbody>' +
                    '<tfoot><tr><td colspan="4" style="text-align:right"><strong>TOTAL</strong></td>' +
                        '<td style="text-align:right"><strong>$' + _fm(total) + '</strong></td><td></td></tr></tfoot>' +
                '</table>' +
                '<div class="pie">' + (cfg.pie_pagina || '') + '</div>' +
                '</body></html>';

            _abrirVentana(html);
            _log('listado_compras', 0, 'Listado ' + new Date().toISOString().slice(0, 10));
        } catch (e) { alert('Error: ' + e.message); }
    }

    return { imprimirInterno, imprimirCopia, imprimirOrdenPago, imprimirListado };
})();

window.ComprasPrint = ComprasPrint;
