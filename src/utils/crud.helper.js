/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRUD HELPER — ERP LAGO — FASE 8d
 * Centraliza escrituras CRUD de entidades maestras:
 *   clientes, proveedores, depositos, conjuntos, conjunto_items
 * ═══════════════════════════════════════════════════════════════════════════
 * CONSUMIDORES: clientes.controller.js, proveedores.controller.js,
 *               depositos.controller.js, conjuntos.controller.js
 */

const categoriasHelper = require('./categorias.helper');

// ═══════════════════════════════ CLIENTES ═══════════════════════════════

async function crearCliente(client, datos) {
    const { id_empresa, razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona,
        domicilio, localidad, provincia, codigo_postal, telefono, email,
        id_lista_precio, limite_credito, descuento_predefinido, observaciones } = datos;
    const result = await client.query(`
        INSERT INTO clientes (id_empresa, razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona,
            domicilio, localidad, provincia, codigo_postal, telefono, email,
            id_lista_precio, limite_credito, descuento_predefinido, observaciones, activo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE) RETURNING *
    `, [id_empresa, razon_social.trim().toUpperCase(), nombre_fantasia?.trim() || null, cuit_cuil || null,
        id_condicion_iva, tipo_persona || 'juridica', domicilio?.trim() || null, localidad?.trim() || null,
        provincia?.trim() || null, codigo_postal?.trim() || null, telefono?.trim() || null,
        email?.trim().toLowerCase() || null, id_lista_precio || null, limite_credito || 0,
        descuento_predefinido || 0, observaciones?.trim() || null]);
    return result.rows[0];
}

async function actualizarCliente(client, datos) {
    const { id_cliente, id_empresa, razon_social, nombre_fantasia, cuit_cuil, id_condicion_iva, tipo_persona,
        domicilio, localidad, provincia, codigo_postal, telefono, email,
        id_lista_precio, limite_credito, descuento_predefinido, observaciones } = datos;
    const result = await client.query(`
        UPDATE clientes SET razon_social=$1, nombre_fantasia=$2, cuit_cuil=$3, id_condicion_iva=$4, tipo_persona=$5,
            domicilio=$6, localidad=$7, provincia=$8, codigo_postal=$9, telefono=$10, email=$11,
            id_lista_precio=$12, limite_credito=$13, descuento_predefinido=$14, observaciones=$15
        WHERE id_cliente=$16 AND id_empresa=$17 RETURNING *
    `, [razon_social.trim().toUpperCase(), nombre_fantasia?.trim() || null, cuit_cuil || null,
        id_condicion_iva, tipo_persona || 'juridica', domicilio?.trim() || null, localidad?.trim() || null,
        provincia?.trim() || null, codigo_postal?.trim() || null, telefono?.trim() || null,
        email?.trim().toLowerCase() || null, id_lista_precio || null, limite_credito || 0,
        descuento_predefinido || 0, observaciones?.trim() || null, id_cliente, id_empresa]);
    return result.rows[0];
}

async function desactivarCliente(client, datos) {
    const { id_cliente, id_empresa } = datos;
    const result = await client.query('UPDATE clientes SET activo = FALSE WHERE id_cliente = $1 AND id_empresa = $2 RETURNING id_cliente', [id_cliente, id_empresa]);
    return result.rows[0];
}

async function actualizarClientesMasivo(client, datos) {
    const { ids, id_empresa, campo, valor } = datos;
    const camposPermitidos = ['activo', 'id_lista_precio', 'descuento_predefinido'];
    if (!camposPermitidos.includes(campo)) throw new Error(`Campo no permitido: ${campo}`);
    const result = await client.query(`UPDATE clientes SET ${campo} = $1 WHERE id_cliente = ANY($2) AND id_empresa = $3`, [valor, ids, id_empresa]);
    return result.rowCount;
}

// ═══════════════════════════════ PROVEEDORES ═══════════════════════════════

