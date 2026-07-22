/**
 * FACTURAS.JS - ERP LAGO
 * Frontend: Facturación Masiva + Historial
 *
 * FIXES v2:
 *   - Columna "Factura" en tab masivo corregida (estaba vacía)
 *   - Botón imprimir factura AFIP-compliant en historial
 *   - Búsqueda q en historial funcional
 *   - CAE real en resultados masivos
 *   - Indicador AFIP offline si aplica
 */

const API_URL = window.CONFIG?.API_BASE_URL || '/api';
const TOKEN = localStorage.getItem('authToken');

// Estado global
let pedidosCargados = [];
let pedidosSeleccionados = new Set();
let contadores = {};
let resumenDia = {};
let incluirCancelados = false;

// Métodos de pago (metodosdepago table IDs)
const METODOS_PAGO = [
    { id: 1, nombre: 'Efectivo', color: 'success', icono: 'cash-stack' },
    { id: 2, nombre: 'Mercado Pago', color: 'info', icono: 'phone' },
    { id: 3, nombre: 'Transferencia', color: 'primary', icono: 'bank' },
    { id: 4, nombre: 'Tarjeta Crédito', color: 'warning', icono: 'credit-card' },
    { id: 5, nombre: 'Tarjeta Débito', color: 'warning', icono: 'credit-card-2-front' },
    { id: 6, nombre: 'Cuenta Corriente', color: 'secondary', icono: 'journal-text' }
];

// ========================================
// INICIALIZACIÓN
// ========================================
document.addEventListener('DOMContentLoaded', function() {
    if (!TOKEN) {
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }
    // Fecha de hoy (local, no UTC)
    const hoy = fechaLocalISO();
    document.getElementById('filtroFechaDesde').value = hoy;
    document.getElementById('filtroFechaHasta').value = hoy;

    configurarEventosMasivo();
    cargarFiltroMetodosPago();
    buscarPedidos();
});

// Cargar métodos de pago desde BD (Bug 17 — no hardcodear en HTML)
async function cargarFiltroMetodosPago() {
    try {
        const resp = await fetch(`${API_URL}/facturas/metodos-pago`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        if (!resp.ok) return;
        const metodos = await resp.json();
        const select = document.getElementById('filtroMetodoPago');
        if (!select) return;
        const valorActual = select.value;
        select.innerHTML = '<option value="">Todos</option>';
        metodos.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id_metodo_pago;
            opt.textContent = m.nombre;
            select.appendChild(opt);
        });
        if (valorActual) select.value = valorActual;

        // Actualizar cache global de métodos para renderBadgesPago
        if (Array.isArray(metodos) && metodos.length > 0) {
            METODOS_PAGO.length = 0;
            metodos.forEach(m => {
                const colores = {1:'success', 2:'info', 3:'primary', 4:'warning', 5:'warning', 6:'secondary'};
                METODOS_PAGO.push({
                    id: m.id_metodo_pago,
                    nombre: m.nombre,
                    color: colores[m.id_metodo_pago] || 'dark',
                    icono: 'cash-stack'
                });
            });
        }
    } catch (e) { /* mantener opciones HTML por defecto */ }
}

function configurarEventosMasivo() {
    // Enter en búsqueda
    document.getElementById('filtroBusqueda').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') buscarPedidos();
    });

    // Atajos de teclado
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F5' && !e.ctrlKey) {
            e.preventDefault();
            buscarPedidos();
        }
    });
}

