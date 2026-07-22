/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTH-WEB HELPER — ERP LAGO
 * Centraliza autenticacion de CLIENTES web (no usuarios staff)
 * ═══════════════════════════════════════════════════════════════════════════
 * TABLAS: clientes (cols web), web_login_intentos
 * CONSUMIDORES: auth-web.controller.js, auth-web.middleware.js
 *
 * Toda configuracion vive en configuraciones_empresa (prefijo web.*).
 * Cero hardcodes. Cero defaults silenciosos sobre seguridad.
 *
 * FUNCIONES:
 *   - hashPassword / verifyPassword
 *   - generarTokenHex
 *   - firmarJWT / verificarJWT
 *   - registrarCliente
 *   - autenticar (con anti brute-force)
 *   - registrarIntentoLogin
 *   - estaBloqueado
 *   - generarTokenRecupero / consumirTokenRecupero
 *   - cambiarPassword
 *   - tocarUltimoLogin
 *   - obtenerClientePorUsuario
 *   - obtenerClientePorId
 */

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const cfg      = require('./config.helper');

// ─────────────────────────────────────────────────────────────────────────
// CRYPTO PRIMITIVO
// ─────────────────────────────────────────────────────────────────────────

async function hashPassword(client, id_empresa, plainPassword) {
    if (!plainPassword || plainPassword.length < 6) {
        throw new Error('La contraseña debe tener al menos 6 caracteres');
    }
    const rounds = await cfg.get(client, id_empresa, 'web.bcrypt_rounds', 10);
    return bcrypt.hash(plainPassword, parseInt(rounds, 10));
}

async function verifyPassword(plainPassword, hash) {
    if (!plainPassword || !hash) return false;
    return bcrypt.compare(plainPassword, hash);
}

