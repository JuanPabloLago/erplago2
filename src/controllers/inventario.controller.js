const pool = require('../config/database');
const stockHelper = require('../utils/stock.helper');
const ocHelper = require('../utils/ordenes-compra.helper');
const path = require('path');
const Handlebars = require('handlebars');
const invPrintHelper = require('../utils/inventario-print.helper');
const fs = require('fs').promises;
const { TIPOS_MOVIMIENTO } = require('../utils/stock.helper');

/**
 * ═══════════════════════════════════════════════════════════════════════
 * INVENTARIO CONTROLLER - ERP LAGO (REFACTOREADO 2026-02-24)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * REGLA: TODAS las lecturas de stock van contra inventario_deposito.
 * REGLA: TODAS las escrituras pasan por stock.helper.moverStock()
 * ═══════════════════════════════════════════════════════════════════════
 */

const inventarioController = {

    async listarDepositos(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const { rows } = await pool.query(`
                SELECT d.id_deposito, d.codigo, d.nombre, d.es_principal, d.activo, d.direccion,
                    (SELECT COUNT(*) FROM inventario_deposito id
                     WHERE id.id_deposito = d.id_deposito AND id.id_empresa = $1 AND id.stock_real > 0
                    ) as productos_con_stock,
                    (SELECT COALESCE(SUM(id.stock_real), 0) FROM inventario_deposito id
                     WHERE id.id_deposito = d.id_deposito AND id.id_empresa = $1
                    ) as stock_total
                FROM depositos d
                WHERE d.id_empresa = $1 AND d.activo = true
                ORDER BY d.es_principal DESC, d.nombre
            `, [id_empresa]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error listar depósitos:', error.message);
            res.status(500).json({ error: 'Error al listar depósitos' });
        }
    },

    async obtenerCompleto(req, res) {
        const { id_empresa } = req.usuario;
        let { id_deposito } = req.query;
        try {
            if (!id_deposito) {
                const depR = await pool.query(
                    'SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true AND activo = true LIMIT 1',
                    [id_empresa]
                );
                if (depR.rows.length === 0) return res.status(400).json({ error: 'No hay depósito principal configurado' });
                id_deposito = depR.rows[0].id_deposito;
            }
            // Bloque 7.3b: el SELECT trae id_subcategoria + subcategoria_nombre para el filtrado client-side y futuro render
            const query = `
                SELECT p.id_producto, p.sku, p.nombre, p.id_marca, m.nombre as marca_nombre,
                    p.id_categoria, c.nombre as categoria_nombre,
                    p.id_subcategoria, cs.nombre as subcategoria_nombre,
                    p.activo,
                    COALESCE(id.stock_real, 0) as stock_real,
                    COALESCE(id.stock_minimo, 0) as stock_minimo,
                    COALESCE(id.stock_maximo, 0) as stock_maximo,
                    $2::int as id_deposito
                FROM productos p
                LEFT JOIN inventario_deposito id ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                LEFT JOIN categorias cs ON p.id_subcategoria = cs.id_categoria
                WHERE p.activo = TRUE ORDER BY p.nombre
            `;
            const { rows } = await pool.query(query, [id_empresa, parseInt(id_deposito)]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener inventario:', error.message);
            res.status(500).json({ error: 'Error al obtener inventario' });
        }
    },

    async ajustarStock(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_producto, nuevo_stock, motivo, id_deposito } = req.body;
        if (!id_producto || nuevo_stock === undefined) return res.status(400).json({ error: 'id_producto y nuevo_stock son requeridos' });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const depositoFinal = id_deposito ? parseInt(id_deposito) : await stockHelper.obtenerDepositoUsuario(client, req.usuario);
            const saR = await client.query('SELECT COALESCE(stock_real, 0) as stock_real FROM inventario_deposito WHERE id_empresa = $1 AND id_deposito = $2 AND id_producto = $3', [id_empresa, depositoFinal, id_producto]);
            const stockAnterior = parseFloat(saR.rows[0]?.stock_real || 0);
            const stockNuevo = parseFloat(nuevo_stock);
            const diferencia = stockNuevo - stockAnterior;
            if (diferencia === 0) { await client.query('ROLLBACK'); return res.json({ success: true, message: 'Stock sin cambios', stock_anterior: stockAnterior, stock_nuevo: stockNuevo, diferencia: 0 }); }
            // Generar documento de referencia atomico
            const arSeq = await client.query("SELECT nextval('seq_ajuste_rapido') as num");
            const docRef = 'AR-' + String(arSeq.rows[0].num).padStart(8, '0');
            await stockHelper.moverStock(client, { id_empresa, id_deposito: depositoFinal, id_producto: parseInt(id_producto), cantidad: diferencia, id_usuario, tipo_movimiento: TIPOS_MOVIMIENTO.AJUSTE_RAPIDO, documento_referencia: docRef, observaciones: motivo || 'Ajuste rápido desde inventario' });
            await client.query('COMMIT');
            res.json({ success: true, message: 'Stock actualizado', documento_referencia: docRef, stock_anterior: stockAnterior, stock_nuevo: stockNuevo, diferencia });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error al ajustar stock:', error.message);
            res.status(500).json({ error: 'Error al ajustar stock' });
        } finally { client.release(); }
    },

        async obtenerPorProducto(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id_producto);
        let { id_deposito } = req.query;
        try {
            if (!id_deposito) {
                const depR = await pool.query('SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true AND activo = true LIMIT 1', [id_empresa]);
                id_deposito = depR.rows[0]?.id_deposito;
            }
            const query = `
                SELECT p.id_producto, p.sku, p.nombre,
                    COALESCE(id.stock_real, 0) as stock_real,
                    COALESCE(id.stock_minimo, 0) as stock_minimo,
                    COALESCE(id.stock_maximo, 0) as stock_maximo,
                    $2::int as id_deposito
                FROM productos p
                LEFT JOIN inventario_deposito id ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                WHERE p.id_producto = $3
            `;
            const { rows } = await pool.query(query, [id_empresa, parseInt(id_deposito), id_producto]);
            if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Error al obtener stock:', error.message);
            res.status(500).json({ error: 'Error al obtener stock' });
        }
    },

    async obtenerStockMultiDeposito(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id_producto);
        try {
            const { rows } = await pool.query(`
                SELECT d.id_deposito, d.codigo, d.nombre as deposito_nombre, d.es_principal,
                    COALESCE(id.stock_real, 0) as stock_real
                FROM depositos d
                LEFT JOIN inventario_deposito id ON d.id_deposito = id.id_deposito AND id.id_producto = $2 AND id.id_empresa = $1
                WHERE d.id_empresa = $1 AND d.activo = true ORDER BY d.es_principal DESC, d.nombre
            `, [id_empresa, id_producto]);
            const prodR = await pool.query('SELECT sku, nombre FROM productos WHERE id_producto = $1', [id_producto]);
            res.json({ producto: prodR.rows[0] || {}, depositos: rows, stock_total: rows.reduce((s, r) => s + parseFloat(r.stock_real), 0) });
        } catch (error) {
            console.error('❌ Error stock multi-depósito:', error.message);
            res.status(500).json({ error: 'Error al obtener stock por depósitos' });
        }
    },

    async obtenerMovimientos(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id_producto);
        const { id_deposito, limite = 50 } = req.query;
        try {
            let query, params;
            if (id_deposito) {
                query = `SELECT msd.*, u.nombre as usuario_nombre, d.nombre as deposito_nombre
                    FROM movimientos_stock_deposito msd
                    LEFT JOIN usuarios u ON msd.id_usuario = u.id_usuario
                    LEFT JOIN depositos d ON msd.id_deposito = d.id_deposito
                    WHERE msd.id_empresa = $1 AND msd.id_producto = $2 AND msd.id_deposito = $3
                    ORDER BY msd.created_at DESC LIMIT $4`;
                params = [id_empresa, id_producto, parseInt(id_deposito), parseInt(limite)];
            } else {
                query = `SELECT ms.*, u.nombre as usuario_nombre
                    FROM movimientos_stock ms LEFT JOIN usuarios u ON ms.id_usuario = u.id_usuario
                    WHERE ms.id_empresa = $1 AND ms.id_producto = $2
                    ORDER BY ms.fecha_movimiento DESC LIMIT $3`;
                params = [id_empresa, id_producto, parseInt(limite)];
            }
            const { rows } = await pool.query(query, params);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener movimientos:', error.message);
            res.status(500).json({ error: 'Error al obtener movimientos' });
        }
    },

    async alertasBajoMinimo(req, res) {
        const { id_empresa } = req.usuario;
        let { id_deposito } = req.query;
        try {
            if (!id_deposito) {
                const depR = await pool.query('SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true AND activo = true LIMIT 1', [id_empresa]);
                id_deposito = depR.rows[0]?.id_deposito;
            }
            const query = `
                SELECT p.id_producto, p.sku, p.nombre, m.nombre as marca_nombre,
                    id.stock_real, id.stock_minimo, (id.stock_minimo - id.stock_real) as faltante
                FROM productos p
                JOIN inventario_deposito id ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                WHERE p.activo = TRUE AND id.stock_real < id.stock_minimo AND id.stock_minimo > 0
                ORDER BY (id.stock_minimo - id.stock_real) DESC
            `;
            const { rows } = await pool.query(query, [id_empresa, parseInt(id_deposito)]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener alertas:', error.message);
            res.status(500).json({ error: 'Error al obtener alertas' });
        }
    },

    async alertasSinStock(req, res) {
        const { id_empresa } = req.usuario;
        let { id_deposito } = req.query;
        try {
            if (!id_deposito) {
                const depR = await pool.query('SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = true AND activo = true LIMIT 1', [id_empresa]);
                id_deposito = depR.rows[0]?.id_deposito;
            }
            const query = `
                SELECT p.id_producto, p.sku, p.nombre, m.nombre as marca_nombre, c.nombre as categoria_nombre,
                    COALESCE(id.stock_real, 0) as stock_real
                FROM productos p
                LEFT JOIN inventario_deposito id ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                WHERE p.activo = TRUE AND COALESCE(id.stock_real, 0) <= 0
                ORDER BY p.nombre
            `;
            const { rows } = await pool.query(query, [id_empresa, parseInt(id_deposito)]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener sin stock:', error.message);
            res.status(500).json({ error: 'Error al obtener productos sin stock' });
        }
    },

    async transferirStock(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_deposito_origen, id_deposito_destino, items, motivo } = req.body;
        if (!id_deposito_origen || !id_deposito_destino) return res.status(400).json({ error: 'Debe indicar depósito origen y destino' });
        if (parseInt(id_deposito_origen) === parseInt(id_deposito_destino)) return res.status(400).json({ error: 'Origen y destino deben ser diferentes' });
        if (!items || items.length === 0) return res.status(400).json({ error: 'Debe incluir al menos un producto' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const deps = await client.query(
                'SELECT id_deposito, nombre FROM depositos WHERE id_empresa = $1 AND id_deposito IN ($2, $3) AND activo = true',
                [id_empresa, parseInt(id_deposito_origen), parseInt(id_deposito_destino)]
            );
            if (deps.rows.length !== 2) throw { statusCode: 400, message: 'Uno o ambos depósitos no son válidos' };

            const nOrigen = deps.rows.find(d => d.id_deposito === parseInt(id_deposito_origen))?.nombre;
            const nDestino = deps.rows.find(d => d.id_deposito === parseInt(id_deposito_destino))?.nombre;
            const trf_seq = await client.query(
                "SELECT nextval('seq_transferencias') as num"
            );
            const transferId = 'TRF-' + String(trf_seq.rows[0].num).padStart(8, '0');
            const resultados = [];
            let itemsOk = 0;

            for (const item of items) {
                const idp = parseInt(item.id_producto);
                const cant = parseFloat(item.cantidad);
                if (!idp || !cant || cant <= 0) { resultados.push({ id_producto: idp, error: 'Cantidad inválida', transferido: false }); continue; }

                const stk = await client.query(
                    'SELECT COALESCE(stock_real, 0) as stock_real FROM inventario_deposito WHERE id_empresa = $1 AND id_deposito = $2 AND id_producto = $3',
                    [id_empresa, parseInt(id_deposito_origen), idp]
                );
                const disp = parseFloat(stk.rows[0]?.stock_real || 0);
                if (disp < cant) {
                    const p = await client.query('SELECT sku, nombre FROM productos WHERE id_producto = $1', [idp]);
                    resultados.push({ id_producto: idp, sku: p.rows[0]?.sku, nombre: p.rows[0]?.nombre, error: `Stock insuficiente (disponible: ${disp}, pedido: ${cant})`, transferido: false });
                    continue;
                }

                const obs = (motivo ? motivo + ' | ' : '') + `Transferencia ${nOrigen} → ${nDestino}`;
                await stockHelper.moverStock(client, { id_empresa, id_deposito: parseInt(id_deposito_origen), id_producto: idp, cantidad: -cant, id_usuario, tipo_movimiento: TIPOS_MOVIMIENTO.TRANSFERENCIA_SALIDA, observaciones: obs, documento_referencia: transferId, id_transferencia_grupo: transferId });
                await stockHelper.moverStock(client, { id_empresa, id_deposito: parseInt(id_deposito_destino), id_producto: idp, cantidad: cant, id_usuario, tipo_movimiento: TIPOS_MOVIMIENTO.TRANSFERENCIA_ENTRADA, observaciones: obs, documento_referencia: transferId, id_transferencia_grupo: transferId });
                itemsOk++;
                resultados.push({ id_producto: idp, cantidad: cant, transferido: true });
            }

            if (itemsOk === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No se pudo transferir ningún producto', detalle: resultados }); }
            await client.query('COMMIT');
            res.json({ success: true, message: `${itemsOk} producto(s) transferido(s) de ${nOrigen} a ${nDestino}`, transfer_id: transferId, items_transferidos: itemsOk, items_fallidos: items.length - itemsOk, detalle: resultados });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error al transferir stock:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al transferir stock' });
        } finally { client.release(); }
    }

,
    // ============== Min/Max + Reposicion (modulo OC, 2026-05-17) ==============

    async actualizarMinMax(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const id_producto = parseInt(req.params.id_producto, 10);
            const { id_deposito, stock_minimo, stock_maximo, motivo } = req.body || {};
            if (!id_deposito) return res.status(400).json({ error: 'id_deposito es obligatorio' });
            const ip = req.headers['x-forwarded-for'] || req.ip || null;

            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const r = await stockHelper.actualizarMinMax(client, id_empresa, id_deposito, id_producto, {
                    stock_minimo: stock_minimo === undefined || stock_minimo === '' ? null : Number(stock_minimo),
                    stock_maximo: stock_maximo === undefined || stock_maximo === '' ? null : Number(stock_maximo),
                    id_usuario, motivo, ip
                });
                await client.query('COMMIT');
                res.json(r);
            } catch (err) {
                try { await client.query('ROLLBACK'); } catch (_) {}
                throw err;
            } finally {
                client.release();
            }
        } catch (e) {
            console.error('inventario.actualizarMinMax:', e);
            res.status(400).json({ error: e.message });
        }
    },

    async previewReposicion(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const { id_deposito, filtros_aplicados, ids_productos } = req.body || {};
            const data = await ocHelper.calcularReposicion(id_empresa, {
                id_deposito: id_deposito ? parseInt(id_deposito, 10) : null,
                filtros_aplicados: filtros_aplicados || {},
                ids_productos: Array.isArray(ids_productos) ? ids_productos.map(x => parseInt(x, 10)) : null
            });
            res.json(data);
        } catch (e) {
            console.error('inventario.previewReposicion:', e);
            res.status(400).json({ error: e.message });
        }
    },

    async generarOCs(req, res) {
        try {
            const { id_empresa, id_usuario } = req.usuario;
            const ip = req.headers['x-forwarded-for'] || req.ip || null;
            const {
                id_deposito, items,
                separar_por_proveedor, id_proveedor_unico,
                observaciones, estado_inicial
            } = req.body || {};
            const ocs = await ocHelper.crearLote(id_empresa, {
                id_deposito: id_deposito ? parseInt(id_deposito, 10) : null,
                items,
                separar_por_proveedor: !!separar_por_proveedor,
                id_proveedor_unico: id_proveedor_unico ? parseInt(id_proveedor_unico, 10) : null,
                id_usuario, ip, observaciones, estado_inicial
            });
            res.status(201).json({ ocs_creadas: ocs });
        } catch (e) {
            console.error('inventario.generarOCs:', e);
            res.status(400).json({ error: e.message });
        }
    }


