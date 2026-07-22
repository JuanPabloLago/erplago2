/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCTOS HELPER — ERP LAGO
 * Centralización de TODAS las escrituras a:
 *   productos, precios, inventario (config), producto_proveedor, productocodigosbarras
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLA: Ningún controller escribe directamente en estas tablas.
 *        Todo pasa por este helper.
 *
 * NOTA: Los movimientos de stock (moverStock, ajustarStockAbsoluto, etc.)
 *       siguen en stock.helper.js. Este helper solo maneja la CONFIGURACIÓN
 *       del registro inventario (stock_minimo, stock_maximo)
 *       y la creación inicial del registro.
 *
 * CONSUMIDORES:
 *   - productos.controller.js          (CRUD, masivos, imágenes)
 *   - productos-import.controller.js   (importación Excel)
 *   - variantes.controller.js          (flag tiene_variantes)
 *
 * TABLAS:
 *   - productos              (INSERT, UPDATE) — COMPARTIDA (sin id_empresa)
 *   - precios                (INSERT, UPDATE) — POR EMPRESA (PK: id_empresa, id_producto, id_lista_precio)
 *   - inventario             (INSERT, UPDATE) — POR EMPRESA
 *   - producto_proveedor     (INSERT, UPDATE) — POR EMPRESA (UNIQUE: id_empresa, id_producto, id_proveedor)
 *   - productocodigosbarras  (INSERT)         — COMPARTIDA
 *
 * TRIGGERS EN BD (no duplicar lógica):
 *   - productos: trigger_productos_modificacion → actualizar_fecha_modificacion()
 *   - precios: tr_registrar_cambio_precio + trg_cambio_precio → historial automático
 *   - producto_proveedor: trigger_calcular_precio_neto → calcula precio_neto
 *   - producto_proveedor: trigger_producto_proveedor_modificacion → fecha_modificacion
 *
 * Actualizado: 2026-02-28 — Multi-empresa v2
 */

const logger = require('./logger');
const bitacora = require('./bitacora.helper');
const ivaHelper = require('./iva.helper');
const configHelper = require('./config.helper');
const codigosBarraHelper = require('./codigos-barra.helper');

// ═══════════════════════════════════════════════════════════════════════════
// TABLA: productos (COMPARTIDA — sin id_empresa)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crear un producto nuevo
 */
async function crearProducto(client, datos) {
    const {
        sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva, unidad_medida = 'unidades',
        tiene_variantes = false, url_imagen, cod_proveedor,
        variante_atributos
    } = datos;

    if (!sku || !nombre) {
        throw Object.assign(new Error('SKU y nombre son requeridos'), { statusCode: 400 });
    }
    // SOLID: el caller DEBE resolver id_alicuota_iva antes (vía ivaHelper.obtenerAlicuotaDefectoParaCreacion).
    // Sin fallback hardcodeado: garantiza que toda alta de producto pasa por la config de empresa.
    if (id_alicuota_iva == null || !Number.isInteger(parseInt(id_alicuota_iva))) {
        throw new Error('productos.helper.crearProducto: id_alicuota_iva obligatorio (resolver desde ivaHelper antes de llamar)');
    }

    // Bloque 6b: validacion CHECK chk_productos_cat_distinta_subcat antes del INSERT
    //   evita error criptico de Postgres si llegan iguales
    if (id_categoria != null && id_subcategoria != null && id_categoria === id_subcategoria) {
        throw Object.assign(
            new Error(`crearProducto: id_categoria y id_subcategoria no pueden ser iguales (ambos=${id_categoria})`),
            { statusCode: 400 }
        );
    }

    const result = await client.query(`
        INSERT INTO productos (
            sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
            id_alicuota_iva, unidad_medida, tiene_variantes,
            url_imagen, cod_proveedor, variante_atributos, activo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE)
        RETURNING *
    `, [
        sku, nombre, descripcion || null,
        id_categoria || null, id_subcategoria || null, id_marca || null,
        id_alicuota_iva, unidad_medida, tiene_variantes,
        url_imagen || null, cod_proveedor || null,
        variante_atributos ? JSON.stringify(variante_atributos) : null
    ]);

    logger.info(`[productos.helper] Producto creado: ${sku} - ${nombre} (id: ${result.rows[0].id_producto})`);
    return result.rows[0];
}

/**
 * Actualizar campos de un producto existente.
 *
 * SEMÁNTICA (decisión 17-abr-2026):
 *   - El request representa el ESTADO DESEADO del producto.
 *   - `undefined` en un campo → NO se toca (preserva valor actual).
 *   - `null` o `""` en un campo → se borra (se setea NULL).
 *   - SKU y nombre son NOT NULL por schema: si vienen null/"" → error.
 *
 * CASTS EXPLÍCITOS ($N::tipo): eliminan por contrato el error
 * "could not determine data type of parameter $N" cuando PG recibe NULL
 * y la expresión no tipifica de forma inequívoca (p.ej. dentro de COALESCE).
 *
 * Flags booleanos y numéricos: respetamos NOT NULL de schema (tiene_variantes,
 * id_alicuota_iva). Si vienen undefined se preservan vía chequeo explícito.
 */
