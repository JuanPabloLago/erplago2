// ========================================================================
// VENTA RÁPIDA v3.6 - ERP LAGO
// COMPATIBLE 100% CON BACKEND REAL
// - Endpoint: /pedidos/crear/inmediato (API_URL ya incluye /api)
// - Campo correcto: precio_unitario_congelado
// - Solo envía lo que el backend espera
// - ✅ Funciones de pago corregidas
// ========================================================================

const API_URL = window.CONFIG?.API_BASE_URL || 'http://72.60.148.18:3000/api';

let itemsVentaArray = [];
let productos = [];
let clientes = [];
let pagosRegistrados = [];
let listasPreciosDisponibles = [];
let listaSeleccionada = 1;
let resultadosProductosFiltrados = [];
let indiceSeleccionado = -1;
let tipoEntrega = 'retira'; // 'retira' o 'entrega'
let clienteActual = null; // Cliente con datos fiscales

let alertaModal, confirmarModal, modalBuscarCliente;
let confirmarModalRespuesta = null;

// ========================================================================
// INICIALIZACIÓN
// ========================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) { window.location.href = 'login.html'; return; }

    const usuarioEl = document.getElementById('usuarioNombre');
    if (usuarioEl) usuarioEl.textContent = localStorage.getItem('username') || 'Usuario';

    // Modales
    const alertaEl = document.getElementById('alertaModal');
    const confirmarEl = document.getElementById('confirmarModal');
    const buscarClienteEl = document.getElementById('modalBuscarCliente');
    
    if (alertaEl) alertaModal = new bootstrap.Modal(alertaEl);
    if (confirmarEl) confirmarModal = new bootstrap.Modal(confirmarEl);
    if (buscarClienteEl) modalBuscarCliente = new bootstrap.Modal(buscarClienteEl);

    // Event listeners para modales
    const siBtn = document.getElementById('confirmarModalBtnSi');
    const noBtn = document.getElementById('confirmarModalBtnNo');
    
    if (siBtn) siBtn.addEventListener('click', () => {
        if (confirmarModalRespuesta) confirmarModalRespuesta(true);
        if (confirmarModal) confirmarModal.hide();
    });
    
    if (noBtn) noBtn.addEventListener('click', () => {
        if (confirmarModalRespuesta) confirmarModalRespuesta(false);
        if (confirmarModal) confirmarModal.hide();
    });

    if (confirmarEl) {
        confirmarEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (siBtn) siBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (noBtn) noBtn.click();
            }
        });
    }

    const codigoEl = document.getElementById('codigoProducto');
    const listaEl = document.getElementById('listaPrecios');
    const busqClienteEl = document.getElementById('busquedaClienteInput');
    const btnRetiraEl = document.getElementById('btnRetira');
    const btnEntregaEl = document.getElementById('btnEntrega');
    const descuentoPercEl = document.getElementById('descuentoGeneralPorcentaje');
    const descuentoMontoEl = document.getElementById('descuentoGeneralMonto');

    if (codigoEl) {
        codigoEl.addEventListener('keydown', manejarTeclasCodigo);
        codigoEl.addEventListener('input', filtrarProductosEnTiempoReal);
    }
    if (listaEl) listaEl.addEventListener('change', onListaPreciosChange);
    if (busqClienteEl) busqClienteEl.addEventListener('input', filtrarClientesEnTiempoReal);
    if (btnRetiraEl) btnRetiraEl.addEventListener('change', cambiarTipoEntrega);
    if (btnEntregaEl) btnEntregaEl.addEventListener('change', cambiarTipoEntrega);
    if (descuentoPercEl) descuentoPercEl.addEventListener('change', calcularTotal);
    if (descuentoMontoEl) descuentoMontoEl.addEventListener('change', calcularTotal);
    
    document.addEventListener('keydown', manejarAtajosGlobales);

    await obtenerConsumidorFinal();
    await cargarListasPrecios();
    await cargarProductos();
});

// ========================================================================
// BÚSQUEDA Y MANEJO DE PRODUCTOS
// ========================================================================

