/**
 * Generates the two metafield payloads for manual end-to-end testing (Task 25),
 * before the admin app exists to write them.
 *
 * Uses the real encoder, so what you paste into GraphiQL is exactly what the
 * admin app will publish — a hand-written compact config could disagree with
 * the decoder and send you debugging a problem that isn't there.
 *
 * Usage:
 *   npx tsx scripts/make-test-offer.ts <giftVariantGid> [moreGiftVariantGids...]
 */

import { encodeConfig } from '../app/entitlement/config/encode';
import { checkConfigSize } from '../app/entitlement/config/size';

const variantGids = process.argv.slice(2);

if (variantGids.length === 0) {
  console.error(
    'Pass at least one gift variant GID.\n' +
      '  npx tsx scripts/make-test-offer.ts gid://shopify/ProductVariant/123 gid://shopify/ProductVariant/456\n'
  );
  process.exit(1);
}

// Two tiers so both a non-gift reward and the gift arbitration path get
// exercised: free shipping at $50, then a PICK_ONE gift pool at $100.
const pool = (variants: string[]) =>
  variants.map((variantId) => ({
    variantId,
    discountType: 'FREE' as const,
    value: 0,
    maxQty: 1,
  }));

/**
 * Two gift tiers, so the reward carousel has something to carousel.
 *
 * A reward card only appears when a tier requires a choice, which means a pool
 * of two or more. With four or more variants the pools are split so each tier
 * offers something different; with two or three they are shared, because a
 * split would leave one variant per tier, no choice required, and no card at
 * all. Shared pools are not how a merchant would configure this, but they do
 * exercise the same rendering path.
 */
const half = Math.ceil(variantGids.length / 2);
const canSplit = variantGids.length >= 4;
const firstPool = canSplit ? variantGids.slice(0, half) : variantGids;
const secondPool = canSplit ? variantGids.slice(half) : variantGids;

const offers = [
  {
    id: 'test-offer',
    trigger: 'SUBTOTAL' as const,
    claimPolicy: {
      withinTier: 'PICK_ONE' as const,
      // STACK so both gift tiers grant at once — that is what puts two cards
      // on screen. Under SINGLE only one tier would ever offer a choice.
      acrossTiers: 'STACK' as const,
    },
    tiers: [
      {
        id: 'tier-ship',
        threshold: 5000, // $50.00 in minor units
        reward: 'FREE_SHIPPING' as const,
        giftPool: [],
      },
      {
        id: 'tier-gift-1',
        threshold: 10000, // $100.00
        reward: 'GIFT' as const,
        giftPool: pool(firstPool),
      },
      {
        id: 'tier-gift-2',
        threshold: 20000, // $200.00
        reward: 'GIFT' as const,
        giftPool: pool(secondPool),
      },
    ],
    scope: { kind: 'ENTIRE_CART' as const, ids: [] },
    audience: { customerTags: [], markets: [] },
  },
];

const compact = encodeConfig(offers as never);
const check = checkConfigSize(compact);

console.log('=== config metafield ($app / cartbloom-config) ===\n');
console.log(JSON.stringify(JSON.stringify(compact)));

console.log('\n=== input-variables metafield ($app / cartbloom-input-variables) ===');
console.log('(no tags or collections in this test offer, so both lists are empty)\n');
console.log(JSON.stringify(JSON.stringify({ tags: [], collectionIds: [] })));

// The widget reads a different payload from a different metafield: verbose
// rather than compact, on the shop rather than the discount node, and carrying
// design and placement the function never looks at.
const widgetConfig = {
  v: 1,
  offers: offers.map((o) => ({
    ...o,
    design: {
      layout: 'MILESTONE',
      preset: 'candy',
      tokens: {},
    },
    placement: { drawer: true, cartPage: true },
    copy: {
      progress: 'Just {{remaining}} away from a free gift!',
      unlocked: 'Unlocked — pick your gift',
      locked: 'Spend {{remaining}} more',
    },
  })),
};

console.log('\n=== widget metafield (shop: $app / cartbloom-widget-config) ===');
console.log('Set with metafieldsSet, ownerId = your shop GID.\n');
console.log(JSON.stringify(JSON.stringify(widgetConfig)));

console.log('\n=== sizes ===');
console.log(
  `function config: ${JSON.stringify(compact).length} bytes — ${check.ok ? 'OK' : 'OVER BUDGET (cap 10,000)'}`
);
console.log(
  `widget config:   ${JSON.stringify(widgetConfig).length} bytes — cap 131,072`
);

console.log('\n=== what to expect ===');
console.log('  under $50    : nothing');
console.log('  $50–$99.99   : free shipping only');
console.log('  $100–$199.99 : free shipping + ONE reward card');
console.log('  $200+        : free shipping + TWO reward cards, as a peeking carousel');
console.log('');
console.log(
  canSplit
    ? `  Pools are split: tier 1 offers ${firstPool.length}, tier 2 offers ${secondPool.length}.`
    : `  Only ${variantGids.length} variants given, so both tiers share one pool.\n` +
      '  Splitting would leave a single variant per tier, which requires no choice\n' +
      '  and renders no card at all. Pass 4+ variants for distinct pools.'
);
console.log('');
console.log('  Tiles show grey placeholders and GID labels until Phase 4 resolves');
console.log('  giftDisplays. Expected, not a fault.');
