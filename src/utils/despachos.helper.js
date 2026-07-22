/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DESPACHOS HELPER — ERP LAGO
 * Centralización de TODAS las escrituras a: viajes, remitos, remito_items
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLA: Ningún controller escribe directamente en estas tablas.
 *
 * CONSUMIDORES:
 *   - despachos.controller.js (único por ahora)
 *
 * TABLAS:
 *   - viajes        (INSERT, UPDATE, DELETE)
 *   - remitos       (INSERT, UPDATE, DELETE)
 *   - remito_items  (INSERT, UPDATE, DELETE)
 *
 * DEPENDENCIAS:
 *   - pedidosHelper (actualizarCantidadRemitida/Entregada)
 *   - stockHelper   (despacharDeDeposito, devolverADeposito, confirmarEntregaDeposito)
 *
 * Fecha: 2026-02-21 | Fase 5
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');
const pagosHelper = require('./pagos.helper');
const recibosHelper = require('./recibos.helper');
const pedidosHelper = require('./pedidos.helper');
const cajaHelper = require('./caja.helper');
const ccClientesHelper = require('./cc-clientes.helper');
const recargosHelper    = require('./recargos.helper');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const VIAJE_ESTADOS = {
    PREPARANDO: 'preparando',
    EN_RUTA: 'en_ruta',
    FINALIZADO: 'finalizado',
    LIQUIDADO: 'liquidado',
    CANCELADO: 'cancelado'
};

const REMITO_ESTADOS = {
    PENDIENTE: 'pendiente',
    BORRADOR: 'borrador',
    DESPACHADO: 'despachado',
    ENTREGADO: 'entregado',
    PARCIAL: 'parcial',
    NO_ENTREGADO: 'no_entregado',
    ANULADO: 'anulado'
};

// ═══════════════════════════════════════════════════════════════════════════
// VIAJES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo viaje.
 * ÚNICO punto de INSERT INTO viajes.
 */
async function crearViaje(client, datos) {
    const {
        id_empresa, fecha, chofer = null, vehiculo = null,
        observaciones = null, id_usuario
    } = datos;

    if (!id_empresa) throw new Error('despachos.helper.crearViaje: id_empresa obligatorio');
    if (!id_usuario) throw new Error('despachos.helper.crearViaje: id_usuario obligatorio');

    // ── Fecha de negocio: SOLO 'YYYY-MM-DD'. Un timestamp (con T/Z) es siempre un
    //    bug del front (anclaje a UTC) -> se RECHAZA, no se enmascara. Si el usuario
    //    no eligio fecha, se OMITE la columna del INSERT para que dispare
    //    DEFAULT CURRENT_DATE (reloj del server en ART = dia real del instante).
    let _fecha = null;
    if (fecha !== undefined && fecha !== null && String(fecha).trim() !== '') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
            throw new Error(`despachos.helper.crearViaje: fecha invalida '${fecha}' (se espera 'YYYY-MM-DD' sin hora ni timezone)`);
        }
        _fecha = fecha;
    }

    // Columnas/params dinamicos: 'fecha' se incluye SOLO si vino valida del usuario.
    const _cols = ['id_empresa', 'chofer', 'vehiculo', 'observaciones', 'id_usuario_creacion'];
    const _vals = [id_empresa, chofer, vehiculo, observaciones, id_usuario];
    if (_fecha !== null) {
        _cols.splice(1, 0, 'fecha');
        _vals.splice(1, 0, _fecha);
    }
    const _ph = _vals.map((_, i) => `$${i + 1}`).join(', ');

    const { rows: [viaje] } = await client.query(
        `INSERT INTO viajes (${_cols.join(', ')}) VALUES (${_ph}) RETURNING *`,
        _vals
    );

    logger.info(`[despachos.helper] Viaje #${viaje.id_viaje} creado | empresa=${id_empresa} | fecha=${_fecha ?? 'DEFAULT(CURRENT_DATE)'}`);
    return viaje;
}

/**
 * Actualiza campos de un viaje (solo en estado 'preparando').
 */
async function actualizarViaje(client, datos) {
    const { id_viaje, id_empresa, fecha, chofer, vehiculo, observaciones } = datos;

    if (!id_viaje || !id_empresa) throw new Error('despachos.helper.actualizarViaje: id_viaje y id_empresa obligatorios');

    // Verificar estado
    const { rows: [actual] } = await client.query(
        'SELECT estado FROM viajes WHERE id_viaje = $1 AND id_empresa = $2',
        [id_viaje, id_empresa]
    );

    if (!actual) throw new Error(`despachos.helper.actualizarViaje: viaje ${id_viaje} no encontrado`);
    if (actual.estado !== VIAJE_ESTADOS.PREPARANDO) {
        throw new Error('Solo se pueden editar viajes en preparación');
    }

    const { rows: [viaje] } = await client.query(`
        UPDATE viajes SET
            fecha = COALESCE($3, fecha),
            chofer = $4,
            vehiculo = $5,
            observaciones = $6
        WHERE id_viaje = $1 AND id_empresa = $2
        RETURNING *
    `, [id_viaje, id_empresa, fecha, chofer, vehiculo, observaciones]);

    return viaje;
}

/**
 * Cambia el estado de un viaje con campos asociados.
 * Controla la máquina de estados: preparando → en_ruta → finalizado → liquidado
 */
async function cambiarEstadoViaje(client, datos) {
    const { id_viaje, id_empresa, nuevo_estado, campos = {} } = datos;

    if (!id_viaje || !id_empresa) throw new Error('despachos.helper.cambiarEstadoViaje: id_viaje y id_empresa obligatorios');
    if (!nuevo_estado) throw new Error('despachos.helper.cambiarEstadoViaje: nuevo_estado obligatorio');

    const sets = ['estado = $1'];
    const params = [nuevo_estado];
    let idx = 2;

    // Campos permitidos según el estado destino
    const camposPermitidos = {
        [VIAJE_ESTADOS.EN_RUTA]: ['hora_salida', 'fecha_despacho', 'id_usuario_despacho'],
        [VIAJE_ESTADOS.FINALIZADO]: ['hora_regreso', 'fecha_cierre', 'efectivo_recaudado', 'id_usuario_cierre'],
        [VIAJE_ESTADOS.LIQUIDADO]: ['gastos_combustible', 'gastos_otros', 'gastos_descripcion', 'fecha_liquidacion', 'id_usuario_liquidacion', 'efectivo_entregado', 'diferencia_liquidacion']
    };

    const permitidos = camposPermitidos[nuevo_estado] || [];

    for (const [campo, valor] of Object.entries(campos)) {
        if (permitidos.includes(campo)) {
            sets.push(`${campo} = $${idx}`);
            params.push(valor);
            idx++;
        }
    }

    params.push(id_viaje, id_empresa);

    const { rows: [viaje] } = await client.query(`
        UPDATE viajes SET ${sets.join(', ')}
        WHERE id_viaje = $${idx} AND id_empresa = $${idx + 1}
        RETURNING *
    `, params);

    if (!viaje) throw new Error(`despachos.helper.cambiarEstadoViaje: viaje ${id_viaje} no encontrado`);

    logger.info(`[despachos.helper] Viaje #${id_viaje} → ${nuevo_estado}`);
    return viaje;
}

