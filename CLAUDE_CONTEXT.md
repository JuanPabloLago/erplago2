# 🏢 ERP LAGO - Contexto Completo para Claude Code

**Última actualización:** 2025-11-17
**Sistema:** ERP completo para distribuidora/ferretería/corralón en Argentina
**Establecido:** 2003

---

## 📂 ESTRUCTURA DEL PROYECTO

```
/root/mi_erp/
├── server.js                    (296KB - 126+ endpoints, 8214 líneas)
├── package.json / package-lock.json
├── .env                         (credenciales - NUNCA commitear)
├── frontend/
│   ├── js/
│   │   ├── venta-rapida-script.js
│   │   ├── connection-indicator.js
│   │   └── [otros módulos]
│   ├── css/
│   │   └── erp-lago-styles.css
│   ├── venta-rapida.html
│   ├── dashboard.html
│   └── [33+ páginas HTML]
├── pdf-generator.js
├── afip/                        (Integración facturación electrónica)
├── modulos/                     (Componentes reutilizables)
├── scripts/                     (Scripts de mantenimiento)
├── docs/                        (Documentación)
└── node_modules/               (154MB - excluido de backups)
```

**Backups:** `/backups/erp/` (NO en /root/mi_erp/backups/)

---

## 🗄️ BASE DE DATOS

### Información de Conexión
- **Motor:** PostgreSQL 17
- **Host:** localhost
- **Puerto:** 5432
- **Usuario:** juanpablo
- **Base de datos:** erplago
- **Password:** [en .env como DB_PASSWORD]

### Estructura
- **95+ tablas** organizadas por módulos
- **IMPORTANTE:** Siempre verificar estructura antes de modificar: `\d nombre_tabla`

### Tablas Principales

#### Clientes y Proveedores
```sql
clientes (id_cliente, id_empresa, razon_social, cuit_cuil, domicilio, telefono, email,
          id_condicion_iva, saldo_cuenta_corriente, activo)
proveedores (id_proveedor, id_empresa, nombre, cuit, direccion, telefono, email, activo)
```

#### Productos e Inventario
```sql
productos (id_producto, id_empresa, sku, nombre, descripcion, precio_compra,
           precio_venta, id_categoria, activo)
inventario (id_empresa, id_producto, stock_actual)  ← USO OBLIGATORIO PARA STOCK
categorias (id_categoria, id_empresa, nombre, descripcion)
```

**⚠️ CRÍTICO:** Stock se maneja en tabla `inventario`, NO en columna `productos.stock`

#### Precios
```sql
listas_precios (id_lista_precio, id_empresa, nombre, porcentaje_margen, activa)
precios_productos (id_precio, id_empresa, id_producto, id_lista_precio, precio, fecha_vigencia)
historial_precios (registra todos los cambios con triggers automáticos)
```

#### Pedidos y Ventas
```sql
pedidos (id_pedido, id_empresa, id_cliente, id_usuario, id_estado, total,
         observaciones, fecha_creacion, token_publico, tipo_entrega,
         descuento_general_porcentaje, descuento_general_monto)
pedidoitems (id_item, id_pedido, id_producto, cantidad, precio_unitario_congelado,
             porcentaje_descuento, iva_aplicado, monto_iva, total_linea)
pedidoestados (id_estado=1:Pendiente, 8:Suspendido, etc)
```

#### Compras
```sql
ordenes_compra (id_orden, id_empresa, id_proveedor, id_usuario, total, estado, fecha_orden)
recepciones (id_recepcion, id_orden_compra, fecha_recepcion, total)
pagos_proveedores (id_pago, id_empresa, id_proveedor, monto, forma_pago, fecha_pago)
```

#### Cuenta Corriente y Pagos
```sql
cuentas_corrientes (id_cuenta_corriente, id_empresa, id_cliente, saldo_actual)
movimientos_cc (movimientos de cuenta corriente)
pagos (pagos de clientes con distribución automática)
formas_pago (efectivo, débito, crédito, transferencia, mercadopago, mercadopago_qr)
```

#### Caja
```sql
turnos_caja (id_turno, id_caja, id_usuario, fecha_apertura, fecha_cierre, estado)
movimientos_caja (ingresos/egresos de caja)
```

#### AFIP (Facturación Electrónica)
```sql
comprobantes_afip (id_comprobante, id_pedido, tipo_comprobante, punto_venta,
                   numero_comprobante, cae, vencimiento_cae, fecha_emision)
```

#### Configuración
```sql
configuraciones_empresa (id_empresa, clave, valor)
  Claves importantes:
  - permitir_stock_negativo (true/false)
  - tipo_comprobante_default
  - punto_venta_afip
  - certificado_afip
```

