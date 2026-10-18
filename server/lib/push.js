// Instant lead alerts on the builder's phone (Web Push). Needs VAPID keys in env:
//   npx web-push generate-vapid-keys  →  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (+ VAPID_SUBJECT = mailto:you@example.com)
import webpush from 'web-push';
import { getRepo } from './db.js';

export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let ready = false;
function setup() {
    if (ready || !pushConfigured()) return;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    ready = true;
}

// Fire-and-forget: never let an alert failure break lead capture
export async function notifyAll({ title, body, url = '/admin/', tag = 'lead' }) {
    if (!pushConfigured()) return 0;
    setup();
    const repo = getRepo();
    const subs = await repo.listPushSubscriptions().catch(() => []);
    let sent = 0;
    await Promise.all(subs.map(async (sub) => {
        try { await webpush.sendNotification(sub, JSON.stringify({ title, body, url, tag }), { TTL: 3600 }); sent += 1; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await repo.removePushSubscription(sub.endpoint).catch(() => {}); else console.error('[push] failed', e.statusCode || e.message); }
    }));
    return sent;
}

export const leadAlert = (lead, extra = '') => notifyAll({
    title: `New customer: ${lead.name || 'Customer'}`,
    body: `${extra || 'Shared their number'} · tap to call`,
    url: `/admin/?lead=${lead.id}`,
    tag: `lead-${lead.id}`,
});
