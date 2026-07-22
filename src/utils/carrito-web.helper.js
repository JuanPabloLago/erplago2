/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CARRITO-WEB HELPER — ERP LAGO
 * Centraliza el ciclo de vida del carrito web (no toca stock, no crea pedido)
 * ═══════════════════════════════════════════════════════════════════════════
 * TABLAS: carritos_web, carritos_web_items, productos, precios, inventario
 * CONSUMIDORES: carrito-web.controller.js, pedido-web.helper.js
 *
 * REGLAS:
 *  - Un cliente logueado tiene como mucho UN carrito activo por empresa.
 *  - Un visitante anonimo tiene un carrito identificado por session_token (cookie).
 *  - Al loguearse, fusionarAnonimoConCliente() une los items del carrito anonimo
 *    con el del cliente (sumando cantidades en colisiones).
 *  - precio_unitario_snapshot se congela al agregar el item.
 *  - obtenerCarritoConItems() devuelve ademas precios vigentes para cada item,
 *    para que el frontend muestre alertas si cambiaron.
 *  - Cero hardcodes: lista de precio, expiracion, etc. salen de configuraciones_empresa.
 */

const cfg    = require('./config.helper');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────────────────

function _generarSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function _calcularFechaExpiracion(client, id_empresa) {
    const dias = await cfg.get(client, id_empresa, 'web.carrito_dias_expiracion', 30);
    const d = new Date();
    d.setDate(d.getDate() + parseInt(dias, 10));
    return d;
}

/**
 * Obtiene el id_lista_precio que aplica a un cliente (o el publico si es anonimo).
 */
async function _resolverListaPrecio(client, id_empresa, id_cliente) {
    if (id_cliente) {
        const r = await client.query(
            'SELECT id_lista_precio FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
            [id_cliente, id_empresa]
        );
        if (r.rows.length && r.rows[0].id_lista_precio) {
            return r.rows[0].id_lista_precio;
        }
    }
    return await cfg.get(client, id_empresa, 'web.id_lista_precio_publica', 1);
}

/**
 * Obtiene el precio vigente CON IVA INCLUIDO de un producto para una lista dada.
 * En la BD `precios.precio` esta guardado NETO. Este helper aplica el IVA del
 * producto (productos.id_alicuota_iva -> alicuotasiva.porcentaje) y redondea.
 *
 * Patron consistente con listas-precios.helper.js, despachos.helper.js, etc.
 *
 * Devuelve null si no esta listado en esa lista.
 * Devuelve { neto, iva_pct, final } si existe.
 */
async function _obtenerPrecioConIva(client, id_empresa, id_producto, id_lista_precio) {
    const r = await client.query(`
        SELECT pr.precio AS neto, COALESCE(a.porcentaje, 21)::numeric AS iva_pct
          FROM precios pr
          JOIN productos p ON p.id_producto = pr.id_producto
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE pr.id_empresa = $1
           AND pr.id_producto = $2
           AND pr.id_lista_precio = $3
         LIMIT 1
    `, [id_empresa, id_producto, id_lista_precio]);
    if (!r.rows.length) return null;
    const neto    = Number(r.rows[0].neto);
    const iva_pct = Number(r.rows[0].iva_pct);
    const final   = Math.round(neto * (1 + iva_pct / 100) * 100) / 100;
    return { neto, iva_pct, final };
}

/**
 * Wrapper retrocompatible: devuelve solo el precio con IVA (number) o null.
 * Usado por controllers que solo necesitan el precio final.
 */
async function _obtenerPrecioVigente(client, id_empresa, id_producto, id_lista_precio) {
    const data = await _obtenerPrecioConIva(client, id_empresa, id_producto, id_lista_precio);
    return data ? data.final : null;
}

/**
 * Stock total disponible del producto (suma de inventario_deposito).
 */
async function _obtenerStock(client, id_empresa, id_producto) {
    // Stock DISPONIBLE = real - comprometido. Clamp >= 0 (los negativos son
    // bugs historicos de descomprometer dos veces, no se exponen al cliente).
    // Consistente con conjuntos-web.helper.js (catalogo publico).
    const r = await client.query(`
        SELECT GREATEST(0, COALESCE(SUM(stock_real - stock_comprometido), 0))::numeric AS stock
          FROM inventario_deposito
         WHERE id_empresa = $1 AND id_producto = $2
    `, [id_empresa, id_producto]);
    return r.rows.length ? Number(r.rows[0].stock) : 0;
}

