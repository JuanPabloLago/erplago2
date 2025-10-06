// =======================================================================
// SERVIDOR BACKEND PRINCIPAL - ERP LAGO
// Tecnologías: Node.js, Express.js, PostgreSQL, bcrypt, jsonwebtoken
// =======================================================================

// 1. IMPORTACIONES Y CONFIGURACIÓN INICIAL
// -----------------------------------------------------------------------
require('dotenv').config(); // Cargar variables de entorno desde .env
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors'); // Necesario para permitir conexión desde el frontend

const app = express();
const PORT = process.env.DB_PORT_APP || 3000; // Usa 3000 si DB_PORT_APP no está definido
const JWT_SECRET = process.env.JWT_SECRET || 'mi-clave-secreta-erp'; // Clave para firmar JWT
const JWT_EXPIRATION = '1h'; // Token expira en 1 hora

// Configuración de conexión a PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// 2. MIDDLEWARES
// -----------------------------------------------------------------------
app.use(cors()); // Habilita CORS para todas las rutas
app.use(express.json()); // Permite al servidor entender JSON

// Configuración para servir archivos estáticos (el frontend)
app.use(express.static('frontend'));

// Ruta raíz que redirige automáticamente al login
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/frontend/login.html');
});


// 3. CONEXIÓN A LA BASE DE DATOS
// -----------------------------------------------------------------------
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error al conectar a PostgreSQL:', err.stack);
    }
    client.query('SELECT NOW()', (err, result) => {
        release(); // Liberar el cliente de la pool
        if (err) {
            return console.error('Error al ejecutar consulta de prueba:', err.stack);
        }
        console.log('Conexión a PostgreSQL exitosa!');
    });
});


// 4. FUNCIONES DE UTILIDAD Y SEGURIDAD
// -----------------------------------------------------------------------

/**
 * Middleware para verificar y decodificar el JWT (JSON Web Token).
 * Protege las rutas, asegurando que solo usuarios autenticados puedan acceder.
 */
function verificarToken(req, res, next) {
    // Buscar el token en el encabezado de autorización
    const authHeader = req.headers['authorization'];
    
    // El formato es "Bearer TOKEN", separamos el token
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        // 401: Unauthorized (no se envió token)
        return res.status(401).json({ mensaje: 'Acceso denegado. Token no proporcionado.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            // 403: Forbidden (token no válido o expirado)
            return res.status(403).json({ mensaje: 'Token inválido o expirado.' });
        }
        // El token es válido, adjuntamos los datos del usuario a la petición (req.usuario)
        req.usuario = user.usuario;
        next(); // Continuar con el siguiente middleware o la ruta
    });
}

/**
 * Función para registrar eventos de auditoría.
 */
async function registrarLog(id_usuario, accion, tabla_afectada, id_registro_afectado, valor_anterior = null, valor_nuevo = null) {
    try {
        // CORRECCIÓN CLAVE: Cambiado 'logsdecambios' por 'usuarios_logs'
        // para coincidir con la tabla existente en tu base de datos.
        await pool.query(
            `INSERT INTO usuarios_logs(id_usuario, accion, tabla_afectada, id_registro_afectado, valor_anterior, valor_nuevo)
             VALUES($1, $2, $3, $4, $5, $6)`,
            [
                id_usuario,
                accion,
                tabla_afectada,
                id_registro_afectado,
                valor_anterior ? JSON.stringify(valor_anterior) : null,
                valor_nuevo ? JSON.stringify(valor_nuevo) : null
            ]
        );
    } catch (error) {
        // Se mantiene el log de error, pero el servidor ya no debería caer por esto.
        console.error('ERROR AL REGISTRAR AUDITORÍA:', error.stack);
        // El error de log no debe detener la operación principal
    }
}


// 5. MÓDULOS DE API (Rutas CRUD)
// -----------------------------------------------------------------------

// --- MÓDULO DE USUARIOS Y AUTENTICACIÓN ---

