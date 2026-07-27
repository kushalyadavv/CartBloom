/**
 * Mutants for the Task 19 mutation harness.
 *
 * Each function below is a *plausible* alternate implementation of one stage
 * of entitlement resolution (`resolveOffer`) or gift-claim arbitration
 * (`validateGiftLines`) that differs from the real implementation in exactly
 * one way — the kind of bug a competent Rust developer porting this logic
 * could genuinely introduce. None of them touch production code; they are
 * built by recomposing the real, exported helper stages and substituting the
 * one stage the mutation targets.
 *
 * `resolveOffer`'s pipeline (see ../resolve.ts) is:
 *
 *   measure          = qualifyingMeasure(cart, offer)
 *   unlocked         = unlockedTiers(offer.tiers, measure)
 *   grantingTiers    = resolveAcrossTiers(unlocked, offer.claimPolicy)
 *   gifts            = grantingTiers.map(resolveWithinTier).filter(nonNull)
 *   rewards          = resolveNonGiftRewards(unlocked)
 *
 * `composeResolve` rebuilds exactly that pipeline from swappable stages, so
 * every mutant below reuses the real implementation for every stage it does
 * not target.
 *
 * `validateGiftLines` (../validateGifts.ts) has no stage seams — matchClaim,
 * claimValue and the id tie-break are private to that module, and production
 * code must not be touched to export them. Mutants 14 and 15 therefore
 * duplicate that module's arbitration loop verbatim except for the one line
 * each mutation changes. Keep those copies in sync with validateGifts.ts by
 * inspection if that file's arbitration loop ever changes shape.
 */

import { qualifyingMeasure } from '../subtotal';
import { unlockedTiers } from '../tiers';
import { resolveAcrossTiers } from '../acrossTiers';
import { resolveWithinTier } from '../withinTier';
import { resolveNonGiftRewards } from '../rewards';
import { resolveOffer } from '../resolve';
import type {
  Cart,
  CartLine,
  ClaimPolicy,
  GiftEntitlement,
  GiftPoolEntry,
  NonGiftRewards,
  Offer,
  OfferEntitlements,
  Tier,
  WithinTierPolicy,
} from '../types';
import type { GiftValidation } from '../validateGifts';

// ---------------------------------------------------------------------------
// Pipeline composer shared by mutants 1–13.
// ---------------------------------------------------------------------------

type MeasureFn = (cart: Cart, offer: Offer) => number;
type UnlockedFn = (tiers: Tier[], measure: number) => Tier[];
type AcrossFn = (unlocked: Tier[], policy: ClaimPolicy) => Tier[];
type WithinFn = (
  offerId: string,
  tier: Tier,
  policy: WithinTierPolicy
) => GiftEntitlement | null;
type RewardsFn = (unlocked: Tier[], policy: ClaimPolicy) => NonGiftRewards;

interface Stages {
  measure?: MeasureFn;
  unlocked?: UnlockedFn;
  across?: AcrossFn;
  within?: WithinFn;
  rewards?: RewardsFn;
}

function composeResolve(
  stages: Stages
): (cart: Cart, offer: Offer) => OfferEntitlements {
  const measureFn = stages.measure ?? qualifyingMeasure;
  const unlockedFn = stages.unlocked ?? unlockedTiers;
  const acrossFn = stages.across ?? resolveAcrossTiers;
  const withinFn = stages.within ?? resolveWithinTier;
  const rewardsFn =
    stages.rewards ?? ((unlocked: Tier[]) => resolveNonGiftRewards(unlocked));

  return (cart: Cart, offer: Offer): OfferEntitlements => {
    const measure = measureFn(cart, offer);
    const unlocked = unlockedFn(offer.tiers, measure);
    const grantingTiers = acrossFn(unlocked, offer.claimPolicy);

    const gifts: GiftEntitlement[] = [];
    for (const tier of grantingTiers) {
      const entitlement = withinFn(offer.id, tier, offer.claimPolicy.withinTier);
      if (entitlement !== null) gifts.push(entitlement);
    }

    return {
      offerId: offer.id,
      measure,
      unlockedTierIds: unlocked.map((t) => t.id),
      gifts,
      rewards: rewardsFn(unlocked, offer.claimPolicy),
    };
  };
}

