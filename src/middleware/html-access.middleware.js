/**
 * html-access.middleware.js - Control de Acceso Server-Side para HTML
 * Ubicación: /root/mi_erp/src/middleware/html-access.middleware.js
 *
 * PROPÓSITO: Intercepta TODA petición a *.html ANTES de express.static.
 * Verifica autenticación (cookie httpOnly) + permisos por rol (tabla modulos + rol_modulos).
 * Así el HTML NUNCA llega al browser si el usuario no tiene acceso.
 *
 * CATEGORÍAS DE PÁGINAS:
 * 1. PÚBLICAS → login.html, ver-pedido-publico.html → pasan sin verificación
 * 2. MÓDULOS (en tabla modulos) → verifican token + rol_modulos
 * 3. AUTENTICADAS SIN MÓDULO → el resto → solo verifican token válido
 */

const path = require('path');
const { verificarJWT } = require('../utils/auth.helper');
const pool = require('../config/database');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
const COOKIE_NAME = 'erp_token';

// Páginas que NO requieren autenticación
const PAGINAS_PUBLICAS = new Set([
    '/login.html',
    '/ver-pedido-publico.html',
    '/index.html'
]);

// ═══════════════════════════════════════════════════════════════════════════
// CACHE DE MÓDULOS (para no hacer query en cada request HTML)
// ═══════════════════════════════════════════════════════════════════════════

let cacheModulosPorRol = new Map();   // empresa_rol → Set(url_frontend)
let cacheUrlModulos = new Set();       // Set de TODAS las url_frontend registradas en modulos
let cacheFechaUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function cargarCacheModulos() {
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
        console.error('\u274c html-access: Error cargando cache de módulos:', error.message);
    }
}

/**
 * Invalida el cache (llamar cuando se modifican permisos)
 */
function invalidarCacheHTML() {
    cacheFechaUpdate = 0;
    cacheModulosPorRol.clear();
    cacheUrlModulos.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

async function htmlAccessMiddleware(req, res, next) {
    // Solo interceptar peticiones a *.html
    if (!req.path.endsWith('.html')) {
        return next();
    }

    const pagina = req.path; // ej: /configuraciones.html

    // ─── 1. PÁGINAS PÚBLICAS → pasar directo ───
    if (PAGINAS_PUBLICAS.has(pagina)) {
        return res.sendFile(path.join(FRONTEND_DIR, pagina));
    }

    // ─── 2. OBTENER TOKEN DE COOKIE ───
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
        // Sin cookie → redirigir a login
        return res.redirect('/login.html');
    }

    // ─── 3. VERIFICAR TOKEN JWT ───
    let decoded;
    try {
        decoded = verificarJWT(token);
    } catch (err) {
        // Token inválido/expirado → limpiar cookie y redirigir
        res.clearCookie(COOKIE_NAME);
        return res.redirect('/login.html');
    }

    const { rol, id_empresa } = decoded;

    // ─── 4. CARGAR CACHE DE MÓDULOS ───
    await cargarCacheModulos();

    // ─── 5. VERIFICAR ACCESO ───

    // Admin siempre tiene acceso total (anti-lockout)
    if (rol === 'admin') {
        return res.sendFile(path.join(FRONTEND_DIR, pagina));
    }

    // ¿La página es un módulo registrado?
    if (cacheUrlModulos.has(pagina)) {
        // SÍ es un módulo → verificar si el rol tiene acceso
        const modulosRol = cacheModulosPorRol.get(`${id_empresa}_${rol}`);

        if (modulosRol && modulosRol.has(pagina)) {
            // Tiene acceso → servir el HTML
            return res.sendFile(path.join(FRONTEND_DIR, pagina));
        }

        // NO tiene acceso al módulo → redirigir a su primer módulo permitido
        return redirigirAPrimerModulo(res, id_empresa, rol);
    }

    // NO es un módulo registrado → es una página auth-only (vista-previa, ver-pedido, etc.)
    // Con token válido es suficiente
    const archivoPath = path.join(FRONTEND_DIR, pagina);

    // Verificar que el archivo existe
    return res.sendFile(archivoPath, (err) => {
        if (err) {
            return res.status(404).send('Página no encontrada');
        }
    });
}

/**
 * Redirige al primer módulo permitido del rol, o muestra error si no tiene ninguno
 */
function redirigirAPrimerModulo(res, id_empresa, rol) {
    const modulosRol = cacheModulosPorRol.get(`${id_empresa}_${rol}`);

    if (modulosRol && modulosRol.size > 0) {
        // Tomar el primero del Set
        const primerUrl = modulosRol.values().next().value;
        return res.redirect(primerUrl);
    }

    // Sin módulos asignados
    return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Sin acceso</title></head>
        <body style="display:flex;align-items:center;justify-content:center;height:100vh;
                    font-family:Arial;color:#666;flex-direction:column;background:#f8f9fa">
            <div style="text-align:center;max-width:400px">
                <div style="font-size:64px;margin-bottom:20px">🔒</div>
                <h2 style="color:#333">Sin acceso</h2>
                <p>Tu usuario no tiene módulos asignados.<br>Contactá al administrador.</p>
                <a href="/login.html" style="display:inline-block;margin-top:20px;padding:10px 24px;
                   background:#0d6efd;color:#fff;border-radius:6px;text-decoration:none">Volver al login</a>
            </div>
        </body>
        </html>
    `);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════
module.exports = { htmlAccessMiddleware, invalidarCacheHTML };
