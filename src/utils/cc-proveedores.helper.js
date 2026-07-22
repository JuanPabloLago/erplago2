'use strict';
/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CC-PROVEEDORES HELPER v1 — ERP LAGO
 * Funciones centralizadas para cuenta corriente de proveedores.
 * Espejo de cc-clientes.helper.js
 *
 * REGLA: Todo INSERT/DELETE a cuentacorrienteproveedores DEBE pasar por acá.
 *
 * CONSUMIDORES: compras.helper.js, pagos-proveedores.helper.js,
 *               pagos-proveedores.controller.js
 * ════════════════════════════════════════════════════════════════════════════════
 */
const logger = require('./logger');

// ════════════════════════════════════════════════════════════════════════════════
// SALDO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Calcula el saldo REAL del proveedor sumando todos los movimientos.
 * Positivo = le debemos. Negativo = saldo a favor nuestro.
 */
async function obtenerSaldo(client, id_empresa, id_proveedor) {
    const res = await client.query(`
        SELECT COALESCE(SUM(debe), 0) - COALESCE(SUM(haber), 0) as saldo
        FROM cuentacorrienteproveedores
        WHERE id_proveedor = $1 AND id_empresa = $2
    `, [id_proveedor, id_empresa]);
    return parseFloat(res.rows[0].saldo) || 0;
}

/**
 * Recalcula el saldo corrido de TODOS los movimientos de un proveedor
 * y sincroniza proveedores.saldo_actual.
 */
async function recalcularSaldo(client, id_empresa, id_proveedor) {
    // 1. Recalcular saldo corrido con window function
    await client.query(`
        WITH saldos AS (
            SELECT
                id_movimiento_cc_proveedor,
                SUM(COALESCE(debe, 0) - COALESCE(haber, 0))
                    OVER (ORDER BY fecha ASC, id_movimiento_cc_proveedor ASC) as saldo_corrido
            FROM cuentacorrienteproveedores
            WHERE id_proveedor = $1 AND id_empresa = $2
        )
        UPDATE cuentacorrienteproveedores cc
        SET saldo = s.saldo_corrido
        FROM saldos s
        WHERE cc.id_movimiento_cc_proveedor = s.id_movimiento_cc_proveedor
    `, [id_proveedor, id_empresa]);

    // 2. Obtener saldo final
    const saldoFinal = await obtenerSaldo(client, id_empresa, id_proveedor);

    // 3. Sincronizar proveedores.saldo_actual (trigger también lo hace, pero por seguridad)
    await client.query(`
        UPDATE proveedores SET saldo_actual = $1
        WHERE id_proveedor = $2 AND id_empresa = $3
    `, [saldoFinal, id_proveedor, id_empresa]);

    logger.info(`CC Prov Recalculado - Proveedor #${id_proveedor}: saldo = $${saldoFinal}`);
    return saldoFinal;
}

// ════════════════════════════════════════════════════════════════════════════════
// REGISTRAR MOVIMIENTO (bajo nivel)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Registra un movimiento en cuenta corriente del proveedor.
 *
 * @param {object} client - pg client dentro de transacción
 * @param {object} params
 * @param {number} params.id_empresa
 * @param {number} params.id_proveedor
 * @param {number} params.monto - siempre positivo
 * @param {string} params.tipo - 'debe' | 'haber'
 * @param {string} params.concepto
 * @param {number|null} params.id_comprobante_compra
 * @param {number|null} params.id_pago_proveedor
 * @returns {object} movimiento insertado
 */
async function registrarMovimiento(client, params) {
    const {
        id_empresa,
        id_proveedor,
        monto,
        tipo,
        concepto,
        id_comprobante_compra = null,
        id_pago_proveedor = null
    } = params;

    if (!id_empresa || !id_proveedor) {
        throw new Error('cc-proveedores.helper: id_empresa e id_proveedor son obligatorios');
    }
    if (!monto || parseFloat(monto) <= 0) {
        throw new Error('cc-proveedores.helper: monto debe ser mayor a 0');
    }
    if (!['debe', 'haber'].includes(tipo)) {
        throw new Error('cc-proveedores.helper: tipo debe ser "debe" o "haber"');
    }

    // Guard: no se acepta fecha explícita. La BD la setea con now().
    // Para inserciones con fecha histórica usar scripts_mantenimiento/reconciliar_saldo_cc.sh
    if (params.fecha !== undefined) {
        throw new Error(
            'cc-proveedores.helper: NO pasar fecha. La BD asigna now() automáticamente. ' +
            'Para carga histórica usar scripts_mantenimiento/reconciliar_saldo_cc.sh'
        );
    }

    const montoNum = parseFloat(monto);

    // 1. Obtener saldo anterior (calculado)
    const saldoAnterior = await obtenerSaldo(client, id_empresa, id_proveedor);

    // 2. Calcular nuevo saldo
    const debe = tipo === 'debe' ? montoNum : 0;
    const haber = tipo === 'haber' ? montoNum : 0;
    const nuevoSaldo = saldoAnterior + debe - haber;

    // 3. Insertar movimiento
    const res = await client.query(`
        INSERT INTO cuentacorrienteproveedores
        (id_empresa, id_proveedor, concepto, debe, haber, saldo,
         id_comprobante_compra, id_pago_proveedor)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `, [id_empresa, id_proveedor, concepto, debe, haber, nuevoSaldo,
        id_comprobante_compra, id_pago_proveedor]);

    logger.info(`CC Prov #${id_proveedor}: ${tipo} $${montoNum} | $${saldoAnterior} → $${nuevoSaldo} | ${concepto}`);
    return res.rows[0];
}