function generarTokenHex(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

// ─────────────────────────────────────────────────────────────────────────
// JWT
// ─────────────────────────────────────────────────────────────────────────

async function firmarJWT(client, id_empresa, payload) {
    const secret = await cfg.get(client, id_empresa, 'web.jwt_secret', null);
    if (!secret) throw new Error('web.jwt_secret no configurado en configuraciones_empresa');
    const dias = await cfg.get(client, id_empresa, 'web.jwt_dias_validez', 30);
    return jwt.sign(payload, secret, { expiresIn: `${dias}d` });
}

async function verificarJWT(client, id_empresa, token) {
    if (!token) return null;
    const secret = await cfg.get(client, id_empresa, 'web.jwt_secret', null);
    if (!secret) throw new Error('web.jwt_secret no configurado');
    try {
        return jwt.verify(token, secret);
    } catch (e) {
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────
// LOOKUPS
// ─────────────────────────────────────────────────────────────────────────

async function obtenerClientePorUsuario(client, id_empresa, usuario_web) {
    if (!usuario_web) return null;
    const r = await client.query(`
        SELECT id_cliente, id_empresa, razon_social, nombre_fantasia, email, telefono,
               id_lista_precio, id_condicion_iva, cuit_cuil, domicilio, localidad, provincia,
               usuario_web, password_hash, email_verificado, web_activo, web_aprobado, web_origen,
               fecha_alta_web, ultimo_login_web
          FROM clientes
         WHERE id_empresa = $1
           AND lower(usuario_web) = lower($2)
         LIMIT 1
    `, [id_empresa, usuario_web]);
    return r.rows[0] || null;
}

async function obtenerClientePorId(client, id_empresa, id_cliente) {
    const r = await client.query(`
        SELECT id_cliente, id_empresa, razon_social, nombre_fantasia, email, telefono,
               id_lista_precio, id_condicion_iva, cuit_cuil, domicilio, localidad, provincia,
               usuario_web, email_verificado, web_activo, web_aprobado, web_origen,
               fecha_alta_web, ultimo_login_web
          FROM clientes
         WHERE id_empresa = $1 AND id_cliente = $2
         LIMIT 1
    `, [id_empresa, id_cliente]);
    return r.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// REGISTRO (auto-registro desde la web)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Registra un cliente nuevo desde el formulario público de la web.
 * Se crea con id_condicion_iva = Consumidor Final, lista de precio publica,
 * web_aprobado segun configuracion. Devuelve el cliente creado.
 */
async function registrarCliente(client, id_empresa, datos) {
    const { usuario_web, password, razon_social, email, telefono, cuit_cuil,
            domicilio, localidad, provincia } = datos;

    if (!usuario_web)   throw new Error('Usuario requerido');
    if (!password)      throw new Error('Contraseña requerida');
    if (!razon_social)  throw new Error('Nombre/razón social requerido');

    // Verifica que no exista
    const existente = await obtenerClientePorUsuario(client, id_empresa, usuario_web);
    if (existente) throw new Error('Ese usuario ya está registrado');

    // Lee defaults desde configuraciones
    const id_lista_precio   = await cfg.get(client, id_empresa, 'web.id_lista_precio_publica', 1);
    const requiereAprob     = await cfg.get(client, id_empresa, 'web.auto_registro_requiere_aprobacion', true);
    const id_cond_iva_cf    = await cfg.get(client, id_empresa, 'clientes.id_condicion_iva_consumidor_final', 5);

    const password_hash     = await hashPassword(client, id_empresa, password);
    const token_verif       = generarTokenHex(32);

    const r = await client.query(`
        INSERT INTO clientes (
            id_empresa, razon_social, email, telefono, cuit_cuil,
            domicilio, localidad, provincia, id_condicion_iva, id_lista_precio,
            tipo_persona, activo,
            usuario_web, password_hash, token_verificacion, fecha_alta_web,
            web_activo, web_aprobado, web_origen
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            'fisica', true,
            $11, $12, $13, NOW(),
            true, $14, 'auto_registro'
        )
        RETURNING id_cliente, id_empresa, razon_social, email, usuario_web,
                  web_activo, web_aprobado, fecha_alta_web
    `, [
        id_empresa, razon_social, email || null, telefono || null, cuit_cuil || null,
        domicilio || null, localidad || null, provincia || null, id_cond_iva_cf, id_lista_precio,
        usuario_web, password_hash, token_verif, !requiereAprob
    ]);
    return r.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// LOGIN + ANTI BRUTE-FORCE
// ─────────────────────────────────────────────────────────────────────────

async function registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso, user_agent }) {
    await client.query(`
        INSERT INTO web_login_intentos (id_empresa, usuario_web, ip, exitoso, user_agent)
        VALUES ($1, $2, $3, $4, $5)
    `, [id_empresa, usuario_web || null, ip || null, !!exitoso, user_agent || null]);
}

/**
 * ¿Esta IP/usuario está bloqueada por demasiados intentos fallidos recientes?
 */
async function estaBloqueado(client, id_empresa, { usuario_web, ip }) {
    const maxIntentos = await cfg.get(client, id_empresa, 'web.max_intentos_login', 5);
    const minutos     = await cfg.get(client, id_empresa, 'web.bloqueo_login_minutos', 15);

    const r = await client.query(`
        SELECT COUNT(*)::int AS fallidos
          FROM web_login_intentos
         WHERE id_empresa = $1
           AND exitoso = false
           AND fecha > NOW() - ($2 || ' minutes')::interval
           AND ( (usuario_web IS NOT NULL AND lower(usuario_web) = lower($3))
              OR (ip IS NOT NULL AND ip = $4) )
    `, [id_empresa, String(minutos), usuario_web || null, ip || null]);

    return r.rows[0].fallidos >= maxIntentos;
}

/**
 * Autentica usuario_web + password. Devuelve cliente y JWT, o lanza error.
 * Registra el intento (exitoso o no) ANTES de devolver, salvo bloqueo previo.
 */
async function autenticar(client, id_empresa, { usuario_web, password, ip, user_agent }) {
    // 1. Bloqueo previo
    if (await estaBloqueado(client, id_empresa, { usuario_web, ip })) {
        throw new Error('Demasiados intentos fallidos. Intentá de nuevo en unos minutos.');
    }

    // 2. Buscar cliente
    const cliente = await obtenerClientePorUsuario(client, id_empresa, usuario_web);
    if (!cliente || !cliente.password_hash) {
        await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: false, user_agent });
        throw new Error('Usuario o contraseña incorrectos');
    }

    // 3. Verificar password
    const ok = await verifyPassword(password, cliente.password_hash);
    if (!ok) {
        await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: false, user_agent });
        throw new Error('Usuario o contraseña incorrectos');
    }

    // 4. Verificar habilitación
    if (!cliente.web_activo) {
        await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: false, user_agent });
        throw new Error('Tu cuenta web está desactivada. Contactá al administrador.');
    }
    if (!cliente.web_aprobado) {
        await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: false, user_agent });
        throw new Error('Tu cuenta está pendiente de aprobación. Te avisaremos cuando esté lista.');
    }

    // 5. (Opcional) verificación de email
    const requiereEmailVerif = await cfg.get(client, id_empresa, 'web.email_verificacion_obligatoria', false);
    if (requiereEmailVerif && !cliente.email_verificado) {
        await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: false, user_agent });
        throw new Error('Debés verificar tu email antes de ingresar.');
    }

    // 6. Login OK
    await registrarIntentoLogin(client, { id_empresa, usuario_web, ip, exitoso: true, user_agent });
    await tocarUltimoLogin(client, cliente.id_cliente);

    const token = await firmarJWT(client, id_empresa, {
        id_cliente:  cliente.id_cliente,
        id_empresa:  cliente.id_empresa,
        usuario_web: cliente.usuario_web,
        tipo:        'cliente_web'
    });

    // Limpiamos password_hash antes de devolver
    delete cliente.password_hash;
    return { cliente, token };
}

