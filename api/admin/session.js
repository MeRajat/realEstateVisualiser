// GET → { authed }, POST { password } → sign in, DELETE → sign out.
import { route, send, readJson } from '../_lib/http.js';
import { checkPassword, startSession, endSession, isAuthed } from '../_lib/auth.js';

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
    if (req.method === 'GET') return send(res, 200, { authed: isAuthed(req) });
    if (req.method === 'DELETE') {
        endSession(res);
        return send(res, 200, { ok: true });
    }
    const { password } = await readJson(req);
    if (!checkPassword(password)) {
        await new Promise(r => setTimeout(r, 600)); // slow down guessing
        return send(res, 401, { error: 'Incorrect password' });
    }
    startSession(res);
    send(res, 200, { ok: true });
});
