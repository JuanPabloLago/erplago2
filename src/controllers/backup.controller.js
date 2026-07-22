const logger = require('../utils/logger');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = '/root/backups';
const MAX_BACKUPS = 10;
const RCLONE_REMOTE = 'erplago-backup:ERP-LAGO-BACKUPS';

// ============================================================
// CREAR backup completo (código + BD) + subir a Google Drive
// ============================================================
exports.crear = async (req, res) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `erplago_${timestamp}`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    try {
        fs.mkdirSync(backupPath, { recursive: true });

        // 1) Backup BD formato custom
        const dumpFile = path.join(backupPath, 'erplago.dump');
        await execAsync(
            `PGPASSWORD='Huu3697debian@' pg_dump -h localhost -U juanpablo -Fc erplago -f "${dumpFile}"`
        );

        // 2) Verificar integridad del dump
        const verificacion = await verificarDump(dumpFile);
        if (!verificacion.ok) {
            fs.rmSync(backupPath, { recursive: true, force: true });
            logger.error(`Backup fallido - dump corrupto: ${verificacion.error}`);
            return res.status(500).json({
                error: 'Backup de BD falló la verificación',
                detalle: verificacion.error
            });
        }

        // 3) Backup de código
        const tarFile = path.join(backupPath, 'codigo.tar.gz');
        await execAsync(
            `tar -czf "${tarFile}" --exclude='node_modules' --exclude='.git' --exclude='backups' -C /root mi_erp`
        );

        // 4) Guardar metadata con conteos por tabla (para verificación post-restore)
        const conteos = await obtenerConteoTablas();
        const dumpSize = fs.statSync(dumpFile).size;
        const tarSize = fs.statSync(tarFile).size;

        const info = {
            version: 3,
            fecha: new Date().toISOString(),
            usuario: req.usuario?.username || 'sistema',
            formato_bd: 'custom',
            tablas: verificacion.tablas,
            conteos_tablas: conteos,
            archivos: {
                'erplago.dump': formatSize(dumpSize),
                'codigo.tar.gz': formatSize(tarSize)
            },
            verificado: true,
            drive: null
        };
        fs.writeFileSync(path.join(backupPath, 'info.json'), JSON.stringify(info, null, 2));

        // 5) Rotación local
        const eliminados = await rotarBackups();

        // 6) Subir a Google Drive (async, no bloquea la respuesta)
        const driveResult = await subirADrive(backupPath, backupName);
        info.drive = driveResult;
        // Actualizar info.json con resultado de Drive
        fs.writeFileSync(path.join(backupPath, 'info.json'), JSON.stringify(info, null, 2));

        logger.success(`Backup creado: ${backupName} (BD: ${info.archivos['erplago.dump']}, Código: ${info.archivos['codigo.tar.gz']}, ${verificacion.tablas} tablas, Drive: ${driveResult.ok ? 'OK' : 'FALLÓ'})`);

        res.json({
            success: true,
            mensaje: 'Backup creado y verificado exitosamente',
            nombre: backupName,
            tamanio: {
                bd: info.archivos['erplago.dump'],
                codigo: info.archivos['codigo.tar.gz']
            },
            tablas: verificacion.tablas,
            verificado: true,
            drive: driveResult,
            backups_eliminados: eliminados
        });

    } catch (error) {
        if (fs.existsSync(backupPath)) {
            fs.rmSync(backupPath, { recursive: true, force: true });
        }
        logger.error(`Error al crear backup: ${error.message}`);
        res.status(500).json({ error: 'Error al crear backup', detalle: error.message });
    }
};

