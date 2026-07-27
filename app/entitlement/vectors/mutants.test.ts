/**
 * Task 19 — the mutation harness.
 *
 * golden.json and validation-golden.json are the only thing that keeps a
 * future Rust port honest against this TypeScript core. A large vector count
 * proves nothing by itself: a 2026-07-27 review ran 13 deliberately-wrong
 * implementations against the then-1968 vectors and 9 passed. This file is
 * the regression guard against that ever being true again.
 *
 * For every mutation, a small alternate implementation (see ./mutants.ts) is
 * run against every vector. A mutant that disagrees with the recorded
 * `expected` value on at least one vector is CAUGHT — the vectors would
 * reject that specific bug if it shipped in Rust. A mutant that agrees with
 * `expected` on every single vector SURVIVES — the vectors have a real gap,
 * and the assertion below fails the build.
 *
 * Per the task instructions: if a mutant survives, this file does not
 * weaken the assertion, delete the mutant, or adjust it to force a pass. A
 * survivor is reported as a finding, not papered over.
 */

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Cart, Offer, OfferEntitlements } from '../types';
import type { GiftValidation } from '../validateGifts';
import type { Vector, ValidationVector } from './generate';
import * as mutants from './mutants';

const golden: Vector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'golden.json'), 'utf8')
);

const validationGolden: ValidationVector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'validation-golden.json'), 'utf8')
);

interface Row {
  id: string;
  summary: string;
  vectorSet: 'golden' | 'validation-golden';
  total: number;
  failed: number;
  status: 'CAUGHT' | 'SURVIVED';
}

const rows: Row[] = [];

// ---------------------------------------------------------------------------
// Mutants 1–13 target resolveOffer and are checked against golden.json.
// ---------------------------------------------------------------------------

interface EntitlementMutantSpec {
  id: string;
  summary: string;
  run: (cart: Cart, offer: Offer) => OfferEntitlements;
}

const entitlementMutants: EntitlementMutantSpec[] = [
  {
    id: 'M1',
    summary: "ignore inScope entirely — every line counts regardless of scope",
    run: mutants.mutant1_ignoreInScope,
  },
  {
    id: 'M2',
    summary:
      "exclude only this offer's gift lines — another offer's gift counts toward this offer's threshold",
    run: mutants.mutant2_excludeOnlyOwnGift,
  },
  {
    id: 'M3',
    summary: 'order discounts accumulate instead of taking the max',
    run: mutants.mutant3_orderDiscountsAccumulate,
  },
  {
    id: 'M4',
    summary: "order discounts suppressed whenever acrossTiers === 'SINGLE'",
    run: mutants.mutant4_orderDiscountsSuppressedUnderSingle,
  },
  {
    id: 'M5',
    summary: 'order discounts always zero — never implemented',
    run: mutants.mutant5_orderDiscountsAlwaysZero,
  },
  {
    id: 'M6',
    summary: 'free shipping granted only by the highest-threshold unlocked tier',
    run: mutants.mutant6_freeShippingHighestTierOnly,
  },
  {
    id: 'M7',
    summary: 'PINNED miss (absent or unknown id) falls back to HIGHEST',
    run: mutants.mutant7_pinnedFallsBackToHighest,
  },
  {
    id: 'M8',
    summary:
      'PINNED: missing id grants nothing, but an unknown id falls back to HIGHEST',
    run: mutants.mutant8_pinnedInverseInconsistency,
  },
  {
    id: 'M9',
    summary: 'CUSTOMER_CHOICE returns only the highest unlocked gift tier',
    run: mutants.mutant9_customerChoiceHighestOnly,
  },
  {
    id: 'M10',
    summary: 'requiresChoice ignores pool size — always true under PICK_ONE',
    run: mutants.mutant10_requiresChoiceIgnoresPoolSize,
  },
  {
    id: 'M11',
    summary: 'no tier sort — trusts config array order over threshold order',
    run: mutants.mutant11_noTierSort,
  },
  {
    id: 'M12',
    summary: 'gift lines count toward the threshold (oscillation bug)',
    run: mutants.mutant12_giftLinesCountTowardThreshold,
  },
  {
    id: 'M13',
    summary: 'empty-pool GIFT tier still yields an entitlement',
    run: mutants.mutant13_emptyPoolGiftYieldsEntitlement,
  },
];

