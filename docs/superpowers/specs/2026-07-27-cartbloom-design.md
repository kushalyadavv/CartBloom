# CartBloom — Design Specification

**Date:** 2026-07-27
**Status:** Approved for planning
**Product:** Public Shopify App Store app — tier-based cart progress bar with multi-gift tiers

---

## 1. Overview

CartBloom shows a tier-based progress bar in a Shopify store's cart drawer and cart page, and delivers the rewards those tiers promise: free shipping, order discounts, and free or discounted gifts.

The app is delivered as a **theme app embed** plus a **cart-page app block**, backed by a single Shopify Functions discount and an embedded admin app.

### Goals

1. Multi-tier progress visualisation, not a single free-shipping goal.
2. Actually generate the discounts, not just display progress toward them.
3. Per-tier **gift pools** where the customer chooses among several products.
4. Merchant-controlled **claim policy** governing how gifts across tiers combine.
5. Deep visual customisation that can match any theme or deliberately stand out.
6. A step-by-step setup wizard that is fluid and intuitive rather than a settings dump.

### Non-goals for v1

Product page placement, the visual placement picker, a customer-tag dropdown, analytics dashboards, and B2B/wholesale-specific pricing rules. All are deferred deliberately; see §13.

---

## 2. Competitive positioning

Research (2026-07-26) found two distinct clusters:

**Progress bar apps** — Apex Cart Progress Bar (4.0★, 37 reviews, free / $7.90), Hitsy (4.9★, 77 reviews), Progressify ($5/mo), and several single-goal free-shipping bars. Strong visuals, thin discount logic.

**Free-gift engines** — Kite: Discount, Free Gift, BOGO (4.9★, ~710 reviews, free to install) is the leader and already runs on Shopify Functions with tiered goal bars. Also BOGOS, CartKing, AutoCart, EG Auto Add to Cart, Salepify.

### Where the gap actually is

Multi-tier bars and Functions-based discounts are **table stakes**, not differentiation. Two of the four original differentiators are already contested.

The genuine wedge is the **claim policy engine** — merchant control over how gifts combine across tiers, and per-tier choice sets. No app found advertises this. Positioning and listing copy should lead with the entitlement rules, not with "progress bar."

*Caveat: this analysis came from App Store listings and comparison blogs, several of which are vendor-owned. Before finalising listing copy, install the top 2–3 competitors on a dev store and attempt to configure a "pick one of three gifts at tier 2, keep only the highest tier" offer to confirm the gap holds.*

---

## 3. Scope

### In scope for v1

| Area | Decision |
|---|---|
| Placements | Cart drawer + cart page |
| Trigger metrics | Cart subtotal, item quantity |
| Scoping | Entire cart, collections, specific products |
| Audience targeting | Customer tags (free text), markets, schedule window |
| Reward types | Free shipping, order % off, order fixed off, gift (free or discounted) |
| Claim policy | Both axes, all modes (§6) |
| Design system | 2 layout engines, 5 presets, full token overrides, "Match my theme" |
| Billing | Shopify App Pricing, 3 plans |

All capabilities above are **built** in v1; several are **gated by plan** (§10). Scoping, audience targeting, and scheduling are Pro-only features of a v1 codebase, not deferred work.

### Explicitly deferred

Product page placement · visual placement picker · customer-tag dropdown (would trigger Protected Customer Data) · analytics · A/B testing of offers.

---

## 4. Architecture

Three zones. Only Zone 1 runs on infrastructure we pay for, and no shopper request ever reaches it.

### Zone 1 — Ours (merchant traffic only)

**Cloudflare Workers free tier** — 100k requests/day, commercial use permitted, no cold-start sleep. Hosts:

- **Admin app** — React Router 7 (`shopify-app-template-react-router`, `@shopify/shopify-app-react-router`) embedded in the Shopify admin iframe.
- **D1** — shop records, offline access tokens, offer drafts, version history, cached plan state.
- **Webhook endpoints** — `app/uninstalled` plus the three compliance topics.

