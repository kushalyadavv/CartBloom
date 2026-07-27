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
