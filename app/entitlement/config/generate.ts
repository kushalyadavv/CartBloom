/**
 * Encoding vector generator — the anti-drift mechanism for the wire format.
 *
 * Two decoders in two languages will drift unless something stops them. This
 * file writes `encoding-golden.json`, a set of `{ name, verbose, compact }`
 * cases that TypeScript and Rust both assert:
 *
 * - TypeScript: `encodeConfig(verbose)` deep-equals `compact`
 * - Rust: `decode_config(compact)` equals the `OfferConfig` the verbose form
 *   describes
 *
 * Regenerate with:
 *
 *     npx tsx app/entitlement/config/generate.ts
 *
 * A conformance test asserts the committed file still matches this generator,
 * so a format change that is not reflected here fails the build.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GiftPoolEntry, Tier } from '../types';
import {
  encodeConfig,
  encodeSharded,
  VARIANT_GID_PREFIX,
  COLLECTION_GID_PREFIX,
  PRODUCT_GID_PREFIX,
  type CompactConfig,
  type FunctionOffer,
} from './encode';

export interface EncodingVector {
  name: string;
  verbose: FunctionOffer[];
  compact: CompactConfig;
  /** Per-shard byte budget, present only on sharding cases. */
  shardLimit?: number;
  /** Expected shards, present only on sharding cases. */
  shards?: CompactConfig[];
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const V = (n: number) => `${VARIANT_GID_PREFIX}${n}`;
const C = (n: number) => `${COLLECTION_GID_PREFIX}${n}`;
const P = (n: number) => `${PRODUCT_GID_PREFIX}${n}`;

function gift(variantId: string, over: Partial<GiftPoolEntry> = {}): GiftPoolEntry {
  return { variantId, discountType: 'FREE', value: 0, maxQty: 1, ...over };
}

function tier(id: string, threshold: number, over: Partial<Tier> = {}): Tier {
  return { id, threshold, reward: 'FREE_SHIPPING', giftPool: [], ...over };
}

function offer(id: string, over: Partial<FunctionOffer> = {}): FunctionOffer {
  return {
    id,
    trigger: 'SUBTOTAL',
    claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
    tiers: [tier(`${id}t1`, 5000)],
    scope: { kind: 'ENTIRE_CART', ids: [] },
    audience: { customerTags: [], markets: [] },
    ...over,
  };
}

function vector(name: string, verbose: FunctionOffer[]): EncodingVector {
  return { name, verbose, compact: encodeConfig(verbose) };
}

function shardVector(name: string, verbose: FunctionOffer[], shardLimit: number): EncodingVector {
  return {
    name,
    verbose,
    compact: encodeConfig(verbose),
    shardLimit,
    shards: encodeSharded(verbose, { limit: shardLimit }),
  };
}

// ---------------------------------------------------------------------------
// Plan-maximum fixtures
// ---------------------------------------------------------------------------

/**
 * A worst-case offer set of the given shape, used to measure the plan maxima
 * against the 10,000-byte metafield cap.
 *
 * Ids are short by design — `o12`, `o12t4` — because offer and tier ids are
 * repeated once per tier in the config *and* echoed into every gift line's
 * `_cartbloom_offer` / `_cartbloom_tier` attributes. A 25-character database
 * id instead of a 5-character one costs roughly 20 bytes x (1 + tiers) x
 * offers, which is ~3,500 bytes at the Pro maximum. Short published ids are a
 * budget requirement, not a cosmetic preference.
 *
 * Every tier carries a full gift pool and the largest reward payload, so the
 * measurement is an upper bound rather than a typical config.
 */