// ---------------------------------------------------------------------------
// Mutant 1 — ignore `inScope` entirely.
// ---------------------------------------------------------------------------

function isGiftLine(line: CartLine): boolean {
  return line.giftOfferId !== undefined;
}

function measure_ignoreScope(cart: Cart, offer: Offer): number {
  let total = 0;
  for (const line of cart.lines) {
    if (isGiftLine(line)) continue;
    // BUG: no inScope check — every non-gift line counts, regardless of offer.
    total +=
      offer.trigger === 'QUANTITY' ? line.quantity : line.unitPrice * line.quantity;
  }
  return total;
}

export const mutant1_ignoreInScope = composeResolve({ measure: measure_ignoreScope });

// ---------------------------------------------------------------------------
// Mutant 2 — exclude only this offer's gift lines.
// ---------------------------------------------------------------------------

function measure_excludeOnlyOwnGift(cart: Cart, offer: Offer): number {
  let total = 0;
  for (const line of cart.lines) {
    // BUG: another offer's gift line (giftOfferId set, but !== offer.id) is
    // no longer treated as a gift, so it counts toward this offer's measure.
    if (line.giftOfferId === offer.id) continue;
    if (!line.inScope.includes(offer.id)) continue;
    total +=
      offer.trigger === 'QUANTITY' ? line.quantity : line.unitPrice * line.quantity;
  }
  return total;
}

export const mutant2_excludeOnlyOwnGift = composeResolve({
  measure: measure_excludeOnlyOwnGift,
});

// ---------------------------------------------------------------------------
// Mutant 3 — order discounts accumulate instead of taking the max.
// ---------------------------------------------------------------------------

function rewards_accumulate(unlocked: Tier[]): NonGiftRewards {
  let freeShipping = false;
  let orderPercent = 0;
  let orderFixed = 0;

  for (const tier of unlocked) {
    if (tier.reward === 'FREE_SHIPPING') {
      freeShipping = true;
    } else if (tier.reward === 'ORDER_PERCENT') {
      orderPercent += tier.value ?? 0; // BUG: sum instead of max
    } else if (tier.reward === 'ORDER_FIXED') {
      orderFixed += tier.value ?? 0; // BUG: sum instead of max
    }
  }

  return { freeShipping, orderPercent, orderFixed };
}

export const mutant3_orderDiscountsAccumulate = composeResolve({
  rewards: rewards_accumulate,
});

// ---------------------------------------------------------------------------
// Mutant 4 — order discounts suppressed whenever acrossTiers === 'SINGLE'.
// Free shipping is untouched — only the two order-discount fields are zeroed.
// ---------------------------------------------------------------------------

function rewards_suppressedUnderSingle(
  unlocked: Tier[],
  policy: ClaimPolicy
): NonGiftRewards {
  const real = resolveNonGiftRewards(unlocked);
  if (policy.acrossTiers === 'SINGLE') {
    // BUG: order rewards are independent of claim policy in the real
    // implementation; this mutant wrongly ties them to it.
    return { freeShipping: real.freeShipping, orderPercent: 0, orderFixed: 0 };
  }
  return real;
}

export const mutant4_orderDiscountsSuppressedUnderSingle = composeResolve({
  rewards: rewards_suppressedUnderSingle,
});

// ---------------------------------------------------------------------------
// Mutant 5 — order discounts never implemented at all.
// ---------------------------------------------------------------------------

function rewards_neverOrder(unlocked: Tier[]): NonGiftRewards {
  let freeShipping = false;
  for (const tier of unlocked) {
    if (tier.reward === 'FREE_SHIPPING') freeShipping = true;
  }
  return { freeShipping, orderPercent: 0, orderFixed: 0 };
}

