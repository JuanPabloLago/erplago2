#!/usr/bin/env python3
"""
FEATURE: Corregir Forma de Pago post-venta
ERP LAGO — 2026-03-14

Modifica 4 archivos:
1. pagos.helper.js      — nueva función corregirMetodoPago()
2. ventas-consulta.controller.js — nuevo endpoint + obtenerMetodosPago
3. facturas.routes.js   — nuevas rutas PUT + GET
4. facturas-acciones.js — botón en dropdown + modal dinámico

FLUJO:
  Usuario → dropdown "Corregir forma de pago" → modal con select → PUT endpoint
  Backend: cambia método → ajusta caja (egreso viejo + ingreso nuevo) → anula recargos viejos
           → aplica recargo nuevo si corresponde → log en observaciones
"""

import os
import shutil
from datetime import datetime

BASE = '/root/mi_erp'
FILES = {
    'helper': f'{BASE}/src/utils/pagos.helper.js',
    'controller': f'{BASE}/src/controllers/ventas-consulta.controller.js',
    'routes': f'{BASE}/src/routes/facturas.routes.js',
    'frontend': f'{BASE}/frontend/js/facturas-acciones.js',
}

def backup():
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    bkp = f'{BASE}/backups/pre_corregir_fp_{ts}'
    os.makedirs(bkp, exist_ok=True)
    for key, path in FILES.items():
        if os.path.exists(path):
            shutil.copy2(path, bkp)
            print(f'  [OK] Backup {os.path.basename(path)}')
    print(f'  Backup en {bkp}')
    return bkp

# ═══════════════════════════════════════════════════════════════════
# FIX 1: pagos.helper.js — agregar corregirMetodoPago()
# ═══════════════════════════════════════════════════════════════════

