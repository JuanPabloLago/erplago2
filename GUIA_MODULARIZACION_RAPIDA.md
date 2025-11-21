# 🚀 GUÍA RÁPIDA DE MODULARIZACIÓN - ERP LAGO

**Estado actual:** Módulo de autenticación (auth) ya modularizado como ejemplo  
**Objetivo:** Modularizar los 13 módulos restantes siguiendo el mismo patrón

---

## 📦 ESTRUCTURA ACTUAL

```
/root/mi_erp/
├── server.js (NUEVO - modular, ~100 líneas)
├── server.js.old (VIEJO - monolítico, 7955 líneas)
├── /config/
│   └── database.js ✅
├── /middleware/
│   └── auth.middleware.js ✅
├── /controllers/
│   └── auth.controller.js ✅
├── /routes/
│   ├── index.js ✅
│   └── auth.routes.js ✅
└── /services/
    └── (vacío por ahora)
```

---

## 🎯 PATRÓN DE MODULARIZACIÓN

Para cada módulo (clientes, productos, ventas, etc.) seguir estos 3 pasos:

### PASO 1: Crear el Controller

```javascript
// controllers/MODULO.controller.js

const pool = require('../config/database');

// Exportar cada función como método del objeto exports
exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `SELECT * FROM tabla WHERE id_empresa = $1`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Error al listar' });
    }
};

exports.obtenerPorId = async (req, res) => {
    // ... lógica ...
};

exports.crear = async (req, res) => {
    // ... lógica ...
};

exports.actualizar = async (req, res) => {
    // ... lógica ...
};

exports.eliminar = async (req, res) => {
    // ... lógica ...
};
```

### PASO 2: Crear las Rutas

```javascript
// routes/MODULO.routes.js

const express = require('express');
const router = express.Router();
const moduloController = require('../controllers/MODULO.controller');
const { verificarToken, verificarAdmin } = require('../middleware/auth.middleware');

// GET /api/MODULO
router.get('/', verificarToken, moduloController.listar);

// GET /api/MODULO/:id
router.get('/:id', verificarToken, moduloController.obtenerPorId);

// POST /api/MODULO
router.post('/', verificarToken, moduloController.crear);

// PUT /api/MODULO/:id
router.put('/:id', verificarToken, moduloController.actualizar);

// DELETE /api/MODULO/:id
router.delete('/:id', verificarToken, moduloController.eliminar);

module.exports = router;
```

### PASO 3: Registrar en routes/index.js

```javascript
// routes/index.js

const moduloRoutes = require('./MODULO.routes');

// ...

router.use('/MODULO', moduloRoutes);
```

---

## 📋 LISTA DE MÓDULOS A CREAR

| # | Módulo | Rutas | Prioridad | Tiempo |
|---|--------|-------|-----------|--------|
| 1 | ✅ auth | 2 | HECHO | - |
| 2 | clientes | 18 | 🔴 ALTA | 30 min |
| 3 | productos | 15 | 🔴 ALTA | 25 min |
| 4 | ventas | 25 | 🔴 ALTA | 45 min |
| 5 | inventario | 8 | 🟠 MEDIA | 15 min |
| 6 | proveedores | 6 | 🟠 MEDIA | 12 min |
| 7 | compras | 12 | 🟠 MEDIA | 20 min |
| 8 | cajas | 10 | 🟠 MEDIA | 18 min |
| 9 | cobranzas | 15 | 🟠 MEDIA | 25 min |
| 10 | reportes | 15 | 🟢 BAJA | 25 min |
| 11 | afip | 8 | 🟠 MEDIA | 15 min |
| 12 | pdf | 12 | 🟢 BAJA | 20 min |
| 13 | notas | 6 | 🟢 BAJA | 12 min |
| 14 | admin | 8 | 🟢 BAJA | 15 min |

**Tiempo total estimado:** ~4-5 horas si se hace seguido

---

## ⚡ ESTRATEGIA RÁPIDA

### Opción A: Modularizar TODO de una vez (4-5 horas)
1. Dedicar 1 día completo
2. Ir módulo por módulo
3. Probar cada uno después de crearlo
4. Al final, eliminar server.js.old

### Opción B: Modularizar de a poco (2-3 semanas)
1. Hacer 1-2 módulos por día
2. Dejar convivir server.js nuevo con server.js.old
3. Ir migrando gradualmente
4. Cuando todo funcione, eliminar .old

### Opción C: Solo módulos críticos (1-2 horas)
1. Hacer solo: clientes, productos, ventas
2. Dejar el resto en server.js.old
3. Ya tendrías 70% del código modularizado

---

## 🛠️ WORKFLOW RECOMENDADO

