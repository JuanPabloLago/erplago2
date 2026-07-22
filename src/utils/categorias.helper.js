/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CATEGORIAS HELPER — ERP LAGO
 * Helper canonico para la tabla `categorias` (COMPARTIDA, sin id_empresa).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLA: Toda escritura a `categorias` pasa por este helper.
 *        crud.helper.js delega aqui (pass-through, Bloque 3).
 *
 * MODELO (post-fix 2026-05-15):
 *   - Tabla plana de 2 niveles logicos: cualquier fila es categoria O
 *     subcategoria segun a cual FK de `productos` se asocie
 *     (id_categoria o id_subcategoria). En la propia tabla `categorias`
 *     NO hay distincion: todas las filas tienen id_categoria_padre = NULL.
 *   - La columna id_categoria_padre se conserva por compatibilidad de schema
 *     pero ya no se usa para el flujo del importer.
 *
 * UNIQUENESS:
 *   - INDEX funcional UNIQUE categorias_nombre_normalizado_uniq
 *     sobre UPPER(TRIM(nombre)).
 *   - normalizarNombre() en este helper coincide con esa expresion, por lo
 *     que UNIQUE de BD y lookup de aplicacion miran SIEMPRE el mismo valor.
 *     (El bug del 2026-05-15 fue justamente lo contrario.)
 *
 * IDEMPOTENCIA:
 *   - crearCategoria() es UPSERT atomico (ON CONFLICT DO UPDATE).
 *     Si el nombre normalizado ya existe — en cualquier estado: activo o
 *     inactivo, con padre legacy o sin el — la fila se reactiva y se
 *     limpia su id_categoria_padre, sin generar unique violation.
 *   - obtenerOCrear() con opciones.crear=true es wrapper sobre el mismo
 *     UPSERT pero devuelve {created, encontrada, ...} para el caller.
 *
 * BITACORA:
 *   - INSERT → ACCIONES.CATEGORIA_CREAR
 *   - UPDATE → ACCIONES.CATEGORIA_ACTUALIZAR (reactivacion/saneo)
 *
 * TRIGGER DE PROPAGACION:
 *   - fn_propagar_cambio_categoria_a_productos dispara un UPDATE no-op
 *     sobre productos cuando cambia el nombre, lo que regenera
 *     productos.busqueda_vector. Es transparente desde aca.
 *
 * @module categorias.helper
 */
'use strict';

const logger = require('./logger');
const bitacora = require('./bitacora.helper');

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PURAS (sin DB, testables)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normaliza un nombre de categoria para comparacion/match e insercion.
 * Reglas: trim de bordes + colapso de espacios internos + UPPER case.
 * Coincide con la expresion del UNIQUE INDEX en BD.
 */
