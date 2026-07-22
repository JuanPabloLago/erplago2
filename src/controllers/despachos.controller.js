const logger = require('../utils/logger');
const stockHelper = require('../utils/stock.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const pagosHelper = require('../utils/pagos.helper');
const pedidosHelper = require('../utils/pedidos.helper');
const despachosHelper = require('../utils/despachos.helper');
const cajaHelper = require('../utils/caja.helper');
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CONTROLADOR: Gestión de Despachos v6 (Fase 5 — Migrado a despachos.helper.js)
 * ERP LAGO - Document-Driven Delivery System
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * CAMBIOS FASE 5:
 * - Todas las escrituras a viajes/remitos/remito_items via despachosHelper
 * - 10 funciones migradas, ~10 funciones de lectura sin cambios
 * - pedidosHelper ya estaba migrado (Fase 2)
 *
 * PRINCIPIO: El pedido NO tiene estado. Todo se CALCULA desde los remitos.
 * Disponible = Cantidad_Original - Entregado - En_Tránsito
 *
 * Fecha: 2026-02-21
 * ════════════════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');

const despachosController = {

    // ════════════════════════════════════════════════════════════════════════════
    // PEDIDOS DISPONIBLES (lectura — sin cambios)
    // ════════════════════════════════════════════════════════════════════════════

    async obtenerPedidosDisponibles(req, res) {
        const { id_empresa } = req.usuario;
        const { busqueda, id_deposito } = req.query;

        try {
            let query = `
                SELECT
                    pr.*,
                    COALESCE(c.saldo_actual, 0) as saldo_cliente,
                    COALESCE(c.limite_credito, 0) as limite_credito,
                    EXISTS (
                        SELECT 1 FROM facturas f
                        WHERE f.id_cliente = pr.id_cliente
                        AND f.id_empresa = pr.id_empresa
                        AND f.estado = 'pendiente'
                        AND f.fecha_vencimiento < CURRENT_DATE
                    ) as es_moroso
                FROM v_pedidos_resumen pr
                JOIN clientes c ON pr.id_cliente = c.id_cliente
                WHERE pr.id_empresa = $1
                  AND pr.total_disponible > 0
            `;

            const params = [id_empresa];
            let paramIndex = 2;

            if (busqueda) {
                query += ` AND (
                    pr.cliente ILIKE $${paramIndex}
                    OR pr.id_pedido::text LIKE $${paramIndex}
                    OR pr.telefono ILIKE $${paramIndex}
                )`;
                params.push(`%${busqueda}%`);
                paramIndex++;
            }

            // Filtro por fecha
            const { fecha_desde, fecha_hasta } = req.query;
            if (fecha_desde) {
                query += ` AND pr.fecha_creacion >= $${paramIndex}::date`;
                params.push(fecha_desde);
                paramIndex++;
            }
            if (fecha_hasta) {
                query += ` AND pr.fecha_creacion <= ($${paramIndex}::date + interval '1 day')`;
                params.push(fecha_hasta);
                paramIndex++;
            }

            query += ` ORDER BY pr.fecha_creacion DESC`;

            const result = await pool.query(query, params);

            const pedidos = result.rows.map(p => ({
                ...p,
                estado_credito: p.es_moroso ? 'moroso' :
                               (p.saldo_cliente > p.limite_credito ? 'excede_credito' : 'ok')
            }));

            res.json(pedidos);

        } catch (error) {
            console.error('Error en obtenerPedidosDisponibles:', error);
            res.status(500).json({ error: 'Error al obtener pedidos disponibles' });
        }
    },

    async obtenerDetallePedido(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;

        try {
            const pedidoResult = await pool.query(`
                SELECT
                    p.id_pedido, p.fecha_creacion, p.total,
                    p.observaciones, p.domicilio_entrega,
                    c.razon_social as cliente, c.domicilio as domicilio_cliente, c.telefono
                FROM pedidos p
                JOIN clientes c ON p.id_cliente = c.id_cliente
                WHERE p.id_pedido = $1 AND p.id_empresa = $2
            `, [id, id_empresa]);

            if (pedidoResult.rows.length === 0) {
                return res.status(404).json({ error: 'Pedido no encontrado' });
            }

            const itemsResult = await pool.query(`
                SELECT * FROM v_pedidos_disponibles
                WHERE id_pedido = $1 AND id_empresa = $2
            `, [id, id_empresa]);

            res.json({
                ...pedidoResult.rows[0],
                items: itemsResult.rows
            });

        } catch (error) {
            console.error('Error en obtenerDetallePedido:', error);
            res.status(500).json({ error: 'Error al obtener detalle del pedido' });
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // VIAJES (lectura — sin cambios)
    // ════════════════════════════════════════════════════════════════════════════

    async listarViajes(req, res) {
        const { id_empresa } = req.usuario;
        const { fecha, fecha_desde, fecha_hasta, estado, q } = req.query;

        try {
            let query = `
                SELECT
                    v.*,
                    u_creacion.nombre as usuario_creacion_nombre,
                    COALESCE(agg.cantidad_remitos, 0) as cantidad_remitos,
                    COALESCE(agg.total_viaje, 0) as total_viaje,
                    agg.remitos
                FROM viajes v
                LEFT JOIN usuarios u_creacion ON v.id_usuario_creacion = u_creacion.id_usuario
                LEFT JOIN LATERAL (
                    SELECT
                        COUNT(*) as cantidad_remitos,
                        SUM(r.total) as total_viaje,
                        json_agg(json_build_object(
                            'id_remito', r.id_remito,
                            'numero_completo', r.numero_completo,
                            'cliente', c.razon_social,
                            'telefono', c.telefono,
                            'total', r.total,
                            'id_pedido', r.id_pedido, 'estado', r.estado,
                            'fecha_emision', r.fecha_emision,
                            'saldo', COALESCE(sp.saldo, 0),
                            'pagado', COALESCE(sp.total_pagado, 0)
                        ) ORDER BY r.id_remito) as remitos
                    FROM remitos r
                    JOIN clientes c ON r.id_cliente = c.id_cliente
                    LEFT JOIN v_saldo_pedidos sp ON r.id_pedido = sp.id_pedido
                    -- Aislamiento multi-empresa heredado: r.id_viaje = v.id_viaje,
                    -- y v ya filtra por v.id_empresa = $1 en el WHERE externo.
                    WHERE r.id_viaje = v.id_viaje
                ) agg ON true
                WHERE v.id_empresa = $1
            `;

            const params = [id_empresa];
            let paramIndex = 2;

            if (fecha_desde && fecha_hasta) {
                query += ` AND v.fecha >= $${paramIndex} AND v.fecha <= $${paramIndex + 1}`;
                params.push(fecha_desde, fecha_hasta);
                paramIndex += 2;
            } else if (fecha_desde) {
                query += ` AND v.fecha >= $${paramIndex}`;
                params.push(fecha_desde);
                paramIndex++;
            } else if (fecha_hasta) {
                query += ` AND v.fecha <= $${paramIndex}`;
                params.push(fecha_hasta);
                paramIndex++;
            } else if (fecha) {
                query += ` AND v.fecha = $${paramIndex}`;
                params.push(fecha);
                paramIndex++;
            }

            if (estado) {
                query += ` AND v.estado = $${paramIndex}`;
                params.push(estado);
                paramIndex++;
            }

            // Filtro de texto: el viaje aparece si ALGUN remito suyo matchea
            // por cliente, numero de remito o numero de pedido. En SQL sobre
            // TODA la tabla (respetando el rango de fechas ya aplicado arriba),
            // NO en frontend sobre la pagina. El LIMIT cuenta sobre el resultado
            // ya filtrado.
            if (q && q.trim().length >= 2) {
                query += ` AND EXISTS (
                    SELECT 1 FROM remitos rq
                    JOIN clientes cq ON rq.id_cliente = cq.id_cliente
                    WHERE rq.id_viaje = v.id_viaje AND rq.id_empresa = v.id_empresa
                      AND (
                            cq.razon_social ILIKE $${paramIndex}
                         OR rq.numero_completo ILIKE $${paramIndex}
                         OR rq.id_pedido::text LIKE $${paramIndex}
                      )
                )`;
                params.push('%' + q.trim() + '%');
                paramIndex++;
            }

            query += ` ORDER BY v.fecha DESC, v.created_at DESC`;

            // Paginación: limit y offset desde query params (default 50)
            const limBusq = parseInt(await despachosHelper.leerConfig(pool, id_empresa, 'despachos.viajes_limit_busqueda', '100')) || 100;
            const limLista = parseInt(await despachosHelper.leerConfig(pool, id_empresa, 'despachos.viajes_limit_listado', '200')) || 200;
            const limDefault = (q && q.trim().length >= 2) ? limBusq : limLista;
            const limit = Math.min(parseInt(req.query.limit) || limDefault, 500);
            const offset = parseInt(req.query.offset) || 0;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);
            paramIndex += 2;

            const result = await pool.query(query, params);
            res.json(result.rows);

        } catch (error) {
            console.error('Error en listarViajes:', error);
            res.status(500).json({ error: 'Error al listar viajes' });
        }
    },

    async obtenerViaje(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;

        try {
            const viajeResult = await pool.query(`
                SELECT v.*,
                       u_creacion.nombre as usuario_creacion_nombre,
                       u_despacho.nombre as usuario_despacho_nombre,
                       u_cierre.nombre as usuario_cierre_nombre,
                       u_liquidacion.nombre as usuario_liquidacion_nombre
                FROM viajes v
                LEFT JOIN usuarios u_creacion ON v.id_usuario_creacion = u_creacion.id_usuario
                LEFT JOIN usuarios u_despacho ON v.id_usuario_despacho = u_despacho.id_usuario
                LEFT JOIN usuarios u_cierre ON v.id_usuario_cierre = u_cierre.id_usuario
                LEFT JOIN usuarios u_liquidacion ON v.id_usuario_liquidacion = u_liquidacion.id_usuario
                WHERE v.id_viaje = $1 AND v.id_empresa = $2
            `, [id, id_empresa]);

            if (viajeResult.rows.length === 0) {
                return res.status(404).json({ error: 'Viaje no encontrado' });
            }

            const remitosResult = await pool.query(`
                SELECT
                    r.*,
                    c.razon_social as cliente, c.domicilio, c.telefono,
                    COALESCE(sp.saldo, 0) as saldo_pendiente,
                    COALESCE(sp.total_pagado, 0) as total_pagado_pedido,
                    -- Aislamiento heredado: ri.id_remito = r.id_remito,
                    -- y r filtra por r.id_empresa = $2 en el WHERE externo.
                    (SELECT json_agg(json_build_object(
                        'id_item', ri.id_item,
                        'id_producto', ri.id_producto,
                        'producto', ri.descripcion,
                        'cantidad', ri.cantidad,
                        'cantidad_entregada', ri.cantidad_entregada,
                        'cantidad_devuelta', ri.cantidad_devuelta,
                        'motivo_devolucion', ri.motivo_devolucion,
                        'precio_unitario', ri.precio_unitario
                    ))
                    FROM remito_items ri
                    WHERE ri.id_remito = r.id_remito AND ri.anulado = false) as items
                FROM remitos r
                JOIN clientes c ON r.id_cliente = c.id_cliente
                LEFT JOIN v_saldo_pedidos sp ON r.id_pedido = sp.id_pedido
                WHERE r.id_viaje = $1 AND r.id_empresa = $2
                ORDER BY r.id_remito
            `, [id, id_empresa]);

            res.json({
                ...viajeResult.rows[0],
                remitos: remitosResult.rows
            });

        } catch (error) {
            console.error('Error en obtenerViaje:', error);
            res.status(500).json({ error: 'Error al obtener viaje' });
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // CREAR VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async crearViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { fecha, chofer, vehiculo, observaciones } = req.body;

        try {
            const viaje = await despachosHelper.crearViaje(pool, {
                id_empresa, fecha, chofer, vehiculo, observaciones, id_usuario
            });

            res.status(201).json(viaje);

        } catch (error) {
            console.error('Error en crearViaje:', error);
            res.status(500).json({ error: 'Error al crear viaje' });
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // ACTUALIZAR VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async actualizarViaje(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;
        const { fecha, chofer, vehiculo, observaciones } = req.body;

        try {
            const viaje = await despachosHelper.actualizarViaje(pool, {
                id_viaje: id, id_empresa, fecha, chofer, vehiculo, observaciones
            });

            res.json(viaje);

        } catch (error) {
            if (error.message.includes('no encontrado') || error.message.includes('preparación')) {
                return res.status(400).json({ error: error.message });
            }
            console.error('Error en actualizarViaje:', error);
            res.status(500).json({ error: 'Error al actualizar viaje' });
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // AGREGAR AL VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async agregarAlViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params; // id_viaje
        const { id_pedido, items } = req.body;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verificar viaje en preparación
            const viajeResult = await client.query(
                'SELECT * FROM viajes WHERE id_viaje = $1 AND id_empresa = $2 FOR UPDATE',
                [id, id_empresa]
            );

            if (viajeResult.rows.length === 0) {
                throw new Error('Viaje no encontrado');
            }

            if (viajeResult.rows[0].estado !== despachosHelper.VIAJE_ESTADOS.PREPARANDO) {
                throw new Error('El viaje ya fue despachado');
            }

            // Verificar pedido
            const pedidoResult = await client.query(`
                SELECT p.*, c.razon_social, c.domicilio, c.id_cliente
                FROM pedidos p
                JOIN clientes c ON p.id_cliente = c.id_cliente
                WHERE p.id_pedido = $1 AND p.id_empresa = $2
            `, [id_pedido, id_empresa]);

            if (pedidoResult.rows.length === 0) {
                throw new Error('Pedido no encontrado');
            }

            const pedido = pedidoResult.rows[0];

            // Leer configuración de stock
            const configResult = await client.query(
                `SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2`,
                [id_empresa, 'permitir_stock_negativo']
            );
            const permitirStockNegativo = configResult.rows[0]?.valor === 'true';

            // Verificar disponibilidad — BATCH: 1 query para todos los items
            const itemIds = items.map(i => i.id_item);
            const dispResult = await client.query(`
                SELECT id_item, disponible, producto, id_producto FROM v_pedidos_disponibles
                WHERE id_item = ANY($1) AND id_empresa = $2
            `, [itemIds, id_empresa]);

            const dispMap = new Map(dispResult.rows.map(r => [r.id_item, r]));

            for (const item of items) {
                const disp = dispMap.get(item.id_item);
                if (!disp) {
                    throw new Error(`Item ${item.id_item} no encontrado o sin disponible`);
                }
                if (item.cantidad > disp.disponible) {
                    throw new Error(`Cantidad ${item.cantidad} excede disponible ${disp.disponible} para ${disp.producto}`);
                }
            }

            // Verificar stock en depósito — BATCH: 1 query para todos los productos
            const itemsConDeposito = items.filter(i => i.id_deposito);
            if (itemsConDeposito.length > 0) {
                const productoIds = itemsConDeposito.map(i => dispMap.get(i.id_item)?.id_producto).filter(Boolean);
                const depositoId = itemsConDeposito[0].id_deposito;

                const stockResult = await client.query(`
                    SELECT id_producto, stock_real FROM inventario_deposito
                    WHERE id_deposito = $1 AND id_producto = ANY($2)
                `, [depositoId, productoIds]);

                const stockMap = new Map(stockResult.rows.map(r => [r.id_producto, parseFloat(r.stock_real)]));

                for (const item of itemsConDeposito) {
                    const idProducto = dispMap.get(item.id_item)?.id_producto;
                    const stockActual = stockMap.get(idProducto) || 0;
                    if (stockActual < item.cantidad) {
                        if (!permitirStockNegativo) {
                            throw new Error(`Stock insuficiente en depósito. Disponible: ${stockActual}, Solicitado: ${item.cantidad}`);
                        }
                        logger.warn(` Stock negativo permitido: Disponible: ${stockActual}, Solicitado: ${item.cantidad}`);
                    }
                }
            }

            // Verificar si el pedido ya tiene remito activo en OTRO viaje
            const remitoOtroViaje = await client.query(`
                SELECT r.id_remito, v.id_viaje FROM remitos r
                JOIN viajes v ON r.id_viaje = v.id_viaje
                WHERE r.id_pedido = $1 AND r.id_empresa = $2
                AND r.estado NOT IN ('anulado', 'entregado', 'no_entregado')
                AND v.id_viaje != $3 AND v.estado NOT IN ('finalizado', 'liquidado')
            `, [id_pedido, id_empresa, id]);

            if (remitoOtroViaje.rows.length > 0) {
                throw new Error(`El pedido #${id_pedido} ya tiene remito activo en viaje #${remitoOtroViaje.rows[0].id_viaje}`);
            }

            // Buscar si ya existe remito borrador para este pedido en ESTE viaje
            const remitoExistente = await despachosHelper.buscarRemitoBorradorEnViaje(client, {
                id_empresa,
                id_viaje: id,
                id_pedido
            });

            let id_remito;

            if (remitoExistente) {
                id_remito = remitoExistente.id_remito;
            } else {
                // Crear nuevo remito borrador via helper
                // Obtener punto_venta del depósito del usuario
                const pvRes = await client.query(
                    'SELECT COALESCE(d.punto_venta_afip, 1) as pv FROM depositos d JOIN usuarios u ON d.id_deposito = u.id_deposito WHERE u.id_usuario = $1 AND d.id_empresa = $2',
                    [id_usuario, id_empresa]
                );
                const puntoVenta = pvRes.rows.length > 0 ? pvRes.rows[0].pv : 1;

                const numeroRemito = await client.query(
                    'SELECT obtener_siguiente_numero_remito($1, $2) as numero',
                    [id_empresa, puntoVenta]
                );

                const remito = await despachosHelper.crearRemito(client, {
                    id_empresa,
                    id_cliente: pedido.id_cliente,
                    id_pedido,
                    id_usuario,
                    id_viaje: id,
                    numero_remito: numeroRemito.rows[0].numero,
                    punto_venta: puntoVenta,
                    direccion_entrega: pedido.domicilio_entrega || pedido.domicilio,
                    observaciones: pedido.observaciones
                });

                id_remito = remito.id_remito;
            }

            // Obtener datos de TODOS los items del pedido — BATCH: 1 query
            const itemsPedidoResult = await client.query(`
                SELECT pi.*, pr.nombre as producto_nombre
                FROM pedidoitems pi
                JOIN productos pr ON pi.id_producto = pr.id_producto
                WHERE pi.id_item = ANY($1)
            `, [itemIds]);

            const itemsPedidoMap = new Map(itemsPedidoResult.rows.map(r => [r.id_item, r]));

            // Verificar items existentes en remito — BATCH: 1 query
            // Defensa en profundidad: filtro explicito por id_empresa aunque id_remito
            // ya venga validado, para evitar regresiones si en el futuro cambia el flujo.
            const existentesResult = await client.query(`
                SELECT id_item, id_pedido_item FROM remito_items
                WHERE id_remito = $1 AND id_pedido_item = ANY($2)
                  AND id_empresa = $3 AND anulado = false
            `, [id_remito, itemIds, id_empresa]);

            const existentesSet = new Set(existentesResult.rows.map(r => r.id_pedido_item));

            // Agregar items al remito
            for (const item of items) {
                const itemData = itemsPedidoMap.get(item.id_item);
                if (!itemData) continue;

                if (existentesSet.has(item.id_item)) {
                    // Incrementar cantidad via helper
                    await despachosHelper.incrementarCantidadItem(client, {
                        id_empresa,
                        id_remito,
                        id_pedido_item: item.id_item,
                        cantidad_adicional: item.cantidad,
                        id_deposito: item.id_deposito
                    });
                } else {
                    // Crear nuevo item via helper
                    await despachosHelper.crearRemitoItem(client, {
                        id_empresa: req.usuario.id_empresa,
                        id_remito,
                        id_producto: itemData.id_producto,
                        id_pedido_item: item.id_item,
                        descripcion: itemData.descripcion_congelada || itemData.producto_nombre,
                        cantidad: item.cantidad,
                        precio_unitario: itemData.precio_unitario_congelado,
                        iva_porcentaje: itemData.iva_aplicado || 21,
                        id_deposito_origen: item.id_deposito
                    });
                }
            }

            // Recalcular totales del remito via helper
            await despachosHelper.recalcularTotalesRemito(client, id_remito, id_empresa);

            await client.query('COMMIT');

            // Retornar viaje actualizado
            const viajeActualizado = await pool.query(`
                SELECT v.*,
                    (SELECT json_agg(json_build_object(
                        'id_remito', r.id_remito,
                        'numero_completo', r.numero_completo,
                        'cliente', c.razon_social,
                        'total', r.total,
                        'id_pedido', r.id_pedido, 'estado', r.estado
                    ))
                    FROM remitos r
                    JOIN clientes c ON r.id_cliente = c.id_cliente
                    WHERE r.id_viaje = v.id_viaje) as remitos
                FROM viajes v
                WHERE v.id_viaje = $1 AND v.id_empresa = $2
            `, [id, id_empresa]);

            res.json(viajeActualizado.rows[0]);

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en agregarAlViaje:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // QUITAR DEL VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async quitarDelViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id, id_remito } = req.params;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows: [viaje] } = await client.query(
                'SELECT estado FROM viajes WHERE id_viaje = $1 AND id_empresa = $2 FOR UPDATE',
                [id, id_empresa]
            );
            if (!viaje) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Viaje no encontrado' });
            }
            if (viaje.estado !== despachosHelper.VIAJE_ESTADOS.PREPARANDO) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'El viaje ya fue despachado' });
            }
            const resultado = await despachosHelper.eliminarRemito(client, {
                id_empresa,
                id_remito: parseInt(id_remito, 10),
                id_viaje: parseInt(id, 10),
                id_usuario,
                motivo: 'Quitado del viaje desde gestion-despachos'
            });
            await client.query('COMMIT');
            const mensajes = {
                eliminado:             'Remito eliminado del viaje',
                anulado_desvinculado:  'Remito anulado y desvinculado (tenia movimientos de stock)',
                desvinculado:          'Remito (anulado) desvinculado del viaje'
            };
            res.json({
                success: true,
                message: mensajes[resultado.accion] || 'Remito procesado',
                accion: resultado.accion,
                estado_previo: resultado.estado_previo
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('Error en quitarDelViaje:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    async autoEliminarSiVacio(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const cfg = await despachosHelper.leerConfig(
                client, id_empresa,
                'despachos.quitar_remito.auto_eliminar_viaje_si_vacio', 'true'
            );
            if (!despachosHelper.configComoBool(cfg, true)) {
                await client.query('ROLLBACK');
                return res.json({ eliminado: false, motivo: 'deshabilitado_por_config' });
            }
            const { rows: [viaje] } = await client.query(
                'SELECT id_viaje, estado FROM viajes WHERE id_viaje=$1 AND id_empresa=$2 FOR UPDATE',
                [id, id_empresa]
            );
            if (!viaje) {
                await client.query('ROLLBACK');
                return res.json({ eliminado: false, motivo: 'no_encontrado' });
            }
            if (viaje.estado !== despachosHelper.VIAJE_ESTADOS.PREPARANDO) {
                await client.query('ROLLBACK');
                return res.json({ eliminado: false, motivo: 'estado_no_permitido' });
            }
            const { rows: [c] } = await client.query(
                'SELECT COUNT(*)::int AS cant FROM remitos WHERE id_viaje=$1 AND id_empresa=$2',
                [id, id_empresa]
            );
            if (c.cant > 0) {
                await client.query('ROLLBACK');
                return res.json({ eliminado: false, motivo: 'no_vacio', remitos_restantes: c.cant });
            }
            const resultado = await despachosHelper.cancelarViajeCompleto(client, {
                id_viaje: parseInt(id, 10),
                id_empresa,
                id_usuario,
                motivo: 'Auto-eliminado por quedar sin remitos',
                ip: req.ip || req.headers['x-forwarded-for'] || null,
                user_agent: req.headers['user-agent'] || null,
                accion: 'auto_eliminado_vacio'
            });
            await client.query('COMMIT');
            res.json({
                eliminado: true,
                id_viaje: resultado.id_viaje,
                bitacora_id: resultado.bitacora_id
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('Error en autoEliminarSiVacio:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // DESPACHAR VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async despacharViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params;
        const { hora_salida, items } = req.body;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Bloquear viaje
            const viajeResult = await client.query(
                'SELECT * FROM viajes WHERE id_viaje = $1 AND id_empresa = $2 FOR UPDATE',
                [id, id_empresa]
            );

            if (viajeResult.rows.length === 0) {
                throw new Error('Viaje no encontrado');
            }

            if (viajeResult.rows[0].estado !== despachosHelper.VIAJE_ESTADOS.PREPARANDO) {
                throw new Error('El viaje ya fue despachado');
            }

            // Actualizar cantidades si se enviaron items editados
            if (items && items.length > 0) {
                for (const itemUpdate of items) {
                    // Buscar el remito_item correspondiente
                    const itemActivo = await despachosHelper.buscarItemActivoEnViajePorPedidoItem(client, {
                        id_empresa,
                        id_viaje: id,
                        id_pedido_item: itemUpdate.id_item
                    });

                    if (itemActivo) {
                        if (itemUpdate.cantidad <= 0) {
                            // Cantidad 0 = anular item (soft-delete con auditoría)
                            await despachosHelper.anularRemitoItem(client, {
                                id_empresa,
                                id_item: itemActivo.id_item,
                                id_usuario,
                                motivo: 'Eliminado en edición pre-despacho (cantidad=0)'
                            });
                        } else {
                            // Actualizar cantidad via helper (recalcula subtotal/total)
                            await despachosHelper.actualizarCantidadItem(client, {
                                id_empresa,
                                id_item: itemActivo.id_item,
                                cantidad: itemUpdate.cantidad
                            });
                        }
                    }
                }
                // Recalcular totales de remitos via helper
                await despachosHelper.recalcularTotalesRemitosViaje(client, id, id_empresa);
            }

            // Verificar que hay remitos
            const remitosResult = await client.query(`
                SELECT r.id_remito, ri.id_producto, ri.cantidad, ri.id_deposito_origen, ri.id_item, ri.id_pedido_item
                FROM remitos r
                JOIN remito_items ri ON r.id_remito = ri.id_remito
                WHERE r.id_viaje = $1 AND r.estado = $2 AND r.id_empresa = $3 AND ri.anulado = false
            `, [id, despachosHelper.REMITO_ESTADOS.BORRADOR, id_empresa]);

            if (remitosResult.rows.length === 0) {
                throw new Error('El viaje no tiene items para despachar');
            }

            // Mover stock a tránsito + actualizar cantidad_remitida (loop único)
            for (const item of remitosResult.rows) {
                const id_deposito = item.id_deposito_origen || req.usuario.id_deposito || 1;
                await stockHelper.despacharDeDeposito(client, {
                    id_empresa, id_deposito,
                    id_producto: item.id_producto,
                    cantidad: item.cantidad,
                    id_remito: item.id_remito,
                    id_usuario,
                    observaciones: `Despacho viaje #${id}`
                });

                if (item.id_pedido_item) {
                    await pedidosHelper.actualizarCantidadRemitida(client, {
                        id_item: item.id_pedido_item,
                        id_empresa,
                        cantidad_remitida: item.cantidad,
                        delta: true
                    });
                }
            }

            // Despachar remitos via helper
            await despachosHelper.despacharRemitosPorViaje(client, id, id_empresa);

            // Cambiar estado viaje via helper
            await despachosHelper.cambiarEstadoViaje(client, {
                id_viaje: id,
                id_empresa,
                nuevo_estado: despachosHelper.VIAJE_ESTADOS.EN_RUTA,
                campos: {
                    hora_salida: hora_salida || new Date().toTimeString().slice(0, 5),
                    fecha_despacho: new Date(),
                    id_usuario_despacho: id_usuario
                }
            });

            await client.query('COMMIT');

            // Retornar viaje actualizado
            const viajeActualizado = await pool.query(`
                SELECT v.*,
                    (SELECT json_agg(json_build_object(
                        'id_remito', r.id_remito,
                        'numero_completo', r.numero_completo,
                        'cliente', c.razon_social,
                        'total', r.total,
                        'id_pedido', r.id_pedido, 'estado', r.estado
                    ))
                    FROM remitos r
                    JOIN clientes c ON r.id_cliente = c.id_cliente
                    WHERE r.id_viaje = v.id_viaje) as remitos
                FROM viajes v
                WHERE v.id_viaje = $1 AND v.id_empresa = $2
            `, [id, id_empresa]);

            res.json({
                success: true,
                message: 'Viaje despachado correctamente',
                viaje: viajeActualizado.rows[0]
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en despacharViaje:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // REGISTRAR REGRESO — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async registrarRegreso(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params;
        const { hora_regreso, remitos } = req.body;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verificar viaje en ruta
            const viajeResult = await client.query(
                'SELECT * FROM viajes WHERE id_viaje = $1 AND id_empresa = $2 FOR UPDATE',
                [id, id_empresa]
            );

            if (viajeResult.rows.length === 0) {
                throw new Error('Viaje no encontrado');
            }

            if (viajeResult.rows[0].estado !== despachosHelper.VIAJE_ESTADOS.EN_RUTA) {
                throw new Error('El viaje no está en ruta');
            }

            let efectivoTotal = 0;

            // Verificar turno de caja si hay cobros en calle
            const hayCobrosCalle = remitos.some(r => parseFloat(r.efectivo_cobrado || 0) > 0);
            let turno = null;
            if (hayCobrosCalle) {
                turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
                if (!turno) {
                    throw new Error('Debe abrir la caja antes de registrar cobros de calle');
                }
            }

            // Procesar cada remito
            for (const remito of remitos) {
                // Obtener items del remito
                const itemsRemito = await client.query(`
                    SELECT ri.*, r.id_pedido
                    FROM remito_items ri
                    JOIN remitos r ON ri.id_remito = r.id_remito
                    WHERE ri.id_remito = $1 AND ri.id_empresa = $2 AND ri.anulado = false
                `, [remito.id_remito, id_empresa]);

                for (const itemRemito of itemsRemito.rows) {
                    const itemData = remito.items?.find(i => i.id_item === itemRemito.id_item);
                    const cantidadEntregada = itemData?.cantidad_entregada ?? itemRemito.cantidad;
                    const cantidadDevuelta = itemRemito.cantidad - cantidadEntregada;

                    // Registrar entrega del item via helper
                    await despachosHelper.registrarEntregaItem(client, {
                        id_empresa,
                        id_item: itemRemito.id_item,
                        cantidad_entregada: cantidadEntregada,
                        cantidad_devuelta: cantidadDevuelta,
                        motivo_devolucion: itemData?.motivo_devolucion || null
                    });

                    // Actualizar cantidad_entregada en pedidoitems via pedidosHelper
                    if (cantidadEntregada > 0) {
                        await pedidosHelper.actualizarCantidadEntregada(client, {
                            id_item: itemRemito.id_pedido_item,
                            id_empresa,
                            cantidad_entregada: cantidadEntregada,
                            delta: true
                        });
                    }

                    const id_deposito = itemRemito.id_deposito_origen || req.usuario.id_deposito || 1;

                    // Devolución (si hubo) — stock_real↑ comprometido↓
                    if (cantidadDevuelta > 0) {
                        await stockHelper.devolverADeposito(client, {
                            id_empresa, id_deposito,
                            id_producto: itemRemito.id_producto,
                            cantidad: cantidadDevuelta,
                            id_remito: remito.id_remito,
                            id_usuario,
                            observaciones: itemData?.motivo_devolucion || 'Devolución en entrega'
                        });
                    }

                    // Entrega confirmada — comprometido↓
                    if (cantidadEntregada > 0) {
                        await stockHelper.confirmarEntregaDeposito(client, {
                            id_empresa, id_deposito,
                            id_producto: itemRemito.id_producto,
                            cantidad: cantidadEntregada,
                            id_remito: remito.id_remito,
                            id_usuario,
                        });
                    }

                    // Decrementar cantidad_remitida por items devueltos (fix re-despacho)
                    if (cantidadDevuelta > 0 && itemRemito.id_pedido_item) {
                        await pedidosHelper.actualizarCantidadRemitida(client, {
                            id_item: itemRemito.id_pedido_item,
                            id_empresa,
                            cantidad_remitida: -cantidadDevuelta,
                            delta: true
                        });
                    }
                }

                // Determinar estado del remito
                const estadoRemito = remito.estado || despachosHelper.REMITO_ESTADOS.ENTREGADO;
                const efectivoCobrado = remito.efectivo_cobrado || 0;
                efectivoTotal += efectivoCobrado;

                // Actualizar estado remito via helper
                await despachosHelper.cambiarEstadoRemito(client, {
                    id_empresa,
                    id_remito: remito.id_remito,
                    nuevo_estado: estadoRemito,
                    campos: {
                        fecha_entrega: new Date(),
                        pago_confirmado: efectivoCobrado > 0,
                        metodo_pago: efectivoCobrado > 0 ? 'efectivo' : null
                    }
                });

                // Registrar cobro si cobró efectivo — via helper unificado (recibo + CC + caja + log)
                if (efectivoCobrado > 0) {
                    const metodoCobroCalle = remito.id_metodo_pago || 1;
                    await despachosHelper.registrarCobroRemito(client, {
                        id_empresa,
                        id_remito: remito.id_remito,
                        id_metodo_pago: metodoCobroCalle,
                        monto: efectivoCobrado,
                        id_usuario,
                        id_turno: turno.id_turno,
                        referencia: `Cobro en calle - Viaje #${id}`
                    });
                }

                // Evento de entrega en el historial del pedido (pedidos_log).
                // TOTAL/PARCIAL se decide en backend por cantidad_entregada del pedido,
                // no por el estado que mande el front.
                const idPedidoRemito = itemsRemito.rows[0]?.id_pedido;
                if (idPedidoRemito) {
                    const { rows: [agg] } = await client.query(
                        `SELECT COALESCE(SUM(cantidad_entregada),0) AS entregado
                           FROM remito_items WHERE id_remito=$1 AND id_empresa=$2 AND anulado=false`,
                        [remito.id_remito, id_empresa]
                    );
                    let accionEntrega;
                    if (parseFloat(agg.entregado) <= 0) {
                        accionEntrega = pedidosHelper.LOG_PEDIDO_ACCIONES.NO_ENTREGADO;
                    } else {
                        const { rows: [chk] } = await client.query(
                            `SELECT bool_and(cantidad_entregada >= cantidad) AS completo
                               FROM pedidoitems WHERE id_pedido=$1 AND id_empresa=$2`,
                            [idPedidoRemito, id_empresa]
                        );
                        accionEntrega = (chk && chk.completo)
                            ? pedidosHelper.LOG_PEDIDO_ACCIONES.ENTREGA_TOTAL
                            : pedidosHelper.LOG_PEDIDO_ACCIONES.ENTREGA_PARCIAL;
                    }
                    const { rows: itemsLog } = await client.query(
                        `SELECT descripcion, cantidad_entregada, cantidad_devuelta
                           FROM remito_items WHERE id_remito=$1 AND id_empresa=$2 AND anulado=false`,
                        [remito.id_remito, id_empresa]
                    );
                    await pedidosHelper.registrarLogPedido(client, {
                        id_pedido: idPedidoRemito,
                        id_empresa,
                        id_usuario,
                        accion: accionEntrega,
                        detalle_despues: {
                            id_remito: remito.id_remito,
                            id_viaje: id,
                            items: itemsLog
                        }
                    });
                }
            }

            // Cambiar estado viaje a finalizado via helper
            await despachosHelper.cambiarEstadoViaje(client, {
                id_viaje: id,
                id_empresa,
                nuevo_estado: despachosHelper.VIAJE_ESTADOS.FINALIZADO,
                campos: {
                    hora_regreso: hora_regreso || new Date().toTimeString().slice(0, 5),
                    fecha_cierre: new Date(),
                    efectivo_recaudado: efectivoTotal,
                    id_usuario_cierre: id_usuario
                }
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Regreso registrado correctamente',
                efectivo_total: efectivoTotal
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en registrarRegreso:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // LIQUIDAR VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async liquidarViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params;
        const { gastos_combustible, gastos_otros, gastos_descripcion, efectivo_entregado } = req.body;

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Verificar viaje finalizado — con lock
            const viajeResult = await client.query(
                'SELECT * FROM viajes WHERE id_viaje = $1 AND id_empresa = $2 FOR UPDATE',
                [id, id_empresa]
            );

            if (viajeResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Viaje no encontrado' });
            }

            if (viajeResult.rows[0].estado !== despachosHelper.VIAJE_ESTADOS.FINALIZADO) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'El viaje debe estar finalizado para liquidar' });
            }

            const viaje = viajeResult.rows[0];
            const totalGastos = (gastos_combustible || 0) + (gastos_otros || 0);
            const debeEntregar = viaje.efectivo_recaudado - totalGastos;
            const diferencia = efectivo_entregado - debeEntregar;

            // Cambiar estado via helper
            await despachosHelper.cambiarEstadoViaje(client, {
                id_viaje: id,
                id_empresa,
                nuevo_estado: despachosHelper.VIAJE_ESTADOS.LIQUIDADO,
                campos: {
                    gastos_combustible: gastos_combustible || 0,
                    gastos_otros: gastos_otros || 0,
                    gastos_descripcion,
                    fecha_liquidacion: new Date(),
                    id_usuario_liquidacion: id_usuario,
                    efectivo_entregado: efectivo_entregado || 0,
                    diferencia_liquidacion: diferencia
                }
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Viaje liquidado correctamente',
                resumen: {
                    efectivo_recaudado: viaje.efectivo_recaudado,
                    gastos: totalGastos,
                    debe_entregar: debeEntregar,
                    efectivo_entregado,
                    diferencia
                }
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en liquidarViaje:', error);
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al liquidar viaje' });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // UTILIDADES (lectura — sin cambios)
    // ════════════════════════════════════════════════════════════════════════════

    async obtenerDepositos(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const result = await pool.query(`
                SELECT * FROM depositos
                WHERE id_empresa = $1 AND activo = true
                ORDER BY es_principal DESC, nombre
            `, [id_empresa]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error en obtenerDepositos:', error);
            res.status(500).json({ error: 'Error al obtener depósitos' });
        }
    },

    async obtenerStockProducto(req, res) {
        const { id_empresa } = req.usuario;
        const { id_producto } = req.params;
        try {
            const result = await pool.query(`
                SELECT
                    id.id_deposito, d.nombre as deposito,
                    id.stock_real, id.stock_comprometido,
                    (id.stock_real - id.stock_comprometido) as disponible
                FROM inventario_deposito id
                JOIN depositos d ON id.id_deposito = d.id_deposito
                WHERE id.id_empresa = $1 AND id.id_producto = $2 AND d.activo = true
                ORDER BY d.es_principal DESC, d.nombre
            `, [id_empresa, id_producto]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error en obtenerStockProducto:', error);
            res.status(500).json({ error: 'Error al obtener stock' });
        }
    },

    async obtenerConfigPlantilla(req, res) {
        try {
            // Cache en memoria — solo lee del disco la primera vez
            if (!despachosController._plantillaConfigCache) {
                const fs = require('fs');
                const path = require('path');
                const configPath = path.join(__dirname, '../../config/plantillas/remito.config.json');
                despachosController._plantillaConfigCache = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                logger.info('[despachos] Config plantilla cargada y cacheada');
            }
            res.json(despachosController._plantillaConfigCache);
        } catch (error) {
            console.error('Error leyendo config de plantilla:', error);
            res.status(500).json({ error: 'Error al obtener configuración' });
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // CANCELAR VIAJE — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async cancelarViaje(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id } = req.params;
        const { motivo = null } = req.body || {};
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const resultado = await despachosHelper.cancelarViajeCompleto(client, {
                id_viaje: parseInt(id, 10),
                id_empresa,
                id_usuario,
                motivo,
                ip: req.ip || req.headers['x-forwarded-for'] || null,
                user_agent: req.headers['user-agent'] || null,
                accion: 'cancelado'
            });
            await client.query('COMMIT');
            res.json({
                success: true,
                message: `Viaje #${resultado.id_viaje} cancelado correctamente`,
                remitos_procesados: resultado.remitos_procesados,
                bitacora_id: resultado.bitacora_id
            });
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('Error en cancelarViaje:', error);
            res.status(400).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // CANCELAR VIAJES VACÍOS — MIGRADO a helper
    // ════════════════════════════════════════════════════════════════════════════

    async cancelarViajesVacios(req, res) {
        const { id_empresa } = req.usuario;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ids = await despachosHelper.eliminarViajesVacios(client, id_empresa);

            await client.query('COMMIT');

            if (ids.length === 0) {
                return res.json({ success: true, message: 'No hay viajes vacíos para eliminar', eliminados: 0 });
            }

            res.json({ success: true, message: `Se eliminaron ${ids.length} viaje(s) vacío(s)`, eliminados: ids.length });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en cancelarViajesVacios:', error);
            res.status(500).json({ error: error.message });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════════════
    // BÚSQUEDAS (lectura — sin cambios)
    // ════════════════════════════════════════════════════════════════════════════

    async buscarRemitos(req, res) {
        const { id_empresa } = req.usuario;
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        try {
            const result = await pool.query(`
                SELECT r.id_remito, r.numero_completo, r.estado, r.fecha_emision,
                       r.direccion_entrega, r.total, r.veces_impreso, r.id_pedido,
                       c.razon_social as cliente, c.telefono
                FROM remitos r
                JOIN clientes c ON r.id_cliente = c.id_cliente
                WHERE r.id_empresa = $1 AND (
                    r.numero_completo ILIKE $2 OR c.razon_social ILIKE $2
                    OR r.direccion_entrega ILIKE $2 OR c.telefono ILIKE $2
                )
                ORDER BY r.fecha_emision DESC LIMIT 10
            `, [id_empresa, '%' + q + '%']);
            res.json(result.rows);
        } catch (error) {
            console.error('Error en buscarRemitos:', error);
            res.status(500).json({ error: 'Error al buscar remitos' });
        }
    },

    async obtenerTrazabilidad(req, res) {
        const { id_empresa } = req.usuario;
        const { tipo, id } = req.params;
        try {
            const result = await pool.query(
                'SELECT obtener_trazabilidad($1, $2, $3) as trazabilidad',
                [tipo, id, id_empresa]
            );
            if (!result.rows[0]?.trazabilidad) {
                return res.status(404).json({ error: 'Documento no encontrado' });
            }
            res.json(result.rows[0].trazabilidad);
        } catch (error) {
            console.error('Error en obtenerTrazabilidad:', error);
            res.status(500).json({ error: 'Error al obtener trazabilidad' });
        }
    },

    async buscarPedidosHistorico(req, res) {
        const { id_empresa } = req.usuario;
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        try {
            const result = await pool.query(`
                SELECT p.id_pedido, p.fecha_creacion, p.total, pe.nombre as estado, pe.id_estado,
                    c.razon_social as cliente, c.telefono,
                    (SELECT COUNT(*) FROM remitos r WHERE r.id_pedido = p.id_pedido AND r.id_empresa = p.id_empresa) as cantidad_remitos
                FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente
                LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
                WHERE p.id_empresa = $1 AND (p.id_pedido::text LIKE $2 OR c.razon_social ILIKE $3 OR c.telefono ILIKE $3)
                ORDER BY p.fecha_creacion DESC LIMIT 15
            `, [id_empresa, '%'+q+'%', '%'+q+'%']);
            res.json(result.rows);
        } catch (error) {
            console.error('Error en buscarPedidosHistorico:', error);
            res.status(500).json({ error: 'Error al buscar pedidos' });
        }
    },

    async obtenerRemitosPedido(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;
        try {
            const pedidoResult = await pool.query(`
                SELECT p.id_pedido, p.fecha_creacion, p.total, p.domicilio_entrega, pe.nombre as estado,
                    c.razon_social as cliente, c.telefono, c.domicilio as domicilio_cliente
                FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente
                LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
                WHERE p.id_pedido = $1 AND p.id_empresa = $2
            `, [id, id_empresa]);
            if (pedidoResult.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
            // Ejecutar remitos y resumen en paralelo
            const [remitosResult, resumenResult] = await Promise.all([
                pool.query(`
                    SELECT r.id_remito, r.numero_completo, r.fecha_emision, r.estado, r.total, r.direccion_entrega,
                        r.veces_impreso, v.id_viaje, v.chofer, v.vehiculo,
                        (SELECT json_agg(json_build_object('descripcion', ri.descripcion, 'cantidad', ri.cantidad,
                            'subtotal', ri.subtotal) ORDER BY ri.id_item) FROM remito_items ri WHERE ri.id_remito = r.id_remito AND ri.id_empresa = r.id_empresa AND ri.anulado = false) as items
                    FROM remitos r LEFT JOIN viajes v ON r.id_viaje = v.id_viaje
                    WHERE r.id_pedido = $1 AND r.id_empresa = $2 ORDER BY r.fecha_emision DESC
                `, [id, id_empresa]),
                pool.query(`
                SELECT pi.id_producto, pr.nombre as producto, pi.cantidad as cantidad_original,
                    COALESCE(SUM(CASE WHEN r.estado = 'entregado' THEN ri.cantidad ELSE 0 END), 0) as entregado,
                    COALESCE(SUM(CASE WHEN r.estado = 'despachado' THEN ri.cantidad ELSE 0 END), 0) as en_transito
                FROM pedidoitems pi JOIN productos pr ON pi.id_producto = pr.id_producto
                LEFT JOIN remito_items ri ON ri.id_producto = pi.id_producto
                    AND ri.id_remito IN (SELECT id_remito FROM remitos WHERE id_pedido = $1 AND id_empresa = $2)
                LEFT JOIN remitos r ON ri.id_remito = r.id_remito
                WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
                GROUP BY pi.id_producto, pr.nombre, pi.cantidad
            `, [id, id_empresa])
            ]);
            res.json({ pedido: pedidoResult.rows[0], remitos: remitosResult.rows, resumen_entregas: resumenResult.rows, total_remitos: remitosResult.rows.length });
        } catch (error) {
            console.error('Error en obtenerRemitosPedido:', error);
            res.status(500).json({ error: 'Error al obtener remitos del pedido' });
        }
    },


    // ═══════════════════════════════════════════════════════════
    // COBRAR REMITO
    // ═══════════════════════════════════════════════════════════
    async cobrarRemito(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_remito = parseInt(req.params.id, 10);
        const { id_metodo_pago, monto, referencia } = req.body;

        if (!id_metodo_pago || !monto) {
            return res.status(400).json({ error: 'id_metodo_pago y monto son obligatorios' });
        }
        if (parseFloat(monto) <= 0) {
            return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Turno obligatorio
            const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);
            if (!turno) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Debe abrir la caja antes de registrar cobros',
                    code: 'CAJA_CERRADA'
                });
            }

            const resultado = await despachosHelper.registrarCobroRemito(client, {
                id_empresa,
                id_remito,
                id_metodo_pago: parseInt(id_metodo_pago, 10),
                monto: parseFloat(monto),
                id_usuario,
                id_turno: turno.id_turno,
                referencia: referencia || null
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Cobro registrado - Recibo ' + resultado.numero_recibo,
                ...resultado
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en cobrarRemito:', error);
            res.status(error.statusCode || 500).json({
                error: error.message || 'Error al registrar cobro'
            });
        } finally {
            client.release();
        }
    },

    async busquedaGlobal(req, res) {
        const { id_empresa } = req.usuario;
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ pedidos: [], remitos: [] });
        try {
            // Ejecutar ambas búsquedas en paralelo
            const [pedidosResult, remitosResult] = await Promise.all([
                pool.query(`
                    SELECT p.id_pedido, p.fecha_creacion, p.total, pe.nombre as estado, pe.id_estado,
                        c.razon_social as cliente, c.telefono,
                        (SELECT COUNT(*) FROM remitos r WHERE r.id_pedido = p.id_pedido) as cantidad_remitos
                    FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente
                    LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
                    WHERE p.id_empresa = $1 AND (p.id_pedido::text LIKE $2 OR c.razon_social ILIKE $3 OR c.telefono ILIKE $3)
                    ORDER BY p.fecha_creacion DESC LIMIT 8
                `, [id_empresa, '%'+q+'%', '%'+q+'%']),
                pool.query(`
                    SELECT r.id_remito, r.numero_completo, r.estado, r.fecha_emision, r.direccion_entrega,
                        r.total, r.veces_impreso, r.id_pedido, c.razon_social as cliente, c.telefono
                    FROM remitos r JOIN clientes c ON r.id_cliente = c.id_cliente
                    WHERE r.id_empresa = $1 AND (r.numero_completo ILIKE $2 OR c.razon_social ILIKE $2
                        OR r.direccion_entrega ILIKE $2 OR c.telefono ILIKE $2 OR r.id_pedido::text LIKE $2)
                    ORDER BY r.fecha_emision DESC LIMIT 8
                `, [id_empresa, '%'+q+'%'])
            ]);
            res.json({ pedidos: pedidosResult.rows, remitos: remitosResult.rows });
        } catch (error) {
            console.error('Error en busquedaGlobal:', error);
            res.status(500).json({ error: 'Error en busqueda global' });
        }
    },

    async actualizarObservacionesRemito(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_remito = parseInt(req.params.id, 10);
        const { observaciones } = req.body;

        if (!id_remito || isNaN(id_remito)) {
            return res.status(400).json({ error: 'id_remito invalido' });
        }
        if (typeof observaciones !== 'string' && observaciones !== null) {
            return res.status(400).json({ error: 'observaciones debe ser string o null' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const remitoActualizado = await despachosHelper.actualizarObservacionesRemito({
                client,
                id_empresa,
                id_remito,
                nueva_obs: observaciones,
                id_usuario
            });

            await client.query('COMMIT');

            res.json({
                success: true,
                message: 'Observaciones actualizadas',
                remito: remitoActualizado
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en actualizarObservacionesRemito:', error);
            res.status(error.statusCode || 500).json({
                error: error.message || 'Error al actualizar observaciones'
            });
        } finally {
            client.release();
        }
    }
};

module.exports = despachosController;