async function tocarUltimoLogin(client, id_cliente) {
    await client.query(
        `UPDATE clientes SET ultimo_login_web = NOW() WHERE id_cliente = $1`,
        [id_cliente]
    );
}

// ─────────────────────────────────────────────────────────────────────────
// RECUPERO DE CONTRASEÑA
// ─────────────────────────────────────────────────────────────────────────

/**
 * Genera token de recupero de password (válido 1 hora). Devuelve el token plano.
 * El controller decide cómo enviarlo (email, whatsapp, etc.).
 */
async function generarTokenRecupero(client, id_empresa, usuario_web) {
    const cliente = await obtenerClientePorUsuario(client, id_empresa, usuario_web);
    if (!cliente) {
        // Por seguridad, no revelamos si existe o no.
        return null;
    }
    const token = generarTokenHex(32);
    await client.query(`
        UPDATE clientes
           SET token_recupero = $1,
               token_recupero_exp = NOW() + INTERVAL '1 hour'
         WHERE id_cliente = $2
    `, [token, cliente.id_cliente]);
    return { token, cliente };
}

/**
 * Verifica el token, cambia el password y limpia el token.
 */
async function consumirTokenRecupero(client, id_empresa, token, nuevoPassword) {
    if (!token || !nuevoPassword) throw new Error('Token y nueva contraseña requeridos');

    const r = await client.query(`
        SELECT id_cliente
          FROM clientes
         WHERE id_empresa = $1
           AND token_recupero = $2
           AND token_recupero_exp > NOW()
         LIMIT 1
    `, [id_empresa, token]);

    if (!r.rows.length) throw new Error('Token inválido o vencido');

    const id_cliente = r.rows[0].id_cliente;
    const hash = await hashPassword(client, id_empresa, nuevoPassword);

    await client.query(`
        UPDATE clientes
           SET password_hash = $1,
               token_recupero = NULL,
               token_recupero_exp = NULL
         WHERE id_cliente = $2
    `, [hash, id_cliente]);

    return { id_cliente };
}

/**
 * Cambio de password con conocimiento del actual (cliente logueado).
 */
async function cambiarPassword(client, id_empresa, id_cliente, passwordActual, passwordNuevo) {
    const r = await client.query(
        `SELECT password_hash FROM clientes WHERE id_empresa = $1 AND id_cliente = $2`,
        [id_empresa, id_cliente]
    );
    if (!r.rows.length) throw new Error('Cliente no encontrado');
    const ok = await verifyPassword(passwordActual, r.rows[0].password_hash);
    if (!ok) throw new Error('Contraseña actual incorrecta');

    const hash = await hashPassword(client, id_empresa, passwordNuevo);
    await client.query(
        `UPDATE clientes SET password_hash = $1 WHERE id_cliente = $2 AND id_empresa = $3`,
        [hash, id_cliente, id_empresa]
    );
    return true;
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
    hashPassword,
    verifyPassword,
    generarTokenHex,
    firmarJWT,
    verificarJWT,
    obtenerClientePorUsuario,
    obtenerClientePorId,
    registrarCliente,
    autenticar,
    estaBloqueado,
    registrarIntentoLogin,
    tocarUltimoLogin,
    generarTokenRecupero,
    consumirTokenRecupero,
    cambiarPassword
};
