import { describe, expect, it, vi } from 'vitest';

import { planFromHandle, planFromSubscriptionName, refreshPlan } from './plan.server';

describe('planFromSubscriptionName', () => {
  it('matches the plan names we define', () => {
    expect(planFromSubscriptionName('Growth')).toBe('growth');
    expect(planFromSubscriptionName('Pro')).toBe('pro');
    expect(planFromSubscriptionName('Free')).toBe('free');
  });

  it('ignores case and surrounding space, since the name is typed by hand', () => {
    expect(planFromSubscriptionName('  GROWTH  ')).toBe('growth');
    expect(planFromSubscriptionName('pro')).toBe('pro');
  });

  it('tolerates a suffix, so renaming to "Pro (annual)" does not demote anyone', () => {
    expect(planFromSubscriptionName('Pro annual')).toBe('pro');
    expect(planFromSubscriptionName('Growth monthly')).toBe('growth');
  });

  it('falls back to free for a name it cannot place', () => {
    // The safe direction: the alternative is granting Pro limits to a
    // subscription we cannot identify.
    expect(planFromSubscriptionName('Enterprise')).toBe('free');
    expect(planFromSubscriptionName('')).toBe('free');
    expect(planFromSubscriptionName(null)).toBe('free');
    expect(planFromSubscriptionName(undefined)).toBe('free');
  });
});

describe('planFromHandle', () => {
  it('reads a bare handle', () => {
    expect(planFromHandle('growth')).toBe('growth');
    expect(planFromHandle('pro')).toBe('pro');
    expect(planFromHandle('free')).toBe('free');
  });

  it('reads a prefixed handle, which is the common shape', () => {
    expect(planFromHandle('cartbloom-growth')).toBe('growth');
    expect(planFromHandle('cartbloom-pro-monthly')).toBe('pro');
  });

  it('returns null when it cannot tell, so the caller does not wait for a guess', () => {
    expect(planFromHandle('enterprise')).toBeNull();
    expect(planFromHandle('')).toBeNull();
    expect(planFromHandle(null)).toBeNull();
    expect(planFromHandle(undefined)).toBeNull();
  });
});

describe('refreshPlan waits for Shopify to propagate', () => {
  // The defect this guards is the one a reviewer cited on another app as
  // requirement 1.2.3: a merchant upgrades, the app reads the old plan because
  // activeSubscriptions lags the approval, and they are left on their previous
  // tier — with the wrong answer then cached for the full TTL.
  // Enough D1 surface for cachePlan and the getShop fallback. The plan value
  // itself is asserted from the return, not from what was written.
  const db = {
    prepare: () => ({
      bind: () => ({
        run: async () => ({ meta: { changes: 1 } }),
        first: async () => null,
        all: async () => ({ results: [] }),
      }),
    }),
  } as never;

  function adminReturning(sequence: Array<string | null>) {
    let call = 0;
    return {
      graphql: vi.fn(async () => {
        const name = sequence[Math.min(call, sequence.length - 1)];
        call += 1;
        return {
          json: async () => ({
            data: {
              currentAppInstallation: {
                activeSubscriptions: name === null ? [] : [{ name, status: 'ACTIVE' }],
              },
            },
          }),
        };
      }),
    } as never;
  }

  it('retries until the plan matches what the merchant just bought', async () => {
    // Shopify reports the old plan twice before catching up.
    const admin = adminReturning([null, null, 'Growth']);

    const plan = await refreshPlan(admin, db, 'test.myshopify.com', 'growth');

    expect(plan).toBe('growth');
  });

  it('gives up rather than polling forever when the plan never arrives', async () => {
    const admin = adminReturning([null]);

    const plan = await refreshPlan(admin, db, 'test.myshopify.com', 'growth');

    // Reports what Shopify actually says instead of the hoped-for answer.
    expect(plan).toBe('free');
  });

  it('does not wait at all when there is nothing to wait for', async () => {
    const admin = adminReturning(['Pro']);

    const plan = await refreshPlan(admin, db, 'test.myshopify.com');

    expect(plan).toBe('pro');
  });

  it('returns immediately once the expected plan is already visible', async () => {
    const admin = adminReturning(['Growth']);
    const started = Date.now();

    const plan = await refreshPlan(admin, db, 'test.myshopify.com', 'growth');

    expect(plan).toBe('growth');
    // No sleep on the happy path — a merchant who upgraded cleanly should not
    // be made to wait for a retry loop that has nothing to do.
    expect(Date.now() - started).toBeLessThan(400);
  });
});
