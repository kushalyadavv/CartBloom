import { resolveAcrossTiers } from './acrossTiers';
import { resolveNonGiftRewards } from './rewards';
import { qualifyingMeasure } from './subtotal';
import { unlockedTiers } from './tiers';
import { resolveWithinTier } from './withinTier';
import type { Cart, GiftEntitlement, Offer, OfferEntitlements } from './types';

/**
 * The public entry point. Given a normalised cart and one offer, returns
 * everything the customer is entitled to.
 *
 * Pure and deterministic: identical inputs always produce identical output.
 * Both the discount function and the storefront widget call this, which is
 * what keeps the bar and checkout in agreement.
 */
export function resolveOffer(cart: Cart, offer: Offer): OfferEntitlements {
  const measure = qualifyingMeasure(cart, offer);
  const unlocked = unlockedTiers(offer.tiers, measure);
  const grantingTiers = resolveAcrossTiers(unlocked, offer.claimPolicy);

  const gifts: GiftEntitlement[] = [];
  for (const tier of grantingTiers) {
    const entitlement = resolveWithinTier(
      offer.id,
      tier,
      offer.claimPolicy.withinTier
    );
    if (entitlement !== null) gifts.push(entitlement);
  }

  return {
    offerId: offer.id,
    measure,
    unlockedTierIds: unlocked.map((t) => t.id),
    gifts,
    rewards: resolveNonGiftRewards(unlocked),
  };
}

/**
 * Under SINGLE, at most one gift may ultimately be claimed across all tiers.
 * resolveOffer exposes every option so a chooser can render them; this answers
 * how many the customer may actually keep.
 */
export function maxClaimableGifts(offer: Offer): number {
  return offer.claimPolicy.acrossTiers === 'SINGLE' ? 1 : Infinity;
}