async function _tocarCarrito(client, id_carrito) {
    await client.query(
        'UPDATE carritos_web SET fecha_modificacion = NOW() WHERE id_carrito = $1',
        [id_carrito]
    );
}

// ─────────────────────────────────────────────────────────────────────────
// OBTENER O CREAR
// ─────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el carrito activo del cliente (si esta logueado) o por session_token
 * (si es anonimo). Si no existe, lo crea.
 *
 * @param {object} args
 * @param {number} args.id_empresa
 * @param {number|null} args.id_cliente
 * @param {string|null} args.session_token   (cookie)
 * @param {string|null} args.ip_origen
 * @param {string|null} args.user_agent
 * @returns {object} { id_carrito, session_token, id_cliente, estado, fecha_expiracion }
 */
async function obtenerOCrearCarrito(client, args) {
    const { id_empresa, id_cliente = null, session_token = null,
            ip_origen = null, user_agent = null } = args;

    if (!id_empresa) throw new Error('obtenerOCrearCarrito: id_empresa requerido');

    // ─── CLIENTE LOGUEADO: solo por id_cliente, nunca por session_token del cookie ───
    if (id_cliente) {
        const r = await client.query(`
            SELECT id_carrito, session_token, id_cliente, estado, fecha_expiracion
              FROM carritos_web
             WHERE id_empresa = $1 AND id_cliente = $2 AND estado = 'activo'
             ORDER BY fecha_modificacion DESC
             LIMIT 1
        `, [id_empresa, id_cliente]);

        if (r.rows.length) return r.rows[0];

        return await _crearCarritoNuevo(client, { id_empresa, id_cliente, ip_origen, user_agent });
    }

    // ─── VISITANTE ANONIMO: solo carritos con id_cliente IS NULL ───
    if (session_token) {
        const r = await client.query(`
            SELECT id_carrito, session_token, id_cliente, estado, fecha_expiracion
              FROM carritos_web
             WHERE session_token = $1 AND id_cliente IS NULL AND estado = 'activo'
             LIMIT 1
        `, [session_token]);

        if (r.rows.length) return r.rows[0];
    }

    return await _crearCarritoNuevo(client, { id_empresa, id_cliente: null, session_token_forzado: session_token, ip_origen, user_agent });
}

/**
 * Inserta un carrito nuevo con session_token SIEMPRE fresco, con reintentos ante colision UNIQUE.
 */
async function _crearCarritoNuevo(client, args) {
    const { id_empresa, id_cliente, session_token_forzado = null, ip_origen, user_agent } = args;
    const exp = await _calcularFechaExpiracion(client, id_empresa);

    for (let i = 0; i < 3; i++) {
        const nuevoToken = (i === 0 && session_token_forzado) ? session_token_forzado : _generarSessionToken();
        try {
            const r = await client.query(`
                INSERT INTO carritos_web (
                    id_empresa, id_cliente, session_token, estado,
                    fecha_expiracion, ip_origen, user_agent
                ) VALUES ($1, $2, $3, 'activo', $4, $5, $6)
                RETURNING id_carrito, session_token, id_cliente, estado, fecha_expiracion
            `, [id_empresa, id_cliente, nuevoToken, exp, ip_origen, user_agent]);
            return r.rows[0];
        } catch (e) {
            if (e.code === '23505' && i < 2) continue;  // UNIQUE, reintentar
            throw e;
        }
    }
    throw new Error('No se pudo generar session_token unico');
}

/**
 * Verifica ownership: el carrito debe pertenecer al contexto actual.
 * Tira error con statusCode 403 si es ajeno. CRITICO para aislamiento.
 */
async function verificarOwnership(client, id_carrito, id_cliente_actual, session_token_actual) {
    const r = await client.query(`
        SELECT id_cliente, session_token, estado, id_empresa
          FROM carritos_web
         WHERE id_carrito = $1
    `, [id_carrito]);

    if (!r.rows.length) {
        const err = new Error('Carrito no encontrado');
        err.statusCode = 404;
        throw err;
    }

    const c = r.rows[0];

    if (c.id_cliente) {
        if (!id_cliente_actual || c.id_cliente !== id_cliente_actual) {
            const err = new Error('Carrito no autorizado');
            err.statusCode = 403;
            throw err;
        }
        return c;
    }

    if (!c.id_cliente) {
        if (!session_token_actual || c.session_token !== session_token_actual) {
            const err = new Error('Carrito no autorizado');
            err.statusCode = 403;
            throw err;
        }
        return c;
    }

    const err = new Error('Carrito inconsistente');
    err.statusCode = 500;
    throw err;
}

