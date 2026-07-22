/**
 * CONFIG EMPRESA + AFIP - ERP LAGO
 * Secciones de configuraciones.html
 * @date 2026-02-28
 */
const configEmpresaAFIP = (function() {
    const API = (window.CONFIG && window.CONFIG.API_BASE_URL)
        ? window.CONFIG.API_BASE_URL
        : window.location.protocol + '//' + window.location.hostname + ':3000/api';

    function headers() {
        return {
            'Authorization': 'Bearer ' + localStorage.getItem('authToken'),
            'Content-Type': 'application/json'
        };
    }

    // ============================
    // EMPRESA
    // ============================
    async function cargarEmpresa() {
        try {
            var resp = await fetch(API + '/configuraciones/empresa', { headers: headers() });
            if (!resp.ok) throw new Error('Error ' + resp.status);
            var data = await resp.json();
            var e = data.empresa;

            document.getElementById('emp_razon_social').value = e.razon_social || '';
            document.getElementById('emp_nombre_fantasia').value = e.nombre_fantasia || '';
            document.getElementById('emp_cuit').value = e.cuit || '';
            document.getElementById('emp_domicilio').value = e.domicilio_fiscal || '';
            document.getElementById('emp_telefono').value = e.telefono || '';
            document.getElementById('emp_email').value = e.email || '';
            document.getElementById('emp_ingresos_brutos').value = e.ingresos_brutos || '';
            document.getElementById('emp_fecha_inicio').value = e.fecha_inicio_actividades || '';

            // Condicion IVA select
            var sel = document.getElementById('emp_condicion_iva');
            sel.innerHTML = '';
            data.condiciones_iva.forEach(function(ci) {
                var opt = document.createElement('option');
                opt.value = ci.id_condicion_iva;
                opt.textContent = ci.nombre;
                if (ci.id_condicion_iva === e.id_condicion_iva) opt.selected = true;
                sel.appendChild(opt);
            });

            document.getElementById('emp_status').className = 'd-none';
        } catch (err) {
            mostrarStatus('emp_status', 'danger', 'Error al cargar: ' + err.message);
        }
    }

    async function guardarEmpresa() {
        var btn = document.getElementById('btn_guardar_empresa');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Guardando...';
        try {
            var body = {
                razon_social: document.getElementById('emp_razon_social').value.trim(),
                nombre_fantasia: document.getElementById('emp_nombre_fantasia').value.trim(),
                cuit: document.getElementById('emp_cuit').value.trim(),
                domicilio_fiscal: document.getElementById('emp_domicilio').value.trim(),
                telefono: document.getElementById('emp_telefono').value.trim(),
                email: document.getElementById('emp_email').value.trim(),
                ingresos_brutos: document.getElementById('emp_ingresos_brutos').value.trim(),
                id_condicion_iva: parseInt(document.getElementById('emp_condicion_iva').value),
                fecha_inicio_actividades: document.getElementById('emp_fecha_inicio').value || null
            };
            if (!body.razon_social || !body.cuit) {
                mostrarStatus('emp_status', 'warning', 'Razon social y CUIT son obligatorios');
                return;
            }
            var resp = await fetch(API + '/configuraciones/empresa', {
                method: 'PUT', headers: headers(), body: JSON.stringify(body)
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Error');
            mostrarStatus('emp_status', 'success', '<i class="bi bi-check-circle"></i> Datos de empresa actualizados correctamente');
        } catch (err) {
            mostrarStatus('emp_status', 'danger', '<i class="bi bi-x-circle"></i> ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-floppy"></i> Guardar Cambios';
        }
    }

    // ============================
    // AFIP
    // ============================
    async function cargarAFIP() {
        try {
            var resp = await fetch(API + '/configuraciones/afip', { headers: headers() });
            if (!resp.ok) throw new Error('Error ' + resp.status);
            var data = await resp.json();
            var c = data.config;

            document.getElementById('afip_cuit').value = c.afip_cuit || '';
            document.getElementById('afip_cert_path').value = c.afip_cert_path || '';
            document.getElementById('afip_key_path').value = c.afip_key_path || '';
            document.getElementById('afip_tope_efectivo').value = c.afip_tope_cf_efectivo || '116046';
            document.getElementById('afip_pv_default').value = c.afip_punto_venta_default || '';
            document.getElementById('afip_tope_otros').value = c.afip_tope_cf_otros || '116046';

            // Entorno
            var selEnv = document.getElementById('afip_env');
            selEnv.value = c.afip_env || 'homo';

            // Offline
            var chkOff = document.getElementById('afip_offline');
            chkOff.checked = (c.afip_offline === 'true');
            actualizarLabelOffline();

            // Puntos de venta
            var pvContainer = document.getElementById('afip_pv_list');
            pvContainer.innerHTML = '';
            if (data.depositos && data.depositos.length > 0) {
                data.depositos.forEach(function(d) {
                    var badge = d.punto_venta_afip
                        ? '<span class="badge bg-success">PV ' + d.punto_venta_afip + '</span>'
                        : '<span class="badge bg-warning text-dark">Sin PV</span>';
                    var principal = d.es_principal ? ' <span class="badge bg-info">Principal</span>' : '';
                    pvContainer.innerHTML += '<div class="d-flex justify-content-between align-items-center border-bottom py-2">' +
                        '<span>' + d.nombre + principal + '</span>' + badge + '</div>';
                });
            } else {
                pvContainer.innerHTML = '<p class="text-muted mb-0">No hay depositos configurados</p>';
            }

            document.getElementById('afip_status').className = 'd-none';
        } catch (err) {
            mostrarStatus('afip_status', 'danger', 'Error al cargar: ' + err.message);
        }
    }

    function actualizarLabelOffline() {
        var chk = document.getElementById('afip_offline');
        var lbl = document.getElementById('afip_offline_label');
        if (chk.checked) {
            lbl.innerHTML = '<span class="text-warning fw-bold"><i class="bi bi-wifi-off"></i> OFFLINE</span> (CAE internos, NO validos fiscalmente)';
        } else {
            lbl.innerHTML = '<span class="text-success fw-bold"><i class="bi bi-wifi"></i> ONLINE</span> (Conectado a AFIP)';
        }
    }

    async function guardarAFIP() {
        var btn = document.getElementById('btn_guardar_afip');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Guardando...';
        try {
            var body = {
                afip_cuit: document.getElementById('afip_cuit').value.trim(),
                afip_cert_path: document.getElementById('afip_cert_path').value.trim(),
                afip_key_path: document.getElementById('afip_key_path').value.trim(),
                afip_env: document.getElementById('afip_env').value,
                afip_offline: document.getElementById('afip_offline').checked ? 'true' : 'false',
                afip_tope_cf_efectivo: document.getElementById('afip_tope_efectivo').value,
                afip_tope_cf_otros: document.getElementById('afip_tope_otros').value,
                afip_punto_venta_default: document.getElementById('afip_pv_default').value || '6'
            };
            var resp = await fetch(API + '/configuraciones/afip', {
                method: 'PUT', headers: headers(), body: JSON.stringify(body)
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Error');
            mostrarStatus('afip_status', 'success', '<i class="bi bi-check-circle"></i> Configuracion AFIP actualizada');
        } catch (err) {
            mostrarStatus('afip_status', 'danger', '<i class="bi bi-x-circle"></i> ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-floppy"></i> Guardar AFIP';
        }
    }

    async function testAFIP() {
        var btn = document.getElementById('btn_test_afip');
        var container = document.getElementById('afip_test_result');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Probando conexion...';
        container.innerHTML = '<div class="alert alert-info"><i class="bi bi-hourglass-split"></i> Conectando con AFIP...</div>';
        container.className = '';

        try {
            var resp = await fetch(API + '/configuraciones/afip/test', {
                method: 'POST', headers: headers()
            });
            var data = await resp.json();
            var r = data.resultado;
            var html = '';

            if (data.success) {
                html += '<div class="alert alert-success mb-2"><i class="bi bi-check-circle-fill"></i> <strong>' + data.message + '</strong></div>';
            } else {
                html += '<div class="alert alert-danger mb-2"><i class="bi bi-x-circle-fill"></i> <strong>' + (data.error || 'Error') + '</strong></div>';
            }

            html += '<table class="table table-sm table-bordered mb-0">';
            html += '<tr><td><strong>Entorno</strong></td><td>' + (r.env === 'prod' ? '<span class="badge bg-danger">PRODUCCION</span>' : '<span class="badge bg-warning">HOMOLOGACION</span>') + '</td></tr>';
            html += '<tr><td><strong>CUIT</strong></td><td>' + (r.cuit || 'No configurado') + '</td></tr>';
            html += '<tr><td><strong>Certificado</strong></td><td>' + (r.cert_existe ? '<i class="bi bi-check text-success"></i> Existe' : '<i class="bi bi-x text-danger"></i> No encontrado') + '</td></tr>';
            html += '<tr><td><strong>Clave privada</strong></td><td>' + (r.key_existe ? '<i class="bi bi-check text-success"></i> Existe' : '<i class="bi bi-x text-danger"></i> No encontrada') + '</td></tr>';

            if (r.cert_info) {
                html += '<tr><td><strong>Info Cert</strong></td><td><small class="font-monospace">' + r.cert_info.replace(/\n/g, '<br>') + '</small></td></tr>';
            }

            if (r.wsfe && r.wsfe.ok) {
                html += '<tr><td><strong>WSAA</strong></td><td><i class="bi bi-check text-success"></i> Token OK</td></tr>';
                html += '<tr><td><strong>WSFE</strong></td><td><i class="bi bi-check text-success"></i> Conectado</td></tr>';
                html += '<tr><td><strong>Ultima Factura A</strong></td><td>#' + r.wsfe.factura_a + '</td></tr>';
                html += '<tr><td><strong>Ultima Factura B</strong></td><td>#' + r.wsfe.factura_b + '</td></tr>';
            } else if (r.wsfe) {
                html += '<tr><td><strong>WSFE</strong></td><td><i class="bi bi-x text-danger"></i> ' + (r.wsfe.error || 'Error') + '</td></tr>';
            }

            html += '</table>';
            container.innerHTML = html;

        } catch (err) {
            container.innerHTML = '<div class="alert alert-danger"><i class="bi bi-x-circle-fill"></i> Error: ' + err.message + '</div>';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-lightning-charge"></i> Probar Conexion';
        }
    }

    // ============================
    // UTILS
    // ============================
    function mostrarStatus(id, tipo, html) {
        var el = document.getElementById(id);
        el.className = 'alert alert-' + tipo + ' mt-3';
        el.innerHTML = html;
        setTimeout(function() { el.className = 'd-none'; }, 5000);
    }

    // Init
    document.addEventListener('DOMContentLoaded', function() {
        cargarEmpresa();
        cargarAFIP();
        // Eventos
        var offlineChk = document.getElementById('afip_offline');
        if (offlineChk) offlineChk.addEventListener('change', actualizarLabelOffline);
    });

    return { cargarEmpresa: cargarEmpresa, guardarEmpresa: guardarEmpresa, cargarAFIP: cargarAFIP, guardarAFIP: guardarAFIP, testAFIP: testAFIP };
})();
