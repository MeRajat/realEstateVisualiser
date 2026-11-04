# Playbook — launching a new builder's site plan + admin

Learned building **Virasat Homes** (`virasat-homes/`, Nov 2026) on top of **The Greater Mansarovar** (root app).
Use `virasat-homes/` as the template: copy it, change the data, keep the code. Budget: about one working day,
most of it on digitising the layout and checking it by eye.

---

## 0. What to ask the builder for

| Need | Why | Watch out |
| --- | --- | --- |
| **Brochure PDF** (original file, not a WhatsApp screenshot) | The layout page is usually a large raster inside the PDF (Virasat: 6236 × 9506 px on the last page) | A phone screenshot of the layout is ~9× lower resolution: plot numbers are unreadable. Always ask for the PDF |
| **Google Maps link** to the site | Anchor on Earth | Short links (`maps.app.goo.gl`) resolve to a place page; the pin is often on the highway at the entrance, not the site centre |
| RERA project no. + promoter RERA | Must be on every ad / share message | Printed on the brochure cover; OCR it |
| Sales phone / WhatsApp | Call + WhatsApp buttons | Set as `VITE_<PROJECT>_PHONE` env vars, never hard-code |
| Admin password | Builder's own login | Set `<PROJECT>_ADMIN_PASSWORD` in Vercel; without it the shared `ADMIN_PASSWORD` is used |
| Price per gaj / sq yd (optional) | Shown after the customer shares a number | Enter in the admin, not in code |

Never put the user's or builder's personal details in requests to external services (Overpass, OSRM, tile
servers): use the generic User-Agent `realEstateVisualiser/1.0`.

---

## 1. Project folder + wiring (30 min)

```
<project>/index.html, admin/index.html     Vite entries (add both to vite.config.js input)
<project>/data/layout.json                 plots, boundary, amenities, roads, roadLabels, gate, geo, project facts
<project>/assets/                          layout-plan.webp (brochure layout), gate.webp (hero photo)
<project>/src/shared/site.js               adapter: layout.json → the shape the main site's views expect
<project>/src/customer/                    copies of src/customer/* (plan, view3d, walk, mapview, nearby, sheet, store…)
<project>/src/admin/                       admin panel
<project>/server/                          handler.js (routes), repo.js (Postgres + memory), auth.js, plots.js
<project>/tests/                           data checks + API flow (memory + PGlite)
<project>/tools/                           digitising scripts (see §2)
```

Checklist:
- `vite.config.js` → add `<project>` and `<project>Admin` inputs.
- `vercel.json` → add `<project>/data/layout.json` to `functions["api/index.js"].includeFiles`; add a `noindex` header for `/<project>/admin(.*)`.
- `server/router.js` → `if (path.startsWith('<project>/')) return handler(req, res, sub)`. **Never add files under `api/`**: Vercel Hobby allows 12 functions and everything runs through `api/index.js`.
- `package.json` test script → include `<project>/tests/*.test.mjs`.
- Database: reuse the existing Neon `DATABASE_URL`. Prefix every table (`vh_` for Virasat). Tables are created on first request; plots are seeded from layout.json.
- Rename storage keys in `src/customer/api.js` / `store.js` (`vh_vid`, `vh_lead`, …) and the API paths (`/api/<project>/…`) so projects don't share visitors or leads in the browser.

---

## 2. Digitising the layout (half a day)

Scripts live in `virasat-homes/tools/` (Python + OpenCV + PyMuPDF; OCR uses the macOS Vision framework via `ocr.swift`).
Work in a scratch folder with a venv: `pip install pymupdf opencv-python-headless numpy pillow playwright`.

1. **Extract the raster** from the PDF with PyMuPDF (`doc.extract_image(xref)`), don't render the page. Find the big image on the layout page.
2. **OCR in overlapping tiles** (`ocr.swift`, 1000 px tiles, 250 px overlap, `usesLanguageCorrection=false`). Vision reads plot numbers, `SQ.YD.` areas and `ROAD 30' WIDE` labels reliably; ~1000 boxes in 8 s.
3. **Segment plots** (`seg2.py`):
   - Sample the plan's fill colours (`np.unique` on a quarter-size image). Classify each pixel to the *nearest* colour from a list that includes non-plot colours (road grey, white, line brown, black, red), otherwise road grey gets mistaken for lavender.
   - Drop fill components touching the page edge (the brochure frame is often the same colour as plots).
   - Divider lines: dark pixels (`gray < 140`, excluding plot fills) opened with ±20° rotated line kernels. Light dividers in salmon blocks vanish at half resolution: work at **full resolution**.
   - Erode the plot interiors, label them, then watershed back to the lines.
