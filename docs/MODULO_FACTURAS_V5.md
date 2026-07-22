# MÓDULO FACTURACIÓN — DOCUMENTACIÓN TÉCNICA UNIFICADA
## ERP LAGO — Actualizado 2026-03-20

---

## 1. ARQUITECTURA DEL MÓDULO

### 1.1 Archivos

| Capa | Archivo | Ruta | Función |
|------|---------|------|---------|
| **Backend** | facturas.controller.js | src/controllers/ | Crear, listar, facturarMasivo, anular |
| | ventas-consulta.controller.js | src/controllers/ | consultarVentas (pedidos facturables), confirmarRapido, facturarDesdePedido, registrarPago, corregirMetodoPago |
| | pedidos.controller.js | src/controllers/ | Detalle, edición items, anular, sobrepago, historial |
| | facturas.routes.js | src/routes/ | Rutas del módulo |
| | pedidos.routes.js | src/routes/ | Rutas de edición post-venta |
| **Helpers** | facturacion.helper.js | src/utils/ | Lógica de facturación AFIP |
| | pedidos.helper.js | src/utils/ | asignarNumeroPedido, registrarLogPedido, obtenerHistorialPedido, LOG_PEDIDO_ACCIONES |
| | pedidos-edicion.helper.js | src/utils/ | Edición post-venta: editarItem, eliminarItemPedido, anularPedidoCompleto, registrarSobrepagoCC |
| | pagos.helper.js | src/utils/ | registrarPago, corregirMetodoPago, anularPago |
| **Services** | afip.service.js | src/services/ | WSFE AFIP: autenticación, CAE, consultas |
| | afip.padron.service.js | src/services/ | Consulta padrón AFIP por CUIT |
| **Frontend** | facturas.js | frontend/js/ | UI: tabla pedidos facturables, facturación masiva, badges, contadores, toggle anulados |
| | facturas-acciones.js | frontend/js/ | Modal detalle, edición items, gestionarPago, historial, sobrepago, acciones por fila |
| | facturas.html | frontend/ | Estructura HTML + modales + CSS inline |

### 1.2 Tablas de BD

| Tabla | Función | Operaciones |
|-------|---------|-------------|
| facturas | Comprobantes emitidos (CAE, número, totales) | INSERT, SELECT, UPDATE (anular) |
| factura_items | Items de cada factura (PK: id_factura + numero_linea) | INSERT, SELECT |
| factura_tipos | Tipos de factura (1=Fac A, 2=Fac B, etc.) | SELECT |
| secuencia_facturas | Numeración por empresa/PV/tipo | UPSERT (ON CONFLICT) |
| pedidos | Fuente principal | SELECT + UPDATE (estado, totales) |
| pedidoitems | Items del pedido | SELECT + UPDATE + DELETE |
| pedidos_log | Auditoría de acciones sobre pedidos | INSERT, SELECT |
| borrador_items_log | Auditoría de cambios en items | INSERT, SELECT |
| pagos | Pagos del pedido | SELECT + INSERT |
| confirmaciones_pago | Confirmaciones de pago | SELECT |
| presupuestos | Presupuestos vinculados | SELECT |
| remitos | Remitos vinculados (usa fecha_emision, NO fecha_creacion) | SELECT |
| notas_credito_debito | NC/ND vinculadas | SELECT |
| cuentacorrienteclientes | Saldo a favor por sobrepago (PK: id_movimiento_cc_cliente) | INSERT via cc-clientes.helper |
| movimientos_caja | Egreso por devolución | INSERT via caja.helper |
| inventario_deposito | Ajuste stock por edición | UPDATE via stock.helper |
| movimientos_stock | Trazabilidad stock | INSERT via stock.helper |
| ajustes_forma_pago | Recargos por FP | UPDATE via recargos.helper |
| configuraciones_empresa | Config AFIP por empresa | SELECT |
| empresas | Datos del emisor | SELECT |
| clientes | Datos del receptor | SELECT |
| condicionesiva | 1=RI, 2=Mono, 3=Exento, 4=CF | SELECT |

---

## 2. ENDPOINTS API

### 2.1 Facturación (facturas.routes.js)

