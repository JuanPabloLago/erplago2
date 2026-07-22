const pool = require('../config/database');
const cajaHelper = require('../utils/caja.helper');
const pagosHelper = require('../utils/pagos.helper');
const ccClientesHelper = require('../utils/cc-clientes.helper');
const recargosHelper = require('../utils/recargos.helper');
const pedidosHelper = require('../utils/pedidos.helper');
const borradorHelper = require('../utils/borrador.helper');
const stockHelper = require('../utils/stock.helper');
const terminalesHelper = require('../utils/terminales.helper');
const cobranzaHelper = require('../utils/cobranza.helper');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');

// ============================================================================
// BORRADOR CONTROLLER — ERP LAGO (Fase 2 — Thin layer)
// Toda logica de borrador delegada a borrador.helper.js
// Toda escritura de pedidos/items delegada a pedidos.helper.js
// ============================================================================

// ─────────────────────────────────────────────────────────────────────────
// CONFIG CACHE (TTL 5 min) — para configuraciones_empresa por empresa
// ─────────────────────────────────────────────────────────────────────────
const _configCache = new Map();
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function _cargarConfigsEmpresa(queryFn, id_empresa) {
    const cached = _configCache.get(id_empresa);
    if (cached && (Date.now() - cached.ts) < CONFIG_TTL_MS) return cached.data;

    const { rows } = await queryFn(
        'SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1',
        [id_empresa]
    );
    const data = new Map();
    rows.forEach(function(r) { data.set(r.clave, r.valor); });
    _configCache.set(id_empresa, { data: data, ts: Date.now() });
    return data;
}

async function getConfig(queryFn, id_empresa, clave, defaultVal) {
    if (defaultVal === undefined) defaultVal = null;
    const configs = await _cargarConfigsEmpresa(queryFn, id_empresa);
    const val = configs.get(clave);
    return val !== undefined ? val : defaultVal;
}

// Helper local: arma el bloque "configs UI" que el frontend espera
async function _configsParaFrontend(queryFn, id_empresa) {
    return {
        permitir_cambiar_precio: await getConfig(queryFn, id_empresa, 'permitir_cambiar_precio_venta', 'false') === 'true',
        control_eliminacion:     await getConfig(queryFn, id_empresa, 'control_eliminacion_items', 'con_autorizacion'),
        permitir_modificar_cantidad: await getConfig(queryFn, id_empresa, 'permitir_modificar_cantidad_borrador', 'true') === 'true',
        permitir_venta_sin_stock:    await getConfig(queryFn, id_empresa, 'permitir_stock_negativo', 'false') === 'true'
    };
}

// ============================================================================
// 0. ABRIR SESION VENTA RAPIDA  (NUEVO — Fase 2)
// POST /api/borrador/abrir-sesion
// Aplica politica 2i (suspende huerfanos del propio usuario por TTL),
// luego devuelve borrador activo del usuario o null + configs.
// ============================================================================
async function abrirSesionVentaRapida(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;

        const politica = await borradorHelper.aplicarPoliticaAlAbrir(client, { id_empresa, id_usuario });

        const id_borrador = await borradorHelper.obtenerIdBorradorActivo(function(q, p) { return client.query(q, p); }, { id_empresa, id_usuario });

        let borrador = null;
        let pagos_provisorios = null;
        if (id_borrador) {
            borrador = await pedidosHelper.obtenerPedidoCompleto(
                function(q, p) { return client.query(q, p); }, id_borrador
            );
            const ppRes = await client.query(
                'SELECT pagos_provisorios FROM pedidos WHERE id_pedido = $1', [id_borrador]
            );
            pagos_provisorios = ppRes.rows[0] && ppRes.rows[0].pagos_provisorios || null;
        }

        const configs = await _configsParaFrontend(function(q, p) { return client.query(q, p); }, id_empresa);

        await client.query('COMMIT');
        res.json({
            borrador: borrador,
            configs: configs,
            pagos_provisorios: pagos_provisorios,
            politica_aplicada: politica
        });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en abrirSesionVentaRapida:', error);
        res.status(500).json({ error: 'Error al abrir sesion de venta rapida' });
    } finally {
        client.release();
    }
}

