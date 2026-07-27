/**
 * Widget entry point.
 *
 * Task 29 measures this bundle against the theme app extension's 10 KB
 * compressed JavaScript budget. It is deliberately real rather than a stub —
 * measuring a stub would tell us nothing about whether the entitlement core
 * fits, which is the whole question.
 *
 * Mounting (Task 30) and rendering (Task 31) build on top of this.
 */

import { resolveOffer, type Cart, type CartLine, type Offer } from '../../../app/entitlement';

/** The shape Liquid inlines. See blocks/cartbloom.liquid. */
interface WidgetConfig {
  v: number;
  offers: Array<Offer & { placement?: { drawer?: boolean; cartPage?: boolean } }>;
  moneyFormat?: string;
  routes?: { cartAdd: string; cartChange: string; cart: string };
}

/** A line as `/cart.js` reports it. */
interface AjaxCartLine {
  key: string;
  variant_id: number;
  product_id: number;
  quantity: number;
  original_price: number;
  properties: Record<string, string> | null;
}

declare global {
  interface Window {
    __CARTBLOOM__?: WidgetConfig;
  }
}

const GIFT_OFFER_PROP = '_cartbloom_offer';
const GIFT_TIER_PROP = '_cartbloom_tier';

/**
 * Normalise an AJAX cart into the core's shape.
 *
 * `inScope` is resolved here because the core is deliberately scope-agnostic —
 * the discount function can ask Shopify about collection membership live and
 * this cannot. Where scope is uncertain the widget must **under-count**: an
 * under-promising bar is cosmetic, an over-promising one charges a customer for
 * something the bar said was free. Task 33 implements the uncertain cases; for
 * now only the two exact ones are handled.
 */
export function normaliseCart(lines: AjaxCartLine[], offers: Offer[]): Cart {
  const normalised: CartLine[] = lines.map((line) => {
    const props = line.properties ?? {};
    const inScope: string[] = [];

    for (const offer of offers) {
      const scope = (offer as unknown as { scope?: { kind: string; ids?: string[] } }).scope;
      if (scope === undefined || scope.kind === 'ENTIRE_CART') {
        inScope.push(offer.id);
      } else if (scope.kind === 'PRODUCTS') {
        const ids = scope.ids ?? [];
        if (ids.some((id) => id.endsWith(`/${line.product_id}`))) inScope.push(offer.id);
      }
      // COLLECTIONS is deliberately omitted until Task 33: absent means out of
      // scope, which under-counts. That is the safe direction.
    }

    return {
      id: line.key,
      quantity: line.quantity,
      unitPrice: line.original_price,
      variantId: String(line.variant_id),
      inScope,
      giftOfferId: props[GIFT_OFFER_PROP],
      giftTierId: props[GIFT_TIER_PROP],
    };
  });

  return { lines: normalised };
}

/** Entitlements for every configured offer, given the current cart. */
export function evaluate(config: WidgetConfig, lines: AjaxCartLine[]) {
  const cart = normaliseCart(lines, config.offers);
  return config.offers.map((offer) => resolveOffer(cart, offer));
}

function boot(): void {
  const config = window.__CARTBLOOM__;
  if (config === undefined || config.offers.length === 0) return;

  // Task 30 replaces this with standard-event subscription and mounting.
  void fetch(config.routes?.cart ?? '/cart.js', { headers: { Accept: 'application/json' } })
    .then((r) => r.json())
    .then((cart: { items: AjaxCartLine[] }) => evaluate(config, cart.items));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
