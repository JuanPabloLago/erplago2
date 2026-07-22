#!/bin/bash
# ============================================================================
# FIX FASE 1: PERMISOS Y ACCESO — Multi-empresa
# Ejecutar desde /root/mi_erp
# 
# ARCHIVOS QUE MODIFICA:
#   1. src/utils/modulos.helper.js (funciones con id_empresa)
#   2. src/middleware/html-access.middleware.js (cache por empresa)
#   3. src/controllers/modulos-admin.controller.js (pasar id_empresa)
#   4. src/routes/usuarios.routes.js (agregar verificarToken)
#
# BACKUP automático antes de cada cambio.
# ============================================================================

set -e
cd /root/mi_erp

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/pre_fix_multiempresa_fase1_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "============================================"
echo " FASE 1: PERMISOS Y ACCESO MULTI-EMPRESA"
echo " Backup en: $BACKUP_DIR"
echo "============================================"
echo ""

# ============================================================================
# BACKUP
# ============================================================================
echo "[1/5] Backup de archivos originales..."
cp src/utils/modulos.helper.js "$BACKUP_DIR/"
cp src/middleware/html-access.middleware.js "$BACKUP_DIR/"
cp src/controllers/modulos-admin.controller.js "$BACKUP_DIR/"
cp src/routes/usuarios.routes.js "$BACKUP_DIR/"
echo "  ✓ Backup completo"
echo ""

# ============================================================================
# FIX 1: modulos.helper.js — Todas las funciones con id_empresa
# ============================================================================
echo "[2/5] Corrigiendo modulos.helper.js..."

cat > /tmp/fix_modulos_helper.js << 'ENDOFFILE'
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

const pool = require('../config/database');

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
        'SELECT ruta FROM rutas_soporte WHERE activo = TRUE'
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
    return modulos.some(m => m.codigo === codigoModulo);
}

/**
 * Verifica si un rol tiene acceso a una ruta API en una empresa.
 */
