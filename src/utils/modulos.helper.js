/**
 * modulos.helper.js - Helper centralizado para gestión de módulos y permisos
 * Ubicación: /root/mi_erp/src/utils/modulos.helper.js
 *
 * MULTI-EMPRESA: Todas las funciones que tocan rol_modulos filtran por id_empresa.
 * Cache aislado por ${id_empresa}_${key}.
 *
 * Consumidores:
 *   - auth.controller.js
 *   - modulos-admin.controller.js
 */

'use strict';

const pool = require('../config/db');

// ═══════════════════════════════════════════════════════════════
// CACHE (aislado por empresa)
// ═══════════════════════════════════════════════════════════════

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function obtenerDesdeCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function guardarEnCache(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

/**
 * Invalida cache para un rol de una empresa específica.
 * Key pattern: "${id_empresa}_modulos_${rol}"
 */
function invalidarCacheRol(id_empresa, rol) {
    const prefix = `${id_empresa}_`;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix) && key.includes(rol)) cache.delete(key);
    }
    // También invalidar caches globales que puedan tener datos de esta empresa
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
    cache.delete('rutas_soporte');
    cache.delete('rutas_api_map');
}

function invalidarTodoElCache() {
    cache.clear();
}

// ═══════════════════════════════════════════════════════════════
// RUTAS SOPORTE (globales, no dependen de empresa)
// ═══════════════════════════════════════════════════════════════

async function obtenerRutasSoporte() {
    const cached = obtenerDesdeCache('rutas_soporte');
    if (cached) return cached;

    const { rows } = await pool.query(
        'SELECT prefijo_ruta as ruta FROM rutas_soporte'
    );
    const rutas = rows.map(r => r.ruta);
    guardarEnCache('rutas_soporte', rutas);
    return rutas;
}

async function esRutaSoporte(rutaApi) {
    const rutas = await obtenerRutasSoporte();
    return rutas.some(r => rutaApi.startsWith(r));
}

// ═══════════════════════════════════════════════════════════════
// MÓDULO GRUPOS (globales, catálogo compartido)
// ═══════════════════════════════════════════════════════════════

async function obtenerGrupos() {
    const cached = obtenerDesdeCache('grupos');
    if (cached) return cached;

    const { rows } = await pool.query(
        'SELECT codigo, nombre, icono, orden FROM modulo_grupos ORDER BY orden'
    );
    guardarEnCache('grupos', rows);
    return rows;
}

// ═══════════════════════════════════════════════════════════════
// CONSULTAS DE MÓDULOS POR ROL (filtradas por empresa)
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene los módulos asignados a un rol para una empresa.
 * Usado por auth.controller.js para armar el menú del usuario.
 *
 * @param {number} id_empresa
 * @param {string} rol
 * @returns {Array} módulos con puede_ver, solo_lectura
 */
async function obtenerModulosRol(id_empresa, rol) {
    const cacheKey = `${id_empresa}_modulos_${rol}`;
    const cached = obtenerDesdeCache(cacheKey);
    if (cached) return cached;

    const { rows } = await pool.query(`
        SELECT m.id_modulo, m.codigo, m.nombre, m.descripcion, m.icono,
               m.url_frontend, m.grupo, m.orden, m.requiere_turno,
               rm.puede_ver, rm.solo_lectura
        FROM modulos m
        INNER JOIN rol_modulos rm ON rm.id_modulo = m.id_modulo
        LEFT JOIN modulo_grupos mg ON mg.codigo = m.grupo
        WHERE rm.rol = $1
          AND rm.id_empresa = $2
          AND rm.puede_ver = TRUE
          AND m.activo = TRUE
        ORDER BY mg.orden, m.orden
    `, [rol, id_empresa]);

    guardarEnCache(cacheKey, rows);
    return rows;
}

/**
 * Lista TODOS los módulos del catálogo (tabla compartida, sin id_empresa).
 */
async function obtenerTodosLosModulos() {
    const cached = obtenerDesdeCache('todos_modulos');
    if (cached) return cached;

    const { rows } = await pool.query(`
        SELECT m.id_modulo, m.codigo, m.nombre, m.descripcion,
               m.icono, m.url_frontend, m.grupo, m.orden,
               m.requiere_turno, m.activo
        FROM modulos m
        LEFT JOIN modulo_grupos mg ON mg.codigo = m.grupo
        WHERE m.activo = TRUE
        ORDER BY mg.orden, m.orden
    `);

    guardarEnCache('todos_modulos', rows);
    return rows;
}

/**
 * Verifica si un rol tiene acceso a un módulo en una empresa.
 */
