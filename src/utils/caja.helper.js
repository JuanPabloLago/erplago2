'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CAJA HELPER UNIFICADO — ERP LAGO
 * Centralización COMPLETA de: turnos_caja + movimientos_caja
 *
 * ANTES: caja.helper.js (movimientos) + cajas.helper.js (turnos/manuales)
 * AHORA: TODO en un solo helper. cajas.helper.js ELIMINADO.
 *
 * REGLA: Sin turno abierto = sin movimiento de dinero. Nunca auto-crear turnos.
 * REGLA: TODO movimiento pasa por registrarMovimiento() — sin excepciones.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════
// TURNO ABIERTO — Consultas
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene el turno de caja abierto para una empresa.
 *
 * Backwards-compatible:
 *   - Firma vieja:    obtenerTurnoAbierto(client, id_empresa)
 *   - Firma nueva:    obtenerTurnoAbierto(client, id_empresa, { id_deposito })
 *
 * Si se pasa id_deposito, filtra el turno cuya caja pertenece a ese deposito.
 * Si NO se pasa, mantiene el comportamiento historico (primer turno de la empresa).
 *
 * Multi-caja por sucursal (L2 - D5): los callers que conocen el deposito del
 * usuario operador deben pasarlo para no mezclar turnos entre sucursales.
 *
 * @param {object} client          pg client
 * @param {number} id_empresa      requerido
 * @param {object} [opciones]
 * @param {number} [opciones.id_deposito]  filtra por cajas.id_deposito
 * @returns {Promise<object|null>} fila del turno o null si no hay
 */
async function obtenerTurnoAbierto(client, id_empresa, opciones) {
    const id_deposito = opciones && opciones.id_deposito ? parseInt(opciones.id_deposito, 10) : null;

    const params = [id_empresa];
    let filtroDeposito = '';
    if (id_deposito) {
        filtroDeposito = ' AND c.id_deposito = $2';
        params.push(id_deposito);
    }

    const res = await client.query(`
        SELECT tc.id_turno, tc.id_caja, tc.id_usuario_apertura,
               tc.monto_inicial_ars, tc.monto_inicial_usd,
               tc.fecha_apertura, tc.estado, c.id_deposito
        FROM turnos_caja tc
        JOIN cajas c ON tc.id_caja = c.id_caja
        WHERE c.id_empresa = $1 AND tc.estado = 'abierto'${filtroDeposito}
        ORDER BY tc.fecha_apertura DESC LIMIT 1
    `, params);
    return res.rows.length > 0 ? res.rows[0] : null;
}

/**
 * Igual que obtenerTurnoAbierto pero throw si no hay turno.
 *
 * Backwards-compatible:
 *   - Firma vieja:    requerirTurnoAbierto(client, id_empresa)
 *   - Firma nueva:    requerirTurnoAbierto(client, id_empresa, { id_deposito })
 *
 * Mensaje de error refleja el filtro: si vino id_deposito y no hay caja en
 * esa sucursal, lo aclara para que el cajero entienda que tiene que abrir
 * la caja de SU sucursal, no cualquier caja.
 */
async function requerirTurnoAbierto(client, id_empresa, opciones) {
    const turno = await obtenerTurnoAbierto(client, id_empresa, opciones);
    if (!turno) {
        const id_deposito = opciones && opciones.id_deposito ? opciones.id_deposito : null;
        const msg = id_deposito
            ? 'No hay caja abierta en tu sucursal (deposito ' + id_deposito + '). Abri la caja antes de registrar movimientos de dinero.'
            : 'No hay caja abierta. Abri la caja antes de registrar movimientos de dinero.';
        const err = new Error(msg);
        err.statusCode = 400;
        err.code = 'CAJA_CERRADA';
        if (id_deposito) err.id_deposito = id_deposito;
        throw err;
    }
    return turno;
}

