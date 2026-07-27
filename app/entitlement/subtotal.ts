import type { Cart, CartLine, Offer } from './types';

/** A line is a gift if any offer marked it as one. Gifts never count. */
function isGiftLine(line: CartLine): boolean {
  return line.giftOfferId !== undefined;
}

/**
 * The measure compared against tier thresholds.
 *
 * Deliberately computed from UNDISCOUNTED unit prices of NON-GIFT lines only.
 * Any other basis causes oscillation: a gift zeroes out, the subtotal drops
 * below the threshold, the entitlement is lost, the discount is removed, the
 * subtotal rises, and the entitlement returns.
 */
export function qualifyingMeasure(cart: Cart, offer: Offer): number {
  let total = 0;
  for (const line of cart.lines) {
    if (isGiftLine(line)) continue;
    if (!line.inScope.includes(offer.id)) continue;
    total +=
      offer.trigger === 'QUANTITY'
        ? line.quantity
        : line.unitPrice * line.quantity;
  }
  return total;
}
