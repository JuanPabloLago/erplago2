#!/usr/bin/env python3
"""
PATCH: Filtro de pedidos cancelados en módulo de facturación
ERP LAGO - 2026-03-19

Archivos modificados:
  1. /root/mi_erp/src/controllers/ventas-consulta.controller.js
  2. /root/mi_erp/frontend/js/facturas.js

Ejecutar:  python3 patch_cancelados_filter.py
Rollback:  Los backups quedan en /root/mi_erp/backups/pre_cancelados_filter_*/
"""

import sys
import os
import shutil
from datetime import datetime

BACKUP_DIR = "/root/mi_erp/backups/pre_cancelados_filter_" + datetime.now().strftime('%Y%m%d_%H%M%S')

FILES = {
    'backend': '/root/mi_erp/src/controllers/ventas-consulta.controller.js',
    'frontend_js': '/root/mi_erp/frontend/js/facturas.js',
}


def backup_files():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    for key, path in FILES.items():
        if os.path.exists(path):
            dest = os.path.join(BACKUP_DIR, os.path.basename(path))
            shutil.copy2(path, dest)
            print("  [BACKUP] " + path + " -> " + dest)
    print("  Backup en: " + BACKUP_DIR)


def safe_replace(code, old, new, label, count=1):
    if old not in code:
        print("  [SKIP] " + label + ": patron no encontrado (ya aplicado?)")
        return code, False
    result = code.replace(old, new, count)
    print("  [OK] " + label)
    return result, True


