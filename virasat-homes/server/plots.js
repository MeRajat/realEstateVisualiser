// Plot list for the API, read from the same layout file the website draws.
import { readFileSync } from 'node:fs';

const layout = JSON.parse(readFileSync(new URL('../data/layout.json', import.meta.url), 'utf8'));

export const PLOTS = layout.plots.map(p => ({ id: p.id, areaSqYd: p.areaSqYd, category: p.category }));
export const PLOT_IDS = PLOTS.map(p => p.id);
export const plotById = new Map(PLOTS.map(p => [p.id, p]));
export const isPlotId = (id) => typeof id === 'string' && plotById.has(id);

// Plot ids sort as numbers first (1, 2 … 190), then L1 … L24, then E1 … E24.
export function plotOrder(a, b) {
    const k = (id) => {
        const m = /^([A-Z]?)(\d+)$/.exec(id) || [];
        return [{ '': 0, L: 1, E: 2 }[m[1]] ?? 3, Number(m[2]) || 0];
    };
    const [ka, kb] = [k(a), k(b)];
    return ka[0] - kb[0] || ka[1] - kb[1];
}
