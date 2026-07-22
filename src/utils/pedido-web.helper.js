/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PEDIDO-WEB HELPER — ERP LAGO
 * Conversion carrito -> pedido + ciclo de vida del pedido web
 * ═══════════════════════════════════════════════════════════════════════════
 * TABLAS: pedidos, pedidoitems, carritos_web, carritos_web_items, productos, alicuotasiva
 * CONSUMIDORES: pedidos-web-cliente.controller.js, pedidos-web-admin.controller.js
 *
 * REGLAS:
 *  - Carrito -> pedido en estado 20 (Web Pendiente Revision). NO descuenta stock.
 *  - Precios se RECALCULAN contra la lista vigente del cliente al convertir
 *    (no se confia en el snapshot del carrito por seguridad).
 *  - IVA por producto via productos.id_alicuota_iva -> alicuotasiva.porcentaje
 *  - Cliente puede modificar el pedido mientras id_estado <= web.permitir_modificar_pedido_hasta_estado
 *  - aprobarPedidoWeb pasa de 20 -> 1 (Pendiente). El flujo POS se hace cargo despues.
 *  - rechazarPedidoWeb pasa de 20 -> -2 (Descartado).
 *  - cancelarPedidoWeb (cliente) pasa de 20 -> 7 (Cancelado).
 *  - Todas las funciones reciben `client` (transaccion abierta en el controller).
 */

const cfg     = require('./config.helper');
const carrito = require('./carrito-web.helper');
const pedidosHelper = require('./pedidos.helper');
const notificaciones = require('./notificaciones.helper');

// ─────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS DE CALCULO
// ─────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el porcentaje de IVA de un producto, o el default configurado.
 * Hace una sola query.
 */
async function _obtenerIvaProducto(client, id_empresa, id_producto) {
    const r = await client.query(`
        SELECT COALESCE(a.porcentaje, 21.00) AS porcentaje
          FROM productos p
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE p.id_producto = $1
         LIMIT 1
    `, [id_producto]);
    if (!r.rows.length) {
        const def = await cfg.get(client, id_empresa, 'web.iva_default_porcentaje', 21);
        return Number(def);
    }
    return Number(r.rows[0].porcentaje);
}

/**
 * Dado un precio NETO (sin IVA, como esta en tabla `precios`) y la alicuota,
 * devuelve neto/iva/total para la linea. Convencion LAGO confirmada:
 * `precios.precio` esta SIN IVA. El final se calcula como neto * (1 + iva/100).
 */
function _desglosarLineaConIva(precioNeto, cantidad, ivaPct) {
    const neto  = Number(precioNeto);
    const cant  = Number(cantidad);
    const iva   = Number(ivaPct);
    const factor = 1 + iva / 100;
    const final  = Math.round(neto * factor * 100) / 100;

    const netoLinea  = neto * cant;
    const totalLinea = final * cant;
    const ivaLinea   = totalLinea - netoLinea;

    return {
        precio_unitario_neto:  Math.round(neto * 10000) / 10000,
        precio_unitario_final: Math.round(final * 10000) / 10000,
        neto_linea:  Math.round(netoLinea * 100) / 100,
        iva_linea:   Math.round(ivaLinea * 100) / 100,
        total_linea: Math.round(totalLinea * 100) / 100
    };
}

/**
 * Proximo nro_pedido por empresa (mismo patron que el resto del ERP).
 */
async function _proximoNroPedido(client, id_empresa) {
    const r = await client.query(`
        SELECT COALESCE(MAX(nro_pedido), 0) + 1 AS siguiente
          FROM pedidos
         WHERE id_empresa = $1
    `, [id_empresa]);
    return r.rows[0].siguiente;
}

// ─────────────────────────────────────────────────────────────────────────
// CONVERSION CARRITO -> PEDIDO (estado 20)
// ─────────────────────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {number} args.id_empresa
 * @param {number} args.id_cliente            (REQUERIDO: anonimos no pueden hacer checkout)
 * @param {number} args.id_carrito
 * @param {string} args.tipo_entrega          'retiro' | 'envio'
 * @param {string} args.domicilio_entrega
 * @param {string} args.observaciones
 */
