'use strict';
/**
 * notas.controller.js - Notas de Crédito/Débito
 *
 * FLUJOS:
 *   origen='factura'     → autocompletado + CAE AFIP (abort-on-failure)
 *   origen='presupuesto' → autocompletado + sin AFIP
 *   origen='manual'      → libre + sin AFIP
 *
 * Rutas:
 *   GET    /api/notas
 *   GET    /api/notas/proximo-numero/:pv/:tipo
 *   GET    /api/notas/comprobante-origen/:tipo/:id
 *   GET    /api/notas/:id
 *   POST   /api/notas
 *   DELETE /api/notas/:id
 */

const pool        = require('../config/database');
const notasHelper = require('../utils/notas.helper');
const afipService = require('../services/afip.service');
const afipAud     = require('../utils/afip-auditoria.helper');
const logger      = require('../utils/logger');
const cajaHelper  = require('../utils/caja.helper');

// ─── LISTAR ──────────────────────────────────────────────────────────────────

async function listar(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { tipo, id_cliente, estado, fecha_desde, fecha_hasta, busqueda, limit, offset } = req.query;

        const resultado = await notasHelper.listarNotas(id_empresa, {
            tipo, id_cliente, estado, fecha_desde, fecha_hasta, busqueda,
            limit:  parseInt(limit)  || 50,
            offset: parseInt(offset) || 0,
        });
        res.json(resultado);
    } catch (error) {
        logger.error('Error listando notas:', error);
        res.status(500).json({ error: 'Error al listar notas', detalle: error.message });
    }
}

// ─── PRÓXIMO NÚMERO ───────────────────────────────────────────────────────────

async function proximoNumero(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { pv, tipo }   = req.params;

        if (!pv || !tipo) {
            return res.status(400).json({ error: 'punto_venta y tipo son requeridos' });
        }
        const tipoNorm = notasHelper.normalizarTipo(tipo);
        if (!tipoNorm) {
            return res.status(400).json({ error: 'tipo debe ser NC/ND o credito/debito' });
        }
        const numero = await notasHelper.consultarProximoNumero(id_empresa, parseInt(pv), tipoNorm);
        res.json({
            proximo_numero: numero,
            punto_venta:    parseInt(pv),
            tipo:           notasHelper.tipoDisplay(tipoNorm),
        });
    } catch (error) {
        logger.error('Error obteniendo próximo número nota:', error);
        res.status(500).json({ error: 'Error al obtener próximo número', detalle: error.message });
    }
}

// ─── DATOS DE COMPROBANTE ORIGEN (nuevo endpoint para autocompletado) ─────────

/**
 * GET /api/notas/comprobante-origen/:tipo/:id
 * tipo = 'factura' | 'presupuesto'
 * Devuelve datos pre-cargados: cliente, items, totales, letra, requiere_afip
 */
async function obtenerComprobanteOrigen(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { tipo, id }   = req.params;

        if (!['factura', 'presupuesto', 'pedido'].includes(tipo)) {
            return res.status(400).json({ error: 'tipo debe ser factura, presupuesto o pedido' });
        }
        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({ error: 'id inválido' });
        }

        const datos = await notasHelper.obtenerDatosComprobante(tipo, parseInt(id), id_empresa);

        // Enriquecimiento: si hay pedido vinculado, agregar disponibles por item + total pagado
        if (datos.id_pedido) {
            const disponibles = await notasHelper.calcularDisponiblePorItem(
                pool, id_empresa, datos.id_pedido
            );
            const total_pagado = await notasHelper.obtenerTotalPagadoPedido(
                pool, id_empresa, datos.id_pedido
            );

            // Match items del comprobante con pedidoitems por id_producto (primer match gana)
            const dispUsados = new Set();
            const matchear = (id_producto) => {
                if (!id_producto) return null;
                for (const d of disponibles) {
                    if (d.id_producto === id_producto && !dispUsados.has(d.id_pedido_item)) {
                        dispUsados.add(d.id_pedido_item);
                        return d;
                    }
                }
                return null;
            };

            datos.items = (datos.items || []).map(it => {
                const m = matchear(it.id_producto);
                return Object.assign({}, it, {
                    id_pedido_item:     m ? m.id_pedido_item     : null,
                    cantidad_pedida:    m ? m.cantidad            : it.cantidad,
                    cantidad_entregada: m ? m.cantidad_entregada  : 0,
                    cantidad_creditada: m ? m.cantidad_creditada  : 0,
                    disponible:         m ? m.disponible          : Number(it.cantidad),
                });
            });

            datos.total_pagado_pedido = total_pagado;
            datos.id_pedido_vinculado = datos.id_pedido;

            // Total exigible actual: total del comprobante menos ya crediteado
            const totalYaCrediteado = disponibles.reduce(
                (acc, d) => acc + (d.cantidad_creditada * (d.precio_unitario || 0) * (1 + (d.iva_porcentaje || 21) / 100)),
                0
            );
            datos.total_exigible_actual = Math.max(0, Number(datos.totales?.total || 0) - totalYaCrediteado);
        }

        res.json(datos);
    } catch (error) {
        logger.error('Error obteniendo comprobante origen:', error);
        const status = error.message.includes('no encontrad') ? 404
            : error.message.includes('anulad') ? 400
            : 500;
        res.status(status).json({ error: error.message });
    }
}

