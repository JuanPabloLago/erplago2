# PLAN: Sistema de Variantes de Productos

## 🎯 Objetivo
Permitir que un producto tenga múltiples variantes con diferentes características, precios y stock.

**Caso de uso principal:** Lijas con diferentes granos (80, 120, 180, 220)

---

## 📊 Estructura de Base de Datos

### Tabla: producto_variantes
```sql
CREATE TABLE producto_variantes (
    id_variante SERIAL PRIMARY KEY,
    id_producto_maestro INTEGER REFERENCES productos(id_producto),
    nombre_variante VARCHAR(100) NOT NULL,  -- "Grano 80", "Talle M", etc
    sku_variante VARCHAR(50) UNIQUE NOT NULL,
    stock INTEGER DEFAULT 0,
    precio DECIMAL(10,2),
    atributos JSONB,  -- Flexible: {"grano": 80, "color": "rojo"}
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT now()
);
```

### Modificar tabla productos
```sql
ALTER TABLE productos 
ADD COLUMN tiene_variantes BOOLEAN DEFAULT FALSE;
```

---

## 🔄 Flujo de Trabajo

### 1. Crear Producto Maestro
- Nombre: "Lija para Madera"
- Marca: 3M
- Categoría: Abrasivos
- tiene_variantes: TRUE
- Imagen: Se comparte entre todas las variantes

### 2. Crear Variantes
| Variante | SKU | Precio | Stock | Atributos |
|----------|-----|--------|-------|-----------|
| Grano 80 | LIJA-80 | $100 | 50 | {"grano": 80} |
| Grano 120 | LIJA-120 | $120 | 30 | {"grano": 120} |
| Grano 180 | LIJA-180 | $150 | 20 | {"grano": 180} |
| Grano 220 | LIJA-220 | $180 | 10 | {"grano": 220} |

---

## 📝 Endpoints a Implementar
```
GET    /api/productos/:id/variantes
POST   /api/productos/:id/variantes
PUT    /api/variantes/:id
DELETE /api/variantes/:id
GET    /api/variantes/:id
```

---

## 🎨 Frontend

### Vista de Producto con Variantes
```
┌─────────────────────────────┐
│  [Imagen]  Lija para Madera │
│  Marca: 3M                   │
│                              │
│  Variantes:                  │
│  ○ Grano 80  - $100  [50]    │
│  ○ Grano 120 - $120  [30]    │
│  ○ Grano 180 - $150  [20]    │
│  ○ Grano 220 - $180  [10]    │
│                              │
│  [+ Agregar Variante]        │
└─────────────────────────────┘
```

---

## ✅ Ventajas del Sistema

1. **Una sola imagen** compartida
2. **Organización clara** bajo un producto maestro
3. **Stock independiente** por variante
4. **Precios independientes** por variante
5. **Atributos flexibles** (JSON permite cualquier característica)
6. **Búsqueda eficiente** por producto maestro
7. **Reportes agrupados** por producto

---

## 🚀 Casos de Uso Adicionales

### Ropa
```
Producto: Remera Deportiva Nike
Variantes:
- Talle S, Color Rojo
- Talle M, Color Rojo
- Talle L, Color Azul
```

### Pinturas
```
Producto: Látex Exterior
Variantes:
- 1 Litro - Blanco
- 4 Litros - Blanco
- 1 Litro - Beige
```

### Tornillos
```
Producto: Tornillo Autoperforante
Variantes:
- 1/4" x 1"
- 1/4" x 2"
- 3/8" x 1.5"
```

---

## ⚠️ Consideraciones

1. **Stock:** Se maneja por variante, no por producto maestro
2. **Precio:** Se maneja por variante
3. **Facturación:** Se factura la variante específica
4. **Búsqueda:** Buscar por nombre del maestro muestra todas las variantes
5. **Eliminación:** Eliminar maestro elimina todas las variantes

---

## 📅 Tiempo Estimado de Implementación

- **Backend:** 30 minutos
- **Frontend:** 30 minutos
- **Pruebas:** 15 minutos
- **Total:** ~75 minutos
