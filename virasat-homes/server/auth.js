// Admin sign-in for the Virasat Homes dashboard. Separate cookie from the main dashboard so each
// project can have its own password: VIRASAT_ADMIN_PASSWORD, falling back to ADMIN_PASSWORD.
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { parseCookies, send } from '../../server/lib/http.js';

const COOKIE = 'vh_admin';
const MAX_AGE = 7 * 24 * 3600;

function password() {
    const p = process.env.VIRASAT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;
    if (p) return p;
    return process.env.VERCEL ? null : 'admin'; // never a default password on Vercel
}

const secret = () => createHash('sha256').update('virasat:' + (process.env.SESSION_SECRET || '') + ':' + (password() || '')).digest('hex');
const sign = (v) => createHmac('sha256', secret()).update(v).digest('hex');
const h = (s) => createHash('sha256').update(String(s)).digest();

export function checkPassword(candidate) {
    const expected = password();
    if (!expected) throw Object.assign(new Error('Admin password is not configured'), { status: 500 });
    return timingSafeEqual(h(candidate || ''), h(expected));
}

const cookie = (value, maxAge) =>
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.VERCEL ? '; Secure' : ''}`;

export function startSession(res) {
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
    res.setHeader('Set-Cookie', cookie(`${exp}.${sign(exp)}`, MAX_AGE));
}

export const endSession = (res) => res.setHeader('Set-Cookie', cookie('', 0));

export function isAuthed(req) {
    const [exp, mac] = String(parseCookies(req)[COOKIE] || '').split('.');
    if (!exp || !mac || Number(exp) < Date.now() / 1000) return false;
    const a = Buffer.from(mac);
    const b = Buffer.from(sign(exp));
    return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAdmin(req, res) {
    if (isAuthed(req)) return true;
    send(res, 401, { error: 'Not signed in' });
    return false;
}
