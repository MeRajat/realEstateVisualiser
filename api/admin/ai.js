// POST /api/admin/ai — the dashboard's assistant.
//   { task: 'ask',   question, units: [...], lang }  → { answer, unitIds, ai }
//   { task: 'brief', facts, lang }                    → { text, ai }
// `units` is the compact stock table the dashboard already has (id, status, facing, zone, corner,
// priceLakh, areaSqFt, demand). With no API key, 'ask' uses keyword rules and 'brief' a template.
import { route, send, readJson, badRequest, cleanText } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import { aiEnabled, askJson, askText } from '../_lib/ai.js';
import { parseAsk, filterUnits, describeAsk } from '../_lib/inventory.js';

const ASK_SYSTEM = `You help a small Indian real-estate builder find plots in their own stock. The user is busy, not technical,
and may write in Hindi, English or Hinglish. You get the stock as a JSON array of units with: id, status
(available | hold | booked | sold | blocked), facing (road directions), zone, corner, priceLakh (₹ lakh, may be null), areaSqFt, gaj, demand (hot | warm | normal).
Answer the question from that data only. Reply in the same language the user wrote in; keep it to 1-3 short sentences a
site owner can read on a phone. Give counts and the best few plot numbers. Put every matching plot id in unitIds (max 40).
If the question is not about the stock, say so politely in one line and return an empty list.`;

const BRIEF_SYSTEM = `You write a short morning note for the owner of a small Indian real-estate project who checks it on a phone.
You get today's facts as JSON. Write 3 to 5 short lines, each starting with "•". Plain words, no jargon, no headings, no markdown
bold. Lead with what needs action today (calls due, holds ending, new customers), then one line on stock and demand,
then one concrete suggestion (e.g. a plot with many looks but no price, or a popular plot worth a WhatsApp push).
Write in Hindi (Devanagari) if lang is "hi", otherwise simple Indian English. Numbers as digits. Never invent facts.`;

const ASK_SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' }, unitIds: { type: 'array', items: { type: 'string' }, maxItems: 40 } },
    required: ['answer', 'unitIds'],
    additionalProperties: false,
};

function compact(units) {
    return units.slice(0, 2500).map(u => ({
        id: String(u.id), status: u.status, facing: u.facing, zone: u.zone, corner: !!u.corner,
        priceLakh: u.priceLakh ?? null, areaSqFt: u.areaSqFt ?? null, gaj: u.gaj ?? null, demand: u.demand || 'normal',
    }));
}

function briefFallback(f, lang) {
    const hi = lang === 'hi';
    const lines = [];
    if (f.callsDue) lines.push(hi ? `• आज ${f.callsDue} ग्राहकों को कॉल करना है।` : `• ${f.callsDue} customer${f.callsDue === 1 ? '' : 's'} to call today.`);
    if (f.newLeads) lines.push(hi ? `• पिछले 24 घंटे में ${f.newLeads} नए ग्राहकों ने नंबर दिया।` : `• ${f.newLeads} new customer${f.newLeads === 1 ? '' : 's'} shared their number in the last 24 hours.`);
    if (f.holdsEnding?.length) lines.push(hi ? `• आज होल्ड खत्म हो रहा है: प्लॉट ${f.holdsEnding.join(', ')}। ग्राहक से बुकिंग पक्की करें।` : `• Holds ending today: Plot ${f.holdsEnding.join(', ')}. Confirm the booking or release them.`);
    lines.push(hi ? `• स्टॉक: ${f.available} उपलब्ध, ${f.hold} होल्ड पर, ${f.booked} बुक, ${f.sold} बिक चुके।` : `• Stock: ${f.available} available, ${f.hold} on hold, ${f.booked} booked, ${f.sold} sold.`);
    if (f.hot?.length) lines.push(hi ? `• सबसे ज़्यादा मांग: प्लॉट ${f.hot.slice(0, 3).join(', ')}। इन्हें WhatsApp पर आगे बढ़ाएँ।` : `• Most in demand: Plot ${f.hot.slice(0, 3).join(', ')}. Worth a WhatsApp push.`);
    if (f.noPrice?.length) lines.push(hi ? `• ${f.noPrice.length} उपलब्ध प्लॉट पर दाम नहीं लिखा (जैसे ${f.noPrice[0]}) — दाम डालें ताकि ग्राहक देख सकें।` : `• ${f.noPrice.length} available plot${f.noPrice.length === 1 ? ' has' : 's have'} no price (e.g. ${f.noPrice[0]}). Add prices so customers can see them.`);
    return lines.slice(0, 5).join('\n');
}

export default route(['POST'], async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readJson(req);
    const lang = body.lang === 'hi' ? 'hi' : 'en';

    if (body.task === 'ask') {
        const question = cleanText(body.question, 300);
        if (!question) throw badRequest('Please type a question');
        const units = Array.isArray(body.units) ? compact(body.units) : [];
        const ids = new Set(units.map(u => u.id));
        if (aiEnabled()) {
            try {
                const out = await askJson({
                    system: ASK_SYSTEM, schema: ASK_SCHEMA, maxTokens: 1500,
                    user: `Stock:\n${JSON.stringify(units)}\n\nQuestion: ${question}`,
                });
                return send(res, 200, { answer: out.answer, unitIds: out.unitIds.filter(id => ids.has(String(id))), ai: true });
            } catch (e) { console.error('[ai] ask failed, using rules', e.message); }
        }
        const want = parseAsk(question);
        const matches = filterUnits(units, want);
        return send(res, 200, { answer: describeAsk(want, matches, lang), unitIds: matches.slice(0, 40).map(u => u.id), ai: false });
    }

    if (body.task === 'brief') {
        const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
        if (aiEnabled()) {
            try {
                const text = await askText({ system: BRIEF_SYSTEM, user: JSON.stringify({ lang, ...facts }), maxTokens: 600 });
                if (text) return send(res, 200, { text, ai: true });
            } catch (e) { console.error('[ai] brief failed, using template', e.message); }
        }
        return send(res, 200, { text: briefFallback(facts, lang), ai: false });
    }

    throw badRequest('Unknown task');
});
