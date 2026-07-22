/**
 * ============================================================================
 * INVENTARIO-PRINT HELPER - ERP LAGO (2026-05-17)
 * ============================================================================
 * Prepara los datos del listado de inventario para renderizar la plantilla
 * Handlebars `templates/comprobantes/inventario_listado.hbs`.
 *
 * Single write point para la lógica de obtención: el controller llama acá,
 * no hace queries propias. Sigue patrón helper-céntrico del ERP.
 * ============================================================================
 */
'use strict';

const pool = require('../config/database');

/**
 * Obtiene datos para imprimir un listado de inventario.
 *
 * @param {number} id_empresa
 * @param {Object} opts
 * @param {number|null} opts.id_deposito  // si null, usa principal; si 'todos' agrega depósitos
 * @param {Object} opts.filtros  // mismos filtros que aplica el frontend
 *   { busqueda, id_marca, id_categoria, id_subcategoria, id_proveedor, stock, soloBajoMinimo }
 * @param {Array<number>|null} opts.ids_productos  // si se pasa, solo esos ids (override de filtros)
 * @param {string|null} opts.usuario_nombre
 * @returns {Promise<Object>}  // listo para Handlebars
 */
async function obtenerListadoParaImprimir(id_empresa, opts = {}) {
    if (!id_empresa) throw new Error('inventario-print.helper: id_empresa obligatorio');

    const filtros = opts.filtros || {};
    let id_deposito = opts.id_deposito;
    const todosDepositos = id_deposito === 'todos' || id_deposito === null || id_deposito === undefined;

    // Resolver depósito si no es "todos"
    let depositoNombre;
    if (todosDepositos) {
        depositoNombre = 'Todos los depósitos';
        // Para "todos", uso depósito principal como referencia de stock min/max
        const principal = await pool.query(
            `SELECT id_deposito FROM depositos WHERE id_empresa=$1 AND es_principal=true AND activo=true LIMIT 1`,
            [id_empresa]
        );
        if (principal.rows.length === 0) throw new Error('No hay depósito principal configurado');
        id_deposito = principal.rows[0].id_deposito;
    } else {
        const r = await pool.query(
            `SELECT nombre FROM depositos WHERE id_empresa=$1 AND id_deposito=$2 LIMIT 1`,
            [id_empresa, id_deposito]
        );
        if (r.rows.length === 0) throw new Error('Depósito no encontrado');
        depositoNombre = r.rows[0].nombre;
    }

    // Empresa - usa columnas REALES del schema (cuit, domicilio_fiscal, etc)
    const empR = await pool.query(
        `SELECT razon_social, nombre_fantasia, cuit, domicilio_fiscal, telefono, email
         FROM empresas WHERE id_empresa=$1 LIMIT 1`,
        [id_empresa]
    );
    const empRow = empR.rows[0] || {};
    const empresa = {
        razon_social:    empRow.razon_social    || 'LAGO',
        nombre_fantasia: empRow.nombre_fantasia || '',
        cuit:            empRow.cuit            || '',
        direccion:       empRow.domicilio_fiscal || '',
        telefono:        empRow.telefono        || '',
        email:           empRow.email           || ''
    };

    // Construir query base (mismo shape que /completo-extendido)
    const params = [id_empresa, parseInt(id_deposito, 10)];
    const where = ['p.activo = TRUE'];
    let paramIdx = 3;

    if (filtros.busqueda) {
        const terms = String(filtros.busqueda).trim().split(/\s+/).filter(Boolean);
        terms.forEach(t => {
            params.push('%' + t + '%');
            where.push(`(p.sku ILIKE $${paramIdx} OR p.nombre ILIKE $${paramIdx} OR m.nombre ILIKE $${paramIdx})`);
            paramIdx++;
        });
    }
    if (filtros.id_marca) {
        params.push(parseInt(filtros.id_marca, 10));
        where.push(`p.id_marca = $${paramIdx++}`);
    }
    if (filtros.id_categoria) {
        params.push(parseInt(filtros.id_categoria, 10));
        where.push(`p.id_categoria = $${paramIdx++}`);
    }
    if (filtros.id_subcategoria) {
        params.push(parseInt(filtros.id_subcategoria, 10));
        where.push(`p.id_subcategoria = $${paramIdx++}`);
    }
    if (filtros.id_proveedor) {
        params.push(parseInt(filtros.id_proveedor, 10));
        where.push(`EXISTS (SELECT 1 FROM producto_proveedor pp2
            WHERE pp2.id_empresa = $1 AND pp2.id_producto = p.id_producto
              AND pp2.id_proveedor = $${paramIdx} AND pp2.es_proveedor_preferido = TRUE AND pp2.activo = TRUE)`);
        paramIdx++;
    }
    if (Array.isArray(opts.ids_productos) && opts.ids_productos.length > 0) {
        const placeholders = opts.ids_productos.map(() => `$${paramIdx++}`).join(',');
        opts.ids_productos.forEach(id => params.push(parseInt(id, 10)));
        where.push(`p.id_producto IN (${placeholders})`);
    }

    // Filtros de stock (post-query, sobre stock_real)
    let stockFilter = '';
    if (filtros.soloBajoMinimo) {
        stockFilter = `AND COALESCE(id.stock_real, 0) < COALESCE(id.stock_minimo, 0) AND COALESCE(id.stock_minimo, 0) > 0`;
    } else if (filtros.stock === 'sin_stock') {
        stockFilter = `AND COALESCE(id.stock_real, 0) <= 0`;
    } else if (filtros.stock === 'bajo_minimo') {
        stockFilter = `AND COALESCE(id.stock_real, 0) > 0 AND COALESCE(id.stock_real, 0) <= COALESCE(id.stock_minimo, 0)`;
    } else if (filtros.stock === 'con_stock') {
        stockFilter = `AND COALESCE(id.stock_real, 0) > 0`;
    }

    const sql = `
        WITH oc_count AS (
            SELECT v.id_producto, COUNT(*) AS cnt
            FROM v_ordenes_compra_activas_por_producto v
            WHERE v.id_empresa = $1
            GROUP BY v.id_producto
        ),
        prov_pref AS (
            SELECT pp.id_producto, pr.razon_social
            FROM producto_proveedor pp
            LEFT JOIN proveedores pr ON pr.id_empresa = pp.id_empresa AND pr.id_proveedor = pp.id_proveedor
            WHERE pp.id_empresa = $1
              AND pp.es_proveedor_preferido = TRUE
              AND pp.activo = TRUE
        )
        SELECT
            p.id_producto, p.sku, p.nombre,
            m.nombre AS marca_nombre,
            COALESCE(id.stock_real, 0)::numeric        AS stock_real,
            COALESCE(id.stock_comprometido, 0)::numeric AS stock_comprometido,
            (COALESCE(id.stock_real, 0) - COALESCE(id.stock_comprometido, 0))::numeric AS stock_disponible,
            COALESCE(id.stock_minimo, 0)::numeric AS stock_minimo,
            COALESCE(id.stock_maximo, 0)::numeric AS stock_maximo,
            pp.razon_social  AS proveedor_preferido_nombre,
            COALESCE(oc.cnt, 0)::int AS ocs_activas_count
        FROM productos p
        LEFT JOIN inventario_deposito id
            ON id.id_empresa = $1
           AND id.id_producto = p.id_producto
           AND id.id_deposito = $2
        LEFT JOIN marcas m       ON m.id_marca = p.id_marca
        LEFT JOIN prov_pref pp   ON pp.id_producto = p.id_producto
        LEFT JOIN oc_count oc    ON oc.id_producto = p.id_producto
        WHERE ${where.join(' AND ')}
          ${stockFilter}
        ORDER BY COALESCE(p.sort_key, p.sku::text)
    `;

    const { rows } = await pool.query(sql, params);

    // Formatear cada fila para la plantilla (mejor preformatear en server que en HBS)
    const productos = rows.map(r => {
        const stockReal = parseFloat(r.stock_real);
        const stockMin  = parseFloat(r.stock_minimo);
        let filaClase = '';
        if (stockReal <= 0)                           filaClase = 'sin-stock';
        else if (stockReal <= stockMin && stockMin > 0) filaClase = 'bajo-min';
        return {
            sku:                       r.sku,
            nombre:                    r.nombre,
            marca_nombre:              r.marca_nombre || '-',
            stock_minimo_fmt:          fmtNum(r.stock_minimo),
            stock_maximo_fmt:          fmtNum(r.stock_maximo),
            stock_real_fmt:            fmtNum(r.stock_real),
            stock_disponible_fmt:      fmtNum(r.stock_disponible),
            ocs_activas_display:       r.ocs_activas_count > 0 ? String(r.ocs_activas_count) : '-',
            proveedor_preferido_nombre: r.proveedor_preferido_nombre || '-',
            fila_clase:                filaClase
        };
    });

    // Construir texto de filtros aplicados (para el header)
    const filtros_texto = construirTextoFiltros(filtros, opts);

    return {
        empresa,
        deposito_nombre:    depositoNombre,
        usuario_nombre:     opts.usuario_nombre || '',
        fecha_impresion:    new Date().toLocaleString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        }),
        cantidad:           productos.length,
        filtros_texto,
        productos
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Utilidades
// ────────────────────────────────────────────────────────────────────────────
function fmtNum(v) {
    const n = v == null ? 0 : (typeof v === 'number' ? v : parseFloat(v) || 0);
    if (Number.isInteger(n)) return n.toLocaleString('es-AR');
    return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function construirTextoFiltros(f, opts) {
    const partes = [];
    if (f.busqueda)                                  partes.push(`Búsqueda: "${f.busqueda}"`);
    if (f.marca_nombre)                              partes.push(`Marca: ${f.marca_nombre}`);
    else if (f.id_marca)                             partes.push(`Marca ID: ${f.id_marca}`);
    if (f.categoria_nombre)                          partes.push(`Categoría: ${f.categoria_nombre}`);
    else if (f.id_categoria)                         partes.push(`Categoría ID: ${f.id_categoria}`);
    if (f.subcategoria_nombre)                       partes.push(`Subcategoría: ${f.subcategoria_nombre}`);
    if (f.proveedor_nombre)                          partes.push(`Proveedor: ${f.proveedor_nombre}`);
    else if (f.id_proveedor)                         partes.push(`Proveedor ID: ${f.id_proveedor}`);
    if (f.stock === 'sin_stock')                     partes.push('Sin stock');
    else if (f.stock === 'bajo_minimo')              partes.push('Bajo mínimo');
    else if (f.stock === 'con_stock')                partes.push('Con stock');
    if (f.soloBajoMinimo)                            partes.push('Solo bajo mínimo');
    if (Array.isArray(opts.ids_productos) && opts.ids_productos.length > 0) {
        partes.push(`Selección de ${opts.ids_productos.length} productos`);
    }
    return partes.join(' · ');
}

module.exports = { obtenerListadoParaImprimir };
