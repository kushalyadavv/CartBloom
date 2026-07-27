import { describe, it, expect } from 'vitest';
import {
  byteLength,
  encodeConfig,
  serializeConfig,
  FUNCTION_INPUT_BYTE_LIMIT,
  METAFIELD_BYTE_LIMIT,
  type FunctionOffer,
} from './encode';
import { checkConfigSize, configByteSize, shardCompact } from './size';
import { planMaximum } from './generate';

function offer(id: string, tiers: number, gifts: number): FunctionOffer {
  return planMaximum(1, tiers, gifts).map((o) => ({
    ...o,
    id,
    tiers: o.tiers.map((t) => ({ ...t, id: `${id}${t.id}` })),
    claimPolicy: { ...o.claimPolicy, pinnedTierId: `${id}o1t${tiers}` },
  }))[0];
}

describe('configByteSize', () => {
  it('measures the serialised document, which is what Shopify caps', () => {
    const config = encodeConfig([]);
    expect(configByteSize(config)).toBe(serializeConfig(config).length);
    expect(configByteSize(config)).toBe(14); // {"v":1,"o":[]}
  });

  it('counts bytes, not characters', () => {
    const withUnicode = encodeConfig(
      planMaximum(1, 1, 0).map((o) => ({
        ...o,
        audience: { customerTags: ['卸売'], markets: [] },
      }))
    );
    const serialised = serializeConfig(withUnicode);
    expect(configByteSize(withUnicode)).toBe(byteLength(serialised));
    expect(configByteSize(withUnicode)).toBeGreaterThan(serialised.length);
  });
});

describe('checkConfigSize', () => {
  it('passes a config inside the cap and reports the headroom', () => {
    const result = checkConfigSize(encodeConfig(planMaximum(1, 3, 3)));
    expect(result.ok).toBe(true);
    expect(result.overBy).toBe(0);
    expect(result.suggestedRemovals).toEqual([]);
    expect(result.shardsRequired).toBe(1);
    expect(result.message).toMatch(/to spare/);
  });

  it('fails a config over the cap and says by how much', () => {
    const result = checkConfigSize(encodeConfig(planMaximum(25, 6, 5)));
    expect(result.ok).toBe(false);
    expect(result.overBy).toBe(result.bytes - METAFIELD_BYTE_LIMIT);
    expect(result.overBy).toBeGreaterThan(0);
    expect(result.message).toMatch(/over the 10000-byte limit/);
  });

  it('names what to cut, largest offer first', () => {
    const offers = [offer('small', 1, 1), offer('huge', 6, 5), offer('medium', 3, 3)];
    // A limit that only the smallest offer fits under.
    const result = checkConfigSize(encodeConfig(offers), 400);

    expect(result.ok).toBe(false);
    expect(result.offers.map((o) => o.offerId)).toEqual(['huge', 'medium', 'small']);
    expect(result.suggestedRemovals[0]).toBe('huge');
    expect(result.suggestedRemovals).not.toContain('small');
  });

  it('the suggested removals genuinely bring the config under the limit', () => {
    const offers = [offer('a', 6, 5), offer('b', 6, 5), offer('c', 1, 1)];
    const limit = 900;
    const result = checkConfigSize(encodeConfig(offers), limit);
    expect(result.ok).toBe(false);

    const kept = offers.filter((o) => !result.suggestedRemovals.includes(o.id));
    expect(configByteSize(encodeConfig(kept))).toBeLessThanOrEqual(limit);
  });

  it('reports counts and per-offer detail a merchant can act on', () => {
    const result = checkConfigSize(encodeConfig(planMaximum(2, 3, 4)));
    expect(result.offerCount).toBe(2);
    expect(result.tierCount).toBe(6);
    expect(result.giftCount).toBe(24);
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({ tierCount: 3, giftCount: 12 });
  });

  it('accounts for every byte: envelope plus offers plus commas is the total', () => {
    const config = encodeConfig(planMaximum(4, 2, 2));
    const result = checkConfigSize(config);
    const offerBytes = result.offers.reduce((sum, o) => sum + o.bytes, 0);
    expect(result.envelopeBytes + offerBytes + (result.offerCount - 1)).toBe(result.bytes);
  });

  it('handles an empty config', () => {
    const result = checkConfigSize(encodeConfig([]));
    expect(result.ok).toBe(true);
    expect(result.offerCount).toBe(0);
    expect(result.envelopeBytes).toBe(14);
    expect(result.shardsRequired).toBe(1);
  });

  it('reports shardsRequired as null when the offer set exceeds the shard budget', () => {
    const result = checkConfigSize(encodeConfig(planMaximum(60, 6, 5)));
    expect(result.ok).toBe(false);
    expect(result.shardsRequired).toBeNull();
  });
});

