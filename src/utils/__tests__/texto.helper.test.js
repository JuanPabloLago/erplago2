const t = require('../texto.helper');

describe('normalizarEspacios', () => {
    test('colapsa espacios multiples', () => {
        expect(t.normalizarEspacios('LIJA   GR.    80')).toBe('LIJA GR. 80');
    });
    test('null/undefined vacio', () => {
        expect(t.normalizarEspacios(null)).toBe('');
        expect(t.normalizarEspacios(undefined)).toBe('');
    });
});

describe('limpiarSufijosBasura', () => {
    test('elimina /// al final', () => {
        expect(t.limpiarSufijosBasura('DISCO LIJA 12 ///')).toBe('DISCO LIJA 12');
    });
    test('elimina // al final', () => {
        expect(t.limpiarSufijosBasura('CARBON //')).toBe('CARBON');
    });
    test('no toca / del medio', () => {
        expect(t.limpiarSufijosBasura('LIJA /DOBLE A')).toBe('LIJA /DOBLE A');
    });
    test('idempotente', () => {
        const a = t.limpiarSufijosBasura('X ///');
        expect(t.limpiarSufijosBasura(a)).toBe(a);
    });
});

describe('separarMarcaPegada', () => {
    test('BALANZA/IMPORTADO con espacios', () => {
        expect(t.separarMarcaPegada('BALANZA/IMPORTADO')).toBe('BALANZA / IMPORTADO');
    });
    test('no toca slash ya separado', () => {
        expect(t.separarMarcaPegada('LIJA / DOBLE A')).toBe('LIJA / DOBLE A');
    });
});

describe('normalizarNumeroTrasPunto', () => {
    test('GR.80 a GR. 80', () => {
        expect(t.normalizarNumeroTrasPunto('GR.80')).toBe('GR. 80');
    });
    test('no toca decimales', () => {
        expect(t.normalizarNumeroTrasPunto('3.14')).toBe('3.14');
    });
});

describe('normalizarNombreProducto pipeline', () => {
    test('caso real con sufijo y numero pegado', () => {
        expect(t.normalizarNombreProducto('DISCO DE LIJA 115 GR.80     /DOBLE A'))
            .toBe('DISCO DE LIJA 115 GR. 80 / DOBLE A');
    });
    test('caso real con triple slash', () => {
        expect(t.normalizarNombreProducto('DISCO DE LIJA 178 GR. 16     / DOBLE A ///'))
            .toBe('DISCO DE LIJA 178 GR. 16 / DOBLE A');
    });
    test('idempotente', () => {
        const once = t.normalizarNombreProducto('DISCO DE LIJA 115 GR.80   /DOBLE A ///');
        expect(t.normalizarNombreProducto(once)).toBe(once);
    });
});

describe('compararNatural BUG DE LAS LIJAS', () => {
    test('GR. 80 antes que GR. 100', () => {
        expect(t.compararNatural('DISCO GR. 80', 'DISCO GR. 100')).toBeLessThan(0);
    });
    test('orden completo de lijas', () => {
        const input = [
            'DISCO DE LIJA 115 GR. 100',
            'DISCO DE LIJA 115 GR. 12',
            'DISCO DE LIJA 115 GR. 80',
            'DISCO DE LIJA 115 GR. 24',
            'DISCO DE LIJA 115 GR. 16'
        ];
        expect([...input].sort(t.compararNatural)).toEqual([
            'DISCO DE LIJA 115 GR. 12',
            'DISCO DE LIJA 115 GR. 16',
            'DISCO DE LIJA 115 GR. 24',
            'DISCO DE LIJA 115 GR. 80',
            'DISCO DE LIJA 115 GR. 100'
        ]);
    });
});