async function convertirCarritoEnPedido(client, args) {
    const { id_empresa, id_cliente, id_carrito,
            tipo_entrega = null, domicilio_entrega = null, observaciones = null } = args;

    if (!id_empresa || !id_cliente || !id_carrito) {
        throw new Error('convertirCarritoEnPedido: id_empresa, id_cliente e id_carrito requeridos');
    }

    // 1. Bloqueo de fila del carrito
    const cab = await client.query(`
        SELECT id_carrito, id_empresa, id_cliente, estado
          FROM carritos_web
         WHERE id_carrito = $1 AND id_empresa = $2
         FOR UPDATE
    `, [id_carrito, id_empresa]);
    if (!cab.rows.length)              throw new Error('Carrito no encontrado');
    if (cab.rows[0].estado !== 'activo') throw new Error('Carrito no esta activo');
    if (cab.rows[0].id_cliente && cab.rows[0].id_cliente !== id_cliente) {
        throw new Error('Carrito no pertenece a este cliente');
    }

    // 2. Resolver lista de precio del cliente (no la publica)
    const id_lista = await carrito._resolverListaPrecio(client, id_empresa, id_cliente);

    // 3. Items del carrito
    const items = await client.query(`
        SELECT id_item, id_producto, cantidad
          FROM carritos_web_items
         WHERE id_carrito = $1
         ORDER BY fecha_agregado ASC
    `, [id_carrito]);
    if (!items.rows.length) throw new Error('El carrito esta vacio');

    // 4. Validaciones globales
    const permitirSinStock = await cfg.get(client, id_empresa, 'web.permitir_vender_sin_stock', false);
    const pedidoMinimo     = Number(await cfg.get(client, id_empresa, 'web.pedido_minimo', 0));
    const tipoEntregaDef   = await cfg.get(client, id_empresa, 'web.tipo_entrega_default', 'retiro');
    const tipoEntregaFinal = tipo_entrega || tipoEntregaDef;

    // 5. Recalcular cada linea contra precios y stock vigentes
    const lineasCalculadas = [];
    let subtotal_sin_iva = 0;
    let total_iva        = 0;
    let total_final      = 0;

    for (const it of items.rows) {
        // Producto + descripcion + iva en una sola query
        const prodQ = await client.query(`
            SELECT p.id_producto, p.nombre, p.activo, p.visible_web,
                   COALESCE(a.porcentaje, 21.00) AS iva_pct
              FROM productos p
              LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
             WHERE p.id_producto = $1
             LIMIT 1
        `, [it.id_producto]);
        if (!prodQ.rows.length || !prodQ.rows[0].activo || !prodQ.rows[0].visible_web) {
            throw new Error('Producto no disponible: ' + it.id_producto);
        }
        const prod = prodQ.rows[0];

        // Precio vigente CON IVA (helper centralizado)
        const precioInfo = await carrito._obtenerPrecioConIva(client, id_empresa, it.id_producto, id_lista);
        if (!precioInfo) throw new Error('Sin precio vigente: ' + prod.nombre);

        // Stock
        if (!permitirSinStock) {
            const stock = await carrito._obtenerStock(client, id_empresa, it.id_producto);
            if (stock < Number(it.cantidad)) {
                throw new Error('Stock insuficiente: ' + prod.nombre + ' (disp: ' + stock + ')');
            }
        }

        // _desglosarLineaConIva espera NETO (precioInfo.neto), no final
        const desglose = _desglosarLineaConIva(precioInfo.neto, it.cantidad, precioInfo.iva_pct);
        subtotal_sin_iva += desglose.neto_linea;
        total_iva        += desglose.iva_linea;
        total_final      += desglose.total_linea;

        lineasCalculadas.push({
            id_producto: prod.id_producto,
            descripcion: prod.nombre,
            cantidad:    Number(it.cantidad),
            iva_pct:     prod.iva_pct,
            ...desglose
        });
    }

    subtotal_sin_iva = Math.round(subtotal_sin_iva * 100) / 100;
    total_iva        = Math.round(total_iva * 100) / 100;
    total_final      = Math.round(total_final * 100) / 100;

    // 6. Pedido minimo
    if (pedidoMinimo > 0 && total_final < pedidoMinimo) {
        throw new Error('El pedido minimo es $' + pedidoMinimo + '. Actual: $' + total_final);
    }

    // 7. Insertar pedido (estado inicial configurable - vendibilidad)
    const nroPedido = await _proximoNroPedido(client, id_empresa);
    const estadoInicial = parseInt(
        await cfg.get(client, id_empresa, 'web.estado_pedido_inicial', 20), 10
    );

    const insP = await client.query(`
        INSERT INTO pedidos (
            id_empresa, id_cliente, id_estado,
            fecha_creacion, total, total_final,
            subtotal_sin_iva, total_iva, subtotal_con_descuento,
            tipo_entrega, domicilio_entrega, observaciones,
            estado_entrega, descuento_general, descuento_monto,
            descuento_fp_porcentaje, descuento_fp_monto,
            nro_pedido,
            id_carrito_web, origen
        ) VALUES (
            $1, $2, $10,
            NOW(), $3, $3,
            $4, $5, $4,
            $6, $7, $8,
            'pendiente', 0, 0,
            0, 0,
            $9,
            $11, 'web'
        )
        RETURNING id_pedido, nro_pedido, total_final, fecha_creacion, id_estado
    `, [
        id_empresa, id_cliente,
        total_final, subtotal_sin_iva, total_iva,
        tipoEntregaFinal, domicilio_entrega, observaciones,
        nroPedido,
        estadoInicial, id_carrito
    ]);
    const pedido = insP.rows[0];

    // 8. Insertar items via helper centralizado (pedidosHelper.crearItems)
    await pedidosHelper.crearItems(client, pedido.id_pedido, id_empresa,
        lineasCalculadas.map(ln => ({
            id_producto: ln.id_producto,
            cantidad: ln.cantidad,
            descripcion: ln.descripcion,
            precio_unitario_congelado: ln.precio_unitario_neto,
            iva_aplicado: ln.iva_pct,
            monto_iva: ln.iva_linea,
            total_linea: ln.total_linea,
            porcentaje_descuento: 0
        }))
    );

    // 9. Marcar carrito como convertido
    await client.query(`
        UPDATE carritos_web
           SET estado = 'convertido',
               fecha_conversion = NOW(),
               id_pedido_generado = $1
         WHERE id_carrito = $2
    `, [pedido.id_pedido, id_carrito]);

    // 10. Notificar al admin (notificar() nunca throw; no bloquea la operacion)
    try {
        const cliQ = await client.query(
            'SELECT razon_social, email FROM clientes WHERE id_cliente=$1 AND id_empresa=$2',
            [id_cliente, id_empresa]
        );
        const cli = cliQ.rows[0] || {};
        await notificaciones.notificar(client, {
            id_empresa,
            evento: 'pedido_web_nuevo',
            contexto: {
                id_pedido: pedido.id_pedido,
                nro_pedido: pedido.nro_pedido,
                id_carrito_web: id_carrito,
                id_cliente,
                cliente_nombre: cli.razon_social || '(sin nombre)',
                cliente_email:  cli.email || '',
                total_final: pedido.total_final,
                cant_items: lineasCalculadas.length,
                tipo_entrega: tipoEntregaFinal,
                domicilio_entrega,
                observaciones
            }
        });
    } catch (e) {
        console.error('notificacion pedido_web_nuevo fallo:', e.message);
    }

    return {
        ...pedido,
        cant_items: lineasCalculadas.length,
        subtotal_sin_iva,
        total_iva
    };
}