### Relaciones Importantes
- Todos los registros tienen `id_empresa` (multi-empresa)
- `pedidos` → `pedidoitems` (1:N)
- `productos` → `inventario` (1:1 por empresa)
- `clientes` → `cuentas_corrientes` (1:1 por empresa)

---

## 🔧 BACKEND - server.js

### Configuración
- **Framework:** Express.js
- **Autenticación:** JWT (Bearer token)
- **CORS:** Habilitado para `*`
- **Rate Limiting:** 10 intentos / 15 min en login
- **Puerto:** 3000
- **Entorno:** production

### Estructura de Endpoints (126+)

#### Autenticación
```javascript
POST /api/login
POST /api/register
```

#### Clientes
```javascript
GET    /api/clientes
POST   /api/clientes
PUT    /api/clientes/:id
DELETE /api/clientes/:id
GET    /api/clientes/consumidor-final
```

#### Productos
```javascript
GET    /api/productos
POST   /api/productos
PUT    /api/productos/:id
DELETE /api/productos/:id
GET    /api/productos/por-proveedor/:id_proveedor
```

#### Inventario
```javascript
GET    /api/inventario
POST   /api/inventario/ajuste
GET    /api/inventario/:id_producto
```

#### Pedidos
```javascript
GET    /api/pedidos
POST   /api/pedidos
GET    /api/pedidos/:id
GET    /api/pedidos/:id/recuperar
DELETE /api/pedidos/suspendidos/:id
GET    /api/pedidos/suspendidos
POST   /api/venta-rapida
```

#### Listas de Precios
```javascript
GET    /api/listas-precios
POST   /api/listas-precios
PUT    /api/listas-precios/:id
GET    /api/precios-productos
```

#### Compras
```javascript
GET    /api/ordenes-compra
POST   /api/ordenes-compra
POST   /api/recepciones
GET    /api/proveedores
```

#### Pagos y Cuenta Corriente
```javascript
GET    /api/cuentas-corrientes/:id_cliente
POST   /api/pagos
GET    /api/movimientos-cc/:id_cliente
POST   /api/pagos/distribuir
```

#### AFIP
```javascript
POST   /api/afip/facturar
GET    /api/afip/comprobante/:id
POST   /api/afip/solicitar-cae
```

### Patrones Comunes

**Verificar Token:**
```javascript
headers: {
    'Authorization': `Bearer ${localStorage.getItem('authToken')}`
}
```

**Conexión a BD:**
```javascript
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT
});
```

**Transacciones:**
```javascript
const client = await pool.connect();
try {
    await client.query('BEGIN');
    // ... operaciones
    await client.query('COMMIT');
} catch (error) {
    await client.query('ROLLBACK');
    throw error;
} finally {
    client.release();
}
```

---

## 🎨 FRONTEND

### Stack Tecnológico
- **HTML5** puro (33+ páginas)
- **Bootstrap 5.3.0** para UI
- **JavaScript Vanilla** (sin frameworks)
- **Bootstrap Icons** para iconografía
- **Chart.js** para gráficos
- **Módulos reutilizables**

### Páginas Principales
```
dashboard.html          - Panel principal
venta-rapida.html      - POS/Mostrador
clientes.html          - ABM Clientes
productos.html         - ABM Productos
inventario.html        - Gestión de stock
pedidos.html           - Gestión de pedidos
compras.html           - Órdenes de compra
cuentas-corrientes.html - Gestión CC
caja.html              - Caja registradora
reportes.html          - Dashboards
```

### Estilos Globales - erp-lago-styles.css

**Variables CSS:**
```css
:root {
    --color-primary: #667eea;
    --color-primary-dark: #764ba2;
    --color-success: #28a745;
    --input-height: 32px;
    --border-radius: 4px;
}
```

**Clases Reutilizables:**
- `.gradient-primary` - Gradiente principal
- `.item-venta-compacto` - Items de venta
- `.cuadro-flotante-total` - Total flotante
- `.busqueda-codigo` - Input de búsqueda
- `.producto-grid` - Grid de productos
- `.forma-pago-btn` - Botones de pago

### Patrones de JavaScript

