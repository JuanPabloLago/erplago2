# REDISENO CUENTA CORRIENTE CLIENTES - ERP LAGO

**Fecha:** 2026-04-24
**Estado:** Diseno aprobado - en implementacion
**Autor:** Juan Pablo + Claude (arquitectura)
**Objetivo:** Cerrar el hueco arquitectonico que permite pedidos confirmados sin contrapartida monetaria trazable.

---

## 1. DIAGNOSTICO - HALLAZGOS

### 1.1 El caso que disparo la auditoria

Pedido #3991 (id_pedido=4723) de PERLA, $14.900, 17/04/2026:
- id_estado=2 (Confirmado)
- anulado_en=NULL, es_fiado=false, id_forma_pago_principal=NULL
- pagos: 0 registros
- cuentacorrienteclientes: 0 registros
- remitos: 0 registros
- facturas: 0 registros

Resultado: pedido fantasma, confirmado pero sin trazabilidad monetaria en ninguna tabla.

### 1.2 Magnitud del problema

**102 pedidos Confirmados sin pago = $12.585.885,98**

| Tipo cliente                    | Positivos                | Negativos                 |
|---------------------------------|--------------------------|---------------------------|
| CF generico (id=9)              | 22 pedidos, $3.272.652   | 21 pedidos, -$169.001     |
| Cond.IVA=CF (Perla, etc)        | 15 pedidos, $601.011     | 1 pedido, -$42.000        |
| Clientes con CC (RI/Mono)       | 4 pedidos, $208.854      | 0                         |

### 1.3 Bugs concretos hallados en CC existente

**Bug B1** - Concepto "null #XXXX": cc-clientes.helper.js recibe concepto_prefijo=null de algun caller. El default = 'Venta Pedido' solo aplica a undefined, no a null. Resultado: movimientos con concepto literal "null #4721", "null #4706", "null #2731".

**Bug B2** - Concepto usa id_pedido (interno) en vez de nro_pedido (visible). CC muestra "Venta fiada Pedido #2731" cuando el cliente conoce ese pedido como #2442.

**Bug B3** - Drift de redondeo acumulado. CC de Perla muestra saldo $0,24 fantasma. Dos cobros de despacho de $402.199,88 y $478.199,88 contra deudas de $402.200 y $478.200 = $0,12 x 2 = $0,24 residuales.

**Bug B4** - Cobros desde "Cobrar CC" no insertan en pagos. El cobro a cuenta genera: recibo OK + movimiento caja OK + CC OK pero pagos NO. Rompe invariante "pagos = libro maestro de entradas de dinero".

**Bug B5** - cuentacorrienteclientes no tiene id_pedido. Solo traza por id_factura, id_pago, id_nota. Pedido fiado sin factura no puede ligarse nativamente.

**Bug B6** - Auto-confirmacion genera huerfanos. CF generico se auto-confirma sin pago. Cliente con condicion IVA=CF (como Perla) cae en el mismo camino.

**Bug B7** - Duplicacion cliente PERLA. id_cliente=279 y id_cliente=3843 creados en el mismo timestamp.

---

## 2. REGLAS DE NEGOCIO CONFIRMADAS POR EL DUENO

| #  | Regla                                                              | Origen        |
|----|--------------------------------------------------------------------|---------------|
| R1 | Toda venta nace en venta-rapida como pedido                        | Memoria       |
| R2 | CF generico (id=9) NO puede fiar. Si pide fiado -> cambiar cliente | 2026-04-24    |
| R3 | Pedidos con total negativo son validos (devoluciones informales)   | 2026-04-24    |
| R4 | Presupuesto = venta en negro (sin factura). Funciona como esta     | 2026-04-24    |
| R5 | Pedido con cliente con nombre + sin pago = fiado = va a CC         | 2026-04-24    |
| R6 | BD es fuente unica de verdad                                       | Memoria       |
| R7 | Todo configurable desde admin panel, nada hardcoded                | Memoria       |

---

## 3. PRINCIPIOS ARQUITECTONICOS

**P1.** Todo pedido id_estado >= 2 tiene contrapartida monetaria COMPLETA segun el tipo de operacion. Si el sistema no puede determinar contrapartida, bloquea la confirmacion.

**P2.** La BD garantiza las invariantes con triggers. La aplicacion no puede dejar limbo aunque tenga bugs.

**P3.** pagos es el libro maestro de entradas de dinero. TODO ingreso genera registro en pagos (con id_pedido nullable para cobros a cuenta).

**P4.** cuentacorrienteclientes guarda id_pedido como FK nullable. El concepto usa siempre nro_pedido. Nunca null. Nunca drift de centavos >= tolerancia.

**P5.** CF generico bloquea fiado a nivel BD. Si un flujo intenta fiar a CF -> error.

**P6.** Pedidos negativos permitidos como ajuste operativo, sin contrapartida contable obligatoria.

---

## 4. MATRIZ DE CONTRAPARTIDAS

| Tipo cliente                       | total >= 0                              | total < 0                |
|------------------------------------|-----------------------------------------|--------------------------|
| CF generico (id=9)                 | pagos.monto_confirmado = total          | permitido sin contrap.   |
| Cliente con nombre (cualq cond IVA)| pagos.monto_conf + cc.debe >= total     | permitido sin contrap.   |

---

