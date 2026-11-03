// Virasat Homes storage. Neon Postgres when DATABASE_URL / POSTGRES_URL is set (Vercel), otherwise an
// in-memory store for local development. Tables are prefixed vh_ so they live beside the other project.
import { neon } from '@neondatabase/serverless';
import { PLOT_IDS, plotById, plotOrder } from './plots.js';

export const STATUSES = ['available', 'hold', 'booked', 'sold', 'blocked'];
export const LEAD_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation', 'booked', 'lost'];
const TZ = 'Asia/Kolkata';
const DAY = 86400000;

const num = (v) => (v == null ? null : Number(v));
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const dayIST = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
export const todayIST = () => dayIST(Date.now());

function lastDays(n) {
    const out = [];
    const today = Date.parse(todayIST() + 'T00:00:00Z');
    for (let i = n - 1; i >= 0; i--) out.push(new Date(today - i * DAY).toISOString().slice(0, 10));
    return out;
}

// What a source string looks like for a visit
export function sourceOf(referrer, utm) {
    const u = String(utm || '').toLowerCase();
    if (u) return u.replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'other';
    const r = String(referrer || '').toLowerCase();
    if (!r) return 'direct';
    if (/google\.|bing\.|duckduckgo|yahoo\./.test(r)) return 'google';
    if (/instagram/.test(r)) return 'instagram';
    if (/facebook\.|fb\./.test(r)) return 'facebook';
    if (/whatsapp|wa\.me/.test(r)) return 'whatsapp';
    if (/99acres|magicbricks|housing\.com/.test(r)) return 'property portal';
    return 'other';
}

const plotRow = (r) => ({
    id: r.id,
    status: r.status,
    pricePerSqYd: num(r.price_per_sqyd),
    note: r.note || null,
    customerName: r.customer_name || null,
    customerPhone: r.customer_phone || null,
    holdUntil: iso(r.hold_until),
    version: Number(r.version),
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by || null,
});

const leadRow = (r) => ({
    id: Number(r.id),
    name: r.name,
    phone: r.phone,
    plotId: r.plot_id || null,
    message: r.message || null,
    status: r.status,
    notes: r.notes || null,
    followUp: r.follow_up ? (r.follow_up instanceof Date ? r.follow_up.toISOString().slice(0, 10) : String(r.follow_up).slice(0, 10)) : null,
    source: r.source || 'direct',
    enquiries: Number(r.enquiries || 1),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
});

// Shared summary maths for both stores
function buildSummary({ plots, leads, visitDays, leadDays, topViewed, visitors }) {
    const byStatus = Object.fromEntries(STATUSES.map(s => [s, 0]));
    let soldArea = 0;
    let bookedValue = 0;
    let availableArea = 0;
    for (const p of plots) {
        byStatus[p.status] = (byStatus[p.status] || 0) + 1;
        const area = plotById.get(p.id)?.areaSqYd || 0;
        if (p.status === 'sold' || p.status === 'booked') {
            soldArea += area;
            if (p.pricePerSqYd) bookedValue += p.pricePerSqYd * area;
        }
        if (p.status === 'available') availableArea += area;
    }
    const leadsByStatus = Object.fromEntries(LEAD_STATUSES.map(s => [s, 0]));
    leads.forEach(l => { leadsByStatus[l.status] = (leadsByStatus[l.status] || 0) + 1; });
    const days = lastDays(14);
    return {
        plots: { total: plots.length, byStatus, soldAreaSqYd: Math.round(soldArea), availableAreaSqYd: Math.round(availableArea), bookedValue: Math.round(bookedValue) },
        leads: { total: leads.length, byStatus: leadsByStatus, last7: leads.filter(l => Date.now() - Date.parse(l.createdAt) < 7 * DAY).length },
        visitors,
        series: days.map(d => ({ day: d, visitors: visitDays[d] || 0, leads: leadDays[d] || 0 })),
        topViewed,
        recentLeads: [...leads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5),
    };
}

