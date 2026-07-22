/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRESUPUESTOS HELPER — ERP LAGO — FASE 4
 * Centralización de escrituras a:
 *   secuencia_presupuestos, presupuestos, presupuesto_items
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CONSUMIDORES: presupuestos.controller.js
 *
 * TABLAS:
 *   - secuencia_presupuestos  (UPSERT)  — numeración atómica
 *   - presupuestos            (INSERT, UPDATE)
 *   - presupuesto_items       (INSERT)
 */

const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════
// SECUENCIA — Numeración atómica
// ═══════════════════════════════════════════════════════════════

/**
 * Obtener próximo número de presupuesto (atómico, sin race condition)
 */
async function proximoNumeroAtomico(client, id_empresa) {
    const res = await client.query(`
        INSERT INTO secuencia_presupuestos (id_empresa, ultimo_numero)
        VALUES ($1, 1)
        ON CONFLICT (id_empresa)
        DO UPDATE SET ultimo_numero = secuencia_presupuestos.ultimo_numero + 1
        RETURNING ultimo_numero
    `, [id_empresa]);
    return res.rows[0].ultimo_numero;
}

// ═══════════════════════════════════════════════════════════════
// PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════

/**
 * Crear presupuesto (cabecera)
 * @returns {{ id_presupuesto, numero_completo }}
 */
async function crearPresupuesto(client, datos) {
    const {
        id_empresa, id_cliente, id_usuario, numero_presupuesto,
        fecha_vencimiento, condiciones_pago, observaciones,
        subtotal, iva, total, id_pedido, id_moneda, cotizacion,
        dias_vencimiento
    } = datos;

    // Si viene dias_vencimiento, usar intervalo; sino fecha directa
    let query, params;
    if (dias_vencimiento) {
        query = `
            INSERT INTO presupuestos (
                id_empresa, id_cliente, id_usuario, numero_presupuesto,
                fecha_vencimiento, observaciones,
                subtotal, iva, total, estado, id_pedido
            ) VALUES ($1,$2,$3,$4, CURRENT_DATE + ($5 || ' days')::interval, $6, $7,$8,$9, 'pendiente', $10)
            RETURNING id_presupuesto, numero_completo
        `;
        params = [
            id_empresa, id_cliente || null, id_usuario, numero_presupuesto,
            dias_vencimiento, observaciones || null,
            subtotal, iva, total, id_pedido || null
        ];
    } else {
        const venc = fecha_vencimiento ||
            new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        query = `
            INSERT INTO presupuestos (
                id_empresa, id_cliente, id_usuario, numero_presupuesto,
                fecha_vencimiento, condiciones_pago, observaciones,
                subtotal, iva, total, estado, id_pedido, id_moneda, cotizacion
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente',$11,$12,$13)
            RETURNING id_presupuesto, numero_completo
        `;
        params = [
            id_empresa, id_cliente || null, id_usuario, numero_presupuesto,
            venc, condiciones_pago || null, observaciones || null,
            subtotal, iva, total, id_pedido || null,
            id_moneda || null, cotizacion || null
        ];
    }

    const result = await client.query(query, params);
    const pres = result.rows[0];
    logger.info(`[presupuestos.helper] Presupuesto creado: ${pres.numero_completo} (id: ${pres.id_presupuesto})`);
    return pres;
}

/**
 * Insertar items de presupuesto
 */
