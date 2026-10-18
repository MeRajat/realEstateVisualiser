// Meta (Facebook / Instagram) Lead Ads webhook: every form submission becomes a lead card within
// seconds, tagged with the ad and form it came from. GET = verification; POST = leadgen events.
// Env: META_VERIFY_TOKEN, META_APP_SECRET (optional signature check), META_PAGE_TOKEN (to fetch
// the lead's answers from the Graph API; if absent, inline field_data in the payload is used).
import { route, send, readRaw, normalisePhone, cleanText } from '../_lib/http.js';
import { getRepo } from '../_lib/db.js';
import { verifySignature } from './whatsapp.js';

const FIELD = {
    name: ['full_name', 'name', 'first_name'], phone: ['phone_number', 'phone', 'mobile', 'mobile_number'],
    email: ['email'], city: ['city'],
};

export function leadFromFields(fieldData = []) {
    const get = (keys) => fieldData.find(f => keys.includes(String(f.name).toLowerCase()))?.values?.[0];
    const first = get(['first_name']), last = fieldData.find(f => f.name === 'last_name')?.values?.[0];
    const name = get(FIELD.name) || [first, last].filter(Boolean).join(' ');
    const extras = fieldData.filter(f => ![...FIELD.name, 'last_name', ...FIELD.phone, ...FIELD.email].includes(String(f.name).toLowerCase()))
        .map(f => `${String(f.name).replace(/_/g, ' ')}: ${(f.values || []).join(', ')}`).join(' · ');
    return { name: cleanText(name, 60), phone: normalisePhone(get(FIELD.phone)), email: cleanText(get(FIELD.email), 120), message: cleanText(extras, 500) };
}

async function fetchLead(leadgenId) {
    const token = process.env.META_PAGE_TOKEN;
    if (!token) return null;
    const res = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?fields=field_data,ad_name,adset_name,campaign_name,form_name,platform&access_token=${encodeURIComponent(token)}`);
    if (!res.ok) { console.error('[meta] lead fetch failed', res.status, await res.text().catch(() => '')); return null; }
    return res.json();
}

export default route(['GET', 'POST'], async (req, res) => {
    if (req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        if (q.get('hub.mode') === 'subscribe' && process.env.META_VERIFY_TOKEN && q.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
            res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end(q.get('hub.challenge') || '');
        }
        return send(res, 403, { error: 'Verification failed' });
    }
    const raw = await readRaw(req);
    if (!verifySignature(raw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET)) return send(res, 401, { error: 'Bad signature' });
    let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Bad JSON' }); }
    const repo = getRepo();
    const created = [];
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field !== 'leadgen') continue;
            const v = change.value || {};
            const detail = v.field_data ? v : await fetchLead(v.leadgen_id);
            if (!detail) { console.warn('[meta] no lead detail for', v.leadgen_id); continue; }
            const lead = leadFromFields(detail.field_data);
            if (!lead.phone) continue;
            const platform = String(detail.platform || v.platform || '').toLowerCase();
            const source = platform.startsWith('ig') || platform.includes('instagram') ? 'instagram' : 'facebook';
            const campaign = cleanText(detail.campaign_name || detail.ad_name || v.ad_name || detail.form_name || v.form_name, 80);
            const r = await repo.upsertInboundLead({ ...lead, source, campaign, adId: v.ad_id ? String(v.ad_id) : null });
            created.push({ id: r.id, source, campaign });
        }
    }
    send(res, 200, { ok: true, created });
});