// ─── POSTGRES ───────────────────────────────────────
export function pgRepo(sql) {
    let ready;
    const migrate = () => (ready ??= (async () => {
        await sql`create table if not exists vh_plots (
            id text primary key,
            status text not null default 'available',
            price_per_sqyd numeric,
            note text,
            customer_name text,
            customer_phone text,
            hold_until timestamptz,
            version int not null default 0,
            updated_at timestamptz not null default now(),
            updated_by text
        )`;
        await sql`create table if not exists vh_plot_log (
            id bigserial primary key,
            plot_id text not null,
            action text not null,
            detail jsonb,
            actor text,
            created_at timestamptz not null default now()
        )`;
        await sql`create table if not exists vh_leads (
            id bigserial primary key,
            name text not null,
            phone text not null unique,
            plot_id text,
            message text,
            status text not null default 'new',
            notes text,
            follow_up date,
            source text,
            visitor_id text,
            enquiries int not null default 1,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`;
        await sql`create table if not exists vh_visitors (
            id text primary key,
            first_seen timestamptz not null default now(),
            last_seen timestamptz not null default now(),
            visits int not null default 0,
            is_mobile boolean,
            source text,
            lead_id bigint
        )`;
        await sql`create table if not exists vh_events (
            id bigserial primary key,
            visitor_id text not null,
            type text not null,
            plot_id text,
            created_at timestamptz not null default now()
        )`;
        await sql`create index if not exists vh_events_created_idx on vh_events (created_at)`;
        await sql`create index if not exists vh_plot_log_plot_idx on vh_plot_log (plot_id, created_at desc)`;
        await sql`insert into vh_plots (id) select unnest(${PLOT_IDS}::text[]) on conflict (id) do nothing`;
    })().catch(e => { ready = null; throw e; }));

    // Holds free themselves once their time runs out
    async function expireHolds() {
        const freed = await sql`update vh_plots set status = 'available', hold_until = null, version = version + 1, updated_at = now(), updated_by = 'hold expired'
            where status = 'hold' and hold_until is not null and hold_until < now() returning id`;
        for (const r of freed) await sql`insert into vh_plot_log (plot_id, action, detail, actor) values (${r.id}, 'hold_expired', ${JSON.stringify({ status: 'available' })}::jsonb, 'system')`;
    }

    async function listPlots() {
        await migrate();
        await expireHolds();
        const rows = await sql`select * from vh_plots`;
        return rows.map(plotRow).filter(p => plotById.has(p.id)).sort((a, b) => plotOrder(a.id, b.id));
    }

    return {
        kind: 'postgres',
        async health() {
            await migrate();
            const [r] = await sql`select count(*) as n from vh_plots`;
            return { db: 'postgres', plots: Number(r.n) };
        },
        async publicInventory() {
            const plots = await listPlots();
            return plots.map(p => ({ id: p.id, status: p.status, pricePerSqYd: p.pricePerSqYd, holdUntil: p.status === 'hold' ? p.holdUntil : null }));
        },
        async recordVisit(visitorId, { isMobile, referrer, utmSource }) {
            await migrate();
            await sql`insert into vh_visitors (id, visits, is_mobile, source) values (${visitorId}, 1, ${!!isMobile}, ${sourceOf(referrer, utmSource)})
                on conflict (id) do update set visits = vh_visitors.visits + 1, last_seen = now()`;
            await sql`insert into vh_events (visitor_id, type) values (${visitorId}, 'visit')`;
        },
        async recordEvent(visitorId, type, plotId) {
            await migrate();
            await sql`insert into vh_events (visitor_id, type, plot_id) values (${visitorId}, ${type}, ${plotId})`;
        },
        async upsertLead({ visitorId, name, phone, plotId, message }) {
            await migrate();
            const [row] = await sql`insert into vh_leads (name, phone, plot_id, message, source, visitor_id)
                values (${name}, ${phone}, ${plotId}, ${message},
                        coalesce((select source from vh_visitors where id = ${visitorId}), 'direct'), ${visitorId})
                on conflict (phone) do update set
                    name = excluded.name,
                    plot_id = coalesce(excluded.plot_id, vh_leads.plot_id),
                    message = coalesce(excluded.message, vh_leads.message),
                    enquiries = vh_leads.enquiries + 1,
                    updated_at = now()
                returning id, (xmax = 0) as created`;
            await sql`update vh_visitors set lead_id = ${row.id} where id = ${visitorId}`;
            await sql`insert into vh_events (visitor_id, type, plot_id) values (${visitorId}, 'lead', ${plotId})`;
            return { id: Number(row.id), created: !!row.created };
        },
        listPlots,
        async updatePlot(id, patch, version, actor) {
            await migrate();
            const [cur] = await sql`select * from vh_plots where id = ${id}`;
            if (!cur) return { notFound: true };
            if (Number(cur.version) !== Number(version)) return { conflict: true, plot: plotRow(cur) };
            const next = { ...plotRow(cur), ...patch };
            const [row] = await sql`update vh_plots set
                    status = ${next.status}, price_per_sqyd = ${next.pricePerSqYd}, note = ${next.note},
                    customer_name = ${next.customerName}, customer_phone = ${next.customerPhone},
                    hold_until = ${next.status === 'hold' ? next.holdUntil : null},
                    version = version + 1, updated_at = now(), updated_by = ${actor}
                where id = ${id} and version = ${Number(version)} returning *`;
            if (!row) {
                const [again] = await sql`select * from vh_plots where id = ${id}`;
                return { conflict: true, plot: plotRow(again) };
            }
            await sql`insert into vh_plot_log (plot_id, action, detail, actor) values (${id}, 'update', ${JSON.stringify(patch)}::jsonb, ${actor})`;
            return { plot: plotRow(row) };
        },
        async plotHistory(id) {
            await migrate();
            const rows = await sql`select action, detail, actor, created_at from vh_plot_log where plot_id = ${id} order by created_at desc limit 50`;
            return rows.map(r => ({ action: r.action, detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : r.detail, actor: r.actor, at: iso(r.created_at) }));
        },
        async plotActivity(days = 30) {
            await migrate();
            const rows = await sql`select plot_id, count(*) as views, count(distinct visitor_id) as people from vh_events
                where type = 'plot_view' and plot_id is not null and created_at > now() - make_interval(days => ${days}) group by plot_id`;
            const leads = await sql`select plot_id, count(*) as n from vh_leads where plot_id is not null group by plot_id`;
            const out = {};
            rows.forEach(r => { out[r.plot_id] = { views: Number(r.views), people: Number(r.people), leads: 0 }; });
            leads.forEach(r => { (out[r.plot_id] ??= { views: 0, people: 0, leads: 0 }).leads = Number(r.n); });
            return out;
        },
        async listLeads() {
            await migrate();
            const rows = await sql`select * from vh_leads order by created_at desc limit 1000`;
            return rows.map(leadRow);
        },
        async updateLead(id, patch) {
            await migrate();
            const [cur] = await sql`select * from vh_leads where id = ${id}`;
            if (!cur) return null;
            const next = { ...leadRow(cur), ...patch };
            const [row] = await sql`update vh_leads set status = ${next.status}, notes = ${next.notes}, follow_up = ${next.followUp},
                updated_at = now() where id = ${id} returning *`;
            return leadRow(row);
        },
        async deleteLead(id) {
            await migrate();
            const rows = await sql`delete from vh_leads where id = ${id} returning id`;
            return rows.length > 0;
        },
        async summary() {
            const plots = await listPlots();
            const leads = (await sql`select * from vh_leads`).map(leadRow);
            const since = new Date(Date.now() - 15 * DAY).toISOString();
            const vrows = await sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day, count(distinct visitor_id) as n
                from vh_events where type = 'visit' and created_at > ${since} group by 1`;
            const [v] = await sql`select
                    count(distinct visitor_id) filter (where created_at > now() - interval '1 day') as d1,
                    count(distinct visitor_id) filter (where created_at > now() - interval '7 days') as d7,
                    count(distinct visitor_id) filter (where created_at > now() - interval '30 days') as d30
                from vh_events where type = 'visit'`;
            const [t] = await sql`select count(distinct visitor_id) filter (where to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') = ${todayIST()}) as today from vh_events where type = 'visit'`;
            const top = await sql`select plot_id, count(*) as views, count(distinct visitor_id) as people from vh_events
                where type = 'plot_view' and plot_id is not null and created_at > now() - interval '30 days'
                group by plot_id order by people desc, views desc limit 8`;
            const visitDays = Object.fromEntries(vrows.map(r => [r.day, Number(r.n)]));
            const leadDays = {};
            leads.forEach(l => { const d = dayIST(l.createdAt); leadDays[d] = (leadDays[d] || 0) + 1; });
            return buildSummary({
                plots, leads, visitDays, leadDays,
                visitors: { today: Number(t.today), last7: Number(v.d7), last30: Number(v.d30) },
                topViewed: top.map(r => ({ id: r.plot_id, views: Number(r.views), people: Number(r.people) })),
            });
        },
    };
}

// ─── IN-MEMORY (local dev / tests) ──────────────────
export function memoryRepo() {
    const plots = new Map(PLOT_IDS.map(id => [id, { id, status: 'available', pricePerSqYd: null, note: null, customerName: null, customerPhone: null, holdUntil: null, version: 0, updatedAt: new Date().toISOString(), updatedBy: null }]));
    const log = [];
    let leads = [];
    const visitors = new Map();
    const events = [];
    let seq = 0;
    const expire = () => {
        plots.forEach(p => {
            if (p.status === 'hold' && p.holdUntil && Date.parse(p.holdUntil) < Date.now()) {
                Object.assign(p, { status: 'available', holdUntil: null, version: p.version + 1, updatedBy: 'hold expired', updatedAt: new Date().toISOString() });
                log.push({ plotId: p.id, action: 'hold_expired', detail: { status: 'available' }, actor: 'system', at: new Date().toISOString() });
            }
        });
    };
    const listPlots = async () => { expire(); return [...plots.values()].map(p => ({ ...p })).sort((a, b) => plotOrder(a.id, b.id)); };
    return {
        kind: 'memory',
        async health() { return { db: 'memory', plots: plots.size }; },
        async publicInventory() { return (await listPlots()).map(p => ({ id: p.id, status: p.status, pricePerSqYd: p.pricePerSqYd, holdUntil: p.status === 'hold' ? p.holdUntil : null })); },
        async recordVisit(visitorId, { isMobile, referrer, utmSource }) {
            const v = visitors.get(visitorId) || { id: visitorId, visits: 0, isMobile: !!isMobile, source: sourceOf(referrer, utmSource) };
            v.visits++;
            visitors.set(visitorId, v);
            events.push({ visitorId, type: 'visit', plotId: null, at: Date.now() });
        },
        async recordEvent(visitorId, type, plotId) { events.push({ visitorId, type, plotId, at: Date.now() }); },
        async upsertLead({ visitorId, name, phone, plotId, message }) {
            const now = new Date().toISOString();
            let l = leads.find(x => x.phone === phone);
            const created = !l;
            if (l) Object.assign(l, { name, plotId: plotId ?? l.plotId, message: message ?? l.message, enquiries: l.enquiries + 1, updatedAt: now });
            else {
                l = { id: ++seq, name, phone, plotId, message, status: 'new', notes: null, followUp: null, source: visitors.get(visitorId)?.source || 'direct', enquiries: 1, createdAt: now, updatedAt: now };
                leads.push(l);
            }
            events.push({ visitorId, type: 'lead', plotId, at: Date.now() });
            return { id: l.id, created };
        },
        listPlots,
        async updatePlot(id, patch, version, actor) {
            const p = plots.get(id);
            if (!p) return { notFound: true };
            if (p.version !== Number(version)) return { conflict: true, plot: { ...p } };
            Object.assign(p, patch, { version: p.version + 1, updatedAt: new Date().toISOString(), updatedBy: actor });
            if (p.status !== 'hold') p.holdUntil = null;
            log.push({ plotId: id, action: 'update', detail: patch, actor, at: new Date().toISOString() });
            return { plot: { ...p } };
        },
        async plotHistory(id) { return log.filter(l => l.plotId === id).reverse().map(({ plotId, ...r }) => r); },
        async plotActivity(days = 30) {
            const since = Date.now() - days * DAY;
            const out = {};
            events.filter(e => e.type === 'plot_view' && e.plotId && e.at > since).forEach(e => {
                const o = (out[e.plotId] ??= { views: 0, people: new Set(), leads: 0 });
                o.views++; o.people.add(e.visitorId);
            });
            Object.values(out).forEach(o => { o.people = o.people.size; });
            leads.filter(l => l.plotId).forEach(l => { (out[l.plotId] ??= { views: 0, people: 0, leads: 0 }).leads++; });
            return out;
        },
        async listLeads() { return [...leads].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map(l => ({ ...l })); },
        async updateLead(id, patch) {
            const l = leads.find(x => x.id === Number(id));
            if (!l) return null;
            Object.assign(l, patch, { updatedAt: new Date().toISOString() });
            return { ...l };
        },
        async deleteLead(id) {
            const n = leads.length;
            leads = leads.filter(l => l.id !== Number(id));
            return leads.length < n;
        },
        async summary() {
            const all = await listPlots();
            const visits = events.filter(e => e.type === 'visit');
            const uniq = (ms) => new Set(visits.filter(e => Date.now() - e.at < ms).map(e => e.visitorId)).size;
            const visitDays = {};
            const seen = new Set();
            visits.forEach(e => { const d = dayIST(e.at); const k = d + e.visitorId; if (!seen.has(k)) { seen.add(k); visitDays[d] = (visitDays[d] || 0) + 1; } });
            const leadDays = {};
            leads.forEach(l => { const d = dayIST(l.createdAt); leadDays[d] = (leadDays[d] || 0) + 1; });
            const act = await this.plotActivity(30);
            const topViewed = Object.entries(act).filter(([, a]) => a.views).map(([id, a]) => ({ id, views: a.views, people: a.people }))
                .sort((a, b) => b.people - a.people || b.views - a.views).slice(0, 8);
            return buildSummary({
                plots: all, leads: await this.listLeads(), visitDays, leadDays, topViewed,
                visitors: { today: new Set(visits.filter(e => dayIST(e.at) === todayIST()).map(e => e.visitorId)).size, last7: uniq(7 * DAY), last30: uniq(30 * DAY) },
            });
        },
    };
}

let repo;
export function getRepo() {
    if (repo) return repo;
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (url) repo = pgRepo(neon(url));
    else if (process.env.VERCEL) throw Object.assign(new Error('Database is not configured'), { status: 500 });
    else repo = memoryRepo();
    return repo;
}

// Tests swap in their own store
export function setRepo(r) { repo = r; }
