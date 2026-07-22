-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Control de Acceso a Módulos por Rol
-- ERP LAGO - 2026-02-24
-- Ejecutar: PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f migration_modulos.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. TABLA: modulos (catálogo maestro)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS modulos (
    id_modulo       SERIAL PRIMARY KEY,
    codigo          VARCHAR(50) UNIQUE NOT NULL,
    nombre          VARCHAR(100) NOT NULL,
    descripcion     VARCHAR(255),
    icono           VARCHAR(50),
    url_frontend    VARCHAR(100) NOT NULL,
    grupo           VARCHAR(50) NOT NULL,
    orden           INTEGER DEFAULT 0,
    requiere_turno  BOOLEAN DEFAULT FALSE,
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modulos_grupo ON modulos(grupo);
CREATE INDEX IF NOT EXISTS idx_modulos_activo ON modulos(activo);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. TABLA: rol_modulos (qué rol accede a qué módulo)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rol_modulos (
    id_rol_modulo   SERIAL PRIMARY KEY,
    rol             VARCHAR(50) NOT NULL,
    id_modulo       INTEGER NOT NULL REFERENCES modulos(id_modulo) ON DELETE CASCADE,
    puede_ver       BOOLEAN DEFAULT TRUE,
    solo_lectura    BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(rol, id_modulo)
);

CREATE INDEX IF NOT EXISTS idx_rol_modulos_rol ON rol_modulos(rol);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. TABLA: modulo_rutas_api (qué rutas API pertenecen a cada módulo)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS modulo_rutas_api (
    id              SERIAL PRIMARY KEY,
    id_modulo       INTEGER NOT NULL REFERENCES modulos(id_modulo) ON DELETE CASCADE,
    prefijo_ruta    VARCHAR(100) NOT NULL,
    UNIQUE(prefijo_ruta)
);

CREATE INDEX IF NOT EXISTS idx_modulo_rutas_modulo ON modulo_rutas_api(id_modulo);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. SEED: Catálogo de módulos
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO modulos (codigo, nombre, descripcion, icono, url_frontend, grupo, orden, requiere_turno) VALUES
-- VENTAS
('venta-rapida',       'Venta Rápida',          'Punto de venta mostrador',          'fa-cash-register',      '/venta-rapida.html',          'ventas',     10, true),
('presupuestos',       'Presupuestos',          'Gestión de presupuestos',           'fa-file-invoice',       '/presupuestos.html',          'ventas',     20, false),
('facturas',           'Facturas',              'Facturación electrónica',           'fa-file-invoice-dollar', '/facturas.html',             'ventas',     30, false),
('notas',              'Notas Crédito/Débito',  'Notas de crédito y débito',         'fa-file-alt',           '/notas.html',                 'ventas',     40, false),
('cuenta-corriente',   'Cuenta Corriente',      'Cta. Cte. clientes',               'fa-balance-scale',      '/cuenta-corriente.html',      'ventas',     50, false),
-- DESPACHOS
('despachos',          'Gestión Despachos',     'Viajes, remitos, entregas',         'fa-truck',              '/gestion-despachos.html',     'despachos',  10, false),
('remitos',            'Remitos',               'Consulta de remitos',               'fa-clipboard-list',     '/remitos.html',               'despachos',  20, false),
-- INVENTARIO
('productos',          'Productos',             'ABM de productos',                  'fa-boxes-stacked',      '/productos.html',             'inventario', 10, false),
('inventario',         'Inventario',            'Stock y movimientos',               'fa-warehouse',          '/inventario.html',            'inventario', 20, false),
('categorias',         'Categorías',            'Categorías de productos',           'fa-sitemap',            '/categorias.html',            'inventario', 30, false),
('marcas',             'Marcas',                'Marcas de productos',               'fa-tag',                '/marcas.html',                'inventario', 40, false),
('variantes',          'Variantes',             'Variantes de productos',            'fa-palette',            '/variantes.html',             'inventario', 50, false),
-- COMPRAS
('compras',            'Compras',               'Comprobantes de compra',            'fa-cart-shopping',      '/compras-nueva.html',         'compras',    10, false),
('proveedores',        'Proveedores',           'ABM de proveedores',                'fa-building',           '/proveedores.html',           'compras',    20, false),
('pagos-proveedores',  'Pagos a Proveedores',   'Órdenes de pago',                  'fa-money-check',        '/pagos-proveedores.html',     'compras',    30, false),
-- TESORERÍA
('tesoreria',          'Tesorería',             'Caja, cobranzas, recibos',          'fa-vault',              '/tesoreria.html',             'tesoreria',  10, true),
-- REPORTES
('dashboard',          'Dashboard',             'Panel de indicadores',              'fa-chart-pie',          '/dashboard.html',             'reportes',   10, false),
('reportes',           'Reportes',              'Reportes y estadísticas',           'fa-chart-bar',          '/reportes.html',              'reportes',   20, false),
('historial',          'Historial Movimientos', 'Historial de operaciones',          'fa-clock-rotate-left',  '/historial-movimientos.html', 'reportes',   30, false),
('libro-iva',          'Libro IVA',             'Libro IVA ventas',                  'fa-book',               '/libro-iva.html',             'reportes',   40, false),
-- CLIENTES
('clientes',           'Clientes',              'ABM de clientes',                   'fa-users',              '/clientes.html',              'clientes',   10, false),
-- ADMINISTRACIÓN
('admin-usuarios',     'Usuarios',              'Gestión de usuarios y roles',       'fa-user-cog',           '/admin-usuarios.html',        'admin',      10, false),
('configuraciones',    'Configuraciones',       'Parametrización del sistema',       'fa-gears',              '/configuraciones.html',       'admin',      20, false),
('backup',             'Backup',                'Respaldo de base de datos',         'fa-database',           '/backup.html',                'admin',      30, false),
('listas-precios',     'Listas de Precios',     'Config. listas y recargos',         'fa-money-bill',         '/admin-listas-precios.html',  'admin',      40, false)
ON CONFLICT (codigo) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. SEED: Mapeo rutas API → módulos
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO modulo_rutas_api (id_modulo, prefijo_ruta) VALUES
-- venta-rapida
((SELECT id_modulo FROM modulos WHERE codigo = 'venta-rapida'), '/api/pedidos'),
((SELECT id_modulo FROM modulos WHERE codigo = 'venta-rapida'), '/api/borrador'),
((SELECT id_modulo FROM modulos WHERE codigo = 'venta-rapida'), '/api/pagos-confirmacion'),
((SELECT id_modulo FROM modulos WHERE codigo = 'venta-rapida'), '/api/pagos'),
-- presupuestos
((SELECT id_modulo FROM modulos WHERE codigo = 'presupuestos'), '/api/presupuestos'),
-- facturas
((SELECT id_modulo FROM modulos WHERE codigo = 'facturas'), '/api/facturas'),
((SELECT id_modulo FROM modulos WHERE codigo = 'facturas'), '/api/comprobante-venta'),
-- despachos + remitos
((SELECT id_modulo FROM modulos WHERE codigo = 'despachos'), '/api/despachos'),
-- productos
((SELECT id_modulo FROM modulos WHERE codigo = 'productos'), '/api/productos'),
((SELECT id_modulo FROM modulos WHERE codigo = 'productos'), '/api/conjuntos'),
-- inventario
((SELECT id_modulo FROM modulos WHERE codigo = 'inventario'), '/api/inventario'),
((SELECT id_modulo FROM modulos WHERE codigo = 'inventario'), '/api/ajustes-inventario'),
-- categorias
((SELECT id_modulo FROM modulos WHERE codigo = 'categorias'), '/api/categorias'),
-- marcas
((SELECT id_modulo FROM modulos WHERE codigo = 'marcas'), '/api/marcas'),
-- variantes
((SELECT id_modulo FROM modulos WHERE codigo = 'variantes'), '/api/variantes'),
-- compras
((SELECT id_modulo FROM modulos WHERE codigo = 'compras'), '/api/compras-nueva'),
((SELECT id_modulo FROM modulos WHERE codigo = 'compras'), '/api/compras'),
-- proveedores
((SELECT id_modulo FROM modulos WHERE codigo = 'proveedores'), '/api/proveedores'),
-- pagos-proveedores
((SELECT id_modulo FROM modulos WHERE codigo = 'pagos-proveedores'), '/api/pagos-proveedores'),
-- tesoreria
((SELECT id_modulo FROM modulos WHERE codigo = 'tesoreria'), '/api/cajas-cobranzas'),
((SELECT id_modulo FROM modulos WHERE codigo = 'tesoreria'), '/api/recibos'),
-- cobranzas (cuenta corriente)
((SELECT id_modulo FROM modulos WHERE codigo = 'cuenta-corriente'), '/api/cobranzas'),
-- reportes
((SELECT id_modulo FROM modulos WHERE codigo = 'dashboard'), '/api/reportes'),
((SELECT id_modulo FROM modulos WHERE codigo = 'historial'), '/api/historial-movimientos'),
-- clientes
((SELECT id_modulo FROM modulos WHERE codigo = 'clientes'), '/api/clientes'),
-- admin
((SELECT id_modulo FROM modulos WHERE codigo = 'admin-usuarios'), '/api/admin'),
((SELECT id_modulo FROM modulos WHERE codigo = 'backup'), '/api/backup'),
-- cheques (asociado a tesorería)
((SELECT id_modulo FROM modulos WHERE codigo = 'tesoreria'), '/api/cheques-terceros'),
-- recargos (asociado a listas-precios)
((SELECT id_modulo FROM modulos WHERE codigo = 'listas-precios'), '/api/recargos-forma-pago')
ON CONFLICT (prefijo_ruta) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. SEED: Permisos por rol
-- ═══════════════════════════════════════════════════════════════════════════

-- ADMIN: acceso TOTAL a todos los módulos
INSERT INTO rol_modulos (rol, id_modulo, puede_ver, solo_lectura)
SELECT 'admin', id_modulo, TRUE, FALSE
FROM modulos WHERE activo = TRUE
ON CONFLICT (rol, id_modulo) DO NOTHING;

-- ADMINISTRADOR: todo MENOS backup y usuarios
INSERT INTO rol_modulos (rol, id_modulo, puede_ver, solo_lectura)
SELECT 'administrador', id_modulo, TRUE, FALSE
FROM modulos
WHERE activo = TRUE
  AND codigo NOT IN ('backup', 'admin-usuarios')
ON CONFLICT (rol, id_modulo) DO NOTHING;

-- VENDEDOR: solo lo esencial para vender
INSERT INTO rol_modulos (rol, id_modulo, puede_ver, solo_lectura)
SELECT 'vendedor', m.id_modulo, TRUE,
       CASE WHEN m.codigo IN ('clientes', 'productos') THEN TRUE ELSE FALSE END
FROM modulos m
WHERE m.activo = TRUE
  AND m.codigo IN ('venta-rapida', 'presupuestos', 'clientes', 'productos')
ON CONFLICT (rol, id_modulo) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. VERIFICACIÓN
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    RAISE NOTICE '════════════════════════════════════════════';
    RAISE NOTICE '✅ Migración completada exitosamente';
    RAISE NOTICE '════════════════════════════════════════════';
    RAISE NOTICE 'Módulos creados: %', (SELECT COUNT(*) FROM modulos);
    RAISE NOTICE 'Rutas API mapeadas: %', (SELECT COUNT(*) FROM modulo_rutas_api);
    RAISE NOTICE 'Permisos rol admin: %', (SELECT COUNT(*) FROM rol_modulos WHERE rol = 'admin');
    RAISE NOTICE 'Permisos rol administrador: %', (SELECT COUNT(*) FROM rol_modulos WHERE rol = 'administrador');
    RAISE NOTICE 'Permisos rol vendedor: %', (SELECT COUNT(*) FROM rol_modulos WHERE rol = 'vendedor');
    RAISE NOTICE '════════════════════════════════════════════';
END $$;

COMMIT;
