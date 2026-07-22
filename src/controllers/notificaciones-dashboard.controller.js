/**
 * NOTIFICACIONES-DASHBOARD CONTROLLER — ERP LAGO
 * Endpoints para el badge in-app del navbar.
 * Cada usuario ve solo SUS notificaciones (aislamiento por id_usuario + id_empresa).
 */
const pool = require('../config/database');

exports.listar = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_usuario = req.usuario.id_usuario;
    const incluirLeidas = req.query.incluir_leidas === 'true';
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

    try {
        const filtros = incluirLeidas ? '' : 'AND leida = false';
        const r = await pool.query(`
            SELECT id_notif_dash, evento, titulo, mensaje, link, icono, nivel,
                   leida, fecha_creacion, fecha_leida
              FROM notificaciones_dashboard
             WHERE id_empresa = $1 AND id_usuario = $2 ${filtros}
             ORDER BY fecha_creacion DESC
             LIMIT $3
        `, [id_empresa, id_usuario, limit]);

        const cnt = await pool.query(`
            SELECT COUNT(*)::int AS no_leidas
              FROM notificaciones_dashboard
             WHERE id_empresa = $1 AND id_usuario = $2 AND leida = false
        `, [id_empresa, id_usuario]);

        return res.json({
            items: r.rows,
            no_leidas_total: cnt.rows[0].no_leidas
        });
    } catch (e) {
        console.error('notif-dashboard.listar:', e);
        return res.status(500).json({ error: e.message });
    }
};

exports.marcarLeida = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_usuario = req.usuario.id_usuario;
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id invalido' });

    try {
        const r = await pool.query(`
            UPDATE notificaciones_dashboard
               SET leida = true, fecha_leida = NOW()
             WHERE id_notif_dash = $1 AND id_empresa = $2 AND id_usuario = $3
               AND leida = false
            RETURNING id_notif_dash
        `, [id, id_empresa, id_usuario]);

        if (r.rowCount === 0) {
            return res.status(404).json({ error: 'No encontrada o ya leida' });
        }
        return res.json({ id_notif_dash: id, leida: true });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

exports.leerTodo = async (req, res) => {
    const id_empresa = req.usuario.id_empresa;
    const id_usuario = req.usuario.id_usuario;

    try {
        const r = await pool.query(`
            UPDATE notificaciones_dashboard
               SET leida = true, fecha_leida = NOW()
             WHERE id_empresa = $1 AND id_usuario = $2 AND leida = false
            RETURNING id_notif_dash
        `, [id_empresa, id_usuario]);
        return res.json({ marcadas_leidas: r.rowCount });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};
