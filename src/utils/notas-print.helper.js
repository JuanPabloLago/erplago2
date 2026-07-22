'use strict';
/**
 * NOTAS-PRINT HELPER — Lectura datos NC para formato fiscal AFIP-compliant
 * Replica formato de FacturaPrint (factura-print.js) pero server-side.
 *
 * @module notas-print.helper
 * @version 2.0.0  - formato AFIP RG 4291/18 con discriminación IVA según letra
 */

const pool = require('../config/db');
const qrAfip = require('./qr-afip.helper');

const LETRA_POR_CODIGO = {
    '2': 'A', '3': 'A',
    '7': 'B', '8': 'B',
    '12': 'C', '13': 'C',
    '52': 'M', '53': 'M'
};
const TIPO_LABEL = { credito: 'NOTA DE CRÉDITO', debito: 'NOTA DE DÉBITO' };

function fmtMoneda(v) {
    if (v === null || v === undefined) return '$ 0,00';
    return '$ ' + parseFloat(v).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtNumero(v, dec) {
    dec = (dec === undefined) ? 2 : dec;
    if (v === null || v === undefined) return '0';
    return parseFloat(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtFecha(d) {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtFechaHora(d) {
    if (!d) return '';
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtCuit(cuit) {
    if (!cuit) return '';
    const s = String(cuit).replace(/\D/g, '');
    if (s.length !== 11) return cuit;
    return s.slice(0, 2) + '-' + s.slice(2, 10) + '-' + s.slice(10);
}
function fechaLocalAR(d) {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : new Date(d);
    return dt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}

async function obtenerDatosNotaParaPrint(idNota, idEmpresa) {
    if (!idNota)    throw new Error('notas-print.helper: idNota obligatorio');
    if (!idEmpresa) throw new Error('notas-print.helper: idEmpresa obligatorio');

    const empresaQ = await pool.query(
        'SELECT e.id_empresa, e.cuit, e.razon_social, e.nombre_fantasia, e.domicilio_fiscal, ' +
        'e.telefono, e.email, e.ingresos_brutos, e.fecha_inicio_actividades, ci.nombre AS condicion_iva ' +
        'FROM empresas e LEFT JOIN condicionesiva ci ON ci.id_condicion_iva = e.id_condicion_iva ' +
        'WHERE e.id_empresa = $1', [idEmpresa]);
    if (empresaQ.rows.length === 0) throw new Error('notas-print.helper: empresa no encontrada');
    const empresa = empresaQ.rows[0];

    const notaQ = await pool.query(
        'SELECT n.id_nota, n.id_empresa, n.id_factura_origen, n.tipo_nota, n.codigo_tipo, ' +
        'n.numero_nota, n.punto_venta, n.numero_completo, n.id_cliente, n.fecha_emision, ' +
        'n.motivo, n.subtotal, n.iva, n.total, n.observaciones, n.cae, n.vencimiento_cae, n.estado, n.origen, ' +
        'c.razon_social AS cliente_razon, c.cuit_cuil AS cliente_cuit, c.domicilio AS cliente_domicilio, ' +
        'ci.nombre AS cliente_condicion_iva, ' +
        'f.numero_completo AS factura_numero_completo, f.fecha_emision AS factura_fecha, ' +
        'ft.codigo AS factura_letra ' +
        'FROM notas_credito_debito n ' +
        'LEFT JOIN clientes c        ON c.id_cliente = n.id_cliente ' +
        'LEFT JOIN condicionesiva ci ON ci.id_condicion_iva = c.id_condicion_iva ' +
        'LEFT JOIN facturas f        ON f.id_factura = n.id_factura_origen ' +
        'LEFT JOIN factura_tipos ft  ON ft.id_tipo_factura = f.id_tipo_factura ' +
        'WHERE n.id_nota = $1 AND n.id_empresa = $2', [idNota, idEmpresa]);
    if (notaQ.rows.length === 0) {
        throw new Error('notas-print.helper: nota ' + idNota + ' no encontrada en empresa ' + idEmpresa);
    }
    const n = notaQ.rows[0];

    const itemsQ = await pool.query(
        'SELECT id_item, descripcion, cantidad, precio_unitario, iva_porcentaje, subtotal, iva_monto, total ' +
        'FROM nota_items WHERE id_nota = $1 AND id_empresa = $2 ORDER BY id_item',
        [idNota, idEmpresa]);

    const letra = LETRA_POR_CODIGO[String(n.codigo_tipo)] || '?';
    const discriminaIva = (letra === 'A');
    const codigoTipoPadded = String(n.codigo_tipo).padStart(2, '0');

    let qrDataUri = null;
    if (n.cae) {
        try {
            qrDataUri = await qrAfip.generarQRDataURI({
                cuitEmisor:       empresa.cuit,
                fechaEmision:     fechaLocalAR(n.fecha_emision),
                ptoVta:           n.punto_venta,
                codigoTipo:       n.codigo_tipo,
                nroCmp:           n.numero_nota,
                importe:          n.total,
                cae:              n.cae,
                tipoDocReceptor:  qrAfip.detectarTipoDocReceptor(n.cliente_cuit),
                nroDocReceptor:   n.cliente_cuit
            });
        } catch (e) {
            console.error('[notas-print.helper] QR error:', e.message);
            qrDataUri = null;
        }
    }

    return {
        empresa: {
            razon_social:                 empresa.razon_social,
            cuit_formato:                 fmtCuit(empresa.cuit),
            domicilio_fiscal:             empresa.domicilio_fiscal,
            telefono:                     empresa.telefono,
            email:                        empresa.email,
            condicion_iva:                empresa.condicion_iva,
            ingresos_brutos:              empresa.ingresos_brutos,
            fecha_inicio_actividades_fmt: fmtFecha(empresa.fecha_inicio_actividades)
        },
        cliente: {
            razon_social:  n.cliente_razon || 'Sin datos',
            cuit_cuil:     fmtCuit(n.cliente_cuit) || '-',
            domicilio:     n.cliente_domicilio || '-',
            condicion_iva: n.cliente_condicion_iva || '-'
        },
        nota: {
            codigo_tipo:           n.codigo_tipo,
            codigo_tipo_padded:    codigoTipoPadded,
            numero_completo:       n.numero_completo,
            fecha_emision_fmt:     fmtFecha(n.fecha_emision),
            condicion_venta_label: 'Contado',
            motivo:                n.motivo,
            subtotal_fmt:          fmtMoneda(n.subtotal),
            iva_fmt:               fmtMoneda(n.iva),
            iva_contenido_fmt:     fmtMoneda(n.iva),
            total_fmt:             fmtMoneda(n.total),
            cae:                   n.cae,
            vencimiento_cae_fmt:   fmtFecha(n.vencimiento_cae)
        },
        factura_origen: n.factura_numero_completo ? {
            numero_completo:    n.factura_numero_completo,
            fecha_emision_fmt:  fmtFecha(n.factura_fecha),
            tipo_label:         'Factura ' + (n.factura_letra || '')
        } : null,
        items: itemsQ.rows.map(function(it) {
            return {
                descripcion:           it.descripcion,
                cantidad_fmt:          fmtNumero(it.cantidad, 2),
                precio_unitario_fmt:   fmtMoneda(it.precio_unitario),
                iva_porcentaje_fmt:    fmtNumero(it.iva_porcentaje, 2),
                iva_calculado_fmt:     fmtMoneda(it.iva_monto),
                subtotal_fmt:          fmtMoneda(it.subtotal),
                total_fmt:             fmtMoneda(it.total)
            };
        }),
        letra:           letra,
        discrimina_iva:  discriminaIva,
        tipo_nota_label: TIPO_LABEL[n.tipo_nota] || (n.tipo_nota || '').toUpperCase(),
        qr_data_uri:     qrDataUri,
        generado_en:     fmtFechaHora(new Date())
    };
}

module.exports = { obtenerDatosNotaParaPrint };
