'use strict';
/**
 * notas.helper.js v2.0 — Helper centralizado para Notas de Crédito/Débito
 *
 * v2.0 (2026-03-30) — Flujo completo de mercadería
 *   + Stock: NC devuelve mercadería, ND opcionalmente resta
 *   + CC: Excluye Consumidor Final automáticamente
 *   + Pedido: Estado 10 (Anulado por NC) cuando NC cubre 100%
 *   + Trazabilidad: Resuelve depósito original y vincula id_pedido
 *
 * CODIGOS AFIP: NC-A=3 NC-B=8 NC-C=13 | ND-A=2 ND-B=7 ND-C=12
 *
 * SCOPE — Propiedad y escrituras a tablas
 * ─────────────────────────────────────────────────────────────────────
 * @canonical notas_credito_debito
 * @canonical nota_items
 * @canonical secuencia_notas
 *
 * @writes notas_credito_debito       (INSERT al crear NC/ND, UPDATE estado='anulada')
 * @writes nota_items                 (INSERT por item)
 * @writes secuencia_notas            (UPDATE ultimo_numero, INSERT inicial)
 *
 * @writes-foreign facturas.monto_pagado  (al aplicar NC sobre factura.
 *                                         canónico=facturacion.helper. Coordinado:
 *                                         NC reduce monto_pagado de la factura origen)
 * @writes-foreign facturas.estado        (al aplicar NC: posible cambio a estado
 *                                         'pagada' o 'parcial'. canónico=facturacion.helper)
 *
 * @writes-foreign pedidos.id_estado      (UPDATE estado=10 cuando NC cubre 100%
 *                                         del pedido / UPDATE estado=3 al anular NC,
 *                                         revierte. canónico=pedidos.helper. Flujo
 *                                         opuesto al de facturacion.helper que marca
 *                                         como 'Facturado')
 */

const pool = require('../config/db');
const logger = require('./logger');
const { generarBusquedaMultiPalabra } = require('./busqueda.helper');
const ccClientesHelper = require('./cc-clientes.helper');
const stockHelper = require('./stock.helper');

// ─── CONSTANTES ─────────────────────────────────────────────────────────────

const TIPO_NOTA = { CREDITO: 'credito', DEBITO: 'debito' };
const ESTADO    = { ACTIVA: 'activa', ANULADA: 'anulada' };

const CODIGO_AFIP = {
    credito: { A: '3', B: '8', C: '13' },
    debito:  { A: '2', B: '7', C: '12' },
};

const LETRA_POR_CONDICION = { 1: 'A', 2: 'B', 3: 'B', 4: 'B' };

// ─── HELPERS INTERNOS ────────────────────────────────────────────────────────

function normalizarTipo(tipo) {
    if (!tipo) return null;
    const t = tipo.toString().toUpperCase().trim();
    if (t === 'NC' || t === 'CREDITO') return TIPO_NOTA.CREDITO;
    if (t === 'ND' || t === 'DEBITO')  return TIPO_NOTA.DEBITO;
    return null;
}

function tipoDisplay(tipo_nota) {
    return tipo_nota === TIPO_NOTA.CREDITO ? 'NC' : 'ND';
}

function determinarCodigoAFIP(tipo_nota, letra) {
    const mapa = CODIGO_AFIP[tipo_nota];
    if (!mapa) throw new Error(`tipo_nota inválido: ${tipo_nota}`);
    const cod = mapa[letra?.toUpperCase()];
    if (!cod) throw new Error(`Letra de comprobante inválida: ${letra}`);
    return cod;
}

// ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────

async function obtenerConfigNotas(clientOrPool, id_empresa) {
    const r = await clientOrPool.query(
        `SELECT clave, valor FROM configuraciones_empresa
         WHERE id_empresa = $1 AND clave IN ('notas.nc_devuelve_stock', 'notas.nd_afecta_stock')`,
        [id_empresa]
    );
    const cfg = {};
    for (const row of r.rows) cfg[row.clave] = row.valor;
    return {
        nc_devuelve_stock: cfg['notas.nc_devuelve_stock'] !== 'false',
        nd_afecta_stock:   cfg['notas.nd_afecta_stock'] === 'true',
    };
}

// ─── SECUENCIAS ──────────────────────────────────────────────────────────────

async function obtenerProximoNumero(client, id_empresa, punto_venta, tipo_nota) {
    if (!id_empresa)  throw new Error('id_empresa requerido');
    if (!punto_venta) throw new Error('punto_venta requerido');
    if (!tipo_nota)   throw new Error('tipo_nota requerido');

    // ── Defensa: el próximo número es SIEMPRE max(secuencia+1, max_nota+1) ──
    // Esto evita colisiones cuando secuencia_notas quedó desincronizada (incidentes
    // anteriores, restores parciales, rollback con CAE huerfano, etc).
    const mx = await client.query(
        `SELECT COALESCE(MAX(numero_nota), 0) AS max_real
           FROM notas_credito_debito
          WHERE id_empresa = $1 AND punto_venta = $2 AND tipo_nota = $3`,
        [id_empresa, punto_venta, tipo_nota]
    );
    const maxReal = parseInt(mx.rows[0].max_real, 10);

    // Intentar UPDATE: si la fila existe, incrementar pero NUNCA por debajo del max_real+1
    const upd = await client.query(
        `UPDATE secuencia_notas
            SET ultimo_numero = GREATEST(ultimo_numero + 1, $4 + 1),
                fecha_modificacion = NOW()
          WHERE id_empresa = $1 AND punto_venta = $2 AND tipo_nota = $3
          RETURNING ultimo_numero`,
        [id_empresa, punto_venta, tipo_nota, maxReal]
    );
    if (upd.rows.length > 0) {
        if (upd.rows[0].ultimo_numero <= maxReal) {
            // Por defensa extrema, si por alguna razón quedó <= max_real, forzar
            const fix = await client.query(
                `UPDATE secuencia_notas SET ultimo_numero = $4 + 1, fecha_modificacion = NOW()
                  WHERE id_empresa = $1 AND punto_venta = $2 AND tipo_nota = $3
                  RETURNING ultimo_numero`,
                [id_empresa, punto_venta, tipo_nota, maxReal]
            );
            return fix.rows[0].ultimo_numero;
        }
        return upd.rows[0].ultimo_numero;
    }

    // No existía fila en secuencia_notas: crear con max_real+1
    const sig = maxReal + 1;
    await client.query(
        `INSERT INTO secuencia_notas (id_empresa, punto_venta, tipo_nota, ultimo_numero)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id_empresa, punto_venta, tipo_nota)
         DO UPDATE SET ultimo_numero = GREATEST(secuencia_notas.ultimo_numero, EXCLUDED.ultimo_numero),
                       fecha_modificacion = NOW()`,
        [id_empresa, punto_venta, tipo_nota, sig]
    );
    return sig;
}

