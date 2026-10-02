// POST { plots: [[id, weight], …] } → replace demo data (fake leads, visitors, events for the last
// 60 days); DELETE → remove all demo rows. Real leads and visits are never touched.
// The dashboard sends plot ids + desirability weights (it already has the plan data).
import { getRepo, todayIST } from '../_lib/db.js';
import { route, send, readJson, badRequest, PLOT_ID } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';

const DAY_MS = 86400000;
const IST_OFFSET_MS = 5.5 * 3600000;

// Clearly fictional people: generated names, numbers in the reserved-looking 99999 0xxxx range
const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Rohan', 'Karan', 'Arjun', 'Rahul', 'Vikram', 'Sanjay', 'Amit', 'Manish', 'Deepak',
    'Nitin', 'Pankaj', 'Rajesh', 'Suresh', 'Mahesh', 'Gaurav', 'Ankit', 'Harsh', 'Priya', 'Ananya', 'Neha', 'Pooja', 'Kavya',
    'Ritu', 'Sneha', 'Divya', 'Meera', 'Shalini', 'Anjali', 'Nisha', 'Swati', 'Komal', 'Isha', 'Tanvi', 'Bhavna', 'Sunita', 'Rekha', 'Payal'];
const LAST = ['Sharma', 'Agarwal', 'Gupta', 'Jain', 'Meena', 'Choudhary', 'Rathore', 'Shekhawat', 'Singh', 'Khandelwal',
    'Mathur', 'Saini', 'Joshi', 'Verma', 'Yadav', 'Goyal', 'Mittal', 'Bansal', 'Purohit', 'Vyas'];

const SOURCES = [['google', 30], ['instagram', 18], ['whatsapp', 16], ['direct', 14], ['facebook', 10], ['99acres', 7], ['magicbricks', 5]];
const REFERRER = {
    google: 'https://www.google.com/', instagram: 'https://l.instagram.com/', facebook: 'https://m.facebook.com/',
    '99acres': 'https://www.99acres.com/', magicbricks: 'https://www.magicbricks.com/', whatsapp: null, direct: null,
};

const NOTES = {
    new: ['Enquired on the website — call pending', 'Asked for brochure on WhatsApp', 'Wants price list for corner plots', null],
    contacted: ['Wants east-facing ~200 gaj, budget 45L', 'Interested in a corner plot, call back after 6 pm',
        'Comparing with a Vatika Road project', 'Asked about home-loan options (SBI / HDFC)', 'Prefers north-facing, near the park'],
    site_visit: ['Site visit Sunday 11 am with family', 'Visited site — liked Zone A, wants a second visit',
        'Coming Saturday with father', 'Visited; shortlisted {plot} and one more'],
    negotiation: ['Negotiating ₹1.5L discount on {plot}', 'Ready to book if PLC is waived', 'Token amount discussion — ₹2L',
        'Wants 3-instalment payment plan for {plot}'],
    booked: ['Booked {plot} — token ₹2L received', 'Booking done for {plot}, agreement next week'],
    lost: ['Budget mismatch — looking under ₹35L', 'Bought elsewhere', 'Not responding after 3 calls', 'Wants a ready house, not a plot'],
};
const MESSAGES = [null, null, null, 'Please share the payment plan', 'Is bank loan available?', 'Call me in the evening please', 'Is the plot JDA approved?'];

const ACTIVE_STATUSES = ['new', 'contacted', 'site_visit', 'negotiation'];

// Apartment ids from the sample society (tower-floor-unit, e.g. A-1203)
const TOWERS = [['A', 14], ['B', 12], ['C', 16]];

