var AtajosGlobales = (function() {
    'use strict';
    var _acciones = {}, _barraInyectada = false, _toastTimer = null;
    var ATAJOS = [
        { key: 'F2', label: 'Guardar' }, { key: 'F3', label: 'Buscar cliente' },
        { key: 'F5', label: 'Actualizar' }, { key: 'Ins', label: 'Nuevo' },
        { key: '\u2191\u2193', label: 'Navegar' }, { key: 'Enter', label: 'Seleccionar' },
        { key: 'Esc', label: 'Cerrar' }
    ];

    function _handler(e) {
        var enInput = ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(e.target.tagName) >= 0;
        var esFKey = e.key.charAt(0) === 'F' && e.key.length <= 3;
        if (enInput && !esFKey && e.key !== 'Insert' && e.key !== 'Escape' && !(e.altKey && e.key >= '1' && e.key <= '9')) return;

        if (e.key === 'F2') { e.preventDefault(); if (_acciones.guardar) _acciones.guardar(); else _toast('F2 \u00b7 Sin acci\u00f3n de guardar'); return; }
        if (e.key === 'F3') { e.preventDefault(); if (_acciones.cliente) { _acciones.cliente(); } else { var bc = document.querySelector('[data-buscar-cliente] input'); if (bc) { bc.focus(); bc.select(); } } return; }
        if (e.key === 'F5' && !e.ctrlKey) { e.preventDefault(); if (_acciones.actualizar) _acciones.actualizar(); else _toast('F5 \u00b7 Sin acci\u00f3n de actualizar'); return; }
        if (e.key === 'Insert') { e.preventDefault(); if (_acciones.nuevo) _acciones.nuevo(); else _toast('Ins \u00b7 Sin acci\u00f3n de nuevo'); return; }
        if (e.key === 'Escape' && _acciones.cerrar) { _acciones.cerrar(); return; }
        if (e.altKey && e.key >= '1' && e.key <= '9') { e.preventDefault(); var idx = parseInt(e.key) - 1; if (_acciones['tab_' + idx]) _acciones['tab_' + idx](); else if (_acciones.cambiarTab) _acciones.cambiarTab(idx); return; }
    }

    function _toast(msg) {
        var el = document.getElementById('lago-toast');
        if (!el) { el = document.createElement('div'); el.id = 'lago-toast'; el.style.cssText = 'position:fixed;bottom:48px;right:24px;background:#1a6b1a;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.25);z-index:10000;opacity:0;transform:translateY(8px);transition:opacity 0.2s,transform 0.2s;font-family:Segoe UI,sans-serif;'; document.body.appendChild(el); }
        el.textContent = msg; el.style.opacity = '1'; el.style.transform = 'translateY(0)';
        clearTimeout(_toastTimer); _toastTimer = setTimeout(function() { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 2000);
    }

    function _inyectarBarra() {
        if (_barraInyectada) return;
        var barra = document.createElement('div'); barra.className = 'lago-shortcuts-bar';
        barra.innerHTML = ATAJOS.map(function(a) { return '<div class="lago-shortcut"><kbd>' + a.key + '</kbd><span>' + a.label + '</span></div>'; }).join('');
        document.body.appendChild(barra); _barraInyectada = true;
    }

    function init() {
        document.removeEventListener('keydown', _handler); document.addEventListener('keydown', _handler);
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _inyectarBarra); else _inyectarBarra();
    }
    init();

    return {
        registrar: function(nombre, fn) { _acciones[nombre] = fn; },
        desregistrar: function(nombre) { delete _acciones[nombre]; },
        toast: _toast,
        init: init
    };
})();
window.AtajosGlobales = AtajosGlobales;
