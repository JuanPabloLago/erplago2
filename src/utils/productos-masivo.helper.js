/**
 * productos-masivo.helper.js
 * ─────────────────────────────────────────────────────────────
 * Single write point para operaciones masivas sobre catálogo de productos.
 * Sesión 2026-05-25 — productos masivos fix.
 *
 * Responsabilidades:
 *   - Validar tope_por_operacion + umbral de motivo obligatorio.
 *   - Leer valores previos para reconstrucción.
 *   - Delegar la mutación a productos.helper (single write point existente).
 *   - Escribir bitacora_catalogo con 1 fila por operación masiva (D-06).
 *
 * NO contiene SQL de UPDATE sobre productos — esa lógica vive en productos.helper.
 * NO contiene lógica de ajuste de precios — esa sigue inline en el controller
 *   por scope (deuda D4). Solo registra el resumen en bitácora.
 *
 * Convención bitacora_catalogo para masivos:
 *   - entidad   = 'producto'
 *   - id_entidad = 0          (centinela: ver payload.ids_afectados)
 *   - accion    ∈ {masivo_estado, masivo_visible_web, masivo_ajuste_precio}
 *   - payload jsonb = { cantidad, ids_afectados, valores_previos, valor_nuevo,
 *                       motivo, filtros_aplicados, origen }
 */

const ACCIONES = Object.freeze({
    ESTADO: 'masivo_estado',
    VISIBLE_WEB: 'masivo_visible_web',
    AJUSTE_PRECIO: 'masivo_ajuste_precio'
});

const ID_ENTIDAD_MASIVO = 0;  // centinela
const ENTIDAD = 'producto';

// ============================================================
// Helpers internos
// ============================================================

function _toInt(val, fallback) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
}
function _toBool(val, fallback) {
    if (val === true || val === 'true') return true;
    if (val === false || val === 'false') return false;
    return fallback;
}

/**
 * Lee config namespace masivo.* desde configuraciones_empresa.
 * Devuelve objeto normalizado con defaults si faltan claves.
 */
async function leerConfig(client, id_empresa) {
    if (!id_empresa) {
        const e = new Error('id_empresa requerido para leer config masivo.*');
        e.statusCode = 400;
        throw e;
    }
    const { rows } = await client.query(
        `SELECT clave, valor FROM configuraciones_empresa
         WHERE id_empresa = $1 AND clave LIKE 'masivo.%'`,
        [id_empresa]
    );
    const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    return {
        motivo_obligatorio_desde:        _toInt(cfg['masivo.motivo_obligatorio_desde'], 50),
        motivo_minimo_caracteres:        _toInt(cfg['masivo.motivo_minimo_caracteres'], 5),
        tope_por_operacion:              _toInt(cfg['masivo.tope_por_operacion'], 5000),
        bitacora_incluir_ids:            _toBool(cfg['masivo.bitacora_incluir_ids'], true),
        bitacora_incluir_valores_previos:_toBool(cfg['masivo.bitacora_incluir_valores_previos'], true)
    };
}

/**
 * Valida ids no vacío + tope no excedido + motivo según umbral.
 * Throw con statusCode 400 si rompe regla.
 * Devuelve cfg para reutilización aguas abajo.
 */
async function validarUmbralYMotivo(client, { id_empresa, ids, motivo }) {
    if (!Array.isArray(ids) || ids.length === 0) {
        const e = new Error('Debe enviar al menos un producto');
        e.statusCode = 400; throw e;
    }
    const cfg = await leerConfig(client, id_empresa);
    if (ids.length > cfg.tope_por_operacion) {
        const e = new Error(`Tope excedido: ${ids.length} productos supera el máximo de ${cfg.tope_por_operacion} por operación. Filtrá más y reintentá.`);
        e.statusCode = 400; throw e;
    }
    if (ids.length >= cfg.motivo_obligatorio_desde) {
        const motivoTrim = (motivo || '').trim();
        if (motivoTrim.length < cfg.motivo_minimo_caracteres) {
            const e = new Error(`Motivo obligatorio (mínimo ${cfg.motivo_minimo_caracteres} caracteres) para operaciones de ${cfg.motivo_obligatorio_desde}+ productos.`);
            e.statusCode = 400; throw e;
        }
    }
    return cfg;
}

/**
 * Lee valores previos de un campo (activo|visible_web) para los ids dados.
 * Devuelve array [{id_producto, <campo>}].
 */
async function leerValoresPrevios(client, ids, campo) {
    const campoSeguro = ['activo', 'visible_web'].includes(campo) ? campo : null;
    if (!campoSeguro) {
        const e = new Error(`Campo inválido para snapshot: ${campo}`);
        e.statusCode = 500; throw e;
    }
    const { rows } = await client.query(
        `SELECT id_producto, ${campoSeguro} FROM productos
         WHERE id_producto = ANY($1::int[])`,
        [ids]
    );
    return rows;
}

/**
 * Inserta UNA fila en bitacora_catalogo para la operación masiva (D-06).
 * Debe llamarse dentro de la misma TX que la mutación.
 */
