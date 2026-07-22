#!/bin/bash
# =======================================================================================
# > ERP LAGO - TOOLKIT IA v56.1
# =======================================================================================
# MEJORAS v56.1 (correccion documental — patron real de impresion en LAGO):
#   [DOC] La seccion "IMPRESION — 3 CAMINOS BY-DESIGN" del v56.0 era incorrecta:
#         describia un patron generico (Puppeteer + window.print + window.open) que
#         NO refleja la realidad del ERP. En LAGO se uso Puppeteer en algun momento
#         pero se DESCARTO por dos motivos concretos del dueno:
#           (1) cada job levanta un Chromium completo (~200 MB) y la RAM no se
#               liberaba bien — leaks de browser contexts terminaban en OOM
#           (2) si una impresion quedaba a medias (modal cerrado, error JS, timeout),
#               el proceso quedaba colgado y el ERP dejaba de responder a TODOS los
#               usuarios hasta reiniciar PM2
#         La seccion fue REEMPLAZADA por "IMPRESION — RECETA REAL DEL ERP", que
#         documenta el unico patron en uso hoy: HTML server-side renderizado desde
#         plantilla .hbs, devuelto al browser, que dispara window.print() en el
#         cliente via <script> al final del template. Cero RAM en servidor, cero
#         bloqueo del ERP. Verificado contra evidencia real:
#           - venta-rapida-script.js linea 1602: window.open(API_URL+'/print/comprobante/'+id+'/html?token='+token)
#           - tesoreria.js linea 546: window.open(`${API_URL}/print/recibo/${id}`)
#           - print.routes.js define /api/print/comprobante/:id/html y /datos
#           - templates/comprobantes/comprobante_venta.hbs es la unica plantilla HBS viva
#
#   [DOC] Nueva LECCION APRENDIDA explicita sobre Puppeteer descartado, para que
#         ninguna sesion futura (humana o IA) vuelva a proponer cola Puppeteer/CUPS.
#
#   [DOC] Inventario REAL de imprimibles vivos vs faltantes:
#         VIVOS HOY: comprobantes de venta (venta-rapida), recibos (tesoreria),
#                    facturas y remitos de venta (otro patron, sin window.open directo)
#         FALTANTES: comprobantes de compra, recepciones, presupuestos
#
#   [DOC] Receta paso-a-paso de "como agregar un imprimible nuevo" replicando el
#         patron existente, NO inventando infraestructura nueva.
#
#   [REFACTOR] verificar_sistema_impresion() reescrita: ya no busca print_jobs como
#         "camino fiscal vivo" — ahora verifica el patron real (plantillas .hbs en
#         disco, archivos JS que disparan /print/, rutas en print.routes.js).
#         Si encuentra print_jobs con datos, lo reporta como "tabla historica con
#         actividad" sin asumir que hay worker corriendo.
#
# MEJORAS v58.0 (PARTE 6 INTEGRIDAD REFERENCIAL — la unica capa que vivia
# solo en PostgreSQL):
#   [NEW] verificar_integridad_referencial() — dumpea las 5 capas que el toolkit
#         no estaba mapeando hasta ahora:
#           1. FOREIGN KEYS — totales + breakdown por ON DELETE action
#              (CASCADE/RESTRICT/SET NULL/NO ACTION) + lista completa
#              "tabla.columna -> tabla.columna [ACTION]". Sin esto no se podia
#              saber donde un DELETE cascadea vs donde tira error vs donde deja
#              huerfanos.
#           2. TRIGGERS ACTIVOS — pg_trigger con timing (BEFORE/AFTER), evento
#              (INSERT/UPDATE/DELETE), tabla y funcion. Excluye triggers internos.
#              Inventario real de "que pasa ademas del INSERT del helper".
#           3. UNIQUE CONSTRAINTS E INDICES UNICOS — definicion completa via
#              pg_get_indexdef, excluyendo PKs. Son los guardianes silenciosos
#              de la concurrencia.
#           4. SECUENCIAS — listado con last_value + DETECCION DE DESINCRONIZACION
#              automatica via DO block: para cada secuencia con columna duena,
#              compara MAX(columna) con last_value y flagea DESYNC. Captura el
#              caso de los comprobantes huerfanos antes de que tire duplicate key.
#           5. VIEWS Y MATERIALIZED VIEWS — listado de nombres.
#
#   [NEW] Menu opcion 14 = INTEGRIDAD REFERENCIAL (en columna VERIFICAR)
#         Renumeradas opciones de EXPLORAR de 14-18 a 15-19:
#           14 -> 15 Helpers
#           15 -> 16 Migracion
#           16 -> 17 Features
#           17 -> 18 Modulos
#           18 -> 19 Tendencia
#
#   [NEW] CLI: ./toolkit_v58.sh integridad (alias: fks, referencial)
#         Fuzzy: integ*, fk*, referen*
#
#   [NEW] informe_completo ahora tiene 6 partes (era 5):
#           PARTE 1 CONTEXTO IA
#           PARTE 2 ARQUITECTURA DE NEGOCIO
#           PARTE 3 SALUD ARQUITECTONICA
#           PARTE 4 SEGURIDAD Y CONTROL DE ACCESO
#           PARTE 5 INTEGRIDAD REFERENCIAL  <-- NUEVA
#           PARTE 6 PROMPT MAESTRO          <-- antes era PARTE 5
#
#   [DOC] Refs ./toolkit_v58.sh -> ./toolkit_v58.sh en help.
#
# MEJORAS v57.1 (continuacion poda — duplicaciones que sobrevivieron al v57.0):
#   [CUT] documentar_arquitectura_negocio: removidas §10 HELPERS CENTRALIZADOS y
#         §11 PROGRESO DE MIGRACION A HELPERS. Eran las duplicaciones que faltaba
#         eliminar — el v57.0 cubrio CONTEXTO_IA y SALUD pero ARQUITECTURA tambien
#         las emitia. Razon arquitectonica: la doc de arquitectura debe describir
#         CONCEPTOS ESTRUCTURALES (modelo multi-empresa, jerarquia empresa->dep,
#         sistema de impresion, NC/ND, multimoneda, configs, metodos de pago) —
#         el inventario operativo de helpers y el % de migracion son TELEMETRIA
#         RUNTIME que pertenece al PROMPT_MAESTRO, no a la doc estructural.
#         Resultado: helpers y migracion ahora aparecen UNA sola vez en el informe
#         (en PROMPT_MAESTRO), no dos.
#
#   [FIX] Renumeracion de SALUD_ARQUITECTONICA. Despues de los cortes del v57.0
#         las secciones quedaban numeradas 3, 6, 7, 16, 8, 9, 11, 12, 13, 14 —
#         visualmente parecia un informe roto. Renumeradas secuencialmente 1..10
#         conservando titulos y orden logico:
#           1. Autenticacion en rutas
#           2. Writes sin id_empresa
#           3. Modelo Usuario-Empresa-Deposito
#           4. CHECK constraints vs triggers
#           5. Columnas GENERATED ALWAYS
#           6. Tablas con multiples puntos de escritura
#           7. Resumen rapido
#           8. Integridad auditoria multi-empresa
#           9. Datos semilla obligatorios
#          10. UPDATEs directos en controllers (bypass helper)
#
# MEJORAS v57.0 (poda quirurgica + menu Google-style):
#   [CUT] generar_contexto_ia: removidos bloques que causaban DUPLICACION en
#         INFORME_COMPLETO.md (4995L -> ~2200L estimado):
#         - "tree -L 2" del proyecto reemplazado por "tree -L 1" (180 carpetas
#           de backups historicos NO aportaban contexto arquitectonico).
#         - "## CONTROLADORES" reemplazado por resumen 1-linea por controller
#           (nombre + cantidad de exports), no la lista completa de exports.
#         - "## HELPERS CENTRALIZADOS (resumen)" REMOVIDO por completo de
#           contexto. Ya esta en PROMPT_MAESTRO.md con detalle full.
#         - "## PAGINAS FRONTEND" REMOVIDO de contexto. Ya esta en
#           PROMPT_MAESTRO.md como "MAPEO FRONTEND -> BACKEND" con mas info.
#
#   [CUT] generar_informe_salud: removidas secciones que son TELEMETRIA, no
#         arquitectura. Quedan accesibles via menu/CLI on-demand:
#         - §1 Archivos grandes >500 lineas (metrica de higiene)
#         - §2 Console.log totales (metrica de higiene)
#         - §4 Codigo muerto despues de module.exports (lint)
#         - §5 Logger (estado binario, ya esta en arquitectura)
#         - §10 Progreso de migracion DUPLICADO (ya esta en PROMPT_MAESTRO).
#         Se mantienen INTACTAS todas las secciones de alta señal arquitectonica:
#         §6 writes sin id_empresa, §7 modelo usuario-empresa-deposito,
#         §8 columnas GENERATED, §9 puntos escritura tablas criticas, §11 score,
#         §12 auditoria multi-empresa, §13 datos semilla, §14 UPDATEs bypass,
#         §16 CHECK constraints vs triggers.
#
#   [CUT] prompt_maestro: removida seccion "COMANDOS FRECUENTES" (es README,
#         no contexto de IA). El prompt debe responder "QUE existe / DONDE se
#         escribe / QUE reglas no romper", no "como ejecutar el toolkit".
#
#   [REDESIGN] menu_principal: estilo Google. Una sola caja de busqueda al
#         tope, opciones agrupadas en 3 categorias semanticas (Generar /
#         Verificar / Explorar), accion estrella (informe completo) destacada.
#         Soporta:
#         - Numero (1-17) -> ejecuta opcion directa
#         - Texto libre -> matching fuzzy contra alias de cada accion
#           ("rastrear pagos" -> rastrear con tabla=pagos pre-cargada;
#            "semilla" -> verificar datos semilla;
#            "impr" -> verificar impresion)
#         - Letras: h=help, q=salir, 0=salir
#         Reduce la friccion: el dueño no necesita memorizar numeros.
#
#   [DOC] Refs ./toolkit_v56.sh -> ./toolkit_v58.sh en help y comandos.
#
# MEJORAS v56.0 (preferencias de negocio + lago.ar + impresion descriptiva):
#   [FIX] verificar_constraints_triggers(): elimina los 2 falsos positivos historicos
#         sobre print_jobs.print_jobs_status_check y print_jobs.print_jobs_type_check.
#         Causa raiz: el extractor de literales del trigger source capturaba el primer
#         arg de pg_notify('new_print_job', NEW.id::text) — que es el NOMBRE DEL CANAL
#         LISTEN/NOTIFY, no un valor de columna. Fix: filtrar pg_notify/raise/format
#         antes de extraer literales con grep -oP "'[^']+'".
#
#   [NEW] PROMPT_MAESTRO: bloque "PREFERENCIAS DE NEGOCIO Y UX" (decisiones del dueño,
#         no reglas tecnicas). Tres preferencias estables:
#         (P1) Stock visible en venta-rapida y compras: numero literal SIEMPRE (incluye
#              0 y negativos), del deposito asignado al usuario activo, color
#              verde/ambar/rojo segun stock_minimo, tooltip con desglose por deposito.
#         (P2) Imprimir Y exportar (PDF + Excel) disponible en TODO comprobante de
#              compra. Reusa compras.helper.js obtenerComprobantesParaExport.
#         (P3) "Imprimir lo que esta en pantalla" universal por modulo, accesible con
#              shortcut F9. Cada modulo elige su camino de impresion segun el tipo
#              de doc (NO forzar todo a Puppeteer).
#
#   [NEW] PROMPT_MAESTRO: seccion "IMPRESION (3 caminos)" expandida con cuando usar
#         cada uno y por que NO unificar. Reemplaza la version corta del v55.
#         Camino 1: Fiscales (facturas, NC/ND) -> print_jobs -> Puppeteer -> CUPS
#         Camino 2: Remitos/Despachos -> HTML local + window.print()
#         Camino 3: Cotizaciones/Previews -> window.open() inline
#         Razon: Puppeteer para todo = lento + RAM. Lección documentada en v44.
#
#   [NEW] PROMPT_MAESTRO: seccion completa "LAGO.AR — CATALOGO PUBLICO" con
#         arquitectura (BD -> generar-catalogo-web.js -> lago-deploy.helper -> lftp
#         -> Hostinger), endpoints REST, tabla lago_deploy_log, claves de config
#         (catalogo_web.* y lago_deploy.*), cron diario, troubleshooting basico.
#
#   [NEW] verificar_sistema_impresion() — funcion DESCRIPTIVA, no prescriptiva.
#         Mapea print_jobs (totales por status), printers_config, log_impresiones,
#         plantillas .hbs/.html en disco, controllers que usan print_jobs, archivos
#         frontend con window.print()/window.open(). NO marca window.print() como
#         anti-patron — es by design. SOLO se invoca desde menu/CLI, NO desde
#         informe_completo() ni prompt_maestro() para evitar duplicacion.
#
#   [NEW] verificar_lago_ar() — verifica componentes backend (helper, controller,
#         routes, scripts), source of truth /publico/, output /catalogo-web/, claves
#         obligatorias en BD (8 claves), historial deploys, crontab. SOLO menu/CLI.
#
#   [NEW] Menu opcion 13: VERIFICAR IMPRESION (color CYAN, visible en PowerShell)
#   [NEW] Menu opcion 14: VERIFICAR LAGO.AR (color GREEN, visible en PowerShell)
#   [NEW] Comandos CLI: impresion, lago
#
#   [FIX] Banner del prompt_maestro: "v46 (dinamico)" -> "v${VERSION} (dinamico)"
#   [FIX] Comandos frecuentes y mensajes de help: ./toolkit_v49.sh y ./toolkit_v40.sh
#         -> ./toolkit_v56.sh (sustitucion global, ~12 ocurrencias)
#
#   [REFACTOR] DEDUPLICACION DEL INFORME COMPLETO: removidas las llamadas a
#         verificar_auditoria_multiempresa, verificar_datos_semilla y
#         verificar_constraints_triggers desde prompt_maestro(). Estas tres
#         verificaciones ya se ejecutan en generar_informe_salud() (paso 3 del
#         informe completo) — duplicarlas en el prompt_maestro causaba que el
#         INFORME_COMPLETO_*.md las mostrara DOS VECES (una en SALUD, otra en PROMPT).
#         Son chequeos de salud (informacion runtime), no documentacion estatica
#         para el desarrollador. Las opciones 10/11/12 del menu siguen funcionando
#         normal — solo se eliminaron las inyecciones redundantes en el prompt.
#
# MEJORAS v55.0 (sobre v49 — quirúrgicas, sin cambios funcionales mayores):
#   [NEW] Reglas 8, 9, 10 en REGLAS CRITICAS DE DESARROLLO:
#         - Leer comentarios del archivo antes de modificarlo
#         - Verificar premisa del check antes de aplicar fix
#         - Productos es CATALOGO COMPARTIDO (no enterprise)
#   [NEW] 5 lecciones aprendidas nuevas en LECCIONES APRENDIDAS
#   [FIX] Guard "BD no disponible" en verificar_auditoria_multiempresa():
#         Sin BD no se puede distinguir tablas compartidas de enterprise,
#         entonces el check hace SKIP completo en vez de generar falsos
#         positivos masivos (ej: marcar productos como vulnerable).
#   Cero impacto en operación normal con BD UP.
#
# MEJORAS v49.0 (BOM + fixes decimales + compras):
#   [NEW] TABLA producto_componentes — Bill of Materials para productos compuestos
#   [NEW] stockHelper.descontarVenta() — resuelve BOM automáticamente al vender
#   [NEW] stockHelper.obtenerBOM() — consulta componentes de un producto
#   [NEW] BOM enganchado en 5 puntos: borrador, pedidos, pedidos-edición, notas, notas-anulación
#   [FIX] parseInt→parseFloat en despachos frontend (6 cambios) — fix truncamiento decimales
#   [FIX] Math.round eliminado en compras frontend (4 cambios) — permite cantidades decimales
#   [FIX] Datos pedido 2782 corregidos (cantidad_remitida truncada por parseInt)
#   [DOC] Prompt Maestro: sección BOM (BILL OF MATERIALS) con arquitectura completa
#   [DOC] Prompt Maestro: sección SESIÓN 2026-04-03 (BOM + fixes parseInt/compras)
#   [DOC] 4 lecciones aprendidas nuevas (parseInt vs parseFloat, BOM, stock derivados)
#   [DOC] print_jobs constraints: falso positivo del toolkit documentado
#
# MEJORAS v48.0 (Catálogo web + variantes + búsqueda):
#   [NEW] productos.variante_atributos JSONB — color, color_hex, medida por producto hijo
#   [NEW] Búsqueda multi-palabra en listar productos (busqueda_vector ILIKE per-term)
#   [NEW] Generador catálogo web: agrupa por id_producto_padre, colores, medidas, hijos
#   [NEW] Frontend lago.ar: cards con swatches color + pills medida + "desde $X"
#   [NEW] Frontend lago.ar: modal con selectores interactivos color/medida + precio dinámico
#   [NEW] agregarAlCarrito busca también en hijos de grupos
#   [NEW] Toggle "Ocultar sin stock en web" en configuraciones.html
#   [NEW] Endpoint PUT /api/configuraciones/todas (actualizarConfigPersonalizada)
#   [NEW] Panel Configuraciones Personalizadas (tabla editable clave/valor en admin)
#   [FIX] Padres sin precio exceptuados del filtro excluirSinPrecio en catálogo
#   [FIX] Helper productos: crearProducto + actualizarProducto soportan variante_atributos
#   [DOC] 5 lecciones aprendidas nuevas (búsqueda multi-palabra, JSONB nullable, etc.)
#   [DOC] Prompt Maestro: sección SESIÓN 2026-04-02 + CATÁLOGO WEB AGRUPAMIENTO
#
# MEJORAS v47.0 (Fase 4 — Frontend fiado + fixes):
#   [BREAKING] Frontend fiado: boton FIAR separado del selector de pagos
#   [BREAKING] esConsumidorFinal(): chequea por ID config (no condicion IVA)
#   [NEW] Config: clientes.id_consumidor_final = 9 en configuraciones_empresa
#   [NEW] venta-rapida: payload {fiado:true, monto_fiado:X} en vez de method=6
#   [NEW] borrador.controller: lee flag fiado directo del body
#   [FIX] pedidos-edicion.helper: verificarEditable filtra id_pago_estado=2
#   [FIX] tesoreria.js: eliminado dead code method=6 (3 cambios)
#   [FIX] facturas-acciones.js: eliminado dead code method=6 (5 cambios)
#   [FIX] venta-rapida: eliminado mapeo cuenta_corriente:6, modal "Fiar venta?"
#   [FIX] 2 pagos DUP_EXACTO reembolsados (race condition historica)
#   [FIX] CF duplicado id=5737 eliminado
#   [FIX] Legacy method=6 eliminado de borrador.controller (guard simple)
#   [NEW] verificar_datos_semilla: check config clientes.id_consumidor_final
#   [NEW] 4 lecciones aprendidas (esConsumidorFinal, frontend fiado, doble-pagos)
#   [NEW] Prompt Maestro: sesion 2026-03-29 Fase 4 (frontend + CC fix)
#
# MEJORAS v46.0:
#   [BREAKING] REDISEÑO FIADO/CC: fiar ya NO es pagar. pagos solo tiene pagos reales.
#   [NEW] pedidos.es_fiado BOOLEAN — marca si la venta fue fiada
#   [NEW] pagos.helper.js: registrarFiado() — marca pedido + DEBE en CC, sin INSERT en pagos
#   [NEW] pagos.helper.js: Guard method=6 en registrarPago (throw error)
#   [NEW] despachos.helper.js: registrarCobroRemito cancela DEBE CC + marca remito cobrado
#   [FIX] cc-clientes.helper.js: registrarVentaConPago siempre DEBE+HABER (sin bifurcacion)
#   [FIX] pagos-confirmacion.controller: cobro fiado = solo HABER (cancela deuda)
#   [FIX] ventas-consulta.controller: usa es_fiado en vez de SUM method=6
#   [FIX] pedidos.controller: pendientesCobro usa es_fiado + v_saldo_pedidos
#   [FIX] 4 vistas SQL recreadas sin filtro metodo_pago<>6
#   [FIX] Migración datos: 212 pagos CC reembolsados, 246 remitos marcados, 126 fiados desmarcados
#   [NEW] verificar_datos_semilla: check pedidos.es_fiado + 0 pagos CC aprobados
#   [NEW] Prompt Maestro: seccion FIADO Y CUENTA CORRIENTE (arquitectura nueva)
#   [NEW] Prompt Maestro: sesion 2026-03-29 (rediseño fiado)
#   [NEW] 3 lecciones aprendidas (fiado≠pago, pagos fantasma, registrarVentaConPago)
#
# MEJORAS v45.0:
#   [NEW] Prompt Maestro: seccion STOCK expandida (39 fixes auditoria inventario)
#   [NEW] verificar_datos_semilla: checks secuencias stock (seq_ajuste_rapido, seq_transferencias)
#   [NEW] verificar_datos_semilla: check funcion verificar_reconciliacion_stock()
#   [NEW] verificar_datos_semilla: check triggers inventario (sync_cache + alertas)
#   [NEW] Salud §17: Reconciliacion stock cache vs depositos (0 = OK)
#   [NEW] Prompt Maestro: 5 lecciones aprendidas sesion 2026-03-27 (inventario)
#   [NEW] Prompt Maestro: seccion SESION 2026-03-27 (39 fixes inventario)
#   [NEW] Prompt Maestro: endpoint /api/movimientos-stock documentado
#   [NEW] Comando CLI: reconciliacion (ejecuta verificar_reconciliacion_stock)
#   [FIX] Prompt Maestro: STOCK section actualizada con arquitectura real
#   [FIX] Prompt Maestro: COMANDOS FRECUENTES incluye reconciliacion
#   [DOC] 5 lotes: moverStock atomico, race condition, tipos CHECK, alertas trigger,
#         excel.helper especializado, endpoint movimientos-stock, despachos template bug
#
# MEJORAS v44.0:
#   [NEW] verificar_constraints_triggers() — Detecta CHECK constraints desacoplados de triggers
#   [NEW] Salud §16: CHECK constraints vs triggers (tipo_cambio, etc.)
#   [NEW] Menu opcion 12: VERIFICAR CONSTRAINTS/TRIGGERS
#   [NEW] Comando CLI: constraints
#   [NEW] verificar_datos_semilla: checks config keys productos.*, cotizacion.*, entregas.*
#   [NEW] Prompt Maestro: 10 lecciones aprendidas sesion 2026-03-25/26
#   [NEW] Prompt Maestro: seccion SESION 2026-03-25/26 (18 fixes productos + venta-rapida)
#   [NEW] Prompt Maestro: seccion CONFIGURACIONES PERSONALIZADAS (panel admin editable)
#   [FIX] Prompt Maestro: COMANDOS FRECUENTES actualizados a v44
#   [DOC] Changelog: 8 bugs modulo productos, constraint historial_precios,
#         10 bugs venta-rapida, getSuspendidos JOIN→LEFT JOIN, panel config custom
#
# MEJORAS v43.0:
#   [REFACTOR] _run_sql(): wrapper para psql que elimina duplicacion de credenciales en ~80 llamadas
#   [REFACTOR] _check_tool_version(): extrae patron repetitivo de deteccion de versiones runtime
#   [REFACTOR] _check_table_count(): extrae chequeo repetitivo "tabla existe + COUNT >= N"
#   [REFACTOR] _check_table_exists(): extrae patron "SELECT 1 FROM information_schema"
#   [FIX] VERSION="45.0" — header, help, y mostrar_ayuda sincronizados
#   [FIX] Eliminados ~30 inline psql con credenciales hardcodeadas → usan _run_sql()
#   [DOC] Changelog actualizado con sesiones 2026-03-19/20: cobro despachos, pagos.origen,
#         fix impresion comprobante, toggle anulados facturacion, impresion individual remitos
#
# MEJORAS v42.0:
#   [FIX] Check 1 auditoria-me: contexto ±12→±30→±40 para UPDATEs multi-linea (elimina falsos positivos)
#   [NEW] 2 lecciones aprendidas: Python str.replace() con multiples matches, id_empresa opcional en firmas
#   [FIX] Documentacion sesion 2026-03-18: 14 fixes multi-empresa round 2
#
# MEJORAS v41.0:
#   [NEW] verificar_datos_semilla() - Verifica registros obligatorios en BD
#         (Consumidor Final, pedidoestados, factura_tipos, condicionesiva, alicuotasiva, monedas)
#   [NEW] Deteccion de middlewares globales en server.js (compression, cors, etc)
#   [NEW] Prompt Maestro: 3 caminos de impresion (Puppeteer, HTML local, window.print inline)
#   [NEW] Prompt Maestro: 7 nuevas lecciones aprendidas (sesiones Mar 2026)
#   [NEW] Prompt Maestro: Seccion DATOS SEMILLA obligatorios
#   [NEW] Prompt Maestro: Seccion MIDDLEWARE SERVER.JS globales
#   [NEW] Prompt Maestro: Patron whitelist campos editables (actualizarCampos)
#   [NEW] Salud: Check datos semilla integrado
#   [NEW] Salud: UPDATEs directos en controllers (bypass de helper)
#   [FIX] Header dinamico: v${VERSION} en vez de v38.0 hardcodeado
#   [FIX] calcular_progreso_migracion: audita UPDATEs ademas de INSERTs
#   [FIX] verificar_auditoria_multiempresa Check 1: incluye UPDATEs
#   [FIX] Prompt Maestro: Configuraciones nivel 5 (plantillas impresion)
#
# MEJORAS v40.0:
#   [NEW] AUDITORIA MULTI-EMPRESA COMPLETA integrada (62 vulnerabilidades, 4 fases, ~55 fixes)
#   [NEW] verificar_auditoria_multiempresa() - Verifica integridad de fixes post-auditoría
#         Chequea: INSERTs sin id_empresa, SELECTs sin filtro, cache keys sin empresa,
#         firmas de helpers, ON CONFLICT con constraints correctos
#   [NEW] Prompt Maestro: §AUDITORIA MULTI-EMPRESA (2026-03-01) con detalle completo:
#         - Fase 1: Permisos y acceso (modulos.helper.js reescrito, firmas actualizadas)
#         - Fase 2: Admin helper (registrarLog, togglePermiso, upsertConfigUsuario)
#         - Fase 3: 19 INSERTs en tablas items + ON CONFLICT producto_proveedor fix
#         - Fase 4: SELECTs sin filtro en productos.controller.js
#         - Archivos modificados por fase con líneas exactas
#         - Firmas ANTES/DESPUÉS de todas las funciones que cambiaron
#         - Constraints verificados y clasificación compartidas vs empresa
#   [NEW] Prompt Maestro: Lección aprendida ON CONFLICT sin id_empresa
#   [NEW] Salud §12: Integridad auditoría multi-empresa (5 checks automáticos)
#   [NEW] Comando CLI: auditoria-me (verificación rápida de fixes)
#   [NEW] Menú opción 10: AUDITORIA MULTI-EMPRESA
#
# MEJORAS v38.0:
#   [FIX] ELIMINACION DE DUPLICACIONES EN OUTPUTS (~900 lineas menos en INFORME)
#   [FIX] generar_contexto_ia: removido helpers/features/seguridad/generated (ya en PROMPT)
#   [FIX] generar_informe_salud: §11-§15 ahora son scores compactos, no detalle repetido
#   [FIX] prompt_maestro: removido ESTADO SEGURIDAD (ya en archivo SEGURIDAD)
#   [FIX] informe_completo: eliminada PARTE 1 duplicada, fix skip versiones en CONTEXTO
#   [FIX] Cada archivo tiene un PROPOSITO claro sin solapamiento:
#         CONTEXTO=inventario, SALUD=scores, SEGURIDAD=detalle, PROMPT=referencia dev
#
# MEJORAS v37.0:
#   [NEW] detectar_estado_multiempresa() - Escanea BD real: tablas con/sin id_empresa,
#         constraints, función inicializar_empresa(), SELECTs sin filtro
#   [NEW] Prompt Maestro §9.5: MULTI-EMPRESA DETALLADO (estático) - tablas compartidas
#         vs aisladas, constraints PK/UNIQUE modificados, firmas helpers que cambiaron,
#         pendientes bajo riesgo, 7 reglas de desarrollo futuro
#   [NEW] Prompt Maestro §9.6: ESTADO MULTI-EMPRESA (dinámico auto-detectado desde BD)
#   [NEW] Salud §15: Estado multi-empresa (tablas, constraints, queries sin filtro)
#   [FIX] §6 Salud: busca INSERTs en src/utils/ además de controllers
#   [FIX] Query recargos en prompt: usa id_forma_pago en vez de id_metodo_pago
#
# MEJORAS v36.0:
#   [NEW] auditar_seguridad() - Auditoria completa de control de acceso
#   [NEW] detectar_doble_api() - Detecta patron ${API_BASE}/api/ (doble /api)
#   [NEW] detectar_redirects_login() - Lista TODOS los puntos que redirigen a login
#   [NEW] detectar_403_como_401() - Busca JS que tratan 403 como 401
#   [NEW] verificar_orden_middlewares() - Verifica htmlAccess antes de express.static
#   [NEW] detectar_transacciones() - Detecta operaciones criticas sin BEGIN/COMMIT
#   [NEW] detectar_endpoints_huerfanos() - Exports sin ruta y rutas sin export
#   [NEW] Salud §12: Seguridad y control de acceso (9 checks)
#   [NEW] Salud §13: Transacciones en operaciones criticas
#   [NEW] Salud §14: Endpoints huerfanos
#   [NEW] Prompt Maestro: Lecciones sesion control de acceso
#   [NEW] Prompt Maestro: Seccion SEGURIDAD Y CONTROL DE ACCESO
#   [NEW] Informe Completo: Paso seguridad integrado
#   [NEW] Mapeos: seguridad, auth, modulos en tablas/controllers/routes
#   [NEW] Tablas criticas: modulos, rol_modulos, modulo_rutas_api
#   [NEW] Comando CLI: seguridad
#
# MEJORAS v35.0:
#   [NEW] §11 Salud: Columnas custom en tablas principales (archivo_origen, etc)
#   [NEW] §12 Salud: Endpoints por modulo (lista rutas reales de cada .routes.js)
#   [NEW] Prompt Maestro: Seccion FEATURES ESPECIALES auto-detectada
#   [NEW] Prompt Maestro: Filtros frontend por pagina HTML
#   [NEW] Funcion detectar_features_especiales() - escanea BD + rutas + frontend
#
# MEJORAS v30.0 (desde diagnostico completo):
#   [BREAK] PROMPT_MAESTRO ahora es DINAMICO - genera desde BD/codigo real
#   [NEW] detectar_helpers_existentes() - escanea src/utils/*.helper.js
#   [NEW] calcular_progreso_migracion() - writers dispersos vs centralizados
#   [NEW] Seccion metodos de pago dinamica en ARQUITECTURA_NEGOCIO (§9)
#   [NEW] Seccion helpers en ARQUITECTURA (§10), CONTEXTO, SALUD (§10), PROMPT
#   [NEW] Seccion helper en auditar_modulo (§5, sumada)
#   [NEW] Seccion migracion en rastrear_uso_tabla (§10, sumada)
#   [NEW] Comandos CLI: helpers, migracion
#   [FIX] Versiones fantasma: todos los outputs dicen v30.0
#   [FIX] generar_contexto_ia usa extraer_exports() en vez de grep "exports\."
#   [FIX] detectar_controllers_relacionados: venta-rapida incluye borrador
#   [FIX] detectar_tablas_relacionadas: pagos-proveedores -> pagosaproveedores
#   [FIX] INFORME_COMPLETO sin duplicacion de versiones runtime
#   [FIX] Salud §6 chequea id_empresa en TODAS tablas con multiples writers
#   [FIX] Mapeos case ampliados + fallback dinamico bidireccional
#
# MEJORAS v29.0:
#   [NEW] INFORME COMPLETO - Un solo comando genera TODO en 1 archivo
#         (versiones + contexto + arquitectura + salud + prompt maestro)
#   [NEW] MENU SIMPLIFICADO - De 10 opciones a 6 claras
#   [NEW] extraer_exports() - Detecta exports.X y module.exports = { }
#   [FIX] tree excluye node_modules/coverage/.git en contexto IA
#   [FIX] grep -c ya no genera "0\n0" (|| echo "0" → || true + default)
#   [FIX] diagnostico_salud eliminado (duplicaba generar_informe_salud)
#
# v27: [NEW] Selector inteligente de tablas con busqueda parcial
# v26: [NEW] Rastreo de tablas, versiones runtime, columnas GENERATED
# v24: [NEW] Mapeo inteligente, arquitectura de negocio, auditoria mejorada
#
# Uso: ./toolkit_v58.sh [comando] [opciones]
# =======================================================================================

# Encoding
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Pipefail solo para comandos críticos, no global
set -u

# =======================================================================================
# CONFIGURACION
# =======================================================================================

