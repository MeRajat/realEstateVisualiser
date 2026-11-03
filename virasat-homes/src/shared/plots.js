// Plot list + status labels/colours shared by the customer site and the admin panel.
import { layout, centroid } from './geo.js';

export const STATUS = {
    available: { label: 'Available', hi: 'उपलब्ध', color: '#1e8e3e' },
    hold: { label: 'On hold', hi: 'होल्ड', color: '#f29900' },
    booked: { label: 'Booked', hi: 'बुक', color: '#e8710a' },
    sold: { label: 'Sold', hi: 'बिक गया', color: '#d93025' },
    blocked: { label: 'Not for sale', hi: 'बिक्री नहीं', color: '#80868b' },
};
export const STATUS_ORDER = ['available', 'hold', 'booked', 'sold', 'blocked'];

export const project = layout.project;
export const plots = layout.plots.map(p => ({ ...p, center: centroid(p.points), status: 'available', pricePerSqYd: null }));
export const plotById = new Map(plots.map(p => [p.id, p]));

export const SIZE_BUCKETS = [
    { id: 's', label: 'Up to 100 sq yd', test: (a) => a <= 100 },
    { id: 'm', label: '100–150', test: (a) => a > 100 && a <= 150 },
    { id: 'l', label: '150–300', test: (a) => a > 150 && a <= 300 },
    { id: 'xl', label: '300+', test: (a) => a > 300 },
];

export const fmtNum = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });

export function fmtMoney(rupees) {
    if (!rupees) return '';
    if (rupees >= 1e7) return '₹' + fmtNum(rupees / 1e7, 2) + ' Cr';
    if (rupees >= 1e5) return '₹' + fmtNum(rupees / 1e5, 2) + ' lakh';
    return '₹' + fmtNum(rupees);
}

export function facingText(p) {
    if (!p.facing?.length) return '—';
    return p.facing.map(f => `${f.dir} · ${f.roadFt} ft road`).join(', ');
}

export function priceOf(p) {
    if (!p.pricePerSqYd) return null;
    return { perSqYd: p.pricePerSqYd, total: Math.round(p.pricePerSqYd * p.areaSqYd) };
}

// Natural sort: 1, 2 … 190, then L1 …, then E1 …
export function plotSort(a, b) {
    const k = (id) => { const m = /^([A-Z]?)(\d+)$/.exec(id) || []; return [{ '': 0, L: 1, E: 2 }[m[1]] ?? 3, Number(m[2]) || 0]; };
    const [x, y] = [k(a.id ?? a), k(b.id ?? b)];
    return x[0] - y[0] || x[1] - y[1];
}

// Accepts "25", "plot 25", "l3", "E 12"
export function findPlot(q) {
    const m = /^\s*(?:plot\s*)?([a-z]?)\s*(\d{1,3})\s*$/i.exec(q || '');
    return m ? plotById.get(m[1].toUpperCase() + m[2]) || null : null;
}
