/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SERVICIO DE CONFIGURACIÓN - ERP LAGO
 * ════════════════════════════════════════════════════════════════════════════════
 * Maneja lectura y escritura de configuraciones por empresa
 * Tabla: configuraciones_empresa (clave-valor)
 * ════════════════════════════════════════════════════════════════════════════════
 */

const db = require('../config/database');

// Cache en memoria para evitar consultas repetidas (TTL: 5 minutos)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Configuraciones por defecto del sistema
 * Se usan cuando no existe la clave en la BD
 */
const DEFAULTS = {
    // ═══ STOCK ═══
    'stock.permitir_negativo': {
        valor: 'true',
        tipo: 'boolean',
        descripcion: 'Permite entregas aunque no haya stock suficiente'
    },
    'stock.avisar_insuficiente': {
        valor: 'true',
        tipo: 'boolean',
        descripcion: 'Muestra advertencia cuando el stock es insuficiente'
    },
    'stock.bloquear_venta_sin_stock': {
        valor: 'false',
        tipo: 'boolean',
        descripcion: 'Bloquea ventas de productos sin stock'
    },
    
    // ═══ ENTREGAS ═══
    'entregas.requiere_pago_completo': {
        valor: 'false',
        tipo: 'boolean',
        descripcion: 'Requiere pago completo antes de permitir entrega'
    },
    'entregas.generar_remito_automatico': {
        valor: 'true',
        tipo: 'boolean',
        descripcion: 'Genera remito automáticamente al registrar entrega'
    },
    'entregas.formato_remito': {
        valor: 'R-{pv}-{num}',
        tipo: 'string',
        descripcion: 'Formato del número de remito (pv=punto venta, num=número)'
    },
    
    // ═══ PAGOS ═══
    'pagos.requiere_clave_confirmacion': {
        valor: 'true',
        tipo: 'boolean',
        descripcion: 'Requiere clave del usuario para confirmar pagos'
    },
    'pagos.limite_sin_autorizacion': {
        valor: '50000',
        tipo: 'number',
        descripcion: 'Monto máximo para entregar con deuda sin autorización'
    }
};

/**
 * Obtiene una configuración de empresa
 * @param {number} id_empresa 
 * @param {string} clave - Ej: 'stock.permitir_negativo'
 * @returns {Promise<any>} - Valor parseado según tipo
 */
async function obtener(id_empresa, clave) {
    const cacheKey = `${id_empresa}:${clave}`;
    
    // Verificar cache
    if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.valor;
        }
        cache.delete(cacheKey);
    }
    
    try {
        const result = await db.query(
            `SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2`,
            [id_empresa, clave]
        );
        
        let valor;
        if (result.rows.length > 0) {
            valor = parsearValor(result.rows[0].valor, DEFAULTS[clave]?.tipo || 'string');
        } else if (DEFAULTS[clave]) {
            valor = parsearValor(DEFAULTS[clave].valor, DEFAULTS[clave].tipo);
        } else {
            valor = null;
        }
        
        // Guardar en cache
        cache.set(cacheKey, { valor, timestamp: Date.now() });
        
        return valor;
    } catch (error) {
        console.error(`Error obteniendo config ${clave}:`, error.message);
        // Devolver default si hay error
        return DEFAULTS[clave] ? parsearValor(DEFAULTS[clave].valor, DEFAULTS[clave].tipo) : null;
    }
}

/**
 * Obtiene múltiples configuraciones de una vez
 * @param {number} id_empresa 
 * @param {string[]} claves 
 * @returns {Promise<Object>}
 */
async function obtenerVarias(id_empresa, claves) {
    const resultado = {};
    
    try {
        const result = await db.query(
            `SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = ANY($2)`,
            [id_empresa, claves]
        );
        
        // Mapear resultados de BD
        const dbValues = new Map(result.rows.map(r => [r.clave, r.valor]));
        
        // Procesar cada clave solicitada
        for (const clave of claves) {
            if (dbValues.has(clave)) {
                resultado[clave] = parsearValor(dbValues.get(clave), DEFAULTS[clave]?.tipo || 'string');
            } else if (DEFAULTS[clave]) {
                resultado[clave] = parsearValor(DEFAULTS[clave].valor, DEFAULTS[clave].tipo);
            } else {
                resultado[clave] = null;
            }
        }
        
        return resultado;
    } catch (error) {
        console.error('Error obteniendo configs:', error.message);
        // Devolver defaults
        for (const clave of claves) {
            resultado[clave] = DEFAULTS[clave] ? parsearValor(DEFAULTS[clave].valor, DEFAULTS[clave].tipo) : null;
        }
        return resultado;
    }
}

