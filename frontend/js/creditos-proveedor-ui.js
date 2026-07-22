/**
 * MÓDULO: Créditos disponibles del proveedor (saldo a favor)
 *
 * Integración con pagos-proveedores.html:
 *  - Llamadas desde pagos-proveedores.js:
 *      CreditosProveedor.cargar(id_proveedor)
 *      CreditosProveedor.limpiar()
 *      CreditosProveedor.obtenerSeleccion()   → [{id_cuenta_credito, monto, label}]
 *      CreditosProveedor.totalSeleccionado()  → number
 *      CreditosProveedor.onChange(callback)   → notifica cambios
 *
 * UI: renderiza en #seccion-saldo-favor (insertado en el HTML).
 */
(function () {
  'use strict';

  var API_BASE = (window.CONFIG && window.CONFIG.API_BASE_URL) || '/api';
  var _creditos = [];
  var _seleccion = new Map();
  var _listeners = [];

  function hdr() {
    var token = localStorage.getItem('authToken');
    return token ? { 'Authorization': 'Bearer ' + token } : {};
  }

  function fmt(n) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(parseFloat(n) || 0);
  }

  function fmtFecha(d) {
    if (!d) return '-';
    try { return new Date(d).toLocaleDateString('es-AR'); } catch (e) { return d; }
  }

  async function cargar(id_proveedor) {
    _seleccion.clear();
    if (!id_proveedor) {
      _creditos = [];
      render();
      notificar();
      return;
    }
    try {
      var res = await fetch(API_BASE + '/pagos-proveedores/creditos-disponibles/' + id_proveedor, {
        headers: hdr(), credentials: 'include'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var body = await res.json();
      var data = body.data || body;
      _creditos = data.creditos || [];
    } catch (err) {
      console.error('[CreditosProveedor] error al cargar:', err);
      _creditos = [];
    }
    render();
    notificar();
  }

  function limpiar() {
    _creditos = [];
    _seleccion.clear();
    render();
    notificar();
  }

  function render() {
    var cont = document.getElementById('seccion-saldo-favor');
    if (!cont) return;

    if (!_creditos || _creditos.length === 0) {
      cont.style.display = 'none';
      cont.innerHTML = '';
      return;
    }

    var totalDisp = _creditos.reduce(function(a, c){ return a + parseFloat(c.saldo_disponible || 0); }, 0);
    var totalSel = totalSeleccionado();

    cont.style.display = '';
    cont.innerHTML =
      '<div class="card mb-3 border-success">' +
        '<div class="card-header bg-success bg-opacity-10 d-flex justify-content-between align-items-center">' +
          '<div>' +
            '<i class="bi bi-piggy-bank-fill text-success me-2"></i>' +
            '<strong>Saldo a Favor Disponible</strong> ' +
            '<span class="badge bg-success ms-2">' + _creditos.length + ' crédito' + (_creditos.length>1?'s':'') + '</span>' +
          '</div>' +
          '<div class="text-end">' +
            '<div class="small text-muted">Total disponible</div>' +
            '<div class="fw-bold text-success">' + fmt(totalDisp) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="d-flex justify-content-between align-items-center mb-2">' +
            '<div class="small text-muted">Tildá los créditos a aplicar a las facturas seleccionadas. El monto se descuenta del total a pagar.</div>' +
            '<div>' +
              '<button type="button" class="btn btn-sm btn-outline-success me-1" id="btn-cred-aplicar-todo">Aplicar todo</button>' +
              '<button type="button" class="btn btn-sm btn-outline-secondary" id="btn-cred-limpiar">Limpiar</button>' +
            '</div>' +
          '</div>' +
          '<div class="row g-2" id="cred-cards"></div>' +
          '<div class="mt-3 p-2 bg-light rounded d-flex justify-content-between align-items-center">' +
            '<div><strong>Total seleccionado a aplicar:</strong></div>' +
            '<div class="fw-bold text-success fs-5" id="cred-total-sel">' + fmt(totalSel) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var cards = document.getElementById('cred-cards');
    _creditos.forEach(function(c) {
      var sel = _seleccion.has(c.id_cuenta_credito);
      var monto = sel ? _seleccion.get(c.id_cuenta_credito) : 0;
      var max = parseFloat(c.saldo_disponible);
      var fecha = c.fecha_pago ? fmtFecha(c.fecha_pago) : fmtFecha(c.fecha_movimiento);
      var label = c.numero_pago ? ('PAGO-' + String(c.numero_pago).padStart(8,'0')) : (c.referencia || 'Crédito #'+c.id_cuenta_credito);
      var tipoLabel = c.tipo_movimiento === 'nota_credito' ? 'Nota Crédito' : 'Pago a cuenta';

      var col = document.createElement('div');
      col.className = 'col-md-6';
      col.innerHTML =
        '<div class="border rounded p-2 ' + (sel ? 'border-success bg-success bg-opacity-10' : '') + '">' +
          '<div class="d-flex justify-content-between align-items-start">' +
            '<div class="flex-grow-1">' +
              '<input class="form-check-input me-2 cred-check" type="checkbox" ' +
                     'data-id="' + c.id_cuenta_credito + '" data-max="' + max + '" ' + (sel?'checked':'') + '>' +
              '<label class="form-check-label fw-bold">' + label + '</label>' +
              '<div class="small text-muted ms-4">' + tipoLabel + ' · ' + fecha + ' · Disponible: ' + fmt(max) + '</div>' +
            '</div>' +
            '<div style="width: 150px;">' +
              '<input type="number" class="form-control form-control-sm cred-monto text-end" ' +
                     'data-id="' + c.id_cuenta_credito + '" data-max="' + max + '" ' +
                     'min="0" max="' + max + '" step="0.01" ' +
                     'value="' + monto.toFixed(2) + '" ' + (sel?'':'disabled') + '>' +
            '</div>' +
          '</div>' +
        '</div>';
      cards.appendChild(col);
    });

    // Eventos
    cards.querySelectorAll('.cred-check').forEach(function(chk) {
      chk.addEventListener('change', function(e) {
        var id = parseInt(e.target.dataset.id);
        var max = parseFloat(e.target.dataset.max);
        var inp = cards.querySelector('.cred-monto[data-id="' + id + '"]');
        if (e.target.checked) {
          _seleccion.set(id, max);
          inp.value = max.toFixed(2);
          inp.disabled = false;
        } else {
          _seleccion.delete(id);
          inp.value = '0.00';
          inp.disabled = true;
        }
        render();
        notificar();
      });
    });
    cards.querySelectorAll('.cred-monto').forEach(function(inp) {
      inp.addEventListener('input', function(e) {
        var id = parseInt(e.target.dataset.id);
        var max = parseFloat(e.target.dataset.max);
        var v = parseFloat(e.target.value) || 0;
        if (v < 0) v = 0;
        if (v > max) { v = max; e.target.value = max.toFixed(2); }
        if (v > 0) _seleccion.set(id, v);
        else _seleccion.delete(id);
        var t = document.getElementById('cred-total-sel');
        if (t) t.textContent = fmt(totalSeleccionado());
        notificar();
      });
    });

    var btnApl = document.getElementById('btn-cred-aplicar-todo');
    if (btnApl) btnApl.addEventListener('click', function() {
      _creditos.forEach(function(c) { _seleccion.set(c.id_cuenta_credito, parseFloat(c.saldo_disponible)); });
      render(); notificar();
    });
    var btnLim = document.getElementById('btn-cred-limpiar');
    if (btnLim) btnLim.addEventListener('click', function() {
      _seleccion.clear();
      render(); notificar();
    });
  }

  function totalSeleccionado() {
    var t = 0;
    _seleccion.forEach(function(v){ t += v; });
    return t;
  }

  function obtenerSeleccion() {
    var out = [];
    _seleccion.forEach(function(monto, id_cuenta_credito) {
      var c = _creditos.find(function(x){ return x.id_cuenta_credito === id_cuenta_credito; });
      out.push({
        id_cuenta_credito: id_cuenta_credito,
        monto: monto,
        label: c ? (c.numero_pago ? ('PAGO-' + String(c.numero_pago).padStart(8,'0')) : c.referencia) : ''
      });
    });
    return out;
  }

  function onChange(cb) { _listeners.push(cb); }

  function notificar() {
    var data = { total: totalSeleccionado(), seleccion: obtenerSeleccion(), cantidad_disponibles: _creditos.length };
    _listeners.forEach(function(cb){ try { cb(data); } catch (e) { console.error(e); } });
  }

  window.CreditosProveedor = {
    cargar: cargar,
    limpiar: limpiar,
    obtenerSeleccion: obtenerSeleccion,
    totalSeleccionado: totalSeleccionado,
    onChange: onChange,
    get cantidadDisponible() { return _creditos.length; }
  };
})();
