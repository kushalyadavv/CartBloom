import { describe, it, expect } from 'vitest';
import { validateGiftLine } from './validateGift';
import type { Cart, CartLine, GiftPoolEntry, Offer, Tier } from './types';

const gift = (variantId: string, over: Partial<GiftPoolEntry> = {}): GiftPoolEntry => ({
  variantId, discountType: 'FREE', value: 0, maxQty: 1, ...over,
});

const tiers: Tier[] = [
  { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug'), gift('tote')] },
  { id: 't3', threshold: 15000, reward: 'GIFT', giftPool: [gift('hoodie')] },
];

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers,
  ...over,
});

const giftLine = (over: Partial<CartLine> = {}): CartLine => ({
  id: 'lg', quantity: 1, unitPrice: 4000, variantId: 'mug', inScope: ['o1'],
  giftOfferId: 'o1', giftTierId: 't2', ...over,
});

const cartWith = (line: CartLine, spend = 16000): Cart => ({
  lines: [
    { id: 'l1', quantity: 1, unitPrice: spend, variantId: 'sweater', inScope: ['o1'] },
    line,
  ],
});

describe('validateGiftLine', () => {
  it('accepts a genuinely entitled gift line', () => {
    const r = validateGiftLine(cartWith(giftLine()), offer(), giftLine());
    expect(r.valid).toBe(true);
    expect(r.entry).toEqual(gift('mug'));
  });

  it('rejects a variant that is not in the claimed tier pool', () => {
    const forged = giftLine({ variantId: 'expensive-jacket' });
    expect(validateGiftLine(cartWith(forged), offer(), forged).valid).toBe(false);
  });

  it('rejects a line claiming a tier that is not unlocked', () => {
    const line = giftLine({ giftTierId: 't3', variantId: 'hoodie' });
    const r = validateGiftLine(cartWith(line, 9000), offer(), line);
    expect(r.valid).toBe(false);
  });

  it('rejects a line claiming an unknown tier id', () => {
    const line = giftLine({ giftTierId: 'does-not-exist' });
    expect(validateGiftLine(cartWith(line), offer(), line).valid).toBe(false);
  });

  it('rejects a line claiming a different offer', () => {
    const line = giftLine({ giftOfferId: 'other-offer' });
    expect(validateGiftLine(cartWith(line), offer(), line).valid).toBe(false);
  });

  it('rejects a line with no gift attributes at all', () => {
    const plain: CartLine = {
      id: 'l9', quantity: 1, unitPrice: 4000, variantId: 'mug', inScope: ['o1'],
    };
    expect(validateGiftLine(cartWith(plain), offer(), plain).valid).toBe(false);
  });

  it('caps the discountable quantity at the pool entry maxQty', () => {
    const line = giftLine({ quantity: 5 });
    const r = validateGiftLine(cartWith(line), offer(), line);
    expect(r.valid).toBe(true);
    expect(r.discountQuantity).toBe(1);
  });

  it('allows up to maxQty when the pool entry permits more than one', () => {
    const twoOffer = offer({
      tiers: [
        { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug', { maxQty: 2 })] },
      ],
    });
    const line = giftLine({ quantity: 5 });
    const r = validateGiftLine(cartWith(line), twoOffer, line);
    expect(r.discountQuantity).toBe(2);
  });

  it('discounts only what is present when quantity is below maxQty', () => {
    const twoOffer = offer({
      tiers: [
        { id: 't2', threshold: 10000, reward: 'GIFT', giftPool: [gift('mug', { maxQty: 3 })] },
      ],
    });
    const line = giftLine({ quantity: 2 });
    expect(validateGiftLine(cartWith(line), twoOffer, line).discountQuantity).toBe(2);
  });

  it('rejects a tier not granted under SINGLE/HIGHEST even though it is unlocked', () => {
    const single = offer({
      claimPolicy: {
        withinTier: 'PICK_ONE', acrossTiers: 'SINGLE', singleResolution: 'HIGHEST',
      },
    });
    const line = giftLine({ giftTierId: 't2', variantId: 'mug' });
    expect(validateGiftLine(cartWith(line), single, line).valid).toBe(false);
  });
});
