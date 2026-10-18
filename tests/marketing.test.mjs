import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { call, adminCookie } from './helpers.mjs';

delete process.env.DATABASE_URL;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.AI_DEV_CLI;
process.env.META_VERIFY_TOKEN = 'meta-verify';
process.env.META_APP_SECRET = 'meta-secret';
process.env.WA_VERIFY_TOKEN = 'wa-verify';
const { default: meta } = await import('../server/webhooks/meta.js');
const { default: whatsapp } = await import('../server/webhooks/whatsapp.js');
const { default: marketing } = await import('../server/admin/marketing.js');
const { default: track } = await import('../server/track.js');
const { default: lead } = await import('../server/lead.js');
const { default: leads } = await import('../server/admin/leads.js');
const { default: ai } = await import('../server/admin/ai.js');
const headers = await adminCookie();
const sign = (raw) => 'sha256=' + createHmac('sha256', 'meta-secret').update(raw).digest('hex');

test('webhook verification handshake', async () => {
    const ok = await call(meta, { url: '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=meta-verify&hub.challenge=12345' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '12345');
    const bad = await call(meta, { url: '/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1' });
    assert.equal(bad.status, 403);
    const wa = await call(whatsapp, { url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wa-verify&hub.challenge=abc' });
    assert.equal(wa.body, 'abc');
});

test('Meta lead form → lead card with campaign, signature checked', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [{ id: '1', changes: [{ field: 'leadgen', value: {
        leadgen_id: '999', ad_id: '42', ad_name: 'Diwali plots', form_name: 'Site visit form', platform: 'ig',
        field_data: [{ name: 'full_name', values: ['Priya Sharma'] }, { name: 'phone_number', values: ['+919812345678'] }, { name: 'email', values: ['p@example.com'] }, { name: 'budget', values: ['30-40 lakh'] }],
    } }] }] });
    const unsigned = await call(meta, { method: 'POST', url: '/api/webhooks/meta', body: payload, headers: { 'x-hub-signature-256': 'sha256=nope' } });
    assert.equal(unsigned.status, 401);
    const r = await call(meta, { method: 'POST', url: '/api/webhooks/meta', body: payload, headers: { 'x-hub-signature-256': sign(payload) } });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.created.length, 1);
    const all = await call(leads, { url: '/api/admin/leads', headers });
    const l = all.json.leads.find(x => x.phone === '9812345678');
    assert.equal(l.name, 'Priya Sharma');
    assert.equal(l.source, 'instagram');
    assert.equal(l.campaign, 'Diwali plots');
    assert.match(l.message, /budget: 30-40 lakh/);
    assert.equal(l.status, 'new');
});

test('WhatsApp message → scripted assistant reply, lead card, thread saved', async () => {
    const msg = (text) => JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '919876501234', profile: { name: 'Amit' } }],
        messages: [{ from: '919876501234', type: 'text', text: { body: text } }],
    } }] }] });
    const r1 = await call(whatsapp, { method: 'POST', url: '/api/webhooks/whatsapp', body: msg('Hi, plot ka rate kya hai?') });
    assert.equal(r1.status, 200, r1.body);
    assert.deepEqual(r1.json.handled, [{ phone: '9876501234', replied: true, sent: false }]);
    const r2 = await call(whatsapp, { method: 'POST', url: '/api/webhooks/whatsapp', body: msg('Budget 40 lakh, 200 gaj east facing') });
    assert.equal(r2.status, 200);
    const r3 = await call(whatsapp, { method: 'POST', url: '/api/webhooks/whatsapp', body: msg('Sunday aa sakta hu') });
    assert.equal(r3.status, 200);
    const all = await call(leads, { url: '/api/admin/leads', headers });
    const l = all.json.leads.find(x => x.phone === '9876501234');
    assert.equal(l.name, 'Amit');
    assert.equal(l.source, 'whatsapp');
    assert.equal(l.status, 'site_visit');
    assert.ok(l.follow_up, 'visit day saved as follow-up');
    assert.match(l.ai_summary, /Site visit sunday/i);
    const thread = await call(marketing, { url: '/api/admin/marketing?thread=9876501234', headers });
    assert.equal(thread.json.messages.length, 6);
    assert.equal(thread.json.messages[0].direction, 'in');
    assert.match(thread.json.messages[1].text, /Namaste|नमस्ते/);
    assert.match(thread.json.messages[3].text, /Plot \d+ · \d+ gaj/);
});

test('campaign link → visit and lead attributed to the campaign', async () => {
    await call(track, { method: 'POST', body: { visitorId: 'camp-visitor-0001', type: 'visit', utmSource: 'fb', utmCampaign: 'diwali-offer', utmContent: 'paid' } });
    await call(track, { method: 'POST', body: { visitorId: 'camp-visitor-0002', type: 'visit', fbclid: 1 } });
    await call(lead, { method: 'POST', body: { visitorId: 'camp-visitor-0001', name: 'Rohit Jain', phone: '9000011111', plotId: '160' } });
    const all = await call(leads, { url: '/api/admin/leads', headers });
    const l = all.json.leads.find(x => x.phone === '9000011111');
    assert.equal(l.source, 'facebook');
    assert.equal(l.campaign, 'diwali-offer');
    const m = await call(marketing, { url: '/api/admin/marketing?days=30', headers });
    const row = m.json.campaigns.find(c => c.source === 'facebook' && c.campaign === 'diwali-offer');
    assert.deepEqual({ visitors: row.visitors, leads: row.leads }, { visitors: 1, leads: 1 });
    assert.ok(m.json.campaigns.some(c => c.source === 'facebook' && !c.campaign && c.visitors === 1));
    assert.equal(m.json.setup.whatsapp.configured, false);
    assert.match(m.json.setup.meta.webhookUrl, /\/api\/webhooks\/meta$/);
});

test('spend entries and sandbox chat need a session; spend validates', async () => {
    assert.equal((await call(marketing, { method: 'POST', body: { action: 'spend' } })).status, 401);
    const bad = await call(marketing, { method: 'POST', headers, body: { action: 'spend', source: 'tiktok', week: '2026-10-12', amount: 100 } });
    assert.equal(bad.status, 400);
    const ok = await call(marketing, { method: 'POST', headers, body: { action: 'spend', source: 'facebook', campaign: 'diwali-offer', week: '2026-10-12', amount: '7500' } });
    assert.equal(ok.status, 200, ok.body);
    const m = await call(marketing, { url: '/api/admin/marketing?days=30', headers });
    assert.equal(m.json.spend[0].amount, 7500);
    const del = await call(marketing, { method: 'POST', headers, body: { action: 'spend-delete', id: ok.json.id } });
    assert.equal(del.status, 200);
    const sandbox = await call(marketing, { method: 'POST', headers, body: { action: 'wa-test', text: 'hello', name: 'Tester' } });
    assert.equal(sandbox.status, 200, sandbox.body);
    assert.ok(sandbox.json.reply.length > 10);
    assert.equal(sandbox.json.sent, false);
});

test('ad copy: template without a key, RERA line appended', async () => {
    const r = await call(ai, { method: 'POST', headers, body: { task: 'adcopy', lang: 'en', facts: { siteName: 'Greater Mansarovar', city: 'Jaipur', available: 42, minPriceLakh: 35, reraId: 'RAJ/P/2026/1234' } } });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.json.variants.length, 3);
    assert.ok(r.json.variants.every(v => /RERA: RAJ\/P\/2026\/1234/.test(v.primaryText)));
    assert.equal(r.json.ai, false);
});
