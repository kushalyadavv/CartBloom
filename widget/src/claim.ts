/**
 * Deciding which gift lines should exist.
 *
 * Pure: takes entitlements and the current cart, returns the mutations needed.
 * Keeping it free of fetch and DOM makes the rules testable, which matters
 * because the interesting cases are all "cart changed underneath us".
 *
 * The rule that shapes everything here: **`ALL_IN_POOL` auto-adds, `PICK_ONE`
 * never does.** Auto-adding something the shopper must then discover and change
 * is worse than showing them a choice, and a gift appearing in the cart without
 * being asked for reads as the app adding items on its own.
 */

import type { OfferEntitlements, GiftEntitlement } from '../../app/entitlement';
import type { GiftClaim } from './mutate';

export interface ClaimedLine {
  key: string;
  variantId: string;
  offerId: string;
  tierId: string;
}

export type RemovalReason = 'no-longer-eligible' | 'not-in-pool' | 'duplicate';

export interface Removal {
  key: string;
  reason: RemovalReason;
}

export interface Reconciliation {
  add: GiftClaim[];
  remove: Removal[];
}

function entitlementFor(
  entitlements: OfferEntitlements[],
  offerId: string,
  tierId: string
): GiftEntitlement | undefined {
  return entitlements
    .find((e) => e.offerId === offerId)
    ?.gifts.find((g) => g.tierId === tierId);
}

/**
 * What to add and what to remove, given where the cart is now.
 *
 * Removals are computed before additions so a line losing eligibility frees its
 * slot in the same pass, rather than leaving the shopper one cart update behind.
 */
export function reconcile(
  entitlements: OfferEntitlements[],
  claimed: ClaimedLine[]
): Reconciliation {
  const remove: Removal[] = [];
  const surviving: ClaimedLine[] = [];

  // --- removals ---------------------------------------------------------

  const seenPerTier = new Set<string>();

  for (const line of claimed) {
    const entitlement = entitlementFor(entitlements, line.offerId, line.tierId);

    if (entitlement === undefined) {
      // The tier stopped being granted — the cart fell below its threshold, or
      // a SINGLE policy moved the grant to a different tier.
      remove.push({ key: line.key, reason: 'no-longer-eligible' });
      continue;
    }

    if (!entitlement.candidates.some((c) => c.variantId === line.variantId)) {
      // Claiming something the pool does not contain. The discount function
      // would refuse it anyway and the shopper would be charged full price, so
      // removing it is kinder than leaving a surprise at checkout.
      remove.push({ key: line.key, reason: 'not-in-pool' });
      continue;
    }

    const slot = `${line.offerId}:${line.tierId}`;
    if (entitlement.requiresChoice && seenPerTier.has(slot)) {
      // More claims than the policy allows. The function arbitrates and grants
      // one; the widget removes the rest so the cart matches what will actually
      // be charged.
      remove.push({ key: line.key, reason: 'duplicate' });
      continue;
    }

    seenPerTier.add(slot);
    surviving.push(line);
  }

  // --- additions --------------------------------------------------------

  const add: GiftClaim[] = [];

  for (const offer of entitlements) {
    for (const gift of offer.gifts) {
      // PICK_ONE waits for the shopper. Only whole-pool grants auto-add.
      if (gift.requiresChoice) continue;

      for (const candidate of gift.candidates) {
        const present = surviving.some(
          (l) =>
            l.offerId === offer.offerId &&
            l.tierId === gift.tierId &&
            l.variantId === candidate.variantId
        );
        if (!present) {
          add.push({
            variantId: candidate.variantId,
            offerId: offer.offerId,
            tierId: gift.tierId,
          });
        }
      }
    }
  }

  return { add, remove };
}

/**
 * What to tell the shopper when a gift disappears.
 *
 * Silent removal reads as a bug, and the merchant fields that support ticket,
 * not us. Every removal reason gets a sentence.
 */
export function removalMessage(reason: RemovalReason): string {
  switch (reason) {
    case 'no-longer-eligible':
      return 'Your free gift was removed because your cart no longer qualifies.';
    case 'not-in-pool':
      return 'That item is not available as a gift, so it was removed.';
    case 'duplicate':
      return 'Only one gift can be claimed, so the extra was removed.';
  }
}

/** Which variant the shopper has chosen for a tier, if any. */
export function selectedVariant(
  claimed: ClaimedLine[],
  offerId: string,
  tierId: string
): string | undefined {
  return claimed.find((l) => l.offerId === offerId && l.tierId === tierId)?.variantId;
}