// ============================================================
// RESTAURAR backup con verificación post-restore
// ============================================================
exports.restaurar = async (req, res) => {
    const { nombre } = req.params;
    const { modo = 'bd' } = req.body; // 'bd', 'codigo', 'completo'

    if (!nombre || (!nombre.startsWith('erplago_') && !nombre.startsWith('pre_restore_'))) {
        return res.status(400).json({ error: 'Nombre de backup inválido' });
    }

    const backupPath = path.join(BACKUP_DIR, nombre);
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
    }

    try {
        const resultados = { bd: null, codigo: null };

        // --- Restaurar BD ---
        if (modo === 'bd' || modo === 'completo') {
            let dumpFile = path.join(backupPath, 'erplago.dump');
            let esFormatoCustom = true;

            if (!fs.existsSync(dumpFile)) {
                dumpFile = path.join(backupPath, 'erplago.sql');
                esFormatoCustom = false;
            }
            if (!fs.existsSync(dumpFile)) {
                return res.status(404).json({ error: 'Archivo de BD no encontrado en el backup' });
            }

            // Conteos PRE-restore para comparar después
            const conteosPre = await obtenerConteoTablas();

            // Backup de seguridad ANTES de restaurar
            const safetyName = `pre_restore_${Date.now()}`;
            const safetyPath = path.join(BACKUP_DIR, safetyName);
            fs.mkdirSync(safetyPath, { recursive: true });
            await execAsync(
                `PGPASSWORD='Huu3697debian@' pg_dump -h localhost -U juanpablo -Fc erplago -f "${safetyPath}/erplago.dump"`
            );
            const safetyConteos = conteosPre;
            fs.writeFileSync(path.join(safetyPath, 'info.json'), JSON.stringify({
                version: 3,
                fecha: new Date().toISOString(),
                usuario: 'sistema',
                formato_bd: 'custom',
                motivo: `Backup de seguridad antes de restaurar ${nombre}`,
                conteos_tablas: safetyConteos,
                archivos: { 'erplago.dump': formatSize(fs.statSync(`${safetyPath}/erplago.dump`).size) }
            }, null, 2));

            // Ejecutar restore — capturar errores reales
            let restoreOutput = '';
            let restoreErrors = [];
            if (esFormatoCustom) {
                try {
                    const { stdout, stderr } = await execAsync(
                        `PGPASSWORD='Huu3697debian@' pg_restore -h localhost -U juanpablo -d erplago --clean --if-exists --no-owner --no-privileges "${dumpFile}" 2>&1`
                    );
                    restoreOutput = stdout;
                } catch (restoreErr) {
                    // pg_restore sale con exit code != 0 si hay warnings
                    // Diferenciar warnings de errores fatales
                    restoreOutput = restoreErr.stdout || '';
                    const stderr = restoreErr.stderr || restoreErr.stdout || '';
                    // Filtrar líneas de error real (no warnings de "already exists" o "does not exist")
                    restoreErrors = stderr.split('\n').filter(line =>
                        line.includes('ERROR') &&
                        !line.includes('already exists') &&
                        !line.includes('does not exist')
                    );
                }
            } else {
                try {
                    await execAsync(
                        `PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -f "${dumpFile}" 2>&1`
                    );
                } catch (restoreErr) {
                    restoreErrors = [restoreErr.message];
                }
            }

            // Verificación POST-restore: comparar conteos
            const conteosPost = await obtenerConteoTablas();
            const verificacionPost = verificarConteosRestore(nombre, backupPath, conteosPost);

            resultados.bd = {
                restaurado: true,
                backup_seguridad: safetyName,
                formato: esFormatoCustom ? 'custom' : 'sql_plano',
                errores_fatales: restoreErrors.length > 0 ? restoreErrors : null,
                verificacion_post: verificacionPost
            };

            if (restoreErrors.length > 0) {
                logger.error(`Restore ${nombre}: ${restoreErrors.length} errores fatales detectados`);
            }
            logger.success(`BD restaurada desde: ${nombre} (seguridad: ${safetyName}, verificación: ${verificacionPost.estado})`);
        }

        // --- Restaurar código (sin --delete para no borrar archivos nuevos) ---
        if (modo === 'codigo' || modo === 'completo') {
            const tarFile = path.join(backupPath, 'codigo.tar.gz');
            if (!fs.existsSync(tarFile)) {
                return res.status(404).json({ error: 'Archivo de código no encontrado en el backup' });
            }

            const tempDir = `/tmp/restore_${Date.now()}`;
            fs.mkdirSync(tempDir, { recursive: true });
            await execAsync(`tar -xzf "${tarFile}" -C "${tempDir}"`);

            // rsync SIN --delete: sobreescribe archivos existentes pero NO borra nuevos
            await execAsync(
                `rsync -a --exclude='node_modules' --exclude='.git' --exclude='backups' "${tempDir}/mi_erp/" /root/mi_erp/`
            );

            fs.rmSync(tempDir, { recursive: true, force: true });
            resultados.codigo = { restaurado: true };
            logger.success(`Código restaurado desde: ${nombre}`);
        }

        // Reiniciar PM2
        if (resultados.bd?.restaurado || resultados.codigo?.restaurado) {
            try {
                await execAsync('source /root/.nvm/nvm.sh && pm2 restart erplago', { shell: '/bin/bash' });
                resultados.pm2 = 'reiniciado';
            } catch (pm2Error) {
                resultados.pm2 = `error al reiniciar: ${pm2Error.message}`;
            }
        }

        res.json({
            success: true,
            mensaje: `Restauración completada (modo: ${modo})`,
            resultados
        });

    } catch (error) {
        logger.error(`Error al restaurar backup ${nombre}: ${error.message}`);
        res.status(500).json({ error: 'Error al restaurar', detalle: error.message });
    }
};