,
    // ============== Endpoint enriquecido (modulo OC, 2026-05-17) ==============
    // Devuelve productos con stock_comprometido, proveedor preferido y count de OCs activas.
    // NO reemplaza obtenerCompleto (que se usa en POS/despachos). Solo lo extiende.
    async obtenerCompletoExtendido(req, res) {
        const { id_empresa } = req.usuario;
        let { id_deposito } = req.query;

        try {
            // Resolver deposito si no viene
            if (!id_deposito || id_deposito === 'principal') {
                const depR = await pool.query(
                    'SELECT id_deposito FROM depositos WHERE id_empresa=$1 AND es_principal=true AND activo=true LIMIT 1',
                    [id_empresa]
                );
                if (depR.rows.length === 0) {
                    return res.status(400).json({ error: 'No hay deposito principal configurado' });
                }
                id_deposito = depR.rows[0].id_deposito;
            }

            const sql = `
                WITH oc_count AS (
                    SELECT v.id_producto,
                           COUNT(*) AS cnt,
                           MAX(v.id_orden_compra) AS id_oc_mas_reciente
                    FROM v_ordenes_compra_activas_por_producto v
                    WHERE v.id_empresa = $1
                    GROUP BY v.id_producto
                ),
                prov_pref AS (
                    SELECT pp.id_producto, pp.id_proveedor, pr.razon_social
                    FROM producto_proveedor pp
                    LEFT JOIN proveedores pr
                        ON pr.id_empresa = pp.id_empresa AND pr.id_proveedor = pp.id_proveedor
                    WHERE pp.id_empresa = $1
                      AND pp.es_proveedor_preferido = TRUE
                      AND pp.activo = TRUE
                )
                SELECT
                    p.id_producto, p.sku, p.nombre,
                    p.id_marca, m.nombre AS marca_nombre,
                    p.id_categoria, p.id_subcategoria,
                    COALESCE(id.stock_real, 0)::numeric AS stock_real,
                    COALESCE(id.stock_comprometido, 0)::numeric AS stock_comprometido,
                    (COALESCE(id.stock_real, 0) - COALESCE(id.stock_comprometido, 0))::numeric AS stock_disponible,
                    COALESCE(id.stock_minimo, 0)::numeric AS stock_minimo,
                    COALESCE(id.stock_maximo, 0)::numeric AS stock_maximo,
                    pp.id_proveedor AS id_proveedor_preferido,
                    pp.razon_social AS proveedor_preferido_nombre,
                    COALESCE(oc.cnt, 0)::int AS ocs_activas_count,
                    oc.id_oc_mas_reciente
                FROM productos p
                LEFT JOIN inventario_deposito id
                    ON id.id_empresa = $1
                   AND id.id_producto = p.id_producto
                   AND id.id_deposito = $2
                LEFT JOIN marcas m ON m.id_marca = p.id_marca
                LEFT JOIN prov_pref pp ON pp.id_producto = p.id_producto
                LEFT JOIN oc_count oc ON oc.id_producto = p.id_producto
                WHERE p.activo = TRUE
                ORDER BY COALESCE(p.sort_key, p.sku::text)
            `;
            const { rows } = await pool.query(sql, [id_empresa, parseInt(id_deposito, 10)]);
            res.json({
                id_deposito: parseInt(id_deposito, 10),
                count: rows.length,
                data: rows
            });
        } catch (error) {
            console.error('inventario.obtenerCompletoExtendido:', error);
            res.status(500).json({ error: error.message || 'Error al cargar inventario extendido' });
        }
    }


