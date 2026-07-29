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
 * The panel that actually slides, inside the drawer element.
 *
 * `<cart-drawer>` is typically an overlay container covering the viewport, with
 * the visible panel nested inside it. Mounting into the outer element puts the
 * bar behind the panel, where it flashes during the open/close transition and
 * is otherwise invisible — which is exactly what happened on the first real
 * theme this ran against.
 */
const PANEL_SELECTORS = [
  '.drawer__inner',
  '.cart-drawer__inner',
  '.drawer__contents',
  '.cart-drawer__contents',
  '[data-drawer-inner]',
  '.mini-cart__inner',
];

/**
 * Where inside the panel the bar belongs.
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

/**
 * Containers that hold the line items. Used as a last resort: inserting before
 * the item list is always inside the panel, even on a theme whose class names
 * we do not recognise.
 */
/**
 * The empty-cart body.
 *
 * An empty drawer renders none of the header or item containers above — Dawn
 * swaps the whole inner region for a centred "Your cart is empty" panel. With
 * nothing to anchor to, mounting fell through to prepending on the panel, and
 * because the empty region is a flex child that fills the space, the bar ended
 * up visually below it.
 *
 * Anchoring to the empty region explicitly puts the bar above it, which is
 * where it matters most: an empty cart is exactly when a shopper needs to know
 * what spending unlocks.
 */
const EMPTY_STATE_SELECTORS = [
  '.drawer__inner-empty',
  '.cart-drawer__empty-content',
  '.cart__empty-text',
  '.is-empty .drawer__inner > *',
];

const ITEMS_SELECTORS = [
  '.drawer__contents',
  '.cart-drawer__items',
  '.cart-items',
  'cart-items',
  'form[action*="/cart"]',
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

  // Descend into the sliding panel before choosing a position. Mounting into
  // the outer overlay puts the bar behind the panel.
  const panel = firstMatch(drawer, PANEL_SELECTORS) ?? drawer;

  const header = firstMatch(panel, INSERTION_HINTS);
  if (header !== null) {
    // Tagged so the stylesheet can order the header above the widget without
    // guessing which sibling it is. Ordering every preceding sibling ahead of
    // the host also caught the empty-cart region, which dropped the widget to
    // the bottom of an empty drawer.
    header.setAttribute('data-cartbloom-header', '');
    return { host: ensureHost(header.parentElement ?? panel, header), reason: isStandard ? 'standard' : 'theme-selector' };
  }

  // Empty cart: anchor above the empty-state region.
  const empty = firstMatch(panel, EMPTY_STATE_SELECTORS);
  if (empty !== null && empty.parentElement !== null) {
    const existing = empty.parentElement.querySelector<HTMLElement>(':scope > [data-cartbloom-host]');
    if (existing !== null) {
      return { host: existing, reason: isStandard ? 'standard' : 'theme-selector' };
    }
    const created = document.createElement('div');
    created.setAttribute('data-cartbloom-host', '');
    empty.insertAdjacentElement('beforebegin', created);
    return { host: created, reason: isStandard ? 'standard' : 'theme-selector' };
  }

  // No recognisable header. Sit directly above the line items, which is still
  // inside the panel even on a theme whose class names we do not know.
  const items = firstMatch(panel, ITEMS_SELECTORS);
  if (items !== null && items.parentElement !== null) {
    const host = items.parentElement.querySelector<HTMLElement>(':scope > [data-cartbloom-host]');
    if (host !== null) return { host, reason: isStandard ? 'standard' : 'theme-selector' };
    const created = document.createElement('div');
    created.setAttribute('data-cartbloom-host', '');
    items.insertAdjacentElement('beforebegin', created);
    return { host: created, reason: isStandard ? 'standard' : 'theme-selector' };
  }

  return {
    host: ensureHost(panel, null),
    reason: isStandard ? 'standard' : 'theme-selector',
  };
}

/**
 * Keep the widget mounted, for as long as the page lives.
 *
 * Mounting cannot be a one-shot operation. Themes rebuild the cart drawer on
 * every change — empty to filled, adding a line, removing one — and each
 * rebuild destroys our host. An observer that disconnects after the first
 * success produces exactly the symptoms this replaced: the bar missing on an
 * empty cart, missing intermittently, and vanishing for good once a gift is
 * removed.
 *
 * So the observer runs for the life of the page and re-mounts whenever the host
 * is gone. The cost is real but small: the callback only fires when a mount
 * actually happened, and `findDrawerMount` is a handful of `querySelector`
 * calls guarded by an early exit.
 */
export function keepMounted(onMounted: (result: MountResult) => void): () => void {
  let current: HTMLElement | null = null;

  const ensure = (): void => {
    // Still attached and still ours — nothing to do. This is the common case
    // and keeps the observer cheap.
    if (current !== null && current.isConnected) return;

    const result = findDrawerMount();
    if (result.host === null) return;

    current = result.host;
    onMounted(result);
  };

  ensure();

  const observer = new MutationObserver(() => {
    ensure();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    current = null;
  };
}

/** @deprecated Use {@link keepMounted}; one-shot mounting loses the host on re-render. */
export const observeForMount = keepMounted;