**Critical constraint:** Workers Free caps CPU at **10 ms per request** (CPU time only; network waits excluded). The admin app therefore serves a thin SSR shell and lets Polaris web components render client-side from Shopify's CDN, with data delivered as JSON. Heavy server-side rendering is not viable on this tier.

Exceeding 100k requests/day returns Error 1027 rather than degrading. Documented escape hatches, in order of preference: Workers Paid ($5/mo), or moving only the admin app to an Oracle Cloud Always Free VM while keeping the storefront path on Workers.

### Zone 2 — Shopify-hosted (runs on every checkout, free)

- **Discount function (Wasm)** — one function, one automatic app discount per shop. Reads config from the **discount node** app metafield. Emits `PRODUCT`, `ORDER`, and `SHIPPING` candidates in a single run via the 2026-04 Discount Function API.
- **Shop-level app metafield** — the same config JSON, storefront-readable, so Liquid can inline it.

### Zone 3 — Storefront (every shopper, free)

- **Theme app extension** — app embed block injects config as `window.__CARTBLOOM__` directly from the shop metafield in Liquid. **Zero network requests to our infrastructure.** Cart-page app block for native theme-editor placement.
- **Widget JS** — vanilla, ≤10 KB compressed (theme app extension suggested limit). CSS budget is 100 KB compressed, which is ample.

### Publishing

Editing happens against D1. **Publish** is an explicit, atomic action that:

1. Compiles the offer set into a single config JSON.
2. Writes it to the **discount node** app metafield (for the function).
3. Writes it to the **shop** app metafield (for Liquid), with storefront access enabled on the metafield definition.
4. Stamps both with the same version hash so drift is detectable.
5. Creates or updates the automatic app discount via `discountAutomaticAppCreate`.

Two metafields are required because the function can only read its own discount node's metafield, while Liquid can only read shop-level app metafields.

### The two metafields carry different payloads — measured 2026-07-27

**Shopify Functions cap metafield values at 10,000 bytes in input queries, and the total function input at 64,000 bytes.** An oversized metafield is delivered as **`null`** — silently, not as an error. The function would then grant nothing, and every offer in the shop would quietly stop working with no signal to the merchant.

A verbose config does not fit. Measured, with full GIDs and descriptive keys:

| Config | Verbose | Compact | Cap |
|---|---|---|---|
| 1 offer × 3 tiers × 3 gifts | 1,271 B | 369 B | 10,000 B |
| 5 offers × 6 tiers × 5 gifts | **16,858 B — over** | 4,243 B | 10,000 B |
| 10 offers × 6 tiers × 5 gifts | **33,698 B — over** | 8,473 B | 10,000 B |

So the **function payload is compact-encoded**: bare numeric ids rather than GIDs (`gid://shopify/ProductVariant/1000000000000` is 42 bytes; `1000000000000` is 13), single-character keys, and enums as small integers. This is a ~4× reduction and is what makes the Growth plan viable at all.

The **widget payload stays verbose and human-readable** — it goes in the shop metafield under the 128 KB `json` cap, where 25 offers costs 95 KB, and it additionally carries design tokens, copy, and placement that the function has no use for.

**Three consequences:**

1. **Publishing validates size and refuses to publish over budget.** Because the failure mode is a silent `null`, the merchant must be told at publish time — never discover it from a broken storefront.
2. **Beyond ~11 offers the function config shards** across several metafields on the discount node, read together in the input query. The 64,000-byte total input cap allows roughly 70 offers at 4–6 shards.
3. **"Unlimited offers" is not deliverable** and has been removed from the Pro plan (§10).

### The entitlement core and how parity is enforced

The problem: *given this cart and this config, which gifts are entitled?* must be answered identically by the discount function and the storefront widget. If they diverge, the bar reports "unlocked" while checkout charges full price — a bug that appears only at specific cart states and is close to unreproducible from a support ticket.

**The original design — one TypeScript module compiled to both targets — was measured and rejected.** See `docs/superpowers/plans/instruction-budget-result.md`. A Javy-compiled JavaScript core consumes **30.5M–43.8M instructions against Shopify's 11M limit**, even after correcting an algorithmic flaw in the benchmark and simulating a zero-cost I/O ABI. The corrected logic-only floor is ~18.8M, still 171% of budget before any I/O. Shopify's recommendation of Rust over JavaScript for Functions is load-bearing, not stylistic.

