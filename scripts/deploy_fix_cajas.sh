#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# DEPLOY: Fix módulo Cajas/Tesorería — ERP LAGO
# Fecha: 2026-03-22
#
# QUÉ HACE:
#   1. Backup de los 3 archivos actuales
#   2. Escribe caja.helper.js UNIFICADO (merge de caja+cajas)
#   3. Escribe cajas-cobranzas.controller.js (reescrito)
#   4. Escribe cajas-cobranzas.routes.js (limpio)
#   5. Elimina cajas.helper.js redundante (.bak)
#   6. Valida sintaxis
#   7. Reinicia PM2
#
# FIXES:
#   - 2 leaks multi-empresa (obtenerTurnoActual, listarMovimientos)
#   - Movimientos manuales sin transacción → con transacción
#   - Movimientos manuales no actualizaban contadores turno → unificado
#   - cerrarCaja transfería monto CONTADO en vez de ESPERADO
#   - cerrarCaja tenía id_empresa duplicado
#   - 2 helpers duplicados → 1 solo caja.helper.js
#   - Routes con código muerto → limpio
# ═══════════════════════════════════════════════════════════════
set -e

source ~/.nvm/nvm.sh

ERP="/root/mi_erp"
BACKUP_DIR="${ERP}/backups/pre_fix_cajas_$(date +%Y%m%d_%H%M%S)"

echo "══════════════════════════════════════════════════════"
echo " DEPLOY: Fix Cajas/Tesorería"
echo "══════════════════════════════════════════════════════"

# ─── 1. BACKUP ───
echo "[1/7] Backup..."
mkdir -p "$BACKUP_DIR"
cp "$ERP/src/utils/caja.helper.js"                  "$BACKUP_DIR/" 2>/dev/null || true
cp "$ERP/src/utils/cajas.helper.js"                  "$BACKUP_DIR/" 2>/dev/null || true
cp "$ERP/src/controllers/cajas-cobranzas.controller.js" "$BACKUP_DIR/" 2>/dev/null || true
cp "$ERP/src/routes/cajas-cobranzas.routes.js"       "$BACKUP_DIR/" 2>/dev/null || true
echo "  → $BACKUP_DIR"

# ─── 2. HELPER UNIFICADO ───
echo "[2/7] Escribiendo caja.helper.js (unificado)..."
cat > "$ERP/src/utils/caja.helper.js" << 'ENDOFHELPER'
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

async function obtenerTurnoAbierto(client, id_empresa) {
    const res = await client.query(`
        SELECT tc.id_turno, tc.id_caja, tc.id_usuario_apertura,
               tc.monto_inicial_ars, tc.monto_inicial_usd,
               tc.fecha_apertura, tc.estado
        FROM turnos_caja tc
        JOIN cajas c ON tc.id_caja = c.id_caja
        WHERE c.id_empresa = $1 AND tc.estado = 'abierto'
        ORDER BY tc.fecha_apertura DESC LIMIT 1
    `, [id_empresa]);
    return res.rows.length > 0 ? res.rows[0] : null;
}

