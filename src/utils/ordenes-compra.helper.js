/**
 * @file ordenes-compra.helper.js
 * @scope enterprise
 * @description Single write point para ordenes_compra y orden_compra_items.
 *
 * REGLAS DE NEGOCIO:
 *  - La OC NO afecta stock (D5).
 *  - La OC NO actualiza producto_proveedor.precio_neto ni costo_vigente.
 *    Eso lo hace el flujo de compra real (compras.helper.crearComprobanteCompleto).
 *  - El precio_estimado de cada item se lee de producto_proveedor.precio_neto
 *    si el caller no lo provee.
 *  - Vinculo con comprobante real: comprobantes_compra.id_orden_compra (FK opcional).
 *    Cuando llega la factura linkeada, el orquestador llama a matchearRecepcionDesdeFactura.
 */

'use strict';

const pool = require('../config/database');

// =============================================================================
// CONSTANTES
// =============================================================================
const OC_ESTADOS = Object.freeze({
    BORRADOR: 'borrador',
    EMITIDA:  'emitida',
    PARCIAL:  'parcial',
    RECIBIDA: 'recibida',
    ANULADA:  'anulada'
});

const TRANSICIONES = Object.freeze({
    borrador: [OC_ESTADOS.EMITIDA, OC_ESTADOS.ANULADA],
    emitida:  [OC_ESTADOS.PARCIAL, OC_ESTADOS.RECIBIDA, OC_ESTADOS.ANULADA],
    parcial:  [OC_ESTADOS.RECIBIDA, OC_ESTADOS.ANULADA],
    recibida: [],
    anulada:  []
});

const ESTADOS_ACTIVOS    = Object.freeze([OC_ESTADOS.EMITIDA, OC_ESTADOS.PARCIAL]);
const ESTADOS_TERMINALES = Object.freeze([OC_ESTADOS.RECIBIDA, OC_ESTADOS.ANULADA]);

// =============================================================================
// VALIDACIONES INTERNAS
// =============================================================================
function _requireEmpresa(id_empresa) {
    if (id_empresa === undefined || id_empresa === null) {
        throw new Error('ordenes-compra.helper: id_empresa es obligatorio');
    }
}
function _requireUsuario(id_usuario) {
    if (id_usuario === undefined || id_usuario === null) {
        throw new Error('ordenes-compra.helper: id_usuario es obligatorio');
    }
}
function _validarTransicion(estadoActual, estadoNuevo) {
    const permitidas = TRANSICIONES[estadoActual] || [];
    if (!permitidas.includes(estadoNuevo)) {
        throw new Error(`ordenes-compra.helper: transicion no permitida ${estadoActual} -> ${estadoNuevo}`);
    }
}
async function _withClient(client, fn) {
    if (client) return await fn(client);
    const own = await pool.connect();
    try {
        await own.query('BEGIN');
        const result = await fn(own);
        await own.query('COMMIT');
        return result;
    } catch (err) {
        try { await own.query('ROLLBACK'); } catch (_) {}
        throw err;
    } finally {
        own.release();
    }
}
async function _obtenerProximoNumero(client, id_empresa) {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [42, id_empresa]);
    const { rows } = await client.query(
        'SELECT numero_secuencia, numero_completo FROM obtener_proximo_numero_oc($1)',
        [id_empresa]
    );
    if (!rows.length) {
        throw new Error('ordenes-compra.helper: obtener_proximo_numero_oc no devolvio fila');
    }
    return rows[0];
}
async function _resolverPrecioNeto(client, id_empresa, id_proveedor, id_producto) {
    const { rows } = await client.query(`
        SELECT precio_neto FROM producto_proveedor
        WHERE id_empresa=$1 AND id_proveedor=$2 AND id_producto=$3 AND activo=true
        LIMIT 1
    `, [id_empresa, id_proveedor, id_producto]);
    return rows.length ? Number(rows[0].precio_neto) : 0;
}

