// Real-world context around the society: Esri satellite ground, physical sky + sun,
// haze, the hills to the north, and the neighbourhood (houses + trees) generated
// offline from OSM streets + imagery (see surroundings.json / README).
// Everything outside the site lives in `world`: a TRUE-NORTH frame in METRES, rotated
// into the axis-aligned site frame (feet) used by the rest of the scene.
import {
    Group, Mesh, InstancedMesh, Object3D, Color, FogExp2, MathUtils, CanvasTexture, SRGBColorSpace,
    BoxGeometry, CylinderGeometry, IcosahedronGeometry, PlaneGeometry, MeshLambertMaterial,
    ACESFilmicToneMapping,
} from 'three';
import { satelliteGround, createSky } from '../shared/geo3d.js';
import { society } from './model.js';
import data from './surroundings.json';

const FT = 3.28084;
const STOREY = 3.2; // metres

// True sun position for Jaipur (~26.8° N) at three times of day
export const TIMES = {
    morning: { label: 'Morning', el: 14, az: 100, haze: 0xd8d2c4, exposure: 0.62, sun: 2.6 },
    noon: { label: 'Noon', el: 64, az: 165, haze: 0xc9d5dc, exposure: 0.55, sun: 3.0 },
    evening: { label: 'Evening', el: 6, az: 262, haze: 0xd9b996, exposure: 0.66, sun: 2.4 },
};

function lambert(color, extra = {}) {
    return new MeshLambertMaterial({ color, ...extra });
}

// Facade: `rows` storeys of small windows on white (tinted per instance)
function facadeTexture(rows) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32 * rows;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < rows; r++) {
        const y = r * 32;
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.fillRect(0, y + 29, 64, 3); // slab line
        g.fillStyle = '#4a4f52';
        g.fillRect(8, y + 9, 14, 14);
        g.fillRect(40, y + 9, 14, 14);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(8, y + 9, 14, 3);
        g.fillRect(40, y + 9, 14, 3);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
}

// Jaipur palette: sandstone beige, the city's terracotta pink, whitewash, cream, grey plaster
const PALETTE = [0xf3e6cc, 0xf0c9b4, 0xfbfaf6, 0xf6ecd4, 0xe4e0d8, 0xf5d6c2];

