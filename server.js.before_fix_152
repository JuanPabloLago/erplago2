// =======================================================================
//                ERP LAGO - SERVIDOR (VERSIÓN COMPLETA Y CORREGIDA)
// =======================================================================

// 1. IMPORTACIÓN DE MÓDULOS
const express = require('express');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const afipService = require("./afip/afip-service");
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pdfGenerator = require('./pdf-generator');
const cron = require('node-cron');




// 2. CONFIGURACIÓN INICIAL
dotenv.config();

// ✅ VALIDACIÓN DE VARIABLES CRÍTICAS
if (!process.env.JWT_SECRET || !process.env.DB_PASSWORD) {
    console.error('❌ ERROR CRÍTICO: Variables de entorno JWT_SECRET o DB_PASSWORD faltantes en .env');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// 3. MIDDLEWARE
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
// Archivos estáticos con control de caché
app.use(express.static('frontend', {
    maxAge: 0, // Sin caché en desarrollo
    etag: false,
    setHeaders: (res, path) => {
        // JS y CSS sin caché para desarrollo
        if (path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// 4. CONEXIÓN A LA BASE DE DATOS
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ✅ Manejo de errores del pool
pool.on('error', (err) => {
    console.error('❌ Error inesperado en el pool de conexiones:', err);
    process.exit(-1);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) console.error('❌ Error al conectar con la base de datos:', err.stack);
    else console.log('✅ Conexión a la base de datos exitosa:', res.rows[0].now);
});

// 5. MIDDLEWARE DE AUTENTICACIÓN
const verificarToken = (req, res, next) => {
    const bearerHeader = req.headers['authorization'];
    if (typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        if (bearer.length !== 2 || bearer[0] !== 'Bearer') {
            return res.status(401).json({ error: 'Formato de token inválido' });
        }
        const bearerToken = bearer[1];
        jwt.verify(bearerToken, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                console.error('⚠️ Token inválido:', err.message);
                return res.status(403).json({ error: 'Token inválido o expirado' });
            }
            req.usuario = decoded;
            next();
        });
    } else {
        res.status(401).json({ error: 'Token no proporcionado' });
    }
};

// ✅ RATE LIMITING PARA LOGIN
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 10, // 10 intentos máximo
    message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// =======================================================================
//                      MÓDULO DE USUARIOS Y AUTENTICACIÓN
// =======================================================================
app.post('/api/usuarios/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    }
    try {
        const { rows } = await pool.query(
            'SELECT * FROM usuarios WHERE username = $1 AND estado = $2',
            [username, 'activo']
        );
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        const usuario = rows[0];
        const passwordValida = await bcrypt.compare(password, usuario.password_hash);
        if (!passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas' });
        }
        const payload = {
            id_usuario: usuario.id_usuario,
            id_empresa: usuario.id_empresa,
            rol: usuario.rol
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
        res.json({
            message: 'Login exitoso',
            token,
            usuario: {
                username: usuario.username,
                rol: usuario.rol,
                id_empresa: usuario.id_empresa
            }
        });
    } catch (error) {
        console.error('❌ Error en login:', error.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// =======================================================================
//                      MÓDULO DE GESTIÓN DE CLIENTES
// =======================================================================
// ⚠️ IMPORTANTE: Las rutas específicas (/buscar) deben ir ANTES de las rutas con parámetros (/:id)

// GET - Búsqueda de clientes (debe ir ANTES de /:id)
// GET - Búsqueda de clientes (debe ir ANTES de /:id)
app.get('/api/clientes/buscar', verificarToken, async (req, res) => {

// ========================================================================
//                    ENDPOINT PÚBLICO - VER PEDIDO POR TOKEN
// ========================================================================
app.get('/api/pedido-publico/:token', async (req, res) => {
    const token = req.params.token;
    
    try {
        // Buscar pedido por token
        const queryPedido = `
            SELECT
                p.*,
                c.razon_social as cliente_nombre,
                c.telefono as cliente_telefono,
                c.domicilio as cliente_direccion,
                c.email as cliente_email,
                pe.nombre as estado_nombre,
                e.razon_social as empresa_razon_social,
                e.direccion as empresa_direccion,
                e.telefono as empresa_telefono,
                e.email as empresa_email
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.token_publico = $1
        `;
        
        const resultPedido = await pool.query(queryPedido, [token]);
        
        if (resultPedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado o token inválido' });
        }
        
        const pedido = resultPedido.rows[0];
        
        // Obtener items del pedido
        const queryItems = `
            SELECT
                pi.*,
                p.nombre as producto_nombre,
                p.codigo as producto_codigo
            FROM pedidoitems pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item
        `;
        
        const resultItems = await pool.query(queryItems, [pedido.id_pedido]);
        
        res.json({
            success: true,
            pedido: pedido,
            items: resultItems.rows
        });
        
    } catch (error) {
        console.error('❌ Error al obtener pedido público:', error);
        res.status(500).json({ error: 'Error al obtener el pedido' });
    }
});

    const { q } = req.query;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    if (!q || q.trim().length === 0) {
        return res.json([]);
    }

    try {
        const termino = `%${q.trim().toLowerCase()}%`;
        const searchQuery = `
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil as cuit, c.domicilio as direccion, c.telefono, c.email, ci.nombre as condicion_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_empresa = $1 AND c.activo = TRUE
              AND (LOWER(c.razon_social) LIKE $2 
                   OR c.cuit_cuil::text LIKE $2 
                   OR LOWER(c.email) LIKE $2)
            ORDER BY c.razon_social
            LIMIT 20`;

        const { rows } = await pool.query(searchQuery, [id_empresa, termino]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error en búsqueda de clientes:', error.message);
        res.status(500).json({ error: 'Error al buscar clientes' });
    }
});



// GET - Listar todos los clientes

// GET - Obtener un cliente específico por ID
app.get('/api/clientes/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);
    
    try {
        const query = `
            SELECT c.*, ci.nombre as condicion_iva_desc
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_cliente = $1 AND c.id_empresa = $2 AND c.activo = TRUE`;
            
        const { rows } = await pool.query(query, [id_cliente, id_empresa]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error al obtener cliente:', error.message);
        res.status(500).json({ error: 'Error al obtener cliente' });
    }
});

app.get('/api/clientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `
            SELECT c.*, ci.nombre as condicion_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_empresa = $1 AND c.activo = TRUE
            ORDER BY c.razon_social`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener clientes:', error.message);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
});

// POST - Crear nuevo cliente
app.post('/api/clientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { razon_social, cuit_cuil, id_condicion_iva, domicilio, telefono, email } = req.body;

    if (!razon_social || !id_condicion_iva) {
        return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    }

    try {
        const query = `
            INSERT INTO clientes (id_empresa, razon_social, cuit_cuil, id_condicion_iva, domicilio, telefono, email, activo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *`;
        const { rows } = await pool.query(query, [
            id_empresa,
            razon_social,
            cuit_cuil || null,
            id_condicion_iva,
            domicilio || null,
            telefono || null,
            email || null
        ]);
        res.status(201).json({ message: 'Cliente creado exitosamente', cliente: rows[0] });
    } catch (error) {
        console.error('❌ Error al crear cliente:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El CUIT/CUIL ya existe' });
        }
        res.status(500).json({ error: 'Error al crear cliente' });
    }
});

// PUT - Actualizar cliente
app.put('/api/clientes/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);
    const { razon_social, cuit_cuil, id_condicion_iva, domicilio, telefono, email } = req.body;

    if (!razon_social || !id_condicion_iva) {
        return res.status(400).json({ error: 'Razón social y condición IVA son requeridos' });
    }

    try {
        const query = `
            UPDATE clientes
            SET razon_social = $1, cuit_cuil = $2, id_condicion_iva = $3,
                domicilio = $4, telefono = $5, email = $6
            WHERE id_cliente = $7 AND id_empresa = $8 AND activo = TRUE
            RETURNING *`;
        const { rows } = await pool.query(query, [
            razon_social,
            cuit_cuil || null,
            id_condicion_iva,
            domicilio || null,
            telefono || null,
            email || null,
            id_cliente,
            id_empresa
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({ message: 'Cliente actualizado exitosamente', cliente: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar cliente:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El CUIT/CUIL ya existe' });
        }
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
});

// DELETE - Eliminar cliente (lógico)
app.delete('/api/clientes/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);

    try {
        const query = `
            UPDATE clientes
            SET activo = FALSE
            WHERE id_cliente = $1 AND id_empresa = $2
            RETURNING *`;
        const { rows } = await pool.query(query, [id_cliente, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({ message: 'Cliente eliminado exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar cliente:', error.message);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
});

// =======================================================================
// =======================================================================
//                      MÓDULO DE GESTIÓN DE PROVEEDORES
// =======================================================================

// GET - Buscar proveedores (debe ir ANTES de /:id)
app.get('/api/proveedores/buscar', verificarToken, async (req, res) => {
    const { q } = req.query;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    if (!q || q.trim().length === 0) {
        return res.json([]);
    }

    try {
        const termino = `%${q.trim().toLowerCase()}%`;
        const searchQuery = `
            SELECT p.id_proveedor, p.razon_social, p.nombre_fantasia, p.cuit, 
                   p.email, p.telefono, p.rubro, ci.nombre as condicion_iva
            FROM proveedores p
            LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva
            WHERE p.id_empresa = $1 AND p.activo = TRUE
              AND (LOWER(p.razon_social) LIKE $2 
                   OR LOWER(p.nombre_fantasia) LIKE $2
                   OR p.cuit::text LIKE $2 
                   OR LOWER(p.email) LIKE $2)
            ORDER BY p.razon_social
            LIMIT 20`;

        const { rows } = await pool.query(searchQuery, [id_empresa, termino]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error en búsqueda de proveedores:', error.message);
        res.status(500).json({ error: 'Error al buscar proveedores' });
    }
});

// GET - Listar todos los proveedores
app.get('/api/proveedores', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `
            SELECT p.*, ci.nombre as condicion_iva
            FROM proveedores p
            LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva
            WHERE p.id_empresa = $1 AND p.activo = TRUE
            ORDER BY p.razon_social`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener proveedores:', error.message);
        res.status(500).json({ error: 'Error al obtener proveedores' });
    }
});

// GET - Obtener un proveedor específico
app.get('/api/proveedores/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_proveedor = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT p.*, ci.nombre as condicion_iva
            FROM proveedores p
            LEFT JOIN condicionesiva ci ON p.id_condicion_iva = ci.id_condicion_iva
            WHERE p.id_proveedor = $1 AND p.id_empresa = $2 AND p.activo = TRUE`;
        
        const { rows } = await pool.query(query, [id_proveedor, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error al obtener proveedor:', error.message);
        res.status(500).json({ error: 'Error al obtener proveedor' });
    }
});

// POST - Crear nuevo proveedor
app.post('/api/proveedores', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { 
        razon_social, 
        nombre_fantasia, 
        cuit, 
        id_condicion_iva, 
        rubro,
        domicilio, 
        telefono, 
        email,
        contacto_nombre,
        contacto_puesto
    } = req.body;

    if (!razon_social || !cuit || !id_condicion_iva) {
        return res.status(400).json({ error: 'Razón social, CUIT y condición IVA son requeridos' });
    }

    try {
        const query = `
            INSERT INTO proveedores (
                id_empresa, razon_social, nombre_fantasia, cuit, id_condicion_iva,
                rubro, domicilio, telefono, email, contacto_nombre, contacto_puesto, activo
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE)
            RETURNING *`;
        
        const { rows } = await pool.query(query, [
            id_empresa,
            razon_social,
            nombre_fantasia || null,
            cuit,
            id_condicion_iva,
            rubro || null,
            domicilio || null,
            telefono || null,
            email || null,
            contacto_nombre || null,
            contacto_puesto || null
        ]);
        
        res.status(201).json({ message: 'Proveedor creado exitosamente', proveedor: rows[0] });
    } catch (error) {
        console.error('❌ Error al crear proveedor:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El CUIT ya existe para esta empresa' });
        }
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

// PUT - Actualizar proveedor
app.put('/api/proveedores/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_proveedor = parseInt(req.params.id, 10);
    const { 
        razon_social, 
        nombre_fantasia, 
        cuit, 
        id_condicion_iva, 
        rubro,
        domicilio, 
        telefono, 
        email,
        contacto_nombre,
        contacto_puesto
    } = req.body;

    if (!razon_social || !cuit || !id_condicion_iva) {
        return res.status(400).json({ error: 'Razón social, CUIT y condición IVA son requeridos' });
    }

    try {
        const query = `
            UPDATE proveedores
            SET razon_social = $1, nombre_fantasia = $2, cuit = $3, 
                id_condicion_iva = $4, rubro = $5, domicilio = $6, 
                telefono = $7, email = $8, contacto_nombre = $9, 
                contacto_puesto = $10, fecha_modificacion = now()
            WHERE id_proveedor = $11 AND id_empresa = $12 AND activo = TRUE
            RETURNING *`;
        
        const { rows } = await pool.query(query, [
            razon_social,
            nombre_fantasia || null,
            cuit,
            id_condicion_iva,
            rubro || null,
            domicilio || null,
            telefono || null,
            email || null,
            contacto_nombre || null,
            contacto_puesto || null,
            id_proveedor,
            id_empresa
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        res.json({ message: 'Proveedor actualizado exitosamente', proveedor: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar proveedor:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El CUIT ya existe para esta empresa' });
        }
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

// DELETE - Eliminar proveedor (lógico)
app.delete('/api/proveedores/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_proveedor = parseInt(req.params.id, 10);

    try {
        const query = `
            UPDATE proveedores
            SET activo = FALSE, fecha_modificacion = now()
            WHERE id_proveedor = $1 AND id_empresa = $2
            RETURNING *`;
        
        const { rows } = await pool.query(query, [id_proveedor, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Proveedor no encontrado' });
        }

        res.json({ message: 'Proveedor eliminado exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar proveedor:', error.message);
        res.status(500).json({ error: 'Error al eliminar proveedor' });
    }
});


// GET - Obtener condiciones IVA (para combos/selects)
app.get('/api/condicionesiva', verificarToken, async (req, res) => {
    try {
        const query = 'SELECT * FROM condicionesiva ORDER BY nombre';
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener condiciones IVA:', error.message);
        res.status(500).json({ error: 'Error al obtener condiciones IVA' });
    }
});


// =======================================================================
//                      MÓDULO DE GESTIÓN DE CATEGORÍAS
// =======================================================================

// GET - Listar todas las categorías con jerarquía
app.get('/api/categorias', verificarToken, async (req, res) => {
    try {
        const query = `
            SELECT c.*, cp.nombre as categoria_padre
            FROM categorias c
            LEFT JOIN categorias cp ON c.id_categoria_padre = cp.id_categoria
            WHERE c.activo = TRUE
            ORDER BY COALESCE(c.id_categoria_padre, 0), c.orden, c.nombre`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener categorías:', error.message);
        res.status(500).json({ error: 'Error al obtener categorías' });
    }
});

// GET - Obtener categorías principales (sin padre)
app.get('/api/categorias/principales', verificarToken, async (req, res) => {
    try {
        const query = `
            SELECT * FROM categorias
            WHERE id_categoria_padre IS NULL AND activo = TRUE
            ORDER BY orden, nombre`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener categorías principales:', error.message);
        res.status(500).json({ error: 'Error al obtener categorías principales' });
    }
});

// GET - Obtener subcategorías de una categoría
app.get('/api/categorias/:id/subcategorias', verificarToken, async (req, res) => {
    const id_categoria = parseInt(req.params.id, 10);
    try {
        const query = `
            SELECT * FROM categorias
            WHERE id_categoria_padre = $1 AND activo = TRUE
            ORDER BY orden, nombre`;
        const { rows } = await pool.query(query, [id_categoria]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener subcategorías:', error.message);
        res.status(500).json({ error: 'Error al obtener subcategorías' });
    }
});

// GET - Obtener árbol completo de categorías
app.get('/api/categorias/arbol', verificarToken, async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT * FROM categorias
            WHERE activo = TRUE
            ORDER BY COALESCE(id_categoria_padre, 0), orden, nombre`);
        
        // Construir árbol jerárquico
        const categorias = rows.filter(c => c.id_categoria_padre === null);
        categorias.forEach(cat => {
            cat.subcategorias = rows.filter(c => c.id_categoria_padre === cat.id_categoria);
        });
        
        res.json(categorias);
    } catch (error) {
        console.error('❌ Error al obtener árbol de categorías:', error.message);
        res.status(500).json({ error: 'Error al obtener árbol de categorías' });
    }
});

// POST - Crear nueva categoría
app.post('/api/categorias', verificarToken, async (req, res) => {
    const { nombre, descripcion, id_categoria_padre, orden } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    try {
        const query = `
            INSERT INTO categorias (nombre, descripcion, id_categoria_padre, orden, activo)
            VALUES ($1, $2, $3, $4, TRUE)
            RETURNING *`;
        const { rows } = await pool.query(query, [
            nombre,
            descripcion || null,
            id_categoria_padre || null,
            orden || 0
        ]);
        res.status(201).json({ message: 'Categoría creada exitosamente', categoria: rows[0] });
    } catch (error) {
        console.error('❌ Error al crear categoría:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
        }
        res.status(500).json({ error: 'Error al crear categoría' });
    }
});

// PUT - Actualizar categoría
app.put('/api/categorias/:id', verificarToken, async (req, res) => {
    const id_categoria = parseInt(req.params.id, 10);
    const { nombre, descripcion, id_categoria_padre, orden } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    // Validar que no se asigne como padre a sí misma
    if (id_categoria_padre === id_categoria) {
        return res.status(400).json({ error: 'Una categoría no puede ser su propio padre' });
    }

    try {
        const query = `
            UPDATE categorias
            SET nombre = $1, descripcion = $2, id_categoria_padre = $3, orden = $4
            WHERE id_categoria = $5 AND activo = TRUE
            RETURNING *`;
        const { rows } = await pool.query(query, [
            nombre,
            descripcion || null,
            id_categoria_padre || null,
            orden || 0,
            id_categoria
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        res.json({ message: 'Categoría actualizada exitosamente', categoria: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar categoría:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
        }
        res.status(500).json({ error: 'Error al actualizar categoría' });
    }
});

// DELETE - Eliminar categoría (lógico)
app.delete('/api/categorias/:id', verificarToken, async (req, res) => {
    const id_categoria = parseInt(req.params.id, 10);

    try {
        // Verificar si tiene subcategorías
        const checkSub = await pool.query(
            'SELECT COUNT(*) as total FROM categorias WHERE id_categoria_padre = $1 AND activo = TRUE',
            [id_categoria]
        );

        if (parseInt(checkSub.rows[0].total) > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar una categoría que tiene subcategorías activas' 
            });
        }

        // Verificar si tiene productos
        const checkProd = await pool.query(
            'SELECT COUNT(*) as total FROM productos WHERE id_categoria = $1 AND activo = TRUE',
            [id_categoria]
        );

        if (parseInt(checkProd.rows[0].total) > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar una categoría que tiene productos asignados' 
            });
        }

        const query = `
            UPDATE categorias
            SET activo = FALSE
            WHERE id_categoria = $1
            RETURNING *`;
        const { rows } = await pool.query(query, [id_categoria]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        res.json({ message: 'Categoría eliminada exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar categoría:', error.message);
        res.status(500).json({ error: 'Error al eliminar categoría' });
    }
});


// =======================================================================
//                      MÓDULO DE GESTIÓN DE MARCAS
// =======================================================================

// GET - Listar todas las marcas
app.get('/api/marcas', verificarToken, async (req, res) => {
    try {
        const query = `
            SELECT * FROM marcas
            WHERE activo = TRUE
            ORDER BY nombre`;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener marcas:', error.message);
        res.status(500).json({ error: 'Error al obtener marcas' });
    }
});

// GET - Obtener una marca específica
app.get('/api/marcas/:id', verificarToken, async (req, res) => {
    const id_marca = parseInt(req.params.id, 10);
    try {
        const query = 'SELECT * FROM marcas WHERE id_marca = $1 AND activo = TRUE';
        const { rows } = await pool.query(query, [id_marca]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Marca no encontrada' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error al obtener marca:', error.message);
        res.status(500).json({ error: 'Error al obtener marca' });
    }
});

// POST - Crear nueva marca
app.post('/api/marcas', verificarToken, async (req, res) => {
    const { nombre, descripcion, pais_origen, sitio_web, logo } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    try {
        const query = `
            INSERT INTO marcas (nombre, descripcion, pais_origen, sitio_web, logo, activo)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            RETURNING *`;
        const { rows } = await pool.query(query, [
            nombre,
            descripcion || null,
            pais_origen || null,
            sitio_web || null,
            logo || null
        ]);
        res.status(201).json({ message: 'Marca creada exitosamente', marca: rows[0] });
    } catch (error) {
        console.error('❌ Error al crear marca:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
        }
        res.status(500).json({ error: 'Error al crear marca' });
    }
});

// PUT - Actualizar marca
app.put('/api/marcas/:id', verificarToken, async (req, res) => {
    const id_marca = parseInt(req.params.id, 10);
    const { nombre, descripcion, pais_origen, sitio_web, logo } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    try {
        const query = `
            UPDATE marcas
            SET nombre = $1, descripcion = $2, pais_origen = $3, 
                sitio_web = $4, logo = $5, fecha_modificacion = now()
            WHERE id_marca = $6 AND activo = TRUE
            RETURNING *`;
        const { rows } = await pool.query(query, [
            nombre,
            descripcion || null,
            pais_origen || null,
            sitio_web || null,
            logo || null,
            id_marca
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Marca no encontrada' });
        }

        res.json({ message: 'Marca actualizada exitosamente', marca: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar marca:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Ya existe una marca con ese nombre' });
        }
        res.status(500).json({ error: 'Error al actualizar marca' });
    }
});

// DELETE - Eliminar marca (lógico)
app.delete('/api/marcas/:id', verificarToken, async (req, res) => {
    const id_marca = parseInt(req.params.id, 10);

    try {
        // Verificar si tiene productos
        const checkProd = await pool.query(
            'SELECT COUNT(*) as total FROM productos WHERE id_marca = $1 AND activo = TRUE',
            [id_marca]
        );

        if (parseInt(checkProd.rows[0].total) > 0) {
            return res.status(400).json({ 
                error: 'No se puede eliminar una marca que tiene productos asignados' 
            });
        }

        const query = `
            UPDATE marcas
            SET activo = FALSE, fecha_modificacion = now()
            WHERE id_marca = $1
            RETURNING *`;
        const { rows } = await pool.query(query, [id_marca]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Marca no encontrada' });
        }

        res.json({ message: 'Marca eliminada exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar marca:', error.message);
        res.status(500).json({ error: 'Error al eliminar marca' });
    }
});


// =======================================================================
//                      MÓDULO DE VARIANTES DE PRODUCTOS
// =======================================================================

// GET - Obtener todas las variantes de un producto
app.get('/api/productos/:id/variantes', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    try {
        const query = `
            SELECT v.*, p.nombre as producto_maestro, p.sku as sku_maestro
            FROM producto_variantes v
            JOIN productos p ON v.id_producto = p.id_producto
            WHERE v.id_producto = $1 AND v.activo = TRUE
            ORDER BY v.nombre_variante`;
        const { rows } = await pool.query(query, [id_producto]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener variantes:', error.message);
        res.status(500).json({ error: 'Error al obtener variantes' });
    }
});

// GET - Obtener una variante específica
app.get('/api/variantes/:id', verificarToken, async (req, res) => {
    const id_variante = parseInt(req.params.id, 10);
    try {
        const query = `
            SELECT v.*, p.nombre as producto_maestro
            FROM producto_variantes v
            JOIN productos p ON v.id_producto = p.id_producto
            WHERE v.id_variante = $1 AND v.activo = TRUE`;
        const { rows } = await pool.query(query, [id_variante]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error al obtener variante:', error.message);
        res.status(500).json({ error: 'Error al obtener variante' });
    }
});

// POST - Crear nueva variante
app.post('/api/productos/:id/variantes', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    const { nombre_variante, sku, precio, stock, stock_minimo, atributos } = req.body;

    if (!nombre_variante || !sku) {
        return res.status(400).json({ error: 'Nombre y SKU son requeridos' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Verificar que el producto existe
        const prodCheck = await client.query(
            'SELECT id_producto, tiene_variantes FROM productos WHERE id_producto = $1',
            [id_producto]
        );

        if (prodCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Marcar producto como que tiene variantes
        if (!prodCheck.rows[0].tiene_variantes) {
            await client.query(
                'UPDATE productos SET tiene_variantes = TRUE WHERE id_producto = $1',
                [id_producto]
            );
        }

        // Crear la variante
        const query = `
            INSERT INTO producto_variantes 
            (id_producto, nombre_variante, sku, precio, stock, stock_minimo, atributos, activo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *`;
        
        const { rows } = await client.query(query, [
            id_producto,
            nombre_variante,
            sku,
            precio || 0,
            stock || 0,
            stock_minimo || 0,
            atributos ? JSON.stringify(atributos) : null
        ]);

        await client.query('COMMIT');

        res.status(201).json({ 
            message: 'Variante creada exitosamente', 
            variante: rows[0] 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear variante:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El SKU ya existe' });
        }
        res.status(500).json({ error: 'Error al crear variante' });
    } finally {
        client.release();
    }
});

// PUT - Actualizar variante
app.put('/api/variantes/:id', verificarToken, async (req, res) => {
    const id_variante = parseInt(req.params.id, 10);
    const { nombre_variante, sku, precio, stock, stock_minimo, atributos } = req.body;

    if (!nombre_variante || !sku) {
        return res.status(400).json({ error: 'Nombre y SKU son requeridos' });
    }

    try {
        const query = `
            UPDATE producto_variantes
            SET nombre_variante = $1, sku = $2, precio = $3, 
                stock = $4, stock_minimo = $5, atributos = $6,
                fecha_modificacion = now()
            WHERE id_variante = $7 AND activo = TRUE
            RETURNING *`;
        
        const { rows } = await pool.query(query, [
            nombre_variante,
            sku,
            precio || 0,
            stock || 0,
            stock_minimo || 0,
            atributos ? JSON.stringify(atributos) : null,
            id_variante
        ]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        res.json({ 
            message: 'Variante actualizada exitosamente', 
            variante: rows[0] 
        });
    } catch (error) {
        console.error('❌ Error al actualizar variante:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El SKU ya existe' });
        }
        res.status(500).json({ error: 'Error al actualizar variante' });
    }
});

// DELETE - Eliminar variante (lógico)
app.delete('/api/variantes/:id', verificarToken, async (req, res) => {
    const id_variante = parseInt(req.params.id, 10);

    try {
        const query = `
            UPDATE producto_variantes
            SET activo = FALSE, fecha_modificacion = now()
            WHERE id_variante = $1
            RETURNING *`;
        
        const { rows } = await pool.query(query, [id_variante]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        res.json({ message: 'Variante eliminada exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar variante:', error.message);
        res.status(500).json({ error: 'Error al eliminar variante' });
    }
});

// GET - Buscar variantes (para POS)
app.get('/api/variantes/buscar', verificarToken, async (req, res) => {
    const { q } = req.query;

    if (!q || q.trim().length < 1) {
        return res.json({ results: [] });
    }

    const query_text = q.trim();

    try {
        const searchQuery = `
            SELECT v.*, p.nombre as producto_maestro
            FROM producto_variantes v
            JOIN productos p ON v.id_producto = p.id_producto
            WHERE v.activo = TRUE
              AND (v.sku ILIKE $1
                   OR v.nombre_variante ILIKE $1
                   OR p.nombre ILIKE $1)
            ORDER BY v.nombre_variante
            LIMIT 20`;

        const { rows } = await pool.query(searchQuery, [`%${query_text}%`]);
        res.json({ results: rows });
    } catch (error) {
        console.error('❌ Error en búsqueda de variantes:', error.message);
        res.status(500).json({ error: 'Error al buscar variantes' });
    }
});


// =======================================================================
//                      MÓDULO DE CONJUNTOS DE PRODUCTOS
// =======================================================================

// GET - Listar todos los conjuntos con sus productos
app.get('/api/conjuntos', verificarToken, async (req, res) => {
    try {
        const query = `
            SELECT c.*,
                   json_agg(
                       json_build_object(
                           'id_producto', p.id_producto,
                           'nombre', p.nombre,
                           'sku', p.sku,
                           'cantidad', ci.cantidad
                       ) ORDER BY p.nombre
                   ) FILTER (WHERE p.id_producto IS NOT NULL) as productos
            FROM conjuntos c
            LEFT JOIN conjunto_items ci ON c.id_conjunto = ci.id_conjunto
            LEFT JOIN productos p ON ci.id_producto = p.id_producto
            WHERE c.activo = TRUE
            GROUP BY c.id_conjunto
            ORDER BY c.nombre`;
        
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener conjuntos:', error.message);
        res.status(500).json({ error: 'Error al obtener conjuntos' });
    }
});

// GET - Obtener un conjunto específico con sus productos
app.get('/api/conjuntos/:id', verificarToken, async (req, res) => {
    const id_conjunto = parseInt(req.params.id, 10);
    try {
        const conjuntoQuery = `
            SELECT * FROM conjuntos WHERE id_conjunto = $1 AND activo = TRUE`;
        const conjuntoRes = await pool.query(conjuntoQuery, [id_conjunto]);

        if (conjuntoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Conjunto no encontrado' });
        }

        const itemsQuery = `
            SELECT ci.*, p.nombre, p.sku, p.descripcion
            FROM conjunto_items ci
            JOIN productos p ON ci.id_producto = p.id_producto
            WHERE ci.id_conjunto = $1
            ORDER BY p.nombre`;
        const itemsRes = await pool.query(itemsQuery, [id_conjunto]);

        res.json({
            ...conjuntoRes.rows[0],
            productos: itemsRes.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener conjunto:', error.message);
        res.status(500).json({ error: 'Error al obtener conjunto' });
    }
});

// POST - Crear nuevo conjunto con productos
app.post('/api/conjuntos', verificarToken, async (req, res) => {
    const { nombre, descripcion, precio_conjunto, descuento_porcentaje, productos } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    if (!productos || productos.length === 0) {
        return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Crear conjunto
        const conjuntoQuery = `
            INSERT INTO conjuntos (nombre, descripcion, precio_conjunto, descuento_porcentaje, activo)
            VALUES ($1, $2, $3, $4, TRUE)
            RETURNING *`;
        
        const conjuntoRes = await client.query(conjuntoQuery, [
            nombre,
            descripcion || null,
            precio_conjunto || 0,
            descuento_porcentaje || 0
        ]);

        const id_conjunto = conjuntoRes.rows[0].id_conjunto;

        // Agregar productos
        for (const prod of productos) {
            await client.query(
                'INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad) VALUES ($1, $2, $3)',
                [id_conjunto, prod.id_producto, prod.cantidad || 1]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({ 
            message: 'Conjunto creado exitosamente', 
            conjunto: conjuntoRes.rows[0] 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear conjunto:', error.message);
        res.status(500).json({ error: 'Error al crear conjunto' });
    } finally {
        client.release();
    }
});

// PUT - Actualizar conjunto
app.put('/api/conjuntos/:id', verificarToken, async (req, res) => {
    const id_conjunto = parseInt(req.params.id, 10);
    const { nombre, descripcion, precio_conjunto, descuento_porcentaje, productos } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Actualizar conjunto
        const conjuntoQuery = `
            UPDATE conjuntos
            SET nombre = $1, descripcion = $2, precio_conjunto = $3, 
                descuento_porcentaje = $4, fecha_modificacion = now()
            WHERE id_conjunto = $5 AND activo = TRUE
            RETURNING *`;
        
        const conjuntoRes = await client.query(conjuntoQuery, [
            nombre,
            descripcion || null,
            precio_conjunto || 0,
            descuento_porcentaje || 0,
            id_conjunto
        ]);

        if (conjuntoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Conjunto no encontrado' });
        }

        // Si se envían productos, actualizar la lista
        if (productos && Array.isArray(productos)) {
            // Eliminar items existentes
            await client.query('DELETE FROM conjunto_items WHERE id_conjunto = $1', [id_conjunto]);

            // Agregar nuevos items
            for (const prod of productos) {
                await client.query(
                    'INSERT INTO conjunto_items (id_conjunto, id_producto, cantidad) VALUES ($1, $2, $3)',
                    [id_conjunto, prod.id_producto, prod.cantidad || 1]
                );
            }
        }

        await client.query('COMMIT');

        res.json({ 
            message: 'Conjunto actualizado exitosamente', 
            conjunto: conjuntoRes.rows[0] 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al actualizar conjunto:', error.message);
        res.status(500).json({ error: 'Error al actualizar conjunto' });
    } finally {
        client.release();
    }
});

// DELETE - Eliminar conjunto (lógico)
app.delete('/api/conjuntos/:id', verificarToken, async (req, res) => {
    const id_conjunto = parseInt(req.params.id, 10);

    try {
        const query = `
            UPDATE conjuntos
            SET activo = FALSE, fecha_modificacion = now()
            WHERE id_conjunto = $1
            RETURNING *`;
        
        const { rows } = await pool.query(query, [id_conjunto]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Conjunto no encontrado' });
        }

        res.json({ message: 'Conjunto eliminado exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar conjunto:', error.message);
        res.status(500).json({ error: 'Error al eliminar conjunto' });
    }
});

// GET - Obtener conjuntos que contienen un producto específico
app.get('/api/productos/:id/conjuntos', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    try {
        const query = `
            SELECT c.*, ci.cantidad
            FROM conjuntos c
            JOIN conjunto_items ci ON c.id_conjunto = ci.id_conjunto
            WHERE ci.id_producto = $1 AND c.activo = TRUE
            ORDER BY c.nombre`;
        
        const { rows } = await pool.query(query, [id_producto]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener conjuntos del producto:', error.message);
        res.status(500).json({ error: 'Error al obtener conjuntos' });
    }
});


// =======================================================================
//                   MÓDULO DE ENTREGAS PARCIALES
// =======================================================================

// GET - Obtener entregas de un pedido
app.get('/api/pedidos/:id/entregas', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT pe.*, u.username as usuario,
                   json_agg(
                       json_build_object(
                           'id_producto', p.id_producto,
                           'nombre', p.nombre,
                           'cantidad_entregada', pei.cantidad_entregada
                       ) ORDER BY p.nombre
                   ) as items
            FROM pedido_entregas pe
            JOIN usuarios u ON pe.id_usuario = u.id_usuario
            LEFT JOIN pedido_entrega_items pei ON pe.id_entrega = pei.id_entrega
            LEFT JOIN pedidoitems pi ON pei.id_pedido_item = pi.id_item
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pe.id_pedido = $1
            GROUP BY pe.id_entrega, u.username
            ORDER BY pe.fecha_entrega DESC`;

        const { rows } = await pool.query(query, [id_pedido]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener entregas:', error.message);
        res.status(500).json({ error: 'Error al obtener entregas' });
    }
});

// GET - Estado de entrega de un pedido (pendiente/parcial/completo)
app.get('/api/pedidos/:id/estado-entrega', verificarToken, async (req, res) => {
    const id_pedido = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT 
                pi.id_item,
                p.nombre as producto,
                pi.cantidad as cantidad_pedida,
                COALESCE(pi.cantidad_entregada, 0) as cantidad_entregada,
                pi.cantidad - COALESCE(pi.cantidad_entregada, 0) as cantidad_pendiente,
                CASE 
                    WHEN pi.cantidad <= COALESCE(pi.cantidad_entregada, 0) THEN 'completo'
                    WHEN COALESCE(pi.cantidad_entregada, 0) > 0 THEN 'parcial'
                    ELSE 'pendiente'
                END as estado
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY p.nombre`;

        const { rows } = await pool.query(query, [id_pedido]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener estado:', error.message);
        res.status(500).json({ error: 'Error al obtener estado de entrega' });
    }
});

// POST - Registrar entrega parcial
app.post('/api/pedidos/:id/entregas', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const id_pedido = parseInt(req.params.id, 10);
    const { items, observaciones } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir items a entregar' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener próximo número de entrega
        const numeroRes = await client.query(`
            SELECT COALESCE(MAX(numero_entrega), 0) + 1 as proximo
            FROM pedido_entregas WHERE id_pedido = $1`,
            [id_pedido]
        );
        const numero_entrega = numeroRes.rows[0].proximo;

        // Crear registro de entrega
        const entregaRes = await client.query(`
            INSERT INTO pedido_entregas (id_pedido, id_usuario, numero_entrega, observaciones)
            VALUES ($1, $2, $3, $4)
            RETURNING *`,
            [id_pedido, id_usuario, numero_entrega, observaciones || null]
        );

        const id_entrega = entregaRes.rows[0].id_entrega;

        // Procesar cada item
        for (const item of items) {
            const { id_pedido_item, cantidad_entregada } = item;

            // Verificar cantidad disponible
            const disponibleRes = await client.query(`
                SELECT cantidad - COALESCE(cantidad_entregada, 0) as disponible
                FROM pedidoitems WHERE id_item = $1`,
                [id_pedido_item]
            );

            const disponible = parseFloat(disponibleRes.rows[0].disponible);

            if (disponible < parseFloat(cantidad_entregada)) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: `Cantidad a entregar (${cantidad_entregada}) supera lo pendiente (${disponible})`
                });
            }

            // Registrar item de entrega
            await client.query(`
                INSERT INTO pedido_entrega_items (id_entrega, id_pedido_item, cantidad_entregada)
                VALUES ($1, $2, $3)`,
                [id_entrega, id_pedido_item, cantidad_entregada]
            );

            // Actualizar cantidad entregada en pedidoitems
            await client.query(`
                UPDATE pedidoitems
                SET cantidad_entregada = COALESCE(cantidad_entregada, 0) + $1
                WHERE id_item = $2`,
                [cantidad_entregada, id_pedido_item]
            );
        }

        // Calcular estado del pedido
        const estadoRes = await client.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN cantidad <= COALESCE(cantidad_entregada, 0) THEN 1 END) as completos
            FROM pedidoitems
            WHERE id_pedido = $1`,
            [id_pedido]
        );

        const { total, completos } = estadoRes.rows[0];
        let estado_entrega = 'pendiente';

        if (parseInt(completos) === parseInt(total)) {
            estado_entrega = 'completo';
        } else if (parseInt(completos) > 0) {
            estado_entrega = 'parcial';
        }

        // Actualizar estado del pedido
        await client.query(`
            UPDATE pedidos SET estado_entrega = $1 WHERE id_pedido = $2`,
            [estado_entrega, id_pedido]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: `Entrega #${numero_entrega} registrada. Estado: ${estado_entrega}`,
            entrega: entregaRes.rows[0],
            estado_entrega
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al registrar entrega:', error.message);
        res.status(500).json({ error: 'Error al registrar entrega' });
    } finally {
        client.release();
    }
});

// =======================================================================
//                   MÓDULO DE COMPROBANTES INTERNOS
// =======================================================================

// GET - Listar comprobantes internos
app.get('/api/comprobantes-internos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT ci.*, c.razon_social as cliente, u.username as usuario
            FROM comprobantes_internos ci
            LEFT JOIN clientes c ON ci.id_cliente = c.id_cliente
            JOIN usuarios u ON ci.id_usuario = u.id_usuario
            WHERE ci.id_empresa = $1
            ORDER BY ci.fecha_emision DESC
            LIMIT 100`;

        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener comprobantes:', error.message);
        res.status(500).json({ error: 'Error al obtener comprobantes' });
    }
});

// GET - Obtener comprobante interno por ID
app.get('/api/comprobantes-internos/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_comprobante = parseInt(req.params.id, 10);

    try {
        const comprobanteQuery = `
            SELECT ci.*, c.razon_social as cliente, u.username as usuario
            FROM comprobantes_internos ci
            LEFT JOIN clientes c ON ci.id_cliente = c.id_cliente
            JOIN usuarios u ON ci.id_usuario = u.id_usuario
            WHERE ci.id_comprobante = $1 AND ci.id_empresa = $2`;

        const comprobanteRes = await pool.query(comprobanteQuery, [id_comprobante, id_empresa]);

        if (comprobanteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Comprobante no encontrado' });
        }

        const itemsQuery = `
            SELECT cii.*, p.nombre as producto
            FROM comprobante_interno_items cii
            LEFT JOIN productos p ON cii.id_producto = p.id_producto
            WHERE cii.id_comprobante = $1`;

        const itemsRes = await pool.query(itemsQuery, [id_comprobante]);

        res.json({
            ...comprobanteRes.rows[0],
            items: itemsRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener comprobante:', error.message);
        res.status(500).json({ error: 'Error al obtener comprobante' });
    }
});

// POST - Crear comprobante interno desde pedido
app.post('/api/comprobantes-internos/desde-pedido/:id_pedido', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const id_pedido = parseInt(req.params.id_pedido, 10);
    const { observaciones } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener datos del pedido
        const pedidoRes = await client.query(`
            SELECT p.*, c.razon_social
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            WHERE p.id_pedido = $1 AND p.id_empresa = $2`,
            [id_pedido, id_empresa]
        );

        if (pedidoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = pedidoRes.rows[0];

        // Obtener próximo número de comprobante
        const numeroRes = await client.query(`
            SELECT COALESCE(MAX(numero_comprobante), 0) + 1 as proximo
            FROM comprobantes_internos WHERE id_empresa = $1`,
            [id_empresa]
        );
        const numero_comprobante = numeroRes.rows[0].proximo;

        // Crear comprobante
        const comprobanteRes = await client.query(`
            INSERT INTO comprobantes_internos (
                id_empresa, id_pedido, id_cliente, id_usuario,
                numero_comprobante, subtotal, descuento_general,
                recargo, total, observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`,
            [
                id_empresa, id_pedido, pedido.id_cliente, id_usuario,
                numero_comprobante, pedido.total, 0, 0, pedido.total,
                observaciones || null
            ]
        );

        const id_comprobante = comprobanteRes.rows[0].id_comprobante;

        // Copiar items del pedido
        const itemsRes = await client.query(`
            SELECT pi.*, p.nombre
            FROM pedidoitems pi
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1`,
            [id_pedido]
        );

        for (const item of itemsRes.rows) {
            await client.query(`
                INSERT INTO comprobante_interno_items (
                    id_comprobante, id_producto, descripcion,
                    cantidad, precio_unitario, descuento_porcentaje,
                    descuento_monto, subtotal
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    id_comprobante, item.id_producto, item.nombre,
                    item.cantidad, item.precio_unitario_congelado,
                    item.porcentaje_descuento || 0, 0,
                    item.total_linea
                ]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Comprobante interno creado exitosamente',
            comprobante: comprobanteRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear comprobante:', error.message);
        res.status(500).json({ error: 'Error al crear comprobante interno' });
    } finally {
        client.release();
    }
});

//                      MÓDULO DE GESTIÓN DE PRODUCTOS
// =======================================================================
// ⚠️ IMPORTANTE: Las rutas específicas (/buscar, /listar) deben ir ANTES de las rutas con parámetros (/:id)

// GET - Búsqueda de productos (debe ir ANTES de /:id)
// GET - Búsqueda de productos con lista de precios
app.get('/api/productos/buscar', verificarToken, async (req, res) => {
    const { q, id_lista_precio } = req.query;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const listaPrecios = parseInt(id_lista_precio) || 1;

    if (!q || q.trim().length < 1) {
        return res.json({ results: [] });
    }

    const query = q.trim();

    try {
        const searchQuery = `
            SELECT p.id_producto, p.sku, p.nombre, p.descripcion,
                   COALESCE(i.stock_real, 0) as stock_real,
                   COALESCE(pr.precio, 0) as precio,
                   CASE
                       WHEN pcb.codigo_barras = $2 THEN 1
                       WHEN LOWER(p.sku) = LOWER($2) THEN 2
                       ELSE 3
                   END as ranking
            FROM productos p
            LEFT JOIN productocodigosbarras pcb ON p.id_producto = pcb.id_producto
            LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
            LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_lista_precio = $4
            WHERE p.activo = TRUE
              AND (pcb.codigo_barras = $2
                   OR LOWER(p.sku) LIKE LOWER($3)
                   OR LOWER(p.nombre) LIKE LOWER($3))
            ORDER BY ranking, p.nombre
            LIMIT 20`;

        const { rows } = await pool.query(searchQuery, [id_empresa, query, `%${query}%`, listaPrecios]);
        
        console.log(`🔍 Búsqueda: "${query}" con lista ${listaPrecios} - ${rows.length} resultados`);
        
        res.json({ results: rows });
    } catch (error) {
        console.error('❌ Error en búsqueda de productos:', error.message);
        res.status(500).json({ error: 'Error al buscar productos' });
    }
});

app.get('/api/productos/listar', verificarToken, async (req, res) => {
    const id_lista_precio = parseInt(req.query.id_lista_precio) || 1;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT 
                p.id_producto, 
                p.sku, 
                p.nombre, 
                p.descripcion,
                p.id_categoria,
                c.nombre as categoria,
                COALESCE(i.stock_real, 0) as stock_real,
                (SELECT pr.precio FROM precios pr
                 WHERE pr.id_producto = p.id_producto AND pr.id_lista_precio = $2
                 LIMIT 1) as precio,
                (SELECT json_agg(json_build_object('codigo', pcb.codigo_barras))
                 FROM productocodigosbarras pcb
                 WHERE pcb.id_producto = p.id_producto) as codigos_barras,
                (SELECT json_agg(json_build_object('id_lista', pr2.id_lista_precio, 'precio', pr2.precio))
                 FROM precios pr2
                 WHERE pr2.id_producto = p.id_producto) as precios_listas
            FROM productos p
            LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
            LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
            WHERE p.activo = TRUE
            ORDER BY p.nombre`;

        const { rows } = await pool.query(query, [id_empresa, id_lista_precio]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al listar productos:', error.message);
        res.status(500).json({ error: 'Error al listar productos' });
    }
});
// GET - Listar todos los productos con stock de la empresa
// NOTA: Los productos son compartidos entre empresas, pero el stock es por empresa
app.post('/api/productos', verificarToken, async (req, res) => {
    const { sku, nombre, descripcion, precio } = req.body;

    if (!sku || !nombre) {
        return res.status(400).json({ error: 'SKU y nombre son requeridos' });
    }

    try {
        const query = `
            INSERT INTO productos (sku, nombre, descripcion, activo)
            VALUES ($1, $2, $3, TRUE)
            RETURNING *`;
        const { rows } = await pool.query(query, [sku, nombre, descripcion || null]);
        res.status(201).json({ message: 'Producto creado exitosamente', producto: rows[0] });
    } catch (error) {
        console.error('❌ Error al crear producto:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El SKU ya existe' });
        }
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// PUT - Actualizar producto
app.put('/api/productos/:id', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    const { sku, nombre, descripcion } = req.body;

    if (!sku || !nombre) {
        return res.status(400).json({ error: 'SKU y nombre son requeridos' });
    }

    try {
        const query = `
            UPDATE productos
            SET sku = $1, nombre = $2, descripcion = $3
            WHERE id_producto = $4 AND activo = TRUE
            RETURNING *`;
        const { rows } = await pool.query(query, [sku, nombre, descripcion || null, id_producto]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json({ message: 'Producto actualizado exitosamente', producto: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar producto:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El SKU ya existe' });
        }
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE - Eliminar producto (lógico)
app.delete('/api/productos/:id', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);

    try {
        const query = `
            UPDATE productos
            SET activo = FALSE
            WHERE id_producto = $1
            RETURNING *`;
        const { rows } = await pool.query(query, [id_producto]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json({ message: 'Producto eliminado exitosamente' });
    } catch (error) {
        console.error('❌ Error al eliminar producto:', error.message);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

// =======================================================================
//                      MÓDULO DE GESTIÓN DE CONFIGURACIONES
// =======================================================================

// GET - Listar todas las configuraciones
app.get('/api/configuraciones', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `
            SELECT clave, valor, descripcion, fecha_modificacion
            FROM configuraciones_empresa
            WHERE id_empresa = $1
            ORDER BY clave`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener configuraciones:', error.message);
        res.status(500).json({ error: 'Error al obtener configuraciones' });
    }
});

// GET - Obtener una configuración específica
app.get('/api/configuraciones/:clave', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { clave } = req.params;
    try {
        const query = `
            SELECT valor, descripcion
            FROM configuraciones_empresa
            WHERE id_empresa = $1 AND clave = $2`;
        const { rows } = await pool.query(query, [id_empresa, clave]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        res.json({ clave, valor: rows[0].valor, descripcion: rows[0].descripcion });
    } catch (error) {
        console.error('❌ Error al obtener configuración:', error.message);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// PUT - Actualizar una configuración (solo admin)
app.put('/api/configuraciones/:clave', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { clave } = req.params;
    const { valor } = req.body;

    // Validar que solo admin pueda modificar
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Permisos insuficientes. Solo administradores pueden modificar configuraciones.' });
    }

    if (valor === undefined || valor === null) {
        return res.status(400).json({ error: 'El valor es requerido' });
    }

    try {
        const query = `
            UPDATE configuraciones_empresa
            SET valor = $1, fecha_modificacion = now()
            WHERE id_empresa = $2 AND clave = $3
            RETURNING *`;
        const { rows } = await pool.query(query, [valor, id_empresa, clave]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Configuración no encontrada' });
        }

        res.json({
            message: 'Configuración actualizada exitosamente',
            config: rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar configuración:', error.message);
        res.status(500).json({ error: 'Error al actualizar configuración' });
    }
});

// =======================================================================
//                      BÚSQUEDAS AVANZADAS (PARA POS)
// =======================================================================

// Búsqueda de clientes por razón social, CUIT o email
app.get('/api/clientes/buscar', verificarToken, async (req, res) => {
    const { q } = req.query;
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    if (!q || q.trim().length === 0) {
        return res.json([]);
    }

    const terminos = q.trim().split(' ').filter(t => t.length > 0);
    const conditions = terminos.map((_, index) =>
        `(LOWER(c.razon_social) LIKE ${index + 2} OR LOWER(c.cuit_cuil) LIKE ${index + 2} OR LOWER(c.email) LIKE ${index + 2})`
    );

    try {
        const searchQuery = `
            SELECT c.id_cliente, c.razon_social, c.cuit_cuil, c.email, ci.nombre as condicion_iva
            FROM clientes c
            LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
            WHERE c.id_empresa = $1 AND c.activo = TRUE
              AND ${conditions.join(' AND ')}
            ORDER BY c.razon_social
            LIMIT 20`;

        const params = [id_empresa, ...terminos.map(term => `%${term.toLowerCase()}%`)];
        const { rows } = await pool.query(searchQuery, params);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error en búsqueda de clientes:', error.message);
        res.status(500).json({ error: 'Error al buscar clientes' });
    }
});

// =======================================================================
//                      MÓDULO DE PEDIDOS / PUNTO DE VENTA
// =======================================================================
// ⚠️ IMPORTANTE: Las rutas específicas (/data) deben ir ANTES de las rutas con parámetros (/:id)


// GET - Listar listas de precios
app.get('/api/listas-precios', verificarToken, async (req, res) => {
    try {
        const query = `
            SELECT id_lista_precio, nombre, descripcion, activa
            FROM listasdeprecios
            WHERE activa = TRUE
            ORDER BY id_lista_precio`;
        
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener listas de precios:', error);
        res.status(500).json({ error: 'Error al obtener listas de precios' });
    }
});

// GET - Obtener datos iniciales para el POS (debe ir ANTES de /:id)
app.get('/api/pedidos/data', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const [clientesRes, productosRes, metodosPagoRes] = await Promise.all([
            pool.query('SELECT * FROM clientes WHERE id_empresa = $1 AND activo = TRUE ORDER BY razon_social', [id_empresa]),
            pool.query('SELECT p.id_producto, p.sku, p.nombre FROM productos p WHERE p.activo = TRUE ORDER BY p.nombre'),
            pool.query('SELECT * FROM metodosdepago ORDER BY nombre')
        ]);

        res.json({
            clientes: clientesRes.rows,
            productos: productosRes.rows,
            metodosDePago: metodosPagoRes.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener datos para pedidos:', error.message);
        res.status(500).json({ error: 'Error al obtener datos iniciales' });
    }
});

// GET - Obtener historial de pedidos
app.get('/api/pedidos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT p.id_pedido, p.p.total, p.observaciones,
                   c.razon_social as cliente, c.cuit_cuil,
                   pe.nombre as estado,
                   u.username as vendedor
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_empresa = $1
            ORDER BY p.fecha_creacion DESC
            LIMIT 100`;

        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener pedidos:', error.message);
        res.status(500).json({ error: 'Error al obtener historial de pedidos' });
    }
});

// POST - Crear nuevo pedido con validación de stock configurable
app.post('/api/pedidos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_cliente, items, observaciones } = req.body;

    // Validaciones básicas
    if (!id_cliente || !items || items.length === 0) {
        return res.status(400).json({ error: 'Cliente e items son requeridos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener configuración de stock negativo
        const configRes = await client.query(
            'SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2',
            [id_empresa, 'permitir_stock_negativo']
        );
        const permitirStockNegativo = configRes.rows[0]?.valor === 'true';

        // Calcular total del pedido
        let total = 0;
        for (const item of items) {
total += parseFloat(item.precio_unitario_congelado) * item.cantidad;            

        }

        // Insertar cabecera del pedido
        const pedidoQuery = `
            INSERT INTO pedidos (id_empresa, id_cliente, id_usuario, id_estado, total, observaciones)
            VALUES ($1, $2, $3, 1, $4, $5, now())
            RETURNING id_pedido`;
        const pedidoRes = await client.query(pedidoQuery, [
            id_empresa,
            id_cliente,
            id_usuario,
            total,
            observaciones || null
        ]);
        const id_pedido = pedidoRes.rows[0].id_pedido;

        // Procesar cada item del pedido
        for (const item of items) {
            // Validar stock si está configurado para bloquearlo
            if (!permitirStockNegativo) {
                const stockRes = await client.query(
                    'SELECT stock_real FROM inventario WHERE id_empresa = $1 AND id_producto = $2',
                    [id_empresa, item.id_producto]
                );
                const stockActual = stockRes.rows[0]?.stock_real || 0;

                if (stockActual < item.cantidad) {
                    // Obtener nombre del producto para mensaje de error
                    const prodRes = await client.query(
                        'SELECT nombre FROM productos WHERE id_producto = $1',
                        [item.id_producto]
                    );
                    const nombreProducto = prodRes.rows[0]?.nombre || 'Desconocido';

                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: `Stock insuficiente para "${nombreProducto}". Disponible: ${stockActual}, Solicitado: ${item.cantidad}`
                    });
                }
            }

            // Insertar item del pedido
// Insertar item del pedido
            
const subtotal = parseFloat(item.precio_unitario_congelado) * item.cantidad;

            const montoIva = subtotal * 0.21;
            const totalLinea = subtotal + montoIva;
            
            const itemQuery = `
                INSERT INTO pedidoitems (
                    id_pedido, id_producto, cantidad, precio_unitario_congelado,
                    porcentaje_descuento, iva_aplicado, monto_iva, total_linea
                ) VALUES ($1, $2, $3, $4, $5, 21.00, $6, $7)`;
            
            await client.query(itemQuery, [
                id_pedido,
                item.id_producto,
                item.cantidad,
            
    parseFloat(item.precio_unitario_congelado),
                0, // porcentaje_descuento
                montoIva,
                totalLinea
            ]);
            // Descontar del inventario
const updateStockQuery = `
    INSERT INTO inventario (id_empresa, id_producto, stock_real)
    VALUES ($1, $2, $3)
    ON CONFLICT (id_empresa, id_producto)
    DO UPDATE SET stock_real = inventario.stock_real - $4`;
await client.query(updateStockQuery, [
    id_empresa, 
    item.id_producto, 
    -parseFloat(item.cantidad),  // Negativo para INSERT
    parseFloat(item.cantidad)     // Positivo para restar en UPDATE
]);            


        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Pedido creado exitosamente',
            id_pedido,
            total
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear pedido:', error.message);
        res.status(500).json({ error: 'Error al crear pedido' });
    } finally {
        client.release();
    }
});

// =======================================================================
//                      MÓDULO DE REPORTES Y ESTADÍSTICAS
// =======================================================================

// GET - Dashboard principal con KPIs
app.get('/api/reportes/dashboard', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        // Fechas por defecto: último mes
        const fechaDesde = fecha_desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const fechaHasta = fecha_hasta || new Date().toISOString();

        // Consultas en paralelo para mejor performance
        const [
            ventasHoyRes,
            ventasMesRes,
            ventasPeriodoRes,
            clientesTotalRes,
            productosStockBajoRes,
            topProductosRes,
            ventasPorDiaRes
        ] = await Promise.all([
            // Ventas de hoy
            pool.query(`
                SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as total_ventas
                FROM pedidos
                WHERE id_empresa = $1 AND DATE(fecha_creacion) = CURRENT_DATE
            `, [id_empresa]),

            // Ventas del mes actual
            pool.query(`
                SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as total_ventas
                FROM pedidos
                WHERE id_empresa = $1 
                AND DATE_TRUNC('month', fecha_creacion) = DATE_TRUNC('month', CURRENT_DATE)
            `, [id_empresa]),

            // Ventas del período seleccionado
            pool.query(`
                SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as total_ventas
                FROM pedidos
                WHERE id_empresa = $1 
                AND fecha_creacion BETWEEN $2 AND $3
            `, [id_empresa, fechaDesde, fechaHasta]),

            // Total de clientes activos
            pool.query(`
                SELECT COUNT(*) as total_clientes
                FROM clientes
                WHERE id_empresa = $1 AND activo = TRUE
            `, [id_empresa]),

            // Productos con stock bajo
            pool.query(`
                SELECT COUNT(*) as productos_stock_bajo
                FROM inventario i
                WHERE i.id_empresa = $1 AND i.stock_real < i.stock_minimo AND i.stock_minimo > 0
            `, [id_empresa]),

            // Top 10 productos más vendidos
            pool.query(`
                SELECT p.nombre, p.sku,
                       SUM(pi.cantidad) as cantidad_vendida,
                       SUM(pi.total_linea) as total_vendido
                FROM pedidoitems pi
                JOIN pedidos ped ON pi.id_pedido = ped.id_pedido
                JOIN productos p ON pi.id_producto = p.id_producto
                WHERE ped.id_empresa = $1
                AND ped.fecha_creacion BETWEEN $2 AND $3
                GROUP BY p.id_producto, p.nombre, p.sku
                ORDER BY cantidad_vendida DESC
                LIMIT 10
            `, [id_empresa, fechaDesde, fechaHasta]),

            // Ventas por día (últimos 30 días)
            pool.query(`
                SELECT DATE(fecha_creacion) as fecha,
                       COUNT(*) as cantidad_pedidos,
                       COALESCE(SUM(total), 0) as total_ventas
                FROM pedidos
                WHERE id_empresa = $1
                AND fecha_creacion >= CURRENT_DATE - INTERVAL '30 days'
                GROUP BY DATE(fecha_creacion)
                ORDER BY fecha DESC
            `, [id_empresa])
        ]);

        res.json({
            hoy: {
                pedidos: parseInt(ventasHoyRes.rows[0].total_pedidos),
                ventas: parseFloat(ventasHoyRes.rows[0].total_ventas)
            },
            mes: {
                pedidos: parseInt(ventasMesRes.rows[0].total_pedidos),
                ventas: parseFloat(ventasMesRes.rows[0].total_ventas)
            },
            periodo: {
                pedidos: parseInt(ventasPeriodoRes.rows[0].total_pedidos),
                ventas: parseFloat(ventasPeriodoRes.rows[0].total_ventas),
                fecha_desde: fechaDesde,
                fecha_hasta: fechaHasta
            },
            clientes_activos: parseInt(clientesTotalRes.rows[0].total_clientes),
            productos_stock_bajo: parseInt(productosStockBajoRes.rows[0].productos_stock_bajo),
            top_productos: topProductosRes.rows,
            ventas_por_dia: ventasPorDiaRes.rows
        });
    } catch (error) {
        console.error('❌ Error al obtener dashboard:', error.message);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// GET - Reporte de ventas por vendedor
app.get('/api/reportes/ventas-por-vendedor', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        const fechaDesde = fecha_desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const fechaHasta = fecha_hasta || new Date().toISOString();

        const query = `
            SELECT u.username as vendedor,
                   COUNT(p.id_pedido) as total_pedidos,
                   COALESCE(SUM(p.total), 0) as total_ventas,
                   COALESCE(AVG(p.total), 0) as ticket_promedio
            FROM pedidos p
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_empresa = $1
            AND p.fecha_creacion BETWEEN $2 AND $3
            GROUP BY u.id_usuario, u.username
            ORDER BY total_ventas DESC`;

        const { rows } = await pool.query(query, [id_empresa, fechaDesde, fechaHasta]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener ventas por vendedor:', error.message);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

// GET - Reporte de stock bajo mínimo
app.get('/api/reportes/stock-bajo', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT p.id_producto, p.sku, p.nombre,
                   i.stock_real, i.stock_minimo,
                   (i.stock_minimo - i.stock_real) as faltante
            FROM inventario i
            JOIN productos p ON i.id_producto = p.id_producto
            WHERE i.id_empresa = $1
            AND i.stock_real < i.stock_minimo
            AND i.stock_minimo > 0
            ORDER BY faltante DESC`;

        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener stock bajo:', error.message);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

// GET - Reporte detallado de ventas (para exportar)
app.get('/api/reportes/ventas-detallado', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        const fechaDesde = fecha_desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const fechaHasta = fecha_hasta || new Date().toISOString();

        const query = `
            SELECT p.id_pedido,
                   p.fecha_creacion,
                   c.razon_social as cliente,
                   u.username as vendedor,
                   pe.nombre as estado,
                   p.total,
                   p.observaciones
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            WHERE p.id_empresa = $1
            AND p.fecha_creacion BETWEEN $2 AND $3
            ORDER BY p.fecha_creacion DESC`;

        const { rows } = await pool.query(query, [id_empresa, fechaDesde, fechaHasta]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener ventas detalladas:', error.message);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

// GET - Análisis de rentabilidad por producto
app.get('/api/reportes/rentabilidad-productos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        const fechaDesde = fecha_desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const fechaHasta = fecha_hasta || new Date().toISOString();

        const query = `
            SELECT p.nombre, p.sku,
                   SUM(pi.cantidad) as unidades_vendidas,
                   SUM(pi.total_linea) as total_vendido,
                   AVG(pi.precio_unitario_congelado) as precio_promedio
            FROM pedidoitems pi
            JOIN pedidos ped ON pi.id_pedido = ped.id_pedido
            JOIN productos p ON pi.id_producto = p.id_producto
            WHERE ped.id_empresa = $1
            AND ped.fecha_creacion BETWEEN $2 AND $3
            GROUP BY p.id_producto, p.nombre, p.sku
            HAVING SUM(pi.cantidad) > 0
            ORDER BY total_vendido DESC`;

        const { rows } = await pool.query(query, [id_empresa, fechaDesde, fechaHasta]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener rentabilidad:', error.message);
        res.status(500).json({ error: 'Error al obtener reporte' });
    }
});

//=======================================================================
// MÓDULO DE FACTURACIÓN
//=======================================================================

// GET - Obtener tipos de factura disponibles
app.get('/api/facturas/tipos', verificarToken, async (req, res) => {
  try {
    const query = `
      SELECT id_tipo_factura, codigo, nombre, discrimina_iva, requiere_cuit, descripcion
      FROM factura_tipos
      ORDER BY codigo`;
    
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener tipos de factura:', error.message);
    res.status(500).json({ error: 'Error al obtener tipos de factura' });
  }
});

// GET - Obtener próximo número de factura
app.get('/api/facturas/proximo-numero/:punto_venta/:id_tipo_factura', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const punto_venta = parseInt(req.params.punto_venta, 10);
  const id_tipo_factura = parseInt(req.params.id_tipo_factura, 10);

  try {
    const query = `
      SELECT COALESCE(MAX(numero_factura), 0) + 1 as proximo_numero
      FROM facturas
      WHERE id_empresa = $1 
        AND punto_venta = $2 
        AND id_tipo_factura = $3`;
    
    const { rows } = await pool.query(query, [id_empresa, punto_venta, id_tipo_factura]);
    res.json({ proximo_numero: parseInt(rows[0].proximo_numero) });
  } catch (error) {
    console.error('❌ Error al obtener próximo número:', error.message);
    res.status(500).json({ error: 'Error al obtener próximo número' });
  }
});

// POST - Crear factura desde pedido
app.post('/api/facturas', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const { 
    id_pedido, 
    id_cliente, 
    id_tipo_factura, 
    punto_venta = 1,
    fecha_vencimiento,
    observaciones 
  } = req.body;

  if (!id_cliente || !id_tipo_factura) {
    return res.status(400).json({ error: 'Cliente y tipo de factura son requeridos' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Obtener próximo número
    const numeroRes = await client.query(`
      SELECT COALESCE(MAX(numero_factura), 0) + 1 as proximo_numero
      FROM facturas
      WHERE id_empresa = $1 AND punto_venta = $2 AND id_tipo_factura = $3`,
      [id_empresa, punto_venta, id_tipo_factura]
    );
    const numero_factura = parseInt(numeroRes.rows[0].proximo_numero);

    // Obtener items del pedido (o usar items enviados)
    let items = [];
    let subtotal = 0;
    let total_iva = 0;

    if (id_pedido) {
      // Si viene de un pedido, obtener los items
      const itemsRes = await client.query(`
        SELECT 
          pi.id_producto,
          p.nombre as descripcion,
          pi.cantidad,
          pi.precio_unitario_congelado as precio_unitario,
          pi.iva_aplicado as porcentaje_iva,
          pi.monto_iva,
          pi.total_linea as subtotal,
          pi.total_linea as total
        FROM pedidoitems pi
        JOIN productos p ON pi.id_producto = p.id_producto
        WHERE pi.id_pedido = $1`,
        [id_pedido]
      );
      items = itemsRes.rows;
    } else {
      // Si no viene de pedido, deben enviar los items en el body
      items = req.body.items || [];
    }

    if (items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay items para facturar' });
    }

    // Calcular totales
    items.forEach(item => {
      const subtotal_linea = parseFloat(item.precio_unitario) * parseFloat(item.cantidad);
      const iva_linea = subtotal_linea * (parseFloat(item.porcentaje_iva || 21) / 100);
      
      subtotal += subtotal_linea;
      total_iva += iva_linea;
    });

    const total = subtotal + total_iva;

    // Crear la factura
    const facturaQuery = `
      INSERT INTO facturas (
        id_empresa, id_pedido, id_cliente, id_tipo_factura,
        punto_venta, numero_factura, fecha_emision, fecha_vencimiento,
        subtotal, total_iva, total, estado, observaciones
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7, $8, $9, $10, 'emitida', $11)
      RETURNING id_factura, numero_completo`;

    const facturaRes = await client.query(facturaQuery, [
      id_empresa,
      id_pedido || null,
      id_cliente,
      id_tipo_factura,
      punto_venta,
      numero_factura,
      fecha_vencimiento || null,
      subtotal,
      total_iva,
      total,
      observaciones || null
    ]);

    const id_factura = facturaRes.rows[0].id_factura;
    const numero_completo = facturaRes.rows[0].numero_completo;

    // Insertar items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const subtotal_linea = parseFloat(item.precio_unitario) * parseFloat(item.cantidad);
      const iva_linea = subtotal_linea * (parseFloat(item.porcentaje_iva || 21) / 100);
      const total_linea = subtotal_linea + iva_linea;

      await client.query(`
        INSERT INTO factura_items (
          id_factura, id_producto, cantidad, descripcion,
          precio_unitario, porcentaje_iva, subtotal, iva_calculado, total
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id_factura,
          item.id_producto,
          item.cantidad,
          item.descripcion,
          item.precio_unitario,
          item.porcentaje_iva || 21,
          subtotal_linea,
          iva_linea,
          total_linea
        ]
      );
    }

    // Si viene de un pedido, actualizarlo a estado "Facturado"
    if (id_pedido) {
      await client.query(`
        UPDATE pedidos 
        SET id_estado = (SELECT id_estado FROM pedidoestados WHERE nombre = 'Facturado')
        WHERE id_pedido = $1`,
        [id_pedido]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Factura creada exitosamente',
      id_factura,
      numero_completo,
      total
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al crear factura:', error.message);
    res.status(500).json({ error: 'Error al crear factura: ' + error.message });
  } finally {
    client.release();
  }
});

// GET - Listar facturas
app.get('/api/facturas', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const { fecha_desde, fecha_hasta, estado } = req.query;

  try {
    let query = `
      SELECT 
        f.id_factura,
        f.numero_completo,
        f.fecha_emision,
        f.fecha_vencimiento,
        f.subtotal,
        f.total_iva,
        f.total,
        f.estado,
        f.cae,
        c.razon_social as cliente,
        c.cuit_cuil,
        ft.codigo as tipo_factura,
        ft.nombre as tipo_factura_nombre
      FROM facturas f
      JOIN clientes c ON f.id_cliente = c.id_cliente
      JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
      WHERE f.id_empresa = $1`;

    const params = [id_empresa];
    let paramIndex = 2;

    if (fecha_desde) {
      query += ` AND f.fecha_emision >= $${paramIndex}`;
      params.push(fecha_desde);
      paramIndex++;
    }

    if (fecha_hasta) {
      query += ` AND f.fecha_emision <= $${paramIndex}`;
      params.push(fecha_hasta);
      paramIndex++;
    }

    if (estado) {
      query += ` AND f.estado = $${paramIndex}`;
      params.push(estado);
      paramIndex++;
    }

    query += ` ORDER BY f.fecha_emision DESC, f.id_factura DESC LIMIT 100`;

    const { rows } = await pool.query(query, params);
    res.json(rows);

  } catch (error) {
    console.error('❌ Error al listar facturas:', error.message);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

// GET - Obtener detalle de una factura
app.get('/api/facturas/:id', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const id_factura = parseInt(req.params.id, 10);

  try {
    // Obtener datos de la factura
    const facturaQuery = `
      SELECT 
        f.*,
        c.razon_social as cliente,
        c.cuit_cuil,
        c.domicilio,
        c.email,
        ci.nombre as condicion_iva_cliente,
        ft.codigo as tipo_factura,
        ft.nombre as tipo_factura_nombre,
        ft.discrimina_iva,
        e.nombre as empresa_nombre,
        e.cuit as empresa_cuit,
        e.direccion as empresa_direccion
      FROM facturas f
      JOIN clientes c ON f.id_cliente = c.id_cliente
      LEFT JOIN condicionesiva ci ON c.id_condicion_iva = ci.id_condicion_iva
      JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
      JOIN empresas e ON f.id_empresa = e.id_empresa
      WHERE f.id_factura = $1 AND f.id_empresa = $2`;

    const facturaRes = await pool.query(facturaQuery, [id_factura, id_empresa]);

    if (facturaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    const factura = facturaRes.rows[0];

    // Obtener items
    const itemsQuery = `
      SELECT 
        fi.*,
        p.nombre as producto_nombre,
        p.sku
      FROM factura_items fi
      JOIN productos p ON fi.id_producto = p.id_producto
      WHERE fi.id_factura = $1
      ORDER BY fi.id_producto`;

    const itemsRes = await pool.query(itemsQuery, [id_factura]);

    res.json({
      ...factura,
      items: itemsRes.rows
    });

  } catch (error) {
    console.error('❌ Error al obtener factura:', error.message);
    res.status(500).json({ error: 'Error al obtener factura' });
  }
});

// DELETE - Anular factura (lógico)
app.delete('/api/facturas/:id', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const id_factura = parseInt(req.params.id, 10);

  if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Solo administradores pueden anular facturas' });
  }

  try {
    const query = `
      UPDATE facturas
      SET estado = 'anulada'
      WHERE id_factura = $1 AND id_empresa = $2
      RETURNING numero_completo`;

    const { rows } = await pool.query(query, [id_factura, id_empresa]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    res.json({ 
      message: 'Factura anulada exitosamente',
      numero_completo: rows[0].numero_completo
    });

  } catch (error) {
    console.error('❌ Error al anular factura:', error.message);
    res.status(500).json({ error: 'Error al anular factura' });
  }
});
//=======================================================================
// MÓDULO DE CAJAS Y COBROS
//=======================================================================

// ============ MONEDAS Y COTIZACIONES ============

// GET - Listar monedas activas
app.get('/api/monedas', verificarToken, async (req, res) => {
  try {
    const query = `SELECT * FROM monedas WHERE activo = TRUE ORDER BY codigo`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener monedas:', error.message);
    res.status(500).json({ error: 'Error al obtener monedas' });
  }
});

// GET - Obtener cotización actual de una moneda
app.get('/api/cotizaciones/actual/:id_moneda', verificarToken, async (req, res) => {
  const id_moneda = parseInt(req.params.id_moneda, 10);
  
  try {
    const query = `
      SELECT c.*, m.codigo, m.nombre, m.simbolo
      FROM cotizaciones c
      JOIN monedas m ON c.id_moneda = m.id_moneda
      WHERE c.id_moneda = $1
      ORDER BY c.fecha_cotizacion DESC, c.hora_cotizacion DESC
      LIMIT 1`;
    
    const { rows } = await pool.query(query, [id_moneda]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No hay cotización disponible para esta moneda' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    console.error('❌ Error al obtener cotización:', error.message);
    res.status(500).json({ error: 'Error al obtener cotización' });
  }
});

// POST - Crear/actualizar cotización manual
app.post('/api/cotizaciones', verificarToken, async (req, res) => {
  const { id_moneda, cotizacion_compra, cotizacion_venta } = req.body;
  
  if (!id_moneda || !cotizacion_compra || !cotizacion_venta) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }
  
  try {
    const query = `
      INSERT INTO cotizaciones (id_moneda, cotizacion_compra, cotizacion_venta, tipo, fuente)
      VALUES ($1, $2, $3, 'manual', 'Ingreso Manual')
      RETURNING *`;
    
    const { rows } = await pool.query(query, [id_moneda, cotizacion_compra, cotizacion_venta]);
    res.status(201).json({ message: 'Cotización actualizada', cotizacion: rows[0] });
  } catch (error) {
    console.error('❌ Error al actualizar cotización:', error.message);
    res.status(500).json({ error: 'Error al actualizar cotización' });
  }
});

// ============ TARJETAS ============

// GET - Listar tarjetas de la empresa
app.get('/api/tarjetas', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  
  try {
    const query = `
      SELECT * FROM tarjetas
      WHERE id_empresa = $1 AND activo = TRUE
      ORDER BY nombre`;
    
    const { rows } = await pool.query(query, [id_empresa]);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener tarjetas:', error.message);
    res.status(500).json({ error: 'Error al obtener tarjetas' });
  }
});

// POST - Crear tarjeta
app.post('/api/tarjetas', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const { nombre, tipo, interes_1_cuota, interes_3_cuotas, interes_6_cuotas, interes_12_cuotas } = req.body;
  
  if (!nombre || !tipo) {
    return res.status(400).json({ error: 'Nombre y tipo son requeridos' });
  }
  
  try {
    const query = `
      INSERT INTO tarjetas (id_empresa, nombre, tipo, interes_1_cuota, interes_3_cuotas, interes_6_cuotas, interes_12_cuotas)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`;
    
    const { rows } = await pool.query(query, [
      id_empresa, nombre, tipo,
      interes_1_cuota || 0,
      interes_3_cuotas || 0,
      interes_6_cuotas || 0,
      interes_12_cuotas || 0
    ]);
    
    res.status(201).json({ message: 'Tarjeta creada', tarjeta: rows[0] });
  } catch (error) {
    console.error('❌ Error al crear tarjeta:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una tarjeta con ese nombre' });
    }
    res.status(500).json({ error: 'Error al crear tarjeta' });
  }
});

// PUT - Actualizar tarjeta
app.put('/api/tarjetas/:id', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const id_tarjeta = parseInt(req.params.id, 10);
  const { nombre, tipo, interes_1_cuota, interes_3_cuotas, interes_6_cuotas, interes_12_cuotas } = req.body;
  
  try {
    const query = `
      UPDATE tarjetas
      SET nombre = $1, tipo = $2, interes_1_cuota = $3, interes_3_cuotas = $4,
          interes_6_cuotas = $5, interes_12_cuotas = $6
      WHERE id_tarjeta = $7 AND id_empresa = $8
      RETURNING *`;
    
    const { rows } = await pool.query(query, [
      nombre, tipo, interes_1_cuota, interes_3_cuotas, interes_6_cuotas, interes_12_cuotas,
      id_tarjeta, id_empresa
    ]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }
    
    res.json({ message: 'Tarjeta actualizada', tarjeta: rows[0] });
  } catch (error) {
    console.error('❌ Error al actualizar tarjeta:', error.message);
    res.status(500).json({ error: 'Error al actualizar tarjeta' });
  }
});

// ============ BANCOS ============

// GET - Listar bancos
app.get('/api/bancos', verificarToken, async (req, res) => {
  try {
    const query = `SELECT * FROM bancos WHERE activo = TRUE ORDER BY nombre`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener bancos:', error.message);
    res.status(500).json({ error: 'Error al obtener bancos' });
  }
});

// ============ FORMAS DE PAGO ============

// GET - Listar formas de pago
app.get('/api/formas-pago', verificarToken, async (req, res) => {
  try {
    const query = `SELECT * FROM formas_pago WHERE activo = TRUE ORDER BY nombre`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener formas de pago:', error.message);
    res.status(500).json({ error: 'Error al obtener formas de pago' });
  }
});

// ============ CAJAS Y TURNOS ============

// GET - Listar cajas de la empresa
app.get('/api/cajas', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  
  try {
    const query = `SELECT * FROM cajas WHERE id_empresa = $1 AND activo = TRUE ORDER BY nombre`;
    const { rows } = await pool.query(query, [id_empresa]);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error al obtener cajas:', error.message);
    res.status(500).json({ error: 'Error al obtener cajas' });
  }
});

// GET - Obtener turno actual de una caja
app.get('/api/cajas/turno-actual/:id_caja', verificarToken, async (req, res) => {
  const id_caja = parseInt(req.params.id_caja, 10);
  
  try {
    const query = `
      SELECT t.*, c.nombre as nombre_caja, u.username as usuario_apertura
      FROM turnos_caja t
      JOIN cajas c ON t.id_caja = c.id_caja
      JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario
      WHERE t.id_caja = $1 AND t.estado = 'abierto'
      ORDER BY t.fecha_apertura DESC
      LIMIT 1`;
    
    const { rows } = await pool.query(query, [id_caja]);
    
    if (rows.length === 0) {
      return res.json({ turno_abierto: false });
    }
    
    res.json({ turno_abierto: true, turno: rows[0] });
  } catch (error) {
    console.error('❌ Error al obtener turno actual:', error.message);
    res.status(500).json({ error: 'Error al obtener turno actual' });
  }
});

// POST - Abrir caja (iniciar turno)
app.post('/api/cajas/abrir', verificarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { id_caja, monto_inicial_ars, monto_inicial_usd } = req.body;
  
  if (!id_caja) {
    return res.status(400).json({ error: 'ID de caja requerido' });
  }
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Verificar que no haya un turno abierto
    const checkQuery = `
      SELECT id_turno FROM turnos_caja
      WHERE id_caja = $1 AND estado = 'abierto'`;
    
    const checkRes = await client.query(checkQuery, [id_caja]);
    
    if (checkRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un turno abierto para esta caja' });
    }
    
    // Crear nuevo turno
    const insertQuery = `
      INSERT INTO turnos_caja (id_caja, id_usuario_apertura, monto_inicial_ars, monto_inicial_usd)
      VALUES ($1, $2, $3, $4)
      RETURNING *`;
    
    const { rows } = await client.query(insertQuery, [
      id_caja,
      id_usuario,
      monto_inicial_ars || 0,
      monto_inicial_usd || 0
    ]);
    
    await client.query('COMMIT');
    
    res.status(201).json({
      message: 'Caja abierta exitosamente',
      turno: rows[0]
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al abrir caja:', error.message);
    res.status(500).json({ error: 'Error al abrir caja' });
  } finally {
    client.release();
  }
});

// POST - Cerrar caja (finalizar turno con arqueo)
app.post('/api/cajas/cerrar', verificarToken, async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const { id_turno, arqueo_efectivo_ars, arqueo_efectivo_usd, observaciones } = req.body;
  
  if (!id_turno) {
    return res.status(400).json({ error: 'ID de turno requerido' });
  }
  
  try {
    const query = `
      UPDATE turnos_caja
      SET fecha_cierre = now(),
          id_usuario_cierre = $1,
          arqueo_efectivo_ars = $2,
          arqueo_efectivo_usd = $3,
          observaciones = $4,
          estado = 'cerrado'
      WHERE id_turno = $5 AND estado = 'abierto'
      RETURNING *`;
    
    const { rows } = await pool.query(query, [
      id_usuario,
      arqueo_efectivo_ars || 0,
      arqueo_efectivo_usd || 0,
      observaciones || null,
      id_turno
    ]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado o ya cerrado' });
    }
    
    res.json({
      message: 'Caja cerrada exitosamente',
      turno: rows[0],
      diferencia_ars: rows[0].diferencia_ars,
      diferencia_usd: rows[0].diferencia_usd
    });
    
  } catch (error) {
    console.error('❌ Error al cerrar caja:', error.message);
    res.status(500).json({ error: 'Error al cerrar caja' });
  }
});


// ============ RECIBOS (COBROS CON MÚLTIPLES FORMAS DE PAGO) ============

// POST - Crear recibo con múltiples formas de pago
app.post('/api/recibos', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const id_usuario = req.usuario.id_usuario;
  const { 
    id_turno, 
    id_cliente, 
    id_factura, 
    id_pedido,
    total_recibo, 
    id_moneda_recibo = 1,
    concepto,
    observaciones,
    items
  } = req.body;

  if (!id_turno || !total_recibo || !items || items.length === 0) {
    return res.status(400).json({ error: 'Turno, total e items son requeridos' });
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const turnoCheck = await client.query(
      'SELECT estado FROM turnos_caja WHERE id_turno = $1',
      [id_turno]
    );

    if (turnoCheck.rows.length === 0 || turnoCheck.rows[0].estado !== 'abierto') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'El turno no está abierto' });
    }

    const numeroRes = await client.query(`
      SELECT COALESCE(MAX(numero_recibo), 0) + 1 as proximo_numero
      FROM recibos WHERE id_empresa = $1`,
      [id_empresa]
    );
    const numero_recibo = parseInt(numeroRes.rows[0].proximo_numero);

    const reciboQuery = `
      INSERT INTO recibos (
        id_empresa, id_turno, id_cliente, id_factura, id_pedido, id_usuario,
        numero_recibo, total_recibo, id_moneda_recibo, concepto, observaciones
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id_recibo, numero_completo`;

    const reciboRes = await client.query(reciboQuery, [
      id_empresa, id_turno, id_cliente || null, id_factura || null, 
      id_pedido || null, id_usuario, numero_recibo, total_recibo,
      id_moneda_recibo, concepto || null, observaciones || null
    ]);

    const id_recibo = reciboRes.rows[0].id_recibo;
    const numero_completo = reciboRes.rows[0].numero_completo;

    let total_efectivo_ars = 0;
    let total_efectivo_usd = 0;

    for (const item of items) {
      const {
        id_forma_pago,
        id_moneda,
        monto_original,
        id_tarjeta = null,
        cuotas = 1,
        id_banco = null,
        numero_referencia = null,
        fecha_acreditacion = null,
        observaciones_item = null
      } = item;

      let cotizacion_usada = 1;
      if (id_moneda !== id_moneda_recibo) {
        const cotizRes = await client.query(`
          SELECT cotizacion_venta FROM cotizaciones
          WHERE id_moneda = $1
          ORDER BY fecha_cotizacion DESC, hora_cotizacion DESC
          LIMIT 1`,
          [id_moneda]
        );
        
        if (cotizRes.rows.length > 0) {
          cotizacion_usada = parseFloat(cotizRes.rows[0].cotizacion_venta);
        }
      }

      const monto_convertido = parseFloat(monto_original) * cotizacion_usada;

      let interes_aplicado = 0;
      let monto_interes = 0;
      let monto_con_interes = monto_convertido;

      if (id_tarjeta && cuotas > 1) {
        const tarjetaRes = await client.query(
          `SELECT interes_1_cuota, interes_3_cuotas, interes_6_cuotas, interes_12_cuotas 
           FROM tarjetas WHERE id_tarjeta = $1`,
          [id_tarjeta]
        );

        if (tarjetaRes.rows.length > 0) {
          const tarjeta = tarjetaRes.rows[0];
          
          if (cuotas === 1) interes_aplicado = parseFloat(tarjeta.interes_1_cuota);
          else if (cuotas <= 3) interes_aplicado = parseFloat(tarjeta.interes_3_cuotas);
          else if (cuotas <= 6) interes_aplicado = parseFloat(tarjeta.interes_6_cuotas);
          else interes_aplicado = parseFloat(tarjeta.interes_12_cuotas);

          monto_interes = monto_convertido * (interes_aplicado / 100);
          monto_con_interes = monto_convertido + monto_interes;
        }
      }

      await client.query(`
        INSERT INTO recibo_items (
          id_recibo, id_forma_pago, id_moneda, monto_original, 
          cotizacion_usada, monto_convertido, id_tarjeta, cuotas,
          interes_aplicado, monto_interes, monto_con_interes,
          id_banco, numero_referencia, fecha_acreditacion, observaciones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          id_recibo, id_forma_pago, id_moneda, monto_original,
          cotizacion_usada, monto_convertido, id_tarjeta, cuotas,
          interes_aplicado, monto_interes, monto_con_interes,
          id_banco, numero_referencia, fecha_acreditacion, observaciones_item
        ]
      );

      const formaRes = await client.query(
        'SELECT tipo FROM formas_pago WHERE id_forma_pago = $1',
        [id_forma_pago]
      );

      if (formaRes.rows[0].tipo === 'efectivo') {
        if (id_moneda === 1) {
          total_efectivo_ars += parseFloat(monto_original);
        } else if (id_moneda === 2) {
          total_efectivo_usd += parseFloat(monto_original);
        }
      }

      await client.query(`
        INSERT INTO movimientos_caja (id_turno, id_usuario, id_recibo, tipo, id_moneda, monto, concepto)
        VALUES ($1, $2, $3, 'ingreso', $4, $5, $6)`,
        [id_turno, id_usuario, id_recibo, id_moneda, monto_original, 
         concepto || `Cobro Recibo ${numero_completo}`]
      );
    }

    if (total_efectivo_ars > 0 || total_efectivo_usd > 0) {
      await client.query(`
        UPDATE turnos_caja
        SET ingresos_efectivo_ars = ingresos_efectivo_ars + $1,
            ingresos_efectivo_usd = ingresos_efectivo_usd + $2
        WHERE id_turno = $3`,
        [total_efectivo_ars, total_efectivo_usd, id_turno]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Recibo creado exitosamente',
      id_recibo,
      numero_completo,
      total_recibo
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al crear recibo:', error.message);
    res.status(500).json({ error: 'Error al crear recibo: ' + error.message });
  } finally {
    client.release();
  }
});

// GET - Listar recibos
app.get('/api/recibos', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const { fecha_desde, fecha_hasta, id_turno } = req.query;

  try {
    let query = `
      SELECT 
        r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo, r.concepto,
        c.razon_social as cliente, u.username as usuario,
        m.codigo as moneda, m.simbolo as simbolo_moneda
      FROM recibos r
      LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
      JOIN usuarios u ON r.id_usuario = u.id_usuario
      JOIN monedas m ON r.id_moneda_recibo = m.id_moneda
      WHERE r.id_empresa = $1`;

    const params = [id_empresa];
    let paramIndex = 2;

    if (id_turno) {
      query += ` AND r.id_turno = $${paramIndex}`;
      params.push(id_turno);
      paramIndex++;
    }

    query += ` ORDER BY r.fecha_recibo DESC LIMIT 100`;

    const { rows } = await pool.query(query, params);
    res.json(rows);

  } catch (error) {
    console.error('❌ Error al listar recibos:', error.message);
    res.status(500).json({ error: 'Error al listar recibos' });
  }
});

// GET - Detalle de un recibo
app.get('/api/recibos/:id', verificarToken, async (req, res) => {
  const id_empresa = parseInt(req.usuario.id_empresa, 10);
  const id_recibo = parseInt(req.params.id, 10);

  try {
    const reciboQuery = `
      SELECT r.*, c.razon_social as cliente, u.username as usuario,
             m.codigo as moneda, m.simbolo as simbolo_moneda
      FROM recibos r
      LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
      JOIN usuarios u ON r.id_usuario = u.id_usuario
      JOIN monedas m ON r.id_moneda_recibo = m.id_moneda
      WHERE r.id_recibo = $1 AND r.id_empresa = $2`;

    const reciboRes = await pool.query(reciboQuery, [id_recibo, id_empresa]);

    if (reciboRes.rows.length === 0) {
      return res.status(404).json({ error: 'Recibo no encontrado' });
    }

    const itemsQuery = `
      SELECT ri.*, fp.nombre as forma_pago, m.codigo as moneda,
             t.nombre as tarjeta, b.nombre as banco
      FROM recibo_items ri
      JOIN formas_pago fp ON ri.id_forma_pago = fp.id_forma_pago
      JOIN monedas m ON ri.id_moneda = m.id_moneda
      LEFT JOIN tarjetas t ON ri.id_tarjeta = t.id_tarjeta
      LEFT JOIN bancos b ON ri.id_banco = b.id_banco
      WHERE ri.id_recibo = $1`;

    const itemsRes = await pool.query(itemsQuery, [id_recibo]);

    res.json({
      ...reciboRes.rows[0],
      items: itemsRes.rows
    });

  } catch (error) {
    console.error('❌ Error al obtener recibo:', error.message);
    res.status(500).json({ error: 'Error al obtener recibo' });
  }
});

// =======================================================================
//                    MÓDULO DE COMPRAS - ÓRDENES
// =======================================================================

// GET - Listar órdenes de compra
app.get('/api/compras/ordenes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { estado, id_proveedor } = req.query;

    try {
        let query = `
            SELECT o.*, p.razon_social as proveedor, u.username as usuario
            FROM ordenes_compra o
            JOIN proveedores p ON o.id_proveedor = p.id_proveedor
            JOIN usuarios u ON o.id_usuario = u.id_usuario
            WHERE o.id_empresa = $1`;

        const params = [id_empresa];
        let paramIndex = 2;

        if (estado) {
            query += ` AND o.estado = $${paramIndex}`;
            params.push(estado);
            paramIndex++;
        }

        if (id_proveedor) {
            query += ` AND o.id_proveedor = $${paramIndex}`;
            params.push(id_proveedor);
            paramIndex++;
        }

        query += ` ORDER BY o.fecha_orden DESC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
console.error('❌ Error al obtener órdenes:', error.message);
        res.status(500).json({ error: 'Error al obtener órdenes de compra' });
    }
});


// POST - Crear orden de compra

app.post('/api/compras/ordenes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_proveedor, fecha_entrega_estimada, items, observaciones } = req.body;

    if (!id_proveedor || !items || items.length === 0) {
        return res.status(400).json({ error: 'Proveedor e items son requeridos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener próximo número
        const numeroRes = await client.query(`
            SELECT COALESCE(MAX(numero_orden), 0) + 1 as proximo
            FROM ordenes_compra WHERE id_empresa = $1`,
            [id_empresa]
        );
        const numero_orden = parseInt(numeroRes.rows[0].proximo, 10);

        let subtotal = 0;
        let iva_total = 0;

        // Calcular totales
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad_pedida);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            
            subtotal += subtotal_item;
            iva_total += iva_item;
        }

        const total = subtotal + iva_total;

        // Crear orden
        const ordenQuery = `
            INSERT INTO ordenes_compra (
                id_empresa, id_proveedor, id_usuario, numero_orden,
                fecha_entrega_estimada, subtotal, iva, total, observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *`;
        
        const ordenRes = await client.query(ordenQuery, [
            id_empresa, id_proveedor, id_usuario, numero_orden,
            fecha_entrega_estimada || null, subtotal, iva_total, total, observaciones || null
        ]);

        const id_orden = ordenRes.rows[0].id_orden;

        // Crear items
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad_pedida);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            const total_item = subtotal_item + iva_item;

            const itemQuery = `
                INSERT INTO orden_compra_items (
                    id_orden, id_producto, cantidad_pedida, precio_unitario,
                    iva_porcentaje, subtotal, iva_monto, total
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
            

await client.query(itemQuery, [
                id_orden, item.id_producto, cantidad, precio,
                iva_porcentaje, subtotal_item, iva_item, total_item
            ]);
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Orden de compra creada exitosamente',
            orden: ordenRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear orden:', error.message);
        res.status(500).json({ error: 'Error al crear orden de compra' });
    } finally {
        client.release();
    }
});

// GET - Obtener orden por ID
app.get('/api/compras/ordenes/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_orden = parseInt(req.params.id, 10);

    try {
        const ordenQuery = `
            SELECT o.*, p.razon_social as proveedor, p.cuit_cuil,
                   u.username as usuario
            FROM ordenes_compra o
            JOIN proveedores p ON o.id_proveedor = p.id_proveedor
            JOIN usuarios u ON o.id_usuario = u.id_usuario
            WHERE o.id_orden = $1 AND o.id_empresa = $2`;
        
        const ordenRes = await pool.query(ordenQuery, [id_orden, id_empresa]);

        if (ordenRes.rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        const itemsQuery = `
            SELECT oi.*, pr.nombre as producto, pr.codigo
            FROM orden_compra_items oi
            JOIN productos pr ON oi.id_producto = pr.id_producto
            WHERE oi.id_orden = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_orden]);

        res.json({
            ...ordenRes.rows[0],
            items: itemsRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener orden:', error.message);
        res.status(500).json({ error: 'Error al obtener orden' });
    }
});

// PUT - Actualizar estado de orden
app.put('/api/compras/ordenes/:id/estado', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_orden = parseInt(req.params.id, 10);
    const { estado } = req.body;

    const estadosValidos = ['Pendiente', 'Confirmada', 'Recibida Parcial', 'Recibida Total', 'Cancelada'];
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        const query = `
            UPDATE ordenes_compra
            SET estado = $1
            WHERE id_orden = $2 AND id_empresa = $3
            RETURNING *`;
        
        const { rows } = await pool.query(query, [estado, id_orden, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Orden no encontrada' });
        }

        res.json({ message: 'Estado actualizado', orden: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar estado:', error.message);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// =======================================================================
//                    RECEPCIONES DE MERCADERÍA
// =======================================================================

// POST - Crear recepción (recibir mercadería)
app.post('/api/compras/recepciones', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_orden, id_proveedor, items, observaciones } = req.body;

    if (!id_proveedor || !items || items.length === 0) {
        return res.status(400).json({ error: 'Proveedor e items son requeridos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Próximo número de recepción
        const numeroRes = await client.query(`
            SELECT COALESCE(MAX(numero_recepcion), 0) + 1 as proximo
            FROM recepciones WHERE id_empresa = $1`,
            [id_empresa]
        );
        const numero_recepcion = parseInt(numeroRes.rows[0].proximo, 10);

        // Crear recepción
        const recepcionQuery = `
            INSERT INTO recepciones (
                id_empresa, id_orden, id_proveedor, id_usuario,
                numero_recepcion, observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`;
        
        const recepcionRes = await client.query(recepcionQuery, [
            id_empresa, id_orden || null, id_proveedor,
            id_usuario, numero_recepcion, observaciones || null
        ]);

        const id_recepcion = recepcionRes.rows[0].id_recepcion;

        // Procesar items
        for (const item of items) {
            const cantidad = parseInt(item.cantidad_recibida, 10);

            // Crear item de recepción
            await client.query(`
                INSERT INTO recepcion_items (
                    id_recepcion, id_orden_item, id_producto, cantidad_recibida
                ) VALUES ($1, $2, $3, $4)`,
                [id_recepcion, item.id_orden_item || null, item.id_producto, cantidad]
            );

            // Actualizar stock del producto
            const stockRes = await client.query(`
                UPDATE productos
                SET stock = stock + $1
                WHERE id_producto = $2
                RETURNING stock`,
                [cantidad, item.id_producto]
            );

            const stock_nuevo = stockRes.rows[0].stock;

            // Registrar movimiento de stock
            await client.query(`
                INSERT INTO movimientos_stock (
                    id_producto, id_usuario, tipo, cantidad,
                    stock_anterior, stock_nuevo, motivo, referencia
                ) VALUES ($1, $2, 'entrada', $3, $4, $5, 'Recepción de compra', $6)`,
                [
                    item.id_producto, id_usuario, cantidad,
                    stock_nuevo - cantidad, stock_nuevo,
                    recepcionRes.rows[0].numero_completo
                ]
            );

            // Si es de una orden, actualizar cantidad recibida
            if (item.id_orden_item) {
                await client.query(`
                    UPDATE orden_compra_items
                    SET cantidad_recibida = cantidad_recibida + $1
                    WHERE id_item = $2`,
                    [cantidad, item.id_orden_item]
                );
            }
        }

        // Si es de una orden, actualizar estado
        if (id_orden) {
            const checkQuery = `
                SELECT 
                    SUM(cantidad_pedida) as total_pedido,
                    SUM(cantidad_recibida) as total_recibido
                FROM orden_compra_items
                WHERE id_orden = $1`;
            
            const checkRes = await client.query(checkQuery, [id_orden]);
            const { total_pedido, total_recibido } = checkRes.rows[0];

            let nuevo_estado = 'Recibida Parcial';
            if (total_recibido >= total_pedido) {
                nuevo_estado = 'Recibida Total';
            }

            await client.query(`
                UPDATE ordenes_compra
                SET estado = $1
                WHERE id_orden = $2`,
                [nuevo_estado, id_orden]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Recepción creada exitosamente',
            recepcion: recepcionRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear recepción:', error.message);
        res.status(500).json({ error: 'Error al crear recepción' });
    } finally {
        client.release();
    }
});

// GET - Listar recepciones
app.get('/api/compras/recepciones', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT r.*, p.razon_social as proveedor, u.username as usuario,
                   o.numero_completo as numero_orden
            FROM recepciones r
            JOIN proveedores p ON r.id_proveedor = p.id_proveedor
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            LEFT JOIN ordenes_compra o ON r.id_orden = o.id_orden
            WHERE r.id_empresa = $1
            ORDER BY r.fecha_recepcion DESC`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener recepciones:', error.message);
        res.status(500).json({ error: 'Error al obtener recepciones' });
    }
});

// =======================================================================
//                    COMPROBANTES DE COMPRA
// =======================================================================

// GET - Tipos de comprobantes
app.get('/api/compras/comprobantes/tipos', verificarToken, async (req, res) => {
    try {
        const query = 'SELECT * FROM comprobante_compra_tipos ORDER BY codigo';
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener tipos:', error.message);
        res.status(500).json({ error: 'Error al obtener tipos de comprobante' });
    }
});

// POST - Registrar comprobante de compra (factura del proveedor)
app.post('/api/compras/comprobantes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const {
        id_proveedor, id_orden, id_tipo, punto_venta, numero_comprobante,
        fecha_emision, fecha_vencimiento, items, otros_tributos, cae, observaciones
    } = req.body;

    if (!id_proveedor || !id_tipo || !numero_comprobante || !fecha_emision || !items || items.length === 0) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener tipo de comprobante
        const tipoRes = await client.query(
            'SELECT * FROM comprobante_compra_tipos WHERE id_tipo = $1',
            [id_tipo]
        );
        const tipo = tipoRes.rows[0];

        let subtotal = 0;
        let iva_total = 0;

        // Calcular totales
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            
            subtotal += subtotal_item;
            iva_total += iva_item;
        }

        const total = subtotal + iva_total + (parseFloat(otros_tributos) || 0);

        // Crear comprobante
        const comprobanteQuery = `
            INSERT INTO comprobantes_compra (
                id_empresa, id_proveedor, id_orden, id_tipo, id_usuario,
                punto_venta, numero_comprobante, numero_completo,
                fecha_emision, fecha_vencimiento, subtotal, iva,
                otros_tributos, total, cae, observaciones
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING *`;
        
        const numero_completo = `${punto_venta || '00000'}-${numero_comprobante}`;
        
        const comprobanteRes = await client.query(comprobanteQuery, [
            id_empresa, id_proveedor, id_orden || null, id_tipo, id_usuario,
            punto_venta, numero_comprobante, numero_completo,
            fecha_emision, fecha_vencimiento || null, subtotal, iva_total,
            otros_tributos || 0, total, cae || null, observaciones || null
        ]);

        const id_comprobante = comprobanteRes.rows[0].id_comprobante;

        // Crear items y afectar stock si corresponde
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            const total_item = subtotal_item + iva_item;

            await client.query(`
                INSERT INTO comprobante_compra_items (
                    id_comprobante, id_producto, descripcion, cantidad,
                    precio_unitario, iva_porcentaje, subtotal, iva_monto, total
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    id_comprobante, item.id_producto || null, item.descripcion,
                    cantidad, precio, iva_porcentaje, subtotal_item, iva_item, total_item
                ]
            );

            // Afectar stock si el tipo lo indica
            if (tipo.afecta_stock && item.id_producto) {
                const factor = tipo.codigo === 'NC' ? -1 : 1; // Nota crédito resta stock
                
                const stockRes = await client.query(`
                    UPDATE productos
                    SET stock = stock + $1
                    WHERE id_producto = $2
                    RETURNING stock`,
                    [cantidad * factor, item.id_producto]
                );

                const stock_nuevo = stockRes.rows[0].stock;

                await client.query(`
                    INSERT INTO movimientos_stock (
                        id_producto, id_usuario, tipo, cantidad,
                        stock_anterior, stock_nuevo, motivo, referencia
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        item.id_producto, id_usuario,
                        factor > 0 ? 'entrada' : 'salida',
                        Math.abs(cantidad * factor),
                        stock_nuevo - (cantidad * factor), stock_nuevo,
                        `Comprobante ${tipo.nombre}`, numero_completo
                    ]
                );
            }
        }

        // Afectar cuenta por pagar si corresponde
        if (tipo.afecta_cuenta !== 0) {
            // Obtener saldo actual
            const saldoRes = await client.query(`
                SELECT COALESCE(SUM(
                    CASE 
                        WHEN tipo_movimiento IN ('compra', 'nota_debito', 'ajuste') THEN monto
                        WHEN tipo_movimiento IN ('nota_credito', 'pago') THEN -monto
                        ELSE 0
                    END
                ), 0) as saldo_actual
                FROM cuentas_por_pagar
                WHERE id_proveedor = $1 AND id_empresa = $2`,
                [id_proveedor, id_empresa]
            );

            const saldo_actual = parseFloat(saldoRes.rows[0].saldo_actual);
            const nuevo_saldo = saldo_actual + (total * tipo.afecta_cuenta);

            const tipo_mov = tipo.afecta_cuenta > 0 ? 
                (tipo.codigo.startsWith('ND') ? 'nota_debito' : 'compra') :
                'nota_credito';

            await client.query(`
                INSERT INTO cuentas_por_pagar (
                    id_empresa, id_proveedor, id_comprobante, tipo_movimiento,
                    monto, saldo, fecha_vencimiento, referencia
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    id_empresa, id_proveedor, id_comprobante, tipo_mov,
                    total * tipo.afecta_cuenta, nuevo_saldo,
                    fecha_vencimiento || null, numero_completo
                ]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Comprobante registrado exitosamente',
            comprobante: comprobanteRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al registrar comprobante:', error.message);
        res.status(500).json({ error: 'Error al registrar comprobante' });
    } finally {
        client.release();
    }
});

// GET - Listar comprobantes de compra
app.get('/api/compras/comprobantes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT c.*, p.razon_social as proveedor,
                   t.nombre as tipo_comprobante, t.codigo as tipo_codigo
            FROM comprobantes_compra c
            JOIN proveedores p ON c.id_proveedor = p.id_proveedor
            JOIN comprobante_compra_tipos t ON c.id_tipo = t.id_tipo
            WHERE c.id_empresa = $1
            ORDER BY c.fecha_emision DESC
            LIMIT 100`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener comprobantes:', error.message);
        res.status(500).json({ error: 'Error al obtener comprobantes' });
    }
});

// =======================================================================
//                    CUENTAS POR PAGAR
// =======================================================================

// GET - Saldo con proveedor
app.get('/api/compras/cuentas-pagar/proveedor/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_proveedor = parseInt(req.params.id, 10);

    try {
        const saldoQuery = `
            SELECT COALESCE(SUM(
                CASE 
                    WHEN tipo_movimiento IN ('compra', 'nota_debito', 'ajuste') THEN monto
                    WHEN tipo_movimiento IN ('nota_credito', 'pago') THEN -monto
                    ELSE 0
                END
            ), 0) as saldo
            FROM cuentas_por_pagar
            WHERE id_proveedor = $1 AND id_empresa = $2`;
        
        const saldoRes = await pool.query(saldoQuery, [id_proveedor, id_empresa]);

        const movimientosQuery = `
            SELECT cp.*, cc.numero_completo as comprobante
            FROM cuentas_por_pagar cp
            LEFT JOIN comprobantes_compra cc ON cp.id_comprobante = cc.id_comprobante
            WHERE cp.id_proveedor = $1 AND cp.id_empresa = $2
            ORDER BY cp.fecha_movimiento DESC
            LIMIT 50`;
        
        const movimientosRes = await pool.query(movimientosQuery, [id_proveedor, id_empresa]);

        res.json({
            saldo: parseFloat(saldoRes.rows[0].saldo),
            movimientos: movimientosRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener cuenta:', error.message);
        res.status(500).json({ error: 'Error al obtener cuenta por pagar' });
    }
});

// GET - Listado de deudas por proveedor
app.get('/api/compras/cuentas-pagar', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT 
                p.id_proveedor, p.razon_social,
                COALESCE(SUM(
                    CASE 
                        WHEN cp.tipo_movimiento IN ('compra', 'nota_debito', 'ajuste') THEN cp.monto
                        WHEN cp.tipo_movimiento IN ('nota_credito', 'pago') THEN -cp.monto
                        ELSE 0
                    END
                ), 0) as saldo_total
            FROM proveedores p
            LEFT JOIN cuentas_por_pagar cp ON p.id_proveedor = cp.id_proveedor
            WHERE p.id_empresa = $1 AND p.activo = TRUE
            GROUP BY p.id_proveedor, p.razon_social
            HAVING COALESCE(SUM(
                CASE 
                    WHEN cp.tipo_movimiento IN ('compra', 'nota_debito', 'ajuste') THEN cp.monto
                    WHEN cp.tipo_movimiento IN ('nota_credito', 'pago') THEN -cp.monto
                    ELSE 0
                END
            ), 0) != 0
            ORDER BY saldo_total DESC`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener cuentas por pagar:', error.message);
        res.status(500).json({ error: 'Error al obtener cuentas por pagar' });
    }
});
// =======================================================================
//                    MÓDULO DE NOTAS DE CRÉDITO/DÉBITO
// =======================================================================

// GET - Listar notas
app.get('/api/notas', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { tipo_nota } = req.query;

    try {
        let query = `
            SELECT n.*, c.razon_social as cliente, u.username as usuario
            FROM notas_credito_debito n
            LEFT JOIN clientes c ON n.id_cliente = c.id_cliente
            JOIN usuarios u ON n.id_usuario = u.id_usuario
            WHERE n.id_empresa = $1 AND n.estado != 'anulada'`;

        const params = [id_empresa];

        if (tipo_nota) {
            query += ` AND n.tipo_nota = $2`;
            params.push(tipo_nota);
        }

        query += ` ORDER BY n.fecha_emision DESC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener notas:', error.message);
        res.status(500).json({ error: 'Error al obtener notas' });
    }
});

// POST - Crear nota de crédito o débito
app.post('/api/notas', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { 
        id_factura_origen, 
        tipo_nota, 
        codigo_tipo, 
        id_cliente, 
        motivo, 
        items, 
        observaciones, 
        punto_venta = 1 
    } = req.body;

    if (!tipo_nota || !codigo_tipo || !motivo || !items || items.length === 0) {
        return res.status(400).json({ error: 'Datos incompletos' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener próximo número
        const numeroQuery = `
            SELECT COALESCE(MAX(numero_nota), 0) + 1 as proximo_numero
            FROM notas_credito_debito 
            WHERE id_empresa = $1 AND punto_venta = $2 AND tipo_nota = $3`;
        
        const numeroRes = await client.query(numeroQuery, [id_empresa, punto_venta, tipo_nota]);
        const numero_nota = parseInt(numeroRes.rows[0].proximo_numero, 10);

        let subtotal = 0;
        let iva_total = 0;

        // Calcular totales
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            
            subtotal += subtotal_item;
            iva_total += iva_item;
        }

        const total = subtotal + iva_total;

        // Crear nota
        const notaQuery = `
            INSERT INTO notas_credito_debito (
                id_empresa, id_factura_origen, tipo_nota, codigo_tipo, id_cliente, 
                id_usuario, numero_nota, punto_venta, motivo, subtotal, iva, total, observaciones
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *`;
        
        const notaRes = await client.query(notaQuery, [
            id_empresa, id_factura_origen || null, tipo_nota, codigo_tipo, 
            id_cliente || null, id_usuario, numero_nota, punto_venta, 
            motivo, subtotal, iva_total, total, observaciones || null
        ]);

        const id_nota = notaRes.rows[0].id_nota;

        // Crear items
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            
            const subtotal_item = cantidad * precio;
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            const total_item = subtotal_item + iva_item;

            const itemQuery = `
                INSERT INTO nota_items (
                    id_nota, id_producto, descripcion, cantidad, 
                    precio_unitario, iva_porcentaje, subtotal, iva_monto, total
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
            
            await client.query(itemQuery, [
                id_nota, item.id_producto || null, item.descripcion,
                cantidad, precio, iva_porcentaje, subtotal_item, iva_item, total_item
            ]);

            // Si es nota de crédito, devolver stock
            if (tipo_nota === 'credito' && item.id_producto) {
                await client.query(
                    'UPDATE inventario SET stock_actual = stock_actual + $1 WHERE id_producto = $2 AND id_empresa = $3',
                    [cantidad, item.id_producto, id_empresa]
                );

                // Registrar movimiento
                await client.query(`
                    INSERT INTO movimientos_stock (
                        id_producto, id_usuario, tipo, cantidad, 
                        stock_anterior, stock_nuevo, motivo, referencia
                    )
                    SELECT $1, $2, 'entrada', $3, stock - $3, stock, 
                           'Nota de Crédito', $4
                    FROM productos WHERE id_producto = $1`,
                    [item.id_producto, id_usuario, cantidad, `NC #${numero_nota}`]
                );
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: `Nota de ${tipo_nota} creada exitosamente`,
            nota: notaRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear nota:', error.message);
        res.status(500).json({ error: 'Error al crear nota' });
    } finally {
        client.release();
    }
});

// GET - Obtener nota por ID
app.get('/api/notas/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_nota = parseInt(req.params.id, 10);

    try {
        const notaQuery = `
            SELECT n.*, c.razon_social as cliente, c.cuit_cuil, c.domicilio as direccion,
                   u.username as usuario, f.numero_completo as factura_origen
            FROM notas_credito_debito n
            LEFT JOIN clientes c ON n.id_cliente = c.id_cliente
            JOIN usuarios u ON n.id_usuario = u.id_usuario
            LEFT JOIN facturas f ON n.id_factura_origen = f.id_factura
            WHERE n.id_nota = $1 AND n.id_empresa = $2`;
        
        const notaRes = await pool.query(notaQuery, [id_nota, id_empresa]);

        if (notaRes.rows.length === 0) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        const itemsQuery = `
            SELECT ni.*, p.nombre as producto
            FROM nota_items ni
            LEFT JOIN productos p ON ni.id_producto = p.id_producto
            WHERE ni.id_nota = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_nota]);

        res.json({
            ...notaRes.rows[0],
            items: itemsRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener nota:', error.message);
        res.status(500).json({ error: 'Error al obtener nota' });
    }
});

// =======================================================================
//                          MÓDULO DE REMITOS
// =======================================================================

// GET - Listar remitos
app.get('/api/remitos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT r.*, c.razon_social as cliente, u.username as usuario
            FROM remitos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            WHERE r.id_empresa = $1
            ORDER BY r.fecha_emision DESC`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener remitos:', error.message);
        res.status(500).json({ error: 'Error al obtener remitos' });
    }
});

// POST - Crear remito
app.post('/api/remitos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { 
        id_cliente, 
        id_pedido, 
        fecha_entrega, 
        direccion_entrega, 
        transportista, 
        items, 
        observaciones, 
        punto_venta = 1 
    } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir items' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener próximo número
        const numeroQuery = `
            SELECT COALESCE(MAX(numero_remito), 0) + 1 as proximo_numero
            FROM remitos 
            WHERE id_empresa = $1 AND punto_venta = $2`;
        
        const numeroRes = await client.query(numeroQuery, [id_empresa, punto_venta]);
        const numero_remito = parseInt(numeroRes.rows[0].proximo_numero, 10);

        // Crear remito
        const remitoQuery = `
            INSERT INTO remitos (
                id_empresa, id_cliente, id_pedido, id_usuario, numero_remito, punto_venta,
                fecha_entrega, direccion_entrega, transportista, observaciones
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`;
        
        const remitoRes = await client.query(remitoQuery, [
            id_empresa, id_cliente || null, id_pedido || null, id_usuario, 
            numero_remito, punto_venta, fecha_entrega || null, 
            direccion_entrega || null, transportista || null, observaciones || null
        ]);

        const id_remito = remitoRes.rows[0].id_remito;

        // Crear items
        for (const item of items) {
            const itemQuery = `
                INSERT INTO remito_items (id_remito, id_producto, descripcion, cantidad)
                VALUES ($1, $2, $3, $4)`;
            
            await client.query(itemQuery, [
                id_remito, item.id_producto, item.descripcion, item.cantidad
            ]);
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Remito creado exitosamente',
            remito: remitoRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear remito:', error.message);
        res.status(500).json({ error: 'Error al crear remito' });
    } finally {
        client.release();
    }
});

// GET - Obtener remito por ID
app.get('/api/remitos/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_remito = parseInt(req.params.id, 10);

    try {
        const remitoQuery = `
            SELECT r.*, c.razon_social as cliente, c.direccion as direccion_cliente,
                   u.username as usuario
            FROM remitos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            WHERE r.id_remito = $1 AND r.id_empresa = $2`;
        
        const remitoRes = await pool.query(remitoQuery, [id_remito, id_empresa]);

        if (remitoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Remito no encontrado' });
        }

        const itemsQuery = `
            SELECT ri.*, p.nombre as producto
            FROM remito_items ri
            JOIN productos p ON ri.id_producto = p.id_producto
            WHERE ri.id_remito = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_remito]);

        res.json({
            ...remitoRes.rows[0],
            items: itemsRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener remito:', error.message);
        res.status(500).json({ error: 'Error al obtener remito' });
    }
});

// =======================================================================
//                          MÓDULO DE PRESUPUESTOS
// =======================================================================

// GET - Listar presupuestos
app.get('/api/presupuestos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT p.*, c.razon_social as cliente, u.username as usuario
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_empresa = $1
            ORDER BY p.fecha_emision DESC`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener presupuestos:', error.message);
        res.status(500).json({ error: 'Error al obtener presupuestos' });
    }
});

// POST - Crear presupuesto
app.post('/api/presupuestos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { 
        id_cliente, 
        fecha_vencimiento, 
        items, 
        observaciones, 
        condiciones_pago 
    } = req.body;

    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir items' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Obtener próximo número
        const numeroQuery = `
            SELECT COALESCE(MAX(numero_presupuesto), 0) + 1 as proximo_numero
            FROM presupuestos WHERE id_empresa = $1`;
        
        const numeroRes = await client.query(numeroQuery, [id_empresa]);
        const numero_presupuesto = parseInt(numeroRes.rows[0].proximo_numero, 10);

        let subtotal = 0;
        let iva_total = 0;

        // Calcular totales
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            const descuento = parseFloat(item.descuento_porcentaje || 0);
            
            let subtotal_item = cantidad * precio;
            if (descuento > 0) {
                subtotal_item = subtotal_item * (1 - descuento / 100);
            }
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            
            subtotal += subtotal_item;
            iva_total += iva_item;
        }

        const total = subtotal + iva_total;

        // Crear presupuesto
        const presupuestoQuery = `
            INSERT INTO presupuestos (
                id_empresa, id_cliente, id_usuario, numero_presupuesto, 
                fecha_vencimiento, subtotal, iva, total, observaciones, condiciones_pago
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *`;
        
        const presupuestoRes = await client.query(presupuestoQuery, [
            id_empresa, id_cliente || null, id_usuario, numero_presupuesto,
            fecha_vencimiento || null, subtotal, iva_total, total, 
            observaciones || null, condiciones_pago || null
        ]);

        const id_presupuesto = presupuestoRes.rows[0].id_presupuesto;

        // Crear items
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio = parseFloat(item.precio_unitario);
            const iva_porcentaje = parseFloat(item.iva_porcentaje || 21);
            const descuento = parseFloat(item.descuento_porcentaje || 0);
            
            let subtotal_item = cantidad * precio;
            if (descuento > 0) {
                subtotal_item = subtotal_item * (1 - descuento / 100);
            }
            const iva_item = subtotal_item * (iva_porcentaje / 100);
            const total_item = subtotal_item + iva_item;

            const itemQuery = `
                INSERT INTO presupuesto_items (
                    id_presupuesto, id_producto, descripcion, cantidad, 
                    precio_unitario, iva_porcentaje, descuento_porcentaje, 
                    subtotal, iva_monto, total
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
            
            await client.query(itemQuery, [
                id_presupuesto, item.id_producto || null, item.descripcion,
                cantidad, precio, iva_porcentaje, descuento,
                subtotal_item, iva_item, total_item
            ]);
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'Presupuesto creado exitosamente',
            presupuesto: presupuestoRes.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear presupuesto:', error.message);
        res.status(500).json({ error: 'Error al crear presupuesto' });
    } finally {
        client.release();
    }
});

// GET - Obtener presupuesto por ID
app.get('/api/presupuestos/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);

    try {
        const presupuestoQuery = `
            SELECT p.*, c.razon_social as cliente, c.cuit_cuil, c.domicilio as direccion,
                   u.username as usuario, e.razon_social as empresa
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_presupuesto = $1 AND p.id_empresa = $2`;
        
        const presupuestoRes = await pool.query(presupuestoQuery, [id_presupuesto, id_empresa]);

        if (presupuestoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Presupuesto no encontrado' });
        }

        const itemsQuery = `
            SELECT pi.*, p.nombre as producto
            FROM presupuesto_items pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_presupuesto = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_presupuesto]);

        res.json({
            ...presupuestoRes.rows[0],
            items: itemsRes.rows
        });

    } catch (error) {
        console.error('❌ Error al obtener presupuesto:', error.message);
        res.status(500).json({ error: 'Error al obtener presupuesto' });
    }
});

