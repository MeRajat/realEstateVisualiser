// Lightweight 3D site model (three.js). Lazy-loaded the first time the 3D tab opens.
// Renders on demand only — no continuous loop while the scene is idle.
import {
    WebGLRenderer, Scene, PerspectiveCamera, Color, Fog,
    Group, Shape, ExtrudeGeometry, ShapeGeometry, PlaneGeometry, BoxGeometry, IcosahedronGeometry,
    CylinderGeometry, Mesh, MeshLambertMaterial, InstancedMesh, Object3D, CanvasTexture,
    SRGBColorSpace, Raycaster, Vector2, Vector3, MathUtils, PCFSoftShadowMap, ACESFilmicToneMapping,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { features, plots, boundary, GEO } from '../shared/site.js';
import { state, on, selectPlot, matchesFilter } from './store.js';
import { satelliteGround, createSky } from '../shared/geo3d.js';
import { buildProps, createWalk } from './walk.js';

const PLOT_H = 3;
const LIFT = 5;
const TEX_SCALE = 2; // texture pixels per data unit (1 unit = 1 ft)
const TEX_W = 700;
const TEX_H = 950;

const C = {
    bg: 0x0b0f0d,
    ground: 0x18211c,
    base: 0x5b6440, // dry grass — reads as open land at eye level
    phase: 0x2f4a33,
    common: 0x3d7a3c,
    wall: 0xd9cfb6,
    Available: 0x55b85a,
    Sold: 0x8a948f,
    Reserved: 0xc4a254,
    selected: 0x2dd4bf,
    dim: 0x313a35,
};

function shapeOf(points) {
    const s = new Shape();
    // Flip y so that after rotateX(-90°) data y maps onto +z (south toward the camera)
    points.forEach(([x, y], i) => (i ? s.lineTo(x, -y) : s.moveTo(x, -y)));
    return s;
}

function flat(geometry) {
    return geometry.rotateX(-Math.PI / 2);
}

// Shrink an (approximately rectangular) plot so neighbours read as separate blocks
function inset(points, box, amount) {
    const cx = (box.minX + box.maxX) / 2;
    const cy = (box.minY + box.maxY) / 2;
    const sx = Math.max(0.5, (box.w - amount * 2) / box.w);
    const sy = Math.max(0.5, (box.h - amount * 2) / box.h);
    return points.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}

function pointInPolygon([x, y], pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

// Deterministic PRNG so the trees land in the same place every load
function rng(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

// One canvas holding plot numbers (dark on white, multiplied by each plot's colour)
// and road names (white on asphalt). Mapped onto cap faces via world-space UVs.
function buildLabelTexture(renderer) {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W * TEX_SCALE;
    canvas.height = TEX_H * TEX_SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(TEX_SCALE, TEX_SCALE);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    features.filter(f => f.kind === 'road').forEach(r => {
        ctx.fillStyle = '#2b302d';
        ctx.beginPath();
        r.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
    });
    // Road centre dashes + names
    features.filter(f => f.kind === 'road').forEach(r => {
        const vertical = r.box.h > r.box.w;
        ctx.save();
        ctx.translate(r.center[0], r.center[1]);
        if (vertical) ctx.rotate(-Math.PI / 2);
        const len = vertical ? r.box.h : r.box.w;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 0.6;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(-len / 2 + 4, 0);
        ctx.lineTo(len / 2 - 4, 0);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = '600 6px Outfit, system-ui, sans-serif';
        const label = ` ${r.id} `;
        const tw = ctx.measureText(label).width;
        const step = Math.max(160, tw * 3);
        for (let x = -len / 2 + step / 2; x < len / 2; x += step) {
            ctx.fillStyle = '#2b302d';
            ctx.fillRect(x - tw / 2, -3.5, tw, 7);
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillText(label, x, 0.3);
        }
        ctx.restore();
    });

    plots.forEach(p => {
        const size = Math.max(7, Math.min(12, Math.min(p.box.w, p.box.h) * 0.42));
        ctx.font = `700 ${size}px Outfit, system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(8, 20, 12, 0.78)';
        ctx.fillText(p.id, p.center[0], p.center[1] + 0.5);
    });

    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // ExtrudeGeometry/ShapeGeometry UVs are the shape's own (x, -y) coordinates
    tex.repeat.set(1 / TEX_W, 1 / TEX_H);
    tex.offset.set(0, 1);
    return tex;
}

export function create3DView(el, { compass } = {}) {
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D site model. Drag to rotate, pinch to zoom, tap a plot for details.');

    const scene = new Scene();
    scene.fog = new Fog(0xc9d3d6, 3000, 26000); // daytime haze toward the horizon

    const camera = new PerspectiveCamera(45, 1, 5, 70000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = MathUtils.degToRad(78);
    controls.minDistance = 60;
    controls.maxDistance = 3200;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;

    // Real sky + sun. Scene -z is plan-north, which points GEO.rotationDeg west of true north,
    // so a true bearing b sits at b + rotationDeg in scene terms. Mid-morning sun from the south-east.
    const { sun } = createSky(scene, { scale: 40000, elevation: 42, azimuth: 140 + GEO.rotationDeg });
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -800, right: 800, top: 800, bottom: -800, near: 10, far: 4000 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    sun.position.multiplyScalar(2);

    const site = new Group();
    site.position.set(-GEO.centerX, 0, -GEO.centerY);
    scene.add(site);

    // Real satellite imagery around the site (metres, true north) → feet, plan-aligned
    const satellite = satelliteGround({
        lat: GEO.lat, lng: GEO.lng, renderer,
        onUpdate: () => { needsRender = true; start(); },
    });
    satellite.scale.setScalar(1 / GEO.metersPerUnit);
    satellite.rotation.y = -MathUtils.degToRad(GEO.rotationDeg);
    satellite.position.y = -1.5;
    scene.add(satellite);

    // Neutral earth under the imagery while tiles load (or if they can't)
    const ground = new Mesh(flat(new PlaneGeometry(60000, 60000)), new MeshLambertMaterial({ color: 0x8a7f66, depthWrite: false }));
    ground.renderOrder = -3;
    ground.position.set(GEO.centerX, -2, GEO.centerY);
    site.add(ground);

    // Site base (grass) + perimeter wall
    const base = new Mesh(
        flat(new ExtrudeGeometry(shapeOf(boundary.points), { depth: 1, bevelEnabled: false })),
        new MeshLambertMaterial({ color: C.base }),
    );
    base.position.y = -1;
    base.receiveShadow = true;
    site.add(base);

    const wallParts = boundary.points.map((p, i) => {
        const q = boundary.points[(i + 1) % boundary.points.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const g = new BoxGeometry(len + 1.5, 7, 1.5);
        g.rotateY(-Math.atan2(q[1] - p[1], q[0] - p[0]));
        g.translate((p[0] + q[0]) / 2, 3.5, (p[1] + q[1]) / 2);
        return g;
    });
    const wall = new Mesh(mergeGeometries(wallParts), new MeshLambertMaterial({ color: C.wall }));
    wall.castShadow = true;
    wall.receiveShadow = true;
    site.add(wall);

    const labelTex = buildLabelTexture(renderer);

    // Roads
    const roadMat = new MeshLambertMaterial({ color: 0xffffff, map: labelTex });
    const roadMeshes = features.filter(f => f.kind === 'road').map(r => {
        const m = new Mesh(flat(new ShapeGeometry(shapeOf(r.points))), roadMat);
        m.position.y = 0.6;
        m.receiveShadow = true;
        site.add(m);
        return m;
    });

    // Common / green areas (the large PHASE-1 block is future land — keep it flat)
    const commons = features.filter(f => f.kind === 'common');
    const commonMeshes = commons.map((f, i) => {
        const big = f.box.w * f.box.h > 0.2 * boundary.box.w * boundary.box.h;
        const g = flat(new ExtrudeGeometry(shapeOf(f.points), { depth: big ? 0.3 : 0.8 + i * 0.1, bevelEnabled: false }));
        const m = new Mesh(g, new MeshLambertMaterial({ color: big ? C.phase : C.common }));
        m.receiveShadow = true;
        site.add(m);
        return m;
    });

    // Plots
    const capBase = new MeshLambertMaterial({ map: labelTex });
    const plotMeshes = plots.map(p => {
        const g = flat(new ExtrudeGeometry(shapeOf(inset(p.points, p.box, 0.9)), { depth: PLOT_H, bevelEnabled: false }));
        const cap = capBase.clone();
        const side = new MeshLambertMaterial();
        const mesh = new Mesh(g, [cap, side]);
        mesh.userData = { plot: p, y: 0, h: 1 };
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        site.add(mesh);
        return mesh;
    });

    // Number boards, street lights, gate, approach road, neighbourhood (see walk.js)
    const props = buildProps(site);

    // Trees: instanced low-poly canopies inside green areas and along the perimeter
    const blocked = features.filter(f => f.kind === 'plot' || f.kind === 'road');
    const owners = commons.filter(f => f.box.w * f.box.h <= 0.2 * boundary.box.w * boundary.box.h);
    const spots = [];
    const rand = rng(42);
    const free = (pt) => !blocked.some(f => pointInPolygon(pt, f.points)) && pointInPolygon(pt, boundary.points);
    owners.forEach(f => {
        for (let x = f.box.minX + 8; x < f.box.maxX - 4; x += 16) {
            for (let y = f.box.minY + 8; y < f.box.maxY - 4; y += 16) {
                const pt = [x + (rand() - 0.5) * 8, y + (rand() - 0.5) * 8];
                if (rand() > 0.35 && pointInPolygon(pt, f.points) && free(pt)) spots.push(pt);
            }
        }
    });
    const [cx, cy] = [GEO.centerX, GEO.centerY];
    boundary.points.forEach((p, i) => {
        const q = boundary.points[(i + 1) % boundary.points.length];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let t = 0; t < len; t += 22) {
            const x = p[0] + ((q[0] - p[0]) * t) / len;
            const y = p[1] + ((q[1] - p[1]) * t) / len;
            const d = Math.hypot(cx - x, cy - y);
            const pt = [x + ((cx - x) / d) * 7, y + ((cy - y) / d) * 7];
            if (free(pt)) spots.push(pt);
        }
    });
    props.treeSpots.forEach(([x, y]) => spots.push([x, y])); // scrub on the open land outside
    const canopy = new InstancedMesh(new IcosahedronGeometry(6, 0), new MeshLambertMaterial({ color: 0xffffff, flatShading: true }), spots.length);
    const trunk = new InstancedMesh(new CylinderGeometry(0.7, 1, 6, 5).translate(0, 3, 0), new MeshLambertMaterial({ color: 0x6b4f35 }), spots.length);
    const dummy = new Object3D();
    const tint = new Color();
    spots.forEach(([x, y], i) => {
        const s = 0.75 + rand() * 0.6;
        dummy.position.set(x, 0, y);
        dummy.scale.set(s, s, s);
        dummy.rotation.y = rand() * Math.PI;
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        dummy.position.y = 9 * s;
        dummy.scale.set(s, s * 1.15, s);
        dummy.updateMatrix();
        canopy.setMatrixAt(i, dummy.matrix);
        canopy.setColorAt(i, tint.setHSL(0.27 + rand() * 0.08, 0.45, 0.28 + rand() * 0.1));
    });
    canopy.castShadow = true;
    trunk.castShadow = true;
    site.add(trunk, canopy);

    // ─── STYLE / ANIMATION ───────────────────────────
    let needsRender = true;
    let raf = 0;
    let visible = false;
    let flight = null;

    // Overview: plots as raised, colour-coded blocks. Walking: realistic open land — a low
    // kerb of natural ground, tinted only slightly by status, so the site reads as it really looks.
    const WALK_TINT = { Available: 0x9fb36a, Sold: 0xa79a80, Reserved: 0xb9a36a };
    function stylePlots() {
        const walking = walk?.active;
        plotMeshes.forEach(m => {
            const p = m.userData.plot;
            const selected = p.id === state.selectedId;
            const match = matchesFilter(p);
            const color = walking
                ? (selected ? 0x5fd3c0 : WALK_TINT[p.status] ?? WALK_TINT.Sold)
                : selected ? C.selected : match ? C[p.status] ?? C.Sold : C.dim;
            m.material[0].color.setHex(color);
            m.material[1].color.setHex(color).multiplyScalar(0.62);
            m.userData.y = selected && !walking ? LIFT : 0;
            m.userData.h = walking ? 0.12 : match || selected ? 1 : 0.25;
        });
        needsRender = true;
        start();
    }

    function animatePlots() {
        let moving = false;
        plotMeshes.forEach(m => {
            const { y, h } = m.userData;
            if (Math.abs(m.position.y - y) > 0.01 || Math.abs(m.scale.y - h) > 0.005) {
                m.position.y += (y - m.position.y) * 0.18;
                m.scale.y += (h - m.scale.y) * 0.18;
                moving = true;
            } else {
                m.position.y = y;
                m.scale.y = h;
            }
        });
        return moving;
    }

    function flyTo(target, distance, duration = 900) {
        const dir = camera.position.clone().sub(controls.target).normalize();
        flight = {
            t0: performance.now(),
            duration,
            fromTarget: controls.target.clone(),
            toTarget: target,
            fromPos: camera.position.clone(),
            toPos: target.clone().add(dir.multiplyScalar(distance)),
        };
        start();
    }

    function stepFlight(now) {
        if (!flight) return false;
        const t = Math.min(1, (now - flight.t0) / flight.duration);
        const e = 1 - Math.pow(1 - t, 3);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
        camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
        if (t >= 1) flight = null;
        return true;
    }

    function loop(now) {
        raf = 0;
        if (!visible) return;
        const walking = walk.active;
        const flying = !walking && stepFlight(now);
        // OrbitControls would re-aim the camera at its target, so it sits out while walking
        const changed = walking ? walk.update(now) : controls.update();
        const moving = animatePlots();
        if (flying || changed || moving || needsRender) {
            renderer.render(scene, camera);
            needsRender = false;
            const heading = walking ? camera.rotation.y : controls.getAzimuthalAngle();
            if (compass) compass.style.transform = `rotate(${MathUtils.radToDeg(heading) + GEO.rotationDeg}deg)`;
        }
        // Keep looping only while something is in motion (damping, flights, plot lifts, walking)
        // (controls.update() can already have re-armed it through the 'change' listener)
        if ((flying || changed || moving) && !raf) raf = requestAnimationFrame(loop);
    }

    function start() {
        if (visible && !raf) raf = requestAnimationFrame(loop);
    }

    controls.addEventListener('start', start);
    controls.addEventListener('change', start);

    // ─── CAMERA FRAMING ──────────────────────────────
    function homeView() {
        const vFov = MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        const byWidth = (boundary.box.w * 0.55) / Math.tan(hFov / 2);
        const byDepth = (boundary.box.h * 0.42) / Math.tan(vFov / 2);
        const dist = Math.max(byWidth, byDepth) + 120;
        const polar = MathUtils.degToRad(48);
        return {
            target: new Vector3(0, 0, 30),
            pos: new Vector3(0, Math.cos(polar) * dist, 30 + Math.sin(polar) * dist),
        };
    }

    function reset(animated = true) {
        const home = homeView();
        if (!animated) {
            controls.target.copy(home.target);
            camera.position.copy(home.pos);
            needsRender = true;
            start();
            return;
        }
        flight = {
            t0: performance.now(), duration: 900,
            fromTarget: controls.target.clone(), toTarget: home.target,
            fromPos: camera.position.clone(), toPos: home.pos,
        };
        start();
    }

    function focus(plot) {
        const target = new Vector3(plot.center[0] - GEO.centerX, 0, plot.center[1] - GEO.centerY);
        flyTo(target, 260);
    }

    // ─── PICKING ─────────────────────────────────────
    const ray = new Raycaster();
    const ndc = new Vector2();
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', e => {
        if (walk.active) return; // walk mode handles its own taps
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(plotMeshes, false)[0];
        selectPlot(hit ? hit.object.userData.plot.id : null, '3d');
    });

    // ─── WALK MODE ───────────────────────────────────
    const walk = createWalk({
        el, renderer, camera, controls, site, plotMeshes,
        groundMeshes: [base, ...roadMeshes, ...commonMeshes, ...props.ground],
        requestRender: () => { needsRender = true; start(); },
        selectPlot,
        onChange: (on) => {
            document.body.classList.toggle('is-walking', on);
            flight = null;
            stylePlots();
        },
    });

    // ─── STATE SYNC ──────────────────────────────────
    on('select', ({ plot, source }) => {
        stylePlots();
        if (!plot || !visible || source === '3d' || source === 'walk') return;
        if (walk.active) walk.visitPlot(plot);
        else requestAnimationFrame(() => focus(plot));
    });
    on('filter', stylePlots);

    function resize() {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        needsRender = true;
        start();
    }
    new ResizeObserver(resize).observe(el);

    stylePlots();
    let framed = false;

    return {
        show() {
            visible = true;
            resize();
            if (!framed) {
                framed = true;
                // Intro: swing in from a wider angle
                const home = homeView();
                controls.target.copy(home.target);
                camera.position.copy(home.pos).applyAxisAngle(new Vector3(0, 1, 0), -0.7).multiplyScalar(1.35);
                const sel = plots.find(p => p.id === state.selectedId);
                if (sel) focus(sel); else reset(true);
            } else {
                const sel = plots.find(p => p.id === state.selectedId);
                if (sel) focus(sel);
            }
            needsRender = true;
            start();
        },
        hide() {
            walk.exit();
            visible = false;
            if (raf) cancelAnimationFrame(raf);
            raf = 0;
        },
        zoomIn() {
            if (walk.active) return;
            flyTo(controls.target.clone(), camera.position.distanceTo(controls.target) / 1.6, 350); },
        zoomOut() {
            if (walk.active) return;
            const d = Math.min(controls.maxDistance, camera.position.distanceTo(controls.target) * 1.6);
            flyTo(controls.target.clone(), d, 350);
        },
        reset() {
            if (walk.active) walk.exit();
            reset();
        },
    };
}
