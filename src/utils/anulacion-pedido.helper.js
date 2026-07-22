/**
 * ═══════════════════════════════════════════════════════════════════════
 * anulacion-pedido.helper.js — Orquestador SOLID de anulacion en cascada
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Responsabilidad UNICA: decidir el escenario y orquestar los helpers
 * especializados. No duplica logica — delega en:
 *   - pedidos-edicion.helper.anularPedidoCompleto
 *   - facturacion.helper.anularFactura
 *   - despachos.helper (cambiarEstadoRemito, eliminarRemito)
 *   - stock.helper.devolverADeposito
 *   - pedidos.helper.registrarLogPedido
 *
 * Configurable 100% via configuraciones_empresa (sin hardcoded).
 */

const edicionHelper      = require('./pedidos-edicion.helper');
const despachosHelper    = require('./despachos.helper');
const facturacionHelper  = require('./facturacion.helper');
const stockHelper        = require('./stock.helper');
const pedidosHelper      = require('./pedidos.helper');
const logger             = require('./logger');

// ─────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────

const ESCENARIO = {
    S1_LIMPIO:            'S1_LIMPIO',
    S2_PREPARANDO:        'S2_PREPARANDO',
    S3_NO_ENTREGADO:      'S3_NO_ENTREGADO',
    S4_FACTURA_OFFLINE:   'S4_FACTURA_OFFLINE',
    BLOQUEADO:            'BLOQUEADO'
};

const BLOQUEO = {
    DESHABILITADO:   'BLOQ_DESHABILITADO',
    ROL:             'BLOQ_ROL',
    MOTIVO:          'BLOQ_MOTIVO',
    NO_ENCONTRADO:   'BLOQ_NO_ENCONTRADO',
    YA_ANULADO:      'BLOQ_YA_ANULADO',
    EN_VIAJE:        'BLOQ_EN_VIAJE',
    ENTREGADO:       'BLOQ_ENTREGADO',
    PARCIAL:         'BLOQ_PARCIAL',
    FACTURA_CAE:     'BLOQ_FACTURA_CAE'
};

const ESTADOS_TERMINALES_PEDIDO = [
    pedidosHelper.PEDIDO_ESTADOS.CANCELADO,
    10, // Anulado por NC
    pedidosHelper.PEDIDO_ESTADOS.DESCARTADO
];

// ─────────────────────────────────────────────────────────────────────
// PRIVADAS — carga de config y contexto
// ─────────────────────────────────────────────────────────────────────

async function _cargarConfig(client, id_empresa) {
    const { rows } = await client.query(
        `SELECT clave, valor FROM configuraciones_empresa
         WHERE id_empresa = $1 AND clave LIKE 'anulacion.%'`,
        [id_empresa]
    );
    const map = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    return {
        habilitada:                 map['anulacion.habilitada']                 !== 'false',
        roles_autorizados:          (map['anulacion.roles_autorizados']         || 'admin,administrador')
                                        .split(',').map(s => s.trim()).filter(Boolean),
        requiere_motivo:            map['anulacion.requiere_motivo']            !== 'false',
        motivo_min_caracteres:      parseInt(map['anulacion.motivo_min_caracteres'] || '15', 10),
        permite_con_no_entregado:   map['anulacion.permite_con_no_entregado']   !== 'false',
        bloquea_con_factura_cae:    map['anulacion.bloquea_con_factura_cae']    !== 'false'
    };
}

async function _cargarContexto(client, id_pedido, id_empresa) {
    const pr = await client.query(
        `SELECT p.id_pedido, p.id_estado, p.id_cliente, p.total_final, p.tipo_entrega,
                p.anulado_en, pe.nombre AS estado_nombre,
                c.razon_social AS cliente_nombre
           FROM pedidos p
           LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
           LEFT JOIN clientes c       ON p.id_cliente = c.id_cliente
          WHERE p.id_pedido = $1 AND p.id_empresa = $2`,
        [id_pedido, id_empresa]
    );
    if (pr.rows.length === 0) return null;
    const pedido = pr.rows[0];

    const rr = await client.query(
        `SELECT r.id_remito, r.numero_completo, r.estado, r.id_viaje,
                v.estado AS estado_viaje
           FROM remitos r
           LEFT JOIN viajes v ON r.id_viaje = v.id_viaje
          WHERE r.id_pedido = $1 AND r.id_empresa = $2
            AND r.estado NOT IN ('anulado','cancelado')`,
        [id_pedido, id_empresa]
    );

    const fr = await client.query(
        `SELECT id_factura, numero_completo, cae, estado
           FROM facturas
          WHERE id_pedido = $1 AND id_empresa = $2 AND estado != 'anulada'`,
        [id_pedido, id_empresa]
    );

    const pagoRes = await client.query(
        `SELECT COUNT(*) AS cant, COALESCE(SUM(monto),0) AS total
           FROM pagos WHERE id_pedido = $1 AND id_empresa = $2
                       AND id_pago_estado = 2`,
        [id_pedido, id_empresa]
    );

    return {
        pedido,
        remitos:  rr.rows,
        facturas: fr.rows,
        pagos: {
            cantidad: parseInt(pagoRes.rows[0].cant, 10),
            total:    parseFloat(pagoRes.rows[0].total)
        }
    };
}

