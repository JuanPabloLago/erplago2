# ⚡ INSTALACIÓN INMEDIATA - ESTRUCTURA MODULAR

**Tiempo estimado:** 10-15 minutos  
**Prerrequisitos:** Tener los archivos de `/mnt/user-data/outputs/modular/` disponibles

---

## 🚀 INSTALACIÓN EN 5 PASOS

### PASO 1: Preparar servidor (2 min)

```bash
cd /root/mi_erp

# Backup del server.js actual
cp server.js server.js.backup_modular_$(date +%Y%m%d_%H%M%S)

# Crear estructura de carpetas
mkdir -p config middleware routes controllers services utils

# Verificar
ls -la
```

### PASO 2: Copiar archivos base (3 min)

**Tenés que descargar los archivos de `/mnt/user-data/outputs/modular/` y copiarlos a tu servidor.**

#### Opción A: Copiar desde outputs (si tenés acceso)
```bash
# Copiar estructura completa
cp -r /mnt/user-data/outputs/modular/config/* config/
cp -r /mnt/user-data/outputs/modular/middleware/* middleware/
cp -r /mnt/user-data/outputs/modular/controllers/* controllers/
cp -r /mnt/user-data/outputs/modular/routes/* routes/
```

#### Opción B: Crear archivos manualmente (recomendado)

**A. config/database.js**
```bash
cat > config/database.js << 'EOF'
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

pool.on('error', (err) => {
    console.error('❌ Error inesperado en el pool de conexiones:', err);
    process.exit(-1);
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Error al conectar con la base de datos:', err.stack);
    } else {
        console.log('✅ Conexión a la base de datos exitosa:', res.rows[0].now);
    }
});

module.exports = pool;
EOF
```

**B. middleware/auth.middleware.js**
```bash
cat > middleware/auth.middleware.js << 'EOF'
const jwt = require('jsonwebtoken');

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

const verificarAdmin = (req, res, next) => {
    if (req.usuario.rol !== 'admin' && req.usuario.rol !== 'administrador') {
        return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }
    next();
};

module.exports = { verificarToken, verificarAdmin };
EOF
```

**C. controllers/auth.controller.js**
```bash
cat > controllers/auth.controller.js << 'EOF'
const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
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
};
EOF
```

**D. routes/auth.routes.js**
```bash
cat > routes/auth.routes.js << 'EOF'
const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/login', loginLimiter, authController.login);

module.exports = router;
EOF
```

**E. routes/index.js**
```bash
cat > routes/index.js << 'EOF'
const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');

router.use('/usuarios', authRoutes);

module.exports = router;
EOF
```

### PASO 3: Crear server.js híbrido (5 min)

Este server.js usará las rutas modulares NUEVAS y mantendrá las VIEJAS temporalmente:

```bash
cat > server-hibrido.js << 'ENDOFFILE'
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const afipService = require("./afip/afip-service");
const pdfGenerator = require('./pdf-generator');
const cron = require('node-cron');

dotenv.config();

if (!process.env.JWT_SECRET || !process.env.DB_PASSWORD) {
    console.error('❌ ERROR CRÍTICO: Variables faltantes');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('frontend', {
    maxAge: 0,
    etag: false,
    setHeaders: (res, path) => {
        if (path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

// RUTAS MODULARES NUEVAS
const routes = require('./routes');
app.use('/api', routes);

// RUTAS VIEJAS (TEMPORALES) - Cargar TODAS las demás rutas del server.js.old
// TODO: Ir moviendo estas rutas a sus módulos correspondientes
const pool = require('./config/database');
const { verificarToken, verificarAdmin } = require('./middleware/auth.middleware');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// Aquí irían TODAS las rutas del server.js viejo que NO están modularizadas
// Por ejemplo: clientes, productos, ventas, etc.
// (Copiarlas desde server.js.backup_modular_*)

// Ruta raíz
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/frontend/index.html');
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║         🚀 ERP LAGO - SERVIDOR HÍBRIDO INICIADO              ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║  Puerto:              ${PORT}                                      ║`);
    console.log(`║  Base de datos:       ${process.env.DB_DATABASE}                          ║`);
    console.log('║  Arquitectura:        🔄 HÍBRIDA (transición a modular)       ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
});

process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT recibido, cerrando servidor...');
    process.exit(0);
});

module.exports = app;
ENDOFFILE
```

### PASO 4: Integrar rutas viejas (3 min)

```bash
# Extraer solo las rutas del server.js viejo (sin imports ni configuración)
grep -A 1000 "// GET - Obtener un cliente" server.js.backup_modular_* | \
  grep -B 5000 "app.listen" > rutas_temporales.txt

# Editar server-hibrido.js y pegar las rutas después de la línea:
# "// Aquí irían TODAS las rutas del server.js viejo..."
nano server-hibrido.js
# Pegar todas las rutas viejas allí
```

### PASO 5: Probar y activar (2 min)

```bash
# Renombrar actual
mv server.js server.js.old

# Activar híbrido
cp server-hibrido.js server.js

# Reiniciar
source ~/.nvm/nvm.sh
pm2 restart erplago
pm2 logs erplago --lines 30

# Probar login (modular NUEVO)
curl -X POST http://localhost:3000/api/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tu_usuario","password":"tu_password"}'

# Si funciona, todo OK!
```

---

## ✅ VERIFICACIÓN

### 1. Servidor arranca sin errores
```bash
pm2 logs erplago | grep "SERVIDOR HÍBRIDO INICIADO"
```

### 2. Login funciona (ruta modular)
```bash
curl -X POST http://localhost:3000/api/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tu_usuario","password":"tu_password"}'
# Debe devolver: {"message":"Login exitoso","token":"...","usuario":{...}}
```

### 3. Rutas viejas funcionan
```bash
# Probar cualquier endpoint viejo (con token)
curl -H "Authorization: Bearer TU_TOKEN" \
  http://localhost:3000/api/clientes
```

---

## 🎯 ESTADO FINAL

Después de estos 5 pasos tenés:

```
✅ Estructura modular creada
✅ Módulo de auth funcionando (modular)
✅ Todas las demás rutas funcionando (temporal)
✅ Sistema híbrido estable
⏭️ Listo para modularizar el resto de a poco
```

---

## 📋 SIGUIENTE PASO

Lee `GUIA_MODULARIZACION_RAPIDA.md` para continuar modularizando los demás módulos uno por uno.

---

## ⚠️ TROUBLESHOOTING

### Error: "Cannot find module './routes'"
```bash
# Verificar que existe routes/index.js
ls -la routes/

# Si no existe, crear de nuevo
cat > routes/index.js << 'EOF'
const express = require('express');
const router = express.Router();
const authRoutes = require('./auth.routes');
router.use('/usuarios', authRoutes);
module.exports = router;
EOF
```

### Error: "pool is not defined"
```bash
# Asegurar que config/database.js existe y exporta correctamente
cat config/database.js | grep "module.exports"
```

### Servidor no arranca
```bash
# Ver logs completos
pm2 logs erplago --lines 100

# Verificar sintaxis
node -c server.js
```

---

**¡Listo!** En 10-15 minutos tenés la base modular funcionando. 🚀
