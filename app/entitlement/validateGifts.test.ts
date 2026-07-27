import { describe, it, expect } from 'vitest';
import { validateGiftLines, type GiftValidation } from './validateGifts';
import type { Cart, CartLine, GiftPoolEntry, Offer, Tier } from './types';

const entry = (
  variantId: string,
  over: Partial<GiftPoolEntry> = {}
): GiftPoolEntry => ({
  variantId, discountType: 'FREE', value: 0, maxQty: 1, ...over,
});

const giftTier = (id: string, threshold: number, pool: GiftPoolEntry[]): Tier => ({
  id, threshold, reward: 'GIFT', giftPool: pool,
});

/** t2 unlocks at 10000 with a pool of three; t3 unlocks at 15000 with one. */
const offerWith = (over: Partial<Offer> = {}): Offer => ({
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: [
    giftTier('t2', 10000, [entry('mug'), entry('tote'), entry('candle')]),
    giftTier('t3', 15000, [entry('hoodie')]),
  ],
  ...over,
});

/** A non-gift line whose value carries the cart over a threshold. */
const spend = (amount: number): CartLine => ({
  id: 'l1', quantity: 1, unitPrice: amount, variantId: 'sweater', inScope: ['o1'],
});

const claim = (
  id: string,
  variantId: string,
  over: Partial<CartLine> = {}
): CartLine => ({
  id, quantity: 1, unitPrice: 4000, variantId, inScope: ['o1'],
  giftOfferId: 'o1', giftTierId: 't2', ...over,
});

const cart = (...lines: CartLine[]): Cart => ({ lines });

/** Total free units the offer would hand over for this cart. */
const grantedUnits = (m: Map<string, GiftValidation>): number =>
  [...m.values()].reduce((n, v) => n + v.discountQuantity, 0);

const acceptedIds = (m: Map<string, GiftValidation>): string[] =>
  [...m.entries()].filter(([, v]) => v.valid).map(([id]) => id).sort();

