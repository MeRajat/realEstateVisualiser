// GET ?days=30 → totals, daily visitors/leads series, most viewed plots.
import { getRepo } from '../lib/db.js';
import { route, send } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';

export default route(['GET'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const url = new URL(req.url, 'http://x');
    const days = Math.min(90, Math.max(7, parseInt(url.searchParams.get('days'), 10) || 30));
    send(res, 200, await getRepo().getStats(days));
});
