/**
 * Publish-time size validation.
 *
 * Shopify delivers an over-cap metafield to a Function as `null`, silently.
 * The function then grants nothing and every offer in the shop stops working,
 * with no error anywhere the merchant can see it. This module is what turns
 * that into a message at publish time instead.
 *
 * The result is deliberately not a boolean: a merchant told "too big" cannot
 * act, a merchant told "you are 3,400 bytes over; the two largest offers are
 * X (2,100 B) and Y (1,900 B)" can. The admin UI that renders this arrives in
 * Phase 4; the function and its tests are here.
 */

import {
  byteLength,
  serializeConfig,
  shardCompactOffers,
  CONFIG_FORMAT_VERSION,
  METAFIELD_BYTE_LIMIT,
  MAX_SHARDS,
  type CompactConfig,
  type CompactOffer,
} from './encode';

/** Bytes contributed by one offer, and the counts that explain them. */
export interface OfferSizeBreakdown {
  offerId: string;
  /** Serialised bytes of this offer's element, excluding its separating comma. */
  bytes: number;
  tierCount: number;
  giftCount: number;
}

export interface ConfigSizeCheck {
  ok: boolean;
  /** Exact UTF-8 bytes of the serialised document — what Shopify measures. */
  bytes: number;
  limit: number;
  /** Bytes over the limit; 0 when `ok`. */
  overBy: number;
  offerCount: number;
  tierCount: number;
  giftCount: number;
  /** Bytes that are not any offer: the `{"v":1,"o":[]}` envelope and commas. */
  envelopeBytes: number;
  /** Every offer, largest first. */
  offers: OfferSizeBreakdown[];
  /**
   * Offer ids that, removed largest-first, bring the document under the limit.
   * Empty when `ok`. This is the "what to cut" answer.
   */
  suggestedRemovals: string[];
  /**
   * Shards this offer set would need at `limit` bytes each, or `null` when it
   * needs more than `MAX_SHARDS`. 1 means it fits in a single metafield.
   */
  shardsRequired: number | null;
  /** A sentence fit to show a merchant. */
  message: string;
}

/** Exact UTF-8 byte size of a compact config as it would be stored. */
export function configByteSize(config: CompactConfig): number {
  return byteLength(serializeConfig(config));
}

function giftCountOf(offer: CompactOffer): number {
  return offer.r.reduce((sum, tier) => sum + (tier.g?.length ?? 0), 0);
}

/**
 * Measure a compact config against the metafield cap.
 *
 * `limit` is exposed for tests and for future shard sizing; production always
 * uses `METAFIELD_BYTE_LIMIT`.
 */
export function checkConfigSize(
  config: CompactConfig,
  limit: number = METAFIELD_BYTE_LIMIT
): ConfigSizeCheck {
  const bytes = configByteSize(config);
  const offers: OfferSizeBreakdown[] = config.o.map((offer) => ({
    offerId: offer.i,
    bytes: byteLength(JSON.stringify(offer)),
    tierCount: offer.r.length,
    giftCount: giftCountOf(offer),
  }));

  const offerBytes = offers.reduce((sum, o) => sum + o.bytes, 0);
  const separators = Math.max(0, offers.length - 1);
  const envelopeBytes = bytes - offerBytes - separators;

  const largestFirst = [...offers].sort(
    (a, b) => b.bytes - a.bytes || (a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0)
  );

  const overBy = Math.max(0, bytes - limit);
  const suggestedRemovals: string[] = [];
  if (overBy > 0) {
    let remaining = bytes;
    for (const offer of largestFirst) {
      if (remaining <= limit) break;
      suggestedRemovals.push(offer.offerId);
      // Removing an offer takes its bytes and its separating comma with it.
      remaining -= offer.bytes + 1;
    }
  }

  let shardsRequired: number | null;
  try {
    // Re-packing from the compact offers avoids re-encoding; the packer only
    // ever measures serialised shards, so feeding it the already-encoded
    // offers is exact.
    shardsRequired = shardCount(config, limit);
  } catch {
    shardsRequired = null;
  }

  const tierCount = offers.reduce((sum, o) => sum + o.tierCount, 0);
  const giftCount = offers.reduce((sum, o) => sum + o.giftCount, 0);

  return {
    ok: overBy === 0,
    bytes,
    limit,
    overBy,
    offerCount: offers.length,
    tierCount,
    giftCount,
    envelopeBytes,
    offers: largestFirst,
    suggestedRemovals,
    shardsRequired,
    message: buildMessage(bytes, limit, overBy, largestFirst, suggestedRemovals, shardsRequired),
  };
}

function buildMessage(
  bytes: number,
  limit: number,
  overBy: number,
  largestFirst: OfferSizeBreakdown[],
  suggestedRemovals: string[],
  shardsRequired: number | null
): string {
  if (overBy === 0) {
    const headroom = limit - bytes;
    const shards = shardsRequired === 1 ? 'one metafield' : `${shardsRequired} metafields`;
    return `Config is ${bytes} bytes of the ${limit}-byte limit (${headroom} to spare), stored in ${shards}.`;
  }

  const worst = largestFirst
    .slice(0, 3)
    .map((o) => `${o.offerId} (${o.bytes} B, ${o.tierCount} tiers, ${o.giftCount} gifts)`)
    .join(', ');

  const cut =
    suggestedRemovals.length === 0
      ? 'Reduce tiers or gift pool entries.'
      : `Removing ${suggestedRemovals.join(', ')} would bring it under the limit.`;

  return (
    `Config is ${bytes} bytes, ${overBy} over the ${limit}-byte limit. ` +
    `Largest offers: ${worst}. ${cut}`
  );
}

/**
 * How many shards this config needs at `limit` bytes each.
 *
 * Throws when it needs more than `MAX_SHARDS` or a single offer does not fit.
 */
export function shardCount(config: CompactConfig, limit: number = METAFIELD_BYTE_LIMIT): number {
  return shardCompact(config, limit).length;
}

/**
 * Split an already-encoded config into shards.
 *
 * `encodeSharded` in `encode.ts` is the same packer driven from the verbose
 * form. This entry point exists so validation can measure a config it was
 * handed without needing the verbose offers back.
 */
export function shardCompact(
  config: CompactConfig,
  limit: number = METAFIELD_BYTE_LIMIT,
  maxShards: number = MAX_SHARDS
): CompactConfig[] {
  return shardCompactOffers(config.o, { limit, maxShards });
}

export { CONFIG_FORMAT_VERSION, METAFIELD_BYTE_LIMIT, MAX_SHARDS };