**Adopted design — two implementations, one behavioural source of truth:**

- The **discount function is Rust**, compiled to Wasm. It comfortably fits the instruction budget.
- The **widget is TypeScript**, staying small, debuggable, and free of a wasm load on the storefront critical path.
- **Parity is enforced by golden test vectors**: a committed JSON file of `(cart, offer) → expected entitlements` cases that **both** implementations must pass in CI. Either implementation failing any vector fails the build.

Vectors are **generated by enumerating the policy matrix**, not hand-written — both `withinTier` modes × `STACK` plus all three `SINGLE` resolutions × tier counts 1–6 × measures below, at, and above every threshold × gift-present and gift-absent carts. Hand-curated vectors drift, and a case absent from the vectors is a case where the two implementations can silently disagree.

**The residual risk is explicit:** parity now holds only over tested behaviour, not by construction. Vector coverage is therefore a first-class deliverable, not test hygiene. Any new entitlement behaviour must ship with vectors in the same commit.

**Qualifier — the core is scope-agnostic.** The two hosts do not have identical information available. The function can ask Shopify live whether a variant belongs to a collection; the widget cannot, because `/cart.js` exposes no collection membership. The core therefore accepts a **normalised cart in which each line already carries a resolved `inScope` flag per offer**, computed by each host by whatever means it has. The core guarantees that identical inputs produce identical entitlements; guaranteeing identical *inputs* is each host's responsibility.

Where the widget cannot resolve scope with certainty it must resolve **conservatively — under-counting rather than over-counting**. An under-promising bar is a cosmetic defect; an over-promising one is a customer charged at checkout for something the bar said was free.

---

## 5. Data model

```
Offer
  ├─ id, name, status: DRAFT | PUBLISHED | PAUSED
  ├─ trigger        SUBTOTAL | QUANTITY
  ├─ scope          ENTIRE_CART | COLLECTIONS(ids[]) | PRODUCTS(ids[])
  ├─ audience
  │    ├─ customerTags[]   free text, matched via buyerIdentity.customer.hasAnyTag
  │    ├─ markets[]
  │    └─ schedule { startsAt, endsAt }
  ├─ claimPolicy
  │    ├─ withinTier    ALL_IN_POOL | PICK_ONE
  │    └─ acrossTiers   STACK | SINGLE
  │         └─ if SINGLE: HIGHEST | PINNED(tierId) | CUSTOMER_CHOICE
  ├─ design
  │    ├─ layout   BAR | MILESTONE
  │    ├─ preset   candy | quiet | levelup | cool | theme-match
  │    └─ tokens   { fill, track, thickness, radius, animation, typography, … }
  ├─ placement     { drawer: bool, cartPage: bool }
  └─ tiers[]
       ├─ id, threshold
       ├─ reward   FREE_SHIPPING | ORDER_PERCENT | ORDER_FIXED | GIFT
       ├─ value    (for percent/fixed rewards)
       └─ giftPool[]  { variantId, discountType: FREE | PERCENT | FIXED, value, maxQty }
```

### Cart line attributes

Gift lines carry underscore-prefixed attributes, hidden from customers and order confirmations:

- `_cartbloom_offer` — offer id
- `_cartbloom_tier` — tier id
- `_cartbloom_v` — config version hash

These are **hints for the widget only**. The discount function never trusts them (§7).

---

## 6. Entitlement semantics

The claim policy is **two independent settings**, not one list of modes. This was the single most important modelling decision.

### Axis A — within a single tier

A tier may offer a pool of N products.

- **`ALL_IN_POOL`** — every product in the pool is granted.
- **`PICK_ONE`** — the customer chooses one; a chooser renders in the widget.

### Axis B — across unlocked tiers

When several tiers with gift pools are simultaneously unlocked:

- **`STACK`** — the customer receives an entitlement from every unlocked tier.
- **`SINGLE`** — exactly one tier grants, resolved by:
  - **`HIGHEST`** — highest unlocked tier, automatic.
  - **`PINNED(tierId)`** — merchant nominates a fixed tier.
  - **`CUSTOMER_CHOICE`** — the customer picks which tier to claim from.

