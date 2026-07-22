const pool = require('../config/database');
const ajustesHelper = require('../utils/ajustes-inventario.helper');
const stockHelper = require('../utils/stock.helper');

/**
 * ═══════════════════════════════════════════════════════════════════════
 * AJUSTES INVENTARIO CONTROLLER - ERP LAGO (REFACTOREADO)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Toda escritura a ajustes_inventario y ajuste_inventario_items
 * pasa por ajustes-inventario.helper.js.
 *
 * Toda modificación de stock pasa por stock.helper.moverStock().
 *
 * Este controller solo:
 *   1. Valida request
 *   2. Obtiene client de transacción
 *   3. Llama al helper
 *   4. Responde al frontend
 *
 * Refactoreado: 2026-02-24
 * ═══════════════════════════════════════════════════════════════════════
 */

const ajustesInventarioController = {

    // ════════════════════════════════════════════════════════════════════
    // LISTAR / OBTENER (SELECTs - quedan en controller)
    // ════════════════════════════════════════════════════════════════════

    async listar(req, res) {
        const { id_empresa } = req.usuario;
        const { estado, tipo_ajuste, fecha_desde, fecha_hasta, limite = 50, offset = 0 } = req.query;

        try {
            const condiciones = ['ai.id_empresa = $1'];
            const params = [id_empresa];
            let paramIndex = 2;

            if (estado) {
                condiciones.push(`ai.estado = $${paramIndex++}`);
                params.push(estado);
            }
            if (tipo_ajuste) {
                condiciones.push(`ai.tipo_ajuste = $${paramIndex++}`);
                params.push(tipo_ajuste);
            }
            if (fecha_desde) {
                condiciones.push(`ai.fecha_ajuste >= $${paramIndex++}`);
                params.push(fecha_desde);
            }
            if (fecha_hasta) {
                condiciones.push(`ai.fecha_ajuste <= $${paramIndex++}`);
                params.push(fecha_hasta);
            }

            const query = `
                SELECT
                    ai.*,
                    u.nombre as usuario_nombre,
                    ua.nombre as usuario_anulacion_nombre,
                    d.nombre as deposito_nombre,
                    (SELECT COUNT(*) FROM ajuste_inventario_items WHERE id_ajuste = ai.id_ajuste AND id_empresa = ai.id_empresa) as cantidad_items
                FROM ajustes_inventario ai
                LEFT JOIN usuarios u ON ai.id_usuario = u.id_usuario AND u.id_empresa = ai.id_empresa
                LEFT JOIN usuarios ua ON ai.id_usuario_anulacion = ua.id_usuario AND ua.id_empresa = ai.id_empresa
                LEFT JOIN depositos d ON ai.id_deposito = d.id_deposito AND d.id_empresa = ai.id_empresa
                WHERE ${condiciones.join(' AND ')}
                ORDER BY ai.fecha_creacion DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;
            params.push(parseInt(limite), parseInt(offset));

            const { rows } = await pool.query(query, params);

            const countQuery = `
                SELECT COUNT(*) as total
                FROM ajustes_inventario ai
                WHERE ${condiciones.join(' AND ')}
            `;
            const countResult = await pool.query(countQuery, params.slice(0, -2));

            res.json({
                ajustes: rows,
                total: parseInt(countResult.rows[0].total)
            });
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al listar ajustes' });
        }
    },

    async obtenerPorId(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);

        try {
            const client = await pool.connect();
            try {
                const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
                if (!ajuste) {
                    return res.status(404).json({ error: 'Ajuste no encontrado' });
                }

                const items = await ajustesHelper.obtenerItems(client, id_ajuste, id_empresa);

                res.json({ ...ajuste, items });
            } finally {
                client.release();
            }
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener ajuste' });
        }
    },

    // ════════════════════════════════════════════════════════════════════
    // CREAR AJUSTE
    // ════════════════════════════════════════════════════════════════════

    async crear(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_deposito, tipo_ajuste, motivo, observaciones, filtros_aplicados } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Resolver depósito: del body, o del usuario
            const depositoFinal = id_deposito
                ? parseInt(id_deposito)
                : await stockHelper.obtenerDepositoUsuario(client, req.usuario);

            const ajuste = await ajustesHelper.crearAjuste(client, {
                id_empresa, id_usuario,
                id_deposito: depositoFinal,
                tipo_ajuste, motivo, observaciones, filtros_aplicados
            });

            await client.query('COMMIT');
            res.status(201).json({ message: 'Ajuste creado en borrador', ajuste });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al crear ajuste' });
        } finally {
            client.release();
        }
    },

    async crearConItems(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_deposito, tipo_ajuste, motivo, observaciones, filtros_aplicados, items } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Debe incluir al menos un producto' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const depositoFinal = id_deposito
                ? parseInt(id_deposito)
                : await stockHelper.obtenerDepositoUsuario(client, req.usuario);

            // Crear cabecera
            const ajuste = await ajustesHelper.crearAjuste(client, {
                id_empresa, id_usuario,
                id_deposito: depositoFinal,
                tipo_ajuste, motivo, observaciones, filtros_aplicados
            });

            // Insertar items
            await ajustesHelper.agregarItemsMasivo(
                client, ajuste.id_ajuste, items, id_empresa, depositoFinal
            );

            // Recalcular totales
            await ajustesHelper.recalcularTotales(client, ajuste.id_ajuste, id_empresa);

            await client.query('COMMIT');

            // Obtener ajuste completo para la respuesta
            const client2 = await pool.connect();
            try {
                const ajusteCompleto = await ajustesHelper.obtenerAjuste(client2, ajuste.id_ajuste, id_empresa);
                res.status(201).json({ message: 'Ajuste creado con items', ajuste: ajusteCompleto });
            } finally {
                client2.release();
            }
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al crear ajuste con items' });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════
    // GESTIÓN DE ITEMS (via helper)
    // ════════════════════════════════════════════════════════════════════

    async agregarItem(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const { id_producto, stock_real, observaciones } = req.body;

        if (!id_producto || stock_real === undefined) {
            return res.status(400).json({ error: 'id_producto y stock_real son requeridos' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Validar ajuste en borrador
            const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
            if (!ajuste) return res.status(404).json({ error: 'Ajuste no encontrado' });
            ajustesHelper.validarEstado(ajuste, ajustesHelper.AJUSTE_ESTADOS.BORRADOR);

            // Agregar item
            const item = await ajustesHelper.agregarItem(client, {
                id_ajuste, id_empresa,
                id_deposito: ajuste.id_deposito,
                id_producto: parseInt(id_producto),
                stock_real: parseFloat(stock_real),
                observaciones
            });

            // Recalcular totales
            await ajustesHelper.recalcularTotales(client, id_ajuste, id_empresa);

            await client.query('COMMIT');

            // Obtener item con datos de producto
            const itemCompleto = await pool.query(`
                SELECT aii.*, p.sku, p.nombre as producto_nombre
                FROM ajuste_inventario_items aii
                JOIN productos p ON aii.id_producto = p.id_producto
                WHERE aii.id_item = $1
            `, [item.id_item]);

            res.json({ message: 'Item agregado/actualizado', item: itemCompleto.rows[0] });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al agregar item' });
        } finally {
            client.release();
        }
    },

    async eliminarItem(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const id_item = parseInt(req.params.id_item);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
            if (!ajuste) return res.status(404).json({ error: 'Ajuste no encontrado' });
            ajustesHelper.validarEstado(ajuste, ajustesHelper.AJUSTE_ESTADOS.BORRADOR);

            await ajustesHelper.eliminarItem(client, id_item, id_ajuste);
            await ajustesHelper.recalcularTotales(client, id_ajuste, id_empresa);

            await client.query('COMMIT');
            res.json({ message: 'Item eliminado' });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al eliminar item' });
        } finally {
            client.release();
        }
    },

    async cargarItemsMasivo(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const { id_marca, id_categoria, id_proveedor, id_conjunto, stock_real_default = null } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
            if (!ajuste) return res.status(404).json({ error: 'Ajuste no encontrado' });
            ajustesHelper.validarEstado(ajuste, ajustesHelper.AJUSTE_ESTADOS.BORRADOR);

            const insertados = await ajustesHelper.cargarDesdeProductosFiltrados(client, {
                id_ajuste, id_empresa,
                id_deposito: ajuste.id_deposito,
                id_marca, id_categoria, id_proveedor, id_conjunto, stock_real_default
            });

            // Guardar filtros aplicados
            await client.query(
                'UPDATE ajustes_inventario SET filtros_aplicados = $1 WHERE id_ajuste = $2',
                [JSON.stringify({ id_marca, id_categoria, id_proveedor, id_conjunto, stock_real_default }), id_ajuste]
            );

            await ajustesHelper.recalcularTotales(client, id_ajuste, id_empresa);

            await client.query('COMMIT');
            res.json({ message: `${insertados} productos cargados`, productos_cargados: insertados });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al cargar productos' });
        } finally {
            client.release();
        }
    },

    async actualizarItemsMasivo(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const { items } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No hay items para actualizar' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
            if (!ajuste) return res.status(404).json({ error: 'Ajuste no encontrado' });
            ajustesHelper.validarEstado(ajuste, ajustesHelper.AJUSTE_ESTADOS.BORRADOR);

            const actualizados = await ajustesHelper.actualizarItemsMasivo(client, id_ajuste, items, id_empresa);
            await ajustesHelper.recalcularTotales(client, id_ajuste, id_empresa);

            await client.query('COMMIT');
            res.json({ message: `${actualizados} items actualizados`, items_actualizados: actualizados });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al actualizar items' });
        } finally {
            client.release();
        }
    },

    async llenarItems(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const { accion } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const ajuste = await ajustesHelper.obtenerAjuste(client, id_ajuste, id_empresa);
            if (!ajuste) return res.status(404).json({ error: 'Ajuste no encontrado' });
            ajustesHelper.validarEstado(ajuste, ajustesHelper.AJUSTE_ESTADOS.BORRADOR);

            const count = await ajustesHelper.llenarItems(client, id_ajuste, id_empresa, accion);
            await ajustesHelper.recalcularTotales(client, id_ajuste, id_empresa);

            await client.query('COMMIT');
            res.json({ message: `${count} items actualizados`, items_actualizados: count });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al llenar items' });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════
    // APLICAR / ANULAR / ELIMINAR (via helper)
    // ════════════════════════════════════════════════════════════════════

    /**
     * Aplicar ajuste.
     * ANTES: llamaba a PG function aplicar_ajuste_inventario()
     * AHORA: pasa por helper → stock.helper.moverStock() → trazabilidad 100%
     */
    async aplicar(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_ajuste = parseInt(req.params.id);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resultado = await ajustesHelper.aplicarAjuste(client, id_ajuste, id_empresa, id_usuario);

            await client.query('COMMIT');

            res.json({
                message: `Ajuste ${resultado.numero_completo} aplicado. ${resultado.items_ajustados} productos ajustados.`,
                ...resultado
            });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al aplicar ajuste' });
        } finally {
            client.release();
        }
    },

    /**
     * Anular ajuste.
     * ANTES: llamaba a PG function anular_ajuste_inventario()
     * AHORA: pasa por helper → stock.helper.moverStock() con cantidad inversa
     */
    async anular(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_ajuste = parseInt(req.params.id);
        const { motivo } = req.body;

        if (!motivo) {
            return res.status(400).json({ error: 'Debe indicar el motivo de anulación' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resultado = await ajustesHelper.anularAjuste(client, id_ajuste, id_empresa, id_usuario, motivo);

            await client.query('COMMIT');

            res.json({
                message: `Ajuste ${resultado.numero_completo} anulado. ${resultado.items_revertidos} movimientos revertidos.`,
                ...resultado
            });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al anular ajuste' });
        } finally {
            client.release();
        }
    },

    async eliminar(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await ajustesHelper.eliminarAjuste(client, id_ajuste, id_empresa);

            await client.query('COMMIT');
            res.json({ message: `Ajuste ${result.numero_completo} eliminado` });
        } catch (error) {
            await client.query('ROLLBACK');
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al eliminar ajuste' });
        } finally {
            client.release();
        }
    },

    // ════════════════════════════════════════════════════════════════════
    // PREVIEW
    // ════════════════════════════════════════════════════════════════════

    async preview(req, res) {
        const { id_empresa } = req.usuario;
        const id_ajuste = parseInt(req.params.id);

        try {
            const client = await pool.connect();
            try {
                const resumen = await ajustesHelper.obtenerResumen(client, id_ajuste, id_empresa);
                if (!resumen) return res.status(404).json({ error: 'Ajuste no encontrado' });
                res.json(resumen);
            } finally {
                client.release();
            }
        } catch (error) {
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al obtener preview' });
        }
    }
};

module.exports = ajustesInventarioController;
