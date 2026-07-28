# Task 13 — Cloudflare Workers + D1 hosting spike

**Date:** 2026-07-28
**Verdict: PASS.** The zero-cost hosting bet holds. Phase 4 builds the production
admin app on Workers + D1 as specified.

---

## Measured

A deployed Worker doing what every admin page load must do before any feature
code runs: verify a Shopify session token (HMAC-SHA256 via WebCrypto), read the
shop row from D1, and render the App Bridge shell.

| | CPU | Wall |
|---|---|---|
| Without token verification | median 2 ms, max 4 ms | 23–34 ms |
| **With HMAC verification** | **median 3 ms, max 4 ms** | 23–34 ms |
| Free-tier cap | **10 ms CPU** | not capped |

**Max observed is 40% of the cap**, comfortably inside the plan's "under ~3 ms
median = comfortable" band. HMAC verification costs roughly **1 ms**.

Wall time is 23–34 ms and mostly D1 round trip. It does not count against the
cap — Cloudflare bills CPU, and time blocked on I/O is free.

## What this floor represents

This is the cost *before* CartBloom does anything. Feature work — listing
offers, compiling config, calling the Admin API — adds on top of 3 ms, not
instead of it. Roughly 6 ms of headroom for everything else, which is why the
thin-shell architecture in spec §4 stays mandatory rather than merely preferred:

- SSR a thin HTML shell; let Polaris web components render client-side from
  Shopify's CDN.
- Deliver data as JSON, not as server-rendered markup.
- Cache plan state in D1 with a TTL rather than calling the Partner API per
  request.

## Also confirmed

- **The App Bridge contract survives.** The served HTML carries
  `<meta name="shopify-api-key">` with the real client id and a static
  `<script src=".../app-bridge.js">` first in `<head>` — the exact arrangement
  the review playbook flags as most likely to silently break, since Shopify's
  automated checks read the served document and cannot see a JS-injected tag.
- **D1 reads work from a Worker** and returned the seeded shop row.
- **Deploy is one command** once a `workers.dev` subdomain exists.

## Caveats, recorded rather than discovered later

- **Only 4 samples per run.** `wrangler tail` attaches after the first
  requests land, so most were missed. The numbers were consistent across both
  runs, but this is an indication, not a distribution.
- **D1 is single-region and was created in APAC.** A merchant loading the admin
  from Europe pays a trans-continental round trip per query. That is wall time,
  so it will not threaten the CPU cap — it will show up as a sluggish admin for
  distant merchants. Mitigate by keeping queries per request to a minimum and
  caching aggressively; revisit if merchants cluster outside APAC.
- **No OAuth round trip was performed.** The spike proves token *verification*
  and D1 access, not the full managed-installation token exchange. That is
  Phase 4 work and carries its own risk, though it is ordinary HTTP rather than
  anything CPU-bound.
- **This measures a hand-written Worker, not React Router.** The template's SSR
  is the remaining unknown. If a real route exceeds the cap, the floor measured
  here says the cause is the framework, not the platform — which is the useful
  thing to know.

## Escape hatches, unchanged

If a real admin route breaches 10 ms: Workers Paid at $5/month, or move only the
admin app to an Oracle Cloud Always Free VM while the storefront path stays on
Workers. Neither is needed now.

## Reproducing

```bash
cd spike/workers          # deleted after this record; see git history
npx wrangler d1 create cartbloom-spike
# paste database_id into wrangler.toml
npx wrangler deploy
curl -s "$BASE/setup"
npx wrangler tail --format=json   # CPU per invocation
```