async function consultarProximoNumero(id_empresa, punto_venta, tipo_nota) {
    if (!id_empresa || !punto_venta || !tipo_nota) return 1;
    const tn = normalizarTipo(tipo_nota) || tipo_nota;
    const r = await pool.query(
        `SELECT COALESCE(
            (SELECT ultimo_numero + 1 FROM secuencia_notas
              WHERE id_empresa=$1 AND punto_venta=$2 AND tipo_nota=$3),
            COALESCE(
              (SELECT MAX(numero_nota)+1 FROM notas_credito_debito
                WHERE id_empresa=$1 AND punto_venta=$2 AND tipo_nota=$3),
              1
            )
         ) AS proximo_numero`,
        [id_empresa, punto_venta, tn]
    );
    return r.rows[0].proximo_numero;
}

// ─── TRAZABILIDAD ────────────────────────────────────────────────────────────

async function resolverPedidoDesdeFactura(client, id_empresa, id_factura) {
    if (!id_factura) return null;
    const r = await client.query(
        `SELECT id_pedido FROM facturas WHERE id_factura = $1 AND id_empresa = $2`,
        [id_factura, id_empresa]
    );
    return r.rows[0]?.id_pedido || null;
}

async function resolverPedidoDesdePresupuesto(client, id_empresa, id_presupuesto) {
    if (!id_presupuesto) return null;
    const r = await client.query(
        `SELECT id_pedido FROM presupuestos WHERE id_presupuesto = $1 AND id_empresa = $2`,
        [id_presupuesto, id_empresa]
    );
    return r.rows[0]?.id_pedido || null;
}

async function resolverDepositoOriginal(client, id_empresa, id_pedido, reqUsuario) {
    if (id_pedido) {
        const r = await client.query(
            `SELECT DISTINCT id_deposito FROM movimientos_stock_deposito
             WHERE id_pedido = $1 AND id_empresa = $2 AND tipo_movimiento = 'VENTA'
             LIMIT 1`,
            [id_pedido, id_empresa]
        );
        if (r.rows.length > 0) return r.rows[0].id_deposito;
    }
    return await stockHelper.obtenerDepositoUsuario(client, reqUsuario);
}

// ─── OBTENER DATOS DE COMPROBANTE ORIGEN ─────────────────────────────────────

