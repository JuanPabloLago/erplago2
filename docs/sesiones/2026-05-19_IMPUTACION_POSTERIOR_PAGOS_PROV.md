# Imputación posterior de pagos a proveedores — ERP LAGO

## Problema

Los pagos a cuenta de proveedor generaban dos filas paralelas:
- `pagosaproveedores`: `monto>0`, `es_pago_a_cuenta=true`
- `cuentas_por_pagar`: `tipo='pago'`, `saldo=-monto`, `id_comprobante=NULL`

Pero NO existía forma desde la UI de tomar esos créditos y aplicarlos a comprobantes pendientes después. Caso real: SILOS ARENEROS con $15.419.881,10 a favor y $967.535,38 de deuda activa que no podía cerrarse.

## Modelo

Aplicar $Z del crédito C (cuenta saldo=-Y) a la deuda D (cuenta saldo=+X):
1. INSERT `imputacion_pagos_proveedor(id_pago=pago_origen_credito, id_cuenta=D, monto=Z)` → trigger decrementa saldo de D
2. UPDATE `cuentas_por_pagar SET saldo = saldo + Z WHERE id_cuenta = C` (crédito sube hacia 0)
3. Si D.saldo ≈ 0 → actualizar comprobante a `pagado`, sino `pagado_parcial`
4. INSERT `aplicaciones_saldo_favor(...)` con usuario, IP, motivo, reversible
5. (opcional, default true) INSERT informativo en `cuentacorrienteproveedores` con `debe=0, haber=0`

**Invariante**: el saldo neto del proveedor no cambia — la plata no entra ni sale, se reasigna.

## Implementación

### Helper (`src/utils/pagos-proveedores.helper.js`)
- `obtenerCreditosDisponibles(pool, {id_proveedor, id_empresa})`
- `aplicarCreditoSobreCuenta(client, ...)` — atómica interna, valida saldos, lock FOR UPDATE
- `aplicarSaldoAFavor(pool, ...)` — orquestador transaccional, modo puro (sin pago nuevo)
- `revertirAplicacionSaldoFavor(pool, ...)`
- **Extensión** `registrarPagoProveedorCompleto`: acepta `creditos_a_aplicar` opcional. Si solo vienen créditos sin formas_pago, no crea pago en `pagosaproveedores` (modo puro). Si vienen créditos + formas_pago, los créditos se procesan tras la imputación normal (modo mixto). FIFO sobre facturas si no se indica `id_cuenta_deuda` explícita.
- **Extensión** `anularPagoProveedorCompleto`: antes de revertir imputaciones, revierte las aplicaciones de saldo a favor donde `id_pago_origen = id_pago` (borra imputación, ajusta saldos, vuelve estado de comprobante).

### Frontend (`pagos-proveedores.html` + `pagos-proveedores.js`)
- Módulo `creditos-proveedor-ui.js` (autocontenido, expone `window.CreditosProveedor`)
- Sección "Saldo a Favor Disponible" entre el proveedor y las facturas pendientes
- `seleccionarProveedor` carga créditos
- `limpiarProveedor` limpia créditos
- `calcularTotales` incluye saldo a favor en el cálculo
- `registrarPago` envía `creditos_a_aplicar` en el payload

### UX
- Sección visible solo si el proveedor tiene `saldo<0` en alguna cuenta
- Tarjetas tildables con monto editable capped al saldo disponible
- Resumen muestra: facturas + formas + créditos = total a cubrir
- Si saldo a favor cubre todo, no requiere formas de pago

## Endpoints

| Método | Ruta | Función |
|--------|------|---------|
| GET    | `/api/pagos-proveedores/creditos-disponibles/:id_proveedor` | Listar créditos |
| POST   | `/api/pagos-proveedores/aplicar-saldo-favor` | Aplicación pura |
| PUT    | `/api/pagos-proveedores/aplicaciones-saldo-favor/:id_aplicacion/revertir` | Reversión |
| POST   | `/api/pagos-proveedores` | Existente, ahora acepta `creditos_a_aplicar` |

## Configuraciones (6 claves)

Ver `docs/MAPEO_VENDIBILIDAD.md` sección `cc_prov.imputacion.*`.

## Bugs preexistentes NO resueltos en este módulo

1. **Anulación de pago a cuenta no elimina la cuenta_por_pagar tipo='pago'**: si anulás un pago a cuenta que nunca se aplicó, su `cuenta_por_pagar` con saldo negativo queda flotando. Recomendado abordar en sesión futura.
2. **`pagosaproveedores.estado` con default 'aplicado'**: ambiguo entre "pago efectuado" y "totalmente imputado". La vista `v_creditos_proveedor_disponibles` da la verdad real.
3. **`proveedores.saldo_actual` muestra neto** (deuda − créditos), que confunde al usuario cuando hay mucho saldo a favor con poca deuda real. La pantalla muestra ese valor en rojo aunque la deuda real sea menor.

## Rollback

```bash
# 1) Restaurar archivos desde el backup más reciente
ls -la /root/mi_erp/backups/imputacion_posterior_v2_*

# 2) Drop schema
psql -h localhost -U juanpablo -d erplago <<SQL
DROP VIEW IF EXISTS v_creditos_proveedor_disponibles;
DROP TABLE IF EXISTS aplicaciones_saldo_favor CASCADE;
DELETE FROM configuraciones_empresa WHERE clave LIKE 'cc_prov.imputacion.%';
SQL

# 3) Eliminar módulo frontend
rm /root/mi_erp/frontend/js/creditos-proveedor-ui.js

# 4) Restart
pm2 restart erplago
```
