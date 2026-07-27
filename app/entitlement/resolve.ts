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
 *
 * This is the storefront widget's implementation, and the source the golden
 * vectors are generated from. The discount function is a separate Rust
 * implementation that must satisfy the same vectors; the vectors, not shared
 * code, are what keep the bar and checkout in agreement.
 *
 * It answers what the customer is *entitled to*, not what they may keep: under
 * PICK_ONE and SINGLE:CUSTOMER_CHOICE the gifts array deliberately lists every
 * option so a chooser can render them. validateGiftLines is what decides which
 * claims are actually honoured.
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
