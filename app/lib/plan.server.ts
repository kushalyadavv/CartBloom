/**
 * What plan a shop is on.
 *
 * Read from the Admin API's `currentAppInstallation`, not the Partner API: the
 * app's own token already answers this, so there is no second credential to
 * hold and no extra scope to justify at review.
 *
 * Cached in D1 with a TTL because Task 13 left roughly 6 ms of CPU per admin
 * request, and a GraphQL round trip on every page load would spend most of it
 * re-learning something that changes a few times a year.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { AdminApiContext } from '@shopify/shopify-app-react-router/server';

import { cachePlan, getShop } from '../db.server';
import { PLAN_CAPS, type PlanName } from './offer-draft';

/**
 * How long a cached plan is trusted.
 *
 * Five minutes is a deliberate compromise. A merchant who has just upgraded
 * expects the new limits immediately, and this is the window in which they
 * might not see them — so the return from Shopify's pricing page bypasses the
 * cache entirely (see `refreshPlan`). Everything else can be five minutes stale
 * without a merchant ever noticing.
 */
const TTL_MS = 5 * 60 * 1000;

const PLAN_QUERY = `#graphql
  query CartBloomPlan {
    currentAppInstallation {
      activeSubscriptions { id name status }
    }
  }`;

/**
 * Map a Shopify subscription name onto one of our plans.
 *
 * Matched case-insensitively against the plan keys rather than by exact string,
 * because the name comes from whatever was typed in the Partner Dashboard. A
 * name we do not recognise falls back to free — the safe direction, since the
 * alternative is granting Pro limits to a subscription we cannot identify.
 */
export function planFromSubscriptionName(name: string | null | undefined): PlanName {
  if (!name) return 'free';
  const needle = name.trim().toLowerCase();

  /*
   * Containment, not prefix.
   *
   * Shopify names an App Pricing subscription after the app and the plan
   * together — "CartBloom Pro", not "Pro". A prefix match therefore failed on
   * every real subscription and silently returned 'free', which is exactly the
   * defect an App Store reviewer cited on another app as requirement 1.2.3:
   * "upgrading to Pro leaves the account on the Free tier".
   *
   * The three plan names share no substring with one another, so the order of
   * these checks cannot produce a wrong answer.
   */
  for (const plan of ['growth', 'pro', 'free'] as PlanName[]) {
    if (needle.includes(plan)) return plan;
  }
  return 'free';
}

type Admin = AdminApiContext;

export interface PlanDetails {
  plan: PlanName;
  /** Exactly what Shopify called it, for support and for diagnosing mismatches. */
  subscriptionName: string | null;
  status: string | null;
  /** How many subscriptions came back, active or not. */
  count: number;
}

/**
 * Ask Shopify directly, keeping what it said.
 *
 * The raw name matters: mapping it to a plan is a guess about Shopify's naming,
 * and when that guess is wrong the symptom is a paying merchant seeing Free.
 * Surfacing the name in Settings turns that from a mystery into a two-second
 * read.
 */
export async function fetchPlanDetails(admin: Admin): Promise<PlanDetails> {
  const response = await admin.graphql(PLAN_QUERY);
  const body = (await response.json()) as {
    data?: {
      currentAppInstallation?: {
        activeSubscriptions?: Array<{ name?: string; status?: string }> | null;
      } | null;
    };
  };

  const subscriptions = body.data?.currentAppInstallation?.activeSubscriptions ?? [];
  const active = subscriptions.find((s) => s.status === 'ACTIVE');

  return {
    plan: planFromSubscriptionName(active?.name),
    subscriptionName: active?.name ?? null,
    status: active?.status ?? subscriptions[0]?.status ?? null,
    count: subscriptions.length,
  };
}

/** Ask Shopify directly. */
export async function fetchPlan(admin: Admin): Promise<PlanName> {
  return (await fetchPlanDetails(admin)).plan;
}

/**
 * The shop's plan, from cache when it is fresh.
 *
 * Never throws: a billing hiccup should not take the admin down, and falling
 * back to the last known plan — or free — keeps a merchant working.
 */
export async function resolvePlan(
  admin: Admin,
  db: D1Database,
  shop: string
): Promise<PlanName> {
  const record = await getShop(db, shop);
  const cached = record?.plan as PlanName | null | undefined;
  const checkedAt = record?.planCheckedAt ?? 0;

  if (cached && Date.now() - checkedAt < TTL_MS) return cached;

  try {
    const plan = await fetchPlan(admin);
    await cachePlan(db, shop, plan);
    return plan;
  } catch {
    // Stale beats broken.
    return cached ?? 'free';
  }
}

/**
 * Map the `plan_handle` Shopify appends on the way back from its pricing page.
 *
 * Separate from `planFromSubscriptionName` because a handle is not a display
 * name: it is commonly prefixed, as in `cartbloom-growth`. Matched by
 * containment, and `growth` and `pro` share no substring so the order of these
 * checks cannot produce a wrong answer.
 */
export function planFromHandle(handle: string | null | undefined): PlanName | null {
  if (!handle) return null;
  const needle = handle.trim().toLowerCase();

  if (needle.includes('growth')) return 'growth';
  if (needle.includes('pro')) return 'pro';
  if (needle.includes('free')) return 'free';
  return null;
}

/** Attempts and spacing for the propagation retry below. */
const REFRESH_ATTEMPTS = 4;
const REFRESH_DELAY_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-read the plan, ignoring the cache, and wait for Shopify to catch up.
 *
 * The cache bypass alone is not enough. `activeSubscriptions` lags the approval
 * a merchant just completed, so a single immediate read returns the *old* plan,
 * caches it for the full TTL, and shows someone who has just paid their
 * previous limits. That is a read-after-write race, and it is precisely the
 * defect an App Store reviewer cited on another app as requirement 1.2.3 —
 * "upgrading to Pro leaves the account on the Free tier".
 *
 * So when the caller knows which plan to expect — the return from the pricing
 * page carries `plan_handle` — this polls briefly until Shopify agrees. Bounded
 * hard at roughly a second and a half: a slow page beats a wrong one, but not
 * indefinitely. Waiting costs wall time, not CPU, so it does not eat the
 * Workers budget.
 */
export async function refreshPlan(
  admin: Admin,
  db: D1Database,
  shop: string,
  expected?: PlanName | null
): Promise<PlanName> {
  try {
    let plan = await fetchPlan(admin);

    if (expected != null) {
      for (let attempt = 1; attempt < REFRESH_ATTEMPTS && plan !== expected; attempt += 1) {
        await sleep(REFRESH_DELAY_MS);
        plan = await fetchPlan(admin);
      }
    }

    await cachePlan(db, shop, plan);
    return plan;
  } catch {
    // Stale beats broken, and beats a blank page.
    const record = await getShop(db, shop);
    return (record?.plan as PlanName | null) ?? 'free';
  }
}