// ─────────────────────────────────────────────────────────────────────────
// CONSULTA: cliente ve sus pedidos
// ─────────────────────────────────────────────────────────────────────────

async function listarPedidosCliente(client, id_empresa, id_cliente, opciones = {}) {
    const { limit = 20, offset = 0 } = opciones;
    const r = await client.query(`
        SELECT p.id_pedido, p.nro_pedido, p.id_estado, pe.nombre AS estado_nombre,
               p.fecha_creacion, p.total_final, p.tipo_entrega, p.domicilio_entrega,
               (SELECT COUNT(*) FROM pedidoitems pi WHERE pi.id_pedido = p.id_pedido) AS cant_items
          FROM pedidos p
          JOIN pedidoestados pe ON pe.id_estado = p.id_estado
         WHERE p.id_empresa = $1
           AND p.id_cliente = $2
           AND p.id_estado >= 0
         ORDER BY p.fecha_creacion DESC
         LIMIT $3 OFFSET $4
    `, [id_empresa, id_cliente, limit, offset]);
    return r.rows;
}

async function obtenerPedidoCliente(client, id_empresa, id_cliente, id_pedido) {
    const cab = await client.query(`
        SELECT p.id_pedido, p.nro_pedido, p.id_estado, pe.nombre AS estado_nombre,
               p.fecha_creacion, p.total_final, p.subtotal_sin_iva, p.total_iva,
               p.tipo_entrega, p.domicilio_entrega, p.observaciones
          FROM pedidos p
          JOIN pedidoestados pe ON pe.id_estado = p.id_estado
         WHERE p.id_empresa = $1 AND p.id_cliente = $2 AND p.id_pedido = $3
         LIMIT 1
    `, [id_empresa, id_cliente, id_pedido]);
    if (!cab.rows.length) return null;

    const items = await client.query(`
        SELECT pi.id_item, pi.id_producto, pi.descripcion_congelada,
               pi.cantidad, pi.precio_unitario_final, pi.iva_aplicado,
               pi.monto_iva, pi.total_linea,
               p.url_imagen
          FROM pedidoitems pi
          JOIN productos p ON p.id_producto = pi.id_producto
         WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
         ORDER BY pi.id_item ASC
    `, [id_pedido, id_empresa]);

    return { ...cab.rows[0], items: items.rows };
}

