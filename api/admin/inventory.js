// Builder stock management.
// GET ?days=7            → every unit override + demand per unit + recent changes
// GET ?id=45             → change history of one unit
// PATCH { id, version?, status?, priceLakh?, holdHours?, customerName?, customerPhone?, broker?, note? }
// POST { rows: [{ id, status?, priceLakh?, note? }] } → bulk update (Excel / CSV upload)
import { getRepo } from '../_lib/db.js';
import { route, send, readJson, badRequest, cleanText, normalisePhone, PLOT_ID } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { UNIT_STATUSES, HOLD_HOURS_MAX, DEFAULT_HOLD_HOURS, demandTier } from '../_lib/inventory.js';

const LEAD_STAGE = { hold: 'negotiation', booked: 'booked', sold: 'booked' };

function parsePrice(v) {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const cleaned = String(v).replace(/[^\d.]/g, '');
    const n = Number(cleaned);
    if (!cleaned || !Number.isFinite(n) || n < 0 || n > 100000) throw badRequest('Price should be in lakhs, e.g. 42.5');
    return Math.round(n * 100) / 100;
}

function parseStatus(v) {
    if (v === undefined) return undefined;
    const s = String(v).trim().toLowerCase().replace(/\s+/g, '_');
    const alias = { on_hold: 'hold', held: 'hold', reserved: 'blocked', not_for_sale: 'blocked', block: 'blocked', book: 'booked', free: 'available', open: 'available' };
    const status = alias[s] || s;
    if (!UNIT_STATUSES.includes(status)) throw badRequest(`Unknown status "${v}"`);
    return status;
}

export default route(['GET', 'PATCH', 'POST'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();

    if (req.method === 'GET') {
        const url = new URL(req.url, 'http://x');
        const id = url.searchParams.get('id');
        if (id) {
            if (!PLOT_ID.test(id)) throw badRequest('Invalid unit id');
            return send(res, 200, { history: await repo.unitHistory(id) });
        }
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
        const [units, demand, changes] = await Promise.all([repo.listUnits(), repo.unitDemand(days), repo.recentUnitChanges(20)]);
        Object.values(demand).forEach(d => { d.tier = demandTier(d); });
        return send(res, 200, { units, demand, changes, days });
    }

    const body = await readJson(req);

    if (req.method === 'POST') {
        const rows = Array.isArray(body.rows) ? body.rows.slice(0, 2000) : null;
        if (!rows) throw badRequest('No rows');
        let updated = 0;
        const errors = [];
        for (const r of rows) {
            const id = String(r.id ?? '').trim();
            if (!PLOT_ID.test(id)) { errors.push(`Row with id "${id}" skipped`); continue; }
            try {
                const patch = { status: parseStatus(r.status), priceLakh: parsePrice(r.priceLakh), note: r.note !== undefined ? cleanText(r.note, 300) : undefined };
                if (patch.status === 'hold') patch.holdUntil = new Date(Date.now() + DEFAULT_HOLD_HOURS * 3600000).toISOString();
                const existing = await repo.getUnit(id);
                const same = existing && (patch.status === undefined || existing.status === patch.status)
                    && (patch.priceLakh === undefined || existing.price_lakh === patch.priceLakh) && patch.note === undefined;
                if (!existing && patch.status === undefined && patch.priceLakh === undefined) continue; // nothing to store
                if (same) continue;
                await repo.updateUnit(id, patch, { actor: 'excel' });
                updated += 1;
            } catch (e) { errors.push(`${id}: ${e.message}`); }
        }
        return send(res, 200, { updated, errors: errors.slice(0, 20) });
    }

    // PATCH
    const id = String(body.id ?? '').trim();
    if (!PLOT_ID.test(id)) throw badRequest('Invalid unit id');
    const status = parseStatus(body.status);
    const patch = {
        status,
        priceLakh: parsePrice(body.priceLakh),
        note: body.note !== undefined ? cleanText(body.note, 300) : undefined,
        customerName: body.customerName !== undefined ? cleanText(body.customerName, 60) : undefined,
        broker: body.broker !== undefined ? cleanText(body.broker, 60) : undefined,
    };
    if (body.customerPhone !== undefined) {
        const phone = body.customerPhone ? normalisePhone(body.customerPhone) : null;
        if (body.customerPhone && !phone) throw badRequest('Please enter a valid 10-digit mobile number');
        patch.customerPhone = phone;
    }
    if (status === 'hold') {
        const hours = Math.min(HOLD_HOURS_MAX, Math.max(1, Number(body.holdHours) || DEFAULT_HOLD_HOURS));
        patch.holdUntil = new Date(Date.now() + hours * 3600000).toISOString();
    }
    const expectedVersion = body.version != null ? Number(body.version) : null;
    const result = await repo.updateUnit(id, patch, { actor: cleanText(body.actor, 40) || 'builder', expectedVersion });
    if (result.conflict) return send(res, 409, { error: 'This plot was just changed by someone else. Please check and try again.', unit: result.unit });

    // Booking a known customer moves them along in the leads list; a new walk-in gets a lead card
    const u = result.unit;
    if (LEAD_STAGE[u.status] && u.customer_phone) {
        try {
            await repo.upsertOfflineLead({ name: u.customer_name, phone: u.customer_phone, plotId: id, status: LEAD_STAGE[u.status], notes: u.note });
        } catch (e) { console.error('[inventory] lead link failed', e); }
    }
    send(res, 200, { unit: u });
});