| Método | Ruta | Controller | Descripción |
|--------|------|------------|-------------|
| GET | /api/facturas/tipos | facturas.obtenerTipos | Tipos de factura |
| GET | /api/facturas/proximo-numero/:pv/:tipo | facturas.obtenerProximoNumero | Próximo número |
| GET | /api/facturas/pedidos-facturables | ventas.consultarVentas | Pedidos listos para facturar |
| GET | /api/facturas/ | facturas.listar | Lista facturas con filtros |
| POST | /api/facturas/ | facturas.crear | Factura manual con CAE |
| POST | /api/facturas/masivo | facturas.facturarMasivo | Facturación masiva |
| POST | /api/facturas/confirmar-rapido | ventas.confirmarRapido | Confirmar pago rápido |
| POST | /api/facturas/desde-pedido/:id | ventas.facturarDesdePedido | Facturar pedido individual |
| GET | /api/facturas/metodos-pago | ventas.obtenerMetodosPago | Métodos disponibles |
| POST | /api/facturas/registrar-pago | ventas.registrarPago | Registrar pago desde facturación |
| PUT | /api/facturas/corregir-metodo-pago | ventas.corregirMetodoPago | Corregir FP de pago existente |
| GET | /api/facturas/:id | facturas.obtenerPorId | Detalle para impresión |
| DELETE | /api/facturas/:id | facturas.anular | Anular factura |

### 2.2 Edición post-venta (pedidos.routes.js)

| Método | Ruta | Descripción | Permisos |
|--------|------|-------------|----------|
| GET | /api/pedidos/:id/detalle | Detalle completo + trazabilidad + historial | Token |
| GET | /api/pedidos/:id/historial | Historial de modificaciones | Token |
| PUT | /api/pedidos/:id/items/:id_item | Editar cantidad (no precio) | Admin |
| DELETE | /api/pedidos/:id/items/:id_item | Eliminar item | Admin |
| PUT | /api/pedidos/:id/anular | Anular pedido completo | Admin |
| POST | /api/pedidos/:id/registrar-sobrepago | Registrar saldo a favor en CC | Token |

---

## 3. FLUJOS DE NEGOCIO

### 3.1 Flujo de venta (POS → Facturación)

1. Vendedor abre venta-rápida → `crearBorrador()` → INSERT pedidos estado=-1
2. Agrega items → INSERT pedidoitems
3. Pago + F2 Guardar → `confirmarBorrador()`
4. confirmarBorrador: valida → cambiarEstado → **asignarNumeroPedido** → **registrarLogPedido** → descuentos → pagos → stock → COMMIT
5. tipo_entrega='retiro' → estado=2 (Confirmado), descuenta stock
6. tipo_entrega='entrega' → estado=1 (Pendiente), no descuenta stock

### 3.2 Flujo de facturación (cajero/admin)

1. facturas.html → tab "Facturación Masiva"
2. GET /api/facturas/pedidos-facturables → consultarVentas
3. Muestra pedidos con badges de estado de pago + toggle anulados
4. Seleccionar + "Facturación Masiva" → POST /api/facturas/masivo
5. facturarMasivo por cada pedido: determina tipo → AFIP → crearFacturaConItems → marcarPedidoFacturado

### 3.3 Facturación masiva (detalle técnico)

1. Frontend envía `POST /api/facturas/masivo` con `{ pedido_ids: [...] }`
2. Carga config AFIP: `afipService.cargarConfiguracion(pool, id_empresa)`
3. Por cada pedido:
   - Obtiene datos pedido + cliente + condición IVA
   - Verifica que no esté ya facturado
   - Tipo factura: RI/Mono → Fac A, Exento/CF → Fac B
   - Auto-sincroniza secuencia: consulta `ultimoComprobante` en AFIP, usa `GREATEST(bd, afip) + 1`
   - Calcula totales, agrupa IVA por alícuota
   - Solicita CAE a AFIP
   - Inserta en facturas + factura_items
   - Actualiza pedido a estado 3 (facturado)

### 3.4 Gestión de pagos post-venta

Caso de uso: vendedor confirma sin cobrar → cajero aplica pago después.

Modal "Gestionar pago" (facturas-acciones.js):
- **Sección 1 — Corregir existente:** lista cada pago real (excluye CC) con selector de nuevo método. Motivo obligatorio. PUT /api/facturas/corregir-metodo-pago
- **Sección 2 — Registrar nuevo:** dropdown con todos los métodos (incluye CC). Monto pre-llenado con restante. POST /api/facturas/registrar-pago
- Si completamente pagado: alert verde, solo permite corregir

### 3.5 Edición de items post-venta