export function createSurroundings(scene, renderer, { invalidate }) {
    const { lat, lng } = society.location;
    const world = new Group();
    world.name = 'world';
    world.scale.setScalar(FT);
    world.rotation.y = MathUtils.degToRad(society.siteRotation || 0);
    scene.add(world);

    renderer.toneMapping = ACESFilmicToneMapping;

    // Plain dusty ground beyond the imagery so the horizon never shows a void
    // (draws before the imagery layers and, like them, writes no depth)
    const plain = new Mesh(new PlaneGeometry(60000, 60000).rotateX(-Math.PI / 2), lambert(0x8f8668, { depthWrite: false }));
    plain.renderOrder = -3;
    world.add(plain);
    world.add(satelliteGround({ lat, lng, renderer, onUpdate: invalidate }));

    // Sky lives in the site frame (feet). Its azimuths are site-frame, so subtract the site rotation.
    const sky = createSky(scene, { scale: 120000, elevation: TIMES.noon.el, azimuth: TIMES.noon.az - society.siteRotation });
    // The ground layers write no depth, so the sky dome must draw before them
    sky.sky.renderOrder = -10;
    scene.fog = new FogExp2(TIMES.noon.haze, 5.2e-5);

    const tmp = new Object3D();
    const col = new Color();

    // ─── Hills: Jhalana / Aravalli ridges 4–9 km to the N and NE ─────────
    const ridges = [
        { from: -40, to: 25, r: [4600, 6500], h: [90, 190], n: 34 }, // Jhalana hills
        { from: 25, to: 75, r: [7500, 9500], h: [140, 260], n: 22 },  // Galta / Amagarh ridge
        { from: -75, to: -40, r: [8500, 10500], h: [80, 150], n: 10 },
    ];
    const hillCount = ridges.reduce((s, r) => s + r.n, 0);
    const hills = new InstancedMesh(new IcosahedronGeometry(1, 1), lambert(0x857e63, { flatShading: true }), hillCount);
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    let hi = 0;
    ridges.forEach(rg => {
        for (let i = 0; i < rg.n; i++) {
            const b = MathUtils.degToRad(rg.from + ((rg.to - rg.from) * (i + rand() * 0.8)) / rg.n);
            const r = rg.r[0] + rand() * (rg.r[1] - rg.r[0]);
            const h = rg.h[0] + rand() * (rg.h[1] - rg.h[0]);
            const w = 500 + rand() * 900;
            tmp.position.set(Math.sin(b) * r, -h * 0.25, -Math.cos(b) * r);
            tmp.rotation.set(0, b + (rand() - 0.5), 0);
            tmp.scale.set(w, h, w * (0.45 + rand() * 0.3));
            tmp.updateMatrix();
            hills.setMatrixAt(hi, tmp.matrix);
            hills.setColorAt(hi++, col.setHSL(0.13 + rand() * 0.05, 0.12 + rand() * 0.08, 0.36 + rand() * 0.1));
        }
    });
    world.add(hills);

    // ─── Neighbourhood houses (instanced, grouped by storeys for the facade texture) ─
    const H = data.houses;
    const roofMat = lambert(0xbdb5a5);
    const byFloors = { 2: [], 3: [], 4: [] };
    for (let i = 0; i < H.length; i += 7) byFloors[Math.min(4, Math.max(2, H[i + 5]))].push(i);
    const tanks = [];
    Object.entries(byFloors).forEach(([floors, idx]) => {
        if (!idx.length) return;
        const facade = new MeshLambertMaterial({ map: facadeTexture(+floors) });
        const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), [facade, facade, roofMat, roofMat, facade, facade], idx.length);
        idx.forEach((i, k) => {
            const [e, n, rot, w, d, , pal] = H.slice(i, i + 7);
            const h = floors * STOREY + 0.8;
            tmp.position.set(e, 0, -n);
            tmp.rotation.set(0, -MathUtils.degToRad(rot), 0);
            tmp.scale.set(w, h, d);
            tmp.updateMatrix();
            mesh.setMatrixAt(k, tmp.matrix);
            mesh.setColorAt(k, col.setHex(PALETTE[pal % PALETTE.length]));
            // Black Sintex water tank on most roofs — a Jaipur skyline staple
            if ((i / 7) % 10 < 7) tanks.push([e, n, rot, w, d, h]);
        });
        world.add(mesh);
    });
    if (tanks.length) {
        const tankMesh = new InstancedMesh(new CylinderGeometry(0.65, 0.65, 1.3, 8).translate(0, 0.65, 0), lambert(0x222423), tanks.length);
        tanks.forEach(([e, n, rot, w, d, h], k) => {
            const r = MathUtils.degToRad(rot);
            const ox = w * 0.28, oz = d * 0.25; // a back corner of the roof
            tmp.position.set(e + ox * Math.cos(r) - oz * Math.sin(r), h, -n + ox * Math.sin(r) + oz * Math.cos(r));
            tmp.rotation.set(0, 0, 0);
            tmp.scale.set(1, 1, 1);
            tmp.updateMatrix();
            tankMesh.setMatrixAt(k, tmp.matrix);
        });
        world.add(tankMesh);
    }

    // ─── Trees on green land (scrub forest, parks) ──────────────────────
    const T = data.trees;
    const nTrees = T.length / 3;
    if (nTrees) {
        const crowns = new InstancedMesh(new IcosahedronGeometry(1, 0), lambert(0xffffff, { flatShading: true }), nTrees);
        const trunks = new InstancedMesh(new CylinderGeometry(0.15, 0.22, 1, 5).translate(0, 0.5, 0), lambert(0x5a4632), nTrees);
        for (let k = 0; k < nTrees; k++) {
            const e = T[k * 3], n = T[k * 3 + 1], s = T[k * 3 + 2] / 10;
            tmp.position.set(e, 0, -n);
            tmp.rotation.set(0, rand() * 3, 0);
            tmp.scale.set(1, 2.2 * s, 1);
            tmp.updateMatrix();
            trunks.setMatrixAt(k, tmp.matrix);
            tmp.position.y = 2.6 * s;
            tmp.scale.set(2.4 * s, 1.9 * s, 2.4 * s);
            tmp.updateMatrix();
            crowns.setMatrixAt(k, tmp.matrix);
            crowns.setColorAt(k, col.setHSL(0.2 + rand() * 0.07, 0.35 + rand() * 0.15, 0.2 + rand() * 0.08));
        }
        world.add(trunks, crowns);
    }

    let current = 'noon';
    function setTime(name) {
        const t = TIMES[name] || TIMES.noon;
        current = name in TIMES ? name : 'noon';
        sky.setSun(t.el, t.az - society.siteRotation);
        sky.sun.intensity = t.sun;
        sky.hemi.intensity = name === 'evening' ? 1.0 : 1.3;
        scene.fog.color.setHex(t.haze);
        renderer.toneMappingExposure = t.exposure;
        invalidate();
    }
    setTime('noon');

    return {
        world,
        setTime,
        get time() { return current; },
    };
}
