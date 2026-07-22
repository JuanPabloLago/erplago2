'use strict';

const pool = require('../config/db');
const helper = require('../utils/listas-precios.helper');

// =====================================================
// CRUD LISTAS
// =====================================================

const listar = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const incluir_inactivas = req.query.incluir_inactivas === 'true';
        const listas = await helper.listarCompleta(pool, { id_empresa, incluir_inactivas });
        res.json(listas);
    } catch (error) {
        console.error('Error listar listas:', error);
        res.status(500).json({ error: error.message });
    }
};

const listarActivas = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const listas = await helper.listarActivas(pool, { id_empresa });
        res.json(listas);
    } catch (error) {
        console.error('Error listar activas:', error);
        res.status(500).json({ error: error.message });
    }
};

const obtenerPorId = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const lista = await helper.obtenerLista(pool, { id_lista_precio, id_empresa });
        res.json(lista);
    } catch (error) {
        console.error('Error obtener lista:', error);
        res.status(404).json({ error: error.message });
    }
};

const crear = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const lista = await helper.crearLista(client, { id_empresa, ...req.body });
        await client.query('COMMIT');
        res.status(201).json(lista);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error crear lista:', error);
        const status = error.message.includes('duplicate') || error.message.includes('unique') ? 409 : 400;
        res.status(status).json({ error: error.message });
    } finally {
        client.release();
    }
};

const actualizar = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const lista = await helper.actualizarLista(client, { id_lista_precio, id_empresa, ...req.body });
        await client.query('COMMIT');
        res.json(lista);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizar lista:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const desactivar = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const lista = await helper.desactivarLista(client, { id_lista_precio, id_empresa });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `Lista "${lista.nombre}" desactivada`, lista });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error desactivar lista:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const activar = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const lista = await helper.activarLista(client, { id_lista_precio, id_empresa });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `Lista "${lista.nombre}" activada`, lista });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error activar lista:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =====================================================
// PRECIOS
// =====================================================

const obtenerPrecios = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { busqueda, limit, offset } = req.query;
        const resultado = await helper.obtenerPreciosLista(pool, { id_lista_precio, id_empresa, busqueda, limit, offset });
        res.json(resultado);
    } catch (error) {
        console.error('Error obtener precios:', error);
        res.status(500).json({ error: error.message });
    }
};

const actualizarPrecio = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { id_producto, precio } = req.body;
        const result = await helper.actualizarPrecio(client, { id_producto, id_lista_precio, id_empresa, precio });
        await client.query('COMMIT');
        res.json(result);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizar precio:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const actualizarPreciosMasivo = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { precios } = req.body;
        const result = await helper.actualizarPreciosMasivo(client, { id_lista_precio, id_empresa, precios });
        await client.query('COMMIT');
        res.json(result);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizar masivo:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =====================================================
// RECÁLCULO Y REDONDEO
// =====================================================

const recalcular = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const result = await helper.recalcularDesdeLista(client, { id_lista_precio, id_empresa });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `Recalculados ${result.total} precios (${result.porcentaje > 0 ? '+' : ''}${result.porcentaje}%)`, ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error recalcular:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const redondear = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const result = await helper.aplicarRedondeo(client, { id_lista_precio, id_empresa });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `${result.actualizados} de ${result.total} precios redondeados`, ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error redondear:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const ajustarPorcentaje = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { porcentaje, aplicar_redondeo } = req.body;
        const result = await helper.ajustarPorcentaje(client, { id_lista_precio, id_empresa, porcentaje, aplicar_redondeo });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `${result.actualizados} precios ajustados ${porcentaje > 0 ? '+' : ''}${porcentaje}%`, ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error ajustar %:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =====================================================
// CLIENTES
// =====================================================

const obtenerClientes = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const clientes = await helper.obtenerClientesLista(pool, { id_lista_precio, id_empresa });
        res.json(clientes);
    } catch (error) {
        console.error('Error obtener clientes:', error);
        res.status(500).json({ error: error.message });
    }
};

const asignarClientes = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { ids_clientes } = req.body;
        const result = await helper.asignarAClientes(client, { id_lista_precio, id_empresa, ids_clientes });
        await client.query('COMMIT');
        res.json({ ok: true, mensaje: `${result.actualizados} clientes asignados a "${result.lista}"`, ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error asignar clientes:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

const desasignarClientes = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { id_empresa } = req.usuario;
        const { ids_clientes } = req.body;
        const result = await helper.desasignarClientes(client, { id_empresa, ids_clientes });
        await client.query('COMMIT');
        res.json({ ok: true, ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error desasignar:', error);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
};

// =====================================================
// ESTADÍSTICAS
// =====================================================

const estadisticas = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const stats = await helper.obtenerEstadisticas(pool, { id_empresa });
        res.json(stats);
    } catch (error) {
        console.error('Error estadísticas:', error);
        res.status(500).json({ error: error.message });
    }
};

// =====================================================
// UTILIDAD: Previsualizar redondeo
// =====================================================

const previsualizarRedondeo = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const id_lista_precio = parseInt(req.params.id);
        const { rows } = await pool.query(
            `SELECT pr.id_producto, pr.precio, p.nombre, COALESCE(a.porcentaje, 21) as iva_pct
             FROM precios pr
             JOIN productos p ON p.id_producto = pr.id_producto
             LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
             WHERE pr.id_lista_precio = $1 AND pr.id_empresa = $2
             ORDER BY pr.precio DESC LIMIT 20`,
            [id_lista_precio, id_empresa]
        );
        const preview = rows.map(r => {
            const neto = parseFloat(r.precio);
            const ivaPct = parseFloat(r.iva_pct);
            const conIva = Math.round(neto * (1 + ivaPct / 100) * 100) / 100;
            const conIvaRedondeado = helper.redondearPrecioAR(conIva);
            const nuevoNeto = Math.round((conIvaRedondeado / (1 + ivaPct / 100)) * 100) / 100;
            return {
                id_producto: r.id_producto,
                nombre: r.nombre,
                neto_actual: neto,
                con_iva_actual: conIva,
                con_iva_redondeado: conIvaRedondeado,
                neto_nuevo: nuevoNeto,
                diferencia_iva: conIvaRedondeado - conIva
            };
        });
        res.json(preview);
    } catch (error) {
        console.error('Error preview redondeo:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    listar,
    listarActivas,
    obtenerPorId,
    crear,
    actualizar,
    desactivar,
    activar,
    obtenerPrecios,
    actualizarPrecio,
    actualizarPreciosMasivo,
    recalcular,
    redondear,
    ajustarPorcentaje,
    obtenerClientes,
    asignarClientes,
    desasignarClientes,
    estadisticas,
    previsualizarRedondeo
};
