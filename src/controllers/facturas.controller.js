/**
 * FACTURAS CONTROLLER - ERP LAGO
 *
 *
 * MIGRADO: 2026-02-21 - facturacion.helper.js
 * CAMBIOS:
 *   - obtenerProximoNumero: usa consultarProximoNumero() del helper
 *   - crear: resolverPuntoVenta + obtenerProximoNumero + crearFacturaConItems + marcarPedidoFacturado
 *   - anular: usa anularFactura() del helper
 *   - facturarMasivo: resolverPuntoVenta + verificarNoFacturado + obtenerProximoNumero + crearFacturaConItems + marcarPedidoFacturado
 *
 * BUGS CORREGIDOS:
 *   - punto_venta=6 hardcodeado → resolverPuntoVenta desde depósito del usuario
 *   - verificar no facturado sin id_empresa en masivo → verificarNoFacturado con id_empresa
 *   - UPDATE pedidos SET id_estado=3 hardcodeado → marcarPedidoFacturado lookup dinámico
 *   - secuencia sin sync AFIP en crear individual → obtenerProximoNumero unificado
 *   - facturas sin id_deposito → crearFacturaConItems graba id_deposito (trazabilidad sucursal)
 */

const pool = require('../config/database');
const afipService = require('../services/afip.service');
const logger = require('../utils/logger');
const facturacionHelper = require('../utils/facturacion.helper');
const notasHelper = require('../utils/notas.helper');
const pedidosHelper = require('../utils/pedidos.helper');
const { generarBusquedaMultiPalabra } = require('../utils/busqueda.helper');

// ============================================================
// HELPER INTERNO: Resolver punto de venta del usuario
// ============================================================
// Si el usuario tiene id_deposito en JWT, usa resolverPuntoVenta del helper.
// Si no (backward compatible), busca depósito principal de la empresa.
async function _resolverPV(clientOrPool, req) {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    if (req.usuario.id_deposito) {
        return await facturacionHelper.resolverPuntoVenta(clientOrPool, {
            id_deposito: req.usuario.id_deposito,
            id_empresa
        });
    }

    // Fallback: depósito principal de la empresa
    const depRes = await clientOrPool.query(
        'SELECT id_deposito, punto_venta_afip FROM depositos WHERE id_empresa = $1 AND es_principal = true LIMIT 1',
        [id_empresa]
    );

    if (depRes.rows.length > 0 && depRes.rows[0].punto_venta_afip) {
        return {
            punto_venta: depRes.rows[0].punto_venta_afip,
            id_deposito: depRes.rows[0].id_deposito,
            nombre_deposito: null
        };
    }

    // Último fallback: leer de configuraciones_empresa
    const cfgRes = await clientOrPool.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'afip_punto_venta_default'",
        [id_empresa]
    );
    const pvDefault = cfgRes.rows.length > 0 ? parseInt(cfgRes.rows[0].valor, 10) : null;
    if (!pvDefault) {
        const error = new Error('No hay punto de venta AFIP configurado. Asigne uno en Configuraciones > AFIP o en Admin > Depósitos.');
        error.statusCode = 400;
        throw error;
    }
    return { punto_venta: pvDefault, id_deposito: null, nombre_deposito: null };
}

