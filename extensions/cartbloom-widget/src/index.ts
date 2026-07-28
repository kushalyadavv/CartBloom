/**
 * Widget entry point.
 *
 * Responsibilities, in order: read the config Liquid inlined, find somewhere to
 * mount, subscribe to cart changes, and recompute entitlements on each one.
 * Rendering is Task 31; this currently writes a data attribute so the wiring is
 * observable without a UI.
 *
 * Nothing here calls our infrastructure. Config arrives inlined, cart state
 * comes from Shopify. That is what keeps hosting cost independent of a
 * merchant's traffic (spec §4).
 */

import { resolveOffer, type Cart, type CartLine, type Offer, type OfferEntitlements } from '../../../app/entitlement';
import { onCartChange, fetchCart, type AjaxCart, type AjaxCartLine } from './cart';
import { observeForMount, type MountResult } from './mount';

interface OfferWithScope extends Offer {
  scope?: { kind: 'ENTIRE_CART' | 'COLLECTIONS' | 'PRODUCTS'; ids?: string[] };
  placement?: { drawer?: boolean; cartPage?: boolean };
}

interface WidgetConfig {
  v: number;
  offers: OfferWithScope[];
  moneyFormat?: string;
  routes?: { cartAdd: string; cartChange: string; cart: string };
}

declare global {
  interface Window {
    __CARTBLOOM__?: WidgetConfig;
  }
}

const GIFT_OFFER_PROP = '_cartbloom_offer';
const GIFT_TIER_PROP = '_cartbloom_tier';

/**
 * Whether a line counts toward an offer's threshold.
 *
 * The core is scope-agnostic on purpose: the discount function resolves this
 * from a live `inCollections` query and the widget has no equivalent. Where the
 * widget cannot be certain it must **under-count** — an under-promising bar is
 * a cosmetic defect, an over-promising one charges a customer at checkout for
 * something the bar said was free.
 *
 * `COLLECTIONS` is therefore treated as out of scope until Task 33 embeds a
 * resolved product-ID list at publish time.
 */
function lineInScope(offer: OfferWithScope, line: AjaxCartLine): boolean {
  const scope = offer.scope;
  if (scope === undefined || scope.kind === 'ENTIRE_CART') return true;
  if (scope.kind === 'PRODUCTS') {
    return (scope.ids ?? []).some((id) => id.endsWith(`/${line.product_id}`));
  }
  return false;
}

export function normaliseCart(lines: AjaxCartLine[], offers: OfferWithScope[]): Cart {
  const normalised: CartLine[] = lines.map((line) => {
    const props = line.properties ?? {};
    return {
      id: line.key,
      quantity: line.quantity,
      unitPrice: line.original_price,
      variantId: String(line.variant_id),
      inScope: offers.filter((o) => lineInScope(o, line)).map((o) => o.id),
      // Claims only. The function re-derives entitlement; these are hints for
      // rendering, never evidence.
      giftOfferId: props[GIFT_OFFER_PROP],
      giftTierId: props[GIFT_TIER_PROP],
    };
  });
  return { lines: normalised };
}

export function evaluate(config: WidgetConfig, cart: AjaxCart): OfferEntitlements[] {
  const normalised = normaliseCart(cart.items, config.offers);
  return config.offers.map((offer) => resolveOffer(normalised, offer));
}

function boot(): void {
  const config = window.__CARTBLOOM__;
  if (config === undefined || config.offers.length === 0) return;

  const cartUrl = config.routes?.cart ?? '/cart.js';
  let host: HTMLElement | null = null;

  const paint = (cart: AjaxCart): void => {
    const entitlements = evaluate(config, cart);
    if (host === null) return;
    // Task 31 renders here. Until then, expose enough to verify the wiring
    // from the console on a real storefront.
    host.setAttribute(
      'data-cartbloom-state',
      JSON.stringify(
        entitlements.map((e) => ({
          offer: e.offerId,
          measure: e.measure,
          unlocked: e.unlockedTierIds,
          gifts: e.gifts.length,
        }))
      )
    );
  };

  observeForMount((result: MountResult) => {
    host = result.host;
    host?.setAttribute('data-cartbloom-mount', result.reason);
    void fetchCart(cartUrl).then(paint);
  });

  onCartChange(paint, cartUrl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