- Solo cantidad editable (no precio)
- Si pedido tipo retiro: ajusta stock automáticamente
- Sobrepago detectado → banner amarillo persistente → usuario confirma → registra HABER en CC + egreso de caja
- Falta plata → no se registra nada, pedido queda debiendo
- Todo queda en borrador_items_log (acciones: EDIT_POST_VENTA, DELETE_POST_VENTA, ANULACION_PEDIDO)

### 3.6 Anulación de pedido

Flujo completo: devuelve stock (si retiro) → registra saldo a favor en CC por cada pago → genera egresos de caja → anula recargos → cambia estado a 7 (Cancelado) → registra en log.

---

## 4. SISTEMA DE AUDITORÍA

### 4.1 Tabla pedidos_log

```sql
CREATE TABLE pedidos_log (
    id_log          SERIAL PRIMARY KEY,
    id_pedido       INTEGER NOT NULL REFERENCES pedidos(id_pedido),
    id_empresa      INTEGER NOT NULL REFERENCES empresas(id_empresa),
    id_usuario      INTEGER NOT NULL REFERENCES usuarios(id_usuario),
    accion          VARCHAR(50) NOT NULL,
    detalle_antes   JSONB,
    detalle_despues JSONB,
    ip_origen       VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 4.2 Acciones registradas (LOG_PEDIDO_ACCIONES)

CONFIRMADO, PAGO_REGISTRADO, PAGO_CAMBIADO, PAGO_ANULADO, ESTADO_CAMBIADO, ITEM_EDITADO, ITEM_ELIMINADO, ANULADO, DESCUENTO_APLICADO, CLIENTE_CAMBIADO, FORMA_PAGO_CAMBIADA, RECUPERADO, SUSPENDIDO, TIPO_ENTREGA_CAMBIADO

### 4.3 Puntos de registro

| Lugar | Acciones logueadas |
|-------|-------------------|
| confirmarBorrador (borrador.controller) | CONFIRMADO |
| editarItem (pedidos.controller) | ITEM_EDITADO |
| eliminarItemPedido (pedidos.controller) | ITEM_ELIMINADO |
| anularPedido (pedidos.controller) | ANULADO |
| registrarPago (ventas-consulta.controller) | PAGO_REGISTRADO |
| corregirMetodoPago (ventas-consulta.controller) | FORMA_PAGO_CAMBIADA |
| actualizarCamposPedido (pedidos.controller) | TIPO_ENTREGA_CAMBIADO |

### 4.4 Historial unificado

`obtenerHistorialPedido()` hace UNION ALL de pedidos_log + borrador_items_log, ORDER BY fecha DESC. Frontend renderiza con 20 labels + detalle contextual por acción.

---

## 5. CAMPO nro_pedido

- **Tipo:** INTEGER nullable en tabla pedidos
- **Propósito:** Número visible al usuario, separado del PK id_pedido
- **Se asigna:** Al confirmar borrador (NO al crear)
- **Borradores:** nro_pedido = NULL
- **Índice:** `idx_pedidos_nro_empresa` UNIQUE (id_empresa, nro_pedido) WHERE nro_pedido IS NOT NULL
- **Asignación:** CTE atómico MAX(nro_pedido)+1 por empresa via `asignarNumeroPedido()`
- **Frontend:** Todos los módulos muestran `#${v.nro_pedido || v.id_pedido}`

---

## 6. FRONTEND — UI

### 6.1 Tabla de pedidos facturables

Columnas: checkbox, #Pedido, Cliente, Fecha, Total, Pagado, Vendedor, Estado Pago, Acciones.

Badges en #Pedido:
- ⚠ naranja = tiene_modificaciones (EXISTS en pedidos_log post-confirmación)
- ✕ rojo = id_estado === 7 (Cancelado)

### 6.2 Toggle "Incluir anulados"

Switch que aparece junto a contadores cuando hay pedidos con estado 7 o -2 en el rango de fechas. Por defecto OFF. Backend usa `estadosExcluidos` dinámico:
- OFF: `NOT IN (-2, -1, 0, 7, 8)`
- ON: `NOT IN (-1, 0, 8)` — muestra cancelados y descartados con fila roja, checkbox disabled

### 6.3 Botones de acción por fila

