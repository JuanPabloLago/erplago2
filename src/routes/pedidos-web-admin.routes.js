/**
 * PEDIDOS-WEB-ADMIN ROUTES — ERP LAGO
 * Rutas del staff para gestionar pedidos web pendientes,
 * carritos abandonados y clientes web. Usa auth de staff.
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/pedidos-web.controller');
const { verificarToken } = require('../middleware/auth.middleware');

router.use(verificarToken);

// Pedidos web pendientes
router.get ('/pendientes',                  ctrl.adminListarPendientes);
router.get ('/:id',                         ctrl.adminDetalle);
router.post('/:id/aprobar',                 ctrl.adminAprobar);
router.post('/:id/rechazar',                ctrl.adminRechazar);
router.put ('/:id/items/:id_item',          ctrl.adminModificarItem);

// Carritos abandonados
router.get ('/extra/carritos-abandonados',  ctrl.adminCarritosAbandonados);

// Clientes web
router.get ('/extra/clientes',              ctrl.adminClientesWeb);
router.put ('/extra/clientes/:id/aprobar',     ctrl.adminAprobarCliente);
router.put ('/extra/clientes/:id/desactivar',  ctrl.adminDesactivarCliente);

module.exports = router;