// ─────────────────────────────────────────────────────────────────────
// PRIVADAS — decisor de escenario
// ─────────────────────────────────────────────────────────────────────

function _decidir(contexto, config) {
    const { pedido, remitos, facturas } = contexto;

    // 0. Ya terminal
    if (ESTADOS_TERMINALES_PEDIDO.includes(pedido.id_estado)) {
        return {
            permitido: false,
            bloqueos: [{
                codigo: BLOQUEO.YA_ANULADO,
                mensaje: `Pedido ya esta en estado terminal (${pedido.estado_nombre})`
            }]
        };
    }

    // 1. Remitos con entregas — bloquear
    const entregados = remitos.filter(r => r.estado === 'entregado');
    if (entregados.length > 0) {
        return {
            permitido: false,
            bloqueos: [{
                codigo: BLOQUEO.ENTREGADO,
                mensaje: `Mercaderia entregada (remitos: ${entregados.map(r=>r.numero_completo).join(', ')}). Emita NC desde notas.html para revertir fiscalmente.`,
                remitos: entregados,
                accion_sugerida: 'EMITIR_NC_MANUAL'
            }]
        };
    }

    const parciales = remitos.filter(r => r.estado === 'parcial');
    if (parciales.length > 0) {
        return {
            permitido: false,
            bloqueos: [{
                codigo: BLOQUEO.PARCIAL,
                mensaje: `Entrega parcial en remitos ${parciales.map(r=>r.numero_completo).join(', ')}. Emita NC por la parte no entregada desde notas.html.`,
                remitos: parciales,
                accion_sugerida: 'EMITIR_NC_MANUAL'
            }]
        };
    }

    // 2. Remitos en viaje en_ruta (despachados) — bloquear
    const enViaje = remitos.filter(r =>
        r.estado === 'despachado' && r.estado_viaje === 'en_ruta'
    );
    if (enViaje.length > 0) {
        return {
            permitido: false,
            bloqueos: [{
                codigo: BLOQUEO.EN_VIAJE,
                mensaje: `Remito(s) en viaje #${[...new Set(enViaje.map(r=>r.id_viaje))].join(', #')} en ruta. Registre el regreso marcando el remito como NO ENTREGADO primero.`,
                remitos: enViaje,
                viajes_bloqueantes: [...new Set(enViaje.map(r => r.id_viaje))],
                accion_sugerida: 'REGISTRAR_REGRESO_VIAJE'
            }]
        };
    }

    // 3. Factura con CAE real — bloquear si asi esta configurado
    const facturasConCAE = facturas.filter(f => f.cae && !f.cae.startsWith('OFFLINE'));
    if (facturasConCAE.length > 0 && config.bloquea_con_factura_cae) {
        return {
            permitido: false,
            bloqueos: [{
                codigo: BLOQUEO.FACTURA_CAE,
                mensaje: `Factura(s) ${facturasConCAE.map(f=>f.numero_completo).join(', ')} con CAE real. Emita NC total desde notas.html — al confirmarla el pedido pasara automaticamente a "Anulado por NC" (estado 10).`,
                facturas: facturasConCAE,
                accion_sugerida: 'EMITIR_NC_MANUAL'
            }]
        };
    }

    // 4. Escenario permitido — decidir cual
    const remitosPreparando = remitos.filter(r =>
        ['pendiente','borrador'].includes(r.estado)
    );
    const remitosNoEntregados = remitos.filter(r => r.estado === 'no_entregado');
    const facturasOffline = facturas.filter(f => !f.cae || f.cae.startsWith('OFFLINE'));

    const acciones = [];
    let escenario = ESCENARIO.S1_LIMPIO;

    if (remitosPreparando.length > 0) {
        escenario = ESCENARIO.S2_PREPARANDO;
        acciones.push({
            tipo: 'ANULAR_REMITOS_PREPARANDO',
            remitos: remitosPreparando.map(r => r.numero_completo),
            detalle: 'Quitar de viaje y devolver stock a deposito origen'
        });
    }
    if (remitosNoEntregados.length > 0) {
        if (escenario === ESCENARIO.S1_LIMPIO) escenario = ESCENARIO.S3_NO_ENTREGADO;
        acciones.push({
            tipo: 'ANULAR_REMITOS_NO_ENTREGADOS',
            remitos: remitosNoEntregados.map(r => r.numero_completo),
            detalle: 'Marcar como anulados (stock ya volvio via no_entregado)'
        });
    }
    if (facturasOffline.length > 0) {
        escenario = ESCENARIO.S4_FACTURA_OFFLINE;
        acciones.push({
            tipo: 'ANULAR_FACTURA_OFFLINE',
            facturas: facturasOffline.map(f => f.numero_completo),
            detalle: 'Anulacion directa (sin CAE real, no requiere NC)'
        });
    }
    acciones.push({
        tipo: 'ANULAR_PEDIDO',
        detalle: `Estado final: 7 (Cancelado). Stock devuelto si retiro. Pagos a CC del cliente como haber.`
    });

    return {
        permitido: true,
        escenario,
        acciones_previstas: acciones,
        resumen: {
            remitos_total: contexto.remitos.length,
            facturas_total: contexto.facturas.length,
            pagos_cantidad: contexto.pagos.cantidad,
            pagos_total: contexto.pagos.total,
            total_pedido: parseFloat(contexto.pedido.total_final)
        }
    };
}

