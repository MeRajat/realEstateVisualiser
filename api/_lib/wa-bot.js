// WhatsApp assistant: answers a customer's first messages in Hindi/English, learns budget / size /
// when they can visit, and hands over to the builder. Uses Claude when a key is set; otherwise a
// short scripted flow. Sends through the WhatsApp Cloud API when configured, else just returns the reply.
import { createRequire } from 'node:module';
import { aiEnabled, askJson } from './ai.js';
import { getRepo } from './db.js';
import { SERVER_TO_TOKEN } from './inventory-labels.js';

const require = createRequire(import.meta.url);
const PLAN = require('../../src/shared/plots_data.json');
const SITE_NAME = process.env.SITE_NAME || 'The Greater Mansarovar';
const SITE_URL = process.env.SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` || '';

export const waConfigured = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID);

const parseNum = (s) => parseFloat(String(s ?? '').replace(/[^\d.]/g, '')) || 0;

// Plot facts the assistant may quote: id, area, price (plan price unless the builder changed it), status
export async function stockSummary() {
    const repo = getRepo();
    const overrides = new Map((await repo.listUnits()).map(u => [u.id, u]));
    const plots = PLAN.filter(p => !p.isRoad && !p.isPark && p.id !== 'SITE BOUNDARY').map(p => {
        const o = overrides.get(String(p.id));
        const status = o?.status || (String(p.status).toLowerCase() === 'sold' ? 'sold' : String(p.status).toLowerCase() === 'reserved' ? 'blocked' : 'available');
        const priceLakh = o?.price_lakh ?? (parseNum(p.price) || null);
        return { id: String(p.id), areaSqFt: parseNum(p.area), gaj: Math.round(parseNum(p.area) / 9), priceLakh, status };
    });
    const available = plots.filter(p => p.status === 'available');
    const priced = available.filter(p => p.priceLakh);
    return {
        total: plots.length, available: available.length, hold: plots.filter(p => p.status === 'hold').length,
        minPriceLakh: priced.length ? Math.min(...priced.map(p => p.priceLakh)) : null,
        maxPriceLakh: priced.length ? Math.max(...priced.map(p => p.priceLakh)) : null,
        sizes: [...new Set(available.map(p => p.gaj))].sort((a, b) => a - b).slice(0, 6),
        sample: available.slice(0, 25).map(p => ({ id: p.id, gaj: p.gaj, priceLakh: p.priceLakh })),
        statusLabel: SERVER_TO_TOKEN,
    };
}

const SYSTEM = `You are the WhatsApp sales assistant of ${SITE_NAME}, a residential plot project in Jaipur, India. You chat with
home buyers in the language they use (Hindi in Devanagari, English, or Hinglish in Latin script — mirror them). Be warm, brief
(2-4 short lines, WhatsApp style, no markdown), and honest: quote only the stock facts given. Your goals, in order:
1) answer what they asked, 2) learn their budget (₹ lakh), plot size (gaj or sq.ft) and preferred facing, 3) offer a site visit
and get a day, 4) when they want to talk to a person, or are ready to visit / book, hand over to the builder's team.
Never promise discounts, loan approval or legal status. If asked about RERA/approvals, say the team will share documents.
Always fill the JSON fields you learned; leave unknown ones null. stage: 'contacted' once you have replied, 'site_visit' when a
visit day is agreed, 'negotiation' if they want to book or discuss price seriously, 'lost' only if they clearly say not interested.
visitDay must be an ISO date (YYYY-MM-DD) in Asia/Kolkata. summary: one line for the builder, in English, e.g. "Wants 200 gaj east-facing under 40L, visiting Sunday".`;

const SCHEMA = {
    type: 'object',
    properties: {
        reply: { type: 'string' },
        name: { type: ['string', 'null'] },
        budgetLakh: { type: ['number', 'null'] },
        sizeGaj: { type: ['number', 'null'] },
        facing: { type: ['string', 'null'] },
        visitDay: { type: ['string', 'null'] },
        interestedPlot: { type: ['string', 'null'] },
        stage: { type: 'string', enum: ['new', 'contacted', 'site_visit', 'negotiation', 'lost'] },
        hot: { type: 'boolean' },
        handoff: { type: 'boolean' },
        summary: { type: 'string' },
    },
    required: ['reply', 'name', 'budgetLakh', 'sizeGaj', 'facing', 'visitDay', 'interestedPlot', 'stage', 'hot', 'handoff', 'summary'],
    additionalProperties: false,
};

// Scripted fallback (no API key): a 4-step flow that still captures the essentials
function scripted(text, thread, stock) {
    const t = text.toLowerCase();
    const mine = thread.filter(m => m.direction === 'out').length;
    const hi = /[ऀ-ॿ]/.test(text) || /\b(namaste|kya|hai|chahiye|plot ka|bhav|rate)\b/.test(t);
    const price = stock.minPriceLakh ? (hi ? `₹${stock.minPriceLakh} लाख से शुरू` : `from ₹${stock.minPriceLakh} lakh`) : '';
    const wantsPerson = /\b(call|baat|talk|phone|speak|manager|owner)\b/.test(t);
    const visitDay = /\b(sunday|ravivar|saturday|shanivar|tomorrow|kal|today|aaj|monday|tuesday|wednesday|thursday|friday)\b/.exec(t)?.[0];
    const out = { name: null, budgetLakh: null, sizeGaj: null, facing: null, visitDay: null, interestedPlot: null, stage: 'contacted', hot: false, handoff: false, summary: '' };
    const money = t.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|l\b)/); if (money) out.budgetLakh = parseFloat(money[1]);
    const gaj = t.match(/(\d{2,4})\s*(gaj|gaz|yard)/); if (gaj) out.sizeGaj = parseInt(gaj[1], 10);
    const plot = t.match(/plot\s*(?:no\.?|number)?\s*([0-9]{2,4})/); if (plot) out.interestedPlot = plot[1];
    for (const [k, v] of Object.entries({ east: 'East', west: 'West', north: 'North', south: 'South', purab: 'East', uttar: 'North' })) if (t.includes(k)) out.facing = v;
    if (wantsPerson) { out.handoff = true; out.stage = 'negotiation'; }
    if (visitDay) { out.visitDay = nextDay(visitDay); out.stage = 'site_visit'; out.hot = true; }
    let reply;
    if (mine === 0) {
        reply = hi
            ? `नमस्ते! ${SITE_NAME} में आपका स्वागत है 🙏 अभी ${stock.available} प्लॉट उपलब्ध हैं${price ? ` (${price})` : ''}।\nआपका बजट लगभग कितना है, और कितने गज का प्लॉट चाहिए?`
            : `Namaste! Welcome to ${SITE_NAME} 🙏 ${stock.available} plots are available right now${price ? ` (${price})` : ''}.\nWhat is your budget, and what plot size (gaj) are you looking for?`;
    } else if (out.visitDay) {
        reply = hi ? `बहुत बढ़िया! ${visitDay} को साइट विज़िट नोट कर ली है। हमारी टीम आपको कॉल करके समय पक्का करेगी। लोकेशन: ${SITE_URL || 'लिंक जल्द भेजेंगे'}`
            : `Great! Site visit noted for ${visitDay}. Our team will call to confirm the time. Location: ${SITE_URL || 'link coming shortly'}`;
    } else if (out.handoff) {
        reply = hi ? 'ज़रूर, हमारी टीम का कोई सदस्य आपको थोड़ी देर में कॉल करेगा।' : 'Sure, someone from our team will call you shortly.';
    } else if (out.budgetLakh || out.sizeGaj) {
        const fit = stock.sample.filter(p => (!out.budgetLakh || !p.priceLakh || p.priceLakh <= out.budgetLakh) && (!out.sizeGaj || Math.abs(p.gaj - out.sizeGaj) <= 40)).slice(0, 4);
        const list = fit.map(p => `Plot ${p.id} · ${p.gaj} gaj${p.priceLakh ? ` · ₹${p.priceLakh}L` : ''}`).join('\n');
        reply = hi ? `${list ? `ये आपके लिए ठीक रहेंगे:\n${list}\n` : ''}क्या आप इस हफ़्ते साइट देखने आ सकते हैं? कौन सा दिन ठीक रहेगा?`
            : `${list ? `These could suit you:\n${list}\n` : ''}Can you visit the site this week? Which day works for you?`;
        out.summary = `Budget ${out.budgetLakh ? `₹${out.budgetLakh}L` : '?'}, size ${out.sizeGaj ? `${out.sizeGaj} gaj` : '?'}${out.facing ? `, ${out.facing}-facing` : ''}`;
    } else {
        reply = hi ? `${stock.available} प्लॉट उपलब्ध हैं${price ? `, ${price}` : ''}। बजट और साइज़ बताएँ तो सही प्लॉट सुझाऊँ, या साइट विज़िट के लिए दिन बताएँ।`
            : `${stock.available} plots are available${price ? `, ${price}` : ''}. Tell me your budget and size and I'll suggest plots, or name a day for a site visit.`;
    }
    out.summary ||= out.visitDay ? `Site visit ${visitDay}` : out.handoff ? 'Asked to talk to the team' : 'Chatting on WhatsApp';
    return { reply, ...out };
}

