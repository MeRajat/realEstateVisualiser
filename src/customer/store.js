// Central app state shared by all views + a tiny event bus.
import { plotById, plots, stats } from '../shared/site.js';
import { SERVER_TO_TOKEN, tokenFromPlan } from '../shared/status.js';

const LEAD_KEY = 'gm_lead';

function loadLead() {
    try { return JSON.parse(localStorage.getItem(LEAD_KEY)) || null; } catch { return null; }
}

export const SIZE_BUCKETS = [
    { id: 'sm', label: 'Under 1,900 sq.ft', test: a => a < 1900 },
    { id: 'md', label: '1,900 – 2,000 sq.ft', test: a => a >= 1900 && a <= 2000 },
    { id: 'lg', label: 'Above 2,000 sq.ft', test: a => a > 2000 },
];

export const DEFAULT_FILTER = { status: 'all', zone: 'all', size: 'all', facing: 'all' };

export const state = {
    view: 'plan',
    selectedId: null,
    filter: { ...DEFAULT_FILTER },
    lead: loadLead(),
};

const listeners = new Map();
export function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
}
function emit(event, payload) {
    listeners.get(event)?.forEach(fn => fn(payload));
}

// source lets the originating view skip re-centering on its own tap
export function selectPlot(id, source = 'ui') {
    const plot = id ? plotById.get(id) : null;
    state.selectedId = plot ? plot.id : null;
    emit('select', { plot, source });
}

export function setFilter(filter) {
    state.filter = { ...DEFAULT_FILTER, ...filter };
    emit('filter', state.filter);
}

export function activeFilterCount() {
    return Object.keys(DEFAULT_FILTER).filter(k => state.filter[k] !== DEFAULT_FILTER[k]).length;
}

export function matchesFilter(plot, f = state.filter) {
    if (f.status === 'Sold' ? !['Sold', 'Booked', 'Reserved'].includes(plot.status) : f.status !== 'all' && plot.status !== f.status) return false;
    if (f.zone !== 'all' && plot.zone !== f.zone) return false;
    if (f.size !== 'all' && !SIZE_BUCKETS.find(b => b.id === f.size).test(plot.areaSqFt)) return false;
    if (f.facing !== 'all' && !plot.facing.some(x => x.dir === f.facing)) return false;
    return true;
}

export function setLead(lead) {
    state.lead = lead;
    try { localStorage.setItem(LEAD_KEY, JSON.stringify(lead)); } catch { /* private mode */ }
    emit('lead', lead);
}

// Live stock from /api/inventory: overrides the static plan statuses and marks in-demand plots
export function applyInventory({ units = [], hot = [] } = {}) {
    const byId = new Map(units.map(u => [String(u.id), u]));
    const hotById = new Map(hot.map(h => [String(h.id), h]));
    plots.forEach(p => {
        const u = byId.get(p.id);
        p.status = u ? SERVER_TO_TOKEN[u.status] || 'Available' : tokenFromPlan(p.planStatus ?? (p.planStatus = p.status));
        p.holdUntil = u?.hold_until || null;
        if (u && u.price_lakh != null) {
            p.priceLakh = u.price_lakh;
            p.price = `₹${u.price_lakh} Lakh`;
        }
        p.hot = hotById.get(p.id) || null;
    });
    stats.available = plots.filter(p => p.status === 'Available').length;
    stats.sold = plots.filter(p => p.status === 'Sold' || p.status === 'Booked').length;
    stats.hold = plots.filter(p => p.status === 'Hold').length;
    state.inventoryAt = Date.now();
    emit('inventory', { units, hot });
    emit('filter', state.filter);
}

export function setView(view) {
    state.view = view;
    emit('view', view);
}