### Worked example

Tiers at $50 (free shipping), $100 (Mug/Tote/Candle), $150 (Hoodie/Backpack). Cart subtotal $160.

- `PICK_ONE` + `STACK` → free shipping, one of {Mug, Tote, Candle}, **and** one of {Hoodie, Backpack}. Two choosers.
- `PICK_ONE` + `SINGLE:CUSTOMER_CHOICE` → free shipping, and exactly one product chosen from all five. One chooser spanning both tiers.
- `ALL_IN_POOL` + `STACK` → free shipping, Mug + Tote + Candle + Hoodie + Backpack.

### Scope of the claim policy

**The claim policy governs `GIFT` rewards only.** Non-gift rewards resolve independently:

- **`FREE_SHIPPING`** — applies if any unlocked tier grants it.
- **`ORDER_PERCENT` / `ORDER_FIXED`** — the **highest single value per reward type** among unlocked tiers applies. They do **not** accumulate. A 10% tier and a 20% tier both unlocked yields 20%, not 30%.

This holds regardless of `acrossTiers`. A merchant using `SINGLE` to restrict gifts does not thereby restrict free shipping.

### Unclaimed entitlements

An entitlement is a *right to a gift*, not a gift. Under `PICK_ONE`, a tier the customer has not yet chosen from simply has no corresponding cart line; the entitlement remains open and the chooser stays visible. Under `SINGLE:HIGHEST`, the entitlement resolves to the highest unlocked tier whether or not the customer acts on it — they cannot decline it in order to claim from a lower tier instead.

### Quantity within a pool

`PICK_ONE` selects one **product** from the pool, granted at that pool entry's `maxQty` units. A pool entry with `maxQty: 2` under `PICK_ONE` yields two units of the single chosen product, not one unit each of two products.

### Arbitration — when claims exceed entitlements

An entitlement is a *right* to a gift. Nothing prevents a cart from containing more claimed gift lines than the policy permits: a crafted `/cart/add.js` call can claim every product in every pool, and an honest shopper can end up with duplicate claims when the merchant republishes between two adds (the `_cartbloom_v` attribute differs, so Shopify does not merge the lines).

**The rule: the highest-value claim wins.** Every other conflicting claim bills at full price.

This costs the merchant nothing relative to honest play — a shopper choosing deliberately would have picked the most valuable option anyway — so exploiting the gap gains nothing, while the innocent duplicate case still receives the gift that was legitimately earned.

**"Value" means the discount amount the shopper would receive**, in minor units, computed per pool entry:

| `discountType` | Value |
|---|---|
| `FREE` | `unitPrice` |
| `PERCENT` | `floor(unitPrice × value / 100)` |
| `FIXED` | `min(value, unitPrice)` |

**Ties break on cart line id, ascending, byte-lexicographic.** This is not decoration: Rust's `HashMap` iteration order and `sort_unstable` are not TypeScript's, so an unspecified tie-break is a licence for the two implementations to disagree. The order is part of the contract.

**Budgets are allocated at cart level, not per line:**

- Under `PICK_ONE`, one claim per tier entitlement.
- Under `acrossTiers: SINGLE`, one claim across the whole offer.
- `maxQty` is a budget per `(tierId, variantId)` **summed across every line claiming it** — not a per-line cap. Three lines of quantity 1 against `maxQty: 1` yield one discounted unit, not three.

**Consequence for the API:** validation cannot be a per-line predicate. It requires a cart-level entry point that resolves once and allocates against remaining budget in the specified order. See §12 for the corresponding vector family.

### The expensive combination

`PICK_ONE` + `SINGLE:CUSTOMER_CHOICE` is the hardest case: the chooser spans every unlocked tier's pool at once, and changing selection requires removing one line and adding another atomically. It is also the most distinctive feature in the product. Budget for it explicitly.

---

## 7. Discount function design

### Contract

The function recomputes entitlement from cart state on every evaluation and emits discount candidates targeting only the gift lines it independently agrees with.

