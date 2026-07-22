const express = require('express');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const compression = require("compression");
app.use(compression());
app.use((req, res, next) => { const o = req.headers.origin; if (o && (o.includes('claude.ai') || o.includes('anthropic.com'))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Credentials', 'true'); if (req.method === 'OPTIONS') return res.sendStatus(204); } next(); });
app.use((req, res, next) => { const o = req.headers.origin; if (o && (o.includes('claude.ai') || o.includes('anthropic.com'))) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS'); res.setHeader('Access-Control-Allow-Credentials', 'true'); if (req.method === 'OPTIONS') return res.sendStatus(204); } next(); });
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// ═══════════════════════════════════════════════════════════════════════════
// Factura-foto: acceso público (la app maneja su propia auth con token)
app.get('/factura-foto.html', (req, res) => res.sendFile(require('path').join(__dirname, 'frontend', 'factura-foto.html')));
// CONTROL DE ACCESO HTML (server-side) — ANTES de express.static
// Intercepta *.html, verifica cookie JWT + permisos por rol.
// Si no es .html, pasa al siguiente middleware (express.static para assets).
// ═══════════════════════════════════════════════════════════════════════════
const { htmlAccessMiddleware } = require('./src/middleware/html-access.middleware');
app.use(htmlAccessMiddleware);

// Headers anti-cache para HTML
app.use((req, res, next) => {
    if (req.path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Assets estáticos (JS, CSS, imágenes, fuentes) — SIN protección
// Los .html ya fueron interceptados arriba, acá solo llegan assets
app.use(express.static(path.join(__dirname, 'frontend')));

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE GLOBAL: Auth + Control de Acceso a Módulos para APIs
// Se aplica a TODAS las rutas /api/* excepto login
// ═══════════════════════════════════════════════════════════════════════════
const { verificarToken } = require('./src/middleware/auth.middleware');
const { verificarAccesoModulo } = require('./src/middleware/modulo-access.middleware');

app.use('/api', (req, res, next) => {
    // Rutas públicas que no requieren autenticación de staff
    if (req.path === '/auth/login' || req.path === '/usuarios/login') return next();
    if (req.path === '/health') return next();  // heartbeat publico (sin auth, sin DB)

    // Modulo WEB (clientes externos): tiene su propio middleware (auth-web).
    // /api/web/*  -> catalogo, auth web, carrito, mis-pedidos, checkout
    // El admin del modulo web SI usa auth de staff: /api/admin/pedidos-web/*
    if (req.path.startsWith('/web/') || req.path === '/web') return next();

    // 1. Verificar token JWT → setea req.usuario
    verificarToken(req, res, () => {
        // 2. Verificar acceso al módulo según rol
        verificarAccesoModulo(req, res, next);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// RUTAS API
// ═══════════════════════════════════════════════════════════════════════════
const apiRoutes = require('./src/routes/index');
app.use('/api', apiRoutes);

// Módulo Compras y Pagos: ahora montadas via src/routes/index.js

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Error interno' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
    console.log(`╔═══════════════════════════════════════╗
║   ✅ SERVIDOR ERP LAGO INICIADO      ║
║   Puerto: ${PORT}                            ║
║   Estructura: MODULAR HÍBRIDA        ║
║   Control HTML: SERVER-SIDE ✅       ║
║   Control API:  MIDDLEWARE  ✅       ║
╚═══════════════════════════════════════╝`);
});
