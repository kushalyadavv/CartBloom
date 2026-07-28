/**
 * Cart state and change notification.
 *
 * Three strategies, tried in order of how much the theme cooperates:
 *
 * 1. **Standard storefront events** (Spring '26). Themes emit `shopify:cart:*`
 *    and expose `Shopify.actions`. Working defaults exist even on unmodified
 *    themes, so this is the primary path.
 * 2. **Fetch interception.** Older themes mutate the cart through
 *    `/cart/*.js` directly. We observe those calls rather than trying to
 *    recognise each theme's own event names.
 * 3. **Polling is deliberately absent.** It burns battery on mobile and still
 *    misses updates between ticks.
 *
 * Everything here reads from Shopify. Nothing calls our infrastructure — that
 * property is what keeps hosting free regardless of a merchant's traffic.
 */

export interface AjaxCartLine {
  key: string;
  variant_id: number;
  product_id: number;
  quantity: number;
  /** Undiscounted unit price in minor units. */
  original_price: number;
  properties: Record<string, string> | null;
}

export interface AjaxCart {
  items: AjaxCartLine[];
  item_count: number;
}

type CartListener = (cart: AjaxCart) => void;

interface ShopifyActions {
  getCart?: () => Promise<{ cart?: unknown }>;
  updateCart?: (payload: unknown) => Promise<unknown>;
  openCart?: () => Promise<unknown>;
}

declare global {
  interface Window {
    Shopify?: { actions?: ShopifyActions };
  }
}

/** Cart mutation endpoints, in the order they appear in a theme's traffic. */
const MUTATING_PATHS = ['/cart/add', '/cart/change', '/cart/update', '/cart/clear'];

export function hasStandardActions(): boolean {
  return typeof window.Shopify?.actions?.getCart === 'function';
}

/**
 * Current cart state.
 *
 * `/cart.js` rather than `Shopify.actions.getCart()` even when the latter
 * exists: the action returns the Storefront API's shape, and the widget needs
 * `original_price` and `properties` in the AJAX shape that the entitlement
 * normalisation already expects. Mixing the two would mean maintaining two
 * mappings for one job.
 */
export async function fetchCart(cartUrl = '/cart.js'): Promise<AjaxCart> {
  const url = cartUrl.endsWith('.js') ? cartUrl : `${cartUrl}.js`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  return (await response.json()) as AjaxCart;
}

function isMutatingCartRequest(input: RequestInfo | URL): boolean {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.pathname
        : (input as Request).url;
  return MUTATING_PATHS.some((path) => url.includes(path));
}

/**
 * Notify on every cart change.
 *
 * Returns a teardown function. Both strategies are installed when available:
 * a theme may emit standard events for its own UI while a third-party upsell
 * app mutates the cart through raw fetch, and missing that would leave the bar
 * showing a stale total.
 */
export function onCartChange(listener: CartListener, cartUrl = '/cart.js'): () => void {
  const teardowns: Array<() => void> = [];
  const notify = (): void => {
    void fetchCart(cartUrl).then(listener);
  };

  // --- 1. Standard storefront events -------------------------------------

  const onLinesUpdate = (event: Event): void => {
    // The event carries a promise that settles when the mutation completes.
    // Reading the cart before it settles returns the pre-mutation state.
    const promise = (event as Event & { promise?: Promise<unknown> }).promise;
    if (promise !== undefined) {
      void promise.then(notify, notify);
    } else {
      notify();
    }
  };

  document.addEventListener('shopify:cart:lines-update', onLinesUpdate);
  document.addEventListener('shopify:cart:view', notify);
  teardowns.push(() => {
    document.removeEventListener('shopify:cart:lines-update', onLinesUpdate);
    document.removeEventListener('shopify:cart:view', notify);
  });

  // --- 2. Fetch interception, for themes and apps that bypass the above ---

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(...args: Parameters<typeof fetch>) {
    const result = originalFetch.apply(this, args);
    if (isMutatingCartRequest(args[0])) {
      // After the response, not before — the cart is only updated once the
      // request completes. Failures are ignored: a failed mutation changed
      // nothing, so there is nothing to re-read.
      void result.then(notify, () => {});
    }
    return result;
  };
  teardowns.push(() => {
    window.fetch = originalFetch;
  });

  return () => {
    for (const teardown of teardowns) teardown();
  };
}

/**
 * Shopify section ids that contain the cart UI.
 *
 * Sections are wrapped in `<div id="shopify-section-{id}">`. Finding them from
 * the drawer outwards means we refresh whatever the theme actually renders the
 * cart with, without knowing its section names.
 */
export function cartSectionIds(): string[] {
  const ids = new Set<string>();
  for (const selector of ['cart-drawer-component', 'cart-drawer', '#CartDrawer', '.cart-drawer']) {
    const section = document.querySelector(selector)?.closest('[id^="shopify-section-"]');
    const id = section?.id.replace('shopify-section-', '');
    if (id !== undefined && id !== '') ids.add(id);
  }
  return [...ids];
}

/**
 * Re-render the theme's own cart markup.
 *
 * The AJAX cart API is required for gift claims — `Shopify.actions.updateCart`
 * accepts only `{merchandiseId, quantity}` and cannot carry line properties. But
 * mutating that way leaves the theme unaware, so its drawer shows stale line
 * items until a full page load.
 *
 * The Section Rendering API closes that gap: ask Shopify to re-render the same
 * sections the theme uses and swap the markup in. This is how Dawn and Horizon
 * refresh their own drawers.
 *
 * Returns true if anything was replaced, so the caller knows to re-mount — the
 * swap destroys our host along with the theme's markup.
 */
export async function refreshCartSections(ids: string[] = cartSectionIds()): Promise<boolean> {
  if (ids.length === 0) return false;

  const url = `${window.location.pathname}?sections=${encodeURIComponent(ids.join(','))}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) return false;

  const sections = (await response.json()) as Record<string, string>;
  let replaced = false;

  for (const id of ids) {
    const markup = sections[id];
    const target = document.getElementById(`shopify-section-${id}`);
    if (typeof markup !== 'string' || target === null) continue;

    // The response is a full section wrapper; take its children so we do not
    // nest one section wrapper inside another.
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    const incoming = parsed.getElementById(`shopify-section-${id}`) ?? parsed.body;
    target.innerHTML = incoming.innerHTML;
    replaced = true;
  }

  return replaced;
}
