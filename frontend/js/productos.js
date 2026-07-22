const API_URL = (window.CONFIG && window.CONFIG.API_BASE_URL) || "/api";

/**
 * PRODUCTOS.JS - ERP LAGO
 * Módulo de gestión de productos mejorado
 *
 * Características:
 * - Búsqueda inteligente (SKU, nombre, marca, proveedor)
 * - Filtros: categoría, marca, proveedor, conjunto, stock
 * - Ordenamiento por click en headers
 * - Operaciones masivas (precios %, activar/desactivar)
 * - Imprimir (respeta vista actual)
 * - Exportar Excel y PDF
 *
 * Atajos: Ctrl+N (nuevo), F2 (guardar), Esc (cerrar), F5 (recargar), Ctrl+F (buscar)
 */

// ============================================================
// ESTADO GLOBAL
// ============================================================
const Estado = {
    productos: [],
    productosFiltrados: [],
    categorias: [],
    marcas: [],
    proveedores: [],
    conjuntos: [],
    listasPrecios: [],
    alicuotasIva: [],

    vistaActual: 'cards',
    mostrarConIva: true,

    paginacion: {
        pagina: 1,
        limite: null,  // Bloque P1: se hidrata desde config en el primer response del backend
        total: 0
    },

    filtros: {
        buscar: '',
        id_categoria: '',
        id_marca: '',
        id_proveedor: '',
        id_conjunto: '',
        stock: '',
        activo: '',
        visible_web: '',
        incluir_inactivos: localStorage.getItem('productos.mostrar_inactivos') === 'true',   // 2026-05-21
        id_lista_precio: 1
    },

    ordenamiento: {
        columna: 'nombre',
        direccion: 'ASC'
    },

    panelMasivoVisible: false,
    busquedaTimeout: null,
    searchResultIndex: -1,
    productoEditando: null
};

let modalProducto, modalAjustePrecio;

// ============================================================
// INICIALIZACIÓN
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken');
    if (!token) {
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }

    modalProducto = new bootstrap.Modal(document.getElementById('modalProducto'));
    modalAjustePrecio = new bootstrap.Modal(document.getElementById('modalAjustePrecio'));

    configurarEventListeners();
    configurarAtajosTeclado();

    await cargarDatosFormulario();
    await cargarFiltrosAdicionales();
    await cargarArchivosOrigen();
    await cargarProductos();

    cargarPreferenciasUsuario();
});

// ============================================================
// EVENT LISTENERS
// ============================================================
function configurarEventListeners() {
    // Búsqueda
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    const searchResults = document.getElementById('searchResults');

    searchInput.addEventListener('input', (e) => {
        const valor = e.target.value;
        searchClear.classList.toggle('visible', valor.length > 0);

        clearTimeout(Estado.busquedaTimeout);
        Estado.busquedaTimeout = setTimeout(() => {
            if (valor.length >= 2) {
                buscarProductosDropdown(valor);
            } else {
                searchResults.classList.remove('visible');
                if (valor.length === 0) {
                    Estado.filtros.buscar = '';
                    aplicarFiltros();
                }
            }
        }, 200);
    });

    searchInput.addEventListener('keydown', navegarResultadosBusqueda);

    searchInput.addEventListener('focus', () => {
        if (searchInput.value.length >= 2) {
            searchResults.classList.add('visible');
        }
    });

    searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.classList.remove('visible');
        searchResults.classList.remove('visible');
        Estado.filtros.buscar = '';
        aplicarFiltros();
        searchInput.focus();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.classList.remove('visible');
        }
    });

    // Toggle de vistas
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => cambiarVista(btn.dataset.view));
    });

    // Filtros
    document.getElementById('filtroCategoria').addEventListener('change', aplicarFiltros);
    // Bloque 7.2: filtro subcategoria (independiente de categoria, mismo catalogo plano)
    document.getElementById('filtroSubcategoria').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroMarca').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroProveedor').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroConjunto').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroStock').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroActivo').addEventListener('change', aplicarFiltros);
    // Toggle mostrar inactivos (2026-05-21)
    const chkInactivos = document.getElementById('chkMostrarInactivos');
    if (chkInactivos) {
        chkInactivos.checked = Estado.filtros.incluir_inactivos;
        chkInactivos.addEventListener('change', function(e) {
            Estado.filtros.incluir_inactivos = e.target.checked;
            localStorage.setItem('productos.mostrar_inactivos', e.target.checked ? 'true' : 'false');
            aplicarFiltros();
        });
    }
    document.getElementById('filtroWeb').addEventListener('change', aplicarFiltros);
    document.getElementById('listaPrecios').addEventListener('change', aplicarFiltros);
}

function configurarAtajosTeclado() {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'n') {
            e.preventDefault();
            abrirModalNuevo();
        }

        if (e.ctrlKey && e.key === 'f') {
            e.preventDefault();
            document.getElementById('searchInput').focus();
        }

        if (e.key === 'F5') {
            e.preventDefault();
            recargarProductos();
        }

        if (e.key === 'F2' && document.getElementById('modalProducto').classList.contains('show')) {
            e.preventDefault();
            guardarProducto();
        }

        if (e.key === 'Escape') {
            const searchInput = document.getElementById('searchInput');
            if (document.activeElement === searchInput && searchInput.value) {
                searchInput.value = '';
                document.getElementById('searchClear').classList.remove('visible');
                document.getElementById('searchResults').classList.remove('visible');
            }
        }
    });
}

// ============================================================
// CARGA DE DATOS
// ============================================================
async function fetchAPI(endpoint, options = {}) {
    const token = localStorage.getItem('authToken');
    const config = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        ...options
    };

    const response = await fetch(`${API_URL}${endpoint}`, config);

    if (response.status === 401) {
        localStorage.removeItem('authToken');
        console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
        return;
    }

    return response;
}

async function cargarDatosFormulario() {
    try {
        const response = await fetchAPI('/productos/form-data');
        if (!response.ok) throw new Error('Error al cargar datos');

        const data = await response.json();

        Estado.categorias = data.categorias || [];
        Estado.marcas = data.marcas || [];
        Estado.listasPrecios = data.listas_precios || [];
        Estado.alicuotasIva = data.alicuotas_iva || [];

        llenarSelect('filtroCategoria', Estado.categorias, 'id_categoria', 'nombre', 'Categoría');
        // Bloque 7.2: mismo catalogo plano alimenta el filtro de subcategoria
        llenarSelect('filtroSubcategoria', Estado.categorias, 'id_categoria', 'nombre', 'Subcategoría');
        llenarSelect('filtroMarca', Estado.marcas, 'id_marca', 'nombre', 'Marca');
        llenarSelect('listaPrecios', Estado.listasPrecios, 'id_lista_precio', 'nombre');

        llenarSelect('idCategoria', Estado.categorias, 'id_categoria', 'nombre', 'Sin categoría');
        // Bloque 7.2: select de subcategoria en modal (mismo catalogo plano)
        llenarSelect('idSubcategoria', Estado.categorias, 'id_categoria', 'nombre', 'Sin subcategoría');
        // Bloque 7.2: feedback inmediato si cat===subcat (espejo del CHECK chk_productos_cat_distinta_subcat)
        const _validarCatSub_b72 = () => {
            const _cat = document.getElementById('idCategoria').value;
            const _sub = document.getElementById('idSubcategoria').value;
            const _selSub = document.getElementById('idSubcategoria');
            if (_cat && _sub && _cat === _sub) {
                alert('La subcategoría no puede ser igual a la categoría');
                _selSub.value = '';
            }
        };
        document.getElementById('idCategoria').addEventListener('change', _validarCatSub_b72);
        document.getElementById('idSubcategoria').addEventListener('change', _validarCatSub_b72);
        llenarSelect('idMarca', Estado.marcas, 'id_marca', 'nombre', 'Sin marca');
        llenarSelect('idAlicuotaIva', Estado.alicuotasIva, 'id_alicuota', 'nombre', 'Seleccionar IVA');

        generarCamposPrecios();
    } catch (error) {
        console.error('Error al cargar datos:', error);
    }
}

async function cargarFiltrosAdicionales() {
    try {
        // Proveedores
        const provResponse = await fetchAPI('/productos/proveedores');
        if (provResponse.ok) {
            Estado.proveedores = await provResponse.json();
            llenarSelect('filtroProveedor', Estado.proveedores, 'id_proveedor', 'razon_social', 'Proveedor');
        }

        // Conjuntos
        const conjResponse = await fetchAPI('/productos/conjuntos');
        if (conjResponse.ok) {
            Estado.conjuntos = await conjResponse.json();
            llenarSelect('filtroConjunto', Estado.conjuntos, 'id_conjunto', 'nombre', 'Conjunto');
            // También llenar select del modal
            llenarSelect('idProveedor', Estado.proveedores, 'id_proveedor', 'razon_social', 'Sin proveedor');
            generarCheckboxesConjuntos();
        }
    } catch (error) {
        console.error('Error al cargar filtros adicionales:', error);
    }
}

function generarCheckboxesConjuntos() {
    const container = document.getElementById('conjuntosCheckboxes');
    if (!container) return;
    
    if (!Estado.conjuntos || Estado.conjuntos.length === 0) {
        container.innerHTML = '<span class="text-muted">No hay conjuntos disponibles</span>';
        return;
    }
    
    container.innerHTML = Estado.conjuntos.map(c => `
        <div class="form-check">
            <input class="form-check-input" type="checkbox" value="${c.id_conjunto}" id="conjunto_${c.id_conjunto}">
            <label class="form-check-label" for="conjunto_${c.id_conjunto}">
                ${c.nombre}
            </label>
        </div>
    `).join('');
}

