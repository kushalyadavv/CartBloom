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
} from '../../app/entitlement';
import { onCartChange, fetchCart, refreshCartSections, applySections, sectionsToRequest, type AjaxCart, type AjaxCartLine } from './cart';
import { keepMounted, findDrawerMount, type MountResult } from './mount';
import { renderOffer, renderRewardCard, renderModal, tokenStyle, type RenderOffer, type GiftDisplay } from './render';
import { MutationQueue, addGift, removeLine, swapGift, type CartRoutes } from './mutate';
import { reconcile, removalMessage, selectedVariant, type ClaimedLine } from './claim';
import { lineInScope, canRenderOffer, type ResolvedScope } from './scope';
import { announcement } from './announce';

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

const VARIANT_GID_PREFIX = 'gid://shopify/ProductVariant/';

/**
 * Put cart-line variants into the same ID space as the config.
 *
 * `/cart.js` reports `variant_id` as a bare number; the config — and the
 * discount function's input — use GIDs. Comparing the two directly means every
 * genuine claim looks forged, and reconciliation removes the gift it just
 * added, reporting "that item is not available as a gift".
 *
 * Normalising here rather than loosening the comparison in the shared core
 * keeps the core's exact-match semantics identical in both hosts, which is the
 * property the golden vectors exist to protect.
 */
function toVariantGid(variantId: number | string): string {
  const value = String(variantId);
  return value.startsWith(VARIANT_GID_PREFIX) ? value : VARIANT_GID_PREFIX + value;
}