| Botón | Icono | Cuándo aparece | Qué hace |
|-------|-------|----------------|----------|
| Ver detalle | bi-eye | Siempre | Modal detalle con trazabilidad |
| Confirmar pago | bi-check-lg verde | estado_pago=pendiente_confirmar | POST /pagos-confirmacion/confirmar |
| Facturar | bi-receipt azul | Confirmado y no facturado | POST /facturas/desde-pedido/:id |
| Gestionar pago | Dropdown | No facturado | Modal fusionado registrar/corregir |
| Modificar items | Dropdown ✏️ | No facturado ni presupuestado | Modal edición |
| Imprimir ticket | Dropdown 🖨 | Siempre | GET /print/comprobante/:id/html |
| Presupuesto | Dropdown 📋 | No facturado ni presupuestado | POST /presupuestos/desde-pedido/:id |
| Anular | Dropdown ❌ | Admin + no facturado | PUT /pedidos/:id/anular |

### 6.4 Reglas de edición/anulación

`puedeEditar` y `puedeAnular` permiten editar con pagos existentes. Solo bloquea si hay factura o presupuesto vinculado. Sobrepago va a CC.

---

## 7. CONFIGURACIÓN AFIP

### 7.1 Valores en BD (configuraciones_empresa)

| Clave | Valor Producción | Descripción |
|-------|-----------------|-------------|
| afip_cuit | 20296284921 | CUIT del contribuyente |
| afip_env | prod | homo (testing) o prod |
| afip_offline | false | true genera CAE interno sin AFIP |
| afip_cert_path | /root/mi_erp/afip/certificados/lago.crt | Certificado digital |
| afip_key_path | /root/mi_erp/afip/certificados/lago_private.key | Clave privada |

### 7.2 Certificado digital

- Tipo: Producción
- Subject: CN=LAGO_ERP_PRODUCCION, serialNumber=CUIT 20296284921
- Vigencia: 2025-10-21 hasta **2027-10-21** ← RENOVAR ANTES

```bash
openssl x509 -in /root/mi_erp/afip/certificados/lago.crt -text -noout | grep -E "Subject:|Not After"
```

### 7.3 URLs AFIP (afip.service.js)

| Ambiente | WSAA | WSFE |
|----------|------|------|
| homo | wsaahomo.afip.gov.ar/ws/services/LoginCms | wswhomo.afip.gov.ar/wsfev1/service.asmx |
| prod | wsaa.afip.gov.ar/ws/services/LoginCms | servicios1.afip.gov.ar/wsfev1/service.asmx |

### 7.4 Modo offline (emergencia)

```sql
UPDATE configuraciones_empresa SET valor = 'true' WHERE clave = 'afip_offline';
-- Restart PM2. Facturas con CAE "OFFLINE-timestamp". Volver a 'false' cuando AFIP vuelva.
```

### 7.5 Empresa emisora

| Campo | Valor |
|-------|-------|
| razon_social | LAGO JUAN PABLO |
| cuit | 20-29628492-1 |
| domicilio_fiscal | Av. Argentina 1622 esq. Roger - Olivos (1636) - Buenos Aires |
| id_condicion_iva | 1 (Responsable Inscripto) |
| fecha_inicio_actividades | 2013-11-01 |

---

## 8. ESTRUCTURA REQUEST AFIP

### 8.1 Determinación tipo factura

```javascript
// condicionesiva: 1=RI, 2=Monotributo, 3=Exento, 4=Consumidor Final
const id_tipo_factura = (id_condicion_iva === 1 || id_condicion_iva === 2) ? 1 : 2;
// 1 = Factura A (RI/Mono), 2 = Factura B (Exento/CF)
```

### 8.2 Mapeos AFIP

| Interno | Código AFIP | Comprobante |
|---------|-------------|-------------|
| 1 | 1 | Factura A |
| 2 | 6 | Factura B |
| 3 | 11 | Factura C |

| Condición IVA | DocTipo AFIP | Descripción |
|---------------|-------------|-------------|
| RI (1) | 80 | CUIT |
| Monotributo (2) | 80 | CUIT |
| Exento (3) | 80 o 99 | CUIT si tiene, sino sin identificar |
| CF (4) | 99 | Sin identificar (Doc 0) |

| ID AFIP | Alícuota IVA |
|---------|-------------|
| 3 | 0% |
| 4 | 10.5% |
| 5 | 21% |
| 6 | 27% |
| 8 | 5% |
| 9 | 2.5% |

### 8.3 Request FECAESolicitar