def patch_backend():
    path = FILES['backend']
    with open(path, 'r') as f:
        code = f.read()

    cambios = 0

    # --- CAMBIO 1: Agregar incluir_cancelados al destructuring ---
    code, ok = safe_replace(code,
        "limit = 100, offset = 0 } = req.query;",
        "limit = 100, offset = 0, incluir_cancelados } = req.query;",
        "Destructuring: +incluir_cancelados"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 2: Insertar variable estadosExcluidos ---
    anchor = "limit = 100, offset = 0, incluir_cancelados } = req.query;"
    if anchor in code and "estadosExcluidos" not in code:
        insert = ("\n\n        // Cancelados: excluidos por defecto, incluidos con toggle\n"
                  "        const estadosExcluidos = incluir_cancelados === '1' ? '(0, 8)' : '(0, 7, 8)';")
        code = code.replace(anchor, anchor + insert, 1)
        print("  [OK] Variable estadosExcluidos insertada")
        cambios += 1
    elif "estadosExcluidos" in code:
        print("  [SKIP] estadosExcluidos ya existe")

    # --- CAMBIO 3: Reemplazar NOT IN (0, 7, 8) en TODAS las queries ---
    n = code.count("NOT IN (0, 7, 8)")
    if n > 0:
        code = code.replace("NOT IN (0, 7, 8)", "NOT IN ${estadosExcluidos}")
        print("  [OK] " + str(n) + "x NOT IN (0, 7, 8) -> NOT IN ${estadosExcluidos}")
        cambios += 1

    # --- CAMBIO 4: Insertar query de conteo de cancelados ---
    if "canceladosCountQuery" not in code:
        old_anchor = "        let resumen = {};"
        # La query sigue el mismo patrón de interpolación de fechas que ya usa el código
        cancelados_query_js = (
            "        // Conteo de cancelados (siempre, para badge del frontend)\n"
            "        const canceladosCountQuery = await pool.query(\n"
            "            `SELECT COUNT(*) as cancelados FROM pedidos WHERE id_empresa = $1 AND id_estado = 7"
            " ${fecha_desde ? `AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date >= '${fecha_desde}'::date` : ''}"
            " ${fecha_hasta ? `AND (fecha_creacion AT TIME ZONE 'America/Argentina/Buenos_Aires')::date <= '${fecha_hasta}'::date` : ''}`,\n"
            "            [id_empresa]\n"
            "        );\n"
            "        const totalCancelados = parseInt(canceladosCountQuery.rows[0].cancelados) || 0;\n"
            "\n"
            "        let resumen = {};"
        )
        code = code.replace(old_anchor, cancelados_query_js, 1)
        print("  [OK] Query de conteo de cancelados insertada")
        cambios += 1

    # --- CAMBIO 5: Mergear cancelados en respuesta JSON ---
    old_resp = "res.json({ success: true, ventas: result.rows, total: result.rowCount, contadores: contadoresResult.rows[0] || {}, resumen });"
    new_resp = ("const contadoresData = contadoresResult.rows[0] || {};\n"
                "        contadoresData.cancelados = totalCancelados;\n"
                "        res.json({ success: true, ventas: result.rows, total: result.rowCount, contadores: contadoresData, resumen });")

    if "contadoresData" not in code:
        code, ok = safe_replace(code, old_resp, new_resp, "Respuesta JSON: +cancelados en contadores")
        if ok:
            cambios += 1

    # Guardar
    if cambios > 0:
        with open(path, 'w') as f:
            f.write(code)
        print("  -> " + os.path.basename(path) + " — " + str(cambios) + " cambios aplicados")
    else:
        print("  -> Sin cambios en " + os.path.basename(path))

    return cambios


def patch_frontend_js():
    path = FILES['frontend_js']
    with open(path, 'r') as f:
        code = f.read()

    cambios = 0

    # --- CAMBIO 1: Estado global ---
    code, ok = safe_replace(code,
        "let resumenDia = {};",
        "let resumenDia = {};\nlet incluirCancelados = false;",
        "Estado global: +incluirCancelados"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 2: Param en buscarPedidos ---
    code, ok = safe_replace(code,
        "    params.append('limit', '500');",
        "    if (incluirCancelados) params.append('incluir_cancelados', '1');\n    params.append('limit', '500');",
        "buscarPedidos: +param incluir_cancelados"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 3: Reescribir renderizarContadores ---
    old_fn = (
        "function renderizarContadores(c) {\n"
        "    const container = document.getElementById('contadoresBadges');\n"
        "    const badges = [\n"
        "        { key: 'todos', label: 'Todos', color: 'dark', filtro: 'todos' },\n"
        "        { key: 'sin_pago', label: 'Sin pago', color: 'secondary', filtro: 'sin_pago' },\n"
        "        { key: 'pendiente_confirmar', label: 'Pend. confirmar', color: 'warning', filtro: 'pendiente_confirmar' },\n"
        "        { key: 'confirmado', label: 'Confirmados', color: 'success', filtro: 'confirmado' },\n"
        "        { key: 'fiado', label: 'Fiado', color: 'danger', filtro: 'fiado' },\n"
        "        { key: 'parcial', label: 'Parcial', color: 'info', filtro: 'parcial' },\n"
        "        { key: 'facturado', label: 'Facturado', color: 'primary', filtro: 'facturado' }\n"
        "    ];\n"
        "\n"
        "    container.innerHTML = badges.map(b => `\n"
        "        <button class=\"btn btn-sm btn-outline-${b.color} ${document.getElementById('filtroEstado').value === b.filtro ? 'active' : ''}\"\n"
        "                onclick=\"filtrarPorEstado('${b.filtro}')\">\n"
        "            ${b.label} <span class=\"badge bg-${b.color}\">${c[b.key] || 0}</span>\n"
        "        </button>\n"
        "    `).join('');\n"
        "}"
    )

    new_fn = (
        "function renderizarContadores(c) {\n"
        "    const container = document.getElementById('contadoresBadges');\n"
        "    const badges = [\n"
        "        { key: 'todos', label: 'Todos', color: 'dark', filtro: 'todos' },\n"
        "        { key: 'sin_pago', label: 'Sin pago', color: 'secondary', filtro: 'sin_pago' },\n"
        "        { key: 'pendiente_confirmar', label: 'Pend. confirmar', color: 'warning', filtro: 'pendiente_confirmar' },\n"
        "        { key: 'confirmado', label: 'Confirmados', color: 'success', filtro: 'confirmado' },\n"
        "        { key: 'fiado', label: 'Fiado', color: 'danger', filtro: 'fiado' },\n"
        "        { key: 'parcial', label: 'Parcial', color: 'info', filtro: 'parcial' },\n"
        "        { key: 'facturado', label: 'Facturado', color: 'primary', filtro: 'facturado' }\n"
        "    ];\n"
        "\n"
        "    const badgesHTML = badges.map(b => `\n"
        "        <button class=\"btn btn-sm btn-outline-${b.color} ${document.getElementById('filtroEstado').value === b.filtro ? 'active' : ''}\"\n"
        "                onclick=\"filtrarPorEstado('${b.filtro}')\">\n"
        "            ${b.label} <span class=\"badge bg-${b.color}\">${c[b.key] || 0}</span>\n"
        "        </button>\n"
        "    `).join('');\n"
        "\n"
        "    // Toggle de cancelados: siempre visible si hay cancelados en el rango\n"
        "    const cantCancelados = parseInt(c.cancelados) || 0;\n"
        "    const canceladosHTML = cantCancelados > 0 ? `\n"
        "        <span class=\"ms-2 border-start ps-2 d-inline-flex align-items-center gap-1\">\n"
        "            <div class=\"form-check form-switch mb-0 d-inline-flex align-items-center\">\n"
        "                <input class=\"form-check-input\" type=\"checkbox\" id=\"toggleCancelados\"\n"
        "                       ${incluirCancelados ? 'checked' : ''}\n"
        "                       onchange=\"toggleIncluirCancelados(this.checked)\"\n"
        "                       style=\"cursor:pointer;\">\n"
        "                <label class=\"form-check-label small ms-1\" for=\"toggleCancelados\" style=\"cursor:pointer;\">\n"
        "                    Incluir cancelados <span class=\"badge bg-danger\">${cantCancelados}</span>\n"
        "                </label>\n"
        "            </div>\n"
        "        </span>\n"
        "    ` : '';\n"
        "\n"
        "    container.innerHTML = badgesHTML + canceladosHTML;\n"
        "}"
    )

    code, ok = safe_replace(code, old_fn, new_fn, "renderizarContadores: +badge cancelados + toggle")
    if ok:
        cambios += 1

    # --- CAMBIO 4: Agregar función toggleIncluirCancelados ---
    old_filtrar = ("function filtrarPorEstado(estado) {\n"
                   "    document.getElementById('filtroEstado').value = estado;\n"
                   "    pedidosSeleccionados.clear();\n"
                   "    buscarPedidos();\n"
                   "}")

    new_filtrar = ("function filtrarPorEstado(estado) {\n"
                   "    document.getElementById('filtroEstado').value = estado;\n"
                   "    pedidosSeleccionados.clear();\n"
                   "    buscarPedidos();\n"
                   "}\n"
                   "\n"
                   "function toggleIncluirCancelados(checked) {\n"
                   "    incluirCancelados = checked;\n"
                   "    pedidosSeleccionados.clear();\n"
                   "    buscarPedidos();\n"
                   "}")

    code, ok = safe_replace(code, old_filtrar, new_filtrar, "toggleIncluirCancelados: nueva funcion")
    if ok:
        cambios += 1

    # --- CAMBIO 5: Variable esCancelado + deshabilitado ---
    code, ok = safe_replace(code,
        "        const deshabilitado = yaPresupuestado; // Facturados seleccionables para confirmar pagos",
        "        const esCancelado = v.id_estado === 7;\n        const deshabilitado = yaPresupuestado || esCancelado; // Cancelados y presupuestados NO seleccionables",
        "renderizarPedidos: +esCancelado"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 6: Clase CSS para filas canceladas ---
    code, ok = safe_replace(code,
        """            <tr class="${yaFacturado ? 'table-light text-muted' : ''}""",
        """            <tr class="${esCancelado ? 'table-danger bg-opacity-25' : yaFacturado ? 'table-light text-muted' : ''}""",
        "renderizarPedidos: +estilo fila cancelada"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 7: Badge CANCELADO en columna estado ---
    code, ok = safe_replace(code,
        "                <td>${renderBadgeEstado(v.estado_pago, v)}</td>",
        "                <td>${esCancelado ? '<span class=\"badge bg-danger\"><i class=\"bi bi-x-circle\"></i> Cancelado</span>' : renderBadgeEstado(v.estado_pago, v)}</td>",
        "renderizarPedidos: +badge Cancelado"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 8: toggleSelectAll excluye cancelados ---
    code, ok = safe_replace(code,
        "        if (!v.facturado && !v.presupuestado) {",
        "        if (!v.facturado && !v.presupuestado && v.id_estado !== 7) {",
        "toggleSelectAll: excluir cancelados"
    )
    if ok:
        cambios += 1

    # --- CAMBIO 9: actualizarBarraAcciones excluye cancelados ---
    code, ok = safe_replace(code,
        "    pedidosCargados.forEach(v => {\n"
        "        if (pedidosSeleccionados.has(v.id_pedido)) {\n"
        "            totalSeleccionado += parseFloat(v.total_final) || 0;\n"
        "        }\n"
        "    });",
        "    pedidosCargados.forEach(v => {\n"
        "        if (pedidosSeleccionados.has(v.id_pedido) && v.id_estado !== 7) {\n"
        "            totalSeleccionado += parseFloat(v.total_final) || 0;\n"
        "        }\n"
        "    });",
        "actualizarBarraAcciones: cancelados no suman"
    )
    if ok:
        cambios += 1

    # Guardar
    if cambios > 0:
        with open(path, 'w') as f:
            f.write(code)
        print("  -> " + os.path.basename(path) + " — " + str(cambios) + " cambios aplicados")
    else:
        print("  -> Sin cambios en " + os.path.basename(path))

    return cambios


def main():
    print("=" * 60)
    print("PATCH: Filtro de pedidos cancelados - ERP LAGO")
    print("=" * 60)

    for key, path in FILES.items():
        if not os.path.exists(path):
            print("\nERROR: No se encuentra " + path)
            sys.exit(1)
    print("\nArchivos verificados OK")

    print("\nCreando backup...")
    backup_files()

    print("\nBackend: ventas-consulta.controller.js")
    c1 = patch_backend()

    print("\nFrontend: facturas.js")
    c2 = patch_frontend_js()

    total = c1 + c2
    print("\n" + "=" * 60)
    if total > 0:
        print("PATCH COMPLETADO — " + str(total) + " cambios totales")
        print("\nProximos pasos:")
        print("  1. source ~/.nvm/nvm.sh && pm2 restart erplago")
        print("  2. Abrir facturas.html y verificar el toggle")
        print("  3. Rollback: " + BACKUP_DIR)
    else:
        print("Sin cambios — patch ya aplicado")
    print("=" * 60)


if __name__ == '__main__':
    main()