async function cargarProductos() {
    const container = document.getElementById('productsContainer');
    container.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <p style="margin-top: 1rem; color: #666;">Cargando productos...</p>
        </div>
    `;

    try {
        // Bloque P1: si limite es null (1er fetch tras carga), no lo mandamos -> el backend usa config.
        // offset usa fallback 0 mientras no haya limite conocido (pagina 1 siempre).
        const _lim = Estado.paginacion.limite;
        const params = new URLSearchParams({
            id_lista_precio: Estado.filtros.id_lista_precio,
            offset: (Estado.paginacion.pagina - 1) * (_lim || 0),
            ordenar: Estado.ordenamiento.columna,
            direccion: Estado.ordenamiento.direccion
        });
        if (_lim !== null) params.set('limite', _lim);

        if (Estado.filtros.id_categoria) params.append('id_categoria', Estado.filtros.id_categoria);
        // Bloque 7.2.1: id_subcategoria viaja como query param independiente al backend
        if (Estado.filtros.id_subcategoria) params.append('id_subcategoria', Estado.filtros.id_subcategoria);
        if (Estado.filtros.id_marca) params.append('id_marca', Estado.filtros.id_marca);
        if (Estado.filtros.id_proveedor) params.append('id_proveedor', Estado.filtros.id_proveedor);
        if (Estado.filtros.id_conjunto) params.append('id_conjunto', Estado.filtros.id_conjunto);
        if (Estado.filtros.stock === 'bajo' || Estado.filtros.stock === 'critico') {
            params.append('stock_bajo', 'true');
        }
        if (Estado.filtros.buscar) params.append('buscar', Estado.filtros.buscar);
        if (Estado.filtros.activo) params.append('activo', Estado.filtros.activo);
        if (Estado.filtros.visible_web) params.append('visible_web', Estado.filtros.visible_web);
        if (Estado.filtros.incluir_inactivos) params.append('incluir_inactivos', 'true');

        const response = await fetchAPI(`/productos/listar?${params}`);
        if (response.status === 401) {
            Estado.productos = []; Estado.productosFiltrados = [];
            actualizarEstadisticas(); actualizarContadorMasivo();
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-shield-lock empty-state-icon"></i>
                    <div class="empty-state-title">Sesión expirada</div>
                    <div class="empty-state-text">Tu sesión venció. Volvé a iniciar sesión.</div>
                    <button class="btn btn-primary mt-3" onclick="window.location.href='/login.html'">Ir a login</button>
                </div>
            `;
            return;
        }
        if (!response.ok) throw new Error('Error al cargar productos');

        const data = await response.json();

        Estado.productos = data.productos || [];
        Estado.paginacion.total = data.paginacion?.total || Estado.productos.length;
        // Bloque P1: hidratar limite efectivo desde el backend (ya clampeado por el cap)
        if (data.paginacion?.limite) Estado.paginacion.limite = data.paginacion.limite;

        // Filtrar localmente por stock si es necesario
        if (Estado.filtros.stock === 'critico') {
            Estado.productosFiltrados = Estado.productos.filter(p => p.estado_stock === 'critico');
        } else if (Estado.filtros.stock === 'ok') {
            Estado.productosFiltrados = Estado.productos.filter(p => p.estado_stock === 'ok' || p.estado_stock === 'exceso');
        } else {
            Estado.productosFiltrados = [...Estado.productos];
        }

        actualizarEstadisticas();
        actualizarContadorMasivo();
        if (Estado.productosFiltrados.length === 0) {
            const tieneFiltros = Estado.filtros.buscar || Estado.filtros.id_categoria || Estado.filtros.id_marca || Estado.filtros.id_proveedor || Estado.filtros.id_conjunto || Estado.filtros.stock;
            container.innerHTML = `
                <div class="empty-state">
                    <i class="bi bi-search empty-state-icon"></i>
                    <div class="empty-state-title">${tieneFiltros ? 'Sin resultados' : 'No hay productos cargados'}</div>
                    <div class="empty-state-text">${tieneFiltros ? 'Ningún producto coincide con los filtros actuales.' : 'Cargá productos para empezar.'}</div>
                </div>
            `;
            renderizarPaginacion();
            return;
        }
        renderizarProductos();
        renderizarPaginacion();

    } catch (error) {
        console.error('Error:', error);
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-exclamation-triangle empty-state-icon"></i>
                <div class="empty-state-title">Error al cargar productos</div>
                <div class="empty-state-text">${error.message}</div>
                <button class="btn btn-primary mt-3" onclick="cargarProductos()">Reintentar</button>
            </div>
        `;
    }
}

function recargarProductos() {
    Estado.paginacion.pagina = 1;
    cargarProductos();
}

// ============================================================
// BÚSQUEDA DROPDOWN
// ============================================================
async function buscarProductosDropdown(query) {
    const searchResults = document.getElementById('searchResults');

    try {
        const response = await fetchAPI(`/productos/buscar?q=${encodeURIComponent(query)}&id_lista_precio=${Estado.filtros.id_lista_precio}`);
        if (!response.ok) return;

        const data = await response.json();
        const results = data.results || [];

        if (results.length === 0) {
            searchResults.innerHTML = `
                <div class="search-result-item">
                    <i class="bi bi-search text-muted"></i>
                    <span class="text-muted">No se encontraron resultados</span>
                </div>
                <div class="search-result-item" style="border-top: 1px solid #eee; cursor: pointer;" onclick="buscarEnLista('${query}')">
                    <i class="bi bi-filter text-primary"></i>
                    <span class="text-primary">Buscar "${query}" en la lista completa</span>
                </div>
            `;
        } else {
            searchResults.innerHTML = results.map((p, index) => `
                <div class="search-result-item" data-index="${index}" data-id="${p.id_producto}" onclick="seleccionarResultadoBusqueda(${p.id_producto})">
                    ${p.url_imagen
                        ? `<img src="${p.url_imagen}" class="search-result-img" alt="">`
                        : `<div class="search-result-img d-flex align-items-center justify-content-center"><i class="bi bi-box text-muted"></i></div>`
                    }
                    <div class="search-result-info">
                        <div class="search-result-name">${p.nombre}</div>
                        <div class="search-result-meta">
                            SKU: ${p.sku}
                            ${p.marca ? ` · ${p.marca}` : ''}
                            ${p.proveedor_nombre ? ` · <span class="proveedor-badge">${p.proveedor_nombre}</span>` : ''}
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="small ${getStockTextClass(p.stock_real)}">Stock: ${p.stock_real}</div>
                        <div class="fw-bold text-primary">$${getPrecioDisplay(p)}</div>
                    </div>
                </div>
            `).join('') + `
                <div class="search-result-item" style="border-top: 1px solid #eee; cursor: pointer;" onclick="buscarEnLista('${query}')">
                    <i class="bi bi-filter text-primary"></i>
                    <span class="text-primary">Ver todos los resultados de "${query}"</span>
                </div>
            `;
        }

        searchResults.classList.add('visible');
        Estado.searchResultIndex = -1;

    } catch (error) {
        console.error('Error en búsqueda:', error);
    }
}

function buscarEnLista(query) {
    document.getElementById('searchResults').classList.remove('visible');
    Estado.filtros.buscar = query;
    Estado.paginacion.pagina = 1;
    cargarProductos();
}

function navegarResultadosBusqueda(e) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults.classList.contains('visible')) return;

    const items = searchResults.querySelectorAll('.search-result-item[data-id]');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        Estado.searchResultIndex = Math.min(Estado.searchResultIndex + 1, items.length - 1);
        actualizarResultadoActivo(items);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        Estado.searchResultIndex = Math.max(Estado.searchResultIndex - 1, 0);
        actualizarResultadoActivo(items);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (Estado.searchResultIndex >= 0) {
            const item = items[Estado.searchResultIndex];
            seleccionarResultadoBusqueda(parseInt(item.dataset.id));
        } else {
            buscarEnLista(document.getElementById('searchInput').value);
        }
    }
}

function actualizarResultadoActivo(items) {
    items.forEach((item, i) => {
        item.classList.toggle('active', i === Estado.searchResultIndex);
        if (i === Estado.searchResultIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

function seleccionarResultadoBusqueda(id_producto) {
    document.getElementById('searchResults').classList.remove('visible');
    editarProducto(id_producto);
}

// ============================================================
// VISTAS
// ============================================================
function cambiarVista(vista) {
    Estado.vistaActual = vista;

    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === vista);
    });

    localStorage.setItem('productos_vista', vista);
    renderizarProductos();
}

function cargarPreferenciasUsuario() {
    const vistaGuardada = localStorage.getItem('productos_vista');
    if (vistaGuardada) {
        cambiarVista(vistaGuardada);
    }
}

// ============================================================
// RENDERIZADO
// ============================================================
function renderizarProductos() {
    const container = document.getElementById('productsContainer');

    if (Estado.productosFiltrados.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-inbox empty-state-icon"></i>
                <div class="empty-state-title">No hay productos</div>
                <div class="empty-state-text">No se encontraron productos con los filtros seleccionados</div>
                <button class="btn btn-primary mt-3" onclick="limpiarFiltros()">Limpiar filtros</button>
            </div>
        `;
        return;
    }

    if (Estado.vistaActual === 'cards') {
        renderizarVistaCards(container);
    } else {
        renderizarVistaTabla(container);
    }
}

function renderizarVistaCards(container) {
    container.innerHTML = `
        <div class="products-grid">
            ${Estado.productosFiltrados.map(p => `
                <div class="product-card ${!p.activo ? 'inactivo' : ''}" onclick="editarProducto(${p.id_producto})">
                    <div class="product-card-image">
                        ${p.url_imagen
                            ? `<img src="${p.url_imagen}" alt="${p.nombre}">`
                            : `<i class="bi bi-box-seam no-image"></i>`
                        }
                        <span class="product-card-stock-badge stock-${p.estado_stock}">
                            ${p.stock_real} ${p.unidad_medida || 'u'}
                        </span>
                    </div>
                    <div class="product-card-body">
                        <div class="product-card-sku">${p.sku}${!p.activo ? ' <span class="badge bg-secondary" style="font-size:0.65em;">Inactivo</span>' : ''}</div>
                        <div class="product-card-name">${p.nombre}</div>
                        <div class="product-card-meta">
                            ${p.marca ? `<span class="product-card-badge">${p.marca}</span>` : ''}
                            ${p.categoria ? `<span class="product-card-badge">${p.categoria}</span>` : ''}
                            ${p.proveedores && p.proveedores.length > 0 ? `<span class="proveedor-badge">${p.proveedores[0].razon_social}</span>` : ''}
                        </div>
                        <div class="product-card-footer">
                            <div class="product-card-price">$${getPrecioDisplay(p)}</div>
                            <div class="product-card-stock">
                                <i class="bi bi-box-seam"></i> ${p.stock_real}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderizarVistaTabla(container) {
    const densidad = localStorage.getItem('productos.densidad') || 'compacta';
    const claseDensidad = densidad === 'compacta' ? 'dense' : '';

    const columnas = [
        { id: 'sku',     nombre: 'SKU',      sortable: true,  cls: 'sku' },
        { id: 'nombre',  nombre: 'Producto', sortable: true,  cls: 'nombre' },
        { id: 'marca',   nombre: 'Marca',    sortable: true,  cls: 'marca' },
        { id: 'stock',   nombre: 'Stock',    sortable: true,  cls: 'num' },
        { id: 'precio',  nombre: 'Precio',   sortable: true,  cls: 'num' },
        { id: 'acciones',nombre: '',         sortable: false, cls: 'num' }
    ];

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    container.innerHTML = `
        <div class="products-table-container">
            <table class="products-table ${claseDensidad}">
                <colgroup>
                    <col class="c-sku">
                    <col class="c-nombre">
                    <col class="c-marca">
                    <col class="c-stock">
                    <col class="c-precio">
                    <col class="c-acc">
                </colgroup>
                <thead>
                    <tr>
                        ${columnas.map(col => `
                            <th class="${col.cls} ${col.sortable ? 'sortable' : ''} ${Estado.ordenamiento.columna === col.id ? 'sorted-' + Estado.ordenamiento.direccion.toLowerCase() : ''}"
                                ${col.sortable ? `onclick="ordenarPor('${col.id}')"` : ''}>
                                ${col.nombre}
                            </th>
                        `).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${Estado.productosFiltrados.map(p => `
                        <tr class="${!p.activo ? 'inactivo' : ''}" onclick="editarProducto(${p.id_producto})" title="${esc(p.categoria || '')}${p.proveedores && p.proveedores.length > 0 ? ' · ' + esc(p.proveedores[0].razon_social) : ''}">
                            <td class="sku">${esc(p.sku)}${!p.activo ? ' <span class="badge bg-secondary" style="font-size:0.7em;vertical-align:middle;">Inactivo</span>' : ''}</td>
                            <td class="nombre">${esc(p.nombre)}</td>
                            <td class="marca">${esc(p.marca || '—')}</td>
                            <td class="num">
                                <span class="stock-dot ${p.estado_stock}"></span>${p.stock_real}
                            </td>
                            <td class="num table-price">$${getPrecioDisplay(p)}</td>
                            <td class="num">
                                <div class="table-actions">
                                    <button class="btn-table-action" onclick="event.stopPropagation(); editarProducto(${p.id_producto})" title="Editar"><i class="bi bi-pencil"></i></button>
                                    <button class="btn-table-action" onclick="event.stopPropagation(); ImagenesProductoModal.abrir(${p.id_producto}, '${String(p.nombre).replace(/'/g, "\\'")}')" title="Imagenes"><i class="bi bi-images"></i></button>
                                    <button class="btn-table-action danger" onclick="event.stopPropagation(); eliminarProducto(${p.id_producto}, '${String(p.nombre).replace(/'/g, "\\'")}')" title="Eliminar"><i class="bi bi-trash"></i></button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Fase 8: toggle de densidad compacta/normal (persistido)
function cambiarDensidad(densidad) {
    localStorage.setItem('productos.densidad', densidad);
    document.getElementById('btnDensCompacta')?.classList.toggle('active', densidad === 'compacta');
    document.getElementById('btnDensNormal')?.classList.toggle('active', densidad === 'normal');
    if (Estado.vistaActual !== 'cards') {
        renderizarProductos();
    }
}

// Inicializar estado del toggle al cargar
document.addEventListener('DOMContentLoaded', () => {
    const d = localStorage.getItem('productos.densidad') || 'compacta';
    setTimeout(() => cambiarDensidad(d), 100);
});

function renderizarPaginacion() {
    const container = document.getElementById('paginationContainer');
    const total = Estado.paginacion.total;
    const paginas = Math.ceil(total / Estado.paginacion.limite);

    if (paginas <= 1) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    const inicio = (Estado.paginacion.pagina - 1) * Estado.paginacion.limite + 1;
    const fin = Math.min(Estado.paginacion.pagina * Estado.paginacion.limite, total);

    document.getElementById('paginationInfo').textContent = `${inicio}-${fin} de ${total}`;

    let botonesHTML = `
        <button class="pagination-btn" ${Estado.paginacion.pagina === 1 ? 'disabled' : ''} onclick="irAPagina(${Estado.paginacion.pagina - 1})">
            <i class="bi bi-chevron-left"></i>
        </button>
    `;

    for (let i = 1; i <= paginas; i++) {
        if (i === 1 || i === paginas || (i >= Estado.paginacion.pagina - 2 && i <= Estado.paginacion.pagina + 2)) {
            botonesHTML += `<button class="pagination-btn ${i === Estado.paginacion.pagina ? 'active' : ''}" onclick="irAPagina(${i})">${i}</button>`;
        } else if (i === Estado.paginacion.pagina - 3 || i === Estado.paginacion.pagina + 3) {
            botonesHTML += `<span class="px-2">...</span>`;
        }
    }

    botonesHTML += `
        <button class="pagination-btn" ${Estado.paginacion.pagina === paginas ? 'disabled' : ''} onclick="irAPagina(${Estado.paginacion.pagina + 1})">
            <i class="bi bi-chevron-right"></i>
        </button>
    `;

    document.getElementById('paginationButtons').innerHTML = botonesHTML;
}

