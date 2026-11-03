// Virasat Homes: layout data checks + API flow, run against the in-memory store and against real
// Postgres SQL (PGlite) so the queries used on Vercel/Neon are exercised too.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { call } from '../../tests/helpers.mjs';
import { route } from '../../server/router.js';
import { setRepo, memoryRepo, pgRepo } from '../server/repo.js';
import { toLatLng, polygonArea, centroid, pointInPolygon } from '../src/shared/geo.js';

const layout = JSON.parse(readFileSync(new URL('../data/layout.json', import.meta.url), 'utf8'));
const api = (path, opts = {}) => call(route, { ...opts, url: '/api/virasat/' + path });

describe('layout data', () => {
    test('has every plot from the brochure exactly once', () => {
        const ids = layout.plots.map(p => p.id);
        const expected = [
            ...Array.from({ length: 190 }, (_, i) => String(i + 1)),
            ...Array.from({ length: 24 }, (_, i) => 'L' + (i + 1)),
            ...Array.from({ length: 24 }, (_, i) => 'E' + (i + 1)),
        ];
        assert.equal(ids.length, 238);
        assert.equal(new Set(ids).size, 238);
        assert.deepEqual([...ids].sort(), [...expected].sort());
    });

    test('plot shapes are sane and inside the site boundary', () => {
        for (const p of layout.plots) {
            const a = polygonArea(p.points) / 9; // sq ft → sq yd
            assert.ok(p.points.length >= 4, `plot ${p.id} has a shape`);
            assert.ok(a > 30 && a < 1000, `plot ${p.id} area ${a}`);
            // drawn area within 12% of the stated area (printed on the plan or measured)
            assert.ok(Math.abs(a - p.areaSqYd) / p.areaSqYd < 0.12, `plot ${p.id}: drawn ${a.toFixed(1)} vs ${p.areaSqYd}`);
            assert.ok(pointInPolygon(centroid(p.points), layout.boundary), `plot ${p.id} inside boundary`);
        }
    });

    test('plots do not overlap each other', () => {
        const c = layout.plots.map(p => ({ id: p.id, c: centroid(p.points) }));
        for (const p of layout.plots) {
            for (const o of c) {
                if (o.id !== p.id) assert.ok(!pointInPolygon(o.c, p.points), `plot ${o.id} centre falls inside plot ${p.id}`);
            }
        }
    });

    test('standard plots carry the sizes printed on the plan', () => {
        const byId = Object.fromEntries(layout.plots.map(p => [p.id, p]));
        assert.equal(byId['100'].areaSqYd, 115.56);
        assert.equal(byId['100'].dims.label, "20' × 52'");
        assert.equal(byId['25'].areaSqYd, 166.69);
        assert.equal(byId['160'].areaSqYd, 111.91);
        assert.equal(byId['1'].areaSqYd, 830.51);
        assert.equal(byId['17'].areaSqYd, 492.24);
        assert.ok(layout.plots.every(p => p.facing.length > 0), 'every plot faces a road');
    });

    test('site sits on Kotkhawada Road (SH-2) north of the owner pin', () => {
        const [lat0, lng0] = layout.project.pin;
        const site = layout.boundary.map(toLatLng);
        const lat = site.reduce((s, p) => s + p[0], 0) / site.length;
        const lng = site.reduce((s, p) => s + p[1], 0) / site.length;
        // centre ≈ 200 m north-west of the pin, which is on the highway at the entrance
        const dN = (lat - lat0) * 110797;
        const dE = (lng - lng0) * 99588;
        assert.ok(dN > 120 && dN < 320, `north offset ${dN}`);
        assert.ok(dE > -220 && dE < 0, `east offset ${dE}`);
        // area ≈ 15.5 acres
        const acres = polygonArea(layout.boundary) / 43560;
        assert.ok(acres > 15 && acres < 16, `acres ${acres}`);
    });
});

