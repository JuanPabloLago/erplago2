class BuscadorClientes {
    constructor(options = {}) {
        this.options = {
            container: options.container || null,
            onSelect: options.onSelect || (() => {}),
            onClear: options.onClear || (() => {}),
            placeholder: options.placeholder || 'F3 \u00b7 Buscar cliente por nombre, CUIT o raz\u00f3n social...',
            autoFocus: options.autoFocus || false,
            nextFocus: options.nextFocus || null,
            limit: options.limit || 12,
            debounceMs: options.debounceMs || 280,
            minChars: options.minChars || 2,
            showSaldo: options.showSaldo !== false,
        };
        this._cliente = null; this._results = []; this._idx = -1; this._timer = null; this._open = false;
        this._init();
    }

    _init() {
        const container = typeof this.options.container === 'string' ? document.querySelector(this.options.container) : this.options.container;
        if (!container) { console.error('[BuscadorClientes] Container no encontrado:', this.options.container); return; }
        container.innerHTML = ''; container.setAttribute('data-buscar-cliente', '');
        this._wrapper = document.createElement('div'); this._wrapper.className = 'bc-wrapper';
        this._wrapper.innerHTML = '<div class="bc-input-group"><i class="bi bi-search bc-icon"></i><input type="text" class="bc-input" placeholder="' + this.options.placeholder + '" autocomplete="off" spellcheck="false"><span class="bc-badge" style="display:none"></span><button class="bc-clear" style="display:none" title="Limpiar (Esc)" type="button"><i class="bi bi-x-lg"></i></button></div><div class="bc-dropdown" style="display:none"><div class="bc-dropdown-hint"><span>\u2191\u2193 navegar \u00b7 Enter seleccionar \u00b7 Esc cerrar</span><span class="bc-count"></span></div><div class="bc-results"></div></div>';
        container.appendChild(this._wrapper);
        this._input = this._wrapper.querySelector('.bc-input');
        this._dropdown = this._wrapper.querySelector('.bc-dropdown');
        this._resultsList = this._wrapper.querySelector('.bc-results');
        this._badge = this._wrapper.querySelector('.bc-badge');
        this._clearBtn = this._wrapper.querySelector('.bc-clear');
        this._countEl = this._wrapper.querySelector('.bc-count');
        this._input.addEventListener('input', () => this._onInput());
        this._input.addEventListener('keydown', (e) => this._onKeydown(e));
        this._input.addEventListener('focus', () => { if (this._results.length && !this._cliente) this._show(); });
        this._clearBtn.addEventListener('click', () => this.clear());
        document.addEventListener('click', (e) => { if (!this._wrapper.contains(e.target)) this._close(); });
        if (this.options.autoFocus) setTimeout(() => this._input.focus(), 100);
    }

    _onInput() {
        const q = this._input.value.trim();
        if (this._cliente) { this._cliente = null; this._badge.style.display = 'none'; this.options.onClear(); }
        this._clearBtn.style.display = q ? 'flex' : 'none';
        if (q.length < this.options.minChars) { this._close(); return; }
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._buscar(q), this.options.debounceMs);
    }

    _onKeydown(e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); if (!this._open && this._results.length) { this._show(); return; } this._idx = Math.min(this._idx + 1, this._results.length - 1); this._highlight(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this._idx = Math.max(this._idx - 1, 0); this._highlight(); }
        else if (e.key === 'Enter') { if (this._open && this._idx >= 0 && this._results[this._idx]) { e.preventDefault(); e.stopPropagation(); this._select(this._results[this._idx]); } }
        else if (e.key === 'Tab') { if (this._open && this._idx >= 0 && this._results[this._idx]) { e.preventDefault(); this._select(this._results[this._idx]); } }
        else if (e.key === 'Escape') { if (this._open) { e.preventDefault(); e.stopPropagation(); this._close(); } }
    }

    async _buscar(q) {
        const API_BASE = window.CONFIG?.API_BASE_URL || '/api';
        const TOKEN = localStorage.getItem('authToken');
        try {
            const res = await fetch(API_BASE + '/clientes/buscar?q=' + encodeURIComponent(q) + '&limit=' + this.options.limit + '&activo=true', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            this._results = data.clientes || data || [];
            this._idx = this._results.length > 0 ? 0 : -1;
            this._render(); this._show();
        } catch (err) {
            console.error('[BuscadorClientes] Error:', err);
            this._results = [];
            this._resultsList.innerHTML = '<div class="bc-item bc-item-empty"><i class="bi bi-exclamation-triangle"></i> Error de conexi\u00f3n</div>';
            this._show();
        }
    }

    _render() {
        if (this._results.length === 0) { this._resultsList.innerHTML = '<div class="bc-item bc-item-empty"><i class="bi bi-person-x"></i> Sin resultados</div>'; this._countEl.textContent = '0'; return; }
        this._countEl.textContent = this._results.length + ' resultado' + (this._results.length !== 1 ? 's' : '');
        const self = this;
        this._resultsList.innerHTML = this._results.map(function(c, i) {
            const nombre = self._escape(c.razon_social || c.nombre || 'Sin nombre');
            const cuit = c.cuit_cuil || c.cuit || '-';
            const condicion = c.condicion_iva || c.condicion || '';
            const tel = c.telefono || '';
            const saldo = parseFloat(c.saldo_actual || c.saldo || 0);
            let saldoHtml = '';
            if (self.options.showSaldo) {
                if (saldo < -0.01) saldoHtml = '<span class="bc-saldo bc-saldo-debe">Debe: $' + Math.abs(saldo).toLocaleString('es-AR', {minimumFractionDigits: 0}) + '</span>';
                else if (saldo > 0.01) saldoHtml = '<span class="bc-saldo bc-saldo-favor">Favor: $' + saldo.toLocaleString('es-AR', {minimumFractionDigits: 0}) + '</span>';
                else saldoHtml = '<span class="bc-saldo bc-saldo-cero">Sin saldo</span>';
            }
            return '<div class="bc-item ' + (i === self._idx ? 'bc-item-active' : '') + '" data-index="' + i + '"><div class="bc-item-main"><div class="bc-item-nombre">' + nombre + '</div><div class="bc-item-detalle">CUIT: ' + cuit + (condicion ? ' \u00b7 ' + condicion : '') + (tel ? ' \u00b7 ' + tel : '') + '</div></div><div class="bc-item-saldo">' + saldoHtml + '</div></div>';
        }).join('');
        this._resultsList.querySelectorAll('.bc-item[data-index]').forEach(function(el) {
            el.addEventListener('click', function() { self._select(self._results[parseInt(el.dataset.index)]); });
            el.addEventListener('mouseenter', function() { self._idx = parseInt(el.dataset.index); self._highlight(); });
        });
    }

    _highlight() {
        this._resultsList.querySelectorAll('.bc-item').forEach(function(el, i) { el.classList.toggle('bc-item-active', i === this._idx); }.bind(this));
        const active = this._resultsList.querySelector('.bc-item-active');
        if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    _select(cliente) {
        this._cliente = cliente;
        this._input.value = cliente.razon_social || cliente.nombre || '';
        const condicion = cliente.condicion_iva || cliente.condicion || '';
        const cuit = cliente.cuit_cuil || cliente.cuit || '';
        if (condicion || cuit) { this._badge.textContent = condicion + (condicion && cuit ? ' \u00b7 ' : '') + cuit; this._badge.style.display = 'inline-flex'; }
        this._clearBtn.style.display = 'flex'; this._close();
        this.options.onSelect(cliente);
        if (this.options.nextFocus) { const next = document.querySelector(this.options.nextFocus); if (next) setTimeout(function() { next.focus(); }, 50); }
    }

    _show() { this._dropdown.style.display = 'block'; this._open = true; this._wrapper.classList.add('bc-active'); }
    _close() { this._dropdown.style.display = 'none'; this._open = false; this._wrapper.classList.remove('bc-active'); }

    focus() { if (this._input) this._input.focus(); }
    clear() { this._cliente = null; this._input.value = ''; this._badge.style.display = 'none'; this._clearBtn.style.display = 'none'; this._results = []; this._close(); this._input.focus(); this.options.onClear(); }
    getCliente() { return this._cliente; }
    getClienteId() { return this._cliente ? this._cliente.id_cliente : null; }
    setCliente(cliente) { if (!cliente) { this.clear(); return; } this._select(cliente); }
    destroy() { if (this._wrapper) this._wrapper.remove(); }
    _escape(str) { var div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
}
window.BuscadorClientes = BuscadorClientes;