HELPER_FUNC = '''

/**
 * ═══════════════════════════════════════════════════════════════════════
 * corregirMetodoPago — Corrige el método de pago post-venta.
 * ═══════════════════════════════════════════════════════════════════════
 * - Cambia id_metodo_pago en pagos
 * - Ajusta caja: egreso del método viejo + ingreso del nuevo
 * - Anula recargos viejos, aplica nuevos si corresponde
 * - Registra auditoría en observaciones
 * - Bloquea cambio desde/hacia CC (eso se hace con NC/ND)
 * - Bloquea si el pedido ya está facturado
 */
async function corregirMetodoPago(client, params) {
    const {
        id_empresa, id_pago, nuevo_id_metodo_pago,
        id_usuario, id_turno = null, motivo = ''
    } = params;

    if (!id_empresa) throw _error('id_empresa es obligatorio', 400);
    if (!id_pago) throw _error('id_pago es obligatorio', 400);
    if (!nuevo_id_metodo_pago) throw _error('nuevo_id_metodo_pago es obligatorio', 400);
    if (!id_usuario) throw _error('id_usuario es obligatorio', 400);

    // 1. Obtener pago actual con validación
    const pagoActual = await obtenerPago(client, id_pago, id_empresa);

    // 2. Validaciones
    if (pagoActual.id_metodo_pago === nuevo_id_metodo_pago) {
        throw _error('El método de pago ya es el seleccionado', 400);
    }
    if (pagoActual.id_metodo_pago === METODO_CUENTA_CORRIENTE || nuevo_id_metodo_pago === METODO_CUENTA_CORRIENTE) {
        throw _error('No se puede corregir desde/hacia Cuenta Corriente. Usá Notas de Crédito/Débito.', 400);
    }
    if (pagoActual.id_pago_estado === PAGO_ESTADOS.REEMBOLSADO || pagoActual.id_pago_estado === PAGO_ESTADOS.RECHAZADO) {
        throw _error(`No se puede corregir un pago ${pagoActual.estado_nombre}`, 400);
    }

    // 3. Verificar que no esté facturado
    const facturaCheck = await client.query(
        "SELECT id_factura FROM facturas WHERE id_pedido = $1 AND id_empresa = $2 AND estado != 'anulada'",
        [pagoActual.id_pedido, id_empresa]
    );
    if (facturaCheck.rows.length > 0) {
        throw _error('No se puede corregir: el pedido ya está facturado', 400);
    }

    const viejo_id_metodo = pagoActual.id_metodo_pago;
    const monto = parseFloat(pagoActual.monto);

    // 4. Obtener nombres de métodos
    const metodosResult = await client.query(
        'SELECT id_metodo_pago, nombre FROM metodosdepago WHERE id_metodo_pago = ANY($1)',
        [[viejo_id_metodo, nuevo_id_metodo_pago]]
    );
    const metodos = new Map(metodosResult.rows.map(r => [r.id_metodo_pago, r.nombre]));
    const nombreViejo = metodos.get(viejo_id_metodo) || 'Desconocido';
    const nombreNuevo = metodos.get(nuevo_id_metodo_pago) || 'Desconocido';

    // 5. Obtener recargo del nuevo método
    let nuevoRecargo = 0;
    try {
        const recargoInfo = await recargosHelper.obtenerRecargo(client, id_empresa, nuevo_id_metodo_pago);
        if (recargoInfo && recargoInfo.porcentaje) {
            nuevoRecargo = parseFloat(recargoInfo.porcentaje);
        }
    } catch (_e) { /* Sin recargo → 0 */ }

    // 6. UPDATE en pagos
    const fechaHora = new Date().toLocaleString('es-AR');
    const obsTexto = ` | CORRECCIÓN FP: ${nombreViejo} → ${nombreNuevo}${motivo ? ' (' + motivo + ')' : ''} — usuario:${id_usuario} ${fechaHora}`;

    await client.query(`
        UPDATE pagos SET
            id_metodo_pago = $1,
            recargo_porcentaje = $2,
            observaciones = COALESCE(observaciones, '') || $3
        WHERE id_pago = $4 AND id_empresa = $5
    `, [nuevo_id_metodo_pago, nuevoRecargo, obsTexto, id_pago, id_empresa]);

    // 7. Ajustar CAJA (si hay turno abierto)
    if (id_turno) {
        const viejoEsReal = METODOS_PAGO_REAL.includes(viejo_id_metodo);
        const nuevoEsReal = METODOS_PAGO_REAL.includes(nuevo_id_metodo_pago);

        // Reversar ingreso del método viejo
        if (viejoEsReal) {
            await cajaHelper.registrarMovimiento(client, {
                id_empresa, id_turno, id_usuario,
                tipo: 'egreso', id_moneda: 1, monto,
                concepto: `CORRECCIÓN FP: reversa ${nombreViejo} | Pago #${id_pago} Ped #${pagoActual.id_pedido}`,
                id_metodo_pago: viejo_id_metodo
            });
        }

        // Registrar ingreso del método nuevo
        if (nuevoEsReal) {
            await cajaHelper.registrarMovimiento(client, {
                id_empresa, id_turno, id_usuario,
                tipo: 'ingreso', id_moneda: 1, monto,
                concepto: `CORRECCIÓN FP: ${nombreViejo} → ${nombreNuevo} | Pago #${id_pago} Ped #${pagoActual.id_pedido}`,
                id_metodo_pago: nuevo_id_metodo_pago
            });
        }
    }

    // 8. Anular recargos viejos (si había)
    try {
        await recargosHelper.anularAjustesPorPedido(client, {
            id_empresa, id_pedido: pagoActual.id_pedido,
            id_usuario, motivo: `Corrección FP pago #${id_pago}: ${nombreViejo} → ${nombreNuevo}`
        });
    } catch (_e) { /* Sin ajustes previos → ok */ }

    // 9. Aplicar recargo nuevo si corresponde
    if (nuevoRecargo !== 0) {
        try {
            await recargosHelper.procesarAjusteFormaPago(client, {
                id_empresa,
                id_pedido: pagoActual.id_pedido,
                id_cliente: pagoActual.id_cliente,
                id_forma_pago: nuevo_id_metodo_pago,
                id_usuario,
                monto_base: monto
            });
        } catch (_e) {
            // Recargo no crítico — se puede aplicar después
        }
    }

    return {
        id_pago,
        id_pedido: pagoActual.id_pedido,
        metodo_anterior: nombreViejo,
        metodo_nuevo: nombreNuevo,
        monto,
        recargo_nuevo: nuevoRecargo
    };
}

'''

def fix_helper(content):
    """Agrega corregirMetodoPago() a pagos.helper.js"""
    
    # Insertar función antes de UTILIDAD INTERNA
    anchor = '// ─── UTILIDAD INTERNA ───'
    if anchor not in content:
        print('[WARN] FIX1a: Anchor no encontrado en pagos.helper.js')
        return content, False
    
    if 'corregirMetodoPago' in content:
        print('[WARN] FIX1: Ya aplicado')
        return content, False
    
    content = content.replace(anchor, HELPER_FUNC + anchor)
    
    # Agregar al exports
    old_export = '    anularPago,\n    obtenerPago,'
    new_export = '    anularPago,\n    corregirMetodoPago,\n    obtenerPago,'
    
    if old_export in content:
        content = content.replace(old_export, new_export)
        print('[OK] FIX1: corregirMetodoPago() agregada a pagos.helper.js + export')
        return content, True
    else:
        print('[WARN] FIX1b: Export anchor no encontrado — agregar manualmente')
        return content, True

