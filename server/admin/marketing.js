// Marketing tab data + actions.
// GET ?days=30 → { campaigns, spend, waThreads, setup }
// GET ?thread=<phone> → { messages }
// POST { action: 'spend', source, campaign, week, amount } | { action: 'spend-delete', id }
//      { action: 'wa-test', phone, text }  → run the assistant without sending (sandbox)
//      { action: 'wa-send', phone, text }  → builder replies (sent via Cloud API when configured)
import { getRepo } from '../lib/db.js';
import { route, send, readJson, badRequest, cleanText, normalisePhone } from '../lib/http.js';
import { requireAdmin } from '../lib/auth.js';
import { handleInbound, sendWhatsApp, waConfigured } from '../lib/wa-bot.js';
import { aiEnabled } from '../lib/ai.js';

const SOURCES = ['facebook', 'instagram', 'google', 'whatsapp', 'youtube', '99acres', 'magicbricks', 'other'];

function setup(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const proto = req.headers['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https');
    const base = `${proto}://${host}`;
    return {
        ai: aiEnabled(),
        whatsapp: { configured: waConfigured(), verifyToken: !!process.env.WA_VERIFY_TOKEN, webhookUrl: `${base}/api/webhooks/whatsapp` },
        meta: { pageToken: !!process.env.META_PAGE_TOKEN, verifyToken: !!process.env.META_VERIFY_TOKEN, webhookUrl: `${base}/api/webhooks/meta` },
        siteUrl: base,
    };
}

export default route(['GET', 'POST'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        const thread = q.get('thread');
        if (thread) {
            const phone = normalisePhone(thread);
            if (!phone) throw badRequest('Invalid number');
            return send(res, 200, { messages: await repo.waThread(phone, 60) });
        }
        const days = Math.min(365, Math.max(7, Number(q.get('days')) || 30));
        const [campaigns, spend, waThreads] = await Promise.all([repo.campaignStats(days), repo.listSpend(days), repo.waThreads(30)]);
        return send(res, 200, { days, campaigns, spend, waThreads, setup: setup(req) });
    }
    const body = await readJson(req);
    switch (body.action) {
        case 'spend': {
            const source = SOURCES.includes(body.source) ? body.source : null;
            if (!source) throw badRequest('Pick a source');
            const amount = Number(body.amount);
            if (!Number.isFinite(amount) || amount <= 0 || amount > 1e8) throw badRequest('Enter the amount in rupees');
            const week = /^\d{4}-\d{2}-\d{2}$/.test(body.week || '') ? body.week : null;
            if (!week) throw badRequest('Pick a week');
            const r = await repo.addSpend({ source, campaign: cleanText(body.campaign, 80), week, amount: Math.round(amount) });
            return send(res, 200, { ok: true, id: r.id });
        }
        case 'spend-delete': {
            const ok = await repo.deleteSpend(Number(body.id));
            return send(res, ok ? 200 : 404, ok ? { ok } : { error: 'Not found' });
        }
        case 'wa-test': {
            const phone = normalisePhone(body.phone) || '9999900000';
            const text = cleanText(body.text, 1000);
            if (!text) throw badRequest('Type a message');
            const r = await handleInbound({ phone, text, profileName: cleanText(body.name, 40), send: false });
            return send(res, 200, { ...r, messages: await repo.waThread(phone, 60) });
        }
        case 'wa-send': {
            const phone = normalisePhone(body.phone);
            const text = cleanText(body.text, 1500);
            if (!phone || !text) throw badRequest('Number and message are needed');
            const sent = await sendWhatsApp(phone, text);
            await repo.addWaMessage({ phone, direction: 'out', text, kind: 'builder' });
            return send(res, 200, { ok: true, sent, configured: waConfigured() });
        }
        default: throw badRequest('Unknown action');
    }
});
