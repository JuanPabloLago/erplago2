const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productos.controller');
const productosImportController = require('../controllers/productos-import.controller');
const codigosBarraController = require('../controllers/codigos-barra.controller');
const { verificarToken } = require('../middleware/auth.middleware');
const multer = require('multer');
const pool = require('../config/database');

// Lee max_file_size_mb desde configuraciones_empresa al boot.
// Si la config no existe o falla, usa 50 MB. Cambios requieren pm2 reload.
let MAX_FILE_SIZE_MB = 50;
(async () => {
    try {
        const { rows } = await pool.query(
            "SELECT valor FROM configuraciones_empresa WHERE clave = 'productos.import.max_file_size_mb' ORDER BY id_empresa LIMIT 1"
        );
        if (rows[0]?.valor) {
            const mb = parseInt(rows[0].valor);
            if (!isNaN(mb) && mb > 0 && mb <= 500) MAX_FILE_SIZE_MB = mb;
        }
        console.log(`[productos.routes] Limite import Excel: ${MAX_FILE_SIZE_MB} MB`);
    } catch (e) {
        console.error('[productos.routes] No se pudo leer max_file_size_mb, usando default 50MB:', e.message);
    }
})();

// Configurar multer para archivos en memoria
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = file.originalname.toLowerCase();
        if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'));
        }
    }
});
// ========================================================================
// DATOS PARA FORMULARIOS Y FILTROS
// ========================================================================

// Datos para formularios (categorías, marcas, listas, IVA)
  router.get('/form-data', verificarToken, productosController.obtenerDatosFormulario);

// Obtener precios de productos para una lista específica
router.post("/precios-lista", verificarToken, productosController.obtenerPreciosLista);

// Proveedores con productos asociados (para filtro)
router.get('/proveedores', verificarToken, productosController.listarProveedoresConProductos);

// Conjuntos activos (para filtro)
router.get('/conjuntos', verificarToken, productosController.listarConjuntosActivos);

// ========================================================================
// BÚSQUEDA Y LISTADO
// ========================================================================

// Búsqueda inteligente (autocompletado) - busca en SKU, nombre, marca, proveedor
router.get('/buscar', verificarToken, productosController.buscar);

// Listar productos con filtros avanzados y paginación
router.get('/listar', verificarToken, productosController.listar);

// Obtener IDs de productos según filtros actuales (para operaciones masivas)

// ========================================================================
// OPERACIONES MASIVAS
// ========================================================================

// Ajuste de precios porcentual masivo
router.post('/masivo/ajuste-precios', verificarToken, productosController.ajustePrecioMasivo);

// Activar/Desactivar productos masivamente
router.post('/masivo/cambiar-estado', verificarToken, productosController.cambiarEstadoMasivo);
router.post('/masivo/cambiar-web', verificarToken, productosController.cambiarWebMasivo);

// Exportar datos para Excel (devuelve JSON formateado)
router.post('/exportar/excel', verificarToken, productosController.exportarParaExcel);

// ========================================================================
// CODIGOS DE BARRA (antes de /:id para que no sean capturadas por esa ruta)
// ========================================================================
router.get('/codigos-barra/buscar/:codigo', verificarToken, codigosBarraController.buscarPorCodigo);
router.get('/:id/codigos-barra', verificarToken, codigosBarraController.listar);
router.post('/:id/codigos-barra', verificarToken, codigosBarraController.agregar);
router.delete('/:id/codigos-barra/:codigo', verificarToken, codigosBarraController.eliminar);

// ========================================================================
// CRUD INDIVIDUAL
// ========================================================================
router.get("/archivos-origen", verificarToken, productosImportController.listarArchivosOrigen);
router.get("/exportar-por-archivo/:archivo_origen", verificarToken, productosImportController.exportarPorArchivo);

// Obtener producto por ID
// ========================================================================
// FAMILIA (padre/hijo para vista web agrupada)
// IMPORTANTE: rutas estaticas ANTES de /:id, sino matchea como :id="padres-elegibles"
// ========================================================================
router.get('/padres-elegibles', verificarToken, productosController.buscarPadresElegibles);
router.post('/padre', verificarToken, productosController.crearProductoPadre);
router.get('/:id/familia', verificarToken, productosController.obtenerFamilia);
router.get('/:id/componentes', verificarToken, productosController.obtenerComponentesProducto);
router.put('/:id/componentes', verificarToken, productosController.guardarComponentesProducto);
router.patch('/:id/padre', verificarToken, productosController.asignarProductoPadre);
router.patch('/:id/imagen', verificarToken, productosController.actualizarImagen);

// contador-inactivos ANTES de /:id, sino /:id la captura como id y da 400
router.get('/contador-inactivos', verificarToken, productosController.contadorInactivos);
router.get('/:id', verificarToken, productosController.obtenerPorId);

// Historial de precios de un producto
router.get('/:id/historial-precios', verificarToken, productosController.historialPrecios);

// Historial de movimientos de stock
router.get('/:id/historial-stock', verificarToken, productosController.historialStock);

// Ajustar stock manualmente (individual)
router.put('/:id/stock', verificarToken, productosController.ajustarStock);

// Crear producto
router.post('/', verificarToken, productosController.crear);

// Actualizar producto
router.put('/:id', verificarToken, productosController.actualizar);

// Eliminar producto (soft delete)
// Eliminar producto (soft delete)
router.delete('/:id', verificarToken, productosController.eliminar);

// ========================================================================
// IMPORTACIÓN / EXPORTACIÓN PLANTILLA
// ========================================================================

// Descargar plantilla Excel para importación
router.get('/import/plantilla', verificarToken, productosImportController.exportarPlantilla);

// Importar productos desde Excel
// Preview de importación (analiza sin ejecutar)
router.post('/import/inspeccionar', verificarToken, upload.single('archivo'), productosImportController.inspeccionar);
router.post('/import/preview', verificarToken, upload.single('archivo'), productosImportController.previewImportacion);

router.post('/export/reimportable', verificarToken, productosImportController.exportarFiltrados);
router.post('/import/excel', verificarToken, upload.single('archivo'), productosImportController.importarProductos);


// Cargador de imágenes
router.post('/analizar-imagenes', verificarToken, productosController.analizarImagenes);
router.post('/aplicar-imagenes', verificarToken, productosController.aplicarImagenes);


// Middleware de error para multer — convierte códigos crípticos en mensajes claros
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: `El archivo supera el tamaño máximo permitido (${MAX_FILE_SIZE_MB} MB). ` +
                       `Reducí el archivo o pedí al administrador que aumente el límite en Configuraciones.`,
                codigo: 'FILE_TOO_LARGE',
                limite_mb: MAX_FILE_SIZE_MB
            });
        }
        return res.status(400).json({ error: `Error al subir archivo: ${err.message}`, codigo: err.code });
    }
    if (err && err.message && err.message.includes('Excel')) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});


// ═══════════════════════════════════════════════════════════════════════════
// ESTADO PRODUCTO — individual con trazabilidad
// ═══════════════════════════════════════════════════════════════════════════
router.patch('/:id/estado', verificarToken, productosController.cambiarEstadoProducto);

module.exports = router;