// ─────────────────────────────────────────────────────────────────────────
// MODIFICACION DEL PEDIDO POR EL CLIENTE (mientras estado <= limite)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verifica que el pedido sea modificable por el cliente segun config.
 */
async function _verificarModificable(client, id_empresa, id_cliente, id_pedido) {
    const limite = await cfg.get(client, id_empresa, 'web.permitir_modificar_pedido_hasta_estado', 20);
    const r = await client.query(`
        SELECT id_pedido, id_estado
          FROM pedidos
         WHERE id_empresa = $1 AND id_cliente = $2 AND id_pedido = $3
         FOR UPDATE
    `, [id_empresa, id_cliente, id_pedido]);
    if (!r.rows.length)                  throw new Error('Pedido no encontrado');
    if (r.rows[0].id_estado > Number(limite)) {
        throw new Error('El pedido ya no se puede modificar');
    }
    return r.rows[0];
}

/**
 * Recalcula totales del pedido desde sus items y los persiste.
 * Usado tras cualquier modificacion.
 */
async function _recalcularTotalesPedido(client, id_empresa, id_pedido) {
    if (!id_empresa) throw new Error('_recalcularTotalesPedido: id_empresa requerido');
    const r = await client.query(`
        SELECT COALESCE(SUM(total_linea - monto_iva), 0)::numeric AS subtotal,
               COALESCE(SUM(monto_iva), 0)::numeric                AS iva,
               COALESCE(SUM(total_linea), 0)::numeric              AS total
          FROM pedidoitems
         WHERE id_pedido = $1 AND id_empresa = $2
    `, [id_pedido, id_empresa]);
    const subtotal = Math.round(Number(r.rows[0].subtotal) * 100) / 100;
    const iva      = Math.round(Number(r.rows[0].iva) * 100) / 100;
    const total    = Math.round(Number(r.rows[0].total) * 100) / 100;

    await client.query(`
        UPDATE pedidos
           SET subtotal_sin_iva = $1,
               total_iva = $2,
               subtotal_con_descuento = $1,
               total = $3,
               total_final = $3
         WHERE id_pedido = $4 AND id_empresa = $5
    `, [subtotal, iva, total, id_pedido, id_empresa]);

    return { subtotal_sin_iva: subtotal, total_iva: iva, total_final: total };
}

async function modificarItemPedidoCliente(client, id_empresa, id_cliente, id_pedido, id_item, nuevaCantidad) {
    await _verificarModificable(client, id_empresa, id_cliente, id_pedido);
    const cant = Number(nuevaCantidad);
    if (cant <= 0) {
        return await eliminarItemPedidoCliente(client, id_empresa, id_cliente, id_pedido, id_item);
    }

    const it = await client.query(`
        SELECT id_item, id_producto, precio_unitario_final, iva_aplicado
          FROM pedidoitems
         WHERE id_item = $1 AND id_pedido = $2 AND id_empresa = $3
    `, [id_item, id_pedido, id_empresa]);
    if (!it.rows.length) throw new Error('Item no encontrado');

    // pedidoitems guarda precio_unitario_congelado (NETO) y precio_unitario_final (con IVA)
    // Para reusar _desglosarLineaConIva pasamos el neto.
    const itQ = await client.query(
        'SELECT precio_unitario_congelado FROM pedidoitems WHERE id_item = $1 AND id_empresa = $2',
        [id_item, id_empresa]
    );
    const precioNeto = Number(itQ.rows[0].precio_unitario_congelado);
    const desglose = _desglosarLineaConIva(precioNeto, cant, it.rows[0].iva_aplicado);
    await client.query(`
        UPDATE pedidoitems
           SET cantidad = $1,
               monto_iva = $2,
               total_linea = $3
         WHERE id_item = $4 AND id_empresa = $5
    `, [cant, desglose.iva_linea, desglose.total_linea, id_item, id_empresa]);

    return await _recalcularTotalesPedido(client, id_empresa, id_pedido);
}