# ═══════════════════════════════════════════════════════════════════
# FIX 2: ventas-consulta.controller.js — endpoint corregirMetodoPago
# ═══════════════════════════════════════════════════════════════════

CONTROLLER_FUNCS = '''

/**
 * GET /api/facturas/metodos-pago — Lista métodos de pago disponibles
 */
const obtenerMetodosPago = async (req, res) => {
    try {
        const { id_empresa } = req.usuario;
        const result = await pool.query(
            'SELECT id_metodo_pago, nombre FROM metodosdepago WHERE id_empresa = $1 ORDER BY id_metodo_pago',
            [id_empresa]
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * PUT /api/facturas/corregir-metodo-pago — Corrige forma de pago de un pedido
 */
const corregirMetodoPago = async (req, res) => {
    const client = await pool.connect();
    try {
        const { id_empresa, id_usuario } = req.usuario;
        const { id_pago, nuevo_id_metodo_pago, motivo } = req.body;

        if (!id_pago || !nuevo_id_metodo_pago) {
            return res.status(400).json({ success: false, error: 'id_pago y nuevo_id_metodo_pago son obligatorios' });
        }

        await client.query('BEGIN');

        // Obtener turno abierto (puede no haber)
        const turno = await cajaHelper.obtenerTurnoAbierto(client, id_empresa);

        const resultado = await pagosHelper.corregirMetodoPago(client, {
            id_empresa,
            id_pago: parseInt(id_pago),
            nuevo_id_metodo_pago: parseInt(nuevo_id_metodo_pago),
            id_usuario,
            id_turno: turno ? turno.id_turno : null,
            motivo: motivo || ''
        });

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Forma de pago corregida: ${resultado.metodo_anterior} → ${resultado.metodo_nuevo}`,
            ...resultado
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en corregirMetodoPago:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
};

'''

def fix_controller(content):
    """Agrega endpoints al controller"""
    
    if 'corregirMetodoPago' in content:
        print('[WARN] FIX2: Ya aplicado')
        return content, False
    
    # Insertar funciones antes del module.exports
    old_exports = 'module.exports = { consultarVentas, confirmarRapido, facturarDesdePedido, registrarPago };'
    new_exports = 'module.exports = { consultarVentas, confirmarRapido, facturarDesdePedido, registrarPago, corregirMetodoPago, obtenerMetodosPago };'
    
    if old_exports not in content:
        print('[WARN] FIX2: module.exports anchor no encontrado')
        return content, False
    
    content = content.replace(old_exports, CONTROLLER_FUNCS + new_exports)
    print('[OK] FIX2: corregirMetodoPago + obtenerMetodosPago agregados al controller')
    return content, True

# ═══════════════════════════════════════════════════════════════════
# FIX 3: facturas.routes.js — agregar rutas
# ═══════════════════════════════════════════════════════════════════

ROUTES_NEW = """router.get('/metodos-pago', verificarToken, ventasController.obtenerMetodosPago);
router.put('/corregir-metodo-pago', verificarToken, ventasController.corregirMetodoPago);
// Rutas con :id AL FINAL"""

def fix_routes(content):
    """Agrega rutas al archivo de rutas"""
    
    if 'corregir-metodo-pago' in content:
        print('[WARN] FIX3: Ya aplicado')
        return content, False
    
    anchor = '// Rutas con :id AL FINAL'
    if anchor not in content:
        print('[WARN] FIX3: Anchor no encontrado')
        return content, False
    
    content = content.replace(anchor, ROUTES_NEW)
    print('[OK] FIX3: Rutas metodos-pago + corregir-metodo-pago agregadas')
    return content, True

# ═══════════════════════════════════════════════════════════════════
# FIX 4: facturas-acciones.js — botón dropdown + modal dinámico
# ═══════════════════════════════════════════════════════════════════

DROPDOWN_ITEM = """items += `<li><a class="dropdown-item py-2" href="#" onclick="event.preventDefault(); imprimirTicket(${v.id_pedido})">
        <i class="bi bi-printer me-2 text-dark"></i>Imprimir ticket
    </a></li>`;

    // Corregir forma de pago (solo si tiene pagos reales y no está facturado)
    if (!facturado && (v.tiene_pago_real || v.tiene_pago)) {
        items += `<li><a class="dropdown-item py-2" href="#" onclick="event.preventDefault(); corregirFormaPago(${v.id_pedido})">
            <i class="bi bi-arrow-left-right me-2 text-info"></i>Corregir forma de pago
        </a></li>`;
    }"""