async function obtenerDatosComprobante(tipo, id, id_empresa) {
    if (!['factura', 'presupuesto', 'pedido'].includes(tipo)) {
        throw new Error('tipo debe ser factura, presupuesto o pedido');
    }
    if (!id || !id_empresa) throw new Error('id e id_empresa requeridos');

    if (tipo === 'factura') {
        const fr = await pool.query(
            `SELECT f.id_factura, f.id_cliente, f.id_pedido, f.punto_venta,
                    f.subtotal, f.total_iva, f.total,
                    f.estado, f.cae, f.numero_completo,
                    ft.codigo AS letra,
                    c.razon_social, c.cuit_cuil, c.domicilio, c.telefono,
                    ci.nombre AS condicion_iva, c.id_condicion_iva
               FROM facturas f
               JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
               JOIN clientes c ON f.id_cliente = c.id_cliente
               LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
              WHERE f.id_factura = $1 AND f.id_empresa = $2`,
            [id, id_empresa]
        );
        if (fr.rows.length === 0) throw new Error('Factura no encontrada');
        const factura = fr.rows[0];
        if (factura.estado === 'anulada') throw new Error('La factura está anulada');

        const ir = await pool.query(
            `SELECT fi.id_producto, fi.descripcion, fi.cantidad,
                    fi.precio_unitario, fi.porcentaje_iva AS iva_porcentaje,
                    fi.subtotal, fi.iva_calculado AS iva_monto, fi.total,
                    p.nombre AS producto_nombre, p.sku
               FROM factura_items fi
               LEFT JOIN productos p ON fi.id_producto = p.id_producto
              WHERE fi.id_factura = $1
              ORDER BY fi.numero_linea`,
            [id]
        );

        return {
            tipo: 'factura',
            id_origen: factura.id_factura,
            id_pedido: factura.id_pedido || null,
            numero_comprobante: factura.numero_completo,
            requiere_afip: true,
            tiene_cae_real: factura.cae && !factura.cae.startsWith('OFFLINE'),
            letra: factura.letra,
            punto_venta: factura.punto_venta,
            cliente: {
                id_cliente: factura.id_cliente,
                razon_social: factura.razon_social,
                cuit_cuil: factura.cuit_cuil,
                domicilio: factura.domicilio,
                telefono: factura.telefono,
                condicion_iva: factura.condicion_iva,
                id_condicion_iva: factura.id_condicion_iva,
            },
            totales: {
                subtotal: Number(factura.subtotal),
                iva: Number(factura.total_iva),
                total: Number(factura.total),
            },
            items: ir.rows.map(i => ({
                id_producto: i.id_producto,
                descripcion: i.descripcion || i.producto_nombre,
                cantidad: Number(i.cantidad),
                precio_unitario: Number(i.precio_unitario),
                iva_porcentaje: Number(i.iva_porcentaje || 21),
                subtotal: Number(i.subtotal),
                iva_monto: Number(i.iva_monto),
                total: Number(i.total),
            })),
        };
    }

    if (tipo === 'pedido') {
        const pe = await pool.query(
            `SELECT p.id_pedido, p.id_cliente, p.nro_pedido,
                    p.total_final AS total, p.id_estado,
                    pe.nombre AS estado_pedido,
                    c.razon_social, c.cuit_cuil, c.domicilio, c.telefono,
                    ci.nombre AS condicion_iva, c.id_condicion_iva
               FROM pedidos p
               JOIN pedidoestados pe ON pe.id_estado = p.id_estado
               LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
               LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
              WHERE p.id_pedido = $1 AND p.id_empresa = $2`,
            [id, id_empresa]
        );
        if (pe.rows.length === 0) throw new Error('Pedido no encontrado');
        const ped = pe.rows[0];

        const ir = await pool.query(
            `SELECT pi.id_item AS id_pedido_item, pi.id_producto,
                    pi.cantidad, pi.cantidad_entregada,
                    pi.precio_unitario_congelado AS precio_unitario,
                    COALESCE(pi.iva_aplicado, 21) AS iva_porcentaje,
                    pi.total_linea AS total,
                    COALESCE(NULLIF(prod.descripcion, ''), prod.nombre, '') AS descripcion,
                    prod.sku
               FROM pedidoitems pi
               LEFT JOIN productos prod ON pi.id_producto = prod.id_producto
              WHERE pi.id_pedido = $1
              ORDER BY pi.id_item`,
            [id]
        );

        const letra = LETRA_POR_CONDICION[ped.id_condicion_iva] || 'B';
        let subtotal = 0, ivaTotal = 0;
        const items = ir.rows.map(i => {
            const cant = Number(i.cantidad);
            const pu   = Number(i.precio_unitario);
            const ivaPct = Number(i.iva_porcentaje);
            const sub  = cant * pu;
            const iva  = sub * (ivaPct / 100);
            subtotal += sub;
            ivaTotal += iva;
            return {
                id_producto: i.id_producto,
                descripcion: i.descripcion || (i.sku ? `${i.sku}` : `Producto #${i.id_producto}`),
                cantidad: cant,
                precio_unitario: pu,
                iva_porcentaje: ivaPct,
                subtotal: Math.round(sub * 100) / 100,
                iva_monto: Math.round(iva * 100) / 100,
                total: Number(i.total),
            };
        });

        return {
            tipo: 'pedido',
            id_origen: ped.id_pedido,
            id_pedido: ped.id_pedido,
            numero_comprobante: ped.nro_pedido ? String(ped.nro_pedido) : `#${ped.id_pedido}`,
            requiere_afip: false,
            tiene_cae_real: false,
            letra,
            punto_venta: null,
            estado_pedido: ped.estado_pedido,
            cliente: {
                id_cliente: ped.id_cliente,
                razon_social: ped.razon_social,
                cuit_cuil: ped.cuit_cuil,
                domicilio: ped.domicilio,
                telefono: ped.telefono,
                condicion_iva: ped.condicion_iva,
                id_condicion_iva: ped.id_condicion_iva,
            },
            totales: {
                subtotal: Math.round(subtotal * 100) / 100,
                iva: Math.round(ivaTotal * 100) / 100,
                total: Number(ped.total),
            },
            items,
        };
    }

    // tipo === 'presupuesto'
    const pr = await pool.query(
        `SELECT p.id_presupuesto, p.id_cliente, p.id_pedido,
                p.subtotal, p.iva, p.total,
                p.estado, p.numero_completo,
                c.razon_social, c.cuit_cuil, c.domicilio, c.telefono,
                ci.nombre AS condicion_iva, c.id_condicion_iva
           FROM presupuestos p
           LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
           LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
          WHERE p.id_presupuesto = $1 AND p.id_empresa = $2`,
        [id, id_empresa]
    );
    if (pr.rows.length === 0) throw new Error('Presupuesto no encontrado');
    const pres = pr.rows[0];

    const ir = await pool.query(
        `SELECT pi.id_producto, pi.descripcion, pi.cantidad,
                pi.precio_unitario, pi.iva_porcentaje,
                pi.subtotal, pi.iva_monto, pi.total,
                prod.nombre AS producto_nombre, prod.sku
           FROM presupuesto_items pi
           LEFT JOIN productos prod ON pi.id_producto = prod.id_producto
          WHERE pi.id_presupuesto = $1
          ORDER BY pi.id_item`,
        [id]
    );

    const letra = LETRA_POR_CONDICION[pres.id_condicion_iva] || 'B';

    return {
        tipo: 'presupuesto',
        id_origen: pres.id_presupuesto,
        id_pedido: pres.id_pedido || null,
        numero_comprobante: pres.numero_completo,
        requiere_afip: false,
        tiene_cae_real: false,
        letra,
        punto_venta: null,
        cliente: {
            id_cliente: pres.id_cliente,
            razon_social: pres.razon_social,
            cuit_cuil: pres.cuit_cuil,
            domicilio: pres.domicilio,
            telefono: pres.telefono,
            condicion_iva: pres.condicion_iva,
            id_condicion_iva: pres.id_condicion_iva,
        },
        totales: {
            subtotal: Number(pres.subtotal),
            iva: Number(pres.iva),
            total: Number(pres.total),
        },
        items: ir.rows.map(i => ({
            id_producto: i.id_producto,
            descripcion: i.descripcion || i.producto_nombre,
            cantidad: Number(i.cantidad),
            precio_unitario: Number(i.precio_unitario),
            iva_porcentaje: Number(i.iva_porcentaje || 21),
            subtotal: Number(i.subtotal),
            iva_monto: Number(i.iva_monto),
            total: Number(i.total),
        })),
    };
}