```bash
# 1. Crear controller
nano controllers/clientes.controller.js
# Copiar funciones desde server.js.old
# Adaptar al formato exports.nombreFuncion

# 2. Crear routes
nano routes/clientes.routes.js
# Definir todas las rutas del módulo

# 3. Registrar en index
nano routes/index.js
# Agregar: const clientesRoutes = require('./clientes.routes');
# Agregar: router.use('/clientes', clientesRoutes);

# 4. Probar
pm2 restart erplago
pm2 logs erplago --lines 30

# 5. Test con curl
curl -H "Authorization: Bearer TU_TOKEN" \
  http://localhost:3000/api/clientes

# 6. Si funciona, commitear
git add controllers/clientes.controller.js routes/clientes.routes.js routes/index.js
git commit -m "Modularizado módulo de clientes"

# 7. Repetir con siguiente módulo
```

---

## 📝 EJEMPLO COMPLETO: MÓDULO CLIENTES

### 1. Identificar las rutas del módulo

Buscar en server.js.old:
```bash
grep -n "app\.\(get\|post\|put\|delete\).*'/api/clientes" server.js.old
```

Esto te dirá todas las líneas donde están definidas las rutas de clientes.

### 2. Extraer la lógica

Para cada ruta, copiar TODO el código de la función async en el controller.

Ejemplo, si en server.js.old tenés:

```javascript
app.get('/api/clientes', verificarToken, async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `SELECT * FROM clientes WHERE id_empresa = $1`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Error al listar clientes' });
    }
});
```

En controllers/clientes.controller.js poner:

```javascript
const pool = require('../config/database');

exports.listar = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const query = `SELECT * FROM clientes WHERE id_empresa = $1`;
        const { rows } = await pool.query(query, [id_empresa]);
        res.json(rows);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Error al listar clientes' });
    }
};
```

---

## ⚠️ ERRORES COMUNES A EVITAR

### Error 1: No importar el pool
```javascript
// ❌ MAL
exports.listar = async (req, res) => {
    const { rows } = await pool.query(...); // pool no está definido
};

// ✅ BIEN
const pool = require('../config/database');
exports.listar = async (req, res) => {
    const { rows } = await pool.query(...);
};
```

### Error 2: Ruta mal montada
```javascript
// ❌ MAL en routes/clientes.routes.js
router.get('/api/clientes', ...); // NO poner /api

// ✅ BIEN
router.get('/', ...); // Ya está montado en /api/clientes desde index.js
```

### Error 3: No registrar en index.js
```javascript
// ❌ MAL - crear la ruta pero olvidar registrarla en index.js

// ✅ BIEN - siempre agregar en routes/index.js:
const clientesRoutes = require('./clientes.routes');
router.use('/clientes', clientesRoutes);
```

---

## 🧪 TESTING RÁPIDO

Después de modularizar cada módulo:

```bash
# 1. Reiniciar
pm2 restart erplago

# 2. Ver logs
pm2 logs erplago --lines 20

# 3. Probar endpoint básico
curl -X POST http://localhost:3000/api/usuarios/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tu_usuario","password":"tu_password"}'

# 4. Probar endpoint del módulo nuevo (con token)
curl -H "Authorization: Bearer TU_TOKEN" \
  http://localhost:3000/api/clientes

# 5. Si funciona → Commit
# Si falla → Revisar logs
```

---

## 📊 MÉTRICAS DE ÉXITO

### Antes (monolítico):
- ❌ 7,955 líneas en un archivo
- ❌ Difícil de mantener
- ❌ Imposible hacer tests unitarios
- ❌ Git conflicts frecuentes

### Después (modular):
- ✅ server.js de ~150 líneas
- ✅ 14 módulos independientes (~50-200 líneas c/u)
- ✅ Fácil testing
- ✅ Trabajo en paralelo sin conflictos
- ✅ Bugs más fáciles de encontrar
- ✅ Escalable para nuevas features

---

## 🎯 CHECKLIST

### Preparación
- [ ] Backup del server.js actual
- [ ] Estructura de carpetas creada
- [ ] Archivos base copiados (config, middleware, etc.)

### Por cada módulo
- [ ] Controller creado con todas las funciones
- [ ] Routes creado con todos los endpoints
- [ ] Registrado en routes/index.js
- [ ] Testeado con curl o Postman
- [ ] Commit realizado

### Final
- [ ] Todos los módulos funcionando
- [ ] server.js.old eliminado
- [ ] Documentación actualizada
- [ ] Push a GitHub

---

## 💡 TIPS

1. **Empezá por los pequeños** - Proveedores (6 rutas) es más fácil que Ventas (25 rutas)
2. **Un módulo a la vez** - No crear 5 módulos sin probar
3. **Commit frecuente** - Cada módulo que funciona = commit
4. **Mantener backup** - No eliminar server.js.old hasta estar 100% seguro
5. **Usar VS Code** - Más fácil que nano para copiar/pegar código

---

## 🚀 SIGUIENTE PASO

Empezá con **clientes** (es el más usado):

```bash
cd /root/mi_erp
nano controllers/clientes.controller.js
```

Copiá todas las funciones de clientes desde server.js.old, adaptando al formato exports.

¡Vamos! 🎯