// ─── OBTENER POR ID ───────────────────────────────────────────────────────────

async function obtenerPorId(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const nota = await notasHelper.obtenerNotaCompleta(id_empresa, parseInt(req.params.id));
        if (!nota) return res.status(404).json({ error: 'Nota no encontrada' });
        res.json(nota);
    } catch (error) {
        logger.error('Error obteniendo nota:', error);
        res.status(500).json({ error: 'Error al obtener nota', detalle: error.message });
    }
}

// ─── CREAR ────────────────────────────────────────────────────────────────────

/**
 * POST /api/notas
 * Body:
 * {
 *   tipo_nota:              'NC' | 'ND',
 *   origen:                 'factura' | 'presupuesto' | 'manual',
 *   id_cliente:             number,
 *   punto_venta:            number,
 *   motivo:                 string,
 *   observaciones?:         string,
 *   id_factura_origen?:     number   (solo origen='factura')
 *   id_presupuesto_origen?: number   (solo origen='presupuesto')
 *   letra?:                 'A'|'B'|'C' (si no viene, se deduce del comprobante)
 *   porcentaje_aplicado?:   number
 *   items: [{ id_producto?, descripcion, cantidad, precio_unitario, iva_porcentaje? }]
 * }
 */
async function crear(req, res) {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const {
            tipo_nota, origen,
            id_cliente, punto_venta,
            motivo, observaciones,
            id_factura_origen, id_presupuesto_origen,
            letra, porcentaje_aplicado,
            items,
            idempotency_key,
        } = req.body;

        // ── Validaciones básicas ────────────────────────────────────────────
        const tipo_real = notasHelper.normalizarTipo(tipo_nota);
        if (!tipo_real) {
            return res.status(400).json({ error: 'tipo_nota inválido. Usar NC, ND, credito o debito' });
        }

        const origenFinal = origen || 'manual';
        if (!['factura', 'presupuesto', 'manual', 'pedido'].includes(origenFinal)) {
            return res.status(400).json({ error: 'origen debe ser factura, presupuesto, pedido o manual' });
        }

        if (!id_cliente) {
            return res.status(400).json({ error: 'id_cliente requerido' });
        }
        if (!punto_venta || isNaN(parseInt(punto_venta))) {
            return res.status(400).json({ error: 'punto_venta requerido y debe ser número' });
        }
        if (!motivo || !motivo.trim()) {
            return res.status(400).json({ error: 'motivo requerido' });
        }
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Debe incluir al menos un item' });
        }

        // Validar items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item.cantidad || Number(item.cantidad) <= 0) {
                return res.status(400).json({ error: `Item ${i + 1}: cantidad debe ser mayor a 0` });
            }
            if (item.precio_unitario === undefined || Number(item.precio_unitario) < 0) {
                return res.status(400).json({ error: `Item ${i + 1}: precio_unitario inválido` });
            }
            if (!item.descripcion && !item.id_producto) {
                return res.status(400).json({ error: `Item ${i + 1}: descripcion o id_producto requerido` });
            }
        }

        // ── F3: Idempotencia — si ya existe NC con esta key, devolverla sin re-llamar AFIP ──
        if (idempotency_key) {
            const idemCheck = await client.query(
                `SELECT n.id_nota, n.numero_completo, n.cae, n.vencimiento_cae,
                        n.tipo_nota, n.codigo_tipo, n.numero_nota, n.punto_venta,
                        n.fecha_emision, n.subtotal, n.iva, n.total, n.estado,
                        n.id_factura_origen, n.id_presupuesto_origen, n.id_pedido
                   FROM notas_credito_debito n
                  WHERE n.id_empresa=$1 AND n.idempotency_key=$2`,
                [id_empresa, idempotency_key]
            );
            if (idemCheck.rows.length > 0) {
                const existente = idemCheck.rows[0];
                logger.info(
                    `Idempotencia: NC ya existe id=${existente.id_nota} ` +
                    `numero=${existente.numero_completo} key=${idempotency_key} ` +
                    `- devolviendo sin re-llamar AFIP`
                );
                return res.status(200).json({
                    ...existente,
                    _idempotent_replay: true,
                    _mensaje: 'Esta nota ya fue emitida con la misma operacion. AFIP no fue invocado nuevamente.',
                });
            }
        }

        // ── Variables que se resolverán según el origen ─────────────────────
        let letraFinal   = letra;
        let cae          = null;
        let vencimiento_cae = null;

        // ── FLUJO: desde FACTURA ─────────────────────────────────────────────
        if (origenFinal === 'factura') {
            if (!id_factura_origen) {
                return res.status(400).json({ error: 'id_factura_origen requerido cuando origen=factura' });
            }

            // Validar factura
            const facturaCheck = await client.query(
                `SELECT f.id_factura, f.id_cliente, f.total, f.estado, f.cae,
                        ft.codigo AS letra, f.punto_venta AS pv_origen,
                        f.numero_factura AS num_origen, f.id_tipo_factura,
                        c.cuit_cuil, c.id_condicion_iva,
                        f.fecha_emision
                   FROM facturas f
                   JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
                   JOIN clientes c ON f.id_cliente = c.id_cliente
                  WHERE f.id_factura = $1 AND f.id_empresa = $2`,
                [id_factura_origen, id_empresa]
            );
            if (facturaCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Factura origen no encontrada' });
            }
            const factura = facturaCheck.rows[0];
            if (factura.id_cliente !== parseInt(id_cliente)) {
                return res.status(400).json({ error: 'La factura no pertenece al cliente seleccionado' });
            }
            if (factura.estado === 'anulada') {
                return res.status(400).json({ error: 'No se puede crear nota contra factura anulada' });
            }

            letraFinal = letraFinal || factura.letra;

            // ── AFIP: obtener CAE antes de abrir transacción ─────────────────
            // Abort-on-failure: si AFIP falla, no se crea nada en BD
            const tieneCaeReal = factura.cae && !factura.cae.startsWith('OFFLINE');

            if (tieneCaeReal) {
                // F3-EXT: pre-check de afip_solicitudes para detectar CAE huerfano
                let __reusandoCAE = false;
                let __solicitudId = null;
                if (idempotency_key) {
                    const __pre = await afipAud.consultarPorIdempotencyKey(id_empresa, idempotency_key);
                    if (__pre) {
                        if (__pre.resultado === 'A' && __pre.cae) {
                            logger.info(
                                `[F3-EXT] CAE huerfano reusado id_sol=${__pre.id_solicitud} ` +
                                `cae=${__pre.cae} key=${idempotency_key}`
                            );
                            cae             = __pre.cae;
                            vencimiento_cae = __pre.cae_vencimiento;
                            __reusandoCAE   = true;
                        } else {
                            logger.warn(
                                `[F3-EXT] Solicitud AFIP previa con resultado=` +
                                `${__pre.resultado || 'PENDIENTE'} id_sol=${__pre.id_solicitud}. ` +
                                `Conflicto: requerir verificacion manual en portal AFIP.`
                            );
                            return res.status(409).json({
                                error: 'Conflicto: hay una solicitud AFIP previa con esta operacion',
                                detalle:
                                    `Estado=${__pre.resultado || 'PENDIENTE'}. Verificar en portal AFIP ` +
                                    `si comprobante PV=${__pre.punto_venta} numero=${__pre.numero_solicitado} ` +
                                    `fue emitido. id_solicitud=${__pre.id_solicitud}.`,
                                codigo: 'AFIP_SOLICITUD_PREVIA',
                                id_solicitud: __pre.id_solicitud,
                                resultado_previo: __pre.resultado,
                            });
                        }
                    }
                }

                if (!__reusandoCAE) try {
                    const codigoAfip = notasHelper.determinarCodigoAFIP(tipo_real, letraFinal);
                    const pvInt = parseInt(punto_venta);

                    // Calcular total de los items para AFIP
                    let totalNeto = 0, totalIva = 0;
                    for (const item of items) {
                        const s = Number(item.cantidad) * Number(item.precio_unitario);
                        totalNeto += s;
                        totalIva  += s * (Number(item.iva_porcentaje ?? 21) / 100);
                    }
                    const totalAfip = totalNeto + totalIva;

                    // Obtener próximo número AFIP (consultar a AFIP, no secuencia local)
                    const ultimoAfip = await afipService.ultimoComprobante(pvInt, parseInt(codigoAfip));
                    const proximoNum = ultimoAfip + 1;

                    // F3-EXT: pre-grabar la solicitud ANTES de invocar solicitarCAE
                    if (idempotency_key) {
                        const __preIns = await afipAud.preGrabarSolicitud({
                            id_empresa, idempotency_key,
                            tipo_operacion: 'solicitarCAE',
                            cbte_tipo: parseInt(codigoAfip),
                            punto_venta: pvInt,
                            numero_solicitado: parseInt(proximoNum),
                            importe_total: Math.round((totalNeto + totalIva) * 100) / 100,
                            id_usuario,
                            ip_origen: req.ip || null,
                        });
                        __solicitudId = __preIns.id_solicitud;
                    }

                    // Armar iva_detalle igual que facturas.controller
                    const ivaDetalle = afipService.agruparIVAPorAlicuota(
                        items.map(it => ({
                            subtotal:       Number(it.cantidad) * Number(it.precio_unitario),
                            porcentaje_iva: Number(it.iva_porcentaje ?? 21),
                            iva_calculado:  Number(it.cantidad) * Number(it.precio_unitario) * (Number(it.iva_porcentaje ?? 21) / 100),
                        }))
                    );

                    // DEBUG: ver qué mandamos a AFIP
                    const datosAfip = {
                        punto_venta: pvInt, cbte_tipo_afip: parseInt(codigoAfip),
                        numero_factura: proximoNum, cuit_cliente: factura.cuit_cuil,
                        id_condicion_iva_cliente: factura.id_condicion_iva,
                        neto_gravado: Math.round(totalNeto * 100) / 100,
                        total_iva: Math.round(totalIva * 100) / 100,
                        total: Math.round(totalAfip * 100) / 100,
                        iva_detalle: ivaDetalle,
                    };

                    // Llamar a AFIP (mismo formato que facturas.controller)
                    const respuestaAfip = await afipService.solicitarCAE({
                        punto_venta:             pvInt,
                        cbte_tipo_afip:          parseInt(codigoAfip),
                        numero_factura:          parseInt(proximoNum),
                        cuit_cliente:            factura.cuit_cuil,
                        id_condicion_iva_cliente:factura.id_condicion_iva,
                        neto_gravado:            Math.round(totalNeto * 100) / 100,
                        total_iva:               Math.round(totalIva * 100) / 100,
                        total:                   Math.round(totalAfip * 100) / 100,
                        iva_detalle:             ivaDetalle,
                        cbte_asoc: {
                            tipo:         afipService.tipoFacturaAFIP(factura.id_tipo_factura),
                            punto_venta:  factura.pv_origen,
                            numero:       parseInt(factura.num_origen) || 1,
                            fecha:        factura.fecha_emision
                                ? new Date(factura.fecha_emision).toISOString().slice(0,10).replace(/-/g,'')
                                : undefined,
                        },
                    });

                    if (!respuestaAfip || !respuestaAfip.cae) {
                        // F3-EXT: registrar resultado=R antes del throw
                        if (__solicitudId) {
                            await afipAud.registrarResultado({
                                id_solicitud: __solicitudId,
                                resultado: 'R',
                                error_app: respuestaAfip?.error || 'AFIP no devolvio CAE',
                                afip_errores: respuestaAfip?.errores || null,
                            }).catch(e => logger.error('[F3-EXT] Error registrando resultado R:', e));
                        }
                        throw new Error(
                            respuestaAfip?.error ||
                            'AFIP no devolvió CAE. No se creó la nota.'
                        );
                    }

                    cae             = respuestaAfip.cae;
                    vencimiento_cae = respuestaAfip.cae_vencimiento;

                    // F3-EXT: registrar resultado=A en afip_solicitudes
                    if (__solicitudId) {
                        await afipAud.registrarResultado({
                            id_solicitud: __solicitudId,
                            resultado: 'A',
                            cae,
                            cae_vencimiento: vencimiento_cae,
                            numero_obtenido: parseInt(proximoNum),
                            afip_observaciones: respuestaAfip.observaciones || null,
                        }).catch(e => logger.error('[F3-EXT] Error registrando resultado A:', e));
                    }

                    logger.info(
                        `AFIP OK para nota ${notasHelper.tipoDisplay(tipo_real)}` +
                        ` PV=${pvInt} tipo=${codigoAfip} CAE=${cae}`
                    );
                } catch (afipError) {
                    // F3-EXT: registrar resultado=R con error_app
                    if (__solicitudId) {
                        await afipAud.registrarResultado({
                            id_solicitud: __solicitudId,
                            resultado: 'R',
                            error_app: afipError.message,
                        }).catch(e => logger.error('[F3-EXT] Error registrando excepcion AFIP:', e));
                    }
                    logger.error('Error AFIP al crear nota:', afipError.message);
                    return res.status(502).json({
                        error:   'Error al obtener CAE de AFIP. La nota NO fue creada.',
                        detalle: afipError.message,
                        codigo:  'AFIP_ERROR',
                    });
                }
            } else {
                logger.warn(
                    `Nota sobre factura sin CAE real (OFFLINE/sin CAE). ` +
                    `Se crea sin CAE. Factura=${id_factura_origen}`
                );
            }
        }

        // ── FLUJO: desde PRESUPUESTO ─────────────────────────────────────────
        if (origenFinal === 'presupuesto') {
            if (!id_presupuesto_origen) {
                return res.status(400).json({ error: 'id_presupuesto_origen requerido cuando origen=presupuesto' });
            }
            const presCheck = await client.query(
                `SELECT p.id_presupuesto, p.id_cliente, p.estado,
                        c.id_condicion_iva
                   FROM presupuestos p
                   LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
                  WHERE p.id_presupuesto = $1 AND p.id_empresa = $2`,
                [id_presupuesto_origen, id_empresa]
            );
            if (presCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Presupuesto no encontrado' });
            }
            const pres = presCheck.rows[0];
            if (pres.id_cliente && pres.id_cliente !== parseInt(id_cliente)) {
                return res.status(400).json({ error: 'El presupuesto no pertenece al cliente seleccionado' });
            }
            // Letra desde condición IVA del cliente
            letraFinal = letraFinal || notasHelper.LETRA_POR_CONDICION[pres.id_condicion_iva] || 'B';
            // Sin AFIP: cae y vencimiento_cae quedan null
        }

        // ── FLUJO: MANUAL ────────────────────────────────────────────────────
        if (origenFinal === 'manual') {
            if (!letraFinal) {
                // Deducir letra desde condición IVA del cliente
                const clienteCheck = await client.query(
                    `SELECT id_condicion_iva FROM clientes WHERE id_cliente=$1 AND id_empresa=$2`,
                    [id_cliente, id_empresa]
                );
                if (clienteCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'Cliente no encontrado' });
                }
                letraFinal = notasHelper.LETRA_POR_CONDICION[clienteCheck.rows[0].id_condicion_iva] || 'B';
            }
            // Sin AFIP
        }

        // ── Transacción BD ───────────────────────────────────────────────────
        await client.query('BEGIN');

        // ── Resolver config, pedido y depósito ──
        const config = await notasHelper.obtenerConfigNotas(client, id_empresa);
        const devuelveStockDefault = tipo_real === notasHelper.TIPO_NOTA.CREDITO
            ? config.nc_devuelve_stock
            : config.nd_afecta_stock;
        const devuelve_stock = req.body.devuelve_stock != null
            ? req.body.devuelve_stock
            : devuelveStockDefault;

        let id_pedido_origen = null;
        if (origenFinal === 'factura' && id_factura_origen) {
            id_pedido_origen = await notasHelper.resolverPedidoDesdeFactura(
                client, id_empresa, parseInt(id_factura_origen)
            );
        } else if (origenFinal === 'presupuesto' && id_presupuesto_origen) {
            id_pedido_origen = await notasHelper.resolverPedidoDesdePresupuesto(
                client, id_empresa, parseInt(id_presupuesto_origen)
            );
        }

        else if (origenFinal === 'pedido') {
            const bodyIdPedido = req.body.id_pedido;
            if (!bodyIdPedido || isNaN(parseInt(bodyIdPedido))) {
                return res.status(400).json({ error: 'id_pedido requerido cuando origen=pedido' });
            }
            id_pedido_origen = parseInt(bodyIdPedido);
        }
        // ── Validacion item-por-item contra disponibles del pedido ──
        // Reemplaza el bloqueo grueso anterior por remitos activos.
        // La NC solo puede emitirse sobre cantidad pendiente (no entregada, no crediteada).
        if (id_pedido_origen && tipo_real === notasHelper.TIPO_NOTA.CREDITO) {
            const disponibles = await notasHelper.calcularDisponiblePorItem(
                client, id_empresa, id_pedido_origen
            );
            const dispMap = new Map(disponibles.map(d => [d.id_pedido_item, d]));

            const errores = [];
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                if (!it.id_pedido_item) continue; // items libres (sin link al pedido) no validan
                const disp = dispMap.get(parseInt(it.id_pedido_item));
                if (!disp) {
                    errores.push(`Item ${i + 1}: id_pedido_item=${it.id_pedido_item} no pertenece al pedido`);
                    continue;
                }
                if (Number(it.cantidad) > disp.disponible) {
                    errores.push(
                        `Item ${i + 1} (${disp.sku || disp.descripcion}): ` +
                        `solicitado ${it.cantidad}, disponible ${disp.disponible} ` +
                        `(pedido ${disp.cantidad}, entregado ${disp.cantidad_entregada}, ` +
                        `ya crediteado ${disp.cantidad_creditada})`
                    );
                }
            }
            if (errores.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Cantidades exceden el disponible para crediteo',
                    detalle: errores.join(' | '),
                    codigo: 'CANTIDAD_EXCEDE_DISPONIBLE',
                });
            }
        }

        let id_deposito = null;
        if (devuelve_stock) {
            id_deposito = await notasHelper.resolverDepositoOriginal(
                client, id_empresa, id_pedido_origen, req.usuario
            );
        }

        // 1. Crear nota + items
        const nota = await notasHelper.crearNotaConItems(client, {
            id_empresa, tipo_nota: tipo_real,
            letra: letraFinal,
            id_cliente: parseInt(id_cliente),
            id_usuario,
            punto_venta: parseInt(punto_venta),
            motivo: motivo.trim(),
            observaciones,
            items,
            origen: origenFinal,
            id_factura_origen:     origenFinal === 'factura'     ? parseInt(id_factura_origen)     : null,
            id_presupuesto_origen: origenFinal === 'presupuesto' ? parseInt(id_presupuesto_origen) : null,
            cae,
            vencimiento_cae,
            porcentaje_aplicado,
            devuelve_stock,
            id_deposito,
            id_pedido: id_pedido_origen,
            idempotency_key,
        });

        // 2. Cuenta corriente
        await notasHelper.registrarEnCuentaCorriente(client, id_empresa, nota);

        // 3. Si es NC desde factura → actualizar factura
        if (origenFinal === 'factura' && tipo_real === notasHelper.TIPO_NOTA.CREDITO) {
            await notasHelper.aplicarNCaFactura(
                client, id_empresa, parseInt(id_factura_origen), nota.total
            );
        }

        // 4. Stock: devolver/egresar mercadería si corresponde
        if (devuelve_stock && id_deposito) {
            await notasHelper.procesarStockNota(client, {
                id_empresa, id_deposito, id_usuario, nota, items, tipo_nota: tipo_real,
            });
        }

        // 5. Pedido: evaluar cierre item-por-item (reemplaza evaluarEstadoPedido)
        if (id_pedido_origen && tipo_real === notasHelper.TIPO_NOTA.CREDITO) {
            await notasHelper.evaluarCierrePedido(client, id_empresa, id_pedido_origen);
        }

        // 6. Devolucion de plata (si vino forma_devolucion en el body)
        const forma_devolucion = req.body.forma_devolucion;
        if (forma_devolucion && Number(forma_devolucion.monto) > 0
            && tipo_real === notasHelper.TIPO_NOTA.CREDITO) {
            const id_metodo_pago = parseInt(forma_devolucion.id_metodo_pago);
            const monto          = Number(forma_devolucion.monto);
            if (!id_metodo_pago || isNaN(monto)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'forma_devolucion invalida: requiere id_metodo_pago y monto',
                    codigo: 'FORMA_DEVOLUCION_INVALIDA',
                });
            }
            try {
                // Resolver turno de caja abierto del operador (depósito del JWT)
                // Si no hay turno abierto en ese depósito, requerirTurnoAbierto tira error 400
                const turno = await cajaHelper.requerirTurnoAbierto(client, id_empresa, {
                    id_deposito: req.usuario.id_deposito
                });
                await cajaHelper.registrarMovimiento(client, {
                    id_empresa,
                    id_turno: turno.id_turno,
                    id_usuario,
                    tipo:        'egreso',
                    monto,
                    id_metodo_pago,
                    concepto:    `Devolucion NC ${nota.numero_completo} - ${motivo.trim()}`,
                });
                logger.info(
                    `Devolucion registrada: NC ${nota.numero_completo} - ` +
                    `$${monto} via metodo ${id_metodo_pago}`
                );
            } catch (cajaErr) {
                logger.error('Error registrando devolucion en caja:', cajaErr);
                await client.query('ROLLBACK');
                return res.status(500).json({
                    error: 'NC creada pero fallo el egreso de caja. Transaccion revertida.',
                    detalle: cajaErr.message,
                    codigo: 'DEVOLUCION_CAJA_ERROR',
                });
            }
        }

        await client.query('COMMIT');

        // Devolver nota completa con items y datos de origen
        const notaCompleta = await notasHelper.obtenerNotaCompleta(id_empresa, nota.id_nota);
        res.status(201).json(notaCompleta);

    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error creando nota:', error);
        res.status(500).json({ error: 'Error al crear nota', detalle: error.message });
    } finally {
        client.release();
    }
}

