// 3D society model. Lazy-loaded (dynamic import) so the page shell paints first.
// Renders on demand: the RAF loop only runs while the camera or an animation is moving.
import {
    WebGLRenderer, Scene, PerspectiveCamera, Color,
    Group, Mesh, InstancedMesh, Object3D, Matrix4, Quaternion, Euler, Vector2, Vector3,
    BoxGeometry, PlaneGeometry, CylinderGeometry, ConeGeometry, SphereGeometry, IcosahedronGeometry,
    TorusGeometry, EdgesGeometry, LineSegments, LineBasicMaterial, MeshLambertMaterial,
    MeshBasicMaterial, CanvasTexture, SRGBColorSpace,
    Raycaster, MathUtils, Sprite, SpriteMaterial,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { society, towers, units, DIR_DEG, rotateXZ } from './model.js';
import { createSurroundings } from './surroundings.js';
import { createPlaceMarkers } from './places3d.js';

const FH = society.floorHeight;
const SLIDE = 6; // ft a selected unit slides out of the facade
const C = {
    Available: 0x55b85a,
    Booked: 0xc4a254,
    Sold: 0x8a948f,
    selected: 0x2dd4bf,
    dim: 0x3a423e,
    slab: 0xe9e4d8,
    core: 0xb9b3a6,
    ground: 0x5f6f4c,
    lawn: 0x4f8a3e,
    road: 0x6a6d6b,
    paving: 0xcfc4ad,
};

const dirVec = (deg) => {
    const r = MathUtils.degToRad(deg);
    return new Vector3(Math.sin(r), 0, -Math.cos(r)); // 0° = north (-z), 90° = east (+x)
};

// Deterministic PRNG
function rng(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

function box(w, h, d, x, y, z) {
    return new BoxGeometry(w, h, d).translate(x, y + h / 2, z);
}

function lambert(color, extra = {}) {
    return new MeshLambertMaterial({ color, ...extra });
}

// Ribbon-window facade texture, tinted per instance by status colour
function facadeTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#2a3a44';
    g.fillRect(0, 16, 128, 30);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x <= 128; x += 21.3) g.fillRect(x - 1, 16, 2, 30);
    g.fillStyle = 'rgba(160,210,230,0.25)';
    g.fillRect(0, 16, 128, 8);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

function labelSprite(text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(11,15,13,0.82)';
    g.beginPath();
    if (g.roundRect) g.roundRect(4, 8, 248, 64, 32);
    else g.rect(4, 8, 248, 64);
    g.fill();
    g.strokeStyle = 'rgba(45,212,191,0.8)';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#f1f5f9';
    g.font = '700 34px Outfit, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 42);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    // Constant on-screen size (~24px tall) regardless of camera distance
    const s = new Sprite(new SpriteMaterial({ map: t, depthWrite: false, sizeAttenuation: false }));
    s.scale.set(0.072, 0.0225, 1);
    s.renderOrder = 10;
    return s;
}

// ─── AMENITY MODELS ──────────────────────────────────
function amenityModel(a) {
    const g = new Group();
    const { w, d } = a;
    const add = (geo, mat) => { const m = new Mesh(geo, mat); g.add(m); return m; };
    switch (a.kind) {
        case 'pool': {
            add(box(w, 1, d, 0, 0, 0), lambert(C.paving));
            add(box(w - 10, 0.4, d - 10, -2, 1, 0), new MeshLambertMaterial({ color: 0x3fb6d8, emissive: 0x0a4a66, emissiveIntensity: 0.6 }));
            add(box(12, 0.4, 10, w / 2 - 10, 1, 0), new MeshLambertMaterial({ color: 0x6fd3ea, emissive: 0x0a4a66, emissiveIntensity: 0.5 }));
            const loungers = [];
            for (let i = 0; i < 5; i++) loungers.push(box(2.4, 1, 6, -w / 2 + 8 + i * 7, 1, d / 2 - 3.2));
            add(mergeGeometries(loungers), lambert(0xf2efe6));
            const umbrellas = [-w / 2 + 11, -w / 2 + 25].map(x => new ConeGeometry(4, 2, 8).translate(x, 8, d / 2 - 3));
            add(mergeGeometries(umbrellas), lambert(0xe07a5f));
            break;
        }
        case 'gym':
        case 'clubhouse': {
            const floors = a.kind === 'clubhouse' ? 2 : 1;
            const h = 12 * floors;
            add(box(w, h, d, 0, 0, 0), lambert(a.kind === 'gym' ? 0xd6d0c2 : 0xe8e2d4));
            // glass bands
            for (let f = 0; f < floors; f++) {
                add(box(w + 0.3, 5, d + 0.3, 0, f * 12 + 4, 0), new MeshLambertMaterial({ color: 0x2c4654, emissive: 0x0f2a33, emissiveIntensity: 0.5 }));
            }
            add(box(w + 4, 1, d + 4, 0, h, 0), lambert(0x8a7f6c));
            if (a.kind === 'clubhouse') add(box(w * 0.5, 1, 10, 0, 10, d / 2 + 5), lambert(0x8a7f6c)); // porch canopy
            break;
        }
        case 'playground': {
            add(box(w, 0.6, d, 0, 0, 0), lambert(0xd9773f));
            // slide: tower + ramp
            add(box(5, 8, 5, -w / 4, 0.6, -d / 6), lambert(0x3d85c6));
            const ramp = new BoxGeometry(3, 0.6, 14).rotateX(-0.55).translate(-w / 4, 4.8, -d / 6 + 9.5);
            add(ramp, lambert(0xf2cc8f));
            // swing frame
            const posts = [
                new CylinderGeometry(0.4, 0.4, 10, 6).rotateZ(0.25).translate(w / 5 - 6, 5.6, d / 5),
                new CylinderGeometry(0.4, 0.4, 10, 6).rotateZ(-0.25).translate(w / 5 + 6, 5.6, d / 5),
                new CylinderGeometry(0.35, 0.35, 12, 6).rotateZ(Math.PI / 2).translate(w / 5, 10.4, d / 5),
            ];
            add(mergeGeometries(posts), lambert(0xe07a5f));
            add(box(2.5, 0.4, 1.2, w / 5 - 2.5, 3, d / 5), lambert(0x2dd4bf));
            add(box(2.5, 0.4, 1.2, w / 5 + 2.5, 3, d / 5), lambert(0x2dd4bf));
            // climbing dome
            add(new SphereGeometry(6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(w / 4, 0.6, -d / 4),
                new MeshLambertMaterial({ color: 0xf2cc8f, wireframe: true }));
            break;
        }
        case 'temple': {
            const sand = lambert(0xd9a066);
            const marble = lambert(0xf3eee3);
            add(box(w, 1.5, d, 0, 0, 0), marble);
            add(box(w - 4, 1.5, d - 4, 0, 1.5, 0), marble);
            add(box(w - 10, 9, d - 10, 0, 3, 0), sand);
            // mandapa pillars at the front
            const pillars = [-1, 1].map(s => new CylinderGeometry(0.7, 0.7, 7, 8).translate(s * 4, 6.5, d / 2 - 3));
            add(mergeGeometries(pillars), marble);
            add(box(11, 1, 6, 0, 10, d / 2 - 4), sand);
            // shikhara: stacked tapering tiers + amalaka + kalash
            const tiers = [];
            for (let i = 0; i < 5; i++) {
                const r = 7 - i * 1.2;
                tiers.push(new CylinderGeometry(r * 0.82, r, 3.4, 8).translate(0, 12 + i * 3.2, 0));
            }
            add(mergeGeometries(tiers), sand);
            add(new CylinderGeometry(1.6, 1.6, 0.9, 12).translate(0, 28.6, 0), marble);
            add(new ConeGeometry(0.6, 2.2, 8).translate(0, 30.2, 0), lambert(0xe0b84a));
            const flag = add(new PlaneGeometry(3.4, 2), new MeshBasicMaterial({ color: 0xff8c1a, side: 2 }));
            flag.position.set(1.7, 32, 0);
            add(new CylinderGeometry(0.1, 0.1, 5, 4).translate(0, 31, 0), lambert(0x6b4f35));
            break;
        }
        case 'garden': {
            add(box(w, 0.4, d, 0, 0, 0), lambert(C.lawn));
            // jogging track loop
            const track = new TorusGeometry(1, 0.06, 4, 40).rotateX(Math.PI / 2).scale(w / 2 - 4, 8, d / 2 - 4).translate(0, 0.5, 0);
            add(track, lambert(0xb5653f));
            const benches = [];
            for (let i = -2; i <= 2; i++) benches.push(box(5, 1.6, 1.6, i * 22, 0.4, 0));
            add(mergeGeometries(benches), lambert(0x8a6a4a));
            break;
        }
        case 'parking': {
            const c = document.createElement('canvas');
            c.width = 256; c.height = 160;
            const gx = c.getContext('2d');
            gx.fillStyle = '#3a3e3c'; gx.fillRect(0, 0, 256, 160);
            gx.strokeStyle = '#e8e8e8'; gx.lineWidth = 2;
            for (let x = 8; x < 256; x += 30) { gx.beginPath(); gx.moveTo(x, 4); gx.lineTo(x, 56); gx.moveTo(x, 104); gx.lineTo(x, 156); gx.stroke(); }
            const tex = new CanvasTexture(c);
            tex.colorSpace = SRGBColorSpace;
            add(new PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, 0.3, 0), new MeshLambertMaterial({ map: tex }));
            const cars = [];
            const rand = rng(7);
            for (let i = 0; i < 7; i++) {
                const x = -w / 2 + 5 + i * (w / 8.5);
                const z = (i % 2 ? -1 : 1) * (d / 2 - 7);
                cars.push(box(6, 4.5, 13, x, 0.3, z));
            }
            const carMesh = add(mergeGeometries(cars), lambert(0xffffff, { vertexColors: false }));
            carMesh.material.color.setHSL(0.58, 0.2, 0.6 + rand() * 0.1);
            break;
        }
        default:
            add(box(w, 4, d, 0, 0, 0), lambert(0xcccccc));
    }
    g.position.set(a.x, 0, a.z);
    g.traverse(o => { o.userData.amenity = a; });
    return g;
}

// ─── SCENE ───────────────────────────────────────────
export function createScene(el, { onUnit, onAmenity, onEmpty, onViewChange, onHeading } = {}) {
    const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-label', '3D model of the society. Drag to rotate, pinch to zoom, tap an apartment or amenity.');
    el.appendChild(renderer.domElement);

    const scene = new Scene();

    // Near plane is small for eye-level walking; log depth keeps the layered ground
    // (imagery, site base, roads) stable out to the horizon.
    const camera = new PerspectiveCamera(42, 1, 0.8, 140000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = MathUtils.degToRad(84);
    controls.minDistance = 30;
    controls.maxDistance = 2600;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;

    // ─── Real surroundings: satellite ground, sky + sun, haze, hills, neighbourhood ─
    // (invalidate() touches loop state declared further down — only call it once that exists)
    let loopReady = false;
    const surroundings = createSurroundings(scene, renderer, { invalidate: () => { if (loopReady) invalidate(); } });

    const { width: SW, depth: SD } = society.site;
    // Site base covers the imagery under the compound
    const base = new Mesh(box(SW + 4, 0.6, SD + 4, 0, -0.6, 0), lambert(0x7d8f5c));
    scene.add(base);

    // boundary wall
    const wallH = 7;
    const walls = [
        box(SW, wallH, 1.5, 0, 0, -SD / 2),
        box(1.5, wallH, SD, -SW / 2, 0, 0),
        box(1.5, wallH, SD, SW / 2, 0, 0),
    ];
    const gate = society.gate;
    walls.push(box((SW - gate.width) / 2, wallH, 1.5, -(SW + gate.width) / 4, 0, SD / 2));
    walls.push(box((SW - gate.width) / 2, wallH, 1.5, (SW + gate.width) / 4, 0, SD / 2));
    walls.push(box(3, 16, 3, gate.x - gate.width / 2 - 1.5, 0, SD / 2), box(3, 16, 3, gate.x + gate.width / 2 + 1.5, 0, SD / 2));
    walls.push(box(gate.width + 6, 2.5, 3, gate.x, 14, SD / 2));
    const wallMesh = new Mesh(mergeGeometries(walls), lambert(0xd9cfb6));
    scene.add(wallMesh);

    const roadMeshes = [];
    const roadMesh = new Mesh(mergeGeometries(society.roads.map(r => box(r.w, 0.3, r.d, r.x, 0, r.z))), lambert(C.road));
    scene.add(roadMesh);
    roadMeshes.push(roadMesh);
    // Private approach road from the gate out to Mahal Road (over the imagery)
    const ap = society.approach;
    if (ap) {
        const apMesh = new Mesh(box(ap.width, 0.25, ap.length + 4, gate.x, -0.05, SD / 2 + ap.length / 2), lambert(C.road));
        scene.add(apMesh);
        roadMeshes.push(apMesh);
        const kerbs = [-1, 1].map(sd => box(1.2, 0.6, ap.length, gate.x + sd * (ap.width / 2 + 0.6), -0.05, SD / 2 + ap.length / 2 + 2));
        scene.add(new Mesh(mergeGeometries(kerbs), lambert(0xc9c2b0)));
    }

    const rand = rng(11);
    const tmp = new Object3D();
    const col = new Color();

    // ─── Amenities ───────────────────────────────────
    const amenityGroups = society.amenities.map(amenityModel);
    amenityGroups.forEach(g => scene.add(g));
    const amenityMeshes = [];
    amenityGroups.forEach(g => g.traverse(o => { if (o.isMesh) amenityMeshes.push(o); }));

    // ─── Trees ───────────────────────────────────────
    const obstacles = [
        ...towers.map(t => {
            const fp = t.footprint;
            const sideways = t.rotation % 180 !== 0;
            const hw = (sideways ? fp.d : fp.w) / 2 + 6;
            const hd = (sideways ? fp.w : fp.d) / 2 + 6;
            return { x: t.x, z: t.z, hw, hd };
        }),
        ...society.amenities.filter(a => a.kind !== 'garden').map(a => ({ x: a.x, z: a.z, hw: a.w / 2 + 4, hd: a.d / 2 + 4 })),
        ...society.roads.map(r => ({ x: r.x, z: r.z, hw: r.w / 2 + 3, hd: r.d / 2 + 3 })),
    ];
    const blocked = (x, z) => obstacles.some(o => Math.abs(x - o.x) < o.hw && Math.abs(z - o.z) < o.hd);
    const spots = [];
    const garden = society.amenities.find(a => a.kind === 'garden');
    for (let x = -SW / 2 + 6; x < SW / 2 - 4; x += 15) {
        for (const z of [-SD / 2 + 5, SD / 2 - 5]) if (!blocked(x, z) && Math.abs(x - gate.x) > gate.width / 2 + 6) spots.push([x, z]);
    }
    for (let z = -SD / 2 + 20; z < SD / 2 - 4; z += 15) {
        for (const x of [-SW / 2 + 5, SW / 2 - 5]) if (!blocked(x, z)) spots.push([x, z]);
    }
    for (let i = 0; i < 260 && spots.length < 260; i++) {
        const x = (rand() - 0.5) * (SW - 30);
        const z = (rand() - 0.5) * (SD - 30);
        if (!blocked(x, z)) spots.push([x, z]);
    }
    if (garden) {
        for (let x = garden.x - garden.w / 2 + 6; x < garden.x + garden.w / 2; x += 18) {
            spots.push([x, garden.z - garden.d / 2 + 3], [x + 9, garden.z + garden.d / 2 - 3]);
        }
    }
    const trunks = new InstancedMesh(new CylinderGeometry(0.6, 0.9, 6, 5).translate(0, 3, 0), lambert(0x6b4f35), spots.length);
    const crowns = new InstancedMesh(new IcosahedronGeometry(5.5, 0), lambert(0xffffff, { flatShading: true }), spots.length);
    spots.forEach(([x, z], i) => {
        const s = 0.75 + rand() * 0.7;
        tmp.position.set(x, 0, z);
        tmp.rotation.set(0, rand() * 3, 0);
        tmp.scale.set(s, s, s);
        tmp.updateMatrix();
        trunks.setMatrixAt(i, tmp.matrix);
        tmp.position.y = 8.5 * s;
        tmp.scale.set(s, s * 1.2, s);
        tmp.updateMatrix();
        crowns.setMatrixAt(i, tmp.matrix);
        crowns.setColorAt(i, col.setHSL(0.26 + rand() * 0.08, 0.42, 0.3 + rand() * 0.1));
    });
    scene.add(trunks, crowns);

    // ─── Towers ──────────────────────────────────────
    // Per-floor slabs and cores are instanced so the floor cut-away can hide them.
    const towerFloors = []; // { tower, floor }
    towers.forEach(t => {
        const first = society.stiltParking ? 1 : 0;
        for (let f = first; f <= first + t.floors; f++) towerFloors.push({ tower: t, floor: f }); // last = roof slab
    });
    const towerQuat = (t) => new Quaternion().setFromEuler(new Euler(0, -MathUtils.degToRad(t.rotation), 0));
    const towerCentre = (t) => {
        const fp = t.footprint;
        const [ox, oz] = rotateXZ((fp.minX + fp.maxX) / 2, (fp.minZ + fp.maxZ) / 2, t.rotation);
        return [t.x + ox, t.z + oz];
    };

    const slabs = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert(C.slab), towerFloors.length);
    const cores = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), lambert(C.core), towerFloors.length);
    const m4 = new Matrix4();
    const ZERO = new Vector3(0, 0, 0);
    const slabMatrices = [];
    const coreMatrices = [];
    towerFloors.forEach(({ tower: t, floor }, i) => {
        const fp = t.footprint;
        const [cx, cz] = towerCentre(t);
        const q = towerQuat(t);
        const slab = new Matrix4().compose(new Vector3(cx, floor * FH - 0.6, cz), q, new Vector3(fp.w + 2, 0.9, fp.d + 2));
        slabMatrices.push(slab);
        slabs.setMatrixAt(i, slab);
        const isRoof = floor === (society.stiltParking ? 1 : 0) + t.floors;
        const core = new Matrix4().compose(new Vector3(cx, floor * FH, cz), q, isRoof ? new Vector3(22, 9, 14) : new Vector3(22, FH - 0.6, 12));
        coreMatrices.push(core);
        cores.setMatrixAt(i, core);
    });
    scene.add(slabs, cores);

    // Stilt pillars + roof parapet (static)
    const stilts = [];
    const parapets = [];
    towers.forEach(t => {
        const fp = t.footprint;
        const [cx, cz] = towerCentre(t);
        const top = ((society.stiltParking ? 1 : 0) + t.floors) * FH + 0.3;
        const deg = t.rotation;
        const place = (geo, lx, lz) => {
            const [ox, oz] = rotateXZ(lx, lz, deg);
            return geo.rotateY(-MathUtils.degToRad(deg)).translate(cx + ox, 0, cz + oz);
        };
        if (society.stiltParking) {
            for (let ix = 0; ix <= 4; ix++) {
                for (let iz = 0; iz <= 3; iz++) {
                    const lx = -fp.w / 2 + 2 + ((fp.w - 4) * ix) / 4;
                    const lz = -fp.d / 2 + 2 + ((fp.d - 4) * iz) / 3;
                    stilts.push(place(box(2, FH - 0.6, 2, 0, 0, 0), lx, lz));
                }
            }
        }
        const pw = fp.w + 2;
        const pd = fp.d + 2;
        parapets.push(
            place(box(pw, 3.5, 0.8, 0, top, 0), 0, -pd / 2),
            place(box(pw, 3.5, 0.8, 0, top, 0), 0, pd / 2),
            place(box(0.8, 3.5, pd, 0, top, 0), -pw / 2, 0),
            place(box(0.8, 3.5, pd, 0, top, 0), pw / 2, 0),
            place(box(10, 6, 8, 0, top, 0), fp.w / 4, 0), // water tank
        );
    });
    if (stilts.length) scene.add(new Mesh(mergeGeometries(stilts), lambert(C.core)));
    const roofTop = new Mesh(mergeGeometries(parapets), lambert(C.slab));
    scene.add(roofTop);

    const labels = towers.map(t => {
        const [cx, cz] = towerCentre(t);
        const s = labelSprite(t.name);
        s.position.set(cx, ((society.stiltParking ? 1 : 0) + t.floors) * FH + 22, cz);
        scene.add(s);
        return s;
    });

    // Units — one instanced mesh for every apartment
    // Box groups: +x, -x, +y, -y, +z, -z → windows on the walls, plain roof/floor
    const facade = new MeshLambertMaterial({ map: facadeTexture() });
    const plain = new MeshLambertMaterial({ color: 0xdedede });
    const unitMesh = new InstancedMesh(
        new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        [facade, facade, plain, plain, facade, facade],
        units.length,
    );
    const baseMatrices = units.map(u => {
        const t = u.tower;
        const [ox, oz] = rotateXZ(u.local.x, u.local.z, t.rotation);
        return new Matrix4().compose(
            new Vector3(t.x + ox, u.floor * FH + 0.3, t.z + oz),
            towerQuat(t),
            new Vector3(u.local.w - 0.4, FH - 0.9, u.local.d - 0.4),
        );
    });
    baseMatrices.forEach((m, i) => unitMesh.setMatrixAt(i, m));
    scene.add(unitMesh);

    const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new LineBasicMaterial({ color: 0xffffff }));
    outline.visible = false;
    scene.add(outline);

    // ─── STATE ───────────────────────────────────────
    // UI panels covering the canvas: the projection centre is shifted so focused
    // objects land in the visible part of the screen (eased in the loop).
    const insets = { x: 0, y: 0, top: 0, bottom: 0 };
    const offset = { x: 0, y: 0 };
    let selectedIdx = -1;
    let filterFn = () => true;
    let cutFloor = null;
    let slide = 0; // animated slide-out of the selected unit

    function paint() {
        units.forEach((u, i) => {
            const hex = i === selectedIdx ? C.selected : filterFn(u) ? C[u.status] : C.dim;
            unitMesh.setColorAt(i, col.setHex(hex));
        });
        unitMesh.instanceColor.needsUpdate = true;
        invalidate();
    }

    function placeUnits() {
        units.forEach((u, i) => {
            if (cutFloor != null && u.floor > cutFloor) {
                unitMesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
                return;
            }
            if (i === selectedIdx && slide > 0) {
                const off = dirVec(DIR_DEG[u.siteFacing]).multiplyScalar(slide);
                m4.copy(baseMatrices[i]).premultiply(new Matrix4().makeTranslation(off.x, 0, off.z));
                unitMesh.setMatrixAt(i, m4);
                return;
            }
            unitMesh.setMatrixAt(i, baseMatrices[i]);
        });
        unitMesh.instanceMatrix.needsUpdate = true;
        unitMesh.computeBoundingSphere();

        towerFloors.forEach(({ floor }, i) => {
            const hide = cutFloor != null && floor > cutFloor;
            slabs.setMatrixAt(i, hide ? m4.makeScale(0, 0, 0) : slabMatrices[i]);
            cores.setMatrixAt(i, cutFloor != null && floor > cutFloor ? m4.makeScale(0, 0, 0) : coreMatrices[i]);
        });
        slabs.instanceMatrix.needsUpdate = true;
        cores.instanceMatrix.needsUpdate = true;
        roofTop.visible = cutFloor == null;
        labels.forEach((s, i) => {
            const t = towers[i];
            const top = cutFloor == null ? (society.stiltParking ? 1 : 0) + t.floors : Math.min(cutFloor + 1, t.floors + 1);
            s.position.y = top * FH + 22;
        });

        if (selectedIdx >= 0) {
            unitMesh.getMatrixAt(selectedIdx, m4);
            const p = new Vector3(), q = new Quaternion(), s = new Vector3();
            m4.decompose(p, q, s);
            outline.position.copy(p);
            outline.quaternion.copy(q);
            outline.scale.copy(s).addScalar(0.3);
            outline.visible = s.x > 0;
        } else {
            outline.visible = false;
        }
        invalidate();
    }

    // ─── RENDER LOOP (on demand) ─────────────────────
    let raf = 0;
    let dirty = true;
    loopReady = true;
    let flight = null;
    let markers = null;
    let mode = 'orbit'; // 'orbit' | 'unit-view' | 'walk'
    const headingDir = new Vector3();

    function invalidate() {
        dirty = true;
        if (!raf) raf = requestAnimationFrame(loop);
    }

    function loop(now) {
        raf = 0;
        let active = false;
        if (flight) {
            const t = Math.min(1, (now - flight.t0) / flight.duration);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            camera.position.lerpVectors(flight.fromPos, flight.toPos, e);
            if (flight.toLook) {
                const look = new Vector3().lerpVectors(flight.fromTarget, flight.toLook, e);
                camera.lookAt(look);
            } else {
                controls.target.lerpVectors(flight.fromTarget, flight.toTarget, e);
            }
            if (flight.fov) {
                camera.fov = MathUtils.lerp(flight.fov[0], flight.fov[1], e);
                camera.updateProjectionMatrix();
            }
            if (t >= 1) { const done = flight.done; flight = null; done?.(); }
            active = true;
        }
        if (stepWalk(now)) active = true;
        if (mode === 'orbit' && !(flight && flight.toLook)) {
            if (controls.update()) active = true;
        }
        const target = selectedIdx >= 0 && mode === 'orbit' ? SLIDE : 0;
        if (Math.abs(slide - target) > 0.02) {
            slide += (target - slide) * 0.16;
            placeUnits();
            active = true;
        } else if (slide !== target) {
            slide = target;
            placeUnits();
        }
        if (Math.abs(offset.x - insets.x) > 0.5 || Math.abs(offset.y - insets.y) > 0.5) {
            offset.x += (insets.x - offset.x) * 0.15;
            offset.y += (insets.y - offset.y) * 0.15;
            applyViewOffset();
            active = true;
        } else if (offset.x !== insets.x || offset.y !== insets.y) {
            offset.x = insets.x;
            offset.y = insets.y;
            applyViewOffset();
        }
        if (active || dirty) {
            renderer.render(scene, camera);
            dirty = false;
            markers?.update();
            if (onHeading) {
                camera.getWorldDirection(headingDir);
                const siteDeg = MathUtils.radToDeg(Math.atan2(headingDir.x, -headingDir.z));
                onHeading((siteDeg + society.siteRotation + 360) % 360);
            }
        }
        if (active && !raf) raf = requestAnimationFrame(loop);
    }

    controls.addEventListener('change', () => { if (!raf) raf = requestAnimationFrame(loop); });

    function fly({ pos, target, look, duration = 1000, fov, done }) {
        flight = {
            t0: performance.now(),
            duration,
            fromPos: camera.position.clone(),
            toPos: pos,
            fromTarget: look ? currentLook() : controls.target.clone(),
            toTarget: target,
            toLook: look,
            fov: fov ? [camera.fov, fov] : null,
            done,
        };
        invalidate();
    }

    function currentLook() {
        const dir = new Vector3();
        camera.getWorldDirection(dir);
        return camera.position.clone().add(dir.multiplyScalar(100));
    }

    // ─── CAMERA PRESETS ──────────────────────────────
    function homePose() {
        const vFov = MathUtils.degToRad(camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
        const dist = Math.max((SW * 0.62) / Math.tan(hFov / 2), (SD * 0.62) / Math.tan(vFov / 2)) + 60;
        const dir = new Vector3(0.45, 0.62, 0.65).normalize();
        const target = new Vector3(0, 40, 10);
        return { target, pos: target.clone().add(dir.multiplyScalar(dist)) };
    }

    function focusUnit(u) {
        const facing = dirVec(DIR_DEG[u.siteFacing]);
        const side = new Vector3(-facing.z, 0, facing.x).multiplyScalar(0.35);
        const target = new Vector3(u.world.x, u.world.y + FH / 2, u.world.z);
        // Back off further when panels leave only a thin strip of canvas visible
        const h = el.clientHeight || 1;
        const visible = Math.max(0.3, (h - insets.top - insets.bottom) / h);
        const dist = Math.min(440, 190 / Math.sqrt(visible));
        const pos = target.clone().add(facing.clone().add(side).normalize().multiplyScalar(dist)).add(new Vector3(0, dist * 0.37, 0));
        fly({ pos, target, duration: 900 });
    }

    function focusAmenity(a) {
        const target = new Vector3(a.x, 6, a.z);
        const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
        const dist = Math.max(a.w, a.d) * 1.6 + 60;
        const pos = target.clone().add(dir.multiplyScalar(dist)).add(new Vector3(0, dist * 0.7, 0));
        fly({ pos, target, duration: 900 });
    }

    // ─── FIRST PERSON: window view + walk-around ─────
    // Both share drag-to-look. 'unit-view' sits at a window looking out (yaw clamped);
    // 'walk' is eye-level (1.6 m) inside the compound — tap the ground to walk there.
    const EYE = 5.25; // ft ≈ 1.6 m
    let saved = null;
    let yaw = 0;
    let pitch = 0;
    let baseYaw = 0;
    let viewUnit = null;
    let walk = null; // active walk animation { from, to, t0, duration }
    const isFirstPerson = () => mode === 'unit-view' || mode === 'walk';

    function eyeFor(u) {
        const f = dirVec(DIR_DEG[u.siteFacing]);
        const half = (u.localFacing === 'N' || u.localFacing === 'S' ? u.local.d : u.local.w) / 2;
        return new Vector3(u.world.x, u.world.y + 5.2, u.world.z).add(f.multiplyScalar(half + 1.5));
    }

    function lookDir() {
        const y = MathUtils.degToRad(baseYaw + yaw);
        const p = MathUtils.degToRad(pitch);
        return new Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
    }
    const applyLook = () => camera.lookAt(camera.position.clone().add(lookDir()));

    function saveOrbit() {
        if (mode === 'orbit') saved = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
        controls.enabled = false;
        renderer.domElement.style.cursor = 'grab';
    }

    function enterUnitView(u, { animate = true } = {}) {
        saveOrbit();
        mode = 'unit-view';
        viewUnit = u;
        walk = null;
        ring.visible = false;
        baseYaw = DIR_DEG[u.siteFacing];
        yaw = 0;
        pitch = -10;
        const eye = eyeFor(u);
        const look = eye.clone().add(lookDir().multiplyScalar(100));
        if (animate) fly({ pos: eye, look, duration: 1300, fov: 62 });
        else {
            camera.position.copy(eye);
            camera.fov = 62;
            camera.updateProjectionMatrix();
            camera.lookAt(look);
            invalidate();
        }
        onViewChange?.({ mode, unit: u });
    }

    // Walkable area: inside the compound wall (plus the approach road), minus buildings & water
    const walkBlocks = [
        ...society.amenities.filter(a => ['gym', 'clubhouse', 'temple', 'pool'].includes(a.kind))
            .map(a => ({ x: a.x, z: a.z, hw: a.w / 2 + 2, hd: a.d / 2 + 2 })),
        ...towers.map(t => {
            const fp = t.footprint;
            const [cx, cz] = towerCentre(t);
            const sideways = t.rotation % 180 !== 0;
            // only the lift/stair core blocks you — the rest of the ground floor is open stilts
            return { x: cx, z: cz, hw: (sideways ? 6 : 11) + 1.5, hd: (sideways ? 11 : 6) + 1.5, w: fp.w };
        }),
    ];
    function clampWalk(p) {
        const m = 3;
        const onApproach = ap && Math.abs(p.x - gate.x) < ap.width / 2 - 1 && p.z > SD / 2 - m;
        p.x = MathUtils.clamp(p.x, -SW / 2 + m, SW / 2 - m);
        p.z = MathUtils.clamp(p.z, -SD / 2 + m, onApproach ? SD / 2 + ap.length - 4 : SD / 2 - m);
        for (const o of walkBlocks) {
            const dx = p.x - o.x, dz = p.z - o.z;
            const px = o.hw - Math.abs(dx), pz = o.hd - Math.abs(dz);
            if (px > 0 && pz > 0) {
                if (px < pz) p.x = o.x + Math.sign(dx || 1) * o.hw;
                else p.z = o.z + Math.sign(dz || 1) * o.hd;
            }
        }
        p.y = EYE;
        return p;
    }

    function walkTo(target) {
        const to = clampWalk(target.clone());
        const dist = to.distanceTo(camera.position);
        if (dist < 1) return;
        walk = { from: camera.position.clone(), to, t0: performance.now(), duration: MathUtils.clamp(dist / 38, 0.45, 2.4) * 1000 };
        ring.position.set(to.x, 0.25, to.z);
        ring.visible = true;
        invalidate();
    }

    function stepWalk(now) {
        if (!walk) return false;
        const t = Math.min(1, (now - walk.t0) / walk.duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(walk.from, walk.to, e);
        camera.position.y = EYE + Math.sin(e * Math.PI * Math.max(1, walk.to.distanceTo(walk.from) / 12)) * 0.12; // gentle step bob
        applyLook();
        if (t >= 1) {
            camera.position.y = EYE;
            walk = null;
            ring.visible = false;
        }
        return true;
    }

    function enterWalk() {
        saveOrbit();
        mode = 'walk';
        viewUnit = null;
        // Start just inside the gate, looking up the main drive into the compound
        baseYaw = 0;
        yaw = 0;
        pitch = 2;
        const start = new Vector3(gate.x, EYE, SD / 2 - 14);
        fly({ pos: start, look: start.clone().add(lookDir().multiplyScalar(100)), duration: 1500, fov: 70 });
        onViewChange?.({ mode, unit: null });
    }

    function step(sign) {
        if (mode !== 'walk') return;
        const y = MathUtils.degToRad(baseYaw + yaw);
        walkTo(camera.position.clone().add(new Vector3(Math.sin(y), 0, -Math.cos(y)).multiplyScalar(32 * sign)));
    }

    function exitFirstPerson() {
        if (!isFirstPerson()) return;
        const s = saved || homePose();
        const fromLook = currentLook();
        mode = 'orbit';
        viewUnit = null;
        walk = null;
        ring.visible = false;
        renderer.domElement.style.cursor = '';
        controls.target.copy(fromLook);
        fly({
            pos: s.pos, target: s.target, duration: 1100, fov: saved?.fov || 42,
            done: () => { controls.enabled = true; },
        });
        onViewChange?.({ mode, unit: null });
    }

    // Destination marker for tap-to-walk
    const ring = new Mesh(new TorusGeometry(3.2, 0.35, 6, 32).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.85 }));
    ring.visible = false;
    scene.add(ring);

    // drag-to-look + pinch/wheel zoom in first person
    const pointers = new Map();
    let pinchStart = 0;
    let fovStart = 62;
    renderer.domElement.addEventListener('pointerdown', e => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
        if (isFirstPerson()) {
            renderer.domElement.setPointerCapture(e.pointerId);
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
                fovStart = camera.fov;
            }
        }
    });
    renderer.domElement.addEventListener('pointermove', e => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!isFirstPerson() || flight) return;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            camera.fov = MathUtils.clamp(fovStart * (pinchStart / Math.max(dist, 1)), 30, 85);
            camera.updateProjectionMatrix();
        } else {
            const k = camera.fov / renderer.domElement.clientHeight;
            yaw = mode === 'walk' ? yaw - dx * k : MathUtils.clamp(yaw - dx * k, -80, 80);
            pitch = MathUtils.clamp(pitch + dy * k, mode === 'walk' ? -60 : -45, mode === 'walk' ? 45 : 25);
        }
        applyLook();
        invalidate();
    });
    const release = e => {
        const p = pointers.get(e.pointerId);
        pointers.delete(e.pointerId);
        if (!p || e.type === 'pointercancel') return;
        const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
        if (moved < 6 && pointers.size === 0 && (mode === 'orbit' || mode === 'walk')) pick(e);
    };
    renderer.domElement.addEventListener('pointerup', release);
    renderer.domElement.addEventListener('pointercancel', release);
    renderer.domElement.addEventListener('wheel', e => {
        if (!isFirstPerson()) return;
        e.preventDefault();
        camera.fov = MathUtils.clamp(camera.fov + e.deltaY * 0.03, 30, 85);
        camera.updateProjectionMatrix();
        invalidate();
    }, { passive: false });
    renderer.domElement.addEventListener('keydown', e => {
        if (mode !== 'walk') return;
        if (e.key === 'ArrowUp' || e.key === 'w') step(1);
        if (e.key === 'ArrowDown' || e.key === 's') step(-1);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            yaw += e.key === 'ArrowLeft' ? -15 : 15;
            applyLook();
            invalidate();
        }
    });
    renderer.domElement.tabIndex = 0;

    // ─── PICKING ─────────────────────────────────────
    const ray = new Raycaster();
    const ndc = new Vector2();
    const groundTargets = [base, ...roadMeshes];
    function pick(e) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObjects([unitMesh, ...amenityMeshes, ...(mode === 'walk' ? groundTargets : [])], false);
        const hit = hits[0];
        if (mode === 'walk') {
            if (!hit) return;
            if (hit.object === unitMesh) return onUnit?.(units[hit.instanceId]);
            // Flat amenity surfaces (lawn, play floor, parking) are walkable; buildings open their card
            if (hit.object.userData.amenity && hit.point.y > 2.5) return onAmenity?.(hit.object.userData.amenity);
            walkTo(hit.point);
            return;
        }
        if (!hit) return onEmpty?.();
        if (hit.object === unitMesh) onUnit?.(units[hit.instanceId]);
        else onAmenity?.(hit.object.userData.amenity);
    }

    function applyViewOffset() {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (offset.x || offset.y) camera.setViewOffset(w, h, offset.x, offset.y, w, h);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
    }

    // ─── RESIZE ──────────────────────────────────────
    function resize() {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        applyViewOffset();
        if (isFirstPerson()) applyLook();
        invalidate();
    }
    new ResizeObserver(resize).observe(el);
    resize();

    // Intro: start wide, swing into the home pose
    const home = homePose();
    controls.target.copy(home.target);
    camera.position.copy(home.pos).applyAxisAngle(new Vector3(0, 1, 0), 0.8).multiplyScalar(1.5);
    fly({ pos: home.pos, target: home.target, duration: 1600 });
    paint();
    placeUnits();

    return {
        selectUnit(u, { focus = true } = {}) {
            selectedIdx = u ? units.indexOf(u) : -1;
            paint();
            placeUnits();
            if (u && focus && mode === 'orbit') {
                // make sure the selected floor is not hidden by the cut-away
                focusUnit(u);
            }
            if (u && mode === 'unit-view') enterUnitView(u, { animate: true });
            // (in walk mode the card opens but you stay on the ground)
        },
        focusAmenity,
        setFilter(fn) {
            filterFn = fn;
            paint();
        },
        setCutFloor(f) {
            cutFloor = f;
            placeUnits();
        },
        enterUnitView,
        exitUnitView: exitFirstPerson,
        enterWalk,
        exitWalk: exitFirstPerson,
        step,
        setTime: (t) => surroundings.setTime(t),
        get time() { return surroundings.time; },
        get mode() { return mode; },
        get viewUnit() { return viewUnit; },
        zoom(factor) {
            if (isFirstPerson()) {
                camera.fov = MathUtils.clamp(camera.fov * (factor < 1 ? 0.8 : 1.25), 30, 85);
                camera.updateProjectionMatrix();
                invalidate();
                return;
            }
            const dir = camera.position.clone().sub(controls.target);
            const d = MathUtils.clamp(dir.length() * factor, controls.minDistance, controls.maxDistance);
            fly({ pos: controls.target.clone().add(dir.setLength(d)), target: controls.target.clone(), duration: 350 });
        },
        setInsets({ top = 0, right = 0, bottom = 0, left = 0 }) {
            insets.x = (right - left) / 2;
            insets.y = (bottom - top) / 2;
            insets.top = top;
            insets.bottom = bottom;
            invalidate();
        },
        // Nearby places as map pins in the scene
        setPlaces(places, onPick) {
            markers = createPlaceMarkers({ el, camera, places, onPick });
            invalidate();
        },
        setPlacesVisible(on) {
            markers?.setVisible(on);
            invalidate();
        },
        // Swing the camera round so the place is straight ahead, beyond the society
        lookToward(place) {
            const item = markers?.items.find(x => x.name === place.name);
            if (isFirstPerson() || !item) return;
            const t = controls.target.clone();
            const dir = item.ground.clone().sub(t).setY(0).normalize();
            const cur = camera.position.clone().sub(t);
            const flat = Math.hypot(cur.x, cur.z);
            const pos = t.clone().sub(dir.multiplyScalar(flat)).setY(camera.position.y);
            fly({ pos, target: t, duration: 1100 });
        },
        reset() {
            if (isFirstPerson()) return exitFirstPerson();
            const h = homePose();
            fly({ pos: h.pos, target: h.target, duration: 900 });
        },
    };
}
