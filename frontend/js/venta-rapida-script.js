// ========================================================================
// VENTA RÁPIDA - ERP LAGO - JavaScript COMPLETO
// CORRECCIONES APLICADAS:
// - Línea 571: Limpia tbody cuando no hay items
// - Línea 1461: Corrige fetch con paréntesis
// - Líneas de template literals corregidas
// ========================================================================

const API_URL = 'http://72.60.148.18:3000/api';
let itemsVentaArray = [];
let productos = [];
let pagosRegistrados = [];
let formaParcialActual = null;
let clickTimer = null;
let listasPreciosDisponibles = [];
let listaSeleccionada = 1;
let resultadosProductosFiltrados = [];
let indiceSeleccionado = -1;
let tipoEntrega = 'retira';
let direccionEntregaTemporal = null;
let modalActualizarDireccion = null;
let modalVentaGuardada = null;
let modalSuspendidos = null;
let pedidoGuardadoId = null;
let accionPendiente = null;

let alertaModal = null;
let confirmarModal = null;
let confirmarModalRespuesta = null;
let modalBuscarCliente = null;
let modalNuevoCliente = null;

let timerBusqueda = null;
let timerBusquedaCliente = null;

const nombresForma = {
    'efectivo': '💵 Efectivo',
    'debito': '💳 Débito',
    'credito': '💳 Crédito',
    'transferencia': '🏦 Transferencia',
    'mercadopago': '💰 Mercado Pago',
    'mercadopago_qr': '📱 MP QR'
};

document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    document.getElementById('usuarioNombre').textContent = localStorage.getItem('username') || 'Usuario';

    alertaModal = new bootstrap.Modal(document.getElementById('alertaModal'));
    confirmarModal = new bootstrap.Modal(document.getElementById('confirmarModal'));
    modalBuscarCliente = new bootstrap.Modal(document.getElementById('modalBuscarCliente'));
    modalNuevoCliente = new bootstrap.Modal(document.getElementById('modalNuevoCliente'));
    modalActualizarDireccion = new bootstrap.Modal(document.getElementById('modalActualizarDireccion'));
    modalVentaGuardada = new bootstrap.Modal(document.getElementById('modalVentaGuardada'));
    modalSuspendidos = new bootstrap.Modal(document.getElementById('modalSuspendidos'));

    document.getElementById('confirmarModalBtnSi').addEventListener('click', () => {
        if (confirmarModalRespuesta) confirmarModalRespuesta(true);
        confirmarModal.hide();
    });
    document.getElementById('confirmarModalBtnNo').addEventListener('click', () => {
        if (confirmarModalRespuesta) confirmarModalRespuesta(false);
        confirmarModal.hide();
    });

    document.getElementById('codigoProducto').addEventListener('keydown', manejarTeclasCodigo);
    document.getElementById('codigoProducto').addEventListener('input', filtrarProductosEnTiempoReal);
    document.getElementById('listaPrecios').addEventListener('change', onListaPreciosChange);
    document.getElementById('busquedaClienteInput').addEventListener('input', filtrarClientesEnTiempoReal);
    document.getElementById('btnRetira').addEventListener('change', cambiarTipoEntrega);
    document.getElementById('btnEntrega').addEventListener('change', cambiarTipoEntrega);
    document.addEventListener('keydown', manejarAtajosGlobales);

    await obtenerConsumidorFinal();
    await cargarListasPrecios();
    await cargarProductos();
});

function manejarTeclasCodigo(event) {
    const input = event.target;
    const codigo = input.value.trim().toUpperCase();

    if (event.key === 'Enter') {
        event.preventDefault();
        if (indiceSeleccionado >= 0 && indiceSeleccionado < resultadosProductosFiltrados.length) {
            agregarProductoDirecto(resultadosProductosFiltrados[indiceSeleccionado]);
            return;
        }
        if (codigo) {
            buscarYAgregarProducto(codigo);
        }
    }
    else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (resultadosProductosFiltrados.length > 0) {
            indiceSeleccionado = Math.min(indiceSeleccionado + 1, resultadosProductosFiltrados.length - 1);
            resaltarProductoSeleccionado();
        }
    }
    else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (resultadosProductosFiltrados.length > 0) {
            indiceSeleccionado = Math.max(indiceSeleccionado - 1, 0);
            resaltarProductoSeleccionado();
        }
    }
    else if (event.key === ' ' && codigo === '') {
        event.preventDefault();
        irACantidadUltimoItem();
    }
    else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = '';
        document.getElementById('sugerenciasProductos').innerHTML = '';
        resultadosProductosFiltrados = [];
        indiceSeleccionado = -1;
    }
}

function manejarAtajosGlobales(event) {
    if (event.key === 'F2') {
        event.preventDefault();
        document.getElementById('btnGuardar').click();
    }
    else if (event.key === 'F3') {
        event.preventDefault();
        buscarCliente();
    }
    else if (event.key === 'Escape') {
        event.preventDefault();
        // Intentar cerrar modal suspendidos si está abierto
        const modalElement = document.getElementById('modalSuspendidos');
        if (modalElement && modalElement.classList.contains('show')) {
            console.log('🔴 ESC presionado - Cerrando modal suspendidos');
            modalSuspendidos.hide();
            limpiarBackdrops();
            return;
        }

        if (document.getElementById('inputPagoParcial').style.display === 'block') {
            cancelarPagoParcial();
        } else {
            const codigo = document.getElementById('codigoProducto');
            if (codigo.value) {
                codigo.value = '';
                document.getElementById('sugerenciasProductos').innerHTML = '';
            } else {
                limpiarVenta();
            }
        }
    }
}