// ============================================================================
// 1. OBTENER BORRADOR ACTIVO
// GET /api/borrador
// Compat hacia atras: devuelve solo el borrador (sin aplicar politica).
// El frontend nuevo deberia preferir /abrir-sesion.
// ============================================================================
async function obtenerBorradorActivo(req, res) {
    try {
        const { id_empresa, id_usuario } = req.usuario;

        const id_borrador = await borradorHelper.obtenerIdBorradorActivo(
            function(q, p) { return pool.query(q, p); }, { id_empresa, id_usuario }
        );

        if (!id_borrador) return res.json({ borrador: null });

        const borrador = await pedidosHelper.obtenerPedidoCompleto(
            function(q, p) { return pool.query(q, p); }, id_borrador
        );
        const configs = await _configsParaFrontend(function(q, p) { return pool.query(q, p); }, id_empresa);

        const ppRes = await pool.query(
            'SELECT pagos_provisorios FROM pedidos WHERE id_pedido = $1', [id_borrador]
        );
        const pagos_provisorios = ppRes.rows[0] && ppRes.rows[0].pagos_provisorios || null;

        res.json({ borrador: borrador, configs: configs, pagos_provisorios: pagos_provisorios });
    } catch (error) {
        logger.error('Error en obtenerBorradorActivo:', error);
        res.status(500).json({ error: 'Error al obtener borrador' });
    }
}

// ============================================================================
// 2. CREAR BORRADOR
// POST /api/borrador
// ============================================================================
async function crearBorrador(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const { id_cliente = null, id_moneda = 1, cotizacion = null } = req.body;

        const r = await borradorHelper.obtenerOCrearActivo(client, {
            id_empresa, id_usuario, id_cliente, id_moneda, cotizacion
        });

        await client.query('COMMIT');
        const borrador = await pedidosHelper.obtenerPedidoCompleto(
            function(q, p) { return pool.query(q, p); }, r.id_pedido
        );
        if (!r.ya_existia) logger.info('Borrador #' + r.id_pedido + ' creado por usuario ' + id_usuario);
        res.status(r.ya_existia ? 200 : 201).json({ borrador: borrador, existente: r.ya_existia });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en crearBorrador:', error);
        res.status(500).json({ error: 'Error al crear borrador' });
    } finally {
        client.release();
    }
}

