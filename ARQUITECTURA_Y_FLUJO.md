# 🏗️ ARQUITECTURA DEL PLANIFICADOR DE ENTREGAS

---

## 📐 DIAGRAMA DE COMPONENTES

```
┌─────────────────────────────────────────────────────────────────┐
│                         NAVEGADOR                                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         03_planificador-entregas.html                      │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │   Sidebar    │  │  Calendario  │  │  Estadísticas│    │ │
│  │  │   Pedidos    │  │  FullCalendar│  │              │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  │                                                            │ │
│  │         04_planificador-entregas.js                       │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │ │
│  │  │ Drag & Drop  │  │  API Calls   │  │  UI Updates  │    │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/REST
┌─────────────────────────────────────────────────────────────────┐
│                      SERVIDOR (server.js)                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         02_endpoints_planificador.js                       │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  GET  /api/entregas-planificadas                     │ │ │
│  │  │  GET  /api/pedidos/sin-programar                     │ │ │
│  │  │  POST /api/entregas-planificadas                     │ │ │
│  │  │  PUT  /api/entregas-planificadas/:id                 │ │ │
│  │  │  DEL  /api/entregas-planificadas/:id                 │ │ │
│  │  │  GET  /api/entregas-planificadas/dia/:fecha          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │         05_endpoint_pdf_entregas.js                       │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  GET  /api/entregas-planificadas/dia/:fecha/pdf      │ │ │
│  │  │  Genera PDF con PDFKit                                │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ↕ SQL
┌─────────────────────────────────────────────────────────────────┐
│                      POSTGRESQL                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  01_crear_tabla_entregas_planificadas.sql                 │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  entregas_planificadas (NUEVA)                       │ │ │
│  │  │  ├── id_planificacion                                │ │ │
│  │  │  ├── id_pedido → pedidos                            │ │ │
│  │  │  ├── fecha_programada                                │ │ │
│  │  │  ├── hora_inicio / hora_fin                          │ │ │
│  │  │  ├── prioridad                                       │ │ │
│  │  │  └── estado                                          │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                            │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  TABLAS EXISTENTES                                   │ │ │
│  │  │  ├── pedidos                                         │ │ │
│  │  │  ├── pedidoitems                                     │ │ │
│  │  │  ├── clientes                                        │ │ │
│  │  │  ├── remitos                                         │ │ │
│  │  │  └── pedido_entregas                                 │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 FLUJO DE DATOS

### 1. Carga Inicial
```
Usuario accede → planificador-entregas.html
                      ↓
         Ejecuta planificador-entregas.js
                      ↓
         Inicializa FullCalendar
                      ↓
    ┌─────────────────┴─────────────────┐
    ↓                                   ↓
GET /pedidos/sin-programar    GET /entregas-planificadas
    ↓                                   ↓
Renderiza sidebar             Renderiza eventos en calendario
```

### 2. Programar Entrega (Drag & Drop)
```
Usuario arrastra pedido
        ↓
Evento: drop (FullCalendar)
        ↓
Modal con formulario
        ↓
Usuario completa datos
        ↓
POST /api/entregas-planificadas
        ↓
    {
      id_pedido: 45,
      fecha_programada: "2025-10-27",
      hora_inicio: "09:00",
      prioridad: 2,
      zona_entrega: "Norte"
    }
        ↓
INSERT INTO entregas_planificadas
        ↓
RETURN nueva entrega
        ↓
Refresca calendario + sidebar
```

### 3. Reagendar (Move)
```
Usuario arrastra evento en calendario
        ↓
Evento: eventDrop (FullCalendar)
        ↓
PUT /api/entregas-planificadas/:id
        ↓
    {
      fecha_programada: "2025-10-28",
      hora_inicio: "10:00"
    }
        ↓
UPDATE entregas_planificadas
        ↓
Confirmación visual
```

### 4. Realizar Entrega
```
Usuario click en evento
        ↓
Modal con detalles
        ↓
Click "Realizar Entrega"
        ↓
POST /api/pedidos/:id/entregar-todo
        ↓
    CREATE remito
    UPDATE pedidos (estado = entregado)
    INSERT INTO remito_items
        ↓
PUT /api/entregas-planificadas/:id
    { estado: "entregada" }
        ↓
Evento desaparece del calendario
```

### 5. Imprimir Hoja de Ruta
```
Usuario click "Imprimir Día"
        ↓
Selecciona fecha
        ↓