// ─────────────────────────────────────────────────────────────────────────
// CONTENIDO DEL CARRITO
// ─────────────────────────────────────────────────────────────────────────

/**
 * Devuelve el carrito + items + precios vigentes + alertas.
 * Estructura:
 * {
 *   id_carrito, session_token, id_cliente, estado, fecha_expiracion,
 *   items: [{ id_item, id_producto, nombre, sku, cantidad,
 *             precio_snapshot, precio_vigente, subtotal_vigente,
 *             cambio_precio: bool, stock_disponible, sin_stock: bool }],
 *   totales: { subtotal_snapshot, subtotal_vigente, cant_items, cant_unidades },
 *   alertas: { hay_cambios_precio, hay_sin_stock }
 * }
 */
async function obtenerCarritoConItems(client, id_empresa, id_carrito) {
    const cab = await client.query(`
        SELECT id_carrito, id_empresa, id_cliente, session_token, estado, fecha_expiracion
          FROM carritos_web
         WHERE id_carrito = $1 AND id_empresa = $2
         LIMIT 1
    `, [id_carrito, id_empresa]);
    if (!cab.rows.length) return null;
    const carrito = cab.rows[0];

    const id_lista = await _resolverListaPrecio(client, id_empresa, carrito.id_cliente);

    const items = await client.query(`
        SELECT cwi.id_item, cwi.id_producto, cwi.cantidad, cwi.precio_unitario_snapshot,
               cwi.fecha_agregado,
               p.nombre, p.sku, p.url_imagen,
               pr.precio AS precio_neto_vigente,
               COALESCE(a.porcentaje, 21)::numeric AS iva_pct,
               COALESCE(inv.stock_total, 0)::numeric AS stock_disponible
          FROM carritos_web_items cwi
          JOIN productos p ON p.id_producto = cwi.id_producto
          LEFT JOIN precios pr ON pr.id_producto = cwi.id_producto
                              AND pr.id_empresa = $2
                              AND pr.id_lista_precio = $3
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
          LEFT JOIN (
              SELECT id_producto,
                     GREATEST(0, SUM(stock_real - stock_comprometido)) AS stock_total
                FROM inventario_deposito
               WHERE id_empresa = $2
               GROUP BY id_producto
          ) inv ON inv.id_producto = cwi.id_producto
         WHERE cwi.id_carrito = $1
         ORDER BY cwi.fecha_agregado ASC
    `, [id_carrito, id_empresa, id_lista]);

    const itemsConPrecio = [];
    let subtotal_snapshot = 0;
    let subtotal_vigente  = 0;
    let cant_unidades     = 0;
    let hay_cambios_precio = false;
    let hay_sin_stock     = false;

    for (const it of items.rows) {
        // Precio vigente calculado inline desde el JOIN (sin query extra)
        const neto = it.precio_neto_vigente !== null ? Number(it.precio_neto_vigente) : null;
        const iva_pct = Number(it.iva_pct);
        const precio_vigente = neto !== null
            ? Math.round(neto * (1 + iva_pct / 100) * 100) / 100
            : null;
        const stock_disp     = Number(it.stock_disponible);
        const cantidad       = Number(it.cantidad);
        const snapshot       = Number(it.precio_unitario_snapshot);
        const vigente        = precio_vigente !== null ? precio_vigente : snapshot;
        const cambio         = Math.abs(vigente - snapshot) > 0.01;
        const sin_stock      = stock_disp < cantidad;

        if (cambio)    hay_cambios_precio = true;
        if (sin_stock) hay_sin_stock = true;

        subtotal_snapshot += snapshot * cantidad;
        subtotal_vigente  += vigente * cantidad;
        cant_unidades     += cantidad;

        itemsConPrecio.push({
            id_item: it.id_item,
            id_producto: it.id_producto,
            nombre: it.nombre,
            sku: it.sku,
            url_imagen: it.url_imagen,
            cantidad,
            precio_snapshot: snapshot,
            precio_vigente: vigente,
            subtotal_vigente: vigente * cantidad,
            cambio_precio: cambio,
            stock_disponible: stock_disp,
            sin_stock
        });
    }

    return {
        ...carrito,
        items: itemsConPrecio,
        totales: {
            subtotal_snapshot: Math.round(subtotal_snapshot * 100) / 100,
            subtotal_vigente:  Math.round(subtotal_vigente * 100) / 100,
            cant_items: itemsConPrecio.length,
            cant_unidades
        },
        alertas: { hay_cambios_precio, hay_sin_stock }
    };
}

