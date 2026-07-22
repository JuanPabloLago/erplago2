const pool = require('../config/database');
const path = require('path');
const fs = require('fs').promises;
const Handlebars = require('handlebars');

Handlebars.registerHelper('formatNumber', (num) => {
    return parseFloat(num || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
});
Handlebars.registerHelper('formatDate', (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
});
Handlebars.registerHelper('padLeft', (num, length) => String(num).padStart(length, '0'));
Handlebars.registerHelper('now', () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
Handlebars.registerHelper('eq', (a, b) => a === b);

const TEMPLATES_PATH = path.join(__dirname, '../../templates/comprobantes');

async function obtenerDatosComprobante(idPedido, idEmpresa) {
    const pedidoResult = await pool.query(`
        SELECT p.*, c.razon_social as cliente_razon_social, c.cuit_cuil as cliente_cuit,
               c.domicilio as cliente_domicilio, c.telefono as cliente_telefono, c.email as cliente_email,
               e.nombre as estado_nombre
        FROM pedidos p
        JOIN clientes c ON c.id_cliente = p.id_cliente AND c.id_empresa = p.id_empresa
        JOIN pedidoestados e ON e.id_estado = p.id_estado
        WHERE p.id_pedido = $1 AND p.id_empresa = $2
    `, [idPedido, idEmpresa]);

    if (pedidoResult.rows.length === 0) throw new Error('Pedido no encontrado');
    const pedido = pedidoResult.rows[0];

    const itemsResult = await pool.query(`
        SELECT pi.*, pr.sku, pr.nombre as producto_nombre
        FROM pedidoitems pi JOIN productos pr ON pr.id_producto = pi.id_producto
        WHERE pi.id_pedido = $1 AND pi.id_empresa = $2 ORDER BY pi.id_item
    `, [idPedido, idEmpresa]);

    const empresaResult = await pool.query('SELECT * FROM empresas WHERE id_empresa = $1', [idEmpresa]);

    const pagosResult = await pool.query(`
        SELECT pa.monto, mp.nombre as metodo,
               pa.cuotas, pa.monto_original, pa.coeficiente
        FROM pagos pa JOIN metodosdepago mp ON mp.id_metodo_pago = pa.id_metodo_pago AND mp.id_empresa = pa.id_empresa
        WHERE pa.id_pedido = $1 AND pa.id_empresa = $2
    `, [idPedido, idEmpresa]);

    const ajustesResult = await pool.query(
        'SELECT tipo, porcentaje_aplicado, monto_base, monto_ajuste, descripcion FROM ajustes_forma_pago WHERE id_pedido = $1 AND id_empresa = $2 AND anulado = false',
        [idPedido, idEmpresa]
    );

    const totalPagado = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.monto || 0), 0);
    const totalFinal = parseFloat(pedido.total_final || pedido.total || 0);

    return {
        // F2: subtotal_sin_iva, total_iva y total_final están SIEMPRE persistidos en pedidos (validado: 4032/4032 al 12-abr-2026). No reconstruimos nada.
        pedido: { ...pedido, total_final: totalFinal },
        cliente: { razon_social: pedido.cliente_razon_social, cuit_cuil: pedido.cliente_cuit || '-', domicilio: pedido.cliente_domicilio || '-', telefono: pedido.cliente_telefono, email: pedido.cliente_email },
        empresa: empresaResult.rows[0] || {},
        items: itemsResult.rows.map(item => {
                // F2: iva_aplicado es contractual en pedidoitems (validado: 0 NULLs en X4). Sin fallback.
                const iva = parseFloat(item.iva_aplicado);
                if (isNaN(iva)) throw new Error('print.controller: pedidoitem ' + item.id_item + ' sin iva_aplicado persistido');
                // F4b-2026-05-19: usar total_linea como soberano (es el bruto entero ya persistido).
                // Si total_linea no es valido, cae al calculo legacy desde el neto.
                const cantidadItem = parseFloat(item.cantidad || 1);
                const totalLinea = parseFloat(item.total_linea);
                let precioConIva, subtotalConIva;
                if (Number.isFinite(totalLinea) && totalLinea > 0 && cantidadItem > 0) {
                    subtotalConIva = totalLinea;
                    precioConIva = Math.round((totalLinea / cantidadItem) * 100) / 100;
                } else {
                    const precioNeto = parseFloat(item.precio_unitario_congelado || item.precio_unitario_final || 0);
                    precioConIva = Math.round(precioNeto * (1 + iva / 100) * 100) / 100;
                    subtotalConIva = Math.round(precioConIva * cantidadItem * 100) / 100;
                }
                return { ...item, sku: item.sku || 'S/C', descripcion_congelada: item.descripcion_congelada || item.producto_nombre, descripcion: item.descripcion_congelada || item.producto_nombre, precio_unitario: precioConIva, subtotal: subtotalConIva };
            }),
        pagos: pagosResult.rows.map(function(p) {
            var cuotas = parseInt(p.cuotas) || 0;
            var montoOrig = parseFloat(p.monto_original || 0);
            var monto = parseFloat(p.monto);
            var detalle = p.metodo;
            if (cuotas > 1) {
                var valCuota = Math.round(monto / cuotas * 100) / 100;
                detalle += ' - ' + cuotas + ' cuotas x $' + valCuota.toFixed(2);
            }
            return { metodo: detalle, monto: p.monto, monto_original: montoOrig > 0 && Math.abs(montoOrig - monto) > 0.01 ? montoOrig : null };
        }),
        // F2: items_total es total_final del pedido — el dato fiscal ya existe, no se reconstruye desde subtotal asumiendo 21%.
        items_total: totalFinal,
        ajustes: ajustesResult.rows,
        // F2: totales leídos directo del pedido. subtotal y iva ya están persistidos por separado en el DB.
        totales: {
            subtotal: parseFloat(pedido.subtotal_sin_iva).toFixed(2),
            iva: parseFloat(pedido.total_iva).toFixed(2),
            total: totalFinal.toFixed(2)
        },
        es_responsable_inscripto: false,
        pagado: totalPagado >= totalFinal - 0.01,
        deuda_cuenta_corriente: pagosResult.rows.some(p => p.metodo === 'Cuenta Corriente'),
        monto_cuenta_corriente: pagosResult.rows.filter(p => p.metodo === 'Cuenta Corriente').reduce((sum, p) => sum + parseFloat(p.monto || 0), 0),
        es_retiro: pedido.tipo_entrega === 'retiro'
    };
}