MODAL_FUNCTION = '''

// ════════════════════════════════════════
// CORREGIR FORMA DE PAGO
// ════════════════════════════════════════
async function corregirFormaPago(idPedido) {
    try {
        // Fetch detalle del pedido + métodos disponibles en paralelo
        const [detResp, metodosResp] = await Promise.all([
            fetch(`${API_URL}/pedidos/${idPedido}/detalle`, { headers: { 'Authorization': `Bearer ${TOKEN}` } }),
            fetch(`${API_URL}/facturas/metodos-pago`, { headers: { 'Authorization': `Bearer ${TOKEN}` } })
        ]);

        if (!detResp.ok) throw new Error('Error al cargar detalle del pedido');
        if (!metodosResp.ok) throw new Error('Error al cargar métodos de pago');

        const pedido = await detResp.json();
        const metodos = await metodosResp.json();

        const pagos = (pedido.pagos || []).filter(p => p.id_metodo_pago !== 6);
        if (pagos.length === 0) return alert('Este pedido no tiene pagos reales para corregir');

        // Crear modal dinámico
        const modalId = 'modalCorregirFP';
        const existing = document.getElementById(modalId);
        if (existing) existing.remove();

        const pagosHTML = pagos.map(pg => {
            const opcionesMetodo = metodos
                .filter(m => m.id_metodo_pago !== 6 && m.id_metodo_pago !== pg.id_metodo_pago)
                .map(m => `<option value="${m.id_metodo_pago}">${m.nombre}</option>`)
                .join('');

            return `<div class="pago-correccion mb-3 p-3 border rounded" data-id-pago="${pg.id_pago}">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span><strong>Pago #${pg.id_pago}</strong> — $${formatearMoneda(pg.monto)}</span>
                    <span class="badge bg-secondary">${pg.metodo_nombre}</span>
                </div>
                <div class="d-flex align-items-center gap-3">
                    <div class="text-center flex-fill">
                        <span class="badge bg-warning text-dark px-3 py-2">${pg.metodo_nombre}</span>
                    </div>
                    <div class="text-center"><i class="bi bi-arrow-right fs-4 text-muted"></i></div>
                    <div class="flex-fill">
                        <select class="form-select form-select-sm select-nuevo-metodo">
                            <option value="">— Seleccionar —</option>
                            ${opcionesMetodo}
                        </select>
                    </div>
                </div>
            </div>`;
        }).join('');

        const modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'modal fade';
        modal.tabIndex = -1;
        modal.innerHTML = `<div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header" style="background:var(--lago-primary, #1a5f7a);color:#fff">
                    <h5 class="modal-title"><i class="bi bi-arrow-left-right me-2"></i>Corregir Forma de Pago — Pedido #${idPedido}</h5>
                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info py-2 mb-3">
                        <i class="bi bi-info-circle me-1"></i>
                        Esto corrige el método de pago y ajusta los movimientos de caja automáticamente.
                    </div>
                    <div class="mb-3">
                        <label class="form-label fw-bold">Motivo de corrección</label>
                        <input type="text" class="form-control" id="motivoCorreccionFP"
                               placeholder="Ej: El cajero se equivocó de método" required>
                    </div>
                    <label class="form-label fw-bold">Pagos a corregir</label>
                    ${pagosHTML}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
                    <button class="btn btn-primary" id="btnConfirmarCorreccionFP">
                        <i class="bi bi-check-lg me-1"></i>Confirmar corrección
                    </button>
                </div>
            </div>
        </div>`;

        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);

        document.getElementById('btnConfirmarCorreccionFP').onclick = async () => {
            const motivo = document.getElementById('motivoCorreccionFP').value.trim();
            if (!motivo) return alert('Ingresá el motivo de la corrección');

            const correcciones = [];
            modal.querySelectorAll('.pago-correccion').forEach(el => {
                const idPago = parseInt(el.dataset.idPago);
                const select = el.querySelector('.select-nuevo-metodo');
                const nuevoMetodo = parseInt(select.value);
                if (nuevoMetodo) correcciones.push({ id_pago: idPago, nuevo_id_metodo_pago: nuevoMetodo });
            });

            if (correcciones.length === 0) return alert('Seleccioná el nuevo método de pago');

            const btn = document.getElementById('btnConfirmarCorreccionFP');
            btn.disabled = true;
            btn.innerHTML = '<div class="spinner-border spinner-border-sm me-1"></div> Corrigiendo...';

            try {
                for (const corr of correcciones) {
                    const resp = await fetch(`${API_URL}/facturas/corregir-metodo-pago`, {
                        method: 'PUT',
                        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id_pago: corr.id_pago,
                            nuevo_id_metodo_pago: corr.nuevo_id_metodo_pago,
                            motivo
                        })
                    });
                    const data = await resp.json();
                    if (!resp.ok) throw new Error(data.error || 'Error al corregir');
                    mostrarToast('success', `Pago #${corr.id_pago}: ${data.metodo_anterior} → ${data.metodo_nuevo}`);
                }

                bsModal.hide();
                if (typeof buscarPedidos === 'function') buscarPedidos();

            } catch (error) {
                alert('Error: ' + error.message);
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Confirmar corrección';
            }
        };

        modal.addEventListener('hidden.bs.modal', () => modal.remove());
        bsModal.show();

    } catch (error) {
        alert('Error: ' + error.message);
    }
}
'''