```javascript
{
    Auth: { Token, Sign, Cuit: '20296284921' },
    FeCAEReq: {                    // CRÍTICO: envolver en FeCAEReq
        FeCabReq: { CantReg: 1, PtoVta: 6, CbteTipo: 6 },
        FeDetReq: { FECAEDetRequest: [{
            Concepto: 1,           // 1=Productos
            DocTipo: 99,           // 80=CUIT, 99=Sin identificar
            DocNro: 0,
            CbteDesde: N, CbteHasta: N,
            CbteFch: 'YYYYMMDD',
            ImpTotal: X,
            ImpTotConc: 0,
            ImpNeto: neto,         // Siempre, incluso Fac B
            ImpOpEx: 0,
            ImpIVA: iva,           // Siempre, incluso Fac B
            ImpTrib: 0,
            MonId: 'PES', MonCotiz: 1,
            Iva: {                 // OBLIGATORIO si ImpNeto > 0
                AlicIva: [{ Id: 5, BaseImp: neto, Importe: iva }]
            }
        }]}
    }
}
```

### 8.4 Auto-sincronización de secuencia

```sql
INSERT INTO secuencia_facturas (id_empresa, punto_venta, id_tipo_factura, ultimo_numero)
VALUES ($1, $2, $3, $4)
ON CONFLICT (id_empresa, punto_venta, id_tipo_factura)
DO UPDATE SET ultimo_numero = GREATEST(secuencia_facturas.ultimo_numero, $4) + 1
RETURNING ultimo_numero
```

Previene: números saltados, duplicados, desincronización post-backup.

---

## 9. ESTRUCTURA factura_items

PK: (id_factura, numero_linea) — **SIEMPRE enviar numero_linea en INSERT**

| Columna | Tipo | NOT NULL |
|---------|------|----------|
| id_factura | integer | ✅ |
| id_producto | integer | ✅ |
| cantidad | numeric(10,2) | ✅ |
| descripcion | varchar(255) | ✅ |
| precio_unitario | numeric(12,2) | ✅ |
| porcentaje_iva | numeric(5,2) | ✅ (default 21) |
| subtotal | numeric(14,2) | ✅ |
| iva_calculado | numeric(14,2) | ✅ |
| total | numeric(14,2) | ✅ |
| numero_linea | integer | ✅ (parte de PK) |
| precio_lista | numeric(12,2) | |
| descuento_porcentaje | numeric(5,2) | (default 0) |
| descuento_monto | numeric(12,2) | (default 0) |
| subtotal_sin_descuento | numeric(14,2) | |

### Mapeo pedidoitems → factura_items

| pedidoitems | factura_items | Nota |
|-------------|---------------|------|
| precio_unitario_congelado | precio_unitario | Directo |
| iva_aplicado | porcentaje_iva | Directo |
| total_linea - monto_iva | subtotal | Calculado (no existe subtotal_linea en pedidoitems) |
| monto_iva | iva_calculado | Directo |
| total_linea | total | Directo |
| descripcion_congelada | descripcion | Directo |

---

## 10. IMPRESIÓN DE FACTURAS

Template AFIP-compliant según RG 4291/2018 via `window.open()` + `window.print()`:
- Letra grande centrada (A/B/C) con código AFIP
- Datos emisor: razón social, CUIT, domicilio, condición IVA, inicio actividades
- Datos receptor: razón social, CUIT, condición IVA, domicilio
- Items con discriminación IVA solo en Factura A
- CAE + Vencimiento al pie
- QR AFIP (datos codificados en base64 → URL AFIP → QR)

Discriminación: Fac A muestra IVA%, Subtotal, IVA, Importe. Fac B solo Precio Unit. e Importe (IVA incluido).

---

## 11. HELPERS DEL MÓDULO

### 11.1 pedidos-edicion.helper.js (centraliza edición post-venta)

| Función | Descripción |
|---------|-------------|
| verificarEditable(client, id_pedido, id_empresa) | Valida que no esté facturado. Permite editar con pagos; bloquea solo factura/presupuesto/remito |
| editarItem(client, params) | Edita cantidad + stock + log + detecta sobrepago |
| eliminarItemPedido(client, params) | Elimina item + stock + log + detecta sobrepago |
| anularPedidoCompleto(client, params) | Stock + CC + caja + recargos + log |
| registrarSobrepagoCC(client, params) | HABER en CC + egreso de caja |
| obtenerHistorialModificaciones(queryFn, id_pedido) | Lee borrador_items_log con JOINs |
| calcularSobrepago(total_pagado, nuevo_total) | Pure function, sin DB |

Dependencias: pedidos.helper, stock.helper, cc-clientes.helper, caja.helper, recargos.helper

