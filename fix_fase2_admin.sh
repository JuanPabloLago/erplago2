#!/bin/bash
# ============================================================================
# FIX FASE 2: ADMIN HELPER — Multi-empresa
# Ejecutar desde /root/mi_erp
#
# Corrige 3 funciones en admin.helper.js:
#   1. registrarLog() — INSERT usuarios_logs sin id_empresa
#   2. togglePermiso() — INSERT/UPDATE permisos_usuario sin id_empresa
#   3. upsertConfigUsuario() — INSERT usuario_configuracion sin id_empresa
# ============================================================================

set -e
cd /root/mi_erp

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/pre_fix_multiempresa_fase2_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "============================================"
echo " FASE 2: ADMIN HELPER MULTI-EMPRESA"
echo "============================================"
echo ""

# BACKUP
cp src/utils/admin.helper.js "$BACKUP_DIR/"
echo "  ✓ Backup en $BACKUP_DIR"

# ── FIX con Python (quirúrgico, solo las 3 funciones) ──
python3 << 'PYEOF'
filepath = 'src/utils/admin.helper.js'
with open(filepath, 'r') as f:
    content = f.read()

fixes = 0

# ── FIX 1: registrarLog — agregar id_empresa ──
old_registrar = '''async function registrarLog(client, datos) {
    const { id_usuario, accion, detalle, ip_origen } = datos;
    await client.query(`INSERT INTO usuarios_logs (id_usuario, accion, detalle, ip_origen) VALUES ($1,$2,$3,$4)`,
        [id_usuario, accion, detalle, ip_origen || null]);
}'''

new_registrar = '''async function registrarLog(client, datos) {
    const { id_empresa, id_usuario, accion, detalle, ip_origen } = datos;
    await client.query(`INSERT INTO usuarios_logs (id_empresa, id_usuario, accion, detalle, ip_origen) VALUES ($1,$2,$3,$4,$5)`,
        [id_empresa, id_usuario, accion, detalle, ip_origen || null]);
}'''

if old_registrar in content:
    content = content.replace(old_registrar, new_registrar)
    fixes += 1
    print("  ✓ registrarLog — id_empresa agregado")
else:
    print("  ⚠ registrarLog — patrón no encontrado, verificar manualmente")

# ── FIX 2: togglePermiso — agregar id_empresa ──
old_toggle = '''async function togglePermiso(client, datos) {
    const { rol, permiso, activo } = datos;
    const existe = await client.query(`SELECT id_permiso FROM permisos_usuario WHERE rol = $1 AND permiso = $2`, [rol, permiso]);
    if (existe.rows.length === 0) {
        await client.query(`INSERT INTO permisos_usuario (rol, permiso, activo) VALUES ($1,$2,$3)`, [rol, permiso, activo]);
    } else {
        await client.query(`UPDATE permisos_usuario SET activo = $1 WHERE rol = $2 AND permiso = $3`, [activo, rol, permiso]);
    }
}'''

new_toggle = '''async function togglePermiso(client, datos) {
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
}'''

if old_toggle in content:
    content = content.replace(old_toggle, new_toggle)
    fixes += 1
    print("  ✓ togglePermiso — id_empresa agregado")
else:
    print("  ⚠ togglePermiso — patrón no encontrado, verificar manualmente")

# ── FIX 3: upsertConfigUsuario — agregar id_empresa ──
old_upsert = '''async function upsertConfigUsuario(client, datos) {
    const { id_usuario, id_lista_precio } = datos;
    await client.query(`
        INSERT INTO usuario_configuracion (id_usuario, id_lista_precio_predeterminada, fecha_modificacion)
        VALUES ($1,$2,NOW()) ON CONFLICT (id_usuario) DO UPDATE SET id_lista_precio_predeterminada = $2, fecha_modificacion = NOW()
    `, [id_usuario, id_lista_precio]);
}'''

new_upsert = '''async function upsertConfigUsuario(client, datos) {
    const { id_empresa, id_usuario, id_lista_precio } = datos;
    await client.query(`
        INSERT INTO usuario_configuracion (id_empresa, id_usuario, id_lista_precio_predeterminada, fecha_modificacion)
        VALUES ($1,$2,$3,NOW()) ON CONFLICT (id_usuario) DO UPDATE SET id_lista_precio_predeterminada = $3, fecha_modificacion = NOW()
    `, [id_empresa, id_usuario, id_lista_precio]);
}'''

if old_upsert in content:
    content = content.replace(old_upsert, new_upsert)
    fixes += 1
    print("  ✓ upsertConfigUsuario — id_empresa agregado")
else:
    print("  ⚠ upsertConfigUsuario — patrón no encontrado, verificar manualmente")

with open(filepath, 'w') as f:
    f.write(content)

print(f"\n  Total fixes aplicados: {fixes}/3")
PYEOF

echo ""

# VALIDACIÓN
source ~/.nvm/nvm.sh 2>/dev/null || export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

if node --check src/utils/admin.helper.js 2>/dev/null; then
    echo "  ✓ admin.helper.js — sintaxis OK"
else
    echo "  ✗ ERROR DE SINTAXIS — restaurar: cp $BACKUP_DIR/admin.helper.js src/utils/"
    exit 1
fi

echo ""
echo "============================================"
echo " FASE 2 COMPLETADA"
echo ""
echo " IMPORTANTE: Verificar que los consumidores"
echo " de admin.helper pasen id_empresa en datos:"
echo "   grep -rn 'registrarLog\|togglePermiso\|upsertConfigUsuario' src/controllers/"
echo "============================================"