async function verificarAccesoRuta(id_empresa, rol, rutaApi) {
    // Rutas soporte son globales
    if (await esRutaSoporte(rutaApi)) return true;

    const mapaRutas = await obtenerMapaRutasApi();
    const modulo = resolverModuloDeRuta(rutaApi, mapaRutas);
    if (!modulo) return true; // Ruta no mapeada = acceso libre

    return await verificarAccesoModulo(id_empresa, rol, modulo.codigo);
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
ENDOFFILE

cp /tmp/fix_modulos_helper.js src/utils/modulos.helper.js
echo "  ✓ modulos.helper.js actualizado"
echo ""

# ============================================================================
# FIX 2: modulos-admin.controller.js — Pasar id_empresa del token
# ============================================================================
echo "[3/5] Corrigiendo modulos-admin.controller.js..."

cat > /tmp/fix_modulos_admin.js << 'ENDOFFILE'
/**
 * modulos-admin.controller.js - Endpoints de Gestión de Módulos por Rol
 * Ubicación: /root/mi_erp/src/controllers/modulos-admin.controller.js
 *
 * MULTI-EMPRESA: Todas las operaciones filtran por req.usuario.id_empresa.
 *
 * Endpoints:
 *   GET  /api/admin/modulos              → Lista todos los módulos (catálogo)
 *   GET  /api/admin/modulos/matriz       → Matriz completa roles x módulos
 *   GET  /api/admin/modulos/rol/:rol     → Módulos de un rol específico
 *   PUT  /api/admin/modulos/rol/:rol     → Guardar asignación de un rol
 *   POST /api/admin/modulos/rol/:rol/clonar → Clonar desde otro rol
 */

const modulosHelper = require('../utils/modulos.helper');
const adminHelper = require('../utils/admin.helper');

module.exports = {

    /**
     * GET /api/admin/modulos
     * Lista todos los módulos del catálogo (compartido, sin empresa)
     */
    async listarModulos(req, res) {
        try {
            const modulos = await modulosHelper.obtenerTodosLosModulos();
            res.json(modulos);
        } catch (error) {
            console.error('❌ Error al listar módulos:', error.message);
            res.status(500).json({ error: 'Error al listar módulos' });
        }
    },

    /**
     * GET /api/admin/modulos/matriz
     * Retorna la matriz completa: todos los roles con todos los módulos de esta empresa
     */
    async obtenerMatriz(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const matriz = await modulosHelper.obtenerMatrizPermisos(id_empresa);
            res.json(matriz);
        } catch (error) {
            console.error('❌ Error al obtener matriz:', error.message);
            res.status(500).json({ error: 'Error al obtener matriz de permisos' });
        }
    },

    /**
     * GET /api/admin/modulos/rol/:rol
     * Módulos de un rol específico en esta empresa
     */
    async obtenerModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { id_empresa } = req.usuario;
            const modulos = await modulosHelper.obtenerModulosDeRol(id_empresa, rol);
            res.json(modulos);
        } catch (error) {
            console.error('❌ Error al obtener módulos del rol:', error.message);
            res.status(500).json({ error: 'Error al obtener módulos del rol' });
        }
    },

    /**
     * PUT /api/admin/modulos/rol/:rol
     * Guardar asignación completa de módulos para un rol en esta empresa
     * Body: { modulos: [{ id_modulo, puede_ver, solo_lectura }] }
     */
    async guardarModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { modulos } = req.body;
            const { id_usuario, id_empresa } = req.usuario;

            if (!modulos || !Array.isArray(modulos)) {
                return res.status(400).json({ error: 'Se requiere array de módulos' });
            }

            const resultado = await modulosHelper.guardarModulosRol(id_empresa, rol, modulos, id_usuario, req.ip);

            res.json({
                message: `Módulos actualizados para rol "${rol}"`,
                modulos_asignados: resultado.modulos_asignados
            });

        } catch (error) {
            console.error('❌ Error al guardar módulos del rol:', error.message);
            res.status(500).json({ error: 'Error al guardar módulos del rol' });
        }
    },

    /**
     * POST /api/admin/modulos/rol/:rol/clonar
     * Clonar módulos de otro rol dentro de esta empresa
     * Body: { rol_origen: 'admin' }
     */
    async clonarModulosRol(req, res) {
        try {
            const { rol } = req.params;
            const { rol_origen } = req.body;
            const { id_usuario, id_empresa } = req.usuario;

            if (!rol_origen) {
                return res.status(400).json({ error: 'Se requiere rol_origen' });
            }

            if (rol === rol_origen) {
                return res.status(400).json({ error: 'No se puede clonar un rol a sí mismo' });
            }

            const resultado = await modulosHelper.clonarPermisosRol(id_empresa, rol_origen, rol, id_usuario, req.ip);

            res.json({
                message: `Módulos clonados de "${rol_origen}" a "${rol}"`,
                modulos_clonados: resultado.modulos_clonados
            });

        } catch (error) {
            console.error('❌ Error al clonar módulos:', error.message);
            res.status(500).json({ error: 'Error al clonar módulos' });
        }
    }
};
ENDOFFILE

cp /tmp/fix_modulos_admin.js src/controllers/modulos-admin.controller.js
echo "  ✓ modulos-admin.controller.js actualizado"
echo ""

# ============================================================================
# FIX 3: html-access.middleware.js — Cache aislado por empresa
# ============================================================================
echo "[4/5] Corrigiendo html-access.middleware.js (cache multi-empresa)..."

# Este fix es quirúrgico: solo cambiamos la función cargarCacheModulos y el lookup
# Necesitamos ver el middleware completo primero, así que usamos Python para editar

python3 << 'PYEOF'
import re

filepath = 'src/middleware/html-access.middleware.js'
with open(filepath, 'r') as f:
    content = f.read()

# ── FIX 1: Cambiar las variables de cache globales ──
# Reemplazar la cache por rol con cache por empresa_rol
content = content.replace(
    "let cacheModulosPorRol = new Map();   // rol → [{ url_frontend, solo_lectura }]",
    "let cacheModulosPorRol = new Map();   // empresa_rol → Set(url_frontend)"
)

