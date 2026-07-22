/**
 * dashboard.js - ERP LAGO
 * 
 * Frontend del Dashboard principal.
 * Auto-refresh cada 60s para KPIs, 5min para listas.
 */

const API_URL = window.CONFIG?.API_BASE_URL || '/api';
let graficoVentas = null;
let intervalKPIs = null;

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    cargarDashboard();
    // Auto-refresh cada 60 segundos
    intervalKPIs = setInterval(cargarDashboard, 60000);
});

// ============================================================================
// CARGA PRINCIPAL
// ============================================================================

async function cargarDashboard() {
    try {
        const resp = await fetch(`${API_URL}/reportes/dashboard`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        renderKPIs(data);
        renderCaja(data.caja);
        renderGraficoVentas(data.ventas_por_dia || []);
        renderTopProductos(data.top_productos || []);
        renderStockCritico(data.stock_critico);
        renderDeudores(data.deudores);
        renderPendientes(data.pendientes);

        // Timestamp última actualización
        const ahora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const el = document.getElementById('ultimaActualizacion');
        if (el) el.textContent = ahora;

    } catch (error) {
        console.error('Error cargando dashboard:', error);
    }
}

// ============================================================================
// FORMATEO
// ============================================================================

function fmt(n) {
    return parseFloat(n || 0).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function fmtInt(n) {
    return parseInt(n || 0).toLocaleString('es-AR');
}

// ============================================================================
// RENDER KPIs
// ============================================================================

function renderKPIs(data) {
    // Ventas Hoy
    setText('kpiVentasHoyMonto', '$' + fmt(data.ventas_hoy?.monto));
    setText('kpiVentasHoyCant', data.ventas_hoy?.cantidad + ' pedidos');
    setText('kpiVentasHoyTicket', 'Ticket: $' + fmt(data.ventas_hoy?.ticket_promedio));

    // Ventas Mes
    setText('kpiVentasMesMonto', '$' + fmt(data.ventas_mes?.monto));
    setText('kpiVentasMesCant', data.ventas_mes?.cantidad + ' pedidos');

    // Cobranzas Hoy
    setText('kpiCobranzasMonto', '$' + fmt(data.cobranzas_hoy?.monto));
    setText('kpiCobranzasCant', data.cobranzas_hoy?.cantidad + ' recibos');
}

function renderCaja(caja) {
    const indicador = document.getElementById('kpiCajaEstado');
    const monto = document.getElementById('kpiCajaSaldo');
    const detalle = document.getElementById('kpiCajaDetalle');

    if (!indicador) return;

    if (caja?.abierta) {
        indicador.innerHTML = '<span class="badge bg-success">ABIERTA</span> ' + (caja.nombre_caja || '');
        monto.textContent = '$' + fmt(caja.saldo_ars);
        detalle.textContent = 'Desde ' + new Date(caja.fecha_apertura).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    } else {
        indicador.innerHTML = '<span class="badge bg-secondary">CERRADA</span>';
        monto.textContent = '-';
        detalle.textContent = 'Sin turno abierto';
    }
}

function renderPendientes(pendientes) {
    if (!pendientes) return;
    setText('kpiPendDespacho', pendientes.despacho?.cantidad || 0);
    setText('kpiPendDespachoMonto', '$' + fmt(pendientes.despacho?.monto));
    setText('kpiPendFacturar', pendientes.facturacion?.cantidad || 0);
}

// ============================================================================
// GRÁFICO VENTAS 7 DÍAS
// ============================================================================

function renderGraficoVentas(datos) {
    const ctx = document.getElementById('graficoVentas');
    if (!ctx) return;

    if (graficoVentas) graficoVentas.destroy();

    const labels = datos.map(d =>
        new Date(d.fecha).toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit' })
    );
    const montos = datos.map(d => parseFloat(d.total_ventas));
    const cantidades = datos.map(d => d.cantidad_pedidos);

    graficoVentas = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Ventas ($)',
                    data: montos,
                    backgroundColor: 'rgba(37, 99, 235, 0.7)',
                    borderRadius: 6,
                    yAxisID: 'y',
                    order: 2
                },
                {
                    label: 'Pedidos',
                    data: cantidades,
                    type: 'line',
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4,
                    pointBackgroundColor: '#f59e0b',
                    yAxisID: 'y1',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, padding: 15 } },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            if (ctx.dataset.yAxisID === 'y') return 'Ventas: $' + fmt(ctx.raw);
                            return 'Pedidos: ' + ctx.raw;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    ticks: { callback: v => '$' + fmtInt(v) },
                    grid: { color: 'rgba(0,0,0,0.06)' }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { stepSize: 1 }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

// ============================================================================
// TOP PRODUCTOS
// ============================================================================

function renderTopProductos(productos) {
    const container = document.getElementById('topProductos');
    if (!container) return;

    if (productos.length === 0) {
        container.innerHTML = '<div class="text-muted text-center py-3">Sin ventas en los últimos 7 días</div>';
        return;
    }

    container.innerHTML = productos.map((p, i) => `
        <div class="d-flex align-items-center py-2 ${i > 0 ? 'border-top' : ''}">
            <span class="badge ${i < 3 ? 'bg-primary' : 'bg-secondary'} rounded-pill me-2"
                  style="min-width:28px">${i + 1}</span>
            <div class="flex-grow-1 text-truncate">
                <div class="fw-semibold text-truncate" title="${p.nombre}">${p.nombre}</div>
                <small class="text-muted">${p.sku || ''}</small>
            </div>
            <div class="text-end ms-2">
                <div class="fw-bold">$${fmt(p.total_vendido)}</div>
                <small class="text-muted">${parseFloat(p.cantidad_vendida)} uds</small>
            </div>
        </div>
    `).join('');
}

// ============================================================================
// STOCK CRÍTICO
// ============================================================================

function renderStockCritico(stock) {
    const container = document.getElementById('stockCriticoLista');
    const badge = document.getElementById('stockCriticoBadge');
    if (!container) return;

    const totales = stock?.totales || { total: 0, sin_stock: 0, bajo_minimo: 0 };
    const items = stock?.items || [];

    if (badge) {
        badge.textContent = totales.total;
        badge.className = 'badge ' + (totales.sin_stock > 0 ? 'bg-danger' : totales.total > 0 ? 'bg-warning' : 'bg-success');
    }

    if (items.length === 0) {
        container.innerHTML = '<div class="text-success text-center py-2"><i class="bi bi-check-circle"></i> Stock OK</div>';
        return;
    }

    container.innerHTML = items.slice(0, 5).map(p => `
        <div class="d-flex align-items-center py-1 border-bottom">
            <span class="badge ${p.nivel === 'SIN_STOCK' ? 'bg-danger' : 'bg-warning'} me-2" style="font-size:0.65rem">
                ${p.nivel === 'SIN_STOCK' ? 'SIN' : 'BAJO'}
            </span>
            <div class="flex-grow-1 text-truncate small" title="${p.nombre}">${p.nombre}</div>
            <div class="text-end small fw-bold">${p.stock_real}/${p.stock_minimo}</div>
        </div>
    `).join('');

    if (totales.total > 5) {
        container.innerHTML += `
            <a href="inventario.html" class="d-block text-center small mt-2 text-decoration-none">
                Ver todos (${totales.total}) →
            </a>`;
    }
}

// ============================================================================
// DEUDORES
// ============================================================================

function renderDeudores(deudores) {
    const container = document.getElementById('deudoresLista');
    const totalEl = document.getElementById('deudoresTotal');
    if (!container) return;

    const items = deudores?.items || [];
    const totalDeuda = deudores?.total_deuda || 0;

    if (totalEl) totalEl.textContent = '$' + fmt(totalDeuda);

    if (items.length === 0) {
        container.innerHTML = '<div class="text-success text-center py-2"><i class="bi bi-check-circle"></i> Sin deudas</div>';
        return;
    }

    container.innerHTML = items.map(d => `
        <div class="d-flex align-items-center py-1 border-bottom">
            <div class="flex-grow-1 text-truncate small" title="${d.razon_social}">${d.razon_social}</div>
            <div class="text-end small fw-bold text-danger">$${fmt(d.saldo_actual)}</div>
        </div>
    `).join('');

    container.innerHTML += `
        <a href="cuenta-corriente.html" class="d-block text-center small mt-2 text-decoration-none">
            Ver cuentas corrientes →
        </a>`;
}

// ============================================================================
// UTILS
// ============================================================================

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