**It never trusts a cart line attribute.** If a shopper hand-crafts a `/cart/add.js` call tagging a $400 jacket with `_cartbloom_offer`, the function finds that variant is not in any entitled pool and emits no discount. The line bills at full price.

**Invariant to preserve in every future change:** the worst outcome of a client-side exploit is a confused shopper, never a merchant losing inventory.

### Algorithm

1. Read and parse config from the discount node metafield.
2. Compute **qualifying subtotal** — the undiscounted value of **non-gift lines only**.
3. Evaluate each offer's audience gates: customer tags, market, schedule window.
4. Determine unlocked tiers from qualifying subtotal or quantity, respecting scope.
5. Resolve entitlements through the claim policy (§6).
6. For each cart line bearing a `_cartbloom_*` attribute, verify the variant genuinely belongs to an entitled pool. If yes, emit a `PRODUCT` candidate targeting that line with quantity capped at the pool entry's `maxQty`. If no, emit nothing.
7. Emit `ORDER` candidates for order-level rewards and `SHIPPING` candidates for free shipping.

### Trap 1 — the oscillation bug

Thresholds must be computed from the **undiscounted** subtotal of **non-gift** lines. Any other basis produces: gift zeroes out → subtotal falls below threshold → entitlement lost → discount removed → subtotal rises → entitlement returns. The cart flickers, or checkout disagrees with the displayed state.

This is the most common way apps in this category break. The qualifying-subtotal calculation belongs in the shared entitlement core with dedicated tests.

### Trap 2 — quantity manipulation

The discount targets a cart line with an explicit quantity cap. A shopper who sets a gift line to quantity 5 receives one discounted unit; the remaining four bill at full price. The widget also clamps the quantity input, but the function is what makes it safe.

### Trap 3 — discount node budgeting

App-created automatic discounts are capped at 25 per store, **shared with every other app the merchant has installed**. CartBloom uses exactly **one** discount node per shop, config-driven. Creating one per tier or per offer would exhaust the merchant's budget and collide with other apps.

This is also why per-offer scheduling lives in our config JSON rather than on the discount node's own `startsAt` / `endsAt`.

### Function input query

Requires: cart lines (id, quantity, `cost.amountPerQuantity`, merchandise variant + product with `inAnyCollection`, line attributes), `cart.cost.subtotalAmount`, `buyerIdentity.customer.hasAnyTag(tags:)`, the discount node metafield, and localization/market (**availability unverified** — see §12).

---

## 8. Storefront widget

### Config delivery

The app embed block reads the shop metafield in Liquid and inlines it as `window.__CARTBLOOM__` at page render. No fetch, no app proxy, no latency, and **no requests to our infrastructure** — this is what makes the free hosting tier viable regardless of store traffic.

### Mount strategy

**Cart page** — a genuine app block. The merchant places it in the cart template via the theme editor and positions it natively.

**Cart drawer** — cart-drawer sections do not accept `@app` blocks, so the app embed loads the widget and it mounts in three escalating ways:

1. **Standard storefront events (primary).** Subscribe to `shopify:cart:view` and `shopify:cart:lines-update`; mutate through `Shopify.actions.updateCart` / `getCart` / `openCart`. Shipped 2026-05-31 for all Liquid storefronts, with working defaults on unmodified themes.
2. **Selector fixtures (fallback).** Ordered match against `cart-drawer-component`, `<cart-drawer>`, Dawn/Horizon structures, and popular paid themes, with a `MutationObserver` for lazily rendered drawers.
3. **Merchant anchor (escape hatch).** A `data-cartbloom-anchor` snippet the merchant pastes, offered only when 1 and 2 fail, paired with a cleanup helper.

The anchor is deliberately last: merchant-pasted code cannot be removed on uninstall and disqualifies the app from Built for Shopify status. We cannot place it ourselves — Asset API writes require a `write_themes` exemption CartBloom does not qualify for.

For themes predating the standard-events release, a compatibility layer intercepts `fetch` on `/cart/*.js` and re-reads `/cart.js`.

### Behaviour rules

