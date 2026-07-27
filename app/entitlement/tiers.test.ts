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
