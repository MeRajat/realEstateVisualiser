// Storage layer. Uses Neon Postgres when DATABASE_URL / POSTGRES_URL is set,
// otherwise (local dev only) an in-memory store so the app runs with zero setup.
// Both implementations expose the same repository API.
import { neon } from '@neondatabase/serverless';

const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const TZ = 'Asia/Kolkata';
const DAY_MS = 86400000;
const ACTIVE = ['new', 'contacted', 'site_visit', 'negotiation'];
const PROGRESSED = ['site_visit', 'negotiation', 'booked'];

// Where a visitor came from, from the document.referrer we receive
export function sourceFromReferrer(ref) {
    if (!ref) return 'direct';
    const r = String(ref).toLowerCase();
    if (/google\.|bing\.|duckduckgo|yahoo\./.test(r)) return 'google';
    if (/instagram/.test(r)) return 'instagram';
    if (/facebook\.|fb\.|fbclid/.test(r)) return 'facebook';
    if (/whatsapp|wa\.me/.test(r)) return 'whatsapp';
    if (/99acres/.test(r)) return '99acres';
    if (/magicbricks/.test(r)) return 'magicbricks';
    return 'other';
}

// "Today" in IST as YYYY-MM-DD
export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const dayIST = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY_MS);

// Continuous series of days (oldest → newest) in IST
function dailySeries(days, rows) {
    const map = new Map(rows.map(r => [r.day, r]));
    const today = todayIST();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const day = addDays(today, -i);
        const r = map.get(day) || {};
        out.push({ day, visitors: r.visitors || 0, leads: r.leads || 0 });
    }
    return out;
}

