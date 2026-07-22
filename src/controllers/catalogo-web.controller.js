/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CATALOGO-WEB CONTROLLER — ERP LAGO
 * Endpoints publicos del catalogo (productos visibles en web)
 * ═══════════════════════════════════════════════════════════════════════════
 * Lee TODA la configuracion via config.helper. Cero hardcodes.
 * Si hay cliente logueado, usa SU lista de precio. Si no, la publica.
 *
 * Rutas:
 *   GET /api/web/productos                  -> listado paginado con filtros
 *   GET /api/web/productos/:id              -> detalle
 *   GET /api/web/categorias                 -> categorias con productos visibles
 *   GET /api/web/marcas                     -> marcas con productos visibles
 */

const pool = require('../config/database');
const cfg  = require('../utils/config.helper');
const { generarBusquedaMultiPalabra } = require('../utils/busqueda.helper');

async function _resolverListaPrecio(client, id_empresa, id_cliente) {
    if (id_cliente) {
        const r = await client.query(
            'SELECT id_lista_precio FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
            [id_cliente, id_empresa]
        );
        if (r.rows.length && r.rows[0].id_lista_precio) return r.rows[0].id_lista_precio;
    }
    return await cfg.get(client, id_empresa, 'web.id_lista_precio_publica', 1);
}

// ─────────────────────────────────────────────────────────────────────────
// GET /productos
// query: q, id_categoria, id_marca, precio_min, precio_max, orden, limit, offset
// ─────────────────────────────────────────────────────────────────────────

const conjuntosWebHelper = require('../utils/conjuntos-web.helper');