### 11.2 pedidos.helper.js (auditoría y numeración)

| Función | Descripción |
|---------|-------------|
| asignarNumeroPedido(client, { id_pedido, id_empresa }) | CTE atómico MAX+1, RETURNING |
| registrarLogPedido(client, { id_pedido, id_empresa, id_usuario, accion, detalle_antes, detalle_despues, ip_origen }) | INSERT pedidos_log |
| obtenerHistorialPedido(client, id_pedido) | UNION ALL pedidos_log + borrador_items_log |

---

## 12. REFERENCIA RÁPIDA

### Estados de pedido

| id_estado | Nombre | En facturación |
|-----------|--------|----------------|
| -2 | Descartado | Solo con toggle anulados ON (fila roja) |
| -1 | Borrador | Oculto siempre |
| 0 | Cotización | Oculto siempre |
| 1 | Pendiente | Visible |
| 2 | Confirmado | Visible |
| 3 | Facturado | Visible |
| 4 | En Preparación | Visible |
| 5 | Enviado | Visible |
| 6 | Entregado | Visible |
| 7 | Cancelado | Solo con toggle anulados ON (fila roja) |
| 8 | Suspendido | Oculto siempre |
| 99 | Recuperado | — |

### Métodos de pago

1: Efectivo, 2: Mercado Pago, 3: Transferencia, 4: Crédito, 5: Débito, 6: Cuenta Corriente

### Columnas fecha por tabla (errores comunes)

| Tabla | Columna fecha | PK | Trampas |
|-------|--------------|----|---------| 
| pedidos | fecha_creacion | id_pedido | Usa id_estado, NO "estado" |
| facturas | fecha_emision | id_factura | |
| presupuestos | fecha_emision | id_presupuesto | |
| remitos | **fecha_emision** | id_remito | NO tiene fecha_creacion |
| notas_credito_debito | fecha_emision | id_nota | |
| pagos | fecha_pago | id_pago | |
| cuentacorrienteclientes | fecha | **id_movimiento_cc_cliente** | NO tiene id_cc ni id_movimiento |

### Columnas de empresas que SÍ existen

`fecha_inicio_actividades` ✅ — NO existen: `inicio_actividades`, `iibb`

---

## 13. ERRORES CONOCIDOS DE AFIP

| Error | Causa | Solución |
|-------|-------|----------|
| Tag FeCAEReq no ingresado | Request sin wrapper FeCAEReq | Usar `FeCAEReq: feDetReq` |
| 10070: IVA obligatorio | Falta Iva.AlicIva | Enviar siempre, incluso Fac B |
| 10020: BaseImp = 0 | agruparIVAPorAlicuota falla | Verificar cálculo base |
| 500: Error interno | Genérico AFIP | Revisar estructura completa |
| Número duplicado | Secuencia desincronizada | Auto-sync resuelve |

---

## 14. TROUBLESHOOTING

### Ver errores de facturación
```bash
pm2 logs erplago --nostream --lines 20
# O en browser: DevTools → Network → Request masivo → Response → resultados[].error
```

### Verificar sincronización secuencia
```bash
cd /root/mi_erp && source ~/.nvm/nvm.sh && node -e "
const pool = require('./src/config/database');
const afipService = require('./src/services/afip.service');
(async () => {
    await afipService.cargarConfiguracion(pool, 1);
    const ultimoA = await afipService.ultimoComprobante(6, 1);
    const ultimoB = await afipService.ultimoComprobante(6, 6);
    console.log('AFIP Fac A último:', ultimoA, '| Fac B último:', ultimoB);
    const {rows} = await pool.query('SELECT * FROM secuencia_facturas WHERE punto_venta = 6');
    rows.forEach(r => console.log('BD tipo', r.id_tipo_factura, 'último:', r.ultimo_numero));
    process.exit(0);
})();
"
```

### Probar conexión AFIP
```bash
cd /root/mi_erp && source ~/.nvm/nvm.sh && node -e "
const pool = require('./src/config/database');
const afipService = require('./src/services/afip.service');
(async () => {
    await afipService.cargarConfiguracion(pool, 1);
    console.log('Config:', { env: afipService.config.env, cuit: afipService.config.cuit, offline: afipService.config.modoOffline });
    const ultimo = await afipService.ultimoComprobante(6, 6);
    console.log('Último Fac B:', ultimo);
    process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
"
```