function windowBounds(days) {
    const now = Date.now();
    return { since: new Date(now - days * DAY_MS).toISOString(), prev: new Date(now - 2 * days * DAY_MS).toISOString() };
}

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
        await sql`alter table events add column if not exists is_demo boolean not null default false`;
        await sql`alter table leads add column if not exists is_demo boolean not null default false`;
        await sql`alter table leads add column if not exists follow_up date`;
        await sql`alter table leads add column if not exists source text`;
        await sql`alter table visitors add column if not exists source text`;
        await sql`alter table visitors add column if not exists is_demo boolean not null default false`;
        await sql`create index if not exists events_created_idx on events (created_at)`;
        await sql`create index if not exists events_visitor_idx on events (visitor_id)`;
        await sql`create index if not exists visitors_lead_idx on visitors (lead_id)`;
        await sql`create index if not exists leads_follow_up_idx on leads (follow_up) where follow_up is not null`;
    })().catch(e => { ready = null; throw e; }));

    return {
        kind: 'postgres',

        async recordVisit(visitorId, meta) {
            await migrate();
            const source = sourceFromReferrer(meta.referrer);
            await sql`insert into visitors (id, visits, is_mobile, referrer, user_agent, source)
                values (${visitorId}, 1, ${meta.isMobile}, ${meta.referrer}, ${meta.userAgent}, ${source})
                on conflict (id) do update set visits = visitors.visits + 1, last_seen = now(),
                    source = coalesce(visitors.source, excluded.source)`;
            await sql`insert into events (visitor_id, type) values (${visitorId}, 'visit')`;
        },

        async recordEvent(visitorId, type, plotId, detail = null) {
            await migrate();
            await sql`insert into events (visitor_id, type, plot_id, detail) values (${visitorId}, ${type}, ${plotId}, ${detail})`;
            await sql`update visitors set last_seen = now() where id = ${visitorId}`;
        },

        async upsertLead({ visitorId, name, phone, plotId, message }) {
            await migrate();
            const [lead] = await sql`insert into leads (name, phone, interested_plot, message, source)
                values (${name}, ${phone}, ${plotId}, ${message},
                        coalesce((select source from visitors where id = ${visitorId}), 'direct'))
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
            const rows = await sql`select l.id, l.name, l.phone, l.interested_plot, l.message, l.status, l.notes,
                    l.enquiries, l.created_at, l.updated_at, coalesce(l.source, 'direct') as source,
                    l.follow_up::text as follow_up, l.is_demo,
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

        async leadTimeline(id) {
            await migrate();
            return sql`select e.type, e.plot_id, e.detail, e.created_at
                from events e join visitors v on v.id = e.visitor_id
                where v.lead_id = ${id}
                order by e.created_at desc limit 40`;
        },

        async updateLead(id, { status, notes, followUp }) {
            await migrate();
            const setFollow = followUp !== undefined;
            const rows = await sql`update leads set
                    status = coalesce(${status}, status),
                    notes = coalesce(${notes}, notes),
                    follow_up = case when ${setFollow} then ${setFollow ? followUp : null}::date else follow_up end,
                    updated_at = now()
                where id = ${id} returning id`;
            return rows.length > 0;
        },

        async getStats(days) {
            await migrate();
            const { since, prev } = windowBounds(days);
            const [ev] = await sql`select
                    count(distinct e.visitor_id) filter (where e.type = 'visit' and e.created_at >= ${since}::timestamptz)::int as visitors,
                    count(distinct e.visitor_id) filter (where e.type = 'visit' and e.created_at < ${since}::timestamptz)::int as visitors_prev,
                    count(*) filter (where e.type = 'visit' and e.created_at >= ${since}::timestamptz)::int as visits,
                    count(*) filter (where e.type = 'visit' and e.created_at < ${since}::timestamptz)::int as visits_prev,
                    count(*) filter (where e.type = 'plot_view' and e.created_at >= ${since}::timestamptz)::int as views,
                    count(*) filter (where e.type = 'plot_view' and e.created_at < ${since}::timestamptz)::int as views_prev,
                    count(distinct e.visitor_id) filter (where e.type = 'visit' and v.is_mobile and e.created_at >= ${since}::timestamptz)::int as mobile,
                    count(distinct e.visitor_id) filter (where e.type = 'visit' and v.is_mobile and e.created_at < ${since}::timestamptz)::int as mobile_prev,
                    count(distinct e.visitor_id) filter (where e.type = 'plot_view' and e.created_at >= ${since}::timestamptz)::int as f_viewed,
                    count(distinct e.visitor_id) filter (where e.type in ('enquire', 'lead') and e.created_at >= ${since}::timestamptz)::int as f_enquired
                from events e left join visitors v on v.id = e.visitor_id
                where e.created_at >= ${prev}::timestamptz`;
            const [ld] = await sql`select
                    count(*) filter (where created_at >= ${since}::timestamptz)::int as leads,
                    count(*) filter (where created_at >= ${prev}::timestamptz and created_at < ${since}::timestamptz)::int as leads_prev,
                    count(*) filter (where status = any(${PROGRESSED}) and created_at >= ${since}::timestamptz)::int as site_visits,
                    count(*) filter (where status = any(${PROGRESSED}) and created_at >= ${prev}::timestamptz and created_at < ${since}::timestamptz)::int as site_visits_prev,
                    count(*) filter (where status = 'booked' and updated_at >= ${since}::timestamptz)::int as booked,
                    count(*) filter (where status = 'booked' and updated_at >= ${prev}::timestamptz and updated_at < ${since}::timestamptz)::int as booked_prev,
                    count(*) filter (where status = 'booked' and created_at >= ${since}::timestamptz)::int as f_booked,
                    count(*)::int as leads_all,
                    bool_or(is_demo) as has_demo_leads
                from leads`;
            const visitDays = await sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day,
                    count(distinct visitor_id)::int as visitors
                from events where type = 'visit' and created_at >= ${since}::timestamptz group by 1`;
            const leadDays = await sql`select to_char(created_at at time zone ${TZ}, 'YYYY-MM-DD') as day, count(*)::int as leads
                from leads where created_at >= ${since}::timestamptz group by 1`;
            const srcVisitors = await sql`select coalesce(v.source, 'direct') as source, count(distinct e.visitor_id)::int as n
                from events e join visitors v on v.id = e.visitor_id
                where e.type = 'visit' and e.created_at >= ${since}::timestamptz group by 1`;
            const srcLeads = await sql`select coalesce(source, 'direct') as source, count(*)::int as n
                from leads where created_at >= ${since}::timestamptz group by 1`;
            const heat = await sql`select plot_id as plot,
                    count(*) filter (where type = 'plot_view')::int as views,
                    count(*) filter (where type in ('enquire', 'lead'))::int as enquiries
                from events
                where plot_id is not null and type in ('plot_view', 'enquire', 'lead') and created_at >= ${since}::timestamptz
                group by plot_id`;
            const activity = await sql`select e.type, e.plot_id, e.detail, e.created_at, v.is_mobile,
                    l.id as lead_id, l.name as lead_name
                from events e
                left join visitors v on v.id = e.visitor_id
                left join leads l on l.id = v.lead_id
                where e.type in ('plot_view', 'enquire', 'lead')
                order by e.created_at desc limit 25`;
            const followUps = await sql`select id, name, phone, status, interested_plot, follow_up::text as follow_up
                from leads
                where follow_up is not null and status <> all(${['booked', 'lost']})
                  and follow_up <= (now() at time zone ${TZ})::date + 7
                order by follow_up, id limit 80`;
            const [demo] = await sql`select exists(select 1 from visitors where is_demo) as v`;

            return assembleStats({
                days, ev, ld,
                daily: dailySeries(days, mergeDayRows(visitDays, leadDays)),
                srcVisitors, srcLeads, heat,
                activity: activity.map(a => ({ ...a, lead_id: a.lead_id == null ? null : Number(a.lead_id) })),
                followUps: followUps.map(f => ({ ...f, id: Number(f.id) })),
                hasDemo: !!(demo.v || ld.has_demo_leads),
            });
        },

        // ─── Demo data ───
        async insertDemo({ leads, visitors, events }) {
            await migrate();
            await sql`insert into leads (name, phone, interested_plot, message, status, notes, enquiries, source,
                        follow_up, created_at, updated_at, is_demo)
                select name, phone, interested_plot, message, status, notes, enquiries, source,
                       follow_up, created_at, updated_at, true
                from json_to_recordset(${JSON.stringify(leads)}::json) as x(
                    name text, phone text, interested_plot text, message text, status text, notes text,
                    enquiries int, source text, follow_up date, created_at timestamptz, updated_at timestamptz)
                on conflict (phone) do nothing`;
            for (let i = 0; i < visitors.length; i += 2500) {
                const chunk = JSON.stringify(visitors.slice(i, i + 2500));
                await sql`insert into visitors (id, lead_id, first_seen, last_seen, visits, is_mobile, referrer, user_agent, source, is_demo)
                    select x.id, l.id, x.first_seen, x.last_seen, x.visits, x.is_mobile, x.referrer, x.user_agent, x.source, true
                    from json_to_recordset(${chunk}::json) as x(
                        id text, lead_phone text, first_seen timestamptz, last_seen timestamptz, visits int,
                        is_mobile boolean, referrer text, user_agent text, source text)
                    left join leads l on l.phone = x.lead_phone and l.is_demo
                    on conflict (id) do nothing`;
            }
            for (let i = 0; i < events.length; i += 5000) {
                const chunk = JSON.stringify(events.slice(i, i + 5000));
                await sql`insert into events (visitor_id, type, plot_id, detail, created_at, is_demo)
                    select visitor_id, type, plot_id, detail, created_at, true
                    from json_to_recordset(${chunk}::json) as x(
                        visitor_id text, type text, plot_id text, detail text, created_at timestamptz)`;
            }
        },

        async clearDemo() {
            await migrate();
            await sql`delete from events where is_demo`;
            await sql`delete from visitors where is_demo`;
            await sql`delete from leads where is_demo`;
        },
    };
}

function mergeDayRows(visitDays, leadDays) {
    const map = new Map();
    visitDays.forEach(r => map.set(r.day, { day: r.day, visitors: r.visitors, leads: 0 }));
    leadDays.forEach(r => map.set(r.day, { ...(map.get(r.day) || { day: r.day, visitors: 0 }), leads: r.leads }));
    return [...map.values()];
}

// Shape the response (shared by both repos)
function assembleStats({ days, ev, ld, daily, srcVisitors, srcLeads, heat, activity, followUps, hasDemo }) {
    const sources = new Map();
    srcVisitors.forEach(r => sources.set(r.source, { source: r.source, visitors: r.n, leads: 0 }));
    srcLeads.forEach(r => sources.set(r.source, { ...(sources.get(r.source) || { source: r.source, visitors: 0 }), leads: r.n }));
    const today = todayIST();
    return {
        days,
        totals: {
            visitors: ev.visitors, visits: ev.visits, views: ev.views, mobile: ev.mobile,
            leads: ld.leads, siteVisits: ld.site_visits, booked: ld.booked, leadsAll: ld.leads_all,
        },
        previous: {
            visitors: ev.visitors_prev, visits: ev.visits_prev, views: ev.views_prev, mobile: ev.mobile_prev,
            leads: ld.leads_prev, siteVisits: ld.site_visits_prev, booked: ld.booked_prev,
        },
        daily,
        funnel: [
            { id: 'visitors', label: 'Visited the site', n: ev.visitors },
            { id: 'viewed', label: 'Opened a plot', n: ev.f_viewed },
            { id: 'enquired', label: 'Enquired', n: Math.max(ev.f_enquired, ld.leads) },
            { id: 'leads', label: 'Shared their number', n: ld.leads },
            { id: 'site_visit', label: 'Site visit or further', n: ld.site_visits },
            { id: 'booked', label: 'Booked', n: ld.f_booked },
        ],
        sources: [...sources.values()].sort((a, b) => b.visitors - a.visitors),
        heat,
        activity,
        followUps: followUps.map(f => ({ ...f, dueIn: diffDays(f.follow_up, today) })),
        hasDemo,
    };
}

// ─── IN-MEMORY (local dev) ───────────────────────────
function memoryRepo() {
    let leads = [];
    let visitors = new Map();
    let events = [];
    let nextLeadId = 1;
    const now = () => new Date().toISOString();
    const touch = (id) => {
        if (!visitors.has(id)) visitors.set(id, { id, lead_id: null, first_seen: now(), last_seen: now(), visits: 0, source: 'direct', is_demo: false });
        const v = visitors.get(id);
        v.last_seen = now();
        return v;
    };
    const leadVisitors = (lead) => [...visitors.values()].filter(v => v.lead_id === lead.id);

    return {
        kind: 'memory',

        async recordVisit(visitorId, meta) {
            const fresh = !visitors.has(visitorId);
            const v = touch(visitorId);
            v.visits += 1;
            v.is_mobile = meta.isMobile;
            if (fresh) v.source = sourceFromReferrer(meta.referrer);
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
                lead = {
                    id: nextLeadId++, name, phone, interested_plot: plotId, message, status: 'new', notes: null,
                    enquiries: 1, created_at: now(), updated_at: now(), source: visitors.get(visitorId)?.source || 'direct',
                    follow_up: null, is_demo: false,
                };
                leads.push(lead);
            }
            touch(visitorId).lead_id = lead.id;
            events.push({ visitor_id: visitorId, type: 'lead', plot_id: plotId, created_at: now() });
            return { id: lead.id };
        },

        async listLeads() {
            return [...leads].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map(l => {
                const vs = leadVisitors(l);
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

        async leadTimeline(id) {
            const ids = new Set([...visitors.values()].filter(v => v.lead_id === id).map(v => v.id));
            return events.filter(e => ids.has(e.visitor_id))
                .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
                .slice(0, 40)
                .map(({ type, plot_id, detail, created_at }) => ({ type, plot_id, detail: detail ?? null, created_at }));
        },

        async updateLead(id, { status, notes, followUp }) {
            const lead = leads.find(l => l.id === id);
            if (!lead) return false;
            if (status != null) lead.status = status;
            if (notes != null) lead.notes = notes;
            if (followUp !== undefined) lead.follow_up = followUp;
            lead.updated_at = now();
            return true;
        },

        async getStats(days) {
            const { since, prev } = windowBounds(days);
            const inCur = (t) => t >= since;
            const inPrev = (t) => t >= prev && t < since;
            const distinct = (list) => new Set(list.map(e => e.visitor_id)).size;
            const visitEv = events.filter(e => e.type === 'visit');
            const cur = (list) => list.filter(e => inCur(e.created_at));
            const prv = (list) => list.filter(e => inPrev(e.created_at));
            const mobileIds = new Set([...visitors.values()].filter(v => v.is_mobile).map(v => v.id));
            const ev = {
                visitors: distinct(cur(visitEv)), visitors_prev: distinct(prv(visitEv)),
                visits: cur(visitEv).length, visits_prev: prv(visitEv).length,
                views: cur(events.filter(e => e.type === 'plot_view')).length,
                views_prev: prv(events.filter(e => e.type === 'plot_view')).length,
                mobile: distinct(cur(visitEv).filter(e => mobileIds.has(e.visitor_id))),
                mobile_prev: distinct(prv(visitEv).filter(e => mobileIds.has(e.visitor_id))),
                f_viewed: distinct(cur(events.filter(e => e.type === 'plot_view'))),
                f_enquired: distinct(cur(events.filter(e => e.type === 'enquire' || e.type === 'lead'))),
            };
            const ld = {
                leads: leads.filter(l => inCur(l.created_at)).length,
                leads_prev: leads.filter(l => inPrev(l.created_at)).length,
                site_visits: leads.filter(l => PROGRESSED.includes(l.status) && inCur(l.created_at)).length,
                site_visits_prev: leads.filter(l => PROGRESSED.includes(l.status) && inPrev(l.created_at)).length,
                booked: leads.filter(l => l.status === 'booked' && inCur(l.updated_at)).length,
                booked_prev: leads.filter(l => l.status === 'booked' && inPrev(l.updated_at)).length,
                f_booked: leads.filter(l => l.status === 'booked' && inCur(l.created_at)).length,
                leads_all: leads.length,
            };
            const byDay = new Map();
            cur(visitEv).forEach(e => {
                const d = dayIST(e.created_at);
                (byDay.get(d) || byDay.set(d, new Set()).get(d)).add(e.visitor_id);
            });
            const leadDayCounts = {};
            leads.filter(l => inCur(l.created_at)).forEach(l => { const d = dayIST(l.created_at); leadDayCounts[d] = (leadDayCounts[d] || 0) + 1; });
            const dayRows = mergeDayRows(
                [...byDay].map(([day, s]) => ({ day, visitors: s.size })),
                Object.entries(leadDayCounts).map(([day, n]) => ({ day, leads: n })),
            );
            const srcV = {};
            const seenSrc = new Set();
            cur(visitEv).forEach(e => {
                if (seenSrc.has(e.visitor_id)) return;
                seenSrc.add(e.visitor_id);
                const s = visitors.get(e.visitor_id)?.source || 'direct';
                srcV[s] = (srcV[s] || 0) + 1;
            });
            const srcL = {};
            leads.filter(l => inCur(l.created_at)).forEach(l => { const s = l.source || 'direct'; srcL[s] = (srcL[s] || 0) + 1; });
            const heatMap = {};
            cur(events.filter(e => e.plot_id && ['plot_view', 'enquire', 'lead'].includes(e.type))).forEach(e => {
                const h = (heatMap[e.plot_id] ??= { plot: e.plot_id, views: 0, enquiries: 0 });
                if (e.type === 'plot_view') h.views += 1; else h.enquiries += 1;
            });
            const leadById = new Map(leads.map(l => [l.id, l]));
            const activity = events.filter(e => ['plot_view', 'enquire', 'lead'].includes(e.type))
                .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 25)
                .map(e => {
                    const v = visitors.get(e.visitor_id);
                    const l = v?.lead_id ? leadById.get(v.lead_id) : null;
                    return { type: e.type, plot_id: e.plot_id, detail: e.detail ?? null, created_at: e.created_at, is_mobile: v?.is_mobile ?? null, lead_id: l?.id ?? null, lead_name: l?.name ?? null };
                });
            const today = todayIST();
            const horizon = addDays(today, 7);
            const followUps = leads
                .filter(l => l.follow_up && !['booked', 'lost'].includes(l.status) && l.follow_up <= horizon)
                .sort((a, b) => a.follow_up.localeCompare(b.follow_up) || a.id - b.id).slice(0, 80)
                .map(({ id, name, phone, status, interested_plot, follow_up }) => ({ id, name, phone, status, interested_plot, follow_up }));
            return assembleStats({
                days, ev, ld,
                daily: dailySeries(days, dayRows),
                srcVisitors: Object.entries(srcV).map(([source, n]) => ({ source, n })),
                srcLeads: Object.entries(srcL).map(([source, n]) => ({ source, n })),
                heat: Object.values(heatMap),
                activity, followUps,
                hasDemo: [...visitors.values()].some(v => v.is_demo) || leads.some(l => l.is_demo),
            });
        },

        async insertDemo(data) {
            const phoneToId = new Map();
            data.leads.forEach(l => {
                if (leads.some(x => x.phone === l.phone)) return;
                const lead = { ...l, id: nextLeadId++, is_demo: true };
                leads.push(lead);
                phoneToId.set(l.phone, lead.id);
            });
            data.visitors.forEach(v => {
                if (visitors.has(v.id)) return;
                const { lead_phone, ...rest } = v;
                visitors.set(v.id, { ...rest, lead_id: phoneToId.get(lead_phone) ?? null, is_demo: true });
            });
            data.events.forEach(e => events.push({ ...e, is_demo: true }));
        },

        async clearDemo() {
            events = events.filter(e => !e.is_demo);
            visitors = new Map([...visitors].filter(([, v]) => !v.is_demo));
            leads = leads.filter(l => !l.is_demo);
        },
    };
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