// ─── DISPONIBLE PARA NC (calcula por id_pedido_item) ────────────────────────

/**
 * Devuelve los items del pedido con la cantidad disponible para creditear.
 * disponible = cantidad - cantidad_entregada - SUM(NCs activas)
 */
async function calcularDisponiblePorItem(client, id_empresa, id_pedido) {
    if (!id_pedido) return [];
    const r = await client.query(`
        SELECT
            pi.id_item AS id_pedido_item,
            pi.id_producto,
            pi.cantidad,
            pi.cantidad_entregada,
            pi.precio_unitario_congelado,
            pi.iva_aplicado AS iva_porcentaje,
            pi.descripcion_congelada,
            p.sku,
            p.nombre AS producto_nombre,
            COALESCE((
                SELECT SUM(ni.cantidad)
                  FROM nota_items ni
                  JOIN notas_credito_debito n ON n.id_nota = ni.id_nota
                 WHERE ni.id_pedido_item = pi.id_item
                   AND ni.id_empresa = $2
                   AND n.estado = 'activa'
                   AND n.tipo_nota = 'credito'
            ), 0) AS cantidad_creditada
          FROM pedidoitems pi
          LEFT JOIN productos p ON p.id_producto = pi.id_producto
         WHERE pi.id_pedido = $1 AND pi.id_empresa = $2
         ORDER BY pi.id_item
    `, [id_pedido, id_empresa]);

    return r.rows.map(row => {
        const cantidad           = Number(row.cantidad);
        const cantidad_entregada = Number(row.cantidad_entregada || 0);
        const cantidad_creditada = Number(row.cantidad_creditada || 0);
        return {
            id_pedido_item:     row.id_pedido_item,
            id_producto:        row.id_producto,
            sku:                row.sku,
            descripcion:        row.descripcion_congelada || row.producto_nombre,
            cantidad,
            cantidad_entregada,
            cantidad_creditada,
            disponible:         Math.max(0, cantidad - cantidad_entregada - cantidad_creditada),
            precio_unitario:    Number(row.precio_unitario_congelado),
            iva_porcentaje:     Number(row.iva_porcentaje || 21),
        };
    });
}

async function obtenerTotalPagadoPedido(client, id_empresa, id_pedido) {
    if (!id_pedido) return 0;
    const r = await client.query(
        `SELECT COALESCE(SUM(monto), 0) AS total_pagado
           FROM pagos
          WHERE id_pedido = $1 AND id_empresa = $2 AND id_pago_estado = 2`,
        [id_pedido, id_empresa]
    );
    return Number(r.rows[0].total_pagado || 0);
}

// ─── CREAR NOTA CON ITEMS ────────────────────────────────────────────────────

