# CartBloom Phase 1 — Foundation & Entitlement Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the two architectural bets this design rests on — the Javy instruction budget and the Cloudflare Workers + D1 hosting choice — then build a fully tested, pure TypeScript entitlement core that both the discount function and the storefront widget will later compile against.

**Why these three things together:** the entitlement core is worthless if the function cannot run it (Task 1) and the app is worthless if it cannot be hosted for free (Task 13). Both bets are proven in week one, while changing course is still cheap.

**Architecture:** The entitlement core is a dependency-free TypeScript module exposing pure functions. It accepts a normalised cart (each line pre-resolved for scope by its host) plus an offer config, and returns entitlements. It imports nothing — no Shopify SDK, no DOM, no Node built-ins — so it stays small enough for the storefront widget's 10 KB budget.

> **⚠️ AMENDED 2026-07-27 — read before starting.** Task 1 ran and **FAILED its gate**. A Javy-compiled JavaScript core costs 30.5M–43.8M instructions against Shopify's 11M limit. The original "one TypeScript module compiled to both Wasm and browser" design is dead.
>
> **What changed:** the discount function will be written in **Rust** (Phase 2). This TypeScript core is now the **widget's implementation**, and the **source of the golden test vectors** that the Rust function must also pass. Parity moves from shared compilation to CI-enforced conformance.
>
> **What did NOT change:** every entitlement semantic in spec §6, and Tasks 3–12 below in their entirety. The TypeScript core is still built exactly as specified — it simply has one consumer instead of two. Task 14 is new and makes the vectors a deliverable.
>
> Task 1 is complete. Do not re-run it. Its record is in `docs/superpowers/plans/instruction-budget-result.md`.

**Tech Stack:** TypeScript (strict), Vitest, Shopify CLI, `shopify-app-template-react-router`, Cloudflare Workers + D1, Wrangler, function-runner.

**Money representation:** all monetary values are **integer minor units** (cents). No floats anywhere in the core. Percentages are integers 0–100.

---

## Plan sequence

This is Phase 1 of five. Each phase produces working, testable software.

| Phase | Produces |
|---|---|
| **1 — Foundation & Entitlement Core** (this plan) | Instruction budget proven; app scaffold deploys; core library fully tested |
| 2 — Discount Function | Function wrapping the core, deployed, verified applying real discounts at checkout |
| 3 — Storefront Widget | Theme app extension, mounting, bar + gift chooser rendering |
| 4 — Admin Wizard | 6-step wizard, live preview with cart scrubber, publish pipeline |
| 5 — Billing, Compliance & Submission | Shopify App Pricing, compliance webhooks, listing assets, review readiness |

---

## File structure

| File | Responsibility |
|---|---|
| `app/entitlement/types.ts` | All shared types. No logic. |
| `app/entitlement/subtotal.ts` | Qualifying subtotal / quantity — excludes gift lines, ignores discounts |
| `app/entitlement/tiers.ts` | Which tiers are unlocked for a given measure |
| `app/entitlement/withinTier.ts` | Axis A — resolves a tier's gift pool into candidate entitlements |
| `app/entitlement/acrossTiers.ts` | Axis B — reduces unlocked tiers to granting tiers |
| `app/entitlement/rewards.ts` | Non-gift reward resolution (shipping, order discounts) |
| `app/entitlement/resolve.ts` | Public entry point composing the above |
| `app/entitlement/validateGift.ts` | Security boundary — is this cart line genuinely entitled? |
| `app/entitlement/index.ts` | Barrel export |
| `spike/instruction-budget/` | Task 1 throwaway spike (deleted at end of Task 1) |

Each file has one responsibility and is independently testable. `resolve.ts` is the only file that knows about all the others.

---

## Task 1: Prove the instruction budget

**This task gates the entire architecture.** If a Javy-compiled entitlement core cannot evaluate a realistic worst-case cart inside 11 million instructions, the shared-core design does not work and Phase 2 must be re-planned around a Rust function. Find out now.

**Files:**
- Create: `spike/instruction-budget/` (throwaway — deleted in Step 8)

- [ ] **Step 1: Install function-runner**

```bash
brew tap shopify/shopify
brew install shopify-function-runner
function-runner --version
```

Expected: a version number prints. If Homebrew is unavailable, download a release binary from https://github.com/Shopify/function-runner/releases and put it on `PATH`.

- [ ] **Step 2: Scaffold a throwaway function**

```bash
mkdir -p spike/instruction-budget && cd spike/instruction-budget
npm init -y
npm install --save-dev @shopify/shopify_function javy-cli
```

- [ ] **Step 3: Write a worst-case entitlement stand-in**

Create `spike/instruction-budget/src/run.js`. This deliberately approximates the heaviest realistic workload: 200 cart lines, 5 offers, 6 tiers each, 5 gifts per pool.

```javascript
export function run(input) {
  const config = JSON.parse(input.discountNode.metafield.value);
  const lines = input.cart.lines;
  const operations = [];

  for (const offer of config.offers) {
    let measure = 0;
    for (const line of lines) {
      if (line.attribute && line.attribute.value) continue;
      measure += Number(line.cost.amountPerQuantity.amount) * 100 * line.quantity;
    }

    const unlocked = offer.tiers.filter((t) => measure >= t.threshold);
    if (unlocked.length === 0) continue;

    const granting =
      offer.claimPolicy.acrossTiers === 'STACK'
        ? unlocked
        : [unlocked[unlocked.length - 1]];

    for (const tier of granting) {
      for (const gift of tier.giftPool) {
        const match = lines.find(
          (l) => l.merchandise.id === gift.variantId
        );
        if (match) {
          operations.push({
            productDiscountsAdd: {
              candidates: [
                {
                  targets: [{ cartLine: { id: match.id, quantity: gift.maxQty } }],
                  value: { percentage: { value: 100 } },
                },
              ],
              selectionStrategy: 'ALL',
            },
          });
        }
      }
    }
  }

  return { operations };
}
```

- [ ] **Step 4: Generate worst-case input**

Create `spike/instruction-budget/gen-input.mjs`:

```javascript
import { writeFileSync } from 'node:fs';

const lines = Array.from({ length: 200 }, (_, i) => ({
  id: `gid://shopify/CartLine/${i}`,
  quantity: 2,
  cost: { amountPerQuantity: { amount: '24.99' } },
  merchandise: { id: `gid://shopify/ProductVariant/${i}`, __typename: 'ProductVariant' },
  attribute: { value: null },
}));

const offers = Array.from({ length: 5 }, (_, o) => ({
  id: `offer-${o}`,
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: Array.from({ length: 6 }, (_, t) => ({
    id: `tier-${o}-${t}`,
    threshold: (t + 1) * 5000,
    reward: 'GIFT',
    giftPool: Array.from({ length: 5 }, (_, g) => ({
      variantId: `gid://shopify/ProductVariant/${g}`,
      discountType: 'FREE',
      value: 0,
      maxQty: 1,
    })),
  })),
}));

