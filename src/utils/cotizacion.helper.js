/**
 * ═══════════════════════════════════════════════════════════════════════════
 * cotizacion.helper.js — ERP LAGO
 * Fuente única de verdad para cotizaciones USD/ARS
 * ═══════════════════════════════════════════════════════════════════════════
 * Funciones expuestas:
 *   - obtenerVigenteUSD(client, id_empresa, opts?)   → cotización USD vigente
 *   - sincronizarBlueAuto(pool, id_empresa)          → consulta DolarAPI + UPSERT
 *   - obtenerConfig(client, id_empresa)              → configs moneda.*
 *   - antiguedadDias(fechaCotizacion)                → días desde la cotización
 *
 * Convención:
 *   - id_moneda = 2 significa USD (constante ID_MONEDA_USD)
 *   - Fuente configurable: blue_venta | blue_compra | blue_promedio
 *   - Si no hay cotización en BD, fuerza una sincronización automática
 *
 * Callers:
 *   - compras.helper (al crear comprobante)
 *   - recibos.controller (ya usa obtenerCotizacion inline — migrar)
 *   - pedidos.controller (para ventas USD)
 *   - cotizaciones.controller (endpoints REST)
 *   - cron interno
 */

const https = require('https');

const ID_MONEDA_USD = 2;

/**
 * Lee todas las claves 'compras.moneda.*' con defaults sanos.
 */
async function obtenerConfig(client, id_empresa) {
    const { rows } = await client.query(
        `SELECT clave, valor FROM configuraciones_empresa
         WHERE id_empresa = $1 AND clave LIKE 'compras.moneda.%'`,
        [id_empresa]
    );
    const map = {};
    rows.forEach(r => { map[r.clave.replace('compras.moneda.', '')] = r.valor; });
    return {
        fuente_usd:               map.fuente_usd               || 'blue_venta',
        auto_sincronizar:         map.auto_sincronizar         !== 'false',
        cron_horas_intervalo:     parseInt(map.cron_horas_intervalo) || 6,
        tolerancia_dias_vigencia: parseInt(map.tolerancia_dias_vigencia) || 7,
        bloquear_sin_cotizacion:  map.bloquear_sin_cotizacion  === 'true',
        api_url_blue:             map.api_url_blue             || 'https://dolarapi.com/v1/dolares/blue',
        warning_dias_vieja:       parseInt(map.warning_dias_vieja) || 3
    };
}

/**
 * Calcula días transcurridos desde la fecha_cotizacion.
 */
function antiguedadDias(fechaCotizacion) {
    if (!fechaCotizacion) return Infinity;
    const f = new Date(fechaCotizacion);
    const hoy = new Date();
    const diffMs = hoy.setHours(0,0,0,0) - f.setHours(0,0,0,0);
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Extrae el valor según la fuente configurada.
 */
function _extraerValor(row, fuente) {
    if (!row) return null;
    const compra = parseFloat(row.cotizacion_compra);
    const venta  = parseFloat(row.cotizacion_venta);
    switch (fuente) {
        case 'blue_compra':   return compra;
        case 'blue_promedio': return (compra + venta) / 2;
        case 'blue_venta':
        default:              return venta;
    }
}

/**
 * Consulta DolarAPI blue y UPSERT en tabla cotizaciones.
 * Retorna la cotización guardada o throw en error.
 */
async function sincronizarBlueAuto(pool, id_empresa) {
    const cfg = await obtenerConfig(pool, id_empresa);
    const data = await new Promise((resolve, reject) => {
        const req = https.get(cfg.api_url_blue, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(new Error('DolarAPI devolvió JSON inválido')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('DolarAPI timeout 10s')); });
    });

    if (!data || !data.compra || !data.venta) {
        throw new Error('DolarAPI respuesta inválida: ' + JSON.stringify(data).slice(0, 200));
    }

    // UPSERT respetando el UNIQUE(id_empresa, id_moneda, fecha_cotizacion, hora_cotizacion)
    // Usamos hora_cotizacion = now() para permitir varios refreshes por día
    const { rows } = await pool.query(`
        INSERT INTO cotizaciones
            (id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, fecha_cotizacion, hora_cotizacion, tipo, fuente)
        VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_TIME, 'automatico', 'DolarAPI Blue')
        ON CONFLICT (id_empresa, id_moneda, fecha_cotizacion, hora_cotizacion) DO UPDATE
            SET cotizacion_compra = EXCLUDED.cotizacion_compra,
                cotizacion_venta  = EXCLUDED.cotizacion_venta,
                fuente            = EXCLUDED.fuente
        RETURNING *
    `, [id_empresa, ID_MONEDA_USD, data.compra, data.venta]);

    return { cotizacion: rows[0], api: data };
}