encontrar_raiz() {
    local dir="${1:-$(pwd)}"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/package.json" ] || [ -f "$dir/server.js" ]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    [ -d "/root/mi_erp" ] && echo "/root/mi_erp" && return 0
    return 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT=$(encontrar_raiz "$SCRIPT_DIR" 2>/dev/null || echo "/root/mi_erp")
OUTPUT_DIR="${PROJECT_ROOT}/scripts_mantenimiento/resultados"
HISTORY_FILE="${PROJECT_ROOT}/scripts_mantenimiento/.toolkit_history.json"
VERSION="58.0"

mkdir -p "$OUTPUT_DIR"

# =======================================================================================
# CREDENCIALES
# =======================================================================================

cargar_credenciales() {
    local env_file=""
    for f in "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.local" "$SCRIPT_DIR/.env"; do
        [ -f "$f" ] && env_file="$f" && break
    done

    if [ -n "$env_file" ]; then
        while IFS= read -r line; do
            [[ "$line" =~ ^#.*$ ]] && continue
            [[ -z "$line" ]] && continue
            export "$line" 2>/dev/null || true
        done < "$env_file"
    fi

    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
    DB_NAME="${DB_NAME:-erplago}"
    DB_USER="${DB_USER:-juanpablo}"

    if [ -z "${DB_PASSWORD:-}" ] && [ -z "${PGPASSWORD:-}" ]; then
        DB_PASSWORD="Huu3697debian@"
    else
        DB_PASSWORD="${DB_PASSWORD:-${PGPASSWORD:-}}"
    fi

    export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD
    export PGPASSWORD="$DB_PASSWORD"
}

# =======================================================================================
# COLORES Y UTILIDADES
# =======================================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

ERRORES_CRITICOS=0
ADVERTENCIAS=0
SUGERENCIAS=0

header() {
    clear
    echo -e "${MAGENTA}"
    echo "   ==========================================================================="
    echo "   |     ERP LAGO - TOOLKIT IA v${VERSION}                                       |"
    echo "   |   Sin Duplicaciones + MultiEmpresa + Seguridad + Helpers + Features    |"
    echo "   ==========================================================================="
    echo -e "${NC}"
    echo -e "  Proyecto: ${CYAN}$PROJECT_ROOT${NC}"
    echo -e "  Salida:   ${CYAN}$OUTPUT_DIR${NC}"
    echo ""
}

# =======================================================================================
# VERIFICACIONES
# =======================================================================================

verificar_proyecto() {
    if [ ! -f "$PROJECT_ROOT/package.json" ] && [ ! -f "$PROJECT_ROOT/server.js" ]; then
        echo -e "${RED}[ERROR] No se encontro proyecto Node.js en $PROJECT_ROOT${NC}"
        exit 1
    fi
}

verificar_bd() {
    command -v psql &>/dev/null || return 1
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" &>/dev/null || return 1
    return 0
}

# =======================================================================================
# [v43] HELPERS DE INFRAESTRUCTURA — eliminan duplicacion de patrones inline
# =======================================================================================

## Ejecuta SQL y retorna resultado. Reemplaza ~80 llamadas inline con psql + credenciales.
## Uso: resultado=$(_run_sql "SELECT COUNT(*) FROM tabla")
##      _run_sql_full "SELECT * FROM tabla"  # con headers (para archivos)
_run_sql() {
    psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null || echo ""
}
_run_sql_full() {
    psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -c "$1" 2>/dev/null || true
}

## Detecta version de una herramienta. Elimina patron repetitivo de 6 bloques if/else.
## Uso: version=$(_check_tool_version "node" "--version")
_check_tool_version() {
    local cmd="$1" flag="${2:---version}"
    if command -v "$cmd" &>/dev/null; then
        $cmd $flag 2>&1 | head -1 || echo "no detectado"
    else
        echo "no instalado"
    fi
}

## Verifica que una tabla exista en la BD.
## Uso: if _table_exists "pagos"; then ...
_table_exists() {
    local tabla="$1"
    local existe=""
    existe=$(_run_sql "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$tabla'")
    [ "$existe" = "1" ]
}

## Cuenta registros de una tabla. Retorna 0 si no existe.
## Uso: count=$(_table_count "pagos")
_table_count() {
    local tabla="$1"
    _table_exists "$tabla" && _run_sql "SELECT COUNT(*) FROM $tabla" || echo "0"
}

## Verifica dato semilla: tabla existe + COUNT >= minimo esperado.
## Retorna linea formateada [OK]/[FAIL] + incrementa errores si falla.
## Uso: _check_semilla "factura_tipos" 3 "tipos" "necesita A, B, C minimo"
_check_semilla() {
    local tabla="$1" minimo="$2" label="$3" msg_fail="${4:-}"
    local count=""
    count=$(_table_count "$tabla")
    if [ "${count:-0}" -ge "$minimo" ]; then
        echo "- [OK] ${tabla}: ${count} ${label}"
    else
        echo "- [FAIL] ${tabla}: solo ${count} (${msg_fail})"
        errores=$((errores + 1))
    fi
}

verificar_git() {
    [ -d "$PROJECT_ROOT/.git" ] && command -v git &>/dev/null
}

# =======================================================================================
# EXPLORAR PROYECTO
# =======================================================================================

explorar_proyecto() {
    FRONTEND_DIR=""
    for d in frontend public client views www; do
        [ -d "$PROJECT_ROOT/$d" ] && FRONTEND_DIR="$PROJECT_ROOT/$d" && break
    done

    JS_DIR=""
    for d in "$FRONTEND_DIR/js" "$FRONTEND_DIR/scripts" "$PROJECT_ROOT/public/js"; do
        [ -d "$d" ] && JS_DIR="$d" && break
    done

    CONTROLLERS_DIR=""
    for d in src/controllers controllers app/controllers; do
        [ -d "$PROJECT_ROOT/$d" ] && CONTROLLERS_DIR="$PROJECT_ROOT/$d" && break
    done

    ROUTES_DIR=""
    for d in src/routes routes app/routes; do
        [ -d "$PROJECT_ROOT/$d" ] && ROUTES_DIR="$PROJECT_ROOT/$d" && break
    done

    # [v30] Deteccion explicita de utils/helpers
    UTILS_DIR=""
    for d in src/utils src/helpers utils helpers; do
        [ -d "$PROJECT_ROOT/$d" ] && UTILS_DIR="$PROJECT_ROOT/$d" && break
    done

    # [v36] Deteccion de middlewares
    MIDDLEWARE_DIR=""
    for d in src/middleware src/middlewares middleware middlewares; do
        [ -d "$PROJECT_ROOT/$d" ] && MIDDLEWARE_DIR="$PROJECT_ROOT/$d" && break
    done

    export FRONTEND_DIR JS_DIR CONTROLLERS_DIR ROUTES_DIR UTILS_DIR MIDDLEWARE_DIR
}


# =======================================================================================
# [v30] DETECCION AUTOMATICA DE HELPERS CENTRALIZADOS
# =======================================================================================

detectar_helpers_existentes() {
    local destino="${1:-}"
    local helpers_dir="$PROJECT_ROOT/src/utils"
    if [ ! -d "$helpers_dir" ]; then
        local m="(directorio src/utils no encontrado)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local helper_files=""
    helper_files=$(find "$helpers_dir" -name "*.helper.js" -type f 2>/dev/null | sort)
    if [ -z "$helper_files" ]; then
        local m="(ningun *.helper.js encontrado)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local _out=""
    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        local hlines; hlines=$(wc -l < "$hfile" 2>/dev/null || echo "?")
        _out+="### $hname ($hlines lineas)"$'\n'
        _out+="Funciones:"$'\n'
        local funcs=""
        funcs=$(grep -E "^(module\.)?exports\." "$hfile" 2>/dev/null | sed 's/^.*exports\.//; s/ =.*//' | sort -u || true)
        if [ -z "$funcs" ]; then
            funcs=$(sed -n '/module\.exports\s*=\s*{/,/}/p' "$hfile" 2>/dev/null \
                | sed 's|//.*||; s|/\*.*\*/||' \
                | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*' \
                | grep -vE '^(module|exports|require|const|let|var|async|function|return|true|false|null|undefined)$' \
                | awk 'length >= 4' \
                || true)
        fi
        if [ -n "$funcs" ]; then
            while IFS= read -r fn; do [ -n "$fn" ] && _out+="  - $fn()"$'\n'; done <<< "$funcs"
        else _out+="  (sin exports detectados)"$'\n'; fi
        local helper_require_name; helper_require_name=$(basename "$hfile" .js)
        local consumidores=""
        consumidores=$(grep -rl "$helper_require_name" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sort -u || true)
        _out+="Consumidores:"$'\n'
        if [ -n "$consumidores" ]; then
            while IFS= read -r cons; do [ -n "$cons" ] && _out+="  - $(basename "$cons")"$'\n'; done <<< "$consumidores"
        else _out+="  (ningun controller lo importa)"$'\n'; fi
        _out+=""$'\n'
    done <<< "$helper_files"
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

calcular_progreso_migracion() {
    local destino="${1:-}"
    if [ ! -d "$CONTROLLERS_DIR" ]; then
        local m="(sin directorio de controllers)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local tablas_dispersas=""
    tablas_dispersas=$(grep -roh "INSERT INTO [a-z_]*\|UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
        | sed 's/INSERT INTO //; s/UPDATE //; s/ SET//' | sort | uniq -c | sort -rn | awk '$1 >= 3 {print $2}' || true)
    if [ -z "$tablas_dispersas" ]; then
        local m="(ninguna tabla con 3+ writes dispersos en controllers)"
        [ -n "$destino" ] && echo "$m" >> "$destino" || echo "$m"; return 0
    fi
    local _out=""
    _out+="| Tabla | Writes | Archivos | Helper | Estado |"$'\n'
    _out+="|-------|--------|----------|--------|--------|"$'\n'
    while IFS= read -r tabla; do
        [ -z "$tabla" ] && continue
        local total_inserts; total_inserts=$(grep -rc "INSERT INTO ${tabla}\|UPDATE ${tabla} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | awk -F: '{s+=$2} END{print s}' || echo "0")
        local archivos_distintos; archivos_distintos=$(grep -rl "INSERT INTO ${tabla}\|UPDATE ${tabla} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
        [ "$archivos_distintos" -lt 2 ] && continue
        local helper_name="-" estado=""
        if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
            local found_helper=""
            # Busqueda estricta: SQL literal
            found_helper=$(grep -rl "INSERT INTO ${tabla}\|FROM ${tabla}\|UPDATE ${tabla}\|INTO ${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
            # Fallback: nombre de tabla aparece en helper (template literals, variables)
            if [ -z "$found_helper" ]; then
                found_helper=$(grep -rwl "${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
            fi
            if [ -n "$found_helper" ]; then
                helper_name=$(basename "$found_helper")
                local directo; directo=$(grep -rl "INSERT INTO ${tabla}\|UPDATE ${tabla} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
                if [ "$directo" -eq 0 ]; then estado="MIGRADO"
                elif [ "$directo" -lt "$archivos_distintos" ]; then estado="PARCIAL ($directo directos)"
                else estado="SIN MIGRAR"; fi
            else estado="SIN HELPER"; fi
        else estado="SIN HELPER"; fi
        _out+="| $tabla | $total_inserts | $archivos_distintos | $helper_name | $estado |"$'\n'
    done <<< "$tablas_dispersas"
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# [v37] DETECCION ESTADO MULTI-EMPRESA (escanea BD + código)
# =======================================================================================

detectar_estado_multiempresa() {
    local destino="${1:-}"
    local _out=""

    if ! verificar_bd; then
        _out+="(BD no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # --- 1. Contar tablas con/sin id_empresa ---
    local total_tablas con_empresa sin_empresa
    total_tablas=$(_run_sql \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
    con_empresa=$(_run_sql \
        "SELECT COUNT(DISTINCT table_name) FROM information_schema.columns WHERE table_schema='public' AND column_name='id_empresa'")
    sin_empresa=$((total_tablas - con_empresa))

    _out+="**Tablas:** Total ${total_tablas} | Con id_empresa: ${con_empresa} | Compartidas: ${sin_empresa}"$'\n'$'\n'

    # --- 2. Tablas compartidas (sin id_empresa) ---
    _out+="**Compartidas (catalogo global):**"$'\n'
    local compartidas=""
    compartidas=$(_run_sql "
        SELECT string_agg(t.table_name, ', ' ORDER BY t.table_name)
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'id_empresa'
        )
    ")
    _out+="${compartidas}"$'\n'$'\n'

    # --- 3. Constraints clave ---
    _out+="**Constraints multi-empresa:**"$'\n'
    local precios_pk=""
    precios_pk=$(_run_sql "
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum)
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'precios'::regclass AND i.indisprimary")
    _out+="- precios PK: (${precios_pk})"$'\n'

    local pp_unique=""
    pp_unique=$(_run_sql "
        SELECT string_agg(a.attname, ', ' ORDER BY a.attnum)
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'producto_proveedor'::regclass AND i.indisunique AND NOT i.indisprimary
        LIMIT 1")
    _out+="- producto_proveedor UNIQUE: (${pp_unique})"$'\n'

    # --- 4. Función inicializar_empresa ---
    local func_existe=""
    func_existe=$(_run_sql "SELECT 1 FROM pg_proc WHERE proname='inicializar_empresa'")
    if [ "$func_existe" = "1" ]; then
        _out+="- inicializar_empresa(): EXISTE en BD"$'\n'
    else
        _out+="- inicializar_empresa(): NO EXISTE"$'\n'
    fi
    _out+=$'\n'

    # --- 5. Empresas activas ---
    _out+="**Empresas activas:**"$'\n'
    local empresas_info=""
    empresas_info=$(_run_sql \
        "SELECT 'ID ' || id_empresa || ': ' || COALESCE(nombre_fantasia, razon_social) FROM empresas WHERE activa = true ORDER BY id_empresa")
    _out+="${empresas_info}"$'\n'$'\n'

    # --- 6. SELECTs sin filtro id_empresa en tablas criticas ---
    _out+="**Queries sin filtro id_empresa (riesgo aislamiento):**"$'\n'
    if [ -d "${CONTROLLERS_DIR:-}" ]; then
        local tablas_empresa=""
        tablas_empresa=$(_run_sql "
            SELECT DISTINCT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='id_empresa'
            AND table_name IN ('pagos','precios','listasdeprecios','metodosdepago','formas_pago',
                'cotizaciones','rol_modulos','producto_proveedor','configuracion_sistema')
        ")
        local hay_problemas=0
        if [ -n "$tablas_empresa" ]; then
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                local selects_sin=0
                # Buscar FROM tabla sin id_empresa en la misma linea (excluir comentarios)
                selects_sin=$(grep -rn "FROM ${tbl}\b" "${CONTROLLERS_DIR}" "${UTILS_DIR:-/dev/null}" --include="*.js" 2>/dev/null \
                    | grep -v "node_modules" | grep -v "id_empresa" | grep -v "^\s*//" | wc -l || echo "0")
                if [ "$selects_sin" -gt 0 ]; then
                    _out+="- [WARN] ${tbl}: ${selects_sin} queries sin filtro id_empresa"$'\n'
                    hay_problemas=1
                fi
            done <<< "$tablas_empresa"
        fi
        [ "$hay_problemas" -eq 0 ] && _out+="- [OK] Todas las tablas criticas filtran por id_empresa"$'\n'
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# [v39] VERIFICACION INTEGRIDAD AUDITORIA MULTI-EMPRESA (2026-03-01)
# =======================================================================================
# Verifica que los 55+ fixes de la auditoría multi-empresa sigan intactos.
# Chequea: INSERTs sin id_empresa, SELECTs sin filtro, cache keys, firmas helpers,
# ON CONFLICT con constraints correctos, retornos de verificarAcceso*.
# =======================================================================================

# =======================================================================================
# [v40] HELPER: Verificación context-aware de SQL multi-línea
# =======================================================================================

_check_sql_context() {
    local archivo="$1" linea="$2" patron="$3" context_lines="${4:-12}"
    local end_line=$((linea + context_lines))
    sed -n "${linea},${end_line}p" "$archivo" 2>/dev/null | grep -q "$patron"
}

_TABLAS_ENTERPRISE_CACHE=""
_get_tablas_enterprise() {
    if [ -n "$_TABLAS_ENTERPRISE_CACHE" ]; then echo "$_TABLAS_ENTERPRISE_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_ENTERPRISE_CACHE=$(_run_sql "
            SELECT table_name FROM information_schema.columns
            WHERE table_schema='public' AND column_name='id_empresa'
            INTERSECT
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")
    fi
    echo "$_TABLAS_ENTERPRISE_CACHE"
}

_TABLAS_COMPARTIDAS_CACHE=""
_get_tablas_compartidas() {
    if [ -n "$_TABLAS_COMPARTIDAS_CACHE" ]; then echo "$_TABLAS_COMPARTIDAS_CACHE"; return; fi
    if verificar_bd 2>/dev/null; then
        _TABLAS_COMPARTIDAS_CACHE=$(_run_sql "
            SELECT t.table_name FROM information_schema.tables t
            WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
            AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='id_empresa')
            ORDER BY 1")
    fi
    echo "$_TABLAS_COMPARTIDAS_CACHE"
}

# =======================================================================================
# [v40] VERIFICACION INTEGRIDAD MULTI-EMPRESA (context-aware, auto-detect)
# =======================================================================================

verificar_auditoria_multiempresa() {
    local destino="${1:-}"
    local _out=""
    local errores=0
    local warnings=0

    _out+="### VERIFICACION INTEGRIDAD MULTI-EMPRESA (v40 context-aware)"$'\n'
    _out+="Fecha: $(date +%Y-%m-%d) | Auto-detect desde BD + análisis multi-línea"$'\n'$'\n'

    if [ -z "${UTILS_DIR:-}" ] || [ ! -d "${UTILS_DIR:-}" ]; then
        _out+="(directorio utils no disponible)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # Guard: si no hay BD disponible, NO podemos distinguir tablas compartidas
    # de enterprise. Sin esa lista, los Check 1 y 2 generan falsos positivos
    # masivos (ejemplo real: marcar productos como vulnerable cuando es compartida).
    # Mejor SKIP completo que reportar basura.
    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible — no puedo determinar tablas compartidas vs enterprise"$'\n'
        _out+="- Los checks 1 y 2 requieren BD UP para distinguir falsos positivos."$'\n'
        _out+="- Verificá: PGPASSWORD='...' psql -h localhost -U juanpablo -d erplago -c 'SELECT 1'"$'\n'
        _out+="**Estado: ⏭️  SKIP — BD no disponible**"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # ═══ CHECK 1: INSERTs/UPDATEs sin id_empresa (CONTEXT-AWARE) ═══
    _out+="**Check 1: INSERTs/UPDATEs en helpers (context-aware, ±40 líneas)**"$'\n'
    local tablas_compartidas=""
    tablas_compartidas=$(_get_tablas_compartidas 2>/dev/null || true)
    local real_fails=0 total_inserts=0 fails_detail=""

    while IFS=: read -r file linenum rest; do
        [ -z "$file" ] && continue
        total_inserts=$((total_inserts + 1))
        local tabla_name=""
        tabla_name=$(sed -n "${linenum}p" "$file" 2>/dev/null | grep -oP 'INSERT INTO \K[a-z_]+|UPDATE \K[a-z_]+' || true)
        [ -z "$tabla_name" ] && continue
        # Skip compartidas
        echo "$tablas_compartidas" | grep -q "^${tabla_name}$" 2>/dev/null && continue
        # Skip comentarios JSDoc
        sed -n "${linenum}p" "$file" 2>/dev/null | grep -qP '^\s*\*' && continue
        # Context-aware: buscar id_empresa en bloque SQL (30 líneas para cubrir UPDATEs largos)
        if ! _check_sql_context "$file" "$linenum" "id_empresa" 40; then
            real_fails=$((real_fails + 1))
            fails_detail+="  $(basename "$file"):${linenum}: INSERT/UPDATE INTO ${tabla_name}"$'\n'
        fi
    done < <(grep -rn "INSERT INTO [a-z_]\|UPDATE [a-z_].* SET" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v ".bak" | grep -v "^\s*//" || true)

    if [ "$real_fails" -gt 0 ]; then
        _out+="- [FAIL] ${real_fails}/${total_inserts} INSERTs sin id_empresa en bloque:"$'\n'
        _out+="${fails_detail}"
        errores=$((errores + real_fails))
    else
        _out+="- [OK] ${total_inserts} INSERTs verificados — todos tienen id_empresa"$'\n'
    fi
    _out+=$'\n'

    # ═══ CHECK 2: SELECTs sin filtro (CONTEXT-AWARE ±8 líneas) ═══
    _out+="**Check 2: SELECTs sin filtro id_empresa (context-aware, ±8 líneas)**"$'\n'
    local tablas_enterprise=""
    tablas_enterprise=$(_get_tablas_enterprise 2>/dev/null || true)
    if [ -z "$tablas_enterprise" ]; then
        tablas_enterprise="producto_proveedor cotizaciones formas_pago metodosdepago listasdeprecios inventario precios rol_modulos permisos_usuario"
    fi
    local hay_selects_sin=0
    local search_dirs="${CONTROLLERS_DIR:-} ${UTILS_DIR:-}"
    [ -d "${PROJECT_ROOT}/src/middleware" ] && search_dirs="$search_dirs ${PROJECT_ROOT}/src/middleware"

    while IFS= read -r tabla; do
        [ -z "$tabla" ] && continue
        local tabla_fails=0 tabla_details=""
        while IFS=: read -r file linenum rest; do
            [ -z "$file" ] && continue
            echo "$file" | grep -q ".bak" && continue
            local start_line=$((linenum - 25)); [ "$start_line" -lt 1 ] && start_line=1
            local end_line=$((linenum + 25))
            local context; context=$(sed -n "${start_line},${end_line}p" "$file" 2>/dev/null || true)
            if ! echo "$context" | grep -q "id_empresa"; then
                tabla_fails=$((tabla_fails + 1))
                tabla_details+="    $(basename "$file"):${linenum}"$'\n'
            fi
        done < <(grep -rn "FROM ${tabla}\b\|JOIN ${tabla}\b" $search_dirs --include="*.js" 2>/dev/null | grep -v ".bak" || true)
        if [ "$tabla_fails" -gt 0 ]; then
            _out+="- [WARN] ${tabla}: ${tabla_fails} queries sin id_empresa en contexto"$'\n'
            _out+="${tabla_details}"
            warnings=$((warnings + 1))
            hay_selects_sin=1
        fi
    done <<< "$tablas_enterprise"
    [ "$hay_selects_sin" -eq 0 ] && _out+="- [OK] Tablas enterprise filtran por id_empresa en contexto"$'\n'
    _out+=$'\n'

    # ═══ CHECK 3: Cache keys (scope-aware) ═══
    _out+="**Check 3: Cache keys aisladas por empresa (scope-aware)**"$'\n'
    local cache_fails=0
    local cache_exclude="rutas_soporte\|rutas_api_map\|todos_modulos\|grupos\|TTL\|CACHE"
    while IFS=: read -r file linenum rest; do
        [ -z "$file" ] && continue
        echo "$file" | grep -q ".bak" && continue
        local func_start=$((linenum - 30)); [ "$func_start" -lt 1 ] && func_start=1
        local func_context; func_context=$(sed -n "${func_start},${linenum}p" "$file" 2>/dev/null || true)
        if ! echo "$func_context" | grep -q "id_empresa"; then
            _out+="- [WARN] $(basename "$file"):${linenum}: cache sin id_empresa en scope"$'\n'
            cache_fails=$((cache_fails + 1))
            warnings=$((warnings + 1))
        fi
    done < <(grep -rn "cache\.\(set\|get\|has\)" "$UTILS_DIR" "${PROJECT_ROOT}/src/middleware" --include="*.js" 2>/dev/null | grep -v "$cache_exclude" | grep -v ".bak" || true)
    [ "$cache_fails" -eq 0 ] && _out+="- [OK] Cache keys usan id_empresa en scope"$'\n'
    _out+=$'\n'

    # ═══ CHECK 4: ON CONFLICT ═══
    _out+="**Check 4: ON CONFLICT usa constraints correctos**"$'\n'
    local pp_conflict; pp_conflict=$(grep -rn "ON CONFLICT.*id_producto.*id_proveedor" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v id_empresa | grep -v ".bak" || true)
    [ -n "$pp_conflict" ] && { _out+="- [FAIL] producto_proveedor ON CONFLICT sin id_empresa"$'\n'; errores=$((errores+1)); } || _out+="- [OK] producto_proveedor"$'\n'
    local pr_conflict; pr_conflict=$(grep -rn "ON CONFLICT.*id_producto.*id_lista_precio" "$UTILS_DIR"/*.helper.js 2>/dev/null | grep -v id_empresa | grep -v ".bak" || true)
    [ -n "$pr_conflict" ] && { _out+="- [FAIL] precios ON CONFLICT sin id_empresa"$'\n'; errores=$((errores+1)); } || _out+="- [OK] precios"$'\n'
    _out+=$'\n'

    # ═══ CHECK 5: Firmas (auto-detect todos los helpers) ═══
    _out+="**Check 5: Firmas helpers (auto-detect)**"$'\n'
    local helpers_checked=0 helpers_ok=0
    while IFS= read -r hfile; do
        [ -z "$hfile" ] && continue
        local hname; hname=$(basename "$hfile")
        local funcs_exported; funcs_exported=$(grep -oP '(?<=exports\.)\w+' "$hfile" 2>/dev/null || true)
        if [ -z "$funcs_exported" ]; then
            funcs_exported=$(sed -n '/module\.exports/,/}/p' "$hfile" 2>/dev/null | grep -oP '[a-zA-Z_]\w+' | grep -vP '^(module|exports|require|const|let|var)$' || true)
        fi
        [ -z "$funcs_exported" ] && continue
        local missing=0
        while IFS= read -r fn; do
            [ -z "$fn" ] && continue
            # Skip constantes (UPPERCASE) y funciones utilitarias puras
            if echo "$fn" | grep -qP '^[A-Z_]+$'; then continue; fi
            if echo "$fn" | grep -qP '^(require|compras|comprasHelper)$'; then continue; fi
            local fdef; fdef=$(grep -A5 "async.*${fn}\b\|function.*${fn}\b\|const ${fn}" "$hfile" 2>/dev/null | head -6 || true)
            if [ -n "$fdef" ] && ! echo "$fdef" | grep -q "id_empresa\|datos\|params\|options\|client\|pool\|req"; then
                _out+="- [WARN] ${hname} → ${fn}() sin id_empresa/datos en firma"$'\n'
                missing=1; warnings=$((warnings+1))
            fi
        done <<< "$funcs_exported"
        helpers_checked=$((helpers_checked+1))
        [ "$missing" -eq 0 ] && helpers_ok=$((helpers_ok+1))
    done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)
    _out+="- Verificados: ${helpers_checked} | OK: ${helpers_ok}"$'\n'$'\n'

    # ═══ CHECK 6: NOT NULL en BD ═══
    _out+="**Check 6: NOT NULL constraint en id_empresa (BD)**"$'\n'
    if verificar_bd 2>/dev/null; then
        local nc; nc=$(_run_sql "
            SELECT COUNT(*) FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name=t.table_name AND c.table_schema=t.table_schema
            WHERE c.column_name='id_empresa' AND c.table_schema='public'
            AND t.table_type='BASE TABLE' AND c.is_nullable='YES'")
        if [ "${nc:-0}" = "0" ]; then
            _out+="- [OK] Todas las tablas tienen NOT NULL"$'\n'
        else
            _out+="- [FAIL] ${nc} tablas sin NOT NULL"$'\n'
            errores=$((errores + nc))
        fi
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=$'\n'

    # ═══ RESUMEN ═══
    _out+="**Resumen:** ${errores} errores, ${warnings} warnings"$'\n'
    if [ "$errores" -eq 0 ] && [ "$warnings" -eq 0 ]; then
        _out+="**Estado: ✅ INTEGRIDAD VERIFICADA — listo para multi-empresa**"$'\n'
    elif [ "$errores" -eq 0 ]; then
        _out+="**Estado: ⚠️ WARNINGS — revisar, no bloqueantes**"$'\n'
    else
        _out+="**Estado: ❌ ERRORES — corregir antes de empresa 2**"$'\n'
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# [v35] DETECCION DE FEATURES ESPECIALES (columnas custom, endpoints, filtros)
# =======================================================================================

# =======================================================================================
# [v41] VERIFICACION DATOS SEMILLA (registros obligatorios en BD)
# =======================================================================================

verificar_datos_semilla() {
    local destino="${1:-}"
    local _out=""
    local errores=0

    _out+="### VERIFICACION DATOS SEMILLA"$'\n'
    _out+="Registros que DEBEN existir para que el sistema funcione."$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # 1. Cliente Consumidor Final (por config ID, no por nombre)
    local cf_id=""
    cf_id=$(_run_sql "SELECT valor FROM configuraciones_empresa WHERE id_empresa=1 AND clave='clientes.id_consumidor_final'")
    if [ -n "$cf_id" ]; then
        local cf_exists=""
        cf_exists=$(_run_sql "SELECT razon_social FROM clientes WHERE id_cliente=$cf_id AND id_empresa=1")
        if [ -n "$cf_exists" ]; then
            _out+="- [OK] Config clientes.id_consumidor_final=$cf_id ($cf_exists)"$'\n'
        else
            _out+="- [FAIL] Config clientes.id_consumidor_final=$cf_id pero cliente NO existe"$'\n'
            errores=$((errores + 1))
        fi
    else
        _out+="- [FAIL] Config clientes.id_consumidor_final NO configurada"$'\n'
        errores=$((errores + 1))
    fi

    # 2. pedidoestados (caso especial: necesita estado 99=Recuperado)
    local pe_count="" pe_99=""
    pe_count=$(_table_count "pedidoestados")
    pe_99=$(_run_sql "SELECT COUNT(*) FROM pedidoestados WHERE id_estado = 99")
    if [ "${pe_count:-0}" -gt 3 ] && [ "${pe_99:-0}" -gt 0 ]; then
        _out+="- [OK] pedidoestados: $pe_count estados (incl. 99=Recuperado)"$'\n'
    else
        _out+="- [WARN] pedidoestados: $pe_count estados, 99=Recuperado: $pe_99"$'\n'
        [ "${pe_count:-0}" -lt 3 ] && errores=$((errores + 1))
    fi

    # 3-5. Checks estandar con _check_semilla (tabla, minimo, label, msg_fail)
    _out+="$(_check_semilla "factura_tipos" 3 "tipos" "necesita A, B, C minimo")"$'\n'
    _out+="$(_check_semilla "condicionesiva" 4 "condiciones" "necesita RI, Monotributo, Exento, CF minimo")"$'\n'
    _out+="$(_check_semilla "alicuotasiva" 3 "alicuotas" "necesita 21%, 10.5%, 0% minimo")"$'\n'

    # 6. monedas (warn, no fail)
    local mon_count=""
    mon_count=$(_table_count "monedas")
    if [ "${mon_count:-0}" -ge 2 ]; then
        _out+="- [OK] monedas: $mon_count (ARS + USD)"$'\n'
    else
        _out+="- [WARN] monedas: solo $mon_count"$'\n'
    fi

    # 7. Config AFIP
    local afip_count=""
    afip_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'afip_%'")
    if [ "${afip_count:-0}" -ge 5 ]; then
        _out+="- [OK] Config AFIP: $afip_count claves"$'\n'
    else
        _out+="- [WARN] Config AFIP: solo $afip_count claves (esperado 7)"$'\n'
    fi

    # 8. Config keys de productos (v44)
    local prod_cfg=""
    prod_cfg=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'productos.%'")
    if [ "${prod_cfg:-0}" -ge 2 ]; then
        _out+="- [OK] Config productos: $prod_cfg claves"$'\n'
    else
        _out+="- [WARN] Config productos: $prod_cfg claves (esperado 2: alicuota_iva_defecto, limite_resultados_busqueda)"$'\n'
    fi

    # 9. Config keys personalizadas (v44)
    local custom_cfg=""
    custom_cfg=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE clave LIKE 'cotizacion.%' OR clave LIKE 'entregas.%' OR clave LIKE 'stock.%' OR clave LIKE 'pagos.%'")
    if [ "${custom_cfg:-0}" -ge 3 ]; then
        _out+="- [OK] Config personalizadas: $custom_cfg claves (cotizacion/entregas/stock/pagos)"$'\n'
    else
        _out+="- [WARN] Config personalizadas: $custom_cfg claves"$'\n'
    fi

    _out+=$'\n'
    # 10. es_fiado column exists (v46)
    local has_esfiado=""
    has_esfiado=$(_run_sql "SELECT 1 FROM information_schema.columns WHERE table_name='pedidos' AND column_name='es_fiado'")
    if [ "$has_esfiado" = "1" ]; then
        _out+="- [OK] pedidos.es_fiado existe"$'\n'
    else
        _out+="- [FAIL] pedidos.es_fiado NO existe (rediseño fiado pendiente)"$'\n'
        ((errores++))
    fi

    # 11. No pagos CC aprobados (v46)
    local cc_aprobados=""
    cc_aprobados=$(_run_sql "SELECT COUNT(*) FROM pagos WHERE id_metodo_pago=6 AND id_pago_estado=2")
    if [ "${cc_aprobados:-0}" -eq 0 ]; then
        _out+="- [OK] 0 pagos CC aprobados (fiado migrado)"$'\n'
    else
        _out+="- [WARN] $cc_aprobados pagos CC aun aprobados (migrar a es_fiado)"$'\n'
    fi

    # 12. Secuencias stock (v45)
    local seq_ar=""
    seq_ar=$(_run_sql "SELECT 1 FROM information_schema.sequences WHERE sequence_name='seq_ajuste_rapido'")
    if [ "$seq_ar" = "1" ]; then
        _out+="- [OK] Secuencia seq_ajuste_rapido existe"$'\n'
    else
        _out+="- [WARN] Secuencia seq_ajuste_rapido NO existe"$'\n'
    fi

    local seq_trf=""
    seq_trf=$(_run_sql "SELECT 1 FROM information_schema.sequences WHERE sequence_name='seq_transferencias'")
    if [ "$seq_trf" = "1" ]; then
        _out+="- [OK] Secuencia seq_transferencias existe"$'\n'
    else
        _out+="- [WARN] Secuencia seq_transferencias NO existe"$'\n'
    fi

    # 11. Triggers stock (v45)
    local trg_count=""
    trg_count=$(_run_sql "SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid WHERE c.relname='inventario_deposito' AND NOT t.tgisinternal")
    if [ "${trg_count:-0}" -ge 2 ]; then
        _out+="- [OK] Triggers inventario_deposito: $trg_count (sync_cache + alertas)"$'\n'
    else
        _out+="- [WARN] Triggers inventario_deposito: $trg_count (esperado 2)"$'\n'
    fi

    # 12. Funcion reconciliacion (v45)
    local recon=""
    recon=$(_run_sql "SELECT 1 FROM pg_proc WHERE proname='verificar_reconciliacion_stock'")
    if [ "$recon" = "1" ]; then
        _out+="- [OK] Funcion verificar_reconciliacion_stock() existe"$'\n'
    else
        _out+="- [WARN] Funcion verificar_reconciliacion_stock() NO existe"$'\n'
    fi


    _out+="**Resultado datos semilla:** ${errores} errores"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

# =======================================================================================
# [v44] VERIFICAR CONSTRAINTS vs TRIGGERS — Detecta desacoples
# =======================================================================================
verificar_constraints_triggers() {
    local destino="${1:-}"
    local _out=""
    local errores=0 warnings=0

    _out+="### VERIFICACION CONSTRAINTS vs TRIGGERS"$'\n'
    _out+="Detecta CHECK constraints cuyos valores no coinciden con lo que insertan los triggers."$'\n'$'\n'

    if ! verificar_bd 2>/dev/null; then
        _out+="- [SKIP] BD no disponible"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
        return 0
    fi

    # 1. Obtener CHECK constraints con listas de valores (ARRAY o IN)
    local checks=""
    checks=$(_run_sql "
        SELECT conname, relname, pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class r ON c.conrelid = r.oid
        JOIN pg_namespace n ON r.relnamespace = n.oid
        WHERE c.contype = 'c' AND n.nspname = 'public'
        AND pg_get_constraintdef(c.oid) LIKE '%ANY%ARRAY%'
        ORDER BY relname, conname
    ")

    if [ -z "$checks" ]; then
        _out+="- [OK] No hay CHECK constraints con listas de valores"$'\n'
    else
        while IFS='|' read -r conname relname condef; do
            [ -z "$conname" ] && continue
            conname=$(echo "$conname" | xargs)
            relname=$(echo "$relname" | xargs)

            # Extraer columna del CHECK
            local col=""
            col=$(echo "$condef" | grep -oP '\(\(([a-z_]+)' | head -1 | sed 's/((//')

            if [ -z "$col" ]; then
                _out+="- [INFO] $relname.$conname: no pude extraer columna"$'\n'
                continue
            fi

            # Buscar triggers que insertan en esta tabla
            local trigger_vals=""
            trigger_vals=$(_run_sql "
                SELECT DISTINCT p.prosrc
                FROM pg_trigger t
                JOIN pg_proc p ON t.tgfoid = p.oid
                WHERE t.tgrelid = (SELECT oid FROM pg_class WHERE relname = '$relname')
                AND NOT t.tgisinternal
            ")

            if [ -z "$trigger_vals" ]; then
                _out+="- [OK] $relname.$conname: sin triggers que inserten"$'\n'
                continue
            fi

            # Extraer valores del CHECK constraint
            local check_vals=""
            check_vals=$(echo "$condef" | grep -oP "'[^']+'" | tr -d "'" | sort | tr '\n' ', ' | sed 's/,$//')

            # Extraer valores que los triggers usan para esa columna
            # [v56 FIX] Filtrar pg_notify/raise/format antes de extraer literales.
            # El primer arg de pg_notify(channel, payload) es nombre de canal LISTEN/NOTIFY,
            # no un valor de columna. Sin este filtro, triggers como
            # PERFORM pg_notify('new_print_job', NEW.id::text) generaban falso positivo
            # en print_jobs.print_jobs_status_check y print_jobs_type_check.
            local trigger_clean
            trigger_clean=$(echo "$trigger_vals" \
                | sed -E "s/pg_notify[[:space:]]*\\([^)]*\\)//g" \
                | sed -E "s/raise[[:space:]]+(notice|warning|exception|info|log|debug)[[:space:]]+'[^']*'//gI" \
                | sed -E "s/format[[:space:]]*\\([^)]*\\)//g")
            local trigger_insert_vals=""
            trigger_insert_vals=$(echo "$trigger_clean" | grep -oP "'[^']+'" | tr -d "'" | sort -u | tr '\n' ', ' | sed 's/,$//')

            # Comparar: buscar valores de trigger que no están en el CHECK
            local missing=""
            IFS=',' read -ra TVALS <<< "$trigger_insert_vals"
            for tv in "${TVALS[@]}"; do
                tv=$(echo "$tv" | xargs)
                [ -z "$tv" ] && continue
                if ! echo ",$check_vals," | grep -q ",$tv,"; then
                    missing+="$tv, "
                fi
            done

            if [ -n "$missing" ]; then
                missing=$(echo "$missing" | sed 's/, $//')
                _out+="- [FAIL] $relname.$conname ($col): trigger usa [$missing] pero CHECK no lo permite"$'\n'
                _out+="  CHECK permite: [$check_vals]"$'\n'
                _out+="  Trigger inserta: [$trigger_insert_vals]"$'\n'
                errores=$((errores + 1))
            else
                _out+="- [OK] $relname.$conname ($col): trigger y CHECK alineados"$'\n'
            fi
        done <<< "$checks"
    fi

    _out+=$'\n'
    _out+="**Resultado constraints/triggers:** $errores errores, $warnings warnings"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# [v56.1] VERIFICAR SISTEMA IMPRESION (patron real verificado)
# =======================================================================================
# El ERP usa UN SOLO patron de impresion: HTML server-side desde plantilla .hbs,
# devuelto al browser cliente, que dispara window.print() via <script> al final.
# NO usa Puppeteer (descartado por RAM + bloqueo del ERP — ver leccion aprendida).
#
# Esta funcion verifica el patron real, no asume cola fiscal.
# Solo se invoca desde menu (opcion 13) o CLI (`impresion`).
verificar_sistema_impresion() {
    local destino="${1:-}"
    local _out=""

    _out+="### SISTEMA DE IMPRESION (patron real)"$'\n'
    _out+=$'\n'
    _out+="**Patron unico:** controller renderiza .hbs server-side -> devuelve HTML"$'\n'
    _out+="-> el browser cliente dispara window.print() via <script>window.onload=...</script>"$'\n'
    _out+="al final del template. Cero RAM en servidor, cero bloqueo."$'\n'
    _out+=$'\n'
    _out+="**NO usa Puppeteer.** Descartado por RAM + bloqueo del ERP cuando un job"$'\n'
    _out+="quedaba a medias. NO proponer cola Puppeteer/CUPS para nada nuevo."$'\n'
    _out+=$'\n'

    # ---- 1. PLANTILLAS EN DISCO ----
    _out+="#### Plantillas Handlebars en disco"$'\n'
    if [ -d "$PROJECT_ROOT/templates/comprobantes" ]; then
        local hbs_files
        hbs_files=$(find "$PROJECT_ROOT/templates/comprobantes" -maxdepth 2 -name "*.hbs" 2>/dev/null | grep -v "\.bak" | sort)
        if [ -n "$hbs_files" ]; then
            while IFS= read -r f; do
                [ -z "$f" ] && continue
                local sz; sz=$(wc -c < "$f" 2>/dev/null)
                local has_print="-"
                grep -q "window\.print" "$f" 2>/dev/null && has_print="auto-print OK"
                _out+="- [OK] $(basename "$f") (${sz} bytes, ${has_print})"$'\n'
            done <<< "$hbs_files"
        else
            _out+="- [WARN] templates/comprobantes/ existe pero esta vacia"$'\n'
        fi
    else
        _out+="- [FAIL] templates/comprobantes/ NO existe"$'\n'
    fi

    _out+=$'\n'
    _out+="#### Plantillas legacy (config/plantillas/)"$'\n'
    if [ -d "$PROJECT_ROOT/config/plantillas" ]; then
        local html_files
        html_files=$(find "$PROJECT_ROOT/config/plantillas" -maxdepth 1 \( -name "*.html" -o -name "*.json" \) 2>/dev/null | grep -v "\.bak" | sort)
        if [ -n "$html_files" ]; then
            while IFS= read -r f; do
                [ -z "$f" ] && continue
                local sz; sz=$(wc -c < "$f" 2>/dev/null)
                _out+="- [OK] $(basename "$f") (${sz} bytes)"$'\n'
            done <<< "$html_files"
        fi
    fi
    _out+=$'\n'

    # ---- 2. RUTAS DE PRINT ----
    _out+="#### Rutas en print.routes.js"$'\n'
    if [ -f "$PROJECT_ROOT/src/routes/print.routes.js" ]; then
        local rutas
        rutas=$(grep -E "router\.(get|post|put|delete)" "$PROJECT_ROOT/src/routes/print.routes.js" 2>/dev/null)
        if [ -n "$rutas" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                local clean
                clean=$(echo "$line" | sed -E 's/^[[:space:]]+//')
                _out+="    $clean"$'\n'
            done <<< "$rutas"
        fi
    else
        _out+="- [FAIL] src/routes/print.routes.js NO existe"$'\n'
    fi
    _out+=$'\n'

    # ---- 3. ARCHIVOS FRONTEND QUE DISPARAN IMPRESION ----
    _out+="#### Archivos frontend que disparan impresion (window.open + /print/)"$'\n'
    if [ -d "$PROJECT_ROOT/frontend/js" ]; then
        local hits
        hits=$(grep -rn "window\.open.*\/print\/" "$PROJECT_ROOT/frontend/js" --include="*.js" 2>/dev/null | grep -v "\.bak" | head -20)
        if [ -n "$hits" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                local file_part url_part
                file_part=$(echo "$line" | cut -d: -f1 | xargs basename)
                local lineno; lineno=$(echo "$line" | cut -d: -f2)
                _out+="- $file_part:$lineno"$'\n'
            done <<< "$hits"
        else
            _out+="- [WARN] No se encontraron archivos JS con window.open(/print/...)"$'\n'
        fi
    fi
    _out+=$'\n'

    # ---- 4. HANDLERS EN print.controller.js ----
    _out+="#### Handlers en print.controller.js"$'\n'
    if [ -f "$PROJECT_ROOT/src/controllers/print.controller.js" ]; then
        local handlers
        handlers=$(grep -nE "(async )?(function )?[a-zA-Z]+[[:space:]]*[:=]?[[:space:]]*(async )?\([^)]*\)[[:space:]]*=>|exports\.[a-zA-Z]+|^[[:space:]]*async [a-zA-Z]+\(" "$PROJECT_ROOT/src/controllers/print.controller.js" 2>/dev/null | head -15)
        # Mas simple: solo grep de exports
        local exports
        exports=$(grep -nE "module\.exports|exports\.[a-zA-Z]+" "$PROJECT_ROOT/src/controllers/print.controller.js" 2>/dev/null | head -10)
        if [ -n "$exports" ]; then
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                _out+="    $line"$'\n'
            done <<< "$exports"
        fi
    else
        _out+="- [FAIL] src/controllers/print.controller.js NO existe"$'\n'
    fi
    _out+=$'\n'

    # ---- 5. TABLAS HISTORICAS (print_jobs / printers_config / log_impresiones) ----
    _out+="#### Tablas historicas (NO son el patron actual)"$'\n'
    _out+="*Estas tablas existen en BD pero el patron vigente NO las usa.*"$'\n'
    _out+="*Si tienen actividad reciente, son zombis o restos de un intento previo.*"$'\n'
    if verificar_bd 2>/dev/null; then
        for tbl in print_jobs printers_config log_impresiones; do
            if _table_exists "$tbl"; then
                local cnt; cnt=$(_table_count "$tbl")
                _out+="- $tbl: ${cnt:-0} registros"$'\n'
                if [ "$tbl" = "print_jobs" ] && [ "${cnt:-0}" -gt 0 ] 2>/dev/null; then
                    local zombi
                    zombi=$(_run_sql "SELECT COUNT(*) FROM print_jobs WHERE status IN ('PENDING','PROCESSING')")
                    if [ "${zombi:-0}" -gt 0 ] 2>/dev/null; then
                        _out+="    [INFO] ${zombi} jobs en PENDING/PROCESSING — zombis (no hay worker corriendo)"$'\n'
                    fi
                fi
            else
                _out+="- $tbl: no existe"$'\n'
            fi
        done
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=$'\n'

    _out+="**Resultado:** Mapeo del patron real. Para agregar un imprimible nuevo,"$'\n'
    _out+="ver receta de 4 pasos en PROMPT_MAESTRO.md seccion 'IMPRESION — RECETA REAL DEL ERP'."$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# [v56] VERIFICAR LAGO.AR (catalogo publico)
# =======================================================================================
# Estado del ultimo deploy, claves de config, archivos en publico/, cron habilitado.
# Solo se invoca desde menu (opcion 14) o CLI (`lago`). NO se llama desde
# informe_completo() ni prompt_maestro() para evitar duplicacion en el informe.
verificar_lago_ar() {
    local destino="${1:-}"
    local _out=""

    _out+="### LAGO.AR — CATALOGO PUBLICO"$'\n'
    _out+=$'\n'
    _out+="Sitio estatico HTML+CSS+JS en Hostinger (FTP), genera catalogo.json desde BD."$'\n'
    _out+="Helper SOLID: src/utils/lago-deploy.helper.js"$'\n'
    _out+=$'\n'

    # ---- 1. Componentes backend ----
    _out+="#### Componentes backend"$'\n'
    for f in \
        "src/utils/lago-deploy.helper.js" \
        "src/controllers/lago-deploy.controller.js" \
        "src/routes/lago-deploy.routes.js" \
        "scripts/generar-catalogo-web.js" \
        "scripts/lago-cron-deploy.js"; do
        if [ -f "$PROJECT_ROOT/$f" ]; then
            local lineas; lineas=$(wc -l < "$PROJECT_ROOT/$f" 2>/dev/null || echo "?")
            _out+="- [OK] $f (${lineas}L)"$'\n'
        else
            _out+="- [FAIL] $f NO existe"$'\n'
        fi
    done
    _out+=$'\n'

    # ---- 2. Source of truth /publico/ ----
    _out+="#### Source of truth: /root/mi_erp/publico/"$'\n'
    if [ -d "$PROJECT_ROOT/publico" ]; then
        for f in index.html css/lago.css js/lago.js corralon.html; do
            if [ -f "$PROJECT_ROOT/publico/$f" ]; then
                local sz; sz=$(wc -c < "$PROJECT_ROOT/publico/$f" 2>/dev/null)
                _out+="- [OK] publico/$f (${sz} bytes)"$'\n'
            else
                _out+="- [WARN] publico/$f NO existe"$'\n'
            fi
        done
        local bak_count
        bak_count=$(find "$PROJECT_ROOT/publico" -maxdepth 3 -name "*.bak_*" 2>/dev/null | wc -l)
        _out+="- [INFO] ${bak_count} backups timestamped (.bak_*) en publico/"$'\n'
    else
        _out+="- [FAIL] /root/mi_erp/publico/ NO existe"$'\n'
    fi
    _out+=$'\n'

    # ---- 3. Output del generador ----
    _out+="#### Output del generador"$'\n'
    if [ -f "$PROJECT_ROOT/catalogo-web/catalogo.json" ]; then
        local cj_size cj_age
        cj_size=$(wc -c < "$PROJECT_ROOT/catalogo-web/catalogo.json" 2>/dev/null)
        cj_age=$(stat -c %y "$PROJECT_ROOT/catalogo-web/catalogo.json" 2>/dev/null | cut -d. -f1)
        _out+="- [OK] catalogo-web/catalogo.json (${cj_size} bytes, modificado: ${cj_age})"$'\n'
        if [ "${cj_size:-0}" -lt 1000 ] 2>/dev/null; then
            _out+="- [WARN] JSON sospechosamente pequeño (<1KB) — posible deploy fallido"$'\n'
        fi
    else
        _out+="- [WARN] catalogo-web/catalogo.json no existe (nunca se genero)"$'\n'
    fi
    _out+=$'\n'

    # ---- 4. Configuraciones en BD ----
    if verificar_bd 2>/dev/null; then
        _out+="#### Configuraciones en BD (id_empresa=1)"$'\n'
        local cw_count ld_count emp_count
        cw_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE id_empresa=1 AND clave LIKE 'catalogo_web.%'")
        ld_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE id_empresa=1 AND clave LIKE 'lago_deploy.%'")
        emp_count=$(_run_sql "SELECT COUNT(*) FROM configuraciones_empresa WHERE id_empresa=1 AND clave LIKE 'empresa.%'")
        _out+="- catalogo_web.* : ${cw_count:-0} claves"$'\n'
        _out+="- lago_deploy.*  : ${ld_count:-0} claves"$'\n'
        _out+="- empresa.*      : ${emp_count:-0} claves"$'\n'

        local claves_obligatorias=(
            "lago_deploy.ftp_host"
            "lago_deploy.ftp_user"
            "lago_deploy.ftp_pass"
            "lago_deploy.ftp_remote_dir"
            "lago_deploy.local_publico_dir"
            "lago_deploy.cron_enabled"
            "catalogo_web.id_empresa"
            "catalogo_web.id_lista_precio"
        )
        local faltantes=0
        for clave in "${claves_obligatorias[@]}"; do
            local existe
            existe=$(_run_sql "SELECT 1 FROM configuraciones_empresa WHERE id_empresa=1 AND clave='$clave'")
            if [ -z "$existe" ]; then
                _out+="- [FAIL] FALTA clave: $clave"$'\n'
                faltantes=$((faltantes + 1))
            fi
        done
        [ "$faltantes" -eq 0 ] && _out+="- [OK] Todas las claves obligatorias presentes"$'\n'

        local cron_state
        cron_state=$(_run_sql "SELECT valor FROM configuraciones_empresa WHERE id_empresa=1 AND clave='lago_deploy.cron_enabled'")
        _out+="- cron_enabled en BD: ${cron_state:-?}"$'\n'
        _out+=$'\n'

        # ---- 5. Historial deploys ----
        _out+="#### Historial deploys (lago_deploy_log)"$'\n'
        if _table_exists "lago_deploy_log"; then
            local total_deploys ok_deploys err_deploys
            total_deploys=$(_run_sql "SELECT COUNT(*) FROM lago_deploy_log")
            ok_deploys=$(_run_sql "SELECT COUNT(*) FROM lago_deploy_log WHERE estado='ok'")
            err_deploys=$(_run_sql "SELECT COUNT(*) FROM lago_deploy_log WHERE estado='error'")
            _out+="- Total: ${total_deploys:-0} | OK: ${ok_deploys:-0} | ERROR: ${err_deploys:-0}"$'\n'

            local ultimo
            ultimo=$(_run_sql "SELECT fecha || ' | ' || tipo || ' | ' || estado || ' | ' || COALESCE(productos_count::text,'?') || ' prods | ' || COALESCE(duracion_ms::text,'?') || ' ms' FROM lago_deploy_log ORDER BY fecha DESC LIMIT 1")
            [ -n "$ultimo" ] && _out+="- Ultimo deploy: $ultimo"$'\n'

            local ultimo_error
            ultimo_error=$(_run_sql "SELECT fecha || ' | ' || COALESCE(LEFT(error_msg,80),'(sin msg)') FROM lago_deploy_log WHERE estado='error' ORDER BY fecha DESC LIMIT 1")
            [ -n "$ultimo_error" ] && _out+="- Ultimo error: $ultimo_error"$'\n'
        else
            _out+="- [FAIL] Tabla lago_deploy_log NO existe"$'\n'
        fi
    else
        _out+="- [SKIP] BD no disponible"$'\n'
    fi
    _out+=$'\n'

    # ---- 6. Crontab ----
    _out+="#### Crontab"$'\n'
    if command -v crontab &>/dev/null; then
        local cron_line
        cron_line=$(crontab -l 2>/dev/null | grep -i "lago" || echo "")
        if [ -n "$cron_line" ]; then
            _out+="- [OK] Entrada en crontab: $cron_line"$'\n'
        else
            _out+="- [WARN] Sin entrada de lago en crontab del usuario actual"$'\n'
        fi
    fi
    if [ -f "/var/log/lago-deploy.log" ]; then
        local log_size
        log_size=$(wc -c < /var/log/lago-deploy.log 2>/dev/null)
        _out+="- /var/log/lago-deploy.log: ${log_size} bytes"$'\n'
    fi
    _out+=$'\n'

    _out+="**Hostinger:** 82.180.153.72 / domains/lago.ar/public_html — Plan Premium PHP/HTML"$'\n'
    _out+="**URL publica:** https://lago.ar"$'\n'

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# [v58] INTEGRIDAD REFERENCIAL — Foreign keys, triggers, unique idx, sequences, views
# =======================================================================================
verificar_integridad_referencial() {
    local FILE="${1:-}"
    local STANDALONE=0
    if [ -z "$FILE" ]; then
        FILE="$OUTPUT_DIR/INTEGRIDAD_REFERENCIAL.md"
        STANDALONE=1
        > "$FILE"
        echo "# INTEGRIDAD REFERENCIAL - ERP LAGO" >> "$FILE"
        echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$FILE"
        echo "" >> "$FILE"
    fi

    if ! verificar_bd; then
        echo "- [SKIP] BD no disponible" >> "$FILE"
        [ "$STANDALONE" -eq 1 ] && echo -e "${RED}BD no disponible${NC}"
        return
    fi

    # ============================================================
    # 1. FOREIGN KEYS
    # ============================================================
    echo "## 1. Foreign Keys" >> "$FILE"
    echo "" >> "$FILE"

    local fk_total fk_cascade fk_restrict fk_setnull fk_noaction fk_setdefault
    fk_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f'" 2>/dev/null || echo 0)
    fk_cascade=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='c'" 2>/dev/null || echo 0)
    fk_restrict=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='r'" 2>/dev/null || echo 0)
    fk_setnull=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='n'" 2>/dev/null || echo 0)
    fk_noaction=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='a'" 2>/dev/null || echo 0)
    fk_setdefault=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND confdeltype='d'" 2>/dev/null || echo 0)

    echo "**Total: ${fk_total} FKs**" >> "$FILE"
    echo "" >> "$FILE"
    echo "| ON DELETE | Cantidad |" >> "$FILE"
    echo "|---|---|" >> "$FILE"
    echo "| CASCADE | ${fk_cascade} |" >> "$FILE"
    echo "| RESTRICT | ${fk_restrict} |" >> "$FILE"
    echo "| SET NULL | ${fk_setnull} |" >> "$FILE"
    echo "| NO ACTION (default) | ${fk_noaction} |" >> "$FILE"
    echo "| SET DEFAULT | ${fk_setdefault} |" >> "$FILE"
    echo "" >> "$FILE"

    echo "### Lista completa" >> "$FILE"
    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT
            c.conname || ': ' ||
            t.relname || '.' || a.attname || ' -> ' ||
            ft.relname || '.' || fa.attname || ' [' ||
            CASE c.confdeltype
                WHEN 'c' THEN 'CASCADE'
                WHEN 'r' THEN 'RESTRICT'
                WHEN 'n' THEN 'SET NULL'
                WHEN 'a' THEN 'NO ACTION'
                WHEN 'd' THEN 'SET DEFAULT'
            END || ']'
        FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_class ft ON ft.oid=c.confrelid
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
        JOIN pg_attribute fa ON fa.attrelid=c.confrelid AND fa.attnum=c.confkey[1]
        WHERE c.contype='f'
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY t.relname, a.attname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 2. TRIGGERS
    # ============================================================
    echo "## 2. Triggers activos" >> "$FILE"
    echo "" >> "$FILE"

    local trg_total
    trg_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal" 2>/dev/null || echo 0)
    echo "**Total: ${trg_total} triggers (excluye internos)**" >> "$FILE"
    echo "" >> "$FILE"

    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT
            c.relname || '.' || t.tgname || ' [' ||
            CASE WHEN (t.tgtype & 2) > 0 THEN 'BEFORE' ELSE 'AFTER' END || ' ' ||
            CASE
                WHEN (t.tgtype & 4) > 0 THEN 'INSERT'
                WHEN (t.tgtype & 8) > 0 THEN 'DELETE'
                WHEN (t.tgtype & 16) > 0 THEN 'UPDATE'
                ELSE '?'
            END || '] -> ' || p.proname || '()'
        FROM pg_trigger t
        JOIN pg_class c ON c.oid=t.tgrelid
        JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE NOT t.tgisinternal
          AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY c.relname, t.tgname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 3. UNIQUE INDEXES (excluye PKs)
    # ============================================================
    echo "## 3. Unique constraints e indices unicos (excluye PKs)" >> "$FILE"
    echo "" >> "$FILE"

    local uniq_total
    uniq_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT COUNT(*) FROM pg_index x
        JOIN pg_class c ON c.oid=x.indrelid
        WHERE x.indisunique AND NOT x.indisprimary
          AND c.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
    " 2>/dev/null || echo 0)
    echo "**Total: ${uniq_total} unique indexes**" >> "$FILE"
    echo "" >> "$FILE"

    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT pg_get_indexdef(x.indexrelid)
        FROM pg_index x
        JOIN pg_class i ON i.oid=x.indexrelid
        JOIN pg_class t ON t.oid=x.indrelid
        WHERE x.indisunique AND NOT x.indisprimary
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
        ORDER BY t.relname, i.relname;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 4. SECUENCIAS + deteccion de desincronizacion
    # ============================================================
    echo "## 4. Secuencias" >> "$FILE"
    echo "" >> "$FILE"

    local seq_total
    seq_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_sequences WHERE schemaname='public'" 2>/dev/null || echo 0)
    echo "**Total: ${seq_total} secuencias**" >> "$FILE"
    echo "" >> "$FILE"

    echo "### Listado (last_value)" >> "$FILE"
    echo '```' >> "$FILE"
    psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT sequencename || ': ' || COALESCE(last_value::text, 'NULL')
        FROM pg_sequences
        WHERE schemaname='public'
        ORDER BY sequencename;
    " 2>/dev/null >> "$FILE"
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    echo "### Desincronizacion (MAX columna duena > last_value)" >> "$FILE"
    echo '```' >> "$FILE"
    local desync_out
    desync_out=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" <<'SQLDESYNC' 2>&1
DO $$
DECLARE
    rec RECORD;
    max_val BIGINT;
    seq_val BIGINT;
BEGIN
    FOR rec IN
        SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
        FROM pg_class s
        JOIN pg_depend d ON d.objid=s.oid AND d.deptype='a'
        JOIN pg_class t ON t.oid=d.refobjid
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
        WHERE s.relkind='S'
          AND t.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')
    LOOP
        BEGIN
            EXECUTE format('SELECT MAX(%I) FROM %I', rec.col, rec.tbl) INTO max_val;
            EXECUTE format('SELECT last_value FROM %I', rec.seq) INTO seq_val;
            IF max_val IS NOT NULL AND max_val > seq_val THEN
                RAISE NOTICE '%.%: max=% seq=% (DESYNC, riesgo duplicate key)',
                    rec.tbl, rec.col, max_val, seq_val;
            END IF;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;
END $$;
SQLDESYNC
)
    local desync_lines
    desync_lines=$(echo "$desync_out" | grep "NOTICE" | sed 's/^NOTICE:  /- [DESYNC] /' || true)
    if [ -n "$desync_lines" ]; then
        echo "$desync_lines" >> "$FILE"
    else
        echo "- [OK] Todas las secuencias en sync con su columna duena" >> "$FILE"
    fi
    echo '```' >> "$FILE"
    echo "" >> "$FILE"

    # ============================================================
    # 5. VIEWS Y MATERIALIZED VIEWS
    # ============================================================
    echo "## 5. Views y Materialized Views" >> "$FILE"
    echo "" >> "$FILE"

    local view_total matview_total
    view_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_views WHERE schemaname='public'" 2>/dev/null || echo 0)
    matview_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM pg_matviews WHERE schemaname='public'" 2>/dev/null || echo 0)

    echo "**Views: ${view_total} | Materialized views: ${matview_total}**" >> "$FILE"
    echo "" >> "$FILE"

    if [ "$view_total" -gt 0 ]; then
        echo "### Views" >> "$FILE"
        echo '```' >> "$FILE"
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT viewname FROM pg_views WHERE schemaname='public' ORDER BY viewname" \
            2>/dev/null >> "$FILE"
        echo '```' >> "$FILE"
        echo "" >> "$FILE"
    fi

    if [ "$matview_total" -gt 0 ]; then
        echo "### Materialized Views" >> "$FILE"
        echo '```' >> "$FILE"
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname" \
            2>/dev/null >> "$FILE"
        echo '```' >> "$FILE"
        echo "" >> "$FILE"
    fi

    if [ "$STANDALONE" -eq 1 ]; then
        echo -e "${GREEN}[OK] Integridad referencial: $FILE${NC}"
    fi
}


detectar_features_especiales() {
    local destino="${1:-}"
    local _out=""

    # --- 1. Columnas custom en tablas principales ---
    _out+="### Columnas custom en tablas principales"$'\n'$'\n'
    if verificar_bd; then
        # Detectar columnas que no son PK, FK, timestamps ni campos standard
        local custom_cols=""
        custom_cols=$(_run_sql "
            SELECT t.table_name || '.' || c.column_name || ' (' || c.data_type || 
                   COALESCE(' ' || c.character_maximum_length::text, '') || ')'
            FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name = t.table_name
            WHERE c.table_schema = 'public' 
            AND t.table_type = 'BASE TABLE'
            AND c.column_name NOT IN (
                'id','activo','fecha_creacion','fecha_modificacion','created_at','updated_at',
                'nombre','descripcion','observaciones','notas'
            )
            AND c.column_name LIKE '%origen%' 
            OR c.column_name LIKE '%custom%'
            OR c.column_name LIKE '%extra%'
            OR (c.table_name = 'productos' AND c.column_name NOT IN (
                'id_producto','sku','nombre','descripcion','id_categoria','unidad_medida',
                'marca','cod_proveedor','fecha_creacion','fecha_modificacion','activo',
                'url_imagen','id_marca','tiene_variantes','id_alicuota_iva','busqueda_vector','visible_web'
            ))
            ORDER BY t.table_name, c.ordinal_position;
        ")
        if [ -n "$custom_cols" ]; then
            while IFS= read -r col; do
                [ -n "$col" ] && _out+="- $col"$'\n'
            done <<< "$custom_cols"
        else
            _out+="(ninguna detectada)"$'\n'
        fi
    else
        _out+="(BD no disponible)"$'\n'
    fi
    _out+=""$'\n'

    # --- 2. Endpoints por modulo (rutas reales) ---
    _out+="### Endpoints por modulo"$'\n'$'\n'
    if [ -n "${ROUTES_DIR:-}" ] && [ -d "$ROUTES_DIR" ]; then
        while IFS= read -r route_file; do
            [ -z "$route_file" ] && continue
            local rname; rname=$(basename "$route_file" .routes.js)
            local endpoints=""
            endpoints=$(grep -oE "router\.(get|post|put|delete)\(['\"][^'\"]*['\"]" "$route_file" 2>/dev/null \
                | sed "s/router\.\(get\|post\|put\|delete\)(['\"]//; s/['\"]$//" | sort -u || true)
            if [ -n "$endpoints" ]; then
                local ep_count; ep_count=$(echo "$endpoints" | wc -l)
                _out+="**${rname}** (${ep_count} rutas):"$'\n'
                while IFS= read -r ep; do
                    [ -n "$ep" ] && _out+="  - $ep"$'\n'
                done <<< "$endpoints"
                _out+=""$'\n'
            fi
        done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)
    fi

    # --- 3. Filtros frontend por pagina ---
    _out+="### Filtros frontend (selects en HTML)"$'\n'$'\n'
    if [ -n "${FRONTEND_DIR:-}" ] && [ -d "$FRONTEND_DIR" ]; then
        while IFS= read -r html_file; do
            [ -z "$html_file" ] && continue
            local hname; hname=$(basename "$html_file" .html)
            local filtros=""
            filtros=$(grep -oE 'id="filtro[A-Za-z]*"' "$html_file" 2>/dev/null | sed 's/id="//; s/"//' | sort -u || true)
            if [ -n "$filtros" ]; then
                _out+="**${hname}.html**: "
                local flist=""
                while IFS= read -r f; do [ -n "$f" ] && flist+="$f, "; done <<< "$filtros"
                _out+="${flist%, }"$'\n'
            fi
        done < <(find "$FRONTEND_DIR" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)
    fi
    _out+=""$'\n'

    # --- 4. Valores archivo_origen (si existe) ---
    if verificar_bd; then
        local tiene_ao=""
        tiene_ao=$(_run_sql \
            "SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='archivo_origen'")
        if [ "$tiene_ao" = "1" ]; then
            _out+="### Archivos origen registrados (productos.archivo_origen)"$'\n'$'\n'
            local archivos=""
            archivos=$(_run_sql \
                "SELECT archivo_origen || ' (' || COUNT(*) || ' productos)' FROM productos WHERE archivo_origen IS NOT NULL AND activo = true GROUP BY archivo_origen ORDER BY archivo_origen")
            if [ -n "$archivos" ]; then
                while IFS= read -r a; do [ -n "$a" ] && _out+="- $a"$'\n'; done <<< "$archivos"
            else
                _out+="(ninguno registrado)"$'\n'
            fi
            _out+=""$'\n'
        fi
    fi

    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}


# =======================================================================================
# [v36] AUDITORIA DE SEGURIDAD Y CONTROL DE ACCESO
# =======================================================================================

##
# @function detectar_doble_api
# @description Detecta el patron ${API_BASE}/api/ en JS del frontend.
#   config.js define API_BASE_URL = 'http://host:port/api' (ya incluye /api).
#   Si alguien escribe ${API_BASE}/api/auth/perfil genera /api/api/auth/perfil → 404.
#   Leccion: sesion 2026-02-24, 2+ horas perdidas en loop infinito por este patron.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_doble_api() {
    local destino="${1:-}"
    local _out=""
    _out+="### Deteccion de doble /api en frontend JS"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local encontrados=0
    while IFS= read -r linea; do
        [ -z "$linea" ] && continue
        _out+="- [BUG] $linea"$'\n'
        encontrados=$((encontrados + 1))
    done < <(grep -rn 'API_BASE.*\/api\/' "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" || true)

    if [ "$encontrados" -eq 0 ]; then
        _out+="[OK] Ningun caso de doble /api detectado"$'\n'
    else
        _out+=""$'\n'"**ALERTA:** $encontrados casos de doble /api. API_BASE_URL ya incluye /api."$'\n'
        _out+="Correcto: \${API_BASE}/auth/perfil"$'\n'
        _out+="Incorrecto: \${API_BASE}/api/auth/perfil"$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_redirects_login
# @description Lista TODOS los archivos JS del frontend que redirigen a login.html.
#   Estado ideal: solo auth.js y login.html deberian redirigir a login.
#   El resto deberia delegar al server-side (html-access.middleware.js).
#   Leccion: sesion 2026-02-24, 10+ archivos con redirect independiente.
# @since v36.0
# @returns {void} Imprime listado a stdout o agrega a archivo
##
detectar_redirects_login() {
    local destino="${1:-}"
    local _out=""
    _out+="### Puntos de redirect a login.html en frontend JS"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local archivos_con_redirect=""
    archivos_con_redirect=$(grep -rl "login\.html" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" | grep -v "node_modules" || true)
    local total=0
    local redundantes=0

    if [ -n "$archivos_con_redirect" ]; then
        while IFS= read -r archivo; do
            [ -z "$archivo" ] && continue
            local nombre; nombre=$(basename "$archivo")
            local count; count=$(grep -c "login\.html" "$archivo" 2>/dev/null) || count=0
            total=$((total + 1))
            case "$nombre" in
                auth.js|login.js)
                    _out+="- [OK] $nombre ($count refs) - esperado"$'\n'
                    ;;
                *)
                    _out+="- [WARN] $nombre ($count refs) - redundante con server-side"$'\n'
                    redundantes=$((redundantes + 1))
                    ;;
            esac
        done <<< "$archivos_con_redirect"
    fi

    _out+=""$'\n'
    if [ "$redundantes" -gt 0 ]; then
        _out+="**$redundantes archivos con redirect redundante.** Server-side (html-access.middleware) ya protege HTML."$'\n'
        _out+="Ideal: eliminar redirects client-side excepto auth.js"$'\n'
    else
        _out+="[OK] Solo archivos esperados redirigen a login"$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_403_como_401
# @description Busca archivos JS que tratan HTTP 403 como 401.
#   403 = "sin permiso" (vendedor accede a reportes), 401 = "no autenticado".
#   Si un JS redirige a login en 403, el usuario pierde la sesion innecesariamente.
#   Leccion: sesion 2026-02-24, config.js redirigía en 401 Y 403.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_403_como_401() {
    local destino="${1:-}"
    local _out=""
    _out+="### Deteccion de 403 tratado como 401"$'\n'$'\n'

    if [ -z "${JS_DIR:-}" ] || [ ! -d "$JS_DIR" ]; then
        _out+="(directorio JS frontend no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local encontrados=0
    while IFS= read -r linea; do
        [ -z "$linea" ] && continue
        _out+="- [BUG] $linea"$'\n'
        encontrados=$((encontrados + 1))
    done < <(grep -rn "403.*login\|status.*===.*403.*redirect\|403.*window\.location" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" || true)

    if [ "$encontrados" -eq 0 ]; then
        _out+="[OK] Ningun JS trata 403 como 401"$'\n'
    else
        _out+=""$'\n'"**ALERTA:** $encontrados casos. 403=sin permiso, 401=no autenticado."$'\n'
        _out+="Solo 401 debe redirigir a login. 403 debe mostrar 'Sin permiso'."$'\n'
    fi
    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function verificar_orden_middlewares
# @description Verifica que en server.js el middleware de control de HTML
#   (htmlAccessMiddleware) este registrado ANTES de express.static.
#   express.static sirve archivos sin pasar por middlewares de ruta.
#   Si htmlAccessMiddleware va despues, los HTML se sirven sin proteccion.
#   Leccion: sesion 2026-02-24, diseño inicial equivocado por esto.
# @since v36.0
# @returns {void} Imprime resultado a stdout o agrega a archivo
##
verificar_orden_middlewares() {
    local destino="${1:-}"
    local _out=""
    _out+="### Orden de middlewares en server.js"$'\n'$'\n'

    local server_file="$PROJECT_ROOT/server.js"
    if [ ! -f "$server_file" ]; then
        _out+="(server.js no encontrado)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    # Buscar linea de htmlAccessMiddleware
    local linea_html_access=""
    linea_html_access=$(grep -n "htmlAccessMiddleware\|html-access" "$server_file" 2>/dev/null | grep -v "require\|//" | head -1 | cut -d: -f1 || true)

    # Buscar linea de express.static
    local linea_static=""
    linea_static=$(grep -n "express\.static" "$server_file" 2>/dev/null | grep -v "//" | head -1 | cut -d: -f1 || true)

    if [ -z "$linea_html_access" ]; then
        _out+="[WARN] htmlAccessMiddleware NO encontrado en server.js"$'\n'
        _out+="Los HTML se sirven sin control de acceso server-side"$'\n'
    elif [ -z "$linea_static" ]; then
        _out+="[WARN] express.static NO encontrado en server.js"$'\n'
    elif [ "$linea_html_access" -lt "$linea_static" ]; then
        _out+="[OK] htmlAccessMiddleware (linea $linea_html_access) ANTES de express.static (linea $linea_static)"$'\n'
    else
        _out+="[BUG] express.static (linea $linea_static) esta ANTES de htmlAccessMiddleware (linea $linea_html_access)"$'\n'
        _out+="Los HTML se sirven SIN control de acceso. Invertir el orden en server.js."$'\n'
    fi

    # Verificar cookie-parser
    local tiene_cookie_parser=""
    tiene_cookie_parser=$(grep -c "cookie-parser" "$PROJECT_ROOT/package.json" 2>/dev/null) || tiene_cookie_parser=0
    if [ "$tiene_cookie_parser" -gt 0 ]; then
        _out+="[OK] cookie-parser instalado en package.json"$'\n'
    else
        _out+="[WARN] cookie-parser NO encontrado en package.json (requerido para auth por cookie)"$'\n'
    fi

    # Verificar anti-cache para HTML
    local tiene_anticache=""
    tiene_anticache=$(grep -c "no-cache\|no-store\|must-revalidate" "$server_file" 2>/dev/null) || tiene_anticache=0
    if [ "$tiene_anticache" -gt 0 ]; then
        _out+="[OK] Anti-cache configurado en server.js"$'\n'
    else
        _out+="[WARN] Sin anti-cache para HTML. Browser puede servir HTML viejo del cache."$'\n'
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_transacciones
# @description Detecta operaciones criticas (INSERT a tablas financieras/stock)
#   que NO estan envueltas en transacciones BEGIN/COMMIT.
#   Tablas financieras: movimientos_caja, cuentacorrienteclientes, recibos, pagos, etc.
#   Un INSERT sin transaccion a estas tablas es riesgo de inconsistencia.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_transacciones() {
    local destino="${1:-}"
    local _out=""
    _out+="### Transacciones en operaciones criticas"$'\n'$'\n'

    if [ ! -d "$CONTROLLERS_DIR" ]; then
        _out+="(sin directorio de controllers)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local TABLAS_FINANCIERAS="movimientos_caja turnos_caja recibos recibo_items cuentacorrienteclientes cuentacorrienteproveedores pagosaproveedores facturas factura_items inventario movimientos_stock confirmaciones_pago"

    for tabla in $TABLAS_FINANCIERAS; do
        local archivos_insert=""
        archivos_insert=$(grep -rl "INSERT INTO ${tabla}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
        [ -z "$archivos_insert" ] && continue

        while IFS= read -r archivo; do
            [ -z "$archivo" ] && continue
            local nombre; nombre=$(basename "$archivo")
            local tiene_begin=""
            tiene_begin=$(grep -c "BEGIN\|client\.query.*BEGIN\|pool\.query.*BEGIN" "$archivo" 2>/dev/null) || tiene_begin=0
            if [ "$tiene_begin" -eq 0 ]; then
                _out+="- [WARN] $nombre: INSERT INTO $tabla SIN transaccion"$'\n'
            else
                _out+="- [OK] $nombre: INSERT INTO $tabla con transaccion"$'\n'
            fi
        done <<< "$archivos_insert"
    done

    # Tambien verificar helpers (caller-aware: si recibe client, TX la maneja el controller)
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        for tabla in $TABLAS_FINANCIERAS; do
            local helper_insert=""
            helper_insert=$(grep -rl "INSERT INTO ${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null || true)
            [ -z "$helper_insert" ] && continue
            while IFS= read -r archivo; do
                [ -z "$archivo" ] && continue
                local nombre; nombre=$(basename "$archivo")
                local tiene_begin=""
                tiene_begin=$(grep -c "BEGIN\|client\.query.*BEGIN" "$archivo" 2>/dev/null) || tiene_begin=0
                if [ "$tiene_begin" -gt 0 ]; then
                    _out+="- [OK] $nombre (helper): INSERT INTO $tabla con transaccion"$'\n'
                else
                    # Caller-aware: helper recibe client => TX en controller
                    local uses_client=""
                    uses_client=$(grep -c "async function.*client," "$archivo" 2>/dev/null) || uses_client=0
                    if [ "$uses_client" -gt 0 ]; then
                        local helper_base caller_has_begin=0
                        helper_base=$(basename "$archivo" .js | sed "s/\.helper//")
                        local callers=""
                        callers=$(grep -rl "require.*${helper_base}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
                        if [ -n "$callers" ]; then
                            while IFS= read -r caller; do
                                [ -z "$caller" ] && continue
                                local cb=""
                                cb=$(grep -c "BEGIN" "$caller" 2>/dev/null) || cb=0
                                if [ "$cb" -gt 0 ]; then caller_has_begin=1; break; fi
                            done <<< "$callers"
                        fi
                        if [ "$caller_has_begin" -eq 1 ]; then
                            _out+="- [OK] $nombre (helper): INSERT INTO $tabla con transaccion (caller-managed)"$'\n'
                        else
                            _out+="- [WARN] $nombre (helper): INSERT INTO $tabla SIN transaccion"$'\n'
                        fi
                    else
                        _out+="- [WARN] $nombre (helper): INSERT INTO $tabla SIN transaccion"$'\n'
                    fi
                fi
            done <<< "$helper_insert"
        done
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function detectar_endpoints_huerfanos
# @description Detecta:
#   1. Funciones exportadas en controllers que ninguna ruta referencia
#   2. Funciones referenciadas en routes que no existen en el controller
#   Esto detecta codigo muerto y rutas rotas.
# @since v36.0
# @returns {void} Imprime alertas a stdout o agrega a archivo
##
detectar_endpoints_huerfanos() {
    local destino="${1:-}"
    local _out=""
    _out+="### Endpoints huerfanos"$'\n'$'\n'

    if [ ! -d "$CONTROLLERS_DIR" ] || [ ! -d "$ROUTES_DIR" ]; then
        _out+="(sin directorio de controllers o routes)"$'\n'
        [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"; return 0
    fi

    local huerfanos_total=0

    while IFS= read -r route_file; do
        [ -z "$route_file" ] && continue
        local rname; rname=$(basename "$route_file" .routes.js)

        # Buscar el controller correspondiente
        local ctrl_file=""
        ctrl_file=$(find "$CONTROLLERS_DIR" -name "${rname}.controller.js" 2>/dev/null | head -1 || true)
        [ -z "$ctrl_file" ] && continue

        # Extraer funciones referenciadas en routes
        local funcs_en_rutas=""
        funcs_en_rutas=$(grep -oE "[a-zA-Z]*[Cc]ontroller\.[a-zA-Z_][a-zA-Z0-9_]*" "$route_file" 2>/dev/null \
            | sed 's/.*\.//' | sort -u || true)

        # Extraer funciones exportadas en controller
        local funcs_en_ctrl=""
        funcs_en_ctrl=$(grep -oE "exports\.[a-zA-Z_][a-zA-Z0-9_]*" "$ctrl_file" 2>/dev/null \
            | sed 's/exports\.//' | sort -u || true)

        # Funciones en controller pero no en rutas
        if [ -n "$funcs_en_ctrl" ]; then
            while IFS= read -r fn; do
                [ -z "$fn" ] && continue
                if [ -n "$funcs_en_rutas" ] && echo "$funcs_en_rutas" | grep -qw "$fn"; then
                    : # OK, esta referenciada
                else
                    _out+="- [WARN] ${rname}: exports.$fn() sin ruta asignada"$'\n'
                    huerfanos_total=$((huerfanos_total + 1))
                fi
            done <<< "$funcs_en_ctrl"
        fi
    done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)

    if [ "$huerfanos_total" -eq 0 ]; then
        _out+="[OK] Todos los exports tienen ruta asignada"$'\n'
    else
        _out+=""$'\n'"**$huerfanos_total funciones exportadas sin ruta.** Posible codigo muerto."$'\n'
    fi

    _out+=""$'\n'
    [ -n "$destino" ] && echo "$_out" >> "$destino" || echo "$_out"
}

##
# @function auditar_seguridad
# @description Auditoria completa de seguridad y control de acceso.
#   Ejecuta todas las verificaciones de seguridad y genera reporte.
#   Incluye: orden middlewares, doble /api, redirects login, 403 como 401,
#   cookie-parser, auth por cookie, roles, modulos, tablas de seguridad.
# @since v36.0
# @returns {void} Genera archivo SEGURIDAD_YYYYMMDD_HHMM.md en OUTPUT_DIR
##
auditar_seguridad() {
    local SEC_FILE="$OUTPUT_DIR/SEGURIDAD_$(date +%Y%m%d_%H%M).md"

    header
    echo "Auditando seguridad y control de acceso..."
    echo ""

    explorar_proyecto

    cat > "$SEC_FILE" << EOF
# AUDITORIA DE SEGURIDAD Y CONTROL DE ACCESO
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

EOF

    # === 1. Middlewares ===
    echo "## 1. MIDDLEWARES DE SEGURIDAD" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    verificar_orden_middlewares "$SEC_FILE"

    # Listar middlewares existentes
    echo "### Middlewares detectados" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if [ -n "${MIDDLEWARE_DIR:-}" ] && [ -d "$MIDDLEWARE_DIR" ]; then
        while IFS= read -r mw; do
            [ -z "$mw" ] && continue
            local mname; mname=$(basename "$mw")
            local mlines; mlines=$(wc -l < "$mw" 2>/dev/null || echo "?")
            echo "$mname ($mlines lineas)" >> "$SEC_FILE"
        done < <(find "$MIDDLEWARE_DIR" -name "*.js" -type f 2>/dev/null | sort)
    else
        echo "(directorio middleware no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 2. Auth middleware: busca token en header/query/cookie ===
    echo "## 2. AUTH MIDDLEWARE - FUENTES DE TOKEN" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local auth_mw="$PROJECT_ROOT/src/middleware/auth.middleware.js"
    if [ -f "$auth_mw" ]; then
        local busca_header="" busca_query="" busca_cookie=""
        busca_header=$(grep -c "authorization\|Authorization\|Bearer" "$auth_mw" 2>/dev/null) || busca_header=0
        busca_query=$(grep -c "req\.query.*token\|query\.token" "$auth_mw" 2>/dev/null) || busca_query=0
        busca_cookie=$(grep -c "req\.cookies\|erp_token" "$auth_mw" 2>/dev/null) || busca_cookie=0
        [ "$busca_header" -gt 0 ] && echo "[OK] Busca token en header Authorization" >> "$SEC_FILE" || echo "[WARN] NO busca token en header" >> "$SEC_FILE"
        [ "$busca_query" -gt 0 ] && echo "[OK] Busca token en query string" >> "$SEC_FILE" || echo "[INFO] No busca token en query" >> "$SEC_FILE"
        [ "$busca_cookie" -gt 0 ] && echo "[OK] Busca token en cookie (erp_token)" >> "$SEC_FILE" || echo "[WARN] NO busca token en cookie" >> "$SEC_FILE"
    else
        echo "(auth.middleware.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 3. Login setea cookie / Logout limpia ===
    echo "## 3. COOKIE JWT (SETEO Y LIMPIEZA)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local auth_ctrl="$PROJECT_ROOT/src/controllers/auth.controller.js"
    if [ -f "$auth_ctrl" ]; then
        local setea_cookie="" limpia_cookie=""
        setea_cookie=$(grep -c "res\.cookie" "$auth_ctrl" 2>/dev/null) || setea_cookie=0
        limpia_cookie=$(grep -c "clearCookie" "$auth_ctrl" 2>/dev/null) || limpia_cookie=0
        [ "$setea_cookie" -gt 0 ] && echo "[OK] Login setea cookie ($setea_cookie llamadas)" >> "$SEC_FILE" || echo "[WARN] Login NO setea cookie" >> "$SEC_FILE"
        [ "$limpia_cookie" -gt 0 ] && echo "[OK] Logout limpia cookie ($limpia_cookie llamadas)" >> "$SEC_FILE" || echo "[WARN] Logout NO limpia cookie" >> "$SEC_FILE"
        # Verificar httpOnly
        local http_only=""
        http_only=$(grep -c "httpOnly" "$auth_ctrl" 2>/dev/null) || http_only=0
        [ "$http_only" -gt 0 ] && echo "[OK] Cookie con httpOnly" >> "$SEC_FILE" || echo "[WARN] Cookie SIN httpOnly (vulnerable a XSS)" >> "$SEC_FILE"
    else
        echo "(auth.controller.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 4. Doble /api ===
    echo "## 4. DOBLE /api EN FRONTEND" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_doble_api "$SEC_FILE"

    # === 5. Redirects a login ===
    echo "## 5. REDIRECTS A LOGIN (DISPERSOS)" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_redirects_login "$SEC_FILE"

    # === 6. 403 como 401 ===
    echo "## 6. 403 TRATADO COMO 401" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_403_como_401 "$SEC_FILE"

    # === 7. Tablas de seguridad ===
    echo "## 7. TABLAS DE SEGURIDAD EN BD" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        for tabla in modulos rol_modulos modulo_rutas_api modulo_grupos rutas_soporte dispositivos_autorizados intentos_dispositivo_nuevo usuarios_logs permisos_usuario; do
            if _table_exists "$tabla"; then
                local count=""
                count=$(_table_count "$tabla")
                echo "OK $tabla ($count registros)" >> "$SEC_FILE"
            else
                echo "-- $tabla (no existe)" >> "$SEC_FILE"
            fi
        done
    else
        echo "(BD no disponible)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 8. Roles y modulos ===
    echo "## 8. ROLES Y ACCESO A MODULOS" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        if _table_exists "rol_modulos"; then
            _run_sql_full \
                "SELECT rm.rol, COUNT(*) as modulos, SUM(CASE WHEN rm.solo_lectura THEN 1 ELSE 0 END) as solo_lectura FROM rol_modulos rm WHERE rm.puede_ver = true GROUP BY rm.rol ORDER BY COUNT(*) DESC" >> "$SEC_FILE"
        else
            echo "(tabla rol_modulos no existe)" >> "$SEC_FILE"
        fi
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 9. Paginas publicas vs protegidas ===
    echo "## 9. CATEGORIAS DE PAGINAS HTML" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    echo "### Paginas publicas (sin auth)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    local html_mw="$PROJECT_ROOT/src/middleware/html-access.middleware.js"
    if [ -f "$html_mw" ]; then
        grep -oE "'[a-z_-]*\.html'" "$html_mw" 2>/dev/null | sed "s/'//g" | sort >> "$SEC_FILE" || echo "(no se pudieron extraer)" >> "$SEC_FILE"
    else
        echo "(html-access.middleware.js no encontrado)" >> "$SEC_FILE"
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    echo "### Paginas como modulo (cookie + rol_modulos)" >> "$SEC_FILE"
    echo '```' >> "$SEC_FILE"
    if verificar_bd; then
        if _table_exists "modulos"; then
            _run_sql \
                "SELECT url_frontend || ' (' || nombre || ')' FROM modulos WHERE activo = true ORDER BY nombre" >> "$SEC_FILE"
        fi
    fi
    echo '```' >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"

    # === 10. Transacciones ===
    echo "## 10. TRANSACCIONES EN OPERACIONES CRITICAS" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_transacciones "$SEC_FILE"

    # === 11. Endpoints huerfanos ===
    echo "## 11. ENDPOINTS HUERFANOS" >> "$SEC_FILE"
    echo "" >> "$SEC_FILE"
    detectar_endpoints_huerfanos "$SEC_FILE"

    echo "---" >> "$SEC_FILE"
    echo "*Generado por Toolkit v${VERSION}*" >> "$SEC_FILE"

    echo -e "${GREEN}[OK] Auditoria de seguridad generada: $SEC_FILE${NC}"
}


# =======================================================================================
# [v26] EXTRACCION DE VERSIONES RUNTIME (JDK + Node.js)
# =======================================================================================

extraer_versiones_runtime() {
    # [v43] Usa _check_tool_version en vez de 6 bloques if/else repetitivos
    [ -f "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" 2>/dev/null

    echo "Node.js: $(_check_tool_version node --version)"
    echo "npm: $(_check_tool_version npm --version)"
    echo "Java: $(_check_tool_version java -version)"
    echo "javac: $(_check_tool_version javac -version)"
    echo "PM2: $(_check_tool_version pm2 --version)"
    echo "PostgreSQL client: $(_check_tool_version psql --version)"
}

# =======================================================================================
# [v24] MAPEO INTELIGENTE DE MODULOS - FIXED
# =======================================================================================

detectar_endpoints_usados() {
    local js_file="$1"
    [ ! -f "$js_file" ] && { echo ""; return 0; }
    local resultado=""
    resultado=$(grep -oE "/api/[a-zA-Z0-9_/-]+" "$js_file" 2>/dev/null | sed 's|/api/||; s|/[0-9]*$||; s|/$||' || true)
    local resultado2=""
    resultado2=$(grep -oE "(/|')[a-z][-a-z]*(/[a-z][-a-z]*)?" "$js_file" 2>/dev/null \
        | grep -E "^(/|')[a-z]" | sed "s|^['/]||" \
        | grep -vE "^(js/|css/|api/|http|function|return|true|false|null|undefined|window|document)" || true)
    if [ -n "$resultado" ]; then
        echo "$resultado" | sort -u | head -8 | tr '\n' ',' | sed 's/,$//'
    else
        echo ""
    fi
    return 0
}

detectar_tablas_relacionadas() {
    local modulo="$1"
    local tablas_encontradas=""
    
    case "$modulo" in
        tesoreria)
            tablas_encontradas="turnos_caja,movimientos_caja,recibos,recibo_items,cotizaciones,cajas"
            ;;
        venta-rapida|venta_rapida|pos)
            tablas_encontradas="pedidos,pedidoitems,pedidoestados,clientes,productos,inventario,configuraciones_empresa"
            ;;
        configuraciones)
            tablas_encontradas="configuracion_sistema,configuraciones_empresa,configuracion_empresa_extendida,usuario_configuracion,empresas"
            ;;
        gestion-despachos|despachos)
            tablas_encontradas="viajes,remitos,remitoitems,remito_items,pedidos,entregas_planificadas"
            ;;
        cobranzas|cobros)
            tablas_encontradas="recibos,recibo_items,recibopagos,turnos_caja,movimientos_caja,clientes,cuentacorrienteclientes,ajustes_forma_pago"
            ;;
        cuenta-corriente|cc)
            tablas_encontradas="cuentacorrienteclientes,clientes,facturas,recibos,pagos,ajustes_forma_pago,notas_credito_debito"
            ;;
        pagos-proveedores)
            tablas_encontradas="pagosaproveedores,pago_proveedor_items,proveedores,cuentacorrienteproveedores,cheques_terceros,cheques_propios"
            ;;
        compras-nueva|compras)
            tablas_encontradas="comprobantes_compra,comprobante_compra_items,proveedores,ordenes_compra,recepciones"
            ;;
        admin-usuarios|usuarios)
            tablas_encontradas="usuarios,permisos_usuario,usuarios_logs,empresas"
            ;;
        clientes)
            tablas_encontradas="clientes,cuentacorrienteclientes,facturas,recibos,pedidos"
            ;;
        productos)
            tablas_encontradas="productos,inventario,precios,listaprecioproductos,categorias,marcas"
            ;;
        proveedores)
            tablas_encontradas="proveedores,cuentacorrienteproveedores,comprobantes_compra,pagosaproveedores"
            ;;
        facturas)
            tablas_encontradas="facturas,facturaitems,factura_items,clientes,secuencia_facturas,comprobantes_afip"
            ;;
        pedidos)
            tablas_encontradas="pedidos,pedidoitems,pedidoestados,clientes,pagos,confirmaciones_pago"
            ;;
        inventario)
            tablas_encontradas="inventario,inventario_deposito,movimientos_stock,movimientos_stock_deposito,productos,depositos,ajustes_inventario,ajuste_inventario_items"
            ;;
        presupuestos)
            tablas_encontradas="presupuestos,presupuesto_items,secuencia_presupuestos,clientes"
            ;;
        notas)
            tablas_encontradas="notas_credito_debito,nota_items,facturas,clientes"
            ;;
        remitos)
            tablas_encontradas="remitos,remito_items,pedidos,clientes"
            ;;
        libro-iva)
            tablas_encontradas="facturas,notas_credito_debito,alicuotasiva"
            ;;
        conjuntos)
            tablas_encontradas="conjuntos,conjunto_items,productos"
            ;;
        historial-movimientos)
            tablas_encontradas="pedidos,pedidoitems,comprobantes_compra,comprobante_compra_items,clientes,proveedores,productos"
            ;;
        comprobantes-internos)
            tablas_encontradas="comprobantes_internos,comprobante_interno_items"
            ;;
        dashboard|reportes)
            tablas_encontradas="pedidos,facturas,productos,inventario,clientes"
            ;;
        marcas)
            tablas_encontradas="marcas,productos"
            ;;
        categorias)
            tablas_encontradas="categorias,productos"
            ;;
        caja)
            tablas_encontradas="turnos_caja,movimientos_caja,cajas"
            ;;
        admin-dispositivos)
            tablas_encontradas="dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios"
            ;;
        admin-listas-precios)
            tablas_encontradas="listasdeprecios,listaprecioproductos,productos"
            ;;
        variantes)
            tablas_encontradas="producto_variantes,productos"
            ;;
        # [v36] Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso)
            tablas_encontradas="modulos,rol_modulos,modulo_rutas_api,modulo_grupos,rutas_soporte,dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios,usuarios_logs"
            ;;
        auth|autenticacion)
            tablas_encontradas="usuarios,dispositivos_autorizados,intentos_dispositivo_nuevo,usuarios_logs"
            ;;
        modulos)
            tablas_encontradas="modulos,rol_modulos,modulo_rutas_api,modulo_grupos,rutas_soporte"
            ;;
        *)
            local base_name
            base_name=$(echo "$modulo" | tr '-' '_')
            if verificar_bd; then
                tablas_encontradas=$(_run_sql "
                    SELECT string_agg(table_name, ',')
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_type = 'BASE TABLE'
                    AND (table_name LIKE '%${base_name}%' OR table_name LIKE '%${base_name}s%')
                ")
            fi
            ;;
    esac
    
    echo "$tablas_encontradas"
}

detectar_controllers_relacionados() {
    local modulo="$1"
    local js_file="${2:-}"
    local controllers_encontrados=""
    
    case "$modulo" in
        tesoreria)
            controllers_encontrados="cajas-cobranzas.controller.js,recibos.controller.js,cotizaciones.controller.js"
            ;;
        venta-rapida|pos)
            controllers_encontrados="pedidos.controller.js,borrador.controller.js,pagos-confirmacion.controller.js"
            ;;
        configuraciones)
            controllers_encontrados="usuarios.controller.js,auth.controller.js"
            ;;
        admin-usuarios)
            controllers_encontrados="usuarios.controller.js,auth.controller.js"
            ;;
        cobranzas|cobros)
            controllers_encontrados="cajas-cobranzas.controller.js,recibos.controller.js,cobranzas.controller.js"
            ;;
        cuenta-corriente|cc)
            controllers_encontrados="clientes.controller.js,recibos.controller.js,facturas.controller.js"
            ;;
        gestion-despachos)
            controllers_encontrados="despachos.controller.js"
            ;;
        pagos-proveedores)
            controllers_encontrados="pagos-proveedores.controller.js"
            ;;
        historial-movimientos)
            controllers_encontrados="historial-movimientos.controller.js"
            ;;
        comprobantes-internos)
            controllers_encontrados="comprobantes-internos.controller.js"
            ;;
        dashboard|reportes)
            controllers_encontrados="reportes.controller.js"
            ;;
        caja)
            controllers_encontrados="cajas-cobranzas.controller.js"
            ;;
        admin-dispositivos)
            controllers_encontrados="usuarios.controller.js"
            ;;
        admin-listas-precios)
            controllers_encontrados="listas-precios.controller.js"
            ;;
        marcas)
            controllers_encontrados="marcas.controller.js"
            ;;
        categorias)
            controllers_encontrados="categorias.controller.js"
            ;;
        variantes)
            controllers_encontrados="variantes.controller.js"
            ;;
        libro-iva)
            controllers_encontrados="facturas.controller.js"
            ;;
        notas)
            controllers_encontrados="notas.controller.js"
            ;;
        remitos)
            controllers_encontrados="remitos.controller.js"
            ;;
        inventario)
            controllers_encontrados="inventario.controller.js,ajustes-inventario.controller.js"
            ;;
        presupuestos)
            controllers_encontrados="presupuestos.controller.js"
            ;;
        productos)
            controllers_encontrados="productos.controller.js"
            ;;
        # [v36] Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso|auth|autenticacion)
            controllers_encontrados="auth.controller.js,usuarios.controller.js"
            ;;
        modulos)
            controllers_encontrados="auth.controller.js"
            ;;
    esac
    
    if [ -n "$controllers_encontrados" ]; then
        local result=""
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers_encontrados"
        for ctrl_name in "${CTRL_ARRAY[@]}"; do
            local ctrl_path="$CONTROLLERS_DIR/$ctrl_name"
            if [ -f "$ctrl_path" ]; then
                [ -n "$result" ] && result+=","
                result+="$ctrl_path"
            fi
        done
        if [ -n "$result" ]; then
            echo "$result"
            return 0
        fi
    fi
    
    local ctrl_directo=""
    ctrl_directo=$(find "$CONTROLLERS_DIR" -name "*${modulo}*.controller.js" 2>/dev/null | head -1 || true)
    if [ -n "$ctrl_directo" ]; then
        echo "$ctrl_directo"
        return 0
    fi
    
    local modulo_sin_guion
    modulo_sin_guion=$(echo "$modulo" | tr '-' '_')
    ctrl_directo=$(find "$CONTROLLERS_DIR" -name "*${modulo_sin_guion}*.controller.js" 2>/dev/null | head -1 || true)
    if [ -n "$ctrl_directo" ]; then
        echo "$ctrl_directo"
        return 0
    fi
    
    echo ""
    return 0
}

detectar_routes_relacionadas() {
    local modulo="$1"
    local routes_encontradas=""
    
    case "$modulo" in
        tesoreria)
            routes_encontradas="cajas-cobranzas.routes.js,recibos.routes.js,cotizaciones.routes.js"
            ;;
        venta-rapida|pos)
            routes_encontradas="pedidos.routes.js,borrador.routes.js,pagos-confirmacion.routes.js"
            ;;
        configuraciones|admin-usuarios)
            routes_encontradas="usuarios.routes.js,auth.routes.js"
            ;;
        cobranzas|cobros)
            routes_encontradas="cajas-cobranzas.routes.js,recibos.routes.js,cobranzas.routes.js"
            ;;
        cuenta-corriente|cc)
            routes_encontradas="clientes.routes.js,recibos.routes.js,facturas.routes.js"
            ;;
        gestion-despachos)
            routes_encontradas="despachos.routes.js"
            ;;
        pagos-proveedores)
            routes_encontradas="pagos-proveedores.routes.js"
            ;;
        historial-movimientos)
            routes_encontradas="historial-movimientos.routes.js"
            ;;
        comprobantes-internos)
            routes_encontradas="comprobantes-internos.routes.js"
            ;;
        dashboard|reportes)
            routes_encontradas="reportes.routes.js"
            ;;
        caja)
            routes_encontradas="cajas-cobranzas.routes.js"
            ;;
        admin-dispositivos)
            routes_encontradas="usuarios.routes.js"
            ;;
        admin-listas-precios)
            routes_encontradas="listas-precios.routes.js"
            ;;
        marcas)
            routes_encontradas="marcas.routes.js"
            ;;
        categorias)
            routes_encontradas="categorias.routes.js"
            ;;
        variantes)
            routes_encontradas="variantes.routes.js"
            ;;
        libro-iva)
            routes_encontradas="facturas.routes.js"
            ;;
        notas)
            routes_encontradas="notas.routes.js"
            ;;
        remitos)
            routes_encontradas="remitos.routes.js"
            ;;
        inventario)
            routes_encontradas="inventario.routes.js,ajustes-inventario.routes.js"
            ;;
        presupuestos)
            routes_encontradas="presupuestos.routes.js"
            ;;
        productos)
            routes_encontradas="productos.routes.js"
            ;;
        # [v36] Mapeos de seguridad y control de acceso
        seguridad|acceso|control-acceso|auth|autenticacion)
            routes_encontradas="auth.routes.js,usuarios.routes.js"
            ;;
        modulos)
            routes_encontradas="auth.routes.js"
            ;;
    esac
    
    if [ -n "$routes_encontradas" ]; then
        local result=""
        IFS=',' read -ra ROUTE_ARRAY <<< "$routes_encontradas"
        for route_name in "${ROUTE_ARRAY[@]}"; do
            local route_path="$ROUTES_DIR/$route_name"
            if [ -f "$route_path" ]; then
                [ -n "$result" ] && result+=","
                result+="$route_path"
            fi
        done
        if [ -n "$result" ]; then
            echo "$result"
            return 0
        fi
    fi
    
    local route_directo=""
    route_directo=$(find "$ROUTES_DIR" -name "*${modulo}*.routes.js" 2>/dev/null | head -1 || true)
    echo "$route_directo"
    return 0
}


# =======================================================================================
# [v27] SELECTOR INTELIGENTE DE TABLAS
# =======================================================================================

menu_seleccionar_tabla() {
    TABLA_SELECCIONADA=""

    local TABLAS_CRITICAS=(
        "movimientos_caja"
        "turnos_caja"
        "pedidos"
        "pedidoitems"
        "recibos"
        "recibo_items"
        "facturas"
        "factura_items"
        "pagos"
        "cuentacorrienteclientes"
        "cuentacorrienteproveedores"
        "inventario"
        "movimientos_stock"
        "confirmaciones_pago"
        "comprobantes_compra"
        "usuarios"
        "clientes"
        "proveedores"
        "productos"
        "cotizaciones"
        "modulos"
        "rol_modulos"
        "modulo_rutas_api"
    )

    echo ""
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  TABLAS CRITICAS (las mas usadas/conflictivas)${NC}"
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo ""

    local i=1
    for tabla in "${TABLAS_CRITICAS[@]}"; do
        local existe=""
        local count=""
        if verificar_bd; then
            existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla' AND table_schema='public'" 2>/dev/null || true)
            if [ "$existe" = "1" ]; then
                count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                    "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
                local writers=""
                writers=$(grep -rl "INSERT INTO ${tabla}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | wc -l || echo "0")
                local tag=""
                [ "$writers" -gt 2 ] && tag=" ${RED}[${writers} writers!]${NC}"
                printf "  ${GREEN}%2d${NC}. %-30s ${CYAN}(%s reg)${NC}%b\n" "$i" "$tabla" "$count" "$tag"
            else
                printf "  ${RED}%2d${NC}. %-30s ${RED}(no existe)${NC}\n" "$i" "$tabla"
            fi
        else
            printf "  ${GREEN}%2d${NC}. %s\n" "$i" "$tabla"
        fi
        i=$((i + 1))
    done

    echo ""
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo -e "  ${CYAN} B${NC}. Buscar tabla por texto parcial"
    echo -e "  ${CYAN} T${NC}. Ver TODAS las tablas de la BD"
    echo -e "  ${CYAN} M${NC}. Escribir nombre manualmente"
    echo -e "  ${CYAN} 0${NC}. Volver al menu"
    echo -e "${YELLOW}  ═══════════════════════════════════════════${NC}"
    echo ""
    read -p "  Opcion: " sel_opcion

    case "$sel_opcion" in
        [0])
            return 1
            ;;
        [bB])
            echo ""
            read -p "  Texto a buscar (ej: caja, pago, stock): " texto_busca
            if [ -z "$texto_busca" ]; then
                echo -e "${RED}  Sin texto de busqueda${NC}"
                return 1
            fi
            echo ""
            echo -e "  ${YELLOW}Tablas que coinciden con '$texto_busca':${NC}"
            echo ""

            local resultados=()
            local j=1
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                local cnt=""
                cnt=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                    "SELECT COUNT(*) FROM $tbl" 2>/dev/null || echo "?")
                printf "  ${GREEN}%2d${NC}. %-35s ${CYAN}(%s reg)${NC}\n" "$j" "$tbl" "$cnt"
                resultados+=("$tbl")
                j=$((j + 1))
            done < <(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                AND table_name LIKE '%${texto_busca}%'
                ORDER BY table_name;
            " 2>/dev/null || true)

            if [ ${#resultados[@]} -eq 0 ]; then
                echo -e "  ${RED}Sin resultados para '$texto_busca'${NC}"
                return 1
            fi

            echo ""
            read -p "  Numero de tabla: " sel_num
            if [[ "$sel_num" =~ ^[0-9]+$ ]] && [ "$sel_num" -ge 1 ] && [ "$sel_num" -le ${#resultados[@]} ]; then
                TABLA_SELECCIONADA="${resultados[$((sel_num - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
        [tT])
            echo ""
            echo -e "  ${YELLOW}Todas las tablas de la BD:${NC}"
            echo ""

            local todas=()
            local k=1
            while IFS= read -r tbl; do
                [ -z "$tbl" ] && continue
                printf "  ${GREEN}%3d${NC}. %s\n" "$k" "$tbl"
                todas+=("$tbl")
                k=$((k + 1))
                if (( (k - 1) % 20 == 0 )); then
                    echo ""
                    read -p "  [Enter para mas, o numero para elegir]: " pag_input
                    if [[ "$pag_input" =~ ^[0-9]+$ ]] && [ "$pag_input" -ge 1 ] && [ "$pag_input" -le ${#todas[@]} ]; then
                        TABLA_SELECCIONADA="${todas[$((pag_input - 1))]}"
                        return 0
                    fi
                fi
            done < <(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_type = 'BASE TABLE'
                ORDER BY table_name;
            " 2>/dev/null || true)

            echo ""
            read -p "  Numero de tabla: " sel_num
            if [[ "$sel_num" =~ ^[0-9]+$ ]] && [ "$sel_num" -ge 1 ] && [ "$sel_num" -le ${#todas[@]} ]; then
                TABLA_SELECCIONADA="${todas[$((sel_num - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
        [mM])
            echo ""
            read -p "  Nombre exacto de la tabla: " nombre_manual
            if [ -z "$nombre_manual" ]; then
                return 1
            fi
            TABLA_SELECCIONADA="$nombre_manual"
            ;;
        *)
            if [[ "$sel_opcion" =~ ^[0-9]+$ ]] && [ "$sel_opcion" -ge 1 ] && [ "$sel_opcion" -le ${#TABLAS_CRITICAS[@]} ]; then
                TABLA_SELECCIONADA="${TABLAS_CRITICAS[$((sel_opcion - 1))]}"
            else
                echo -e "${RED}  Opcion invalida${NC}"
                return 1
            fi
            ;;
    esac

    if [ -n "$TABLA_SELECCIONADA" ]; then
        echo ""
        echo -e "  ${GREEN}Tabla seleccionada: ${BOLD}$TABLA_SELECCIONADA${NC}"
        return 0
    fi
    return 1
}

# =======================================================================================
# [v26] RASTREO DE USO DE TABLAS
# =======================================================================================

rastrear_uso_tabla() {
    local tabla="$1"

    if [ -z "$tabla" ]; then
        echo -e "${RED}[ERROR] Especifica una tabla. Ej: ./toolkit_v58.sh rastrear movimientos_caja${NC}"
        return 1
    fi

    explorar_proyecto

    local TRACE_FILE="$OUTPUT_DIR/RASTREO_${tabla}_$(date +%Y%m%d_%H%M).md"

    header
    echo "Rastreando uso de tabla: $tabla"
    echo ""

    cat > "$TRACE_FILE" << EOF
# RASTREO DE TABLA: $tabla
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

EOF

    echo "## 1. INSERT INTO $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local inserts_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        inserts_found=$((inserts_found + 1))
    done < <(grep -rn "INSERT INTO ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $inserts_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 2. UPDATE $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local updates_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        updates_found=$((updates_found + 1))
    done < <(grep -rn "UPDATE ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $updates_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 3. DELETE FROM $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local deletes_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        deletes_found=$((deletes_found + 1))
    done < <(grep -rn "DELETE FROM ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null || true)
    [ $deletes_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 4. SELECT FROM $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local selects_found=0
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        echo "$line" >> "$TRACE_FILE"
        selects_found=$((selects_found + 1))
    done < <(grep -rn "FROM ${tabla}" "$PROJECT_ROOT/src" --include="*.js" 2>/dev/null | grep -iv "INSERT\|UPDATE\|DELETE" || true)
    [ $selects_found -eq 0 ] && echo "(ninguno encontrado)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 5. CONTROLLERS QUE TOCAN $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local archivos_unicos=""
    archivos_unicos=$(grep -rl "${tabla}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sort -u || true)
    if [ -n "$archivos_unicos" ]; then
        while IFS= read -r archivo; do
            local nombre_ctrl
            nombre_ctrl=$(basename "$archivo")
            local ops=""
            grep -q "INSERT INTO ${tabla}" "$archivo" 2>/dev/null && ops+="INSERT "
            grep -q "UPDATE ${tabla}" "$archivo" 2>/dev/null && ops+="UPDATE "
            grep -q "DELETE FROM ${tabla}" "$archivo" 2>/dev/null && ops+="DELETE "
            grep -qi "FROM ${tabla}" "$archivo" 2>/dev/null && ops+="SELECT "
            echo "$nombre_ctrl: $ops" >> "$TRACE_FILE"
        done <<< "$archivos_unicos"
    else
        echo "(ningun controller referencia esta tabla)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 6. HELPERS/UTILS QUE TOCAN $tabla" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local helpers_encontrados=""
    for dir_helper in "$PROJECT_ROOT/src/helpers" "$PROJECT_ROOT/src/utils" "$PROJECT_ROOT/src/services"; do
        if [ -d "$dir_helper" ]; then
            local found_helpers=""
            found_helpers=$(grep -rl "${tabla}" "$dir_helper" --include="*.js" 2>/dev/null || true)
            if [ -n "$found_helpers" ]; then
                while IFS= read -r h; do
                    echo "$(basename "$h")" >> "$TRACE_FILE"
                    helpers_encontrados="si"
                done <<< "$found_helpers"
            fi
        fi
    done
    [ -z "$helpers_encontrados" ] && echo "(ningun helper referencia esta tabla)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 7. FRONTEND JS QUE REFERENCIA $tabla (indirecto via endpoints)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if [ -n "$JS_DIR" ] && [ -d "$JS_DIR" ]; then
        if [ -n "$archivos_unicos" ]; then
            while IFS= read -r ctrl_file; do
                local ctrl_base
                ctrl_base=$(basename "$ctrl_file" .controller.js)
                local frontend_refs=""
                frontend_refs=$(grep -rl "/api/${ctrl_base}" "$JS_DIR" --include="*.js" 2>/dev/null || true)
                if [ -n "$frontend_refs" ]; then
                    while IFS= read -r fe_file; do
                        echo "$(basename "$fe_file") -> /api/${ctrl_base} -> $(basename "$ctrl_file")" >> "$TRACE_FILE"
                    done <<< "$frontend_refs"
                fi
            done <<< "$archivos_unicos"
        fi
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 8. VALIDACION id_empresa EN OPERACIONES" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if [ -n "$archivos_unicos" ]; then
        while IFS= read -r archivo; do
            local nombre_ctrl
            nombre_ctrl=$(basename "$archivo")
            local total_ops con_empresa
            total_ops=$(grep -c "INSERT INTO ${tabla}\|UPDATE ${tabla}\|DELETE FROM ${tabla}" "$archivo" 2>/dev/null || true)
            total_ops=${total_ops:-0}
            con_empresa=$(grep "INSERT INTO ${tabla}\|UPDATE ${tabla}\|DELETE FROM ${tabla}" "$archivo" 2>/dev/null | grep -c "id_empresa" || true)
            con_empresa=${con_empresa:-0}
            if [ "$total_ops" -gt 0 ]; then
                if [ "$con_empresa" -eq "$total_ops" ]; then
                    echo "[OK] $nombre_ctrl: $con_empresa/$total_ops con id_empresa" >> "$TRACE_FILE"
                else
                    echo "[WARN] $nombre_ctrl: $con_empresa/$total_ops con id_empresa" >> "$TRACE_FILE"
                fi
            fi
        done <<< "$archivos_unicos"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 9. COLUMNAS GENERATED ALWAYS (si existen)" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    if verificar_bd; then
        local gen_cols=""
        gen_cols=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT column_name || ' (' || data_type || ') - GENERATED ' || generation_expression
            FROM information_schema.columns
            WHERE table_name = '${tabla}'
            AND is_generated = 'ALWAYS'
            ORDER BY ordinal_position;
        " 2>/dev/null || true)
        if [ -n "$gen_cols" ]; then
            echo "$gen_cols" >> "$TRACE_FILE"
            echo "" >> "$TRACE_FILE"
            echo "ATENCION: Estas columnas NO se pueden escribir via INSERT/UPDATE." >> "$TRACE_FILE"
            echo "Intentar escribirlas genera: 'cannot insert a non-DEFAULT value into column'" >> "$TRACE_FILE"
        else
            echo "(ninguna columna GENERATED detectada)" >> "$TRACE_FILE"
        fi
    else
        echo "(no se pudo conectar a BD)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "## 10. ESTADO DE MIGRACION A HELPER" >> "$TRACE_FILE"
    echo '```' >> "$TRACE_FILE"
    local helper_centralizado=""
    [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ] && helper_centralizado=$(grep -rl "INSERT INTO ${tabla}\|UPDATE ${tabla}\|FROM ${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
    if [ -z "$helper_centralizado" ] && [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        helper_centralizado=$(grep -rwl "${tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
    fi
    if [ -n "$helper_centralizado" ]; then
        echo "Helper: $(basename "$helper_centralizado")" >> "$TRACE_FILE"
        local ctrl_directos=0
        ctrl_directos=$(grep -rl "INSERT INTO ${tabla}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
        echo "Controllers con INSERT directo: $ctrl_directos" >> "$TRACE_FILE"
        if [ "$ctrl_directos" -eq 0 ]; then echo "Estado: MIGRADO - todos pasan por helper" >> "$TRACE_FILE"
        else
            echo "Estado: PARCIAL - $ctrl_directos controllers insertan directo:" >> "$TRACE_FILE"
            grep -rl "INSERT INTO ${tabla}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | while IFS= read -r f; do echo "  - $(basename "$f")" >> "$TRACE_FILE"; done
        fi
    else
        [ "$inserts_found" -gt 2 ] && echo "Estado: SIN HELPER - $inserts_found INSERTs dispersos, candidato a centralizar" >> "$TRACE_FILE" || echo "Estado: Sin helper (pocos puntos de escritura)" >> "$TRACE_FILE"
    fi
    echo '```' >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"

    echo "---" >> "$TRACE_FILE"
    echo "## RESUMEN" >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"
    echo "| Operacion | Ocurrencias |" >> "$TRACE_FILE"
    echo "|-----------|-------------|" >> "$TRACE_FILE"
    echo "| INSERT    | $inserts_found |" >> "$TRACE_FILE"
    echo "| UPDATE    | $updates_found |" >> "$TRACE_FILE"
    echo "| DELETE    | $deletes_found |" >> "$TRACE_FILE"
    echo "| SELECT    | $selects_found |" >> "$TRACE_FILE"
    echo "" >> "$TRACE_FILE"
    local total_ops=$((inserts_found + updates_found + deletes_found))
    if [ $total_ops -gt 3 ]; then
        echo "**ALERTA:** $total_ops puntos de escritura detectados. Considerar helper centralizado." >> "$TRACE_FILE"
    fi
    echo "" >> "$TRACE_FILE"

    echo -e "${GREEN}[OK] Rastreo generado: $TRACE_FILE${NC}"
    echo ""
    echo -e "  INSERTs: $inserts_found | UPDATEs: $updates_found | DELETEs: $deletes_found | SELECTs: $selects_found"
}

# =======================================================================================
# [v26] DETECTAR COLUMNAS GENERATED ALWAYS EN BD
# =======================================================================================

detectar_columnas_generated() {
    if ! verificar_bd; then
        echo "(no se pudo conectar a BD)"
        return 1
    fi

    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
        SELECT table_name, column_name, data_type, generation_expression
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND is_generated = 'ALWAYS'
        ORDER BY table_name, ordinal_position;
    " 2>/dev/null || echo "(error consultando columnas GENERATED)"
}

# =======================================================================================
# [v29] EXTRAER EXPORTS DE CONTROLLER
# =======================================================================================

extraer_exports() {
    local archivo="$1"
    [ ! -f "$archivo" ] && return 0

    local p1=""
    p1=$(grep -E "^exports\." "$archivo" 2>/dev/null | sed 's/exports\.//g; s/ =.*//g' || true)
    if [ -n "$p1" ]; then
        echo "$p1" | sed 's/^/  - /'
        return 0
    fi

    local p2=""
    p2=$(sed -n '/module\.exports\s*=\s*{/,/}/p' "$archivo" 2>/dev/null \
        | sed 's|//.*||; s|/\*.*\*/||' \
        | grep -oE '[a-zA-Z_][a-zA-Z0-9_]*' \
        | grep -vE '^(module|exports|require|const|let|var|async|function|return|true|false|null|undefined)$' \
        | awk 'length >= 4' \
        || true)
    if [ -n "$p2" ]; then
        echo "$p2" | sed 's/^/  - /'
        return 0
    fi

    echo "  (sin exports detectados)"
}


# =======================================================================================
# [v24] AUDITAR MODULO MEJORADO - FIXED
# =======================================================================================

auditar_modulo() {
    local modulo="$1"
    
    if [ -z "$modulo" ]; then
        echo -e "${RED}[ERROR] Especifica un nombre de modulo${NC}"
        echo "Ejemplo: ./toolkit_v56.sh auditar clientes"
        return 1
    fi
    
    local AUDIT_FILE="$OUTPUT_DIR/AUDITORIA_${modulo}_$(date +%Y%m%d_%H%M).md"
    
    header
    echo "Auditando modulo: $modulo (con mapeo inteligente)"
    echo ""
    
    explorar_proyecto
    
    local total_componentes=5
    local encontrados=0
    local errores=0
    
    cat > "$AUDIT_FILE" << EOF
# AUDITORIA MODULO: $modulo
## Fecha: $(date '+%Y-%m-%d %H:%M')
## Version Toolkit: v${VERSION}

---

EOF

    # === FRONTEND ===
    echo "## 1. ARCHIVOS DEL FRONTEND" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    local html_file=""
    html_file=$(find "$FRONTEND_DIR" -maxdepth 1 -name "*${modulo}*.html" 2>/dev/null | head -1 || true)
    if [ -n "$html_file" ] && [ -f "$html_file" ]; then
        echo "OK HTML: $html_file" >> "$AUDIT_FILE"
        encontrados=$((encontrados + 1))
    else
        echo "FALTA HTML: No encontrado (*${modulo}*.html)" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    
    local js_file=""
    for pattern in "${modulo}.js" "${modulo}-script.js"; do
        local found=""
        found=$(find "$JS_DIR" -name "$pattern" 2>/dev/null | head -1 || true)
        if [ -n "$found" ]; then
            js_file="$found"
            break
        fi
    done
    
    if [ -n "$js_file" ] && [ -f "$js_file" ]; then
        local lineas=""
        lineas=$(wc -l < "$js_file" 2>/dev/null || echo "?")
        echo "OK JS Frontend: $js_file ($lineas lineas)" >> "$AUDIT_FILE"
        encontrados=$((encontrados + 1))
        
        local endpoints=""
        endpoints=$(detectar_endpoints_usados "$js_file")
        if [ -n "$endpoints" ]; then
            echo "   Endpoints usados: $endpoints" >> "$AUDIT_FILE"
        fi
    else
        if [ -n "$html_file" ] && [ -f "$html_file" ]; then
            local from_html=""
            from_html=$(grep -oE 'src="js/[^"]+\.js"' "$html_file" 2>/dev/null \
                | sed 's/src="js\///; s/"//' \
                | grep -vE "^(config|config-panel|common|utils|CONFIG|modal|connection-indicator|auth)\." \
                | tail -1 || true)
            if [ -n "$from_html" ] && [ -f "$JS_DIR/$from_html" ]; then
                js_file="$JS_DIR/$from_html"
                local lineas=""
                lineas=$(wc -l < "$js_file" 2>/dev/null || echo "?")
                echo "OK JS Frontend: $js_file ($lineas lineas) [detectado desde HTML]" >> "$AUDIT_FILE"
                encontrados=$((encontrados + 1))
                local endpoints=""
                endpoints=$(detectar_endpoints_usados "$js_file")
                if [ -n "$endpoints" ]; then
                    echo "   Endpoints usados: $endpoints" >> "$AUDIT_FILE"
                fi
            else
                echo "FALTA JS Frontend: No encontrado (ni por nombre ni en HTML)" >> "$AUDIT_FILE"
                errores=$((errores + 1))
            fi
        else
            echo "FALTA JS Frontend: No encontrado" >> "$AUDIT_FILE"
            errores=$((errores + 1))
        fi
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === BACKEND ===
    echo "## 2. ARCHIVOS DEL BACKEND" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    local controllers=""
    controllers=$(detectar_controllers_relacionados "$modulo" "$js_file")
    if [ -n "$controllers" ]; then
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            if [ -f "$ctrl" ]; then
                echo "OK Controller: $ctrl" >> "$AUDIT_FILE"
            fi
        done
        encontrados=$((encontrados + 1))
    else
        echo "FALTA Controller: No encontrado" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    
    local routes=""
    routes=$(detectar_routes_relacionadas "$modulo")
    if [ -n "$routes" ]; then
        IFS=',' read -ra ROUTE_ARRAY <<< "$routes"
        for route in "${ROUTE_ARRAY[@]}"; do
            if [ -f "$route" ]; then
                echo "OK Routes: $route" >> "$AUDIT_FILE"
            fi
        done
        encontrados=$((encontrados + 1))
    else
        echo "FALTA Routes: No encontrado" >> "$AUDIT_FILE"
        errores=$((errores + 1))
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === TABLAS BD ===
    echo "## 3. TABLAS EN BASE DE DATOS" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    
    if verificar_bd; then
        local tablas=""
        tablas=$(detectar_tablas_relacionadas "$modulo")
        local tabla_encontrada=0
        
        if [ -n "$tablas" ]; then
            IFS=',' read -ra TABLA_ARRAY <<< "$tablas"
            for tabla in "${TABLA_ARRAY[@]}"; do
                [ -z "$tabla" ] && continue
                if _table_exists "$tabla"; then
                    local count=""
                    count=$(_table_count "$tabla")
                    local tiene_empresa=""
                    tiene_empresa=$(_run_sql "SELECT 1 FROM information_schema.columns WHERE table_name='$tabla' AND column_name='id_empresa'")
                    local scope="COMPARTIDA"
                    [ "$tiene_empresa" = "1" ] && scope="POR EMPRESA"
                    echo "OK $tabla ($count registros) [$scope]" >> "$AUDIT_FILE"
                    tabla_encontrada=1
                fi
            done
        fi
        
        if [ $tabla_encontrada -eq 1 ]; then
            encontrados=$((encontrados + 1))
        else
            echo "FALTA tablas relacionadas" >> "$AUDIT_FILE"
            errores=$((errores + 1))
        fi
    else
        echo "WARN: No se pudo conectar a la BD" >> "$AUDIT_FILE"
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === FUNCIONES EXPORTADAS ===
    if [ -n "$controllers" ]; then
        echo "## 4. FUNCIONES EXPORTADAS" >> "$AUDIT_FILE"
        echo '```' >> "$AUDIT_FILE"
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            if [ -f "$ctrl" ]; then
                echo "// $(basename "$ctrl")" >> "$AUDIT_FILE"
                extraer_exports "$ctrl" >> "$AUDIT_FILE"
                echo "" >> "$AUDIT_FILE"
            fi
        done
        echo '```' >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
    fi

    # === HELPERS CENTRALIZADOS UTILIZADOS ===
    echo "## 5. HELPERS CENTRALIZADOS UTILIZADOS" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    local helpers_usados=0
    if [ -n "$controllers" ] && [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        IFS=',' read -ra CTRL_ARRAY <<< "$controllers"
        for ctrl in "${CTRL_ARRAY[@]}"; do
            [ ! -f "$ctrl" ] && continue
            local requires=""
            requires=$(grep -oE "require\(['\"].*helper['\"]" "$ctrl" 2>/dev/null | sed "s/require(['\"]//;s/['\"]$//" || true)
            if [ -n "$requires" ]; then
                while IFS= read -r req; do
                    echo "$(basename "$ctrl") -> $(basename "$req" 2>/dev/null)" >> "$AUDIT_FILE"
                    helpers_usados=$((helpers_usados + 1))
                done <<< "$requires"
            fi
        done
    fi
    [ "$helpers_usados" -eq 0 ] && echo "(ningun controller de este modulo importa helpers)" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === [v36] VERIFICACION DE AUTH EN HTML ===
    echo "## 6. VERIFICACION AUTH" >> "$AUDIT_FILE"
    echo '```' >> "$AUDIT_FILE"
    if [ -n "$html_file" ] && [ -f "$html_file" ]; then
        local carga_auth=""
        carga_auth=$(grep -c "auth\.js" "$html_file" 2>/dev/null) || carga_auth=0
        [ "$carga_auth" -gt 0 ] && echo "[OK] HTML carga auth.js" >> "$AUDIT_FILE" || echo "[WARN] HTML NO carga auth.js" >> "$AUDIT_FILE"
    fi
    if [ -n "$js_file" ] && [ -f "$js_file" ]; then
        local tiene_token_check=""
        tiene_token_check=$(grep -c "localStorage.*token\|getItem.*token" "$js_file" 2>/dev/null) || tiene_token_check=0
        [ "$tiene_token_check" -gt 0 ] && echo "[INFO] JS tiene verificacion de token propia (redundante con server-side)" >> "$AUDIT_FILE" || echo "[OK] JS no verifica token (delega a server-side)" >> "$AUDIT_FILE"
        local tiene_doble_api=""
        tiene_doble_api=$(grep -c 'API_BASE.*\/api\/' "$js_file" 2>/dev/null) || tiene_doble_api=0
        [ "$tiene_doble_api" -gt 0 ] && echo "[BUG] JS tiene doble /api ($tiene_doble_api ocurrencias)" >> "$AUDIT_FILE" || echo "[OK] Sin doble /api" >> "$AUDIT_FILE"
    fi
    echo '```' >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"

    # === RESULTADO FINAL ===
    echo "---" >> "$AUDIT_FILE"
    echo "## RESULTADO DE AUDITORIA" >> "$AUDIT_FILE"
    echo "" >> "$AUDIT_FILE"
    
    local porcentaje=$((encontrados * 100 / total_componentes))
    
    if [ $errores -eq 0 ]; then
        echo "### COMPLETA ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "Todos los componentes del modulo fueron encontrados." >> "$AUDIT_FILE"
        echo -e "${GREEN}[OK] Auditoria COMPLETA${NC}"
    elif [ $encontrados -ge 3 ]; then
        echo "### PARCIAL ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "| Metrica | Valor |" >> "$AUDIT_FILE"
        echo "|---------|-------|" >> "$AUDIT_FILE"
        echo "| Componentes encontrados | $encontrados / $total_componentes |" >> "$AUDIT_FILE"
        echo "| Componentes faltantes | $errores |" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "**Nota:** Este modulo puede usar nombres diferentes en backend." >> "$AUDIT_FILE"
        echo -e "${YELLOW}[OK] Auditoria PARCIAL ($encontrados/$total_componentes)${NC}"
    else
        echo "### INCOMPLETA ($porcentaje%)" >> "$AUDIT_FILE"
        echo "" >> "$AUDIT_FILE"
        echo "El modulo parece estar incompleto o usa arquitectura no estandar." >> "$AUDIT_FILE"
        echo -e "${RED}[WARN] Auditoria INCOMPLETA ($encontrados/$total_componentes)${NC}"
    fi
    
    echo ""
    echo -e "Archivo generado: ${CYAN}$AUDIT_FILE${NC}"
}


# =======================================================================================
# [v24] DOCUMENTAR ARQUITECTURA DE NEGOCIO
# =======================================================================================

documentar_arquitectura_negocio() {
    local ARCH_FILE="$OUTPUT_DIR/ARQUITECTURA_NEGOCIO.md"
    
    header
    echo "Generando documentacion de Arquitectura de Negocio..."
    echo ""
    
    cat > "$ARCH_FILE" << EOF
# ARQUITECTURA DE NEGOCIO - ERP LAGO
## Generado automaticamente por Toolkit v${VERSION}

---

## 1. MODELO MULTI-EMPRESA

EOF
    
    echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    if verificar_bd; then
        local num_empresas=""
        num_empresas=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(*) FROM empresas" 2>/dev/null || echo "0")
        echo "**Empresas registradas:** $num_empresas" >> "$ARCH_FILE"
        echo "" >> "$ARCH_FILE"
    fi

    echo "### Tablas COMPARTIDAS (sin id_empresa - catalogo global)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT t.table_name 
        FROM information_schema.tables t
        WHERE t.table_schema = 'public' 
        AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns c 
            WHERE c.table_name = t.table_name 
            AND c.column_name = 'id_empresa'
        )
        ORDER BY t.table_name;
    " 2>/dev/null >> "$ARCH_FILE" || echo "(error consultando BD)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "### Tablas POR EMPRESA (aisladas por id_empresa)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
        SELECT DISTINCT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'id_empresa' 
        AND table_schema = 'public'
        ORDER BY table_name;
    " 2>/dev/null >> "$ARCH_FILE" || echo "(error consultando BD)" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 2. JERARQUIA: Empresa -> Sucursal -> Deposito" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    echo "-- EMPRESAS" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 'Empresas: ' || COUNT(*) FROM empresas" 2>/dev/null >> "$ARCH_FILE" || true
    
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 1 FROM information_schema.tables WHERE table_name='sucursales'" 2>/dev/null | grep -q 1; then
        echo "" >> "$ARCH_FILE"
        echo "-- SUCURSALES (estructura)" >> "$ARCH_FILE"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='sucursales' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    fi
    
    echo "" >> "$ARCH_FILE"
    echo "-- DEPOSITOS (estructura)" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='depositos' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 3. SEGURIDAD (WireGuard + Fingerprinting + Control Acceso)" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo "### Tablas de control de acceso:" >> "$ARCH_FILE"
    echo '```' >> "$ARCH_FILE"
    for tabla in dispositivos_autorizados intentos_dispositivo_nuevo usuarios_logs modulos rol_modulos modulo_rutas_api modulo_grupos rutas_soporte; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        if [ "$existe" = "1" ]; then
            local count=""
            count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
            echo "OK $tabla ($count registros)" >> "$ARCH_FILE"
        fi
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Flujo de autorizacion:
1. Usuario intenta acceder desde nuevo dispositivo
2. Sistema registra en `intentos_dispositivo_nuevo`
3. Admin aprueba/rechaza desde panel
4. Si aprobado -> se agrega a `dispositivos_autorizados`
5. VPN WireGuard solo permite IPs autorizadas

### Control de acceso a modulos (v36):
1. Browser pide `*.html` → `html-access.middleware.js` intercepta
2. Lee cookie `erp_token` (httpOnly, JWT) → valida token
3. Sin cookie → redirect `/login.html`
4. Token valido → consulta `rol_modulos` (cache 5min)
5. Admin → acceso total (anti-lockout)
6. Otro rol → verifica si tiene acceso al modulo
7. Paginas publicas: `login.html`, `ver-pedido-publico.html`, `index.html`
8. Menu dinamico: `auth.js v3.0` auto-inyecta offcanvas con modulos del rol

---

## 4. SISTEMA DE IMPRESION (Productor-Consumidor)

EOF

    echo '```' >> "$ARCH_FILE"
    for tabla in print_jobs printers_config log_impresiones; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        [ "$existe" = "1" ] && echo "OK $tabla" >> "$ARCH_FILE"
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Flujo de impresion:
1. Frontend/Backend crea registro en `print_jobs` (payload JSONB)
2. PostgreSQL NOTIFY envia senal
3. Worker Node.js con LISTEN recibe
4. Puppeteer genera PDF desde plantilla Handlebars
5. Envia a CUPS/PDF/WhatsApp segun configuracion

### Plantillas disponibles:
EOF

    echo '```' >> "$ARCH_FILE"
    if [ -d "$PROJECT_ROOT/config/plantillas" ]; then
        ls -1 "$PROJECT_ROOT/config/plantillas/" 2>/dev/null >> "$ARCH_FILE" || echo "(vacio)"
    elif [ -d "$PROJECT_ROOT/templates/comprobantes" ]; then
        ls -1 "$PROJECT_ROOT/templates/comprobantes/" 2>/dev/null >> "$ARCH_FILE" || echo "(vacio)"
    else
        echo "(directorio de plantillas no encontrado)" >> "$ARCH_FILE"
    fi
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 5. MULTIMONEDA Y COTIZACIONES" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    echo "-- MONEDAS DISPONIBLES" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT * FROM monedas ORDER BY id_moneda" 2>/dev/null >> "$ARCH_FILE" || true
    echo "" >> "$ARCH_FILE"
    echo "-- ULTIMA COTIZACION USD" >> "$ARCH_FILE"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
        "SELECT * FROM cotizaciones WHERE id_moneda = 2 ORDER BY fecha_cotizacion DESC LIMIT 1" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    echo "---" >> "$ARCH_FILE"
    echo "## 6. NOTAS DE CREDITO Y DEBITO" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    local existe_notas=""
    existe_notas=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT 1 FROM information_schema.tables WHERE table_name='notas_credito_debito'" 2>/dev/null || true)
    if [ "$existe_notas" = "1" ]; then
        echo "-- Tabla UNICA para NC y ND (diferenciadas por campo 'tipo')" >> "$ARCH_FILE"
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='notas_credito_debito' ORDER BY ordinal_position" 2>/dev/null >> "$ARCH_FILE" || true
    fi
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
---

## 7. IMAGENES DE PRODUCTOS

- **Almacenamiento:** Servidor externo de imagenes (hosting estatico)
- **Campo en BD:** `productos.url_imagen` (VARCHAR 255)
- **Formato:** URL completa/enlace directo
- **Procesamiento:** No se procesan localmente, solo se guarda el enlace

---

## 8. CONFIGURACIONES DEL SISTEMA

EOF

    echo '```' >> "$ARCH_FILE"
    for tabla in configuracion_sistema configuraciones_empresa configuracion_empresa_extendida usuario_configuracion; do
        local existe=""
        existe=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='$tabla'" 2>/dev/null || true)
        if [ "$existe" = "1" ]; then
            local count=""
            count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT COUNT(*) FROM $tabla" 2>/dev/null || echo "?")
            echo "OK $tabla ($count registros)" >> "$ARCH_FILE"
        fi
    done
    echo '```' >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"

    cat >> "$ARCH_FILE" << 'EOF'
### Jerarquia de configuraciones:
1. `configuracion_sistema` -> Parametros globales del ERP
2. `configuraciones_empresa` -> Config especifica por empresa
3. `configuracion_empresa_extendida` -> Extensiones por empresa
4. `usuario_configuracion` -> Preferencias individuales de usuario

EOF

    # §9 METODOS DE PAGO
    echo "---" >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo "## 9. METODOS DE PAGO" >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo '```sql' >> "$ARCH_FILE"
    local existe_mp=""
    existe_mp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='metodosdepago'" 2>/dev/null || true)
    [ "$existe_mp" = "1" ] && psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT * FROM metodosdepago ORDER BY id_metodo_pago" 2>/dev/null >> "$ARCH_FILE" || true
    echo '```' >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"
    echo "### Recargos/Descuentos por forma de pago:" >> "$ARCH_FILE"; echo '```sql' >> "$ARCH_FILE"
    local existe_rfp=""
    existe_rfp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM information_schema.tables WHERE table_name='recargos_forma_pago'" 2>/dev/null || true)
    if [ "$existe_rfp" = "1" ]; then
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT rfp.*, mp.nombre as metodo FROM recargos_forma_pago rfp LEFT JOIN metodosdepago mp ON rfp.id_metodo_pago=mp.id_metodo_pago WHERE rfp.activo=true ORDER BY rfp.id_metodo_pago" 2>/dev/null >> "$ARCH_FILE" || true
    else echo "(tabla recargos_forma_pago no existe)" >> "$ARCH_FILE"; fi
    echo '```' >> "$ARCH_FILE"; echo "" >> "$ARCH_FILE"

    # [v57.1] §10 HELPERS y §11 PROGRESO MIGRACION removidos de arquitectura.
    # Estaban duplicados en PROMPT_MAESTRO. La doc de arquitectura se queda con
    # los conceptos estructurales (multi-empresa, jerarquia, seguridad, impresion,
    # multimoneda, NC/ND, imagenes, configs, metodos de pago) — el inventario
    # operativo de helpers vive en PROMPT_MAESTRO.

    echo "---" >> "$ARCH_FILE"
    echo "" >> "$ARCH_FILE"
    echo "*Generado por ERP LAGO Toolkit v${VERSION}*" >> "$ARCH_FILE"

    echo -e "${GREEN}[OK] Arquitectura de negocio documentada: $ARCH_FILE${NC}"
}


# =======================================================================================
# MEMORIA HISTORICA
# =======================================================================================

inicializar_historia() {
    if [ ! -f "$HISTORY_FILE" ]; then
        cat > "$HISTORY_FILE" << 'EOF'
{
    "version": "24.1",
    "created": "",
    "snapshots": []
}
EOF
        local fecha
        fecha=$(date -Iseconds)
        sed -i "s/\"created\": \"\"/\"created\": \"$fecha\"/" "$HISTORY_FILE"
    fi
}

guardar_snapshot() {
    inicializar_historia
    
    local fecha tablas_count vistas_count html_count ctrl_count routes_count js_count git_commit
    fecha=$(date -Iseconds)
    tablas_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" 2>/dev/null || echo "0")
    vistas_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
        "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='public';" 2>/dev/null || echo "0")
    html_count=$(find "$PROJECT_ROOT/frontend" -maxdepth 1 -name "*.html" 2>/dev/null | wc -l)
    ctrl_count=$(find "$PROJECT_ROOT/src/controllers" -name "*.js" 2>/dev/null | wc -l)
    routes_count=$(find "$PROJECT_ROOT/src/routes" -name "*.js" 2>/dev/null | wc -l)
    js_count=$(find "$PROJECT_ROOT/frontend/js" -name "*.js" 2>/dev/null | wc -l)
    
    git_commit=""
    if verificar_git; then
        git_commit=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo "")
    fi

    local snapshot
    snapshot=$(cat << EOF
{
    "fecha": "$fecha",
    "git_commit": "$git_commit",
    "metricas": {
        "tablas_bd": $tablas_count,
        "vistas_bd": $vistas_count,
        "html_frontend": $html_count,
        "js_frontend": $js_count,
        "controllers": $ctrl_count,
        "routes": $routes_count
    },
    "errores_criticos": $ERRORES_CRITICOS,
    "advertencias": $ADVERTENCIAS,
    "sugerencias": $SUGERENCIAS
}
EOF
)

    if command -v jq &>/dev/null; then
        local temp_file
        temp_file=$(mktemp)
        jq ".snapshots += [$snapshot]" "$HISTORY_FILE" > "$temp_file" && mv "$temp_file" "$HISTORY_FILE"
    else
        echo "$snapshot" >> "${HISTORY_FILE%.json}_snapshots.log"
    fi
}

mostrar_tendencia() {
    if [ ! -f "$HISTORY_FILE" ]; then
        echo "(Sin historial previo)"
        return
    fi

    if command -v jq &>/dev/null; then
        local total_snapshots
        total_snapshots=$(jq '.snapshots | length' "$HISTORY_FILE" 2>/dev/null || echo "0")
        if [ "$total_snapshots" -gt 1 ]; then
            echo "Snapshots guardados: $total_snapshots"
            echo ""
            echo "Ultimos 5 snapshots:"
            jq -r '.snapshots | .[-5:] | .[] | "  \(.fecha) | Tablas: \(.metricas.tablas_bd) | Controllers: \(.metricas.controllers) | Errores: \(.errores_criticos)"' "$HISTORY_FILE" 2>/dev/null
        else
            echo "Solo 1 snapshot guardado."
        fi
    else
        echo "(Instala jq para ver tendencias)"
    fi
}

# =======================================================================================
# INFORME DE SALUD ARQUITECTONICA
# =======================================================================================

generar_informe_salud() {
    ARCHIVO="$OUTPUT_DIR/SALUD_ARQUITECTONICA.md"
    
    echo "Generando informe de salud..."
    > "$ARCHIVO"
    
    echo "# SALUD ARQUITECTONICA" >> "$ARCHIVO"
    echo "Fecha: $(date '+%Y-%m-%d %H:%M')" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    
    # [v57] §1 Archivos grandes removido (telemetria, no arquitectura). Disponible via CLI.
    
    # [v57] §2 Console.log removido (telemetria). §5 Logger ya cubre el dato relevante.
    
    # §3 Rutas auth
    echo "## 1. Autenticacion en rutas" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    for F in "$ROUTES_DIR"/*.routes.js; do
        [ -f "$F" ] || continue
        NOMBRE=$(basename "$F")
        USA_GLOBAL=$(grep -c "router\.use(verificarToken)" "$F" 2>/dev/null || true)
        USA_GLOBAL=${USA_GLOBAL:-0}
        if [ "$USA_GLOBAL" -gt 0 ]; then
            echo "- [OK] $NOMBRE (auth global)" >> "$ARCHIVO"
        else
            SIN_AUTH=$(grep -E "router\.(get|post|put|delete)" "$F" 2>/dev/null | grep -v "verificarToken" | wc -l)
            if [ "$SIN_AUTH" -gt 0 ]; then
                echo "- [WARN] $NOMBRE: $SIN_AUTH rutas sin token" >> "$ARCHIVO"
            else
                echo "- [OK] $NOMBRE (auth individual)" >> "$ARCHIVO"
            fi
        fi
    done
    echo "" >> "$ARCHIVO"
    
    # [v57] §4 Codigo muerto removido (lint, no arquitectura).

    # [v57] §5 Logger removido (estado binario, ya documentado en arquitectura).

    # §6 INSERTs/UPDATEs sin id_empresa (controllers + utils) — CONTEXT-AWARE (multi-linea)
    echo "## 2. Writes sin id_empresa (controllers + utils)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    local tablas_multi=""
    local SEARCH_DIRS="$CONTROLLERS_DIR"
    [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ] && SEARCH_DIRS="$CONTROLLERS_DIR $UTILS_DIR"
    tablas_multi=$(grep -roh "INSERT INTO [a-z_]*\|UPDATE [a-z_]* SET" $SEARCH_DIRS --include="*.js" 2>/dev/null \
        | sed 's/INSERT INTO //; s/UPDATE //; s/ SET//' | sort | uniq -c | sort -rn | awk '$1 >= 2 {print $2}' || true)
    if [ -n "$tablas_multi" ]; then
        while IFS= read -r TABLA; do
            [ -z "$TABLA" ] && continue
            local tiene_id_empresa=""
            tiene_id_empresa=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT 1 FROM information_schema.columns WHERE table_name='$TABLA' AND column_name='id_empresa'" 2>/dev/null || true)
            if [ "$tiene_id_empresa" = "1" ]; then
                local INSERTS=0 CON_ID=0
                local archivos_dist=""
                archivos_dist=$(grep -rl "INSERT INTO ${TABLA}[^_a-z]\|UPDATE ${TABLA} SET" $SEARCH_DIRS --include="*.js" 2>/dev/null | wc -l) || archivos_dist=0
                # Context-aware: por cada match, leer INSERT/UPDATE + 8 lineas para buscar id_empresa
                while IFS=: read -r _file _lineno _rest; do
                    [ -z "$_file" ] || [ -z "$_lineno" ] && continue
                    # Filtrar lineas de comentario (// *)
                    local _ctx=""
                    _ctx=$(sed -n "${_lineno}p" "$_file" 2>/dev/null || true)
                    echo "$_ctx" | grep -qE "^[[:space:]]*(//|\*)" && continue
                    INSERTS=$((INSERTS + 1))
                    # Leer bloque: linea del write + 8 siguientes
                    if sed -n "${_lineno},$((${_lineno}+8))p" "$_file" 2>/dev/null | grep -q "id_empresa"; then
                        CON_ID=$((CON_ID + 1))
                    fi
                done < <(grep -rn "INSERT INTO ${TABLA}[^_a-z]\|UPDATE ${TABLA} SET" $SEARCH_DIRS --include="*.js" 2>/dev/null || true)
                if [ "$INSERTS" -eq 0 ]; then continue; fi
                if [ "$CON_ID" -eq "$INSERTS" ]; then
                    echo "- [OK] $TABLA: $CON_ID/$INSERTS con id_empresa ($archivos_dist archivos)" >> "$ARCHIVO"
                else
                    echo "- [WARN] $TABLA: $CON_ID/$INSERTS con id_empresa ($archivos_dist archivos)" >> "$ARCHIVO"
                fi
            fi
        done <<< "$tablas_multi"
    fi
    echo "" >> "$ARCHIVO"

    # §7 Modelo usuario-empresa-deposito
    echo "## 3. Modelo Usuario-Empresa-Deposito" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    USERS_TOTAL=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios" 2>/dev/null || echo "0")
    USERS_EMP=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios WHERE id_empresa IS NOT NULL" 2>/dev/null || echo "0")
    USERS_DEP=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM usuarios WHERE id_deposito IS NOT NULL" 2>/dev/null || echo "0")
    echo "- Usuarios con id_empresa: $USERS_EMP/$USERS_TOTAL" >> "$ARCHIVO"
    echo "- Usuarios con id_deposito: $USERS_DEP/$USERS_TOTAL" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # §8 Columnas GENERATED
    # §16 Constraints vs Triggers (v44)
    echo "## 4. CHECK constraints vs triggers" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_constraints_triggers "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    echo "## 5. Columnas GENERATED ALWAYS (NO escribibles)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if verificar_bd; then
        local gen_count=""
        gen_count=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema='public' AND is_generated='ALWAYS';
        " 2>/dev/null || echo "0")
        echo "Total columnas GENERATED: $gen_count" >> "$ARCHIVO"
        if [ "$gen_count" -gt 0 ]; then
            psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "
                SELECT '- ' || table_name || '.' || column_name || ' (' || data_type || ')'
                FROM information_schema.columns
                WHERE table_schema='public' AND is_generated='ALWAYS'
                ORDER BY table_name;
            " 2>/dev/null >> "$ARCHIVO" || true
        fi
    fi
    echo "" >> "$ARCHIVO"

    # §9 Tablas multiples puntos escritura
    echo "## 6. Tablas con multiples puntos de escritura (riesgo de inconsistencia)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if [ -d "$PROJECT_ROOT/src/controllers" ]; then
        local tablas_insertadas=""
        tablas_insertadas=$(grep -roh "INSERT INTO [a-z_]*" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | sed 's/INSERT INTO //' | sort | uniq -c | sort -rn || true)
        if [ -n "$tablas_insertadas" ]; then
            while IFS= read -r linea; do
                local count_ins tabla_ins
                count_ins=$(echo "$linea" | awk '{print $1}')
                tabla_ins=$(echo "$linea" | awk '{print $2}')
                if [ "$count_ins" -gt 2 ]; then
                    local archivos_distintos=""
                    archivos_distintos=$(grep -rl "INSERT INTO ${tabla_ins}" "$PROJECT_ROOT/src/controllers" --include="*.js" 2>/dev/null | wc -l || echo "0")
                    if [ "$archivos_distintos" -gt 1 ]; then
                        echo "- [WARN] $tabla_ins: $count_ins INSERTs en $archivos_distintos archivos distintos" >> "$ARCHIVO"
                    fi
                fi
            done <<< "$tablas_insertadas"
        fi
    fi
    echo "" >> "$ARCHIVO"

    # [v57] §10 Progreso de migracion DUPLICADO removido. Ya esta en PROMPT_MAESTRO.

    # [v38] §11-§15: Solo scores compactos. Detalle completo en PROMPT_MAESTRO y SEGURIDAD
    echo "## 7. Resumen rapido (detalle en PROMPT_MAESTRO y SEGURIDAD)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # Score Features
    local feat_count=0
    if [ -n "${ROUTES_DIR:-}" ] && [ -d "$ROUTES_DIR" ]; then
        feat_count=$(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | wc -l || echo "0")
    fi
    echo "- Modulos con rutas: $feat_count" >> "$ARCHIVO"

    # Score Seguridad
    local sec_ok=0 sec_warn=0
    if [ -n "${JS_DIR:-}" ] && [ -d "$JS_DIR" ]; then
        sec_warn=$(grep -rl "login\.html" "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak\|auth\.js\|login\.js" | wc -l || echo "0")
    fi
    local doble_api=0
    if [ -n "${JS_DIR:-}" ] && [ -d "$JS_DIR" ]; then
        doble_api=$(grep -rn 'API_BASE.*\/api\/' "$JS_DIR"/*.js 2>/dev/null | grep -v ".bak" | wc -l || echo "0")
    fi
    echo "- Seguridad: ${sec_warn} redirects redundantes, ${doble_api} doble /api (ver SEGURIDAD para detalle)" >> "$ARCHIVO"

    # Score Transacciones (caller-aware: helpers reciben client ya transaccionado)
    local tx_ok=0 tx_warn=0
    local TABLAS_FIN_CHECK="movimientos_caja turnos_caja recibos recibo_items cuentacorrienteclientes cuentacorrienteproveedores pagosaproveedores facturas factura_items inventario movimientos_stock confirmaciones_pago"
    for tbl_chk in $TABLAS_FIN_CHECK; do
        local archivos_chk=""
        archivos_chk=$(grep -rl "INSERT INTO ${tbl_chk}" "$CONTROLLERS_DIR" ${UTILS_DIR:+"$UTILS_DIR"} --include="*.js" 2>/dev/null || true)
        [ -z "$archivos_chk" ] && continue
        while IFS= read -r arch_chk; do
            [ -z "$arch_chk" ] && continue
            local tb=""
            tb=$(grep -c "BEGIN\|client\.query.*BEGIN\|pool\.query.*BEGIN" "$arch_chk" 2>/dev/null) || tb=0
            if [ "$tb" -gt 0 ]; then
                tx_ok=$((tx_ok + 1))
            else
                # Caller-aware: si el helper recibe client (no pool), la TX la maneja el controller
                local uses_client=""
                uses_client=$(grep -c "async function.*client," "$arch_chk" 2>/dev/null) || uses_client=0
                if [ "$uses_client" -gt 0 ]; then
                    # Verificar que algun controller caller tenga BEGIN
                    local helper_name caller_has_begin=0
                    helper_name=$(basename "$arch_chk" .js | sed 's/\.helper//')
                    local callers=""
                    callers=$(grep -rl "require.*${helper_name}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null || true)
                    if [ -n "$callers" ]; then
                        while IFS= read -r caller; do
                            [ -z "$caller" ] && continue
                            local cb=""
                            cb=$(grep -c "BEGIN" "$caller" 2>/dev/null) || cb=0
                            if [ "$cb" -gt 0 ]; then caller_has_begin=1; break; fi
                        done <<< "$callers"
                    fi
                    if [ "$caller_has_begin" -eq 1 ]; then tx_ok=$((tx_ok + 1)); else tx_warn=$((tx_warn + 1)); fi
                else
                    tx_warn=$((tx_warn + 1))
                fi
            fi
        done <<< "$archivos_chk"
    done
    echo "- Transacciones: ${tx_ok} OK, ${tx_warn} sin BEGIN/COMMIT (ver SEGURIDAD §10)" >> "$ARCHIVO"

    # Score Endpoints huerfanos
    local huerfanos_cnt=0
    if [ -d "$CONTROLLERS_DIR" ] && [ -d "$ROUTES_DIR" ]; then
        while IFS= read -r rf; do
            [ -z "$rf" ] && continue
            local rn; rn=$(basename "$rf" .routes.js)
            local cf=""
            cf=$(find "$CONTROLLERS_DIR" -name "${rn}.controller.js" 2>/dev/null | head -1 || true)
            [ -z "$cf" ] && continue
            local fr=""
            fr=$(grep -oE "[a-zA-Z]*[Cc]ontroller\.[a-zA-Z_][a-zA-Z0-9_]*" "$rf" 2>/dev/null | sed 's/.*\.//' | sort -u || true)
            local fc=""
            fc=$(grep -oE "exports\.[a-zA-Z_][a-zA-Z0-9_]*" "$cf" 2>/dev/null | sed 's/exports\.//' | sort -u || true)
            if [ -n "$fc" ]; then
                while IFS= read -r fn; do
                    [ -z "$fn" ] && continue
                    if [ -n "$fr" ] && echo "$fr" | grep -qw "$fn"; then :; else huerfanos_cnt=$((huerfanos_cnt + 1)); fi
                done <<< "$fc"
            fi
        done < <(find "$ROUTES_DIR" -name "*.routes.js" -type f 2>/dev/null | sort)
    fi
    if [ "$huerfanos_cnt" -eq 0 ]; then
        echo "- Endpoints huerfanos: [OK] ninguno" >> "$ARCHIVO"
    else
        echo "- Endpoints huerfanos: ${huerfanos_cnt} sin ruta (ver SEGURIDAD §11)" >> "$ARCHIVO"
    fi

    # Score Multi-empresa
    if verificar_bd; then
        local me_total me_con me_sin
        me_total=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'" 2>/dev/null || echo "0")
        me_con=$(psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT COUNT(DISTINCT table_name) FROM information_schema.columns WHERE table_schema='public' AND column_name='id_empresa'" 2>/dev/null || echo "0")
        me_sin=$((me_total - me_con))
        local queries_sin=0
        if [ -d "${CONTROLLERS_DIR:-}" ]; then
            for tbl_me in cotizaciones formas_pago listasdeprecios metodosdepago pagos producto_proveedor rol_modulos; do
                local qs=0
                qs=$(grep -rn "FROM ${tbl_me}\b" "${CONTROLLERS_DIR}" "${UTILS_DIR:-/dev/null}" --include="*.js" 2>/dev/null \
                    | grep -v "node_modules" | grep -v "id_empresa" | grep -v "^\s*//" | wc -l || echo "0")
                queries_sin=$((queries_sin + qs))
            done
        fi
        echo "- Multi-empresa: ${me_con}/${me_total} tablas con id_empresa, ${queries_sin} queries sin filtro (ver PROMPT §9.6)" >> "$ARCHIVO"
    fi
    echo "" >> "$ARCHIVO"

    # [v39] §12: Integridad auditoría multi-empresa
    echo "## 8. Integridad auditoria multi-empresa (2026-03-01)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_auditoria_multiempresa "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # [v41] §13: Datos semilla
    echo "## 9. Datos semilla obligatorios" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    verificar_datos_semilla "$ARCHIVO"
    echo "" >> "$ARCHIVO"

    # [v41] §14: UPDATEs directos en controllers (bypass de helper)
    echo "## 10. UPDATEs directos en controllers (bypass helper)" >> "$ARCHIVO"
    echo "" >> "$ARCHIVO"
    if [ -d "$CONTROLLERS_DIR" ] && [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        local updates_directos=0
        while IFS= read -r update_line; do
            [ -z "$update_line" ] && continue
            local ut_tabla=""
            ut_tabla=$(echo "$update_line" | grep -oP 'UPDATE \K[a-z_]+' || true)
            [ -z "$ut_tabla" ] && continue
            # Verificar si la tabla tiene helper
            local ut_helper=""
            ut_helper=$(grep -rwl "${ut_tabla}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
            if [ -n "$ut_helper" ]; then
                local ut_file=""
                ut_file=$(echo "$update_line" | cut -d: -f1)
                echo "- [WARN] $(basename "$ut_file"): UPDATE ${ut_tabla} directo (helper: $(basename "$ut_helper"))" >> "$ARCHIVO"
                updates_directos=$((updates_directos + 1))
            fi
        done < <(grep -rn "UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | grep -v ".bak" | grep -v "^\s*//" || true)
        if [ "$updates_directos" -eq 0 ]; then
            echo "- [OK] Ningun UPDATE directo en controllers con helper existente" >> "$ARCHIVO"
        else
            echo "- Total: ${updates_directos} UPDATEs directos que deberian usar helper" >> "$ARCHIVO"
        fi
    fi
    echo "" >> "$ARCHIVO"

    echo "Salud generada: $ARCHIVO"
}


# =======================================================================================
# GENERAR CONTEXTO COMPLETO PARA IA
# =======================================================================================

generar_contexto_ia() {
    local CONTEXT_FILE="$OUTPUT_DIR/CONTEXTO_IA_$(date +%Y%m%d_%H%M).md"
    
    header
    echo "Generando contexto completo para IA..."
    echo ""
    
    explorar_proyecto
    
    cat > "$CONTEXT_FILE" << EOF
# CONTEXTO ERP LAGO - $(date '+%Y-%m-%d %H:%M')
## Toolkit v${VERSION}

---

## VERSIONES RUNTIME
EOF

    echo '```' >> "$CONTEXT_FILE"
    extraer_versiones_runtime >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"

    echo "## ESTRUCTURA DEL PROYECTO"

    echo '```' >> "$CONTEXT_FILE"
    tree -L 1 -d -I 'node_modules|.git|coverage|jsOLD.bak|backups' "$PROJECT_ROOT" --noreport 2>/dev/null >> "$CONTEXT_FILE" || ls -1d "$PROJECT_ROOT"/*/ 2>/dev/null >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    echo "## TABLAS DE BASE DE DATOS" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if verificar_bd; then
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema='public' AND table_type='BASE TABLE'
            ORDER BY table_name;
        " 2>/dev/null >> "$CONTEXT_FILE"
    fi
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    # [v57] Solo nombre + cantidad de exports. Detalle de endpoints en RUTAS API.
    echo "## CONTROLADORES (resumen)" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    for ctrl in "$CONTROLLERS_DIR"/*.controller.js; do
        [ -f "$ctrl" ] || continue
        local nombre nexp
        nombre=$(basename "$ctrl")
        nexp=$(grep -c "^exports\." "$ctrl" 2>/dev/null || echo 0)
        echo "$nombre ($nexp exports)" >> "$CONTEXT_FILE"
    done
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"

    # [v57] HELPERS CENTRALIZADOS removido de contexto. Detalle completo en PROMPT_MAESTRO.md

    # [v36] Middlewares
    echo "## MIDDLEWARES" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if [ -n "${MIDDLEWARE_DIR:-}" ] && [ -d "$MIDDLEWARE_DIR" ]; then
        for mw in "$MIDDLEWARE_DIR"/*.js; do
            [ -f "$mw" ] || continue
            local nombre; nombre=$(basename "$mw")
            local lineas; lineas=$(wc -l < "$mw" 2>/dev/null || echo "?")
            echo "$nombre ($lineas lineas)" >> "$CONTEXT_FILE"
        done
    fi
    # [v41] Middlewares globales en server.js
    if [ -f "$PROJECT_ROOT/server.js" ]; then
        local global_mw=""
        global_mw=$(grep -oE "app\.use\(.*require\(['\"][^'\"]+['\"]\)" "$PROJECT_ROOT/server.js" 2>/dev/null \
            | sed "s/app\.use(.*require(['\"]//; s/['\"])//" | sort -u || true)
        if [ -n "$global_mw" ]; then
            echo "--- server.js globals ---" >> "$CONTEXT_FILE"
            while IFS= read -r gmw; do
                [ -n "$gmw" ] && echo "app.use($gmw)" >> "$CONTEXT_FILE"
            done <<< "$global_mw"
        fi
        # Detectar app.use(express.json/static/etc)
        local express_mw=""
        express_mw=$(grep -oE "app\.use\((express|compression|cors|helmet|cookieParser)" "$PROJECT_ROOT/server.js" 2>/dev/null | sed 's/app\.use(//' | sort -u || true)
        if [ -n "$express_mw" ]; then
            while IFS= read -r emw; do
                [ -n "$emw" ] && echo "app.use($emw)" >> "$CONTEXT_FILE"
            done <<< "$express_mw"
        fi
    fi
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    echo "## RUTAS API" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    for route in "$ROUTES_DIR"/*.routes.js; do
        [ -f "$route" ] || continue
        local nombre
        nombre=$(basename "$route")
        echo "$nombre:" >> "$CONTEXT_FILE"
        grep -E "router\.(get|post|put|delete)" "$route" 2>/dev/null | sed 's/^/  /' >> "$CONTEXT_FILE" || true
    done
    echo '```' >> "$CONTEXT_FILE"
    echo "" >> "$CONTEXT_FILE"
    
    # [v57] PAGINAS FRONTEND removido de contexto. Detalle en MAPEO FRONTEND->BACKEND del PROMPT_MAESTRO.

    # [v38] Removido: COLUMNAS GENERATED (ya en PROMPT_MAESTRO)
    # [v38] Removido: FEATURES ESPECIALES (ya en PROMPT_MAESTRO)
    # [v38] Removido: SEGURIDAD resumen (ya en archivo SEGURIDAD)

    echo "## PUNTOS DE ESCRITURA EN TABLAS CRITICAS" >> "$CONTEXT_FILE"
    echo '```' >> "$CONTEXT_FILE"
    if [ -d "$CONTROLLERS_DIR" ]; then
        local tablas_criticas_auto=""
        tablas_criticas_auto=$(grep -roh "INSERT INTO [a-z_]*" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null \
            | sed 's/INSERT INTO //' | sort | uniq -c | sort -rn | awk '$1 >= 2 {print $2}' || true)
        if [ -n "$tablas_criticas_auto" ]; then
            while IFS= read -r tabla_critica; do
                [ -z "$tabla_critica" ] && continue
                local ctrl_count=""
                ctrl_count=$(grep -rl "INSERT INTO ${tabla_critica}\|UPDATE ${tabla_critica}" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
                local helper_count=""
                helper_count=$(grep -rl "INSERT INTO ${tabla_critica}\|UPDATE ${tabla_critica}" "$PROJECT_ROOT/src/utils" "$PROJECT_ROOT/src/services" --include="*.js" 2>/dev/null | wc -l || echo "0")
                echo "$tabla_critica: ${ctrl_count} controllers, ${helper_count} helpers" >> "$CONTEXT_FILE"
            done <<< "$tablas_criticas_auto"
        fi
    fi
    echo '```' >> "$CONTEXT_FILE"

    echo "" >> "$CONTEXT_FILE"
    
    echo -e "${GREEN}[OK] Contexto generado: $CONTEXT_FILE${NC}"
}

# =======================================================================================
# LISTAR MODULOS
# =======================================================================================

listar_modulos() {
    header
    explorar_proyecto

    echo "Modulos disponibles:"
    echo ""

    while IFS= read -r html_file; do
        [ -z "$html_file" ] && continue
        local nombre status
        nombre=$(basename "$html_file" .html)
        status=""

        [ -f "$JS_DIR/${nombre}.js" ] && status+="${GREEN}+JS${NC} "
        [ -f "$JS_DIR/${nombre}-script.js" ] && status+="${GREEN}+JS${NC} "

        local mod_first
        mod_first=$(echo "$nombre" | cut -d'-' -f1)
        ls "$CONTROLLERS_DIR"/*${mod_first}*.controller.js &>/dev/null 2>&1 && status+="${BLUE}+Ctrl${NC} "
        ls "$ROUTES_DIR"/*${mod_first}*.routes.js &>/dev/null 2>&1 && status+="${CYAN}+Routes${NC} "

        echo -e "  $nombre $status"
    done < <(find "${FRONTEND_DIR:-$PROJECT_ROOT}" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)

    echo ""
}


# =======================================================================================
# PROMPT MAESTRO
# =======================================================================================

prompt_maestro() {
    local PROMPT_FILE="$OUTPUT_DIR/PROMPT_MAESTRO.md"

    header
    echo "Generando Prompt Maestro v${VERSION} (dinamico)..."
    echo ""

    explorar_proyecto

    # === Seccion 1: Encabezado y reglas ===
    cat > "$PROMPT_FILE" << 'STATICBLOCK'
# PROMPT MAESTRO - ERP LAGO
## (Generado dinamicamente por Toolkit)

---

## ROL
Actuas como **Principal Software Architect & Lead Developer** para ERP LAGO.

---

## REGLAS CRITICAS DE DESARROLLO

### 1. NUNCA EDITAR CODIGO JS CON SED/REPLACE PARCIALES
- PROHIBIDO: sed -i en archivos .js (corrompe backticks)
- CORRECTO: funcion completa via cat EOF o Python

### 2. SIEMPRE VALIDAR SINTAXIS ANTES DE DEPLOYAR
- source ~/.nvm/nvm.sh && node --check archivo.js

### 3. VERIFICAR ESTRUCTURA BD ANTES DE MODIFICAR
- PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -c "\d nombre_tabla"

### 4. CENTRALIZAR ANTES DE IMPLEMENTAR
- Verificar si ya existe helper en src/utils/ antes de escribir logica
- Si la operacion se repite en 2+ controllers, crear helper primero
- BD es UNICA fuente de verdad. Frontend solo muestra, NUNCA recalcula

### 5. RASTREO OBLIGATORIO
- Antes de tocar tabla critica: ./toolkit_v58.sh rastrear nombre_tabla
- No asumir que un solo controller es el unico que toca la tabla

### 6. VERIFICAR API_BASE_URL ANTES DE ESCRIBIR URLs
- config.js define API_BASE_URL = 'http://host:port/api' (YA incluye /api)
- CORRECTO: ${API_BASE}/auth/perfil
- INCORRECTO: ${API_BASE}/api/auth/perfil (doble /api → 404)

### 7. BASH: NO USAR node -e CON !
- bash interpreta ! como history expansion
- CORRECTO: cat > /tmp/script.js << 'EOF' ... EOF && node /tmp/script.js

### 8. LEER COMENTARIOS DEL ARCHIVO ANTES DE MODIFICARLO
- Cada helper documenta sus invariantes en /* */ y // al inicio del archivo
- Ejemplo real: productos.helper.js linea 22 dice "productos — COMPARTIDA (sin id_empresa)"
- Si el codigo y los comentarios contradicen tu hipotesis, los comentarios ganan
- Antes de proponer ALTER TABLE o WHERE id_empresa, verificar comentarios primero

### 9. VERIFICAR PREMISA DEL CHECK ANTES DE APLICAR FIX
- Si el toolkit reporta "tabla X sin id_empresa", verificar PRIMERO con \d X
- Los reportes pueden tener falsos positivos por BD no disponible o cache
- NUNCA aplicar fix masivo sin haber validado contra schema real
- Regla de oro: "el reporte sugiere, el schema decide"

### 10. PRODUCTOS ES CATALOGO COMPARTIDO (NO ENTERPRISE)
- La tabla productos NO tiene id_empresa
- Es catalogo global compartido entre empresas (modelo de negocio)
- Lo que cambia por empresa: inventario, precios, producto_proveedor, producto_componentes
- NUNCA agregar WHERE id_empresa a queries sobre productos
- Verificable con: \d productos | grep id_empresa  (debe estar VACIO)

---

## PREFERENCIAS DE NEGOCIO Y UX
*(Reglas de producto definidas por el dueño. NO son reglas tecnicas — son decisiones
de negocio que afectan como se ven y funcionan los modulos. Si modificas un modulo
de venta-rapida, compras o comprobantes, RELEER esta seccion antes.)*

### P1. STOCK SIEMPRE VISIBLE EN VENTA-RAPIDA Y COMPRAS
- Toda grilla de seleccion de productos en **venta-rapida** y **compras** muestra
  una columna `Stock` con el stock_real del **deposito asignado al usuario activo**
  (NO el agregado total — eso va en tooltip).
- Mostrar SIEMPRE el numero literal: 0, 5, 12, -3. Nunca reemplazar por "Sin stock"
  ni por iconos ambiguos. El numero exacto es informacion que el vendedor necesita.
- Color por umbral:
  - Verde: stock_real > stock_minimo
  - Ambar: 0 < stock_real <= stock_minimo
  - Rojo:  stock_real <= 0
- Tooltip al hover: "Total empresa: X (Dep1: Y, Dep2: Z)" — consulta on-demand
  a inventario_deposito.
- El helper de busqueda de productos debe devolver stock_real (del deposito del
  usuario) y stock_minimo SIEMPRE — es responsabilidad del helper, no de cada
  controller.
- Resolucion del deposito del usuario: stockHelper.obtenerDepositoUsuario(id_usuario).
- En compras, el deposito de referencia es el de destino del comprobante. Si el
  usuario carga un comprobante para otro deposito, mostrar el stock de ESE deposito
  (no el suyo).

### P2. IMPRIMIR Y EXPORTAR DISPONIBLE EN TODO COMPROBANTE DE COMPRA
- Toda pantalla que muestra un comprobante de compra (listado o detalle) DEBE
  ofrecer botones de Imprimir y Exportar (PDF + Excel).
- El boton Imprimir usa el camino correcto segun lo que ya esta implementado
  para ese tipo de doc (ver seccion IMPRESION mas abajo).
- Exportar Excel: usa excel.helper.js con compras.helper.js
  obtenerComprobantesParaExport y obtenerItemsParaExport (helpers que YA existen
  — no duplicar logica).
- Esta preferencia es OBLIGATORIA para compras y EXTENSIBLE a otros modulos
  (facturas, recibos, presupuestos, NC/ND).

### P3. "IMPRIMIR LO QUE ESTA EN PANTALLA" UNIVERSAL POR MODULO
- Toda vista de detalle de un comprobante (compra, venta, recibo, NC/ND, presupuesto,
  remito, pago a proveedor, arqueo de caja, reportes) tiene un boton de imprimir
  visible y accesible con shortcut F9.
- "Imprimir lo que esta en pantalla" significa imprimir el COMPROBANTE QUE SE ESTA
  VIENDO usando su tipo + id, NO capturar el DOM. La BD es source of truth, no
  el navegador.
- Cada modulo elige su camino de impresion segun el tipo de doc (ver seccion
  IMPRESION mas abajo). NO forzar todo a Puppeteer (RAM servidor, lento).

---

## LECCIONES APRENDIDAS

| Error | Solucion |
|-------|----------|
| sed corrompe JS con backticks | cat EOF o Python |
| Olvidar \d tabla antes de tocar BD | SIEMPRE verificar estructura primero |
| API_URL hardcodeada | window.CONFIG?.API_BASE_URL |
| catch generico no propaga statusCode | Siempre propagar error.statusCode |
| Asumir un solo controller toca tabla | grep -rn "INSERT INTO tabla" src/ primero |
| Columnas GENERATED en INSERT/UPDATE | Consultar seccion GENERATED, no escribibles |
| movimientos_caja FK a metodosdepago | NO a formas_pago (tablas distintas) |
| req.user en controllers | Es req.usuario (auth.middleware.js) |
| stock en productos.stock | Es inventario.stock_real |
| venta-rapida usa borrador.controller | NO pedidos.controller directo |
| Doble /api en URLs frontend | API_BASE_URL ya incluye /api |
| 403 redirige a login | Solo 401 redirige. 403 = sin permiso, mostrar aviso |
| express.static antes de middleware | htmlAccessMiddleware va ANTES de express.static |
| Browser cachea HTML | Anti-cache headers en server.js para *.html |
| Multiples JS redirigen a login | Server-side ya protege. Eliminar redirects client-side |
| bash node -e con ! falla | Usar cat EOF + node script.js |
| ON CONFLICT sin id_empresa | SIEMPRE verificar constraint real con \d tabla. producto_proveedor necesita (id_empresa, id_producto, id_proveedor) |
| verificarAcceso* retorna boolean | Ahora retorna { permitido: bool, solo_lectura: bool } — actualizar todos los callers |
| Helper sin id_empresa en firma | Post-auditoria: TODOS los helpers de tablas enterprise reciben id_empresa como primer param |
| Cache key sin id_empresa | Siempre ${id_empresa}_${key}. Cache global solo para catalogo compartido |
| ORDER BY sin JOIN en helper | modulos.helper.js: ORDER BY mg.orden requiere JOIN a modulo_grupos |
| Puppeteer para todo PDF | RAM servidor, lento | HTML local + window.print() para docs no fiscales |
| **Puppeteer para CUALQUIER cosa en LAGO** | **(1) ~200MB por job + leak de browser contexts -> OOM cada N horas. (2) Impresion a medias (modal cerrado / error JS / timeout) deja proceso colgado y bloquea event loop de Node -> ERP no responde a NADIE hasta reiniciar PM2.** | **Patron unico vigente: controller renderiza .hbs server-side, devuelve HTML, `<script>window.onload=()=>window.print()</script>` dispara impresion en browser cliente. Ver seccion "IMPRESION — RECETA REAL DEL ERP" del prompt. NO proponer cola Puppeteer/CUPS para nada nuevo, ni siquiera para facturas fiscales.** |
| alert() como vista previa | UX pobre | Ventana imprimible con datos empresa + auto-print |
| Monkey-patching funciones globales | Deuda tecnica | 1 funcion async + endpoint server-side |
| Modal referenciado sin existir HTML | Error silencioso | Verificar IDs HTML<>JS antes de deploy |
| GET /clientes completo en init | 12K registros, lento | Lazy load + endpoint /buscar?q= puntual |
| UPDATE directo en controller | Bypass de helper | SIEMPRE usar helper, incluido para UPDATEs |
| Campos editables sin whitelist | Escritura arbitraria | pedidosHelper.actualizarCampos() con whitelist |
| Python str.replace() en multi-match | Reemplaza la PRIMERA ocurrencia, no la deseada | Usar sed -i con numero de linea exacto para queries repetidas |
| Param opcional id_empresa en helper | Callers que no lo pasan → WHERE id_empresa=NULL → 0 filas | Si id_empresa es obligatorio para aislamiento, NO hacerlo opcional. Si es opcional, no usarlo en WHERE |
| Bloquear edicion por pagos confirmados | Usuario no puede corregir nada post-venta | Solo bloquear si facturado/presupuestado/remitido. Pagos no bloquean — sobrepago va a CC |
| Template HBS usa campo distinto al controller | descripcion vs descripcion_congelada → campo vacio | Verificar campos del template .hbs ANTES de armar el objeto en controller |
| registrarLogPedido no se llamaba | Acciones post-venta sin auditoría | TODA accion sobre pedido confirmado DEBE llamar registrarLogPedido() |
| Historial solo mostraba items | pedidos_log existia pero no se consultaba | obtenerHistorialPedido() hace UNION ALL de pedidos_log + borrador_items_log |
| renderAcciones bloqueaba por estado_pago | Confirmado no dejaba editar | puedeEditar = !facturado && !presupuestado (pagos no bloquean) |
| CHECK constraint vs trigger desacoplados | Trigger inserta 'precio_inicial' pero CHECK solo permite 'inicial' | Verificar que TODOS los valores que insertan triggers esten en el CHECK |
| INNER JOIN en FK nullable oculta registros | getSuspendidos con JOIN clientes excluye los sin cliente | Siempre LEFT JOIN cuando la FK puede ser NULL |
| Helper caller sin id_empresa en objeto | actualizarPrecio({id_producto, precio}) → UPDATE 0 filas silencioso | Grep TODOS los callers de un helper al agregar param obligatorio |
| Frontend no envia campos que no gestiona | guardarProducto() no envia url_imagen → se pisa con null | Preservar campos no-editables leyendo del objeto original antes de enviar |
| Frontend hardcodea IVA 21% | calcularTotal() y cambiarPrecio() usan *1.21 y /1.21 | Mapear iva_aplicado per-item desde BD, usar variable en calculo |
| parseInt('null') = NaN en controller | sincronizarPagos recibe borradorId=null → NaN en SQL | Validar isNaN() antes de queries parametrizadas |
| GET a ruta inexistente reseta estado | cargarBorradorActivo checkea GET /borrador/:id que no existe | Verificar que la ruta existe en routes.js antes de hacer fetch |
| DELETE sin filtro empresa borra cross-empresa | DELETE FROM conjunto_items WHERE id_producto=$1 (sin id_empresa) | TODA operacion DELETE debe filtrar por id_empresa |
| Configs hardcodeadas en frontend | Texto pie cotizacion, limites, etc | configuraciones_empresa + panel Configuraciones Personalizadas |
| precio/1.21 hardcodeado en conversion | cambiarPrecio divide por 1.21 fijo | Leer alicuota real del item: 1 + iva_porcentaje/100 |
| SELECT + UPDATE separados en stock | Race condition: 2 vendedores leen mismo stock | UPDATE atomico: SET stock_real = stock_real + $cant RETURNING |
| INSERT sin ON CONFLICT en concurrencia | Duplicate key cuando 2 requests crean mismo registro | INSERT ON CONFLICT (unique_key) DO NOTHING antes del UPDATE |
| INTEGER para stock en tabla cache | Trunca decimales (0.5 metros, 2.3 kg) | NUMERIC(12,2) en todas las columnas de stock |
| tipo_movimiento sin CHECK constraint | Cualquier string se guarda, sin integridad | CHECK constraint + Set de validacion en JS |
| Frontend crea borrador + otro ajuste | Borrador huerfano queda en BD sin items | DELETE borrador viejo antes de crear nuevo ajuste |
| Fiado modelado como pago method=6 | 30+ parches filtrando !=6 en vistas/queries/frontend | Fiar NO es pagar. pedidos.es_fiado + DEBE en CC. Tabla pagos solo pagos reales |
| registrarVentaConPago bifurcado por method | DEBE+HABER para contado, solo DEBE para fiado | Eliminar bifurcacion. Siempre DEBE+HABER. Fiado va por registrarFiado() separado |
| Cobro despacho crea pago nuevo sin anular CC | Doble pago: CC fantasma + pago real = saldo negativo | registrarCobroRemito: HABER en CC + marcar remito + desmarcar es_fiado |
| esConsumidorFinal por condicion IVA | Cliente real con cond.IVA=CF no registra CC | Chequear por ID config (clientes.id_consumidor_final), no por condicion IVA |
| Frontend fiado via id_metodo_pago:6 | Backend intercepta en loop, semántica incorrecta | Payload {fiado:true, monto_fiado:X}. Botón FIAR separado del selector pagos |
| verificarEditable suma pagos sin filtrar estado | Pagos reembolsados bloquean edición | Filtrar pg.id_pago_estado=2 en subquery total_pagado |
| Doble-pagos por cuotas parecen errores | total_final tiene precio base, pago tiene interés | Diagnosticar con cuotas/coeficiente/monto_original antes de corregir |
| LIKE '%term1 term2%' no matchea multi-palabra | "MEM PRO" no encuentra "MEMB. EN PASTA PRO..." | Separar términos, AND each con busqueda_vector ILIKE '%term%' |
| Columna JSONB nullable es retrocompatible | variante_atributos no rompe import/export/helpers | DEFAULT NULL + COALESCE en UPDATE = 0 impacto en código existente |
| Padre sin precio filtrado por excluirSinPrecio | Producto agrupador no tiene precio propio | Exceptuar padres: OR EXISTS(SELECT 1 FROM productos WHERE id_producto_padre=p.id) |
| Cards repetidas para variantes de un producto | 6 cards iguales confunden al usuario | 1 card padre + selectores color/medida en modal. Patrón e-commerce estándar |
| agregarAlCarrito no encuentra hijos de grupo | Hijos no están en catalogo.productos directo | Buscar en grupo.hijos cuando el ID no está en el array principal |
| parseInt trunca cantidades decimales | parseInt("1.5")=1 en JS → cantidad_remitida=1 en vez de 1.5 | SIEMPRE usar parseFloat() para cantidades. parseInt solo para IDs enteros |
| Math.round fuerza enteros en compras | No se puede comprar 1.5 tn | Eliminar Math.round del input, step="0.01", min="0.01" |
| Producto derivado acumula stock propio | Arena x medio tiene -29 pero nunca se repone | BOM: derivados no tienen stock, descontarVenta() resuelve al padre |
| Anulación no revierte BOM | moverStock(ANULACION) devolvía al producto vendido, no al base | TODOS los puntos de stock por venta deben usar descontarVenta(), incluidas anulaciones |
| Asumir que productos tiene id_empresa | NO la tiene. Es catalogo compartido. Verificar con \d productos antes de tocar |
| Aplicar fix sin leer comentarios del helper | productos.helper.js linea 22 documenta "COMPARTIDA". Leer comentarios siempre antes de modificar |
| Toolkit reporta error sin BD disponible | Cuando _get_tablas_compartidas() retorna vacio, NADA se skipea, todo es falso positivo. Verificar BD UP antes de creer reportes |
| Estado pedido -2 (Descartado) en checks | Excluir junto con 99 (Recuperado) y 10 (Anulado por NC) en analisis de pedidos |
| pedidos.total vs total_final confundidos | pedidos.total = SUM(pedidoitems.total_linea, sin IVA). pedidos.total_final = subtotal+IVA-descuentos+recargos forma pago. Son DOS columnas distintas |

---

## ARQUITECTURA

### MODELO MULTI-EMPRESA
- Empresa -> Deposito (=Sucursal, tiene direccion, punto_venta_afip, responsable)
- Deposito -> Cajas, Usuarios (via usuarios.id_deposito), Inventario
- NO existe tabla sucursales separada. Deposito ES la sucursal

#### Tablas COMPARTIDAS (sin id_empresa — catalogo global, 21 tablas)
- **Catalogo:** productos, categorias, marcas, productocodigosbarras, producto_variantes
- **AFIP:** alicuotasiva, condicionesiva, factura_tipos, comprobante_compra_tipos, tiposdecomprobante
- **Estados:** facturaestados, pedidoestados, pagoestados, orden_estados, ordencompraestados
- **Sistema:** bancos, monedas, modulos, modulo_grupos, modulo_rutas_api, rutas_soporte

#### Tablas AISLADAS (con id_empresa — 35 tablas migradas)
- **Comercial:** pagos, precios, listasdeprecios, listaprecioproductos, historial_precios_ventas, descuentos(x4), producto_proveedor, cotizaciones, formas_pago, metodosdepago, comprobantes_afip, configuracion_sistema
- **Items:** factura_items, comprobante_compra_items, comprobante_interno_items, remito_items, recibo_facturas, recibopagos, pago_proveedor_items, nota_items, presupuesto_items, ajuste_inventario_items, orden_compra_items, recepcion_items, conjunto_items, borrador_items_log, imputacion_pagos_proveedor
- **Permisos:** usuarios_logs, usuario_configuracion, permisos_usuario, filtros_guardados, rol_modulos

#### Constraints CRITICOS modificados
- precios PK: **(id_empresa, id_producto, id_lista_precio)** — NO solo (id_producto, id_lista_precio)
- producto_proveedor UNIQUE: **(id_empresa, id_producto, id_proveedor)** — NO solo (id_producto, id_proveedor)
- Todas las 35 tablas tienen INDEX en id_empresa

#### Funcion BD: inicializar_empresa(id_nueva, id_template)
- Copia datos template: formas_pago, metodosdepago, listasdeprecios, cotizaciones, configuracion_sistema, rol_modulos, permisos_usuario
- Crea secuencias: facturas, presupuestos
- Uso: SELECT inicializar_empresa(2, 1);

#### Firmas de helpers que CAMBIARON (breaking changes ya resueltos)
- resolverFormaPago(client, **id_empresa**, id_metodo_pago) — antes NO tenia id_empresa
- obtenerNombreFormaPago(client, **id_empresa**, id_forma_pago) — antes NO tenia id_empresa
- upsertPrecios: ON CONFLICT ahora requiere (id_empresa, id_producto, id_lista_precio)
- upsertProveedores: ON CONFLICT ahora requiere (id_empresa, id_producto, id_proveedor)
- Cache en recargos.helper usa key ${id_empresa}_${id} para aislamiento

#### Pendientes bajo riesgo (funcionan con 1 empresa)
- ventas-consulta/print/comprobante-venta: JOINs metodosdepago sin filtro empresa (nombres iguales)
- html-access.middleware: cache rol_modulos global (refactorizar cuando haya empresa 2)
- recibos.controller: verificar callers internos pasen id_empresa a obtenerCotizacion()

### SISTEMA DE AUDITORÍA — pedidos_log (2026-03-19)

#### Tabla pedidos_log
- id_log SERIAL PK, id_pedido FK, id_empresa FK, id_usuario FK
- accion VARCHAR(50), detalle_antes JSONB, detalle_despues JSONB, ip_origen, created_at

#### LOG_PEDIDO_ACCIONES (constante en pedidos.helper.js):
CONFIRMADO, PAGO_REGISTRADO, PAGO_CAMBIADO, PAGO_ANULADO, ESTADO_CAMBIADO,
ITEM_EDITADO, ITEM_ELIMINADO, ANULADO, DESCUENTO_APLICADO, CLIENTE_CAMBIADO,
FORMA_PAGO_CAMBIADA, RECUPERADO, SUSPENDIDO

#### Puntos de inserción (6 controllers):
- borrador.controller.js → confirmarBorrador: CONFIRMADO
- pedidos.controller.js → editarItem: ITEM_EDITADO
- pedidos.controller.js → eliminarItemPedido: ITEM_ELIMINADO
- pedidos.controller.js → anularPedido: ANULADO
- pedidos.controller.js → actualizarCamposPedido: TIPO_ENTREGA_CAMBIADO
- ventas-consulta.controller.js → registrarPago: PAGO_REGISTRADO
- ventas-consulta.controller.js → corregirMetodoPago: FORMA_PAGO_CAMBIADA

#### Funciones clave (pedidos.helper.js):
- registrarLogPedido(client, {id_pedido, id_empresa, id_usuario, accion, detalle_antes, detalle_despues, ip_origen})
- obtenerHistorialPedido(client, id_pedido) → UNION ALL pedidos_log + borrador_items_log
- asignarNumeroPedido(client, {id_pedido, id_empresa}) → MAX+1 atómico por empresa

#### Frontend:
- consultarVentas incluye: EXISTS(pedidos_log WHERE accion != CONFIRMADO) AS tiene_modificaciones
- facturas.js: badge ⚠ naranja si tiene_modificaciones, ✕ rojo si anulado
- facturas-acciones.js: renderHistorial() con 20 labels + detalle contextual por acción
- facturas-acciones.js: gestionarPago() — modal fusionado registrar+corregir pago

#### Regla: TODA acción sobre pedido confirmado → registrarLogPedido()

### PERMISOS EDICIÓN POST-VENTA (2026-03-19)

| Estado | Editar items | Anular |
|--------|-------------|--------|
| Con pagos, sin factura/presup/remito | SI (sobrepago → CC) | SI |
| Facturado | NO | NO |
| Presupuestado (activo) | NO (anular presup primero) | NO |
| Con remito activo | NO (cancelar remito primero) | NO |
| Remito cancelado/anulado | SI | SI |

Implementado en:
- pedidos-edicion.helper.js → verificarEditable(): subconsultas tiene_presupuesto, tiene_remito_activo
- pedidos.controller.js → obtenerDetalle(): puede_editar, puede_anular
- facturas-acciones.js → renderAcciones(): puedeEditar = !facturado && !presupuestado

### SESION 2026-03-27 — 39 FIXES AUDITORIA MODULO INVENTARIO (5 lotes)
**Lote 1 (18 fixes):** recalcularTotales params crasheados, moverStock reescrito atomico
(UPDATE stock_real=stock_real+$cant RETURNING), TIPOS_MOVIMIENTO completados (4 nuevos) +
validacion Set + CHECK constraints BD, 7 queries/callers sin id_empresa, INTEGER->NUMERIC(12,2)
en inventario cache, VARCHAR(30->50) y NUMERIC(10,2->12,2) en movimientos.
**Lote 2 (10 fixes):** Frontend borradores huerfanos (DELETE borrador antes de crear nuevo),
config.js + CONFIG.API_BASE_URL en inventario.html + inventario-import.js, transferencias con
secuencia atomica seq_transferencias, limpieza 5 borradores huerfanos BD.
**Lote 3 (8 fixes):** documento_referencia AR-NNNNNNNN en ajuste rapido, despachos template
literal escapado (\${} → ${}), stock_comprometido en tabla inventario cache + trigger
sync_inventario_cache actualizado, alertas_stock integrado via trigger gestionar_alertas_stock
+ indice unique parcial, funcion verificar_reconciliacion_stock(), re-sync 193 registros.
**S7 (2 fixes):** excel.helper.js extendido con exportarPlantillaStock() y parsearStockImport(),
inventario-import.controller.js reescrito 649->386 lineas, ExcelJS removido del controller.
**D4 (7 fixes):** Endpoint /api/movimientos-stock completo (helper+controller+routes), 4 indices
compuestos en movimientos_stock_deposito, LEFT JOIN LATERAL para dedupe, form-data+tipos+exportar.
**Archivos creados:** movimientos-stock.helper.js, movimientos-stock.controller.js,
movimientos-stock.routes.js
**Archivos modificados:** stock.helper.js, ajustes-inventario.helper.js, excel.helper.js,
inventario.controller.js, ajustes-inventario.controller.js, inventario-import.controller.js,
despachos.controller.js, inventario.html, inventario-import.js, routes/index.js
**SQL:** 3 secuencias, 2 triggers, 1 funcion reconciliacion, 4 indices, 2 CHECK constraints,
3 ALTER TABLE (tipos), 1 ALTER TABLE (stock_comprometido), 1 indice unique parcial alertas

### SESION 2026-03-25/26 — 18 FIXES PRODUCTOS + VENTA RAPIDA

#### Modulo Productos (8 fixes + 1 constraint):
- BUG 1: Frontend guardarProducto() no envia url_imagen ni publicado_web → se pierden al editar
- BUG 2: abrirModalNuevo() no limpia precioCompraNeto → dato fantasma
- BUG 3: ajustePrecioMasivo no pasa id_empresa al helper → UPDATE 0 filas (silencioso)
- BUG 3c: SELECT precio en ajusteMasivo con 2 params pero 3 placeholders
- BUG 4: actualizarProducto() pisa url_imagen/cod_proveedor con null (sin COALESCE)
- BUG 5: inicializarInventario() sin ON CONFLICT → falla en re-creacion
- BUG 6: obtenerPorId filtra activo=TRUE → imposible ver/editar desactivados
- BUG 7: DELETE conjunto_items sin id_empresa → borra conjuntos de TODAS las empresas
- FIX: CHECK constraint chk_tipo_cambio_valido expandido (precio_inicial, ajuste_masivo, importacion)

#### Modulo Venta Rapida (10 fixes):
- VR-1a: sincronizarPagos parseInt('null')=NaN → PostgreSQL explota
- VR-1b: Race condition en sincronizarPagosABD (borradorId=null dentro del timeout)
- VR-2: agregarItem usa producto.precio_lista que no existia en el SELECT
- VR-3: cargarBorradorActivo hace GET /borrador/:id (ruta inexistente) → 404 → resetea borrador
- VR-5: calcularTotal + mostrarItems + vistaPrevia hardcodean IVA 21% (5 puntos parcheados)
- VR-6: cambiarPrecio divide por 1.21 hardcodeado
- FIX: getSuspendidos JOIN→LEFT JOIN (nullable id_cliente ocultaba TODOS los suspendidos)
- FIX: recuperarPedido JOIN→LEFT JOIN (mismo problema, no podia recuperar)

#### Configuraciones Personalizadas (nuevo panel):
- Endpoint PUT /api/configuraciones/todas → actualizarConfigPersonalizada()
- Panel HTML en configuraciones.html: tabla editable clave/valor con Guardar por fila
- Oculta claves AFIP/sistema, muestra solo las operativas
- Config keys nuevas: productos.alicuota_iva_defecto, productos.limite_resultados_busqueda, cotizacion.pie_pagina

### REGLAS MULTI-EMPRESA PARA DESARROLLO FUTURO
1. TODA query a tabla con id_empresa DEBE filtrar por id_empresa
2. Todo INSERT a tabla con id_empresa DEBE incluir id_empresa
3. Subqueries correlacionadas: usar $1 si el query padre ya tiene id_empresa como $1
4. JOINs entre tablas con id_empresa: agregar AND t1.id_empresa = t2.id_empresa
5. Nuevos helpers: SIEMPRE recibir id_empresa como parametro obligatorio
6. Cache en memoria: usar key con id_empresa para aislamiento
7. Para crear empresa nueva: SELECT inicializar_empresa(N, 1)

### AUDITORIA MULTI-EMPRESA (2026-03-01) — 62 vulnerabilidades, 4 fases, ~55 fixes

#### FASE 1: PERMISOS Y ACCESO (PRIORIDAD CRITICA)
**Problema:** Sistema de permisos no discriminaba por empresa. Usuario empresa 2 veria modulos de empresa 1.

**Archivos modificados:**
- src/utils/modulos.helper.js — REESCRITURA COMPLETA, todas las funciones reciben id_empresa como primer parametro. Cache aislada por ${id_empresa}_${rol}
- src/middleware/html-access.middleware.js — Cache de rol a ${id_empresa}_${rol}, query agrega rm.id_empresa, destructuring incluye id_empresa
- src/middleware/modulo-access.middleware.js — Destructuring agrega id_empresa, llamada a verificarAccesoRuta(id_empresa, rol, ruta)
- src/controllers/modulos-admin.controller.js — Todas las llamadas pasan req.usuario.id_empresa
- src/controllers/auth.controller.js — Linea 92: obtenerModulosRol(usuario.id_empresa, usuario.rol)
- src/routes/usuarios.routes.js — Agregado router.use(verificarToken) (seguridad: todas las rutas requieren token)

**Firmas actualizadas modulos.helper.js (ANTES → DESPUES):**
- obtenerModulosRol(rol) → obtenerModulosRol(id_empresa, rol)
- obtenerModulosDeRol(rol) → obtenerModulosDeRol(id_empresa, rol)
- obtenerMatrizPermisos() → obtenerMatrizPermisos(id_empresa)
- guardarModulosRol(rol, mods, user, ip) → guardarModulosRol(id_empresa, rol, mods, user, ip)
- clonarPermisosRol(origen, destino, user, ip) → clonarPermisosRol(id_empresa, origen, destino, user, ip)
- invalidarCacheRol(rol) → invalidarCacheRol(id_empresa, rol)
- verificarAccesoModulo(rol, codigo) → verificarAccesoModulo(id_empresa, rol, codigo)
- verificarAccesoRuta(rol, ruta) → verificarAccesoRuta(id_empresa, rol, ruta)

**Retorno actualizado:**
- verificarAccesoRuta / verificarAccesoModulo: ANTES return boolean → DESPUES return { permitido: boolean, solo_lectura: boolean }

**Fix adicional: tabla rutas_soporte** tiene columna prefijo_ruta (no ruta) y NO tiene columna activo.
- Estructura real: id | prefijo_ruta varchar(100) | descripcion varchar(255)
- Query corregido: SELECT prefijo_ruta as ruta FROM rutas_soporte (sin WHERE activo = TRUE)

#### FASE 2: ADMIN HELPER
**Problema:** Funciones de logging, permisos y configuracion insertaban sin id_empresa.

**Archivos modificados:**
- src/utils/admin.helper.js → registrarLog(): destructuring agrega id_empresa, INSERT incluye columna
- src/utils/admin.helper.js → togglePermiso(): destructuring agrega id_empresa, SELECT/INSERT/UPDATE filtran por empresa
- src/utils/admin.helper.js → upsertConfigUsuario(): destructuring agrega id_empresa, INSERT incluye columna

**Consumidores actualizados:**
- src/controllers/auth.controller.js lineas 123, 156 → upsertConfigUsuario recibe id_empresa: usuario.id_empresa
- src/controllers/usuarios.controller.js lineas 59, 97, 115, 136, 158 → registrarLog recibe id_empresa: req.usuario.id_empresa
- src/controllers/usuarios.controller.js linea 157 → togglePermiso recibe id_empresa: req.usuario.id_empresa

**Firmas actualizadas admin.helper.js (ANTES → DESPUES):**
- registrarLog(client, { id_usuario, accion, detalle, ip_origen }) → registrarLog(client, { id_empresa, id_usuario, accion, detalle, ip_origen })
- togglePermiso(client, { rol, permiso, activo }) → togglePermiso(client, { id_empresa, rol, permiso, activo })
- upsertConfigUsuario(client, { id_usuario, id_lista_precio }) → upsertConfigUsuario(client, { id_empresa, id_usuario, id_lista_precio })

#### FASE 3: INSERTs EN TABLAS DE ITEMS (19 INSERTs + 7 params corregidos)
**Problema:** 19 INSERTs en tablas hijas no incluian id_empresa. Tablas YA tenian columna (migracion previa) pero queries no la usaban.

**Bug latente CRITICO:** compras.helper.js linea 241: ON CONFLICT (id_producto, id_proveedor) pero constraint real es (id_empresa, id_producto, id_proveedor) → PostgreSQL rechazaria el INSERT al crear empresa 2.

**Correcciones por archivo:**
- src/utils/compras.helper.js → orden_compra_items (~36), recepcion_items (~97), comprobante_compra_items (~160, VALUES $16), producto_proveedor (~241, ON CONFLICT CORREGIDO)
- src/utils/ajustes-inventario.helper.js → ajuste_inventario_items (~226, ~262, ~399)
- src/utils/despachos.helper.js → remito_items (~385)
- src/utils/pagos-proveedores.helper.js → pago_proveedor_items (~60), imputacion_pagos_proveedor (~124)
- src/utils/pedidos.helper.js → borrador_items_log (~729, ya tenia id_empresa OK)
- src/utils/presupuestos.helper.js → presupuesto_items (~101)
- src/utils/recibos.helper.js → recibo_facturas (~90)
- src/utils/crud.helper.js → conjuntos (~154), conjunto_items reemplazar (~179), conjunto_items insertar (~187, ya OK), cotizaciones (~263)
- src/utils/productos.helper.js → conjunto_items crear (~529), conjunto_items actualizar (~585)

**Patron de correccion:**
```
ANTES (roto): INSERT INTO tabla_items (id_padre, id_producto, ...) VALUES ($1, $2, ...)
DESPUES:      INSERT INTO tabla_items (id_empresa, id_padre, id_producto, ...) VALUES ($1, $2, $3, ...)
```

**Constraints verificados (todos migrados):**
- ajuste_inventario_items → ajuste_items_producto_unico UNIQUE (id_ajuste, id_producto)
- conjunto_items → UNIQUE (id_conjunto, id_producto)
- cotizaciones → UNIQUE (id_empresa, id_moneda, fecha_cotizacion, hora_cotizacion)
- permisos_usuario → UNIQUE (id_empresa, rol, permiso)
- producto_proveedor → UNIQUE (id_empresa, id_producto, id_proveedor) ← FIX CRITICO
- rol_modulos → UNIQUE (id_empresa, rol, id_modulo)
- usuario_configuracion → PK (id_usuario)

#### FASE 4: SELECTs SIN FILTRO (Queries de lectura)
**Analisis:** De 24 queries detectadas: 20 ya filtraban correctamente, 2 expuestas corregidas, 2 de riesgo nulo (buscan por PK).

**Correcciones:**
- src/controllers/productos.controller.js linea ~71 → producto_proveedor: LEFT JOIN pp agrega AND pp.id_empresa = $1
- src/controllers/productos.controller.js linea ~293 → producto_proveedor: WHERE agrega AND pp.id_empresa = $1, query parametrizada

**Queries de pagos — NO necesitan fix:** SELECTs de pagos filtran por id_pedido que ya es enterprise-scoped (filtrado transitivo).

**Queries catalogo (sin id_empresa) — correctas:** pagoestados, monedas, categorias, marcas, productos, modulos, modulo_grupos (catalogo compartido).

#### TABLAS: CLASIFICACION COMPARTIDA vs POR EMPRESA

**Compartidas (sin id_empresa — catalogo global):**
categorias, marcas, modulo_grupos, modulo_rutas_api, modulos, monedas, pagoestados, pedidoestados, producto_variantes, productocodigosbarras, productos, rutas_soporte, unidades_medida

**Por empresa (con id_empresa — todas verificadas):**
ajuste_inventario, ajuste_inventario_items, borrador_items_log, cajas, clientes, comprobante_compra, comprobante_compra_items, comprobantes_venta, conjuntos, conjunto_items, cotizaciones, cuentacorrienteclientes, cuentas_por_pagar, depositos, despacho_programaciones, device_config, empresas, factura_items, facturas, formas_pago, imputacion_pagos_proveedor, inventario, listasdeprecios, metodosdepago, orden_compra, orden_compra_items, pago_proveedor, pago_proveedor_items, pagos, pedido_items, pedidos, permisos_usuario, precios, presupuesto_items, presupuestos, print_jobs, proveedores, recepcion, recepcion_items, recibo_facturas, recibos, remito_items, remitos, rol_modulos, sucursales, usuario_configuracion, usuarios, usuarios_logs

#### BACKUPS DE LA AUDITORIA
- backups/pre_fix_multiempresa_fase1_YYYYMMDD_HHMMSS/ → modulos.helper.js, html-access.middleware.js, modulos-admin.controller.js, usuarios.routes.js
- backups/pre_fix_multiempresa_fase2_YYYYMMDD_HHMMSS/ → admin.helper.js
- backups/pre_fix_multiempresa_fase3_YYYYMMDD_HHMMSS/ → compras.helper.js, ajustes-inventario.helper.js, despachos.helper.js, pagos-proveedores.helper.js, pedidos.helper.js, presupuestos.helper.js, recibos.helper.js, crud.helper.js, productos.helper.js

#### CHECKLIST PRE-DEPLOY MULTI-EMPRESA
- [ ] Todas las queries de la tabla filtran por id_empresa
- [ ] El INSERT incluye id_empresa en columnas, VALUES y params (alineados)
- [ ] El ON CONFLICT usa el constraint correcto (verificar con \d)
- [ ] El cache esta aislado por empresa
- [ ] El controller pasa req.usuario.id_empresa al helper
- [ ] El middleware html-access usa ${id_empresa}_${rol} como cache key
- [ ] Ejecutar: ./toolkit_v56.sh auditoria-me (0 errores, 0 warnings)

### FIADO Y CUENTA CORRIENTE (rediseñado 2026-03-29)

#### Principio: fiar ≠ pagar
- Tabla `pagos` solo contiene pagos REALES (efectivo, transferencia, tarjeta, MP)
- El fiado se registra en `pedidos.es_fiado = true` + DEBE en `cuentacorrienteclientes`
- `metodosdepago` id=6 (Cuenta Corriente) existe para histórico pero NO se inserta en pagos

#### Flujo FIAR (confirmarBorrador con CC):
1. `pedidos.es_fiado = true` via `pagosHelper.registrarFiado()`
2. CC: DEBE por el total (si no es Consumidor Final)
3. NO INSERT en tabla pagos
4. NO movimiento de caja

#### Flujo COBRAR FIADO (despacho o mostrador):
1. INSERT en pagos (pago REAL) via `pagosHelper.registrarPago()`
2. CC: HABER por el monto cobrado (cancela DEBE)
3. Movimiento de caja (ingreso)
4. `remitos.pago_confirmado = true` (si es despacho)
5. `pedidos.es_fiado = false` (si saldo queda en 0)

#### Flujo VENTA CONTADO (sin cambios):
1. INSERT en pagos (pago real)
2. CC: DEBE + HABER autocancelado via `registrarVentaConPago()` (si no es CF)
3. Movimiento de caja

#### Guards:
- `pagosHelper.registrarPago()` rechaza `id_metodo_pago = 6` con throw
- `registrarFiado()` es el UNICO camino para fiar
- Vistas SQL (`v_saldo_pedidos`, `v_pedidos_saldos`, `v_clientes_saldos`, `v_pagos_detalle`) ya no filtran method<>6

#### Archivos clave:
- `pagos.helper.js` → `registrarFiado()`, `registrarPago()` (con guard)
- `cc-clientes.helper.js` → `registrarVentaConPago()` (siempre DEBE+HABER)
- `despachos.helper.js` → `registrarCobroRemito()` (HABER + mark remito)
- `pagos-confirmacion.controller.js` → `confirmarPago()` (HABER si era fiado)

### SESION 2026-03-29 — REDISEÑO FIADO/CC (3 fases)
**Problema raíz:** El fiado se modelaba como un pago con id_metodo_pago=6 en tabla pagos.
Esto forzaba 30+ parches (filtros !=6) en vistas SQL, backend y frontend.
**Fase 1 (BD):** ALTER TABLE pedidos ADD es_fiado. UPDATE 203 pedidos. REEMBOLSAR 212 pagos CC.
Marcar 246 remitos cobrados. Recrear 4 vistas sin filtro method=6.
**Fase 2 (Backend helpers):** pagos.helper (guard + registrarFiado), cc-clientes.helper
(eliminar bifurcacion method=6), despachos.helper (HABER CC + mark remito + es_fiado),
borrador.controller (method=6 → registrarFiado + continue).
**Fase 3 (Backend controllers):** pagos-confirmacion (cobro fiado = solo HABER),
ventas-consulta (es_fiado en LATERAL + CTE), pedidos (pendientesCobro con es_fiado + v_saldo),
pedidos-edicion (sin filtro method=6 en caja).
**Post-fix:** Desmarcar 126 fiados ya pagados. totalPagado filtrar solo estado=2.
**Archivos modificados (8):** pagos.helper.js, cc-clientes.helper.js, despachos.helper.js,
borrador.controller.js, pagos-confirmacion.controller.js, ventas-consulta.controller.js,
pedidos.controller.js, pedidos-edicion.helper.js
**Backup:** /root/mi_erp/backups/pre_fix_fiado_20260329_182150/

### SESION 2026-03-29 — FASE 4 FIADO: FRONTEND + FIXES (7 archivos)
**Fase 4 (Frontend + CC fix):**
- venta-rapida-script.js: boton FIAR separado, payload {fiado:true,monto_fiado}, mapeo sin CC:6
- borrador.controller.js: lee flag fiado directo, guard method=6 simple (sin legacy)
- facturas-acciones.js: eliminado dead code method=6 (badge, filter, split, selector)
- tesoreria.js: eliminado dead code method=6 (esCC, 2 skips)
- pedidos-edicion.helper.js: verificarEditable filtra id_pago_estado=2
- cc-clientes.helper.js: esConsumidorFinal() chequea por ID config, no por condicion IVA
- Config: clientes.id_consumidor_final=9 en configuraciones_empresa
**Data fixes:** 2 DUP_EXACTO reembolsados (P381,P345). CF duplicado id=5737 eliminado.
25 aparentes doble-pagos = cuotas legítimas (interés tarjeta).
**Archivos modificados (7):** venta-rapida-script.js, borrador.controller.js,
facturas-acciones.js, tesoreria.js, pedidos-edicion.helper.js, cc-clientes.helper.js,
configuraciones_empresa (BD)
**Backup:** /root/mi_erp/backups/pre_fase4_frontend_*

### SESION 2026-04-02 — CATALOGO WEB AGRUPAMIENTO + VARIANTES + BUSQUEDA

#### Búsqueda multi-palabra en listado productos:
- Endpoint listar: si 2+ palabras, separa términos y usa AND busqueda_vector ILIKE per-term
- "MEM PRO CASA" encuentra "MEMB. EN PASTA PRO... CASA BLANCA"
- 1 palabra sigue usando OR (sku, nombre, marca, cod_barras, proveedor)

#### variante_atributos JSONB en productos:
- ALTER TABLE productos ADD COLUMN variante_atributos JSONB DEFAULT NULL
- Estructura: {"color": "Blanca", "color_hex": "#FFFFFF", "medida": "4 Lt"}
- Helper: crearProducto + actualizarProducto soportan el campo (COALESCE en UPDATE)
- Nullable → no rompe import/export ni código existente

#### Agrupamiento padre/hijo catálogo web:
- Producto padre (sku MPPBL-PADRE): agrupa, tiene imagen, visible_web=true, sin precio propio
- Hijos vinculados via id_producto_padre, cada uno con variante_atributos
- Generador: agrupa hijos por padre, extrae colores/medidas/precioMin
- Padres exceptuados del filtro excluirSinPrecio
- JSON: es_grupo:true, hijos:[], colores:[{nombre,hex}], medidas:[]

#### Frontend lago.ar (index.html):
- renderCard: detecta es_grupo, muestra swatches color (círculos hex) + pills medida + "desde $X"
- Modal: selectores interactivos de color y medida, precio/stock dinámico por combinación
- agregarAlCarrito: busca también en hijos de grupos
- CSS modal-img: max-height 180px, object-fit contain

#### Configuraciones Personalizadas (nuevo panel admin):
- Endpoint PUT /api/configuraciones/todas → actualizarConfigPersonalizada()
- Panel HTML en configuraciones.html: tabla editable clave/valor con Guardar por fila
- Oculta claves AFIP/sistema, muestra solo operativas
- Toggle "Ocultar sin stock web" (catalogo_web.excluir_sin_stock)

**Archivos modificados:** productos.controller.js, productos.helper.js, configuraciones.controller.js,
configuraciones.routes.js, configuraciones.html, generar-catalogo-web.js, catalogo-web/index.html

### SESION 2026-04-03 — BOM + FIXES DECIMALES + COMPRAS

#### Bug parseInt en despachos (6 fixes frontend):
- **Root cause:** parseInt("1.5")=1 en JS. Al registrar regreso de viaje, cantidades decimales se truncaban
- **Efecto:** cantidad_remitida=1 en vez de 1.5, generaba remitos fantasma con saldo pendiente
- **Fix:** 6 parseInt→parseFloat en gestion-despachos.js (actualizarDevolucion, confirmarRegreso, etc.)
- **Datos:** Pedido id=2782 (BRENDA BERNALLA) corregido manualmente

#### Bug Math.round en compras (4 fixes frontend):
- **Root cause:** Math.round(parseFloat(cantidad)) forzaba enteros + step="1" en input HTML
- **Fix:** Eliminado Math.round, step="0.01", min="0.01" en compras.js

#### BOM — Bill of Materials:
- Nueva tabla producto_componentes (6 registros iniciales: arena/piedra/cascote × medio/bolsón)
- Nueva función stockHelper.descontarVenta() — resuelve BOM automáticamente
- Enganchado en 5 puntos de venta/anulación (borrador, pedidos, edición, notas, notas-anulación)
- Derivados (Arena x medio, Piedra x medio, etc.) ya no acumulan stock propio

#### print_jobs constraints: falso positivo toolkit
- trigger_new_print_job hace pg_notify('new_print_job', id) — canal LISTEN/NOTIFY, no valor insertado
- El toolkit lo detectaba como valor no permitido por CHECK. Es falso positivo.

**Archivos modificados:** gestion-despachos.js, compras.js, stock.helper.js,
borrador.controller.js, pedidos.controller.js, pedidos-edicion.helper.js, notas.helper.js
**Tablas creadas:** producto_componentes

### STOCK (auditado 2026-03-27 — 39 fixes en 5 lotes)

#### Arquitectura dual (fuente + cache)
- **Fuente de verdad:** inventario_deposito (por deposito, NUMERIC(12,2))
- **Cache agregado:** inventario (SUM todos depositos, sincronizado via trigger)
- **NUNCA usar:** productos.stock (no existe) ni inventario directo para escribir

#### stock.helper.js — UNICO punto de escritura
- moverStock() — UPDATE atomico (stock_real = stock_real + $cantidad), sin race condition
- descontarVenta() — wrapper que resuelve BOM antes de llamar a moverStock()
- obtenerBOM() — consulta producto_componentes para un producto
- ON CONFLICT (id_deposito, id_producto) DO NOTHING para evitar duplicate key
- Registra en movimientos_stock + movimientos_stock_deposito (trazabilidad 100%)
- TIPOS_MOVIMIENTO validados contra Set + CHECK constraint en BD
- Tipos: VENTA, COMPRA, DEVOLUCION_COMPRA, ANULACION, AJUSTE_MANUAL, AJUSTE_RAPIDO,
  AJUSTE_INVENTARIO, ANULACION_AJUSTE, INICIAL, DESPACHO, ENTREGA, ENTREGA_PARCIAL,
  DEVOLUCION, TRANSFERENCIA_SALIDA, TRANSFERENCIA_ENTRADA, DEVOLUCION_CLIENTE, EGRESO_NOTA_DEBITO

#### Triggers automaticos en inventario_deposito
1. sync_inventario_cache → UPSERT en inventario (stock_real + stock_comprometido)
2. gestionar_alertas_stock → INSERT/UPDATE en alertas_stock (SIN_STOCK, BAJO_MINIMO)

#### Secuencias atomicas
- seq_ajuste_rapido → documentos AR-00000001 (ajustes individuales)
- seq_transferencias → documentos TRF-00000001 (transferencias entre depositos)
- obtener_proximo_numero_ajuste() → AI-00000001 (ajustes formales)

#### API movimientos-stock (D4 — nuevo)
- GET /api/movimientos-stock → filtros: deposito, producto, tipo, usuario, fechas, q
- GET /api/movimientos-stock/form-data → depositos + tipos + usuarios para selects
- GET /api/movimientos-stock/exportar → descarga Excel via excel.helper

#### Reconciliacion
- SELECT * FROM verificar_reconciliacion_stock(1) → debe dar 0 filas
- Compara inventario (cache) vs SUM(inventario_deposito) por empresa

#### excel.helper.js — funciones especializadas
- exportarPlantillaStock() → genera plantilla con metadata oculta + headers coloreados
- parsearStockImport() → detecta header SKU, parsea columna G (stock nuevo)

### BOM — BILL OF MATERIALS (2026-04-03)

#### Tabla producto_componentes
- id_componente_bom SERIAL PK
- id_empresa FK, id_producto FK (el que se VENDE), id_producto_componente FK (el que tiene STOCK)
- cantidad NUMERIC(10,4) — cuánto del componente consume 1 unidad vendida
- activo BOOLEAN, UNIQUE(id_empresa, id_producto, id_producto_componente)

#### Flujo de stock con BOM
- descontarVenta() en stock.helper.js — UNICO punto de descuento por venta
- Si producto tiene BOM → descompone y descuenta cada componente del padre
- Si producto NO tiene BOM → descuento directo (comportamiento original)
- Funciona para VENTA y ANULACION (invierte signo automáticamente)

#### Enganchado en 5 puntos:
1. borrador.controller.js → confirmarBorrador (POS retiro)
2. pedidos.controller.js → crearInmediato (pedido directo)
3. pedidos-edicion.helper.js → ajustarStockPorEdicion (edición post-venta)
4. pedidos-edicion.helper.js → anularPedidoCompleto (anulación)
5. notas.helper.js → aplicarStockNota + revertirStockNota (NC/ND)

#### Ejemplo real (LAGO):
- Arena (66) = producto base, stock en metros
- Arena x medio (73) → BOM: 0.5 de Arena (66)
- Arena en bolsón (145) → BOM: 1.0 de Arena (66)
- Piedra (8456), Cascote (2737) = ídem con sus derivados
- Derivados tienen stock=0 permanente, todo se resuelve al base

#### Reglas:
- Productos con BOM NO acumulan stock propio (siempre 0)
- Compras siempre al producto base (no al derivado)
- Conjuntos (tabla conjuntos) siguen siendo agrupadores/filtros, NO BOM

### SEGURIDAD Y CONTROL DE ACCESO
- **VPN:** WireGuard
- **Auth:** JWT via header Authorization + cookie httpOnly (erp_token)
- **Device:** Fingerprinting + dispositivos_autorizados
- **Middleware:** req.usuario (NO req.user) desde auth.middleware.js
- **Control HTML:** html-access.middleware.js (ANTES de express.static)
  - Lee cookie erp_token → valida JWT → consulta rol_modulos (cache 5min)
  - Sin cookie → redirect /login.html
  - Admin → acceso total (anti-lockout)
- **Control API:** modulo-access.middleware.js (verifica acceso ruta vs rol)
- **Cookie:** erp_token, httpOnly, SameSite=Lax, maxAge=24h
- **Menu dinamico:** auth.js v3.0 offcanvas auto-inyectado
- **Paginas publicas:** login.html, ver-pedido-publico.html, index.html
- **Roles:** admin(25), administrador(23), vendedor(4), despachante(5), cajero(3), pedidos(3)
- **Tablas:** modulos, rol_modulos, modulo_rutas_api, modulo_grupos, rutas_soporte

### IMPRESION — RECETA REAL DEL ERP

> **NO usar Puppeteer.** Se descarto en LAGO por dos motivos concretos del dueno:
> (1) cada job levantaba un Chromium completo (~200 MB) y la RAM no se liberaba
>     bien — leaks de browser contexts terminaban en OOM cada N horas;
> (2) si una impresion quedaba a medias (modal cerrado, error JS, timeout), el
>     proceso quedaba colgado y el ERP dejaba de responder a TODOS los usuarios
>     hasta reiniciar PM2.
> Si una sesion futura sugiere "agreguemos cola Puppeteer/CUPS para esto",
> RECHAZAR. La regla es absoluta.

#### Patron unico (HTML server-side + window.print del browser cliente)

```
[Frontend JS]                           [Backend Node]              [Browser cliente]
window.open(                            print.controller            <html>
  /api/print/comprobante/:id/html  -->  carga datos desde BD  -->     ...datos...
  ?token=XXX                            renderiza .hbs                <script>
)                                       devuelve HTML completo          window.onload =
                                                                         () => window.print();
                                                                       </script>
                                                                     </html>
```

**Por que funciona y no rompe nada:**
- Cero proceso pesado en el servidor — solo renderiza un string de HTML y lo devuelve
- Cero estado en servidor — si el usuario cierra la ventana, no queda nada colgado
- La impresion la hace el BROWSER del cliente, no el servidor
- Si el cliente cancela el dialogo de impresion, el servidor ni se entera
- Funciona con cualquier impresora que el cliente tenga configurada en su SO

#### Imprimibles VIVOS hoy (verificado con grep)

| Que imprime | Quien dispara | Endpoint |
|---|---|---|
| Comprobante de venta (pedido) | `frontend/js/venta-rapida-script.js:1602` | `GET /api/print/comprobante/:id/html?token=` |
| Recibo | `frontend/js/tesoreria.js:546` | `GET /api/print/recibo/:id` |
| Facturas, NC/ND, remitos de venta | (otro patron, sin window.open directo — investigar antes de tocar) | — |

**Codigo del frontend (literal, copiable):**
```js
// venta-rapida-script.js
function imprimirComprobante() {
    window.open(API_URL + '/print/comprobante/' + ultimoPedidoGuardado + '/html?token=' + token, '_blank');
}

// tesoreria.js
function imprimirRecibo(id) {
    window.open(`${API_URL}/print/recibo/${id}`, '_blank');
}
```

#### Componentes en disco

**Plantillas (`templates/comprobantes/`):**
- `comprobante_venta.hbs` — Handlebars, UNICA plantilla .hbs viva hoy

**Plantillas legacy (`config/plantillas/`):**
- `remito.template.html`, `remito.template.compacto.html`, `remito.template.6535.html`
- `ticket-venta.template.html`
- `remito.config.json` — define `plantilla_activa: "compacto"|"normal"|"6535"`

**Backend:**
- `src/routes/print.routes.js` — define las rutas (POST /jobs, GET /jobs, GET /impresoras, GET /comprobante/:id/html, GET /comprobante/:id/datos)
- `src/controllers/print.controller.js` — handlers `crearJob`, `listarJobs`, `obtenerJob`, `listarImpresoras`, `getDatosComprobante`, `renderizarHTML`

#### Imprimibles FALTANTES (lo que NO imprime hoy)

- **Comprobantes de compra** (lo que carga el dueno desde facturas/recibos del proveedor)
- **Recepciones de mercaderia**
- **Ordenes de compra** que se emiten al proveedor
- **Presupuestos**

Cuando se decida agregar alguno, seguir la **receta de abajo**.

#### Receta para agregar un imprimible nuevo (4 pasos, ZERO infraestructura nueva)

**Paso 1 — Plantilla**
Crear `templates/comprobantes/comprobante_compra.hbs` (o el nombre que corresponda)
clonando `comprobante_venta.hbs` como base. Adaptar:
- Header: datos del proveedor en vez del cliente
- Items: leer de la tabla correspondiente (`comprobante_compra_items`, `recepcion_items`, etc.)
- Totales segun el tipo de doc
- **Mantener el `<script>window.onload = () => window.print();</script>` al final** —
  esto es lo que dispara la impresion en el browser del cliente.

**Paso 2 — Handler en print.controller.js**
Agregar dos funciones nuevas (una para datos JSON, otra para HTML renderizado),
clonando `getDatosComprobante` y `renderizarHTML`. Cambiar:
- Las queries SQL a las tablas correctas (`comprobantes_compra` + items)
- El nombre de la plantilla a cargar (`comprobante_compra.hbs`)
- **SIEMPRE filtrar por id_empresa** (regla del proyecto)

**Paso 3 — Rutas en print.routes.js**
Agregar 2 lineas nuevas en el bloque que ya existe:
```js
router.get('/comprobante-compra/:id/datos', printController.getDatosComprobanteCompra);
router.get('/comprobante-compra/:id/html',  printController.renderizarHTMLCompra);
```

**Paso 4 — Frontend**
En el HTML donde aparece el detalle (ej. `ver-comprobante-compra.html`), agregar
boton + funcion JS de 2 lineas:
```js
function imprimirComprobanteCompra(id) {
    window.open(`${API_URL}/print/comprobante-compra/${id}/html?token=${token}`, '_blank');
}
```
Atajo de teclado opcional (F9 es el convencional para "imprimir lo que veo").

#### Que pasa con print_jobs / printers_config / log_impresiones

Estas tablas existen en BD y `print.routes.js` tiene rutas POST/GET `/jobs` que
las tocan. **Son restos historicos.** El patron actual NO las usa — el flujo va
directo controller -> HTML -> browser, sin pasar por cola. Si en algun momento
hubo intencion de tener cola Puppeteer, se descarto. NO escribir nuevos handlers
que las consuman ni proponer reactivarlas.

Si el toolkit reporta que `print_jobs` tiene jobs en estado PENDING/PROCESSING
viejos, son zombis — se pueden archivar/borrar sin riesgo.

---

### LAGO.AR — CATALOGO PUBLICO (sitio estatico Hostinger)

#### Resumen
Catalogo publico de **11.423 productos** servido como sitio estatico desde
Hostinger Premium (PHP/HTML, sin Node.js). Stack: HTML + CSS + JS vanilla. Todo
lo dinamico vive en `catalogo.json` (~3 MB) generado periodicamente desde la BD
del ERP y subido por FTP.

#### Arquitectura
```
BD postgres -> generar-catalogo-web.js -> catalogo-web/catalogo.json (~3 MB)
                       |
                       v
            lago-deploy.helper.js (orquestador SOLID, 6 funciones)
                       |
            +----------+----------+
            v                     v
   POST /api/lago/deploy   cron 0 6 * * *
   (boton configs.html)    (lago-cron-deploy.js)
                       |
                       v
            lftp -R publico/ + put catalogo.json
                       |
                       v
            Hostinger FTP 82.180.153.72 (u479074151)
            domains/lago.ar/public_html
                       |
                       v
            https://lago.ar -> fetch('catalogo.json') -> render JS
```

#### Source of truth (versionado, NO TOCAR catalogo-web/)
- /root/mi_erp/publico/index.html (256 lineas, estructura semantica)
- /root/mi_erp/publico/css/lago.css (~470 lineas)
- /root/mi_erp/publico/js/lago.js (~1.300 lineas, estado + filtros + render lista/cards/sidebar + carrito)
- /root/mi_erp/publico/corralon.html (pendiente rediseño igual al index)

#### Backend
- **Helper:** src/utils/lago-deploy.helper.js (320L, 6 funciones publicas:
  leerConfigDeploy, generarCatalogoJSON, listarArchivosLocales, subirArchivosFTP,
  registrarDeploy, deployCompleto)
- **Generador:** scripts/generar-catalogo-web.js (404L, lee BD y genera JSON v4)
- **Cron wrapper:** scripts/lago-cron-deploy.js
- **Controller:** src/controllers/lago-deploy.controller.js (3 endpoints REST)
- **Routes:** /api/lago/deploy (POST), /api/lago/deploy/historial (GET),
  /api/lago/deploy/ultimo (GET) — todos con verificarToken

#### Tabla de auditoria lago_deploy_log
```sql
CREATE TABLE lago_deploy_log (
  id              SERIAL PRIMARY KEY,
  id_empresa      INTEGER NOT NULL REFERENCES empresas(id_empresa),
  fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
  id_usuario      INTEGER REFERENCES usuarios(id_usuario),
  tipo            VARCHAR(20) CHECK (tipo IN ('manual','cron','api')),
  estado          VARCHAR(20) CHECK (estado IN ('ok','error','parcial')),
  productos_count INTEGER,
  bytes_subidos   BIGINT,
  duracion_ms     INTEGER,
  archivos        JSONB,
  error_msg       TEXT
);
```
**Tiempo tipico deploy:** 780-990 ms. **Tamaño JSON:** 3.0-3.5 MB.

#### Configuraciones (todas en configuraciones_empresa, id_empresa=1)
Editables desde configuraciones.html -> card "Catalogo web lago.ar". Cero hardcoded.

- **Filtros (que productos entran):** catalogo_web.id_lista_precio, excluir_sin_precio,
  excluir_sin_stock, excluir_categorias, precio_min_valido (filtra $0,83),
  precio_max_valido (filtra bug $638M), marcas_excluir (CSV).
- **UI:** vista_default (lista|cards), permitir_cambiar_vista, sidebar_visible,
  sidebar_categorias_top, mostrar_filtro_marca/precio/conjuntos, productos_por_pagina,
  grid_card_min_mobile/desktop.
- **Card tipografica (sin imagen):** card_sin_imagen_estilo, card_sin_imagen_color_default,
  colores_por_marca (JSON marca->hex). Resuelve el 99% de productos sin foto.
- **Deploy FTP:** lago_deploy.ftp_host (82.180.153.72), ftp_user (u479074151),
  ftp_pass (TODO encriptar), ftp_remote_dir (domains/lago.ar/public_html),
  local_publico_dir (/root/mi_erp/publico), cron_enabled, cron_hora (06:00).
- **Empresa (clave empresa.*):** nombre, whatsapp, telefono, email, direccion,
  horarios, razon_social, cuit, condicion_iva, domicilio_legal, slogan, qr_afip_url.

#### Disparadores del deploy
1. **Manual:** boton "Publicar catalogo web" en configuraciones.html
2. **Cron diario 06:00:** lee lago_deploy.cron_enabled antes de ejecutar
3. **Programatico:** lagoDeploy.deployCompleto({id_empresa:1, tipo:'manual'})

#### Hostinger
- Plan Premium PHP/HTML (sin Node.js), dominio lago.ar
- FTP: 82.180.153.72 user u479074151
- Espacio: 25 GiB total, ~6 MB usado (0.02%)

#### Deudas pendientes
- 🔴 Encriptar lago_deploy.ftp_pass (hoy texto plano en BD)
- 🔴 Limpiar datos sucios en productos/precios (precios $0,83 y $638M se ocultan
  con filtros pero deberian arreglarse en origen)
- 🔴 Vincular variantes via id_producto_padre (solo 9 productos lo tienen)
- 🟠 Refactor SOLID de productos.html/productos.js (2.213L, 67 funciones)
- 🟠 Rediseñar corralon.html con mismo sidebar/vista lista que index
- 🟠 Subir fotos (solo 103/11.889 productos = 0.9% tienen url_imagen)

### CONFIGURACIONES (5 niveles)
1. configuracion_sistema -> Global
2. configuraciones_empresa -> Por empresa (incl. claves AFIP: cuit, env, offline, cert paths, topes CF)
3. configuracion_empresa_extendida -> Extensiones
4. usuario_configuracion -> Por usuario
5. config/plantillas/*.config.json -> Plantillas de impresion (switcheable por tipo doc)

### DATOS SEMILLA (obligatorios — si faltan, modulos se rompen)
- Cliente "Consumidor Final" (venta-rapida obtenerConsumidorFinal)
- pedidoestados: {1..N} incluyendo 99=Recuperado
- factura_tipos: A, B, C
- condicionesiva: 1=Resp.Inscripto, 5=Consumidor Final, etc
- alicuotasiva: 21%, 10.5%, 27%, 0%, Exento
- monedas: 1=ARS, 2=USD
- configuraciones_empresa: claves afip_* (7 claves)

### MIDDLEWARE SERVER.JS (globales)
- compression → GZIP ~70% menos transferencia
- express.json/urlencoded → Body parsing
- html-access.middleware → Control acceso HTML (ANTES de express.static)
- modulo-access.middleware → Control acceso API
- Anti-cache headers para *.html

STATICBLOCK

    # === Seccion 2: Metodos de pago (dinamica desde BD) ===
    echo "" >> "$PROMPT_FILE"
    echo "### METODOS DE PAGO" >> "$PROMPT_FILE"
    echo '```' >> "$PROMPT_FILE"
    if verificar_bd; then
        local existe_mp=""
        existe_mp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='metodosdepago'" 2>/dev/null || true)
        if [ "$existe_mp" = "1" ]; then
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT 'ID ' || id_metodo_pago || ': ' || nombre FROM metodosdepago ORDER BY id_metodo_pago" 2>/dev/null >> "$PROMPT_FILE" || true
        fi
        echo "" >> "$PROMPT_FILE"
        echo "Recargos/Descuentos activos:" >> "$PROMPT_FILE"
        local existe_rfp=""
        existe_rfp=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT 1 FROM information_schema.tables WHERE table_name='recargos_forma_pago'" 2>/dev/null || true)
        if [ "$existe_rfp" = "1" ]; then
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc \
                "SELECT fp.nombre || ': ' || rfp.porcentaje || '%' FROM recargos_forma_pago rfp JOIN formas_pago fp ON rfp.id_forma_pago=fp.id_forma_pago AND rfp.id_empresa=fp.id_empresa WHERE rfp.activo=true AND rfp.porcentaje != 0 ORDER BY fp.nombre" 2>/dev/null >> "$PROMPT_FILE" || true
        fi
    fi
    echo '```' >> "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 3: Helpers ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## HELPERS CENTRALIZADOS" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_helpers_existentes "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 4: Progreso migracion ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## PROGRESO DE MIGRACION" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    calcular_progreso_migracion "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === Seccion 5: Columnas GENERATED ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## COLUMNAS GENERATED ALWAYS (NO escribibles)" >> "$PROMPT_FILE"
    echo '```' >> "$PROMPT_FILE"
    if verificar_bd; then
        psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc \
            "SELECT table_name || '.' || column_name FROM information_schema.columns WHERE table_schema='public' AND is_generated='ALWAYS' ORDER BY table_name;" 2>/dev/null >> "$PROMPT_FILE" || true
    fi
    echo '```' >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"

    # === Seccion 6: Mapeo frontend-backend ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## MAPEO FRONTEND -> BACKEND (auto-detectado)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "| Frontend HTML | JS Frontend | Endpoints API |" >> "$PROMPT_FILE"
    echo "|---------------|-------------|---------------|" >> "$PROMPT_FILE"
    if [ -n "$FRONTEND_DIR" ] && [ -d "$FRONTEND_DIR" ]; then
        while IFS= read -r html_path; do
            [ -z "$html_path" ] && continue
            local html_name; html_name=$(basename "$html_path" .html)
            case "$html_name" in login|index|test-modal|vista-previa|ver-pedido-publico|diagnostico) continue ;; esac
            local js_name="-"
            [ -f "$JS_DIR/${html_name}.js" ] && js_name="${html_name}.js"
            [ -f "$JS_DIR/${html_name}-script.js" ] && js_name="${html_name}-script.js"
            if [ "$js_name" = "-" ] && [ -f "$html_path" ]; then
                local from_html=""
                from_html=$(grep -oE 'src="js/[^"]+\.js"' "$html_path" 2>/dev/null | sed 's/src="js\///; s/"//' | grep -v "config-panel\|common\|utils\|CONFIG\|modal\|auth" | tail -1 || true)
                [ -n "$from_html" ] && [ -f "$JS_DIR/$from_html" ] && js_name="$from_html"
            fi
            local ctrls="-"
            if [ "$js_name" != "-" ] && [ -f "$JS_DIR/$js_name" ]; then
                local eps=""
                eps=$(detectar_endpoints_usados "$JS_DIR/$js_name")
                [ -n "$eps" ] && ctrls="$eps"
            fi
            echo "| ${html_name}.html | $js_name | $ctrls |" >> "$PROMPT_FILE"
        done < <(find "$FRONTEND_DIR" -maxdepth 1 -name "*.html" -type f 2>/dev/null | sort)
    fi
    echo "" >> "$PROMPT_FILE"

    # === Seccion 7: Features especiales ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## FEATURES ESPECIALES (auto-detectadas)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_features_especiales "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === [v38] Seccion 8: Seguridad REMOVIDA - detalle completo en SEGURIDAD_*.md ===

    # === [v37] Seccion 9: Estado Multi-Empresa (dinamica) ===
    echo "---" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    echo "## ESTADO MULTI-EMPRESA (auto-detectado)" >> "$PROMPT_FILE"; echo "" >> "$PROMPT_FILE"
    detectar_estado_multiempresa "$PROMPT_FILE"
    echo "" >> "$PROMPT_FILE"

    # === [v56] Secciones 10/11/12 ELIMINADAS del prompt_maestro ===
    # verificar_auditoria_multiempresa, verificar_datos_semilla y verificar_constraints_triggers
    # ya se ejecutan en SALUD_ARQUITECTONICA.md (paso 3 del informe completo). Tenerlos
    # tambien aca causaba que el INFORME_COMPLETO los muestre 2 veces. Son chequeos de
    # salud, no documentacion estatica para el desarrollador. Quedan solo en SALUD.

    # [v57] Seccion COMANDOS FRECUENTES removida del prompt (es README, no contexto IA).

    echo "---" >> "$PROMPT_FILE"
    echo "*Generado por Toolkit v${VERSION} - $(date '+%Y-%m-%d %H:%M')*" >> "$PROMPT_FILE"

    echo -e "${GREEN}[OK] Prompt Maestro generado: $PROMPT_FILE${NC}"
}


# =======================================================================================
# [v29] INFORME COMPLETO - TODO EN UN SOLO ARCHIVO
# =======================================================================================

informe_completo() {
    local TIMESTAMP
    TIMESTAMP=$(date '+%Y%m%d_%H%M')
    local INFORME="$OUTPUT_DIR/INFORME_COMPLETO_${TIMESTAMP}.md"

    header
    echo -e "  ${GREEN}=== INFORME COMPLETO ===${NC}"
    echo -e "  Genera TODO en un solo archivo:"
    echo -e "  Contexto + Arquitectura + Salud + Seguridad + Integridad + Prompt"
    echo ""

    cargar_credenciales
    explorar_proyecto

    # [v38] Paso 1: Versiones (ya incluidas en CONTEXTO_IA, no se genera PARTE separada)
    echo -e "  ${CYAN}[1/6]${NC} Contexto IA (incluye versiones)..."
    generar_contexto_ia

    # Paso 2: Arquitectura de negocio
    echo -e "  ${CYAN}[2/6]${NC} Arquitectura de negocio..."
    documentar_arquitectura_negocio

    # Paso 3: Salud arquitectónica
    echo -e "  ${CYAN}[3/6]${NC} Salud arquitectonica..."
    generar_informe_salud

    # [v36] Paso 4: Seguridad
    echo -e "  ${CYAN}[4/6]${NC} Seguridad y control de acceso..."
    auditar_seguridad

    # [v58] Paso 5: Integridad referencial (FKs, triggers, indexes, secuencias, views)
    echo -e "  ${CYAN}[5/6]${NC} Integridad referencial..."
    verificar_integridad_referencial

    # Paso 6: Prompt maestro
    echo -e "  ${CYAN}[6/6]${NC} Prompt maestro..."
    prompt_maestro

    # === CONCATENAR TODO EN UN ARCHIVO ===
    echo ""
    echo -e "  ${YELLOW}Unificando resultados...${NC}"

    > "$INFORME"
    cat >> "$INFORME" << HEADER
# INFORME COMPLETO ERP LAGO
## Generado: $(date '+%Y-%m-%d %H:%M') | Toolkit v${VERSION}

---

HEADER

    # [v38] PARTE 1 eliminada: versiones ya están dentro de CONTEXTO_IA

    # Sección 1: Contexto IA (incluye versiones)
    local LATEST_CONTEXTO=""
    LATEST_CONTEXTO=$(ls -t "$OUTPUT_DIR"/CONTEXTO_IA_*.md 2>/dev/null | head -1)
    if [ -n "$LATEST_CONTEXTO" ] && [ -f "$LATEST_CONTEXTO" ]; then
        echo "# PARTE 1: CONTEXTO IA" >> "$INFORME"
        echo "" >> "$INFORME"
        # [v38] Incluir todo excepto las primeras 4 lineas (header del archivo)
        tail -n +5 "$LATEST_CONTEXTO" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 2: Arquitectura de negocio
    local LATEST_ARQ="$OUTPUT_DIR/ARQUITECTURA_NEGOCIO.md"
    if [ -f "$LATEST_ARQ" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 2: ARQUITECTURA DE NEGOCIO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +5 "$LATEST_ARQ" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 3: Salud arquitectónica
    local LATEST_SALUD="$OUTPUT_DIR/SALUD_ARQUITECTONICA.md"
    if [ -f "$LATEST_SALUD" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 3: SALUD ARQUITECTONICA" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +3 "$LATEST_SALUD" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # [v36] Sección 4: Seguridad
    local LATEST_SEC=""
    LATEST_SEC=$(ls -t "$OUTPUT_DIR"/SEGURIDAD_*.md 2>/dev/null | head -1)
    if [ -n "$LATEST_SEC" ] && [ -f "$LATEST_SEC" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 4: SEGURIDAD Y CONTROL DE ACCESO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +5 "$LATEST_SEC" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # [v58] Sección 5: Integridad referencial
    local LATEST_INTEG="$OUTPUT_DIR/INTEGRIDAD_REFERENCIAL.md"
    if [ -f "$LATEST_INTEG" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 5: INTEGRIDAD REFERENCIAL" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +4 "$LATEST_INTEG" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    # Sección 6: Prompt maestro (era PARTE 5 hasta v57.1)
    local LATEST_PROMPT="$OUTPUT_DIR/PROMPT_MAESTRO.md"
    if [ -f "$LATEST_PROMPT" ]; then
        echo "---" >> "$INFORME"
        echo "" >> "$INFORME"
        echo "# PARTE 6: PROMPT MAESTRO" >> "$INFORME"
        echo "" >> "$INFORME"
        tail -n +4 "$LATEST_PROMPT" >> "$INFORME"
        echo "" >> "$INFORME"
    fi

    local LINEAS
    LINEAS=$(wc -l < "$INFORME")

    echo ""
    echo -e "  ${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "  ${GREEN}[OK] INFORME COMPLETO generado${NC}"
    echo -e "  ${GREEN}  Archivo: $INFORME${NC}"
    echo -e "  ${GREEN}  Tamaño:  $LINEAS lineas${NC}"
    echo -e "  ${GREEN}════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${CYAN}Tambien se generaron los archivos individuales:${NC}"
    [ -n "$LATEST_CONTEXTO" ] && echo -e "    - $(basename "$LATEST_CONTEXTO")"
    echo -e "    - ARQUITECTURA_NEGOCIO.md"
    echo -e "    - SALUD_ARQUITECTONICA.md"
    [ -n "$LATEST_SEC" ] && echo -e "    - $(basename "$LATEST_SEC")"
    echo -e "    - INTEGRIDAD_REFERENCIAL.md"
    echo -e "    - PROMPT_MAESTRO.md"
    echo ""

    # Resumen rapido en pantalla
    echo -e "  ${YELLOW}═══ RESUMEN RAPIDO ═══${NC}"
    echo ""
    echo -e "  ${CYAN}HELPERS CENTRALIZADOS:${NC}"
    if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
        local hcount=0
        while IFS= read -r hf; do
            [ -z "$hf" ] && continue
            local hn; hn=$(basename "$hf")
            local hlines; hlines=$(wc -l < "$hf" 2>/dev/null || echo "?")
            local consumers; consumers=$(grep -rl "$(basename "$hf" .js)" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
            echo -e "    ${GREEN}✓${NC} $hn (${hlines}L, ${consumers} consumers)"
            hcount=$((hcount + 1))
        done < <(find "$UTILS_DIR" -name "*.helper.js" -type f 2>/dev/null | sort)
        [ "$hcount" -eq 0 ] && echo -e "    ${RED}(ninguno)${NC}"
    else
        echo -e "    ${RED}(sin directorio utils)${NC}"
    fi
    echo ""
    echo -e "  ${CYAN}MIGRACION - TABLAS CON ESCRITURA DISPERSA:${NC}"
    if [ -d "$CONTROLLERS_DIR" ]; then
        local hay_dispersas=0
        while IFS= read -r linea_disp; do
            [ -z "$linea_disp" ] && continue
            local cnt_d tbl_d
            cnt_d=$(echo "$linea_disp" | awk '{print $1}')
            tbl_d=$(echo "$linea_disp" | awk '{print $2}')
            local arch_d; arch_d=$(grep -rl "INSERT INTO ${tbl_d}\|UPDATE ${tbl_d} SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | wc -l || echo "0")
            [ "$arch_d" -lt 2 ] && continue
            local helper_d=""
            if [ -n "${UTILS_DIR:-}" ] && [ -d "$UTILS_DIR" ]; then
                helper_d=$(grep -rl "INSERT INTO ${tbl_d}\|FROM ${tbl_d}\|UPDATE ${tbl_d}\|INTO ${tbl_d}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
                [ -z "$helper_d" ] && helper_d=$(grep -rwl "${tbl_d}" "$UTILS_DIR" --include="*.helper.js" 2>/dev/null | head -1 || true)
            fi
            if [ -n "$helper_d" ]; then
                echo -e "    ${GREEN}✓${NC} $tbl_d (${cnt_d} writes, ${arch_d} archivos) → $(basename "$helper_d")"
            else
                echo -e "    ${RED}✗${NC} $tbl_d (${cnt_d} writes, ${arch_d} archivos) → ${RED}SIN HELPER${NC}"
            fi
            hay_dispersas=1
        done < <(grep -roh "INSERT INTO [a-z_]*\|UPDATE [a-z_]* SET" "$CONTROLLERS_DIR" --include="*.js" 2>/dev/null | sed 's/INSERT INTO //; s/UPDATE //; s/ SET//' | sort | uniq -c | sort -rn | awk '$1 >= 3' || true)
        [ "$hay_dispersas" -eq 0 ] && echo -e "    ${GREEN}(ninguna tabla con 3+ writes dispersos)${NC}"
    fi
    echo ""
    echo -e "  ${YELLOW}Pega el contenido de INFORME_COMPLETO en Claude para arrancar sesion${NC}"
    echo ""
}

# =======================================================================================
# MENU INTERACTIVO
# =======================================================================================

# =======================================================================================
# [v57] DISPATCHER + MENU GOOGLE-STYLE
# =======================================================================================
# Dispatcher unico: numero, alias o texto libre -> accion. Usado por menu y CLI.
# Cada accion tiene: id numerico, color, label, alias (palabras clave), funcion.
ejecutar_accion() {
    local input="$1"
    local key
    key=$(echo "$input" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g')

    case "$key" in
        # ---- Estrella ----
        1|completo|todo|informe) informe_completo ;;

        # ---- Generar ----
        2|auditar|modulo|audit)
            cargar_credenciales; explorar_proyecto; echo ""
            read -p "  Modulo a auditar: " m; auditar_modulo "$m" ;;
        3|rastrear|tabla|rastreo|trace)
            cargar_credenciales; explorar_proyecto
            # Si vino con argumento extra (ej: "rastrear pagos") usarlo directo
            if [ -n "${2:-}" ]; then rastrear_uso_tabla "$2"
            elif menu_seleccionar_tabla; then rastrear_uso_tabla "$TABLA_SELECCIONADA"; fi ;;
        4|prompt|maestro)
            cargar_credenciales; explorar_proyecto; prompt_maestro ;;
        5|contexto|ctx)
            cargar_credenciales; generar_contexto_ia ;;
        6|arquitectura|arq)
            cargar_credenciales; explorar_proyecto; documentar_arquitectura_negocio ;;
        7|salud|health)
            cargar_credenciales; explorar_proyecto; generar_informe_salud ;;

        # ---- Verificar (chequeos puntuales) ----
        8|seguridad|security|sec)
            cargar_credenciales; explorar_proyecto; auditar_seguridad ;;
        9|multiempresa|multi|me|auditoria-me|auditoriame)
            cargar_credenciales; explorar_proyecto; verificar_auditoria_multiempresa ;;
        10|semilla|seed)
            cargar_credenciales; explorar_proyecto; verificar_datos_semilla ;;
        11|constraints|checks|triggers)
            cargar_credenciales; explorar_proyecto; verificar_constraints_triggers ;;
        12|impresion|impresiones|print)
            cargar_credenciales; explorar_proyecto; verificar_sistema_impresion ;;
        13|lago|lago.ar|catalogo)
            cargar_credenciales; explorar_proyecto; verificar_lago_ar ;;

        # ---- [v58] Verificar (continuacion) ----
        14|integridad|fks|fk|referencial|integ)
            cargar_credenciales; explorar_proyecto; verificar_integridad_referencial ;;

        # ---- Explorar (descubrimiento) ----
        15|helpers|helper)
            cargar_credenciales; explorar_proyecto; echo ""; detectar_helpers_existentes ;;
        16|migracion|migrar|migration)
            cargar_credenciales; explorar_proyecto; echo ""; calcular_progreso_migracion ;;
        17|features|columnas|endpoints)
            cargar_credenciales; explorar_proyecto; echo ""; detectar_features_especiales ;;
        18|modulos|listar|list)
            listar_modulos ;;
        19|tendencia|trend|historico)
            header; cargar_credenciales; inicializar_historia; mostrar_tendencia ;;

        # ---- Sistema ----
        0|q|quit|salir|exit) echo -e "${GREEN}  Hasta luego!${NC}"; exit 0 ;;
        h|help|ayuda|\?) mostrar_ayuda ;;

        # ---- Fuzzy: matching parcial sobre prefijos comunes ----
        *)
            # Intentar match por prefijo
            case "$key" in
                comp*|todo*) ejecutar_accion 1 "$2"; return ;;
                audit*) ejecutar_accion 2 "$2"; return ;;
                rastr*|trac*) ejecutar_accion 3 "$2"; return ;;
                promp*|maest*) ejecutar_accion 4 "$2"; return ;;
                contex*) ejecutar_accion 5 "$2"; return ;;
                arq*|architec*) ejecutar_accion 6 "$2"; return ;;
                salu*|heal*) ejecutar_accion 7 "$2"; return ;;
                segu*|secu*) ejecutar_accion 8 "$2"; return ;;
                mult*) ejecutar_accion 9 "$2"; return ;;
                semi*|seed*) ejecutar_accion 10 "$2"; return ;;
                cons*|check*|trigg*) ejecutar_accion 11 "$2"; return ;;
                impr*|prin*) ejecutar_accion 12 "$2"; return ;;
                lago*|catalo*) ejecutar_accion 13 "$2"; return ;;
                integ*|fk*|referen*) ejecutar_accion 14 "$2"; return ;;
                help*) ejecutar_accion 15 "$2"; return ;;
                migra*) ejecutar_accion 16 "$2"; return ;;
                feat*|colum*|endp*) ejecutar_accion 17 "$2"; return ;;
                modul*|list*) ejecutar_accion 18 "$2"; return ;;
                tend*|tren*|histo*) ejecutar_accion 19 "$2"; return ;;
            esac
            echo -e "${RED}  No encontre: '$input'${NC}"
            echo -e "  ${CYAN}Tip:${NC} escribi parte del nombre (ej: 'impr', 'rastr', 'semi') o el numero"
            sleep 1
            return 1
            ;;
    esac
    return 0
}

menu_principal() {
    while true; do
        header
        # Caja de busqueda al tope (estilo Google)
        echo -e "  ${CYAN}┌──────────────────────────────────────────────────────────┐${NC}"
        echo -e "  ${CYAN}│${NC}  ${YELLOW}Buscar${NC} (escribi numero, nombre o palabra clave)      ${CYAN}│${NC}"
        echo -e "  ${CYAN}└──────────────────────────────────────────────────────────┘${NC}"
        echo ""
        # Estrella
        echo -e "  ${GREEN}★  1${NC}  Informe completo  ${MAGENTA}(contexto + arq + salud + seguridad + prompt)${NC}"
        echo ""
        # Tres columnas semanticas
        echo -e "  ${YELLOW}GENERAR${NC}                ${YELLOW}VERIFICAR${NC}              ${YELLOW}EXPLORAR${NC}"
        echo -e "  ${CYAN} 2${NC} Auditar modulo      ${RED} 8${NC} Seguridad           ${MAGENTA}15${NC} Helpers"
        echo -e "  ${RED} 3${NC} Rastrear tabla      ${YELLOW} 9${NC} Multi-empresa       ${MAGENTA}16${NC} Migracion"
        echo -e "  ${MAGENTA} 4${NC} Prompt maestro     ${GREEN}10${NC} Datos semilla       ${GREEN}17${NC} Features"
        echo -e "  ${CYAN} 5${NC} Contexto IA        ${YELLOW}11${NC} Constraints/triggs  ${CYAN}18${NC} Modulos"
        echo -e "  ${BLUE} 6${NC} Arquitectura       ${CYAN}12${NC} Impresion           ${CYAN}19${NC} Tendencia"
        echo -e "  ${BLUE} 7${NC} Salud arq.         ${GREEN}13${NC} Lago.ar"
        echo -e "                         ${RED}14${NC} Integridad ref. ${MAGENTA}*${NC}"
        echo ""
        echo -e "  ${CYAN}h${NC} ayuda    ${CYAN}q${NC} salir"
        echo ""
        read -p "  > " opcion
        [ -z "$opcion" ] && continue

        # Soporte de "rastrear pagos" -> dispatcher con segundo arg
        local cmd arg
        cmd=$(echo "$opcion" | awk '{print $1}')
        arg=$(echo "$opcion" | awk '{$1=""; print $0}' | sed 's/^ *//')

        if [ -n "$arg" ]; then
            ejecutar_accion "$cmd" "$arg"
        else
            ejecutar_accion "$cmd"
        fi
        echo ""
        read -p "  [Enter para volver]..." _
    done
}

# =======================================================================================
# AYUDA
# =======================================================================================

mostrar_ayuda() {
    cat << 'HELP'
ERP LAGO - Toolkit IA v58.0

Uso: ./toolkit_v58.sh [comando]

SIN ARGUMENTOS = MENU INTERACTIVO

COMANDOS DIRECTOS (para quien ya sabe):
  completo           Genera TODO sin preguntar
  auditar <mod>      Audita un modulo especifico
  rastrear [tabla]   Rastreo cruzado de tabla
  helpers            Muestra helpers en pantalla
  migracion          Muestra progreso migracion en pantalla
  multiempresa       Estado multi-empresa (tablas, constraints, queries sin filtro)
  auditoria-me       Verificar integridad fixes auditoria multi-empresa 2026-03-01
  features           Muestra features especiales (columnas, endpoints, filtros)
  seguridad          Auditoria completa de seguridad y control de acceso
  semilla            Verificar datos semilla obligatorios en BD
  constraints        Verificar CHECK constraints vs triggers (desacoples)
  impresion          [v56] Verificar sistema de impresion (3 caminos by-design)
  lago               [v56] Verificar lago.ar (deploys, configs, cron, archivos)
  integridad         [v58] Verificar integridad referencial (FKs, triggers, idx, secuencias)
  prompt             Solo regenera el Prompt Maestro
  versiones          Solo versiones runtime
  help               Esta ayuda

EJEMPLOS:
  ./toolkit_v58.sh                              # Menu interactivo
  ./toolkit_v58.sh completo                     # Genera TODO directo
  ./toolkit_v58.sh rastrear movimientos_caja    # Rastreo especifico
  ./toolkit_v58.sh impresion                    # Mapeo 3 caminos de impresion
  ./toolkit_v58.sh lago                         # Estado lago.ar
HELP
}

# =======================================================================================
# MAIN
# =======================================================================================

verificar_proyecto

# [v57] CLI delega al dispatcher unificado. Misma logica que el menu interactivo.
case "${1:-}" in
    "") menu_principal ;;
    -h|--help|help) mostrar_ayuda ;;
    menu) menu_principal ;;
    versiones) extraer_versiones_runtime ;;
    multiempresa) cargar_credenciales; explorar_proyecto; detectar_estado_multiempresa ;;
    *) ejecutar_accion "$1" "${2:-}" ;;
esac