export function planMaximum(
  offerCount: number,
  tierCount: number,
  giftCount: number,
  options: { withScope?: boolean; withAudience?: boolean } = {}
): FunctionOffer[] {
  const offers: FunctionOffer[] = [];
  for (let o = 1; o <= offerCount; o++) {
    const tiers: Tier[] = [];
    for (let t = 1; t <= tierCount; t++) {
      const pool: GiftPoolEntry[] = [];
      for (let g = 1; g <= giftCount; g++) {
        pool.push(
          gift(V(1000000000000 + o * 1000 + t * 10 + g), {
            discountType: 'PERCENT',
            value: 25,
            maxQty: 2,
          })
        );
      }
      tiers.push(tier(`o${o}t${t}`, 5000 * t, { reward: 'GIFT', value: 25, giftPool: pool }));
    }
    offers.push(
      offer(`o${o}`, {
        trigger: 'SUBTOTAL',
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'PINNED',
          pinnedTierId: `o${o}t${tierCount}`,
        },
        scope: options.withScope
          ? { kind: 'COLLECTIONS', ids: [C(400000000 + o), C(410000000 + o)] }
          : { kind: 'ENTIRE_CART', ids: [] },
        audience: options.withAudience
          ? { customerTags: ['vip', 'wholesale'], markets: ['US', 'CA'] }
          : { customerTags: [], markets: [] },
        tiers,
      })
    );
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export function generateEncodingVectors(): EncodingVector[] {
  const cases: EncodingVector[] = [];

  // --- shape floor -------------------------------------------------------
  cases.push(vector('empty-offer-list', []));
  cases.push(vector('minimal-single-offer', [offer('o1')]));

  // --- TriggerMetric, every value ---------------------------------------
  cases.push(vector('trigger-SUBTOTAL', [offer('o1', { trigger: 'SUBTOTAL' })]));
  cases.push(vector('trigger-QUANTITY', [offer('o1', { trigger: 'QUANTITY' })]));

  // --- RewardKind, every value ------------------------------------------
  cases.push(
    vector('reward-FREE_SHIPPING-no-value', [
      offer('o1', { tiers: [tier('t1', 5000, { reward: 'FREE_SHIPPING' })] }),
    ])
  );
  cases.push(
    vector('reward-ORDER_PERCENT', [
      offer('o1', { tiers: [tier('t1', 5000, { reward: 'ORDER_PERCENT', value: 10 })] }),
    ])
  );
  cases.push(
    vector('reward-ORDER_FIXED', [
      offer('o1', { tiers: [tier('t1', 5000, { reward: 'ORDER_FIXED', value: 500 })] }),
    ])
  );
  cases.push(
    vector('reward-GIFT', [
      offer('o1', {
        tiers: [tier('t1', 5000, { reward: 'GIFT', giftPool: [gift(V(1000000000000))] })],
      }),
    ])
  );

  // --- GiftDiscountType, every value ------------------------------------
  cases.push(
    vector('gift-discount-FREE', [
      offer('o1', {
        tiers: [
          tier('t1', 5000, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000001), { discountType: 'FREE', value: 0, maxQty: 1 })],
          }),
        ],
      }),
    ])
  );
  cases.push(
    vector('gift-discount-PERCENT', [
      offer('o1', {
        tiers: [
          tier('t1', 5000, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000002), { discountType: 'PERCENT', value: 25, maxQty: 2 })],
          }),
        ],
      }),
    ])
  );
  cases.push(
    vector('gift-discount-FIXED', [
      offer('o1', {
        tiers: [
          tier('t1', 5000, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000003), { discountType: 'FIXED', value: 1500, maxQty: 3 })],
          }),
        ],
      }),
    ])
  );

  // --- WithinTierPolicy, every value ------------------------------------
  for (const withinTier of ['ALL_IN_POOL', 'PICK_ONE'] as const) {
    cases.push(
      vector(`within-${withinTier}`, [
        offer('o1', { claimPolicy: { withinTier, acrossTiers: 'STACK' } }),
      ])
    );
  }

  // --- AcrossTierPolicy and SingleTierResolution, every value ------------
  cases.push(
    vector('across-STACK-no-resolution', [
      offer('o1', { claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' } }),
    ])
  );
  cases.push(
    vector('across-SINGLE-HIGHEST', [
      offer('o1', {
        claimPolicy: {
          withinTier: 'ALL_IN_POOL',
          acrossTiers: 'SINGLE',
          singleResolution: 'HIGHEST',
        },
      }),
    ])
  );
  cases.push(
    vector('across-SINGLE-PINNED-with-pinned-tier-id', [
      offer('o1', {
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'PINNED',
          pinnedTierId: 'o1t1',
        },
      }),
    ])
  );
  cases.push(
    vector('across-SINGLE-PINNED-without-pinned-tier-id', [
      offer('o1', {
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'PINNED',
        },
      }),
    ])
  );
  cases.push(
    vector('across-SINGLE-CUSTOMER_CHOICE', [
      offer('o1', {
        claimPolicy: {
          withinTier: 'ALL_IN_POOL',
          acrossTiers: 'SINGLE',
          singleResolution: 'CUSTOMER_CHOICE',
        },
      }),
    ])
  );
  cases.push(
    vector('across-STACK-with-stray-pinned-tier-id', [
      offer('o1', {
        claimPolicy: {
          withinTier: 'ALL_IN_POOL',
          acrossTiers: 'STACK',
          pinnedTierId: 'o1t1',
        },
      }),
    ])
  );

  // --- Scope, every kind, populated and empty ---------------------------
  cases.push(
    vector('scope-ENTIRE_CART-empty-ids', [
      offer('o1', { scope: { kind: 'ENTIRE_CART', ids: [] } }),
    ])
  );
  cases.push(
    vector('scope-COLLECTIONS-empty-list', [
      offer('o1', { scope: { kind: 'COLLECTIONS', ids: [] } }),
    ])
  );
  cases.push(
    vector('scope-COLLECTIONS-populated', [
      offer('o1', { scope: { kind: 'COLLECTIONS', ids: [C(400000001), C(400000002)] } }),
    ])
  );
  cases.push(
    vector('scope-PRODUCTS-empty-list', [offer('o1', { scope: { kind: 'PRODUCTS', ids: [] } })])
  );
  cases.push(
    vector('scope-PRODUCTS-populated', [
      offer('o1', { scope: { kind: 'PRODUCTS', ids: [P(700000001), P(700000002), P(700000003)] } }),
    ])
  );
  cases.push(
    vector('scope-COLLECTIONS-non-gid-id-kept-verbatim', [
      offer('o1', { scope: { kind: 'COLLECTIONS', ids: ['legacy-collection-handle'] } }),
    ])
  );

  // --- Audience, empty and populated ------------------------------------
  cases.push(
    vector('audience-empty-tags-and-markets', [
      offer('o1', { audience: { customerTags: [], markets: [] } }),
    ])
  );
  cases.push(
    vector('audience-tags-only', [
      offer('o1', { audience: { customerTags: ['vip', 'wholesale'], markets: [] } }),
    ])
  );
  cases.push(
    vector('audience-markets-only', [
      offer('o1', { audience: { customerTags: [], markets: ['US', 'CA', 'GB'] } }),
    ])
  );
  cases.push(
    vector('audience-tags-and-markets', [
      offer('o1', { audience: { customerTags: ['vip'], markets: ['DE'] } }),
    ])
  );
  cases.push(
    vector('audience-non-ascii-tag', [
      offer('o1', { audience: { customerTags: ['großhandel', '卸売'], markets: ['JP'] } }),
    ])
  );

  // --- Optional tier value, present and absent --------------------------
  cases.push(
    vector('tier-value-absent', [offer('o1', { tiers: [tier('t1', 5000)] })])
  );
  cases.push(
    vector('tier-value-present-zero', [
      offer('o1', { tiers: [tier('t1', 5000, { reward: 'ORDER_PERCENT', value: 0 })] }),
    ])
  );

  // --- Gift pools, empty and populated ----------------------------------
  cases.push(
    vector('gift-pool-empty-on-gift-tier', [
      offer('o1', { tiers: [tier('t1', 5000, { reward: 'GIFT', giftPool: [] })] }),
    ])
  );
  cases.push(
    vector('gift-pool-mixed-discount-types', [
      offer('o1', {
        tiers: [
          tier('t1', 5000, {
            reward: 'GIFT',
            giftPool: [
              gift(V(1000000000010)),
              gift(V(1000000000011), { discountType: 'PERCENT', value: 50, maxQty: 2 }),
              gift(V(1000000000012), { discountType: 'FIXED', value: 999, maxQty: 4 }),
            ],
          }),
        ],
      }),
    ])
  );

  // --- Boundary values ---------------------------------------------------
  cases.push(
    vector('boundary-zero-threshold', [offer('o1', { tiers: [tier('t1', 0)] })])
  );
  cases.push(
    vector('boundary-percent-100', [
      offer('o1', { tiers: [tier('t1', 1, { reward: 'ORDER_PERCENT', value: 100 })] }),
    ])
  );
  cases.push(
    vector('boundary-large-threshold', [
      offer('o1', { tiers: [tier('t1', 9007199254740991)] }),
    ])
  );
  cases.push(
    vector('boundary-max-safe-variant-id', [
      offer('o1', {
        tiers: [
          tier('t1', 100, {
            reward: 'GIFT',
            giftPool: [gift(`${VARIANT_GID_PREFIX}9007199254740991`)],
          }),
        ],
      }),
    ])
  );
  cases.push(
    vector('boundary-variant-id-past-max-safe-stays-a-string', [
      offer('o1', {
        tiers: [
          tier('t1', 100, {
            reward: 'GIFT',
            giftPool: [gift(`${VARIANT_GID_PREFIX}9007199254740993`)],
          }),
        ],
      }),
    ])
  );
  cases.push(
    vector('boundary-non-gid-variant-id-kept-verbatim', [
      offer('o1', {
        tiers: [tier('t1', 100, { reward: 'GIFT', giftPool: [gift('v-mug')] })],
      }),
    ])
  );
  cases.push(
    vector('boundary-bare-numeric-variant-id-stays-a-string', [
      offer('o1', {
        tiers: [tier('t1', 100, { reward: 'GIFT', giftPool: [gift('1000000000000')] })],
      }),
    ])
  );
  cases.push(
    vector('boundary-gid-tail-with-leading-zero-stays-a-string', [
      offer('o1', {
        tiers: [
          tier('t1', 100, { reward: 'GIFT', giftPool: [gift(`${VARIANT_GID_PREFIX}0123`)] }),
        ],
      }),
    ])
  );
  cases.push(
    vector('boundary-gift-zero-max-qty', [
      offer('o1', {
        tiers: [
          tier('t1', 100, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000020), { maxQty: 0 })],
          }),
        ],
      }),
    ])
  );

  // --- Multi-offer -------------------------------------------------------
  cases.push(
    vector('multi-offer-three-with-distinct-policies', [
      offer('oA', {
        trigger: 'SUBTOTAL',
        claimPolicy: { withinTier: 'ALL_IN_POOL', acrossTiers: 'STACK' },
        tiers: [
          tier('oAt1', 5000, { reward: 'FREE_SHIPPING' }),
          tier('oAt2', 10000, { reward: 'ORDER_PERCENT', value: 10 }),
        ],
      }),
      offer('oB', {
        trigger: 'QUANTITY',
        claimPolicy: {
          withinTier: 'PICK_ONE',
          acrossTiers: 'SINGLE',
          singleResolution: 'PINNED',
          pinnedTierId: 'oBt2',
        },
        scope: { kind: 'COLLECTIONS', ids: [C(400000009)] },
        audience: { customerTags: ['vip'], markets: ['US'] },
        tiers: [
          tier('oBt1', 2, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000030)), gift(V(1000000000031), { maxQty: 2 })],
          }),
          tier('oBt2', 4, {
            reward: 'GIFT',
            giftPool: [gift(V(1000000000032), { discountType: 'PERCENT', value: 30, maxQty: 1 })],
          }),
        ],
      }),
      offer('oC', {
        claimPolicy: {
          withinTier: 'ALL_IN_POOL',
          acrossTiers: 'SINGLE',
          singleResolution: 'CUSTOMER_CHOICE',
        },
        scope: { kind: 'PRODUCTS', ids: [P(700000005)] },
        tiers: [tier('oCt1', 7500, { reward: 'ORDER_FIXED', value: 1000 })],
      }),
    ])
  );

  // --- Sharding ----------------------------------------------------------
  const shardables = [1, 2, 3, 4, 5].map((n) =>
    offer(`os${n}`, {
      tiers: [
        tier(`os${n}t1`, 5000 * n, {
          reward: 'GIFT',
          giftPool: [gift(V(1000000000100 + n)), gift(V(1000000000200 + n), { maxQty: 2 })],
        }),
        tier(`os${n}t2`, 10000 * n, { reward: 'ORDER_PERCENT', value: n }),
      ],
    })
  );
  cases.push(shardVector('shard-one-when-everything-fits', shardables, 10_000));
  cases.push(shardVector('shard-two', shardables, 500));
  cases.push(shardVector('shard-three', shardables, 340));

  return cases;
}

// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith('config/generate.ts')) {
  const vectors = generateEncodingVectors();
  writeFileSync(
    join(import.meta.dirname, 'encoding-golden.json'),
    JSON.stringify(vectors, null, 2) + '\n'
  );
  console.log(`Wrote ${vectors.length} encoding vectors`);
}