export const mutant5_orderDiscountsAlwaysZero = composeResolve({
  rewards: rewards_neverOrder,
});

// ---------------------------------------------------------------------------
// Mutant 6 — free shipping only from the highest-threshold unlocked tier,
// rather than being granted by ANY unlocked tier that carries it.
// ---------------------------------------------------------------------------

function rewards_freeShippingHighestOnly(unlocked: Tier[]): NonGiftRewards {
  const real = resolveNonGiftRewards(unlocked);
  const highest = unlocked.length > 0 ? unlocked[unlocked.length - 1] : undefined;
  // BUG: freeShipping should be an OR across every unlocked tier, not a
  // property of only the single highest-threshold one.
  const freeShipping = highest !== undefined && highest.reward === 'FREE_SHIPPING';
  return { freeShipping, orderPercent: real.orderPercent, orderFixed: real.orderFixed };
}

export const mutant6_freeShippingHighestTierOnly = composeResolve({
  rewards: rewards_freeShippingHighestOnly,
});

// ---------------------------------------------------------------------------
// Mutant 7 — PINNED miss (absent OR unknown id) falls back to HIGHEST. The
// pre-Task-16 behaviour.
// ---------------------------------------------------------------------------

function across_pinnedFallsBackToHighest(unlocked: Tier[], policy: ClaimPolicy): Tier[] {
  const giftTiers = unlocked.filter((t) => t.reward === 'GIFT' && t.giftPool.length > 0);
  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';
  if (resolution === 'CUSTOMER_CHOICE') return giftTiers;

  if (resolution === 'PINNED') {
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    // BUG: any miss (absent id, unknown id, or a pin naming a locked tier)
    // falls back to granting the highest tier instead of failing closed.
    return pinned ? [pinned] : [giftTiers[giftTiers.length - 1]];
  }

  return [giftTiers[giftTiers.length - 1]];
}

export const mutant7_pinnedFallsBackToHighest = composeResolve({
  across: across_pinnedFallsBackToHighest,
});

// ---------------------------------------------------------------------------
// Mutant 8 — the inverse inconsistency: a missing pinnedTierId grants
// nothing (matches real behaviour), but an unknown id falls back to HIGHEST.
// ---------------------------------------------------------------------------

function across_pinnedInverseInconsistency(
  unlocked: Tier[],
  policy: ClaimPolicy
): Tier[] {
  const giftTiers = unlocked.filter((t) => t.reward === 'GIFT' && t.giftPool.length > 0);
  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';
  if (resolution === 'CUSTOMER_CHOICE') return giftTiers;

  if (resolution === 'PINNED') {
    if (policy.pinnedTierId === undefined) return []; // absent -> nothing, correct
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    // BUG: unknown id falls back to HIGHEST instead of failing closed like
    // the absent-id case does — the two miss shapes disagree.
    return pinned ? [pinned] : [giftTiers[giftTiers.length - 1]];
  }

  return [giftTiers[giftTiers.length - 1]];
}

export const mutant8_pinnedInverseInconsistency = composeResolve({
  across: across_pinnedInverseInconsistency,
});

// ---------------------------------------------------------------------------
// Mutant 9 — CUSTOMER_CHOICE returns only the highest unlocked gift tier
// instead of every unlocked gift tier.
// ---------------------------------------------------------------------------

function across_customerChoiceHighestOnly(
  unlocked: Tier[],
  policy: ClaimPolicy
): Tier[] {
  const giftTiers = unlocked.filter((t) => t.reward === 'GIFT' && t.giftPool.length > 0);
  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';
  // BUG: a chooser needs every option; this collapses to one.
  if (resolution === 'CUSTOMER_CHOICE') return [giftTiers[giftTiers.length - 1]];

  if (resolution === 'PINNED') {
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    return pinned ? [pinned] : [];
  }

  return [giftTiers[giftTiers.length - 1]];
}

