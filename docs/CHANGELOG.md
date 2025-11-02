# CHANGELOG - ERP LAGO

## 2025-10-22 - Sesión 1: Módulos Básicos

### Módulos Implementados:

#### 1. PROVEEDORES ✅
- CRUD completo con validaciones
- Búsqueda avanzada por razón social, CUIT, email, rubro
- Campos: razón social, nombre fantasía, CUIT, condición IVA, rubro, contactos
- Eliminación lógica (no elimina físicamente)
- **Endpoints:**
  - GET /api/proveedores - Listar todos
  - GET /api/proveedores/buscar?q=texto - Búsqueda
  - GET /api/proveedores/:id - Detalle
  - POST /api/proveedores - Crear
  - PUT /api/proveedores/:id - Actualizar
  - DELETE /api/proveedores/:id - Eliminar (lógico)
- **Frontend:** proveedores.html
- **Datos de prueba:** 2 proveedores creados

#### 2. CATEGORÍAS ✅
- Sistema jerárquico completo (categorías padre/hijo)
- Vista de árbol jerárquico
- Campos: nombre, descripción, id_categoria_padre, orden, activo
- Validaciones: no eliminar con subcategorías o productos
- **Endpoints:**
  - GET /api/categorias - Listar todas con jerarquía
  - GET /api/categorias/principales - Solo principales
  - GET /api/categorias/arbol - Árbol completo
  - GET /api/categorias/:id/subcategorias - Subcategorías
  - POST /api/categorias - Crear
  - PUT /api/categorias/:id - Actualizar
  - DELETE /api/categorias/:id - Eliminar (lógico)
- **Frontend:** categorias.html
- **Datos de prueba:** 10 categorías (4 principales + 6 subcategorías)

#### 3. MARCAS ✅
- CRUD completo
- Información adicional: país de origen, sitio web, logo
- Validación: no eliminar con productos asignados
- **Endpoints:**
  - GET /api/marcas - Listar todas
  - GET /api/marcas/:id - Detalle
  - POST /api/marcas - Crear
  - PUT /api/marcas/:id - Actualizar
  - DELETE /api/marcas/:id - Eliminar (lógico)
- **Frontend:** marcas.html
- **Datos de prueba:** 8 marcas internacionales

### Mejoras al Sistema:
- ✅ Endpoint GET /api/condicionesiva para combos
- ✅ Botón de Proveedores agregado al dashboard
- ✅ Campo id_marca agregado a tabla productos
- ✅ Permisos de PostgreSQL configurados correctamente

### Archivos Modificados:
- `server.js` - 3 módulos nuevos (Proveedores, Categorías, Marcas)
- `dashboard.html` - Botón de Proveedores agregado
- `proveedores.html` - Nuevo
- `categorias.html` - Nuevo
- `marcas.html` - Nuevo

### Base de Datos:
- Tabla `proveedores` mejorada
- Tabla `categorias` con jerarquía (id_categoria_padre)
- Tabla `marcas` creada
- Tabla `productos` actualizada con id_marca

### Backups Creados:
1. 20251022_1831 - Con Proveedores
2. 20251022_1921 - Con Proveedores + Categorías
3. 20251022_final - Completo con Marcas

---

## Próximos Pasos (Sesión 2):

### FASE 3: VARIANTES DE PRODUCTO 🎯 (Prioridad Alta)
**Objetivo:** Sistema para productos con múltiples variantes (Ej: Lijas con diferentes granos)

**Estructura propuesta:**
- Tabla: producto_variantes
- Producto maestro + múltiples variantes
- Stock por variante
- Precio por variante
- Atributos flexibles (JSON)

**Tiempo estimado:** 45-60 minutos

### FASE 4: CONJUNTOS DE PRODUCTOS
**Objetivo:** Agrupar productos en kits/combos

**Características:**
- Un producto puede estar en múltiples conjuntos
- Relación many-to-many
- Precios especiales por conjunto

**Tiempo estimado:** 30 minutos

### FASE 5: MEJORAR MÓDULO DE PRODUCTOS
**Objetivo:** Integrar categorías y marcas en productos

**Mejoras:**
- Agregar selects de categoría y marca en formulario
- Filtros por categoría/marca
- Vista mejorada con badges

**Tiempo estimado:** 20 minutos

---

## Notas Técnicas:

### Permisos PostgreSQL:
Si hay errores de permisos, ejecutar:
```sql
GRANT ALL PRIVILEGES ON TABLE [tabla] TO juanpablo;
GRANT USAGE, SELECT ON SEQUENCE [tabla]_id_seq TO juanpablo;
```

### Rate Limiting:
- Login: 10 intentos cada 15 minutos
- Configurado en línea ~90 de server.js

### Autenticación:
- JWT con expiración de 8 horas
- Token almacenado en localStorage del navegador