**Fetch con autenticación:**
```javascript
const response = await fetch(`${API_URL}/endpoint`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('authToken')}`
    },
    body: JSON.stringify(data)
});
```

**Manejo de errores:**
```javascript
try {
    // operación
} catch (error) {
    console.error('Error:', error);
    mostrarAlerta('❌ Error: ' + error.message, 'Error');
}
```

### Navegación por Teclado (OBLIGATORIO)

**Atajos globales:**
- `F2` → Guardar
- `F3` → Buscar cliente
- `ESC` → Cancelar/Limpiar
- `ENTER` → Confirmar/Siguiente campo
- `ESPACIO` → Ir a cantidad último item
- `Tab` → Moverse entre campos

**Implementación:**
```javascript
document.addEventListener('keydown', (event) => {
    if (event.key === 'F2') {
        event.preventDefault();
        document.getElementById('btnGuardar').click();
    }
    // ... más atajos
});
```

---

## 🔐 SEGURIDAD Y CONFIGURACIÓN

### Variables de Entorno (.env)
```bash
PORT=3000
NODE_ENV=production

DB_HOST=localhost
DB_PORT=5432
DB_USER=juanpablo
DB_NAME=erplago
DB_PASSWORD=Huu3697debian@

JWT_SECRET=[secreto único]

AFIP_CUIT=[CUIT de la empresa]
AFIP_CERT_PATH=[ruta al certificado]
AFIP_KEY_PATH=[ruta a la clave privada]
```

### Principios de Seguridad
- ✅ JWT en todas las rutas protegidas
- ✅ Rate limiting en login
- ✅ Passwords hasheados con bcrypt
- ✅ Validación de entrada en servidor
- ✅ Transacciones para operaciones críticas
- ❌ NUNCA commitear .env
- ❌ NUNCA loggear passwords

---

## 🛠️ COMANDOS IMPORTANTES

### Node.js y PM2
```bash
# SIEMPRE ejecutar primero:
source ~/.nvm/nvm.sh

# PM2
pm2 status
pm2 restart erplago
pm2 logs erplago --lines 50
pm2 logs --lines 0  # Tiempo real
pm2 flush  # Limpiar logs

# Desarrollo
cd /root/mi_erp
npm install
node server.js  # Modo desarrollo
```

### PostgreSQL
```bash
# Conectar
sudo -u postgres psql -d erplago

# Verificar estructura
\d nombre_tabla

# Backup manual
pg_dump -U juanpablo -d erplago -F c > backup.dump

# Restaurar
pg_restore -U juanpablo -d erplago -c backup.dump

# Ver estado
pg_lsclusters
sudo pg_ctlcluster 17 main start
```

### Sistema
```bash
# Espacio en disco
df -h

# Ver procesos
ps aux | grep node
ps aux | grep postgres

# Logs del sistema
journalctl -u postgresql -n 50
tail -f /var/log/postgresql/postgresql-17-main.log
```

---

## 🔄 SISTEMA DE BACKUPS

### Ubicación y Estructura
```
/backups/erp/
├── database/
│   ├── backup_diario.dump.gz      (69KB)
│   └── backup_semanal.dump.gz     (69KB)
├── files/
│   ├── backup_diario.tar.gz       (37MB)
│   ├── backup_semanal.tar.gz      (37MB)
│   └── .env_backup
└── backup.log
```

### Script Automático
```bash
# Script: /root/backup_erp_optimizado.sh
# Crontab: 0 1 * * * (diario a la 1 AM)

# Ejecución manual
/root/backup_erp_optimizado.sh

# Ver log
tail -50 /backups/erp/backup.log
```

### Rotación
- **Lunes a Sábado:** Solo reemplaza backup diario
- **Domingo:** Reemplaza diario Y semanal
- **Resultado:** Siempre tenés backup de hoy + último domingo

### Exclusiones del Backup
- ✅ Incluye: código, configuración, BD
- ❌ Excluye: node_modules, .git, *.log, backups/

---

## 📋 REGLAS Y MEJORES PRÁCTICAS

### Base de Datos
1. **SIEMPRE** verificar estructura con `\d tabla` antes de modificar
2. Stock **OBLIGATORIO** usar tabla `inventario`, NO columna en productos
3. Usar transacciones para operaciones multi-tabla
4. Incluir `id_empresa` en todas las queries
5. Validar datos en backend, no confiar solo en frontend

### Código
1. Configuraciones en tabla `configuraciones_empresa`, NO hardcodeadas
2. Navegación completa por teclado (F2, ESC, ENTER, etc)
3. Módulos reutilizables en `/modulos`
4. Componentes independientes y desacoplados
5. Logs informativos con emojis para claridad

### UI/UX
1. Auto-focus en siguiente campo lógico
2. Validación en tiempo real
3. Feedback visual inmediato (spinners, alerts)
4. Diseño responsive (Bootstrap grid)
5. Accesibilidad por teclado obligatoria

### Seguridad
1. JWT en todas las rutas protegidas
2. Validar permisos por empresa
3. NUNCA exponer passwords en logs
4. Rate limiting en endpoints sensibles
5. CORS configurado apropiadamente

---

## 🐛 TROUBLESHOOTING COMÚN

### PostgreSQL no arranca
```bash
# Ver logs
sudo tail -100 /var/log/postgresql/postgresql-17-main.log