export const mutant9_customerChoiceHighestOnly = composeResolve({
  across: across_customerChoiceHighestOnly,
});

// ---------------------------------------------------------------------------
// Mutant 10 — requiresChoice ignores pool size: always true under PICK_ONE,
// even when the pool has a single entry and there is nothing to choose.
// ---------------------------------------------------------------------------

function within_requiresChoiceIgnoresPoolSize(
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
    // BUG: missing the `&& tier.giftPool.length > 1` guard.
    requiresChoice: policy === 'PICK_ONE',
  };
}

export const mutant10_requiresChoiceIgnoresPoolSize = composeResolve({
  within: within_requiresChoiceIgnoresPoolSize,
});

// ---------------------------------------------------------------------------
// Mutant 11 — no tier sort: trust the config array order instead of sorting
// ascending by threshold.
// ---------------------------------------------------------------------------

function unlocked_noSort(tiers: Tier[], measure: number): Tier[] {
  // BUG: missing `.sort((a, b) => a.threshold - b.threshold)`.
  return tiers.filter((t) => measure >= t.threshold);
}

export const mutant11_noTierSort = composeResolve({ unlocked: unlocked_noSort });

// ---------------------------------------------------------------------------
// Mutant 12 — gift lines count toward the threshold (the oscillation bug).
// ---------------------------------------------------------------------------

function measure_giftLinesCount(cart: Cart, offer: Offer): number {
  let total = 0;
  for (const line of cart.lines) {
    // BUG: no isGiftLine check at all — gift lines count like any other.
    if (!line.inScope.includes(offer.id)) continue;
    total +=
      offer.trigger === 'QUANTITY' ? line.quantity : line.unitPrice * line.quantity;
  }
  return total;
}

export const mutant12_giftLinesCountTowardThreshold = composeResolve({
  measure: measure_giftLinesCount,
});

// ---------------------------------------------------------------------------
// Mutant 13 — an empty-pool GIFT tier still yields an entitlement. The empty-
// pool guard is duplicated conceptually in two places (the giftTiers filter
// in resolveAcrossTiers, and the early-return in resolveWithinTier); both
// must be skipped together, since the acrossTiers filter would otherwise
// prevent the empty-pool tier from ever reaching resolveWithinTier.
// ---------------------------------------------------------------------------

function across_noEmptyPoolGuard(unlocked: Tier[], policy: ClaimPolicy): Tier[] {
  // BUG: missing `&& t.giftPool.length > 0`.
  const giftTiers = unlocked.filter((t) => t.reward === 'GIFT');
  if (giftTiers.length === 0) return [];
  if (policy.acrossTiers === 'STACK') return giftTiers;

  const resolution = policy.singleResolution ?? 'HIGHEST';
  if (resolution === 'CUSTOMER_CHOICE') return giftTiers;

  if (resolution === 'PINNED') {
    const pinned = giftTiers.find((t) => t.id === policy.pinnedTierId);
    return pinned ? [pinned] : [];
  }

  return [giftTiers[giftTiers.length - 1]];
}

function within_noEmptyPoolGuard(
  offerId: string,
  tier: Tier,
  policy: WithinTierPolicy
): GiftEntitlement | null {
  if (tier.reward !== 'GIFT') return null;
  // BUG: missing `if (tier.giftPool.length === 0) return null;`.
  return {
    offerId,
    tierId: tier.id,
    candidates: tier.giftPool,
    requiresChoice: policy === 'PICK_ONE' && tier.giftPool.length > 1,
  };
}

export const mutant13_emptyPoolGiftYieldsEntitlement = composeResolve({
  across: across_noEmptyPoolGuard,
  within: within_noEmptyPoolGuard,
});

// ---------------------------------------------------------------------------
// Mutants 14 & 15 target validateGiftLines' arbitration loop (Task 15).
// matchClaim, claimValue and the UTF-8 id comparator are private to
// ../validateGifts.ts, so they are reproduced here verbatim (unchanged) to
// keep the surrounding arbitration loop faithful to production except for
// the one line each mutation targets.
// ---------------------------------------------------------------------------

