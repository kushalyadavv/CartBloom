/**
 * Widget entry point.
 *
 * Reads the config Liquid inlined, finds somewhere to mount, subscribes to cart
 * changes, recomputes entitlements, reconciles gift lines, and paints.
 *
 * Nothing here calls our infrastructure. Config arrives inlined, cart state
 * comes from Shopify. That is what keeps hosting cost independent of a
 * merchant's traffic (spec §4).
 */

import {
  resolveOffer,
  type Cart,
  type CartLine,
  type Offer,
  type OfferEntitlements,
} from '../../../app/entitlement';
import { onCartChange, fetchCart, type AjaxCart, type AjaxCartLine } from './cart';
import { observeForMount, type MountResult } from './mount';
import { renderOffer, renderChooser, tokenStyle, type RenderOffer, type GiftDisplay } from './render';
import { MutationQueue, addGift, removeLine, swapGift, type CartRoutes } from './mutate';
import { reconcile, removalMessage, selectedVariant, type ClaimedLine } from './claim';
import { lineInScope, canRenderOffer, type ResolvedScope } from './scope';

interface OfferWithExtras extends Offer {
  scope?: ResolvedScope;
  placement?: { drawer?: boolean; cartPage?: boolean };
  design?: RenderOffer['design'];
  copy?: RenderOffer['copy'];
  /** Titles, images and prices resolved at publish time. See render.ts. */
  giftDisplays?: GiftDisplay[];
}

interface WidgetConfig {
  v: number;
  offers: OfferWithExtras[];
  moneyFormat?: string;
  routes?: CartRoutes;
}

declare global {
  interface Window {
    __CARTBLOOM__?: WidgetConfig;
  }
}

const GIFT_OFFER_PROP = '_cartbloom_offer';
const GIFT_TIER_PROP = '_cartbloom_tier';

export function normaliseCart(lines: AjaxCartLine[], offers: OfferWithExtras[]): Cart {
  const normalised: CartLine[] = lines.map((line) => {
    const props = line.properties ?? {};
    return {
      id: line.key,
      quantity: line.quantity,
      unitPrice: line.original_price,
      variantId: String(line.variant_id),
      inScope: offers.filter((o) => lineInScope(o.scope, line.product_id)).map((o) => o.id),
      giftOfferId: props[GIFT_OFFER_PROP],
      giftTierId: props[GIFT_TIER_PROP],
    };
  });
  return { lines: normalised };
}

export function evaluate(config: WidgetConfig, cart: AjaxCart): OfferEntitlements[] {
  return config.offers.map((offer) => resolveOffer(normaliseCart(cart.items, config.offers), offer));
}

/** Gift lines currently in the cart, in the shape reconciliation expects. */
function claimedLines(cart: AjaxCart): ClaimedLine[] {
  return cart.items
    .filter((line) => (line.properties ?? {})[GIFT_OFFER_PROP] !== undefined)
    .map((line) => ({
      key: line.key,
      variantId: String(line.variant_id),
      offerId: (line.properties ?? {})[GIFT_OFFER_PROP],
      tierId: (line.properties ?? {})[GIFT_TIER_PROP],
    }));
}

function boot(): void {
  const config = window.__CARTBLOOM__;
  if (config === undefined || config.offers.length === 0) return;

  const routes = config.routes;
  const cartUrl = routes?.cart ?? '/cart.js';
  const queue = new MutationQueue();

  let host: HTMLElement | null = null;
  let notice = '';

  const paint = (cart: AjaxCart): void => {
    if (host === null) return;

    const entitlements = evaluate(config, cart);
    const claimed = claimedLines(cart);

    const html = config.offers
      .map((offer, i) => {
        if (offer.placement?.drawer === false || offer.tiers.length === 0) return '';
        // An unresolvable scope means the widget cannot compute progress. Hide
        // the bar rather than show a number that may be wrong -- checkout is
        // unaffected either way.
        if (!canRenderOffer(offer.scope)) return '';

        const ent = entitlements[i];
        let markup = renderOffer({
          offer: offer as RenderOffer,
          entitlements: ent,
          moneyFormat: config.moneyFormat,
        });

        // A chooser per tier the shopper must decide on.
        const choosers = ent.gifts
          .filter((g) => g.requiresChoice)
          .map((g) =>
            renderChooser(g, selectedVariant(claimed, offer.id, g.tierId), offer.giftDisplays)
          )
          .join('');

        if (choosers !== '') markup = markup.replace('</div>', `${choosers}</div>`);

        const tokens = tokenStyle(offer.design?.tokens);
        return tokens === ''
          ? markup
          : markup.replace('<div class="cb"', `<div class="cb" style="${tokens}"`);
      })
      .join('');

    host.innerHTML =
      html + (notice === '' ? '' : `<p class="cb__notice" role="status">${notice}</p>`);
    notice = '';
  };

  /**
   * Bring the cart in line with what the shopper is entitled to.
   *
   * Every write goes through the queue, so a burst of cart activity cannot
   * interleave adds and removes into a state nobody asked for.
   */
  const sync = (cart: AjaxCart): void => {
    const { add, remove } = reconcile(evaluate(config, cart), claimedLines(cart));
    paint(cart);

    if (add.length === 0 && remove.length === 0) return;

    // Explain the first removal. Listing every one turns a small correction
    // into a wall of text; silence reads as a bug.
    if (remove.length > 0) notice = removalMessage(remove[0].reason);

    void queue
      .run(async () => {
        for (const r of remove) await removeLine(r.key, routes);
        for (const a of add) await addGift(a, routes);
        return fetchCart(cartUrl);
      })
      .then(paint, () => {
        notice = 'We could not update your gift. Please try again.';
        void fetchCart(cartUrl).then(paint);
      });
  };

  // Claiming, swapping, and re-claiming, by delegation so re-rendering the
  // host never leaves a dangling listener.
  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-cb-claim]');
    if (button === null || button === undefined) return;
    if (host === null || !host.contains(button)) return;

    event.preventDefault();
    const offerId = button.dataset.cbOffer!;
    const tierId = button.dataset.cbTier!;
    const variantId = button.dataset.cbVariant!;

    button.closest<HTMLElement>('.cb')?.setAttribute('data-busy', '');

    void queue
      .run(async () => {
        const cart = await fetchCart(cartUrl);
        const existing = claimedLines(cart).find(
          (l) => l.offerId === offerId && l.tierId === tierId
        );

        // Clicking the selected option again is a deselect, not a no-op —
        // a shopper who changes their mind should be able to take nothing.
        if (existing?.variantId === variantId) {
          await removeLine(existing.key, routes);
        } else if (existing !== undefined) {
          await swapGift(existing.key, { variantId, offerId, tierId }, routes);
        } else {
          await addGift({ variantId, offerId, tierId }, routes);
        }
        return fetchCart(cartUrl);
      })
      .then(paint, () => {
        notice = 'We could not update your gift. Please try again.';
        void fetchCart(cartUrl).then(paint);
      });
  });

  observeForMount((result: MountResult) => {
    host = result.host;
    host?.setAttribute('data-cartbloom-mount', result.reason);
    void fetchCart(cartUrl).then(sync);
  });

  onCartChange(sync, cartUrl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