// ════════════════════════════════════════════════════════════════════════════════
// OPERACIONES DE ALTO NIVEL
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Registra una compra en la CC del proveedor (DEBE — le debemos más).
 * Llamado desde compras.helper.js al crear comprobante.
 */
async function registrarCompra(client, params) {
    const { id_empresa, id_proveedor, id_comprobante_compra, numero_completo, total } = params;

    if (!total || parseFloat(total) <= 0) return null;

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto: total,
        tipo: 'debe',
        concepto: `Compra ${numero_completo || '#' + id_comprobante_compra}`,
        id_comprobante_compra
    });
}

/**
 * Registra una nota de crédito del proveedor (HABER — nos debe menos).
 */
async function registrarNotaCredito(client, params) {
    const { id_empresa, id_proveedor, id_comprobante_compra, numero_completo, total } = params;

    if (!total || parseFloat(total) <= 0) return null;

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto: total,
        tipo: 'haber',
        concepto: `NC Proveedor ${numero_completo || '#' + id_comprobante_compra}`,
        id_comprobante_compra
    });
}

/**
 * Registra la anulacion de una NC del proveedor (DEBE — revierte el haber de la NC).
 */
async function anularNotaCredito(client, params) {
    const { id_empresa, id_proveedor, id_comprobante_compra, numero_completo, total, motivo } = params;

    if (!total || parseFloat(total) <= 0) return null;

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto: total,
        tipo: 'debe',
        concepto: `[ANULACIÓN] NC Proveedor ${numero_completo || '#' + id_comprobante_compra}` + (motivo ? ' - ' + motivo : ''),
        id_comprobante_compra
    });
}

/**
 * Registra una nota INFORMATIVA en la CC (debe=0, haber=0, no mueve saldo).
 * Deja huella en el extracto (ej: imputaciones de saldo a favor).
 */
async function registrarNotaInformativa(client, params) {
    const { id_empresa, id_proveedor, concepto, id_comprobante_compra = null, id_pago_proveedor = null } = params;

    if (!id_empresa || !id_proveedor) {
        throw new Error('cc-proveedores.helper: id_empresa e id_proveedor son obligatorios');
    }
    if (!concepto) {
        throw new Error('cc-proveedores.helper: concepto obligatorio');
    }

    const saldoActual = await obtenerSaldo(client, id_empresa, id_proveedor);

    const res = await client.query(`
        INSERT INTO cuentacorrienteproveedores
        (id_empresa, id_proveedor, concepto, debe, haber, saldo,
         id_comprobante_compra, id_pago_proveedor)
        VALUES ($1, $2, $3, 0, 0, $4, $5, $6)
        RETURNING *
    `, [id_empresa, id_proveedor, concepto, saldoActual, id_comprobante_compra, id_pago_proveedor]);

    logger.info(`CC Prov #${id_proveedor}: nota informativa | ${concepto}`);
    return res.rows[0];
}

/**
 * Registra un pago al proveedor (HABER — le debemos menos).
 * Incluye info de cheques en el concepto para trazabilidad.
 *
 * @param {object} params
 * @param {string} [params.metodo_pago_nombre] - nombre del método
 * @param {object[]} [params.cheques] - [{tipo, numero, banco, fecha_vencimiento, monto}]
 */
async function registrarPago(client, params) {
    const {
        id_empresa, id_proveedor, id_pago_proveedor,
        numero_pago, monto, metodo_pago_nombre = 'Pago',
        cheques = []
    } = params;

    if (!monto || parseFloat(monto) <= 0) return null;

    // Construir concepto con info de cheques
    let concepto = `Pago #${numero_pago || id_pago_proveedor} - ${metodo_pago_nombre}`;

    if (cheques.length > 0) {
        const chequesInfo = cheques.map(ch => {
            const venc = ch.fecha_vencimiento ? ` vto:${ch.fecha_vencimiento}` : '';
            return `Ch.${ch.tipo === 'propio' ? 'Propio' : '3ro'} ${ch.numero}${ch.banco ? ' ' + ch.banco : ''}${venc} $${ch.monto}`;
        }).join(' | ');
        concepto += ` [${chequesInfo}]`;
    }

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto,
        tipo: 'haber',
        concepto,
        id_pago_proveedor
    });
}