interface Claim {
  lineId: string;
  quantity: number;
  tierId: string;
  entry: GiftPoolEntry;
  value: number;
}

const REJECTED: GiftValidation = { valid: false, discountQuantity: 0 };

/** Verbatim copy of validateGifts.ts's private matchClaim. */
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

/** Verbatim copy of validateGifts.ts's private claimValue. */
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

/** Verbatim copy of validateGifts.ts's private compareIdsByUtf8. */
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

/** Shared claim-collection step — identical to production for mutants 14/15. */
function collectClaims(cart: Cart, offer: Offer, gifts: GiftEntitlement[]): Claim[] {
  const claims: Claim[] = [];
  for (const line of cart.lines) {
    if (line.giftOfferId === undefined) continue;
    const matched = matchClaim(gifts, offer, line);
    if (matched === null) continue;
    if (line.quantity <= 0) continue;
    claims.push({
      lineId: line.id,
      quantity: line.quantity,
      tierId: matched.tierId,
      entry: matched.entry,
      value: claimValue(matched.entry, line.unitPrice),
    });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Mutant 14 — per-line maxQty: caps quantity per line rather than budgeting
// maxQty across every line claiming the same (tierId, variantId).
// ---------------------------------------------------------------------------

export function mutant14_perLineMaxQty(
  cart: Cart,
  offer: Offer
): Map<string, GiftValidation> {
  const result = new Map<string, GiftValidation>();
  const entitlements = resolveOffer(cart, offer);

  for (const line of cart.lines) {
    if (line.giftOfferId !== undefined) result.set(line.id, REJECTED);
  }

  const claims = collectClaims(cart, offer, entitlements.gifts);

  claims.sort((a, b) => {
    if (a.value !== b.value) return a.value > b.value ? -1 : 1;
    return compareIdsByUtf8(a.lineId, b.lineId);
  });

  const oneClaimPerOffer = offer.claimPolicy.acrossTiers === 'SINGLE';
  const oneClaimPerTier = offer.claimPolicy.withinTier === 'PICK_ONE';

  let offerClaimTaken = false;
  const tiersAlreadyClaimed = new Set<string>();
  // BUG: no shared unitsLeft budget map keyed by (tierId, variantId) — each
  // claim is capped only against its own line's quantity and maxQty, so N
  // lines claiming the same limited-stock entry each get their own budget.

  for (const claim of claims) {
    if (oneClaimPerOffer && offerClaimTaken) continue;
    if (oneClaimPerTier && tiersAlreadyClaimed.has(claim.tierId)) continue;

    const discountQuantity = Math.min(claim.quantity, claim.entry.maxQty);
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

// ---------------------------------------------------------------------------
// Mutant 15 — lowest-value claim wins instead of highest-value (inverted
// arbitration sort; the id tie-break is unchanged).
// ---------------------------------------------------------------------------

export function mutant15_lowestValueClaimWins(
  cart: Cart,
  offer: Offer
): Map<string, GiftValidation> {
  const result = new Map<string, GiftValidation>();
  const entitlements = resolveOffer(cart, offer);

  for (const line of cart.lines) {
    if (line.giftOfferId !== undefined) result.set(line.id, REJECTED);
  }

  const claims = collectClaims(cart, offer, entitlements.gifts);

  claims.sort((a, b) => {
    // BUG: inverted comparison — lowest value now sorts first.
    if (a.value !== b.value) return a.value < b.value ? -1 : 1;
    return compareIdsByUtf8(a.lineId, b.lineId);
  });

  const oneClaimPerOffer = offer.claimPolicy.acrossTiers === 'SINGLE';
  const oneClaimPerTier = offer.claimPolicy.withinTier === 'PICK_ONE';

  let offerClaimTaken = false;
  const tiersAlreadyClaimed = new Set<string>();
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