// PUT - Cambiar estado de presupuesto
app.put('/api/presupuestos/:id/estado', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);
    const { estado } = req.body;

    const estadosValidos = ['pendiente', 'aprobado', 'rechazado', 'facturado', 'vencido'];
    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        const query = `
            UPDATE presupuestos
            SET estado = $1
            WHERE id_presupuesto = $2 AND id_empresa = $3
            RETURNING *`;
        
        const { rows } = await pool.query(query, [estado, id_presupuesto, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Presupuesto no encontrado' });
        }

        res.json({ message: 'Estado actualizado', presupuesto: rows[0] });
    } catch (error) {
        console.error('❌ Error al actualizar estado:', error.message);
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// =======================================================================
//                      ENDPOINTS PARA GENERAR PDFs
// =======================================================================

// GET - Generar PDF de factura
app.get('/api/facturas/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);

    try {
        // Obtener factura con todos los datos
        const facturaQuery = `
            SELECT f.*, c.razon_social as cliente, c.cuit_cuil, c.domicilio as direccion,
                   ft.nombre as tipo_factura, ft.codigo as tipo_codigo,
                   e.razon_social as empresa, e.cuit as cuit_empresa,
                   e.direccion as direccion_empresa, e.telefono as telefono_empresa
            FROM facturas f
            LEFT JOIN clientes c ON f.id_cliente = c.id_cliente
            JOIN factura_tipos ft ON f.id_tipo = ft.id_tipo_factura
            JOIN empresas e ON f.id_empresa = e.id_empresa
            WHERE f.id_factura = $1 AND f.id_empresa = $2`;
        
        const facturaRes = await pool.query(facturaQuery, [id_factura, id_empresa]);

        if (facturaRes.rows.length === 0) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const itemsQuery = `
            SELECT fi.*, p.nombre as producto
            FROM factura_items fi
            LEFT JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_factura]);

        const facturaData = {
            ...facturaRes.rows[0],
            items: itemsRes.rows
        };

        // Generar PDF
        pdfGenerator.generarFacturaPDF(facturaData, (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=factura_${facturaData.numero_completo}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (error) {
        console.error('❌ Error al generar PDF de factura:', error.message);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});
// ============================================
// ENDPOINTS EMAIL Y WHATSAPP PARA FACTURAS
// Agregar después del endpoint: app.get('/api/facturas/:id/pdf'...)
// (después de la línea ~4533 en server.js)
// ============================================

// ===== POST - Enviar factura por email =====
app.post('/api/facturas/:id/email', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);
    const { email_destino, asunto, mensaje } = req.body;

    try {
        // Obtener datos de la factura
        const queryFactura = `
            SELECT 
                f.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                c.cuit_cuil as cliente_cuit,
                c.email as cliente_email,
                tv.descripcion as tipo_venta_desc,
                e.razon_social as empresa_razon_social,
                e.nombre_fantasia as empresa_nombre_fantasia,
                e.domicilio_fiscal as empresa_domicilio,
                e.cuit as empresa_cuit,
                e.telefono as empresa_telefono,
                e.email as empresa_email
            FROM facturas f
            LEFT JOIN clientes c ON f.id_cliente = c.id_cliente
            LEFT JOIN tiposventa tv ON f.id_tipo_venta = tv.id_tipo_venta
            LEFT JOIN empresas e ON f.id_empresa = e.id_empresa
            WHERE f.id_factura = $1 AND f.id_empresa = $2
        `;

        const resultFactura = await pool.query(queryFactura, [id_factura, id_empresa]);

        if (resultFactura.rows.length === 0) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const factura = resultFactura.rows[0];

        // Validar email destino
        const emailFinal = email_destino || factura.cliente_email;
        if (!emailFinal) {
            return res.status(400).json({ error: 'El cliente no tiene email registrado. Proporcione un email destino.' });
        }

        // Obtener items de la factura
        const queryItems = `
            SELECT 
                fi.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku
            FROM facturaitems fi
            LEFT JOIN productos p ON fi.id_producto = p.id_producto
            WHERE fi.id_factura = $1
            ORDER BY fi.id_item ASC
        `;

        const resultItems = await pool.query(queryItems, [id_factura]);

        const facturaData = {
            ...factura,
            items: resultItems.rows
        };

        // Generar PDF
        pdfGenerator.generarFacturaPDF(facturaData, async (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF para email:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            try {
                // Calcular totales
                const total = parseFloat(factura.total || 0).toFixed(2);
                const subtotal = parseFloat(factura.subtotal || 0).toFixed(2);
                const iva = parseFloat(factura.total_iva || 0).toFixed(2);

                // Asunto por defecto
                const asuntoFinal = asunto || `Factura ${factura.numero_completo} - ${factura.empresa_razon_social || 'ERP LAGO'}`;

                // Mensaje por defecto
                const mensajeHTML = mensaje || `
                    <h2>Factura ${factura.numero_completo}</h2>
                    <p>Estimado/a <strong>${factura.cliente_nombre || 'Cliente'}</strong>,</p>
                    <p>Adjuntamos la factura electrónica correspondiente.</p>
                    <p><strong>Fecha de emisión:</strong> ${new Date(factura.fecha_emision).toLocaleDateString('es-AR')}</p>
                    ${factura.fecha_vencimiento ? `<p><strong>Fecha de vencimiento:</strong> ${new Date(factura.fecha_vencimiento).toLocaleDateString('es-AR')}</p>` : ''}
                    ${factura.cae ? `<p><strong>CAE:</strong> ${factura.cae}</p>` : ''}
                    ${factura.cae_vencimiento ? `<p><strong>Vencimiento CAE:</strong> ${new Date(factura.cae_vencimiento).toLocaleDateString('es-AR')}</p>` : ''}
                    <hr>
                    <p><strong>Subtotal:</strong> $${subtotal}</p>
                    <p><strong>IVA:</strong> $${iva}</p>
                    <p><strong>TOTAL:</strong> $${total}</p>
                    ${factura.observaciones ? `<p><strong>Observaciones:</strong> ${factura.observaciones}</p>` : ''}
                    <br>
                    <p>Saludos cordiales,<br>
                    ${factura.empresa_razon_social || 'ERP LAGO'}</p>
                `;

                // Enviar email
                await generador.enviarEmail(
                    emailFinal,
                    asuntoFinal,
                    mensajeHTML,
                    [{
                        filename: `factura_${factura.numero_completo}.pdf`,
                        content: pdfBuffer
                    }]
                );

                res.json({ 
                    success: true, 
                    message: 'Email enviado correctamente',
                    destinatario: emailFinal
                });

            } catch (emailError) {
                console.error('❌ Error al enviar email:', emailError);
                res.status(500).json({ error: 'Error al enviar email: ' + emailError.message });
            }
        });

    } catch (error) {
        console.error('❌ Error al enviar factura por email:', error.message);
        res.status(500).json({ error: 'Error al enviar email de factura' });
    }
});

// ===== GET - Generar link de WhatsApp para factura =====
app.get('/api/facturas/:id/whatsapp', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_factura = parseInt(req.params.id, 10);

    try {
        // Obtener datos de la factura
        const queryFactura = `
            SELECT 
                f.*,
                c.razon_social as cliente_nombre,
                c.telefono as cliente_telefono,
                c.domicilio as cliente_direccion,
                e.razon_social as empresa_razon_social
            FROM facturas f
            LEFT JOIN clientes c ON f.id_cliente = c.id_cliente
            LEFT JOIN empresas e ON f.id_empresa = e.id_empresa
            WHERE f.id_factura = $1 AND f.id_empresa = $2
        `;

        const resultFactura = await pool.query(queryFactura, [id_factura, id_empresa]);

        if (resultFactura.rows.length === 0) {
            return res.status(404).json({ error: 'Factura no encontrada' });
        }

        const factura = resultFactura.rows[0];

        // Validar teléfono
        if (!factura.cliente_telefono) {
            return res.status(400).json({ 
                error: 'El cliente no tiene teléfono registrado',
                factura: {
                    numero: factura.numero_completo,
                    cliente: factura.cliente_nombre
                }
            });
        }

        // Formatear teléfono
        let telefono = factura.cliente_telefono.replace(/\D/g, '');
        if (!telefono.startsWith('54') && telefono.length === 10) {
            telefono = '54' + telefono;
        }

        // Calcular totales
        const total = parseFloat(factura.total || 0).toFixed(2);

        // Crear mensaje de WhatsApp
        const mensaje = `
*Factura ${factura.numero_completo}*

Hola ${factura.cliente_nombre || 'Cliente'}!

Le enviamos su factura electrónica:

📅 *Fecha de emisión:* ${new Date(factura.fecha_emision).toLocaleDateString('es-AR')}
${factura.fecha_vencimiento ? `📆 *Vencimiento:* ${new Date(factura.fecha_vencimiento).toLocaleDateString('es-AR')}
` : ''}${factura.cae ? `🔐 *CAE:* ${factura.cae}
` : ''}💰 *Total:* $${total}

${factura.observaciones ? `📝 *Observaciones:* ${factura.observaciones}

` : ''}Puede descargar su factura desde:
${req.protocol}://${req.get('host')}/api/facturas/${id_factura}/pdf

Saludos,
${factura.empresa_razon_social || 'ERP LAGO'}
        `.trim();

        // Generar link de WhatsApp
        const whatsappLink = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;

        res.json({
            success: true,
            telefono: factura.cliente_telefono,
            whatsapp_link: whatsappLink,
            mensaje: mensaje
        });

    } catch (error) {
        console.error('❌ Error al generar link de WhatsApp:', error.message);
        res.status(500).json({ error: 'Error al generar link de WhatsApp' });
    }
});


// GET - Generar PDF de nota de crédito/débito
app.get('/api/notas/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_nota = parseInt(req.params.id, 10);

    try {
        const notaQuery = `
            SELECT n.*, c.razon_social as cliente, c.cuit_cuil, c.domicilio as direccion,
                   f.numero_completo as factura_origen,
                   e.razon_social as empresa, e.cuit as cuit_empresa,
                   e.direccion as direccion_empresa, e.telefono as telefono_empresa
            FROM notas_credito_debito n
            LEFT JOIN clientes c ON n.id_cliente = c.id_cliente
            LEFT JOIN facturas f ON n.id_factura_origen = f.id_factura
            JOIN empresas e ON n.id_empresa = e.id_empresa
            WHERE n.id_nota = $1 AND n.id_empresa = $2`;
        
        const notaRes = await pool.query(notaQuery, [id_nota, id_empresa]);

        if (notaRes.rows.length === 0) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        const itemsQuery = `
            SELECT ni.*, p.nombre as producto
            FROM nota_items ni
            LEFT JOIN productos p ON ni.id_producto = p.id_producto
            WHERE ni.id_nota = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_nota]);

        const notaData = {
            ...notaRes.rows[0],
            items: itemsRes.rows
        };

        pdfGenerator.generarNotaPDF(notaData, (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            const tipoNota = notaData.tipo_nota === 'credito' ? 'NC' : 'ND';
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=${tipoNota}_${notaData.numero_completo}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (error) {
        console.error('❌ Error al generar PDF de nota:', error.message);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});
// ============================================
// ENDPOINTS EMAIL Y WHATSAPP PARA NOTAS DE CRÉDITO/DÉBITO
// Agregar después del endpoint: app.get('/api/notas/:id/pdf'...)
// (después de la línea ~4585 en server.js)
// ============================================

// ===== POST - Enviar nota por email =====
app.post('/api/notas/:id/email', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_nota = parseInt(req.params.id, 10);
    const { email_destino, asunto, mensaje } = req.body;

    try {
        // Obtener datos de la nota
        const queryNota = `
            SELECT 
                nc.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                c.cuit_cuil as cliente_cuit,
                c.email as cliente_email,
                e.razon_social as empresa_razon_social,
                e.nombre_fantasia as empresa_nombre_fantasia,
                e.domicilio_fiscal as empresa_domicilio,
                e.cuit as empresa_cuit,
                e.telefono as empresa_telefono,
                e.email as empresa_email
            FROM notas_credito_debito nc
            LEFT JOIN clientes c ON nc.id_cliente = c.id_cliente
            LEFT JOIN empresas e ON nc.id_empresa = e.id_empresa
            WHERE nc.id_nota = $1 AND nc.id_empresa = $2
        `;

        const resultNota = await pool.query(queryNota, [id_nota, id_empresa]);

        if (resultNota.rows.length === 0) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        const nota = resultNota.rows[0];

        // Validar email destino
        const emailFinal = email_destino || nota.cliente_email;
        if (!emailFinal) {
            return res.status(400).json({ error: 'El cliente no tiene email registrado. Proporcione un email destino.' });
        }

        // Determinar tipo de nota
        const tipoNota = nota.tipo_comprobante === 'C' ? 'Nota de Crédito' : 'Nota de Débito';

        // Obtener items de la nota
        const queryItems = `
            SELECT 
                nci.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku
            FROM notaitems nci
            LEFT JOIN productos p ON nci.id_producto = p.id_producto
            WHERE nci.id_nota = $1
            ORDER BY nci.id_item ASC
        `;

        const resultItems = await pool.query(queryItems, [id_nota]);

        const notaData = {
            ...nota,
            items: resultItems.rows
        };

        // Generar PDF
        pdfGenerator.generarNotaPDF(notaData, async (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF para email:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            try {
                // Calcular totales
                const total = parseFloat(nota.total || 0).toFixed(2);
                const subtotal = parseFloat(nota.subtotal || 0).toFixed(2);
                const iva = parseFloat(nota.total_iva || 0).toFixed(2);

                // Asunto por defecto
                const asuntoFinal = asunto || `${tipoNota} ${nota.numero_completo} - ${nota.empresa_razon_social || 'ERP LAGO'}`;

                // Mensaje por defecto
                const mensajeHTML = mensaje || `
                    <h2>${tipoNota} ${nota.numero_completo}</h2>
                    <p>Estimado/a <strong>${nota.cliente_nombre || 'Cliente'}</strong>,</p>
                    <p>Adjuntamos la ${tipoNota.toLowerCase()} electrónica correspondiente.</p>
                    <p><strong>Fecha de emisión:</strong> ${new Date(nota.fecha_emision).toLocaleDateString('es-AR')}</p>
                    ${nota.id_factura_origen ? `<p><strong>Factura relacionada:</strong> ID ${nota.id_factura_origen}</p>` : ''}
                    ${nota.cae ? `<p><strong>CAE:</strong> ${nota.cae}</p>` : ''}
                    ${nota.cae_vencimiento ? `<p><strong>Vencimiento CAE:</strong> ${new Date(nota.cae_vencimiento).toLocaleDateString('es-AR')}</p>` : ''}
                    <hr>
                    <p><strong>Subtotal:</strong> $${subtotal}</p>
                    <p><strong>IVA:</strong> $${iva}</p>
                    <p><strong>TOTAL:</strong> $${total}</p>
                    ${nota.observaciones ? `<p><strong>Observaciones:</strong> ${nota.observaciones}</p>` : ''}
                    <br>
                    <p>Saludos cordiales,<br>
                    ${nota.empresa_razon_social || 'ERP LAGO'}</p>
                `;

                // Enviar email
                await generador.enviarEmail(
                    emailFinal,
                    asuntoFinal,
                    mensajeHTML,
                    [{
                        filename: `${nota.tipo_comprobante === 'C' ? 'nota_credito' : 'nota_debito'}_${nota.numero_completo}.pdf`,
                        content: pdfBuffer
                    }]
                );

                res.json({ 
                    success: true, 
                    message: 'Email enviado correctamente',
                    destinatario: emailFinal
                });

            } catch (emailError) {
                console.error('❌ Error al enviar email:', emailError);
                res.status(500).json({ error: 'Error al enviar email: ' + emailError.message });
            }
        });

    } catch (error) {
        console.error('❌ Error al enviar nota por email:', error.message);
        res.status(500).json({ error: 'Error al enviar email de nota' });
    }
});

// ===== GET - Generar link de WhatsApp para nota =====
app.get('/api/notas/:id/whatsapp', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_nota = parseInt(req.params.id, 10);

    try {
        // Obtener datos de la nota
        const queryNota = `
            SELECT 
                nc.*,
                c.razon_social as cliente_nombre,
                c.telefono as cliente_telefono,
                c.domicilio as cliente_direccion,
                e.razon_social as empresa_razon_social
            FROM notas_credito_debito nc
            LEFT JOIN clientes c ON nc.id_cliente = c.id_cliente
            LEFT JOIN empresas e ON nc.id_empresa = e.id_empresa
            WHERE nc.id_nota = $1 AND nc.id_empresa = $2
        `;

        const resultNota = await pool.query(queryNota, [id_nota, id_empresa]);

        if (resultNota.rows.length === 0) {
            return res.status(404).json({ error: 'Nota no encontrada' });
        }

        const nota = resultNota.rows[0];

        // Validar teléfono
        if (!nota.cliente_telefono) {
            return res.status(400).json({ 
                error: 'El cliente no tiene teléfono registrado',
                nota: {
                    numero: nota.numero_completo,
                    cliente: nota.cliente_nombre
                }
            });
        }

        // Formatear teléfono
        let telefono = nota.cliente_telefono.replace(/\D/g, '');
        if (!telefono.startsWith('54') && telefono.length === 10) {
            telefono = '54' + telefono;
        }

        // Calcular totales
        const total = parseFloat(nota.total || 0).toFixed(2);

        // Determinar tipo de nota
        const tipoNota = nota.tipo_comprobante === 'C' ? 'Nota de Crédito' : 'Nota de Débito';
        const emoji = nota.tipo_comprobante === 'C' ? '↩️' : '📈';

        // Crear mensaje de WhatsApp
        const mensaje = `
${emoji} *${tipoNota} ${nota.numero_completo}*

Hola ${nota.cliente_nombre || 'Cliente'}!

Le enviamos su ${tipoNota.toLowerCase()} electrónica:

📅 *Fecha de emisión:* ${new Date(nota.fecha_emision).toLocaleDateString('es-AR')}
${nota.id_factura_origen ? `📄 *Factura relacionada:* ID ${nota.id_factura_origen}
` : ''}${nota.cae ? `🔐 *CAE:* ${nota.cae}
` : ''}💰 *Total:* $${total}

${nota.observaciones ? `📝 *Observaciones:* ${nota.observaciones}

` : ''}Puede descargar su ${tipoNota.toLowerCase()} desde:
${req.protocol}://${req.get('host')}/api/notas/${id_nota}/pdf

Saludos,
${nota.empresa_razon_social || 'ERP LAGO'}
        `.trim();

        // Generar link de WhatsApp
        const whatsappLink = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;

        res.json({
            success: true,
            telefono: nota.cliente_telefono,
            whatsapp_link: whatsappLink,
            mensaje: mensaje
        });

    } catch (error) {
        console.error('❌ Error al generar link de WhatsApp:', error.message);
        res.status(500).json({ error: 'Error al generar link de WhatsApp' });
    }
});
// GET - Generar PDF de remito
app.get('/api/remitos/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_remito = parseInt(req.params.id, 10);

    try {
        const remitoQuery = `
            SELECT r.*, c.razon_social as cliente, c.direccion as direccion_cliente,
                   e.razon_social as empresa, e.cuit as cuit_empresa,
                   e.direccion as direccion_empresa, e.telefono as telefono_empresa
            FROM remitos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN empresas e ON r.id_empresa = e.id_empresa
            WHERE r.id_remito = $1 AND r.id_empresa = $2`;
        
        const remitoRes = await pool.query(remitoQuery, [id_remito, id_empresa]);

        if (remitoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Remito no encontrado' });
        }

        const itemsQuery = `
            SELECT ri.*, p.nombre as producto
            FROM remito_items ri
            JOIN productos p ON ri.id_producto = p.id_producto
            WHERE ri.id_remito = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_remito]);

        const remitoData = {
            ...remitoRes.rows[0],
            items: itemsRes.rows
        };

        pdfGenerator.generarRemitoPDF(remitoData, (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=remito_${remitoData.numero_completo}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (error) {
        console.error('❌ Error al generar PDF de remito:', error.message);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});

// GET - Generar PDF de presupuesto
app.get('/api/presupuestos/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_presupuesto = parseInt(req.params.id, 10);

    try {
        const presupuestoQuery = `
            SELECT p.*, c.razon_social as cliente, c.cuit_cuil, c.domicilio as direccion,
                   e.razon_social as empresa, e.cuit as cuit_empresa,
                   e.direccion as direccion_empresa, e.telefono as telefono_empresa
            FROM presupuestos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_presupuesto = $1 AND p.id_empresa = $2`;
        
        const presupuestoRes = await pool.query(presupuestoQuery, [id_presupuesto, id_empresa]);

        if (presupuestoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Presupuesto no encontrado' });
        }

        const itemsQuery = `
            SELECT pi.*, p.nombre as producto
            FROM presupuesto_items pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_presupuesto = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_presupuesto]);

        const presupuestoData = {
            ...presupuestoRes.rows[0],
            items: itemsRes.rows
        };

        pdfGenerator.generarPresupuestoPDF(presupuestoData, (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=presupuesto_${presupuestoData.numero_completo}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (error) {
        console.error('❌ Error al generar PDF de presupuesto:', error.message);
        res.status(500).json({ error: 'Error al generar PDF' });
    }
});





