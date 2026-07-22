/**
 * CONJUNTOS-WEB HELPER — ERP LAGO
 * Versión 2026-05-09 (Bloque 3 del rediseño catálogo web)
 *
 * Cambios vs versión anterior:
 *   - Cada categoría agrupada incluye imagen_url, count_productos, display_label
 *   - Herencia bidireccional padre↔hijo configurable (web.imagen.herencia_familia)
 *   - Heurística padre_unico (web.catalogo.heuristica_padre_unico)
 *   - Expone config_visual al frontend para aplicar a CSS custom properties
 *   - Conserva 100% retrocompat: campos viejos siguen en el response
 */

'use strict';

const configHelper     = require('./config.helper');
const carritoWebHelper = require('./carrito-web.helper');

// Defaults documentados en MAPEO_VENDIBILIDAD.md
const HERENCIA_FAMILIA_DEFAULT = 'bidireccional';
const IMAGEN_NIVEL_DEFAULT = 'padre_y_simple';
const IMAGEN_FALLBACK_ORDEN_DEFAULT = 'sort_key_asc';

// ─── API publica ───────────────────────────────────────────────────────────

async function listarTabs(client, id_empresa) {
  if (!client || !id_empresa) throw new Error('listarTabs: client e id_empresa requeridos');
  const { rows } = await client.query(`
    SELECT web_slug AS slug, web_label AS label, web_orden AS orden
    FROM conjuntos
    WHERE id_empresa = $1
      AND activo      = true
      AND web_visible = true
      AND web_slug IS NOT NULL
    ORDER BY web_orden ASC, nombre ASC
  `, [id_empresa]);
  return rows;
}

async function obtenerProductosDeTab(client, id_empresa, slug, id_cliente) {
  if (!client || !id_empresa || !slug) throw new Error('obtenerProductosDeTab: faltan params');

  const tab = await _cargarTab(client, id_empresa, slug);
  if (!tab) return null;

  const flags           = await _cargarFlagsWeb(client, id_empresa);
  const configVisual    = await _cargarConfigVisual(client, id_empresa);
  const id_lista_precio = await carritoWebHelper._resolverListaPrecio(client, id_empresa, id_cliente);

  const productos       = await _queryProductos(client, id_empresa, tab.id_conjunto, id_lista_precio, flags);
  const padresExternos  = await _queryPadresExternos(client, id_empresa, productos);

  const items  = _agruparJerarquico(productos, padresExternos, flags);
  const marcas = _extraerMarcasDisponibles(productos);

  return { tab, items, marcas, config_visual: configVisual };
}

// ─── Config ────────────────────────────────────────────────────────────────

async function _cargarTab(client, id_empresa, slug) {
  const { rows } = await client.query(`
    SELECT id_conjunto, web_slug AS slug, web_label AS label
    FROM conjuntos
    WHERE id_empresa=$1 AND web_slug=$2 AND web_visible=true AND activo=true
  `, [id_empresa, slug]);
  return rows[0] || null;
}

async function _cargarFlagsWeb(client, id_empresa) {
  const cfg = await configHelper.getPrefix(client, id_empresa, 'web.');
  const toBool = (v, def) => (v === undefined || v === null || v === '') ? def
                : typeof v === 'boolean' ? v
                : ['true','1','si','yes'].includes(String(v).toLowerCase().trim());
  return {
    solo_con_stock:         toBool(cfg['web.solo_productos_con_stock'], false),
    mostrar_stock:          toBool(cfg['web.mostrar_stock_disponible'], true),
    heuristica_padre_unico: toBool(cfg['web.catalogo.heuristica_padre_unico'], true),
    herencia_familia:       cfg['web.imagen.herencia_familia'] || HERENCIA_FAMILIA_DEFAULT,
  };
}

async function _cargarConfigVisual(client, id_empresa) {
  const cfg = await configHelper.getPrefix(client, id_empresa, 'web.');
  const num = (v, def) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  };
  return {
    imagen_slot_px:        num(cfg['web.catalogo.imagen_slot_px'], 130),
    imagen_slot_px_mobile: num(cfg['web.catalogo.imagen_slot_px_mobile'], 90),
    imagen_object_fit:     cfg['web.catalogo.imagen_object_fit'] || 'contain',
    placeholder_modo:      cfg['web.imagen.placeholder_modo'] || 'iniciales',
    placeholder_icono:     cfg['web.imagen.placeholder_icono'] || 'box-seam',
    placeholder_url:       cfg['web.imagen.placeholder_url'] || '',
    mostrar_disclaimer:    cfg['web.catalogo.mostrar_disclaimer_login'] === 'true',
    imagen_nivel:          cfg['web.catalogo.imagen_nivel'] || IMAGEN_NIVEL_DEFAULT,
    imagen_fallback_orden: cfg['web.catalogo.imagen_fallback_orden_hijos'] || IMAGEN_FALLBACK_ORDEN_DEFAULT,
  };
}

