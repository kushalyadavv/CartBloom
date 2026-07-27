# Task 25 — End-to-end checkout verification

**Date:** 2026-07-28
**Store:** cartbloom-test.myshopify.com (dev)
**Discount node:** `gid://shopify/DiscountAutomaticNode/1825793507460`, status `ACTIVE`
**Result: PASS** on every case run.

The offer under test: free shipping at $50, then a `PICK_ONE` gift pool at $100 containing
variants `52565716795524` (The Minimal Snowboard) and `52565716861060` (The Out of Stock
Snowboard), both $885.95.

Config written by `scripts/make-test-offer.ts` through the real encoder, then set on the
discount node via `discountAutomaticAppCreate` in GraphiQL. No admin app exists yet.

---

## What passed

| # | Case | Expected | Observed |
|---|---|---|---|
| 1 | Cart $24.95, below all tiers | no discount | Shipping $8.00, no discount |
| 2 | Cart $500, above shipping tier | free shipping | Shipping FREE, **both** delivery options discounted (Express $15.00 → FREE) |
| 3 | One genuine gift claim | that line free | `discount: 88595`, line $0 |
| 4 | Same variant present unclaimed | full price | full price — discounting is per **cart line**, not per variant |
| 5 | **Three** claims across both pool variants | exactly one free | 3 claimed lines, **1 discounted**, total savings $885.95 |
| 6 | **Forged claim** — $500 Cream Sofa, not in the pool, carrying valid-looking attributes | full price | `discounts: []`, `line_level_total_discount: 0`, `discounted_price: 50000` |

## Why cases 5 and 6 are the ones that mattered

**Case 5 exercised the tie-break for real.** All three claims were worth exactly 88595, so
the value ranking was a three-way tie and the winner was decided entirely by line id
ascending, byte-lexicographic. That rule exists because Rust's `str` ordering and
JavaScript's UTF-16 comparison disagree above U+FFFF (spec §6, Arbitration). It produced a
single deterministic winner.

Case 5 also confirms arbitration is genuinely **cart-level**. The pre-Task-15 code was a
per-line predicate and would have granted all three — that was the inventory-loss defect
Phase 1.5 was written to fix, and this is the first evidence it is fixed in the shipped
Wasm rather than only in the pure functions.

**Case 6 is the §7 invariant:** the worst outcome of a client-side exploit is a confused
shopper, never a merchant losing inventory. 2,162 golden vectors prove
`validate_gift_lines` rejects a forged claim as a pure function. Only a live checkout
proves the *wiring* rejects it — that a hand-crafted `/cart/add.js` call cannot push a $500
sofa through as a free gift.

## Incidentally confirmed

- **The metafield namespace guess was right.** `[discount.metafields.app.cartbloom-config]`
  in `shopify.app.toml` does resolve to `namespace: "$app", key: "cartbloom-config"` in the
  function's input query. This was flagged as unverified; a mismatch would have produced a
  silent `null` and no discounts with no error anywhere.
- The compact wire format round-trips through a real metafield: TypeScript encoder →
  Shopify → Rust decoder.
- `discountAutomaticAppCreate` accepts `startsAt` in the future and reports status
  `SCHEDULED` rather than erroring. The discount silently does nothing until then. The
  admin app must default `startsAt` to the past or surface the scheduled state, or
  merchants will publish an offer and see nothing happen.

## Not yet tested

- **Quantity inflation.** `maxQty` is 1 and every test line was quantity 1, so the
  per-`(tierId, variantId)` budget was never stressed by a single line asking for 5.
- `ORDER_PERCENT` / `ORDER_FIXED` rewards — the test offer used only `FREE_SHIPPING` and
  `GIFT`.
- Collection scoping, customer-tag targeting, and country targeting — the test offer used
  `ENTIRE_CART` with empty audience lists, so `$tags` and `$collectionIds` were both empty
  and those code paths did not run.
- Multiple concurrent offers.
- `acrossTiers: SINGLE` in any of its three resolutions.

These are covered by vectors and by the mutation harness, but not yet by a live checkout.
