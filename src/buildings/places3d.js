// Map-style pins for nearby places (hospitals, schools, airport…) in the 3D scene. Pins are
// light HTML overlays projected from their real positions each time the scene renders, so
// they stay crisp and tappable on phones. Labels that would overlap collapse to small dots.
import { Object3D, Vector3, MathUtils } from 'three';
import { KINDS } from '../shared/place-kinds.js';
import { society } from './society.js';
import { placeFrom } from './geo.js';

const FT = 3.28084;
const PIN_HEIGHT_M = 30; // pins float above the ground point on a thin stem
// Far places are pinned in their true direction but no further than this from the society,
// so they ring the site in view; the label always shows the real drive time / distance.
const RING_M = 200;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const shortName = (s) => (s.length > 24 ? `${s.slice(0, 22).trim()}…` : s);

export function createPlaceMarkers({ el, camera, places, onPick }) {
    // Same frame as the surroundings: metres, true north, rotated into the site frame
    const anchor = new Object3D();
    anchor.scale.setScalar(FT);
    anchor.rotation.y = MathUtils.degToRad(society.siteRotation || 0);
    anchor.updateMatrixWorld(true);

    // Headline places get labels first: quickest of each kind, then the rest by drive time
    const seenKind = new Set();
    const items = places
        .map(p => ({ ...p, ...placeFrom(p.pos) }))
        .sort((a, b) => (a.driveMin ?? 99) - (b.driveMin ?? 99))
        .map(p => {
            const lead = !seenKind.has(p.kind);
            seenKind.add(p.kind);
            return { ...p, priority: lead ? 0 : 1 };
        })
        .sort((a, b) => a.priority - b.priority || (a.driveMin ?? 99) - (b.driveMin ?? 99));

    const layer = document.createElement('div');
    layer.className = 'place-layer';
    el.appendChild(layer);

    items.forEach((p, i) => {
        const k = KINDS[p.kind] || KINDS.park;
        const k2 = Math.min(1, RING_M / Math.max(1, p.km * 1000));
        p.ground = new Vector3(p.east * k2, 0, -p.north * k2).applyMatrix4(anchor.matrixWorld);
        p.top = new Vector3(p.east * k2, PIN_HEIGHT_M, -p.north * k2).applyMatrix4(anchor.matrixWorld);
        const node = document.createElement('div');
        node.className = 'place-pin';
        node.style.setProperty('--c', k.color);
        node.innerHTML = `<span class="pp-stem"></span>
            <button type="button" class="pp-head" data-i="${i}" aria-label="${esc(p.name)}, ${esc(k.label)}, ${p.driveMin ?? '?'} minutes, ${esc(p.dirName)}">
                <span class="pp-icon">${k.icon}</span>
                <span class="pp-arrow" aria-hidden="true"></span>
                <span class="pp-text"><b>${esc(shortName(p.name))}</b><small>${p.driveMin != null ? `${p.driveMin} min` : `${p.km.toFixed(1)} km`} · ${esc(p.dir)}</small></span>
            </button>`;
        p.node = node;
        p.stem = node.querySelector('.pp-stem');
        layer.appendChild(node);
    });

    layer.addEventListener('click', (e) => {
        const head = e.target.closest('.pp-head');
        if (head) onPick?.(items[Number(head.dataset.i)]);
    });

    let visible = true;
    const v = new Vector3();
    const w = new Vector3();
    const c = new Vector3();

    function update() {
        if (!visible) return;
        const W = el.clientWidth, H = el.clientHeight;
        const placed = [];
        const edges = { left: [], right: [] };
        items.forEach(p => {
            v.copy(p.top).project(camera);
            w.copy(p.ground).project(camera);
            const behind = v.z > 1 || v.z < -1;
            const x = (v.x * 0.5 + 0.5) * W;
            let y = (-v.y * 0.5 + 0.5) * H;
            // Ahead of the camera but above the visible band (under the header): pin it along
            // the top edge in its true left–right position, without a stem
            const TOP = 200;
            let clamped = false;
            if (!behind && y < TOP && x > 0 && x < W) { y = TOP; clamped = true; }
            const gy = (-w.y * 0.5 + 0.5) * H;
            // under the header / filter chips counts as out of view
            const off = behind || x < -40 || x > W + 40 || y > H + 40;
            p.node.classList.remove('is-edge', 'edge-left', 'edge-right');
            if (off) {
                // Key places that are out of view get a chip on the side to turn towards
                if (p.priority === 0) {
                    c.copy(p.ground).applyMatrix4(camera.matrixWorldInverse);
                    edges[c.x < 0 ? 'left' : 'right'].push(p);
                } else p.node.hidden = true;
                return;
            }
            p.node.hidden = false;
            // Full label only where it does not collide with a label already placed
            const rect = { l: x - 14, r: x + 150, t: y - 40, b: y + 2 };
            // keep full labels clear of the control column on the right and the bars top/bottom
            const nearUi = rect.r > W - 76 || rect.l < 4 || rect.t < 150 || rect.b > H - 110;
            const clash = nearUi || placed.some(q => rect.l < q.r && rect.r > q.l && rect.t < q.b && rect.b > q.t);
            p.node.classList.toggle('is-dot', clash);
            if (!clash) placed.push(rect);
            p.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
            const stem = clamped ? 0 : Math.max(0, Math.min(140, gy - y));
            p.stem.style.height = `${stem.toFixed(1)}px`;
        });
        // Stack the edge chips just above the bottom controls
        ['left', 'right'].forEach(sideName => {
            edges[sideName].forEach((p, i) => {
                if (i >= 4) { p.node.hidden = true; return; }
                p.node.hidden = false;
                p.node.classList.add('is-edge', `edge-${sideName}`);
                p.node.classList.remove('is-dot');
                const y = H - 150 - i * 44;
                const x = sideName === 'left' ? 12 : W - 80; // right stack sits left of the controls
                p.node.style.transform = `translate(${x}px, ${y}px)`;
                p.stem.style.height = '0px';
            });
        });
    }

    const api = {
        update,
        setVisible(on) {
            visible = on;
            layer.hidden = !on;
            if (on) update();
        },
        get visible() { return visible; },
        items,
    };
    return api;
}
