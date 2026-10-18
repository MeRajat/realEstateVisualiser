# The Greater Mansarovar — Interactive Site Plan

Two apps on one Vercel project:

| URL | Who | What |
| --- | --- | --- |
| `/` | Customers | Mobile-first site plan (2D plan, 3D model, satellite map), plot search & filters, plot details, enquiry |
| `/admin/` | Builder / owner | Password-protected leads dashboard: visitors, leads, conversion, most-viewed plots, lead pipeline, CSV export |
| `/buildings/` | Customers | Apartment / society building visualiser (see `src/buildings/`) |

Customers can browse freely. Prices, plot dimensions and the layout diagram unlock once they share a name and mobile number (no OTP). Each lead is linked to the plots that visitor opened, so the builder sees what each customer is interested in.

## Stock (inventory) — Stage 1

The dashboard has three tabs: **Today**, **Stock** and **Customers**.

- **Stock**: tap any plot on the plan (or in the list) and mark it *Available / On hold / Booked / Sold / Not for sale*, set a price, note the customer, mobile and broker. A hold has a timer (1 day – 1 week) and frees itself when it runs out. Every change is logged with who/when, and two people can't overwrite each other (the second save is refused and reloaded).
- **Live everywhere**: the customer site and the apartment explorer read `/api/inventory` every minute, so a plot put on hold in the dashboard turns yellow on the 2D plan, 3D model and map without a redeploy. Customers never see names or numbers, only the status.
- **In demand**: plots with many looks / enquiries this week get a 🔥 badge for the builder and a "N people asked this week" pill for customers (real scarcity, not a claim).
- **Ask about your stock**: type in Hindi or English ("east facing under 40 lakh", "kaunse plot hold par hain"). With `ANTHROPIC_API_KEY` set the answer comes from Claude; without it a keyword search runs.
- **Morning note**: a 3–5 line summary on Today (calls due, holds ending, demand, missing prices) you can forward on WhatsApp. AI-written with a key, templated without.
- **Share availability**: one tap builds a WhatsApp message with today's counts and the live-map link. Add a broker's name and the link carries `?cp=Name`, so every customer who comes through it is credited to that broker (first touch wins) and shows up as "via Name" in Customers and the Excel export.
- **Excel**: download the stock list, or upload a CSV with columns `Plot, Status, Price (lakh), Note` to update many plots at once.
- Booking a customer by mobile number also creates / updates their card in Customers (source "Walk-in / phone").

```bash
npm test             # API tests (in-memory store, no network)
```

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
   - `VITE_RERA_ID`: the project's RERA number, printed on shared stock messages.
   - `ANTHROPIC_API_KEY`: optional. Turns on the AI assistant in the dashboard (ask about stock, morning note).
4. Redeploy.

## Project layout

```
index.html               customer page shell
admin/index.html         builder dashboard shell
src/shared/              plot data (plots_data.json) + derived geometry, zones, facing, pricing
src/customer/            customer app: plan.js (D3), view3d.js (three.js, lazy), mapview.js (Leaflet, lazy)
src/admin/               dashboard UI
api/                     Vercel serverless functions
  track.js               anonymous visits / plot views (+ broker tag ?cp=)
  lead.js                lead capture (name + mobile)
  inventory.js           public live stock (status + demand, no customer details)
  admin/inventory.js     stock: list, change status / price / hold, history, Excel upload
  admin/ai.js            assistant: ask about stock, morning note (Claude, with plain fallbacks)
  admin/session.js       sign in / out (signed HttpOnly cookie)
  admin/leads.js         list + update lead status / notes
  admin/stats.js         KPIs, daily series, most-viewed plots
  _lib/                  db (Neon or in-memory), units repo, inventory rules, ai, auth, http helpers
```

## Updating plots

Edit `src/shared/plots_data.json` (status, price, area) and redeploy. Polygons are in plan units (1 unit = 1 ft).

> Known data issue: plot numbers 180–183 appear twice (the four large plots on the south edge reuse them). They are shown as 180-2 … 183-2 until the correct numbers are filled in.