async function crearNotaConItems(client, datos) {
    const {
        id_empresa, id_cliente, id_usuario, punto_venta,
        motivo, observaciones, items,
        id_factura_origen, id_presupuesto_origen,
        origen, porcentaje_aplicado,
        cae, vencimiento_cae, letra,
        devuelve_stock, id_deposito, id_pedido,
        idempotency_key,
    } = datos;

    const tipo_nota = normalizarTipo(datos.tipo_nota);
    if (!tipo_nota)   throw new Error('tipo_nota debe ser credito/debito o NC/ND');
    if (!id_empresa)  throw new Error('id_empresa requerido');
    if (!id_cliente)  throw new Error('id_cliente requerido');
    if (!id_usuario)  throw new Error('id_usuario requerido');
    if (!punto_venta) throw new Error('punto_venta requerido');
    if (!items || items.length === 0) throw new Error('Debe incluir al menos un item');
    if (!motivo || !motivo.trim()) throw new Error('motivo requerido');

    const origenFinal = origen || 'manual';
    if (!['factura', 'presupuesto', 'manual', 'pedido'].includes(origenFinal)) {
        throw new Error('origen inválido');
    }

    const letraFinal = letra || LETRA_POR_CONDICION[1] || 'B';
    const codigo_tipo = determinarCodigoAFIP(tipo_nota, letraFinal);
    const numero_nota = await obtenerProximoNumero(client, id_empresa, punto_venta, tipo_nota);

    let subtotal = 0, iva_total = 0;
    for (const item of items) {
        const s = Number(item.cantidad) * Number(item.precio_unitario);
        subtotal  += s;
        iva_total += s * (Number(item.iva_porcentaje ?? 21) / 100);
    }
    const total = subtotal + iva_total;

    const nr = await client.query(
        `INSERT INTO notas_credito_debito (
            id_empresa, tipo_nota, codigo_tipo, numero_nota, punto_venta,
            id_cliente, id_usuario, fecha_emision, motivo, subtotal, iva, total,
            observaciones, estado, origen, porcentaje_aplicado,
            id_factura_origen, id_presupuesto_origen,
            cae, vencimiento_cae,
            devuelve_stock, id_deposito, id_pedido,
            idempotency_key
         ) VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,NOW(),$8,$9,$10,$11,
            $12,'activa',$13,$14,
            $15,$16,
            $17,$18,
            $19,$20,$21,
            $22
         ) RETURNING *`,
        [
            id_empresa, tipo_nota, codigo_tipo, numero_nota, punto_venta,
            id_cliente, id_usuario, motivo,
            subtotal.toFixed(2), iva_total.toFixed(2), total.toFixed(2),
            observaciones || null, origenFinal, porcentaje_aplicado || null,
            id_factura_origen     || null,
            id_presupuesto_origen || null,
            cae              || null,
            vencimiento_cae  || null,
            devuelve_stock != null ? devuelve_stock : null,
            id_deposito      || null,
            id_pedido        || null,
            idempotency_key  || null,
        ]
    );
    const nota = nr.rows[0];

    for (const item of items) {
        const s   = Number(item.cantidad) * Number(item.precio_unitario);
        const pct = Number(item.iva_porcentaje ?? 21);
        const iv  = s * (pct / 100);
        await client.query(
            `INSERT INTO nota_items
               (id_empresa, id_nota, id_producto, descripcion,
                cantidad, precio_unitario, subtotal, iva_porcentaje, iva_monto, total,
                id_pedido_item)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                id_empresa, nota.id_nota,
                item.id_producto || null,
                item.descripcion || '',
                item.cantidad, item.precio_unitario,
                s.toFixed(2), pct, iv.toFixed(2), (s + iv).toFixed(2),
                item.id_pedido_item || null,
            ]
        );
    }

    logger.info(
        `Nota ${tipoDisplay(tipo_nota)} #${nota.numero_completo} creada` +
        ` | empresa=${id_empresa} | origen=${origenFinal}` +
        ` | total=$${total.toFixed(2)}` +
        ` | devuelve_stock=${devuelve_stock || false}` +
        ` | deposito=${id_deposito || 'N/A'}` +
        (cae ? ` | CAE=${cae}` : '')
    );
    return nota;
}

// ─── STOCK ───────────────────────────────────────────────────────────────────

async function procesarStockNota(client, params) {
    const { id_empresa, id_deposito, id_usuario, nota, items, tipo_nota } = params;

    if (!id_deposito) {
        logger.warn(`Stock NC/ND: sin depósito, no se procesan movimientos | nota=${nota.id_nota}`);
        return [];
    }

    const esCredito = tipo_nota === TIPO_NOTA.CREDITO;
    const tipoMov = esCredito
        ? stockHelper.TIPOS_MOVIMIENTO.DEVOLUCION_CLIENTE
        : stockHelper.TIPOS_MOVIMIENTO.EGRESO_NOTA_DEBITO;
    const display = tipoDisplay(tipo_nota);
    const movimientos = [];

    for (const item of items) {
        if (!item.id_producto) continue;
        const cantidad = parseFloat(item.cantidad);
        if (!cantidad || cantidad <= 0) continue;

        const tipoMovBOM = esCredito ? stockHelper.TIPOS_MOVIMIENTO.ANULACION : tipoMov;
        const movs = await stockHelper.descontarVenta(client, {
            id_empresa, id_deposito,
            id_producto: item.id_producto,
            cantidad: cantidad,
            tipo_movimiento: tipoMovBOM,
            id_usuario,
            documento_referencia: `${display} ${nota.numero_completo}`,
            observaciones: nota.motivo || null,
            id_pedido: nota.id_pedido || null,
        });
        const mov = movs[0];
        movimientos.push(mov);
    }

    logger.info(
        `Stock ${display} #${nota.numero_completo}: ` +
        `${movimientos.length} productos ${esCredito ? 'ingresados' : 'egresados'} | deposito=${id_deposito}`
    );
    return movimientos;
}

async function revertirStockNota(client, id_empresa, nota, id_usuario) {
    if (!nota.devuelve_stock || !nota.id_deposito) return [];

    const ir = await client.query(
        `SELECT id_producto, cantidad FROM nota_items
         WHERE id_nota = $1 AND id_empresa = $2 AND id_producto IS NOT NULL`,
        [nota.id_nota, id_empresa]
    );

    const esCredito = nota.tipo_nota === TIPO_NOTA.CREDITO;
    const display = tipoDisplay(nota.tipo_nota);
    const movimientos = [];

    for (const item of ir.rows) {
        const cantidad = parseFloat(item.cantidad);
        if (!cantidad || cantidad <= 0) continue;

        const tipoMovRevert = esCredito ? stockHelper.TIPOS_MOVIMIENTO.VENTA : stockHelper.TIPOS_MOVIMIENTO.ANULACION;
        const movs = await stockHelper.descontarVenta(client, {
            id_empresa,
            id_deposito: nota.id_deposito,
            id_producto: item.id_producto,
            cantidad: cantidad,
            tipo_movimiento: tipoMovRevert,
            id_usuario,
            documento_referencia: `Anulación ${display} ${nota.numero_completo}`,
            observaciones: 'Anulación de nota',
        });
        const mov = movs[0];
        movimientos.push(mov);
    }

    logger.info(
        `Stock anulación ${display} #${nota.numero_completo}: ` +
        `${movimientos.length} productos revertidos | deposito=${nota.id_deposito}`
    );
    return movimientos;
}

// ─── CUENTA CORRIENTE ────────────────────────────────────────────────────────

async function registrarEnCuentaCorriente(client, id_empresa, nota) {
    const { id_nota, id_cliente, tipo_nota, total, numero_completo } = nota;

    const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, id_cliente);
    if (esCF) {
        logger.info(`CC Nota: Omitido para Consumidor Final (cliente #${id_cliente}) | ${numero_completo}`);
        return null;
    }

    const monto    = Number(total);
    const esCredito = tipo_nota === TIPO_NOTA.CREDITO;
    const display  = tipoDisplay(tipo_nota);

    const mov = await ccClientesHelper.registrarMovimiento(client, {
        id_empresa, id_cliente, monto,
        tipo: esCredito ? 'haber' : 'debe',
        concepto: `${display} ${numero_completo}`,
        id_nota,
    });
    return Number(mov.saldo);
}

