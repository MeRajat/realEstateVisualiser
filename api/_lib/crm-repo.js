// CRM extras: activity log per lead (calls, WhatsApp, visits, notes), lost reasons, assignment,
// settings (message templates, team) and push subscriptions. Attached to the main repo in db.js.

export const ACTIVITY_TYPES = ['call', 'whatsapp', 'visit', 'note', 'status', 'assign'];
export const CALL_OUTCOMES = ['answered', 'no_answer', 'busy', 'wrong_number'];
export const VISIT_OUTCOMES = ['scheduled', 'done', 'no_show', 'cancelled'];
export const LOST_REASONS = ['budget', 'location', 'size', 'wants_ready', 'bought_elsewhere', 'no_response', 'loan', 'timing', 'other'];

export const DEFAULT_SETTINGS = {
    team: [],
    templates: [
        { id: 'first', name: 'First reply', en: 'Namaste {name} ji, thank you for your interest in {site}. I am {me} from the sales team. {plot_line}May I share the price list and a short video? When can I call you?', hi: 'नमस्ते {name} जी, {site} में रुचि के लिए धन्यवाद। मैं सेल्स टीम से {me} हूँ। {plot_line}क्या मैं प्राइस लिस्ट और छोटा वीडियो भेज दूँ? आपको कॉल कब करूँ?' },
        { id: 'visit', name: 'Site visit invite', en: 'Namaste {name} ji, come and see {site} this weekend — the plots look very different in person. Which day suits you, Saturday or Sunday? Location: {link}', hi: 'नमस्ते {name} जी, इस वीकेंड {site} देखने आइए — प्लॉट सामने देखकर अलग ही लगते हैं। शनिवार या रविवार, कौन सा दिन ठीक रहेगा? लोकेशन: {link}' },
        { id: 'reminder', name: 'Visit reminder', en: 'Reminder: your site visit at {site} is tomorrow. Our team will meet you at the site office. Call {me} on arrival. Location: {link}', hi: 'याद दिलाना: {site} की आपकी साइट विज़िट कल है। हमारी टीम साइट ऑफ़िस पर मिलेगी। पहुँचकर {me} को कॉल करें। लोकेशन: {link}' },
        { id: 'after', name: 'After the visit', en: 'Thank you for visiting {site}, {name} ji. {plot_line}Shall I hold it for you for 2 days while you decide? Happy to answer any question.', hi: '{site} देखने आने के लिए धन्यवाद, {name} जी। {plot_line}क्या मैं इसे 2 दिन के लिए आपके लिए होल्ड कर दूँ? कोई भी सवाल हो तो बताइए।' },
        { id: 'nudge', name: 'Follow-up nudge', en: 'Namaste {name} ji, just checking in from {site}. Plots in your size are selling fast — would you like today\'s availability? {link}', hi: 'नमस्ते {name} जी, {site} से हाल पूछ रहा हूँ। आपके साइज़ के प्लॉट जल्दी बिक रहे हैं — आज की उपलब्धता भेज दूँ? {link}' },
        { id: 'price', name: 'Price list', en: 'Namaste {name} ji, here is the live plot map with prices for {site}: {link}. Tap any plot to see size, facing and price.', hi: 'नमस्ते {name} जी, {site} का लाइव प्लॉट मैप और दाम: {link}। किसी भी प्लॉट पर टैप करके साइज़, दिशा और दाम देखें।' },
    ],
};

export function crmPg(sql, migrate) {
    return {
        async addActivity({ leadId, type, outcome = null, note = null, actor = null, at = null }) {
            await migrate();
            const [r] = await sql`insert into lead_activities (lead_id, type, outcome, note, actor, created_at)
                values (${leadId}, ${type}, ${outcome}, ${note}, ${actor}, coalesce(${at}::timestamptz, now())) returning id, created_at`;
            return { id: Number(r.id), created_at: r.created_at };
        },
        async leadActivities(leadId, limit = 60) {
            await migrate();
            const rows = await sql`select id, type, outcome, note, actor, created_at from lead_activities where lead_id = ${leadId} order by created_at desc limit ${limit}`;
            return rows.map(r => ({ ...r, id: Number(r.id) }));
        },
        async activitiesSince(since) {
            await migrate();
            const rows = await sql`select lead_id, type, outcome, created_at from lead_activities where created_at >= ${since}::timestamptz order by created_at desc limit 20000`;
            return rows.map(r => ({ ...r, lead_id: Number(r.lead_id) }));
        },
        async getSettings() {
            await migrate();
            const rows = await sql`select key, value from settings`;
            const out = { ...DEFAULT_SETTINGS };
            rows.forEach(r => { out[r.key] = r.value; });
            return out;
        },
        async setSetting(key, value) {
            await migrate();
            await sql`insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
                on conflict (key) do update set value = excluded.value, updated_at = now()`;
        },
        async addPushSubscription(sub, label) {
            await migrate();
            await sql`insert into push_subscriptions (endpoint, subscription, label) values (${sub.endpoint}, ${JSON.stringify(sub)}::jsonb, ${label})
                on conflict (endpoint) do update set subscription = excluded.subscription, label = excluded.label`;
        },
        async listPushSubscriptions() {
            await migrate();
            return (await sql`select endpoint, subscription from push_subscriptions`).map(r => r.subscription);
        },
        async removePushSubscription(endpoint) {
            await migrate();
            await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
        },
    };
}

export function crmMemory() {
    const activities = [];
    const settings = {};
    const subs = new Map();
    let next = 1;
    const now = () => new Date().toISOString();
    return {
        _activities: activities, _nextId: () => next++,
        async addActivity({ leadId, type, outcome = null, note = null, actor = null, at = null }) {
            const row = { id: next++, lead_id: leadId, type, outcome, note, actor, created_at: at || now() };
            activities.push(row);
            return { id: row.id, created_at: row.created_at };
        },
        async leadActivities(leadId, limit = 60) {
            return activities.filter(a => a.lead_id === leadId).slice().reverse().slice(0, limit).map(({ id, type, outcome, note, actor, created_at }) => ({ id, type, outcome, note, actor, created_at }));
        },
        async activitiesSince(since) {
            return activities.filter(a => a.created_at >= since).map(({ lead_id, type, outcome, created_at }) => ({ lead_id, type, outcome, created_at }));
        },
        async getSettings() { return { ...DEFAULT_SETTINGS, ...settings }; },
        async setSetting(key, value) { settings[key] = value; },
        async addPushSubscription(sub) { subs.set(sub.endpoint, sub); },
        async listPushSubscriptions() { return [...subs.values()]; },
        async removePushSubscription(endpoint) { subs.delete(endpoint); },
    };
}