# ── FIX 2: Reemplazar función cargarCacheModulos completa ──
old_func = '''async function cargarCacheModulos() {
    const ahora = Date.now();
    if (ahora - cacheFechaUpdate < CACHE_TTL && cacheModulosPorRol.size > 0) return;

    try {
        // 1. Cargar todas las url_frontend registradas (para saber qué es "módulo" vs "auth-only")
        const { rows: todosModulos } = await pool.query(
            `SELECT url_frontend FROM modulos WHERE activo = TRUE`
        );
        cacheUrlModulos = new Set(todosModulos.map(m => m.url_frontend));

        // 2. Cargar módulos por rol
        const { rows } = await pool.query(`
            SELECT rm.rol, m.url_frontend, rm.solo_lectura
            FROM rol_modulos rm
            INNER JOIN modulos m ON m.id_modulo = rm.id_modulo
            WHERE rm.puede_ver = TRUE AND m.activo = TRUE
        `);

        const mapa = new Map();
        for (const r of rows) {
            if (!mapa.has(r.rol)) mapa.set(r.rol, new Set());
            mapa.get(r.rol).add(r.url_frontend);
        }
        cacheModulosPorRol = mapa;
        cacheFechaUpdate = ahora;
    } catch (error) {
        console.error('❌ html-access: Error cargando cache de módulos:', error.message);
    }
}'''

new_func = '''async function cargarCacheModulos() {
    const ahora = Date.now();
    if (ahora - cacheFechaUpdate < CACHE_TTL && cacheModulosPorRol.size > 0) return;

    try {
        // 1. Cargar todas las url_frontend registradas (para saber qué es "módulo" vs "auth-only")
        const { rows: todosModulos } = await pool.query(
            `SELECT url_frontend FROM modulos WHERE activo = TRUE`
        );
        cacheUrlModulos = new Set(todosModulos.map(m => m.url_frontend));

        // 2. Cargar módulos por rol Y empresa (aislamiento multi-empresa)
        const { rows } = await pool.query(`
            SELECT rm.id_empresa, rm.rol, m.url_frontend, rm.solo_lectura
            FROM rol_modulos rm
            INNER JOIN modulos m ON m.id_modulo = rm.id_modulo
            WHERE rm.puede_ver = TRUE AND m.activo = TRUE
        `);

        const mapa = new Map();
        for (const r of rows) {
            const key = `${r.id_empresa}_${r.rol}`;
            if (!mapa.has(key)) mapa.set(key, new Set());
            mapa.get(key).add(r.url_frontend);
        }
        cacheModulosPorRol = mapa;
        cacheFechaUpdate = ahora;
    } catch (error) {
        console.error('\\u274c html-access: Error cargando cache de módulos:', error.message);
    }
}'''

if old_func in content:
    content = content.replace(old_func, new_func)
    print("  ✓ cargarCacheModulos reemplazada")
else:
    print("  ⚠ No se encontró cargarCacheModulos exacta - verificar manualmente")

# ── FIX 3: Cambiar el lookup de cache para usar empresa_rol ──
# Buscar donde se hace: cacheModulosPorRol.has(rol) o .get(rol)
# y cambiar a cacheModulosPorRol.has(`${id_empresa}_${rol}`) o .get(...)

# Patrón: buscar la sección que usa cacheModulosPorRol.has(rol)
old_lookup = "cacheModulosPorRol.has(rol)"
new_lookup = "cacheModulosPorRol.has(`${id_empresa}_${rol}`)"
if old_lookup in content:
    content = content.replace(old_lookup, new_lookup)
    print("  ✓ cache lookup .has() actualizado")

old_get = "cacheModulosPorRol.get(rol)"
new_get = "cacheModulosPorRol.get(`${id_empresa}_${rol}`)"
if old_get in content:
    content = content.replace(old_get, new_get)
    print("  ✓ cache lookup .get() actualizado")

