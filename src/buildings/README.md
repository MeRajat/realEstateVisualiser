# Apartment explorer (`/buildings/`)

A 3D explorer for a residential society, driven entirely by `society.js`. To use it for a real project, replace the sample data there. You don't need to change any code.

| File | Role |
| --- | --- |
| `society.js` | **The data**: towers, unit types and room layouts, pricing, availability, amenities |
| `model.js` | Works out every unit (id, facing, status, rate, total), plus the filters and formatting |
| `floorplan.js` | Draws the 2D SVG floor plan from a unit type's room rectangles |
| `scene.js` | three.js scene: towers, amenities, orbit, window view, walk-around. It's a dynamic import, so three.js isn't in the first page load |
| `surroundings.js` | The real-world context: Esri satellite ground, sky and sun with time of day, haze, hills to the N and NE, and neighbourhood houses and trees (uses `src/shared/geo3d.js`) |
| `surroundings.json` | Generated house and tree positions around the site (see below) |
| `tools/gen_surroundings.py` | Regenerates `surroundings.json` from Esri imagery and OSM streets |
| `main.js` | UI: chips, filters, detail sheet, window view, lead capture, analytics |
| `buildings.css` | Styles. Self-contained, same Forest & Mint theme as the plots site |

## Location

The sample sits on a real, empty parcel west of **Mahal Road, Jagatpura, Jaipur**, centred on 26.807802 N, 75.853483 E. That's about 330 m south of The Greater Mansarovar plots.

- **Orientation:** `siteRotation: 249`, so the gate (site south) faces ENE, straight at Mahal Road. A 74 m private approach road (`approach`) links the gate to Mahal Road.
- **Clearance:** the footprint was checked against OpenStreetMap roads and buildings (Overpass) and the plot colony boundary. Nothing lies within 55 m. The approach road meets Mahal Road between the roadside structures visible in Esri imagery.
- **To move the society:**
  1. Change `location`, `siteRotation` and `approach`.
  2. Re-run `python3 src/buildings/tools/gen_surroundings.py`, after editing the constants at its top.

## Conventions

- All distances are in **feet**. The site's origin `(0, 0)` is its centre.
- **Site frame:** `x` grows to the site's east and `z` to its south. The whole frame is turned `siteRotation` degrees clockwise from true north. The rest of the config stays axis-aligned.
- **Tower rotations** are degrees **clockwise** in the site frame: `0 | 90 | 180 | 270`.
- **Facings:**
  - Layout `facing` is site-frame `'N' | 'E' | 'S' | 'W'`.
  - Buyers see the **true 8-point facing** (`unit.facing`, `unit.bearing`), worked out from the layout facing plus the tower and site rotations.
  - `pricing.facingPremium` is keyed by the true facing.

## Schema