// ============================================================
// VERIFICAR backup existente
// ============================================================
exports.verificar = async (req, res) => {
    const { nombre } = req.params;

    if (!nombre || (!nombre.startsWith('erplago_') && !nombre.startsWith('pre_restore_'))) {
        return res.status(400).json({ error: 'Nombre de backup inválido' });
    }

    const backupPath = path.join(BACKUP_DIR, nombre);
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
    }

    try {
        const resultado = { bd: null, codigo: null, drive: null, completo: false };

        // Verificar dump BD
        const dumpFile = path.join(backupPath, 'erplago.dump');
        const sqlFile = path.join(backupPath, 'erplago.sql');

        if (fs.existsSync(dumpFile)) {
            const ver = await verificarDump(dumpFile);
            resultado.bd = {
                archivo: 'erplago.dump',
                formato: 'custom',
                tamanio: formatSize(fs.statSync(dumpFile).size),
                valido: ver.ok,
                tablas: ver.tablas,
                error: ver.error || null
            };
        } else if (fs.existsSync(sqlFile)) {
            const size = fs.statSync(sqlFile).size;
            resultado.bd = {
                archivo: 'erplago.sql',
                formato: 'sql_plano (v1)',
                tamanio: formatSize(size),
                valido: size > 1000,
                tablas: null
            };
        } else {
            resultado.bd = { valido: false, error: 'No se encontró archivo de BD' };
        }

        // Verificar tar código
        const tarFile = path.join(backupPath, 'codigo.tar.gz');
        if (fs.existsSync(tarFile)) {
            try {
                const { stdout } = await execAsync(`tar -tzf "${tarFile}" | head -5`);
                resultado.codigo = {
                    archivo: 'codigo.tar.gz',
                    tamanio: formatSize(fs.statSync(tarFile).size),
                    valido: stdout.includes('mi_erp'),
                    muestra: stdout.trim().split('\n').slice(0, 5)
                };
            } catch {
                resultado.codigo = { valido: false, error: 'Archivo tar corrupto' };
            }
        } else {
            resultado.codigo = { valido: false, error: 'No se encontró archivo de código' };
        }

        // Verificar si existe en Drive
        resultado.drive = await verificarEnDrive(nombre);

        resultado.completo = !!(resultado.bd?.valido && resultado.codigo?.valido);

        res.json({ success: true, nombre, resultado });

    } catch (error) {
        logger.error(`Error al verificar backup ${nombre}: ${error.message}`);
        res.status(500).json({ error: 'Error al verificar backup', detalle: error.message });
    }
};

