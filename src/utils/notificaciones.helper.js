/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTIFICACIONES HELPER — ERP LAGO
 * Orquestador central multi-canal. Single write point.
 * ═══════════════════════════════════════════════════════════════════════════
 * Uso:
 *   await notificaciones.notificar(client, {
 *       id_empresa, evento, contexto, destinatarios?
 *   });
 *
 * - Lee configuraciones_empresa: notificaciones.canales.<evento> (JSON array)
 * - Itera adapters segun canales activos
 * - Renderiza template UNA vez (no por canal)
 * - Registra cada intento en notificaciones_log (bitacora obligatoria)
 * - NUNCA throw: errores se loguean y se sigue (no rompe la operacion de negocio)
 *
 * Eventos por defecto:
 *   pedido_web_nuevo            -> admin
 *   pedido_web_aprobado         -> cliente del pedido
 *   pedido_web_rechazado        -> cliente del pedido
 *   pedido_web_pendiente_24h    -> admin
 */
const cfg = require('./config.helper');
const plantillas = require('./plantillas-notificaciones.helper');

function _adapter(canal) {
    switch (canal) {
        case 'email':     return require('./notificaciones/adapter-email');
        case 'whatsapp':  return require('./notificaciones/adapter-whatsapp');
        case 'sms':       return require('./notificaciones/adapter-sms');
        case 'dashboard': return require('./notificaciones/adapter-dashboard');
        default:          return null;
    }
}

async function _canalesParaEvento(client, id_empresa, evento) {
    const clave = `notificaciones.canales.${evento}`;
    const raw = await cfg.get(client, id_empresa, clave, '[]');
    try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.error(`notificaciones: config ${clave} invalida:`, raw);
        return [];
    }
}

async function _resolverDestinatarios(evento, contexto, destinatarios) {
    if (destinatarios && destinatarios.length) return destinatarios;
    if (evento === 'pedido_web_nuevo' || evento === 'pedido_web_pendiente_24h') {
        return [{ tipo: 'admin' }];
    }
    if (evento === 'pedido_web_aprobado' || evento === 'pedido_web_rechazado') {
        return [{ tipo: 'cliente', id_cliente: contexto.id_cliente }];
    }
    return [];
}

async function notificar(client, args) {
    const { id_empresa, evento, contexto = {}, destinatarios = [] } = args;
    if (!id_empresa || !evento) {
        console.error('notificaciones.notificar: id_empresa y evento obligatorios');
        return { enviadas: 0, fallidas: 0, suprimidas: 0, motivo: 'args_invalidos' };
    }

    const canales = await _canalesParaEvento(client, id_empresa, evento);
    if (!canales.length) {
        return { enviadas: 0, fallidas: 0, suprimidas: 0, motivo: 'sin_canales_configurados' };
    }

    const dests = await _resolverDestinatarios(evento, contexto, destinatarios);
    if (!dests.length) {
        return { enviadas: 0, fallidas: 0, suprimidas: 0, motivo: 'sin_destinatarios' };
    }

    let render;
    try {
        render = await plantillas.renderizar(client, id_empresa, evento, contexto);
    } catch (e) {
        console.error(`notificaciones: error template ${evento}:`, e.message);
        render = { asunto: `[${evento}]`, cuerpo: JSON.stringify(contexto), cuerpo_plano: '' };
    }

    let enviadas = 0, fallidas = 0, suprimidas = 0;

    for (const dest of dests) {
        for (const canal of canales) {
            const adapter = _adapter(canal);
            if (!adapter) {
                await _registrar(client, { id_empresa, evento, canal, dest, render, contexto, estado: 'fallida', error: 'adapter_desconocido' });
                fallidas++; continue;
            }
            try {
                const r = await adapter.enviar(client, { id_empresa, evento, contexto, destinatario: dest, render });
                if (r.suprimida) {
                    await _registrar(client, { id_empresa, evento, canal, dest, render, contexto, estado: 'suprimida', error: r.motivo });
                    suprimidas++;
                } else if (r.enviada) {
                    await _registrar(client, { id_empresa, evento, canal, dest, render, contexto, estado: 'enviada' });
                    enviadas++;
                } else {
                    await _registrar(client, { id_empresa, evento, canal, dest, render, contexto, estado: 'fallida', error: r.error || 'sin_detalle' });
                    fallidas++;
                }
            } catch (e) {
                await _registrar(client, { id_empresa, evento, canal, dest, render, contexto, estado: 'fallida', error: e.message });
                fallidas++;
                console.error(`notificaciones: ${canal}/${evento} fallo:`, e.message);
            }
        }
    }

    return { enviadas, fallidas, suprimidas };
}

async function _registrar(client, args) {
    const { id_empresa, evento, canal, dest, render, contexto, estado, error } = args;
    // fecha_envio en JS para evitar "inconsistent types" cuando $10 (estado)
    // se reutiliza dentro de un CASE WHEN. Tambien casteamos $9 a jsonb explicito.
    const fechaEnvio = estado === 'enviada' ? new Date() : null;
    try {
        await client.query(`
            INSERT INTO notificaciones_log (
                id_empresa, evento, canal,
                destinatario_tipo, destinatario_id, destinatario_addr,
                asunto, cuerpo, payload,
                estado, error_msg,
                id_pedido, id_carrito_web,
                fecha_envio
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14
            )
        `, [
            id_empresa, evento, canal,
            dest.tipo, dest.id_cliente || dest.id_usuario || null, dest.addr || null,
            render.asunto || null, render.cuerpo || null, JSON.stringify(contexto),
            estado, error || null,
            contexto.id_pedido || null, contexto.id_carrito_web || null,
            fechaEnvio
        ]);
    } catch (e) {
        console.error('notificaciones_log INSERT fallo:', e.message);
    }
}

module.exports = { notificar };
