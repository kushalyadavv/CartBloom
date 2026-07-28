// @vitest-environment jsdom
/**
 * Widget/function input parity.
 *
 * The golden vectors bind the two *core* implementations: given identical
 * inputs, Rust and TypeScript produce identical entitlements. They say nothing
 * about whether each host actually feeds the core the same inputs — and a wrong
 * input produces a wrong answer from perfectly correct logic.
 *
 * That gap is not hypothetical. It shipped: `/cart.js` reports `variant_id` as
 * a bare number while the config and the function's input use GIDs, so
 * reconciliation compared "52565716795524" against
 * "gid://shopify/ProductVariant/52565716795524", decided every genuine claim
 * was forged, and removed the gift it had just added. Every unit test passed.
 *
 * Each case below states the same cart in both dialects — the AJAX shape the
 * widget receives, and the normalised shape the function builds — and asserts
 * the widget's normalisation lands on the latter.
 */

import { describe, it, expect } from 'vitest';
import { normaliseCart } from './index';
import type { AjaxCartLine } from './cart';
import { resolveOffer, type Cart, type Offer } from '../../app/entitlement';

const MUG = 'gid://shopify/ProductVariant/1000000000001';
const TOTE = 'gid://shopify/ProductVariant/1000000000002';
const SWEATER = 'gid://shopify/ProductVariant/1000000000003';

const offer: Offer = {
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: [
    { id: 't1', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
    {
      id: 't2',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [
        { variantId: MUG, discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: TOTE, discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
  ],
};

interface ParityCase {
  name: string;
  /** What the widget receives from /cart.js. */
  ajax: AjaxCartLine[];
  /** What the discount function builds from its GraphQL input. */
  fn: Cart;
}

const numeric = (gid: string): number => Number(gid.slice(gid.lastIndexOf('/') + 1));

const cases: ParityCase[] = [
  {
    name: 'plain cart, no claims',
    ajax: [
      { key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null },
    ],
    fn: {
      lines: [
        { id: 'l1', quantity: 1, unitPrice: 12000, variantId: SWEATER, inScope: ['o1'] },
      ],
    },
  },
  {
    name: 'a claimed gift — the case that shipped broken',
    ajax: [
      { key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null },
      {
        key: 'lg',
        variant_id: numeric(MUG),
        product_id: 901,
        quantity: 1,
        original_price: 3000,
        properties: { _cartbloom_offer: 'o1', _cartbloom_tier: 't2' },
      },
    ],
    fn: {
      lines: [
        { id: 'l1', quantity: 1, unitPrice: 12000, variantId: SWEATER, inScope: ['o1'] },
        {
          id: 'lg',
          quantity: 1,
          unitPrice: 3000,
          variantId: MUG,
          inScope: ['o1'],
          giftOfferId: 'o1',
          giftTierId: 't2',
        },
      ],
    },
  },
  {
    name: 'quantity above one',
    ajax: [
      { key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 3, original_price: 12000, properties: null },
    ],
    fn: {
      lines: [{ id: 'l1', quantity: 3, unitPrice: 12000, variantId: SWEATER, inScope: ['o1'] }],
    },
  },
  {
    name: 'empty cart',
    ajax: [],
    fn: { lines: [] },
  },
];

describe('widget normalisation matches what the function builds', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    expect(normaliseCart(testCase.ajax, [offer])).toEqual(testCase.fn);
  });

  it.each(cases.map((c) => [c.name, c] as const))(
    'produces identical entitlements: %s',
    (_name, testCase) => {
      const fromWidget = resolveOffer(normaliseCart(testCase.ajax, [offer]), offer);
      const fromFunction = resolveOffer(testCase.fn, offer);
      expect(fromWidget).toEqual(fromFunction);
    }
  );
});

describe('the ID-space regression specifically', () => {
  it('a claimed gift is recognised as belonging to the pool', () => {
    const cart = normaliseCart(
      [
        { key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null },
        {
          key: 'lg',
          variant_id: numeric(MUG),
          product_id: 901,
          quantity: 1,
          original_price: 3000,
          properties: { _cartbloom_offer: 'o1', _cartbloom_tier: 't2' },
        },
      ],
      [offer]
    );

    const claimed = cart.lines.find((l) => l.giftOfferId !== undefined)!;
    const pool = offer.tiers[1].giftPool.map((g) => g.variantId);

    // The assertion that would have failed before the fix.
    expect(pool).toContain(claimed.variantId);
  });

  it('the gift line does not count toward its own threshold', () => {
    // Sweater alone is $120, over the $100 gift tier. If the $30 gift counted,
    // the measure would be $150 and the oscillation trap would be live.
    const cart = normaliseCart(
      [
        { key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null },
        {
          key: 'lg',
          variant_id: numeric(MUG),
          product_id: 901,
          quantity: 1,
          original_price: 3000,
          properties: { _cartbloom_offer: 'o1', _cartbloom_tier: 't2' },
        },
      ],
      [offer]
    );

    expect(resolveOffer(cart, offer).measure).toBe(12000);
  });
});

describe('the widget never over-promises', () => {
  it('an unresolvable COLLECTIONS scope excludes the line rather than counting it', () => {
    const scoped = {
      ...offer,
      scope: { kind: 'COLLECTIONS' as const, ids: ['gid://shopify/Collection/5'] },
    };

    const cart = normaliseCart(
      [{ key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null }],
      [scoped]
    );

    // The function could answer this from a live inCollections query. The
    // widget cannot, so it under-counts — a smaller number than earned, never
    // a larger one.
    expect(cart.lines[0].inScope).toEqual([]);
    expect(resolveOffer(cart, scoped).unlockedTierIds).toEqual([]);
  });

  it('widget entitlements are always a subset of what the function would grant', () => {
    const scoped = {
      ...offer,
      scope: { kind: 'COLLECTIONS' as const, ids: ['gid://shopify/Collection/5'] },
    };

    const widgetCart = normaliseCart(
      [{ key: 'l1', variant_id: numeric(SWEATER), product_id: 900, quantity: 1, original_price: 12000, properties: null }],
      [scoped]
    );
    // What the function sees, having resolved membership live.
    const functionCart: Cart = {
      lines: [{ id: 'l1', quantity: 1, unitPrice: 12000, variantId: SWEATER, inScope: ['o1'] }],
    };

    const widgetUnlocked = resolveOffer(widgetCart, scoped).unlockedTierIds;
    const functionUnlocked = resolveOffer(functionCart, scoped).unlockedTierIds;

    for (const id of widgetUnlocked) expect(functionUnlocked).toContain(id);
  });
});
