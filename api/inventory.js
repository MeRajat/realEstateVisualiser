// GET /api/inventory — live stock for the customer site: which plots/flats are on hold, booked,
// sold or not for sale, plus which ones are in demand. No customer details are ever returned.
import { getRepo } from './_lib/db.js';
import { route, send } from './_lib/http.js';
import { demandTier } from './_lib/inventory.js';

export default route(['GET'], async (req, res) => {
    const repo = getRepo();
    const [units, demand] = await Promise.all([repo.publicUnits(), repo.unitDemand(7)]);
    const hot = Object.entries(demand).filter(([, d]) => demandTier(d) === 'hot').map(([id, d]) => ({ id, people: d.people }));
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ units, hot, updatedAt: new Date().toISOString() }));
});