exports.listarProductos = async (req, res) => {
    const id_empresa  = req.id_empresa_web;
    const id_cliente  = req.cliente_web ? req.cliente_web.id_cliente : null;

    // ─── Cargar configs web.* en un solo query ───
    const clientCfg = await pool.connect();
    let cfgMap;
    try {
        const rCfg = await clientCfg.query(
            `SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave LIKE 'web.%'`,
            [id_empresa]
        );
        cfgMap = {};
        for (const row of rCfg.rows) {
            const k = row.clave.replace('web.', '');
            cfgMap[k] = row.valor === 'true' ? true : row.valor === 'false' ? false : row.valor;
        }
    } finally {
        clientCfg.release();
    }

    const precioVisible = cfgMap['precio_visible_sin_login'] !== false;
    const mostrarStock  = cfgMap['mostrar_stock_disponible'] !== false;
    const soloConStock  = cfgMap['solo_productos_con_stock'] === true;

    // Lista de precio: si hay cliente logueado, su lista; si no, la pública
    let id_lista;
    if (id_cliente) {
        const c = await pool.connect();
        try { id_lista = await _resolverListaPrecio(c, id_empresa, id_cliente); }
        finally { c.release(); }
    } else {
        id_lista = Number(cfgMap['id_lista_precio_publica'] || 1);
    }

    const limit  = Math.min(parseInt(req.query.limit, 10) || 48, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    // BLOQUE_ORDEN_ALEATORIO_v1: default desde config; aleatorio se desactiva con búsqueda activa
    const ordenDefault = (req.query.q && req.query.q.trim())
        ? 'nombre-asc'
        : (cfgMap['catalogo.orden_default'] || 'aleatorio');
    let orden = req.query.orden || ordenDefault;
    if (orden === 'aleatorio' && req.query.q && req.query.q.trim()) orden = 'nombre-asc';

    // ─── WHERE dinámico (aplicado a Query A y Query C) ───
    // Solo productos top-level: id_producto_padre IS NULL
    // Un padre ficticio entra si tiene al menos un hijo visible+activo+con precio
    // Un simple entra si él mismo tiene precio en la lista
    const params = [id_empresa, id_lista];
    let where = `p.activo = true AND p.visible_web = true AND p.id_producto_padre IS NULL
                 AND (
                     EXISTS (SELECT 1 FROM precios pr2
                              WHERE pr2.id_producto = p.id_producto
                                AND pr2.id_empresa = $1
                                AND pr2.id_lista_precio = $2)
                     OR EXISTS (SELECT 1 FROM productos h
                                 WHERE h.id_producto_padre = p.id_producto
                                   AND h.activo = true
                                   AND h.visible_web = true
                                   AND EXISTS (SELECT 1 FROM precios pr3
                                                WHERE pr3.id_producto = h.id_producto
                                                  AND pr3.id_empresa = $1
                                                  AND pr3.id_lista_precio = $2))
                 )`;

    // BLOQUE_BUSQUEDA_HIJOS_v1: q matchea padre O cualquier hijo activo del padre
    if (req.query.q && req.query.q.trim()) {
        const b = generarBusquedaMultiPalabra(req.query.q, ['p.busqueda_vector'], params.length + 1);
        if (b) {
            const clausulaHijo = b.clausula.replace(/p\.busqueda_vector/g, 'h2.busqueda_vector');
            where += ` AND (
                ${b.clausula}
                OR EXISTS (
                    SELECT 1 FROM productos h2
                     WHERE h2.id_producto_padre = p.id_producto
                       AND h2.activo = true
                       AND h2.visible_web = true
                       AND ${clausulaHijo}
                )
            )`;
            params.push(...b.params);
        }
    }
    if (req.query.id_categoria) {
        params.push(parseInt(req.query.id_categoria, 10));
        where += ` AND p.id_categoria = $${params.length}`;
    }
    if (req.query.id_marca) {
        params.push(parseInt(req.query.id_marca, 10));
        where += ` AND p.id_marca = $${params.length}`;
    }
    if (req.query.id_conjunto) {
        const idConj = parseInt(req.query.id_conjunto, 10);
        if (!isNaN(idConj)) {
            params.push(idConj);
            where += ` AND (
                EXISTS (SELECT 1 FROM conjunto_items ci
                         WHERE ci.id_producto = p.id_producto
                           AND ci.id_conjunto = $${params.length})
                OR EXISTS (SELECT 1 FROM productos h
                            JOIN conjunto_items ci2 ON ci2.id_producto = h.id_producto
                            WHERE h.id_producto_padre = p.id_producto
                              AND ci2.id_conjunto = $${params.length})
            )`;
        }
    }
    if (req.query.precio_min) {
        params.push(parseFloat(req.query.precio_min));
        where += ` AND COALESCE(pr.precio, 0) * (1 + COALESCE(a.porcentaje, 21)/100) >= $${params.length}`;
    }
    if (req.query.precio_max) {
        params.push(parseFloat(req.query.precio_max));
        where += ` AND COALESCE(pr.precio, 0) * (1 + COALESCE(a.porcentaje, 21)/100) <= $${params.length}`;
    }
    if (soloConStock) {
        where += ' AND COALESCE(inv.stock_total, 0) > 0';
    }

    // ─── ORDER BY ───
    // BLOQUE_ORDEN_ALEATORIO_v1: seed sanitizado + priorización opcional por imagen
    const seedSan = String(req.query.seed || 'default').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32) || 'default';
    const priorizarImagen = String(cfgMap['catalogo.orden_aleatorio_priorizar_imagen'] || 'true').toLowerCase() === 'true';
    // FIX_NATURAL_SORT_v1: usar sort_key (zero-padded) en lugar de nombre alfabético
    let orderBy = 'p.sort_key ASC NULLS LAST, p.nombre ASC';
    if (orden === 'nombre-desc')      orderBy = 'p.sort_key DESC NULLS LAST, p.nombre DESC';
    else if (orden === 'precio-asc')  orderBy = 'precio_final ASC NULLS LAST';
    else if (orden === 'precio-desc') orderBy = 'precio_final DESC NULLS LAST';
    else if (orden === 'recientes')   orderBy = 'p.fecha_creacion DESC NULLS LAST';
    else if (orden === 'aleatorio') {
        const pref = priorizarImagen
            ? "(CASE WHEN p.url_imagen IS NULL OR p.url_imagen = '' THEN 1 ELSE 0 END), "
            : '';
        orderBy = `${pref}MD5(p.id_producto::text || '${seedSan}')`;
    }

    // FROM común (se usa en Query A y Query C)
    const stockJoin = `LEFT JOIN (
        SELECT id_producto, SUM(stock_real) AS stock_total
          FROM inventario_deposito
         WHERE id_empresa = $1
         GROUP BY id_producto
    ) inv ON inv.id_producto = p.id_producto`;

    const fromBase = `
          FROM productos p
          LEFT JOIN precios pr ON pr.id_producto = p.id_producto
                              AND pr.id_empresa = $1
                              AND pr.id_lista_precio = $2
          LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
          LEFT JOIN marcas m     ON m.id_marca     = p.id_marca
          LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
          ${stockJoin}`;

    // ─── Query A: página de top-level ───
    const paramsA = [...params, limit, offset];
    const sqlA = `
        SELECT p.id_producto, p.sku, p.nombre, p.descripcion, p.url_imagen,
               p.id_categoria, c.nombre AS categoria,
               p.id_marca, m.nombre AS marca,
               p.id_producto_padre,
               pr.precio AS precio_neto,
               COALESCE(a.porcentaje, 21)::numeric AS iva_pct,
               CASE WHEN pr.precio IS NULL THEN NULL
                    ELSE ROUND(pr.precio * (1 + COALESCE(a.porcentaje, 21) / 100), 2)
               END AS precio_final,
               COALESCE(inv.stock_total, 0)::numeric AS stock_total,
               EXISTS (SELECT 1 FROM productos h
                        WHERE h.id_producto_padre = p.id_producto
                          AND h.activo = true AND h.visible_web = true) AS es_padre
          ${fromBase}
         WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${paramsA.length - 1} OFFSET $${paramsA.length}
    `;

    // ─── Query C: total ───
    const sqlC = `SELECT COUNT(*)::int AS total ${fromBase} WHERE ${where}`;

    try {
        const [rA, rC] = await Promise.all([
            pool.query(sqlA, paramsA),
            pool.query(sqlC, params)
        ]);

        const filasTop = rA.rows;
        const total    = rC.rows[0].total;

        // ─── Query B: hijos de los padres que salieron ───
        const idsPadres = filasTop.filter(f => f.es_padre).map(f => f.id_producto);
        let hijosPorPadre = new Map();

        if (idsPadres.length > 0) {
            const sqlB = `
                SELECT p.id_producto, p.sku, p.nombre, p.descripcion, p.url_imagen,
                       p.id_categoria, c.nombre AS categoria,
                       p.id_marca, m.nombre AS marca,
                       p.id_producto_padre,
                       pr.precio AS precio_neto,
                       COALESCE(a.porcentaje, 21)::numeric AS iva_pct,
                       ROUND(pr.precio * (1 + COALESCE(a.porcentaje, 21) / 100), 2) AS precio_final,
                       COALESCE(inv.stock_total, 0)::numeric AS stock_total
                  ${fromBase}
                 WHERE p.activo = true AND p.visible_web = true
                   AND p.id_producto_padre = ANY($3::int[])
                   AND pr.precio IS NOT NULL
                 ORDER BY p.nombre ASC
            `;
            const rB = await pool.query(sqlB, [id_empresa, id_lista, idsPadres]);
            for (const h of rB.rows) {
                if (!hijosPorPadre.has(h.id_producto_padre)) {
                    hijosPorPadre.set(h.id_producto_padre, []);
                }
                hijosPorPadre.get(h.id_producto_padre).push(h);
            }
        }

        // ─── Armar cards ───
        const cfgFamilia = await _leerCfgFamilia(pool, id_empresa);
        const cards = [];
        for (const f of filasTop) {
            if (f.es_padre) {
                const hijos = hijosPorPadre.get(f.id_producto) || [];
                if (hijos.length === 0) continue; // padre sin hijos válidos, skip
                cards.push(_construirCardPadre(f, hijos, precioVisible, id_cliente, mostrarStock, cfgFamilia));
            } else {
                cards.push(_construirCardSimple(f, precioVisible, id_cliente, mostrarStock));
            }
        }

        return res.json({
            productos: cards,
            paginacion: { total, limit, offset, hay_mas: (offset + limit) < total }
        });
    } catch (e) {
        console.error('listarProductos error:', e);
        return res.status(500).json({ error: e.message });
    }
};