```js
society = {
  name, tagline, address, location: { lat, lng }, reraId,
  location: { lat, lng },            // site centre on Earth
  site: { width, depth },            // ft, rectangle centred on location
  siteRotation: 249,                 // site frame → true north (deg clockwise)
  approach: { length, width, joins },// gate → main road (ft), road name
  floorHeight: 10,                   // ft slab-to-slab
  stiltParking: true,                // ground = parking, homes start at floor 1

  pricing: {
    basePerSqft: 4800,                         // ₹ / sq.ft of super area
    floorRise: { perFloor: 35, fromFloor: 3 }, // + ₹35/sq.ft per floor from floor 3 up
    premiums: { corner: 75, 'amenity-facing': 150, 'road-facing': -50 }, // keyed by unit tag
    facingPremium: { E: 60, NE: 50, N: 40 },   // keyed by TRUE 8-point facing
  },
  // rate  = base + perFloor × max(0, floor − fromFloor + 1) + Σ premiums[tag] + facingPremium[facing]
  // total = rate × unitType.superArea

  unitTypes: {
    '3BHK': {
      name: '3 BHK', bhk: 3, carpet: 1180, superArea: 1650,
      width: 45, depth: 32,                     // footprint, ft
      rooms: [                                  // plan coords: y = 0 is the FRONT (facing) side
        { name: 'Living / Dining', kind: 'living', x: 15, y: 5, w: 15, h: 18,
          door: { side: 'N', at: 0.5 } },       // optional door gap on that edge
        // kind: living | bed | kitchen | bath | balcony | foyer | utility
      ],
    },
  },

  towers: [{
    id: 'A', name: 'Tower A',
    x: -115, z: -100,                           // tower centre on the site
    rotation: 0,                                // clockwise from north
    floors: 14,                                 // residential floors
    layout: [                                   // one entry per unit on a typical floor
      { pos: 1, type: '3BHK', x: -22.5, z: -22, facing: 'N', tags: ['corner'] },
      // x/z = unit centre in tower-local ft (before rotation), facing is tower-local
    ],
  }],

  status: { 'A-1203': 'Sold', 'A-1204': 'Booked' },  // explicit statuses
  sampleMix: { sold: 0.3, booked: 0.12 },            // set to null for real data → others = Available

  amenities: [{
    id: 'pool', kind: 'pool',   // pool | gym | clubhouse | playground | temple | garden | parking
    name, icon: '🏊', description, timings,
    x, z, w, d,                 // centre + footprint (w = east-west, d = north-south)
  }],
  roads: [{ x, z, w, d }],      // internal roads (rectangles)
  gate: { x, z, width },        // main entrance on the south boundary
}
```

Unit ids are `<tower>-<floor><pos as 2 digits>`. For example, `A-1203` is Tower A, floor 12, unit 03.

`fourPerFloor(type, { frontTags, backTags })` in `society.js` generates the common layout: four units around a central core. For anything else, write `layout` by hand.

## Views

- **Orbit:** the default 3D model. The compass shows true north.
- **Window view:** pick a unit, then "Window view". The camera sits at the unit's window, at its real height, looking out along its facing.
  - Drag to look around (±80°). Pinch or scroll zooms.
  - Floor up/down buttons compare views from different floors.
- **Walk around:** a Street-View-like mode at eye level (1.6 m).
  - Drag to look and tap the ground to walk there. The forward/back buttons (or arrow keys) step along.
  - Movement stays inside the compound and the approach road, and you can't walk through buildings, cores or the pool.
  - Tapping a unit or amenity opens its card.
- **Time of day:** the sun button cycles morning, noon and evening. It changes the sun position, the sky and the haze colour.
- **Nearby:** read from `src/shared/nearby.json` through `import.meta.glob`. The button stays hidden if the file is missing.
  - Its drive times were computed from the plot colony and are labelled approximate.
  - The road at our gate (`approach.joins`) shows as "At the gate".

## Surroundings data

`surroundings.json` (~45 KB gzipped) loads lazily with the 3D scene. To build it, `gen_surroundings.py`:

1. Samples a jittered 11 m grid over about 2.9 × 2.9 km.
2. Classifies each 8 m window from Esri z17 imagery:
   - **Trees:** dark green canopy.
   - **Houses:** bright, busy texture within 40 m of an OSM street.
3. Skips carriageways, the society plus 25 m, the approach road and the plot colony.
4. Aligns each house to its nearest street, as 2–4 storeys in the Jaipur palette, with rooftop water tanks.
5. Thins houses and trees with distance.

Data credits: imagery © Esri, streets © OpenStreetMap contributors.

## Integrations

- **Lead capture** uses `submitLead` from `src/customer/api.js` and passes the unit id as `plotId`. Leads show up in the `/admin` dashboard with the apartment as the "interested plot".
- The visitor's lead is stored in `localStorage['gm_lead']`, the same key the plots site uses, so a returning visitor isn't asked twice.
- **Analytics** sent: `visit` once per session, `plot_view` when a unit opens, `enquire`, and `view_mode` (`unit-view`) when the window view opens.
- **Builder contact buttons** come from `VITE_BUILDER_PHONE` and `VITE_BUILDER_WHATSAPP`, as digits with the country code.
- **Deep link**: `/buildings/?unit=A-1203` opens that apartment. The "Share this apartment" button uses this link.
