import { describe, expect, it } from 'vitest';

import { planFromSubscriptionName } from './plan.server';

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
