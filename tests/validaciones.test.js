describe('VALIDACIONES DE CLIENTES', () => {
    class ClienteValidator {
        static validar(cliente) {
            const errores = [];

            if (!cliente.razon_social || cliente.razon_social.trim() === '') {
                errores.push('Razón social es requerida');
            }

            if (!cliente.cuit_cuil || cliente.cuit_cuil.trim() === '') {
                errores.push('CUIT/CUIL es requerido');
            } else if (!/^\d{2}\d{8}\d{1}$/.test(cliente.cuit_cuil)) {
                errores.push('CUIT/CUIL inválido');
            }

            if (cliente.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente.email)) {
                errores.push('Email inválido');
            }

            if (cliente.telefono && !/^\d{7,}$/.test(cliente.telefono.replace(/\D/g, ''))) {
                errores.push('Teléfono inválido');
            }

            return errores;
        }
    }

    test('debe aceptar cliente válido', () => {
        const cliente = {
            razon_social: 'Test SA',
            cuit_cuil: '20123456789',
            email: 'test@ejemplo.com',
            telefono: '1123456789'
        };
        const errores = ClienteValidator.validar(cliente);
        expect(errores).toHaveLength(0);
    });

    test('debe rechazar cliente sin razón social', () => {
        const cliente = { cuit_cuil: '20123456789' };
        const errores = ClienteValidator.validar(cliente);
        expect(errores).toContain('Razón social es requerida');
    });

    test('debe rechazar CUIT inválido', () => {
        const cliente = {
            razon_social: 'Test',
            cuit_cuil: '123'
        };
        const errores = ClienteValidator.validar(cliente);
        expect(errores).toContain('CUIT/CUIL inválido');
    });

    test('debe rechazar email inválido', () => {
        const cliente = {
            razon_social: 'Test',
            cuit_cuil: '20123456789',
            email: 'emailinvalido'
        };
        const errores = ClienteValidator.validar(cliente);
        expect(errores).toContain('Email inválido');
    });

    test('debe aceptar cliente sin email', () => {
        const cliente = {
            razon_social: 'Test',
            cuit_cuil: '20123456789'
        };
        const errores = ClienteValidator.validar(cliente);
        expect(errores).toHaveLength(0);
    });
});

describe('VALIDACIONES DE PRODUCTOS', () => {
    class ProductoValidator {
        static validar(producto) {
            const errores = [];

            if (!producto.sku || producto.sku.trim() === '') {
                errores.push('SKU es requerido');
            }

            if (!producto.nombre || producto.nombre.trim() === '') {
                errores.push('Nombre es requerido');
            }

            if (producto.precio_costo !== undefined && producto.precio_costo < 0) {
                errores.push('Precio de costo no puede ser negativo');
            }

            if (producto.precio_venta !== undefined && producto.precio_venta < 0) {
                errores.push('Precio de venta no puede ser negativo');
            }

            if (producto.precio_venta && producto.precio_costo && 
                producto.precio_venta < producto.precio_costo) {
                errores.push('Precio de venta debe ser mayor que costo');
            }

            return errores;
        }
    }

    test('debe aceptar producto válido', () => {
        const producto = {
            sku: 'TEST-001',
            nombre: 'Producto Test',
            precio_costo: 100,
            precio_venta: 150
        };
        const errores = ProductoValidator.validar(producto);
        expect(errores).toHaveLength(0);
    });

    test('debe rechazar producto sin SKU', () => {
        const producto = { nombre: 'Test' };
        const errores = ProductoValidator.validar(producto);
        expect(errores).toContain('SKU es requerido');
    });

    test('debe rechazar precio negativo', () => {
        const producto = {
            sku: 'TEST',
            nombre: 'Test',
            precio_costo: -100
        };
        const errores = ProductoValidator.validar(producto);
        expect(errores).toContain('Precio de costo no puede ser negativo');
    });

    test('debe rechazar precio venta menor que costo', () => {
        const producto = {
            sku: 'TEST',
            nombre: 'Test',
            precio_costo: 150,
            precio_venta: 100
        };
        const errores = ProductoValidator.validar(producto);
        expect(errores).toContain('Precio de venta debe ser mayor que costo');
    });
});
