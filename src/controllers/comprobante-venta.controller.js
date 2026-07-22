/**
 * Controller para generar comprobantes de venta
 * ERP LAGO — Fix 2026-03-15
 */
const pool = require('../config/database');
const fs = require('fs');
const path = require('path');

const comprobanteController = {
    async obtenerDatosComprobante(req, res) {
        try {
            const { id } = req.params;
            const { id_empresa } = req.usuario;

            const pedidoResult = await pool.query(`
                SELECT p.*,
                    c.razon_social as cliente_razon_social,
                    c.cuit_cuil as cliente_cuit,
                    c.domicilio as cliente_domicilio,
                    c.telefono as cliente_telefono,
                    c.email as cliente_email,
                    ci.nombre as cliente_condicion_iva,
                    c.id_condicion_iva as cliente_id_condicion_iva,
                    pe.nombre as estado_nombre,
                    u.nombre as vendedor_nombre
                FROM pedidos p
                JOIN clientes c ON p.id_cliente = c.id_cliente
                LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
                JOIN pedidoestados pe ON p.id_estado = pe.id_estado
                LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
                WHERE p.id_pedido = $1 AND p.id_empresa = $2
            `, [id, id_empresa]);

            if (pedidoResult.rows.length === 0) {
                return res.status(404).json({ error: 'Pedido no encontrado' });
            }

            const pedido = pedidoResult.rows[0];

            const empresaResult = await pool.query(`
                SELECT e.*, ci.nombre as condicion_iva_nombre
                FROM empresas e
                LEFT JOIN condicionesiva ci ON e.id_condicion_iva = ci.id_condicion_iva
                WHERE e.id_empresa = $1
            `, [id_empresa]);

            const empresa = empresaResult.rows[0];

            const itemsResult = await pool.query(`
                SELECT pi.*, p.sku, p.nombre as producto_nombre
                FROM pedidoitems pi
                JOIN productos p ON pi.id_producto = p.id_producto
                WHERE pi.id_pedido = $1
                ORDER BY pi.id_item
            `, [id]);

            const pagosResult = await pool.query(`
                SELECT pg.*, mp.nombre as metodo_nombre
                FROM pagos pg
                LEFT JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago
                WHERE pg.id_pedido = $1
                ORDER BY pg.fecha_pago
            `, [id]);

            const totalPagado = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
            const totalPedido = parseFloat(pedido.total_final || pedido.total || 0);
            const saldoPendiente = totalPedido - totalPagado;

            const esRI = pedido.cliente_id_condicion_iva === 1;

            const datos = {
                empresa: {
                    razon_social: empresa.razon_social,
                    nombre_fantasia: empresa.nombre_fantasia,
                    cuit: empresa.cuit,
                    domicilio: empresa.domicilio_fiscal,
                    telefono: empresa.telefono,
                    email: empresa.email,
                    condicion_iva: empresa.condicion_iva_nombre || 'Responsable Inscripto'
                },
                pedido: {
                    id_pedido: pedido.id_pedido,
                    fecha_formateada: new Date(pedido.fecha_creacion).toLocaleDateString('es-AR', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                    }),
                    tipo_entrega: pedido.tipo_entrega,
                    estado: pedido.estado_nombre,
                    vendedor: pedido.vendedor_nombre
                },
                cliente: {
                    razon_social: pedido.cliente_razon_social,
                    cuit_cuil: pedido.cliente_cuit || '-',
                    domicilio: pedido.domicilio_entrega || pedido.cliente_domicilio || '-',
                    telefono: pedido.cliente_telefono || '-',
                    email: pedido.cliente_email || '-',
                    condicion_iva: pedido.cliente_condicion_iva || 'Consumidor Final'
                },
                es_responsable_inscripto: esRI,
                items: itemsResult.rows.map(item => {
                    const precioNeto = parseFloat(item.precio_unitario_congelado);
                    const totalNeto = parseFloat(item.total_linea);
                    // F1: IVA por item (no más 1.21 hardcodeado). iva_aplicado se persiste en pedidoitems.
                    // Si por algún motivo no viene (datos legacy), se cae a obtenerIvaProducto del helper.
                    const ivaItemPct = parseFloat(item.iva_aplicado);
                    if (isNaN(ivaItemPct)) throw new Error('comprobante-venta: pedidoitem ' + item.id_item + ' sin iva_aplicado persistido');
                    const factorIva = 1 + ivaItemPct / 100;
                    return {
                        sku: item.sku || '-',
                        descripcion: item.descripcion_congelada || item.producto_nombre,
                        cantidad: parseFloat(item.cantidad).toFixed(2),
                        precio_unitario: esRI ? precioNeto.toFixed(2) : (Math.round(precioNeto * factorIva * 100) / 100).toFixed(2),
                        descuento: item.porcentaje_descuento > 0 ? item.porcentaje_descuento : null,
                        subtotal: esRI ? totalNeto.toFixed(2) : (Math.round(totalNeto * factorIva * 100) / 100).toFixed(2)
                    };
                }),
                totales: (() => {
                    const subtotal = parseFloat(pedido.subtotal_sin_iva || 0);
                    const iva = parseFloat(pedido.total_iva || 0);
                    const total = parseFloat(pedido.total_final || pedido.total || 0);
                    const descuento = parseFloat(pedido.descuento_monto || 0);
                    return {
                        subtotal: esRI ? subtotal.toFixed(2) : total.toFixed(2),
                        descuento: descuento > 0 ? descuento.toFixed(2) : null,
                        iva: esRI ? iva.toFixed(2) : null,
                        total: total.toFixed(2)
                    };
                })(),
                pagos: pagosResult.rows.map(pago => {
                    const cuotas = parseInt(pago.cuotas) || 0;
                    const montoOriginal = parseFloat(pago.monto_original || 0);
                    const monto = parseFloat(pago.monto);
                    let detalle = pago.metodo_nombre || 'Efectivo';
                    if (cuotas > 1) {
                        const valorCuota = Math.round(monto / cuotas * 100) / 100;
                        detalle += ' - ' + cuotas + ' cuotas x $' + valorCuota.toFixed(2);
                    } else if (cuotas === 1 && montoOriginal > 0 && montoOriginal !== monto) {
                        detalle += ' (1 pago)';
                    }
                    return {
                        metodo: detalle,
                        monto: monto.toFixed(2),
                        monto_original: montoOriginal > 0 && montoOriginal !== monto ? montoOriginal.toFixed(2) : null,
                        pendiente: false
                    };
                }),
                observaciones: pedido.observaciones,
                es_retiro: pedido.tipo_entrega === 'retira' || pedido.tipo_entrega === 'retiro',
                pagado_completo: saldoPendiente <= 0.01,
                tiene_pagos: totalPagado > 0,
                saldo_pendiente: saldoPendiente > 0.01 ? saldoPendiente.toFixed(2) : null,
                tipo_comprobante: 'COMPROBANTE DE VENTA',
                fecha_impresion: new Date().toLocaleString('es-AR')
            };

            if (saldoPendiente > 0.01) {
                datos.pagos.push({
                    metodo: 'Saldo Pendiente',
                    monto: saldoPendiente.toFixed(2),
                    pendiente: true
                });
            }

            res.json(datos);

        } catch (error) {
            console.error('Error obteniendo datos del comprobante:', error);
            res.status(500).json({ error: 'Error al obtener datos del comprobante' });
        }
    },

    async generarHTML(req, res) {
        try {
            const { id } = req.params;
            req.params.id = id;
            const datosReq = { ...req };

            const datosResponse = await new Promise((resolve, reject) => {
                const mockRes = {
                    json: (data) => resolve(data),
                    status: (code) => ({ json: (data) => reject({ code, ...data }) })
                };
                comprobanteController.obtenerDatosComprobante(datosReq, mockRes);
            });

            const templatePath = path.join(__dirname, '../../config/plantillas/ticket-venta.template.html');
            let template = fs.readFileSync(templatePath, 'utf8');

            // Reemplazar variables simples (recursivo para objetos anidados)
            const reemplazarVariables = (html, datos, prefijo = '') => {
                let resultado = html;
                for (const [key, value] of Object.entries(datos)) {
                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        resultado = reemplazarVariables(resultado, value, prefijo + key + '.');
                    } else if (!Array.isArray(value)) {
                        resultado = resultado.split('{{' + prefijo + key + '}}').join(value != null ? String(value) : '');
                    }
                }
                return resultado;
            };

            let html = reemplazarVariables(template, datosResponse);

            // Procesar items
            const itemsMatch = html.match(/{{#each items}}([\s\S]*?){{\/each}}/);
            if (itemsMatch && datosResponse.items) {
                const itemTemplate = itemsMatch[1];
                const itemsHtml = datosResponse.items.map(item => {
                    let itemHtml = itemTemplate;
                    for (const [key, value] of Object.entries(item)) {
                        itemHtml = itemHtml.split('{{this.' + key + '}}').join(value != null ? String(value) : '');
                    }
                    if (item.descuento) {
                        itemHtml = itemHtml.replace(/{{#if this\.descuento}}([\s\S]*?){{\/if}}/g, '$1');
                    } else {
                        itemHtml = itemHtml.replace(/{{#if this\.descuento}}[\s\S]*?{{\/if}}/g, '');
                    }
                    return itemHtml;
                }).join('');
                html = html.replace(/{{#each items}}[\s\S]*?{{\/each}}/, itemsHtml);
            }

            // Procesar pagos
            const pagosMatch = html.match(/{{#each pagos}}([\s\S]*?){{\/each}}/);
            if (pagosMatch && datosResponse.pagos) {
                const pagoTemplate = pagosMatch[1];
                const pagosHtml = datosResponse.pagos.map(pago => {
                    let pagoHtml = pagoTemplate;
                    for (const [key, value] of Object.entries(pago)) {
                        if (value != null) {
                            pagoHtml = pagoHtml.split('{{this.' + key + '}}').join(String(value));
                        }
                    }
                    // Condicionales
                    const procesarIfPago = (html, campo, valor) => {
                        const re = new RegExp('{{#if this\\.' + campo + '}}([\\s\\S]*?){{/if}}', 'g');
                        return valor ? html.replace(re, '$1') : html.replace(re, '');
                    };
                    pagoHtml = procesarIfPago(pagoHtml, 'pendiente', pago.pendiente);
                    pagoHtml = procesarIfPago(pagoHtml, 'monto_original', pago.monto_original);
                    return pagoHtml;
                }).join('');
                html = html.replace(/{{#each pagos}}[\s\S]*?{{\/each}}/, pagosHtml);
            }

            // Procesar condicionales simples
            const procesarCondicional = (html, condicion, valor) => {
                const reIfElse = new RegExp('{{#if ' + condicion + '}}([\\s\\S]*?){{else}}([\\s\\S]*?){{/if}}', 'g');
                const reIfOnly = new RegExp('{{#if ' + condicion + '}}([\\s\\S]*?){{/if}}', 'g');
                if (html.match(reIfElse)) {
                    html = html.replace(reIfElse, valor ? '$1' : '$2');
                } else {
                    html = valor ? html.replace(reIfOnly, '$1') : html.replace(reIfOnly, '');
                }
                return html;
            };

            html = procesarCondicional(html, 'es_retiro', datosResponse.es_retiro);
            html = procesarCondicional(html, 'pagado_completo', datosResponse.pagado_completo);
            html = procesarCondicional(html, 'tiene_pagos', datosResponse.tiene_pagos);
            html = procesarCondicional(html, 'pagos', datosResponse.pagos && datosResponse.pagos.length > 0);
            html = procesarCondicional(html, 'observaciones', datosResponse.observaciones);
            html = procesarCondicional(html, 'totales.descuento', datosResponse.totales && datosResponse.totales.descuento);
            html = procesarCondicional(html, 'totales.iva', datosResponse.totales && datosResponse.totales.iva);

            // Limpiar condicionales y variables restantes
            html = html.replace(/{{#if .*?}}[\s\S]*?{{\/if}}/g, '');
            html = html.replace(/{{#unless .*?}}[\s\S]*?{{\/unless}}/g, '');
            html = html.replace(/{{else}}/g, '');
            html = html.replace(/{{.*?}}/g, '');

            res.send(html);

        } catch (error) {
            console.error('Error generando HTML:', error);
            res.status(500).json({ error: 'Error al generar comprobante' });
        }
    }
};

module.exports = comprobanteController;
