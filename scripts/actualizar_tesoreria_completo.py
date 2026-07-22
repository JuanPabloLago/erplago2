#!/usr/bin/env python3
"""
ERP LAGO - Actualización Tesorería Completa
- Totales por categoría (Efectivo, Bancos, Tarjetas, MP, Cheques) con ARS/USD
- Botones Imprimir Arqueo + Exportar Excel
- Template Handlebars para arqueo

Ejecutar: python3 actualizar_tesoreria_completo.py
"""

import os
import shutil
from datetime import datetime

BASE_DIR = '/root/mi_erp'

def backup_file(filepath):
    if os.path.exists(filepath):
        backup = f"{filepath}.bak.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(filepath, backup)
        print(f"✅ Backup: {backup}")

# ============================================================
# 1. CONTROLLER ACTUALIZADO
# ============================================================
CONTROLLER_CODE = '''const pool = require('../config/database');

// ===== CAJAS =====

exports.listarCajas = async (req, res) => {
    const id_empresa = parseInt(req.usuario.id_empresa, 10);
    try {
        const { rows } = await pool.query(
            'SELECT * FROM cajas WHERE id_empresa = $1 AND activo = TRUE ORDER BY nombre',
            [id_empresa]
        );
        res.json(rows);
    } catch (error) {
        console.error('❌ Error al obtener cajas:', error.message);
        res.status(500).json({ error: 'Error al obtener cajas' });
    }
};

exports.obtenerTurnoActual = async (req, res) => {
    const id_caja = parseInt(req.params.id_caja, 10);
    try {
        // Obtener turno básico
        const turnoQuery = `
            SELECT t.*, c.nombre as nombre_caja, u.username as usuario_apertura 
            FROM turnos_caja t 
            JOIN cajas c ON t.id_caja = c.id_caja 
            JOIN usuarios u ON t.id_usuario_apertura = u.id_usuario 
            WHERE t.id_caja = $1 AND t.estado = 'abierto' 
            ORDER BY t.fecha_apertura DESC LIMIT 1`;
        const { rows } = await pool.query(turnoQuery, [id_caja]);

        if (rows.length === 0) {
            return res.json({ turno_abierto: false });
        }

        const turno = rows[0];

        // Calcular totales por CATEGORÍA desde movimientos_caja
        const totalesQuery = `
            SELECT 
                -- EFECTIVO
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND mc.tipo = 'ingreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as efectivo_ingresos_ars,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND mc.tipo = 'egreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as efectivo_egresos_ars,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND mc.tipo = 'ingreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as efectivo_ingresos_usd,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND mc.tipo = 'egreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as efectivo_egresos_usd,
                COUNT(CASE WHEN fp.codigo = 'EFECTIVO' THEN 1 END) as efectivo_operaciones,
                
                -- TRANSFERENCIAS (Bancos - disponible hoy)
                COALESCE(SUM(CASE WHEN fp.codigo = 'TRANSFERENCIA' AND mc.tipo = 'ingreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as bancos_ars,
                COALESCE(SUM(CASE WHEN fp.codigo = 'TRANSFERENCIA' AND mc.tipo = 'ingreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as bancos_usd,
                COUNT(CASE WHEN fp.codigo = 'TRANSFERENCIA' THEN 1 END) as bancos_operaciones,
                
                -- TARJETAS (pendiente liquidación)
                COALESCE(SUM(CASE WHEN fp.codigo IN ('TARJETA_CREDITO', 'TARJETA_DEBITO') AND mc.tipo = 'ingreso' THEN mc.monto ELSE 0 END), 0) as tarjetas_total,
                COUNT(CASE WHEN fp.codigo IN ('TARJETA_CREDITO', 'TARJETA_DEBITO') THEN 1 END) as tarjetas_cupones,
                
                -- MERCADOPAGO
                COALESCE(SUM(CASE WHEN fp.codigo = 'MERCADOPAGO' AND mc.tipo = 'ingreso' THEN mc.monto ELSE 0 END), 0) as mp_total,
                COUNT(CASE WHEN fp.codigo = 'MERCADOPAGO' THEN 1 END) as mp_operaciones,
                
                -- CHEQUES
                COALESCE(SUM(CASE WHEN fp.codigo IN ('CHEQUE', 'CHEQUE_TERCERO') AND mc.tipo = 'ingreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as cheques_ars,
                COALESCE(SUM(CASE WHEN fp.codigo IN ('CHEQUE', 'CHEQUE_TERCERO') AND mc.tipo = 'ingreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as cheques_usd,
                COUNT(CASE WHEN fp.codigo IN ('CHEQUE', 'CHEQUE_TERCERO') THEN 1 END) as cheques_cantidad,
                
                -- TOTALES GENERALES (para compatibilidad)
                COALESCE(SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as total_ingresos_ars,
                COALESCE(SUM(CASE WHEN mc.tipo = 'egreso' AND mc.id_moneda = 1 THEN mc.monto ELSE 0 END), 0) as total_egresos_ars,
                COALESCE(SUM(CASE WHEN mc.tipo = 'ingreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as total_ingresos_usd,
                COALESCE(SUM(CASE WHEN mc.tipo = 'egreso' AND mc.id_moneda = 2 THEN mc.monto ELSE 0 END), 0) as total_egresos_usd,
                COUNT(*) as total_movimientos
            FROM movimientos_caja mc
            LEFT JOIN formas_pago fp ON mc.id_metodo_pago = fp.id_forma_pago
            WHERE mc.id_turno = $1`;

        const totalesRes = await pool.query(totalesQuery, [turno.id_turno]);
        const t = totalesRes.rows[0];

        // Calcular efectivo actual (inicial + ingresos - egresos)
        const monto_inicial_ars = parseFloat(turno.monto_inicial_ars) || 0;
        const monto_inicial_usd = parseFloat(turno.monto_inicial_usd) || 0;
        
        const efectivo_actual_ars = monto_inicial_ars + parseFloat(t.efectivo_ingresos_ars) - parseFloat(t.efectivo_egresos_ars);
        const efectivo_actual_usd = monto_inicial_usd + parseFloat(t.efectivo_ingresos_usd) - parseFloat(t.efectivo_egresos_usd);

        res.json({
            turno_abierto: true,
            turno: {
                ...turno,
                // Efectivo en caja
                efectivo_actual_ars,
                efectivo_actual_usd,
                efectivo_operaciones: parseInt(t.efectivo_operaciones) || 0,
                
                // Bancos (transferencias)
                bancos_ars: parseFloat(t.bancos_ars) || 0,
                bancos_usd: parseFloat(t.bancos_usd) || 0,
                bancos_operaciones: parseInt(t.bancos_operaciones) || 0,
                
                // Tarjetas (pendiente liquidación)
                tarjetas_total: parseFloat(t.tarjetas_total) || 0,
                tarjetas_cupones: parseInt(t.tarjetas_cupones) || 0,
                
                // MercadoPago
                mp_total: parseFloat(t.mp_total) || 0,
                mp_operaciones: parseInt(t.mp_operaciones) || 0,
                
                // Cheques
                cheques_ars: parseFloat(t.cheques_ars) || 0,
                cheques_usd: parseFloat(t.cheques_usd) || 0,
                cheques_cantidad: parseInt(t.cheques_cantidad) || 0,
                
                // Totales generales
                total_ingresos_ars: parseFloat(t.total_ingresos_ars) || 0,
                total_egresos_ars: parseFloat(t.total_egresos_ars) || 0,
                total_movimientos: parseInt(t.total_movimientos) || 0
            }
        });
    } catch (error) {
        console.error('❌ Error al obtener turno actual:', error.message);
        res.status(500).json({ error: 'Error al obtener turno actual' });
    }
};

exports.abrirCaja = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_caja, monto_inicial_ars, monto_inicial_usd } = req.body;
    
    if (!id_caja) return res.status(400).json({ error: 'ID de caja requerido' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const checkRes = await client.query(
            "SELECT id_turno FROM turnos_caja WHERE id_caja = $1 AND estado = 'abierto'",
            [id_caja]
        );
        if (checkRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Ya existe un turno abierto para esta caja' });
        }
        
        const { rows } = await client.query(`
            INSERT INTO turnos_caja (id_caja, id_usuario_apertura, monto_inicial_ars, monto_inicial_usd, estado, fecha_apertura)
            VALUES ($1, $2, $3, $4, 'abierto', NOW()) RETURNING *`,
            [id_caja, id_usuario, monto_inicial_ars || 0, monto_inicial_usd || 0]
        );
        
        await client.query('COMMIT');
        res.status(201).json({ message: 'Caja abierta exitosamente', turno: rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al abrir caja:', error.message);
        res.status(500).json({ error: 'Error al abrir caja' });
    } finally {
        client.release();
    }
};

exports.cerrarCaja = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_turno, arqueo_efectivo_ars, arqueo_efectivo_usd, observaciones } = req.body;
    
    if (!id_turno) return res.status(400).json({ error: 'ID de turno requerido' });
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Calcular totales finales desde movimientos
        const totalesQuery = `
            SELECT 
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND tipo = 'ingreso' AND id_moneda = 1 THEN monto ELSE 0 END), 0) as ing_ars,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND tipo = 'egreso' AND id_moneda = 1 THEN monto ELSE 0 END), 0) as egr_ars,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND tipo = 'ingreso' AND id_moneda = 2 THEN monto ELSE 0 END), 0) as ing_usd,
                COALESCE(SUM(CASE WHEN fp.codigo = 'EFECTIVO' AND tipo = 'egreso' AND id_moneda = 2 THEN monto ELSE 0 END), 0) as egr_usd
            FROM movimientos_caja mc
            LEFT JOIN formas_pago fp ON mc.id_metodo_pago = fp.id_forma_pago
            WHERE mc.id_turno = $1`;
        const totalesRes = await client.query(totalesQuery, [id_turno]);
        const t = totalesRes.rows[0];
        
        // Obtener monto inicial
        const turnoRes = await client.query(
            'SELECT monto_inicial_ars, monto_inicial_usd FROM turnos_caja WHERE id_turno = $1',
            [id_turno]
        );
        if (turnoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Turno no encontrado' });
        }
        
        const turnoData = turnoRes.rows[0];
        const esperado_ars = parseFloat(turnoData.monto_inicial_ars || 0) + parseFloat(t.ing_ars) - parseFloat(t.egr_ars);
        const esperado_usd = parseFloat(turnoData.monto_inicial_usd || 0) + parseFloat(t.ing_usd) - parseFloat(t.egr_usd);
        const arqueo_ars = parseFloat(arqueo_efectivo_ars) || 0;
        const arqueo_usd = parseFloat(arqueo_efectivo_usd) || 0;
        const diferencia_ars = arqueo_ars - esperado_ars;
        const diferencia_usd = arqueo_usd - esperado_usd;
        
        const { rows } = await client.query(`
            UPDATE turnos_caja SET 
                fecha_cierre = NOW(),
                id_usuario_cierre = $1,
                ingresos_efectivo_ars = $2,
                egresos_efectivo_ars = $3,
                ingresos_efectivo_usd = $4,
                egresos_efectivo_usd = $5,
                arqueo_efectivo_ars = $6,
                arqueo_efectivo_usd = $7,
                diferencia_ars = $8,
                diferencia_usd = $9,
                observaciones = $10,
                estado = 'cerrado'
            WHERE id_turno = $11 AND estado = 'abierto'
            RETURNING *`,
            [id_usuario, t.ing_ars, t.egr_ars, t.ing_usd, t.egr_usd,
             arqueo_ars, arqueo_usd, diferencia_ars, diferencia_usd, 
             observaciones || null, id_turno]
        );
        
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Turno no encontrado o ya cerrado' });
        }
        
        await client.query('COMMIT');
        res.json({
            message: 'Caja cerrada exitosamente',
            turno: rows[0],
            resumen: { esperado_ars, esperado_usd, arqueo_ars, arqueo_usd, diferencia_ars, diferencia_usd }
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Error al cerrar caja:', error.message);
        res.status(500).json({ error: 'Error al cerrar caja' });
    } finally {
        client.release();
    }
};

// ===== MOVIMIENTOS =====

exports.crearMovimiento = async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const { id_turno, tipo, monto, concepto, id_moneda, id_forma_pago } = req.body;
    
    if (!id_turno || !tipo || !monto || !concepto) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    if (!['ingreso', 'egreso'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo debe ser ingreso o egreso' });
    }
    
    try {
        // Si no viene forma de pago, buscar EFECTIVO por defecto
        let id_metodo_pago = id_forma_pago;
        if (!id_metodo_pago) {
            const fpRes = await pool.query("SELECT id_forma_pago FROM formas_pago WHERE codigo = 'EFECTIVO' LIMIT 1");
            id_metodo_pago = fpRes.rows[0]?.id_forma_pago || null;
        }
        
        const { rows } = await pool.query(`
            INSERT INTO movimientos_caja (id_turno, id_usuario, tipo, id_moneda, monto, concepto, id_metodo_pago, fecha_movimiento)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
            [id_turno, id_usuario, tipo, id_moneda || 1, monto, concepto, id_metodo_pago]
        );
        
        console.log(`✅ Movimiento ${tipo}: $${monto} - ${concepto}`);
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error al crear movimiento:', error);
        res.status(500).json({ error: 'Error al registrar movimiento' });
    }
};

exports.listarMovimientos = async (req, res) => {
    const { id_turno } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT mc.*, u.nombre as usuario_nombre, m.simbolo as moneda_simbolo, 
                   fp.nombre as forma_pago_nombre, fp.codigo as forma_pago_codigo
            FROM movimientos_caja mc
            LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
            LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
            LEFT JOIN formas_pago fp ON mc.id_metodo_pago = fp.id_forma_pago
            WHERE mc.id_turno = $1 
            ORDER BY mc.fecha_movimiento DESC`,
            [id_turno]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error al listar movimientos:', error);
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
};

// ===== EXPORTAR EXCEL =====

exports.exportarMovimientosExcel = async (req, res) => {
    const { id_turno } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT 
                mc.fecha_movimiento,
                mc.tipo,
                mc.concepto,
                mc.monto,
                m.codigo as moneda,
                fp.nombre as forma_pago,
                u.nombre as usuario
            FROM movimientos_caja mc
            LEFT JOIN usuarios u ON mc.id_usuario = u.id_usuario
            LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
            LEFT JOIN formas_pago fp ON mc.id_metodo_pago = fp.id_forma_pago
            WHERE mc.id_turno = $1 
            ORDER BY mc.fecha_movimiento`,
            [id_turno]
        );
        
        // Devolver JSON para que el frontend genere el Excel con SheetJS
        res.json({
            turno: id_turno,
            fecha_exportacion: new Date().toISOString(),
            movimientos: rows
        });
    } catch (error) {
        console.error('Error al exportar:', error);
        res.status(500).json({ error: 'Error al exportar movimientos' });
    }
};

// ===== DATOS PARA ARQUEO/IMPRESIÓN =====

exports.obtenerDatosArqueo = async (req, res) => {
    const { id_turno } = req.params;
    const id_empresa = req.usuario.id_empresa;
    
    try {
        // Datos del turno
        const turnoRes = await pool.query(`
            SELECT t.*, c.nombre as caja_nombre, 
                   ua.nombre as usuario_apertura_nombre,
                   uc.nombre as usuario_cierre_nombre
            FROM turnos_caja t
            JOIN cajas c ON t.id_caja = c.id_caja
            JOIN usuarios ua ON t.id_usuario_apertura = ua.id_usuario
            LEFT JOIN usuarios uc ON t.id_usuario_cierre = uc.id_usuario
            WHERE t.id_turno = $1`, [id_turno]);
        
        if (turnoRes.rows.length === 0) {
            return res.status(404).json({ error: 'Turno no encontrado' });
        }
        
        const turno = turnoRes.rows[0];
        
        // Totales por categoría
        const totalesRes = await pool.query(`
            SELECT 
                fp.codigo,
                fp.nombre as forma_pago,
                mc.id_moneda,
                m.codigo as moneda_codigo,
                m.simbolo as moneda_simbolo,
                SUM(CASE WHEN mc.tipo = 'ingreso' THEN mc.monto ELSE 0 END) as ingresos,
                SUM(CASE WHEN mc.tipo = 'egreso' THEN mc.monto ELSE 0 END) as egresos,
                COUNT(*) as operaciones
            FROM movimientos_caja mc
            LEFT JOIN formas_pago fp ON mc.id_metodo_pago = fp.id_forma_pago
            LEFT JOIN monedas m ON mc.id_moneda = m.id_moneda
            WHERE mc.id_turno = $1
            GROUP BY fp.codigo, fp.nombre, mc.id_moneda, m.codigo, m.simbolo
            ORDER BY fp.codigo, mc.id_moneda`, [id_turno]);
        
        // Datos empresa
        const empresaRes = await pool.query(
            'SELECT * FROM empresas WHERE id_empresa = $1', [id_empresa]);
        
        res.json({
            empresa: empresaRes.rows[0] || {},
            turno,
            totales_por_categoria: totalesRes.rows,
            fecha_generacion: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error al obtener datos arqueo:', error);
        res.status(500).json({ error: 'Error al obtener datos del arqueo' });
    }
};
'''

