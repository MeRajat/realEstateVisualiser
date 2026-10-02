// Storage layer. Uses Neon Postgres when DATABASE_URL / POSTGRES_URL is set,
// otherwise (local dev only) an in-memory store so the app runs with zero setup.
import { neon } from '@neondatabase/serverless';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const TZ = 'Asia/Kolkata';
const DAY_MS = 86400000;

// ─── POSTGRES ────────────────────────────────────────
export function pgRepo(sql) {
    let ready;
    const migrate = () => (ready ??= (async () => {
        await sql`create table if not exists leads (
            id bigserial primary key,
            name text not null,
            phone text not null unique,
            interested_plot text,
            message text,
            status text not null default 'new',
            notes text,
            enquiries int not null default 1,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`;
        await sql`create table if not exists visitors (
            id text primary key,
            lead_id bigint references leads(id) on delete set null,
            first_seen timestamptz not null default now(),
            last_seen timestamptz not null default now(),
            visits int not null default 0,
            is_mobile boolean,
            referrer text,
            user_agent text
        )`;
        await sql`create table if not exists events (
            id bigserial primary key,
            visitor_id text not null,
            type text not null,
            plot_id text,
            detail text,
            created_at timestamptz not null default now()
        )`;
        await sql`alter table events add column if not exists detail text`;
        await sql`create index if not exists events_created_idx on events (created_at)`;
        await sql`create index if not exists events_visitor_idx on events (visitor_id)`;
        await sql`create index if not exists visitors_lead_idx on visitors (lead_id)`;
    })().catch(e => { ready = null; throw e; }));

    return {
        kind: 'postgres',

        async recordVisit(visitorId, meta) {
            await migrate();
            await sql`insert into visitors (id, visits, is_mobile, referrer, user_agent)
                values (${visitorId}, 1, ${meta.isMobile}, ${meta.referrer}, ${meta.userAgent})
                on conflict (id) do update set visits = visitors.visits + 1, last_seen = now()`;
            await sql`insert into events (visitor_id, type) values (${visitorId}, 'visit')`;
        },

        async recordEvent(visitorId, type, plotId, detail = null) {
            await migrate();
            await sql`insert into events (visitor_id, type, plot_id, detail) values (${visitorId}, ${type}, ${plotId}, ${detail})`;
            await sql`update visitors set last_seen = now() where id = ${visitorId}`;
        },

        async upsertLead({ visitorId, name, phone, plotId, message }) {
            await migrate();
            const [lead] = await sql`insert into leads (name, phone, interested_plot, message)
                values (${name}, ${phone}, ${plotId}, ${message})
                on conflict (phone) do update set
                    name = excluded.name,
                    interested_plot = coalesce(excluded.interested_plot, leads.interested_plot),
                    message = coalesce(excluded.message, leads.message),
                    enquiries = leads.enquiries + 1,
                    updated_at = now()
                returning id`;
            await sql`insert into visitors (id, lead_id) values (${visitorId}, ${lead.id})
                on conflict (id) do update set lead_id = ${lead.id}, last_seen = now()`;
            await sql`insert into events (visitor_id, type, plot_id) values (${visitorId}, 'lead', ${plotId})`;
            return { id: Number(lead.id) };
        },

        async listLeads() {
            await migrate();
            const rows = await sql`select l.*,
                    coalesce(v.visits, 0)::int as visits,
                    v.last_seen,
                    v.is_mobile,
                    coalesce(p.plots, '[]'::json) as plots_viewed
                from leads l
                left join lateral (
                    select sum(visits) as visits, max(last_seen) as last_seen, bool_or(is_mobile) as is_mobile
                    from visitors where lead_id = l.id
                ) v on true
                left join lateral (
                    select json_agg(json_build_object('plot', plot_id, 'views', n) order by n desc) as plots
                    from (
                        select e.plot_id, count(*)::int as n
                        from events e join visitors vi on vi.id = e.visitor_id
                        where vi.lead_id = l.id and e.type = 'plot_view' and e.plot_id is not null
                        group by e.plot_id
                    ) t
                ) p on true
                order by l.created_at desc
                limit 2000`;
            return rows.map(r => ({ ...r, id: Number(r.id) }));
        },

        async updateLead(id, { status, notes }) {
            await migrate();
            const rows = await sql`update leads set
                    status = coalesce(${status}, status),
                    notes = coalesce(${notes}, notes),
                    updated_at = now()
                where id = ${id} returning id`;
            return rows.length > 0;
        },

        async getStats(days) {
            await migrate();
            const since = new Date(Date.now() - (days - 1) * DAY_MS);
            const [totals] = await sql`select
                (select count(*)::int from visitors) as visitors,
                (select coalesce(sum(visits), 0)::int from visitors) as visits,
                (select count(*)::int from leads) as leads,
                (select count(*)::int from leads where created_at > now() - interval '7 days') as leads_7d,
                (select count(*)::int from visitors where first_seen > now() - interval '7 days') as visitors_7d,
                (select count(*)::int from visitors where is_mobile) as mobile`;
            const visitDays = await sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day,
                    count(distinct visitor_id)::int as n
                from events where type = 'visit' and created_at >= ${since}
                group by 1`;
            const leadDays = await sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day, count(*)::int as n
                from leads where created_at >= ${since} group by 1`;
            const topPlots = await sql`select plot_id as plot,
                    count(*) filter (where type = 'plot_view')::int as views,
                    count(*) filter (where type in ('enquire', 'lead'))::int as enquiries
                from events where plot_id is not null and type in ('plot_view', 'enquire', 'lead')
                group by plot_id order by views desc, enquiries desc limit 10`;
            return { totals, daily: mergeDaily(days, visitDays, leadDays), topPlots };
        },
    };
}