function _construirCardSimple(f, precioVisible, id_cliente, mostrarStock) {
    return {
        tipo: 'simple',
        id_producto: f.id_producto,
        sku:         f.sku,
        nombre:      f.nombre,
        descripcion: f.descripcion,
        url_imagen:  f.url_imagen,
        id_categoria: f.id_categoria,
        categoria:    f.categoria,
        id_marca:     f.id_marca,
        marca:        f.marca,
        precio:       (precioVisible || id_cliente) ? Number(f.precio_final) : null,
        precio_neto:  (precioVisible || id_cliente) ? Number(f.precio_neto) : null,
        iva_pct:      Number(f.iva_pct),
        stock_total:  mostrarStock ? Number(f.stock_total) : null,
        con_stock:    Number(f.stock_total) > 0,
        variantes:    null
    };
}

/**
 * Calcula la etiqueta corta de una variante removiendo el prefijo comun con el padre.
 * Ejemplo:
 *   padre: "MEMB. EN PASTA PRO TECHOS Y MUROS /CASA BLANCA PRO"
 *   hijo:  "MEMB. EN PASTA PRO TECHOS Y MUROS BLANCA 04LT CASASECA /CASA BLANCA PRO / 81011304"
 *   etiqueta: "BLANCA 04LT CASASECA / 81011304"
 *
 * Si no hay prefijo comun (ej: arenas), devuelve el nombre del hijo tal cual.
 * Si el resultado queda vacio o es mucho mas corto que el original, devuelve el nombre completo.
 */