async function verificarAccesoModulo(id_empresa, rol, codigoModulo) {
    const modulos = await obtenerModulosRol(id_empresa, rol);
    const modulo = modulos.find(m => m.codigo === codigoModulo);
    return { permitido: !!modulo, solo_lectura: modulo ? modulo.solo_lectura : false };
}

/**
 * Verifica si un rol tiene acceso a una ruta API en una empresa.
 */
async function verificarAccesoRuta(id_empresa, rol, rutaApi) {
    // Rutas soporte son globales
    if (await esRutaSoporte(rutaApi)) return { permitido: true, solo_lectura: false };

    const mapaRutas = await obtenerMapaRutasApi();
    const rutaEntry = resolverModuloDeRuta(rutaApi, mapaRutas);
    if (!rutaEntry) return { permitido: true, solo_lectura: false };

    // FIX: buscar por id_modulo (antes usaba .codigo que no existe en rutaEntry)
    const modulos = await obtenerModulosRol(id_empresa, rol);
    const modulo = modulos.find(m => m.id_modulo === rutaEntry.id_modulo);
    return { permitido: !!modulo, solo_lectura: modulo ? modulo.solo_lectura : false };
}

// ═══════════════════════════════════════════════════════════════
// MAPA DE RUTAS API (global, catálogo compartido)
// ═══════════════════════════════════════════════════════════════

async function obtenerMapaRutasApi() {
    const cached = obtenerDesdeCache('rutas_api_map');
    if (cached) return cached;

    const { rows } = await pool.query(
        'SELECT prefijo_ruta, id_modulo FROM modulo_rutas_api'
    );
    guardarEnCache('rutas_api_map', rows);
    return rows;
}