describe('validateGiftLines', () => {
  // ---------------------------------------------------------------------
  // Defect 1: PICK_ONE and SINGLE were enforced nowhere. A per-line
  // predicate cannot see what the other lines already claimed, so every
  // pool member — and every unlocked tier — validated independently.
  // ---------------------------------------------------------------------
  describe('claim-count budgets', () => {
    it('grants exactly one gift when PICK_ONE and the whole pool is claimed', () => {
      const c = cart(
        spend(12000),
        claim('lm', 'mug'),
        claim('lt', 'tote'),
        claim('lc', 'candle')
      );
      const result = validateGiftLines(c, offerWith());

      expect(grantedUnits(result)).toBe(1);
      expect(acceptedIds(result)).toHaveLength(1);
    });

    it('picks the most valuable PICK_ONE claim, not the first in the cart', () => {
      const offer = offerWith({
        tiers: [
          giftTier('t2', 10000, [
            entry('mug'),
            entry('tote', { discountType: 'PERCENT', value: 50 }),
            entry('candle', { discountType: 'FIXED', value: 2000 }),
          ]),
        ],
      });
      // candle -> min(2000, 1000) = 1000; tote -> floor(3000 * 50/100) = 1500;
      // mug -> 4000. The winner is last in cart order.
      const c = cart(
        spend(12000),
        claim('lc', 'candle', { unitPrice: 1000 }),
        claim('lt', 'tote', { unitPrice: 3000 }),
        claim('lm', 'mug', { unitPrice: 4000 })
      );
      const result = validateGiftLines(c, offer);

      expect(acceptedIds(result)).toEqual(['lm']);
      expect(result.get('lt')).toEqual({ valid: false, discountQuantity: 0 });
      expect(result.get('lc')).toEqual({ valid: false, discountQuantity: 0 });
    });

    it('grants one gift per tier under PICK_ONE + STACK', () => {
      const c = cart(
        spend(16000),
        claim('lm', 'mug'),
        claim('lt', 'tote'),
        claim('lh', 'hoodie', { giftTierId: 't3' })
      );
      const result = validateGiftLines(c, offerWith());

      expect(grantedUnits(result)).toBe(2);
      expect(acceptedIds(result)).toEqual(['lh', 'lm']);
    });

    it('grants exactly one gift when SINGLE:CUSTOMER_CHOICE is claimed in two tiers', () => {
      const offer = offerWith({
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'CUSTOMER_CHOICE',
        },
      });
      const c = cart(
        spend(16000),
        claim('lm', 'mug'),
        claim('lh', 'hoodie', { giftTierId: 't3' })
      );
      const result = validateGiftLines(c, offer);

      expect(grantedUnits(result)).toBe(1);
      expect(acceptedIds(result)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // Defect 2: maxQty capped per line. The same variant split across lines
  // -- reachable without malice, since _cartbloom_v differs after the
  // merchant republishes and Shopify will not merge the lines -- yielded
  // one free unit per line.
  // ---------------------------------------------------------------------
  describe('maxQty budgets', () => {
    it('grants one unit when maxQty is 1 and the variant is split across three lines', () => {
      const offer = offerWith({
        claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
        tiers: [giftTier('t2', 10000, [entry('mug', { maxQty: 1 })])],
      });
      const c = cart(
        spend(12000),
        claim('la', 'mug'),
        claim('lb', 'mug'),
        claim('lc', 'mug')
      );
      const result = validateGiftLines(c, offer);

      expect(grantedUnits(result)).toBe(1);
      expect(result.size).toBe(3);
    });

    it('grants two units when maxQty is 2 and the variant is split across three lines', () => {
      const offer = offerWith({
        claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
        tiers: [giftTier('t2', 10000, [entry('mug', { maxQty: 2 })])],
      });
      const c = cart(
        spend(12000),
        claim('la', 'mug'),
        claim('lb', 'mug'),
        claim('lc', 'mug')
      );
      const result = validateGiftLines(c, offer);

      expect(grantedUnits(result)).toBe(2);
      expect(acceptedIds(result)).toEqual(['la', 'lb']);
      expect(result.get('lc')).toEqual({ valid: false, discountQuantity: 0 });
    });

    it('budgets separately per variant within a tier', () => {
      const offer = offerWith({
        claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
        tiers: [
          giftTier('t2', 10000, [
            entry('mug', { maxQty: 1 }),
            entry('tote', { maxQty: 1 }),
          ]),
        ],
      });
      const c = cart(
        spend(12000),
        claim('la', 'mug'),
        claim('lb', 'mug'),
        claim('lc', 'tote')
      );
      const result = validateGiftLines(c, offer);

      expect(grantedUnits(result)).toBe(2);
      expect(acceptedIds(result)).toEqual(['la', 'lc']);
    });

    it('caps a single line at maxQty', () => {
      const c = cart(spend(12000), claim('lm', 'mug', { quantity: 5 }));
      expect(validateGiftLines(c, offerWith()).get('lm')).toEqual({
        valid: true, entry: entry('mug'), discountQuantity: 1,
      });
    });

    it('allows up to maxQty on one line when the pool entry permits more', () => {
      const offer = offerWith({
        tiers: [giftTier('t2', 10000, [entry('mug', { maxQty: 2 })])],
      });
      const c = cart(spend(12000), claim('lm', 'mug', { quantity: 5 }));
      expect(validateGiftLines(c, offer).get('lm')?.discountQuantity).toBe(2);
    });

    it('discounts only what is present when quantity is below maxQty', () => {
      const offer = offerWith({
        tiers: [giftTier('t2', 10000, [entry('mug', { maxQty: 3 })])],
      });
      const c = cart(spend(12000), claim('lm', 'mug', { quantity: 2 }));
      expect(validateGiftLines(c, offer).get('lm')?.discountQuantity).toBe(2);
    });
  });

  describe('ALL_IN_POOL + STACK', () => {
    it('grants every distinct pool entry across every unlocked tier', () => {
      const offer = offerWith({
        claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
      });
      const c = cart(
        spend(16000),
        claim('lm', 'mug'),
        claim('lt', 'tote'),
        claim('lc', 'candle'),
        claim('lh', 'hoodie', { giftTierId: 't3' })
      );
      const result = validateGiftLines(c, offer);

      expect(grantedUnits(result)).toBe(4);
      expect(acceptedIds(result)).toEqual(['lc', 'lh', 'lm', 'lt']);
    });
  });

  // ---------------------------------------------------------------------
  // The security boundary. Line attributes are forgeable hints; entitlement
  // is re-derived from cart state and the claim is matched against it.
  // ---------------------------------------------------------------------
  describe('claim matching', () => {
    it('accepts a genuinely entitled gift line', () => {
      const result = validateGiftLines(cart(spend(12000), claim('lm', 'mug')), offerWith());
      expect(result.get('lm')).toEqual({
        valid: true, entry: entry('mug'), discountQuantity: 1,
      });
    });

    it('rejects a forged variant that is in no pool', () => {
      const c = cart(spend(12000), claim('lx', 'expensive-jacket', { unitPrice: 40000 }));
      expect(validateGiftLines(c, offerWith()).get('lx')).toEqual({
        valid: false, discountQuantity: 0,
      });
    });

    it('rejects a claim on a tier that is not unlocked', () => {
      const c = cart(spend(12000), claim('lh', 'hoodie', { giftTierId: 't3' }));
      expect(validateGiftLines(c, offerWith()).get('lh')?.valid).toBe(false);
    });

    it('rejects a claim on an unknown tier id', () => {
      const c = cart(spend(12000), claim('lm', 'mug', { giftTierId: 'does-not-exist' }));
      expect(validateGiftLines(c, offerWith()).get('lm')?.valid).toBe(false);
    });

    it('rejects a claim naming a different offer', () => {
      const c = cart(spend(12000), claim('lm', 'mug', { giftOfferId: 'other-offer' }));
      expect(validateGiftLines(c, offerWith()).get('lm')).toEqual({
        valid: false, discountQuantity: 0,
      });
    });

    it('rejects a claim carrying an offer id but no tier id', () => {
      const c = cart(spend(12000), claim('lm', 'mug', { giftTierId: undefined }));
      expect(validateGiftLines(c, offerWith()).get('lm')?.valid).toBe(false);
    });

    it('rejects a claim on a tier not granted under SINGLE/HIGHEST', () => {
      const offer = offerWith({
        claimPolicy: {
          withinTier: 'PICK_ONE', acrossTiers: 'SINGLE', singleResolution: 'HIGHEST',
        },
      });
      const c = cart(spend(16000), claim('lm', 'mug'));
      expect(validateGiftLines(c, offer).get('lm')?.valid).toBe(false);
    });

    it('omits lines that claim no gift at all', () => {
      const result = validateGiftLines(cart(spend(12000), claim('lm', 'mug')), offerWith());
      expect(result.has('l1')).toBe(false);
      expect(result.size).toBe(1);
    });

    it('includes every gift-claiming line, rejected ones at zero quantity', () => {
      const c = cart(
        spend(12000),
        claim('lm', 'mug'),
        claim('lx', 'forged'),
        claim('ly', 'mug', { giftOfferId: 'other-offer' })
      );
      const result = validateGiftLines(c, offerWith());

      expect([...result.keys()].sort()).toEqual(['lm', 'lx', 'ly']);
      expect(result.get('lx')).toEqual({ valid: false, discountQuantity: 0 });
      expect(result.get('ly')).toEqual({ valid: false, discountQuantity: 0 });
    });

    it('grants nothing when a forged claim is the only claim', () => {
      const c = cart(spend(12000), claim('lx', 'expensive-jacket', { unitPrice: 40000 }));
      expect(grantedUnits(validateGiftLines(c, offerWith()))).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Arbitration order is part of the parity contract: Rust's HashMap
  // iteration and sort_unstable are not TypeScript's.
  // ---------------------------------------------------------------------
  describe('arbitration order', () => {
    it('ranks FIXED, PERCENT and FREE claims by the discount each would yield', () => {
      const offer = offerWith({
        tiers: [
          giftTier('t2', 10000, [
            entry('mug'),
            entry('tote', { discountType: 'FIXED', value: 3000 }),
            entry('candle', { discountType: 'PERCENT', value: 10 }),
          ]),
        ],
      });
      // mug -> 500; tote -> min(3000, 4000) = 3000; candle -> floor(10000/10) = 1000.
      const c = cart(
        spend(12000),
        claim('lm', 'mug', { unitPrice: 500 }),
        claim('lt', 'tote', { unitPrice: 4000 }),
        claim('lc', 'candle', { unitPrice: 10000 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['lt']);
    });

    it('clamps a FIXED claim to the line unit price', () => {
      const offer = offerWith({
        tiers: [
          giftTier('t2', 10000, [
            entry('mug'),
            entry('tote', { discountType: 'FIXED', value: 9000 }),
          ]),
        ],
      });
      // tote -> min(9000, 1000) = 1000, so the FREE mug at 1500 wins.
      const c = cart(
        spend(12000),
        claim('lt', 'tote', { unitPrice: 1000 }),
        claim('lm', 'mug', { unitPrice: 1500 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['lm']);
    });

    it('floors a PERCENT claim rather than rounding it', () => {
      const offer = offerWith({
        tiers: [
          giftTier('t2', 10000, [
            entry('mug'),
            entry('tote', { discountType: 'PERCENT', value: 50 }),
          ]),
        ],
      });
      // tote -> floor(999 * 50 / 100) = 499, losing to the FREE mug at 500.
      // Rounding up would tie at 500 and the lower line id 'la' would win,
      // so asserting 'lb' pins the flooring.
      const c = cart(
        spend(12000),
        claim('la', 'tote', { unitPrice: 999 }),
        claim('lb', 'mug', { unitPrice: 500 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['lb']);
    });

    it('breaks ties on the lower line id regardless of cart order', () => {
      const offer = offerWith({
        tiers: [giftTier('t2', 10000, [entry('mug'), entry('tote')])],
      });
      const c = cart(
        spend(12000),
        claim('lz', 'mug', { unitPrice: 4000 }),
        claim('la', 'tote', { unitPrice: 4000 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['la']);
    });

    it('breaks ties byte-lexicographically, not by locale collation', () => {
      const offer = offerWith({
        tiers: [giftTier('t2', 10000, [entry('mug'), entry('tote')])],
      });
      // 'B' is 0x42 and 'a' is 0x61, so byte order puts 'B-line' first.
      // localeCompare would put 'a-line' first.
      const c = cart(
        spend(12000),
        claim('a-line', 'mug', { unitPrice: 4000 }),
        claim('B-line', 'tote', { unitPrice: 4000 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['B-line']);
    });

    it('orders tied ids above U+FFFF by UTF-8 byte order, not UTF-16 code units', () => {
      const offer = offerWith({
        tiers: [giftTier('t2', 10000, [entry('mug'), entry('tote')])],
      });
      // U+FFFD encodes to EF BF BD and U+1F600 to F0 9F 98 80, so UTF-8 puts
      // U+FFFD first. UTF-16 code units disagree: the leading surrogate
      // 0xD83D sorts below 0xFFFD, so a naive `<` would pick the emoji.
      const c = cart(
        spend(12000),
        claim('\u{1F600}', 'mug', { unitPrice: 4000 }),
        claim('�', 'tote', { unitPrice: 4000 })
      );
      expect(acceptedIds(validateGiftLines(c, offer))).toEqual(['�']);
    });
  });

  describe('determinism', () => {
    it('returns the same result whatever order the cart lines arrive in', () => {
      const offer = offerWith();
      const lines = [
        spend(16000),
        claim('lm', 'mug'),
        claim('lt', 'tote'),
        claim('lh', 'hoodie', { giftTierId: 't3' }),
      ];
      const forward = validateGiftLines({ lines }, offer);
      const reversed = validateGiftLines({ lines: [...lines].reverse() }, offer);

      expect([...reversed.entries()].sort()).toEqual([...forward.entries()].sort());
    });

    it('does not mutate the cart or the offer', () => {
      const offer = offerWith();
      const c = cart(spend(16000), claim('lm', 'mug'), claim('lt', 'tote'));
      const cartBefore = JSON.stringify(c);
      const offerBefore = JSON.stringify(offer);

      validateGiftLines(c, offer);

      expect(JSON.stringify(c)).toBe(cartBefore);
      expect(JSON.stringify(offer)).toBe(offerBefore);
    });
  });
});
