import { resolveOffer } from './resolve';
import type { Cart, CartLine, GiftPoolEntry, Offer } from './types';

export interface GiftValidation {
  valid: boolean;
  /** The pool entry that justifies the discount, when valid. */
  entry?: GiftPoolEntry;
  /** Units that may be discounted. Always <= line.quantity and <= entry.maxQty. */
  discountQuantity: number;
}

const INVALID: GiftValidation = { valid: false, discountQuantity: 0 };

/**
 * THE SECURITY BOUNDARY.
 *
 * Line attributes are hints written by client-side JavaScript and are trivially
 * forged. This function ignores them as evidence and re-derives entitlement
 * from cart state, using them only to identify what the line is claiming.
 *
 * A forged line simply receives no discount and bills at full price. The worst
 * outcome of a client-side exploit is a confused shopper, never a merchant
 * losing inventory. Preserve that property in every change to this file.
 */
export function validateGiftLine(
  cart: Cart,
  offer: Offer,
  line: CartLine
): GiftValidation {
  if (line.giftOfferId === undefined || line.giftTierId === undefined) return INVALID;
  if (line.giftOfferId !== offer.id) return INVALID;

  // Re-derive entitlements rather than trusting the claim.
  const entitlements = resolveOffer(cart, offer);

  const entitlement = entitlements.gifts.find((g) => g.tierId === line.giftTierId);
  if (entitlement === undefined) return INVALID;

  const entry = entitlement.candidates.find((c) => c.variantId === line.variantId);
  if (entry === undefined) return INVALID;

  return {
    valid: true,
    entry,
    discountQuantity: Math.min(line.quantity, entry.maxQty),
  };
}
