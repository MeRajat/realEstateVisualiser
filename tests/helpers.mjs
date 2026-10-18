// Minimal req/res fakes so Vercel-style handlers run under node:test without a server.
import { EventEmitter } from 'node:events';

export function call(handler, { method = 'GET', url = '/', body, headers = {} } = {}) {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    req.headers = { 'user-agent': 'test', ...headers };
    if (body !== undefined) req.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = { statusCode: 200, headers: {}, body: '' };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    return new Promise((resolve) => {
        res.end = (chunk) => { res.body = chunk || ''; let json = null; try { json = JSON.parse(res.body); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, body: res.body }); };
        handler(req, res);
    });
}

export async function adminCookie() {
    const { default: session } = await import('../server/admin/session.js');
    const r = await call(session, { method: 'POST', body: { password: 'admin' } });
    const cookie = r.headers['set-cookie'].split(';')[0];
    return { cookie };
}
