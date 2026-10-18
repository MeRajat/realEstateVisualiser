// Inventory (stock) rules shared by the inventory APIs: unit statuses, holds, demand scoring,
// and a no-AI fallback for "ask your stock" so the dashboard works without an API key.

export const UNIT_STATUSES = ['available', 'hold', 'booked', 'sold', 'blocked'];
export const HOLD_HOURS_MAX = 24 * 30;
export const DEFAULT_HOLD_HOURS = 48;

// A hold that has run out is treated as available everywhere, even before the row is cleaned up
export function effectiveStatus(unit, now = Date.now()) {
    if (unit.status === 'hold' && unit.hold_until && Date.parse(unit.hold_until) <= now) return 'available';
    return unit.status;
}

export const holdExpired = (unit, now = Date.now()) => unit.status === 'hold' && effectiveStatus(unit, now) === 'available';

// Demand tier from recent activity: "hot" when several different people looked/asked recently
export function demandTier({ views = 0, enquiries = 0, people = 0 } = {}) {
    const score = views + enquiries * 4 + people * 2;
    if (enquiries >= 2 || people >= 5 || score >= 18) return 'hot';
    if (score >= 7) return 'warm';
    return 'normal';
}

// ─── Rule-based "ask" (fallback when ANTHROPIC_API_KEY is not set) ───
// Understands the handful of things builders actually ask: status, facing, zone, budget, size, corner.
const FACINGS = { east: 'East', west: 'West', north: 'North', south: 'South', purab: 'East', paschim: 'West', uttar: 'North', dakshin: 'South' };

export function parseAsk(question) {
    const q = String(question || '').toLowerCase();
    const want = {};
    for (const [word, dir] of Object.entries(FACINGS)) if (new RegExp(`\\b${word}\\b`).test(q)) (want.facing ??= []).push(dir);
    const zone = q.match(/\bzone\s*([a-d])\b/);
    if (zone) want.zone = zone[1].toUpperCase();
    if (/\bcorner\b/.test(q)) want.corner = true;
    if (/\b(hold|rok|roka|reserved)\b/.test(q)) want.status = 'hold';
    else if (/\b(booked|book)\b/.test(q)) want.status = 'booked';
    else if (/\b(sold|bik|bika|bech)\b/.test(q)) want.status = 'sold';
    else if (/\b(available|free|khali|bacha|bache|left|remaining)\b/.test(q)) want.status = 'available';
    const money = q.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|l\b|lakhs)/);
    if (money) {
        const n = parseFloat(money[1]);
        if (/\b(under|below|less|upto|up to|max|se kam|tak|within)\b/.test(q)) want.maxPrice = n;
        else if (/\b(above|over|more|se zyada|se jyada|min)\b/.test(q)) want.minPrice = n;
        else want.maxPrice = n;
    }
    const sqft = q.match(/(\d{3,5})\s*(sq|sqft|sq\.?\s*ft|square)/);
    if (sqft) {
        const n = parseInt(sqft[1], 10);
        if (/\b(above|over|more|bigger|larger|se bada)\b/.test(q)) want.minArea = n; else want.maxArea = n;
    }
    const gaj = q.match(/(\d{2,4})\s*(gaj|gaz|yard|yards)/);
    if (gaj) {
        const n = parseInt(gaj[1], 10) * 9;
        if (/\b(above|over|more|bigger|larger|se bada)\b/.test(q)) want.minArea = n; else want.maxArea = n;
    }
    if (/\b(hot|popular|demand|most viewed|pasand|interest)\b/.test(q)) want.hot = true;
    if (/\b(no price|without price|price not set|bina price)\b/.test(q)) want.noPrice = true;
    return want;
}

// units: [{ id, status, facing: [...], zone, corner, priceLakh, areaSqFt, demand }]
export function filterUnits(units, want) {
    return units.filter(u => {
        if (want.status && u.status !== want.status) return false;
        if (want.facing && !want.facing.some(f => (u.facing || []).includes(f))) return false;
        if (want.zone && u.zone !== want.zone) return false;
        if (want.corner && !u.corner) return false;
        if (want.maxPrice != null && !(u.priceLakh && u.priceLakh <= want.maxPrice)) return false;
        if (want.minPrice != null && !(u.priceLakh && u.priceLakh >= want.minPrice)) return false;
        if (want.maxArea != null && !(u.areaSqFt && u.areaSqFt <= want.maxArea)) return false;
        if (want.minArea != null && !(u.areaSqFt && u.areaSqFt >= want.minArea)) return false;
        if (want.hot && u.demand !== 'hot') return false;
        if (want.noPrice && u.priceLakh) return false;
        return true;
    });
}

export function describeAsk(want, matches, lang = 'en') {
    const parts = [];
    if (want.status) parts.push(want.status === 'hold' ? 'on hold' : want.status);
    if (want.facing) parts.push(`${want.facing.join('/')}-facing`);
    if (want.zone) parts.push(`Zone ${want.zone}`);
    if (want.corner) parts.push('corner');
    if (want.maxPrice != null) parts.push(`under ₹${want.maxPrice} lakh`);
    if (want.minPrice != null) parts.push(`above ₹${want.minPrice} lakh`);
    if (want.maxArea != null) parts.push(`up to ${want.maxArea} sq.ft`);
    if (want.minArea != null) parts.push(`${want.minArea}+ sq.ft`);
    if (want.hot) parts.push('in high demand');
    if (want.noPrice) parts.push('without a price');
    const what = parts.length ? parts.join(', ') : 'matching';
    if (lang === 'hi') return matches.length ? `${matches.length} ${what} प्लॉट मिले।` : `कोई ${what} प्लॉट नहीं मिला।`;
    return matches.length ? `${matches.length} ${what} plot${matches.length === 1 ? '' : 's'} found.` : `No ${what} plots found.`;
}
