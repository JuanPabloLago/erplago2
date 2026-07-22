const preciosHelper = require('./precios.helper');
'use strict';

const pool = require('../config/db');

// =====================================================
// REDONDEO ARGENTINO
// =====================================================

/**
 * Redondea un precio en ARS según escala de inflación argentina.
 * NO aplica a USD ni otras monedas.
 * @param {number} monto - Precio a redondear
 * @returns {number} Precio redondeado
 */
function redondearPrecioAR(monto) {
    if (!monto || monto <= 0) return 0;
    const m = Math.round(monto);
    if (m < 100)   return Math.round(m / 5) * 5;
    if (m < 500)   return Math.round(m / 10) * 10;
    if (m < 1000)  return Math.round(m / 50) * 50;
    if (m < 5000)  return Math.round(m / 100) * 100;
    return Math.round(m / 500) * 500;
}

// =====================================================
// CRUD LISTAS
// =====================================================

async function crearLista(client, { id_empresa, nombre, descripcion, porcentaje_sobre_base, id_lista_base, redondeo_activo, orden, tipo_calculo, margen_sobre_costo }) {
    const { rows } = await client.query(`
        INSERT INTO listasdeprecios (id_empresa, nombre, descripcion, porcentaje_sobre_base, id_lista_base, redondeo_activo, activa, orden, tipo_calculo, margen_sobre_costo)
        VALUES ($1, $2, $3, $4, $5, $6, true, COALESCE($7, (SELECT COALESCE(MAX(orden),0)+1 FROM listasdeprecios WHERE id_empresa = $1)), COALESCE($8, 'MANUAL'), $9)
        RETURNING *
    `, [id_empresa, nombre.trim(), descripcion || null, porcentaje_sobre_base || null, id_lista_base || null, redondeo_activo !== false, orden || null, tipo_calculo || 'MANUAL', margen_sobre_costo || null]);
    return rows[0];
}

async function actualizarLista(client, { id_lista_precio, id_empresa, nombre, descripcion, porcentaje_sobre_base, id_lista_base, redondeo_activo, orden, tipo_calculo, margen_sobre_costo }) {
    // No permitir que una lista sea base de sí misma
    if (id_lista_base && id_lista_base === id_lista_precio) {
        throw new Error('Una lista no puede ser base de sí misma');
    }
    const { rows } = await client.query(`
        UPDATE listasdeprecios
        SET nombre = $3, descripcion = $4, porcentaje_sobre_base = $5,
            id_lista_base = $6, redondeo_activo = $7, orden = COALESCE($8, orden),
            tipo_calculo = COALESCE($9, tipo_calculo), margen_sobre_costo = $10,
            fecha_modificacion = now()
        WHERE id_lista_precio = $1 AND id_empresa = $2
        RETURNING *
    `, [id_lista_precio, id_empresa, nombre.trim(), descripcion || null, porcentaje_sobre_base || null, id_lista_base || null, redondeo_activo !== false, orden || null, tipo_calculo || 'MANUAL', margen_sobre_costo || null]);
    if (!rows.length) throw new Error('Lista no encontrada');
    return rows[0];
}

async function desactivarLista(client, { id_lista_precio, id_empresa }) {
    // Verificar que no haya clientes asignados
    const { rows: clientes } = await client.query(
        'SELECT COUNT(*) as cant FROM clientes WHERE id_lista_precio = $1 AND id_empresa = $2 AND activo = true',
        [id_lista_precio, id_empresa]
    );
    if (parseInt(clientes[0].cant) > 0) {
        throw new Error(`No se puede desactivar: ${clientes[0].cant} clientes tienen esta lista asignada`);
    }
    // Verificar que no sea lista base de otras activas
    const { rows: derivadas } = await client.query(
        'SELECT COUNT(*) as cant FROM listasdeprecios WHERE id_lista_base = $1 AND id_empresa = $2 AND activa = true',
        [id_lista_precio, id_empresa]
    );
    if (parseInt(derivadas[0].cant) > 0) {
        throw new Error(`No se puede desactivar: ${derivadas[0].cant} listas derivan de esta`);
    }
    const { rows } = await client.query(
        'UPDATE listasdeprecios SET activa = false, fecha_modificacion = now() WHERE id_lista_precio = $1 AND id_empresa = $2 RETURNING *',
        [id_lista_precio, id_empresa]
    );
    if (!rows.length) throw new Error('Lista no encontrada');
    return rows[0];
}

async function activarLista(client, { id_lista_precio, id_empresa }) {
    const { rows } = await client.query(
        'UPDATE listasdeprecios SET activa = true, fecha_modificacion = now() WHERE id_lista_precio = $1 AND id_empresa = $2 RETURNING *',
        [id_lista_precio, id_empresa]
    );
    if (!rows.length) throw new Error('Lista no encontrada');
    return rows[0];
}

