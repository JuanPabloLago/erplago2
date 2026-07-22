/**
 * ADAPTER EMAIL — nodemailer + SMTP
 * Lee config: notificaciones.email.* + credenciales de process.env
 *
 * Sin cache de transporter: cada envío crea uno nuevo y hace close() al final.
 * Gmail cierra sockets inactivos -> cachear causa "Unexpected socket close".
 * Volumen actual es bajo, el costo de crear transporter por mensaje es despreciable.
 */
const nodemailer = require('nodemailer');
const cfg = require('../config.helper');

async function _resolverDireccion(client, id_empresa, destinatario) {
    if (destinatario.addr) return destinatario.addr;
    if (destinatario.tipo === 'admin') {
        return await cfg.get(client, id_empresa, 'notificaciones.email.admin_to', null);
    }
    if (destinatario.tipo === 'cliente' && destinatario.id_cliente) {
        const r = await client.query(
            'SELECT email FROM clientes WHERE id_cliente = $1 AND id_empresa = $2',
            [destinatario.id_cliente, id_empresa]
        );
        return r.rows.length ? r.rows[0].email : null;
    }
    return null;
}

async function enviar(client, args) {
    const { id_empresa, destinatario, render } = args;

    const to = await _resolverDireccion(client, id_empresa, destinatario);
    if (!to) return { enviada: false, suprimida: true, motivo: 'sin_direccion_destinatario' };

    const from = await cfg.get(client, id_empresa, 'notificaciones.email.from', 'noreply@erp.local');

    // Config SMTP (toda configurable, ningun valor hardcoded)
    // cfg.get hace cast automatico (puede devolver string/number/boolean segun
    // como PostgreSQL infiera el contenido). Normalizamos defensivamente.
    const hostRaw = await cfg.get(client, id_empresa, 'notificaciones.email.smtp_host', 'smtp.gmail.com');
    const portRaw = await cfg.get(client, id_empresa, 'notificaciones.email.smtp_port', '465');
    const secureRaw = await cfg.get(client, id_empresa, 'notificaciones.email.smtp_secure', 'true');

    const host = String(hostRaw);
    const port = parseInt(portRaw, 10);
    const secure = (secureRaw === true || secureRaw === 'true' || secureRaw === 1);
    const userEnv = await cfg.get(client, id_empresa, 'notificaciones.email.smtp_user_env_var', 'EMAIL_USER');
    const passEnv = await cfg.get(client, id_empresa, 'notificaciones.email.smtp_pass_env_var', 'EMAIL_PASS');
    const user = process.env[userEnv];
    const pass = process.env[passEnv];

    if (!user || !pass) {
        return { enviada: false, error: `adapter-email: ${userEnv} o ${passEnv} no estan en process.env` };
    }

    const transporter = nodemailer.createTransport({
        host, port, secure,
        auth: { user, pass }
    });

    try {
        // verify() abre la conexion, hace login y la deja lista para sendMail.
        // Sin verify() previo, en algunos contextos nodemailer dispara
        // "Unexpected socket close" antes de terminar el handshake SMTP.
        await transporter.verify();
        await transporter.sendMail({
            from, to,
            subject: render.asunto || '(sin asunto)',
            html: render.cuerpo || '(sin cuerpo)'
        });
        return { enviada: true };
    } catch (e) {
        return { enviada: false, error: e.message };
    } finally {
        // Siempre cerrar para no dejar sockets colgados
        try { transporter.close(); } catch (_) { /* noop */ }
    }
}

module.exports = { enviar };
