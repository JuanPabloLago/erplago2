/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPRAS IMPORTACIÓN HELPER — ERP LAGO v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * Responsabilidad ÚNICA: parsear un Excel de items, matchear productos contra
 * BD usando estrategias configurables, y dejar trazabilidad en
 * importaciones_compra_log.
 *
 * NO crea comprobantes. NO mueve stock. NO toca CC proveedores.
 * Esas responsabilidades son de compras.helper.js::crearComprobanteCompleto()
 * que se dispara cuando el usuario presiona Guardar.
 *
 * Config keys consumidas (todas desde configuraciones_empresa):
 *   compras.import_excel.primera_fila_header
 *   compras.import_excel.col_sku
 *   compras.import_excel.col_descripcion
 *   compras.import_excel.col_cantidad
 *   compras.import_excel.col_precio_unit
 *   compras.import_excel.col_descuento_porc
 *   compras.import_excel.max_filas
 *   compras.import_excel.estrategia_match
 *   compras.import_excel.fallar_si_producto_falta
 *   compras.iva_default_id_alicuota
 *
 * Exports: parsearExcel, validarYMatchear, registrarIntento, marcarConfirmado,
 *          ESTRATEGIAS
 * ═══════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');
const ExcelJS = require('exceljs');

const ESTRATEGIAS = Object.freeze({
    SKU:                'sku',
    COD_PROVEEDOR:      'cod_proveedor',
    PRODUCTO_PROVEEDOR: 'producto_proveedor',
    CODIGO_BARRA:       'codigo_barra'
});

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Parsea buffer Excel en modo POSICIONAL (no por headers). Devuelve filas
 * normalizadas: { fila_nro, sku, descripcion, cantidad, precio_unitario,
 * descuento_porcentaje }.
 * NO valida datos, NO toca BD.
 */
async function parsearExcel(buffer, config) {
    if (!buffer || !buffer.length) throw _err('Buffer vacío o inválido', 400);
    const cfg = config || {};
    const maxFilas = parseInt(cfg.max_filas != null ? cfg.max_filas : 500, 10);

    const col = {
        sku:         _letraAIdx(cfg.col_sku || 'A'),
        descripcion: _letraAIdx(cfg.col_descripcion || ''),
        cantidad:    _letraAIdx(cfg.col_cantidad || 'C'),
        precio:      _letraAIdx(cfg.col_precio_unit || 'D'),
        descuento:   _letraAIdx(cfg.col_descuento_porc || 'E')
    };
    if (col.sku < 1)      throw _err('col_sku inválida en config', 400);
    if (col.cantidad < 1) throw _err('col_cantidad inválida en config', 400);
    if (col.precio < 1)   throw _err('col_precio_unit inválida en config', 400);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 1) return [];

    const skipHeader = cfg.primera_fila_header === true || cfg.primera_fila_header === 'true';
    const firstRow = skipHeader ? 2 : 1;

    const filas = [];
    for (let r = firstRow; r <= ws.rowCount; r++) {
        if (filas.length >= maxFilas) break;
        const row = ws.getRow(r);
        const sku      = _cell(row, col.sku);
        const cantidad = _cell(row, col.cantidad);
        const precio   = _cell(row, col.precio);
        // Saltear fila vacía
        if (_esVacio(sku) && _esVacio(cantidad) && _esVacio(precio)) continue;
        filas.push({
            fila_nro: r,
            sku: sku != null ? String(sku).trim() : '',
            descripcion: col.descripcion > 0 ? _cell(row, col.descripcion) : null,
            cantidad: _toNum(cantidad),
            precio_unitario: _toNum(precio),
            descuento_porcentaje: col.descuento > 0 ? _toNum(_cell(row, col.descuento)) : 0
        });
    }
    return filas;
}

/**
 * Cruza cada fila contra BD aplicando las estrategias de match en cascada
 * según config. Devuelve estructura lista para enviar al frontend.
 * NO escribe en BD.
 */
