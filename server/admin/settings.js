// Dashboard settings: message templates, sales team names, the builder's own name.
import { getRepo } from '../lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { DEFAULT_SETTINGS } from '../lib/crm-repo.js';

export default route(['GET', 'PUT'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') return send(res, 200, { settings: await repo.getSettings(), defaults: DEFAULT_SETTINGS });
    const body = await readJson(req);
    if (Array.isArray(body.team)) {
        const team = [...new Set(body.team.map(x => cleanText(x, 40)).filter(Boolean))].slice(0, 30);
        await repo.setSetting('team', team);
    }
    if (body.me !== undefined) await repo.setSetting('me', cleanText(body.me, 40) || '');
    if (Array.isArray(body.templates)) {
        const templates = body.templates.slice(0, 20).map(t => ({
            id: cleanText(t.id, 20) || 'custom', name: cleanText(t.name, 40) || 'Message',
            en: cleanText(t.en, 1000) || '', hi: cleanText(t.hi, 1000) || '',
        })).filter(t => t.en || t.hi);
        if (!templates.length) throw badRequest('Keep at least one message');
        await repo.setSetting('templates', templates);
    }
    send(res, 200, { ok: true, settings: await repo.getSettings() });
});
