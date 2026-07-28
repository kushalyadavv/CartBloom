/**
 * Cart mutations.
 *
 * Every write goes through one queue. Cart writes race badly: a shopper who
 * clicks two gifts quickly can otherwise end up with both, or neither, because
 * `/cart/add.js` and `/cart/change.js` do not serialise against each other and
 * each response reflects whatever the cart happened to be when it was read.
 *
 * The AJAX cart API is used rather than `Shopify.actions.updateCart` because
 * line properties are what carry the gift claim, and the AJAX API's `properties`
 * field maps to them directly. The action's payload speaks Storefront API
 * attributes instead, which would mean maintaining a second mapping for the
 * same job.
 */

export const GIFT_OFFER_PROP = '_cartbloom_offer';
export const GIFT_TIER_PROP = '_cartbloom_tier';

export interface CartRoutes {
  cartAdd: string;
  cartChange: string;
  cart: string;
}

const DEFAULT_ROUTES: CartRoutes = {
  cartAdd: '/cart/add.js',
  cartChange: '/cart/change.js',
  cart: '/cart.js',
};

/** `/cart/add` and `/cart/add.js` are both valid in Liquid's routes object. */
function asJs(url: string): string {
  return url.endsWith('.js') ? url : `${url}.js`;
}

/**
 * Serialises writes so the cart is only ever mutated by one request at a time.
 *
 * Failures do not poison the chain — a rejected mutation must not prevent the
 * next one, or one network blip would leave the widget permanently unable to
 * add a gift.
 */
export class MutationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /** Resolves once everything queued so far has settled. Test seam. */
  idle(): Promise<unknown> {
    return this.tail;
  }
}

/**
 * Sections to request alongside a mutation.
 *
 * Asking for them in the mutation itself is the point: the response carries
 * markup rendered from the *post-mutation* cart, atomically. Refreshing
 * separately afterwards races the write — the section render can still see the
 * old cart, so the drawer swaps in markup without the gift that was just added
 * and it looks as though nothing happened.
 */
export type SectionRequest = string[];

async function postJson(url: string, body: unknown): Promise<Response> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // 422 is the common one: out of stock, or unpublished. Surfacing the reason
    // matters — "nothing happened" is the worst possible feedback.
    const detail = await response.text().catch(() => '');
    throw new Error(`Cart request failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response;
}

export interface GiftClaim {
  variantId: string;
  offerId: string;
  tierId: string;
}

/** Strip a GID down to the numeric id the AJAX API expects. */
export function numericVariantId(variantId: string): number {
  const tail = variantId.slice(variantId.lastIndexOf('/') + 1);
  return Number(tail);
}

export function addGift(
  claim: GiftClaim,
  routes: Partial<CartRoutes> = {},
  sections: SectionRequest = []
): Promise<Response> {
  const url = asJs(routes.cartAdd ?? DEFAULT_ROUTES.cartAdd);
  return postJson(url, {
    items: [
      {
        id: numericVariantId(claim.variantId),
        quantity: 1,
        properties: {
          // Underscore-prefixed so Shopify hides them from the customer and
          // the order confirmation. They are claims, never evidence — the
          // discount function re-derives entitlement regardless.
          [GIFT_OFFER_PROP]: claim.offerId,
          [GIFT_TIER_PROP]: claim.tierId,
        },
      },
    ],
    ...(sections.length > 0 ? { sections: sections.join(',') } : {}),
  });
}

export function removeLine(
  lineKey: string,
  routes: Partial<CartRoutes> = {},
  sections: SectionRequest = []
): Promise<Response> {
  const url = asJs(routes.cartChange ?? DEFAULT_ROUTES.cartChange);
  return postJson(url, {
    id: lineKey,
    quantity: 0,
    ...(sections.length > 0 ? { sections: sections.join(',') } : {}),
  });
}

/**
 * Replace one claimed gift with another.
 *
 * Remove first, then add. The reverse order would briefly hold two claims for
 * one entitlement, and the discount function — correctly — would arbitrate and
 * discount only one, so a shopper watching the drawer would see the wrong gift
 * flash as free before it corrected.
 */
export async function swapGift(
  previousLineKey: string,
  claim: GiftClaim,
  routes: Partial<CartRoutes> = {},
  sections: SectionRequest = []
): Promise<Response> {
  await removeLine(previousLineKey, routes);
  return addGift(claim, routes, sections);
}