function irAPagina(pagina) {
    Estado.paginacion.pagina = pagina;
    cargarProductos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================
// ESTADÍSTICAS
// ============================================================
function actualizarEstadisticas() {
    const stats = {
        total: Estado.paginacion.total,
        ok: Estado.productos.filter(p => p.estado_stock === 'ok' || p.estado_stock === 'exceso').length,
        bajo: Estado.productos.filter(p => p.estado_stock === 'bajo').length,
        critico: Estado.productos.filter(p => p.estado_stock === 'critico').length
    };

    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statOk').textContent = stats.ok;
    document.getElementById('statBajo').textContent = stats.bajo;
    document.getElementById('statCritico').textContent = stats.critico;

    // 2026-05-21: contador de inactivos (consulta liviana al backend)
    actualizarContadorInactivos();
}

// ============================================================
// FILTROS
// ============================================================
function aplicarFiltros() {
    Estado.filtros.id_categoria = document.getElementById('filtroCategoria').value;
    // Bloque 7.2: subcategoria viaja como query param independiente al backend
    Estado.filtros.id_subcategoria = document.getElementById('filtroSubcategoria').value;
    Estado.filtros.id_marca = document.getElementById('filtroMarca').value;
    Estado.filtros.id_proveedor = document.getElementById('filtroProveedor').value;
    Estado.filtros.id_conjunto = document.getElementById('filtroConjunto').value;
    Estado.filtros.stock = document.getElementById('filtroStock').value;
    Estado.filtros.activo = document.getElementById('filtroActivo').value;
    Estado.filtros.visible_web = document.getElementById('filtroWeb').value;
    Estado.filtros.id_lista_precio = document.getElementById('listaPrecios').value || 1;

    Estado.paginacion.pagina = 1;
    cargarProductos();
}

function limpiarFiltros() {
    document.getElementById('filtroCategoria').value = '';
    // Bloque 7.2: reset filtro subcategoria
    document.getElementById('filtroSubcategoria').value = '';
    document.getElementById('filtroMarca').value = '';
    document.getElementById('filtroProveedor').value = '';
    document.getElementById('filtroConjunto').value = '';
    document.getElementById('filtroStock').value = '';
    document.getElementById('filtroActivo').value = '';
    document.getElementById('filtroWeb').value = '';
    document.getElementById('searchInput').value = '';
    document.getElementById('searchClear').classList.remove('visible');

    Estado.filtros = {
        buscar: '',
        id_categoria: '',
        id_marca: '',
        id_proveedor: '',
        id_conjunto: '',
        stock: '',
        activo: '',
        visible_web: '',
        incluir_inactivos: Estado.filtros.incluir_inactivos,
        id_lista_precio: Estado.filtros.id_lista_precio
    };

    Estado.paginacion.pagina = 1;
    cargarProductos();
}

// ============================================================
// ORDENAMIENTO
// ============================================================
function ordenarPor(columna) {
    if (Estado.ordenamiento.columna === columna) {
        Estado.ordenamiento.direccion = Estado.ordenamiento.direccion === 'ASC' ? 'DESC' : 'ASC';
    } else {
        Estado.ordenamiento.columna = columna;
        Estado.ordenamiento.direccion = 'ASC';
    }

    cargarProductos();
}

// ============================================================
// PANEL OPERACIONES MASIVAS
// ============================================================
function togglePanelMasivo() {
    Estado.panelMasivoVisible = !Estado.panelMasivoVisible;
    document.getElementById('panelMasivo').classList.toggle('visible', Estado.panelMasivoVisible);
    if (Estado.panelMasivoVisible) {
        actualizarContadorMasivo();
    }
}

function actualizarContadorMasivo() {
    document.getElementById('masivoCount').textContent = `${MasivoMgr.getCount()} productos`;
}

function abrirModalAjustePrecio() {
    document.getElementById('ajusteCantidad').textContent = document.getElementById('masivoCount').textContent.replace(' productos', '');
    document.getElementById('ajustePorcentaje').value = 10;
    document.getElementById('tipoAumento').checked = true;
    document.getElementById('ajusteVenta').checked = true;
    document.getElementById('ajusteCompra').checked = false;
    document.getElementById('ajusteMotivo').value = '';
    modalAjustePrecio.show();
}

async function ejecutarAjustePrecio() {
    const tipo = document.querySelector('input[name="tipoAjuste"]:checked').value;
    const porcentaje = parseFloat(document.getElementById('ajustePorcentaje').value);
    const aplicarVenta = document.getElementById('ajusteVenta').checked;
    const aplicarCompra = document.getElementById('ajusteCompra').checked;
    const motivo = document.getElementById('ajusteMotivo').value;

    if (porcentaje <= 0 || porcentaje > 100) {
        alert('El porcentaje debe ser entre 1 y 100');
        return;
    }

    if (!aplicarVenta && !aplicarCompra) {
        alert('Debe seleccionar al menos un tipo de precio a ajustar');
        return;
    }

    // Obtener IDs locales (F3: leen Estado.productosFiltrados, sin fetch al backend)
    const ids = MasivoMgr.getIds();
    if (ids.length === 0) {
        alert('No hay productos para ajustar');
        return;
    }
    if (!confirm(`¿Confirma aplicar ${tipo === 'aumento' ? 'aumento' : 'descuento'} del ${porcentaje}% a ${ids.length} productos?`)) {
        return;
    }
    try {

        const response = await fetchAPI('/productos/masivo/ajuste-precios', {
            method: 'POST',
            body: JSON.stringify({
                ids_productos: ids,
                porcentaje,
                tipo,
                aplicar_venta: aplicarVenta,
                aplicar_compra: aplicarCompra,
                motivo
            })
        });

        const result = await response.json();

        if (response.ok) {
            alert(`✓ ${result.message}`);
            modalAjustePrecio.hide();
            cargarProductos();
        } else {
            alert(`✗ ${result.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al ajustar precios');
    }
}

async function activarMasivo(activar) {
    const ids = MasivoMgr.getIds();
    if (ids.length === 0) {
        alert('No hay productos para modificar');
        return;
    }
    if (!confirm(`¿Confirma ${activar ? 'activar' : 'desactivar'} ${ids.length} productos?`)) {
        return;
    }
    try {
const response = await fetchAPI('/productos/masivo/cambiar-estado', {
            method: 'POST',
            body: JSON.stringify({ ids_productos: ids, activar })
        });

        const result = await response.json();

        if (response.ok) {
            alert(`✓ ${result.message}`);
            cargarProductos();
        } else {
            alert(`✗ ${result.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cambiar estado');
    }
}

// ============================================================
// IMPRIMIR Y EXPORTAR
// ============================================================

async function cambiarWebMasivo(subirWeb) {
    const ids = await obtenerIdsFiltrados();
    if (ids.length === 0) {
        alert("No hay productos que coincidan con los filtros");
        return;
    }
    const accion = subirWeb ? "subir a la web" : "quitar de la web";
    if (!confirm("¿" + accion.charAt(0).toUpperCase() + accion.slice(1) + " " + ids.length + " productos?")) return;
    try {
        const token = localStorage.getItem("authToken");
        const response = await fetch(API_URL + "/productos/masivo/cambiar-web", {
            method: "POST",
            headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
            body: JSON.stringify({ ids: ids, visible_web: subirWeb })
        });
        const data = await response.json();
        if (response.ok) {
            alert("Se " + (subirWeb ? "subieron" : "quitaron") + " " + data.afectados + " productos " + (subirWeb ? "a" : "de") + " la web");
            cargarProductos();
        } else {
            throw new Error(data.error || "Error al procesar");
        }
    } catch (error) {
        console.error("Error:", error);
        alert("Error: " + error.message);
    }
}

function imprimirVista() {
    // Actualizar header de impresión
    document.getElementById('printDate').textContent = `Fecha: ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`;
    
    const filtrosTexto = [];
    if (Estado.filtros.id_categoria) {
        const cat = Estado.categorias.find(c => c.id_categoria == Estado.filtros.id_categoria);
        if (cat) filtrosTexto.push(`Categoría: ${cat.nombre}`);
    }
    if (Estado.filtros.id_marca) {
        const marca = Estado.marcas.find(m => m.id_marca == Estado.filtros.id_marca);
        if (marca) filtrosTexto.push(`Marca: ${marca.nombre}`);
    }
    if (Estado.filtros.id_proveedor) {
        const prov = Estado.proveedores.find(p => p.id_proveedor == Estado.filtros.id_proveedor);
        if (prov) filtrosTexto.push(`Proveedor: ${prov.razon_social}`);
    }
    if (Estado.filtros.buscar) {
        filtrosTexto.push(`Búsqueda: "${Estado.filtros.buscar}"`);
    }
    
    document.getElementById('printFilters').textContent = filtrosTexto.length > 0 ? `Filtros: ${filtrosTexto.join(' | ')}` : '';
    
    window.print();
}

async function exportarExcel() {
    // Exportar vista actual en formato reimportable
    const ids = Estado.productosFiltrados.map(p => p.id_producto);
    if (ids.length === 0) {
        alert("No hay productos para exportar");
        return;
    }
    try {
        const token = localStorage.getItem("authToken");
        const response = await fetch(API_URL + "/productos/export/reimportable", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ ids: ids })
        });
        if (!response.ok) throw new Error("Error al exportar");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "Productos_" + new Date().toISOString().slice(0,10) + ".xlsx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error("Error:", error);
        alert("Error al exportar: " + error.message);
    }
}

function exportarPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
    
    // Título
    doc.setFontSize(16);
    doc.text('Listado de Productos - ERP LAGO', 14, 15);
    
    // Fecha
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR')}`, 14, 22);
    
    // Filtros aplicados
    const filtrosTexto = [];
    if (Estado.filtros.id_marca) {
        const marca = Estado.marcas.find(m => m.id_marca == Estado.filtros.id_marca);
        if (marca) filtrosTexto.push(`Marca: ${marca.nombre}`);
    }
    if (Estado.filtros.id_proveedor) {
        const prov = Estado.proveedores.find(p => p.id_proveedor == Estado.filtros.id_proveedor);
        if (prov) filtrosTexto.push(`Proveedor: ${prov.razon_social}`);
    }
    if (filtrosTexto.length > 0) {
        doc.text(`Filtros: ${filtrosTexto.join(' | ')}`, 14, 28);
    }
    
    // Datos de la tabla
    const tableData = Estado.productosFiltrados.map(p => [
        p.sku,
        p.nombre.length > 40 ? p.nombre.substring(0, 40) + '...' : p.nombre,
        p.categoria || '-',
        p.marca || '-',
        p.proveedores && p.proveedores.length > 0 ? p.proveedores[0].razon_social : '-',
        p.stock_real.toString(),
        `$${getPrecioDisplay(p)}`
    ]);

    doc.autoTable({
        startY: filtrosTexto.length > 0 ? 32 : 26,
        head: [['SKU', 'Producto', 'Categoría', 'Marca', 'Proveedor', 'Stock', 'Precio']],
        body: tableData,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [102, 126, 234], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 60 },
            2: { cellWidth: 30 },
            3: { cellWidth: 25 },
            4: { cellWidth: 35 },
            5: { cellWidth: 15, halign: 'right' },
            6: { cellWidth: 20, halign: 'right' }
        }
    });
    
    // Pie de página
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Página ${i} de ${pageCount}`, doc.internal.pageSize.width - 30, doc.internal.pageSize.height - 10);
        doc.text(`Total: ${Estado.productosFiltrados.length} productos`, 14, doc.internal.pageSize.height - 10);
    }
    
    const filename = `Productos_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
}

// ============================================================
// CRUD
// ============================================================
function abrirModalNuevo() {
    // Ocultar sección de estado (solo se muestra al editar)
    const seccionEstado = document.getElementById('seccionEstadoProducto');
    if (seccionEstado) seccionEstado.style.display = 'none';

    document.getElementById('formProducto').reset();
    document.getElementById('idProducto').value = '';
    // Limpiar proveedor y conjuntos
    document.getElementById('idProveedor').value = '';
    document.getElementById('codigoProveedor').value = '';
    // Limpiar precio compra y estado de edición
    Estado.productoEditando = null;
    const _pcNeto = document.getElementById('precioCompraNeto');
    const _pcIva = document.getElementById('precioCompraIva');
    if (_pcNeto) _pcNeto.value = '';
    if (_pcIva) _pcIva.value = '';
    // Generar campos duales de precios (NETO / CON IVA)
    generarCamposPrecios();
    document.querySelectorAll('#conjuntosCheckboxes input').forEach(cb => cb.checked = false);
    document.getElementById('modalTitulo').innerHTML = '<i class="bi bi-plus-circle"></i> Nuevo Producto';
    CodigosBarra.limpiar();
    document.getElementById('stockInicialGroup').style.display = 'block';

    Estado.listasPrecios.forEach(lista => {
        const input = document.getElementById(`precio_${lista.id_lista_precio}`);
        if (input) input.value = '';
    });

    modalProducto.show();
    setTimeout(() => document.getElementById('sku').focus(), 300);
}

async function editarProducto(id_producto) {
    try {
        const response = await fetchAPI(`/productos/${id_producto}`);
        if (!response.ok) throw new Error('Error al obtener producto');

        const producto = await response.json();
        Estado.productoEditando = producto;

        document.getElementById('idProducto').value = producto.id_producto;
        document.getElementById('sku').value = producto.sku;
        document.getElementById('nombre').value = producto.nombre;
        document.getElementById('descripcion').value = producto.descripcion || '';
        document.getElementById('idCategoria').value = producto.id_categoria || '';
        // Bloque 7.2: precarga subcategoria del producto al modal
        document.getElementById('idSubcategoria').value = producto.id_subcategoria || '';
        document.getElementById('idMarca').value = producto.id_marca || '';
        document.getElementById('idAlicuotaIva').value = producto.id_alicuota_iva;

        // Regenerar campos de precios con la alícuota del producto
        generarCamposPrecios();
        document.getElementById('unidadMedida').value = producto.unidad_medida || 'unidades';
        document.getElementById('codProveedor').value = producto.cod_proveedor || '';
        document.getElementById('stockInicial').value = producto.stock_real || 0;
        document.getElementById('stockInicialGroup').style.display = 'none';
        document.getElementById('stockMinimo').value = producto.stock_minimo || 0;
        document.getElementById('stockMaximo').value = producto.stock_maximo || 0;

        // Cargar proveedor actual
        document.getElementById('idProveedor').value = '';
        document.getElementById('codigoProveedor').value = '';
        if (producto.proveedores && producto.proveedores.length > 0) {
            const prov = producto.proveedores[0];
            document.getElementById('idProveedor').value = prov.id_proveedor || '';
            document.getElementById('codigoProveedor').value = prov.codigo_proveedor || '';
        }
        
        // Cargar todos los precios (neto y con IVA calculado)
        cargarPreciosEnModal(producto);
        
        // Marcar conjuntos actuales
        document.querySelectorAll('#conjuntosCheckboxes input').forEach(cb => cb.checked = false);
        if (producto.conjuntos && producto.conjuntos.length > 0) {
            producto.conjuntos.forEach(c => {
                const cb = document.getElementById(`conjunto_${c.id_conjunto}`);
                if (cb) cb.checked = true;
            });
        }
        
        document.getElementById('modalTitulo').innerHTML = '<i class="bi bi-pencil"></i> Editar Producto';
        modalProducto.show();
        CodigosBarra.cargar(producto.id_producto);
        setTimeout(() => document.getElementById('nombre').focus(), 300);

    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar el producto');
    }
}