// ─────────────────────────────────────────────────────────────────────────
// MUTACIONES DE ITEMS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agrega un producto al carrito. Si ya existe, suma la cantidad.
 * Congela el precio vigente al momento de agregar.
 */
async function agregarItem(client, id_empresa, id_carrito, id_producto, cantidad) {
    if (!id_carrito || !id_producto) throw new Error('agregarItem: parametros invalidos');
    const cant = Number(cantidad);
    if (!cant || cant <= 0) throw new Error('Cantidad debe ser mayor a 0');

    // Verifica producto activo + visible en web
    const prod = await client.query(`
        SELECT p.id_producto, p.nombre, p.activo, p.visible_web
          FROM productos p
         WHERE p.id_producto = $1
         LIMIT 1
    `, [id_producto]);
    if (!prod.rows.length || !prod.rows[0].activo) {
        throw new Error('Producto no disponible');
    }
    if (!prod.rows[0].visible_web) {
        throw new Error('Producto no disponible para venta web');
    }

    // Resuelve lista de precio del carrito
    const cab = await client.query(
        'SELECT id_cliente FROM carritos_web WHERE id_carrito = $1 AND id_empresa = $2',
        [id_carrito, id_empresa]
    );
    if (!cab.rows.length) throw new Error('Carrito no encontrado');
    const id_lista = await _resolverListaPrecio(client, id_empresa, cab.rows[0].id_cliente);
    const precio   = await _obtenerPrecioVigente(client, id_empresa, id_producto, id_lista);
    if (precio === null) throw new Error('Producto sin precio en la lista vigente');

    // Validacion stock segun config
    const soloConStock = await cfg.get(client, id_empresa, 'web.solo_productos_con_stock', false);
    if (soloConStock) {
        const stock = await _obtenerStock(client, id_empresa, id_producto);
        if (stock < cant) throw new Error('Stock insuficiente');
    }

    // UPSERT (suma cantidades en colision)
    const r = await client.query(`
        INSERT INTO carritos_web_items (id_carrito, id_producto, cantidad, precio_unitario_snapshot)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id_carrito, id_producto)
        DO UPDATE SET cantidad = carritos_web_items.cantidad + EXCLUDED.cantidad,
                      precio_unitario_snapshot = EXCLUDED.precio_unitario_snapshot
        RETURNING id_item, id_producto, cantidad, precio_unitario_snapshot
    `, [id_carrito, id_producto, cant, precio]);

    await _tocarCarrito(client, id_carrito);
    return r.rows[0];
}

async function modificarItem(client, id_empresa, id_carrito, id_item, nuevaCantidad) {
    const cant = Number(nuevaCantidad);
    if (!cant || cant <= 0) {
        return await eliminarItem(client, id_empresa, id_carrito, id_item);
    }

    // Validacion stock
    const it = await client.query(
        'SELECT id_producto FROM carritos_web_items WHERE id_item = $1 AND id_carrito = $2',
        [id_item, id_carrito]
    );
    if (!it.rows.length) throw new Error('Item no encontrado');

    const soloConStock = await cfg.get(client, id_empresa, 'web.solo_productos_con_stock', false);
    if (soloConStock) {
        const stock = await _obtenerStock(client, id_empresa, it.rows[0].id_producto);
        if (stock < cant) throw new Error('Stock insuficiente');
    }

    const upd = await client.query(
        'UPDATE carritos_web_items SET cantidad = $1 WHERE id_item = $2 AND id_carrito = $3',
        [cant, id_item, id_carrito]
    );
    if (upd.rowCount === 0) {
        const err = new Error('Item no encontrado en este carrito');
        err.statusCode = 404;
        throw err;
    }
    await _tocarCarrito(client, id_carrito);
    return { id_item, cantidad: cant };
}