async function validarYMatchear(pool, { id_empresa, id_proveedor, filas, config }) {
    if (!id_empresa) throw _err('id_empresa requerido', 400);
    if (!Array.isArray(filas)) throw _err('filas debe ser array', 400);
    const cfg = config || {};

    const estrategias = String(cfg.estrategia_match || 'sku,producto_proveedor,codigo_barra')
        .split(',').map(s => s.trim()).filter(Boolean);
    const fallarSinMatch = cfg.fallar_si_producto_falta === true || cfg.fallar_si_producto_falta === 'true';
    const ivaDefaultIdAlicuota = parseInt(cfg.iva_default_id_alicuota != null ? cfg.iva_default_id_alicuota : 3, 10);
    const ivaPctDefault = await _getIvaPctByAlicuotaId(pool, ivaDefaultIdAlicuota);

    const stats = { por_estrategia: {}, fallas_sin_match: 0 };
    estrategias.forEach(e => { stats.por_estrategia[e] = 0; });

    const validos = [];
    const errores = [];

    for (const fila of filas) {
        const errs = [];
        if (!fila.sku)                                             errs.push('SKU vacío');
        if (!(fila.cantidad > 0))                                  errs.push('Cantidad debe ser > 0');
        if (fila.precio_unitario == null || fila.precio_unitario < 0) errs.push('Precio inválido');
        const dto = parseFloat(fila.descuento_porcentaje) || 0;
        if (dto < 0 || dto > 100)                                  errs.push('Descuento fuera de rango 0–100');
        if (errs.length) {
            errores.push({ fila: fila.fila_nro, sku: fila.sku, errores: errs });
            continue;
        }

        // Match en cascada
        let producto = null, matchedBy = null;
        for (const estrategia of estrategias) {
            producto = await _matchProducto(pool, estrategia, {
                id_empresa, id_proveedor, codigo: fila.sku
            });
            if (producto) { matchedBy = estrategia; break; }
        }

        if (!producto) {
            stats.fallas_sin_match++;
            if (fallarSinMatch) {
                errores.push({ fila: fila.fila_nro, sku: fila.sku,
                               errores: ['Producto no encontrado por ninguna estrategia (' + estrategias.join(',') + ')'] });
                continue;
            }
            const desc = fila.descripcion ? String(fila.descripcion).trim() : '';
            if (!desc) {
                errores.push({ fila: fila.fila_nro, sku: fila.sku,
                               errores: ['Producto no encontrado y falta descripción'] });
                continue;
            }
            validos.push({
                fila_nro: fila.fila_nro,
                id_producto: null,
                sku: fila.sku,
                nombre: desc,
                cantidad: _round(fila.cantidad, 2),
                precio_unitario: _round(fila.precio_unitario, 4),
                descuento_porcentaje: _round(dto, 2),
                iva_porcentaje: ivaPctDefault,
                id_alicuota: ivaDefaultIdAlicuota,
                match_por: 'sin_match'
            });
            continue;
        }

        stats.por_estrategia[matchedBy]++;
        validos.push({
            fila_nro: fila.fila_nro,
            id_producto: producto.id_producto,
            sku: producto.sku,
            nombre: producto.nombre,
            cantidad: _round(fila.cantidad, 2),
            precio_unitario: _round(fila.precio_unitario, 4),
            descuento_porcentaje: _round(dto, 2),
            iva_porcentaje: producto.iva_porcentaje != null ? parseFloat(producto.iva_porcentaje) : ivaPctDefault,
            id_alicuota: producto.id_alicuota_iva || ivaDefaultIdAlicuota,
            match_por: matchedBy
        });
    }

    return { total: filas.length, validos, errores, stats };
}

/**
 * Registra el intento en importaciones_compra_log. Devuelve id_importacion.
 */
async function registrarIntento(client, {
    id_empresa, id_usuario, id_proveedor,
    archivo_nombre, archivo_buffer, resumen, estado
}) {
    if (!id_empresa) throw _err('id_empresa requerido', 400);
    if (!id_usuario) throw _err('id_usuario requerido', 400);

    const hash = archivo_buffer ? crypto.createHash('sha1').update(archivo_buffer).digest('hex') : null;
    const size = archivo_buffer ? archivo_buffer.length : null;

    const r = await client.query(
        `INSERT INTO importaciones_compra_log
         (id_empresa, id_usuario, id_proveedor, archivo_nombre, archivo_hash_sha1,
          archivo_size_bytes, filas_total, filas_ok, filas_error,
          match_por_estrategia, errores_json, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id_importacion`,
        [
            id_empresa, id_usuario, id_proveedor || null,
            archivo_nombre || null, hash, size,
            (resumen && resumen.total) || 0,
            (resumen && resumen.validos) ? resumen.validos.length : 0,
            (resumen && resumen.errores) ? resumen.errores.length : 0,
            JSON.stringify((resumen && resumen.stats) || {}),
            JSON.stringify((resumen && resumen.errores) || []),
            estado || 'preview'
        ]
    );
    return r.rows[0].id_importacion;
}