async function insertarItems(client, datos) {
    const { id_empresa, id_presupuesto, items } = datos;

    for (const item of items) {
        await client.query(`
            INSERT INTO presupuesto_items (
                id_empresa, id_presupuesto, id_producto, descripcion, cantidad,
                precio_unitario, iva_porcentaje, descuento_porcentaje,
                subtotal, iva_monto, total
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
            id_empresa, id_presupuesto, item.id_producto || null,
            item.descripcion, item.cantidad, item.precio_unitario,
            item.iva_porcentaje, item.descuento_porcentaje || 0,
            item.subtotal, item.iva_monto, item.total
        ]);
    }

    return items.length;
}

/**
 * Cambiar estado de presupuesto
 */
async function cambiarEstado(client, datos) {
    const { id_presupuesto, id_empresa, estado } = datos;

    const validos = ['pendiente', 'aprobado', 'rechazado', 'facturado', 'vencido'];
    if (!validos.includes(estado)) {
        throw Object.assign(new Error(`Estado inválido. Válidos: ${validos.join(', ')}`), { statusCode: 400 });
    }

    const result = await client.query(
        `UPDATE presupuestos SET estado = $1
         WHERE id_presupuesto = $2 AND id_empresa = $3
         RETURNING numero_completo`,
        [estado, id_presupuesto, id_empresa]
    );

    if (result.rows.length === 0) {
        throw Object.assign(new Error('Presupuesto no encontrado'), { statusCode: 404 });
    }

    logger.info(`[presupuestos.helper] Estado → ${estado}: ${result.rows[0].numero_completo}`);
    return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// OPERACIÓN COMPUESTA: Crear presupuesto desde pedido
// ═══════════════════════════════════════════════════════════════

/**
 * Crear presupuesto completo desde un pedido
 * Reutilizado por crearDesdePedido y crearMasivo
 */
async function crearDesdePedido(client, datos) {
    const { id_empresa, id_usuario, id_pedido, observaciones } = datos;

    // Verificar pedido
    const pedidoRes = await client.query(`
        SELECT p.*, c.id_cliente, c.razon_social
        FROM pedidos p
        LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
        WHERE p.id_pedido = $1 AND p.id_empresa = $2
    `, [id_pedido, id_empresa]);

    if (pedidoRes.rows.length === 0) throw new Error('Pedido no encontrado');
    const pedido = pedidoRes.rows[0];

    // Verificar no duplicado
    const existente = await client.query(
        `SELECT id_presupuesto FROM presupuestos WHERE id_pedido = $1 AND estado NOT IN ('rechazado')`,
        [id_pedido]
    );
    if (existente.rows.length > 0) throw new Error('Ya tiene presupuesto');

    // Items del pedido
    const itemsRes = await client.query(`
        SELECT pi.*, pr.nombre AS producto_nombre
        FROM pedidoitems pi
        LEFT JOIN productos pr ON pi.id_producto = pr.id_producto
        WHERE pi.id_pedido = $1
    `, [id_pedido]);
    if (itemsRes.rows.length === 0) throw new Error('Sin items');

    // Número atómico
    const numero = await proximoNumeroAtomico(client, id_empresa);

    // Totales
    const subtotal = parseFloat(pedido.subtotal_sin_iva) || parseFloat(pedido.total) || 0;
    const ivaTotal = parseFloat(pedido.total_iva) || 0;
    const total = parseFloat(pedido.total_final) || parseFloat(pedido.total) || 0;
    const diasVencimiento = parseInt(pedido.dias_vencimiento) || 30;

    // Crear cabecera
    const presupuesto = await crearPresupuesto(client, {
        id_empresa, id_cliente: pedido.id_cliente, id_usuario,
        numero_presupuesto: numero,
        dias_vencimiento: diasVencimiento,
        observaciones,
        subtotal, iva: ivaTotal, total,
        id_pedido
    });

    // Crear items
    const itemsParaInsertar = itemsRes.rows.map(item => {
        const precioUnit = parseFloat(item.precio_unitario_congelado) || 0;
        const cantidad = parseFloat(item.cantidad) || 0;
        const ivaPct = parseFloat(item.iva_aplicado) || 21;
        const subItem = precioUnit * cantidad;
        const ivaItem = parseFloat(item.monto_iva) || (subItem * ivaPct / 100);
        const totalItem = parseFloat(item.total_linea) || (subItem + ivaItem);

        return {
            id_producto: item.id_producto,
            descripcion: item.descripcion_congelada || item.producto_nombre,
            cantidad, precio_unitario: precioUnit,
            iva_porcentaje: ivaPct, descuento_porcentaje: 0,
            subtotal: subItem, iva_monto: ivaItem, total: totalItem
        };
    });

    await insertarItems(client, { id_empresa, id_presupuesto: presupuesto.id_presupuesto, items: itemsParaInsertar });

    return {
        id_presupuesto: presupuesto.id_presupuesto,
        numero_completo: presupuesto.numero_completo,
        cliente: pedido.razon_social,
        total
    };
}

// ═══════════════════════════════════════════════════════════════
module.exports = {
    proximoNumeroAtomico,
    crearPresupuesto,
    insertarItems,
    cambiarEstado,
    crearDesdePedido
};
