/**
 * Finding somewhere to put the widget.
 *
 * Cart-drawer sections do not accept `@app` blocks, so a merchant cannot place
 * the widget in their drawer even if they want to. The embed loads globally and
 * the widget locates its own mount point.
 *
 * This file is where competitors earn their one-star reviews. The failure mode
 * is not a crash — it is a merchant installing the app, seeing nothing, and
 * concluding it is broken. So: try hard, in a defined order, and re-try when
 * the drawer is built lazily on first open.
 *
 * The cart *page* does not use any of this. It gets a real app block the
 * merchant drags into place (Task 35), which is strictly better where it works.
 */

export type MountReason = 'anchor' | 'standard' | 'theme-selector' | 'none';

export interface MountResult {
  host: HTMLElement | null;
  reason: MountReason;
}

/**
 * A merchant-pasted anchor wins over everything.
 *
 * If someone went to the trouble of editing their theme to say "put it here",
 * no heuristic of ours should second-guess them.
 */
const ANCHOR_SELECTOR = '[data-cartbloom-anchor]';

/**
 * Drawer containers, most standard first.
 *
 * The first two are Shopify's own custom elements and cover Dawn, Horizon, and
 * anything derived from them — the large majority of installs. The rest are
 * common conventions in popular paid themes.
 */
const DRAWER_SELECTORS = [
  'cart-drawer-component',
  'cart-drawer',
  '#CartDrawer',
  '.cart-drawer',
  '.drawer--cart',
  '#cart-drawer',
  '[data-cart-drawer]',
  '.mini-cart',
  '#sidebar-cart',
];

/**
 * Where inside the drawer the bar belongs.
 *
 * Above the line items, below the header: a progress bar under a long item list
 * is below the fold on mobile, which is where most carts are viewed.
 */
const INSERTION_HINTS = [
  '.drawer__header',
  '.cart-drawer__header',
  '[data-cart-drawer-header]',
  'header',
];

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const found = root.querySelector<HTMLElement>(selector);
    if (found !== null) return found;
  }
  return null;
}

/** An element the widget owns, so re-mounting is idempotent. */
function ensureHost(parent: Element, before: Element | null): HTMLElement {
  const existing = parent.querySelector<HTMLElement>(':scope > [data-cartbloom-host]');
  if (existing !== null) return existing;

  const host = document.createElement('div');
  host.setAttribute('data-cartbloom-host', '');
  if (before !== null && before.parentElement === parent) {
    before.insertAdjacentElement('afterend', host);
  } else {
    parent.prepend(host);
  }
  return host;
}

/**
 * Locate a mount point for the cart drawer, or report that there isn't one yet.
 *
 * Returning `none` is a normal state, not an error: most themes build the
 * drawer lazily and it simply does not exist until the shopper opens the cart.
 * That is what `observeForMount` is for.
 */
export function findDrawerMount(root: ParentNode = document): MountResult {
  const anchor = root.querySelector<HTMLElement>(ANCHOR_SELECTOR);
  if (anchor !== null) return { host: anchor, reason: 'anchor' };

  const drawer = firstMatch(root, DRAWER_SELECTORS);
  if (drawer === null) return { host: null, reason: 'none' };

  const isStandard =
    drawer.tagName === 'CART-DRAWER-COMPONENT' || drawer.tagName === 'CART-DRAWER';
  const header = firstMatch(drawer, INSERTION_HINTS);

  return {
    host: ensureHost(drawer, header),
    reason: isStandard ? 'standard' : 'theme-selector',
  };
}

/**
 * Watch for a drawer that does not exist yet.
 *
 * Calls back once, on the first successful mount, then disconnects. Themes that
 * rebuild the drawer on every open would otherwise re-trigger endlessly; the
 * host element is idempotent, so a caller that wants to survive that can simply
 * call again.
 */
export function observeForMount(
  onMounted: (result: MountResult) => void,
  timeoutMs = 30_000
): () => void {
  const immediate = findDrawerMount();
  if (immediate.host !== null) {
    onMounted(immediate);
    return () => {};
  }

  const observer = new MutationObserver(() => {
    const result = findDrawerMount();
    if (result.host !== null) {
      observer.disconnect();
      window.clearTimeout(timer);
      onMounted(result);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // A permanent observer on a busy storefront is a real cost. If no drawer has
  // appeared in 30s there almost certainly isn't one, and the cart page block
  // covers that case.
  const timer = window.setTimeout(() => observer.disconnect(), timeoutMs);

  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}