async function actualizarProducto(client, datos) {
    const {
        id_producto, sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva, unidad_medida, tiene_variantes, url_imagen, cod_proveedor,
        variante_atributos
    } = datos;

    // Bloque 7.1: validacion CHECK chk_productos_cat_distinta_subcat fail-fast
    //   Solo si vienen AMBOS truthy y son iguales. La semantica preservar/limpiar
    //   se mantiene: si solo viene id_subcategoria, el CHECK del DB lo valida igual.
    if (id_categoria && id_subcategoria &&
        parseInt(id_categoria) === parseInt(id_subcategoria)) {
        throw Object.assign(
            new Error(`actualizarProducto: id_categoria y id_subcategoria no pueden ser iguales (ambos=${id_categoria})`),
            { statusCode: 400 }
        );
    }

    if (!id_producto || !Number.isInteger(parseInt(id_producto))) {
        throw Object.assign(new Error('id_producto es requerido y debe ser entero'), { statusCode: 400 });
    }

    // Validación NOT NULL de schema: sku y nombre no pueden quedar vacíos.
    // Interpretamos "" como intento de borrar → rechazamos explícitamente.
    const skuClean = typeof sku === 'string' ? sku.trim() : sku;
    const nombreClean = typeof nombre === 'string' ? nombre.trim() : nombre;

    if (sku !== undefined && (!skuClean || skuClean === '')) {
        throw Object.assign(new Error('SKU no puede quedar vacío (NOT NULL)'), { statusCode: 400 });
    }
    if (nombre !== undefined && (!nombreClean || nombreClean === '')) {
        throw Object.assign(new Error('Nombre no puede quedar vacío (NOT NULL)'), { statusCode: 400 });
    }

    // id_alicuota_iva es NOT NULL en productos (default 3, pero nunca NULL).
    // Si el caller lo envía, debe ser entero válido. Si no lo envía, se preserva.
    if (id_alicuota_iva !== undefined && (id_alicuota_iva === null || !Number.isInteger(parseInt(id_alicuota_iva)))) {
        throw Object.assign(
            new Error('id_alicuota_iva no puede ser NULL. Si el producto debe cambiar de alícuota, enviar id válido de alicuotasiva.'),
            { statusCode: 400 }
        );
    }

    // Helper interno: distingue "no tocar" (undefined) de "borrar" (null/"")
    // Devuelve un sentinel que el SQL interpreta con CASE para preservar.
    // Usamos un patrón con dos parámetros por campo: un flag y un valor.
    const preservar = (v) => v === undefined;
    const limpiar = (v) => v === null || v === '';

    // Construimos query dinámica solo con campos presentes (undefined → no incluir).
    const sets = [];
    const params = [];
    let i = 1;

    if (!preservar(sku)) {
        sets.push(`sku = $${i++}::varchar`);
        params.push(skuClean);  // no puede ser null (validado arriba)
    }
    if (!preservar(nombre)) {
        sets.push(`nombre = $${i++}::varchar`);
        params.push(nombreClean);
    }
    if (!preservar(descripcion)) {
        sets.push(`descripcion = $${i++}::text`);
        params.push(limpiar(descripcion) ? null : descripcion);
    }
    if (!preservar(id_categoria)) {
        sets.push(`id_categoria = $${i++}::integer`);
        params.push(limpiar(id_categoria) ? null : parseInt(id_categoria));
    }
    if (!preservar(id_subcategoria)) {
        sets.push(`id_subcategoria = $${i++}::integer`);
        params.push(limpiar(id_subcategoria) ? null : parseInt(id_subcategoria));
    }
    if (!preservar(id_marca)) {
        sets.push(`id_marca = $${i++}::integer`);
        params.push(limpiar(id_marca) ? null : parseInt(id_marca));
    }
    if (!preservar(id_alicuota_iva)) {
        sets.push(`id_alicuota_iva = $${i++}::integer`);
        params.push(parseInt(id_alicuota_iva));  // validado NOT NULL arriba
    }
    if (!preservar(unidad_medida)) {
        // unidad_medida tiene default 'unidades' pero es nullable en schema.
        // Permitimos limpiar igual (null explícito) si el caller lo pide.
        sets.push(`unidad_medida = $${i++}::varchar`);
        params.push(limpiar(unidad_medida) ? null : unidad_medida);
    }
    if (!preservar(tiene_variantes)) {
        sets.push(`tiene_variantes = $${i++}::boolean`);
        params.push(Boolean(tiene_variantes));
    }
    if (!preservar(url_imagen)) {
        sets.push(`url_imagen = $${i++}::varchar`);
        params.push(limpiar(url_imagen) ? null : url_imagen);
    }
    if (!preservar(cod_proveedor)) {
        sets.push(`cod_proveedor = $${i++}::varchar`);
        params.push(limpiar(cod_proveedor) ? null : cod_proveedor);
    }
    if (!preservar(variante_atributos)) {
        sets.push(`variante_atributos = $${i++}::jsonb`);
        params.push(limpiar(variante_atributos) ? null : JSON.stringify(variante_atributos));
    }

    if (sets.length === 0) {
        // Nada que actualizar en productos — aún así devolvemos estado actual
        // para que el caller tenga el objeto completo (consistente con versión anterior).
        const { rows } = await client.query(
            'SELECT * FROM productos WHERE id_producto = $1::integer AND activo = TRUE',
            [id_producto]
        );
        if (rows.length === 0) {
            throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
        }
        return rows[0];
    }

    params.push(id_producto);
    const result = await client.query(`
        UPDATE productos SET ${sets.join(', ')}
        WHERE id_producto = $${i}::integer AND activo = TRUE
        RETURNING *
    `, params);

    if (result.rows.length === 0) {
        throw Object.assign(new Error('Producto no encontrado o inactivo'), { statusCode: 404 });
    }

    logger.info(`[productos.helper] Producto actualizado: id=${id_producto} campos=[${sets.map(s => s.split(' = ')[0]).join(', ')}]`);
    return result.rows[0];
}

/**
 * Actualizar producto por campos dinámicos (para import)
 */
async function actualizarProductoDinamico(client, datos) {
    const { id_producto, nombre, descripcion, id_categoria, id_subcategoria, id_marca, unidad_medida } = datos;

    if (!id_producto) {
        throw Object.assign(new Error('id_producto es requerido'), { statusCode: 400 });
    }

    // Bloque 6b: validacion CHECK chk_productos_cat_distinta_subcat
    //   si vienen ambos truthy y son iguales, fail-fast con mensaje claro
    if (id_categoria && id_subcategoria && id_categoria === id_subcategoria) {
        throw Object.assign(
            new Error(`actualizarProductoDinamico: id_categoria y id_subcategoria no pueden ser iguales (ambos=${id_categoria})`),
            { statusCode: 400 }
        );
    }

    const updates = [];
    const params = [];
    let idx = 1;

    if (nombre) { updates.push(`nombre = $${idx++}`); params.push(nombre); }
    if (descripcion !== undefined && descripcion !== null) { updates.push(`descripcion = $${idx++}`); params.push(descripcion); }
    if (id_categoria) { updates.push(`id_categoria = $${idx++}`); params.push(id_categoria); }
    if (id_subcategoria) { updates.push(`id_subcategoria = $${idx++}`); params.push(id_subcategoria); }
    if (id_marca) { updates.push(`id_marca = $${idx++}`); params.push(id_marca); }
    if (unidad_medida) { updates.push(`unidad_medida = $${idx++}`); params.push(unidad_medida); }

    if (updates.length === 0) return false;

    params.push(id_producto);
    await client.query(
        `UPDATE productos SET ${updates.join(', ')} WHERE id_producto = $${idx}`,
        params
    );

    logger.info(`[productos.helper] Producto actualizado dinámico: id=${id_producto}, campos=${updates.length}`);
    return true;
}

/**
 * Desactivar producto (soft delete)
 */
async function desactivarProducto(client, datos) {
    const { id_producto } = datos;

    const result = await client.query(`
        UPDATE productos SET activo = FALSE
        WHERE id_producto = $1
        RETURNING id_producto, nombre
    `, [id_producto]);

    if (result.rows.length === 0) {
        throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
    }

    logger.info(`[productos.helper] Producto desactivado: id=${id_producto} - ${result.rows[0].nombre}`);
    return result.rows[0];
}

/**
 * Cambiar visible_web de un producto individual
 */
async function cambiarVisibleWeb(client, datos) {
    const { id_producto, visible_web } = datos;

    await client.query(
        `UPDATE productos SET visible_web = $1 WHERE id_producto = $2 AND activo = TRUE`,
        [visible_web, id_producto]
    );

    return true;
}

/**
 * Cambiar visible_web masivo (array de IDs)
 */
async function cambiarVisibleWebMasivo(client, datos) {
    const { ids, visible_web } = datos;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw Object.assign(new Error('Debe enviar IDs de productos'), { statusCode: 400 });
    }

    const result = await client.query(
        `UPDATE productos SET visible_web = $1, fecha_modificacion = NOW()
         WHERE id_producto = ANY($2) AND activo = true`,
        [visible_web, ids]
    );

    logger.info(`[productos.helper] Visible web masivo: ${result.rowCount} productos → ${visible_web}`);
    return result.rowCount;
}

/**
 * Cambiar estado activo masivo
 */
async function cambiarEstadoMasivo(client, datos) {
    const { ids, activar } = datos;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw Object.assign(new Error('Debe enviar IDs de productos'), { statusCode: 400 });
    }

    const nuevoEstado = activar === true;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

    const result = await client.query(
        `UPDATE productos SET activo = ${nuevoEstado}
         WHERE id_producto IN (${placeholders})
         RETURNING id_producto`,
        ids
    );

    logger.info(`[productos.helper] Estado masivo: ${result.rowCount} productos → activo=${nuevoEstado}`);
    return result.rows;
}

/**
 * Actualizar imagen de un producto
 */
async function actualizarImagen(client, datos) {
    const {
        id_producto,
        url_imagen,
        id_empresa = null,
        id_usuario = null,
        ip = null,
        motivo = null
    } = datos;

    // Leer URL anterior para payload de bitacora
    let urlAnterior = null;
    try {
        const { rows: prev } = await client.query(
            'SELECT url_imagen FROM productos WHERE id_producto = $1',
            [id_producto]
        );
        if (prev.length > 0) urlAnterior = prev[0].url_imagen;
    } catch (e) { /* no bloquea */ }

    await client.query(`
        UPDATE productos SET url_imagen = $1, fecha_modificacion = NOW()
        WHERE id_producto = $2
    `, [url_imagen, id_producto]);

    // Bitacora (no bloqueante, misma transaccion del caller)
    await bitacora.registrar(client, {
        id_empresa, id_usuario, ip,
        entidad: bitacora.ENTIDADES.PRODUCTO,
        id_entidad: id_producto,
        accion: bitacora.ACCIONES.PRODUCTO_IMAGEN_ACTUALIZAR,
        payload: { url_anterior: urlAnterior, url_nueva: url_imagen || null },
        motivo
    });

    return true;
}

