/**
 * PAGOS A PROVEEDORES v1.0
 * ERP LAGO
 * Frontend Script
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VARIABLES GLOBALES
// ═══════════════════════════════════════════════════════════════════════════════

let proveedorSeleccionado = null;
let facturasPendientes = [];
let facturasSeleccionadas = [];
let formasPago = [];
let formData = { formasPago: [], bancos: [], monedas: [] };
let chequesCartera = [];
let chequesSeleccionados = [];
let formaPagoEditando = null;

const API_BASE = window.CONFIG?.API_BASE_URL || '/api';
const TOKEN = localStorage.getItem('authToken');

// ═══════════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    if (!TOKEN) {
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }
    
    await cargarFormData();
    await cargarProveedoresConSaldo();
    inicializarEventos();
});

async function cargarFormData() {
    try {
        const response = await fetch(`${API_BASE}/pagos-proveedores/form-data`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        const result = await response.json();
        formData = result.data;
        
        llenarSelectBancos();
    } catch (error) {
        console.error('Error cargando form data:', error);
    }
}

function llenarSelectBancos() {
    const select = document.getElementById('chequeBanco');
    if (!select) return;
    
    select.innerHTML = '<option value="">Seleccione banco...</option>';
    formData.bancos.forEach(banco => {
        const option = document.createElement('option');
        option.value = banco.id_banco;
        option.textContent = banco.nombre;
        select.appendChild(option);
    });
}

function inicializarEventos() {
    // Búsqueda de proveedor
    const inputBuscar = document.getElementById('inputBuscarProveedor');
    let timeout;
    
    inputBuscar.addEventListener('input', (e) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => buscarProveedores(e.target.value), 300);
    });
    
    // Atajos de teclado
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F2') {
            e.preventDefault();
            registrarPago();
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVEEDORES
// ═══════════════════════════════════════════════════════════════════════════════

async function cargarProveedoresConSaldo() {
    try {
        const response = await fetch(`${API_BASE}/pagos-proveedores/proveedores-con-saldo`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        const result = await response.json();
        mostrarProveedores(result.data);
    } catch (error) {
        console.error('Error cargando proveedores:', error);
    }
}

async function buscarProveedores(termino) {
    if (!termino || termino.length < 2) {
        await cargarProveedoresConSaldo();
        return;
    }
    
    try {
        const response = await fetch(
            `${API_BASE}/pagos-proveedores/proveedores-con-saldo?q=${encodeURIComponent(termino)}`,
            { headers: { 'Authorization': `Bearer ${TOKEN}` } }
        );
        
        const result = await response.json();
        mostrarProveedores(result.data);
    } catch (error) {
        console.error('Error buscando proveedores:', error);
    }
}

function mostrarProveedores(proveedores) {
    const container = document.getElementById('listaProveedores');
    
    if (proveedorSeleccionado) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    
    if (proveedores.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-check-circle" style="font-size: 2rem;"></i>
                <p>No hay proveedores con saldo pendiente</p>
            </div>
        `;
        return;
    }
    
    // SALDO_NETO_CONTABLE: cifra principal = saldo neto (debe-haber), descomposición como subleyenda
    container.innerHTML = proveedores.slice(0, 10).map(prov => {
        const deudaActiva = parseFloat(prov.saldo_total || 0);
        const saldoFavor  = parseFloat(prov.saldo_a_favor || 0);
        const neto        = parseFloat(prov.saldo_neto != null ? prov.saldo_neto : (deudaActiva - saldoFavor));
        const tieneDeuda  = deudaActiva > 0.01;
        const tieneFavor  = saldoFavor > 0.01;

        // Cifra principal = neto contable
        let claseSaldo, saldoTexto;
        if (Math.abs(neto) < 0.01) {
            claseSaldo = '';
            saldoTexto = '$0,00';
        } else if (neto > 0) {
            claseSaldo = 'deuda';
            saldoTexto = formatearMoneda(neto);
        } else {
            claseSaldo = 'favor';
            saldoTexto = formatearMoneda(Math.abs(neto)) + ' a favor';
        }

        // Descomposición como leyenda chica
        const partes = [];
        if (tieneDeuda) partes.push(`<span class="text-danger">${formatearMoneda(deudaActiva)} deuda</span>`);
        if (tieneFavor) partes.push(`<span class="text-success">${formatearMoneda(saldoFavor)} a favor</span>`);
        const facturasTxt = `${prov.facturas_pendientes||0} fact.`;
        const creditosTxt = (prov.creditos_disponibles||0) > 0 ? ` · ${prov.creditos_disponibles} créd.` : '';

        return `
        <div class="proveedor-card" onclick='seleccionarProveedor(${JSON.stringify(prov).replace(/'/g, "\\'")})'>
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <strong>${prov.razon_social}</strong>
                    <br><small class="text-muted">CUIT: ${prov.cuit}</small>
                </div>
                <div class="text-end">
                    <div class="saldo-badge ${claseSaldo}">${saldoTexto}</div>
                    <small class="text-muted d-block">${facturasTxt}${creditosTxt}</small>
                    ${partes.length ? `<small class="d-block">${partes.join(' · ')}</small>` : ''}
                </div>
            </div>
        </div>
    `;}).join('');
}

function seleccionarProveedor(proveedor) {
    proveedorSeleccionado = proveedor;
    
    // Ocultar lista y mostrar info
    document.getElementById('listaProveedores').style.display = 'none';
    document.getElementById('inputBuscarProveedor').style.display = 'none';
    
    const info = document.getElementById('proveedorSeleccionadoInfo');
    info.style.display = 'block';
    document.getElementById('proveedorNombre').textContent = proveedor.razon_social;
    document.getElementById('proveedorCuit').textContent = `CUIT: ${proveedor.cuit}`;

    // SALDO_NETO_CONTABLE: cifra principal = saldo neto (debe-haber), descomposición debajo
    const deudaActiva = parseFloat(proveedor.saldo_total || 0);
    const saldoFavor  = parseFloat(proveedor.saldo_a_favor || 0);
    const neto        = parseFloat(proveedor.saldo_neto != null ? proveedor.saldo_neto : (deudaActiva - saldoFavor));
    const tieneDeuda  = deudaActiva > 0.01;
    const tieneFavor  = saldoFavor > 0.01;
    const elSaldo     = document.getElementById('proveedorSaldoTotal');
    const elCount     = document.getElementById('proveedorFacturasCount');

    elSaldo.classList.remove('deuda','favor');
    if (Math.abs(neto) < 0.01) {
        elSaldo.textContent = '$0,00';
    } else if (neto > 0) {
        elSaldo.classList.add('deuda');
        elSaldo.textContent = formatearMoneda(neto);
    } else {
        elSaldo.classList.add('favor');
        elSaldo.textContent = formatearMoneda(Math.abs(neto)) + ' a favor empresa';
    }

    // Leyenda con descomposición
    const partes = [];
    partes.push(`${proveedor.facturas_pendientes||0} factura${proveedor.facturas_pendientes==1?'':'s'} pendiente${proveedor.facturas_pendientes==1?'':'s'}`);
    if (tieneDeuda) partes.push(`deuda activa: ${formatearMoneda(deudaActiva)}`);
    if (tieneFavor) partes.push(`saldo a favor: ${formatearMoneda(saldoFavor)} (${proveedor.creditos_disponibles||0} créditos)`);
    elCount.textContent = partes.join(' · ');
    
    // Mostrar contenedores
    document.getElementById('facturasContainer').style.display = 'block';
    document.getElementById('formasPagoContainer').style.display = 'block';
    document.getElementById('resumenPanel').style.display = 'block';
    
    // Cargar facturas
    cargarFacturasPendientes(proveedor.id_proveedor);

    // Cargar créditos disponibles (saldo a favor)
    if (window.CreditosProveedor) window.CreditosProveedor.cargar(proveedor.id_proveedor);
    
    // Agregar primera forma de pago
    if (formasPago.length === 0) {
        agregarFormaPago();
    }
}

function limpiarProveedor() {
    proveedorSeleccionado = null;
    facturasPendientes = [];
    facturasSeleccionadas = [];
    formasPago = [];
    
    document.getElementById('listaProveedores').style.display = 'block';
    document.getElementById('inputBuscarProveedor').style.display = 'block';
    document.getElementById('inputBuscarProveedor').value = '';
    document.getElementById('proveedorSeleccionadoInfo').style.display = 'none';
    document.getElementById('facturasContainer').style.display = 'none';
    document.getElementById('formasPagoContainer').style.display = 'none';
    document.getElementById('resumenPanel').style.display = 'none';
    
    if (window.CreditosProveedor) window.CreditosProveedor.limpiar();

    cargarProveedoresConSaldo();
}

// ═══════════════════════════════════════════════════════════════════════════════
// FACTURAS PENDIENTES
// ═══════════════════════════════════════════════════════════════════════════════

async function cargarFacturasPendientes(idProveedor) {
    try {
        const response = await fetch(
            `${API_BASE}/pagos-proveedores/facturas-pendientes/${idProveedor}`,
            { headers: { 'Authorization': `Bearer ${TOKEN}` } }
        );
        
        const result = await response.json();
        facturasPendientes = result.data;
        mostrarFacturas();
    } catch (error) {
        console.error('Error cargando facturas:', error);
    }
}

function mostrarFacturas() {
    const container = document.getElementById('listaFacturas');
    
    if (facturasPendientes.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-check-circle" style="font-size: 2rem;"></i>
                <p>No hay facturas pendientes</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = facturasPendientes.map((fact, idx) => `
        <div class="factura-row ${fact.estado_vencimiento}" data-idx="${idx}">
            <input type="checkbox" class="factura-check form-check-input" 
                   id="chkFact${idx}" onchange="toggleFactura(${idx})">
            <div class="flex-grow-1 ms-2">
                <div class="d-flex justify-content-between">
                    <strong>${fact.numero_completo || fact.tipo_nombre}</strong>
                    <span class="text-muted">${formatearFecha(fact.fecha_emision)}</span>
                </div>
                <div class="d-flex justify-content-between align-items-center">
                    <small class="text-muted">Vto: ${formatearFecha(fact.fecha_vencimiento)}</small>
                    ${fact.estado_vencimiento === 'vencida' ? 
                        `<span class="dias-vencida vencida">${Math.abs(fact.dias_vencida)} días vencida</span>` : 
                        fact.estado_vencimiento === 'proxima' ? 
                        `<span class="dias-vencida proxima">Vence pronto</span>` : ''
                    }
                </div>
            </div>
            <div class="text-end ms-3">
                <div class="fw-bold">${formatearMoneda(fact.saldo)}</div>
                <input type="number" class="form-control form-control-sm monto-a-pagar" 
                       id="montoFact${idx}" value="${fact.saldo}" step="0.01" 
                       onchange="actualizarMontoFactura(${idx}, this.value)"
                       style="display: none;">
            </div>
        </div>
    `).join('');
}

function toggleFactura(idx) {
    const checkbox = document.getElementById(`chkFact${idx}`);
    const row = document.querySelector(`.factura-row[data-idx="${idx}"]`);
    const inputMonto = document.getElementById(`montoFact${idx}`);
    
    if (checkbox.checked) {
        row.classList.add('selected');
        inputMonto.style.display = 'block';
        
        // Agregar a seleccionadas
        if (!facturasSeleccionadas.find(f => f.idx === idx)) {
            facturasSeleccionadas.push({
                idx,
                id_cuenta: facturasPendientes[idx].id_cuenta,
                monto_a_pagar: parseFloat(facturasPendientes[idx].saldo)
            });
        }
    } else {
        row.classList.remove('selected');
        inputMonto.style.display = 'none';
        
        // Quitar de seleccionadas
        facturasSeleccionadas = facturasSeleccionadas.filter(f => f.idx !== idx);
    }
    
    calcularTotales();
}

function actualizarMontoFactura(idx, valor) {
    const monto = parseFloat(valor) || 0;
    const maxMonto = parseFloat(facturasPendientes[idx].saldo);
    
    // No permitir más del saldo
    if (monto > maxMonto) {
        document.getElementById(`montoFact${idx}`).value = maxMonto;
        mostrarAdvertencia('El monto no puede superar el saldo de la factura');
        return;
    }
    
    // Actualizar en array
    const factura = facturasSeleccionadas.find(f => f.idx === idx);
    if (factura) {
        factura.monto_a_pagar = monto;
    }
    
    calcularTotales();
}

function seleccionarTodas() {
    facturasPendientes.forEach((_, idx) => {
        const checkbox = document.getElementById(`chkFact${idx}`);
        if (!checkbox.checked) {
            checkbox.checked = true;
            toggleFactura(idx);
        }
    });
}

function deseleccionarTodas() {
    facturasPendientes.forEach((_, idx) => {
        const checkbox = document.getElementById(`chkFact${idx}`);
        if (checkbox.checked) {
            checkbox.checked = false;
            toggleFactura(idx);
        }
    });
}

function togglePagoACuenta() {
    const esPagoACuenta = document.getElementById('chkPagoACuenta').checked;
    
    // Deshabilitar/habilitar selección de facturas
    document.querySelectorAll('.factura-row').forEach(row => {
        row.style.opacity = esPagoACuenta ? '0.5' : '1';
        row.style.pointerEvents = esPagoACuenta ? 'none' : 'auto';
    });
    
    if (esPagoACuenta) {
        deseleccionarTodas();
    }
    
    calcularTotales();
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMAS DE PAGO
// ═══════════════════════════════════════════════════════════════════════════════

function agregarFormaPago() {
    const idx = formasPago.length;
    
    // Buscar id_forma_pago de Efectivo (no el primero del array, que viene ordenado alfabeticamente)
    const fpEfectivo = formData.formasPago.find(f =>
        (f.codigo && f.codigo.toLowerCase() === 'efectivo') ||
        (f.nombre && f.nombre.toLowerCase() === 'efectivo')
    );
    formasPago.push({
        idx,
        id_forma_pago: fpEfectivo ? fpEfectivo.id_forma_pago : (formData.formasPago[0]?.id_forma_pago || 1),
        tipo: 'efectivo',
        monto: 0,
        id_banco: null,
        referencia: null,
        cheque_data: null,
        id_cheque_tercero: null
    });
    
    renderizarFormasPago();
}

function renderizarFormasPago() {
    const container = document.getElementById('listaFormasPago');
    
    container.innerHTML = formasPago.map((fp, idx) => `
        <div class="forma-pago-item" data-idx="${idx}">
            <button class="btn btn-sm btn-outline-danger btn-remove" onclick="eliminarFormaPago(${idx})">
                <i class="bi bi-x"></i>
            </button>
            
            <div class="row g-3">
                <div class="col-md-4">
                    <label class="form-label">Forma de Pago</label>
                    <select class="form-select" onchange="cambiarTipoFormaPago(${idx}, this.value)">
                        <option value="efectivo" ${fp.tipo === 'efectivo' ? 'selected' : ''}>Efectivo</option>
                        <option value="transferencia" ${fp.tipo === 'transferencia' ? 'selected' : ''}>Transferencia</option>
                        <option value="cheque_propio" ${fp.tipo === 'cheque_propio' ? 'selected' : ''}>Cheque Propio</option>
                        <option value="cheque_tercero" ${fp.tipo === 'cheque_tercero' ? 'selected' : ''}>Cheque de Tercero</option>
                        <option value="mercadopago" ${fp.tipo === 'mercadopago' ? 'selected' : ''}>Mercado Pago</option>
                    </select>
                </div>
                <div class="col-md-4">
                    <label class="form-label">Monto</label>
                    <input type="number" class="form-control text-end" value="${fp.monto}" 
                           step="0.01" onchange="actualizarMontoFormaPago(${idx}, this.value)">
                </div>
                <div class="col-md-4" id="fpExtra${idx}">
                    ${renderizarCamposExtra(fp)}
                </div>
            </div>
            
            ${fp.tipo === 'cheque_tercero' && fp.cheque_info ? `
                <div class="alert alert-warning mt-2 mb-0">
                    <small>
                        <strong>Cheque:</strong> ${fp.cheque_info.numero_cheque} - 
                        ${fp.cheque_info.banco} - 
                        Vto: ${formatearFecha(fp.cheque_info.fecha_vencimiento)} - 
                        ${formatearMoneda(fp.cheque_info.monto)}
                    </small>
                </div>
            ` : ''}
            
            ${fp.tipo === 'cheque_propio' && fp.cheque_data ? `
                <div class="alert alert-info mt-2 mb-0">
                    <small>
                        <strong>Cheque:</strong> ${fp.cheque_data.numero_cheque} - 
                        Vto: ${formatearFecha(fp.cheque_data.fecha_vencimiento)} - 
                        ${formatearMoneda(fp.monto)}
                    </small>
                </div>
            ` : ''}
        </div>
    `).join('');
}

function renderizarCamposExtra(fp) {
    switch (fp.tipo) {
        case 'transferencia':
        case 'mercadopago':
            return `
                <label class="form-label">Referencia</label>
                <input type="text" class="form-control" value="${fp.referencia || ''}" 
                       placeholder="Nro. operación" 
                       onchange="actualizarReferenciaFormaPago(${fp.idx}, this.value)">
            `;
        case 'cheque_propio':
            return `
                <label class="form-label">&nbsp;</label>
                <button class="btn btn-outline-primary w-100" onclick="abrirModalChequePropio(${fp.idx})">
                    <i class="bi bi-pencil-square"></i> Datos del Cheque
                </button>
            `;
        case 'cheque_tercero':
            return `
                <label class="form-label">&nbsp;</label>
                <button class="btn btn-outline-warning w-100" onclick="abrirModalChequesCartera(${fp.idx})">
                    <i class="bi bi-wallet2"></i> Seleccionar de Cartera
                </button>
            `;
        default:
            return `<label class="form-label">&nbsp;</label><div></div>`;
    }
}

function cambiarTipoFormaPago(idx, tipo) {
    formasPago[idx].tipo = tipo;
    formasPago[idx].cheque_data = null;
    formasPago[idx].id_cheque_tercero = null;
    formasPago[idx].cheque_info = null;
    
    // Buscar id_forma_pago correspondiente
    const fpData = formData.formasPago.find(f => 
        f.codigo?.toLowerCase().includes(tipo) || f.nombre?.toLowerCase().includes(tipo)
    );
    if (fpData) {
        formasPago[idx].id_forma_pago = fpData.id_forma_pago;
    }
    
    renderizarFormasPago();
}

function actualizarMontoFormaPago(idx, valor) {
    formasPago[idx].monto = parseFloat(valor) || 0;
    calcularTotales();
}

function actualizarReferenciaFormaPago(idx, valor) {
    formasPago[idx].referencia = valor;
}

function eliminarFormaPago(idx) {
    formasPago.splice(idx, 1);
    // Reindexar
    formasPago.forEach((fp, i) => fp.idx = i);
    renderizarFormasPago();
    calcularTotales();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHEQUES
// ═══════════════════════════════════════════════════════════════════════════════

function abrirModalChequePropio(idx) {
    formaPagoEditando = idx;
    
    const fp = formasPago[idx];
    document.getElementById('chequeNumero').value = fp.cheque_data?.numero_cheque || '';
    document.getElementById('chequeFechaVto').value = fp.cheque_data?.fecha_vencimiento || '';
    document.getElementById('chequeMonto').value = fp.monto || '';
    document.getElementById('chequeBeneficiario').value = proveedorSeleccionado?.razon_social || '';
    
    const modal = new bootstrap.Modal(document.getElementById('modalChequePropio'));
    modal.show();
}

function confirmarChequePropio() {
    const idx = formaPagoEditando;
    
    const chequeData = {
        id_banco: document.getElementById('chequeBanco').value,
        numero_cheque: document.getElementById('chequeNumero').value,
        fecha_vencimiento: document.getElementById('chequeFechaVto').value,
        beneficiario: document.getElementById('chequeBeneficiario').value
    };
    
    if (!chequeData.id_banco || !chequeData.numero_cheque || !chequeData.fecha_vencimiento) {
        mostrarAdvertencia('Complete todos los campos del cheque');
        return;
    }
    
    formasPago[idx].cheque_data = chequeData;
    formasPago[idx].monto = parseFloat(document.getElementById('chequeMonto').value) || 0;
    
    bootstrap.Modal.getInstance(document.getElementById('modalChequePropio')).hide();
    renderizarFormasPago();
    calcularTotales();
}

async function abrirModalChequesCartera(idx) {
    formaPagoEditando = idx;
    
    try {
        const response = await fetch(`${API_BASE}/pagos-proveedores/cheques-cartera`, {
            headers: { 'Authorization': `Bearer ${TOKEN}` }
        });
        
        const result = await response.json();
        chequesCartera = result.data;
        
        mostrarChequesCartera();
        
        const modal = new bootstrap.Modal(document.getElementById('modalChequesCartera'));
        modal.show();
    } catch (error) {
        console.error('Error cargando cheques:', error);
        mostrarError('Error al cargar cheques en cartera');
    }
}

function mostrarChequesCartera() {
    const container = document.getElementById('listaChequesCartera');
    
    if (chequesCartera.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-wallet2" style="font-size: 2rem;"></i>
                <p>No hay cheques disponibles en cartera</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = chequesCartera.map((cheque, idx) => {
        const yaSeleccionado = chequesSeleccionados.includes(cheque.id_cheque);
        return `
            <div class="cheque-cartera-item ${yaSeleccionado ? 'selected' : ''}" 
                 onclick="toggleChequeCartera(${cheque.id_cheque})">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${cheque.banco}</strong> - Nro. ${cheque.numero_cheque}
                        <br><small class="text-muted">
                            ${cheque.nombre_librador || cheque.cliente_origen || 'Sin datos'}
                        </small>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold">${formatearMoneda(cheque.monto)}</div>
                        <small class="${cheque.estado_vencimiento === 'vencido' ? 'text-danger' : 'text-muted'}">
                            Vto: ${formatearFecha(cheque.fecha_vencimiento)}
                        </small>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function toggleChequeCartera(idCheque) {
    const idx = chequesSeleccionados.indexOf(idCheque);
    if (idx >= 0) {
        chequesSeleccionados.splice(idx, 1);
    } else {
        chequesSeleccionados.push(idCheque);
    }
    mostrarChequesCartera();
}

function confirmarChequesSeleccionados() {
    if (chequesSeleccionados.length === 0) {
        mostrarAdvertencia('Seleccione al menos un cheque');
        return;
    }
    
    // Si hay más de un cheque, agregar formas de pago adicionales
    chequesSeleccionados.forEach((idCheque, i) => {
        const cheque = chequesCartera.find(c => c.id_cheque === idCheque);
        if (!cheque) return;
        
        if (i === 0) {
            // Usar la forma de pago actual
            formasPago[formaPagoEditando].id_cheque_tercero = idCheque;
            formasPago[formaPagoEditando].monto = parseFloat(cheque.monto);
            formasPago[formaPagoEditando].cheque_info = cheque;
        } else {
            // Agregar nueva forma de pago
            formasPago.push({
                idx: formasPago.length,
                id_forma_pago: formasPago[formaPagoEditando].id_forma_pago,
                tipo: 'cheque_tercero',
                monto: parseFloat(cheque.monto),
                id_cheque_tercero: idCheque,
                cheque_info: cheque
            });
        }
    });
    
    bootstrap.Modal.getInstance(document.getElementById('modalChequesCartera')).hide();
    chequesSeleccionados = [];
    renderizarFormasPago();
    calcularTotales();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CÁLCULOS Y TOTALES
// ═══════════════════════════════════════════════════════════════════════════════

function calcularTotales() {
    const esPagoACuenta = document.getElementById('chkPagoACuenta')?.checked;
    
    // Total facturas seleccionadas
    const totalFacturas = esPagoACuenta ? 0 : 
        facturasSeleccionadas.reduce((sum, f) => sum + (f.monto_a_pagar || 0), 0);
    
    // Total formas de pago
    const totalFormas = formasPago.reduce((sum, fp) => sum + (fp.monto || 0), 0);
    
    // Diferencia
    // Saldo a favor aplicado (imputación posterior)
    const totalCreditos = (window.CreditosProveedor ? window.CreditosProveedor.totalSeleccionado() : 0);

    // Diferencia: formas + créditos vs facturas
    const totalCubrir = totalFormas + totalCreditos;
    const diferencia = totalCubrir - totalFacturas;
    
    // Actualizar UI
    document.getElementById('resumenCantFacturas').textContent = 
        esPagoACuenta ? 'A cuenta' : facturasSeleccionadas.length;
    document.getElementById('resumenTotalFacturas').textContent = formatearMoneda(totalFacturas);
    document.getElementById('resumenTotalFormas').textContent = formatearMoneda(totalFormas);

    // Línea dinámica para saldo a favor aplicado
    let lineaCreditos = document.getElementById('resumenLineaCreditos');
    if (totalCreditos > 0) {
        if (!lineaCreditos) {
            const filaFormas = document.getElementById('resumenTotalFormas').parentElement;
            lineaCreditos = document.createElement('div');
            lineaCreditos.id = 'resumenLineaCreditos';
            lineaCreditos.className = 'resumen-row text-success';
            lineaCreditos.innerHTML = '<span>Saldo a favor aplicado</span><span id="resumenCreditosValor" class="fw-bold">$0,00</span>';
            filaFormas.parentNode.insertBefore(lineaCreditos, filaFormas.nextSibling);
        }
        document.getElementById('resumenCreditosValor').textContent = '-' + formatearMoneda(totalCreditos);
        lineaCreditos.style.display = 'flex';
    } else if (lineaCreditos) {
        lineaCreditos.style.display = 'none';
    }

    document.getElementById('resumenTotal').textContent = formatearMoneda(totalCubrir);
    document.getElementById('totalMovil').textContent = formatearMoneda(totalCubrir);
    
    // Mostrar diferencia si no es pago a cuenta
    const rowDiferencia = document.getElementById('resumenDiferencia');
    if (!esPagoACuenta && totalFacturas > 0) {
        rowDiferencia.style.display = 'flex';
        document.getElementById('resumenDiferenciaValor').textContent = formatearMoneda(diferencia);
        rowDiferencia.classList.toggle('ok', Math.abs(diferencia) < 0.01);
    } else {
        rowDiferencia.style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRAR PAGO
// ═══════════════════════════════════════════════════════════════════════════════

async function registrarPago() {
    // Validaciones
    if (!proveedorSeleccionado) {
        mostrarAdvertencia('Seleccione un proveedor');
        return;
    }
    
    const creditosSel = (window.CreditosProveedor ? window.CreditosProveedor.obtenerSeleccion() : []);
    const totalCreditosSel = creditosSel.reduce(function(s, c) { return s + parseFloat(c.monto || 0); }, 0);
    const sinFormas = (formasPago.length === 0 || formasPago.every(fp => !fp.monto));
    if (sinFormas && totalCreditosSel <= 0) {
        mostrarAdvertencia('Agregue al menos una forma de pago o tildá créditos de saldo a favor');
        return;
    }
    
    const esPagoACuenta = document.getElementById('chkPagoACuenta')?.checked;
    
    if (!esPagoACuenta && facturasSeleccionadas.length === 0) {
        mostrarAdvertencia('Seleccione facturas a pagar o marque como pago a cuenta');
        return;
    }
    
    // Validar cheques propios
    for (const fp of formasPago) {
        if (fp.tipo === 'cheque_propio' && !fp.cheque_data) {
            mostrarAdvertencia('Complete los datos del cheque propio');
            return;
        }
        if (fp.tipo === 'cheque_tercero' && !fp.id_cheque_tercero) {
            mostrarAdvertencia('Seleccione un cheque de la cartera');
            return;
        }
    }
    
    // Preparar datos
    const datos = {
        id_proveedor: proveedorSeleccionado.id_proveedor,
        facturas_a_pagar: esPagoACuenta ? [] : facturasSeleccionadas,
        creditos_a_aplicar: creditosSel.map(function(c) { return { id_cuenta_credito: c.id_cuenta_credito, monto: c.monto }; }),
        formas_pago: formasPago.filter(function(fp) { return fp.monto && fp.monto > 0; }).map(fp => ({
            id_forma_pago: fp.id_forma_pago,
            tipo: fp.tipo,
            monto: fp.monto,
            id_banco: fp.cheque_data?.id_banco || null,
            referencia: fp.referencia || null,
            cheque_data: fp.cheque_data || null,
            id_cheque_tercero: fp.id_cheque_tercero || null,
            id_moneda: 1
        })),
        es_pago_a_cuenta: esPagoACuenta,
        observaciones: document.getElementById('inputObservaciones').value
    };
    
    // Deshabilitar botón
    const btn = document.getElementById('btnRegistrarPago');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';
    
    try {
        const response = await fetch(`${API_BASE}/pagos-proveedores`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datos)
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'Error al registrar pago');
        }
        
        mostrarExito(`Pago ${result.data.numero_pago} registrado correctamente`);
        
        // Preguntar si quiere hacer otro pago
        if (confirm('¿Desea registrar otro pago?')) {
            limpiarProveedor();
        } else {
            window.location.href = 'pagos-proveedores-listado.html';
        }
        
    } catch (error) {
        console.error('Error registrando pago:', error);
        mostrarError(error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle"></i> Registrar Pago';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

function formatearMoneda(valor) {
    return new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
    }).format(valor || 0);
}

function formatearFecha(fecha) {
    if (!fecha) return '-';
    return new Date(fecha).toLocaleDateString('es-AR');
}

function mostrarExito(mensaje) {
    mostrarToast(mensaje, 'success');
}

function mostrarError(mensaje) {
    mostrarToast(mensaje, 'danger');
}

function mostrarAdvertencia(mensaje) {
    mostrarToast(mensaje, 'warning');
}

function mostrarToast(mensaje, tipo = 'info') {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '9999';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${tipo} border-0`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${mensaje}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;
    
    container.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { delay: 4000 });
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
}
