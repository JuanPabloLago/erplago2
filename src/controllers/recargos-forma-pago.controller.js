const pool = require('../config/database');
const logger = require('../utils/logger');

/**
 * RECARGOS/DESCUENTOS POR FORMA DE PAGO - CONTROLLER
 * ERP LAGO - Febrero 2026
 *
 * Gestiona la configuración de recargos (+%) y descuentos (-%) por forma de pago.
 * Tabla: recargos_forma_pago (FK a formas_pago, multiempresa)
 * 
 * Recargos (+): generan Nota de Débito separada, NO afectan factura
 * Descuentos (-): se aplican en factura, reducen base imponible
 */

const recargosFPController = {

    // ========================================================================
    // LISTAR TODOS (para panel de configuración)
    // ========================================================================
    async listar(req, res) {
        const { id_empresa } = req.usuario;

        try {
            // LEFT JOIN: muestra TODAS las formas de pago, tengan o no recargo configurado
            const { rows } = await pool.query(`
                SELECT 
                    fp.id_forma_pago,
                    fp.codigo,
                    fp.nombre AS nombre_forma_pago,
                    fp.tipo,
                    r.id_recargo,
                    COALESCE(r.porcentaje, 0) AS porcentaje,
                    COALESCE(r.descripcion, '') AS descripcion,
                    COALESCE(r.genera_nota_debito, FALSE) AS genera_nota_debito,
                    COALESCE(r.activo, FALSE) AS activo,
                    r.fecha_modificacion
                FROM formas_pago fp
                LEFT JOIN recargos_forma_pago r 
                    ON r.id_forma_pago = fp.id_forma_pago
                      AND fp.id_empresa = r.id_empresa 
                    AND r.id_empresa = $1
                  WHERE fp.id_empresa = $1
                    AND fp.tipo != 'tarjeta'
                ORDER BY fp.id_forma_pago
            `, [id_empresa]);

            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Error al listar recargos forma pago:', error);
            res.status(500).json({ success: false, error: 'Error al obtener recargos' });
        }
    },

    // ========================================================================
    // OBTENER ACTIVOS (para frontend tesorería - solo los que tienen % != 0)
    // ========================================================================
    async obtenerActivos(req, res) {
        const { id_empresa } = req.usuario;

        try {
            const { rows } = await pool.query(`
                SELECT 
                    r.id_recargo,
                    r.id_forma_pago,
                    fp.codigo,
                    fp.nombre AS nombre_forma_pago,
                    r.porcentaje,
                    r.descripcion,
                    r.genera_nota_debito
                FROM recargos_forma_pago r
                JOIN formas_pago fp ON fp.id_forma_pago = r.id_forma_pago
                WHERE r.id_empresa = $1
                  AND r.activo = TRUE
                  AND r.porcentaje != 0
                ORDER BY fp.nombre
            `, [id_empresa]);

            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Error al obtener recargos activos:', error);
            res.status(500).json({ success: false, error: 'Error al obtener recargos activos' });
        }
    },

    // ========================================================================
    // GUARDAR MASIVO (UPSERT) - desde panel de configuración
    // ========================================================================
    async guardarMasivo(req, res) {
        const { id_empresa } = req.usuario;
        const { recargos } = req.body;

        // Validación
        if (!Array.isArray(recargos) || recargos.length === 0) {
            return res.status(400).json({ success: false, error: 'Se requiere un array de recargos' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const resultados = [];
            for (const item of recargos) {
                const { id_forma_pago, porcentaje, descripcion, genera_nota_debito, activo } = item;

                // Validar porcentaje
                const pct = parseFloat(porcentaje);
                if (isNaN(pct) || pct < -100 || pct > 100) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Porcentaje inválido para forma de pago ${id_forma_pago}: ${porcentaje}. Debe estar entre -100 y 100.`
                    });
                }

                // Validar que la forma de pago existe
                const fpCheck = await client.query(
                    'SELECT id_forma_pago FROM formas_pago WHERE id_forma_pago = $1 AND id_empresa = $2',
                    [id_forma_pago, id_empresa]
                );
                if (fpCheck.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Forma de pago ${id_forma_pago} no existe`
                    });
                }

                // Determinar genera_nota_debito automáticamente:
                // Recargos (+) → genera ND por defecto
                // Descuentos (-) → NO genera ND (se aplica en factura)
                const generaND = pct > 0 ? (genera_nota_debito !== false) : false;

                // UPSERT
                const { rows } = await client.query(`
                    INSERT INTO recargos_forma_pago 
                        (id_empresa, id_forma_pago, porcentaje, descripcion, genera_nota_debito, activo)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id_empresa, id_forma_pago) 
                    DO UPDATE SET 
                        porcentaje = EXCLUDED.porcentaje,
                        descripcion = EXCLUDED.descripcion,
                        genera_nota_debito = EXCLUDED.genera_nota_debito,
                        activo = EXCLUDED.activo
                    RETURNING *
                `, [
                    id_empresa,
                    id_forma_pago,
                    pct,
                    (descripcion || '').trim().substring(0, 100),
                    generaND,
                    activo !== false // default true
                ]);

                resultados.push(rows[0]);
            }

            await client.query('COMMIT');

            // Log para auditoría
            logger.info(`[RECARGOS-FP] Usuario ${req.usuario.id_usuario} actualizó ${resultados.length} recargos empresa ${id_empresa}`);

            res.json({
                success: true,
                message: `${resultados.length} configuración(es) guardada(s)`,
                data: resultados
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error al guardar recargos masivo:', error);
            res.status(500).json({ success: false, error: 'Error al guardar recargos' });
        } finally {
            client.release();
        }
    },

    // ========================================================================
    // ACTUALIZAR INDIVIDUAL
    // ========================================================================
    async actualizar(req, res) {
        const { id_empresa } = req.usuario;
        const { id } = req.params;
        const { porcentaje, descripcion, genera_nota_debito, activo } = req.body;

        try {
            const pct = parseFloat(porcentaje);
            if (isNaN(pct) || pct < -100 || pct > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'Porcentaje debe estar entre -100 y 100'
                });
            }

            const { rows } = await pool.query(`
                UPDATE recargos_forma_pago
                SET porcentaje = $1,
                    descripcion = $2,
                    genera_nota_debito = $3,
                    activo = $4
                WHERE id_recargo = $5 AND id_empresa = $6
                RETURNING *
            `, [
                pct,
                (descripcion || '').trim().substring(0, 100),
                genera_nota_debito !== false,
                activo !== false,
                id,
                id_empresa
            ]);

            if (rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Recargo no encontrado' });
            }

            res.json({ success: true, data: rows[0] });
        } catch (error) {
            console.error('Error al actualizar recargo:', error);
            res.status(500).json({ success: false, error: 'Error al actualizar recargo' });
        }
    },

    // ========================================================================
    // REPORTE: resumen de ajustes aplicados (tabla ajustes_forma_pago)
    // ========================================================================
    async reporteAjustes(req, res) {
        const { id_empresa } = req.usuario;
        const { fecha_desde, fecha_hasta, tipo, id_forma_pago } = req.query;

        try {
            const condiciones = ['a.id_empresa = $1', 'a.anulado = FALSE'];
            const params = [id_empresa];
            let idx = 2;

            if (fecha_desde) {
                condiciones.push(`a.fecha >= $${idx++}`);
                params.push(fecha_desde);
            }
            if (fecha_hasta) {
                condiciones.push(`a.fecha <= $${idx++}`);
                params.push(fecha_hasta + ' 23:59:59');
            }
            if (tipo && (tipo === 'recargo' || tipo === 'descuento')) {
                condiciones.push(`a.tipo = $${idx++}`);
                params.push(tipo);
            }
            if (id_forma_pago) {
                condiciones.push(`a.id_forma_pago = $${idx++}`);
                params.push(id_forma_pago);
            }

            const { rows } = await pool.query(`
                SELECT 
                    a.*,
                    fp.nombre AS nombre_forma_pago,
                    c.razon_social AS nombre_cliente,
                    u.nombre AS nombre_usuario
                FROM ajustes_forma_pago a
                JOIN formas_pago fp ON fp.id_forma_pago = a.id_forma_pago AND fp.id_empresa = a.id_empresa
                LEFT JOIN clientes c ON c.id_cliente = a.id_cliente AND c.id_empresa = a.id_empresa
                LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.id_empresa = a.id_empresa
                WHERE ${condiciones.join(' AND ')}
                ORDER BY a.fecha DESC
                LIMIT 500
            `, params);

            // Totales
            const totales = {
                recargos: rows.filter(r => r.tipo === 'recargo').reduce((s, r) => s + parseFloat(r.monto_ajuste || 0), 0),
                descuentos: rows.filter(r => r.tipo === 'descuento').reduce((s, r) => s + Math.abs(parseFloat(r.monto_ajuste || 0)), 0),
                cantidad: rows.length
            };

            res.json({ success: true, data: rows, totales });
        } catch (error) {
            console.error('Error en reporte de ajustes:', error);
            res.status(500).json({ success: false, error: 'Error al generar reporte' });
        }
    }
};

module.exports = recargosFPController;
