'use strict';
/**
 * NOTAS-PRINT CONTROLLER — Render HTML server-side de Notas C/D
 *
 * Patrón: Handlebars compila template → HTML → browser dispara window.print()
 * (mismo patrón que comprobante_venta — sin Puppeteer, sin RAM extra)
 *
 * @module notas-print.controller
 */

const path = require('path');
const fs = require('fs').promises;
const Handlebars = require('handlebars');
const notasPrintHelper = require('../utils/notas-print.helper');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'comprobantes', 'nota_credito_debito.hbs');

async function getDatos(req, res) {
    try {
        const idNota = parseInt(req.params.id, 10);
        const idEmpresa = req.usuario.id_empresa;
        const data = await notasPrintHelper.obtenerDatosNotaParaPrint(idNota, idEmpresa);
        res.json(data);
    } catch (err) {
        console.error('[notas-print.controller.getDatos]', err);
        res.status(500).json({ error: err.message });
    }
}

async function renderizarHTML(req, res) {
    try {
        const idNota = parseInt(req.params.id, 10);
        const idEmpresa = req.usuario.id_empresa;
        const data = await notasPrintHelper.obtenerDatosNotaParaPrint(idNota, idEmpresa);
        const tplContent = await fs.readFile(TEMPLATE_PATH, 'utf8');
        const template = Handlebars.compile(tplContent);
        const html = template(data);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[notas-print.controller.renderizarHTML]', err);
        res.status(500).send('<h1>Error generando comprobante</h1><pre>' + err.message + '</pre>');
    }
}

module.exports = { getDatos, renderizarHTML };