// ============================================================================
// 3. AGREGAR ITEM
// POST /api/borrador/:id/items
// ============================================================================
async function agregarItem(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }
        const { id_producto, cantidad = 1, precio_unitario = null, id_lista_precio = null } = req.body;

        try { await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        const listaDefault = parseInt(await getConfig(
            function(q, p) { return client.query(q, p); }, id_empresa, 'venta_rapida.lista_precio_default', '1'
        ), 10);
        const listaEfectiva = id_lista_precio ? parseInt(id_lista_precio, 10) : listaDefault;

        // F4-2026-05-19: leer precio_con_iva como soberano cuando este cargado
        const prodRes = await client.query(
            "SELECT p.id_producto, p.nombre, p.sku, " +
            "       COALESCE(a.porcentaje, 21) as alicuota_iva, " +
            "       COALESCE(inv.stock_real, 0) as stock_actual, " +
            "       COALESCE(pr.precio, 0) as precio_lista, " +
            "       pr.precio_con_iva as precio_con_iva " +
            "  FROM productos p " +
            "  LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota " +
            "  LEFT JOIN inventario inv ON p.id_producto = inv.id_producto AND inv.id_empresa = $2 " +
            "  LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_empresa = $2 AND pr.id_lista_precio = $3 " +
            " WHERE p.id_producto = $1 AND p.activo = TRUE",
            [id_producto, id_empresa, listaEfectiva]
        );
        if (prodRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado' }); }
        const producto = prodRes.rows[0];

        // L4.2.b: stock check delegado al helper. Considera comprometido en
        // OTROS borradores (excluye el propio via excluir_borrador).
        const permitirSinStock = await getConfig(
            function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_stock_negativo', 'false'
        ) === 'true';

        if (!permitirSinStock) {
            const sinStock = await stockHelper.verificarStockMultiple(client, {
                id_empresa,
                items: [{ id_producto, cantidad: parseFloat(cantidad) }],
                excluir_borrador: id_pedido
            });
            if (sinStock.length > 0) {
                await client.query('ROLLBACK');
                const det = sinStock[0];
                return res.status(400).json({
                    error: 'Stock insuficiente',
                    producto: det.nombre,
                    stock_actual: det.stock_actual,
                    comprometido_en_borradores: det.comprometido_otros,
                    cantidad_solicitada: det.cantidad,
                    disponible: det.disponible
                });
            }
        }

        const permitirCambiarPrecio = await getConfig(
            function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_cambiar_precio_venta', 'false'
        ) === 'true';
        let precioFinal;
        if (precio_unitario !== null && parseFloat(precio_unitario) > 0) {
            const precioSol = parseFloat(precio_unitario);
            const precioLista = parseFloat(producto.precio_lista) || 0;
            precioFinal = (!permitirCambiarPrecio && Math.abs(precioSol - precioLista) > 0.01) ? precioLista : precioSol;
        } else {
            precioFinal = parseFloat(producto.precio_lista) || 0;
        }

        const cantidadNum = parseFloat(cantidad);
        const ivaRate = parseFloat(producto.alicuota_iva);

        // F4-2026-05-19: si la fila de precios tiene precio_con_iva (entero) cargado
        // y el operador NO esta forzando un precio distinto al de lista, usamos
        // el bruto como dato soberano: total_linea = precio_con_iva * cantidad (entero),
        // neto reconstruido. Esto evita el drift de $0.01 al recalcular desde un neto truncado.
        const precioConIvaCargado = producto.precio_con_iva !== null && producto.precio_con_iva !== undefined
            ? parseFloat(producto.precio_con_iva) : null;
        const precioFinalEsDeLista = (precio_unitario === null) ||
            (Math.abs(parseFloat(precio_unitario || 0) - parseFloat(producto.precio_lista || 0)) <= 0.01);

        let precioUnitarioParaCongelar = precioFinal;
        let montoIvaPrecalc = undefined;
        let totalLineaPrecalc = undefined;

        // F5b-2026-05-27: modo BRUTO_ENTERO al 100% del catalogo (antes solo el 41% con precio_con_iva).
        // Si precio_con_iva esta cargado y el operador no modifico el precio, usar ese bruto.
        // Si no (59% del catalogo o precio modificado), derivar bruto entero on-the-fly: ROUND(precio_neto * (1+iva/100)).
        // Asegura que 350 x 400 siempre persista como 140000.00 clavado en pedidoitems.total_linea.
        let brutoSoberano = null;
        if (ivaRate >= 0 && cantidadNum > 0 && precioFinal > 0) {
            if (precioConIvaCargado !== null && precioConIvaCargado > 0 && precioFinalEsDeLista) {
                brutoSoberano = precioConIvaCargado;
            } else {
                brutoSoberano = Math.round(precioFinal * (1 + ivaRate / 100));
            }
        }

        if (brutoSoberano !== null && brutoSoberano > 0) {
            // Modo BRUTO_ENTERO soberano: total_linea = bruto * cantidad clavado, neto e IVA por resta
            totalLineaPrecalc = Math.round(brutoSoberano * cantidadNum * 100) / 100;
            const subtotalNeto = Math.round((totalLineaPrecalc / (1 + ivaRate / 100)) * 100) / 100;
            montoIvaPrecalc = Math.round((totalLineaPrecalc - subtotalNeto) * 100) / 100;
            precioUnitarioParaCongelar = Math.round((subtotalNeto / cantidadNum) * 100) / 100;
        }

        const itemsCreados = await pedidosHelper.crearItems(client, id_pedido, id_empresa, [{
            id_producto: id_producto,
            cantidad: cantidadNum,
            descripcion_congelada: producto.nombre,
            precio_unitario_congelado: precioUnitarioParaCongelar,
            porcentaje_descuento: 0,
            iva_aplicado: ivaRate,
            monto_iva: montoIvaPrecalc,
            total_linea: totalLineaPrecalc
        }]);

        await pedidosHelper.registrarLogItem(client, {
            id_pedido: id_pedido, id_empresa: id_empresa,
            id_item: itemsCreados[0].id_item, id_producto: id_producto,
            accion: pedidosHelper.LOG_ACCIONES.AGREGADO,
            cantidad: cantidadNum, precio_unitario: precioFinal, id_usuario: id_usuario
        });

        await pedidosHelper.recalcularTotales(client, id_pedido, id_empresa);

        await client.query('COMMIT');
        const borrador = await pedidosHelper.obtenerPedidoCompleto(
            function(q, p) { return pool.query(q, p); }, id_pedido
        );
        res.json({ borrador: borrador });

    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en agregarItem:', error);
        res.status(500).json({ error: 'Error al agregar item' });
    } finally {
        client.release();
    }
}