describe('mutation harness — entitlement resolution (golden.json)', () => {
  for (const spec of entitlementMutants) {
    it(`${spec.id}: ${spec.summary}`, () => {
      const failures = golden.filter((v) => {
        const actual = spec.run(v.cart, v.offer);
        return !isDeepStrictEqual(actual, v.expected);
      });

      rows.push({
        id: spec.id,
        summary: spec.summary,
        vectorSet: 'golden',
        total: golden.length,
        failed: failures.length,
        status: failures.length > 0 ? 'CAUGHT' : 'SURVIVED',
      });

      expect(
        failures.length,
        `Mutant ${spec.id} (${spec.summary}) survived all ${golden.length} golden ` +
          `vectors. This means the vectors do not constrain this behaviour — a Rust ` +
          `port could ship this exact bug and stay green. This is a real coverage ` +
          `gap; do not weaken this assertion to make it pass.`
      ).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Mutants 14–15 target validateGiftLines' arbitration loop (Task 15) and are
// checked against validation-golden.json — the only vector family that
// exercises validateGiftLines at all. They don't touch resolveOffer, so
// golden.json vectors would never observe them.
// ---------------------------------------------------------------------------

interface ValidationMutantSpec {
  id: string;
  summary: string;
  run: (cart: Cart, offer: Offer) => Map<string, GiftValidation>;
}

const validationMutants: ValidationMutantSpec[] = [
  {
    id: 'M14',
    summary:
      'per-line maxQty — caps quantity per line instead of budgeting maxQty across every line claiming the same (tierId, variantId)',
    run: mutants.mutant14_perLineMaxQty,
  },
  {
    id: 'M15',
    summary: 'lowest-value claim wins — inverted arbitration sort',
    run: mutants.mutant15_lowestValueClaimWins,
  },
  {
    id: 'M16',
    summary: 'PERCENT claim value rounds instead of flooring (spec §6)',
    run: mutants.mutant16_percentRoundsInsteadOfFloors,
  },
  {
    id: 'M17',
    summary:
      'zero- or negative-quantity claims are not excluded from arbitration and can consume budget',
    run: mutants.mutant17_nonpositiveQuantityConsumesBudget,
  },
];

describe('mutation harness — gift-claim arbitration (validation-golden.json)', () => {
  for (const spec of validationMutants) {
    it(`${spec.id}: ${spec.summary}`, () => {
      const failures = validationGolden.filter((v) => {
        const actual = Object.fromEntries(spec.run(v.cart, v.offer));
        return !isDeepStrictEqual(actual, v.expected);
      });

      rows.push({
        id: spec.id,
        summary: spec.summary,
        vectorSet: 'validation-golden',
        total: validationGolden.length,
        failed: failures.length,
        status: failures.length > 0 ? 'CAUGHT' : 'SURVIVED',
      });

      expect(
        failures.length,
        `Mutant ${spec.id} (${spec.summary}) survived all ${validationGolden.length} ` +
          `validation vectors. This means the vectors do not constrain this ` +
          `arbitration behaviour — a Rust port could ship this exact bug and stay ` +
          `green. This is a real coverage gap; do not weaken this assertion to make ` +
          `it pass.`
      ).toBeGreaterThan(0);
    });
  }
});

afterAll(() => {
  if (rows.length === 0) return;
  // eslint-disable-next-line no-console
  console.log('\nMutation harness results (Task 19):');
  // eslint-disable-next-line no-console
  console.table(
    rows
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((r) => ({
        mutant: r.id,
        status: r.status,
        'failed/total': `${r.failed}/${r.total}`,
        vectors: r.vectorSet,
        summary: r.summary,
      }))
  );
});