GET /api/entregas-planificadas/dia/2025-10-27/pdf
        ↓
    SELECT entregas WHERE fecha = 2025-10-27
    JOIN con pedidos, clientes, items
        ↓
    Genera PDF con PDFKit
        ┌────────────────────────┐
        │ HOJA DE RUTA           │
        │ Fecha: 27/10/2025      │
        ├────────────────────────┤
        │ 1. [09:00] Pedido #45  │
        │    Cliente: Juan López │
        │    📍 Calle 123        │
        │    □ OK                │
        ├────────────────────────┤
        │ 2. [10:30] Pedido #46  │
        │    ...                 │
        └────────────────────────┘
        ↓
Descarga PDF
```

---

## 🗄️ MODELO DE DATOS

### Relaciones entre Tablas

```
┌──────────────────┐
│    empresas      │
│  id_empresa (PK) │
└────────┬─────────┘
         │
         │ 1:N
         ↓
┌──────────────────┐       1:N      ┌─────────────────────┐
│     pedidos      │─────────────────│   pedidoitems       │
│  id_pedido (PK)  │                 │  id_item (PK)       │
│  id_cliente (FK) │                 │  id_pedido (FK)     │
│  estado_entrega  │                 │  cantidad           │
└────────┬─────────┘                 │  cantidad_entregada │
         │                           └─────────────────────┘
         │ 1:N
         ↓
┌──────────────────────────────┐
│  entregas_planificadas (NEW) │
│  id_planificacion (PK)       │
│  id_pedido (FK)              │◄─── Relación con pedido
│  id_empresa (FK)             │
│  fecha_programada            │
│  hora_inicio                 │
│  hora_fin                    │
│  prioridad (1-5)             │
│  zona_entrega                │
│  estado (planificada/...)    │
│  observaciones               │
└──────────────────────────────┘
         │
         │ (opcional)
         ↓
┌──────────────────┐
│     remitos      │◄─── Se crea al realizar entrega
│  id_remito (PK)  │
│  id_pedido (FK)  │
│  fecha_emision   │
└──────────────────┘
```

### Estados de una Entrega Programada

```
┌─────────────┐
│ planificada │ Estado inicial
└──────┬──────┘
       │
       ├──────► ┌──────────┐
       │        │ en_ruta  │ Cambiado manualmente
       │        └──────────┘
       │
       ├──────► ┌────────────┐
       │        │ entregada  │ Al crear remito
       │        └────────────┘
       │
       ├──────► ┌─────────────┐
       │        │ reprogramada│ Al cambiar fecha
       │        └─────────────┘
       │
       └──────► ┌───────────┐
                │ cancelada │ Manualmente
                └───────────┘
