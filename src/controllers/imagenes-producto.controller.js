'use strict';
const pool = require('../config/database');
const imgHelper = require('../utils/imagenes-producto.helper');

function _esAdmin(req) {
  const r = req.usuario && req.usuario.rol;
  return r === 'admin' || r === 'administrador';
}

function _denegado(res) {
  return res.status(403).json({ error: 'Permiso denegado: requiere admin' });
}

async function listar(req, res) {
  try {
    const id_producto = parseInt(req.params.id_producto, 10);
    if (!Number.isFinite(id_producto)) {
      return res.status(400).json({ error: 'id_producto invalido' });
    }
    const items = await imgHelper.listar(pool, { id_producto });
    res.json({ items });
  } catch (err) {
    console.error('imagenes-producto.listar:', err);
    res.status(500).json({ error: err.message });
  }
}

async function agregar(req, res) {
  if (!_esAdmin(req)) return _denegado(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id_producto = parseInt(req.params.id_producto, 10);
    const id_empresa = req.usuario.id_empresa;
    const { url, alt_text, marcar_principal } = req.body || {};
    const item = await imgHelper.agregar(client, {
      id_producto, id_empresa, url, alt_text, marcar_principal: !!marcar_principal,
    });
    await client.query('COMMIT');
    res.json({ item });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('imagenes-producto.agregar:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function actualizar(req, res) {
  if (!_esAdmin(req)) return _denegado(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id_imagen = parseInt(req.params.id_imagen, 10);
    const { alt_text } = req.body || {};
    const item = await imgHelper.actualizar(client, { id_imagen, alt_text });
    await client.query('COMMIT');
    res.json({ item });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('imagenes-producto.actualizar:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function eliminar(req, res) {
  if (!_esAdmin(req)) return _denegado(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id_imagen = parseInt(req.params.id_imagen, 10);
    const r = await imgHelper.eliminar(client, { id_imagen });
    await client.query('COMMIT');
    res.json(r);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('imagenes-producto.eliminar:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function reordenar(req, res) {
  if (!_esAdmin(req)) return _denegado(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id_producto = parseInt(req.params.id_producto, 10);
    const { orden_ids } = req.body || {};
    const r = await imgHelper.reordenar(client, { id_producto, orden_ids });
    await client.query('COMMIT');
    res.json(r);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('imagenes-producto.reordenar:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function marcarPrincipal(req, res) {
  if (!_esAdmin(req)) return _denegado(res);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id_producto = parseInt(req.params.id_producto, 10);
    const id_imagen = parseInt(req.params.id_imagen, 10);
    const r = await imgHelper.marcarPrincipal(client, { id_producto, id_imagen });
    await client.query('COMMIT');
    res.json(r);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('imagenes-producto.marcarPrincipal:', err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = { listar, agregar, actualizar, eliminar, reordenar, marcarPrincipal };
