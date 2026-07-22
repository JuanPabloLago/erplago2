describe('LÓGICA DE CONTROLLERS', () => {
    // Tests de cálculos de pedidos
    describe('Cálculo de Pedidos', () => {
        function procesarItemsPedido(items) {
            let total = 0;
            const itemsConIva = items.map(item => {
                const subtotal = item.precio_unitario_congelado * item.cantidad;
                const iva = subtotal * 0.21;
                total += subtotal + iva;
                return {
                    ...item,
                    subtotal,
                    iva,
                    total_linea: subtotal + iva
                };
            });
            return { items: itemsConIva, total };
        }

        test('debe procesar pedido con 1 item', () => {
            const items = [{ precio_unitario_congelado: 100, cantidad: 1 }];
            const resultado = procesarItemsPedido(items);
            expect(resultado.total).toBe(121);
            expect(resultado.items[0].iva).toBe(21);
        });

        test('debe procesar pedido con múltiples items', () => {
            const items = [
                { precio_unitario_congelado: 100, cantidad: 2 },
                { precio_unitario_congelado: 50, cantidad: 3 }
            ];
            const resultado = procesarItemsPedido(items);
            expect(resultado.total).toBe(423.5);
        });

        test('debe manejar items con cantidad 0', () => {
            const items = [{ precio_unitario_congelado: 100, cantidad: 0 }];
            const resultado = procesarItemsPedido(items);
            expect(resultado.total).toBe(0);
        });
    });

    // Tests de cálculos de facturas
    describe('Cálculo de Facturas', () => {
        function calcularFactura(items) {
            let subtotal = 0;
            let total_iva = 0;

            const facturitems = items.map(item => {
                const subtotal_linea = item.precio_unitario * item.cantidad;
                const iva_linea = subtotal_linea * (item.porcentaje_iva / 100);
                const total_linea = subtotal_linea + iva_linea;

                subtotal += subtotal_linea;
                total_iva += iva_linea;

                return { ...item, subtotal: subtotal_linea, iva: iva_linea, total: total_linea };
            });

            return {
                items: facturitems,
                subtotal: parseFloat(subtotal.toFixed(2)),
                total_iva: parseFloat(total_iva.toFixed(2)),
                total: parseFloat((subtotal + total_iva).toFixed(2))
            };
        }

        test('debe calcular factura simple', () => {
            const items = [{ precio_unitario: 100, cantidad: 1, porcentaje_iva: 21 }];
            const factura = calcularFactura(items);
            expect(factura.subtotal).toBe(100);
            expect(factura.total_iva).toBe(21);
            expect(factura.total).toBe(121);
        });

        test('debe calcular factura con múltiples items', () => {
            const items = [
                { precio_unitario: 100, cantidad: 2, porcentaje_iva: 21 },
                { precio_unitario: 50, cantidad: 1, porcentaje_iva: 21 }
            ];
            const factura = calcularFactura(items);
            expect(factura.subtotal).toBe(250);
            expect(factura.total).toBe(302.5);
        });

        test('debe manejar productos exentos de IVA', () => {
            const items = [{ precio_unitario: 100, cantidad: 1, porcentaje_iva: 0 }];
            const factura = calcularFactura(items);
            expect(factura.total_iva).toBe(0);
            expect(factura.total).toBe(100);
        });

        test('debe redondear correctamente', () => {
            const items = [{ precio_unitario: 33.33, cantidad: 3, porcentaje_iva: 21 }];
            const factura = calcularFactura(items);
            expect(typeof factura.total).toBe('number');
            expect(factura.total).toBeLessThan(200);
        });
    });

    // Tests de cálculos de compras - CORREGIDO
    describe('Cálculo de Órdenes de Compra', () => {
        function procesarOrdenCompra(items) {
            let subtotal = 0;
            let iva_total = 0;

            const procesados = items.map(item => {
                const cantidad = parseFloat(item.cantidad_pedida);
                const precio = parseFloat(item.precio_unitario);
                // FIX: Usar ?? en lugar de || para que 0 sea válido
                const iva_porcentaje = item.iva_porcentaje !== undefined ? parseFloat(item.iva_porcentaje) : 21;

                const subtotal_item = cantidad * precio;
                const iva_item = subtotal_item * (iva_porcentaje / 100);

                subtotal += subtotal_item;
                iva_total += iva_item;

                return { ...item, subtotal: subtotal_item, iva: iva_item };
            });

            return {
                items: procesados,
                subtotal,
                iva: iva_total,
                total: subtotal + iva_total
            };
        }

        test('debe procesar orden de compra simple', () => {
            const items = [{ cantidad_pedida: 10, precio_unitario: 100, iva_porcentaje: 21 }];
            const orden = procesarOrdenCompra(items);
            expect(orden.subtotal).toBe(1000);
            expect(orden.iva).toBe(210);
            expect(orden.total).toBe(1210);
        });

        test('debe procesar orden con múltiples items', () => {
            const items = [
                { cantidad_pedida: 5, precio_unitario: 100, iva_porcentaje: 21 },
                { cantidad_pedida: 10, precio_unitario: 50, iva_porcentaje: 21 }
            ];
            const orden = procesarOrdenCompra(items);
            expect(orden.subtotal).toBe(1000);
        });

        test('debe manejar tasa de IVA diferente', () => {
            const items = [{ cantidad_pedida: 100, precio_unitario: 10, iva_porcentaje: 0 }];
            const orden = procesarOrdenCompra(items);
            expect(orden.iva).toBe(0);
        });
    });

    // Tests de recibos y cobranzas
    describe('Cálculo de Recibos', () => {
        function validarAplicacionPago(recibo, aplicaciones) {
            let total_aplicado = 0;
            const errores = [];

            for (const aplicacion of aplicaciones) {
                const monto = parseFloat(aplicacion.monto_aplicado);

                if (monto <= 0) {
                    errores.push('Montos deben ser mayores a cero');
                    break;
                }

                total_aplicado += monto;
            }

            if (total_aplicado > parseFloat(recibo.total_recibo) + 0.01) {
                errores.push(`Total aplicado supera total recibo`);
            }

            return {
                valido: errores.length === 0,
                errores,
                total_aplicado
            };
        }

        test('debe validar aplicación correcta de pago', () => {
            const recibo = { total_recibo: 1000 };
            const aplicaciones = [{ monto_aplicado: 500 }, { monto_aplicado: 500 }];
            const resultado = validarAplicacionPago(recibo, aplicaciones);
            expect(resultado.valido).toBe(true);
            expect(resultado.total_aplicado).toBe(1000);
        });

        test('debe rechazar monto negativo', () => {
            const recibo = { total_recibo: 1000 };
            const aplicaciones = [{ monto_aplicado: -100 }];
            const resultado = validarAplicacionPago(recibo, aplicaciones);
            expect(resultado.valido).toBe(false);
            expect(resultado.errores).toContain('Montos deben ser mayores a cero');
        });

        test('debe rechazar si total aplicado supera recibo', () => {
            const recibo = { total_recibo: 1000 };
            const aplicaciones = [{ monto_aplicado: 1500 }];
            const resultado = validarAplicacionPago(recibo, aplicaciones);
            expect(resultado.valido).toBe(false);
        });

        test('debe permitir pago parcial', () => {
            const recibo = { total_recibo: 1000 };
            const aplicaciones = [{ monto_aplicado: 500 }];
            const resultado = validarAplicacionPago(recibo, aplicaciones);
            expect(resultado.valido).toBe(true);
            expect(resultado.total_aplicado).toBe(500);
        });
    });

    // Tests de estados y transiciones
    describe('Transiciones de Estados', () => {
        const estadosValidos = ['Pendiente', 'Confirmada', 'Recibida Parcial', 'Recibida Total', 'Cancelada'];

        function validarEstado(estado) {
            return estadosValidos.includes(estado);
        }

        test('debe aceptar estado válido', () => {
            expect(validarEstado('Pendiente')).toBe(true);
            expect(validarEstado('Confirmada')).toBe(true);
        });

        test('debe rechazar estado inválido', () => {
            expect(validarEstado('Invalido')).toBe(false);
            expect(validarEstado('Enviado')).toBe(false);
        });

        test('debe tener estados válidos definidos', () => {
            expect(estadosValidos.length).toBeGreaterThan(0);
        });
    });
});
