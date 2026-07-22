'use strict';



// ═══════════════════════════════════════════════════════════════════════
// TERMINALES.HELPER.JS — Helper centralizado para terminales + cuotas
// ERP LAGO — 2026-03-14
// Consumidores: terminales.controller.js, borrador.controller.js
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// TERMINALES — CRUD
// ─────────────────────────────────────────────────────────────────────

async function crearTerminal(client, datos) {
    const { id_empresa, id_deposito, id_banco_destino, nombre, tipo, procesador,
            comision_debito_pct, comision_credito_pct,
            retencion_iva_pct, retencion_iibb_pct, retencion_ganancias_pct } = datos;

    const result = await client.query(`
        INSERT INTO terminales_pago
            (id_empresa, id_deposito, id_banco_destino, nombre, tipo, procesador,
             comision_debito_pct, comision_credito_pct,
             retencion_iva_pct, retencion_iibb_pct, retencion_ganancias_pct)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *
    `, [id_empresa, id_deposito || null, id_banco_destino || null, nombre,
        tipo || 'ambos', procesador || null,
        comision_debito_pct || 0, comision_credito_pct || 0,
        retencion_iva_pct || 0, retencion_iibb_pct || 0, retencion_ganancias_pct || 0]);

    return result.rows[0];
}

async function actualizarTerminal(client, id_terminal, id_empresa, datos) {
    const campos = [];
    const valores = [];
    let idx = 1;

    const permitidos = [
        'id_deposito', 'id_banco_destino', 'nombre', 'tipo', 'procesador',
        'comision_debito_pct', 'comision_credito_pct',
        'retencion_iva_pct', 'retencion_iibb_pct', 'retencion_ganancias_pct', 'activo'
    ];

    for (const campo of permitidos) {
        if (datos[campo] !== undefined) {
            campos.push(`${campo} = $${idx}`);
            valores.push(datos[campo]);
            idx++;
        }
    }

    if (campos.length === 0) throw new Error('No hay campos para actualizar');

    campos.push(`updated_at = NOW()`);
    valores.push(id_terminal, id_empresa);

    const result = await client.query(`
        UPDATE terminales_pago
        SET ${campos.join(', ')}
        WHERE id_terminal = $${idx} AND id_empresa = $${idx + 1}
        RETURNING *
    `, valores);

    if (result.rows.length === 0) throw new Error('Terminal no encontrada');
    return result.rows[0];
}

async function desactivarTerminal(client, id_terminal, id_empresa) {
    // Desactivar terminal + sus planes
    await client.query(`
        UPDATE planes_cuotas SET activo = false, updated_at = NOW()
        WHERE id_terminal = $1 AND id_empresa = $2
    `, [id_terminal, id_empresa]);

    const result = await client.query(`
        UPDATE terminales_pago SET activo = false, updated_at = NOW()
        WHERE id_terminal = $1 AND id_empresa = $2
        RETURNING *
    `, [id_terminal, id_empresa]);

    if (result.rows.length === 0) throw new Error('Terminal no encontrada');
    return result.rows[0];
}

async function obtenerTerminal(client, id_terminal, id_empresa) {
    const result = await client.query(`
        SELECT t.*, b.nombre as banco_nombre, d.nombre as deposito_nombre
        FROM terminales_pago t
        LEFT JOIN bancos b ON b.id_banco = t.id_banco_destino
        LEFT JOIN depositos d ON d.id_deposito = t.id_deposito
        WHERE t.id_terminal = $1 AND t.id_empresa = $2
    `, [id_terminal, id_empresa]);

    return result.rows[0] || null;
}

async function obtenerTerminalesActivas(client, id_empresa, id_deposito) {
    // Filtra por depósito: muestra las asignadas a ESE depósito + las globales (NULL)
    const result = await client.query(`
        SELECT t.*, b.nombre as banco_nombre, d.nombre as deposito_nombre
        FROM terminales_pago t
        LEFT JOIN bancos b ON b.id_banco = t.id_banco_destino
        LEFT JOIN depositos d ON d.id_deposito = t.id_deposito
        WHERE t.id_empresa = $1
          AND t.activo = true
          AND (t.id_deposito IS NULL OR t.id_deposito = $2)
        ORDER BY t.nombre
    `, [id_empresa, id_deposito]);

    return result.rows;
}