# ============================================================
# 2. TEMPLATE HANDLEBARS PARA ARQUEO
# ============================================================
TEMPLATE_ARQUEO = '''<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Arqueo de Caja - Turno #{{turno.id_turno}}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
        .header h1 { font-size: 18px; margin-bottom: 5px; }
        .header h2 { font-size: 14px; font-weight: normal; color: #666; }
        .info-box { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .info-col { width: 48%; }
        .info-row { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .info-row .label { color: #666; }
        .info-row .value { font-weight: bold; }
        .section { margin-bottom: 25px; }
        .section-title { background: #f0f0f0; padding: 8px 12px; font-weight: bold; margin-bottom: 10px; border-left: 4px solid #1a5f7a; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f8f8; font-weight: 600; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .total-row { font-weight: bold; background: #f0f0f0; }
        .monto-positivo { color: #10b981; }
        .monto-negativo { color: #ef4444; }
        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #999; border-top: 1px solid #ddd; padding-top: 15px; }
        .firma-box { margin-top: 50px; display: flex; justify-content: space-around; }
        .firma { width: 200px; text-align: center; }
        .firma-line { border-top: 1px solid #333; margin-bottom: 5px; }
        @media print { body { padding: 10px; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>{{empresa.razon_social}}</h1>
        <h2>ARQUEO DE CAJA - TURNO #{{turno.id_turno}}</h2>
    </div>
    
    <div class="info-box">
        <div class="info-col">
            <div class="info-row"><span class="label">Caja:</span><span class="value">{{turno.caja_nombre}}</span></div>
            <div class="info-row"><span class="label">Apertura:</span><span class="value">{{formatDate turno.fecha_apertura}}</span></div>
            <div class="info-row"><span class="label">Usuario Apertura:</span><span class="value">{{turno.usuario_apertura_nombre}}</span></div>
        </div>
        <div class="info-col">
            <div class="info-row"><span class="label">Cierre:</span><span class="value">{{#if turno.fecha_cierre}}{{formatDate turno.fecha_cierre}}{{else}}EN CURSO{{/if}}</span></div>
            <div class="info-row"><span class="label">Usuario Cierre:</span><span class="value">{{turno.usuario_cierre_nombre}}</span></div>
            <div class="info-row"><span class="label">Generado:</span><span class="value">{{now}}</span></div>
        </div>
    </div>
    
    <div class="section">
        <div class="section-title">💵 EFECTIVO EN CAJA</div>
        <table>
            <tr><th>Concepto</th><th class="text-right">ARS</th><th class="text-right">USD</th></tr>
            <tr><td>Monto Inicial</td><td class="text-right">{{formatNumber turno.monto_inicial_ars}}</td><td class="text-right">{{formatNumber turno.monto_inicial_usd}}</td></tr>
            <tr><td>Ingresos</td><td class="text-right monto-positivo">+{{formatNumber turno.ingresos_efectivo_ars}}</td><td class="text-right monto-positivo">+{{formatNumber turno.ingresos_efectivo_usd}}</td></tr>
            <tr><td>Egresos</td><td class="text-right monto-negativo">-{{formatNumber turno.egresos_efectivo_ars}}</td><td class="text-right monto-negativo">-{{formatNumber turno.egresos_efectivo_usd}}</td></tr>
            <tr class="total-row"><td>TOTAL SISTEMA</td><td class="text-right">{{formatNumber turno.efectivo_sistema_ars}}</td><td class="text-right">{{formatNumber turno.efectivo_sistema_usd}}</td></tr>
            {{#if turno.arqueo_efectivo_ars}}
            <tr><td>Arqueo Físico</td><td class="text-right">{{formatNumber turno.arqueo_efectivo_ars}}</td><td class="text-right">{{formatNumber turno.arqueo_efectivo_usd}}</td></tr>
            <tr class="total-row"><td>DIFERENCIA</td><td class="text-right {{#if (gt turno.diferencia_ars 0)}}monto-positivo{{else}}monto-negativo{{/if}}">{{formatNumber turno.diferencia_ars}}</td><td class="text-right">{{formatNumber turno.diferencia_usd}}</td></tr>
            {{/if}}
        </table>
    </div>
    
    <div class="section">
        <div class="section-title">📊 RESUMEN POR FORMA DE PAGO</div>
        <table>
            <tr><th>Forma de Pago</th><th class="text-center">Moneda</th><th class="text-right">Ingresos</th><th class="text-right">Egresos</th><th class="text-center">Ops.</th></tr>
            {{#each totales_por_categoria}}
            <tr>
                <td>{{this.forma_pago}}</td>
                <td class="text-center">{{this.moneda_codigo}}</td>
                <td class="text-right monto-positivo">{{formatNumber this.ingresos}}</td>
                <td class="text-right monto-negativo">{{formatNumber this.egresos}}</td>
                <td class="text-center">{{this.operaciones}}</td>
            </tr>
            {{/each}}
        </table>
    </div>
    
    {{#if turno.observaciones}}
    <div class="section">
        <div class="section-title">📝 OBSERVACIONES</div>
        <p style="padding: 10px;">{{turno.observaciones}}</p>
    </div>
    {{/if}}
    
    <div class="firma-box">
        <div class="firma"><div class="firma-line"></div>Cajero</div>
        <div class="firma"><div class="firma-line"></div>Supervisor</div>
    </div>
    
    <div class="footer">
        ERP LAGO - Documento generado el {{now}}
    </div>
</body>
</html>
'''