async function requerirTurnoAbierto(client, id_empresa) {
    const turno = await obtenerTurnoAbierto(client, id_empresa);
    if (!turno) {
        const err = new Error('No hay caja abierta. Abrí la caja antes de registrar movimientos de dinero.');
        err.statusCode = 400;
        err.code = 'CAJA_CERRADA';
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
        arqueo_ars, arqueo_usd, observaciones
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
            estado = 'cerrado'
        WHERE id_turno = $9 AND id_empresa = $10 AND estado = 'abierto'
        RETURNING *
    `, [id_usuario, ingresos_ars, egresos_ars, ingresos_usd, egresos_usd,
        arqueo_ars, arqueo_usd, observaciones || null, id_turno, id_empresa]);

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

    const esEfectivo = id_metodo_pago === 1 || id_metodo_pago === null;
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
        JOIN usuarios ua ON tc.id_usuario_apertura = ua.id_usuario
        LEFT JOIN usuarios uc ON tc.id_usuario_cierre = uc.id_usuario
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
        JOIN usuarios ua ON tc.id_usuario_apertura = ua.id_usuario
        LEFT JOIN usuarios uc ON tc.id_usuario_cierre = uc.id_usuario
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

module.exports = {
    obtenerTurnoAbierto, requerirTurnoAbierto, validarTurnoAbierto,
    abrirTurno, cerrarTurno,
    registrarMovimiento,
    transferirACajaPrincipal,
    obtenerHistorialTurnos, obtenerDetalleTurno,
    calcularTotalesTorales
};
ENDOFHELPER

# ─── 3. CONTROLLER ───
echo "[3/7] Escribiendo cajas-cobranzas.controller.js..."
cat > "$ERP/src/controllers/cajas-cobranzas.controller.js" << 'ENDOFCTRL'
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CAJAS Y COBRANZAS CONTROLLER — ERP LAGO
 * REESCRITO: Unifica en caja.helper.js (eliminado cajas.helper.js)
 *
 * FIXES: leaks multi-empresa, movimientos sin tx, cerrarCaja transfer logic,
 *        id_empresa duplicado, helpers duplicados
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const logger = require('../utils/logger');
const pool = require('../config/database');
const cajaHelper = require('../utils/caja.helper');
const facturacionHelper = require('../utils/facturacion.helper');
const recibosHelper = require('../utils/recibos.helper');

// ═══════════════════════════════════════════════════════════════
// CAJAS — Lectura
// ═══════════════════════════════════════════════════════════════

exports.listarCajas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(
            `SELECT * FROM cajas WHERE id_empresa = $1 AND activo = TRUE ORDER BY es_principal DESC, nombre`,
            [id_empresa]
        );
        res.json(rows);
    } catch (error) {
        logger.error('Error listarCajas:', error.message);
        res.status(500).json({ error: 'Error al obtener cajas' });
    }
};

exports.obtenerCajas = exports.listarCajas;

exports.obtenerTurnoActual = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_caja = parseInt(req.params.id_caja, 10);
    try {
        const { rows } = await pool.query(`
            SELECT t.*, c.nombre as nombre_caja, u.username as usuario_apertura
            FROM turnos_caja t
            JOIN cajas c ON t.id_caja = c.id_caja
            JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario
            WHERE t.id_caja = $1 AND c.id_empresa = $2 AND t.estado = 'abierto'
            ORDER BY t.fecha_apertura DESC LIMIT 1
        `, [id_caja, id_empresa]);

        if (rows.length === 0) return res.json({ turno_abierto: false });

        const turno = rows[0];
        const totales = await cajaHelper.calcularTotalesTorales(pool, turno.id_turno, id_empresa);
        const monto_inicial_ars = parseFloat(turno.monto_inicial_ars) || 0;
        const monto_inicial_usd = parseFloat(turno.monto_inicial_usd) || 0;
        const ingresos_ars = parseFloat(totales.ingresos_ars) || 0;
        const egresos_ars = parseFloat(totales.egresos_ars) || 0;
        const ingresos_usd = parseFloat(totales.ingresos_usd) || 0;
        const egresos_usd = parseFloat(totales.egresos_usd) || 0;

        res.json({
            turno_abierto: true,
            turno: {
                ...turno,
                ingresos_efectivo_ars: ingresos_ars, egresos_efectivo_ars: egresos_ars,
                ingresos_efectivo_usd: ingresos_usd, egresos_efectivo_usd: egresos_usd,
                efectivo_actual_ars: monto_inicial_ars + ingresos_ars - egresos_ars,
                efectivo_actual_usd: monto_inicial_usd + ingresos_usd - egresos_usd,
                total_movimientos: parseInt(totales.total_movimientos) || 0
            }
        });
    } catch (error) {
        logger.error('Error obtenerTurnoActual:', error.message);
        res.status(500).json({ error: 'Error al obtener turno actual' });
    }
};

exports.obtenerEstado = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(`
            SELECT tc.id_turno, tc.id_caja, tc.estado, tc.fecha_apertura,
                   tc.monto_inicial_ars, tc.monto_inicial_usd,
                   c.nombre as nombre_caja
            FROM turnos_caja tc
            JOIN cajas c ON tc.id_caja = c.id_caja
            WHERE tc.estado = 'abierto' AND c.id_empresa = $1
            ORDER BY tc.fecha_apertura DESC LIMIT 1
        `, [id_empresa]);

        if (rows.length === 0) return res.json({ abierta: false, turno: null });

        const turno = rows[0];
        const t = await cajaHelper.calcularTotalesTorales(pool, turno.id_turno, id_empresa);
        const efectivo_ars = parseFloat(turno.monto_inicial_ars || 0) + parseFloat(t.ingresos_ars) - parseFloat(t.egresos_ars);
        const efectivo_usd = parseFloat(turno.monto_inicial_usd || 0) + parseFloat(t.ingresos_usd) - parseFloat(t.egresos_usd);

        res.json({
            abierta: true,
            turno: {
                ...turno,
                efectivo_actual_ars: efectivo_ars, efectivo_actual_usd: efectivo_usd,
                ingresos_efectivo_ars: parseFloat(t.ingresos_ars),
                egresos_efectivo_ars: parseFloat(t.egresos_ars),
                ingresos_efectivo_usd: parseFloat(t.ingresos_usd),
                egresos_efectivo_usd: parseFloat(t.egresos_usd)
            },
            nombre_caja: turno.nombre_caja
        });
    } catch (error) {
        logger.error('Error obtenerEstado:', error.message);
        res.status(500).json({ error: 'Error al obtener estado de caja' });
    }
};

// ═══════════════════════════════════════════════════════════════
// ABRIR / CERRAR CAJA
// ═══════════════════════════════════════════════════════════════

exports.abrirCaja = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_caja, monto_inicial_ars, monto_inicial_usd } = req.body;
    if (!id_caja) return res.status(400).json({ error: 'ID de caja requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const turno = await cajaHelper.abrirTurno(client, {
            id_empresa, id_caja, id_usuario, monto_inicial_ars, monto_inicial_usd
        });
        await client.query('COMMIT');
        res.status(201).json({ message: 'Caja abierta exitosamente', turno });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al abrir caja:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al abrir caja' });
    } finally { client.release(); }
};

exports.cerrarCaja = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_turno, arqueo_efectivo_ars, arqueo_efectivo_usd, observaciones, transferir_a_principal } = req.body;
    if (!id_turno) return res.status(400).json({ error: 'ID de turno requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Totales reales desde movimientos_caja (fuente de verdad)
        const t = await cajaHelper.calcularTotalesTorales(client, id_turno, id_empresa);

        const turnoRes = await client.query(
            `SELECT monto_inicial_ars, monto_inicial_usd FROM turnos_caja WHERE id_turno = $1 AND id_empresa = $2`,
            [id_turno, id_empresa]
        );
        if (turnoRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Turno no encontrado' }); }

        const td = turnoRes.rows[0];
        const esperado_ars = parseFloat(td.monto_inicial_ars || 0) + parseFloat(t.ingresos_ars) - parseFloat(t.egresos_ars);
        const esperado_usd = parseFloat(td.monto_inicial_usd || 0) + parseFloat(t.ingresos_usd) - parseFloat(t.egresos_usd);
        const arqueo_ars = parseFloat(arqueo_efectivo_ars) || 0;
        const arqueo_usd = parseFloat(arqueo_efectivo_usd) || 0;

        const turno = await cajaHelper.cerrarTurno(client, {
            id_empresa, id_turno, id_usuario,
            ingresos_ars: t.ingresos_ars, egresos_ars: t.egresos_ars,
            ingresos_usd: t.ingresos_usd, egresos_usd: t.egresos_usd,
            arqueo_ars, arqueo_usd, observaciones
        });

        // Transferir monto ESPERADO (sistema), no contado (cajero)
        let transferencia = null;
        if (transferir_a_principal) {
            transferencia = await cajaHelper.transferirACajaPrincipal(client, {
                id_empresa, id_turno, id_usuario,
                monto_ars: esperado_ars, monto_usd: esperado_usd
            });
        }

        await client.query('COMMIT');
        logger.success(`Caja cerrada: turno=${id_turno}, dif_ARS=${turno.diferencia_ars}${transferencia ? ', → ' + transferencia.caja_destino : ''}`);

        res.json({
            message: 'Caja cerrada exitosamente', turno, transferencia,
            resumen: { esperado_ars, esperado_usd, arqueo_ars, arqueo_usd,
                       diferencia_ars: parseFloat(turno.diferencia_ars),
                       diferencia_usd: parseFloat(turno.diferencia_usd) }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al cerrar caja:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al cerrar caja' });
    } finally { client.release(); }
};

// ═══════════════════════════════════════════════════════════════
// MOVIMIENTOS MANUALES — con transacción + helper unificado
// ═══════════════════════════════════════════════════════════════

exports.crearMovimiento = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_turno, tipo, monto, concepto, id_moneda } = req.body;
    if (!id_turno || !tipo || !monto || !concepto) return res.status(400).json({ error: 'Faltan datos requeridos' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const mov = await cajaHelper.registrarMovimiento(client, {
            id_empresa, id_turno, id_usuario,
            tipo, id_moneda: id_moneda || 1, monto, concepto
        });
        await client.query('COMMIT');
        logger.success(`Movimiento manual ${tipo}: $${monto} - ${concepto}`);
        res.status(201).json(mov);
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al crear movimiento:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al registrar movimiento' });
    } finally { client.release(); }
};

exports.listarMovimientos = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_turno } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT mc.*, u.nombre as usuario_nombre,
                   m.simbolo as moneda_simbolo, mp.nombre as metodo_pago_nombre
            FROM movimientos_caja mc
            LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
            LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
            LEFT JOIN metodosdepago mp ON mc.id_metodo_pago = mp.id_metodo_pago
            WHERE mc.id_turno = $1 AND mc.id_empresa = $2
            ORDER BY mc.fecha_movimiento DESC
        `, [id_turno, id_empresa]);
        res.json(rows);
    } catch (error) {
        logger.error('Error listarMovimientos:', error.message);
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
};

