// WhatsApp Cloud API webhook. GET = Meta's verification handshake; POST = inbound messages.
// Env: WA_VERIFY_TOKEN (any secret you type into Meta's webhook form), WA_APP_SECRET (optional,
// checks the X-Hub-Signature-256 header), WA_TOKEN + WA_PHONE_ID (to send replies).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { route, send, readRaw } from '../_lib/http.js';
import { handleInbound } from '../_lib/wa-bot.js';

export function verifySignature(raw, header, secret) {
    if (!secret) return true;
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(String(header || '')), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export default route(['GET', 'POST'], async (req, res) => {
    if (req.method === 'GET') {
        const q = new URL(req.url, 'http://x').searchParams;
        if (q.get('hub.mode') === 'subscribe' && process.env.WA_VERIFY_TOKEN && q.get('hub.verify_token') === process.env.WA_VERIFY_TOKEN) {
            res.statusCode = 200; res.setHeader('Content-Type', 'text/plain'); return res.end(q.get('hub.challenge') || '');
        }
        return send(res, 403, { error: 'Verification failed' });
    }
    const raw = await readRaw(req);
    if (!verifySignature(raw, req.headers['x-hub-signature-256'], process.env.WA_APP_SECRET)) return send(res, 401, { error: 'Bad signature' });
    let body; try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Bad JSON' }); }
    const handled = [];
    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const v = change.value || {};
            const names = new Map((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
            for (const m of v.messages || []) {
                const text = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : null;
                const phone = String(m.from || '').replace(/^91(?=\d{10}$)/, '');
                if (!text || !/^[6-9]\d{9}$/.test(phone)) continue;
                try {
                    const r = await handleInbound({ phone, text: String(text).slice(0, 1000), profileName: names.get(m.from) || null });
                    handled.push({ phone, replied: !!r.reply, sent: r.sent });
                } catch (e) { console.error('[wa] inbound failed', e); }
            }
        }
    }
    send(res, 200, { ok: true, handled });
});