async function guardarProducto() {
    const id_producto = document.getElementById('idProducto').value;
    // Bloqueo: IVA obligatorio (evita guardar producto sin alicuota)
    const _ivaSel = document.getElementById('idAlicuotaIva').value;
    if (!_ivaSel) { alert('Falta elegir el IVA del producto.'); return; }

    // Obtener proveedor seleccionado
    const proveedores = [];
    const idProveedor = document.getElementById('idProveedor').value;
    if (idProveedor) {
        proveedores.push({
            id_proveedor: parseInt(idProveedor),
            codigo_proveedor: document.getElementById('codigoProveedor').value.trim() || null,
            precio_compra: parseFloat(document.getElementById('precioCompraNeto').value) || 0
        });
    }
    
    // Obtener conjuntos seleccionados
    const conjuntos = [];
    document.querySelectorAll('#conjuntosCheckboxes input:checked').forEach(cb => {
        conjuntos.push({ id_conjunto: parseInt(cb.value), cantidad: 1 });
    });
    
    const datos = {
        sku: document.getElementById('sku').value.trim(),
        nombre: document.getElementById('nombre').value.trim(),
        descripcion: document.getElementById('descripcion').value.trim(),
        id_categoria: document.getElementById('idCategoria').value || null,
        id_subcategoria: document.getElementById('idSubcategoria').value || null,
        id_marca: document.getElementById('idMarca').value || null,
        id_alicuota_iva: document.getElementById('idAlicuotaIva').value || null,
        unidad_medida: document.getElementById('unidadMedida').value,
        cod_proveedor: document.getElementById('codProveedor').value.trim() || null,
        stock_minimo: parseInt(document.getElementById('stockMinimo').value) || 0,
        stock_maximo: parseInt(document.getElementById('stockMaximo').value) || 0,
        proveedores: proveedores,
        conjuntos: conjuntos,
        precios: []
    };

    // Preservar datos que el formulario no gestiona
    if (id_producto && Estado.productoEditando) {
        datos.url_imagen = Estado.productoEditando.url_imagen || null;
    }

    if (!id_producto) {
        datos.stock_inicial = parseInt(document.getElementById('stockInicial').value) || 0;
        // Codigos barra del buffer (se envian junto con el alta)
        datos.codigos_barra = CodigosBarra.obtenerBuffer();
    }

    Estado.listasPrecios.forEach(lista => {
        const precioNeto = obtenerPrecioNeto(`precio_${lista.id_lista_precio}`);
        if (precioNeto !== null) {
            datos.precios.push({
                id_lista_precio: lista.id_lista_precio,
                precio: precioNeto
            });
        }
    });

    if (!datos.sku || !datos.nombre) {
        alert('SKU y nombre son requeridos');
        return;
    }

    try {
        const url = id_producto ? `/productos/${id_producto}` : '/productos';
        const method = id_producto ? 'PUT' : 'POST';

        const response = await fetchAPI(url, { method, body: JSON.stringify(datos) });
        const result = await response.json();

        if (response.ok) {
            alert(`✓ ${result.message}`);
            modalProducto.hide();
            await cargarProductos();
        } else {
            alert(`✗ ${result.error || 'Error al guardar producto'}`);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al guardar producto');
    }
}

async function eliminarProducto(id_producto, nombre) {
    if (!confirm(`¿Eliminar el producto "${nombre}"?\n\nEsta acción no se puede deshacer.`)) {
        return;
    }

    try {
        const response = await fetchAPI(`/productos/${id_producto}`, { method: 'DELETE' });
        const result = await response.json();

        if (response.ok) {
            alert(`✓ ${result.message}`);
            await cargarProductos();
        } else {
            alert(`✗ ${result.error}`);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Error al eliminar producto');
    }
}

// ============================================================
// UTILIDADES
// ============================================================
function llenarSelect(selectId, datos, valueField, textField, placeholder = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    let html = placeholder ? `<option value="">${placeholder}</option>` : '';
    datos.forEach(item => {
        html += `<option value="${item[valueField]}">${item[textField]}</option>`;
    });
    select.innerHTML = html;
}

function generarCamposPrecios() {
    const container = document.getElementById('preciosContainer');
    if (!container) return;
    
    const selectAlicuota = document.getElementById('idAlicuotaIva');
    const alicuotaActual = Estado.alicuotasIva.find(a => a.id_alicuota == (selectAlicuota?.value || 3));
    const porcentajeIva = alicuotaActual ? parseFloat(alicuotaActual.porcentaje) : 21;
    
    container.innerHTML = `
        <div class="alert alert-info py-2 mb-3" style="font-size:0.85em;">
            <i class="bi bi-info-circle"></i> IVA ${porcentajeIva}% - Edita cualquier campo y el otro se calcula
        </div>
        <div class="row g-1 mb-2 text-center" style="font-size:0.75em; font-weight:600; color:#666;">
            <div class="col-4"></div>
            <div class="col-4">NETO (sin IVA)</div>
            <div class="col-4">CON IVA</div>
        </div>
        ${Estado.listasPrecios.map(lista => `
        <div class="row g-1 mb-2 align-items-center">
            <div class="col-4">
                <label class="form-label-lago mb-0" style="font-size:0.85em;">${lista.nombre}</label>
            </div>
            <div class="col-4">
                <div class="input-group input-group-sm">
                    <span class="input-group-text" style="font-size:0.8em;">$</span>
                    <input type="number" class="form-control form-control-lago precio-neto" 
                           id="precio_${lista.id_lista_precio}" 
                           data-id-lista="${lista.id_lista_precio}"
                           step="0.01" min="0" placeholder="0.00"
                           onchange="actualizarPrecioConIva(this)">
                </div>
            </div>
            <div class="col-4">
                <div class="input-group input-group-sm">
                    <span class="input-group-text" style="font-size:0.8em;">$</span>
                    <input type="number" class="form-control form-control-lago precio-con-iva" 
                           id="precio_iva_${lista.id_lista_precio}" 
                           data-id-lista="${lista.id_lista_precio}"
                           step="0.01" min="0" placeholder="0.00"
                           onchange="actualizarPrecioNeto(this)">
                </div>
            </div>
        </div>
        `).join('')}
        <hr class="my-2">
        <div class="row g-1 mb-2 align-items-center">
            <div class="col-4">
                <label class="form-label-lago mb-0" style="font-size:0.85em;"><i class="bi bi-truck"></i> Compra</label>
            </div>
            <div class="col-4">
                <div class="input-group input-group-sm">
                    <span class="input-group-text" style="font-size:0.8em;">$</span>
                    <input type="number" class="form-control form-control-lago precio-neto" 
                           id="precioCompraNeto" 
                           step="0.01" min="0" placeholder="0.00"
                           onchange="actualizarPrecioConIva(this, 'precioCompraIva')">
                </div>
            </div>
            <div class="col-4">
                <div class="input-group input-group-sm">
                    <span class="input-group-text" style="font-size:0.8em;">$</span>
                    <input type="number" class="form-control form-control-lago precio-con-iva" 
                           id="precioCompraIva" 
                           step="0.01" min="0" placeholder="0.00"
                           onchange="actualizarPrecioNeto(this, 'precioCompraNeto')">
                </div>
            </div>
        </div>
    `;
}

function actualizarPrecioConIva(inputNeto, inputIvaId = null) {
    const selectAlicuota = document.getElementById('idAlicuotaIva');
    const alicuotaActual = Estado.alicuotasIva.find(a => a.id_alicuota == (selectAlicuota?.value || 3));
    const porcentajeIva = alicuotaActual ? parseFloat(alicuotaActual.porcentaje) : 21;
    
    const neto = parseFloat(inputNeto.value) || 0;
    const conIva = (neto * (1 + porcentajeIva / 100)).toFixed(2);
    
    let inputIva;
    if (inputIvaId) {
        inputIva = document.getElementById(inputIvaId);
    } else {
        const idLista = inputNeto.dataset.idLista;
        inputIva = document.getElementById('precio_iva_' + idLista);
    }
    if (inputIva) inputIva.value = conIva;
}

function actualizarPrecioNeto(inputIva, inputNetoId = null) {
    const selectAlicuota = document.getElementById('idAlicuotaIva');
    const alicuotaActual = Estado.alicuotasIva.find(a => a.id_alicuota == (selectAlicuota?.value || 3));
    const porcentajeIva = alicuotaActual ? parseFloat(alicuotaActual.porcentaje) : 21;
    
    const conIva = parseFloat(inputIva.value) || 0;
    const neto = (conIva / (1 + porcentajeIva / 100)).toFixed(4); // F4: 4 decimales preservan precision para que neto*IVA cierre al con-IVA ingresado
    
    let inputNeto;
    if (inputNetoId) {
        inputNeto = document.getElementById(inputNetoId);
    } else {
        const idLista = inputIva.dataset.idLista;
        inputNeto = document.getElementById('precio_' + idLista);
    }
    if (inputNeto) inputNeto.value = neto;
}

function cargarPreciosEnModal(producto) {
    const selectAlicuota = document.getElementById('idAlicuotaIva');
    const alicuotaActual = Estado.alicuotasIva.find(a => a.id_alicuota == (selectAlicuota?.value || 3));
    const porcentajeIva = alicuotaActual ? parseFloat(alicuotaActual.porcentaje) : 21;
    
    if (producto.precios_listas) {
        producto.precios_listas.forEach(pl => {
            const inputNeto = document.getElementById('precio_' + pl.id_lista);
            const inputIva = document.getElementById('precio_iva_' + pl.id_lista);
            if (inputNeto && pl.precio) {
                inputNeto.value = pl.precio;
                if (inputIva) {
                    inputIva.value = (parseFloat(pl.precio) * (1 + porcentajeIva / 100)).toFixed(2);
                }
            }
        });
    }
    
    if (producto.proveedores && producto.proveedores.length > 0) {
        const prov = producto.proveedores[0];
        const inputNetoCompra = document.getElementById('precioCompraNeto');
        const inputIvaCompra = document.getElementById('precioCompraIva');
        if (prov.precio_compra && inputNetoCompra) {
            inputNetoCompra.value = prov.precio_compra;
            if (inputIvaCompra) {
                inputIvaCompra.value = (parseFloat(prov.precio_compra) * (1 + porcentajeIva / 100)).toFixed(2);
            }
        }
    }
}
function formatearPrecio(precio) {
    if (!precio) return '0,00';
    return parseFloat(precio).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getStockTextClass(stock) {
    if (stock <= 0) return 'text-danger';
    if (stock <= 5) return 'text-warning';
    return 'text-success';
}

function cerrarSesion() {
    localStorage.removeItem('authToken');
    console.debug('Redirección a login interceptada - Seguridad delegada al middleware backend');
}


// ============================================================================
// IMPORTACIÓN DESDE EXCEL
// ============================================================================

let archivoImportSeleccionado = null;

async function descargarPlantilla(modo = 'completo', conDatos = false) {
    try {
        const token = localStorage.getItem('authToken');
        
        const response = await fetch(`${API_URL}/productos/import/plantilla?modo=${modo}&incluir_datos=${conDatos}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Error al descargar plantilla');
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Plantilla_Productos_${modo}_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error:', error);
        alert('Error: ' + error.message);
    }
}

function abrirModalImportar() {
    archivoImportSeleccionado = null;
    previewImportData = null;
    EstadoImport.reset();
    document.getElementById('inputArchivoImport').value = '';
    document.getElementById('archivoSeleccionado').classList.add('d-none');
    document.getElementById('resultadoImport').innerHTML = '';

    const modal = new bootstrap.Modal(document.getElementById('modalImportar'));
    modal.show();
    irAPaso(1);
    configurarDropZone();
}

function configurarDropZone() {
    const dropZone = document.getElementById('dropZoneImport');
    const input = document.getElementById('inputArchivoImport');
    
    dropZone.onclick = () => input.click();
    
    input.onchange = (e) => {
        if (e.target.files.length > 0) {
            seleccionarArchivoImport(e.target.files[0]);
        }
    };
    
    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    };
    
    dropZone.ondragleave = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
    };
    
    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                seleccionarArchivoImport(file);
            } else {
                alert('Solo se permiten archivos Excel (.xlsx, .xls)');
            }
        }
    };
}


// Variable global para almacenar datos del preview
let previewImportData = null;

function seleccionarArchivoImport(file) {
    archivoImportSeleccionado = file;
    EstadoImport.reset();
    document.getElementById('nombreArchivoImport').textContent = file.name;
    document.getElementById('archivoSeleccionado').classList.remove('d-none');
    document.getElementById('btnAnalizarArchivo').disabled = false;
    document.getElementById('resultadoImport').innerHTML = '';
    // Ya no dispara preview directo - el usuario hace click en "Analizar columnas"
}

async function ejecutarPreview() {
    const resultadoDiv = document.getElementById('resultadoImport');
    resultadoDiv.classList.remove('d-none');
    resultadoDiv.innerHTML = '<div class="text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Analizando archivo...</div>';
    
    try {
        const token = localStorage.getItem('authToken');
        const formData = new FormData();
        formData.append('archivo', archivoImportSeleccionado);
        
        const response = await fetch(`${API_URL}/productos/import/preview`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            previewImportData = data;
            mostrarPreview(data);
        } else {
            resultadoDiv.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-exclamation-triangle me-2"></i>' + (data.error || 'Error al analizar') + '</div>';
        }
    } catch (error) {
        console.error('Error preview:', error);
        resultadoDiv.innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-exclamation-triangle me-2"></i>Error de conexión: ' + error.message + '</div>';
    }
}

function mostrarPreview(data) {
    const r = data.resumen;
    const resultadoDiv = document.getElementById('resultadoImport');
    
    const existentesCount = r.productos_existentes.length;
    const nuevosCount = r.productos_nuevos.length;
    const nuevosValidos = r.nuevos_validos;
    const inactivosCount = (r.productos_inactivos || []).length + (r.variantes_inactivas || []).length;
    const inactivosProductos = r.productos_inactivos || [];
    const nuevosConErrores = r.nuevos_con_errores;
    const varExistentes = r.variantes_existentes.length;
    const varNuevas = r.variantes_nuevas.length;
    
    let html = '<div class="card border-0 shadow-sm"><div class="card-header bg-light"><h6 class="mb-0"><i class="bi bi-search me-2"></i>Análisis del archivo</h6></div><div class="card-body">';
    
    html += '<div class="row text-center mb-3">' +
        '<div class="col"><div class="border rounded p-2"><div class="fs-4 fw-bold text-primary">' + existentesCount + '</div><small class="text-muted">Existentes</small></div></div>' +
        '<div class="col"><div class="border rounded p-2 ' + (nuevosCount > 0 ? 'bg-warning-subtle' : '') + '"><div class="fs-4 fw-bold text-warning">' + nuevosCount + '</div><small class="text-muted">Nuevos</small></div></div>' +
        '<div class="col"><div class="border rounded p-2"><div class="fs-4 fw-bold text-info">' + varExistentes + '</div><small class="text-muted">Var. exist.</small></div></div>' +
        '<div class="col"><div class="border rounded p-2 ' + (varNuevas > 0 ? 'bg-warning-subtle' : '') + '"><div class="fs-4 fw-bold text-warning">' + varNuevas + '</div><small class="text-muted">Var. nuevas</small></div></div>' +
        '<div class="col"><div class="border rounded p-2 ' + (inactivosCount > 0 ? 'bg-secondary-subtle' : '') + '"><div class="fs-4 fw-bold text-secondary">' + inactivosCount + '</div><small class="text-muted">Inactivos (ignorados)</small></div></div>' +
        '</div>';

    if (inactivosCount > 0) {
        html += '<div class="alert alert-secondary py-2 mb-3"><small><i class="bi bi-archive me-1"></i><strong>' + inactivosCount + '</strong> SKUs del archivo coinciden con productos dados de baja en la BD. ' +
            '<strong>No se importan</strong> en ningún modo (para reactivarlos se usa el módulo de productos manualmente).';
        if (inactivosProductos.length > 0 && inactivosProductos.length <= 50) {
            html += ' <a class="text-decoration-none" data-bs-toggle="collapse" href="#detalleInactivos">Ver lista</a>' +
                '<div class="collapse mt-2" id="detalleInactivos"><div class="table-responsive" style="max-height: 150px;"><table class="table table-sm table-striped mb-0">' +
                '<thead class="sticky-top bg-white"><tr><th>Fila</th><th>SKU</th><th>Nombre en BD</th></tr></thead><tbody>';
            for (var ki = 0; ki < inactivosProductos.length; ki++) {
                var pi = inactivosProductos[ki];
                html += '<tr><td>' + pi.fila + '</td><td><code>' + pi.sku + '</code></td><td class="small">' + (pi.nombre_bd || '') + '</td></tr>';
            }
            html += '</tbody></table></div></div>';
        }
        html += '</small></div>';
    }
    
    html += '<div class="border rounded p-3 bg-light"><h6 class="mb-3"><i class="bi bi-sliders me-2"></i>¿Qué querés hacer?</h6>';

    var hayExist = existentesCount > 0;
    var hayNuevos = nuevosValidos > 0;

    if (hayExist && hayNuevos) {
        // Hay decisión real: radio group, default NO-DESTRUCTIVO (solo nuevos)
        html += '<div class="form-check mb-2"><input class="form-check-input" type="radio" name="modoImport" id="radModoSoloNuevos" value="solo_nuevos" checked>' +
            '<label class="form-check-label" for="radModoSoloNuevos"><strong>Solo crear nuevos</strong> ' +
            '<span class="badge bg-success ms-1">' + nuevosValidos + '</span>' +
            (nuevosConErrores > 0 ? ' <span class="badge bg-danger ms-1">' + nuevosConErrores + ' con errores</span>' : '') +
            ' <small class="text-muted ms-1">— no toca los ' + existentesCount + ' existentes</small></label></div>' +
            '<div class="form-check mb-2"><input class="form-check-input" type="radio" name="modoImport" id="radModoAmbos" value="ambos">' +
            '<label class="form-check-label" for="radModoAmbos"><strong>Crear nuevos + actualizar existentes</strong> ' +
            '<span class="badge bg-success ms-1">' + nuevosValidos + '</span> + <span class="badge bg-primary">' + existentesCount + '</span></label></div>';
    } else if (hayExist) {
        html += '<div class="alert alert-info mb-0 py-2"><i class="bi bi-info-circle me-1"></i>Se actualizarán los <strong>' + existentesCount + '</strong> productos existentes. No hay productos nuevos válidos en el archivo.</div>' +
            '<input type="hidden" id="modoImportFijo" value="solo_existentes">';
    } else if (hayNuevos) {
        html += '<div class="alert alert-info mb-0 py-2"><i class="bi bi-info-circle me-1"></i>Se crearán los <strong>' + nuevosValidos + '</strong> productos nuevos. No hay productos existentes en este archivo.</div>' +
            '<input type="hidden" id="modoImportFijo" value="solo_nuevos">';
    } else {
        html += '<div class="alert alert-warning mb-0 py-2"><i class="bi bi-exclamation-triangle me-1"></i>No hay nada para importar. Revisá los errores debajo.</div>';
    }

    if (hayNuevos && nuevosConErrores > 0) {
        html += '<div class="alert alert-warning mb-0 py-2 mt-2"><small><i class="bi bi-exclamation-triangle me-1"></i>' + nuevosConErrores + ' productos nuevos quedaron con errores y no se importarán.</small></div>';
    }

    html += '</div>';
    
    if (nuevosCount > 0) {
        html += '<div class="mt-3"><a class="text-decoration-none small" data-bs-toggle="collapse" href="#detalleNuevos"><i class="bi bi-chevron-down me-1"></i>Ver productos nuevos (' + nuevosCount + ')</a>' +
            '<div class="collapse mt-2" id="detalleNuevos"><div class="table-responsive" style="max-height: 150px;"><table class="table table-sm table-striped mb-0">' +
            '<thead class="sticky-top bg-white"><tr><th>Fila</th><th>SKU</th><th>Nombre</th><th>Estado</th></tr></thead><tbody>';
        for (var i = 0; i < r.productos_nuevos.length; i++) {
            var p = r.productos_nuevos[i];
            html += '<tr><td>' + p.fila + '</td><td><code>' + p.sku + '</code></td><td>' + p.nombre + '</td><td>' + 
                (p.valido ? '<span class="badge bg-success">OK</span>' : '<span class="badge bg-danger" title="' + (p.errores ? p.errores.join(', ') : '') + '">Error</span>') + '</td></tr>';
        }
        html += '</tbody></table></div></div></div>';
    }
    
    if (data.errores_validacion && data.errores_validacion.length > 0) {
        html += '<div class="mt-3"><a class="text-decoration-none small text-danger" data-bs-toggle="collapse" href="#detalleErrores"><i class="bi bi-exclamation-triangle me-1"></i>Errores (' + data.errores_validacion.length + ')</a>' +
            '<div class="collapse mt-2" id="detalleErrores"><div class="table-responsive" style="max-height: 120px;"><table class="table table-sm mb-0">' +
            '<thead class="sticky-top bg-white"><tr><th>Fila</th><th>SKU</th><th>Error</th></tr></thead><tbody>';
        for (var j = 0; j < data.errores_validacion.length; j++) {
            var e = data.errores_validacion[j];
            html += '<tr class="table-danger"><td>' + e.fila + '</td><td><code>' + e.sku + '</code></td><td class="small">' + e.errores.join(', ') + '</td></tr>';
        }
        html += '</tbody></table></div></div></div>';
    }
    
    html += '</div></div>';
    resultadoDiv.innerHTML = html;
    
    // Habilitar botón si hay algo importable. El modo lo decide el radio (default 'solo_nuevos').
    var hayAlgoImportable = existentesCount > 0 || nuevosValidos > 0;
    document.getElementById('btnEjecutarImport').disabled = !hayAlgoImportable;
}

function limpiarArchivoImport() {
    archivoImportSeleccionado = null;
    previewImportData = null;
    EstadoImport.reset();
    document.getElementById('inputArchivoImport').value = '';
    document.getElementById('archivoSeleccionado').classList.add('d-none');
    document.getElementById('resultadoImport').innerHTML = '';
    irAPaso(1);
}

async function ejecutarImportacion() {
    if (!archivoImportSeleccionado) {
        alert('Selecciona un archivo Excel');
        return;
    }
    
    // Determinar modo: si hay decisión, viene del radio; si no, del hidden de modo fijo
    var modo = null;
    var radioChecked = document.querySelector('input[name="modoImport"]:checked');
    if (radioChecked) {
        modo = radioChecked.value;
    } else {
        var hidden = document.getElementById('modoImportFijo');
        modo = hidden ? hidden.value : null;
    }
    if (!modo) {
        alert('No hay nada para importar.');
        return;
    }
    // Mapeo modo → flags backend (controller no cambia)
    var actualizarExistentes = (modo === 'ambos' || modo === 'solo_existentes');
    var crearNuevos = (modo === 'solo_nuevos' || modo === 'ambos');
    
    var mensaje = '¿Confirmar importación?\n\n';
    if (actualizarExistentes && previewImportData) mensaje += '• Actualizar ' + previewImportData.resumen.productos_existentes.length + ' productos existentes\n';
    if (crearNuevos && previewImportData) mensaje += '• Crear ' + previewImportData.resumen.nuevos_validos + ' productos nuevos\n';
    if (!confirm(mensaje)) return;
    
    var btn = document.getElementById('btnEjecutarImport');
    var btnTexto = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Importando...';
    
    try {
        var token = localStorage.getItem('authToken');
        var formData = new FormData();
        formData.append('archivo', archivoImportSeleccionado);
        formData.append('actualizar_existentes', actualizarExistentes);
        formData.append('crear_nuevos', crearNuevos);
        var preciosIncluyenIva = document.getElementById('chkPreciosIncluyenIva')?.checked ?? true;
        var porcentajeIva = document.getElementById('selectAlicuotaIva')?.value || '21';
        formData.append('precios_incluyen_iva', preciosIncluyenIva);
        formData.append('porcentaje_iva', porcentajeIva);
        // Adjuntar mapeo (si el usuario eligió columnas)
        if (EstadoImport.mapeo && Object.keys(EstadoImport.mapeo).length > 0) {
            formData.append('mapeo', JSON.stringify(EstadoImport.mapeo));
        }
        
        var response = await fetch(API_URL + '/productos/import/excel', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        
        var data = await response.json();
        var resultadoDiv = document.getElementById('resultadoImport');
        
        if (response.ok && data.success) {
            var r = data.resultados;
            resultadoDiv.innerHTML = '<div class="alert alert-success mb-0">' +
                '<h6 class="alert-heading"><i class="bi bi-check-circle me-2"></i>Importación exitosa</h6><hr>' +
                '<div class="row text-center">' +
                '<div class="col"><div class="fs-4 fw-bold text-success">' + r.productos_creados + '</div><small>Creados</small></div>' +
                '<div class="col"><div class="fs-4 fw-bold text-primary">' + r.productos_actualizados + '</div><small>Actualizados</small></div>' +
                '<div class="col"><div class="fs-4 fw-bold text-info">' + r.variantes_creadas + '</div><small>Var. creadas</small></div>' +
                '<div class="col"><div class="fs-4 fw-bold text-secondary">' + r.variantes_actualizadas + '</div><small>Var. actual.</small></div>' +
                '<div class="col"><div class="fs-4 fw-bold text-muted">' + r.sin_cambios + '</div><small>Sin cambios</small></div>' +
                '</div>' + (r.omitidos > 0 ? '<div class="mt-2 text-muted small"><i class="bi bi-info-circle me-1"></i>' + r.omitidos + ' omitidos</div>' : '') + '</div>';
            setTimeout(function() { recargarProductos(); var modal = bootstrap.Modal.getInstance(document.getElementById('modalImportar')); if (modal) modal.hide(); }, 2000);
        } else {
            var erroresHtml = '';
            if (data.errores && data.errores.length > 0) {
                erroresHtml = '<div class="table-responsive mt-2" style="max-height: 200px;"><table class="table table-sm table-striped mb-0"><thead class="sticky-top bg-white"><tr><th>Fila</th><th>SKU</th><th>Errores</th></tr></thead><tbody>';
                for (var i = 0; i < data.errores.length; i++) {
                    var e = data.errores[i];
                    erroresHtml += '<tr><td>' + e.fila + '</td><td><code>' + e.sku + '</code></td><td class="text-danger small">' + e.errores.join(', ') + '</td></tr>';
                }
                erroresHtml += '</tbody></table></div>';
            }
            resultadoDiv.innerHTML = '<div class="alert alert-danger mb-0"><h6 class="alert-heading"><i class="bi bi-exclamation-triangle me-2"></i>' + (data.error || 'Error') + '</h6>' +
                (data.total_filas ? '<p class="mb-1">Total: ' + data.total_filas + ' | Errores: ' + data.filas_con_error + '</p>' : '') + erroresHtml + '</div>';
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('resultadoImport').innerHTML = '<div class="alert alert-danger mb-0"><i class="bi bi-exclamation-triangle me-2"></i>Error: ' + error.message + '</div>';
    } finally {
        btn.disabled = false;
        btn.innerHTML = btnTexto;
    }
}

// ============================================================
// OBTENER IDS FILTRADOS (para operaciones masivas)
// ============================================================
async function obtenerIdsFiltrados() {
    return MasivoMgr.getIds();
}

// ============================================================
// CARGADOR DE IMÁGENES DESDE URLs
// ============================================================

let modalCargarImagenes;
let imagenesAnalizadas = [];

function abrirModalCargarImagenes() {
    if (!modalCargarImagenes) {
        modalCargarImagenes = new bootstrap.Modal(document.getElementById('modalCargarImagenes'));
    }
    document.getElementById('txtUrlsImagenes').value = '';
    document.getElementById('chkSobrescribirImagenes').checked = false;
    document.getElementById('imgStep1').classList.remove('d-none');
    document.getElementById('imgStep2').classList.add('d-none');
    document.getElementById('imgStep3').classList.add('d-none');
    document.getElementById('btnAnalizarImagenes').classList.remove('d-none');
    document.getElementById('btnAplicarImagenes').classList.add('d-none');
    imagenesAnalizadas = [];
    modalCargarImagenes.show();
}

function volverPaso1Imagenes() {
    document.getElementById('imgStep1').classList.remove('d-none');
    document.getElementById('imgStep2').classList.add('d-none');
    document.getElementById('btnAnalizarImagenes').classList.remove('d-none');
    document.getElementById('btnAplicarImagenes').classList.add('d-none');
}

async function analizarImagenes() {
    const texto = document.getElementById('txtUrlsImagenes').value.trim();
    const sobrescribir = document.getElementById('chkSobrescribirImagenes').checked;

    if (!texto) {
        alert('Pegá al menos una URL de imagen');
        return;
    }

    const urls = texto.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));

    if (urls.length === 0) {
        alert('No se encontraron URLs válidas');
        return;
    }

    document.getElementById('btnAnalizarImagenes').disabled = true;
    document.getElementById('btnAnalizarImagenes').innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Analizando...';

    try {
        const response = await fetchAPI('/productos/analizar-imagenes', {
            method: 'POST',
            
            body: JSON.stringify({ urls, sobrescribir })
        });

        if (!response.ok) throw new Error('Error al analizar');

        const data = await response.json();
        imagenesAnalizadas = data.resultados;
        mostrarPreviewImagenes(data);

    } catch (error) {
        console.error('Error:', error);
        alert('Error al analizar: ' + error.message);
    } finally {
        document.getElementById('btnAnalizarImagenes').disabled = false;
        document.getElementById('btnAnalizarImagenes').innerHTML = '<i class="bi bi-search"></i> Analizar';
    }
}

function mostrarPreviewImagenes(data) {
    const tbody = document.getElementById('tbodyPreviewImagenes');
    
    const cargar = data.resultados.filter(r => r.accion === 'cargar').length;
    const sobrescribir = data.resultados.filter(r => r.accion === 'sobrescribir').length;
    const omitir = data.resultados.filter(r => r.accion === 'omitir').length;
    const noEncontrado = data.resultados.filter(r => r.accion === 'no_encontrado').length;

    document.getElementById('imgResumenPreview').innerHTML = 
        `<span class="text-success">${cargar} a cargar</span>` +
        (sobrescribir > 0 ? ` · <span class="text-warning">${sobrescribir} a sobrescribir</span>` : '') +
        (omitir > 0 ? ` · <span class="text-secondary">${omitir} omitidos</span>` : '') +
        (noEncontrado > 0 ? ` · <span class="text-danger">${noEncontrado} no encontrados</span>` : '');

    tbody.innerHTML = data.resultados.map(r => {
        let icono, clase, accionTexto;
        switch (r.accion) {
            case 'cargar': icono = 'check-circle-fill'; clase = 'text-success'; accionTexto = 'Se cargará'; break;
            case 'sobrescribir': icono = 'arrow-repeat'; clase = 'text-warning'; accionTexto = 'Se sobrescribirá'; break;
            case 'omitir': icono = 'dash-circle'; clase = 'text-secondary'; accionTexto = 'Ya tiene imagen'; break;
            case 'no_encontrado': icono = 'x-circle-fill'; clase = 'text-danger'; accionTexto = 'SKU no encontrado'; break;
        }
        return `
            <tr class="${r.accion === 'no_encontrado' ? 'table-danger' : ''}">
                <td><i class="bi bi-${icono} ${clase}"></i></td>
                <td><code>${r.sku}</code></td>
                <td>${r.producto || '-'}</td>
                <td><small class="${clase}">${accionTexto}</small></td>
                <td><img src="${r.url}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" onerror="this.style.display='none'"></td>
            </tr>
        `;
    }).join('');

    document.getElementById('imgStep1').classList.add('d-none');
    document.getElementById('imgStep2').classList.remove('d-none');
    document.getElementById('btnAnalizarImagenes').classList.add('d-none');
    
    if (cargar > 0 || sobrescribir > 0) {
        document.getElementById('btnAplicarImagenes').classList.remove('d-none');
    }
}

async function aplicarImagenes() {
    const aAplicar = imagenesAnalizadas.filter(r => r.accion === 'cargar' || r.accion === 'sobrescribir');
    
    if (aAplicar.length === 0) {
        alert('No hay imágenes para aplicar');
        return;
    }

    document.getElementById('btnAplicarImagenes').disabled = true;
    document.getElementById('btnAplicarImagenes').innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Aplicando...';

    try {
        const response = await fetchAPI('/productos/aplicar-imagenes', {
            method: 'POST',
            
            body: JSON.stringify({ imagenes: aAplicar })
        });

        if (!response.ok) throw new Error('Error al aplicar');

        const data = await response.json();

        document.getElementById('imgStep2').classList.add('d-none');
        document.getElementById('imgStep3').classList.remove('d-none');
        document.getElementById('btnAplicarImagenes').classList.add('d-none');
        
        document.getElementById('imgResultadoTitulo').textContent = '¡Imágenes cargadas!';
        document.getElementById('imgResultadoDetalle').textContent = `Se actualizaron ${data.actualizados} productos.`;

        cargarProductos();

    } catch (error) {
        console.error('Error:', error);
        alert('Error al aplicar: ' + error.message);
    } finally {
        document.getElementById('btnAplicarImagenes').disabled = false;
        document.getElementById('btnAplicarImagenes').innerHTML = '<i class="bi bi-check-lg"></i> Aplicar';
    }
}

// ============================================================
// TOGGLE PRECIO NETO / CON IVA
// ============================================================
function getPrecioDisplay(producto) {
    const mostrarConIva = document.getElementById('precioConIva')?.checked || false;
    const precioNeto = parseFloat(producto.precio) || 0;
    
    if (mostrarConIva && precioNeto > 0) {
        const ivaPorcentaje = parseFloat(producto.iva_porcentaje) || 21;
        const precioConIva = precioNeto * (1 + ivaPorcentaje / 100);
        return formatearPrecio(precioConIva);
    }
    return formatearPrecio(precioNeto);
}

// Listener para el toggle de precio
document.addEventListener('DOMContentLoaded', function() {
    const toggleNeto = document.getElementById('precioNeto');
    const toggleIva = document.getElementById('precioConIva');
    
    if (toggleNeto) {
        toggleNeto.addEventListener('change', () => renderizarProductos());
    }
    if (toggleIva) {
        toggleIva.addEventListener('change', () => renderizarProductos());
    }
});

// Obtener precio neto de un input
function obtenerPrecioNeto(inputId) {
    const input = document.getElementById(inputId);
    if (!input || !input.value) return null;
    const valor = parseFloat(input.value);
    return isNaN(valor) ? null : valor;
}

// ============================================================================
// ARCHIVO ORIGEN - Filtro y Exportación
// ============================================================================

async function cargarArchivosOrigen() {
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_URL}/productos/archivos-origen`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        const select = document.getElementById('filtroArchivoOrigen');
        if (!select || !data.archivos) return;
        select.innerHTML = '<option value="">Archivo Origen</option>';
        data.archivos.forEach(a => {
            select.innerHTML += `<option value="${a.archivo_origen}">${a.archivo_origen} (${a.cantidad})</option>`;
        });
    } catch (error) {
        console.error('Error cargando archivos origen:', error);
    }
}

async function exportarPorArchivoOrigen() {
    const select = document.getElementById('filtroArchivoOrigen');
    const archivo = select ? select.value : '';
    if (!archivo) {
        alert('Seleccioná un Archivo Origen en el filtro primero');
        return;
    }
    try {
        const token = localStorage.getItem('authToken');
        const response = await fetch(`${API_URL}/productos/exportar-por-archivo/${encodeURIComponent(archivo)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Error al exportar');
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${archivo}_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        alert('Error al exportar: ' + error.message);
    }
}

// DEPRECATED 2026-04-10: funcion sincronizarWeb() eliminada.
// app.lago.ar lee BD en vivo - los cambios se reflejan al instante.


// ========================================================================
// CODIGOS DE BARRA (gestion en modal)
// ========================================================================
const CodigosBarra = {
    lista: [],
    idProducto: null,

    async cargar(idProducto) {
        this.idProducto = idProducto;
        if (!idProducto) {
            this.lista = [];
            this.render();
            return;
        }
        try {
            const resp = await fetchAPI(`/productos/${idProducto}/codigos-barra`);
            if (!resp.ok) throw new Error('Error al cargar codigos');
            const data = await resp.json();
            this.lista = data.codigos || [];
            this.render();
        } catch (err) {
            console.error(err);
            this.lista = [];
            this.render();
        }
    },

    limpiar() {
        this.lista = [];
        this.idProducto = null;
        this.render();
    },

    render() {
        const container = document.getElementById('listaCodigosBarra');
        const badge = document.getElementById('badgeCantCodigos');
        if (!container || !badge) return;
        badge.textContent = this.lista.length;
        if (this.lista.length === 0) {
            container.innerHTML = '<div class="text-muted small text-center py-2">Sin codigos</div>';
            return;
        }
        container.innerHTML = this.lista.map(c => `
            <div class="d-flex justify-content-between align-items-center border-bottom py-1 px-1">
                <span>${c}</span>
                <button type="button" class="btn btn-sm btn-outline-danger btn-xs py-0 px-1" 
                        style="font-size:0.7rem;" onclick="CodigosBarra.eliminar('${c.replace(/'/g, "\\'")}')">
                    <i class="bi bi-x"></i>
                </button>
            </div>
        `).join('');
    },

    async agregar() {
        const input = document.getElementById('inputNuevoCodigo');
        const codigo = input.value.trim();
        if (!codigo) return;

        // Si no hay producto aun (alta), agregar a buffer local
        if (!this.idProducto) {
            if (this.lista.includes(codigo)) {
                alert('Codigo ya agregado');
                return;
            }
            this.lista.push(codigo);
            this.render();
            input.value = '';
            input.focus();
            return;
        }

        // Si hay producto, llamar a la API
        try {
            const resp = await fetchAPI(`/productos/${this.idProducto}/codigos-barra`, {
                method: 'POST',
                body: JSON.stringify({ codigo_barras: codigo })
            });
            const data = await resp.json();
            if (!resp.ok) {
                let msg = data.error || 'Error al agregar';
                if (data.conflicto) {
                    msg += `\nPertenece a SKU: ${data.conflicto.sku} - ${data.conflicto.nombre}`;
                }
                alert(msg);
                return;
            }
            this.lista.push(codigo);
            this.render();
            input.value = '';
            input.focus();
        } catch (err) {
            console.error(err);
            alert('Error de red al agregar codigo');
        }
    },

    async eliminar(codigo) {
        if (!confirm(`Eliminar codigo ${codigo}?`)) return;

        // Si no hay producto aun, solo quitar del buffer
        if (!this.idProducto) {
            this.lista = this.lista.filter(c => c !== codigo);
            this.render();
            return;
        }

        try {
            const resp = await fetchAPI(`/productos/${this.idProducto}/codigos-barra/${encodeURIComponent(codigo)}`, {
                method: 'DELETE'
            });
            if (!resp.ok) {
                const data = await resp.json();
                alert(data.error || 'Error al eliminar');
                return;
            }
            this.lista = this.lista.filter(c => c !== codigo);
            this.render();
        } catch (err) {
            console.error(err);
            alert('Error de red al eliminar codigo');
        }
    },

    obtenerBuffer() {
        // Devuelve los codigos del buffer (para enviar al crear producto nuevo)
        return this.lista.slice();
    }
};

// Bind del input y boton al cargar la pagina
document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('btnAgregarCodigo');
    const input = document.getElementById('inputNuevoCodigo');
    if (btn) btn.addEventListener('click', () => CodigosBarra.agregar());
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); CodigosBarra.agregar(); }
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN CON MAPEO DE COLUMNAS (F1.4)
// ════════════════════════════════════════════════════════════════════════════

const EstadoImport = {
    columnas: [], camposERP: [], mapeo: {}, sugerencia: {}, scores: {},
    metaDetectado: {}, archivoModificadoExternamente: false, pasoActual: 1,
    reset() {
        this.columnas = []; this.camposERP = []; this.mapeo = {};
        this.sugerencia = {}; this.scores = {}; this.metaDetectado = {};
        this.archivoModificadoExternamente = false; this.pasoActual = 1;
    }
};

function irAPaso(n) {
    EstadoImport.pasoActual = n;
    ['paso1Import', 'paso2Import', 'paso3Import'].forEach(function(id, i) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('d-none', i + 1 !== n);
    });
    const botones = {
        btnAnalizarArchivo: n === 1, btnVolverPaso1: n === 2,
        btnConfirmarMapeo: n === 2, btnVolverPaso2: n === 3, btnEjecutarImport: n === 3
    };
    for (const [id, mostrar] of Object.entries(botones)) {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('d-none', !mostrar);
    }
    const indicador = document.getElementById('indicadorPasoImport');
    if (indicador) {
        const titulos = ['Seleccionar archivo', 'Mapear columnas', 'Revisar y confirmar'];
        indicador.textContent = '— Paso ' + n + ' de 3: ' + titulos[n - 1];
    }
    if (n === 1) {
        document.getElementById('btnAnalizarArchivo').disabled = !archivoImportSeleccionado;
    }
}

async function ejecutarInspeccion() {
    if (!archivoImportSeleccionado) { alert('Seleccioná un archivo primero'); return; }
    const btn = document.getElementById('btnAnalizarArchivo');
    const txtOrig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Analizando...';
    try {
        const token = localStorage.getItem('authToken');
        const formData = new FormData();
        formData.append('archivo', archivoImportSeleccionado);
        const resp = await fetch(API_URL + '/productos/import/inspeccionar', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            alert('Error al analizar: ' + (data.error || 'desconocido'));
            return;
        }
        EstadoImport.columnas = data.columnas || [];
        EstadoImport.camposERP = data.campos_erp || [];
        EstadoImport.sugerencia = data.sugerencia_mapeo || {};
        EstadoImport.scores = data.sugerencia_scores || {};
        EstadoImport.metaDetectado = data.meta_detectado || {};
        EstadoImport.archivoModificadoExternamente = !!data.archivo_modificado_externamente;
        EstadoImport.mapeo = Object.assign({}, EstadoImport.sugerencia);

        document.getElementById('resumenInspeccion').textContent =
            data.archivo + ' — ' + data.total_filas + ' filas, ' + data.total_columnas + ' columnas (' +
            EstadoImport.columnas.filter(c => !c.esta_vacia).length + ' con datos)';
        const banner = document.getElementById('bannerArchivoModificado');
        banner.classList.toggle('d-none', !EstadoImport.archivoModificadoExternamente);

        renderTablaMapeo();
        irAPaso(2);
    } catch (e) {
        console.error(e); alert('Error de red: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = txtOrig;
    }
}

function renderTablaMapeo() {
    const tbody = document.getElementById('tablaMapeo');
    const mostrarVacias = document.getElementById('chkMostrarVacias').checked;
    const colsVisibles = EstadoImport.columnas.filter(c => mostrarVacias || !c.esta_vacia);

    const grupos = {};
    EstadoImport.camposERP.forEach(c => {
        const g = c.grupo || 'Otros';
        if (!grupos[g]) grupos[g] = [];
        grupos[g].push(c);
    });

    let html = '';
    for (const [grupo, campos] of Object.entries(grupos)) {
        html += '<tr class="table-secondary"><td colspan="4" class="fw-bold small">' + escapeHtml(grupo) + '</td></tr>';
        for (const campo of campos) {
            const obligatorio = campo.obligatorio_para_nuevos ? '<span class="text-danger" title="Obligatorio para crear productos nuevos">★</span> ' : '';
            const letraSel = EstadoImport.mapeo[campo.clave] || '';
            const score = EstadoImport.scores[campo.clave];
            let badgeScore = '<span class="text-muted small">—</span>';
            if (score !== undefined) {
                const cls = score >= 0.9 ? 'bg-success' : score >= 0.75 ? 'bg-warning text-dark' : 'bg-secondary';
                badgeScore = '<span class="badge ' + cls + '">' + score.toFixed(2) + '</span>';
            }
            let preview = '—';
            if (letraSel) {
                const col = EstadoImport.columnas.find(c => c.letra === letraSel);
                if (col && col.sample.length) preview = '<code class="small">' + escapeHtml(String(col.sample[0]).slice(0, 30)) + '</code>';
            }
            let opciones = '<option value="">— Sin asignar —</option>';
            for (const col of colsVisibles) {
                const txt = col.letra + ' — ' + (col.nombre || '(sin nombre)') + (col.esta_vacia ? ' [vacía]' : '');
                opciones += '<option value="' + col.letra + '"' + (col.letra === letraSel ? ' selected' : '') + '>' + escapeHtml(txt) + '</option>';
            }
            html += '<tr>' +
                '<td>' + obligatorio + '<small>' + escapeHtml(campo.label || campo.clave) + '</small></td>' +
                '<td><select class="form-select form-select-sm" data-campo="' + escapeHtml(campo.clave) + '" onchange="onMapeoChange(this)">' + opciones + '</select></td>' +
                '<td class="text-center">' + badgeScore + '</td>' +
                '<td>' + preview + '</td>' +
                '</tr>';
        }
    }
    tbody.innerHTML = html;
    document.getElementById('chkMostrarVacias').onchange = renderTablaMapeo;
}

function onMapeoChange(sel) {
    const campo = sel.dataset.campo;
    const letra = sel.value;
    if (letra) EstadoImport.mapeo[campo] = letra;
    else delete EstadoImport.mapeo[campo];
    const tr = sel.closest('tr');
    const tdPreview = tr.cells[3];
    if (letra) {
        const col = EstadoImport.columnas.find(c => c.letra === letra);
        tdPreview.innerHTML = (col && col.sample.length)
            ? '<code class="small">' + escapeHtml(String(col.sample[0]).slice(0, 30)) + '</code>'
            : '—';
    } else {
        tdPreview.innerHTML = '—';
    }
}

async function ejecutarPreviewConMapeo() {
    if (!EstadoImport.mapeo.SKU) {
        alert('SKU es obligatorio. Asignale una columna del Excel antes de continuar.');
        return;
    }
    if (Object.keys(EstadoImport.mapeo).length === 0) {
        alert('Asigná al menos una columna antes de continuar.');
        return;
    }
    const btn = document.getElementById('btnConfirmarMapeo');
    const txtOrig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Procesando...';
    try {
        const token = localStorage.getItem('authToken');
        const formData = new FormData();
        formData.append('archivo', archivoImportSeleccionado);
        formData.append('mapeo', JSON.stringify(EstadoImport.mapeo));
        const preciosIncluyenIva = document.getElementById('chkPreciosIncluyenIva')?.checked ?? true;
        const porcentajeIva = document.getElementById('selectAlicuotaIva')?.value || '21';
        formData.append('precios_incluyen_iva', preciosIncluyenIva);
        formData.append('porcentaje_iva', porcentajeIva);
        const resp = await fetch(API_URL + '/productos/import/preview', {
            method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: formData
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            alert('Error en preview: ' + (data.error || 'desconocido'));
            return;
        }
        previewImportData = data;
        irAPaso(3);
        mostrarPreview(data);
    } catch (e) {
        console.error(e); alert('Error de red: ' + e.message);
    } finally {
        btn.disabled = false; btn.innerHTML = txtOrig;
    }
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════════════════
// MODULO FAMILIA Y FOTO (web) — guarda ATOMICO
// Listener shown.bs.modal: cada vez que se abre modalProducto, recarga
// ═══════════════════════════════════════════════════════════════════
const FAMILIA_FOTO = (function() {
    let _producto = null;
    let _searchTimer = null;
    let _modalCrearPadre = null;

    function _token() {
        if (typeof token !== 'undefined' && token) return token;
        return localStorage.getItem('token') || '';
    }

    async function _api(path, opts = {}) {
        opts.headers = opts.headers || {};
        opts.headers['Authorization'] = 'Bearer ' + _token();
        if (opts.body && typeof opts.body !== 'string') {
            opts.body = JSON.stringify(opts.body);
            opts.headers['Content-Type'] = 'application/json';
        }
        return fetch(API_URL + path, opts);
    }

    function _renderPreview(url) {
        const img = document.getElementById('imgPreview');
        const ph  = document.getElementById('previewPlaceholder');
        if (!img || !ph) return;
        if (url && url.trim()) {
            img.src = url.trim();
            img.hidden = false;
            ph.classList.add('d-none');
            img.onerror = () => {
                img.hidden = true;
                ph.classList.remove('d-none');
                ph.textContent = '⚠ no se pudo cargar';
            };
        } else {
            img.hidden = true;
            img.src = '';
            ph.classList.remove('d-none');
            ph.textContent = 'sin imagen';
        }
    }

    function _renderPadre(padre) {
        const box = document.getElementById('padreActualBox');
        const txt = document.getElementById('padreActualTexto');
        if (!box || !txt) return;
        if (padre && padre.id_producto) {
            txt.textContent = (padre.sku || '') + ' — ' + (padre.nombre || '');
            box.classList.remove('d-none');
        } else {
            box.classList.add('d-none');
        }
    }

    function _renderHijos(hijos) {
        const box   = document.getElementById('hijosBox');
        const lista = document.getElementById('hijosLista');
        const count = document.getElementById('hijosCount');
        if (!box || !lista || !count) return;
        if (!hijos || hijos.length === 0) {
            box.classList.add('d-none');
            return;
        }
        box.classList.remove('d-none');
        count.textContent = hijos.length;
        lista.innerHTML = hijos.map(h =>
            '<li class="list-group-item d-flex justify-content-between align-items-center py-1 px-2 small">' +
            '  <span><strong>' + escapeHtml(h.sku || '') + '</strong> ' + escapeHtml(h.nombre || '') + '</span>' +
            '  <button type="button" class="btn btn-link btn-sm py-0" onclick="editarProducto(' + h.id_producto + ')">Abrir</button>' +
            '</li>'
        ).join('');
    }

    function _setEnabled(enabled) {
        const ids = ['inputUrlImagen','btnPegarImagen','btnAplicarImagen','btnLimpiarImagen',
                     'inputBuscarPadre','btnCrearPadreInline'];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = !enabled;
        });
        const vacio = document.getElementById('seccionFamiliaVacio');
        if (vacio) vacio.classList.toggle('d-none', enabled);
    }

    async function cargar(producto) {
        _producto = producto;

        const inputUrl    = document.getElementById('inputUrlImagen');
        const inputBuscar = document.getElementById('inputBuscarPadre');
        const banner      = document.getElementById('bannerEsPadre');
        const resultados  = document.getElementById('padresResultados');
        if (!inputUrl) return; // modal no esta en DOM aun

        // Reset campos
        inputUrl.value = '';
        if (inputBuscar) inputBuscar.value = '';
        if (resultados) resultados.innerHTML = '';
        const status = document.getElementById('urlImagenStatus');
        if (status) status.textContent = '';

        if (!producto || !producto.id_producto) {
            _setEnabled(false);
            _renderPreview('');
            _renderPadre(null);
            _renderHijos([]);
            if (banner) banner.classList.add('d-none');
            return;
        }

        _setEnabled(true);
        inputUrl.value = producto.url_imagen || '';
        _renderPreview(producto.url_imagen);

        if (banner) {
            banner.classList.toggle('d-none', !producto.tiene_variantes);
        }

        try {
            const resp = await _api('/productos/' + producto.id_producto + '/familia');
            if (resp.ok) {
                const data = await resp.json();
                _renderPadre(data.padre || data.producto?.padre || null);
                _renderHijos(data.hijos || []);
            } else {
                _renderPadre(null);
                _renderHijos([]);
            }
        } catch (e) {
            console.error('FAMILIA_FOTO cargar:', e);
        }
    }

    async function aplicarFoto() {
        if (!_producto?.id_producto) return;
        const inputUrl = document.getElementById('inputUrlImagen');
        const status   = document.getElementById('urlImagenStatus');
        const url = inputUrl.value.trim();
        try {
            const resp = await _api('/productos/' + _producto.id_producto + '/imagen', {
                method: 'PATCH',
                body: { url_imagen: url || null, motivo: 'Cambio desde modal productos' }
            });
            const data = await resp.json();
            if (!resp.ok) {
                status.className = 'text-danger small';
                status.textContent = '✗ ' + (data.error || resp.status);
                return;
            }
            _producto.url_imagen = data.url_imagen;
            _renderPreview(data.url_imagen);
            status.className = 'text-success small';
            status.textContent = data.vacio ? '✓ Imagen quitada' : '✓ Imagen aplicada';
            setTimeout(() => { status.textContent = ''; }, 2500);
        } catch (e) {
            status.className = 'text-danger small';
            status.textContent = '✗ red: ' + e.message;
        }
    }

    async function _buscar(query) {
        clearTimeout(_searchTimer);
        const cont = document.getElementById('padresResultados');
        if (!cont) return;
        if (!query || query.length < 2) {
            cont.innerHTML = '';
            return;
        }
        _searchTimer = setTimeout(async () => {
            try {
                const excluir = _producto?.id_producto || '';
                const resp = await _api('/productos/padres-elegibles?q=' + encodeURIComponent(query) + '&excluir_id=' + excluir);
                if (!resp.ok) throw new Error('busqueda');
                const items = await resp.json();
                if (!items || items.length === 0) {
                    cont.innerHTML = '<div class="text-muted small p-2">sin resultados</div>';
                    return;
                }
                cont.innerHTML = items.map(p =>
                    '<button type="button" class="list-group-item list-group-item-action py-1 px-2 small" ' +
                    'onclick="FAMILIA_FOTO.asignarPadre(' + p.id_producto + ')">' +
                    '<strong>' + escapeHtml(p.sku || '') + '</strong> ' + escapeHtml(p.nombre || '') +
                    '</button>'
                ).join('');
            } catch (e) {
                cont.innerHTML = '<div class="text-danger small p-2">error en busqueda</div>';
            }
        }, 300);
    }

    async function asignarPadre(id_padre) {
        if (!_producto?.id_producto) return;
        try {
            const resp = await _api('/productos/' + _producto.id_producto + '/padre', {
                method: 'PATCH',
                body: { id_padre: id_padre, motivo: 'Asignacion desde modal' }
            });
            const data = await resp.json();
            if (!resp.ok) {
                alert('Error: ' + (data.error || resp.status));
                return;
            }
            await cargar(_producto);
            const inp = document.getElementById('inputBuscarPadre');
            const res = document.getElementById('padresResultados');
            if (inp) inp.value = '';
            if (res) res.innerHTML = '';
        } catch (e) {
            alert('Error de red: ' + e.message);
        }
    }

    async function quitarPadre() {
        if (!_producto?.id_producto) return;
        if (!confirm('¿Quitar el padre de este producto?')) return;
        try {
            const resp = await _api('/productos/' + _producto.id_producto + '/padre', {
                method: 'PATCH',
                body: { id_padre: null, motivo: 'Quita desde modal' }
            });
            if (!resp.ok) {
                const data = await resp.json();
                alert('Error: ' + (data.error || resp.status));
                return;
            }
            await cargar(_producto);
        } catch (e) {
            alert('Error de red: ' + e.message);
        }
    }

    function abrirCrearPadre() {
        if (!_producto?.id_producto) return;
        const sku    = document.getElementById('crearPadreSku');
        const nombre = document.getElementById('crearPadreNombre');
        const url    = document.getElementById('crearPadreUrlImagen');
        if (sku)    sku.value    = (_producto.sku || '') + '-PADRE';
        if (nombre) nombre.value = '';
        if (url)    url.value    = '';
        if (!_modalCrearPadre) {
            _modalCrearPadre = new bootstrap.Modal(document.getElementById('modalCrearPadre'));
        }
        _modalCrearPadre.show();
        setTimeout(() => sku && sku.focus(), 200);
    }

    async function confirmarCrearPadre() {
        const sku        = document.getElementById('crearPadreSku').value.trim();
        const nombre     = document.getElementById('crearPadreNombre').value.trim() || sku;
        const url_imagen = document.getElementById('crearPadreUrlImagen').value.trim() || null;
        // Fix 2026-05-11 Bloque 5: leer id_categoria del producto contexto (invariante P4)
        // El padre debe compartir categoria con el hijo al que se le asigna.
        const idCatVal = document.getElementById('idCategoria').value;
        const id_categoria = idCatVal ? parseInt(idCatVal, 10) : null;
        if (!sku) { alert('SKU es requerido'); return; }
        if (!id_categoria) {
            alert('El producto que estas editando no tiene categoria asignada. Asigna una categoria primero antes de crear el padre (invariante P4).');
            return;
        }
        try {
            const resp = await _api('/productos/padre', {
                method: 'POST',
                body: { sku, nombre, url_imagen, id_categoria }
            });
            const data = await resp.json();
            if (!resp.ok) {
                alert('Error creando padre: ' + (data.error || resp.status));
                return;
            }
            await asignarPadre(data.id_producto);
            if (_modalCrearPadre) _modalCrearPadre.hide();
        } catch (e) {
            alert('Error de red: ' + e.message);
        }
    }

    // Wire up listeners on DOM ready
    document.addEventListener('DOMContentLoaded', function() {
        const modalEl = document.getElementById('modalProducto');
        if (modalEl) {
            modalEl.addEventListener('shown.bs.modal', function() {
                cargar(typeof Estado !== 'undefined' ? Estado.productoEditando : null);
            });
        }

        const inpUrl = document.getElementById('inputUrlImagen');
        if (inpUrl) {
            inpUrl.addEventListener('input', () => _renderPreview(inpUrl.value.trim()));
            inpUrl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); aplicarFoto(); }
            });
        }
        const btnAplicar = document.getElementById('btnAplicarImagen');
        if (btnAplicar) btnAplicar.addEventListener('click', aplicarFoto);

        const btnPegar = document.getElementById('btnPegarImagen');
        if (btnPegar) btnPegar.addEventListener('click', async () => {
            try {
                const txt = await navigator.clipboard.readText();
                inpUrl.value = txt.trim();
                _renderPreview(inpUrl.value);
            } catch (e) {
                alert('No se pudo leer del portapapeles');
            }
        });

        const btnLimpiar = document.getElementById('btnLimpiarImagen');
        if (btnLimpiar) btnLimpiar.addEventListener('click', () => {
            inpUrl.value = '';
            _renderPreview('');
            aplicarFoto();
        });

        const inpBuscar = document.getElementById('inputBuscarPadre');
        if (inpBuscar) inpBuscar.addEventListener('input', () => _buscar(inpBuscar.value.trim()));

        const btnQuitar = document.getElementById('btnQuitarPadre');
        if (btnQuitar) btnQuitar.addEventListener('click', quitarPadre);

        const btnCrearInline = document.getElementById('btnCrearPadreInline');
        if (btnCrearInline) btnCrearInline.addEventListener('click', abrirCrearPadre);

        const btnConfirmarCrear = document.getElementById('btnConfirmarCrearPadre');
        if (btnConfirmarCrear) btnConfirmarCrear.addEventListener('click', confirmarCrearPadre);
    });

    console.log('[FAMILIA_FOTO] modulo cargado');
    return { cargar, aplicarFoto, asignarPadre, quitarPadre, abrirCrearPadre, confirmarCrearPadre };
})();

// ═══════════════════════════════════════════════════════════════════════════
// CONTADOR DE INACTIVOS — invocado tras cargarProductos (2026-05-21)
// ═══════════════════════════════════════════════════════════════════════════
async function actualizarContadorInactivos() {
    try {
        const r = await fetchAPI('/productos/contador-inactivos');
        if (!r.ok) return;
        const data = await r.json();
        const total = data.total_inactivos || 0;
        const card = document.getElementById('statCardInactivos');
        const lbl  = document.getElementById('statInactivos');
        if (lbl) lbl.textContent = total;
        if (card) card.style.display = total > 0 ? 'flex' : 'none';
    } catch (e) {
        console.warn('Contador inactivos:', e.message);
    }
}

// Click en card de inactivos → activar toggle y recargar
function activarMostrarInactivos() {
    const chk = document.getElementById('chkMostrarInactivos');
    if (chk && !chk.checked) {
        chk.checked = true;
        chk.dispatchEvent(new Event('change'));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TOGGLE ACTIVO EN MODAL DE EDICIÓN (2026-05-21)
// ═══════════════════════════════════════════════════════════════════════════
function configurarToggleActivoModal(producto) {
    const seccion = document.getElementById('seccionEstadoProducto');
    const toggle  = document.getElementById('toggleProductoActivo');
    const motivo  = document.getElementById('motivoEstadoProducto');
    const label   = document.getElementById('lblEstadoProducto');
    if (!seccion || !toggle) return;

    // Solo se muestra al editar (no al crear)
    if (!producto || !producto.id_producto) {
        seccion.style.display = 'none';
        return;
    }
    seccion.style.display = 'block';

    const estadoOriginal = producto.activo !== false;
    toggle.checked = estadoOriginal;
    if (motivo) { motivo.value = ''; motivo.style.display = 'none'; }
    if (label)  { label.textContent = estadoOriginal ? 'Producto activo' : 'Producto inactivo'; }

    // Quitar listeners previos para no acumular
    const nuevo = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(nuevo, toggle);
    nuevo.checked = estadoOriginal;

    nuevo.addEventListener('change', async function(e) {
        const nuevoEstado = e.target.checked;
        if (label) label.textContent = nuevoEstado ? 'Producto activo' : 'Producto inactivo';
        if (motivo) motivo.style.display = 'inline-block';

        const txtMotivo = motivo ? motivo.value.trim() : '';
        const confirmar = confirm(`¿${nuevoEstado ? 'Activar' : 'Desactivar'} este producto?\n\n` +
            (nuevoEstado ? 'Volverá a aparecer en el listado y se podrá vender.' : 'Dejará de aparecer en el listado por default. Es reversible.'));
        if (!confirmar) {
            e.target.checked = !nuevoEstado;
            if (label) label.textContent = !nuevoEstado ? 'Producto activo' : 'Producto inactivo';
            return;
        }

        try {
            const resp = await fetchAPI(`/productos/${producto.id_producto}/estado`, {
                method: 'PATCH',
                body: JSON.stringify({ activo: nuevoEstado, motivo: txtMotivo || null })
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Error');
            alert(`✓ ${data.message}`);
            if (Estado.productoEditando) Estado.productoEditando.activo = nuevoEstado;
            actualizarContadorInactivos();
        } catch (err) {
            alert('✗ ' + err.message);
            e.target.checked = !nuevoEstado;
            if (label) label.textContent = !nuevoEstado ? 'Producto activo' : 'Producto inactivo';
        }
    });
}
window.actualizarContadorInactivos = actualizarContadorInactivos;
window.activarMostrarInactivos = activarMostrarInactivos;
window.configurarToggleActivoModal = configurarToggleActivoModal;


// ============================================================
// MasivoMgr — single source para operaciones masivas (F3, D-06)
// Reemplaza al ex endpoint /productos/ids-filtrados.
// Lee SIEMPRE de Estado.productosFiltrados (lista local post-filtro).
// ============================================================
const MasivoMgr = (() => {
    function getIds() {
        return Array.isArray(Estado.productosFiltrados)
            ? Estado.productosFiltrados.map(p => p.id_producto)
            : [];
    }
    function getCount() {
        return getIds().length;
    }
    function getFiltrosAplicados() {
        return { ...Estado.filtros };
    }
    return { getIds, getCount, getFiltrosAplicados };
})();


// ═══════════════════════════════════════════════════════════════
// PAQUETE / RECETA (BOM) — modulo autocontenido
// ═══════════════════════════════════════════════════════════════
const BOM_RECETA = (function () {
    const API = window.CONFIG?.API_BASE_URL || '/api';
    const TK = window.CONFIG?.TOKEN_KEY || 'authToken';
    let _id = null, _filas = [], _timer = null;
    let _pendiente = null;

    function _hdr() { return { 'Authorization': 'Bearer ' + (localStorage.getItem(TK) || ''), 'Content-Type': 'application/json' }; }
    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    function _asArr(x) { if (Array.isArray(x)) return x; if (x && typeof x === 'object') { for (const k of Object.keys(x)) { if (Array.isArray(x[k])) return x[k]; } } return []; }

    function _render() {
        const tb = document.getElementById('recetaFilas');
        if (!tb) return;
        tb.innerHTML = _filas.length ? _filas.map((f, i) =>
            '<tr><td><strong>' + _esc(f.sku) + '</strong> <span class="text-muted small">' + _esc(f.nombre) + '</span></td>' +
            '<td><input type="number" step="0.0001" min="0.0001" class="form-control form-control-sm" value="' + f.cantidad + '" onchange="BOM_RECETA.setCant(' + i + ', this.value)"></td>' +
            '<td><button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="BOM_RECETA.quitar(' + i + ')">✕</button></td></tr>'
        ).join('') : '<tr><td colspan="3" class="text-muted small">Sin componentes — producto simple (descuenta su propio stock).</td></tr>';
        const badge = document.getElementById('recetaBadge');
        if (badge) {
            badge.classList.toggle('d-none', _filas.length === 0);
            badge.textContent = 'PAQUETE · ' + _filas.length + ' comp.';
            badge.className = 'badge ' + (_filas.length ? 'bg-warning text-dark' : 'bg-secondary d-none');
        }
    }

    async function cargar(id_producto) {
        _id = id_producto || null; _filas = [];
        const vacio = document.getElementById('recetaVacio'), cuerpo = document.getElementById('recetaCuerpo');
        if (!vacio || !cuerpo) return;
        vacio.classList.toggle('d-none', !!_id);
        cuerpo.style.display = _id ? '' : 'none';
        const st = document.getElementById('recetaStatus'); if (st) st.textContent = '';
        const bq = document.getElementById('recetaBuscar'); if (bq) bq.value = '';
        const rr = document.getElementById('recetaResultados'); if (rr) rr.innerHTML = '';
        if (!_id) { _render(); return; }
        try {
            const r = await fetch(API + '/productos/' + _id + '/componentes', { headers: _hdr() });
            const data = await r.json();
            _filas = (data.data || []).map(c => ({ id: c.id_producto_componente, sku: c.sku, nombre: c.nombre, cantidad: parseFloat(c.cantidad) }));
        } catch (e) { console.error('BOM cargar:', e); }
        _render();
    }

    function buscar(q) {
        clearTimeout(_timer);
        const cont = document.getElementById('recetaResultados');
        if (!q || q.trim().length < 2) { cont.innerHTML = ''; return; }
        _timer = setTimeout(async () => {
            try {
                const r = await fetch(API + '/productos/buscar?q=' + encodeURIComponent(q.trim()), { headers: _hdr() });
                const items = _asArr(await r.json()).slice(0, 10);
                cont.innerHTML = items.length ? items.map(p =>
                    '<button type="button" class="list-group-item list-group-item-action py-1 px-2 small" onclick="BOM_RECETA.agregar(' + p.id_producto + ', \'' + _esc(p.sku).replace(/'/g, '') + '\', \'' + _esc(p.nombre).replace(/'/g, ' ') + '\')">' +
                    '<strong>' + _esc(p.sku) + '</strong> ' + _esc(p.nombre) + '</button>').join('')
                    : '<div class="text-muted small p-2">sin resultados</div>';
            } catch (e) { cont.innerHTML = '<div class="text-danger small p-2">error</div>'; }
        }, 300);
    }

    function agregar(id, sku, nombre) {
        document.getElementById('recetaResultados').innerHTML = '';
        document.getElementById('recetaBuscar').value = '';
        if (id === _id) { _status('Un paquete no puede contenerse a sí mismo', false); return; }
        if (_filas.some(f => f.id === id)) { _status('Ya está en la receta', false); return; }
        _filas.push({ id, sku, nombre, cantidad: 1 });
        _render();
    }
    function quitar(i) { _filas.splice(i, 1); _render(); }
    function setCant(i, v) { _filas[i].cantidad = parseFloat(v) || 0; }

    function _status(msg, ok) {
        const st = document.getElementById('recetaStatus');
        st.className = ok ? 'text-success small ms-2' : 'text-danger small ms-2';
        st.textContent = (ok ? '✓ ' : '✗ ') + msg;
        if (ok) setTimeout(() => { st.textContent = ''; }, 3000);
    }

    async function guardar() {
        if (!_id) return;
        for (const f of _filas) { if (!f.cantidad || f.cantidad <= 0) { _status('Cantidad inválida en ' + f.sku, false); return; } }
        try {
            const r = await fetch(API + '/productos/' + _id + '/componentes', {
                method: 'PUT', headers: _hdr(),
                body: JSON.stringify({ componentes: _filas.map(f => ({ id_producto_componente: f.id, cantidad: f.cantidad })) })
            });
            const data = await r.json();
            if (!r.ok) { _status(data.error || 'Error al guardar', false); return; }
            _status('Receta guardada (' + _filas.length + ' componentes)', true);
            _render();
        } catch (e) { _status(e.message, false); }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const bq = document.getElementById('recetaBuscar');
        if (bq) bq.addEventListener('input', () => buscar(bq.value));
        const bg = document.getElementById('btnGuardarReceta');
        if (bg) bg.addEventListener('click', guardar);
    });
    document.addEventListener('shown.bs.modal', (e) => {
        if (e.target.querySelector && e.target.querySelector('#seccionReceta')) {
            cargar(_pendiente); _pendiente = null;
        }
    });

    return { cargar, agregar, quitar, setCant, guardar,
             marcarPendiente: (id) => { _pendiente = id; } };
})();

// Hook no invasivo: al abrir edicion, encolar la carga de receta
if (typeof editarProducto === 'function') {
    const _editarProductoOrigBOM = editarProducto;
    editarProducto = async function (id_producto) {
        BOM_RECETA.marcarPendiente(id_producto);
        return _editarProductoOrigBOM(id_producto);
    };
}
