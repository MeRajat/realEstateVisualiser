// GET → { configured, publicKey }; POST { subscription, label } ; DELETE { endpoint } ; POST { test: true }
import { getRepo } from '../_lib/db.js';
import { route, send, readJson, badRequest, cleanText } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { pushConfigured, notifyAll } from '../_lib/push.js';

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') return send(res, 200, { configured: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY || null, devices: (await repo.listPushSubscriptions()).length });
    const body = await readJson(req);
    if (req.method === 'DELETE') {
        if (!body.endpoint) throw badRequest('Missing endpoint');
        await repo.removePushSubscription(String(body.endpoint));
        return send(res, 200, { ok: true });
    }
    if (body.test) {
        if (!pushConfigured()) return send(res, 501, { error: 'Push alerts are not set up (VAPID keys missing)' });
        return send(res, 200, { ok: true, sent: await notifyAll({ title: 'Alerts are on', body: 'You will be told here when a new customer comes in.', tag: 'test' }) });
    }
    const sub = body.subscription;
    if (!pushConfigured()) return send(res, 501, { error: 'Push alerts are not set up (VAPID keys missing)' });
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) throw badRequest('Invalid subscription');
    await repo.addPushSubscription({ endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: sub.keys }, cleanText(body.label, 60));
    send(res, 200, { ok: true });
});
