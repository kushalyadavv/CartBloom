import type { NonGiftRewards, Tier } from './types';

/**
 * Non-gift rewards from the unlocked tiers.
 *
 * Deliberately independent of the claim policy: a merchant restricting gifts
 * to one tier has not thereby restricted their free shipping. Order discounts
 * take the highest single value per type rather than summing — a 10% tier and
 * a 20% tier both unlocked yields 20%, not 30%.
 */
export function resolveNonGiftRewards(unlocked: Tier[]): NonGiftRewards {
  let freeShipping = false;
  let orderPercent = 0;
  let orderFixed = 0;

  for (const tier of unlocked) {
    if (tier.reward === 'FREE_SHIPPING') {
      freeShipping = true;
    } else if (tier.reward === 'ORDER_PERCENT') {
      orderPercent = Math.max(orderPercent, tier.value ?? 0);
    } else if (tier.reward === 'ORDER_FIXED') {
      orderFixed = Math.max(orderFixed, tier.value ?? 0);
    }
  }

  return { freeShipping, orderPercent, orderFixed };
}
