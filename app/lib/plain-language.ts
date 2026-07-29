/**
 * The offer, stated back to the merchant in a sentence.
 *
 * The claim policy is two independent axes — what you may take *within* a tier
 * and what you may keep *across* tiers — and §6 of the spec is the hardest part
 * of the product to explain. Merchants misconfigure it confidently, which is
 * the dangerous kind: the wizard looks finished and the storefront gives away
 * more, or less, than intended.
 *
 * So the Review step does not show the field values back. It describes the
 * consequence, because "customers keep every gift they unlock" and "customers
 * keep only one" are distinguishable at a glance in a way that STACK and SINGLE
 * are not.
 */

import { formatMoney } from '../../widget/src/render';

import { sortedTiers, type OfferDraft } from './offer-draft';

function measure(draft: OfferDraft, value: number, moneyFormat?: string): string {
  return draft.trigger === 'QUANTITY'
    ? `${value} ${value === 1 ? 'item' : 'items'}`
    : formatMoney(value, moneyFormat);
}

function rewardPhrase(
  draft: OfferDraft,
  tier: OfferDraft['tiers'][number],
  moneyFormat?: string
): string {
  switch (tier.reward) {
    case 'FREE_SHIPPING':
      return 'free shipping';
    case 'ORDER_PERCENT':
      return `${tier.value ?? 0}% off the order`;
    case 'ORDER_FIXED':
      return `${formatMoney(tier.value ?? 0, moneyFormat)} off the order`;
    case 'GIFT': {
      const n = tier.giftPool.length;
      if (n === 0) return 'a gift (none chosen yet)';
      if (draft.claimPolicy.withinTier === 'ALL_IN_POOL') {
        return n === 1 ? 'a free gift' : `all ${n} gifts`;
      }
      return n === 1 ? 'a free gift' : `1 of ${n} gifts`;
    }
  }
}

/** One sentence per tier: what a customer must spend, and what they get. */
export function tierSentences(draft: OfferDraft, moneyFormat?: string): string[] {
  return sortedTiers(draft).map((tier) => {
    const at = measure(draft, tier.threshold, moneyFormat);
    return `Spend ${at} — ${rewardPhrase(draft, tier, moneyFormat)}.`;
  });
}

/**
 * How the tiers combine.
 *
 * Only meaningful past one gift tier: with a single one there is nothing to
 * stack or choose between, and saying so anyway invites a merchant to change a
 * setting that does not apply to them.
 */
export function claimSentence(draft: OfferDraft): string | null {
  const giftTiers = sortedTiers(draft).filter((t) => t.reward === 'GIFT');
  if (giftTiers.length < 2) return null;

  if (draft.claimPolicy.acrossTiers === 'STACK') {
    return 'Customers keep the gift from every tier they unlock.';
  }

  switch (draft.claimPolicy.singleResolution) {
    case 'HIGHEST':
      return 'Customers keep only one gift — the most valuable tier they have unlocked.';
    case 'PINNED': {
      const pinned = giftTiers.find((t) => t.id === draft.claimPolicy.pinnedTierId);
      return pinned === undefined
        ? 'Customers keep only one gift, from a tier you have not chosen yet.'
        : `Customers keep only one gift, always from the ${formatMoney(pinned.threshold)} tier.`;
    }
    case 'CUSTOMER_CHOICE':
      return 'Customers keep only one gift, and choose which unlocked tier it comes from.';
    default:
      return 'Customers keep only one gift — but you have not chosen how that tier is decided.';
  }
}

/** Who the offer applies to, when it is narrowed. */
export function audienceSentences(draft: OfferDraft): string[] {
  const out: string[] = [];

  if (draft.scope.kind === 'COLLECTIONS') {
    const n = draft.scope.ids.length;
    out.push(`Only items from ${n} ${n === 1 ? 'collection' : 'collections'} count toward the total.`);
  } else if (draft.scope.kind === 'PRODUCTS') {
    const n = draft.scope.ids.length;
    out.push(`Only ${n} specific ${n === 1 ? 'product' : 'products'} count toward the total.`);
  }

  if (draft.audience.customerTags.length > 0) {
    out.push(`Only customers tagged ${draft.audience.customerTags.join(' or ')} see this offer.`);
  }

  if (draft.audience.countries.length > 0) {
    out.push(`Only customers in ${draft.audience.countries.join(', ')} see this offer.`);
  }

  if (draft.audience.startsAt) {
    const starts = new Date(draft.audience.startsAt);
    out.push(
      starts.getTime() > Date.now()
        ? `Scheduled to start ${starts.toLocaleDateString()} — it will not run until then.`
        : `Running since ${starts.toLocaleDateString()}.`
    );
  }
  if (draft.audience.endsAt) {
    out.push(`Ends ${new Date(draft.audience.endsAt).toLocaleDateString()}.`);
  }

  return out;
}

/** Where a shopper will see it. */
export function placementSentence(draft: OfferDraft): string {
  const { drawer, cartPage } = draft.placement;
  if (drawer && cartPage) return 'Shown in the cart drawer and on the cart page.';
  if (drawer) return 'Shown in the cart drawer only.';
  if (cartPage) return 'Shown on the cart page only.';
  return 'Not shown anywhere — turn on at least one placement.';
}