/**
 * Elimina un viaje (solo preparando, sin remitos o batch).
 */
async function eliminarViaje(client, id_viaje, id_empresa) {
    if (!id_viaje || !id_empresa) throw new Error('despachos.helper.eliminarViaje: id_viaje y id_empresa obligatorios');

    await client.query('UPDATE viajes SET estado = $3 WHERE id_viaje = $1 AND id_empresa = $2', [id_viaje, id_empresa, VIAJE_ESTADOS.CANCELADO]);

    logger.info(`[despachos.helper] Viaje #${id_viaje} cancelado (anulacion logica)`);
}

/**
 * Elimina viajes vacíos (sin remitos) en estado preparando.
 * Operación batch.
 */
async function eliminarViajesVacios(client, id_empresa) {
    const { rows } = await client.query(`
        SELECT v.id_viaje FROM viajes v
        LEFT JOIN remitos r ON v.id_viaje = r.id_viaje
        WHERE v.id_empresa = $1 AND v.estado = $2
        GROUP BY v.id_viaje
        HAVING COUNT(r.id_remito) = 0
    `, [id_empresa, VIAJE_ESTADOS.PREPARANDO]);

    const ids = rows.map(v => v.id_viaje);

    if (ids.length > 0) {
        await client.query('UPDATE viajes SET estado = $3 WHERE id_viaje = ANY($1) AND id_empresa = $2', [ids, id_empresa, VIAJE_ESTADOS.CANCELADO]);
        logger.info(`[despachos.helper] ${ids.length} viaje(s) vacío(s) cancelados (anulacion logica)`);
    }

    return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// REMITOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo remito borrador.
 * ÚNICO punto de INSERT INTO remitos.
 */
async function crearRemito(client, datos) {
    const {
        id_empresa, id_cliente, id_pedido, id_usuario, id_viaje,
        numero_remito, punto_venta = 1,
        direccion_entrega = null, observaciones = null
    } = datos;

    if (!id_empresa || !id_cliente || !id_usuario) {
        throw new Error('despachos.helper.crearRemito: id_empresa, id_cliente, id_usuario obligatorios');
    }

    const { rows: [remito] } = await client.query(`
        INSERT INTO remitos (
            id_empresa, id_cliente, id_pedido, id_usuario, id_viaje,
            numero_remito, punto_venta, estado,
            direccion_entrega, observaciones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `, [
        id_empresa, id_cliente, id_pedido, id_usuario, id_viaje,
        numero_remito, punto_venta, REMITO_ESTADOS.BORRADOR,
        direccion_entrega, observaciones
    ]);

    logger.info(`[despachos.helper] Remito #${remito.id_remito} creado | viaje=${id_viaje} pedido=${id_pedido}`);
    return remito;
}

/**
 * Cambia el estado de un remito con campos asociados.
 */
async function cambiarEstadoRemito(client, datos) {
    const { id_empresa, id_remito, nuevo_estado, campos = {} } = datos;

    if (!id_empresa) throw new Error('despachos.helper.cambiarEstadoRemito: id_empresa obligatorio');
    if (!id_remito) throw new Error('despachos.helper.cambiarEstadoRemito: id_remito obligatorio');
    if (!nuevo_estado) throw new Error('despachos.helper.cambiarEstadoRemito: nuevo_estado obligatorio');

    const sets = ['estado = $1'];
    const params = [nuevo_estado];
    let idx = 2;

    const camposPermitidos = [
        'fecha_salida', 'fecha_entrega', 'pago_confirmado', 'metodo_pago'
    ];

    for (const [campo, valor] of Object.entries(campos)) {
        if (camposPermitidos.includes(campo)) {
            sets.push(`${campo} = $${idx}`);
            params.push(valor);
            idx++;
        }
    }

    params.push(id_remito, id_empresa);

    const { rows: [remito] } = await client.query(`
        UPDATE remitos SET ${sets.join(', ')}
        WHERE id_remito = $${idx} AND id_empresa = $${idx + 1}
        RETURNING *
    `, params);

    if (!remito) throw new Error(`despachos.helper.cambiarEstadoRemito: remito ${id_remito} no encontrado`);

    return remito;
}

/**
 * Despacha todos los remitos borrador de un viaje.
 * Cambia estado a 'despachado' y marca fecha_salida.
 */
async function despacharRemitosPorViaje(client, id_viaje, id_empresa) {
    if (!id_viaje) throw new Error('despachos.helper.despacharRemitosPorViaje: id_viaje obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.despacharRemitosPorViaje: id_empresa obligatorio');

    const { rowCount } = await client.query(`
        UPDATE remitos SET estado = $1, fecha_salida = NOW()
        WHERE id_viaje = $2 AND estado = $3 AND id_empresa = $4
    `, [REMITO_ESTADOS.DESPACHADO, id_viaje, REMITO_ESTADOS.BORRADOR, id_empresa]);

    logger.info(`[despachos.helper] ${rowCount} remitos despachados para viaje #${id_viaje}`);
    return rowCount;
}

/**
 * Recalcula totales de un remito desde sus items.
 */
async function recalcularTotalesRemito(client, id_remito, id_empresa) {
    if (!id_remito) throw new Error('despachos.helper.recalcularTotalesRemito: id_remito obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.recalcularTotalesRemito: id_empresa obligatorio');

    const { rows: [remito] } = await client.query(`
        UPDATE remitos SET
            subtotal = (SELECT COALESCE(SUM(subtotal), 0) FROM remito_items WHERE id_remito = $1 AND id_empresa = $2 AND anulado = false),
            total = (SELECT COALESCE(SUM(total), 0) FROM remito_items WHERE id_remito = $1 AND id_empresa = $2 AND anulado = false)
        WHERE id_remito = $1 AND id_empresa = $2
        RETURNING subtotal, total
    `, [id_remito, id_empresa]);

    return remito;
}

/**
 * Recalcula totales de todos los remitos borrador de un viaje.
 */
async function recalcularTotalesRemitosViaje(client, id_viaje, id_empresa) {
    if (!id_empresa) throw new Error('despachos.helper.recalcularTotalesRemitosViaje: id_empresa obligatorio');

    await client.query(`
        UPDATE remitos SET
            subtotal = (SELECT COALESCE(SUM(subtotal), 0) FROM remito_items WHERE id_remito = remitos.id_remito AND id_empresa = $3 AND anulado = false),
            total = (SELECT COALESCE(SUM(total), 0) FROM remito_items WHERE id_remito = remitos.id_remito AND id_empresa = $3 AND anulado = false)
        WHERE id_viaje = $1 AND estado = $2 AND id_empresa = $3
    `, [id_viaje, REMITO_ESTADOS.BORRADOR, id_empresa]);
}

/**
 * Incrementa contador de impresiones de un remito.
 */
async function registrarImpresion(client, params) {
    // Firma retrocompatible: admite (client, id_remito, id_empresa) y (client, {obj})
    let id_remito, id_empresa, id_usuario, ip_origen, resultado, mensaje_error;
    if (typeof params === 'number') {
        // Llamada legacy: registrarImpresion(client, id_remito, id_empresa)
        id_remito = params;
        id_empresa = arguments[2];
        id_usuario = null;
        ip_origen = null;
        resultado = 'ok';
        mensaje_error = null;
    } else {
        ({ id_empresa, id_remito, id_usuario = null, ip_origen = null,
           resultado = 'ok', mensaje_error = null } = params || {});
    }

    if (!id_remito) throw new Error('despachos.helper.registrarImpresion: id_remito obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.registrarImpresion: id_empresa obligatorio');

    // 1. Leer estado actual del remito (para calcular es_reimpresion y numero_impresion)
    const rem = await client.query(
        'SELECT veces_impreso, numero_completo FROM remitos WHERE id_remito = $1 AND id_empresa = $2',
        [id_remito, id_empresa]
    );
    if (rem.rows.length === 0) {
        throw new Error(`despachos.helper.registrarImpresion: remito ${id_remito} no encontrado en empresa ${id_empresa}`);
    }
    const vecesPrevias = parseInt(rem.rows[0].veces_impreso || 0);
    const esReimpresion = vecesPrevias > 0;
    const numeroImpresion = vecesPrevias + 1;
    const numeroCompleto = rem.rows[0].numero_completo;

    // 2. Incrementar contador en remitos (operacion critica, no falla)
    await client.query(`
        UPDATE remitos SET
            veces_impreso = COALESCE(veces_impreso, 0) + 1,
            ultima_impresion = NOW()
        WHERE id_remito = $1 AND id_empresa = $2
    `, [id_remito, id_empresa]);

    // 3. Leer config de auditoria (con fallback si no existe)
    let auditoriaActiva = true;
    try {
        const cfg = await client.query(
            "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'auditoria.log_impresiones.activo'",
            [id_empresa]
        );
        if (cfg.rows.length > 0) {
            auditoriaActiva = cfg.rows[0].valor === 'true';
        }
    } catch (e) {
        logger.warn('[despachos.helper.registrarImpresion] No se pudo leer config auditoria, usando default true');
    }

    // 4. Registrar en log_impresiones (isolated try/catch: no debe romper la impresion)
    if (auditoriaActiva) {
        try {
            await client.query(`
                INSERT INTO log_impresiones
                    (id_empresa, tipo_documento, id_documento, numero_documento,
                     id_usuario, fecha_impresion, resultado, mensaje_error,
                     es_reimpresion, numero_impresion, ip_origen)
                VALUES ($1, 'remito', $2, $3, $4, NOW(), $5, $6, $7, $8, $9)
            `, [id_empresa, id_remito, numeroCompleto, id_usuario,
                resultado, mensaje_error, esReimpresion, numeroImpresion, ip_origen]);
        } catch (logError) {
            // Auditoria no puede tumbar la impresion del remito
            logger.warn('[despachos.helper.registrarImpresion] Fallo log_impresiones: ' + logError.message);
        }
    }
}
/**
 * Elimina un remito de un viaje segun su estado (SOLID: una sola responsabilidad).
 * - BORRADOR sin movs en movimientos_stock_deposito -> DELETE fisico (CASCADE items)
 * - BORRADOR con movs                               -> anular items + anular remito + desvincular
 * - ANULADO                                          -> solo desvincular (id_viaje=NULL)
 * Si no encuentra el remito en ese viaje, lanza Error (antes devolvia silencioso).
 *
 * Retorna: { accion: 'eliminado'|'anulado_desvinculado'|'desvinculado', id_remito, estado_previo }
 */
async function eliminarRemito(client, datos) {
    const { id_empresa, id_remito, id_viaje, id_usuario = null, motivo = 'Quitado del viaje' } = datos;

    if (!id_empresa) throw new Error('despachos.helper.eliminarRemito: id_empresa obligatorio');
    if (!id_remito)  throw new Error('despachos.helper.eliminarRemito: id_remito obligatorio');
    if (!id_viaje)   throw new Error('despachos.helper.eliminarRemito: id_viaje obligatorio');

    // 1. Buscar el remito y su estado actual (lock)
    const { rows: [remito] } = await client.query(
        `SELECT id_remito, estado FROM remitos
         WHERE id_remito=$1 AND id_viaje=$2 AND id_empresa=$3 FOR UPDATE`,
        [id_remito, id_viaje, id_empresa]
    );
    if (!remito) {
        throw new Error(`despachos.helper.eliminarRemito: remito #${id_remito} no encontrado en viaje #${id_viaje}`);
    }

    const estado_previo = remito.estado;

    // 2. Rama segun estado
    if (estado_previo === REMITO_ESTADOS.ANULADO) {
        // Ya anulado: solo desvincular del viaje para preservar historia/auditoria
        await client.query(
            `UPDATE remitos SET id_viaje=NULL WHERE id_remito=$1 AND id_empresa=$2`,
            [id_remito, id_empresa]
        );
        logger.info(`[despachos.helper.eliminarRemito] Remito #${id_remito} (anulado) desvinculado de viaje #${id_viaje}`);
        return { accion: 'desvinculado', id_remito, estado_previo };
    }

    if (estado_previo !== REMITO_ESTADOS.BORRADOR) {
        throw new Error(`despachos.helper.eliminarRemito: remito #${id_remito} en estado '${estado_previo}' no puede quitarse del viaje`);
    }

    // BORRADOR: chequear si tiene movimientos de stock
    const { rows: [movs] } = await client.query(
        `SELECT COUNT(*)::int AS cant FROM movimientos_stock_deposito WHERE id_remito=$1`,
        [id_remito]
    );

    if (movs.cant === 0) {
        // Sin movimientos: DELETE fisico (CASCADE limpia remito_items)
        const { rowCount } = await client.query(
            `DELETE FROM remitos WHERE id_remito=$1 AND id_viaje=$2 AND id_empresa=$3 AND estado=$4`,
            [id_remito, id_viaje, id_empresa, REMITO_ESTADOS.BORRADOR]
        );
        if (rowCount === 0) {
            throw new Error(`despachos.helper.eliminarRemito: DELETE fisico no afecto filas para remito #${id_remito}`);
        }
        logger.info(`[despachos.helper.eliminarRemito] Remito #${id_remito} borrado fisicamente de viaje #${id_viaje}`);
        return { accion: 'eliminado', id_remito, estado_previo };
    }

    // Con movimientos: anular items, anular remito, desvincular
    await client.query(
        `UPDATE remito_items SET anulado=true, anulado_por=$1, anulado_en=NOW(), motivo_anulacion=$2
         WHERE id_remito=$3 AND id_empresa=$4 AND anulado=false`,
        [id_usuario, motivo, id_remito, id_empresa]
    );
    await client.query(
        `UPDATE remitos SET estado=$1, anulado_por=$2, anulado_en=NOW(), motivo_anulacion=$3, id_viaje=NULL
         WHERE id_remito=$4 AND id_empresa=$5`,
        [REMITO_ESTADOS.ANULADO, id_usuario, motivo, id_remito, id_empresa]
    );
    logger.info(`[despachos.helper.eliminarRemito] Remito #${id_remito} anulado y desvinculado (tenia ${movs.cant} movs de stock)`);
    return { accion: 'anulado_desvinculado', id_remito, estado_previo };
}

/**
 * Elimina remitos e items de un viaje (para cancelación).
 */
async function eliminarRemitosViaje(client, id_viaje, id_empresa) {
    if (!id_empresa) throw new Error('despachos.helper.eliminarRemitosViaje: id_empresa obligatorio');

    await client.query(`
        DELETE FROM remito_items WHERE id_remito IN (SELECT id_remito FROM remitos WHERE id_viaje = $1 AND id_empresa = $2) AND id_empresa = $2
    `, [id_viaje, id_empresa]);

    const { rowCount } = await client.query('DELETE FROM remitos WHERE id_viaje = $1 AND id_empresa = $2', [id_viaje, id_empresa]);

    logger.info(`[despachos.helper] ${rowCount} remitos eliminados de viaje #${id_viaje}`);
    return rowCount;
}

// ═══════════════════════════════════════════════════════════════════════════
// REMITO ITEMS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un item en un remito.
 * ÚNICO punto de INSERT INTO remito_items.
 */
async function crearRemitoItem(client, datos) {
    const {
        id_empresa, id_remito, id_producto, id_pedido_item,
        descripcion, cantidad, precio_unitario = 0,
        iva_porcentaje = 21, id_deposito_origen = null
    } = datos;

    if (!id_remito || !id_producto) {
        throw new Error('despachos.helper.crearRemitoItem: id_remito y id_producto obligatorios');
    }

    const cantNum = parseFloat(cantidad);
    const precioNum = parseFloat(precio_unitario);
    const ivaNum = parseFloat(iva_porcentaje);
    const subtotal = Math.round(cantNum * precioNum * 100) / 100;
    const total = Math.round(subtotal * (1 + ivaNum / 100) * 100) / 100;

    const { rows: [item] } = await client.query(`
        INSERT INTO remito_items (
            id_empresa, id_remito, id_producto, id_pedido_item,
            descripcion, cantidad, precio_unitario,
            iva_porcentaje, subtotal, total, id_deposito_origen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
    `, [
        id_empresa, id_remito, id_producto, id_pedido_item,
        descripcion, cantNum, precioNum,
        ivaNum, subtotal, total, id_deposito_origen
    ]);

    return item;
}

/**
 * Incrementa la cantidad de un item existente (cuando se agrega más al mismo pedido_item).
 */
async function incrementarCantidadItem(client, datos) {
    const { id_empresa, id_remito, id_pedido_item, cantidad_adicional, id_deposito } = datos;

    if (!id_empresa) throw new Error('despachos.helper.incrementarCantidadItem: id_empresa obligatorio');
    if (!id_remito || !id_pedido_item) {
        throw new Error('despachos.helper.incrementarCantidadItem: id_remito y id_pedido_item obligatorios');
    }

    const { rows: [item] } = await client.query(`
        UPDATE remito_items
        SET cantidad = cantidad + $3,
            subtotal = (cantidad + $3) * precio_unitario,
            total = (cantidad + $3) * precio_unitario * (1 + iva_porcentaje / 100),
            id_deposito_origen = COALESCE($4, id_deposito_origen)
        WHERE id_remito = $1 AND id_pedido_item = $2 AND id_empresa = $5
        RETURNING *
    `, [id_remito, id_pedido_item, cantidad_adicional, id_deposito, id_empresa]);

    return item;
}

/**
 * Actualiza cantidad de un item (pre-despacho, edición).
 */
async function actualizarCantidadItem(client, datos) {
    const { id_empresa, id_item, cantidad } = datos;

    if (!id_empresa) throw new Error('despachos.helper.actualizarCantidadItem: id_empresa obligatorio');
    if (!id_item) throw new Error('despachos.helper.actualizarCantidadItem: id_item obligatorio');

    // Obtener precio e IVA actuales para recalcular
    const { rows: [actual] } = await client.query(
        'SELECT precio_unitario, iva_porcentaje FROM remito_items WHERE id_item = $1 AND id_empresa = $2',
        [id_item, id_empresa]
    );

    if (!actual) throw new Error(`despachos.helper.actualizarCantidadItem: item ${id_item} no encontrado`);

    const cantNum = parseFloat(cantidad);
    const subtotal = Math.round(cantNum * parseFloat(actual.precio_unitario) * 100) / 100;
    const total = Math.round(subtotal * (1 + parseFloat(actual.iva_porcentaje) / 100) * 100) / 100;

    const { rows: [item] } = await client.query(`
        UPDATE remito_items SET
            cantidad = $1, subtotal = $2, total = $3
        WHERE id_item = $4 AND id_empresa = $5
        RETURNING *
    `, [cantNum, subtotal, total, id_item, id_empresa]);

    return item;
}

/**
 * Registra entrega de un item (cantidad_entregada, cantidad_devuelta, motivo).
 */
async function registrarEntregaItem(client, datos) {
    const { id_empresa, id_item, cantidad_entregada, cantidad_devuelta = 0, motivo_devolucion = null } = datos;

    if (!id_empresa) throw new Error('despachos.helper.registrarEntregaItem: id_empresa obligatorio');
    if (!id_item) throw new Error('despachos.helper.registrarEntregaItem: id_item obligatorio');

    const { rows: [item] } = await client.query(`
        UPDATE remito_items SET
            cantidad_entregada = $2,
            cantidad_devuelta = $3,
            motivo_devolucion = $4
        WHERE id_item = $1 AND id_empresa = $5
        RETURNING *
    `, [id_item, cantidad_entregada, cantidad_devuelta, motivo_devolucion, id_empresa]);

    if (!item) throw new Error(`despachos.helper.registrarEntregaItem: item ${id_item} no encontrado`);

    return item;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════



/**
 * Anula un item de remito (soft-delete con auditoría).
 * NUNCA se elimina físicamente — queda registro de quién y cuándo.
 */
async function anularRemitoItem(client, datos) {
    const { id_empresa, id_item, id_usuario, motivo = 'Eliminado en edición pre-despacho' } = datos;

    if (!id_empresa) throw new Error('despachos.helper.anularRemitoItem: id_empresa obligatorio');
    if (!id_item) throw new Error('despachos.helper.anularRemitoItem: id_item obligatorio');
    if (!id_usuario) throw new Error('despachos.helper.anularRemitoItem: id_usuario obligatorio');

    const { rows: [item] } = await client.query(`
        UPDATE remito_items SET
            anulado = true,
            anulado_por = $2,
            anulado_en = NOW(),
            motivo_anulacion = $3
        WHERE id_item = $1 AND id_empresa = $4 AND anulado = false
        RETURNING *
    `, [id_item, id_usuario, motivo, id_empresa]);

    if (!item) throw new Error(`despachos.helper.anularRemitoItem: item ${id_item} no encontrado o ya anulado`);

    logger.info(`[despachos.helper] Remito item #${id_item} anulado por usuario ${id_usuario}: ${motivo}`);
    return item;
}

// ═══════════════════════════════════════════════════════════════
// COBRO EN DESPACHOS
// ═══════════════════════════════════════════════════════════════

/**
 * Siguiente número de recibo — delegado a recibos.helper (atómico).
 */
async function proximoNumeroRecibo(client, id_empresa) {
    return await recibosHelper.proximoNumeroRecibo(client, id_empresa);
}

/**
 * registrarCobroRemito — ÚNICO punto de cobro desde despachos.
 * Orquesta: pagos + recibos + recibo_items + pedidos_log
 *
 * @param {object} client - pg client (dentro de transacción)
 * @param {object} params
 * @returns {{ id_pago, id_recibo, numero_recibo, saldo_restante }}
 */
async function registrarCobroRemito(client, params) {
    const {
        id_empresa, id_remito, id_metodo_pago, monto,
        id_usuario, id_turno, referencia
    } = params;

    // ═══ 1. VALIDAR REMITO ═══
    const remitoCheck = await client.query(
        `SELECT r.id_remito, r.id_pedido, r.id_cliente, r.numero_completo,
                c.razon_social as cliente_nombre
         FROM remitos r
         LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
         WHERE r.id_remito = $1 AND r.id_empresa = $2`,
        [id_remito, id_empresa]
    );
    if (remitoCheck.rows.length === 0) {
        const err = new Error('Remito no encontrado'); err.statusCode = 404; throw err;
    }
    const remito = remitoCheck.rows[0];

    if (!remito.id_pedido) {
        const err = new Error('Remito sin pedido asociado'); err.statusCode = 400; throw err;
    }

    // ═══ 2. CONSULTAR SALDO ═══
    const saldoCheck = await client.query(
        'SELECT pedido_total, total_pagado, saldo FROM v_saldo_pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [remito.id_pedido, id_empresa]
    );
    if (saldoCheck.rows.length === 0) {
        const err = new Error('No se pudo obtener saldo del pedido'); err.statusCode = 400; throw err;
    }
    const { saldo } = saldoCheck.rows[0];
    const montoNum = parseFloat(monto);

    if (parseFloat(saldo) < 1) {
        const err = new Error('El pedido ya está pagado'); err.statusCode = 400; throw err;
    }
    if (montoNum > parseFloat(saldo) + 0.01) {
        const err = new Error('El monto ($' + montoNum.toFixed(2) + ') excede el saldo ($' + parseFloat(saldo).toFixed(2) + ')');
        err.statusCode = 400; throw err;
    }

    // ═══ 3. REGISTRAR PAGO ═══
    const pago = await pagosHelper.registrarPago(client, {
        id_empresa,
        id_pedido: remito.id_pedido,
        id_metodo_pago,
        monto: montoNum,
        id_usuario,
        id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
        id_turno,
        id_transaccion_externa: referencia || null,
        observaciones: 'Cobro en despacho - Remito ' + remito.numero_completo,
        concepto_prefijo: 'Cobro despacho',
        origen: 'despachos',
        registrar_en_cc: false
    });

    // ═══ 3b. OBTENER MONEDA DEFECTO ═══
    const monedaRes = await client.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'moneda_defecto'",
        [id_empresa]
    );
    const idMoneda = monedaRes.rows.length > 0 ? parseInt(monedaRes.rows[0].valor) : 1;

    // ═══ 4. CREAR RECIBO ═══
    const numeroRecibo = await proximoNumeroRecibo(client, id_empresa);
    const recibo = await recibosHelper.crearRecibo(client, {
        id_empresa,
        id_cliente: remito.id_cliente,
        id_usuario,
        id_turno,
        numero_recibo: numeroRecibo,
        total_recibo: montoNum,
        id_moneda_recibo: idMoneda,
        concepto: 'Cobro despacho - Remito ' + remito.numero_completo + ' - ' + (remito.cliente_nombre || ''),
        observaciones: referencia ? 'Ref: ' + referencia : null
    });

    // ═══ 5. RECIBO ITEM ═══
    const idFormaPago = await recargosHelper.resolverFormaPago(client, id_empresa, id_metodo_pago);
    await recibosHelper.insertarReciboItem(client, {
        id_empresa,
        id_recibo: recibo.id_recibo,
        id_forma_pago: idFormaPago,
        id_moneda: idMoneda,
        monto_original: montoNum,
        cotizacion_usada: 1,
        monto_convertido: montoNum,
        numero_referencia: referencia || null
    });

    // ═══ 6. LOG AUDITORÍA ═══
    await pedidosHelper.registrarLogPedido(client, {
        id_pedido: remito.id_pedido,
        id_empresa,
        id_usuario,
        accion: pedidosHelper.LOG_PEDIDO_ACCIONES.COBRO_DESPACHO,
        detalle_despues: {
            id_pago: pago.id_pago,
            id_recibo: recibo.id_recibo,
            id_remito,
            id_metodo_pago,
            monto: montoNum,
            numero_recibo: numeroRecibo
        }
    });

    // ═══ 7. CANCELAR FIADO EN CC + MARCAR REMITO ═══
    const pedidoFiadoCheck = await client.query(
        'SELECT es_fiado FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [remito.id_pedido, id_empresa]
    );
    const esFiado = pedidoFiadoCheck.rows[0]?.es_fiado === true;

    if (esFiado && remito.id_cliente) {
        const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, remito.id_cliente);
        if (!esCF) {
            await ccClientesHelper.registrarMovimiento(client, {
                id_empresa,
                id_cliente: remito.id_cliente,
                monto: montoNum,
                tipo: 'haber',
                concepto: 'Cobro despacho - Remito ' + remito.numero_completo,
                id_pago: pago.id_pago
            });
        }
    }

    // Marcar remito como cobrado
    const nombreMetodoCobro = await ccClientesHelper.obtenerNombreMetodo(
        client, id_metodo_pago, id_empresa
    );
    await client.query(
        'UPDATE remitos SET pago_confirmado = true, fecha_pago = NOW(), metodo_pago = $1 WHERE id_remito = $2 AND id_empresa = $3',
        [nombreMetodoCobro, id_remito, id_empresa]
    );

    // ═══ 8. SALDO RESTANTE + UPDATE es_fiado ═══
    const saldoPost = await client.query(
        'SELECT saldo FROM v_saldo_pedidos WHERE id_pedido = $1 AND id_empresa = $2',
        [remito.id_pedido, id_empresa]
    );
    const saldoRestante = saldoPost.rows.length > 0 ? parseFloat(saldoPost.rows[0].saldo) : 0;

    // Si saldo 0, desmarcar fiado
    if (esFiado && saldoRestante < 1) {
        await client.query(
            'UPDATE pedidos SET es_fiado = false WHERE id_pedido = $1 AND id_empresa = $2',
            [remito.id_pedido, id_empresa]
        );
    }

    logger.info('[despachos.helper] Cobro registrado: Remito ' + remito.numero_completo +
        ' $' + montoNum.toFixed(2) + ' saldo restante: $' + saldoRestante.toFixed(2));

    return {
        id_pago: pago.id_pago,
        id_recibo: recibo.id_recibo,
        numero_recibo: 'R-' + String(numeroRecibo).padStart(8, '0'),
        saldo_restante: saldoRestante
    };
}

