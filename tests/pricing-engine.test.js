'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const engine = require('../src/utils/pricing-engine.helper');

// El invariante central: total_linea = subtotal_neto + monto_iva (tolerancia 1 centavo por floats)
function assertInvariante(r) {
    const diff = Math.abs((r.subtotal_neto + r.monto_iva) - r.total_linea);
    assert.ok(diff < 0.01, `Invariante violado: neto(${r.subtotal_neto}) + iva(${r.monto_iva}) != total(${r.total_linea}), diff=${diff}`);
}

const AL_PESO = { redondeo_modo: 'al_peso', redondeo_unidad: 1 };
const DOS_DEC = { redondeo_modo: 'dos_decimales', redondeo_unidad: 0.01 };

test('bug historico: 350 x 330.5785 neto IVA21 al_peso = 140000 clavado', () => {
    const r = engine.calcularLinea({ cantidad: 350, precio_unit_neto: 330.5785, iva_porcentaje: 21, config: AL_PESO });
    assert.strictEqual(r.total_linea, 140000);
    assert.strictEqual(r.subtotal_neto, 115702.48);
    assert.strictEqual(r.monto_iva, 24297.52);
    assertInvariante(r);
});

test('item negativo: -1 x 4601 bruto IVA21 al_peso = -4601 (pedido 9653 COES.R)', () => {
    const r = engine.calcularLinea({ cantidad: -1, precio_unit_bruto: 4601, iva_porcentaje: 21, config: AL_PESO });
    assert.strictEqual(r.total_linea, -4601);
    assert.ok(r.subtotal_neto < 0, 'neto debe ser negativo');
    assert.ok(r.monto_iva < 0, 'iva debe ser negativo');
    assertInvariante(r);
});

test('cantidad 0 devuelve todo en 0', () => {
    const r = engine.calcularLinea({ cantidad: 0, precio_unit_neto: 100, iva_porcentaje: 21, config: AL_PESO });
    assert.strictEqual(r.total_linea, 0);
    assert.strictEqual(r.subtotal_neto, 0);
    assert.strictEqual(r.monto_iva, 0);
});

test('IVA 10.5%: 3 x 1500.50 neto dos_decimales', () => {
    const r = engine.calcularLinea({ cantidad: 3, precio_unit_neto: 1500.50, iva_porcentaje: 10.5, config: DOS_DEC });
    assertInvariante(r);
    assert.ok(r.total_linea > 4900 && r.total_linea < 5000);
});

test('IVA 27%: 10 x 200 neto al_peso', () => {
    const r = engine.calcularLinea({ cantidad: 10, precio_unit_neto: 200, iva_porcentaje: 27, config: AL_PESO });
    assertInvariante(r);
});

test('IVA 0% (exento): neto = total, iva = 0', () => {
    const r = engine.calcularLinea({ cantidad: 5, precio_unit_neto: 1000, iva_porcentaje: 0, config: AL_PESO });
    assert.strictEqual(r.monto_iva, 0);
    assert.strictEqual(r.subtotal_neto, r.total_linea);
    assertInvariante(r);
});

test('descuento 10% reduce el total', () => {
    const sin = engine.calcularLinea({ cantidad: 100, precio_unit_neto: 500, iva_porcentaje: 21, config: AL_PESO });
    const con = engine.calcularLinea({ cantidad: 100, precio_unit_neto: 500, iva_porcentaje: 21, descuento_pct: 10, config: AL_PESO });
    assert.ok(con.total_linea < sin.total_linea, 'con descuento debe ser menor');
    assertInvariante(con);
});

test('descuento 100% deja total en 0', () => {
    const r = engine.calcularLinea({ cantidad: 50, precio_unit_neto: 300, iva_porcentaje: 21, descuento_pct: 100, config: AL_PESO });
    assert.strictEqual(r.total_linea, 0);
});

test('cantidad decimal (kg): 2.5 x 800 neto al_peso', () => {
    const r = engine.calcularLinea({ cantidad: 2.5, precio_unit_neto: 800, iva_porcentaje: 21, config: AL_PESO });
    assertInvariante(r);
});

