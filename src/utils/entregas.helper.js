'use strict';

/**
 * entregas.helper.js — Listado de productos entregados (SOLO LECTURA)
 * ─────────────────────────────────────────────────────────────────────────
 * Proyecta remito_items ⋈ remitos a dos vistas: detalle | agregado.
 * No escribe. No abre transacción. No conoce HTTP.
 *
 * REGLA DE NEGOCIO CRÍTICA (anti-error):
 *   Cantidad neta entregada =
 *     COALESCE(cantidad_entregada, cantidad) - COALESCE(cantidad_devuelta, 0)
 *   Importes desde subtotal/total persistidos (BD manda, no se recalcula).
 *
 * BÚSQUEDA MULTI-CAMPO (a pedido):
 *   - cliente:  c.busqueda_texto  (columna generada: razón social, fantasía,
 *               CUIT, domicilio, localidad, provincia, email, teléfono).
 *               Permite encontrar por dirección ("1622" → cliente en Argentina 1622).
 *   - producto: p.busqueda_vector (columna generada del catálogo: sku, nombre,
 *               descripción, marca, categoría, cod_proveedor) OR ri.descripcion
 *               (texto congelado en el remito). Cubre catálogo actual + histórico.
 *
 * Multi-empresa: id_empresa obligatorio (throw). Filtra SIEMPRE r.id_empresa
 * y excluye anulados (ítem y remito).
 */

const pool = require('../config/database');

function MODOS() {
  return { DETALLE: 'detalle', AGREGADO: 'agregado' };
}

function ESTADOS_ENTREGABLES() {
  return ['entregado', 'parcial', 'no_entregado', 'despachado'];
}

const SQL_CANT_NETA =
  'GREATEST(COALESCE(ri.cantidad_entregada, ri.cantidad) - COALESCE(ri.cantidad_devuelta, 0), 0)';

// JOIN común a las 3 queries. productos se suma para habilitar búsqueda por
// catálogo (sku/marca/rubro vía busqueda_vector). LEFT para no perder ítems
// cuyo producto fue borrado del catálogo.
const SQL_FROM_JOINS = `
      FROM remito_items ri
      JOIN remitos r        ON r.id_remito = ri.id_remito AND r.id_empresa = ri.id_empresa
      LEFT JOIN clientes c  ON c.id_cliente = r.id_cliente AND c.id_empresa = r.id_empresa
      LEFT JOIN productos p ON p.id_producto = ri.id_producto`;

/**
 * Arma el WHERE parametrizado común a las 3 queries.
 * Devuelve { where, params, idx }.
 */
function _construirWhere(id_empresa, filtros = {}) {
  if (!id_empresa) throw new Error('entregas.helper: id_empresa obligatorio');

  const where = ['r.id_empresa = $1', 'ri.anulado = false', "r.estado <> 'anulado'"];
  const params = [id_empresa];
  let idx = 2;

  const f = filtros || {};

  if (f.desde) { where.push(`COALESCE(r.fecha_entrega, r.fecha_emision) >= $${idx++}`); params.push(f.desde); }
  if (f.hasta) { where.push(`COALESCE(r.fecha_entrega, r.fecha_emision) < ($${idx++}::date + INTERVAL '1 day')`); params.push(f.hasta); }

  if (f.estado) { where.push(`r.estado = $${idx++}`); params.push(f.estado); }
  if (f.id_cliente) { where.push(`r.id_cliente = $${idx++}`); params.push(parseInt(f.id_cliente, 10)); }
  if (f.id_deposito) { where.push(`r.id_deposito = $${idx++}`); params.push(parseInt(f.id_deposito, 10)); }
  if (f.id_viaje) { where.push(`r.id_viaje = $${idx++}`); params.push(parseInt(f.id_viaje, 10)); }
  if (f.id_producto) { where.push(`ri.id_producto = $${idx++}`); params.push(parseInt(f.id_producto, 10)); }
  if (f.chofer) { where.push(`r.chofer ILIKE $${idx++}`); params.push(`%${f.chofer}%`); }

  // ── Búsqueda multi-campo de CLIENTE (columna concatenada con GIN trgm) ──
  if (f.q_cliente) {
    where.push(`c.busqueda_texto ILIKE $${idx++}`);
    params.push(`%${f.q_cliente.toLowerCase()}%`);
  }

  // ── Búsqueda multi-campo de PRODUCTO: catálogo actual OR texto del remito ──
  if (f.q_producto) {
    where.push(`(p.busqueda_vector ILIKE $${idx} OR ri.descripcion ILIKE $${idx})`);
    params.push(`%${f.q_producto}%`);
    idx++;
  }

  return { where: where.join(' AND '), params, idx };
}

