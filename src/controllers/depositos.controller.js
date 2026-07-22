'use strict';
/**
 * DEPÓSITOS CONTROLLER — MIGRADO FASE 8d via crud.helper.js
 */
const pool = require('../config/database');
const crudHelper = require('../utils/crud.helper');

const depositosController = {

    async listar(req, res) {
        try {
            const { id_empresa } = req.usuario; const { activo } = req.query;
            let query = `SELECT d.*, (SELECT COUNT(*) FROM usuarios u WHERE u.id_deposito = d.id_deposito AND u.estado = 'activo') as usuarios_asignados, (SELECT COUNT(*) FROM inventario_deposito id WHERE id.id_deposito = d.id_deposito AND id.stock_real > 0) as productos_con_stock FROM depositos d WHERE d.id_empresa = $1`;
            const params = [id_empresa];
            if (activo !== undefined) { params.push(activo === 'true'); query += ` AND d.activo = $${params.length}`; }
            query += ' ORDER BY d.es_principal DESC, d.orden ASC, d.nombre ASC';
            const { rows } = await pool.query(query, params);
            res.json({ success: true, data: rows });
        } catch (error) { console.error('Error al listar depósitos:', error); res.status(500).json({ success: false, error: error.message }); }
    },

    async obtener(req, res) {
        try {
            const { id_empresa } = req.usuario; const { id } = req.params;
            const { rows } = await pool.query(`SELECT d.*, (SELECT COUNT(*) FROM usuarios u WHERE u.id_deposito = d.id_deposito AND u.estado = 'activo') as usuarios_asignados, (SELECT COUNT(*) FROM inventario_deposito id WHERE id.id_deposito = d.id_deposito) as total_productos, (SELECT COALESCE(SUM(id.stock_real), 0) FROM inventario_deposito id WHERE id.id_deposito = d.id_deposito) as stock_total FROM depositos d WHERE d.id_deposito = $1 AND d.id_empresa = $2`, [id, id_empresa]);
            if (rows.length === 0) return res.status(404).json({ success: false, error: 'Depósito no encontrado' });
            res.json({ success: true, data: rows[0] });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    },

    async crear(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { id_empresa } = req.usuario;
            const { codigo, nombre, direccion, telefono, responsable, es_principal } = req.body;
            if (!codigo || !nombre) return res.status(400).json({ success: false, error: 'Código y nombre son obligatorios' });

            const existe = await client.query('SELECT 1 FROM depositos WHERE id_empresa = $1 AND UPPER(codigo) = UPPER($2)', [id_empresa, codigo]);
            if (existe.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: `Ya existe un depósito con código "${codigo}"` }); }

            if (es_principal) await crudHelper.quitarPrincipal(client, { id_empresa });

            const conteo = await client.query('SELECT COUNT(*) as cant FROM depositos WHERE id_empresa = $1', [id_empresa]);
            const forzarPrincipal = parseInt(conteo.rows[0].cant) === 0;

            // >>> HELPER <<<
            const deposito = await crudHelper.crearDeposito(client, { id_empresa, codigo, nombre, direccion, telefono, responsable, es_principal: forzarPrincipal || es_principal || false });

            await client.query('COMMIT');
            res.status(201).json({ success: true, data: deposito, message: 'Depósito creado correctamente' });
        } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: error.message }); }
        finally { client.release(); }
    },

    async editar(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { id_empresa } = req.usuario; const { id } = req.params;
            const { codigo, nombre, direccion, telefono, responsable, es_principal, activo } = req.body;

            const actual = await client.query('SELECT * FROM depositos WHERE id_deposito = $1 AND id_empresa = $2', [id, id_empresa]);
            if (actual.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Depósito no encontrado' }); }

            if (codigo && codigo.toUpperCase() !== actual.rows[0].codigo) {
                const existe = await client.query('SELECT 1 FROM depositos WHERE id_empresa = $1 AND UPPER(codigo) = UPPER($2) AND id_deposito != $3', [id_empresa, codigo, id]);
                if (existe.rows.length > 0) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: `Ya existe un depósito con código "${codigo}"` }); }
            }

            if (es_principal && !actual.rows[0].es_principal) await crudHelper.quitarPrincipal(client, { id_empresa });

            if (activo === false && actual.rows[0].activo) {
                const usuarios = await client.query("SELECT COUNT(*) as cant FROM usuarios WHERE id_deposito = $1 AND estado = 'activo'", [id]);
                if (parseInt(usuarios.rows[0].cant) > 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: `No se puede desactivar: hay ${usuarios.rows[0].cant} usuario(s) asignados. Reasignalos primero.` }); }
            }
            if (activo === false && actual.rows[0].es_principal) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'No se puede desactivar el depósito principal. Asigná otro como principal primero.' }); }

            // >>> HELPER <<<
            const deposito = await crudHelper.actualizarDeposito(client, { id_deposito: parseInt(id), id_empresa, codigo, nombre, direccion, telefono, responsable, es_principal, activo });

            await client.query('COMMIT');
            res.json({ success: true, data: deposito, message: 'Depósito actualizado' });
        } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: error.message }); }
        finally { client.release(); }
    },

    async eliminar(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { id_empresa } = req.usuario; const { id } = req.params;
            const actual = await client.query('SELECT * FROM depositos WHERE id_deposito = $1 AND id_empresa = $2', [id, id_empresa]);
            if (actual.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Depósito no encontrado' }); }
            if (actual.rows[0].es_principal) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'No se puede eliminar el depósito principal' }); }

            const usuarios = await client.query("SELECT COUNT(*) as cant FROM usuarios WHERE id_deposito = $1 AND estado = 'activo'", [id]);
            if (parseInt(usuarios.rows[0].cant) > 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: `No se puede eliminar: hay ${usuarios.rows[0].cant} usuario(s) asignados` }); }

            const stock = await client.query('SELECT COUNT(*) as cant FROM inventario_deposito WHERE id_deposito = $1 AND stock_real != 0', [id]);
            if (parseInt(stock.rows[0].cant) > 0) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, error: 'No se puede eliminar: el depósito tiene stock. Transferí la mercadería primero.' }); }

            const movimientos = await client.query('SELECT COUNT(*) as cant FROM movimientos_stock_deposito WHERE id_deposito = $1', [id]);
            if (parseInt(movimientos.rows[0].cant) > 0) {
                // >>> HELPER <<<
                await crudHelper.desactivarDeposito(client, { id_deposito: parseInt(id) });
                await client.query('COMMIT');
                return res.json({ success: true, message: 'Depósito desactivado (tiene historial de movimientos, no se puede eliminar)' });
            }

            // >>> HELPER <<<
            await crudHelper.eliminarDeposito(client, { id_deposito: parseInt(id) });
            await client.query('COMMIT');
            res.json({ success: true, message: 'Depósito eliminado correctamente' });
        } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: error.message }); }
        finally { client.release(); }
    },

    async marcarPrincipal(req, res) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { id_empresa } = req.usuario; const { id } = req.params;
            const deposito = await client.query('SELECT * FROM depositos WHERE id_deposito = $1 AND id_empresa = $2 AND activo = true', [id, id_empresa]);
            if (deposito.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Depósito no encontrado o inactivo' }); }

            // >>> HELPER <<<
            await crudHelper.quitarPrincipal(client, { id_empresa });
            await crudHelper.marcarPrincipal(client, { id_empresa, id_deposito: parseInt(id) });

            await client.query('COMMIT');
            res.json({ success: true, message: `"${deposito.rows[0].nombre}" es ahora el depósito principal` });
        } catch (error) { await client.query('ROLLBACK'); res.status(500).json({ success: false, error: error.message }); }
        finally { client.release(); }
    }
};

module.exports = depositosController;