writeFileSync(
  'input.json',
  JSON.stringify({
    cart: { lines },
    discountNode: { metafield: { value: JSON.stringify({ offers }) } },
  })
);
```

Run it:

```bash
node gen-input.mjs
```

Expected: `input.json` is created, roughly 60–80 KB.

- [ ] **Step 5: Build to Wasm**

```bash
npx shopify-function build --input src/run.js --output function.wasm
```

Expected: `function.wasm` exists. If the CLI signature differs in your installed version, run `npx shopify-function --help` and adapt — the goal is a `.wasm` artifact.

- [ ] **Step 6: Measure**

```bash
function-runner -f function.wasm -i input.json --json
```

Expected output includes an `instructions` count. **Record the number.**

- [ ] **Step 7: Evaluate against the gate**

| Result | Decision |
|---|---|
| **< 5.5M** (50% of budget) | PASS — proceed with TypeScript. Comfortable headroom. |
| **5.5M – 8.8M** (50–80%) | PASS WITH CAUTION — proceed, but Task 12's CI budget gate becomes mandatory, not optional. |
| **> 8.8M** (80%+) | FAIL — stop. Do not proceed to Task 2 without re-planning Phase 2 around a Rust function with a generated-parity widget core. Escalate to the human. |

Write the measured number and the decision into `docs/superpowers/plans/instruction-budget-result.md`, including the `function-runner` output verbatim.

- [ ] **Step 8: Commit the result and delete the spike**

```bash
cd ../..
rm -rf spike/
git add docs/superpowers/plans/instruction-budget-result.md
git commit -m "chore: record Javy instruction budget measurement

Gates the shared-entitlement-core architecture. See task 1 of the
foundation plan for the pass/fail thresholds."
```

---

## Task 2: Scaffold the app

**Files:**
- Create: entire app scaffold at repository root

- [ ] **Step 1: Initialise from the official template**

```bash
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

When prompted, name the app `CartBloom`. If the CLI insists on an empty directory, scaffold into `tmp-scaffold/` and move the contents up, preserving the existing `docs/` and `.gitignore`.

- [ ] **Step 2: Verify it builds**

```bash
npm install
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold app from shopify-app-template-react-router"
```

---

## Task 3: Configure Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Create the config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['app/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner works**

```bash
npm test
```

Expected: `No test files found` — this confirms Vitest runs and finds nothing yet.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest"
```

---

## Task 4: Entitlement core types

**Files:**
- Create: `app/entitlement/types.ts`

No tests — this file contains only type declarations and one frozen constant.

- [ ] **Step 1: Write the types**

Create `app/entitlement/types.ts`:

```typescript
/**
 * Shared entitlement types.
 *
 * This module and everything else in app/entitlement/ must remain free of
 * imports — no Shopify SDK, no DOM, no Node built-ins. It compiles unchanged
 * into both the Javy-built Wasm discount function and the browser widget.
 *
 * All money is integer minor units (cents). Percentages are integers 0-100.
 */

export type TriggerMetric = 'SUBTOTAL' | 'QUANTITY';

export type RewardKind =
  | 'FREE_SHIPPING'
  | 'ORDER_PERCENT'
  | 'ORDER_FIXED'
  | 'GIFT';

export type GiftDiscountType = 'FREE' | 'PERCENT' | 'FIXED';

export type WithinTierPolicy = 'ALL_IN_POOL' | 'PICK_ONE';

export type AcrossTierPolicy = 'STACK' | 'SINGLE';

export type SingleTierResolution = 'HIGHEST' | 'PINNED' | 'CUSTOMER_CHOICE';

export interface GiftPoolEntry {
  variantId: string;
  discountType: GiftDiscountType;
  /** Percent 0-100 when PERCENT; minor units when FIXED; ignored when FREE. */
  value: number;
  maxQty: number;
}

export interface Tier {
  id: string;
  /** Minor units when trigger is SUBTOTAL; item count when QUANTITY. */
  threshold: number;
  reward: RewardKind;
  /** Percent 0-100 for ORDER_PERCENT; minor units for ORDER_FIXED. */
  value?: number;
  giftPool: GiftPoolEntry[];
}

export interface ClaimPolicy {
  withinTier: WithinTierPolicy;
  acrossTiers: AcrossTierPolicy;
  /** Required when acrossTiers is SINGLE. */
  singleResolution?: SingleTierResolution;
  /** Required when singleResolution is PINNED. */
  pinnedTierId?: string;
}

export interface Offer {
  id: string;
  trigger: TriggerMetric;
  claimPolicy: ClaimPolicy;
  /** Must be sorted ascending by threshold. Callers guarantee this. */
  tiers: Tier[];
}

/**
 * A cart line already normalised by its host.
 *
 * `inScope` is resolved by the caller, not by this module — the discount
 * function can query collection membership live, the widget cannot. See the
 * scope-agnostic qualifier in the design spec.
 */
export interface CartLine {
  id: string;
  quantity: number;
  /** Undiscounted unit price in minor units. */
  unitPrice: number;
  variantId: string;
  /** Offer ids for which this line counts toward the threshold. */
  inScope: string[];
  /** Set from the _cartbloom_offer line attribute. Never trusted for entitlement. */
  giftOfferId?: string;
  /** Set from the _cartbloom_tier line attribute. Never trusted for entitlement. */
  giftTierId?: string;
}

export interface Cart {
  lines: CartLine[];
}

/** A customer's selection, when the policy requires one. */
export interface GiftSelection {
  offerId: string;
  tierId: string;
  variantId: string;
}

/** A right to a gift. Not a cart line — the customer may not have claimed it. */
export interface GiftEntitlement {
  offerId: string;
  tierId: string;
  /** Products the customer may claim. Length > 1 means a chooser is required. */
  candidates: GiftPoolEntry[];
  /** True when the customer must pick; false when all candidates are granted. */
  requiresChoice: boolean;
}

export interface NonGiftRewards {
  freeShipping: boolean;
  /** Highest single percent among unlocked tiers, or 0. */
  orderPercent: number;
  /** Highest single fixed amount in minor units among unlocked tiers, or 0. */
  orderFixed: number;
}

export interface OfferEntitlements {
  offerId: string;
  /** Measure that was compared against thresholds. */
  measure: number;
  unlockedTierIds: string[];
  gifts: GiftEntitlement[];
  rewards: NonGiftRewards;
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/entitlement/types.ts
git commit -m "feat: add entitlement core types"
```

---

## Task 5: Qualifying measure — the oscillation trap

The single most important calculation in the product. Gift lines must **never** contribute to thresholds, and discounts must **never** be subtracted. Get this wrong and the cart oscillates.

**Files:**
- Create: `app/entitlement/subtotal.ts`
- Test: `app/entitlement/subtotal.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/subtotal.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { qualifyingMeasure } from './subtotal';
import type { Cart, Offer } from './types';

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: [],
  ...over,
});

const cart = (lines: Cart['lines']): Cart => ({ lines });

