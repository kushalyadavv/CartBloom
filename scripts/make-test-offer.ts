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
const offers = [
  {
    id: 'test-offer',
    trigger: 'SUBTOTAL' as const,
    claimPolicy: {
      withinTier: 'PICK_ONE' as const,
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
        id: 'tier-gift',
        threshold: 10000, // $100.00
        reward: 'GIFT' as const,
        giftPool: variantGids.map((variantId) => ({
          variantId,
          discountType: 'FREE' as const,
          value: 0,
          maxQty: 1,
        })),
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

console.log('\n=== what to expect at checkout ===');
console.log('  under $50   : nothing');
console.log('  $50–$99.99  : free shipping only');
console.log('  $100+       : free shipping, and exactly ONE of the gift variants free');
console.log(`                (${variantGids.length} in the pool; adding all of them should still`);
console.log('                 discount only the highest-priced one)');
