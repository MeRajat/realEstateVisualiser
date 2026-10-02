// Tiny helpers so handlers work both on Vercel and in the Vite dev middleware.

export function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

export async function readJson(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') return safeParse(req.body);
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024) throw Object.assign(new Error('Payload too large'), { status: 413 });
        chunks.push(chunk);
    }
    return safeParse(Buffer.concat(chunks).toString('utf8'));
}

function safeParse(text) {
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export function parseCookies(req) {
    const out = {};
    (req.headers.cookie || '').split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

// Wraps a handler: method check + uniform error responses.
export function route(methods, handler) {
    return async (req, res) => {
        if (!methods.includes(req.method)) {
            res.setHeader('Allow', methods.join(', '));
            return send(res, 405, { error: 'Method not allowed' });
        }
        try {
            await handler(req, res);
        } catch (err) {
            console.error(err);
            send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
        }
    };
}

export const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

export const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;
export const PLOT_ID = /^[\w .-]{1,30}$/;

export function cleanText(value, max) {
    if (value == null) return null;
    const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
    return s || null;
}

// Indian mobile: optional +91 / 91 / 0 prefix, then 10 digits starting 6-9.
export function normalisePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    const local = digits.replace(/^(91|0)(?=\d{10}$)/, '');
    return /^[6-9]\d{9}$/.test(local) ? local : null;
}
