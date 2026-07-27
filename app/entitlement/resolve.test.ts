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