// ============================================================================
// 4. MODIFICAR ITEM
// PUT /api/borrador/:id/items/:id_item
// ============================================================================
async function modificarItem(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        const id_item   = parseInt(req.params.id_item, 10);
        if (isNaN(id_pedido) || isNaN(id_item)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }
        const { cantidad, precio_unitario, porcentaje_descuento } = req.body;

        try { await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        const itemActual = await client.query(
            "SELECT pi.*, COALESCE(inv.stock_real, 0) as stock_actual " +
            "  FROM pedidoitems pi " +
            "  LEFT JOIN inventario inv ON pi.id_producto = inv.id_producto AND inv.id_empresa = $2 " +
            " WHERE pi.id_item = $1 AND pi.id_pedido = $3",
            [id_item, id_empresa, id_pedido]
        );
        if (itemActual.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item no encontrado en este borrador' }); }
        const item = itemActual.rows[0];
        let nuevaCantidad = cantidad !== undefined ? parseFloat(cantidad) : parseFloat(item.cantidad);
        let nuevoPrecio   = parseFloat(item.precio_unitario_congelado);
        let accion = pedidosHelper.LOG_ACCIONES.MODIFICADO;

        if (precio_unitario !== undefined && parseFloat(precio_unitario) !== nuevoPrecio) {
            const ok = await getConfig(function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_cambiar_precio_venta', 'false') === 'true';
            if (!ok) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'No tiene permiso para modificar precios' }); }
            nuevoPrecio = parseFloat(precio_unitario);
            accion = pedidosHelper.LOG_ACCIONES.PRECIO_MODIFICADO;
        }
        if (cantidad !== undefined && parseFloat(cantidad) !== parseFloat(item.cantidad)) {
            const ok = await getConfig(function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_modificar_cantidad_borrador', 'true') === 'true';
            if (!ok) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'No tiene permiso para modificar cantidades' }); }
            // L4.2.b: stock check en modificarItem delegado al helper.
            // Fix bug: la version vieja no consideraba stock comprometido por
            // otros borradores (solo miraba stock_real bruto).
            const sinStockOK = await getConfig(function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_stock_negativo', 'false') === 'true';
            if (!sinStockOK) {
                const sinStock = await stockHelper.verificarStockMultiple(client, {
                    id_empresa,
                    items: [{ id_producto: item.id_producto, cantidad: nuevaCantidad }],
                    excluir_borrador: id_pedido
                });
                if (sinStock.length > 0) {
                    await client.query('ROLLBACK');
                    const det = sinStock[0];
                    return res.status(400).json({
                        error: 'Stock insuficiente',
                        producto: det.nombre,
                        stock_actual: det.stock_actual,
                        comprometido_en_borradores: det.comprometido_otros,
                        cantidad_solicitada: det.cantidad,
                        disponible: det.disponible
                    });
                }
            }
        }
        const nuevoDtoPorc = (porcentaje_descuento !== undefined) ? (parseFloat(porcentaje_descuento) || 0) : (parseFloat(item.porcentaje_descuento) || 0);

        // F5-2026-05-26: replicar modo BRUTO_ENTERO de agregarItem.
        // Reconstruye bruto unitario entero canonico, multiplica por cantidad (exacto),
        // y deriva neto + IVA por resta. Mantiene invariante total_linea = neto + IVA.
        const ivaRateMod = parseFloat(item.iva_aplicado);
        let totalLineaModPrecalc = undefined;
        let montoIvaModPrecalc = undefined;
        let precioParaActualizar = nuevoPrecio;
        if (Number.isFinite(ivaRateMod) && ivaRateMod >= 0 && nuevaCantidad > 0) {
            const brutoUnitEntero       = Math.round(nuevoPrecio * (1 + ivaRateMod / 100));
            const subtotalBrutoSinDto   = Math.round(brutoUnitEntero * nuevaCantidad * 100) / 100;
            const subtotalBrutoConDto   = Math.round(subtotalBrutoSinDto * (1 - nuevoDtoPorc / 100) * 100) / 100;
            const subtotalNetoDerivado  = Math.round((subtotalBrutoConDto / (1 + ivaRateMod / 100)) * 100) / 100;
            montoIvaModPrecalc          = Math.round((subtotalBrutoConDto - subtotalNetoDerivado) * 100) / 100;
            totalLineaModPrecalc        = subtotalBrutoConDto;
            precioParaActualizar        = Math.round((subtotalNetoDerivado / nuevaCantidad) * 100) / 100;
        }

        const resultado = await pedidosHelper.actualizarItem(client, {
            id_item: id_item, id_empresa: id_empresa,
            cantidad: nuevaCantidad, precio_unitario_congelado: precioParaActualizar,
            porcentaje_descuento: nuevoDtoPorc,
            monto_iva: montoIvaModPrecalc,
            total_linea: totalLineaModPrecalc
        });
        await pedidosHelper.registrarLogItem(client, {
            id_pedido: id_pedido, id_empresa: id_empresa, id_item: id_item, id_producto: item.id_producto,
            accion: accion, cantidad: nuevaCantidad, precio_unitario: nuevoPrecio,
            cantidad_anterior: resultado.anterior.cantidad,
            precio_anterior: resultado.anterior.precio_unitario_congelado,
            id_usuario: id_usuario
        });
        await pedidosHelper.recalcularTotales(client, id_pedido, id_empresa);

        await client.query('COMMIT');
        const borrador = await pedidosHelper.obtenerPedidoCompleto(function(q, p) { return pool.query(q, p); }, id_pedido);
        res.json({ borrador: borrador });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en modificarItem:', error);
        res.status(500).json({ error: 'Error al modificar item' });
    } finally { client.release(); }
}