// ─── APLICAR NC A FACTURA ────────────────────────────────────────────────────

async function aplicarNCaFactura(client, id_empresa, id_factura, monto_nc) {
    if (!id_factura) return null;
    const fr = await client.query(
        `SELECT id_factura, total, COALESCE(monto_pagado,0) AS pagado, estado
           FROM facturas WHERE id_factura=$1 AND id_empresa=$2`,
        [id_factura, id_empresa]
    );
    if (fr.rows.length === 0) throw new Error('Factura no encontrada');
    const f = fr.rows[0];
    if (f.estado === 'anulada') throw new Error('No se puede aplicar NC a factura anulada');

    const np = Number(f.pagado) + Number(monto_nc);
    const ne = np >= Number(f.total) ? 'pagada' : 'parcial';
    await client.query(
        `UPDATE facturas SET monto_pagado=$1, estado=$2
          WHERE id_factura=$3 AND id_empresa=$4`,
        [np.toFixed(2), ne, id_factura, id_empresa]
    );
    return { nuevo_pagado: np, nuevo_estado: ne };
}

// ─── ESTADO PEDIDO ───────────────────────────────────────────────────────────

async function evaluarEstadoPedido(client, id_empresa, id_pedido, monto_nc) {
    if (!id_pedido) return null;

    const pr = await client.query(
        `SELECT id_pedido, id_estado, total_final FROM pedidos
         WHERE id_pedido = $1 AND id_empresa = $2`,
        [id_pedido, id_empresa]
    );
    if (pr.rows.length === 0) return null;
    const pedido = pr.rows[0];

    const totalPedido = Number(pedido.total_final);
    const montoNC = Number(monto_nc);
    if (totalPedido <= 0 || montoNC < totalPedido) return null;

    await client.query(
        `UPDATE pedidos SET id_estado = 10 WHERE id_pedido = $1 AND id_empresa = $2`,
        [id_pedido, id_empresa]
    );

    logger.info(`Pedido #${id_pedido} → estado 10 (Anulado por NC) | NC cubrió $${montoNC} de $${totalPedido}`);
    return { id_pedido, estado_anterior: pedido.id_estado, estado_nuevo: 10 };
}

async function revertirEstadoPedido(client, id_empresa, id_pedido) {
    if (!id_pedido) return null;

    const pr = await client.query(
        `SELECT id_estado FROM pedidos WHERE id_pedido = $1 AND id_empresa = $2`,
        [id_pedido, id_empresa]
    );
    if (pr.rows.length === 0) return null;
    if (pr.rows[0].id_estado !== 10) return null;

    await client.query(
        `UPDATE pedidos SET id_estado = 3 WHERE id_pedido = $1 AND id_empresa = $2`,
        [id_pedido, id_empresa]
    );
    logger.info(`Pedido #${id_pedido} → revertido a estado 3 (Facturado) por anulación de NC`);
    return { id_pedido, estado_nuevo: 3 };
}

// ─── ANULAR NOTA ─────────────────────────────────────────────────────────────

async function anularNota(client, id_empresa, id_nota, id_usuario) {
    if (!id_empresa) throw new Error('id_empresa requerido');
    if (!id_nota)    throw new Error('id_nota requerido');

    const nr = await client.query(
        `SELECT * FROM notas_credito_debito WHERE id_nota=$1 AND id_empresa=$2`,
        [id_nota, id_empresa]
    );
    if (nr.rows.length === 0) throw new Error('Nota no encontrada');
    const nota = nr.rows[0];
    if (nota.estado === ESTADO.ANULADA) throw new Error('La nota ya está anulada');

    const tieneCaeReal = nota.cae && !nota.cae.startsWith('OFFLINE');
    if (tieneCaeReal) {
        logger.warn(
            `ANULACION de nota con CAE real: ${nota.numero_completo}` +
            ` | CAE=${nota.cae} | empresa=${id_empresa}`
        );
    }

    await client.query(
        `UPDATE notas_credito_debito SET estado='anulada' WHERE id_nota=$1 AND id_empresa=$2`,
        [id_nota, id_empresa]
    );

    // CC: solo si NO es Consumidor Final
    const esCF = await ccClientesHelper.esConsumidorFinal(client, id_empresa, nota.id_cliente);
    if (!esCF) {
        const esCredito = nota.tipo_nota === TIPO_NOTA.CREDITO;
        const display   = tipoDisplay(nota.tipo_nota);
        await ccClientesHelper.registrarMovimiento(client, {
            id_empresa,
            id_cliente: nota.id_cliente,
            monto: Number(nota.total),
            tipo: esCredito ? 'debe' : 'haber',
            concepto: `Anulación ${display} ${nota.numero_completo}`,
            id_nota,
        });
    }

    // Stock: revertir si movió mercadería
    await revertirStockNota(client, id_empresa, nota, id_usuario);

    // Factura: revertir aplicación
    const esCredito = nota.tipo_nota === TIPO_NOTA.CREDITO;
    if (esCredito && nota.id_factura_origen) {
        const fr = await client.query(
            `SELECT total, COALESCE(monto_pagado,0) AS pagado
               FROM facturas WHERE id_factura=$1 AND id_empresa=$2`,
            [nota.id_factura_origen, id_empresa]
        );
        if (fr.rows.length > 0) {
            const np = Math.max(0, Number(fr.rows[0].pagado) - Number(nota.total));
            const ne = np <= 0
                ? 'emitida'
                : np >= Number(fr.rows[0].total) ? 'pagada' : 'parcial';
            await client.query(
                `UPDATE facturas SET monto_pagado=$1, estado=$2
                  WHERE id_factura=$3 AND id_empresa=$4`,
                [np.toFixed(2), ne, nota.id_factura_origen, id_empresa]
            );
        }
    }

    // Pedido: revertir estado si estaba en 10
    if (esCredito && nota.id_pedido) {
        await revertirEstadoPedido(client, id_empresa, nota.id_pedido);
    }

    logger.info(
        `Nota ${tipoDisplay(nota.tipo_nota)} #${nota.numero_completo} ANULADA` +
        ` | empresa=${id_empresa} | usuario=${id_usuario}`
    );
    return { ...nota, tieneCaeReal };
}

