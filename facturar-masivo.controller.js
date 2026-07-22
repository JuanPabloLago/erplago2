/**
 * FACTURACIÓN MASIVA - Agregar a facturas.controller.js
 * =====================================================
 * POST /api/facturas/masivo
 * Genera múltiples facturas desde array de pedido_ids
 * Usa SAVEPOINTs para que un error en un pedido no cancele los demás
 *
 * CAMBIOS vs versión anterior:
 *   - Integración con AFIP (CAE real via afip.service)
 *   - Movimiento de cuenta corriente para pagos en CC/Fiado
 *   - Discriminación IVA correcta (A discrimina, B no)
 *   - Validación tope Consumidor Final
 *   - Punto de venta desde config de empresa
 *   - IVA agrupado por alícuota para AFIP
 */

const afipService = require('../services/afip.service');

// ============================================================
// FACTURAR MASIVO
// ============================================================
exports.facturarMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.usuario.id_usuario, 10);
    const { pedido_ids, punto_venta: pv_override, observaciones = '' } = req.body;

    if (!pedido_ids || !Array.isArray(pedido_ids) || pedido_ids.length === 0) {
        return res.status(400).json({ error: 'Debe seleccionar al menos un pedido' });
    }

    // Cargar configuración AFIP para esta empresa
    await afipService.cargarConfiguracion(pool, id_empresa);

    const client = await pool.connect();
    const resultados = [];
    let exitosos = 0;
    let fallidos = 0;

    try {
        // Obtener punto de venta de config empresa (o usar override del request)
        let punto_venta = pv_override;
        if (!punto_venta) {
            const pvRes = await client.query(
                `SELECT valor FROM configuraciones_empresa
                 WHERE id_empresa = $1 AND clave = 'punto_venta_factura'`,
                [id_empresa]
            );
            punto_venta = pvRes.rows.length > 0 ? parseInt(pvRes.rows[0].valor) : 6;
        }

        await client.query('BEGIN');

        for (const id_pedido of pedido_ids) {
            const sp = `sp_fact_${id_pedido}`;
            try {
                await client.query(`SAVEPOINT ${sp}`);

                // ========================================
                // 1. Obtener pedido + cliente + condición IVA
                // ========================================
                const pedidoRes = await client.query(`
                    SELECT p.*, c.id_cliente, c.razon_social, c.cuit_cuil,
                           c.id_condicion_iva, c.domicilio,
                           ci.nombre AS condicion_iva_nombre,
                           p.descuento_porcentaje AS descuento_general
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
                    LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
                    WHERE p.id_pedido = $1 AND p.id_empresa = $2
                `, [id_pedido, id_empresa]);

                if (pedidoRes.rows.length === 0) {
                    throw new Error('Pedido no encontrado');
                }
                const pedido = pedidoRes.rows[0];

                // ========================================
                // 2. Verificar no facturado previamente
                // ========================================
                const existente = await client.query(
                    `SELECT id_factura FROM facturas
                     WHERE id_pedido = $1 AND estado != 'anulada'`,
                    [id_pedido]
                );
                if (existente.rows.length > 0) {
                    throw new Error('Ya facturado');
                }

                // ========================================
                // 3. Determinar tipo factura
                // ========================================
                const id_tipo_factura = afipService.determinarTipoFactura(pedido.id_condicion_iva);
                const esFacturaA = id_tipo_factura === 1;

                // ========================================
                // 4. Items del pedido
                // ========================================
                const itemsRes = await client.query(`
                    SELECT pi.*, pr.nombre AS producto_nombre
                    FROM pedidoitems pi
                    LEFT JOIN productos pr ON pi.id_producto = pr.id_producto
                    WHERE pi.id_pedido = $1
                `, [id_pedido]);

                if (itemsRes.rows.length === 0) {
                    throw new Error('Sin items');
                }

                // ========================================
                // 5. Secuencia con UPSERT atómico
                // ========================================
                const secRes = await client.query(`
                    INSERT INTO secuencia_facturas (id_empresa, punto_venta, id_tipo_factura, ultimo_numero)
                    VALUES ($1, $2, $3, 1)
                    ON CONFLICT (id_empresa, punto_venta, id_tipo_factura)
                    DO UPDATE SET ultimo_numero = secuencia_facturas.ultimo_numero + 1
                    RETURNING ultimo_numero
                `, [id_empresa, punto_venta, id_tipo_factura]);

                const numero_factura = secRes.rows[0].ultimo_numero;

                // ========================================
                // 6. Calcular totales e IVA por alícuota
                // ========================================
                const items = itemsRes.rows;
                let subtotal = 0;
                let totalIva = 0;
                let descuentoMonto = parseFloat(pedido.descuento_monto) || 0;

                // Calcular por item para tener detalle de IVA correcto
                const itemsCalculados = items.map((item, i) => {
                    const precioUnit = parseFloat(item.precio_unitario_congelado) || 0;
                    const cantidad = parseFloat(item.cantidad) || 0;
                    const ivaPct = parseFloat(item.iva_aplicado) || 21;

                    const subLinea = precioUnit * cantidad;
                    const ivaLinea = parseFloat(item.monto_iva) || (subLinea * ivaPct / 100);
                    const totalLinea = parseFloat(item.total_linea) || (subLinea + ivaLinea);

                    subtotal += subLinea;
                    totalIva += ivaLinea;

                    return {
                        ...item,
                        subtotal: subLinea,
                        porcentaje_iva: ivaPct,
                        iva_calculado: ivaLinea,
                        total: totalLinea,
                        numero_linea: i + 1,
                    };
                });

                const total = parseFloat(pedido.total_final) || (subtotal + totalIva - descuentoMonto);

                // Agrupar IVA por alícuota para AFIP
                const ivaDetalle = afipService.agruparIVAPorAlicuota(itemsCalculados);

                // ========================================
                // 7. Validar tope Consumidor Final
                // ========================================
                const validacionCF = afipService.validarTopeConsumidorFinal(
                    total, pedido.id_condicion_iva, 'otro'
                );
                if (!validacionCF.valido && !pedido.cuit_cuil) {
                    throw new Error(validacionCF.mensaje);
                }

                // ========================================
                // 8. Solicitar CAE a AFIP
                // ========================================
                let cae, caeVencimiento;
                try {
                    const afipResult = await afipService.solicitarCAE({
                        punto_venta,
                        id_tipo_factura,
                        numero_factura,
                        cuit_cliente: pedido.cuit_cuil,
                        id_condicion_iva_cliente: pedido.id_condicion_iva,
                        neto_gravado: Math.round(subtotal * 100) / 100,
                        total_iva: Math.round(totalIva * 100) / 100,
                        total: Math.round(total * 100) / 100,
                        iva_detalle: ivaDetalle,
                        fecha_emision: afipService.formatearFechaAFIP(new Date()),
                    });

                    cae = afipResult.cae;
                    caeVencimiento = afipResult.cae_vencimiento
                        ? afipService.parsearFechaAFIP(afipResult.cae_vencimiento)
                        : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

                } catch (afipError) {
                    // Si AFIP falla, NO emitir la factura
                    throw new Error(`AFIP: ${afipError.message}`);
                }

                // ========================================
                // 9. Insertar factura en BD
                // ========================================
                const facturaRes = await client.query(`
                    INSERT INTO facturas (
                        id_empresa, id_pedido, id_cliente, id_tipo_factura,
                        punto_venta, numero_factura,
                        fecha_emision, fecha_vencimiento,
                        subtotal, total_iva, total,
                        descuento_porcentaje, descuento_monto, subtotal_sin_descuento,
                        estado, cae, cae_vencimiento, observaciones
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,
                        CURRENT_DATE, CURRENT_DATE + interval '30 days',
                        $7,$8,$9,$10,$11,$12,
                        'emitida', $13, $14, $15
                    ) RETURNING id_factura, numero_completo, cae
                `, [
                    id_empresa, id_pedido, pedido.id_cliente, id_tipo_factura,
                    punto_venta, numero_factura,
                    Math.round(subtotal * 100) / 100,
                    Math.round(totalIva * 100) / 100,
                    Math.round(total * 100) / 100,
                    pedido.descuento_general || 0,
                    descuentoMonto,
                    Math.round((subtotal + descuentoMonto) * 100) / 100,
                    cae, caeVencimiento, observaciones
                ]);

                const factura = facturaRes.rows[0];

                // ========================================
                // 10. Insertar items con IVA real por producto
                // ========================================
                for (const item of itemsCalculados) {
                    await client.query(`
                        INSERT INTO factura_items (
                            id_factura, id_producto, cantidad, descripcion,
                            precio_unitario, porcentaje_iva, subtotal,
                            iva_calculado, total, numero_linea
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                    `, [
                        factura.id_factura, item.id_producto, item.cantidad,
                        item.descripcion_congelada || item.producto_nombre,
                        item.precio_unitario_congelado,
                        item.porcentaje_iva,
                        Math.round(item.subtotal * 100) / 100,
                        Math.round(item.iva_calculado * 100) / 100,
                        Math.round(item.total * 100) / 100,
                        item.numero_linea
                    ]);
                }

                // ========================================
                // 11. Movimiento de Cuenta Corriente
                // ========================================
                // Verificar si el pedido tiene pago en Cuenta Corriente (método 6)
                const pagosCC = await client.query(`
                    SELECT COALESCE(SUM(cp.monto), 0) AS monto_cc
                    FROM confirmaciones_pago cp
                    WHERE cp.id_pedido = $1 AND cp.id_metodo_pago = 6
                `, [id_pedido]);

                const montoCC = parseFloat(pagosCC.rows[0]?.monto_cc) || 0;

                if (montoCC > 0 && pedido.id_cliente) {
                    await client.query(`
                        INSERT INTO cuentacorrienteclientes (
                            id_empresa, id_cliente, id_factura,
                            tipo_movimiento, descripcion,
                            debe, haber, fecha
                        ) VALUES ($1, $2, $3, 'FACTURA', $4, $5, 0, CURRENT_DATE)
                    `, [
                        id_empresa,
                        pedido.id_cliente,
                        factura.id_factura,
                        `Factura ${factura.numero_completo} - Pedido #${id_pedido}`,
                        Math.round(total * 100) / 100
                    ]);
                }

                // ========================================
                // 12. Actualizar estado pedido a Facturado
                // ========================================
                await client.query(
                    `UPDATE pedidos SET id_estado = 3 WHERE id_pedido = $1`,
                    [id_pedido]
                );

                await client.query(`RELEASE SAVEPOINT ${sp}`);

                resultados.push({
                    id_pedido, ok: true,
                    id_factura: factura.id_factura,
                    numero_completo: factura.numero_completo,
                    cae: cae,
                    tipo: esFacturaA ? 'A' : 'B',
                    cliente: pedido.razon_social,
                    cuit: pedido.cuit_cuil,
                    total: Math.round(total * 100) / 100
                });
                exitosos++;

            } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                resultados.push({ id_pedido, ok: false, error: err.message });
                fallidos++;
                logger.warn(`Facturación pedido #${id_pedido} falló: ${err.message}`);
            }
        }

        if (exitosos > 0) {
            await client.query('COMMIT');
        } else {
            await client.query('ROLLBACK');
        }

        res.json({
            success: exitosos > 0,
            message: `${exitosos} facturas generadas, ${fallidos} errores`,
            exitosos, fallidos, resultados
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en facturarMasivo:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
