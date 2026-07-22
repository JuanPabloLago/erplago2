'use strict';

const pool = require('../config/database');
const terminalesHelper = require('../utils/terminales.helper');

// ═══════════════════════════════════════════════════════════════════════
// TERMINALES.CONTROLLER.JS — Endpoints para ABM terminales + cuotas
// ERP LAGO — 2026-03-14
// ═══════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────
// TERMINALES
// ─────────────────────────────────────────────────────────────────────

async function listarTerminales(req, res) {
    const client = await pool.connect();
    try {
        const terminales = await terminalesHelper.listarTerminales(client, req.usuario.id_empresa);
        res.json(terminales);
    } catch (error) {
        console.error('Error listarTerminales:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

// Activas filtradas por depósito del usuario (para venta-rápida)
async function obtenerActivas(req, res) {
    const client = await pool.connect();
    try {
        const terminales = await terminalesHelper.obtenerTerminalesActivas(
            client, req.usuario.id_empresa, req.usuario.id_deposito
        );
        res.json(terminales);
    } catch (error) {
        console.error('Error obtenerActivas:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function obtenerTerminal(req, res) {
    const client = await pool.connect();
    try {
        const terminal = await terminalesHelper.obtenerTerminal(
            client, parseInt(req.params.id), req.usuario.id_empresa
        );
        if (!terminal) return res.status(404).json({ error: 'Terminal no encontrada' });
        res.json(terminal);
    } catch (error) {
        console.error('Error obtenerTerminal:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function crearTerminal(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const terminal = await terminalesHelper.crearTerminal(client, {
            ...req.body,
            id_empresa: req.usuario.id_empresa
        });
        await client.query('COMMIT');
        res.status(201).json(terminal);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error crearTerminal:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function actualizarTerminal(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const terminal = await terminalesHelper.actualizarTerminal(
            client, parseInt(req.params.id), req.usuario.id_empresa, req.body
        );
        await client.query('COMMIT');
        res.json(terminal);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizarTerminal:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function desactivarTerminal(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const terminal = await terminalesHelper.desactivarTerminal(
            client, parseInt(req.params.id), req.usuario.id_empresa
        );
        await client.query('COMMIT');
        res.json(terminal);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error desactivarTerminal:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────────────────────────────
// PLANES DE CUOTAS
// ─────────────────────────────────────────────────────────────────────

async function obtenerPlanes(req, res) {
    const client = await pool.connect();
    try {
        const planes = await terminalesHelper.obtenerPlanesTerminal(
            client, parseInt(req.params.id_terminal), req.usuario.id_empresa
        );
        res.json(planes);
    } catch (error) {
        console.error('Error obtenerPlanes:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function crearPlan(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const plan = await terminalesHelper.crearPlan(client, {
            ...req.body,
            id_empresa: req.usuario.id_empresa,
            id_terminal: parseInt(req.params.id_terminal)
        });
        await client.query('COMMIT');
        res.status(201).json(plan);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error crearPlan:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function actualizarPlan(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const plan = await terminalesHelper.actualizarPlan(
            client, parseInt(req.params.id_plan), req.usuario.id_empresa, req.body
        );
        await client.query('COMMIT');
        res.json(plan);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizarPlan:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function desactivarPlan(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const plan = await terminalesHelper.desactivarPlan(
            client, parseInt(req.params.id_plan), req.usuario.id_empresa
        );
        await client.query('COMMIT');
        res.json(plan);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error desactivarPlan:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

async function actualizarPlanesMasivo(req, res) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const resultados = await terminalesHelper.actualizarPlanesMasivo(
            client, parseInt(req.params.id_terminal), req.usuario.id_empresa, req.body.planes
        );
        await client.query('COMMIT');
        res.json({ actualizados: resultados.length, planes: resultados });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error actualizarPlanesMasivo:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────────────────────────────
// PREVIEW (para frontend — sin transacción)
// ─────────────────────────────────────────────────────────────────────

async function previewCuotas(req, res) {
    const client = await pool.connect();
    try {
        const preview = await terminalesHelper.previewCuotas(
            client, parseInt(req.params.id_terminal), req.usuario.id_empresa, parseFloat(req.params.monto)
        );
        res.json(preview);
    } catch (error) {
        console.error('Error previewCuotas:', error.message);
        res.status(400).json({ error: error.message });
    } finally {
        client.release();
    }
}

// ─────────────────────────────────────────────────────────────────────
// FORM DATA (para selects del frontend)
// ─────────────────────────────────────────────────────────────────────

async function formData(req, res) {
    const client = await pool.connect();
    try {
        const [bancos, depositos] = await Promise.all([
            client.query('SELECT id_banco, nombre FROM bancos ORDER BY nombre'),
            client.query('SELECT id_deposito, nombre FROM depositos WHERE id_empresa = $1 ORDER BY nombre', [req.usuario.id_empresa])
        ]);
        res.json({ bancos: bancos.rows, depositos: depositos.rows });
    } catch (error) {
        console.error('Error formData:', error.message);
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
}

module.exports = {
    listarTerminales,
    obtenerActivas,
    obtenerTerminal,
    crearTerminal,
    actualizarTerminal,
    desactivarTerminal,
    obtenerPlanes,
    crearPlan,
    actualizarPlan,
    desactivarPlan,
    actualizarPlanesMasivo,
    previewCuotas,
    formData
};