// ============================================================================
// 5. ELIMINAR ITEM (con autorizacion supervisor)
// DELETE /api/borrador/:id/items/:id_item
// ============================================================================
async function eliminarItem(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        const id_item   = parseInt(req.params.id_item, 10);
        if (isNaN(id_pedido) || isNaN(id_item)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }
        const { motivo = '', id_usuario_autorizo = null } = req.body;

        try { await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        const controlEliminacion = await getConfig(function(q, p) { return client.query(q, p); }, id_empresa, 'control_eliminacion_items', 'con_autorizacion');
        if (controlEliminacion === 'con_autorizacion') {
            if (!id_usuario_autorizo) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: 'Requiere autorizacion de supervisor', requiere_autorizacion: true });
            }
            const auth = await client.query(
                "SELECT id_usuario, rol FROM usuarios " +
                " WHERE id_usuario = $1 AND id_empresa = $2 AND estado = 'activo' " +
                "   AND rol IN ('admin','supervisor')",
                [id_usuario_autorizo, id_empresa]
            );
            if (auth.rows.length === 0) { await client.query('ROLLBACK'); return res.status(403).json({ error: 'Usuario autorizador no valido' }); }
            if (!motivo) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Debe indicar un motivo para eliminar' }); }
        }

        const itemEliminado = await pedidosHelper.eliminarItem(client, { id_item, id_pedido, id_empresa });

        await pedidosHelper.registrarLogItem(client, {
            id_pedido: id_pedido, id_empresa: id_empresa,
            id_item: id_item, id_producto: itemEliminado.id_producto,
            accion: pedidosHelper.LOG_ACCIONES.ELIMINADO,
            cantidad: parseFloat(itemEliminado.cantidad),
            precio_unitario: parseFloat(itemEliminado.precio_unitario_congelado),
            id_usuario: id_usuario, id_usuario_autorizo: id_usuario_autorizo, motivo: motivo
        });
        await pedidosHelper.recalcularTotales(client, id_pedido, id_empresa);

        await client.query('COMMIT');
        const borrador = await pedidosHelper.obtenerPedidoCompleto(function(q, p) { return pool.query(q, p); }, id_pedido);
        res.json({ borrador: borrador });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en eliminarItem:', error);
        res.status(500).json({ error: 'Error al eliminar item' });
    } finally { client.release(); }
}

// ============================================================================
// 6. AUTORIZAR ELIMINACION (sin cambios respecto a la version anterior)
// POST /api/borrador/autorizar-eliminacion
// ============================================================================
async function autorizarEliminacion(req, res) {
    try {
        const { id_empresa } = req.usuario;
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Usuario y contrasena requeridos' });

        const { rows } = await pool.query(
            "SELECT id_usuario, username, password_hash, rol, nombre " +
            "  FROM usuarios " +
            " WHERE username = $1 AND id_empresa = $2 AND estado = 'activo' " +
            "   AND rol IN ('admin','supervisor')",
            [username, id_empresa]
        );
        if (rows.length === 0) return res.status(403).json({ error: 'Usuario no encontrado o sin permisos' });
        const supervisor = rows[0];
        const ok = await bcrypt.compare(password, supervisor.password_hash);
        if (!ok) return res.status(403).json({ error: 'Contrasena incorrecta' });

        res.json({
            autorizado: true,
            id_usuario_autorizo: supervisor.id_usuario,
            nombre_autorizo: supervisor.nombre || supervisor.username
        });
    } catch (error) {
        logger.error('Error en autorizarEliminacion:', error);
        res.status(500).json({ error: 'Error al verificar autorizacion' });
    }
}