// =======================================================================

// =======================================================================
//                       LIBRO IVA VENTAS
// =======================================================================

// GET - Obtener datos del libro IVA
app.get('/api/libro-iva/ventas', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, tipo_factura, incluir_anuladas } = req.query;

    try {
        let query = `
            SELECT * FROM v_libro_iva_ventas 
            WHERE id_empresa = $1`;
        
        const params = [id_empresa];
        let paramIndex = 2;

        if (fecha_desde) {
            query += ` AND DATE(fecha_emision) >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND DATE(fecha_emision) <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        if (tipo_factura) {
            query += ` AND tipo_codigo = $${paramIndex}`;
            params.push(tipo_factura);
            paramIndex++;
        }

        if (incluir_anuladas !== 'true') {
            query += ` AND estado != 'anulada'`;
        }

        query += ` ORDER BY fecha_emision DESC, numero_completo`;

        const { rows } = await pool.query(query, params);

        // Calcular totales
        const totales = {
            cantidad_comprobantes: rows.length,
            subtotal_total: 0,
            iva_total: 0,
            total_general: 0,
            por_tipo: {}
        };

        rows.forEach(row => {
            totales.subtotal_total += parseFloat(row.subtotal || 0);
            totales.iva_total += parseFloat(row.iva_monto || 0);
            totales.total_general += parseFloat(row.total || 0);

            // Agrupar por tipo
            const tipo = row.tipo_factura;
            if (!totales.por_tipo[tipo]) {
                totales.por_tipo[tipo] = {
                    cantidad: 0,
                    subtotal: 0,
                    iva: 0,
                    total: 0
                };
            }
            totales.por_tipo[tipo].cantidad++;
            totales.por_tipo[tipo].subtotal += parseFloat(row.subtotal || 0);
            totales.por_tipo[tipo].iva += parseFloat(row.iva_monto || 0);
            totales.por_tipo[tipo].total += parseFloat(row.total || 0);
        });

        res.json({
            facturas: rows,
            totales
        });

    } catch (error) {
        console.error('❌ Error al obtener libro IVA:', error.message);
        res.status(500).json({ error: 'Error al obtener libro IVA' });
    }
});

// GET - Resumen por período
app.get('/api/libro-iva/resumen', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        const query = `
            SELECT 
                tipo_factura,
                tipo_codigo,
                COUNT(*) as cantidad,
                SUM(subtotal) as subtotal_total,
                SUM(iva_monto) as iva_total,
                SUM(total) as total_general
            FROM v_libro_iva_ventas
            WHERE id_empresa = $1
            AND estado != 'anulada'
            ${fecha_desde ? 'AND DATE(fecha_emision) >= $2' : ''}
            ${fecha_hasta ? 'AND DATE(fecha_emision) <= $3' : ''}
            GROUP BY tipo_factura, tipo_codigo
            ORDER BY tipo_codigo`;

        const params = [id_empresa];
        if (fecha_desde) params.push(fecha_desde);
        if (fecha_hasta) params.push(fecha_hasta);

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error al obtener resumen IVA:', error.message);
        res.status(500).json({ error: 'Error al obtener resumen' });
    }
});


// =======================================================================
//                   MÓDULO DE CUENTA CORRIENTE Y COBRANZAS
// =======================================================================

// GET - Movimientos de cuenta corriente de un cliente
app.get('/api/clientes/:id/cuenta-corriente', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        let query = `
            SELECT
                cc.id_movimiento,
                cc.fecha_movimiento,
                cc.tipo_movimiento,
                cc.debe,
                cc.haber,
                cc.saldo,
                cc.concepto
            FROM cuentas_corrientes cc
            WHERE cc.id_cliente = $1 AND cc.id_empresa = $2`;

        const params = [id_cliente, id_empresa];
        let paramIndex = 3;

        if (fecha_desde) {
            query += ` AND cc.fecha_movimiento >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND cc.fecha_movimiento <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        query += ` ORDER BY cc.fecha_movimiento DESC, cc.id_movimiento DESC`;

        const { rows } = await pool.query(query, params);

        const clienteRes = await pool.query(`
            SELECT razon_social, cuit_cuil, limite_credito, saldo_actual
            FROM clientes 
            WHERE id_cliente = $1 AND id_empresa = $2`,
            [id_cliente, id_empresa]
        );

        if (clienteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({
            cliente: clienteRes.rows[0],
            movimientos: rows,
            saldo_actual: clienteRes.rows[0].saldo_actual,
            limite_credito: clienteRes.rows[0].limite_credito,
            credito_disponible: parseFloat(clienteRes.rows[0].limite_credito || 0) - parseFloat(clienteRes.rows[0].saldo_actual || 0)
        });

    } catch (error) {
        console.error('❌ Error al obtener cuenta corriente:', error.message);
        res.status(500).json({ error: 'Error al obtener cuenta corriente' });
    }
});

