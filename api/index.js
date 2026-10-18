// The single Vercel function: vercel.json rewrites every /api/* request here (as /api/index?p=<path>)
// and server/router.js dispatches it to the right handler.
import { route } from '../server/router.js';

export const config = { maxDuration: 60 };

export default function handler(req, res) {
    return route(req, res);
}
