# The Greater Mansarovar — Interactive Site Plan

Two apps on one Vercel project:

| URL | Who | What |
| --- | --- | --- |
| `/` | Customers | Mobile-first site plan (2D plan, 3D model, satellite map), plot search & filters, plot details, enquiry |
| `/admin/` | Builder / owner | Password-protected leads dashboard: visitors, leads, conversion, most-viewed plots, lead pipeline, CSV export |
| `/buildings/` | Customers | Apartment / society building visualiser (see `src/buildings/`) |

Customers can browse freely. Prices, plot dimensions and the layout diagram unlock once they share a name and mobile number (no OTP). Each lead is linked to the plots that visitor opened, so the builder sees what each customer is interested in.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173  ·  admin: http://localhost:5173/admin/ (password: admin)
```

With no `DATABASE_URL`, the API uses an in-memory store (data resets on restart), so it runs with zero setup.

## Deploy on Vercel

1. Push this repo. The existing Vercel project picks up `vercel.json` (Vite build → `dist`, API routes from `api/`).
2. Vercel → project → **Storage** → **Create / Connect Database** → **Neon (Postgres)**. This adds `DATABASE_URL` to the project. Tables are created automatically on the first request.
3. Vercel → **Settings → Environment Variables**:
   - `ADMIN_PASSWORD`: required. The builder's dashboard password.
   - `SESSION_SECRET`: optional, a long random string.
   - `VITE_BUILDER_PHONE` / `VITE_BUILDER_WHATSAPP`: optional, e.g. `919876543210`. Adds Call / WhatsApp buttons after an enquiry.
4. Redeploy.

## Project layout

```
index.html               customer page shell
admin/index.html         builder dashboard shell
src/shared/              plot data (plots_data.json) + derived geometry, zones, facing, pricing
src/customer/            customer app: plan.js (D3), view3d.js (three.js, lazy), mapview.js (Leaflet, lazy)
src/admin/               dashboard UI
api/                     Vercel serverless functions
  track.js               anonymous visits / plot views
  lead.js                lead capture (name + mobile)
  admin/session.js       sign in / out (signed HttpOnly cookie)
  admin/leads.js         list + update lead status / notes
  admin/stats.js         KPIs, daily series, most-viewed plots
  _lib/                  db (Neon or in-memory), auth, http helpers
```

## Updating plots

Edit `src/shared/plots_data.json` (status, price, area) and redeploy. Polygons are in plan units (1 unit = 1 ft).

> Known data issue: plot numbers 180–183 appear twice (the four large plots on the south edge reuse them). They are shown as 180-2 … 183-2 until the correct numbers are filled in.