// ─────────────────────────────────────────────────────────────────────
// PRIVADAS — ejecutores de acciones
// ─────────────────────────────────────────────────────────────────────

async function _anularRemitosPreparando(client, {id_empresa, remitos, id_usuario, motivo}) {
    const out = [];
    for (const r of remitos) {
        // 1. Devolver stock comprometido al deposito_origen
        const items = await client.query(
            `SELECT id_producto, cantidad, id_deposito_origen
               FROM remito_items
              WHERE id_remito = $1 AND id_empresa = $2 AND anulado = false`,
            [r.id_remito, id_empresa]
        );
        for (const it of items.rows) {
            if (!it.id_deposito_origen) continue;
            await stockHelper.devolverADeposito(client, {
                id_empresa,
                id_deposito:  it.id_deposito_origen,
                id_producto:  it.id_producto,
                cantidad:     it.cantidad,
                id_remito:    r.id_remito,
                id_usuario,
                observaciones: `Anulacion cascada pedido — ${motivo}`
            });
        }

        // 2. Anular items y remito
        await client.query(
            `UPDATE remito_items SET anulado=true, anulado_por=$1, anulado_en=NOW(),
                    motivo_anulacion=$2
              WHERE id_remito=$3 AND id_empresa=$4 AND anulado=false`,
            [id_usuario, `Anulacion cascada: ${motivo}`, r.id_remito, id_empresa]
        );
        await client.query(
            `UPDATE remitos SET estado='anulado', anulado_por=$1, anulado_en=NOW(),
                    motivo_anulacion=$2
              WHERE id_remito=$3 AND id_empresa=$4`,
            [id_usuario, `Anulacion cascada: ${motivo}`, r.id_remito, id_empresa]
        );
        out.push({ id_remito: r.id_remito, stock_devuelto_items: items.rows.length });
    }
    return out;
}

async function _anularRemitosNoEntregados(client, {id_empresa, remitos, id_usuario, motivo}) {
    // Stock ya volvio por flujo registrarRegreso. Solo marcar formalmente.
    const out = [];
    for (const r of remitos) {
        await client.query(
            `UPDATE remito_items SET anulado=true, anulado_por=$1, anulado_en=NOW(),
                    motivo_anulacion=$2
              WHERE id_remito=$3 AND id_empresa=$4 AND anulado=false`,
            [id_usuario, `Anulacion cascada (stock ya devuelto): ${motivo}`, r.id_remito, id_empresa]
        );
        await client.query(
            `UPDATE remitos SET estado='anulado', anulado_por=$1, anulado_en=NOW(),
                    motivo_anulacion=$2
              WHERE id_remito=$3 AND id_empresa=$4`,
            [id_usuario, `Anulacion cascada (stock ya devuelto): ${motivo}`, r.id_remito, id_empresa]
        );
        out.push({ id_remito: r.id_remito });
    }
    return out;
}