// =============================================================================
// CREACION DE LOTE
// =============================================================================
async function crearLote(id_empresa, params) {
    _requireEmpresa(id_empresa);
    const {
        id_deposito,
        items,
        separar_por_proveedor,
        id_proveedor_unico,
        id_usuario,
        ip,
        observaciones,
        estado_inicial
    } = params || {};
    _requireUsuario(id_usuario);
    if (!id_deposito) throw new Error('ordenes-compra.helper.crearLote: id_deposito obligatorio');
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('ordenes-compra.helper.crearLote: items vacio');
    }
    if (separar_por_proveedor === false && !id_proveedor_unico) {
        throw new Error('ordenes-compra.helper.crearLote: separar_por_proveedor=false requiere id_proveedor_unico');
    }
    for (const it of items) {
        if (!it.id_producto) throw new Error('ordenes-compra.helper.crearLote: item sin id_producto');
        if (!(Number(it.cantidad) > 0)) throw new Error('ordenes-compra.helper.crearLote: cantidad debe ser > 0');
        if (separar_por_proveedor && !it.id_proveedor) {
            throw new Error(`ordenes-compra.helper.crearLote: item ${it.id_producto} sin id_proveedor (modo separar)`);
        }
    }

    return await _withClient(null, async (client) => {
        let estadoArranque = estado_inicial;
        if (!estadoArranque) {
            const { rows } = await client.query(
                "SELECT valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave='ordenes_compra.estado_inicial'",
                [id_empresa]
            );
            estadoArranque = (rows[0] && rows[0].valor) || OC_ESTADOS.BORRADOR;
        }
        if (![OC_ESTADOS.BORRADOR, OC_ESTADOS.EMITIDA].includes(estadoArranque)) {
            estadoArranque = OC_ESTADOS.BORRADOR;
        }

        const grupos = new Map();
        if (separar_por_proveedor) {
            for (const it of items) {
                const k = String(it.id_proveedor);
                if (!grupos.has(k)) grupos.set(k, []);
                grupos.get(k).push(it);
            }
        } else {
            grupos.set(String(id_proveedor_unico), items);
        }

        const ocsCreadas = [];
        for (const [idProvStr, itemsGrupo] of grupos.entries()) {
            const id_proveedor = parseInt(idProvStr, 10);
            const { numero_secuencia, numero_completo } = await _obtenerProximoNumero(client, id_empresa);

            const itemsResueltos = [];
            for (const it of itemsGrupo) {
                let precio = (it.precio_estimado !== undefined && it.precio_estimado !== null && it.precio_estimado !== '')
                    ? Number(it.precio_estimado) : null;
                if (precio === null || isNaN(precio)) {
                    precio = await _resolverPrecioNeto(client, id_empresa, id_proveedor, it.id_producto);
                }
                itemsResueltos.push(Object.assign({}, it, { precio_estimado: precio }));
            }

            let total = 0;
            for (const it of itemsResueltos) {
                total += (Number(it.cantidad) || 0) * (Number(it.precio_estimado) || 0);
            }
            total = Math.round(total * 100) / 100;

            const fechaEmision = (estadoArranque === OC_ESTADOS.EMITIDA) ? new Date() : null;
            const idUsuarioEmision = (estadoArranque === OC_ESTADOS.EMITIDA) ? id_usuario : null;

            const insertOc = await client.query(`
                INSERT INTO ordenes_compra (
                    id_empresa, id_deposito, id_proveedor,
                    id_usuario_creacion, id_usuario_emision,
                    numero_secuencia, numero_completo,
                    fecha_emision, estado, total_estimado, observaciones, ip_creacion
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING id_orden_compra, numero_completo
            `, [
                id_empresa, id_deposito, id_proveedor,
                id_usuario, idUsuarioEmision,
                numero_secuencia, numero_completo,
                fechaEmision, estadoArranque, total, observaciones || null, ip || null
            ]);
            const id_orden_compra = insertOc.rows[0].id_orden_compra;

            for (const it of itemsResueltos) {
                await client.query(`
                    INSERT INTO orden_compra_items (
                        id_orden_compra, id_empresa, id_producto,
                        cantidad, precio_estimado, porcentaje_iva, observaciones
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    id_orden_compra, id_empresa, it.id_producto,
                    Number(it.cantidad),
                    Number(it.precio_estimado) || 0,
                    Number(it.porcentaje_iva) || 0,
                    it.observaciones || null
                ]);
            }

            ocsCreadas.push({
                id_orden_compra,
                numero_completo,
                total,
                items_count: itemsResueltos.length,
                id_proveedor,
                estado: estadoArranque
            });
        }
        return ocsCreadas;
    });
}

// =============================================================================
// EMITIR
// =============================================================================
async function emitir(client, id_empresa, id_orden_compra, id_usuario, ip) {
    _requireEmpresa(id_empresa);
    _requireUsuario(id_usuario);
    if (!id_orden_compra) throw new Error('ordenes-compra.helper.emitir: id_orden_compra obligatorio');
    return await _withClient(client, async (cli) => {
        const { rows } = await cli.query(
            'SELECT estado FROM ordenes_compra WHERE id_orden_compra=$1 AND id_empresa=$2 FOR UPDATE',
            [id_orden_compra, id_empresa]
        );
        if (!rows.length) throw new Error('ordenes-compra.helper.emitir: OC no encontrada');
        _validarTransicion(rows[0].estado, OC_ESTADOS.EMITIDA);
        await cli.query(`
            UPDATE ordenes_compra
            SET estado=$1, fecha_emision=NOW(), id_usuario_emision=$2
            WHERE id_orden_compra=$3 AND id_empresa=$4
        `, [OC_ESTADOS.EMITIDA, id_usuario, id_orden_compra, id_empresa]);
        return { id_orden_compra, estado_nuevo: OC_ESTADOS.EMITIDA };
    });
}

// =============================================================================
// RECIBIR
// =============================================================================
async function recibirItem(client, id_empresa, id_orden_compra, id_orden_compra_item, cantidad_recibida_ahora, id_usuario, ip) {
    _requireEmpresa(id_empresa);
    _requireUsuario(id_usuario);
    if (!id_orden_compra || !id_orden_compra_item) {
        throw new Error('ordenes-compra.helper.recibirItem: id_orden_compra e id_orden_compra_item obligatorios');
    }
    const inc = Number(cantidad_recibida_ahora);
    if (!(inc > 0)) throw new Error('ordenes-compra.helper.recibirItem: cantidad_recibida_ahora debe ser > 0');

    return await _withClient(client, async (cli) => {
        const oc = await cli.query(
            'SELECT estado FROM ordenes_compra WHERE id_orden_compra=$1 AND id_empresa=$2 FOR UPDATE',
            [id_orden_compra, id_empresa]
        );
        if (!oc.rows.length) throw new Error('ordenes-compra.helper.recibirItem: OC no encontrada');
        const estadoActual = oc.rows[0].estado;
        if (![OC_ESTADOS.EMITIDA, OC_ESTADOS.PARCIAL].includes(estadoActual)) {
            throw new Error(`ordenes-compra.helper.recibirItem: estado ${estadoActual} no permite recibir`);
        }
        const it = await cli.query(`
            SELECT cantidad, cantidad_recibida FROM orden_compra_items
            WHERE id_orden_compra_item=$1 AND id_orden_compra=$2 AND id_empresa=$3
            FOR UPDATE
        `, [id_orden_compra_item, id_orden_compra, id_empresa]);
        if (!it.rows.length) throw new Error('ordenes-compra.helper.recibirItem: item no encontrado');

        const cant = Number(it.rows[0].cantidad);
        const recibPrev = Number(it.rows[0].cantidad_recibida);
        const nuevaRecibida = recibPrev + inc;
        if (nuevaRecibida > cant) {
            throw new Error(`ordenes-compra.helper.recibirItem: cantidad recibida (${nuevaRecibida}) excede pedida (${cant})`);
        }
        await cli.query(
            'UPDATE orden_compra_items SET cantidad_recibida=$1 WHERE id_orden_compra_item=$2',
            [nuevaRecibida, id_orden_compra_item]
        );

        const agg = await cli.query(`
            SELECT SUM(cantidad) AS total_pedido, SUM(cantidad_recibida) AS total_recibido
            FROM orden_compra_items
            WHERE id_orden_compra=$1 AND id_empresa=$2
        `, [id_orden_compra, id_empresa]);
        const totalPedido = Number(agg.rows[0].total_pedido);
        const totalRecibido = Number(agg.rows[0].total_recibido);

        let nuevoEstado = estadoActual;
        let fechaCierre = null;
        if (totalRecibido >= totalPedido) {
            nuevoEstado = OC_ESTADOS.RECIBIDA;
            fechaCierre = new Date();
        } else if (totalRecibido > 0) {
            nuevoEstado = OC_ESTADOS.PARCIAL;
        }
        if (nuevoEstado !== estadoActual) {
            await cli.query(`
                UPDATE ordenes_compra
                SET estado=$1, fecha_recepcion_completa=$2
                WHERE id_orden_compra=$3 AND id_empresa=$4
            `, [nuevoEstado, fechaCierre, id_orden_compra, id_empresa]);
        }
        return {
            id_orden_compra, id_orden_compra_item,
            cantidad_recibida_total: nuevaRecibida,
            cantidad_pendiente: cant - nuevaRecibida,
            estado_nuevo: nuevoEstado
        };
    });
}

async function recibirLote(client, id_empresa, id_orden_compra, items_recepcion, id_usuario, ip) {
    _requireEmpresa(id_empresa);
    _requireUsuario(id_usuario);
    if (!Array.isArray(items_recepcion) || items_recepcion.length === 0) {
        throw new Error('ordenes-compra.helper.recibirLote: items_recepcion vacio');
    }
    return await _withClient(client, async (cli) => {
        const resultados = [];
        for (const r of items_recepcion) {
            const res = await recibirItem(cli, id_empresa, id_orden_compra, r.id_orden_compra_item, r.cantidad, id_usuario, ip);
            resultados.push(res);
        }
        return resultados;
    });
}

// =============================================================================
// MATCHEO AUTOMATICO desde flujo compras.helper.crearComprobanteCompleto
// =============================================================================
async function matchearRecepcionDesdeFactura(client, id_empresa, id_orden_compra, items_factura, id_usuario, ip) {
    _requireEmpresa(id_empresa);
    _requireUsuario(id_usuario);
    if (!id_orden_compra) throw new Error('ordenes-compra.helper.matchearRecepcionDesdeFactura: id_orden_compra obligatorio');
    if (!Array.isArray(items_factura) || !items_factura.length) return [];

    const pendR = await client.query(`
        SELECT id_orden_compra_item, id_producto, cantidad, cantidad_recibida,
               (cantidad - cantidad_recibida) AS pendiente
        FROM orden_compra_items
        WHERE id_orden_compra=$1 AND id_empresa=$2 AND cantidad_recibida < cantidad
        FOR UPDATE
    `, [id_orden_compra, id_empresa]);

    const pendByProd = new Map();
    pendR.rows.forEach(r => {
        if (!pendByProd.has(r.id_producto)) pendByProd.set(r.id_producto, []);
        pendByProd.get(r.id_producto).push(r);
    });

    const aplicaciones = [];
    for (const itf of items_factura) {
        if (!itf.id_producto) continue;
        let restante = Number(itf.cantidad) || 0;
        const cola = pendByProd.get(itf.id_producto) || [];
        for (const itc of cola) {
            if (restante <= 0) break;
            const pendiente = Number(itc.pendiente);
            const aplicar = Math.min(restante, pendiente);
            if (aplicar > 0) {
                await recibirItem(client, id_empresa, id_orden_compra, itc.id_orden_compra_item, aplicar, id_usuario, ip);
                aplicaciones.push({ id_orden_compra_item: itc.id_orden_compra_item, cantidad_aplicada: aplicar });
                itc.pendiente = pendiente - aplicar;
                restante -= aplicar;
            }
        }
    }
    return aplicaciones;
}

// =============================================================================
// ANULAR
// =============================================================================
async function anular(client, id_empresa, id_orden_compra, motivo, id_usuario, ip) {
    _requireEmpresa(id_empresa);
    _requireUsuario(id_usuario);
    if (!id_orden_compra) throw new Error('ordenes-compra.helper.anular: id_orden_compra obligatorio');
    if (!motivo || !motivo.trim()) throw new Error('ordenes-compra.helper.anular: motivo obligatorio');
    return await _withClient(client, async (cli) => {
        const { rows } = await cli.query(
            'SELECT estado FROM ordenes_compra WHERE id_orden_compra=$1 AND id_empresa=$2 FOR UPDATE',
            [id_orden_compra, id_empresa]
        );
        if (!rows.length) throw new Error('ordenes-compra.helper.anular: OC no encontrada');
        _validarTransicion(rows[0].estado, OC_ESTADOS.ANULADA);
        await cli.query(`
            UPDATE ordenes_compra
            SET estado=$1, fecha_anulacion=NOW(),
                id_usuario_anulacion=$2, motivo_anulacion=$3
            WHERE id_orden_compra=$4 AND id_empresa=$5
        `, [OC_ESTADOS.ANULADA, id_usuario, motivo.trim(), id_orden_compra, id_empresa]);
        return { id_orden_compra, estado_nuevo: OC_ESTADOS.ANULADA };
    });
}

// =============================================================================
// LECTURAS
// =============================================================================
async function obtenerOC(id_empresa, id_orden_compra) {
    _requireEmpresa(id_empresa);
    const { rows } = await pool.query(`
        SELECT
            oc.*,
            p.razon_social    AS proveedor_razon_social,
            p.cuit            AS proveedor_cuit,
            d.nombre          AS deposito_nombre,
            COALESCE(uc.nombre, uc.username) AS creado_por,
            COALESCE(ue.nombre, ue.username) AS emitido_por,
            COALESCE(ua.nombre, ua.username) AS anulado_por
        FROM ordenes_compra oc
        LEFT JOIN proveedores p ON p.id_proveedor=oc.id_proveedor AND p.id_empresa=oc.id_empresa
        LEFT JOIN depositos   d ON d.id_deposito=oc.id_deposito  AND d.id_empresa=oc.id_empresa
        LEFT JOIN usuarios   uc ON uc.id_usuario=oc.id_usuario_creacion
        LEFT JOIN usuarios   ue ON ue.id_usuario=oc.id_usuario_emision
        LEFT JOIN usuarios   ua ON ua.id_usuario=oc.id_usuario_anulacion
        WHERE oc.id_orden_compra=$1 AND oc.id_empresa=$2
    `, [id_orden_compra, id_empresa]);
    if (!rows.length) return null;
    const oc = rows[0];
    const itemsR = await pool.query(`
        SELECT
            oci.*,
            pr.sku, pr.nombre, pp.codigo_proveedor,
            (oci.cantidad - oci.cantidad_recibida) AS cantidad_pendiente,
            (oci.cantidad * oci.precio_estimado)   AS subtotal_estimado
        FROM orden_compra_items oci
        JOIN productos pr ON pr.id_producto=oci.id_producto
        LEFT JOIN producto_proveedor pp ON pp.id_producto=oci.id_producto AND pp.id_proveedor=$3 AND pp.id_empresa=oci.id_empresa
        WHERE oci.id_orden_compra=$1 AND oci.id_empresa=$2
        ORDER BY oci.id_orden_compra_item
    `, [id_orden_compra, id_empresa, oc.id_proveedor]);
    oc.items = itemsR.rows;
    return oc;
}

async function listar(id_empresa, filtros) {
    _requireEmpresa(id_empresa);
    const f = filtros || {};
    const where = ['oc.id_empresa = $1'];
    const params = [id_empresa];
    let i = 1;
    if (f.estado)       { params.push(f.estado);       i++; where.push(`oc.estado = $${i}`); }
    if (f.id_proveedor) { params.push(f.id_proveedor); i++; where.push(`oc.id_proveedor = $${i}`); }
    if (f.id_deposito)  { params.push(f.id_deposito);  i++; where.push(`oc.id_deposito = $${i}`); }
    if (f.fecha_desde)  { params.push(f.fecha_desde);  i++; where.push(`oc.fecha_creacion >= $${i}`); }
    if (f.fecha_hasta)  { params.push(f.fecha_hasta);  i++; where.push(`oc.fecha_creacion <= ($${i}::date + INTERVAL '1 day')`); }
    if (f.q) {
        params.push('%' + String(f.q).trim() + '%'); i++;
        where.push(`(oc.numero_completo ILIKE $${i} OR p.razon_social ILIKE $${i} OR COALESCE(oc.observaciones,'') ILIKE $${i})`);
    }
    const limit  = Math.min(parseInt(f.limit, 10) || 50, 500);
    const offset = parseInt(f.offset, 10) || 0;
    params.push(limit, offset);

    const sql = `
        SELECT
            oc.id_orden_compra, oc.numero_completo, oc.estado,
            oc.fecha_creacion, oc.fecha_emision, oc.fecha_recepcion_completa, oc.fecha_anulacion,
            oc.total_estimado, oc.observaciones,
            oc.id_deposito, d.nombre AS deposito_nombre,
            oc.id_proveedor, p.razon_social AS proveedor_razon_social,
            (SELECT COUNT(*) FROM orden_compra_items WHERE id_orden_compra=oc.id_orden_compra) AS items_count
        FROM ordenes_compra oc
        LEFT JOIN proveedores p ON p.id_proveedor=oc.id_proveedor AND p.id_empresa=oc.id_empresa
        LEFT JOIN depositos   d ON d.id_deposito=oc.id_deposito  AND d.id_empresa=oc.id_empresa
        WHERE ${where.join(' AND ')}
        ORDER BY oc.fecha_creacion DESC, oc.id_orden_compra DESC
        LIMIT $${i+1} OFFSET $${i+2}
    `;
    const { rows } = await pool.query(sql, params);

    const sqlCount = `
        SELECT COUNT(*)::int AS total
        FROM ordenes_compra oc
        LEFT JOIN proveedores p ON p.id_proveedor=oc.id_proveedor AND p.id_empresa=oc.id_empresa
        WHERE ${where.join(' AND ')}
    `;
    const cnt = await pool.query(sqlCount, params.slice(0, i));
    return { ordenes: rows, total: cnt.rows[0].total, limit, offset };
}

async function obtenerOCsActivasDeProducto(id_empresa, id_producto) {
    _requireEmpresa(id_empresa);
    if (!id_producto) throw new Error('ordenes-compra.helper: id_producto obligatorio');
    const { rows } = await pool.query(`
        SELECT * FROM v_ordenes_compra_activas_por_producto
        WHERE id_empresa=$1 AND id_producto=$2
        ORDER BY fecha_emision DESC NULLS LAST, id_orden_compra DESC
    `, [id_empresa, id_producto]);
    return rows;
}

async function calcularReposicion(id_empresa, params) {
    _requireEmpresa(id_empresa);
    const { id_deposito, filtros_aplicados, ids_productos } = params || {};
    if (!id_deposito) throw new Error('ordenes-compra.helper.calcularReposicion: id_deposito obligatorio');

    const cfg = await pool.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave='inventario.cantidad_reposicion_formula'",
        [id_empresa]
    );
    const formula = (cfg.rows[0] && cfg.rows[0].valor) || 'max_menos_disponible';

    const conds = ['id_p.id_empresa = $1', 'id_p.id_deposito = $2', 'p.activo = true'];
    const args = [id_empresa, id_deposito];
    let i = 2;

    const f = filtros_aplicados || {};
    if (f.id_marca)        { args.push(f.id_marca);        i++; conds.push(`p.id_marca = $${i}`); }
    if (f.id_categoria)    { args.push(f.id_categoria);    i++; conds.push(`p.id_categoria = $${i}`); }
    if (f.id_subcategoria) { args.push(f.id_subcategoria); i++; conds.push(`p.id_subcategoria = $${i}`); }
    if (f.id_proveedor) {
        args.push(f.id_proveedor); i++;
        conds.push(`EXISTS (SELECT 1 FROM producto_proveedor pp WHERE pp.id_producto=p.id_producto AND pp.id_proveedor=$${i} AND pp.id_empresa=$1 AND pp.activo=true)`);
    }
    if (Array.isArray(ids_productos) && ids_productos.length) {
        args.push(ids_productos); i++;
        conds.push(`p.id_producto = ANY($${i}::int[])`);
    }
    if (f.q) {
        args.push('%' + String(f.q).trim() + '%'); i++;
        conds.push(`(p.sku ILIKE $${i} OR p.nombre ILIKE $${i})`);
    }

    const dispExpr = (formula === 'max_menos_real')
        ? 'COALESCE(id_p.stock_real, 0)'
        : '(COALESCE(id_p.stock_real, 0) - COALESCE(id_p.stock_comprometido, 0))';

    if (f.soloBajoMinimo !== false) {
        conds.push('COALESCE(id_p.stock_minimo, 0) > 0');
        conds.push(`${dispExpr} < COALESCE(id_p.stock_minimo, 0)`);
    }

    const sql = `
        SELECT
            p.id_producto, p.sku, p.nombre,
            p.id_marca,     m.nombre AS marca,
            p.id_categoria, c.nombre AS categoria,
            COALESCE(id_p.stock_real, 0)         AS stock_real,
            COALESCE(id_p.stock_comprometido, 0) AS stock_comprometido,
            (${dispExpr})                        AS stock_disponible,
            COALESCE(id_p.stock_minimo, 0)       AS stock_minimo,
            COALESCE(id_p.stock_maximo, 0)       AS stock_maximo,
            GREATEST(
                COALESCE(id_p.stock_maximo, 0) - (${dispExpr}),
                COALESCE(id_p.stock_minimo, 0) - (${dispExpr})
            )                                    AS cantidad_sugerida,
            COALESCE(inv.costo_vigente, 0)       AS costo_vigente,
            (
                SELECT pp.id_proveedor FROM producto_proveedor pp
                WHERE pp.id_empresa=$1 AND pp.id_producto=p.id_producto AND pp.activo=true
                ORDER BY pp.es_proveedor_preferido DESC NULLS LAST, pp.id_proveedor
                LIMIT 1
            ) AS id_proveedor_sugerido,
            (
                SELECT pr.razon_social FROM producto_proveedor pp
                JOIN proveedores pr ON pr.id_proveedor=pp.id_proveedor AND pr.id_empresa=pp.id_empresa
                WHERE pp.id_empresa=$1 AND pp.id_producto=p.id_producto AND pp.activo=true
                ORDER BY pp.es_proveedor_preferido DESC NULLS LAST, pp.id_proveedor
                LIMIT 1
            ) AS proveedor_sugerido_razon_social,
            (
                SELECT pp.precio_neto FROM producto_proveedor pp
                WHERE pp.id_empresa=$1 AND pp.id_producto=p.id_producto AND pp.activo=true
                ORDER BY pp.es_proveedor_preferido DESC NULLS LAST, pp.id_proveedor
                LIMIT 1
            ) AS precio_neto_sugerido
        FROM productos p
        LEFT JOIN inventario_deposito id_p
            ON id_p.id_producto = p.id_producto
           AND id_p.id_empresa  = $1
           AND id_p.id_deposito = $2
        LEFT JOIN inventario inv
            ON inv.id_producto = p.id_producto AND inv.id_empresa = $1
        LEFT JOIN marcas m     ON m.id_marca     = p.id_marca
        LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
        WHERE ${conds.join(' AND ')}
        ORDER BY p.nombre
        LIMIT 500
    `;
    const { rows } = await pool.query(sql, args);
    return { formula_aplicada: formula, productos: rows };
}

async function obtenerParaImprimir(id_empresa, id_orden_compra) {
    _requireEmpresa(id_empresa);
    const oc = await obtenerOC(id_empresa, id_orden_compra);
    if (!oc) return null;
    const cfgEmpresa = await pool.query(
        "SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave LIKE 'empresa.%'",
        [id_empresa]
    );
    const empresa = {};
    cfgEmpresa.rows.forEach(r => { empresa[r.clave.replace('empresa.', '')] = r.valor; });
    return { oc, empresa };
}

async function obtenerParaExportarExcel(id_empresa, filtros) {
    _requireEmpresa(id_empresa);
    const f = Object.assign({}, filtros || {}, { limit: 10000, offset: 0 });
    const { ordenes } = await listar(id_empresa, f);
    return ordenes;
}

module.exports = {
    OC_ESTADOS, TRANSICIONES, ESTADOS_ACTIVOS, ESTADOS_TERMINALES,
    crearLote, emitir, recibirItem, recibirLote,
    matchearRecepcionDesdeFactura, anular,
    obtenerOC, listar, obtenerOCsActivasDeProducto,
    calcularReposicion, obtenerParaImprimir, obtenerParaExportarExcel
};
