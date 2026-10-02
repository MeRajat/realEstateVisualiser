// Site frame (feet, x = site-east, z = site-south) ↔ real-world lat/lng, plus place helpers.
// The site frame is turned `siteRotation` degrees clockwise from true north.
import { society } from './society.js';
import { rotateXZ, compass8, DIR_NAMES } from './model.js';

const M_PER_FT = 0.3048;
const { lat: LAT0, lng: LNG0 } = society.location;
const M_LAT = 110850;
const M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);

/** Site (x, z) in feet → [lat, lng] */
export function siteToLatLng(x, z) {
    const [e, s] = rotateXZ(x, z, society.siteRotation || 0); // true east / south, feet
    return [LAT0 - (s * M_PER_FT) / M_LAT, LNG0 + (e * M_PER_FT) / M_LNG];
}

/** Axis-aligned site rectangle (centre x/z, w × d) → lat/lng polygon */
export function siteRect({ x, z, w, d }) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => siteToLatLng(x + (sx * w) / 2, z + (sz * d) / 2));
}

/** Distance (km) and compass direction from the society to a place */
export function placeFrom([lat, lng]) {
    const dE = (lng - LNG0) * M_LNG;
    const dN = (lat - LAT0) * M_LAT;
    const bearing = ((Math.atan2(dE, dN) * 180) / Math.PI + 360) % 360;
    const dir = compass8(bearing);
    return { km: Math.hypot(dE, dN) / 1000, bearing, dir, dirName: DIR_NAMES[dir], east: dE, north: dN };
}

/** Where the gate meets the outside world (lat/lng) — used for navigation links */
export function gateLatLng() {
    const { gate, site, approach } = society;
    return siteToLatLng(gate.x, site.depth / 2 + (approach?.length || 0));
}

const fmt = (n) => n.toFixed(6);
export const directionsTo = ([lat, lng]) => `https://www.google.com/maps/dir/?api=1&destination=${fmt(lat)},${fmt(lng)}&travelmode=driving`;
export const directionsBetween = ([la1, ln1], [la2, ln2]) =>
    `https://www.google.com/maps/dir/?api=1&origin=${fmt(la1)},${fmt(ln1)}&destination=${fmt(la2)},${fmt(ln2)}&travelmode=driving`;
