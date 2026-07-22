/**
 * navegacion.helper.js
 * Single Responsibility: armar el árbol de navegación + branding + tema
 * para un usuario en una empresa.
 *
 * Reusa modulos.helper.js para módulos por rol (cache 5min ya implementado ahí).
 * Lee configuraciones_empresa para branding/tema y overrides de color.
 */
const pool = require('../config/database');
const modulosHelper = require('./modulos.helper');

// Mapeo Font Awesome -> Bootstrap Icons (replicado de auth.js para uniformidad)
const ICONO_MAP = {
    'fa-cash-register':       'bi-cart3',
    'fa-truck':               'bi-truck',
    'fa-warehouse':           'bi-box-seam',
    'fa-cart-shopping':       'bi-bag',
    'fa-users':               'bi-people',
    'fa-vault':               'bi-safe',
    'fa-chart-bar':           'bi-bar-chart',
    'fa-gears':               'bi-gear',
    'fa-folder':              'bi-folder',
    'fa-file-lines':          'bi-file-text',
    'fa-file-invoice-dollar': 'bi-receipt',
    'fa-clipboard-list':      'bi-clipboard-check',
    'fa-boxes-stacked':       'bi-box-seam',
    'fa-tags':                'bi-tags',
    'fa-bookmark':            'bi-bookmark',
    'fa-sliders':             'bi-sliders',
    'fa-money-bill-wave':     'bi-cash-stack',
    'fa-tachometer-alt':      'bi-speedometer2',
    'fa-book':                'bi-journal-text',
    'fa-user-shield':         'bi-person-lock',
    'fa-database':            'bi-database',
    'fa-list':                'bi-list-ul'
};
function mapearIcono(fa) { return ICONO_MAP[fa] || 'bi-circle'; }

async function leerConfigsConPrefijo(id_empresa, prefijo) {
    const r = await pool.query(
        "SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave LIKE $2",
        [id_empresa, prefijo + '%']
    );
    const m = new Map();
    r.rows.forEach(row => m.set(row.clave, row.valor));
    return m;
}

async function obtenerBranding(id_empresa) {
    const r = await pool.query(
        "SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND (clave LIKE 'branding.%' OR clave LIKE 'empresa.%')",
        [id_empresa]
    );
    const map = new Map(r.rows.map(x => [x.clave, x.valor]));
    const get = (k, d) => map.has(k) ? map.get(k) : d;
    return {
        razon_social:     get('empresa.razon_social', ''),
        nombre_fantasia:  get('empresa.nombre', ''),
        nombre_corto:     get('branding.nombre_corto', get('empresa.nombre', 'ERP')),
        slogan:           get('empresa.slogan', ''),
        cuit:             get('empresa.cuit', ''),
        condicion_iva:    get('empresa.condicion_iva', ''),
        domicilio_legal:  get('empresa.domicilio_legal', ''),
        telefono:         get('empresa.telefono', ''),
        email:            get('empresa.email', ''),
        whatsapp:         get('empresa.whatsapp', ''),
        logo_url:         get('branding.logo_url', ''),
        logo_url_oscuro:  get('branding.logo_url_oscuro', ''),
        favicon_url:      get('branding.favicon_url', '/img/favicon.ico'),
        color_primario:   get('branding.color_primario', '#1a5f7a'),
        color_secundario: get('branding.color_secundario', '#0d3b4f'),
        mostrar_slogan:   get('branding.mostrar_slogan', 'true') === 'true'
    };
}

async function obtenerTema(id_empresa) {
    const m = await leerConfigsConPrefijo(id_empresa, 'ui.');
    const get = (k, d) => m.has(k) ? m.get(k) : d;
    return {
        tema_base:               get('ui.tema_base', 'lago_verde'),
        densidad_listado:        get('ui.densidad_listado', 'normal'),
        estrategia_color_modulo: get('ui.estrategia_color_modulo', 'grupo'),
        font_size_base:          parseInt(get('ui.font_size_base', '16'), 10),
        navbar: {
            tipo:                get('ui.navbar.tipo', 'horizontal'),
            sticky:              get('ui.navbar.sticky', 'true') === 'true',
            mostrar_breadcrumb:  get('ui.navbar.mostrar_breadcrumb', 'true') === 'true',
            accesos_rapidos:     get('ui.navbar.accesos_rapidos', ''),
            mostrar_deshabilitados: get('ui.navbar.mostrar_deshabilitados', 'true') === 'true'
        },
        tabs_modulo: { tipo: get('ui.tabs_modulo.tipo', 'subnav') },
        shortcuts: {
            guardar:         get('ui.shortcut.guardar',         'F2'),
            buscar_cliente:  get('ui.shortcut.buscar_cliente',  'F3'),
            refrescar:       get('ui.shortcut.refrescar',       'F5'),
            nuevo:           get('ui.shortcut.nuevo',           'Insert'),
            cancelar:        get('ui.shortcut.cancelar',        'Escape'),
            buscar_producto: get('ui.shortcut.buscar_producto', 'Enter')
        }
    };
}

