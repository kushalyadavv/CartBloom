# CartBloom Phase 3 — Storefront Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A theme app extension that renders the tier progress bar and gift chooser in the cart drawer and cart page, adds and removes gift lines, and agrees with the discount function about what is unlocked.

**Architecture:** An app embed block injects config from a shop metafield via Liquid — no network request to our infrastructure, ever. Vanilla JS bundles the same TypeScript entitlement core the vectors govern. Two render engines (`BAR`, `MILESTONE`) driven by design tokens.

**Tech Stack:** Theme app extension, vanilla TS compiled to a single IIFE, CSS custom properties, Shopify standard storefront events, `Shopify.actions`.

---

## Read before starting

- `docs/superpowers/specs/2026-07-27-cartbloom-design.md` — **§4** (zones, scope-agnostic qualifier), **§6** (entitlement semantics, arbitration), **§8** (widget design).
- `docs/superpowers/plans/task-25-checkout-verification.md` — what is already proven live, and what is not.
- `app/entitlement/` — the core the widget bundles. **Do not modify it**; it is shared with the vectors and the Rust parity contract.

## The two rules that govern this phase

**1. The storefront makes zero requests to our infrastructure.** Config arrives inlined by Liquid from a shop metafield. This is what makes the free Cloudflare tier viable at any traffic level (spec §4). A `fetch` to our origin on cart update would kill it at a few dozen active stores.

**2. Where the widget cannot resolve something with certainty, it resolves *conservatively* — under-counting, never over-counting.** The function can query collection membership live; the widget cannot. An under-promising bar is a cosmetic defect. An over-promising one charges a customer at checkout for something the bar said was free.

---

## Hard budget

Theme app extensions suggest **10 KB compressed JavaScript**. CSS gets 100 KB compressed, which is ample — so visual richness is nearly free and logic is not. No framework. Task 29 measures this before anything is built on the assumption that the core fits.

---

## Task 27: Scaffold the theme app extension

- [ ] **Step 1:** `shopify app generate extension` → **Theme app extension**, name `cartbloom-widget`. Interactive; a human must run it.
- [ ] **Step 2:** Record the generated layout in `docs/superpowers/plans/theme-extension-notes.md` — block types, asset paths, and the Liquid entry points. As in Task 20, take the truth from what the CLI produces, not from documentation.
- [ ] **Step 3:** Commit.

## Task 28: Config delivery via shop metafield

The function reads its config from the **discount node**. The widget needs the same offers on the **shop**, because Liquid can only read shop-level app metafields.

- [ ] **Step 1:** Declare `[shop.metafields.app.cartbloom-widget-config]` type `json` in `shopify.app.toml`, with storefront access enabled — Liquid cannot read it otherwise.
- [ ] **Step 2:** This payload is the **verbose** form, not the compact one (spec §4). It carries design tokens, copy, and placement that the function never reads, and it lives under the 128 KB `json` cap rather than the function's 10,000-byte limit.
- [ ] **Step 3:** In the app embed Liquid, inline it:

```liquid
{% assign cfg = shop.metafields.app.cartbloom-widget-config.value %}
{% if cfg %}
  <script>window.__CARTBLOOM__ = {{ cfg | json }};</script>
{% endif %}
```

- [ ] **Step 4:** Extend `scripts/make-test-offer.ts` to emit this third payload and print the `metafieldsSet` mutation for it, so the widget can be tested before the admin app exists. Task 25 established that pattern.
- [ ] **Step 5:** Commit.

## Task 29: Bundle the entitlement core and measure

**Gate.** If the core does not fit the budget, the widget's architecture changes before anything is built on it — the same discipline that caught the Javy instruction ceiling.

- [ ] **Step 1:** Add a bundler (esbuild) producing a single minified IIFE from `app/entitlement/` plus a trivial entry point.
- [ ] **Step 2:** Measure gzipped size. Record it.

| Result | Decision |
|---|---|
| < 6 KB | PASS — comfortable room for rendering and mounting |
| 6–9 KB | PASS WITH CAUTION — add a CI size gate now, not later |
| > 9 KB | STOP — tree-shake, or move rendering to a lazily-loaded second asset. Escalate. |

- [ ] **Step 3:** Add a CI check failing the build if the bundle exceeds 10 KB gzipped.
- [ ] **Step 4:** Commit with the measured number.

## Task 30: Mount strategy

Cart-drawer sections cannot take app blocks, so the embed loads the widget and it mounts itself. Three escalating strategies (spec §8).

- [ ] **Step 1:** **Standard events (primary).** Subscribe to `shopify:cart:view` and `shopify:cart:lines-update`; read state via `Shopify.actions.getCart()`. Shipped 2026-05-31 with working defaults on unmodified themes.
- [ ] **Step 2:** **Selector fixtures (fallback).** Ordered match against `cart-drawer-component`, `<cart-drawer>`, Dawn/Horizon structures, plus a `MutationObserver` for drawers rendered lazily on first open.
- [ ] **Step 3:** **Merchant anchor (escape hatch).** Mount into `[data-cartbloom-anchor]` when present. Offered only when 1 and 2 fail; merchant-pasted markup cannot be removed on uninstall and disqualifies Built for Shopify.
- [ ] **Step 4:** Legacy compatibility — intercept `fetch` on `/cart/*.js` for themes predating standard events.
- [ ] **Step 5:** Save HTML fixtures from Dawn and Horizon into `tests/fixtures/themes/` and unit-test that each strategy finds its mount point.
- [ ] **Step 6:** Commit.

