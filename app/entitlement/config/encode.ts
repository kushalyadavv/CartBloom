/**
 * Compact config wire format — the encoder (publish side).
 *
 * The discount function reads its config from a **discount node app
 * metafield**. Shopify Functions cap a metafield value at 10,000 bytes in the
 * input query and deliver an oversized value as a silent `null` — not an
 * error. A function handed `null` grants nothing, so every offer in the shop
 * would quietly stop working with no signal to the merchant. A verbose config
 * does not fit: 5 offers x 6 tiers x 5 gifts measures 16,858 bytes verbose.
 *
 * This module encodes the verbose editor-side shape into the compact wire
 * format documented in `docs/compact-config-format.md`. The Rust decoder in
 * `extensions/discount-function/src/config/decode.rs` is the other half of the
 * contract; `encoding-golden.json` is what stops the two drifting.
 *
 * **Only the function payload is compact.** The widget payload stays verbose
 * and readable — it goes in the shop metafield under the separate 128 KB
 * `json` cap and carries design tokens, copy, and placement the function never
 * reads.
 *
 * Like the rest of `app/entitlement/`, this module is import-free apart from
 * its siblings: it ships to the publish path today and must stay portable.
 */

import type { Offer } from '../types';

// ---------------------------------------------------------------------------
// Format constants
// ---------------------------------------------------------------------------

/**
 * Wire format version. Written as `v` on every document and rejected by the
 * decoder when unrecognised, so a format change is a loud failure rather than
 * a silent misread of a live config.
 */
export const CONFIG_FORMAT_VERSION = 1;

/** Shopify's per-metafield cap inside a Function input query. */
export const METAFIELD_BYTE_LIMIT = 10_000;

/** Shopify's cap on the total Function input, across every field. */
export const FUNCTION_INPUT_BYTE_LIMIT = 64_000;

/**
 * Largest number of config shards this implementation will produce.
 *
 * Four shards is 40,000 bytes of config, leaving 24,000 of the 64,000-byte
 * total input budget for the cart, buyer identity, and localization. Spec §4
 * quotes "roughly 70 offers at 4-6 shards"; that figure counts the config
 * alone and does not reserve anything for the cart, so it is not a limit this
 * code will honour without a fresh measurement of a full input.
 */
export const MAX_SHARDS = 4;

export const VARIANT_GID_PREFIX = 'gid://shopify/ProductVariant/';
export const COLLECTION_GID_PREFIX = 'gid://shopify/Collection/';
export const PRODUCT_GID_PREFIX = 'gid://shopify/Product/';

/**
 * Enum wire codes.
 *
 * The **index is the wire value**. Appending is safe; reordering or removing
 * an entry silently reinterprets every config already live in a merchant's
 * shop, so it is never allowed. Both languages carry the same tables and the
 * golden vectors pin every value.
 */
export const TRIGGER_CODES = ['SUBTOTAL', 'QUANTITY'] as const;
export const REWARD_CODES = ['FREE_SHIPPING', 'ORDER_PERCENT', 'ORDER_FIXED', 'GIFT'] as const;
export const GIFT_DISCOUNT_CODES = ['FREE', 'PERCENT', 'FIXED'] as const;
export const WITHIN_TIER_CODES = ['ALL_IN_POOL', 'PICK_ONE'] as const;
export const ACROSS_TIER_CODES = ['STACK', 'SINGLE'] as const;
export const SINGLE_RESOLUTION_CODES = ['HIGHEST', 'PINNED', 'CUSTOMER_CHOICE'] as const;
export const SCOPE_KIND_CODES = ['ENTIRE_CART', 'COLLECTIONS', 'PRODUCTS'] as const;

export type ScopeKind = (typeof SCOPE_KIND_CODES)[number];

// ---------------------------------------------------------------------------
// The verbose (editor-side) shape
// ---------------------------------------------------------------------------

/**
 * Which cart lines count toward an offer's threshold.
 *
 * The entitlement core is deliberately scope-agnostic — it takes a cart whose
 * lines already carry a resolved `inScope` list (spec §4). These fields are
 * what the *host* uses to resolve that, so they belong in the function payload
 * even though `resolveOffer` never reads them.
 */
export interface OfferScope {
  kind: ScopeKind;
  /** Collection GIDs when kind is COLLECTIONS, product GIDs when PRODUCTS. Empty otherwise. */
  ids: string[];
}

/**
 * Audience gates the host evaluates before an offer applies.
 *
 * `customerTags` is matched via `buyerIdentity.customer.hasAnyTag`, `markets`
 * against `localization.country.isoCode`. Both empty means "everyone".
 *
 * The scheduling window from spec §5 is deliberately **not** carried here:
 * `type Input` in the Function schema exposes no clock, so a function cannot
 * evaluate a date range. Scheduling is enforced at publish time and on the
 * discount node instead. See `docs/compact-config-format.md`.
 */
