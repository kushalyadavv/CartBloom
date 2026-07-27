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

  it('grants nothing when PINNED has no pinnedTierId set at all', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'PINNED', pinnedTierId: undefined })
    );
    expect(result).toEqual([]);
  });

  it('grants nothing when PINNED names a tier id that exists nowhere in the offer', () => {
    const result = resolveAcrossTiers(
      unlocked,
      policy({ acrossTiers: 'SINGLE', singleResolution: 'PINNED', pinnedTierId: 'no-such-tier' })
    );
    expect(result).toEqual([]);
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