async function crearProveedor(client, datos) {
    const { id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva,
        domicilio, localidad, provincia, codigo_postal, telefono, email,
        contacto_nombre, contacto_puesto, rubro } = datos;
    // F2a - Candado de identidad: CUIT verosimil + sin homonimos activos.
    // Bypass consciente: datos.omitir_validacion_identidad === true (ABM confirmando homonimo real).
    if (datos.omitir_validacion_identidad !== true) {
        const identidad = require('./proveedores-identidad.helper');
        const ev = await identidad.evaluarAltaProveedor(client, { id_empresa, razon_social, cuit });
        if (!ev.ok) {
            const det = ev.motivo === 'SIMILAR_EXISTENTE'
                ? 'Ya existe un proveedor similar: ' + ev.similares.map(function (s) {
                      return s.razon_social + ' (id ' + s.id_proveedor + ', ' + Math.round(s.similitud * 100) + '% similar)';
                  }).join(' | ') + '. Si es realmente OTRO proveedor, crealo desde el ABM de Proveedores.'
                : (ev.detalle || ev.motivo);
            throw Object.assign(
                new Error('Alta de proveedor bloqueada: ' + det),
                { statusCode: 409, codigo: 'PROVEEDOR_IDENTIDAD', motivo: ev.motivo, similares: ev.similares }
            );
        }
    }
    const result = await client.query(`
        INSERT INTO proveedores (id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva,
            domicilio, localidad, provincia, codigo_postal, telefono, email, contacto_nombre, contacto_puesto, rubro, activo)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE) RETURNING *
    `, [id_empresa, razon_social.trim().toUpperCase(), nombre_fantasia?.trim() || null, cuit || null,
        id_condicion_iva, domicilio?.trim() || null, localidad?.trim() || null, provincia?.trim() || null,
        codigo_postal?.trim() || null, telefono?.trim() || null, email?.trim().toLowerCase() || null,
        contacto_nombre?.trim() || null, contacto_puesto?.trim() || null, rubro?.trim() || null]);
    return result.rows[0];
}

async function actualizarProveedor(client, datos) {
    const { id_proveedor, id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva,
        domicilio, localidad, provincia, codigo_postal, telefono, email,
        contacto_nombre, contacto_puesto, rubro } = datos;
    const result = await client.query(`
        UPDATE proveedores SET razon_social=$1, nombre_fantasia=$2, cuit=$3, id_condicion_iva=$4,
            domicilio=$5, localidad=$6, provincia=$7, codigo_postal=$8, telefono=$9, email=$10,
            contacto_nombre=$11, contacto_puesto=$12, rubro=$13
        WHERE id_proveedor=$14 AND id_empresa=$15 RETURNING *
    `, [razon_social.trim().toUpperCase(), nombre_fantasia?.trim() || null, cuit || null, id_condicion_iva,
        domicilio?.trim() || null, localidad?.trim() || null, provincia?.trim() || null,
        codigo_postal?.trim() || null, telefono?.trim() || null, email?.trim().toLowerCase() || null,
        contacto_nombre?.trim() || null, contacto_puesto?.trim() || null, rubro?.trim() || null,
        id_proveedor, id_empresa]);
    return result.rows[0];
}

async function desactivarProveedor(client, datos) {
    const { id_proveedor, id_empresa } = datos;
    const result = await client.query('UPDATE proveedores SET activo = FALSE WHERE id_proveedor = $1 AND id_empresa = $2 RETURNING id_proveedor', [id_proveedor, id_empresa]);
    return result.rows[0];
}

async function actualizarProveedoresMasivo(client, datos) {
    const { ids, id_empresa, activo } = datos;
    const result = await client.query('UPDATE proveedores SET activo = $1 WHERE id_proveedor = ANY($2) AND id_empresa = $3', [activo, ids, id_empresa]);
    return result.rowCount;
}