/**
 * Marcar producto como tiene_variantes = true
 */
async function setTieneVariantes(client, datos) {
    const { id_producto } = datos;

    await client.query(
        'UPDATE productos SET tiene_variantes = TRUE WHERE id_producto = $1',
        [id_producto]
    );

    logger.info(`[productos.helper] tiene_variantes=true: id=${id_producto}`);
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLA: precios — POR EMPRESA (PK: id_empresa, id_producto, id_lista_precio)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert de precios para múltiples listas de precio
 * @param {Client} client
 * @param {Object} datos - { id_empresa, id_producto, precios: [{ id_lista_precio, precio }] }
 */
async function upsertPrecios(client, datos) {
    // F3-2026-05-18: delegamos a precios.helper.escribirPrecio (single write point).
    // modo_input: 'BRUTO' (precio con IVA) | 'NETO' (sin IVA, default legacy).
    // contexto: para auditoria. Cada item puede sobreescribir modo_input.
    const { id_empresa, id_producto, precios, modo_input = 'NETO', contexto = 'upsertPrecios' } = datos;

    if (!precios || !Array.isArray(precios)) return 0;
    if (!id_empresa) throw Object.assign(new Error('id_empresa es requerido para upsert precios'), { statusCode: 400 });

    const preciosHelper = require('./precios.helper');
    let count = 0;
    for (const p of precios) {
        if (p.precio !== undefined && p.precio !== null) {
            await preciosHelper.escribirPrecio({
                id_empresa,
                id_producto,
                id_lista: p.id_lista_precio,
                precio_input: p.precio,
                modo_input: p.modo_input || modo_input,
                contexto: p.contexto || contexto,
                client
            });
            count++;
        }
    }

    return count;
}

/**
 * Upsert de precios desde mapa { id_lista: precio }
 * (formato usado por import)
 *
 * FIX 2026-04-17 (patrón SOLID sesión 12-abr):
 *   - ELIMINADO: `COALESCE(a.porcentaje, 21)` que ocultaba productos sin alícuota.
 *   - ELIMINADO: `parseFloat(inv?.iva_pct) || 21` que fallaba silenciosamente con IVA 0%.
 *   - Ahora: INNER JOIN + Number.isFinite. Si el producto no tiene alícuota activa
 *     o el costo_vigente no es numérico → throw explícito (falla visible, no drift).
 */
async function upsertPreciosMapa(client, datos) {
    // F3b-2026-05-18: upsertPreciosMapa delega la escritura del precio a precios.helper.escribirPrecio.
    // El margen_individual se maneja aparte porque no es responsabilidad de escribirPrecio.
    // Resultado: precio_con_iva queda entero (si la lista lo requiere) sin doble redondeo destructivo.
    const { id_empresa, id_producto, preciosMapa, margenesMapa } = datos;

    if ((!preciosMapa || !Object.keys(preciosMapa).length) && (!margenesMapa || !Object.keys(margenesMapa).length)) return 0;
    if (!id_empresa) throw Object.assign(new Error('id_empresa es requerido para upsert precios'), { statusCode: 400 });
    if (!id_producto) throw Object.assign(new Error('id_producto es requerido para upsert precios'), { statusCode: 400 });

    const { rows: [inv] } = await client.query(
        `SELECT i.costo_vigente, a.porcentaje AS iva_pct, a.id_alicuota
         FROM inventario i
         JOIN productos p ON p.id_producto = i.id_producto
         JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
         WHERE i.id_empresa = $1 AND i.id_producto = $2`,
        [id_empresa, id_producto]
    );

    if (!inv) {
        throw Object.assign(
            new Error(
                `productos.helper.upsertPreciosMapa: producto ${id_producto} (empresa ${id_empresa}) sin inventario o sin alicuota IVA.`
            ),
            { statusCode: 409 }
        );
    }

    const costo = parseFloat(inv.costo_vigente);
    const ivaPctRaw = parseFloat(inv.iva_pct);

    if (!Number.isFinite(ivaPctRaw) || ivaPctRaw < 0) {
        throw Object.assign(
            new Error(`productos.helper.upsertPreciosMapa: iva_pct invalido (${inv.iva_pct}) para producto ${id_producto}.`),
            { statusCode: 500 }
        );
    }

    const costoUtilizable = Number.isFinite(costo) && costo > 0 ? costo : 0;

    const todasListas = new Set([
        ...Object.keys(preciosMapa || {}),
        ...Object.keys(margenesMapa || {})
    ]);

    let count = 0;
    const preciosHelper = require('./precios.helper');

    for (const idLista of todasListas) {
        let precio = preciosMapa?.[idLista] ?? null;
        let margen = margenesMapa?.[idLista] ?? null;

        if (precio !== null && precio !== undefined) precio = parseFloat(precio);
        if (margen !== null && margen !== undefined) margen = parseFloat(margen);

        if (precio && !margen && costoUtilizable > 0) {
            margen = Math.round(((precio / costoUtilizable) - 1) * 1000) / 10;
        } else if (margen !== null && !precio && costoUtilizable > 0) {
            precio = costoUtilizable * (1 + margen / 100);
        }

        if (precio === null && margen === null) continue;

        if (margen !== null) margen = Math.min(999.999, Math.max(-999.999, Math.round(margen * 1000) / 1000));

        if (precio !== null) {
            await preciosHelper.escribirPrecio({
                id_empresa,
                id_producto,
                id_lista: parseInt(idLista),
                precio_input: precio,
                modo_input: 'NETO',
                contexto: 'upsertPreciosMapa',
                client
            });
        }

        if (margen !== null) {
            await client.query(`
                INSERT INTO precios (id_empresa, id_producto, id_lista_precio, precio, margen_individual)
                VALUES ($1, $2, $3, 0::numeric, $4)
                ON CONFLICT (id_empresa, id_producto, id_lista_precio) DO UPDATE SET
                    margen_individual = $4
            `, [id_empresa, id_producto, idLista, margen]);
        }

        count++;
    }

    return count;
}

/**
 * Actualizar un precio individual (para ajuste masivo)
 */
async function actualizarPrecio(client, datos) {
    const { id_empresa, id_producto, id_lista_precio, precio } = datos;

    await client.query(
        'UPDATE precios SET precio = $1 WHERE id_empresa = $2 AND id_producto = $3 AND id_lista_precio = $4',
        [precio, id_empresa, id_producto, id_lista_precio]
    );

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLA: inventario (solo configuración — stock via stock.helper.js)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crear registro de inventario para producto nuevo
 */
async function inicializarInventario(client, datos) {
    const { id_empresa, id_producto, stock_minimo = 0, stock_maximo = 0 } = datos;

    // Registro principal en inventario (cache/totales)
    await client.query(`
        INSERT INTO inventario (id_empresa, id_producto, stock_real, stock_minimo, stock_maximo)
        VALUES ($1, $2, 0, $3, $4)
        ON CONFLICT (id_empresa, id_producto) DO NOTHING
    `, [id_empresa, id_producto, stock_minimo, stock_maximo]);

    // Registro en deposito principal (fuente de verdad del stock)
    const depPrincipal = await client.query(
        'SELECT id_deposito FROM depositos WHERE id_empresa = $1 AND es_principal = TRUE LIMIT 1',
        [id_empresa]
    );
    if (depPrincipal.rows.length > 0) {
        await client.query(`
            INSERT INTO inventario_deposito (id_empresa, id_deposito, id_producto, stock_real, stock_comprometido)
            VALUES ($1, $2, $3, 0, 0)
            ON CONFLICT ON CONSTRAINT uq_inventario_deposito_empresa DO NOTHING
        `, [id_empresa, depPrincipal.rows[0].id_deposito, id_producto]);
    }

    logger.info(`[productos.helper] Inventario inicializado: empresa=${id_empresa}, producto=${id_producto}`);
    return true;
}

/**
 * Actualizar configuración de inventario (min, max)
 *
 * FIX 2026-04-17: placeholders estaban desalineados ($4/$5 con 4 params) —
 * causaba "could not determine data type of parameter $3" en toda edición
 * de producto. Ver bitácora Sesión 17-abr.
 */
async function actualizarInventarioConfig(client, datos) {
    const { id_empresa, id_producto, stock_minimo, stock_maximo } = datos;

    if (!id_empresa || !id_producto) {
        throw Object.assign(
            new Error('productos.helper.actualizarInventarioConfig: id_empresa e id_producto son obligatorios'),
            { statusCode: 400 }
        );
    }

    const result = await client.query(`
        UPDATE inventario SET
            stock_minimo = COALESCE($1::integer, stock_minimo),
            stock_maximo = COALESCE($2::integer, stock_maximo)
        WHERE id_empresa = $3 AND id_producto = $4
    `, [stock_minimo ?? null, stock_maximo ?? null, id_empresa, id_producto]);

    // Si no existe registro de inventario para ese (empresa, producto) es un
    // bug de integridad: el producto se creó sin pasar por inicializarInventario.
    // Exponemos el error en vez de dejar que la edición "parezca" exitosa.
    if (result.rowCount === 0) {
        throw Object.assign(
            new Error(`Inventario no encontrado para empresa=${id_empresa}, producto=${id_producto}. Ejecutar inicializarInventario primero.`),
            { statusCode: 409 }
        );
    }

    return true;
}

/**
 * Actualizar inventario dinámico (para import)
 */
async function actualizarInventarioDinamico(client, datos) {
    const { id_empresa, id_producto, stock_minimo, stock_maximo } = datos;

    const updates = [];
    const params = [];
    let idx = 1;

    if (stock_minimo !== null && stock_minimo !== undefined) {
        updates.push(`stock_minimo = $${idx++}`);
        params.push(stock_minimo);
    }
    if (stock_maximo !== null && stock_maximo !== undefined) {
        updates.push(`stock_maximo = $${idx++}`);
        params.push(stock_maximo);
    }

    if (updates.length === 0) return false;

    params.push(id_empresa, id_producto);
    await client.query(
        `UPDATE inventario SET ${updates.join(', ')} WHERE id_empresa = $${idx++} AND id_producto = $${idx}`,
        params
    );

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLA: producto_proveedor — POR EMPRESA (UNIQUE: id_empresa, id_producto, id_proveedor)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert de proveedores para un producto
 * Desactiva los anteriores y activa/crea los nuevos
 */
async function upsertProveedores(client, datos) {
    const { id_empresa, id_producto, proveedores, desactivar_anteriores = false } = datos;

    if (!proveedores || !Array.isArray(proveedores) || proveedores.length === 0) return 0;
    if (!id_empresa) throw Object.assign(new Error('id_empresa es requerido para upsert proveedores'), { statusCode: 400 });

    if (desactivar_anteriores) {
        await client.query(
            'UPDATE producto_proveedor SET activo = false WHERE id_empresa = $1 AND id_producto = $2',
            [id_empresa, id_producto]
        );
    }

    let count = 0;
    for (const prov of proveedores) {
        if (prov.id_proveedor) {
            await client.query(`
                INSERT INTO producto_proveedor (
                    id_empresa, id_producto, id_proveedor, codigo_proveedor,
                    precio_compra, descuento_porcentaje, activo
                ) VALUES ($1, $2, $3, $4, COALESCE($5::numeric, 0), COALESCE($6::numeric, 0), true)
                ON CONFLICT (id_empresa, id_producto, id_proveedor) DO UPDATE SET
                    codigo_proveedor = COALESCE($4, producto_proveedor.codigo_proveedor),
                    precio_compra = COALESCE($5, producto_proveedor.precio_compra),
                    descuento_porcentaje = COALESCE($6, producto_proveedor.descuento_porcentaje),
                    activo = true
            `, [
                id_empresa, id_producto, prov.id_proveedor,
                prov.codigo_proveedor || null,
                prov.precio_compra ?? null,
                prov.descuento_porcentaje ?? null
            ]);
            count++;
        }
    }

    return count;
}

/**
 * Actualizar precio de compra de un proveedor individual
 */
async function actualizarPrecioCompra(client, datos) {
    const { id_empresa, id_producto, id_proveedor, precio_compra } = datos;

    await client.query(
        'UPDATE producto_proveedor SET precio_compra = $1 WHERE id_empresa = $2 AND id_producto = $3 AND id_proveedor = $4',
        [precio_compra, id_empresa, id_producto, id_proveedor]
    );

    return true;
}

/**
 * Desactivar todos los proveedores de un producto
 */
async function desactivarProveedores(client, datos) {
    const { id_empresa, id_producto } = datos;

    await client.query(
        'UPDATE producto_proveedor SET activo = false WHERE id_empresa = $1 AND id_producto = $2',
        [id_empresa, id_producto]
    );

    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLA: productocodigosbarras (COMPARTIDA — sin id_empresa)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Upsert codigo(s) de barras - delega a codigos-barra.helper
 * Acepta un string o array. Respeta modo configurado en configuraciones_empresa.
 * @param {Object} datos - { id_producto, codigo_barras, modo?, id_empresa?, validar_ean13? }
 */
async function upsertCodigoBarras(client, datos) {
    const { id_producto, codigo_barras, modo = 'acumular', validar_ean13 = false } = datos;
    if (!codigo_barras) return false;

    const codigos = Array.isArray(codigo_barras) ? codigo_barras : [codigo_barras];
    const resultados = await codigosBarraHelper.procesarSegunModo(client, {
        id_producto, codigos, modo, validar_ean13
    });

    // Log conflictos (codigo ya pertenece a otro producto)
    const conflictos = resultados.filter(r => r.conflicto);
    if (conflictos.length > 0) {
        logger.warn(`[productos.helper] Conflictos de codigos barra en producto ${id_producto}: ${conflictos.map(c => c.codigo).join(', ')}`);
    }

    return resultados.some(r => r.agregado);
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES COMPUESTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crear producto completo con todas sus relaciones
 */
async function crearProductoCompleto(client, datos) {
    const {
        id_empresa,
        sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva, unidad_medida = 'unidades',
        tiene_variantes = false, url_imagen, cod_proveedor,
        stock_minimo = 0, stock_maximo = 0,
        precios = [],
        proveedores = [],
        conjuntos = [],
        codigos_barra = []
    } = datos;

    if (!id_empresa) throw new Error('productos.helper.crearProductoCompleto: id_empresa obligatorio');

    // Resolver alícuota: si el caller no la pasó, usar la config de empresa (productos.alicuota_iva_defecto)
    let idAlicuotaResuelta = id_alicuota_iva;
    if (idAlicuotaResuelta == null) {
        const def = await ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa);
        idAlicuotaResuelta = def.id_alicuota;
    }

    // 1. Crear producto (compartido) — Bloque 7.1: incluye id_subcategoria
    const producto = await crearProducto(client, {
        sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva: idAlicuotaResuelta, unidad_medida, tiene_variantes,
        url_imagen, cod_proveedor
    });

    const id_producto = producto.id_producto;

    // 2. Inventario (por empresa)
    await inicializarInventario(client, {
        id_empresa, id_producto, stock_minimo, stock_maximo
    });

    // 3. Precios (por empresa)
    await upsertPrecios(client, { id_empresa, id_producto, precios });

    // 4. Proveedores (por empresa)
    await upsertProveedores(client, { id_empresa, id_producto, proveedores });

    // 5. Conjuntos
    for (const conj of conjuntos) {
        if (conj.id_conjunto) {
            await client.query(`
                INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id_conjunto, id_producto) DO NOTHING
            `, [id_empresa, conj.id_conjunto, id_producto, conj.cantidad || 1]);
        }
    }

    // 6. Codigos de barra (via codigos-barra.helper)
    if (codigos_barra && codigos_barra.length > 0) {
        await upsertCodigoBarras(client, {
            id_producto, codigo_barras: codigos_barra, modo: 'acumular'
        });
    }

    logger.info(`[productos.helper] Producto completo creado: ${sku} (id: ${id_producto})`);
    return producto;
}

/**
 * Actualizar producto completo con todas sus relaciones
 */
async function actualizarProductoCompleto(client, datos) {
    const {
        id_empresa, id_producto,
        sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva, unidad_medida, tiene_variantes,
        url_imagen, cod_proveedor,
        stock_minimo, stock_maximo,
        precios = [],
        proveedores = [],
        conjuntos
    } = datos;

    // 1. Actualizar producto (compartido) — Bloque 7.1: incluye id_subcategoria
    const producto = await actualizarProducto(client, {
        id_producto, sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
        id_alicuota_iva, unidad_medida, tiene_variantes,
        url_imagen, cod_proveedor
    });

    // 2. Inventario config (por empresa)
    if (stock_minimo !== undefined || stock_maximo !== undefined) {
        await actualizarInventarioConfig(client, {
            id_empresa, id_producto, stock_minimo, stock_maximo
        });
    }

    // 3. Precios (por empresa)
    await upsertPrecios(client, { id_empresa, id_producto, precios });

    // 4. Proveedores (por empresa)
    if (proveedores && proveedores.length > 0) {
        await upsertProveedores(client, {
            id_empresa, id_producto, proveedores, desactivar_anteriores: true
        });
    }

    // 5. Conjuntos
    if (conjuntos) {
        await client.query('DELETE FROM conjunto_items WHERE id_producto = $1 AND id_empresa = $2', [id_producto, id_empresa]);
        for (const conj of conjuntos) {
            if (conj.id_conjunto) {
                await client.query(`
                    INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id_conjunto, id_producto) DO NOTHING
                `, [id_empresa, conj.id_conjunto, id_producto, conj.cantidad || 1]);
            }
        }
    }

    logger.info(`[productos.helper] Producto completo actualizado: id=${id_producto}`);
    return producto;
}

/**
 * Importar producto desde Excel (nuevo)
 */
async function importarProductoNuevo(client, datos) {
    const {
        id_empresa, sku, nombre, descripcion, idCategoria, idSubcategoria, idMarca,
        unidad, idAlicuotaIva, tieneVariantes = false,
        stockMinimo = 0, stockMaximo = 0,
        precios = {}, margenes = {},
        idProveedor, codigoProveedor, precioCompra, descuentoProveedor,
        codigoBarras, urlImagen,
        codigosBarraModo = 'acumular', validarEAN13 = false
    } = datos;

    // 1. Crear producto (compartido) — Bloque 6b: incluye id_subcategoria + url_imagen
    const producto = await crearProducto(client, {
        sku, nombre, descripcion,
        id_categoria: idCategoria, id_subcategoria: idSubcategoria, id_marca: idMarca,
        unidad_medida: unidad || 'unidades',
        tiene_variantes: tieneVariantes,
        id_alicuota_iva: idAlicuotaIva,
        url_imagen: urlImagen || null
    });
    const id_producto = producto.id_producto;

    // 2. Inventario (por empresa)
    await inicializarInventario(client, {
        id_empresa, id_producto, stock_minimo: stockMinimo, stock_maximo: stockMaximo
    });

    // 3. Precios (por empresa)
    await upsertPreciosMapa(client, { id_empresa, id_producto, preciosMapa: precios, margenesMapa: margenes });

    // 4. Código de barras (compartido)
    await upsertCodigoBarras(client, { id_producto, codigo_barras: codigoBarras, modo: codigosBarraModo, validar_ean13: validarEAN13 });

    // 5. Proveedor (por empresa) — con proveedor resuelto SIEMPRE se crea el vinculo.
    //    Precio/descuento ausentes viajan como null: INSERT usa 0, UPDATE preserva
    //    el valor existente (politica columna-presente hasta el SQL).
    if (idProveedor) {
        await upsertProveedores(client, {
            id_empresa, id_producto,
            proveedores: [{
                id_proveedor: idProveedor,
                codigo_proveedor: codigoProveedor,
                precio_compra: precioCompra ?? null,
                descuento_porcentaje: descuentoProveedor ?? null
            }]
        });
    }

    return id_producto;
}

/**
 * Importar producto existente (actualizar desde Excel)
 */
async function importarProductoExistente(client, datos) {
    const {
        id_empresa, idProducto,
        nombre, descripcion, idCategoria, idSubcategoria, idMarca, unidad,
        precios = {}, margenes = {},
        stockMinimo, stockMaximo,
        codigoBarras, urlImagen,
        idProveedor, codigoProveedor, precioCompra, descuentoProveedor,
        codigosBarraModo = 'acumular', validarEAN13 = false,
        // Bloque 6b: para que actualizarImagen registre bitacora con id_usuario/ip del importer
        id_usuario = null, ip = null
    } = datos;

    let cambios = false;

    // 1. Actualizar campos del producto (compartido, dinámico) — Bloque 6b: incluye id_subcategoria
    const productoActualizado = await actualizarProductoDinamico(client, {
        id_producto: idProducto, nombre, descripcion,
        id_categoria: idCategoria, id_subcategoria: idSubcategoria,
        id_marca: idMarca, unidad_medida: unidad
    });
    if (productoActualizado) cambios = true;

    // 1.5 URL imagen — Bloque 6b: via actualizarImagen para preservar bitacora
    //     urlImagen puede venir undefined (no tocar), string '' (borrar), o URL valida (asignar)
    //     La validacion de regex/hosts se hace en el controller (Bloque 6c), no aca.
    if (urlImagen !== undefined && urlImagen !== null) {
        await actualizarImagen(client, {
            id_producto: idProducto,
            url_imagen: urlImagen || null,
            id_empresa, id_usuario, ip,
            motivo: 'actualizacion via importer Excel'
        });
        cambios = true;
    }

    // 2. Precios + margenes (por empresa)
    if (Object.keys(precios).length > 0 || Object.keys(margenes).length > 0) {
        await upsertPreciosMapa(client, { id_empresa, id_producto: idProducto, preciosMapa: precios, margenesMapa: margenes });
        cambios = true;
    }

    // 3. Inventario config (por empresa)
    if (stockMinimo !== null || stockMaximo !== null) {
        const invActualizado = await actualizarInventarioDinamico(client, {
            id_empresa, id_producto: idProducto,
            stock_minimo: stockMinimo, stock_maximo: stockMaximo
        });
        if (invActualizado) cambios = true;
    }

    // 4. Código de barras (compartido)
    if (codigoBarras) {
        await upsertCodigoBarras(client, { id_producto: idProducto, codigo_barras: codigoBarras, modo: codigosBarraModo, validar_ean13: validarEAN13 });
        cambios = true;
    }

    // 5. Proveedor (por empresa) — con proveedor resuelto SIEMPRE se upserta el vinculo.
    //    Precio/descuento ausentes viajan como null: INSERT usa 0, UPDATE preserva.
    if (idProveedor) {
        await upsertProveedores(client, {
            id_empresa, id_producto: idProducto,
            proveedores: [{
                id_proveedor: idProveedor,
                codigo_proveedor: codigoProveedor,
                precio_compra: precioCompra ?? null,
                descuento_porcentaje: descuentoProveedor ?? null
            }]
        });
        cambios = true;
    }

    return cambios;
}

// ═══════════════════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════


/**
 * Actualiza el costo_vigente de un producto (campo en tabla inventario).
 * Único punto de escritura directa de costo_vigente cuando el valor
 * viene CALCULADO externamente (ej: ajuste masivo por factor).
 *
 * Para recalcular costo desde producto_proveedor (proveedor preferido),
 * usar importacion-precios.helper.js::actualizarCostoVigente().
 */
async function setCostoVigente(client, { id_empresa, id_producto, costo_vigente }) {
    if (!id_empresa || !id_producto) {
        throw new Error('setCostoVigente: id_empresa e id_producto requeridos');
    }
    const costo = Number(costo_vigente);
    if (!(costo > 0)) return false;

    await client.query(
        'UPDATE inventario SET costo_vigente = $1 WHERE id_empresa = $2 AND id_producto = $3',
        [costo, id_empresa, id_producto]
    );
    return true;
}


// ═══════════════════════════════════════════════════════════════════════════
// FAMILIA (relación padre/hijo de productos para vista web agrupada)
//
// Modelo:
//   - Padre = producto ficticio (sin precio ni stock) marcado con tiene_variantes=true
//   - Hijos = productos reales con id_producto_padre apuntando al padre
//   - Nivel máximo 1: un padre no puede tener padre
//   - productos es tabla compartida → no se filtra por id_empresa aquí
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene la familia (padre/hermanos/hijos) de un producto.
 * Útil para alimentar el modal de edición.
 *
 * @returns {Object} { producto, padre, hermanos[], hijos[] }
 */
async function obtenerFamilia(client, { id_producto }) {
    if (!id_producto) {
        throw Object.assign(new Error('obtenerFamilia: id_producto requerido'), { statusCode: 400 });
    }

    const { rows: prodRows } = await client.query(`
        SELECT id_producto, sku, nombre, url_imagen, tiene_variantes, id_producto_padre, activo
        FROM productos
        WHERE id_producto = $1
    `, [id_producto]);
    if (prodRows.length === 0) {
        throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
    }
    const producto = prodRows[0];

    let padre = null;
    let hermanos = [];
    if (producto.id_producto_padre) {
        const { rows: padreRows } = await client.query(`
            SELECT id_producto, sku, nombre, url_imagen
            FROM productos WHERE id_producto = $1
        `, [producto.id_producto_padre]);
        padre = padreRows[0] || null;

        const { rows: hermRows } = await client.query(`
            SELECT id_producto, sku, nombre
            FROM productos
            WHERE id_producto_padre = $1 AND id_producto != $2 AND activo = true
            ORDER BY sort_key
        `, [producto.id_producto_padre, id_producto]);
        hermanos = hermRows;
    }

    let hijos = [];
    if (producto.tiene_variantes) {
        const { rows: hijosRows } = await client.query(`
            SELECT id_producto, sku, nombre, url_imagen
            FROM productos
            WHERE id_producto_padre = $1 AND activo = true
            ORDER BY sort_key
        `, [id_producto]);
        hijos = hijosRows;
    }

    return { producto, padre, hermanos, hijos };
}

/**
 * Busca productos elegibles para ser padre.
 * Filtra: tiene_variantes=true + sin padre propio + activo + no es el propio + no es descendiente.
 *
 * @returns {Array} [{id_producto, sku, nombre, url_imagen, hijos_count}]
 */
async function buscarPadresElegibles(client, { query, excluir_id, limite = 20 }) {
    if (!query || query.trim().length < 2) return [];

    const params = [`%${query.trim().toUpperCase()}%`];
    let excluirCond = '';

    if (excluir_id) {
        // Anti-ciclo en UI: excluye el propio producto y todos sus descendientes
        params.push(excluir_id);
        const idx = params.length;
        excluirCond = `
            AND p.id_producto != $${idx}
            AND p.id_producto NOT IN (
                WITH RECURSIVE descendientes AS (
                    SELECT id_producto FROM productos WHERE id_producto_padre = $${idx}
                    UNION ALL
                    SELECT pr.id_producto FROM productos pr
                    JOIN descendientes d ON pr.id_producto_padre = d.id_producto
                )
                SELECT id_producto FROM descendientes
            )
        `;
    }

    params.push(limite);
    const { rows } = await client.query(`
        SELECT
            p.id_producto, p.sku, p.nombre, p.url_imagen,
            (SELECT COUNT(*) FROM productos h WHERE h.id_producto_padre = p.id_producto AND h.activo = true)::int AS hijos_count
        FROM productos p
        WHERE p.activo = true
          AND p.tiene_variantes = true
          AND p.id_producto_padre IS NULL
          AND (UPPER(p.sku) LIKE $1 OR UPPER(p.nombre) LIKE $1)
          ${excluirCond}
        ORDER BY p.sort_key
        LIMIT $${params.length}
    `, params);

    return rows;
}

/**
 * Crea un producto padre ficticio (agrupador para web).
 *
 * REGLA: el caller debe resolver id_alicuota_iva antes (via ivaHelper),
 *        igual que crearProducto. Sin fallback hardcodeado.
 *
 * Defaults aplicados:
 *   - tiene_variantes = TRUE  (clave: marca como agrupador)
 *   - activo = TRUE
 *   - visible_web = TRUE
 *   - unidad_medida = 'unidades' (el universal en BD)
 *
 * NO crea registros en precios ni inventario (padre no se vende).
 *
 * @returns {Object} { id_producto, sku, nombre, url_imagen }
 */
async function crearProductoPadre(client, { sku, nombre, url_imagen, id_categoria, id_alicuota_iva, id_empresa = null, id_usuario = null, ip = null, motivo = null }) {
    if (!sku || !sku.trim()) {
        throw Object.assign(new Error('crearProductoPadre: sku requerido'), { statusCode: 400 });
    }
    if (id_alicuota_iva == null || !Number.isInteger(parseInt(id_alicuota_iva))) {
        throw new Error('crearProductoPadre: id_alicuota_iva obligatorio (resolver desde ivaHelper antes de llamar)');
    }

    // ─── Fix 2026-05-11 Bloque 5: validar id_categoria segun config ───
    // ─────────────────────────────────────────────────────────
    // INVARIANTE P4 DESACTIVADO (sesion 2026-05-12)
    // Razon: padre e hijos pueden tener categorias distintas sin trabar UX.
    // Bloque original respaldado en backups/G_H_PREP_*/productos.helper.js
    // ─────────────────────────────────────────────────────────


    const skuTrim = sku.trim();

    // ─── Guard de largo (single write point del SKU del padre) ───
    // productos.sku es VARCHAR(n). Validamos ANTES del INSERT para dar mensaje
    // claro en vez del 22001 ciego de Postgres. Largo leido del schema real (no hardcode).
    {
        const { rows: _m } = await client.query(
            "SELECT character_maximum_length AS max FROM information_schema.columns WHERE table_name='productos' AND column_name='sku'"
        );
        const _maxSku = (_m[0] && _m[0].max) || 50;
        if (skuTrim.length > _maxSku) {
            throw Object.assign(
                new Error(`SKU del padre "${skuTrim}" tiene ${skuTrim.length} caracteres, supera el maximo ${_maxSku}. En la columna SKU_Padre va el CODIGO del producto padre (corto), no su descripcion. Corregi esa columna o dejala vacia si el producto no tiene padre.`),
                { statusCode: 400 }
            );
        }
    }

    // SKU único (productos.sku tiene UNIQUE constraint, pero validamos antes para mensaje claro)
    const { rows: existe } = await client.query(`
        SELECT id_producto, nombre FROM productos WHERE UPPER(sku) = UPPER($1)
    `, [skuTrim]);
    if (existe.length > 0) {
        throw Object.assign(
            new Error(`SKU "${skuTrim}" ya existe (id=${existe[0].id_producto}: ${existe[0].nombre})`),
            { statusCode: 409 }
        );
    }

    const { rows } = await client.query(`
        INSERT INTO productos (
            sku, nombre, descripcion,
            id_categoria, id_alicuota_iva, unidad_medida,
            tiene_variantes, url_imagen,
            activo, visible_web
        ) VALUES (
            $1, $2, NULL,
            $3, $4, 'unidades',
            TRUE, $5,
            TRUE, TRUE
        )
        RETURNING id_producto, sku, nombre, url_imagen
    `, [
        skuTrim,
        (nombre || skuTrim).trim(),
        id_categoria || null,
        id_alicuota_iva,
        url_imagen || null
    ]);

    logger.info(`[productos.helper] Padre ficticio creado: id=${rows[0].id_producto}, sku=${rows[0].sku}`);

    // Bitacora (no bloqueante)
    await bitacora.registrar(client, {
        id_empresa, id_usuario, ip,
        entidad: bitacora.ENTIDADES.PRODUCTO,
        id_entidad: rows[0].id_producto,
        accion: bitacora.ACCIONES.PRODUCTO_PADRE_CREAR,
        payload: {
            sku: rows[0].sku,
            nombre: rows[0].nombre,
            url_imagen: rows[0].url_imagen || null,
            id_categoria: id_categoria || null,
            id_alicuota_iva
        },
        motivo
    });

    return rows[0];
}

// =========================================================================
// Bloque 7.6 - IDEMPOTENCIA: obtenerOCrearProductoPadre
// =========================================================================

/**
 * Bloque 7.6: variante get-or-create de crearProductoPadre, pensada para
 * flujos idempotentes (Excel re-importado, sincronizacion masiva) donde el
 * caller espera que un slug ya existente sea reutilizado y no un error.
 *
 * Politica:
 *   - Si NO existe ningun producto con ese SKU -> delega en crearProductoPadre.
 *   - Si existe + activo + tiene_variantes + id_producto_padre IS NULL
 *       -> reutiliza (registra PRODUCTO_PADRE_REUTILIZAR en bitacora).
 *   - Si existe pero INACTIVO -> throw 409 (consistente con politica
 *       short-circuit del importer: no resucitar bajas).
 *   - Si existe pero NO es padre raiz (es hijo o producto plano)
 *       -> throw 409 (conflicto real, abortar y avisar).
 *
 * crearProductoPadre queda intacta para el endpoint UI manual
 * (POST /api/productos/padre), donde create-or-fail SI es el contrato correcto.
 *
 * @param {Object} client - pg client/transaction
 * @param {Object} datos - mismos params que crearProductoPadre
 * @returns {Object} { id_producto, sku, nombre, url_imagen, created }
 *   - created=true  -> padre nuevo
 *   - created=false -> padre reutilizado
 */
async function obtenerOCrearProductoPadre(client, datos) {
    const sku = String(datos && datos.sku || '').trim();
    if (!sku) {
        throw Object.assign(new Error('obtenerOCrearProductoPadre: sku requerido'), { statusCode: 400 });
    }

    const { rows: existe } = await client.query(`
        SELECT id_producto, sku, nombre, url_imagen, activo, tiene_variantes, id_producto_padre
        FROM productos
        WHERE UPPER(sku) = UPPER($1)
    `, [sku]);

    if (existe.length === 0) {
        // No existe -> delegar en create. crearProductoPadre ya hace bitacora propia.
        const padre = await crearProductoPadre(client, datos);
        return Object.assign({}, padre, { created: true });
    }

    const p = existe[0];

    if (p.activo !== true) {
        throw Object.assign(
            new Error(`SKU "${sku}" existe pero esta INACTIVO (id=${p.id_producto}). No se resucitan bajas - renombra la familia o reactiva manualmente.`),
            { statusCode: 409 }
        );
    }

    if (p.tiene_variantes !== true || p.id_producto_padre !== null) {
        throw Object.assign(
            new Error(`SKU "${sku}" existe pero NO es padre raiz (id=${p.id_producto}, nombre="${p.nombre}"). Renombra la familia para evitar colision.`),
            { statusCode: 409 }
        );
    }

    // Es padre raiz, activo. Reutilizar.
    logger.info(`[productos.helper] Padre reutilizado: id=${p.id_producto}, sku=${p.sku}`);

    await bitacora.registrar(client, {
        id_empresa: datos.id_empresa || null,
        id_usuario: datos.id_usuario || null,
        ip:         datos.ip || null,
        entidad:    bitacora.ENTIDADES.PRODUCTO,
        id_entidad: p.id_producto,
        accion:     bitacora.ACCIONES.PRODUCTO_PADRE_REUTILIZAR,
        payload: {
            sku: p.sku,
            nombre: p.nombre,
            url_imagen: p.url_imagen || null,
            id_categoria_solicitada: datos.id_categoria || null
        },
        motivo: datos.motivo || null
    });

    return {
        id_producto: p.id_producto,
        sku:         p.sku,
        nombre:      p.nombre,
        url_imagen:  p.url_imagen,
        created:     false
    };
}

/**
 * Asigna o quita el padre de un producto.
 * id_padre = null → quita relación.
 *
 * Validaciones:
 *   - producto != padre (anti auto-padre)
 *   - padre existe, activo, tiene_variantes=true
 *   - padre no tiene padre propio (nivel max 1)
 *   - no genera ciclo (padre no está en descendientes del producto)
 *
 * @returns {Object} { id_producto, sku, nombre, id_producto_padre }
 */
async function asignarProductoPadre(client, { id_producto, id_padre, id_empresa = null, id_usuario = null, ip = null, motivo = null }) {
    if (!id_producto) {
        throw Object.assign(new Error('asignarProductoPadre: id_producto requerido'), { statusCode: 400 });
    }

    // Leer padre anterior para payload de bitacora
    let padreAnterior = null;
    try {
        const { rows: prev } = await client.query(
            'SELECT id_producto_padre FROM productos WHERE id_producto = $1',
            [id_producto]
        );
        if (prev.length > 0) padreAnterior = prev[0].id_producto_padre;
    } catch (e) { /* no bloquea */ }

    // Caso: quitar padre
    if (id_padre == null) {
        const { rows } = await client.query(`
            UPDATE productos
            SET id_producto_padre = NULL, fecha_modificacion = NOW()
            WHERE id_producto = $1
            RETURNING id_producto, sku, nombre, id_producto_padre
        `, [id_producto]);
        if (rows.length === 0) {
            throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
        }
        logger.info(`[productos.helper] Padre quitado: id=${id_producto}`);

        // Bitacora (no bloqueante)
        await bitacora.registrar(client, {
            id_empresa, id_usuario, ip,
            entidad: bitacora.ENTIDADES.PRODUCTO,
            id_entidad: id_producto,
            accion: bitacora.ACCIONES.PRODUCTO_PADRE_QUITAR,
            payload: { id_padre_anterior: padreAnterior, id_padre_nuevo: null },
            motivo
        });

        return rows[0];
    }

    // Validaciones para asignar
    if (parseInt(id_producto) === parseInt(id_padre)) {
        throw Object.assign(new Error('Un producto no puede ser su propio padre'), { statusCode: 400 });
    }

    // 1) Padre debe ser válido
    const { rows: padreRows } = await client.query(`
        SELECT id_producto, tiene_variantes, id_producto_padre, activo
        FROM productos WHERE id_producto = $1
    `, [id_padre]);
    if (padreRows.length === 0) {
        throw Object.assign(new Error(`Padre id=${id_padre} no encontrado`), { statusCode: 404 });
    }
    const padre = padreRows[0];
    if (!padre.activo) {
        throw Object.assign(new Error('El padre seleccionado no está activo'), { statusCode: 400 });
    }
    if (!padre.tiene_variantes) {
        throw Object.assign(new Error('El producto seleccionado no es agrupador (tiene_variantes=false)'), { statusCode: 400 });
    }
    if (padre.id_producto_padre != null) {
        throw Object.assign(new Error('El padre ya tiene padre (nivel máximo 1, no se permite anidar)'), { statusCode: 400 });
    }

    // 2) Anti-ciclo: id_padre no puede estar entre descendientes de id_producto
    const { rows: cicloRows } = await client.query(`
        WITH RECURSIVE descendientes AS (
            SELECT id_producto FROM productos WHERE id_producto_padre = $1
            UNION ALL
            SELECT p.id_producto FROM productos p
            JOIN descendientes d ON p.id_producto_padre = d.id_producto
        )
        SELECT 1 FROM descendientes WHERE id_producto = $2
    `, [id_producto, id_padre]);
    if (cicloRows.length > 0) {
        throw Object.assign(new Error('La asignación crearía un ciclo padre-hijo'), { statusCode: 400 });
    }

    // 3) Aplicar
    const { rows } = await client.query(`
        UPDATE productos
        SET id_producto_padre = $1, fecha_modificacion = NOW()
        WHERE id_producto = $2
        RETURNING id_producto, sku, nombre, id_producto_padre
    `, [id_padre, id_producto]);
    if (rows.length === 0) {
        throw Object.assign(new Error('Producto hijo no encontrado'), { statusCode: 404 });
    }

    logger.info(`[productos.helper] Padre asignado: id=${id_producto} → padre=${id_padre}`);

    // Bitacora (no bloqueante)
    await bitacora.registrar(client, {
        id_empresa, id_usuario, ip,
        entidad: bitacora.ENTIDADES.PRODUCTO,
        id_entidad: id_producto,
        accion: bitacora.ACCIONES.PRODUCTO_PADRE_ASIGNAR,
        payload: { id_padre_anterior: padreAnterior, id_padre_nuevo: id_padre },
        motivo
    });

    return rows[0];
}



// ═══════════════════════════════════════════════════════════════════════════
// CAMBIO DE ESTADO INDIVIDUAL (activar/desactivar 1 producto con trazabilidad)
// Requiere que el caller ya haya validado el permiso 'editar_estado_productos'.
// ═══════════════════════════════════════════════════════════════════════════
async function cambiarEstadoIndividual(client, { id_producto, id_empresa, nuevo_estado, motivo, id_usuario }) {
    if (!id_producto || !id_empresa) {
        const e = new Error('Faltan id_producto o id_empresa');
        e.statusCode = 400; throw e;
    }
    if (typeof nuevo_estado !== 'boolean') {
        const e = new Error('nuevo_estado debe ser boolean');
        e.statusCode = 400; throw e;
    }

    // Leer estado actual para validar y para devolver "estado_anterior"
    const prev = await client.query(
        'SELECT id_producto, sku, nombre, activo FROM productos WHERE id_producto = $1',
        [id_producto]
    );
    if (prev.rowCount === 0) {
        const e = new Error('Producto no encontrado');
        e.statusCode = 404; throw e;
    }
    const estado_anterior = prev.rows[0].activo;
    if (estado_anterior === nuevo_estado) {
        return {
            id_producto,
            sku: prev.rows[0].sku,
            nombre: prev.rows[0].nombre,
            estado_anterior,
            estado_nuevo: nuevo_estado,
            sin_cambios: true
        };
    }

    // UPDATE
    await client.query(
        'UPDATE productos SET activo = $1, fecha_modificacion = NOW() WHERE id_producto = $2',
        [nuevo_estado, id_producto]
    );

    return {
        id_producto,
        sku: prev.rows[0].sku,
        nombre: prev.rows[0].nombre,
        estado_anterior,
        estado_nuevo: nuevo_estado,
        motivo: motivo || null,
        id_usuario,
        sin_cambios: false
    };
}


// ═══════════════════════════════════════════════════════════════
// PAQUETES / RECETA (BOM) — producto_componentes
// ═══════════════════════════════════════════════════════════════

async function obtenerComponentes(db, params) {
    const { id_empresa, id_producto } = params;
    if (!id_empresa || !id_producto) throw new Error('productos.helper.obtenerComponentes: id_empresa e id_producto obligatorios');
    const { rows } = await db.query(`
        SELECT pc.id_producto_componente, pc.cantidad, pc.activo,
               p.sku, p.nombre
        FROM producto_componentes pc
        JOIN productos p ON p.id_producto = pc.id_producto_componente
        WHERE pc.id_empresa = $1 AND pc.id_producto = $2 AND pc.activo = true
        ORDER BY p.sku
    `, [id_empresa, id_producto]);
    return rows;
}

/**
 * Reemplaza la receta completa de un producto (set declarativo):
 * desactiva lo que no viene, upsertea lo que viene. Trazado con updated_by/at.
 * Reglas: sin auto-referencia, sin BOM anidado (un componente no puede tener receta).
 */
async function guardarComponentes(client, params) {
    const { id_empresa, id_producto, id_usuario } = params;
    const componentes = Array.isArray(params.componentes) ? params.componentes : [];
    if (!id_empresa || !id_producto) throw new Error('productos.helper.guardarComponentes: id_empresa e id_producto obligatorios');
    if (!id_usuario) throw new Error('productos.helper.guardarComponentes: id_usuario obligatorio');

    const limpios = [];
    const vistos = new Set();
    for (const c of componentes) {
        const idc = parseInt(c.id_producto_componente, 10);
        const cant = parseFloat(c.cantidad);
        if (!idc || isNaN(cant) || cant <= 0) throw Object.assign(new Error('Componente invalido: producto y cantidad > 0 obligatorios'), { statusCode: 400 });
        if (idc === parseInt(id_producto, 10)) throw Object.assign(new Error('Un paquete no puede contenerse a si mismo'), { statusCode: 400 });
        if (vistos.has(idc)) throw Object.assign(new Error('Componente repetido en la receta'), { statusCode: 400 });
        vistos.add(idc);
        limpios.push({ id: idc, cantidad: cant });
    }

    if (limpios.length > 0) {
        const ids = limpios.map(c => c.id);
        const anidado = await client.query(
            'SELECT p.sku FROM producto_componentes pc JOIN productos p ON p.id_producto = pc.id_producto WHERE pc.id_empresa = $1 AND pc.id_producto = ANY($2::int[]) AND pc.activo = true LIMIT 1',
            [id_empresa, ids]
        );
        if (anidado.rows.length > 0) {
            throw Object.assign(new Error('"' + anidado.rows[0].sku + '" ya es un paquete: no puede ser componente de otro (BOM anidado no soportado)'), { statusCode: 400 });
        }
    }

    await client.query(
        `UPDATE producto_componentes SET activo = false, updated_at = NOW(), updated_by = $3
         WHERE id_empresa = $1 AND id_producto = $2 AND activo = true
           AND id_producto_componente <> ALL($4::int[])`,
        [id_empresa, id_producto, id_usuario, limpios.map(c => c.id)]
    );
    for (const c of limpios) {
        await client.query(`
            INSERT INTO producto_componentes (id_empresa, id_producto, id_producto_componente, cantidad, activo, updated_at, updated_by)
            VALUES ($1, $2, $3, $4, true, NOW(), $5)
            ON CONFLICT (id_empresa, id_producto, id_producto_componente)
            DO UPDATE SET cantidad = EXCLUDED.cantidad, activo = true, updated_at = NOW(), updated_by = EXCLUDED.updated_by
        `, [id_empresa, id_producto, c.id, c.cantidad, id_usuario]);
    }
    return { id_producto, componentes: limpios.length };
}

module.exports = {
    obtenerComponentes,
    guardarComponentes,
    // Producto (compartido)
    crearProducto,
    actualizarProducto,
    actualizarProductoDinamico,
    desactivarProducto,
    cambiarEstadoIndividual,
    cambiarVisibleWeb,
    cambiarVisibleWebMasivo,
    cambiarEstadoMasivo,
    actualizarImagen,
    setTieneVariantes,

    // Precios (por empresa)
    upsertPrecios,
    upsertPreciosMapa,
    actualizarPrecio,

    // Inventario (config only, por empresa)
    inicializarInventario,
    actualizarInventarioConfig,
    actualizarInventarioDinamico,
    setCostoVigente,

    // Proveedores (por empresa)
    upsertProveedores,
    actualizarPrecioCompra,
    desactivarProveedores,

    // Códigos de barras (compartido)
    upsertCodigoBarras,

    // Operaciones compuestas
    crearProductoCompleto,
    actualizarProductoCompleto,
    importarProductoNuevo,
    importarProductoExistente,

    // Familia (padre/hijo para vista web agrupada)
    obtenerFamilia,
    buscarPadresElegibles,
    crearProductoPadre,
    obtenerOCrearProductoPadre, // Bloque 7.6
    asignarProductoPadre
};