function _calcularEtiquetaChip(nombrePadre, nombreHijo) {
    if (!nombrePadre || !nombreHijo) return nombreHijo || '';

    const padre = String(nombrePadre).trim();
    const hijo  = String(nombreHijo).trim();

    // 1. Remover PREFIJO comun (caracter por caracter, case insensitive)
    let i = 0;
    const lenPre = Math.min(padre.length, hijo.length);
    while (i < lenPre && padre[i].toUpperCase() === hijo[i].toUpperCase()) i++;

    if (i < 10) return hijo;  // prefijo comun muy corto, no recortar

    let etiqueta = hijo.substring(i).trim();

    // 2. Remover SUFIJO comun (desde el final, caracter por caracter)
    let pi = padre.length - 1;
    let hi = hijo.length - 1;
    while (pi >= i && hi >= i && padre[pi].toUpperCase() === hijo[hi].toUpperCase()) {
        pi--;
        hi--;
    }
    // hi+1 es donde empieza el sufijo comun en el hijo
    const sinSufijo = hijo.substring(i, hi + 1).trim();
    if (sinSufijo.length > 0) etiqueta = sinSufijo;

    // 3. Limpiar basura: slashes al inicio/fin, codigos numericos sueltos al final
    etiqueta = etiqueta.replace(/^[\s/.,:;\-_]+/, '').trim();
    etiqueta = etiqueta.replace(/[\s/.,:;\-_]+$/, '').trim();
    // Remover codigo de articulo suelto al final (ej: "/ 81011304")
    etiqueta = etiqueta.replace(/\s*\/\s*\d{5,}\s*$/, '').trim();
    // Remover slash suelto al final
    etiqueta = etiqueta.replace(/\s*\/\s*$/, '').trim();

    if (etiqueta.length === 0) return hijo;

    return etiqueta;
}

// ─── BLOQUE_A_SELECTOR_v1 ─── helper de modo familia ───
async function _leerCfgFamilia(pool, id_empresa) {
    const r = await pool.query(
        "SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave LIKE 'web.familia.%'",
        [id_empresa]
    );
    const map = {};
    for (const row of r.rows) map[row.clave] = row.valor;
    const umbral = parseInt(map['web.familia.umbral_chips_max'], 10);
    return {
        umbral_chips: Number.isFinite(umbral) && umbral > 0 ? umbral : 8,
        placeholder:  map['web.familia.selector_placeholder'] || 'Buscá medida...',
        deep_link:    String(map['web.familia.url_deep_link_habilitado'] || 'true').toLowerCase() !== 'false',
        // BLOQUE_BPRE3_BUSCADOR_v1
        mostrar_buscador: String(map['web.familia.selector_mostrar_buscador'] || 'false').toLowerCase() === 'true'
    };
}

