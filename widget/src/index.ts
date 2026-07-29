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
import { renderOffer, renderRewardCard, renderRewards, renderModal, type RenderOffer, type GiftDisplay } from './render';
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
  /** The shop's default currency, for comparison against the cart's. */
  currency?: string;
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
        const cards = ent.gifts
          .filter((g) => g.requiresChoice)
          .map((g) =>
            renderRewardCard(g, selectedVariant(claimed, offer.id, g.tierId), offer.giftDisplays)
          );

        // One header above the cards; renderRewards owns the carousel.
        const choosers = renderRewards(cards);

        const markup = renderOffer({
          offer: offer as RenderOffer,
          entitlements: ent,
          moneyFormat: config.moneyFormat,
          currency: { cart: cart.currency, shop: config.currency },
          extra: choosers,
        });

        // Tokens are applied inside renderOffer, which folds them into the
        // single style attribute on .cb. Splicing a second one here dropped
        // --cb-progress and froze the bar at empty.
        return markup;
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
        // The last write carries the section request, so the markup that comes
        // back is rendered from the post-mutation cart.
        //
        // This path used to mutate and then fetch sections separately, which is
        // the same race already fixed for the modal: the fetch can be served
        // from before the write lands, and the shopper sees their gift only
        // after a full page reload. A tier with a single gift auto-claims, so
        // this is the only path that runs for it and the bug was invisible
        // wherever a chooser appeared.
        const want = sectionsToRequest();
        const writes: Array<(sections: string[]) => Promise<Response>> = [
          ...remove.map((r) => (sections: string[]) => removeLine(r.key, routes, sections)),
          ...add.map((a) => (sections: string[]) => addGift(a, routes, sections)),
        ];

        let last: Response | undefined;
        for (let i = 0; i < writes.length; i += 1) {
          last = await writes[i](i === writes.length - 1 ? want : []);
        }

        const body =
          last === undefined
            ? undefined
            : ((await last.json().catch(() => undefined)) as
                | { sections?: Record<string, string> }
                | undefined);

        const swapped = body?.sections !== undefined && applySections(body.sections);
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
    modalLayer.innerHTML = renderModal(
      ent,
      modal.selected,
      offer?.giftDisplays,
      offer?.design?.preset,
      // The modal lives outside .cb, so the merchant's overrides have to be
      // handed to it explicitly rather than inherited.
      offer?.design?.tokens
    );
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

  /**
   * Keep Tab inside the dialog.
   *
   * `aria-modal="true"` tells assistive technology the rest of the page is
   * inert; it does not make it so. Without this, Tab walks out of the picker
   * into the drawer and the page behind, and a keyboard shopper is left
   * operating a UI they cannot see behind a backdrop.
   *
   * Queried on each keypress rather than cached: the tile list re-renders on
   * every selection, so a cached list would hold detached nodes.
   */
  const focusablesIn = (root: HTMLElement): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null || el === document.activeElement);

  document.addEventListener('keydown', (event) => {
    if (modal === null) return;

    if (event.key === 'Escape') {
      closeModal();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusables = focusablesIn(modalLayer);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;

    // Focus outside the dialog at all — after a repaint, say — is pulled back.
    if (active === null || !modalLayer.contains(active)) {
      event.preventDefault();
      first.focus();
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
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