- **Auto-add vs. chooser.** `ALL_IN_POOL` gifts auto-add on unlock. `PICK_ONE` adds nothing until the customer selects — never auto-add something they must then discover and change.
- **Losing eligibility.** Gifts are removed automatically when the cart falls below threshold, always with a visible explanation. Silent removal reads as a bug.
- **Serialised mutations.** All cart writes pass through a single-flight queue with optimistic UI reconciled against the cart the action actually returns. Rapid clicking otherwise produces duplicate or missing gift lines.

### Accessibility

`role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`, and a polite live region announcing tier unlocks. Checked by Built for Shopify, and cheaper now than retrofitted.

### Design system

Two layout engines, everything else design tokens:

- **`BAR`** — continuous track, with a `segmented` modifier producing the per-tier segmented look.
- **`MILESTONE`** — stepper with nodes per tier; completed, current, and locked states.

Five presets (`candy`, `quiet`, `levelup`, `cool`, `theme-match`) are token bundles plus a layout selection — new presets ship as JSON, not as a release. `theme-match` derives its palette from the theme's own CSS custom properties.

Token overrides need a **contrast guard** that warns when a merchant configures an unreadable combination. Warn, do not block.

---

## 9. Admin app & wizard

**Six steps:** Trigger → Tiers → Gifts → Design → Placement → Review.

- Drafts autosave to D1 continuously; nothing reaches the storefront until explicit Publish.
- **The live preview persists across every step**, not only the design step.
- **A cart-value scrubber** in the preview lets merchants drag from $0 past the top tier and watch tiers unlock and choosers appear — turning "did I configure this correctly?" into a three-second answer instead of a test order. This is also the strongest feature-media asset for the App Store listing.
- The **Review step states the offer in plain language**: *"Customers spending $100 or more can pick 1 of 3 gifts. At $150 they can pick 1 of 2 more, and keep both."* The claim-policy matrix is precisely what merchants misconfigure confidently.

The preview must render the **real widget code**, not a lookalike. If preview and storefront diverge, merchants configure against a lie and generate support tickets that cannot be reproduced. The widget must therefore be buildable in both an admin and a storefront context.

---

## 10. Billing

**Shopify App Pricing** (which replaced Managed Pricing on 2026-05-12). The Billing API is legacy and is not used.

- Plans are defined in the Partner Dashboard / app submission form.
- Merchants are redirected to Shopify's hosted plan page: `https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans`.
- Subscription state is read from the **Partner API** (`activeSubscription()`, `events()`), not the Admin API.
- The welcome URL receives `plan_handle` and `shop` as redirect parameters. No webhooks, no `charge_id`.
- Plan state is **cached in D1 with a short TTL** — per-request Partner API round-trips would be slow and would consume the 10 ms CPU budget.

### Plans

| | Free | Growth $9.99 | Pro $19.99 |
|---|---|---|---|
| Active offers | 1 | 5 | 25 |
| Tiers per offer | 3 | 6 | 12 |
| Gift pools + chooser | — | ✓ | ✓ |
| All presets & token overrides | — | ✓ | ✓ |
| Tag / collection / market targeting | — | — | ✓ |
| Scheduling | — | — | ✓ |
| CartBloom badge | shown | hidden | hidden |

Priced against a cheap market: Apex is $7.90, Progressify $5, and Kite is free-to-install with 710 reviews. CartBloom does not compete on price.

### Downgrade behaviour

Published offers **keep running**; editing or publishing beyond the new plan's limits is blocked with a persistent banner. This leaks some revenue, but the alternative — silently breaking a live storefront promotion — produces one-star reviews that never come off.

Plan limits are enforced at **publish** time, not read time.

---

## 11. Compliance & App Store review readiness

Derived from a prior app's review cycle; each item is a real observed failure mode.

### Embedded authentication