async function _anularFacturasOffline(client, {id_empresa, facturas}) {
    const out = [];
    for (const f of facturas) {
        const r = await facturacionHelper.anularFactura(client, {
            id_factura: f.id_factura,
            id_empresa
        });
        out.push(r);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// PUBLICAS
// ─────────────────────────────────────────────────────────────────────

async function evaluarAnulacion(client, params) {
    const { id_pedido, id_empresa, motivo, rol } = params;
    if (!id_pedido)  throw new Error('evaluarAnulacion: id_pedido requerido');
    if (!id_empresa) throw new Error('evaluarAnulacion: id_empresa requerido');

    const config = await _cargarConfig(client, id_empresa);
    if (!config.habilitada) {
        return { permitido: false, bloqueos: [{
            codigo: BLOQUEO.DESHABILITADO,
            mensaje: 'Anulacion de pedidos deshabilitada en configuracion'
        }]};
    }

    if (rol && !config.roles_autorizados.includes(rol)) {
        return { permitido: false, bloqueos: [{
            codigo: BLOQUEO.ROL,
            mensaje: `Rol '${rol}' no autorizado. Permitidos: ${config.roles_autorizados.join(', ')}`
        }]};
    }

    if (motivo !== undefined) {
        const m = (motivo || '').trim();
        if (config.requiere_motivo && !m) {
            return { permitido: false, bloqueos: [{
                codigo: BLOQUEO.MOTIVO, mensaje: 'Motivo obligatorio'
            }]};
        }
        if (m && m.length < config.motivo_min_caracteres) {
            return { permitido: false, bloqueos: [{
                codigo: BLOQUEO.MOTIVO,
                mensaje: `Motivo debe tener al menos ${config.motivo_min_caracteres} caracteres (tiene ${m.length})`
            }]};
        }
    }

    const contexto = await _cargarContexto(client, id_pedido, id_empresa);
    if (!contexto) {
        return { permitido: false, bloqueos: [{
            codigo: BLOQUEO.NO_ENCONTRADO, mensaje: 'Pedido no encontrado'
        }]};
    }

    return _decidir(contexto, config);
}

async function anularEnCascada(client, params) {
    const { id_pedido, id_empresa, id_usuario, motivo, rol, ip } = params;

    // Reevaluar (protege de carrera)
    const evaluacion = await evaluarAnulacion(client, { id_pedido, id_empresa, motivo, rol });
    if (!evaluacion.permitido) {
        const err = new Error(evaluacion.bloqueos[0].mensaje);
        err.statusCode = 400;
        err.bloqueos = evaluacion.bloqueos;
        throw err;
    }

    const contexto = await _cargarContexto(client, id_pedido, id_empresa);
    const ejecuciones = [];

    // Ejecutar cascada segun escenario
    if (evaluacion.escenario === ESCENARIO.S4_FACTURA_OFFLINE) {
        const fact = contexto.facturas.filter(f => !f.cae || f.cae.startsWith('OFFLINE'));
        ejecuciones.push({ paso: 'facturas_offline',
            resultado: await _anularFacturasOffline(client, { id_empresa, facturas: fact }) });
    }

    const remPrep = contexto.remitos.filter(r => ['pendiente','borrador'].includes(r.estado));
    if (remPrep.length > 0) {
        ejecuciones.push({ paso: 'remitos_preparando',
            resultado: await _anularRemitosPreparando(client, {
                id_empresa, remitos: remPrep, id_usuario, motivo
            })});
    }

    const remNoEnt = contexto.remitos.filter(r => r.estado === 'no_entregado');
    if (remNoEnt.length > 0) {
        ejecuciones.push({ paso: 'remitos_no_entregados',
            resultado: await _anularRemitosNoEntregados(client, {
                id_empresa, remitos: remNoEnt, id_usuario, motivo
            })});
    }

    // Llamar al orquestador existente (anularPedidoCompleto)
    //   hace: stock retiro, pagos -> CC/caja, recargos, estado 7
    const resAnul = await edicionHelper.anularPedidoCompleto(client, {
        id_pedido, id_empresa, id_usuario
    });
    ejecuciones.push({ paso: 'pedido_completo', resultado: resAnul });

    // Auditoria — campos nuevos en pedidos
    await client.query(
        `UPDATE pedidos SET anulado_en=NOW(), anulado_por=$1, motivo_anulacion=$2,
                escenario_anulacion=$3
          WHERE id_pedido=$4 AND id_empresa=$5`,
        [id_usuario, motivo, evaluacion.escenario, id_pedido, id_empresa]
    );

    // Log estructurado
    await pedidosHelper.registrarLogPedido(client, {
        id_pedido, id_empresa, id_usuario,
        accion: 'ANULADO_CASCADA',
        detalle_antes: {
            id_estado_anterior: contexto.pedido.id_estado,
            remitos: contexto.remitos.map(r => ({n: r.numero_completo, e: r.estado})),
            facturas: contexto.facturas.map(f => ({n: f.numero_completo, cae: !!f.cae}))
        },
        detalle_despues: {
            escenario: evaluacion.escenario,
            motivo,
            ejecuciones: ejecuciones.map(e => e.paso)
        },
        ip_origen: ip
    });

    logger.info(`[anulacion-cascada] Pedido #${id_pedido} anulado | escenario=${evaluacion.escenario} | usuario=${id_usuario} | motivo="${motivo}"`);

    return {
        success: true,
        id_pedido,
        escenario: evaluacion.escenario,
        acciones_previstas: evaluacion.acciones_previstas,
        ejecuciones,
        resumen: evaluacion.resumen
    };
}

// ─────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────

module.exports = {
    ESCENARIO,
    BLOQUEO,
    evaluarAnulacion,
    anularEnCascada
};
