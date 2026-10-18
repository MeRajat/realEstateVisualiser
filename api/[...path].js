// The single Vercel function: every /api/* request is dispatched by server/router.js.
import { route } from '../server/router.js';

export const config = { maxDuration: 60 };

export default function handler(req, res) {
    return route(req, res);
}