// ═══════════════════════════════ DEPOSITOS ═══════════════════════════════

async function crearDeposito(client, datos) {
    const { id_empresa, codigo, nombre, direccion, telefono, responsable, es_principal } = datos;
    const result = await client.query(`
        INSERT INTO depositos (id_empresa, codigo, nombre, direccion, telefono, responsable, es_principal, activo, orden)
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,COALESCE((SELECT MAX(orden)+1 FROM depositos WHERE id_empresa=$1),0)) RETURNING *
    `, [id_empresa, codigo.toUpperCase(), nombre, direccion || null, telefono || null, responsable || null, es_principal || false]);
    return result.rows[0];
}

async function actualizarDeposito(client, datos) {
    const { id_deposito, id_empresa, codigo, nombre, direccion, telefono, responsable, es_principal, activo } = datos;
    const result = await client.query(`
        UPDATE depositos SET codigo=COALESCE($1,codigo), nombre=COALESCE($2,nombre), direccion=COALESCE($3,direccion),
            telefono=COALESCE($4,telefono), responsable=COALESCE($5,responsable), es_principal=COALESCE($6,es_principal),
            activo=COALESCE($7,activo), updated_at=NOW()
        WHERE id_deposito=$8 AND id_empresa=$9 RETURNING *
    `, [codigo ? codigo.toUpperCase() : null, nombre || null, direccion, telefono, responsable, es_principal, activo, id_deposito, id_empresa]);
    return result.rows[0];
}

async function quitarPrincipal(client, datos) {
    const { id_empresa } = datos;
    await client.query('UPDATE depositos SET es_principal = false WHERE id_empresa = $1 AND es_principal = true', [id_empresa]);
}

async function marcarPrincipal(client, datos) {
    const { id_empresa, id_deposito } = datos;
    if (!id_empresa) throw new Error('crud.helper.marcarPrincipal: id_empresa obligatorio');
    await client.query('UPDATE depositos SET es_principal = true, updated_at = NOW() WHERE id_deposito = $1 AND id_empresa = $2', [id_deposito, id_empresa]);
}

async function desactivarDeposito(client, datos) {
    const { id_empresa, id_deposito } = datos;
    if (!id_empresa) throw new Error('crud.helper.desactivarDeposito: id_empresa obligatorio');
    await client.query('UPDATE depositos SET activo = false, updated_at = NOW() WHERE id_deposito = $1 AND id_empresa = $2', [id_deposito, id_empresa]);
}

async function eliminarDeposito(client, datos) {
    const { id_deposito } = datos;
    await client.query('DELETE FROM depositos WHERE id_deposito = $1', [id_deposito]);
}

// ═══════════════════════════════ CONJUNTOS ═══════════════════════════════

async function crearConjunto(client, datos) {
    const { id_empresa, nombre, descripcion, precio_conjunto, descuento_porcentaje } = datos;
    const result = await client.query(`
        INSERT INTO conjuntos (id_empresa, nombre, descripcion, precio_conjunto, descuento_porcentaje, activo)
        VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING *
    `, [id_empresa, nombre, descripcion || null, precio_conjunto || 0, descuento_porcentaje || 0]);
    return result.rows[0];
}

