'use strict';

/**
 * entregas.controller.js — Productos entregados (SOLO LECTURA)
 * Orquesta entregas.helper (proyección) + filtros.helper (memoria de filtro).
 * No escribe lógica de negocio ni SQL: delega todo a los helpers.
 */

const entregasHelper = require('../utils/entregas.helper');
const filtrosHelper = require('../utils/filtros.helper');

let logger;
try { logger = require('../utils/logger'); } catch (_) { logger = console; }

// Extrae el objeto de filtros desde req.query de forma explícita (ISP: solo lo necesario).
function _filtrosDesdeQuery(q = {}) {
  return {
    desde: q.desde || null,
    hasta: q.hasta || null,
    estado: q.estado || null,
    id_cliente: q.id_cliente || null,
    id_deposito: q.id_deposito || null,
    id_viaje: q.id_viaje || null,
    id_producto: q.id_producto || null,
    chofer: q.chofer || null,
    q_cliente: q.q_cliente || null,
    q_producto: q.q_producto || null,
  };
}

// GET /api/entregas  → listado (modo + filtros)
async function listar(req, res) {
  try {
    const { id_empresa } = req.usuario;
    const modo = req.query.modo || entregasHelper.MODOS().DETALLE;
    const filtros = _filtrosDesdeQuery(req.query);

    const data = await entregasHelper.listarEntregas({ id_empresa, modo, filtros });
    res.json(data);
  } catch (err) {
    logger.error?.('[entregas.listar]', err);
    res.status(500).json({ error: err.message || 'Error al listar entregas' });
  }
}

// GET /api/entregas/opciones  → selects (estados, depositos, choferes)
async function opciones(req, res) {
  try {
    const { id_empresa } = req.usuario;
    const data = await entregasHelper.obtenerOpcionesFiltro({ id_empresa });
    res.json(data);
  } catch (err) {
    logger.error?.('[entregas.opciones]', err);
    res.status(500).json({ error: err.message || 'Error al obtener opciones' });
  }
}

// GET /api/entregas/filtro-ultimo  → recupera el último filtro del usuario
async function obtenerFiltroUltimo(req, res) {
  try {
    const { id_empresa, id_usuario } = req.usuario;
    const cfg = await filtrosHelper.obtenerUltimo({
      id_empresa,
      id_usuario,
      tipo_filtro: filtrosHelper.TIPOS_FILTRO().ENTREGAS_ULTIMO,
    });
    res.json({ filtro: cfg });
  } catch (err) {
    logger.error?.('[entregas.obtenerFiltroUltimo]', err);
    res.status(500).json({ error: err.message || 'Error al obtener filtro' });
  }
}

// PUT /api/entregas/filtro-ultimo  → guarda el último filtro del usuario
async function guardarFiltroUltimo(req, res) {
  try {
    const { id_empresa, id_usuario } = req.usuario;
    await filtrosHelper.guardarUltimo({
      id_empresa,
      id_usuario,
      tipo_filtro: filtrosHelper.TIPOS_FILTRO().ENTREGAS_ULTIMO,
      configuracion: req.body || {},
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error?.('[entregas.guardarFiltroUltimo]', err);
    res.status(500).json({ error: err.message || 'Error al guardar filtro' });
  }
}

// GET /api/entregas/export  → CSV (separador ';', locale AR), mismos filtros
async function exportar(req, res) {
  try {
    const { id_empresa } = req.usuario;
    const modo = req.query.modo || entregasHelper.MODOS().DETALLE;
    const filtros = _filtrosDesdeQuery(req.query);

    const { filas } = await entregasHelper.listarEntregas({ id_empresa, modo, filtros });

    const SEP = ';';
    const fmtNum = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v);
      return (s.includes(SEP) || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    let cabecera, lineas;
    if (modo === entregasHelper.MODOS().AGREGADO) {
      cabecera = ['Producto', 'Cantidad entregada', 'Subtotal', 'Total', 'Remitos', 'Primera entrega', 'Ultima entrega'];
      lineas = filas.map(r => [
        esc(r.descripcion),
        fmtNum(r.cantidad_total),
        fmtNum(r.subtotal_total),
        fmtNum(r.total_total),
        r.remitos_distintos,
        r.primera_entrega ? new Date(r.primera_entrega).toLocaleDateString('es-AR') : '',
        r.ultima_entrega ? new Date(r.ultima_entrega).toLocaleDateString('es-AR') : '',
      ].join(SEP));
    } else {
      cabecera = ['Fecha', 'Remito', 'Cliente', 'Producto', 'Cantidad', 'Precio unit.', 'Subtotal', 'Estado', 'Chofer'];
      lineas = filas.map(r => [
        r.fecha ? new Date(r.fecha).toLocaleDateString('es-AR') : '',
        esc(r.remito_numero),
        esc(r.cliente),
        esc(r.descripcion),
        fmtNum(r.cantidad_neta),
        fmtNum(r.precio_unitario),
        fmtNum(r.subtotal),
        esc(r.estado_remito),
        esc(r.chofer),
      ].join(SEP));
    }

    const csv = '\uFEFF' + [cabecera.join(SEP), ...lineas].join('\r\n');
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="entregas_${modo}_${fecha}.csv"`);
    res.send(csv);
  } catch (err) {
    logger.error?.('[entregas.exportar]', err);
    res.status(500).json({ error: err.message || 'Error al exportar' });
  }
}

module.exports = {
  listar,
  opciones,
  obtenerFiltroUltimo,
  guardarFiltroUltimo,
  exportar,
};
