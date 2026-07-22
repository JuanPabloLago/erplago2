'use strict';

/**
 * filtros.helper.js — Memoria de filtros por usuario (GENÉRICO, reusable)
 * ─────────────────────────────────────────────────────────────────────────
 * Persiste y recupera el "último filtro" que un usuario aplicó en un módulo,
 * para que al volver a la pantalla la encuentre como la dejó.
 *
 * Convención (definida acá, vale para todo el ERP):
 *   - Tabla:        filtros_guardados
 *   - tipo_filtro:  namespace del módulo, p.ej. 'entregas:ultimo'
 *   - nombre:       '__ultimo__'  (filtro de sistema; lo distingue de los
 *                   filtros que el usuario guarda a mano con nombre propio)
 *   - configuracion: JSON string con el estado de los controles
 *   - Clave lógica única: (id_empresa, id_usuario, tipo_filtro, nombre)
 *
 * SOLID: única responsabilidad (persistir/recuperar último filtro). No conoce
 * la forma del filtro de ningún módulo concreto: guarda y devuelve un objeto.
 * Multi-empresa: id_empresa obligatorio (throw en boundary).
 */

const pool = require('../config/database');

// ── Namespaces conocidos (extensible). Evita strings sueltos en controllers ──
function TIPOS_FILTRO() {
  return {
    ENTREGAS_ULTIMO: 'entregas:ultimo',
  };
}

const NOMBRE_SISTEMA = '__ultimo__';

function _validar({ id_empresa, id_usuario, tipo_filtro }) {
  if (!id_empresa) throw new Error('filtros.helper: id_empresa obligatorio');
  if (!id_usuario) throw new Error('filtros.helper: id_usuario obligatorio');
  if (!tipo_filtro) throw new Error('filtros.helper: tipo_filtro obligatorio');
}

/**
 * Guarda (UPSERT) el último filtro del usuario para un tipo_filtro dado.
 * @param {object} p
 * @param {number} p.id_empresa
 * @param {number} p.id_usuario
 * @param {string} p.tipo_filtro  - namespace, p.ej. TIPOS_FILTRO().ENTREGAS_ULTIMO
 * @param {object} p.configuracion - estado de filtros (se serializa a JSON)
 * @param {object} [client]        - client de transacción opcional; si no, usa pool
 * @returns {Promise<void>}
 */
async function guardarUltimo({ id_empresa, id_usuario, tipo_filtro, configuracion }, client = pool) {
  _validar({ id_empresa, id_usuario, tipo_filtro });

  const cfgJson = JSON.stringify(configuracion == null ? {} : configuracion);

  // UPSERT por clave lógica. No hay UNIQUE en la tabla todavía, así que se
  // resuelve con UPDATE-then-INSERT atómico vía CTE para no depender de DDL.
  await client.query(
    `WITH upd AS (
        UPDATE filtros_guardados
           SET configuracion = $4,
               fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_empresa = $1
           AND id_usuario = $2
           AND tipo_filtro = $3
           AND nombre = $5
        RETURNING id_filtro
     )
     INSERT INTO filtros_guardados
            (id_empresa, id_usuario, tipo_filtro, nombre, configuracion, es_favorito)
     SELECT $1, $2, $3, $5, $4, false
      WHERE NOT EXISTS (SELECT 1 FROM upd)`,
    [id_empresa, id_usuario, tipo_filtro, cfgJson, NOMBRE_SISTEMA]
  );
}

/**
 * Recupera el último filtro del usuario. Devuelve el objeto parseado o null.
 * @returns {Promise<object|null>}
 */
async function obtenerUltimo({ id_empresa, id_usuario, tipo_filtro }, client = pool) {
  _validar({ id_empresa, id_usuario, tipo_filtro });

  const { rows } = await client.query(
    `SELECT configuracion
       FROM filtros_guardados
      WHERE id_empresa = $1
        AND id_usuario = $2
        AND tipo_filtro = $3
        AND nombre = $4
      LIMIT 1`,
    [id_empresa, id_usuario, tipo_filtro, NOMBRE_SISTEMA]
  );

  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].configuracion);
  } catch (_) {
    // Si quedó basura no-JSON, no rompemos la pantalla: devolvemos null.
    return null;
  }
}

module.exports = {
  TIPOS_FILTRO,
  guardarUltimo,
  obtenerUltimo,
};
