/**
 * Shared entitlement types.
 *
 * This module and everything else in app/entitlement/ must remain free of
 * imports — no Shopify SDK, no DOM, no Node built-ins. The core ships to the
 * storefront widget and generates the golden vectors; a JavaScript core was
 * measured against Shopify's instruction budget and rejected, so the discount
 * function is a separate Rust implementation held to the same vectors. Keeping
 * this code dependency-free is what makes it portable and cheap to translate.
 *
 * All money is integer minor units (cents). Percentages are integers 0-100.
 */

export type TriggerMetric = 'SUBTOTAL' | 'QUANTITY';

export type RewardKind =
  | 'FREE_SHIPPING'
  | 'ORDER_PERCENT'
  | 'ORDER_FIXED'
  | 'GIFT';

export type GiftDiscountType = 'FREE' | 'PERCENT' | 'FIXED';

export type WithinTierPolicy = 'ALL_IN_POOL' | 'PICK_ONE';

export type AcrossTierPolicy = 'STACK' | 'SINGLE';

export type SingleTierResolution = 'HIGHEST' | 'PINNED' | 'CUSTOMER_CHOICE';

export interface GiftPoolEntry {
  variantId: string;
  discountType: GiftDiscountType;
  /** Percent 0-100 when PERCENT; minor units when FIXED; ignored when FREE. */
  value: number;
  maxQty: number;
}

export interface Tier {
  id: string;
  /** Minor units when trigger is SUBTOTAL; item count when QUANTITY. */
  threshold: number;
  reward: RewardKind;
  /** Percent 0-100 for ORDER_PERCENT; minor units for ORDER_FIXED. */
  value?: number;
  giftPool: GiftPoolEntry[];
}

export interface ClaimPolicy {
  withinTier: WithinTierPolicy;
  acrossTiers: AcrossTierPolicy;
  /** Required when acrossTiers is SINGLE. */
  singleResolution?: SingleTierResolution;
  /** Required when singleResolution is PINNED. */
  pinnedTierId?: string;
}

export interface Offer {
  id: string;
  trigger: TriggerMetric;
  claimPolicy: ClaimPolicy;
  /** Must be sorted ascending by threshold. Callers guarantee this. */
  tiers: Tier[];
}

/**
 * A cart line already normalised by its host.
 *
 * `inScope` is resolved by the caller, not by this module — the discount
 * function can query collection membership live, the widget cannot. See the
 * scope-agnostic qualifier in the design spec.
 */
export interface CartLine {
  id: string;
  quantity: number;
  /** Undiscounted unit price in minor units. */
  unitPrice: number;
  variantId: string;
  /** Offer ids for which this line counts toward the threshold. */
  inScope: string[];
  /** Set from the _cartbloom_offer line attribute. Never trusted for entitlement. */
  giftOfferId?: string;
  /** Set from the _cartbloom_tier line attribute. Never trusted for entitlement. */
  giftTierId?: string;
}

export interface Cart {
  lines: CartLine[];
}

/** A customer's selection, when the policy requires one. */
export interface GiftSelection {
  offerId: string;
  tierId: string;
  variantId: string;
}

/** A right to a gift. Not a cart line — the customer may not have claimed it. */
export interface GiftEntitlement {
  offerId: string;
  tierId: string;
  /** Products the customer may claim. Length > 1 means a chooser is required. */
  candidates: GiftPoolEntry[];
  /** True when the customer must pick; false when all candidates are granted. */
  requiresChoice: boolean;
}

export interface NonGiftRewards {
  freeShipping: boolean;
  /** Highest single percent among unlocked tiers, or 0. */
  orderPercent: number;
  /** Highest single fixed amount in minor units among unlocked tiers, or 0. */
  orderFixed: number;
}

export interface OfferEntitlements {
  offerId: string;
  /** Measure that was compared against thresholds. */
  measure: number;
  unlockedTierIds: string[];
  gifts: GiftEntitlement[];
  rewards: NonGiftRewards;
}