function mulberry32(seed) {
    return () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function generateDemo({ plots, now = Date.now(), seed = 2026 }) {
    const rand = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const weighted = (pairs) => {
        const total = pairs.reduce((s, p) => s + p[1], 0);
        let r = rand() * total;
        for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
        return pairs[pairs.length - 1][0];
    };
    const plotPairs = plots.length ? plots : Array.from({ length: 60 }, (_, i) => [String(100 + i), 1]);
    const unitId = () => {
        const [t, floors] = pick(TOWERS);
        const floor = 1 + Math.floor(rand() * floors);
        return `${t}-${floor}${String(1 + Math.floor(rand() * 4)).padStart(2, '0')}`;
    };
    // An IST time-of-day with evening + lunchtime peaks
    const hourIST = () => weighted([[8, 2], [10, 4], [11, 6], [12, 7], [13, 7], [14, 5], [16, 4], [18, 6], [19, 8], [20, 9], [21, 8], [22, 5], [23, 2]]);
    const at = (dayIndex, hour, minute) => {
        // dayIndex 0 = today (IST), 59 = 59 days ago
        const todayStartUTC = Date.parse(todayIST() + 'T00:00:00Z') - IST_OFFSET_MS;
        const t = todayStartUTC - dayIndex * DAY_MS + (hour * 60 + minute) * 60000;
        return Math.min(t, now - 60000);
    };

    const DAYS = 60;
    // Today is only partly over: scale today's traffic and keep its visits in the past
    const istNow = new Date(now + IST_OFFSET_MS);
    const hourNow = istNow.getUTCHours() + istNow.getUTCMinutes() / 60;
    const todayShare = Math.max(0.05, Math.min(1, (hourNow - 7) / 16));
    const visitors = [];
    const events = [];
    const ev = (visitor_id, type, t, plot_id = null, detail = null) =>
        events.push({ visitor_id, type, plot_id, detail, created_at: new Date(Math.min(t, now - 5000)).toISOString() });

    let vidCounter = 0;
    for (let d = DAYS - 1; d >= 0; d--) {
        const date = new Date(now - d * DAY_MS);
        const weekday = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getDay();
        const weekend = weekday === 0 || weekday === 6;
        const growth = 0.75 + 0.55 * ((DAYS - d) / DAYS);           // steady organic growth
        const campaign = d >= 17 && d <= 23 ? 2.1 : 1;              // a festive-offer campaign
        const n = Math.round(24 * growth * (weekend ? 1.45 : 1) * campaign * (0.8 + rand() * 0.4) * (d === 0 ? todayShare : 1));
        for (let i = 0; i < n; i++) {
            const id = `demo-${(vidCounter++).toString(36).padStart(6, '0')}`;
            const source = campaign > 1 && rand() < 0.45 ? pick(['instagram', 'facebook']) : weighted(SOURCES);
            const isMobile = rand() < 0.66;
            const visitCount = Math.min(d + 1, weighted([[1, 60], [2, 23], [3, 10], [4, 5], [6, 2]]));
            const days = [d];
            for (let k = 1; k < visitCount; k++) {
                const next = days[k - 1] - 1 - Math.floor(rand() * 6);
                if (next < 0) break; // return visits that would be in the future simply haven't happened
                days.push(next);
            }
            const apartmentsFan = rand() < 0.16;
            const viewed = [];
            let lastT = 0;
            let firstT = Infinity;
            days.forEach(day => {
                const hour = day === 0 ? 7 + Math.floor(rand() * Math.max(1, hourNow - 7)) : hourIST();
                const t0 = at(day, hour, Math.floor(rand() * 60));
                if (t0 > now) return;
                ev(id, 'visit', t0);
                firstT = Math.min(firstT, t0);
                let t = t0;
                if (rand() < 0.35) ev(id, 'view_mode', t += 20000, null, weighted([['3d', 5], ['map', 4], ['nearby', 2]]));
                const k = Math.min(12, Math.floor(-Math.log(1 - rand()) * (visitCount > 1 ? 3.2 : 2.2)));
                for (let j = 0; j < k; j++) {
                    const pid = apartmentsFan && rand() < 0.7 ? unitId() : weighted(plotPairs);
                    t += 15000 + rand() * 70000;
                    ev(id, 'plot_view', t, pid);
                    viewed.push(pid);
                }
                if (viewed.length && rand() < 0.06) ev(id, 'enquire', t += 30000, pick(viewed));
                lastT = Math.min(now - 5000, Math.max(lastT, t));
            });
            if (!lastT) continue;
            visitors.push({
                id, lead_phone: null, source, is_mobile: isMobile, visits: days.length,
                referrer: REFERRER[source], user_agent: isMobile ? 'Demo (Android)' : 'Demo (Desktop)',
                first_seen: new Date(firstT).toISOString(), last_seen: new Date(lastT).toISOString(),
                _viewed: viewed, _firstDay: d,
            });
        }
    }

    // Leads: more likely from engaged visitors
    const leads = [];
    const usedPhones = new Set();
    const today = todayIST();
    const ymd = (offset) => new Date(Date.parse(today + 'T00:00:00Z') + offset * DAY_MS).toISOString().slice(0, 10);
    // ~140 leads spread over the whole period, weighted toward engaged visitors
    const score = (v) => 1 + v._viewed.length + v.visits * 2;
    const totalScore = visitors.reduce((s, v) => s + score(v), 0);
    visitors.forEach(v => {
        const p = Math.min(0.6, (score(v) / totalScore) * 140);
        if (rand() > p) return;
        let phone;
        do phone = `999990${String(Math.floor(rand() * 10000)).padStart(4, '0')}`; while (usedPhones.has(phone));
        usedPhones.add(phone);
        const counts = {};
        v._viewed.forEach(x => { counts[x] = (counts[x] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || weighted(plotPairs);
        const age = v._firstDay;
        const status = age < 3 ? weighted([['new', 70], ['contacted', 30]])
            : age < 10 ? weighted([['new', 25], ['contacted', 40], ['site_visit', 25], ['lost', 10]])
                : weighted([['new', 8], ['contacted', 22], ['site_visit', 22], ['negotiation', 14], ['booked', 16], ['lost', 18]]);
        const createdT = Date.parse(v.first_seen) + (1 + rand() * 9) * 3600000;
        const created = new Date(Math.min(createdT, now - 120000)).toISOString();
        const updated = new Date(Math.min(Date.parse(created) + rand() * age * DAY_MS, now - 60000)).toISOString();
        const note = pick(NOTES[status]);
        let follow = null;
        if (ACTIVE_STATUSES.includes(status)) {
            const r = rand();
            follow = r < 0.16 ? ymd(-1 - Math.floor(rand() * 5)) : r < 0.3 ? ymd(0) : r < 0.72 ? ymd(1 + Math.floor(rand() * 9)) : null;
        }
        const name = `${pick(FIRST)} ${pick(LAST)}`;
        leads.push({
            name, phone, interested_plot: top, message: pick(MESSAGES),
            status, notes: note ? note.replace('{plot}', /^[A-C]-/.test(top) ? `apartment ${top}` : `Plot ${top}`) : null,
            enquiries: 1 + (rand() < 0.35 ? 1 : 0) + (rand() < 0.12 ? 1 : 0),
            source: v.source, follow_up: follow, created_at: created, updated_at: updated,
        });
        v.lead_phone = phone;
        ev(v.id, 'lead', Date.parse(created), top);
        // Some leads come back after sharing their number
        if (status !== 'new' && rand() < 0.5) {
            const t = Math.min(Date.parse(created) + (1 + rand() * 5) * DAY_MS, now - 30000);
            ev(v.id, 'visit', t);
            ev(v.id, 'plot_view', t + 40000, top);
            v.visits += 1;
            v.last_seen = new Date(Math.max(Date.parse(v.last_seen), t + 40000)).toISOString();
        }
    });

    return {
        leads,
        visitors: visitors.map(({ _viewed, _firstDay, ...v }) => v),
        events,
    };
}
// Inserting a few thousand demo rows can take longer than the default function limit
export const config = { maxDuration: 60 };

export default route(['POST', 'DELETE'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const repo = getRepo();
    if (req.method === 'DELETE') {
        await repo.clearDemo();
        return send(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const plots = Array.isArray(body.plots) ? body.plots
        .filter(p => Array.isArray(p) && PLOT_ID.test(String(p[0])) && Number(p[1]) > 0)
        .slice(0, 1000)
        .map(([id, w]) => [String(id), Math.min(20, Number(w))]) : [];
    if (!plots.length) throw badRequest('No plots supplied');
    await repo.clearDemo();
    const data = generateDemo({ plots });
    await repo.insertDemo(data);
    send(res, 200, { ok: true, leads: data.leads.length, visitors: data.visitors.length, events: data.events.length });
});