```

---

## 🎨 ARQUITECTURA FRONTEND

### Componentes de la UI

```
┌──────────────────────────────────────────────────────────┐
│                    NAVEGADOR                              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │             HEADER (Bootstrap Navbar)                │ │
│ │  [← ERP LAGO]  Planificador    [Entregas] [Salir]   │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                           │
│ ┌─────────────────┬───────────────────────────────────┐ │
│ │                 │                                   │ │
│ │   SIDEBAR       │         CALENDARIO                │ │
│ │   (col-lg-3)    │         (col-lg-9)                │ │
│ │                 │                                   │ │
│ │ ┌─────────────┐ │  ┌─────────────────────────────┐ │ │
│ │ │ Stats Cards │ │  │  FullCalendar Component     │ │ │
│ │ │ - Hoy       │ │  │  ┌───┬───┬───┬───┬───┬───┐ │ │ │
│ │ │ - Pendientes│ │  │  │ L │ M │ M │ J │ V │ S │ │ │ │
│ │ └─────────────┘ │  │  ├───┼───┼───┼───┼───┼───┤ │ │ │
│ │                 │  │  │26 │27 │28 │29 │30 │31 │ │ │ │
│ │ ┌─────────────┐ │  │  │🚚 │🚚 │   │🚚 │   │   │ │ │ │
│ │ │   Pedidos   │ │  │  │ 3 │ 2 │   │ 5 │   │   │ │ │ │
│ │ │  Pendientes │ │  │  └───┴───┴───┴───┴───┴───┘ │ │ │
│ │ │             │ │  │                             │ │ │
│ │ │ [Pedido #45]│─┼─►│  Drag & Drop               │ │ │
│ │ │ [Pedido #46]│ │  │                             │ │ │
│ │ │     ...     │ │  │  [Imprimir] [Ver Lista]     │ │ │
│ │ └─────────────┘ │  └─────────────────────────────┘ │ │
│ │                 │                                   │ │
│ └─────────────────┴───────────────────────────────────┘ │
│                                                           │
│ ┌──────────────────────────────────────────────────────┐ │
│ │               MODALS (SweetAlert2)                   │ │
│ │  - Programar entrega                                 │ │
│ │  - Detalles de entrega                               │ │
│ │  - Confirmaciones                                    │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Librerías Utilizadas

```javascript
// Frontend
├── Bootstrap 5.3.0         // UI Framework
├── Bootstrap Icons 1.11.0  // Iconos
├── FullCalendar 6.1.10     // Calendario
├── SweetAlert2 11          // Modales y alertas
└── Vanilla JavaScript      // Lógica principal

// Backend
├── Express                 // Framework web
├── pg (node-postgres)      // PostgreSQL driver
├── PDFKit                  // Generación de PDFs
└── jsonwebtoken            // Autenticación
```

---

## 🔐 SEGURIDAD

### Autenticación y Autorización

```
┌────────────────────────────────────────────┐
│  1. Login                                  │
│     POST /api/usuarios/login               │
│     → Retorna JWT token                    │
└─────────────┬──────────────────────────────┘
              ↓
┌────────────────────────────────────────────┐
│  2. Guardar Token                          │
│     localStorage.setItem('authToken', ...) │
└─────────────┬──────────────────────────────┘
              ↓
┌────────────────────────────────────────────┐
│  3. Cada Request                           │
│     headers: {                             │
│       'Authorization': `Bearer ${token}`   │
│     }                                      │
└─────────────┬──────────────────────────────┘
              ↓
┌────────────────────────────────────────────┐
│  4. Middleware verificarToken              │
│     - Valida JWT                           │
│     - Extrae id_usuario e id_empresa       │
│     - Pasa al endpoint                     │
└────────────────────────────────────────────┘
```

### Aislamiento por Empresa

Todos los endpoints filtran por `id_empresa`:

```sql
WHERE ep.id_empresa = $1  -- Del token JWT
```

Esto garantiza que cada empresa solo vea sus datos.

---

## 🚀 PERFORMANCE

### Optimizaciones Implementadas

1. **Índices en Base de Datos**
```sql
CREATE INDEX idx_entregas_planificadas_fecha ON entregas_planificadas(fecha_programada);
CREATE INDEX idx_entregas_planificadas_empresa ON entregas_planificadas(id_empresa);
CREATE INDEX idx_entregas_planificadas_estado ON entregas_planificadas(estado);
```

2. **Consultas Optimizadas**
- JOIN con LEFT JOIN para datos opcionales
- Uso de agregaciones (COUNT, SUM) en lugar de múltiples queries
- Filtros en WHERE para reducir datos procesados

3. **Carga Inteligente de Eventos**
- Solo carga eventos del mes actual ± 1 mes
- No recarga todo el calendario en cada cambio

4. **Renderizado Eficiente**
- FullCalendar maneja el rendering virtual
- Updates incrementales en lugar de re-render completo

---

## 🔄 INTEGRACIÓN CON SISTEMA EXISTENTE

### No Modifica Datos Existentes

```
Sistema Actual (intacto)
├── pedidos
├── pedidoitems
├── remitos
└── pedido_entregas

Nueva Funcionalidad (agregada)
└── entregas_planificadas
    └── Referencias a pedidos
        └── No modifica pedidos
```

### Workflow Integrado

```
1. Pedido creado (existente)
          ↓
2. Aparece en "Sin Programar" (nuevo)
          ↓
3. Se programa en calendario (nuevo)
          ↓
4. Se realiza entrega (existente)
          ↓
5. Se crea remito (existente)
          ↓
6. Se marca como entregada (nuevo)
```

---

## 📱 RESPONSIVE DESIGN

### Breakpoints

```css
/* Mobile First */
- xs (<576px):   1 columna (calendario)
- sm (≥576px):   1 columna
- md (≥768px):   2 columnas (sidebar + calendario)
- lg (≥992px):   2 columnas optimizadas
- xl (≥1200px):  2 columnas con más espacio
```

### Adaptaciones Móviles

- Sidebar colapsable
- Calendario en vista día por defecto
- Botones más grandes para touch
- Drag & drop alternativo (tap para mover)

---

## 🎯 PRÓXIMAS MEJORAS SUGERIDAS

1. **Notificaciones Push** cuando llega la hora de entrega
2. **Geolocalización** para optimizar rutas
3. **Chat interno** con repartidores
4. **Firmas digitales** en entregas
5. **Fotos de comprobante** de entrega
6. **Integración con Google Maps** para rutas
7. **Export a Google Calendar** / Outlook
8. **App móvil** para repartidores

---

**Arquitectura diseñada para ERP LAGO**  
Escalable • Segura • Performante  
Versión 1.0 - Octubre 2025