4. **Assign IDs** (`regions.py`, `assign.py`): attach OCR text inside each region; prefer `L12` / `E7` style codes, then the most common integer. Then **check every block by eye** on zoomed overlays and write corrections into `overrides.json` (id, and merges for slivers split off by dimension lines). Finish with an exact ID-set check (Virasat: `1–190`, `L1–L24`, `E1–E24` = 238, no duplicates, none missing).
5. **Calibrate scale** from standard plots printed as `20' X 52'`, `25' X 60'`, `20' X 50'4"`: px per ft = √(area_px / area_ft²). All blocks agreed within 0.2% (5.466 px/ft). If they disagree, a block is mis-segmented.
6. **Fit clean polygons** (`polyfit.py`): `approxPolyDP` to 4 corners, then a robust `fitLine` per side and intersect neighbours. Guard: if a fitted corner is far from the traced contour (near-parallel sides), fall back to a direct outline. `cv2.approxPolyN` alone inflates area by up to 10%.
7. **Areas**: use the printed area when a nearby `xxx.xx SQ.YD.` matches the drawn area within 8%; otherwise store the measured area and mark `areaSource: "measured"` (the site says "measured from plan"). Virasat: 200 printed, 38 measured.
8. **Boundary** (`boundary.py`): red dashed line → colour mask → close gaps → fill the hole that contains a known plot. The dashes are usually *open along the main road*: close them with the road's right-of-way line. Mask out red items that touch the line (shop kiosks, title text) or they cut notches into the outline.
9. **Roads** (`roads.py`): from each `ROAD xx' WIDE` label, find the direction with the longest run through the road mask, walk to both ends, measure width. Store as centre-line segments `{a, b, widthFt}`; label width wins over measured width.
10. **Open areas**: inside boundary − plots − roads → components; name them from OCR (`PARK`, `PLAY GROUND`, `COMMERCIAL`, `PUBLIC UTILITY`, `PARKING`). Draw parks / green belts / play grounds green; commercial / utility / shops as built (grey) — and no trees in 3D.
11. **Facing**: probe outward from each plot edge into the road mask; road width from the nearest label of the same orientation. Keep at most two cardinal directions (corner plots).
12. **Verify from the JSON alone** (`verify_json.py`): redraw plots + boundary over satellite tiles using only `layout.json`'s transform.

---

## 3. Putting it on the map exactly (1–2 h)

1. **Resolve the Maps link**: `curl -sI -L <short link>` → place URL → fetch it with a browser UA → the `/maps/preview/place?…` URL inside it returns the pin (`null,null,lat,lng`) and the full address.
2. **Find the frontage road** in OpenStreetMap (Overpass `way(around:900,lat,lng)[highway]`). The pin is often *on* that road at the gate.
3. **Rotation**: measure the frontage road's angle on the plan (Hough on the long straight edges) and in OSM; the difference is the plan's rotation. Brochure north arrows are approximate — Virasat's plan was 3.9° off its own arrow.
4. **Translation**: put the plan road's centre line on the OSM centre line at the gate.
5. **Refine against the photo** (`fit.py`): Esri imagery at z18, colour-gradient magnitude, score = mean edge strength along the boundary (excluding the road side). Grid-search rotation ±3° and shift along / across the road, then a fine search. Cross-check with independent subsets (west / east / north edges) — they should agree within a few metres. Look for confirming features: Virasat's play-ground arm sits on an existing cart track.
6. Esri has no imagery beyond **z18** in rural Rajasthan: `maxNativeZoom: 18`, allow zoom to 20–21 by upscaling.
7. Store the transform in `layout.json.geo` (`lat0/lng0`, `origin`, `e0/n0`, `rotationDeg`, `mPerFt`, metres-per-degree). `src/shared/geo.js#toLatLng` must match the Python exactly; the tests check the site lands where expected.
8. Tell the builder the placement is fitted to imagery and their on-site demarcation is final.

---

## 4. Reusing the main site's customer experience

The customer site runs the **same modules** as the main site (plan, 3D, walk-through, map, nearby, sheet, house
layouts, filters, lead gate, live stock), fed by `<project>/src/shared/site.js`. That adapter must provide:

- `features[]` with `kind` (`boundary | common | road | plot`), `points`, `box`, `center`; roads also need `axis {a, b, width, angle}` (tilted roads); commons need `amenity`.
- `plots[]` with `status`, `areaSqFt`, `areaSqYd`, `gaj`, `dims {w, h, exact}`, `facing [{dir, road}]` in **North/East/South/West** (not 8-way), `price`, `priceLakh`.
- `GEO {lat, lng, rotationDeg, metersPerUnit, centerX, centerY, gate, gateDir}`, `toLatLng`, `ZONES` (empty array hides the zone filter), `SITE`, `stats`, `plotById`, `formatPrice`.
- Generic helpers (`status`, `house-layout`, `geo3d`, `place-kinds`, `smooth-pinch`) are re-exported from `src/shared/`, not copied.