// ─── Queries ───────────────────────────────────────────────────────────────

async function _queryProductos(client, id_empresa, id_conjunto, id_lista_precio, flags) {
  const filtroStock = flags.solo_con_stock
    ? 'AND (COALESCE(inv.stock_real,0) - COALESCE(inv.stock_comprometido,0)) > 0'
    : '';

  const { rows } = await client.query(`
    SELECT
      p.id_producto,
      p.id_producto_padre,
      p.sku,
      p.nombre,
      p.sort_key,
      p.url_imagen,
      p.variante_atributos,
      m.nombre  AS marca,
      c.id_categoria,
      c.nombre  AS categoria,
      c.sort_key  AS categoria_sort_key,
      COALESCE(a.porcentaje, 0)::numeric AS iva_pct,
      pr.precio AS precio_neto,
      (COALESCE(inv.stock_real,0) - COALESCE(inv.stock_comprometido,0)) > 0 AS con_stock
    FROM conjunto_items ci
    JOIN productos p          ON p.id_producto   = ci.id_producto
    JOIN inventario inv       ON inv.id_producto = p.id_producto AND inv.id_empresa = $1
    LEFT JOIN precios pr      ON pr.id_producto  = p.id_producto
                              AND pr.id_empresa  = $1
                              AND pr.id_lista_precio = $3
    LEFT JOIN marcas m        ON m.id_marca      = p.id_marca
    LEFT JOIN categorias c    ON c.id_categoria  = p.id_categoria
    LEFT JOIN alicuotasiva a  ON a.id_alicuota   = p.id_alicuota_iva
    WHERE ci.id_conjunto  = $2
      AND ci.id_empresa   = $1
      AND p.activo        = true
      AND p.visible_web   = true
      ${filtroStock}
    ORDER BY p.sort_key
  `, [id_empresa, id_conjunto, id_lista_precio]);

  return rows;
}

async function _queryPadresExternos(client, id_empresa, productos) {
  const idsEnSet = new Set(productos.map(p => p.id_producto));
  const padresNec = new Set();
  for (const p of productos) {
    if (p.id_producto_padre && !idsEnSet.has(p.id_producto_padre)) padresNec.add(p.id_producto_padre);
  }
  if (!padresNec.size) return new Map();

  const { rows } = await client.query(`
    SELECT p.id_producto, p.sku, p.nombre, p.sort_key, p.url_imagen,
           m.nombre  AS marca,
           c.id_categoria,
           c.nombre  AS categoria,
           c.sort_key  AS categoria_sort_key
    FROM productos p
    LEFT JOIN marcas m     ON m.id_marca     = p.id_marca
    LEFT JOIN categorias c ON c.id_categoria = p.id_categoria
    WHERE p.id_producto = ANY($1::int[]) AND p.activo = true
  `, [Array.from(padresNec)]);

  const map = new Map();
  for (const r of rows) map.set(r.id_producto, r);
  return map;
}

// ─── Agrupacion jerarquica: categoria -> padre -> producto ─────────────────

function _agruparJerarquico(productos, padresExternos, flags) {
  const hijosPorPadre = new Map();
  const sinPadreEnSet = new Map();
  for (const p of productos) {
    if (p.id_producto_padre) {
      if (!hijosPorPadre.has(p.id_producto_padre)) hijosPorPadre.set(p.id_producto_padre, []);
      hijosPorPadre.get(p.id_producto_padre).push(p);
    } else {
      sinPadreEnSet.set(p.id_producto, p);
    }
  }

  const itemsBase = [];
  for (const [id, prod] of sinPadreEnSet.entries()) {
    const hijos = hijosPorPadre.get(id);
    if (hijos && hijos.length) {
      itemsBase.push(_itemPadre(prod, hijos, flags));
      hijosPorPadre.delete(id);
    } else {
      itemsBase.push(_itemSimple(prod, flags));
    }
  }
  for (const [idPadre, hijos] of hijosPorPadre.entries()) {
    const ext = padresExternos.get(idPadre);
    if (ext) itemsBase.push(_itemPadre(ext, hijos, flags));
    else     for (const h of hijos) itemsBase.push(_itemSimple(h, flags));
  }

  const porCategoria = new Map();
  const raicesSinCat = [];

  for (const it of itemsBase) {
    const catNombre = it._categoria || null;
    if (catNombre) {
      if (!porCategoria.has(catNombre)) {
        porCategoria.set(catNombre, {
          tipo: 'categoria',
          nombre: catNombre,
          id_categoria: it._id_categoria || null,
          _sort_key: it._categoria_sort_key || catNombre,
          items: []
        });
      }
      porCategoria.get(catNombre).items.push(it);
    } else {
      raicesSinCat.push(it);
    }
    delete it._categoria;
    delete it._id_categoria;
    delete it._categoria_sort_key;
  }

  for (const grupo of porCategoria.values()) {
    grupo.items.sort((a, b) => _cmpKey(a, b));
    _enriquecerCategoria(grupo, flags);
  }

  const itemsPlanos = [...porCategoria.values(), ...raicesSinCat];
  itemsPlanos.sort((a, b) => _cmpKey(a, b));

  for (const it of itemsPlanos) {
    delete it._sort_key;
    if (it.items) for (const sub of it.items) delete sub._sort_key;
  }
  return itemsPlanos;
}

