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

## CRM — where customers drop off (Stage 3)

The **Customers** tab is a phone-first CRM in the spirit of Privyr, built for plots and flats:

- **Pipeline with drop-off**: New → Called → Site visit → Talking price → Booked for the last 30 days, with the conversion at each step. The weakest step is highlighted, with how many are waiting too long or were lost at each stage, speed to first call, no-show rate, and why customers said no (lost reasons).
- **What to do now**: action items found from your own numbers (uncalled leads, the biggest leak, stuck customers, no-shows, overdue call-backs, lost reasons, best vs worst source, team call-back speed). Each has a button that opens exactly those customers, often with a ready WhatsApp message. With an AI key, a short coach note is added.
- **One-tap work on a customer**: log a call (answered / no answer / busy — a missed call sets a reminder for tomorrow), send a WhatsApp template with the name and plot filled in, schedule a site visit (becomes the follow-up date), mark came / no-show, mark lost with a reason, assign to a salesperson. Everything lands in the customer's timeline.
- **Message templates** (English + Hindi) and the sales team are edited under the menu → *Messages & team*.
- **Instant lead alerts** on the builder's phone (menu → *Get alerts on this phone*) via Web Push. Needs `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`) and `VAPID_SUBJECT`. Alerts fire for new website leads, Facebook / Instagram form leads, and WhatsApp customers who want to talk or booked a visit.
- Sample data (menu → *Show sample data*) now includes calls, visits, no-shows and lost reasons so the pipeline and action items can be explored.

## Ads & WhatsApp — Stage 2

The **Ads** tab connects marketing to the CRM:

- **Campaign links**: pick Facebook / Instagram / WhatsApp / YouTube / Google, name the campaign, copy the link into the ad. Visitors and leads from it are counted under that campaign (UTM tags; `fbclid` is treated as Facebook).
- **What your ads brought**: per source / campaign — visitors, leads, site visits, bookings; type in what you spent per week and the table shows cost per lead and **cost per site visit**.
- **Facebook / Instagram lead ads** (`/api/webhooks/meta`): every form submission becomes a lead card within seconds, tagged with the campaign / ad name. Needs `META_VERIFY_TOKEN`, `META_PAGE_TOKEN` (and optionally `META_APP_SECRET` for signature checks).
- **WhatsApp assistant** (`/api/webhooks/whatsapp`): customers who message the business number (including from Click-to-WhatsApp ads) get an instant reply in their language. The assistant quotes live stock, learns budget / size / facing, books a site-visit day (saved as the follow-up date) and hands over to the team when asked. Every chat shows on the customer's card with a reply box. Needs `WA_VERIFY_TOKEN`, `WA_TOKEN`, `WA_PHONE_ID` (optional `WA_APP_SECRET`). Without an AI key a scripted 4-step flow runs; without WhatsApp credentials replies are stored but not sent (sandbox).
- **Write my Facebook ad**: three ad texts (English, Hindi, Hinglish) from today's stock with audience and daily-budget suggestions; the RERA number is appended when `VITE_RERA_ID` is set.
- **Try the assistant**: a sandbox chat on the Ads tab (nothing is sent).

```bash
npm test             # API tests (in-memory store, no network)
```

> Local AI without a key (disposable): set `AI_DEV_CLI=1` in `.env` and the API routes AI calls through the installed `claude` CLI. Never active on Vercel.

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
api/[...path].js         the one Vercel function; dispatches to server/router.js
server/                  API handlers (one file per endpoint, same names as the URL)
  track.js               anonymous visits / plot views (+ broker tag ?cp=)
  lead.js                lead capture (name + mobile)
  inventory.js           public live stock (status + demand, no customer details)
  admin/inventory.js     stock: list, change status / price / hold, history, Excel upload
  admin/ai.js            assistant: ask about stock, morning note, ad copy (Claude, with plain fallbacks)
  admin/marketing.js     campaigns, ad spend, WhatsApp threads, sandbox chat, setup status
  admin/insights.js      drop-off funnel, speed to contact, lost reasons, no-shows, action items (+ AI coach note)
  admin/activity.js      log calls / WhatsApp / visits per lead (moves the pipeline)
  admin/settings.js      message templates, team, builder's name
  admin/push.js          phone alert subscriptions (Web Push)
  webhooks/meta.js       Facebook / Instagram lead ads → lead cards
  webhooks/whatsapp.js   WhatsApp Cloud API → AI assistant → lead cards
  admin/session.js       sign in / out (signed HttpOnly cookie)
  admin/leads.js         list + update lead status / notes
  admin/stats.js         KPIs, daily series, most-viewed plots
  lib/                   db (Neon or in-memory), units / marketing / crm repos, inventory rules, insights, ai, wa-bot, push, auth, http helpers
```

## Updating plots

Edit `src/shared/plots_data.json` (status, price, area) and redeploy. Polygons are in plan units (1 unit = 1 ft).

> Known data issue: plot numbers 180–183 appear twice (the four large plots on the south edge reuse them). They are shown as 180-2 … 183-2 until the correct numbers are filled in.