/**
 * Marca una importación como confirmada cuando el comprobante asociado se
 * crea exitosamente.
 */
async function marcarConfirmado(client, { id_importacion, id_comprobante }) {
    if (!id_importacion) return;
    await client.query(
        `UPDATE importaciones_compra_log
         SET estado = 'confirmado', id_comprobante = $2
         WHERE id_importacion = $1`,
        [id_importacion, id_comprobante || null]
    );
}

// ─── Internos ───────────────────────────────────────────────────────────────

async function _matchProducto(pool, estrategia, { id_empresa, id_proveedor, codigo }) {
    const cod = codigo != null ? String(codigo).trim() : '';
    if (!cod) return null;

    let sql, params;
    switch (estrategia) {
        case ESTRATEGIAS.SKU:
            sql = 'SELECT p.id_producto, p.sku, p.nombre, p.id_alicuota_iva, a.porcentaje AS iva_porcentaje ' +
                  'FROM productos p LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva ' +
                  'WHERE p.sku = $1 AND p.activo = TRUE LIMIT 1';
            params = [cod];
            break;
        case ESTRATEGIAS.COD_PROVEEDOR:
            sql = 'SELECT p.id_producto, p.sku, p.nombre, p.id_alicuota_iva, a.porcentaje AS iva_porcentaje ' +
                  'FROM productos p LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva ' +
                  'WHERE p.cod_proveedor = $1 AND p.activo = TRUE LIMIT 1';
            params = [cod];
            break;
        case ESTRATEGIAS.PRODUCTO_PROVEEDOR:
            if (!id_proveedor) return null;
            sql = 'SELECT p.id_producto, p.sku, p.nombre, p.id_alicuota_iva, a.porcentaje AS iva_porcentaje ' +
                  'FROM producto_proveedor pp ' +
                  'JOIN productos p ON p.id_producto = pp.id_producto ' +
                  'LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva ' +
                  'WHERE pp.id_empresa = $1 AND pp.id_proveedor = $2 AND pp.codigo_proveedor = $3 ' +
                  'AND pp.activo = TRUE AND p.activo = TRUE LIMIT 1';
            params = [id_empresa, id_proveedor, cod];
            break;
        case ESTRATEGIAS.CODIGO_BARRA:
            sql = 'SELECT p.id_producto, p.sku, p.nombre, p.id_alicuota_iva, a.porcentaje AS iva_porcentaje ' +
                  'FROM productocodigosbarras pcb ' +
                  'JOIN productos p ON p.id_producto = pcb.id_producto ' +
                  'LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva ' +
                  'WHERE pcb.codigo_barras = $1 AND p.activo = TRUE LIMIT 1';
            params = [cod];
            break;
        default:
            return null;
    }
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
}

async function _getIvaPctByAlicuotaId(pool, id_alicuota) {
    if (!id_alicuota) return null;
    const r = await pool.query(
        'SELECT porcentaje FROM alicuotasiva WHERE id_alicuota = $1 AND activo = TRUE LIMIT 1',
        [id_alicuota]
    );
    return r.rows[0] ? parseFloat(r.rows[0].porcentaje) : null;
}

function _letraAIdx(letra) {
    if (!letra || typeof letra !== 'string') return -1;
    const L = letra.trim().toUpperCase();
    if (!/^[A-Z]{1,2}$/.test(L)) return -1;
    let n = 0;
    for (let i = 0; i < L.length; i++) n = n * 26 + (L.charCodeAt(i) - 64);
    return n;
}

function _cell(row, colIdx) {
    const c = row.getCell(colIdx);
    if (!c) return null;
    const v = c.value;
    if (v == null) return null;
    if (typeof v === 'object' && 'result' in v) return v.result;
    if (typeof v === 'object' && 'text' in v)   return v.text;
    return v;
}

function _esVacio(v) { return v == null || v === ''; }

function _toNum(v) {
    if (_esVacio(v)) return 0;
    if (typeof v === 'number') return v;
    const s = String(v).trim().replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function _round(n, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round(parseFloat(n) * f) / f;
}

function _err(msg, status) {
    return Object.assign(new Error(msg), { statusCode: status || 500 });
}

module.exports = {
    ESTRATEGIAS,
    parsearExcel,
    validarYMatchear,
    registrarIntento,
    marcarConfirmado
};
