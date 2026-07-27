import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  byteLength,
  encodeConfig,
  encodeSharded,
  serializeConfig,
  CONFIG_FORMAT_VERSION,
  SCOPE_KIND_CODES,
  TRIGGER_CODES,
  REWARD_CODES,
  GIFT_DISCOUNT_CODES,
  WITHIN_TIER_CODES,
  ACROSS_TIER_CODES,
  SINGLE_RESOLUTION_CODES,
} from './encode';
import { generateEncodingVectors, type EncodingVector } from './generate';

const golden: EncodingVector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'encoding-golden.json'), 'utf8')
);

describe('encoding golden vectors', () => {
  it('has coverage', () => {
    expect(golden.length).toBeGreaterThan(30);
  });

  it('has unique names', () => {
    expect(new Set(golden.map((v) => v.name)).size).toBe(golden.length);
  });

  it('is in sync with the generator — regenerate if this fails', () => {
    expect(generateEncodingVectors()).toEqual(golden);
  });

  it.each(golden.map((v) => [v.name, v] as const))(
    'encode(verbose) equals the committed compact form for %s',
    (_name, vector) => {
      expect(encodeConfig(vector.verbose)).toEqual(vector.compact);
    }
  );

  it.each(golden.filter((v) => v.shards).map((v) => [v.name, v] as const))(
    'sharded encoding matches the committed shards for %s',
    (_name, vector) => {
      expect(encodeSharded(vector.verbose, { limit: vector.shardLimit })).toEqual(vector.shards);
    }
  );

  it('every shard is within its declared byte budget', () => {
    for (const vector of golden.filter((v) => v.shards)) {
      for (const shard of vector.shards!) {
        expect(byteLength(serializeConfig(shard))).toBeLessThanOrEqual(vector.shardLimit!);
      }
    }
  });

  it('every compact document declares the current format version', () => {
    for (const vector of golden) {
      expect(vector.compact.v).toBe(CONFIG_FORMAT_VERSION);
      for (const shard of vector.shards ?? []) expect(shard.v).toBe(CONFIG_FORMAT_VERSION);
    }
  });

  // Coverage assertions. A vector set that has quietly stopped exercising an
  // enum value is a vector set that no longer pins that value's wire code.
  it('exercises every enum value in both directions', () => {
    const compactOffers = golden.flatMap((v) => v.compact.o);
    const compactTiers = compactOffers.flatMap((o) => o.r);
    const compactGifts = compactTiers.flatMap((t) => t.g ?? []);

    const seen = (values: (number | undefined)[], table: readonly string[], label: string) => {
      for (let code = 0; code < table.length; code++) {
        // A code of 0 is the omitted default for `y`, so `undefined` counts.
        const present = values.some((v) => (v ?? 0) === code);
        expect(present, `${label} code ${code} (${table[code]}) is not covered`).toBe(true);
      }
    };

    seen(compactOffers.map((o) => o.t), TRIGGER_CODES, 'trigger');
    seen(compactOffers.map((o) => o.w), WITHIN_TIER_CODES, 'withinTier');
    seen(compactOffers.map((o) => o.a), ACROSS_TIER_CODES, 'acrossTiers');
    seen(compactOffers.map((o) => o.y), SCOPE_KIND_CODES, 'scope kind');
    seen(compactTiers.map((t) => t.r), REWARD_CODES, 'reward');
    seen(compactGifts.map((g) => g[1]), GIFT_DISCOUNT_CODES, 'gift discount type');

    // `s` has no default, so it must be present for each of its three codes.
    for (let code = 0; code < SINGLE_RESOLUTION_CODES.length; code++) {
      expect(
        compactOffers.some((o) => o.s === code),
        `single resolution code ${code} (${SINGLE_RESOLUTION_CODES[code]}) is not covered`
      ).toBe(true);
    }
  });

  it('covers every optional field both present and absent', () => {
    const offers = golden.flatMap((v) => v.compact.o);
    const tiers = offers.flatMap((o) => o.r);

    const bothWays = (label: string, values: unknown[]) => {
      expect(values.some((v) => v !== undefined), `${label} never present`).toBe(true);
      expect(values.some((v) => v === undefined), `${label} never absent`).toBe(true);
    };

    bothWays('offer.s (singleResolution)', offers.map((o) => o.s));
    bothWays('offer.p (pinnedTierId)', offers.map((o) => o.p));
    bothWays('offer.y (scope kind)', offers.map((o) => o.y));
    bothWays('offer.c (scope ids)', offers.map((o) => o.c));
    bothWays('offer.x (customer tags)', offers.map((o) => o.x));
    bothWays('offer.m (markets)', offers.map((o) => o.m));
    bothWays('tier.v (value)', tiers.map((t) => t.v));
    bothWays('tier.g (gift pool)', tiers.map((t) => t.g));
  });

  it('covers empty collection, tag and market lists', () => {
    // Represented by an absent key with the scope kind still declared —
    // "COLLECTIONS with nothing selected" must not decode as ENTIRE_CART.
    expect(
      golden.some((v) => v.compact.o.some((o) => o.y === 1 && o.c === undefined))
    ).toBe(true);
    expect(
      golden.some((v) => v.compact.o.some((o) => o.y === 2 && o.c === undefined))
    ).toBe(true);
    expect(golden.some((v) => v.verbose.some((o) => o.audience.customerTags.length === 0))).toBe(
      true
    );
    expect(golden.some((v) => v.verbose.some((o) => o.audience.markets.length === 0))).toBe(true);
  });

  it('covers empty gift pools, an empty offer list and multi-offer configs', () => {
    expect(golden.some((v) => v.verbose.some((o) => o.tiers.some((t) => t.giftPool.length === 0)))).toBe(true);
    expect(golden.some((v) => v.verbose.length === 0)).toBe(true);
    expect(golden.some((v) => v.verbose.length >= 3)).toBe(true);
  });

  it('covers both variant id encodings', () => {
    const gifts = golden.flatMap((v) => v.compact.o.flatMap((o) => o.r.flatMap((t) => t.g ?? [])));
    expect(gifts.some((g) => typeof g[0] === 'number')).toBe(true);
    expect(gifts.some((g) => typeof g[0] === 'string')).toBe(true);
  });

  it('always writes gift entries as four-element arrays', () => {
    for (const vector of golden) {
      for (const offer of vector.compact.o) {
        for (const tier of offer.r) {
          for (const entry of tier.g ?? []) expect(entry).toHaveLength(4);
        }
      }
    }
  });
});
