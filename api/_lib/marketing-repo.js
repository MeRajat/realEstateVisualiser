// Marketing data: campaign attribution (UTM / Meta ads), ad spend the builder types in,
// WhatsApp conversations, and leads that arrive from ads or WhatsApp rather than the website.
// Attached to the main repo in db.js (Postgres + in-memory).

const FORWARD = { new: 0, contacted: 1, site_visit: 2, negotiation: 3, booked: 4, lost: -1 };
const PROGRESSED = ['site_visit', 'negotiation', 'booked'];

export function marketingPg(sql, migrate) {
    const ensure = migrate; // tables/columns are created in db.js migrate

    return {
        async campaignStats(days) {
            await ensure();
            const since = new Date(Date.now() - days * 86400000).toISOString();
            const visitors = await sql`select coalesce(v.source, 'direct') as source, v.utm_campaign as campaign, count(distinct v.id)::int as visitors
                from visitors v join events e on e.visitor_id = v.id and e.type = 'visit'
                where e.created_at >= ${since}::timestamptz group by 1, 2`;
            const leads = await sql`select coalesce(source, 'direct') as source, campaign,
                    count(*)::int as leads,
                    count(*) filter (where status = any(${PROGRESSED}))::int as site_visits,
                    count(*) filter (where status = 'booked')::int as booked
                from leads where created_at >= ${since}::timestamptz group by 1, 2`;
            return mergeCampaigns(visitors, leads);
        },
        async listSpend(days) {
            await ensure();
            const since = new Date(Date.now() - (days + 7) * 86400000).toISOString().slice(0, 10);
            const rows = await sql`select id, source, campaign, week::text as week, amount from ad_spend where week >= ${since}::date order by week desc, id desc`;
            return rows.map(r => ({ ...r, id: Number(r.id), amount: Number(r.amount) }));
        },
        async addSpend({ source, campaign, week, amount }) {
            await ensure();
            const [r] = await sql`insert into ad_spend (source, campaign, week, amount) values (${source}, ${campaign}, ${week}::date, ${amount}) returning id`;
            return { id: Number(r.id) };
        },
        async deleteSpend(id) {
            await ensure();
            const rows = await sql`delete from ad_spend where id = ${id} returning id`;
            return rows.length > 0;
        },

        async addWaMessage({ phone, direction, text, kind = 'text' }) {
            await ensure();
            const [r] = await sql`insert into wa_messages (phone, direction, text, kind) values (${phone}, ${direction}, ${text}, ${kind}) returning id, created_at`;
            return { id: Number(r.id), created_at: r.created_at };
        },
        async waThread(phone, limit = 40) {
            await ensure();
            const rows = await sql`select id, direction, text, kind, created_at from wa_messages where phone = ${phone} order by created_at desc limit ${limit}`;
            return rows.reverse().map(r => ({ ...r, id: Number(r.id) }));
        },
        async waThreads(limit = 30) {
            await ensure();
            return sql`select m.phone, m.text as last_text, m.direction as last_direction, m.created_at as last_at, l.id as lead_id, l.name, l.status
                from (select distinct on (phone) phone, text, direction, created_at from wa_messages order by phone, created_at desc) m
                left join leads l on l.phone = m.phone
                order by m.created_at desc limit ${limit}`
                .then(rows => rows.map(r => ({ ...r, lead_id: r.lead_id == null ? null : Number(r.lead_id) })));
        },

        // Lead from a Meta lead form or a first WhatsApp message. Never moves a lead backwards.
        async upsertInboundLead({ name, phone, source, campaign, adId, email, message, status = 'new', aiSummary, followUp }) {
            await ensure();
            const [lead] = await sql`insert into leads (name, phone, source, campaign, ad_id, email, message, status, ai_summary, follow_up)
                values (${name || 'Customer'}, ${phone}, ${source}, ${campaign || null}, ${adId || null}, ${email || null}, ${message || null}, ${status}, ${aiSummary || null}, ${followUp || null})
                on conflict (phone) do update set
                    name = case when leads.name = 'Customer' and excluded.name <> 'Customer' then excluded.name else leads.name end,
                    campaign = coalesce(leads.campaign, excluded.campaign),
                    ad_id = coalesce(leads.ad_id, excluded.ad_id),
                    email = coalesce(leads.email, excluded.email),
                    message = coalesce(excluded.message, leads.message),
                    ai_summary = coalesce(excluded.ai_summary, leads.ai_summary),
                    follow_up = coalesce(excluded.follow_up, leads.follow_up),
                    status = case when leads.status = 'lost' then excluded.status
                                  when ${FORWARD[status]} > (case leads.status when 'new' then 0 when 'contacted' then 1 when 'site_visit' then 2 when 'negotiation' then 3 else 4 end) then excluded.status
                                  else leads.status end,
                    enquiries = leads.enquiries + 1,
                    updated_at = now()
                returning id, name, status, interested_plot, notes, ai_summary, (xmax = 0) as created`;
            return { ...lead, id: Number(lead.id), created: !!lead.created };
        },
    };
}