// Función para limpiar backdrops huérfanos
function limpiarBackdrops() {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    console.log('🧹 Limpiando', backdrops.length, 'backdrops');
    backdrops.forEach(b => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
}

function irACantidadUltimoItem() {
    if (itemsVentaArray.length === 0) return;
    const ultimoIndex = itemsVentaArray.length - 1;
    const inputCantidad = document.getElementById(`cantidad_${ultimoIndex}`);
    if (inputCantidad) {
        inputCantidad.focus();
        inputCantidad.select();
    }
}

function filtrarProductosEnTiempoReal(event) {
    const termino = event.target.value.trim().toUpperCase();
    if (timerBusqueda) {
        clearTimeout(timerBusqueda);
    }
    if (termino === '') {
        document.getElementById('sugerenciasProductos').innerHTML = '';
        resultadosProductosFiltrados = [];
        indiceSeleccionado = -1;
        return;
    }
    timerBusqueda = setTimeout(() => {
        filtrarProductos(termino);
    }, 150);
}

function filtrarProductos(termino) {
    resultadosProductosFiltrados = productos.filter(p =>
        (p.nombre && p.nombre.toUpperCase().includes(termino)) ||
        (p.sku && p.sku.toUpperCase().includes(termino)) ||
        (p.codigo_barras && p.codigo_barras.includes(termino))
    );
    indiceSeleccionado = resultadosProductosFiltrados.length > 0 ? 0 : -1;
    mostrarSugerencias(resultadosProductosFiltrados);
}

function resaltarProductoSeleccionado() {
    const items = document.querySelectorAll('#sugerenciasProductos .list-group-item');
    items.forEach((item, index) => {
        if (index === indiceSeleccionado) {
            item.classList.add('active');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } else {
            item.classList.remove('active');
        }
    });
}

function filtrarClientesEnTiempoReal(event) {
    const termino = event.target.value.trim();
    if (timerBusquedaCliente) {
        clearTimeout(timerBusquedaCliente);
    }
    if (termino === '') {
        document.getElementById('resultadosBusquedaClientes').innerHTML = '<p class="text-muted text-center">Escriba para buscar...</p>';
        return;
    }
    if (termino.length < 2) {
        document.getElementById('resultadosBusquedaClientes').innerHTML = '<p class="text-muted text-center">Escriba al menos 2 caracteres...</p>';
        return;
    }
    timerBusquedaCliente = setTimeout(() => {
        buscarClientesApi(termino);
    }, 300);
}

async function buscarClientesApi(termino) {
    try {
        const response = await fetch(`${API_URL}/clientes/buscar?q=${encodeURIComponent(termino)}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error en búsqueda');
        const clientes = await response.json();
        mostrarResultadosClientes(clientes);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('resultadosBusquedaClientes').innerHTML =
            '<p class="text-danger text-center">Error al buscar clientes</p>';
    }
}

function mostrarResultadosClientes(clientes) {
    const container = document.getElementById('resultadosBusquedaClientes');
    if (clientes.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No se encontraron clientes</p>';
        return;
    }
    let html = '<div class="list-group">';
    clientes.forEach(cliente => {
        const nombreSeguro = (cliente.razon_social || '').replace(/'/g, "\\'");
        html += `
            <a href="#" class="list-group-item list-group-item-action"
               onclick="seleccionarCliente(${cliente.id_cliente}, '${nombreSeguro}'); return false;">
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">${cliente.razon_social}</h6>
                    <small class="text-muted">${cliente.cuit || 'Sin CUIT'}</small>
                </div>
                <small class="text-muted">
                    ${cliente.direccion || 'Sin dirección'} ${cliente.telefono ? '• ' + cliente.telefono : ''}
                </small>
            </a>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function seleccionarCliente(id, nombre) {
    document.getElementById('idCliente').value = id;
    document.getElementById('clienteNombre').value = nombre;
    modalBuscarCliente.hide();
    mostrarAlerta('Cliente seleccionado: ' + nombre, 'Éxito');
}

function cambiarTipoEntrega(event) {
    tipoEntrega = event.target.value;
    const infoTexto = document.getElementById('infoTipoEntrega');
    if (tipoEntrega === 'retira') {
        infoTexto.innerHTML = '<i class="bi bi-info-circle"></i> Descuenta stock inmediatamente';
        infoTexto.className = 'text-muted d-block mt-1';
    } else {
        infoTexto.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Stock comprometido (requiere dirección)';
        infoTexto.className = 'text-warning d-block mt-1';
    }
}

async function verificarDireccionCliente() {
    const idCliente = document.getElementById('idCliente').value;
    const nombreCliente = document.getElementById('clienteNombre').value;
    if (nombreCliente.toLowerCase().includes('consumidor final')) {
        mostrarAlerta('El Consumidor Final no puede tener entregas. Cambiando a RETIRA.');
        document.getElementById('btnRetira').checked = true;
        tipoEntrega = 'retira';
        cambiarTipoEntrega({ target: { value: 'retira' } });
        return false;
    }
    if (tipoEntrega === 'entrega') {
        try {
            const response = await fetch(`${API_URL}/clientes/${idCliente}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
            });
            if (!response.ok) throw new Error('Error al obtener cliente');
            const cliente = await response.json();
            document.getElementById('nombreClienteDireccion').textContent = nombreCliente;
            document.getElementById('direccionEntrega').value = cliente.direccion || '';
            document.getElementById('localidadEntrega').value = '';
            modalActualizarDireccion.show();
            setTimeout(() => {
                document.getElementById('direccionEntrega').focus();
                document.getElementById('direccionEntrega').select();
            }, 300);
            return false;
        } catch (error) {
            console.error('Error:', error);
            document.getElementById('nombreClienteDireccion').textContent = nombreCliente;
            document.getElementById('direccionEntrega').value = '';
            document.getElementById('localidadEntrega').value = '';
            modalActualizarDireccion.show();
            return false;
        }
    }
    return true;
}

async function confirmarDireccionEntrega() {
    const direccion = document.getElementById('direccionEntrega').value.trim();
    if (!direccion) {
        mostrarAlerta('Por favor ingresá una dirección');
        return;
    }
    const localidad = document.getElementById('localidadEntrega').value.trim();
    const guardarEnCliente = document.getElementById('guardarDireccionCliente').checked;
    direccionEntregaTemporal = {
        direccion: direccion,
        localidad: localidad
    };
    if (guardarEnCliente) {
        const idCliente = document.getElementById('idCliente').value;
        try {
            const response = await fetch(`${API_URL}/clientes/${idCliente}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    direccion: direccion + (localidad ? `, ${localidad}` : '')
                })
            });
            if (response.ok) {
                console.log('✅ Dirección guardada en el cliente');
            } else {
                console.warn('⚠️ No se pudo guardar en cliente, pero se usará para esta venta');
            }
        } catch (error) {
            console.warn('⚠️ Error al guardar dirección, pero se usará para esta venta:', error);
        }
    }
    modalActualizarDireccion.hide();
    if (accionPendiente === 'suspender') {
        await procesarSuspender();
    } else {
        await procesarGuardadoVenta();
    }
    accionPendiente = null;
}

function cancelarEntrega() {
    document.getElementById('btnRetira').checked = true;
    tipoEntrega = 'retira';
    cambiarTipoEntrega({ target: { value: 'retira' } });
    modalActualizarDireccion.hide();
    accionPendiente = null;
}

async function buscarYAgregarProducto(codigo) {
    const inputCodigo = document.getElementById('codigoProducto');
    let producto = productos.find(p =>
        (p.sku && p.sku.toUpperCase() === codigo) ||
        (p.codigo_barras && p.codigo_barras === codigo)
    );
    if (producto) {
        agregarProductoDirecto(producto);
        inputCodigo.value = '';
        document.getElementById('sugerenciasProductos').innerHTML = '';
        resultadosProductosFiltrados = [];
        indiceSeleccionado = -1;
        inputCodigo.classList.add('producto-agregado');
        setTimeout(() => inputCodigo.classList.remove('producto-agregado'), 500);
        return;
    }
    inputCodigo.classList.add('codigo-invalido');
    setTimeout(() => inputCodigo.classList.remove('codigo-invalido'), 300);
    mostrarAlerta(`No se encontró el producto: ${codigo}`);
}

function mostrarSugerencias(productosArray) {
    const container = document.getElementById('sugerenciasProductos');
    if (productosArray.length === 0) {
        container.innerHTML = `
            <div class="card shadow-sm">
                <div class="card-body p-2 text-center text-muted">
                    <small>No se encontraron productos</small>
                </div>
            </div>
        `;
        return;
    }
    container.innerHTML = `
        <div class="card shadow-sm">
            <div class="card-body p-2">
                <small class="text-muted"><i class="bi bi-lightbulb"></i> Sugerencias (usa ↑↓ y Enter):</small>
                <div class="list-group list-group-flush mt-2" style="max-height: 200px; overflow-y: auto;">
                    ${productosArray.slice(0, 10).map((p, idx) => `
                        <a href="#"
                           class="list-group-item list-group-item-action py-1 px-2 ${idx === indiceSeleccionado ? 'active' : ''}"
                           onclick="agregarProductoPorIndice(${idx}); return false;"
                           data-indice="${idx}">
                            <small>
                                <strong>${p.sku || 'S/C'}</strong> - ${p.nombre}
                                <span class="float-end text-success ${idx === indiceSeleccionado ? 'text-white' : ''}">$${parseFloat(p.precio || 0).toFixed(2)}</span>
                            </small>
                        </a>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function agregarProductoPorIndice(indice) {
    if (indice >= 0 && indice < resultadosProductosFiltrados.length) {
        agregarProductoDirecto(resultadosProductosFiltrados[indice]);
    }
}

function agregarProductoDirecto(producto) {
    if (typeof producto === 'string') {
        producto = JSON.parse(producto);
    }
    const precio = parseFloat(producto.precio) || 0;
    const existe = itemsVentaArray.find(i => i.id_producto === producto.id_producto);
    if (existe) {
        existe.cantidad++;
    } else {
        itemsVentaArray.push({
            id_producto: producto.id_producto,
            sku: producto.sku,
            nombre: producto.nombre,
            cantidad: 1,
            precio_lista: precio,
            precio_unitario: precio,
            descuento_porcentaje: 0,
            descuento_monto: 0
        });
    }
    mostrarItemsVenta();
    calcularTotal();
    document.getElementById('codigoProducto').value = '';
    document.getElementById('sugerenciasProductos').innerHTML = '';
    resultadosProductosFiltrados = [];
    indiceSeleccionado = -1;
    document.getElementById('codigoProducto').focus();
}

function mostrarItemsVenta() {
    const tbody = document.getElementById('itemsVentaBody');
    document.getElementById('sinItems').style.display = itemsVentaArray.length === 0 ? '' : 'none';
    if (itemsVentaArray.length === 0) {
        tbody.innerHTML = "";
        document.getElementById('cantidadItems').textContent = '0';
        return;
    }
    const itemsHtml = itemsVentaArray.map((item, index) => {
        const tiene_descuento = item.descuento_porcentaje > 0 || item.descuento_monto > 0;
        const subtotal_bruto = item.cantidad * item.precio_lista;
        let descuento = 0;
        if (item.descuento_porcentaje > 0) {
            descuento = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento = item.descuento_monto * item.cantidad;
        }
        const subtotal_neto = subtotal_bruto - descuento;
        const precio_mostrar = item.precio_unitario;
        return `
            <tr class="item-venta-compacto">
                <td class="text-center">${index + 1}</td>
                <td><small><strong>${item.sku || ''}</strong></small></td>
                <td><small>${item.nombre}</small></td>
                <td class="text-center">
                    <input type="number"
                           id="cantidad_${index}"
                           class="form-control form-control-sm text-center"
                           value="${item.cantidad}"
                           min="0.01"
                           step="0.01"
                           onchange="cambiarCantidad(${index}, this.value)"
                           onkeydown="manejarTeclasCantidad(event, ${index})">
                </td>
                <td class="text-end">
                    <small>
                        ${tiene_descuento ? `<span class="precio-tachado">$${item.precio_lista.toFixed(2)}</span><br>` : ''}
                        <strong>$${precio_mostrar.toFixed(2)}</strong>
                    </small>
                </td>
                <td class="text-center">
                    <input type="number"
                           id="descuento_${index}"
                           class="form-control form-control-sm text-center"
                           value="${item.descuento_porcentaje}"
                           min="0"
                           max="100"
                           step="0.01"
                           onchange="cambiarDescuento(${index}, this.value)"
                           onkeydown="manejarTeclasDescuento(event, ${index})">
                </td>
                <td class="text-end">
                    <strong>$${subtotal_neto.toFixed(2)}</strong>
                </td>
                <td class="text-center">
                    <button class="btn btn-sm btn-danger" onclick="quitarItem(${index})">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    const sinItemsRow = document.getElementById('sinItems');
    sinItemsRow.insertAdjacentHTML('afterend', itemsHtml);
    const todasLasFilas = tbody.querySelectorAll('tr:not(#sinItems)');
    todasLasFilas.forEach((fila, i) => {
        if (i >= itemsVentaArray.length) {
            fila.remove();
        }
    });
    document.getElementById('cantidadItems').textContent = itemsVentaArray.length;
}

function manejarTeclasCantidad(event, index) {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('codigoProducto').focus();
    }
}

function manejarTeclasDescuento(event, index) {
    if (event.key === 'Enter') {
        event.preventDefault();
        document.getElementById('codigoProducto').focus();
    }
}

function cambiarCantidad(index, cantidad) {
    itemsVentaArray[index].cantidad = parseFloat(cantidad) || 0.01;
    calcularTotal();
    mostrarItemsVenta();
}

function cambiarDescuento(index, descuento) {
    const item = itemsVentaArray[index];
    item.descuento_porcentaje = parseFloat(descuento) || 0;
    item.descuento_monto = 0;
    const subtotal_bruto = item.cantidad * item.precio_lista;
    const descuento_aplicado = subtotal_bruto * (item.descuento_porcentaje / 100);
    item.precio_unitario = (subtotal_bruto - descuento_aplicado) / item.cantidad;
    calcularTotal();
    mostrarItemsVenta();
}

function quitarItem(index) {
    itemsVentaArray.splice(index, 1);
    mostrarItemsVenta();
    calcularTotal();
    document.getElementById('codigoProducto').focus();
}

function calcularTotal() {
    let subtotal_sin_descuentos = 0;
    let subtotal_con_dto_items = 0;
    itemsVentaArray.forEach(item => {
        const subtotal_bruto = item.cantidad * item.precio_lista;
        let descuento_item = 0;
        if (item.descuento_porcentaje > 0) {
            descuento_item = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento_item = item.descuento_monto * item.cantidad;
        }
        subtotal_sin_descuentos += subtotal_bruto;
        subtotal_con_dto_items += (subtotal_bruto - descuento_item);
    });
    const dto_gral_porcentaje = parseFloat(document.getElementById('descuentoGeneralPorcentaje').value) || 0;
    const dto_gral_monto = parseFloat(document.getElementById('descuentoGeneralMonto').value) || 0;
    let descuento_general = 0;
    if (dto_gral_porcentaje > 0) {
        descuento_general = subtotal_con_dto_items * (dto_gral_porcentaje / 100);
    } else if (dto_gral_monto > 0) {
        descuento_general = dto_gral_monto;
    }
    const subtotal_final = subtotal_con_dto_items - descuento_general;
    const iva = subtotal_final * 0.21;
    const total = subtotal_final + iva;
    document.getElementById('totalVenta').textContent = '$' + total.toFixed(2);
    const detalleDescuentos = document.getElementById('detalleDescuentos');
    const descuentos_items = subtotal_sin_descuentos - subtotal_con_dto_items;
    if (descuentos_items > 0 || descuento_general > 0) {
        let detalle = 'Dto: ';
        if (descuentos_items > 0) detalle += `-$${descuentos_items.toFixed(2)} `;
        if (descuento_general > 0) detalle += `(Gral: -$${descuento_general.toFixed(2)})`;
        detalleDescuentos.textContent = detalle;
        detalleDescuentos.style.display = 'block';
    } else {
        detalleDescuentos.style.display = 'none';
    }
    actualizarResumenPagos();
}

async function obtenerConsumidorFinal() {
    try {
        const response = await fetch(`${API_URL}/clientes`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('No se pudo obtener clientes');
        const clientes = await response.json();
        const consumidorFinal = clientes.find(c =>
            c.razon_social && c.razon_social.toLowerCase().includes('consumidor final')
        );
        if (consumidorFinal) {
            document.getElementById('idCliente').value = consumidorFinal.id_cliente;
            document.getElementById('clienteNombre').value = consumidorFinal.razon_social;
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('Error al cargar cliente por defecto');
    }
}

async function cargarListasPrecios() {
    try {
        const response = await fetch(`${API_URL}/listas-precios`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (response.ok) {
            listasPreciosDisponibles = await response.json();
            const select = document.getElementById('listaPrecios');
            select.innerHTML = '';
            if (listasPreciosDisponibles.length === 0) {
                select.innerHTML = '<option value="">No hay listas</option>';
                return;
            }
            listasPreciosDisponibles.forEach(lista => {
                const option = document.createElement('option');
                option.value = lista.id_lista_precio;
                option.textContent = lista.nombre;
                select.appendChild(option);
            });
            listaSeleccionada = listasPreciosDisponibles[0]?.id_lista_precio || 1;
            select.value = listaSeleccionada;
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function onListaPreciosChange(event) {
    const nuevaLista = parseInt(event.target.value);
    if (itemsVentaArray.length > 0) {
        const confirmar = await mostrarConfirmacion('¿Actualizar precios según la nueva lista?');
        if (!confirmar) {
            event.target.value = listaSeleccionada;
            return;
        }
    }
    listaSeleccionada = nuevaLista;
    await cargarProductos();
    for (let item of itemsVentaArray) {
        const productoEncontrado = productos.find(p => p.id_producto === item.id_producto);
        if (productoEncontrado && productoEncontrado.precio) {
            item.precio_lista = parseFloat(productoEncontrado.precio);
            item.precio_unitario = item.precio_lista;
        }
    }
    mostrarItemsVenta();
    calcularTotal();
}

async function cargarProductos() {
    try {
        const response = await fetch(`${API_URL}/productos/listar?id_lista_precio=${listaSeleccionada}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}` }
        });
        if (!response.ok) throw new Error('Error al cargar productos');
        productos = await response.json();
        console.log(`✅ ${productos.length} productos cargados`);
    } catch (error) {
        console.error('Error al cargar productos:', error);
        mostrarAlerta('Error al cargar productos');
    }
}

function buscarCliente() {
    modalBuscarCliente.show();
    setTimeout(() => {
        const input = document.getElementById('busquedaClienteInput');
        if (input) {
            input.value = '';
            input.focus();
            document.getElementById('resultadosBusquedaClientes').innerHTML = '<p class="text-muted text-center">Escriba para buscar...</p>';
        }
    }, 300);
}

function mostrarFormNuevoCliente() {
    modalBuscarCliente.hide();
    setTimeout(() => {
        modalNuevoCliente.show();
        document.getElementById('formNuevoCliente').reset();
    }, 300);
}

async function guardarNuevoCliente() {
    const form = document.getElementById('formNuevoCliente');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    const nuevoCliente = {
        cuit: document.getElementById('nuevoCuit').value,
        razon_social: document.getElementById('nuevoNombre').value,
        direccion: document.getElementById('nuevaDireccion').value,
        telefono: document.getElementById('nuevoTelefono').value,
        email: document.getElementById('nuevoEmail').value
    };
    try {
        const response = await fetch('/api/clientes', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(nuevoCliente)
        });
        if (!response.ok) throw new Error('Error al crear cliente');
        const cliente = await response.json();
        document.getElementById('idCliente').value = cliente.id_cliente;
        document.getElementById('clienteNombre').value = cliente.razon_social;
        modalNuevoCliente.hide();
        mostrarAlerta('Cliente creado correctamente');
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('Error al crear cliente');
    }
}

function manejarClicPago(forma, event) {
    event.preventDefault();
    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        return;
    }
    clickTimer = setTimeout(() => {
        clickTimer = null;
        pagarTotalConForma(forma);
    }, 250);
}

function manejarDobleClicPago(forma, event) {
    event.preventDefault();
    if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
    }
    iniciarPagoParcial(forma);
}

function pagarTotalConForma(forma) {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('Agrega productos primero');
        return;
    }
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    const totalPagado = pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    const saldoRestante = total - totalPagado;
    if (saldoRestante <= 0.01) {
        mostrarAlerta('El pago ya está completo');
        return;
    }
    pagosRegistrados.push({
        forma: forma,
        monto: saldoRestante,
        es_completo: pagosRegistrados.length === 0
    });
    marcarBotonPago(forma, 'completo');
    mostrarPagosRegistrados();
    actualizarResumenPagos();
}

function iniciarPagoParcial(forma) {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('Agrega productos primero');
        return;
    }
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    const totalPagado = pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    const saldoRestante = total - totalPagado;
    if (saldoRestante <= 0.01) {
        mostrarAlerta('El pago ya está completo');
        return;
    }
    formaParcialActual = forma;
    document.getElementById('formaParcialNombre').textContent = nombresForma[forma];
    document.getElementById('montoParcial').value = saldoRestante.toFixed(2);
    document.getElementById('saldoRestanteInfo').textContent = saldoRestante.toFixed(2);
    document.getElementById('inputPagoParcial').style.display = 'block';
    setTimeout(() => document.getElementById('montoParcial').select(), 100);
}

function confirmarPagoParcial() {
    const monto = parseFloat(document.getElementById('montoParcial').value);
    if (!monto || monto <= 0) {
        mostrarAlerta('Ingresa un monto válido');
        return;
    }
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    const totalPagado = pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    const saldoRestante = total - totalPagado;
    if (monto > saldoRestante + 0.001) {
        mostrarAlerta(`El monto no puede ser mayor al saldo restante ($${saldoRestante.toFixed(2)})`);
        return;
    }
    pagosRegistrados.push({
        forma: formaParcialActual,
        monto: monto,
        es_completo: false
    });
    marcarBotonPago(formaParcialActual, 'parcial');
    cancelarPagoParcial();
    mostrarPagosRegistrados();
    actualizarResumenPagos();
}

function cancelarPagoParcial() {
    formaParcialActual = null;
    document.getElementById('inputPagoParcial').style.display = 'none';
    document.getElementById('montoParcial').value = '';
}

function marcarBotonPago(forma, tipo) {
    const btn = document.querySelector(`[data-forma="${forma}"]`);
    if (btn) {
        btn.classList.remove('pago-completo', 'pago-parcial');
        if (tipo === 'completo') {
            btn.classList.add('pago-completo');
        } else {
            btn.classList.add('pago-parcial');
        }
    }
}

function mostrarPagosRegistrados() {
    const container = document.getElementById('listaPagos');
    if (pagosRegistrados.length === 0) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = pagosRegistrados.map((pago, index) => `
        <div class="alert alert-success p-2 mb-1">
            <div class="d-flex justify-content-between align-items-center">
                <small>
                    <strong>${nombresForma[pago.forma]}</strong>
                    ${pago.es_completo ? '<span class="badge bg-success ms-1">Total</span>' : ''}
                    <br>
                    <span class="text-success">$${pago.monto.toFixed(2)}</span>
                </small>
                <button class="btn btn-sm btn-danger" onclick="quitarPago(${index})">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function quitarPago(index) {
    const pago = pagosRegistrados[index];
    const otrosPagosMismaForma = pagosRegistrados.filter((p, i) => i !== index && p.forma === pago.forma).length > 0;
    if (!otrosPagosMismaForma) {
        const btn = document.querySelector(`[data-forma="${pago.forma}"]`);
        if (btn) {
            btn.classList.remove('pago-completo', 'pago-parcial');
        }
    }
    pagosRegistrados.splice(index, 1);
    mostrarPagosRegistrados();
    actualizarResumenPagos();
}

function actualizarResumenPagos() {
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    const totalPagado = pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    const saldoRestante = total - totalPagado;
    if (pagosRegistrados.length > 0) {
        document.getElementById('resumenPagos').style.display = 'block';
        document.getElementById('totalAPagar').textContent = total.toFixed(2);
        document.getElementById('totalPagado').textContent = totalPagado.toFixed(2);
        document.getElementById('saldoRestante').textContent = saldoRestante.toFixed(2);
    } else {
        document.getElementById('resumenPagos').style.display = 'none';
    }
    if (saldoRestante > 0.01 && pagosRegistrados.length > 0) {
        document.getElementById('alertaSaldoPendiente').style.display = 'block';
        document.getElementById('montoPendiente').textContent = saldoRestante.toFixed(2);
    } else {
        document.getElementById('alertaSaldoPendiente').style.display = 'none';
    }
    const hayItems = itemsVentaArray.length > 0;
    document.getElementById('btnGuardar').disabled = !hayItems;
    document.getElementById('btnSuspender').disabled = !hayItems;
}

async function guardarVenta() {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('No hay productos en la venta');
        return;
    }
    if (tipoEntrega === 'entrega') {
        accionPendiente = 'guardar';
        await verificarDireccionCliente();
        return;
    }
    await procesarGuardadoVenta();
}

async function procesarGuardadoVenta() {
    const itemsConDescuentos = itemsVentaArray.map(item => {
        const subtotal_bruto = item.cantidad * item.precio_lista;
        let descuento_item = 0;
        if (item.descuento_porcentaje > 0) {
            descuento_item = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento_item = item.descuento_monto * item.cantidad;
        }
        return {
            ...item,
            subtotal_sin_descuento: subtotal_bruto,
            subtotal: subtotal_bruto - descuento_item
        };
    });
    const dto_gral_porcentaje = parseFloat(document.getElementById('descuentoGeneralPorcentaje').value) || 0;
    const dto_gral_monto = parseFloat(document.getElementById('descuentoGeneralMonto').value) || 0;
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    const totalPagado = pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    const saldoPendiente = total - totalPagado;
    let mensajeConfirm = `¿Confirmar venta?\n\nTotal: $${total.toFixed(2)}\n`;
    mensajeConfirm += `Tipo: ${tipoEntrega === 'retira' ? '🟢 RETIRA (descuenta stock)' : '🟡 ENTREGA (stock comprometido)'}`;
    if (tipoEntrega === 'entrega' && direccionEntregaTemporal) {
        mensajeConfirm += `\n\nDirección: ${direccionEntregaTemporal.direccion}`;
        if (direccionEntregaTemporal.localidad) {
            mensajeConfirm += `, ${direccionEntregaTemporal.localidad}`;
        }
    }
    const confirmar = await mostrarConfirmacion(mensajeConfirm);
    if (!confirmar) return;
    const btn = document.getElementById('btnGuardar');
    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="bi bi-arrow-clockwise bi-spin"></i> Guardando...';
        let observaciones = document.getElementById('observaciones').value || 'Venta rápida - Mostrador';
        if (tipoEntrega === 'entrega') {
            observaciones += `\n[ENTREGA A DOMICILIO]`;
            if (direccionEntregaTemporal) {
                observaciones += `\nDirección: ${direccionEntregaTemporal.direccion}`;
                if (direccionEntregaTemporal.localidad) {
                    observaciones += `, ${direccionEntregaTemporal.localidad}`;
                }
            }
        } else {
            observaciones += `\n[RETIRA EN LOCAL]`;
        }
        let datosVenta = {
            items: itemsConDescuentos,
            observaciones: observaciones,
            id_lista_precio: listaSeleccionada,
            descuento_general_porcentaje: dto_gral_porcentaje,
            descuento_general_monto: dto_gral_monto,
            tipo_entrega: tipoEntrega,
            id_estado: 2
        };
        if (pagosRegistrados.length > 0) {
            datosVenta.pagos_multiples = pagosRegistrados.map(p => ({
                forma: p.forma,
                monto: p.monto
            }));
        }
        if (saldoPendiente > 0.01) {
            datosVenta.saldo_pendiente = saldoPendiente;
            datosVenta.id_cliente = document.getElementById('idCliente').value;
        }
        const response = await fetch(`${API_URL}/venta-rapida`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify(datosVenta)
        });
        const result = await response.json();
        if (response.ok) {
            pedidoGuardadoId = result.id_pedido;
            document.getElementById('numeroPedidoGuardado').textContent = result.id_pedido;
            document.getElementById('totalPedidoGuardado').textContent = total.toFixed(2);
            modalVentaGuardada.show();
        } else {
            mostrarAlerta('❌ Error: ' + (result.error || 'No se pudo guardar'), 'Error');
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('❌ Error de conexión: ' + error.message, 'Error');
    } finally {
        btn.disabled = itemsVentaArray.length === 0;
        btn.innerHTML = '<i class="bi bi-check-circle"></i> GUARDAR (F2)';
    }
}

async function limpiarVenta() {
    itemsVentaArray = [];
    pagosRegistrados = [];
    formaParcialActual = null;
    direccionEntregaTemporal = null;
    document.querySelectorAll('.forma-pago-btn').forEach(btn => {
        btn.classList.remove('pago-completo', 'pago-parcial');
    });
    document.getElementById('listaPagos').innerHTML = '';
    document.getElementById('inputPagoParcial').style.display = 'none';
    document.getElementById('resumenPagos').style.display = 'none';
    document.getElementById('alertaSaldoPendiente').style.display = 'none';
    document.getElementById('descuentoGeneralPorcentaje').value = 0;
    document.getElementById('descuentoGeneralMonto').value = 0;
    document.getElementById('observaciones').value = '';
    document.getElementById('btnRetira').checked = true;
    tipoEntrega = 'retira';
    cambiarTipoEntrega({ target: { value: 'retira' } });
    mostrarItemsVenta();
    calcularTotal();
    await obtenerConsumidorFinal();
    document.getElementById('codigoProducto').focus();
}

function mostrarAlerta(mensaje, titulo = 'Aviso') {
    document.getElementById('alertaModalTitulo').textContent = titulo;
    document.getElementById('alertaModalMensaje').textContent = mensaje;
    alertaModal.show();
}

function mostrarConfirmacion(mensaje, titulo = 'Confirmar') {
    document.getElementById('confirmarModalTitulo').textContent = titulo;
    document.getElementById('confirmarModalMensaje').textContent = mensaje;
    return new Promise((resolve) => {
        confirmarModalRespuesta = resolve;
        confirmarModal.show();
    });
}

async function suspenderVenta() {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('No hay productos en la venta');
        return;
    }
    const confirmar = await mostrarConfirmacion('¿Suspender esta venta?\n\nPodrás recuperarla después desde "Recuperar Suspendidos"');
    if (!confirmar) return;
    if (tipoEntrega === 'entrega') {
        accionPendiente = 'suspender';
        await verificarDireccionCliente();
        return;
    }
    await procesarSuspender();
}

async function procesarSuspender() {
    const itemsConDescuentos = itemsVentaArray.map(item => {
        const subtotal_bruto = item.cantidad * item.precio_lista;
        let descuento_item = 0;
        if (item.descuento_porcentaje > 0) {
            descuento_item = subtotal_bruto * (item.descuento_porcentaje / 100);
        } else if (item.descuento_monto > 0) {
            descuento_item = item.descuento_monto * item.cantidad;
        }
        return {
            ...item,
            subtotal_sin_descuento: subtotal_bruto,
            subtotal: subtotal_bruto - descuento_item
        };
    });
    const dto_gral_porcentaje = parseFloat(document.getElementById('descuentoGeneralPorcentaje').value) || 0;
    const dto_gral_monto = parseFloat(document.getElementById('descuentoGeneralMonto').value) || 0;
    const total = parseFloat(document.getElementById('totalVenta').textContent.replace('$', ''));
    let observaciones = document.getElementById('observaciones').value || 'Venta suspendida - Mostrador';
    if (tipoEntrega === 'entrega') {
        observaciones += `\n[ENTREGA A DOMICILIO]`;
        if (direccionEntregaTemporal) {
            observaciones += `\nDirección: ${direccionEntregaTemporal.direccion}`;
            if (direccionEntregaTemporal.localidad) {
                observaciones += `, ${direccionEntregaTemporal.localidad}`;
            }
        }
    } else {
        observaciones += `\n[RETIRA EN LOCAL]`;
    }
    let datosVenta = {
        items: itemsConDescuentos,
        observaciones: observaciones,
        id_lista_precio: listaSeleccionada,
        descuento_general_porcentaje: dto_gral_porcentaje,
        descuento_general_monto: dto_gral_monto,
        tipo_entrega: tipoEntrega,
        id_estado: 8
    };
    if (pagosRegistrados.length > 0) {
        datosVenta.pagos_multiples = pagosRegistrados.map(p => ({
            forma: p.forma,
            monto: p.monto
        }));
    }
    const saldoPendiente = total - pagosRegistrados.reduce((sum, p) => sum + p.monto, 0);
    datosVenta.id_cliente = document.getElementById('idCliente').value;
    if (saldoPendiente > 0.01) {
        datosVenta.saldo_pendiente = saldoPendiente;
    }
    try {
        const response = await fetch(`${API_URL}/venta-rapida`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify(datosVenta)
        });
        const result = await response.json();
        if (response.ok) {
            mostrarAlerta(`⏸️ Venta suspendida correctamente\n\nPedido #${result.id_pedido}\n\nYa podés iniciar una nueva venta.`, 'Éxito');
            setTimeout(() => {
                limpiarVenta();
            }, 500);
        } else {
            mostrarAlerta('❌ Error: ' + (result.error || 'No se pudo suspender'), 'Error');
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('❌ Error de conexión: ' + error.message, 'Error');
    }
}

async function mostrarSuspendidos() {
    console.log('🔍 Iniciando mostrarSuspendidos()');
    try {
        // LIMPIAR TODOS LOS BACKDROPS HUÉRFANOS
        const backdrops = document.querySelectorAll('.modal-backdrop');
        console.log('🧹 Backdrops encontrados:', backdrops.length);
        backdrops.forEach(b => {
            b.remove();
            console.log('🗑️ Backdrop eliminado');
        });

        // Limpiar clase modal-open del body
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
        console.log('🧹 Body limpiado');

        // Cerrar el modal si estaba abierto
        try {
            modalSuspendidos.hide();
        } catch (e) {
            console.log('⚠️ Error al cerrar modal anterior:', e.message);
        }

        // Esperar un momento antes de abrir
        await new Promise(resolve => setTimeout(resolve, 200));

        // Mostrar modal
        modalSuspendidos.show();
        console.log('📂 Modal mostrado');

        // Forzar z-index y posición del modal
        setTimeout(() => {
            const modalElement = document.getElementById('modalSuspendidos');
            if (modalElement) {
                modalElement.style.zIndex = '9999';
                modalElement.style.display = 'block';
                modalElement.style.visibility = 'visible';
                modalElement.style.opacity = '1';
                modalElement.classList.add('show');
                console.log('✅ z-index y display del modal ajustado');

                // Forzar posición FIJA y CENTRADA del modal-dialog
                const modalDialog = modalElement.querySelector('.modal-dialog');
                console.log('🔍 modal-dialog encontrado:', modalDialog);
                if (modalDialog) {
                    modalDialog.style.cssText = `
                        position: fixed !important;
                        top: 50% !important;
                        left: 50% !important;
                        transform: translate(-50%, -50%) !important;
                        width: 800px !important;
                        max-width: 90% !important;
                        min-height: 400px !important;
                        z-index: 10000 !important;
                    `;
                    console.log('✅ Posición y tamaño del modal-dialog ajustados');
                    const dialogStyles = window.getComputedStyle(modalDialog);
                    console.log('📏 modal-dialog computed:', {
                        width: dialogStyles.width,
                        height: dialogStyles.height,
                        display: dialogStyles.display,
                        visibility: dialogStyles.visibility,
                        opacity: dialogStyles.opacity,
                        position: dialogStyles.position
                    });
                } else {
                    console.error('❌ No se encontró .modal-dialog');
                }

                // Forzar tamaño del modal-content
                const modalContent = modalElement.querySelector('.modal-content');
                console.log('🔍 modal-content encontrado:', modalContent);
                if (modalContent) {
                    modalContent.style.cssText = `
                        min-height: 400px !important;
                        display: flex !important;
                        flex-direction: column !important;
                        background: white !important;
                    `;
                    console.log('✅ Tamaño del modal-content ajustado');
                    const contentStyles = window.getComputedStyle(modalContent);
                    console.log('📏 modal-content computed:', {
                        width: contentStyles.width,
                        height: contentStyles.height,
                        display: contentStyles.display,
                        visibility: contentStyles.visibility,
                        opacity: contentStyles.opacity
                    });
                } else {
                    console.error('❌ No se encontró .modal-content');
                }

                const rect = modalElement.getBoundingClientRect();
                const dialogRect = modalDialog ? modalDialog.getBoundingClientRect() : null;

                console.log('📏 Modal element computedStyle:', {
                    display: window.getComputedStyle(modalElement).display,
                    visibility: window.getComputedStyle(modalElement).visibility,
                    opacity: window.getComputedStyle(modalElement).opacity,
                    zIndex: window.getComputedStyle(modalElement).zIndex
                });

                console.log('📐 Modal position & size:', {
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                    bottom: rect.bottom,
                    right: rect.right
                });

                if (dialogRect) {
                    console.log('📐 Modal-dialog position & size:', {
                        top: dialogRect.top,
                        left: dialogRect.left,
                        width: dialogRect.width,
                        height: dialogRect.height
                    });
                }

                console.log('🖥️ Viewport size:', {
                    width: window.innerWidth,
                    height: window.innerHeight
                });
            }
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.style.zIndex = '9998';
                console.log('✅ z-index del backdrop ajustado a 9998');
            } else {
                console.log('⚠️ No se encontró backdrop');
            }
        }, 100);

        // Mostrar spinner mientras se carga
        const listaSuspendidos = document.getElementById('listaSuspendidos');
        listaSuspendidos.innerHTML = `
            <div class="text-center text-muted py-4">
                <div class="spinner-border" role="status">
                    <span class="visually-hidden">Cargando...</span>
                </div>
                <p class="mt-2">Cargando suspendidos...</p>
            </div>
        `;

        const url = `${API_URL}/pedidos/suspendidos`;
        console.log('🌐 Haciendo fetch a:', url);

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });

        console.log('📡 Response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Error en response:', errorText);
            throw new Error('Error al obtener suspendidos: ' + response.status);
        }

        const suspendidos = await response.json();
        console.log('✅ Suspendidos recibidos:', suspendidos.length, suspendidos);

        if (suspendidos.length === 0) {
            console.log('⚠️ No hay suspendidos');
            listaSuspendidos.innerHTML = `
                <div class="alert alert-info">
                    <i class="bi bi-info-circle"></i> No hay pedidos suspendidos
                </div>
            `;
            return;
        }

        console.log('📝 Generando HTML para', suspendidos.length, 'suspendidos...');
        let html = '<div class="list-group">';
        suspendidos.forEach(s => {
            const diasTranscurridos = Math.floor(s.dias_transcurridos);
            const badgeClass = diasTranscurridos > 20 ? 'bg-danger' : 'bg-secondary';
            html += `
                <div class="list-group-item list-group-item-action">
                    <div class="d-flex w-100 justify-content-between">
                        <h6 class="mb-1">Pedido #${s.id_pedido} - ${s.cliente || 'Sin cliente'}</h6>
                        <span class="badge ${badgeClass}">${diasTranscurridos} días</span>
                    </div>
                    <p class="mb-1">Total: $${parseFloat(s.total).toFixed(2)}</p>
                    <small class="text-muted">${new Date(s.fecha_creacion).toLocaleDateString()}</small>
                    ${s.observaciones ? `<br><small>${s.observaciones}</small>` : ''}
                    <div class="mt-2">
                        <button class="btn btn-sm btn-primary" onclick="cargarSuspendido(${s.id_pedido})">
                            <i class="bi bi-arrow-clockwise"></i> Recuperar
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="eliminarSuspendido(${s.id_pedido})">
                            <i class="bi bi-trash"></i> Eliminar
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        // Limpiar completamente antes de insertar
        listaSuspendidos.innerHTML = '';
        // Insertar el nuevo contenido
        listaSuspendidos.innerHTML = html;

        console.log('✅ HTML generado e insertado correctamente');
        console.log('📊 Contenido del div:', listaSuspendidos.innerHTML.substring(0, 200));
    } catch (error) {
        console.error('❌ Error en mostrarSuspendidos():', error);
        const listaSuspendidos = document.getElementById('listaSuspendidos');
        listaSuspendidos.innerHTML = `
            <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle"></i> Error al cargar suspendidos: ${error.message}
            </div>
        `;
    }
}

async function cargarSuspendido(id) {
    try {
        const response = await fetch(`${API_URL}/pedidos/${id}/recuperar`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            }
        });
        if (!response.ok) throw new Error('Error al recuperar pedido');
        const pedido = await response.json();
        itemsVentaArray = [];
        pagosRegistrados = [];
        pedido.items.forEach(item => {
            itemsVentaArray.push({
                id_producto: item.id_producto,
                sku: item.producto_sku,
                nombre: item.producto_nombre,
                cantidad: parseFloat(item.cantidad),
                precio_lista: parseFloat(item.precio_unitario),
                precio_unitario: parseFloat(item.precio_unitario),
                descuento_porcentaje: parseFloat(item.porcentaje_descuento) || 0,
                descuento_monto: 0
            });
        });
        if (pedido.descuento_general_porcentaje) {
            document.getElementById('descuentoGeneralPorcentaje').value = pedido.descuento_general_porcentaje;
        } else {
            document.getElementById('descuentoGeneralPorcentaje').value = 0;
        }
        if (pedido.descuento_general_monto) {
            document.getElementById('descuentoGeneralMonto').value = pedido.descuento_general_monto;
        } else {
            document.getElementById('descuentoGeneralMonto').value = 0;
        }
        if (pedido.id_cliente) {
            document.getElementById('idCliente').value = pedido.id_cliente;
            document.getElementById('clienteNombre').value = pedido.cliente_nombre || 'Cliente';
        }
        document.getElementById('observaciones').value = pedido.observaciones || '';
        mostrarItemsVenta();
        calcularTotal();
        modalSuspendidos.hide();
        setTimeout(() => {
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) backdrop.remove();
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
        }, 300);
        mostrarAlerta("✅ Pedido #" + id + " recuperado\n\nPodés modificarlo y guardarlo o suspenderlo nuevamente.", "Éxito");
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('❌ Error al recuperar pedido suspendido', 'Error');
    }
}

async function eliminarSuspendido(id) {
    const confirmar = await mostrarConfirmacion("¿Eliminar pedido suspendido #" + id + "?\n\nEsta acción no se puede deshacer.");
    if (!confirmar) return;
    try {
        const response = await fetch(API_URL + "/pedidos/suspendidos/" + id, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer ' + localStorage.getItem('authToken')
            }
        });
        if (response.ok) {
            mostrarAlerta('✅ Pedido eliminado correctamente', 'Éxito');
            mostrarSuspendidos();
        } else {
            mostrarAlerta('❌ Error al eliminar pedido', 'Error');
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('❌ Error de conexión', 'Error');
    }
}

function verPedido() {
    if (!pedidoGuardadoId) return;
    window.open(`${window.location.origin}/ver-pedido.html?id=${pedidoGuardadoId}`, '_blank');
}

function descargarPDF() {
    if (!pedidoGuardadoId) return;
    window.open(`${API_URL}/pedidos/${pedidoGuardadoId}/pdf`, '_blank');
}

function enviarWhatsApp() {
    if (!pedidoGuardadoId) return;
    const mensaje = `Hola! Te comparto el detalle de tu pedido #${pedidoGuardadoId}:\n${window.location.origin}/ver-pedido.html?id=${pedidoGuardadoId}`;
    const url = `https://web.whatsapp.com/send?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
}

async function enviarEmail() {
    if (!pedidoGuardadoId) return;
    const email = prompt('Ingresá el email del cliente:');
    if (!email) return;
    try {
        const response = await fetch(`${API_URL}/pedidos/${pedidoGuardadoId}/enviar-email`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ email })
        });
        if (response.ok) {
            mostrarAlerta('✅ Email enviado correctamente', 'Éxito');
        } else {
            mostrarAlerta('❌ Error al enviar email', 'Error');
        }
    } catch (error) {
        console.error('Error:', error);
        mostrarAlerta('❌ Error de conexión', 'Error');
    }
}

function vistaPrevia() {
    if (itemsVentaArray.length === 0) {
        mostrarAlerta('Agregue al menos un producto', 'warning');
        return;
    }
    let clienteSeleccionado = null;
    const idCliente = document.getElementById('id_cliente')?.value;
    if (idCliente && typeof clientes !== 'undefined') {
        clienteSeleccionado = clientes.find(c => c.id_cliente == parseInt(idCliente));
    }
    const datosPreview = {
        cliente: clienteSeleccionado,
        observaciones: document.getElementById('observaciones')?.value || '',
        items: itemsVentaArray
    };
    sessionStorage.setItem('vistaPreviewPedido', JSON.stringify(datosPreview));
    window.open('vista-previa.html', '_blank');
}

function actualizarEstadoBotones() {
    const btnVistaPrevia = document.getElementById('btnVistaPrevia');
    const btnGuardar = document.getElementById('btnGuardar');
    const btnSuspender = document.getElementById('btnSuspender');
    const hayItems = itemsVentaArray.length > 0;
    if (btnVistaPrevia) btnVistaPrevia.disabled = !hayItems;
    if (btnGuardar) btnGuardar.disabled = !hayItems;
    if (btnSuspender) btnSuspender.disabled = !hayItems;
}

function cerrarYNuevaVenta() {
    if (modalVentaGuardada) {
        modalVentaGuardada.hide();
    }
    setTimeout(() => {
        limpiarVenta();
    }, 300);
}

const originalMostrarItemsVenta = mostrarItemsVenta;
mostrarItemsVenta = function() {
    originalMostrarItemsVenta();
    actualizarEstadoBotones();
};
