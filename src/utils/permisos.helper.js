/**
 * PERMISOS HELPER — Single point para validar sub-permisos de rol
 * 
 * Usa la tabla permisos_usuario (id_empresa, rol, permiso, activo)
 * que ya existe en el sistema para permisos como:
 *   - ver_costos
 *   - modificar_precios
 *   - venta_sin_stock
 *   - cambiar_lista_precios
 *   - editar_estado_productos
 *
 * NO confundir con rol_modulos (que controla acceso a páginas/módulos enteros).
 * Este helper es para sub-acciones dentro de un módulo al que el rol YA tiene acceso.
 */

/**
 * Devuelve true si el rol del usuario tiene el permiso activo en la empresa.
 * 
 * @param {Pool|Client} dbExec - pool o client de pg
 * @param {Object} params
 * @param {number} params.id_empresa - id_empresa del usuario (req.usuario.id_empresa)
 * @param {string} params.rol - rol del usuario (req.usuario.rol)
 * @param {string} params.permiso - nombre del permiso (ej: 'editar_estado_productos')
 * @returns {Promise<boolean>}
 */
async function tienePermiso(dbExec, { id_empresa, rol, permiso }) {
    if (!id_empresa || !rol || !permiso) {
        throw new Error('tienePermiso requiere id_empresa, rol y permiso');
    }
    const { rowCount } = await dbExec.query(
        'SELECT 1 FROM permisos_usuario WHERE id_empresa = $1 AND rol = $2 AND permiso = $3 AND activo = true',
        [id_empresa, rol, permiso]
    );
    return rowCount > 0;
}

/**
 * Lanza error 403 si el rol NO tiene el permiso.
 * Útil para usar inline en controllers.
 */
async function exigirPermiso(dbExec, { id_empresa, rol, permiso, mensaje }) {
    const ok = await tienePermiso(dbExec, { id_empresa, rol, permiso });
    if (!ok) {
        const err = new Error(mensaje || `No tenés el permiso "${permiso}"`);
        err.statusCode = 403;
        throw err;
    }
}

module.exports = { tienePermiso, exigirPermiso };