// GET - Saldo actual del cliente
app.get('/api/clientes/:id/saldo', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT 
                c.razon_social,
                c.saldo_actual,
                c.limite_credito,
                (c.limite_credito - c.saldo_actual) as credito_disponible,
                COUNT(f.id_factura) as facturas_pendientes,
                COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) as total_pendiente
            FROM clientes c
            LEFT JOIN facturas f ON c.id_cliente = f.id_cliente 
                AND f.estado = 'emitida' 
                AND (f.total - COALESCE(f.monto_pagado, 0)) > 0
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
            GROUP BY c.id_cliente`;

        const { rows } = await pool.query(query, [id_cliente, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('❌ Error al obtener saldo:', error.message);
        res.status(500).json({ error: 'Error al obtener saldo' });
    }
});

// GET - Facturas pendientes de un cliente
app.get('/api/clientes/:id/facturas-pendientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT 
                f.id_factura,
                f.numero_completo,
                f.fecha_emision,
                f.fecha_vencimiento,
                f.total,
                COALESCE(f.total - f.monto_pagado, f.total) as saldo_pendiente,
                COALESCE(f.monto_pagado, 0) as pagado,
                CASE 
                    WHEN f.fecha_vencimiento < CURRENT_DATE THEN 
                        CURRENT_DATE - f.fecha_vencimiento
                    ELSE 0
                END as dias_vencido,
                CASE
                    WHEN f.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
                    WHEN f.fecha_vencimiento = CURRENT_DATE THEN 'vence_hoy'
                    ELSE 'vigente'
                END as estado_vencimiento,
                ft.codigo as tipo_factura
            FROM facturas f
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            WHERE f.id_cliente = $1 
                AND f.id_empresa = $2
                AND f.estado = 'emitida'
                AND COALESCE(f.total - f.monto_pagado, f.total) > 0
            ORDER BY f.fecha_vencimiento ASC`;

        const { rows } = await pool.query(query, [id_cliente, id_empresa]);

        const resumen = {
            total_facturas: rows.length,
            total_deuda: 0,
            vencidas: 0,
            vigentes: 0,
            vence_hoy: 0
        };

        rows.forEach(factura => {
            resumen.total_deuda += parseFloat(factura.saldo_pendiente);
            if (factura.estado_vencimiento === 'vencida') resumen.vencidas++;
            else if (factura.estado_vencimiento === 'vence_hoy') resumen.vence_hoy++;
            else resumen.vigentes++;
        });

        res.json({ facturas: rows, resumen });

    } catch (error) {
        console.error('❌ Error al obtener facturas pendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
});

