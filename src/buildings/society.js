// ═══════════════════════════════════════════════════════════════════════════
//  SOCIETY CONFIG — replace this sample with the real project's data.
//  Full schema notes: src/buildings/README.md
//
//  Conventions
//  • All distances are in FEET. Site origin (0, 0) is the centre of the site.
//  • x grows to the EAST, z grows to the SOUTH (i.e. north is -z), like a map.
//  • x grows to the site's EAST, z to its SOUTH — in the SITE frame. The whole site
//    frame is turned `siteRotation` degrees clockwise from true north, so towers
//    and roads can line up with real roads while the config stays axis-aligned.
//  • Tower rotations are degrees CLOCKWISE (site frame): 0 | 90 | 180 | 270.
//  • Layout facing letters are site-frame 'N' | 'E' | 'S' | 'W'; true compass
//    facings (8-point) are derived from them + rotations.
// ═══════════════════════════════════════════════════════════════════════════

// ─── UNIT TYPES ──────────────────────────────────────────────────────────────
// width × depth is the unit's rectangular footprint. Rooms are rectangles in the
// unit's own plan coordinates: x → right, y → away from the FRONT (y = 0 is the
// facing side with the balcony/windows). Uncovered area is drawn as passage.
// door: { side: 'N'|'S'|'E'|'W' (edge of the room), at: 0..1 along that edge }
const unitTypes = {
    '2BHK': {
        name: '2 BHK',
        bhk: 2,
        carpet: 820, // sq.ft
        superArea: 1150, // sq.ft (super built-up — price is charged on this)
        width: 32,
        depth: 30,
        rooms: [
            { name: 'Balcony', kind: 'balcony', x: 0, y: 0, w: 18, h: 5 },
            { name: 'Living / Dining', kind: 'living', x: 0, y: 5, w: 18, h: 14, door: { side: 'N', at: 0.5 } },
            { name: 'Kitchen', kind: 'kitchen', x: 0, y: 21, w: 10, h: 9, door: { side: 'N', at: 0.5 } },
            { name: 'Foyer', kind: 'foyer', x: 10, y: 21, w: 8, h: 9, door: { side: 'S', at: 0.5 } },
            { name: 'Master Bedroom', kind: 'bed', x: 18, y: 0, w: 14, h: 13, door: { side: 'W', at: 0.8 } },
            { name: 'Toilet', kind: 'bath', x: 25, y: 13, w: 7, h: 6, door: { side: 'W', at: 0.5 } },
            { name: 'Bedroom 2', kind: 'bed', x: 18, y: 19, w: 14, h: 11, door: { side: 'W', at: 0.25 } },
        ],
    },
    '3BHK': {
        name: '3 BHK',
        bhk: 3,
        carpet: 1180,
        superArea: 1650,
        width: 45,
        depth: 32,
        rooms: [
            { name: 'Bedroom 2', kind: 'bed', x: 0, y: 0, w: 14, h: 12, door: { side: 'E', at: 0.8 } },
            { name: 'Toilet 2', kind: 'bath', x: 0, y: 12, w: 8, h: 6, door: { side: 'E', at: 0.5 } },
            { name: 'Kitchen', kind: 'kitchen', x: 0, y: 20, w: 12, h: 12, door: { side: 'E', at: 0.3 } },
            { name: 'Balcony', kind: 'balcony', x: 15, y: 0, w: 15, h: 5 },
            { name: 'Living / Dining', kind: 'living', x: 15, y: 5, w: 15, h: 18 },
            { name: 'Foyer', kind: 'foyer', x: 17, y: 25, w: 9, h: 7, door: { side: 'S', at: 0.5 } },
            { name: 'Master Bedroom', kind: 'bed', x: 31, y: 0, w: 14, h: 14, door: { side: 'W', at: 0.8 } },
            { name: 'Toilet 1', kind: 'bath', x: 38, y: 14, w: 7, h: 6, door: { side: 'W', at: 0.5 } },
            { name: 'Bedroom 3', kind: 'bed', x: 31, y: 20, w: 14, h: 12, door: { side: 'W', at: 0.3 } },
        ],
    },
};

// ─── TOWER LAYOUT HELPER ─────────────────────────────────────────────────────
// Four units per floor around a central lift/stair core: two units face the
// tower's front (local north), two face the back. You can also write `layout`
// by hand: [{ pos, type, x, z, facing, tags }] where x/z is the unit centre in
// tower-local feet (before the tower's rotation) and facing is local.
function fourPerFloor(type, { core = 12, frontTags = [], backTags = [] } = {}) {
    const { width: w, depth: d } = unitTypes[type];
    const zFront = -(core / 2 + d / 2);
    const zBack = core / 2 + d / 2;
    return [
        { pos: 1, type, x: -w / 2, z: zFront, facing: 'N', tags: ['corner', ...frontTags] },
        { pos: 2, type, x: w / 2, z: zFront, facing: 'N', tags: ['corner', ...frontTags] },
        { pos: 3, type, x: w / 2, z: zBack, facing: 'S', tags: ['corner', ...backTags] },
        { pos: 4, type, x: -w / 2, z: zBack, facing: 'S', tags: ['corner', ...backTags] },
    ];
}