async function listarEntregas({ id_empresa, modo = 'detalle', filtros = {} } = {}) {
  if (!id_empresa) throw new Error('entregas.helper: id_empresa obligatorio');
  const M = MODOS();
  const modoNorm = (modo === M.AGREGADO) ? M.AGREGADO : M.DETALLE;

  const { where, params } = _construirWhere(id_empresa, filtros);

  let sql;
  if (modoNorm === M.AGREGADO) {
    sql = `
      SELECT
        ri.id_producto,
        MAX(ri.descripcion)                          AS descripcion,
        SUM(${SQL_CANT_NETA})                        AS cantidad_total,
        SUM(ri.subtotal)                             AS subtotal_total,
        SUM(ri.total)                                AS total_total,
        COUNT(DISTINCT ri.id_remito)                 AS remitos_distintos,
        MIN(COALESCE(r.fecha_entrega, r.fecha_emision)) AS primera_entrega,
        MAX(COALESCE(r.fecha_entrega, r.fecha_emision)) AS ultima_entrega
      ${SQL_FROM_JOINS}
      WHERE ${where}
      GROUP BY ri.id_producto
      HAVING SUM(${SQL_CANT_NETA}) > 0
      ORDER BY cantidad_total DESC, descripcion ASC`;
  } else {
    sql = `
      SELECT
        ri.id_item,
        ri.id_remito,
        r.numero_completo                            AS remito_numero,
        COALESCE(r.fecha_entrega, r.fecha_emision)   AS fecha,
        r.estado                                     AS estado_remito,
        r.id_cliente,
        c.razon_social                               AS cliente,
        ri.id_producto,
        ri.descripcion,
        ${SQL_CANT_NETA}                             AS cantidad_neta,
        ri.cantidad                                  AS cantidad_nominal,
        ri.cantidad_entregada,
        ri.cantidad_devuelta,
        ri.precio_unitario,
        ri.subtotal,
        ri.total,
        r.id_viaje,
        r.chofer,
        r.id_deposito
      ${SQL_FROM_JOINS}
      WHERE ${where} AND ${SQL_CANT_NETA} > 0
      ORDER BY fecha DESC, r.numero_completo DESC, ri.id_item ASC`;
  }

  const { rows } = await pool.query(sql, params);

  const totSql = `
    SELECT
      COALESCE(SUM(${SQL_CANT_NETA}), 0)        AS cantidad_total,
      COALESCE(SUM(ri.subtotal), 0)             AS subtotal_total,
      COALESCE(SUM(ri.total), 0)                AS total_total,
      COUNT(DISTINCT ri.id_remito)              AS remitos_distintos,
      COUNT(DISTINCT ri.id_producto)            AS productos_distintos
    ${SQL_FROM_JOINS}
    WHERE ${where} AND ${SQL_CANT_NETA} > 0`;
  const totRes = await pool.query(totSql, params);

  return {
    modo: modoNorm,
    filas: rows,
    totales: totRes.rows[0],
    meta: { count: rows.length },
  };
}

async function obtenerOpcionesFiltro({ id_empresa } = {}) {
  if (!id_empresa) throw new Error('entregas.helper: id_empresa obligatorio');

  const [depo, chof] = await Promise.all([
    pool.query(
      `SELECT id_deposito, nombre
         FROM depositos
        WHERE id_empresa = $1 AND activo = true
        ORDER BY nombre`,
      [id_empresa]
    ),
    pool.query(
      `SELECT DISTINCT chofer
         FROM remitos
        WHERE id_empresa = $1 AND chofer IS NOT NULL AND chofer <> ''
        ORDER BY chofer`,
      [id_empresa]
    ),
  ]);

  return {
    estados: ESTADOS_ENTREGABLES(),
    depositos: depo.rows,
    choferes: chof.rows.map(r => r.chofer),
  };
}

module.exports = {
  MODOS,
  ESTADOS_ENTREGABLES,
  listarEntregas,
  obtenerOpcionesFiltro,
};
