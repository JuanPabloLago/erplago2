/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN HELPER — ERP LAGO — FASE 8d
 * Centraliza escrituras de: auth, usuarios, dispositivos, permisos, logs, config
 * ═══════════════════════════════════════════════════════════════════════════
 * TABLAS: usuarios, usuarios_logs, permisos_usuario, dispositivos_autorizados,
 *         intentos_dispositivo_nuevo, usuario_configuracion, configuraciones_empresa
 * CONSUMIDORES: auth.controller.js, usuarios.controller.js
 */

// ═══════════════════════════════ USUARIOS ═══════════════════════════════

async function crearUsuario(client, datos) {
    const { username, email, password_hash, nombre, rol, id_empresa, id_deposito } = datos;
    const result = await client.query(`
        INSERT INTO usuarios (username, email, password_hash, nombre, rol, id_empresa, id_deposito, estado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'activo')
        RETURNING id_usuario, username, nombre, email, rol, estado, id_empresa, id_deposito
    `, [username, email || null, password_hash, nombre || username, rol, id_empresa, id_deposito || null]);
    return result.rows[0];
}

async function actualizarUsuario(client, datos) {
    const { id_usuario, username, email, nombre, rol, estado, id_empresa, id_deposito } = datos;
    const result = await client.query(`
        UPDATE usuarios SET username = COALESCE($1, username), email = $2, nombre = COALESCE($3, nombre),
            rol = COALESCE($4, rol), estado = COALESCE($5, estado), id_empresa = $6, id_deposito = $7, fecha_modificacion = NOW()
        WHERE id_usuario = $8
        RETURNING id_usuario, username, nombre, email, rol, estado, id_empresa, id_deposito
    `, [username, email || null, nombre, rol, estado, id_empresa, id_deposito, id_usuario]);
    return result.rows[0];
}

async function desactivarUsuario(client, datos) {
    const { id_usuario } = datos;
    await client.query(`UPDATE usuarios SET estado = 'inactivo', fecha_modificacion = NOW() WHERE id_usuario = $1`, [id_usuario]);
}

async function resetPassword(client, datos) {
    const { id_usuario, password_hash } = datos;
    await client.query(`UPDATE usuarios SET password_hash = $1, fecha_modificacion = NOW() WHERE id_usuario = $2`, [password_hash, id_usuario]);
}

async function actualizarUltimoLogin(client, datos) {
    const { id_usuario } = datos;
    await client.query('UPDATE usuarios SET ultimo_login = NOW() WHERE id_usuario = $1', [id_usuario]);
}

// ═══════════════════════════════ LOGS ═══════════════════════════════

async function registrarLog(client, datos) {
    const { id_empresa, id_usuario, accion, detalle, ip_origen } = datos;
    await client.query(`INSERT INTO usuarios_logs (id_empresa, id_usuario, accion, detalle, ip_origen) VALUES ($1,$2,$3,$4,$5)`,
        [id_empresa, id_usuario, accion, detalle, ip_origen || null]);
}

// ═══════════════════════════════ PERMISOS ═══════════════════════════════

async function togglePermiso(client, datos) {
    const { id_empresa, rol, permiso, activo } = datos;
    const existe = await client.query(
        `SELECT id_permiso FROM permisos_usuario WHERE id_empresa = $1 AND rol = $2 AND permiso = $3`,
        [id_empresa, rol, permiso]
    );
    if (existe.rows.length === 0) {
        await client.query(
            `INSERT INTO permisos_usuario (id_empresa, rol, permiso, activo) VALUES ($1,$2,$3,$4)`,
            [id_empresa, rol, permiso, activo]
        );
    } else {
        await client.query(
            `UPDATE permisos_usuario SET activo = $1 WHERE id_empresa = $2 AND rol = $3 AND permiso = $4`,
            [activo, id_empresa, rol, permiso]
        );
    }
}

// ═══════════════════════════════ DISPOSITIVOS ═══════════════════════════════

async function registrarIntentoDispositivo(client, datos) {
    const { id_empresa, id_usuario, fingerprint_hash, fingerprint_datos, ip_hash } = datos;
    await client.query(`
        INSERT INTO intentos_dispositivo_nuevo (id_empresa, id_usuario, fingerprint_hash, fingerprint_datos, ip_hash)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
    `, [id_empresa, id_usuario, fingerprint_hash, JSON.stringify(fingerprint_datos || {}), ip_hash]);
}

