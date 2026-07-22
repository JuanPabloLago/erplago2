/**
 * ADAPTER DASHBOARD — INSERT en notificaciones_dashboard (badge in-app)
 * Solo se aplica a destinatarios tipo 'admin' (clientes no entran al ERP).
 */
async function _usuariosAdminActivos(client, id_empresa) {
    const r = await client.query(`
        SELECT id_usuario FROM usuarios
         WHERE id_empresa = $1
           AND estado = 'activo'
           AND rol IN ('admin','administrador')
    `, [id_empresa]);
    return r.rows.map(x => x.id_usuario);
}

async function enviar(client, args) {
    const { id_empresa, evento, contexto, destinatario, render } = args;

    if (destinatario.tipo !== 'admin') {
        return { enviada: false, suprimida: true, motivo: 'dashboard_solo_admin' };
    }

    const usuarios = await _usuariosAdminActivos(client, id_empresa);
    if (!usuarios.length) {
        return { enviada: false, suprimida: true, motivo: 'sin_admins_activos' };
    }

    const nivel = evento.includes('pendiente_24h') ? 'warning' : 'info';
    const icono = evento.startsWith('pedido_web') ? 'bi-cart-check' : 'bi-bell';
    const link = contexto.id_pedido
        ? `/pedidos-web.html?pedido=${contexto.id_pedido}`
        : '/pedidos-web.html';

    for (const id_usuario of usuarios) {
        await client.query(`
            INSERT INTO notificaciones_dashboard (
                id_empresa, id_usuario, evento, titulo, mensaje, link, icono, nivel
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            id_empresa, id_usuario, evento,
            render.asunto || evento,
            render.cuerpo_plano || null,
            link, icono, nivel
        ]);
    }

    return { enviada: true };
}

module.exports = { enviar };
