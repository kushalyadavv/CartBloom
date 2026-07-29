/**
 * The offer as a merchant edits it.
 *
 * This is the verbose form. It is deliberately not what either production
 * consumer reads: publishing compiles it into a compact config for the discount
 * function (10,000-byte metafield cap, where an oversized value is delivered as
 * a silent null) and a fuller payload for the storefront widget. Keeping the
 * editable shape separate means readability here costs nothing at runtime.
 *
 * `Offer`, `Tier`, and `ClaimPolicy` come from the entitlement core rather than
 * being redefined, so the wizard cannot drift from the semantics the function
 * and widget actually implement.
 */

import type {
  ClaimPolicy,
  Offer,
  Tier,
  TriggerMetric,
} from '../entitlement/types';

export type OfferStatus = 'DRAFT' | 'PUBLISHED' | 'PAUSED';

export type Layout = 'BAR' | 'MILESTONE';

export type ScopeKind = 'ALL' | 'COLLECTIONS' | 'PRODUCTS';

export interface OfferScope {
  kind: ScopeKind;
  /** Collection or product GIDs, depending on `kind`. Empty when kind is ALL. */
  ids: string[];
}

export interface OfferAudience {
  /**
   * Free text, not a picker. Shopify offers no API to enumerate a shop's
   * customer tags, and CartBloom requests no customer scopes — the function
   * evaluates these through `hasTags`, which returns booleans and never yields
   * a customer record. That is what keeps the app out of Protected Customer
   * Data entirely.
   */
  customerTags: string[];
  /** ISO 3166-1 alpha-2. Empty means every market. */
  countries: string[];
  /** ISO 8601. Absent means "active now". */
  startsAt?: string;
  endsAt?: string;
}

export interface OfferDesign {
  layout: Layout;
  preset: string;
  tokens: Record<string, string>;
}

export interface OfferCopy {
  progress?: string;
  unlocked?: string;
  locked?: string;
}

export interface OfferPlacement {
  drawer: boolean;
  cartPage: boolean;
}

/**
 * Title, image and price for a gift variant.
 *
 * The picker already knows these when a merchant chooses a product, so they are
 * kept here to make the preview show real products rather than raw GIDs.
 * Publishing re-resolves them from the Admin API (Task 43) rather than trusting
 * this copy, which can go stale if a product is renamed after being picked.
 */
export interface GiftDisplay {
  variantId: string;
  title?: string;
  image?: string;
  price?: number;
}

export interface OfferDraft {
  id: string;
  name: string;
  status: OfferStatus;
  trigger: TriggerMetric;
  scope: OfferScope;
  audience: OfferAudience;
  claimPolicy: ClaimPolicy;
  tiers: Tier[];
  design: OfferDesign;
  copy: OfferCopy;
  placement: OfferPlacement;
  giftDisplays: GiftDisplay[];
}

// ------------------------------------------------------------------ plans ---

export type PlanName = 'free' | 'growth' | 'pro';

export interface PlanCaps {
  activeOffers: number;
  tiersPerOffer: number;
}

/** Spec §10. Enforced at publish, not at read — see `canPublish`. */
export const PLAN_CAPS: Record<PlanName, PlanCaps> = {
  free: { activeOffers: 1, tiersPerOffer: 3 },
  growth: { activeOffers: 5, tiersPerOffer: 6 },
  pro: { activeOffers: 25, tiersPerOffer: 12 },
};

export function planCaps(plan: string | null | undefined): PlanCaps {
  return PLAN_CAPS[(plan ?? 'free') as PlanName] ?? PLAN_CAPS.free;
}

// --------------------------------------------------------------- defaults ---

export function newTier(threshold: number): Tier {
  return { id: crypto.randomUUID().slice(0, 8), threshold, reward: 'GIFT', giftPool: [] };
}

export function newDraft(id: string, name = 'Untitled offer'): OfferDraft {
  return {
    id,
    name,
    status: 'DRAFT',
    trigger: 'SUBTOTAL',
    scope: { kind: 'ALL', ids: [] },
    audience: { customerTags: [], countries: [] },
    // STACK/PICK_ONE is the combination merchants expect by default: every tier
    // you reach gives you something, and each one is a choice rather than the
    // whole pool.
    claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
    tiers: [{ ...newTier(5000), reward: 'FREE_SHIPPING' }],
    // Milestones by default: the marker rail reads as a ladder of rewards,
    // where a plain bar reads as one goal with decorations on it.
    design: { layout: 'MILESTONE', preset: 'candy', tokens: {} },
    copy: {},
    placement: { drawer: true, cartPage: true },
    giftDisplays: [],
  };
}

// ------------------------------------------------------------- validation ---

export type WizardStep = 'trigger' | 'tiers' | 'gifts' | 'design' | 'placement' | 'review';

export const STEPS: readonly WizardStep[] = [
  'trigger',
  'tiers',
  'gifts',
  'design',
  'placement',
  'review',
] as const;

export interface Issue {
  step: WizardStep;
  message: string;
  /** True when this blocks publishing; false when it is only a warning. */
  blocking: boolean;
}

/**
 * Everything wrong with a draft, in one pass.
 *
 * Returned as a list rather than thrown so the wizard can show problems on the
 * steps that own them while still letting a merchant move around freely. A
 * draft is allowed to be invalid; publishing one is not.
 */
