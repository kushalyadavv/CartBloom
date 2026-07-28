/**
 * Scope resolution — the widget's half.
 *
 * The entitlement core is deliberately scope-agnostic (spec §4): it takes a
 * cart where each line already carries an `inScope` flag per offer. The two
 * hosts resolve that flag with different information available.
 *
 * The discount function can ask Shopify, per line, which collections a product
 * belongs to. The widget cannot — `/cart.js` reports no collection membership,
 * and asking the storefront per product would put a request on the cart's
 * critical path, which is exactly what the architecture avoids.
 *
 * So publishing resolves collections into a product-ID list and embeds it. That
 * list can go stale between publishes, which forces the governing rule:
 *
 *   **Where the widget cannot be certain, it under-counts.**
 *
 * An under-promising bar is a cosmetic defect — a shopper sees a smaller number
 * than they have earned, and the discount still applies correctly at checkout.
 * An over-promising bar charges someone for a gift it told them was free. The
 * two failures are not comparable, and every ambiguous branch below resolves
 * toward the first.
 */

export type ScopeKind = 'ENTIRE_CART' | 'COLLECTIONS' | 'PRODUCTS';

export interface ResolvedScope {
  kind: ScopeKind;
  /** Collection or product GIDs — the authority the function uses. */
  ids?: string[];
  /**
   * Product GIDs resolved from `ids` at publish time, for the widget only.
   * Absent means the widget has nothing to match against.
   */
  productIds?: string[];
  /**
   * Set at publish when a scoped collection was too large to embed. The widget
   * cannot compute this offer's progress at all and must not guess.
   */
  uncertain?: boolean;
}

/** Cap on embedded product IDs before an offer is marked uncertain. */
export const MAX_EMBEDDED_PRODUCTS = 500;

function matchesId(ids: string[], productId: number | string): boolean {
  const tail = `/${productId}`;
  return ids.some((id) => id === String(productId) || id.endsWith(tail));
}

/**
 * Whether a line counts toward this offer's threshold.
 *
 * Returns false whenever the widget lacks the information to say yes. That is
 * the under-counting rule in code: absence of evidence is treated as evidence
 * of absence, deliberately, because the safe direction is to show less.
 */
export function lineInScope(scope: ResolvedScope | undefined, productId: number | string): boolean {
  if (scope === undefined || scope.kind === 'ENTIRE_CART') return true;

  // An uncertain offer is not rendered at all, but if one reaches here it must
  // not silently count everything.
  if (scope.uncertain === true) return false;

  if (scope.kind === 'PRODUCTS') {
    return matchesId(scope.ids ?? [], productId);
  }

  // COLLECTIONS: only the publish-time list can answer this. No list means no
  // matches — never "assume in scope".
  const resolved = scope.productIds;
  if (resolved === undefined || resolved.length === 0) return false;
  return matchesId(resolved, productId);
}

/**
 * Whether the widget should render this offer at all.
 *
 * An offer whose scope could not be resolved is hidden rather than shown with a
 * number that may be wrong. A missing bar is a merchant support question; a bar
 * showing the wrong progress is a shopper who feels misled at checkout.
 */
export function canRenderOffer(scope: ResolvedScope | undefined): boolean {
  if (scope === undefined || scope.kind === 'ENTIRE_CART') return true;
  if (scope.uncertain === true) return false;
  if (scope.kind === 'PRODUCTS') return (scope.ids ?? []).length > 0;
  return (scope.productIds ?? []).length > 0;
}

/**
 * Why an offer is hidden, for the merchant-facing preview and for support.
 *
 * Never surfaced to shoppers — they see nothing, which is the point.
 */
export function hiddenReason(scope: ResolvedScope | undefined): string | null {
  if (canRenderOffer(scope)) return null;
  if (scope?.uncertain === true) {
    return `Scoped collection exceeds ${MAX_EMBEDDED_PRODUCTS} products, so the storefront bar is hidden. Discounts still apply correctly at checkout.`;
  }
  return 'Scope resolved to no products, so the storefront bar is hidden.';
}
