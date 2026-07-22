/**
 * auth.js v3.0 - Autenticación + Control de Acceso + Menú Offcanvas Auto-inyectado
 * Ubicación: /root/mi_erp/frontend/js/auth.js
 *
 * v3: Menú offcanvas se inyecta AUTOMÁTICAMENTE en la navbar existente.
 *     Cero cambios en los HTML individuales.
 *     Grupos y módulos desde BD. Solo muestra los del usuario.
 */

// ═══════════════════════════════════════════════════════════════════════════
// MAPEO FA → Bootstrap Icons (los grupos en BD usan fa-*, el frontend usa bi-*)
// ═══════════════════════════════════════════════════════════════════════════
const ICONO_MAP = {
    'fa-cash-register': 'bi-cart3',
    'fa-truck': 'bi-truck',
    'fa-warehouse': 'bi-box-seam',
    'fa-cart-shopping': 'bi-bag',
    'fa-users': 'bi-people',
    'fa-vault': 'bi-safe',
    'fa-chart-bar': 'bi-bar-chart',
    'fa-gears': 'bi-gear',
    'fa-folder': 'bi-folder',
    // Iconos de módulos individuales
    'fa-cash-register': 'bi-cart3',
    'fa-file-lines': 'bi-file-text',
    'fa-file-invoice-dollar': 'bi-receipt',
    'fa-clipboard-list': 'bi-clipboard-check',
    'fa-boxes-stacked': 'bi-box-seam',
    'fa-tags': 'bi-tags',
    'fa-bookmark': 'bi-bookmark',
    'fa-sliders': 'bi-sliders',
    'fa-money-bill-wave': 'bi-cash-stack',
    'fa-tachometer-alt': 'bi-speedometer2',
    'fa-book': 'bi-journal-text',
    'fa-user-shield': 'bi-person-lock',
    'fa-database': 'bi-database',
    'fa-list': 'bi-list-ul',
    'fa-truck': 'bi-truck',
};

function mapearIcono(faIcon) {
    return ICONO_MAP[faIcon] || 'bi-circle';
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE AUTENTICACIÓN + MÓDULOS
// ═══════════════════════════════════════════════════════════════════════════

async function verificarAutenticacion() {
    const token = localStorage.getItem('authToken');

    if (!token) {
        window.location.href = '/login.html';
        return false;
    }

    try {
        const API_BASE = window.CONFIG?.API_BASE_URL || '/api';
        const resp = await fetch(`${API_BASE}/auth/perfil`, {
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include'
        });

        if (!resp.ok) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
            window.location.href = '/login.html';
            return false;
        }

        const perfil = await resp.json();

        localStorage.setItem('username', perfil.nombre || perfil.username);

        const userInfo = document.getElementById('userInfo');
        if (userInfo) {
            userInfo.textContent = perfil.nombre || perfil.username;
        }

        if (perfil.modulos) {
            sessionStorage.setItem('modulos_permitidos', JSON.stringify(perfil.modulos));
            sessionStorage.setItem('usuario_rol', perfil.rol);

            if (perfil.grupos) {
                sessionStorage.setItem('modulo_grupos', JSON.stringify(perfil.grupos));
            }

            const paginaActual = window.location.pathname;
            const tieneAcceso = verificarAccesoPagina(perfil.modulos, paginaActual);

            if (!tieneAcceso) {
                const primerModulo = perfil.modulos[0];
                if (primerModulo) {
                    const nombrePagina = paginaActual.replace('/', '').replace('.html', '');
                    mostrarAccesoDenegado(nombrePagina, primerModulo.url_frontend);
                } else {
                    mostrarSinModulos();
                }
                return false;
            }

            // Inyectar menú offcanvas automáticamente
            inyectarMenuOffcanvas(perfil.modulos, perfil.grupos || [], paginaActual, perfil);

            // F-NAV: barra superior centralizada (una sola fuente, mata navbars hardcodeados)
            if (!document.getElementById('erp-topbar-script')) {
                const _tb = document.createElement('script');
                _tb.id = 'erp-topbar-script';
                _tb.src = '/js/navbar.js';
                document.body.appendChild(_tb);
            }

            aplicarSoloLectura(perfil.modulos, paginaActual);
        }

        return perfil;

    } catch (error) {
        console.error('Error verificando autenticación:', error);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAJES DE ACCESO
// ═══════════════════════════════════════════════════════════════════════════

function mostrarAccesoDenegado(nombrePagina, urlRedireccion) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);z-index:99999;font-family:Arial';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:40px;text-align:center;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
            <i class="bi bi-shield-x" style="font-size:48px;color:#dc3545"></i>
            <h3 style="margin:12px 0 8px;color:#333">Acceso denegado</h3>
            <p style="color:#666;margin:0 0 20px">No tenés permiso para acceder a <strong>${nombrePagina}</strong>.<br>Redirigiendo...</p>
            <div style="width:100%;height:4px;background:#e9ecef;border-radius:2px;overflow:hidden">
                <div style="width:0%;height:100%;background:#0d6efd;border-radius:2px;transition:width 1.5s linear" id="redirect-bar"></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => document.getElementById('redirect-bar').style.width = '100%');
    setTimeout(() => { window.location.href = urlRedireccion; }, 1800);
}

