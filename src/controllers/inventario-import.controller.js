const pool = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const ajustesHelper = require('../utils/ajustes-inventario.helper');
const excelHelper = require('../utils/excel.helper');

/**
 * ═══════════════════════════════════════════════════════════════════════
 * INVENTARIO IMPORT CONTROLLER - ERP LAGO (REFACTOREADO S7)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Importacion/Exportacion de stock por Excel.
 * TODA logica Excel delegada a excel.helper.js
 * TODA escritura de stock delegada a ajustes-inventario.helper.js
 *
 * Flujo:
 *   1. exportarPlantilla()   → excel.helper.exportarPlantillaStock()
 *   2. previewImportacion()  → excel.helper.parsearStockImport() + matcheo
 *   3. ejecutarImportacion() → ajustes-inventario.helper (ya estaba)
 *
 * Refactoreado: S7 — 2026-03-27
 * ═══════════════════════════════════════════════════════════════════════
 */

// ============================================================================
// MULTER CONFIG
// ============================================================================

const storage = multer.diskStorage({
    destination: '/tmp/uploads',
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `stock-import-${unique}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'));
        }
    }
});

const uploadMiddleware = upload.single('archivo');

// ============================================================================
// CONTROLLER
// ============================================================================

const inventarioImportController = {

    uploadMiddleware,

    /**
     * Exportar plantilla Excel con stock actual de un deposito.
     * GET /api/inventario/import/plantilla?id_deposito=1&id_categoria=&id_marca=
     */
    async exportarPlantilla(req, res) {
        const { id_empresa } = req.usuario;
        const { id_deposito, id_categoria, id_marca } = req.query;

        if (!id_deposito) {
            return res.status(400).json({ error: 'id_deposito es requerido' });
        }

        try {
            // Verificar deposito
            const depositoResult = await pool.query(
                'SELECT nombre, codigo, es_principal FROM depositos WHERE id_deposito = $1 AND id_empresa = $2 AND activo = TRUE',
                [id_deposito, id_empresa]
            );
            if (depositoResult.rows.length === 0) {
                return res.status(404).json({ error: 'Deposito no encontrado' });
            }
            const deposito = depositoResult.rows[0];

            // Query productos con filtros opcionales
            const condiciones = ['p.activo = TRUE'];
            const params = [id_empresa, parseInt(id_deposito)];
            let paramIndex = 3;

            if (id_categoria) {
                condiciones.push(`p.id_categoria = $${paramIndex++}`);
                params.push(parseInt(id_categoria));
            }
            if (id_marca) {
                condiciones.push(`p.id_marca = $${paramIndex++}`);
                params.push(parseInt(id_marca));
            }

            const { rows } = await pool.query(`
                SELECT p.id_producto, p.sku, p.nombre,
                    COALESCE(m.nombre, '') as marca,
                    COALESCE(c.nombre, '') as categoria,
                    COALESCE(
                        (SELECT pcb.codigo_barras FROM productocodigosbarras pcb
                         WHERE pcb.id_producto = p.id_producto LIMIT 1), ''
                    ) as codigo_barras,
                    COALESCE(id.stock_real, 0) as stock_actual
                FROM productos p
                LEFT JOIN inventario_deposito id
                    ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                WHERE ${condiciones.join(' AND ')}
                ORDER BY c.nombre, m.nombre, p.nombre
            `, params);

            // Generar Excel via helper centralizado
            const buffer = await excelHelper.exportarPlantillaStock({
                deposito,
                rows,
                id_empresa,
                id_deposito: parseInt(id_deposito)
            });

            // Enviar
            const filename = `stock_${deposito.codigo || deposito.nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            excelHelper.enviar(res, buffer, filename);

            logger.info(`Plantilla stock exportada: ${rows.length} productos, deposito ${deposito.nombre}`);

        } catch (error) {
            logger.error('Error al exportar plantilla stock:', error.message);
            res.status(500).json({ error: 'Error al exportar plantilla' });
        }
    },

    /**
     * Preview de importacion: parsea Excel, matchea por SKU/barcode, muestra diff.
     * POST /api/inventario/import/preview  (multipart: archivo + id_deposito)
     * Solo lectura — no modifica BD.
     */
    async previewImportacion(req, res) {
        const { id_empresa } = req.usuario;
        const { id_deposito } = req.body;

        if (!id_deposito) {
            return res.status(400).json({ error: 'id_deposito es requerido' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'Debe enviar un archivo Excel' });
        }

        try {
            // Verificar deposito
            const depositoResult = await pool.query(
                'SELECT nombre, es_principal FROM depositos WHERE id_deposito = $1 AND id_empresa = $2 AND activo = TRUE',
                [id_deposito, id_empresa]
            );
            if (depositoResult.rows.length === 0) {
                return res.status(404).json({ error: 'Deposito no encontrado' });
            }

            // Parsear Excel via helper centralizado
            const parseResult = await excelHelper.parsearStockImport(req.file.path);
            const filasExcel = parseResult.filas;

            if (filasExcel.length === 0) {
                return res.status(400).json({
                    error: 'No se encontraron filas con stock nuevo completado (columna G)'
                });
            }

            // Cargar catalogo con stock actual del deposito
            const catalogoResult = await pool.query(`
                SELECT p.id_producto, p.sku, p.nombre,
                    COALESCE(
                        (SELECT pcb.codigo_barras FROM productocodigosbarras pcb
                         WHERE pcb.id_producto = p.id_producto LIMIT 1), ''
                    ) as codigo_barras,
                    COALESCE(id.stock_real, 0) as stock_actual
                FROM productos p
                LEFT JOIN inventario_deposito id
                    ON p.id_producto = id.id_producto AND id.id_empresa = $1 AND id.id_deposito = $2
                WHERE p.activo = TRUE
            `, [id_empresa, parseInt(id_deposito)]);

            // Indices de busqueda
            const porSku = new Map();
            const porBarcode = new Map();
            for (const prod of catalogoResult.rows) {
                if (prod.sku) porSku.set(prod.sku.trim().toUpperCase(), prod);
                if (prod.codigo_barras) porBarcode.set(prod.codigo_barras.trim(), prod);
            }

            // Matchear cada fila
            const matcheados = [];
            const noEncontrados = [];
            const conErrores = [];

            for (const fila of filasExcel) {
                if (fila.error) { conErrores.push(fila); continue; }

                let producto = null;
                let matchedBy = null;

                if (fila.sku) {
                    producto = porSku.get(fila.sku.toUpperCase());
                    if (producto) matchedBy = 'sku';
                }
                if (!producto && fila.codigo_barras) {
                    producto = porBarcode.get(fila.codigo_barras);
                    if (producto) matchedBy = 'codigo_barras';
                }

                if (!producto) {
                    noEncontrados.push({
                        fila: fila.fila, sku: fila.sku,
                        codigo_barras: fila.codigo_barras, stock_nuevo: fila.stock_nuevo
                    });
                    continue;
                }

                const diferencia = fila.stock_nuevo - parseFloat(producto.stock_actual);
                matcheados.push({
                    fila: fila.fila, id_producto: producto.id_producto,
                    sku: producto.sku, nombre: producto.nombre,
                    matched_by: matchedBy,
                    stock_actual: parseFloat(producto.stock_actual),
                    stock_nuevo: fila.stock_nuevo, diferencia
                });
            }

            // Resumen
            const conCambios = matcheados.filter(m => m.diferencia !== 0);
            const sinCambios = matcheados.filter(m => m.diferencia === 0);
            const entradas = conCambios.filter(m => m.diferencia > 0);
            const salidas = conCambios.filter(m => m.diferencia < 0);

            res.json({
                resumen: {
                    total_filas_procesadas: filasExcel.length,
                    matcheados: matcheados.length,
                    con_cambios: conCambios.length,
                    sin_cambios: sinCambios.length,
                    no_encontrados: noEncontrados.length,
                    con_errores: conErrores.length,
                    total_entradas: entradas.reduce((sum, m) => sum + m.diferencia, 0),
                    total_salidas: Math.abs(salidas.reduce((sum, m) => sum + m.diferencia, 0)),
                    deposito: depositoResult.rows[0].nombre,
                    id_deposito: parseInt(id_deposito)
                },
                items: conCambios,
                sin_cambios: sinCambios.length,
                no_encontrados: noEncontrados,
                errores: conErrores
            });

            logger.info(`Preview importacion stock: ${conCambios.length} cambios, ${noEncontrados.length} no encontrados`);

        } catch (error) {
            logger.error('Error en preview importacion stock:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al procesar el archivo' });
        } finally {
            try { if (req.file && req.file.path) fs.unlinkSync(req.file.path); } catch (e) { /* ignorar */ }
        }
    },

    /**
     * Ejecutar importacion: crea ajuste via helper + opcionalmente aplica.
     * POST /api/inventario/import/ejecutar
     * TODA ESCRITURA delegada a ajustes-inventario.helper.js
     */
    async ejecutarImportacion(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_deposito, items, motivo, aplicar = false } = req.body;

        if (!id_deposito) {
            return res.status(400).json({ error: 'id_deposito es requerido' });
        }
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No hay items para importar' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ajuste = await ajustesHelper.crearAjuste(client, {
                id_empresa, id_usuario,
                id_deposito: parseInt(id_deposito),
                tipo_ajuste: 'IMPORTACION_EXCEL',
                motivo: motivo || 'Importacion de stock desde Excel',
                observaciones: `${items.length} productos importados desde Excel`,
                filtros_aplicados: {
                    tipo: 'importacion_excel',
                    id_deposito: parseInt(id_deposito),
                    fecha_importacion: new Date().toISOString(),
                    total_items: items.length
                }
            });

            const itemsParaHelper = items.map(item => ({
                id_producto: item.id_producto,
                stock_real: parseFloat(item.stock_nuevo),
                observaciones: 'Importado desde Excel'
            }));

            const insertados = await ajustesHelper.agregarItemsMasivo(
                client, ajuste.id_ajuste, itemsParaHelper, id_empresa, parseInt(id_deposito)
            );

            if (insertados === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'No se pudo insertar ningun item' });
            }

            await ajustesHelper.recalcularTotales(client, ajuste.id_ajuste, id_empresa);

            let resultadoAplicacion = null;
            if (aplicar) {
                try {
                    resultadoAplicacion = await ajustesHelper.aplicarAjuste(client, ajuste.id_ajuste, id_empresa, id_usuario);
                } catch (aplicarError) {
                    logger.error('Error al aplicar ajuste automatico:', aplicarError.message);
                    resultadoAplicacion = {
                        success: false,
                        message: `Ajuste creado pero no se pudo aplicar: ${aplicarError.message}. Puede aplicarlo manualmente.`
                    };
                }
            }

            await client.query('COMMIT');

            const estadoFinal = resultadoAplicacion?.success ? 'aplicado' : 'borrador';

            const response = {
                success: true,
                message: aplicar
                    ? (resultadoAplicacion?.success
                        ? `Stock actualizado: ${insertados} productos ajustados`
                        : `Ajuste creado en borrador (no se pudo aplicar automaticamente)`)
                    : `Ajuste creado en borrador: ${insertados} productos cargados`,
                ajuste: {
                    id_ajuste: ajuste.id_ajuste,
                    numero_ajuste: ajuste.numero_ajuste,
                    numero_completo: ajuste.numero_completo,
                    estado: estadoFinal,
                    items_insertados: insertados
                }
            };
            if (resultadoAplicacion) response.aplicacion = resultadoAplicacion;

            res.status(201).json(response);
            logger.info(`Importacion stock ejecutada: ajuste ${ajuste.numero_completo}, ${insertados} items, aplicar=${aplicar}`);

        } catch (error) {
            await client.query('ROLLBACK');
            logger.error('Error al ejecutar importacion stock:', error.message);
            res.status(500).json({ error: error.message || 'Error al ejecutar la importacion' });
        } finally {
            client.release();
        }
    },

    /**
     * Listar depositos disponibles (helper para el frontend).
     * GET /api/inventario/import/depositos
     */
    async listarDepositos(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const { rows } = await pool.query(
                `SELECT id_deposito, codigo, nombre, es_principal
                 FROM depositos WHERE id_empresa = $1 AND activo = TRUE
                 ORDER BY es_principal DESC, nombre`,
                [id_empresa]
            );
            res.json(rows);
        } catch (error) {
            logger.error('Error al listar depositos:', error.message);
            res.status(500).json({ error: 'Error al listar depositos' });
        }
    }
};

module.exports = inventarioImportController;
