'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════
 * modal-historial-producto.js — Modal reutilizable de linea de tiempo
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Plug & play. Cualquier pagina que cargue este script obtiene:
 *   window.HistorialProducto.abrir(idProducto, sku, nombreProducto)
 *
 * Auto-inyecta su HTML al body al cargar.
 * Auto-detecta credenciales (cookie httpOnly o headers globales).
 * Bootstrap 5 nativo, sin jQuery.
 *
 * Creado: 2026-05-04 (Fase 1 trazabilidad)
 * ═══════════════════════════════════════════════════════════════════════
 */

(function () {
    if (window.HistorialProducto) return; // idempotente

    // Normaliza: si API_BASE_URL ya termina en /api (caso comun en este ERP),
    // lo strippeamos para no duplicar /api/api/. Tambien soporta base vacia.
    const _RAW_BASE = (window.CONFIG && window.CONFIG.API_BASE_URL) || '';
    const API_BASE = _RAW_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '');
    const ENDPOINT = API_BASE + '/api/historial-producto';

    const RANGOS = {
        hoy:    () => { const h=new Date(), d=new Date(h); return [_iso(d), _iso(h)]; },
        ayer:   () => { const a=new Date(); a.setDate(a.getDate()-1); return [_iso(a), _iso(a)]; },
        semana: () => { const a=new Date(); a.setDate(a.getDate()-7); return [_iso(a), _iso(new Date())]; },
        mes:    () => { const a=new Date(); a.setDate(a.getDate()-30); return [_iso(a), _iso(new Date())]; },
        anio:   () => { const a=new Date(); a.setDate(a.getDate()-365); return [_iso(a), _iso(new Date())]; },
        todo:   () => [null, null]
    };

    function _iso(d) {
        return d.toISOString().slice(0, 10);
    }

    function _fmtAR(n, dec = 2) {
        if (n === null || n === undefined || isNaN(n)) return '—';
        return Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }

    function _fmtFecha(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function _getHeaders() {
        // Preferencia 1: window.headers global (patron usado en otros modulos)
        if (window.headers) return window.headers;
        // Preferencia 2: token en localStorage
        const tk = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (tk) return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk };
        // Fallback: cookie httpOnly
        return { 'Content-Type': 'application/json' };
    }

    function _badgeTipo(tipo) {
        const colores = {
            VENTA: 'success', ENTREGA: 'success', ENTREGA_PARCIAL: 'success',
            COMPRA: 'primary', DEVOLUCION_COMPRA: 'warning',
            ANULACION: 'secondary', ANULACION_AJUSTE: 'secondary',
            DEVOLUCION: 'warning', DEVOLUCION_CLIENTE: 'warning',
            AJUSTE_INVENTARIO: 'info', AJUSTE_RAPIDO: 'info', AJUSTE_MANUAL: 'info',
            DESPACHO: 'success',
            TRANSFERENCIA_SALIDA: 'dark', TRANSFERENCIA_ENTRADA: 'dark',
            INICIAL: 'light text-dark', EGRESO_NOTA_DEBITO: 'warning'
        };
        const color = colores[tipo] || 'secondary';
        return '<span class="badge bg-' + color + '">' + tipo + '</span>';
    }

    function _renderHTML() {
        if (document.getElementById('modalHistorialProducto')) return;
        const html = `
<div class="modal fade" id="modalHistorialProducto" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-xl modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">
          <i class="bi bi-clock-history"></i> Historial de Movimientos
          <small class="text-muted ms-2" id="hpProductoNombre"></small>
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button>
      </div>
      <div class="modal-body">

        <div class="d-flex gap-2 mb-2 flex-wrap" id="hpFiltrosRapidos">
          <button class="btn btn-sm btn-outline-primary" data-rango="hoy">Hoy</button>
          <button class="btn btn-sm btn-outline-primary" data-rango="ayer">Ayer</button>
          <button class="btn btn-sm btn-outline-primary" data-rango="semana">Semana</button>
          <button class="btn btn-sm btn-outline-primary active" data-rango="mes">Mes (30d)</button>
          <button class="btn btn-sm btn-outline-primary" data-rango="anio">Año</button>
          <button class="btn btn-sm btn-outline-primary" data-rango="todo">Todo</button>
          <button class="btn btn-sm btn-outline-secondary" data-rango="custom">Personalizado</button>
        </div>

        <div class="row g-2 mb-3" id="hpFiltrosCustom" style="display:none;">
          <div class="col-md-3">
            <label class="form-label small mb-0">Desde</label>
            <input type="date" id="hpDesde" class="form-control form-control-sm">
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-0">Hasta</label>
            <input type="date" id="hpHasta" class="form-control form-control-sm">
          </div>
          <div class="col-md-3">
            <label class="form-label small mb-0">Tipo</label>
            <select id="hpTipo" class="form-select form-select-sm">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <button class="btn btn-sm btn-primary w-100" id="hpAplicar">Aplicar</button>
          </div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-3">
            <div class="card text-center border-success">
              <div class="card-body p-2">
                <div class="small text-muted">Entradas</div>
                <strong class="text-success" id="hpKpiEntradas">—</strong>
              </div>
            </div>
          </div>
          <div class="col-3">
            <div class="card text-center border-danger">
              <div class="card-body p-2">
                <div class="small text-muted">Salidas</div>
                <strong class="text-danger" id="hpKpiSalidas">—</strong>
              </div>
            </div>
          </div>
          <div class="col-3">
            <div class="card text-center border-info">
              <div class="card-body p-2">
                <div class="small text-muted">Neto</div>
                <strong id="hpKpiNeto">—</strong>
              </div>
            </div>
          </div>
          <div class="col-3">
            <div class="card text-center border-secondary">
              <div class="card-body p-2">
                <div class="small text-muted">Movimientos</div>
                <strong id="hpKpiMovs">—</strong>
              </div>
            </div>
          </div>
        </div>

        <div class="table-responsive" style="max-height:55vh;">
          <table class="table table-hover table-sm align-middle" id="hpTabla">
            <thead class="table-dark sticky-top">
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th>Contraparte</th>
                <th class="text-end">P.Unit ARS</th>
                <th class="text-end">P.Unit USD</th>
                <th class="text-end">Cotiz</th>
                <th class="text-end">Dto%</th>
                <th class="text-end text-success">Entrada</th>
                <th class="text-end text-danger">Salida</th>
                <th class="text-end">Saldo</th>
                <th>Depósito</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody id="hpTbody">
              <tr><td colspan="13" class="text-center text-muted">Cargando…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <small class="me-auto text-muted" id="hpFooterInfo"></small>
        <button class="btn btn-sm btn-outline-secondary" id="hpExportCsv" title="Exportar CSV">
          <i class="bi bi-file-earmark-spreadsheet"></i> CSV
        </button>
        <button class="btn btn-sm btn-outline-secondary" id="hpImprimir" title="Imprimir">
          <i class="bi bi-printer"></i> Imprimir
        </button>
        <button class="btn btn-sm btn-secondary" data-bs-dismiss="modal">Cerrar</button>
      </div>
    </div>
  </div>
</div>
`;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    // Estado interno
    const Estado = {
        id_producto: null,
        sku: null,
        nombre: null,
        rangoActivo: 'mes',
        movimientos: [],
        resumen: null
    };

    async function abrir(id_producto, sku, nombre) {
        _renderHTML();

        Estado.id_producto = id_producto;
        Estado.sku = sku;
        Estado.nombre = nombre;
        Estado.rangoActivo = 'mes';

        document.getElementById('hpProductoNombre').textContent = (sku ? '[' + sku + '] ' : '') + (nombre || '');

        // Reset chips
        document.querySelectorAll('#hpFiltrosRapidos button[data-rango]').forEach(b => b.classList.remove('active'));
        const btnMes = document.querySelector('#hpFiltrosRapidos button[data-rango="mes"]');
        if (btnMes) btnMes.classList.add('active');
        document.getElementById('hpFiltrosCustom').style.display = 'none';

        // Wire eventos (idempotente: removemos antes de agregar)
        _wireEventos();

        const modal = new bootstrap.Modal(document.getElementById('modalHistorialProducto'));
        modal.show();

        await _cargar();
    }

    function _wireEventos() {
        // Chips de fecha rápida
        document.querySelectorAll('#hpFiltrosRapidos button[data-rango]').forEach(btn => {
            btn.onclick = async () => {
                const rango = btn.dataset.rango;
                document.querySelectorAll('#hpFiltrosRapidos button[data-rango]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (rango === 'custom') {
                    document.getElementById('hpFiltrosCustom').style.display = '';
                    return;
                }
                document.getElementById('hpFiltrosCustom').style.display = 'none';
                Estado.rangoActivo = rango;
                await _cargar();
            };
        });

        // Botón aplicar (custom)
        const btnAplicar = document.getElementById('hpAplicar');
        if (btnAplicar) btnAplicar.onclick = async () => {
            Estado.rangoActivo = 'custom';
            await _cargar();
        };

        // Export CSV
        const btnCsv = document.getElementById('hpExportCsv');
        if (btnCsv) btnCsv.onclick = _exportarCsv;

        // Imprimir
        const btnPrint = document.getElementById('hpImprimir');
        if (btnPrint) btnPrint.onclick = () => window.print();
    }

    async function _cargar() {
        const tbody = document.getElementById('hpTbody');
        tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted">Cargando…</td></tr>';

        // Calcular rango
        let desde = null, hasta = null, tipo = '';
        if (Estado.rangoActivo === 'custom') {
            desde = document.getElementById('hpDesde').value || null;
            hasta = document.getElementById('hpHasta').value || null;
            tipo  = document.getElementById('hpTipo').value || '';
        } else {
            const r = RANGOS[Estado.rangoActivo]();
            desde = r[0]; hasta = r[1];
        }

        const qs = new URLSearchParams();
        if (desde) qs.set('desde', desde);
        if (hasta) qs.set('hasta', hasta);
        if (tipo)  qs.set('tipos', tipo);
        qs.set('limit', '500');

        try {
            const resp = await fetch(ENDPOINT + '/' + Estado.id_producto + '?' + qs.toString(), {
                headers: _getHeaders(),
                credentials: 'include'
            });
            if (!resp.ok) {
                tbody.innerHTML = '<tr><td colspan="13" class="text-center text-danger">Error HTTP ' + resp.status + '</td></tr>';
                return;
            }
            const data = await resp.json();
            Estado.movimientos = data.movimientos || [];
            Estado.resumen = data.resumen || {};

            _poblarTipoSelect();
            _renderKPIs();
            _renderTabla();
            _renderFooter();
        } catch (err) {
            console.error('[HistorialProducto] error:', err);
            tbody.innerHTML = '<tr><td colspan="13" class="text-center text-danger">Error: ' + err.message + '</td></tr>';
        }
    }

    function _poblarTipoSelect() {
        const sel = document.getElementById('hpTipo');
        if (!sel || sel.options.length > 1) return; // ya poblado
        const tipos = [...new Set(Estado.movimientos.map(m => m.tipo))].sort();
        tipos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t; opt.textContent = t;
            sel.appendChild(opt);
        });
    }

    function _renderKPIs() {
        const r = Estado.resumen || {};
        document.getElementById('hpKpiEntradas').textContent = _fmtAR(r.entradas_total);
        document.getElementById('hpKpiSalidas').textContent  = _fmtAR(r.salidas_total);
        document.getElementById('hpKpiNeto').textContent     = _fmtAR(r.neto);
        document.getElementById('hpKpiMovs').textContent     = r.cantidad_movimientos || 0;
    }

    function _renderTabla() {
        const tbody = document.getElementById('hpTbody');
        if (!Estado.movimientos.length) {
            tbody.innerHTML = '<tr><td colspan="13" class="text-center text-muted">Sin movimientos para este rango</td></tr>';
            return;
        }
        tbody.innerHTML = Estado.movimientos.map(m => {
            const docHtml = m.documento && m.documento.url
                ? `<a href="${m.documento.url}" target="_blank">${m.documento.numero || '—'}</a>`
                : (m.documento ? (m.documento.numero || '—') : '—');
            const cpHtml = m.contraparte
                ? `<span title="${m.contraparte.cuit || m.contraparte.detalle || ''}">${m.contraparte.nombre || '—'}</span>`
                : '<span class="text-muted">—</span>';
            const p = m.precios;
            return `<tr>
                <td>${_fmtFecha(m.fecha)}</td>
                <td>${_badgeTipo(m.tipo)}</td>
                <td>${docHtml}</td>
                <td>${cpHtml}</td>
                <td class="text-end">${p ? _fmtAR(p.unitario_ars) : '—'}</td>
                <td class="text-end">${p && p.unitario_usd != null ? _fmtAR(p.unitario_usd, 4) : '—'}</td>
                <td class="text-end">${p && p.cotizacion != null ? _fmtAR(p.cotizacion, 2) : '—'}</td>
                <td class="text-end">${p ? _fmtAR(p.descuento_pct, 2) : '—'}</td>
                <td class="text-end text-success">${m.entrada > 0 ? _fmtAR(m.entrada) : ''}</td>
                <td class="text-end text-danger">${m.salida > 0 ? _fmtAR(m.salida) : ''}</td>
                <td class="text-end"><strong>${_fmtAR(m.stock_posterior)}</strong></td>
                <td>${m.deposito ? m.deposito.nombre : '—'}</td>
                <td>${m.usuario ? (m.usuario.nombre || m.usuario.username) : '—'}</td>
            </tr>`;
        }).join('');
    }

    function _renderFooter() {
        const total = (Estado.resumen && Estado.resumen.cantidad_movimientos) || 0;
        document.getElementById('hpFooterInfo').textContent =
            'Producto #' + Estado.id_producto + ' — ' + total + ' movimiento(s)';
    }

    function _exportarCsv() {
        if (!Estado.movimientos.length) return;
        const sep = ';';
        const headers = ['Fecha','Tipo','Documento','Contraparte','PUnit ARS','PUnit USD','Cotiz','Dto%','Entrada','Salida','Saldo','Deposito','Usuario'];
        const rows = Estado.movimientos.map(m => [
            _fmtFecha(m.fecha),
            m.tipo,
            m.documento ? (m.documento.numero || '') : '',
            m.contraparte ? (m.contraparte.nombre || '') : '',
            m.precios ? m.precios.unitario_ars : '',
            m.precios && m.precios.unitario_usd != null ? m.precios.unitario_usd : '',
            m.precios && m.precios.cotizacion != null ? m.precios.cotizacion : '',
            m.precios ? m.precios.descuento_pct : '',
            m.entrada > 0 ? m.entrada : '',
            m.salida > 0 ? m.salida : '',
            m.stock_posterior,
            m.deposito ? m.deposito.nombre : '',
            m.usuario ? (m.usuario.nombre || m.usuario.username) : ''
        ]);
        const csv = [headers.join(sep)].concat(rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(sep))).join('\n');
        const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'historial_' + (Estado.sku || Estado.id_producto) + '_' + new Date().toISOString().slice(0,10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ─── EXPORT GLOBAL ───
    window.HistorialProducto = {
        abrir: abrir
    };

})();
