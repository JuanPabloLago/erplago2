'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * IMAGENES-PRODUCTO HELPER — ERP LAGO
 *
 * CRUD + reorder + marcar principal sobre tabla producto_imagenes.
 * productos.url_imagen se sincroniza por trigger trg_sync_producto_url_imagen.
 *
 * CONTRATO: todas las funciones reciben `client` (pool o pool.connect())
 * como primer parametro. La transaccion se maneja afuera cuando es necesaria.
 *
 * REGLAS:
 * - Una sola imagen es_principal por producto (garantizado por unique index parcial).
 * - galeria_max (config web.imagen.galeria_max) es tope duro al agregar.
 * - URL validada por validador-imagen-url.helper antes de insertar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const validadorUrl = require('./validador-imagen-url.helper');

const GALERIA_MAX_DEFAULT = 8;

async function _obtenerGaleriaMax(client, id_empresa) {
  const { rows } = await client.query(
    `SELECT valor FROM configuraciones_empresa
     WHERE id_empresa = $1 AND clave = 'web.imagen.galeria_max'`,
    [id_empresa]
  );
  if (rows.length === 0) return GALERIA_MAX_DEFAULT;
  const v = parseInt(rows[0].valor, 10);
  return Number.isFinite(v) && v > 0 ? v : GALERIA_MAX_DEFAULT;
}

async function listar(client, { id_producto }) {
  if (!id_producto) throw new Error('imagenes-producto.listar: id_producto obligatorio');
  const { rows } = await client.query(
    `SELECT id_imagen, id_producto, url, orden, es_principal, alt_text, fecha_alta
       FROM producto_imagenes
      WHERE id_producto = $1
      ORDER BY orden, id_imagen`,
    [id_producto]
  );
  return rows;
}

async function agregar(client, { id_producto, id_empresa, url, alt_text = null, marcar_principal = false }) {
  if (!id_producto) throw new Error('imagenes-producto.agregar: id_producto obligatorio');
  if (!id_empresa) throw new Error('imagenes-producto.agregar: id_empresa obligatorio');
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error('imagenes-producto.agregar: url obligatoria');
  }

  // Validar URL via helper centralizado
  const validacion = await validadorUrl.validar(client, { id_empresa, url: url.trim() });
  if (!validacion || validacion.valida === false) {
    throw new Error('URL invalida: ' + (validacion?.error || validacion?.motivo || 'no aceptada'));
  }

  // Tope galeria_max
  const max = await _obtenerGaleriaMax(client, id_empresa);
  const cnt = await client.query(
    'SELECT COUNT(*)::int AS cant FROM producto_imagenes WHERE id_producto = $1',
    [id_producto]
  );
  const cant_actual = cnt.rows[0].cant;
  if (cant_actual >= max) {
    throw new Error(`Tope alcanzado: maximo ${max} imagenes por producto (config web.imagen.galeria_max)`);
  }

  // Orden al final
  const ord = await client.query(
    'SELECT COALESCE(MAX(orden), -1) + 1 AS nuevo_orden FROM producto_imagenes WHERE id_producto = $1',
    [id_producto]
  );
  const nuevo_orden = ord.rows[0].nuevo_orden;

  // Si es la primera, forzar principal. Si no, respetar parametro.
  const sera_principal = marcar_principal || cant_actual === 0;

  if (sera_principal) {
    await client.query(
      'UPDATE producto_imagenes SET es_principal = false WHERE id_producto = $1 AND es_principal = true',
      [id_producto]
    );
  }

  const { rows } = await client.query(
    `INSERT INTO producto_imagenes (id_producto, url, orden, es_principal, alt_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id_imagen, id_producto, url, orden, es_principal, alt_text, fecha_alta`,
    [id_producto, url.trim(), nuevo_orden, sera_principal, alt_text]
  );
  return rows[0];
}

async function actualizar(client, { id_imagen, alt_text }) {
  if (!id_imagen) throw new Error('imagenes-producto.actualizar: id_imagen obligatorio');
  if (alt_text === undefined) {
    throw new Error('imagenes-producto.actualizar: nada para actualizar');
  }
  const { rows } = await client.query(
    'UPDATE producto_imagenes SET alt_text = $1 WHERE id_imagen = $2 RETURNING *',
    [alt_text, id_imagen]
  );
  if (rows.length === 0) throw new Error('imagen no encontrada');
  return rows[0];
}

async function eliminar(client, { id_imagen }) {
  if (!id_imagen) throw new Error('imagenes-producto.eliminar: id_imagen obligatorio');
  const sel = await client.query(
    'SELECT id_producto, es_principal FROM producto_imagenes WHERE id_imagen = $1',
    [id_imagen]
  );
  if (sel.rows.length === 0) throw new Error('imagen no encontrada');
  const { id_producto, es_principal } = sel.rows[0];

  await client.query('DELETE FROM producto_imagenes WHERE id_imagen = $1', [id_imagen]);

  // Si era principal, promover la primera por orden
  if (es_principal) {
    await client.query(
      `UPDATE producto_imagenes SET es_principal = true
        WHERE id_imagen = (
          SELECT id_imagen FROM producto_imagenes
           WHERE id_producto = $1
           ORDER BY orden, id_imagen
           LIMIT 1
        )`,
      [id_producto]
    );
  }
  return { id_imagen, eliminada: true };
}

async function reordenar(client, { id_producto, orden_ids }) {
  if (!id_producto) throw new Error('imagenes-producto.reordenar: id_producto obligatorio');
  if (!Array.isArray(orden_ids) || orden_ids.length === 0) {
    throw new Error('imagenes-producto.reordenar: orden_ids debe ser array no vacio');
  }
  const { rows } = await client.query(
    'SELECT id_imagen FROM producto_imagenes WHERE id_producto = $1',
    [id_producto]
  );
  const idsValidos = new Set(rows.map(r => r.id_imagen));
  for (const id of orden_ids) {
    if (!idsValidos.has(id)) {
      throw new Error(`id_imagen ${id} no pertenece al producto ${id_producto}`);
    }
  }
  if (orden_ids.length !== idsValidos.size) {
    throw new Error('orden_ids debe incluir TODAS las imagenes del producto');
  }
  for (let i = 0; i < orden_ids.length; i++) {
    await client.query(
      'UPDATE producto_imagenes SET orden = $1 WHERE id_imagen = $2',
      [i, orden_ids[i]]
    );
  }
  return { reordenadas: orden_ids.length };
}

async function marcarPrincipal(client, { id_producto, id_imagen }) {
  if (!id_producto || !id_imagen) {
    throw new Error('imagenes-producto.marcarPrincipal: id_producto e id_imagen obligatorios');
  }
  const sel = await client.query(
    'SELECT 1 FROM producto_imagenes WHERE id_imagen = $1 AND id_producto = $2',
    [id_imagen, id_producto]
  );
  if (sel.rows.length === 0) throw new Error('imagen no pertenece al producto');

  await client.query(
    'UPDATE producto_imagenes SET es_principal = false WHERE id_producto = $1 AND es_principal = true',
    [id_producto]
  );
  await client.query(
    'UPDATE producto_imagenes SET es_principal = true WHERE id_imagen = $1',
    [id_imagen]
  );
  return { id_imagen, es_principal: true };
}

module.exports = {
  listar,
  agregar,
  actualizar,
  eliminar,
  reordenar,
  marcarPrincipal,
};