// ============================================================================
// 7. CONFIRMAR BORRADOR (logica intacta — solo migra check inicial al helper)
// POST /api/borrador/:id/confirmar
// ============================================================================
async function confirmarBorrador(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }

        const {
            id_cliente,
            tipo_entrega: tipo_entrega_raw = 'retiro',
            observaciones = '',
            descuento_general = 0,
            pagos = []
        } = req.body;
        const tipo_entrega = (tipo_entrega_raw === 'retira' || tipo_entrega_raw === 'retiro') ? 'retiro' : tipo_entrega_raw;

        let pedidoCheck;
        try { pedidoCheck = await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        const itemsCount = await client.query('SELECT COUNT(*) as total FROM pedidoitems WHERE id_pedido = $1', [id_pedido]);
        if (parseInt(itemsCount.rows[0].total, 10) === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'El borrador no tiene items' });
        }

        const clienteFinal = id_cliente || pedidoCheck.id_cliente;
        if (!clienteFinal) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Debe seleccionar un cliente' }); }

        // L4.2: stock check delegado al helper centralizado.
        const permitirSinStock = await getConfig(function(q, p) { return client.query(q, p); }, id_empresa, 'permitir_stock_negativo', 'false') === 'true';
        if (!permitirSinStock) {
            const sinStock = await stockHelper.verificarStockMultiple(client, { id_empresa, id_pedido });
            if (sinStock.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Stock insuficiente en algunos productos', productos_sin_stock: sinStock });
            }
        }

        if (parseFloat(descuento_general) > 0) {
            await pedidosHelper.aplicarDescuentoGeneral(client, { id_pedido, id_empresa, descuento_general });
        }

        const estadoDestino = tipo_entrega === 'retiro'
            ? pedidosHelper.PEDIDO_ESTADOS.CONFIRMADO
            : pedidosHelper.PEDIDO_ESTADOS.PENDIENTE;

        await pedidosHelper.cambiarEstado(client, {
            id_pedido, id_empresa,
            nuevo_estado: estadoDestino,
            campos_extra: { id_cliente: clienteFinal, tipo_entrega, observaciones, descuento_general }
        });

        const nro_pedido = await pedidosHelper.asignarNumeroPedido(client, { id_pedido, id_empresa });

        await pedidosHelper.registrarLogPedido(client, {
            id_pedido, id_empresa, id_usuario,
            accion: pedidosHelper.LOG_PEDIDO_ACCIONES.CONFIRMADO,
            detalle_despues: { nro_pedido, estado: estadoDestino, tipo_entrega, id_cliente: clienteFinal },
            ip_origen: req.ip
        });

        // ── Flags fiado (la validacion de limite CC vive en cobranza.helper - F2) ──
        const fiadoFlag = req.body.fiado === true;
        const montoFiadoBody = parseFloat(req.body.monto_fiado) || 0;

        // ── Ajuste por forma de pago ──
        let ajusteFPAplicado = null;
        if (pagos.length > 0) {
            const pagoPrincipal = pagos.reduce(function(max, p) { return (parseFloat(p.monto) > parseFloat(max.monto)) ? p : max; }, pagos[0]);
            const id_metodo = pagoPrincipal.id_metodo_pago || 1;
            let id_fp = pagoPrincipal.id_forma_pago || null;
            if (!id_fp) id_fp = await recargosHelper.resolverFormaPago(client, id_empresa, id_metodo);
            if (id_fp) {
                const configAjuste = await recargosHelper.obtenerRecargo(client, id_empresa, id_fp);
                if (configAjuste && parseFloat(configAjuste.porcentaje) !== 0) {
                    const porcentaje = parseFloat(configAjuste.porcentaje);
                    const nombreFP = await recargosHelper.obtenerNombreFormaPago(client, id_empresa, id_fp);
                    ajusteFPAplicado = await pedidosHelper.aplicarAjusteFormaPago(client, {
                        id_pedido, id_empresa, id_forma_pago: id_fp,
                        id_cliente: clienteFinal, id_usuario,
                        porcentaje, nombre_forma_pago: nombreFP
                    });
                    if (ajusteFPAplicado) {
                        const dif = ajusteFPAplicado.totalDespues - ajusteFPAplicado.totalAntes;
                        const idxP = pagos.indexOf(pagoPrincipal);
                        pagos[idxP].monto = Math.round((parseFloat(pagos[idxP].monto) + dif) * 100) / 100;
                    }
                }
            }
        }

        // ── Liquidacion: pagos + fiado + caja, con guard CF ──
        // Delegado a cobranza.helper.liquidarPedidoNuevo (Fase 3.4):
        // detecta huerfanos (pagos=[] + sin fiado) y dispara fiado automatico
        // si el cliente no es CF generico. Bloquea CF segun config.
        try {
            await cobranzaHelper.liquidarPedidoNuevo(client, {
                id_empresa, id_pedido, id_cliente: clienteFinal, id_usuario,
                pagos, fiadoFlag, montoFiadoBody
            });
        } catch (e) {
            const codigosNegocio = ['CF_NO_PUEDE_FIAR', 'CF_NO_PUEDE_PARCIAL', 'SUMA_INCONSISTENTE', 'CAJA_CERRADA', 'PEDIDO_NO_ENCONTRADO', 'LIMITE_CREDITO_EXCEDIDO', 'DEVOLUCION_SIN_EGRESO', 'DEVOLUCION_CC_NO_SOPORTADA', 'METODO_CC_NO_VALIDO'];
            if (codigosNegocio.includes(e.code)) {
                await client.query('ROLLBACK');
                return res.status(e.statusCode || 400).json({ error: e.message, code: e.code });
            }
            throw e;
        }

        // ── Stock ──
        if (tipo_entrega === 'retiro') {
            const itemsRetiro = await client.query('SELECT id_producto, cantidad FROM pedidoitems WHERE id_pedido = $1', [id_pedido]);
            const id_deposito = await stockHelper.obtenerDepositoUsuario(client, req.usuario);
            for (const item of itemsRetiro.rows) {
                await stockHelper.descontarVenta(client, {
                    id_empresa, id_deposito, id_producto: item.id_producto,
                    cantidad: parseFloat(item.cantidad), id_usuario,
                    documento_referencia: 'Pedido #' + id_pedido,
                    observaciones: 'Retiro inmediato - Venta rapida',
                    id_pedido
                });
            }
        }

        await client.query('UPDATE pedidos SET pagos_provisorios = NULL WHERE id_pedido = $1', [id_pedido]);
        await client.query('COMMIT');

        logger.info('Borrador #' + id_pedido + ' confirmado como ' + tipo_entrega + ' por usuario ' + id_usuario);
        const pedidoFinal = await pedidosHelper.obtenerPedidoCompleto(function(q, p) { return pool.query(q, p); }, id_pedido);
        res.json({
            pedido: pedidoFinal, nro_pedido: nro_pedido, ajuste_fp: ajusteFPAplicado,
            mensaje: tipo_entrega === 'retiro' ? 'Venta confirmada - Retiro inmediato' : 'Pedido guardado para entregar'
        });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === 'CAJA_CERRADA') return res.status(400).json({ error: error.message, code: error.code });
        logger.error('Error en confirmarBorrador:', error);
        res.status(500).json({ error: 'Error al confirmar borrador' });
    } finally { client.release(); }
}