// ============================================================
// MI PUNTO DE VENTA (resuelve PV del usuario actual)
// ============================================================
exports.miPuntoVenta = async (req, res) => {
    try {
        const pvData = await _resolverPV(pool, req);
        res.json({
            punto_venta: pvData.punto_venta,
            id_deposito: pvData.id_deposito,
            nombre_deposito: pvData.nombre_deposito
        });
    } catch (error) {
        logger.error('Error al resolver punto de venta:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};

// ============================================================
// OBTENER TIPOS DE FACTURA
// ============================================================
exports.obtenerTipos = async (req, res) => {
    try {
        const query = `SELECT id_tipo_factura, codigo, nombre, discrimina_iva, requiere_cuit, descripcion FROM factura_tipos ORDER BY codigo`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        logger.error('Error al obtener tipos de factura:', error.message);
        res.status(500).json({ error: 'Error al obtener tipos de factura' });
    }
};

// ============================================================
// OBTENER PROXIMO NUMERO — via helper (preview, no incrementa)
// ============================================================
exports.obtenerProximoNumero = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const punto_venta = parseInt(req.params.punto_venta, 10);
    const id_tipo_factura = parseInt(req.params.id_tipo_factura, 10);

    try {
        const proximo_numero = await facturacionHelper.consultarProximoNumero(pool, {
            id_empresa,
            punto_venta,
            id_tipo_factura
        });
        res.json({ proximo_numero });
    } catch (error) {
        logger.error('Error al obtener próximo número:', error.message);
        res.status(500).json({ error: 'Error al obtener próximo número' });
    }
};

// ============================================================
// CREAR FACTURA INDIVIDUAL (POS) - CON AFIP CAE
// ============================================================
// MIGRADO: secuencia + factura + items + pedido via helper
// ============================================================
exports.crear = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_pedido, id_cliente, id_tipo_factura, fecha_vencimiento, observaciones, items } = req.body;

    if (!id_pedido) {
        return res.status(400).json({ error: 'Se requiere un pedido para facturar. Use Venta Rápida + Facturación Masiva.' });
    }
    if (!id_cliente || !id_tipo_factura) {
        return res.status(400).json({ error: 'Cliente y tipo de factura son requeridos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // --- Resolver punto de venta desde depósito del usuario ---
        const pvData = await _resolverPV(client, req);
        const punto_venta = pvData.punto_venta;

        // --- Obtener datos del cliente para AFIP ---
        const clienteRes = await client.query(`
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil, c.id_condicion_iva,
                   ci.nombre AS condicion_iva_nombre
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
        `, [id_cliente, id_empresa]);

        if (clienteRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        const clienteData = clienteRes.rows[0];

        // --- Verificar que el pedido no tenga factura activa (C1 fix) ---
        if (id_pedido) {
            await facturacionHelper.verificarNoFacturado(client, {
                id_pedido,
                id_empresa
            });
        }

        // --- Sync secuencia con AFIP antes de obtener número ---
        await afipService.cargarConfiguracion(pool, id_empresa);
        const cbteTipoAFIP = afipService.tipoFacturaAFIP(id_tipo_factura);
        let ultimoAFIP = 0;
        if (!afipService.config.modoOffline && cbteTipoAFIP) {
            try {
                ultimoAFIP = await afipService.ultimoComprobante(punto_venta, cbteTipoAFIP);
            } catch (e) {
                await client.query('ROLLBACK');
                logger.error('AFIP: No se pudo obtener ultimo comprobante:', e.message);
                return res.status(503).json({ error: 'No se pudo conectar con AFIP. Los items no se pierden, puede reintentar o suspender.', afip_error: true });
            }
        }

        // --- Secuencia atómica via helper (sincronizada con AFIP) ---
        const numero_factura = await facturacionHelper.obtenerProximoNumero(client, {
            id_empresa,
            punto_venta,
            id_tipo_factura,
            ultimo_afip: ultimoAFIP
        });

        // --- Obtener pedido con totales reales (C2 fix: fuente de verdad) ---
        const pedidoRes = await client.query(`
            SELECT id_pedido, subtotal_sin_iva, total_iva, total_final,
                   descuento_general, descuento_monto, subtotal_con_descuento,
                   descuento_fp_porcentaje, descuento_fp_monto,
                   id_forma_pago_principal
            FROM pedidos
            WHERE id_pedido = $1 AND id_empresa = $2
        `, [id_pedido, id_empresa]);

        if (pedidoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        const pedidoData = pedidoRes.rows[0];

        // --- Items con todos los campos (C3 fix: columna subtotal_linea no existe) ---
        const itemsRes = await client.query(`
            SELECT pi.*, p.nombre AS producto_nombre, p.sku
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
            ORDER BY pi.id_item
        `, [id_pedido, id_empresa]);
        const facturaItems = itemsRes.rows;

        if (facturaItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No hay items para facturar' });
        }

        // Totales desde el pedido (ya incluyen descuentos — no recalcular)
        const subtotal = parseFloat(pedidoData.subtotal_sin_iva || 0);
        const total_iva = parseFloat(pedidoData.total_iva || 0);
        const total = parseFloat(pedidoData.total_final || 0);

        // --- Solicitar CAE a AFIP ---

        let cae, caeVto;

        if (afipService.config.modoOffline) {
            cae = 'OFFLINE-' + Date.now();
            caeVto = new Date();
            caeVto.setDate(caeVto.getDate() + 10);
        } else {
            // C2 fix: pasar items directo — agruparIVAPorAlicuota ya maneja
            // iva_aplicado, total_linea, monto_iva, precio_unitario_congelado
            const ivaDetalle = afipService.agruparIVAPorAlicuota(facturaItems);

            const resultadoAFIP = await afipService.solicitarCAE({
                punto_venta: punto_venta,
                id_tipo_factura: id_tipo_factura,
                numero_factura: numero_factura,
                cuit_cliente: clienteData.cuit_cuil,
                id_condicion_iva_cliente: clienteData.id_condicion_iva,
                neto_gravado: Math.round(subtotal * 100) / 100,
                total_iva: Math.round(total_iva * 100) / 100,
                total: Math.round(total * 100) / 100,
                iva_detalle: ivaDetalle,
            });

            cae = resultadoAFIP.cae;
            const vtoStr = resultadoAFIP.cae_vencimiento;
            caeVto = new Date(
                parseInt(vtoStr.substring(0, 4)),
                parseInt(vtoStr.substring(4, 6)) - 1,
                parseInt(vtoStr.substring(6, 8))
            );
        }

        // --- Crear factura + items via helper (C2+C3 fix: descuentos + totales pedido) ---
        const factura = await facturacionHelper.crearFacturaConItems(client, {
            id_empresa,
            id_pedido,
            id_cliente,
            id_tipo_factura,
            punto_venta,
            numero_factura,
            cae,
            cae_vencimiento: caeVto,
            observaciones: observaciones || null,
            id_deposito: pvData.id_deposito,
            descuento_porcentaje: parseFloat(pedidoData.descuento_general || 0),
            descuento_monto: parseFloat(pedidoData.descuento_monto || 0),
            descuento_fp_porcentaje: parseFloat(pedidoData.descuento_fp_porcentaje || 0),
            descuento_fp_monto: parseFloat(pedidoData.descuento_fp_monto || 0),
            id_forma_pago_principal: pedidoData.id_forma_pago_principal,
            items: facturaItems.map(item => ({
                id_producto: item.id_producto,
                cantidad: item.cantidad,
                descripcion: item.descripcion_congelada || item.producto_nombre || '',
                precio_unitario: item.precio_unitario_congelado || item.precio_unitario_final,
                porcentaje_iva: item.iva_aplicado || 21,
                precio_lista: item.precio_unitario_congelado,
                descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0)
            }))
        }, {
            calcularTotales: false,
            totalesExternos: { subtotal, total_iva, total }
        });

        // --- Actualizar pedido si corresponde ---
        if (id_pedido) {
            await facturacionHelper.marcarPedidoFacturado(client, {
                id_pedido,
                id_empresa
            });
        }

        await client.query('COMMIT');

        logger.info(`Factura creada: ${factura.numero_completo} CAE: ${cae}`);

        res.status(201).json({
            message: 'Factura creada exitosamente',
            id_factura: factura.id_factura,
            numero_completo: factura.numero_completo,
            cae,
            cae_vencimiento: caeVto,
            total: factura.total
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al crear factura:', error.message);
        res.status(500).json({ error: 'Error al crear factura: ' + error.message });
    } finally {
        client.release();
    }
};

// ============================================================
// LISTAR FACTURAS
// ============================================================
exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, estado, q, id_cliente, id_tipo_factura } = req.query;

    try {
        let query = `
            SELECT f.id_factura, f.numero_completo, f.fecha_emision, f.fecha_vencimiento,
                   f.subtotal, f.total_iva, f.total, f.estado, f.cae, f.cae_vencimiento,
                   c.razon_social as cliente, c.cuit_cuil,
                   ft.codigo as tipo_factura, ft.nombre as tipo_factura_nombre
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            WHERE f.id_empresa = $1
        `;

        const params = [id_empresa];
        let paramIndex = 2;

        if (id_cliente) {
            query += ` AND f.id_cliente = $${paramIndex}`;
            params.push(parseInt(id_cliente));
            paramIndex++;
        }
        if (fecha_desde) {
            query += ` AND f.fecha_emision >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND f.fecha_emision <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        if (estado) {
            query += ` AND f.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }
        if (id_tipo_factura) {
            query += ` AND f.id_tipo_factura = $${paramIndex}`;
            params.push(parseInt(id_tipo_factura));
            paramIndex++;
        }
        if (q) {
            const busq = generarBusquedaMultiPalabra(q, [
                "c.razon_social", "f.numero_completo", "c.cuit_cuil"
            ], paramIndex);
            if (busq) {
                query += " AND " + busq.clausula;
                params.push(...busq.params);
                paramIndex = busq.nextIdx;
            }
        }





        query += ` ORDER BY f.fecha_emision DESC, f.id_factura DESC LIMIT 200`;

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        logger.error('Error al listar facturas:', error.message);
        res.status(500).json({ error: 'Error al listar facturas' });
    }
};

// ============================================================
// OBTENER FACTURA POR ID (con datos para impresión)
// ============================================================
exports.obtenerPorId = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);

    try {
        const facturaQuery = `
            SELECT f.*,
                   c.razon_social as cliente, c.cuit_cuil, c.domicilio, c.email,
                   ci.nombre as condicion_iva_cliente,
                   ft.codigo as tipo_factura, ft.nombre as tipo_factura_nombre, ft.discrimina_iva,
                   e.razon_social as empresa_nombre, e.cuit as empresa_cuit,
                   e.domicilio_fiscal as empresa_direccion,
                   e.fecha_inicio_actividades as empresa_inicio_actividades,
                   cie.nombre as empresa_condicion_iva,
                   e.ingresos_brutos as empresa_ingresos_brutos,
                   fp.nombre as forma_pago_nombre, fp.tipo as forma_pago_tipo
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            JOIN empresas e ON f.id_empresa = e.id_empresa
            LEFT JOIN condicionesiva cie ON e.id_condicion_iva = cie.id_condicion_iva
            LEFT JOIN formas_pago fp ON f.id_forma_pago_principal = fp.id_forma_pago AND fp.id_empresa = f.id_empresa
            WHERE f.id_factura = $1 AND f.id_empresa = $2
        `;

        const facturaRes = await pool.query(facturaQuery, [id_factura, id_empresa]);

        if (facturaRes.rows.length === 0) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const factura = facturaRes.rows[0];

        const itemsQuery = `
            SELECT fi.*, p.nombre as producto_nombre, p.sku
            FROM factura_items fi
            JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1 AND fi.id_empresa = $2
            ORDER BY fi.numero_linea
        `;

        const itemsRes = await pool.query(itemsQuery, [id_factura, id_empresa]);

        res.json({ ...factura, items: itemsRes.rows });
    } catch (error) {
        logger.error('Error al obtener factura:', error.message);
        res.status(500).json({ error: 'Error al obtener factura' });
    }
};

// ============================================================
// ANULAR FACTURA — Transaccional: genera NC + CC + revierte pedido (I1 fix)
// ============================================================
// Flujo legal Argentina: factura con CAE no se "anula", se emite NC.
// 1. Genera NC por el total de la factura (con CAE AFIP si aplica)
// 2. Registra NC en CC del cliente (haber = reduce deuda)
// 3. Marca factura como anulada
// 4. Revierte pedido a estado confirmado (2)
// Todo en una transacción — si AFIP falla, no se graba nada.
// ============================================================
exports.anular = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);
    const id_usuario = req.usuario.id_usuario;

    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden anular facturas' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // ── 1. Obtener factura con lock ──────────────────────────────
        const facturaRes = await client.query(`
            SELECT f.*, ft.codigo AS letra,
                   c.id_condicion_iva, c.razon_social, c.cuit_cuil
            FROM facturas f
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_factura = $1 AND f.id_empresa = $2
            FOR UPDATE OF f
        `, [id_factura, id_empresa]);

        if (facturaRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Factura no encontrada' });
        }
        const factura = facturaRes.rows[0];

        if (factura.estado === 'anulada') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'La factura ya está anulada' });
        }

        // ── 2. Verificar que no exista NC activa para esta factura ───
        const ncExistente = await client.query(`
            SELECT id_nota, numero_completo
            FROM notas_credito_debito
            WHERE id_factura_origen = $1 AND id_empresa = $2
              AND estado = 'activa' AND tipo_nota = 'credito'
        `, [id_factura, id_empresa]);

        if (ncExistente.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                error: 'Ya existe NC activa para esta factura: ' + ncExistente.rows[0].numero_completo
            });
        }

        // ── 3. Obtener items de la factura ───────────────────────────
        const itemsRes = await client.query(`
            SELECT fi.*, p.nombre AS producto_nombre
            FROM factura_items fi
            LEFT JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1 AND fi.id_empresa = $2
            ORDER BY fi.numero_linea
        `, [id_factura, id_empresa]);

        if (itemsRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Factura sin items' });
        }

        // ── 4. Solicitar CAE para NC en AFIP (si corresponde) ───────
        const tieneCaeReal = factura.cae && !factura.cae.startsWith('OFFLINE');
        const letra = factura.letra;
        const codigoAfip = notasHelper.determinarCodigoAFIP('credito', letra);
        const tipoFacturaAfip = afipService.tipoFacturaAFIP(factura.id_tipo_factura);

        let ncCae = null;
        let ncCaeVto = null;

        if (tieneCaeReal) {
            await afipService.cargarConfiguracion(pool, id_empresa);

            if (!afipService.config.modoOffline) {
                // Preview del próximo número NC (sin incrementar)
                const previewNumero = await notasHelper.consultarProximoNumero(
                    id_empresa, factura.punto_venta, 'credito'
                );

                // IVA agrupado desde items de la factura
                const ivaDetalle = afipService.agruparIVAPorAlicuota(itemsRes.rows);

                try {
                    const resultadoAFIP = await afipService.solicitarCAE({
                        punto_venta: factura.punto_venta,
                        cbte_tipo_afip: parseInt(codigoAfip),
                        numero_factura: previewNumero,
                        cuit_cliente: factura.cuit_cuil,
                        id_condicion_iva_cliente: factura.id_condicion_iva,
                        neto_gravado: Math.round(parseFloat(factura.subtotal) * 100) / 100,
                        total_iva: Math.round(parseFloat(factura.total_iva) * 100) / 100,
                        total: Math.round(parseFloat(factura.total) * 100) / 100,
                        iva_detalle: ivaDetalle,
                        cbte_asoc: {
                            tipo: tipoFacturaAfip,
                            punto_venta: factura.punto_venta,
                            numero: factura.numero_factura,
                        },
                    });

                    ncCae = resultadoAFIP.cae;
                    const vtoStr = resultadoAFIP.cae_vencimiento;
                    ncCaeVto = new Date(
                        parseInt(vtoStr.substring(0, 4)),
                        parseInt(vtoStr.substring(4, 6)) - 1,
                        parseInt(vtoStr.substring(6, 8))
                    );
                } catch (afipError) {
                    await client.query('ROLLBACK');
                    logger.error('AFIP NC error:', afipError.message);
                    return res.status(503).json({
                        error: 'No se pudo obtener CAE para la Nota de Crédito. AFIP: ' + afipError.message,
                        afip_error: true
                    });
                }
            } else {
                ncCae = 'OFFLINE-NC-' + Date.now();
                ncCaeVto = new Date();
                ncCaeVto.setDate(ncCaeVto.getDate() + 10);
            }
        } else {
            // Factura sin CAE real (offline) → NC offline
            ncCae = 'OFFLINE-NC-' + Date.now();
            ncCaeVto = new Date();
            ncCaeVto.setDate(ncCaeVto.getDate() + 10);
        }

        // ── 5. Crear NC via notas.helper ─────────────────────────────
        const nota = await notasHelper.crearNotaConItems(client, {
            id_empresa,
            tipo_nota: 'credito',
            letra,
            id_cliente: factura.id_cliente,
            id_usuario,
            punto_venta: factura.punto_venta,
            motivo: 'Anulacion Factura ' + factura.numero_completo,
            observaciones: req.body.observaciones || null,
            origen: 'factura',
            id_factura_origen: id_factura,
            cae: ncCae,
            vencimiento_cae: ncCaeVto,
            items: itemsRes.rows.map(item => ({
                id_producto: item.id_producto,
                descripcion: item.descripcion || item.producto_nombre,
                cantidad: parseFloat(item.cantidad),
                precio_unitario: parseFloat(item.precio_unitario),
                iva_porcentaje: parseFloat(item.porcentaje_iva || 21),
            })),
        });

        // ── 6. Registrar NC en cuenta corriente del cliente ──────────
        const nuevoSaldo = await notasHelper.registrarEnCuentaCorriente(
            client, id_empresa, nota
        );

        // ── 7. Marcar factura como anulada ───────────────────────────
        await facturacionHelper.anularFactura(client, {
            id_factura,
            id_empresa
        });

        // ── 8. Revertir pedido a confirmado si estaba facturado ──────
        // F2+F5 fix: resolver estados por nombre + registrar en auditoria
        const estadosRes = await client.query(
            "SELECT id_estado, nombre FROM pedidoestados WHERE nombre IN ('Facturado', 'Confirmado')"
        );
        const estadosMap = {};
        estadosRes.rows.forEach(r => { estadosMap[r.nombre] = r.id_estado; });

        if (!estadosMap['Facturado'] || !estadosMap['Confirmado']) {
            throw new Error('Estados "Facturado" y/o "Confirmado" no encontrados en pedidoestados');
        }

        let pedidoRevertido = false;

        if (factura.id_pedido) {
            const pedidoUpd = await client.query(`
                UPDATE pedidos SET id_estado = $1
                WHERE id_pedido = $2 AND id_empresa = $3 AND id_estado = $4
                RETURNING id_pedido
            `, [estadosMap['Confirmado'], factura.id_pedido, id_empresa, estadosMap['Facturado']]);
            pedidoRevertido = pedidoUpd.rows.length > 0;

            // F5 fix: registrar en auditoria (antes faltaba)
            if (pedidoRevertido) {
                await pedidosHelper.registrarLogPedido(client, {
                    id_pedido: factura.id_pedido,
                    id_empresa,
                    id_usuario,
                    accion: pedidosHelper.LOG_PEDIDO_ACCIONES.ESTADO_CAMBIADO,
                    detalle_antes: { id_estado: estadosMap['Facturado'], motivo: 'Facturado' },
                    detalle_despues: { id_estado: estadosMap['Confirmado'], motivo: 'Revertido por anulacion factura ' + factura.numero_completo },
                    ip_origen: req.ip
                });
            }
        }

        // ── 9. COMMIT ────────────────────────────────────────────────
        await client.query('COMMIT');

        logger.info(
            'Factura anulada: ' + factura.numero_completo +
            ' | NC generada: ' + nota.numero_completo +
            ' | CAE NC: ' + ncCae +
            ' | Pedido revertido: ' + (pedidoRevertido ? 'si' : 'no') +
            ' | empresa=' + id_empresa
        );

        res.json({
            message: 'Factura anulada correctamente. NC ' + nota.numero_completo + ' generada.',
            factura: {
                numero_completo: factura.numero_completo,
                estado: 'anulada'
            },
            nota_credito: {
                id_nota: nota.id_nota,
                numero_completo: nota.numero_completo,
                cae: ncCae,
                cae_vencimiento: ncCaeVto,
                total: parseFloat(nota.total),
            },
            pedido_revertido: pedidoRevertido,
            saldo_cc: nuevoSaldo,
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error al anular factura:', error.message);
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Error al anular factura' });
    } finally {
        client.release();
    }
};