// ─── ANULAR ───────────────────────────────────────────────────────────────────

async function anular(req, res) {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const id_nota = parseInt(req.params.id);

        await client.query('BEGIN');
        const resultado = await notasHelper.anularNota(client, id_empresa, id_nota, id_usuario);
        await client.query('COMMIT');

        res.json({
            mensaje:       `Nota ${resultado.numero_completo} anulada correctamente`,
            aviso_afip:    resultado.tieneCaeReal
                ? 'Esta nota tenía CAE real. Verifique si corresponde emitir contrapartida en AFIP.'
                : null,
            nota:          resultado,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('Error anulando nota:', error);
        const status = error.message.includes('no encontrada') ? 404
            : error.message.includes('ya está anulada') ? 400
            : 500;
        res.status(status).json({ error: error.message });
    } finally {
        client.release();
    }
}

// ─── LISTAR PEDIDOS CON DISPONIBLE PARA NC (origen pedido) ───────────────────

async function listarPedidosCreditoDisponible(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const id_cliente = parseInt(req.query.id_cliente, 10);
        const limit = parseInt(req.query.limit || 30, 10);
        if (!id_cliente || isNaN(id_cliente)) {
            return res.status(400).json({ error: 'id_cliente requerido' });
        }
        const rows = await notasHelper.listarPedidosConDisponibleCliente(id_empresa, id_cliente, limit);
        res.json(rows);
    } catch (error) {
        logger.error('Error listando pedidos con disponible:', error);
        res.status(500).json({ error: error.message });
    }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
    listar,
    proximoNumero,
    obtenerComprobanteOrigen,
    listarPedidosCreditoDisponible,
    obtenerPorId,
    crear,
    anular,
};