// GET - Reporte de aging
app.get('/api/reportes/aging', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT 
                c.id_cliente, c.razon_social, c.cuit_cuil, c.telefono, c.email,
                COUNT(f.id_factura) as cantidad_facturas,
                COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) as deuda_total,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento >= CURRENT_DATE THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as corriente,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE AND f.fecha_vencimiento >= CURRENT_DATE - 30 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_1_30,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE - 30 AND f.fecha_vencimiento >= CURRENT_DATE - 60 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_31_60,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE - 60 AND f.fecha_vencimiento >= CURRENT_DATE - 90 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_61_90,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE - 90 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_mas_90
            FROM clientes c
            LEFT JOIN facturas f ON c.id_cliente = f.id_cliente 
                AND f.estado = 'emitida'
                AND (f.total - COALESCE(f.monto_pagado, 0)) > 0
            WHERE c.id_empresa = $1 AND c.activo = TRUE
            GROUP BY c.id_cliente
            HAVING COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) > 0
            ORDER BY deuda_total DESC`;

        const { rows } = await pool.query(query, [id_empresa]);

        const totales = {
            total_clientes: rows.length,
            deuda_total: 0,
            corriente: 0,
            vencido_1_30: 0,
            vencido_31_60: 0,
            vencido_61_90: 0,
            vencido_mas_90: 0
        };

        rows.forEach(cliente => {
            totales.deuda_total += parseFloat(cliente.deuda_total);
            totales.corriente += parseFloat(cliente.corriente);
            totales.vencido_1_30 += parseFloat(cliente.vencido_1_30);
            totales.vencido_31_60 += parseFloat(cliente.vencido_31_60);
            totales.vencido_61_90 += parseFloat(cliente.vencido_61_90);
            totales.vencido_mas_90 += parseFloat(cliente.vencido_mas_90);
        });

        res.json({ clientes: rows, totales });

    } catch (error) {
        console.error('❌ Error aging:', error.message);
        res.status(500).json({ error: 'Error al obtener aging' });
    }
});

// GET - Facturas pendientes de cobro
app.get('/api/cobranzas/pendientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { solo_hoy, id_cliente } = req.query;

    try {
        let query = `
            SELECT f.id_factura, f.numero_completo, f.fecha_emision, f.fecha_vencimiento,
                   f.total, COALESCE(f.total - f.monto_pagado, f.total) as saldo_pendiente,
                   c.id_cliente, c.razon_social, c.telefono, c.email
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_empresa = $1 AND f.estado = 'emitida'
                AND COALESCE(f.total - f.monto_pagado, f.total) > 0`;

        const params = [id_empresa];
        let paramIndex = 2;

        if (solo_hoy === 'true') {
            query += ` AND f.fecha_vencimiento = CURRENT_DATE`;
        }

        if (id_cliente) { 
            query += ` AND f.id_cliente = $${paramIndex}`;
            params.push(parseInt(id_cliente));
            paramIndex++;
        }

        query += ` ORDER BY f.fecha_vencimiento ASC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error pendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
});