function manejarTeclasCodigo(event) {
    const codigo = event.target.value.trim().toUpperCase();

    if (event.key === 'Enter') {
        event.preventDefault();
        if (indiceSeleccionado >= 0 && resultadosProductosFiltrados[indiceSeleccionado]) {
            agregarProductoDirecto(resultadosProductosFiltrados[indiceSeleccionado]);
        } else if (codigo) {
            buscarYAgregarProducto(codigo);
        }
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (resultadosProductosFiltrados.length > 0) {
            indiceSeleccionado = Math.min(indiceSeleccionado + 1, resultadosProductosFiltrados.length - 1);
            resaltarProductoSeleccionado();
        }
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        indiceSeleccionado = Math.max(indiceSeleccionado - 1, 0);
        resaltarProductoSeleccionado();
    } else if (event.key === ' ') {
        event.preventDefault();
        if (itemsVentaArray.length > 0) {
            const lastInput = document.getElementById(`cantidad_${itemsVentaArray.length - 1}`);
            if (lastInput) lastInput.focus();
        }
    } else if (event.key === 'Escape') {
        event.preventDefault();
        event.target.value = '';
        const sugerenciasEl = document.getElementById('sugerenciasProductos');
        if (sugerenciasEl) sugerenciasEl.innerHTML = '';
    }
}

function manejarAtajosGlobales(event) {
    if (event.key === 'F2') {
        event.preventDefault();
        const btnGuardar = document.getElementById('btnGuardar');
        if (btnGuardar) btnGuardar.click();
    } else if (event.key === 'F3') {
        event.preventDefault();
        buscarCliente();
    } else if (event.key === 'Escape') {
        event.preventDefault();
        const codigoEl = document.getElementById('codigoProducto');
        if (codigoEl && codigoEl.value) {
            codigoEl.value = '';
            const sugerenciasEl = document.getElementById('sugerenciasProductos');
            if (sugerenciasEl) sugerenciasEl.innerHTML = '';
        } else {
            limpiarVenta();
        }
    }
}

async function filtrarProductosEnTiempoReal() {
    const codigo = document.getElementById('codigoProducto').value.trim().toUpperCase();
    resultadosProductosFiltrados = [];
    indiceSeleccionado = -1;

    if (codigo.length === 0) {
        const sugerenciasEl = document.getElementById('sugerenciasProductos');
        if (sugerenciasEl) sugerenciasEl.innerHTML = '';
        return;
    }

    resultadosProductosFiltrados = productos.filter(p => {
        const sku = (p.sku || '').toUpperCase();
        const nombre = (p.nombre || '').toUpperCase();
        return sku.includes(codigo) || nombre.includes(codigo);
    }).slice(0, 8);

    mostrarSugerenciasProductos();
}