// ============================================================
// FACTURAR MASIVO — via helper
// ============================================================
exports.facturarMasivo = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { pedido_ids } = req.body;

    if (!pedido_ids || !Array.isArray(pedido_ids) || pedido_ids.length === 0) {
        return res.status(400).json({ error: 'Debe seleccionar al menos un pedido' });
    }

    const client = await pool.connect();
    const resultados = [];
    let exitosos = 0;
    let fallidos = 0;

    try {
        await client.query('BEGIN');

        // Resolver punto de venta UNA SOLA VEZ para todo el lote
        const pvData = await _resolverPV(client, req);
        const punto_venta = pvData.punto_venta;

        // Cargar config AFIP una sola vez para todo el lote
        await afipService.cargarConfiguracion(pool, id_empresa);

        // Pre-consultar AFIP una sola vez por tipo de factura (Bug 11 fix)
        const ultimosAFIP = {};
        if (!afipService.config.modoOffline) {
            try {
                const cbteTipoA = afipService.tipoFacturaAFIP(1);
                if (cbteTipoA) ultimosAFIP[1] = await afipService.ultimoComprobante(punto_venta, cbteTipoA);
                const cbteTipoB = afipService.tipoFacturaAFIP(2);
                if (cbteTipoB) ultimosAFIP[2] = await afipService.ultimoComprobante(punto_venta, cbteTipoB);
            } catch (e) {
                await client.query('ROLLBACK');
                client.release();
                return res.status(503).json({ error: 'AFIP no disponible: ' + e.message, afip_error: true });
            }
        }

        for (const id_pedido of pedido_ids) {
            const sp = `sp_fact_${id_pedido}`;
            try {
                await client.query(`SAVEPOINT ${sp}`);

                // Obtener pedido + cliente
                const pedidoRes = await client.query(`
                    SELECT p.*, c.id_cliente, c.razon_social, c.cuit_cuil,
                           c.id_condicion_iva, ci.nombre AS condicion_iva_nombre
                    FROM pedidos p
                    LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
                    LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
                    WHERE p.id_pedido = $1 AND p.id_empresa = $2
                `, [id_pedido, id_empresa]);

                if (pedidoRes.rows.length === 0) {
                    throw new Error('Pedido no encontrado');
                }
                const pedido = pedidoRes.rows[0];

                // Verificar no facturado CON id_empresa
                await facturacionHelper.verificarNoFacturado(client, {
                    id_pedido,
                    id_empresa
                });

                // Determinar tipo factura (A o B)
                const id_tipo_factura = (pedido.id_condicion_iva === 1) ? 1 : 2; // RI→A, Mono/Exento/CF→B

                // Items del pedido
                const itemsRes = await client.query(`
                    SELECT pi.*, pr.nombre AS producto_nombre
                    FROM pedidoitems pi
                    LEFT JOIN productos pr ON pi.id_producto = pr.id_producto
                    WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
                `, [id_pedido, id_empresa]);

                if (itemsRes.rows.length === 0) {
                    throw new Error('Sin items');
                }

                // Secuencia con sync AFIP via helper (usa cache pre-loop)
                const numero_factura = await facturacionHelper.obtenerProximoNumero(client, {
                    id_empresa,
                    punto_venta,
                    id_tipo_factura,
                    ultimo_afip: ultimosAFIP[id_tipo_factura] || 0
                });

                // Totales del pedido
                const subtotal = parseFloat(pedido.subtotal_sin_iva ?? pedido.total ?? 0);
                const totalIva = parseFloat(pedido.total_iva ?? 0);
                const total = parseFloat(pedido.total_final ?? pedido.total ?? 0);

                // ========== SOLICITAR CAE A AFIP ==========
                let cae, caeVto;

                if (afipService.config.modoOffline) {
                    cae = 'OFFLINE-' + Date.now();
                    caeVto = new Date();
                    caeVto.setDate(caeVto.getDate() + 10);
                } else {
                    const ivaDetalle = afipService.agruparIVAPorAlicuota(itemsRes.rows);

                    const resultadoAFIP = await afipService.solicitarCAE({
                        punto_venta: punto_venta,
                        id_tipo_factura: id_tipo_factura,
                        numero_factura: numero_factura,
                        cuit_cliente: pedido.cuit_cuil,
                        id_condicion_iva_cliente: pedido.id_condicion_iva,
                        neto_gravado: Math.round(subtotal * 100) / 100,
                        total_iva: Math.round(totalIva * 100) / 100,
                        total: Math.round(total * 100) / 100,
                        iva_detalle: ivaDetalle,
                    });

                    cae = resultadoAFIP.cae;
                    const vtoStr = resultadoAFIP.cae_vencimiento;
                    caeVto = new Date(
                        parseInt(vtoStr.substring(0, 4)),
                        parseInt(vtoStr.substring(4, 6)) - 1,
                        parseInt(vtoStr.substring(6, 8))
                    );
                }

                // Crear factura + items via helper (C3 fix: descuentos + totales pedido)
                const factura = await facturacionHelper.crearFacturaConItems(client, {
                    id_empresa,
                    id_pedido,
                    id_cliente: pedido.id_cliente,
                    id_tipo_factura,
                    punto_venta,
                    numero_factura,
                    cae,
                    cae_vencimiento: caeVto,
                    id_deposito: pvData.id_deposito,
                    descuento_porcentaje: parseFloat(pedido.descuento_general || 0),
                    descuento_monto: parseFloat(pedido.descuento_monto || 0),
                    descuento_fp_porcentaje: parseFloat(pedido.descuento_fp_porcentaje || 0),
                    descuento_fp_monto: parseFloat(pedido.descuento_fp_monto || 0),
                    id_forma_pago_principal: pedido.id_forma_pago_principal,
                    items: itemsRes.rows.map(item => ({
                        id_producto: item.id_producto,
                        cantidad: item.cantidad,
                        descripcion: item.descripcion_congelada || item.producto_nombre,
                        precio_unitario: item.precio_unitario_congelado || item.precio_unitario_final || 0,
                        porcentaje_iva: item.iva_aplicado || 21,
                        precio_lista: item.precio_unitario_congelado,
                        descuento_porcentaje: parseFloat(item.porcentaje_descuento || 0)
                    }))
                }, {
                    calcularTotales: false,
                    totalesExternos: { subtotal, total_iva: totalIva, total }
                });

                // Marcar pedido como facturado (lookup dinámico, no hardcoded id_estado=3)
                await facturacionHelper.marcarPedidoFacturado(client, {
                    id_pedido,
                    id_empresa
                });

                await client.query(`RELEASE SAVEPOINT ${sp}`);

                resultados.push({
                    id_pedido, ok: true,
                    id_factura: factura.id_factura,
                    numero_completo: factura.numero_completo,
                    cae: cae,
                    tipo: id_tipo_factura === 1 ? 'A' : 'B',
                    cliente: pedido.razon_social,
                    total: factura.total
                });
                exitosos++;

            } catch (err) {
                await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
                resultados.push({ id_pedido, ok: false, error: err.message });
                fallidos++;
            }
        }

        if (exitosos > 0) {
            await client.query('COMMIT');
        } else {
            await client.query('ROLLBACK');
        }

        logger.info(`Facturación masiva: ${exitosos} ok, ${fallidos} errores`);

        res.json({
            success: exitosos > 0,
            message: `${exitosos} facturas generadas, ${fallidos} errores`,
            exitosos, fallidos, resultados
        });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en facturarMasivo:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};