function normalizarNombre(s) {
    if (s == null) return '';
    return String(s).trim().replace(/\s+/g, ' ').toUpperCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca una categoria por nombre normalizado.
 * NO filtra por activo ni por id_categoria_padre — esos filtros causaron
 * el incidente del 2026-05-15: el lookup era "miope" frente al UNIQUE global.
 *
 * Si hubiera multiples matches (no deberia, gracias al UNIQUE funcional),
 * devuelve el de menor id_categoria.
 *
 * @returns {Promise<Object|null>} fila de categorias o null
 */
async function buscarPorNombre(client, nombre) {
    if (!nombre || !String(nombre).trim()) return null;
    const norm = normalizarNombre(nombre);

    const { rows } = await client.query(
        `SELECT id_categoria, nombre, id_categoria_padre, orden, descripcion, activo
           FROM categorias
          WHERE UPPER(TRIM(nombre)) = $1
          ORDER BY id_categoria ASC
          LIMIT 1`,
        [norm]
    );
    return rows[0] || null;
}

/**
 * Alias historico. Mantenido por compatibilidad con callers antiguos.
 * @deprecated Usar buscarPorNombre — el concepto de "raiz" ya no aplica.
 */
async function buscarRaizPorNombre(client, nombre) {
    return buscarPorNombre(client, nombre);
}

/**
 * MAX(orden)+1 entre TODAS las categorias.
 * En el modelo plano no hay distincion para el orden.
 */
async function siguienteOrden(client) {
    const { rows } = await client.query(
        `SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM categorias`
    );
    return rows[0].siguiente;
}

/**
 * Alias historico.
 * @deprecated Usar siguienteOrden.
 */
async function siguienteOrdenRaiz(client) {
    return siguienteOrden(client);
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD CANONICO (firma compatible con crud.helper.js para pass-through)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea o reactiva una categoria de forma ATOMICA via UPSERT.
 *
 * Comportamiento:
 *   - Si el nombre normalizado NO existe → INSERT, activo=TRUE.
 *   - Si el nombre normalizado YA existe (en cualquier estado):
 *       - Reactiva (activo=TRUE).
 *       - Sanea padre legacy (id_categoria_padre=NULL).
 *       - Conserva la descripcion existente; si era NULL, usa la nueva.
 *
 * IMPORTANTE: id_categoria_padre del input se IGNORA. El modelo es plano.
 *
 * @param {pg.PoolClient} client
 * @param {Object} datos
 * @param {string} datos.nombre  OBLIGATORIO
 * @param {string} [datos.descripcion]
 * @param {number} [datos.orden=0]
 * @param {number} [datos.id_empresa]   para bitacora
 * @param {number} [datos.id_usuario]   para bitacora
 * @param {string} [datos.ip]           para bitacora
 * @param {string} [datos.origen]       para bitacora.payload.origen
 *
 * @returns {Promise<Object>} fila de categorias (sin campos virtuales)
 */
async function crearCategoria(client, datos) {
    const {
        nombre,
        descripcion = null,
        orden = 0,
        id_empresa = null,
        id_usuario = null,
        ip = null,
        origen = null
    } = datos || {};

    if (!nombre || !String(nombre).trim()) {
        throw new Error('categorias.helper.crearCategoria: nombre obligatorio');
    }

    const nombreNormalizado = normalizarNombre(nombre);

    const result = await client.query(
        `INSERT INTO categorias (nombre, descripcion, id_categoria_padre, orden, activo)
         VALUES ($1, $2, NULL, $3, TRUE)
         ON CONFLICT ((UPPER(TRIM(nombre)))) DO UPDATE
           SET activo = TRUE,
               id_categoria_padre = NULL,
               descripcion = COALESCE(categorias.descripcion, EXCLUDED.descripcion)
         RETURNING *, (xmax = 0) AS __fue_creada`,
        [nombreNormalizado, descripcion || null, orden || 0]
    );
    const row = result.rows[0];
    const fueCreada = row.__fue_creada === true;
    delete row.__fue_creada;

    if (id_empresa) {
        await bitacora.registrar(client, {
            id_empresa,
            id_usuario,
            ip,
            entidad: bitacora.ENTIDADES.CATEGORIA,
            id_entidad: row.id_categoria,
            accion: fueCreada
                ? bitacora.ACCIONES.CATEGORIA_CREAR
                : bitacora.ACCIONES.CATEGORIA_ACTUALIZAR,
            payload: {
                nombre: row.nombre,
                origen: origen || 'manual',
                fue_creada: fueCreada,
                ...(fueCreada ? {} : { motivo: 'upsert: reactivacion/saneo' })
            }
        });
    }

    return row;
}

/**
 * Actualiza una categoria. Firma compatible con crud.helper.actualizarCategoria.
 * (Sin cambios respecto del helper viejo.)
 */
async function actualizarCategoria(client, datos) {
    const {
        id_categoria,
        nombre,
        descripcion = null,
        id_categoria_padre = null,
        orden = 0,
        id_empresa = null,
        id_usuario = null,
        ip = null
    } = datos || {};

    if (!id_categoria) {
        throw new Error('categorias.helper.actualizarCategoria: id_categoria obligatorio');
    }

    const result = await client.query(
        `UPDATE categorias
            SET nombre=$1, descripcion=$2, id_categoria_padre=$3, orden=$4
          WHERE id_categoria=$5 AND activo=TRUE
          RETURNING *`,
        [nombre, descripcion || null, id_categoria_padre || null, orden || 0, id_categoria]
    );
    const categoria = result.rows[0];

    if (categoria && id_empresa) {
        await bitacora.registrar(client, {
            id_empresa,
            id_usuario,
            ip,
            entidad: bitacora.ENTIDADES.CATEGORIA,
            id_entidad: categoria.id_categoria,
            accion: bitacora.ACCIONES.CATEGORIA_ACTUALIZAR,
            payload: {
                nombre: categoria.nombre,
                id_categoria_padre: categoria.id_categoria_padre
            }
        });
    }

    return categoria;
}

/**
 * Desactiva una categoria (UPDATE activo=FALSE). NO hace DELETE.
 * (Sin cambios respecto del helper viejo.)
 */
async function desactivarCategoria(client, datos) {
    const {
        id_categoria,
        id_empresa = null,
        id_usuario = null,
        ip = null,
        motivo = null
    } = datos || {};

    if (!id_categoria) {
        throw new Error('categorias.helper.desactivarCategoria: id_categoria obligatorio');
    }

    const result = await client.query(
        `UPDATE categorias SET activo=FALSE WHERE id_categoria=$1 RETURNING *`,
        [id_categoria]
    );
    const categoria = result.rows[0];

    if (categoria && id_empresa) {
        await bitacora.registrar(client, {
            id_empresa,
            id_usuario,
            ip,
            entidad: bitacora.ENTIDADES.CATEGORIA,
            id_entidad: categoria.id_categoria,
            accion: bitacora.ACCIONES.CATEGORIA_DESACTIVAR,
            payload: { nombre: categoria.nombre },
            motivo
        });
    }

    return categoria;
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE — obtenerOCrear (usado por importer)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resuelve una categoria por nombre normalizado.
 * Si no existe y opciones.crear=true, la crea via UPSERT atomico.
 *
 * @param {pg.PoolClient} client
 * @param {Object} datos
 * @param {string} datos.nombre
 * @param {Object} [datos.opciones]
 * @param {boolean} [datos.opciones.crear=false]
 * @param {number}  [datos.opciones.id_empresa]
 * @param {number}  [datos.opciones.id_usuario]
 * @param {string}  [datos.opciones.ip]
 * @param {string}  [datos.opciones.archivo_origen]
 *
 * @returns {Promise<{
 *   id_categoria: number|null,
 *   created: boolean,
 *   encontrada: boolean,
 *   categoria: Object|null
 * }>}
 */
async function obtenerOCrear(client, datos) {
    const { nombre, opciones = {} } = datos || {};

    if (!nombre || !String(nombre).trim()) {
        throw new Error('categorias.helper.obtenerOCrear: nombre obligatorio');
    }

    // Si no hay que crear, solo busco
    if (!opciones.crear) {
        const encontrada = await buscarPorNombre(client, nombre);
        if (encontrada) {
            return {
                id_categoria: encontrada.id_categoria,
                created: false,
                encontrada: true,
                categoria: encontrada
            };
        }
        return { id_categoria: null, created: false, encontrada: false, categoria: null };
    }

    // crear=true → UPSERT inline con tracking explicito de insert-vs-update
    const nombreNormalizado = normalizarNombre(nombre);
    const result = await client.query(
        `INSERT INTO categorias (nombre, descripcion, id_categoria_padre, orden, activo)
         VALUES ($1, NULL, NULL, 0, TRUE)
         ON CONFLICT ((UPPER(TRIM(nombre)))) DO UPDATE
           SET activo = TRUE,
               id_categoria_padre = NULL
         RETURNING *, (xmax = 0) AS __fue_creada`,
        [nombreNormalizado]
    );
    const row = result.rows[0];
    const fueCreada = row.__fue_creada === true;
    delete row.__fue_creada;

    if (opciones.id_empresa) {
        await bitacora.registrar(client, {
            id_empresa: opciones.id_empresa,
            id_usuario: opciones.id_usuario,
            ip: opciones.ip,
            entidad: bitacora.ENTIDADES.CATEGORIA,
            id_entidad: row.id_categoria,
            accion: fueCreada
                ? bitacora.ACCIONES.CATEGORIA_CREAR
                : bitacora.ACCIONES.CATEGORIA_ACTUALIZAR,
            payload: {
                nombre: row.nombre,
                origen: opciones.archivo_origen ? `import:${opciones.archivo_origen}` : 'import',
                fue_creada: fueCreada,
                ...(fueCreada ? {} : { motivo: 'upsert: reactivacion/saneo' })
            }
        });
    }

    return {
        id_categoria: row.id_categoria,
        created: fueCreada,
        encontrada: !fueCreada,
        categoria: row
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Puras
    normalizarNombre,
    // Lookup
    buscarPorNombre,
    buscarRaizPorNombre,   // @deprecated — alias de buscarPorNombre
    siguienteOrden,
    siguienteOrdenRaiz,    // @deprecated — alias de siguienteOrden
    // CRUD (pass-through compatible)
    crearCategoria,
    actualizarCategoria,
    desactivarCategoria,
    // Feature
    obtenerOCrear,
};