function resolverModuloDeRuta(rutaCompleta, mapaRutas) {
    // Normalizar: quitar /api/ si viene
    const ruta = rutaCompleta.replace(/^\/api\//, '/');

    let mejorMatch = null;
    let mejorLongitud = 0;

    for (const entry of mapaRutas) {
        const prefijo = entry.prefijo_ruta;
        if (ruta.startsWith(prefijo) && prefijo.length > mejorLongitud) {
            mejorMatch = entry;
            mejorLongitud = prefijo.length;
        }
    }

    return mejorMatch;
}

// ═══════════════════════════════════════════════════════════════
// ESCRITURA: GUARDAR Y CLONAR MÓDULOS (con id_empresa)
// ═══════════════════════════════════════════════════════════════

/**
 * Guarda la asignación completa de módulos para un rol en una empresa.
 * DELETE + INSERT dentro de transacción.
 *
 * @param {number} id_empresa
 * @param {string} rol
 * @param {Array} modulosAsignados - [{ id_modulo, puede_ver, solo_lectura }]
 * @param {number} idUsuarioAdmin
 * @param {string} ip
 */
async function guardarModulosRol(id_empresa, rol, modulosAsignados, idUsuarioAdmin, ip) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Obtener asignación previa para log
        const { rows: previos } = await client.query(
            `SELECT rm.id_modulo, m.nombre, rm.puede_ver, rm.solo_lectura
             FROM rol_modulos rm
             JOIN modulos m ON m.id_modulo = rm.id_modulo
             WHERE rm.rol = $1 AND rm.id_empresa = $2`, [rol, id_empresa]
        );

        // Borrar asignación existente para este rol+empresa
        await client.query('DELETE FROM rol_modulos WHERE rol = $1 AND id_empresa = $2', [rol, id_empresa]);

        // Insertar nuevas asignaciones
        for (const mod of modulosAsignados) {
            if (mod.puede_ver) {
                await client.query(`
                    INSERT INTO rol_modulos (id_empresa, rol, id_modulo, puede_ver, solo_lectura)
                    VALUES ($1, $2, $3, $4, $5)
                `, [id_empresa, rol, mod.id_modulo, true, mod.solo_lectura || false]);
            }
        }

        // Log
        const nuevos = modulosAsignados.filter(m => m.puede_ver);
        const detalle = `Rol "${rol}": ${nuevos.length} módulos asignados (antes: ${previos.length})`;

        await client.query(`
            INSERT INTO usuarios_logs (id_empresa, id_usuario, accion, detalle, ip_origen)
            VALUES ($1, $2, 'CAMBIAR_MODULOS_ROL', $3, $4)
        `, [id_empresa, idUsuarioAdmin, detalle, ip]);

        await client.query('COMMIT');
        invalidarCacheRol(id_empresa, rol);

        return { ok: true, modulos_asignados: nuevos.length };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Clona módulos de un rol a otro dentro de la misma empresa.
 *
 * @param {number} id_empresa
 * @param {string} rolOrigen
 * @param {string} rolDestino
 * @param {number} idUsuarioAdmin
 * @param {string} ip
 */
async function clonarPermisosRol(id_empresa, rolOrigen, rolDestino, idUsuarioAdmin, ip) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Borrar asignación del destino
        await client.query('DELETE FROM rol_modulos WHERE rol = $1 AND id_empresa = $2', [rolDestino, id_empresa]);

        // Copiar desde origen (misma empresa)
        await client.query(`
            INSERT INTO rol_modulos (id_empresa, rol, id_modulo, puede_ver, solo_lectura)
            SELECT $3, $2, id_modulo, puede_ver, solo_lectura
            FROM rol_modulos
            WHERE rol = $1 AND id_empresa = $3
        `, [rolOrigen, rolDestino, id_empresa]);

        // Verificar cuántos se copiaron
        const { rowCount } = await client.query(
            'SELECT 1 FROM rol_modulos WHERE rol = $1 AND id_empresa = $2', [rolDestino, id_empresa]
        );

        // Log
        await client.query(`
            INSERT INTO usuarios_logs (id_empresa, id_usuario, accion, detalle, ip_origen)
            VALUES ($1, $2, 'CLONAR_MODULOS_ROL', $3, $4)
        `, [id_empresa, idUsuarioAdmin, `Clonó módulos de "${rolOrigen}" a "${rolDestino}" (${rowCount} módulos)`, ip]);

        await client.query('COMMIT');
        invalidarCacheRol(id_empresa, rolDestino);

        return { ok: true, modulos_clonados: rowCount };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// ═══════════════════════════════════════════════════════════════
// MATRIZ DE PERMISOS (para panel admin)
// ═══════════════════════════════════════════════════════════════

/**
 * Retorna la matriz completa roles × módulos para una empresa.
 *
 * @param {number} id_empresa
 */
async function obtenerMatrizPermisos(id_empresa) {
    // Roles de esta empresa (usuarios + rol_modulos)
    const { rows: roles } = await pool.query(
        `SELECT DISTINCT rol FROM (
            SELECT rol FROM usuarios WHERE id_empresa = $1
            UNION
            SELECT rol FROM rol_modulos WHERE id_empresa = $1
        ) t ORDER BY rol`, [id_empresa]
    );

    // Módulos del catálogo (compartidos)
    const { rows: modulos } = await pool.query(
        'SELECT m.* FROM modulos m LEFT JOIN modulo_grupos mg ON mg.codigo = m.grupo WHERE m.activo = TRUE ORDER BY mg.orden, m.orden'
    );

    // Asignaciones de esta empresa
    const { rows: asignaciones } = await pool.query(
        'SELECT * FROM rol_modulos WHERE id_empresa = $1', [id_empresa]
    );

    const matriz = {};
    for (const { rol } of roles) {
        matriz[rol] = modulos.map(m => {
            const asig = asignaciones.find(a => a.rol === rol && a.id_modulo === m.id_modulo);
            return {
                id_modulo: m.id_modulo,
                codigo: m.codigo,
                nombre: m.nombre,
                grupo: m.grupo,
                icono: m.icono,
                puede_ver: asig ? asig.puede_ver : false,
                solo_lectura: asig ? asig.solo_lectura : false
            };
        });
    }

    return { roles: roles.map(r => r.rol), modulos, matriz };
}

/**
 * Obtiene todos los módulos con estado de asignación para un rol en una empresa.
 * Incluye módulos NO asignados (para mostrar checkboxes en el panel).
 *
 * @param {number} id_empresa
 * @param {string} rol
 */
async function obtenerModulosDeRol(id_empresa, rol) {
    const { rows } = await pool.query(`
        SELECT m.id_modulo, m.codigo, m.nombre, m.grupo, m.icono, m.orden,
               COALESCE(rm.puede_ver, FALSE) as puede_ver,
               COALESCE(rm.solo_lectura, FALSE) as solo_lectura
        FROM modulos m
        LEFT JOIN rol_modulos rm ON rm.id_modulo = m.id_modulo AND rm.rol = $1 AND rm.id_empresa = $2
        LEFT JOIN modulo_grupos mg ON mg.codigo = m.grupo
        WHERE m.activo = TRUE
        ORDER BY mg.orden, m.orden
    `, [rol, id_empresa]);

    return rows;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    obtenerModulosRol,
    obtenerTodosLosModulos,
    verificarAccesoModulo,
    verificarAccesoRuta,
    esRutaSoporte,
    obtenerRutasSoporte,
    obtenerGrupos,
    obtenerModulosDeRol,
    obtenerMatrizPermisos,
    invalidarCacheRol,
    invalidarTodoElCache,
    guardarModulosRol,
    clonarPermisosRol,
};