### Facturas offline (PV 9999)
```sql
SELECT id_factura, numero_completo, cae, estado FROM facturas WHERE punto_venta = 9999;
-- Estas NO existen en AFIP. Solo registros internos.
```

---

## 15. DEUDA TÉCNICA PENDIENTE

### Bugs conocidos
1. **pedidos.helper.js:475** — INSERT en pedidoitems SIN id_empresa (falla auditoría multi-empresa)
2. **borrador.controller.js** — 3 UPDATEs directos a pedidos bypasseando helper (L563: id_cliente, L710: total_final por interés cuotas)
3. **facturas.controller.js** — 1 UPDATE directo a pedidos
4. **pedidos-edicion.helper.js** — SELECTs a borrador_items_log y usuarios sin filtro id_empresa

### Feature pendiente: Cuotas en "Gestionar pago"
Cuando se selecciona Crédito(4) o Débito(5) en el modal de gestionar pago, mostrar selector de terminal + planes de cuotas (misma UX que venta-rápida).

Ya existe: `GET /api/terminales/activas`, `GET /api/terminales/:id_terminal/preview/:monto`, tablas `planes_cuotas` y `terminales_pago`, `pagos.helper.registrarPago()` acepta id_terminal/cuotas/coeficiente/monto_original/comision_estimada. Referencia UX: modal de terminal en venta-rapida-script.js.

### Bug pendiente: Totales desincronizados en confirmarBorrador
Pedido #1385 tenía total_final=40 con items sumando 80. Investigar si confirmarBorrador no recalcula totales correctamente con múltiples items iguales.

---

## 16. BACKUPS

| Backup | Contenido |
|--------|-----------|
| pre_acciones_facturacion_20260308_111942/ | pedidos.controller, pedidos.routes, facturas.html, facturas.js originales |
| pre_cancelados_filter_20260319_073747/ | ventas-consulta.controller, facturas.js (pre-toggle anulados) |

---

*Documento unificado — generado 2026-03-20 desde 6 fuentes (v1 feb-07, docx mar-08, v2/v3/v4 mar-18/19)*

---

## ADDENDUM — Correcciones y features (2026-03-21)

### 20 bugs auditados, 19 corregidos

| # | Severidad | Archivo | Fix |
|---|-----------|---------|-----|
| 1 | 🔴 | facturas_controller.js | SELECT pedidoitems + `AND id_empresa` en crear |
| 2 | 🔴 | facturas_controller.js | SELECT pedidoitems + `AND id_empresa` en facturarMasivo |
| 3 | 🔴 | facturacion_helper.js | SELECT factura_items + `AND id_empresa` en obtenerFactura |
| 4 | 🔴 | facturas_controller.js | SELECT factura_items + `AND id_empresa` en obtenerPorId + ORDER BY numero_linea |
| 5 | 🔴 | facturas_controller.js | Cálculo duplicado → totalesExternos con _round2 por línea |
| 6 | 🔴 | facturas_controller.js | `\|\|` → `??` nullish coalescing (exentos subtotal=0) |
| 7 | 🔴 | facturas-acciones.js | gestionarPago duplicada rota eliminada (155 líneas) |
| 8 | 🟠 | facturas-pos.js → eliminado | PV hardcodeado → endpoint /mi-punto-venta |
| 9 | 🟠 | facturas_controller.js | id_pedido obligatorio — no facturas huérfanas |
| 10 | 🟠 | facturas_controller.js | Monotributista → Factura B (antes recibía A) |
| 11 | 🟠 | facturas_controller.js | AFIP ultimoComprobante 1x pre-loop (no por pedido) |
| 12 | 🟠 | facturacion_helper.js | marcarPedidoFacturado constante ESTADO_FACTURADO=3 |
| 13 | 🟡 | facturas-acciones.js | GET inútil eliminado de confirmarPagoRapido |
| 14 | 🟡 | facturas.js | Código legacy eliminado (verDetalle después de return) |
| 15 | 🟡 | facturas-acciones.js | corregirFormaPago duplicada eliminada (139 líneas) |
| 16 | 🟡 | facturas.html | colspan 8 → 9 |
| 17 | 🟡 | facturas.js | Métodos de pago dinámicos desde BD |
| 18 | 🟡 | facturas.html | 8 colores Bootstrap green → paleta LAGO |
| 19 | 🟡 | facturas.js/html | Variables globales (pendiente namespace — no urgente) |
| 20 | 🟡 | facturas_controller.js | obtenerTipos sin id_empresa (OK — catálogo global) |

