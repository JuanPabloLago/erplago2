const pool = require('../config/database');

// GET /api/cheques-terceros - Listar cheques en cartera
exports.listar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const { estado } = req.query;
    
    try {
        let query = `
            SELECT 
                ct.*,
                c.razon_social as cliente_nombre,
                b.nombre as banco_nombre_rel
            FROM cheques_terceros ct
            LEFT JOIN clientes c ON ct.id_cliente = c.id_cliente
            LEFT JOIN bancos b ON ct.id_banco = b.id_banco
            WHERE ct.id_empresa = $1
        `;
        const params = [id_empresa];
        
        if (estado && estado !== 'todos') {
            query += ` AND ct.estado = $2`;
            params.push(estado);
        }
        
        query += ` ORDER BY ct.fecha_vencimiento ASC`;
        
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Error al listar cheques:', error);
        res.status(500).json({ error: 'Error al obtener cheques' });
    }
};

// POST /api/cheques-terceros - Registrar cheque recibido
exports.crear = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const {
        id_banco, banco_nombre, numero_cheque, cuit_librador, nombre_librador,
        fecha_vencimiento, monto, id_cliente, id_recibo, observaciones
    } = req.body;
    
    try {
        const { rows } = await pool.query(`
            INSERT INTO cheques_terceros (
                id_empresa, id_banco, banco_nombre, numero_cheque, cuit_librador,
                nombre_librador, fecha_vencimiento, monto, id_cliente, id_recibo,
                observaciones, estado
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'en_cartera')
            RETURNING *
        `, [id_empresa, id_banco, banco_nombre, numero_cheque, cuit_librador,
            nombre_librador, fecha_vencimiento, monto, id_cliente, id_recibo, observaciones]);
        
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error al crear cheque:', error);
        res.status(500).json({ error: 'Error al registrar cheque' });
    }
};

// PUT /api/cheques-terceros/:id/estado - Cambiar estado (depositar, endosar, rechazar)
exports.cambiarEstado = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const { id } = req.params;
    const { estado, observaciones, fecha_endoso, id_proveedor } = req.body;
    
    const estadosValidos = ['en_cartera', 'depositado', 'endosado', 'rechazado', 'cobrado'];
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado no válido' });
    }
    
    try {
        let query = `UPDATE cheques_terceros SET estado = $1`;
        const params = [estado];
        let paramIndex = 2;
        
        if (observaciones) {
            query += `, observaciones = COALESCE(observaciones, '') || $${paramIndex}`;
            params.push('\n' + observaciones);
            paramIndex++;
        }
        
        if (estado === 'endosado' && fecha_endoso) {
            query += `, fecha_endoso = $${paramIndex}`;
            params.push(fecha_endoso);
            paramIndex++;
        }
        
        if (id_proveedor) {
            query += `, id_proveedor = $${paramIndex}`;
            params.push(id_proveedor);
            paramIndex++;
        }
        
        query += ` WHERE id_cheque = $${paramIndex} AND id_empresa = $${paramIndex + 1} RETURNING *`;
        params.push(id, id_empresa);
        
        const { rows } = await pool.query(query, params);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cheque no encontrado' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al cambiar estado:', error);
        res.status(500).json({ error: 'Error al actualizar cheque' });
    }
};

// GET /api/cheques-terceros/alertas - Cheques próximos a vencer
exports.alertas = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const dias = parseInt(req.query.dias) || 7;
    
    try {
        const { rows } = await pool.query(`
            SELECT 
                ct.*,
                c.razon_social as cliente_nombre,
                fecha_vencimiento - CURRENT_DATE as dias_para_vencer
            FROM cheques_terceros ct
            LEFT JOIN clientes c ON ct.id_cliente = c.id_cliente
            WHERE ct.id_empresa = $1 
              AND ct.estado = 'en_cartera'
              AND ct.fecha_vencimiento <= CURRENT_DATE + $2
            ORDER BY ct.fecha_vencimiento ASC
        `, [id_empresa, dias]);
        
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener alertas:', error);
        res.status(500).json({ error: 'Error al obtener alertas de cheques' });
    }
};
