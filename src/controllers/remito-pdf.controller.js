/**
 * remito-pdf.controller.js
 * Controller de impresion de remitos (HTML + window.print cliente).
 *
 * NOTA: el nombre conserva "pdf" por compatibilidad con los require de
 * despachos.controller.js. No genera PDFs — el patron vigente del ERP
 * es renderizar HTML server-side y que el browser cliente imprima.
 *
 * Historico: v7 (2026-04-17) elimina Puppeteer + generarPDF + generarPDFViaje.
 * Las rutas /remito/:id/pdf y /viaje/:id/pdf fueron removidas en esta fase.
 */
const pool = require('../config/database');
const path = require('path');
const fs = require('fs');
const Handlebars = require('handlebars');
const despachosHelper = require('../utils/despachos.helper');

// Helpers Handlebars
Handlebars.registerHelper('formatNumber', (num) => {
    return parseFloat(num || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});
Handlebars.registerHelper('formatDate', (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
});
Handlebars.registerHelper('gt', (a, b) => parseFloat(a || 0) > parseFloat(b || 0));

function formatMoney(num) {
    return '$ ' + parseFloat(num || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function renderRemito(id_remito, id_empresa, reqContext = {}) {
    const remitoResult = await pool.query(`
        SELECT
            r.id_remito, r.numero_completo, r.numero_remito, r.punto_venta,
            r.fecha_emision, r.fecha_entrega, r.direccion_entrega,
            r.transportista, r.chofer, r.patente,
            r.observaciones as observaciones_remito,
            r.subtotal, r.iva, r.total, r.veces_impreso, r.id_pedido,
            p.observaciones as observaciones_pedido,
            p.domicilio_entrega as domicilio_entrega_pedido,
            c.id_cliente, c.razon_social as cliente_razon_social,
            c.cuit_cuil as cliente_cuit, c.domicilio as cliente_domicilio,
            c.telefono as cliente_telefono, c.email as cliente_email,
            civa.nombre as cliente_condicion_iva,
            e.razon_social as empresa_razon_social,
            e.nombre_fantasia as empresa_nombre_fantasia,
            e.cuit as empresa_cuit, e.domicilio_fiscal as empresa_domicilio,
            e.telefono as empresa_telefono, e.email as empresa_email,
            eiva.nombre as empresa_condicion_iva,
            COALESCE(tc.nombre, 'Remito X') as tipo_comprobante_nombre,
            COALESCE(tc.codigo_afip, '91') as tipo_comprobante_codigo,
            r.observaciones_editado_en,
            ued.username as obs_editado_por_username
        FROM remitos r
        LEFT JOIN pedidos p ON r.id_pedido = p.id_pedido
        LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
        LEFT JOIN condicionesiva civa ON c.id_condicion_iva = civa.id_condicion_iva
        JOIN empresas e ON r.id_empresa = e.id_empresa
        LEFT JOIN condicionesiva eiva ON e.id_condicion_iva = eiva.id_condicion_iva
        LEFT JOIN tiposdecomprobante tc ON r.id_tipo_comprobante = tc.id_tipo_comprobante
        LEFT JOIN usuarios ued ON r.observaciones_editado_por = ued.id_usuario
        WHERE r.id_remito = $1 AND r.id_empresa = $2
    `, [id_remito, id_empresa]);
    if (remitoResult.rows.length === 0) return null;

    const itemsResult = await pool.query(`
        SELECT ri.id_item, ri.descripcion, ri.cantidad, ri.precio_unitario,
            ri.iva_porcentaje, ri.subtotal, ri.total,
            COALESCE(pr.sku, '') as codigo,
            COALESCE(pr.unidad_medida, 'UN') as unidad_medida
        FROM remito_items ri
        LEFT JOIN productos pr ON ri.id_producto = pr.id_producto
        WHERE ri.id_remito = $1 AND ri.anulado = false
        ORDER BY ri.id_item
    `, [id_remito]);

    let saldoInfo = { pedido_total: 0, total_pagado: 0, saldo: 0 };
    const remito = remitoResult.rows[0];
    if (remito.id_pedido) {
        const saldoResult = await pool.query(
            'SELECT pedido_total, total_pagado, saldo FROM v_saldo_pedidos WHERE id_pedido = $1',
            [remito.id_pedido]
        );
        if (saldoResult.rows.length > 0) saldoInfo = saldoResult.rows[0];
    }

    await despachosHelper.registrarImpresion(pool, {
        id_empresa,
        id_remito,
        id_usuario: reqContext.id_usuario || null,
        ip_origen: reqContext.ip_origen || null
    });

    const configPath = path.join(__dirname, '../../config/plantillas/remito.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const items = itemsResult.rows.map(item => {
        const precioUnit = parseFloat(item.precio_unitario) || 0;
        const ivaPct = parseFloat(item.iva_porcentaje) || 21;
        const precioConIva = precioUnit * (1 + ivaPct / 100);
        return {
            ...item,
            cantidad_formateada: parseFloat(item.cantidad || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 }),
            precio_formateado: formatMoney(item.precio_unitario),
            precio_con_iva_formateado: formatMoney(precioConIva),
            total_formateado: formatMoney(item.total)
        };
    });

    const saldo_a_cobrar = Number(saldoInfo.saldo);
    const pedido_total = Number(saldoInfo.pedido_total);
    const fechaEmision = remito.fecha_emision ? new Date(remito.fecha_emision).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    const fechaEntrega = remito.fecha_entrega ? new Date(remito.fecha_entrega).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
    // [F4 2026-05-04] obs separadas en templateData (obsPedido / obsRemito)

    const minFilas = config.minimo_filas_items || 2;
    const filasVacias = [];
    for (let i = items.length; i < minFilas; i++) filasVacias.push({});

    const tipoNombre = (remito.tipo_comprobante_nombre || '').toUpperCase();
    let letraComprobante = 'X';
    if (tipoNombre.includes(' A')) letraComprobante = 'A';
    else if (tipoNombre.includes(' B')) letraComprobante = 'B';
    else if (tipoNombre.includes(' C')) letraComprobante = 'C';

    const plantillaActiva = config.plantilla_activa || 'normal';
    const plantillas = config.plantillas || { normal: 'remito.template.html', compacto: 'remito.template.compacto.html' };
    const templateFile = plantillas[plantillaActiva] || 'remito.template.html';
    const templatePath = path.join(__dirname, '../../config/plantillas/' + templateFile);
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateContent);

    return template({
        config,
        empresa: {
            razon_social: remito.empresa_razon_social,
            nombre_fantasia: remito.empresa_nombre_fantasia,
            cuit: remito.empresa_cuit, domicilio: remito.empresa_domicilio,
            telefono: remito.empresa_telefono, email: remito.empresa_email,
            condicion_iva: remito.empresa_condicion_iva
        },
        cliente: {
            razon_social: remito.cliente_razon_social, cuit: remito.cliente_cuit,
            domicilio: remito.cliente_domicilio, telefono: remito.cliente_telefono,
            email: remito.cliente_email, condicion_iva: remito.cliente_condicion_iva
        },
        tipo_comprobante: { titulo: remito.tipo_comprobante_nombre || 'REMITO X', letra: letraComprobante, codigo_afip: remito.tipo_comprobante_codigo || '91' },
        remito: {
            ...remito,
            fecha_emision_formateada: fechaEmision, fecha_entrega_formateada: fechaEntrega,
            subtotal_formateado: formatMoney(remito.subtotal), iva_formateado: formatMoney(remito.iva),
            total_formateado: formatMoney(remito.total),
            pedido_total_formateado: formatMoney(pedido_total),
            total_pagado_formateado: formatMoney(saldoInfo.total_pagado),
            saldo_formateado: formatMoney(saldo_a_cobrar),
            saldo_a_cobrar, pedido_total,
            veces_impreso: (remito.veces_impreso || 0) + 1,
            es_duplicado: (remito.veces_impreso || 0) > 0
        },
        items, filas_vacias: filasVacias,
        // [F4 2026-05-04] obs separadas: NO concatenar pedido + remito (evita duplicacion)
        hayObsPedido: !!remito.observaciones_pedido,
        hayObsRemito: !!remito.observaciones_remito,
        obsPedido: remito.observaciones_pedido || '',
        obsRemito: remito.observaciones_remito || '',
        obsEditadoPor: remito.obs_editado_por_username || null,
        obsEditadoEn: remito.observaciones_editado_en
            ? new Date(remito.observaciones_editado_en).toLocaleString('es-AR', {
                day: '2-digit', month: '2-digit', year: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })
            : null,
        copias: config.copias || [{ nombre: 'ORIGINAL', color: '#000' }]
    });
}

