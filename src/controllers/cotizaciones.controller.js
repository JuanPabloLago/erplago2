const logger = require('../utils/logger');
const pool = require('../config/database');
const crudHelper = require('../utils/crud.helper');
const cotizacionHelper = require('../utils/cotizacion.helper');

// GET /api/cotizaciones/usd/vigente  (endpoint NUEVO — usado por frontend y helpers)
exports.vigenteUSD = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    try {
        const { forceFresh } = req.query;
        const data = await cotizacionHelper.obtenerVigenteUSD(pool, id_empresa, {
            forceFresh: forceFresh === 'true'
        });
        res.json(data);
    } catch (err) {
        logger.error('vigenteUSD:', err);
        res.status(500).json({ error: err.message || 'Error obteniendo cotización vigente' });
    }
};

// GET /api/cotizaciones/:id_moneda  (legacy, retrocompat)
exports.obtener = async (req, res) => {
    const id_moneda = parseInt(req.params.id_moneda) || 2;
    const id_empresa = req.usuario.id_empresa;
    try {
        const { rows } = await pool.query(
            'SELECT * FROM cotizaciones WHERE id_empresa = $1 AND id_moneda = $2 ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC LIMIT 1',
            [id_empresa, id_moneda]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Cotización no encontrada' });
        res.json(rows[0]);
    } catch (error) {
        logger.error('obtener cotizacion:', error);
        res.status(500).json({ error: 'Error al obtener cotización' });
    }
};

// GET /api/cotizaciones
exports.listar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    try {
        const { rows } = await pool.query(
            `SELECT DISTINCT ON (c.id_moneda) c.*, m.codigo, m.nombre, m.simbolo
             FROM cotizaciones c JOIN monedas m ON c.id_moneda = m.id_moneda
             WHERE c.id_empresa = $1
             ORDER BY c.id_moneda, c.fecha_cotizacion DESC, c.hora_cotizacion DESC`,
            [id_empresa]
        );
        res.json(rows);
    } catch (error) {
        logger.error('listar cotizaciones:', error);
        res.status(500).json({ error: 'Error al listar cotizaciones' });
    }
};

// PUT /api/cotizaciones/:id_moneda  (manual override)
exports.actualizar = async (req, res) => {
    const id_moneda = parseInt(req.params.id_moneda);
    const id_empresa = req.usuario.id_empresa;
    const { cotizacion_compra, cotizacion_venta } = req.body;
    if (!cotizacion_compra || !cotizacion_venta) {
        return res.status(400).json({ error: 'Cotización compra y venta requeridas' });
    }
    try {
        const cotizacion = await crudHelper.upsertCotizacion(pool, {
            id_empresa, id_moneda,
            cotizacion_compra, cotizacion_venta,
            fuente: 'Manual', tipo: 'manual'
        });
        res.json(cotizacion);
    } catch (error) {
        logger.error('actualizar cotizacion:', error);
        res.status(500).json({ error: 'Error al actualizar cotización' });
    }
};

// POST /api/cotizaciones/sincronizar-blue  (manual trigger, refactorizado al helper)
exports.sincronizarBlue = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    try {
        const result = await cotizacionHelper.sincronizarBlueAuto(pool, id_empresa);
        logger.success('Cotización Blue actualizada: C$' + result.cotizacion.cotizacion_compra + ' / V$' + result.cotizacion.cotizacion_venta);
        res.json({ success: true, cotizacion: result.cotizacion, fuente: result.api });
    } catch (error) {
        logger.error('sincronizar blue:', error);
        res.status(500).json({ error: error.message || 'Error al sincronizar con API externa' });
    }
};