// ═══════════════════════════════════════════════════════════════
// BUSQUEDAS INTERNAS (usadas por controller)
// ═══════════════════════════════════════════════════════════════

/**
 * Busca un remito borrador existente para un pedido dentro de un viaje.
 * Usado por agregarAlViaje para decidir si crear nuevo remito o reutilizar.
 * @returns { id_remito } | null
 */
async function buscarRemitoBorradorEnViaje(client, datos) {
    const { id_empresa, id_viaje, id_pedido } = datos;
    if (!id_empresa) throw new Error('despachos.helper.buscarRemitoBorradorEnViaje: id_empresa obligatorio');
    if (!id_viaje) throw new Error('despachos.helper.buscarRemitoBorradorEnViaje: id_viaje obligatorio');
    if (!id_pedido) throw new Error('despachos.helper.buscarRemitoBorradorEnViaje: id_pedido obligatorio');

    const { rows } = await client.query(`
        SELECT id_remito FROM remitos
        WHERE id_empresa = $1 AND id_viaje = $2 AND id_pedido = $3 AND estado = $4
        LIMIT 1
    `, [id_empresa, id_viaje, id_pedido, REMITO_ESTADOS.BORRADOR]);

    return rows.length > 0 ? rows[0] : null;
}

/**
 * Busca el remito_item activo (no anulado) que corresponde a un pedido_item
 * dentro de un viaje dado. Usado por actualizarViaje al editar cantidades.
 * @returns { id_item } | null
 */