/**
 * Guarda una configuración
 * @param {number} id_empresa 
 * @param {string} clave 
 * @param {any} valor 
 * @returns {Promise<boolean>}
 */
async function guardar(id_empresa, clave, valor) {
    try {
        const valorStr = String(valor);
        const descripcion = DEFAULTS[clave]?.descripcion || null;
        
        await db.query(`
            INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion, fecha_modificacion)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (id_empresa, clave) 
            DO UPDATE SET valor = $3, fecha_modificacion = NOW()
        `, [id_empresa, clave, valorStr, descripcion]);
        
        // Invalidar cache
        cache.delete(`${id_empresa}:${clave}`);
        
        return true;
    } catch (error) {
        console.error(`Error guardando config ${clave}:`, error.message);
        return false;
    }
}

/**
 * Obtiene todas las configuraciones de una empresa con sus defaults
 * @param {number} id_empresa 
 * @returns {Promise<Object[]>}
 */
async function obtenerTodas(id_empresa) {
    try {
        const result = await db.query(
            `SELECT clave, valor, descripcion, fecha_modificacion 
             FROM configuraciones_empresa 
             WHERE id_empresa = $1 
             ORDER BY clave`,
            [id_empresa]
        );
        
        const dbConfigs = new Map(result.rows.map(r => [r.clave, r]));
        const todas = [];
        
        // Combinar con defaults
        for (const [clave, def] of Object.entries(DEFAULTS)) {
            const dbConfig = dbConfigs.get(clave);
            todas.push({
                clave,
                valor: dbConfig ? parsearValor(dbConfig.valor, def.tipo) : parsearValor(def.valor, def.tipo),
                valorRaw: dbConfig ? dbConfig.valor : def.valor,
                tipo: def.tipo,
                descripcion: dbConfig?.descripcion || def.descripcion,
                esDefault: !dbConfig,
                fechaModificacion: dbConfig?.fecha_modificacion || null
            });
        }
        
        // Agregar configs personalizadas que no están en DEFAULTS
        for (const [clave, config] of dbConfigs) {
            if (!DEFAULTS[clave]) {
                todas.push({
                    clave,
                    valor: config.valor,
                    valorRaw: config.valor,
                    tipo: 'string',
                    descripcion: config.descripcion,
                    esDefault: false,
                    fechaModificacion: config.fecha_modificacion
                });
            }
        }
        
        return todas.sort((a, b) => a.clave.localeCompare(b.clave));
    } catch (error) {
        console.error('Error obteniendo todas las configs:', error.message);
        return [];
    }
}

/**
 * Inicializa configuraciones por defecto para una empresa
 * @param {number} id_empresa 
 */
async function inicializarDefaults(id_empresa) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        for (const [clave, def] of Object.entries(DEFAULTS)) {
            await client.query(`
                INSERT INTO configuraciones_empresa (id_empresa, clave, valor, descripcion)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id_empresa, clave) DO NOTHING
            `, [id_empresa, clave, def.valor, def.descripcion]);
        }
        
        await client.query('COMMIT');
        console.log(`✓ Configuraciones inicializadas para empresa ${id_empresa}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error inicializando configs:', error.message);
    } finally {
        client.release();
    }
}

/**
 * Limpia el cache (útil después de guardar múltiples configs)
 * @param {number} id_empresa - Si se especifica, solo limpia esa empresa
 */
function limpiarCache(id_empresa = null) {
    if (id_empresa) {
        for (const key of cache.keys()) {
            if (key.startsWith(`${id_empresa}:`)) {
                cache.delete(key);
            }
        }
    } else {
        cache.clear();
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function parsearValor(valor, tipo) {
    if (valor === null || valor === undefined) return null;
    
    switch (tipo) {
        case 'boolean':
            return valor === 'true' || valor === '1' || valor === true;
        case 'number':
            return parseFloat(valor) || 0;
        case 'integer':
            return parseInt(valor) || 0;
        case 'json':
            try { return JSON.parse(valor); } catch { return null; }
        default:
            return String(valor);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
    obtener,
    obtenerVarias,
    guardar,
    obtenerTodas,
    inicializarDefaults,
    limpiarCache,
    DEFAULTS
};