export const society = {
    name: 'Jagatpura Heights',
    tagline: '2 & 3 BHK Apartments · Mahal Road, Jaipur',
    address: 'Off Mahal Road, Jagatpura, Jaipur, Rajasthan 302017',
    // Centre of the site. Sample parcel: open land west of Mahal Road, ~330 m south of
    // The Greater Mansarovar plots; checked against OSM roads/buildings (≥ 55 m clear).
    location: { lat: 26.807802, lng: 75.853483 },
    reraId: 'RAJ/P/2026/0000 (sample)',

    // Site footprint (rectangle, centred on location)
    site: { width: 420, depth: 360 },
    // Site frame → true north: the gate side (site south) faces ENE (69°), straight at
    // Mahal Road, which runs NNW–SSE just east of the parcel.
    siteRotation: 249,
    // Private approach road from the gate to Mahal Road (ft, along the gate direction)
    approach: { length: 243, width: 30, joins: 'Mahal Road' },
    floorHeight: 10, // ft, slab to slab
    stiltParking: true, // ground floor = open stilt parking; homes start on floor 1

    // ─── PRICING (₹ per sq.ft of super built-up area) ────────────────────────
    // rate = basePerSqft + floorRise.perFloor × max(0, floor − floorRise.fromFloor + 1)
    //        + Σ premiums[tag] + facingPremium[facing]
    // total = rate × superArea
    pricing: {
        currency: 'INR',
        basePerSqft: 4800,
        floorRise: { perFloor: 35, fromFloor: 3 },
        premiums: { corner: 75, 'amenity-facing': 150, 'road-facing': -50 },
        facingPremium: { E: 60, NE: 50, N: 40 }, // keyed by true 8-point facing
    },

    // ─── TOWERS ──────────────────────────────────────────────────────────────
    // Unit ids are "<tower>-<floor><pos 2 digits>", e.g. A-1203 = Tower A, floor 12, unit 03.
    towers: [
        {
            id: 'A', name: 'Tower A', x: -115, z: -100, rotation: 0, floors: 14,
            layout: fourPerFloor('3BHK', { frontTags: ['road-facing'], backTags: ['amenity-facing'] }),
        },
        {
            id: 'B', name: 'Tower B', x: 0, z: -100, rotation: 0, floors: 12,
            layout: fourPerFloor('2BHK', { frontTags: ['road-facing'], backTags: ['amenity-facing'] }),
        },
        {
            id: 'C', name: 'Tower C', x: 125, z: -95, rotation: 270, floors: 16,
            layout: fourPerFloor('2BHK', { backTags: [] }),
        },
    ],

    // ─── AVAILABILITY ────────────────────────────────────────────────────────
    // Explicit statuses win. Anything not listed uses `sampleMix` (deterministic
    // pseudo-random split) — set sampleMix to null once real data is entered and
    // every unlisted unit becomes Available.
    status: {
        'A-1203': 'Sold',
        'A-1204': 'Booked',
        'B-801': 'Sold',
    },
    sampleMix: { sold: 0.3, booked: 0.12 },

    // ─── AMENITIES ───────────────────────────────────────────────────────────
    // kind picks the 3D model: pool | gym | clubhouse | playground | temple | garden | parking
    // x/z = centre, w (east-west) × d (north-south) footprint in ft.
    amenities: [
        { id: 'pool', kind: 'pool', name: 'Swimming Pool', icon: '🏊', x: -20, z: 40, w: 70, d: 30,
          description: 'Temperature-controlled 25 m lap pool with a separate kids’ pool and sun deck.', timings: '6 AM – 9 PM' },
        { id: 'gym', kind: 'gym', name: 'Gymnasium', icon: '🏋️', x: -152, z: 40, w: 34, d: 40,
          description: 'Fully equipped air-conditioned gym with cardio, strength zone and a yoga studio.', timings: '5 AM – 10 PM' },
        { id: 'clubhouse', kind: 'clubhouse', name: 'Clubhouse', icon: '🏛️', x: -105, z: 40, w: 42, d: 44,
          description: 'Two-level clubhouse with banquet hall, indoor games, library and a café lounge.', timings: '8 AM – 11 PM' },
        { id: 'playground', kind: 'playground', name: 'Kids’ Play Area', icon: '🛝', x: 85, z: 35, w: 56, d: 44,
          description: 'Soft-floor play area with slides, swings and a climbing dome, visible from the towers.' },
        { id: 'temple', kind: 'temple', name: 'Temple', icon: '🛕', x: 150, z: 115, w: 26, d: 26,
          description: 'Sandstone temple with a traditional shikhara, set in a quiet garden corner.', timings: '5 AM – 9 PM' },
        { id: 'garden', kind: 'garden', name: 'Central Garden', icon: '🌳', x: -55, z: 115, w: 150, d: 50,
          description: 'Landscaped lawn with a jogging track, senior-citizen seating and shaded walkways.' },
        { id: 'parking', kind: 'parking', name: 'Visitor Parking', icon: '🅿️', x: 75, z: 115, w: 60, d: 36,
          description: 'Visitor parking near the main gate. Residents get covered stilt parking below each tower.' },
    ],

    // Internal roads (axis-aligned rectangles: centre x/z, w × d)
    roads: [
        { x: 0, z: -160, w: 400, d: 20 },
        { x: 0, z: 160, w: 400, d: 20 },
        { x: -190, z: 0, w: 20, d: 340 },
        { x: 190, z: 0, w: 20, d: 340 },
        { x: 0, z: -35, w: 360, d: 16 },
    ],
    gate: { x: 0, z: 180, width: 40 }, // main entrance on the site-south boundary (faces Mahal Road)

    unitTypes,
};
