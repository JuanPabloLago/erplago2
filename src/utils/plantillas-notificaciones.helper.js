/**
 * PLANTILLAS NOTIFICACIONES — render Handlebars por evento
 *
 * Estructura en disco:
 *   config/plantillas/notif/<evento>.subject  (1 linea, asunto)
 *   config/plantillas/notif/<evento>.hbs       (cuerpo HTML)
 */
const fs = require('fs').promises;
const path = require('path');
const Handlebars = require('handlebars');

const PLANTILLAS_DIR = path.join(__dirname, '..', '..', 'config', 'plantillas', 'notif');
const _cache = new Map();

async function _compilar(evento, tipo) {
    const key = `${evento}.${tipo}`;
    if (_cache.has(key)) return _cache.get(key);
    const ext = tipo === 'subject' ? '.subject' : '.hbs';
    const filepath = path.join(PLANTILLAS_DIR, evento + ext);
    const tpl = await fs.readFile(filepath, 'utf8');
    const compiled = Handlebars.compile(tpl, { noEscape: tipo === 'subject' });
    _cache.set(key, compiled);
    return compiled;
}

async function renderizar(client, id_empresa, evento, contexto) {
    const ctx = { ...contexto, id_empresa };
    const subj = await _compilar(evento, 'subject');
    const body = await _compilar(evento, 'body');
    const asunto = subj(ctx).trim();
    const cuerpo = body(ctx);
    const cuerpo_plano = cuerpo
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
    return { asunto, cuerpo, cuerpo_plano };
}

module.exports = { renderizar };