export function normaliseCart(lines: AjaxCartLine[], offers: OfferWithExtras[]): Cart {
  const normalised: CartLine[] = lines.map((line) => {
    const props = line.properties ?? {};
    return {
      id: line.key,
      quantity: line.quantity,
      unitPrice: line.original_price,
      variantId: toVariantGid(line.variant_id),
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
      variantId: toVariantGid(line.variant_id),
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

  /**
   * Every place the widget paints.
   *
   * The drawer host is found by heuristic; the cart-page host is rendered by an
   * app block the merchant positioned. Both are painted with the same markup,
   * so a shopper sees consistent state wherever they look.
   */
  const hosts = new Map<HTMLElement, { live: HTMLElement; content: HTMLElement }>();
  let notice = '';
  let previous: OfferEntitlements[] | null = null;

  /**
   * Give a host its live region and content container.
   *
   * The live region must sit outside the markup `paint` replaces: one that is
   * removed and recreated is never announced, because assistive technology only
   * reports changes to regions it was already observing.
   */
  const attachHost = (host: HTMLElement): void => {
    if (hosts.has(host)) return;

    const live = document.createElement('p');
    live.className = 'cb__live';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    const content = document.createElement('div');
    host.replaceChildren(live, content);
    hosts.set(host, { live, content });
  };

  /** Hosts rendered by an app block, which exist before any mounting runs. */
  const adoptDeclaredHosts = (): void => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-cartbloom-host]')) {
      attachHost(el);
    }
  };

  const paint = (cart: AjaxCart): void => {
    if (hosts.size === 0) return;

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

        // A reward card per tier the shopper must decide on. The picker itself
        // is a modal, opened from the card.
        const choosers = ent.gifts
          .filter((g) => g.requiresChoice)
          .map((g) =>
            renderRewardCard(g, selectedVariant(claimed, offer.id, g.tierId), offer.giftDisplays)
          )
          .join('');

        const markup = renderOffer({
          offer: offer as RenderOffer,
          entitlements: ent,
          moneyFormat: config.moneyFormat,
          extra: choosers,
        });

        const tokens = tokenStyle(offer.design?.tokens);
        return tokens === ''
          ? markup
          : markup.replace('<div class="cb"', `<div class="cb" style="${tokens}"`);
      })
      .join('');

    // Repainting destroys the focused element. A keyboard shopper who claims a
    // gift would otherwise be dumped back on <body> and lose their place, which
    // makes the chooser effectively unusable without a mouse.
    const active = document.activeElement as HTMLElement | null;
    const focusKey =
      active !== null && active.dataset.cbVariant !== undefined
        ? `${active.dataset.cbOffer}|${active.dataset.cbTier}|${active.dataset.cbVariant}`
        : null;
    const focusedIn = active === null ? null : [...hosts.values()].find((h) => h.content.contains(active));

    const markup = html + (notice === '' ? '' : `<p class="cb__notice">${notice}</p>`);
    const say = announcement({ previous, current: entitlements });

    for (const [, parts] of hosts) {
      parts.content.innerHTML = markup;
      // Announce once per host; each has its own region so whichever the
      // shopper is near will speak.
      if (say !== null) parts.live.textContent = say;
    }
    notice = '';

    if (focusKey !== null && focusedIn !== undefined && focusedIn !== null) {
      const [offerId, tierId, variantId] = focusKey.split('|');
      focusedIn.content
        .querySelector<HTMLElement>(
          `[data-cb-offer="${offerId}"][data-cb-tier="${tierId}"][data-cb-variant="${variantId}"]`
        )
        ?.focus();
    }

    previous = entitlements;
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
        return refreshAndRepaint();
      })
      .catch(() => {
        notice = 'We could not update your gift. Please try again.';
        void fetchCart(cartUrl).then(paint);
      });
  };

  // ---- modal ------------------------------------------------------------

  /** Open modal state. Kept outside the painted markup so a repaint cannot
   *  close the picker under the shopper's hands. */
  let modal: { offerId: string; tierId: string; selected?: string } | null = null;
  const modalLayer = document.createElement('div');
  let lastFocused: HTMLElement | null = null;

  const closeModal = (): void => {
    modal = null;
    modalLayer.replaceChildren();
    modalLayer.remove();
    lastFocused?.focus();
  };

  const drawModal = (cart: AjaxCart): void => {
    if (modal === null) return;
    const ent = evaluate(config, cart)
      .flatMap((e) => e.gifts)
      .find((g) => g.offerId === modal!.offerId && g.tierId === modal!.tierId);

    // The tier stopped being granted while the picker was open — the cart
    // changed in another tab, or an item was removed. Closing is honest;
    // leaving a picker for a reward they no longer have is not.
    if (ent === undefined) {
      closeModal();
      return;
    }

    const offer = config.offers.find((o) => o.id === modal!.offerId);
    modalLayer.innerHTML = renderModal(ent, modal.selected, offer?.giftDisplays, offer?.design?.preset);
    if (!modalLayer.isConnected) document.body.appendChild(modalLayer);
    modalLayer.querySelector<HTMLElement>('[data-cb-pick], .cb-modal__close')?.focus();
  };

  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (target === null) return;

    // Open
    const opener = target.closest<HTMLElement>('[data-cb-open]');
    if (opener !== null && [...hosts.values()].some((h) => h.content.contains(opener))) {
      event.preventDefault();
      lastFocused = opener;
      modal = {
        offerId: opener.dataset.cbOffer!,
        tierId: opener.dataset.cbTier!,
        selected: undefined,
      };
      void fetchCart(cartUrl).then((cart) => {
        modal!.selected = selectedVariant(claimedLines(cart), modal!.offerId, modal!.tierId);
        drawModal(cart);
      });
      return;
    }

    if (modal === null) return;

    // Dismiss
    if (target.closest('[data-cb-dismiss]') !== null) {
      event.preventDefault();
      closeModal();
      return;
    }

    // Select a tile — highlights only; claiming is a separate, deliberate step.
    const tile = target.closest<HTMLElement>('[data-cb-pick]');
    if (tile !== null) {
      event.preventDefault();
      modal.selected = modal.selected === tile.dataset.cbVariant ? undefined : tile.dataset.cbVariant;
      void fetchCart(cartUrl).then(drawModal);
      return;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (modal !== null && event.key === 'Escape') closeModal();
  });

  // ---- claiming ----------------------------------------------------------

  document.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-cb-claim]');
    if (button === null || button === undefined) return;
    if (!modalLayer.contains(button)) return;

    event.preventDefault();
    const offerId = button.dataset.cbOffer!;
    const tierId = button.dataset.cbTier!;
    const variantId = modal?.selected;
    if (variantId === undefined) return;

    button.setAttribute('disabled', '');
    closeModal();

    void queue
      .run(async () => {
        const cart = await fetchCart(cartUrl);
        const existing = claimedLines(cart).find(
          (l) => l.offerId === offerId && l.tierId === tierId
        );

        // Clicking the selected option again is a deselect, not a no-op —
        // a shopper who changes their mind should be able to take nothing.
        const want = sectionsToRequest();
        let response: Response;

        if (existing?.variantId === variantId) {
          response = await removeLine(existing.key, routes, want);
        } else if (existing !== undefined) {
          response = await swapGift(existing.key, { variantId, offerId, tierId }, routes, want);
        } else {
          response = await addGift({ variantId, offerId, tierId }, routes, want);
        }

        // The mutation response carries markup rendered from the post-mutation
        // cart, so applying it cannot race the write. Only fall back to a
        // separate fetch if the theme returned no sections.
        const body = (await response.json()) as { sections?: Record<string, string> };
        const swapped = body.sections !== undefined && applySections(body.sections);
        if (!swapped) await refreshCartSections().catch(() => false);

        for (const el of [...hosts.keys()]) if (!el.isConnected) hosts.delete(el);
        adoptDeclaredHosts();
        attach(findDrawerMount());
        paint(await fetchCart(cartUrl));
      })
      .catch(() => {
        notice = 'We could not update your gift. Please try again.';
        void fetchCart(cartUrl).then(paint);
      });
  });

  const attach = (result: MountResult): void => {
    if (result.host === null) return;
    result.host.setAttribute('data-cartbloom-mount', result.reason);
    attachHost(result.host);
  };

  /**
   * Re-render the theme's cart markup, then re-attach.
   *
   * We mutate through the AJAX API because gift claims travel as line
   * properties and `Shopify.actions.updateCart` cannot carry them. That leaves
   * the theme unaware of the change, so its drawer shows stale line items until
   * a page load. Refreshing the sections fixes that — but the swap destroys our
   * host along with the theme's markup, so mounting has to happen again.
   */
  const refreshAndRepaint = async (): Promise<void> => {
    // Not swallowed. A silent failure here looks identical to the refresh
    // working, which cost several rounds of diagnosis.
    const replaced = await refreshCartSections().catch((error: unknown) => {
      console.warn('[CartBloom] section refresh failed', error);
      return false;
    });
    if (replaced) {
      // The swap destroyed the markup, and our hosts with it.
      for (const el of [...hosts.keys()]) if (!el.isConnected) hosts.delete(el);
      adoptDeclaredHosts();
      attach(findDrawerMount());
    }
    paint(await fetchCart(cartUrl));
  };

  // App blocks render their host in Liquid, so they exist before mounting runs.
  adoptDeclaredHosts();
  if (hosts.size > 0) void fetchCart(cartUrl).then(sync);

  // Continuous, not one-shot: the theme rebuilds its drawer on every cart
  // change and takes our host with it each time.
  keepMounted((result: MountResult) => {
    attach(result);
    void fetchCart(cartUrl).then(paint);
  });

  onCartChange(sync, cartUrl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
