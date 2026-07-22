/**
 * codigos-barra.controller.js
 * Endpoints REST para gestion de codigos de barra
 */
const pool = require('../config/database');
const codigosBarraHelper = require('../utils/codigos-barra.helper');

async function leerConfigValidarEAN(id_empresa) {
    const { rows } = await pool.query(
        "SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = 'codigos_barra.validar_ean13'",
        [id_empresa]
    );
    return rows[0]?.valor === 'true';
}

// GET /productos/:id/codigos-barra
async function listar(req, res) {
    try {
        const id_producto = parseInt(req.params.id);
        const codigos = await codigosBarraHelper.listarPorProducto(pool, { id_producto });
        res.json({ id_producto, codigos, total: codigos.length });
    } catch (error) {
        console.error('Error listar codigos barra:', error);
        res.status(500).json({ error: 'Error al listar codigos' });
    }
}

// POST /productos/:id/codigos-barra  body: { codigo_barras }
async function agregar(req, res) {
    const { id_empresa } = req.usuario;
    const id_producto = parseInt(req.params.id);
    const { codigo_barras } = req.body;

    if (!codigo_barras) return res.status(400).json({ error: 'codigo_barras requerido' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const validar_ean13 = await leerConfigValidarEAN(id_empresa);
        const resultado = await codigosBarraHelper.agregar(client, { id_producto, codigo_barras, validar_ean13 });

        if (!resultado.agregado) {
            await client.query('ROLLBACK');
            return res.status(409).json({ 
                error: resultado.motivo, 
                conflicto: resultado.conflicto 
            });
        }

        await client.query('COMMIT');
        res.json({ success: true, codigo_barras: codigo_barras.trim() });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error agregar codigo barra:', error);
        res.status(500).json({ error: 'Error al agregar codigo' });
    } finally {
        client.release();
    }
}

// DELETE /productos/:id/codigos-barra/:codigo
async function eliminar(req, res) {
    const id_producto = parseInt(req.params.id);
    const codigo_barras = decodeURIComponent(req.params.codigo);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await codigosBarraHelper.eliminar(client, { id_producto, codigo_barras });
        if (!r.eliminado) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Codigo no encontrado para este producto' });
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error eliminar codigo barra:', error);
        res.status(500).json({ error: 'Error al eliminar codigo' });
    } finally {
        client.release();
    }
}

// GET /productos/codigos-barra/buscar/:codigo
async function buscarPorCodigo(req, res) {
    try {
        const codigo_barras = decodeURIComponent(req.params.codigo);
        const producto = await codigosBarraHelper.buscarProductoPorCodigo(pool, { codigo_barras });
        if (!producto) return res.status(404).json({ error: 'Codigo no encontrado' });
        res.json(producto);
    } catch (error) {
        console.error('Error buscar por codigo:', error);
        res.status(500).json({ error: 'Error al buscar' });
    }
}

module.exports = { listar, agregar, eliminar, buscarPorCodigo };