/**
 * The measurements that justify the format's existence, asserted so a future
 * change to the encoder cannot quietly push a shipping plan over the cap.
 *
 * Measured 2026-07-27 against a worst case in which every tier carries a full
 * gift pool of PERCENT-discounted variants and a PINNED claim policy.
 */
describe('plan maxima against the 10,000-byte metafield cap', () => {
  const measure = (offers: number, tiers: number, gifts: number) => {
    const verbose = planMaximum(offers, tiers, gifts);
    return {
      verboseBytes: byteLength(JSON.stringify(verbose)),
      check: checkConfigSize(encodeConfig(verbose)),
    };
  };

  it('Free (1 offer x 3 tiers x 3 gifts) fits in one metafield', () => {
    const { verboseBytes, check } = measure(1, 3, 3);
    expect(verboseBytes).toBeLessThan(METAFIELD_BYTE_LIMIT); // verbose would fit too
    expect(check.ok).toBe(true);
    expect(check.shardsRequired).toBe(1);
    expect(check.bytes).toBeLessThan(500);
  });

  it('Growth (5 x 6 x 5) does not fit verbose but fits compact in one metafield', () => {
    const { verboseBytes, check } = measure(5, 6, 5);
    expect(verboseBytes).toBeGreaterThan(METAFIELD_BYTE_LIMIT);
    expect(check.ok).toBe(true);
    expect(check.shardsRequired).toBe(1);
    expect(check.bytes).toBeLessThan(6_000);
    // The saving that makes the Growth plan deliverable at all.
    expect(verboseBytes / check.bytes).toBeGreaterThan(3.5);
  });

  it('ten offers is the most that fits in a single metafield', () => {
    expect(measure(10, 6, 5).check.shardsRequired).toBe(1);
    expect(measure(11, 6, 5).check.shardsRequired).toBe(2);
  });

  it('Pro (25 x 6 x 5) exceeds one metafield and requires sharding', () => {
    const { check } = measure(25, 6, 5);
    expect(check.ok).toBe(false);
    expect(check.bytes).toBeGreaterThan(METAFIELD_BYTE_LIMIT);
    expect(check.shardsRequired).toBe(3);
  });

  it('Pro sharded stays inside every per-shard cap and the total input cap', () => {
    const config = encodeConfig(planMaximum(25, 6, 5));
    const shards = shardCompact(config);
    expect(shards).toHaveLength(3);

    let total = 0;
    shards.forEach((shard, i) => {
      const bytes = byteLength(serializeConfig(shard));
      expect(bytes).toBeLessThanOrEqual(METAFIELD_BYTE_LIMIT);
      expect(shard.k).toBe(i);
      expect(shard.n).toBe(3);
      total += bytes;
    });

    // Leaves room for the cart, buyer identity and localization in the same input.
    expect(total).toBeLessThan(FUNCTION_INPUT_BYTE_LIMIT / 2);
  });

  it('scope and audience data does not push Growth over the cap', () => {
    const withQualifiers = planMaximum(5, 6, 5, { withScope: true, withAudience: true });
    expect(checkConfigSize(encodeConfig(withQualifiers)).ok).toBe(true);
  });
});
