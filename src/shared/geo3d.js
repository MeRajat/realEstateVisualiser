// Shared realism helpers for the three.js scenes (plot walk-through + apartment window view):
//   • satelliteGround() — real Esri imagery around a lat/lng, draped on the ground
//   • createSky()       — physically based sky dome + matching sun light
// Everything here works in METRES with x = east, z = south (three.js: -z is "forward"/north).
// Callers scale / rotate the returned group into their own scene units.
import {
    Group, Mesh, PlaneGeometry, MeshLambertMaterial, CanvasTexture, SRGBColorSpace,
    Vector3, DirectionalLight, HemisphereLight, MathUtils, Color,
} from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const TILE_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

const lng2x = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
    const r = MathUtils.degToRad(lat);
    return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const metersPerTile = (lat, z) => (40075016.686 * Math.cos(MathUtils.degToRad(lat))) / 2 ** z;

function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null); // a missing tile just stays blank
        img.src = url;
    });
}

// Stitch the tiles covering a square of `sizeM` metres centred on (lat, lng) at zoom `z`.
async function stitch(lat, lng, z, sizeM, anisotropy) {
    const tileM = metersPerTile(lat, z);
    const half = sizeM / 2 / tileM; // in tiles
    const cx = lng2x(lng, z);
    const cy = lat2y(lat, z);
    const x0 = Math.floor(cx - half), x1 = Math.floor(cx + half);
    const y0 = Math.floor(cy - half), y1 = Math.floor(cy + half);
    const cols = x1 - x0 + 1, rows = y1 - y0 + 1;
    const canvas = document.createElement('canvas');
    canvas.width = cols * 256;
    canvas.height = rows * 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#5b5a44';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
            jobs.push(loadImage(TILE_URL(z, tx, ty)).then(img => {
                if (img) ctx.drawImage(img, (tx - x0) * 256, (ty - y0) * 256);
            }));
        }
    }
    await Promise.all(jobs);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = anisotropy;
    // Plane covers the whole stitched area; offset its centre from (lat, lng)
    const widthM = cols * tileM, heightM = rows * tileM;
    const centreX = ((x0 + cols / 2) - cx) * tileM;   // metres east of origin
    const centreZ = ((y0 + rows / 2) - cy) * tileM;   // metres south of origin
    return { tex, widthM, heightM, centreX, centreZ };
}

/**
 * Real satellite imagery as ground. Returns a Group immediately (empty) and fills it as tiles
 * arrive: a wide low-res layer for the horizon + a sharp layer around the site.
 * @param {object} o
 * @param {number} o.lat @param {number} o.lng  centre of the scene
 * @param {import('three').WebGLRenderer} o.renderer
 * @param {() => void} [o.onUpdate]  called when imagery lands (request a render)
 * @param {number} [o.innerSizeM=900] @param {number} [o.outerSizeM=4500]
 */
export function satelliteGround({ lat, lng, renderer, onUpdate, innerSizeM = 900, outerSizeM = 4500 }) {
    const group = new Group();
    group.name = 'satellite-ground';
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    // Ground layers draw first and never write depth, so the sharp layer always wins over the
    // wide one and nothing z-fights at long distances; scene objects simply draw on top.
    const layers = [
        { z: 15, size: outerSizeM, order: -2 },
        { z: 17, size: innerSizeM, order: -1 },
    ];
    layers.forEach(({ z, size, order }) => {
        stitch(lat, lng, z, size, aniso).then(({ tex, widthM, heightM, centreX, centreZ }) => {
            const mesh = new Mesh(new PlaneGeometry(widthM, heightM), new MeshLambertMaterial({ map: tex, depthWrite: false }));
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(centreX, 0, centreZ);
            mesh.renderOrder = order;
            mesh.receiveShadow = true;
            group.add(mesh);
            onUpdate?.();
        }).catch(() => {});
    });
    return group;
}

/**
 * Physically based sky + sun. Returns { sky, sun, hemi, setSun(elevationDeg, azimuthDeg) }.
 * `scale` is the sky dome radius in scene units.
 */
export function createSky(scene, { scale = 20000, elevation = 38, azimuth = 135, turbidity = 6 } = {}) {
    const sky = new Sky();
    sky.scale.setScalar(scale);
    sky.renderOrder = -10; // drawn first: ground layers don't write depth, so they must paint over it
    const u = sky.material.uniforms;
    u.turbidity.value = turbidity;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(sky);

    const sun = new DirectionalLight(0xfff4e0, 2.4);
    const hemi = new HemisphereLight(0xcfe6ff, 0x6b5b45, 1.25);
    scene.add(sun, sun.target, hemi);
    const dir = new Vector3();

    function setSun(el, az) {
        // azimuth measured clockwise from north (north = -z, east = +x)
        dir.setFromSphericalCoords(1, MathUtils.degToRad(90 - el), MathUtils.degToRad(180 - az));
        u.sunPosition.value.copy(dir);
        sun.position.copy(dir).multiplyScalar(1000);
        sun.color = new Color(0xfff4e0).lerp(new Color(0xffb36b), MathUtils.clamp((25 - el) / 25, 0, 1));
    }
    setSun(elevation, azimuth);
    return { sky, sun, hemi, setSun };
}

// Approximate metres per degree at a latitude (good to <0.5% over a few km)
export function metresPerDegree(lat) {
    return { lat: 110850, lng: 111320 * Math.cos(MathUtils.degToRad(lat)) };
}