function mostrarSinModulos() {
    document.body.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100vh;
                    font-family:Arial;color:#666;flex-direction:column;background:#f8f9fa">
            <i class="bi bi-lock" style="font-size:48px;margin-bottom:20px;color:#dc3545"></i>
            <h2>Sin acceso</h2>
            <p>Tu usuario no tiene módulos asignados. Contactá al administrador.</p>
            <button onclick="logout()" class="btn btn-outline-secondary mt-3">Cerrar sesión</button>
        </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE ACCESO
// ═══════════════════════════════════════════════════════════════════════════

function verificarAccesoPagina(modulos, paginaActual) {
    const paginasLibres = ['/index.html', '/login.html', '/ver-pedido-publico.html',
                           '/vista-previa.html', '/ver-pedido.html', '/'];
    if (paginasLibres.includes(paginaActual)) return true;
    return modulos.some(m => m.url_frontend === paginaActual);
}

// ═══════════════════════════════════════════════════════════════════════════
// SOLO LECTURA
// ═══════════════════════════════════════════════════════════════════════════

function aplicarSoloLectura(modulos, paginaActual) {
    const modulo = modulos.find(m => m.url_frontend === paginaActual);
    if (!modulo || !modulo.solo_lectura) return;

    document.body.classList.add('modulo-solo-lectura');

    const deshabilitar = () => {
        const selectores = [
            '[data-accion="crear"]', '[data-accion="editar"]', '[data-accion="eliminar"]',
            '[data-accion="guardar"]', '[data-accion="anular"]',
            '.btn-crear', '.btn-nuevo', '.btn-guardar', '.btn-eliminar', '.btn-anular',
            '#btnCrear', '#btnNuevo', '#btnGuardar', '#btnEliminar', '#btnAnular'
        ];
        document.querySelectorAll(selectores.join(', ')).forEach(btn => {
            btn.disabled = true;
            btn.title = '🔒 Solo lectura';
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', deshabilitar);
    } else {
        deshabilitar();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MENÚ OFFCANVAS AUTO-INYECTADO
// ═══════════════════════════════════════════════════════════════════════════

function inyectarFavicon(url) {
    if (!url) return;
    // Remover favicon existente si hay
    const existente = document.querySelector('link[rel="icon"]');
    if (existente) existente.remove();
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = url.endsWith('.svg') ? 'image/svg+xml' : 'image/x-icon';
    link.href = url;
    document.head.appendChild(link);
}

function inyectarMenuOffcanvas(modulos, grupos, paginaActual, perfil) {
    // Si ya se inyectó (por doble llamada), no repetir
    if (document.getElementById('erp-menu-offcanvas')) return;

    // ─── 0. INYECTAR FAVICON DINÁMICO ───
    inyectarFavicon(perfil.favicon_url);

    // ─── 1. INYECTAR ESTILOS ───
    inyectarEstilosMenu();

    // ─── 2. INYECTAR BOTÓN HAMBURGUESA EN LA NAVBAR ───
    inyectarBotonMenu();

    // ─── 3. CREAR OFFCANVAS ───
    const offcanvas = document.createElement('div');
    offcanvas.className = 'offcanvas offcanvas-start erp-offcanvas';
    offcanvas.id = 'erp-menu-offcanvas';
    offcanvas.setAttribute('tabindex', '-1');

    // ─── 4. HEADER DEL OFFCANVAS ───
    const headerHTML = `
        <div class="offcanvas-header erp-menu-header">
            <div class="erp-menu-user">
                <div class="erp-menu-avatar">${(perfil.nombre || 'U').charAt(0).toUpperCase()}</div>
                <div class="erp-menu-user-info">
                    <div class="erp-menu-username">${perfil.nombre || perfil.username}</div>
                    <div class="erp-menu-role">${perfil.rol}</div>
                </div>
            </div>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas"></button>
        </div>`;

    // ─── 5. BODY CON MÓDULOS AGRUPADOS ───
    const gruposMap = {};
    grupos.forEach(g => { gruposMap[g.codigo] = g; });

    const modulosPorGrupo = {};
    modulos.forEach(m => {
        if (!modulosPorGrupo[m.grupo]) modulosPorGrupo[m.grupo] = [];
        modulosPorGrupo[m.grupo].push(m);
    });

    const gruposOrdenados = Object.keys(modulosPorGrupo).sort((a, b) => {
        return (gruposMap[a]?.orden || 99) - (gruposMap[b]?.orden || 99);
    });

    let menuHTML = '';
    for (const codigoGrupo of gruposOrdenados) {
        const items = modulosPorGrupo[codigoGrupo];
        const config = gruposMap[codigoGrupo] || { nombre: codigoGrupo, icono: 'fa-folder' };
        const iconoGrupo = mapearIcono(config.icono);

        menuHTML += `<div class="erp-menu-grupo">
            <div class="erp-menu-grupo-titulo">
                <i class="bi ${iconoGrupo}"></i> ${config.nombre}
            </div>`;

        for (const m of items) {
            const activo = m.url_frontend === paginaActual ? 'erp-menu-item-activo' : '';
            const iconoMod = mapearIcono(m.icono);
            const soloLectura = m.solo_lectura ? '<span class="erp-badge-ro" title="Solo lectura">🔒</span>' : '';

            menuHTML += `<a href="${m.url_frontend}" class="erp-menu-item ${activo}">
                <i class="bi ${iconoMod}"></i>
                <span>${m.nombre}</span>
                ${soloLectura}
            </a>`;
        }

        menuHTML += `</div>`;
    }

    // ─── 6. FOOTER CON LOGOUT ───
    const footerHTML = `
        <div class="erp-menu-footer">
            <button onclick="logout()" class="erp-menu-logout">
                <i class="bi bi-box-arrow-left"></i> Cerrar sesión
            </button>
        </div>`;

    offcanvas.innerHTML = `
        ${headerHTML}
        <div class="offcanvas-body erp-menu-body">
            ${menuHTML}
        </div>
        ${footerHTML}`;

    document.body.appendChild(offcanvas);
}

/**
 * Inyecta el botón hamburguesa en la navbar existente
 */
function inyectarBotonMenu() {
    // Selectores de header/navbar reconocidos en el ERP (orden de prioridad)
    const SELECTORES_NAVBAR = [
        '.navbar .container-fluid',  // Bootstrap navbar estándar (mayoría)
        '.lago-navbar',              // compras, inventario, importacion-precios
        '.erp-navbar',               // historial-movimientos
        '.vr-navbar',                // venta-rapida
        'header.header-lago',        // categorias, productos
        'header.header-bar',         // tesoreria
        '.page-header'               // gestion-despachos
    ];
    let target = null;
    for (const sel of SELECTORES_NAVBAR) {
        target = document.querySelector(sel);
        if (target) break;
    }

    // Crear botón hamburguesa
    const btn = document.createElement('button');
    btn.className = 'erp-menu-toggle';
    btn.setAttribute('data-bs-toggle', 'offcanvas');
    btn.setAttribute('data-bs-target', '#erp-menu-offcanvas');
    btn.setAttribute('aria-label', 'Menú');
    btn.innerHTML = '<i class="bi bi-list"></i>';

    if (target) {
        // Insertar como primer hijo del header/navbar encontrado
        target.insertBefore(btn, target.firstChild);
    } else {
        // Fallback: FAB fijo (HTMLs sin header reconocido)
        btn.classList.add('erp-menu-toggle-fab');
        document.body.appendChild(btn);
    }
}

/**
 * Inyecta los estilos CSS del menú
 */
function inyectarEstilosMenu() {
    if (document.getElementById('erp-menu-styles')) return;

    const style = document.createElement('style');
    style.id = 'erp-menu-styles';
    style.textContent = `
        /* ─── BOTÓN HAMBURGUESA ─── */
        .erp-menu-toggle {
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.25);
            color: #fff;
            width: 38px;
            height: 38px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            cursor: pointer;
            margin-right: 12px;
            transition: all 0.2s;
            flex-shrink: 0;
        }
        .erp-menu-toggle:hover {
            background: rgba(255,255,255,0.25);
            transform: scale(1.05);
        }

        /* FAB: aparece cuando no hay header/navbar reconocido */
        .erp-menu-toggle-fab {
            position: fixed;
            top: 10px;
            left: 10px;
            z-index: 1050;
            margin-right: 0 !important;
            background: #1a5f7a;
            border-color: #0d3b4f;
            box-shadow: 0 2px 12px rgba(0,0,0,0.25);
        }
        .erp-menu-toggle-fab:hover {
            background: #0d3b4f;
            transform: scale(1.08);
        }

        /* ─── OFFCANVAS ─── */
        .erp-offcanvas {
            width: 280px !important;
            border-right: none !important;
            background: #1a1d23 !important;
        }

        /* ─── HEADER ─── */
        .erp-menu-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px 16px !important;
            border-bottom: none !important;
        }
        .erp-menu-user {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .erp-menu-avatar {
            width: 42px;
            height: 42px;
            border-radius: 50%;
            background: rgba(255,255,255,0.2);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: 700;
            border: 2px solid rgba(255,255,255,0.3);
        }
        .erp-menu-username {
            color: #fff;
            font-weight: 600;
            font-size: 15px;
            line-height: 1.2;
        }
        .erp-menu-role {
            color: rgba(255,255,255,0.7);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        /* ─── BODY ─── */
        .erp-menu-body {
            padding: 12px 0 !important;
            overflow-y: auto;
        }

        /* ─── GRUPOS ─── */
        .erp-menu-grupo {
            margin-bottom: 4px;
        }
        .erp-menu-grupo-titulo {
            color: #8b8fa3;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 12px 20px 6px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .erp-menu-grupo-titulo i {
            font-size: 13px;
        }

        /* ─── ITEMS ─── */
        .erp-menu-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 9px 20px 9px 28px;
            color: #c4c7d0;
            text-decoration: none;
            font-size: 14px;
            transition: all 0.15s;
            border-left: 3px solid transparent;
        }
        .erp-menu-item:hover {
            background: rgba(255,255,255,0.05);
            color: #fff;
            border-left-color: rgba(102,126,234,0.5);
        }
        .erp-menu-item i {
            font-size: 16px;
            width: 20px;
            text-align: center;
            flex-shrink: 0;
        }
        .erp-menu-item span {
            flex: 1;
        }

        /* ─── ITEM ACTIVO ─── */
        .erp-menu-item-activo {
            background: rgba(102,126,234,0.15) !important;
            color: #fff !important;
            border-left-color: #667eea !important;
            font-weight: 500;
        }

        /* ─── BADGE SOLO LECTURA ─── */
        .erp-badge-ro {
            font-size: 12px;
            opacity: 0.7;
        }

        /* ─── FOOTER ─── */
        .erp-menu-footer {
            padding: 12px 16px;
            border-top: 1px solid rgba(255,255,255,0.08);
            background: #15171c;
        }
        .erp-menu-logout {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 10px 12px;
            background: rgba(220,53,69,0.1);
            border: 1px solid rgba(220,53,69,0.2);
            color: #e57373;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
        }
        .erp-menu-logout:hover {
            background: rgba(220,53,69,0.2);
            color: #ff6b6b;
        }
    `;
    document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES UTILITARIAS PÚBLICAS
// ═══════════════════════════════════════════════════════════════════════════

function obtenerModulosUsuario() {
    const datos = sessionStorage.getItem('modulos_permitidos');
    return datos ? JSON.parse(datos) : [];
}

function tieneAccesoAModulo(codigoModulo) {
    const modulos = obtenerModulosUsuario();
    return modulos.some(m => m.codigo === codigoModulo);
}

function esSoloLectura(codigoModulo) {
    const modulos = obtenerModulosUsuario();
    const modulo = modulos.find(m => m.codigo === codigoModulo);
    return modulo ? modulo.solo_lectura : true;
}

// Mantener compatibilidad con páginas que tengan sidebar-menu
function renderizarMenu(modulos, grupos, paginaActual) {
    const contenedor = document.getElementById('sidebar-menu');
    if (contenedor) {
        const gruposMap = {};
        grupos.forEach(g => { gruposMap[g.codigo] = g; });
        const modulosPorGrupo = {};
        modulos.forEach(m => {
            if (!modulosPorGrupo[m.grupo]) modulosPorGrupo[m.grupo] = [];
            modulosPorGrupo[m.grupo].push(m);
        });
        const gruposOrdenados = Object.keys(modulosPorGrupo).sort((a, b) => {
            return (gruposMap[a]?.orden || 99) - (gruposMap[b]?.orden || 99);
        });
        let html = '';
        for (const cg of gruposOrdenados) {
            const items = modulosPorGrupo[cg];
            const cfg = gruposMap[cg] || { nombre: cg, icono: 'fa-folder' };
            html += `<div class="menu-grupo"><div class="menu-grupo-titulo"><i class="bi ${mapearIcono(cfg.icono)}"></i> ${cfg.nombre}</div>`;
            for (const m of items) {
                const activo = m.url_frontend === paginaActual ? 'active' : '';
                html += `<a href="${m.url_frontend}" class="menu-item ${activo}"><i class="bi ${mapearIcono(m.icono)}"></i><span>${m.nombre}</span></a>`;
            }
            html += `</div>`;
        }
        contenedor.innerHTML = html;
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════════════════════

async function logout() {
    try {
        const token = localStorage.getItem('authToken');
        const API_BASE = window.CONFIG?.API_BASE_URL || '/api';
        await fetch(`${API_BASE}/auth/logout`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            credentials: 'include'
        });
    } catch (e) { /* limpiar igual */ }
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    sessionStorage.removeItem('modulos_permitidos');
    sessionStorage.removeItem('modulo_grupos');
    sessionStorage.removeItem('usuario_rol');
    window.location.href = '/login.html';
}

console.log('auth.js v3.0 cargado (menú offcanvas auto-inyectado)');

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-EJECUCIÓN: Verificar autenticación al cargar la página
// ═══════════════════════════════════════════════════════════════════════════
// Auto-ejecucion: inyectar menu si hay token, sin redirect agresivo
(function() {
    const pagina = window.location.pathname;
    const paginasSinAuth = ['/login.html', '/ver-pedido-publico.html'];
    if (paginasSinAuth.includes(pagina)) return;

    // Solo ejecutar si hay token en localStorage (el server-side ya protege los HTML)
    const token = localStorage.getItem('authToken');
    if (token) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => verificarAutenticacion());
        } else {
            verificarAutenticacion();
        }
    }
})();


/* notif-badge auto-loader */
(function loadNotifBadge() {
    if (document.querySelector('script[data-notif-badge]')) return;
    const s = document.createElement('script');
    s.src = '/js/notif-badge.js';
    s.dataset.notifBadge = '1';
    s.async = true;
    document.head.appendChild(s);
})();
