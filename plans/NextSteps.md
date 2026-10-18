# Plan — AI-native real-estate enabler for Indian builders

Who pays: the builder. What they pay for (from `MarketResearch.md`): never selling the same plot twice, live stock their brokers can see, leads that get a reply in a minute, and knowing which rupee of marketing produced a site visit.

## Stage 1 — Stock (branch `stage-1-inventory`) ✅ built
- Unit status (available / hold with timer / booked / sold / not for sale), price, customer, broker, note; change log; optimistic version check against double booking.
- Live on customer site + apartment explorer (`/api/inventory`, polled, edge-cached 30 s).
- Demand (🔥) from visitor events; morning note; "ask your stock" (Claude with keyword fallback); WhatsApp share with broker-tagged link (`?cp=`); Excel import/export.
- Broker credit on leads (first touch wins) shown in Customers + export; walk-in bookings create lead cards; DPDP-style consent line on the lead form.
- Tests: `npm test` (13 API tests on the in-memory store).

## Stage 2 — Facebook / Instagram ads + WhatsApp leads (branch `stage-2-ads-whatsapp`)
1. **UTM / campaign attribution**: capture `utm_source/medium/campaign/content` + `fbclid` on visits; leads inherit them; Sources card shows campaign-level visitors → leads → site visits → bookings.
2. **Meta Lead Ads webhook** (`/api/webhooks/meta`): verify token, receive `leadgen` events, pull the lead via Graph API with `META_PAGE_TOKEN`, create the lead with source `facebook`/`instagram` + ad name. Instant WhatsApp "thank you + brochure link" via Cloud API when configured.
3. **WhatsApp Cloud API webhook** (`/api/webhooks/whatsapp`): inbound messages → AI qualifier (budget, size, facing, when to visit) in Hindi/English → lead card with stage + summary; builder sees the conversation and can take over; "Test the bot" panel in the dashboard works without Meta credentials.
4. **Ad spend & cost per site visit**: builder enters weekly spend per campaign (or Insights API when token present); dashboard shows CPL, cost per site visit, cost per booking by source.
5. **Ad creative generator**: Claude writes 3 Hindi/English ad variants (primary text, headline, CTA) from live stock highlights, with the RERA line auto-added; suggested audience + daily budget from CPL benchmarks; copy-to-Meta-Ads-Manager (no Marketing API app review needed to ship).

## Stage 3 — Instagram / YouTube content (branch `stage-3-content`)
1. **Weekly content plan**: 7 post/reel ideas from what's actually happening (stock changes, demand, site progress), captions + hashtags in Hindi/English, RERA stamp check.
2. **Reel / Short scripts**: 30-second scripts + shot lists for the builder's phone; YouTube title/description/tags.
3. **Story cards**: auto-generated PNG cards (availability snapshot, "only N east-facing left", plot highlight) rendered in the browser with RERA number.
4. **Posting calendar** stored in the dashboard with "mark posted"; auto-publish via Instagram Graph API later (needs business account + app review).

## Later
- Multi-project / multi-builder accounts (schema already keys stock by unit id; add `project` column + builder login).
- Channel-partner read-only portal with brokerage ledger.
- Cost sheet + payment schedule per unit, WhatsApp-sendable.
- Instant WhatsApp first reply for website leads (needs WhatsApp Cloud API credentials).