// ─── BLOQUE_BPRE_ETIQUETA_v2 ─── algoritmo robusto de etiqueta corta ───
function _calcularEtiquetaChipV2(nombrePadre, nombreHijo) {
    if (!nombrePadre || !nombreHijo) return nombreHijo || '';
    const padre = String(nombrePadre).trim();
    const hijo  = String(nombreHijo).trim();

    // E1: prefijo comun char-by-char (case-insensitive), umbral 60% del padre y >=4 chars
    let i = 0;
    const len = Math.min(padre.length, hijo.length);
    while (i < len && padre[i].toUpperCase() === hijo[i].toUpperCase()) i++;
    if (padre.length > 0 && (i / padre.length) >= 0.6 && i >= 4) {
        let et = hijo.substring(i).trim().replace(/^[\s/.,:;\-_]+/, '').trim();
        if (et.length >= 1 && et.length <= 30) return et;
    }

    // E2: substring del padre dentro del hijo (case-insensitive)
    const idx = hijo.toUpperCase().indexOf(padre.toUpperCase());
    if (idx >= 0) {
        let et = hijo.substring(idx + padre.length).trim().replace(/^[\s/.,:;\-_]+/, '').trim();
        if (et.length >= 1 && et.length <= 30) return et;
    }

    // E3: ultimo token numerico (acepta guion, x, *, slash, punto entre digitos)
    const m = hijo.match(/\d+(?:[.\-x*\/]\d+)+|\d+/g);
    if (m && m.length > 0) {
        const ult = m[m.length - 1];
        if (ult.length <= 12) return ult;
    }

    return hijo;
}
// ─── /BLOQUE_BPRE_ETIQUETA_v2 ───

function _construirCardPadre(padre, hijos, precioVisible, id_cliente, mostrarStock, cfgFamilia) {
    let url_imagen = padre.url_imagen;
    if (!url_imagen) {
        const hijoConFoto = hijos.find(h => h.url_imagen);
        if (hijoConFoto) url_imagen = hijoConFoto.url_imagen;
    }

    const preciosValidos = hijos.map(h => Number(h.precio_final)).filter(p => p > 0);
    const precioMin = preciosValidos.length > 0 ? Math.min(...preciosValidos) : 0;
    const stockTotal = hijos.reduce((acc, h) => acc + Number(h.stock_total || 0), 0);

    const variantes = hijos.map(h => ({
        id_producto:   h.id_producto,
        sku:           h.sku,
        nombre:        h.nombre,
        etiqueta_chip: _calcularEtiquetaChipV2(padre.nombre, h.nombre),
        url_imagen:    h.url_imagen,
        precio:        (precioVisible || id_cliente) ? Number(h.precio_final) : null,
        precio_neto:   (precioVisible || id_cliente) ? Number(h.precio_neto) : null,
        iva_pct:       Number(h.iva_pct),
        stock_total:   mostrarStock ? Number(h.stock_total) : null,
        con_stock:     Number(h.stock_total) > 0
    }));

    return {
        tipo: 'agrupado',
        id_producto:  padre.id_producto,
        sku:          padre.sku,
        nombre:       padre.nombre,
        descripcion:  padre.descripcion,
        url_imagen,
        id_categoria: padre.id_categoria,
        categoria:    padre.categoria,
        id_marca:     padre.id_marca,
        marca:        padre.marca,
        precio:       (precioVisible || id_cliente) ? precioMin : null,
        precio_desde: true,
        stock_total:  mostrarStock ? stockTotal : null,
        con_stock:    stockTotal > 0,
        modo:         hijos.length > cfgFamilia.umbral_chips ? 'selector' : 'chips',
        selector_placeholder: cfgFamilia.placeholder,
        selector_mostrar_buscador: cfgFamilia.mostrar_buscador,
        deep_link_habilitado: cfgFamilia.deep_link,
        variantes
    };
}