Things that were Mansarovar-specific and had to change:
- Road labels / centre dashes / street lights assumed axis-aligned roads → use `axis`.
- Gate assumed on the east wall → `gate.point` + `gate.dir` (direction out to the main road); arches on each boulevard; walls get openings where roads leave the boundary; walk starts on a road, not on a median.
- 3D label texture size assumed a 700 × 950 ft plan → size from the boundary box.
- Size buckets in sq ft → **gaj** buckets (60 / 120 / 200); rate shown **per gaj**.
- Search box `inputmode="numeric"` blocks `L3` / `E12` on phones → `inputmode="text"` + `autocapitalize`.
- Nearby (`tools/fetch-nearby.mjs`): rural sites need much larger radii (hospitals 25 km, airport 40 km); drop empty categories; name the approach road properly (OSM ref `SH2` → "SH-2 (Kotkhawada Road)"); Overpass is flaky — run in the background and retry.
- About panel: RERA, amenities, brochure distance chart, brochure layout image, developer office (OCR the brochure pages).

---

## 5. Backend + admin (reuse as is)

- `repo.js`: one API, two stores — Neon Postgres (`sql\`…\``) and in-memory for local dev. Plots table seeded from layout.json.
- Optimistic locking: every plot has a `version`; a stale save gets **409** and the latest row (no double booking).
- Holds carry `hold_until` and free themselves on the next read.
- Public stock feed never includes names or phones. Serve it in the main site's format (`units[{id, status, hold_until, price_lakh, price_per_sqyd}]`, `hot[]`) so the shared views read it unchanged.
- Separate session cookie per project (`vh_admin`) so each builder logs in to their own panel.
- CSV export escapes leading `= + - @` (spreadsheet formula injection).
- Admin: Overview (status counts, area, value, visitors, 14-day chart, most viewed, latest enquiries), Plots (plan + list + editor with hold timer, price, customer, history), Customers (stage, call / WhatsApp, follow-up, notes, delete), Excel export. Same Google palette as the main dashboard.

---

## 6. Testing loop (do this every round)

- `npm test`: layout checks (ID set, sane areas, drawn vs stated area within 12%, every plot inside the boundary and facing a road, no overlaps, site lands near the pin, acres) + the full API flow run **twice**: in-memory and on real Postgres SQL through **PGlite** (`@electric-sql/pglite`, dev dependency) with a neon-style `sql` tag.
- Screenshots with Playwright driving the installed Chrome (`executable_path=/Applications/Google Chrome.app/…`, `wait_until='load'`, not `networkidle` — map tiles never go idle). Check: 390 × 844 phone, 320 × 640 small phone, 844 × 390 landscape, 1366 desktop; `document.documentElement.scrollWidth` must equal the viewport width.
- Walk every feature: plan, search (number and L / E codes), deep link `#plot-…` opened straight into the **map** view, filters, nearby, about, unlock form, plot card, house layout, 3D house, walk-through, admin login / edit / conflict / export.
- **Touch gestures**: emulate two-finger pinch and twist with CDP `Input.dispatchTouchEvent` on a `has_touch` context; log map bearing + zoom per frame. A plain pinch must keep bearing at exactly 0.
- **Smoothness**: `Emulation.setCPUThrottlingRate 4`, record rAF intervals during pinch / pan on map, plan and 3D. Target median 16.7 ms, no frames over 50 ms.
- Deploy = push to `main`. Wait for the new asset hash (`virasat-XXXX.js`) to appear in the live HTML, then repeat the key checks on the **live** URL.
- Live data test through the API with the real password: hold → public feed shows it → revert; post a test enquiry → see it in admin → stage + export → **delete it**. Leave production clean (all plots available, zero test leads).

---

## 7. Bugs we hit (check for them up front)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Map "vibrates" while pinch-zooming on phones | leaflet-rotate turns every small finger-angle change into rotation (±2–3° per frame) and applies rotate / zoom in different frames | `src/shared/smooth-pinch.js`: 12° rotation lock, atan2 angles, one-frame update. Must `disable()` the handler before swapping methods, then `enable()` (listener is bound at enable time) |
| Pinching the toolbar zooms the whole page | browser page zoom | `maximum-scale=1, user-scalable=no`, `gesturestart` preventDefault (iOS), `html { touch-action: manipulation }` |
| Blank map when a plot link opens in map view | `flyToBounds` before the map has a first view; `bringToFront` before SVG paths exist | `fitBounds` first, then focus; guard `poly._path` |
| Map flicker / data use during pinch | tile reload every zoom step | `updateWhenZooming: false` |
| Commercial / utility drawn as parks with trees | all commons treated as green | colour + trees by `amenity` kind |
| Walk starts facing trees | gate point is the planted median between two boulevards | start on the first boulevard's end |
| Walls across entrance roads in 3D | perimeter wall built on every boundary edge | cut openings where a road axis meets the boundary |
| Phones can't type `L3` | `inputmode="numeric"` | `inputmode="text"` |
| Tagline wraps to two lines on phones | long tagline | keep it under ~24 characters |

---

## 8. Next time, make it faster

- Turn `tools/*.py` into one CLI (`node/python tools/digitise.py brochure.pdf --page last`) that writes a draft `layout.json` + review overlays, leaving only `overrides.json` for the human pass.
- Move the copied customer modules into `src/customer/` behind a `site` parameter so a new project is data-only.
- Add a "plot visualiser" checklist screen in the admin for the builder to confirm plot numbers, areas and the map overlay before launch.