// POST - Aplicar pago a facturas
app.post('/api/cobranzas/aplicar-pago', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_recibo, aplicaciones } = req.body;

    if (!id_recibo || !aplicaciones || aplicaciones.length === 0) {
        return res.status(400).json({ error: 'Recibo y aplicaciones requeridos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const reciboRes = await client.query(
            'SELECT total_recibo, id_cliente FROM recibos WHERE id_recibo = $1 AND id_empresa = $2',
            [id_recibo, id_empresa]
        );

        if (reciboRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const total_recibo = parseFloat(reciboRes.rows[0].total_recibo);
        let total_aplicado = 0;

        for (const aplicacion of aplicaciones) {
            const { id_factura, monto_aplicado } = aplicacion;
            const monto = parseFloat(monto_aplicado);

            if (monto <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Montos deben ser mayores a cero' });
            }

            // Verificar saldo pendiente de la factura
            const facturaRes = await client.query(
                'SELECT total, COALESCE(monto_pagado, 0) as pagado FROM facturas WHERE id_factura = $1',
                [id_factura]
            );

            const saldo_pendiente = parseFloat(facturaRes.rows[0].total) - parseFloat(facturaRes.rows[0].pagado);

            if (monto > saldo_pendiente + 0.01) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: `Monto ${monto} supera saldo pendiente ${saldo_pendiente}` 
                });
            }

            await client.query(
                'INSERT INTO recibo_facturas (id_recibo, id_factura, monto_aplicado) VALUES ($1, $2, $3)',
                [id_recibo, id_factura, monto]
            );

            await client.query(
                'UPDATE facturas SET monto_pagado = COALESCE(monto_pagado, 0) + $1 WHERE id_factura = $2',
                [monto, id_factura]
            );

            // Marcar como pagada si está totalmente cobrada
            if (saldo_pendiente - monto <= 0.01) {
                await client.query(
                    'UPDATE facturas SET estado = $1 WHERE id_factura = $2',
                    ['pagada', id_factura]
                );
            }

            total_aplicado += monto;
        }

        if (total_aplicado > total_recibo + 0.01) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Total aplicado ${total_aplicado} supera total recibo ${total_recibo}` 
            });
        }

        await client.query('COMMIT');
        res.json({ 
            message: 'Pago aplicado exitosamente', 
            total_aplicado,
            facturas_aplicadas: aplicaciones.length
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error aplicar pago:', error.message);
        res.status(500).json({ error: 'Error al aplicar pago' });
    } finally {
        client.release();
    }
});

// GET - Historial de cobranzas
app.get('/api/cobranzas/historial', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta, id_cliente } = req.query;

    try {
        let query = `
            SELECT 
                r.id_recibo, r.numero_completo, r.fecha_recibo, r.total_recibo,
                c.razon_social as cliente, u.username as cobrador,
                COUNT(rf.id_relacion) as facturas_aplicadas,
                COALESCE(SUM(rf.monto_aplicado), 0) as monto_aplicado
            FROM recibos r
            LEFT JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN usuarios u ON r.id_usuario = u.id_usuario
            LEFT JOIN recibo_facturas rf ON r.id_recibo = rf.id_recibo
            WHERE r.id_empresa = $1`;

        const params = [id_empresa];
        let paramIndex = 2;

        if (fecha_desde) {
            query += ` AND DATE(r.fecha_recibo) >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND DATE(r.fecha_recibo) <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        if (id_cliente) {
            query += ` AND r.id_cliente = $${paramIndex}`;
            params.push(parseInt(id_cliente));
            paramIndex++;
        }

        query += ` GROUP BY r.id_recibo, c.razon_social, u.username
                   ORDER BY r.fecha_recibo DESC LIMIT 100`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error historial:', error.message);
        res.status(500).json({ error: 'Error al obtener historial' });
    }
});


// =======================================================================
//                   MÓDULO DE CUENTA CORRIENTE Y COBRANZAS
// =======================================================================

// GET - Movimientos de cuenta corriente de un cliente
app.get('/api/clientes/:id/cuenta-corriente', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);
    const { fecha_desde, fecha_hasta } = req.query;

    try {
        let query = `
            SELECT
                cc.id_movimiento,
                cc.fecha_movimiento,
                cc.tipo_movimiento,
                cc.debe,
                cc.haber,
                cc.saldo,
                cc.concepto
            FROM cuentas_corrientes cc
            WHERE cc.id_cliente = $1 AND cc.id_empresa = $2`;

        const params = [id_cliente, id_empresa];
        let paramIndex = 3;

        if (fecha_desde) {
            query += ` AND cc.fecha_movimiento >= $${paramIndex}`;
            params.push(fecha_desde);
            paramIndex++;
        }

        if (fecha_hasta) {
            query += ` AND cc.fecha_movimiento <= $${paramIndex}`;
            params.push(fecha_hasta);
            paramIndex++;
        }

        query += ` ORDER BY cc.fecha_movimiento DESC, cc.id_movimiento DESC`;

        const { rows } = await pool.query(query, params);

        const clienteRes = await pool.query(`
            SELECT razon_social, cuit_cuil, limite_credito, saldo_actual
            FROM clientes 
            WHERE id_cliente = $1 AND id_empresa = $2`,
            [id_cliente, id_empresa]
        );

        if (clienteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json({
            cliente: clienteRes.rows[0],
            movimientos: rows,
            saldo_actual: clienteRes.rows[0].saldo_actual,
            limite_credito: clienteRes.rows[0].limite_credito,
            credito_disponible: parseFloat(clienteRes.rows[0].limite_credito || 0) - parseFloat(clienteRes.rows[0].saldo_actual || 0)
        });

    } catch (error) {
        console.error('❌ Error al obtener cuenta corriente:', error.message);
        res.status(500).json({ error: 'Error al obtener cuenta corriente' });
    }
});

// GET - Saldo actual del cliente
app.get('/api/clientes/:id/saldo', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT 
                c.razon_social,
                c.saldo_actual,
                c.limite_credito,
                (c.limite_credito - c.saldo_actual) as credito_disponible,
                COUNT(f.id_factura) as facturas_pendientes,
                COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) as total_pendiente
            FROM clientes c
            LEFT JOIN facturas f ON c.id_cliente = f.id_cliente 
                AND f.estado = 'emitida' 
                AND (f.total - COALESCE(f.monto_pagado, 0)) > 0
            WHERE c.id_cliente = $1 AND c.id_empresa = $2
            GROUP BY c.id_cliente`;

        const { rows } = await pool.query(query, [id_cliente, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        res.json(rows[0]);

    } catch (error) {
        console.error('❌ Error al obtener saldo:', error.message);
        res.status(500).json({ error: 'Error al obtener saldo' });
    }
});

// GET - Facturas pendientes de un cliente
app.get('/api/clientes/:id/facturas-pendientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_cliente = parseInt(req.params.id, 10);

    try {
        const query = `
            SELECT 
                f.id_factura,
                f.numero_completo,
                f.fecha_emision,
                f.fecha_vencimiento,
                f.total,
                COALESCE(f.total - f.monto_pagado, f.total) as saldo_pendiente,
                COALESCE(f.monto_pagado, 0) as pagado,
                CASE 
                    WHEN f.fecha_vencimiento < CURRENT_DATE THEN 
                        CURRENT_DATE - f.fecha_vencimiento
                    ELSE 0
                END as dias_vencido,
                CASE
                    WHEN f.fecha_vencimiento < CURRENT_DATE THEN 'vencida'
                    WHEN f.fecha_vencimiento = CURRENT_DATE THEN 'vence_hoy'
                    ELSE 'vigente'
                END as estado_vencimiento,
                ft.codigo as tipo_factura
            FROM facturas f
            JOIN factura_tipos ft ON f.id_tipo_factura = ft.id_tipo_factura
            WHERE f.id_cliente = $1 
                AND f.id_empresa = $2
                AND f.estado = 'emitida'
                AND COALESCE(f.total - f.monto_pagado, f.total) > 0
            ORDER BY f.fecha_vencimiento ASC`;

        const { rows } = await pool.query(query, [id_cliente, id_empresa]);

        const resumen = {
            total_facturas: rows.length,
            total_deuda: 0,
            vencidas: 0,
            vigentes: 0,
            vence_hoy: 0
        };

        rows.forEach(factura => {
            resumen.total_deuda += parseFloat(factura.saldo_pendiente);
            if (factura.estado_vencimiento === 'vencida') resumen.vencidas++;
            else if (factura.estado_vencimiento === 'vence_hoy') resumen.vence_hoy++;
            else resumen.vigentes++;
        });

        res.json({ facturas: rows, resumen });

    } catch (error) {
        console.error('❌ Error al obtener facturas pendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
});

// GET - Reporte de aging
app.get('/api/reportes/aging', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT 
                c.id_cliente, c.razon_social, c.cuit_cuil,
                COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) as deuda_total,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento >= CURRENT_DATE THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as corriente,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE AND f.fecha_vencimiento >= CURRENT_DATE - 30 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_1_30,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE - 30 AND f.fecha_vencimiento >= CURRENT_DATE - 60 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_31_60,
                COALESCE(SUM(CASE WHEN f.fecha_vencimiento < CURRENT_DATE - 90 THEN f.total - COALESCE(f.monto_pagado, 0) ELSE 0 END), 0) as vencido_mas_90
            FROM clientes c
            LEFT JOIN facturas f ON c.id_cliente = f.id_cliente 
                AND f.estado = 'emitida'
                AND (f.total - COALESCE(f.monto_pagado, 0)) > 0
            WHERE c.id_empresa = $1 AND c.activo = TRUE
            GROUP BY c.id_cliente
            HAVING COALESCE(SUM(f.total - COALESCE(f.monto_pagado, 0)), 0) > 0
            ORDER BY deuda_total DESC`;

        const { rows } = await pool.query(query, [id_empresa]);
        res.json({ clientes: rows });

    } catch (error) {
        console.error('❌ Error aging:', error.message);
        res.status(500).json({ error: 'Error al obtener aging' });
    }
});

// GET - Facturas pendientes de cobro
app.get('/api/cobranzas/pendientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { solo_hoy, id_cliente } = req.query;

    try {
        let query = `
            SELECT f.id_factura, f.numero_completo, f.fecha_emision, f.fecha_vencimiento,
                   f.total, COALESCE(f.total - f.monto_pagado, f.total) as saldo_pendiente,
                   c.id_cliente, c.razon_social
            FROM facturas f
            JOIN clientes c ON f.id_cliente = c.id_cliente
            WHERE f.id_empresa = $1 AND f.estado = 'emitida'
                AND COALESCE(f.total - f.monto_pagado, f.total) > 0`;

        const params = [id_empresa];
        if (solo_hoy === 'true') query += ` AND f.fecha_vencimiento = CURRENT_DATE`;
        if (id_cliente) { query += ` AND f.id_cliente = $2`; params.push(id_cliente); }
        query += ` ORDER BY f.fecha_vencimiento ASC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error pendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
});

// POST - Aplicar pago a facturas
app.post('/api/cobranzas/aplicar-pago', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_recibo, aplicaciones } = req.body;

    if (!id_recibo || !aplicaciones || aplicaciones.length === 0) {
        return res.status(400).json({ error: 'Recibo y aplicaciones requeridos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const reciboRes = await client.query(
            'SELECT total_recibo, id_cliente FROM recibos WHERE id_recibo = $1 AND id_empresa = $2',
            [id_recibo, id_empresa]
        );

        if (reciboRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        let total_aplicado = 0;

        for (const aplicacion of aplicaciones) {
            const { id_factura, monto_aplicado } = aplicacion;
            const monto = parseFloat(monto_aplicado);

            await client.query(
                'INSERT INTO recibo_facturas (id_recibo, id_factura, monto_aplicado) VALUES ($1, $2, $3)',
                [id_recibo, id_factura, monto]
            );

            await client.query(
                'UPDATE facturas SET monto_pagado = COALESCE(monto_pagado, 0) + $1 WHERE id_factura = $2',
                [monto, id_factura]
            );

            total_aplicado += monto;
        }

        await client.query('COMMIT');
        res.json({ message: 'Pago aplicado', total_aplicado });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error aplicar pago:', error.message);
        res.status(500).json({ error: 'Error al aplicar pago' });
    } finally {
        client.release();
    }
});


// =======================================================================
//                   ENDPOINTS DE RECIBOS Y COBRANZAS
// =======================================================================

// GET - Listar pedidos pendientes de cobro
app.get('/api/pedidos/pendientes-cobro', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { id_cliente } = req.query;

    try {
        let query = `
            SELECT 
                p.id_pedido,
                p.id_cliente,
                c.razon_social,
                c.telefono,
                c.email,
                p.fecha_creacion,
                p.total,
                p.estado_entrega,
                COALESCE(SUM(pg.monto), 0) as total_pagado,
                (p.total - COALESCE(SUM(pg.monto), 0)) as saldo_pendiente
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pagos pg ON p.id_pedido = pg.id_pedido
            WHERE p.id_empresa = $1`;
        
        const params = [id_empresa];
        
        if (id_cliente) {
            query += ` AND p.id_cliente = $2`;
            params.push(parseInt(id_cliente));
        }
        
        query += `
            GROUP BY p.id_pedido, p.id_cliente, c.razon_social, c.telefono, c.email, p.fecha_creacion, p.total, p.estado_entrega
            HAVING (p.total - COALESCE(SUM(pg.monto), 0)) > 0
            ORDER BY p.fecha_creacion DESC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (error) {
        console.error('❌ Error al obtener pedidos pendientes:', error.message);
        res.status(500).json({ error: 'Error al obtener pedidos pendientes' });
    }
});

// POST - Crear recibo con formas de pago
app.post('/api/recibos/crear', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_cliente, id_turno, total_recibo, formas_pago, concepto, observaciones } = req.body;

    if (!id_turno || !total_recibo || !formas_pago || formas_pago.length === 0) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Obtener el próximo número de recibo
        const numeroRes = await client.query(`
            SELECT COALESCE(MAX(numero_recibo), 0) + 1 as siguiente_numero
            FROM recibos
            WHERE id_empresa = $1`, [id_empresa]);
        
        const numero_recibo = numeroRes.rows[0].siguiente_numero;

        // Crear el recibo
        const reciboRes = await client.query(`
            INSERT INTO recibos (
                id_empresa, id_turno, id_cliente, id_usuario, 
                numero_recibo, total_recibo, concepto, observaciones
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id_recibo, numero_completo`, 
            [id_empresa, id_turno, id_cliente || null, id_usuario, 
             numero_recibo, total_recibo, concepto || null, observaciones || null]
        );

        const id_recibo = reciboRes.rows[0].id_recibo;
        const numero_completo = reciboRes.rows[0].numero_completo;

        // Insertar formas de pago (recibo_items)
        for (const fp of formas_pago) {
            await client.query(`
                INSERT INTO recibo_items (
                    id_recibo, id_forma_pago, id_moneda, monto_original, 
                    cotizacion_usada, monto_convertido, id_tarjeta, cuotas, 
                    interes_aplicado, monto_interes, monto_con_interes,
                    id_banco, numero_referencia, fecha_acreditacion, observaciones
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                [
                    id_recibo,
                    fp.id_forma_pago,
                    fp.id_moneda || 1,
                    fp.monto_original,
                    fp.cotizacion_usada || 1,
                    fp.monto_convertido || fp.monto_original,
                    fp.id_tarjeta || null,
                    fp.cuotas || 1,
                    fp.interes_aplicado || 0,
                    fp.monto_interes || 0,
                    fp.monto_con_interes || fp.monto_original,
                    fp.id_banco || null,
                    fp.numero_referencia || null,
                    fp.fecha_acreditacion || null,
                    fp.observaciones || null
                ]
            );
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            id_recibo,
            numero_completo,
            message: 'Recibo creado exitosamente'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al crear recibo:', error.message);
        res.status(500).json({ error: 'Error al crear recibo: ' + error.message });
    } finally {
        client.release();
    }
});

// POST - Aplicar recibo a pedidos específicos
app.post('/api/recibos/:id/aplicar-pedidos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_recibo = parseInt(req.params.id);
    const { aplicaciones } = req.body; // [{id_pedido, monto_aplicado}]

    if (!aplicaciones || aplicaciones.length === 0) {
        return res.status(400).json({ error: 'Debe especificar pedidos a aplicar' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Verificar que el recibo existe
        const reciboRes = await client.query(`
            SELECT total_recibo, id_cliente
            FROM recibos
            WHERE id_recibo = $1 AND id_empresa = $2`,
            [id_recibo, id_empresa]
        );

        if (reciboRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const total_recibo = parseFloat(reciboRes.rows[0].total_recibo);
        const id_cliente = reciboRes.rows[0].id_cliente;
        let total_aplicado = 0;

        // Procesar cada aplicación
        for (const aplicacion of aplicaciones) {
            const { id_pedido, monto_aplicado } = aplicacion;
            const monto = parseFloat(monto_aplicado);

            if (monto <= 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Los montos deben ser mayores a cero' });
            }

            // Verificar saldo pendiente del pedido
            const pedidoRes = await client.query(`
                SELECT p.total, p.id_cliente,
                       (p.total - COALESCE(SUM(pg.monto), 0)) as saldo_pendiente
                FROM pedidos p
                LEFT JOIN pagos pg ON p.id_pedido = pg.id_pedido
                WHERE p.id_pedido = $1 AND p.id_empresa = $2
                GROUP BY p.id_pedido`,
                [id_pedido, id_empresa]
            );

            if (pedidoRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: `Pedido ${id_pedido} no encontrado` });
            }

            const saldo_pendiente = parseFloat(pedidoRes.rows[0].saldo_pendiente);

            if (monto > saldo_pendiente + 0.01) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: `Monto $${monto} supera saldo pendiente $${saldo_pendiente} del pedido ${id_pedido}` 
                });
            }

            // Crear el pago
            const pagoRes = await client.query(`
                INSERT INTO pagos (
                    id_pedido, id_metodo_pago, fecha_pago, monto, observaciones
                )
                VALUES ($1, 6, NOW(), $2, $3)
                RETURNING id_pago`,
                [id_pedido, monto, `Aplicado desde recibo #${id_recibo}`]
            );

            const id_pago = pagoRes.rows[0].id_pago;

            // Vincular recibo con pago
            await client.query(`
                INSERT INTO recibopagos (id_recibo, id_pago)
                VALUES ($1, $2)`,
                [id_recibo, id_pago]
            );

            // Registrar en cuenta corriente (HABER - resta deuda)
            await client.query(`
                INSERT INTO cuentas_corrientes (
                    id_empresa, id_cliente, id_pedido, tipo_movimiento,
                    debe, haber, saldo, concepto
                )
                SELECT 
                    $1, $2, $3, 'pago',
                    0, $4,
                    (SELECT COALESCE(MAX(saldo), 0) - $4 FROM cuentas_corrientes WHERE id_cliente = $2),
                    'Pago recibo ' || r.numero_completo
                FROM recibos r
                WHERE r.id_recibo = $5`,
                [id_empresa, id_cliente, id_pedido, monto, id_recibo]
            );

            total_aplicado += monto;
        }

        if (total_aplicado > total_recibo + 0.01) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: `Total aplicado ($${total_aplicado}) supera total del recibo ($${total_recibo})` 
            });
        }

        // Si hay saldo a favor (pago mayor a deuda)
        if (total_aplicado < total_recibo - 0.01) {
            const saldo_favor = total_recibo - total_aplicado;
            
            // Registrar saldo a favor en cuenta corriente
            await client.query(`
                INSERT INTO cuentas_corrientes (
                    id_empresa, id_cliente, tipo_movimiento,
                    debe, haber, saldo, concepto
                )
                VALUES (
                    $1, $2, 'pago',
                    0, $3,
                    (SELECT COALESCE(MAX(saldo), 0) - $3 FROM cuentas_corrientes WHERE id_cliente = $2),
                    'Saldo a favor - Recibo no aplicado completamente'
                )`,
                [id_empresa, id_cliente, saldo_favor]
            );
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            total_aplicado,
            pedidos_aplicados: aplicaciones.length,
            saldo_favor: total_recibo - total_aplicado
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al aplicar recibo:', error.message);
        res.status(500).json({ error: 'Error al aplicar recibo: ' + error.message });
    } finally {
        client.release();
    }
});