# Verificar espacio
df -h

# Reiniciar
sudo pg_ctlcluster 17 main restart
```

### PM2 no encuentra node
```bash
# Cargar nvm SIEMPRE
source ~/.nvm/nvm.sh
pm2 status
```

### Frontend no carga cambios
```bash
# Limpiar caché
# En navegador: Ctrl + Shift + R

# Verificar archivo correcto
find /root/mi_erp/frontend -name "*.js" -mtime -1

# Agregar versión al HTML
<script src="js/archivo.js?v=20251117"></script>
```

### Error 500 en endpoints
```bash
# Ver logs en tiempo real
pm2 logs erplago --lines 0

# Verificar PostgreSQL
sudo -u postgres psql -d erplago -c "SELECT 1;"

# Verificar .env
cat /root/mi_erp/.env | grep DB_
```

### Disco lleno
```bash
# Ver uso
du -sh /root/* | sort -h

# Limpiar logs PM2
pm2 flush

# Limpiar logs sistema
sudo journalctl --vacuum-size=100M

# Verificar backups
du -sh /backups/erp/
```

---

## 🎯 MÓDULOS PRINCIPALES

### Venta Rápida (POS)
- **Archivo:** venta-rapida.html + venta-rapida-script.js
- **Funcionalidad:**
  - Búsqueda rápida por código/barras
  - Listas de precios dinámicas
  - Descuentos por item y general
  - Múltiples formas de pago
  - Suspender/recuperar ventas
  - Cliente por defecto: Consumidor Final
- **Estado:** 8 = Suspendido

### Cuenta Corriente
- Saldo automático por cliente
- Distribución automática de pagos
- Movimientos con tipo (venta, pago, ajuste)
- Histórico completo

### AFIP Integración
- Facturación electrónica
- Solicitud de CAE
- Tipos de comprobante
- Contingencia y retry automático

### Caja Registradora
- Turnos de caja
- Multi-moneda (ARS, USD, EUR, BRL)
- Cálculo automático de intereses
- Cierre de caja

---

## 📞 COMANDOS RÁPIDOS DE EMERGENCIA

```bash
# Servidor no responde
pm2 restart erplago && pm2 logs --lines 20

# PostgreSQL caído
sudo pg_ctlcluster 17 main start && sleep 5 && pm2 restart erplago

# Disco lleno
df -h && du -sh /root/* | sort -h | tail -10

# Ver último error
pm2 logs erplago --err --lines 20

# Backup manual urgente
/root/backup_erp_optimizado.sh

# Ver qué ocupa más espacio
du -sh /root/mi_erp/* | sort -h | tail -20
```

---

## 📚 RECURSOS ADICIONALES

### Documentación Generada
- `/root/mi_erp/docs/` - Documentación del proyecto
- `/backups/erp/backup.log` - Log de backups
- Este archivo - Contexto completo

### URLs Importantes
- **Frontend:** http://72.60.148.18:3000/
- **API Base:** http://72.60.148.18:3000/api/
- **Dashboard:** http://72.60.148.18:3000/dashboard.html

---

## ⚠️ NOTAS IMPORTANTES

1. **NUNCA** modificar estructura de BD sin backup previo
2. **SIEMPRE** usar transacciones en operaciones complejas
3. **VERIFICAR** tabla inventario para stock, NO productos.stock
4. **CARGAR** nvm antes de cualquier comando node/npm/pm2
5. **PROBAR** en desarrollo antes de aplicar en producción
6. **DOCUMENTAR** cambios importantes en este archivo

---

**Creado:** 2025-11-17
**Para:** Juan Pablo - ERP LAGO
**Uso:** Claude Code y referencia general

---

## 🔄 Uso en Claude Code

```bash
# Ejemplo de comandos
claude code "Lee CLAUDE_CONTEXT.md y ayudame a crear un nuevo endpoint para..."
claude code "Según CLAUDE_CONTEXT.md, necesito modificar venta-rapida.html para..."
claude code "Basándote en la estructura en CLAUDE_CONTEXT.md, dame un query para..."
```

Este archivo contiene TODO lo que necesitás saber sobre el ERP LAGO.
