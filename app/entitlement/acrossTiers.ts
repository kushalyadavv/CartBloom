import type { ClaimPolicy, Tier } from './types';

/**
 * Axis B. Reduces the unlocked tiers to those that may grant gifts.
 *
 * CUSTOMER_CHOICE returns every unlocked gift tier — the customer needs to see
 * all options. The "only one may be claimed" constraint cannot be applied
 * here, because it depends on what the cart lines actually claim; it is
 * enforced by validateGiftLines, the cart-level entry point. Nothing between
 * here and there restricts the count.
 */
export function resolveAcrossTiers(
  unlocked: Tier[],
  policy: ClaimPolicy
): Tier[] {
  const giftTiers = unlocked.filter(
    (t) => t.reward === 'GIFT' && t.giftPool.length > 0
  );

  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';

  if (resolution === 'CUSTOMER_CHOICE') return giftTiers;

  if (resolution === 'PINNED' && policy.pinnedTierId !== undefined) {
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    return pinned ? [pinned] : [];
  }

  // HIGHEST, and the fallback when PINNED names no tier.
  return [giftTiers[giftTiers.length - 1]];
}
