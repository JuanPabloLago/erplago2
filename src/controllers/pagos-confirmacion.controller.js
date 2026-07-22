/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CONTROLADOR DE CONFIRMACIÓN DE PAGOS v2.0 BLINDADO - ERP LAGO
 * MIGRADO FASE 8c: Escrituras via confirmaciones.helper.js + helpers existentes
 * ════════════════════════════════════════════════════════════════════════════════
 */

const pool = require('../config/database');
const cajaHelper = require('../utils/caja.helper');
const pagosHelper = require('../utils/pagos.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const confirmacionesHelper = require('../utils/confirmaciones.helper');

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS LOCALES (solo lectura / lógica)
// ════════════════════════════════════════════════════════════════════════════════

function generarCodigoUnico() {
    const fecha = new Date();
    const fechaStr = fecha.toISOString().replace(/[-T:\.Z]/g, '').slice(2, 14);
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `CONF${fechaStr}${random}`;
}

function formatearNumeroRecibo(numero) {
    return `REC-0001-${String(numero).padStart(8, '0')}`;
}

function obtenerIdMetodoPago(metodo) {
    if (typeof metodo === 'number') return metodo;
    const mapa = { 'efectivo': 1, '1': 1, 'mercadopago': 2, 'mercado_pago': 2, '2': 2, 'transferencia': 3, 'transfer': 3, '3': 3, 'credito': 4, 'tarjeta_credito': 4, '4': 4, 'debito': 5, 'tarjeta_debito': 5, '5': 5, 'cuenta_corriente': 6, 'cuenta_cte': 6, 'cta_cte': 6, '6': 6 };
    return mapa[String(metodo).toLowerCase()] || 1;
}

async function obtenerTurnoAbierto(client, id_empresa) {
    const result = await client.query(`SELECT tc.id_turno, tc.id_caja, c.nombre as nombre_caja FROM turnos_caja tc JOIN cajas c ON tc.id_caja = c.id_caja WHERE tc.estado = 'abierto' AND c.id_empresa = $1 ORDER BY tc.fecha_apertura DESC LIMIT 1`, [id_empresa]);
    return result.rows.length > 0 ? result.rows[0] : null;
}

async function calcularSaldoPedido(client, id_pedido, id_empresa) {
    if (!id_empresa) throw new Error('calcularSaldoPedido: id_empresa requerido');
    const result = await client.query(
        `SELECT COALESCE(p.total_final, p.total) as total, p.es_fiado,
                COALESCE((SELECT SUM(pa.monto) FROM pagos pa WHERE pa.id_pedido = p.id_pedido AND pa.id_empresa = p.id_empresa AND pa.id_pago_estado = 2), 0) as pagado
         FROM pedidos p WHERE p.id_pedido = $1 AND p.id_empresa = $2`, [id_pedido, id_empresa]);
    if (result.rows.length === 0) return null;
    const { total, pagado, es_fiado } = result.rows[0];
    return { total: parseFloat(total), pagado: parseFloat(pagado), fiado: es_fiado ? parseFloat(total) - parseFloat(pagado) : 0, saldo: parseFloat(total) - parseFloat(pagado), es_fiado };
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIRMAR PAGO — MIGRADO A HELPERS
// ════════════════════════════════════════════════════════════════════════════════
const confirmarPago = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_pedido, id_metodo_pago, metodo_pago, referencia_externa, monto, clave, clave_confirmacion } = req.body;

        const claveUsada = clave || clave_confirmacion;
        const metodoUsado = id_metodo_pago || metodo_pago;
        if (!id_pedido || !metodoUsado || !monto) return res.status(400).json({ error: 'Datos incompletos: id_pedido, método de pago y monto son requeridos' });
        if (!claveUsada) return res.status(400).json({ error: 'Clave de confirmación requerida' });
        const montoNumerico = parseFloat(monto);
        if (isNaN(montoNumerico) || montoNumerico <= 0) return res.status(400).json({ error: 'Monto inválido' });
        const idMetodoPago = obtenerIdMetodoPago(metodoUsado);

        await client.query('BEGIN');

        // Verificar clave
        const usuarioResult = await client.query(`SELECT clave_confirmacion_pagos FROM usuarios WHERE id_usuario = $1`, [id_usuario]);
        if (usuarioResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Usuario no encontrado' }); }
        const claveAlmacenada = usuarioResult.rows[0].clave_confirmacion_pagos;
        if (!claveAlmacenada) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'No tiene clave de confirmación configurada.' }); }
        if (claveUsada !== claveAlmacenada) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Clave de confirmación incorrecta' }); }

        // Verificar pedido
        const pedidoResult = await client.query(`SELECT p.id_pedido, p.id_cliente, p.total, p.total_final, c.razon_social FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente WHERE p.id_pedido = $1 AND p.id_empresa = $2`, [id_pedido, id_empresa]);
        if (pedidoResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado' }); }
        const { id_cliente, razon_social } = pedidoResult.rows[0];

        // Saldo real
        const saldoInfo = await calcularSaldoPedido(client, id_pedido, id_empresa);
        const saldoPendiente = saldoInfo.saldo;
        let montoExcedente = 0, esPagoACuenta = false;
        if (montoNumerico > saldoPendiente && saldoPendiente > 0) { montoExcedente = montoNumerico - saldoPendiente; esPagoACuenta = true; }
        else if (saldoPendiente <= 0) { montoExcedente = montoNumerico; esPagoACuenta = true; }

        const turno = await obtenerTurnoAbierto(client, id_empresa);
        const id_turno = turno?.id_turno || null;

        // 1. PAGO via helper existente
        const pagoRegistrado = await pagosHelper.registrarPago(client, {
            id_empresa, id_pedido, id_metodo_pago: idMetodoPago, monto: montoNumerico, id_usuario,
            id_pago_estado: pagosHelper.PAGO_ESTADOS.APROBADO,
            id_transaccion_externa: referencia_externa || null,
            observaciones: esPagoACuenta ? `Confirmación de pago (incluye $${montoExcedente.toFixed(2)} a cuenta)` : 'Confirmación de pago',
            registrar_en_caja: false, registrar_en_cc: false
        });
        const id_pago = pagoRegistrado.id_pago;

        // 2. RECIBO >>> HELPER <<<
        const siguiente = await recibosHelper.proximoNumeroRecibo(client, id_empresa);
        const numeroRecibo = siguiente;
        const metodoNombre = await client.query(`SELECT nombre FROM metodosdepago WHERE id_metodo_pago = $1 AND id_empresa = $2`, [idMetodoPago, id_empresa]);
        const nombreMetodo = metodoNombre.rows[0]?.nombre || 'Pago';

        const recibo = await confirmacionesHelper.crearReciboDesdeConfirmacion(client, {
            id_empresa, id_turno, id_cliente, id_pedido, id_usuario, numero_recibo: numeroRecibo,
            total_recibo: montoNumerico, concepto: `Pago ${nombreMetodo} - Pedido #${id_pedido}`,
            observaciones: referencia_externa ? `Ref: ${referencia_externa}` : null
        });

        // 3. CAJA via helper existente
        let registradoEnCaja = false;
        if (id_turno && idMetodoPago >= 1 && idMetodoPago <= 5) {
            await cajaHelper.registrarMovimiento(client, {
                id_empresa, id_turno, id_usuario, tipo: 'ingreso', id_moneda: 1, monto: montoNumerico,
                concepto: `Cobro Pedido #${id_pedido} - ${razon_social}`,
                id_metodo_pago: idMetodoPago, id_recibo: recibo.id_recibo
            });
            registradoEnCaja = true;
        }

        // 4. CC — si era fiado, solo HABER (cancela DEBE original)
        const pedidoInfo = await client.query(
            'SELECT es_fiado FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2',
            [id_pedido, id_empresa]
        );
        const esFiadoActual = pedidoInfo.rows[0]?.es_fiado === true;

        if (esFiadoActual) {
            const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, id_cliente);
            if (!esCF) {
                await ccClientesHelper.registrarMovimiento(client, {
                    id_empresa, id_cliente, monto: montoNumerico,
                    tipo: 'haber',
                    concepto: 'Cobro Pedido #' + id_pedido + ' - ' + nombreMetodo,
                    id_pago
                });
            }
            // Si saldo queda en 0, desmarcar fiado
            const saldoPost = await calcularSaldoPedido(client, id_pedido, id_empresa);
            if (saldoPost && saldoPost.saldo < 1) {
                await client.query('UPDATE pedidos SET es_fiado = false WHERE id_pedido = $1 AND id_empresa = $2', [id_pedido, id_empresa]);
            }
        } else {
            await ccClientesHelper.registrarVentaConPago(client, {
                id_empresa, id_cliente, id_pedido, id_pago, monto: montoNumerico,
                id_metodo_pago: idMetodoPago, concepto_prefijo: 'Cobro Pedido'
            });
        }

        // 5. SALDO A FAVOR >>> HELPER <<<
        if (montoExcedente > 0 && idMetodoPago !== 6) {
            await confirmacionesHelper.acreditarSaldoFavor(client, { id_empresa, id_cliente, monto: montoExcedente });
        }

        // 6. CONFIRMACIÓN >>> HELPER <<<
        const codigoUnico = generarCodigoUnico();
        await confirmacionesHelper.crearConfirmacion(client, {
            id_empresa, id_pedido, id_pago, codigo_unico: codigoUnico,
            metodo_pago: nombreMetodo.toLowerCase().replace(/\s/g, '_'),
            referencia_externa, monto: montoNumerico, id_usuario_confirma: id_usuario
        });

        const saldoFinal = await calcularSaldoPedido(client, id_pedido, id_empresa);
        await client.query('COMMIT');

        res.json({
            success: true, codigo_confirmacion: codigoUnico, codigo_unico: codigoUnico, id_pago,
            recibo: { id_recibo: recibo.id_recibo, numero_completo: recibo.numero_completo },
            registrado_en_caja: registradoEnCaja, nombre_caja: turno?.nombre_caja || null,
            pago_a_cuenta: esPagoACuenta, monto_excedente: montoExcedente, saldo_pedido: saldoFinal
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error confirmando pago:', error);
        res.status(500).json({ error: 'Error al confirmar pago: ' + error.message });
    } finally { client.release(); }
};