export interface OfferAudience {
  customerTags: string[];
  /** ISO 3166-1 alpha-2 country codes. */
  markets: string[];
}

/**
 * One published offer as the function needs it: the entitlement core's `Offer`
 * plus the qualifiers the host resolves before calling the core.
 *
 * `Offer` is reproduced structurally rather than wrapped so the verbose form
 * stays a flat, readable document.
 */
export interface FunctionOffer extends Offer {
  scope: OfferScope;
  audience: OfferAudience;
}

// ---------------------------------------------------------------------------
// The compact (wire) shape
// ---------------------------------------------------------------------------

/** `[variantId, discountType, value, maxQty]` — always four elements. */
export type CompactGift = [number | string, number, number, number];

export interface CompactTier {
  /** id, verbatim */
  i: string;
  /** threshold */
  t: number;
  /** reward code */
  r: number;
  /** value — omitted when the verbose field is absent */
  v?: number;
  /** gift pool — omitted when empty */
  g?: CompactGift[];
}

export interface CompactOffer {
  /** id, verbatim */
  i: string;
  /** trigger code */
  t: number;
  /** claimPolicy.withinTier code */
  w: number;
  /** claimPolicy.acrossTiers code */
  a: number;
  /** claimPolicy.singleResolution code — omitted when absent */
  s?: number;
  /** claimPolicy.pinnedTierId — omitted when absent */
  p?: string;
  /** scope.kind code — omitted when ENTIRE_CART */
  y?: number;
  /** scope.ids — omitted when empty */
  c?: (number | string)[];
  /** audience.customerTags — omitted when empty */
  x?: string[];
  /** audience.markets — omitted when empty */
  m?: string[];
  /** tiers ("rungs") */
  r: CompactTier[];
}

