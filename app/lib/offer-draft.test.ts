import { describe, expect, it } from 'vitest';

import {
  blockingIssues,
  newDraft,
  planCaps,
  sortedTiers,
  toOffer,
  validateDraft,
  type OfferDraft,
} from './offer-draft';

const draft = (over: Partial<OfferDraft> = {}): OfferDraft => ({ ...newDraft('o1', 'Spring'), ...over });

const messages = (d: OfferDraft, plan: string | null = 'free') =>
  validateDraft(d, plan).map((i) => i.message);

describe('newDraft', () => {
  it('is valid as created, so a merchant never opens the wizard onto errors', () => {
    expect(blockingIssues(validateDraft(newDraft('o1')))).toEqual([]);
  });
});

describe('plan caps', () => {
  it('falls back to free for an unknown or missing plan rather than granting the most', () => {
    expect(planCaps(null)).toEqual({ activeOffers: 1, tiersPerOffer: 3 });
    expect(planCaps('enterprise')).toEqual({ activeOffers: 1, tiersPerOffer: 3 });
    expect(planCaps('pro')).toEqual({ activeOffers: 25, tiersPerOffer: 12 });
  });

  it('blocks a fourth tier on free but allows it on growth', () => {
    const d = draft({
      tiers: [5000, 10000, 15000, 20000].map((t, i) => ({
        id: `t${i}`,
        threshold: t,
        reward: 'FREE_SHIPPING' as const,
        giftPool: [],
      })),
    });
    expect(messages(d, 'free')).toContain("4 tiers exceeds your plan's limit of 3.");
    expect(messages(d, 'growth')).not.toContain("4 tiers exceeds your plan's limit of 6.");
  });
});

describe('tiers', () => {
  it('rejects duplicate thresholds', () => {
    const d = draft({
      tiers: [
        { id: 'a', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
        { id: 'b', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
      ],
    });
    expect(messages(d)).toContain('Two tiers share the same threshold.');
  });

  it('rejects a zero or negative threshold', () => {
    const d = draft({ tiers: [{ id: 'a', threshold: 0, reward: 'FREE_SHIPPING', giftPool: [] }] });
    expect(messages(d)).toContain('Thresholds must be greater than zero.');
  });

  it('requires a percentage in range for ORDER_PERCENT', () => {
    const d = draft({ tiers: [{ id: 'a', threshold: 5000, reward: 'ORDER_PERCENT', value: 150, giftPool: [] }] });
    expect(messages(d)).toContain('Tier at 5000 needs a percentage between 1 and 100.');
  });

  it('flags a GIFT tier with an empty pool, on the gifts step that owns it', () => {
    const d = draft({ tiers: [{ id: 'a', threshold: 5000, reward: 'GIFT', giftPool: [] }] });
    const issue = validateDraft(d).find((i) => i.message.includes('no products to choose from'));
    expect(issue?.step).toBe('gifts');
    expect(issue?.blocking).toBe(true);
  });

  it('sorts tiers ascending regardless of entry order', () => {
    const d = draft({
      tiers: [
        { id: 'b', threshold: 20000, reward: 'FREE_SHIPPING', giftPool: [] },
        { id: 'a', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
      ],
    });
    expect(sortedTiers(d).map((t) => t.id)).toEqual(['a', 'b']);
    expect(toOffer(d).tiers.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('claim policy', () => {
  it('requires a resolution when only one tier may be claimed', () => {
    const d = draft({ claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'SINGLE' } });
    expect(messages(d)).toContain('Choose how the single claimable tier is decided.');
  });

  it('requires PINNED to name a tier that exists', () => {
    const d = draft({
      claimPolicy: {
        withinTier: 'PICK_ONE',
        acrossTiers: 'SINGLE',
        singleResolution: 'PINNED',
        pinnedTierId: 'does-not-exist',
      },
    });
    expect(messages(d)).toContain('Pick which tier customers can claim from.');
  });

  it('accepts PINNED when the tier is real', () => {
    // Must pin a tier from *this* draft: newDraft mints random tier ids, so an
    // id taken from a second newDraft() call would not match.
    const d = draft();
    d.claimPolicy = {
      withinTier: 'PICK_ONE',
      acrossTiers: 'SINGLE',
      singleResolution: 'PINNED',
      pinnedTierId: d.tiers[0].id,
    };
    expect(messages(d)).not.toContain('Pick which tier customers can claim from.');
  });
});

describe('scope and audience', () => {
  it('rejects a collection scope with nothing selected', () => {
    const d = draft({ scope: { kind: 'COLLECTIONS', ids: [] } });
    expect(messages(d)).toContain(
      'Pick at least one collection, or switch the scope back to the entire cart.'
    );
  });

  it("enforces Shopify's 100-element input variable cap on tags", () => {
    const d = draft({
      audience: { customerTags: Array.from({ length: 101 }, (_, i) => `t${i}`), countries: [] },
    });
    expect(messages(d)).toContain('101 customer tags — Shopify allows at most 100.');
  });

  it('warns without blocking on a future start date, which Shopify accepts silently', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const d = draft({ audience: { customerTags: [], countries: [], startsAt: future } });
    const issue = validateDraft(d).find((i) => i.message.includes('scheduled to start later'));
    expect(issue?.blocking).toBe(false);
    expect(blockingIssues(validateDraft(d))).toEqual([]);
  });

  it('rejects an end date before the start date', () => {
    const d = draft({
      audience: {
        customerTags: [],
        countries: [],
        startsAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(messages(d)).toContain('The end date is before the start date.');
  });
});

describe('placement', () => {
  it('rejects an offer turned off everywhere', () => {
    const d = draft({ placement: { drawer: false, cartPage: false } });
    expect(messages(d)).toContain('The offer is turned off everywhere, so nobody will see it.');
  });
});