async function listarTerminales(client, id_empresa) {
    const result = await client.query(`
        SELECT t.*, b.nombre as banco_nombre, d.nombre as deposito_nombre,
               COUNT(pc.id_plan) FILTER (WHERE pc.activo = true) as planes_activos
        FROM terminales_pago t
        LEFT JOIN bancos b ON b.id_banco = t.id_banco_destino
        LEFT JOIN depositos d ON d.id_deposito = t.id_deposito
        LEFT JOIN planes_cuotas pc ON pc.id_terminal = t.id_terminal
        WHERE t.id_empresa = $1
        GROUP BY t.id_terminal, b.nombre, d.nombre
        ORDER BY t.activo DESC, t.nombre
    `, [id_empresa]);

    return result.rows;
}

// ─────────────────────────────────────────────────────────────────────
// PLANES DE CUOTAS — CRUD
// ─────────────────────────────────────────────────────────────────────

async function crearPlan(client, datos) {
    const { id_empresa, id_terminal, cuotas, coeficiente, nombre, orden } = datos;

    const result = await client.query(`
        INSERT INTO planes_cuotas (id_empresa, id_terminal, cuotas, coeficiente, nombre, orden)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
    `, [id_empresa, id_terminal, cuotas, coeficiente, nombre || `${cuotas} cuota${cuotas > 1 ? 's' : ''}`, orden || cuotas]);

    return result.rows[0];
}

async function actualizarPlan(client, id_plan, id_empresa, datos) {
    const campos = [];
    const valores = [];
    let idx = 1;

    const permitidos = ['cuotas', 'coeficiente', 'nombre', 'activo', 'orden'];

    for (const campo of permitidos) {
        if (datos[campo] !== undefined) {
            campos.push(`${campo} = $${idx}`);
            valores.push(datos[campo]);
            idx++;
        }
    }

    if (campos.length === 0) throw new Error('No hay campos para actualizar');

    campos.push(`updated_at = NOW()`);
    valores.push(id_plan, id_empresa);

    const result = await client.query(`
        UPDATE planes_cuotas
        SET ${campos.join(', ')}
        WHERE id_plan = $${idx} AND id_empresa = $${idx + 1}
        RETURNING *
    `, valores);

    if (result.rows.length === 0) throw new Error('Plan no encontrado');
    return result.rows[0];
}

async function desactivarPlan(client, id_plan, id_empresa) {
    const result = await client.query(`
        UPDATE planes_cuotas SET activo = false, updated_at = NOW()
        WHERE id_plan = $1 AND id_empresa = $2
        RETURNING *
    `, [id_plan, id_empresa]);

    if (result.rows.length === 0) throw new Error('Plan no encontrado');
    return result.rows[0];
}

async function obtenerPlanesTerminal(client, id_terminal, id_empresa) {
    const result = await client.query(`
        SELECT * FROM planes_cuotas
        WHERE id_terminal = $1 AND id_empresa = $2 AND activo = true
        ORDER BY orden, cuotas
    `, [id_terminal, id_empresa]);

    return result.rows;
}

async function obtenerPlan(client, id_plan, id_empresa) {
    const result = await client.query(`
        SELECT pc.*, tp.nombre as terminal_nombre, tp.procesador
        FROM planes_cuotas pc
        JOIN terminales_pago tp USING(id_terminal)
        WHERE pc.id_plan = $1 AND pc.id_empresa = $2
    `, [id_plan, id_empresa]);

    return result.rows[0] || null;
}