// ═══════════════════════════════════════════════════════════════
// COBRANZAS
// ═══════════════════════════════════════════════════════════════

exports.obtenerPendientes = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { solo_hoy, id_cliente } = req.query;
    try {
        let query = `
            SELECT f.id_factura, f.numero_completo, f.fecha_emision,
                   f.fecha_vencimiento, f.total,
                   COALESCE(f.monto_pagado, 0) as monto_pagado,
                   (f.total - COALESCE(f.monto_pagado, 0)) as saldo_pendiente,
                   c.id_cliente, c.razon_social, c.telefono, c.email
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_empresa = $1 AND f.estado IN ('emitida', 'parcial')
              AND (f.total - COALESCE(f.monto_pagado, 0)) > 0.01`;
        const params = [id_empresa]; let pi = 2;
        if (solo_hoy === 'true') query += ` AND f.fecha_vencimiento = CURRENT_DATE`;
        if (id_cliente) { query += ` AND f.id_cliente = $${pi}`; params.push(parseInt(id_cliente)); pi++; }
        query += ` ORDER BY f.fecha_vencimiento ASC, f.fecha_emision ASC`;
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error obtenerPendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
};

exports.aplicarPago = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_recibo, aplicaciones } = req.body;
    if (!id_recibo || !aplicaciones || aplicaciones.length === 0) return res.status(400).json({ error: 'Recibo y aplicaciones requeridos' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const reciboRes = await client.query('SELECT total_recibo, id_cliente FROM recibos WHERE id_recibo = $1 AND id_empresa = $2', [id_recibo, id_empresa]);
        if (reciboRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Recibo no encontrado' }); }
        const total_recibo = parseFloat(reciboRes.rows[0].total_recibo);
        let total_aplicado = 0;

        for (const ap of aplicaciones) {
            const monto = parseFloat(ap.monto_aplicado);
            if (monto <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Montos deben ser > 0' }); }
            const fRes = await client.query('SELECT total, COALESCE(monto_pagado,0) as pagado FROM facturas WHERE id_factura=$1 AND id_empresa=$2', [ap.id_factura, id_empresa]);
            if (fRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Factura ${ap.id_factura} no encontrada` }); }
            const saldo = parseFloat(fRes.rows[0].total) - parseFloat(fRes.rows[0].pagado);
            if (monto > saldo + 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Monto ${monto} supera saldo ${saldo.toFixed(2)}` }); }
            await recibosHelper.aplicarAFactura(client, { id_recibo, id_factura: ap.id_factura, monto_aplicado: monto });
            await facturacionHelper.actualizarMontoPagado(client, { id_factura: ap.id_factura, id_empresa, monto });
            total_aplicado += monto;
        }
        if (total_aplicado > total_recibo + 0.01) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Total aplicado supera recibo` }); }
        await client.query('COMMIT');
        res.json({ message: 'Pago aplicado exitosamente', total_aplicado, facturas_aplicadas: aplicaciones.length });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error aplicar pago:', error.message);
        res.status(500).json({ error: 'Error al aplicar pago' });
    } finally { client.release(); }
};

exports.obtenerHistorialCobranzas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, id_cliente, limite, offset } = req.query;
    try {
        let query = `
            SELECT r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo,
                   c.razon_social as cliente, u.username as cobrador,
                   COUNT(rf.id_relacion) as facturas_aplicadas,
                   COALESCE(SUM(rf.monto_aplicado), 0) as monto_aplicado
            FROM recibos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            LEFT JOIN recibo_facturas rf ON r.id_recibo = rf.id_recibo
            WHERE r.id_empresa = $1`;
        const params = [id_empresa]; let pi = 2;
        if (fecha_desde) { query += ` AND DATE(r.fecha_recibo) >= $${pi}`; params.push(fecha_desde); pi++; }
        if (fecha_hasta) { query += ` AND DATE(r.fecha_recibo) <= $${pi}`; params.push(fecha_hasta); pi++; }
        if (id_cliente) { query += ` AND r.id_cliente = $${pi}`; params.push(parseInt(id_cliente)); pi++; }
        query += ` GROUP BY r.id_recibo, c.razon_social, u.username ORDER BY r.fecha_recibo DESC LIMIT $${pi} OFFSET $${pi+1}`;
        params.push(parseInt(limite) || 100, parseInt(offset) || 0);
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error historial cobranzas:', error.message);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
};

// ═══════════════════════════════════════════════════════════════
// HISTORIAL DE TURNOS
// ═══════════════════════════════════════════════════════════════

exports.obtenerHistorialTurnos = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, estado, id_caja, limit, offset } = req.query;
    try {
        const resultado = await cajaHelper.obtenerHistorialTurnos(pool, {
            id_empresa, fecha_desde, fecha_hasta, estado,
            id_caja, limit: parseInt(limit) || 50, offset: parseInt(offset) || 0
        });
        res.json(resultado);
    } catch (error) {
        logger.error('Error historial turnos:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener historial' });
    }
};

exports.obtenerDetalleTurno = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_turno = parseInt(req.params.id_turno, 10);
    try {
        const detalle = await cajaHelper.obtenerDetalleTurno(pool, { id_turno, id_empresa });
        res.json(detalle);
    } catch (error) {
        logger.error('Error detalle turno:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener detalle' });
    }
};
ENDOFCTRL

# ─── 4. ROUTES ───
echo "[4/7] Escribiendo cajas-cobranzas.routes.js..."
cat > "$ERP/src/routes/cajas-cobranzas.routes.js" << 'ENDOFROUTES'
/**
 * CAJAS-COBRANZAS ROUTES — ERP LAGO
 */
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/cajas-cobranzas.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// CAJAS
router.get('/cajas', verificarToken, ctrl.listarCajas);
router.get('/cajas/lista', verificarToken, ctrl.obtenerCajas);
router.get('/estado', verificarToken, ctrl.obtenerEstado);
router.get('/cajas/:id_caja/turno-actual', verificarToken, ctrl.obtenerTurnoActual);
router.post('/cajas/abrir', verificarToken, ctrl.abrirCaja);
router.post('/cajas/cerrar', verificarToken, ctrl.cerrarCaja);

// HISTORIAL TURNOS
router.get('/cajas/turnos-historial', verificarToken, ctrl.obtenerHistorialTurnos);
router.get('/cajas/turnos/:id_turno/detalle', verificarToken, ctrl.obtenerDetalleTurno);

// COBRANZAS
router.get('/cobranzas/pendientes', verificarToken, ctrl.obtenerPendientes);
router.post('/cobranzas/aplicar-pago', verificarToken, ctrl.aplicarPago);
router.get('/cobranzas/historial', verificarToken, ctrl.obtenerHistorialCobranzas);

// MOVIMIENTOS
router.post('/movimientos', verificarToken, ctrl.crearMovimiento);
router.get('/movimientos/:id_turno', verificarToken, ctrl.listarMovimientos);

module.exports = router;
ENDOFROUTES

# ─── 5. ELIMINAR HELPER REDUNDANTE ───
echo "[5/7] Eliminando cajas.helper.js redundante..."
if [ -f "$ERP/src/utils/cajas.helper.js" ]; then
    mv "$ERP/src/utils/cajas.helper.js" "$BACKUP_DIR/cajas.helper.js.ELIMINADO"
    echo "  → Movido a backup (ELIMINADO)"
else
    echo "  → cajas.helper.js no existe (ya eliminado?)"
fi

# ─── 6. VERIFICAR SINTAXIS ───
echo "[6/7] Verificando sintaxis..."
ERRORS=0
for f in "$ERP/src/utils/caja.helper.js" "$ERP/src/controllers/cajas-cobranzas.controller.js" "$ERP/src/routes/cajas-cobranzas.routes.js"; do
    if node --check "$f" 2>/dev/null; then
        echo "  ✅ $(basename $f)"
    else
        echo "  ❌ $(basename $f) — ERROR DE SINTAXIS"
        ERRORS=$((ERRORS + 1))
    fi
done

# Verificar que nadie más importe cajas.helper
OTROS=$(grep -rn "cajas\.helper\|cajas.helper" "$ERP/src/" --include="*.js" 2>/dev/null | grep -v "node_modules" | grep -v ".bak" | grep -v "ELIMINADO" || true)
if [ -n "$OTROS" ]; then
    echo ""
    echo "  ⚠️  ARCHIVOS QUE AÚN IMPORTAN cajas.helper.js:"
    echo "$OTROS"
    echo "  → Cambiar require('cajas.helper') por require('caja.helper')"
    ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "══════════════════════════════════════════════════════"
    echo " ❌ HAY ERRORES — NO SE REINICIA PM2"
    echo " Backup en: $BACKUP_DIR"
    echo "══════════════════════════════════════════════════════"
    exit 1
fi

# ─── 7. REINICIAR ───
echo "[7/7] Reiniciando PM2..."
pm2 restart erplago --update-env
sleep 2
pm2 status erplago | head -5

echo ""
echo "══════════════════════════════════════════════════════"
echo " ✅ DEPLOY COMPLETO"
echo " Backup en: $BACKUP_DIR"
echo ""
echo " CAMBIOS:"
echo "   • caja.helper.js UNIFICADO (merge de caja+cajas)"
echo "   • cajas-cobranzas.controller.js REESCRITO"
echo "   • cajas-cobranzas.routes.js LIMPIO"
echo "   • cajas.helper.js ELIMINADO"
echo ""
echo " FIXES:"
echo "   🔒 obtenerTurnoActual + listarMovimientos filtran id_empresa"
echo "   🔄 crearMovimiento ahora usa transacción + actualiza turno"
echo "   💰 cerrarCaja transfiere monto ESPERADO (no contado)"
echo "   🧹 id_empresa duplicado eliminado en cerrarCaja"
echo "   📦 2 helpers → 1 solo caja.helper.js"
echo "══════════════════════════════════════════════════════"
