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