async function eliminarItemPedidoCliente(client, id_empresa, id_cliente, id_pedido, id_item) {
    await _verificarModificable(client, id_empresa, id_cliente, id_pedido);
    await client.query('DELETE FROM pedidoitems WHERE id_item = $1 AND id_pedido = $2 AND id_empresa = $3',
        [id_item, id_pedido, id_empresa]);
    return await _recalcularTotalesPedido(client, id_empresa, id_pedido);
}

async function cancelarPedidoCliente(client, id_empresa, id_cliente, id_pedido) {
    await _verificarModificable(client, id_empresa, id_cliente, id_pedido);
    await client.query(`
        UPDATE pedidos SET id_estado = 7
         WHERE id_pedido = $1 AND id_empresa = $2 AND id_cliente = $3
    `, [id_pedido, id_empresa, id_cliente]);
    return { id_pedido, id_estado: 7 };
}

// ─────────────────────────────────────────────────────────────────────────
// PANEL ADMIN
// ─────────────────────────────────────────────────────────────────────────

async function listarPendientesAdmin(client, id_empresa, opciones = {}) {
    const { limit = 100, offset = 0, filtro = 'pendientes' } = opciones;

    // Umbral configurable: notificaciones.horas_alerta_pedido_sin_atender
    const umbralRaw = await cfg.get(client, id_empresa, 'notificaciones.horas_alerta_pedido_sin_atender', '24');
    const umbralHoras = parseInt(umbralRaw, 10) || 24;

    // WHERE segun filtro. Filtro invalido => 'pendientes'.
    const FILTROS = {
        'pendientes':   'id_estado = 20',
        'urgentes_24h': `id_estado = 20 AND horas_espera > ${umbralHoras}`,
        'aprobados':    'id_estado = 21',
        'rechazados':   'id_estado IN (7, -2)',
        'todos':        'TRUE'
    };
    const filtroAplicado = FILTROS[filtro] ? filtro : 'pendientes';
    const where = FILTROS[filtroAplicado];

    const r = await client.query(`
        SELECT * FROM v_pedidos_web
         WHERE id_empresa = $1 AND (${where})
         ORDER BY fecha_creacion ASC
         LIMIT $2 OFFSET $3
    `, [id_empresa, limit, offset]);

    return {
        pedidos: r.rows,
        umbral_horas_alerta: umbralHoras,
        filtro_aplicado: filtroAplicado
    };
}

/**
 * Aprueba un pedido web: pasa de 20 -> 1 (Pendiente).
 * NO descuenta stock aca. El flujo POS normal lo hace cuando se factura/remite.
 */
async function aprobarPedidoWeb(client, id_empresa, id_pedido, id_usuario_admin) {
    const r = await client.query(`
        SELECT id_pedido, id_estado FROM pedidos
         WHERE id_empresa = $1 AND id_pedido = $2
         FOR UPDATE
    `, [id_empresa, id_pedido]);
    if (!r.rows.length)            throw new Error('Pedido no encontrado');
    if (r.rows[0].id_estado !== 20) throw new Error('El pedido no esta en estado Web Pendiente Revision');

    await client.query(`
        UPDATE pedidos
           SET id_estado = 1,
               id_usuario = COALESCE(id_usuario, $1)
         WHERE id_pedido = $2 AND id_empresa = $3
    `, [id_usuario_admin || null, id_pedido, id_empresa]);

    // Notificar al cliente
    try {
        const info = await client.query(`
            SELECT p.nro_pedido, p.id_cliente, p.total_final, p.tipo_entrega,
                   c.razon_social AS cliente_nombre, c.email AS cliente_email
              FROM pedidos p
              JOIN clientes c ON c.id_cliente = p.id_cliente
             WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `, [id_pedido, id_empresa]);
        if (info.rows.length) {
            await notificaciones.notificar(client, {
                id_empresa,
                evento: 'pedido_web_aprobado',
                contexto: {
                    id_pedido,
                    nro_pedido: info.rows[0].nro_pedido,
                    id_cliente: info.rows[0].id_cliente,
                    cliente_nombre: info.rows[0].cliente_nombre,
                    cliente_email: info.rows[0].cliente_email,
                    total_final: info.rows[0].total_final,
                    tipo_entrega: info.rows[0].tipo_entrega
                }
            });
        }
    } catch (e) {
        console.error('notificacion pedido_web_aprobado fallo:', e.message);
    }

    return { id_pedido, id_estado: 1 };
}