export function validateDraft(draft: OfferDraft, plan: string | null = 'free'): Issue[] {
  const issues: Issue[] = [];
  const caps = planCaps(plan);

  if (draft.name.trim() === '') {
    issues.push({ step: 'trigger', message: 'Give the offer a name.', blocking: true });
  }

  if (draft.scope.kind !== 'ALL' && draft.scope.ids.length === 0) {
    issues.push({
      step: 'trigger',
      message:
        draft.scope.kind === 'COLLECTIONS'
          ? 'Pick at least one collection, or switch the scope back to the entire cart.'
          : 'Pick at least one product, or switch the scope back to the entire cart.',
      blocking: true,
    });
  }

  // Shopify rejects the input-variable metafield past 100 elements per list.
  if (draft.audience.customerTags.length > 100) {
    issues.push({
      step: 'trigger',
      message: `${draft.audience.customerTags.length} customer tags — Shopify allows at most 100.`,
      blocking: true,
    });
  }
  if (draft.scope.kind === 'COLLECTIONS' && draft.scope.ids.length > 100) {
    issues.push({
      step: 'trigger',
      message: `${draft.scope.ids.length} collections — Shopify allows at most 100.`,
      blocking: true,
    });
  }

  if (draft.audience.startsAt && draft.audience.endsAt) {
    if (Date.parse(draft.audience.endsAt) <= Date.parse(draft.audience.startsAt)) {
      issues.push({
        step: 'trigger',
        message: 'The end date is before the start date.',
        blocking: true,
      });
    }
  }

  // Task 25 found that discountAutomaticAppCreate accepts a future startsAt,
  // reports SCHEDULED, and then silently does nothing until that date. A
  // merchant who sets this by accident sees an offer that simply never works.
  if (draft.audience.startsAt && Date.parse(draft.audience.startsAt) > Date.now()) {
    issues.push({
      step: 'trigger',
      message:
        'This offer is scheduled to start later, so it will not run — and Shopify reports no error while it waits.',
      blocking: false,
    });
  }

  // ---- tiers

  if (draft.tiers.length === 0) {
    issues.push({ step: 'tiers', message: 'Add at least one tier.', blocking: true });
  }

  if (draft.tiers.length > caps.tiersPerOffer) {
    issues.push({
      step: 'tiers',
      message: `${draft.tiers.length} tiers exceeds your plan's limit of ${caps.tiersPerOffer}.`,
      blocking: true,
    });
  }

  const thresholds = draft.tiers.map((t) => t.threshold);
  if (new Set(thresholds).size !== thresholds.length) {
    issues.push({
      step: 'tiers',
      message: 'Two tiers share the same threshold.',
      blocking: true,
    });
  }
  if (thresholds.some((t) => t <= 0)) {
    issues.push({
      step: 'tiers',
      message: 'Thresholds must be greater than zero.',
      blocking: true,
    });
  }

  for (const tier of draft.tiers) {
    if (tier.reward === 'ORDER_PERCENT' && (tier.value === undefined || tier.value <= 0 || tier.value > 100)) {
      issues.push({
        step: 'tiers',
        message: `Tier at ${tier.threshold} needs a percentage between 1 and 100.`,
        blocking: true,
      });
    }
    if (tier.reward === 'ORDER_FIXED' && (tier.value === undefined || tier.value <= 0)) {
      issues.push({
        step: 'tiers',
        message: `Tier at ${tier.threshold} needs an amount greater than zero.`,
        blocking: true,
      });
    }
    if (tier.reward === 'GIFT' && tier.giftPool.length === 0) {
      issues.push({
        step: 'gifts',
        message: `The tier at ${tier.threshold} offers a gift but has no products to choose from.`,
        blocking: true,
      });
    }
    for (const entry of tier.giftPool) {
      if (entry.discountType === 'PERCENT' && (entry.value <= 0 || entry.value > 100)) {
        issues.push({
          step: 'gifts',
          message: 'A gift discount percentage must be between 1 and 100.',
          blocking: true,
        });
      }
      if (entry.maxQty <= 0) {
        issues.push({
          step: 'gifts',
          message: 'A gift quantity must be at least 1.',
          blocking: true,
        });
      }
    }
  }

  // ---- claim policy

  if (draft.claimPolicy.acrossTiers === 'SINGLE') {
    if (draft.claimPolicy.singleResolution === undefined) {
      issues.push({
        step: 'gifts',
        message: 'Choose how the single claimable tier is decided.',
        blocking: true,
      });
    }
    if (draft.claimPolicy.singleResolution === 'PINNED') {
      const pinned = draft.claimPolicy.pinnedTierId;
      if (!pinned || !draft.tiers.some((t) => t.id === pinned)) {
        issues.push({
          step: 'gifts',
          message: 'Pick which tier customers can claim from.',
          blocking: true,
        });
      }
    }
  }

  // ---- placement

  if (!draft.placement.drawer && !draft.placement.cartPage) {
    issues.push({
      step: 'placement',
      message: 'The offer is turned off everywhere, so nobody will see it.',
      blocking: true,
    });
  }

  return issues;
}

export function blockingIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.blocking);
}

/** Tiers sorted ascending — the order the entitlement core requires. */
export function sortedTiers(draft: OfferDraft): Tier[] {
  return [...draft.tiers].sort((a, b) => a.threshold - b.threshold);
}

/** The draft as the entitlement core sees it, for the live preview. */
export function toOffer(draft: OfferDraft): Offer {
  return {
    id: draft.id,
    trigger: draft.trigger,
    claimPolicy: draft.claimPolicy,
    tiers: sortedTiers(draft),
  };
}