async function actualizarAccesoDispositivo(client, datos) {
    const { id_dispositivo, ip_hash } = datos;
    await client.query('UPDATE dispositivos_autorizados SET ultimo_acceso = NOW(), ip_hash = $1 WHERE id_dispositivo = $2', [ip_hash, id_dispositivo]);
}

async function autorizarDispositivo(client, datos) {
    const { id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador, sistema_operativo, ip_hash, autorizado_por, notas } = datos;
    await client.query(`
        INSERT INTO dispositivos_autorizados (id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador, sistema_operativo, ip_hash, autorizado_por, fecha_autorizacion, notas)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
    `, [id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador || 'Desconocido', sistema_operativo || 'Desconocido', ip_hash, autorizado_por, notas || '']);
}

async function upsertDispositivoAdmin(client, datos) {
    // Auto-registro de dispositivo para ADMIN: NO bloquea, NO crea intento.
    // Inserta si es nuevo; si ya existe (mismo fingerprint), solo actualiza ultimo_acceso.
    // Devuelve { id_dispositivo, fue_insert } — fue_insert=true cuando recién se creó.
    const { id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador, sistema_operativo, ip_hash } = datos;
    const result = await client.query(`
        INSERT INTO dispositivos_autorizados
            (id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo, navegador, sistema_operativo,
             ip_hash, autorizado_por, fecha_autorizacion, notas, auto_registrado)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$2,NOW(),'Auto-registrado en login de admin',true)
        ON CONFLICT (id_empresa, id_usuario, fingerprint_hash)
        DO UPDATE SET ultimo_acceso = NOW(), ip_hash = EXCLUDED.ip_hash
        RETURNING id_dispositivo, (xmax = 0) AS fue_insert
    `, [id_empresa, id_usuario, fingerprint_hash, nombre_dispositivo || 'Dispositivo admin',
        navegador || 'Desconocido', sistema_operativo || 'Desconocido', ip_hash]);
    return result.rows[0];
}

async function procesarIntento(client, datos) {
    const { id_intento, estado, procesado_por } = datos;
    const result = await client.query(
        `UPDATE intentos_dispositivo_nuevo SET estado = $1, procesado_por = $2, fecha_procesado = NOW() WHERE id_intento = $3 RETURNING *`,
        [estado, procesado_por, id_intento]);
    return result.rows[0];
}

async function toggleDispositivo(client, datos) {
    const { id_dispositivo, id_empresa, activo } = datos;
    const result = await client.query('UPDATE dispositivos_autorizados SET activo = $1 WHERE id_dispositivo = $2 AND id_empresa = $3', [activo, id_dispositivo, id_empresa]);
    return result.rowCount;
}

async function darDeBajaDispositivo(client, datos) {
    const { id_dispositivo, id_empresa, baja_por, motivo } = datos;
    const result = await client.query(
        `UPDATE dispositivos_autorizados
            SET estado = 'baja', activo = false, fecha_baja = NOW(), baja_por = $3, motivo_baja = $4
          WHERE id_dispositivo = $1 AND id_empresa = $2 AND COALESCE(estado, 'activo') <> 'baja'`,
        [id_dispositivo, id_empresa, baja_por, motivo]
    );
    return result.rowCount;
}

// ═══════════════════════════════ CONFIGURACIÓN ═══════════════════════════════

async function upsertConfigUsuario(client, datos) {
    const { id_empresa, id_usuario, id_lista_precio } = datos;
    await client.query(`
        INSERT INTO usuario_configuracion (id_empresa, id_usuario, id_lista_precio_predeterminada, fecha_modificacion)
        VALUES ($1,$2,$3,NOW()) ON CONFLICT (id_empresa, id_usuario) DO UPDATE SET id_lista_precio_predeterminada = $3, fecha_modificacion = NOW()
    `, [id_empresa, id_usuario, id_lista_precio]);
}

async function upsertConfigEmpresa(client, datos) {
    const { id_empresa, clave, valor } = datos;
    await client.query(`
        INSERT INTO configuraciones_empresa (id_empresa, clave, valor) VALUES ($1,$2,$3)
        ON CONFLICT (id_empresa, clave) DO UPDATE SET valor = $3
    `, [id_empresa, clave, valor]);
}

module.exports = {
    crearUsuario, actualizarUsuario, desactivarUsuario, resetPassword, actualizarUltimoLogin,
    registrarLog, togglePermiso,
    registrarIntentoDispositivo, actualizarAccesoDispositivo, autorizarDispositivo, upsertDispositivoAdmin, procesarIntento, toggleDispositivo, darDeBajaDispositivo,
    upsertConfigUsuario, upsertConfigEmpresa
};
