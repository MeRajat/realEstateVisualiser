// GET → all leads with engagement; PATCH { id, status?, notes? } → update pipeline status / notes.
import { getRepo } from '../_lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';

export const LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];

export default route(['GET', 'PATCH'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') return send(res, 200, { leads: await repo.listLeads() });

    const body = await readJson(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('Invalid lead id');
    if (body.status != null && !LEAD_STATUSES.includes(body.status)) throw badRequest('Invalid status');
    const ok = await repo.updateLead(id, {
        status: body.status ?? null,
        notes: body.notes != null ? (cleanText(body.notes, 2000) ?? '') : null,
    });
    send(res, ok ? 200 : 404, ok ? { ok } : { error: 'Lead not found' });
});
