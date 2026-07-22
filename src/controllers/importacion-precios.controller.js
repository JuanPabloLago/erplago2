/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IMPORTACIÓN LISTAS PROVEEDOR — CONTROLLER
 * ═══════════════════════════════════════════════════════════════════════════
 * Endpoints:
 *   GET  /form-data           → proveedores activos para select
 *   POST /upload              → sube Excel, parsea y devuelve preview
 *   POST /aplicar             → confirma importación
 *   POST /recalcular-lista    → recalcula una lista SOBRE_COSTO
 *   POST /recalcular-todas    → recalcula todas las listas SOBRE_COSTO
 *   GET  /historial           → historial de importaciones
 *   GET  /historial/:id       → detalle de una importación
 */

'use strict';

const pool = require('../config/db');
const multer = require('multer');
const importHelper = require('../utils/importacion-precios.helper');
const logger = require('../utils/logger');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Form data (proveedores para select) ──
async function getFormData(req, res) {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { rows: proveedores } = await pool.query(`
            SELECT p.id_proveedor, p.razon_social, p.descuento_general,
                   COUNT(pp.id_producto_proveedor) as productos_vinculados
            FROM proveedores p
            LEFT JOIN producto_proveedor pp ON pp.id_proveedor = p.id_proveedor 
                AND pp.id_empresa = $1 AND pp.activo = true
            WHERE p.id_empresa = $1 AND p.activo = true
            GROUP BY p.id_proveedor
            ORDER BY p.razon_social
        `, [id_empresa]);

        const { rows: listas } = await pool.query(`
            SELECT id_lista_precio, nombre, margen_sobre_costo, tipo_calculo, activa
            FROM listasdeprecios
            WHERE id_empresa = $1 AND activa = true
            ORDER BY orden
        `, [id_empresa]);

        res.json({ proveedores, listas });
    } catch (err) {
        logger.error('[importacion-precios] Error form-data:', err);
        res.status(500).json({ error: 'Error al obtener datos' });
    }
}

