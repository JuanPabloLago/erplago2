const pool = require('../config/database');
const XLSX = require('xlsx');
const productosHelper = require('../utils/productos.helper');
const ivaHelper = require('../utils/iva.helper');
const crudHelper = require('../utils/crud.helper');
const exportHelper = require('../utils/productos-export.helper');
const importHelper = require('../utils/productos-import.helper');
const mapeoHelper = require('../utils/mapeo-columnas.helper');
// Bloque 6c: feature subcategoria + imagen
const categoriasHelper = require('../utils/categorias.helper');
const validadorImagenUrl = require('../utils/validador-imagen-url.helper');

/**
 * PRODUCTOS-IMPORT CONTROLLER - ERP LAGO
 * Importación/Exportación masiva desde Excel
 * + Soporte archivo_origen para agrupar productos por archivo Excel
 */

const UNIDADES_VALIDAS = ['unidades', 'kg', 'litros', 'metros', 'm2', 'm3'];

function calcularPrecioNeto(precioConIva, porcentajeIva) {
    if (!precioConIva || precioConIva <= 0) return precioConIva;
    if (!porcentajeIva || porcentajeIva <= 0) return precioConIva;
    return Math.round((precioConIva / (1 + porcentajeIva / 100)) * 100) / 100;
}

// Limpia nombre de archivo para guardar
function limpiarNombreArchivo(filename) {
    if (!filename) return null;
    return filename.replace(/\.(xlsx|xls|csv)$/i, '').trim().substring(0, 100);
}

// ========================================================================
// LISTAR ARCHIVOS ORIGEN (para combo de filtro)
// ========================================================================

async function listarArchivosOrigen(req, res) {
    const { id_empresa } = req.usuario;
    try {
        const { rows } = await pool.query(`
            SELECT archivo_origen, COUNT(*) as cantidad
            FROM productos
            WHERE activo = true AND archivo_origen IS NOT NULL AND archivo_origen != ''
            GROUP BY archivo_origen
            ORDER BY archivo_origen
        `);
        res.json({ success: true, archivos: rows });
    } catch (error) {
        console.error('Error listarArchivosOrigen:', error);
        res.status(500).json({ error: 'Error al listar archivos' });
    }
}


// ════════════════════════════════════════════════════════════════════════
// RESOLVER OPCIONES DE EXPORT (config empresa + query override)
// ════════════════════════════════════════════════════════════════════════
async function resolverOpcionesExport(id_empresa, query) {
    const { rows } = await pool.query(
        `SELECT clave, valor FROM configuraciones_empresa
          WHERE id_empresa=$1 AND clave IN (
              'productos.export_excel.modo_precio_default',
              'productos.export_excel.perfil_default'
          )`,
        [id_empresa]
    );
    const cfg = Object.fromEntries(rows.map(r => [r.clave, r.valor]));

    // Query override > config > default
    let modoPrecio = query.modo_precio || cfg['productos.export_excel.modo_precio_default'] || 'FINAL_CON_IVA';
    let perfil = query.perfil || cfg['productos.export_excel.perfil_default'] || 'BASICO';

    // Si la config dice PREGUNTAR, exigimos que venga por query
    if (modoPrecio === 'PREGUNTAR') {
        if (!query.modo_precio) {
            const err = new Error('Modo de precio no definido — pasarlo por query (?modo_precio=NETO o FINAL_CON_IVA)');
            err.statusCode = 400;
            throw err;
        }
        modoPrecio = query.modo_precio;
    }

    return { modoPrecio, perfil };
}

// ========================================================================
// EXPORTAR POR ARCHIVO ORIGEN
// ========================================================================