async function obtenerLista(client, { id_lista_precio, id_empresa }) {
    const { rows } = await client.query(`
        SELECT lp.*,
               lb.nombre as lista_base_nombre,
               (SELECT COUNT(*) FROM precios p WHERE p.id_lista_precio = lp.id_lista_precio AND p.id_empresa = lp.id_empresa) as cant_productos,
               (SELECT COUNT(*) FROM clientes c WHERE c.id_lista_precio = lp.id_lista_precio AND c.id_empresa = lp.id_empresa AND c.activo = true) as cant_clientes
        FROM listasdeprecios lp
        LEFT JOIN listasdeprecios lb ON lb.id_lista_precio = lp.id_lista_base
        WHERE lp.id_lista_precio = $1 AND lp.id_empresa = $2
    `, [id_lista_precio, id_empresa]);
    if (!rows.length) throw new Error('Lista no encontrada');
    return rows[0];
}

// =====================================================
// CONSULTAS (reemplazan SELECTs dispersos)
// =====================================================

/**
 * Lista todas las listas activas de una empresa.
 * REEMPLAZA los 10 SELECTs dispersos en controllers.
 */
async function listarActivas(client, { id_empresa }) {
    const { rows } = await client.query(
        'SELECT id_lista_precio, nombre FROM listasdeprecios WHERE id_empresa = $1 AND activa = true ORDER BY orden, id_lista_precio',
        [id_empresa]
    );
    return rows;
}

/**
 * Lista completa con estadísticas (para el admin).
 */
async function listarCompleta(client, { id_empresa, incluir_inactivas }) {
    const filtro = incluir_inactivas ? '' : 'AND lp.activa = true';
    const { rows } = await client.query(`
        SELECT lp.*,
               lb.nombre as lista_base_nombre,
               COALESCE(cp.cant_productos, 0) as cant_productos,
               COALESCE(cc.cant_clientes, 0) as cant_clientes
        FROM listasdeprecios lp
        LEFT JOIN listasdeprecios lb ON lb.id_lista_precio = lp.id_lista_base
        LEFT JOIN (
            SELECT id_lista_precio, id_empresa, COUNT(*) as cant_productos
            FROM precios GROUP BY id_lista_precio, id_empresa
        ) cp ON cp.id_lista_precio = lp.id_lista_precio AND cp.id_empresa = lp.id_empresa
        LEFT JOIN (
            SELECT id_lista_precio, id_empresa, COUNT(*) as cant_clientes
            FROM clientes WHERE activo = true GROUP BY id_lista_precio, id_empresa
        ) cc ON cc.id_lista_precio = lp.id_lista_precio AND cc.id_empresa = lp.id_empresa
        WHERE lp.id_empresa = $1 ${filtro}
        ORDER BY lp.orden, lp.id_lista_precio
    `, [id_empresa]);
    return rows;
}

// =====================================================
// GESTIÓN DE PRECIOS
// =====================================================

/**
 * Obtiene precios de una lista con búsqueda y paginación.
 */
async function obtenerPreciosLista(client, { id_lista_precio, id_empresa, busqueda, limit, offset }) {
    const params = [id_lista_precio, id_empresa];
    let where = '';
    if (busqueda && busqueda.trim()) {
        const palabras = busqueda.trim().toLowerCase().split(/\s+/);
        const condiciones = palabras.map((_, i) => {
            params.push(`%${palabras[i]}%`);
            return `(LOWER(p.nombre) LIKE $${params.length} OR LOWER(p.sku) LIKE $${params.length} OR EXISTS(SELECT 1 FROM productocodigosbarras cb WHERE cb.id_producto = p.id_producto AND cb.codigo_barras ILIKE $${params.length}))`;
        });
        where = 'AND ' + condiciones.join(' AND ');
    }

    const lim = Math.min(parseInt(limit) || 50, 200);
    const off = parseInt(offset) || 0;

    const { rows } = await client.query(`
        SELECT p.id_producto, p.sku, p.nombre, p.activo,
               COALESCE(pr.precio, 0) as precio,
               COALESCE(pr_base.precio, 0) as precio_base,
               c.nombre as categoria
        FROM productos p
        LEFT JOIN precios pr ON pr.id_producto = p.id_producto AND pr.id_lista_precio = $1 AND pr.id_empresa = $2
        LEFT JOIN precios pr_base ON pr_base.id_producto = p.id_producto
            AND pr_base.id_lista_precio = (SELECT COALESCE(id_lista_base, id_lista_precio) FROM listasdeprecios WHERE id_lista_precio = $1 AND id_empresa = $2)
            AND pr_base.id_empresa = $2
        LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
        WHERE p.activo = true ${where}
        ORDER BY p.nombre
        LIMIT ${lim} OFFSET ${off}
    `, params);

    // Count total (respeta filtro de búsqueda)
    const countParams = [id_lista_precio, id_empresa];
    let countWhere = '';
    if (busqueda && busqueda.trim()) {
        const palabrasCount = busqueda.trim().toLowerCase().split(/\s+/);
        const condicionesCount = palabrasCount.map((_, i) => {
            countParams.push(`%${palabrasCount[i]}%`);
            return `(LOWER(p.nombre) LIKE $${countParams.length} OR LOWER(p.sku) LIKE $${countParams.length})`;
        });
        countWhere = 'AND ' + condicionesCount.join(' AND ');
    }
    const { rows: countRows } = await client.query(
        `SELECT COUNT(*) as total FROM productos p WHERE p.activo = true ${countWhere}`,
        countParams
    );

    return { precios: rows, total: parseInt(countRows[0]?.total || 0) };
}

