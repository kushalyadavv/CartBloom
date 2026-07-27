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
