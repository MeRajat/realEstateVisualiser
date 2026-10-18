// POST /api/lead — customer submits name + mobile number.
import { getRepo } from './lib/db.js';
import { route, send, readJson, badRequest, VISITOR_ID, PLOT_ID, cleanText, normalisePhone } from './lib/http.js';
import { leadAlert } from './lib/push.js';

export default route(['POST'], async (req, res) => {
    const body = await readJson(req);
    if (body.website) return send(res, 200, { ok: true }); // honeypot filled → bot; pretend success
    const name = cleanText(body.name, 60);
    const phone = normalisePhone(body.phone);
    if (!VISITOR_ID.test(body.visitorId || '')) throw badRequest('Invalid session');
    if (!name || name.length < 2) throw badRequest('Please enter your name');
    if (!phone) throw badRequest('Please enter a valid 10-digit mobile number');
    const plotId = body.plotId != null && PLOT_ID.test(String(body.plotId)) ? String(body.plotId) : null;

    const lead = await getRepo().upsertLead({
        visitorId: body.visitorId,
        name,
        phone,
        plotId,
        message: cleanText(body.message, 500),
        cp: cleanText(body.cp, 40),
    });
    if (lead.created) leadAlert({ id: lead.id, name }, plotId ? `Interested in Plot ${plotId}` : 'Shared their number on the website').catch(() => {});
    send(res, 200, { ok: true, id: lead.id });
});