function nextDay(word) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const alias = { ravivar: 'sunday', shanivar: 'saturday', kal: 'tomorrow', aaj: 'today' };
    const w = alias[word] || word;
    const now = new Date(Date.now() + 5.5 * 3600000);
    let add = w === 'today' ? 0 : w === 'tomorrow' ? 1 : ((days.indexOf(w) - now.getUTCDay()) + 7) % 7 || 7;
    return new Date(now.getTime() + add * 86400000).toISOString().slice(0, 10);
}

// Handle one inbound message. Returns { reply, lead, sent }.
export async function handleInbound({ phone, text, profileName = null, send = waConfigured() }) {
    const repo = getRepo();
    await repo.addWaMessage({ phone, direction: 'in', text });
    const [thread, stock] = await Promise.all([repo.waThread(phone, 16), stockSummary()]);
    let out = null;
    if (aiEnabled()) {
        try {
            const history = thread.slice(0, -1).map(m => `${m.direction === 'in' ? 'Customer' : 'Assistant'}: ${m.text}`).join('\n');
            out = await askJson({
                system: SYSTEM, schema: SCHEMA, maxTokens: 1200,
                user: `Stock now: ${JSON.stringify({ ...stock, sample: stock.sample.slice(0, 15) })}\nSite link: ${SITE_URL || 'n/a'}\nToday (IST): ${new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)}\nCustomer WhatsApp name: ${profileName || 'unknown'}\n\nConversation so far:\n${history || '(none)'}\n\nCustomer: ${text}`,
            });
        } catch (e) { console.error('[wa] ai failed, using script', e.message); }
    }
    out ??= scripted(text, thread, stock);
    const reply = String(out.reply || '').trim().slice(0, 1500);
    await repo.addWaMessage({ phone, direction: 'out', text: reply, kind: 'ai' });

    const notes = [out.budgetLakh ? `Budget ₹${out.budgetLakh}L` : null, out.sizeGaj ? `${out.sizeGaj} gaj` : null, out.facing ? `${out.facing}-facing` : null].filter(Boolean).join(', ');
    const lead = await repo.upsertInboundLead({
        name: out.name || profileName || null, phone, source: 'whatsapp', message: text.slice(0, 500),
        status: out.stage && out.stage !== 'new' ? out.stage : 'contacted',
        aiSummary: [out.summary, notes].filter(Boolean).join(' · ').slice(0, 300) || null,
        followUp: out.visitDay || null,
    });
    if (out.interestedPlot) await repo.updateLead(lead.id, { status: null, notes: null, followUp: undefined }).catch(() => {});

    let sent = false;
    if (send && reply) sent = await sendWhatsApp(phone, reply);
    return { reply, lead: { ...lead, handoff: !!out.handoff, hot: !!out.hot, visitDay: out.visitDay || null }, sent };
}

// WhatsApp Cloud API: plain text, allowed inside the 24-hour window the customer opened by messaging us
export async function sendWhatsApp(phone, text) {
    if (!waConfigured()) return false;
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: `91${phone}`, type: 'text', text: { preview_url: true, body: text } }),
    });
    if (!res.ok) { console.error('[wa] send failed', res.status, await res.text().catch(() => '')); return false; }
    return true;
}
