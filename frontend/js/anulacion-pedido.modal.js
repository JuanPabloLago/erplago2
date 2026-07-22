/**
 * ═══════════════════════════════════════════════════════════════════════
 * anulacion-pedido.modal.js — Modal reutilizable de anulacion en cascada
 * ═══════════════════════════════════════════════════════════════════════
 * Uso:
 *   AnulacionPedidoModal.abrir(idPedido, onSuccessCallback);
 *
 * Flujo UX:
 *   1. Evalua escenario sin motivo (GET /evaluar-anulacion)
 *   2. Si bloqueado -> muestra bloqueo + accion sugerida (link a notas/despachos)
 *   3. Si permitido -> muestra acciones_previstas + pide motivo
 *   4. Al confirmar -> POST /anular-cascada
 *   5. Muestra resultado + ejecuta callback
 */
(function() {
    'use strict';

    const API = window.CONFIG?.API_BASE_URL || '/api';
    const MODAL_ID = 'modalAnulacionCascada';

    // ─────────────────────────────────────────────────────────────────
    // HTML del modal — inyectado una sola vez
    // ─────────────────────────────────────────────────────────────────
    function _inyectarHTML() {
        if (document.getElementById(MODAL_ID)) return;
        const html = `
<div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-hidden="true">
  <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
    <div class="modal-content">
      <div class="modal-header bg-warning-subtle">
        <h5 class="modal-title">
          <i class="bi bi-exclamation-triangle-fill text-warning"></i>
          Anulación de pedido
          <span id="anulCasId" class="fw-normal text-muted"></span>
        </h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <div id="anulCasLoading" class="text-center py-4">
          <div class="spinner-border text-primary" role="status"></div>
          <div class="mt-2 text-muted">Evaluando escenario...</div>
        </div>
        <div id="anulCasContenido" style="display:none;"></div>
      </div>
      <div class="modal-footer" id="anulCasFooter">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
      </div>
    </div>
  </div>
</div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers HTTP
    // ─────────────────────────────────────────────────────────────────
    function _token() { return localStorage.getItem('authToken') || ''; }
    function _headers(json = false) {
        const h = { 'Authorization': 'Bearer ' + _token() };
        if (json) h['Content-Type'] = 'application/json';
        return h;
    }

    async function _evaluar(idPedido, motivo) {
        const url = API + '/pedidos/' + idPedido + '/evaluar-anulacion'
                  + (motivo ? '?motivo=' + encodeURIComponent(motivo) : '');
        const r = await fetch(url, { headers: _headers() });
        return await r.json();
    }

    async function _ejecutar(idPedido, motivo) {
        const r = await fetch(API + '/pedidos/' + idPedido + '/anular-cascada', {
            method: 'POST',
            headers: _headers(true),
            body: JSON.stringify({ motivo })
        });
        const body = await r.json();
        return { ok: r.ok, status: r.status, body };
    }

    // ─────────────────────────────────────────────────────────────────
    // Renderers
    // ─────────────────────────────────────────────────────────────────
    function _iconoBloqueo(codigo) {
        const map = {
            BLOQ_ENTREGADO:   'bi-truck',
            BLOQ_PARCIAL:     'bi-box-seam',
            BLOQ_EN_VIAJE:    'bi-signpost-split',
            BLOQ_FACTURA_CAE: 'bi-file-text',
            BLOQ_YA_ANULADO:  'bi-x-circle',
            BLOQ_ROL:         'bi-shield-lock',
            BLOQ_MOTIVO:      'bi-chat-left-text'
        };
        return map[codigo] || 'bi-exclamation-octagon';
    }

    function _accionSugeridaBoton(accion, bloqueo) {
        if (accion === 'EMITIR_NC_MANUAL') {
            return `<a href="notas.html" class="btn btn-primary btn-sm" target="_blank">
                      <i class="bi bi-file-earmark-plus"></i> Ir a Notas de Crédito
                    </a>`;
        }
        if (accion === 'REGISTRAR_REGRESO_VIAJE' && bloqueo.viajes_bloqueantes?.length) {
            const ids = bloqueo.viajes_bloqueantes.join(',');
            return `<a href="gestion-despachos.html" class="btn btn-primary btn-sm" target="_blank">
                      <i class="bi bi-truck"></i> Ir a Despachos (viaje #${ids})
                    </a>`;
        }
        return '';
    }

    function _renderBloqueo(resp, idPedido) {
        const cont = document.getElementById('anulCasContenido');
        const foot = document.getElementById('anulCasFooter');

        let html = '<div class="alert alert-danger"><strong>No se puede anular este pedido</strong></div>';
        html += '<ul class="list-group">';
        for (const b of (resp.bloqueos || [])) {
            html += `<li class="list-group-item">
                       <div class="d-flex align-items-start gap-2">
                         <i class="bi ${_iconoBloqueo(b.codigo)} text-danger fs-4"></i>
                         <div class="flex-grow-1">
                           <div><span class="badge bg-danger">${b.codigo}</span></div>
                           <div class="mt-1">${b.mensaje}</div>
                           ${_accionSugeridaBoton(b.accion_sugerida, b)}
                         </div>
                       </div>
                     </li>`;
        }
        html += '</ul>';

        cont.innerHTML = html;
        cont.style.display = 'block';
        foot.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>';
    }

    function _renderPermitido(resp, idPedido, onSuccess) {
        const cont = document.getElementById('anulCasContenido');
        const foot = document.getElementById('anulCasFooter');

        const fmt = (v) => new Intl.NumberFormat('es-AR', {
            style:'currency', currency:'ARS'
        }).format(v || 0);

        let acciones = '';
        for (const a of (resp.acciones_previstas || [])) {
            acciones += `<li class="list-group-item">
                           <i class="bi bi-check-circle text-success"></i>
                           <strong>${a.tipo.replaceAll('_',' ')}</strong>
                           <div class="small text-muted">${a.detalle}</div>
                           ${a.remitos?.length ? '<div class="small">Remitos: '+a.remitos.join(', ')+'</div>' : ''}
                           ${a.facturas?.length ? '<div class="small">Facturas: '+a.facturas.join(', ')+'</div>' : ''}
                         </li>`;
        }

        cont.innerHTML = `
            <div class="alert alert-warning mb-3">
              <strong>Escenario detectado:</strong>
              <span class="badge bg-warning text-dark">${resp.escenario}</span>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-6"><div class="border rounded p-2 small"><span class="text-muted">Total pedido:</span><br><strong>${fmt(resp.resumen.total_pedido)}</strong></div></div>
              <div class="col-6"><div class="border rounded p-2 small"><span class="text-muted">Remitos activos:</span><br><strong>${resp.resumen.remitos_total}</strong></div></div>
              <div class="col-6"><div class="border rounded p-2 small"><span class="text-muted">Facturas activas:</span><br><strong>${resp.resumen.facturas_total}</strong></div></div>
              <div class="col-6"><div class="border rounded p-2 small"><span class="text-muted">Pagos registrados:</span><br><strong>${resp.resumen.pagos_cantidad} (${fmt(resp.resumen.pagos_total)})</strong></div></div>
            </div>

            <h6>Acciones que se ejecutarán:</h6>
            <ul class="list-group mb-3">${acciones}</ul>

            <div class="mb-2">
              <label class="form-label fw-bold">Motivo de la anulación <span class="text-danger">*</span></label>
              <textarea id="anulCasMotivo" class="form-control" rows="2"
                        placeholder="Mínimo 15 caracteres. Ej: Pedido duplicado cargado por error"></textarea>
              <div id="anulCasMotivoHint" class="form-text">0 caracteres</div>
            </div>
            <div id="anulCasError" class="alert alert-danger" style="display:none;"></div>
        `;
        cont.style.display = 'block';

        // Contador de caracteres
        const ta = document.getElementById('anulCasMotivo');
        const hint = document.getElementById('anulCasMotivoHint');
        ta.addEventListener('input', () => {
            const l = ta.value.trim().length;
            hint.textContent = l + ' caracteres' + (l < 15 ? ' (mínimo 15)' : ' ✓');
            hint.className = 'form-text ' + (l < 15 ? 'text-danger' : 'text-success');
        });

        foot.innerHTML = `
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
            <button type="button" id="anulCasBtnConfirmar" class="btn btn-danger">
              <i class="bi bi-trash"></i> Anular en cascada
            </button>
        `;

        document.getElementById('anulCasBtnConfirmar').addEventListener('click', async () => {
            const motivo = ta.value.trim();
            const err = document.getElementById('anulCasError');
            err.style.display = 'none';

            if (motivo.length < 15) {
                err.textContent = 'El motivo debe tener al menos 15 caracteres';
                err.style.display = 'block';
                return;
            }

            const btn = document.getElementById('anulCasBtnConfirmar');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Ejecutando...';

            const { ok, body } = await _ejecutar(idPedido, motivo);

            if (!ok) {
                err.textContent = body.error || 'Error al anular';
                err.style.display = 'block';
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-trash"></i> Anular en cascada';
                return;
            }

            _renderResultado(body, idPedido, onSuccess);
        });
    }

    function _renderResultado(resp, idPedido, onSuccess) {
        const cont = document.getElementById('anulCasContenido');
        const foot = document.getElementById('anulCasFooter');

        let pasos = '';
        for (const e of (resp.ejecuciones || [])) {
            pasos += `<li class="list-group-item">
                        <i class="bi bi-check-circle-fill text-success"></i>
                        <strong>${e.paso.replaceAll('_',' ')}</strong>
                      </li>`;
        }

        cont.innerHTML = `
            <div class="alert alert-success">
              <i class="bi bi-check-circle-fill"></i>
              <strong>Pedido #${idPedido} anulado correctamente</strong><br>
              Escenario ejecutado: <span class="badge bg-success">${resp.escenario}</span>
            </div>
            <h6>Pasos ejecutados:</h6>
            <ul class="list-group">${pasos}</ul>
        `;

        foot.innerHTML = `<button type="button" class="btn btn-primary" data-bs-dismiss="modal" id="anulCasBtnListo">
                            <i class="bi bi-check"></i> Listo
                          </button>`;
        document.getElementById('anulCasBtnListo').addEventListener('click', () => {
            if (typeof onSuccess === 'function') onSuccess(resp);
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // API publica
    // ─────────────────────────────────────────────────────────────────
    async function abrir(idPedido, onSuccess) {
        _inyectarHTML();
        const modalEl = document.getElementById(MODAL_ID);
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        document.getElementById('anulCasId').textContent = '#' + idPedido;
        document.getElementById('anulCasLoading').style.display = 'block';
        document.getElementById('anulCasContenido').style.display = 'none';
        document.getElementById('anulCasContenido').innerHTML = '';
        document.getElementById('anulCasFooter').innerHTML =
            '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>';

        modal.show();

        try {
            const resp = await _evaluar(idPedido, null);
            document.getElementById('anulCasLoading').style.display = 'none';

            if (!resp.permitido) {
                _renderBloqueo(resp, idPedido);
            } else {
                _renderPermitido(resp, idPedido, onSuccess);
            }
        } catch (e) {
            document.getElementById('anulCasLoading').style.display = 'none';
            document.getElementById('anulCasContenido').innerHTML =
                '<div class="alert alert-danger">Error al evaluar: ' + e.message + '</div>';
            document.getElementById('anulCasContenido').style.display = 'block';
        }
    }

    window.AnulacionPedidoModal = { abrir };
})();