async function buscarItemActivoEnViajePorPedidoItem(client, datos) {
    const { id_empresa, id_viaje, id_pedido_item } = datos;
    if (!id_empresa) throw new Error('despachos.helper.buscarItemActivoEnViajePorPedidoItem: id_empresa obligatorio');
    if (!id_viaje) throw new Error('despachos.helper.buscarItemActivoEnViajePorPedidoItem: id_viaje obligatorio');
    if (!id_pedido_item) throw new Error('despachos.helper.buscarItemActivoEnViajePorPedidoItem: id_pedido_item obligatorio');

    const { rows } = await client.query(`
        SELECT ri.id_item
        FROM remito_items ri
        JOIN remitos r ON ri.id_remito = r.id_remito
        WHERE r.id_empresa = $1 AND r.id_viaje = $2
          AND ri.id_empresa = $1 AND ri.id_pedido_item = $3
          AND ri.anulado = false
        LIMIT 1
    `, [id_empresa, id_viaje, id_pedido_item]);

    return rows.length > 0 ? rows[0] : null;
}



// ═══════════════════════════════════════════════════════════════════════════
// CONFIG — lectura inline de configuraciones_empresa (patron del ERP)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * leerConfig — Lee 1 key de configuraciones_empresa para una empresa.
 * Retorna defaultValue si no existe.
 * No cachea (cada invocacion consulta BD). Para caching, envolver con tu capa.
 */