export interface CompactConfig {
  /** format version */
  v: number;
  /** shard index, 0-based — omitted on a single-shard config */
  k?: number;
  /** shard count — omitted on a single-shard config */
  n?: number;
  /** offers */
  o: CompactOffer[];
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function codeOf<T extends string>(table: readonly T[], value: T, what: string): number {
  const index = table.indexOf(value);
  if (index < 0) throw new Error(`cannot encode unknown ${what}: ${String(value)}`);
  return index;
}

const NUMERIC_TAIL = /^[1-9][0-9]*$/;

/**
 * A GID becomes its bare numeric tail; anything else is kept verbatim.
 *
 * `gid://shopify/ProductVariant/1000000000000` is 42 bytes and `1000000000000`
 * is 13, which is where most of the ~4x saving comes from.
 *
 * The two encodings are distinguishable by JSON type, never by content, so the
 * mapping is injective: a number always means "prefix + these digits" and a
 * string always means "this id, exactly". An id that happens to be the bare
 * string `"1000000000000"` therefore encodes as a *string*, not a number, and
 * survives the round trip unchanged.
 *
 * Numbers above `Number.MAX_SAFE_INTEGER` fall back to the string form: the
 * Function host hands JSON numbers to Wasm as `f64`, so a larger id would not
 * survive decoding intact.
 */
export function encodeId(id: string, prefix: string): number | string {
  if (!id.startsWith(prefix)) return id;
  const tail = id.slice(prefix.length);
  if (!NUMERIC_TAIL.test(tail)) return id;
  const n = Number(tail);
  if (!Number.isSafeInteger(n)) return id;
  return n;
}

function encodeGift(entry: FunctionOffer['tiers'][number]['giftPool'][number]): CompactGift {
  return [
    encodeId(entry.variantId, VARIANT_GID_PREFIX),
    codeOf(GIFT_DISCOUNT_CODES, entry.discountType, 'gift discount type'),
    entry.value,
    entry.maxQty,
  ];
}

function encodeTier(tier: FunctionOffer['tiers'][number]): CompactTier {
  return {
    i: tier.id,
    t: tier.threshold,
    r: codeOf(REWARD_CODES, tier.reward, 'reward'),
    ...(tier.value === undefined ? {} : { v: tier.value }),
    ...(tier.giftPool.length === 0 ? {} : { g: tier.giftPool.map(encodeGift) }),
  };
}

function scopePrefix(kind: ScopeKind): string {
  return kind === 'PRODUCTS' ? PRODUCT_GID_PREFIX : COLLECTION_GID_PREFIX;
}

export function encodeOffer(offer: FunctionOffer): CompactOffer {
  const scopeCode = codeOf(SCOPE_KIND_CODES, offer.scope.kind, 'scope kind');
  const prefix = scopePrefix(offer.scope.kind);
  const policy = offer.claimPolicy;

  return {
    i: offer.id,
    t: codeOf(TRIGGER_CODES, offer.trigger, 'trigger'),
    w: codeOf(WITHIN_TIER_CODES, policy.withinTier, 'withinTier policy'),
    a: codeOf(ACROSS_TIER_CODES, policy.acrossTiers, 'acrossTiers policy'),
    ...(policy.singleResolution === undefined
      ? {}
      : { s: codeOf(SINGLE_RESOLUTION_CODES, policy.singleResolution, 'single resolution') }),
    ...(policy.pinnedTierId === undefined ? {} : { p: policy.pinnedTierId }),
    ...(scopeCode === 0 ? {} : { y: scopeCode }),
    ...(offer.scope.ids.length === 0
      ? {}
      : { c: offer.scope.ids.map((id) => encodeId(id, prefix)) }),
    ...(offer.audience.customerTags.length === 0 ? {} : { x: offer.audience.customerTags }),
    ...(offer.audience.markets.length === 0 ? {} : { m: offer.audience.markets }),
    r: offer.tiers.map(encodeTier),
  };
}

/** Encode a whole offer set into one unsharded config document. */
export function encodeConfig(offers: FunctionOffer[]): CompactConfig {
  return { v: CONFIG_FORMAT_VERSION, o: offers.map(encodeOffer) };
}

/**
 * The canonical serialisation. Key order is the declaration order above and is
 * fixed, so a config's byte size is reproducible and two publishes of the same
 * offer set produce byte-identical metafield values.
 */
export function serializeConfig(config: CompactConfig): string {
  return JSON.stringify(config);
}

// ---------------------------------------------------------------------------
// Sharding
// ---------------------------------------------------------------------------

/** Bytes reserved for the `"k":N,"n":M,` header a multi-shard document carries. */
const SHARD_HEADER_RESERVE = 20;

export interface ShardOptions {
  /** Bytes allowed per shard. Defaults to the metafield cap. */
  limit?: number;
  /** Largest shard count to produce. Defaults to `MAX_SHARDS`. */
  maxShards?: number;
}

function packOffers(
  encoded: CompactOffer[],
  budget: number
): CompactOffer[][] | null {
  const shards: CompactOffer[][] = [];
  let current: CompactOffer[] = [];

  for (const offer of encoded) {
    const candidate = [...current, offer];
    const size = byteLength(serializeConfig({ v: CONFIG_FORMAT_VERSION, o: candidate }));
    if (size <= budget) {
      current = candidate;
      continue;
    }
    if (current.length === 0) return null; // one offer alone is over budget
    shards.push(current);
    current = [offer];
    const soloSize = byteLength(serializeConfig({ v: CONFIG_FORMAT_VERSION, o: current }));
    if (soloSize > budget) return null;
  }

  if (current.length > 0 || shards.length === 0) shards.push(current);
  return shards;
}

/**
 * Split an offer set across as few shards as fit, each under `limit` bytes.
 *
 * Shards are read together by the function from several metafields on the same
 * discount node. Every shard past the first carries `k` (its index) and `n`
 * (the total), so a shard that arrives `null` — the exact failure this whole
 * format exists to avoid — is detected by the decoder as a missing shard
 * rather than silently producing a config with offers quietly absent.
 *
 * Offers are packed greedily in publish order; order within the reassembled
 * set is preserved.
 */
export function encodeSharded(
  offers: FunctionOffer[],
  options: ShardOptions = {}
): CompactConfig[] {
  return shardCompactOffers(offers.map(encodeOffer), options);
}

/**
 * The packer itself, over offers that are already compact.
 *
 * Exposed separately so publish-time validation can shard a config it was
 * handed without needing the verbose offers back — and so both paths measure
 * exactly the same bytes.
 */
export function shardCompactOffers(
  encoded: CompactOffer[],
  options: ShardOptions = {}
): CompactConfig[] {
  const limit = options.limit ?? METAFIELD_BYTE_LIMIT;
  const maxShards = options.maxShards ?? MAX_SHARDS;

  // Pass 1: no shard header, because a single-shard config carries none.
  const single = packOffers(encoded, limit);
  if (single && single.length === 1) {
    return [{ v: CONFIG_FORMAT_VERSION, o: single[0] }];
  }

  // Pass 2: every shard will carry `k` and `n`, so reserve room for them.
  const packed = packOffers(encoded, limit - SHARD_HEADER_RESERVE);
  if (packed === null) {
    throw new Error(
      `a single offer does not fit in ${limit} bytes; split its tiers or gift pools`
    );
  }
  if (packed.length > maxShards) {
    throw new Error(
      `config needs ${packed.length} shards but only ${maxShards} are supported; ` +
        `reduce the offer count`
    );
  }

  return packed.map((o, k) => ({ v: CONFIG_FORMAT_VERSION, k, n: packed.length, o }));
}

/**
 * UTF-8 byte length. The cap Shopify enforces is bytes, not characters, and a
 * merchant's tag or market list can hold anything.
 */
export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}