- App Bridge as a **static `<script>` in `<head>`**, before any other script, plus `<meta name="shopify-api-key">` with the real client ID baked in at build time. Never injected via JS — Shopify's automated checks inspect the served HTML.
- **A CI check greps the built HTML for the real client ID and fails the build if a placeholder survives.** This failure is invisible locally and surfaces only as a rejected automated check.
- Fresh `window.shopify.idToken()` on every API request (~60s lifetime), sent as `Authorization: Bearer`. Verified server-side: HMAC, `exp`, `aud` matches client ID, shop extracted from `dest`.
- No cookies, no localStorage for auth. Must work in Chrome incognito with third-party cookies blocked.
- Retry-once on `401 invalid-session-token` — backgrounded tabs throttle App Bridge's refresh timer.
- Managed installation via **token exchange**. Expiring offline access tokens (`expiring=1`); non-expiring tokens are rejected by the Admin API.

### Install flow

Never ask a merchant to type a `.myshopify.com` URL. After OAuth, redirect to `https://{shop}/admin/apps/{client_id}`, not our own origin. No interactable UI before OAuth completes.

### Webhooks

Registered automatically on first token acquisition, idempotent, gated by a once-per-shop flag — never a manual script. Declarative via TOML `[[webhooks.subscriptions]]` and `compliance_topics`.

The three compliance topics (`customers/data_request`, `customers/redact`, `shop/redact`) are implemented regardless of PII storage. `shop/redact` genuinely purges D1.

### Protected Customer Data

**CartBloom requests none.** Customer tags are entered as free text by the merchant and evaluated inside the discount function via `buyerIdentity.customer.hasAnyTag(tags:)`, which returns a boolean — no customer data is ever received. A tag *dropdown* would require querying the Customer resource and would pull the app into PCD Level 1 (review, data protection agreements with every merchant, retention policy, encryption at rest). That trade was made deliberately; see §13.

### Listing

16×16 single-colour `currentColor` SVG nav icon, transparent background, no Shopify branding. One-sentence subtitle without keyword stuffing or superlatives. Search terms as complete words, one concept each, excluding "Shopify" and competitor names. No fabricated statistics, no pricing outside the pricing section. Reviewer instructions with exact button labels, numbered steps, and required test data.

### Infrastructure

Valid TLS everywhere (automatic on Cloudflare). Encryption at rest verified rather than assumed. Support inbox verified with a real round-trip before relying on it for reviewer correspondence — forwarding-only routing is receive-only and needs a configured SMTP relay with SPF/DKIM/DMARC.

Run `shopify-app-store-review` (Shopify AI Toolkit) before submission.

---

## 12. Testing strategy

Weighted toward where mistakes cost merchants money.

| Layer | Approach |
|---|---|
| **Entitlement core** | Pure functions, exhaustively unit-tested across the full policy matrix: both axes × every across-tier mode × 1–6 tiers × gift-present/absent × at, above, and below each threshold. TDD applies here specifically. |
| **Mutation testing of the vectors** | **A permanent gate, not a one-off.** Deliberately-wrong implementations are run against `golden.json`; every one must be caught. This is the only thing that measures whether the vectors *constrain* anything — a large vector count proves nothing on its own. A first pass on 2026-07-27 found **9 of 13 wrong implementations passed all 1,968 vectors**, because the generator enumerated the policy matrix while holding the data matrix fixed. |
| **Vector data axes** | Vectors must vary the data, not only the policy: tier reward kind (including `ORDER_PERCENT` and `ORDER_FIXED` ladders), `inScope` membership, `pinnedTierId` validity, offer count, tier ordering and tied thresholds, empty gift pools, gift discount types, and gift-line shape (forged variant, locked tier, quantity above and below `maxQty`, multiple lines per entitlement). |
| **Validation vectors** | `validateGiftLines` needs its own vector family — `{ cart, offer } → Map<lineId, GiftValidation>`. It is the function that decides whether a merchant loses inventory, and it was initially left entirely uncovered. |
| **Qualifying subtotal** | Dedicated tests for the oscillation trap — gift lines must never contribute to threshold calculations. |
| **Discount function** | Golden-file tests on input/output JSON via Shopify's function testing harness. |
| **Widget mounting** | Against saved HTML fixtures from Dawn, Horizon, and several popular paid themes, covering both standard-events and legacy paths. |
| **Preview parity** | Assert the admin preview and the storefront widget produce identical output for identical config and cart state. |
| **E2E** | A real dev store taken through actual checkout, confirming the discount genuinely applies. Nothing else proves it. |