async function leerConfig(client, id_empresa, clave, defaultValue = null) {
    if (!id_empresa) throw new Error('despachos.helper.leerConfig: id_empresa obligatorio');
    if (!clave)      throw new Error('despachos.helper.leerConfig: clave obligatoria');

    const { rows } = await client.query(
        `SELECT valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave=$2`,
        [id_empresa, clave]
    );
    return rows.length > 0 ? rows[0].valor : defaultValue;
}

/**
 * configComoBool — helper para interpretar valores tipo 'true'/'false'.
 */
function configComoBool(valor, defaultValue = false) {
    if (valor === null || valor === undefined) return defaultValue;
    return String(valor).toLowerCase().trim() === 'true';
}

/**
 * configComoCsv — split de un CSV en array de strings trimeados.
 */
function configComoCsv(valor, defaultValue = []) {
    if (!valor) return defaultValue;
    return String(valor).split(',').map(s => s.trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// BITACORA — auditoria de acciones sobre viajes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * snapshotViaje — Devuelve { viaje, remitos } del estado actual en BD.
 * Se usa para grabar en viajes_bitacora.snapshot_viaje / snapshot_remitos.
 */
async function snapshotViaje(client, id_viaje, id_empresa) {
    if (!id_viaje)   throw new Error('despachos.helper.snapshotViaje: id_viaje obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.snapshotViaje: id_empresa obligatorio');

    const { rows: viajeRows } = await client.query(
        `SELECT * FROM viajes WHERE id_viaje=$1 AND id_empresa=$2`,
        [id_viaje, id_empresa]
    );
    if (viajeRows.length === 0) return null;

    const { rows: remitosRows } = await client.query(
        `SELECT id_remito, numero_completo, estado, id_pedido, id_cliente, total, anulado_en, motivo_anulacion
           FROM remitos WHERE id_viaje=$1 AND id_empresa=$2 ORDER BY id_remito`,
        [id_viaje, id_empresa]
    );

    return { viaje: viajeRows[0], remitos: remitosRows };
}

/**
 * registrarBitacoraViaje — INSERT en viajes_bitacora.
 * Honra config 'despachos.cancelar_viaje.snapshot_en_bitacora' para decidir
 * si persiste los snapshots JSONB o solo los metadatos basicos.
 */
async function registrarBitacoraViaje(client, datos) {
    const {
        id_empresa, id_viaje, accion,
        motivo = null, id_usuario = null, ip = null, user_agent = null,
        snapshot_viaje = null, snapshot_remitos = null,
        forzar_snapshot = false
    } = datos;

    if (!id_empresa) throw new Error('despachos.helper.registrarBitacoraViaje: id_empresa obligatorio');
    if (!accion)     throw new Error('despachos.helper.registrarBitacoraViaje: accion obligatoria');

    // Leer config de snapshot (default true)
    let persistirSnapshot = forzar_snapshot;
    if (!forzar_snapshot) {
        const cfg = await leerConfig(client, id_empresa, 'despachos.cancelar_viaje.snapshot_en_bitacora', 'true');
        persistirSnapshot = configComoBool(cfg, true);
    }

    const snapViajeFinal   = persistirSnapshot ? snapshot_viaje   : null;
    const snapRemitosFinal = persistirSnapshot ? snapshot_remitos : null;

    const { rows: [row] } = await client.query(
        `INSERT INTO viajes_bitacora
           (id_empresa, id_viaje, accion, motivo, snapshot_viaje, snapshot_remitos, id_usuario, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id_bitacora, fecha`,
        [
            id_empresa, id_viaje, accion, motivo,
            snapViajeFinal ? JSON.stringify(snapViajeFinal) : null,
            snapRemitosFinal ? JSON.stringify(snapRemitosFinal) : null,
            id_usuario, ip, user_agent
        ]
    );

    logger.info(`[despachos.helper.registrarBitacoraViaje] bitacora #${row.id_bitacora} accion=${accion} viaje=${id_viaje}`);
    return row;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANCELAR VIAJE COMPLETO — orquestador SOLID
// ═══════════════════════════════════════════════════════════════════════════

/**
 * cancelarViajeCompleto — cancela un viaje manejando correctamente los remitos
 * segun su estado. Registra bitacora. No revierte stock (la reversa pasa al
 * anular remitos via rama BORRADOR-con-movs o ya paso antes via cascada de pedido).
 *
 * Reglas de integridad (decision de diseno 2D):
 *   - Remito BORRADOR sin movs           -> DELETE fisico (CASCADE items)
 *   - Remito BORRADOR con movs_stock_dep -> anular + id_viaje=NULL (preserva historia)
 *   - Remito ANULADO                      -> solo id_viaje=NULL
 *
 * El viaje se borra al final (ya sin FK bloqueantes).
 *
 * Parametros:
 *   { id_viaje, id_empresa, id_usuario, motivo, ip, user_agent, accion='cancelado' }
 *
 * Retorna:
 *   { viaje_eliminado: true, id_viaje, remitos_procesados: [{id_remito, accion, estado_previo}], bitacora_id }
 */
async function cancelarViajeCompleto(client, datos) {
    const {
        id_viaje, id_empresa, id_usuario = null,
        motivo = null, ip = null, user_agent = null,
        accion = 'cancelado'
    } = datos;

    if (!id_viaje)   throw new Error('despachos.helper.cancelarViajeCompleto: id_viaje obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.cancelarViajeCompleto: id_empresa obligatorio');

    // 1. Leer config: habilitada y estados permitidos
    const cfgHab = await leerConfig(client, id_empresa, 'despachos.cancelar_viaje.habilitada', 'true');
    if (!configComoBool(cfgHab, true)) {
        throw new Error('La cancelacion de viajes esta deshabilitada por configuracion');
    }

    const cfgEstados = await leerConfig(client, id_empresa, 'despachos.cancelar_viaje.estados_permitidos', 'preparando');
    const estadosPermitidos = configComoCsv(cfgEstados, ['preparando']);

    // 2. Lock del viaje
    const { rows: [viaje] } = await client.query(
        `SELECT * FROM viajes WHERE id_viaje=$1 AND id_empresa=$2 FOR UPDATE`,
        [id_viaje, id_empresa]
    );
    if (!viaje) {
        throw new Error(`Viaje #${id_viaje} no encontrado`);
    }
    if (!estadosPermitidos.includes(viaje.estado)) {
        throw new Error(`No se puede cancelar viaje en estado '${viaje.estado}'. Permitidos: ${estadosPermitidos.join(', ')}`);
    }

    // 3. Snapshot previo (para bitacora)
    const snap = await snapshotViaje(client, id_viaje, id_empresa);

    // 4. Procesar cada remito del viaje segun su estado
    const { rows: remitosDelViaje } = await client.query(
        `SELECT id_remito FROM remitos WHERE id_viaje=$1 AND id_empresa=$2 FOR UPDATE`,
        [id_viaje, id_empresa]
    );

    const remitosProcesados = [];
    for (const r of remitosDelViaje) {
        const resultado = await eliminarRemito(client, {
            id_empresa,
            id_remito: r.id_remito,
            id_viaje,
            id_usuario,
            motivo: `Cancelacion de viaje #${id_viaje}${motivo ? ' — ' + motivo : ''}`
        });
        remitosProcesados.push(resultado);
    }

    // 5. Anulacion logica del viaje (Camino B): el viaje PERSISTE para que su
    //    bitacora conserve ancla referencial (FK). NUNCA se borra fisicamente.
    const { rowCount } = await client.query(
        `UPDATE viajes SET estado=$3 WHERE id_viaje=$1 AND id_empresa=$2`,
        [id_viaje, id_empresa, VIAJE_ESTADOS.CANCELADO]
    );
    if (rowCount === 0) {
        throw new Error(`despachos.helper.cancelarViajeCompleto: no se pudo cancelar el viaje #${id_viaje}`);
    }

    // 6. Bitacora
    const bit = await registrarBitacoraViaje(client, {
        id_empresa, id_viaje, accion,
        motivo,
        id_usuario, ip, user_agent,
        snapshot_viaje: snap ? snap.viaje : null,
        snapshot_remitos: snap ? snap.remitos : null
    });

    logger.info(`[despachos.helper.cancelarViajeCompleto] Viaje #${id_viaje} cancelado. ${remitosProcesados.length} remitos procesados. Bitacora #${bit.id_bitacora}`);

    return {
        viaje_eliminado: true,
        id_viaje,
        remitos_procesados: remitosProcesados,
        bitacora_id: bit.id_bitacora
    };
}

/**
 * Actualiza las observaciones de un remito y registra auditoría.
 * - Único punto de UPDATE de remitos.observaciones.
 * - Normaliza string vacío a NULL.
 * - Validación cross-empresa via WHERE id_empresa.
 *
 * @param {object} params
 * @param {object} params.client       - pg client (en transacción o pool)
 * @param {number} params.id_empresa   - obligatorio
 * @param {number} params.id_remito    - obligatorio
 * @param {string|null} params.nueva_obs - texto plano, '' o null = limpiar
 * @param {number} params.id_usuario   - obligatorio (para auditoría)
 * @returns {Promise<object>} remito actualizado con campos auditoría
 * @throws si remito no existe o no pertenece a la empresa
 */
async function actualizarObservacionesRemito({ client, id_empresa, id_remito, nueva_obs, id_usuario }) {
    if (!client) throw new Error('despachos.helper.actualizarObservacionesRemito: client obligatorio');
    if (!id_empresa) throw new Error('despachos.helper.actualizarObservacionesRemito: id_empresa obligatorio');
    if (!id_remito) throw new Error('despachos.helper.actualizarObservacionesRemito: id_remito obligatorio');
    if (!id_usuario) throw new Error('despachos.helper.actualizarObservacionesRemito: id_usuario obligatorio');

    // Normalización: string vacío o whitespace → NULL
    let valor = nueva_obs;
    if (typeof valor === 'string') {
        valor = valor.trim();
        if (valor === '') valor = null;
    }
    if (valor === undefined) valor = null;

    const { rows } = await client.query(`
        UPDATE remitos
           SET observaciones = $1,
               observaciones_editado_por = $2,
               observaciones_editado_en  = NOW()
         WHERE id_remito = $3
           AND id_empresa = $4
        RETURNING id_remito, numero_completo, observaciones,
                  observaciones_editado_por, observaciones_editado_en
    `, [valor, id_usuario, id_remito, id_empresa]);

    if (rows.length === 0) {
        const err = new Error('Remito no encontrado o no pertenece a la empresa');
        err.statusCode = 404;
        throw err;
    }

    return rows[0];
}

module.exports = {
    // Constantes
    VIAJE_ESTADOS,
    REMITO_ESTADOS,

    // Viajes
    crearViaje,
    actualizarViaje,
    cambiarEstadoViaje,
    eliminarViaje,
    eliminarViajesVacios,

    // Remitos
    crearRemito,
    cambiarEstadoRemito,
    despacharRemitosPorViaje,
    recalcularTotalesRemito,
    recalcularTotalesRemitosViaje,
    registrarImpresion,
    eliminarRemito,
    actualizarObservacionesRemito,
    eliminarRemitosViaje,

    // Remito Items
    crearRemitoItem,
    anularRemitoItem,
    incrementarCantidadItem,
    actualizarCantidadItem,
    registrarEntregaItem,

    // Cobros
    registrarCobroRemito,
    buscarRemitoBorradorEnViaje,
    buscarItemActivoEnViajePorPedidoItem,

    // Fase 2: Config + Bitacora + Orquestador de cancelacion
    leerConfig,
    configComoBool,
    configComoCsv,
    snapshotViaje,
    registrarBitacoraViaje,
    cancelarViajeCompleto
};