/**
 * Devuelve la cotización USD vigente según configuración.
 * Si no hay o está fuera de tolerancia y auto_sincronizar está on → sincroniza primero.
 *
 * Retorno:
 *   {
 *     valor:               1475.00,          ← el número a usar para multiplicar/dividir
 *     id_cotizacion:       42,
 *     fecha_cotizacion:    '2026-04-23',
 *     cotizacion_compra:   1455,
 *     cotizacion_venta:    1475,
 *     fuente_usada:        'blue_venta',
 *     dias_antiguedad:     0,
 *     esta_desactualizada: false,
 *     fuente_fila:         'DolarAPI Blue'
 *   }
 *
 * @param opts.forceFresh    true → ignora cache BD y sincroniza primero
 * @param opts.noSync        true → no sincroniza aunque esté vieja (para reportes)
 */
async function obtenerVigenteUSD(client, id_empresa, opts = {}) {
    const cfg = await obtenerConfig(client, id_empresa);

    // Si forzamos refresh o auto-sync está on, sincronizar SIEMPRE primero (solo si pool, no tx)
    let needSync = opts.forceFresh === true;

    // Buscar última cotización
    const { rows } = await client.query(
        `SELECT id_cotizacion, cotizacion_compra, cotizacion_venta, fecha_cotizacion, hora_cotizacion, fuente, tipo
         FROM cotizaciones
         WHERE id_empresa = $1 AND id_moneda = $2
         ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC
         LIMIT 1`,
        [id_empresa, ID_MONEDA_USD]
    );

    let row = rows[0] || null;
    const dias = row ? antiguedadDias(row.fecha_cotizacion) : Infinity;

    // Si no hay cotización, o si está vieja Y auto_sincronizar, intentar sincronizar
    // (solo si client es pool, no transacción — sincronizar en tx puede colgar por HTTPS)
    const esPool = typeof client.idleCount !== 'undefined' || typeof client.totalCount !== 'undefined';
    const debeSync = (!row || dias > cfg.tolerancia_dias_vigencia || needSync) && cfg.auto_sincronizar && esPool && !opts.noSync;

    if (debeSync) {
        try {
            const sync = await sincronizarBlueAuto(client, id_empresa);
            row = sync.cotizacion;
        } catch (e) {
            console.warn('[cotizacion.helper] Sync automático falló, uso última BD:', e.message);
            // Caemos con lo que haya en BD (puede ser null si nunca hubo)
        }
    }

    if (!row) {
        if (cfg.bloquear_sin_cotizacion) {
            throw new Error('No hay cotización USD disponible y auto-sync falló. Config exige cotización.');
        }
        return {
            valor: null, id_cotizacion: null, fecha_cotizacion: null,
            cotizacion_compra: null, cotizacion_venta: null,
            fuente_usada: cfg.fuente_usd, dias_antiguedad: Infinity,
            esta_desactualizada: true, fuente_fila: null
        };
    }

    const valor = _extraerValor(row, cfg.fuente_usd);
    const diasFinal = antiguedadDias(row.fecha_cotizacion);
    return {
        valor: valor,
        id_cotizacion: row.id_cotizacion,
        fecha_cotizacion: row.fecha_cotizacion,
        cotizacion_compra: parseFloat(row.cotizacion_compra),
        cotizacion_venta:  parseFloat(row.cotizacion_venta),
        fuente_usada: cfg.fuente_usd,
        dias_antiguedad: diasFinal,
        esta_desactualizada: diasFinal > cfg.warning_dias_vieja,
        fuente_fila: row.fuente
    };
}

module.exports = {
    ID_MONEDA_USD,
    obtenerConfig,
    antiguedadDias,
    obtenerVigenteUSD,
    sincronizarBlueAuto
};