// ============================================================================
// 7b. SUSPENDER BORRADOR
// POST /api/borrador/:id/suspender
// ============================================================================
async function suspenderBorrador(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }
        const { observaciones = '' } = req.body;

        try { await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        const itemsCount = await client.query('SELECT COUNT(*) as total FROM pedidoitems WHERE id_pedido = $1', [id_pedido]);
        if (parseInt(itemsCount.rows[0].total, 10) === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'El borrador no tiene items' });
        }

        const obs = observaciones ? observaciones + ' [SUSPENDIDO]' : '[SUSPENDIDO]';
        await pedidosHelper.cambiarEstado(client, {
            id_pedido, id_empresa,
            nuevo_estado: pedidosHelper.PEDIDO_ESTADOS.SUSPENDIDO,
            campos_extra: { observaciones: obs }
        });

        await client.query('COMMIT');
        logger.info('Borrador #' + id_pedido + ' suspendido por usuario ' + id_usuario);
        res.json({ success: true, id_pedido: id_pedido, mensaje: 'Venta suspendida' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en suspenderBorrador:', error);
        res.status(500).json({ error: 'Error al suspender borrador' });
    } finally { client.release(); }
}

// ============================================================================
// 7c. SINCRONIZAR PAGOS PROVISORIOS
// PUT /api/borrador/:id/pagos
// ============================================================================
async function sincronizarPagos(req, res) {
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) return res.status(400).json({ error: 'ID de borrador invalido' });
        const { pagos = [] } = req.body;

        const result = await pool.query(
            "UPDATE pedidos SET pagos_provisorios = $1 " +
            " WHERE id_pedido = $2 AND id_usuario = $3 AND id_empresa = $4 AND id_estado = $5 " +
            " RETURNING id_pedido",
            [JSON.stringify(pagos), id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Borrador no encontrado' });
        res.json({ ok: true, pagos_guardados: pagos.length });
    } catch (error) {
        logger.error('Error en sincronizarPagos:', error);
        res.status(500).json({ error: 'Error al sincronizar pagos' });
    }
}

