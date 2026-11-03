// Every /api/virasat/* request. server/router.js hands requests here, so the project stays inside the
// single Vercel function (Hobby plan limit).
//   GET  health · GET inventory · POST track · POST lead
//   admin/session (GET/POST/DELETE) · admin/summary · admin/plots (GET/PATCH) · admin/leads (GET/PATCH/DELETE) · admin/export
import { route, send, readJson, badRequest, VISITOR_ID, cleanText, normalisePhone } from '../../server/lib/http.js';
import { getRepo, STATUSES, LEAD_STATUSES } from './repo.js';
import { isPlotId, plotById, PLOTS } from './plots.js';
import { checkPassword, startSession, endSession, isAuthed, requireAdmin } from './auth.js';

const EVENTS = new Set(['visit', 'plot_view', 'enquire', 'directions']);
const query = (req) => new URL(req.url, 'http://x').searchParams;
const plotIdOf = (v) => (v != null && isPlotId(String(v)) ? String(v) : null);

const health = route(['GET'], async (req, res) => {
    send(res, 200, { ok: true, ...(await getRepo().health()) });
});

const inventory = route(['GET'], async (req, res) => {
    const plots = await getRepo().publicInventory();
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ plots, updatedAt: new Date().toISOString() }));
});

const track = route(['POST'], async (req, res) => {
    const body = await readJson(req);
    if (!VISITOR_ID.test(body.visitorId || '') || !EVENTS.has(body.type)) throw badRequest('Invalid event');
    const repo = getRepo();
    if (body.type === 'visit') {
        const ua = cleanText(req.headers['user-agent'], 300) || '';
        await repo.recordVisit(body.visitorId, {
            isMobile: /Mobi|Android|iPhone/i.test(ua),
            referrer: cleanText(body.referrer, 300),
            utmSource: cleanText(body.utmSource, 40),
        });
    } else {
        await repo.recordEvent(body.visitorId, body.type, plotIdOf(body.plotId));
    }
    send(res, 200, { ok: true });
});

const lead = route(['POST'], async (req, res) => {
    const body = await readJson(req);
    if (body.website) return send(res, 200, { ok: true }); // honeypot field filled → bot
    const name = cleanText(body.name, 60);
    const phone = normalisePhone(body.phone);
    if (!VISITOR_ID.test(body.visitorId || '')) throw badRequest('Invalid session');
    if (!name || name.length < 2) throw badRequest('Please enter your name');
    if (!phone) throw badRequest('Please enter a valid 10-digit mobile number');
    const out = await getRepo().upsertLead({
        visitorId: body.visitorId,
        name,
        phone,
        plotId: plotIdOf(body.plotId),
        message: cleanText(body.message, 500),
    });
    send(res, 200, { ok: true, id: out.id });
});

// ─── admin ──────────────────────────────────────────
const session = route(['GET', 'POST', 'DELETE'], async (req, res) => {
    if (req.method === 'GET') return send(res, 200, { authed: isAuthed(req) });
    if (req.method === 'DELETE') { endSession(res); return send(res, 200, { ok: true }); }
    const { password } = await readJson(req);
    if (!checkPassword(password)) {
        await new Promise(r => setTimeout(r, 600));
        return send(res, 401, { error: 'Incorrect password' });
    }
    startSession(res);
    send(res, 200, { ok: true });
});

const summary = route(['GET'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    send(res, 200, await getRepo().summary());
});

function cleanPlotPatch(body) {
    const patch = {};
    if (body.status !== undefined) {
        if (!STATUSES.includes(body.status)) throw badRequest('Unknown status');
        patch.status = body.status;
    }
    if (body.pricePerSqYd !== undefined) {
        const v = body.pricePerSqYd === null || body.pricePerSqYd === '' ? null : Number(body.pricePerSqYd);
        if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e6)) throw badRequest('Price per sq yd looks wrong');
        patch.pricePerSqYd = v;
    }
    if (body.note !== undefined) patch.note = cleanText(body.note, 300);
    if (body.customerName !== undefined) patch.customerName = cleanText(body.customerName, 60);
    if (body.customerPhone !== undefined) {
        if (body.customerPhone === null || body.customerPhone === '') patch.customerPhone = null;
        else {
            const p = normalisePhone(body.customerPhone);
            if (!p) throw badRequest('Customer mobile should be 10 digits');
            patch.customerPhone = p;
        }
    }
    if (body.holdUntil !== undefined) {
        if (body.holdUntil === null || body.holdUntil === '') patch.holdUntil = null;
        else {
            const t = Date.parse(body.holdUntil);
            if (!Number.isFinite(t)) throw badRequest('Hold time looks wrong');
            patch.holdUntil = new Date(t).toISOString();
        }
    }
    if (patch.status === 'hold' && !patch.holdUntil && body.holdUntil === undefined) {
        patch.holdUntil = new Date(Date.now() + 2 * 86400000).toISOString(); // default: 2-day hold
    }
    return patch;
}

