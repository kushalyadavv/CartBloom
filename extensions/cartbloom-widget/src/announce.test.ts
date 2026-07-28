import { describe, it, expect } from 'vitest';
import { announcement } from './announce';
import type { OfferEntitlements } from '../../../app/entitlement';

const state = (
  unlocked: string[],
  gifts: Array<{ tierId: string; requiresChoice: boolean }> = []
): OfferEntitlements[] => [
  {
    offerId: 'o1',
    measure: 0,
    unlockedTierIds: unlocked,
    gifts: gifts.map((g) => ({
      offerId: 'o1',
      tierId: g.tierId,
      candidates: [{ variantId: 'v1', discountType: 'FREE', value: 0, maxQty: 1 }],
      requiresChoice: g.requiresChoice,
    })),
    rewards: { freeShipping: false, orderPercent: 0, orderFixed: 0 },
  },
];

describe('announcement', () => {
  it('stays silent on first paint — the shopper did not just do anything', () => {
    expect(announcement({ previous: null, current: state(['t1']) })).toBeNull();
  });

  it('stays silent when nothing changed', () => {
    expect(announcement({ previous: state(['t1']), current: state(['t1']) })).toBeNull();
  });

  it('stays silent when a tier is lost — the removal notice already says so', () => {
    expect(announcement({ previous: state(['t1', 't2']), current: state(['t1']) })).toBeNull();
  });

  it('announces a newly unlocked tier', () => {
    const msg = announcement({ previous: state([]), current: state(['t1']) });
    expect(msg).toBe('Reward unlocked.');
  });

  it('tells the shopper to choose when the new tier needs a choice', () => {
    const msg = announcement({
      previous: state([]),
      current: state(['t2'], [{ tierId: 't2', requiresChoice: true }]),
    });
    expect(msg).toContain('Choose your free gift');
  });

  it('says the gift was added when no choice is needed', () => {
    const msg = announcement({
      previous: state([]),
      current: state(['t2'], [{ tierId: 't2', requiresChoice: false }]),
    });
    expect(msg).toContain('added');
  });

  it('counts multiple tiers unlocked at once', () => {
    const msg = announcement({ previous: state([]), current: state(['t1', 't2']) });
    expect(msg).toBe('2 rewards unlocked.');
  });

  it('does not re-announce a tier that was already unlocked', () => {
    const msg = announcement({ previous: state(['t1']), current: state(['t1', 't2']) });
    expect(msg).toBe('Reward unlocked.');
  });
});
