# GUÍA DE ENDPOINTS - ERP LAGO

Base URL: `http://72.60.148.18:3000/api`

Todos los endpoints (excepto login) requieren header:
```
Authorization: Bearer <token>
```

---

## 🔐 AUTENTICACIÓN

### Login
```
POST /api/usuarios/login
Body: {
  "username": "string",
  "password": "string"
}
Response: {
  "token": "string",
  "usuario": { username, rol, id_empresa }
}
```

---

## 🚚 PROVEEDORES

### Listar todos
```
GET /api/proveedores
Response: Array de proveedores
```

### Buscar
```
GET /api/proveedores/buscar?q=texto
Response: Array de proveedores filtrados
```

### Obtener uno
```
GET /api/proveedores/:id
Response: Objeto proveedor
```

### Crear
```
POST /api/proveedores
Body: {
  "razon_social": "string" (requerido),
  "nombre_fantasia": "string",
  "cuit": "string" (requerido),
  "id_condicion_iva": integer (requerido),
  "rubro": "string",
  "domicilio": "string",
  "telefono": "string",
  "email": "string",
  "contacto_nombre": "string",
  "contacto_puesto": "string"
}
```

### Actualizar
```
PUT /api/proveedores/:id
Body: (mismos campos que POST)
```

### Eliminar (lógico)
```
DELETE /api/proveedores/:id
```

---

## 🏷️ CATEGORÍAS

### Listar todas con jerarquía
```
GET /api/categorias
Response: Array con categorías y subcategorías
```

### Solo principales
```
GET /api/categorias/principales
Response: Array de categorías sin padre
```

### Árbol completo
```
GET /api/categorias/arbol
Response: Array jerárquico con subcategorías anidadas
```

### Subcategorías de una categoría
```
GET /api/categorias/:id/subcategorias
Response: Array de subcategorías
```

### Crear
```
POST /api/categorias
Body: {
  "nombre": "string" (requerido),
  "descripcion": "string",
  "id_categoria_padre": integer (null para principal),
  "orden": integer
}
```

### Actualizar
```
PUT /api/categorias/:id
Body: (mismos campos que POST)
```

### Eliminar (lógico)
```
DELETE /api/categorias/:id
Nota: No permite eliminar si tiene subcategorías o productos
```

---

## 🏆 MARCAS

### Listar todas
```
GET /api/marcas
Response: Array de marcas
```

### Obtener una
```
GET /api/marcas/:id
Response: Objeto marca
```

### Crear
```
POST /api/marcas
Body: {
  "nombre": "string" (requerido),
  "descripcion": "string",
  "pais_origen": "string",
  "sitio_web": "string",
  "logo": "string" (URL)
}
```

### Actualizar
```
PUT /api/marcas/:id
Body: (mismos campos que POST)
```

### Eliminar (lógico)
```
DELETE /api/marcas/:id
Nota: No permite eliminar si tiene productos
```

---

## 📋 CONDICIONES IVA

### Listar todas
```
GET /api/condicionesiva
Response: Array de condiciones IVA
```

---

## 👥 CLIENTES

### Listar todos
```
GET /api/clientes
```

### Buscar
```
GET /api/clientes/buscar?q=texto
```

### CRUD completo
```
POST /api/clientes
PUT /api/clientes/:id
DELETE /api/clientes/:id
```

---

## 📦 PRODUCTOS

### Listar todos
```
GET /api/productos
```

### Buscar (para POS)
```
GET /api/productos/buscar?q=texto
```

### Listar para POS
```
GET /api/productos/listar
```

### CRUD completo
```
POST /api/productos
PUT /api/productos/:id
DELETE /api/productos/:id
```

---

## 🛒 PEDIDOS / POS

### Obtener datos iniciales
```
GET /api/pedidos/data
Response: { clientes, productos, metodosDePago }
```

### Crear pedido
```
POST /api/pedidos
Body: {
  "id_cliente": integer,
  "items": [
    {
      "id_producto": integer,
      "cantidad": number,
      "precio_unitario_congelado": number
    }
  ],
  "observaciones": "string"
}
```

---

## 📊 REPORTES

### Dashboard
```
GET /api/reportes/dashboard?fecha_desde=&fecha_hasta=
```

### Ventas por vendedor
```
GET /api/reportes/ventas-por-vendedor?fecha_desde=&fecha_hasta=
```

### Stock bajo
```
GET /api/reportes/stock-bajo
```

---

## ⚙️ CONFIGURACIONES

### Listar todas
```
GET /api/configuraciones
```

### Obtener una
```
GET /api/configuraciones/:clave
```

### Actualizar (solo admin)
```
PUT /api/configuraciones/:clave
Body: { "valor": "string" }
```

---

## Códigos de Estado

- `200` - OK
- `201` - Creado
- `400` - Petición incorrecta
- `401` - No autenticado
- `403` - Sin permisos
- `404` - No encontrado
- `409` - Conflicto (duplicado)
- `500` - Error del servidor