exports.detalleProducto = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const id_cliente = req.cliente_web ? req.cliente_web.id_cliente : null;
    const id_producto = parseInt(req.params.id, 10);
    if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });

    const client = await pool.connect();
    try {
        const id_lista      = await _resolverListaPrecio(client, id_empresa, id_cliente);
        const precioVisible = await cfg.get(client, id_empresa, 'web.precio_visible_sin_login', true);
        const mostrarStock  = await cfg.get(client, id_empresa, 'web.mostrar_stock_disponible', true);

        const r = await client.query(`
            SELECT p.id_producto, p.sku, p.nombre, p.descripcion, p.url_imagen,
                   p.id_categoria, c.nombre AS categoria,
                   p.id_marca, m.nombre AS marca,
                   pr.precio AS precio_neto,
                   COALESCE(a.porcentaje, 21)::numeric AS iva_pct,
                   ROUND(pr.precio * (1 + COALESCE(a.porcentaje, 21) / 100), 2) AS precio_final,
                   COALESCE((SELECT SUM(stock_real) FROM inventario_deposito
                              WHERE id_empresa = $1 AND id_producto = p.id_producto), 0)::numeric AS stock_total
              FROM productos p
              JOIN precios pr ON pr.id_producto = p.id_producto
                              AND pr.id_empresa = $1
                              AND pr.id_lista_precio = $2
              LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
              LEFT JOIN marcas m     ON m.id_marca     = p.id_marca
              LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
             WHERE p.id_producto = $3
               AND p.activo = true
               AND p.visible_web = true
             LIMIT 1
        `, [id_empresa, id_lista, id_producto]);

        if (!r.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
        const row = r.rows[0];
        return res.json({
            id_producto: row.id_producto,
            sku:         row.sku,
            nombre:      row.nombre,
            descripcion: row.descripcion,
            url_imagen:  row.url_imagen,
            categoria:   row.categoria,
            marca:       row.marca,
            precio:      precioVisible || id_cliente ? Number(row.precio_final) : null,
            precio_neto: precioVisible || id_cliente ? Number(row.precio_neto) : null,
            iva_pct:     Number(row.iva_pct),
            stock_total: mostrarStock ? Number(row.stock_total) : null,
            con_stock:   Number(row.stock_total) > 0
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /categorias
// ─────────────────────────────────────────────────────────────────────────

exports.listarCategorias = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const client = await pool.connect();
    try {
        const r = await client.query(`
            SELECT c.id_categoria, c.nombre, COUNT(p.id_producto)::int AS cant_productos
              FROM categorias c
              JOIN productos p ON p.id_categoria = c.id_categoria
                               AND p.activo = true
                               AND p.visible_web = true
             WHERE EXISTS (SELECT 1 FROM precios pr
                            WHERE pr.id_producto = p.id_producto
                              AND pr.id_empresa = $1)
             GROUP BY c.id_categoria, c.nombre
             HAVING COUNT(p.id_producto) > 0
             ORDER BY c.nombre ASC
        `, [id_empresa]);
        return res.json({ categorias: r.rows });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /marcas
// ─────────────────────────────────────────────────────────────────────────

exports.listarMarcas = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const client = await pool.connect();
    try {
        const r = await client.query(`
            SELECT m.id_marca, m.nombre, COUNT(p.id_producto)::int AS cant_productos
              FROM marcas m
              JOIN productos p ON p.id_marca = m.id_marca
                               AND p.activo = true
                               AND p.visible_web = true
             WHERE EXISTS (SELECT 1 FROM precios pr
                            WHERE pr.id_producto = p.id_producto
                              AND pr.id_empresa = $1)
             GROUP BY m.id_marca, m.nombre
             HAVING COUNT(p.id_producto) > 0
             ORDER BY m.nombre ASC
        `, [id_empresa]);
        return res.json({ marcas: r.rows });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─────────────────────────────────────────────────────────────────────────
// GET /info-empresa
// Devuelve datos de la empresa (footer, header, contacto, legal) + stats
// Todo desde configuraciones_empresa. Cero hardcodes.
// ─────────────────────────────────────────────────────────────────────────

exports.infoEmpresa = async (req, res) => {
    const id_empresa = req.id_empresa_web;
    const client = await pool.connect();
    try {
        // 1. Cargar TODAS las configs empresa.* + catalogo_web.* relevantes en 1 query
        const rCfg = await client.query(`
            SELECT clave, valor FROM configuraciones_empresa
             WHERE id_empresa = $1
               AND (clave LIKE 'empresa.%'
                    OR clave IN ('web.links_externos',
                                 'web.hero_compacto',
                                 'web.id_conjunto_ofertas',
                                 'web.id_lista_precio_publica'))
        `, [id_empresa]);

        const cfg = {};
        for (const row of rCfg.rows) {
            let v = row.valor;
            if (v === 'true') v = true;
            else if (v === 'false') v = false;
            cfg[row.clave] = v;
        }

        // 2. Parse seguro de links_externos (es JSON string)
        let links_externos = [];
        try {
            const raw = cfg['web.links_externos'];
            if (raw) links_externos = JSON.parse(raw);
        } catch (e) {
            console.error('infoEmpresa: links_externos JSON invalido:', e.message);
        }

        // 3a. Conjuntos disponibles (para breadcrumbs / filtros por ruta)
        const rConj = await client.query(`
            SELECT c.id_conjunto, c.nombre
              FROM conjuntos c
             WHERE c.id_empresa = $1 AND c.activo = true
               AND EXISTS (
                   SELECT 1 FROM conjunto_items ci
                     JOIN productos p ON p.id_producto = ci.id_producto
                    WHERE ci.id_conjunto = c.id_conjunto
                      AND p.activo = true AND p.visible_web = true
               )
             ORDER BY c.nombre ASC
        `, [id_empresa]);

        // 3b. Contador de productos visibles (para el hero stat)
        // Total de cards visibles top-level (padres con hijos + simples con precio en la lista pública)
        const id_lista_publica = parseInt(cfg['web.id_lista_precio_publica'] || '1', 10);
        const rCount = await client.query(`
            SELECT COUNT(*)::int AS total
              FROM productos p
             WHERE p.activo = true AND p.visible_web = true
               AND p.id_producto_padre IS NULL
               AND (
                   EXISTS (SELECT 1 FROM precios pr
                            WHERE pr.id_producto = p.id_producto
                              AND pr.id_empresa = $1
                              AND pr.id_lista_precio = $2)
                   OR EXISTS (SELECT 1 FROM productos h
                               WHERE h.id_producto_padre = p.id_producto
                                 AND h.activo = true
                                 AND h.visible_web = true)
               )
        `, [id_empresa, id_lista_publica]);

        return res.json({
            empresa: {
                nombre:          cfg['empresa.nombre']          || 'LAGO',
                slogan:          cfg['empresa.slogan']          || '',
                whatsapp:        cfg['empresa.whatsapp']        || '',
                telefono:        cfg['empresa.telefono']        || '',
                email:           cfg['empresa.email']           || '',
                direccion:       cfg['empresa.direccion']       || '',
                horarios:        cfg['empresa.horarios']        || '',
                razon_social:    cfg['empresa.razon_social']    || '',
                cuit:            cfg['empresa.cuit']            || '',
                condicion_iva:   cfg['empresa.condicion_iva']   || '',
                domicilio_legal: cfg['empresa.domicilio_legal'] || '',
                qr_afip_url:     cfg['empresa.qr_afip_url']     || ''
            },
            catalogo: {
                links_externos,
                hero_compacto:           cfg['web.hero_compacto'] === true,
                total_productos_visibles: rCount.rows[0].total,
                conjuntos_disponibles:    rConj.rows
            },
            actualizado_en: new Date().toISOString()
        });
    } catch (err) {
        console.error('infoEmpresa error:', err);
        return res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// ─── CONJUNTOS WEB (tabs B2B) ──────────────────────────────────────────────

exports.listarTabsConjuntos = async (req, res) => {
  const pool = require('../config/db');
  let client;
  try {
    client = await pool.connect();
    const id_empresa = Number(req.id_empresa_web || 1);
    const tabs = await conjuntosWebHelper.listarTabs(client, id_empresa);
    res.json({ tabs });
  } catch (err) {
    console.error('[catalogo-web] listarTabsConjuntos:', err);
    res.status(500).json({ error: 'Error listando tabs' });
  } finally {
    if (client) client.release();
  }
};

exports.productosDeTabConjunto = async (req, res) => {
  const pool = require('../config/db');
  let client;
  try {
    client = await pool.connect();
    const id_empresa = Number(req.id_empresa_web || 1);
    const id_cliente = req.cliente_web?.id_cliente || null;
    const slug       = String(req.params.slug || '').trim();
    if (!slug) return res.status(400).json({ error: 'slug requerido' });

    const data = await conjuntosWebHelper.obtenerProductosDeTab(client, id_empresa, slug, id_cliente);
    if (!data) return res.status(404).json({ error: 'Tab no encontrado' });

    res.json(data);
  } catch (err) {
    console.error('[catalogo-web] productosDeTabConjunto:', err);
    res.status(500).json({ error: 'Error obteniendo productos del tab' });
  } finally {
    if (client) client.release();
  }
};