// ── Upload + Preview ──
async function uploadPreview(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });

        const id_empresa = req.usuario.id_empresa;
        const id_proveedor = parseInt(req.body.id_proveedor);
        if (!id_proveedor) return res.status(400).json({ error: 'Proveedor requerido' });

        // 1. Parsear Excel
        const parseo = await importHelper.parsearListaProveedor(req.file.buffer);

        // 2. Matchear con productos internos
        const client = await pool.connect();
        try {
            const resultado = await importHelper.matchearProductos(client, {
                id_empresa, id_proveedor, filas: parseo.filas
            });

            res.json({
                archivo: req.file.originalname,
                columnas_detectadas: parseo.columnas_detectadas,
                total_filas_archivo: parseo.total_filas_archivo,
                filas_validas: parseo.filas.length,
                matcheadas: resultado.matcheadas,
                no_encontradas: resultado.no_encontradas,
                descuento_general_usado: resultado.descuento_general_usado,
                resumen: {
                    con_cambio: resultado.matcheadas.filter(m => m.hay_cambio).length,
                    sin_cambio: resultado.matcheadas.filter(m => !m.hay_cambio).length,
                    no_encontradas: resultado.no_encontradas.length
                }
            });
        } finally {
            client.release();
        }
    } catch (err) {
        logger.error('[importacion-precios] Error upload:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
}

// ── Aplicar importación ──
async function aplicar(req, res) {
    const client = await pool.connect();
    try {
        const id_empresa = req.usuario.id_empresa;
        const id_usuario = req.usuario.id_usuario;
        const { id_proveedor, matcheadas, no_encontradas, descuento_general_usado, archivo_nombre, observaciones, recalcular_listas } = req.body;

        if (!id_proveedor) return res.status(400).json({ error: 'Proveedor requerido' });
        if (!matcheadas || !matcheadas.length) return res.status(400).json({ error: 'No hay productos para importar' });

        await client.query('BEGIN');

        // 1. Aplicar importación
        const resultado = await importHelper.aplicarImportacion(client, {
            id_empresa, id_proveedor, id_usuario,
            matcheadas, no_encontradas: no_encontradas || [],
            descuento_general_usado, archivo_nombre, observaciones
        });

        // 2. Recalcular listas si se pidió (SOLO productos afectados)
        let recalculo = null;
        if (recalcular_listas) {
            const idsAfectados = matcheadas.filter(m => m.hay_cambio).map(m => m.id_producto);
            if (idsAfectados.length > 0) {
                recalculo = await importHelper.recalcularTodasDesdeCosto(client, { id_empresa, ids_productos: idsAfectados });
            }
        }

        await client.query('COMMIT');

        res.json({
            ok: true,
            importacion: resultado,
            recalculo
        });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[importacion-precios] Error aplicar:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

// ── Recalcular una lista ──
async function recalcularLista(req, res) {
    const client = await pool.connect();
    try {
        const id_empresa = req.usuario.id_empresa;
        const id_lista_precio = parseInt(req.body.id_lista_precio);
        if (!id_lista_precio) return res.status(400).json({ error: 'Lista requerida' });

        await client.query('BEGIN');
        const resultado = await importHelper.recalcularDesdeCosto(client, { id_lista_precio, id_empresa });
        await client.query('COMMIT');

        res.json({ ok: true, ...resultado });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[importacion-precios] Error recalcular:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

// ── Recalcular todas ──
async function recalcularTodas(req, res) {
    const client = await pool.connect();
    try {
        const id_empresa = req.usuario.id_empresa;

        await client.query('BEGIN');
        const resultados = await importHelper.recalcularTodasDesdeCosto(client, { id_empresa });
        await client.query('COMMIT');

        res.json({ ok: true, listas: resultados });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error('[importacion-precios] Error recalcular todas:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

// ── Historial ──
async function historial(req, res) {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { rows } = await pool.query(`
            SELECT i.*, p.razon_social as proveedor, u.nombre as usuario
            FROM importacion_listas_proveedor i
            JOIN proveedores p ON p.id_proveedor = i.id_proveedor
            LEFT JOIN usuarios u ON u.id_usuario = i.id_usuario
            WHERE i.id_empresa = $1
            ORDER BY i.fecha DESC
            LIMIT 50
        `, [id_empresa]);
        res.json(rows);
    } catch (err) {
        logger.error('[importacion-precios] Error historial:', err);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
}

// ── Detalle importación ──
async function historialDetalle(req, res) {
    try {
        const id_empresa = req.usuario.id_empresa;
        const id_importacion = parseInt(req.params.id);

        const { rows: [cabecera] } = await pool.query(`
            SELECT i.*, p.razon_social as proveedor, u.nombre as usuario
            FROM importacion_listas_proveedor i
            JOIN proveedores p ON p.id_proveedor = i.id_proveedor
            LEFT JOIN usuarios u ON u.id_usuario = i.id_usuario
            WHERE i.id_importacion = $1 AND i.id_empresa = $2
        `, [id_importacion, id_empresa]);

        if (!cabecera) return res.status(404).json({ error: 'Importación no encontrada' });

        const { rows: detalle } = await pool.query(`
            SELECT d.*, p.sku, p.nombre as nombre_producto
            FROM importacion_listas_proveedor_detalle d
            LEFT JOIN productos p ON p.id_producto = d.id_producto
            WHERE d.id_importacion = $1 AND d.id_empresa = $2
            ORDER BY d.estado, d.codigo_proveedor
        `, [id_importacion, id_empresa]);

        res.json({ cabecera, detalle });
    } catch (err) {
        logger.error('[importacion-precios] Error detalle:', err);
        res.status(500).json({ error: 'Error al obtener detalle' });
    }
}

// ── Guardar descuento general ──
async function guardarDescuento(req, res) {
    try {
        const id_empresa = req.usuario.id_empresa;
        const { id_proveedor, descuento_general } = req.body;
        if (!id_proveedor) return res.status(400).json({ error: 'Proveedor requerido' });

        const dto = parseFloat(descuento_general) || 0;
        if (dto < 0 || dto > 100) return res.status(400).json({ error: 'Descuento debe ser entre 0 y 100' });

        await pool.query(
            'UPDATE proveedores SET descuento_general = $1 WHERE id_proveedor = $2 AND id_empresa = $3',
            [dto, id_proveedor, id_empresa]
        );
        res.json({ ok: true, descuento_general: dto });
    } catch (err) {
        logger.error('[importacion-precios] Error guardar descuento:', err);
        res.status(500).json({ error: 'Error al guardar descuento' });
    }
}

// ── Inspeccionar archivo (devuelve hojas + headers + preview para el modal) ──
async function inspeccionar(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: 'No se envió archivo' });
        const opciones = {
            hoja: req.body.hoja || null,
            fila_inicio: req.body.fila_inicio ? parseInt(req.body.fila_inicio) : null
        };
        const info = await importHelper.inspeccionarArchivo(req.file.buffer, opciones);
        res.json({ archivo: req.file.originalname, ...info });
    } catch (err) {
        logger.error('[importacion-precios] Error inspeccionar:', err);
        res.status(err.statusCode || 500).json({ error: err.message });
    }
}

module.exports = {
    inspeccionar,
    getFormData,
    guardarDescuento,
    uploadPreview,
    aplicar,
    recalcularLista,
    recalcularTodas,
    historial,
    historialDetalle,
    uploadMiddleware: upload.single('archivo')
};