const printController = {
    async crearJob(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { type, document_type, document_id, printer_id, whatsapp_number, email_to } = req.body;
        try {
            if (!type || !document_type || !document_id) return res.status(400).json({ error: 'Faltan campos requeridos' });
            const result = await pool.query(`
                INSERT INTO print_jobs (type, document_type, document_id, printer_id, whatsapp_number, email_to, id_empresa, id_usuario)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
            `, [type, document_type, document_id, printer_id, whatsapp_number, email_to, id_empresa, id_usuario]);
            res.status(201).json({ success: true, job: result.rows[0] });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async obtenerJob(req, res) {
        try {
            const result = await pool.query('SELECT * FROM print_jobs WHERE id_job = $1', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Job no encontrado' });
            res.json(result.rows[0]);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async listarJobs(req, res) {
        try {
            const result = await pool.query('SELECT * FROM print_jobs WHERE id_empresa = $1 ORDER BY created_at DESC LIMIT 20', [req.usuario.id_empresa]);
            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async listarImpresoras(req, res) {
        try {
            const result = await pool.query('SELECT * FROM printers_config WHERE id_empresa = $1 AND active = true', [req.usuario.id_empresa]);
            res.json(result.rows);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async getDatosComprobante(req, res) {
        try {
            const data = await obtenerDatosComprobante(parseInt(req.params.id), req.usuario.id_empresa);
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async renderizarHTML(req, res) {
        try {
            const data = await obtenerDatosComprobante(parseInt(req.params.id), req.usuario.id_empresa);
            const templatePath = path.join(TEMPLATES_PATH, 'comprobante_venta.hbs');
            const templateContent = await fs.readFile(templatePath, 'utf8');
            const template = Handlebars.compile(templateContent);
            const html = template(data);
            res.setHeader('Content-Type', 'text/html');
            res.send(html);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = printController;
