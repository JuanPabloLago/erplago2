/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRECIOS HELPER — ERP LAGO
 * Único punto de cálculo de precio / IVA / descuentos / redondeo.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REGLA: Ningún controller ni helper hace Math.round(x * 1.21) a mano.
 *        Todo pasa por este helper.
 *
 * Diseño:
 *   - Funciones puras (sin acceso a BD).
 *   - Precisión: NETO con 4 decimales (14,4), CON_IVA con 2 decimales (14,2).
 *   - Redondeo configurable desde configuraciones_empresa.
 *   - Invariante fiscal Ley 23.349 art.10:
 *         subtotal_sin_iva + total_iva = total_final
 *
 * Config esperada en configuraciones_empresa:
 *   - venta.redondeo_con_iva    ('NINGUNO'|'CENTAVO'|'PESO'|'DECENA'|'50_CENTAVOS')
 *   - venta.direccion_redondeo  ('MAS_CERCANO'|'ARRIBA'|'ABAJO')
 *
 * Política por defecto (sin config): NINGUNO → comportamiento actual del sistema.
 *
 * Fecha: 2026-04-21 | Fase 1
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────────────────────
// (Fase 1 de redondeo configurable ELIMINADA: codigo muerto sin consumidores)

// =============================================================================
// F2 - 2026-05-18 - escribirPrecio: punto unico de escritura en `precios`
// Contrato:
//   - modo_input='BRUTO': el precio viene con IVA (entero o decimal); si la lista
//     tiene redondea_con_iva=true se valida que sea entero y se persiste tal cual.
//   - modo_input='NETO':  el precio viene sin IVA; se calcula bruto = neto*(1+iva)
//     y si la lista redondea, se redondea al entero. neto_derivado se recalcula
//     desde el bruto final para mantener consistencia.
// Devuelve: { id_precio, precio_con_iva, precio_neto_calculado, drift_vs_input,
//             alicuota_iva, redondeo_aplicado }
// =============================================================================
// =============================================================================
// F2b - calcularNetoDerivado (PURA, sin I/O) - single source de la formula bruto→neto
// Replica exactamente la cadena de escribirPrecio para que validador y escritor
// calculen identico. NO toca BD. Devuelve { precio_con_iva_final, precio_neto_derivado }.
// =============================================================================
function calcularNetoDerivado(precio, modo_input, alicuota, redondea_con_iva) {
  const factor = 1 + alicuota / 100;
  let bruto_calculado;
  if (modo_input === 'BRUTO') {
    bruto_calculado = precio;
  } else {
    bruto_calculado = precio * factor;
  }
  let precio_con_iva_final;
  if (redondea_con_iva) {
    precio_con_iva_final = Math.round(bruto_calculado);
  } else {
    precio_con_iva_final = Math.round(bruto_calculado * 100) / 100;
  }
  const precio_neto_derivado = Math.round((precio_con_iva_final / factor) * 1000000) / 1000000;
  return { precio_con_iva_final, precio_neto_derivado };
}
module.exports.calcularNetoDerivado = calcularNetoDerivado;

async function escribirPrecio({
  id_empresa, id_producto, id_lista,
  precio_input, modo_input, contexto, client
}) {
  // ---- Validacion de entradas ----
  if (!id_empresa)   throw new Error('precios.helper.escribirPrecio: id_empresa obligatorio');
  if (!id_producto)  throw new Error('precios.helper.escribirPrecio: id_producto obligatorio');
  if (!id_lista)     throw new Error('precios.helper.escribirPrecio: id_lista obligatorio');
  if (precio_input === null || precio_input === undefined || precio_input === '') {
    throw new Error('precios.helper.escribirPrecio: precio_input obligatorio');
  }
  if (!['BRUTO', 'NETO'].includes(modo_input)) {
    throw new Error("precios.helper.escribirPrecio: modo_input debe ser 'BRUTO' o 'NETO'");
  }
  if (!contexto) throw new Error('precios.helper.escribirPrecio: contexto obligatorio (para auditoria)');
  if (!client)   throw new Error('precios.helper.escribirPrecio: client (pg) obligatorio');

  const precio = parseFloat(precio_input);
  if (!Number.isFinite(precio) || precio < 0) {
    throw new Error(`precios.helper.escribirPrecio: precio_input invalido: ${precio_input}`);
  }

  // ---- Resolver alicuota IVA del producto ----
  const alicuotaQ = await client.query(
    `SELECT a.porcentaje
       FROM productos p
       LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
      WHERE p.id_producto = $1`,
    [id_producto]
  );
  if (alicuotaQ.rows.length === 0) {
    throw new Error(`precios.helper.escribirPrecio: producto ${id_producto} no existe`);
  }
  if (alicuotaQ.rows[0].porcentaje === null) {
    throw new Error(`precios.helper.escribirPrecio: producto ${id_producto} sin id_alicuota_iva (asignar antes)`);
  }
  const alicuota = parseFloat(alicuotaQ.rows[0].porcentaje);
  const factor = 1 + alicuota / 100;

  // ---- Resolver politica de la lista ----
  const listaQ = await client.query(
    `SELECT redondea_con_iva
       FROM listasdeprecios
      WHERE id_lista_precio = $1 AND id_empresa = $2`,
    [id_lista, id_empresa]
  );
  if (listaQ.rows.length === 0) {
    throw new Error(`precios.helper.escribirPrecio: lista ${id_lista} no existe para empresa ${id_empresa}`);
  }
  const redondea_con_iva = listaQ.rows[0].redondea_con_iva;

  // ---- Calculo de bruto y neto (via funcion pura, single source) ----
  const { precio_con_iva_final, precio_neto_derivado } =
    calcularNetoDerivado(precio, modo_input, alicuota, redondea_con_iva);

  // Drift: cuanto se movio el valor original respecto a lo persistido
  const drift = (modo_input === 'BRUTO')
    ? precio_con_iva_final - precio
    : precio_neto_derivado - precio;

  // ---- Upsert sobre precios ----
  // Mantenemos `precio` (legacy) sincronizado con `precio_neto_derivado`
  // hasta que F5 elimine la columna legacy.
  const upsertQ = await client.query(
    `INSERT INTO precios (
        id_empresa, id_producto, id_lista_precio,
        precio,
        precio_con_iva, precio_neto_calculado,
        fecha_redondeo, modo_redondeo_aplicado
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     ON CONFLICT (id_producto, id_lista_precio, id_empresa)
     DO UPDATE SET
        precio                = EXCLUDED.precio,
        precio_con_iva        = EXCLUDED.precio_con_iva,
        precio_neto_calculado = EXCLUDED.precio_neto_calculado,
        fecha_redondeo        = NOW(),
        modo_redondeo_aplicado = EXCLUDED.modo_redondeo_aplicado
     RETURNING precio_con_iva, precio_neto_calculado`,
    [
      id_empresa, id_producto, id_lista,
      precio_neto_derivado,
      precio_con_iva_final,
      precio_neto_derivado,
      `${contexto}|${modo_input}`
    ]
  );

  return {
    precio_con_iva:          parseFloat(upsertQ.rows[0].precio_con_iva),
    precio_neto_calculado:   parseFloat(upsertQ.rows[0].precio_neto_calculado),
    drift_vs_input:          Number(drift.toFixed(6)),
    alicuota_iva:            alicuota,
    redondeo_aplicado:       redondea_con_iva
  };
}

module.exports.escribirPrecio = escribirPrecio;
// =============================================================================
// FIN F2 - escribirPrecio
// =============================================================================