# ============================================================
# 3. FRONTEND HTML ACTUALIZADO
# ============================================================
FRONTEND_HTML = '''<!DOCTYPE html>
<html lang="es">
<head>
    <script src="js/config.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tesorería - ERP LAGO</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
    <script src="https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"></script>
    <style>
        :root { --lago-primary: #1a5f7a; --lago-secondary: #159895; --lago-accent: #57c5b6; --lago-light: #f8fafc; --lago-dark: #0f172a; --lago-success: #10b981; --lago-warning: #f59e0b; --lago-danger: #ef4444; --lago-muted: #64748b; }
        * { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
        body { background: var(--lago-light); min-height: 100vh; }
        
        /* Header con totales por categoría */
        .header-bar { background: linear-gradient(135deg, var(--lago-primary) 0%, var(--lago-secondary) 100%); color: white; padding: 10px 20px; position: sticky; top: 0; z-index: 1000; }
        .header-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .estado-indicador { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin-right: 8px; }
        .estado-indicador.abierta { background: var(--lago-success); box-shadow: 0 0 8px var(--lago-success); }
        .estado-indicador.cerrada { background: var(--lago-danger); }
        
        /* Totales por categoría */
        .categorias-grid { display: flex; gap: 8px; flex-wrap: wrap; }
        .categoria-item { background: rgba(255,255,255,0.12); border-radius: 8px; padding: 8px 14px; min-width: 120px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
        .categoria-item .icono { font-size: 1.1rem; margin-bottom: 2px; }
        .categoria-item .nombre { font-size: 0.65rem; text-transform: uppercase; opacity: 0.85; letter-spacing: 0.5px; }
        .categoria-item .monto-ars { font-size: 1rem; font-weight: 700; }
        .categoria-item .monto-usd { font-size: 0.7rem; opacity: 0.8; }
        .categoria-item .detalle { font-size: 0.65rem; opacity: 0.7; }
        .categoria-item.efectivo { border-left: 3px solid #22c55e; }
        .categoria-item.bancos { border-left: 3px solid #3b82f6; }
        .categoria-item.tarjetas { border-left: 3px solid #f59e0b; }
        .categoria-item.mp { border-left: 3px solid #06b6d4; }
        .categoria-item.cheques { border-left: 3px solid #8b5cf6; }
        
        /* Nav tabs */
        .nav-tabs-custom { background: white; border-bottom: 2px solid #e2e8f0; padding: 0 20px; display: flex; gap: 5px; }
        .nav-tabs-custom .nav-link { border: none; border-bottom: 3px solid transparent; color: var(--lago-muted); padding: 12px 20px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .nav-tabs-custom .nav-link:hover { color: var(--lago-primary); }
        .nav-tabs-custom .nav-link.active { color: var(--lago-primary); border-bottom-color: var(--lago-primary); }
        
        /* Cards */
        .main-content { padding: 20px; max-width: 1600px; margin: 0 auto; }
        .lago-card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
        .lago-card-header { background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
        .lago-card-body { padding: 16px; }
        
        /* Botones */
        .btn-lago { background: linear-gradient(135deg, var(--lago-primary) 0%, var(--lago-secondary) 100%); color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; }
        .btn-lago:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(26, 95, 122, 0.3); color: white; }
        .btn-lago-outline { background: transparent; color: var(--lago-primary); border: 2px solid var(--lago-primary); }
        .btn-lago-outline:hover { background: var(--lago-primary); color: white; }
        
        /* Formas de pago grid */
        .formas-pago-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(85px, 1fr)); gap: 8px; margin-bottom: 12px; }
        .forma-pago-btn { display: flex; flex-direction: column; align-items: center; padding: 12px 8px; border: 2px solid #e2e8f0; border-radius: 8px; background: white; cursor: pointer; transition: all 0.2s; }
        .forma-pago-btn:hover { border-color: var(--lago-primary); }
        .forma-pago-btn.selected { border-color: var(--lago-primary); background: rgba(26, 95, 122, 0.08); }
        .forma-pago-btn i { font-size: 1.3rem; color: var(--lago-primary); margin-bottom: 4px; }
        .forma-pago-btn span { font-size: 0.7rem; font-weight: 500; }
        
        /* Pagos agregados */
        .pago-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: #f8fafc; border-radius: 6px; margin-bottom: 6px; border: 1px solid #e2e8f0; }
        .pago-item .info { display: flex; align-items: center; gap: 8px; }
        .pago-item .monto { font-weight: 700; }
        .pago-item .btn-remove { background: none; border: none; color: var(--lago-danger); cursor: pointer; }
        
        /* Total grande */
        .total-grande { background: linear-gradient(135deg, var(--lago-primary) 0%, var(--lago-secondary) 100%); color: white; border-radius: 10px; padding: 20px; text-align: center; }
        .total-grande .monto { font-size: 2rem; font-weight: 700; }
        
        /* Cliente */
        .cliente-search-box { position: relative; }
        .cliente-search-box .resultados { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-height: 250px; overflow-y: auto; z-index: 100; }
        .resultado-item { padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; }
        .resultado-item:hover { background: #f8fafc; }
        .cliente-seleccionado { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center; }
        
        /* Tablas */
        .tabla-lago { width: 100%; border-collapse: collapse; }
        .tabla-lago th { background: #f8fafc; padding: 10px 12px; font-weight: 600; color: var(--lago-muted); font-size: 0.75rem; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
        .tabla-lago td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
        .tabla-lago tr:hover { background: rgba(26, 95, 122, 0.02); }
        
        .badge-lago { padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 0.7rem; }
        .badge-lago.success { background: #d1fae5; color: #065f46; }
        .badge-lago.danger { background: #fee2e2; color: #991b1b; }
        
        /* Modal */
        .modal-lago .modal-content { border: none; border-radius: 12px; }
        .modal-lago .modal-header { background: linear-gradient(135deg, var(--lago-primary) 0%, var(--lago-secondary) 100%); color: white; border-radius: 12px 12px 0 0; }
        .modal-lago .btn-close { filter: brightness(0) invert(1); }
        
        /* Atajos */
        .atajos-info { position: fixed; bottom: 15px; right: 15px; background: rgba(15, 23, 42, 0.9); color: white; padding: 10px 15px; border-radius: 8px; font-size: 0.75rem; display: flex; gap: 12px; }
        .atajos-info kbd { background: rgba(255,255,255,0.2); padding: 2px 5px; border-radius: 3px; }
        
        @media (max-width: 768px) { .categorias-grid { display: none; } }
    </style>
</head>
<body>
    <header class="header-bar">
        <div class="header-top">
            <div class="d-flex align-items-center gap-3">
                <a href="dashboard.html" class="text-white text-decoration-none"><i class="bi bi-arrow-left-circle"></i> <strong>ERP LAGO</strong></a>
                <span class="opacity-50">|</span>
                <span><span class="estado-indicador" id="estadoIndicador"></span><span id="estadoCajaTexto">Cargando...</span></span>
            </div>
            <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm btn-outline-light" onclick="imprimirArqueo()" title="Imprimir Arqueo"><i class="bi bi-printer"></i></button>
                <button class="btn btn-sm btn-outline-light" onclick="exportarExcel()" title="Exportar Excel"><i class="bi bi-file-earmark-excel"></i></button>
                <span id="usuarioNombre">Usuario</span>
                <button class="btn btn-sm btn-outline-light" onclick="cerrarSesion()"><i class="bi bi-box-arrow-right"></i></button>
            </div>
        </div>
        <div class="categorias-grid" id="categoriasGrid">
            <div class="categoria-item efectivo">
                <div class="icono">💵</div>
                <div class="nombre">Efectivo</div>
                <div class="monto-ars" id="catEfectivoARS">$0</div>
                <div class="monto-usd" id="catEfectivoUSD">US$0</div>
                <div class="detalle">En caja</div>
            </div>
            <div class="categoria-item bancos">
                <div class="icono">🏦</div>
                <div class="nombre">Bancos</div>
                <div class="monto-ars" id="catBancosARS">$0</div>
                <div class="monto-usd" id="catBancosUSD">US$0</div>
                <div class="detalle" id="catBancosOps">0 transf.</div>
            </div>
            <div class="categoria-item tarjetas">
                <div class="icono">💳</div>
                <div class="nombre">Tarjetas</div>
                <div class="monto-ars" id="catTarjetasARS">$0</div>
                <div class="detalle" id="catTarjetasCupones">Pend. liq.</div>
            </div>
            <div class="categoria-item mp">
                <div class="icono">📱</div>
                <div class="nombre">MercadoPago</div>
                <div class="monto-ars" id="catMPARS">$0</div>
                <div class="detalle" id="catMPOps">0 ops</div>
            </div>
            <div class="categoria-item cheques">
                <div class="icono">📄</div>
                <div class="nombre">Cheques</div>
                <div class="monto-ars" id="catChequesARS">$0</div>
                <div class="monto-usd" id="catChequesUSD">US$0</div>
                <div class="detalle" id="catChequesCant">En cartera</div>
            </div>
        </div>
    </header>
    
    <nav class="nav-tabs-custom" id="navTabs">
        <a class="nav-link active" href="#" data-tab="cobrar"><i class="bi bi-cash-coin"></i> Cobrar</a>
        <a class="nav-link" href="#" data-tab="movimientos"><i class="bi bi-list-ul"></i> Movimientos</a>
        <a class="nav-link" href="#" data-tab="arqueo"><i class="bi bi-calculator"></i> Arqueo / Cierre</a>
    </nav>
    
    <main class="main-content">
        <!-- TAB COBRAR -->
        <section id="tab-cobrar" class="tab-content">
            <div class="row">
                <div class="col-lg-8">
                    <div class="lago-card mb-3">
                        <div class="lago-card-header"><span><i class="bi bi-person"></i> Cliente</span><div class="form-check"><input class="form-check-input" type="checkbox" id="sinCliente" onchange="toggleSinCliente()"><label class="form-check-label" for="sinCliente">Sin cliente</label></div></div>
                        <div class="lago-card-body">
                            <div id="seccionBuscarCliente"><div class="cliente-search-box"><input type="text" class="form-control" id="inputBuscarCliente" placeholder="Buscar cliente..." autocomplete="off"><div class="resultados" id="resultadosClientes" style="display:none;"></div></div></div>
                            <div id="seccionClienteSeleccionado" style="display:none;"></div>
                        </div>
                    </div>
                    <div class="lago-card mb-3">
                        <div class="lago-card-header"><span><i class="bi bi-currency-dollar"></i> Monto</span></div>
                        <div class="lago-card-body"><div class="row"><div class="col-md-6"><div class="input-group"><span class="input-group-text">$</span><input type="number" class="form-control form-control-lg" id="montoACobrar" placeholder="0.00" step="0.01"></div></div><div class="col-md-6"><input type="text" class="form-control form-control-lg" id="conceptoCobro" placeholder="Concepto (opcional)"></div></div></div>
                    </div>
                    <div class="lago-card">
                        <div class="lago-card-header"><span><i class="bi bi-credit-card"></i> Forma de Pago</span></div>
                        <div class="lago-card-body">
                            <div class="formas-pago-grid" id="formasPagoGrid"></div>
                            <div class="pagos-agregados" id="pagosAgregados" style="display:none;"><div id="listaPagos"></div></div>
                            <div id="sinFormasPago" class="text-center text-muted py-2"><small>Seleccione forma de pago</small></div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-4">
                    <div class="total-grande mb-3"><div class="etiqueta">Total</div><div class="monto" id="displayTotalCobrar">$0,00</div></div>
                    <div class="lago-card mb-3"><div class="lago-card-body"><div class="d-flex justify-content-between mb-1"><span>Subtotal:</span><strong id="displaySubtotal">$0</strong></div><div class="d-flex justify-content-between mb-1"><span>Recargos:</span><strong id="displayRecargos">$0</strong></div><hr class="my-2"><div class="d-flex justify-content-between mb-1"><span>Ingresado:</span><strong id="displayIngresado">$0</strong></div><div class="d-flex justify-content-between"><span>Diferencia:</span><strong id="displayDiferencia">$0</strong></div></div></div>
                    <button class="btn btn-lago w-100" id="btnCobrar" disabled onclick="procesarCobro()"><i class="bi bi-check-circle"></i> COBRAR (F2)</button>
                </div>
            </div>
        </section>
        
        <!-- TAB MOVIMIENTOS -->
        <section id="tab-movimientos" class="tab-content" style="display:none;">
            <div class="lago-card">
                <div class="lago-card-header"><span><i class="bi bi-list-ul"></i> Movimientos</span><div><button class="btn btn-sm btn-lago-outline me-1" onclick="agregarMovimientoManual('ingreso')"><i class="bi bi-plus-circle"></i> Ingreso</button><button class="btn btn-sm btn-lago-outline" onclick="agregarMovimientoManual('egreso')"><i class="bi bi-dash-circle"></i> Egreso</button></div></div>
                <div class="lago-card-body p-0"><table class="tabla-lago"><thead><tr><th>Hora</th><th>Tipo</th><th>Concepto</th><th>F. Pago</th><th class="text-end">Monto</th><th>Usuario</th></tr></thead><tbody id="tablaMovimientos"></tbody></table></div>
            </div>
        </section>
        
        <!-- TAB ARQUEO -->
        <section id="tab-arqueo" class="tab-content" style="display:none;">
            <div class="row">
                <div class="col-lg-6">
                    <div class="lago-card mb-3">
                        <div class="lago-card-header"><span><i class="bi bi-calculator"></i> Arqueo</span></div>
                        <div class="lago-card-body">
                            <div class="row mb-3"><div class="col-6"><label class="form-label small">Sistema ARS</label><div class="fs-5 fw-bold" id="arqueoSistemaARS">$0</div></div><div class="col-6"><label class="form-label small">Sistema USD</label><div class="fs-5 fw-bold" id="arqueoSistemaUSD">US$0</div></div></div>
                            <hr>
                            <div class="row mb-3"><div class="col-6"><label class="form-label small">Contado ARS</label><div class="input-group"><span class="input-group-text">$</span><input type="number" class="form-control" id="arqueoContadoARS" onchange="calcularDiferenciaArqueo()"></div></div><div class="col-6"><label class="form-label small">Contado USD</label><div class="input-group"><span class="input-group-text">US$</span><input type="number" class="form-control" id="arqueoContadoUSD" onchange="calcularDiferenciaArqueo()"></div></div></div>
                            <hr>
                            <div class="row"><div class="col-6"><label class="form-label small">Diferencia ARS</label><div class="fs-5 fw-bold" id="arqueoDifARS">$0</div></div><div class="col-6"><label class="form-label small">Diferencia USD</label><div class="fs-5 fw-bold" id="arqueoDifUSD">US$0</div></div></div>
                        </div>
                    </div>
                </div>
                <div class="col-lg-6">
                    <div class="lago-card mb-3"><div class="lago-card-body text-center py-4"><div id="arqueoEstado" class="fs-4 fw-bold text-muted">Sin verificar</div></div></div>
                    <div class="lago-card mb-3"><div class="lago-card-body"><textarea class="form-control" id="arqueoObservaciones" rows="2" placeholder="Observaciones..."></textarea></div></div>
                    <button class="btn btn-lago w-100" onclick="confirmarCierreCaja()"><i class="bi bi-lock"></i> Cerrar Caja</button>
                </div>
            </div>
        </section>
    </main>
    
    <!-- MODALES -->
    <div class="modal fade modal-lago" id="modalAbrirCaja" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title"><i class="bi bi-unlock"></i> Abrir Caja</h5></div><div class="modal-body"><div class="mb-3"><label class="form-label">Monto Inicial ARS</label><div class="input-group"><span class="input-group-text">$</span><input type="number" class="form-control" id="abrirMontoARS" value="0"></div></div><div class="mb-3"><label class="form-label">Monto Inicial USD</label><div class="input-group"><span class="input-group-text">US$</span><input type="number" class="form-control" id="abrirMontoUSD" value="0"></div></div></div><div class="modal-footer"><button class="btn btn-lago" onclick="confirmarAbrirCaja()"><i class="bi bi-unlock"></i> Abrir</button></div></div></div></div>
    <div class="modal fade modal-lago" id="modalMovimiento" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="modalMovimientoTitulo">Movimiento</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><input type="hidden" id="movimientoTipo"><div class="mb-3"><label class="form-label">Monto</label><div class="input-group"><span class="input-group-text">$</span><input type="number" class="form-control" id="movimientoMonto"></div></div><div class="mb-3"><label class="form-label">Moneda</label><select class="form-select" id="movimientoMoneda"><option value="1">ARS</option><option value="2">USD</option></select></div><div class="mb-3"><label class="form-label">Concepto</label><input type="text" class="form-control" id="movimientoConcepto"></div></div><div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-lago" onclick="guardarMovimientoManual()">Guardar</button></div></div></div></div>
    <div class="modal fade modal-lago" id="modalDetallePago" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="modalDetalleTitulo">Detalle</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="mb-3"><label class="form-label">Monto</label><div class="input-group"><span class="input-group-text">$</span><input type="number" class="form-control" id="detalleMontoInput"></div></div><div class="mb-3"><label class="form-label">Moneda</label><select class="form-select" id="detalleMonedaInput"><option value="1">ARS</option><option value="2">USD</option></select></div><div class="mb-3" id="detalleTarjetaGroup" style="display:none;"><label class="form-label">Tarjeta</label><select class="form-select" id="detalleTarjetaInput"></select></div><div class="mb-3" id="detalleCuotasGroup" style="display:none;"><label class="form-label">Cuotas</label><select class="form-select" id="detalleCuotasInput"><option value="1">1</option><option value="3">3</option><option value="6">6</option><option value="12">12</option></select></div><div class="mb-3" id="detalleBancoGroup" style="display:none;"><label class="form-label">Banco</label><select class="form-select" id="detalleBancoInput"></select></div><div class="mb-3" id="detalleReferenciaGroup" style="display:none;"><label class="form-label">Referencia</label><input type="text" class="form-control" id="detalleReferenciaInput"></div><div id="detalleRecargoInfo"></div></div><div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-lago" onclick="agregarPagoDetalle()">Agregar</button></div></div></div></div>
    
    <div class="atajos-info"><span><kbd>F2</kbd> Cobrar</span><span><kbd>F4</kbd> Nuevo</span><span><kbd>Esc</kbd> Limpiar</span></div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
    const API_URL = window.CONFIG?.API_URL || '/api';
    const token = localStorage.getItem('authToken');
    if (!token) window.location.href = 'login.html';
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    
    let turnoActual = null, clienteSeleccionado = null, formasPagoDisponibles = [], tarjetas = [], bancos = [], pagosAgregados = [], formaPagoActual = null;
    const ID_CAJA = 1;
    let modalDetallePago, modalMovimiento, modalAbrirCaja;
    const iconos = { 'EFECTIVO': 'bi-cash-stack', 'TARJETA_CREDITO': 'bi-credit-card', 'TARJETA_DEBITO': 'bi-credit-card-2-front', 'TRANSFERENCIA': 'bi-bank', 'MERCADOPAGO': 'bi-phone', 'CHEQUE': 'bi-file-text' };

    document.addEventListener('DOMContentLoaded', async () => {
        document.getElementById('usuarioNombre').textContent = localStorage.getItem('username') || 'Usuario';
        modalDetallePago = new bootstrap.Modal(document.getElementById('modalDetallePago'));
        modalMovimiento = new bootstrap.Modal(document.getElementById('modalMovimiento'));
        modalAbrirCaja = new bootstrap.Modal(document.getElementById('modalAbrirCaja'));
        await cargarEstadoCaja();
        await cargarCatalogos();
        configurarTabs();
        configurarBusquedaClientes();
        configurarAtajos();
        setInterval(cargarEstadoCaja, 30000);
    });

    async function cargarEstadoCaja() {
        try {
            const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/${ID_CAJA}/turno-actual`, { headers });
            const data = await res.json();
            const ind = document.getElementById('estadoIndicador');
            const txt = document.getElementById('estadoCajaTexto');
            if (data.turno_abierto && data.turno) {
                turnoActual = data.turno;
                ind.className = 'estado-indicador abierta';
                txt.innerHTML = `<strong>CAJA ABIERTA</strong> - Turno #${turnoActual.id_turno}`;
                actualizarCategoriasHeader();
            } else {
                turnoActual = null;
                ind.className = 'estado-indicador cerrada';
                txt.innerHTML = `<strong>CAJA CERRADA</strong>`;
                modalAbrirCaja.show();
            }
        } catch (e) { console.error(e); }
    }

    function actualizarCategoriasHeader() {
        if (!turnoActual) return;
        const t = turnoActual;
        // Efectivo
        document.getElementById('catEfectivoARS').textContent = formatMoney(t.efectivo_actual_ars);
        document.getElementById('catEfectivoUSD').textContent = t.efectivo_actual_usd > 0 ? `US$${t.efectivo_actual_usd.toFixed(0)}` : '';
        // Bancos
        document.getElementById('catBancosARS').textContent = formatMoney(t.bancos_ars);
        document.getElementById('catBancosUSD').textContent = t.bancos_usd > 0 ? `US$${t.bancos_usd.toFixed(0)}` : '';
        document.getElementById('catBancosOps').textContent = `${t.bancos_operaciones} transf.`;
        // Tarjetas
        document.getElementById('catTarjetasARS').textContent = formatMoney(t.tarjetas_total);
        document.getElementById('catTarjetasCupones').textContent = `${t.tarjetas_cupones} cupones`;
        // MP
        document.getElementById('catMPARS').textContent = formatMoney(t.mp_total);
        document.getElementById('catMPOps').textContent = `${t.mp_operaciones} ops`;
        // Cheques
        document.getElementById('catChequesARS').textContent = formatMoney(t.cheques_ars);
        document.getElementById('catChequesUSD').textContent = t.cheques_usd > 0 ? `US$${t.cheques_usd.toFixed(0)}` : '';
        document.getElementById('catChequesCant').textContent = `${t.cheques_cantidad} docs`;
        // Arqueo
        document.getElementById('arqueoSistemaARS').textContent = formatMoney(t.efectivo_actual_ars);
        document.getElementById('arqueoSistemaUSD').textContent = `US$${(t.efectivo_actual_usd || 0).toFixed(2)}`;
    }

    async function confirmarAbrirCaja() {
        try {
            const res = await fetch(`${API_URL}/cajas-cobranzas/cajas/abrir`, { method: 'POST', headers, body: JSON.stringify({ id_caja: ID_CAJA, monto_inicial_ars: parseFloat(document.getElementById('abrirMontoARS').value) || 0, monto_inicial_usd: parseFloat(document.getElementById('abrirMontoUSD').value) || 0 }) });
            if (res.ok) { modalAbrirCaja.hide(); await cargarEstadoCaja(); mostrarNotificacion('Caja abierta', 'success'); }
            else { const d = await res.json(); mostrarNotificacion(d.error, 'danger'); }
        } catch (e) { mostrarNotificacion('Error', 'danger'); }
    }

    async function cargarCatalogos() {
        try {
            const [fp, tj, bc] = await Promise.all([fetch(`${API_URL}/formas-pago`, { headers }), fetch(`${API_URL}/tarjetas`, { headers }), fetch(`${API_URL}/bancos`, { headers })]);
            formasPagoDisponibles = await fp.json(); tarjetas = await tj.json(); bancos = await bc.json();
            renderizarFormasPago();
        } catch (e) { console.error(e); }
    }

    function renderizarFormasPago() {
        document.getElementById('formasPagoGrid').innerHTML = formasPagoDisponibles.filter(f => f.activo !== false).map(f => `<div class="forma-pago-btn" data-codigo="${f.codigo}" onclick="seleccionarFormaPago(${f.id_forma_pago},'${f.codigo}','${f.tipo||''}')"><i class="bi ${iconos[f.codigo]||'bi-wallet2'}"></i><span>${f.nombre}</span></div>`).join('');
    }

    function seleccionarFormaPago(id, codigo, tipo) {
        formaPagoActual = { id_forma_pago: id, codigo, tipo };
        document.querySelectorAll('.forma-pago-btn').forEach(b => b.classList.toggle('selected', b.dataset.codigo === codigo));
        const base = parseFloat(document.getElementById('montoACobrar').value) || 0;
        const pagado = pagosAgregados.reduce((s,p) => s + p.monto, 0);
        const resta = Math.max(0, base - pagado);
        if (codigo === 'EFECTIVO' && resta > 0) { agregarPago({ id_forma_pago: id, codigo, tipo, monto: resta, id_moneda: 1, descripcion: 'Efectivo' }); return; }
        if (resta > 0) { prepararModalPago(resta); modalDetallePago.show(); }
    }

    function prepararModalPago(monto) {
        const f = formaPagoActual;
        document.getElementById('modalDetalleTitulo').textContent = f.codigo.replace(/_/g,' ');
        document.getElementById('detalleMontoInput').value = monto.toFixed(2);
        document.getElementById('detalleReferenciaInput').value = '';
        document.getElementById('detalleRecargoInfo').innerHTML = '';
        const esTarjeta = f.codigo.includes('TARJETA');
        const esBanco = ['TRANSFERENCIA','CHEQUE'].includes(f.codigo);
        const esRef = esBanco || esTarjeta || f.codigo === 'MERCADOPAGO';
        document.getElementById('detalleTarjetaGroup').style.display = esTarjeta ? 'block' : 'none';
        document.getElementById('detalleCuotasGroup').style.display = f.codigo === 'TARJETA_CREDITO' ? 'block' : 'none';
        document.getElementById('detalleBancoGroup').style.display = esBanco ? 'block' : 'none';
        document.getElementById('detalleReferenciaGroup').style.display = esRef ? 'block' : 'none';
        if (esTarjeta) { const t = f.codigo === 'TARJETA_CREDITO' ? 'credito' : 'debito'; document.getElementById('detalleTarjetaInput').innerHTML = tarjetas.filter(x => x.tipo === t && x.activo).map(x => `<option value="${x.id_tarjeta}">${x.nombre}</option>`).join(''); }
        if (esBanco) document.getElementById('detalleBancoInput').innerHTML = '<option value="">Seleccionar...</option>' + bancos.map(b => `<option value="${b.id_banco}">${b.nombre}</option>`).join('');
        if (f.codigo === 'MERCADOPAGO') document.getElementById('detalleRecargoInfo').innerHTML = '<div class="alert alert-warning py-1 small">MercadoPago: 4.5% recargo</div>';
    }

    function agregarPagoDetalle() {
        const monto = parseFloat(document.getElementById('detalleMontoInput').value) || 0;
        if (monto <= 0) return;
        const f = formaPagoActual;
        const pago = { id_forma_pago: f.id_forma_pago, codigo: f.codigo, tipo: f.tipo, monto, id_moneda: parseInt(document.getElementById('detalleMonedaInput').value) || 1, descripcion: f.codigo.replace(/_/g,' ') };
        if (f.codigo.includes('TARJETA')) { pago.id_tarjeta = document.getElementById('detalleTarjetaInput').value; if (f.codigo === 'TARJETA_CREDITO') pago.cuotas = parseInt(document.getElementById('detalleCuotasInput').value); pago.numero_referencia = document.getElementById('detalleReferenciaInput').value; }
        if (['TRANSFERENCIA','CHEQUE'].includes(f.codigo)) { pago.id_banco = document.getElementById('detalleBancoInput').value; pago.numero_referencia = document.getElementById('detalleReferenciaInput').value; }
        if (f.codigo === 'MERCADOPAGO') pago.numero_referencia = document.getElementById('detalleReferenciaInput').value;
        agregarPago(pago);
        modalDetallePago.hide();
    }

    function agregarPago(p) { pagosAgregados.push(p); renderizarPagos(); calcularResumen(); document.getElementById('sinFormasPago').style.display = 'none'; }
    function eliminarPago(i) { pagosAgregados.splice(i, 1); renderizarPagos(); calcularResumen(); if (!pagosAgregados.length) document.getElementById('sinFormasPago').style.display = 'block'; }
    function renderizarPagos() { const c = document.getElementById('pagosAgregados'), l = document.getElementById('listaPagos'); if (!pagosAgregados.length) { c.style.display = 'none'; return; } c.style.display = 'block'; l.innerHTML = pagosAgregados.map((p,i) => `<div class="pago-item"><div class="info"><i class="bi ${iconos[p.codigo]||'bi-wallet2'}"></i> ${p.descripcion}</div><div class="monto">${formatMoney(p.monto)}</div><button class="btn-remove" onclick="eliminarPago(${i})"><i class="bi bi-x"></i></button></div>`).join(''); }
    function calcularResumen() { const base = parseFloat(document.getElementById('montoACobrar').value) || 0; let ing = 0, rec = 0; pagosAgregados.forEach(p => { ing += p.monto; if (p.codigo === 'MERCADOPAGO') rec += p.monto * 0.045; }); const total = base + rec, dif = ing - total; document.getElementById('displayTotalCobrar').textContent = formatMoney(total); document.getElementById('displaySubtotal').textContent = formatMoney(base); document.getElementById('displayRecargos').textContent = formatMoney(rec); document.getElementById('displayIngresado').textContent = formatMoney(ing); document.getElementById('displayDiferencia').textContent = formatMoney(Math.abs(dif)); document.getElementById('displayDiferencia').className = Math.abs(dif) < 0.01 && ing > 0 ? 'text-success' : 'text-danger'; document.getElementById('btnCobrar').disabled = !(Math.abs(dif) < 0.01 && ing > 0 && turnoActual); }
    document.getElementById('montoACobrar').addEventListener('input', calcularResumen);

    async function procesarCobro() {
        if (!turnoActual) return;
        const monto = parseFloat(document.getElementById('montoACobrar').value), concepto = document.getElementById('conceptoCobro').value, sin = document.getElementById('sinCliente').checked;
        if (!monto || !pagosAgregados.length) return;
        const items = pagosAgregados.map(p => ({ id_forma_pago: p.id_forma_pago, id_moneda: p.id_moneda || 1, monto: p.monto, id_tarjeta: p.id_tarjeta || null, cuotas: p.cuotas || 1, id_banco: p.id_banco || null, referencia: p.numero_referencia || null }));
        try {
            const res = await fetch(`${API_URL}/recibos`, { method: 'POST', headers, body: JSON.stringify({ id_turno: turnoActual.id_turno, id_cliente: sin ? null : clienteSeleccionado?.id_cliente, total_recibo: monto, concepto, pagos: items, es_a_cuenta: sin || !clienteSeleccionado }) });
            if (res.ok) { mostrarNotificacion('✅ Cobro registrado', 'success'); limpiarFormulario(); await cargarEstadoCaja(); }
            else { const d = await res.json(); mostrarNotificacion(d.error, 'danger'); }
        } catch (e) { mostrarNotificacion('Error', 'danger'); }
    }

    function limpiarFormulario() { document.getElementById('montoACobrar').value = ''; document.getElementById('conceptoCobro').value = ''; document.getElementById('sinCliente').checked = false; clienteSeleccionado = null; pagosAgregados = []; document.getElementById('seccionClienteSeleccionado').style.display = 'none'; document.getElementById('seccionBuscarCliente').style.display = 'block'; document.getElementById('inputBuscarCliente').value = ''; document.getElementById('sinFormasPago').style.display = 'block'; document.getElementById('pagosAgregados').style.display = 'none'; document.querySelectorAll('.forma-pago-btn').forEach(b => b.classList.remove('selected')); calcularResumen(); }

    function configurarTabs() { document.querySelectorAll('#navTabs .nav-link').forEach(l => l.addEventListener('click', e => { e.preventDefault(); const tab = e.currentTarget.dataset.tab; document.querySelectorAll('#navTabs .nav-link').forEach(x => x.classList.remove('active')); e.currentTarget.classList.add('active'); document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none'); document.getElementById(`tab-${tab}`).style.display = 'block'; if (tab === 'movimientos') cargarMovimientos(); if (tab === 'arqueo') cargarDatosArqueo(); })); }

    function configurarBusquedaClientes() { const inp = document.getElementById('inputBuscarCliente'), res = document.getElementById('resultadosClientes'); inp.addEventListener('input', debounce(async e => { const t = e.target.value.trim(); if (t.length < 2) { res.style.display = 'none'; return; } try { const r = await fetch(`${API_URL}/clientes/buscar-cobranzas?q=${encodeURIComponent(t)}`, { headers }); const cls = await r.json(); res.innerHTML = cls.length ? cls.slice(0,8).map(c => `<div class="resultado-item" onclick="seleccionarCliente(${c.id_cliente})"><strong>${c.razon_social}</strong><div class="small text-muted">${c.cuit_cuil||''}</div></div>`).join('') : '<div class="resultado-item text-muted">No encontrado</div>'; res.style.display = 'block'; } catch (e) {} }, 300)); document.addEventListener('click', e => { if (!e.target.closest('.cliente-search-box')) res.style.display = 'none'; }); }

    async function seleccionarCliente(id) { try { const r = await fetch(`${API_URL}/clientes/${id}`, { headers }); const c = await r.json(); clienteSeleccionado = c; document.getElementById('resultadosClientes').style.display = 'none'; document.getElementById('seccionBuscarCliente').style.display = 'none'; document.getElementById('seccionClienteSeleccionado').style.display = 'block'; document.getElementById('seccionClienteSeleccionado').innerHTML = `<div class="cliente-seleccionado"><div><strong>${c.razon_social}</strong><div class="small text-muted">${c.cuit_cuil||''}</div></div><button class="btn btn-sm btn-outline-danger" onclick="deseleccionarCliente()"><i class="bi bi-x"></i></button></div>`; } catch (e) {} }
    function deseleccionarCliente() { clienteSeleccionado = null; document.getElementById('seccionClienteSeleccionado').style.display = 'none'; document.getElementById('seccionBuscarCliente').style.display = 'block'; }
    function toggleSinCliente() { if (document.getElementById('sinCliente').checked) { clienteSeleccionado = null; document.getElementById('seccionBuscarCliente').style.display = 'none'; document.getElementById('seccionClienteSeleccionado').style.display = 'none'; } else document.getElementById('seccionBuscarCliente').style.display = 'block'; }

    async function cargarMovimientos() { if (!turnoActual) return; const tb = document.getElementById('tablaMovimientos'); tb.innerHTML = '<tr><td colspan="6" class="text-center">Cargando...</td></tr>'; try { const r = await fetch(`${API_URL}/cajas-cobranzas/movimientos/${turnoActual.id_turno}`, { headers }); const m = await r.json(); tb.innerHTML = m.length ? m.map(x => `<tr><td>${new Date(x.fecha_movimiento).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</td><td><span class="badge-lago ${x.tipo==='ingreso'?'success':'danger'}">${x.tipo.toUpperCase()}</span></td><td>${x.concepto||'-'}</td><td>${x.forma_pago_nombre||'-'}</td><td class="text-end fw-bold ${x.tipo==='ingreso'?'text-success':'text-danger'}">${x.moneda_simbolo||'$'}${parseFloat(x.monto).toFixed(2)}</td><td>${x.usuario_nombre||'-'}</td></tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted">Sin movimientos</td></tr>'; } catch (e) { tb.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Error</td></tr>'; } }

    function agregarMovimientoManual(tipo) { if (!turnoActual) return; document.getElementById('movimientoTipo').value = tipo; document.getElementById('modalMovimientoTitulo').textContent = tipo === 'ingreso' ? 'Ingreso Manual' : 'Egreso Manual'; document.getElementById('movimientoMonto').value = ''; document.getElementById('movimientoConcepto').value = ''; modalMovimiento.show(); }
    async function guardarMovimientoManual() { const tipo = document.getElementById('movimientoTipo').value, monto = parseFloat(document.getElementById('movimientoMonto').value), concepto = document.getElementById('movimientoConcepto').value, moneda = document.getElementById('movimientoMoneda').value; if (!monto || !concepto) return; try { const r = await fetch(`${API_URL}/cajas-cobranzas/movimientos`, { method: 'POST', headers, body: JSON.stringify({ id_turno: turnoActual.id_turno, tipo, monto, concepto, id_moneda: parseInt(moneda) }) }); if (r.ok) { modalMovimiento.hide(); mostrarNotificacion('Registrado', 'success'); await cargarMovimientos(); await cargarEstadoCaja(); } } catch (e) {} }

    function cargarDatosArqueo() { if (!turnoActual) return; actualizarCategoriasHeader(); document.getElementById('arqueoContadoARS').value = (turnoActual.efectivo_actual_ars || 0).toFixed(2); document.getElementById('arqueoContadoUSD').value = (turnoActual.efectivo_actual_usd || 0).toFixed(2); calcularDiferenciaArqueo(); }
    function calcularDiferenciaArqueo() { if (!turnoActual) return; const sARS = turnoActual.efectivo_actual_ars || 0, sUSD = turnoActual.efectivo_actual_usd || 0; const cARS = parseFloat(document.getElementById('arqueoContadoARS').value) || 0, cUSD = parseFloat(document.getElementById('arqueoContadoUSD').value) || 0; const dARS = cARS - sARS, dUSD = cUSD - sUSD; document.getElementById('arqueoDifARS').textContent = (dARS >= 0 ? '+' : '') + formatMoney(dARS); document.getElementById('arqueoDifARS').className = Math.abs(dARS) < 0.01 ? 'fs-5 fw-bold text-success' : 'fs-5 fw-bold text-danger'; document.getElementById('arqueoDifUSD').textContent = (dUSD >= 0 ? '+' : '') + `US$${dUSD.toFixed(2)}`; document.getElementById('arqueoDifUSD').className = Math.abs(dUSD) < 0.01 ? 'fs-5 fw-bold text-success' : 'fs-5 fw-bold text-danger'; document.getElementById('arqueoEstado').innerHTML = Math.abs(dARS) < 0.01 && Math.abs(dUSD) < 0.01 ? '<i class="bi bi-check-circle text-success"></i> CUADRA' : '<i class="bi bi-exclamation-triangle text-danger"></i> DIFERENCIA'; }

    async function confirmarCierreCaja() { if (!turnoActual || !confirm('¿Cerrar caja?')) return; try { const r = await fetch(`${API_URL}/cajas-cobranzas/cajas/cerrar`, { method: 'POST', headers, body: JSON.stringify({ id_turno: turnoActual.id_turno, arqueo_efectivo_ars: parseFloat(document.getElementById('arqueoContadoARS').value) || 0, arqueo_efectivo_usd: parseFloat(document.getElementById('arqueoContadoUSD').value) || 0, observaciones: document.getElementById('arqueoObservaciones').value }) }); if (r.ok) { mostrarNotificacion('Caja cerrada', 'success'); await cargarEstadoCaja(); document.querySelector('[data-tab="cobrar"]').click(); } } catch (e) {} }

    // IMPRIMIR Y EXPORTAR
    async function imprimirArqueo() {
        if (!turnoActual) return;
        try {
            const r = await fetch(`${API_URL}/cajas-cobranzas/arqueo/${turnoActual.id_turno}/datos`, { headers });
            const data = await r.json();
            // Abrir ventana de impresión con los datos
            const win = window.open('', '_blank');
            win.document.write(generarHTMLArqueo(data));
            win.document.close();
            setTimeout(() => { win.print(); }, 500);
        } catch (e) { mostrarNotificacion('Error al imprimir', 'danger'); }
    }

    function generarHTMLArqueo(data) {
        return `<!DOCTYPE html><html><head><title>Arqueo</title><style>body{font-family:Arial;font-size:12px;padding:20px}h1{font-size:16px}table{width:100%;border-collapse:collapse}th,td{padding:6px;border:1px solid #ddd;text-align:left}.right{text-align:right}</style></head><body><h1>ARQUEO DE CAJA - Turno #${data.turno.id_turno}</h1><p>Caja: ${data.turno.caja_nombre} | Apertura: ${new Date(data.turno.fecha_apertura).toLocaleString('es-AR')}</p><table><tr><th>Categoría</th><th>Moneda</th><th class="right">Ingresos</th><th class="right">Egresos</th><th>Ops</th></tr>${data.totales_por_categoria.map(t=>`<tr><td>${t.forma_pago||'Manual'}</td><td>${t.moneda_codigo||'ARS'}</td><td class="right">$${parseFloat(t.ingresos).toFixed(2)}</td><td class="right">$${parseFloat(t.egresos).toFixed(2)}</td><td>${t.operaciones}</td></tr>`).join('')}</table><p style="margin-top:30px">Generado: ${new Date().toLocaleString('es-AR')}</p></body></html>`;
    }

    async function exportarExcel() {
        if (!turnoActual) return;
        try {
            const r = await fetch(`${API_URL}/cajas-cobranzas/movimientos/${turnoActual.id_turno}/exportar`, { headers });
            const data = await r.json();
            const ws = XLSX.utils.json_to_sheet(data.movimientos.map(m => ({ Fecha: new Date(m.fecha_movimiento).toLocaleString('es-AR'), Tipo: m.tipo, Concepto: m.concepto, Monto: m.monto, Moneda: m.moneda, FormaPago: m.forma_pago, Usuario: m.usuario })));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
            XLSX.writeFile(wb, `movimientos_turno_${turnoActual.id_turno}.xlsx`);
            mostrarNotificacion('Excel exportado', 'success');
        } catch (e) { mostrarNotificacion('Error al exportar', 'danger'); }
    }

    function formatMoney(n) { return '$' + (parseFloat(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function debounce(fn, wait) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; }
    function mostrarNotificacion(msg, tipo = 'info') { let c = document.getElementById('toastContainer'); if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.className = 'toast-container position-fixed top-0 end-0 p-3'; c.style.zIndex = '9999'; document.body.appendChild(c); } const t = document.createElement('div'); t.className = `toast align-items-center text-white bg-${tipo} border-0`; t.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`; c.appendChild(t); new bootstrap.Toast(t, { delay: 3000 }).show(); }
    function configurarAtajos() { document.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); if (!document.getElementById('btnCobrar').disabled) procesarCobro(); } if (e.key === 'F4') { e.preventDefault(); limpiarFormulario(); document.getElementById('montoACobrar').focus(); } if (e.key === 'Escape') limpiarFormulario(); }); }
    function cerrarSesion() { localStorage.clear(); window.location.href = 'login.html'; }
    </script>
</body>
</html>
'''

