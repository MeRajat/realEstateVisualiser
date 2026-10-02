// POST /api/track — anonymous visitor analytics (visits, plot views, enquire taps).
import { getRepo } from './_lib/db.js';
import { route, send, readJson, badRequest, VISITOR_ID, PLOT_ID, cleanText } from './_lib/http.js';

const TYPES = new Set(['visit', 'plot_view', 'enquire', 'view_mode']);

export default route(['POST'], async (req, res) => {
    const body = await readJson(req);
    const { visitorId, type } = body;
    if (!VISITOR_ID.test(visitorId || '') || !TYPES.has(type)) throw badRequest('Invalid event');
    const plotId = body.plotId != null && PLOT_ID.test(String(body.plotId)) ? String(body.plotId) : null;

    const repo = getRepo();
    if (type === 'visit') {
        const ua = cleanText(req.headers['user-agent'], 300);
        await repo.recordVisit(visitorId, {
            userAgent: ua,
            referrer: cleanText(body.referrer, 300),
            isMobile: /Mobi|Android|iPhone/i.test(ua || ''),
        });
    } else {
        await repo.recordEvent(visitorId, type, type === 'view_mode' ? null : plotId, type === 'view_mode' ? cleanText(body.mode, 20) : null);
    }
    send(res, 200, { ok: true });
});