## Task 31: Render engines

- [ ] **Step 1:** `BAR` — continuous track, with a `segmented` modifier producing the per-tier look.
- [ ] **Step 2:** `MILESTONE` — stepper with per-tier nodes in completed / current / locked states.
- [ ] **Step 3:** Drive both entirely from CSS custom properties so presets are token bundles, not code. Five presets: `candy`, `quiet`, `levelup`, `cool`, `theme-match`.
- [ ] **Step 4:** `theme-match` derives its palette from the theme's own CSS custom properties at runtime.
- [ ] **Step 5:** A contrast guard that **warns** rather than blocks when tokens produce unreadable combinations.
- [ ] **Step 6:** Commit.

## Task 32: Gift chooser and cart mutations

Where the widget earns its keep, and where it is easiest to get wrong.

- [ ] **Step 1:** Render a chooser for every entitlement with `requiresChoice: true`. Under `acrossTiers: SINGLE` with `CUSTOMER_CHOICE`, one chooser spans every unlocked tier's pool.
- [ ] **Step 2:** Claiming adds a line via `Shopify.actions.updateCart` with `_cartbloom_offer` and `_cartbloom_tier` properties. **Underscore-prefixed** so Shopify hides them from the customer and the order confirmation.
- [ ] **Step 3:** **Serialise every mutation through a single-flight queue**, with optimistic UI reconciled against the cart the action actually returns. Clicking two gifts quickly otherwise yields both or neither.
- [ ] **Step 4:** **`ALL_IN_POOL` auto-adds on unlock; `PICK_ONE` adds nothing until the customer chooses.** Never auto-add something they must then discover and change.
- [ ] **Step 5:** When the cart drops below a threshold, remove the gift **with a visible explanation**. Silent removal reads as a bug and generates support tickets for the merchant.
- [ ] **Step 6:** Swapping a `PICK_ONE` selection removes the old line and adds the new one atomically through the same queue.
- [ ] **Step 7:** Commit.

## Task 33: Conservative scope resolution

The core takes `inScope` pre-resolved per offer. The function resolves it from live `inCollections`. The widget has no such call.

- [ ] **Step 1:** For `ENTIRE_CART`, every line is in scope — exact, no ambiguity.
- [ ] **Step 2:** For `PRODUCTS`, match `product_id` from `/cart.js` against the configured list — also exact.
- [ ] **Step 3:** For `COLLECTIONS`, the widget cannot determine membership. Publish-time resolution embeds a product-ID list in the widget config; where a product is absent from that list, treat it as **out of scope**. Stale data then under-counts, which is the safe direction.
- [ ] **Step 4:** Cap the embedded list and, when a collection exceeds it, mark the offer `scopeUncertain` and have the widget hide its bar entirely rather than display a number that may be wrong.
- [ ] **Step 5:** Unit-test that every uncertain path under-counts. **A test that shows the widget over-counting is a release blocker**, not a bug to triage.
- [ ] **Step 6:** Commit.

## Task 34: Accessibility

Checked by Built for Shopify, and cheaper now than retrofitted.

- [ ] **Step 1:** `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax`.
- [ ] **Step 2:** A polite live region announcing tier unlocks.
- [ ] **Step 3:** The chooser is keyboard-navigable with visible focus; gift options are real buttons, not clickable divs.
- [ ] **Step 4:** Honour `prefers-reduced-motion` — no shimmer, no animated fill.
- [ ] **Step 5:** Commit.

## Task 35: Cart-page app block

The easy placement: a real app block the merchant drags into the cart template.

- [ ] **Step 1:** Add the block with schema settings for placement and per-placement visibility.
- [ ] **Step 2:** Share the render code with the drawer path; only mounting differs.
- [ ] **Step 3:** Commit.

## Task 36: Widget/function parity harness

The vectors bind the *core* implementations. They say nothing about the widget's **inputs** — and a wrong `inScope` produces a wrong answer from correct logic.

- [ ] **Step 1:** Build a harness feeding a `/cart.js` payload plus a config through the widget's normalisation into `resolveOffer`.
- [ ] **Step 2:** Assert its output matches what the function would produce for the equivalent cart, for every case where the widget can be certain.
- [ ] **Step 3:** For uncertain cases, assert the widget's answer is a **subset** of the function's — under-promising, never over.
- [ ] **Step 4:** Commit.

---

## Definition of done

- [ ] Bundle under 10 KB gzipped, enforced in CI
- [ ] Mounts on Dawn and Horizon with no theme edit
- [ ] Both render engines and all five presets working
- [ ] Chooser adds, swaps, and removes gift lines; mutations serialised
- [ ] Losing eligibility removes the gift with an explanation
- [ ] Every uncertain scope path under-counts, proven by test
- [ ] Zero requests to our infrastructure — verify in the network tab
- [ ] A real checkout where the widget grants a gift and the function honours it

## Carried into Phase 4

- **Publish must write three payloads:** compact config to the discount node, input variables to the discount node, verbose config to the shop metafield. All three from one atomic action, stamped with the same version hash.
- **`startsAt` must default to the past** or the scheduled state must be surfaced. Task 25 found that `discountAutomaticAppCreate` accepts a future `startsAt`, reports `SCHEDULED`, and silently does nothing — which cost real debugging time during verification.
- **Validate gift-pool products are in stock and published.** Task 25 put an out-of-stock product in a pool and it discounted fine, but customers cannot buy it.
