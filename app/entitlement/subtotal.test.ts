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