async function exportarPorArchivo(req, res) {
    const { id_empresa } = req.usuario;
    const { archivo_origen } = req.params;
    if (!archivo_origen) return res.status(400).json({ error: 'Debe indicar el archivo' });

    try {
        const { modoPrecio, perfil } = await resolverOpcionesExport(id_empresa, req.query);
        const filtro = { tipo: 'archivo_origen', valor: decodeURIComponent(archivo_origen) };

        const r = await exportHelper.generarExcelProductos(pool, {
            id_empresa, filtro, modoPrecio, perfil,
            filtro_desc: `Archivo origen: ${archivo_origen}`
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
        res.send(r.buffer);
    } catch (error) {
        console.error('Error exportarPorArchivo:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}

// ========================================================================
// EXPORTAR PLANTILLA (modificado: incluye Archivo_Origen)
// ========================================================================

async function exportarPlantilla(req, res) {
    const { id_empresa } = req.usuario;
    const { incluir_datos = 'false', archivo_origen } = req.query;

    try {
        const { modoPrecio, perfil } = await resolverOpcionesExport(id_empresa, req.query);

        // Caso plantilla vacia: solo headers, no carga datos
        if (incluir_datos !== 'true') {
            // Truco limpio: usamos un filtro por id_producto = -1 para que devuelva 0 filas
            // pero con todos los headers del perfil. En lugar de eso, usamos un id real
            // y luego truncamos. Mas limpio: hacemos una version directa del helper.
            // Por simplicidad: traemos 1 producto, generamos el excel, y le borramos las filas de datos.
            // PERO mejor: generamos con un ID que no existe y devolvemos solo headers.
            // El helper lanza 404 si no hay productos, asi que usamos otro path:
            const XLSX = require('xlsx');
            const { rows: listas } = await pool.query(
                `SELECT id_lista_precio, nombre FROM listasdeprecios
                  WHERE id_empresa=$1 AND activa=true ORDER BY orden, id_lista_precio`,
                [id_empresa]
            );
            // Reusamos buildHeaders del helper via el unico camino publico: generamos con 1 producto y truncamos
            // Es feo, asi que mejor: agregamos un metodo solo-headers al helper en una iteracion futura.
            // Por ahora: tomamos un id valido cualquiera para generar la estructura y truncamos
            const { rows: muestra } = await pool.query(
                'SELECT id_producto FROM productos WHERE activo=true LIMIT 1'
            );
            if (muestra.length === 0) {
                return res.status(404).json({ error: 'No hay productos en BD para generar plantilla' });
            }
            const r = await exportHelper.generarExcelProductos(pool, {
                id_empresa,
                filtro: { tipo: 'ids', valor: [muestra[0].id_producto] },
                modoPrecio, perfil,
                incluir_variantes: false,
                filtro_desc: 'PLANTILLA VACIA — sin datos'
            });
            // Truncar la hoja Productos a solo headers
            const wb = XLSX.read(r.buffer, { type: 'buffer' });
            const ws = wb.Sheets['Productos'];
            const ref = XLSX.utils.decode_range(ws['!ref']);
            ref.e.r = 0; // solo header
            ws['!ref'] = XLSX.utils.encode_range(ref);
            // Borrar todas las celdas de datos
            for (const k of Object.keys(ws)) {
                if (k.startsWith('!')) continue;
                const cell = XLSX.utils.decode_cell(k);
                if (cell.r > 0) delete ws[k];
            }
            const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="Plantilla_Productos_${perfil}_${new Date().toISOString().slice(0,10)}.xlsx"`);
            return res.send(buffer);
        }

        // Caso con datos: filtro segun archivo_origen (si se especifico) o todos
        const filtro = archivo_origen
            ? { tipo: 'archivo_origen', valor: archivo_origen }
            : { tipo: 'todos' };

        const r = await exportHelper.generarExcelProductos(pool, {
            id_empresa, filtro, modoPrecio, perfil,
            filtro_desc: archivo_origen ? `Archivo origen: ${archivo_origen}` : 'Todos los productos activos'
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
        res.send(r.buffer);
    } catch (error) {
        console.error('Error exportarPlantilla:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}

// ========================================================================
// PARSEO Y VALIDACIÓN (sin cambios — solo lectura de BD)
// ========================================================================

// ========================================================================
// INSPECCIONAR EXCEL - devuelve columnas detectadas + sugerencia de mapeo
// ========================================================================
async function inspeccionar(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
    try {
        const { id_empresa } = req.usuario;
        const insp = mapeoHelper.inspeccionarExcel(req.file.buffer);
        const { rows: listas } = await pool.query(
            'SELECT id_lista_precio, nombre FROM listasdeprecios WHERE id_empresa = $1 AND activa = true ORDER BY orden, id_lista_precio',
            [id_empresa]
        );
        const campos_erp = mapeoHelper.getCamposERP(listas);
        const sugerencia = mapeoHelper.sugerirMapeo(insp.columnas, campos_erp);
        // Bloque 7.5: cierre feature 6c — Subcategoria y URL_Imagen ahora son campos canonicos del importer
        const camposEstandar = new Set(['SKU','SKU_Padre','Nombre','Presentacion','Descripcion','Categoria','Subcategoria','Marca','Unidad','Alicuota_IVA','Codigos_Barras','Codigo_Barras','URL_Imagen','Proveedor','Codigo_Proveedor','Precio_Compra','Descuento_Proveedor_%','Stock_Minimo','Stock_Maximo','Archivo_Origen']);
        const archivoModificado = Object.keys(insp.meta).length > 0 && insp.columnas.some(c => !c.esta_vacia && !camposEstandar.has(c.nombre) && !/^(Precio|Margen)_/.test(String(c.nombre)));
        res.json({
            success: true,
            archivo: req.file.originalname,
            archivo_origen: importHelper.limpiarNombreArchivo(req.file.originalname),
            total_filas: insp.total_filas,
            total_columnas: insp.total_columnas,
            columnas: insp.columnas,
            campos_erp,
            sugerencia_mapeo: sugerencia.mapeo,
            sugerencia_scores: sugerencia.scores,
            meta_detectado: insp.meta,
            archivo_modificado_externamente: archivoModificado
        });
    } catch (error) {
        console.error('Error inspeccionar:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}

async function previewImportacion(req, res) {
    if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });
    try {
        const { id_empresa } = req.usuario;
        const precios_incluyen_iva = req.body.precios_incluyen_iva !== 'false';
        const porcentaje_iva_default = parseFloat(req.body.porcentaje_iva) || 21;
        let buffer = req.file.buffer;
        if (req.body.mapeo) {
            try {
                const mapeo = typeof req.body.mapeo === 'string' ? JSON.parse(req.body.mapeo) : req.body.mapeo;
                buffer = mapeoHelper.aplicarMapeo(buffer, mapeo);
            } catch (e) {
                return res.status(400).json({ error: 'Mapeo invalido: ' + e.message });
            }
        }
        const resultado = await importHelper.parsearYValidar(pool, buffer, id_empresa, { precios_incluyen_iva, porcentaje_iva_default });

        // ─── Bloque 6c.2: enriquecer preview con configs + validacion URLs ───
        const { rows: cfgRowsPreview } = await pool.query(
            `SELECT clave, valor FROM configuraciones_empresa
              WHERE id_empresa = $1
                AND clave IN ('productos.import.auto_crear_categorias','productos.import.validar_url_imagen')`,
            [id_empresa]
        );
        const cfgPreview = Object.fromEntries(cfgRowsPreview.map(r => [r.clave, r.valor]));
        const autoCrearHab  = cfgPreview['productos.import.auto_crear_categorias'] === 'true';
        const validarUrlHab = cfgPreview['productos.import.validar_url_imagen'] === 'true';

        // Si la config lo pide, validar URLs YA EN PREVIEW para alertar al usuario
        //   - NO bloquea: solo cuenta y devuelve muestra
        //   - Mantiene compatibilidad con flow del ejecutar (Bloque 6c.1 hace la misma validacion)
        let urlsInvalidasCount = 0;
        const urlsInvalidasMuestra = [];
        if (validarUrlHab && resultado.productosValidados && resultado.productosValidados.length > 0) {
            for (const prod of resultado.productosValidados) {
                if (!prod.urlImagen) continue;
                const v = await validadorImagenUrl.validar(pool, { id_empresa, url: prod.urlImagen });
                if (!v.ok) {
                    urlsInvalidasCount++;
                    if (urlsInvalidasMuestra.length < 10) {
                        urlsInvalidasMuestra.push({
                            fila: prod.fila, sku: prod.sku, url: prod.urlImagen, motivo: v.motivo
                        });
                    }
                }
            }
        }
        if (resultado.resumen && resultado.resumen.imagenes) {
            resultado.resumen.imagenes.urls_invalidas_preview = urlsInvalidasCount;
        }

        res.json({
            success: true, preview: true,
            resumen: resultado.resumen,
            opciones_iva: resultado.opciones_iva,
            errores_validacion: resultado.errores.slice(0, 50),
            advertencias: resultado.advertencias.slice(0, 50),
            archivo_origen: limpiarNombreArchivo(req.file.originalname),
            nota_alicuota: 'Para productos existentes se usa la alicuota guardada en el sistema. Para nuevos, la columna Alicuota_IVA o el valor por defecto.',
            // Bloque 6c.2: feature subcategoria + imagen
            configuraciones: {
                auto_crear_categorias: autoCrearHab,
                validar_url_imagen: validarUrlHab
            },
            urls_invalidas_muestra: urlsInvalidasMuestra
        });
    } catch (error) {
        console.error('Error preview:', error);
        res.status(500).json({ error: 'Error al analizar: ' + error.message });
    }
}

// ========================================================================
// IMPORTAR PRODUCTOS — CON ARCHIVO_ORIGEN
// ========================================================================

async function importarProductos(req, res) {
    const { id_empresa } = req.usuario;
    if (!req.file) return res.status(400).json({ error: 'No se recibio archivo' });

    const crear_nuevos = req.body.crear_nuevos !== 'false';
    const actualizar_existentes = req.body.actualizar_existentes !== 'false';
    const precios_incluyen_iva = req.body.precios_incluyen_iva !== 'false';
    const porcentaje_iva_default = parseFloat(req.body.porcentaje_iva) || 21;

    // Nombre del archivo como agrupador (sin extensión)
    const archivo_origen = limpiarNombreArchivo(req.body.archivo_origen || req.file.originalname);

    try {
        // Leer configuraciones de import (Bloque 6c: 2 claves nuevas)
        const { rows: cfgRows } = await pool.query(
            `SELECT clave, valor FROM configuraciones_empresa
              WHERE id_empresa = $1
                AND clave IN (
                    'import_excel.codigos_barra_modo',
                    'codigos_barra.validar_ean13',
                    'productos.import.auto_crear_categorias',
                    'productos.import.validar_url_imagen'
                )`,
            [id_empresa]
        );
        const cfgImport = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));
        const codigosBarraModo = cfgImport['import_excel.codigos_barra_modo'] || 'acumular';
        const validarEAN13 = cfgImport['codigos_barra.validar_ean13'] === 'true';
        // Bloque 6c: feature subcategoria + imagen
        const autoCrearCategorias = cfgImport['productos.import.auto_crear_categorias'] === 'true';
        const validarUrlImagen   = cfgImport['productos.import.validar_url_imagen'] === 'true';

        let buffer = req.file.buffer;
        if (req.body.mapeo) {
            try {
                const mapeo = typeof req.body.mapeo === 'string' ? JSON.parse(req.body.mapeo) : req.body.mapeo;
                buffer = mapeoHelper.aplicarMapeo(buffer, mapeo);
            } catch (e) {
                return res.status(400).json({ error: 'Mapeo invalido: ' + e.message });
            }
        }
        const resultado = await importHelper.parsearYValidar(pool, buffer, id_empresa, { precios_incluyen_iva, porcentaje_iva_default });
        const { productosValidados, variantesValidadas, advertencias, padresAutoCrear = [] } = resultado;
        const productosAProcesar = productosValidados.filter(p => p.esNuevo ? crear_nuevos : actualizar_existentes);
        const variantesAProcesar = variantesValidadas.filter(v => v.esNueva ? crear_nuevos : actualizar_existentes);

        const client = await pool.connect();
        const resultados = {
            productos_creados: 0, productos_actualizados: 0,
            variantes_creadas: 0, variantes_actualizadas: 0,
            sin_cambios: 0, omitidos: 0,
            padres_auto_creados: 0, productos_asignados_a_padre: 0,
            // Bloque 6c: feature subcategoria + imagen
            categorias_creadas: 0, subcategorias_creadas: 0, urls_invalidas: 0
        };
        const productosCreados = new Map();
        const idsProcesados = []; // Para actualizar archivo_origen al final

        try {
            await client.query('BEGIN');

            // ─── Bloque 6: PASO 1 — auto-crear padres marcados ───
            // Antes del loop principal, creamos los padres ficticios que el Excel
            // referencia pero que no existen aun. Cacheamos sus IDs en productosCreados
            // para que el loop normal y el asignador final los encuentren.
            const alicuotaDef = await ivaHelper.obtenerAlicuotaDefectoParaCreacion(client, id_empresa);
            const idAlicuotaPadre = alicuotaDef.id_alicuota;
            for (const padre of padresAutoCrear) {
                // ─── Fix 2026-05-11: heredar id_categoria del primer hijo del Excel ───
                // Invariante P4: padre.id_categoria === hijos.id_categoria. Como en Excel
                // todos los hijos comparten categoría (por contrato del catálogo), tomamos
                // la del primer item con categoría asignada.
                const itemsDelPadre = [...productosValidados, ...variantesValidadas]
                    .filter(it => it.skuPadre === padre.skuPadreReferencia && it.idCategoria != null);
                const idCategoriaPadre = itemsDelPadre.length > 0 ? itemsDelPadre[0].idCategoria : null;

                // Bloque 7.6: wrapper idempotente - reutiliza padre si el slug ya existe
                const padreCreado = await productosHelper.obtenerOCrearProductoPadre(client, {
                    sku:             padre.skuGenerado,
                    nombre:          padre.nombrePadre,
                    id_categoria:    idCategoriaPadre,
                    id_alicuota_iva: idAlicuotaPadre,
                    id_empresa,
                    id_usuario:      req.usuario && req.usuario.id_usuario,
                    ip:              req.ip,
                    motivo:          'auto-creacion por importer Excel'
                });

                // ─── Fix 2026-05-11: inicializar inventario en todas las empresas ───
                // Catálogo compartido (invariante P7): el padre debe existir en inventario
                // de cada empresa con stock=0. inicializarInventario es idempotente.
                const { rows: empresasActivas } = await client.query('SELECT id_empresa FROM empresas');
                for (const e of empresasActivas) {
                    await productosHelper.inicializarInventario(client, {
                        id_empresa:  e.id_empresa,
                        id_producto: padreCreado.id_producto
                    });
                }

                productosCreados.set(padre.skuPadreReferencia, padreCreado.id_producto);
                idsProcesados.push(padreCreado.id_producto);
                resultados.padres_auto_creados = (resultados.padres_auto_creados || 0) + 1;
            }

            // ═══════════════════════════════════════════════════════════════
            // Bloque 6c — PASO 1.5: crear categorias/subcategorias nuevas
            //   solo si la config 'productos.import.auto_crear_categorias' = true.
            //   Si la config esta en false, las categorias inexistentes quedan
            //   sin asignar (advertencia ya generada por el parser en bloque 6a).
            // ═══════════════════════════════════════════════════════════════
            const idsCategoriasNuevas = new Map();    // nombre_lower -> id_categoria
            const idsSubcategoriasNuevas = new Map();
            const idUsuarioActor = req.usuario && req.usuario.id_usuario;
            const ipActor = req.ip || null;

            if (autoCrearCategorias) {
                const listaCats = (resultado.resumen.categorias_a_crear && resultado.resumen.categorias_a_crear.lista) || [];
                for (const cat of listaCats) {
                    const r = await categoriasHelper.obtenerOCrear(client, {
                        nombre: cat.nombre,
                        opciones: {
                            crear: true,
                            id_empresa,
                            id_usuario: idUsuarioActor,
                            ip: ipActor,
                            motivo: 'auto-creacion por importer Excel'
                        }
                    });
                    if (r.id_categoria) {
                        idsCategoriasNuevas.set(cat.nombre.toLowerCase(), r.id_categoria);
                        if (r.created) resultados.categorias_creadas++;
                    }
                }
                const listaSubs = (resultado.resumen.subcategorias_a_crear && resultado.resumen.subcategorias_a_crear.lista) || [];
                for (const sub of listaSubs) {
                    const r = await categoriasHelper.obtenerOCrear(client, {
                        nombre: sub.nombre,
                        opciones: {
                            crear: true,
                            id_empresa,
                            id_usuario: idUsuarioActor,
                            ip: ipActor,
                            motivo: 'auto-creacion subcategoria por importer Excel'
                        }
                    });
                    if (r.id_categoria) {
                        idsSubcategoriasNuevas.set(sub.nombre.toLowerCase(), r.id_categoria);
                        if (r.created) resultados.subcategorias_creadas++;
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════════
            // Bloque 6c — PASO 1.6: re-resolver IDs en productos pendientes
            //   y validar URLs si la config lo pide.
            //   Politica URL invalida: NO bloquea, descarta la URL + warning.
            // ═══════════════════════════════════════════════════════════════
            for (const prod of productosAProcesar) {
                if (prod.categoriaNombrePendiente && !prod.idCategoria) {
                    const id = idsCategoriasNuevas.get(prod.categoriaNombrePendiente.toLowerCase());
                    if (id) prod.idCategoria = id;
                }
                if (prod.subcategoriaNombrePendiente && !prod.idSubcategoria) {
                    const id = idsSubcategoriasNuevas.get(prod.subcategoriaNombrePendiente.toLowerCase());
                    if (id) prod.idSubcategoria = id;
                }
                if (validarUrlImagen && prod.urlImagen) {
                    const v = await validadorImagenUrl.validar(client, {
                        id_empresa,
                        url: prod.urlImagen
                    });
                    if (!v.ok) {
                        advertencias.push({
                            fila: prod.fila,
                            sku: prod.sku,
                            advertencias: [`URL imagen invalida: ${v.motivo}`]
                        });
                        prod.urlImagen = null;
                        resultados.urls_invalidas++;
                    }
                }
            }

            for (const prod of productosAProcesar) {
                if (prod.esNuevo && crear_nuevos) {
                    const tieneVariantes = variantesAProcesar.some(v => v.skuPadre === prod.sku.toLowerCase());
                    const idProducto = await productosHelper.importarProductoNuevo(client, {
                        id_empresa, sku: prod.sku, nombre: prod.nombre, descripcion: prod.descripcion,
                        idCategoria: prod.idCategoria, idSubcategoria: prod.idSubcategoria,
                        idMarca: prod.idMarca, unidad: prod.unidad,
                        idAlicuotaIva: prod.idAlicuotaIva, tieneVariantes,
                        stockMinimo: prod.stockMinimo || 0, stockMaximo: prod.stockMaximo || 0,
                        precios: prod.precios, margenes: prod.margenes, idProveedor: prod.idProveedor,
                        codigoProveedor: prod.codigoProveedor, precioCompra: prod.precioCompra,
                        descuentoProveedor: prod.descuentoProveedor, codigoBarras: prod.codigoBarras,
                        urlImagen: prod.urlImagen,
                        codigosBarraModo, validarEAN13
                    });
                    productosCreados.set(prod.sku.toLowerCase(), idProducto);
                    idsProcesados.push(idProducto);
                    resultados.productos_creados++;
                } else if (!prod.esNuevo && actualizar_existentes) {
                    const cambios = await productosHelper.importarProductoExistente(client, {
                        id_empresa, idProducto: prod.idProducto, nombre: prod.nombre,
                        descripcion: prod.descripcion,
                        idCategoria: prod.idCategoria, idSubcategoria: prod.idSubcategoria,
                        idMarca: prod.idMarca,
                        unidad: prod.unidad, precios: prod.precios, margenes: prod.margenes,
                        stockMinimo: prod.stockMinimo, stockMaximo: prod.stockMaximo,
                        codigoBarras: prod.codigoBarras, idProveedor: prod.idProveedor,
                        codigoProveedor: prod.codigoProveedor, precioCompra: prod.precioCompra,
                        descuentoProveedor: prod.descuentoProveedor,
                        urlImagen: prod.urlImagen,
                        id_usuario: idUsuarioActor, ip: ipActor,
                        codigosBarraModo, validarEAN13
                    });
                    idsProcesados.push(prod.idProducto);
                    cambios ? resultados.productos_actualizados++ : resultados.sin_cambios++;
                } else {
                    resultados.omitidos++;
                }

                // ─── Bloque 6: PASO 2 — asignar padre si vino en Excel ───
                if (prod.skuPadre) {
                    const idHijo = prod.esNuevo
                        ? productosCreados.get(prod.sku.toLowerCase())
                        : prod.idProducto;
                    const idPadre = productosCreados.get(prod.skuPadre)
                        || (resultado.productosMap.get(prod.skuPadre) || {}).id
                        || null;
                    if (idHijo && idPadre && idHijo !== idPadre) {
                        try {
                            await productosHelper.asignarProductoPadre(client, {
                                id_producto: idHijo,
                                id_padre: idPadre
                            });
                            resultados.productos_asignados_a_padre = (resultados.productos_asignados_a_padre || 0) + 1;
                        } catch (e) {
                            advertencias.push({ fila: prod.fila, sku: prod.sku, advertencias: ['No se pudo asignar padre: ' + e.message] });
                        }
                    }
                }
            }

            // ─── Bloque 6.2: padres auto-creados heredan id_categoria del primer hijo ───
            // Despues de asignar todos los hijos a sus padres, poblamos id_categoria
            // de los padres auto-creados con la categoria del primer hijo que tenga.
            // Asi el helper conjuntos-web los renderea DENTRO de la categoria correcta.
            if (padresAutoCrear.length > 0) {
                const idsPadres = padresAutoCrear
                    .map(p => productosCreados.get(p.skuPadreReferencia))
                    .filter(id => id);
                if (idsPadres.length > 0) {
                    await client.query(`
                        UPDATE productos pp
                        SET id_categoria = (
                            SELECT h.id_categoria FROM productos h
                             WHERE h.id_producto_padre = pp.id_producto
                               AND h.id_categoria IS NOT NULL
                             ORDER BY h.id_producto LIMIT 1
                        )
                        WHERE pp.id_producto = ANY($1::int[])
                          AND pp.id_categoria IS NULL
                    `, [idsPadres]);
                }
            }

            for (const v of variantesAProcesar) {
                const idPadre = v.idProductoPadre || productosCreados.get(v.skuPadre);
                if (!idPadre) { resultados.omitidos++; continue; }
                if (v.esNueva && crear_nuevos) {
                    await client.query('INSERT INTO producto_variantes (id_producto, sku, nombre_variante, precio, stock_minimo) VALUES ($1,$2,$3,$4,$5)',
                        [idPadre, v.sku, v.presentacion, v.precio || 0, v.stockMinimo || 0]);
                    resultados.variantes_creadas++;
                } else if (!v.esNueva && actualizar_existentes) {
                    const updates = [], params = []; let idx = 1;
                    if (v.presentacion) { updates.push(`nombre_variante = $${idx++}`); params.push(v.presentacion); }
                    if (v.precio !== null) { updates.push(`precio = $${idx++}`); params.push(v.precio); }
                    if (v.stockMinimo !== null) { updates.push(`stock_minimo = $${idx++}`); params.push(v.stockMinimo); }
                    if (updates.length > 0) { params.push(v.idVariante); await client.query(`UPDATE producto_variantes SET ${updates.join(', ')} WHERE id_variante = $${idx}`, params); resultados.variantes_actualizadas++; }
                    else { resultados.sin_cambios++; }
                } else { resultados.omitidos++; }
            }

            // >>> HELPER — Actualizar archivo_origen en todos los productos procesados <<<
            if (archivo_origen && idsProcesados.length > 0) {
                await crudHelper.actualizarArchivoOrigenMasivo(client, { ids: idsProcesados, archivo_origen });
            }

            await client.query('COMMIT');
            res.json({ success: true, mensaje: 'Importacion completada',
                archivo_origen,
                mensaje_iva: precios_incluyen_iva
                    ? `Precios convertidos a netos segun alicuota de cada producto (default: ${porcentaje_iva_default}%)`
                    : 'Precios importados como netos (sin conversion)',
                resultados, advertencias_total: advertencias.length, advertencias: advertencias.slice(0, 20) });
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    } catch (error) {
        // ─── Boundary del controller (fix 2026-05-15 incidente categorias_nombre_key) ───
        // Patron canonico: ver compras.controller.guardarComprobante.
        // 1) Logging extendido para debug en PM2
        console.error('Error importacion:', error.message);
        console.error('[DEBUG] STACK:', error.stack);
        if (error.code) {
            console.error('[DEBUG] PG CODE:', error.code,
                          '| DETAIL:', error.detail,
                          '| COLUMN:', error.column,
                          '| CONSTRAINT:', error.constraint);
        }
        if (error.where) console.error('[DEBUG] PG WHERE:', error.where);

        // 2) Mapeo de codigos PG a mensajes legibles al usuario
        console.error('[IMPORT PRODUCTOS] Error real:', error.code || '(sin codigo)', '|', error.message || '', '|', error.detail || '', '|', error.where || '');
        if (error.stack) console.error('[IMPORT PRODUCTOS] Stack:', error.stack.split('\n').slice(0, 8).join('\n'));
        if (error.code === '23505') {
            // unique_violation: parsear detail "Key (col)=(val) already exists."
            let mensaje = 'Ya existe un registro con esos datos en el sistema.';
            const m = error.detail && error.detail.match(/Key \(([^)]+)\)=\(([^)]+)\)/);
            if (m) {
                mensaje = `Ya existe un registro con ${m[1]} = "${m[2]}".`;
            }
            if (error.constraint) {
                if (error.constraint.includes('categoria')) mensaje += ' Revisa las categorias o subcategorias del archivo.';
                else if (error.constraint.includes('producto') && error.constraint.includes('sku')) mensaje += ' Hay un SKU duplicado en el archivo o ya existe en el sistema.';
                else if (error.constraint.includes('marca')) mensaje += ' Revisa las marcas del archivo.';
            }
            return res.status(409).json({ error: mensaje, codigo: 'DUPLICADO' });
        }
        if (error.code === '23503') {
            return res.status(400).json({
                error: 'El archivo contiene una referencia invalida (un campo apunta a un valor que no existe en el sistema).',
                codigo: 'REFERENCIA_INVALIDA',
                detalle: error.detail || null
            });
        }
        if (error.code === '23502') {
            return res.status(400).json({
                error: `Falta un campo obligatorio en el archivo${error.column ? `: ${error.column}` : ''}.`,
                codigo: 'CAMPO_FALTANTE'
            });
        }
        if (error.code === '22001') {
            return res.status(400).json({
                error: 'Algun valor del archivo excede el largo maximo permitido en alguna columna.',
                codigo: 'VALOR_DEMASIADO_LARGO'
            });
        }
        if (error.code === '22P02') {
            return res.status(400).json({
                error: 'Algun valor del archivo tiene formato invalido (probablemente un numero o fecha mal formateado).',
                codigo: 'FORMATO_INVALIDO',
                detalle: error.message || null
            });
        }
        // 3) Fallback: mensaje del helper (ej. throws con statusCode) o generico
        const httpStatus = error.statusCode || 500;
        res.status(httpStatus).json({
            error: 'Error procesando la importacion: ' + (error.message || 'desconocido'),
            codigo: 'ERROR_INTERNO'
        });
    }
}

// ========================================================================
// EXPORTAR FILTRADOS (con Archivo_Origen)
// ========================================================================

async function exportarFiltrados(req, res) {
    const { id_empresa } = req.usuario;
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Debe enviar IDs de productos' });
    }

    try {
        const { modoPrecio, perfil } = await resolverOpcionesExport(id_empresa, req.query);

        const r = await exportHelper.generarExcelProductos(pool, {
            id_empresa,
            filtro: { tipo: 'ids', valor: ids.map(Number) },
            modoPrecio, perfil,
            filtro_desc: `Vista filtrada (${ids.length} productos)`
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
        res.send(r.buffer);
    } catch (error) {
        console.error('Error exportarFiltrados:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}

module.exports = { exportarPlantilla, importarProductos, previewImportacion, exportarFiltrados, listarArchivosOrigen, exportarPorArchivo, inspeccionar };
