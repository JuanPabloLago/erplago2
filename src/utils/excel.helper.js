'use strict';
const ExcelJS = require('exceljs');

const LAGO = {
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D6B45' } },
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11, name: 'Arial' },
    align: { horizontal: 'center', vertical: 'middle' }
};

function _headerStyle(ws, row) {
    var r = ws.getRow(row);
    r.eachCell(function(c) { c.font = LAGO.font; c.fill = LAGO.fill; c.alignment = LAGO.align; });
    r.height = 24;
}

function _colLetter(n) {
    var s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
}

/**
 * Exportar datos a buffer Excel.
 * @param {Object} o
 * @param {string} o.sheetName
 * @param {Array} o.columns - [{header, key, width, style?}]
 * @param {Array} o.rows - datos
 * @returns {Promise<Buffer>}
 */
async function exportar(o) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'ERP LAGO'; wb.created = new Date();
    var ws = wb.addWorksheet(o.sheetName);
    ws.columns = o.columns;
    o.rows.forEach(function(r) { ws.addRow(r); });
    _headerStyle(ws, 1);
    ws.autoFilter = { from: 'A1', to: _colLetter(o.columns.length) + '1' };
    return wb.xlsx.writeBuffer();
}

/**
 * Generar plantilla vacía con ejemplo + hoja instrucciones.
 */
async function generarPlantilla(o) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'ERP LAGO';
    var ws = wb.addWorksheet(o.sheetName);
    ws.columns = o.columns;
    _headerStyle(ws, 1);
    if (o.ejemplo) {
        var r = ws.addRow(o.ejemplo);
        r.eachCell(function(c) { c.font = { italic: true, color: { argb: 'FF888888' } }; });
    }
    if (o.instrucciones) {
        var wh = wb.addWorksheet('Instrucciones');
        wh.getCell('A1').value = 'INSTRUCCIONES';
        wh.getCell('A1').font = { bold: true, size: 14 };
        o.instrucciones.forEach(function(t, i) { wh.getCell('A' + (i + 3)).value = t; });
        wh.getColumn(1).width = 100;
    }
    return wb.xlsx.writeBuffer();
}

/**
 * Parsear buffer Excel → array de objetos. Headers normalizados.
 */
async function parsear(buffer) {
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    var ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) return [];
    var headers = [];
    ws.getRow(1).eachCell(function(c, col) {
        headers[col] = String(c.value || '').trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_]/g, '_');
    });
    var filas = [];
    ws.eachRow(function(row, n) {
        if (n === 1) return;
        var obj = {}, tiene = false;
        row.eachCell(function(c, col) {
            if (headers[col]) { obj[headers[col]] = c.value; if (c.value != null && c.value !== '') tiene = true; }
        });
        if (tiene) filas.push(obj);
    });
    return filas;
}

/**
 * Enviar buffer como descarga HTTP.
 */
function enviar(res, buffer, filename) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buffer);
}



// ═══════════════════════════════════════════════════════════════════
// FUNCIONES ESPECIALIZADAS — STOCK IMPORT/EXPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Generar plantilla de stock con formato avanzado.
 * Incluye: titulo, metadata oculta, headers coloreados, columna editable.
 *
 * @param {Object} o
 * @param {Object} o.deposito - { nombre, codigo }
 * @param {Array}  o.rows     - [{ sku, codigo_barras, nombre, categoria, marca, stock_actual }]
 * @param {number} o.id_empresa
 * @param {number} o.id_deposito
 * @returns {Promise<Buffer>}
 */