// ─── IN-MEMORY (local dev) ───────────────────────────
function memoryRepo() {
    const leads = [];
    const visitors = new Map();
    const events = [];
    const now = () => new Date().toISOString();
    const touch = (id) => {
        if (!visitors.has(id)) visitors.set(id, { id, lead_id: null, first_seen: now(), last_seen: now(), visits: 0 });
        const v = visitors.get(id);
        v.last_seen = now();
        return v;
    };

    return {
        kind: 'memory',

        async recordVisit(visitorId, meta) {
            const v = touch(visitorId);
            v.visits += 1;
            v.is_mobile = meta.isMobile;
            events.push({ visitor_id: visitorId, type: 'visit', plot_id: null, created_at: now() });
        },

        async recordEvent(visitorId, type, plotId, detail = null) {
            touch(visitorId);
            events.push({ visitor_id: visitorId, type, plot_id: plotId, detail, created_at: now() });
        },

        async upsertLead({ visitorId, name, phone, plotId, message }) {
            let lead = leads.find(l => l.phone === phone);
            if (lead) {
                Object.assign(lead, { name, updated_at: now(), enquiries: lead.enquiries + 1 });
                if (plotId) lead.interested_plot = plotId;
                if (message) lead.message = message;
            } else {
                lead = { id: leads.length + 1, name, phone, interested_plot: plotId, message, status: 'new', notes: null, enquiries: 1, created_at: now(), updated_at: now() };
                leads.push(lead);
            }
            touch(visitorId).lead_id = lead.id;
            events.push({ visitor_id: visitorId, type: 'lead', plot_id: plotId, created_at: now() });
            return { id: lead.id };
        },

        async listLeads() {
            return [...leads].reverse().map(l => {
                const vs = [...visitors.values()].filter(v => v.lead_id === l.id);
                const ids = new Set(vs.map(v => v.id));
                const counts = {};
                events.filter(e => ids.has(e.visitor_id) && e.type === 'plot_view' && e.plot_id)
                    .forEach(e => { counts[e.plot_id] = (counts[e.plot_id] || 0) + 1; });
                return {
                    ...l,
                    visits: vs.reduce((s, v) => s + v.visits, 0),
                    last_seen: vs.map(v => v.last_seen).sort().pop() || null,
                    is_mobile: vs.some(v => v.is_mobile),
                    plots_viewed: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([plot, views]) => ({ plot, views })),
                };
            });
        },

        async updateLead(id, { status, notes }) {
            const lead = leads.find(l => l.id === id);
            if (!lead) return false;
            if (status != null) lead.status = status;
            if (notes != null) lead.notes = notes;
            lead.updated_at = now();
            return true;
        },

        async getStats(days) {
            const week = Date.now() - 7 * DAY_MS;
            const vs = [...visitors.values()];
            const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
            const group = (list, fn) => {
                const m = {};
                list.forEach(x => { const k = dayKey(x.created_at); (m[k] ??= new Set()).add(fn(x)); });
                return Object.entries(m).map(([day, s]) => ({ day, n: s.size }));
            };
            const plotsMap = {};
            events.filter(e => e.plot_id && ['plot_view', 'enquire', 'lead'].includes(e.type)).forEach(e => {
                const p = (plotsMap[e.plot_id] ??= { plot: e.plot_id, views: 0, enquiries: 0 });
                if (e.type === 'plot_view') p.views += 1;
                if (e.type === 'enquire' || e.type === 'lead') p.enquiries += 1;
            });
            return {
                totals: {
                    visitors: vs.length,
                    visits: vs.reduce((s, v) => s + v.visits, 0),
                    leads: leads.length,
                    leads_7d: leads.filter(l => Date.parse(l.created_at) > week).length,
                    visitors_7d: vs.filter(v => Date.parse(v.first_seen) > week).length,
                    mobile: vs.filter(v => v.is_mobile).length,
                },
                daily: mergeDaily(
                    days,
                    group(events.filter(e => e.type === 'visit'), e => e.visitor_id),
                    group(leads, l => l.id),
                ),
                topPlots: Object.values(plotsMap).sort((a, b) => b.views - a.views || b.enquiries - a.enquiries).slice(0, 10),
            };
        },
    };
}

// Fill a continuous series of days (oldest → newest) in IST.
function mergeDaily(days, visitRows, leadRows) {
    const v = Object.fromEntries(visitRows.map(r => [r.day, r.n]));
    const l = Object.fromEntries(leadRows.map(r => [r.day, r.n]));
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = new Date(Date.now() - i * DAY_MS).toLocaleDateString('en-CA', { timeZone: TZ });
        out.push({ day, visitors: v[day] || 0, leads: l[day] || 0 });
    }
    return out;
}

let repo;
export function getRepo() {
    if (repo) return repo;
    if (DB_URL) {
        repo = pgRepo(neon(DB_URL));
    } else if (process.env.VERCEL) {
        throw new Error('DATABASE_URL is not configured. Add a Neon Postgres database to this Vercel project.');
    } else {
        console.warn('[db] DATABASE_URL not set — using in-memory store (data resets on restart).');
        repo = memoryRepo();
    }
    return repo;
}