async function eliminarItem(client, id_empresa, id_carrito, id_item) {
    const del = await client.query(
        'DELETE FROM carritos_web_items WHERE id_item = $1 AND id_carrito = $2',
        [id_item, id_carrito]
    );
    if (del.rowCount === 0) {
        const err = new Error('Item no encontrado en este carrito');
        err.statusCode = 404;
        throw err;
    }
    await _tocarCarrito(client, id_carrito);
    return { id_item, eliminado: true };
}

async function vaciarCarrito(client, id_empresa, id_carrito) {
    await client.query('DELETE FROM carritos_web_items WHERE id_carrito = $1', [id_carrito]);
    await _tocarCarrito(client, id_carrito);
    return { vaciado: true };
}

// ─────────────────────────────────────────────────────────────────────────
// FUSION ANONIMO -> LOGUEADO
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cuando un visitante con carrito anonimo se loguea, se fusiona su carrito
 * con el del cliente (si tiene uno previo). Estrategia:
 *   - Si el cliente NO tenia carrito activo: el anonimo se asigna al cliente.
 *   - Si tenia: se mueven los items del anonimo al carrito del cliente,
 *     sumando cantidades en colisiones, y el anonimo queda 'descartado'.
 *
 * Devuelve el id_carrito final que debe usar el cliente.
 */
async function fusionarAnonimoConCliente(client, id_empresa, session_token_anon, id_cliente) {
    if (!session_token_anon || !id_cliente) {
        throw new Error('fusionarAnonimoConCliente: parametros requeridos');
    }

    const anon = await client.query(`
        SELECT id_carrito FROM carritos_web
         WHERE session_token = $1 AND estado = 'activo' AND id_empresa = $2
         LIMIT 1
    `, [session_token_anon, id_empresa]);

    if (!anon.rows.length) {
        // No habia carrito anonimo: simplemente devolvemos/creamos el del cliente
        const c = await obtenerOCrearCarrito(client, { id_empresa, id_cliente });
        return c.id_carrito;
    }
    const id_carrito_anon = anon.rows[0].id_carrito;

    // Carrito previo del cliente
    const cli = await client.query(`
        SELECT id_carrito FROM carritos_web
         WHERE id_empresa = $1 AND id_cliente = $2 AND estado = 'activo'
         ORDER BY fecha_modificacion DESC LIMIT 1
    `, [id_empresa, id_cliente]);

    // CASO A: cliente sin carrito previo -> el anonimo pasa a ser del cliente
    if (!cli.rows.length) {
        await client.query(
            'UPDATE carritos_web SET id_cliente = $1, fecha_modificacion = NOW() WHERE id_carrito = $2 AND id_empresa = $3',
            [id_cliente, id_carrito_anon, id_empresa]
        );
        return id_carrito_anon;
    }

    // CASO B: ambos existen -> mover items, descartar anonimo
    const id_carrito_cli = cli.rows[0].id_carrito;

    const itemsAnon = await client.query(
        'SELECT id_producto, cantidad, precio_unitario_snapshot FROM carritos_web_items WHERE id_carrito = $1',
        [id_carrito_anon]
    );

    for (const it of itemsAnon.rows) {
        await client.query(`
            INSERT INTO carritos_web_items (id_carrito, id_producto, cantidad, precio_unitario_snapshot)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id_carrito, id_producto)
            DO UPDATE SET cantidad = carritos_web_items.cantidad + EXCLUDED.cantidad
        `, [id_carrito_cli, it.id_producto, it.cantidad, it.precio_unitario_snapshot]);
    }

    await client.query(
        "UPDATE carritos_web SET estado = 'descartado' WHERE id_carrito = $1 AND id_empresa = $2",
        [id_carrito_anon, id_empresa]
    );
    await _tocarCarrito(client, id_carrito_cli);
    return id_carrito_cli;
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
    obtenerOCrearCarrito,
    verificarOwnership,
    obtenerCarritoConItems,
    agregarItem,
    modificarItem,
    eliminarItem,
    vaciarCarrito,
    fusionarAnonimoConCliente,
    // helpers internos exportados por si los necesita pedido-web.helper.js
    _resolverListaPrecio,
    _obtenerPrecioVigente,
    _obtenerPrecioConIva,
    _obtenerStock
};