def fix_frontend(content):
    """Agrega botón en dropdown + función modal"""
    
    if 'corregirFormaPago' in content:
        print('[WARN] FIX4: Ya aplicado')
        return content, False
    
    # FIX4a: Agregar item al dropdown (después de imprimirTicket)
    old_dropdown = '''items += `<li><a class="dropdown-item py-2" href="#" onclick="event.preventDefault(); imprimirTicket(${v.id_pedido})">
        <i class="bi bi-printer me-2 text-dark"></i>Imprimir ticket
    </a></li>`;

    if (facturado && v.id_factura) {'''
    
    new_dropdown = DROPDOWN_ITEM + '''

    if (facturado && v.id_factura) {'''
    
    if old_dropdown not in content:
        print('[WARN] FIX4a: Dropdown anchor no encontrado')
        return content, False
    
    content = content.replace(old_dropdown, new_dropdown, 1)
    
    # FIX4b: Agregar función modal al final
    content += MODAL_FUNCTION
    
    print('[OK] FIX4: Botón dropdown + modal corregirFormaPago() agregados')
    return content, True

# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    print('=' * 60)
    print('FEATURE: Corregir Forma de Pago post-venta')
    print('=' * 60)
    
    # Verificar archivos
    for key, path in FILES.items():
        if not os.path.exists(path):
            print(f'[ERROR] No existe {path}')
            return
    
    # Backup
    print('\n--- BACKUP ---')
    backup()
    
    applied = []
    
    # FIX 1: pagos.helper.js
    print('\n--- FIX 1: pagos.helper.js ---')
    with open(FILES['helper'], 'r') as f:
        content = f.read()
    content, ok = fix_helper(content)
    if ok:
        with open(FILES['helper'], 'w') as f:
            f.write(content)
        applied.append('FIX1-helper')
    
    # FIX 2: ventas-consulta.controller.js
    print('\n--- FIX 2: ventas-consulta.controller.js ---')
    with open(FILES['controller'], 'r') as f:
        content = f.read()
    content, ok = fix_controller(content)
    if ok:
        with open(FILES['controller'], 'w') as f:
            f.write(content)
        applied.append('FIX2-controller')
    
    # FIX 3: facturas.routes.js
    print('\n--- FIX 3: facturas.routes.js ---')
    with open(FILES['routes'], 'r') as f:
        content = f.read()
    content, ok = fix_routes(content)
    if ok:
        with open(FILES['routes'], 'w') as f:
            f.write(content)
        applied.append('FIX3-routes')
    
    # FIX 4: facturas-acciones.js
    print('\n--- FIX 4: facturas-acciones.js ---')
    with open(FILES['frontend'], 'r') as f:
        content = f.read()
    content, ok = fix_frontend(content)
    if ok:
        with open(FILES['frontend'], 'w') as f:
            f.write(content)
        applied.append('FIX4-frontend')
    
    # Resumen
    print('\n' + '=' * 60)
    if applied:
        print(f'[OK] Aplicados: {", ".join(applied)}')
        print('\nSiguientes pasos:')
        print('  source ~/.nvm/nvm.sh')
        print('  node --check /root/mi_erp/src/utils/pagos.helper.js')
        print('  node --check /root/mi_erp/src/controllers/ventas-consulta.controller.js')
        print('  pm2 restart erplago')
        print('  # Probar: Facturación → menú ⋮ de un pedido → Corregir forma de pago')
    else:
        print('[INFO] No se aplicaron cambios')

if __name__ == '__main__':
    main()