export function marketingMemory(store) {
    const spend = [];
    const wa = [];
    let nextSpend = 1, nextWa = 1;
    const now = () => new Date().toISOString();

    return {
        async campaignStats(days) {
            const since = new Date(Date.now() - days * 86400000).toISOString();
            const { visitors, events, leads } = store();
            const vis = {};
            const seen = new Set();
            events.filter(e => e.type === 'visit' && e.created_at >= since).forEach(e => {
                if (seen.has(e.visitor_id)) return;
                seen.add(e.visitor_id);
                const v = visitors.get(e.visitor_id);
                const key = `${v?.source || 'direct'}|${v?.utm_campaign || ''}`;
                (vis[key] ??= { source: v?.source || 'direct', campaign: v?.utm_campaign || null, visitors: 0 }).visitors += 1;
            });
            const ld = {};
            leads.filter(l => l.created_at >= since).forEach(l => {
                const key = `${l.source || 'direct'}|${l.campaign || ''}`;
                const r = (ld[key] ??= { source: l.source || 'direct', campaign: l.campaign || null, leads: 0, site_visits: 0, booked: 0 });
                r.leads += 1;
                if (PROGRESSED.includes(l.status)) r.site_visits += 1;
                if (l.status === 'booked') r.booked += 1;
            });
            return mergeCampaigns(Object.values(vis), Object.values(ld));
        },
        async listSpend(days) {
            const since = new Date(Date.now() - (days + 7) * 86400000).toISOString().slice(0, 10);
            return spend.filter(s => s.week >= since).sort((a, b) => b.week.localeCompare(a.week) || b.id - a.id).map(s => ({ ...s }));
        },
        async addSpend({ source, campaign, week, amount }) {
            const row = { id: nextSpend++, source, campaign, week, amount };
            spend.push(row);
            return { id: row.id };
        },
        async deleteSpend(id) {
            const i = spend.findIndex(s => s.id === id);
            if (i < 0) return false;
            spend.splice(i, 1);
            return true;
        },
        async addWaMessage({ phone, direction, text, kind = 'text' }) {
            const row = { id: nextWa++, phone, direction, text, kind, created_at: now() };
            wa.push(row);
            return { id: row.id, created_at: row.created_at };
        },
        async waThread(phone, limit = 40) {
            return wa.filter(m => m.phone === phone).slice(-limit).map(({ id, direction, text, kind, created_at }) => ({ id, direction, text, kind, created_at }));
        },
        async waThreads(limit = 30) {
            const { leads } = store();
            const last = new Map();
            wa.forEach(m => last.set(m.phone, m));
            return [...last.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit).map(m => {
                const l = leads.find(x => x.phone === m.phone);
                return { phone: m.phone, last_text: m.text, last_direction: m.direction, last_at: m.created_at, lead_id: l?.id ?? null, name: l?.name ?? null, status: l?.status ?? null };
            });
        },
        async upsertInboundLead({ name, phone, source, campaign, adId, email, message, status = 'new', aiSummary, followUp }) {
            const { leads, nextLeadId } = store();
            let lead = leads.find(l => l.phone === phone);
            if (lead) {
                if (lead.name === 'Customer' && name && name !== 'Customer') lead.name = name;
                lead.campaign ??= campaign || null;
                lead.ad_id ??= adId || null;
                lead.email ??= email || null;
                if (message) lead.message = message;
                if (aiSummary) lead.ai_summary = aiSummary;
                if (followUp) lead.follow_up = followUp;
                if (lead.status === 'lost' || FORWARD[status] > FORWARD[lead.status]) lead.status = status;
                lead.enquiries += 1;
                lead.updated_at = now();
            } else {
                lead = { id: nextLeadId(), name: name || 'Customer', phone, interested_plot: null, message: message || null, status, notes: null,
                    enquiries: 1, created_at: now(), updated_at: now(), source, campaign: campaign || null, ad_id: adId || null, email: email || null,
                    ai_summary: aiSummary || null, follow_up: followUp || null, is_demo: false, cp: null };
                leads.push(lead);
            }
            return { id: lead.id, name: lead.name, status: lead.status, interested_plot: lead.interested_plot, notes: lead.notes, ai_summary: lead.ai_summary, created: lead.enquiries === 1 };
        },
    };
}

function mergeCampaigns(visitors, leads) {
    const key = (r) => `${r.source}|${r.campaign || ''}`;
    const out = new Map();
    visitors.forEach(r => { out.set(key(r), { source: r.source, campaign: r.campaign || null, visitors: r.visitors, leads: 0, site_visits: 0, booked: 0 }); });
    leads.forEach(r => {
        const k = key(r);
        const row = out.get(k) || { source: r.source, campaign: r.campaign || null, visitors: 0, leads: 0, site_visits: 0, booked: 0 };
        Object.assign(row, { leads: r.leads, site_visits: r.site_visits, booked: r.booked });
        out.set(k, row);
    });
    return [...out.values()].sort((a, b) => b.leads - a.leads || b.visitors - a.visitors);
}
