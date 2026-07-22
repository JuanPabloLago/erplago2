/**
 * INVENTARIO IMPORT - ERP LAGO
 * 
 * Módulo de importación/exportación de stock por Excel.
 * Se integra con el sistema de comprobantes de ajustes_inventario.
 * 
 * Flujo en 3 pasos:
 *   Paso 1: Seleccionar depósito + filtros opcionales → Descargar plantilla
 *   Paso 2: Subir Excel completado → Preview con diff
 *   Paso 3: Confirmar → Crear comprobante (borrador o aplicar directo)
 * 
 * Dependencias: Bootstrap 5, bootstrap-icons
 * Se carga después del script inline de inventario.html
 */

(function() {
    'use strict';

    // ========================================================================
    // CONFIG
    // ========================================================================
    const token = localStorage.getItem('authToken');
    const API_URL = (window.CONFIG?.API_BASE_URL || '/api') + '/inventario';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // ========================================================================
    // ESTADO DEL MÓDULO
    // ========================================================================
    const ImportState = {
        paso: 1,
        depositos: [],
        depositoSeleccionado: null,
        archivoSeleccionado: null,
        previewData: null,         // Respuesta del backend /import/preview
        categorias: [],
        marcas: []
    };

    // ========================================================================
    // ELEMENTOS DOM
    // ========================================================================
    let modal = null;
    let els = {};

    function cachearElementos() {
        els = {
            modal: document.getElementById('modalImportExcel'),
            // Pasos
            paso1: document.getElementById('importPaso1'),
            paso2: document.getElementById('importPaso2'),
            paso3: document.getElementById('importPaso3'),
            // Indicadores de paso
            stepIndicators: document.querySelectorAll('.import-step'),
            // Paso 1
            selectDeposito: document.getElementById('importDeposito'),
            selectCategoria: document.getElementById('importCategoria'),
            selectMarca: document.getElementById('importMarca'),
            btnDescargarPlantilla: document.getElementById('btnDescargarPlantilla'),
            btnIrPaso2: document.getElementById('btnIrPaso2'),
            // Paso 2
            inputArchivo: document.getElementById('importArchivo'),
            dropZone: document.getElementById('importDropZone'),
            archivoInfo: document.getElementById('importArchivoInfo'),
            archivoNombre: document.getElementById('importArchivoNombre'),
            btnQuitarArchivo: document.getElementById('btnQuitarArchivo'),
            btnProcesar: document.getElementById('btnProcesar'),
            btnVolverPaso1: document.getElementById('btnVolverPaso1'),
            // Paso 3
            previewResumen: document.getElementById('importPreviewResumen'),
            previewTabla: document.getElementById('importPreviewTabla'),
            previewTablaBody: document.getElementById('importPreviewBody'),
            previewNoEncontrados: document.getElementById('importNoEncontrados'),
            previewErrores: document.getElementById('importErrores'),
            selectAccion: document.getElementById('importAccion'),
            inputMotivo: document.getElementById('importMotivo'),
            btnEjecutar: document.getElementById('btnEjecutarImport'),
            btnVolverPaso2: document.getElementById('btnVolverPaso2'),
        };
    }

    // ========================================================================
    // INICIALIZACIÓN
    // ========================================================================
    function init() {
        const btnAbrir = document.getElementById('btnImportExcel');
        if (!btnAbrir) return;

        btnAbrir.addEventListener('click', abrirModal);
    }

    async function abrirModal() {
        cachearElementos();
        modal = new bootstrap.Modal(els.modal);

        // Reset
        ImportState.paso = 1;
        ImportState.archivoSeleccionado = null;
        ImportState.previewData = null;

        await cargarDatosIniciales();
        mostrarPaso(1);
        configurarEventos();

        modal.show();
    }

    async function cargarDatosIniciales() {
        try {
            // Cargar depósitos
            const depResp = await fetch(`${API_URL}/import/depositos`, { headers });
            if (depResp.ok) {
                ImportState.depositos = await depResp.json();
                renderizarDepositos();
            }

            // Cargar categorías y marcas (reutilizar si ya están)
            const [catResp, marcResp] = await Promise.all([
                fetch((window.CONFIG?.API_BASE_URL || '/api') + '/categorias', { headers }),
                fetch((window.CONFIG?.API_BASE_URL || '/api') + '/marcas', { headers })
            ]);

            if (catResp.ok) {
                ImportState.categorias = await catResp.json();
                els.selectCategoria.innerHTML = '<option value="">Todas las categorías</option>' +
                    ImportState.categorias.map(c => 
                        `<option value="${c.id_categoria}">${c.nombre}</option>`
                    ).join('');
            }

            if (marcResp.ok) {
                ImportState.marcas = await marcResp.json();
                els.selectMarca.innerHTML = '<option value="">Todas las marcas</option>' +
                    ImportState.marcas.map(m => 
                        `<option value="${m.id_marca}">${m.nombre}</option>`
                    ).join('');
            }

        } catch (error) {
            console.error('Error cargando datos iniciales:', error);
        }
    }

    function renderizarDepositos() {
        els.selectDeposito.innerHTML = '<option value="">Seleccione un depósito...</option>' +
            ImportState.depositos.map(d => 
                `<option value="${d.id_deposito}" ${d.es_principal ? 'selected' : ''}>
                    ${d.nombre} ${d.codigo ? '(' + d.codigo + ')' : ''} ${d.es_principal ? '★' : ''}
                </option>`
            ).join('');

        // Si hay uno principal, seleccionarlo
        const principal = ImportState.depositos.find(d => d.es_principal);
        if (principal) {
            els.selectDeposito.value = principal.id_deposito;
            ImportState.depositoSeleccionado = principal.id_deposito;
        }

        actualizarBotonesPaso1();
    }

    // ========================================================================
    // NAVEGACIÓN DE PASOS
    // ========================================================================
    function mostrarPaso(numero) {
        ImportState.paso = numero;

        // Ocultar todos los pasos
        [els.paso1, els.paso2, els.paso3].forEach(p => {
            if (p) p.style.display = 'none';
        });

        // Mostrar el paso actual
        const pasoActual = [els.paso1, els.paso2, els.paso3][numero - 1];
        if (pasoActual) pasoActual.style.display = 'block';

        // Actualizar indicadores
        els.stepIndicators.forEach((ind, idx) => {
            ind.classList.remove('active', 'completed');
            if (idx + 1 < numero) ind.classList.add('completed');
            if (idx + 1 === numero) ind.classList.add('active');
        });
    }

    // ========================================================================
    // EVENTOS
    // ========================================================================
    function configurarEventos() {
        // Paso 1: Selección de depósito
        els.selectDeposito.addEventListener('change', () => {
            ImportState.depositoSeleccionado = els.selectDeposito.value;
            actualizarBotonesPaso1();
        });

        // Paso 1: Descargar plantilla
        els.btnDescargarPlantilla.addEventListener('click', descargarPlantilla);

        // Paso 1: Ir al paso 2
        els.btnIrPaso2.addEventListener('click', () => {
            if (!ImportState.depositoSeleccionado) {
                alert('Seleccione un depósito');
                return;
            }
            mostrarPaso(2);
            resetPaso2();
        });

        // Paso 2: Drag & drop
        els.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            els.dropZone.classList.add('drag-over');
        });
        els.dropZone.addEventListener('dragleave', () => {
            els.dropZone.classList.remove('drag-over');
        });
        els.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            els.dropZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) seleccionarArchivo(files[0]);
        });

        // Paso 2: Click para seleccionar archivo
        els.dropZone.addEventListener('click', () => {
            els.inputArchivo.click();
        });
        els.inputArchivo.addEventListener('change', (e) => {
            if (e.target.files.length > 0) seleccionarArchivo(e.target.files[0]);
        });

        // Paso 2: Quitar archivo
        els.btnQuitarArchivo.addEventListener('click', () => {
            ImportState.archivoSeleccionado = null;
            els.inputArchivo.value = '';
            els.archivoInfo.style.display = 'none';
            els.dropZone.style.display = '';
            els.btnProcesar.disabled = true;
        });

        // Paso 2: Procesar
        els.btnProcesar.addEventListener('click', procesarArchivo);

        // Paso 2: Volver
        els.btnVolverPaso1.addEventListener('click', () => mostrarPaso(1));

        // Paso 3: Ejecutar
        els.btnEjecutar.addEventListener('click', ejecutarImportacion);

        // Paso 3: Volver
        els.btnVolverPaso2.addEventListener('click', () => mostrarPaso(2));
    }

    function actualizarBotonesPaso1() {
        const tieneDeposito = !!ImportState.depositoSeleccionado;
        els.btnDescargarPlantilla.disabled = !tieneDeposito;
        els.btnIrPaso2.disabled = !tieneDeposito;
    }

    // ========================================================================
    // PASO 1: DESCARGAR PLANTILLA
    // ========================================================================
    async function descargarPlantilla() {
        const id_deposito = ImportState.depositoSeleccionado;
        if (!id_deposito) return;

        const id_categoria = els.selectCategoria.value;
        const id_marca = els.selectMarca.value;

        const params = new URLSearchParams({ id_deposito });
        if (id_categoria) params.append('id_categoria', id_categoria);
        if (id_marca) params.append('id_marca', id_marca);

        els.btnDescargarPlantilla.disabled = true;
        els.btnDescargarPlantilla.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Generando...';

        try {
            const response = await fetch(`${API_URL}/import/plantilla?${params}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Error al descargar');
            }

            // Descargar archivo
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = response.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] || 'plantilla_stock.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

        } catch (error) {
            console.error('Error:', error);
            alert('Error al descargar plantilla: ' + error.message);
        } finally {
            els.btnDescargarPlantilla.disabled = false;
            els.btnDescargarPlantilla.innerHTML = '<i class="bi bi-download"></i> Descargar Plantilla';
        }
    }

    // ========================================================================
    // PASO 2: UPLOAD Y PREVIEW
    // ========================================================================
    function resetPaso2() {
        ImportState.archivoSeleccionado = null;
        els.inputArchivo.value = '';
        els.archivoInfo.style.display = 'none';
        els.dropZone.style.display = '';
        els.btnProcesar.disabled = true;
    }

    function seleccionarArchivo(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls'].includes(ext)) {
            alert('Solo se permiten archivos Excel (.xlsx, .xls)');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            alert('El archivo no puede superar los 10MB');
            return;
        }

        ImportState.archivoSeleccionado = file;

        // Mostrar info del archivo
        els.archivoNombre.textContent = `${file.name} (${formatearBytes(file.size)})`;
        els.archivoInfo.style.display = 'flex';
        els.dropZone.style.display = 'none';
        els.btnProcesar.disabled = false;
    }

    async function procesarArchivo() {
        if (!ImportState.archivoSeleccionado) return;

        els.btnProcesar.disabled = true;
        els.btnProcesar.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Procesando...';

        try {
            const formData = new FormData();
            formData.append('archivo', ImportState.archivoSeleccionado);
            formData.append('id_deposito', ImportState.depositoSeleccionado);

            const response = await fetch(`${API_URL}/import/preview`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Error al procesar');
            }

            ImportState.previewData = await response.json();
            renderizarPreview();
            mostrarPaso(3);

        } catch (error) {
            console.error('Error:', error);
            alert('Error al procesar archivo: ' + error.message);
        } finally {
            els.btnProcesar.disabled = false;
            els.btnProcesar.innerHTML = '<i class="bi bi-arrow-right"></i> Procesar y Ver Cambios';
        }
    }

    // ========================================================================
    // PASO 3: PREVIEW Y EJECUCIÓN
    // ========================================================================
    function renderizarPreview() {
        const data = ImportState.previewData;
        if (!data) return;

        const r = data.resumen;

        // Resumen
        els.previewResumen.innerHTML = `
            <div class="row g-3 mb-3">
                <div class="col-md-3">
                    <div class="card border-primary h-100">
                        <div class="card-body text-center py-2">
                            <div class="fs-3 fw-bold text-primary">${r.matcheados}</div>
                            <small class="text-muted">Productos encontrados</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-warning h-100">
                        <div class="card-body text-center py-2">
                            <div class="fs-3 fw-bold text-warning">${r.con_cambios}</div>
                            <small class="text-muted">Con diferencias</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-success h-100">
                        <div class="card-body text-center py-2">
                            <div class="fs-3 fw-bold text-success">+${r.total_entradas}</div>
                            <small class="text-muted">Entradas totales</small>
                        </div>
                    </div>
                </div>
                <div class="col-md-3">
                    <div class="card border-danger h-100">
                        <div class="card-body text-center py-2">
                            <div class="fs-3 fw-bold text-danger">-${r.total_salidas}</div>
                            <small class="text-muted">Salidas totales</small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="text-muted small mb-2">
                <i class="bi bi-building"></i> Depósito: <strong>${r.deposito}</strong> | 
                Filas procesadas: ${r.total_filas_procesadas} | 
                Sin cambios: ${data.sin_cambios}
            </div>
        `;

        // Tabla de items con cambios
        if (data.items && data.items.length > 0) {
            els.previewTabla.style.display = '';
            const maxRows = 200;
            const itemsMostrados = data.items.slice(0, maxRows);

            els.previewTablaBody.innerHTML = itemsMostrados.map(item => {
                const diffClass = item.diferencia > 0 ? 'table-success' : 'table-danger';
                const diffSign = item.diferencia > 0 ? '+' : '';
                return `
                    <tr class="${diffClass}">
                        <td><code>${item.sku || '-'}</code></td>
                        <td>${item.nombre}</td>
                        <td class="text-center">${item.stock_actual}</td>
                        <td class="text-center fw-bold">${item.stock_nuevo}</td>
                        <td class="text-center">
                            <span class="badge ${item.diferencia > 0 ? 'bg-success' : 'bg-danger'}">
                                ${diffSign}${item.diferencia}
                            </span>
                        </td>
                    </tr>`;
            }).join('');

            if (data.items.length > maxRows) {
                els.previewTablaBody.innerHTML += `
                    <tr>
                        <td colspan="5" class="text-center text-muted py-2">
                            ... y ${data.items.length - maxRows} productos más
                        </td>
                    </tr>`;
            }
        } else {
            els.previewTabla.style.display = 'none';
        }

        // No encontrados
        if (data.no_encontrados && data.no_encontrados.length > 0) {
            els.previewNoEncontrados.style.display = '';
            els.previewNoEncontrados.innerHTML = `
                <div class="alert alert-warning mb-3">
                    <strong><i class="bi bi-exclamation-triangle"></i> ${data.no_encontrados.length} producto(s) no encontrados</strong>
                    <small class="d-block mt-1">No se encontraron por SKU ni código de barras:</small>
                    <ul class="mb-0 mt-2 small" style="max-height: 150px; overflow-y: auto;">
                        ${data.no_encontrados.map(nf => 
                            `<li>Fila ${nf.fila}: SKU <code>${nf.sku || '-'}</code> | Barcode <code>${nf.codigo_barras || '-'}</code></li>`
                        ).join('')}
                    </ul>
                </div>`;
        } else {
            els.previewNoEncontrados.style.display = 'none';
        }

        // Errores
        if (data.errores && data.errores.length > 0) {
            els.previewErrores.style.display = '';
            els.previewErrores.innerHTML = `
                <div class="alert alert-danger mb-3">
                    <strong><i class="bi bi-x-circle"></i> ${data.errores.length} error(es) en datos</strong>
                    <ul class="mb-0 mt-2 small">
                        ${data.errores.map(err => 
                            `<li>Fila ${err.fila}: ${err.error}</li>`
                        ).join('')}
                    </ul>
                </div>`;
        } else {
            els.previewErrores.style.display = 'none';
        }

        // Habilitar/deshabilitar botón ejecutar
        els.btnEjecutar.disabled = !data.items || data.items.length === 0;
    }

    async function ejecutarImportacion() {
        const data = ImportState.previewData;
        if (!data || !data.items || data.items.length === 0) return;

        const aplicar = els.selectAccion.value === 'aplicar';
        const motivo = els.inputMotivo.value.trim();

        const accionTexto = aplicar ? 'aplicar los cambios de stock' : 'crear el ajuste en borrador';
        if (!confirm(`¿Desea ${accionTexto} para ${data.items.length} productos?`)) {
            return;
        }

        els.btnEjecutar.disabled = true;
        els.btnEjecutar.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Ejecutando...';

        try {
            const response = await fetch(`${API_URL}/import/ejecutar`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    id_deposito: parseInt(ImportState.depositoSeleccionado),
                    items: data.items.map(item => ({
                        id_producto: item.id_producto,
                        stock_nuevo: item.stock_nuevo
                    })),
                    motivo: motivo || 'Importación de stock desde Excel',
                    aplicar
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Error al ejecutar');
            }

            const resultado = await response.json();

            // Cerrar modal
            modal.hide();

            // Notificación
            const msgExtra = resultado.errores_items?.length 
                ? `\n\n⚠️ ${resultado.errores_items.length} item(s) con error` 
                : '';
            alert(`✅ ${resultado.message}${msgExtra}\n\nComprobante: ${resultado.ajuste.numero_completo}`);

            // Recargar inventario (llamar a la función global del inline script)
            if (typeof window.recargarInventario === 'function') {
                window.recargarInventario();
            } else {
                location.reload();
            }

        } catch (error) {
            console.error('Error:', error);
            alert('Error al ejecutar importación: ' + error.message);
        } finally {
            els.btnEjecutar.disabled = false;
            els.btnEjecutar.innerHTML = '<i class="bi bi-check-circle"></i> Ejecutar Importación';
        }
    }

    // ========================================================================
    // UTILIDADES
    // ========================================================================
    function formatearBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    // ========================================================================
    // AUTO-INIT
    // ========================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
