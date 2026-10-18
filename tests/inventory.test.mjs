import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, adminCookie } from './helpers.mjs';

delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
const { default: publicInventory } = await import('../server/inventory.js');
const { default: adminInventory } = await import('../server/admin/inventory.js');
const { default: track } = await import('../server/track.js');
const { default: lead } = await import('../server/lead.js');
const { default: leads } = await import('../server/admin/leads.js');
const { default: ai } = await import('../server/admin/ai.js');
const { getRepo } = await import('../server/lib/db.js');
const headers = await adminCookie();

test('admin endpoints need a session', async () => {
    const r = await call(adminInventory, { url: '/api/admin/inventory' });
    assert.equal(r.status, 401);
});

test('public inventory starts empty and is cacheable', async () => {
    const r = await call(publicInventory, { url: '/api/inventory' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.units, []);
    assert.match(r.headers['cache-control'], /s-maxage/);
});

test('hold → public sees hold, customer details stay private', async () => {
    const r = await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', status: 'On hold', holdHours: 48, customerName: 'Rahul', customerPhone: '98765 43210', priceLakh: '42.5' } });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.unit.status, 'hold');
    assert.equal(r.json.unit.customer_phone, '9876543210');
    assert.equal(r.json.unit.price_lakh, 42.5);
    const pub = await call(publicInventory, { url: '/api/inventory' });
    const u = pub.json.units.find(x => x.id === '45');
    assert.equal(u.status, 'hold');
    assert.ok(u.hold_until);
    assert.equal(u.customer_name, undefined);
    assert.equal(u.customer_phone, undefined);
});

test('version check stops two people overwriting each other', async () => {
    const list = await call(adminInventory, { url: '/api/admin/inventory', headers });
    const u = list.json.units.find(x => x.id === '45');
    const stale = await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', status: 'booked', version: u.version - 1 } });
    assert.equal(stale.status, 409);
    const fresh = await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', status: 'booked', version: u.version } });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.json.unit.status, 'booked');
    assert.equal(fresh.json.unit.hold_until, null);
});

test('booking a customer creates / updates their lead card', async () => {
    const r = await call(leads, { url: '/api/admin/leads', headers });
    const l = r.json.leads.find(x => x.phone === '9876543210');
    assert.ok(l, 'lead created from booking');
    assert.equal(l.status, 'booked');
    assert.equal(l.interested_plot, '45');
    assert.equal(l.source, 'walk_in');
});

test('history records every change', async () => {
    const r = await call(adminInventory, { url: '/api/admin/inventory?id=45', headers });
    assert.equal(r.status, 200);
    const statuses = r.json.history.map(h => h.to_status);
    assert.deepEqual(statuses, ['booked', 'hold']);
});

test('an expired hold frees the plot automatically', async () => {
    const repo = getRepo();
    await repo.updateUnit('46', { status: 'hold', holdUntil: new Date(Date.now() - 1000).toISOString() }, { actor: 'test' });
    const pub = await call(publicInventory, { url: '/api/inventory' });
    assert.equal(pub.json.units.find(x => x.id === '46'), undefined, 'released hold is plain available again');
    const h = await call(adminInventory, { url: '/api/admin/inventory?id=46', headers });
    assert.equal(h.json.history[0].to_status, 'available');
    assert.equal(h.json.history[0].actor, 'auto');
});

test('bad input is rejected clearly', async () => {
    assert.equal((await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', status: 'gone' } })).status, 400);
    assert.equal((await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', customerPhone: '12345' } })).status, 400);
    assert.equal((await call(adminInventory, { method: 'PATCH', headers, body: { id: '', status: 'sold' } })).status, 400);
    assert.equal((await call(adminInventory, { method: 'PATCH', headers, body: { id: '45', priceLakh: 'abc' } })).status, 400);
});

test('Excel upload updates many plots and skips unchanged ones', async () => {
    const r = await call(adminInventory, { method: 'POST', headers, body: { rows: [
        { id: '50', status: 'Sold', priceLakh: '38' },
        { id: '51', status: 'Not for sale' },
        { id: '52', priceLakh: '41.25' },
        { id: 'bad id!!', status: 'sold' },
        { id: '53' },
    ] } });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.updated, 3);
    const again = await call(adminInventory, { method: 'POST', headers, body: { rows: [{ id: '50', status: 'sold', priceLakh: '38' }] } });
    assert.equal(again.json.updated, 0);
    const pub = await call(publicInventory, { url: '/api/inventory' });
    assert.equal(pub.json.units.find(x => x.id === '51').status, 'blocked');
    assert.equal(pub.json.units.find(x => x.id === '52').price_lakh, 41.25);
});

test('demand: visitor activity makes a plot "hot" on the public feed', async () => {
    for (let i = 0; i < 6; i++) {
        const visitorId = `visitor-${i}-abcdef`;
        await call(track, { method: 'POST', body: { visitorId, type: 'visit', referrer: 'https://www.instagram.com/', cp: i === 0 ? 'Rakesh' : null } });
        await call(track, { method: 'POST', body: { visitorId, type: 'plot_view', plotId: '60' } });
    }
    await call(track, { method: 'POST', body: { visitorId: 'visitor-0-abcdef', type: 'enquire', plotId: '60' } });
    await call(track, { method: 'POST', body: { visitorId: 'visitor-1-abcdef', type: 'enquire', plotId: '60' } });
    const pub = await call(publicInventory, { url: '/api/inventory' });
    assert.ok(pub.json.hot.some(h => h.id === '60'), JSON.stringify(pub.json.hot));
    const adm = await call(adminInventory, { url: '/api/admin/inventory?days=7', headers });
    assert.equal(adm.json.demand['60'].tier, 'hot');
    assert.equal(adm.json.demand['60'].people, 6);
});

test('a lead from a broker link is credited to that broker (first touch wins)', async () => {
    const r = await call(lead, { method: 'POST', body: { visitorId: 'visitor-0-abcdef', name: 'Seema Jain', phone: '9123456780', plotId: '60' } });
    assert.equal(r.status, 200, r.body);
    await call(lead, { method: 'POST', body: { visitorId: 'visitor-0-abcdef', name: 'Seema Jain', phone: '9123456780', plotId: '61', cp: 'Other' } });
    const all = await call(leads, { url: '/api/admin/leads', headers });
    const l = all.json.leads.find(x => x.phone === '9123456780');
    assert.equal(l.cp, 'Rakesh');
    assert.equal(l.source, 'instagram');
});

test('ask: rule-based answers work without an API key', async () => {
    const units = [
        { id: '1', status: 'available', facing: ['East'], zone: 'A', corner: true, priceLakh: 38, areaSqFt: 1800, gaj: 200, demand: 'hot' },
        { id: '2', status: 'available', facing: ['West'], zone: 'B', corner: false, priceLakh: 45, areaSqFt: 2100, gaj: 233, demand: 'normal' },
        { id: '3', status: 'hold', facing: ['East'], zone: 'A', corner: false, priceLakh: null, areaSqFt: 1900, gaj: 211, demand: 'normal' },
    ];
    const r = await call(ai, { method: 'POST', headers, body: { task: 'ask', question: 'east facing plots under 40 lakh', units } });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.ai, false);
    assert.deepEqual(r.json.unitIds, ['1']);
    const hold = await call(ai, { method: 'POST', headers, body: { task: 'ask', question: 'kaunse plot hold par hain', units, lang: 'hi' } });
    assert.deepEqual(hold.json.unitIds, ['3']);
    const gaj = await call(ai, { method: 'POST', headers, body: { task: 'ask', question: 'available plots above 220 gaj', units } });
    assert.deepEqual(gaj.json.unitIds, ['2']);
});

test('brief: template note without an API key', async () => {
    const r = await call(ai, { method: 'POST', headers, body: { task: 'brief', lang: 'en', facts: { callsDue: 3, newLeads: 2, holdsEnding: ['45'], available: 40, hold: 2, booked: 5, sold: 10, hot: ['60'], noPrice: ['70', '71'] } } });
    assert.equal(r.status, 200);
    assert.equal(r.json.ai, false);
    assert.match(r.json.text, /3 customers to call/);
    assert.match(r.json.text, /Plot 45/);
});
