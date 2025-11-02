// =======================================================================
//                    LIBRO IVA VENTAS - ERP LAGO
// =======================================================================

const API_URL = 'http://72.60.148.18:3000/api';
let datosLibroIVA = null;

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacion();
    
    // Establecer fecha actual
    const hoy = new Date().toISOString().split('T')[0];
    const primerDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    
    document.getElementById('fecha_desde').value = primerDiaMes;
    document.getElementById('fecha_hasta').value = hoy;
    
    // Cargar automáticamente
    cargarLibroIVA();
});

async function cargarLibroIVA() {
    const fecha_desde = document.getElementById('fecha_desde').value;
    const fecha_hasta = document.getElementById('fecha_hasta').value;
    const tipo_factura = document.getElementById('tipo_factura').value;
    const incluir_anuladas = document.getElementById('incluir_anuladas').checked;

    if (!fecha_desde || !fecha_hasta) {
        alert('Debe seleccionar un rango de fechas');
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
            fecha_desde,
            fecha_hasta,
            incluir_anuladas: incluir_anuladas ? 'true' : 'false'
        });

        if (tipo_factura) params.append('tipo_factura', tipo_factura);

        const response = await fetch(`${API_URL}/libro-iva/ventas?${params}`, {
            headers: {'Authorization': `Bearer ${token}`}
        });

        if (response.ok) {
            datosLibroIVA = await response.json();
            mostrarLibroIVA(datosLibroIVA);
            mostrarTotales(datosLibroIVA.totales);
        } else {
            alert('Error al cargar libro IVA');
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar libro IVA');
    }
}

function mostrarLibroIVA(datos) {
    const tbody = document.getElementById('tablaLibroIVA');
    const footer = document.getElementById('footerTotales');

    if (datos.facturas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No hay comprobantes en el período seleccionado</td></tr>';
        footer.style.display = 'none';
        return;
    }

    tbody.innerHTML = datos.facturas.map(f => {
        const fecha = new Date(f.fecha_emision).toLocaleDateString('es-AR');
        const claseAnulada = f.anulada ? 'anulada' : '';
        
        return `
            <tr class="${claseAnulada}">
                <td>${fecha}</td>
                <td><span class="badge bg-primary">${f.tipo_factura}</span></td>
                <td>${f.numero_completo}</td>
                <td>${f.cliente || 'Consumidor Final'}</td>
                <td>${f.cuit_cuil || '-'}</td>
                <td>${f.condicion_iva}</td>
                <td class="text-end">$${parseFloat(f.subtotal).toFixed(2)}</td>
                <td class="text-end">$${parseFloat(f.iva_monto).toFixed(2)}</td>
                <td class="text-end fw-bold">$${parseFloat(f.total).toFixed(2)}</td>
            </tr>
        `;
    }).join('');

    // Mostrar totales en footer
    document.getElementById('totalNeto').textContent = `$${datos.totales.subtotal_total.toFixed(2)}`;
    document.getElementById('totalIVA').textContent = `$${datos.totales.iva_total.toFixed(2)}`;
    document.getElementById('totalGeneral').textContent = `$${datos.totales.total_general.toFixed(2)}`;
    footer.style.display = '';
}

function mostrarTotales(totales) {
    const container = document.getElementById('totalesResumen');
    
    let html = `
        <div class="col-md-3">
            <div class="card totales-card">
                <div class="card-body">
                    <h6>Comprobantes</h6>
                    <h3>${totales.cantidad_comprobantes}</h3>
                    <small>Total emitidos</small>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card totales-card">
                <div class="card-body">
                    <h6>Neto Gravado</h6>
                    <h3>$${totales.subtotal_total.toFixed(2)}</h3>
                    <small>Sin IVA</small>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card totales-card">
                <div class="card-body">
                    <h6>IVA Débito Fiscal</h6>
                    <h3>$${totales.iva_total.toFixed(2)}</h3>
                    <small>A ingresar</small>
                </div>
            </div>
        </div>
        <div class="col-md-3">
            <div class="card totales-card">
                <div class="card-body">
                    <h6>Total General</h6>
                    <h3>$${totales.total_general.toFixed(2)}</h3>
                    <small>Facturación período</small>
                </div>
            </div>
        </div>
    `;

    // Agregar detalle por tipo
    if (Object.keys(totales.por_tipo).length > 0) {
        html += '<div class="col-12 mt-3"><div class="card"><div class="card-header bg-light"><h6 class="mb-0">Detalle por Tipo de Comprobante</h6></div><div class="card-body"><div class="row">';
        
        Object.entries(totales.por_tipo).forEach(([tipo, datos]) => {
            html += `
                <div class="col-md-4">
                    <div class="stat-box border">
                        <strong>${tipo}</strong>
                        <p class="mb-1">Cantidad: ${datos.cantidad}</p>
                        <p class="mb-1">Subtotal: $${datos.subtotal.toFixed(2)}</p>
                        <p class="mb-1">IVA: $${datos.iva.toFixed(2)}</p>
                        <p class="mb-0"><strong>Total: $${datos.total.toFixed(2)}</strong></p>
                    </div>
                </div>
            `;
        });
        
        html += '</div></div></div></div>';
    }

    container.innerHTML = html;
}

function exportarExcel() {
    if (!datosLibroIVA || !datosLibroIVA.facturas || datosLibroIVA.facturas.length === 0) {
        alert('No hay datos para exportar');
        return;
    }

    // Preparar datos para Excel
    const datos = datosLibroIVA.facturas.map(f => ({
        'Fecha': new Date(f.fecha_emision).toLocaleDateString('es-AR'),
        'Tipo': f.tipo_factura,
        'Nro. Comprobante': f.numero_completo,
        'Cliente': f.cliente || 'Consumidor Final',
        'CUIT': f.cuit_cuil || '-',
        'Cond. IVA': f.condicion_iva,
        'Neto Gravado': parseFloat(f.subtotal).toFixed(2),
        'IVA': parseFloat(f.iva_monto).toFixed(2),
        'Total': parseFloat(f.total).toFixed(2),
        'Estado': f.anulada ? 'ANULADA' : 'VIGENTE'
    }));

    // Agregar fila de totales
    datos.push({});
    datos.push({
        'Fecha': '',
        'Tipo': '',
        'Nro. Comprobante': '',
        'Cliente': '',
        'CUIT': '',
        'Cond. IVA': 'TOTALES:',
        'Neto Gravado': datosLibroIVA.totales.subtotal_total.toFixed(2),
        'IVA': datosLibroIVA.totales.iva_total.toFixed(2),
        'Total': datosLibroIVA.totales.total_general.toFixed(2),
        'Estado': ''
    });

    // Crear libro Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);

    // Ajustar anchos de columna
    ws['!cols'] = [
        {wch: 12}, {wch: 15}, {wch: 18}, {wch: 30},
        {wch: 15}, {wch: 12}, {wch: 15}, {wch: 15},
        {wch: 15}, {wch: 10}
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Libro IVA Ventas');

    // Descargar
    const fecha_desde = document.getElementById('fecha_desde').value;
    const fecha_hasta = document.getElementById('fecha_hasta').value;
    const filename = `Libro_IVA_Ventas_${fecha_desde}_${fecha_hasta}.xlsx`;
    
    XLSX.writeFile(wb, filename);
}
