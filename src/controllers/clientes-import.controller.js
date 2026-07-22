/**
 * IMPORTADOR/EXPORTADOR CLIENTES - ERP LAGO v13
 * Importación FLEXIBLE: preview con errores, usuario decide si importa igual
 */

const pool = require('../config/database');
const ExcelJS = require('exceljs');

/**
 * Extrae el valor real de una celda de ExcelJS
 */
function extraerValorCelda(cell) {
    if (cell === null || cell === undefined) return '';
    const valor = cell.value !== undefined ? cell.value : cell;
    if (valor === null || valor === undefined) return '';
    if (typeof valor === 'string') return valor.trim();
    if (typeof valor === 'number') return valor.toString();
    if (typeof valor === 'boolean') return valor ? 'Si' : 'No';
    if (valor instanceof Date) return valor.toLocaleDateString('es-AR');
    if (typeof valor === 'object') {
        if (valor.richText && Array.isArray(valor.richText)) {
            return valor.richText.map(r => r.text || '').join('').trim();
        }
        if (valor.result !== undefined) {
            return typeof valor.result === 'string' ? valor.result.trim() : valor.result.toString();
        }
        if (valor.text !== undefined) return valor.text.toString().trim();
        if (valor.hyperlink) return valor.text || valor.hyperlink;
        if (valor.error) return '';
    }
    const str = valor.toString();
    return str === '[object Object]' ? '' : str.trim();
}

// Mapeo flexible de condiciones IVA
const MAPEO_IVA = {
    'ri': 1, 'responsable inscripto': 1, 'responsable inscrito': 1, '1': 1,
    'mt': 2, 'monotributo': 2, 'monotributista': 2, '2': 2,
    'ex': 3, 'exento': 3, '3': 3,
    'cf': 4, 'consumidor final': 4, 'final': 4, '4': 4, '': 4
};

/**
 * Normaliza texto para comparación
 */
function normalizar(texto) {
    if (!texto) return '';
    return texto.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Valida CUIT (flexible, solo avisa si está mal)
 */
function validarCUIT(cuit) {
    if (!cuit) return { valido: true, valor: null, advertencia: null };
    
    const limpio = cuit.toString().replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(limpio)) {
        return { valido: false, valor: cuit, advertencia: 'CUIT inválido (debe tener 11 dígitos)' };
    }
    
    // Formatear
    const formateado = `${limpio.slice(0,2)}-${limpio.slice(2,10)}-${limpio.slice(10)}`;
    return { valido: true, valor: formateado, advertencia: null };
}

/**
 * Parsea condición IVA (flexible)
 */
function parsearCondicionIVA(valor) {
    if (!valor) return { id: 4, advertencia: 'Sin condición IVA, se asignará Consumidor Final' };
    
    const normalizado = normalizar(valor);
    const id = MAPEO_IVA[normalizado];
    
    if (id) return { id, advertencia: null };
    
    // Buscar parcial
    for (const [key, val] of Object.entries(MAPEO_IVA)) {
        if (normalizado.includes(key) || key.includes(normalizado)) {
            return { id: val, advertencia: null };
        }
    }
    
    return { id: 4, advertencia: `"${valor}" no reconocido, se asignará Consumidor Final` };
}

/**
 * GET /api/clientes/import/plantilla
 */
