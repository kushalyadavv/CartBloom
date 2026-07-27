import type { GiftEntitlement, Tier, WithinTierPolicy } from './types';

/**
 * Axis A. Turns one unlocked tier into a gift entitlement, or null when the
 * tier grants no gift.
 *
 * PICK_ONE with a single-entry pool sets requiresChoice false — there is
 * nothing to choose, and a chooser with one option is noise.
 */
export function resolveWithinTier(
  offerId: string,
  tier: Tier,
  policy: WithinTierPolicy
): GiftEntitlement | null {
  if (tier.reward !== 'GIFT') return null;
  if (tier.giftPool.length === 0) return null;

  return {
    offerId,
    tierId: tier.id,
    candidates: tier.giftPool,
    requiresChoice: policy === 'PICK_ONE' && tier.giftPool.length > 1,
  };
}