/**
 * Actualiza o inserta un precio individual.
 */
async function actualizarPrecio(client, { id_producto, id_lista_precio, id_empresa, precio }) {
    const precioFinal = parseFloat(precio);
    if (isNaN(precioFinal) || precioFinal < 0) throw new Error('Precio inválido');

    const { rows } = await client.query(`
        INSERT INTO precios (id_producto, id_lista_precio, id_empresa, precio)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_empresa, id_producto, id_lista_precio)
        DO UPDATE SET precio = EXCLUDED.precio
        RETURNING *
    `, [id_producto, id_lista_precio, id_empresa, precioFinal]);
    return rows[0];
}

/**
 * Actualiza precios masivamente (array de {id_producto, precio}).
 */
async function actualizarPreciosMasivo(client, { id_lista_precio, id_empresa, precios }) {
    if (!precios || !precios.length) throw new Error('No hay precios para actualizar');
    let actualizados = 0;
    for (const { id_producto, precio } of precios) {
        await actualizarPrecio(client, { id_producto, id_lista_precio, id_empresa, precio });
        actualizados++;
    }
    return { actualizados };
}

// =====================================================
// RECÁLCULO Y REDONDEO MASIVO
// =====================================================

/**
 * Recalcula una lista derivada desde su lista base + porcentaje.
 * Aplica redondeo si la lista lo tiene activo.
 * @returns {{ actualizados, insertados }} 
 */
async function recalcularDesdeLista(client, { id_lista_precio, id_empresa }) {
    // Obtener config de la lista
    const { rows: [lista] } = await client.query(
        'SELECT * FROM listasdeprecios WHERE id_lista_precio = $1 AND id_empresa = $2',
        [id_lista_precio, id_empresa]
    );
    if (!lista) throw new Error('Lista no encontrada');
    if (!lista.id_lista_base) throw new Error('Esta lista no tiene lista base configurada');
    if (lista.porcentaje_sobre_base === null) throw new Error('Esta lista no tiene porcentaje configurado');

    const factor = 1 + (parseFloat(lista.porcentaje_sobre_base) / 100);
    const redondear = lista.redondeo_activo;

    // Obtener precios de la lista base
    const { rows: preciosBase } = await client.query(
        'SELECT id_producto, precio FROM precios WHERE id_lista_precio = $1 AND id_empresa = $2',
        [lista.id_lista_base, id_empresa]
    );

    let procesados = 0;
    const omitidos = [];
    for (const pb of preciosBase) {
        const netoConPorcentaje = parseFloat(pb.precio) * factor;
        try {
            await preciosHelper.escribirPrecio({
                id_empresa, id_producto: pb.id_producto, id_lista: id_lista_precio,
                precio_input: netoConPorcentaje, modo_input: 'NETO', contexto: 'recalcularDesdeLista', client
            });
            procesados++;
        } catch (e) {
            omitidos.push({ id_producto: pb.id_producto, motivo: e.message });
        }
    }
    return { procesados, omitidos, total: preciosBase.length, porcentaje: lista.porcentaje_sobre_base };
}

/**
 * Aplica redondeo argentino a TODOS los precios de una lista.
 * @returns {{ actualizados }}
 */
async function aplicarRedondeo(client, { id_lista_precio, id_empresa }) {
    // Redondea el PRECIO CON IVA y recalcula el neto
    const { rows: precios } = await client.query(
        `SELECT pr.id_producto, pr.precio, COALESCE(a.porcentaje, 21) as iva_pct
         FROM precios pr
         JOIN productos p ON p.id_producto = pr.id_producto
         LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE pr.id_lista_precio = $1 AND pr.id_empresa = $2`,
        [id_lista_precio, id_empresa]
    );
    let actualizados = 0;
    for (const p of precios) {
        await preciosHelper.escribirPrecio({
            id_empresa, id_producto: p.id_producto, id_lista: id_lista_precio,
            precio_input: parseFloat(p.precio), modo_input: 'NETO', contexto: 'aplicarRedondeo', client
        });
        actualizados++;
    }
    return { actualizados, total: precios.length };
}

