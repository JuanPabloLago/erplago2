/* ═══════════════════════════════════════════════════════════════════
 * navbar.js — Barra superior ÚNICA del ERP (F-NAV 2026-07-04)
 * Una sola fuente: /ui/navegacion (BD manda). Reemplaza en runtime los
 * navbars hardcodeados. Breadcrumb Grupo › Módulo automático.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
    if (document.getElementById('erp-topbar')) return;
    const API = window.CONFIG?.API_BASE_URL || '/api';
    const token = localStorage.getItem('erp_token') || '';
    const pagina = location.pathname.split('/').pop() || 'dashboard.html';

    // Navbars legacy que este componente reemplaza (misma lista que auth.js)
    const LEGACY = ['.navbar', '.lago-navbar', '.erp-navbar', '.vr-navbar',
                    'header.header-lago', 'header.header-bar', '.page-header'];

    fetch(API + '/ui/navegacion?pagina=/' + pagina, {
        headers: { 'Authorization': 'Bearer ' + token }, credentials: 'include'
    })
    .then(r => r.ok ? r.json() : null)
    .then(res => { if (res && res.success) pintar(res.data); })
    .catch(() => {});

    function pintar(d) {
        const b = d.branding || {}, t = (d.tema && d.tema.navbar) || {}, u = d.usuario || {};
        const color = b.color_primario || '#1a5f7a';

        // Breadcrumb desde el contexto que ya calcula el helper
        let crumb = '';
        if (t.mostrar_breadcrumb !== false && d.contexto && d.contexto.grupo_activo) {
            const g = (d.grupos || []).find(x => x.codigo === d.contexto.grupo_activo);
            const m = g && g.modulos.find(x => x.codigo === d.contexto.modulo_activo);
            if (g && m) crumb =
                '<span class="erp-crumb"><i class="' + (g.icono || '') + '"></i> ' + g.nombre +
                ' <span class="erp-crumb-sep">›</span> <strong>' + m.nombre + '</strong></span>';
        }

        // Accesos rápidos configurables (grises si el rol no los tiene)
        const codigos = String(t.accesos_rapidos || '').split(',').map(s => s.trim()).filter(Boolean);
        const todos = (d.grupos || []).flatMap(g => g.modulos);
        const rapidos = codigos.map(c => todos.find(m => m.codigo === c)).filter(Boolean).map(m =>
            m.habilitado
                ? '<a class="erp-top-link' + (m.codigo === (d.contexto || {}).modulo_activo ? ' activo' : '') + '" href="' + m.url + '">' + m.nombre + '</a>'
                : '<span class="erp-top-link deshabilitado" title="Tu rol no tiene acceso"><i class="bi bi-lock-fill"></i> ' + m.nombre + '</span>'
        ).join('');

        const nav = document.createElement('nav');
        nav.id = 'erp-topbar';
        nav.innerHTML =
            '<button class="erp-top-burger" data-bs-toggle="offcanvas" data-bs-target="#erp-menu-offcanvas" aria-label="Menú"><i class="bi bi-list"></i></button>' +
            '<a class="erp-top-brand" href="/dashboard.html">' +
                (b.logo_url ? '<img src="' + b.logo_url + '" alt="">' : '<i class="bi bi-building"></i>') +
                '<span>' + (b.nombre_corto || 'ERP') + '</span></a>' +
            crumb +
            '<div class="erp-top-links">' + rapidos + '</div>' +
            '<div class="erp-top-user">' +
                (u.deposito_nombre ? '<span class="erp-top-dep"><i class="bi bi-shop"></i> ' + u.deposito_nombre + '</span>' : '') +
                '<span class="erp-top-nombre">' + (u.nombre || '') + ' <small>(' + (u.rol || '') + ')</small></span>' +
                '<a class="erp-top-salir" href="#" onclick="typeof logout===\'function\'?logout():(localStorage.removeItem(\'erp_token\'),location.href=\'/login.html\');return false;"><i class="bi bi-box-arrow-right"></i></a>' +
            '</div>';

        const css = document.createElement('style');
        css.textContent =
            '#erp-topbar{display:flex;align-items:center;gap:14px;background:' + color + ';color:#fff;' +
              'padding:6px 14px;min-height:48px;' + (t.sticky !== false ? 'position:sticky;top:0;z-index:1040;' : '') + '}' +
            '#erp-topbar .erp-top-burger{background:transparent;border:0;color:#fff;font-size:1.4rem;line-height:1;padding:2px 6px;cursor:pointer}' +
            '#erp-topbar .erp-top-brand{display:flex;align-items:center;gap:8px;color:#fff;text-decoration:none;font-weight:700}' +
            '#erp-topbar .erp-top-brand img{max-height:30px}' +
            '#erp-topbar .erp-crumb{font-size:.9rem;opacity:.95;white-space:nowrap}' +
            '#erp-topbar .erp-crumb-sep{opacity:.6;margin:0 4px}' +
            '#erp-topbar .erp-top-links{display:flex;gap:4px;margin-left:auto}' +
            '#erp-topbar .erp-top-link{color:#fff;text-decoration:none;padding:4px 10px;border-radius:6px;font-size:.9rem;white-space:nowrap}' +
            '#erp-topbar .erp-top-link:hover{background:rgba(255,255,255,.15)}' +
            '#erp-topbar .erp-top-link.activo{background:rgba(255,255,255,.25);font-weight:600}' +
            '#erp-topbar .erp-top-link.deshabilitado{opacity:.45;cursor:not-allowed}' +
            '#erp-topbar .erp-top-user{display:flex;align-items:center;gap:12px;font-size:.85rem}' +
            '#erp-topbar .erp-top-salir{color:#fff;font-size:1.1rem}' +
            '@media print{#erp-topbar{display:none}}' +
            '@media (max-width:900px){#erp-topbar .erp-crumb,#erp-topbar .erp-top-links,#erp-topbar .erp-top-dep{display:none}}';
        document.head.appendChild(css);

        // Reemplazo en runtime — REGLA (F-NAV.3): solo se ocultan headers
        // PURAMENTE navegacionales. Un header funcional (contiene input/select/
        // textarea, ej. la barra tipo Google Drive de productos/despachos con
        // su búsqueda y acciones) SE CONSERVA, y si es sticky se lo corre
        // debajo de la topbar para que no quede tapado.
        const ALTURA_TOPBAR = 48;
        LEGACY.forEach(sel => document.querySelectorAll(sel).forEach(el => {
            if (el.closest('#erp-topbar')) return;
            const conservar = el.hasAttribute('data-erp-header') ||
                              !!el.querySelector('input, select, textarea'); // fallback DEPRECADO: migrar headers a data-erp-header
            if (conservar) {
                const cs = getComputedStyle(el);
                if (cs.position === 'sticky' || cs.position === 'fixed') {
                    el.style.top = ALTURA_TOPBAR + 'px';
                    if (parseInt(cs.zIndex) >= 1040 || cs.zIndex === 'auto') {
                        el.style.zIndex = '1030'; // header funcional debajo de la topbar
                    }
                }
                return; // header funcional: NO se oculta
            }
            el.style.display = 'none';
        }));
        document.querySelectorAll('.erp-menu-toggle, .erp-menu-toggle-fab').forEach(el => {
            if (!el.closest('#erp-topbar')) el.style.display = 'none';
        });
        document.body.insertBefore(nav, document.body.firstChild);
        // Garantia estructural: nada puede quedar tapado por la topbar.
        document.documentElement.style.setProperty('--erp-topbar-h', ALTURA_TOPBAR + 'px');
        var _tb = document.getElementById('erp-topbar');
        if (_tb && getComputedStyle(_tb).position === 'fixed' && !document.body.style.paddingTop) {
            document.body.style.paddingTop = ALTURA_TOPBAR + 'px';
        }
    }
})();