// ============================================================
// LISTAR backups (local + estado en Drive)
// ============================================================
exports.listar = async (req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return res.json({ backups: [], max_backups: MAX_BACKUPS });
        }

        const dirs = fs.readdirSync(BACKUP_DIR)
            .filter(d => d.startsWith('erplago_') || d.startsWith('pre_restore_'))
            .sort()
            .reverse();

        // Obtener lista de Drive una sola vez
        let driveBackups = [];
        try {
            const { stdout } = await execAsync(`rclone lsd ${RCLONE_REMOTE}/ 2>/dev/null`);
            driveBackups = stdout.split('\n')
                .map(l => l.trim().split(/\s+/).pop())
                .filter(n => n && n.startsWith('erplago_'));
        } catch { /* Drive no disponible */ }

        const backups = dirs.map(dir => {
            const infoPath = path.join(BACKUP_DIR, dir, 'info.json');
            let info = {};
            if (fs.existsSync(infoPath)) {
                try { info = JSON.parse(fs.readFileSync(infoPath, 'utf8')); } catch {}
            }

            let totalSize = 0;
            try {
                const files = fs.readdirSync(path.join(BACKUP_DIR, dir));
                files.forEach(f => {
                    totalSize += fs.statSync(path.join(BACKUP_DIR, dir, f)).size;
                });
            } catch {}

            return {
                nombre: dir,
                fecha: info.fecha || dir.replace('erplago_', '').replace(/-/g, ':'),
                usuario: info.usuario || 'desconocido',
                version: info.version || 1,
                formato_bd: info.formato_bd || 'sql_plano',
                verificado: info.verificado || false,
                tablas: info.tablas || null,
                archivos: info.archivos || {},
                tamanio_total: formatSize(totalSize),
                es_seguridad: dir.startsWith('pre_restore_'),
                motivo: info.motivo || null,
                en_drive: driveBackups.includes(dir),
                drive_info: info.drive || null
            };
        });

        res.json({ backups, max_backups: MAX_BACKUPS, total: backups.length });
    } catch (error) {
        logger.error(`Error al listar backups: ${error.message}`);
        res.status(500).json({ error: 'Error al listar backups' });
    }
};

// ============================================================
// ELIMINAR backup
// ============================================================
exports.eliminar = async (req, res) => {
    const { nombre } = req.params;

    if (!nombre || (!nombre.startsWith('erplago_') && !nombre.startsWith('pre_restore_'))) {
        return res.status(400).json({ error: 'Nombre de backup inválido' });
    }
    if (nombre.includes('..') || nombre.includes('/')) {
        return res.status(400).json({ error: 'Nombre de backup inválido' });
    }

    const backupPath = path.join(BACKUP_DIR, nombre);

    try {
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ error: 'Backup no encontrado' });
        }

        fs.rmSync(backupPath, { recursive: true, force: true });
        logger.info(`Backup eliminado: ${nombre}`);
        res.json({ success: true, mensaje: 'Backup eliminado (copia en Drive NO se eliminó)' });
    } catch (error) {
        logger.error(`Error al eliminar backup ${nombre}: ${error.message}`);
        res.status(500).json({ error: 'Error al eliminar backup' });
    }
};

// ============================================================
// SINCRONIZAR A DRIVE (manual, por si falló el automático)
// ============================================================
exports.sincronizarDrive = async (req, res) => {
    const { nombre } = req.body;

    if (!nombre) {
        // Subir el más reciente
        const dirs = fs.readdirSync(BACKUP_DIR)
            .filter(d => d.startsWith('erplago_'))
            .sort()
            .reverse();

        if (dirs.length === 0) {
            return res.status(404).json({ error: 'No hay backups para sincronizar' });
        }

        const backupPath = path.join(BACKUP_DIR, dirs[0]);
        const result = await subirADrive(backupPath, dirs[0]);
        return res.json({ success: result.ok, nombre: dirs[0], drive: result });
    }

    const backupPath = path.join(BACKUP_DIR, nombre);
    if (!fs.existsSync(backupPath)) {
        return res.status(404).json({ error: 'Backup no encontrado' });
    }

    const result = await subirADrive(backupPath, nombre);
    res.json({ success: result.ok, nombre, drive: result });
};

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

// Verificar integridad de un dump
async function verificarDump(dumpFile) {
    try {
        const { stdout } = await execAsync(
            `PGPASSWORD='Huu3697debian@' pg_restore -l "${dumpFile}" 2>/dev/null | grep "TABLE DATA" | wc -l`
        );
        const tablas = parseInt(stdout.trim(), 10);

        if (tablas < 10) {
            return { ok: false, tablas, error: `Solo ${tablas} tablas encontradas (se esperan 90+)` };
        }
        return { ok: true, tablas };
    } catch (error) {
        return { ok: false, tablas: 0, error: error.message };
    }
}

// Obtener conteos de TODAS las tablas (para metadata y verificación)
async function obtenerConteoTablas() {
    try {
        const { stdout } = await execAsync(
            `PGPASSWORD='Huu3697debian@' psql -h localhost -U juanpablo -d erplago -t -A -c "
                SELECT jsonb_object_agg(relname, n_live_tup)
                FROM pg_stat_user_tables
                WHERE schemaname = 'public';
            "`
        );
        return JSON.parse(stdout.trim());
    } catch (error) {
        logger.error(`Error obteniendo conteos: ${error.message}`);
        return {};
    }
}

