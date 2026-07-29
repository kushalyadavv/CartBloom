import { describe, expect, it } from 'vitest';

import {
  compile,
  compileInputVariables,
  compileWidgetConfig,
  toFunctionOffer,
  versionHash,
} from './compile';
import { newDraft, type OfferDraft } from './offer-draft';

function giftDraft(id = 'o1'): OfferDraft {
  const d = newDraft(id, 'Spring');
  d.tiers = [
    { id: 't1', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
    {
      id: 't2',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [{ variantId: 'gid://shopify/ProductVariant/1', discountType: 'FREE', value: 0, maxQty: 1 }],
    },
  ];
  d.giftDisplays = [
    { variantId: 'gid://shopify/ProductVariant/1', title: 'Tote' },
    { variantId: 'gid://shopify/ProductVariant/99', title: 'Removed earlier' },
  ];
  return d;
}

describe('toFunctionOffer', () => {
  it("maps the wizard's ALL scope onto the wire format's ENTIRE_CART", () => {
    expect(toFunctionOffer(newDraft('o1')).scope.kind).toBe('ENTIRE_CART');
  });

  it('carries collections through unchanged', () => {
    const d = newDraft('o1');
    d.scope = { kind: 'COLLECTIONS', ids: ['gid://shopify/Collection/1'] };
    expect(toFunctionOffer(d).scope).toEqual({
      kind: 'COLLECTIONS',
      ids: ['gid://shopify/Collection/1'],
    });
  });

  it('renames countries to markets, which is what the function reads', () => {
    const d = newDraft('o1');
    d.audience.countries = ['CA', 'US'];
    expect(toFunctionOffer(d).audience.markets).toEqual(['CA', 'US']);
  });

  it('sorts tiers ascending, which the entitlement core requires of callers', () => {
    const d = newDraft('o1');
    d.tiers = [
      { id: 'b', threshold: 20000, reward: 'FREE_SHIPPING', giftPool: [] },
      { id: 'a', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
    ];
    expect(toFunctionOffer(d).tiers.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('compileInputVariables', () => {
  it('deduplicates tags across offers, since the cap is per list not per offer', () => {
    const a = newDraft('a');
    a.audience.customerTags = ['vip', 'wholesale'];
    const b = newDraft('b');
    b.audience.customerTags = ['vip'];

    expect(compileInputVariables([a, b]).tags).toEqual(['vip', 'wholesale']);
  });

  it('collects collection ids only from offers actually scoped to collections', () => {
    const a = newDraft('a');
    a.scope = { kind: 'COLLECTIONS', ids: ['c1'] };
    const b = newDraft('b');
    b.scope = { kind: 'PRODUCTS', ids: ['p1'] };

    expect(compileInputVariables([a, b]).collectionIds).toEqual(['c1']);
  });

  it('sorts, so an unchanged configuration produces an unchanged payload', () => {
    const a = newDraft('a');
    a.audience.customerTags = ['zeta', 'alpha'];
    expect(compileInputVariables([a]).tags).toEqual(['alpha', 'zeta']);
  });
});

describe('compileWidgetConfig', () => {
  it('ships only the gift displays the offer still references', () => {
    const config = compileWidgetConfig([giftDraft()]);
    expect(config.offers[0].giftDisplays.map((d) => d.variantId)).toEqual([
      'gid://shopify/ProductVariant/1',
    ]);
  });

  it('carries design, copy and placement, which the function never sees', () => {
    const d = giftDraft();
    d.design.preset = 'forest';
    d.placement = { drawer: true, cartPage: false };

    const offer = compileWidgetConfig([d]).offers[0];
    expect(offer.design.preset).toBe('forest');
    expect(offer.placement).toEqual({ drawer: true, cartPage: false });
  });

  it('includes the money format so the widget renders the shop’s own currency', () => {
    expect(compileWidgetConfig([giftDraft()], '€{{amount}}').moneyFormat).toBe('€{{amount}}');
  });
});

describe('versionHash', () => {
  it('is stable for the same input', () => {
    expect(versionHash({ a: 1 })).toBe(versionHash({ a: 1 }));
  });

  it('changes when any payload changes', () => {
    expect(versionHash({ a: 1 })).not.toBe(versionHash({ a: 2 }));
  });

  it('distinguishes payloads that differ only in which document changed', () => {
    expect(versionHash({ a: 1 }, { b: 1 })).not.toBe(versionHash({ a: 1 }, { b: 2 }));
  });
});

describe('compile', () => {
  it('stamps one version across all three payloads', () => {
    const first = compile([giftDraft()]);
    const second = compile([giftDraft()]);
    expect(first.version).toBe(second.version);
  });

  it('produces a different version when a threshold moves', () => {
    const changed = giftDraft();
    changed.tiers[0].threshold = 6000;
    expect(compile([giftDraft()]).version).not.toBe(compile([changed]).version);
  });

  it('serialises the compact config to the string the metafield stores', () => {
    const compiled = compile([giftDraft()]);
    expect(() => JSON.parse(compiled.compactJson)).not.toThrow();
    expect(JSON.parse(compiled.compactJson).o).toHaveLength(1);
  });
});