// =======================================================================
//                   ENDPOINTS DE GENERACIÓN DE DOCUMENTOS
// =======================================================================

const GeneradorDocumentosPDFKit = require('./modulos/generador-documentos-pdfkit');

// Configuración del generador (ajustar según tu empresa)
const generador = new GeneradorDocumentosPDFKit({
    nombreEmpresa: 'LAGO - Ferretería Industrial',
    email: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER || '',
            pass: process.env.EMAIL_PASS || ''
        }
    }
});

// POST - Generar PDF de recibo
app.post('/api/recibos/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_recibo = parseInt(req.params.id);

    try {
        // Obtener datos del recibo
        const reciboRes = await pool.query(`
            SELECT 
                r.*,
                c.razon_social as cliente_nombre,
                c.cuit_cuil as cliente_cuit,
                e.razon_social as empresa_nombre,
                e.cuit as empresa_cuit,
                e.domicilio_fiscal as empresa_direccion
            FROM recibos r
            JOIN clientes c ON r.id_cliente = c.id_cliente
            JOIN empresas e ON r.id_empresa = e.id_empresa
            WHERE r.id_recibo = $1 AND r.id_empresa = $2
        `, [id_recibo, id_empresa]);

        if (reciboRes.rows.length === 0) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const recibo = reciboRes.rows[0];

        // Obtener pedidos aplicados
        const pedidosRes = await pool.query(`
            SELECT 
                p.id_pedido,
                p.fecha_creacion,
                p.total,
                pg.monto as monto_aplicado
            FROM recibopagos rp
            JOIN pagos pg ON rp.id_pago = pg.id_pago
            JOIN pedidos p ON pg.id_pedido = p.id_pedido
            WHERE rp.id_recibo = $1
        `, [id_recibo]);

        // Obtener formas de pago
        const formasPagoRes = await pool.query(`
            SELECT 
                fp.nombre as forma_pago,
                ri.monto_convertido as monto
            FROM recibo_items ri
            JOIN formas_pago fp ON ri.id_forma_pago = fp.id_forma_pago
            WHERE ri.id_recibo = $1
        `, [id_recibo]);

        // Generar HTML
        const filasDetalle = pedidosRes.rows.map(p => `
            <tr>
                <td>#${p.id_pedido}</td>
                <td>${new Date(p.fecha_creacion).toLocaleDateString('es-AR')}</td>
                <td style="text-align: right;">$${parseFloat(p.total).toFixed(2)}</td>
                <td style="text-align: right;">-</td>
                <td style="text-align: right;">$${parseFloat(p.monto_aplicado).toFixed(2)}</td>
            </tr>
        `).join('');

        const filasFormasPago = formasPagoRes.rows.map(fp => `
            <tr>
                <td>${fp.forma_pago}</td>
                <td style="text-align: right;">$${parseFloat(fp.monto).toFixed(2)}</td>
            </tr>
        `).join('');

        // Generar QR con link al recibo
        const urlRecibo = `${req.protocol}://${req.get('host')}/recibos/${id_recibo}`;
        const qrCode = await generador.generarQR(urlRecibo);

        const datos = {
            nombreEmpresa: recibo.empresa_nombre,
            cuitEmpresa: `CUIT: ${recibo.empresa_cuit}`,
            direccionEmpresa: recibo.empresa_direccion,
            telefonoEmpresa: '',
            numeroRecibo: recibo.numero_completo,
            fecha: new Date(recibo.fecha_creacion).toLocaleDateString('es-AR'),
            hora: new Date(recibo.fecha_creacion).toLocaleTimeString('es-AR'),
            cliente: recibo.cliente_nombre,
            clienteCuit: recibo.cliente_cuit || 'N/A',
            filasDetalle: filasDetalle || '<tr><td colspan="5">Cobro a cuenta - Sin aplicar a pedidos</td></tr>',
            filasFormasPago: filasFormasPago,
            totalCobrado: `$${parseFloat(recibo.total_recibo).toLocaleString('es-AR', {minimumFractionDigits: 2})}`,
            qrCode: `<div class="qr-code"><img src="${qrCode}" alt="QR Code"></div>`,
            fechaGeneracion: new Date().toLocaleString('es-AR')
        };

        const datosPDF = {
            nombreEmpresa: recibo.empresa_nombre,
            cuitEmpresa: 'CUIT: ' + recibo.empresa_cuit,
            direccionEmpresa: recibo.empresa_direccion,
            numeroRecibo: recibo.numero_completo,
            fecha: new Date(recibo.fecha_creacion).toLocaleDateString('es-AR'),
            hora: new Date(recibo.fecha_creacion).toLocaleTimeString('es-AR'),
            cliente: recibo.cliente_nombre,
            clienteCuit: recibo.cliente_cuit || 'N/A',
            pedidos: pedidosRes.rows.map(p => ({
                id_pedido: p.id_pedido,
                fecha: new Date(p.fecha_creacion).toLocaleDateString('es-AR'),
                total: parseFloat(p.total).toFixed(2),
                pagado: '-',
                aplicado: parseFloat(p.monto_aplicado).toFixed(2)
            })),
            formasPago: formasPagoRes.rows.map(fp => ({
                forma: fp.forma_pago,
                monto: parseFloat(fp.monto).toFixed(2)
            })),
            totalCobrado: '$' + parseFloat(recibo.total_recibo).toLocaleString('es-AR', {minimumFractionDigits: 2}),
            qrCode: qrCode,
            fechaGeneracion: new Date().toLocaleString('es-AR')
        };

        const pdfBuffer = await generador.generarPDFRecibo(datosPDF);
        res.setHeader('Content-Disposition', `attachment; filename="recibo_${recibo.numero_completo}.pdf"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('❌ Error al generar PDF:', error);
        res.status(500).json({ error: 'Error al generar PDF: ' + error.message });
    }
});

// POST - Enviar recibo por email
app.post('/api/recibos/:id/email', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_recibo = parseInt(req.params.id);
    const { email_destino } = req.body;

    if (!email_destino) {
        return res.status(400).json({ error: 'Email destino requerido' });
    }

    try {
        // Generar PDF (reutilizar código anterior)
        const reciboRes = await pool.query(`
            SELECT r.*, c.razon_social as cliente_nombre, c.cuit_cuil as cliente_cuit
            FROM recibos r
            JOIN clientes c ON r.id_cliente = c.id_cliente
            WHERE r.id_recibo = $1 AND r.id_empresa = $2
        `, [id_recibo, id_empresa]);

        if (reciboRes.rows.length === 0) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const recibo = reciboRes.rows[0];

        // Generar PDF (simplificado para el ejemplo)
        const html = generador.generarHTMLSimple(
            `Recibo ${recibo.numero_completo}`,
            [{ Cliente: recibo.cliente_nombre, Total: `$${recibo.total_recibo}` }]
        );
        const pdfBuffer = await generador.generarPDF(html);

        // Enviar email
        await generador.enviarEmail(
            email_destino,
            `Recibo ${recibo.numero_completo} - ${recibo.cliente_nombre}`,
            `<p>Adjunto encontrará el recibo de pago.</p>`,
            [{
                filename: `recibo_${recibo.numero_completo}.pdf`,
                content: pdfBuffer
            }]
        );

        res.json({ success: true, message: 'Email enviado correctamente' });

    } catch (error) {
        console.error('❌ Error al enviar email:', error);
        res.status(500).json({ error: 'Error al enviar email: ' + error.message });
    }
});

// GET - Generar link de WhatsApp
app.get('/api/recibos/:id/whatsapp', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_recibo = parseInt(req.params.id);

    try {
        const reciboRes = await pool.query(`
            SELECT r.*, c.razon_social as cliente_nombre, c.telefono as cliente_telefono
            FROM recibos r
            JOIN clientes c ON r.id_cliente = c.id_cliente
            WHERE r.id_recibo = $1 AND r.id_empresa = $2
        `, [id_recibo, id_empresa]);

        if (reciboRes.rows.length === 0) {
            return res.status(404).json({ error: 'Recibo no encontrado' });
        }

        const recibo = reciboRes.rows[0];
        const mensaje = `Hola ${recibo.cliente_nombre}!\n\nTe enviamos el recibo de pago N° ${recibo.numero_completo}\nMonto: $${parseFloat(recibo.total_recibo).toFixed(2)}\n\nGracias por tu pago!`;

        const link = generador.generarLinkWhatsApp(
            recibo.cliente_telefono || req.query.numero || '',
            mensaje
        );

        res.json({ link, mensaje });

    } catch (error) {
        console.error('❌ Error al generar link WhatsApp:', error);
        res.status(500).json({ error: 'Error al generar link: ' + error.message });
    }
});

// POST - Exportar lista de recibos a Excel
app.post('/api/recibos/exportar-excel', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { fecha_desde, fecha_hasta } = req.body;

    try {
        let query = `
            SELECT 
                r.numero_completo,
                r.fecha_creacion,
                c.razon_social as cliente,
                c.cuit,
                r.total_recibo,
                r.concepto
            FROM recibos r
            JOIN clientes c ON r.id_cliente = c.id_cliente
            WHERE r.id_empresa = $1
        `;

        const params = [id_empresa];

        if (fecha_desde) {
            query += ` AND r.fecha_creacion >= $${params.length + 1}`;
            params.push(fecha_desde);
        }

        if (fecha_hasta) {
            query += ` AND r.fecha_creacion <= $${params.length + 1}`;
            params.push(fecha_hasta);
        }

        query += ` ORDER BY r.fecha_creacion DESC`;

        const result = await pool.query(query, params);

        const datos = result.rows.map(r => ({
            'Número': r.numero_completo,
            'Fecha': new Date(r.fecha_creacion).toLocaleDateString('es-AR'),
            'Cliente': r.cliente,
            'CUIT': r.cuit,
            'Total': parseFloat(r.total_recibo),
            'Concepto': r.concepto || ''
        }));

        const excelBuffer = await generador.generarExcel(datos, {
            nombreHoja: 'Recibos',
            columnas: [
                { header: 'Número', key: 'Número', width: 15 },
                { header: 'Fecha', key: 'Fecha', width: 12 },
                { header: 'Cliente', key: 'Cliente', width: 30 },
                { header: 'CUIT', key: 'CUIT', width: 15 },
                { header: 'Total', key: 'Total', width: 12 },
                { header: 'Concepto', key: 'Concepto', width: 30 }
            ]
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="recibos.xlsx"');
        res.send(excelBuffer);

    } catch (error) {
        console.error('❌ Error al exportar Excel:', error);
        res.status(500).json({ error: 'Error al exportar: ' + error.message });
    }
});

//                      GRACEFUL SHUTDOWN
// =======================================================================
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM recibido, cerrando servidor gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT recibido, cerrando servidor gracefully...');
    await pool.end();
    process.exit(0);
});

// =======================================================================
//                             INICIAR SERVIDOR
// =======================================================================

// =======================================================================
//                    ENDPOINT VENTA RÁPIDA (MOSTRADOR)
// =======================================================================

app.post('/api/venta-rapida', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const { items, forma_pago, monto_recibido, observaciones, id_estado } = req.body;

    // Validaciones básicas
    if (!items || items.length === 0) {
        return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    }


    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Calcular total
        let total = 0;
        for (const item of items) {
            total += parseFloat(item.cantidad) * parseFloat(item.precio_unitario);
        }

        // Obtener configuración de stock negativo
        const configRes = await client.query(
            'SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2',
            [id_empresa, 'permitir_stock_negativo']
        );
        const permitirStockNegativo = configRes.rows[0]?.valor === 'true';

        // Cliente por defecto: "Consumidor Final"
        let id_cliente = null;
        const clienteRes = await client.query(
            "SELECT id_cliente FROM clientes WHERE id_empresa = $1 AND razon_social = 'Consumidor Final'",
            [id_empresa]
        );
        
        if (clienteRes.rows.length > 0) {
            id_cliente = clienteRes.rows[0].id_cliente;
        } else {
            // Crear cliente "Consumidor Final" si no existe
            const nuevoClienteRes = await client.query(`
                INSERT INTO clientes (id_empresa, razon_social, id_condicion_iva, activo)
                VALUES ($1, 'Consumidor Final', 
                    (SELECT id_condicion_iva FROM condicionesiva WHERE nombre = 'Consumidor Final' LIMIT 1),
                    TRUE)
                RETURNING id_cliente`,
                [id_empresa]
            );
            id_cliente = nuevoClienteRes.rows[0].id_cliente;
        }

        // Crear pedido
        const pedidoQuery = `
INSERT INTO pedidos (id_empresa, id_cliente, id_usuario, id_estado, total, observaciones, fecha_creacion, token_publico)
VALUES ($1, $2, $3, $4, $5, $6, now(), md5(random()::text || clock_timestamp()::text))
RETURNING id_pedido, token_publico`;        
        const pedidoRes = await client.query(pedidoQuery, [
            id_empresa,
            id_cliente,
            id_usuario,
            id_estado || 1,
            total,
            observaciones || 'Venta rápida - Mostrador'
        ]);
        
        const id_pedido = pedidoRes.rows[0].id_pedido;

        // Procesar items
        for (const item of items) {
            const cantidad = parseFloat(item.cantidad);
            const precio_unitario = parseFloat(item.precio_unitario);

            // Validar stock si no se permite negativo
            if (!permitirStockNegativo) {
                const stockRes = await client.query(
                    'SELECT stock_real FROM inventario WHERE id_empresa = $1 AND id_producto = $2',
                    [id_empresa, item.id_producto]
                );
                
                const stockActual = stockRes.rows[0]?.stock_real || 0;
                
                if (stockActual < cantidad) {
                    await client.query('ROLLBACK');
                    return res.status(409).json({
                        error: `Stock insuficiente para "${item.nombre}". Disponible: ${stockActual}, Solicitado: ${cantidad}`
                    });
                }
            }

            // Insertar item del pedido
            const subtotal = cantidad * precio_unitario;
            const iva = subtotal * 0.21;
            const total_linea = subtotal + iva;

            await client.query(`
                INSERT INTO pedidoitems (
                    id_pedido, id_producto, cantidad, precio_unitario_congelado,
                    porcentaje_descuento, iva_aplicado, monto_iva, total_linea
                ) VALUES ($1, $2, $3, $4, 0, 21.00, $5, $6)`,
                [id_pedido, item.id_producto, cantidad, precio_unitario, iva, total_linea]
            );

            // Descontar del inventario
            await client.query(`
                INSERT INTO inventario (id_empresa, id_producto, stock_real)
                VALUES ($1, $2, $3)
                ON CONFLICT (id_empresa, id_producto)
                DO UPDATE SET stock_real = inventario.stock_real - $4`,
                [id_empresa, item.id_producto, -cantidad, cantidad]
            );
        }

        // Obtener turno de caja abierto (asumiendo caja 1)
        const turnoRes = await client.query(
            "SELECT id_turno FROM turnos_caja WHERE id_caja = 1 AND estado = 'abierto' ORDER BY fecha_apertura DESC LIMIT 1"
        );

        let id_turno = null;
        if (turnoRes.rows.length > 0) {
            id_turno = turnoRes.rows[0].id_turno;
        }

        // Registrar pago
        if (id_turno) {
            // Obtener número de recibo
            const numeroRes = await client.query(
                'SELECT COALESCE(MAX(numero_recibo), 0) + 1 as proximo FROM recibos WHERE id_empresa = $1',
                [id_empresa]
            );
            const numero_recibo = numeroRes.rows[0].proximo;

            // Crear recibo
            const reciboQuery = `
                INSERT INTO recibos (
                    id_empresa, id_turno, id_cliente, id_pedido, id_usuario,
                    numero_recibo, total_recibo, id_moneda_recibo, concepto
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'Venta Rápida - Mostrador')
                RETURNING id_recibo`;

            const reciboRes = await client.query(reciboQuery, [
                id_empresa, id_turno, id_cliente, id_pedido, id_usuario,
                numero_recibo, total
            ]);

            const id_recibo = reciboRes.rows[0].id_recibo;

            // Obtener ID de forma de pago
            const formaPagoMap = {
                'efectivo': 1,
                'debito': 2,
                'credito': 3,
                'transferencia': 4
            };
            const id_forma_pago = formaPagoMap[forma_pago] || 1;

            // Insertar item de pago
            await client.query(`
                INSERT INTO recibo_items (
                    id_recibo, id_forma_pago, id_moneda, monto_original,
                    cotizacion_usada, monto_convertido, cuotas,
                    interes_aplicado, monto_interes, monto_con_interes
                ) VALUES ($1, $2, 1, $3, 1, $3, 1, 0, 0, $3)`,
                [id_recibo, id_forma_pago, total]
            );

            // Actualizar turno de caja si es efectivo
            if (forma_pago === 'efectivo') {
                await client.query(`
                    UPDATE turnos_caja
                    SET ingresos_efectivo_ars = ingresos_efectivo_ars + $1
                    WHERE id_turno = $2`,
                    [total, id_turno]
                );

                // Registrar movimiento de caja
                await client.query(`
                    INSERT INTO movimientos_caja (id_turno, id_usuario, id_recibo, tipo, id_moneda, monto, concepto)
                    VALUES ($1, $2, $3, 'ingreso', 1, $4, 'Venta Rápida')`,
                    [id_turno, id_usuario, id_recibo, total]
                );
            }
        }

        await client.query('COMMIT');

        res.status(201).json({
            success: true,
            message: 'Venta registrada exitosamente',
            id_pedido,
            total,
            vuelto: forma_pago === 'efectivo' ? (parseFloat(monto_recibido || 0) - total) : 0
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error en venta rápida:', error.message);
        res.status(500).json({ error: 'Error al procesar venta: ' + error.message });
    } finally {
        client.release();
    }
});

// =======================================================================
//                    ENDPOINT PARA OBTENER PERMISOS DEL USUARIO
// =======================================================================

// GET - Obtener permisos del usuario actual
app.get('/api/usuarios/mis-permisos', verificarToken, async (req, res) => {
    const rol = req.usuario.rol;
    
    try {
        const query = `
            SELECT permiso, activo
            FROM permisos_usuario
            WHERE rol = $1 AND activo = TRUE`;
        
        const { rows } = await pool.query(query, [rol]);
        
        // Convertir a objeto para fácil acceso
        const permisos = {};
        rows.forEach(row => {
            permisos[row.permiso] = row.activo;
        });
        
        res.json({
            rol: rol,
            permisos: permisos
        });
    } catch (error) {
        console.error('❌ Error al obtener permisos:', error);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
});


// =======================================================================
//                    GESTIÓN DE LISTAS DE PRECIOS
// =======================================================================

// GET - Listar TODAS las listas (activas e inactivas) - Solo admin
app.get('/api/admin/listas-precios', verificarToken, async (req, res) => {
    // Verificar que sea admin
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden gestionar listas' });
    }
    
    try {
        const query = `
            SELECT id_lista_precio, nombre, descripcion, activa
            FROM listasdeprecios
            ORDER BY id_lista_precio`;
        
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener todas las listas:', error);
        res.status(500).json({ error: 'Error al obtener listas' });
    }
});

// PUT - Activar/Desactivar lista de precios - Solo admin
app.put('/api/admin/listas-precios/:id', verificarToken, async (req, res) => {
    const id_lista_precio = parseInt(req.params.id, 10);
    const { activa } = req.body;
    
    // Verificar que sea admin
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden modificar listas' });
    }
    
    if (typeof activa !== 'boolean') {
        return res.status(400).json({ error: 'El campo activa debe ser true o false' });
    }
    
    try {
        const query = `
            UPDATE listasdeprecios
            SET activa = $1
            WHERE id_lista_precio = $2
            RETURNING *`;
        
        const { rows } = await pool.query(query, [activa, id_lista_precio]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Lista no encontrada' });
        }
        
        res.json({
            message: `Lista ${activa ? 'activada' : 'desactivada'} exitosamente`,
            lista: rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar lista:', error);
        res.status(500).json({ error: 'Error al actualizar lista' });
    }
});


// =======================================================================
//         MÓDULO DE HISTORIAL DE PRECIOS
// =======================================================================

// GET - Obtener historial de un producto
app.get('/api/productos/:id/historial-precios', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    const { meses = 6 } = req.query;

    try {
        const query = `
            SELECT * FROM obtener_historial_producto(
                $1, 
                CURRENT_DATE - INTERVAL '${parseInt(meses)} months'
            )`;
        
        const { rows } = await pool.query(query, [id_producto]);
        
        res.json({
            id_producto,
            total_cambios: rows.length,
            historial: rows
        });
    } catch (error) {
        console.error('❌ Error al obtener historial:', error.message);
        res.status(500).json({ error: 'Error al obtener historial de precios' });
    }
});

// GET - Ver últimos cambios de precios (todos los productos)
app.get('/api/historial-precios/recientes', verificarToken, async (req, res) => {
    const { limite = 50 } = req.query;

    try {
        const query = `
            SELECT * FROM v_historial_precios_completo
            LIMIT $1`;
        
        const { rows } = await pool.query(query, [parseInt(limite)]);
        
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener cambios recientes:', error.message);
        res.status(500).json({ error: 'Error al obtener cambios recientes' });
    }
});

// PUT - Actualizar precio (registra automáticamente en historial)
app.put('/api/productos/:id/precio', verificarToken, async (req, res) => {
    const id_producto = parseInt(req.params.id, 10);
    const id_usuario = req.usuario.id_usuario;
    const { id_lista_precio, precio_nuevo, motivo } = req.body;

    if (!precio_nuevo || !id_lista_precio) {
        return res.status(400).json({ error: 'Precio y lista de precios requeridos' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const precioAnterior = await client.query(
            'SELECT precio FROM precios WHERE id_producto = $1 AND id_lista_precio = $2',
            [id_producto, id_lista_precio]
        );

        const precio_viejo = precioAnterior.rows[0]?.precio || null;

        await client.query(
            'SELECT registrar_cambio_precio($1, $2, $3, $4, $5, $6, $7, $8)',
            [
                id_producto,
                id_lista_precio,
                precio_viejo,
                precio_nuevo,
                id_usuario,
                motivo || 'Actualización manual',
                'precio',
                'manual'
            ]
        );

        if (precio_viejo) {
            await client.query(
                'UPDATE precios SET precio = $1 WHERE id_producto = $2 AND id_lista_precio = $3',
                [precio_nuevo, id_producto, id_lista_precio]
            );
        } else {
            await client.query(
                'INSERT INTO precios (id_producto, id_lista_precio, precio) VALUES ($1, $2, $3)',
                [id_producto, id_lista_precio, precio_nuevo]
            );
        }

        await client.query('COMMIT');

        res.json({
            message: 'Precio actualizado exitosamente',
            precio_anterior: precio_viejo,
            precio_nuevo: precio_nuevo,
            variacion: precio_viejo ? ((precio_nuevo - precio_viejo) / precio_viejo * 100).toFixed(2) + '%' : 'N/A'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al actualizar precio:', error.message);
        res.status(500).json({ error: 'Error al actualizar precio' });
    } finally {
        client.release();
    }
});

// =======================================================================
//         MÓDULO DE MULTI-MONEDA
// =======================================================================

// GET - Obtener cotización actual
app.get('/api/cotizaciones/:codigo_moneda', verificarToken, async (req, res) => {
    const { codigo_moneda } = req.params;

    try {
        const query = `
            SELECT 
                m.codigo,
                m.nombre,
                m.simbolo,
                c.valor as cotizacion,
                c.fecha_cotizacion,
                c.hora_cotizacion
            FROM cotizaciones c
            JOIN monedas m ON c.id_moneda = m.id_moneda
            WHERE m.codigo = $1
            ORDER BY c.fecha_cotizacion DESC, c.hora_cotizacion DESC
            LIMIT 1`;
        
        const { rows } = await pool.query(query, [codigo_moneda.toUpperCase()]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No hay cotización disponible' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('❌ Error al obtener cotización:', error.message);
        res.status(500).json({ error: 'Error al obtener cotización' });
    }
});

// POST - Actualizar cotización
app.post('/api/cotizaciones', verificarToken, async (req, res) => {
    const { codigo_moneda, valor } = req.body;

    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Solo administradores pueden actualizar cotizaciones' });
    }

    if (!codigo_moneda || !valor) {
        return res.status(400).json({ error: 'Código de moneda y valor requeridos' });
    }

    try {
        const query = `
            INSERT INTO cotizaciones (id_moneda, valor, fecha_cotizacion, hora_cotizacion)
            SELECT id_moneda, $2, CURRENT_DATE, CURRENT_TIME
            FROM monedas WHERE codigo = $1
            RETURNING *`;
        
        const { rows } = await pool.query(query, [codigo_moneda.toUpperCase(), valor]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Moneda no encontrada' });
        }
        
        res.json({
            message: 'Cotización actualizada',
            cotizacion: rows[0]
        });
    } catch (error) {
        console.error('❌ Error al actualizar cotización:', error.message);
        res.status(500).json({ error: 'Error al actualizar cotización' });
    }
});

// GET - Convertir monto entre monedas
app.get('/api/convertir-moneda', verificarToken, async (req, res) => {
    const { monto, de, a } = req.query;

    if (!monto || !de || !a) {
        return res.status(400).json({ error: 'Parámetros monto, de y a son requeridos' });
    }

    try {
        const result = await pool.query(
            'SELECT convertir_moneda($1, $2, $3) as monto_convertido',
            [parseFloat(monto), de.toUpperCase(), a.toUpperCase()]
        );

        res.json({
            monto_original: parseFloat(monto),
            moneda_origen: de.toUpperCase(),
            moneda_destino: a.toUpperCase(),
            monto_convertido: parseFloat(result.rows[0].monto_convertido)
        });
    } catch (error) {
        console.error('❌ Error al convertir:', error.message);
        res.status(500).json({ error: 'Error al convertir moneda' });
    }
});

// =======================================================================
//                    ENDPOINTS DE HISTORIAL DE PRECIOS
// =======================================================================

// GET - Historial de precios de un producto para un cliente
app.get('/api/historial-precios/:id_producto/:id_cliente', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_producto = parseInt(req.params.id_producto, 10);
    const id_cliente = parseInt(req.params.id_cliente, 10);
    
    try {
        const query = `
            SELECT * FROM vista_historial_precios
            WHERE id_empresa = $1 AND id_producto = $2 AND id_cliente = $3
            ORDER BY fecha DESC LIMIT 50`;
        
        const { rows } = await pool.query(query, [id_empresa, id_producto, id_cliente]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener historial:', error.message);
        res.status(500).json({ error: 'Error al obtener historial de precios' });
    }
});


// ========================================================================
//              TAREA AUTOMÁTICA: LIMPIAR PEDIDOS SUSPENDIDOS VIEJOS
// ========================================================================

// Ejecutar cada día a las 2 AM
cron.schedule('0 2 * * *', async () => {
    try {
        console.log('🧹 Ejecutando limpieza de pedidos suspendidos antiguos...');

        // Obtener días configurados (por defecto 30)
        const configRes = await pool.query(
            "SELECT valor FROM configuracion_sistema WHERE clave = 'dias_retener_suspendidos'"
        );
        const diasRetener = parseInt(configRes.rows[0]?.valor || '30');

        const query = `
            DELETE FROM pedidos 
            WHERE id_estado = 8 
            AND fecha_creacion < NOW() - INTERVAL '${diasRetener} days'
            RETURNING id_pedido
        `;

        const { rows } = await pool.query(query);

        if (rows.length > 0) {
            console.log(`✅ Eliminados ${rows.length} pedidos suspendidos antiguos`);
        }
    } catch (error) {
        console.error('❌ Error en limpieza automática:', error.message);
    }
});







// ENDPOINT: Crear presupuesto
app.post('/api/presupuestos', verificarToken, async (req, res) => {
    try {
        const { id_cliente, items, fecha_vencimiento, condiciones_pago, observaciones } = req.body;
        
        if (!id_cliente || !items || items.length === 0) {
            return res.status(400).json({ error: 'Cliente e items son requeridos' });
        }

        let subtotal = 0, totalIVA = 0;
        for (const item of items) {
            const precioUnit = parseFloat(item.precio_unitario || 0);
            const cantidad = parseFloat(item.cantidad || 0);
            const descuento = parseFloat(item.descuento_porcentaje || 0);
            
            const subtotalItem = precioUnit * cantidad;
            const descuentoMonto = subtotalItem * (descuento / 100);
            const neto = subtotalItem - descuentoMonto;
            const iva = neto * 0.21;
            
            subtotal += neto;
            totalIVA += iva;
        }

        const total = subtotal + totalIVA;

        const presupRes = await pool.query(
            `INSERT INTO presupuestos(id_empresa, id_cliente, id_usuario, subtotal, total_iva, total,
                fecha_vencimiento, estado, condiciones_pago, observaciones)
            VALUES (1, $1, $2, $3, $4, $5, $6, 'pendiente', $7, $8)
            RETURNING id_presupuesto, numero_presupuesto`,
            [id_cliente, req.usuario.id_usuario, subtotal, totalIVA, total,
             fecha_vencimiento, condiciones_pago || '', observaciones || '']
        );

        const id_presupuesto = presupRes.rows[0].id_presupuesto;

        for (const item of items) {
            await pool.query(
                `INSERT INTO presupuesto_items(id_presupuesto, id_producto, cantidad, precio_unitario, descuento_porcentaje)
                VALUES ($1, $2, $3, $4, $5)`,
                [id_presupuesto, item.id_producto, item.cantidad, item.precio_unitario, item.descuento_porcentaje || 0]
            );
        }

        res.status(201).json({ message: 'Presupuesto creado', id_presupuesto, total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: Validar stock
app.get('/api/productos/:id/stock', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id_producto, nombre, sku, 
                    COALESCE(i.cantidad, 0) as stock_actual,
                    CASE WHEN COALESCE(i.cantidad, 0) <= 0 THEN 'SIN_STOCK'
                         WHEN COALESCE(i.cantidad, 0) <= 10 THEN 'BAJO_STOCK'
                         ELSE 'OK' END as estado
            FROM productos p
            LEFT JOIN inventario i ON p.id_producto = i.id_producto
            WHERE p.id_producto = $1`,
            [req.params.id]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: Historial de precios (ahora funciona porque la tabla existe)
app.get('/api/productos/:id/historial-precios', verificarToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id_historial, id_producto, precio_anterior, precio_nuevo, fecha_cambio,
                    ROUND(((precio_nuevo - precio_anterior) / NULLIF(precio_anterior, 0) * 100)::numeric, 2) as porcentaje_cambio
            FROM historial_precios_ventas
            WHERE id_producto = $1
            ORDER BY fecha_cambio DESC
            LIMIT 50`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║             🚀 ERP LAGO - SERVIDOR INICIADO                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Puerto:              ${PORT}                                      ║
║  Entorno:             ${process.env.NODE_ENV || 'development'}                          ║
║  Base de datos:       ${process.env.DB_DATABASE}                          ║
║  Rate limiting:       ✅ ACTIVADO (10 intentos/15min)          ║
║  Stock negativo:      🔧 CONFIGURABLE por empresa             ║
║  CORS:                ${process.env.FRONTEND_URL || '* (todos los orígenes)'}             ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});

// ======================================
// SERVIR ARCHIVOS ESTÁTICOS (Frontend)
// ======================================

// Ruta raíz redirige al login
app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// GET - Generar ticket de venta rápida
app.get('/api/pedidos/:id/ticket', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        const pedidoQuery = `
            SELECT p.*, c.razon_social as cliente, u.username as vendedor,
                   e.nombre as empresa, e.direccion, e.telefono
            FROM pedidos p
            JOIN clientes c ON p.id_cliente = c.id_cliente
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_pedido = $1 AND p.id_empresa = $2`;
        
        const pedidoRes = await pool.query(pedidoQuery, [id_pedido, id_empresa]);

        if (pedidoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const itemsQuery = `
            SELECT pi.*, pr.nombre as producto
            FROM pedidoitems pi
            JOIN productos pr ON pi.id_producto = pr.id_producto
            WHERE pi.id_pedido = $1`;
        
        const itemsRes = await pool.query(itemsQuery, [id_pedido]);

        const pedido = pedidoRes.rows[0];
        const items = itemsRes.rows;

        // Generar HTML simple para ticket
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Ticket #${id_pedido}</title>
            <style>
                body { font-family: 'Courier New', monospace; width: 300px; margin: 0 auto; }
                .center { text-align: center; }
                .right { text-align: right; }
                table { width: 100%; border-collapse: collapse; }
                td { padding: 2px 0; }
                .line { border-top: 1px dashed #000; margin: 10px 0; }
                .bold { font-weight: bold; }
                @media print {
                    body { width: 80mm; }
                }
            </style>
        </head>
        <body onload="window.print()">
            <div class="center bold">${pedido.empresa}</div>
            <div class="center">${pedido.direccion}</div>
            <div class="center">${pedido.telefono}</div>
            <div class="line"></div>
            
            <div>Fecha: ${new Date(pedido.fecha || new Date()).toLocaleString('es-AR')}</div>
            <div>Ticket: #${id_pedido}</div>
            <div>Cliente: ${pedido.cliente}</div>
            <div>Vendedor: ${pedido.vendedor}</div>
            <div class="line"></div>
            
            <table>
                <thead>
                    <tr>
                        <td class="bold">Producto</td>
                        <td class="center bold">Cant</td>
                        <td class="right bold">Precio</td>
                        <td class="right bold">Total</td>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>${item.producto}</td>
                            <td class="center">${item.cantidad}</td>
                            <td class="right">$${parseFloat(item.precio_unitario_congelado).toFixed(2)}</td>
                            <td class="right">$${parseFloat(item.total_linea).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            
            <div class="line"></div>
            <div class="right bold">TOTAL: $${parseFloat(pedido.total).toFixed(2)}</div>
            <div class="line"></div>
            
            <div class="center">¡Gracias por su compra!</div>
            <div class="center">SIN VALIDEZ FISCAL</div>
        </body>
        </html>
        `;

        res.send(html);

    } catch (error) {
        console.error('❌ Error al generar ticket:', error.message);
        res.status(500).json({ error: 'Error al generar ticket' });
    }
});


// =======================================================================
//                    VENTA RÁPIDA (SIMPLIFICADO)
// =======================================================================
app.get('/api/pedidos/suspendidos', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);

    try {
        const query = `
            SELECT 
                p.id_pedido,
                p.fecha_creacion,
                c.razon_social as cliente,
                p.total,
                p.observaciones,
                p.id_cliente,
                EXTRACT(EPOCH FROM (NOW() - p.fecha_creacion)) / 86400 AS dias_transcurridos
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            WHERE p.id_empresa = $1 
            AND p.id_estado = 8
            ORDER BY p.fecha_creacion DESC
            LIMIT 50
        `;

        const { rows } = await pool.query(query, [id_empresa]);

        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener pedidos suspendidos:', error.message);
        res.status(500).json({ error: 'Error al obtener pedidos suspendidos' });
    }
});

