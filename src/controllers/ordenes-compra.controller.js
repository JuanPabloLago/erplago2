/**
 * @file ordenes-compra.controller.js
 * @scope enterprise
 * @description Endpoints HTTP. NO escribe directo a BD — todo via ordenes-compra.helper.
 */

'use strict';

const ocHelper = require('../utils/ordenes-compra.helper');

function _ip(req) {
    return req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress || null;
}

module.exports = {

    // GET /api/ordenes-compra
    async listar(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const filtros = {
                estado:        req.query.estado || null,
                id_proveedor:  req.query.id_proveedor ? parseInt(req.query.id_proveedor, 10) : null,
                id_deposito:   req.query.id_deposito  ? parseInt(req.query.id_deposito, 10)  : null,
                fecha_desde:   req.query.fecha_desde  || null,
                fecha_hasta:   req.query.fecha_hasta  || null,
                q:             req.query.q            || null,
                limit:         req.query.limit  || 50,
                offset:        req.query.offset || 0
            };
            const data = await ocHelper.listar(id_empresa, filtros);
            res.json(data);
        } catch (e) {
            console.error('OC.listar:', e);
            res.status(e.statusCode || 500).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/form-data
    async formData(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const pool = require('../config/database');
            const provs = await pool.query(
                'SELECT id_proveedor, razon_social FROM proveedores WHERE id_empresa=$1 AND activo=true ORDER BY razon_social',
                [id_empresa]
            );
            const deps = await pool.query(
                'SELECT id_deposito, nombre, es_principal FROM depositos WHERE id_empresa=$1 AND activo=true ORDER BY es_principal DESC, nombre',
                [id_empresa]
            );
            res.json({
                proveedores: provs.rows,
                depositos: deps.rows,
                estados: Object.values(ocHelper.OC_ESTADOS)
            });
        } catch (e) {
            console.error('OC.formData:', e);
            res.status(500).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/:id
    async obtener(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const oc = await ocHelper.obtenerOC(id_empresa, id);
            if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
            res.json(oc);
        } catch (e) {
            console.error('OC.obtener:', e);
            res.status(500).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/:id/datos  (para vista imprimible)
    async datosImprimir(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const data = await ocHelper.obtenerParaImprimir(id_empresa, id);
            if (!data) return res.status(404).json({ error: 'OC no encontrada' });
            res.json(data);
        } catch (e) {
            console.error('OC.datosImprimir:', e);
            res.status(500).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/:id/html  (HTML imprimible con window.print())
    async html(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const data = await ocHelper.obtenerParaImprimir(id_empresa, id);
            if (!data) return res.status(404).send('<h1>OC no encontrada</h1>');

            const { oc, empresa } = data;
            const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
                '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
            }[c]));
            const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const filas = (oc.items || []).map((it, i) => `
                <tr>
                    <td>${i+1}</td>
                    <td>${esc(it.sku)}</td><td>${esc(it.codigo_proveedor)}</td>
                    <td>${esc(it.nombre)}</td>
                    <td style="text-align:right">${fmtNum(it.cantidad)}</td>
                    <td style="text-align:right">${fmtNum(it.precio_estimado)}</td>
                    <td style="text-align:right">${fmtNum(it.subtotal_estimado)}</td>
                </tr>
            `).join('');

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>${esc(oc.numero_completo)} - Orden de Compra</title>
<style>
  body{font-family:-apple-system,Segoe UI,sans-serif;font-size:12px;color:#222;margin:20px}
  h1{font-size:18px;margin:0 0 4px 0}
  .header{display:flex;justify-content:space-between;border-bottom:2px solid #0d6b45;padding-bottom:8px;margin-bottom:14px}
  .empresa h2{margin:0;font-size:14px}
  .empresa div{font-size:11px;color:#555}
  .doc{text-align:right}
  .doc .num{font-size:16px;font-weight:600;color:#0d6b45}
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}
  th,td{border:1px solid #ccc;padding:5px 6px}
  th{background:#edf9f3;text-align:left;font-weight:600}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;font-size:11px}
  .meta div{padding:4px 8px;background:#f4f6f5;border-radius:3px}
  .meta strong{color:#0d6b45}
  .total{margin-top:10px;text-align:right;font-size:14px;font-weight:600}
  .obs{margin-top:12px;font-size:11px;padding:6px;background:#fff8e0;border-left:3px solid #e89b0c}
  .estado{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;text-transform:uppercase;font-weight:600}
  .estado.borrador{background:#e0e0e0;color:#555}
  .estado.emitida{background:#15a35e;color:#fff}
  .estado.parcial{background:#e89b0c;color:#fff}
  .estado.recibida{background:#0a5c3b;color:#fff}
  .estado.anulada{background:#dc3545;color:#fff}
  @media print { @page { margin: 15mm } body { margin: 0 } }
</style>
</head><body>
<div class="header">
  <div class="empresa">
    <h2>${esc(empresa.razon_social || 'EMPRESA')}</h2>
    <div>CUIT: ${esc(empresa.cuit || '')} &middot; ${esc(empresa.direccion || '')}</div>
    <div>${esc(empresa.telefono || '')} &middot; ${esc(empresa.email || '')}</div>
  </div>
  <div class="doc">
    <h1>ORDEN DE COMPRA</h1>
    <div class="num">${esc(oc.numero_completo)}</div>
    <div class="estado ${esc(oc.estado)}">${esc(oc.estado)}</div>
  </div>
</div>

<div class="meta">
  <div><strong>Fecha emisión:</strong> ${oc.fecha_emision ? new Date(oc.fecha_emision).toLocaleString('es-AR') : '—'}</div>
  <div><strong>Depósito destino:</strong> ${esc(oc.deposito_nombre)}</div>
  <div><strong>Proveedor:</strong> ${esc(oc.proveedor_razon_social)}</div>
  <div><strong>CUIT proveedor:</strong> ${esc(oc.proveedor_cuit || '')}</div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th style="width:90px">SKU</th><th style="width:90px">Cód. Prov.</th>
      <th>Producto</th>
      <th style="width:80px;text-align:right">Cantidad</th>
      <th style="width:100px;text-align:right">Precio est.</th>
      <th style="width:110px;text-align:right">Subtotal est.</th>
    </tr>
  </thead>
  <tbody>${filas}</tbody>
</table>

<div class="total">Total estimado: $ ${fmtNum(oc.total_estimado)}</div>

${oc.observaciones ? `<div class="obs"><strong>Observaciones:</strong> ${esc(oc.observaciones)}</div>` : ''}

<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
</body></html>`);
        } catch (e) {
            console.error('OC.html:', e);
            res.status(500).send(`<h1>Error: ${e.message}</h1>`);
        }
    },

    // POST /api/ordenes-compra
    async crear(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const ip = _ip(req);
            const {
                id_deposito,
                items,
                separar_por_proveedor,
                id_proveedor_unico,
                observaciones,
                estado_inicial
            } = req.body || {};

            const ocs = await ocHelper.crearLote(id_empresa, {
                id_deposito,
                items,
                separar_por_proveedor: !!separar_por_proveedor,
                id_proveedor_unico: id_proveedor_unico ? parseInt(id_proveedor_unico, 10) : null,
                id_usuario,
                ip,
                observaciones,
                estado_inicial
            });
            res.status(201).json({ ocs_creadas: ocs });
        } catch (e) {
            console.error('OC.crear:', e);
            res.status(400).json({ error: e.message });
        }
    },

    // POST /api/ordenes-compra/:id/emitir
    async emitir(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const ip = _ip(req);
            const r = await ocHelper.emitir(null, id_empresa, id, id_usuario, ip);
            res.json(r);
        } catch (e) {
            console.error('OC.emitir:', e);
            res.status(400).json({ error: e.message });
        }
    },

    // POST /api/ordenes-compra/:id/recibir
    // body: { items: [{ id_orden_compra_item, cantidad }] }
    async recibir(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const ip = _ip(req);
            const items = (req.body && req.body.items) || [];
            const r = await ocHelper.recibirLote(null, id_empresa, id, items, id_usuario, ip);
            res.json({ recepciones: r });
        } catch (e) {
            console.error('OC.recibir:', e);
            res.status(400).json({ error: e.message });
        }
    },

    // POST /api/ordenes-compra/:id/anular
    async anular(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const id = parseInt(req.params.id, 10);
            const ip = _ip(req);
            const { motivo } = req.body || {};
            const r = await ocHelper.anular(null, id_empresa, id, motivo, id_usuario, ip);
            res.json(r);
        } catch (e) {
            console.error('OC.anular:', e);
            res.status(400).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/por-producto/:id_producto
    async porProducto(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id = parseInt(req.params.id_producto, 10);
            const rows = await ocHelper.obtenerOCsActivasDeProducto(id_empresa, id);
            res.json(rows);
        } catch (e) {
            console.error('OC.porProducto:', e);
            res.status(500).json({ error: e.message });
        }
    },

    // GET /api/ordenes-compra/export/excel
    async exportExcel(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const excelHelper = require('../utils/excel.helper');
            const filtros = {
                estado:        req.query.estado || null,
                id_proveedor:  req.query.id_proveedor ? parseInt(req.query.id_proveedor, 10) : null,
                id_deposito:   req.query.id_deposito  ? parseInt(req.query.id_deposito, 10)  : null,
                fecha_desde:   req.query.fecha_desde  || null,
                fecha_hasta:   req.query.fecha_hasta  || null,
                q:             req.query.q            || null
            };
            const ordenes = await ocHelper.obtenerParaExportarExcel(id_empresa, filtros);

            const headers = ['Numero', 'Estado', 'Fecha creacion', 'Fecha emision',
                             'Proveedor', 'Deposito', 'Items', 'Total estimado', 'Observaciones'];
            const rows = ordenes.map(o => [
                o.numero_completo, o.estado,
                o.fecha_creacion ? new Date(o.fecha_creacion).toISOString().slice(0,10) : '',
                o.fecha_emision  ? new Date(o.fecha_emision).toISOString().slice(0,10)  : '',
                o.proveedor_razon_social || '',
                o.deposito_nombre || '',
                o.items_count,
                Number(o.total_estimado) || 0,
                o.observaciones || ''
            ]);

            if (typeof excelHelper.generarBuffer === 'function') {
                const buf = await excelHelper.generarBuffer({ sheet: 'OrdenesCompra', headers, rows });
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="ordenes_compra_${Date.now()}.xlsx"`);
                return res.send(buf);
            }
            // Fallback CSV ; locale AR
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="ordenes_compra_${Date.now()}.csv"`);
            const csv = [headers.join(';')].concat(rows.map(r => r.map(c => String(c).replace(/;/g,',')).join(';'))).join('\n');
            return res.send(csv);
        } catch (e) {
            console.error('OC.exportExcel:', e);
            res.status(500).json({ error: e.message });
        }
    }
};
