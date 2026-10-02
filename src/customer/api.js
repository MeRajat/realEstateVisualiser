// Visitor analytics + lead submission. Analytics failures are silent by design.
const VID_KEY = 'gm_vid';

function makeId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}

export const visitorId = (() => {
    try {
        let id = localStorage.getItem(VID_KEY);
        if (!id) { id = makeId(); localStorage.setItem(VID_KEY, id); }
        return id;
    } catch {
        return makeId();
    }
})();

function post(url, body) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
    });
}

export function track(type, extra = {}) {
    post('/api/track', { visitorId, type, ...extra }).catch(() => {});
}

// One "visit" per browser session
export function trackVisit() {
    try {
        if (sessionStorage.getItem('gm_visit')) return;
        sessionStorage.setItem('gm_visit', '1');
    } catch { /* ignore */ }
    track('visit', { referrer: document.referrer || null });
}

let lastViewed = null;
export function trackPlotView(plotId) {
    if (plotId === lastViewed) return;
    lastViewed = plotId;
    track('plot_view', { plotId });
}

// Validation problems (4xx) are shown to the customer. Server/network failures are not their
// problem: never block them from seeing details — log it so the builder can spot a broken backend.
export async function submitLead({ name, phone, plotId, website }) {
    let res;
    try {
        res = await post('/api/lead', { visitorId, name, phone, plotId, website });
    } catch (err) {
        console.error('[lead] network error, lead not saved', err);
        return { ok: false, saved: false };
    }
    const data = await res.json().catch(() => ({}));
    if (res.status >= 500) {
        console.error('[lead] server error, lead not saved', res.status, data.error);
        return { ok: false, saved: false };
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
}