exports.descargarPlantilla = async (req, res) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Clientes');

        sheet.columns = [
            { header: 'Razón Social *', key: 'razon_social', width: 35 },
            { header: 'Nombre Fantasía', key: 'nombre_fantasia', width: 25 },
            { header: 'CUIT/CUIL', key: 'cuit_cuil', width: 15 },
            { header: 'Condición IVA', key: 'condicion_iva', width: 20 },
            { header: 'Domicilio', key: 'domicilio', width: 30 },
            { header: 'Localidad', key: 'localidad', width: 20 },
            { header: 'Provincia', key: 'provincia', width: 15 },
            { header: 'CP', key: 'codigo_postal', width: 10 },
            { header: 'Teléfono', key: 'telefono', width: 15 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Límite Crédito', key: 'limite_credito', width: 15 },
            { header: 'Descuento %', key: 'descuento', width: 12 }
        ];

        // Estilo header
        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '667eea' } };

        // Ejemplo
        sheet.addRow({
            razon_social: 'EMPRESA EJEMPLO S.A.',
            nombre_fantasia: 'Ejemplo',
            cuit_cuil: '30-12345678-9',
            condicion_iva: 'Responsable Inscripto',
            domicilio: 'Av. Ejemplo 1234',
            localidad: 'Buenos Aires',
            provincia: 'Buenos Aires',
            codigo_postal: '1234',
            telefono: '11-1234-5678',
            email: 'contacto@ejemplo.com',
            limite_credito: 50000,
            descuento: 5
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="plantilla_clientes.xlsx"');
        res.send(buffer);
    } catch (error) {
        console.error('❌ Error plantilla:', error.message);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/clientes/import/preview
 * Analiza el archivo y muestra preview con advertencias
 */
exports.previewImportacion = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió archivo' });
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const sheet = workbook.worksheets[0];

        if (!sheet || sheet.rowCount < 2) {
            return res.status(400).json({ error: 'Archivo vacío o sin datos' });
        }

        // Obtener headers
        const headers = [];
        sheet.getRow(1).eachCell((cell, colNumber) => {
            headers[colNumber] = normalizar(cell.value || '');
        });

        // Mapear columnas
        const mapeoColumnas = {};
        const columnasEsperadas = {
            'razon social': 'razon_social',
            'razon_social': 'razon_social',
            'nombre fantasia': 'nombre_fantasia',
            'cuit': 'cuit_cuil',
            'cuil': 'cuit_cuil',
            'cuit/cuil': 'cuit_cuil',
            'condicion iva': 'id_condicion_iva',
            'iva': 'id_condicion_iva',
            'domicilio': 'domicilio',
            'direccion': 'domicilio',
            'localidad': 'localidad',
            'ciudad': 'localidad',
            'provincia': 'provincia',
            'cp': 'codigo_postal',
            'codigo postal': 'codigo_postal',
            'telefono': 'telefono',
            'tel': 'telefono',
            'email': 'email',
            'correo': 'email',
            'limite credito': 'limite_credito',
            'credito': 'limite_credito',
            'descuento': 'descuento_predefinido',
            'dto': 'descuento_predefinido'
        };

        headers.forEach((header, colNum) => {
            for (const [patron, campo] of Object.entries(columnasEsperadas)) {
                if (header.includes(patron) || patron.includes(header)) {
                    mapeoColumnas[colNum] = campo;
                    break;
                }
            }
        });

        // Verificar que tenga razón social
        const tieneRazonSocial = Object.values(mapeoColumnas).includes('razon_social');
        if (!tieneRazonSocial) {
            return res.status(400).json({ 
                error: 'No se encontró columna "Razón Social". Es obligatoria.',
                columnas_detectadas: headers.filter(h => h)
            });
        }

        // Obtener CUITs existentes
        const { rows: existentes } = await pool.query(
            'SELECT cuit_cuil FROM clientes WHERE id_empresa = $1 AND cuit_cuil IS NOT NULL',
            [id_empresa]
        );
        const cuitsExistentes = new Set(existentes.map(e => e.cuit_cuil?.replace(/[-\s]/g, '')));

        // Procesar filas
        const registros = [];
        let totalErrores = 0;
        let totalAdvertencias = 0;

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header

            const registro = {
                fila: rowNumber,
                datos: {},
                errores: [],
                advertencias: [],
                valido: true
            };

            // Extraer valores según mapeo
            for (const [colNum, campo] of Object.entries(mapeoColumnas)) {
                const valor = extraerValorCelda(row.getCell(parseInt(colNum)));
                registro.datos[campo] = valor !== null && valor !== undefined ? valor.toString().trim() : '';
            }

            // Validar razón social (obligatorio)
            if (!registro.datos.razon_social) {
                registro.errores.push('Razón Social es obligatoria');
                registro.valido = false;
            }

            // Validar CUIT
            if (registro.datos.cuit_cuil) {
                const cuitResult = validarCUIT(registro.datos.cuit_cuil);
                if (!cuitResult.valido) {
                    registro.advertencias.push(cuitResult.advertencia);
                    registro.datos.cuit_cuil = ''; // Limpiar si es inválido
                } else {
                    registro.datos.cuit_cuil = cuitResult.valor;
                    // Verificar duplicado
                    const cuitLimpio = cuitResult.valor?.replace(/[-\s]/g, '');
                    if (cuitLimpio && cuitsExistentes.has(cuitLimpio)) {
                        registro.advertencias.push('CUIT ya existe en el sistema');
                    }
                }
            }

            // Parsear condición IVA
            const ivaResult = parsearCondicionIVA(registro.datos.id_condicion_iva);
            registro.datos.id_condicion_iva = ivaResult.id;
            if (ivaResult.advertencia) {
                registro.advertencias.push(ivaResult.advertencia);
            }

            // Validar email (solo advertencia)
            if (registro.datos.email && !registro.datos.email.includes('@')) {
                registro.advertencias.push('Email parece inválido');
            }

            // Parsear números
            registro.datos.limite_credito = parseFloat(registro.datos.limite_credito) || 0;
            registro.datos.descuento_predefinido = parseFloat(registro.datos.descuento_predefinido) || 0;

            // Contadores
            if (registro.errores.length > 0) totalErrores++;
            if (registro.advertencias.length > 0) totalAdvertencias++;

            registros.push(registro);
        });

        res.json({
            success: true,
            resumen: {
                total: registros.length,
                validos: registros.filter(r => r.valido).length,
                con_errores: totalErrores,
                con_advertencias: totalAdvertencias
            },
            columnas_detectadas: Object.entries(mapeoColumnas).map(([col, campo]) => ({
                columna_excel: headers[col],
                campo_sistema: campo
            })),
            registros: registros, // Mostrar máximo 100 en preview
            puede_importar: totalErrores === 0 || registros.some(r => r.valido)
        });

    } catch (error) {
        console.error('❌ Error en preview:', error);
        res.status(500).json({ error: 'Error al procesar archivo: ' + error.message });
    }
};

