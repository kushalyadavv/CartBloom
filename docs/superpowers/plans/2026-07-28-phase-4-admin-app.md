# CartBloom Phase 4 — Admin App & Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An embedded admin app on Cloudflare Workers where a merchant builds an offer through a six-step wizard and publishes it — writing the three payloads that make the discount function and the storefront widget work.

**Architecture:** React Router 7 on Workers with D1. A thin SSR shell; Polaris web components render client-side from Shopify's CDN. D1 holds drafts and shop records; publishing compiles them into metafields, which are the only thing production reads.

**Tech Stack:** `@shopify/shopify-app-react-router`, Cloudflare Workers + D1, Polaris web components, App Bridge, Admin GraphQL 2026-04.

---

## Read before starting

- `docs/superpowers/specs/2026-07-27-cartbloom-design.md` — **§4** (architecture and the two metafields), **§5** (data model), **§9** (wizard), **§10** (billing and plan caps), **§11** (review readiness).
- `docs/superpowers/plans/workers-deploy-result.md` — the measured CPU floor this is built on.
- `docs/superpowers/plans/task-25-checkout-verification.md` — what live testing already found, including two bugs this phase must prevent.
- `app/entitlement/config/encode.ts` — the compact encoder publishing uses.

## The budget this phase lives inside

Task 13 measured **3 ms CPU** for session verification + one D1 read + shell render, against a **10 ms** free-tier cap. That leaves roughly **6 ms per request** for everything here.

Consequences, not preferences:

- SSR a thin shell only. Polaris web components render client-side from Shopify's CDN.
- Data goes over JSON endpoints, not server-rendered markup.
- Plan state is cached in D1 with a TTL. A Partner API call per request would blow both the CPU budget and the latency.
- Any route that needs to do real work does it in a `fetch` from the client, not in a loader.

---

## Task 40: Port the scaffold to Workers + D1

The template ships Node + Prisma + SQLite. None of that runs on Workers.

**Files:** `wrangler.toml`, `app/db.server.ts`, `app/shopify.server.ts`, `package.json`

- [x] **Step 1:** Add `wrangler.toml` with a D1 binding. Create the production database with `wrangler d1 create cartbloom`.
- [x] **Step 2:** Replace Prisma with a D1-native data layer. Drizzle or hand-written SQL both work; Prisma's Workers story adds weight this budget cannot spare. Delete `prisma/`.
- [x] **Step 3:** Replace the session storage adapter with one backed by D1. Sessions are read on every request, so this is on the measured hot path — keep it to a single indexed query.
- [x] **Step 4:** Schema:

```sql
CREATE TABLE shops (
  shop TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,      -- offline, expiring
  scope TEXT,
  plan TEXT,                        -- cached; see Task 48
  plan_checked_at INTEGER,
  discount_node_id TEXT,            -- exactly one per shop
  installed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL REFERENCES shops(shop) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,             -- DRAFT | PUBLISHED | PAUSED
  config TEXT NOT NULL,             -- the verbose offer, as JSON
  updated_at INTEGER NOT NULL
);
CREATE INDEX offers_by_shop ON offers(shop, status);

-- Publishing is destructive to a live storefront. Keeping versions makes
-- "undo my last publish" a supported action rather than a support ticket.
CREATE TABLE published_versions (
  shop TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (shop, version_hash)
);
```

- [x] **Step 5:** Deploy and confirm the app loads embedded in the Shopify admin. Commit.

**Deployed:** `https://cartbloom.cartbloom.workers.dev` — 5 ms Worker startup. Routing,
auth bounce, and HMAC rejection verified by curl. Confirmed loading embedded in the admin on
cartbloom-test: the Offers page renders inside the iframe, which exercises
session-token auth and a live D1 read end to end.

One trap on the way: `automatically_update_urls_on_dev = true` had rewritten
`application_url` to an ephemeral trycloudflare tunnel during an earlier dev
session and left it there, so the installed app loaded a dead host. Now pinned
false — the same rewrite during review would repoint a reviewer at a laptop.

**Pulled forward from later tasks**, because leaving them undone would have meant
migrating code that was going to be deleted, or shipping a config pointing at a
route that did not exist:
- Task 46 Step 1 — the demo routes and the shop-domain login form are gone.
- Task 41 Step 5 — `/webhooks/compliance` exists and is declared in the TOML.