async function exportarPlantillaStock(o) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'ERP LAGO';
    wb.created = new Date();

    var ws = wb.addWorksheet('Stock', { properties: { defaultColWidth: 20 } });

    // ---- Metadata oculta (para validar al reimportar) ----
    var meta = wb.addWorksheet('_meta', { state: 'veryHidden' });
    meta.getCell('A1').value = 'id_empresa';
    meta.getCell('B1').value = o.id_empresa;
    meta.getCell('A2').value = 'id_deposito';
    meta.getCell('B2').value = o.id_deposito;
    meta.getCell('A3').value = 'deposito_nombre';
    meta.getCell('B3').value = o.deposito.nombre;
    meta.getCell('A4').value = 'fecha_exportacion';
    meta.getCell('B4').value = new Date().toISOString();
    meta.getCell('A5').value = 'total_productos';
    meta.getCell('B5').value = o.rows.length;

    // ---- Titulo informativo ----
    ws.mergeCells('A1:G1');
    var titleCell = ws.getCell('A1');
    titleCell.value = 'Stock - Deposito: ' + o.deposito.nombre + ' (' + (o.deposito.codigo || '') + ')';
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:G2');
    var dateCell = ws.getCell('A2');
    dateCell.value = 'Exportado: ' + new Date().toLocaleString('es-AR') + ' | Productos: ' + o.rows.length;
    dateCell.font = { italic: true, color: { argb: 'FF666666' } };
    dateCell.alignment = { horizontal: 'center' };

    // ---- Headers en fila 4 ----
    var HR = 4;
    var headers = [
        { header: 'SKU', width: 18 },
        { header: 'Cod. Barras', width: 18 },
        { header: 'Producto', width: 45 },
        { header: 'Categoria', width: 20 },
        { header: 'Marca', width: 20 },
        { header: 'Stock Actual', width: 15 },
        { header: 'STOCK NUEVO', width: 15 }
    ];

    headers.forEach(function(h, idx) {
        var cell = ws.getCell(HR, idx + 1);
        cell.value = h.header;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern', pattern: 'solid',
            fgColor: { argb: idx === 6 ? 'FF2E7D32' : 'FF1565C0' }
        };
        cell.alignment = { horizontal: 'center' };
        cell.border = { bottom: { style: 'thin' } };
        ws.getColumn(idx + 1).width = h.width;
    });

    // ---- Datos ----
    o.rows.forEach(function(row, rowIdx) {
        var excelRow = HR + 1 + rowIdx;
        ws.getCell(excelRow, 1).value = row.sku || '';
        ws.getCell(excelRow, 2).value = row.codigo_barras || '';
        ws.getCell(excelRow, 3).value = row.nombre;
        ws.getCell(excelRow, 4).value = row.categoria || '';
        ws.getCell(excelRow, 5).value = row.marca || '';

        // Stock actual (gris, solo lectura visual)
        var saCell = ws.getCell(excelRow, 6);
        saCell.value = parseFloat(row.stock_actual) || 0;
        saCell.numFmt = '#,##0.##';
        saCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        saCell.font = { color: { argb: 'FF999999' } };

        // Stock nuevo (verde claro, editable)
        var snCell = ws.getCell(excelRow, 7);
        snCell.value = null;
        snCell.numFmt = '#,##0.##';
        snCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };

        // Alternado para legibilidad
        if (rowIdx % 2 === 1) {
            for (var col = 1; col <= 5; col++) {
                ws.getCell(excelRow, col).fill = {
                    type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' }
                };
            }
        }
    });

    // Nota en header editable
    ws.getCell(HR, 7).note =
        'Complete esta columna con el stock real contado.\n' +
        'Deje vacias las filas que no quiera modificar.\n' +
        'Use 0 para indicar sin stock.';

    // Congelar headers + autofiltro
    ws.views = [{ state: 'frozen', ySplit: HR }];
    ws.autoFilter = {
        from: { row: HR, column: 1 },
        to: { row: HR + o.rows.length, column: 7 }
    };

    return wb.xlsx.writeBuffer();
}


/**
 * Parsear archivo Excel de stock importado.
 * Detecta fila de headers buscando "SKU" en columna A.
 * Retorna solo filas con stock_nuevo completado.
 *
 * @param {string} filePath - Ruta al archivo .xlsx
 * @returns {Promise<Object>} { filas: [...], headerRow: number }
 *   Cada fila: { fila, sku, codigo_barras, stock_nuevo, error }
 */
async function parsearStockImport(filePath) {
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);

    var ws = wb.getWorksheet('Stock') || wb.getWorksheet(1);
    if (!ws) throw new Error('No se encontro la hoja "Stock"');

    // Detectar fila de headers (buscar "SKU" en columna A)
    var headerRowNum = null;
    ws.eachRow(function(row, rowNumber) {
        if (!headerRowNum) {
            var val = String(row.getCell(1).value || '').trim().toUpperCase();
            if (val === 'SKU') headerRowNum = rowNumber;
        }
    });

    if (!headerRowNum) {
        throw new Error('No se encontro la fila de encabezados. La columna A debe contener "SKU".');
    }

    // Parsear filas con stock nuevo
    var filas = [];
    for (var rowNum = headerRowNum + 1; rowNum <= ws.rowCount; rowNum++) {
        var row = ws.getRow(rowNum);
        var sku = String(row.getCell(1).value || '').trim();
        var codigoBarras = String(row.getCell(2).value || '').trim();
        var stockNuevoRaw = row.getCell(7).value;

        // Solo filas con stock nuevo completado
        if (stockNuevoRaw === null || stockNuevoRaw === undefined || stockNuevoRaw === '') {
            continue;
        }

        var stockNuevo = parseFloat(stockNuevoRaw);
        if (isNaN(stockNuevo)) {
            filas.push({ fila: rowNum, sku: sku, codigo_barras: codigoBarras, stock_nuevo: stockNuevoRaw, error: 'Stock nuevo no es un numero valido' });
            continue;
        }
        if (stockNuevo < 0) {
            filas.push({ fila: rowNum, sku: sku, codigo_barras: codigoBarras, stock_nuevo: stockNuevo, error: 'Stock nuevo no puede ser negativo' });
            continue;
        }

        filas.push({ fila: rowNum, sku: sku, codigo_barras: codigoBarras, stock_nuevo: stockNuevo, error: null });
    }

    return { filas: filas, headerRow: headerRowNum, totalRows: ws.rowCount };
}

module.exports = { exportar, generarPlantilla, parsear, enviar, exportarPlantillaStock, parsearStockImport };
