/**
 * ROUTES: Pagos a Proveedores v1.0
 * ERP LAGO
 */

const express = require('express');
const router = express.Router();
const pagosProveedoresController = require('../controllers/pagos-proveedores.controller');
const { verificarToken } = require('../middleware/auth.middleware');

// Todas las rutas requieren autenticación
router.use(verificarToken);

// ═══════════════════════════════════════════════════════════════════════════════
// DATOS PARA FORMULARIOS
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/form-data', pagosProveedoresController.getFormData);

// ═══════════════════════════════════════════════════════════════════════════════
// PROVEEDORES Y FACTURAS
// ═══════════════════════════════════════════════════════════════════════════════

// Proveedores con saldo pendiente
router.get('/proveedores-con-saldo', pagosProveedoresController.getProveedoresConSaldo);

// Facturas pendientes de un proveedor
router.get('/facturas-pendientes/:id_proveedor', pagosProveedoresController.getFacturasPendientes);

// Cuenta corriente de un proveedor
router.get('/cuenta-corriente/:id_proveedor', pagosProveedoresController.getCuentaCorriente);
router.get('/cuenta-corriente/:id_proveedor/libro', pagosProveedoresController.getLibro);
router.get('/cuenta-corriente/:id_proveedor/libro/export', pagosProveedoresController.exportarLibro);

// ═══════════════════════════════════════════════════════════════════════════════
// CHEQUES
// ═══════════════════════════════════════════════════════════════════════════════

// Alertas de cheques próximos a vencer
router.get('/alertas-cheques', pagosProveedoresController.alertasCheques);

// Cheques de terceros en cartera (disponibles para endosar)
router.get('/cheques-cartera', pagosProveedoresController.getChequesCartera);

// ═══════════════════════════════════════════════════════════════════════════════
// CRUD PAGOS
// ═══════════════════════════════════════════════════════════════════════════════

// Listar pagos
router.get('/', pagosProveedoresController.listarPagos);

// Obtener pago por ID
router.get('/:id', pagosProveedoresController.getPago);

// Registrar nuevo pago
router.post('/', pagosProveedoresController.registrarPago);

// Anular pago
router.put('/:id/anular', pagosProveedoresController.anularPago);



// ═══════════════════════════════════════════════════════════════════════════════
// IMPUTACIÓN POSTERIOR — saldo a favor
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/creditos-disponibles/:id_proveedor', pagosProveedoresController.getCreditosDisponibles);
router.post('/aplicar-saldo-favor', pagosProveedoresController.aplicarSaldoFavor);
router.put('/aplicaciones-saldo-favor/:id_aplicacion/revertir', pagosProveedoresController.revertirAplicacionSaldoFavor);


module.exports = router;