async function rechazarPedidoWeb(client, id_empresa, id_pedido, motivo, id_usuario_admin) {
    const r = await client.query(`
        SELECT id_pedido, id_estado, observaciones FROM pedidos
         WHERE id_empresa = $1 AND id_pedido = $2
         FOR UPDATE
    `, [id_empresa, id_pedido]);
    if (!r.rows.length)            throw new Error('Pedido no encontrado');
    if (r.rows[0].id_estado !== 20) throw new Error('El pedido no esta en estado Web Pendiente Revision');

    const obsNueva = (r.rows[0].observaciones || '') +
        '\n[RECHAZADO ' + new Date().toISOString() + '] ' + (motivo || 'Sin motivo');

    await client.query(`
        UPDATE pedidos
           SET id_estado = -2,
               observaciones = $1,
               id_usuario = COALESCE(id_usuario, $2)
         WHERE id_pedido = $3 AND id_empresa = $4
    `, [obsNueva, id_usuario_admin || null, id_pedido, id_empresa]);

    // Notificar al cliente
    try {
        const info = await client.query(`
            SELECT p.nro_pedido, p.id_cliente, p.total_final,
                   c.razon_social AS cliente_nombre, c.email AS cliente_email
              FROM pedidos p
              JOIN clientes c ON c.id_cliente = p.id_cliente
             WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `, [id_pedido, id_empresa]);
        if (info.rows.length) {
            await notificaciones.notificar(client, {
                id_empresa,
                evento: 'pedido_web_rechazado',
                contexto: {
                    id_pedido,
                    nro_pedido: info.rows[0].nro_pedido,
                    id_cliente: info.rows[0].id_cliente,
                    cliente_nombre: info.rows[0].cliente_nombre,
                    cliente_email: info.rows[0].cliente_email,
                    total_final: info.rows[0].total_final,
                    motivo: motivo || 'Sin motivo'
                }
            });
        }
    } catch (e) {
        console.error('notificacion pedido_web_rechazado fallo:', e.message);
    }

    return { id_pedido, id_estado: -2 };
}

/**
 * Edicion admin de un item del pedido web (mismas reglas que cliente, pero sin
 * restriccion de propiedad). Util para que el admin ajuste antes de aprobar.
 */
async function modificarItemAdmin(client, id_empresa, id_pedido, id_item, nuevaCantidad) {
    const ped = await client.query(
        'SELECT id_estado FROM pedidos WHERE id_empresa = $1 AND id_pedido = $2 FOR UPDATE',
        [id_empresa, id_pedido]
    );
    if (!ped.rows.length)             throw new Error('Pedido no encontrado');
    if (ped.rows[0].id_estado !== 20) throw new Error('Solo se pueden editar pedidos en estado Web Pendiente');

    const cant = Number(nuevaCantidad);
    if (cant <= 0) {
        await client.query('DELETE FROM pedidoitems WHERE id_item = $1 AND id_pedido = $2 AND id_empresa = $3',
            [id_item, id_pedido, id_empresa]);
    } else {
        const it = await client.query(`
            SELECT precio_unitario_congelado, iva_aplicado FROM pedidoitems
             WHERE id_item = $1 AND id_pedido = $2 AND id_empresa = $3
        `, [id_item, id_pedido, id_empresa]);
        if (!it.rows.length) throw new Error('Item no encontrado');
        const d = _desglosarLineaConIva(Number(it.rows[0].precio_unitario_congelado), cant, it.rows[0].iva_aplicado);
        await client.query(`
            UPDATE pedidoitems
               SET cantidad = $1, monto_iva = $2, total_linea = $3
             WHERE id_item = $4 AND id_empresa = $5
        `, [cant, d.iva_linea, d.total_linea, id_item, id_empresa]);
    }
    return await _recalcularTotalesPedido(client, id_empresa, id_pedido);
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
    convertirCarritoEnPedido,
    listarPedidosCliente,
    obtenerPedidoCliente,
    modificarItemPedidoCliente,
    eliminarItemPedidoCliente,
    cancelarPedidoCliente,
    listarPendientesAdmin,
    aprobarPedidoWeb,
    rechazarPedidoWeb,
    modificarItemAdmin,
    // expuestos por si controller los necesita
    _recalcularTotalesPedido,
    _desglosarLineaConIva
};
