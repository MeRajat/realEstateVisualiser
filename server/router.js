// All API endpoints behind one entry point (Vercel's Hobby plan allows 12 functions per deploy;
// this keeps us at one). Add a handler here and it is live at /api/<path>.
import track from './track.js';
import lead from './lead.js';
import inventory from './inventory.js';
import admin_session from './admin/session.js';
import admin_demo from './admin/demo.js';
import admin_leads from './admin/leads.js';
import admin_stats from './admin/stats.js';
import admin_inventory from './admin/inventory.js';
import admin_ai from './admin/ai.js';
import admin_marketing from './admin/marketing.js';
import admin_insights from './admin/insights.js';
import admin_activity from './admin/activity.js';
import admin_settings from './admin/settings.js';
import admin_push from './admin/push.js';
import webhooks_meta from './webhooks/meta.js';
import webhooks_whatsapp from './webhooks/whatsapp.js';

export const handlers = {
    'track': track,
    'lead': lead,
    'inventory': inventory,
    'admin/session': admin_session,
    'admin/demo': admin_demo,
    'admin/leads': admin_leads,
    'admin/stats': admin_stats,
    'admin/inventory': admin_inventory,
    'admin/ai': admin_ai,
    'admin/marketing': admin_marketing,
    'admin/insights': admin_insights,
    'admin/activity': admin_activity,
    'admin/settings': admin_settings,
    'admin/push': admin_push,
    'webhooks/meta': webhooks_meta,
    'webhooks/whatsapp': webhooks_whatsapp,
};

export function pathOf(req) {
    return new URL(req.url, 'http://x').pathname.replace(/^\/api\//, '').replace(/\/$/, '');
}

export async function route(req, res) {
    const handler = handlers[pathOf(req)];
    if (!handler) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify({ error: 'Not found' }));
    }
    return handler(req, res);
}