async function actualizarConjunto(client, datos) {
    const {
        id_empresa, id_conjunto, nombre, descripcion, precio_conjunto, descuento_porcentaje,
        web_visible, web_slug, web_label, web_orden
    } = datos;

    // Normalizar slug: trim + lowercase. Vacio -> null (conjunto deja de ser tab).
    const slugNorm = (web_slug === undefined || web_slug === null)
        ? undefined
        : (String(web_slug).trim().toLowerCase() || null);

    const result = await client.query(`
        UPDATE conjuntos SET
            nombre=$1, descripcion=$2, precio_conjunto=$3, descuento_porcentaje=$4,
            web_visible = COALESCE($7, web_visible),
            web_slug    = CASE WHEN $8::text = '__UNSET__' THEN web_slug ELSE $8 END,
            web_label   = COALESCE($9, web_label),
            web_orden   = COALESCE($10, web_orden),
            fecha_modificacion = now()
        WHERE id_conjunto=$5 AND id_empresa=$6 AND activo=TRUE
        RETURNING *
    `, [
        nombre, descripcion || null, precio_conjunto || 0, descuento_porcentaje || 0,
        id_conjunto, id_empresa,
        web_visible === undefined ? null : !!web_visible,
        slugNorm === undefined ? '__UNSET__' : slugNorm,
        web_label === undefined ? null : (web_label || null),
        web_orden === undefined ? null : (Number.isFinite(Number(web_orden)) ? Number(web_orden) : null)
    ]);
    return result.rows[0];
}

async function desactivarConjunto(client, datos) {
    const { id_empresa, id_conjunto } = datos;
    const result = await client.query('UPDATE conjuntos SET activo=FALSE, fecha_modificacion=now() WHERE id_conjunto=$1 AND id_empresa=$2 RETURNING *', [id_conjunto, id_empresa]);
    return result.rows[0];
}

async function reemplazarConjuntoItems(client, datos) {
    const { id_empresa, id_conjunto, productos } = datos;
    await client.query('DELETE FROM conjunto_items WHERE id_conjunto = $1 AND id_empresa = $2', [id_conjunto, id_empresa]);
    for (const prod of productos) {
        await client.query('INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3,$4)',
            [id_empresa, id_conjunto, prod.id_producto, prod.cantidad || 1]);
    }
}

async function insertarConjuntoItems(client, datos) {
    const { id_empresa, id_conjunto, productos } = datos;
    for (const prod of productos) {
        await client.query('INSERT INTO conjunto_items (id_empresa, id_conjunto, id_producto, cantidad) VALUES ($1,$2,$3,$4)',
            [id_empresa, id_conjunto, prod.id_producto, prod.cantidad || 1]);
    }
}

module.exports = {
    crearCliente, actualizarCliente, desactivarCliente, actualizarClientesMasivo,
    crearProveedor, actualizarProveedor, desactivarProveedor, actualizarProveedoresMasivo,
    crearDeposito, actualizarDeposito, quitarPrincipal, marcarPrincipal, desactivarDeposito, eliminarDeposito,
    crearConjunto, actualizarConjunto, desactivarConjunto, reemplazarConjuntoItems, insertarConjuntoItems,
    crearCategoria, actualizarCategoria, desactivarCategoria,
    crearMarca, actualizarMarca, desactivarMarca,
    upsertCotizacion,
    crearVariante, actualizarVariante, desactivarVariante,
    actualizarArchivoOrigenMasivo
};

// ═══════════════════════════════ CATEGORIAS ═══════════════════════════════

async function crearCategoria(client, datos) {
    // Pass-through a categorias.helper.js (Bloque 3 - canonico)
    return categoriasHelper.crearCategoria(client, datos);
}

async function actualizarCategoria(client, datos) {
    // Pass-through a categorias.helper.js (Bloque 3 - canonico)
    return categoriasHelper.actualizarCategoria(client, datos);
}

async function desactivarCategoria(client, datos) {
    // Pass-through a categorias.helper.js (Bloque 3 - canonico)
    return categoriasHelper.desactivarCategoria(client, datos);
}

// ═══════════════════════════════ MARCAS ═══════════════════════════════

async function crearMarca(client, datos) {
    const { nombre, descripcion, pais_origen, sitio_web, logo } = datos;
    const result = await client.query(
        'INSERT INTO marcas (nombre, descripcion, pais_origen, sitio_web, logo, activo) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING *',
        [nombre, descripcion || null, pais_origen || null, sitio_web || null, logo || null]);
    return result.rows[0];
}