async function actualizarPlanesMasivo(client, id_terminal, id_empresa, planes) {
    // planes = [{ cuotas: 3, coeficiente: 1.18 }, ...]
    const resultados = [];

    for (const plan of planes) {
        const result = await client.query(`
            UPDATE planes_cuotas
            SET coeficiente = $1, updated_at = NOW()
            WHERE id_terminal = $2 AND id_empresa = $3 AND cuotas = $4
            RETURNING *
        `, [plan.coeficiente, id_terminal, id_empresa, plan.cuotas]);

        if (result.rows.length > 0) resultados.push(result.rows[0]);
    }

    return resultados;
}

// ─────────────────────────────────────────────────────────────────────
// CÁLCULO DE INTERÉS + COMISIÓN
// Función clave que consume borrador.controller.js
// ─────────────────────────────────────────────────────────────────────

async function calcularInteres(client, id_plan, id_empresa, monto_base) {
    const plan = await client.query(`
        SELECT pc.*, tp.comision_credito_pct, tp.comision_debito_pct,
               tp.retencion_iva_pct, tp.retencion_iibb_pct, tp.retencion_ganancias_pct,
               tp.id_terminal, tp.nombre as terminal_nombre
        FROM planes_cuotas pc
        JOIN terminales_pago tp ON tp.id_terminal = pc.id_terminal
        WHERE pc.id_plan = $1 AND pc.id_empresa = $2 AND pc.activo = true AND tp.activo = true
    `, [id_plan, id_empresa]);

    if (plan.rows.length === 0) throw new Error('Plan de cuotas no encontrado o inactivo');

    const p = plan.rows[0];
    const monto_original = parseFloat(monto_base);
    const coeficiente = parseFloat(p.coeficiente);
    const monto_final = Math.round(monto_original * coeficiente * 100) / 100;

    // Comisión: sobre monto_final (lo que cobra el posnet)
    const comision_pct = p.cuotas > 1
        ? parseFloat(p.comision_credito_pct)
        : parseFloat(p.comision_debito_pct);
    const retencion_total_pct = parseFloat(p.retencion_iva_pct || 0)
        + parseFloat(p.retencion_iibb_pct || 0)
        + parseFloat(p.retencion_ganancias_pct || 0);
    const comision_estimada = Math.round(monto_final * (comision_pct + retencion_total_pct) / 100 * 100) / 100;
    const neto_estimado = Math.round((monto_final - comision_estimada) * 100) / 100;

    return {
        id_terminal: p.id_terminal,
        id_plan: p.id_plan,
        terminal_nombre: p.terminal_nombre,
        cuotas: p.cuotas,
        coeficiente,
        monto_original,
        monto_final,
        interes: Math.round((monto_final - monto_original) * 100) / 100,
        comision_estimada,
        neto_estimado,
        valor_cuota: p.cuotas > 1 ? Math.round(monto_final / p.cuotas * 100) / 100 : monto_final
    };
}

// Preview sin persistir — para el modal del frontend
async function previewCuotas(client, id_terminal, id_empresa, monto_base) {
    const planes = await obtenerPlanesTerminal(client, id_terminal, id_empresa);
    const monto = parseFloat(monto_base);

    return planes.map(p => {
        const coef = parseFloat(p.coeficiente);
        const monto_final = Math.round(monto * coef * 100) / 100;
        const valor_cuota = p.cuotas > 1 ? Math.round(monto_final / p.cuotas * 100) / 100 : monto_final;

        return {
            id_plan: p.id_plan,
            cuotas: p.cuotas,
            coeficiente: coef,
            interes_porcentaje: parseFloat(p.interes_porcentaje),
            nombre: p.nombre,
            monto_original: monto,
            monto_final,
            interes: Math.round((monto_final - monto) * 100) / 100,
            valor_cuota
        };
    });
}

// ─────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────

module.exports = {
    // Terminales
    crearTerminal,
    actualizarTerminal,
    desactivarTerminal,
    obtenerTerminal,
    obtenerTerminalesActivas,
    listarTerminales,
    // Planes
    crearPlan,
    actualizarPlan,
    desactivarPlan,
    obtenerPlanesTerminal,
    obtenerPlan,
    actualizarPlanesMasivo,
    // Cálculo
    calcularInteres,
    previewCuotas
};
