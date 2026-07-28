// @vitest-environment jsdom
/**
 * The widget and the discount function must feed the shared entitlement core
 * the *same* inputs, not merely run the same logic on whatever each has.
 *
 * `/cart.js` reports `variant_id` as a bare number. The config and the
 * function's input both use GIDs. Comparing those directly makes every genuine
 * claim look forged: reconciliation removes the gift it has just added and
 * tells the shopper "that item is not available as a gift". That shipped to a
 * real drawer and is what these tests exist to prevent recurring.
 */

import { describe, it, expect } from 'vitest';
import { normaliseCart } from './index';
import type { AjaxCartLine } from './cart';
import type { Offer } from '../../app/entitlement';

const GID = 'gid://shopify/ProductVariant/52565716795524';

const offer: Offer = {
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: [
    {
      id: 't2',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [{ variantId: GID, discountType: 'FREE', value: 0, maxQty: 1 }],
    },
  ],
};

const line = (over: Partial<AjaxCartLine> = {}): AjaxCartLine => ({
  key: 'k1',
  variant_id: 52565716795524,
  product_id: 111,
  quantity: 1,
  original_price: 88595,
  properties: null,
  ...over,
});

describe('normaliseCart — ID space', () => {
  it('converts the numeric variant id from /cart.js into a GID', () => {
    const cart = normaliseCart([line()], [offer]);
    expect(cart.lines[0].variantId).toBe(GID);
  });

  it('produces ids that match the gift pool the config declares', () => {
    const cart = normaliseCart([line()], [offer]);
    const poolIds = offer.tiers[0].giftPool.map((g) => g.variantId);
    expect(poolIds).toContain(cart.lines[0].variantId);
  });

  it('leaves an already-GID value alone', () => {
    const cart = normaliseCart([line({ variant_id: GID as unknown as number })], [offer]);
    expect(cart.lines[0].variantId).toBe(GID);
  });

  it('carries the gift claim attributes through', () => {
    const cart = normaliseCart(
      [line({ properties: { _cartbloom_offer: 'o1', _cartbloom_tier: 't2' } })],
      [offer]
    );
    expect(cart.lines[0].giftOfferId).toBe('o1');
    expect(cart.lines[0].giftTierId).toBe('t2');
  });

  it('uses the undiscounted price, so a granted gift cannot lower the measure', () => {
    const cart = normaliseCart([line({ original_price: 88595 })], [offer]);
    expect(cart.lines[0].unitPrice).toBe(88595);
  });
});
