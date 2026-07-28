import { describe, it, expect } from 'vitest';
import { reconcile, removalMessage, selectedVariant, type ClaimedLine } from './claim';
import type { OfferEntitlements } from '../../app/entitlement';

const gift = (v: string) => ({ variantId: v, discountType: 'FREE' as const, value: 0, maxQty: 1 });

const entitlements = (
  gifts: Array<{ tierId: string; candidates: string[]; requiresChoice: boolean }>
): OfferEntitlements[] => [
  {
    offerId: 'o1',
    measure: 20000,
    unlockedTierIds: gifts.map((g) => g.tierId),
    gifts: gifts.map((g) => ({
      offerId: 'o1',
      tierId: g.tierId,
      candidates: g.candidates.map(gift),
      requiresChoice: g.requiresChoice,
    })),
    rewards: { freeShipping: false, orderPercent: 0, orderFixed: 0 },
  },
];

const line = (key: string, variantId: string, tierId = 't2'): ClaimedLine => ({
  key,
  variantId,
  offerId: 'o1',
  tierId,
});

describe('reconcile — additions', () => {
  it('auto-adds every pool entry when the whole pool is granted', () => {
    const r = reconcile(entitlements([{ tierId: 't2', candidates: ['a', 'b'], requiresChoice: false }]), []);
    expect(r.add.map((c) => c.variantId)).toEqual(['a', 'b']);
  });

  it('never auto-adds when the shopper must choose', () => {
    const r = reconcile(entitlements([{ tierId: 't2', candidates: ['a', 'b'], requiresChoice: true }]), []);
    expect(r.add).toEqual([]);
  });

  it('does not re-add something already in the cart', () => {
    const r = reconcile(
      entitlements([{ tierId: 't2', candidates: ['a', 'b'], requiresChoice: false }]),
      [line('k1', 'a')]
    );
    expect(r.add.map((c) => c.variantId)).toEqual(['b']);
  });

  it('adds nothing when nothing is entitled', () => {
    expect(reconcile([], [])).toEqual({ add: [], remove: [] });
  });
});

describe('reconcile — removals', () => {
  it('removes a claim whose tier is no longer granted', () => {
    const r = reconcile([], [line('k1', 'a')]);
    expect(r.remove).toEqual([{ key: 'k1', reason: 'no-longer-eligible' }]);
  });

  it('removes a claim for a variant the pool does not contain', () => {
    const r = reconcile(
      entitlements([{ tierId: 't2', candidates: ['a'], requiresChoice: true }]),
      [line('k1', 'forged')]
    );
    expect(r.remove).toEqual([{ key: 'k1', reason: 'not-in-pool' }]);
  });

  it('removes extra claims beyond one under PICK_ONE', () => {
    const r = reconcile(
      entitlements([{ tierId: 't2', candidates: ['a', 'b'], requiresChoice: true }]),
      [line('k1', 'a'), line('k2', 'b')]
    );
    expect(r.remove).toEqual([{ key: 'k2', reason: 'duplicate' }]);
  });

  it('keeps multiple lines when the whole pool is granted', () => {
    const r = reconcile(
      entitlements([{ tierId: 't2', candidates: ['a', 'b'], requiresChoice: false }]),
      [line('k1', 'a'), line('k2', 'b')]
    );
    expect(r.remove).toEqual([]);
  });

  it('frees the slot in the same pass when an ineligible claim is dropped', () => {
    // Tier stopped granting 'a' but still grants 'b' as a whole-pool tier.
    const r = reconcile(
      entitlements([{ tierId: 't2', candidates: ['b'], requiresChoice: false }]),
      [line('k1', 'a')]
    );
    expect(r.remove).toEqual([{ key: 'k1', reason: 'not-in-pool' }]);
    expect(r.add.map((c) => c.variantId)).toEqual(['b']);
  });
});

describe('removalMessage', () => {
  it('explains every reason — silent removal reads as a bug', () => {
    for (const reason of ['no-longer-eligible', 'not-in-pool', 'duplicate'] as const) {
      expect(removalMessage(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('selectedVariant', () => {
  it('reports what the shopper picked for a tier', () => {
    expect(selectedVariant([line('k1', 'a')], 'o1', 't2')).toBe('a');
  });

  it('is undefined when nothing is claimed yet', () => {
    expect(selectedVariant([], 'o1', 't2')).toBeUndefined();
  });
});
