/**
 * reportes.js - ERP LAGO
 * 
 * Frontend módulo Reportes.
 * 6 tipos de reporte con filtros dinámicos y export CSV.
 */

const API_URL = window.CONFIG?.API_BASE_URL || '/api';

// Estado
let filtrosData = { vendedores: [], formas_pago: [], categorias: [] };
let reporteActual = null;
let datosActuales = null;

// ============================================================================
// CONFIG DE REPORTES
// ============================================================================

const REPORTES = {
    'ventas-periodo': {
        titulo: 'Ventas por Período',
        icono: 'bi-calendar-range',
        endpoint: '/reportes/ventas-periodo',
        filtros: ['fechas', 'vendedor', 'forma_pago'],
        columnas: ['Fecha', 'Pedidos', 'Subtotal', 'IVA', 'Descuentos', 'Total'],
        renderFila: (r) => [
            new Date(r.fecha).toLocaleDateString('es-AR'),
            r.cantidad_pedidos,
            '$' + fmt(r.subtotal),
            '$' + fmt(r.iva),
            '$' + fmt(r.descuentos),
            '$' + fmt(r.monto_total)
        ],
        renderTotales: (t) => [
            'TOTALES', t.cantidad_pedidos,
            '$' + fmt(t.subtotal), '$' + fmt(t.iva),
            '$' + fmt(t.descuentos), '$' + fmt(t.monto_total)
        ],
        tieneGrafico: true
    },
    'ranking-productos': {
        titulo: 'Ranking Productos',
        icono: 'bi-trophy',
        endpoint: '/reportes/ranking-productos',
        filtros: ['fechas', 'orden'],
        columnas: ['#', 'SKU', 'Producto', 'Categoría', 'Cantidad', 'Total', 'En pedidos'],
        renderFila: (r, i) => [
            i + 1, r.sku || '-', r.nombre, r.categoria || '-',
            parseFloat(r.cantidad_vendida), '$' + fmt(r.total_vendido), r.en_pedidos
        ],
        renderTotales: null,
        tieneGrafico: false
    },
    'ventas-categoria': {
        titulo: 'Ventas por Categoría',
        icono: 'bi-tags',
        endpoint: '/reportes/ventas-categoria',
        filtros: ['fechas'],
        columnas: ['Categoría', 'Pedidos', 'Unidades', 'Monto', '%'],
        renderFila: (r) => [
            r.categoria, r.pedidos, parseFloat(r.unidades),
            '$' + fmt(r.monto), r.porcentaje + '%'
        ],
        renderTotales: (data) => ['TOTAL', '', '', '$' + fmt(data.total_monto), '100%'],
        tieneGrafico: true
    },
    'ventas-vendedor': {
        titulo: 'Ventas por Vendedor',
        icono: 'bi-person-badge',
        endpoint: '/reportes/ventas-vendedor',
        filtros: ['fechas'],
        columnas: ['Vendedor', 'Pedidos', 'Total', 'Ticket Prom.', '%'],
        renderFila: (r) => [
            r.vendedor, r.cantidad_pedidos, '$' + fmt(r.monto_total),
            '$' + fmt(r.ticket_promedio), r.porcentaje + '%'
        ],
        renderTotales: (data) => ['TOTAL', '', '$' + fmt(data.total_monto), '', '100%'],
        tieneGrafico: true
    },
    'ventas-forma-pago': {
        titulo: 'Ventas por Forma de Pago',
        icono: 'bi-credit-card',
        endpoint: '/reportes/ventas-forma-pago',
        filtros: ['fechas'],
        columnas: ['Forma de Pago', 'Pedidos', 'Monto', '%'],
        renderFila: (r) => [
            r.forma_pago, r.cantidad_pedidos, '$' + fmt(r.monto_total), r.porcentaje + '%'
        ],
        renderTotales: (data) => ['TOTAL', '', '$' + fmt(data.total_monto), '100%'],
        tieneGrafico: true
    },
    'stock-valorizado': {
        titulo: 'Stock Valorizado',
        icono: 'bi-box-seam',
        endpoint: '/reportes/stock-valorizado',
        filtros: ['categoria', 'con_stock'],
        columnas: ['SKU', 'Producto', 'Categoría', 'Stock', 'Costo Unit.', 'Valor Stock'],
        renderFila: (r) => [
            r.sku || '-', r.nombre, r.categoria || '-',
            r.stock_real + ' ' + (r.unidad_medida || ''),
            '$' + fmt(r.costo_unitario), '$' + fmt(r.valor_stock)
        ],
        renderTotales: (data) => [
            'TOTALES', '', '',
            data.totales.unidades + ' uds',
            data.totales.items + ' items',
            '$' + fmt(data.totales.valor_total)
        ],
        tieneGrafico: false
    }
};

// ============================================================================
// INIT
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    await cargarFiltros();
    renderBotonesReporte();
    setFechasDefault();
});

