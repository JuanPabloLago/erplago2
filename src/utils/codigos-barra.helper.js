/**
 * codigos-barra.helper.js
 * Gestion centralizada de codigos de barra (tabla productocodigosbarras)
 * 
 * Tabla: productocodigosbarras (COMPARTIDA - sin id_empresa)
 *   PK: codigo_barras (unico globalmente, apunta a 1 producto)
 *   FK: id_producto -> productos(id_producto) ON DELETE CASCADE
 * 
 * Un producto puede tener N codigos. Cada codigo pertenece a UN solo producto.
 */

const logger = require('./logger');

// ============================================================================
// VALIDACIONES
// ============================================================================

/**
 * Valida formato basico de codigo de barras (solo digitos/alfanumerico, longitud)
 */
function validarFormato(codigo) {
    if (!codigo || typeof codigo !== 'string') return { valido: false, error: 'Codigo vacio' };
    const limpio = codigo.trim();
    if (limpio.length < 4) return { valido: false, error: 'Minimo 4 caracteres' };
    if (limpio.length > 100) return { valido: false, error: 'Maximo 100 caracteres' };
    if (!/^[A-Za-z0-9\-_.]+$/.test(limpio)) return { valido: false, error: 'Solo letras, numeros, guion, punto' };
    return { valido: true, codigo: limpio };
}

/**
 * Valida checksum EAN-13 (opcional, segun config)
 */
function validarEAN13(codigo) {
    if (!/^\d{13}$/.test(codigo)) return false;
    const digits = codigo.split('').map(Number);
    const check = digits.pop();
    const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
    const calc = (10 - (sum % 10)) % 10;
    return calc === check;
}

// ============================================================================
// LECTURA
// ============================================================================

/**
 * Lista codigos de barra de un producto
 */
async function listarPorProducto(client, { id_producto }) {
    const { rows } = await client.query(
        'SELECT codigo_barras FROM productocodigosbarras WHERE id_producto = $1 ORDER BY codigo_barras',
        [id_producto]
    );
    return rows.map(r => r.codigo_barras);
}

/**
 * Busca a que producto pertenece un codigo
 * Retorna { id_producto, sku, nombre } o null
 */
async function buscarProductoPorCodigo(client, { codigo_barras }) {
    const { rows } = await client.query(`
        SELECT p.id_producto, p.sku, p.nombre, p.activo
        FROM productocodigosbarras pcb
        JOIN productos p ON p.id_producto = pcb.id_producto
        WHERE pcb.codigo_barras = $1
        LIMIT 1
    `, [codigo_barras.trim()]);
    return rows[0] || null;
}

// ============================================================================
// ESCRITURA
// ============================================================================

/**
 * Agregar un codigo a un producto
 * Retorna { agregado: bool, motivo: string, conflicto: {...} | null }
 */
async function agregar(client, { id_producto, codigo_barras, validar_ean13 = false }) {
    const v = validarFormato(codigo_barras);
    if (!v.valido) return { agregado: false, motivo: v.error, conflicto: null };

    const codigo = v.codigo;

    if (validar_ean13 && /^\d{13}$/.test(codigo) && !validarEAN13(codigo)) {
        return { agregado: false, motivo: 'Checksum EAN-13 invalido', conflicto: null };
    }

    // Verificar si ya existe
    const existente = await buscarProductoPorCodigo(client, { codigo_barras: codigo });
    if (existente) {
        if (existente.id_producto === id_producto) {
            return { agregado: false, motivo: 'El codigo ya esta asignado a este producto', conflicto: null };
        }
        return { 
            agregado: false, 
            motivo: `Codigo ya pertenece a producto SKU=${existente.sku}`, 
            conflicto: existente 
        };
    }

    await client.query(
        'INSERT INTO productocodigosbarras (id_producto, codigo_barras) VALUES ($1, $2)',
        [id_producto, codigo]
    );

    logger.info(`[codigos-barra] Agregado: ${codigo} -> id_producto=${id_producto}`);
    return { agregado: true, motivo: 'OK', conflicto: null };
}

/**
 * Eliminar un codigo especifico de un producto
 * Retorna { eliminado: bool }
 */
async function eliminar(client, { id_producto, codigo_barras }) {
    const result = await client.query(
        'DELETE FROM productocodigosbarras WHERE id_producto = $1 AND codigo_barras = $2',
        [id_producto, codigo_barras.trim()]
    );
    return { eliminado: result.rowCount > 0 };
}

/**
 * Reemplazar todos los codigos de un producto por una nueva lista
 * (usado en modo 'reemplazar' del import)
 */
async function reemplazarLista(client, { id_producto, codigos }) {
    await client.query('DELETE FROM productocodigosbarras WHERE id_producto = $1', [id_producto]);
    const resultados = [];
    for (const cb of codigos) {
        const r = await agregar(client, { id_producto, codigo_barras: cb });
        resultados.push({ codigo: cb, ...r });
    }
    return resultados;
}

/**
 * Agregar lista de codigos sin borrar los existentes (modo 'acumular')
 */
async function acumularLista(client, { id_producto, codigos, validar_ean13 = false }) {
    const resultados = [];
    for (const cb of codigos) {
        const r = await agregar(client, { id_producto, codigo_barras: cb, validar_ean13 });
        resultados.push({ codigo: cb, ...r });
    }
    return resultados;
}

/**
 * Modo 'solo_si_vacio': solo agrega si el producto no tiene ningun codigo aun
 */
async function soloSiVacio(client, { id_producto, codigos, validar_ean13 = false }) {
    const { rows: [{ count }] } = await client.query(
        'SELECT COUNT(*)::int as count FROM productocodigosbarras WHERE id_producto = $1',
        [id_producto]
    );
    if (count > 0) return [{ motivo: 'Producto ya tiene codigos, se omite', agregado: false }];
    return await acumularLista(client, { id_producto, codigos, validar_ean13 });
}

// ============================================================================
// ORQUESTADOR PARA IMPORT
// ============================================================================

/**
 * Procesa codigos segun el modo configurado en configuraciones_empresa
 * @param {string} modo - 'acumular' | 'reemplazar' | 'solo_si_vacio'
 */
async function procesarSegunModo(client, { id_producto, codigos, modo = 'acumular', validar_ean13 = false }) {
    const lista = Array.isArray(codigos) ? codigos : [codigos].filter(Boolean);
    if (lista.length === 0) return [];

    switch (modo) {
        case 'reemplazar': return await reemplazarLista(client, { id_producto, codigos: lista });
        case 'solo_si_vacio': return await soloSiVacio(client, { id_producto, codigos: lista, validar_ean13 });
        case 'acumular':
        default: return await acumularLista(client, { id_producto, codigos: lista, validar_ean13 });
    }
}

module.exports = {
    validarFormato,
    validarEAN13,
    listarPorProducto,
    buscarProductoPorCodigo,
    agregar,
    eliminar,
    reemplazarLista,
    acumularLista,
    soloSiVacio,
    procesarSegunModo
};
