/**
 * These tests exist to enforce one asymmetry: the widget may show a shopper
 * *less* progress than they have earned, but never more.
 *
 * Under-counting is cosmetic — the discount still applies correctly at
 * checkout. Over-counting charges someone for a gift the bar said was free.
 * A failure in the "over-counts" describe block is a release blocker, not a
 * bug to triage.
 */

import { describe, it, expect } from 'vitest';
import { lineInScope, canRenderOffer, hiddenReason, type ResolvedScope } from './scope';

describe('lineInScope — exact cases', () => {
  it('counts every line for ENTIRE_CART', () => {
    expect(lineInScope({ kind: 'ENTIRE_CART' }, 123)).toBe(true);
  });

  it('counts every line when no scope is configured at all', () => {
    expect(lineInScope(undefined, 123)).toBe(true);
  });

  it('matches PRODUCTS by GID', () => {
    const scope: ResolvedScope = { kind: 'PRODUCTS', ids: ['gid://shopify/Product/123'] };
    expect(lineInScope(scope, 123)).toBe(true);
    expect(lineInScope(scope, 999)).toBe(false);
  });

  it('matches COLLECTIONS against the publish-time product list', () => {
    const scope: ResolvedScope = {
      kind: 'COLLECTIONS',
      ids: ['gid://shopify/Collection/5'],
      productIds: ['gid://shopify/Product/123'],
    };
    expect(lineInScope(scope, 123)).toBe(true);
    expect(lineInScope(scope, 999)).toBe(false);
  });

  it('does not confuse a product id that merely ends in the same digits', () => {
    const scope: ResolvedScope = { kind: 'PRODUCTS', ids: ['gid://shopify/Product/123'] };
    expect(lineInScope(scope, 4123)).toBe(false);
  });
});

describe('lineInScope — never over-counts', () => {
  it('excludes when a COLLECTIONS scope has no resolved products', () => {
    expect(lineInScope({ kind: 'COLLECTIONS', ids: ['gid://shopify/Collection/5'] }, 123)).toBe(
      false
    );
  });

  it('excludes when the resolved product list is empty', () => {
    expect(
      lineInScope({ kind: 'COLLECTIONS', ids: ['gid://shopify/Collection/5'], productIds: [] }, 123)
    ).toBe(false);
  });

  it('excludes everything when scope resolution was marked uncertain', () => {
    const scope: ResolvedScope = {
      kind: 'COLLECTIONS',
      ids: ['gid://shopify/Collection/5'],
      // A stale list that happens to contain the product must still not count,
      // because "uncertain" means we do not trust the list at all.
      productIds: ['gid://shopify/Product/123'],
      uncertain: true,
    };
    expect(lineInScope(scope, 123)).toBe(false);
  });

  it('excludes when a PRODUCTS scope lists nothing', () => {
    expect(lineInScope({ kind: 'PRODUCTS', ids: [] }, 123)).toBe(false);
  });
});

describe('canRenderOffer', () => {
  it('renders ENTIRE_CART offers', () => {
    expect(canRenderOffer({ kind: 'ENTIRE_CART' })).toBe(true);
  });

  it('hides an offer whose scope could not be resolved', () => {
    expect(canRenderOffer({ kind: 'COLLECTIONS', ids: ['c1'], uncertain: true })).toBe(false);
  });

  it('hides a COLLECTIONS offer with no resolved products rather than showing zero progress', () => {
    expect(canRenderOffer({ kind: 'COLLECTIONS', ids: ['c1'] })).toBe(false);
  });

  it('hides a PRODUCTS offer that lists nothing', () => {
    expect(canRenderOffer({ kind: 'PRODUCTS', ids: [] })).toBe(false);
  });

  it('renders a COLLECTIONS offer once products are resolved', () => {
    expect(canRenderOffer({ kind: 'COLLECTIONS', ids: ['c1'], productIds: ['p1'] })).toBe(true);
  });
});

describe('hiddenReason', () => {
  it('is null when the offer renders', () => {
    expect(hiddenReason({ kind: 'ENTIRE_CART' })).toBeNull();
  });

  it('explains an oversized collection, and says checkout is unaffected', () => {
    const reason = hiddenReason({ kind: 'COLLECTIONS', ids: ['c1'], uncertain: true });
    expect(reason).toContain('500');
    expect(reason).toContain('checkout');
  });

  it('explains an empty resolution', () => {
    expect(hiddenReason({ kind: 'COLLECTIONS', ids: ['c1'] })).toContain('no products');
  });
});