def main():
    print("="*60)
    print("ERP LAGO - Actualización Tesorería Completa")
    print("="*60)
    
    # 1. Controller
    controller_path = os.path.join(BASE_DIR, 'src/controllers/cajas-cobranzas.controller.js')
    backup_file(controller_path)
    with open(controller_path, 'w', encoding='utf-8') as f:
        f.write(CONTROLLER_CODE)
    print(f"✅ Controller actualizado: {controller_path}")
    
    # 2. Template Handlebars
    templates_dir = os.path.join(BASE_DIR, 'templates/comprobantes')
    os.makedirs(templates_dir, exist_ok=True)
    template_path = os.path.join(templates_dir, 'arqueo_caja.hbs')
    with open(template_path, 'w', encoding='utf-8') as f:
        f.write(TEMPLATE_ARQUEO)
    print(f"✅ Template creado: {template_path}")
    
    # 3. Frontend HTML
    frontend_path = os.path.join(BASE_DIR, 'frontend/tesoreria.html')
    backup_file(frontend_path)
    with open(frontend_path, 'w', encoding='utf-8') as f:
        f.write(FRONTEND_HTML)
    print(f"✅ Frontend actualizado: {frontend_path}")
    
    # 4. Agregar rutas si no existen
    routes_path = os.path.join(BASE_DIR, 'src/routes/cajas-cobranzas.routes.js')
    with open(routes_path, 'r', encoding='utf-8') as f:
        routes_content = f.read()
    
    nuevas_rutas = """
// Exportar y Arqueo
router.get('/movimientos/:id_turno/exportar', verificarToken, controller.exportarMovimientosExcel);
router.get('/arqueo/:id_turno/datos', verificarToken, controller.obtenerDatosArqueo);
"""
    
    if 'exportarMovimientosExcel' not in routes_content:
        # Insertar antes del module.exports
        if 'module.exports' in routes_content:
            routes_content = routes_content.replace('module.exports', nuevas_rutas + '\nmodule.exports')
        else:
            routes_content += nuevas_rutas
        
        backup_file(routes_path)
        with open(routes_path, 'w', encoding='utf-8') as f:
            f.write(routes_content)
        print(f"✅ Rutas agregadas: {routes_path}")
    else:
        print(f"ℹ️  Rutas ya existían")
    
    print("")
    print("="*60)
    print("✅ ACTUALIZACIÓN COMPLETA")
    print("="*60)
    print("")
    print("Ahora ejecutá:")
    print("  cd /root/mi_erp && source ~/.nvm/nvm.sh && pm2 restart erplago")
    print("")
    print("Probá en: https://erp.lago.ar/tesoreria.html")

if __name__ == '__main__':
    main()