const remitoPdfController = {
    async generarHTML(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;
        try {
            const reqContext = {
                id_usuario: req.usuario?.id_usuario || null,
                ip_origen: req.ip || req.headers['x-forwarded-for'] || null
            };
            const htmlContent = await renderRemito(id, id_empresa, reqContext);
            if (!htmlContent) return res.status(404).json({ error: 'Remito no encontrado' });
            const autoprint = '<scr' + 'ipt>window.onload=function(){window.print();}</scr' + 'ipt>';
            res.setHeader('Content-Type', 'text/html');
            res.send(htmlContent.replace('</body>', autoprint + '</body>'));
        } catch (error) {
            console.error('Error generando HTML remito:', error);
            res.status(500).json({ error: 'Error al generar HTML' });
        }
    },

    async generarHTMLViaje(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;
        try {
            const remitosResult = await pool.query(
                'SELECT id_remito FROM remitos WHERE id_viaje = $1 AND id_empresa = $2 ORDER BY id_remito',
                [id, id_empresa]
            );
            if (remitosResult.rows.length === 0) return res.status(404).json({ error: 'Viaje sin remitos' });

            const reqContext = {
                id_usuario: req.usuario?.id_usuario || null,
                ip_origen: req.ip || req.connection?.remoteAddress || null
            };

            let allHTML = '';
            for (const row of remitosResult.rows) {
                const html = await renderRemito(row.id_remito, id_empresa, reqContext);
                if (html) {
                    allHTML += html;
                    if (row !== remitosResult.rows[remitosResult.rows.length - 1]) {
                        allHTML += '<div style="page-break-after:always;"></div>';
                    }
                }
            }
            const autoprint = '<scr' + 'ipt>window.onload=function(){window.print();}</scr' + 'ipt>';
            const fullHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Viaje #' + id + '</title></head><body>' + allHTML + autoprint + '</body></html>';
            res.setHeader('Content-Type', 'text/html');
            res.send(fullHTML);
        } catch (error) {
            console.error('Error generando HTML viaje:', error);
            res.status(500).json({ error: 'Error al generar HTML del viaje' });
        }
    }
};

module.exports = remitoPdfController;