const plots = route(['GET', 'PATCH'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') {
        const q = query(req);
        if (q.get('history')) {
            const id = plotIdOf(q.get('history'));
            if (!id) throw badRequest('Unknown plot');
            return send(res, 200, { history: await repo.plotHistory(id) });
        }
        const [list, activity] = await Promise.all([repo.listPlots(), repo.plotActivity(30)]);
        return send(res, 200, { plots: list.map(p => ({ ...p, ...(activity[p.id] || { views: 0, people: 0, leads: 0 }) })) });
    }
    const body = await readJson(req);
    const id = plotIdOf(body.id);
    if (!id) throw badRequest('Unknown plot');
    if (!Number.isInteger(Number(body.version))) throw badRequest('Missing version');
    const out = await repo.updatePlot(id, cleanPlotPatch(body), Number(body.version), 'admin');
    if (out.notFound) return send(res, 404, { error: 'Unknown plot' });
    if (out.conflict) return send(res, 409, { error: 'Someone else changed this plot. Showing the latest.', plot: out.plot });
    send(res, 200, { plot: out.plot });
});

const leads = route(['GET', 'PATCH', 'DELETE'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'GET') return send(res, 200, { leads: await repo.listLeads() });
    const body = req.method === 'DELETE' ? Object.fromEntries(query(req)) : await readJson(req);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) throw badRequest('Unknown customer');
    if (req.method === 'DELETE') {
        return (await repo.deleteLead(id)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Not found' });
    }
    const patch = {};
    if (body.status !== undefined) {
        if (!LEAD_STATUSES.includes(body.status)) throw badRequest('Unknown stage');
        patch.status = body.status;
    }
    if (body.notes !== undefined) patch.notes = cleanText(body.notes, 1000);
    if (body.followUp !== undefined) {
        if (body.followUp && !/^\d{4}-\d{2}-\d{2}$/.test(body.followUp)) throw badRequest('Follow-up date looks wrong');
        patch.followUp = body.followUp || null;
    }
    const lead = await repo.updateLead(id, patch);
    if (!lead) return send(res, 404, { error: 'Not found' });
    send(res, 200, { lead });
});

const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s; // stop spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

const exporter = route(['GET'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const kind = query(req).get('kind');
    const repo = getRepo();
    let body;
    if (kind === 'plots') {
        const list = await repo.listPlots();
        body = csv([['Plot', 'Status', 'Area (sq yd)', 'Price per sq yd', 'Total price', 'Customer', 'Mobile', 'Hold until', 'Note', 'Updated'],
            ...list.map(p => {
                const area = plotById.get(p.id)?.areaSqYd;
                return [p.id, p.status, area, p.pricePerSqYd, p.pricePerSqYd && area ? Math.round(p.pricePerSqYd * area) : '', p.customerName, p.customerPhone, p.holdUntil, p.note, p.updatedAt];
            })]);
    } else if (kind === 'leads') {
        const list = await repo.listLeads();
        body = csv([['Name', 'Mobile', 'Plot', 'Stage', 'Follow-up', 'Notes', 'Message', 'Source', 'Enquiries', 'First enquiry'],
            ...list.map(l => [l.name, l.phone, l.plotId, l.status, l.followUp, l.notes, l.message, l.source, l.enquiries, l.createdAt])]);
    } else throw badRequest('Unknown export');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="virasat-homes-${kind}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end('﻿' + body);
});

export const routes = {
    health, inventory, track, lead,
    'admin/session': session, 'admin/summary': summary, 'admin/plots': plots, 'admin/leads': leads, 'admin/export': exporter,
};

// sub = path after "virasat/"
export default function virasat(req, res, sub) {
    const h = routes[sub];
    if (!h) return send(res, 404, { error: 'Not found' });
    return h(req, res);
}

export { PLOTS };