# ── FIX 4: Asegurar que id_empresa se extrae del token donde se usa ──
# Buscar donde se decodifica el token para agregar id_empresa
# El middleware ya decodifica JWT que contiene id_empresa
# Solo necesitamos que donde se hace const { rol } = decoded también saque id_empresa
old_destruct = "const { rol } = decoded;"
new_destruct = "const { rol, id_empresa } = decoded;"
if old_destruct in content:
    content = content.replace(old_destruct, new_destruct)
    print("  ✓ Destructuring de token actualizado para incluir id_empresa")
else:
    # Intentar variante con const { rol, ...
    if "{ rol }" in content and "decoded" in content:
        # Buscar patrón más flexible
        content = re.sub(
            r'const\s*\{\s*rol\s*\}\s*=\s*decoded',
            'const { rol, id_empresa } = decoded',
            content
        )
        print("  ✓ Destructuring de token actualizado (regex)")
    else:
        print("  ⚠ No se encontró destructuring de token - verificar manualmente")

with open(filepath, 'w') as f:
    f.write(content)

print("  ✓ html-access.middleware.js actualizado")
PYEOF

echo ""

# ============================================================================
# FIX 4: usuarios.routes.js — Agregar verificarToken global
# ============================================================================
echo "[5/5] Corrigiendo usuarios.routes.js (agregar verificarToken)..."

python3 << 'PYEOF'
filepath = 'src/routes/usuarios.routes.js'
with open(filepath, 'r') as f:
    content = f.read()

# Buscar la línea del comentario que dice "todas las rutas requieren autenticación"
# y agregar router.use(verificarToken) justo después
old_comment = "// Middleware: todas las rutas requieren autenticación\n\n// Middleware: solo admin/administrador puede acceder"
new_comment = "// Middleware: todas las rutas requieren autenticación\nrouter.use(verificarToken);\n\n// Middleware: solo admin/administrador puede acceder"

if old_comment in content:
    content = content.replace(old_comment, new_comment)
    print("  ✓ router.use(verificarToken) agregado")
else:
    # Intentar sin doble newline
    old_v2 = "// Middleware: todas las rutas requieren autenticación"
    if old_v2 in content and "router.use(verificarToken)" not in content:
        content = content.replace(old_v2, old_v2 + "\nrouter.use(verificarToken);")
        print("  ✓ router.use(verificarToken) agregado (variante)")
    else:
        print("  ⚠ verificarToken ya presente o patrón no encontrado")

with open(filepath, 'w') as f:
    f.write(content)

print("  ✓ usuarios.routes.js actualizado")
PYEOF

echo ""

# ============================================================================
# VALIDACIÓN DE SINTAXIS
# ============================================================================
echo "============================================"
echo " VALIDANDO SINTAXIS..."
echo "============================================"
echo ""

source ~/.nvm/nvm.sh 2>/dev/null || export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

ERRORES=0
for archivo in \
    src/utils/modulos.helper.js \
    src/controllers/modulos-admin.controller.js \
    src/middleware/html-access.middleware.js \
    src/routes/usuarios.routes.js; do
    
    if node --check "$archivo" 2>/dev/null; then
        echo "  ✓ $archivo — OK"
    else
        echo "  ✗ $archivo — ERROR DE SINTAXIS"
        ERRORES=$((ERRORES+1))
    fi
done

echo ""
if [ $ERRORES -gt 0 ]; then
    echo "⚠ HAY $ERRORES ERRORES DE SINTAXIS"
    echo "  Restaurar con: cp $BACKUP_DIR/* src/utils/ && cp $BACKUP_DIR/html-access.middleware.js src/middleware/ && cp $BACKUP_DIR/modulos-admin.controller.js src/controllers/ && cp $BACKUP_DIR/usuarios.routes.js src/routes/"
    exit 1
fi

echo "============================================"
echo " FASE 1 COMPLETADA"
echo " Backup en: $BACKUP_DIR"
echo ""
echo " Próximo paso: reiniciar PM2 y probar"
echo "   source ~/.nvm/nvm.sh && pm2 restart erplago"
echo "   pm2 logs erplago --lines 30"
echo ""
echo " Probar:"
echo "   1. Login normal"
echo "   2. Acceso a módulos"
echo "   3. Panel admin-usuarios → pestaña módulos"
echo "   4. Guardar asignación de módulos"
echo "============================================"