async function actualizarMarca(client, datos) {
    const { id_marca, nombre, descripcion, pais_origen, sitio_web, logo } = datos;
    const result = await client.query(
        'UPDATE marcas SET nombre=$1, descripcion=$2, pais_origen=$3, sitio_web=$4, logo=$5, fecha_modificacion=now() WHERE id_marca=$6 AND activo=TRUE RETURNING *',
        [nombre, descripcion || null, pais_origen || null, sitio_web || null, logo || null, id_marca]);
    return result.rows[0];
}

async function desactivarMarca(client, datos) {
    const { id_marca } = datos;
    const result = await client.query('UPDATE marcas SET activo=FALSE, fecha_modificacion=now() WHERE id_marca=$1 RETURNING *', [id_marca]);
    return result.rows[0];
}

// ═══════════════════════════════ COTIZACIONES ═══════════════════════════════

async function upsertCotizacion(client, datos) {
    const { id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, fuente, tipo } = datos;
    if (!id_empresa) throw new Error('upsertCotizacion: id_empresa es requerido');
    const result = await client.query(`
        UPDATE cotizaciones SET cotizacion_compra=$1, cotizacion_venta=$2,
            fecha_cotizacion=CURRENT_DATE, hora_cotizacion=CURRENT_TIME, fuente=$3, tipo=$4
        WHERE id_empresa=$5 AND id_moneda=$6 RETURNING *
    `, [cotizacion_compra, cotizacion_venta, fuente || 'Manual', tipo || 'manual', id_empresa, id_moneda]);
    if (result.rows.length === 0) {
        const insert = await client.query(`
            INSERT INTO cotizaciones (id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, fecha_cotizacion, hora_cotizacion, tipo, fuente)
            VALUES ($1,$2,$3,$4,CURRENT_DATE,CURRENT_TIME,$5,$6) RETURNING *
        `, [id_empresa, id_moneda, cotizacion_compra, cotizacion_venta, tipo || 'manual', fuente || 'Manual']);
        return insert.rows[0];
    }
    return result.rows[0];
}

// ═══════════════════════════════ VARIANTES ═══════════════════════════════

async function crearVariante(client, datos) {
    const { id_producto, nombre_variante, sku, precio, stock, stock_minimo, atributos } = datos;
    const result = await client.query(
        'INSERT INTO producto_variantes (id_producto, nombre_variante, sku, precio, stock, stock_minimo, atributos, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING *',
        [id_producto, nombre_variante, sku, precio || 0, stock || 0, stock_minimo || 0, atributos ? JSON.stringify(atributos) : null]);
    return result.rows[0];
}

async function actualizarVariante(client, datos) {
    const { id_variante, nombre_variante, sku, precio, stock, stock_minimo, atributos } = datos;
    const result = await client.query(
        'UPDATE producto_variantes SET nombre_variante=$1, sku=$2, precio=$3, stock=$4, stock_minimo=$5, atributos=$6, fecha_modificacion=now() WHERE id_variante=$7 AND activo=TRUE RETURNING *',
        [nombre_variante, sku, precio || 0, stock || 0, stock_minimo || 0, atributos ? JSON.stringify(atributos) : null, id_variante]);
    return result.rows[0];
}

async function desactivarVariante(client, datos) {
    const { id_variante } = datos;
    const result = await client.query('UPDATE producto_variantes SET activo=FALSE, fecha_modificacion=now() WHERE id_variante=$1 RETURNING *', [id_variante]);
    return result.rows[0];
}

// ═══════════════════════════════ ARCHIVO ORIGEN ═══════════════════════════════

async function actualizarArchivoOrigenMasivo(client, datos) {
    const { ids, archivo_origen } = datos;
    if (!ids || ids.length === 0) return 0;
    const result = await client.query('UPDATE productos SET archivo_origen = $1 WHERE id_producto = ANY($2)', [archivo_origen, ids]);
    return result.rowCount;
}