// REGISTRO DE NUEVO USUARIO
app.post('/api/usuarios/registro', async (req, res) => {
    // Usamos 'username' según el esquema de tu DB
    const { username, email, password, nombre_completo, id_rol, id_empresa } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const nuevoUsuario = await pool.query(
            // ATENCIÓN: Usamos "username"
            `INSERT INTO usuarios (username, email, password_hash, nombre_completo, id_rol, id_empresa) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_usuario, username, email`,
            [username, email, hashedPassword, nombre_completo, id_rol, id_empresa]
        );
        // (Opcional) Registrar log de creación de usuario
        res.status(201).json(nuevoUsuario.rows[0]);
    } catch (err) {
        console.error('Error al registrar usuario:', err.stack);
        if (err.code === '23505') {
            return res.status(409).json({ mensaje: 'El usuario o email ya existe.' });
        }
        res.status(500).send('Error interno del servidor');
    }
});

// INICIO DE SESIÓN
app.post('/api/usuarios/login', async (req, res) => {
    // Usamos 'username' según el esquema de tu DB
    const { username, password } = req.body;
    try {
        // ATENCIÓN: Buscamos por "username"
        const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
        const usuario = result.rows[0];

        if (!usuario || usuario.estado !== 'activo') {
            return res.status(401).json({ mensaje: 'Credenciales inválidas o usuario inactivo.' });
        }

        const match = await bcrypt.compare(password, usuario.password_hash);
        if (!match) {
            return res.status(401).json({ mensaje: 'Credenciales inválidas.' });
        }

        // Generación del payload (datos incluidos en el token)
        const payload = {
            usuario: {
                id_usuario: usuario.id_usuario,
                // ATENCIÓN: Usamos 'username' en el token
                nombre_usuario: usuario.username, 
                id_rol: usuario.id_rol,
                id_empresa: usuario.id_empresa 
            }
        };

        // Firmamos el token
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

        // Registrar log de inicio de sesión exitoso
        // ESTA FUNCIÓN AHORA APUNTA A 'usuarios_logs'
        registrarLog(usuario.id_usuario, 'LOGIN_EXITOSO', 'usuarios', usuario.id_usuario);
        
        // Enviamos el token al cliente
        res.json({ token, id_empresa: usuario.id_empresa, username: usuario.username });

    } catch (err) {
        console.error('Error en login:', err.stack);
        res.status(500).send('Error interno del servidor');
    }
});


// --- RUTAS PROTEGIDAS DE EJEMPLO (Se requiere verificarToken) ---

// OBTENER TODOS LOS CLIENTES ASOCIADOS A LA EMPRESA DEL USUARIO LOGUEADO
app.get('/api/clientes', verificarToken, async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    try {
        const result = await pool.query('SELECT * FROM clientes WHERE id_empresa = $1 AND activo = TRUE', [id_empresa]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error al obtener clientes:', err.stack);
        res.status(500).send('Error interno del servidor');
    }
});

// CREAR UN NUEVO PRODUCTO
app.post('/api/productos', verificarToken, async (req, res) => {
    const { sku, nombre, descripcion } = req.body;
    const id_usuario = req.usuario.id_usuario;
    try {
        const result = await pool.query(
            `INSERT INTO productos (sku, nombre, descripcion) VALUES ($1, $2, $3) RETURNING *`,
            [sku, nombre, descripcion]
        );
        const nuevoProducto = result.rows[0];

        // Registrar log
        await registrarLog(id_usuario, 'CREAR_PRODUCTO', 'productos', nuevoProducto.id_producto, null, nuevoProducto);

        res.status(201).json(nuevoProducto);
    } catch (err) {
        console.error('Error al crear producto:', err.stack);
        res.status(500).send('Error interno del servidor');
    }
});


// 6. INICIAR EL SERVIDOR
// -----------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Express escuchando en http://0.0.0.0:${PORT}`);
});
