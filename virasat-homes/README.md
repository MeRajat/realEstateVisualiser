# Virasat Homes (Terrabloom) — plot map + admin

Everything for this project lives in this folder. It deploys with the rest of the repo on Vercel.

| URL | Who | What |
| --- | --- | --- |
| `/virasat-homes/` | Customers | Same experience as the main site plan: 2D plan, 3D model with walk-through, satellite map (rotate, overlay strength, nearby places with drive times), filters, search, plot card with price / size / possible house layout unlocked by sharing a number, enquiry, directions, share, live stock + demand badges, broker links (`?cp=`), plus an About panel (RERA, amenities, brochure distances and layout) |
| `/virasat-homes/admin/` | Builder | Sign in, overview, plot stock (status / price / customer / hold), customer enquiries, Excel (CSV) export |
| `/api/virasat/*` | Both | Served by the single Vercel function (`server/router.js` forwards to `server/handler.js` here) |

## Folder

```
index.html, admin/index.html   page shells (Vite entries)
data/layout.json               238 plots, boundary, open areas, road labels, map placement, project facts
assets/                        brochure layout image, gate photo
src/shared/site.js             Virasat data in the main site's shape (features, plots, GEO) for the shared views
src/shared/                    geo (plan → lat/lng), nearby.json (OSM places + OSRM drive times), admin plan view;
                               status / house-layout / geo3d / place-kinds re-export the main site's generic helpers
src/customer/                  customer site: the main site's plan / 3D / walk / map / nearby / sheet modules, adapted
                               (tilted roads, south gate on SH-2, gaj pricing, project endpoints)
src/admin/                     admin panel
server/                        API: handler (routes), repo (Neon Postgres or in-memory), auth, plots
tests/                         data checks + API flow on in-memory store and real Postgres SQL (PGlite)
tools/                         how data/layout.json was made from the brochure (Python + macOS Vision OCR), roads.py,
                               fetch-nearby.mjs (rebuilds src/shared/nearby.json)
```

## Data

- **Source:** last page of the developer brochure (6236 × 9506 px raster). Plots were segmented by colour and divider lines, numbered by OCR and checked by eye block by block. All 238 plots: 1–190, L1–L24, E1–E24.
- **Scale:** 5.466 px per ft, calibrated on the 20' × 52', 20' × 50'4" and 25' × 60' blocks (consistent within 0.2%).
- **Areas:** 200 plots use the area printed on the plan; 38 are measured from the drawing (`areaSource: "measured"`).
- **Placement on the map:** the owner's Google Maps pin (26.6185639, 75.9935556) sits on Kotkhawada Road (SH-2). The plan's SH-2 is drawn 200 ft wide, so the plan's road centre line was put on the real road (OpenStreetMap SH2), then shift and rotation were refined against field boundaries in Esri imagery (the play-ground arm sits on an existing cart track, the west and east edges on field edges). Result: plan rotated 3.9° clockwise from the brochure's north arrow, 20 m south-west along the road from the pin. Independent fits on the west, east and north edges agree within a few metres.

## Database (Vercel)

Uses the project's existing `DATABASE_URL` (Neon). Tables are created on first request, all prefixed `vh_`:
`vh_plots` (one row per plot, seeded from layout.json), `vh_plot_log`, `vh_leads`, `vh_visitors`, `vh_events`.

## Settings

- `VIRASAT_ADMIN_PASSWORD` — admin password for this project. If not set, `ADMIN_PASSWORD` is used.
- `VITE_VIRASAT_PHONE`, `VITE_VIRASAT_WHATSAPP` — optional 10-digit numbers; adds Call / WhatsApp buttons on plot cards.

## Tests

`npm test` runs these with the rest of the repo. `node --test virasat-homes/tests/*.test.mjs` runs only this project.
