import { resolveOffer } from './resolve';
import type { Cart, CartLine, GiftEntitlement, GiftPoolEntry, Offer } from './types';

export interface GiftValidation {
  valid: boolean;
  /** The pool entry that justifies the discount, when valid. */
  entry?: GiftPoolEntry;
  /** Units that may be discounted. Zero whenever `valid` is false. */
  discountQuantity: number;
}

const REJECTED: GiftValidation = { valid: false, discountQuantity: 0 };

/** A claim that survived matching and is competing for budget. */
interface Claim {
  lineId: string;
  quantity: number;
  tierId: string;
  entry: GiftPoolEntry;
  /** Discount this claim would yield, in minor units. */
  value: number;
}

/**
 * THE SECURITY BOUNDARY.
 *
 * Line attributes are hints written by client-side JavaScript and are trivially
 * forged. Entitlement is re-derived from cart state; the attributes are used
 * only to identify what a line is claiming, never as evidence that the claim is
 * good.
 *
 * Validation is deliberately cart-level, not a per-line predicate. Whether a
 * claim may be honoured depends on what the other lines already claimed:
 * PICK_ONE permits one claim per tier, SINGLE one across the offer, and maxQty
 * is a budget of units shared by every line claiming the same pool entry. A
 * per-line predicate cannot see any of that, so under it a crafted cart claimed
 * every product in every unlocked pool and the same variant split across three
 * lines yielded three free units.
 *
 * Returns one entry per gift-claiming line — every line carrying an offer id,
 * including the rejected ones. Lines absent from the map claimed nothing and
 * bill normally.
 *
 * The worst outcome of a client-side exploit is a confused shopper, never a
 * merchant losing inventory. Preserve that property in every change to this
 * file.
 */
export function validateGiftLines(
  cart: Cart,
  offer: Offer
): Map<string, GiftValidation> {
  const result = new Map<string, GiftValidation>();

  // Resolved once for the whole cart, not once per line.
  const entitlements = resolveOffer(cart, offer);

  const claims: Claim[] = [];
  for (const line of cart.lines) {
    // Not claiming a gift at all — no attribute, so nothing to arbitrate.
    if (line.giftOfferId === undefined) continue;

    // Every claiming line appears in the map. Rejected until it wins budget.
    result.set(line.id, REJECTED);

    const matched = matchClaim(entitlements.gifts, offer, line);
    if (matched === null) continue;

    // A line with nothing on it cannot receive a discount, and must not burn
    // a claim budget that a real line could have used.
    if (line.quantity <= 0) continue;

    claims.push({
      lineId: line.id,
      quantity: line.quantity,
      tierId: matched.tierId,
      entry: matched.entry,
      value: claimValue(matched.entry, line.unitPrice),
    });
  }

  // Highest-value claim wins; ties break on line id ascending. Explicit rather
  // than leaning on sort stability or subtraction, because this order is part
  // of the parity contract with the Rust function.
  claims.sort((a, b) => {
    if (a.value !== b.value) return a.value > b.value ? -1 : 1;
    return compareIdsByUtf8(a.lineId, b.lineId);
  });

  const oneClaimPerOffer = offer.claimPolicy.acrossTiers === 'SINGLE';
  const oneClaimPerTier = offer.claimPolicy.withinTier === 'PICK_ONE';

  let offerClaimTaken = false;
  const tiersAlreadyClaimed = new Set<string>();
  /** Remaining maxQty units, by tier id then variant id. */
  const unitsLeft = new Map<string, Map<string, number>>();

  for (const claim of claims) {
    if (oneClaimPerOffer && offerClaimTaken) continue;
    if (oneClaimPerTier && tiersAlreadyClaimed.has(claim.tierId)) continue;

    let byVariant = unitsLeft.get(claim.tierId);
    if (byVariant === undefined) {
      byVariant = new Map<string, number>();
      unitsLeft.set(claim.tierId, byVariant);
    }
    let remaining = byVariant.get(claim.entry.variantId);
    if (remaining === undefined) remaining = claim.entry.maxQty;

    // Budget spent by earlier, more valuable claims on this same pool entry.
    if (remaining <= 0) continue;

    const discountQuantity = Math.min(claim.quantity, remaining);
    byVariant.set(claim.entry.variantId, remaining - discountQuantity);
    if (oneClaimPerOffer) offerClaimTaken = true;
    if (oneClaimPerTier) tiersAlreadyClaimed.add(claim.tierId);

    result.set(claim.lineId, {
      valid: true,
      entry: claim.entry,
      discountQuantity,
    });
  }

  return result;
}

/**
 * The pool entry a line is claiming, or null when the claim is unsupported —
 * a different offer, a missing or unknown tier, a tier the policy did not
 * grant, or a variant that is in no granted pool.
 */
function matchClaim(
  gifts: GiftEntitlement[],
  offer: Offer,
  line: CartLine
): { tierId: string; entry: GiftPoolEntry } | null {
  if (line.giftOfferId !== offer.id) return null;
  if (line.giftTierId === undefined) return null;

  const entitlement = gifts.find((g) => g.tierId === line.giftTierId);
  if (entitlement === undefined) return null;

  const entry = entitlement.candidates.find((c) => c.variantId === line.variantId);
  if (entry === undefined) return null;

  return { tierId: entitlement.tierId, entry };
}

/**
 * The discount this claim would yield, in minor units — what "highest-value
 * claim wins" ranks on. Per unit, not per line: quantity is governed by the
 * maxQty budget, not by the ranking.
 */
function claimValue(entry: GiftPoolEntry, unitPrice: number): number {
  switch (entry.discountType) {
    case 'FREE':
      return unitPrice;
    case 'PERCENT':
      return Math.floor((unitPrice * entry.value) / 100);
    case 'FIXED':
      return Math.min(entry.value, unitPrice);
  }
}

/**
 * Byte-lexicographic comparison of two line ids, as the tie-break contract
 * requires.
 *
 * UTF-8 preserves code point order, so comparing code points reproduces Rust's
 * `str` ordering exactly. JavaScript's `<` compares UTF-16 code units, which
 * disagrees above U+FFFF because surrogates sort below U+E000-U+FFFF; and
 * `localeCompare` is locale-dependent, ordering "a" before "B". Neither can be
 * used here without licensing the two implementations to diverge.
 */
function compareIdsByUtf8(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca === undefined || cb === undefined) break;
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i >= a.length && j >= b.length) return 0;
  return i >= a.length ? -1 : 1;
}