async function validarTurnoAbierto(client, id_turno, id_empresa) {
    const res = await client.query(`
        SELECT tc.id_turno, tc.estado, c.id_empresa
        FROM turnos_caja tc
        JOIN cajas c ON tc.id_caja = c.id_caja
        WHERE tc.id_turno = $1 AND c.id_empresa = $2
    `, [id_turno, id_empresa]);

    if (res.rows.length === 0) {
        const err = new Error('Turno de caja no encontrado.');
        err.statusCode = 404;
        err.code = 'TURNO_NOT_FOUND';
        throw err;
    }
    if (res.rows[0].estado !== 'abierto') {
        const err = new Error('El turno de caja ya está cerrado.');
        err.statusCode = 400;
        err.code = 'TURNO_CERRADO';
        throw err;
    }
    return res.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// ABRIR / CERRAR TURNO
// ═══════════════════════════════════════════════════════════════

async function abrirTurno(client, datos) {
    const { id_empresa, id_caja, id_usuario, monto_inicial_ars, monto_inicial_usd } = datos;

    const cajaCheck = await client.query(
        `SELECT id_caja FROM cajas WHERE id_caja = $1 AND id_empresa = $2 AND activo = TRUE`,
        [id_caja, id_empresa]
    );
    if (cajaCheck.rows.length === 0) {
        throw Object.assign(new Error('Caja no encontrada o inactiva'), { statusCode: 404 });
    }

    const check = await client.query(
        `SELECT tc.id_turno FROM turnos_caja tc
         JOIN cajas c ON tc.id_caja = c.id_caja
         WHERE tc.id_caja = $1 AND c.id_empresa = $2 AND tc.estado = 'abierto'`,
        [id_caja, id_empresa]
    );
    if (check.rows.length > 0) {
        throw Object.assign(new Error('Ya existe un turno abierto para esta caja'), { statusCode: 409 });
    }

    const result = await client.query(`
        INSERT INTO turnos_caja (id_empresa, id_caja, id_usuario_apertura,
                                  monto_inicial_ars, monto_inicial_usd,
                                  estado, fecha_apertura)
        VALUES ($1, $2, $3, $4, $5, 'abierto', NOW()) RETURNING *
    `, [id_empresa, id_caja, id_usuario, monto_inicial_ars || 0, monto_inicial_usd || 0]);

    logger.success(`Turno abierto: id_turno=${result.rows[0].id_turno}, caja=${id_caja}, empresa=${id_empresa}`);
    return result.rows[0];
}

async function cerrarTurno(client, datos) {
    const {
        id_empresa, id_turno, id_usuario,
        ingresos_ars, egresos_ars, ingresos_usd, egresos_usd,
        arqueo_ars, arqueo_usd, observaciones, arqueo_detalle
    } = datos;

    if (!id_empresa) throw new Error('caja.helper.cerrarTurno: id_empresa obligatorio');

    const result = await client.query(`
        UPDATE turnos_caja SET
            fecha_cierre = NOW(),
            id_usuario_cierre = $1,
            ingresos_efectivo_ars = $2, egresos_efectivo_ars = $3,
            ingresos_efectivo_usd = $4, egresos_efectivo_usd = $5,
            arqueo_efectivo_ars = $6, arqueo_efectivo_usd = $7,
            observaciones = $8,
            arqueo_detalle = $9,
            estado = 'cerrado'
        WHERE id_turno = $10 AND id_empresa = $11 AND estado = 'abierto'
        RETURNING *
    `, [id_usuario, ingresos_ars, egresos_ars, ingresos_usd, egresos_usd,
        arqueo_ars, arqueo_usd, observaciones || null,
        JSON.stringify(arqueo_detalle || []),
        id_turno, id_empresa]);

    if (result.rows.length === 0) {
        throw Object.assign(new Error('Turno no encontrado o ya cerrado'), { statusCode: 404 });
    }

    logger.success(`Turno cerrado: id_turno=${id_turno}, empresa=${id_empresa}`);
    return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// REGISTRAR MOVIMIENTO — Punto único para TODA escritura
// ═══════════════════════════════════════════════════════════════

async function registrarMovimiento(client, params) {
    const {
        id_empresa,
        id_turno,
        id_usuario,
        tipo,
        id_moneda = 1,
        monto,
        concepto,
        id_metodo_pago = null,
        id_recibo = null,
        cotizacion_usada = 1
    } = params;

    if (!id_empresa) throw new Error('caja.helper.registrarMovimiento: id_empresa obligatorio');
    if (!['ingreso', 'egreso'].includes(tipo)) {
        throw Object.assign(new Error('Tipo debe ser ingreso o egreso'), { statusCode: 400 });
    }

    await validarTurnoAbierto(client, id_turno, id_empresa);

    const res = await client.query(`
        INSERT INTO movimientos_caja (
            id_empresa, id_turno, id_usuario, id_recibo,
            tipo, id_moneda, monto, concepto,
            id_metodo_pago, cotizacion_usada
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
    `, [
        id_empresa, id_turno, id_usuario, id_recibo,
        tipo, id_moneda, parseFloat(monto), concepto,
        id_metodo_pago, cotizacion_usada
    ]);

    // H13: ya no hardcodea id_metodo_pago === 1. Lee tipo_cuenta de metodosdepago
    // y solo actualiza los contadores de turno si es 'caja_fisica' (efectivo real).
    // Si id_metodo_pago === null (movimiento interno sin metodo) → cuenta como efectivo.
    let esEfectivo = id_metodo_pago === null;
    if (id_metodo_pago !== null) {
        const tcRes = await client.query(
            'SELECT tipo_cuenta FROM metodosdepago WHERE id_metodo_pago = $1 AND id_empresa = $2',
            [id_metodo_pago, id_empresa]
        );
        esEfectivo = tcRes.rows.length > 0 && tcRes.rows[0].tipo_cuenta === 'caja_fisica';
    }
    if (esEfectivo) {
        const campo_ingreso = id_moneda === 2 ? 'ingresos_efectivo_usd' : 'ingresos_efectivo_ars';
        const campo_egreso = id_moneda === 2 ? 'egresos_efectivo_usd' : 'egresos_efectivo_ars';
        const campo = tipo === 'ingreso' ? campo_ingreso : campo_egreso;

        await client.query(`
            UPDATE turnos_caja SET ${campo} = COALESCE(${campo}, 0) + $1
            WHERE id_turno = $2
        `, [parseFloat(monto), id_turno]);
    }

    logger.success(`Mov caja: ${tipo} $${monto} turno=${id_turno} empresa=${id_empresa} [${concepto}]`);
    return res.rows[0];
}

// ═══════════════════════════════════════════════════════════════
// TRANSFERENCIA A CAJA PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function transferirACajaPrincipal(client, datos) {
    const { id_empresa, id_turno, id_usuario, monto_ars, monto_usd } = datos;

    if ((!monto_ars || monto_ars <= 0) && (!monto_usd || monto_usd <= 0)) return null;

    const cpRes = await client.query(
        `SELECT id_caja, nombre FROM cajas
         WHERE id_empresa = $1 AND es_principal = TRUE AND activo = TRUE LIMIT 1`,
        [id_empresa]
    );
    if (cpRes.rows.length === 0) {
        throw Object.assign(new Error('No hay caja principal configurada'), { statusCode: 400 });
    }
    const cajaPrincipal = cpRes.rows[0];

    const origenRes = await client.query(
        `SELECT id_caja FROM turnos_caja WHERE id_turno = $1 AND id_empresa = $2`,
        [id_turno, id_empresa]
    );
    if (origenRes.rows.length === 0) {
        throw Object.assign(new Error('Turno no encontrado'), { statusCode: 404 });
    }
    if (origenRes.rows[0].id_caja === cajaPrincipal.id_caja) return null;

    await client.query(`
        UPDATE turnos_caja SET
            transferido_a_caja = $1, monto_transferido_ars = $2, monto_transferido_usd = $3
        WHERE id_turno = $4 AND id_empresa = $5
    `, [cajaPrincipal.id_caja, monto_ars || 0, monto_usd || 0, id_turno, id_empresa]);

    const turnoPrincipal = await client.query(
        `SELECT tc.id_turno FROM turnos_caja tc
         JOIN cajas c ON tc.id_caja = c.id_caja
         WHERE tc.id_caja = $1 AND c.id_empresa = $2 AND tc.estado = 'abierto' LIMIT 1`,
        [cajaPrincipal.id_caja, id_empresa]
    );

    const turnoDestinoAbierto = turnoPrincipal.rows.length > 0;
    if (turnoDestinoAbierto) {
        const id_turno_destino = turnoPrincipal.rows[0].id_turno;
        const conceptoBase = `Transferencia desde cierre turno #${id_turno}`;
        if (monto_ars > 0) {
            await registrarMovimiento(client, {
                id_empresa, id_turno: id_turno_destino, id_usuario,
                tipo: 'ingreso', id_moneda: 1, monto: monto_ars, concepto: conceptoBase
            });
        }
        if (monto_usd > 0) {
            await registrarMovimiento(client, {
                id_empresa, id_turno: id_turno_destino, id_usuario,
                tipo: 'ingreso', id_moneda: 2, monto: monto_usd, concepto: conceptoBase
            });
        }
    }

    return {
        caja_destino: cajaPrincipal.nombre,
        monto_ars: monto_ars || 0, monto_usd: monto_usd || 0,
        turno_destino_abierto: turnoDestinoAbierto
    };
}

// ═══════════════════════════════════════════════════════════════
// HISTORIAL DE TURNOS (lectura — acepta pool)
// ═══════════════════════════════════════════════════════════════

async function obtenerHistorialTurnos(pool, datos) {
    const { id_empresa, fecha_desde, fecha_hasta, estado, id_caja, limit = 50, offset = 0 } = datos;
    const conditions = ['c.id_empresa = $1'];
    const params = [id_empresa];
    let idx = 2;

    if (fecha_desde) { conditions.push(`tc.fecha_apertura >= $${idx}::date`); params.push(fecha_desde); idx++; }
    if (fecha_hasta) { conditions.push(`tc.fecha_apertura < ($${idx}::date + INTERVAL '1 day')`); params.push(fecha_hasta); idx++; }
    if (estado) { conditions.push(`tc.estado = $${idx}`); params.push(estado); idx++; }
    if (id_caja) { conditions.push(`tc.id_caja = $${idx}`); params.push(parseInt(id_caja)); idx++; }

    const where = conditions.join(' AND ');
    const countRes = await pool.query(
        `SELECT COUNT(*) as total FROM turnos_caja tc JOIN cajas c ON tc.id_caja = c.id_caja WHERE ${where}`, params
    );

    params.push(limit, offset);
    const { rows } = await pool.query(`
        SELECT tc.id_turno, tc.id_caja, tc.estado,
               tc.fecha_apertura, tc.fecha_cierre,
               tc.monto_inicial_ars, tc.monto_inicial_usd,
               tc.ingresos_efectivo_ars, tc.egresos_efectivo_ars,
               tc.ingresos_efectivo_usd, tc.egresos_efectivo_usd,
               tc.arqueo_efectivo_ars, tc.arqueo_efectivo_usd,
               tc.diferencia_ars, tc.diferencia_usd,
               tc.observaciones,
               tc.transferido_a_caja, tc.monto_transferido_ars, tc.monto_transferido_usd,
               c.nombre AS nombre_caja,
               ua.nombre AS usuario_apertura, ua.username AS username_apertura,
               uc.nombre AS usuario_cierre, uc.username AS username_cierre,
               ct.nombre AS caja_destino_nombre
        FROM turnos_caja tc
        JOIN cajas c ON tc.id_caja = c.id_caja
        JOIN usuarios ua ON tc.id_usuario_apertura = ua.id_usuario AND ua.id_empresa = c.id_empresa
        LEFT JOIN usuarios uc ON tc.id_usuario_cierre = uc.id_usuario AND uc.id_empresa = c.id_empresa
        LEFT JOIN cajas ct ON tc.transferido_a_caja = ct.id_caja
        WHERE ${where}
        ORDER BY tc.fecha_apertura DESC
        LIMIT $${idx} OFFSET $${idx + 1}
    `, params);

    return { turnos: rows, total: parseInt(countRes.rows[0].total) };
}

async function obtenerDetalleTurno(pool, datos) {
    const { id_turno, id_empresa } = datos;

    const turnoRes = await pool.query(`
        SELECT tc.*,
               c.nombre AS nombre_caja, c.es_principal,
               ua.nombre AS usuario_apertura, ua.username AS username_apertura,
               uc.nombre AS usuario_cierre, uc.username AS username_cierre,
               ct.nombre AS caja_destino_nombre
        FROM turnos_caja tc
        JOIN cajas c ON tc.id_caja = c.id_caja
        JOIN usuarios ua ON tc.id_usuario_apertura = ua.id_usuario AND ua.id_empresa = c.id_empresa
        LEFT JOIN usuarios uc ON tc.id_usuario_cierre = uc.id_usuario AND uc.id_empresa = c.id_empresa
        LEFT JOIN cajas ct ON tc.transferido_a_caja = ct.id_caja
        WHERE tc.id_turno = $1 AND c.id_empresa = $2
    `, [id_turno, id_empresa]);

    if (turnoRes.rows.length === 0) {
        throw Object.assign(new Error('Turno no encontrado'), { statusCode: 404 });
    }

    const movRes = await pool.query(`
        SELECT mc.*, u.nombre AS usuario_nombre, u.username,
               m.simbolo AS moneda_simbolo, m.codigo AS moneda_codigo,
               mp.nombre AS metodo_pago_nombre
        FROM movimientos_caja mc
        LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
        LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
        LEFT JOIN metodosdepago mp ON mc.id_metodo_pago = mp.id_metodo_pago
        WHERE mc.id_turno = $1 AND mc.id_empresa = $2
        ORDER BY mc.fecha_movimiento ASC
    `, [id_turno, id_empresa]);

    const resumenRes = await pool.query(`
        SELECT COALESCE(mp.nombre, mc.concepto, 'Sin clasificar') AS concepto_agrupado,
               m.simbolo AS moneda_simbolo, mc.tipo,
               COUNT(*) AS cantidad, SUM(mc.monto) AS total
        FROM movimientos_caja mc
        LEFT JOIN metodosdepago mp ON mc.id_metodo_pago = mp.id_metodo_pago
        LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
        WHERE mc.id_turno = $1 AND mc.id_empresa = $2
        GROUP BY concepto_agrupado, m.simbolo, mc.tipo
        ORDER BY mc.tipo, concepto_agrupado
    `, [id_turno, id_empresa]);

    return {
        turno: turnoRes.rows[0],
        movimientos: movRes.rows,
        resumen_formas_pago: resumenRes.rows
    };
}

// ═══════════════════════════════════════════════════════════════
// CALCULAR TOTALES TURNO (fuente de verdad: movimientos_caja)
// ═══════════════════════════════════════════════════════════════

async function calcularTotalesTorales(client, id_turno, id_empresa) {
    const res = await client.query(`
        SELECT
            COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND id_moneda = 1 THEN monto ELSE 0 END), 0) as ingresos_ars,
            COALESCE(SUM(CASE WHEN tipo = 'egreso'  AND id_moneda = 1 THEN monto ELSE 0 END), 0) as egresos_ars,
            COALESCE(SUM(CASE WHEN tipo = 'ingreso' AND id_moneda = 2 THEN monto ELSE 0 END), 0) as ingresos_usd,
            COALESCE(SUM(CASE WHEN tipo = 'egreso'  AND id_moneda = 2 THEN monto ELSE 0 END), 0) as egresos_usd,
            COUNT(*) as total_movimientos
        FROM movimientos_caja
        WHERE id_turno = $1 AND id_empresa = $2
    `, [id_turno, id_empresa]);
    return res.rows[0];
}


// ═══════════════════════════════════════════════════════════════
// DESGLOSE POR FORMA DE PAGO (para arqueo)
// ═══════════════════════════════════════════════════════════════

async function calcularDesgloseFormasPago(client, id_turno, id_empresa) {
    // H13: incluye tipo_cuenta y requiere_arqueo_manual para que el controller
    // identifique 'caja_fisica' por semantica, no por id hardcodeado.
    const res = await client.query(`
        SELECT
            COALESCE(mc.id_metodo_pago, 0) as id_metodo_pago,
            COALESCE(mp.nombre, 'Otros') as nombre,
            COALESCE(mp.tipo_cuenta, 'manual') as tipo_cuenta,
            COALESCE(mp.requiere_arqueo_manual, false) as requiere_arqueo_manual,
            mc.id_moneda,
            COALESCE(mo.simbolo, '$') as moneda_simbolo,
            SUM(CASE WHEN mc.tipo = 'ingreso' THEN mc.monto ELSE 0 END) as ingresos,
            SUM(CASE WHEN mc.tipo = 'egreso' THEN mc.monto ELSE 0 END) as egresos
        FROM movimientos_caja mc
        LEFT JOIN metodosdepago mp ON mc.id_metodo_pago = mp.id_metodo_pago
        LEFT JOIN monedas mo ON mc.id_moneda = mo.id_moneda
        WHERE mc.id_turno = $1 AND mc.id_empresa = $2
        GROUP BY mc.id_metodo_pago, mp.nombre, mp.tipo_cuenta, mp.requiere_arqueo_manual, mc.id_moneda, mo.simbolo
        ORDER BY mc.id_moneda, COALESCE(mc.id_metodo_pago, 999)
    `, [id_turno, id_empresa]);

    return res.rows.map(r => ({
        id_metodo_pago: r.id_metodo_pago,
        nombre: r.nombre,
        tipo_cuenta: r.tipo_cuenta,
        requiere_arqueo_manual: r.requiere_arqueo_manual,
        id_moneda: r.id_moneda,
        moneda_simbolo: r.moneda_simbolo,
        ingresos: parseFloat(r.ingresos) || 0,
        egresos: parseFloat(r.egresos) || 0,
        neto: (parseFloat(r.ingresos) || 0) - (parseFloat(r.egresos) || 0)
    }));
}

module.exports = {
    obtenerTurnoAbierto, requerirTurnoAbierto, validarTurnoAbierto,
    abrirTurno, cerrarTurno,
    registrarMovimiento,
    transferirACajaPrincipal,
    obtenerHistorialTurnos, obtenerDetalleTurno,
    calcularTotalesTorales,
    calcularDesgloseFormasPago
};
