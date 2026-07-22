/**
 * CONFIGURACIONES CONTROLLER - ERP LAGO
 * Datos Empresa + AFIP + General
 * @date 2026-02-28
 */
const pool = require('../config/database');
const logger = require('../utils/logger');

// ============================================================
// DATOS EMPRESA
// ============================================================
exports.obtenerEmpresa = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const [empresaRes, condicionesRes] = await Promise.all([
            pool.query(`
                SELECT e.*, ci.nombre AS condicion_iva_nombre
                FROM empresas e
                LEFT JOIN condicionesiva ci ON e.id_condicion_iva = ci.id_condicion_iva
                WHERE e.id_empresa = $1
            `, [id_empresa]),
            pool.query('SELECT id_condicion_iva, nombre FROM condicionesiva ORDER BY id_condicion_iva')
        ]);
        if (empresaRes.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
        res.json({ empresa: empresaRes.rows[0], condiciones_iva: condicionesRes.rows });
    } catch (error) {
        logger.error('Error obtener empresa:', error.message);
        res.status(500).json({ error: 'Error al obtener datos de empresa' });
    }
};

exports.actualizarEmpresa = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { razon_social, nombre_fantasia, cuit, domicilio_fiscal, id_condicion_iva, fecha_inicio_actividades, telefono, email, ingresos_brutos } = req.body;
    if (!razon_social || !cuit) return res.status(400).json({ error: 'Razon social y CUIT son obligatorios' });
    const cuitLimpio = cuit.replace(/[^0-9]/g, '');
    if (cuitLimpio.length !== 11) return res.status(400).json({ error: 'CUIT debe tener 11 digitos' });
    try {
        const result = await pool.query(`
            UPDATE empresas SET razon_social=$1, nombre_fantasia=$2, cuit=$3, domicilio_fiscal=$4,
                id_condicion_iva=$5, fecha_inicio_actividades=$6, telefono=$7, email=$8,
                ingresos_brutos=$9
            WHERE id_empresa=$10 RETURNING *
        `, [razon_social, nombre_fantasia||null, cuit, domicilio_fiscal, id_condicion_iva||1, fecha_inicio_actividades||null, telefono||null, email||null, ingresos_brutos||null, id_empresa]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Empresa no encontrada' });
        logger.info('Empresa ' + id_empresa + ' actualizada: ' + razon_social);
        res.json({ success: true, message: 'Datos de empresa actualizados', empresa: result.rows[0] });
    } catch (error) {
        logger.error('Error actualizar empresa:', error.message);
        if (error.constraint === 'empresas_cuit_key') return res.status(409).json({ error: 'Ya existe una empresa con ese CUIT' });
        res.status(500).json({ error: 'Error al actualizar empresa' });
    }
};

// ============================================================
// CONFIGURACION AFIP
// ============================================================
const CLAVES_AFIP = ['afip_cuit','afip_cert_path','afip_key_path','afip_env','afip_offline','afip_tope_cf_efectivo','afip_tope_cf_otros','afip_punto_venta_default'];

exports.obtenerAFIP = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const [configRes, pvRes] = await Promise.all([
            pool.query('SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa=$1 AND clave=ANY($2) ORDER BY clave', [id_empresa, CLAVES_AFIP]),
            pool.query('SELECT id_deposito, nombre, punto_venta_afip, es_principal FROM depositos WHERE id_empresa=$1 AND activo=true ORDER BY es_principal DESC, nombre', [id_empresa])
        ]);
        const config = {};
        configRes.rows.forEach(function(r) { config[r.clave] = r.valor; });
        res.json({ config: config, depositos: pvRes.rows });
    } catch (error) {
        logger.error('Error obtener AFIP:', error.message);
        res.status(500).json({ error: 'Error al obtener configuracion AFIP' });
    }
};

exports.actualizarAFIP = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const config = req.body;
    if (!config || typeof config !== 'object') return res.status(400).json({ error: 'Datos invalidos' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        var actualizadas = 0;
        var entries = Object.entries(config);
        for (var i = 0; i < entries.length; i++) {
            var clave = entries[i][0];
            var valor = entries[i][1];
            if (CLAVES_AFIP.indexOf(clave) === -1) continue;
            await client.query('INSERT INTO configuraciones_empresa (id_empresa, clave, valor) VALUES ($1,$2,$3) ON CONFLICT (id_empresa, clave) DO UPDATE SET valor=$3', [id_empresa, clave, String(valor)]);
            actualizadas++;
        }
        await client.query('COMMIT');
        logger.info('AFIP config actualizada empresa=' + id_empresa + ': ' + actualizadas + ' claves');
        res.json({ success: true, message: actualizadas + ' configuraciones actualizadas' });
    } catch (error) {
        await client.query('ROLLBACK');
        logger.error('Error actualizar AFIP:', error.message);
        res.status(500).json({ error: 'Error al actualizar configuracion AFIP' });
    } finally {
        client.release();
    }
};

