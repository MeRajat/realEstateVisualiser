// Eye-level "walk the site" mode for the 3D plot model (Street-View-like), plus the props that
// make it read as a real place: plot number boards, street lights, entrance gate, approach road,
// trees and neighbourhood houses outside the wall. Scene units are feet (1 plan unit = 1 ft).
import {
    Group, Mesh, InstancedMesh, Object3D, PlaneGeometry, BoxGeometry, CylinderGeometry, RingGeometry,
    MeshLambertMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, Color, Raycaster, Vector2,
    Vector3, MathUtils, DoubleSide,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { features, plots, boundary, GEO, SITE } from '../shared/site.js';
import nearby from '../shared/nearby.json';
import { chooseFacing } from '../shared/house-layout.js';

const EYE = 5.6;           // ft above the road surface
const WALK_SPEED = 16;     // ft/s for tap-to-move and held buttons
const LOOK_SPEED = 0.0045; // rad per px dragged
const FT_PER_M = 1 / 0.3048;

export function pointInPolygon([x, y], pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function rng(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

// ─── Entrance geometry (plan coordinates) ────────────
export const GATE = GEO.gate;                                  // on the east wall, 9 MT road
const APPROACH_FT = nearby.approach.lengthM * FT_PER_M;
export const APPROACH_END = [GATE[0] + APPROACH_FT, GATE[1]];  // where it meets the main road
const mainRoad = features.filter(f => f.kind === 'road').find(r => r.box.minY <= GATE[1] && r.box.maxY >= GATE[1] && r.box.w > r.box.h);
const GATE_HALF = mainRoad ? (mainRoad.box.h / 2) + 6 : 12;

/** Walkable = inside the boundary wall, or on the approach road out to the main road. */
export function walkable([x, y]) {
    if (pointInPolygon([x, y], boundary.points)) return true;
    return x >= GATE[0] - 2 && x <= APPROACH_END[0] - 10 && Math.abs(y - GATE[1]) <= GATE_HALF;
}

// ─── PROPS ───────────────────────────────────────────
function signAtlas(list) {
    const COLS = 8, CW = 128, CH = 64;
    const rows = Math.ceil(list.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CW;
    canvas.height = rows * CH;
    const ctx = canvas.getContext('2d');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    list.forEach((p, i) => {
        const x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
        ctx.fillStyle = '#f4f1e8';
        ctx.fillRect(x, y, CW, CH);
        ctx.fillStyle = p.status === 'Available' ? '#2e7d32' : '#6b7280';
        ctx.fillRect(x, y + CH - 16, CW, 16);
        ctx.strokeStyle = '#2b2b2b';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 2, y + 2, CW - 4, CH - 4);
        ctx.fillStyle = '#1b1b1b';
        ctx.font = '800 30px Outfit, system-ui, sans-serif';
        ctx.fillText(p.id, x + CW / 2, y + 23);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px Outfit, system-ui, sans-serif';
        ctx.fillText(p.status.toUpperCase(), x + CW / 2, y + CH - 8);
    });
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, cell: (i) => ({ u0: (i % COLS) / COLS, v1: 1 - Math.floor(i / COLS) / rows, du: 1 / COLS, dv: 1 / rows }) };
}

// Board stands just inside the plot's road-facing edge, facing the road.
function signPose(p) {
    const f = p.facing[0]?.dir || 'South';
    const b = p.box;
    const [cx, cy] = p.center;
    switch (f) {
        case 'North': return { x: cx, y: b.minY + 2.5, rot: Math.PI };
        case 'East': return { x: b.maxX - 2.5, y: cy, rot: Math.PI / 2 };
        case 'West': return { x: b.minX + 2.5, y: cy, rot: -Math.PI / 2 };
        default: return { x: cx, y: b.maxY - 2.5, rot: 0 };
    }
}

function gateSignTexture() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d3b2a';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.strokeStyle = '#d9b860';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 1008, 112);
    ctx.fillStyle = '#f3e3b3';
    ctx.font = '800 64px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SITE.name.toUpperCase(), 512, 68);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
}

export function buildProps(site) {
    const group = new Group();
    group.name = 'site-props';
    const dummy = new Object3D();
    const rand = rng(7);

    // Plot number boards (one merged mesh, one texture atlas) + posts (instanced)
    const atlas = signAtlas(plots);
    const boards = plots.map((p, i) => {
        const g = new PlaneGeometry(3.4, 1.7);
        const { u0, v1, du, dv } = atlas.cell(i);
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * du, v1 - dv + uv.getY(k) * dv);
        const { x, y, rot } = signPose(p);
        g.rotateY(rot);
        g.translate(x, 4.6, y);
        return g;
    });
    const boardMesh = new Mesh(mergeGeometries(boards), new MeshLambertMaterial({ map: atlas.tex, side: DoubleSide }));
    boardMesh.castShadow = true;
    group.add(boardMesh);
    const posts = new InstancedMesh(new CylinderGeometry(0.12, 0.12, 4.6, 6).translate(0, 2.3, 0), new MeshLambertMaterial({ color: 0x444444 }), plots.length);
    plots.forEach((p, i) => {
        const { x, y } = signPose(p);
        dummy.position.set(x, 0, y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        posts.setMatrixAt(i, dummy.matrix);
    });
    group.add(posts);

    // Street lights along each internal road, alternating sides every ~70 ft
    const lightSpots = [];
    features.filter(f => f.kind === 'road').forEach(r => {
        const horizontal = r.box.w > r.box.h;
        const len = horizontal ? r.box.w : r.box.h;
        for (let t = 30, k = 0; t < len - 20; t += 70, k++) {
            const side = k % 2 ? 1 : -1;
            if (horizontal) lightSpots.push({ x: r.box.minX + t, y: side > 0 ? r.box.maxY + 0.8 : r.box.minY - 0.8, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
            else lightSpots.push({ x: side > 0 ? r.box.maxX + 0.8 : r.box.minX - 0.8, y: r.box.minY + t, rot: side > 0 ? Math.PI : 0 });
        }
    });
    const lampGeo = mergeGeometries([
        new CylinderGeometry(0.22, 0.32, 20, 6).translate(0, 10, 0),
        new BoxGeometry(5, 0.3, 0.3).translate(-2.5, 19.6, 0),
        new BoxGeometry(1.8, 0.4, 0.9).translate(-4.8, 19.4, 0),
    ]);
    const lamps = new InstancedMesh(lampGeo, new MeshLambertMaterial({ color: 0x8d949a }), lightSpots.length);
    lightSpots.forEach((s, i) => {
        dummy.position.set(s.x, 0, s.y);
        dummy.rotation.set(0, s.rot, 0);
        dummy.updateMatrix();
        lamps.setMatrixAt(i, dummy.matrix);
    });
    lamps.castShadow = true;
    group.add(lamps);

    // Approach road (gate → main road) and entrance arch with the colony's name
    const roadMat = new MeshLambertMaterial({ color: 0x3a3d3b });
    const approach = new Mesh(new PlaneGeometry(APPROACH_FT + 4, GATE_HALF * 2 - 2), roadMat);
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(GATE[0] + APPROACH_FT / 2, 0.45, GATE[1]);
    approach.receiveShadow = true;
    group.add(approach);

    const stone = new MeshLambertMaterial({ color: 0xcdb48a });
    const pillarGeo = new BoxGeometry(3.5, 20, 3.5).translate(0, 10, 0);
    [-1, 1].forEach(s => {
        const pillar = new Mesh(pillarGeo, stone);
        pillar.position.set(GATE[0], 0, GATE[1] + s * GATE_HALF);
        pillar.castShadow = true;
        group.add(pillar);
    });
    const beam = new Mesh(new BoxGeometry(2.6, 3.2, GATE_HALF * 2 + 3.5), stone);
    beam.position.set(GATE[0], 20.5, GATE[1]);
    beam.castShadow = true;
    group.add(beam);
    const signTex = gateSignTexture();
    [1, -1].forEach(s => {
        const board = new Mesh(new PlaneGeometry(GATE_HALF * 2, 2.6), new MeshBasicMaterial({ map: signTex }));
        board.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
        board.position.set(GATE[0] + s * 1.35, 20.5, GATE[1]);
        group.add(board);
    });

    // Scrub trees on the open land outside the wall + low-rise houses across the main road
    const treeSpots = [];
    const { minX, maxX, minY, maxY } = boundary.box;
    for (let i = 0; i < 900 && treeSpots.length < 320; i++) {
        const x = minX - 650 + rand() * (maxX - minX + 1300);
        const y = minY - 650 + rand() * (maxY - minY + 1300);
        if (pointInPolygon([x, y], boundary.points)) continue;
        if (x > APPROACH_END[0] - 70) continue; // main road + the built-up strip beyond it
        if (x > GATE[0] - 5 && Math.abs(y - GATE[1]) < GATE_HALF + 8) continue; // approach road
        // keep a clear strip just outside the wall
        const nearWall = x > minX - 14 && x < maxX + 14 && y > minY - 14 && y < maxY + 14;
        if (nearWall) continue;
        treeSpots.push([x, y, 0.8 + rand() * 0.9]);
    }
    const houses = [];
    for (let y = minY - 500; y < maxY + 500; y += 38 + rand() * 30) {
        if (rand() < 0.25) continue;
        const w = 30 + rand() * 25, d = 35 + rand() * 30, h = 11 * (1 + Math.floor(rand() * 3)) + 3;
        houses.push({ x: APPROACH_END[0] + 70 + rand() * 40 + d / 2, y, w, d, h });
        if (rand() < 0.7) houses.push({ x: APPROACH_END[0] + 200 + rand() * 260, y: y + rand() * 20, w: w * 0.9, d, h: h + (rand() < 0.15 ? 22 : 0) });
    }
    const houseMesh = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new MeshLambertMaterial({ color: 0xffffff }), houses.length);
    const palette = [0xe9dcc3, 0xf2efe6, 0xe7c9b0, 0xd9b99b, 0xefe4d0, 0xe3a993];
    const col = new Color();
    houses.forEach((hs, i) => {
        dummy.position.set(hs.x, 0, hs.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(hs.d, hs.h, hs.w);
        dummy.updateMatrix();
        houseMesh.setMatrixAt(i, dummy.matrix);
        houseMesh.setColorAt(i, col.setHex(palette[i % palette.length]));
    });
    houseMesh.castShadow = true;
    group.add(houseMesh);

    site.add(group);
    return { treeSpots, ground: [approach] };
}

// ─── WALK CONTROLLER ─────────────────────────────────
export function createWalk({ el, renderer, camera, controls, site, plotMeshes, groundMeshes, requestRender, selectPlot, onChange }) {
    const offset = new Vector3(-GEO.centerX, 0, -GEO.centerY); // plan → scene
    const toScene = (x, y, h = 0) => new Vector3(x, h, y).add(offset);
    const toPlan = (v) => [v.x - offset.x, v.z - offset.z];

    const state = { active: false, yaw: Math.PI / 2, pitch: -0.04, pos: new Vector3(), tween: null, keys: new Set(), hold: 0 };
    let saved = null;
    let last = 0;

    // Target ring (where a tap will take you)
    const ring = new Mesh(new RingGeometry(1.2, 1.7, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 10;
    ring.visible = false;
    site.parent.add(ring);

    // HUD
    const hud = document.createElement('div');
    hud.className = 'walk-hud';
    hud.hidden = true;
    hud.innerHTML = `
        <p class="walk-hint">Drag to look around · tap the road to walk · tap a plot to visit it</p>
        <div class="walk-pad">
            <button type="button" data-move="1" aria-label="Walk forward">▲</button>
            <button type="button" data-move="-1" aria-label="Walk back">▼</button>
        </div>
        <button type="button" class="walk-exit">Exit walk</button>`;
    el.appendChild(hud);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'walk-toggle';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="13" cy="4" r="2" fill="currentColor"/><path d="m9 21 2-6 3 3v3m-6-9 3-3 3 2 3 1M11 9l-1 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Walk the site';
    el.appendChild(toggle);

    function applyCamera() {
        camera.position.copy(state.pos);
        camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
    }

    function enter(from) {
        if (state.active) return;
        saved = { pos: camera.position.clone(), quat: camera.quaternion.clone(), target: controls.target.clone(), fov: camera.fov };
        state.active = true;
        controls.enabled = false;
        const start = from || [GATE[0] - 24, GATE[1]];
        state.pos.copy(toScene(start[0], start[1], EYE));
        state.yaw = Math.PI / 2; // looking along plan-west, down the main internal road
        state.pitch = -0.04;
        camera.fov = 62;
        camera.near = 0.5;
        camera.updateProjectionMatrix();
        applyCamera();
        hud.hidden = false;
        toggle.hidden = true;
        el.classList.add('is-walking');
        onChange?.(true);
        requestRender();
    }

    function exit() {
        if (!state.active) return;
        state.active = false;
        state.tween = null;
        state.keys.clear();
        state.hold = 0;
        ring.visible = false;
        camera.position.copy(saved.pos);
        camera.quaternion.copy(saved.quat);
        camera.fov = saved.fov;
        camera.near = 5;
        camera.updateProjectionMatrix();
        controls.target.copy(saved.target);
        controls.enabled = true;
        controls.update();
        hud.hidden = true;
        toggle.hidden = false;
        el.classList.remove('is-walking');
        onChange?.(false);
        requestRender();
    }

    function walkTo(planPt, yaw = null) {
        if (!walkable(planPt)) return false;
        const to = toScene(planPt[0], planPt[1], EYE);
        const dist = state.pos.distanceTo(to);
        state.tween = {
            t0: performance.now(),
            dur: MathUtils.clamp((dist / WALK_SPEED) * 1000, 350, 2600),
            from: state.pos.clone(), to,
            yaw0: state.yaw,
            yaw1: yaw == null ? state.yaw : state.yaw + MathUtils.euclideanModulo(yaw - state.yaw + Math.PI, Math.PI * 2) - Math.PI,
        };
        requestRender();
        return true;
    }

    // Stand on the road in front of a plot, facing it (further back, looking up a little, to take in a house)
    function visitPlot(p, { distance = 14, lookUp = 0 } = {}) {
        const f = chooseFacing(p); // the road the suggested house faces
        const [cx, cy] = p.center;
        const b = p.box;
        // Straight back from the plot if there is room; otherwise stand on the road off to one
        // side so the house is seen at an angle (a wall or plots may be right behind you)
        const out = { North: [0, -1], South: [0, 1], East: [1, 0], West: [-1, 0] }[f];
        const edge = { North: [cx, b.minY], South: [cx, b.maxY], East: [b.maxX, cy], West: [b.minX, cy] }[f];
        const along = [Math.abs(out[1]), Math.abs(out[0])];
        const candidates = [
            [edge[0] + out[0] * distance + along[0] * 5, edge[1] + out[1] * distance + along[1] * 5],
            ...(distance > 14 ? [35, -35, 22, -22].map(o => [edge[0] + out[0] * 8 + along[0] * o, edge[1] + out[1] * 8 + along[1] * o]) : []),
            [edge[0] + out[0] * 14 + along[0] * 5, edge[1] + out[1] * 14 + along[1] * 5],
        ];
        const stand = candidates.find(walkable) || candidates[candidates.length - 1];
        const yaw = Math.atan2(-(cx - stand[0]), -(cy - stand[1]));
        if (!state.active) enter(stand);
        walkTo(stand, yaw);
        state.pitch = lookUp;
    }

    // ─── Input ───────────────────────────────────────
    const ray = new Raycaster();
    const ndc = new Vector2();
    let down = null;

    function pick(e, targets) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        return ray.intersectObjects(targets, false)[0];
    }

    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
        if (!state.active) return;
        down = { x: e.clientX, y: e.clientY, moved: false };
        canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!state.active) return;
        if (down) {
            const dx = e.clientX - down.x, dy = e.clientY - down.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) down.moved = true;
            if (down.moved) {
                state.yaw += (e.movementX || 0) * LOOK_SPEED;
                state.pitch = MathUtils.clamp(state.pitch + (e.movementY || 0) * LOOK_SPEED, -0.75, 0.6);
                ring.visible = false;
                applyCamera();
                requestRender();
            }
        } else if (e.pointerType === 'mouse') {
            const hit = pick(e, groundMeshes);
            const ok = hit && walkable(toPlan(hit.point));
            ring.visible = !!ok;
            if (ok) ring.position.set(hit.point.x, hit.point.y + 0.3, hit.point.z);
            requestRender();
        }
    });
    canvas.addEventListener('pointerup', (e) => {
        if (!state.active || !down) return;
        const tap = !down.moved;
        down = null;
        if (!tap) return;
        const plotHit = pick(e, plotMeshes);
        if (plotHit) {
            const p = plotHit.object.userData.plot;
            selectPlot(p.id, 'walk');
            visitPlot(p);
            return;
        }
        const hit = pick(e, groundMeshes);
        if (hit) {
            const pt = toPlan(hit.point);
            if (walkTo(pt)) {
                ring.visible = true;
                ring.position.set(hit.point.x, hit.point.y + 0.3, hit.point.z);
            }
        }
    });
    canvas.addEventListener('pointerleave', () => { ring.visible = false; requestRender(); });

    const KEYMAP = { ArrowUp: 1, KeyW: 1, ArrowDown: -1, KeyS: -1, ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };
    window.addEventListener('keydown', (e) => {
        if (!state.active || !(e.code in KEYMAP) || document.querySelector('dialog[open]')) return;
        if (e.target.closest?.('input, textarea')) return;
        state.keys.add(e.code);
        e.preventDefault();
        requestRender();
    });
    window.addEventListener('keyup', (e) => state.keys.delete(e.code));
    window.addEventListener('blur', () => state.keys.clear());

    hud.querySelectorAll('[data-move]').forEach(b => {
        const dir = Number(b.dataset.move);
        const start = (e) => { e.preventDefault(); state.hold = dir; requestRender(); };
        const stop = () => { state.hold = 0; };
        b.addEventListener('pointerdown', start);
        b.addEventListener('pointerup', stop);
        b.addEventListener('pointerleave', stop);
        b.addEventListener('pointercancel', stop);
    });
    hud.querySelector('.walk-exit').addEventListener('click', exit);
    toggle.addEventListener('click', () => enter());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.active && !document.querySelector('dialog[open]')) exit(); });

    // ─── Per-frame update; returns true while still moving ───
    function update(now) {
        if (!state.active) return false;
        const dt = Math.min(0.05, (now - (last || now)) / 1000);
        last = now;
        let moving = false;

        if (state.tween) {
            const t = Math.min(1, (now - state.tween.t0) / state.tween.dur);
            const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            state.pos.lerpVectors(state.tween.from, state.tween.to, e);
            state.yaw = MathUtils.lerp(state.tween.yaw0, state.tween.yaw1, e);
            // gentle head bob
            state.pos.y = EYE + Math.sin(e * Math.PI * Math.max(1, state.tween.dur / 450)) * 0.12;
            if (t >= 1) { state.tween = null; ring.visible = false; }
            moving = true;
        }

        let forward = state.hold;
        let turn = 0;
        state.keys.forEach(k => {
            const v = KEYMAP[k];
            if (v === 'L') turn += 1; else if (v === 'R') turn -= 1; else forward += v;
        });
        if (turn) { state.yaw += turn * 1.6 * dt; moving = true; }
        if (forward) {
            state.tween = null;
            const step = Math.sign(forward) * WALK_SPEED * dt;
            const next = state.pos.clone().add(new Vector3(-Math.sin(state.yaw) * step, 0, -Math.cos(state.yaw) * step));
            if (walkable(toPlan(next))) state.pos.copy(next);
            moving = true;
        }
        applyCamera();
        if (!moving) last = 0;
        return moving;
    }

    return {
        get active() { return state.active; },
        enter, exit, visitPlot, update,
    };
}