// Verificar conteos después de un restore
function verificarConteosRestore(nombre, backupPath, conteosPost) {
    const infoPath = path.join(backupPath, 'info.json');
    if (!fs.existsSync(infoPath)) {
        return { estado: 'sin_metadata', mensaje: 'Backup sin metadata de conteos (v1/v2), no se puede verificar' };
    }

    try {
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (!info.conteos_tablas) {
            return { estado: 'sin_conteos', mensaje: 'Backup sin conteos por tabla' };
        }

        const diferencias = [];
        const tablasCriticas = [
            'empresas', 'usuarios', 'productos', 'clientes', 'proveedores',
            'pedidos', 'facturas', 'recibos', 'inventario', 'pagos',
            'cuentacorrienteclientes', 'cuentacorrienteproveedores',
            'movimientos_stock', 'confirmaciones_pago'
        ];

        for (const tabla of tablasCriticas) {
            const esperado = info.conteos_tablas[tabla];
            const actual = conteosPost[tabla];
            if (esperado !== undefined && actual !== undefined && esperado !== actual) {
                diferencias.push({ tabla, esperado, actual, diff: actual - esperado });
            }
        }

        if (diferencias.length === 0) {
            return { estado: 'ok', mensaje: 'Todos los conteos coinciden' };
        } else {
            return { estado: 'diferencias', mensaje: `${diferencias.length} tablas con diferencia`, diferencias };
        }
    } catch {
        return { estado: 'error', mensaje: 'No se pudo leer metadata del backup' };
    }
}

// Subir directorio de backup a Google Drive
async function subirADrive(backupPath, backupName) {
    try {
        // Verificar que rclone está disponible y configurado
        await execAsync('which rclone');
        await execAsync('rclone listremotes | grep erplago-backup');
    } catch {
        return { ok: false, error: 'rclone no configurado', tiempo: null };
    }

    try {
        const start = Date.now();
        await execAsync(
            `rclone copy "${backupPath}" "${RCLONE_REMOTE}/${backupName}/" --log-level ERROR 2>&1`,
            { timeout: 300000 } // 5 min timeout
        );
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        // Verificar que los archivos llegaron
        const { stdout } = await execAsync(`rclone ls "${RCLONE_REMOTE}/${backupName}/" 2>/dev/null`);
        const archivosEnDrive = stdout.trim().split('\n').filter(l => l.trim()).length;

        logger.success(`Backup ${backupName} subido a Drive (${elapsed}s, ${archivosEnDrive} archivos)`);
        return { ok: true, tiempo: `${elapsed}s`, archivos: archivosEnDrive, error: null };
    } catch (error) {
        logger.error(`Error subiendo a Drive: ${error.message}`);
        return { ok: false, error: error.message, tiempo: null };
    }
}

// Verificar si un backup existe en Drive
async function verificarEnDrive(backupName) {
    try {
        const { stdout } = await execAsync(`rclone ls "${RCLONE_REMOTE}/${backupName}/" 2>/dev/null`);
        const archivos = stdout.trim().split('\n').filter(l => l.trim());
        return { existe: archivos.length > 0, archivos: archivos.length };
    } catch {
        return { existe: false, archivos: 0 };
    }
}

// Rotación automática local
async function rotarBackups() {
    const eliminados = [];
    try {
        if (!fs.existsSync(BACKUP_DIR)) return eliminados;

        const dirs = fs.readdirSync(BACKUP_DIR)
            .filter(d => d.startsWith('erplago_'))
            .sort()
            .reverse();

        if (dirs.length > MAX_BACKUPS) {
            const aEliminar = dirs.slice(MAX_BACKUPS);
            for (const dir of aEliminar) {
                fs.rmSync(path.join(BACKUP_DIR, dir), { recursive: true, force: true });
                eliminados.push(dir);
                logger.info(`Rotación: eliminado ${dir}`);
            }
        }
    } catch (error) {
        logger.error(`Error en rotación: ${error.message}`);
    }
    return eliminados;
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