// ============================================================================
// 8. DESCARTAR BORRADOR
// DELETE /api/borrador/:id
// ============================================================================
async function descartarBorrador(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'ID invalido' }); }

        try { await borradorHelper.validarPertenencia(client, { id_pedido, id_empresa, id_usuario }); }
        catch (e) { await client.query('ROLLBACK'); return res.status(404).json({ error: e.message }); }

        await pedidosHelper.cambiarEstado(client, {
            id_pedido, id_empresa,
            nuevo_estado: pedidosHelper.PEDIDO_ESTADOS.DESCARTADO
        });

        await client.query('COMMIT');
        logger.info('Borrador #' + id_pedido + ' descartado por usuario ' + id_usuario);
        res.json({ mensaje: 'Borrador descartado' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en descartarBorrador:', error);
        res.status(500).json({ error: 'Error al descartar borrador' });
    } finally { client.release(); }
}

// ============================================================================
// 9. ASIGNAR CLIENTE
// PUT /api/borrador/:id/cliente
// ============================================================================
async function asignarCliente(req, res) {
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const id_pedido = parseInt(req.params.id, 10);
        if (isNaN(id_pedido)) return res.status(400).json({ error: 'ID invalido' });
        const { id_cliente } = req.body;
        if (!id_cliente) return res.status(400).json({ error: 'id_cliente requerido' });

        const clienteCheck = await pool.query(
            "SELECT id_cliente FROM clientes WHERE id_cliente = $1 AND id_empresa = $2 AND activo = true",
            [id_cliente, id_empresa]
        );
        if (clienteCheck.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

        // Validacion de pertenencia sin lock (es un solo UPDATE atomico)
        const pedidoCheck = await pool.query(
            "SELECT id_pedido FROM pedidos WHERE id_pedido = $1 AND id_usuario = $2 AND id_empresa = $3 AND id_estado = $4",
            [id_pedido, id_usuario, id_empresa, pedidosHelper.PEDIDO_ESTADOS.BORRADOR]
        );
        if (pedidoCheck.rows.length === 0) return res.status(404).json({ error: 'Borrador no encontrado' });

        await pool.query(
            'UPDATE pedidos SET id_cliente = $1 WHERE id_pedido = $2 AND id_empresa = $3',
            [id_cliente, id_pedido, id_empresa]
        );
        res.json({ mensaje: 'Cliente asignado' });
    } catch (error) {
        logger.error('Error en asignarCliente:', error);
        res.status(500).json({ error: 'Error al asignar cliente' });
    }
}

// ============================================================================
// 10. LIMPIAR BORRADORES ABANDONADOS (admin)
// POST /api/borrador/limpiar
// ============================================================================
async function limpiarBorradoresAbandonados(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const horas = parseInt(req.query.horas || '24', 10);
        const r = await borradorHelper.limpiarAbandonadosEmpresa(client, { id_empresa, horas });
        await client.query('COMMIT');
        res.json({ limpiados: r.limpiados, ids: r.ids });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error en limpiarBorradoresAbandonados:', error);
        res.status(500).json({ error: 'Error al limpiar borradores' });
    } finally { client.release(); }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
    abrirSesionVentaRapida,   // NUEVO Fase 2
    obtenerBorradorActivo,
    crearBorrador,
    agregarItem,
    modificarItem,
    eliminarItem,
    autorizarEliminacion,
    confirmarBorrador,
    sincronizarPagos,
    suspenderBorrador,
    descartarBorrador,
    asignarCliente,
    limpiarBorradoresAbandonados
};
