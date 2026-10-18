// GET /api/admin/insights?days=30[&coach=1] → drop-off funnel, speed to contact, lost reasons,
// site-visit no-shows, sources, team, and action items. coach=1 adds a short AI note.
import { getRepo } from '../lib/db.js';
import { route, send } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { computeInsights } from '../lib/insights.js';
import { aiEnabled, askText } from '../lib/ai.js';

const COACH = `You are a sales coach for a small Indian real-estate builder. You get the builder's funnel numbers as JSON (leads over the last N
days, conversion at each step, speed to first call, lost reasons, site-visit no-shows, sources, team). Write 3-4 short lines, each starting
with "•", in plain words a busy site owner reads on a phone: the single biggest leak and what it costs, one concrete thing to do this week,
one thing that is working. No headings, no markdown bold, numbers as digits. Hindi (Devanagari) if lang is "hi", else simple Indian English.
Never invent numbers that are not in the JSON.`;

export default route(['GET'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const days = Math.min(365, Math.max(7, Number(q.get('days')) || 30));
    const repo = getRepo();
    const since = new Date(Date.now() - 400 * 86400000).toISOString();
    const [leads, activities, units] = await Promise.all([repo.listLeads(), repo.activitiesSince(since), repo.listUnits()]);
    const priced = units.filter(u => u.status === 'available' && u.price_lakh).map(u => u.price_lakh);
    const out = computeInsights({ leads, activities, days, minPriceLakh: priced.length ? Math.min(...priced) : null, availablePlots: null });
    if (q.get('coach') === '1' && aiEnabled() && out.cohort >= 3) {
        try {
            const { stuckIds, ...facts } = out;
            out.coach = await askText({ system: COACH, user: JSON.stringify({ lang: q.get('lang') === 'hi' ? 'hi' : 'en', ...facts, speed: { ...facts.speed, uncontacted: facts.speed.uncontacted.length } }), maxTokens: 500 });
        } catch (e) { console.error('[insights] coach failed', e.message); }
    }
    send(res, 200, out);
});
