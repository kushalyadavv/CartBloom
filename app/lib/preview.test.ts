import { describe, expect, it } from 'vitest';

import { newDraft, type OfferDraft } from './offer-draft';
import { previewCart, previewMarkup, scrubberMax } from './preview';

function giftDraft(): OfferDraft {
  const d = newDraft('o1', 'Gifts');
  d.tiers = [
    { id: 't1', threshold: 5000, reward: 'FREE_SHIPPING', giftPool: [] },
    {
      id: 't2',
      threshold: 10000,
      reward: 'GIFT',
      giftPool: [
        { variantId: 'gid://shopify/ProductVariant/1', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'gid://shopify/ProductVariant/2', discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
    {
      id: 't3',
      threshold: 20000,
      reward: 'GIFT',
      giftPool: [
        { variantId: 'gid://shopify/ProductVariant/3', discountType: 'FREE', value: 0, maxQty: 1 },
        { variantId: 'gid://shopify/ProductVariant/4', discountType: 'FREE', value: 0, maxQty: 1 },
      ],
    },
  ];
  return d;
}

describe('previewCart', () => {
  it('measures subtotal as price when the trigger is SUBTOTAL', () => {
    const cart = previewCart(newDraft('o1'), 7500);
    expect(cart.lines[0].unitPrice).toBe(7500);
    expect(cart.lines[0].quantity).toBe(1);
  });

  it('measures quantity as line count when the trigger is QUANTITY', () => {
    const d = newDraft('o1');
    d.trigger = 'QUANTITY';
    const cart = previewCart(d, 4);
    expect(cart.lines[0].quantity).toBe(4);
  });

  it('never produces a negative cart', () => {
    expect(previewCart(newDraft('o1'), -100).lines[0].unitPrice).toBe(0);
  });
});

describe('previewMarkup', () => {
  it('unlocks tiers as the value rises past each threshold', () => {
    const d = giftDraft();
    const at = (v: number) => (previewMarkup(d, v).match(/is-unlocked/g) ?? []).length;

    expect(at(0)).toBe(0);
    expect(at(5000)).toBe(1);
    expect(at(10000)).toBe(2);
    expect(at(20000)).toBe(3);
  });

  it('shows one reward card without the carousel wrapper', () => {
    const d = giftDraft();
    const html = previewMarkup(d, 10000);
    expect(html).toContain('cb-reward');
    expect(html).not.toContain('cb-rewards');
  });

  it('wraps two or more reward cards in the carousel, as the widget does', () => {
    const d = giftDraft();
    const html = previewMarkup(d, 20000);
    expect(html).toContain('cb-rewards');
    expect(html).toContain('aria-label="Available rewards"');
  });

  it('never leaks a raw variant GID into the markup a merchant looks at', () => {
    expect(previewMarkup(giftDraft(), 10000)).not.toContain('gid://shopify/ProductVariant/1');
  });

  it('shows one thumbnail per gift in the pool', () => {
    const html = previewMarkup(giftDraft(), 10000);
    // Counts tiles, not every occurrence of the word: each blank tile carries
    // both `cb-thumb` and `cb-thumb--blank`.
    expect(html.match(/class="cb-thumb[ "]/g) ?? []).toHaveLength(2);
  });

  it('uses a real product image once the picker has supplied one', () => {
    const d = giftDraft();
    d.giftDisplays = [
      { variantId: 'gid://shopify/ProductVariant/1', title: 'Tote bag', image: 'https://cdn/tote.jpg' },
    ];
    const html = previewMarkup(d, 10000);
    expect(html).toContain('src="https://cdn/tote.jpg"');
    // The second gift has no image yet, so it stays a blank tile.
    expect(html).toContain('cb-thumb--blank');
  });

  it('emits exactly one style attribute carrying both progress and tokens', () => {
    const d = giftDraft();
    // Keys are unprefixed; tokenStyle adds the --cb- prefix and drops anything
    // outside its allowlist.
    d.design.tokens = { 'unlocked-color': '#ff0088' };
    const html = previewMarkup(d, 10000);

    const openTag = html.slice(0, html.indexOf('>') + 1);
    expect(openTag.match(/style=/g)).toHaveLength(1);
    expect(openTag).toContain('--cb-progress:');
    expect(openTag).toContain('--cb-unlocked-color:#ff0088');
  });

  it('renders nothing gift-shaped below the first gift tier', () => {
    expect(previewMarkup(giftDraft(), 6000)).not.toContain('cb-reward');
  });
});

describe('scrubberMax', () => {
  it('reaches past the top tier so the fully-unlocked state is always reachable', () => {
    expect(scrubberMax(giftDraft())).toBeGreaterThan(20000);
  });

  it('has a usable default when there are no tiers yet', () => {
    const d = newDraft('o1');
    d.tiers = [];
    expect(scrubberMax(d)).toBeGreaterThan(0);
  });
});
