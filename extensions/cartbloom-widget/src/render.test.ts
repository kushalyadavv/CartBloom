import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  progressMessage,
  progressFraction,
  renderOffer,
  tokenStyle,
  type RenderOffer,
} from './render';
import type { OfferEntitlements } from '../../../app/entitlement';

const offer: RenderOffer = {
  id: 'o1',
  trigger: 'SUBTOTAL',
  claimPolicy: { withinTier: 'PICK_ONE', acrossTiers: 'STACK' },
  tiers: [
    { id: 't1', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
    {
      id: 't2',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [
        { variantId: 'v1', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'v2', discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
  ],
};

const entitlements = (measure: number, unlocked: string[]): OfferEntitlements => ({
  offerId: 'o1',
  measure,
  unlockedTierIds: unlocked,
  gifts: [],
  rewards: { freeShipping: false, orderPercent: 0, orderFixed: 0 },
});

describe('formatMoney', () => {
  it('defaults to dollars when the shop format is unknown', () => {
    expect(formatMoney(1850)).toBe('$18.50');
  });

  it("uses the shop's money format", () => {
    expect(formatMoney(1850, '£{{amount}} GBP')).toBe('£18.50 GBP');
  });

  it('handles the no-decimals format', () => {
    expect(formatMoney(1850, '{{amount_no_decimals}} kr')).toBe('19 kr');
  });

  it('handles comma separators', () => {
    expect(formatMoney(1850, '{{amount_with_comma_separator}} €')).toBe('18,50 €');
  });
});

describe('progressMessage', () => {
  it('uses the locked copy before anything is unlocked', () => {
    const msg = progressMessage({ offer, entitlements: entitlements(2000, []) });
    expect(msg).toContain('$30.00');
  });

  it('uses the progress copy once a tier is unlocked', () => {
    const msg = progressMessage({ offer, entitlements: entitlements(8200, ['t1']) });
    expect(msg).toContain('$18.00');
  });

  it('switches to the unlocked copy when everything is claimed', () => {
    const msg = progressMessage({ offer, entitlements: entitlements(20000, ['t1', 't2']) });
    expect(msg).toBe('All rewards unlocked');
  });

  it('never says "spend $0.00 more" — that reads as broken', () => {
    const msg = progressMessage({ offer, entitlements: entitlements(10000, ['t1', 't2']) });
    expect(msg).not.toContain('0.00');
  });

  it('counts items rather than money for a QUANTITY trigger', () => {
    const qtyOffer: RenderOffer = { ...offer, trigger: 'QUANTITY', tiers: [
      { id: 'q1', threshold: 3, reward: 'GIFT', giftPool: [] },
    ]};
    expect(progressMessage({ offer: qtyOffer, entitlements: entitlements(1, []) })).toContain('2 items');
  });

  it('singularises one remaining item', () => {
    const qtyOffer: RenderOffer = { ...offer, trigger: 'QUANTITY', tiers: [
      { id: 'q1', threshold: 3, reward: 'GIFT', giftPool: [] },
    ]};
    expect(progressMessage({ offer: qtyOffer, entitlements: entitlements(2, []) })).toContain('1 item');
  });

  it('honours merchant copy', () => {
    const custom: RenderOffer = { ...offer, copy: { locked: 'Add {{remaining}}!' } };
    expect(progressMessage({ offer: custom, entitlements: entitlements(0, []) })).toBe('Add $50.00!');
  });
});

describe('progressFraction', () => {
  it('is zero on an empty cart', () => {
    expect(progressFraction({ offer, entitlements: entitlements(0, []) })).toBe(0);
  });

  it('is measured against the top tier', () => {
    expect(progressFraction({ offer, entitlements: entitlements(5000, ['t1']) })).toBe(0.5);
  });

  it('clamps above the top tier rather than overflowing the bar', () => {
    expect(progressFraction({ offer, entitlements: entitlements(99999, ['t1', 't2']) })).toBe(1);
  });
});

describe('renderOffer', () => {
  it('exposes progress to assistive technology as a percentage', () => {
    const html = renderOffer({ offer, entitlements: entitlements(5000, ['t1']) });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('aria-valuemax="100"');
  });

  it('marks unlocked tiers', () => {
    const html = renderOffer({ offer, entitlements: entitlements(5000, ['t1']) });
    expect(html).toContain('cb-tier is-unlocked');
  });

  it('labels a multi-product pool as a choice', () => {
    const html = renderOffer({ offer, entitlements: entitlements(0, []) });
    expect(html).toContain('Pick a gift');
  });

  it('carries the layout and preset for CSS to act on', () => {
    const styled: RenderOffer = { ...offer, design: { layout: 'MILESTONE', preset: 'quiet' } };
    const html = renderOffer({ offer: styled, entitlements: entitlements(0, []) });
    expect(html).toContain('data-layout="milestone"');
    expect(html).toContain('data-preset="quiet"');
  });

  it('escapes merchant copy rather than trusting it', () => {
    const nasty: RenderOffer = { ...offer, copy: { locked: '<img src=x onerror=alert(1)>' } };
    const html = renderOffer({ offer: nasty, entitlements: entitlements(0, []) });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('tokenStyle', () => {
  it('passes through known tokens', () => {
    expect(tokenStyle({ fill: '#f00', thickness: 8 })).toBe('--cb-fill:#f00;--cb-thickness:8');
  });

  it('drops unknown keys so config cannot inject arbitrary CSS', () => {
    expect(tokenStyle({ background: 'url(evil)' } as never)).toBe('');
  });

  it('strips characters that could break out of the style attribute', () => {
    expect(tokenStyle({ fill: 'red;} body{display:none' })).toBe('--cb-fill:red} body{display:none');
  });
});