/**
 * Color de acento del grupo:
 * 1) override por empresa en configuraciones_empresa (ui.grupo.<codigo>.color_acento)
 * 2) default del catálogo (modulo_grupos.color_default)
 * 3) fallback gris semántico
 */
function resolverColorGrupo(grupoCodigo, configsUI, colorDefault) {
    const k = 'ui.grupo.' + grupoCodigo + '.color_acento';
    if (configsUI.has(k) && configsUI.get(k)) return configsUI.get(k);
    if (colorDefault) return colorDefault;
    return '#64748b';
}

function detectarContexto(paginaActual, todosLosModulos) {
    if (!paginaActual) return { modulo_activo: null, grupo_activo: null };
    const m = todosLosModulos.find(x => x.url === paginaActual);
    if (m) return { modulo_activo: m.codigo, grupo_activo: m.grupo };
    return { modulo_activo: null, grupo_activo: null };
}

async function obtenerArbolNavegacion({ id_empresa, rol, paginaActual = null, id_usuario = null, nombre = '', id_deposito = null }) {
    if (!id_empresa) throw new Error('id_empresa requerido');
    if (!rol)        throw new Error('rol requerido');

    // 1. Catálogo COMPLETO + habilitación por rol (F-NAV 2026-07-04):
    //    el menú se muestra SIEMPRE; lo que el rol no tiene va con
    //    habilitado=false (el frontend decide gris/candado u ocultar
    //    según ui.navbar.mostrar_deshabilitados).
    const modulosRol = await modulosHelper.obtenerModulosRol(id_empresa, rol);
    const permisos = new Map(modulosRol.map(m => [m.codigo, m]));
    const catRes = await pool.query(
        "SELECT codigo, nombre, url_frontend, icono, orden, grupo FROM modulos WHERE activo = TRUE"
    );
    const modulos = catRes.rows.map(m => {
        const perm = permisos.get(m.codigo);
        return Object.assign({}, m, {
            habilitado: !!perm,
            solo_lectura: perm ? (perm.solo_lectura || false) : false
        });
    });

    // 2. Catálogo de grupos activos
    const gruposRes = await pool.query(
        "SELECT id_grupo, codigo, nombre, icono, orden, color_default FROM modulo_grupos WHERE activo = TRUE ORDER BY orden"
    );
    const grupos = gruposRes.rows;

    // 3. Branding + tema + configs ui.* (un solo round-trip por namespace)
    const [branding, tema, configsUI] = await Promise.all([
        obtenerBranding(id_empresa),
        obtenerTema(id_empresa),
        leerConfigsConPrefijo(id_empresa, 'ui.')
    ]);

    // 4. Nombre del usuario (si no vino en el JWT) y depósito
    let nombreFinal = nombre || '';
    if (!nombreFinal && id_usuario) {
        const ur = await pool.query('SELECT nombre, username FROM usuarios WHERE id_usuario = $1', [id_usuario]);
        if (ur.rows[0]) nombreFinal = ur.rows[0].nombre || ur.rows[0].username;
    }
    let deposito_nombre = null;
    if (id_deposito) {
        const dr = await pool.query('SELECT nombre FROM depositos WHERE id_deposito = $1', [id_deposito]);
        if (dr.rows[0]) deposito_nombre = dr.rows[0].nombre;
    }

    // 5. Árbol: grupos con sus módulos filtrados por rol
    const arbol = grupos.map(g => {
        const modulosDelGrupo = modulos
            .filter(m => m.grupo === g.codigo)
            .map(m => ({
                codigo:       m.codigo,
                nombre:       m.nombre,
                url:          m.url_frontend,
                icono:        mapearIcono(m.icono),
                icono_raw:    m.icono || null,
                orden:        m.orden,
                solo_lectura: m.solo_lectura || false,
                habilitado:   m.habilitado !== false
            }))
            .sort((a, b) => (a.orden || 0) - (b.orden || 0));
        return {
            codigo:       g.codigo,
            nombre:       g.nombre,
            icono:        mapearIcono(g.icono),
            icono_raw:    g.icono,
            color_acento: resolverColorGrupo(g.codigo, configsUI, g.color_default),
            orden:        g.orden,
            modulos:      modulosDelGrupo
        };
    }).filter(g => g.modulos.length > 0);

    // 6. Contexto activo
    const todos = arbol.flatMap(g => g.modulos.map(m => ({ ...m, grupo: g.codigo })));
    const contexto = detectarContexto(paginaActual, todos);

    return {
        branding,
        tema,
        grupos: arbol,
        usuario: {
            nombre: nombreFinal,
            rol,
            id_empresa,
            id_usuario,
            id_deposito,
            deposito_nombre
        },
        contexto
    };
}

module.exports = {
    obtenerArbolNavegacion,
    obtenerBranding,
    obtenerTema,
    mapearIcono
};
