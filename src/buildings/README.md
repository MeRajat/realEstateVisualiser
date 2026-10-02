# Apartment explorer (`/buildings/`)

A 3D explorer for a residential society, driven entirely by `society.js`. To use it for a real project, replace the sample data there. You don't need to change any code.

| File | Role |
| --- | --- |
| `society.js` | **The data**: towers, unit types and room layouts, pricing, availability, amenities |
| `model.js` | Works out every unit (id, facing, status, rate, total), plus the filters and formatting |
| `floorplan.js` | Draws the 2D SVG floor plan from a unit type's room rectangles |
| `scene.js` | three.js scene. It's a dynamic import, so three.js isn't in the first page load |
| `main.js` | UI: chips, filters, detail sheet, window view, lead capture, analytics |
| `buildings.css` | Styles. Self-contained, same Forest & Mint theme as the plots site |

## Conventions

- All distances are in **feet**. The site's origin `(0, 0)` is its centre.
- `x` grows to the east and `z` grows to the south, so north is `-z`, like a map.
- Rotations are degrees **clockwise from north**: `0 | 90 | 180 | 270`.
- Facing is one of `'N' | 'E' | 'S' | 'W'`.

## Schema

```js
society = {
  name, tagline, address, location: { lat, lng }, reraId,
  site: { width, depth },            // ft, rectangle centred on origin
  floorHeight: 10,                   // ft slab-to-slab
  stiltParking: true,                // ground = parking, homes start at floor 1

  pricing: {
    basePerSqft: 4800,                         // ₹ / sq.ft of super area
    floorRise: { perFloor: 35, fromFloor: 3 }, // + ₹35/sq.ft per floor from floor 3 up
    premiums: { corner: 75, 'amenity-facing': 150, 'road-facing': -50 }, // keyed by unit tag
    facingPremium: { E: 60, N: 40 },
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

## Integrations

- **Lead capture** uses `submitLead` from `src/customer/api.js` and passes the unit id as `plotId`. Leads show up in the `/admin` dashboard with the apartment as the "interested plot".
- The visitor's lead is stored in `localStorage['gm_lead']`, the same key the plots site uses, so a returning visitor isn't asked twice.
- **Analytics** sent: `visit` once per session, `plot_view` when a unit opens, `enquire`, and `view_mode` (`unit-view`) when the window view opens.
- **Builder contact buttons** come from `VITE_BUILDER_PHONE` and `VITE_BUILDER_WHATSAPP`, as digits with the country code.
- **Deep link**: `/buildings/?unit=A-1203` opens that apartment. The "Share this apartment" button uses this link.
