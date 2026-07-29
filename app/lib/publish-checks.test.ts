import { describe, expect, it } from 'vitest';

import { compile } from './compile';
import { newDraft, type OfferDraft } from './offer-draft';
import { checkPublish, type PublishContext } from './publish-checks';

function draftWithGifts(id = 'o1', gifts = 2): OfferDraft {
  const d = newDraft(id, 'Spring');
  d.tiers = [
    {
      id: 't1',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: Array.from({ length: gifts }, (_, i) => ({
        variantId: `gid://shopify/ProductVariant/${i + 1}`,
        discountType: 'FREE' as const,
        value: 0,
        maxQty: 1,
      })),
    },
  ];
  d.giftDisplays = d.tiers[0].giftPool.map((g, i) => ({
    variantId: g.variantId,
    title: `Gift ${i + 1}`,
  }));
  return d;
}

function ctx(drafts: OfferDraft[], over: Partial<PublishContext> = {}): PublishContext {
  return {
    activeDrafts: drafts,
    plan: 'free',
    compiled: compile(drafts),
    ...over,
  };
}

describe('checkPublish', () => {
  it('passes a well-formed offer', () => {
    const d = draftWithGifts();
    const result = checkPublish(d, ctx([d]));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('blocks on the wizard’s own blocking issues', () => {
    const d = draftWithGifts();
    d.tiers[0].giftPool = [];
    expect(checkPublish(d, ctx([d])).ok).toBe(false);
  });

  it('blocks when publishing would exceed the plan’s active offers', () => {
    const a = draftWithGifts('a');
    const b = draftWithGifts('b');
    const result = checkPublish(b, ctx([a, b], { plan: 'free' }));

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('your plan allows 1');
  });

  it('allows the same two offers on a plan that permits them', () => {
    const a = draftWithGifts('a');
    const b = draftWithGifts('b');
    expect(checkPublish(b, ctx([a, b], { plan: 'growth' })).ok).toBe(true);
  });

  it('blocks past 100 customer tags, the cap Shopify enforces on input variables', () => {
    const d = draftWithGifts();
    d.audience.customerTags = Array.from({ length: 101 }, (_, i) => `tag-${i}`);
    const result = checkPublish(d, ctx([d]));

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('101 customer tags');
  });

  it('blocks an oversized config, naming what to cut', () => {
    // An oversized metafield arrives at the function as a silent null, so this
    // has to be caught here or the offer just stops working with no error.
    const d = newDraft('big', 'Big');
    d.tiers = Array.from({ length: 12 }, (_, t) => ({
      id: `t${t}`,
      threshold: (t + 1) * 1000,
      reward: 'GIFT' as const,
      giftPool: Array.from({ length: 60 }, (_, g) => ({
        variantId: `gid://shopify/ProductVariant/${t}-${g}-padding-padding-padding`,
        discountType: 'PERCENT' as const,
        value: 25,
        maxQty: 3,
      })),
    }));

    const result = checkPublish(d, ctx([d], { plan: 'pro' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('over Shopify');
  });

  it('warns rather than blocks on an out-of-stock gift, because stock comes back', () => {
    const d = draftWithGifts();
    const result = checkPublish(
      d,
      ctx([d], {
        unbuyableVariants: new Map([['gid://shopify/ProductVariant/1', 'is out of stock']]),
      })
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('Gift 1');
    expect(result.warnings.join(' ')).toContain('out of stock');
  });

  it('warns about an unpublished gift product by name', () => {
    const d = draftWithGifts();
    const result = checkPublish(
      d,
      ctx([d], {
        unbuyableVariants: new Map([
          ['gid://shopify/ProductVariant/2', 'is not published to your storefront'],
        ]),
      })
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('Gift 2');
  });

  it('passes a future start date through as a warning, since Shopify reports no error', () => {
    const d = draftWithGifts();
    d.audience.startsAt = new Date(Date.now() + 86_400_000).toISOString();
    const result = checkPublish(d, ctx([d]));

    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('scheduled to start later');
  });
});
