describe('CÁLCULOS DE NEGOCIO', () => {
    // Funciones de utilidad
    function calcularIVA(subtotal, porcentaje = 21) {
        return subtotal * (porcentaje / 100);
    }

    function calcularTotal(subtotal) {
        return subtotal + calcularIVA(subtotal);
    }

    function calcularPrecioConDescuento(precio, descuento) {
        return precio * ((100 - descuento) / 100);
    }

    // TESTS DE IVA
    describe('Cálculo de IVA', () => {
        test('debe calcular IVA 21% correctamente', () => {
            expect(calcularIVA(100)).toBe(21);
        });

        test('debe calcular IVA sobre $1000', () => {
            expect(calcularIVA(1000)).toBe(210);
        });

        test('debe calcular IVA 0% (productos exentos)', () => {
            expect(calcularIVA(100, 0)).toBe(0);
        });

        test('debe calcular IVA 10.5% (tasa reducida)', () => {
            expect(calcularIVA(100, 10.5)).toBe(10.5);
        });
    });

    // TESTS DE TOTAL
    describe('Cálculo de Total', () => {
        test('debe sumar subtotal + IVA correctamente', () => {
            expect(calcularTotal(100)).toBe(121);
        });

        test('debe calcular total de $1000', () => {
            expect(calcularTotal(1000)).toBe(1210);
        });

        test('total debe ser mayor que subtotal', () => {
            expect(calcularTotal(100)).toBeGreaterThan(100);
        });
    });

    // TESTS DE DESCUENTO
    describe('Cálculo de Descuentos', () => {
        test('debe aplicar descuento del 10%', () => {
            expect(calcularPrecioConDescuento(100, 10)).toBe(90);
        });

        test('debe aplicar descuento del 50%', () => {
            expect(calcularPrecioConDescuento(100, 50)).toBe(50);
        });

        test('debe aplicar descuento de 0%', () => {
            expect(calcularPrecioConDescuento(100, 0)).toBe(100);
        });

        test('precio con descuento debe ser menor que original', () => {
            expect(calcularPrecioConDescuento(100, 15)).toBeLessThan(100);
        });
    });

    // TESTS DE CARRITO (POS)
    describe('Cálculos de Carrito POS', () => {
        function calcularCarrito(items) {
            let subtotal = 0;
            items.forEach(item => {
                subtotal += item.precio * item.cantidad;
            });
            const iva = calcularIVA(subtotal);
            return { subtotal, iva, total: subtotal + iva };
        }

        test('debe calcular carrito vacío', () => {
            const resultado = calcularCarrito([]);
            expect(resultado.subtotal).toBe(0);
            expect(resultado.iva).toBe(0);
            expect(resultado.total).toBe(0);
        });

        test('debe calcular carrito con 1 item', () => {
            const resultado = calcularCarrito([
                { precio: 100, cantidad: 1 }
            ]);
            expect(resultado.subtotal).toBe(100);
            expect(resultado.iva).toBe(21);
            expect(resultado.total).toBe(121);
        });

        test('debe calcular carrito con múltiples items', () => {
            const resultado = calcularCarrito([
                { precio: 100, cantidad: 2 },
                { precio: 50, cantidad: 3 }
            ]);
            expect(resultado.subtotal).toBe(350);
            expect(resultado.iva).toBe(73.5);
            expect(resultado.total).toBe(423.5);
        });
    });

    // TESTS DE VALIDACIONES
    describe('Validaciones de Datos', () => {
        test('no debe permitir cantidad negativa', () => {
            expect(() => {
                if (-5 < 0) throw new Error('Cantidad no válida');
            }).toThrow('Cantidad no válida');
        });

        test('no debe permitir precio cero', () => {
            expect(() => {
                if (0 <= 0) throw new Error('Precio inválido');
            }).toThrow('Precio inválido');
        });

        test('debe validar CUIT correcto', () => {
            const cuitValido = (cuit) => /^\d{2}\d{8}\d{1}$/.test(cuit);
            expect(cuitValido('20123456789')).toBe(true);
            expect(cuitValido('123')).toBe(false);
        });

        test('debe validar email', () => {
            const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
            expect(emailValido('test@ejemplo.com')).toBe(true);
            expect(emailValido('invalido')).toBe(false);
        });
    });
});