async function flow(t) {
    const health = await api('health');
    assert.equal(health.status, 200);
    assert.equal(health.json.plots, 238);

    const inv = await api('inventory');
    assert.equal(inv.status, 200);
    assert.equal(inv.json.plots.length, 238);
    assert.ok(inv.json.plots.every(p => p.status === 'available'));

    const vid = 'visitor-' + Math.random().toString(36).slice(2, 10);
    assert.equal((await api('track', { method: 'POST', body: { visitorId: vid, type: 'visit', referrer: 'https://www.google.com/' } })).status, 200);
    assert.equal((await api('track', { method: 'POST', body: { visitorId: vid, type: 'plot_view', plotId: '25' } })).status, 200);
    assert.equal((await api('track', { method: 'POST', body: { visitorId: vid, type: 'nope' } })).status, 400);

    const bad = await api('lead', { method: 'POST', body: { visitorId: vid, name: 'Asha', phone: '12345' } });
    assert.equal(bad.status, 400);
    const l1 = await api('lead', { method: 'POST', body: { visitorId: vid, name: 'Asha Verma', phone: '+91 98290 12345', plotId: '25', message: 'Is it east facing?' } });
    assert.equal(l1.status, 200);
    const l2 = await api('lead', { method: 'POST', body: { visitorId: vid, name: 'Asha Verma', phone: '9829012345', plotId: 'L3' } });
    assert.equal(l2.json.id, l1.json.id, 'same mobile → same customer');

    // admin needs a session
    assert.equal((await api('admin/summary')).status, 401);
    assert.equal((await api('admin/session', { method: 'POST', body: { password: 'wrong' } })).status, 401);
    const login = await api('admin/session', { method: 'POST', body: { password: 'admin' } });
    assert.equal(login.status, 200);
    const cookie = login.headers['set-cookie'].split(';')[0];
    assert.match(cookie, /^vh_admin=/);
    const headers = { cookie };

    const sum = await api('admin/summary', { headers });
    assert.equal(sum.status, 200);
    assert.equal(sum.json.plots.total, 238);
    assert.equal(sum.json.plots.byStatus.available, 238);
    assert.equal(sum.json.leads.total, 1);
    assert.equal(sum.json.visitors.today, 1);
    assert.equal(sum.json.topViewed[0].id, '25');
    assert.equal(sum.json.series.length, 14);

    const list = await api('admin/plots', { headers });
    const p25 = list.json.plots.find(p => p.id === '25');
    assert.equal(p25.views, 1);
    assert.equal(p25.version, 0);

    const upd = await api('admin/plots', { method: 'PATCH', headers, body: { id: '25', version: 0, status: 'booked', pricePerSqYd: 14500, customerName: 'Asha Verma', customerPhone: '9829012345' } });
    assert.equal(upd.status, 200, JSON.stringify(upd.json));
    assert.equal(upd.json.plot.status, 'booked');
    assert.equal(upd.json.plot.pricePerSqYd, 14500);
    const stale = await api('admin/plots', { method: 'PATCH', headers, body: { id: '25', version: 0, status: 'sold' } });
    assert.equal(stale.status, 409, 'second save with an old version is refused');
    assert.equal((await api('admin/plots', { method: 'PATCH', headers, body: { id: '999', version: 0, status: 'sold' } })).status, 400);
    assert.equal((await api('admin/plots', { method: 'PATCH', headers, body: { id: '26', version: 0, status: 'gone' } })).status, 400);

    // a hold that has already run out frees itself
    const hold = await api('admin/plots', { method: 'PATCH', headers, body: { id: '26', version: 0, status: 'hold', holdUntil: new Date(Date.now() - 60000).toISOString() } });
    assert.equal(hold.status, 200);
    const pub = await api('inventory');
    const byId = Object.fromEntries(pub.json.plots.map(p => [p.id, p]));
    assert.equal(byId['25'].status, 'booked');
    assert.equal(byId['25'].pricePerSqYd, 14500);
    assert.equal(byId['26'].status, 'available');
    assert.ok(!('customerName' in byId['25']), 'customer details never public');
    const unit25 = pub.json.units.find(u => u.id === '25');
    assert.equal(unit25.price_lakh, 24.17);
    assert.equal(unit25.price_per_sqyd, 14500);
    assert.ok(!JSON.stringify(pub.json).includes('Asha'), 'no names in the public feed');
    assert.equal((await api('track', { method: 'POST', body: { visitorId: vid, type: 'view_mode', mode: '3d' } })).status, 200);

    const hist = await api('admin/plots?history=25', { headers });
    assert.equal(hist.json.history[0].action, 'update');

    const leads = await api('admin/leads', { headers });
    assert.equal(leads.json.leads.length, 1);
    assert.equal(leads.json.leads[0].plotId, 'L3');
    assert.equal(leads.json.leads[0].source, 'google');
    const lid = leads.json.leads[0].id;
    const lu = await api('admin/leads', { method: 'PATCH', headers, body: { id: lid, status: 'site_visit', notes: 'Coming Sunday', followUp: '2026-11-08' } });
    assert.equal(lu.status, 200);
    assert.equal(lu.json.lead.status, 'site_visit');
    assert.equal(lu.json.lead.followUp, '2026-11-08');

    const csv = await api('admin/export?kind=leads', { headers });
    assert.equal(csv.status, 200);
    assert.match(csv.body, /Asha Verma,9829012345,L3,site_visit/);
    const pcsv = await api('admin/export?kind=plots', { headers });
    assert.match(pcsv.body, /\n25,booked,166\.69,14500,2417005,Asha Verma/);

    assert.equal((await api(`admin/leads?id=${lid}`, { method: 'DELETE', headers })).status, 200);
    assert.equal((await api('admin/leads', { headers })).json.leads.length, 0);

    assert.equal((await api('admin/session', { method: 'DELETE', headers })).status, 200);
}

describe('API (in-memory store)', () => {
    before(() => setRepo(memoryRepo()));
    test('customer + admin flow', flow);
});

describe('API (Postgres SQL via PGlite)', () => {
    before(() => {
        const db = new PGlite();
        // Same calling style as @neondatabase/serverless: sql`... ${value} ...` → rows
        const sql = async (strings, ...values) => {
            let text = '';
            strings.forEach((s, i) => { text += s + (i < values.length ? '$' + (i + 1) : ''); });
            return (await db.query(text, values.map(v => (v === undefined ? null : v)))).rows;
        };
        setRepo(pgRepo(sql));
    });
    test('customer + admin flow', flow);
});
