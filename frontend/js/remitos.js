'use strict';

/**
 * remitos.js - Frontend para consulta y listado de remitos
 * 
 * Patron: Similar a facturas.js / presupuestos.js
 * Teclado: Tab entre filtros, Enter buscar, F5 refrescar
 * API_BASE: window.CONFIG?.API_BASE_URL (ya incluye /api)
 */

document.addEventListener('DOMContentLoaded', async () => {
    const API = window.CONFIG?.API_BASE_URL || '/api';
    const token = localStorage.getItem('authToken');
    const headers = { 
        'Authorization': `Bearer ${token}`, 
        'Content-Type': 'application/json' 
    };

    // ─── ESTADO ─────────────────────────────────────────────
    let remitos = [];
    let totalRegistros = 0;
    let paginaActual = 0;
    const LIMIT = 50;
    let formDataCache = null;

    // ─── ELEMENTOS DOM ──────────────────────────────────────
    const tablaBody = document.getElementById('tablaRemitosBody');
    const txtBusqueda = document.getElementById('txtBusqueda');
    const filtroEstado = document.getElementById('filtroEstado');
    const filtroFechaDesde = document.getElementById('filtroFechaDesde');
    const filtroFechaHasta = document.getElementById('filtroFechaHasta');
    const btnBuscar = document.getElementById('btnBuscar');
    const btnLimpiar = document.getElementById('btnLimpiar');
    const btnExportar = document.getElementById('btnExportar');
    const infoPaginacion = document.getElementById('infoPaginacion');
    const btnAnterior = document.getElementById('btnAnterior');
    const btnSiguiente = document.getElementById('btnSiguiente');
    const statsContainer = document.getElementById('statsContainer');
    const modalDetalle = document.getElementById('modalDetalle');

    // ─── INIT ───────────────────────────────────────────────
    await cargarFormData();
    await cargarRemitos();
    configurarEventos();

    // ─── CARGAR FORM DATA ───────────────────────────────────
    async function cargarFormData() {
        try {
            const resp = await fetch(`${API}/remitos/form-data`, { headers });
            if (!resp.ok) throw new Error('Error cargando datos');
            formDataCache = await resp.json();

            // Llenar select estados
            if (filtroEstado && formDataCache.estados) {
                filtroEstado.innerHTML = '<option value="">Todos los estados</option>';
                formDataCache.estados.forEach(e => {
                    const opt = document.createElement('option');
                    opt.value = e;
                    opt.textContent = e.charAt(0).toUpperCase() + e.slice(1);
                    filtroEstado.appendChild(opt);
                });
            }

            // Mostrar estadísticas
            if (statsContainer && formDataCache.estadisticas) {
                const s = formDataCache.estadisticas;
                statsContainer.innerHTML = `
                    <div class="d-flex gap-3 flex-wrap">
                        <span class="badge bg-primary fs-6">Total: ${s.total_remitos}</span>
                        <span class="badge bg-warning text-dark fs-6">Pendientes: ${s.pendientes}</span>
                        <span class="badge bg-info fs-6">Despachados: ${s.despachados}</span>
                        <span class="badge bg-success fs-6">Entregados: ${s.entregados}</span>
                        <span class="badge bg-danger fs-6">Anulados: ${s.anulados}</span>
                    </div>`;
            }
        } catch (err) {
            console.error('Error cargando form-data:', err);
        }
    }

    // ─── CARGAR REMITOS ─────────────────────────────────────
    async function cargarRemitos() {
        try {
            const params = new URLSearchParams();
            params.set('limit', LIMIT);
            params.set('offset', paginaActual * LIMIT);

            if (txtBusqueda?.value) params.set('busqueda', txtBusqueda.value.trim());
            if (filtroEstado?.value) params.set('estado', filtroEstado.value);
            if (filtroFechaDesde?.value) params.set('fecha_desde', filtroFechaDesde.value);
            if (filtroFechaHasta?.value) params.set('fecha_hasta', filtroFechaHasta.value);

            tablaBody.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner-border text-primary" role="status"></div></td></tr>';

            const resp = await fetch(`${API}/remitos?${params.toString()}`, { headers });
            if (!resp.ok) throw new Error('Error cargando remitos');

            const resultado = await resp.json();
            remitos = resultado.data;
            totalRegistros = resultado.total;

            renderTabla();
            actualizarPaginacion();

        } catch (err) {
            console.error('Error cargando remitos:', err);
            tablaBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">Error al cargar remitos: ${err.message}</td></tr>`;
        }
    }

    // ─── RENDER TABLA ───────────────────────────────────────
    function renderTabla() {
        if (remitos.length === 0) {
            tablaBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No se encontraron remitos</td></tr>';
            return;
        }

        tablaBody.innerHTML = remitos.map(r => {
            const estadoClass = {
                'pendiente': 'warning text-dark',
                'despachado': 'info',
                'en_camino': 'primary',
                'entregado': 'success',
                'entregado_parcial': 'success',
                'anulado': 'danger'
            }[r.estado] || 'secondary';

            const fecha = r.fecha_emision ? new Date(r.fecha_emision).toLocaleDateString('es-AR') : '-';

            return `
                <tr class="cursor-pointer" data-id="${r.id_remito}" tabindex="0">
                    <td class="fw-bold">${r.numero_completo || '-'}</td>
                    <td>${fecha}</td>
                    <td>${escapeHtml(r.cliente_nombre || 'Sin cliente')}</td>
                    <td>${r.pedido_numero || '-'}</td>
                    <td>${r.deposito_nombre || '-'}</td>
                    <td class="text-center">${r.total_items || 0}</td>
                    <td><span class="badge bg-${estadoClass}">${r.estado}</span></td>
                    <td class="text-center">
                        <button class="btn btn-sm btn-outline-primary btn-ver-detalle" data-id="${r.id_remito}" title="Ver detalle">
                            <i class="bi bi-eye"></i>
                        </button>
                    </td>
                </tr>`;
        }).join('');

        // Click en fila o botón
        tablaBody.querySelectorAll('tr[data-id]').forEach(tr => {
            tr.addEventListener('click', (e) => {
                if (!e.target.closest('button')) verDetalle(tr.dataset.id);
            });
            tr.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    verDetalle(tr.dataset.id);
                }
            });
        });

        tablaBody.querySelectorAll('.btn-ver-detalle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                verDetalle(btn.dataset.id);
            });
        });
    }

    // ─── PAGINACIÓN ─────────────────────────────────────────
    function actualizarPaginacion() {
        const totalPaginas = Math.ceil(totalRegistros / LIMIT);
        const desde = totalRegistros > 0 ? paginaActual * LIMIT + 1 : 0;
        const hasta = Math.min((paginaActual + 1) * LIMIT, totalRegistros);

        if (infoPaginacion) {
            infoPaginacion.textContent = `${desde}-${hasta} de ${totalRegistros}`;
        }
        if (btnAnterior) btnAnterior.disabled = paginaActual === 0;
        if (btnSiguiente) btnSiguiente.disabled = paginaActual >= totalPaginas - 1;
    }

    // ─── VER DETALLE ────────────────────────────────────────
    async function verDetalle(id) {
        try {
            const resp = await fetch(`${API}/remitos/${id}`, { headers });
            if (!resp.ok) throw new Error('Error cargando detalle');
            const remito = await resp.json();

            const contenido = document.getElementById('modalDetalleContenido');
            if (!contenido) return;

            const estadoClass = {
                'pendiente': 'warning text-dark', 'despachado': 'info',
                'en_camino': 'primary', 'entregado': 'success', 'anulado': 'danger'
            }[remito.estado] || 'secondary';

            const fecha = remito.fecha_emision ? new Date(remito.fecha_emision).toLocaleDateString('es-AR') : '-';

            contenido.innerHTML = `
                <div class="mb-3 d-flex justify-content-between align-items-center">
                    <h5 class="mb-0">Remito ${remito.numero_completo}</h5>
                    <span class="badge bg-${estadoClass} fs-6">${remito.estado}</span>
                </div>

                <div class="row mb-3">
                    <div class="col-md-6">
                        <div class="card">
                            <div class="card-body p-2">
                                <small class="text-muted">Cliente</small>
                                <div class="fw-bold">${escapeHtml(remito.cliente_nombre || 'Sin cliente')}</div>
                                ${remito.cliente_cuit ? `<div class="small text-muted">CUIT: ${remito.cliente_cuit}</div>` : ''}
                                ${remito.cliente_domicilio ? `<div class="small">${escapeHtml(remito.cliente_domicilio)}</div>` : ''}
                                ${remito.cliente_telefono ? `<div class="small">${remito.cliente_telefono}</div>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="card">
                            <div class="card-body p-2">
                                <small class="text-muted">Datos del remito</small>
                                <div>Fecha: <strong>${fecha}</strong></div>
                                ${remito.pedido_numero ? `<div>Pedido: <a href="ver-pedido.html?id=${remito.id_pedido}" class="fw-bold">${remito.pedido_numero}</a></div>` : ''}
                                ${remito.deposito_nombre ? `<div>Depósito: ${remito.deposito_nombre}</div>` : ''}
                                ${remito.usuario_nombre ? `<div>Usuario: ${remito.usuario_nombre}</div>` : ''}
                            </div>
                        </div>
                    </div>
                </div>

                ${remito.observaciones ? `<div class="alert alert-light mb-3"><small class="text-muted">Observaciones:</small> ${escapeHtml(remito.observaciones)}</div>` : ''}

                <h6>Items (${remito.items?.length || 0})</h6>
                <div class="table-responsive">
                    <table class="table table-sm table-striped">
                        <thead>
                            <tr>
                                <th>Código</th>
                                <th>Producto</th>
                                <th class="text-center">Cantidad</th>
                                <th class="text-center">Entregada</th>
                                <th>Depósito</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(remito.items || []).map(item => `
                                <tr>
                                    <td class="small">${item.producto_codigo || '-'}</td>
                                    <td>${escapeHtml(item.producto_nombre || item.descripcion || 'Sin nombre')}</td>
                                    <td class="text-center fw-bold">${item.cantidad || 0}</td>
                                    <td class="text-center">${item.cantidad_entregada || 0}</td>
                                    <td class="small">${item.deposito_origen_nombre || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>`;

            // Mostrar modal Bootstrap
            const bsModal = new bootstrap.Modal(modalDetalle);
            bsModal.show();

        } catch (err) {
            console.error('Error cargando detalle:', err);
            alert('Error al cargar el detalle del remito');
        }
    }

    // ─── EXPORTAR ───────────────────────────────────────────
    async function exportarExcel() {
        try {
            const params = new URLSearchParams();
            if (filtroEstado?.value) params.set('estado', filtroEstado.value);
            if (filtroFechaDesde?.value) params.set('fecha_desde', filtroFechaDesde.value);
            if (filtroFechaHasta?.value) params.set('fecha_hasta', filtroFechaHasta.value);

            const resp = await fetch(`${API}/remitos/exportar?${params.toString()}`, { headers });
            if (!resp.ok) throw new Error('Error exportando');
            const resultado = await resp.json();

            if (!resultado.data || resultado.data.length === 0) {
                alert('No hay datos para exportar');
                return;
            }

            // Generar CSV
            const cols = Object.keys(resultado.data[0]);
            const csv = [
                cols.join(';'),
                ...resultado.data.map(row => cols.map(c => `"${(row[c] || '').toString().replace(/"/g, '""')}"`).join(';'))
            ].join('\n');

            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `remitos_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);

        } catch (err) {
            console.error('Error exportando:', err);
            alert('Error al exportar: ' + err.message);
        }
    }

    // ─── EVENTOS ────────────────────────────────────────────
    function configurarEventos() {
        // Buscar
        if (btnBuscar) btnBuscar.addEventListener('click', () => { paginaActual = 0; cargarRemitos(); });
        if (txtBusqueda) {
            txtBusqueda.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { paginaActual = 0; cargarRemitos(); }
            });
        }

        // Filtros con auto-búsqueda
        [filtroEstado, filtroFechaDesde, filtroFechaHasta].forEach(el => {
            if (el) el.addEventListener('change', () => { paginaActual = 0; cargarRemitos(); });
        });

        // Limpiar
        if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
            if (txtBusqueda) txtBusqueda.value = '';
            if (filtroEstado) filtroEstado.value = '';
            if (filtroFechaDesde) filtroFechaDesde.value = '';
            if (filtroFechaHasta) filtroFechaHasta.value = '';
            paginaActual = 0;
            cargarRemitos();
        });

        // Exportar
        if (btnExportar) btnExportar.addEventListener('click', exportarExcel);

        // Paginación
        if (btnAnterior) btnAnterior.addEventListener('click', () => { if (paginaActual > 0) { paginaActual--; cargarRemitos(); } });
        if (btnSiguiente) btnSiguiente.addEventListener('click', () => { paginaActual++; cargarRemitos(); });

        // Atajos teclado
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F5' && !e.ctrlKey) {
                e.preventDefault();
                cargarRemitos();
            }
        });
    }

    // ─── UTILS ──────────────────────────────────────────────
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
});
