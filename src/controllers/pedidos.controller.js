/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ERP LAGO - Controlador de Pedidos v3.0 (Fase 2 — Migrado a pedidos.helper.js)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CAMBIOS FASE 2:
 * - Todas las escrituras a pedidos/pedidoitems via pedidosHelper
 * - calcularTotales() local eliminada → pedidosHelper.calcularTotalesItems()
 * - BUGS CORREGIDOS:
 *   · IVA con descuento general ahora respeta alícuota por item (antes usaba 21% flat)
 *   · suspenderPedido INSERT tenía 7 VALUES para 9 columnas → corregido
 *   · obtenerPendientesCobro estaba duplicada → eliminada
 *   · module.exports tenía suspenderPedido 3 veces → limpiado
 *
 * Fecha: 2026-02-21
 * ═══════════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');
const stockHelper = require('../utils/stock.helper');
const cajaHelper = require('../utils/caja.helper');
const pagosHelper = require('../utils/pagos.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const pedidosHelper = require('../utils/pedidos.helper');
const edicionHelper = require('../utils/pedidos-edicion.helper');
const ivaHelper = require('../utils/iva.helper');
const anulacionHelper   = require('../utils/anulacion-pedido.helper');

// ═══════════════════════════════════════════════════════════════════════════
// NOTA: calcularTotales() fue eliminada.
// Usar: pedidosHelper.calcularTotalesItems(items, descuentoPct, descuentoFijo)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene datos auxiliares para el módulo de pedidos
 */
async function getData(req, res) {
    try {
        const { id_empresa } = req.usuario;

        const clientesResult = await pool.query(`
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil,
                   c.id_condicion_iva, ci.nombre as condicion_iva,
                   c.domicilio, c.telefono, c.email
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_empresa = $1 AND c.activo = true
            ORDER BY c.razon_social
        `, [id_empresa]);

        const monedasResult = await pool.query(`
            SELECT id_moneda, codigo, nombre, simbolo, cotizacion_actual
            FROM monedas WHERE activo = true ORDER BY id_moneda
        `);

        const estadosResult = await pool.query(`
            SELECT id_estado, nombre FROM pedidoestados ORDER BY id_estado
        `);

        const condicionesIvaResult = await pool.query(`
            SELECT id_condicion_iva, nombre, discrimina_iva
            FROM condicionesiva ORDER BY id_condicion_iva
        `);

        res.json({
            clientes: clientesResult.rows,
            monedas: monedasResult.rows,
            estados: estadosResult.rows,
            condicionesIva: condicionesIvaResult.rows
        });

    } catch (error) {
        console.error('Error en getData:', error);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
}

/**
 * Helper interno: obtener cotización para moneda extranjera
 */
async function obtenerCotizacion(client, id_moneda, cotizacionParam) {
    if (id_moneda === 1 && cotizacionParam) return cotizacionParam;

    let cotizacion = cotizacionParam;

    if (id_moneda !== 1 && !cotizacion) {
        const monedaResult = await client.query(
            'SELECT cotizacion_actual FROM monedas WHERE id_moneda = $1',
            [id_moneda]
        );
        if (monedaResult.rows.length > 0) {
            cotizacion = monedaResult.rows[0].cotizacion_actual;
        }
    }

    // Siempre obtener cotización USD para historial
    if (!cotizacion) {
        const cotizUsdResult = await client.query(`
            SELECT cotizacion_venta FROM cotizaciones
            WHERE id_empresa = $1 AND id_moneda = 2
            ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC LIMIT 1
        `, [id_empresa]);
        if (cotizUsdResult.rows.length > 0) {
            cotizacion = cotizUsdResult.rows[0].cotizacion_venta;
        }
    }

    return cotizacion;
}

/**
 * Helper interno: preparar items con precios de BD
 */
async function prepararItemsConPrecios(client, items) {
    const itemsConPrecios = [];

    for (const item of items) {
        const productoResult = await client.query(`
            SELECT p.id_producto, p.nombre as descripcion,
                   pr.precio,
                   a.porcentaje as alicuota_iva
            FROM productos p
            LEFT JOIN precios pr ON p.id_producto = pr.id_producto
                AND pr.id_lista_precio = 1
            INNER JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota AND a.activo = true
            WHERE p.id_producto = $1
        `, [item.id_producto]);

        if (productoResult.rows.length === 0) {
            throw new Error(`Producto ${item.id_producto} no encontrado o sin alícuota IVA activa asignada — corregir en catálogo`);
        }

        const producto = productoResult.rows[0];
        const precioUnitario = item.precio_unitario_congelado || item.precio_unitario || producto.precio;

        itemsConPrecios.push({
            id_producto: item.id_producto,
            descripcion_congelada: item.descripcion || producto.descripcion,
            cantidad: item.cantidad,
            precio_unitario: precioUnitario,
            iva_aplicado: producto.alicuota_iva,
            porcentaje_descuento: item.porcentaje_descuento || 0
        });
    }

    return itemsConPrecios;
}

/**
 * Helper interno: procesar pagos de un pedido
 */
async function procesarPagos(client, datos) {
    const { pagos, id_empresa, id_pedido, id_usuario, id_cliente } = datos;

    if (!pagos || pagos.length === 0) return;

    const turnoAbierto = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
    const id_turno = turnoAbierto ? turnoAbierto.id_turno : null;

    const necesitaCaja = pagos.some(p => (p.id_metodo_pago || 1) >= 1 && (p.id_metodo_pago || 1) <= 5);
    if (necesitaCaja && !id_turno) {
        const err = new Error('No hay caja abierta. Abrí la caja antes de registrar pagos en efectivo/tarjeta/transferencia.');
        err.code = 'CAJA_CERRADA';
        throw err;
    }

    for (const pago of pagos) {
        const montoPago = parseFloat(pago.monto) || 0;
        const metodo = pago.id_metodo_pago || 1;
        if (montoPago <= 0) continue;

        await pagosHelper.registrarPago(client, {
            id_empresa, id_pedido, id_metodo_pago: metodo,
            monto: montoPago, id_usuario,
            id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
            id_turno, id_cliente,
            id_forma_pago: pago.id_forma_pago || null,
            concepto_prefijo: datos.concepto_prefijo || null
        });
    }
}

/**
 * Crear pedido inmediato (retiro en el momento)
 */
async function crearRetiroInmediato(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id_empresa, id_usuario } = req.usuario;
        const {
            id_cliente, items,
            descuento_general = 0, descuento_general_monto = 0,
            observaciones = '', tipo_entrega = 'retiro',
            id_moneda = 1, cotizacion = null,
            pagos = []
        } = req.body;

        if (!id_cliente) throw new Error('Cliente requerido');
        if (!items || items.length === 0) throw new Error('El pedido debe tener al menos un item');

        // Obtener datos del cliente
        const clienteResult = await client.query(`
            SELECT c.id_cliente, c.razon_social, c.id_condicion_iva,
                   ci.discrimina_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
        `, [id_cliente, id_empresa]);

        if (clienteResult.rows.length === 0) throw new Error('Cliente no encontrado');
        const cliente = clienteResult.rows[0];

        // Cotización
        const cotizacionFinal = await obtenerCotizacion(client, id_moneda, cotizacion);

        // Preparar items con precios de BD
        const itemsConPrecios = await prepararItemsConPrecios(client, items);

        // Calcular totales via helper (respeta alícuota IVA por item)
        const totales = pedidosHelper.calcularTotalesItems(itemsConPrecios, descuento_general, descuento_general_monto);

        // Total en moneda extranjera
        let totalMonedaExtranjera = null;
        if (id_moneda !== 1 && cotizacionFinal) {
            totalMonedaExtranjera = parseFloat((totales.total_final / cotizacionFinal).toFixed(2));
        }

        // Crear pedido via helper
        const pedido = await pedidosHelper.crearPedido(client, {
            id_empresa,
            id_usuario,
            id_cliente,
            id_estado: pedidosHelper.PEDIDO_ESTADOS.CONFIRMADO,
            id_moneda,
            cotizacion: cotizacionFinal,
            tipo_entrega,
            observaciones,
            descuento_general,
            total_moneda_extranjera: totalMonedaExtranjera,
            totales
        });

        const id_pedido = pedido.id_pedido;

        // Crear items via helper (retiro = cantidad_entregada = cantidad)
        await pedidosHelper.crearItems(client, id_pedido, id_empresa,
            totales.items.map(i => ({
                ...i,
                cantidad_entregada: parseFloat(i.cantidad)
            }))
        );

        // Descontar stock
        const id_deposito = await stockHelper.obtenerDepositoUsuario(client, req.usuario);
        for (const item of totales.items) {
            await stockHelper.descontarVenta(client, {
                id_empresa, id_deposito,
                id_producto: item.id_producto,
                cantidad: parseFloat(item.cantidad),
                id_usuario,
                documento_referencia: `Pedido #${id_pedido}`,
                observaciones: 'Retiro inmediato',
                id_pedido,
            });
        }

        // Procesar pagos
        await procesarPagos(client, {
            pagos, id_empresa, id_pedido, id_usuario, id_cliente
        });

        await client.query('COMMIT');

        res.json({
            success: true,
            id_pedido,
            mensaje: 'Pedido creado correctamente',
            totales: {
                subtotal_sin_iva: totales.subtotal_sin_iva,
                descuento: totales.descuento_monto,
                subtotal_con_descuento: totales.subtotal_con_descuento,
                iva: totales.total_iva,
                total: totales.total_final
            },
            cliente: {
                razon_social: cliente.razon_social,
                discrimina_iva: cliente.discrimina_iva
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === 'CAJA_CERRADA') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        console.error('Error en crearRetiroInmediato:', error);
        res.status(500).json({ error: error.message || 'Error al crear pedido' });
    } finally {
        client.release();
    }
}

/**
 * Guardar pedido para entregar después
 */
async function guardarParaEntregar(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id_empresa, id_usuario } = req.usuario;
        const {
            id_cliente, items,
            descuento_general = 0, descuento_general_monto = 0,
            observaciones = '', tipo_entrega = 'entrega',
            domicilio_entrega = '', fecha_entrega_pactada = null,
            id_moneda = 1, cotizacion = null,
            pagos = []
        } = req.body;

        if (!id_cliente) throw new Error('Cliente requerido');
        if (!items || items.length === 0) throw new Error('El pedido debe tener al menos un item');

        // Obtener datos del cliente
        const clienteResult = await client.query(`
            SELECT c.id_cliente, c.razon_social, c.domicilio,
                   c.id_condicion_iva, ci.discrimina_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
        `, [id_cliente, id_empresa]);

        if (clienteResult.rows.length === 0) throw new Error('Cliente no encontrado');
        const cliente = clienteResult.rows[0];

        // Cotización
        const cotizacionFinal = await obtenerCotizacion(client, id_moneda, cotizacion);

        // Preparar items
        const itemsConPrecios = await prepararItemsConPrecios(client, items);

        // Calcular totales via helper
        const totales = pedidosHelper.calcularTotalesItems(itemsConPrecios, descuento_general, descuento_general_monto);

        let totalMonedaExtranjera = null;
        if (id_moneda !== 1 && cotizacionFinal) {
            totalMonedaExtranjera = parseFloat((totales.total_final / cotizacionFinal).toFixed(2));
        }

        // Crear pedido via helper (estado Pendiente)
        const pedido = await pedidosHelper.crearPedido(client, {
            id_empresa,
            id_usuario,
            id_cliente,
            id_estado: pedidosHelper.PEDIDO_ESTADOS.PENDIENTE,
            id_moneda,
            cotizacion: cotizacionFinal,
            tipo_entrega,
            observaciones,
            domicilio_entrega: domicilio_entrega || cliente.domicilio,
            fecha_entrega_pactada,
            estado_entrega: 'pendiente',
            descuento_general,
            total_moneda_extranjera: totalMonedaExtranjera,
            totales
        });

        const id_pedido = pedido.id_pedido;

        // Crear items via helper (sin descontar stock, cantidad_entregada = 0)
        await pedidosHelper.crearItems(client, id_pedido, id_empresa,
            totales.items.map(i => ({
                ...i,
                cantidad_entregada: 0
            }))
        );

        // Procesar pagos
        await procesarPagos(client, {
            pagos, id_empresa, id_pedido, id_usuario, id_cliente,
            concepto_prefijo: 'Pedido - A entregar'
        });

        await client.query('COMMIT');

        res.json({
            success: true,
            id_pedido,
            mensaje: 'Pedido guardado para entregar',
            totales: {
                subtotal_sin_iva: totales.subtotal_sin_iva,
                descuento: totales.descuento_monto,
                iva: totales.total_iva,
                total: totales.total_final
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === 'CAJA_CERRADA') {
            return res.status(400).json({ error: error.message, code: error.code });
        }
        console.error('Error en guardarParaEntregar:', error);
        res.status(500).json({ error: error.message || 'Error al guardar pedido' });
    } finally {
        client.release();
    }
}

/**
 * Obtener pedidos suspendidos (estado 8)
 */
async function getSuspendidos(req, res) {
    try {
        const { id_empresa } = req.usuario;

        const result = await pool.query(`
            SELECT p.id_pedido, p.fecha_creacion, p.total_final as total,
                   COALESCE(c.razon_social, 'Sin cliente') as cliente,
                   m.codigo as moneda,
                   (SELECT COUNT(*) FROM pedidoitems WHERE id_pedido = p.id_pedido) as cant_items
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN monedas m ON p.id_moneda = m.id_moneda
            WHERE p.id_empresa = $1 AND p.id_estado = $2
            ORDER BY p.fecha_creacion DESC
        `, [id_empresa, pedidosHelper.PEDIDO_ESTADOS.SUSPENDIDO]);

        res.json(result.rows);

    } catch (error) {
        console.error('Error en getSuspendidos:', error);
        res.status(500).json({ error: 'Error al obtener pedidos suspendidos' });
    }
}

/**
 * Recuperar pedido suspendido
 */
async function recuperarPedido(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const { id_empresa } = req.usuario;

        const pedidoResult = await client.query(`
            SELECT p.*, COALESCE(c.razon_social, 'Sin cliente') as razon_social, c.id_condicion_iva
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente AND c.id_empresa = p.id_empresa
            WHERE p.id_pedido = $1 AND p.id_empresa = $2 AND p.id_estado = $3
        `, [id, id_empresa, pedidosHelper.PEDIDO_ESTADOS.SUSPENDIDO]);

        if (pedidoResult.rows.length === 0) {
            throw new Error('Pedido no encontrado o no está suspendido');
        }

        const itemsResult = await client.query(`
            SELECT pi.*, p.nombre as producto_nombre
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
        `, [id, id_empresa]);

        // Cambiar estado a Borrador (-1) para que funcione como borrador activo
        await pedidosHelper.cambiarEstado(client, {
            id_pedido: parseInt(id),
            id_empresa,
            nuevo_estado: -1 // Estado borrador, no RECUPERADO (99)
        });

        await client.query('COMMIT');

        res.json({
            success: true,
            pedido: pedidoResult.rows[0],
            items: itemsResult.rows
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en recuperarPedido:', error);
        res.status(500).json({ error: error.message || 'Error al recuperar pedido' });
    } finally {
        client.release();
    }
}

/**
 * Obtener un pedido por ID
 */
async function getPedidoById(req, res) {
    try {
        const { id } = req.params;
        const { id_empresa } = req.usuario;

        const pedidoResult = await pool.query(`
            SELECT p.*, c.razon_social, c.cuit_cuil, c.id_condicion_iva,
                   c.domicilio as cliente_domicilio, c.telefono as cliente_telefono,
                   ci.nombre as condicion_iva, ci.discrimina_iva,
                   pe.nombre as estado_nombre,
                   m.codigo as moneda_codigo, m.simbolo as moneda_simbolo
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN monedas m ON p.id_moneda = m.id_moneda
            WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `, [id, id_empresa]);

        if (pedidoResult.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const itemsResult = await pool.query(`
            SELECT pi.*, p.nombre as producto_nombre, p.sku
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item
        `, [id]);

        // Pagos del pedido (para mostrar forma de pago en la nota) — lee de BD, no recalcula
        const pagosResult = await pool.query(`
            SELECT pg.monto, pg.cuotas, pg.coeficiente, pg.monto_original,
                   mp.nombre AS metodo_nombre
            FROM pagos pg
            LEFT JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago
            WHERE pg.id_pedido = $1 AND pg.id_empresa = $2
            ORDER BY pg.id_pago
        `, [id, id_empresa]);

        res.json({
            ...pedidoResult.rows[0],
            items: itemsResult.rows,
            pagos: pagosResult.rows
        });

    } catch (error) {
        console.error('Error en getPedidoById:', error);
        res.status(500).json({ error: 'Error al obtener pedido' });
    }
}

/**
 * Listar pedidos con filtros
 */
async function getPedidos(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { estado, desde, hasta, cliente, limit = 50 } = req.query;

        let query = `
            SELECT p.id_pedido, p.fecha_creacion, p.total_final as total,
                   p.id_estado, pe.nombre as estado,
                   p.tipo_entrega, p.estado_entrega,
                   c.razon_social as cliente,
                   m.codigo as moneda, p.total_moneda_extranjera
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN monedas m ON p.id_moneda = m.id_moneda
            WHERE p.id_empresa = $1
        `;

        const params = [id_empresa];
        let paramIndex = 2;

        if (estado) {
            query += ` AND p.id_estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        if (desde) {
            query += ` AND p.fecha_creacion >= $${paramIndex}`;
            params.push(desde);
            paramIndex++;
        }

        if (hasta) {
            query += ` AND p.fecha_creacion <= $${paramIndex}`;
            params.push(hasta);
            paramIndex++;
        }

        if (cliente) {
            query += ` AND c.razon_social ILIKE $${paramIndex}`;
            params.push(`%${cliente}%`);
            paramIndex++;
        }

        query += ` ORDER BY p.fecha_creacion DESC LIMIT $${paramIndex}`;
        params.push(limit);

        const result = await pool.query(query, params);
        res.json(result.rows);

    } catch (error) {
        console.error('Error en getPedidos:', error);
        res.status(500).json({ error: 'Error al listar pedidos' });
    }
}

/**
 * Suspender pedido — estado 8 (Suspendido)
 */
async function suspenderPedido(req, res) {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const { id_empresa, id_usuario } = req.usuario;
        const { id_cliente, items, observaciones = 'Suspendido' } = req.body;

        if (!items || items.length === 0) {
            throw new Error('No hay items para suspender');
        }

        // Preparar items para cálculo — IVA real por producto (sin hardcode)
        // Fallback: alícuota por defecto de la empresa (config productos.alicuota_iva_defecto)
        const idsProductos = items.map(it => it.id_producto).filter(Boolean);
        const ivaMap = await ivaHelper.obtenerIvaProductosBatch(client, idsProductos);
        const alicuotaDefecto = await ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa);
        const itemsParaCalculo = items.map(item => {
            const ivaInfo = ivaMap.get(item.id_producto);
            const ivaPorcentaje = (ivaInfo && !ivaInfo.error && ivaInfo.porcentaje != null)
                ? ivaInfo.porcentaje
                : parseFloat(alicuotaDefecto.porcentaje);
            return {
                id_producto: item.id_producto,
                cantidad: item.cantidad || 1,
                precio_unitario: item.precio_unitario_congelado || 0,
                iva_aplicado: ivaPorcentaje,
                porcentaje_descuento: item.descuento_porcentaje || 0
            };
        });

        // Calcular totales via helper (FIX: antes tenía 7 VALUES para 9 columnas)
        const totales = pedidosHelper.calcularTotalesItems(itemsParaCalculo);

        // Crear pedido con estado Suspendido via helper
        const pedido = await pedidosHelper.crearPedido(client, {
            id_empresa,
            id_usuario,
            id_cliente: id_cliente,
            id_estado: pedidosHelper.PEDIDO_ESTADOS.SUSPENDIDO,
            observaciones,
            totales
        });

        // Crear items via helper
        await pedidosHelper.crearItems(client, pedido.id_pedido, id_empresa,
            totales.items.map(i => ({
                id_producto: i.id_producto,
                cantidad: parseFloat(i.cantidad) || 1,
                precio_unitario_congelado: i.precio_unitario_congelado,
                porcentaje_descuento: i.porcentaje_descuento,
                monto_iva: i.monto_iva,
                total_linea: i.total_linea,
                iva_aplicado: i.iva_aplicado
            }))
        );

        await client.query('COMMIT');

        res.json({
            success: true,
            id_pedido: pedido.id_pedido,
            mensaje: 'Pedido suspendido'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error suspendiendo:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * Obtener pedidos pendientes de cobro (con saldo en cuenta corriente)
 */
async function obtenerPendientesCobro(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { id_cliente } = req.query;

        let query = `
            SELECT DISTINCT
                p.id_pedido,
                p.fecha_creacion,
                p.total_final,
                c.id_cliente,
                c.razon_social,
                c.cuit_cuil,
                COALESCE(sp.saldo, 0) AS saldo_pendiente
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN pedidoestados pe ON pe.id_estado = p.id_estado
            LEFT JOIN v_saldo_pedidos sp ON sp.id_pedido = p.id_pedido
            WHERE p.id_empresa = $1
              AND p.es_fiado = true
              AND pe.computa_deuda = true
              AND COALESCE(sp.saldo, 0) > 0.01
        `;

        const params = [id_empresa];

        if (id_cliente) {
            query += ` AND c.id_cliente = $2`;
            params.push(parseInt(id_cliente));
        }

        query += ` ORDER BY p.fecha_creacion ASC`;

        const result = await pool.query(query, params);
        const pendientes = result.rows;
        res.json(pendientes);

    } catch (error) {
        console.error("Error en obtenerPendientesCobro:", error);
        res.status(500).json({ error: "Error al obtener pedidos pendientes", detalle: error.message });
    }
}



// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS EDICION POST-VENTA (via pedidos-edicion.helper.js)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/pedidos/:id/detalle — Detalle completo con documentos relacionados
 */
async function obtenerDetalle(req, res) {
    try {
        const { id } = req.params;
        const { id_empresa } = req.usuario;

        // Pedido + cliente + vendedor
        const pedidoRes = await pool.query(`
            SELECT p.*,
                   c.razon_social AS cliente, c.cuit_cuil, c.domicilio AS domicilio_cliente,
                   c.telefono, c.email, c.id_condicion_iva,
                   ci.nombre AS condicion_iva,
                   pe.nombre AS estado_nombre,
                   u.nombre AS vendedor, u.username AS vendedor_user,
                   m.codigo AS moneda_codigo, m.simbolo AS moneda_simbolo,
                   fp.nombre AS forma_pago_nombre
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            LEFT JOIN monedas m ON p.id_moneda = m.id_moneda
            LEFT JOIN formas_pago fp ON p.id_forma_pago_principal = fp.id_forma_pago
            WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `, [id, id_empresa]);

        if (pedidoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        const pedido = pedidoRes.rows[0];

        // Items
        const itemsRes = await pool.query(`
            SELECT pi.*, pr.nombre AS producto_nombre, pr.sku
            FROM pedidoitems pi
            JOIN productos pr ON pi.id_producto = pr.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item
        `, [id]);

        // Pagos
        const pagosRes = await pool.query(`
            SELECT pg.*, mp.nombre AS metodo_nombre, pes.nombre AS estado_nombre
            FROM pagos pg
            JOIN metodosdepago mp ON pg.id_metodo_pago = mp.id_metodo_pago
            JOIN pagoestados pes ON pg.id_pago_estado = pes.id_pago_estado
            WHERE pg.id_pedido = $1 ORDER BY pg.fecha_pago
        `, [id]);

        // Confirmaciones
        const confRes = await pool.query(`
            SELECT cp.*, u.nombre AS confirmado_por_nombre
            FROM confirmaciones_pago cp
            LEFT JOIN usuarios u ON cp.id_usuario_confirma = u.id_usuario
            WHERE cp.id_pedido = $1 ORDER BY cp.fecha_confirmacion DESC
        `, [id]);

        // Factura
        const facturaRes = await pool.query(`
            SELECT id_factura, numero_completo, estado, total, cae, fecha_emision, cae_vencimiento
            FROM facturas WHERE id_pedido = $1 AND id_empresa = $2 AND estado != 'anulada' LIMIT 1
        `, [id, id_empresa]);

        // Presupuesto
        const presupRes = await pool.query(`
            SELECT id_presupuesto, numero_completo, estado, total, fecha_emision
            FROM presupuestos WHERE id_pedido = $1 AND id_empresa = $2 AND estado NOT IN ('rechazado') LIMIT 1
        `, [id, id_empresa]);

        // Remitos
        const remitosRes = await pool.query(`
            SELECT id_remito, estado, total, fecha_emision
            FROM remitos WHERE id_pedido = $1 AND id_empresa = $2 ORDER BY id_remito DESC
        `, [id, id_empresa]);

        // Notas C/D
        const notasRes = await pool.query(`
            SELECT id_nota, tipo_nota, numero_completo, estado, total, fecha_emision
            FROM notas_credito_debito WHERE id_pedido = $1 AND id_empresa = $2 ORDER BY id_nota DESC
        `, [id, id_empresa]);

        // Historial de modificaciones
        const historial = await pedidosHelper.obtenerHistorialPedido(pool, parseInt(id), id_empresa);

        // Calcular permisos
        const totalPagado = pagosRes.rows.filter(p => p.id_pago_estado === 2).reduce((s, p) => s + parseFloat(p.monto || 0), 0);
        const totalConfirmado = confRes.rows.filter(c => c.estado === 'confirmado').reduce((s, c) => s + parseFloat(c.monto || 0), 0);
        const totalFiado = pedido.es_fiado ? parseFloat(pedido.total_final || pedido.total) - totalPagado : 0;
        const facturado = facturaRes.rows.length > 0;
        const presupuestado = presupRes.rows.length > 0 && !['rechazado','anulado'].includes((presupRes.rows[0].estado||''));
        const tieneRemitoActivo = remitosRes.rows.some(r => !['anulado','cancelado','no_entregado'].includes(r.estado||''));
        const puede_editar = !facturado && !presupuestado && !tieneRemitoActivo;
        const puede_anular = !facturado && !presupuestado && !tieneRemitoActivo;

        res.json({
            ...pedido,
            items: itemsRes.rows,
            pagos: pagosRes.rows,
            confirmaciones: confRes.rows,
            factura: facturaRes.rows[0] || null,
            presupuesto: presupRes.rows[0] || null,
            remitos: remitosRes.rows,
            notas: notasRes.rows,
            historial_modificaciones: historial,
            resumen_pago: {
                total_pagado: totalPagado,
                total_real: totalPagado - totalFiado,
                total_fiado: totalFiado,
                total_confirmado: totalConfirmado
            },
            permisos: { puede_editar, puede_anular, facturado }
        });
    } catch (error) {
        console.error('Error en obtenerDetalle:', error);
        res.status(500).json({ error: 'Error al obtener detalle del pedido' });
    }
}

/**
 * PUT /api/pedidos/:id/items/:id_item — Editar cantidad de item
 */
async function editarItem(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id, id_item } = req.params;
        const { id_empresa, id_usuario, rol } = req.usuario;
        const { cantidad } = req.body;

        if (rol !== 'admin' && rol !== 'administrador') {
            return res.status(403).json({ error: 'Solo administradores pueden modificar pedidos' });
        }
        if (!cantidad || parseFloat(cantidad) <= 0) {
            return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });
        }

        const resultado = await edicionHelper.editarItem(client, {
            id_pedido: parseInt(id),
            id_item: parseInt(id_item),
            id_empresa,
            id_usuario,
            nueva_cantidad: parseFloat(cantidad)
        });

        // Log en pedidos_log
        await pedidosHelper.registrarLogPedido(client, {
            id_pedido: parseInt(id), id_empresa, id_usuario,
            accion: pedidosHelper.LOG_PEDIDO_ACCIONES.ITEM_EDITADO,
            detalle_antes: { id_item: parseInt(id_item), cantidad_anterior: resultado.cantidad_anterior },
            detalle_despues: { id_item: parseInt(id_item), nueva_cantidad: parseFloat(cantidad) },
            ip_origen: req.ip
        });

        await client.query('COMMIT');
        res.json(resultado);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en editarItem:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * DELETE /api/pedidos/:id/items/:id_item — Eliminar item del pedido
 */
async function eliminarItemPedido(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id, id_item } = req.params;
        const { id_empresa, id_usuario, rol } = req.usuario;

        if (rol !== 'admin' && rol !== 'administrador') {
            return res.status(403).json({ error: 'Solo administradores pueden modificar pedidos' });
        }

        const resultado = await edicionHelper.eliminarItemPedido(client, {
            id_pedido: parseInt(id),
            id_item: parseInt(id_item),
            id_empresa,
            id_usuario
        });

        // Log en pedidos_log
        await pedidosHelper.registrarLogPedido(client, {
            id_pedido: parseInt(id), id_empresa, id_usuario,
            accion: pedidosHelper.LOG_PEDIDO_ACCIONES.ITEM_ELIMINADO,
            detalle_antes: { id_item: parseInt(id_item), producto: resultado.producto_eliminado, cantidad: resultado.cantidad_eliminada },
            ip_origen: req.ip
        });

        await client.query('COMMIT');
        res.json(resultado);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en eliminarItemPedido:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * PUT /api/pedidos/:id/anular — Anular pedido completo
 */
async function anularPedido(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { id_empresa, id_usuario, rol } = req.usuario;

        if (rol !== 'admin' && rol !== 'administrador') {
            return res.status(403).json({ error: 'Solo administradores pueden anular pedidos' });
        }

        const resultado = await edicionHelper.anularPedidoCompleto(client, {
            id_pedido: parseInt(id),
            id_empresa,
            id_usuario
        });

        // Log en pedidos_log
        await pedidosHelper.registrarLogPedido(client, {
            id_pedido: parseInt(id), id_empresa, id_usuario,
            accion: pedidosHelper.LOG_PEDIDO_ACCIONES.ANULADO,
            detalle_antes: { estado_anterior: 'activo' },
            detalle_despues: { estado: 'anulado', stock_devuelto: resultado.stock_devuelto, credito_cc: resultado.totalDevueltoCC },
            ip_origen: req.ip
        });

        await client.query('COMMIT');
        res.json(resultado);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en anularPedido:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * POST /api/pedidos/:id/registrar-sobrepago — Registrar saldo a favor en CC
 * Se llama DESPUÉS de que el usuario confirma en el frontend
 */
async function registrarSobrepago(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id } = req.params;
        const { id_empresa, id_usuario } = req.usuario;
        const { monto, id_cliente } = req.body;

        if (!monto || parseFloat(monto) <= 0) {
            return res.status(400).json({ error: 'Monto inválido' });
        }
        if (!id_cliente) {
            return res.status(400).json({ error: 'id_cliente requerido' });
        }

        const resultado = await edicionHelper.registrarSobrepagoCC(client, {
            id_empresa,
            id_cliente: parseInt(id_cliente),
            id_pedido: parseInt(id),
            monto: parseFloat(monto),
            id_usuario
        });

        await client.query('COMMIT');
        res.json({ success: true, message: `Saldo a favor de $${monto} registrado`, ...resultado });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en registrarSobrepago:', error);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * GET /api/pedidos/:id/historial — Historial de modificaciones
 */
async function obtenerHistorial(req, res) {
    try {
        const { id } = req.params;
        const { id_empresa } = req.usuario;
        const historial = await edicionHelper.obtenerHistorialModificaciones(pool.query.bind(pool), parseInt(id), id_empresa);
        res.json(historial);
    } catch (error) {
        console.error('Error en obtenerHistorial:', error);
        res.status(500).json({ error: error.message });
    }
}


async function actualizarCamposPedido(req, res) {
    const { id_empresa } = req.usuario;
    const { id } = req.params;
    const { campos } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Obtener estado antes del cambio
        const antes = await client.query('SELECT tipo_entrega, observaciones FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2', [id, id_empresa]);
        const pedido = await pedidosHelper.actualizarCampos(client, {
            id_pedido: id, id_empresa, campos
        });
        // Log si cambió tipo_entrega
        if (campos.tipo_entrega && antes.rows.length > 0 && antes.rows[0].tipo_entrega !== campos.tipo_entrega) {
            await pedidosHelper.registrarLogPedido(client, {
                id_pedido: parseInt(id), id_empresa, id_usuario: req.usuario.id_usuario,
                accion: 'TIPO_ENTREGA_CAMBIADO',
                detalle_antes: { tipo_entrega: antes.rows[0].tipo_entrega },
                detalle_despues: { tipo_entrega: campos.tipo_entrega },
                ip_origen: req.ip
            });
        }
        // Log si cambió observaciones
        if (campos.observaciones !== undefined && antes.rows.length > 0 && (antes.rows[0].observaciones || '') !== (campos.observaciones || '')) {
            await pedidosHelper.registrarLogPedido(client, {
                id_pedido: parseInt(id), id_empresa, id_usuario: req.usuario.id_usuario,
                accion: 'OBSERVACIONES_EDITADAS',
                detalle_antes: { observaciones: antes.rows[0].observaciones },
                detalle_despues: { observaciones: campos.observaciones },
                ip_origen: req.ip
            });
        }
        await client.query('COMMIT');
        res.json({ success: true, pedido });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizarCamposPedido:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS (limpiados — sin duplicados)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// HISTORIAL VENTAS PRODUCTO → CLIENTE (para venta-rapida)
// ═══════════════════════════════════════════════════════
async function historialProductoCliente(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.query.id_producto, 10);
        const id_cliente  = req.query.id_cliente ? parseInt(req.query.id_cliente, 10) : null;
        const todosEstados = String(req.query.todos_estados || '').toLowerCase() === 'true';
        if (!id_producto || isNaN(id_producto)) return res.status(400).json({ error: 'id_producto requerido' });

        // ── Modo amplio: pedidos en cualquier estado + NCs/NDs sobre ese producto+cliente ──
        if (todosEstados) {
            if (!id_cliente || isNaN(id_cliente)) return res.status(400).json({ error: 'id_cliente requerido en modo todos_estados' });
            const unionQ = `
                SELECT 'venta'::text AS tipo,
                       p.id_pedido AS id_documento,
                       COALESCE(p.nro_pedido::text, p.id_pedido::text) AS numero,
                       p.fecha_creacion AS fecha,
                       pi.cantidad,
                       pi.cantidad_entregada,
                       pi.precio_unitario_congelado AS precio_unitario,
                       pi.iva_aplicado AS iva_porcentaje,
                       pi.total_linea AS total,
                       pe.nombre AS detalle,
                       p.id_estado AS estado_codigo
                  FROM pedidoitems pi
                  JOIN pedidos p          ON p.id_pedido  = pi.id_pedido
                  JOIN pedidoestados pe   ON pe.id_estado = p.id_estado
                 WHERE pi.id_producto = $1 AND p.id_empresa = $2 AND p.id_cliente = $3
                UNION ALL
                SELECT CASE WHEN n.tipo_nota = 'credito' THEN 'nc' ELSE 'nd' END AS tipo,
                       n.id_nota AS id_documento,
                       n.numero_completo AS numero,
                       n.fecha_emision AS fecha,
                       ni.cantidad,
                       NULL::numeric AS cantidad_entregada,
                       ni.precio_unitario,
                       ni.iva_porcentaje,
                       ni.total,
                       (CASE WHEN n.tipo_nota = 'credito' THEN 'NC ' ELSE 'ND ' END
                        || UPPER(n.estado)) AS detalle,
                       NULL::integer AS estado_codigo
                  FROM nota_items ni
                  JOIN notas_credito_debito n ON n.id_nota = ni.id_nota
                 WHERE ni.id_producto = $1 AND n.id_empresa = $2 AND n.id_cliente = $3
                 ORDER BY fecha DESC NULLS LAST
                 LIMIT 30`;
            const { rows } = await pool.query(unionQ, [id_producto, id_empresa, id_cliente]);
            return res.json(rows);
        }

        // ── Modo legacy (para venta-rapida): solo ventas confirmadas ──
        let query = `
            SELECT p.id_pedido, p.nro_pedido, p.fecha_creacion,
                   pi.cantidad, pi.precio_unitario_congelado, pi.iva_aplicado, pi.total_linea,
                   c.razon_social as cliente_nombre
            FROM pedidoitems pi
            JOIN pedidos p ON pi.id_pedido = p.id_pedido
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            WHERE pi.id_producto = $1 AND p.id_empresa = $2
              AND p.id_estado IN (2,3,4,5,6)
        `;
        const params = [id_producto, id_empresa];
        if (id_cliente && !isNaN(id_cliente)) {
            query += ' AND p.id_cliente = $3';
            params.push(id_cliente);
        }
        query += ' ORDER BY p.fecha_creacion DESC LIMIT 20';

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error historialProductoCliente:', error);
        res.status(500).json({ error: 'Error al buscar historial' });
    }
}


/**
 * GET /pedidos/:id/evaluar-anulacion
 */
async function evaluarAnulacionCtl(req, res) {
    const { id_empresa, rol } = req.usuario;
    const id_pedido = parseInt(req.params.id, 10);
    const motivo    = req.query.motivo;
    const client = await pool.connect();
    try {
        const resultado = await anulacionHelper.evaluarAnulacion(client, {
            id_pedido, id_empresa, motivo, rol
        });
        res.json(resultado);
    } catch (error) {
        console.error('Error en evaluarAnulacionCtl:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    } finally {
        client.release();
    }
}

/**
 * POST /pedidos/:id/anular-cascada
 * Body: { motivo: string }
 */
async function anularCascadaCtl(req, res) {
    const { id_empresa, id_usuario, rol } = req.usuario;
    const id_pedido = parseInt(req.params.id, 10);
    const { motivo } = req.body || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await anulacionHelper.anularEnCascada(client, {
            id_pedido, id_empresa, id_usuario, motivo, rol, ip: req.ip
        });
        await client.query('COMMIT');
        res.json(resultado);
    } catch (error) {
        await client.query('ROLLBACK').catch(()=>{});
        console.error('Error en anularCascadaCtl:', error);
        const status = error.statusCode || 500;
        const body = { error: error.message };
        if (error.bloqueos) body.bloqueos = error.bloqueos;
        res.status(status).json(body);
    } finally {
        client.release();
    }
}

module.exports = {
    historialProductoCliente,
    suspenderPedido,
    obtenerDatos: getData,
    obtenerSuspendidos: getSuspendidos,
    obtenerPorId: getPedidoById,
    recuperarSuspendido: recuperarPedido,
    listar: getPedidos,
    crearRetiroInmediato,
    guardarParaEntregar,
    obtenerPendientesCobro,
    obtenerDetalle,
    editarItem,
    eliminarItemPedido,
    anularPedido,
    registrarSobrepago,
    obtenerHistorial,
    actualizarCamposPedido,
    evaluarAnulacion: evaluarAnulacionCtl,
    anularCascada:    anularCascadaCtl
};