/**
 * Anula un pago — registra contra-asiento (DEBE).
 */
async function anularPago(client, params) {
    const { id_empresa, id_proveedor, id_pago_proveedor, numero_pago, monto, motivo = 'Anulación' } = params;

    if (!monto || parseFloat(monto) <= 0) return null;

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto,
        tipo: 'debe',
        concepto: `[ANULACIÓN] Pago #${numero_pago || id_pago_proveedor} - ${motivo}`,
        id_pago_proveedor
    });
}

/**
 * Anula una compra — registra contra-asiento (HABER).
 */
async function anularCompra(client, params) {
    const { id_empresa, id_proveedor, id_comprobante_compra, numero_completo, total, motivo = 'Anulación' } = params;

    if (!total || parseFloat(total) <= 0) return null;

    return registrarMovimiento(client, {
        id_empresa, id_proveedor,
        monto: total,
        tipo: 'haber',
        concepto: `[ANULACIÓN] Compra ${numero_completo || '#' + id_comprobante_compra} - ${motivo}`,
        id_comprobante_compra
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// ELIMINAR / ANULAR MOVIMIENTO (genérico)
// ════════════════════════════════════════════════════════════════════════════════

async function eliminarMovimiento(client, id_movimiento_cc_proveedor) {
    const mov = await client.query(`
        SELECT id_proveedor, id_empresa, concepto
        FROM cuentacorrienteproveedores WHERE id_movimiento_cc_proveedor = $1
    `, [id_movimiento_cc_proveedor]);

    if (mov.rows.length === 0) {
        throw new Error(`cc-proveedores.helper: movimiento ${id_movimiento_cc_proveedor} no encontrado`);
    }

    const { id_proveedor, id_empresa, concepto } = mov.rows[0];
    await client.query('DELETE FROM cuentacorrienteproveedores WHERE id_movimiento_cc_proveedor = $1', [id_movimiento_cc_proveedor]);
    const nuevoSaldo = await recalcularSaldo(client, id_empresa, id_proveedor);

    logger.warn(`CC Prov Eliminado mov #${id_movimiento_cc_proveedor} (${concepto}) → saldo: $${nuevoSaldo}`);
    return nuevoSaldo;
}

// ════════════════════════════════════════════════════════════════════════════════
// ALERTAS DE CHEQUES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Obtiene cheques emitidos/entregados a proveedores próximos a vencer.
 * @param {object} pool - pg pool
 * @param {number} id_empresa
 * @param {number} [dias=7] - días hacia adelante
 */
async function obtenerAlertasCheques(pool, id_empresa, dias = 7) {
    const { rows } = await pool.query(`
        SELECT
            'propio' as tipo_cheque,
            cp.id_cheque, cp.numero_cheque, b.nombre as banco,
            cp.fecha_vencimiento, cp.monto, cp.estado,
            p.razon_social as proveedor, p.id_proveedor,
            cp.fecha_vencimiento - CURRENT_DATE as dias_para_vencer
        FROM cheques_propios cp
        JOIN bancos b ON b.id_banco = cp.id_banco
        LEFT JOIN proveedores p ON p.id_proveedor = cp.id_proveedor
        WHERE cp.id_empresa = $1
            AND cp.estado IN ('emitido', 'entregado')
            AND cp.fecha_vencimiento <= CURRENT_DATE + $2::integer
            AND cp.fecha_vencimiento >= CURRENT_DATE - 3
        UNION ALL
        SELECT
            'tercero' as tipo_cheque,
            ct.id_cheque, ct.numero_cheque, COALESCE(b.nombre, ct.banco_nombre) as banco,
            ct.fecha_vencimiento, ct.monto, ct.estado,
            p.razon_social as proveedor, p.id_proveedor,
            ct.fecha_vencimiento - CURRENT_DATE as dias_para_vencer
        FROM cheques_terceros ct
        LEFT JOIN bancos b ON b.id_banco = ct.id_banco
        LEFT JOIN proveedores p ON p.id_proveedor = ct.id_proveedor
        WHERE ct.id_empresa = $1
            AND ct.estado = 'endosado'
            AND ct.fecha_vencimiento <= CURRENT_DATE + $2::integer
            AND ct.fecha_vencimiento >= CURRENT_DATE - 3
        ORDER BY fecha_vencimiento ASC
    `, [id_empresa, dias]);

    return rows;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Libro mayor del proveedor: saldo anterior arrastrado + movimientos del rango
 * (paginados) + totales. Joins con documento origen para el frontend.
 */
async function obtenerLibro(db, params) {
    const { id_empresa, id_proveedor } = params;
    const desde = params.desde || null;
    const hasta = params.hasta || null;
    const sinPaginacion = params.sin_paginacion === true;

    if (!id_empresa || !id_proveedor) {
        throw new Error('cc-proveedores.helper.obtenerLibro: id_empresa e id_proveedor son obligatorios');
    }

    let pageSize = parseInt(params.items_por_pagina, 10);
    if (!pageSize || pageSize < 1) {
        const rCfg = await db.query(
            "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'cc_prov.libro.items_por_pagina'",
            [id_empresa]
        );
        pageSize = parseInt(rCfg.rows[0] && rCfg.rows[0].valor, 10) || 50;
    }
    const pagina = Math.max(1, parseInt(params.pagina, 10) || 1);
    const offset = (pagina - 1) * pageSize;

    const filtros = ['m.id_empresa = $1', 'm.id_proveedor = $2'];
    const vals = [id_empresa, id_proveedor];
    if (desde) { vals.push(desde); filtros.push('m.fecha::date >= $' + vals.length + '::date'); }
    if (hasta) { vals.push(hasta); filtros.push('m.fecha::date <= $' + vals.length + '::date'); }
    if (params.incluir_anulados !== true) {
        filtros.push("NOT ( (m.id_comprobante_compra IS NOT NULL AND EXISTS (SELECT 1 FROM comprobantes_compra cx WHERE cx.id_comprobante = m.id_comprobante_compra AND cx.estado = 'anulado')) OR (m.id_pago_proveedor IS NOT NULL AND EXISTS (SELECT 1 FROM pagosaproveedores px WHERE px.id_pago_proveedor = m.id_pago_proveedor AND px.estado = 'anulado')) )");
    }
    const where = filtros.join(' AND ');

    let saldoAnterior = 0;
    if (desde) {
        const rPrev = await db.query(
            'SELECT COALESCE(SUM(debe - haber), 0) AS s FROM cuentacorrienteproveedores m ' +
            'WHERE m.id_empresa = $1 AND m.id_proveedor = $2 AND m.fecha::date < $3::date',
            [id_empresa, id_proveedor, desde]
        );
        saldoAnterior = parseFloat(rPrev.rows[0].s);
    }

    const rTot = await db.query(
        'SELECT COUNT(*)::int AS total, COALESCE(SUM(debe),0) AS total_debe, COALESCE(SUM(haber),0) AS total_haber ' +
        'FROM cuentacorrienteproveedores m WHERE ' + where,
        vals
    );

    let sqlMov = `
        SELECT m.id_movimiento_cc_proveedor, m.fecha, m.concepto, m.debe, m.haber, m.saldo,
               m.id_comprobante_compra, c.numero_completo AS comprobante_numero,
               c.estado AS comprobante_estado, t.codigo AS comprobante_tipo,
               m.id_pago_proveedor, p.numero_pago AS pago_numero,
               p.estado AS pago_estado, p.es_pago_a_cuenta
        FROM cuentacorrienteproveedores m
        LEFT JOIN comprobantes_compra c ON c.id_comprobante = m.id_comprobante_compra
        LEFT JOIN comprobante_compra_tipos t ON t.id_tipo = c.id_tipo
        LEFT JOIN pagosaproveedores p ON p.id_pago_proveedor = m.id_pago_proveedor
        WHERE ${where}
        ORDER BY m.fecha ASC, m.id_movimiento_cc_proveedor ASC`;
    let valsMov = vals.slice();
    if (!sinPaginacion) {
        valsMov.push(pageSize, offset);
        sqlMov += ' LIMIT $' + (valsMov.length - 1) + ' OFFSET $' + valsMov.length;
    }
    const rMov = await db.query(sqlMov, valsMov);

    const rSaldo = await db.query(
        'SELECT COALESCE(SUM(debe - haber), 0) AS s FROM cuentacorrienteproveedores WHERE id_empresa = $1 AND id_proveedor = $2',
        [id_empresa, id_proveedor]
    );

    return {
        saldo_anterior: saldoAnterior,
        movimientos: rMov.rows,
        pagina: pagina,
        items_por_pagina: pageSize,
        total_movimientos: rTot.rows[0].total,
        total_debe: parseFloat(rTot.rows[0].total_debe),
        total_haber: parseFloat(rTot.rows[0].total_haber),
        saldo_actual: parseFloat(rSaldo.rows[0].s)
    };
}

module.exports = {
    obtenerSaldo,
    recalcularSaldo,
    registrarMovimiento,
    registrarCompra,
    registrarNotaCredito,
    registrarPago,
    anularPago,
    anularCompra,
    anularNotaCredito,
    registrarNotaInformativa,
    obtenerLibro,
    eliminarMovimiento,
    obtenerAlertasCheques
};