// ════════════════════════════════════════════════════════════════════════════════
// VERIFICAR / LISTAR (solo lectura)
// ════════════════════════════════════════════════════════════════════════════════
const verificarCodigo = async (req, res) => {
    try {
        const { codigo } = req.params; const { id_empresa } = req.usuario;
        const result = await pool.query(`SELECT cp.*, p.total_final, c.razon_social as cliente FROM confirmaciones_pago cp JOIN pedidos p ON cp.id_pedido = p.id_pedido JOIN clientes c ON p.id_cliente = c.id_cliente WHERE cp.codigo_unico = $1 AND cp.id_empresa = $2`, [codigo, id_empresa]);
        if (result.rows.length === 0) return res.json({ existe: false });
        res.json({ existe: true, confirmacion: result.rows[0] });
    } catch (error) { res.status(500).json({ error: 'Error al verificar código' }); }
};

const obtenerPendientesConfirmacion = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const result = await pool.query(`SELECT p.id_pedido, COALESCE(p.total_final, p.total) as total, c.razon_social AS cliente, p.domicilio_entrega, p.fecha_creacion, p.es_fiado, COALESCE((SELECT SUM(pa.monto) FROM pagos pa WHERE pa.id_pedido = p.id_pedido AND pa.id_pago_estado = 2), 0) as total_pagado FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente WHERE p.id_empresa = $1 AND p.tipo_entrega = 'entrega' AND p.id_estado NOT IN (6, 7, 99) AND NOT EXISTS (SELECT 1 FROM confirmaciones_pago cp WHERE cp.id_pedido = p.id_pedido AND cp.estado = 'confirmado') ORDER BY p.fecha_creacion DESC LIMIT 100`, [id_empresa]);
        const pedidos = result.rows.map(p => ({ ...p, saldo_pendiente: parseFloat(p.total) - parseFloat(p.total_pagado) }));
        res.json(pedidos);
    } catch (error) { res.status(500).json({ error: 'Error al obtener pedidos pendientes' }); }
};