// GET - Recuperar pedido suspendido con sus items
app.get('/api/pedidos/:id/recuperar', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Obtener datos del pedido suspendido
        const queryPedido = `
            SELECT 
                p.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                pe.nombre as estado_nombre
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            WHERE p.id_pedido = $1 
            AND p.id_empresa = $2 
            AND p.id_estado = 8
        `;

        const resultPedido = await client.query(queryPedido, [id_pedido, id_empresa]);

        if (resultPedido.rows.length === 0) {
            if (client) await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado o no está suspendido' });
        }

        const pedido = resultPedido.rows[0];

        // Obtener items del pedido
        const queryItems = `
            SELECT 
                pi.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku,
                pi.precio_unitario_congelado as precio_unitario
            FROM pedidoitems pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item ASC
        `;

        const resultItems = await client.query(queryItems, [id_pedido]);

        // 🔄 CAMBIAR ESTADO del pedido en lugar de eliminarlo (para mantener integridad referencial)
        // Estado 99 = "Recuperado/Inactivo" - Ya no aparece en lista de suspendidos
        await client.query(
            'UPDATE pedidos SET id_estado = 99 WHERE id_pedido = $1 AND id_empresa = $2',
            [id_pedido, id_empresa]
        );

        await client.query('COMMIT');

        console.log(`✅ Pedido #${id_pedido} recuperado correctamente (estado cambiado a Recuperado)`);

        // Construir respuesta completa
        const pedidoCompleto = {
            ...pedido,
            items: resultItems.rows
        };

        res.json(pedidoCompleto);
    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('❌ Error al recuperar pedido suspendido:', error.message);
        res.status(500).json({ error: 'Error al recuperar pedido suspendido' });
    } finally {
        if (client) client.release();
    }
});


// GET - Obtener pedido completo por ID (para ver-pedido.html)
app.get('/api/pedidos/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        // Obtener datos del pedido
        const queryPedido = `
            SELECT 
                p.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                c.cuit_cuil as cliente_cuit,
                pe.nombre as estado_nombre,
                u.username as usuario_nombre
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_pedido = $1 
            AND p.id_empresa = $2
        `;

        const resultPedido = await pool.query(queryPedido, [id_pedido, id_empresa]);

        if (resultPedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = resultPedido.rows[0];

        // Obtener items del pedido
        const queryItems = `
            SELECT 
                pi.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku
            FROM pedidoitems pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item ASC
        `;

        const resultItems = await pool.query(queryItems, [id_pedido]);

        // Construir respuesta completa
        const pedidoCompleto = {
            ...pedido,
            items: resultItems.rows
        };

        res.json(pedidoCompleto);
    } catch (error) {
        console.error('❌ Error al obtener pedido:', error.message);
        res.status(500).json({ error: 'Error al obtener pedido' });
    }
});
// PUT - Confirmar pedido suspendido (convertir a estado Confirmado)
app.put('/api/pedidos/:id/confirmar', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        // Verificar que el pedido esté suspendido
        const queryVerificar = `
            SELECT id_pedido, id_estado 
            FROM pedidos 
            WHERE id_pedido = $1 
            AND id_empresa = $2 
            AND id_estado = 8
        `;

        const { rows } = await pool.query(queryVerificar, [id_pedido, id_empresa]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Pedido suspendido no encontrado' });
        }

        // Actualizar estado a 'Confirmado' (id_estado = 2)
        const queryActualizar = `
            UPDATE pedidos 
            SET id_estado = 2,
                fecha_creacion = NOW()
            WHERE id_pedido = $1
            RETURNING *
        `;

        const result = await pool.query(queryActualizar, [id_pedido]);

        res.json({ 
            message: 'Pedido confirmado correctamente',
            pedido: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Error al confirmar pedido:', error.message);
        res.status(500).json({ error: 'Error al confirmar pedido' });
    }
});

// DELETE - Eliminar pedido suspendido
app.delete('/api/pedidos/suspendidos/:id', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // Verificar que el pedido esté suspendido
        const queryVerificar = `
            SELECT id_pedido, id_estado 
            FROM pedidos 
            WHERE id_pedido = $1 
            AND id_empresa = $2
        `;

        const { rows } = await client.query(queryVerificar, [id_pedido, id_empresa]);

        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        if (rows[0].id_estado !== 8) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Solo se pueden eliminar pedidos suspendidos' });
        }

        // Eliminar items del pedido
        await client.query('DELETE FROM pedidoitems WHERE id_pedido = $1', [id_pedido]);

        // Eliminar el pedido
        await client.query('DELETE FROM pedidos WHERE id_pedido = $1', [id_pedido]);

        await client.query('COMMIT');
        
        res.json({ 
            message: 'Pedido suspendido eliminado correctamente',
            id_pedido: id_pedido
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al eliminar pedido suspendido:', error.message);
        res.status(500).json({ error: 'Error al eliminar pedido suspendido' });
    } finally {
        client.release();
    }
});
// ============================================
// ENDPOINTS PARA PEDIDOS: PDF, EMAIL, WHATSAPP
// Agregar después de la línea 7082 en server.js
// (después del DELETE /api/pedidos/suspendidos/:id)
// ============================================

// ===== GET - Generar PDF de pedido =====
app.get('/api/pedidos/:id/pdf', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        // Obtener datos del pedido con información completa
        const queryPedido = `
            SELECT 
                p.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                c.cuit_cuil as cliente_cuit,
                c.telefono as cliente_telefono,
                c.email as cliente_email,
                pe.nombre as estado_nombre,
                u.username as usuario_nombre,
                e.razon_social as empresa_razon_social,
                e.nombre_fantasia as empresa_nombre_fantasia,
                e.domicilio_fiscal as empresa_domicilio,
                e.cuit as empresa_cuit,
                e.telefono as empresa_telefono,
                e.email as empresa_email
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN usuarios u ON p.id_usuario = u.id_usuario
            LEFT JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `;

        const resultPedido = await pool.query(queryPedido, [id_pedido, id_empresa]);

        if (resultPedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = resultPedido.rows[0];

        // Obtener items del pedido
        const queryItems = `
            SELECT 
                pi.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku
            FROM pedidoitems pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item ASC
        `;

        const resultItems = await pool.query(queryItems, [id_pedido]);

        // Construir datos completos para el PDF
        const pedidoData = {
            ...pedido,
            items: resultItems.rows
        };

        // Generar PDF usando pdfGenerator
        pdfGenerator.generarPedidoPDF(pedidoData, (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF de pedido:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            // Enviar PDF
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=pedido_${id_pedido}.pdf`);
            res.send(pdfBuffer);
        });

    } catch (error) {
        console.error('❌ Error al generar PDF de pedido:', error.message);
        res.status(500).json({ error: 'Error al generar PDF de pedido' });
    }
});

// ===== POST - Enviar pedido por email =====
app.post('/api/pedidos/:id/email', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);
    const { email_destino, asunto, mensaje } = req.body;

    try {
        // Obtener datos del pedido
        const queryPedido = `
            SELECT 
                p.*,
                c.razon_social as cliente_nombre,
                c.domicilio as cliente_direccion,
                c.cuit_cuil as cliente_cuit,
                c.email as cliente_email,
                pe.nombre as estado_nombre,
                e.razon_social as empresa_razon_social,
                e.nombre_fantasia as empresa_nombre_fantasia,
                e.domicilio_fiscal as empresa_domicilio,
                e.cuit as empresa_cuit,
                e.telefono as empresa_telefono,
                e.email as empresa_email
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `;

        const resultPedido = await pool.query(queryPedido, [id_pedido, id_empresa]);

        if (resultPedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = resultPedido.rows[0];

        // Validar email destino
        const emailFinal = email_destino || pedido.cliente_email;
        if (!emailFinal) {
            return res.status(400).json({ error: 'El cliente no tiene email registrado. Proporcione un email destino.' });
        }

        // Obtener items
        const queryItems = `
            SELECT 
                pi.*,
                p.nombre as producto_nombre,
                p.sku as producto_sku
            FROM pedidoitems pi
            LEFT JOIN productos p ON pi.id_producto = p.id_producto
            WHERE pi.id_pedido = $1
            ORDER BY pi.id_item ASC
        `;

        const resultItems = await pool.query(queryItems, [id_pedido]);

        const pedidoData = {
            ...pedido,
            items: resultItems.rows
        };

        // Generar PDF
        pdfGenerator.generarPedidoPDF(pedidoData, async (err, pdfBuffer) => {
            if (err) {
                console.error('❌ Error al generar PDF para email:', err);
                return res.status(500).json({ error: 'Error al generar PDF' });
            }

            try {
                // Calcular total
                const total = parseFloat(pedido.total || 0).toFixed(2);

                // Asunto por defecto
                const asuntoFinal = asunto || `Pedido #${id_pedido} - ${pedido.empresa_razon_social || 'ERP LAGO'}`;

                // Mensaje por defecto
                const mensajeHTML = mensaje || `
                    <h2>Pedido #${id_pedido}</h2>
                    <p>Estimado/a <strong>${pedido.cliente_nombre || 'Cliente'}</strong>,</p>
                    <p>Adjuntamos el pedido solicitado.</p>
                    <p><strong>Fecha:</strong> ${new Date(pedido.fecha_creacion).toLocaleDateString('es-AR')}</p>
                    <p><strong>Estado:</strong> ${pedido.estado_nombre || 'Pendiente'}</p>
                    <p><strong>Total:</strong> $${total}</p>
                    ${pedido.observaciones ? `<p><strong>Observaciones:</strong> ${pedido.observaciones}</p>` : ''}
                    <br>
                    <p>Saludos cordiales,<br>
                    ${pedido.empresa_razon_social || 'ERP LAGO'}</p>
                `;

                // Enviar email usando el generador
                await generador.enviarEmail(
                    emailFinal,
                    asuntoFinal,
                    mensajeHTML,
                    [{
                        filename: `pedido_${id_pedido}.pdf`,
                        content: pdfBuffer
                    }]
                );

                res.json({ 
                    success: true, 
                    message: 'Email enviado correctamente',
                    destinatario: emailFinal
                });

            } catch (emailError) {
                console.error('❌ Error al enviar email:', emailError);
                res.status(500).json({ error: 'Error al enviar email: ' + emailError.message });
            }
        });

    } catch (error) {
        console.error('❌ Error al enviar pedido por email:', error.message);
        res.status(500).json({ error: 'Error al enviar email de pedido' });
    }
});

// ===== GET - Generar link de WhatsApp para pedido =====
app.get('/api/pedidos/:id/whatsapp', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_pedido = parseInt(req.params.id, 10);

    try {
        // Obtener datos del pedido
        const queryPedido = `
            SELECT 
                p.*,
                c.razon_social as cliente_nombre,
                c.telefono as cliente_telefono,
                c.domicilio as cliente_direccion,
                pe.nombre as estado_nombre,
                e.razon_social as empresa_razon_social
            FROM pedidos p
            LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
            LEFT JOIN pedidoestados pe ON p.id_estado = pe.id_estado
            LEFT JOIN empresas e ON p.id_empresa = e.id_empresa
            WHERE p.id_pedido = $1 AND p.id_empresa = $2
        `;

        const resultPedido = await pool.query(queryPedido, [id_pedido, id_empresa]);

        if (resultPedido.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }

        const pedido = resultPedido.rows[0];

        // Validar teléfono
        // Validar teléfono
        if (!pedido.cliente_telefono) {
            // No tiene teléfono - devolver info para que el frontend pida el número
            return res.json({
                success: true,
                requiere_telefono: true,
                pedido: {
                    id: id_pedido,
                    cliente: pedido.cliente_nombre,
                    token_publico: pedido.token_publico,
                    total: parseFloat(pedido.total || 0).toFixed(2)
                }
            });
        }


        // Formatear teléfono (eliminar espacios, guiones, etc)
        let telefono = pedido.cliente_telefono.replace(/\D/g, '');
        
        // Agregar código de país si no lo tiene (Argentina: 54)
        if (!telefono.startsWith('54') && telefono.length === 10) {
            telefono = '54' + telefono;
        }

        // Calcular total
        const total = parseFloat(pedido.total || 0).toFixed(2);

        // Crear mensaje de WhatsApp
        const mensaje = `
*Pedido #${id_pedido}*

Hola ${pedido.cliente_nombre || 'Cliente'}!

Le enviamos el detalle de su pedido:

📅 *Fecha:* ${new Date(pedido.fecha_creacion).toLocaleDateString('es-AR')}
📊 *Estado:* ${pedido.estado_nombre || 'Pendiente'}
💰 *Total:* $${total}

${pedido.observaciones ? `📝 *Observaciones:* ${pedido.observaciones}

` : ''}Para más detalles, puede visualizar su pedido en:
${req.protocol}://${req.get('host')}/ver-pedido-publico.html?token=${pedido.token_publico}

Saludos,
${pedido.empresa_razon_social || 'ERP LAGO'}
        `.trim();

        // Generar link de WhatsApp
        const whatsappLink = `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`;

        res.json({
            success: true,
            telefono: pedido.cliente_telefono,
            whatsapp_link: whatsappLink,
            mensaje: mensaje
        });

    } catch (error) {
        console.error('❌ Error al generar link de WhatsApp:', error.message);
        res.status(500).json({ error: 'Error al generar link de WhatsApp' });
    }
});

// =======================================================================
//                    ENDPOINT: VERIFICAR PERMISOS
// =======================================================================
app.get('/api/permisos-usuario', verificarToken, async (req, res) => {
    const rol = req.usuario.rol;
    
    try {
        // Obtener permisos del rol
        const query = `
            SELECT permiso 
            FROM permisos_usuario 
            WHERE rol = $1 AND activo = TRUE`;
        
        const { rows } = await pool.query(query, [rol]);
        
        const permisos = rows.map(r => r.permiso);
        
        res.json({
            rol: rol,
            permisos: permisos,
            puede_cambiar_lista_precios: permisos.includes('cambiar_lista_precios'),
            puede_vender_sin_stock: permisos.includes('venta_sin_stock'),
            puede_ver_costos: permisos.includes('ver_costos'),
            puede_modificar_precios: permisos.includes('modificar_precios')
        });
        
    } catch (error) {
        console.error('Error al obtener permisos:', error.message);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
});

// =======================================================================
//                    ENDPOINT: CONFIGURACIÓN CON PERMISOS
// =======================================================================
app.get('/api/configuracion-usuario', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = req.usuario.id_usuario;
    const rol = req.usuario.rol;
    
    try {
        // Obtener permisos
        const permisosQuery = `
            SELECT permiso 
            FROM permisos_usuario 
            WHERE rol = $1 AND activo = TRUE`;
        const permisosRes = await pool.query(permisosQuery, [rol]);
        const permisos = permisosRes.rows.map(r => r.permiso);
        
        // Obtener configuración del usuario
        const configQuery = `
            SELECT 
                COALESCE(uc.id_lista_precio_predeterminada, 1) as id_lista_precio,
                COALESCE(ce.valor, 'false') as permitir_venta_sin_stock
            FROM usuarios u
            LEFT JOIN usuario_configuracion uc ON u.id_usuario = uc.id_usuario
            LEFT JOIN configuraciones_empresa ce ON ce.id_empresa = u.id_empresa 
                AND ce.clave = 'permitir_stock_negativo'
            WHERE u.id_usuario = $1`;
        
        const configRes = await pool.query(configQuery, [id_usuario]);
        
        const config = configRes.rows[0] || {
            id_lista_precio: 1,
            permitir_venta_sin_stock: 'false'
        };
        
        res.json({
            id_lista_precio: parseInt(config.id_lista_precio),
            permitir_venta_sin_stock: config.permitir_venta_sin_stock === 'true',
            permisos: {
                puede_cambiar_lista_precios: permisos.includes('cambiar_lista_precios'),
                puede_vender_sin_stock: permisos.includes('venta_sin_stock'),
                puede_ver_costos: permisos.includes('ver_costos'),
                puede_modificar_precios: permisos.includes('modificar_precios')
            },
            rol: rol
        });
        
    } catch (error) {
        console.error('Error al obtener configuración:', error.message);
        res.status(500).json({ error: 'Error al obtener configuración' });
    }
});



// =======================================================================
//                    MÓDULO DE ADMINISTRACIÓN DE USUARIOS
// =======================================================================

// Middleware para verificar que es admin
const verificarAdmin = (req, res, next) => {
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }
    next();
};

// GET - Listar todos los usuarios de la empresa
app.get('/api/admin/usuarios', verificarToken, verificarAdmin, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    
    try {
        const query = `
            SELECT u.id_usuario, u.username, u.email, u.rol, u.estado,
                   u.fecha_creacion,
                   uc.id_lista_precio_predeterminada
            FROM usuarios u
            LEFT JOIN usuario_configuracion uc ON u.id_usuario = uc.id_usuario
            WHERE u.id_empresa = $1
            ORDER BY u.fecha_creacion DESC`;
        
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('Error al listar usuarios:', error.message);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
});

// GET - Obtener roles disponibles
app.get('/api/admin/roles', verificarToken, verificarAdmin, async (req, res) => {
    try {
        const query = `SELECT DISTINCT rol FROM permisos_usuario ORDER BY rol`;
        const { rows } = await pool.query(query);
        res.json(rows.map(r => r.rol));
    } catch (error) {
        console.error('Error al obtener roles:', error.message);
        res.status(500).json({ error: 'Error al obtener roles' });
    }
});

// GET - Obtener permisos de un rol
app.get('/api/admin/permisos/:rol', verificarToken, verificarAdmin, async (req, res) => {
    const { rol } = req.params;
    
    try {
        const query = `
            SELECT permiso, descripcion, activo
            FROM permisos_usuario
            WHERE rol = $1
            ORDER BY permiso`;
        
        const { rows } = await pool.query(query, [rol]);
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener permisos:', error.message);
        res.status(500).json({ error: 'Error al obtener permisos' });
    }
});

// POST - Crear usuario
app.post('/api/admin/usuarios', verificarToken, verificarAdmin, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const { username, email, password, rol } = req.body;
    
    if (!username || !password || !rol) {
        return res.status(400).json({ error: 'Username, password y rol son requeridos' });
    }
    
    try {
        const passwordHash = await bcrypt.hash(password, 10);
        
        const query = `
            INSERT INTO usuarios (id_empresa, username, email, password_hash, rol, estado)
            VALUES ($1, $2, $3, $4, $5, 'activo')
            RETURNING id_usuario, username, email, rol, estado`;
        
        const { rows } = await pool.query(query, [id_empresa, username, email, passwordHash, rol]);
        
        res.status(201).json({
            message: 'Usuario creado exitosamente',
            usuario: rows[0]
        });
    } catch (error) {
        console.error('Error al crear usuario:', error.message);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'El username ya existe' });
        }
        res.status(500).json({ error: 'Error al crear usuario' });
    }
});

// PUT - Actualizar usuario
app.put('/api/admin/usuarios/:id', verificarToken, verificarAdmin, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.params.id, 10);
    const { username, email, rol, estado, password } = req.body;
    
    try {
        let query, params;
        
        if (password) {
            const passwordHash = await bcrypt.hash(password, 10);
            query = `
                UPDATE usuarios
                SET username = $1, email = $2, rol = $3, estado = $4, password_hash = $5
                WHERE id_usuario = $6 AND id_empresa = $7
                RETURNING id_usuario, username, email, rol, estado`;
            params = [username, email, rol, estado, passwordHash, id_usuario, id_empresa];
        } else {
            query = `
                UPDATE usuarios
                SET username = $1, email = $2, rol = $3, estado = $4
                WHERE id_usuario = $5 AND id_empresa = $6
                RETURNING id_usuario, username, email, rol, estado`;
            params = [username, email, rol, estado, id_usuario, id_empresa];
        }
        
        const { rows } = await pool.query(query, params);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json({
            message: 'Usuario actualizado exitosamente',
            usuario: rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar usuario:', error.message);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

// PUT - Actualizar permisos de un rol
app.put('/api/admin/permisos/:rol/:permiso', verificarToken, verificarAdmin, async (req, res) => {
    const { rol, permiso } = req.params;
    const { activo } = req.body;
    
    try {
        const query = `
            UPDATE permisos_usuario
            SET activo = $1
            WHERE rol = $2 AND permiso = $3
            RETURNING *`;
        
        const { rows } = await pool.query(query, [activo, rol, permiso]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Permiso no encontrado' });
        }
        
        res.json({
            message: 'Permiso actualizado exitosamente',
            permiso: rows[0]
        });
    } catch (error) {
        console.error('Error al actualizar permiso:', error.message);
        res.status(500).json({ error: 'Error al actualizar permiso' });
    }
});

// DELETE - Desactivar usuario
app.delete('/api/admin/usuarios/:id', verificarToken, verificarAdmin, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    const id_usuario = parseInt(req.params.id, 10);
    
    try {
        const query = `
            UPDATE usuarios
            SET estado = 'inactivo'
            WHERE id_usuario = $1 AND id_empresa = $2
            RETURNING username`;
        
        const { rows } = await pool.query(query, [id_usuario, id_empresa]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }
        
        res.json({
            message: `Usuario ${rows[0].username} desactivado exitosamente`
        });
    } catch (error) {
        console.error('Error al desactivar usuario:', error.message);
        res.status(500).json({ error: 'Error al desactivar usuario' });
    }
});
