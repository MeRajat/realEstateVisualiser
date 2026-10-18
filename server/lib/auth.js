// Stateless admin session: cookie = "<expiry>.<hmac(expiry)>".
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { parseCookies, send } from './http.js';

const COOKIE = 'admin_session';
const MAX_AGE = 7 * 24 * 3600; // seconds

function adminPassword() {
    if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
    if (process.env.VERCEL) return null; // never fall back to a default in deployed envs
    return 'admin';
}

function secret() {
    return process.env.SESSION_SECRET || createHash('sha256').update('session:' + (adminPassword() || '')).digest('hex');
}

const sign = (value) => createHmac('sha256', secret()).update(value).digest('hex');

function safeEqual(a, b) {
    const ab = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate) {
    const expected = adminPassword();
    if (!expected) throw Object.assign(new Error('ADMIN_PASSWORD is not configured'), { status: 500 });
    // Hash both so the comparison is constant-length
    const h = (s) => createHash('sha256').update(String(s)).digest('hex');
    return safeEqual(h(candidate || ''), h(expected));
}

function cookie(value, maxAge) {
    const secure = process.env.VERCEL ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function startSession(res) {
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
    res.setHeader('Set-Cookie', cookie(`${exp}.${sign(exp)}`, MAX_AGE));
}

export function endSession(res) {
    res.setHeader('Set-Cookie', cookie('', 0));
}

export function isAuthed(req) {
    const token = parseCookies(req)[COOKIE];
    if (!token) return false;
    const [exp, mac] = token.split('.');
    if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
    return safeEqual(mac, sign(exp));
}

// Returns true if the request may proceed; otherwise responds 401.
export function requireAdmin(req, res) {
    if (isAuthed(req)) return true;
    send(res, 401, { error: 'Not signed in' });
    return false;
}