const obtenerDetallePedido = async (req, res) => {
    try {
        const { id_empresa } = req.usuario; const { id_pedido } = req.params;
        const pedidoResult = await pool.query(`SELECT p.id_pedido, p.total, p.total_final, p.observaciones, p.fecha_creacion, p.domicilio_entrega, p.estado_entrega, p.tipo_entrega, p.subtotal_sin_iva, p.total_iva, p.descuento_monto, c.razon_social AS cliente, c.domicilio, c.telefono, c.cuit_cuil, pe.nombre AS estado_nombre FROM pedidos p JOIN clientes c ON p.id_cliente = c.id_cliente JOIN pedidoestados pe ON p.id_estado = pe.id_estado WHERE p.id_pedido = $1 AND p.id_empresa = $2`, [id_pedido, id_empresa]);
        if (pedidoResult.rows.length === 0) return res.status(404).json({ error: 'Pedido no encontrado' });
        const itemsResult = await pool.query(`SELECT pi.id_item, pi.cantidad, pi.cantidad_entregada, pi.precio_unitario_congelado, pi.total_linea, pi.iva_aplicado, COALESCE(pi.descripcion_congelada, pr.nombre) AS descripcion FROM pedidoitems pi LEFT JOIN productos pr ON pi.id_producto = pr.id_producto WHERE pi.id_pedido = $1 ORDER BY pi.id_item`, [id_pedido]);
        const pagosResult = await pool.query(`SELECT pa.id_pago, pa.monto, pa.fecha_pago, pa.id_transaccion_externa AS referencia, pa.observaciones, mp.nombre AS metodo, pes.nombre AS estado FROM pagos pa JOIN metodosdepago mp ON pa.id_metodo_pago = mp.id_metodo_pago LEFT JOIN pagoestados pes ON pa.id_pago_estado = pes.id_pago_estado WHERE pa.id_pedido = $1 ORDER BY pa.fecha_pago`, [id_pedido]);
        const confResult = await pool.query(`SELECT codigo_unico, metodo_pago, monto, fecha_confirmacion FROM confirmaciones_pago WHERE id_pedido = $1 AND estado = 'confirmado' ORDER BY fecha_confirmacion DESC`, [id_pedido]);
        const pedido = pedidoResult.rows[0];
        pedido.items = itemsResult.rows; pedido.pagos = pagosResult.rows; pedido.confirmaciones = confResult.rows; pedido.confirmacion = confResult.rows[0] || null;
        const totalReal = parseFloat(pedido.total_final || pedido.total);
        pedido.total_pagado = pagosResult.rows.reduce((sum, p) => sum + parseFloat(p.monto), 0);
        pedido.monto_fiado = pedido.es_fiado ? totalReal - pedido.total_pagado : 0;
        pedido.saldo_pendiente = totalReal - pedido.total_pagado;
        res.json(pedido);
    } catch (error) { res.status(500).json({ error: 'Error al obtener pedido' }); }
};

