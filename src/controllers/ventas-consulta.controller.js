/**
 * CONSULTA DE VENTAS CONTROLLER v4 - ERP LAGO
 * MIGRADO FASE 8c: confirmarRapido via confirmaciones.helper.js
 *
 * Helpers: confirmaciones.helper (confirmarRapido), pagos.helper, caja.helper,
 *          facturacion.helper (facturarDesdePedido), afip.service
 */

const pool = require('../config/database');
const pagosHelper = require('../utils/pagos.helper');
const cajaHelper = require('../utils/caja.helper');
const afipService = require('../services/afip.service');
const facturacionHelper = require('../utils/facturacion.helper');
const confirmacionesHelper = require('../utils/confirmaciones.helper');

const METODOS_PAGO_REAL = [1, 2, 3, 4, 5];
const METODO_CUENTA_CORRIENTE = 6;

/**
 * GET /api/ventas/consulta — Solo lectura (sin cambios)
 */
const consultarVentas = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const { q = '', estado = 'todos', fecha_desde, fecha_hasta, tipo_entrega = 'todos', id_metodo_pago, monto_desde, monto_hasta, limit = 100, offset = 0, incluir_cancelados } = req.query;

        // Cancelados: excluidos por defecto, incluidos con toggle
        const estadosExcluidos = incluir_cancelados === '1' ? '(-1, 0, 8)' : '(-2, -1, 0, 7, 8)';

        let query = `
            SELECT p.id_pedido, p.nro_pedido, p.fecha_creacion, p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires' as fecha_local, p.tipo_entrega, p.total_final, p.total, p.id_estado, c.razon_social AS estado_nombre, c.id_cliente, c.razon_social AS cliente, c.cuit_cuil, c.id_condicion_iva, ci.nombre AS condicion_iva, u.nombre AS usuario,
                COALESCE(pago_agg.total_pagado, 0) AS monto_pagado, COALESCE(pago_agg.total_real, 0) AS monto_real, COALESCE(pago_agg.total_fiado, 0) AS monto_fiado, COALESCE(pago_agg.cant_pagos, 0) AS cant_pagos, pago_agg.pagos_detalle,
                COALESCE(pago_agg.cant_pagos, 0) > 0 AS tiene_pago, COALESCE(pago_agg.total_fiado, 0) > 0 AS tiene_fiado, COALESCE(pago_agg.total_real, 0) > 0 AS tiene_pago_real,
                COALESCE(conf_agg.total_confirmado, 0) AS monto_confirmado, COALESCE(conf_agg.cant_confirmaciones, 0) > 0 AS pago_confirmado, conf_agg.fecha_confirmacion, conf_agg.confirmado_por,
                f.id_factura, f.numero_completo AS factura_numero, f.cae AS factura_cae, CASE WHEN f.id_factura IS NOT NULL THEN true ELSE false END AS facturado,
                pr.id_presupuesto, pr.numero_completo AS presupuesto_numero, CASE WHEN pr.id_presupuesto IS NOT NULL THEN true ELSE false END AS presupuestado,
                EXISTS (SELECT 1 FROM pedidos_log pl2 WHERE pl2.id_pedido = p.id_pedido AND pl2.accion NOT IN ('CONFIRMADO')) AS tiene_modificaciones,
                EXISTS (SELECT 1 FROM pedidos_log pl3 WHERE pl3.id_pedido = p.id_pedido AND pl3.accion IN ('ITEM_ELIMINADO')) AS tiene_items_eliminados,
                EXISTS (SELECT 1 FROM pedidoitems pi2 WHERE pi2.id_pedido = p.id_pedido AND pi2.cantidad < 0) AS tiene_items_negativos,
                CASE WHEN f.id_factura IS NOT NULL THEN 'facturado' WHEN COALESCE(conf_agg.cant_confirmaciones, 0) > 0 AND COALESCE(pago_agg.total_real, 0) <= COALESCE(conf_agg.total_confirmado, 0) + 0.01 AND COALESCE(pago_agg.total_fiado, 0) = 0 THEN 'confirmado' WHEN p.id_estado = 2 AND COALESCE(pago_agg.total_real, 0) > 0 AND COALESCE(pago_agg.total_fiado, 0) = 0 THEN 'confirmado' WHEN COALESCE(pago_agg.total_real, 0) > 0 AND COALESCE(pago_agg.total_real, 0) > COALESCE(conf_agg.total_confirmado, 0) + 0.01 THEN 'pendiente_confirmar' WHEN COALESCE(pago_agg.total_fiado, 0) > 0 AND COALESCE(pago_agg.total_real, 0) = 0 THEN 'fiado' WHEN COALESCE(pago_agg.total_fiado, 0) > 0 AND COALESCE(pago_agg.total_real, 0) > 0 THEN 'parcial' ELSE 'sin_pago' END AS estado_pago,
                CASE WHEN f.id_factura IS NULL AND p.id_estado != 2 AND COALESCE(pago_agg.total_real, 0) > COALESCE(conf_agg.total_confirmado, 0) + 0.01 THEN true ELSE false END AS puede_confirmar_rapido,
                GREATEST(0, COALESCE(pago_agg.total_real, 0) - COALESCE(conf_agg.total_confirmado, 0)) AS monto_pendiente_confirmar
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario LEFT JOIN facturas f ON f.id_pedido = p.id_pedido AND f.estado != 'anulada' LEFT JOIN presupuestos pr ON pr.id_pedido = p.id_pedido AND pr.estado NOT IN ('rechazado')
            LEFT JOIN LATERAL (SELECT SUM(pg.monto) AS total_pagado, SUM(pg.monto) AS total_real, CASE WHEN p.es_fiado THEN COALESCE(p.total_final, p.total) - COALESCE(SUM(pg.monto), 0) ELSE 0 END AS total_fiado, COUNT(*) AS cant_pagos, json_agg(json_build_object('id_pago', pg.id_pago, 'metodo', mp.nombre, 'id_metodo', pg.id_metodo_pago, 'monto', pg.monto, 'es_fiado', false, 'referencia', pg.id_transaccion_externa) ORDER BY pg.fecha_pago) AS pagos_detalle FROM pagos pg JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago WHERE pg.id_pedido = p.id_pedido AND pg.id_pago_estado = 2) pago_agg ON true
            LEFT JOIN LATERAL (SELECT SUM(cp.monto) AS total_confirmado, COUNT(*) AS cant_confirmaciones, MAX(cp.fecha_confirmacion) AS fecha_confirmacion, (SELECT us.nombre FROM confirmaciones_pago cp2 JOIN usuarios us ON cp2.id_usuario_confirma = us.id_usuario WHERE cp2.id_pedido = p.id_pedido AND cp2.estado = 'confirmado' ORDER BY cp2.fecha_confirmacion DESC LIMIT 1) AS confirmado_por FROM confirmaciones_pago cp WHERE cp.id_pedido = p.id_pedido AND cp.estado = 'confirmado') conf_agg ON true
            WHERE p.id_empresa = $1 AND p.id_estado NOT IN ${estadosExcluidos}`;

        const params = [id_empresa]; let paramIndex = 2;
        if (q) { query += ` AND (LOWER(c.razon_social) LIKE $${paramIndex} OR LOWER(c.cuit_cuil) LIKE $${paramIndex} OR CAST(p.id_pedido AS TEXT) LIKE $${paramIndex} OR CAST(p.nro_pedido AS TEXT) LIKE $${paramIndex} OR CAST(p.total_final AS TEXT) LIKE $${paramIndex} OR LOWER(COALESCE(f.numero_completo,'')) LIKE $${paramIndex} OR CAST(COALESCE(f.numero_factura,0) AS TEXT) LIKE $${paramIndex})`; params.push(`%${q.toLowerCase()}%`); paramIndex++; }
        switch (estado) {
            case 'sin_pago': query += ` AND COALESCE(pago_agg.cant_pagos, 0) = 0 AND f.id_factura IS NULL`; break;
            case 'fiado': query += ` AND COALESCE(pago_agg.total_fiado, 0) > 0 AND COALESCE(pago_agg.total_real, 0) = 0 AND f.id_factura IS NULL`; break;
            case 'parcial': query += ` AND COALESCE(pago_agg.total_fiado, 0) > 0 AND COALESCE(pago_agg.total_real, 0) > 0 AND f.id_factura IS NULL`; break;
            case 'pendiente_confirmar': query += ` AND COALESCE(pago_agg.total_real, 0) > COALESCE(conf_agg.total_confirmado, 0) + 0.01 AND f.id_factura IS NULL`; break;
            case 'confirmado': case 'para_facturar': query += ` AND COALESCE(conf_agg.cant_confirmaciones, 0) > 0 AND COALESCE(pago_agg.total_real, 0) <= COALESCE(conf_agg.total_confirmado, 0) + 0.01 AND COALESCE(pago_agg.total_fiado, 0) = 0 AND f.id_factura IS NULL`; break;
            case 'facturado': query += ` AND f.id_factura IS NOT NULL`; break;
            case 'items_negativos': query += ` AND EXISTS (SELECT 1 FROM pedidoitems pi_neg WHERE pi_neg.id_pedido = p.id_pedido AND pi_neg.cantidad < 0)`; break;
        }
        if (fecha_desde) { query += ` AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= $${paramIndex}::date`; params.push(fecha_desde); paramIndex++; }
        if (fecha_hasta) { query += ` AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= $${paramIndex}::date`; params.push(fecha_hasta); paramIndex++; }
        if (tipo_entrega !== 'todos') { query += ` AND p.tipo_entrega = $${paramIndex}`; params.push(tipo_entrega); paramIndex++; }
        if (id_metodo_pago) { query += ` AND EXISTS (SELECT 1 FROM pagos pg WHERE pg.id_pedido = p.id_pedido AND pg.id_metodo_pago = $${paramIndex})`; params.push(parseInt(id_metodo_pago)); paramIndex++; }
        if (monto_desde) { query += ` AND p.total_final >= $${paramIndex}`; params.push(parseFloat(monto_desde)); paramIndex++; }
        if (monto_hasta) { query += ` AND p.total_final <= $${paramIndex}`; params.push(parseFloat(monto_hasta)); paramIndex++; }
        query += ` ORDER BY p.fecha_creacion DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(parseInt(limit), parseInt(offset));

        const result = await pool.query(query, params);

        const contadoresQuery = `WITH pagos_agg AS (SELECT p.id_pedido, COALESCE(SUM(pg.monto), 0) AS total_real, CASE WHEN p.es_fiado THEN COALESCE(p.total_final, p.total) - COALESCE(SUM(pg.monto), 0) ELSE 0 END AS total_fiado, COUNT(pg.id_pago) AS cant_pagos FROM pedidos p LEFT JOIN pagos pg ON pg.id_pedido = p.id_pedido AND pg.id_pago_estado = 2 WHERE p.id_empresa = $1 AND p.id_estado NOT IN ${estadosExcluidos} ${fecha_desde ? `AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= '${fecha_desde}'::date` : ''} ${fecha_hasta ? `AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= '${fecha_hasta}'::date` : ''} GROUP BY p.id_pedido, p.es_fiado, p.total_final, p.total), conf_agg AS (SELECT id_pedido, COALESCE(SUM(monto), 0) AS total_confirmado FROM confirmaciones_pago WHERE estado = 'confirmado' GROUP BY id_pedido) SELECT COUNT(*) AS todos, COUNT(*) FILTER (WHERE pa.cant_pagos = 0 AND f.id_factura IS NULL) AS sin_pago, COUNT(*) FILTER (WHERE pa.total_fiado > 0 AND pa.total_real = 0 AND f.id_factura IS NULL) AS fiado, COUNT(*) FILTER (WHERE pa.total_fiado > 0 AND pa.total_real > 0 AND f.id_factura IS NULL) AS parcial, COUNT(*) FILTER (WHERE pa.total_real > COALESCE(ca.total_confirmado, 0) + 0.01 AND f.id_factura IS NULL) AS pendiente_confirmar, COUNT(*) FILTER (WHERE COALESCE(ca.total_confirmado, 0) > 0 AND pa.total_real <= COALESCE(ca.total_confirmado, 0) + 0.01 AND pa.total_fiado = 0 AND f.id_factura IS NULL) AS confirmado, COUNT(*) FILTER (WHERE f.id_factura IS NOT NULL) AS facturado, COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM pedidoitems pi_neg WHERE pi_neg.id_pedido = p.id_pedido AND pi_neg.cantidad < 0)) AS items_negativos FROM pedidos p LEFT JOIN pagos_agg pa ON pa.id_pedido = p.id_pedido LEFT JOIN conf_agg ca ON ca.id_pedido = p.id_pedido LEFT JOIN facturas f ON f.id_pedido = p.id_pedido AND f.estado != 'anulada' LEFT JOIN presupuestos pr ON pr.id_pedido = p.id_pedido AND pr.estado NOT IN ('rechazado') WHERE p.id_empresa = $1 AND p.id_estado NOT IN ${estadosExcluidos} ${fecha_desde ? `AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= '${fecha_desde}'::date` : ''} ${fecha_hasta ? `AND (p.fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= '${fecha_hasta}'::date` : ''}`;
        const contadoresResult = await pool.query(contadoresQuery, [id_empresa]);

        // Conteo de cancelados (siempre, para badge del frontend)
        const canceladosCountQuery = await pool.query(
            `SELECT COUNT(*) as cancelados FROM pedidos WHERE id_empresa = $1 AND id_estado IN (7, -2) ${fecha_desde ? `AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= '${fecha_desde}'::date` : ''} ${fecha_hasta ? `AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= '${fecha_hasta}'::date` : ''}`,
            [id_empresa]
        );
        const totalCancelados = parseInt(canceladosCountQuery.rows[0].cancelados) || 0;

        // Resumen: siempre se calcula, usando filtros de fecha del usuario
        let resumen = {};
        {
            const rParts = [`SELECT
                COALESCE((SELECT SUM(pp.total_final) FROM pedidos pp WHERE pp.id_empresa = $1 AND pp.id_estado NOT IN ${estadosExcluidos}`, 
                `), 0) AS total_vendido,
                COALESCE((SELECT COUNT(*) FROM pedidos pp2 WHERE pp2.id_empresa = $1 AND pp2.id_estado NOT IN ${estadosExcluidos}`,
                `), 0) AS cantidad,
                COALESCE(SUM(CASE WHEN pg.id_metodo_pago = 1 THEN pg.monto ELSE 0 END), 0) AS efectivo,
                COALESCE(SUM(CASE WHEN pg.id_metodo_pago IN (2,3) THEN pg.monto ELSE 0 END), 0) AS transferencia,
                COALESCE(SUM(CASE WHEN pg.id_metodo_pago IN (4,5) THEN pg.monto ELSE 0 END), 0) AS tarjeta,
                0 AS fiado
            FROM pagos pg
            JOIN pedidos p ON pg.id_pedido = p.id_pedido AND p.id_empresa = $1 AND p.id_estado NOT IN ${estadosExcluidos}`];
            
            let fechaFilterSub = '';
            let fechaFilterMain = '';
            const resumenParams = [id_empresa];
            let rIdx = 2;
            if (fecha_desde) {
                const ff = ` AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= $${rIdx}::date`;
                fechaFilterSub += ff;
                fechaFilterMain += ff.replace('fecha_creacion', 'p.fecha_creacion');
                resumenParams.push(fecha_desde);
                rIdx++;
            }
            if (fecha_hasta) {
                const ff = ` AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= $${rIdx}::date`;
                fechaFilterSub += ff;
                fechaFilterMain += ff.replace('fecha_creacion', 'p.fecha_creacion');
                resumenParams.push(fecha_hasta);
                rIdx++;
            }
            
            const resumenQuery = rParts[0] + fechaFilterSub + rParts[1] + fechaFilterSub + rParts[2] + fechaFilterMain;
            const resumenResult = await pool.query(resumenQuery, resumenParams);
            resumen = resumenResult.rows[0] || {};
            resumen.fecha_desde = fecha_desde || null;
            resumen.fecha_hasta = fecha_hasta || null;
        }


        const contadoresData = contadoresResult.rows[0] || {};
        contadoresData.cancelados = totalCancelados;
        res.json({ success: true, ventas: result.rows, total: result.rowCount, contadores: contadoresData, resumen });
    } catch (error) {
        console.error('Error en consultarVentas:', error);
        res.status(500).json({ success: false, error: 'Error al consultar ventas', detalle: error.message });
    }
};

/**
 * POST /api/ventas/confirmar-rapido — MIGRADO A HELPER
 */
const confirmarRapido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_pedido } = req.body;
        if (!id_pedido) return res.status(400).json({ success: false, error: 'id_pedido requerido' });

        await client.query('BEGIN');

        const pagosQuery = await client.query(`SELECT pg.id_pago, pg.id_metodo_pago, pg.monto, mp.nombre AS metodo_pago, COALESCE((SELECT SUM(cp.monto) FROM confirmaciones_pago cp WHERE cp.id_pago = pg.id_pago AND cp.estado = 'confirmado'), 0) AS ya_confirmado FROM pagos pg JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago JOIN pedidos p ON pg.id_pedido = p.id_pedido WHERE pg.id_pedido = $1 AND p.id_empresa = $2 AND pg.id_pago_estado = 2 ORDER BY pg.fecha_pago`, [id_pedido, id_empresa]);
        if (pagosQuery.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'No hay pagos reales para confirmar' }); }

        const confirmaciones = [];
        let totalConfirmado = 0;

        for (const pago of pagosQuery.rows) {
            const montoPendiente = parseFloat(pago.monto) - parseFloat(pago.ya_confirmado);
            if (montoPendiente <= 0.01) continue;

            const randomPart = Math.random().toString(36).substr(2, 4).toUpperCase();
            const codigoUnico = `P${id_pedido}-${pago.id_pago}-${randomPart}`.substring(0, 20);

            // >>> HELPER <<<
            await confirmacionesHelper.crearConfirmacion(client, {
                id_empresa, id_pedido, id_pago: pago.id_pago, codigo_unico: codigoUnico,
                metodo_pago: pago.metodo_pago, monto: montoPendiente, id_usuario_confirma: id_usuario
            });

            confirmaciones.push({ id_pago: pago.id_pago, metodo: pago.metodo_pago, monto: montoPendiente, codigo: codigoUnico });
            totalConfirmado += montoPendiente;
        }

        if (confirmaciones.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'Todos los pagos ya fueron confirmados' }); }

        await client.query('COMMIT');
        res.json({ success: true, message: `${confirmaciones.length} pago(s) confirmado(s)`, confirmaciones, total_confirmado: totalConfirmado });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en confirmarRapido:', error);
        res.status(500).json({ success: false, error: error.message });
    } finally { client.release(); }
};

/**
 * POST /api/facturas/desde-pedido/:id_pedido — ya usa facturacion.helper (sin cambios)
 */
const facturarDesdePedido = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa } = req.usuario; const { id_pedido } = req.params; const { id_tipo_factura: body_tipo_factura, observaciones = '' } = req.body;
        await client.query('BEGIN');

        let pvData;
        if (req.usuario.id_deposito) { pvData = await facturacionHelper.resolverPuntoVenta(client, { id_deposito: req.usuario.id_deposito, id_empresa }); }
        else {
            const depRes = await client.query('SELECT id_deposito, punto_venta_afip FROM depositos WHERE id_empresa = $1 AND es_principal = true LIMIT 1', [id_empresa]);
            if (depRes.rows.length > 0 && depRes.rows[0].punto_venta_afip) {
                pvData = { punto_venta: depRes.rows[0].punto_venta_afip, id_deposito: depRes.rows[0].id_deposito };
            } else {
                // F1 fix: leer PV default de configuraciones_empresa (no hardcodear 6)
                const cfgRes = await client.query("SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'afip_punto_venta_default'", [id_empresa]);
                const pvDefault = cfgRes.rows.length > 0 ? parseInt(cfgRes.rows[0].valor, 10) : null;
                if (!pvDefault) {
                    throw Object.assign(new Error('No hay punto de venta AFIP configurado. Asigne uno en Configuraciones > AFIP o en Admin > Depósitos.'), { statusCode: 400 });
                }
                pvData = { punto_venta: pvDefault, id_deposito: null };
            }
        }
        const punto_venta = pvData.punto_venta;

        const pedidoQuery = await client.query(`SELECT p.*, c.id_cliente, c.razon_social, c.cuit_cuil, c.id_condicion_iva FROM pedidos p LEFT JOIN clientes c ON p.id_cliente = c.id_cliente WHERE p.id_pedido = $1 AND p.id_empresa = $2`, [id_pedido, id_empresa]);
        if (pedidoQuery.rows.length === 0) throw new Error('Pedido no encontrado');
        const pedido = pedidoQuery.rows[0];

        // Auto-determinar tipo factura: RI→A, Mono/CF/Exento→B (como masivo)
        const id_tipo_factura = body_tipo_factura || (pedido.id_condicion_iva === 1 ? 1 : 2);

        await facturacionHelper.verificarNoFacturado(client, { id_pedido: parseInt(id_pedido), id_empresa });

        const itemsQuery = await client.query(`SELECT pi.*, pr.nombre AS producto_nombre, pr.sku FROM pedidoitems pi LEFT JOIN productos pr ON pi.id_producto = pr.id_producto WHERE pi.id_pedido = $1 AND pi.id_empresa = $2 ORDER BY pi.id_item`, [id_pedido, id_empresa]);
        const items = itemsQuery.rows;
        if (items.length === 0) throw new Error('El pedido no tiene items');

        const numeroFactura = await facturacionHelper.obtenerProximoNumero(client, { id_empresa, punto_venta, id_tipo_factura });
        const subtotal = parseFloat(pedido.subtotal_sin_iva) || 0; const totalIva = parseFloat(pedido.total_iva) || 0; const total = parseFloat(pedido.total_final) || parseFloat(pedido.total) || 0; const descuentoMonto = parseFloat(pedido.descuento_monto) || 0;

        await afipService.cargarConfiguracion(pool, id_empresa);
        let cae, caeVencimiento;
        if (afipService.config.modoOffline) { cae = 'OFFLINE-' + Date.now(); caeVencimiento = new Date(); caeVencimiento.setDate(caeVencimiento.getDate() + 10); }
        else {
            const ivaDetalle = afipService.agruparIVAPorAlicuota(items.map(item => ({ porcentaje_iva: item.iva_aplicado, subtotal: parseFloat(item.total_linea || 0) - parseFloat(item.monto_iva || 0), iva_calculado: parseFloat(item.monto_iva || 0) })));
            const resultadoAFIP = await afipService.solicitarCAE({ punto_venta, id_tipo_factura, numero_factura: numeroFactura, cuit_cliente: pedido.cuit_cuil, id_condicion_iva_cliente: pedido.id_condicion_iva, neto_gravado: Math.round(subtotal * 100) / 100, total_iva: Math.round(totalIva * 100) / 100, total: Math.round(total * 100) / 100, iva_detalle: ivaDetalle });
            cae = resultadoAFIP.cae; const vtoStr = resultadoAFIP.cae_vencimiento; caeVencimiento = new Date(parseInt(vtoStr.substring(0, 4)), parseInt(vtoStr.substring(4, 6)) - 1, parseInt(vtoStr.substring(6, 8)));
        }

        const facturaCreada = await facturacionHelper.crearFacturaConItems(client, {
            id_empresa, id_pedido: parseInt(id_pedido), id_cliente: pedido.id_cliente, id_tipo_factura, punto_venta, numero_factura: numeroFactura, cae, cae_vencimiento: caeVencimiento, observaciones, descuento_porcentaje: pedido.descuento_general || 0, descuento_monto: descuentoMonto, subtotal_sin_descuento: subtotal + descuentoMonto, id_deposito: pvData.id_deposito,
            descuento_fp_porcentaje: parseFloat(pedido.descuento_fp_porcentaje || 0),
            descuento_fp_monto: parseFloat(pedido.descuento_fp_monto || 0),
            id_forma_pago_principal: pedido.id_forma_pago_principal,
            items: items.map(item => ({ id_producto: item.id_producto, cantidad: item.cantidad, descripcion: item.descripcion_congelada || item.producto_nombre, precio_unitario: item.precio_unitario_final || item.precio_unitario_congelado, porcentaje_iva: item.iva_aplicado, precio_lista: item.precio_unitario_congelado, descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0) }))
        }, { calcularTotales: false, totalesExternos: { subtotal, total_iva: totalIva, total } });

        await facturacionHelper.marcarPedidoFacturado(client, { id_pedido: parseInt(id_pedido), id_empresa });
        await client.query('COMMIT');

        res.json({ success: true, message: 'Factura generada exitosamente', factura: { id_factura: facturaCreada.id_factura, numero_completo: facturaCreada.numero_completo, cae: facturaCreada.cae, cae_vencimiento: facturaCreada.cae_vencimiento } });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en facturarDesdePedido:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    } finally { client.release(); }
};

const registrarPago = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario; const { id_pedido, id_metodo_pago, monto, referencia, id_terminal, cuotas, coeficiente, monto_original, comision_estimada } = req.body;
        let montoFinal = parseFloat(monto);
        if (!montoFinal || montoFinal <= 0) { const pedidoCheck = await client.query('SELECT total_final FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2', [id_pedido, id_empresa]); if (pedidoCheck.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Pedido no encontrado' }); } montoFinal = parseFloat(pedidoCheck.rows[0].total_final); }
        const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
        const pago = await pagosHelper.registrarPago(client, { id_empresa, id_pedido, id_metodo_pago, monto: montoFinal, id_usuario, id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO, observaciones: 'Registrado por cajero', id_transaccion_externa: referencia || null, id_turno: turno ? turno.id_turno : null, id_terminal: id_terminal || null, cuotas: cuotas || 1, coeficiente: parseFloat(coeficiente) || 1, monto_original: monto_original ? parseFloat(monto_original) : null, comision_estimada: comision_estimada ? parseFloat(comision_estimada) : 0 });
        const pedidosHelperLog = require('../utils/pedidos.helper');
        await pedidosHelperLog.registrarLogPedido(client, { id_pedido: parseInt(id_pedido), id_empresa, id_usuario, accion: pedidosHelperLog.LOG_PEDIDO_ACCIONES.PAGO_REGISTRADO, detalle_despues: { id_pago: pago.id_pago, id_metodo_pago, monto: montoFinal }, ip_origen: req.ip });
        await client.query('COMMIT');
        res.json({ success: true, id_pago: pago.id_pago, message: 'Pago registrado correctamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    } finally { client.release(); }
};



/**
 * GET /api/facturas/metodos-pago — Lista métodos de pago disponibles
 */
const obtenerMetodosPago = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const result = await pool.query(
            'SELECT id_metodo_pago, nombre FROM metodosdepago WHERE id_empresa = $1 ORDER BY id_metodo_pago',
            [id_empresa]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * PUT /api/facturas/corregir-metodo-pago — Corrige forma de pago de un pedido
 */
const corregirMetodoPago = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_pago, nuevo_id_metodo_pago, motivo } = req.body;

        if (!id_pago || !nuevo_id_metodo_pago) {
            return res.status(400).json({ success: false, error: 'id_pago y nuevo_id_metodo_pago son obligatorios' });
        }

        await client.query('BEGIN');

        // Obtener turno abierto (puede no haber)
        const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);

        const resultado = await pagosHelper.corregirMetodoPago(client, {
            id_empresa,
            id_pago: parseInt(id_pago),
            nuevo_id_metodo_pago: parseInt(nuevo_id_metodo_pago),
            id_usuario,
            id_turno: turno ? turno.id_turno : null,
            motivo: motivo || ''
        });

        const phlp = require('../utils/pedidos.helper');
        const piRes = await client.query('SELECT id_pedido FROM pagos WHERE id_pago = $1', [parseInt(id_pago)]);
        if (piRes.rows.length > 0) { await phlp.registrarLogPedido(client, { id_pedido: piRes.rows[0].id_pedido, id_empresa, id_usuario, accion: phlp.LOG_PEDIDO_ACCIONES.FORMA_PAGO_CAMBIADA, detalle_antes: { id_pago: parseInt(id_pago), metodo: resultado.metodo_anterior }, detalle_despues: { id_pago: parseInt(id_pago), metodo: resultado.metodo_nuevo, motivo: motivo || '' }, ip_origen: req.ip }); }
        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Forma de pago corregida: ${resultado.metodo_anterior} → ${resultado.metodo_nuevo}`,
            ...resultado
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en corregirMetodoPago:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
};

module.exports = { consultarVentas, confirmarRapido, facturarDesdePedido, registrarPago, corregirMetodoPago, obtenerMetodosPago };