## 5. CAMBIOS ESTRUCTURALES

### 5.1 Schema

- ALTER cuentacorrienteclientes ADD COLUMN id_pedido INT NULL FK pedidos
- ALTER recibos ADD COLUMN id_pedido INT NULL FK pedidos
- ALTER pagos ADD CONSTRAINT chk_pagos_origen (pos, despachos, facturacion, cobranza_cc, regularizacion_historica)
- CREATE VIEW v_pedido_estado_financiero
- CREATE FUNCTION fn_saldo_cc (determinista, elimina drift)
- CREATE FUNCTION fn_validar_integridad_pedido_financiera (trigger, Fase 6)

### 5.2 Config keys en configuraciones_empresa

- cc.cliente_consumidor_final_id          = 9
- cc.cliente_cf_prohibe_fiado              = true
- cc.cliente_cf_prohibe_parcial            = true
- cc.tolerancia_redondeo                   = 1.00
- cc.auto_asiento_redondeo                 = true
- cc.concepto_prefijo_default              = 'Venta Pedido'
- pedido.permitir_negativo                 = true
- pedido.negativo_requiere_contrapartida   = false
- pedido.estados_requieren_contrapartida   = 2,3,4,5
- pedido.permitir_confirmar_sin_pago       = false
- pedido.auto_confirmar_cf                 = true
- pagos.origen_validos                     = pos,despachos,facturacion,cobranza_cc,regularizacion_historica

---

## 6. PLAN DE IMPLEMENTACION POR FASES

| Fase | Que hace                                                              | Duracion | Riesgo |
|------|------------------------------------------------------------------------|----------|--------|
| 0    | Backup + documento (este)                                              | 15 min   | 0      |
| 1    | Config keys + UI admin                                                 | 20 min   | Bajo   |
| 2    | Schema (ALTER, VIEW, FUNCTION sin trigger)                             | 25 min   | Medio  |
| 3    | Refactor cc-clientes.helper.js + nuevo cobranza.helper.js              | 45 min   | Medio  |
| 4    | Script conciliacion 102 huerfanos + saldo drift Perla                  | 60 min   | Alto   |
| 5    | Fix Gestionar Pago (silent fail) + fix Cobrar CC (insert en pagos)     | 60 min   | Medio  |
| 6    | Trigger de integridad (BD bloquea lo que app deberia prevenir)         | 30 min   | Alto   |

---

## 7. DECISIONES OPERATIVAS

| Decision                                | Valor                                                  |
|-----------------------------------------|--------------------------------------------------------|
| Backup                                  | pg_dump + data-only + tar.gz codigo (redundante x2)    |
| Regularizacion 22 CF+ ($3.27M)          | Fecha HOY, turno nuevo (turno 30 ya cerrado)           |
| Regularizacion 21 CF negativos          | Permitidos sin contrapartida (R6)                      |
| Regularizacion 35 con nombre (+$4M)     | Pasar a CC como Venta fiada regularizada               |
| Regularizacion 22 negativos con nombre  | Permitidos sin contrapartida (R6)                      |
| Tolerancia redondeo                     | $1,00 (configurable)                                   |

---

## 8. ARCHIVOS A TOCAR

- /root/mi_erp/src/utils/cc-clientes.helper.js (refactor firma)
- /root/mi_erp/src/utils/cobranza.helper.js (NUEVO - unifica cobro CC)
- /root/mi_erp/src/utils/pagos.helper.js (sumar origen cobranza_cc)
- /root/mi_erp/src/controllers/borrador.controller.js (guard CF prohibe fiado)
- /root/mi_erp/src/controllers/cajas-cobranzas.controller.js (usar cobranza.helper)
- /root/mi_erp/frontend/js/facturas-acciones.js (fix boton Confirmar silencioso)
- /root/mi_erp/frontend/cuenta-corriente.html (UI cobranza revisada)
- /root/mi_erp/frontend/configuraciones.html (nuevas keys CC)

---

## 9. LOG DE IMPLEMENTACION

- [x] Fase 0 - Backup + Documento
- [x] Fase 1 - Config keys (11 keys nuevas insertadas)
- [x] Fase 2 - Schema (cc.id_pedido + chk_pagos_origen + v_pedido_estado_financiero + fn_saldo_cc)
- [ ] Fase 3 - Refactor helpers
- [ ] Fase 4 - Script conciliacion
- [ ] Fase 5 - Fix botones
- [ ] Fase 6 - Trigger integridad

---

## 10. BACKUPS PRE-REDISENO

Ubicacion: /root/mi_erp/backups/pre_rediseno_cc_20260424/

- erplago_20260424_102000.dump         8.6M  (pg_dump -F c completo)
- erplago_20260424_103414.dump         8.6M  (pg_dump -F c completo, duplicado)
- tablas_criticas_data_20260424_102005.sql  4.5M  (SQL plano data-only tablas criticas)
- tablas_criticas_data_20260424_103416.sql  4.5M  (idem duplicado)
- codigo_20260424_102006.tar.gz        50K   (helpers + controllers + frontend afectado)
- codigo_20260424_103416.tar.gz        50K   (idem duplicado)

### Restore rapido

pg_restore -h localhost -U juanpablo -d erplago \
    --clean --if-exists \
    /root/mi_erp/backups/pre_rediseno_cc_20260424/erplago_20260424_102000.dump
