import { describe, expect, it } from 'vitest';

import { newDraft, type OfferDraft } from './offer-draft';
import { audienceSentences, claimSentence, placementSentence, tierSentences } from './plain-language';

function twoGiftTiers(): OfferDraft {
  const d = newDraft('o1', 'Gifts');
  d.tiers = [
    {
      id: 't1',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [
        { variantId: 'v1', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'v2', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'v3', discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
    {
      id: 't2',
      threshold: 15000,
      reward: 'GIFT',
      giftPool: [
        { variantId: 'v4', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'v5', discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
  ];
  return d;
}

describe('tierSentences', () => {
  it('states the spec’s worked example the way a merchant would read it', () => {
    const d = twoGiftTiers();
    expect(tierSentences(d)).toEqual([
      'Spend $100.00 — 1 of 3 gifts.',
      'Spend $150.00 — 1 of 2 gifts.',
    ]);
  });

  it('says "all" rather than "1 of" when the whole pool is granted', () => {
    const d = twoGiftTiers();
    d.claimPolicy.withinTier = 'ALL_IN_POOL';
    expect(tierSentences(d)[0]).toBe('Spend $100.00 — all 3 gifts.');
  });

  it('counts items, not money, when the trigger is quantity', () => {
    const d = twoGiftTiers();
    d.trigger = 'QUANTITY';
    d.tiers[0].threshold = 1;
    d.tiers[1].threshold = 3;
    expect(tierSentences(d)).toEqual([
      'Spend 1 item — 1 of 3 gifts.',
      'Spend 3 items — 1 of 2 gifts.',
    ]);
  });

  it('describes non-gift rewards', () => {
    const d = newDraft('o1');
    d.tiers = [
      { id: 'a', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
      { id: 'b', threshold: 8000, reward: 'ORDER_PERCENT', value: 15, giftPool: [] },
      { id: 'c', threshold: 9000, reward: 'ORDER_FIXED', value: 2000, giftPool: [] },
    ];
    expect(tierSentences(d)).toEqual([
      'Spend $50.00 — free shipping.',
      'Spend $80.00 — 15% off the order.',
      'Spend $90.00 — $20.00 off the order.',
    ]);
  });

  it('admits when a gift tier has no products yet instead of implying one', () => {
    const d = newDraft('o1');
    d.tiers = [{ id: 'a', threshold: 5000, reward: 'GIFT', giftPool: [] }];
    expect(tierSentences(d)[0]).toBe('Spend $50.00 — a gift (none chosen yet).');
  });

  it('orders sentences by threshold regardless of how tiers were entered', () => {
    const d = twoGiftTiers();
    d.tiers.reverse();
    expect(tierSentences(d)[0]).toContain('$100.00');
  });
});

describe('claimSentence', () => {
  it('says nothing when there is only one gift tier to talk about', () => {
    const d = newDraft('o1');
    d.tiers = [{ id: 'a', threshold: 5000, reward: 'GIFT', giftPool: [] }];
    expect(claimSentence(d)).toBeNull();
  });

  it('describes stacking as keeping every gift', () => {
    expect(claimSentence(twoGiftTiers())).toBe(
      'Customers keep the gift from every tier they unlock.'
    );
  });

  it('describes HIGHEST without using the word', () => {
    const d = twoGiftTiers();
    d.claimPolicy = { withinTier: 'PICK_ONE', acrossTiers: 'SINGLE', singleResolution: 'HIGHEST' };
    expect(claimSentence(d)).toBe(
      'Customers keep only one gift — the most valuable tier they have unlocked.'
    );
  });

  it('names the pinned tier by its threshold', () => {
    const d = twoGiftTiers();
    d.claimPolicy = {
      withinTier: 'PICK_ONE',
      acrossTiers: 'SINGLE',
      singleResolution: 'PINNED',
      pinnedTierId: 't2',
    };
    expect(claimSentence(d)).toBe(
      'Customers keep only one gift, always from the $150.00 tier.'
    );
  });

  it('flags a pinned policy whose tier was deleted', () => {
    const d = twoGiftTiers();
    d.claimPolicy = {
      withinTier: 'PICK_ONE',
      acrossTiers: 'SINGLE',
      singleResolution: 'PINNED',
      pinnedTierId: 'deleted',
    };
    expect(claimSentence(d)).toContain('a tier you have not chosen yet');
  });

  it('flags SINGLE with no resolution chosen', () => {
    const d = twoGiftTiers();
    d.claimPolicy = { withinTier: 'PICK_ONE', acrossTiers: 'SINGLE' };
    expect(claimSentence(d)).toContain('you have not chosen how that tier is decided');
  });
});

describe('audienceSentences', () => {
  it('is silent when the offer applies to everyone', () => {
    expect(audienceSentences(newDraft('o1'))).toEqual([]);
  });

  it('describes scope, tags and markets', () => {
    const d = newDraft('o1');
    d.scope = { kind: 'COLLECTIONS', ids: ['a', 'b'] };
    d.audience.customerTags = ['vip'];
    d.audience.countries = ['CA'];

    expect(audienceSentences(d)).toEqual([
      'Only items from 2 collections count toward the total.',
      'Only customers tagged vip see this offer.',
      'Only customers in CA see this offer.',
    ]);
  });

  it('warns that a future start means the offer is not running', () => {
    const d = newDraft('o1');
    d.audience.startsAt = new Date(Date.now() + 86_400_000).toISOString();
    expect(audienceSentences(d)[0]).toContain('will not run until then');
  });
});

describe('placementSentence', () => {
  it('names where the offer appears', () => {
    const d = newDraft('o1');
    expect(placementSentence(d)).toBe('Shown in the cart drawer and on the cart page.');

    d.placement = { drawer: false, cartPage: true };
    expect(placementSentence(d)).toBe('Shown on the cart page only.');

    d.placement = { drawer: false, cartPage: false };
    expect(placementSentence(d)).toBe('Not shown anywhere — turn on at least one placement.');
  });
});