// Calcula imagen_url, count_productos, display_label para una categoría.
// Esto es el corazón del rediseño visual.
function _enriquecerCategoria(cat, flags) {
  // La imagen del catalogo vive en el PRODUCTO (padre o simple), nunca en la categoria.
  // Aqui solo calculamos contador y display_label.
  let count = 0;
  const padres = [];

  for (const it of cat.items) {
    if (it.tipo === 'padre') {
      padres.push(it);
      count += it.hijos.length;
    } else {
      count++;
    }
  }

  // Heuristica padre_unico: si la categoria tiene UN solo padre con hijos y nada mas,
  // usar el nombre del padre como display_label.
  let display_label = cat.nombre;
  if (flags.heuristica_padre_unico && padres.length === 1 && cat.items.length === 1) {
    display_label = padres[0].nombre;
  }

  cat.imagen_url      = null;
  cat.count_productos = count;
  cat.display_label   = display_label;
}

function _cmpKey(a, b) {
  const A = (a._sort_key || a.nombre || '').toString();
  const B = (b._sort_key || b.nombre || '').toString();
  return A.localeCompare(B, 'es', { sensitivity: 'base' });
}

function _extraerMarcasDisponibles(productos) {
  const counts = new Map();
  for (const p of productos) {
    if (p.marca) counts.set(p.marca, (counts.get(p.marca) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([nombre, count]) => ({ nombre, count }))
    .sort((a, b) => b.count - a.count || a.nombre.localeCompare(b.nombre));
}

// ─── DTOs ──────────────────────────────────────────────────────────────────

function _itemPadre(padre, hijos, flags) {
  const hijoConFoto = hijos.find(h => h.url_imagen);
  let marca = padre.marca || null;
  if (!marca) {
    const marcasHijos = new Set(hijos.map(h => h.marca).filter(Boolean));
    if (marcasHijos.size === 1) marca = [...marcasHijos][0];
  }

  // Determinar la imagen del padre según la herencia configurada
  const herencia = flags.herencia_familia;
  let imagenPadre = padre.url_imagen || null;
  if (!imagenPadre && (herencia === 'padre_hereda_hijo' || herencia === 'bidireccional')) {
    imagenPadre = hijoConFoto?.url_imagen || null;
  }

  return {
    tipo:        'padre',
    id_producto: padre.id_producto,
    sku:         padre.sku,
    nombre:      padre.nombre,
    marca,
    imagen_url:  imagenPadre,
    hijos:       hijos.map(h => _hijoDto(h, flags, imagenPadre)),
    _sort_key:           padre.sort_key || padre.nombre,
    _categoria:          padre.categoria || null,
    _id_categoria:       padre.id_categoria || null,
    _categoria_sort_key: padre.categoria_sort_key || padre.categoria || null,
  };
}

function _itemSimple(p, flags) {
  return {
    tipo:        'simple',
    id_producto: p.id_producto,
    sku:         p.sku,
    nombre:      p.nombre,
    marca:       p.marca || null,
    imagen_url:  p.url_imagen || null,
    ..._preciosDto(p),
    ..._stockDto(p, flags),
    _sort_key:           p.sort_key || p.nombre,
    _categoria:          p.categoria || null,
    _id_categoria:       p.id_categoria || null,
    _categoria_sort_key: p.categoria_sort_key || p.categoria || null,
  };
}

function _hijoDto(h, flags, imagenPadre) {
  const herencia = flags.herencia_familia;
  let imagenHijo = h.url_imagen || null;
  if (!imagenHijo && (herencia === 'hijo_hereda_padre' || herencia === 'bidireccional')) {
    imagenHijo = imagenPadre || null;
  }
  return {
    id_producto:        h.id_producto,
    sku:                h.sku,
    nombre:             h.nombre,
    marca:              h.marca || null,
    imagen_url:         imagenHijo,
    variante_atributos: h.variante_atributos || null,
    ..._preciosDto(h),
    ..._stockDto(h, flags),
  };
}

function _preciosDto(p) {
  const neto = p.precio_neto != null ? Number(p.precio_neto) : null;
  const iva  = Number(p.iva_pct || 0);
  if (neto == null) return { precio: null, precio_neto: null, iva_pct: iva, sin_precio: true };
  const r2 = n => Math.round(n * 100) / 100;
  return { precio: r2(neto * (1 + iva / 100)), precio_neto: r2(neto), iva_pct: iva, sin_precio: false };
}

function _stockDto(p, flags) {
  return flags.mostrar_stock ? { con_stock: p.con_stock === true } : {};
}

module.exports = { listarTabs, obtenerProductosDeTab };
