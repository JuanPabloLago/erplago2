/**
 * NOTIF BADGE — Componente de notificaciones in-app (ERP LAGO)
 *
 * Self-contained. Se carga desde auth.js. Auto-init si el rol del usuario
 * coincide con notificaciones.dashboard.roles_visibles.
 *
 * Endpoints consumidos:
 *   GET  /api/notificaciones-dashboard?incluir_leidas=false&limit=N
 *   POST /api/notificaciones-dashboard/:id/leida
 *   POST /api/notificaciones-dashboard/leer-todo
 *
 * Configs (leídas via /api/configuraciones, con defaults si la red falla):
 *   notificaciones.dashboard.polling_segundos_activo       (default 60)
 *   notificaciones.dashboard.polling_segundos_background   (default 300)
 *   notificaciones.dashboard.limite_items_dropdown         (default 10)
 *   notificaciones.dashboard.roles_visibles                (default ["admin"])
 */
(function () {
    'use strict';

    // ─── Defaults (se sobreescriben con configs de empresa al cargar) ───
    let CFG = {
        polling_activo_ms: 60000,
        polling_bg_ms:     300000,
        limite_items:      10,
        roles_visibles:    ['admin']
    };

    let pollTimer = null;
    let mounted   = false;

    // ─── Helpers ────────────────────────────────────────────────────────
    function getToken() { return localStorage.getItem('authToken'); }

    function apiBase() {
        return (window.CONFIG && window.CONFIG.API_BASE_URL) || '/api';
    }

    function decodeJwtPayload(token) {
        if (!token) return null;
        try {
            const part = token.split('.')[1];
            const b64  = part.replace(/-/g, '+').replace(/_/g, '/');
            const pad  = b64 + '==='.slice((b64.length + 3) % 4);
            const json = decodeURIComponent(
                atob(pad).split('').map(c =>
                    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                ).join('')
            );
            return JSON.parse(json);
        } catch (_) { return null; }
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = (s == null ? '' : String(s));
        return d.innerHTML;
    }

    function tiempoRelativo(fechaIso) {
        if (!fechaIso) return '';
        const d = new Date(fechaIso);
        const diffSeg = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
        if (diffSeg < 60)    return 'hace ' + diffSeg + 's';
        if (diffSeg < 3600)  return 'hace ' + Math.floor(diffSeg / 60) + ' min';
        if (diffSeg < 86400) return 'hace ' + Math.floor(diffSeg / 3600) + ' h';
        return 'hace ' + Math.floor(diffSeg / 86400) + ' días';
    }

    function iconoPorNivel(nivel) {
        return ({ info: '🔔', warning: '⚠️', critical: '🚨' })[nivel] || '🔔';
    }

    // ─── Red ────────────────────────────────────────────────────────────
    async function apiGet(path) {
        try {
            const r = await fetch(apiBase() + path, {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (r.status === 401) { stopPolling(); return null; }
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    }

    async function apiPost(path) {
        try {
            const r = await fetch(apiBase() + path, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            if (r.status === 401) { stopPolling(); return null; }
            if (!r.ok) return null;
            return await r.json();
        } catch (_) { return null; }
    }

    async function cargarConfigs() {
        // /api/configuraciones devuelve un objeto plano clave→valor (o lista,
        // según implementación). Hacemos lookup defensivo: si falla la red,
        // quedamos con los defaults.
        const data = await apiGet('/configuraciones/todas');
        if (!data) return;

        // Acepta dos formas posibles de respuesta sin asumir cuál es.
        const read = (clave) => {
            if (Array.isArray(data)) {
                const f = data.find(x => x.clave === clave);
                return f ? f.valor : null;
            }
            if (data && typeof data === 'object') return data[clave];
            return null;
        };

        const ms = (k, def) => {
            const v = read(k);
            const n = parseInt(v, 10);
            return (Number.isFinite(n) && n > 0) ? n * 1000 : def;
        };

        CFG.polling_activo_ms = ms('notificaciones.dashboard.polling_segundos_activo',     CFG.polling_activo_ms);
        CFG.polling_bg_ms     = ms('notificaciones.dashboard.polling_segundos_background', CFG.polling_bg_ms);

        const lim = parseInt(read('notificaciones.dashboard.limite_items_dropdown'), 10);
        if (Number.isFinite(lim) && lim > 0) CFG.limite_items = lim;

        const rolesRaw = read('notificaciones.dashboard.roles_visibles');
        if (rolesRaw) {
            try {
                const arr = (typeof rolesRaw === 'string') ? JSON.parse(rolesRaw) : rolesRaw;
                if (Array.isArray(arr) && arr.length > 0) CFG.roles_visibles = arr;
            } catch (_) { /* keep default */ }
        }
    }

    // ─── DOM ────────────────────────────────────────────────────────────
    function inyectarHTML() {
        if (document.getElementById('notif-badge-root')) return true;

        // Anclar al primer .container-fluid dentro del primer .navbar.
        // Si no hay container-fluid, al navbar mismo. Si no hay navbar,
        // fall back a position-fixed flotante.
        const navbar = document.querySelector('.navbar');
        let host = null;
        let fixed = false;
        if (navbar) {
            host = navbar.querySelector('.container-fluid, .container') || navbar;
        } else {
            host = document.body;
            fixed = true;
        }

        const wrapper = document.createElement('div');
        wrapper.id = 'notif-badge-root';
        wrapper.className = 'dropdown' + (fixed ? '' : ' ms-auto me-2');
        if (fixed) {
            wrapper.style.position = 'fixed';
            wrapper.style.top      = '10px';
            wrapper.style.right    = '60px';
            wrapper.style.zIndex   = '1041';
        }
        wrapper.innerHTML = `
            <button class="btn btn-outline-light btn-sm position-relative"
                    id="notif-badge-btn"
                    type="button"
                    data-bs-toggle="dropdown"
                    data-bs-auto-close="outside"
                    aria-expanded="false"
                    title="Notificaciones">
                🔔
                <span id="notif-badge-counter"
                      class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger d-none">
                    0
                </span>
            </button>
            <ul class="dropdown-menu dropdown-menu-end shadow"
                aria-labelledby="notif-badge-btn"
                style="min-width: 360px; max-width: 92vw; max-height: 70vh; overflow-y: auto;">
                <li class="dropdown-header d-flex justify-content-between align-items-center">
                    <strong>Notificaciones</strong>
                    <button class="btn btn-sm btn-link p-0" id="notif-badge-mark-all" type="button">
                        Marcar todas leídas
                    </button>
                </li>
                <li><hr class="dropdown-divider"></li>
                <li id="notif-badge-empty" class="dropdown-item text-muted text-center small">
                    Sin notificaciones nuevas
                </li>
                <li id="notif-badge-list" style="list-style:none; padding:0; margin:0;"></li>
            </ul>
        `;
        host.appendChild(wrapper);

        document.getElementById('notif-badge-mark-all')
            .addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await apiPost('/notificaciones-dashboard/leer-todo');
                await refresh();
            });

        return true;
    }

    function renderItems(items) {
        const list  = document.getElementById('notif-badge-list');
        const empty = document.getElementById('notif-badge-empty');
        if (!list || !empty) return;

        if (!items || items.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('d-none');
            return;
        }
        empty.classList.add('d-none');

        list.innerHTML = items.map(it => `
            <a href="#"
               class="dropdown-item d-flex align-items-start py-2 notif-item ${it.leida ? '' : 'fw-semibold bg-light'}"
               data-id="${it.id_notif_dash}"
               data-link="${escapeHtml(it.link || '')}"
               style="white-space: normal;">
                <span class="me-2 fs-5">${iconoPorNivel(it.nivel)}</span>
                <div class="flex-grow-1">
                    <div class="small">${escapeHtml(it.titulo || '')}</div>
                    <div class="text-muted small">${escapeHtml(it.mensaje || '')}</div>
                    <div class="text-muted" style="font-size: 0.72rem;">
                        ${tiempoRelativo(it.fecha_creacion)}
                    </div>
                </div>
            </a>
        `).join('');

        list.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                const id   = parseInt(el.dataset.id, 10);
                const link = el.dataset.link;
                if (id) await apiPost('/notificaciones-dashboard/' + id + '/leida');
                await refresh();
                if (link) window.location.href = link;
            });
        });
    }

    function updateCounter(n) {
        const c = document.getElementById('notif-badge-counter');
        if (!c) return;
        if (n > 0) {
            c.textContent = n > 99 ? '99+' : String(n);
            c.classList.remove('d-none');
        } else {
            c.classList.add('d-none');
        }
    }

    // ─── Ciclo ──────────────────────────────────────────────────────────
    async function refresh() {
        const data = await apiGet(
            '/notificaciones-dashboard?incluir_leidas=false&limit=' + CFG.limite_items
        );
        if (!data) return;
        updateCounter(data.no_leidas_total);
        renderItems(data.items);
    }

    function startPolling() {
        if (pollTimer) clearInterval(pollTimer);
        const ms = document.hidden ? CFG.polling_bg_ms : CFG.polling_activo_ms;
        pollTimer = setInterval(refresh, ms);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function debeMostrarBadge() {
        const payload = decodeJwtPayload(getToken());
        if (!payload || !payload.rol) return false;
        const rolJwt = String(payload.rol || '').toLowerCase();
        const rolesNorm = CFG.roles_visibles.map(r => String(r).toLowerCase());
        return rolesNorm.indexOf(rolJwt) !== -1;
    }

    async function init() {
        if (mounted) return;
        if (!getToken()) return;

        await cargarConfigs();
        if (!debeMostrarBadge()) return;

        if (!inyectarHTML()) return;
        mounted = true;

        await refresh();
        startPolling();

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refresh();
            startPolling();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 150));
    } else {
        setTimeout(init, 150);
    }
})();