/**
 * POST /api/clientes/import/ejecutar
 * Importa los registros (solo los válidos o todos según opción)
 */
exports.ejecutarImportacion = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { registros, importar_con_advertencias = true, ignorar_duplicados = true } = req.body;

    if (!registros || !Array.isArray(registros)) {
        return res.status(400).json({ error: 'No se recibieron registros' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        let importados = 0;
        let omitidos = 0;
        const erroresDetalle = [];

        for (const reg of registros) {
            // Saltar si tiene errores (no advertencias)
            if (reg.errores && reg.errores.length > 0) {
                omitidos++;
                continue;
            }

            // Saltar si tiene advertencias y no se quiere importar con advertencias
            if (!importar_con_advertencias && reg.advertencias && reg.advertencias.length > 0) {
                omitidos++;
                continue;
            }

            const d = reg.datos;

            // Verificar duplicado por CUIT
            if (d.cuit_cuil && !ignorar_duplicados) {
                const { rows } = await client.query(
                    'SELECT id_cliente FROM clientes WHERE id_empresa = $1 AND cuit_cuil = $2',
                    [id_empresa, d.cuit_cuil]
                );
                if (rows.length > 0) {
                    omitidos++;
                    erroresDetalle.push({ fila: reg.fila, error: 'CUIT duplicado' });
                    continue;
                }
            }

            try {
                await client.query(`
                    INSERT INTO clientes (
                        id_empresa, razon_social, nombre_fantasia, cuit_cuil,
                        id_condicion_iva, domicilio, localidad, provincia,
                        codigo_postal, telefono, email, limite_credito,
                        descuento_predefinido, activo
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE)
                `, [
                    id_empresa,
                    d.razon_social?.toUpperCase() || '',
                    d.nombre_fantasia || '',
                    d.cuit_cuil || null,
                    d.id_condicion_iva || 4,
                    d.domicilio || '',
                    d.localidad || '',
                    d.provincia || '',
                    d.codigo_postal || '',
                    d.telefono || '',
                    d.email?.toLowerCase() || '',
                    d.limite_credito || 0,
                    d.descuento_predefinido || 0
                ]);
                importados++;
            } catch (err) {
                omitidos++;
                erroresDetalle.push({ fila: reg.fila, error: err.message });
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            importados,
            omitidos,
            errores: erroresDetalle.slice(0, 20) // Mostrar primeros 20 errores
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error importación:', error);
        res.status(500).json({ error: 'Error en importación: ' + error.message });
    } finally {
        client.release();
    }
};

/**
 * POST /api/clientes/exportar/excel-file
 * Exporta a Excel real
 */
exports.exportarExcelFile = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { ids } = req.body;

    try {
        let query = `
            SELECT
                c.razon_social,
                c.nombre_fantasia,
                c.cuit_cuil,
                ci.nombre as condicion_iva,
                c.domicilio,
                c.localidad,
                c.provincia,
                c.codigo_postal,
                c.telefono,
                c.email,
                lp.nombre as lista_precio,
                c.limite_credito,
                c.descuento_predefinido,
                c.observaciones,
                CASE WHEN c.activo THEN 'Activo' ELSE 'Inactivo' END as estado
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            LEFT JOIN listasdeprecios lp ON c.id_lista_precio = lp.id_lista_precio
            WHERE c.id_empresa = $1
        `;
        const params = [id_empresa];

        if (ids && ids.length > 0) {
            query += ' AND c.id_cliente = ANY($2)';
            params.push(ids);
        }
        query += ' ORDER BY c.razon_social';

        const { rows } = await pool.query(query, params);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Clientes');

        sheet.columns = [
            { header: 'Razón Social', key: 'razon_social', width: 35 },
            { header: 'Nombre Fantasía', key: 'nombre_fantasia', width: 25 },
            { header: 'CUIT/CUIL', key: 'cuit_cuil', width: 15 },
            { header: 'Condición IVA', key: 'condicion_iva', width: 20 },
            { header: 'Domicilio', key: 'domicilio', width: 30 },
            { header: 'Localidad', key: 'localidad', width: 20 },
            { header: 'Provincia', key: 'provincia', width: 15 },
            { header: 'CP', key: 'codigo_postal', width: 10 },
            { header: 'Teléfono', key: 'telefono', width: 15 },
            { header: 'Email', key: 'email', width: 30 },
            { header: 'Lista Precio', key: 'lista_precio', width: 15 },
            { header: 'Límite Crédito', key: 'limite_credito', width: 15 },
            { header: 'Descuento %', key: 'descuento_predefinido', width: 12 },
            { header: 'Observaciones', key: 'observaciones', width: 30 },
            { header: 'Estado', key: 'estado', width: 10 }
        ];

        sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
        sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '667eea' } };

        rows.forEach(row => sheet.addRow(row));

        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `clientes_${new Date().toISOString().slice(0,10)}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);

    } catch (error) {
        console.error('❌ Error exportar:', error.message);
        res.status(500).json({ error: error.message });
    }
};

// Exportar middleware de multer
exports.uploadMiddleware = require('multer')({ storage: require('multer').memoryStorage() }).single('archivo');
