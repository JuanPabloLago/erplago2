const pool = require('../config/database');
const adminHelper = require('../utils/admin.helper');
const permisosHelper = require('../utils/permisos.helper');
const stockHelper = require('../utils/stock.helper');
const productosHelper = require('../utils/productos.helper');
const ivaHelper = require('../utils/iva.helper');
const cfg = require('../utils/config.helper');
const validadorImagenUrl = require('../utils/validador-imagen-url.helper');

/**
 * PRODUCTOS CONTROLLER - ERP LAGO
 * Módulo completo de gestión de productos
 *
 * MIGRADO: Todas las escrituras a productos, precios, inventario (config),
 *          producto_proveedor y productocodigosbarras van via productos.helper.js
 *
 * Mejoras:
 * - Búsqueda inteligente (SKU, nombre, marca, proveedor, código)
 * - Filtros por proveedor y conjunto
 * - Operaciones masivas (ajuste precios, activar/desactivar)
 * - Ordenamiento completo
 */

const productosController = {

    // ========================================================================
    // BÚSQUEDA INTELIGENTE
    // ========================================================================

    async buscar(req, res) {
        const { q, id_lista_precio } = req.query;
        const { id_empresa } = req.usuario;
        const listaDefault = parseInt(await cfg.get(pool, id_empresa, 'venta_rapida.lista_precio_default', 1), 10);
        const listaPrecios = parseInt(id_lista_precio) || listaDefault;

        if (!q || q.trim().length < 1) {
            return res.json({ results: [] });
        }

        try {
            const searchTerms = q.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);

            if (searchTerms.length === 0) {
                return res.json({ results: [] });
            }

            const termConditions = searchTerms.map((_, idx) =>
                `p.busqueda_vector ILIKE $${idx + 4}`
            ).join(' AND ');

            const searchParams = searchTerms.map(term => `%${term}%`);

            const searchQuery = `
                SELECT * FROM (
                    SELECT DISTINCT ON (p.id_producto)
                        p.id_producto,
                        p.sku,
                        p.nombre,
                        p.descripcion,
                        p.url_imagen,
                        p.unidad_medida,
                        m.nombre as marca,
                        COALESCE(i.stock_real, 0) as stock_real,
                        COALESCE(i.stock_minimo, 0) as stock_minimo,
                        COALESCE(pr.precio, 0) as precio,
                        prov.razon_social as proveedor_nombre,
                        p.id_alicuota_iva,
                        COALESCE(a.porcentaje, 0)::numeric as iva_porcentaje,
                        CASE
                            WHEN pcb.codigo_barras = $2 THEN 1
                            WHEN UPPER(p.sku) = UPPER($2) THEN 2
                            ELSE 3
                        END as ranking
                    FROM productos p
                    LEFT JOIN productocodigosbarras pcb ON p.id_producto = pcb.id_producto
                    LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
                    LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_lista_precio = $3
                    LEFT JOIN marcas m ON p.id_marca = m.id_marca
                    LEFT JOIN producto_proveedor pp ON p.id_producto = pp.id_producto AND pp.id_empresa = $1
                    LEFT JOIN proveedores prov ON pp.id_proveedor = prov.id_proveedor
                    LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
                    WHERE p.activo = TRUE
                    AND (
                        pcb.codigo_barras = $2
                        OR UPPER(p.sku) = UPPER($2)
                        OR (${termConditions})
                    )
                    ORDER BY p.id_producto, ranking
                ) sub
                ORDER BY ranking, id_producto
                LIMIT 15
            `;
            const params = [id_empresa, q.trim(), listaPrecios, ...searchParams];
            const { rows } = await pool.query(searchQuery, params);
            rows.sort((a, b) => a.ranking - b.ranking);
            res.json({ results: rows });
        } catch (error) {
            console.error('❌ Error en búsqueda de productos:', error.message);
            res.status(500).json({ error: 'Error al buscar productos' });
        }
    },

    // ========================================================================
    // LISTAR CON FILTROS AVANZADOS
    // ========================================================================

    async listar(req, res) {
        const { id_empresa } = req.usuario;
        const {
            id_lista_precio = 1,
            id_categoria,
            id_subcategoria,
            id_marca,
            id_proveedor,
            id_conjunto,
            stock_bajo,
            solo_activos = 'true',
            activo,
            visible_web,
            buscar,
            estado,   // 2026-05-21: tri-estado activos|inactivos|todos
            incluir_inactivos,   // 2026-05-21: toggle mostrar inactivos al final
            limite,   // Bloque P1: el default ahora viene de config, no hardcoded
            offset = 0,
            ordenar = 'nombre',
            direccion = 'ASC'
        } = req.query;

        try {
            // Bloque P1: limite con default desde config + cap maximo (cero hardcoding).
            // Si el cliente manda limite valido, se respeta hasta el cap.
            // Si no manda nada, se usa productos.listado.items_por_pagina.
            const _limDef = parseInt(await cfg.get(pool, id_empresa, 'productos.listado.items_por_pagina', 400)) || 400;
            const _limMax = parseInt(await cfg.get(pool, id_empresa, 'productos.listado.items_por_pagina_max', 1000)) || 1000;
            const _limIn  = parseInt(limite);
            const limiteFinal = Math.min(Number.isFinite(_limIn) && _limIn > 0 ? _limIn : _limDef, _limMax);

            const condiciones = [];
            const params = [id_empresa, parseInt(id_lista_precio) || 1];
            let paramIndex = 3;

            // 2026-05-21: incluir_inactivos override (trae ambos, inactivos al final)
            const _traerInactivos = (incluir_inactivos === 'true' || incluir_inactivos === true);
            if (estado === 'inactivos') {
                condiciones.push('p.activo = FALSE');
            } else if (estado === 'activos') {
                condiciones.push('p.activo = TRUE');
            } else if (estado === 'todos' || _traerInactivos) {
                // No filtra (trae ambos)
            } else if (solo_activos === 'true' && !activo) {
                condiciones.push('p.activo = TRUE');
            }
            if (activo === '1') {
                condiciones.push('p.activo = TRUE');
            } else if (activo === '0') {
                condiciones.push('p.activo = FALSE');
            }
            if (visible_web === '1') {
                condiciones.push('p.visible_web = TRUE');
            } else if (visible_web === '0') {
                condiciones.push('p.visible_web = FALSE');
            }

            if (id_categoria) {
                condiciones.push(`p.id_categoria = $${paramIndex++}`);
                params.push(parseInt(id_categoria));
            }
            if (id_subcategoria) {
                condiciones.push(`p.id_subcategoria = $${paramIndex++}`);
                params.push(parseInt(id_subcategoria));
            }
            if (id_marca) {
                condiciones.push(`p.id_marca = $${paramIndex++}`);
                params.push(parseInt(id_marca));
            }
            if (id_proveedor) {
                condiciones.push(`EXISTS (
                    SELECT 1 FROM producto_proveedor pp
                    WHERE pp.id_producto = p.id_producto
                    AND pp.id_empresa = $1
                    AND pp.id_proveedor = $${paramIndex++}
                )`);
                params.push(parseInt(id_proveedor));
            }
            if (id_conjunto) {
                condiciones.push(`EXISTS (
                    SELECT 1 FROM conjunto_items ci
                    WHERE ci.id_producto = p.id_producto
                    AND ci.id_conjunto = $${paramIndex++}
                )`);
                params.push(parseInt(id_conjunto));
            }
            if (stock_bajo === 'true') {
                condiciones.push(`COALESCE(i.stock_real, 0) <= COALESCE(i.stock_minimo, 0)`);
            }
            if (buscar && buscar.trim()) {
                // Multi-palabra: cada término debe aparecer en busqueda_vector
                const searchTerms = buscar.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
                if (searchTerms.length === 1) {
                    const searchPattern = `%${searchTerms[0]}%`;
                    condiciones.push(`(
                        LOWER(p.sku) LIKE LOWER($${paramIndex})
                        OR LOWER(p.nombre) LIKE LOWER($${paramIndex})
                        OR LOWER(m.nombre) LIKE LOWER($${paramIndex})
                        OR EXISTS (
                            SELECT 1 FROM productocodigosbarras pcb
                            WHERE pcb.id_producto = p.id_producto
                            AND pcb.codigo_barras LIKE $${paramIndex}
                        )
                        OR EXISTS (
                            SELECT 1 FROM producto_proveedor pp2
                            JOIN proveedores prov2 ON pp2.id_proveedor = prov2.id_proveedor
                            WHERE pp2.id_producto = p.id_producto AND pp2.id_empresa = $1
                            AND (LOWER(prov2.razon_social) LIKE LOWER($${paramIndex}) OR LOWER(pp2.codigo_proveedor) LIKE LOWER($${paramIndex}))
                        )
                    )`);
                    params.push(searchPattern);
                    paramIndex++;
                } else {
                    const termConds = searchTerms.map(t => {
                        params.push(`%${t}%`);
                        return `p.busqueda_vector ILIKE $${paramIndex++}`;
                    });
                    condiciones.push(`(${termConds.join(' AND ')})`);
                }
            }

            const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

            const columnasOrden = {
                'sku': 'p.sku',
                'nombre': 'p.nombre',
                'categoria': 'c.nombre',
                'marca': 'm.nombre',
                'stock': 'stock_real',
                'precio': 'precio',
                'fecha_creacion': 'p.fecha_creacion'
            };
            const ordenarPor = columnasOrden[ordenar] || 'p.nombre';
            const dir = direccion.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

            const query = `
                SELECT
                    p.id_producto, p.sku, p.nombre, p.descripcion, p.url_imagen,
                    p.unidad_medida, p.cod_proveedor, p.tiene_variantes, p.activo,
                    p.visible_web, p.fecha_creacion,
                    p.id_categoria, c.nombre as categoria,
                    p.id_subcategoria, cs.nombre as subcategoria,
                    p.id_marca, m.nombre as marca,
                    p.id_alicuota_iva, a.porcentaje as iva_porcentaje,
                    COALESCE(i.stock_real, 0) as stock_real,
                    COALESCE(i.stock_minimo, 0) as stock_minimo,
                    COALESCE(i.stock_maximo, 0) as stock_maximo,
                    CASE
                        WHEN COALESCE(i.stock_real, 0) <= 0 THEN 'critico'
                        WHEN COALESCE(i.stock_real, 0) <= COALESCE(i.stock_minimo, 0) THEN 'bajo'
                        WHEN COALESCE(i.stock_real, 0) >= COALESCE(i.stock_maximo, 0) AND COALESCE(i.stock_maximo, 0) > 0 THEN 'exceso'
                        ELSE 'ok'
                    END as estado_stock,
                    COALESCE(pr.precio, 0) as precio,
                    (
                        SELECT json_agg(json_build_object(
                            'id_lista', lp.id_lista_precio, 'nombre_lista', lp.nombre,
                            'precio', COALESCE(pr2.precio, 0)
                        ) ORDER BY lp.id_lista_precio)
                        FROM listasdeprecios lp
                        LEFT JOIN precios pr2 ON pr2.id_producto = p.id_producto AND pr2.id_lista_precio = lp.id_lista_precio AND pr2.id_empresa = $1
                        WHERE lp.id_empresa = $1 AND lp.activa = true
                    ) as precios_listas,
                    (
                        SELECT json_agg(json_build_object(
                            'id_proveedor', prov.id_proveedor, 'razon_social', prov.razon_social,
                            'codigo_proveedor', pp.codigo_proveedor, 'precio_compra', pp.precio_compra
                        ))
                        FROM producto_proveedor pp
                        JOIN proveedores prov ON pp.id_proveedor = prov.id_proveedor
                        WHERE pp.id_producto = p.id_producto AND pp.id_empresa = $1 AND pp.activo = true
                    ) as proveedores,
                    (
                        SELECT json_agg(json_build_object(
                            'id_conjunto', conj.id_conjunto, 'nombre', conj.nombre
                        ))
                        FROM conjunto_items ci
                        JOIN conjuntos conj ON ci.id_conjunto = conj.id_conjunto
                        WHERE ci.id_producto = p.id_producto AND conj.activo = true
                    ) as conjuntos
                FROM productos p
                LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
                LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_empresa = $1 AND pr.id_lista_precio = $2
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                LEFT JOIN categorias cs ON p.id_subcategoria = cs.id_categoria
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
                ${whereClause}
                ORDER BY ${(_traerInactivos || estado === 'todos') ? 'p.activo DESC, ' : ''}${ordenarPor} ${dir} NULLS LAST
                LIMIT ${limiteFinal}
                OFFSET ${parseInt(offset)}
            `;

            const { rows } = await pool.query(query, params);

            const countQuery = `
                SELECT COUNT(DISTINCT p.id_producto) as total
                FROM productos p
                LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
                LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_lista_precio = $2
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                ${whereClause}
            `;
            const countResult = await pool.query(countQuery, params);
            const total = parseInt(countResult.rows[0].total);

            res.json({
                productos: rows,
                paginacion: {
                    total,
                    limite: limiteFinal,
                    offset: parseInt(offset),
                    paginas: Math.ceil(total / limiteFinal)
                }
            });
        } catch (error) {
            console.error('❌ Error al listar productos:', error.message);
            res.status(500).json({ error: 'Error al listar productos' });
        }
    },

    // ========================================================================
    // FILTROS AUXILIARES (sin cambios — solo lectura)
    // ========================================================================

    async listarProveedoresConProductos(req, res) {
        try {
            const query = `
                SELECT DISTINCT prov.id_proveedor, prov.razon_social
                FROM proveedores prov
                JOIN producto_proveedor pp ON prov.id_proveedor = pp.id_proveedor
                WHERE prov.activo = true AND pp.activo = true AND pp.id_empresa = $1
                ORDER BY prov.razon_social
            `;
            const { rows } = await pool.query(query, [req.usuario.id_empresa]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al listar proveedores:', error.message);
            res.status(500).json({ error: 'Error al listar proveedores' });
        }
    },

    async listarConjuntosActivos(req, res) {
        const { id_empresa } = req.usuario;
        try {
            const query = `
                SELECT c.id_conjunto, c.nombre,
                       (SELECT COUNT(*) FROM conjunto_items ci WHERE ci.id_conjunto = c.id_conjunto) as cantidad_productos
                FROM conjuntos c
                WHERE c.activo = true AND c.id_empresa = $1
                ORDER BY c.nombre
            `;
            const { rows } = await pool.query(query, [id_empresa]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al listar conjuntos:', error.message);
            res.status(500).json({ error: 'Error al listar conjuntos' });
        }
    },


    // ========================================================================
    // OPERACIONES MASIVAS — via helper
    // ========================================================================

    async ajustePrecioMasivo(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const { ids_productos, porcentaje, tipo, aplicar_venta = true, aplicar_compra = false, motivo } = req.body;

        if (!ids_productos || ids_productos.length === 0) {
            return res.status(400).json({ error: 'Debe seleccionar al menos un producto' });
        }
        if (!porcentaje || porcentaje <= 0 || porcentaje > 100) {
            return res.status(400).json({ error: 'Porcentaje debe ser entre 1 y 100' });
        }

        const factor = tipo === 'aumento' ? (1 + porcentaje / 100) : (1 - porcentaje / 100);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Leer configuraciones
            const { rows: configs } = await client.query(
                "SELECT clave, valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave IN ('ajuste_masivo.aplicar_redondeo_ar','ajuste_masivo.guardar_motivo','ajuste_masivo.estrategia')",
                [id_empresa]
            );
            const cfg = Object.fromEntries(configs.map(c => [c.clave, c.valor]));
            const aplicarRedondeo = cfg['ajuste_masivo.aplicar_redondeo_ar'] === 'true';
            const guardarMotivo = cfg['ajuste_masivo.guardar_motivo'] === 'true';

            const { redondearPrecioAR } = require('../utils/listas-precios.helper');

            let productosAfectados = 0;
            let preciosActualizados = 0;

            for (const id_producto of ids_productos) {
                let productoModificado = false;

                if (aplicar_venta) {
                    // Estrategia 2B: subir costo, mantener margen, recalcular precio con redondeo AR
                    // 1) Leer costo e IVA del producto
                    const { rows: [inv] } = await client.query(
                        `SELECT i.costo_vigente, COALESCE(a.porcentaje, 21) as iva_pct
                         FROM inventario i
                         JOIN productos p ON p.id_producto = i.id_producto
                         LEFT JOIN alicuotasiva a ON a.id_alicuota = p.id_alicuota_iva
                         WHERE i.id_empresa = $1 AND i.id_producto = $2`,
                        [id_empresa, id_producto]
                    );
                    if (!inv) continue;

                    const costoActual = parseFloat(inv.costo_vigente) || 0;
                    const ivaPct = parseFloat(inv.iva_pct) || 21;
                    const costoNuevo = Math.round(costoActual * factor * 10000) / 10000;

                    // 2) Actualizar costo_vigente
                    if (costoNuevo > 0 && costoActual > 0) {
                        await productosHelper.setCostoVigente(client, {
                            id_empresa, id_producto, costo_vigente: costoNuevo
                        });
                    }

                    // 3) Recalcular cada precio de lista manteniendo su margen_individual
                    const { rows: listasPrecios } = await client.query(
                        `SELECT pr.id_lista_precio, pr.precio, pr.margen_individual
                         FROM precios pr
                         WHERE pr.id_empresa = $1 AND pr.id_producto = $2 AND pr.precio > 0`,
                        [id_empresa, id_producto]
                    );

                    for (const lp of listasPrecios) {
                        const margen = parseFloat(lp.margen_individual);
                        let precioNuevo;

                        if (!isNaN(margen) && costoNuevo > 0) {
                            // Recalcular desde costo + margen
                            const netoVenta = costoNuevo * (1 + margen / 100);
                            if (aplicarRedondeo) {
                                const conIva = netoVenta * (1 + ivaPct / 100);
                                const conIvaRedondeado = redondearPrecioAR(conIva);
                                precioNuevo = Math.round((conIvaRedondeado / (1 + ivaPct / 100)) * 10000) / 10000;
                            } else {
                                precioNuevo = Math.round(netoVenta * 10000) / 10000;
                            }
                        } else {
                            // Sin margen o sin costo: fallback a multiplicacion directa
                            precioNuevo = Math.round(parseFloat(lp.precio) * factor * 10000) / 10000;
                            if (aplicarRedondeo) {
                                const conIva = precioNuevo * (1 + ivaPct / 100);
                                const conIvaRedondeado = redondearPrecioAR(conIva);
                                precioNuevo = Math.round((conIvaRedondeado / (1 + ivaPct / 100)) * 10000) / 10000;
                            }
                        }

                        await productosHelper.actualizarPrecio(client, { 
                            id_empresa, id_producto, id_lista_precio: lp.id_lista_precio, precio: precioNuevo 
                        });
                        preciosActualizados++;
                        productoModificado = true;
                    }
                }

                if (aplicar_compra) {
                    const compraResult = await client.query(
                        'SELECT id_proveedor, precio_compra FROM producto_proveedor WHERE id_empresa = $1 AND id_producto = $2 AND activo = true',
                        [id_empresa, id_producto]
                    );
                    for (const row of compraResult.rows) {
                        if (row.precio_compra > 0) {
                            const precioNuevo = Math.round(parseFloat(row.precio_compra) * factor * 10000) / 10000;
                            await productosHelper.actualizarPrecioCompra(client, { id_empresa, id_producto, id_proveedor: row.id_proveedor, precio_compra: precioNuevo });
                            productoModificado = true;
                        }
                    }
                }

                if (productoModificado) productosAfectados++;
            }

            // Marcar las filas del historial que genero el trigger con trazabilidad completa.
            // El trigger ya inserto cada UPDATE con tipo_cambio='actualizacion', ahora lo
            // reclasificamos como ajuste_masivo y anexamos motivo + usuario + origen.
            await client.query(
                `UPDATE historial_precios_ventas 
                 SET tipo_cambio = 'ajuste_masivo',
                     motivo = $1,
                     id_usuario = $2,
                     origen = $3
                 WHERE id_empresa = $4 
                   AND fecha_cambio >= NOW() - INTERVAL '10 seconds'
                   AND id_producto = ANY($5::int[])
                   AND tipo_cambio = 'actualizacion'`,
                [
                    guardarMotivo && motivo ? motivo.trim().substring(0, 200) : `Ajuste masivo ${tipo} ${porcentaje}%`,
                    id_usuario,
                    'ajuste_masivo',
                    id_empresa,
                    ids_productos
                ]
            );

            // Bitácora de ajuste masivo (D-06: 1 fila por operación)
            const masivoHelper = require('../utils/productos-masivo.helper');
            await masivoHelper.registrarAjusteEnBitacora(client, {
                id_empresa, id_usuario, ip: req.ip || null,
                ids: ids_productos, motivo, porcentaje, tipo,
                aplicar_venta, aplicar_compra,
                productos_afectados: productosAfectados,
                precios_actualizados: preciosActualizados,
                filtros: req.body.filtros_aplicados || null
            });

            await client.query('COMMIT');
            res.json({ 
                message: `Precios ajustados: ${productosAfectados} productos, ${preciosActualizados} precios actualizados (estrategia costo+margen, redondeo AR ${aplicarRedondeo ? 'ON' : 'OFF'})`, 
                productos_afectados: productosAfectados, 
                precios_actualizados: preciosActualizados 
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error en ajuste masivo de precios:', error.message);
            res.status(500).json({ error: 'Error al ajustar precios: ' + error.message });
        } finally {
            client.release();
        }
    },

    async cambiarEstadoMasivo(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const ip = req.ip || null;
        const { ids_productos, activar, motivo, filtros_aplicados } = req.body;

        try {
            const masivoHelper = require('../utils/productos-masivo.helper');
            const result = await masivoHelper.cambiarEstadoConBitacora(pool, {
                id_empresa, id_usuario, ip,
                ids: ids_productos, activar,
                motivo, filtros: filtros_aplicados
            });
            const nuevoEstado = activar === true;
            res.json({
                message: `${result.afectados} productos ${nuevoEstado ? 'activados' : 'desactivados'}`,
                productos_afectados: result.afectados
            });
        } catch (error) {
            console.error('Error al cambiar estado masivo:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    },

    async exportarParaExcel(req, res) {
        const { id_empresa } = req.usuario;
        const { ids_productos, id_lista_precio = 1 } = req.body;

        try {
            let whereClause = 'WHERE p.activo = TRUE';
            const params = [id_empresa, parseInt(id_lista_precio)];

            if (ids_productos && ids_productos.length > 0) {
                const placeholders = ids_productos.map((_, i) => `$${i + 3}`).join(',');
                whereClause += ` AND p.id_producto IN (${placeholders})`;
                params.push(...ids_productos);
            }

            const query = `
                SELECT p.sku, p.nombre, p.descripcion, c.nombre as categoria, m.nombre as marca,
                    p.unidad_medida, COALESCE(i.stock_real, 0) as stock, COALESCE(i.stock_minimo, 0) as stock_minimo,
                    COALESCE(pr.precio, 0) as precio,
                    (SELECT prov.razon_social FROM producto_proveedor pp JOIN proveedores prov ON pp.id_proveedor = prov.id_proveedor WHERE pp.id_producto = p.id_producto AND pp.id_empresa = $1 AND pp.activo = true LIMIT 1) as proveedor,
                    (SELECT pp.precio_compra FROM producto_proveedor pp WHERE pp.id_producto = p.id_producto AND pp.id_empresa = $1 AND pp.activo = true LIMIT 1) as precio_compra,
                    p.activo
                FROM productos p
                LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
                LEFT JOIN precios pr ON p.id_producto = pr.id_producto AND pr.id_lista_precio = $2
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                ${whereClause}
                ORDER BY p.nombre
            `;
            const { rows } = await pool.query(query, params);

            res.json({
                columnas: ['SKU', 'Nombre', 'Descripción', 'Categoría', 'Marca', 'Unidad', 'Stock', 'Stock Mín', 'Precio Venta', 'Proveedor', 'Precio Compra', 'Activo'],
                datos: rows.map(r => [r.sku, r.nombre, r.descripcion || '', r.categoria || '', r.marca || '', r.unidad_medida || 'u', r.stock, r.stock_minimo, r.precio, r.proveedor || '', r.precio_compra || '', r.activo ? 'Sí' : 'No']),
                total: rows.length
            });
        } catch (error) {
            console.error('❌ Error al exportar productos:', error.message);
            res.status(500).json({ error: 'Error al exportar productos' });
        }
    },

    // ========================================================================
    // CRUD — via helper
    // ========================================================================

    async obtenerPorId(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });

        try {
            const query = `
                SELECT p.*, c.nombre as categoria, m.nombre as marca,
                    a.porcentaje as iva_porcentaje, a.nombre as iva_nombre,
                    COALESCE(i.stock_real, 0) as stock_real,
                    COALESCE(i.stock_minimo, 0) as stock_minimo,
                    COALESCE(i.stock_maximo, 0) as stock_maximo,
                    (SELECT json_agg(json_build_object('id_lista', lp.id_lista_precio, 'nombre_lista', lp.nombre, 'precio', COALESCE(pr.precio, 0)))
                        FROM listasdeprecios lp LEFT JOIN precios pr ON pr.id_producto = p.id_producto AND pr.id_lista_precio = lp.id_lista_precio AND pr.id_empresa = $1 WHERE lp.id_empresa = $1 AND lp.activa = true) as precios_listas,
                    (SELECT json_agg(pcb.codigo_barras) FROM productocodigosbarras pcb WHERE pcb.id_producto = p.id_producto) as codigos_barras,
                    (SELECT json_agg(json_build_object('id_proveedor', prov.id_proveedor, 'razon_social', prov.razon_social, 'codigo_proveedor', pp.codigo_proveedor, 'precio_compra', pp.precio_compra))
                        FROM producto_proveedor pp JOIN proveedores prov ON pp.id_proveedor = prov.id_proveedor WHERE pp.id_producto = p.id_producto AND pp.id_empresa = $1 AND pp.activo = true) as proveedores,
                    (SELECT json_agg(json_build_object('id_conjunto', conj.id_conjunto, 'nombre', conj.nombre))
                        FROM conjunto_items ci JOIN conjuntos conj ON ci.id_conjunto = conj.id_conjunto WHERE ci.id_producto = p.id_producto AND conj.activo = true) as conjuntos,
                    CASE WHEN COALESCE(i.stock_real, 0) <= 0 THEN 'critico' WHEN COALESCE(i.stock_real, 0) <= COALESCE(i.stock_minimo, 0) THEN 'bajo' ELSE 'ok' END as estado_stock
                FROM productos p
                LEFT JOIN inventario i ON p.id_producto = i.id_producto AND i.id_empresa = $1
                LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
                LEFT JOIN marcas m ON p.id_marca = m.id_marca
                LEFT JOIN alicuotasiva a ON p.id_alicuota_iva = a.id_alicuota
                WHERE p.id_producto = $2
            `;
            const { rows } = await pool.query(query, [id_empresa, id_producto]);

            if (rows.length === 0) {
                return res.status(404).json({ error: 'Producto no encontrado' });
            }
            res.json(rows[0]);
        } catch (error) {
            console.error('❌ Error al obtener producto:', error.message);
            res.status(500).json({ error: 'Error al obtener producto' });
        }
    },

    async crear(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const {
            sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
            id_alicuota_iva, unidad_medida = 'unidades',
            tiene_variantes = false, url_imagen, cod_proveedor,
            proveedores = [], conjuntos = [],
            stock_inicial = 0, stock_minimo = 0, stock_maximo = 0,
            precios = [],
            codigos_barra = []
        } = req.body;

        if (!sku || !nombre) {
            return res.status(400).json({ error: 'SKU y nombre son requeridos' });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // >>> HELPER — crear producto + inventario + precios + proveedores + conjuntos <<<
            const producto = await productosHelper.crearProductoCompleto(client, {
                id_empresa,
                sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
                id_alicuota_iva, unidad_medida, tiene_variantes,
                url_imagen, cod_proveedor,
                stock_minimo, stock_maximo,
                precios, proveedores, conjuntos, codigos_barra
            });

            // Stock inicial via stock.helper (necesita req.usuario para depósito)
            if (stock_inicial > 0) {
                const id_deposito = await stockHelper.obtenerDepositoUsuario(client, req.usuario);
                await stockHelper.moverStock(client, {
                    id_empresa, id_deposito,
                    id_producto: producto.id_producto,
                    cantidad: stock_inicial,
                    tipo_movimiento: stockHelper.TIPOS_MOVIMIENTO.INICIAL,
                    id_usuario,
                    observaciones: 'Stock inicial al crear producto'
                });
            }

            await client.query('COMMIT');
            res.status(201).json({ message: 'Producto creado exitosamente', producto });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error al crear producto:', error.message);
            if (error.code === '23505') {
                return res.status(409).json({ error: 'El SKU ya existe' });
            }
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al crear producto' });
        } finally {
            client.release();
        }
    },

    async actualizar(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });
        const {
            sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
            id_alicuota_iva, unidad_medida, tiene_variantes,
            url_imagen, cod_proveedor, stock_minimo, stock_maximo,
            proveedores = [], conjuntos = [],
            precios = []
        } = req.body;

        if (!sku || !nombre) {
            return res.status(400).json({ error: 'SKU y nombre son requeridos' });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // >>> HELPER — actualizar producto + inventario + precios + proveedores + conjuntos <<<
            const producto = await productosHelper.actualizarProductoCompleto(client, {
                id_empresa, id_producto,
                sku, nombre, descripcion, id_categoria, id_subcategoria, id_marca,
                id_alicuota_iva, unidad_medida, tiene_variantes,
                url_imagen, cod_proveedor,
                stock_minimo, stock_maximo,
                precios, proveedores, conjuntos
            });

            await client.query('COMMIT');
            res.json({ message: 'Producto actualizado exitosamente', producto });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error al actualizar producto:', error.message);
            if (error.code === '23505') {
                return res.status(409).json({ error: 'El SKU ya existe' });
            }
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al actualizar producto' });
        } finally {
            client.release();
        }
    },

    async eliminar(req, res) {
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });

        try {
            // >>> HELPER <<<
            const resultado = await productosHelper.desactivarProducto(pool, { id_producto });
            res.json({ message: `Producto "${resultado.nombre}" eliminado exitosamente` });
        } catch (error) {
            console.error('❌ Error al eliminar producto:', error.message);
            res.status(error.statusCode || 500).json({ error: error.message || 'Error al eliminar producto' });
        }
    },

    async historialPrecios(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });
        const limite = parseInt(req.query.limite) || 50;
        try {
            const { rows } = await pool.query(`
                SELECT h.*, lp.nombre as lista_nombre, u.nombre as usuario
                FROM historial_precios_ventas h
                LEFT JOIN listasdeprecios lp ON h.id_lista_precio = lp.id_lista_precio AND lp.id_empresa = h.id_empresa
                LEFT JOIN usuarios u ON h.id_usuario = u.id_usuario AND u.id_empresa = h.id_empresa
                WHERE h.id_producto = $1 AND h.id_empresa = $2
                ORDER BY h.fecha_cambio DESC LIMIT $3
            `, [id_producto, id_empresa, limite]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener historial de precios:', error.message);
            res.status(500).json({ error: 'Error al obtener historial' });
        }
    },

    async historialStock(req, res) {
        const { id_empresa } = req.usuario;
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });
        const limite = parseInt(req.query.limite) || 50;
        try {
            const { rows } = await pool.query(`
                SELECT m.*, u.nombre as usuario
                FROM movimientos_stock m
                LEFT JOIN usuarios u ON m.id_usuario = u.id_usuario
                WHERE m.id_producto = $1 AND m.id_empresa = $2
                ORDER BY m.fecha_movimiento DESC LIMIT $3
            `, [id_producto, id_empresa, limite]);
            res.json(rows);
        } catch (error) {
            console.error('❌ Error al obtener historial de stock:', error.message);
            res.status(500).json({ error: 'Error al obtener historial' });
        }
    },

    async ajustarStock(req, res) {
        const { id_empresa, id_usuario } = req.usuario;
        const id_producto = parseInt(req.params.id);
        if (isNaN(id_producto)) return res.status(400).json({ error: "ID invalido" });
        const { cantidad, tipo = 'AJUSTE', observaciones } = req.body;

        if (cantidad === undefined) {
            return res.status(400).json({ error: 'La cantidad es requerida' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const stockActual = await client.query(
                'SELECT stock_real FROM inventario WHERE id_empresa = $1 AND id_producto = $2',
                [id_empresa, id_producto]
            );
            if (stockActual.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Producto no encontrado en inventario' });
            }

            const anterior = stockActual.rows[0].stock_real;
            const nuevo = parseInt(cantidad);

            const id_deposito = await stockHelper.obtenerDepositoUsuario(client, req.usuario);
            await stockHelper.ajustarStockAbsoluto(client, {
                id_empresa, id_deposito, id_producto,
                stock_nuevo: nuevo, id_usuario,
                observaciones: observaciones || null,
                documento_referencia: 'AJUSTE-PRODUCTO'
            });

            await client.query('COMMIT');
            res.json({ message: 'Stock ajustado exitosamente', stock_anterior: anterior, stock_nuevo: nuevo, diferencia: nuevo - anterior });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Error al ajustar stock:', error.message);
            res.status(500).json({ error: 'Error al ajustar stock' });
        } finally {
            client.release();
        }
    },

    async obtenerDatosFormulario(req, res) {
        try {
            const id_empresa = parseInt(req.usuario.id_empresa, 10);
            const [categorias, marcas, listas, alicuotas] = await Promise.all([
                pool.query('SELECT id_categoria, nombre FROM categorias WHERE activo = true ORDER BY nombre'),
                pool.query('SELECT id_marca, nombre FROM marcas ORDER BY nombre'),
                pool.query('SELECT id_lista_precio, nombre FROM listasdeprecios WHERE id_empresa = $1 AND activa = true ORDER BY id_lista_precio', [id_empresa]),
                pool.query('SELECT id_alicuota, nombre, porcentaje FROM alicuotasiva ORDER BY porcentaje')
            ]);
            res.json({ categorias: categorias.rows, marcas: marcas.rows, listas_precios: listas.rows, alicuotas_iva: alicuotas.rows });
        } catch (error) {
            console.error('❌ Error al obtener datos de formulario:', error.message);
            res.status(500).json({ error: 'Error al obtener datos' });
        }
    }
};



// ═══════════════════════════════════════════════════════════════════════════
// CONTADOR DE INACTIVOS — para stats-bar y menú
// ═══════════════════════════════════════════════════════════════════════════
async function contadorInactivos(req, res) {
    const { id_empresa } = req.usuario;
    try {
        const { rows } = await pool.query(
            "SELECT COUNT(*)::int AS total FROM productos WHERE activo = FALSE"
        );
        res.json({ total_inactivos: rows[0].total });
    } catch (err) {
        console.error('contadorInactivos:', err);
        res.status(500).json({ error: 'Error al contar inactivos' });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CAMBIO DE ESTADO — individual (PATCH /productos/:id/estado)
// ═══════════════════════════════════════════════════════════════════════════
async function cambiarEstadoProducto(req, res) {
    const { id_empresa, id_usuario, rol } = req.usuario;
    const id_producto = parseInt(req.params.id);
    const { activo, motivo } = req.body;

    if (typeof activo !== 'boolean') {
        return res.status(400).json({ error: 'El campo "activo" debe ser true/false' });
    }
    if (!id_producto) {
        return res.status(400).json({ error: 'id_producto inválido' });
    }

    // Validar permiso via helper centralizado
    try {
        await permisosHelper.exigirPermiso(pool, {
            id_empresa, rol, permiso: 'editar_estado_productos',
            mensaje: 'No tenés permiso para activar/desactivar productos'
        });
    } catch (err) {
        return res.status(err.statusCode || 500).json({ error: err.message });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultado = await productosHelper.cambiarEstadoIndividual(client, {
            id_producto, id_empresa, nuevo_estado: activo, motivo, id_usuario
        });
        await client.query('COMMIT');

        // Trazabilidad en usuarios_logs (mismo patrón que togglePermiso)
        if (!resultado.sin_cambios) {
            const accion = 'CAMBIAR_ESTADO_PRODUCTO';
            const detalle = `${resultado.estado_nuevo ? 'Activó' : 'Desactivó'} producto ${resultado.sku} (${resultado.nombre})` +
                            (motivo ? ` - Motivo: ${motivo}` : '');
            await adminHelper.registrarLog(pool, {
                id_empresa, id_usuario, accion, detalle,
                ip_origen: req.ip || (req.connection && req.connection.remoteAddress)
            }).catch(e => console.error('registrarLog fallo:', e.message));
        }

        res.json({
            success: true,
            message: resultado.sin_cambios
                ? 'El producto ya estaba en ese estado'
                : `Producto ${resultado.estado_nuevo ? 'activado' : 'desactivado'} correctamente`,
            data: resultado
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('cambiarEstadoProducto:', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Error al cambiar estado' });
    } finally {
        client.release();
    }
};


module.exports = productosController;

// ========================================================================
// FUNCIONES ADICIONALES EXPORTADAS
// ========================================================================

async function cambiarWebMasivo(req, res) {
    const { id_empresa, id_usuario } = req.usuario;
    const ip = req.ip || null;
    const { ids, visible_web, motivo, filtros_aplicados } = req.body;
    try {
        const masivoHelper = require('../utils/productos-masivo.helper');
        const result = await masivoHelper.cambiarVisibleWebConBitacora(pool, {
            id_empresa, id_usuario, ip,
            ids, visible_web,
            motivo, filtros: filtros_aplicados
        });
        res.json({ success: true, afectados: result.afectados });
    } catch (error) {
        console.error('Error cambiar web masivo:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}
module.exports.cambiarWebMasivo = cambiarWebMasivo;

// ========================================================================
// CARGADOR DE IMÁGENES DESDE URLs
// ========================================================================

async function analizarImagenes(req, res) {
    const { urls, sobrescribir } = req.body;

    try {
        const urlsPorSku = new Map();
        for (const url of urls) {
            try {
                const urlObj = new URL(url);
                const pathname = urlObj.pathname;
                const filename = pathname.split('/').pop();
                const skuRaw = filename.replace(/\.(jpg|jpeg|png|gif|webp|svg)$/i, '');
                const sku = skuRaw.replace(/[-_]?\d*[-_]?(png|jpg|jpeg)?$/i, '').toUpperCase();
                if (sku) urlsPorSku.set(sku, url);
            } catch (e) { /* URL inválida, ignorar */ }
        }

        const skus = Array.from(urlsPorSku.keys());
        if (skus.length === 0) return res.json({ resultados: [] });

        const { rows: productos } = await pool.query(`SELECT id_producto, sku, nombre, url_imagen FROM productos WHERE UPPER(sku) = ANY($1)`, [skus]);
        const productosPorSku = new Map();
        for (const p of productos) productosPorSku.set(p.sku.toUpperCase(), p);

        const resultados = [];
        for (const [sku, url] of urlsPorSku) {
            const producto = productosPorSku.get(sku);
            if (!producto) {
                resultados.push({ sku, url, accion: 'no_encontrado', producto: null, id_producto: null });
            } else if (producto.url_imagen && !sobrescribir) {
                resultados.push({ sku, url, accion: 'omitir', producto: producto.nombre, id_producto: producto.id_producto });
            } else if (producto.url_imagen && sobrescribir) {
                resultados.push({ sku, url, accion: 'sobrescribir', producto: producto.nombre, id_producto: producto.id_producto });
            } else {
                resultados.push({ sku, url, accion: 'cargar', producto: producto.nombre, id_producto: producto.id_producto });
            }
        }

        const orden = { cargar: 1, sobrescribir: 2, omitir: 3, no_encontrado: 4 };
        resultados.sort((a, b) => orden[a.accion] - orden[b.accion]);
        res.json({ resultados });
    } catch (error) {
        console.error('❌ Error al analizar imágenes:', error.message);
        res.status(500).json({ error: 'Error al analizar imágenes' });
    }
}
module.exports.analizarImagenes = analizarImagenes;

async function aplicarImagenes(req, res) {
    const { imagenes } = req.body;

    try {
        let actualizados = 0;
        for (const img of imagenes) {
            if (img.id_producto && (img.accion === 'cargar' || img.accion === 'sobrescribir')) {
                // >>> HELPER <<<
                await productosHelper.actualizarImagen(pool, { id_producto: img.id_producto, url_imagen: img.url });
                actualizados++;
            }
        }
        res.json({ success: true, actualizados });
    } catch (error) {
        console.error('❌ Error al aplicar imágenes:', error.message);
        res.status(500).json({ error: 'Error al aplicar imágenes' });
    }
}
module.exports.aplicarImagenes = aplicarImagenes;

async function obtenerPreciosLista(req, res) {
    const { id_empresa } = req.usuario;
    const { id_lista_precio, ids_productos } = req.body;

    if (!id_lista_precio || !ids_productos || !Array.isArray(ids_productos) || ids_productos.length === 0) {
        return res.status(400).json({ error: 'Se requiere id_lista_precio e ids_productos' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT id_producto, precio FROM precios WHERE id_empresa = $1 AND id_lista_precio = $2 AND id_producto = ANY($3::int[])`,
            [id_empresa, parseInt(id_lista_precio), ids_productos.map(id => parseInt(id))]
        );
        const precios = {};
        rows.forEach(row => { precios[row.id_producto] = parseFloat(row.precio); });
        res.json(precios);
    } catch (error) {
        console.error('❌ Error obteniendo precios lista:', error.message);
        res.status(500).json({ error: 'Error al obtener precios' });
    }
}
module.exports.obtenerPreciosLista = obtenerPreciosLista;

// ========================================================================
// FAMILIA (padre/hijo para vista web agrupada)
// ========================================================================

async function obtenerFamilia(req, res) {
    const id_producto = parseInt(req.params.id, 10);
    if (!id_producto) return res.status(400).json({ error: 'id_producto invalido' });

    const client = await pool.connect();
    try {
        const familia = await productosHelper.obtenerFamilia(client, { id_producto });
        res.json(familia);
    } catch (err) {
        console.error('obtenerFamilia:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

async function buscarPadresElegibles(req, res) {
    const q = (req.query.q || '').toString();
    const excluir_id = req.query.excluir_id ? parseInt(req.query.excluir_id, 10) : null;

    const client = await pool.connect();
    try {
        const padres = await productosHelper.buscarPadresElegibles(client, {
            query: q,
            excluir_id,
            limite: 20
        });
        res.json(padres);
    } catch (err) {
        console.error('buscarPadresElegibles:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

async function crearProductoPadre(req, res) {
    const { sku, nombre, url_imagen, id_categoria } = req.body;
    const id_empresa = req.usuario?.id_empresa || 1;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Resolver id_alicuota_iva via ivaHelper (mismo patron que crearProducto)
        // Nota: la fn devuelve un OBJETO {id_alicuota, porcentaje, ...} — extraer .id_alicuota
        const alicuotaDef = await ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa);
        const id_alicuota_iva = alicuotaDef.id_alicuota;

        const padre = await productosHelper.crearProductoPadre(client, {
            sku, nombre, url_imagen, id_categoria, id_alicuota_iva,
            id_empresa,
            id_usuario: req.usuario && req.usuario.id_usuario,
            ip:         req.ip,
            motivo:     'creacion manual desde productos.html'
        });

        // ─── Fix 2026-05-11 Bloque 5: inicializar inventario en todas las empresas ───
        // Catalogo compartido (invariante P7). inicializarInventario es idempotente.
        const { rows: empresasActivas } = await client.query('SELECT id_empresa FROM empresas');
        for (const e of empresasActivas) {
            await productosHelper.inicializarInventario(client, {
                id_empresa:  e.id_empresa,
                id_producto: padre.id_producto
            });
        }

        await client.query('COMMIT');
        res.status(201).json(padre);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('crearProductoPadre:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

async function asignarProductoPadre(req, res) {
    const id_producto = parseInt(req.params.id, 10);
    if (!id_producto) return res.status(400).json({ error: 'id_producto invalido' });

    const { id_padre } = req.body;
    const idPadreInt = (id_padre == null || id_padre === '') ? null : parseInt(id_padre, 10);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await productosHelper.asignarProductoPadre(client, {
            id_producto,
            id_padre: idPadreInt
        });
        await client.query('COMMIT');
        res.json(result);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('asignarProductoPadre:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

async function actualizarImagen(req, res) {
    const id_producto = parseInt(req.params.id, 10);
    if (!id_producto) return res.status(400).json({ error: 'id_producto invalido' });

    const { url_imagen, motivo } = req.body || {};
    const id_empresa = req.usuario?.id_empresa;
    const id_usuario = req.usuario?.id_usuario;
    const ip = req.ip || null;

    if (!id_empresa) return res.status(401).json({ error: 'No autenticado' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1) Verificar producto existe
        const { rows: existe } = await client.query(
            'SELECT id_producto FROM productos WHERE id_producto = $1',
            [id_producto]
        );
        if (existe.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // 2) Validar URL contra regex + whitelist (configuraciones_empresa)
        const validacion = await validadorImagenUrl.validar(client, {
            id_empresa,
            url: url_imagen
        });
        if (!validacion.ok) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: validacion.motivo });
        }

        // 3) Aplicar via helper (escribe bitacora en la misma TX)
        await productosHelper.actualizarImagen(client, {
            id_producto,
            url_imagen: url_imagen || null,
            id_empresa,
            id_usuario,
            ip,
            motivo
        });

        await client.query('COMMIT');
        res.json({
            id_producto,
            url_imagen: url_imagen || null,
            vacio: validacion.vacio === true
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        console.error('actualizarImagen:', err.message);
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

module.exports.obtenerFamilia          = obtenerFamilia;
module.exports.buscarPadresElegibles   = buscarPadresElegibles;
module.exports.crearProductoPadre      = crearProductoPadre;
module.exports.asignarProductoPadre    = asignarProductoPadre;
module.exports.actualizarImagen        = actualizarImagen;
module.exports.cambiarEstadoProducto    = cambiarEstadoProducto;
module.exports.contadorInactivos = contadorInactivos;


// ═══ PAQUETES / RECETA (BOM) ═══
async function obtenerComponentesProducto(req, res) {
    const pool = require('../config/database');
    const productosHelperBOM = require('../utils/productos.helper');
    try {
        const data = await productosHelperBOM.obtenerComponentes(pool, {
            id_empresa: req.usuario.id_empresa,
            id_producto: parseInt(req.params.id, 10)
        });
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.statusCode || 500).json({ error: err.message });
    }
}

async function guardarComponentesProducto(req, res) {
    const pool = require('../config/database');
    const productosHelperBOM = require('../utils/productos.helper');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const r = await productosHelperBOM.guardarComponentes(client, {
            id_empresa: req.usuario.id_empresa,
            id_producto: parseInt(req.params.id, 10),
            id_usuario: req.usuario.id_usuario,
            componentes: req.body.componentes
        });
        await client.query('COMMIT');
        res.json({ success: true, data: r });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (e) {}
        res.status(err.statusCode || 500).json({ error: err.message });
    } finally {
        client.release();
    }
}

module.exports.obtenerComponentesProducto = obtenerComponentesProducto;
module.exports.guardarComponentesProducto = guardarComponentesProducto;