test('error si falta precio (ni neto ni bruto)', () => {
    assert.throws(() => engine.calcularLinea({ cantidad: 1, iva_porcentaje: 21, config: AL_PESO }), /precio_unit/);
});

test('error si descuento > 100', () => {
    assert.throws(() => engine.calcularLinea({ cantidad: 1, precio_unit_neto: 100, iva_porcentaje: 21, descuento_pct: 150, config: AL_PESO }), /descuento_pct/);
});

test('error si iva negativo', () => {
    assert.throws(() => engine.calcularLinea({ cantidad: 1, precio_unit_neto: 100, iva_porcentaje: -5, config: AL_PESO }), /iva_porcentaje/);
});

test('invariante se mantiene en 200 combinaciones random al_peso', () => {
    for (let i = 0; i < 200; i++) {
        const cant = Math.floor(Math.random() * 1000) - 500 || 1;
        const neto = Math.round(Math.random() * 100000 * 100) / 100;
        const iva = [0, 10.5, 21, 27][Math.floor(Math.random() * 4)];
        const r = engine.calcularLinea({ cantidad: cant, precio_unit_neto: neto, iva_porcentaje: iva, config: AL_PESO });
        assertInvariante(r);
    }
});

// ===== F6-B-REANCLA: nivel unidad_bruto + cross-foot AFIP =====
function _r2(x) { return Math.round(x * 100) / 100; }
const AL_PESO_UB = { redondeo_modo: 'al_peso', redondeo_unidad: 1, redondeo_nivel: 'unidad_bruto' };

test('unidad_bruto: 350 x 330.5785 neto IVA21 = 140000 (bruto_unit=400)', () => {
    const r = engine.calcularLinea({ cantidad: 350, precio_unit_neto: 330.5785, iva_porcentaje: 21, config: AL_PESO_UB });
    assert.strictEqual(r.total_linea, 140000);
    assert.strictEqual(r.ancla_aplicada, engine.ANCLAS.BRUTO_UNIT_ENTERO);
    assertInvariante(r);
});

test('unidad_bruto vs total DIVERGEN: neto 330.99 x3 IVA21 -> UB=1200, TOTAL=1201', () => {
    const ub  = engine.calcularLinea({ cantidad: 3, precio_unit_neto: 330.99, iva_porcentaje: 21, config: AL_PESO_UB });
    const tot = engine.calcularLinea({ cantidad: 3, precio_unit_neto: 330.99, iva_porcentaje: 21, config: { redondeo_modo: 'al_peso', redondeo_unidad: 1, redondeo_nivel: 'total' } });
    assert.strictEqual(ub.total_linea, 1200);
    assert.strictEqual(tot.total_linea, 1201);
    assertInvariante(ub); assertInvariante(tot);
});

test('unidad_bruto: bruto soberano cargado se usa verbatim (precio_con_iva 400 x3 = 1200)', () => {
    const r = engine.calcularLinea({ cantidad: 3, precio_unit_bruto: 400, iva_porcentaje: 21, config: AL_PESO_UB });
    assert.strictEqual(r.total_linea, 1200);
    assertInvariante(r);
});

test('AFIP cross-foot: suma de lineas cierra exacto 10048 (1 alicuota 21%)', () => {
    const lineas = [
        engine.calcularLinea({ cantidad: 3, precio_unit_neto: 330.99,  iva_porcentaje: 21, config: AL_PESO_UB }),
        engine.calcularLinea({ cantidad: 7, precio_unit_neto: 118.40,  iva_porcentaje: 21, config: AL_PESO_UB }),
        engine.calcularLinea({ cantidad: 1, precio_unit_neto: 2540.10, iva_porcentaje: 21, config: AL_PESO_UB })
    ];
    const ImpNeto  = _r2(lineas.reduce((a, l) => a + l.subtotal_neto, 0));
    const ImpIVA   = _r2(lineas.reduce((a, l) => a + l.monto_iva, 0));
    const ImpTotal = _r2(lineas.reduce((a, l) => a + l.total_linea, 0));
    assert.ok(Math.abs(ImpTotal - (ImpNeto + ImpIVA)) < 0.005, `10048: ${ImpTotal} != ${ImpNeto}+${ImpIVA}`);
});