function mostrarSugerenciasProductos() {
    const container = document.getElementById('sugerenciasProductos');
    if (!container) return;
    
    if (resultadosProductosFiltrados.length === 0) {
        container.innerHTML = '';
        return;
    }

    const html = resultadosProductosFiltrados.map((p, idx) => {
        const precio = extraerPrecio(p);
        const precioConIVA = precio > 0 ? (precio * 1.21).toFixed(2) : '0.00';
        return `
            <div class="list-group-item ${idx === indiceSeleccionado ? 'active' : ''}" 
                 style="padding: 8px; border-bottom: 1px solid #eee; cursor: pointer;"
                 onclick="agregarProductoDirecto(resultadosProductosFiltrados[${idx}])">
                <strong>${p.sku || 'S/C'}</strong> - ${p.nombre}
                <span class="float-end">
                    <small class="text-muted">S/IVA: $${precio.toFixed(2)}</small><br>
                    <strong class="text-success">C/IVA: $${precioConIVA}</strong>
                </span>
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="list-group">${html}</div>`;
}

function resaltarProductoSeleccionado() {
    mostrarSugerenciasProductos();
}

async function buscarYAgregarProducto(codigo) {
    const producto = productos.find(p => (p.sku || '').toUpperCase() === codigo);
    if (producto) {
        agregarProductoDirecto(producto);
    } else {
        mostrarAlerta('Producto no encontrado: ' + codigo);
    }
}

async function agregarProductoDirecto(producto) {
    const precio = extraerPrecio(producto);
    
    if (precio <= 0) {
        mostrarAlerta('Producto sin precio en esta lista: ' + (producto.nombre || 'Sin nombre'));
        return;
    }

    const itemExistente = itemsVentaArray.find(i => i.id_producto === producto.id_producto);

    if (itemExistente) {
        itemExistente.cantidad += 1;
    } else {
        itemsVentaArray.push({
            id_producto: producto.id_producto,
            sku: producto.sku || 'S/C',
            nombre: producto.nombre || 'Sin nombre',
            cantidad: 1,
            precio_unitario: precio,
            descuento_porcentaje: 0,
            descuento_monto: 0
        });
    }

    const codigoEl = document.getElementById('codigoProducto');
    if (codigoEl) {
        codigoEl.value = '';
        const sugerenciasEl = document.getElementById('sugerenciasProductos');
        if (sugerenciasEl) sugerenciasEl.innerHTML = '';
    }
    
    mostrarItemsVenta();
    calcularTotal();
    
    if (codigoEl) codigoEl.focus();
}

// ========================================================================
// EXTRAE PRECIO
// ========================================================================

function extraerPrecio(producto) {
    if (producto.precios_listas && Array.isArray(producto.precios_listas)) {
        const precioEnLista = producto.precios_listas.find(pl => pl.id_lista === parseInt(listaSeleccionada));
        if (precioEnLista && precioEnLista.precio) {
            return parseFloat(precioEnLista.precio) || 0;
        }
        if (producto.precios_listas.length > 0) {
            return parseFloat(producto.precios_listas[0].precio) || 0;
        }
    }

    if (producto.precio) {
        return parseFloat(producto.precio) || 0;
    }

    return 0;
}

// ========================================================================
// MOSTRAR ITEMS EN TABLA
// ========================================================================

function mostrarItemsVenta() {
    const tbody = document.getElementById('itemsVentaBody');
    if (!tbody) return;
    
    const sinItems = document.getElementById('sinItems');
    const cantidadItems = document.getElementById('cantidadItems');

    if (itemsVentaArray.length === 0) {
        tbody.innerHTML = '';
        if (sinItems) sinItems.style.display = '';
        if (cantidadItems) cantidadItems.textContent = '0';
        return;
    }

    if (sinItems) sinItems.style.display = 'none';

    const itemsHtml = itemsVentaArray.map((item, index) => {
        const subtotal_bruto = item.cantidad * item.precio_unitario;
        let descuento = 0;
        if (item.descuento_porcentaje > 0) {
            descuento = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento = item.descuento_monto * item.cantidad;
        }
        const subtotal_neto = subtotal_bruto - descuento;
        const descuentoInfo = descuento > 0 ? `<br><small style="color: #dc3545;">-${item.descuento_porcentaje > 0 ? item.descuento_porcentaje.toFixed(1) + '%' : '$' + descuento.toFixed(2)}</small>` : '';

        return `
            <tr>
                <td class="text-center"><small>${index + 1}</small></td>
                <td><small><strong>${item.sku}</strong></small></td>
                <td><small>${item.nombre}</small></td>
                <td class="text-center">
                    <input type="number" id="cantidad_${index}" class="form-control form-control-sm text-center" 
                           value="${item.cantidad}" min="0.01" step="0.01"
                           onchange="cambiarCantidad(${index}, this.value)"
                           onkeydown="if(event.key==='Enter') { cambiarCantidad(${index}, this.value); document.getElementById('codigoProducto').focus(); }">
                </td>
                <td class="text-end">
                    <small>$${item.precio_unitario.toFixed(2)}<br><span style="color: #666; font-size: 10px;">S/IVA</span></small>
                </td>
                <td class="text-center">
                    <input type="number" class="form-control form-control-sm text-center" 
                           value="${item.descuento_porcentaje}" min="0" max="100" step="0.01"
                           onchange="cambiarDescuento(${index}, this.value)">
                </td>
                <td class="text-end">
                    <small>$${subtotal_neto.toFixed(2)}</small>${descuentoInfo}
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-danger" onclick="quitarItem(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    tbody.innerHTML = itemsHtml;
    if (cantidadItems) cantidadItems.textContent = itemsVentaArray.length;
}

function cambiarCantidad(index, cantidad) {
    itemsVentaArray[index].cantidad = parseFloat(cantidad) || 0.01;
    calcularTotal();
    mostrarItemsVenta();
}

function cambiarDescuento(index, descuento) {
    itemsVentaArray[index].descuento_porcentaje = parseFloat(descuento) || 0;
    calcularTotal();
    mostrarItemsVenta();
}

function quitarItem(index) {
    itemsVentaArray.splice(index, 1);
    mostrarItemsVenta();
    calcularTotal();
}

// ========================================================================
// CÁLCULO DE TOTALES (frontend) - Backend recalcula
// ========================================================================

function calcularTotal() {
    let subtotal_sin_descuentos = 0;
    let subtotal_con_dto_items = 0;

    itemsVentaArray.forEach(item => {
        const subtotal_bruto = item.cantidad * item.precio_unitario;
        let descuento_item = 0;

        if (item.descuento_porcentaje > 0) {
            descuento_item = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento_item = item.descuento_monto * item.cantidad;
        }

        subtotal_sin_descuentos += subtotal_bruto;
        subtotal_con_dto_items += (subtotal_bruto - descuento_item);
    });

    const descuentoPercEl = document.getElementById('descuentoGeneralPorcentaje');
    const descuentoMontoEl = document.getElementById('descuentoGeneralMonto');
    
    const dto_gral_porcentaje = descuentoPercEl ? (parseFloat(descuentoPercEl.value) || 0) : 0;
    const dto_gral_monto = descuentoMontoEl ? (parseFloat(descuentoMontoEl.value) || 0) : 0;

    let descuento_general = 0;
    if (dto_gral_porcentaje > 0) {
        descuento_general = subtotal_con_dto_items * (dto_gral_porcentaje / 100);
    }
    if (dto_gral_monto > 0) {
        descuento_general += dto_gral_monto;
    }

    const subtotal_final = subtotal_con_dto_items - descuento_general;
    const iva = subtotal_final * 0.21;
    const total = subtotal_final + iva;

    // Tipo de cliente para mostrar factura A o B/C
    const esResponsableInscripto = clienteActual && clienteActual.id_condicion_iva === 1;

    const resumenSubtotalEl = document.getElementById('resumenSubtotal');
    const resumenNetoEl = document.getElementById('resumenNeto');
    const resumenIVAEl = document.getElementById('resumenIVA');
    const totalVentaFinalEl = document.getElementById('totalVentaFinal');
    const totalVentaEl = document.getElementById('totalVenta');

    if (resumenSubtotalEl) resumenSubtotalEl.textContent = '$' + subtotal_sin_descuentos.toFixed(2);
    if (resumenNetoEl) resumenNetoEl.textContent = '$' + subtotal_final.toFixed(2);
    if (resumenIVAEl) resumenIVAEl.textContent = '$' + iva.toFixed(2);
    if (totalVentaFinalEl) totalVentaFinalEl.textContent = '$' + total.toFixed(2);
    if (totalVentaEl) totalVentaEl.textContent = '$' + total.toFixed(2);

    // Actualizar indicadores visuales de tipo factura
    const labelIVA = document.querySelector('.resumen-linea.iva .resumen-label');
    const badgeFactura = document.getElementById('tipoFacturaIndicador');
    if (labelIVA) labelIVA.textContent = esResponsableInscripto ? 'IVA (21%) Discriminado:' : 'IVA (21%) Incluido:';
    if (badgeFactura) {
        badgeFactura.textContent = esResponsableInscripto ? 'A' : 'B/C';
        badgeFactura.className = esResponsableInscripto ? 'badge bg-primary' : 'badge bg-secondary';
    }

    const descuentos_items = subtotal_sin_descuentos - subtotal_con_dto_items;
    const totalDescuentos = descuentos_items + descuento_general;

    const linea_desc = document.getElementById('resumenDescuentosLinea');
    const resumenDescuentosEl = document.getElementById('resumenDescuentos');
    
    if (linea_desc) {
        if (totalDescuentos > 0) {
            linea_desc.style.display = 'flex';
            if (resumenDescuentosEl) resumenDescuentosEl.textContent = '-$' + totalDescuentos.toFixed(2);
        } else {
            linea_desc.style.display = 'none';
        }
    }
}

// ========================================================================
// LISTAS DE PRECIOS Y CLIENTES
// ========================================================================

async function cargarListasPrecios() {
    try {
        const response = await fetch(`${API_URL}/listas-precios`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error al cargar listas de precios');
        listasPreciosDisponibles = await response.json();
        const select = document.getElementById('listaPrecios');
        if (select) {
            select.innerHTML = listasPreciosDisponibles.map(l =>
                `<option value="${l.id_lista_precio}">${l.nombre}</option>`
            ).join('');
            listaSeleccionada = listasPreciosDisponibles[0]?.id_lista_precio || 1;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function cargarProductos() {
    try {
        const response = await fetch(`${API_URL}/productos/listar?id_lista_precio=${listaSeleccionada}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error al cargar productos');
        productos = await response.json();
    } catch (error) {
        console.error('Error:', error);
    }
}

async function onListaPreciosChange() {
    const listaEl = document.getElementById('listaPrecios');
    if (!listaEl) return;
    
    const nuevoLista = listaEl.value;
    listaSeleccionada = parseInt(nuevoLista);
    
    await cargarProductos();
    
    itemsVentaArray.forEach(item => {
        const producto = productos.find(p => p.id_producto === item.id_producto);
        if (producto) {
            const nuevoPrecio = extraerPrecio(producto);
            if (nuevoPrecio > 0) {
                item.precio_unitario = nuevoPrecio;
            }
        }
    });
    
    mostrarItemsVenta();
    calcularTotal();
}

async function cargarClientes() {
    try {
        const response = await fetch(`${API_URL}/clientes`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error al cargar clientes');
        clientes = await response.json();
    } catch (error) {
        console.error('Error cargando clientes:', error);
        clientes = [];
    }
}

async function obtenerConsumidorFinal() {
    try {
        const response = await fetch(`${API_URL}/clientes`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error');
        const clientesList = await response.json();
        const consumidorFinal = clientesList.find(c =>
            c.razon_social && c.razon_social.toLowerCase().includes('consumidor final')
        );
        if (consumidorFinal) {
            const idClienteEl = document.getElementById('idCliente');
            const clienteNombreEl = document.getElementById('clienteNombre');
            if (idClienteEl) idClienteEl.value = consumidorFinal.id_cliente;
            if (clienteNombreEl) clienteNombreEl.value = consumidorFinal.razon_social;
            clienteActual = consumidorFinal;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function buscarCliente() {
    await cargarClientes();
    
    if (modalBuscarCliente) modalBuscarCliente.show();
    
    const busqEl = document.getElementById('busquedaClienteInput');
    if (busqEl) {
        busqEl.value = '';
        busqEl.focus();
    }
    
    mostrarClientesFiltrados(clientes);
}

async function filtrarClientesEnTiempoReal() {
    const busqueda = document.getElementById('busquedaClienteInput').value.trim().toLowerCase();
    
    if (busqueda.length === 0) {
        mostrarClientesFiltrados(clientes);
        return;
    }

    const clientesFiltrados = clientes.filter(c => {
        const razonSocial = (c.razon_social || '').toLowerCase();
        const cuit = (c.cuit_cuil || '').toLowerCase();
        return razonSocial.includes(busqueda) || cuit.includes(busqueda);
    });

    mostrarClientesFiltrados(clientesFiltrados);
}

function mostrarClientesFiltrados(clientesList) {
    const resultadosEl = document.getElementById('resultadosBusquedaClientes');
    if (!resultadosEl) return;

    if (clientesList.length === 0) {
        resultadosEl.innerHTML = '<div class="p-2 text-muted">No hay resultados</div>';
        return;
    }

    const html = clientesList.map(c => `
        <div class="p-2 border-bottom" style="cursor: pointer;" 
             onmouseover="this.style.backgroundColor='#f0f0f0'" 
             onmouseout="this.style.backgroundColor='white'"
             onclick="seleccionarCliente(${c.id_cliente}, '${c.razon_social.replace(/'/g, "\\'")}')">
            <strong>${c.razon_social}</strong><br>
            <small class="text-muted">${c.cuit_cuil || 'S/D'}</small>
        </div>
    `).join('');
    
    resultadosEl.innerHTML = html;
}

function seleccionarCliente(id, nombre) {
    const idClienteEl = document.getElementById('idCliente');
    const clienteNombreEl = document.getElementById('clienteNombre');
    
    if (idClienteEl) idClienteEl.value = id;
    if (clienteNombreEl) clienteNombreEl.value = nombre;
    
    clienteActual = clientes.find(c => c.id_cliente === id) || null;
    calcularTotal();
    if (modalBuscarCliente) modalBuscarCliente.hide();
}

function cambiarTipoEntrega() {
    const tipoEntregaEl = document.querySelector('input[name="tipoEntrega"]:checked');
    if (tipoEntregaEl) tipoEntrega = tipoEntregaEl.value;
}

// ========================================================================
// MANEJO DE FORMAS DE PAGO
// ========================================================================

let formaPagoActual = null;

/**
 * Clic simple = Pagar TODO el saldo con esta forma de pago
 */
function manejarClicPago(forma, event) {
    event.preventDefault();
    
    const total = obtenerTotalVenta();
    const pagado = obtenerTotalPagado();
    const saldo = total - pagado;
    
    if (saldo <= 0) {
        mostrarAlerta('La venta ya está pagada');
        return;
    }
    
    // Registrar pago por el total pendiente
    registrarPago(forma, saldo);
    actualizarVisualizacionPagos();
    
    // Si ya está totalmente pagado, habilitar botón guardar
    if (obtenerTotalPagado() >= total) {
        mostrarAlerta(`✅ Pago completo con ${formatearFormaPago(forma)}`);
    }
}

/**
 * Doble clic = Pago parcial (muestra input para ingresar monto)
 */
function manejarDobleClicPago(forma, event) {
    event.preventDefault();
    
    const total = obtenerTotalVenta();
    const pagado = obtenerTotalPagado();
    const saldo = total - pagado;
    
    if (saldo <= 0) {
        mostrarAlerta('La venta ya está pagada');
        return;
    }
    
    formaPagoActual = forma;
    
    // Mostrar input de pago parcial
    const inputParcial = document.getElementById('inputPagoParcial');
    const nombreForma = document.getElementById('formaParcialNombre');
    const saldoInfo = document.getElementById('saldoRestanteInfo');
    const montoInput = document.getElementById('montoParcial');
    
    if (inputParcial) inputParcial.style.display = 'block';
    if (nombreForma) nombreForma.textContent = formatearFormaPago(forma);
    if (saldoInfo) saldoInfo.textContent = saldo.toFixed(2);
    if (montoInput) {
        montoInput.value = '';
        montoInput.focus();
    }
}

/**
 * Confirmar pago parcial
 */
function confirmarPagoParcial() {
    const montoInput = document.getElementById('montoParcial');
    const monto = parseFloat(montoInput?.value || 0);
    
    if (monto <= 0) {
        mostrarAlerta('Ingrese un monto válido');
        return;
    }
    
    const total = obtenerTotalVenta();
    const pagado = obtenerTotalPagado();
    const saldo = total - pagado;
    
    if (monto > saldo) {
        mostrarAlerta(`El monto no puede ser mayor al saldo ($${saldo.toFixed(2)})`);
        return;
    }
    
    registrarPago(formaPagoActual, monto);
    actualizarVisualizacionPagos();
    cancelarPagoParcial();
    
    const nuevoSaldo = total - obtenerTotalPagado();
    if (nuevoSaldo <= 0) {
        mostrarAlerta('✅ Venta totalmente pagada');
    } else {
        mostrarAlerta(`Pago parcial registrado. Saldo: $${nuevoSaldo.toFixed(2)}`);
    }
}

/**
 * Cancelar input de pago parcial
 */
function cancelarPagoParcial() {
    const inputParcial = document.getElementById('inputPagoParcial');
    if (inputParcial) inputParcial.style.display = 'none';
    formaPagoActual = null;
}

/**
 * Registrar un pago en el array
 */
function registrarPago(forma, monto) {
    pagosRegistrados.push({
        forma: forma,
        monto: monto,
        fecha: new Date().toISOString()
    });
}

/**
 * Obtener total de la venta actual
 */
function obtenerTotalVenta() {
    const totalEl = document.getElementById('totalVentaFinal') || document.getElementById('totalVenta');
    if (!totalEl) return 0;
    return parseFloat(totalEl.textContent.replace('$', '').trim()) || 0;
}

/**
 * Obtener total ya pagado
 */
function obtenerTotalPagado() {
    return pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
}

/**
 * Formatear nombre de forma de pago
 */
function formatearFormaPago(forma) {
    const nombres = {
        'efectivo': 'Efectivo',
        'debito': 'Débito',
        'credito': 'Crédito',
        'transferencia': 'Transferencia',
        'mercadopago': 'MercadoPago',
        'mercadopago_qr': 'MP QR'
    };
    return nombres[forma] || forma;
}

/**
 * Actualizar visualización de pagos registrados
 */
function actualizarVisualizacionPagos() {
    // Actualizar saldo restante en el input parcial
    const saldoInfo = document.getElementById('saldoRestanteInfo');
    if (saldoInfo) {
        const saldo = obtenerTotalVenta() - obtenerTotalPagado();
        saldoInfo.textContent = saldo.toFixed(2);
    }
    
    // Resaltar botones de formas de pago usadas
    document.querySelectorAll('.forma-pago-btn').forEach(btn => {
        const forma = btn.getAttribute('data-forma');
        const tienesPago = pagosRegistrados.some(p => p.forma === forma);
        
        if (tienesPago) {
            btn.classList.remove('btn-outline-success', 'btn-outline-primary', 
                               'btn-outline-warning', 'btn-outline-info', 'btn-outline-secondary');
            btn.classList.add('btn-success');
        }
    });
}

// ========================================================================
// GUARDAR VENTA - ✅ COMPATIBLE CON BACKEND
// ========================================================================

async function guardarVenta() {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('No hay productos en la venta');
        return;
    }

    const totalVentaFinalEl = document.getElementById('totalVentaFinal');
    const totalVentaEl = document.getElementById('totalVenta');
    
    let totalText = totalVentaFinalEl ? totalVentaFinalEl.textContent : (totalVentaEl ? totalVentaEl.textContent : '$0.00');
    const total = parseFloat(totalText.replace('$', '').trim());

    const idClienteEl = document.getElementById('idCliente');
    const observacionesEl = document.getElementById('observaciones');

    // ✅ FORMATO CORRECTO PARA EL BACKEND
    const datosParaBackend = {
        id_cliente: idClienteEl ? parseInt(idClienteEl.value) : 1,
        items: itemsVentaArray.map(item => ({
            id_producto: item.id_producto,
            cantidad: item.cantidad,
            precio_unitario_congelado: item.precio_unitario  // ✅ NOMBRE CORRECTO
        })),
        observaciones: observacionesEl ? (observacionesEl.value || '') : ''
    };

    // Determinar endpoint según tipo de entrega
    // ✅ CORREGIDO: Sin /api/ porque API_URL ya lo incluye
    const endpoint = tipoEntrega === 'retira' 
        ? '/pedidos/crear/inmediato'      // Retiro inmediato
        : '/pedidos/guardar/entregar';    // Guardar para entregar

    console.log('📤 Enviando a:', endpoint);
    console.log('📦 Datos:', JSON.stringify(datosParaBackend, null, 2));

    try {
        const response = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(datosParaBackend)
        });

        const responseData = await response.json();
        console.log('📥 Respuesta:', responseData);

        if (!response.ok) {
            throw new Error(responseData.error || 'Error al guardar');
        }

        const mensajeExito = tipoEntrega === 'retira'
            ? `✅ Pedido #${responseData.id_pedido} - RETIRO INMEDIATO\nTotal: $${total.toFixed(2)}`
            : `✅ Pedido #${responseData.id_pedido} - PARA ENTREGAR\nTotal: $${total.toFixed(2)}`;

        mostrarAlerta(mensajeExito);
        limpiarVenta();
    } catch (error) {
        console.error('❌ Error:', error);
        mostrarAlerta('❌ Error:\n' + error.message);
    }
}

function limpiarVenta() {
    itemsVentaArray = [];
    pagosRegistrados = [];
    
    // Limpiar visualización de botones de pago
    document.querySelectorAll('.forma-pago-btn').forEach(btn => {
        btn.classList.remove('btn-success');
        // Restaurar clase original según data-forma
        const forma = btn.getAttribute('data-forma');
        const claseOriginal = {
            'efectivo': 'btn-outline-success',
            'debito': 'btn-outline-primary',
            'credito': 'btn-outline-warning',
            'transferencia': 'btn-outline-info',
            'mercadopago': 'btn-outline-secondary',
            'mercadopago_qr': 'btn-outline-secondary'
        }[forma] || 'btn-outline-secondary';
        btn.classList.add(claseOriginal);
    });
    
    const descuentoPercEl = document.getElementById('descuentoGeneralPorcentaje');
    const descuentoMontoEl = document.getElementById('descuentoGeneralMonto');
    const observacionesEl = document.getElementById('observaciones');
    const btnRetiraEl = document.getElementById('btnRetira');

    if (descuentoPercEl) descuentoPercEl.value = 0;
    if (descuentoMontoEl) descuentoMontoEl.value = 0;
    if (observacionesEl) observacionesEl.value = '';
    if (btnRetiraEl) btnRetiraEl.checked = true;

    mostrarItemsVenta();
    calcularTotal();
    obtenerConsumidorFinal();
    
    const codigoEl = document.getElementById('codigoProducto');
    if (codigoEl) codigoEl.focus();
}

// ========================================================================
// MODALES Y UTILIDADES
// ========================================================================

function mostrarAlerta(mensaje, titulo = 'Aviso') {
    const alertaTituloEl = document.getElementById('alertaModalTitulo');
    const alertaMensajeEl = document.getElementById('alertaModalMensaje');
    
    if (alertaTituloEl) alertaTituloEl.textContent = titulo;
    if (alertaMensajeEl) alertaMensajeEl.innerHTML = mensaje.replace(/\n/g, '<br>');
    
    if (alertaModal) {
        alertaModal.show();
    } else {
        alert(mensaje);
    }
}

// ========================================================================
// FIXES SEGUROS v3.7 - Agregados al final
// ========================================================================

// ------------------------------------------------------------------------
// FIX 2: Sistema clic/doble clic con temporizador
// ------------------------------------------------------------------------
let clickTimerPago = null;
const DOBLE_CLIC_DELAY = 300;

function manejarClicPagoUnificado(forma, event) {
    if (event) event.preventDefault();
    
    if (clickTimerPago) {
        clearTimeout(clickTimerPago);
        clickTimerPago = null;
        if (typeof manejarDobleClicPago === 'function') {
            manejarDobleClicPago(forma, event || {preventDefault: function(){}});
        }
    } else {
        clickTimerPago = setTimeout(function() {
            clickTimerPago = null;
            if (typeof manejarClicPago === 'function') {
                manejarClicPago(forma);
            }
        }, DOBLE_CLIC_DELAY);
    }
}

(function initPagosUnificados() {
    var initPagos = function() {
        var formas = ['efectivo', 'debito', 'credito', 'transferencia', 'mercadopago', 'mercadopago_qr'];
        formas.forEach(function(forma) {
            var btn = document.getElementById('btn-' + forma);
            if (btn && !btn.dataset.unificado) {
                btn.dataset.unificado = 'true';
                btn.onclick = function(e) { manejarClicPagoUnificado(forma, e); };
                btn.ondblclick = null;
            }
        });
    };
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPagos);
    } else {
        setTimeout(initPagos, 100);
    }
})();

// ------------------------------------------------------------------------
// FIX 3: Override mostrarSugerenciasProductos para incluir stock
// ------------------------------------------------------------------------
var _mostrarSugerenciasOriginal = typeof mostrarSugerenciasProductos === 'function' 
    ? mostrarSugerenciasProductos : null;

function mostrarSugerenciasProductos() {
    var container = document.getElementById('sugerenciasProductos');
    if (!container) return;

    if (typeof resultadosProductosFiltrados === 'undefined' || resultadosProductosFiltrados.length === 0) {
        container.innerHTML = '';
        return;
    }

    var html = resultadosProductosFiltrados.map(function(p, idx) {
        var precio = typeof extraerPrecio === 'function' ? extraerPrecio(p) : (parseFloat(p.precio) || 0);
        var precioConIVA = precio > 0 ? (precio * 1.21).toFixed(2) : '0.00';
        var stock = parseFloat(p.stock_real) || 0;
        var stockClass = stock <= 0 ? 'text-danger' : (stock < 5 ? 'text-warning' : 'text-success');
        var imgHtml = p.url_imagen 
            ? '<img src="' + p.url_imagen + '" style="width:40px;height:40px;object-fit:cover;margin-right:8px;border-radius:4px;" onerror="this.style.display=\'none\'">'
            : '';
        
        var activo = (typeof indiceSeleccionado !== 'undefined' && idx === indiceSeleccionado) ? 'active' : '';
        
        return '<div class="list-group-item ' + activo + '" ' +
            'style="padding: 8px; border-bottom: 1px solid #eee; cursor: pointer; display: flex; align-items: center;" ' +
            'onclick="agregarProductoDirecto(resultadosProductosFiltrados[' + idx + '])">' +
            imgHtml +
            '<div style="flex: 1;">' +
                '<strong>' + (p.sku || 'S/C') + '</strong> - ' + p.nombre +
                '<br><small class="' + stockClass + '"><i class="bi bi-box"></i> Stock: ' + stock + '</small>' +
            '</div>' +
            '<span class="text-end">' +
                '<small class="text-muted">S/IVA: $' + precio.toFixed(2) + '</small><br>' +
                '<strong class="text-success">C/IVA: $' + precioConIVA + '</strong>' +
            '</span>' +
        '</div>';
    }).join('');

    container.innerHTML = '<div class="list-group">' + html + '</div>';
}

// ========================================================================
// FIN FIXES SEGUROS v3.7
// ========================================================================
