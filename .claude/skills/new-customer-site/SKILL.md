---
name: new-customer-site
description: Launch a new builder's interactive site plan + admin panel in this repo (brochure layout → plots on the satellite map → customer site with plan/3D/map + admin with real Postgres data). Use when the user wants to add a new project, colony, builder or customer site, or shares a brochure / layout plan / Google Maps link for one.
---

# New customer site

Follow `plans/CustomerSitePlaybook.md` (read it first, fully). It is the distilled learning from building
`virasat-homes/` and is the template to copy.

Order of work:
1. Intake (§0): get the **original brochure PDF** (not a screenshot) and the Google Maps link. Ask only if missing.
2. Create `<project>/` by copying `virasat-homes/` and wiring Vite, `vercel.json`, `server/router.js`, test script (§1). New API routes go through the router, never new files under `api/`.
3. Digitise the layout with `virasat-homes/tools/` (§2). Review every block by eye; finish with the exact plot-ID set check.
4. Place it on the map (§3) and verify from `layout.json` alone over satellite imagery.
5. Adapt `src/shared/site.js` and the project-specific bits (§4); keep the main site's look and features.
6. Test locally at phone sizes, with touch-gesture and CPU-throttled checks (§6); fix; `npm test`; build.
7. Commit, push to `main` (deploys), wait for the new asset hash, re-test on the live URL, run the live API test and clean up test data.

Rules: never send the user's personal details to external services; use generic User-Agents. Check the
"Bugs we hit" table (§7) before shipping. After finishing, add anything new you learned to the playbook.
