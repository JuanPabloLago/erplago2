# 📅 PLANIFICADOR DE ENTREGAS CON DRAG & DROP
## Sistema de Calendario para Organizar Entregas - ERP LAGO

---

## 📋 ÍNDICE
1. [Características](#características)
2. [Instalación Paso a Paso](#instalación)
3. [Configuración](#configuración)
4. [Uso del Sistema](#uso)
5. [Solución de Problemas](#problemas)

---

## ✨ CARACTERÍSTICAS

### 🎯 Funcionalidades Principales

✅ **Calendario Visual Interactivo**
- Vista por Mes, Semana y Día
- Diseño tipo Google Calendar
- Colores por prioridad

✅ **Drag & Drop Completo**
- Arrastrar pedidos desde el sidebar al calendario
- Mover entregas entre días
- Reagendar con un solo clic

✅ **Gestión de Entregas**
- Programar fecha y hora de entrega
- Establecer prioridades (1-5)
- Definir zonas de entrega
- Agregar observaciones

✅ **Impresión Agrupada**
- Hoja de ruta diaria
- PDF con todas las entregas del día
- Información completa de cada entrega

✅ **Integración Total**
- Se conecta con tu sistema actual de entregas
- No altera datos existentes
- Compatible con entregas parciales

---

## 🚀 INSTALACIÓN PASO A PASO

### PASO 1: Crear la Tabla en la Base de Datos

```bash
# Conectarse a PostgreSQL
psql -U postgres -d erplago

# Ejecutar el script SQL
\i 01_crear_tabla_entregas_planificadas.sql
```

O copiar y pegar el contenido del archivo `01_crear_tabla_entregas_planificadas.sql` en pgAdmin.

**Verificar que la tabla se creó correctamente:**
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_name = 'entregas_planificadas';
```

---

### PASO 2: Agregar Endpoints al Backend

Abrir el archivo `server.js` y agregar los nuevos endpoints:

**Ubicación sugerida:** Después del módulo de remitos (alrededor de la línea 5300)

1. Copiar TODO el contenido de `02_endpoints_planificador.js`
2. Pegarlo en `server.js` antes de la línea `app.listen(PORT...)`
3. También agregar el contenido de `05_endpoint_pdf_entregas.js`

**Tu server.js debería quedar así:**
```javascript
// ... código existente ...

// =======================================================================
//                MÓDULO DE PLANIFICADOR DE ENTREGAS
// =======================================================================
// [PEGAR AQUÍ EL CONTENIDO DE 02_endpoints_planificador.js]

// [PEGAR AQUÍ EL CONTENIDO DE 05_endpoint_pdf_entregas.js]

// ... resto del código ...

app.listen(PORT, '0.0.0.0', () => {
    // ...
});
```

---

### PASO 3: Copiar Archivos del Frontend

```bash
# En la carpeta de tu proyecto
cd /ruta/a/tu/proyecto/frontend

# Copiar los archivos
cp 03_planificador-entregas.html .
cp 04_planificador-entregas.js .
```

**Estructura de carpetas:**
```
mi_erp/
├── server.js (modificado)
└── frontend/
    ├── login.html
    ├── dashboard.html
    ├── entregas.html (existente)
    ├── planificador-entregas.html (NUEVO)
    ├── planificador-entregas.js (NUEVO)
    └── ... otros archivos ...
```

---

### PASO 4: Reiniciar el Servidor

```bash
# Si usas PM2
pm2 restart server

# O si ejecutas con node
# Ctrl+C para detener
node server.js
```

---

### PASO 5: Agregar Botón en el Dashboard (Opcional)

Editar `dashboard.html` y agregar un nuevo botón:

```html
<!-- Agregar en la sección de módulos -->
<div class="col-md-3">
    <div class="card modulo-card">
        <div class="card-body text-center">
            <i class="bi bi-calendar-check display-4 text-primary"></i>
            <h5 class="mt-3">Planificador</h5>
            <p class="text-muted">Calendario de entregas</p>
            <a href="planificador-entregas.html" class="btn btn-primary">
                Abrir <i class="bi bi-arrow-right"></i>
            </a>
        </div>
    </div>
</div>
```

---

## ⚙️ CONFIGURACIÓN

### Cambiar la URL del API

Si tu API está en una URL diferente, editar `04_planificador-entregas.js`:

```javascript
// Línea 6
const API_URL = 'http://TU_IP:3000/api'; // Cambiar aquí
```

### Personalizar Colores

En `03_planificador-entregas.html`, sección `<style>`:

```css
:root {
    --color-primary: #667eea;    /* Color principal */
    --color-secondary: #764ba2;  /* Color secundario */
    --color-success: #28a745;    /* Verde */
    --color-warning: #ffc107;    /* Amarillo */
    --color-danger: #dc3545;     /* Rojo */
}
```

---

## 📖 USO DEL SISTEMA

### 1️⃣ Acceder al Planificador

- Desde el dashboard, click en "Planificador de Entregas"
- O ir directamente a: `http://tu-servidor/planificador-entregas.html`

### 2️⃣ Programar una Entrega

**Método 1: Drag & Drop**
1. En el sidebar izquierdo verás los "Pedidos Pendientes"
2. Arrastra un pedido hacia el día deseado en el calendario
3. Se abrirá un formulario para completar detalles
4. Llenar: hora inicio, hora fin, prioridad, zona, observaciones
5. Click en "Programar"

**Método 2: Click en el Día**
1. Click en un día del calendario
2. Selecciona un pedido de la lista
3. Completa los detalles
4. Click en "Programar"

### 3️⃣ Reagendar una Entrega

1. Arrastra el evento del calendario a otro día
2. Se actualizará automáticamente
3. O click en el evento → "Editar" → cambiar fecha

### 4️⃣ Ver Detalles de una Entrega

- Click en cualquier entrega del calendario
- Verás: Cliente, dirección, teléfono, monto, prioridad
- Opciones: Realizar entrega, Eliminar programación

### 5️⃣ Imprimir Entregas del Día

**Opción A:**
1. Click en el botón "Imprimir Día" (arriba del calendario)
2. Seleccionar fecha
3. Se generará un PDF con todas las entregas

**Opción B:**
1. Click en un día del calendario
2. Verás la lista de entregas
3. Click en "Imprimir"

### 6️⃣ Realizar una Entrega

1. Click en la entrega en el calendario
2. Click en "Realizar Entrega"
3. Se generará automáticamente un remito
4. La entrega se marcará como completada
5. El pedido desaparecerá del calendario

---

## 🎨 SISTEMA DE PRIORIDADES

| Prioridad | Color | Uso |
|-----------|-------|-----|
| 1 - Baja | 🔵 Gris | Entregas sin urgencia |
| 2 - Normal | 🔵 Celeste | Entregas estándar (por defecto) |
| 3 - Media | 🟡 Amarillo | Entregas importantes |
| 4 - Alta | 🟠 Naranja | Entregas urgentes |
| 5 - Urgente | 🔴 Rojo | Máxima prioridad |

---

## 🔍 VISTAS DEL CALENDARIO

### Vista Mes (Por Defecto)
- Muestra todo el mes
- Cada día muestra las entregas programadas
- Ideal para planificación general

### Vista Semana
- Muestra 7 días
- Con franjas horarias
- Ideal para ver horarios específicos

### Vista Día
- Muestra un solo día
- Detalle completo de cada entrega
- Ideal para el día de trabajo

**Cambiar vista:** Botones superiores del calendario (Mes / Semana / Día)

---

## 📊 ESTADÍSTICAS

En el sidebar verás:

- **Entregas Hoy:** Número de entregas programadas para hoy
- **Sin Programar:** Pedidos que aún no tienen fecha asignada

---

## 🔧 SOLUCIÓN DE PROBLEMAS

### ❌ "Error al cargar pedidos"

**Causa:** El servidor no está respondiendo o hay error en la URL

**Solución:**
1. Verificar que el servidor esté corriendo: `pm2 status`
2. Verificar la URL del API en `planificador-entregas.js`
3. Verificar que tengas permisos (token válido)

### ❌ "No hay pedidos para mostrar"

**Causa:** No hay pedidos con estado "pendiente" de entrega

**Solución:**
1. Ir a "Pedidos" y verificar el estado
2. Asegurarse de que haya pedidos con `estado_entrega != 'completo'`

### ❌ "No se puede programar entrega"

**Causa:** El pedido ya tiene una programación para esa fecha

**Solución:**
1. Eliminar la programación existente
2. Crear una nueva

### ❌ El drag & drop no funciona

**Causa:** Problemas con JavaScript o navegador antiguo

**Solución:**
1. Actualizar el navegador
2. Abrir consola del navegador (F12) y ver errores
3. Verificar que los archivos JS se cargaron correctamente

### ❌ "Error al generar PDF"

**Causa:** Problemas con el módulo pdfkit

**Solución:**
```bash
# Instalar o reinstalar pdfkit
npm install pdfkit
pm2 restart server
```

---

## 📝 NOTAS IMPORTANTES

### ⚠️ Puntos a Considerar

1. **No elimina pedidos:** El sistema solo programa entregas, no borra datos
2. **Integración suave:** Se integra con el sistema actual de entregas
3. **Múltiples programaciones:** Un pedido puede reprogramarse varias veces
4. **Sin conflictos:** La tabla `entregas_planificadas` es independiente

### 💡 Mejores Prácticas

1. **Planificar con anticipación:** Programa entregas con al menos 1 día de antelación
2. **Usar zonas:** Agrupa entregas por zona geográfica
3. **Establecer prioridades:** Ayuda a organizar mejor las rutas
4. **Revisar diariamente:** Verifica las entregas del día cada mañana
5. **Imprimir hoja de ruta:** Útil para los repartidores

### 🎯 Flujo de Trabajo Recomendado

1. **Lunes AM:** Planificar entregas de toda la semana
2. **Cada día AM:** Imprimir hoja de ruta del día
3. **Durante el día:** Marcar entregas como completadas
4. **Fin del día:** Reprogramar entregas no realizadas

---

## 🆘 SOPORTE

Si encuentras problemas:

1. Revisar la consola del navegador (F12)
2. Revisar los logs del servidor: `pm2 logs`
3. Verificar la configuración de la base de datos
4. Contactar al equipo de desarrollo

---

## 📌 RESUMEN DE ARCHIVOS

| Archivo | Ubicación | Descripción |
|---------|-----------|-------------|
| `01_crear_tabla_entregas_planificadas.sql` | Base de datos | Script SQL |
| `02_endpoints_planificador.js` | server.js | Endpoints del backend |
| `03_planificador-entregas.html` | frontend/ | Interfaz HTML |
| `04_planificador-entregas.js` | frontend/ | Lógica JavaScript |
| `05_endpoint_pdf_entregas.js` | server.js | Generador de PDF |

---

## ✅ CHECKLIST DE INSTALACIÓN

- [ ] Tabla `entregas_planificadas` creada en PostgreSQL
- [ ] Endpoints agregados a `server.js`
- [ ] Archivos HTML y JS copiados a `frontend/`
- [ ] Servidor reiniciado
- [ ] Acceso al planificador funcional
- [ ] Drag & drop funcionando
- [ ] PDF de entregas generándose correctamente
- [ ] Botón agregado al dashboard (opcional)

---

## 🎉 ¡LISTO!

Tu sistema de planificador de entregas está completo y funcionando.

**Acceder:** `http://tu-servidor/planificador-entregas.html`

---

**Creado para ERP LAGO - Sistema de Gestión Empresarial**
Versión 1.0 - Octubre 2025
