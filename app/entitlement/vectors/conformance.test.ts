import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOffer } from '../resolve';
import { generateVectors, type Vector } from './generate';

const golden: Vector[] = JSON.parse(
  readFileSync(join(import.meta.dirname, 'golden.json'), 'utf8')
);

describe('golden vectors', () => {
  it('has meaningful coverage', () => {
    expect(golden.length).toBeGreaterThan(1000);
  });

  it('has unique names', () => {
    expect(new Set(golden.map((v) => v.name)).size).toBe(golden.length);
  });

  it('covers every claim policy combination', () => {
    for (const token of [
      'ALL_IN_POOL', 'PICK_ONE', 'STACK', 'HIGHEST', 'PINNED', 'CUSTOMER_CHOICE',
      'SUBTOTAL', 'QUANTITY',
    ]) {
      expect(golden.some((v) => v.name.includes(token))).toBe(true);
    }
  });

  // Confirmed by the 2026-07-27 mutation review: the generator enumerated
  // the policy matrix while holding the data matrix fixed, so orderPercent
  // was 0 and inScope was ['o1'] in every one of the 1,968 vectors. These
  // checks guard against that regressing silently.
  it('exercises non-zero order-discount rewards, taking the highest single value', () => {
    expect(golden.some((v) => v.expected.rewards.orderPercent > 0)).toBe(true);
    expect(golden.some((v) => v.expected.rewards.orderFixed > 0)).toBe(true);
  });

  it('varies inScope beyond a single universal offer id', () => {
    const scopes = new Set(golden.flatMap((v) => v.cart.lines.flatMap((l) => l.inScope)));
    expect(scopes.size).toBeGreaterThan(1);
    expect(golden.some((v) => v.cart.lines.some((l) => l.inScope.length === 0))).toBe(true);
  });

  it('is in sync with the generator — regenerate if this fails', () => {
    expect(generateVectors()).toEqual(golden);
  });

  it.each(golden.map((v) => [v.name, v] as const))(
    'TypeScript core satisfies %s',
    (_name, vector) => {
      expect(resolveOffer(vector.cart, vector.offer)).toEqual(vector.expected);
    }
  );
});
