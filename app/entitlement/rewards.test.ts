import { describe, it, expect } from 'vitest';
import { resolveNonGiftRewards } from './rewards';
import type { Tier } from './types';

const t = (id: string, reward: Tier['reward'], value?: number): Tier => ({
  id, threshold: 1000, reward, value, giftPool: [],
});

describe('resolveNonGiftRewards', () => {
  it('returns empty rewards for no unlocked tiers', () => {
    expect(resolveNonGiftRewards([])).toEqual({
      freeShipping: false, orderPercent: 0, orderFixed: 0,
    });
  });

  it('grants free shipping when any unlocked tier offers it', () => {
    const r = resolveNonGiftRewards([t('t1', 'GIFT'), t('t2', 'FREE_SHIPPING')]);
    expect(r.freeShipping).toBe(true);
  });

  it('takes the highest percent and does not accumulate', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_PERCENT', 10),
      t('t2', 'ORDER_PERCENT', 20),
    ]);
    expect(r.orderPercent).toBe(20);
  });

  it('takes the highest fixed amount and does not accumulate', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_FIXED', 500),
      t('t2', 'ORDER_FIXED', 1500),
    ]);
    expect(r.orderFixed).toBe(1500);
  });

  it('tracks percent and fixed independently', () => {
    const r = resolveNonGiftRewards([
      t('t1', 'ORDER_PERCENT', 15),
      t('t2', 'ORDER_FIXED', 1000),
    ]);
    expect(r).toEqual({ freeShipping: false, orderPercent: 15, orderFixed: 1000 });
  });

  it('ignores gift tiers entirely', () => {
    expect(resolveNonGiftRewards([t('t1', 'GIFT')])).toEqual({
      freeShipping: false, orderPercent: 0, orderFixed: 0,
    });
  });

  it('treats a missing value as zero', () => {
    expect(resolveNonGiftRewards([t('t1', 'ORDER_PERCENT')]).orderPercent).toBe(0);
  });
});