// ─── EVALUAR CIERRE DE PEDIDO POST-NC ────────────────────────────────────────

/**
 * Tras emitir una NC sobre un pedido, evalua si quedo cubierto al 100%
 * (entregado + creditado = cantidad para todos los items) y cierra el pedido.
 *
 * - Si algo se entrego y NC cubrio el resto -> estado configurable (default 6 = Entregado)
 * - Si nada se entrego y NC cubrio todo    -> estado configurable (default 10 = Anulado por NC)
 * - Si quedan items con disponible > 0     -> no toca el pedido
 *
 * Reemplaza el flujo viejo de evaluarEstadoPedido (que se basaba en monto total).
 * evaluarEstadoPedido queda como fallback legacy.
 */
async function evaluarCierrePedido(client, id_empresa, id_pedido) {
    if (!id_pedido) return null;

    const cfgRes = await client.query(
        `SELECT clave, valor FROM configuraciones_empresa
          WHERE id_empresa=$1 AND clave IN (
             'notas.cierra_pedido_al_cubrir_saldo',
             'notas.estado_pedido_post_nc_completa',
             'notas.estado_pedido_post_nc_sin_entrega'
          )`,
        [id_empresa]
    );
    const cfg = Object.fromEntries(cfgRes.rows.map(r => [r.clave, r.valor]));
    if (cfg['notas.cierra_pedido_al_cubrir_saldo'] === 'false') return null;

    const estadoCompleta   = parseInt(cfg['notas.estado_pedido_post_nc_completa']    || '6',  10);
    const estadoSinEntrega = parseInt(cfg['notas.estado_pedido_post_nc_sin_entrega'] || '10', 10);

    const pr = await client.query(
        `SELECT id_estado FROM pedidos WHERE id_pedido=$1 AND id_empresa=$2`,
        [id_pedido, id_empresa]
    );
    if (pr.rows.length === 0) return null;
    const estadoActual = pr.rows[0].id_estado;

    // No tocar estados terminales (6=Entregado, 7=Cancelado, 10=Anulado NC, -2=Descartado, 99=Recuperado)
    if ([6, 7, 10, -2, 99].includes(estadoActual)) return null;

    const items = await calcularDisponiblePorItem(client, id_empresa, id_pedido);
    if (items.length === 0) return null;

    const todosCubiertos = items.every(it => it.disponible === 0);
    if (!todosCubiertos) return null;

    const algoSeEntrego = items.some(it => it.cantidad_entregada > 0);
    const nuevoEstado   = algoSeEntrego ? estadoCompleta : estadoSinEntrega;

    await client.query(
        `UPDATE pedidos SET id_estado = $1, estado_entrega = 'completo'
          WHERE id_pedido = $2 AND id_empresa = $3`,
        [nuevoEstado, id_pedido, id_empresa]
    );

    logger.info(
        `Pedido #${id_pedido} cerrado por NC: estado ${estadoActual} -> ${nuevoEstado}` +
        ` (${algoSeEntrego ? 'entrega + NC parcial' : 'NC total sin entrega'})`
    );
    return {
        id_pedido,
        estado_anterior: estadoActual,
        estado_nuevo:    nuevoEstado,
        algo_se_entrego: algoSeEntrego,
        items_cubiertos: items.length
    };
}

// ─── OBTENER / LISTAR ────────────────────────────────────────────────────────

async function obtenerNotaCompleta(id_empresa, id_nota) {
    const nr = await pool.query(
        `SELECT n.*,
                c.razon_social AS cliente_nombre, c.cuit_cuil AS cliente_cuit,
                c.domicilio AS cliente_domicilio, c.telefono AS cliente_telefono,
                ci.nombre AS cliente_condicion_iva,
                u.nombre AS usuario_nombre,
                f.numero_completo AS factura_origen_numero,
                pr.numero_completo AS presupuesto_origen_numero,
                d.nombre AS deposito_nombre
           FROM notas_credito_debito n
           JOIN clientes c ON n.id_cliente = c.id_cliente AND c.id_empresa = $1
           LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
           JOIN usuarios u ON n.id_usuario = u.id_usuario
           LEFT JOIN facturas f ON n.id_factura_origen = f.id_factura AND f.id_empresa = $1
           LEFT JOIN presupuestos pr ON n.id_presupuesto_origen = pr.id_presupuesto AND pr.id_empresa = $1
           LEFT JOIN depositos d ON n.id_deposito = d.id_deposito
          WHERE n.id_nota = $2 AND n.id_empresa = $1`,
        [id_empresa, id_nota]
    );
    if (nr.rows.length === 0) return null;
    const nota = nr.rows[0];

    const ir = await pool.query(
        `SELECT ni.*, p.nombre AS producto_nombre, p.sku AS producto_codigo
           FROM nota_items ni
           LEFT JOIN productos p ON ni.id_producto = p.id_producto
          WHERE ni.id_nota = $1 AND ni.id_empresa = $2
          ORDER BY ni.id_item`,
        [id_nota, id_empresa]
    );
    nota.items = ir.rows;
    return nota;
}