## Task 41: Managed installation and webhooks

Straight from the review playbook; each item is a real observed failure.

- [x] **Step 1:** Token exchange for managed installation. Expiring offline tokens (`expiring=1`) — non-expiring ones are rejected by the Admin API.
- [x] **Step 2:** Fresh `window.shopify.idToken()` per API request. Verify server-side: HMAC, `exp`, `aud` == client id, shop from `dest`. **Retry once on `401 invalid-session-token`** — backgrounded tabs throttle App Bridge's refresh timer.
- [x] **Step 3:** No cookies, no localStorage for auth. Must work in Chrome incognito with third-party cookies blocked.
- [x] **Step 4:** Register webhooks on **first token acquisition**, idempotent, gated by a once-per-shop flag. Never a manual script.
- [x] **Step 5:** Implement the three compliance topics. `shop/redact` genuinely purges every row for that shop.
- [x] **Step 6:** **A CI check that greps the built HTML for the real client id** and fails the build on a surviving placeholder. This failure is invisible locally and surfaces only as a rejected automated check.
- [ ] **Step 7:** Commit.

## Task 42: The offer wizard

> **Built and deployed, not yet driven by a human.** Every step, the preview and
> the scrubber are in. What no test covers is whether the Polaris web components
> report their values: React 18 does not bind custom-element events through JSX,
> so binding goes through one delegated `input`/`change` listener per step. That
> is version-proof in principle and unverified in a browser. If a field looks
> dead, that listener is the first place to look.

Six steps: **Trigger → Tiers → Gifts → Design → Placement → Review.** Drafts autosave to D1; nothing reaches the storefront until Publish.

- [x] **Step 1:** Wizard shell with step state in the URL, so a merchant can link to or reload a step.
- [x] **Step 2:** Trigger — subtotal or quantity; scope (entire cart / collections / products); audience (customer tags as **free text**, markets as country codes, schedule).
- [x] **Step 3:** Tiers — thresholds and reward types, validated ascending and non-duplicate.
- [x] **Step 4:** Gifts — product picker per tier, plus the two claim-policy axes. §6 is the hard part to explain; the Review step (Step 8) carries that load.
- [x] **Step 5:** Design — layout, preset, token overrides, live preview.
- [x] **Step 6:** Placement — drawer and cart page toggles.
- [x] **Step 7:** **A cart-value scrubber in the preview.** Drag from $0 past the top tier and watch tiers unlock and choosers appear. It turns "did I configure this right?" into a three-second answer instead of a test order, and it is the strongest feature-media asset for the listing.
- [x] **Step 8:** Review states the offer in plain language — *"Customers spending $100 or more can pick 1 of 3 gifts. At $150 they can pick 1 of 2 more, and keep both."* The claim-policy matrix is exactly what merchants misconfigure confidently.
- [ ] **Step 9:** Commit.

**The preview must render the real widget code**, not a lookalike. If preview and storefront diverge, merchants configure against a lie and file bugs nobody can reproduce. Import from `widget/src/`.

## Task 43: Resolve gift display data

The storefront chooser currently shows raw variant GIDs because nothing populates `giftDisplays`.

- [ ] **Step 1:** At publish, resolve each pool variant to `{ variantId, title, image, price }` via Admin GraphQL, batched in one query rather than per variant.
- [ ] **Step 2:** Embed the result in the **widget** payload only. The function has no use for it and its metafield budget is 10,000 bytes.
- [ ] **Step 3:** Handle a variant that no longer exists — drop it from the pool and warn, rather than publishing a gift nobody can claim.
- [ ] **Step 4:** Commit.

## Task 44: Publish-time validation

Everything here exists because it was observed failing, or because failure is silent.

- [ ] **Step 1: Config size.** Refuse to publish when the compact payload exceeds **10,000 bytes**, naming what to cut. An oversized metafield is delivered to the function as `null` — the offer silently stops working with no error anywhere.
- [ ] **Step 2: Input-variable caps.** At most **100 customer tags** and **100 collection ids** across all offers; Shopify errors past that.
- [ ] **Step 3: `startsAt` in the past.** Task 25 found `discountAutomaticAppCreate` accepts a future `startsAt`, reports `SCHEDULED`, and silently does nothing. Default to the past, or surface the scheduled state prominently.
- [ ] **Step 4: Gift products purchasable.** Warn when a pool variant is out of stock or unpublished. The function discounts it happily; the shopper cannot buy it.
- [ ] **Step 5: Plan caps** (§10), enforced at publish rather than at read.
- [ ] **Step 6: Tier sanity** — ascending thresholds, non-empty gift pools on `GIFT` tiers, a valid `pinnedTierId` when the policy is `PINNED`.
- [ ] **Step 7:** Commit.