---

### Feature: Cuotas en Gestionar Pago

**Backend** — `ventas-consulta.controller.js` `registrarPago` acepta y pasa al helper:
```
id_terminal, cuotas, coeficiente, monto_original, comision_estimada
```

**Frontend** — Modal "Gestionar Pago" en `facturas-acciones.js`:
- Método Crédito(4) o Débito(5) → aparece sección "Terminal y Cuotas"
- Select terminal → `GET /api/terminales/activas`
- Select plan → `GET /api/terminales/:id/preview/:monto`
- Muestra desglose: cuotas × valor, original + interés = total
- Monto se actualiza con interés. State en `window._gpCuotaState`
- Se envía junto al `POST /api/facturas/registrar-pago`

**Columnas en tabla pagos:** `id_terminal`, `cuotas`, `coeficiente`, `monto_original`, `comision_estimada`

---

### Tab POS eliminado

Flujo obligatorio: **pedido → factura**. No se permiten facturas sin pedido.

- `facturas-pos.js` → `frontend/js/_archivados/`
- Tab HTML y script removidos
- Solo quedan tabs: **Facturación Masiva** | **Historial**

---

### Endpoint /mi-punto-venta (nuevo)
```
GET /api/facturas/mi-punto-venta
→ { punto_venta: 6, id_deposito: 1, nombre_deposito: "Depósito Principal" }
```

Resolución en 3 niveles:
1. `req.usuario.id_deposito` → `depositos.punto_venta_afip`
2. Depósito principal (`es_principal=true`)
3. Config BD: `afip_punto_venta_default` (reemplaza hardcoding PV=6)

---

### CSS migrado a erp-lago-styles.css

- 0 líneas `<style>` inline en facturas.html
- +159 líneas en `erp-lago-styles.css` sección MÓDULO FACTURACIÓN
- Variables: `--lago-primary`, `--lago-secondary`, `--lago-success`, etc.
- Clase `facturacion-module` como scope de tabs
- Loading overlay → `lago-loading-overlay` / `lago-loading-content`

---

### Filtros rápidos de fecha

Botones: `[Hoy] [Semana] [Mes] [Año] [Todo]`
```javascript
function filtroFechaRapido(tipo) // hoy, semana, mes, anio, todo
function fechaLocalISO(d)       // Fecha local (no UTC) en formato YYYY-MM-DD
```

Fix: `new Date().toISOString()` devolvía UTC (podía ser mañana en Argentina). Reemplazado por `fechaLocalISO()`.

---

### Hora en todas las fechas

`formatearFechaCorta(fecha)` ahora incluye hora: `21/03/2026 14:38`

`formatearSoloFecha(fecha)` para fechas sin hora (impresión AFIP, vencimientos).

---

### Icono items eliminados
```sql
EXISTS (SELECT 1 FROM pedidos_log pl3 
        WHERE pl3.id_pedido = p.id_pedido 
        AND pl3.accion IN ('ITEM_ELIMINADO')) AS tiene_items_eliminados
```

Muestra 🗑 (badge rojo) al lado del número de pedido si tiene items eliminados post-venta.

---

### Config nueva en BD
```sql
INSERT INTO configuraciones_empresa (id_empresa, clave, valor)
VALUES (1, 'afip_punto_venta_default', '6');
```

---

### Archivos modificados (resumen final)

| Archivo | Cambios |
|---------|---------|
| `src/utils/facturacion.helper.js` | Bugs 3, 12 |
| `src/controllers/facturas.controller.js` | Bugs 1,2,4,5,6,10,11 + id_pedido obligatorio + /mi-punto-venta + fallback PV |
| `src/controllers/ventas-consulta.controller.js` | Cuotas registrarPago + tiene_items_eliminados |
| `src/routes/facturas.routes.js` | Ruta /mi-punto-venta |
| `frontend/js/facturas.js` | Bugs 14,17 + fecha local + filtros + hora + métodos dinámicos |
| `frontend/js/facturas-acciones.js` | Bugs 7,13,15 + cuotas + paleta LAGO |
| `frontend/facturas.html` | Bug 16 + POS eliminado + CSS migrado + filtros + link CSS |
| `frontend/css/erp-lago-styles.css` | +159 líneas facturación |

**Backup:** `/root/mi_erp/backups/pre_fix_facturacion_20260321_193533/`

*Addendum 2026-03-21 — sesión de auditoría y corrección completa*