---

## 13. Risks & unverified assumptions

### Must be verified before anything depends on them

1. ~~**Javy instruction ceiling.**~~ **RESOLVED 2026-07-27 — the risk materialised.** Measured at 30.5M–43.8M instructions against an 11M budget; a JavaScript core is not viable. The function is Rust and parity moved to golden vectors (§4). The replacement risk is **vector coverage drift** — see below.
   
   **New risk — parity by testing rather than by construction.** The function and widget are now separate implementations. They agree only where a vector exercises them. Mitigations: vectors are generated by enumerating the policy matrix rather than hand-written; CI fails if either implementation fails any vector; new entitlement behaviour must ship with vectors in the same commit.
2. ~~**JSON metafield size limit.**~~ **RESOLVED 2026-07-27 — the risk materialised.** Shopify Functions cap metafield values at 10,000 bytes (total input 64,000) and deliver oversized values as a silent `null`. A verbose Growth-plan config measured 16,858 bytes. Fixed by compact-encoding the function payload (4x reduction), sharding beyond ~11 offers, publish-time size validation, and replacing "unlimited offers" with a real cap. See section 4.
3. **Market/country availability on the discount function input.** Documented input schema pages were unreachable during research. If unavailable, market targeting must be dropped from Pro or implemented differently.

### Ongoing risks

4. **Theme drift** breaking drawer auto-mount. Mitigated by the fixture suite, the standard-events primary path, and the anchor escape hatch.
5. **Free tier ceilings** — Workers' 100k req/day returns hard errors rather than degrading. Requires monitoring and a known tripwire. The design keeps shopper traffic off our infrastructure entirely, so this should only ever be merchant-driven.
6. **The 10 ms CPU cap** constraining admin rendering. Mitigated by the thin-shell architecture; escape hatch is Workers Paid at $5/mo.
7. **Kite's incumbency** (710 reviews, free to install). The listing must make the claim-policy difference legible within about five seconds.

---

## 14. Deferred

| Item | Reason |
|---|---|
| Product page placement | Straightforward (app block on OS 2.0), but adds wizard, styling, and preview surface. v1.1. |
| Visual placement picker | The strongest answer to arbitrary positioning without theme edits, but needs storefront preview, selector capture, and a resilience story for when merchants edit their theme. |
| Customer-tag dropdown | Would trigger Protected Customer Data Level 1. Ship free-text first, add post-launch when a PCD review can run on its own timeline rather than blocking initial approval. |
| Analytics | Revenue attribution and tier conversion rates. Valuable, but the Orders access it implies would trigger PCD. |
| A/B testing of offers | Natural follow-on once analytics exists. |

---

## Appendix — decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Claim policy shape | Two independent axes | Merchant's full expressiveness retained; wizard carries the teaching load |
| Targeting scope | Full engine | Collection scoping is native and nearly free; tags avoid PCD |
| Tag input | Free text | Keeps the app entirely out of Protected Customer Data |
| Stack | `shopify-app-template-react-router` | Managed install, App Bridge, TOML webhooks correct by default |
| Hosting | Cloudflare Workers + D1 | $0, commercial use permitted, no sleep; Vercel Hobby prohibits commercial use, Oracle reclaims idle instances |
| Storefront data path | Metafield → Liquid → inline | Zero requests to our infrastructure; makes free hosting traffic-independent |
| Function language | ~~TypeScript via Javy~~ → **Rust** | Measured 2026-07-27: JS costs 30.5M–43.8M instructions against an 11M cap. Not viable. |
| Function/widget parity | Golden test vectors, generated from the policy matrix | Shared compilation is impossible once the languages differ; parity moves from compile-time to CI |
| Discount nodes | Exactly one per shop | 25-node cap is shared across all of a merchant's apps |
| v1 placements | Cart drawer + cart page | The two placements that convert; product page deferred |
| Layout engines | 2 (BAR, MILESTONE) | Produces all four visual directions with two code paths |
| Downgrade behaviour | Grandfather + block edits | Avoids silently breaking a live storefront promotion |