async function cargarFiltros() {
    try {
        const resp = await fetch(`${API_URL}/reportes/filtros`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (resp.ok) filtrosData = await resp.json();
    } catch (e) {
        console.error('Error cargando filtros:', e);
    }
}

function setFechasDefault() {
    const hoy = new Date();
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    document.getElementById('filtroDesde').value = primerDia.toISOString().split('T')[0];
    document.getElementById('filtroHasta').value = hoy.toISOString().split('T')[0];
}

// ============================================================================
// BOTONES DE REPORTE
// ============================================================================

function renderBotonesReporte() {
    const container = document.getElementById('botonesReporte');
    container.innerHTML = Object.entries(REPORTES).map(([key, cfg]) => `
        <button class="btn btn-outline-primary btn-reporte" data-reporte="${key}" onclick="seleccionarReporte('${key}')">
            <i class="bi ${cfg.icono}"></i>
            <span>${cfg.titulo}</span>
        </button>
    `).join('');
}

function seleccionarReporte(key) {
    reporteActual = key;
    const cfg = REPORTES[key];

    // Highlight botón activo
    document.querySelectorAll('.btn-reporte').forEach(b => {
        b.classList.toggle('active', b.dataset.reporte === key);
        b.classList.toggle('btn-primary', b.dataset.reporte === key);
        b.classList.toggle('btn-outline-primary', b.dataset.reporte !== key);
    });

    // Mostrar/ocultar filtros según el reporte
    const tieneFechas = cfg.filtros.includes('fechas');
    const tieneVendedor = cfg.filtros.includes('vendedor');
    const tieneFormaPago = cfg.filtros.includes('forma_pago');
    const tieneOrden = cfg.filtros.includes('orden');
    const tieneCategoria = cfg.filtros.includes('categoria');
    const tieneSubcategoria = tieneCategoria; // Bloque 7.3a: subcategoria sigue a categoria (mismo catalogo plano)
    const tieneConStock = cfg.filtros.includes('con_stock');

    toggle('grupoFechas', tieneFechas);
    toggle('grupoFechasHasta', tieneFechas);
    toggle('grupoVendedor', tieneVendedor);
    toggle('grupoFormaPago', tieneFormaPago);
    toggle('grupoOrden', tieneOrden);
    toggle('grupoCategoria', tieneCategoria);
    toggle('grupoSubcategoria', tieneSubcategoria); // Bloque 7.3a
    toggle('grupoConStock', tieneConStock);

    // Llenar combos dinámicos
    if (tieneVendedor) llenarSelect('filtroVendedor', filtrosData.vendedores, 'id_usuario', 'nombre', 'Todos');
    if (tieneFormaPago) llenarSelect('filtroFormaPago', filtrosData.formas_pago, 'id_forma_pago', 'nombre', 'Todas');
    if (tieneCategoria) llenarSelect('filtroCategoria', filtrosData.categorias, 'id_categoria', 'nombre', 'Todas');
    // Bloque 7.3a: mismo catalogo plano para subcategoria
    if (tieneSubcategoria) llenarSelect('filtroSubcategoria', filtrosData.categorias, 'id_categoria', 'nombre', 'Todas');

    document.getElementById('panelFiltros').style.display = 'block';
    document.getElementById('panelResultados').style.display = 'none';

    // Título
    document.getElementById('tituloReporte').innerHTML = `<i class="bi ${cfg.icono}"></i> ${cfg.titulo}`;
}

// ============================================================================
// EJECUTAR REPORTE
// ============================================================================

async function ejecutarReporte() {
    if (!reporteActual) return;
    const cfg = REPORTES[reporteActual];
    const params = new URLSearchParams();

    // Recoger filtros
    if (cfg.filtros.includes('fechas')) {
        const desde = document.getElementById('filtroDesde').value;
        const hasta = document.getElementById('filtroHasta').value;
        if (!desde || !hasta) {
            alert('Seleccione fechas desde/hasta');
            return;
        }
        params.set('desde', desde);
        params.set('hasta', hasta);
    }
    if (cfg.filtros.includes('vendedor')) {
        const v = document.getElementById('filtroVendedor').value;
        if (v) params.set('vendedor', v);
    }
    if (cfg.filtros.includes('forma_pago')) {
        const fp = document.getElementById('filtroFormaPago').value;
        if (fp) params.set('forma_pago', fp);
    }
    if (cfg.filtros.includes('orden')) {
        params.set('orden', document.getElementById('filtroOrden').value);
    }
    if (cfg.filtros.includes('categoria')) {
        const cat = document.getElementById('filtroCategoria').value;
        if (cat) params.set('categoria', cat);
        // Bloque 7.3a: si hay filtro de categoria, tambien va subcategoria
        const subcat = document.getElementById('filtroSubcategoria').value;
        if (subcat) params.set('subcategoria', subcat);
    }
    if (cfg.filtros.includes('con_stock')) {
        params.set('con_stock', document.getElementById('filtroConStock').checked ? 'true' : 'false');
    }

    // Loading
    const btnGen = document.getElementById('btnGenerar');
    const textoOriginal = btnGen.innerHTML;
    btnGen.disabled = true;
    btnGen.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generando...';

    try {
        const resp = await fetch(`${API_URL}${cfg.endpoint}?${params}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.error || `HTTP ${resp.status}`);
        }

        datosActuales = await resp.json();
        renderResultados(cfg, datosActuales);
        document.getElementById('panelResultados').style.display = 'block';

    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
    } finally {
        btnGen.disabled = false;
        btnGen.innerHTML = textoOriginal;
    }
}

// ============================================================================
// RENDER RESULTADOS
// ============================================================================

function renderResultados(cfg, data) {
    const filas = data.filas || data; // ranking devuelve array directo

    // Tabla
    const thead = cfg.columnas.map(c => `<th>${c}</th>`).join('');
    const tbody = (Array.isArray(filas) ? filas : []).map((r, i) => {
        const celdas = cfg.renderFila(r, i).map(v => `<td>${v}</td>`).join('');
        return `<tr>${celdas}</tr>`;
    }).join('');

    let tfoot = '';
    if (cfg.renderTotales && (data.totales !== undefined || data.total_monto !== undefined)) {
        const totCeldas = cfg.renderTotales(data).map(v => `<td class="fw-bold">${v}</td>`).join('');
        tfoot = `<tfoot class="table-dark"><tr>${totCeldas}</tr></tfoot>`;
    }

    document.getElementById('tablaResultados').innerHTML = `
        <table class="table table-sm table-striped table-hover mb-0 align-middle">
            <thead class="table-light"><tr>${thead}</tr></thead>
            <tbody>${tbody || '<tr><td colspan="' + cfg.columnas.length + '" class="text-center text-muted py-3">Sin datos para el período</td></tr>'}</tbody>
            ${tfoot}
        </table>
    `;

    // Contador
    const total = Array.isArray(filas) ? filas.length : 0;
    document.getElementById('contadorResultados').textContent = total + ' registros';

    // Gráfico
    const chartContainer = document.getElementById('chartContainer');
    if (cfg.tieneGrafico && total > 0) {
        chartContainer.style.display = 'block';
        renderGrafico(cfg, filas);
    } else {
        chartContainer.style.display = 'none';
    }
}

// ============================================================================
// GRÁFICOS
// ============================================================================

let chartInstance = null;

function renderGrafico(cfg, filas) {
    const ctx = document.getElementById('chartReporte');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    let labels, datos, tipo;

    if (reporteActual === 'ventas-periodo') {
        labels = filas.map(r => new Date(r.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }));
        datos = filas.reverse().map(r => parseFloat(r.monto_total));
        tipo = 'bar';
    } else {
        // Categoría, vendedor, forma de pago → top 10 pie/doughnut
        const top = filas.slice(0, 10);
        labels = top.map(r => r.categoria || r.vendedor || r.forma_pago || '?');
        datos = top.map(r => parseFloat(r.monto || r.monto_total || 0));
        tipo = 'doughnut';
    }

    const colores = [
        '#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed',
        '#0891b2', '#be185d', '#65a30d', '#c2410c', '#6366f1'
    ];

    chartInstance = new Chart(ctx, {
        type: tipo,
        data: {
            labels,
            datasets: [{
                data: datos,
                backgroundColor: tipo === 'bar' ? 'rgba(37,99,235,0.7)' : colores,
                borderRadius: tipo === 'bar' ? 4 : 0,
                borderWidth: tipo === 'doughnut' ? 2 : 0,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: tipo === 'doughnut', position: 'right' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.raw;
                            return (ctx.label || '') + ': $' + fmt(v);
                        }
                    }
                }
            },
            ...(tipo === 'bar' ? {
                scales: {
                    y: { beginAtZero: true, ticks: { callback: v => '$' + fmtInt(v) } },
                    x: { grid: { display: false } }
                }
            } : {})
        }
    });
}

// ============================================================================
// EXPORT CSV
// ============================================================================

function exportarCSV() {
    if (!reporteActual || !datosActuales) return;
    const cfg = REPORTES[reporteActual];
    const filas = datosActuales.filas || datosActuales;
    if (!Array.isArray(filas) || filas.length === 0) return;

    let csv = cfg.columnas.join(';') + '\n';
    filas.forEach((r, i) => {
        const vals = cfg.renderFila(r, i).map(v => {
            let s = String(v).replace(/\$/g, '').replace(/;/g, ',');
            return s;
        });
        csv += vals.join(';') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cfg.titulo.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ============================================================================
// UTILS
// ============================================================================

function fmt(n) {
    return parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
    return parseInt(n || 0).toLocaleString('es-AR');
}

function toggle(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
}

function llenarSelect(id, items, valueKey, textKey, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
        items.map(i => `<option value="${i[valueKey]}">${i[textKey]}</option>`).join('');
}