// ========================================
// BUSCAR PEDIDOS PARA FACTURAR
// ========================================
async function buscarPedidos() {
    const fechaDesde = document.getElementById('filtroFechaDesde').value;
    const fechaHasta = document.getElementById('filtroFechaHasta').value;
    const metodoPago = document.getElementById('filtroMetodoPago').value;
    const estado = document.getElementById('filtroEstado').value;
    const busqueda = document.getElementById('filtroBusqueda').value;

    const params = new URLSearchParams();
    if (fechaDesde) params.append('fecha_desde', fechaDesde);
    if (fechaHasta) params.append('fecha_hasta', fechaHasta);
    if (metodoPago) params.append('id_metodo_pago', metodoPago);
    if (estado) params.append('estado', estado);
    if (busqueda) params.append('q', busqueda);
    if (incluirCancelados) params.append('incluir_cancelados', '1');
    params.append('limit', '500');

    document.getElementById('tablaPedidos').innerHTML = `
        <tr><td colspan="10" class="text-center py-4">
            <div class="spinner-border text-success"></div>
            <p class="mt-2 mb-0">Buscando pedidos...</p>
        </td></tr>`;

    try {
        const response = await fetch(`${API_URL}/facturas/pedidos-facturables?${params}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        if (!response.ok) throw new Error(`Error ${response.status}`);

        const data = await response.json();
        pedidosCargados = data.ventas || [];
        contadores = data.contadores || {};
        resumenDia = data.resumen || {};

        pedidosSeleccionados.clear();
        renderizarContadores(contadores);
        renderizarResumen(resumenDia);
        renderizarPedidos(pedidosCargados);
        actualizarBarraAcciones();

    } catch (error) {
        document.getElementById('tablaPedidos').innerHTML = `
            <tr><td colspan="10" class="text-center text-danger py-4">
                <i class="bi bi-exclamation-triangle fs-3"></i>
                <p class="mt-2">${error.message}</p>
            </td></tr>`;
    }
}

// ========================================
// RENDERIZAR
// ========================================
function renderizarContadores(c) {
    const container = document.getElementById('contadoresBadges');
    const badges = [
        { key: 'todos', label: 'Todos', color: 'dark', filtro: 'todos' },
        { key: 'sin_pago', label: 'Sin pago', color: 'secondary', filtro: 'sin_pago' },
        { key: 'pendiente_confirmar', label: 'Pend. confirmar', color: 'warning', filtro: 'pendiente_confirmar' },
        { key: 'confirmado', label: 'Confirmados', color: 'success', filtro: 'confirmado' },
        { key: 'fiado', label: 'Fiado', color: 'danger', filtro: 'fiado' },
        { key: 'parcial', label: 'Parcial', color: 'info', filtro: 'parcial' },
        { key: 'facturado', label: 'Facturado', color: 'primary', filtro: 'facturado' },
        { key: 'items_negativos', label: 'Items (—)', color: 'info', filtro: 'items_negativos' }
    ];

    const badgesHTML = badges.map(b => `
        <button class="btn btn-sm btn-outline-${b.color} ${document.getElementById('filtroEstado').value === b.filtro ? 'active' : ''}"
                onclick="filtrarPorEstado('${b.filtro}')">
            ${b.label} <span class="badge bg-${b.color}">${c[b.key] || 0}</span>
        </button>
    `).join('');

    // Toggle de cancelados: siempre visible si hay cancelados en el rango
    const cantCancelados = parseInt(c.cancelados) || 0;
    const canceladosHTML = cantCancelados > 0 ? `
        <span class="ms-2 border-start ps-2 d-inline-flex align-items-center gap-1">
            <div class="form-check form-switch mb-0 d-inline-flex align-items-center">
                <input class="form-check-input" type="checkbox" id="toggleCancelados"
                       ${incluirCancelados ? 'checked' : ''}
                       onchange="toggleIncluirCancelados(this.checked)"
                       style="cursor:pointer;">
                <label class="form-check-label small ms-1" for="toggleCancelados" style="cursor:pointer;">
                    Incluir anulados <span class="badge bg-danger">${cantCancelados}</span>
                </label>
            </div>
        </span>
    ` : '';

    container.innerHTML = badgesHTML + canceladosHTML;
}

function renderizarResumen(r) {
    const container = document.getElementById('resumenDia');
    if (!container || !r.total_vendido || parseFloat(r.total_vendido) === 0) {
        if (container) container.style.display = 'none';
        return;
    }
    container.style.display = 'block';

    // Label dinámico según rango de fechas
    const hoy = fechaLocalISO();
    let labelPeriodo = 'Vendido hoy';
    if (r.fecha_desde && r.fecha_hasta) {
        if (r.fecha_desde === r.fecha_hasta) {
            labelPeriodo = r.fecha_desde === hoy ? 'Vendido hoy' : 'Vendido el ' + formatearSoloFecha(r.fecha_desde);
        } else {
            labelPeriodo = 'Vendido en periodo';
        }
    } else if (!r.fecha_desde && !r.fecha_hasta) {
        labelPeriodo = 'Vendido total';
    }

    container.innerHTML = '<div class="d-flex gap-3 flex-wrap align-items-center">'
        + '<span><strong>' + labelPeriodo + ':</strong> $' + formatearMoneda(r.total_vendido) + ' <small class="text-muted">(' + (r.cantidad || 0) + ' pedidos)</small></span>'
        + '<span class="text-success"><i class="bi bi-cash"></i> Efectivo: $' + formatearMoneda(r.efectivo) + '</span>'
        + '<span class="text-primary"><i class="bi bi-bank"></i> Transf/MP: $' + formatearMoneda(r.transferencia) + '</span>'
        + '<span class="text-warning"><i class="bi bi-credit-card"></i> Tarjeta: $' + formatearMoneda(r.tarjeta) + '</span>'
        + '<span class="text-danger"><i class="bi bi-journal"></i> Fiado: $' + formatearMoneda(r.fiado) + '</span>'
        + '</div>';
}

function renderizarPedidos(ventas) {
    const tbody = document.getElementById('tablaPedidos');

    if (!ventas || ventas.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="10" class="text-center py-4 text-muted">
                <i class="bi bi-inbox fs-1"></i>
                <p class="mt-2">No se encontraron pedidos con los filtros seleccionados</p>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = ventas.map(v => {
        const yaFacturado = v.facturado;
        const yaPresupuestado = v.presupuestado;
        const esCancelado = (v.id_estado === 7 || v.id_estado === -2);
        const deshabilitado = yaFacturado || yaPresupuestado || esCancelado; // Facturados, presupuestados y cancelados NO seleccionables

        // Columna Factura: mostrar número si ya fue facturado, o presupuesto
        let columnaFactura = '-';
        if (yaFacturado && (v.numero_factura || v.factura_numero)) {
            const numFact = v.numero_factura || v.factura_numero;
            columnaFactura = `<a href="ver-factura.html?id=${v.id_factura}" target="_blank" class="badge bg-success text-decoration-none"><i class="bi bi-receipt"></i> ${numFact}</a>`;
        } else if (yaPresupuestado && (v.numero_presupuesto || v.presupuesto_numero)) {
            const numPres = v.numero_presupuesto || v.presupuesto_numero;
            columnaFactura = `<a href="ver-presupuesto.html?id=${v.id_presupuesto}" target="_blank" class="badge bg-primary text-decoration-none"><i class="bi bi-file-earmark-text"></i> ${numPres}</a>`;
        }

        return `
            <tr class="${esCancelado ? 'table-danger bg-opacity-25' : yaFacturado ? 'table-light text-muted' : ''}
                       ${pedidosSeleccionados.has(v.id_pedido) ? 'table-success' : ''}"
                style="cursor:pointer"
                ondblclick="verDetallePedido(${v.id_pedido})">
                <td onclick="event.stopPropagation()">
                    <input type="checkbox" class="form-check-input chk-pedido"
                           value="${v.id_pedido}"
                           ${deshabilitado ? 'disabled' : ''}
                           ${pedidosSeleccionados.has(v.id_pedido) ? 'checked' : ''}
                           onchange="toggleSeleccion(${v.id_pedido}, this.checked)">
                </td>
                <td><strong>#${v.nro_pedido || v.id_pedido}</strong>${v.tiene_modificaciones ? ' <span class="badge bg-warning text-dark" title="Modificado post-venta" style="font-size:0.6rem;vertical-align:top;">⚠</span>' : ''}${v.tiene_items_eliminados ? ' <span class="badge bg-danger" title="Items eliminados" style="font-size:0.6rem;vertical-align:top;">🗑</span>' : ''}${v.tiene_items_negativos ? ' <span class="badge bg-info" title="Tiene items negativos (bonificacion/devolucion)" style="font-size:0.6rem;vertical-align:top;">±</span>' : ''}${(v.id_estado === 7 || v.id_estado === -2) ? ' <span class="badge bg-danger" title="Anulado" style="font-size:0.6rem;vertical-align:top;">✕</span>' : ''}</td>
                <td>${formatearFechaCorta(v.fecha_creacion)}</td>
                <td class="col-vendedor" title="${v.usuario || ''}">${v.usuario || '-'}</td>
                <td>${v.cliente || 'Consumidor Final'}</td>
                <td><small>${v.cuit_cuil || '-'}</small></td>
                <td><small>${v.condicion_iva || '-'}</small></td>
                <td class="fw-bold">$${formatearMoneda(v.total_final)}</td>
                <td>${renderBadgesPago(v.pagos_detalle)}</td>
                <td>${esCancelado ? '<span class="badge bg-danger"><i class="bi bi-x-circle"></i> Anulado</span>' : renderBadgeEstado(v.estado_pago, v)}</td>
                <td><button class="btn btn-sm ${v.tipo_entrega === 'retiro' ? 'btn-outline-secondary' : 'btn-outline-primary'}" onclick="event.stopPropagation();toggleTipoEntrega(${v.id_pedido},'${v.tipo_entrega || 'retiro'}')" title="Click para cambiar">${v.tipo_entrega === 'entrega' ? '🚚' : '🏪'}</button></td>
                <td>${columnaFactura}</td>
                <td class="col-acciones" onclick="event.stopPropagation()">${renderAcciones(v)}</td>
            </tr>`;
    }).join('');
}

function renderBadgesPago(pagos_detalle) {
    if (!pagos_detalle || pagos_detalle.length === 0) {
        return '<span class="badge bg-secondary">Sin pago</span>';
    }

    return pagos_detalle.map(p => {
        const metodo = METODOS_PAGO.find(m => m.id === p.id_metodo) || { color: 'dark', nombre: p.metodo };
        return `<span class="badge bg-${metodo.color} me-1" title="$${formatearMoneda(p.monto)}">
            ${p.metodo}
        </span>`;
    }).join('');
}

function renderBadgeEstado(estado, venta) {
    const mapeo = {
        'sin_pago': { color: 'secondary', texto: 'Sin pago' },
        'fiado': { color: 'danger', texto: 'Fiado' },
        'parcial': { color: 'info', texto: 'Parcial' },
        'pendiente_confirmar': { color: 'warning', texto: 'Pend. confirmar' },
        'confirmado': { color: 'success', texto: 'Confirmado' },
        'facturado': { color: 'primary', texto: 'Facturado' }
    };
    const e = mapeo[estado] || { color: 'dark', texto: estado };
    return `<span class="badge bg-${e.color}">${e.texto}</span>`;
}

// ========================================
// SELECCIÓN
// ========================================
function filtrarPorEstado(estado) {
    document.getElementById('filtroEstado').value = estado;
    pedidosSeleccionados.clear();
    buscarPedidos();
}

function toggleIncluirCancelados(checked) {
    incluirCancelados = checked;
    pedidosSeleccionados.clear();
    buscarPedidos();
}

function toggleSelectAll() {
    const checked = document.getElementById('selectAll').checked;
    pedidosSeleccionados.clear();

    if (checked) {
        pedidosCargados.forEach(v => {
            if (!v.facturado && !v.presupuestado && v.id_estado !== 7 && v.id_estado !== -2) {
                pedidosSeleccionados.add(v.id_pedido);
            }
        });
    }

    document.querySelectorAll('.chk-pedido:not(:disabled)').forEach(chk => {
        chk.checked = checked;
    });

    actualizarBarraAcciones();
    actualizarEstiloFilas();
    calcularResumenSeleccion();
}

function toggleSeleccion(idPedido, checked) {
    if (checked) {
        pedidosSeleccionados.add(idPedido);
    } else {
        pedidosSeleccionados.delete(idPedido);
    }
    actualizarBarraAcciones();
    actualizarEstiloFilas();
    calcularResumenSeleccion();
}

function actualizarEstiloFilas() {
    document.querySelectorAll('.chk-pedido').forEach(chk => {
        const tr = chk.closest('tr');
        if (chk.checked) {
            tr.classList.add('table-success');
        } else {
            tr.classList.remove('table-success');
        }
    });
}

function calcularResumenSeleccion() {
    if (pedidosSeleccionados.size === 0) {
        const el = document.getElementById('resumenSeleccion');
        if (el) el.style.display = 'none';
        return;
    }

    let totalSeleccion = 0;
    const totalesPorMetodo = {};

    pedidosCargados.forEach(v => {
        if (!pedidosSeleccionados.has(v.id_pedido)) return;
        totalSeleccion += parseFloat(v.total_final || 0);
        if (v.pagos_detalle && Array.isArray(v.pagos_detalle)) {
            v.pagos_detalle.forEach(p => {
                const nombre = p.metodo || 'Sin pago';
                totalesPorMetodo[nombre] = (totalesPorMetodo[nombre] || 0) + parseFloat(p.monto || 0);
            });
        }
    });

    let el = document.getElementById('resumenSeleccion');
    if (!el) {
        el = document.createElement('div');
        el.id = 'resumenSeleccion';
        el.className = 'alert alert-success py-2 px-3 mb-2';
        const barra = document.getElementById('barraAcciones') || document.getElementById('resumenDia');
        if (barra) barra.parentNode.insertBefore(el, barra.nextSibling);
        else return;
    }
    el.style.display = 'block';

    const metodosBadges = Object.entries(totalesPorMetodo).map(([nombre, monto]) => {
        const metodo = METODOS_PAGO.find(m => m.nombre === nombre) || { color: 'dark' };
        return '<span class="badge bg-' + metodo.color + ' me-1">' + nombre + ': $' + formatearMoneda(monto) + '</span>';
    }).join('');

    const sinPagoCount = Array.from(pedidosSeleccionados).filter(id => {
        const v = pedidosCargados.find(p => p.id_pedido === id);
        return v && (!v.pagos_detalle || v.pagos_detalle.length === 0);
    }).length;

    el.innerHTML = '<div class="d-flex gap-2 flex-wrap align-items-center">'
        + '<strong><i class="bi bi-check2-square"></i> Seleccion (' + pedidosSeleccionados.size + '):</strong> '
        + '<span class="fw-bold">$' + formatearMoneda(totalSeleccion) + '</span> '
        + metodosBadges
        + (sinPagoCount > 0 ? ' <span class="badge bg-secondary">' + sinPagoCount + ' sin pago</span>' : '')
        + '</div>';
}

function actualizarBarraAcciones() {
    const barra = document.getElementById('barraAcciones');
    const count = pedidosSeleccionados.size;

    if (count === 0) {
        barra.style.display = 'none';
        return;
    }

    barra.style.display = 'block';

    let totalSeleccionado = 0;
    var totalesPorMetodo = {};
    var sinPagoCount = 0;

    pedidosCargados.forEach(function(v) {
        if (!pedidosSeleccionados.has(v.id_pedido)) return;
        if (v.id_estado === 7 || v.id_estado === -2) return;
        totalSeleccionado += parseFloat(v.total_final) || 0;

        if (v.pagos_detalle && Array.isArray(v.pagos_detalle) && v.pagos_detalle.length > 0) {
            v.pagos_detalle.forEach(function(p) {
                var nombre = p.metodo || 'Otro';
                totalesPorMetodo[nombre] = (totalesPorMetodo[nombre] || 0) + parseFloat(p.monto || 0);
            });
        } else {
            sinPagoCount++;
        }
    });

    document.getElementById('seleccionCount').textContent = count;
    document.getElementById('seleccionTotal').textContent = '$' + formatearMoneda(totalSeleccionado);

    // Desglose por forma de pago
    var desgloseEl = document.getElementById('desglosePagosSeleccion');
    if (desgloseEl) {
        var badges = Object.keys(totalesPorMetodo).map(function(nombre) {
            var metodo = METODOS_PAGO.find(function(m) { return m.nombre === nombre; }) || { color: 'dark' };
            return '<span class="badge bg-' + metodo.color + ' me-1">' + nombre + ': $' + formatearMoneda(totalesPorMetodo[nombre]) + '</span>';
        }).join('');
        if (sinPagoCount > 0) {
            badges += ' <span class="badge bg-secondary">' + sinPagoCount + ' sin pago</span>';
        }
        desgloseEl.innerHTML = badges;
    }
}

// ========================================
// FACTURACIÓN MASIVA
// ========================================
async function facturarSeleccionados() {
    const ids = Array.from(pedidosSeleccionados);
    if (ids.length === 0) return;

    const confirmacion = confirm(
        `¿Generar ${ids.length} factura(s) electrónica(s)?\n\n` +
        `Se asignará automáticamente Factura A o B según la condición IVA de cada cliente.\n` +
        `Se solicitará CAE a AFIP para cada comprobante.\n\n` +
        `Total: ${document.getElementById('seleccionTotal').textContent}`
    );
    if (!confirmacion) return;

    mostrarLoading(true, `Generando ${ids.length} facturas...`, 'Solicitando CAE a AFIP...');

    try {
        const response = await fetch(`${API_URL}/facturas/masivo`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pedido_ids: ids })
        });

        const data = await response.json();
        mostrarLoading(false);

        if (data.success) {
            mostrarResultadosOperacion(data, 'factura');
            pedidosSeleccionados.clear();
            buscarPedidos();
        } else if (data.resultados && data.resultados.length > 0) {
            mostrarLoading(false);
            mostrarResultadosOperacion(data, 'factura');
            pedidosSeleccionados.clear();
            buscarPedidos();
        } else {
            alert('Error: ' + (data.error || data.message));
        }
    } catch (error) {
        mostrarLoading(false);
        alert('Error de conexión: ' + error.message);
    }
}

async function presupuestarSeleccionados() {
    const ids = Array.from(pedidosSeleccionados);
    if (ids.length === 0) return;

    const confirmacion = confirm(
        `¿Generar ${ids.length} presupuesto(s)?\n\n` +
        `Documento NO válido como factura.\n` +
        `Vencimiento: 30 días\n` +
        `Total: ${document.getElementById('seleccionTotal').textContent}`
    );
    if (!confirmacion) return;

    mostrarLoading(true, `Generando ${ids.length} presupuestos...`, 'Por favor espere');

    try {
        const response = await fetch(`${API_URL}/presupuestos/masivo`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ pedido_ids: ids })
        });

        const data = await response.json();
        mostrarLoading(false);

        if (data.success) {
            mostrarResultadosOperacion(data, 'presupuesto');
            pedidosSeleccionados.clear();
            buscarPedidos();
        } else if (data.resultados && data.resultados.length > 0) {
            mostrarLoading(false);
            mostrarResultadosOperacion(data, 'presupuesto');
            pedidosSeleccionados.clear();
            buscarPedidos();
        } else {
            alert('Error: ' + (data.error || data.message));
        }
    } catch (error) {
        mostrarLoading(false);
        alert('Error de conexión: ' + error.message);
    }
}

// ========================================
// MODAL DE RESULTADOS
// ========================================
function mostrarResultadosOperacion(data, tipo) {
    const modal = document.getElementById('modalResultados');
    const titulo = document.getElementById('resultadosTitulo');
    const cuerpo = document.getElementById('resultadosCuerpo');

    const esFactura = tipo === 'factura';
    titulo.textContent = `Resultado: ${data.exitosos} ${tipo}(s) generado(s)`;

    let html = `
        <div class="alert ${data.fallidos > 0 ? 'alert-warning' : 'alert-success'}">
            <strong>${data.message}</strong>
        </div>
        <div class="table-responsive">
            <table class="table table-sm">
                <thead class="table-light">
                    <tr>
                        <th>Pedido</th>
                        <th>Estado</th>
                        <th>${esFactura ? 'Factura' : 'Presupuesto'}</th>
                        <th>Cliente</th>
                        <th>Total</th>
                        ${esFactura ? '<th>Tipo</th><th>CAE</th><th></th>' : ''}
                    </tr>
                </thead>
                <tbody>
    `;

    data.resultados.forEach(r => {
        const caeDisplay = r.cae
            ? (r.cae.startsWith('OFFLINE') ? `<span class="badge bg-warning">Interno</span>` : `<code>${r.cae}</code>`)
            : '-';

        html += `<tr class="${r.ok ? '' : 'table-danger'}">
            <td>#${r.nro_pedido || r.id_pedido}</td>
            <td>${r.ok
                ? '<span class="badge bg-success">OK</span>'
                : `<span class="badge bg-danger">Error</span> <small>${r.error}</small>`
            }</td>
            <td>${r.ok ? (r.numero_completo || '-') : '-'}</td>
            <td>${r.cliente || '-'}</td>
            <td>${r.ok ? '$' + formatearMoneda(r.total) : '-'}</td>
            ${esFactura ? `
                <td>${r.ok ? r.tipo || '-' : '-'}</td>
                <td>${r.ok ? caeDisplay : '-'}</td>
                <td>${r.ok ? `<button class="btn btn-sm btn-outline-dark" onclick="imprimirFactura(${r.id_factura})" title="Imprimir"><i class="bi bi-printer"></i></button>` : ''}</td>
            ` : ''}
        </tr>`;
    });

    html += '</tbody></table></div>';

    // Botón imprimir todas las exitosas
    if (esFactura && data.exitosos > 1) {
        const idsExitosos = data.resultados.filter(r => r.ok).map(r => r.id_factura);
        html += `
            <div class="text-end mt-3">
                <button class="btn btn-dark" onclick="imprimirLoteFacturas([${idsExitosos.join(',')}])">
                    <i class="bi bi-printer"></i> Imprimir todas (${data.exitosos})
                </button>
            </div>`;
    }

    cuerpo.innerHTML = html;

    new bootstrap.Modal(modal).show();
}

// ========================================
// HISTORIAL TAB
// ========================================
let historialTipoActual = 'facturas';

async function cargarHistorial(tipo) {
    if (tipo) historialTipoActual = tipo;
    else tipo = historialTipoActual;

    const fechaDesde = document.getElementById('histFechaDesde')?.value || '';
    const fechaHasta = document.getElementById('histFechaHasta')?.value || '';
    const tipoFactura = document.getElementById('histTipoFactura')?.value || '';
    const estadoHist = document.getElementById('histEstado')?.value || '';
    const busqueda = document.getElementById('histBusqueda')?.value || '';
    const tbody = document.getElementById('tablaHistorial');

    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3"><div class="spinner-border text-success"></div></td></tr>';

    try {
        const params = new URLSearchParams();
        if (fechaDesde) params.append('fecha_desde', fechaDesde);
        if (fechaHasta) params.append('fecha_hasta', fechaHasta);
        if (tipoFactura) params.append('id_tipo_factura', tipoFactura);
        if (estadoHist) params.append('estado', estadoHist);
        if (busqueda) params.append('q', busqueda);

        const endpoint = tipo === 'facturas' ? '/facturas' : '/presupuestos';
        const response = await fetch(`${API_URL}${endpoint}?${params}`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });

        if (!response.ok) throw new Error(`Error ${response.status}`);
        const data = await response.json();

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Sin registros</td></tr>';
            return;
        }

        if (tipo === 'facturas') {
            tbody.innerHTML = data.map(f => `
                <tr>
                    <td><strong>${f.numero_completo}</strong></td>
                    <td>${formatearFechaCorta(f.fecha_emision)}</td>
                    <td>${f.cliente || '-'}</td>
                    <td><small>${f.cuit_cuil || '-'}</small></td>
                    <td><span class="badge bg-dark">${f.tipo_factura || '-'}</span></td>
                    <td class="fw-bold">$${formatearMoneda(f.total)}</td>
                    <td>${renderBadgeEstadoFactura(f.estado)}</td>
                    <td>
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-primary" onclick="verDetalleFactura(${f.id_factura})"
                                    title="Ver detalle"><i class="bi bi-eye"></i></button>
                            <button class="btn btn-outline-dark" onclick="imprimirFactura(${f.id_factura})"
                                    title="Imprimir"><i class="bi bi-printer"></i></button>
                        </div>
                    </td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = data.map(p => `
                <tr>
                    <td><strong>${p.numero_completo}</strong></td>
                    <td>${formatearFechaCorta(p.fecha_emision)}</td>
                    <td>${p.cliente || '-'}</td>
                    <td>${formatearSoloFecha(p.fecha_vencimiento)}</td>
                    <td class="fw-bold">$${formatearMoneda(p.total)}</td>
                    <td>${renderBadgeEstadoPresupuesto(p.estado)}</td>
                    <td>${p.id_pedido ? `#${p.nro_pedido || p.id_pedido}` : '-'}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="verDetallePresupuesto(${p.id_presupuesto})"
                                title="Ver"><i class="bi bi-eye"></i></button>
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">${error.message}</td></tr>`;
    }
}

function renderBadgeEstadoFactura(estado) {
    const map = {
        'emitida': 'success', 'anulada': 'danger', 'pagada': 'primary', 'parcial': 'info'
    };
    return `<span class="badge bg-${map[estado] || 'secondary'}">${estado}</span>`;
}

function renderBadgeEstadoPresupuesto(estado) {
    const map = {
        'pendiente': 'warning', 'aprobado': 'success', 'rechazado': 'danger',
        'facturado': 'primary', 'vencido': 'secondary'
    };
    return `<span class="badge bg-${map[estado] || 'dark'}">${estado}</span>`;
}

// ========================================
// DETALLE FACTURA - IVA condicional según tipo
// ========================================
async function verDetalleFactura(id) {
    window.location.href = `ver-factura.html?id=${id}`;
}


async function verDetallePresupuesto(id) {
    window.location.href = `ver-presupuesto.html?id=${id}`;
}


// ========================================
// IMPRESIÓN AFIP-COMPLIANT
// ========================================
// ════════════════════════════════════════════════════
// IMPRESIÓN — Delegada a factura-print.js (módulo compartido)
// Una sola implementación AFIP-compliant con QR local
// ════════════════════════════════════════════════════
async function imprimirFactura(idFactura) {
    await FacturaPrint.imprimir(idFactura);
}

async function imprimirLoteFacturas(ids) {
    await FacturaPrint.imprimirLote(ids);
}



// ========================================
// FILTROS RÁPIDOS DE FECHA
// ========================================
function fechaLocalISO(d) {
    var f = d || new Date();
    return f.getFullYear() + '-' + String(f.getMonth()+1).padStart(2,'0') + '-' + String(f.getDate()).padStart(2,'0');
}

function filtroFechaRapido(tipo) {
    var hoy = new Date();
    var desde, hasta;
    switch(tipo) {
        case 'hoy':
            desde = hasta = fechaLocalISO(hoy);
            break;
        case 'semana':
            var dia = hoy.getDay() || 7; // lunes=1
            var lunes = new Date(hoy);
            lunes.setDate(hoy.getDate() - dia + 1);
            desde = fechaLocalISO(lunes);
            hasta = fechaLocalISO(hoy);
            break;
        case 'mes':
            var primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            desde = fechaLocalISO(primero);
            hasta = fechaLocalISO(hoy);
            break;
        case 'anio':
            desde = hoy.getFullYear() + '-01-01';
            hasta = fechaLocalISO(hoy);
            break;
        case 'todo':
            desde = '';
            hasta = '';
            break;
    }
    document.getElementById('filtroFechaDesde').value = desde;
    document.getElementById('filtroFechaHasta').value = hasta;
    pedidosSeleccionados.clear();
    buscarPedidos();
}

// ========================================
// UTILIDADES
// ========================================
function formatearMoneda(num) {
    return parseFloat(num || 0).toLocaleString('es-AR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });
}

function formatearFechaCorta(fecha) {
    if (!fecha) return '-';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' <small class="text-muted">' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '</small>';
}

function formatearSoloFecha(fecha) {
    if (!fecha) return '-';
    const d = new Date(fecha);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function mostrarLoading(show, titulo = 'Procesando...', subtitulo = '') {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    if (show) {
        document.getElementById('loadingText').textContent = titulo;
        document.getElementById('loadingSubtext').textContent = subtitulo;
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}


// ════════════════════════════════════════════════════════════════
// CONFIRMAR SELECCIONADOS (masivo)
// ════════════════════════════════════════════════════════════════
async function confirmarSeleccionados() {
    const ids = Array.from(pedidosSeleccionados);
    if (ids.length === 0) return;

    if (!confirm('\u00bfConfirmar pagos de ' + ids.length + ' pedido(s)?\n\nSe procesaran solo los que tengan pagos pendientes de confirmar.')) return;

    const confirmables = ids;

    mostrarLoading(true, 'Confirmando ' + confirmables.length + ' pedidos...', 'Procesando pagos...');

    let exitosos = 0;
    let errores = [];

    for (const id of confirmables) {
        try {
            const response = await fetch(API_URL + '/facturas/confirmar-rapido', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_pedido: id })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                exitosos++;
            } else {
                errores.push({ id: id, error: data.error || 'Error desconocido' });
            }
        } catch (error) {
            errores.push({ id: id, error: error.message });
        }
    }

    mostrarLoading(false);

    if (exitosos > 0 && errores.length === 0) {
        mostrarToast('success', exitosos + ' pago(s) confirmado(s) correctamente');
    } else if (exitosos > 0 && errores.length > 0) {
        mostrarToast('warning', exitosos + ' confirmado(s), ' + errores.length + ' con error');
    } else {
        mostrarToast('danger', 'Error al confirmar: ' + (errores[0] ? errores[0].error : 'desconocido'));
    }

    pedidosSeleccionados.clear();
    buscarPedidos();
}