describe('qualifyingMeasure', () => {
  it('sums unitPrice * quantity for in-scope lines', () => {
    const c = cart([
      { id: 'l1', quantity: 2, unitPrice: 2500, variantId: 'v1', inScope: ['o1'] },
      { id: 'l2', quantity: 1, unitPrice: 1000, variantId: 'v2', inScope: ['o1'] },
    ]);
    expect(qualifyingMeasure(c, offer())).toBe(6000);
  });

  it('excludes gift lines belonging to the same offer', () => {
    const c = cart([
      { id: 'l1', quantity: 1, unitPrice: 10000, variantId: 'v1', inScope: ['o1'] },
      {
        id: 'l2', quantity: 1, unitPrice: 4000, variantId: 'v2', inScope: ['o1'],
        giftOfferId: 'o1', giftTierId: 't1',
      },
    ]);
    expect(qualifyingMeasure(c, offer())).toBe(10000);
  });

  it('excludes gift lines belonging to any other offer', () => {
    const c = cart([
      { id: 'l1', quantity: 1, unitPrice: 10000, variantId: 'v1', inScope: ['o1'] },
      {
        id: 'l2', quantity: 1, unitPrice: 4000, variantId: 'v2', inScope: ['o1'],
        giftOfferId: 'other-offer', giftTierId: 't9',
      },
    ]);
    expect(qualifyingMeasure(c, offer())).toBe(10000);
  });

  it('excludes lines not in scope for this offer', () => {
    const c = cart([
      { id: 'l1', quantity: 1, unitPrice: 5000, variantId: 'v1', inScope: ['o1'] },
      { id: 'l2', quantity: 1, unitPrice: 9900, variantId: 'v2', inScope: ['o2'] },
    ]);
    expect(qualifyingMeasure(c, offer())).toBe(5000);
  });

  it('counts items rather than money when trigger is QUANTITY', () => {
    const c = cart([
      { id: 'l1', quantity: 3, unitPrice: 2500, variantId: 'v1', inScope: ['o1'] },
      { id: 'l2', quantity: 2, unitPrice: 1000, variantId: 'v2', inScope: ['o1'] },
    ]);
    expect(qualifyingMeasure(c, offer({ trigger: 'QUANTITY' }))).toBe(5);
  });

  it('excludes gift lines from the QUANTITY measure too', () => {
    const c = cart([
      { id: 'l1', quantity: 3, unitPrice: 2500, variantId: 'v1', inScope: ['o1'] },
      {
        id: 'l2', quantity: 4, unitPrice: 0, variantId: 'v2', inScope: ['o1'],
        giftOfferId: 'o1', giftTierId: 't1',
      },
    ]);
    expect(qualifyingMeasure(c, offer({ trigger: 'QUANTITY' }))).toBe(3);
  });

  it('returns 0 for an empty cart', () => {
    expect(qualifyingMeasure(cart([]), offer())).toBe(0);
  });

  it('returns 0 when every line is a gift', () => {
    const c = cart([
      {
        id: 'l1', quantity: 1, unitPrice: 4000, variantId: 'v1', inScope: ['o1'],
        giftOfferId: 'o1', giftTierId: 't1',
      },
    ]);
    expect(qualifyingMeasure(c, offer())).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/subtotal.test.ts
```

Expected: FAIL — `Failed to resolve import "./subtotal"`.

- [ ] **Step 3: Implement**

Create `app/entitlement/subtotal.ts`:

```typescript
import type { Cart, CartLine, Offer } from './types';

/** A line is a gift if any offer marked it as one. Gifts never count. */
function isGiftLine(line: CartLine): boolean {
  return line.giftOfferId !== undefined;
}

/**
 * The measure compared against tier thresholds.
 *
 * Deliberately computed from UNDISCOUNTED unit prices of NON-GIFT lines only.
 * Any other basis causes oscillation: a gift zeroes out, the subtotal drops
 * below the threshold, the entitlement is lost, the discount is removed, the
 * subtotal rises, and the entitlement returns.
 */
export function qualifyingMeasure(cart: Cart, offer: Offer): number {
  let total = 0;
  for (const line of cart.lines) {
    if (isGiftLine(line)) continue;
    if (!line.inScope.includes(offer.id)) continue;
    total +=
      offer.trigger === 'QUANTITY'
        ? line.quantity
        : line.unitPrice * line.quantity;
  }
  return total;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/subtotal.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/subtotal.ts app/entitlement/subtotal.test.ts
git commit -m "feat: add qualifying measure calculation

Excludes gift lines and ignores discounts, preventing the oscillation
bug where a granted gift lowers the subtotal below its own threshold."
```

---

## Task 6: Tier unlocking

**Files:**
- Create: `app/entitlement/tiers.ts`
- Test: `app/entitlement/tiers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/tiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { unlockedTiers } from './tiers';
import type { Tier } from './types';

const tier = (id: string, threshold: number): Tier => ({
  id,
  threshold,
  reward: 'GIFT',
  giftPool: [],
});

const ladder: Tier[] = [tier('t1', 5000), tier('t2', 10000), tier('t3', 15000)];

describe('unlockedTiers', () => {
  it('returns nothing below the first threshold', () => {
    expect(unlockedTiers(ladder, 4999)).toEqual([]);
  });

  it('unlocks a tier exactly at its threshold', () => {
    expect(unlockedTiers(ladder, 5000).map((t) => t.id)).toEqual(['t1']);
  });

  it('unlocks every tier at or below the measure', () => {
    expect(unlockedTiers(ladder, 12000).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('unlocks all tiers when the measure exceeds the top', () => {
    expect(unlockedTiers(ladder, 99999).map((t) => t.id)).toEqual([
      't1', 't2', 't3',
    ]);
  });

  it('returns tiers in ascending threshold order regardless of input order', () => {
    const shuffled = [tier('t3', 15000), tier('t1', 5000), tier('t2', 10000)];
    expect(unlockedTiers(shuffled, 15000).map((t) => t.id)).toEqual([
      't1', 't2', 't3',
    ]);
  });

  it('returns nothing for an empty ladder', () => {
    expect(unlockedTiers([], 10000)).toEqual([]);
  });

  it('handles a zero threshold as always unlocked', () => {
    expect(unlockedTiers([tier('t0', 0)], 0).map((t) => t.id)).toEqual(['t0']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/tiers.test.ts
```

Expected: FAIL — cannot resolve `./tiers`.

- [ ] **Step 3: Implement**

Create `app/entitlement/tiers.ts`:

```typescript
import type { Tier } from './types';

/**
 * Tiers unlocked by `measure`, always returned ascending by threshold.
 *
 * Sorting defensively rather than trusting callers: downstream policy code
 * treats the last element as the highest tier, so order is load-bearing.
 */
export function unlockedTiers(tiers: Tier[], measure: number): Tier[] {
  return tiers
    .filter((t) => measure >= t.threshold)
    .sort((a, b) => a.threshold - b.threshold);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/tiers.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/tiers.ts app/entitlement/tiers.test.ts
git commit -m "feat: add tier unlocking"
```

---

## Task 7: Axis A — within-tier resolution

**Files:**
- Create: `app/entitlement/withinTier.ts`
- Test: `app/entitlement/withinTier.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/withinTier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveWithinTier } from './withinTier';
import type { GiftPoolEntry, Tier } from './types';

const gift = (variantId: string): GiftPoolEntry => ({
  variantId,
  discountType: 'FREE',
  value: 0,
  maxQty: 1,
});

const tier = (id: string, pool: GiftPoolEntry[]): Tier => ({
  id,
  threshold: 10000,
  reward: 'GIFT',
  giftPool: pool,
});

describe('resolveWithinTier', () => {
  it('grants the whole pool under ALL_IN_POOL', () => {
    const t = tier('t1', [gift('v1'), gift('v2'), gift('v3')]);
    const result = resolveWithinTier('o1', t, 'ALL_IN_POOL');
    expect(result).toEqual({
      offerId: 'o1',
      tierId: 't1',
      candidates: [gift('v1'), gift('v2'), gift('v3')],
      requiresChoice: false,
    });
  });

  it('offers the pool as a choice under PICK_ONE', () => {
    const t = tier('t1', [gift('v1'), gift('v2'), gift('v3')]);
    const result = resolveWithinTier('o1', t, 'PICK_ONE');
    expect(result.requiresChoice).toBe(true);
    expect(result.candidates.map((c) => c.variantId)).toEqual(['v1', 'v2', 'v3']);
  });

  it('does not require a choice under PICK_ONE when the pool has one entry', () => {
    const t = tier('t1', [gift('v1')]);
    expect(resolveWithinTier('o1', t, 'PICK_ONE').requiresChoice).toBe(false);
  });

  it('returns null for a tier with an empty pool', () => {
    expect(resolveWithinTier('o1', tier('t1', []), 'PICK_ONE')).toBeNull();
  });

  it('returns null for a tier whose reward is not GIFT', () => {
    const t: Tier = {
      id: 't1', threshold: 10000, reward: 'FREE_SHIPPING', giftPool: [gift('v1')],
    };
    expect(resolveWithinTier('o1', t, 'PICK_ONE')).toBeNull();
  });

  it('preserves per-entry maxQty and discount settings', () => {
    const custom: GiftPoolEntry = {
      variantId: 'v9', discountType: 'PERCENT', value: 50, maxQty: 2,
    };
    const result = resolveWithinTier('o1', tier('t1', [custom]), 'PICK_ONE');
    expect(result!.candidates[0]).toEqual(custom);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/withinTier.test.ts
```

Expected: FAIL — cannot resolve `./withinTier`.

- [ ] **Step 3: Implement**

Create `app/entitlement/withinTier.ts`:

```typescript
import type { GiftEntitlement, Tier, WithinTierPolicy } from './types';

/**
 * Axis A. Turns one unlocked tier into a gift entitlement, or null when the
 * tier grants no gift.
 *
 * PICK_ONE with a single-entry pool sets requiresChoice false — there is
 * nothing to choose, and a chooser with one option is noise.
 */
export function resolveWithinTier(
  offerId: string,
  tier: Tier,
  policy: WithinTierPolicy
): GiftEntitlement | null {
  if (tier.reward !== 'GIFT') return null;
  if (tier.giftPool.length === 0) return null;

  return {
    offerId,
    tierId: tier.id,
    candidates: tier.giftPool,
    requiresChoice: policy === 'PICK_ONE' && tier.giftPool.length > 1,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/withinTier.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/withinTier.ts app/entitlement/withinTier.test.ts
git commit -m "feat: add within-tier gift resolution (claim policy axis A)"
```

---

## Task 8: Axis B — across-tier resolution

**Files:**
- Create: `app/entitlement/acrossTiers.ts`
- Test: `app/entitlement/acrossTiers.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/acrossTiers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveAcrossTiers } from './acrossTiers';
import type { ClaimPolicy, GiftPoolEntry, Tier } from './types';

const gift = (variantId: string): GiftPoolEntry => ({
  variantId, discountType: 'FREE', value: 0, maxQty: 1,
});

const giftTier = (id: string, threshold: number): Tier => ({
  id, threshold, reward: 'GIFT', giftPool: [gift(`v-${id}`)],
});

const shipTier = (id: string, threshold: number): Tier => ({
  id, threshold, reward: 'FREE_SHIPPING', giftPool: [],
});

const policy = (over: Partial<ClaimPolicy>): ClaimPolicy => ({
  withinTier: 'PICK_ONE',
  acrossTiers: 'STACK',
  ...over,
});

const unlocked = [giftTier('t1', 5000), giftTier('t2', 10000), giftTier('t3', 15000)];

describe('resolveAcrossTiers', () => {
  it('grants every unlocked gift tier under STACK', () => {
    const result = resolveAcrossTiers(unlocked, policy({ acrossTiers: 'STACK' }));
    expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('grants only the highest tier under SINGLE/HIGHEST', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'HIGHEST' })
    );
    expect(result.map((t) => t.id)).toEqual(['t3']);
  });

  it('grants the pinned tier under SINGLE/PINNED', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'PINNED', pinnedTierId: 't2' })
    );
    expect(result.map((t) => t.id)).toEqual(['t2']);
  });

  it('grants nothing when the pinned tier is not unlocked', () => {
    const result = resolveAcrossTiers(
      [giftTier('t1', 5000)],
      policy({ acrossTiers: 'SINGLE', singleResolution: 'PINNED', pinnedTierId: 't3' })
    );
    expect(result).toEqual([]);
  });

  it('falls back to HIGHEST when PINNED names an unknown tier id', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'PINNED', pinnedTierId: undefined })
    );
    expect(result.map((t) => t.id)).toEqual(['t3']);
  });

  it('returns every unlocked gift tier under SINGLE/CUSTOMER_CHOICE', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'CUSTOMER_CHOICE' })
    );
    expect(result.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('ignores non-gift tiers when picking the highest', () => {
    const mixed = [giftTier('t1', 5000), shipTier('t2', 10000)];
    const result = resolveAcrossTiers(
      mixed,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'HIGHEST' })
    );
    expect(result.map((t) => t.id)).toEqual(['t1']);
  });

  it('returns nothing when no tiers are unlocked', () => {
    expect(resolveAcrossTiers([], policy({ acrossTiers: 'STACK' }))).toEqual([]);
  });

  it('defaults to HIGHEST when acrossTiers is SINGLE with no resolution set', () => {
    const result = resolveAcrossTiers(unlocked, policy({ acrossTiers: 'SINGLE' }));
    expect(result.map((t) => t.id)).toEqual(['t3']);
  });
});
```

Note the CUSTOMER_CHOICE case: it returns **all** unlocked gift tiers. The constraint that only one may ultimately be claimed is enforced downstream in `resolve.ts` (Task 10), because the chooser must be able to show every option before the customer narrows to one.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/acrossTiers.test.ts
```

Expected: FAIL — cannot resolve `./acrossTiers`.

- [ ] **Step 3: Implement**

Create `app/entitlement/acrossTiers.ts`:

```typescript
import type { ClaimPolicy, Tier } from './types';

/**
 * Axis B. Reduces the unlocked tiers to those that may grant gifts.
 *
 * CUSTOMER_CHOICE returns every unlocked gift tier — the customer needs to see
 * all options. The "only one may be claimed" constraint is applied in
 * resolve.ts, not here.
 */
export function resolveAcrossTiers(
  unlocked: Tier[],
  policy: ClaimPolicy
): Tier[] {
  const giftTiers = unlocked.filter(
    (t) => t.reward === 'GIFT' && t.giftPool.length > 0
  );

  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';

  if (resolution === 'CUSTOMER_CHOICE') return giftTiers;

  if (resolution === 'PINNED' && policy.pinnedTierId !== undefined) {
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    return pinned ? [pinned] : [];
  }

  // HIGHEST, and the fallback when PINNED names no tier.
  return [giftTiers[giftTiers.length - 1]];
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/acrossTiers.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/acrossTiers.ts app/entitlement/acrossTiers.test.ts
git commit -m "feat: add across-tier gift resolution (claim policy axis B)"
```

---

## Task 9: Non-gift rewards

Per the spec: the claim policy governs gifts only. Free shipping applies if any unlocked tier grants it; order discounts take the highest single value per type and never accumulate.

**Files:**
- Create: `app/entitlement/rewards.ts`
- Test: `app/entitlement/rewards.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/rewards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveNonGiftRewards } from './rewards';
import type { Tier } from './types';

const t = (id: string, reward: Tier['reward'], value?: number): Tier => ({
  id, threshold: 1000, reward, value, giftPool: [],
});

describe('resolveNonGiftRewards', () => {
  it('returns empty rewards for no unlocked tiers', () => {
    expect(resolveNonGiftRewards([])).toEqual({
      freeShipping: false, orderPercent: 0, orderFixed: 0,
    });
  });

  it('grants free shipping when any unlocked tier offers it', () => {
    const r = resolveNonGiftRewards([t('t1', 'GIFT'), t('t2', 'FREE_SHIPPING')]);
    expect(r.freeShipping).toBe(true);
  });

  it('takes the highest percent and does not accumulate', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_PERCENT', 10),
      t('t2', 'ORDER_PERCENT', 20),
    ]);
    expect(r.orderPercent).toBe(20);
  });

  it('takes the highest fixed amount and does not accumulate', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_FIXED', 500),
      t('t2', 'ORDER_FIXED', 1500),
    ]);
    expect(r.orderFixed).toBe(1500);
  });

  it('tracks percent and fixed independently', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_PERCENT', 15),
      t('t2', 'ORDER_FIXED', 1000),
    ]);
    expect(r).toEqual({ freeShipping: false, orderPercent: 15, orderFixed: 1000 });
  });

  it('ignores gift tiers entirely', () => {
    expect(resolveNonGiftRewards([t('t1', 'GIFT')])).toEqual({
      freeShipping: false, orderPercent: 0, orderFixed: 0,
    });
  });

  it('treats a missing value as zero', () => {
    expect(resolveNonGiftRewards([t('t1', 'ORDER_PERCENT')]).orderPercent).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/rewards.test.ts
```

Expected: FAIL — cannot resolve `./rewards`.

- [ ] **Step 3: Implement**

Create `app/entitlement/rewards.ts`:

```typescript
import type { NonGiftRewards, Tier } from './types';

/**
 * Non-gift rewards from the unlocked tiers.
 *
 * Deliberately independent of the claim policy: a merchant restricting gifts
 * to one tier has not thereby restricted their free shipping. Order discounts
 * take the highest single value per type rather than summing — a 10% tier and
 * a 20% tier both unlocked yields 20%, not 30%.
 */
export function resolveNonGiftRewards(unlocked: Tier[]): NonGiftRewards {
  let freeShipping = false;
  let orderPercent = 0;
  let orderFixed = 0;

  for (const tier of unlocked) {
    if (tier.reward === 'FREE_SHIPPING') {
      freeShipping = true;
    } else if (tier.reward === 'ORDER_PERCENT') {
      orderPercent = Math.max(orderPercent, tier.value ?? 0);
    } else if (tier.reward === 'ORDER_FIXED') {
      orderFixed = Math.max(orderFixed, tier.value ?? 0);
    }
  }

  return { freeShipping, orderPercent, orderFixed };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/rewards.test.ts
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/rewards.ts app/entitlement/rewards.test.ts
git commit -m "feat: add non-gift reward resolution"
```

---

## Task 10: Compose the public entry point

**Files:**
- Create: `app/entitlement/resolve.ts`
- Test: `app/entitlement/resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/resolve.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveOffer } from './resolve';
import type { Cart, GiftPoolEntry, Offer, Tier } from './types';

const gift = (variantId: string): GiftPoolEntry => ({
  variantId, discountType: 'FREE', value: 0, maxQty: 1,
});

const ladder: Tier[] = [
  { id: 't1', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
  { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug'), gift('tote'), gift('candle')] },
  { id: 't3', threshold: 15000, reward: 'GIFT', giftPool: [gift('hoodie'), gift('backpack')] },
];

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: ladder,
  ...over,
});

const cartAt = (amount: number): Cart => ({
  lines: [
    { id: 'l1', quantity: 1, unitPrice: amount, variantId: 'sweater', inScope: ['o1'] },
  ],
});

describe('resolveOffer', () => {
  it('unlocks nothing below the first threshold', () => {
    const r = resolveOffer(cartAt(4999), offer());
    expect(r.unlockedTierIds).toEqual([]);
    expect(r.gifts).toEqual([]);
    expect(r.rewards.freeShipping).toBe(false);
  });

  it('reports the measure it used', () => {
    expect(resolveOffer(cartAt(16000), offer()).measure).toBe(16000);
  });

  it('grants free shipping and both gift tiers under PICK_ONE + STACK', () => {
    const r = resolveOffer(cartAt(16000), offer());
    expect(r.unlockedTierIds).toEqual(['t1', 't2', 't3']);
    expect(r.rewards.freeShipping).toBe(true);
    expect(r.gifts.map((g) => g.tierId)).toEqual(['t2', 't3']);
    expect(r.gifts.every((g) => g.requiresChoice)).toBe(true);
  });

  it('grants only the highest gift tier under SINGLE/HIGHEST, keeping free shipping', () => {
    const r = resolveOffer(
      cartAt(16000),
      offer({
        claimPolicy: {
          withinTier: 'PICK_ONE', acrossTiers: 'SINGLE', singleResolution: 'HIGHEST',
        },
      })
    );
    expect(r.gifts.map((g) => g.tierId)).toEqual(['t3']);
    expect(r.rewards.freeShipping).toBe(true);
  });

  it('exposes every unlocked gift tier under SINGLE/CUSTOMER_CHOICE', () => {
    const r = resolveOffer(
      cartAt(16000),
      offer({
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'CUSTOMER_CHOICE',
        },
      })
    );
    expect(r.gifts.map((g) => g.tierId)).toEqual(['t2', 't3']);
  });

  it('does not require a choice under ALL_IN_POOL', () => {
    const r = resolveOffer(
      cartAt(16000),
      offer({ claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' } })
    );
    expect(r.gifts.every((g) => g.requiresChoice)).toBe(false);
    expect(r.gifts[0].candidates).toHaveLength(3);
  });

  it('does not count an already-claimed gift toward thresholds', () => {
    const cart: Cart = {
      lines: [
        { id: 'l1', quantity: 1, unitPrice: 10000, variantId: 'sweater', inScope: ['o1'] },
        {
          id: 'l2', quantity: 1, unitPrice: 6000, variantId: 'mug', inScope: ['o1'],
          giftOfferId: 'o1', giftTierId: 't2',
        },
      ],
    };
    const r = resolveOffer(cart, offer());
    expect(r.measure).toBe(10000);
    expect(r.unlockedTierIds).toEqual(['t1', 't2']);
  });

  it('is stable across repeated evaluation with the gift present', () => {
    const cart: Cart = {
      lines: [
        { id: 'l1', quantity: 1, unitPrice: 10000, variantId: 'sweater', inScope: ['o1'] },
        {
          id: 'l2', quantity: 1, unitPrice: 4000, variantId: 'mug', inScope: ['o1'],
          giftOfferId: 'o1', giftTierId: 't2',
        },
      ],
    };
    const first = resolveOffer(cart, offer());
    const second = resolveOffer(cart, offer());
    expect(first).toEqual(second);
    expect(first.unlockedTierIds).toContain('t2');
  });

  it('unlocks by item count when trigger is QUANTITY', () => {
    const qtyOffer = offer({
      trigger: 'QUANTITY',
      tiers: [
        { id: 'q1', threshold: 3, reward: 'GIFT', giftPool: [gift('mug')] },
      ],
    });
    const cart: Cart = {
      lines: [
        { id: 'l1', quantity: 3, unitPrice: 100, variantId: 'sock', inScope: ['o1'] },
      ],
    };
    expect(resolveOffer(cart, qtyOffer).unlockedTierIds).toEqual(['q1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/resolve.test.ts
```

Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 3: Implement**

Create `app/entitlement/resolve.ts`:

```typescript
import { resolveAcrossTiers } from './acrossTiers';
import { resolveNonGiftRewards } from './rewards';
import { qualifyingMeasure } from './subtotal';
import { unlockedTiers } from './tiers';
import { resolveWithinTier } from './withinTier';
import type { Cart, GiftEntitlement, Offer, OfferEntitlements } from './types';

/**
 * The public entry point. Given a normalised cart and one offer, returns
 * everything the customer is entitled to.
 *
 * Pure and deterministic: identical inputs always produce identical output.
 * Both the discount function and the storefront widget call this, which is
 * what keeps the bar and checkout in agreement.
 */
export function resolveOffer(cart: Cart, offer: Offer): OfferEntitlements {
  const measure = qualifyingMeasure(cart, offer);
  const unlocked = unlockedTiers(offer.tiers, measure);
  const grantingTiers = resolveAcrossTiers(unlocked, offer.claimPolicy);

  const gifts: GiftEntitlement[] = [];
  for (const tier of grantingTiers) {
    const entitlement = resolveWithinTier(
      offer.id,
      tier,
      offer.claimPolicy.withinTier
    );
    if (entitlement !== null) gifts.push(entitlement);
  }

  return {
    offerId: offer.id,
    measure,
    unlockedTierIds: unlocked.map((t) => t.id),
    gifts,
    rewards: resolveNonGiftRewards(unlocked),
  };
}

/**
 * Under SINGLE, at most one gift may ultimately be claimed across all tiers.
 * resolveOffer exposes every option so a chooser can render them; this answers
 * how many the customer may actually keep.
 */
export function maxClaimableGifts(offer: Offer): number {
  return offer.claimPolicy.acrossTiers === 'SINGLE' ? 1 : Infinity;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/resolve.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add app/entitlement/resolve.ts app/entitlement/resolve.test.ts
git commit -m "feat: compose entitlement resolution entry point"
```

---

## Task 11: The security boundary

The discount function calls this for every cart line claiming to be a gift. It must never return true on the strength of a line attribute alone.

**Files:**
- Create: `app/entitlement/validateGift.ts`
- Test: `app/entitlement/validateGift.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/entitlement/validateGift.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateGiftLine } from './validateGift';
import type { Cart, CartLine, GiftPoolEntry, Offer, Tier } from './types';

const gift = (variantId: string, over: Partial<GiftPoolEntry> = {}): GiftPoolEntry => ({
  variantId, discountType: 'FREE', value: 0, maxQty: 1, ...over,
});

const tiers: Tier[] = [
  { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug'), gift('tote')] },
  { id: 't3', threshold: 15000, reward: 'GIFT', giftPool: [gift('hoodie')] },
];

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers,
  ...over,
});

const giftLine = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'lg', quantity: 1, unitPrice: 4000, variantId: 'mug', inScope: ['o1'],
  giftOfferId: 'o1', giftTierId: 't2', ...over,
});

const cartWith = (line: CartLine, spend = 16000): Cart => ({
  lines: [
    { id: 'l1', quantity: 1, unitPrice: spend, variantId: 'sweater', inScope: ['o1'] },
    line,
  ],
});

describe('validateGiftLine', () => {
  it('accepts a genuinely entitled gift line', () => {
    const r = validateGiftLine(cartWith(giftLine()), offer(), giftLine());
    expect(r.valid).toBe(true);
    expect(r.entry).toEqual(gift('mug'));
  });

  it('rejects a variant that is not in the claimed tier pool', () => {
    const forged = giftLine({ variantId: 'expensive-jacket' });
    expect(validateGiftLine(cartWith(forged), offer(), forged).valid).toBe(false);
  });

  it('rejects a line claiming a tier that is not unlocked', () => {
    const line = giftLine({ giftTierId: 't3', variantId: 'hoodie' });
    const r = validateGiftLine(cartWith(line, 9000), offer(), line);
    expect(r.valid).toBe(false);
  });

  it('rejects a line claiming an unknown tier id', () => {
    const line = giftLine({ giftTierId: 'does-not-exist' });
    expect(validateGiftLine(cartWith(line), offer(), line).valid).toBe(false);
  });

  it('rejects a line claiming a different offer', () => {
    const line = giftLine({ giftOfferId: 'other-offer' });
    expect(validateGiftLine(cartWith(line), offer(), line).valid).toBe(false);
  });

  it('rejects a line with no gift attributes at all', () => {
    const plain: CartLine = {
      id: 'l9', quantity: 1, unitPrice: 4000, variantId: 'mug', inScope: ['o1'],
    };
    expect(validateGiftLine(cartWith(plain), offer(), plain).valid).toBe(false);
  });

  it('caps the discountable quantity at the pool entry maxQty', () => {
    const line = giftLine({ quantity: 5 });
    const r = validateGiftLine(cartWith(line), offer(), line);
    expect(r.valid).toBe(true);
    expect(r.discountQuantity).toBe(1);
  });

  it('allows up to maxQty when the pool entry permits more than one', () => {
    const twoOffer = offer({
      tiers: [
        { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug', { maxQty: 2 })] },
      ],
    });
    const line = giftLine({ quantity: 5 });
    const r = validateGiftLine(cartWith(line), twoOffer, line);
    expect(r.discountQuantity).toBe(2);
  });

  it('discounts only what is present when quantity is below maxQty', () => {
    const twoOffer = offer({
      tiers: [
        { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug', { maxQty: 3 })] },
      ],
    });
    const line = giftLine({ quantity: 2 });
    expect(validateGiftLine(cartWith(line), twoOffer, line).discountQuantity).toBe(2);
  });

  it('rejects a tier not granted under SINGLE/HIGHEST even though it is unlocked', () => {
    const single = offer({
      claimPolicy: {
        withinTier: 'PICK_ONE', acrossTiers: 'SINGLE', singleResolution: 'HIGHEST',
      },
    });
    const line = giftLine({ giftTierId: 't2', variantId: 'mug' });
    expect(validateGiftLine(cartWith(line), single, line).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run app/entitlement/validateGift.test.ts
```

Expected: FAIL — cannot resolve `./validateGift`.

- [ ] **Step 3: Implement**

Create `app/entitlement/validateGift.ts`:

```typescript
import { resolveOffer } from './resolve';
import type { Cart, CartLine, GiftPoolEntry, Offer } from './types';

export interface GiftValidation {
  valid: boolean;
  /** The pool entry that justifies the discount, when valid. */
  entry?: GiftPoolEntry;
  /** Units that may be discounted. Always <= line.quantity and <= entry.maxQty. */
  discountQuantity: number;
}

const INVALID: GiftValidation = { valid: false, discountQuantity: 0 };

/**
 * THE SECURITY BOUNDARY.
 *
 * Line attributes are hints written by client-side JavaScript and are trivially
 * forged. This function ignores them as evidence and re-derives entitlement
 * from cart state, using them only to identify what the line is claiming.
 *
 * A forged line simply receives no discount and bills at full price. The worst
 * outcome of a client-side exploit is a confused shopper, never a merchant
 * losing inventory. Preserve that property in every change to this file.
 */
export function validateGiftLine(
  cart: Cart,
  offer: Offer,
  line: CartLine
): GiftValidation {
  if (line.giftOfferId === undefined || line.giftTierId === undefined) return INVALID;
  if (line.giftOfferId !== offer.id) return INVALID;

  // Re-derive entitlements rather than trusting the claim.
  const entitlements = resolveOffer(cart, offer);

  const entitlement = entitlements.gifts.find((g) => g.tierId === line.giftTierId);
  if (entitlement === undefined) return INVALID;

  const entry = entitlement.candidates.find((c) => c.variantId === line.variantId);
  if (entry === undefined) return INVALID;

  return {
    valid: true,
    entry,
    discountQuantity: Math.min(line.quantity, entry.maxQty),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run app/entitlement/validateGift.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Add the barrel export**

Create `app/entitlement/index.ts`:

```typescript
export * from './types';
export { qualifyingMeasure } from './subtotal';
export { unlockedTiers } from './tiers';
export { resolveWithinTier } from './withinTier';
export { resolveAcrossTiers } from './acrossTiers';
export { resolveNonGiftRewards } from './rewards';
export { resolveOffer, maxClaimableGifts } from './resolve';
export { validateGiftLine } from './validateGift';
export type { GiftValidation } from './validateGift';
```

- [ ] **Step 6: Run the whole suite**

```bash
npm test
```

Expected: PASS — 57 tests across 7 files.

- [ ] **Step 7: Commit**

```bash
git add app/entitlement/validateGift.ts app/entitlement/validateGift.test.ts app/entitlement/index.ts
git commit -m "feat: add gift line validation security boundary

Re-derives entitlement from cart state rather than trusting line
attributes, so a forged gift line bills at full price."
```

---

## Task 12: Guard the core against accidental dependencies

The core's value depends on it compiling into both a Wasm function and a browser bundle. A single stray import breaks that silently — and only at deploy time.

**Files:**
- Create: `app/entitlement/purity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/entitlement/purity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'app/entitlement');

const sourceFiles = readdirSync(DIR).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
);

describe('entitlement core purity', () => {
  it('has source files to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(sourceFiles)('%s imports only from within the core', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const external = imports.filter((i) => !i.startsWith('./'));
    expect(external).toEqual([]);
  });

  it.each(sourceFiles)('%s does not reference browser or node globals', (file) => {
    const src = readFileSync(join(DIR, file), 'utf8');
    const forbidden = ['window.', 'document.', 'process.', 'globalThis.', 'require('];
    const found = forbidden.filter((token) => src.includes(token));
    expect(found).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it passes**

```bash
npx vitest run app/entitlement/purity.test.ts
```

Expected: PASS. This test is written last but guards everything before it — if it fails now, an earlier task introduced a dependency that must be removed.

- [ ] **Step 3: Deliberately break it to confirm the guard works**

Temporarily add to the top of `app/entitlement/rewards.ts`:

```typescript
import { readFileSync } from 'node:fs';
```

Run:

```bash
npx vitest run app/entitlement/purity.test.ts
```

Expected: FAIL on `rewards.ts imports only from within the core`. **Remove the line**, re-run, and confirm it passes again.

- [ ] **Step 4: Commit**

```bash
git add app/entitlement/purity.test.ts
git commit -m "test: guard entitlement core against external dependencies

The core must compile unchanged into both Javy Wasm and a browser
bundle; a stray import breaks that silently at deploy time."
```

---

## Task 13: Prove the hosting bet

The second architectural bet. The design assumes CartBloom runs free on Cloudflare Workers with D1. Unlike the instruction budget, there is no officially paved path — Shopify ships a `cf-worker` adapter and a community template exists, but the template we scaffolded from defaults to a Node runtime with Prisma on SQLite.

**This is a spike, not a migration.** The goal is a yes/no answer on whether an embedded Shopify app can complete OAuth on Workers with D1-backed session storage. Do not build the production setup here — Phase 2 does that, informed by what this learns.

**Files:**
- Create: `spike/workers-deploy/` (throwaway — deleted in Step 6)
- Create: `docs/superpowers/plans/workers-deploy-result.md`

- [ ] **Step 1: Install Wrangler and authenticate**

```bash
npm install --save-dev wrangler
npx wrangler login
npx wrangler whoami
```

Expected: your Cloudflare account email prints.

- [ ] **Step 2: Create a D1 database**

```bash
npx wrangler d1 create cartbloom-spike
```

Expected: a `database_id` prints. Record it.

- [ ] **Step 3: Stand up the community reference**

```bash
git clone https://github.com/gruntlord5/cloudflare-worker-shopifyd1 spike/workers-deploy
cd spike/workers-deploy && npm install
```

Read its `wrangler.toml` and session storage implementation. The specific questions to answer:

1. Which session storage does it use, and is it an official `@shopify/shopify-app-session-storage-*` package or hand-rolled?
2. Does it use `@shopify/shopify-api/adapters/cf-worker`?
3. Does it run React Router, plain Hono, or something else?
4. How does it handle the offline access token that our webhook registration needs?

- [ ] **Step 4: Deploy it against a dev store**

Follow that repository's README to configure your dev store credentials, then:

```bash
npx wrangler deploy
```

Install the deployed app on a Shopify development store and complete OAuth.

- [ ] **Step 5: Record the verdict**

Write `docs/superpowers/plans/workers-deploy-result.md` answering:

- Did OAuth complete and a session persist to D1? (yes/no)
- Answers to the four questions from Step 3
- Measured CPU time per request from the Cloudflare dashboard, against the **10 ms free-tier cap**
- Whether React Router 7 SSR is viable on Workers, or whether the thin-shell + client-rendered approach from spec §4 is mandatory rather than merely preferred

| Result | Decision |
|---|---|
| OAuth completes, CPU comfortably under 10 ms | PASS — Phase 2 builds the production Workers setup |
| OAuth completes, CPU near or over 10 ms | PASS WITH CONSTRAINT — thin-shell architecture is mandatory; record the measured ceiling |
| OAuth cannot be made to work | FAIL — escalate. Fall back to Workers Paid, or move the admin app to an Oracle Cloud Always Free VM per spec §4, keeping the storefront path unchanged |

- [ ] **Step 6: Clean up and commit**

```bash
cd ../.. && rm -rf spike/
npx wrangler d1 delete cartbloom-spike
git add docs/superpowers/plans/workers-deploy-result.md
git commit -m "chore: record Cloudflare Workers + D1 hosting spike result

Proves or disproves the zero-cost hosting bet before Phase 2 builds on it."
```

---

## Task 14: Golden test vectors — the parity mechanism

Since the function and widget are now separate implementations in different languages, this file is the **only** thing keeping them in agreement. It is a deliverable, not test hygiene.

Vectors are **generated by enumerating the policy matrix**, not hand-written. Hand-curated vectors drift, and any case absent from the vectors is a case where checkout can silently disagree with the progress bar.

**Files:**
- Create: `app/entitlement/vectors/generate.ts`
- Create: `app/entitlement/vectors/golden.json` (generated, committed)
- Test: `app/entitlement/vectors/conformance.test.ts`

- [ ] **Step 1: Write the vector generator**

Create `app/entitlement/vectors/generate.ts`. It enumerates the full matrix and records what `resolveOffer` returns for each case:

```typescript
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOffer } from '../resolve';
import type {
  AcrossTierPolicy, Cart, ClaimPolicy, Offer, OfferEntitlements,
  SingleTierResolution, TriggerMetric, WithinTierPolicy,
} from '../types';

export interface Vector {
  name: string;
  cart: Cart;
  offer: Offer;
  expected: OfferEntitlements;
}

const WITHIN: WithinTierPolicy[] = ['ALL_IN_POOL', 'PICK_ONE'];
const ACROSS: Array<{ acrossTiers: AcrossTierPolicy; singleResolution?: SingleTierResolution }> = [
  { acrossTiers: 'STACK' },
  { acrossTiers: 'SINGLE', singleResolution: 'HIGHEST' },
  { acrossTiers: 'SINGLE', singleResolution: 'PINNED' },
  { acrossTiers: 'SINGLE', singleResolution: 'CUSTOMER_CHOICE' },
];
const TIER_COUNTS = [1, 2, 3, 4, 5, 6];
const TRIGGERS: TriggerMetric[] = ['SUBTOTAL', 'QUANTITY'];

function buildOffer(
  tierCount: number,
  within: WithinTierPolicy,
  across: { acrossTiers: AcrossTierPolicy; singleResolution?: SingleTierResolution },
  trigger: TriggerMetric
): Offer {
  const tiers = Array.from({ length: tierCount }, (_, i) => ({
    id: `t${i + 1}`,
    threshold: trigger === 'QUANTITY' ? (i + 1) * 2 : (i + 1) * 5000,
    reward: (i === 0 ? 'FREE_SHIPPING' : 'GIFT') as Offer['tiers'][number]['reward'],
    giftPool:
      i === 0
        ? []
        : Array.from({ length: (i % 3) + 1 }, (_, g) => ({
            variantId: `v${i}-${g}`,
            discountType: 'FREE' as const,
            value: 0,
            maxQty: (g % 2) + 1,
          })),
  }));

  const claimPolicy: ClaimPolicy = {
    withinTier: within,
    acrossTiers: across.acrossTiers,
    ...(across.singleResolution ? { singleResolution: across.singleResolution } : {}),
    ...(across.singleResolution === 'PINNED' ? { pinnedTierId: 't2' } : {}),
  };

  return { id: 'o1', trigger, claimPolicy, tiers };
}

/** Below, exactly at, and above every threshold, plus zero. */
function measurePoints(offer: Offer): number[] {
  const points = new Set<number>([0]);
  for (const t of offer.tiers) {
    if (t.threshold > 0) points.add(t.threshold - 1);
    points.add(t.threshold);
    points.add(t.threshold + 1);
  }
  return [...points].sort((a, b) => a - b);
}

function buildCart(measure: number, trigger: TriggerMetric, withGift: boolean): Cart {
  const lines: Cart['lines'] = [];
  if (measure > 0) {
    lines.push(
      trigger === 'QUANTITY'
        ? { id: 'l1', quantity: measure, unitPrice: 1000, variantId: 'base', inScope: ['o1'] }
        : { id: 'l1', quantity: 1, unitPrice: measure, variantId: 'base', inScope: ['o1'] }
    );
  }
  if (withGift) {
    lines.push({
      id: 'lg', quantity: 1, unitPrice: 4000, variantId: 'v1-0',
      inScope: ['o1'], giftOfferId: 'o1', giftTierId: 't2',
    });
  }
  return { lines };
}

export function generateVectors(): Vector[] {
  const vectors: Vector[] = [];
  for (const trigger of TRIGGERS) {
    for (const within of WITHIN) {
      for (const across of ACROSS) {
        for (const tierCount of TIER_COUNTS) {
          const offer = buildOffer(tierCount, within, across, trigger);
          for (const measure of measurePoints(offer)) {
            for (const withGift of [false, true]) {
              const cart = buildCart(measure, trigger, withGift);
              const suffix = across.singleResolution ?? across.acrossTiers;
              vectors.push({
                name: `${trigger}/${within}/${suffix}/tiers=${tierCount}/measure=${measure}/gift=${withGift}`,
                cart,
                offer,
                expected: resolveOffer(cart, offer),
              });
            }
          }
        }
      }
    }
  }
  return vectors;
}

if (process.argv[1]?.endsWith('generate.ts')) {
  const vectors = generateVectors();
  writeFileSync(
    join(import.meta.dirname, 'golden.json'),
    JSON.stringify(vectors, null, 2) + '\n'
  );
  console.log(`Wrote ${vectors.length} vectors`);
}
```

Note the `process.argv` guard is the one permitted exception to the purity rule — `generate.ts` is a build tool, not part of the shipped core. Task 12's purity test must be updated to exclude the `vectors/` directory.

- [ ] **Step 2: Exclude the generator from the purity test**

In `app/entitlement/purity.test.ts`, change the file listing so it only inspects the core's own directory and not subdirectories. Replace the `sourceFiles` declaration with:

```typescript
const sourceFiles = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
  .map((e) => e.name);
```

- [ ] **Step 3: Generate the vectors**

```bash
npx tsx app/entitlement/vectors/generate.ts
```

Expected: `Wrote N vectors` where N is in the low thousands. If `tsx` isn't present, `npm install --save-dev tsx` first.

- [ ] **Step 4: Write the conformance test**

Create `app/entitlement/vectors/conformance.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOffer } from '../resolve';
import { generateVectors, type Vector } from './generate';

const golden: Vector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'golden.json'), 'utf8')
);

describe('golden vectors', () => {
  it('has meaningful coverage', () => {
    expect(golden.length).toBeGreaterThan(1000);
  });

  it('has unique names', () => {
    expect(new Set(golden.map((v) => v.name)).size).toBe(golden.length);
  });

  it('covers every claim policy combination', () => {
    for (const token of [
      'ALL_IN_POOL', 'PICK_ONE', 'STACK', 'HIGHEST', 'PINNED', 'CUSTOMER_CHOICE',
      'SUBTOTAL', 'QUANTITY',
    ]) {
      expect(golden.some((v) => v.name.includes(token))).toBe(true);
    }
  });

  it('is in sync with the generator — regenerate if this fails', () => {
    expect(generateVectors()).toEqual(golden);
  });

  it.each(golden.map((v) => [v.name, v] as const))(
    'TypeScript core satisfies %s',
    (_name, vector) => {
      expect(resolveOffer(vector.cart, vector.offer)).toEqual(vector.expected);
    }
  );
});
```

- [ ] **Step 5: Run the suite**

```bash
npm test
```

Expected: PASS. The `in sync with the generator` test is the guard that stops `golden.json` from going stale — if someone changes entitlement behaviour without regenerating, it fails loudly.

- [ ] **Step 6: Commit**

```bash
git add app/entitlement/vectors app/entitlement/purity.test.ts
git commit -m "feat: add generated golden test vectors

The Rust discount function and the TypeScript widget are separate
implementations; these vectors are the only thing keeping them in
agreement. Generated by enumerating the policy matrix rather than
hand-written, so coverage cannot quietly drift."
```

---

## Definition of done

- [x] Instruction budget measured and recorded — **FAILED the gate**; function moves to Rust, parity moves to golden vectors (Task 14)
- [ ] Golden vectors generated, committed, and passing against the TypeScript core
- [ ] Workers + D1 hosting verdict recorded from Task 13 Step 5
- [ ] `npm test` passes — 76 tests across 8 files (57 entitlement + 19 purity; the purity count is `1 + 2 × source files`, so it grows as the core does)
- [ ] `npx tsc --noEmit` reports no errors
- [ ] `npm run build` succeeds
- [ ] The core has zero external imports (enforced by test)
- [ ] Every commit above is on the branch

**Phase 2 is unblocked** once Task 13 reports. Phase 2 builds the **Rust** discount function against the golden vectors from Task 14, stands up the production Workers + D1 setup informed by Task 13, resolves collection scope into the `inScope` flags, and verifies a real discount applying at a real checkout.

### Carried into Phase 2

- **The Rust function must pass `golden.json` unmodified.** Deserialise the same vector file and assert the same expected entitlements. If a vector cannot be satisfied, that is a specification disagreement to resolve deliberately — never by editing the vector to match the Rust behaviour.
- **Rust toolchain is not installed.** `cargo` was absent as of 2026-07-27; Phase 2 begins by installing it.
- **Collection scope resolution.** The core is deliberately scope-agnostic (spec §4). Phase 2 must decide how the function resolves `inScope` — live `inCollections` lookups versus product-ID sets embedded at publish time — and Phase 3 must make the widget's resolution **conservative**, under-counting rather than over-counting when uncertain.
- **JSON metafield size limit**, still unverified. Measure against a config with 5 offers × 6 tiers × 5 gifts before the publish pipeline depends on it.
- **Market/country availability** on the discount function input, still unverified. If absent, market targeting drops from the Pro plan.