async function registrarEnBitacora(client, {
    id_empresa, id_usuario, ip, accion,
    ids_afectados, valores_previos, valor_nuevo,
    motivo, filtros, origen, cfg
}) {
    const payload = {
        cantidad: Array.isArray(ids_afectados) ? ids_afectados.length : 0,
        motivo: motivo ? String(motivo).trim().substring(0, 500) : null,
        origen: origen || 'productos.html'
    };
    if (cfg.bitacora_incluir_ids && Array.isArray(ids_afectados)) {
        payload.ids_afectados = ids_afectados;
    }
    if (cfg.bitacora_incluir_valores_previos && valores_previos != null) {
        payload.valores_previos = valores_previos;
    }
    if (valor_nuevo !== undefined) payload.valor_nuevo = valor_nuevo;
    if (filtros) payload.filtros_aplicados = filtros;

    await client.query(
        `INSERT INTO bitacora_catalogo
           (id_empresa, id_usuario, ip, entidad, id_entidad, accion, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
            id_empresa,
            id_usuario || null,
            ip || null,
            ENTIDAD,
            ID_ENTIDAD_MASIVO,
            accion,
            JSON.stringify(payload)
        ]
    );
}

// ============================================================
// Orquestadores (uno por operación)
// ============================================================

/**
 * Cambia activo de N productos + escribe bitácora en la misma TX.
 * Recibe pool (no client) — abre su propia conexión.
 */
async function cambiarEstadoConBitacora(pool, ctx) {
    const { id_empresa, id_usuario, ip, ids, activar, motivo, filtros } = ctx;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cfg = await validarUmbralYMotivo(client, { id_empresa, ids, motivo });

        const valores_previos = cfg.bitacora_incluir_valores_previos
            ? await leerValoresPrevios(client, ids, 'activo')
            : null;

        const productosHelper = require('./productos.helper');
        const rows = await productosHelper.cambiarEstadoMasivo(client, { ids, activar });
        const ids_afectados = Array.isArray(rows) ? rows.map(r => r.id_producto) : ids;

        await registrarEnBitacora(client, {
            id_empresa, id_usuario, ip,
            accion: ACCIONES.ESTADO,
            ids_afectados, valores_previos,
            valor_nuevo: { activo: activar === true },
            motivo, filtros, cfg
        });

        await client.query('COMMIT');
        return { afectados: ids_afectados.length, ids: ids_afectados };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Cambia visible_web de N productos + escribe bitácora en la misma TX.
 */
async function cambiarVisibleWebConBitacora(pool, ctx) {
    const { id_empresa, id_usuario, ip, ids, visible_web, motivo, filtros } = ctx;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cfg = await validarUmbralYMotivo(client, { id_empresa, ids, motivo });

        const valores_previos = cfg.bitacora_incluir_valores_previos
            ? await leerValoresPrevios(client, ids, 'visible_web')
            : null;

        const productosHelper = require('./productos.helper');
        const afectados = await productosHelper.cambiarVisibleWebMasivo(client, { ids, visible_web });

        await registrarEnBitacora(client, {
            id_empresa, id_usuario, ip,
            accion: ACCIONES.VISIBLE_WEB,
            ids_afectados: ids, valores_previos,
            valor_nuevo: { visible_web: visible_web === true },
            motivo, filtros, cfg
        });

        await client.query('COMMIT');
        const cant = typeof afectados === 'number' ? afectados : ids.length;
        return { afectados: cant, ids };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Solo registra el resumen del ajuste masivo de precios en bitácora.
 * NO ejecuta el ajuste — esa lógica sigue inline en ajustePrecioMasivo del
 * controller (deuda D4, scope futuro). Llamar dentro de la misma TX que el
 * ajuste, antes del COMMIT.
 */
async function registrarAjusteEnBitacora(client, ctx) {
    const {
        id_empresa, id_usuario, ip, ids, motivo,
        porcentaje, tipo, aplicar_venta, aplicar_compra,
        productos_afectados, precios_actualizados, filtros
    } = ctx;
    const cfg = await leerConfig(client, id_empresa);
    await registrarEnBitacora(client, {
        id_empresa, id_usuario, ip,
        accion: ACCIONES.AJUSTE_PRECIO,
        ids_afectados: ids,
        valores_previos: null,  // disponibles en historial_precios_ventas
        valor_nuevo: {
            porcentaje, tipo,
            aplicar_venta: !!aplicar_venta,
            aplicar_compra: !!aplicar_compra,
            productos_afectados,
            precios_actualizados
        },
        motivo, filtros, cfg
    });
}

module.exports = {
    ACCIONES,
    ID_ENTIDAD_MASIVO,
    ENTIDAD,
    leerConfig,
    validarUmbralYMotivo,
    leerValoresPrevios,
    registrarEnBitacora,
    cambiarEstadoConBitacora,
    cambiarVisibleWebConBitacora,
    registrarAjusteEnBitacora
};