/**
 * Ajuste porcentual directo sobre una lista (sin lista base).
 * Ej: +10% a toda la lista General.
 */
async function ajustarPorcentaje(client, { id_lista_precio, id_empresa, porcentaje, aplicar_redondeo }) {
    const factor = 1 + (parseFloat(porcentaje) / 100);
    if (isNaN(factor) || factor <= 0) throw new Error('Porcentaje inválido');

    const { rows: precios } = await client.query(
        'SELECT id_producto, precio FROM precios WHERE id_lista_precio = $1 AND id_empresa = $2',
        [id_lista_precio, id_empresa]
    );

    let actualizados = 0;
    for (const p of precios) {
        const netoAjustado = parseFloat(p.precio) * factor;
        await preciosHelper.escribirPrecio({
            id_empresa, id_producto: p.id_producto, id_lista: id_lista_precio,
            precio_input: netoAjustado, modo_input: 'NETO', contexto: 'ajustarPorcentaje', client
        });
        actualizados++;
    }
    return { actualizados, porcentaje, redondeo: true };
}

// =====================================================
// ASIGNACIÓN A CLIENTES
// =====================================================

/**
 * Asigna una lista de precios a múltiples clientes.
 */
async function asignarAClientes(client, { id_lista_precio, id_empresa, ids_clientes }) {
    if (!ids_clientes || !ids_clientes.length) throw new Error('No se seleccionaron clientes');

    // Verificar que la lista existe y está activa
    const { rows: [lista] } = await client.query(
        'SELECT id_lista_precio, nombre FROM listasdeprecios WHERE id_lista_precio = $1 AND id_empresa = $2 AND activa = true',
        [id_lista_precio, id_empresa]
    );
    if (!lista) throw new Error('Lista no encontrada o inactiva');

    const { rowCount } = await client.query(
        'UPDATE clientes SET id_lista_precio = $1 WHERE id_cliente = ANY($2::int[]) AND id_empresa = $3',
        [id_lista_precio, ids_clientes, id_empresa]
    );
    return { actualizados: rowCount, lista: lista.nombre };
}

/**
 * Quita la lista asignada a clientes (vuelven a null = lista por defecto).
 */
async function desasignarClientes(client, { id_empresa, ids_clientes }) {
    const { rowCount } = await client.query(
        'UPDATE clientes SET id_lista_precio = NULL WHERE id_cliente = ANY($1::int[]) AND id_empresa = $2',
        [ids_clientes, id_empresa]
    );
    return { actualizados: rowCount };
}

/**
 * Obtiene clientes asignados a una lista.
 */
async function obtenerClientesLista(client, { id_lista_precio, id_empresa }) {
    const { rows } = await client.query(`
        SELECT id_cliente, razon_social, nombre_fantasia, cuit_cuil
        FROM clientes
        WHERE id_lista_precio = $1 AND id_empresa = $2 AND activo = true
        ORDER BY razon_social
    `, [id_lista_precio, id_empresa]);
    return rows;
}

// =====================================================
// ESTADÍSTICAS
// =====================================================

async function obtenerEstadisticas(client, { id_empresa }) {
    const { rows } = await client.query(`
        SELECT
            (SELECT COUNT(*) FROM listasdeprecios WHERE id_empresa = $1 AND activa = true) as listas_activas,
            (SELECT COUNT(*) FROM listasdeprecios WHERE id_empresa = $1 AND activa = false) as listas_inactivas,
            (SELECT COUNT(DISTINCT id_producto) FROM precios WHERE id_empresa = $1) as productos_con_precio,
            (SELECT COUNT(*) FROM clientes WHERE id_empresa = $1 AND id_lista_precio IS NOT NULL AND activo = true) as clientes_con_lista
    `, [id_empresa]);
    return rows[0];
}

module.exports = {
    // Utilidad de redondeo (exportada para uso externo)
    redondearPrecioAR,
    // CRUD
    crearLista,
    actualizarLista,
    desactivarLista,
    activarLista,
    obtenerLista,
    // Consultas
    listarActivas,
    listarCompleta,
    // Precios
    obtenerPreciosLista,
    actualizarPrecio,
    actualizarPreciosMasivo,
    // Recálculo
    recalcularDesdeLista,
    aplicarRedondeo,
    ajustarPorcentaje,
    // Clientes
    asignarAClientes,
    desasignarClientes,
    obtenerClientesLista,
    // Stats
    obtenerEstadisticas
};
