/**
 * seguridad-dispositivos.helper.js
 * ─────────────────────────────────────────────────────────────────────────
 * Responsabilidad (SRP): política de seguridad de dispositivos.
 * En esta entrega expone SOLO la validación de límite de dispositivos por rol.
 * NO muta tablas (el CRUD vive en admin.helper.js). Lectura + decisión de política.
 *
 * TABLAS QUE LEE: dispositivos_autorizados, configuraciones_empresa
 * CONFIG: terminal.max_dispositivos_por_rol  (JSON { "<rol>": <int>, ... })
 *
 * Multi-empresa: TODAS las queries filtran por id_empresa.
 * ─────────────────────────────────────────────────────────────────────────
 */

const CLAVE_MAX_POR_ROL = 'terminal.max_dispositivos_por_rol';

/**
 * Lee y parsea la config de límites por rol para una empresa.
 * Tolerante: si la clave no existe, está vacía o es JSON inválido → {} (sin límite).
 * @returns {Promise<Object>} mapa { rol: maxInt }
 */
async function obtenerLimitesPorRol(client, id_empresa) {
    const { rows } = await client.query(
        'SELECT valor FROM configuraciones_empresa WHERE id_empresa = $1 AND clave = $2',
        [id_empresa, CLAVE_MAX_POR_ROL]
    );
    if (rows.length === 0 || rows[0].valor == null || rows[0].valor === '') return {};
    try {
        const parsed = JSON.parse(rows[0].valor);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        console.error('[seguridad-dispositivos] config ' + CLAVE_MAX_POR_ROL + ' no es JSON válido para empresa ' + id_empresa + ':', e.message);
        return {};
    }
}

/**
 * Cuenta dispositivos ACTIVOS de un usuario en una empresa.
 * "Activo" = activo = true Y no dado de baja (estado <> 'baja').
 */
async function contarActivosUsuario(client, id_empresa, id_usuario) {
    const { rows } = await client.query(
        `SELECT COUNT(*)::int AS total
           FROM dispositivos_autorizados
          WHERE id_empresa = $1
            AND id_usuario = $2
            AND activo = true
            AND COALESCE(estado, 'activo') <> 'baja'`,
        [id_empresa, id_usuario]
    );
    return rows[0] ? rows[0].total : 0;
}

/**
 * Valida si se puede autorizar UN dispositivo más para (id_empresa, id_usuario, rol).
 * Política OCP: el tope vive en configuraciones_empresa, no en código.
 *
 * @returns {Promise<{permitido:boolean, limite:(number|null), actuales:number, mensaje:string}>}
 *   - limite === null  → no hay tope configurado para ese rol (se permite siempre)
 *   - permitido=false  → alcanzó/superó el tope
 *
 * NO lanza excepción por política: devuelve el veredicto. El caller decide el HTTP.
 */
async function validarLimiteRol(client, datos) {
    const { id_empresa, id_usuario, rol } = datos;
    if (id_empresa == null || id_usuario == null) {
        throw new Error('validarLimiteRol: id_empresa e id_usuario son obligatorios');
    }

    const limites = await obtenerLimitesPorRol(client, id_empresa);
    const limiteRaw = (rol != null && Object.prototype.hasOwnProperty.call(limites, rol)) ? limites[rol] : null;
    const limite = (limiteRaw === null || limiteRaw === undefined || limiteRaw === '')
        ? null
        : parseInt(limiteRaw, 10);

    if (limite === null || Number.isNaN(limite) || limite <= 0) {
        return { permitido: true, limite: null, actuales: 0, mensaje: '' };
    }

    const actuales = await contarActivosUsuario(client, id_empresa, id_usuario);
    if (actuales >= limite) {
        return {
            permitido: false,
            limite: limite,
            actuales: actuales,
            mensaje: 'El usuario ya tiene ' + actuales + ' dispositivo(s) activo(s) y el límite para el rol "' + rol + '" es ' + limite + '. Dé de baja un dispositivo existente antes de autorizar otro.'
        };
    }
    return { permitido: true, limite: limite, actuales: actuales, mensaje: '' };
}


const ROLES_EXENTOS = ['admin', 'administrador'];

/**
 * Cobertura de dispositivos: todos los usuarios + su conteo de dispositivos activos,
 * cruzado con el límite de su rol, clasificando cada uno por estado_cobertura.
 * Reglas: admin/administrador => EXENTO (anti-lockout). inactivo => INACTIVO.
 *         no-admin activo con 0 => SIN_DISPOSITIVO. supera límite => EXCEDE. resto => OK.
 */
async function obtenerCobertura(client, id_empresa) {
    if (id_empresa == null) throw new Error('obtenerCobertura: id_empresa es obligatorio');
    const limites = await obtenerLimitesPorRol(client, id_empresa);
    const { rows } = await client.query(
        `SELECT u.id_usuario, u.username, u.nombre, u.rol, u.estado,
                COUNT(d.id_dispositivo) FILTER (
                    WHERE d.activo = true AND COALESCE(d.estado, 'activo') <> 'baja'
                )::int AS dispositivos_activos
           FROM usuarios u
           LEFT JOIN dispositivos_autorizados d
                  ON d.id_usuario = u.id_usuario AND d.id_empresa = u.id_empresa
          WHERE u.id_empresa = $1
          GROUP BY u.id_usuario, u.username, u.nombre, u.rol, u.estado
          ORDER BY u.estado ASC, dispositivos_activos ASC, u.username ASC`,
        [id_empresa]
    );
    return rows.map(function (u) {
        const rol = u.rol || '';
        const esExento = ROLES_EXENTOS.indexOf(rol) !== -1;
        const limRaw = Object.prototype.hasOwnProperty.call(limites, rol) ? limites[rol] : null;
        const limite = (limRaw === null || limRaw === undefined || limRaw === '') ? null : parseInt(limRaw, 10);
        const activos = u.dispositivos_activos || 0;
        let estado_cobertura;
        if (u.estado !== 'activo') estado_cobertura = 'INACTIVO';
        else if (esExento) estado_cobertura = 'EXENTO';
        else if (activos === 0) estado_cobertura = 'SIN_DISPOSITIVO';
        else if (limite !== null && !Number.isNaN(limite) && limite > 0 && activos > limite) estado_cobertura = 'EXCEDE';
        else estado_cobertura = 'OK';
        return {
            id_usuario: u.id_usuario, username: u.username, nombre: u.nombre, rol: rol, estado: u.estado,
            dispositivos_activos: activos,
            limite: (limite !== null && !Number.isNaN(limite) && limite > 0) ? limite : null,
            estado_cobertura: estado_cobertura
        };
    });
}

module.exports = {
    CLAVE_MAX_POR_ROL,
    ROLES_EXENTOS,
    obtenerCobertura,
    obtenerLimitesPorRol,
    contarActivosUsuario,
    validarLimiteRol
};
