// Live stock: the builder changes plot status in the dashboard; this keeps the customer site in sync
// (plan, 3D, map, detail sheet) without a redeploy. Polls gently while the tab is visible.
import { applyInventory } from './store.js';

const POLL_MS = 60000;

export async function fetchInventory() {
    const res = await fetch('/api/inventory', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`inventory ${res.status}`);
    return res.json();
}

export function startLiveInventory({ onUpdate } = {}) {
    let timer = 0;
    let last = '';
    const tick = async () => {
        try {
            const data = await fetchInventory();
            const sig = JSON.stringify([data.units, data.hot]);
            if (sig !== last) {
                last = sig;
                applyInventory(data);
                onUpdate?.(data);
            }
        } catch { /* keep showing the last known stock */ }
    };
    const schedule = () => {
        clearTimeout(timer);
        if (document.visibilityState === 'visible') timer = setTimeout(async () => { await tick(); schedule(); }, POLL_MS);
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); } schedule(); });
    tick().then(schedule);
    return { refresh: tick };
}
