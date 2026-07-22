/**
 * HISTORIAL DE MOVIMIENTOS CONTROLLER
 * ERP LAGO - Consulta de productos vendidos/comprados
 */
const pool = require('../config/database');

/**
 * GET /api/historial-movimientos/ventas
 * Consultar historial de productos vendidos
 */
const consultarVentas = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const {
            q = '',
            fecha_desde,
            fecha_hasta,
            id_cliente,
            id_producto,
            tipo_documento,
            limit = 100,
            offset = 0
        } = req.query;

        let where = ['id_empresa = $1'];
        let params = [id_empresa];
        let paramIndex = 2;

        // Filtro búsqueda general
        if (q) {
            where.push(`(
                producto ILIKE $${paramIndex} OR 
                codigo_producto ILIKE $${paramIndex} OR 
                cliente ILIKE $${paramIndex} OR
                numero_documento ILIKE $${paramIndex}
            )`);
            params.push(`%${q}%`);
            paramIndex++;
        }

        // Filtro producto específico
        if (id_producto) {
            where.push(`id_producto = $${paramIndex}`);
            params.push(id_producto);
            paramIndex++;
        }

        // Filtro fechas
        if (fecha_desde) {
            where.push(`fecha >= $${paramIndex}`);
            params.push(fecha_desde);
            paramIndex++;
        }
        if (fecha_hasta) {
            where.push(`fecha <= $${paramIndex}`);
            params.push(fecha_hasta);
            paramIndex++;
        }

        // Filtro cliente
        if (id_cliente) {
            where.push(`id_cliente = $${paramIndex}`);
            params.push(id_cliente);
            paramIndex++;
        }

        // Filtro tipo documento
        if (tipo_documento && tipo_documento !== 'todos') {
            where.push(`tipo_documento = $${paramIndex}`);
            params.push(tipo_documento);
            paramIndex++;
        }

        const whereClause = where.join(' AND ');

        // Contar total
        const countResult = await pool.query(
            `SELECT COUNT(*) FROM vista_historial_precios WHERE ${whereClause}`,
            params
        );

        // Obtener datos
        const query = `
            SELECT 
                fecha, producto, codigo_producto, cantidad,
                precio_unitario, precio_unitario_usd, dto_item_porcentaje,
                total_item, total_dolarizado, cliente,
                tipo_documento, numero_documento, cotizacion, moneda
            FROM vista_historial_precios 
            WHERE ${whereClause}
            ORDER BY fecha DESC, numero_documento DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        // Totales
        const totalesQuery = `
            SELECT 
                COALESCE(SUM(total_item), 0) as total_ars,
                COALESCE(SUM(total_dolarizado), 0) as total_usd,
                COALESCE(SUM(cantidad), 0) as total_unidades
            FROM vista_historial_precios 
            WHERE ${whereClause}
        `;
        const totalesResult = await pool.query(totalesQuery, params.slice(0, -2));

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countResult.rows[0].count),
            totales: {
                ars: parseFloat(totalesResult.rows[0].total_ars) || 0,
                usd: parseFloat(totalesResult.rows[0].total_usd) || 0,
                unidades: parseFloat(totalesResult.rows[0].total_unidades) || 0
            },
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Error en consultarVentas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/compras
 * Consultar historial de productos comprados (SOLO ADMIN)
 */
const consultarCompras = async (req, res) => {
    try {
        const { id_empresa, rol } = req.usuario;
        
        if (rol !== 'admin' && rol !== 'compras') {
            return res.status(403).json({ success: false, error: 'Sin permisos para ver compras' });
        }

        const {
            q = '',
            fecha_desde,
            fecha_hasta,
            id_proveedor,
            id_producto,
            limit = 100,
            offset = 0
        } = req.query;

        let where = ['id_empresa = $1'];
        let params = [id_empresa];
        let paramIndex = 2;

        if (q) {
            where.push(`(
                producto ILIKE $${paramIndex} OR 
                codigo_producto ILIKE $${paramIndex} OR 
                proveedor ILIKE $${paramIndex} OR
                numero_documento ILIKE $${paramIndex}
            )`);
            params.push(`%${q}%`);
            paramIndex++;
        }

        if (id_producto) {
            where.push(`id_producto = $${paramIndex}`);
            params.push(id_producto);
            paramIndex++;
        }

        if (fecha_desde) {
            where.push(`fecha >= $${paramIndex}`);
            params.push(fecha_desde);
            paramIndex++;
        }
        if (fecha_hasta) {
            where.push(`fecha <= $${paramIndex}`);
            params.push(fecha_hasta);
            paramIndex++;
        }
        if (id_proveedor) {
            where.push(`id_proveedor = $${paramIndex}`);
            params.push(id_proveedor);
            paramIndex++;
        }

        const whereClause = where.join(' AND ');

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM vista_historial_compras WHERE ${whereClause}`,
            params
        );

        const query = `
            SELECT 
                fecha, producto, codigo_producto, cantidad,
                precio_unitario, precio_unitario_usd, dto_porcentaje,
                total_item, total_dolarizado, proveedor,
                tipo_documento, numero_documento, cotizacion, moneda
            FROM vista_historial_compras 
            WHERE ${whereClause}
            ORDER BY fecha DESC, numero_documento DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        params.push(limit, offset);

        const result = await pool.query(query, params);

        const totalesQuery = `
            SELECT 
                COALESCE(SUM(total_item), 0) as total_ars,
                COALESCE(SUM(total_dolarizado), 0) as total_usd,
                COALESCE(SUM(cantidad), 0) as total_unidades
            FROM vista_historial_compras 
            WHERE ${whereClause}
        `;
        const totalesResult = await pool.query(totalesQuery, params.slice(0, -2));

        res.json({
            success: true,
            data: result.rows,
            total: parseInt(countResult.rows[0].count),
            totales: {
                ars: parseFloat(totalesResult.rows[0].total_ars) || 0,
                usd: parseFloat(totalesResult.rows[0].total_usd) || 0,
                unidades: parseFloat(totalesResult.rows[0].total_unidades) || 0
            },
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        console.error('Error en consultarCompras:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/clientes
 */
const listarClientes = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const result = await pool.query(`
            SELECT id_cliente, razon_social 
            FROM clientes 
            WHERE id_empresa = $1 AND activo = true
            ORDER BY razon_social
            LIMIT 500
        `, [id_empresa]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/proveedores
 */
const listarProveedores = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const result = await pool.query(`
            SELECT id_proveedor, razon_social 
            FROM proveedores 
            WHERE id_empresa = $1 AND activo = true
            ORDER BY razon_social
            LIMIT 500
        `, [id_empresa]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/productos
 */
const buscarProductos = async (req, res) => {
    try {
        const { q = '' } = req.query;
        if (q.length < 2) return res.json([]);
        
        const result = await pool.query(`
            SELECT id_producto, nombre, sku 
            FROM productos 
            WHERE (nombre ILIKE $1 OR sku ILIKE $1)
            AND activo = true
            ORDER BY nombre
            LIMIT 20
        `, [`%${q}%`]);
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/usuario
 */
const infoUsuario = async (req, res) => {
    try {
        const { rol, nombre } = req.usuario;
        res.json({ rol, nombre, puedeVerCompras: rol === 'admin' || rol === 'compras' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/historial-movimientos/exportar
 */
const exportarExcel = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const { q, fecha_desde, fecha_hasta, id_cliente, id_producto, tipo_documento } = req.query;

        let where = ['id_empresa = $1'];
        let params = [id_empresa];
        let paramIndex = 2;

        if (q) {
            where.push(`(producto ILIKE $${paramIndex} OR codigo_producto ILIKE $${paramIndex} OR cliente ILIKE $${paramIndex})`);
            params.push(`%${q}%`);
            paramIndex++;
        }
        if (id_producto) {
            where.push(`id_producto = $${paramIndex}`);
            params.push(id_producto);
            paramIndex++;
        }
        if (fecha_desde) {
            where.push(`fecha >= $${paramIndex}`);
            params.push(fecha_desde);
            paramIndex++;
        }
        if (fecha_hasta) {
            where.push(`fecha <= $${paramIndex}`);
            params.push(fecha_hasta);
            paramIndex++;
        }
        if (id_cliente) {
            where.push(`id_cliente = $${paramIndex}`);
            params.push(id_cliente);
            paramIndex++;
        }
        if (tipo_documento && tipo_documento !== 'todos') {
            where.push(`tipo_documento = $${paramIndex}`);
            params.push(tipo_documento);
            paramIndex++;
        }

        const result = await pool.query(`
            SELECT 
                fecha, tipo_documento, numero_documento, cliente,
                codigo_producto, producto, cantidad,
                precio_unitario as precio_ars,
                precio_unitario_usd as precio_usd,
                dto_item_porcentaje as descuento,
                total_item as total_ars,
                total_dolarizado as total_usd,
                cotizacion
            FROM vista_historial_precios 
            WHERE ${where.join(' AND ')}
            ORDER BY fecha DESC
            LIMIT 10000
        `, params);

        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    consultarVentas,
    consultarCompras,
    listarClientes,
    listarProveedores,
    buscarProductos,
    infoUsuario,
    exportarExcel
};
