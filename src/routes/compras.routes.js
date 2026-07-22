/**
 * COMPRAS ROUTES — ERP LAGO v2.0
 * Rutas estáticas ANTES que dinámicas /:id
 */
const router = require('express').Router();
const { verificarToken } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/compras.controller');

// Auth global
router.use(verificarToken);

// ── Datos formularios ──
router.get('/form-data',                    ctrl.getFormData);

// ── Búsquedas ──
router.get('/proveedores/buscar',           ctrl.buscarProveedores);
router.get('/buscar-cuit/:cuit',            ctrl.buscarCuit);
router.post('/proveedores/alta-rapida',     ctrl.altaRapidaProveedor);
router.get('/proveedores/:id',              ctrl.getProveedor);
router.get('/productos/buscar',             ctrl.buscarProductos);

// ── OC / Recepciones ──

// ── Historial / Cheques ──
router.get('/historial-precios/:id_producto', ctrl.getHistorialPrecios);
router.get('/cheques-cartera',              ctrl.getChequesCartera);

// ── Cálculo server-side (sin persistir) ──
router.post('/calcular-totales',            ctrl.calcularTotales);

// ── Validación número + sugerencia ──
router.get('/validar-numero',               ctrl.validarNumero);
router.get('/sugerir-numero',               ctrl.sugerirNumero);

// ── Excel + Historial ──
router.get("/export/excel",                  ctrl.exportarExcel);
router.get("/import/plantilla",              ctrl.descargarPlantilla);
router.post("/import/preview",  ctrl.uploadExcel, ctrl.previewImport);
router.get("/historial-compras-producto/:id_producto", ctrl.historialComprasProducto);
// ── CRUD comprobantes (estáticas ANTES de /:id) ──
// ── Impresión (datos + log) ──
router.get('/print/orden-pago/:id',   ctrl.getDatosOrdenPago);
router.post('/print/log',              ctrl.logImpresion);

router.get('/',                             ctrl.listarComprobantes);
router.post('/',                            ctrl.guardarComprobante);
router.get('/:id',                          ctrl.getComprobante);
router.put('/:id/anular',                   ctrl.anularComprobante);

module.exports = router;