,
    // ============== Imprimir listado de inventario (modulo OC + Lote B, 2026-05-17) ==============
    // Patron ERP: server renderiza Handlebars -> devuelve HTML con window.print() auto-disparado.
    async obtenerListadoHTML(req, res) {
        try {
            const { id_empresa } = req.usuario;
            const id_deposito = req.query.id_deposito || null;

            const filtros = {
                busqueda:           req.query.busqueda || '',
                id_marca:           req.query.id_marca || null,
                id_categoria:       req.query.id_categoria || null,
                id_subcategoria:    req.query.id_subcategoria || null,
                id_proveedor:       req.query.id_proveedor || null,
                stock:              req.query.stock || '',
                soloBajoMinimo:     req.query.soloBajoMinimo === 'true' || req.query.soloBajoMinimo === '1',
                // labels (opcionales, para mostrar en el header del print)
                marca_nombre:        req.query.marca_nombre || null,
                categoria_nombre:    req.query.categoria_nombre || null,
                subcategoria_nombre: req.query.subcategoria_nombre || null,
                proveedor_nombre:    req.query.proveedor_nombre || null
            };

            let ids_productos = null;
            if (req.query.ids_productos) {
                ids_productos = String(req.query.ids_productos).split(',')
                    .map(x => parseInt(x.trim(), 10))
                    .filter(n => !isNaN(n));
                if (ids_productos.length === 0) ids_productos = null;
            }

            const usuario_nombre = (req.usuario && (req.usuario.nombre || req.usuario.username)) || '';

            const data = await invPrintHelper.obtenerListadoParaImprimir(id_empresa, {
                id_deposito,
                filtros,
                ids_productos,
                usuario_nombre
            });

            const templatePath = path.join(__dirname, '..', '..', 'templates', 'comprobantes', 'inventario_listado.hbs');
            const tpl = await fs.readFile(templatePath, 'utf8');
            const template = Handlebars.compile(tpl);
            const html = template(data);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.send(html);
        } catch (error) {
            console.error('inventario.obtenerListadoHTML:', error);
            res.status(500).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:20px">
                <h1 style="color:#c00">Error al generar el listado</h1>
                <p>${(error.message || '').replace(/</g, '&lt;')}</p>
                <p><a href="javascript:window.close()">Cerrar</a></p>
            </body></html>`);
        }
    }

};

module.exports = inventarioController;