exports.testAFIP = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const afipService = require('../services/afip.service');
        const fs = require('fs');
        await afipService.cargarConfiguracion(pool, id_empresa);

        var resultado = {
            env: afipService.config.env,
            cuit: afipService.config.cuit,
            offline: afipService.config.modoOffline,
            cert_existe: fs.existsSync(afipService.config.certPath),
            key_existe: fs.existsSync(afipService.config.keyPath),
            cert_info: null, wsaa: null, wsfe: null
        };

        try {
            const { execSync } = require('child_process');
            resultado.cert_info = execSync('openssl x509 -in "' + afipService.config.certPath + '" -noout -dates -subject 2>&1', { timeout: 5000 }).toString().trim();
        } catch (e) { resultado.cert_info = 'Error: ' + e.message; }

        if (!resultado.cert_existe || !resultado.key_existe) {
            return res.json({ success: false, error: 'Certificado o clave no encontrados', resultado: resultado });
        }
        if (afipService.config.modoOffline) {
            return res.json({ success: true, message: 'Modo OFFLINE activo', resultado: resultado });
        }

        try {
            var ultimoA = await afipService.ultimoComprobante(6, 1);
            var ultimoB = await afipService.ultimoComprobante(6, 6);
            resultado.wsaa = { ok: true };
            resultado.wsfe = { ok: true, factura_a: ultimoA, factura_b: ultimoB };
        } catch (e) {
            resultado.wsfe = { ok: false, error: e.message };
            return res.json({ success: false, error: 'Error WSFE: ' + e.message, resultado: resultado });
        }

        res.json({ success: true, message: 'Conexion AFIP OK', resultado: resultado });
    } catch (error) {
        logger.error('Error test AFIP:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.actualizarConfigPersonalizada = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { clave, valor } = req.body;
    if (!clave || valor === undefined) return res.status(400).json({ error: 'Clave y valor son requeridos' });
    try {
        await pool.query(
            'INSERT INTO configuraciones_empresa (id_empresa, clave, valor) VALUES ($1,$2,$3) ON CONFLICT (id_empresa, clave) DO UPDATE SET valor=$3, fecha_modificacion=NOW()',
            [id_empresa, clave, String(valor)]
        );
        logger.info('Config actualizada empresa=' + id_empresa + ': ' + clave);
        res.json({ success: true, message: 'Configuración actualizada' });
    } catch (error) {
        logger.error('Error actualizar config:', error.message);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
};

exports.obtenerTodas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        var result = await pool.query('SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa=$1 ORDER BY clave', [id_empresa]);
        res.json(result.rows);
    } catch (error) {
        logger.error('Error obtener configs:', error.message);
        res.status(500).json({ error: 'Error al obtener configuraciones' });
    }
};

/**
 * GET /api/configuraciones/venta-rapida
 * Devuelve solo las configs publicas que el JS de venta-rapida necesita.
 * Asi el frontend deja de hardcodear valores como "id=9 = CF" o "1.21 = IVA".
 *
 * Autenticado con el token de staff (la ruta esta detras de verificarToken),
 * pero solo expone configs no sensibles.
 */
exports.obtenerVentaRapida = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const CLAVES_PUBLICAS = [
            'clientes.id_consumidor_final',
            'venta_rapida.lista_precio_default',
            'venta_rapida.aplicar_lista_cliente',
            'productos.alicuota_iva_defecto',
            'cc.tolerancia_redondeo',
            'cc.cliente_cf_prohibe_fiado',
            'cc.cliente_cf_prohibe_parcial',
            'permitir_cambiar_precio_venta',
            'permitir_modificar_cantidad_borrador'
        ];
        const placeholders = CLAVES_PUBLICAS.map((_, i) => '$' + (i + 2)).join(',');
        const { rows } = await pool.query(
            'SELECT clave, valor FROM configuraciones_empresa ' +
            'WHERE id_empresa = $1 AND clave IN (' + placeholders + ')',
            [id_empresa, ...CLAVES_PUBLICAS]
        );
        const config = {};
        rows.forEach(r => { config[r.clave] = r.valor; });
        // Defaults si la config no existe
        if (!config['clientes.id_consumidor_final']) config['clientes.id_consumidor_final'] = '9';
        if (!config['venta_rapida.lista_precio_default']) config['venta_rapida.lista_precio_default'] = '1';
        if (!config['cc.tolerancia_redondeo']) config['cc.tolerancia_redondeo'] = '1.00';
        res.json(config);
    } catch (error) {
        console.error('Error obtenerVentaRapida:', error);
        res.status(500).json({ error: 'Error al obtener configs de venta-rapida' });
    }
};