## Task 45: The publish pipeline

- [ ] **Step 1:** Compile drafts into three payloads: **compact config** and **input variables** to the discount node, **verbose config** to the shop metafield. One version hash stamped across all three so drift is detectable.
- [ ] **Step 2:** Create or update **exactly one** automatic app discount per shop via `discountAutomaticAppCreate` / `Update`, idempotent, recording `discount_node_id`. The 25-node cap is shared with every other app the merchant has installed.
- [ ] **Step 3:** Write all three metafields. A partial publish leaves the function and widget disagreeing, which is the divergence the whole project is built to avoid — on failure, restore the previous version.
- [ ] **Step 4:** Record the version in `published_versions` and offer one-click rollback.
- [ ] **Step 5:** Commit.

## Task 46: Remove the template's demo artefacts

- [ ] **Step 1:** Delete the scaffold's example routes, the demo product mutation, and any remaining Prisma references.
- [ ] **Step 2:** Confirm `shopify.app.toml` scopes are still `write_discounts,read_products` and nothing widened them.
- [ ] **Step 3:** Nav icon: 16×16 SVG, single colour `currentColor`, transparent, no Shopify branding.
- [ ] **Step 4:** Commit.

## Task 47: Plan gating

- [ ] **Step 1:** Read plan state from the **Partner API** (`activeSubscription()`), cached in D1 with a short TTL.
- [ ] **Step 2:** Redirect to Shopify's hosted plan page rather than building billing UI: `https://admin.shopify.com/store/:handle/charges/:app_handle/pricing_plans`.
- [ ] **Step 3:** Handle `plan_handle` and `shop` redirect parameters on the welcome URL. No webhooks, no `charge_id`.
- [ ] **Step 4:** **Grandfather on downgrade.** Published offers keep running; editing or publishing beyond the new plan's limits is blocked with a persistent banner. Silently breaking a live storefront promotion earns a one-star review that never comes off.
- [ ] **Step 5:** Verify the frontend reflects the real plan. A flat-vs-nested response-shape mismatch is a classic 100%-reproducible bug that leaves the plan badge permanently wrong while adjacent fields look fine.
- [ ] **Step 6:** Commit.

## Task 48: End-to-end on a dev store

Nothing before this proves a merchant can actually use the app.

- [ ] **Step 1:** Install fresh on a clean dev store. No manual metafield writes.
- [ ] **Step 2:** Build a two-gift-tier offer entirely through the wizard.
- [ ] **Step 3:** Publish. Confirm all three metafields are written and the discount node exists.
- [ ] **Step 4:** On the storefront, confirm the widget renders with **real product names and images** — the thing `giftDisplays` exists for.
- [ ] **Step 5:** Claim a gift and check out. Confirm the discount applies.
- [ ] **Step 6:** Re-run the exploit attempts from Task 25 §Case 6. They must still bill at full price.
- [ ] **Step 7:** Record results alongside `task-25-checkout-verification.md`. Commit.

---

## Definition of done

- [ ] Runs on Workers + D1; CPU per admin request stays under the measured budget
- [ ] Managed installation, session-token auth, idempotent webhook registration, three compliance topics
- [ ] A merchant can build and publish an offer without touching GraphQL
- [ ] Publish writes all three payloads atomically, with rollback
- [ ] Storefront shows real product names and images
- [ ] Every validation in Task 44 is enforced and explained
- [ ] A real checkout honours a wizard-built offer, and forged claims still bill full price

## Carried into Phase 5

- Listing content, feature media (the cart scrubber is the strongest asset), reviewer instructions with exact button labels.
- Privacy policy matching what the code actually does — CartBloom requests **no** customer or order scopes.
- Run `shopify-app-store-review` before submitting.
- Verify the support inbox with a real round trip; forwarding-only routing is receive-only.