async function listarNotas(id_empresa, filtros = {}) {
    const { tipo, id_cliente, estado, fecha_desde, fecha_hasta, busqueda, limit, offset } = filtros;

    let where  = 'n.id_empresa = $1';
    const params = [id_empresa];
    let idx = 2;

    if (tipo) {
        const tn = normalizarTipo(tipo);
        where += ` AND n.tipo_nota = $${idx++}`;
        params.push(tn || tipo);
    }
    if (id_cliente) { where += ` AND n.id_cliente = $${idx++}`;    params.push(id_cliente); }
    if (estado)     { where += ` AND n.estado = $${idx++}`;        params.push(estado); }
    if (fecha_desde){ where += ` AND n.fecha_emision >= $${idx++}`;params.push(fecha_desde); }
    if (fecha_hasta){ where += ` AND n.fecha_emision <= $${idx++}::date + interval '1 day'`; params.push(fecha_hasta); }

    if (busqueda) {
        const busq = generarBusquedaMultiPalabra(
            busqueda,
            ['n.numero_completo', 'c.razon_social', 'n.motivo', 'n.observaciones'],
            idx
        );
        if (busq) {
            where += ' AND ' + busq.clausula;
            params.push(...busq.params);
            idx = busq.nextIdx;
        }
    }

    const lim = Math.min(limit || 50, 200);
    const off = offset || 0;

    const cr = await pool.query(
        `SELECT COUNT(*) AS total FROM notas_credito_debito n
         JOIN clientes c ON n.id_cliente = c.id_cliente AND c.id_empresa = $1
         WHERE ${where}`,
        params
    );

    const dr = await pool.query(
        `SELECT n.id_nota, n.tipo_nota, n.codigo_tipo, n.numero_completo,
                n.fecha_emision, n.motivo, n.subtotal, n.iva, n.total,
                n.estado, n.origen, n.cae, n.devuelve_stock,
                n.id_factura_origen, n.id_presupuesto_origen,
                c.razon_social AS cliente_nombre, c.cuit_cuil AS cliente_cuit,
                f.numero_completo AS factura_origen_numero,
                pr.numero_completo AS presupuesto_origen_numero
         FROM notas_credito_debito n
         JOIN clientes c ON n.id_cliente = c.id_cliente AND c.id_empresa = $1
         LEFT JOIN facturas f ON n.id_factura_origen = f.id_factura AND f.id_empresa = $1
         LEFT JOIN presupuestos pr ON n.id_presupuesto_origen = pr.id_presupuesto AND pr.id_empresa = $1
         WHERE ${where}
         ORDER BY n.fecha_emision DESC, n.id_nota DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, lim, off]
    );

    return { data: dr.rows, total: parseInt(cr.rows[0].total), limit: lim, offset: off };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

async function listarPedidosConDisponibleCliente(id_empresa, id_cliente, limit = 30) {
    const q = `
        SELECT p.id_pedido, p.nro_pedido, p.total_final AS total, p.fecha_creacion,
               p.id_estado, pe.nombre AS estado_nombre,
               SUM(GREATEST(pi.cantidad - pi.cantidad_entregada - COALESCE(nc.creditada, 0), 0)) AS unidades_disponibles,
               COUNT(*) FILTER (WHERE (pi.cantidad - pi.cantidad_entregada - COALESCE(nc.creditada, 0)) > 0) AS items_con_disponible
          FROM pedidos p
          JOIN pedidoestados pe ON pe.id_estado = p.id_estado
          JOIN pedidoitems pi ON pi.id_pedido = p.id_pedido
          LEFT JOIN LATERAL (
              SELECT SUM(ni.cantidad) AS creditada
                FROM nota_items ni
                JOIN notas_credito_debito n ON n.id_nota = ni.id_nota
               WHERE ni.id_pedido_item = pi.id_item
                 AND n.estado = 'activa' AND n.tipo_nota = 'credito'
          ) nc ON true
         WHERE p.id_cliente = $1 AND p.id_empresa = $2
           AND p.id_estado NOT IN (7, 10, -1, -2)
         GROUP BY p.id_pedido, p.nro_pedido, p.total_final, p.fecha_creacion, p.id_estado, pe.nombre
        HAVING COUNT(*) FILTER (WHERE (pi.cantidad - pi.cantidad_entregada - COALESCE(nc.creditada, 0)) > 0) > 0
         ORDER BY p.fecha_creacion DESC
         LIMIT $3`;
    const { rows } = await pool.query(q, [id_cliente, id_empresa, limit]);
    return rows.map(r => ({
        id_pedido: r.id_pedido,
        nro_pedido: r.nro_pedido,
        numero_completo: r.nro_pedido ? String(r.nro_pedido) : `#${r.id_pedido}`,
        fecha_creacion: r.fecha_creacion,
        fecha_emision: r.fecha_creacion,
        total: Number(r.total),
        estado: r.estado_nombre,
        id_estado: r.id_estado,
        unidades_disponibles: Number(r.unidades_disponibles || 0),
        items_con_disponible: Number(r.items_con_disponible || 0),
    }));
}

module.exports = {
    TIPO_NOTA, ESTADO, LETRA_POR_CONDICION, CODIGO_AFIP,
    normalizarTipo, tipoDisplay, determinarCodigoAFIP,
    obtenerConfigNotas,
    obtenerProximoNumero, consultarProximoNumero,
    resolverPedidoDesdeFactura, resolverPedidoDesdePresupuesto, resolverDepositoOriginal,
    obtenerDatosComprobante,
    listarPedidosConDisponibleCliente,
    crearNotaConItems, procesarStockNota, revertirStockNota,
    registrarEnCuentaCorriente, aplicarNCaFactura,
    evaluarEstadoPedido, revertirEstadoPedido,
    evaluarCierrePedido, calcularDisponiblePorItem, obtenerTotalPagadoPedido,
    anularNota, obtenerNotaCompleta, listarNotas,
};