// ════════════════════════════════════════════════════════════════════════════════
// ANULAR CONFIRMACIÓN — MIGRADO A HELPERS
// ════════════════════════════════════════════════════════════════════════════════
const anularConfirmacion = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa } = req.usuario;
        const { codigo_unico, motivo } = req.body;
        if (!codigo_unico) return res.status(400).json({ error: 'Código de confirmación requerido' });

        await client.query('BEGIN');

        const confResult = await client.query(`SELECT id_confirmacion, id_pago, monto, estado FROM confirmaciones_pago WHERE codigo_unico = $1 AND id_empresa = $2`, [codigo_unico, id_empresa]);
        if (confResult.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Confirmación no encontrada' }); }
        const conf = confResult.rows[0];
        if (conf.estado === 'anulado') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La confirmación ya está anulada' }); }

        // >>> HELPERS <<<
        await confirmacionesHelper.anularPagoDeConfirmacion(client, { id_pago: conf.id_pago, motivo });
        await confirmacionesHelper.anularConfirmacion(client, { id_empresa, id_confirmacion: conf.id_confirmacion });

        await client.query('COMMIT');
        res.json({ success: true, mensaje: 'Confirmación anulada exitosamente' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error anulando confirmación:', error);
        res.status(500).json({ error: 'Error al anular confirmación' });
    } finally { client.release(); }
};

module.exports = { confirmarPago, verificarCodigo, obtenerPendientesConfirmacion, obtenerDetallePedido, anularConfirmacion };
