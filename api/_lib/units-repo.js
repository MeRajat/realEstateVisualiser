// Unit (plot / flat) stock: status overrides on top of the static plan data, holds with expiry,
// a change log, and demand counts from visitor events. Attached to the main repo in db.js.
import { UNIT_STATUSES, holdExpired } from './inventory.js';

const PUBLIC_FIELDS = (u) => ({
    id: u.id, status: u.status, hold_until: u.hold_until || null, price_lakh: u.price_lakh == null ? null : Number(u.price_lakh),
});

// ─── POSTGRES ────────────────────────────────────────
export function unitsPg(sql, migrate) {
    let ready;
    const ensure = () => (ready ??= (async () => {
        await migrate();
        await sql`create table if not exists units (
            id text primary key,
            status text not null default 'available',
            price_lakh numeric,
            hold_until timestamptz,
            customer_name text,
            customer_phone text,
            broker text,
            note text,
            updated_by text,
            version int not null default 1,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        )`;
        await sql`create table if not exists unit_history (
            id bigserial primary key,
            unit_id text not null,
            from_status text,
            to_status text not null,
            price_lakh numeric,
            customer_name text,
            note text,
            actor text,
            created_at timestamptz not null default now()
        )`;
        await sql`create index if not exists unit_history_unit_idx on unit_history (unit_id, created_at desc)`;
    })().catch(e => { ready = null; throw e; }));

    // Holds that ran out become available again (logged, so the builder can see it happened)
    async function releaseExpired() {
        const rows = await sql`update units set status = 'available', hold_until = null, customer_name = null, customer_phone = null,
                version = version + 1, updated_at = now(), updated_by = 'auto'
            where status = 'hold' and hold_until is not null and hold_until <= now() returning id`;
        for (const r of rows) {
            await sql`insert into unit_history (unit_id, from_status, to_status, note, actor) values (${r.id}, 'hold', 'available', 'Hold time over', 'auto')`;
        }
    }

    const norm = (u) => ({ ...u, price_lakh: u.price_lakh == null ? null : Number(u.price_lakh), version: Number(u.version) });

    return {
        async listUnits() {
            await ensure();
            await releaseExpired();
            const rows = await sql`select * from units order by id`;
            return rows.map(norm);
        },

        async publicUnits() {
            await ensure();
            await releaseExpired();
            const rows = await sql`select id, status, hold_until, price_lakh from units where status <> 'available' or price_lakh is not null order by id`;
            return rows.map(PUBLIC_FIELDS);
        },

        async getUnit(id) {
            await ensure();
            const [u] = await sql`select * from units where id = ${id}`;
            return u ? norm(u) : null;
        },

        // Returns { unit } or { conflict: true } when someone else saved in between
        async updateUnit(id, patch, { actor = null, expectedVersion = null } = {}) {
            await ensure();
            const before = await this.getUnit(id);
            if (before && expectedVersion != null && before.version !== expectedVersion) return { conflict: true, unit: before };
            const status = patch.status ?? before?.status ?? 'available';
            if (!UNIT_STATUSES.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
            const keep = status === 'hold' || status === 'booked' || status === 'sold';
            const row = {
                price_lakh: patch.priceLakh !== undefined ? patch.priceLakh : before?.price_lakh ?? null,
                hold_until: status === 'hold' ? (patch.holdUntil ?? before?.hold_until ?? null) : null,
                customer_name: keep ? (patch.customerName !== undefined ? patch.customerName : before?.customer_name ?? null) : null,
                customer_phone: keep ? (patch.customerPhone !== undefined ? patch.customerPhone : before?.customer_phone ?? null) : null,
                broker: keep ? (patch.broker !== undefined ? patch.broker : before?.broker ?? null) : null,
                note: patch.note !== undefined ? patch.note : before?.note ?? null,
            };
            const [unit] = await sql`insert into units (id, status, price_lakh, hold_until, customer_name, customer_phone, broker, note, updated_by)
                values (${id}, ${status}, ${row.price_lakh}, ${row.hold_until}, ${row.customer_name}, ${row.customer_phone}, ${row.broker}, ${row.note}, ${actor})
                on conflict (id) do update set status = excluded.status, price_lakh = excluded.price_lakh, hold_until = excluded.hold_until,
                    customer_name = excluded.customer_name, customer_phone = excluded.customer_phone, broker = excluded.broker,
                    note = excluded.note, updated_by = excluded.updated_by, version = units.version + 1, updated_at = now()
                returning *`;
            const fromStatus = before ? (holdExpired(before) ? 'available' : before.status) : null;
            const priceChanged = (before?.price_lakh ?? null) !== (row.price_lakh ?? null);
            if (fromStatus !== status || priceChanged || patch.note) {
                await sql`insert into unit_history (unit_id, from_status, to_status, price_lakh, customer_name, note, actor)
                    values (${id}, ${fromStatus}, ${status}, ${row.price_lakh}, ${row.customer_name}, ${patch.note ?? null}, ${actor})`;
            }
            return { unit: norm(unit) };
        },

        async unitHistory(id) {
            await ensure();
            const rows = await sql`select from_status, to_status, price_lakh, customer_name, note, actor, created_at
                from unit_history where unit_id = ${id} order by created_at desc limit 50`;
            return rows.map(r => ({ ...r, price_lakh: r.price_lakh == null ? null : Number(r.price_lakh) }));
        },

        // Activity per unit in the last N days: distinct people, looks, enquiries, holds
        async unitDemand(days) {
            await ensure();
            const since = new Date(Date.now() - days * 86400000).toISOString();
            const ev = await sql`select plot_id as id,
                    count(*) filter (where type = 'plot_view')::int as views,
                    count(*) filter (where type in ('enquire', 'lead'))::int as enquiries,
                    count(distinct visitor_id)::int as people
                from events where plot_id is not null and type in ('plot_view', 'enquire', 'lead') and created_at >= ${since}::timestamptz
                group by plot_id`;
            const holds = await sql`select unit_id as id, count(*)::int as holds from unit_history
                where to_status in ('hold', 'booked') and created_at >= ${since}::timestamptz group by unit_id`;
            const out = {};
            ev.forEach(r => { out[r.id] = { views: r.views, enquiries: r.enquiries, people: r.people, holds: 0 }; });
            holds.forEach(r => { (out[r.id] ??= { views: 0, enquiries: 0, people: 0, holds: 0 }).holds = r.holds; });
            return out;
        },

        async recentUnitChanges(limit = 20) {
            await ensure();
            return sql`select unit_id, from_status, to_status, price_lakh, customer_name, actor, created_at
                from unit_history order by created_at desc limit ${limit}`;
        },
    };
}

// ─── IN-MEMORY (local dev / tests) ───────────────────
export function unitsMemory() {
    const units = new Map();
    const history = [];
    const now = () => new Date().toISOString();

    function releaseExpired() {
        for (const u of units.values()) {
            if (holdExpired(u)) {
                Object.assign(u, { status: 'available', hold_until: null, customer_name: null, customer_phone: null, version: u.version + 1, updated_at: now(), updated_by: 'auto' });
                history.push({ unit_id: u.id, from_status: 'hold', to_status: 'available', price_lakh: u.price_lakh, customer_name: null, note: 'Hold time over', actor: 'auto', created_at: now() });
            }
        }
    }

    return {
        _events: null, // set by db.js so demand can read visitor events

        async listUnits() { releaseExpired(); return [...units.values()].sort((a, b) => a.id.localeCompare(b.id)).map(u => ({ ...u })); },
        async publicUnits() {
            releaseExpired();
            return [...units.values()].filter(u => u.status !== 'available' || u.price_lakh != null).sort((a, b) => a.id.localeCompare(b.id)).map(PUBLIC_FIELDS);
        },
        async getUnit(id) { const u = units.get(id); return u ? { ...u } : null; },

        async updateUnit(id, patch, { actor = null, expectedVersion = null } = {}) {
            const before = units.get(id) || null;
            if (before && expectedVersion != null && before.version !== expectedVersion) return { conflict: true, unit: { ...before } };
            const status = patch.status ?? before?.status ?? 'available';
            if (!UNIT_STATUSES.includes(status)) throw Object.assign(new Error('Invalid status'), { status: 400 });
            const keep = status === 'hold' || status === 'booked' || status === 'sold';
            const fromStatus = before ? (holdExpired(before) ? 'available' : before.status) : null;
            const unit = {
                id, status,
                price_lakh: patch.priceLakh !== undefined ? patch.priceLakh : before?.price_lakh ?? null,
                hold_until: status === 'hold' ? (patch.holdUntil ?? before?.hold_until ?? null) : null,
                customer_name: keep ? (patch.customerName !== undefined ? patch.customerName : before?.customer_name ?? null) : null,
                customer_phone: keep ? (patch.customerPhone !== undefined ? patch.customerPhone : before?.customer_phone ?? null) : null,
                broker: keep ? (patch.broker !== undefined ? patch.broker : before?.broker ?? null) : null,
                note: patch.note !== undefined ? patch.note : before?.note ?? null,
                updated_by: actor, version: (before?.version || 0) + 1,
                created_at: before?.created_at || now(), updated_at: now(),
            };
            units.set(id, unit);
            const priceChanged = (before?.price_lakh ?? null) !== (unit.price_lakh ?? null);
            if (fromStatus !== status || priceChanged || patch.note) {
                history.push({ unit_id: id, from_status: fromStatus, to_status: status, price_lakh: unit.price_lakh, customer_name: unit.customer_name, note: patch.note ?? null, actor, created_at: now() });
            }
            return { unit: { ...unit } };
        },

        async unitHistory(id) {
            return history.filter(h => h.unit_id === id).slice().reverse().slice(0, 50)
                .map(({ from_status, to_status, price_lakh, customer_name, note, actor, created_at }) => ({ from_status, to_status, price_lakh, customer_name, note, actor, created_at }));
        },

        async unitDemand(days) {
            const since = new Date(Date.now() - days * 86400000).toISOString();
            const out = {};
            const people = {};
            for (const e of (this._events?.() || [])) {
                if (!e.plot_id || e.created_at < since || !['plot_view', 'enquire', 'lead'].includes(e.type)) continue;
                const d = (out[e.plot_id] ??= { views: 0, enquiries: 0, people: 0, holds: 0 });
                if (e.type === 'plot_view') d.views += 1; else d.enquiries += 1;
                (people[e.plot_id] ??= new Set()).add(e.visitor_id);
            }
            Object.entries(people).forEach(([id, s]) => { out[id].people = s.size; });
            history.filter(h => ['hold', 'booked'].includes(h.to_status) && h.created_at >= since)
                .forEach(h => { (out[h.unit_id] ??= { views: 0, enquiries: 0, people: 0, holds: 0 }).holds += 1; });
            return out;
        },

        async recentUnitChanges(limit = 20) {
            return history.slice().reverse().slice(0, limit)
                .map(({ unit_id, from_status, to_status, price_lakh, customer_name, actor, created_at }) => ({ unit_id, from_status, to_status, price_lakh, customer_name, actor, created_at }));
        },
    };
}
