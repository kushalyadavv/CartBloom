import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  progressMessage,
  progressFraction,
  renderOffer,
  renderRewardCard,
  renderModal,
  tokenStyle,
  type RenderOffer,
} from './render';
import type { OfferEntitlements } from '../../app/entitlement';

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

  it('names the reward under each marker rather than the threshold', () => {
    const html = renderOffer({ offer, entitlements: entitlements(0, []) });
    expect(html).toContain('Free gift');
    // The amount still needed is stated once, above the bar. Repeating it under
    // every marker crowded the row at drawer widths.
    expect(html).not.toContain('cb-tier__label');
  });

  it('does not call a discounted gift free', () => {
    const discounted: RenderOffer = {
      ...offer,
      tiers: offer.tiers.map((t) =>
        t.reward === 'GIFT'
          ? { ...t, giftPool: t.giftPool.map((g) => ({ ...g, discountType: 'PERCENT' as const, value: 50 })) }
          : t
      ),
    };
    const html = renderOffer({ offer: discounted, entitlements: entitlements(0, []) });
    expect(html).not.toContain('Free gift');
    expect(html).toContain('Gift');
  });

  it('gives each tier an icon for its reward type', () => {
    const html = renderOffer({ offer, entitlements: entitlements(0, []) });
    expect(html).toContain('<svg');
    expect(html).toContain('aria-hidden="true"');
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


/**
 * The picker is a modal with a two-step claim. A grid of images is easy to
 * mis-tap, and an accidental tap that silently mutates the cart is worse than
 * one extra click — which is why choosing and claiming are separate actions.
 */
const pool = {
  offerId: 'o1',
  tierId: 't2',
  candidates: [{ variantId: 'v1' }, { variantId: 'v2' }],
};

describe('renderRewardCard', () => {
  it('makes the whole card the control, not a button inside it', () => {
    const html = renderRewardCard(pool, undefined, []);
    expect(html.startsWith('<button')).toBe(true);
    expect(html).toContain('data-cb-open');
    expect(html).toContain('Select');
  });

  it('changes the call to action once something is chosen', () => {
    expect(renderRewardCard(pool, 'v1', [])).toContain('Change');
  });

  it('names the chosen gift when display data exists', () => {
    const html = renderRewardCard(pool, 'v1', [{ variantId: 'v1', title: 'Cotton Tote' }]);
    expect(html).toContain('Cotton Tote');
  });

  it('shows neutral discs rather than broken images before publish resolves them', () => {
    expect(renderRewardCard(pool, undefined, [])).toContain('cb-thumb--blank');
  });
});

describe('renderModal', () => {
  it('cannot be claimed until something is selected', () => {
    expect(renderModal(pool, undefined, [])).toContain('disabled');
  });

  it('enables claiming once a tile is selected', () => {
    const html = renderModal(pool, 'v1', []);
    expect(html).not.toContain('data-cb-claim data-cb-offer="o1" data-cb-tier="t2" disabled');
    expect(html).toContain('is-selected');
  });

  it('always offers an explicit way to decline', () => {
    expect(renderModal(pool, undefined, [])).toContain('Decide later');
  });

  it('is a labelled modal dialog', () => {
    const html = renderModal(pool, undefined, []);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label');
  });

  it('escapes product titles', () => {
    const html = renderModal(pool, undefined, [
      { variantId: 'v1', title: '<img src=x onerror=alert(1)>' },
    ]);
    expect(html).not.toContain('<img src=x');
  });
});

describe('renderModal', () => {
  const pool = {
    offerId: 'o1',
    tierId: 't1',
    candidates: [{ variantId: 'v1' }, { variantId: 'v2' }, { variantId: 'v3' }],
  };

  it('counts the real pool rather than a fixed number', () => {
    expect(renderModal(pool, undefined, [])).toContain('3 total');
    expect(
      renderModal({ ...pool, candidates: [{ variantId: 'v1' }] }, undefined, [])
    ).toContain('1 total');
  });

  it('shows a product image once one has been resolved', () => {
    const html = renderModal(pool, undefined, [
      { variantId: 'v1', title: 'Tote', image: 'https://cdn/tote.jpg' },
    ]);
    expect(html).toContain('src="https://cdn/tote.jpg"');
    // The other two have none yet, so they stay neutral rather than broken.
    expect(html).toContain('cb-tile__media--blank');
  });

  it('carries the gift mark on the claim button, as the rail does', () => {
    const html = renderModal(pool, 'v1', []);
    const foot = html.slice(html.indexOf('cb-modal__claim'));
    expect(foot).toContain('<svg');
    expect(foot).toContain('Claim selected gift');
  });

  it('disables claiming until something is chosen', () => {
    expect(renderModal(pool, undefined, [])).toContain('disabled');
    expect(renderModal(pool, 'v1', [])).not.toContain('disabled');
  });
});

describe('design tokens', () => {
  it('accepts the accent and radius the modal needs', () => {
    const style = tokenStyle({ accent: '#ff0088', 'claim-radius': '999px' });
    expect(style).toContain('--cb-accent:#ff0088');
    expect(style).toContain('--cb-claim-radius:999px');
  });

  it('still drops anything outside the allowlist', () => {
    expect(tokenStyle({ 'background-image': 'url(evil)' })).toBe('');
  });
});

describe('renderModal token isolation', () => {
  const pool = { offerId: 'o1', tierId: 't1', candidates: [{ variantId: 'v1' }] };

  it('carries the merchant overrides inline, since it renders outside .cb', () => {
    const html = renderModal(pool, undefined, [], 'candy', { fill: '#22aa55', accent: '#22aa55' });
    expect(html).toContain('--cb-fill:#22aa55');
    expect(html).toContain('--cb-accent:#22aa55');
  });

  it('omits the attribute entirely when there is nothing to override', () => {
    expect(renderModal(pool, undefined, [], 'candy')).not.toContain('style="');
  });

  it('still filters the overrides it is handed', () => {
    const html = renderModal(pool, undefined, [], 'candy', { 'background-image': 'url(evil)' });
    expect(html).not.toContain('evil');
  });
});
